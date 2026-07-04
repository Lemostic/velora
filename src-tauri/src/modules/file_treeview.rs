//! 文件树模块 — Rust 端命令实现
//!
//! `walkdir` 异步扫描本地目录，按深度限制 + 忽略规则裁剪后返回树形 JSON。
//! 前端用 `vite-plugin-react-window` 风格（手写，纵向虚拟化自己实现）渲染。
//!
//! 关注点：
//!   - 大目录保护：单次最多 50 000 个节点，超过截断并标记 `truncated`。
//!   - 忽略规则：`ignore_patterns` 是简单的 glob 片段（含 `*` / `**`），用
//!     fnmatch 风格匹配文件名或者相对路径段（不含正则，避免误伤）。
//!   - 路径分隔：始终使用 `/`（前端能直接当字符串显示），
//!     在 Windows 下做一次反斜杠 -> 斜杠归一化。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Deserialize)]
pub struct TreeRequest {
    /// 绝对路径
    pub root: String,
    /// 最大递归深度。0 = 不限；默认 8
    #[serde(default)]
    pub max_depth: u32,
    /// 是否跟随符号链接。默认 false
    #[serde(default)]
    pub follow_links: bool,
    /// 简单 glob 片段列表（`*.tmp`, `node_modules`, `.git` 等）
    #[serde(default)]
    pub ignore_patterns: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Node {
    /// 一个目录
    Dir {
        /// 相对 root 的路径（用 `/`）
        path: String,
        /// 文件名（最后一截）
        name: String,
        /// 子节点，懒加载：第一次只返回 1 层 + total 计数
        children: Vec<Node>,
        /// 该目录下未被截断的子节点总数（dir + file）
        total_descendants: u32,
    },
    /// 一个文件
    File {
        path: String,
        name: String,
        size: u64,
    },
}

#[derive(Debug, Serialize)]
pub struct TreeResult {
    pub root: String,
    pub nodes: Vec<Node>,
    /// 总计找到的文件/目录数
    pub total_count: u32,
    /// 是否因为 max_nodes 截断
    pub truncated: bool,
    pub max_nodes: usize,
}

const MAX_NODES: usize = 50_000;

#[tauri::command]
pub fn scan_tree(req: TreeRequest) -> Result<TreeResult, String> {
    let root = PathBuf::from(&req.root);
    if !root.exists() {
        return Err(format!("path does not exist: {}", req.root));
    }
    if !root.is_dir() {
        return Err(format!("path is not a directory: {}", req.root));
    }

    let max_depth = if req.max_depth == 0 {
        usize::MAX
    } else {
        req.max_depth as usize
    };

    // 第一遍：只收集文件条目（不构树），方便统计 + 截断。
    let mut entries: Vec<PathBuf> = Vec::new();
    for entry in WalkDir::new(&root)
        .follow_links(req.follow_links)
        .max_depth(max_depth)
        .into_iter()
        .filter_entry(|e| !should_ignore(e.path(), &req.ignore_patterns, &root))
        .filter_map(Result::ok)
    {
        if entries.len() >= MAX_NODES {
            break;
        }
        entries.push(entry.path().to_path_buf());
    }

    let truncated = entries.len() >= MAX_NODES;
    let total = entries.len() as u32;

    // 第二遍：构树到 1 层深度（不递归展开子目录）。
    let nodes = build_level1(&root, &entries);

    Ok(TreeResult {
        root: req.root,
        nodes,
        total_count: total,
        truncated,
        max_nodes: MAX_NODES,
    })
}

fn build_level1(root: &Path, entries: &[PathBuf]) -> Vec<Node> {
    // 收集第一层目录和直接文件
    let mut dirs: std::collections::BTreeMap<String, Vec<PathBuf>> =
        std::collections::BTreeMap::new();
    let mut direct_files: Vec<(String, u64)> = Vec::new();

    for p in entries {
        let rel = p.strip_prefix(root).unwrap_or(p);
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        // 只算 root 的第一层：rel 第一截若含分隔符就归到对应目录里
        if let Some(idx) = rel_str.find('/') {
            let dir_name = rel_str[..idx].to_string();
            dirs.entry(dir_name).or_default().push(p.clone());
        } else if let Some(meta) = std::fs::metadata(p).ok() {
            if meta.is_dir() {
                // 不太会发生（walkdir 已经把目录和文件都列了），略
                dirs.entry(rel_str).or_default();
            } else if meta.is_file() {
                direct_files.push((rel_str, meta.len()));
            }
        }
    }

    let mut out: Vec<Node> = Vec::new();

    for (name, _paths) in dirs {
        let dir_path = root.join(&name);
        let total_descendants = count_descendants(&dir_path);
        out.push(Node::Dir {
            path: name.clone(),
            name,
            children: vec![], // 懒加载：当前不展开
            total_descendants,
        });
    }
    for (name, size) in direct_files {
        out.push(Node::File {
            path: name.clone(),
            name,
            size,
        });
    }
    out
}

fn count_descendants(dir: &Path) -> u32 {
    WalkDir::new(dir)
        .max_depth(20) // hard cap; deep enough for practical use
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.depth() > 0)
        .count()
        .min(u32::MAX as usize) as u32
}

/// 简单的 ignore 匹配 —— 任一 pattern 命中文件名或者相对 root 的任意路径段
/// 即视为忽略。`*` 通配单层，`**` 不做特殊处理（fnmatch 不支持）。
fn should_ignore(p: &Path, patterns: &[String], root: &Path) -> bool {
    if patterns.is_empty() {
        return false;
    }
    let name = match p.file_name() {
        Some(n) => n.to_string_lossy(),
        None => return false,
    };
    let rel = p.strip_prefix(root).unwrap_or(p);
    let rel_str = rel.to_string_lossy().replace('\\', "/");
    for pat in patterns {
        // 1) 文件名匹配
        if fnmatch_simple(pat, &name) {
            return true;
        }
        // 2) 路径片段匹配（任意一段等于 pattern）
        for seg in rel_str.split('/') {
            if seg == pat || fnmatch_simple(pat, seg) {
                return true;
            }
        }
    }
    false
}

/// 自包含的简单 glob —— 只支持 `*`、`?`、字面字符。
/// 不依赖 fnmatch crate 以减少依赖。
fn fnmatch_simple(pat: &str, s: &str) -> bool {
    fn inner(pat: &[u8], s: &[u8]) -> bool {
        let mut pi = 0;
        let mut si = 0;
        let mut star: Option<usize> = None;
        let mut match_after_star = 0;
        while si < s.len() {
            if pi < pat.len() && pat[pi] == b'*' {
                star = Some(pi);
                match_after_star = si;
                pi += 1;
            } else if pi < pat.len() && (pat[pi] == b'?' || pat[pi] == s[si]) {
                pi += 1;
                si += 1;
            } else if let Some(sp) = star {
                pi = sp + 1;
                match_after_star += 1;
                si = match_after_star;
            } else {
                return false;
            }
        }
        while pi < pat.len() && pat[pi] == b'*' {
            pi += 1;
        }
        pi == pat.len()
    }
    inner(pat.as_bytes(), s.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnmatch_star_and_literal() {
        assert!(fnmatch_simple("*.tmp", "x.tmp"));
        assert!(fnmatch_simple("node_modules", "node_modules"));
        assert!(!fnmatch_simple("*.tmp", "x.txt"));
        assert!(fnmatch_simple("file?.log", "file1.log"));
    }
}
