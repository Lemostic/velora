// SFTP node implementation using ssh2 crate.
// Supports: upload / download / delete / backup with password or key auth.
#![allow(dead_code)]
use ssh2::{Session, Sftp};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use super::autodeploy::{fail, upstream_path, AutodeployExecuteRequest, AutodeployExecuteResult};

/// 工作流级 SSH 会话池。
///
/// `ssh_session` 节点把已认证的 Session 放进这里，后续远端节点只传递
/// sessionId，不再重复 TCP 连接和认证。Session 本身是可 Clone 的共享句柄，
/// 前端执行器是串行执行，因此同一工作流内不会并发读写同一 channel。
static SSH_SESSIONS: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();

fn session_pool() -> &'static Mutex<HashMap<String, Session>> {
    SSH_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn parse_host(host: &str) -> (&str, u16) {
    if let Some((h, p)) = host.rsplit_once(':') {
        if let Ok(port) = p.parse::<u16>() {
            return (h, port);
        }
    }
    (host, 22)
}

fn open_session(host: &str, user: &str, auth: &str, secret: &str) -> Result<Session, String> {
    let (hostname, port) = parse_host(host);
    let tcp = TcpStream::connect((hostname, port))
        .map_err(|e| format!("connect {}:{} failed: {}", hostname, port, e))?;
    let mut sess = Session::new().map_err(|e| format!("ssh init failed: {}", e))?;
    sess.set_tcp_stream(tcp);
    sess.set_timeout(15_000);
    sess.handshake().map_err(|e| format!("ssh handshake failed: {}", e))?;
    match auth {
        "password" => sess
            .userauth_password(user, secret)
            .map_err(|e| format!("password auth failed: {}", e))?,
        "key" => {
            let key_path = Path::new(secret);
            if !key_path.exists() {
                return Err(format!("private key not found: {}", secret));
            }
            sess.userauth_pubkey_file(user, None, key_path, None)
                .map_err(|e| format!("key auth failed: {}", e))?;
        }
        other => return Err(format!("unknown auth method: {}", other)),
    }
    if !sess.authenticated() {
        return Err("authentication incomplete".into());
    }
    Ok(sess)
}

fn input_session_id(req: &AutodeployExecuteRequest) -> Option<String> {
    req.inputs.iter().find_map(|input| {
        input
            .get("sessionId")
            .and_then(|v| v.as_str())
            .map(str::to_string)
    })
}

/// 优先拿工作流 SSH 会话；没有会话节点时退回旧的单节点建连行为。
fn acquire_session(req: &AutodeployExecuteRequest) -> Result<(Session, Option<String>), String> {
    if let Some(id) = input_session_id(req) {
        let sessions = session_pool()
            .lock()
            .map_err(|_| "SSH 会话池已损坏".to_string())?;
        let session = sessions
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("SSH 会话不存在或已关闭：{}", id))?;
        return Ok((session, Some(id)));
    }
    let host = req.params.get("host").and_then(|v| v.as_str()).unwrap_or("");
    let user = req.params.get("user").and_then(|v| v.as_str()).unwrap_or("");
    let auth = req.params.get("auth").and_then(|v| v.as_str()).unwrap_or("");
    let secret = req.params.get("secret").and_then(|v| v.as_str()).unwrap_or("");
    Ok((open_session(host, user, auth, secret)?, None))
}

fn remember_session(id: &str, session: Session) -> Result<(), String> {
    session_pool()
        .lock()
        .map_err(|_| "SSH 会话池已损坏".to_string())?
        .insert(id.to_string(), session);
    Ok(())
}

fn output_with_session(kind: &str, path: Option<&str>, session_id: Option<&str>) -> serde_json::Value {
    let mut output = serde_json::Map::new();
    output.insert("kind".into(), serde_json::json!(kind));
    if let Some(path) = path {
        output.insert("path".into(), serde_json::json!(path));
    }
    if let Some(id) = session_id {
        output.insert("sessionId".into(), serde_json::json!(id));
    }
    serde_json::Value::Object(output)
}

/// 建立一个可供同一工作流后续节点复用的 SSH 会话。
pub fn sftp_ssh_session(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let started = Instant::now();
    let host = req.params.get("host").and_then(|v| v.as_str()).unwrap_or("");
    let user = req.params.get("user").and_then(|v| v.as_str()).unwrap_or("");
    let auth = req.params.get("auth").and_then(|v| v.as_str()).unwrap_or("");
    let secret = req.params.get("secret").and_then(|v| v.as_str()).unwrap_or("");
    if host.is_empty() || user.is_empty() || auth.is_empty() || secret.is_empty() {
        return fail(req, "SSH 会话需要填写服务器、用户名、认证方式和凭据");
    }
    let session = match open_session(host, user, auth, secret) {
        Ok(session) => session,
        Err(e) => return fail(req, &e),
    };
    let session_id = format!("{}-{}", req.node_id, uuid_like_suffix());
    if let Err(e) = remember_session(&session_id, session) {
        return fail(req, &e);
    }
    AutodeployExecuteResult {
        ok: true,
        node_id: req.node_id.clone(),
        message: format!("SSH 会话已建立：{}@{}", user, host),
        output: Some(output_with_session("ssh_session", None, Some(&session_id))),
        elapsed_ms: started.elapsed().as_millis() as u64,
    }
}

