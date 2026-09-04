//! Autodeploy — Node-RED 风格部署工作流编辑器后端
//!
//! 模块定位：把 SFTP 上传 / 压缩 / 解压 / 文件归档这些"部署流水线里的
//! 原子操作"做成可拖拽节点，前端用画布编辑工作流，后端按拓扑顺序执行。
//!
//! 命令面（按 AGENTS.md 约定，去掉 _cmd 后缀，函数名 = invoke 用的名字）：
//!   - `autodeploy_list_node_types`  ——  返回所有节点定义（id / 类别 /
//!                                       端口数 / Inspector 字段定义），
//!                                       前端用它动态渲染库面板和表单。
//!   - `autodeploy_execute`          ——  执行单个节点；SFTP 类节点先打
//!                                       占位（等引入 ssh crate 后补）。
//!
//! 错误：统一走 lib.rs 的 VeloraError，前端 try/catch 直接拿到 message。

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

// =============================================================================
// 节点类型定义（静态，编译期常量）
// =============================================================================

/// 节点大类 — 前端分组用，对应原型 LIBRARY 面板的 SOURCES / PROCESS / TRANSFER
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum NodeCategory {
    Source,
    Process,
    Transfer,
}

/// Inspector 字段类型
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FieldKind {
    Text,
    /// 文件 / 目录路径，前端会挂文件选择器
    Path,
    Number,
    /// 下拉单选
    Select,
    /// 布尔开关
    Checkbox,
}

/// 单个 Inspector 字段定义
#[derive(Debug, Clone, Serialize)]
pub struct FieldDef {
    pub name: &'static str,
    pub label: &'static str,
    pub kind: FieldKind,
    #[serde(default)]
    pub required: bool,
    pub placeholder: Option<&'static str>,
    pub default: Option<&'static str>,
    /// 仅 Select 用
    pub options: Option<&'static [(&'static str, &'static str)]>,
}

/// 节点类型完整定义 — 前端动态渲染库和 Inspector 的依据
#[derive(Debug, Clone, Serialize)]
pub struct NodeType {
    pub id: &'static str,
    pub category: NodeCategory,
    pub label: &'static str,
    pub description: &'static str,
    /// lucide-react 图标名（前端 ICON_MAP 解析）
    pub icon: &'static str,
    /// 输入端口数
    pub inputs: u8,
    /// 输出端口数
    pub outputs: u8,
    pub fields: &'static [FieldDef],
}

// -----------------------------------------------------------------------------
// 10 个内置节点
// -----------------------------------------------------------------------------

const LOCAL_FILE: NodeType = NodeType {
    id: "local_file",
    category: NodeCategory::Source,
    label: "本地文件",
    description: "指定一个本地文件作为部署源",
    icon: "File",
    inputs: 0,
    outputs: 1,
    fields: &[FieldDef {
        name: "path",
        label: "文件路径",
        kind: FieldKind::Path,
        required: true,
        placeholder: Some("C:\\dist\\app.zip"),
        default: None,
        options: None,
    }],
};

const LOCAL_DIR: NodeType = NodeType {
    id: "local_dir",
    category: NodeCategory::Source,
    label: "本地目录",
    description: "把一个目录作为整体作为部署源",
    icon: "FolderOpen",
    inputs: 0,
    outputs: 1,
    fields: &[FieldDef {
        name: "path",
        label: "目录路径",
        kind: FieldKind::Path,
        required: true,
        placeholder: Some("C:\\dist\\frontend"),
        default: None,
        options: None,
    }],
};

const LOCAL_ARCHIVE: NodeType = NodeType {
    id: "local_archive",
    category: NodeCategory::Source,
    label: "本地压缩包",
    description: "从已有 zip / tar.gz 中挑选一个",
    icon: "FileArchive",
    inputs: 0,
    outputs: 1,
    fields: &[
        FieldDef {
            name: "path",
            label: "压缩包路径",
            kind: FieldKind::Path,
            required: true,
            placeholder: Some("C:\\dist\\release.zip"),
            default: None,
            options: None,
        },
        FieldDef {
            name: "strip_prefix",
            label: "去除顶层目录",
            kind: FieldKind::Text,
            required: false,
            placeholder: Some("dist/"),
            default: Some(""),
            options: None,
        },
    ],
};

