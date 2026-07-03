//! velora-infra — concrete `HostServices` implementations.
//!
//! P3 will fill this in: `DefaultHostServices` with sqlx-backed DB,
//! reqwest-backed HTTP, tokio::fs-backed FS, tauri-plugin-store
//! backed config, and a `tokio::broadcast`-backed event bus.
//!
//! For now this crate exists only as a placeholder so the workspace
//! can be built end-to-end and the dependency direction can be
//! verified.

#![allow(dead_code)]

pub fn placeholder() -> &'static str {
    "velora-infra is a P3 stub"
}
