//! Markitdown 模块 — 把 PDF / Word / Excel / PPT / 图片 转成 Markdown
//!
//! `markitdown` 是 Python CLI，本模块作为 sidecar 进程拉它：
//!   - 后端 spawn 子进程 `markitdown <input> -o <output>`，把 stdout / stderr
//!     收回来返回前端。
//!   - 找不到 markitdown 时返回清楚的错误，建议用户 `pip install markitdown`。
//!
//! 设计点：
//!   - 不把 markitdown 内嵌到这里（嫌 Python 体积 + 跨平台 wheel 麻烦）。
//!   - 不阻塞 UI：后端做 spawn + wait，前端显示「生成中…」即可。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[derive(Debug, Deserialize)]
pub struct MarkitdownRequest {
    pub input_path: String,
    /// 可选输出路径；不填就写到临时目录并返回路径
    pub output_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MarkitdownResult {
    /// 产出的 markdown 内容（直接预览用）
    pub markdown: String,
    /// markdown 已写入磁盘时的路径（None = 只返回内存内容）
    pub output_path: Option<String>,
    /// markitdown 子进程的 stdout / stderr 摘要
    pub log: String,
}

#[tauri::command]
pub fn markitdown_run(req: MarkitdownRequest) -> Result<MarkitdownResult, String> {
    let input = PathBuf::from(&req.input_path);
    if !input.exists() {
        return Err(format!("input does not exist: {}", req.input_path));
    }
    if !input.is_file() {
        return Err(format!("input is not a file: {}", req.input_path));
    }

    // 决定输出文件
    let output: PathBuf = match req.output_path.as_ref() {
        Some(p) => PathBuf::from(p),
        None => {
            let stem = input
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("output");
            let mut tmp = std::env::temp_dir();
            tmp.push(format!("velora_markitdown_{}.md", stem));
            tmp
        }
    };

    // Spawn markitdown。可执行文件名按平台猜：markitdown / markitdown.exe
    let exe = if cfg!(windows) { "markitdown.exe" } else { "markitdown" };
    let program = match which_first(exe) {
        Some(p) => p,
        None => {
            return Err(format!(
                "`{exe}` not found on PATH. Install via `pip install markitdown` (or `pipx install markitdown`) and ensure the executable is on PATH."
            ));
        }
    };

    let output_str = output.to_string_lossy().into_owned();

    let child = Command::new(program)
        .arg(&input)
        .arg("-o")
        .arg(&output_str)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;

    let output = child.wait_with_output().map_err(|e| format!("wait failed: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let log = format!(
        "exit={:?}\nstdout={}\nstderr={}",
        output.status.code(),
        if stdout.is_empty() { "(empty)".to_string() } else { stdout },
        if stderr.is_empty() { "(empty)".to_string() } else { stderr },
    );

    if !output.status.success() {
        return Err(format!("markitdown exited non-zero. {log}"));
    }

    let markdown = std::fs::read_to_string(&output_str)
        .map_err(|e| format!("read output failed: {e}"))?;

    Ok(MarkitdownResult {
        markdown,
        output_path: Some(output_str),
        log,
    })
}

/// 跨平台地找 PATH 里的 exe；找不到返回 None。
/// 自己实现而不引 which crate，避免把 `which` 加成 root crate 依赖。
fn which_first(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    let exts: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.BAT;.CMD".into())
            .split(';')
            .map(|s| s.to_string())
            .collect()
    } else {
        vec![String::new()]
    };
    for dir in std::env::split_paths(&path_var) {
        for ext in &exts {
            let p = if ext.is_empty() {
                dir.join(name)
            } else {
                dir.join(format!("{name}{ext}"))
            };
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn which_nonexistent_returns_none() {
        assert!(which_first("__definitely_not_a_real_exe__velora__").is_none());
    }
}
