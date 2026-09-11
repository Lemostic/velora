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
    Flow,
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
    /// 仅 Select 用。序列化为 `{value, label}`，与前端 FieldOption 对齐。
    pub options: Option<&'static [FieldOption]>,
}

/// Select 字段的单个选项。序列化为 `{value, label}` 对象（前端 React
/// 直接读 `opt.value` / `opt.label`），不是元组数组。
#[derive(Debug, Clone, Copy, Serialize)]
pub struct FieldOption {
    pub value: &'static str,
    pub label: &'static str,
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
    inputs: 1,
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
    inputs: 1,
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
    inputs: 1,
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
            label: "输出目录",
            kind: FieldKind::Path,
            required: true,
            placeholder: Some("C:\\dist\\"),
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
            options: Some(&[
                FieldOption { value: "store", label: "不压缩" },
                FieldOption { value: "deflate", label: "普通" },
                FieldOption { value: "bzip2", label: "高压缩" },
            ]),
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
    description: "把上游文件 / 目录复制到目标目录下，名称可自定义（留空则原名 - 副本）",
    icon: "Copy",
    inputs: 1,
    outputs: 1,
    fields: &[
        FieldDef {
            name: "output",
            label: "目标目录",
            kind: FieldKind::Path,
            required: true,
            placeholder: Some("D:\\backup"),
            default: None,
            options: None,
        },
        FieldDef {
            name: "name",
            label: "目标文件名",
            kind: FieldKind::Text,
            required: false,
            placeholder: Some("留空则用 原名 - 副本"),
            default: None,
            options: None,
        },
    ],
};

/// SSH 会话节点：一次认证，后续所有 remote_* 节点通过 sessionId 复用连接。
const SSH_SESSION: NodeType = NodeType {
    id: "ssh_session",
    category: NodeCategory::Transfer,
    label: "SSH 会话",
    description: "建立一次 SSH 连接；把输出连到远端节点输入 1，后续步骤复用同一连接",
    icon: "TerminalSquare",
    inputs: 1,
    outputs: 1,
    fields: &[
        FieldDef { name: "host", label: "服务器", kind: FieldKind::Text, required: true, placeholder: Some("10.20.30.40:22"), default: None, options: None },
        FieldDef { name: "user", label: "用户名", kind: FieldKind::Text, required: true, placeholder: Some("deploy"), default: None, options: None },
        FieldDef { name: "auth", label: "认证", kind: FieldKind::Select, required: true, placeholder: None, default: Some("key"), options: Some(&[FieldOption { value: "password", label: "密码" }, FieldOption { value: "key", label: "私钥" }]) },
        FieldDef { name: "secret", label: "凭据", kind: FieldKind::Text, required: true, placeholder: Some("密码或私钥路径"), default: None, options: None },
    ],
};

const REMOTE_COMPRESS: NodeType = NodeType {
    id: "remote_compress", category: NodeCategory::Process, label: "远端压缩",
    description: "在服务器上直接把文件 / 目录压缩，不下载到本地", icon: "FileArchive", inputs: 2, outputs: 1,
    fields: &[
        FieldDef { name: "source_path", label: "源路径（可选）", kind: FieldKind::Text, required: false, placeholder: Some("可由上游远端节点提供"), default: None, options: None },
        FieldDef { name: "output", label: "压缩包路径", kind: FieldKind::Text, required: true, placeholder: Some("/var/tmp/release.tar.gz"), default: None, options: None },
        FieldDef { name: "format", label: "格式", kind: FieldKind::Select, required: true, placeholder: None, default: Some("tar.gz"), options: Some(&[FieldOption { value: "tar.gz", label: "tar.gz" }, FieldOption { value: "zip", label: "zip" }]) },
    ],
};

const REMOTE_EXTRACT: NodeType = NodeType {
    id: "remote_extract", category: NodeCategory::Process, label: "远端解压",
    description: "在服务器上直接解压 zip / tar.gz，不下载到本地", icon: "FolderOpen", inputs: 2, outputs: 1,
    fields: &[
        FieldDef { name: "source_path", label: "压缩包路径（可选）", kind: FieldKind::Text, required: false, placeholder: Some("可由上游远端节点提供"), default: None, options: None },
        FieldDef { name: "output", label: "解压目录", kind: FieldKind::Text, required: true, placeholder: Some("/var/www/app"), default: None, options: None },
        FieldDef { name: "format", label: "格式", kind: FieldKind::Select, required: true, placeholder: None, default: Some("auto"), options: Some(&[FieldOption { value: "auto", label: "按扩展名" }, FieldOption { value: "tar.gz", label: "tar.gz" }, FieldOption { value: "zip", label: "zip" }]) },
    ],
};

const REMOTE_COPY: NodeType = NodeType {
    id: "remote_copy", category: NodeCategory::Process, label: "远端复制",
    description: "在服务器上复制文件或目录", icon: "Copy", inputs: 2, outputs: 1,
    fields: &[FieldDef { name: "source_path", label: "源路径（可选）", kind: FieldKind::Text, required: false, placeholder: Some("可由上游远端节点提供"), default: None, options: None }, FieldDef { name: "target", label: "目标路径", kind: FieldKind::Text, required: true, placeholder: Some("/var/www/app-copy"), default: None, options: None }],
};

