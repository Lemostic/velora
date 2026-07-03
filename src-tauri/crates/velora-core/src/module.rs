//! The `Module` trait — the contract every plugin must implement.
//!
//! Implementations are usually `struct FooModule;` + a single
//! `impl Module for FooModule { ... }` block. The factory function
//! is then registered with the runtime via `inventory::submit!`:
//!
//! ```ignore
//! pub struct QrCodeModule;
//! impl Module for QrCodeModule { ... }
//! inventory::submit!(ModuleEntry::new(|| Box::new(QrCodeModule)));
//! ```

use crate::capability::Capability;
use crate::command::Command;
use crate::context::ModuleContext;
use crate::error::VeloraResult;
use crate::event::Event;
use crate::manifest::ModuleManifest;

pub trait Module: Send + Sync + 'static {
    /// Static metadata. Returned by value from a `&self` receiver
    /// to keep the type object-safe.
    fn manifest(&self) -> ModuleManifest;

    /// Capabilities the module needs. Defaults to none.
    fn capabilities(&self) -> &'static [Capability] {
        &[]
    }

    /// Commands the module exposes to the frontend. Defaults to none.
    fn commands(&self) -> &'static [Command] {
        &[]
    }

    /// Called once after registration. Use to set up per-module
    /// state, spawn background tasks, open file handles, etc.
    fn on_init(&self, _ctx: &ModuleContext) -> VeloraResult<()> {
        Ok(())
    }

    /// Called on app shutdown. Defaults to a no-op. Must release
    /// any resources opened in `on_init`.
    fn on_shutdown(&self) -> VeloraResult<()> {
        Ok(())
    }

    /// Called when an event the module subscribed to is published.
    /// The default implementation discards everything.
    fn on_event(&self, _event: &Event) -> VeloraResult<()> {
        Ok(())
    }
}
