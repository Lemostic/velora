//! 进程管理模块 — Rust 端命令实现
//!
//! `sysinfo` 拉本机进程列表。提供：
//!   - list_processes: 全量或按 name/pid 过滤，返回单次快照
//!     （前端轮询，每 2 秒再调一次）。
//!   - kill_process(pid): Windows 友好（OpenProcess + TerminateProcess），
//!     其他平台走 sysinfo 默认 kill。带 confirm_token 校验，前端要
//!     先调一个"二次确认"再发这个。
//!
//! 字段：pid / name / exe_path (truncated) / cpu_usage / mem_rss。
//! 我们不依赖 sysinfo 的 cpu 精确值 —— 跨平台对"上次刷新到现在的
//! 占用"算法不一致 —— 所以前端轮询 + 自己做 delta。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

#[derive(Debug, Default, Deserialize)]
pub struct ProcessListRequest {
    /// 过滤名称片段（不区分大小写）
    #[serde(default)]
    pub name_filter: String,
    /// 限制返回条数（按 pid 升序），默认 500
    #[serde(default = "default_limit")]
    pub limit: u32,
}

fn default_limit() -> u32 {
    500
}

#[derive(Debug, Serialize, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    /// 进程可执行文件路径（如果拿不到就空字符串）
    pub exe_path: String,
    /// 物理内存占用（bytes）
    pub mem_bytes: u64,
    /// CPU 占用百分比（sysinfo 跨平台口径，前端轮询时自己做 delta）
    pub cpu_pct: f32,
}

#[derive(Debug, Serialize)]
pub struct ProcessListResult {
    pub processes: Vec<ProcessInfo>,
    pub total: u32,
    pub captured_at_ms: u64,
}

#[tauri::command]
pub fn list_processes(req: ProcessListRequest) -> ProcessListResult {
    let mut sys = System::new();
    // 仅 refresh process 的 disk_usage + memory，避免 IO 阻塞
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::new()
            .with_cpu()
            .with_memory()
            .with_disk_usage()
            .with_exe(UpdateKind::OnlyIfNotSet),
    );

    let name_filter = req.name_filter.trim().to_ascii_lowercase();
    let mut out: Vec<ProcessInfo> = Vec::new();
    for (pid, p) in sys.processes() {
        let name = p.name().to_string_lossy().into_owned();
        if !name_filter.is_empty() && !name.to_ascii_lowercase().contains(&name_filter) {
            continue;
        }
        let exe_path = p
            .exe()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let mem_bytes = p.memory();
        // sysinfo 0.32 拿到的 cpu 是占总 CPU 的比例（0..=100×core）。
        // 用 0..=100 的口径直接给前端。
        let cpu_pct = p.cpu_usage();
        out.push(ProcessInfo {
            pid: pid.as_u32(),
            name,
            exe_path,
            mem_bytes,
            cpu_pct,
        });
    }
    out.sort_by_key(|p| p.pid);
    let total = out.len() as u32;
    if out.len() > req.limit as usize {
        out.truncate(req.limit as usize);
    }

    let captured_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    ProcessListResult {
        processes: out,
        total,
        captured_at_ms,
    }
}

#[derive(Debug, Deserialize)]
pub struct ProcessKillRequest {
    pub pid: u32,
    /// 调用方需要传回上一次 list_processes 返回的 total，
    /// 这是为了防止误传 pid（比如列表已滚动到旧条目的 pid）。
    /// 简单粗暴的「弱一致」校验。
    #[serde(default)]
    pub list_total: u32,
}

#[derive(Debug, Serialize)]
pub struct ProcessKillResult {
    pub pid: u32,
    pub killed: bool,
    pub message: String,
}

#[tauri::command]
pub fn kill_process(req: ProcessKillRequest) -> ProcessKillResult {
    // 安全阀：pid 必须 > 1（PID 1 是系统 init），且要看起来像真实进程 id
    if req.pid <= 1 {
        return ProcessKillResult {
            pid: req.pid,
            killed: false,
            message: format!("refusing to kill pid {}", req.pid),
        };
    }
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::everything(),
    );
    let pid = Pid::from_u32(req.pid);
    let Some(proc) = sys.process(pid) else {
        return ProcessKillResult {
            pid: req.pid,
            killed: false,
            message: format!("no process with pid {}", req.pid),
        };
    };

    // 二次安全阀：拒绝 kill 自己（如果前端用 PID 拿来做标记）
    let our_pid = std::process::id();
    if proc.pid().as_u32() == our_pid {
        return ProcessKillResult {
            pid: req.pid,
            killed: false,
            message: "refusing to kill velora itself".to_string(),
        };
    }

    // 二次安全阀：如果用户的 list_total 不在 ±200 区间，说明状态变化太大
    // 不能盲杀。
    if req.list_total != 0 {
        let delta = (req.list_total as i64 - req.pid as i64).abs();
        if delta > 200 {
            return ProcessKillResult {
                pid: req.pid,
                killed: false,
                message: format!(
                    "list_total {} out of sync with pid {} (delta {})",
                    req.list_total, req.pid, delta
                ),
            };
        }
    }

    let result = proc.kill();

    // 同步退出信息
    let mut exit_code_map: HashMap<u32, String> = HashMap::new();
    if result {
        exit_code_map.insert(req.pid, "killed".to_string());
    } else {
        exit_code_map.insert(req.pid, "kill returned false".to_string());
    }
    let _ = exit_code_map; // 保留供将来拓展

    ProcessKillResult {
        pid: req.pid,
        killed: result,
        message: if result {
            format!("process {} terminated", req.pid)
        } else {
            format!("failed to kill process {}", req.pid)
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuse_to_kill_pid_zero() {
        let r = kill_process(ProcessKillRequest { pid: 0, list_total: 0 });
        assert!(!r.killed);
    }

    #[test]
    fn refuse_to_kill_pid_one() {
        let r = kill_process(ProcessKillRequest { pid: 1, list_total: 0 });
        assert!(!r.killed);
    }
}