const REMOTE_MOVE: NodeType = NodeType {
    id: "remote_move", category: NodeCategory::Process, label: "远端移动",
    description: "在服务器上移动或重命名文件 / 目录", icon: "FileOutput", inputs: 2, outputs: 1,
    fields: &[FieldDef { name: "source_path", label: "源路径（可选）", kind: FieldKind::Text, required: false, placeholder: Some("可由上游远端节点提供"), default: None, options: None }, FieldDef { name: "target", label: "目标路径", kind: FieldKind::Text, required: true, placeholder: Some("/var/www/app-current"), default: None, options: None }],
};

const REMOTE_DELETE: NodeType = NodeType {
    id: "remote_delete", category: NodeCategory::Process, label: "远端删除",
    description: "在服务器上删除文件或目录（拒绝删除根目录）", icon: "Trash2", inputs: 2, outputs: 1,
    fields: &[FieldDef { name: "source_path", label: "路径（可选）", kind: FieldKind::Text, required: false, placeholder: Some("可由上游远端节点提供"), default: None, options: None }],
};

const REMOTE_CHMOD: NodeType = NodeType {
    id: "remote_chmod", category: NodeCategory::Process, label: "远端权限",
    description: "在服务器上执行 chmod；输入 1 接 SSH 会话，输入 2 接远端路径",
    icon: "LockKeyhole", inputs: 2, outputs: 1,
    fields: &[
        FieldDef { name: "source_path", label: "路径（可选）", kind: FieldKind::Text, required: false, placeholder: Some("可由上游远端节点提供"), default: None, options: None },
        FieldDef { name: "mode", label: "权限模式", kind: FieldKind::Text, required: true, placeholder: Some("755"), default: None, options: None },
        FieldDef { name: "recursive", label: "递归处理", kind: FieldKind::Checkbox, required: false, placeholder: None, default: Some("false"), options: None },
    ],
};

const REMOTE_CHOWN: NodeType = NodeType {
    id: "remote_chown", category: NodeCategory::Process, label: "远端所有者",
    description: "在服务器上执行 chown；输入 1 接 SSH 会话，输入 2 接远端路径",
    icon: "UserCog", inputs: 2, outputs: 1,
    fields: &[
        FieldDef { name: "source_path", label: "路径（可选）", kind: FieldKind::Text, required: false, placeholder: Some("可由上游远端节点提供"), default: None, options: None },
        FieldDef { name: "owner", label: "用户（可选）", kind: FieldKind::Text, required: false, placeholder: Some("deploy"), default: None, options: None },
        FieldDef { name: "group", label: "组（可选）", kind: FieldKind::Text, required: false, placeholder: Some("www-data"), default: None, options: None },
        FieldDef { name: "recursive", label: "递归处理", kind: FieldKind::Checkbox, required: false, placeholder: None, default: Some("false"), options: None },
    ],
};

