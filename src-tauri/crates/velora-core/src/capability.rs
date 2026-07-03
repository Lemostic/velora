//! Fine-grained capabilities a module declares upfront. The host
//! validates every capability use against this list at runtime, and
//! the user can revoke individual ones from the Preferences page.
//!
//! Each variant is intentionally small: bigger scopes ("read any
//! file", "open any network connection") would defeat the sandbox
//! model.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FsMode {
    Read,
    Write,
    Watch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DbMode {
    ReadOnly,
    ReadWrite,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProcessMode {
    /// `ps` equivalent.
    List,
    /// List + `kill`. Always requires explicit user confirmation
    /// in the UI even if granted here.
    ListAndKill,
}

/// A capability declaration, embedded in a module's manifest.
///
/// Paths and hostnames are stored as `&'static [&'static str]` so the
/// host can hash/cache the policy at registration time without
/// re-allocating per call.
#[derive(Debug, Clone, Copy)]
pub enum Capability {
    /// Read / write / watch files under a whitelist of glob patterns.
    FileSystem {
        paths: &'static [&'static str],
        modes: &'static [FsMode],
    },
    /// Open HTTP connections to whitelisted host:port globs.
    Network {
        hosts: &'static [&'static str],
    },
    /// Query / mutate whitelisted database tables.
    Database {
        tables: &'static [&'static str],
        mode: DbMode,
    },
    /// Spawn whitelisted binaries.
    Shell {
        binaries: &'static [&'static str],
    },
    /// Inspect and optionally kill system processes.
    Process(ProcessMode),
    /// Show desktop notifications.
    Notification,
    /// Persist config under a module-private namespace.
    ConfigStore { namespace: &'static str },
    /// Register global hotkeys.
    GlobalShortcut,
    /// Add items to the system tray menu.
    SystemTray,
    /// Subscribe to events on the listed topics.
    EventSubscription {
        topics: &'static [&'static str],
    },
}

impl Capability {
    /// Human-readable label for the capability, useful in the UI.
    pub fn label(&self) -> &'static str {
        match self {
            Self::FileSystem { .. } => "文件系统",
            Self::Network { .. } => "网络",
            Self::Database { .. } => "数据库",
            Self::Shell { .. } => "Shell",
            Self::Process(_) => "进程",
            Self::Notification => "通知",
            Self::ConfigStore { .. } => "持久化",
            Self::GlobalShortcut => "全局快捷键",
            Self::SystemTray => "系统托盘",
            Self::EventSubscription { .. } => "事件订阅",
        }
    }

    /// Stable tag the host can use to gate this capability at runtime.
    pub fn tag(&self) -> &'static str {
        match self {
            Self::FileSystem { .. } => "fs",
            Self::Network { .. } => "network",
            Self::Database { .. } => "db",
            Self::Shell { .. } => "shell",
            Self::Process(_) => "process",
            Self::Notification => "notification",
            Self::ConfigStore { .. } => "config",
            Self::GlobalShortcut => "shortcut",
            Self::SystemTray => "tray",
            Self::EventSubscription { .. } => "events",
        }
    }
}