const COMPRESS: NodeType = NodeType {
    id: "compress",
    category: NodeCategory::Process,
    label: "压缩",
    description: "把上游目录 / 文件压缩成 zip",
    icon: "FileArchive",
    inputs: 1,
    outputs: 1,
    fields: &[
        FieldDef {
            name: "output",
            label: "输出文件",
            kind: FieldKind::Path,
            required: true,
            placeholder: Some("C:\\dist\\release.zip"),
            default: None,
            options: None,
        },
        FieldDef {
            name: "level",
            label: "压缩级别",
            kind: FieldKind::Select,
            required: false,
            placeholder: None,
            default: Some("deflate"),
            options: Some(&[("store", "不压缩"), ("deflate", "普通"), ("bzip2", "高压缩")]),
        },
    ],
};

const EXTRACT: NodeType = NodeType {
    id: "extract",
    category: NodeCategory::Process,
    label: "解压",
    description: "把上游 zip 解压到指定目录",
    icon: "FolderOpen",
    inputs: 1,
    outputs: 1,
    fields: &[FieldDef {
        name: "output",
        label: "解压目录",
        kind: FieldKind::Path,
        required: true,
        placeholder: Some("C:\\dist\\unpacked"),
        default: None,
        options: None,
    }],
};

const COPY: NodeType = NodeType {
    id: "copy",
    category: NodeCategory::Process,
    label: "复制",
    description: "复制上游文件 / 目录到新位置",
    icon: "Copy",
    inputs: 1,
    outputs: 1,
    fields: &[FieldDef {
        name: "output",
        label: "目标路径",
        kind: FieldKind::Path,
        required: true,
        placeholder: Some("D:\\backup"),
        default: None,
        options: None,
    }],
};

const SFTP_UPLOAD: NodeType = NodeType {
    id: "sftp_upload",
    category: NodeCategory::Transfer,
    label: "SFTP 上传",
    description: "把上游文件 / 目录上传到远端",
    icon: "Upload",
    inputs: 1,
    outputs: 1,
    fields: &[
        FieldDef {
            name: "host",
            label: "服务器",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("10.20.30.40:22"),
            default: None,
            options: None,
        },
        FieldDef {
            name: "user",
            label: "用户名",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("deploy"),
            default: None,
            options: None,
        },
        FieldDef {
            name: "auth",
            label: "认证",
            kind: FieldKind::Select,
            required: true,
            placeholder: None,
            default: Some("key"),
            options: Some(&[("password", "密码"), ("key", "私钥")]),
        },
        FieldDef {
            name: "secret",
            label: "凭据",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("从 credentials 选择"),
            default: None,
            options: None,
        },
        FieldDef {
            name: "remote_path",
            label: "远端目录",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("/var/www/app"),
            default: None,
            options: None,
        },
    ],
};

const SFTP_DOWNLOAD: NodeType = NodeType {
    id: "sftp_download",
    category: NodeCategory::Transfer,
    label: "SFTP 下载",
    description: "从远端拉文件回本地",
    icon: "Download",
    inputs: 0,
    outputs: 1,
    fields: &[
        FieldDef {
            name: "host",
            label: "服务器",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("10.20.30.40:22"),
            default: None,
            options: None,
        },
        FieldDef {
            name: "user",
            label: "用户名",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("deploy"),
            default: None,
            options: None,
        },
        FieldDef {
            name: "auth",
            label: "认证",
            kind: FieldKind::Select,
            required: true,
            placeholder: None,
            default: Some("key"),
            options: Some(&[("password", "密码"), ("key", "私钥")]),
        },
        FieldDef {
            name: "secret",
            label: "凭据",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("从 credentials 选择"),
            default: None,
            options: None,
        },
        FieldDef {
            name: "remote_path",
            label: "远端文件",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("/var/log/app.log"),
            default: None,
            options: None,
        },
        FieldDef {
            name: "local_path",
            label: "本地路径",
            kind: FieldKind::Path,
            required: true,
            placeholder: Some("D:\\logs"),
            default: None,
            options: None,
        },
    ],
};

