//! Built-in module discovery via the `inventory` crate.
//!
//! `inventory::submit!(ModuleEntry::new(factory))` is called from each
//! plugin crate (in their `lib.rs`); at runtime the velora-app
//! iterates `inventory::iter::<ModuleEntry>` to collect them all
//! without any explicit registration call.
//!
//! External plugins (dylib) register themselves through the same
//! `ModuleEntry` mechanism — the `velora_plugin_entry` symbol just
//! calls `inventory::submit!` from inside the dylib, which is added
//! to the host process's inventory on `dlopen`.

/// A factory that produces a `Box<dyn Module>`. Stored statically
/// via `inventory::submit!`.
#[derive(Debug)]
pub struct ModuleEntry {
    pub factory: fn() -> Box<dyn Module>,
}

impl ModuleEntry {
    pub const fn new(factory: fn() -> Box<dyn Module>) -> Self {
        Self { factory }
    }
}

inventory::collect!(ModuleEntry);

use crate::module::Module;