fn uuid_like_suffix() -> String {
    format!("{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default())
}

/// 执行完工作流后释放本次运行创建的会话。
#[tauri::command]
pub fn sftp_close_sessions(session_ids: Vec<String>) {
    if let Ok(mut sessions) = session_pool().lock() {
        for id in session_ids {
            if let Some(session) = sessions.remove(&id) {
                let _ = session.disconnect(None, "workflow complete", None);
            }
        }
    }
}

fn sftp_mkdir_p(sftp: &Sftp, remote: &Path) -> Result<(), String> {
    let mut cur = PathBuf::new();
    for comp in remote.components() {
        cur.push(comp.as_os_str());
        let s = cur.to_string_lossy().replace('\\', "/");
        match sftp.stat(Path::new(&s)) {
            Ok(_) => continue,
            Err(_) => sftp.mkdir(Path::new(&s), 0o755).map_err(|e| format!("mkdir {} failed: {}", s, e))?,
        }
    }
    Ok(())
}

fn upload_path(sftp: &Sftp, local: &Path, remote_dir: &Path) -> Result<String, String> {
    if !local.exists() {
        return Err(format!("local not found: {}", local.display()));
    }
    if local.is_file() {
        let name = local.file_name().ok_or_else(|| format!("bad filename: {}", local.display()))?;
        sftp_mkdir_p(sftp, remote_dir)?;
        let remote_file = remote_dir.join(name).to_string_lossy().replace('\\', "/");
        let mut rf = sftp
            .create(Path::new(&remote_file))
            .map_err(|e| format!("remote open {} failed: {}", remote_file, e))?;
        let mut lf = fs::File::open(local).map_err(|e| format!("local open failed: {}", e))?;
        let mut buf = Vec::new();
        lf.read_to_end(&mut buf).map_err(|e| format!("local read failed: {}", e))?;
        rf.write_all(&buf).map_err(|e| format!("remote write failed: {}", e))?;
        Ok(format!("{} ({} bytes)", remote_file, buf.len()))
    } else {
        upload_dir_recursive(sftp, local, remote_dir)?;
        Ok(remote_dir.to_string_lossy().replace('\\', "/"))
    }
}

fn upload_dir_recursive(sftp: &Sftp, local_dir: &Path, remote_dir: &Path) -> Result<(), String> {
    sftp_mkdir_p(sftp, remote_dir)?;
    for entry in fs::read_dir(local_dir).map_err(|e| format!("read local dir failed: {}", e))? {
        let entry = entry.map_err(|e| format!("dir entry failed: {}", e))?;
        let from = entry.path();
        let name = entry.file_name();
        let to = remote_dir.join(&name);
        if from.is_dir() {
            upload_dir_recursive(sftp, &from, &to)?;
        } else {
            let remote_file = to.to_string_lossy().replace('\\', "/");
            let mut rf = sftp
                .create(Path::new(&remote_file))
                .map_err(|e| format!("remote open failed: {}", e))?;
            let mut lf = fs::File::open(&from).map_err(|e| format!("local open failed: {}", e))?;
            let mut buf = Vec::new();
            lf.read_to_end(&mut buf).map_err(|e| format!("local read failed: {}", e))?;
            rf.write_all(&buf).map_err(|e| format!("remote write failed: {}", e))?;
        }
    }
    Ok(())
}

fn download_path(sftp: &Sftp, remote: &Path, local: &Path) -> Result<String, String> {
    let remote_str = remote.to_string_lossy().replace('\\', "/");
    let meta = sftp.stat(Path::new(&remote_str)).map_err(|e| format!("remote stat failed: {}", e))?;
    let is_dir = meta.is_dir();
    if !is_dir {
        if let Some(parent) = local.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).map_err(|e| format!("create local dir failed: {}", e))?;
            }
        }
        let mut rf = sftp.open(Path::new(&remote_str)).map_err(|e| format!("remote open failed: {}", e))?;
        let mut lf = fs::File::create(local).map_err(|e| format!("local create failed: {}", e))?;
        let mut buf = Vec::new();
        rf.read_to_end(&mut buf).map_err(|e| format!("remote read failed: {}", e))?;
        lf.write_all(&buf).map_err(|e| format!("local write failed: {}", e))?;
        Ok(format!("{} ({} bytes)", local.display(), buf.len()))
    } else {
        download_dir_recursive(sftp, remote, local)?;
        Ok(local.to_string_lossy().to_string())
    }
}

fn download_dir_recursive(sftp: &Sftp, remote_dir: &Path, local_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(local_dir).map_err(|e| format!("create local dir failed: {}", e))?;
    let remote_str = remote_dir.to_string_lossy().replace('\\', "/");
    let entries = sftp.readdir(Path::new(&remote_str)).map_err(|e| format!("readdir failed: {}", e))?;
    for (path, stat) in entries {
        let local_child = local_dir.join(path.file_name().unwrap_or_default());
        if stat.is_dir() {
            download_dir_recursive(sftp, &path, &local_child)?;
        } else {
            let mut rf = sftp.open(Path::new(&*path.to_string_lossy())).map_err(|e| format!("remote open failed: {}", e))?;
            let mut lf = fs::File::create(&local_child).map_err(|e| format!("local create failed: {}", e))?;
            let mut buf = Vec::new();
            rf.read_to_end(&mut buf).map_err(|e| format!("remote read failed: {}", e))?;
            lf.write_all(&buf).map_err(|e| format!("local write failed: {}", e))?;
        }
    }
    Ok(())
}