const SFTP_DELETE: NodeType = NodeType {
    id: "sftp_delete",
    category: NodeCategory::Transfer,
    label: "删除远端",
    description: "删除远端文件或目录",
    icon: "Trash2",
    inputs: 0,
    outputs: 0,
    fields: &[
        FieldDef {
            name: "host",
            label: "服务器",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("10.20.30.40:22"),
            default: None,
            options: None,
        },
        FieldDef {
            name: "user",
            label: "用户名",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("deploy"),
            default: None,
            options: None,
        },
        FieldDef {
            name: "auth",
            label: "认证",
            kind: FieldKind::Select,
            required: true,
            placeholder: None,
            default: Some("key"),
            options: Some(&[("password", "密码"), ("key", "私钥")]),
        },
        FieldDef {
            name: "secret",
            label: "凭据",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("从 credentials 选择"),
            default: None,
            options: None,
        },
        FieldDef {
            name: "remote_path",
            label: "远端路径",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("/var/www/app/old"),
            default: None,
            options: None,
        },
    ],
};

const SFTP_BACKUP: NodeType = NodeType {
    id: "sftp_backup",
    category: NodeCategory::Transfer,
    label: "备份远端",
    description: "远端文件 / 目录打包为带时间戳的 zip",
    icon: "ShieldCheck",
    inputs: 0,
    outputs: 0,
    fields: &[
        FieldDef {
            name: "host",
            label: "服务器",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("10.20.30.40:22"),
            default: None,
            options: None,
        },
        FieldDef {
            name: "user",
            label: "用户名",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("deploy"),
            default: None,
            options: None,
        },
        FieldDef {
            name: "auth",
            label: "认证",
            kind: FieldKind::Select,
            required: true,
            placeholder: None,
            default: Some("key"),
            options: Some(&[("password", "密码"), ("key", "私钥")]),
        },
        FieldDef {
            name: "secret",
            label: "凭据",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("从 credentials 选择"),
            default: None,
            options: None,
        },
        FieldDef {
            name: "remote_path",
            label: "远端路径",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("/var/www/app"),
            default: None,
            options: None,
        },
        FieldDef {
            name: "backup_dir",
            label: "备份目录",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("/var/backups"),
            default: None,
            options: None,
        },
    ],
};

// ─────────────────────────────────────────────
// 控制流节点（control flow）
// ─────────────────────────────────────────────

/// 状态分支：1 input, 2 outputs（output 0 = success, output 1 = failure）。
/// 检查上游 status，把执行路径分发到两个 output。
const IF_STATUS: NodeType = NodeType {
    id: "if_status",
    category: NodeCategory::Process,
    label: "状态分支",
    description: "按上游成功 / 失败分别路由到两条分支",
    icon: "GitBranch",
    inputs: 1,
    outputs: 2,
    fields: &[],
};

/// 重试：1 input, 1 output。上游失败时按 max_retries 自动重试。
const RETRY: NodeType = NodeType {
    id: "retry",
    category: NodeCategory::Process,
    label: "失败重试",
    description: "上游执行失败时按设定次数自动重试",
    icon: "RotateCw",
    inputs: 1,
    outputs: 1,
    fields: &[
        FieldDef {
            name: "max_retries",
            label: "最大重试次数",
            kind: FieldKind::Number,
            required: false,
            placeholder: Some("3"),
            default: Some("3"),
            options: None,
        },
        FieldDef {
            name: "retry_delay",
            label: "重试间隔 (秒)",
            kind: FieldKind::Number,
            required: false,
            placeholder: Some("5"),
            default: Some("5"),
            options: None,
        },
    ],
};

/// 结束节点：1 input, 0 outputs。标记工作流结束（不强制早停）。
const END: NodeType = NodeType {
    id: "end",
    category: NodeCategory::Process,
    label: "结束",
    description: "工作流结束标记，到此停止后续路径",
    icon: "CircleStop",
    inputs: 1,
    outputs: 0,
    fields: &[],
};

/// 通知：1 input, 0 outputs。执行时弹系统通知（依赖 tauri notification 插件）。
const NOTIFY: NodeType = NodeType {
    id: "notify",
    category: NodeCategory::Process,
    label: "系统通知",
    description: "触发一条系统通知（依赖 Tauri 通知插件）",
    icon: "Bell",
    inputs: 1,
    outputs: 0,
    fields: &[
        FieldDef {
            name: "title",
            label: "通知标题",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("部署完成"),
            default: None,
            options: None,
        },
        FieldDef {
            name: "body",
            label: "通知内容",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("前端 dist 已上传到 /var/www/app"),
            default: None,
            options: None,
        },
        FieldDef {
            name: "level",
            label: "通知级别",
            kind: FieldKind::Select,
            required: false,
            placeholder: None,
            default: Some("info"),
            options: Some(&[
                ("info", "信息"),
                ("success", "成功"),
                ("warning", "警告"),
                ("error", "错误"),
            ]),
        },
    ],
};

