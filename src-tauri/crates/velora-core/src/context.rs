//! Per-module context. The runtime hands one of these to `on_init`
//! and to each command invocation, so modules have a stable handle
//! onto their environment without needing to thread it manually.

use crate::host::HostServices;
use std::sync::Arc;

#[derive(Clone)]
pub struct ModuleContext {
    /// Shared handle to the host services. Cheap to clone.
    pub host: Arc<dyn HostServices>,
    /// The module's own id, useful for logging / metrics.
    pub module_id: &'static str,
    /// Path to the user data directory; modules can use this for
    /// their own caches.
    pub data_dir: std::path::PathBuf,
}

impl std::fmt::Debug for ModuleContext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ModuleContext")
            .field("module_id", &self.module_id)
            .field("data_dir", &self.data_dir)
            .finish()
    }
}