fn delete_remote(sftp: &Sftp, remote: &Path) -> Result<String, String> {
    let remote_str = remote.to_string_lossy().replace('\\', "/");
    let meta = sftp.stat(Path::new(&remote_str)).map_err(|e| format!("remote stat failed: {}", e))?;
    if meta.is_dir() {
        delete_dir_recursive(sftp, remote)?;
    } else {
        sftp.unlink(Path::new(&remote_str)).map_err(|e| format!("unlink failed: {}", e))?;
    }
    Ok(remote_str)
}

fn delete_dir_recursive(sftp: &Sftp, remote_dir: &Path) -> Result<(), String> {
    let remote_str = remote_dir.to_string_lossy().replace('\\', "/");
    let entries = sftp.readdir(Path::new(&remote_str)).map_err(|e| format!("readdir failed: {}", e))?;
    for (path, stat) in entries {
        if stat.is_dir() {
            delete_dir_recursive(sftp, &path)?;
            sftp.rmdir(Path::new(&*path.to_string_lossy())).map_err(|e| format!("rmdir failed: {}", e))?;
        } else {
            sftp.unlink(Path::new(&*path.to_string_lossy())).map_err(|e| format!("unlink failed: {}", e))?;
        }
    }
    Ok(())
}

pub fn sftp_upload(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let started = Instant::now();
    let Some(remote_path) = req.params.get("remote_path").and_then(|v| v.as_str()) else {
        return fail(req, "missing remote_path");
    };
    let local_src = upstream_path(req);
    let uploaded_path = local_src
        .as_deref()
        .map(|src| uploaded_remote_path(Path::new(src), remote_path));
    let (sess, session_id) = match acquire_session(req) {
        Ok(s) => s,
        Err(e) => return fail(req, &e),
    };
    let sftp = match sess.sftp() {
        Ok(s) => s,
        Err(e) => return fail(req, &format!("sftp init failed: {}", e)),
    };
    let mut result = match local_src {
        Some(src) => match upload_path(&sftp, Path::new(&src), Path::new(remote_path)) {
            Ok(msg) => AutodeployExecuteResult {
                ok: true,
                node_id: req.node_id.clone(),
                message: format!("uploaded to {}", msg),
                output: Some(output_with_session("remote", uploaded_path.as_deref(), session_id.as_deref())),
                elapsed_ms: 0,
            },
            Err(e) => fail(req, &e),
        },
        None => fail(req, "upstream did not provide path"),
    };
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    if session_id.is_none() {
        let _ = sess.disconnect(None, "", None);
    }
    result
}

pub fn sftp_download(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let started = Instant::now();
    let Some(remote_path) = req.params.get("remote_path").and_then(|v| v.as_str()) else {
        return fail(req, "missing remote_path");
    };
    let Some(local_path) = req.params.get("local_path").and_then(|v| v.as_str()) else {
        return fail(req, "missing local_path");
    };
    let (sess, session_id) = match acquire_session(req) {
        Ok(s) => s,
        Err(e) => return fail(req, &e),
    };
    let sftp = match sess.sftp() {
        Ok(s) => s,
        Err(e) => return fail(req, &format!("sftp init failed: {}", e)),
    };
    let mut result = match download_path(&sftp, Path::new(remote_path), Path::new(local_path)) {
        Ok(msg) => AutodeployExecuteResult {
            ok: true,
            node_id: req.node_id.clone(),
            message: format!("downloaded to {}", msg),
            output: Some(output_with_session("file", Some(local_path), session_id.as_deref())),
            elapsed_ms: 0,
        },
        Err(e) => fail(req, &e),
    };
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    if session_id.is_none() { let _ = sess.disconnect(None, "", None); }
    result
}

pub fn sftp_delete(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let started = Instant::now();
    let Some(remote_path) = req.params.get("remote_path").and_then(|v| v.as_str()) else {
        return fail(req, "missing remote_path");
    };
    let (sess, session_id) = match acquire_session(req) {
        Ok(s) => s,
        Err(e) => return fail(req, &e),
    };
    let sftp = match sess.sftp() {
        Ok(s) => s,
        Err(e) => return fail(req, &format!("sftp init failed: {}", e)),
    };
    let mut result = match delete_remote(&sftp, Path::new(remote_path)) {
        Ok(target) => AutodeployExecuteResult {
            ok: true,
            node_id: req.node_id.clone(),
            message: format!("deleted {}", target),
            output: Some(output_with_session("remote", Some(remote_path), session_id.as_deref())),
            elapsed_ms: 0,
        },
        Err(e) => fail(req, &e),
    };
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    if session_id.is_none() { let _ = sess.disconnect(None, "", None); }
    result
}