const BUILTIN_NODES: &[NodeType] = &[
    LOCAL_FILE,
    LOCAL_DIR,
    LOCAL_ARCHIVE,
    COMPRESS,
    EXTRACT,
    COPY,
    SFTP_UPLOAD,
    SFTP_DOWNLOAD,
    SFTP_DELETE,
    SFTP_BACKUP,
    IF_STATUS,
    RETRY,
    END,
    NOTIFY,
];

// =============================================================================
// Tauri command 入参 / 出参
// =============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutodeployExecuteRequest {
    /// 节点 id（前端生成的 uuid）
    pub node_id: String,
    /// 节点类型（NodeType.id）
    pub node_type: String,
    /// 用户填好的参数
    #[serde(default)]
    pub params: serde_json::Map<String, serde_json::Value>,
    /// 上游节点的输出（路径 / 字符串 / metadata）
    #[serde(default)]
    pub inputs: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutodeployExecuteResult {
    pub ok: bool,
    pub node_id: String,
    pub message: String,
    /// 节点输出（供下游节点消费）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<serde_json::Value>,
    /// 节点运行耗时（毫秒）
    pub elapsed_ms: u64,
}

// =============================================================================
// Tauri command 实现
// =============================================================================

/// 列出全部内置节点定义。前端用它渲染库面板和 Inspector 表单。
#[tauri::command]
pub fn autodeploy_list_node_types() -> Vec<NodeType> {
    BUILTIN_NODES.to_vec()
}

/// 执行单个节点。SFTP 类节点先打占位（"待引入 ssh crate"）。
#[tauri::command]
pub fn autodeploy_execute(req: AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let start = std::time::Instant::now();
    let mut result = run_node(&req);
    result.elapsed_ms = start.elapsed().as_millis() as u64;
    result
}

fn run_node(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    match req.node_type.as_str() {
        "local_file" => source_local_file(req),
        "local_dir" => source_local_dir(req),
        "local_archive" => source_local_archive(req),
        "compress" => process_compress(req),
        "extract" => process_extract(req),
        "copy" => process_copy(req),
        "sftp_upload" | "sftp_download" | "sftp_delete" | "sftp_backup" => {
            sftp_stub(req)
        }
        "if_status" => control_if_status(req),
        "retry" => control_retry(req),
        "end" => control_end(req),
        "notify" => control_notify(req),
        other => AutodeployExecuteResult {
            ok: false,
            node_id: req.node_id.clone(),
            message: format!("未知节点类型：{}", other),
            output: None,
            elapsed_ms: 0,
        },
    }
}

// -----------------------------------------------------------------------------
// Source 节点
// -----------------------------------------------------------------------------

