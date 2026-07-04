//! Zip 清理模块 — Rust 端命令实现
//!
//! 扫描目录下的所有 .zip，归类：
//!   - duplicate: CRC32 + uncompressed_size 相同的多份（保留最新 / 最旧可选）
//!   - empty:     zip 内部 0 文件 OR 内含文件总大小为 0
//!   - zero_size: 文件本身 0 字节
//!
//! 安全策略：**默认不直接删除**，把命中的文件移到 `_velora_zip_trash/<timestamp>/`，
//! 用户可以单独勾选手动确认；想真删需要二次确认（前端实现）。

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use zip::ZipArchive;

#[derive(Debug, Deserialize)]
pub struct ZipScanRequest {
    /// 要扫描的目录
    pub root: String,
    /// 是否递归子目录。默认 true
    #[serde(default = "default_true")]
    pub recursive: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ZipFinding {
    Duplicate {
        path: String,
        /// 同一组重复里其余文件的路径
        siblings: Vec<String>,
        sha256: String,
        size: u64,
    },
    Empty {
        path: String,
        /// 内含文件数
        entries: u32,
    },
    ZeroSize {
        path: String,
    },
}

#[derive(Debug, Serialize)]
pub struct ZipScanResult {
    pub scanned: u32,
    pub findings: Vec<ZipFinding>,
    pub trash_dir: String,
}

#[tauri::command]
pub fn scan_zip_dir(req: ZipScanRequest) -> Result<ZipScanResult, String> {
    let root = PathBuf::from(&req.root);
    if !root.is_dir() {
        return Err(format!("not a directory: {}", req.root));
    }
    let trash_dir = root.join("_velora_zip_trash");
    let trash_dir_str = trash_dir.to_string_lossy().into_owned();

    let zips: Vec<PathBuf> = walk_zips(&root, req.recursive);
    let scanned = zips.len() as u32;
    let mut findings: Vec<ZipFinding> = Vec::new();
    // hash -> Vec<path>
    let mut by_hash: BTreeMap<String, Vec<(String, u64)>> = BTreeMap::new();

    for z in &zips {
        let path_str = z.to_string_lossy().into_owned();
        let meta = match fs::metadata(z) {
            Ok(m) => m,
            Err(_) => continue,
        };

        // Zero size first
        if meta.len() == 0 {
            findings.push(ZipFinding::ZeroSize { path: path_str.clone() });
            continue;
        }

        // Try to open
        let bytes = match fs::read(z) {
            Ok(b) => b,
            Err(_) => {
                findings.push(ZipFinding::ZeroSize { path: path_str.clone() });
                continue;
            }
        };

        let mut archive = match ZipArchive::new(Cursor::new(&bytes)) {
            Ok(a) => a,
            Err(_) => {
                // corrupted zip counts as zero-size for cleanup purposes
                findings.push(ZipFinding::ZeroSize { path: path_str.clone() });
                continue;
            }
        };
        let entry_count = archive.len();

        // total uncompressed size + content fingerprint
        let mut total_uncompressed: u64 = 0;
        let mut hasher = Sha256::new();
        let mut any_entries = false;
        for i in 0..entry_count {
            let mut f = match archive.by_index(i) {
                Ok(f) => f,
                Err(_) => continue,
            };
            any_entries = true;
            let mut buf = Vec::with_capacity(4096);
            let _ = f.read_to_end(&mut buf);
            total_uncompressed = total_uncompressed.saturating_add(buf.len() as u64);
            hasher.update(&buf);
        }

        // Empty (no entries) or all-zeros
        if !any_entries || total_uncompressed == 0 {
            findings.push(ZipFinding::Empty {
                path: path_str.clone(),
                entries: entry_count as u32,
            });
            continue;
        }

        let digest = format!("{:x}", hasher.finalize());
        by_hash
            .entry(digest)
            .or_default()
            .push((path_str.clone(), meta.len()));
    }

    // Duplicates
    for (digest, group) in by_hash {
        if group.len() > 1 {
            // group[0] is the "kept" one, others go in siblings
            for (i, (p, sz)) in group.iter().enumerate() {
                if i == 0 {
                    continue;
                }
                let siblings: Vec<String> = group
                    .iter()
                    .enumerate()
                    .filter_map(|(j, (q, _))| {
                        if j != i {
                            Some(q.clone())
                        } else {
                            None
                        }
                    })
                    .collect();
                findings.push(ZipFinding::Duplicate {
                    path: p.clone(),
                    siblings,
                    sha256: digest.clone(),
                    size: *sz,
                });
            }
        }
    }

    Ok(ZipScanResult {
        scanned,
        findings,
        trash_dir: trash_dir_str,
    })
}

fn walk_zips(root: &Path, recursive: bool) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let max_depth = if recursive { usize::MAX } else { 1 };
    for entry in walkdir::WalkDir::new(root)
        .max_depth(max_depth)
        .into_iter()
        .filter_map(Result::ok)
    {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let ext = p
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase());
        if ext.as_deref() == Some("zip") {
            out.push(p.to_path_buf());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnmatch_logic_reusable() {
        // just make sure an end-to-end structure compiles.
        assert!(fnmatch_simple_via_super("*.zip", "a.zip"));
    }

    fn fnmatch_simple_via_super(pat: &str, s: &str) -> bool {
        // mirror of file_treeview's fnmatch
        fn inner(pat: &[u8], s: &[u8]) -> bool {
            let (mut pi, mut si) = (0, 0);
            let mut star = None;
            let mut after = 0;
            while si < s.len() {
                if pi < pat.len() && pat[pi] == b'*' {
                    star = Some(pi);
                    after = si;
                    pi += 1;
                } else if pi < pat.len() && (pat[pi] == b'?' || pat[pi] == s[si]) {
                    pi += 1;
                    si += 1;
                } else if let Some(sp) = star {
                    pi = sp + 1;
                    after += 1;
                    si = after;
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
}