pub fn sftp_backup(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let started = Instant::now();
    let Some(remote_path) = req.params.get("remote_path").and_then(|v| v.as_str()) else {
        return fail(req, "missing remote_path");
    };
    let Some(backup_dir) = req.params.get("backup_dir").and_then(|v| v.as_str()) else {
        return fail(req, "missing backup_dir");
    };
    let (sess, session_id) = match acquire_session(req) {
        Ok(s) => s,
        Err(e) => return fail(req, &e),
    };
    let sftp = match sess.sftp() {
        Ok(s) => s,
        Err(e) => return fail(req, &format!("sftp init failed: {}", e)),
    };
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let remote_name = Path::new(remote_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("backup");
    let backup_dir_path = Path::new(backup_dir);
    if let Some(parent) = backup_dir_path.parent() {
        if !parent.as_os_str().is_empty() {
            let _ = fs::create_dir_all(parent);
        }
    }
    let local_zip = backup_dir_path.join(format!("{}-{}.zip", remote_name, stamp));
    let tmp = std::env::temp_dir().join(format!("velora-sftp-backup-{}-{}", std::process::id(), stamp));
    if tmp.exists() {
        let _ = fs::remove_dir_all(&tmp);
    }
    let work = (|| -> Result<AutodeployExecuteResult, String> {
        fs::create_dir_all(&tmp).map_err(|e| format!("tmp dir failed: {}", e))?;
        download_dir_recursive(&sftp, Path::new(remote_path), &tmp)?;
        let zip_path_str = local_zip.to_string_lossy().to_string();
        zip_dir_to_zip(&tmp, &local_zip)?;
        Ok(AutodeployExecuteResult {
            ok: true,
            node_id: req.node_id.clone(),
            message: format!("backup saved to {}", zip_path_str),
            output: Some(output_with_session("file", Some(&zip_path_str), session_id.as_deref())),
            elapsed_ms: 0,
        })
    })();
    let _ = fs::remove_dir_all(&tmp);
    let mut result = match work {
        Ok(r) => r,
        Err(e) => fail(req, &e),
    };
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    if session_id.is_none() { let _ = sess.disconnect(None, "", None); }
    result
}

fn require_session(req: &AutodeployExecuteRequest) -> Result<(Session, String), String> {
    let id = input_session_id(req)
        .ok_or_else(|| "远端节点必须连接到一个 SSH 会话节点".to_string())?;
    let sessions = session_pool()
        .lock()
        .map_err(|_| "SSH 会话池已损坏".to_string())?;
    let session = sessions
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("SSH 会话不存在或已关闭：{}", id))?;
    Ok((session, id))
}

fn uploaded_remote_path(local: &Path, remote_dir: &str) -> String {
    if local.is_file() {
        if let Some(name) = local.file_name() {
            return Path::new(remote_dir)
                .join(name)
                .to_string_lossy()
                .replace('\\', "/");
        }
    }
    remote_dir.replace('\\', "/")
}

fn remote_input_path(req: &AutodeployExecuteRequest) -> Option<String> {
    upstream_path(req).or_else(|| {
        req.params
            .get("source_path")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(str::to_string)
    })
}

fn remote_command_result(
    req: &AutodeployExecuteRequest,
    session: &Session,
    command: &str,
    success_message: String,
    output: serde_json::Value,
) -> AutodeployExecuteResult {
    match ssh_exec_capture(session, command) {
        Ok((_stdout, _stderr, exit)) if exit == 0 => AutodeployExecuteResult {
            ok: true,
            node_id: req.node_id.clone(),
            message: success_message,
            output: Some(output),
            elapsed_ms: 0,
        },
        Ok((stdout, stderr, exit)) => fail(
            req,
            &format!("远端操作失败（exit {}）：{}{}", exit, stderr.trim(), if stderr.trim().is_empty() { stdout.trim() } else { "" }),
        ),
        Err(e) => fail(req, &e),
    }
}

/// 在同一 SSH 会话内压缩远端文件或目录。默认 tar.gz，也支持 zip。
pub fn sftp_remote_compress(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let started = Instant::now();
    let (session, session_id) = match require_session(req) { Ok(v) => v, Err(e) => return fail(req, &e) };
    let Some(source) = remote_input_path(req) else { return fail(req, "远端压缩缺少源路径（请连接上游远端节点或填写源路径）"); };
    let Some(output) = req.params.get("output").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()) else { return fail(req, "远端压缩缺少输出路径"); };
    let format = req.params.get("format").and_then(|v| v.as_str()).unwrap_or("tar.gz");
    let source_parent = Path::new(&source).parent().and_then(|p| p.to_str()).unwrap_or(".");
    let source_name = Path::new(&source).file_name().and_then(|p| p.to_str()).unwrap_or(&source);
    let command = if format == "zip" {
        format!("mkdir -p {} && cd {} && zip -r -q -- {} {}", shell_escape(Path::new(output).parent().and_then(|p| p.to_str()).unwrap_or(".")), shell_escape(source_parent), shell_escape(output), shell_escape(source_name))
    } else {
        format!("mkdir -p {} && tar -czf {} -C {} {}", shell_escape(Path::new(output).parent().and_then(|p| p.to_str()).unwrap_or(".")), shell_escape(output), shell_escape(source_parent), shell_escape(source_name))
    };
    let mut result = remote_command_result(req, &session, &command, format!("远端压缩完成：{}", output), output_with_session("remote_archive", Some(output), Some(&session_id)));
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    result
}