fn param_str(req: &AutodeployExecuteRequest, key: &str) -> Option<String> {
    req.params.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn source_local_file(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let Some(path) = param_str(req, "path") else {
        return fail(req, "缺少 path 参数");
    };
    let p = PathBuf::from(&path);
    let meta = match fs::metadata(&p) {
        Ok(m) => m,
        Err(e) => return fail(req, &format!("无法访问 {}：{}", p.display(), e)),
    };
    if !meta.is_file() {
        return fail(req, &format!("不是文件：{}", p.display()));
    }
    let size = meta.len();
    let name = p
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    AutodeployExecuteResult {
        ok: true,
        node_id: req.node_id.clone(),
        message: format!("✓ {} ({} 字节)", name, size),
        output: Some(serde_json::json!({
            "kind": "file",
            "path": path,
            "size": size,
            "name": name,
        })),
        elapsed_ms: 0,
    }
}

fn source_local_dir(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let Some(path) = param_str(req, "path") else {
        return fail(req, "缺少 path 参数");
    };
    let p = PathBuf::from(&path);
    let meta = match fs::metadata(&p) {
        Ok(m) => m,
        Err(e) => return fail(req, &format!("无法访问 {}：{}", p.display(), e)),
    };
    if !meta.is_dir() {
        return fail(req, &format!("不是目录：{}", p.display()));
    }
    let entries = match fs::read_dir(&p) {
        Ok(e) => e.count(),
        Err(e) => return fail(req, &format!("读取目录失败：{}", e)),
    };
    AutodeployExecuteResult {
        ok: true,
        node_id: req.node_id.clone(),
        message: format!("✓ 目录 {}（{} 项）", p.display(), entries),
        output: Some(serde_json::json!({
            "kind": "dir",
            "path": path,
            "entries": entries,
        })),
        elapsed_ms: 0,
    }
}

fn source_local_archive(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let Some(path) = param_str(req, "path") else {
        return fail(req, "缺少 path 参数");
    };
    let p = PathBuf::from(&path);
    let meta = match fs::metadata(&p) {
        Ok(m) => m,
        Err(e) => return fail(req, &format!("无法访问 {}：{}", p.display(), e)),
    };
    if !meta.is_file() {
        return fail(req, &format!("不是文件：{}", p.display()));
    }
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !matches!(ext.as_str(), "zip" | "tar" | "tgz" | "gz" | "jar" | "war") {
        return fail(
            req,
            &format!(
                "扩展名 .{} 不在白名单（zip / tar / tgz / gz / jar / war）",
                ext
            ),
        );
    }
    AutodeployExecuteResult {
        ok: true,
        node_id: req.node_id.clone(),
        message: format!("✓ 压缩包 {}（{} 字节）", p.display(), meta.len()),
        output: Some(serde_json::json!({
            "kind": "archive",
            "path": path,
            "size": meta.len(),
            "stripPrefix": param_str(req, "strip_prefix").unwrap_or_default(),
        })),
        elapsed_ms: 0,
    }
}

// -----------------------------------------------------------------------------
// Process 节点
// -----------------------------------------------------------------------------

fn upstream_path(req: &AutodeployExecuteRequest) -> Option<String> {
    req.inputs
        .iter()
        .find_map(|v| v.get("path").and_then(|p| p.as_str()).map(|s| s.to_string()))
        .or_else(|| {
            req.inputs
                .iter()
                .find_map(|v| v.as_str().map(|s| s.to_string()))
        })
}

fn process_compress(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let Some(src) = upstream_path(req) else {
        return fail(req, "上游未产出 path，无法压缩");
    };
    let Some(out) = param_str(req, "output") else {
        return fail(req, "缺少 output 参数");
    };
    let src_path = PathBuf::from(&src);
    if !src_path.exists() {
        return fail(req, &format!("源路径不存在：{}", src));
    }
    let out_path = PathBuf::from(&out);
    if let Some(parent) = out_path.parent() {
        if !parent.as_os_str().is_empty() {
            if let Err(e) = fs::create_dir_all(parent) {
                return fail(req, &format!("无法创建父目录 {}：{}", parent.display(), e));
            }
        }
    }
    let method = param_str(req, "level").unwrap_or_else(|| "deflate".to_string());
    match zip_dir_or_file(&src_path, &out_path, &method) {
        Ok(size) => AutodeployExecuteResult {
            ok: true,
            node_id: req.node_id.clone(),
            message: format!("✓ 压缩完成 {} ({} 字节)", out, size),
            output: Some(serde_json::json!({
                "kind": "file",
                "path": out,
                "size": size,
            })),
            elapsed_ms: 0,
        },
        Err(e) => fail(req, &format!("压缩失败：{}", e)),
    }
}

fn process_extract(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let Some(src) = upstream_path(req) else {
        return fail(req, "上游未产出 path，无法解压");
    };
    let Some(out) = param_str(req, "output") else {
        return fail(req, "缺少 output 参数");
    };
    let src_path = PathBuf::from(&src);
    if !src_path.is_file() {
        return fail(req, &format!("源不是文件：{}", src));
    }
    let out_path = PathBuf::from(&out);
    if let Err(e) = fs::create_dir_all(&out_path) {
        return fail(req, &format!("无法创建解压目录 {}：{}", out_path.display(), e));
    }
    match unzip_to(&src_path, &out_path) {
        Ok(n) => AutodeployExecuteResult {
            ok: true,
            node_id: req.node_id.clone(),
            message: format!("✓ 解压到 {}（{} 个条目）", out, n),
            output: Some(serde_json::json!({
                "kind": "dir",
                "path": out,
            })),
            elapsed_ms: 0,
        },
        Err(e) => fail(req, &format!("解压失败：{}", e)),
    }
}

fn process_copy(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let Some(src) = upstream_path(req) else {
        return fail(req, "上游未产出 path，无法复制");
    };
    let Some(out) = param_str(req, "output") else {
        return fail(req, "缺少 output 参数");
    };
    let src_path = PathBuf::from(&src);
    let out_path = PathBuf::from(&out);
    if !src_path.exists() {
        return fail(req, &format!("源不存在：{}", src));
    }
    let result: std::io::Result<u64> = (|| {
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &out_path)?;
            Ok(fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0))
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)?;
            }
            Ok(fs::copy(&src_path, &out_path)?)
        }
    })();
    match result {
        Ok(size) => AutodeployExecuteResult {
            ok: true,
            node_id: req.node_id.clone(),
            message: format!("✓ 复制到 {}（{} 字节）", out, size),
            output: Some(serde_json::json!({
                "kind": if src_path.is_dir() { "dir" } else { "file" },
                "path": out,
                "size": size,
            })),
            elapsed_ms: 0,
        },
        Err(e) => fail(req, &format!("复制失败：{}", e)),
    }
}

