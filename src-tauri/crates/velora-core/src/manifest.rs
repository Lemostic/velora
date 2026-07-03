//! Module metadata — the single static description of what a module
//! is, where it goes in the UI, and what it needs from the host.

/// Coarse-grained category, used to group modules in the nav rail.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ModuleCategory {
    /// Single-purpose tools: QR code, color picker, JSON formatter, etc.
    Tools,
    /// File-system utilities: tree view, batch rename, zip clean, etc.
    Files,
    /// Format conversion: XML ↔ JSON, Markdown ↔ HTML, etc.
    Convert,
    /// Developer helpers: process manager, regex tester, decoder, etc.
    DevTools,
    /// Network utilities: HTTP tester, ES query, port scanner, etc.
    Network,
    /// Search backends: ES, Solr, vector DB, etc.
    Search,
    /// Productivity: schedule, gantt, kanban, etc.
    Productivity,
    /// Database clients: MySQL, Postgres, Redis, etc.
    Database,
    /// App-level: settings, theme, plugin manager, etc.
    System,
}

use serde::Serialize;

/// Static, compile-time description of a module.
#[derive(Debug)]
pub struct ModuleManifest {
    /// Unique id, also used as URL slug: `/modules/<id>`.
    pub id: &'static str,
    /// Display name shown in the nav rail, the home tile, etc.
    pub name: &'static str,
    /// Semver, displayed in plugin manager.
    pub version: &'static str,
    /// Author, free-form.
    pub author: &'static str,
    /// Where the module belongs in the UI taxonomy.
    pub category: ModuleCategory,
    /// One-liner used on cards and tooltips.
    pub description: &'static str,
    /// Multi-paragraph detail shown in the module page (Markdown-light).
    pub long_description: &'static str,
    /// Lucide icon name (matches `lib/registry.ts::ICON_MAP`).
    pub icon: &'static str,
    /// Searchable tags.
    pub tags: &'static [&'static str],
    /// Drawer / nav-rail group label. Defaults to the category's
    /// display name when empty.
    pub menu_group: &'static str,
    /// Sort order within the menu group (smaller = earlier).
    pub menu_group_order: u32,
    /// Module load order (smaller = earlier init).
    pub priority: u32,
    /// Whether the module should be enabled out of the box.
    pub enabled_by_default: bool,
    /// Minimum Velora version this module requires (semver string).
    /// `None` means any version.
    pub min_app_version: Option<&'static str>,
}

impl ModuleManifest {
    /// Default sensible priority for built-in modules.
    pub const DEFAULT_PRIORITY: u32 = 100;
}