/// 在同一 SSH 会话内解压远端 zip / tar.gz 文件。
pub fn sftp_remote_extract(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let started = Instant::now();
    let (session, session_id) = match require_session(req) { Ok(v) => v, Err(e) => return fail(req, &e) };
    let Some(source) = remote_input_path(req) else { return fail(req, "远端解压缺少压缩包路径"); };
    let Some(output) = req.params.get("output").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()) else { return fail(req, "远端解压缺少输出目录"); };
    let format = req.params.get("format").and_then(|v| v.as_str()).unwrap_or("auto");
    let is_zip = format == "zip" || (format == "auto" && source.to_ascii_lowercase().ends_with(".zip"));
    let command = if is_zip {
        format!("mkdir -p {} && unzip -o {} -d {}", shell_escape(output), shell_escape(&source), shell_escape(output))
    } else {
        format!("mkdir -p {} && tar -xzf {} -C {}", shell_escape(output), shell_escape(&source), shell_escape(output))
    };
    let mut result = remote_command_result(req, &session, &command, format!("远端解压完成：{}", output), output_with_session("remote_dir", Some(output), Some(&session_id)));
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    result
}

/// 在同一 SSH 会话内复制远端文件或目录。
pub fn sftp_remote_copy(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let started = Instant::now();
    let (session, session_id) = match require_session(req) { Ok(v) => v, Err(e) => return fail(req, &e) };
    let Some(source) = remote_input_path(req) else { return fail(req, "远端复制缺少源路径"); };
    let Some(target) = req.params.get("target").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()) else { return fail(req, "远端复制缺少目标路径"); };
    let parent = Path::new(target).parent().and_then(|p| p.to_str()).unwrap_or(".");
    let command = format!("mkdir -p {} && cp -a -- {} {}", shell_escape(parent), shell_escape(&source), shell_escape(target));
    let mut result = remote_command_result(req, &session, &command, format!("远端复制完成：{} -> {}", source, target), output_with_session("remote", Some(target), Some(&session_id)));
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    result
}

/// 在同一 SSH 会话内移动 / 重命名远端文件或目录。
pub fn sftp_remote_move(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let started = Instant::now();
    let (session, session_id) = match require_session(req) { Ok(v) => v, Err(e) => return fail(req, &e) };
    let Some(source) = remote_input_path(req) else { return fail(req, "远端移动缺少源路径"); };
    let Some(target) = req.params.get("target").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()) else { return fail(req, "远端移动缺少目标路径"); };
    let parent = Path::new(target).parent().and_then(|p| p.to_str()).unwrap_or(".");
    let command = format!("mkdir -p {} && mv -- {} {}", shell_escape(parent), shell_escape(&source), shell_escape(target));
    let mut result = remote_command_result(req, &session, &command, format!("远端移动完成：{} -> {}", source, target), output_with_session("remote", Some(target), Some(&session_id)));
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    result
}

/// 在同一 SSH 会话内删除远端文件或目录。拒绝空路径和根目录，避免误删整机。
pub fn sftp_remote_delete(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let started = Instant::now();
    let (session, session_id) = match require_session(req) { Ok(v) => v, Err(e) => return fail(req, &e) };
    let Some(source) = remote_input_path(req) else { return fail(req, "远端删除缺少路径"); };
    let normalized = source.trim_end_matches('/');
    if normalized.is_empty() || normalized == "/" || normalized == "." || normalized == ".." {
        return fail(req, "拒绝删除空路径或根目录");
    }
    let command = format!("rm -rf -- {}", shell_escape(normalized));
    let mut result = remote_command_result(req, &session, &command, format!("远端删除完成：{}", normalized), output_with_session("remote", Some(normalized), Some(&session_id)));
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    result
}

/// 在同一 SSH 会话内修改远端文件或目录权限。
pub fn sftp_remote_chmod(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let started = Instant::now();
    let Some(source) = remote_input_path(req) else {
        return fail(req, "远端权限缺少路径（请连接上游远端节点或填写路径）");
    };
    let Some(mode_str) = req
        .params
        .get("mode")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
    else {
        return fail(req, "远端权限缺少权限模式");
    };
    let mode = match parse_octal_mode(mode_str) {
        Ok(mode) => mode,
        Err(e) => return fail(req, &e),
    };
    let recursive = req
        .params
        .get("recursive")
        .and_then(|v| v.as_str())
        == Some("true");
    let (session, session_id) = match require_session(req) {
        Ok(value) => value,
        Err(e) => return fail(req, &e),
    };
    let recursive_flag = if recursive { "-R " } else { "" };
    let command = format!(
        "chmod {}{:o} -- {}",
        recursive_flag,
        mode,
        shell_escape(&source),
    );
    let mut result = remote_command_result(
        req,
        &session,
        &command,
        format!("远端权限设置完成：{} → {:o}", source, mode),
        output_with_session("remote", Some(&source), Some(&session_id)),
    );
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    result
}

/// 在同一 SSH 会话内修改远端文件或目录所有者。
pub fn sftp_remote_chown(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let started = Instant::now();
    let Some(source) = remote_input_path(req) else {
        return fail(req, "远端所有者缺少路径（请连接上游远端节点或填写路径）");
    };
    let owner = req
        .params
        .get("owner")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let group = req
        .params
        .get("group")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if owner.is_empty() && group.is_empty() {
        return fail(req, "用户和组不能同时为空");
    }
    let recursive = req
        .params
        .get("recursive")
        .and_then(|v| v.as_str())
        == Some("true");
    let target = if group.is_empty() {
        owner.to_string()
    } else {
        format!("{}:{}", owner, group)
    };
    let (session, session_id) = match require_session(req) {
        Ok(value) => value,
        Err(e) => return fail(req, &e),
    };
    let recursive_flag = if recursive { "-R " } else { "" };
    let command = format!(
        "chown {}-- {} {}",
        recursive_flag,
        shell_escape(&target),
        shell_escape(&source),
    );
    let mut result = remote_command_result(
        req,
        &session,
        &command,
        format!("远端所有者设置完成：{} → {}", source, target),
        output_with_session("remote", Some(&source), Some(&session_id)),
    );
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    result
}

