//! Host services — the only way a module touches the outside world.
//!
//! `HostServices` is a fat trait that aggregates capability-scoped
//! sub-traits. Modules receive a `&dyn HostServices` in their
//! `on_init` and command handlers; they never construct the host
//! themselves. This is the linchpin of the sandbox model: any host
//! method that requires a capability is gated by `&CapabilityPolicy`
//! inside the infra implementation, and the policy comes from
//! `velora_modules` declarations merged with the user's per-cap
//! revocations.

use crate::error::VeloraResult;
use std::any::Any;
use std::path::{Path, PathBuf};

/// Lightweight HTTP response. The body is kept in memory for
/// simplicity — most plugin use-cases (ES query, webhook, etc.)
/// fit in a few MB.
#[derive(Debug, Clone)]
pub struct Response {
    pub status: u16,
    pub body: Vec<u8>,
}

impl Response {
    pub fn json<T: serde::de::DeserializeOwned>(&self) -> VeloraResult<T> {
        Ok(serde_json::from_slice(&self.body)?)
    }
}

/// Generic row representation returned by `DatabaseAccess::query`.
/// The infra layer maps concrete drivers (sqlx::Row, rusqlite::Row)
/// into this shape so modules don't bind to a specific crate.
#[derive(Debug, Clone)]
pub struct Row {
    pub values: Vec<DbValue>,
}

#[derive(Debug, Clone)]
pub enum DbValue {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(String),
    Blob(Vec<u8>),
}

impl From<&str> for DbValue {
    fn from(s: &str) -> Self {
        DbValue::Text(s.to_string())
    }
}
impl From<String> for DbValue {
    fn from(s: String) -> Self {
        DbValue::Text(s)
    }
}
impl From<i64> for DbValue {
    fn from(v: i64) -> Self {
        DbValue::Int(v)
    }
}
impl From<bool> for DbValue {
    fn from(v: bool) -> Self {
        DbValue::Bool(v)
    }
}
impl From<f64> for DbValue {
    fn from(v: f64) -> Self {
        DbValue::Float(v)
    }
}

/// File-system watcher handle. Dropping the handle stops watching.
pub trait Watcher: Send + Sync {
    /// Block until the next event (or the watcher is closed).
    fn next_event(&self) -> Option<FileEvent>;
}

#[derive(Debug, Clone)]
pub struct FileEvent {
    pub path: PathBuf,
    pub kind: FileEventKind,
}

#[derive(Debug, Clone, Copy)]
pub enum FileEventKind {
    Created,
    Modified,
    Removed,
    Renamed,
}

#[derive(Debug, Clone)]
pub struct FsMetadata {
    pub size: u64,
    pub is_dir: bool,
    pub modified: Option<std::time::SystemTime>,
}

// =================================================================
// HostServices: the fat trait modules consume.
// =================================================================

pub trait HostServices: Send + Sync {
    fn db(&self) -> &dyn DatabaseAccess;
    fn http(&self) -> &dyn HttpClient;
    fn fs(&self) -> &dyn FileSystemAccess;
    fn shell(&self) -> &dyn ShellAccess;
    fn events(&self) -> &dyn EventBus;
    fn config(&self) -> &dyn ConfigStore;
    fn notify(&self) -> &dyn NotificationSink;
    fn shortcuts(&self) -> &dyn ShortcutRegistry;
    fn tray(&self) -> &dyn TrayBuilder;
    /// For test / advanced users only — escape hatch into `Any`
    /// to downcast to a concrete host type.
    fn as_any(&self) -> &dyn Any;
}

// =================================================================
// Sub-traits. Each is independent so the infra can swap impls
// without affecting the rest.
// =================================================================

pub trait DatabaseAccess: Send + Sync {
    fn query(&self, sql: &str, params: &[DbValue]) -> VeloraResult<Vec<Row>>;
    fn execute(&self, sql: &str, params: &[DbValue]) -> VeloraResult<u64>;
    /// Begin a transaction. Returned handle auto-rolls-back on drop
    /// unless `commit()` is called explicitly. The closure-style
    /// ergonomics of `transaction(|tx| { ... })` are provided by
    /// the `with_transaction` free function below.
    fn begin(&self) -> VeloraResult<Box<dyn Transaction>>;
}