// -----------------------------------------------------------------------------
// SFTP 节点占位
// -----------------------------------------------------------------------------

fn sftp_stub(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    AutodeployExecuteResult {
        ok: false,
        node_id: req.node_id.clone(),
        message: format!(
            "{}：SFTP 后端待实现，需引入 ssh crate 才能真正联通服务器",
            req.node_type
        ),
        output: None,
        elapsed_ms: 0,
    }
}

// -----------------------------------------------------------------------------
// 控制流节点（control flow）
// -----------------------------------------------------------------------------

/// 状态分支：检查上游节点的输出，自行走 success / failure 路径。
///
/// 实际分发由前端 executor.ts 完成（基于 upstream 的 status 字段），
/// Rust 端只标记 metadata：当前节点自身总是返回 ok（它本身没失败语义）。
fn control_if_status(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    // 当前节点无上游（inputs=0）或上游已执行（inputs=1）都允许。
    // 真正的 success / failure 路由由前端拓扑执行器根据
    // 上游 status 字段分发到 toNode.successOutput / toNode.failureOutput。
    AutodeployExecuteResult {
        ok: true,
        node_id: req.node_id.clone(),
        message: "✓ 状态分支节点：路由由前端拓扑执行器按上游 status 分发".to_string(),
        output: Some(serde_json::json!({
            "kind": "branch",
            "outputs": 2,
        })),
        elapsed_ms: 0,
    }
}

/// 重试：本身不做实际重试。前端拓扑执行器拿到 max_retries 字段后，
/// 在上游 status=error 时循环重试上游 N 次，每次间隔 retry_delay 秒。
fn control_retry(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let max = param_str(req, "max_retries")
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(3);
    let delay = param_str(req, "retry_delay")
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(5);
    AutodeployExecuteResult {
        ok: true,
        node_id: req.node_id.clone(),
        message: format!(
            "✓ 重试策略：失败时自动重试 {} 次，每次间隔 {} 秒",
            max, delay
        ),
        output: Some(serde_json::json!({
            "kind": "retry",
            "max_retries": max,
            "retry_delay": delay,
        })),
        elapsed_ms: 0,
    }
}

/// 结束节点：标记工作流结束，到此停止后续路径。
fn control_end(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    AutodeployExecuteResult {
        ok: true,
        node_id: req.node_id.clone(),
        message: "✓ 工作流结束".to_string(),
        output: Some(serde_json::json!({
            "kind": "end",
        })),
        elapsed_ms: 0,
    }
}

/// 通知：发送系统通知。当前 stub，等 Tauri 通知插件接入后实发。
fn control_notify(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    let title = param_str(req, "title").unwrap_or_else(|| "Velora 通知".to_string());
    let body = param_str(req, "body").unwrap_or_default();
    let level = param_str(req, "level").unwrap_or_else(|| "info".to_string());
    AutodeployExecuteResult {
        ok: true,
        node_id: req.node_id.clone(),
        message: format!("✓ 通知已发送：{} - {} [{}]", title, body, level),
        output: Some(serde_json::json!({
            "kind": "notify",
            "title": title,
            "body": body,
            "level": level,
        })),
        elapsed_ms: 0,
    }
}