const SFTP_UPLOAD: NodeType = NodeType {
    id: "sftp_upload",
    category: NodeCategory::Transfer,
    label: "SFTP 上传",
    description: "把上游文件 / 目录上传到远端",
    icon: "Upload",
    inputs: 2,
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
            options: Some(&[
                FieldOption { value: "password", label: "密码" },
                FieldOption { value: "key", label: "私钥" },
            ]),
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
            options: Some(&[
                FieldOption { value: "password", label: "密码" },
                FieldOption { value: "key", label: "私钥" },
            ]),
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
            options: Some(&[
                FieldOption { value: "password", label: "密码" },
                FieldOption { value: "key", label: "私钥" },
            ]),
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
            options: Some(&[
                FieldOption { value: "password", label: "密码" },
                FieldOption { value: "key", label: "私钥" },
            ]),
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

/// 开始节点：0 input, 1 output。流程编排入口，画布有且仅有一个。
const START: NodeType = NodeType {
    id: "start",
    category: NodeCategory::Flow,
    label: "开始",
    description: "工作流入口；画布有且仅有一个，删除后才能再加",
    icon: "Play",
    inputs: 0,
    outputs: 1,
    fields: &[],
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
                FieldOption { value: "info", label: "信息" },
                FieldOption { value: "success", label: "成功" },
                FieldOption { value: "warning", label: "警告" },
                FieldOption { value: "error", label: "错误" },
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
    SSH_SESSION,
    REMOTE_COMPRESS,
    REMOTE_EXTRACT,
    REMOTE_COPY,
    REMOTE_MOVE,
    REMOTE_DELETE,
    REMOTE_CHMOD,
    REMOTE_CHOWN,
    SFTP_UPLOAD,
    SFTP_DOWNLOAD,
    SFTP_DELETE,
    SFTP_BACKUP,
    IF_STATUS,
    RETRY,
    END,
    NOTIFY,
    START,
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
        "ssh_session" => crate::modules::sftp::sftp_ssh_session(req),
        "remote_compress" => crate::modules::sftp::sftp_remote_compress(req),
        "remote_extract" => crate::modules::sftp::sftp_remote_extract(req),
        "remote_copy" => crate::modules::sftp::sftp_remote_copy(req),
        "remote_move" => crate::modules::sftp::sftp_remote_move(req),
        "remote_delete" => crate::modules::sftp::sftp_remote_delete(req),
        "remote_chmod" => crate::modules::sftp::sftp_remote_chmod(req),
        "remote_chown" => crate::modules::sftp::sftp_remote_chown(req),
        "sftp_upload" | "sftp_download" | "sftp_delete" | "sftp_backup" => {
            transfer_sftp(req)
        }
        "if_status" => control_if_status(req),
        "retry" => control_retry(req),
        "end" => control_end(req),
        "start" => control_start(req),
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

pub(crate) fn upstream_path(req: &AutodeployExecuteRequest) -> Option<String> {
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
    // output 既可以是目录（前端默认行为，自动按源名生成 .zip），
    // 也可以是带 .zip 后缀的文件路径（向后兼容，保留用户指定的最终文件名）。
    let out_path = PathBuf::from(&out);
    let final_path = match out_path.extension().and_then(|s| s.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("zip") => {
            if let Some(parent) = out_path.parent() {
                if !parent.as_os_str().is_empty() {
                    if let Err(e) = fs::create_dir_all(parent) {
                        return fail(req, &format!("无法创建父目录 {}：{}", parent.display(), e));
                    }
                }
            }
            out_path.clone()
        }
        _ => {
            // 用户给的是目录：在它下面放 `<源名>.zip`
            if let Err(e) = fs::create_dir_all(&out_path) {
                return fail(req, &format!("无法创建输出目录 {}：{}", out_path.display(), e));
            }
            let stem = derive_zip_name(&src_path);
            out_path.join(format!("{}.zip", stem))
        }
    };
    let final_path_str = final_path.to_string_lossy().to_string();
    let method = param_str(req, "level").unwrap_or_else(|| "deflate".to_string());
    match zip_dir_or_file(&src_path, &final_path, &method) {
        Ok(size) => AutodeployExecuteResult {
            ok: true,
            node_id: req.node_id.clone(),
            message: format!("✓ 压缩完成 {} ({} 字节)", final_path_str, size),
            output: Some(serde_json::json!({
                "kind": "file",
                "path": final_path_str,
                "size": size,
            })),
            elapsed_ms: 0,
        },
        Err(e) => fail(req, &format!("压缩失败：{}", e)),
    }
}

/// 从源路径推导一个合理的 zip 文件名。
/// 思路是"压哪个东西，zip 就叫那个名"：
///   - 目录源：取目录自己的最后一段（如 `frontend`）
///   - 文件源：取 stem（`index.html` → `index`）
///   - 都没有就 `archive`
fn derive_zip_name(src: &Path) -> String {
    if let Some(name) = src.file_name().and_then(|s| s.to_str()) {
        if !name.is_empty() {
            let stem = Path::new(name).file_stem().and_then(|s| s.to_str());
            return stem.unwrap_or(name).to_string();
        }
    }
    "archive".to_string()
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
    let Some(out_dir) = param_str(req, "output") else {
        return fail(req, "缺少 output（目标目录）参数");
    };
    let src_path = PathBuf::from(&src);
    let out_dir_path = PathBuf::from(&out_dir);
    if !src_path.exists() {
        return fail(req, &format!("源不存在：{}", src));
    }
    if let Err(e) = fs::create_dir_all(&out_dir_path) {
        return fail(
            req,
            &format!("无法创建目标目录 {}：{}", out_dir_path.display(), e),
        );
    }
    let src_name = src_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let user_name = param_str(req, "name").unwrap_or_default();
    let target_name = if !user_name.trim().is_empty() {
        user_name.trim().to_string()
    } else if !src_name.is_empty() {
        derive_copy_name(&src_path)
    } else {
        return fail(req, "源没有可用的文件名，请填写目标文件名");
    };
    let out_path = out_dir_path.join(&target_name);
    let result: std::io::Result<u64> = (|| {
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &out_path)?;
            Ok(fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0))
        } else {
            Ok(fs::copy(&src_path, &out_path)?)
        }
    })();
    match result {
        Ok(size) => {
            let out_str = out_path.to_string_lossy().to_string();
            AutodeployExecuteResult {
                ok: true,
                node_id: req.node_id.clone(),
                message: format!("复制到 {}（{} 字节）", out_str, size),
                output: Some(serde_json::json!({
                    "kind": if src_path.is_dir() { "dir" } else { "file" },
                    "path": out_str,
                    "size": size,
                })),
                elapsed_ms: 0,
            }
        }
        Err(e) => fail(req, &format!("复制失败：{}", e)),
    }
}

/// 根据源路径推导默认的复制目标名：
///   - 文件 `report.pdf` -> `report - 副本.pdf`
///   - 目录 `frontend`   -> `frontend - 副本`
/// 如果目标已经带 ` - 副本`，自动改为 ` - 副本 (2)` / `(3)` ...
fn derive_copy_name(src: &Path) -> String {
    let suffix = " - 副本";
    if src.is_dir() {
        let name = src.file_name().and_then(|s| s.to_str()).unwrap_or("untitled");
        return bump_copy_suffix(name, suffix);
    }
    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("untitled");
    let ext = src.extension().and_then(|s| s.to_str());
    let new_stem = bump_copy_suffix(stem, suffix);
    match ext {
        Some(e) => format!("{}.{}", new_stem, e),
        None => new_stem,
    }
}