/// Convenience wrapper that handles the commit / rollback ceremony
/// for modules that prefer closure-style transactions.
pub fn with_transaction<R>(
    db: &dyn DatabaseAccess,
    f: impl FnOnce(&mut dyn Transaction) -> VeloraResult<R>,
) -> VeloraResult<R> {
    let mut tx = db.begin()?;
    match f(tx.as_mut()) {
        Ok(value) => tx.commit().map(|_| value),
        Err(e) => {
            let _ = tx.rollback();
            Err(e)
        }
    }
}

pub trait Transaction: Send + Sync {
    fn query(&mut self, sql: &str, params: &[DbValue]) -> VeloraResult<Vec<Row>>;
    fn execute(&mut self, sql: &str, params: &[DbValue]) -> VeloraResult<u64>;
    fn commit(self: Box<Self>) -> VeloraResult<()>;
    fn rollback(self: Box<Self>) -> VeloraResult<()>;
}

pub trait HttpClient: Send + Sync {
    fn get(&self, url: &str) -> VeloraResult<Response>;
    fn post(&self, url: &str, body: &[u8]) -> VeloraResult<Response>;
}

pub trait FileSystemAccess: Send + Sync {
    fn read(&self, path: &Path) -> VeloraResult<Vec<u8>>;
    fn write(&self, path: &Path, data: &[u8]) -> VeloraResult<()>;
    fn watch(&self, path: &Path) -> VeloraResult<Box<dyn Watcher>>;
    fn metadata(&self, path: &Path) -> VeloraResult<FsMetadata>;
    fn list(&self, dir: &Path) -> VeloraResult<Vec<PathBuf>>;
}

pub trait ShellAccess: Send + Sync {
    fn exec(&self, cmd: &str, args: &[&str]) -> VeloraResult<ExecOutput>;
    fn sidecar(&self, name: &str) -> VeloraResult<SidecarHandle>;
}

#[derive(Debug, Clone)]
pub struct ExecOutput {
    pub status: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

pub struct SidecarHandle {
    /// Opaque handle held by the host; the module can `take()` the
    /// child process by sending a command via the host.
    _private: (),
}

impl std::fmt::Debug for SidecarHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SidecarHandle").finish()
    }
}

pub trait EventBus: Send + Sync {
    fn publish(&self, event: crate::event::Event) -> VeloraResult<()>;
    fn subscribe(&self, topic: &str) -> VeloraResult<crate::event::EventStream>;
}

pub trait ConfigStore: Send + Sync {
    fn get(&self, key: &str) -> VeloraResult<Option<serde_json::Value>>;
    fn set(&self, key: &str, value: serde_json::Value) -> VeloraResult<()>;
    fn delete(&self, key: &str) -> VeloraResult<()>;
    fn list(&self, prefix: &str) -> VeloraResult<Vec<(String, serde_json::Value)>>;
    fn watch(&self, key: &str) -> VeloraResult<ConfigStream>;
}

pub type ConfigStream = std::sync::mpsc::Receiver<(String, serde_json::Value)>;

pub trait NotificationSink: Send + Sync {
    fn info(&self, title: &str, body: &str) -> VeloraResult<()>;
    fn warn(&self, title: &str, body: &str) -> VeloraResult<()>;
    fn error(&self, title: &str, body: &str) -> VeloraResult<()>;
}

pub trait ShortcutRegistry: Send + Sync {
    fn register(
        &self,
        id: &str,
        accelerator: &str,
        callback: Box<dyn Fn() + Send + Sync>,
    ) -> VeloraResult<()>;
    fn unregister(&self, id: &str) -> VeloraResult<()>;
}

pub trait TrayBuilder: Send + Sync {
    fn add_item(&self, label: &str, callback: Box<dyn Fn() + Send + Sync>) -> VeloraResult<()>;
}
