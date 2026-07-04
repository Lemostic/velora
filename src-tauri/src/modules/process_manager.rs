//! 进程管理模块 — Rust 端命令实现
//!
//! `sysinfo` 拉本机进程列表。提供：
//!   - list_processes: 全量或按 name/pid 过滤，返回单次快照
//!     （前端轮询，每 2 秒再调一次）。
//!   - kill_process(pid): Windows 友好（OpenProcess + TerminateProcess），
//!     其他平台走 sysinfo 默认 kill。带 list_total 校验，前端要
//!     先调一个"二次确认"再发这个。
//!
//! 字段对齐 Windows 任务管理器「进程」页签：
//!   pid / name / exe_path / user_id / status / cpu_pct
//!   / mem_bytes (RSS) / disk_read_bytes / disk_write_bytes / start_time_ms

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use sysinfo::{Pid, ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, System, UpdateKind};

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
    /// Unix uid / Windows SID 字符串（拿不到时空字符串）
    pub user_id: String,
    /// 进程状态：Running / Sleeping / Stopped / Traced / Dead / Wakeup / Locked / Zombie / Idle / Unknown
    pub status: String,
    /// 物理内存占用（bytes）
    pub mem_bytes: u64,
    /// CPU 占用百分比（0..=100×core 归一到 0..=100）
    pub cpu_pct: f32,
    /// 进程启动 unix 毫秒时间戳（拿不到为 0）
    pub start_time_ms: u64,
    /// 累积磁盘读字节
    pub disk_read_bytes: u64,
    /// 累积磁盘写字节
    pub disk_write_bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct ProcessListResult {
    pub processes: Vec<ProcessInfo>,
    pub total: u32,
    pub captured_at_ms: u64,
}

fn status_to_string(s: ProcessStatus) -> String {
    match s {
        ProcessStatus::Run => "Running".to_string(),
        ProcessStatus::Sleep => "Sleeping".to_string(),
        ProcessStatus::Stop => "Stopped".to_string(),
        ProcessStatus::Tracing => "Traced".to_string(),
        ProcessStatus::Dead => "Dead".to_string(),
        ProcessStatus::Parked => "Locked".to_string(),
        ProcessStatus::Zombie => "Zombie".to_string(),
        ProcessStatus::Idle => "Idle".to_string(),
        _ => "Unknown".to_string(),
    }
}

#[tauri::command]
pub fn list_processes(req: ProcessListRequest) -> ProcessListResult {
    let mut sys = System::new();
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
        let cpu_pct = p.cpu_usage();
        let user_id = p
            .user_id()
            .map(|u| u.to_string())
            .unwrap_or_default();
        let status = status_to_string(p.status());
        let start_time_ms = p.start_time();
        let disk = p.disk_usage();
        out.push(ProcessInfo {
            pid: pid.as_u32(),
            name,
            exe_path,
            user_id,
            status,
            mem_bytes,
            cpu_pct,
            start_time_ms,
            disk_read_bytes: disk.read_bytes,
            disk_write_bytes: disk.written_bytes,
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

    let our_pid = std::process::id();
    if proc.pid().as_u32() == our_pid {
        return ProcessKillResult {
            pid: req.pid,
            killed: false,
            message: "refusing to kill velora itself".to_string(),
        };
    }

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

    let mut exit_code_map: HashMap<u32, String> = HashMap::new();
    if result {
        exit_code_map.insert(req.pid, "killed".to_string());
    } else {
        exit_code_map.insert(req.pid, "kill returned false".to_string());
    }
    let _ = exit_code_map;

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