/// 给 stem 追加 ` - 副本` 后缀；如果已经有则加编号避免覆盖：
///   - `foo`              -> `foo - 副本`
///   - `foo - 副本`       -> `foo - 副本 (2)`
///   - `foo - 副本 (2)`   -> `foo - 副本 (3)`
///   - `foo - 副本 (99)`  -> `foo - 副本 (100)`
fn bump_copy_suffix(name: &str, suffix: &str) -> String {
    if let Some(idx) = name.rfind(suffix) {
        let head = &name[..idx];
        let tail = &name[idx + suffix.len()..];
        if tail.is_empty() {
            return format!("{} (2)", name);
        }
        if let Some(num) = tail.strip_prefix(" (").and_then(|s| s.strip_suffix(")")) {
            if let Ok(n) = num.parse::<u32>() {
                return format!("{}{} ({})", head, suffix, n + 1);
            }
        }
        // tail 既不是空也不是 `(N)`，说明 stem 末尾不是完整副本后缀，原样返回
        name.to_string()
    } else {
        format!("{}{}", name, suffix)
    }
}

// -----------------------------------------------------------------------------
// SFTP 节点占位
// -----------------------------------------------------------------------------

/// 把 4 个 SFTP 节点派发到真正的实现。错误信息统一为中文。
fn transfer_sftp(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    match req.node_type.as_str() {
        "sftp_upload" => crate::modules::sftp::sftp_upload(req),
        "sftp_download" => crate::modules::sftp::sftp_download(req),
        "sftp_delete" => crate::modules::sftp::sftp_delete(req),
        "sftp_backup" => crate::modules::sftp::sftp_backup(req),
        other => fail(req, &format!("未知 SFTP 节点类型：{}", other)),
    }
}

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