fn zip_dir_to_zip(src_dir: &Path, zip_path: &Path) -> Result<u64, String> {
    use walkdir::WalkDir;
    use zip::write::SimpleFileOptions;
    let f = fs::File::create(zip_path).map_err(|e| format!("create zip failed: {}", e))?;
    let mut zw = zip::ZipWriter::new(f);
    let opts = SimpleFileOptions::default();
    let mut total: u64 = 0;
    for entry in WalkDir::new(src_dir) {
        let entry = entry.map_err(|e| format!("walk failed: {}", e))?;
        let p = entry.path();
        let rel = p.strip_prefix(src_dir).unwrap();
        if rel.as_os_str().is_empty() {
            continue;
        }
        let name = rel.to_string_lossy().replace('\\', "/");
        if p.is_file() {
            zw.start_file(&name, opts).map_err(|e| format!("zip start failed: {}", e))?;
            let mut lf = fs::File::open(p).map_err(|e| format!("open {} failed: {}", p.display(), e))?;
            let mut buf = Vec::new();
            lf.read_to_end(&mut buf).map_err(|e| format!("read {} failed: {}", p.display(), e))?;
            zw.write_all(&buf).map_err(|e| format!("zip write failed: {}", e))?;
            total += buf.len() as u64;
        } else {
            zw.add_directory(&name, opts).map_err(|e| format!("zip dir failed: {}", e))?;
        }
    }
    zw.finish().map_err(|e| format!("zip finish failed: {}", e))?;
    Ok(total)
}

// -----------------------------------------------------------------------------
// 新增远端操作：chmod / chown / exec / mkdir / rename / list
// -----------------------------------------------------------------------------

/// 把 "755" / "0o755" / "0755" 解析成 i32 八进制权限位。
fn parse_octal_mode(s: &str) -> Result<i32, String> {
    let trimmed = s.trim();
    let t = trimmed
        .strip_prefix("0o")
        .or_else(|| trimmed.strip_prefix("0O"))
        .unwrap_or(trimmed);
    if t.is_empty() {
        return Err("mode 不能为空".into());
    }
    let mode = i32::from_str_radix(t, 8)
        .map_err(|e| format!("mode 解析失败（需 8 进制如 755 / 0o755）：{}", e))?;
    if mode > 0o7777 {
        return Err("mode 超出范围（最多支持 7777）".into());
    }
    Ok(mode)
}

