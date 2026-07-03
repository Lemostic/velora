//! velora-modules — built-in module implementations.
//!
//! P2 will move the existing `qrcode` and `excel` modules from
//! `src-tauri/src/modules/` into here, refactored to implement the
//! `Module` trait. For now this crate exists only as a placeholder
//! so the workspace can be built end-to-end.

#![allow(dead_code)]

pub fn placeholder() -> &'static str {
    "velora-modules is a P2 stub"
}