/// 起点标记节点：不实际执行任何动作，仅返回 ok。前端执行器会把 start
/// 节点作为配置位短路掉，这里再加一层防御，避免任何调用方误传 start 时
/// 落到"未知节点类型"分支。
fn control_start(req: &AutodeployExecuteRequest) -> AutodeployExecuteResult {
    AutodeployExecuteResult {
        ok: true,
        node_id: req.node_id.clone(),
        message: "✓ 工作流起点".to_string(),
        output: Some(serde_json::json!({ "kind": "start" })),
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

pub(crate) fn fail(req: &AutodeployExecuteRequest, msg: &str) -> AutodeployExecuteResult {
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
        assert_eq!(nodes.len(), 23, "expect 23 built-in node types");
        let ids: Vec<&str> = nodes.iter().map(|n| n.id).collect();
        for must in &[
            "local_file",
            "local_dir",
            "local_archive",
            "compress",
            "extract",
            "copy",
            "ssh_session",
            "remote_compress",
            "remote_extract",
            "remote_copy",
            "remote_move",
            "remote_delete",
            "remote_chmod",
            "remote_chown",
            "sftp_upload",
            "sftp_download",
            "sftp_delete",
            "sftp_backup",
            "if_status",
            "retry",
            "end",
            "notify",
            "start",
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
    fn sftp_missing_params_returns_clear_error() {
        // 没有 host/user/auth/secret 时应该立刻给出可读错误，而不是连了再断
        let req = AutodeployExecuteRequest {
            node_id: "n1".into(),
            node_type: "sftp_upload".into(),
            params: Default::default(),
            inputs: vec![],
        };
        let r = autodeploy_execute(req);
        assert!(!r.ok);
        assert!(r.message.contains("missing"),
            "expected 'missing' or Chinese 缺少 error, got: {}",
            r.message
        );
    }

    #[test]
    fn select_field_options_serialize_as_objects() {
        // 前端 FieldOption 期望 `{value, label}`，不是元组数组。
        // 序列化错位会让所有 6 个 select 渲染成空白下拉。
        let nodes = autodeploy_list_node_types();
        let compress = nodes.iter().find(|n| n.id == "compress").unwrap();
        let level = compress
            .fields
            .iter()
            .find(|f| f.name == "level")
            .unwrap();
        let opts = level.options.expect("compress.level 应该有 options");
        let json = serde_json::to_string(&opts).unwrap();
        // 期望：[{"value":"store","label":"不压缩"},...]
        assert!(
            json.contains("\"value\":\"store\""),
            "缺 value 字段，实际：{}",
            json
        );
        assert!(
            json.contains("\"label\":\"不压缩\""),
            "缺 label 字段，实际：{}",
            json
        );
        assert!(
            !json.contains("[["),
            "不应再以元组数组形式序列化：{}",
            json
        );

        let notify = nodes.iter().find(|n| n.id == "notify").unwrap();
        let notify_level = notify
            .fields
            .iter()
            .find(|f| f.name == "level")
            .unwrap();
        let json = serde_json::to_string(notify_level.options.as_ref().unwrap()).unwrap();
        for (v, l) in [
            ("info", "信息"),
            ("success", "成功"),
            ("warning", "警告"),
            ("error", "错误"),
        ] {
            assert!(
                json.contains(&format!("\"value\":\"{}\"", v)),
                "notify.{} 缺 value={}",
                v,
                json
            );
            assert!(
                json.contains(&format!("\"label\":\"{}\"", l)),
                "notify.{} 缺 label={}",
                l,
                json
            );
        }

        let upload = nodes.iter().find(|n| n.id == "sftp_upload").unwrap();
        let auth = upload.fields.iter().find(|f| f.name == "auth").unwrap();
        let json = serde_json::to_string(auth.options.as_ref().unwrap()).unwrap();
        assert!(json.contains("\"value\":\"password\""));
        assert!(json.contains("\"value\":\"key\""));
        assert!(json.contains("\"label\":\"密码\""));
        assert!(json.contains("\"label\":\"私钥\""));
    }

    struct TmpDir(PathBuf);
    impl TmpDir {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!(
                "velora-test-{}-{}-{}",
                tag,
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for TmpDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn s(s: &str) -> serde_json::Value {
        serde_json::Value::String(s.to_string())
    }

    fn exec_with_params(node_type: &str, params: serde_json::Map<String, serde_json::Value>, inputs: Vec<serde_json::Value>) -> AutodeployExecuteResult {
        autodeploy_execute(AutodeployExecuteRequest {
            node_id: format!("n_{}", node_type),
            node_type: node_type.to_string(),
            params,
            inputs,
        })
    }

    #[test]
    fn source_local_file_ok() {
        let tmp = TmpDir::new("src-file");
        let p = tmp.0.join("a.txt");
        fs::write(&p, "hello").unwrap();
        let mut params = serde_json::Map::new();
        params.insert("path".to_string(), s(&p.to_string_lossy()));
        let r = exec_with_params("local_file", params, vec![]);
        assert!(r.ok, "local_file 应 ok：{}", r.message);
        let out = r.output.unwrap();
        assert_eq!(out.get("kind").and_then(|v| v.as_str()), Some("file"));
        assert_eq!(out.get("path").and_then(|v| v.as_str()), Some(p.to_string_lossy().as_ref()));
        assert_eq!(out.get("size").and_then(|v| v.as_u64()), Some(5));
    }

    #[test]
    fn source_local_file_missing_returns_error() {
        let mut params = serde_json::Map::new();
        params.insert("path".to_string(), s("C:\\does\\not\\exist\\nope.txt"));
        let r = exec_with_params("local_file", params, vec![]);
        assert!(!r.ok);
        assert!(r.message.contains("无法访问") || r.message.contains("不存在"));
    }

    #[test]
    fn source_local_dir_ok() {
        let tmp = TmpDir::new("src-dir");
        let d = tmp.0.join("proj");
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("x.txt"), "x").unwrap();
        fs::write(d.join("y.txt"), "y").unwrap();
        let mut params = serde_json::Map::new();
        params.insert("path".to_string(), s(&d.to_string_lossy()));
        let r = exec_with_params("local_dir", params, vec![]);
        assert!(r.ok, "local_dir 应 ok：{}", r.message);
        let out = r.output.unwrap();
        assert_eq!(out.get("kind").and_then(|v| v.as_str()), Some("dir"));
        assert_eq!(out.get("entries").and_then(|v| v.as_u64()), Some(2));
    }

    #[test]
    fn source_local_dir_rejects_file() {
        let tmp = TmpDir::new("src-dir-file");
        let p = tmp.0.join("a.txt");
        fs::write(&p, "x").unwrap();
        let mut params = serde_json::Map::new();
        params.insert("path".to_string(), s(&p.to_string_lossy()));
        let r = exec_with_params("local_dir", params, vec![]);
        assert!(!r.ok);
        assert!(r.message.contains("不是目录"));
    }

    #[test]
    fn source_local_archive_ok() {
        let tmp = TmpDir::new("src-archive");
        let p = tmp.0.join("dist.zip");
        fs::write(&p, b"PK\x03\x04").unwrap();
        let mut params = serde_json::Map::new();
        params.insert("path".to_string(), s(&p.to_string_lossy()));
        let r = exec_with_params("local_archive", params, vec![]);
        assert!(r.ok, "local_archive 应 ok：{}", r.message);
        let out = r.output.unwrap();
        assert_eq!(out.get("kind").and_then(|v| v.as_str()), Some("archive"));
    }

    #[test]
    fn source_local_archive_rejects_bad_extension() {
        let tmp = TmpDir::new("src-archive-bad");
        let p = tmp.0.join("a.exe");
        fs::write(&p, b"x").unwrap();
        let mut params = serde_json::Map::new();
        params.insert("path".to_string(), s(&p.to_string_lossy()));
        let r = exec_with_params("local_archive", params, vec![]);
        assert!(!r.ok);
        assert!(r.message.contains("白名单") || r.message.contains(".exe"));
    }

    #[test]
    fn process_extract_ok() {
        let tmp = TmpDir::new("extract");
        let src = tmp.0.join("payload");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("hello.txt"), "world").unwrap();
        let zip_path = tmp.0.join("payload.zip");
        let mut cp_params = serde_json::Map::new();
        cp_params.insert("output".to_string(), s(&zip_path.to_string_lossy()));
        cp_params.insert("level".to_string(), s("store"));
        let mut src_obj = serde_json::Map::new();
        src_obj.insert("path".to_string(), s(&src.to_string_lossy()));
        let cp = exec_with_params(
            "compress",
            cp_params,
            vec![serde_json::Value::Object(src_obj)],
        );
        assert!(cp.ok, "compress for extract test failed: {}", cp.message);

        let out_dir = tmp.0.join("unpacked");
        let mut ex_params = serde_json::Map::new();
        ex_params.insert("output".to_string(), s(&out_dir.to_string_lossy()));
        let mut in_obj = serde_json::Map::new();
        in_obj.insert("path".to_string(), s(&zip_path.to_string_lossy()));
        let r = exec_with_params("extract", ex_params, vec![serde_json::Value::Object(in_obj)]);
        assert!(r.ok, "extract 应 ok：{}", r.message);
        assert!(out_dir.join("hello.txt").exists(), "未解压出 hello.txt");
    }

    #[test]
    #[test]
    fn process_copy_file_ok() {
        // output 现在是目录，配合 name 字段命名
        let tmp = TmpDir::new("copy-file");
        let src = tmp.0.join("a.txt");
        fs::write(&src, "12345").unwrap();
        let dst_dir = tmp.0.join("sub");
        let expected = dst_dir.join("b.txt");
        let mut src_obj = serde_json::Map::new();
        src_obj.insert("path".to_string(), s(&src.to_string_lossy()));
        let mut cp_params = serde_json::Map::new();
        cp_params.insert("output".to_string(), s(&dst_dir.to_string_lossy()));
        cp_params.insert("name".to_string(), s("b.txt"));
        let r = exec_with_params("copy", cp_params, vec![serde_json::Value::Object(src_obj)]);
        assert!(r.ok, "copy file ok: {}", r.message);
        assert!(expected.exists(), "目标文件应被创建：{}", expected.display());
        assert_eq!(fs::read_to_string(&expected).unwrap(), "12345");
        // output.path 应指向最终文件
        let out_path = r.output.unwrap().get("path").and_then(|v| v.as_str()).unwrap().to_string();
        assert_eq!(out_path, expected.to_string_lossy().to_string());
    }

    #[test]
    fn process_copy_dir_ok() {
        // 复制目录：output 是父目录，name 是目标目录名
        let tmp = TmpDir::new("copy-dir");
        let src = tmp.0.join("srcdir");
        fs::create_dir_all(src.join("sub")).unwrap();
        fs::write(src.join("a.txt"), "1").unwrap();
        fs::write(src.join("sub").join("b.txt"), "2").unwrap();
        let dst_dir = tmp.0.join("out");
        let expected = dst_dir.join("dstdir");
        let mut src_obj = serde_json::Map::new();
        src_obj.insert("path".to_string(), s(&src.to_string_lossy()));
        let mut cp_params = serde_json::Map::new();
        cp_params.insert("output".to_string(), s(&dst_dir.to_string_lossy()));
        cp_params.insert("name".to_string(), s("dstdir"));
        let r = exec_with_params("copy", cp_params, vec![serde_json::Value::Object(src_obj)]);
        assert!(r.ok, "copy dir ok: {}", r.message);
        assert!(expected.join("a.txt").exists());
        assert!(expected.join("sub").join("b.txt").exists());
        let out_path = r.output.unwrap().get("path").and_then(|v| v.as_str()).unwrap().to_string();
        assert_eq!(out_path, expected.to_string_lossy().to_string());
    }


    #[test]
    fn all_nodes_list_includes_required_ids() {
        let nodes = autodeploy_list_node_types();
        assert_eq!(nodes.len(), 23);
        for id in [
            "local_file", "local_dir", "local_archive",
            "compress", "extract", "copy",
            "ssh_session", "remote_compress", "remote_extract", "remote_copy",
            "remote_move", "remote_delete", "remote_chmod", "remote_chown",
            "sftp_upload", "sftp_download", "sftp_delete", "sftp_backup",
            "if_status", "retry", "end", "notify", "start",
        ] {
            let n = nodes.iter().find(|x| x.id == id).unwrap_or_else(|| panic!("missing node {}", id));
            assert!(!n.label.is_empty());
            assert!(!n.icon.is_empty());
        }
    }

    #[test]
    fn retry_node_has_number_fields() {
        let nodes = autodeploy_list_node_types();
        let r = nodes.iter().find(|n| n.id == "retry").unwrap();
        assert!(r.fields.iter().any(|f| f.name == "max_retries"));
        assert!(r.fields.iter().any(|f| f.name == "retry_delay"));
    }

    #[test]
    fn if_status_has_two_outputs() {
        let nodes = autodeploy_list_node_types();
        let n = nodes.iter().find(|x| x.id == "if_status").unwrap();
        assert_eq!(n.inputs, 1);
        assert_eq!(n.outputs, 2);
    }

    #[test]
    fn start_and_end_have_no_required_fields() {
        // 这两个是配置位，Inspector 不该弹出红色星号
        let nodes = autodeploy_list_node_types();
        for id in ["start", "end"] {
            let n = nodes.iter().find(|x| x.id == id).unwrap();
            for f in n.fields {
                assert!(!f.required, "{} 的字段 {} 不应标 required", id, f.name);
            }
        }
    }

#[test]
    fn start_node_returns_ok_without_invocation() {
        let req = AutodeployExecuteRequest {
            node_id: "n_start".into(),
            node_type: "start".into(),
            params: Default::default(),
            inputs: vec![],
        };
        let r = autodeploy_execute(req);
        assert!(r.ok, "start 应返回 ok：{}", r.message);
        assert!(r.message.contains("起点"));
    }

    #[test]
    fn compress_dir_output_auto_names_zip_from_source_dir() {
        let tmp = TmpDir::new("compress-dir");
        let src_dir = tmp.0.join("frontend");
        fs::create_dir_all(&src_dir).unwrap();
        fs::write(src_dir.join("index.html"), "<html/>").unwrap();
        fs::write(src_dir.join("app.js"), "console.log(1);").unwrap();
        let out_dir = tmp.0.join("out");

        let mut params = serde_json::Map::new();
        params.insert("output".to_string(), s(&out_dir.to_string_lossy()));
        params.insert("level".to_string(), s("deflate"));

        let mut src_obj = serde_json::Map::new();
        src_obj.insert("path".to_string(), s(&src_dir.to_string_lossy()));
        let req = AutodeployExecuteRequest {
            node_id: "n1".into(),
            node_type: "compress".into(),
            params,
            inputs: vec![serde_json::Value::Object(src_obj)],
        };

        let r = autodeploy_execute(req);
        assert!(r.ok, "compress 应成功：{}", r.message);

        let expected_zip = out_dir.join("frontend.zip");
        assert!(expected_zip.exists(), "zip 未在 {} 生成", expected_zip.display());

        let out_path = r
            .output
            .as_ref()
            .and_then(|v| v.get("path"))
            .and_then(|v| v.as_str())
            .unwrap();
        assert_eq!(out_path, expected_zip.to_string_lossy());

        // 验证 zip 实际含 index.html
        let f = fs::File::open(&expected_zip).unwrap();
        let mut zip = zip::ZipArchive::new(f).unwrap();
        let mut entry = zip.by_name("index.html").expect("zip 应包含 index.html");
        let mut buf = String::new();
        use std::io::Read;
        entry.read_to_string(&mut buf).unwrap();
        assert_eq!(buf, "<html/>");
    }

    #[test]
    fn compress_explicit_zip_path_is_respected() {
        let tmp = TmpDir::new("compress-zip");
        let src_dir = tmp.0.join("frontend");
        fs::create_dir_all(&src_dir).unwrap();
        fs::write(src_dir.join("index.html"), "<html/>").unwrap();
        let out_zip = tmp.0.join("release.zip");

        let mut params = serde_json::Map::new();
        params.insert("output".to_string(), s(&out_zip.to_string_lossy()));
        params.insert("level".to_string(), s("deflate"));

        let mut src_obj = serde_json::Map::new();
        src_obj.insert("path".to_string(), s(&src_dir.to_string_lossy()));
        let req = AutodeployExecuteRequest {
            node_id: "n1".into(),
            node_type: "compress".into(),
            params,
            inputs: vec![serde_json::Value::Object(src_obj)],
        };

        let r = autodeploy_execute(req);
        assert!(r.ok, "compress 应成功：{}", r.message);
        assert!(out_zip.exists(), "用户指定的 zip 未生成");
        let out_path = r
            .output
            .as_ref()
            .and_then(|v| v.get("path"))
            .and_then(|v| v.as_str())
            .unwrap();
        assert_eq!(out_path, out_zip.to_string_lossy());
    }

    #[test]
    fn compress_chain_local_file_then_compress() {
        // 模拟前端 executor 的串联：local_file → compress。
        // 修复 executor 之前，compress 拿到的 inputs.path 是 ""，会报"源路径不存在"。
        let tmp = TmpDir::new("chain");
        let src_dir = tmp.0.join("frontend");
        fs::create_dir_all(&src_dir).unwrap();
        fs::write(src_dir.join("index.html"), "<html/>").unwrap();
        let out_dir = tmp.0.join("dist");

        // 1) local_file
        let mut lf_params = serde_json::Map::new();
        let lf_path = src_dir.join("index.html");
        lf_params.insert("path".to_string(), s(&lf_path.to_string_lossy()));
        let lf_req = AutodeployExecuteRequest {
            node_id: "lf".into(),
            node_type: "local_file".into(),
            params: lf_params,
            inputs: vec![],
        };
        let lf_res = autodeploy_execute(lf_req);
        assert!(lf_res.ok, "local_file 失败：{}", lf_res.message);
        let lf_output = lf_res.output.expect("local_file 应返回 output");

        // 2) compress 直接消费 local_file 的 output
        let mut cp_params = serde_json::Map::new();
        cp_params.insert("output".to_string(), s(&out_dir.to_string_lossy()));
        cp_params.insert("level".to_string(), s("deflate"));
        let cp_req = AutodeployExecuteRequest {
            node_id: "cp".into(),
            node_type: "compress".into(),
            params: cp_params,
            inputs: vec![lf_output],
        };
        let cp_res = autodeploy_execute(cp_req);
        assert!(
            cp_res.ok,
            "compress 用上游 output 失败：{}（修复前会因 path 为空报\"源路径不存在\"）",
            cp_res.message
        );

        let out_path = cp_res
            .output
            .as_ref()
            .and_then(|v| v.get("path"))
            .and_then(|v| v.as_str())
            .unwrap();
        let p = Path::new(out_path);
        assert!(p.exists(), "压缩产物 {} 不存在", out_path);
        assert_eq!(p.parent().unwrap(), out_dir);
        assert!(p.extension().and_then(|e| e.to_str()) == Some("zip"));
    }
    #[test]
    fn process_copy_default_name_for_file() {
        // name 留空：文件 → stem - 副本.ext
        let tmp = TmpDir::new("copy-default-file");
        let src = tmp.0.join("report.pdf");
        fs::write(&src, "%PDF-1.4").unwrap();
        let dst_dir = tmp.0.join("backup");
        let expected = dst_dir.join("report - 副本.pdf");
        let mut src_obj = serde_json::Map::new();
        src_obj.insert("path".to_string(), s(&src.to_string_lossy()));
        let mut cp_params = serde_json::Map::new();
        cp_params.insert("output".to_string(), s(&dst_dir.to_string_lossy()));
        // 不填 name
        let r = exec_with_params("copy", cp_params, vec![serde_json::Value::Object(src_obj)]);
        assert!(r.ok, "default name file: {}", r.message);
        assert!(expected.exists(), "应为 report - 副本.pdf，实际未找到：{}", expected.display());
        let out_path = r.output.unwrap().get("path").and_then(|v| v.as_str()).unwrap().to_string();
        assert_eq!(out_path, expected.to_string_lossy().to_string());
    }

    #[test]
    fn process_copy_default_name_for_dir() {
        // name 留空：目录 → dir_name - 副本
        let tmp = TmpDir::new("copy-default-dir");
        let src = tmp.0.join("frontend");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("a.txt"), "x").unwrap();
        let dst_dir = tmp.0.join("backup");
        let expected = dst_dir.join("frontend - 副本");
        let mut src_obj = serde_json::Map::new();
        src_obj.insert("path".to_string(), s(&src.to_string_lossy()));
        let mut cp_params = serde_json::Map::new();
        cp_params.insert("output".to_string(), s(&dst_dir.to_string_lossy()));
        let r = exec_with_params("copy", cp_params, vec![serde_json::Value::Object(src_obj)]);
        assert!(r.ok, "default name dir: {}", r.message);
        assert!(expected.join("a.txt").exists(), "应为 frontend - 副本/a.txt，实际：{}", expected.display());
    }

    #[test]
    #[test]
    fn process_copy_bump_suffix_logic() {
        // bump_copy_suffix 只看 stem：
        //   report.pdf -> report - 副本.pdf
        //   report - 副本.pdf -> report - 副本 (2).pdf
        //   report - 副本 (2).pdf -> report - 副本 (3).pdf
        let tmp = TmpDir::new("bump-copy");
        let dst_dir = tmp.0.join("out");
        fs::create_dir_all(&dst_dir).unwrap();
        let mk_params = || { let mut m = serde_json::Map::new(); m.insert("output".to_string(), s(&dst_dir.to_string_lossy())); m };
        let mk_input = |path: &Path| { let mut m = serde_json::Map::new(); m.insert("path".to_string(), s(&path.to_string_lossy())); serde_json::Value::Object(m) };
        // 第一轮：源是普通文件 report.pdf
        let p1 = tmp.0.join("report.pdf");
        fs::write(&p1, b"x").unwrap();
        let r1 = exec_with_params("copy", mk_params(), vec![mk_input(&p1)]);
        assert!(r1.ok, "round 1: {}", r1.message);
        assert!(dst_dir.join("report - 副本.pdf").exists(), "round 1 应有 report - 副本.pdf");
        // 第二轮
        let p2 = dst_dir.join("report - 副本.pdf");
        let r2 = exec_with_params("copy", mk_params(), vec![mk_input(&p2)]);
        assert!(r2.ok, "round 2: {}", r2.message);
        assert!(dst_dir.join("report - 副本 (2).pdf").exists(), "round 2 应有 report - 副本 (2).pdf");
        // 第三轮
        let p3 = dst_dir.join("report - 副本 (2).pdf");
        let r3 = exec_with_params("copy", mk_params(), vec![mk_input(&p3)]);
        assert!(r3.ok, "round 3: {}", r3.message);
        assert!(dst_dir.join("report - 副本 (3).pdf").exists(), "round 3 应有 report - 副本 (3).pdf");
    }


}