/// 单引号包裹 + 转义内部单引号，保证 shell 不会注入。
fn shell_escape(s: &str) -> String {
    if s.is_empty() {
        return "''".to_string();
    }
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// 用 shell 改单个文件权限。
fn chmod_single(session: &Session, remote: &str, mode: i32) -> Result<u64, String> {
    let mode_oct = format!("{:o}", mode);
    let cmd = format!("chmod {} {}", mode_oct, shell_escape(remote));
    let (_out, err, exit) = ssh_exec_capture(session, &cmd)?;
    if exit != 0 {
        return Err(format!("chmod 失败（exit {}）：{}", exit, err.trim()));
    }
    Ok(1)
}

/// 用 `chmod -R` 递归改权限，再用 `find` 数一下有多少项用于展示。
fn chmod_recursive(session: &Session, remote: &Path, mode: i32) -> Result<u64, String> {
    let remote_str = remote.to_string_lossy().replace('\\', "/");
    let mode_oct = format!("{:o}", mode);
    let cmd = format!(
        "chmod -R {} {} && find {} -mindepth 0 2>/dev/null | wc -l",
        mode_oct,
        shell_escape(&remote_str),
        shell_escape(&remote_str),
    );
    let (out, err, exit) = ssh_exec_capture(session, &cmd)?;
    if exit != 0 {
        return Err(format!("chmod -R 失败（exit {}）：{}", exit, err.trim()));
    }
    let count: u64 = out
        .trim()
        .lines()
        .last()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(1);
    Ok(if count == 0 { 1 } else { count })
}

pub fn sftp_chmod(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let started = Instant::now();
    let Some(remote_path) = req.params.get("remote_path").and_then(|v| v.as_str()) else {
        return fail(req, "missing remote_path");
    };
    let Some(mode_str) = req.params.get("mode").and_then(|v| v.as_str()) else {
        return fail(req, "missing mode");
    };
    let mode = match parse_octal_mode(mode_str) {
        Ok(m) => m,
        Err(e) => return fail(req, &e),
    };
    let recursive = req.params.get("recursive").and_then(|v| v.as_str()) == Some("true");
    let (sess, session_id) = match acquire_session(req) {
        Ok(s) => s,
        Err(e) => return fail(req, &e),
    };
    let remote = Path::new(remote_path);
    let mut result = match if recursive {
        chmod_recursive(&sess, remote, mode)
    } else {
        chmod_single(&sess, remote_path, mode)
    } {
        Ok(count) => AutodeployExecuteResult {
            ok: true,
            node_id: req.node_id.clone(),
            message: format!("chmod {} ({:o}) 完成，共 {} 项", remote_path, mode, count),
            output: Some(serde_json::json!({
                "kind": "remote",
                "path": remote_path,
                "mode": mode,
                "recursive": recursive,
                "changed": count,
            })),
            elapsed_ms: 0,
        },
        Err(e) => fail(req, &e),
    };
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    if session_id.is_none() {
        let _ = sess.disconnect(None, "", None);
    }
    result
}

/// 在远端执行 shell 命令并捕获 stdout / stderr / 退出码。
fn ssh_exec_capture(sess: &Session, command: &str) -> Result<(String, String, i32), String> {
    let mut channel = sess
        .channel_session()
        .map_err(|e| format!("channel_session failed: {}", e))?;
    channel.exec(command).map_err(|e| format!("exec failed: {}", e))?;
    let mut out = String::new();
    channel.read_to_string(&mut out).map_err(|e| format!("read stdout failed: {}", e))?;
    let mut err = String::new();
    channel.stderr().read_to_string(&mut err).map_err(|e| format!("read stderr failed: {}", e))?;
    channel.wait_close().map_err(|e| format!("wait_close failed: {}", e))?;
    let exit = channel.exit_status().unwrap_or(-1);
    Ok((out, err, exit))
}

pub fn sftp_exec(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let started = Instant::now();
    let Some(command) = req.params.get("command").and_then(|v| v.as_str()) else {
        return fail(req, "missing command");
    };
    if command.trim().is_empty() {
        return fail(req, "command 不能为空");
    };
    let (sess, session_id) = match acquire_session(req) {
        Ok(s) => s,
        Err(e) => return fail(req, &e),
    };
    let mut result = match ssh_exec_capture(&sess, command) {
        Ok((out, err, exit)) => {
            if exit != 0 {
                AutodeployExecuteResult {
                    ok: false,
                    node_id: req.node_id.clone(),
                    message: format!("远端命令退出码 {}：{}", exit, err.trim()),
                    output: Some(serde_json::json!({
                        "stdout": out,
                        "stderr": err,
                        "exit": exit,
                    })),
                    elapsed_ms: 0,
                }
            } else {
                AutodeployExecuteResult {
                    ok: true,
                    node_id: req.node_id.clone(),
                    message: format!("远端命令成功（stdout {} 字节）", out.len()),
                    output: Some(serde_json::json!({
                        "stdout": out,
                        "stderr": err,
                        "exit": exit,
                    })),
                    elapsed_ms: 0,
                }
            }
        }
        Err(e) => fail(req, &e),
    };
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    if session_id.is_none() {
        let _ = sess.disconnect(None, "", None);
    }
    result
}

pub fn sftp_chown(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let started = Instant::now();
    let Some(remote_path) = req.params.get("remote_path").and_then(|v| v.as_str()) else {
        return fail(req, "missing remote_path");
    };
    let owner = req.params.get("owner").and_then(|v| v.as_str()).unwrap_or("");
    let group = req.params.get("group").and_then(|v| v.as_str()).unwrap_or("");
    if owner.is_empty() && group.is_empty() {
        return fail(req, "owner 和 group 不能同时为空");
    }
    let recursive = req.params.get("recursive").and_then(|v| v.as_str()) == Some("true");
    let target = if group.is_empty() {
        owner.to_string()
    } else {
        format!("{}:{}", owner, group)
    };
    let recursive_flag = if recursive { "-R " } else { "" };
    let command = format!(
        "chown {}{} {}",
        recursive_flag,
        shell_escape(&target),
        shell_escape(remote_path),
    );
    let (sess, session_id) = match acquire_session(req) {
        Ok(s) => s,
        Err(e) => return fail(req, &e),
    };
    let mut result = match ssh_exec_capture(&sess, &command) {
        Ok((_out, err, exit)) if exit != 0 => AutodeployExecuteResult {
            ok: false,
            node_id: req.node_id.clone(),
            message: format!("chown 失败（exit {}）：{}", exit, err.trim()),
            output: Some(serde_json::json!({ "stderr": err, "exit": exit })),
            elapsed_ms: 0,
        },
        Ok(_) => AutodeployExecuteResult {
            ok: true,
            node_id: req.node_id.clone(),
            message: format!("chown {} {} 完成", target, remote_path),
            output: Some(serde_json::json!({
                "owner": owner,
                "group": group,
                "path": remote_path,
                "recursive": recursive,
            })),
            elapsed_ms: 0,
        },
        Err(e) => fail(req, &e),
    };
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    if session_id.is_none() { let _ = sess.disconnect(None, "", None); }
    result
}

pub fn sftp_mkdir(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let started = Instant::now();
    let Some(remote_path) = req.params.get("remote_path").and_then(|v| v.as_str()) else {
        return fail(req, "missing remote_path");
    };
    let mode_str = req.params.get("mode").and_then(|v| v.as_str()).unwrap_or("755");
    let mode = match parse_octal_mode(mode_str) {
        Ok(m) => m,
        Err(e) => return fail(req, &e),
    };
    let (sess, session_id) = match acquire_session(req) {
        Ok(s) => s,
        Err(e) => return fail(req, &e),
    };
    let sftp = match sess.sftp() {
        Ok(s) => s,
        Err(e) => return fail(req, &format!("sftp init failed: {}", e)),
    };
    let mut result = match sftp_mkdir_p_with_mode(&sftp, Path::new(remote_path), mode) {
        Ok(()) => AutodeployExecuteResult {
            ok: true,
            node_id: req.node_id.clone(),
            message: format!("mkdir -p {} 完成 ({:o})", remote_path, mode),
            output: Some(serde_json::json!({ "kind": "remote", "path": remote_path, "mode": mode })),
            elapsed_ms: 0,
        },
        Err(e) => fail(req, &e),
    };
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    if session_id.is_none() { let _ = sess.disconnect(None, "", None); }
    result
}

/// 带模式的递归 mkdir，已存在的项跳过。
fn sftp_mkdir_p_with_mode(sftp: &Sftp, remote: &Path, mode: i32) -> Result<(), String> {
    let mut cur = PathBuf::new();
    for comp in remote.components() {
        cur.push(comp.as_os_str());
        let s = cur.to_string_lossy().replace('\\', "/");
        match sftp.stat(Path::new(&s)) {
            Ok(_) => continue,
            Err(_) => {
                sftp.mkdir(Path::new(&s), mode)
                    .map_err(|e| format!("mkdir {} failed: {}", s, e))?;
            }
        }
    }
    Ok(())
}

pub fn sftp_rename(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let started = Instant::now();
    let Some(from) = req.params.get("from").and_then(|v| v.as_str()) else {
        return fail(req, "missing from");
    };
    let Some(to) = req.params.get("to").and_then(|v| v.as_str()) else {
        return fail(req, "missing to");
    };
    let (sess, session_id) = match acquire_session(req) {
        Ok(s) => s,
        Err(e) => return fail(req, &e),
    };
    let sftp = match sess.sftp() {
        Ok(s) => s,
        Err(e) => return fail(req, &format!("sftp init failed: {}", e)),
    };
    // 如果目标是已存在的目录，则把 from 移进去（同 mv 语义）
    let target = match sftp.stat(Path::new(to)) {
        Ok(st) if st.is_dir() => match Path::new(from).file_name() {
            Some(name) => Path::new(to).join(name).to_string_lossy().to_string(),
            None => return fail(req, "from 路径没有文件名"),
        },
        _ => to.to_string(),
    };
    let mut result = match sftp.rename(Path::new(from), Path::new(&target), None) {
        Ok(()) => AutodeployExecuteResult {
            ok: true,
            node_id: req.node_id.clone(),
            message: format!("rename {} -> {}", from, target),
            output: Some(serde_json::json!({ "from": from, "to": target })),
            elapsed_ms: 0,
        },
        Err(e) => fail(req, &format!("rename failed: {}", e)),
    };
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    if session_id.is_none() { let _ = sess.disconnect(None, "", None); }
    result
}

pub fn sftp_list(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let started = Instant::now();
    let Some(remote_path) = req.params.get("remote_path").and_then(|v| v.as_str()) else {
        return fail(req, "missing remote_path");
    };
    let pattern = req.params.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
    let (sess, session_id) = match acquire_session(req) {
        Ok(s) => s,
        Err(e) => return fail(req, &e),
    };
    let sftp = match sess.sftp() {
        Ok(s) => s,
        Err(e) => return fail(req, &format!("sftp init failed: {}", e)),
    };
    let entries = sftp.readdir(Path::new(remote_path)).map_err(|e| format!("readdir {} failed: {}", remote_path, e));
    let mut result = match entries {
        Ok(list) => {
            let mut items: Vec<serde_json::Value> = Vec::new();
            for (path, stat) in list {
                let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
                if !pattern.is_empty() && !glob_match(&pattern, &name) {
                    continue;
                }
                items.push(serde_json::json!({
                    "name": name,
                    "size": stat.size.unwrap_or(0),
                    "is_dir": stat.is_dir(),
                    "mtime": stat.mtime,
                    "permissions": stat.perm.unwrap_or(0),
                }));
            }
            AutodeployExecuteResult {
                ok: true,
                node_id: req.node_id.clone(),
                message: format!("{} 共 {} 项", remote_path, items.len()),
                output: Some(serde_json::json!({
                    "kind": "list",
                    "path": remote_path,
                    "sessionId": session_id,
                    "items": items,
                })),
                elapsed_ms: 0,
            }
        }
        Err(e) => fail(req, &e),
    };
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    if session_id.is_none() {
        let _ = sess.disconnect(None, "", None);
    }
    result
}

/// 极简 glob 匹配：支持 `*` / `?`，不支持 `[...]`。
fn glob_match(pattern: &str, name: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let n: Vec<char> = name.chars().collect();
    glob_match_inner(&p, 0, &n, 0)
}

fn glob_match_inner(p: &[char], pi: usize, n: &[char], ni: usize) -> bool {
    let mut pi = pi;
    let mut ni = ni;
    while pi < p.len() {
        match p[pi] {
            '*' => {
                if pi + 1 == p.len() { return true; }
                for j in ni..=n.len() {
                    if glob_match_inner(p, pi + 1, n, j) { return true; }
                }
                return false;
            }
            '?' => {
                if ni >= n.len() { return false; }
                pi += 1; ni += 1;
            }
            c => {
                if ni >= n.len() || n[ni] != c { return false; }
                pi += 1; ni += 1;
            }
        }
    }
    ni == n.len()
}