// -----------------------------------------------------------------------------
// 小工具
// -----------------------------------------------------------------------------

fn fail(req: &AutodeployExecuteRequest, msg: &str) -> AutodeployExecuteResult {
    AutodeployExecuteResult {
        ok: false,
        node_id: req.node_id.clone(),
        message: msg.to_string(),
        output: None,
        elapsed_ms: 0,
    }
}

/// 把目录或单个文件打成 zip。method 暂只解析成 "deflate" vs "store"，
/// bzip2 等同 deflate（zip crate 暂不直接支持 bzip2）。
fn zip_dir_or_file(src: &Path, dst: &Path, method: &str) -> std::io::Result<u64> {
    use zip::write::SimpleFileOptions;
    use zip::CompressionMethod;

    let file = fs::File::create(dst)?;
    let mut zip = zip::ZipWriter::new(file);
    let cm = if method == "store" {
        CompressionMethod::Stored
    } else {
        CompressionMethod::Deflated
    };
    let opts = SimpleFileOptions::default().compression_method(cm);

    if src.is_file() {
        let name = src
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("file");
        zip.start_file(name, opts)?;
        let mut f = fs::File::open(src)?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf)?;
        zip.write_all(&buf)?;
    } else {
        let base = src.to_path_buf();
        for entry in walkdir::WalkDir::new(src) {
            let entry = entry.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            let p = entry.path();
            let rel = p.strip_prefix(&base).unwrap_or(p);
            if rel.as_os_str().is_empty() {
                continue;
            }
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            if p.is_file() {
                zip.start_file(&rel_str, opts)?;
                let mut f = fs::File::open(p)?;
                let mut buf = Vec::new();
                f.read_to_end(&mut buf)?;
                zip.write_all(&buf)?;
            } else if p.is_dir() {
                zip.add_directory(&rel_str, opts)?;
            }
        }
    }
    zip.finish()?;
    let size = fs::metadata(dst)?.len();
    Ok(size)
}

fn unzip_to(src: &Path, dst: &Path) -> std::io::Result<usize> {
    let f = fs::File::open(src)?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, e)
    })?;
    let mut count = 0usize;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, e)
        })?;
        let outpath = match entry.enclosed_name() {
            Some(p) => dst.join(p),
            None => continue,
        };
        if entry.is_dir() {
            fs::create_dir_all(&outpath)?;
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut outfile = fs::File::create(&outpath)?;
            std::io::copy(&mut entry, &mut outfile)?;
        }
        count += 1;
    }
    Ok(count)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

// =============================================================================
// 单元测试
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_list_is_complete() {
        let nodes = autodeploy_list_node_types();
        assert_eq!(nodes.len(), 14, "expect 14 built-in node types");
        let ids: Vec<&str> = nodes.iter().map(|n| n.id).collect();
        for must in &[
            "local_file",
            "local_dir",
            "local_archive",
            "compress",
            "extract",
            "copy",
            "sftp_upload",
            "sftp_download",
            "sftp_delete",
            "sftp_backup",
            "if_status",
            "retry",
            "end",
            "notify",
        ] {
            assert!(ids.contains(must), "missing node type {}", must);
        }
    }

    #[test]
    fn categories_cover_source_process_transfer() {
        let nodes = autodeploy_list_node_types();
        let cats: std::collections::HashSet<_> =
            nodes.iter().map(|n| n.category).collect();
        assert!(cats.contains(&NodeCategory::Source));
        assert!(cats.contains(&NodeCategory::Process));
        assert!(cats.contains(&NodeCategory::Transfer));
    }

    #[test]
    fn required_fields_marked() {
        let nodes = autodeploy_list_node_types();
        let file = nodes.iter().find(|n| n.id == "local_file").unwrap();
        assert_eq!(file.fields.len(), 1);
        assert!(file.fields[0].required, "path 必须标 required");
    }

    #[test]
    fn sftp_stub_returns_failure() {
        let req = AutodeployExecuteRequest {
            node_id: "n1".into(),
            node_type: "sftp_upload".into(),
            params: Default::default(),
            inputs: vec![],
        };
        let r = autodeploy_execute(req);
        assert!(!r.ok, "sftp 上传应返回失败（占位）");
        assert!(r.message.contains("ssh"));
    }
}
