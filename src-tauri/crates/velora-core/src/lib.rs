//! Velora Core — the contract every module, host service, and command
//! must satisfy. Zero business logic lives here; this crate is the
//! single source of truth for the plugin interface.
//!
//! Design principles:
//! 1. Stable — once published, breaking changes require a major bump.
//! 2. Zero business deps — only serde / tracing / inventory, so any
//!    plugin can depend on core without dragging in sqlx, reqwest, etc.
//! 3. Object-safe — `Box<dyn Module>` and `&dyn HostServices` must work
//!    across crate boundaries (needed for external dylib plugins).

// Debug is encouraged but not required for every internal type —
// some (e.g. `Watcher`) are dyn-safe traits and don't need to
// derive it themselves. `missing_debug_implementations` is too strict
// for an interface crate.

pub mod capability;
pub mod command;
pub mod context;
pub mod error;
pub mod event;
pub mod host;
pub mod manifest;
pub mod module;
pub mod registry;

pub mod prelude {
    //! Common imports for plugin authors.
    pub use crate::capability::{Capability, DbMode, FsMode, ProcessMode};
    pub use crate::command::{Command, CommandHandler};
    pub use crate::context::ModuleContext;
    pub use crate::error::{VeloraError, VeloraResult};
    pub use crate::event::{Event, EventStream};
    pub use crate::host::{
        ConfigStore, DatabaseAccess, FileSystemAccess, HttpClient, HostServices,
        NotificationSink, Response, Row, Watcher,
    };
    pub use crate::manifest::{ModuleCategory, ModuleManifest};
    pub use crate::module::Module;
    pub use crate::registry::ModuleEntry;
}

pub use prelude::*;
