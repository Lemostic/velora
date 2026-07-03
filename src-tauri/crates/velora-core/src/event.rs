//! Cross-module event bus. The runtime keeps a `tokio::broadcast`
//! internally; modules see the trait surface and an `EventStream`
//! wrapper that is `Send + Sync` and can be polled from any thread.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::path::PathBuf;
use std::sync::mpsc::Receiver;

/// Topic strings live as constants here so typos surface at compile
/// time when possible (use `EventTopic::FILE_SELECTED` instead of
/// raw strings in IDEs that surface doc-comments).
pub struct EventTopic;
impl EventTopic {
    pub const FILE_SELECTED: &'static str = "file:selected";
    pub const DATABASE_CHANGED: &'static str = "db:changed";
    pub const MODULE_ENABLED: &'static str = "module:enabled";
    pub const MODULE_DISABLED: &'static str = "module:disabled";
    pub const CONFIG_CHANGED: &'static str = "config:changed";
    pub const THEME_CHANGED: &'static str = "app:theme_changed";
    pub const SHORTCUT_TRIGGERED: &'static str = "shortcut:triggered";
}

/// Built-in typed events. Custom topics are still allowed via
/// `Event::Custom` so plugins can communicate without modifying
/// core.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "topic", content = "payload")]
pub enum Event {
    #[serde(rename = "file:selected")]
    FileSelected { path: PathBuf },
    #[serde(rename = "db:changed")]
    DatabaseChanged { table: String },
    #[serde(rename = "module:enabled")]
    ModuleEnabled { id: String },
    #[serde(rename = "module:disabled")]
    ModuleDisabled { id: String },
    #[serde(rename = "config:changed")]
    ConfigChanged {
        key: String,
        value: JsonValue,
    },
    #[serde(rename = "app:theme_changed")]
    ThemeChanged {
        from: String,
        to: String,
    },
    #[serde(rename = "shortcut:triggered")]
    ShortcutTriggered { id: String },
    /// Escape hatch for module-to-module custom topics. Always
    /// serialised as `{ "topic": "<user-string>", "payload": ... }`.
    #[serde(rename = "custom")]
    Custom {
        topic: String,
        payload: JsonValue,
    },
}

impl Event {
    /// The topic string of this event, suitable for routing /
    /// filtering in the broker.
    pub fn topic(&self) -> &str {
        match self {
            Self::FileSelected { .. } => EventTopic::FILE_SELECTED,
            Self::DatabaseChanged { .. } => EventTopic::DATABASE_CHANGED,
            Self::ModuleEnabled { .. } => EventTopic::MODULE_ENABLED,
            Self::ModuleDisabled { .. } => EventTopic::MODULE_DISABLED,
            Self::ConfigChanged { .. } => EventTopic::CONFIG_CHANGED,
            Self::ThemeChanged { .. } => EventTopic::THEME_CHANGED,
            Self::ShortcutTriggered { .. } => EventTopic::SHORTCUT_TRIGGERED,
            Self::Custom { topic, .. } => topic,
        }
    }
}

/// Receiver-side handle. Implemented as a thin wrapper around an
/// `mpsc::Receiver<Event>` so modules can poll from a sync context.
/// The async-infra layer can wrap this in a `tokio::sync::mpsc` for
/// non-blocking polling.
#[derive(Debug)]
pub struct EventStream {
    inner: Receiver<Event>,
    filter: Option<String>,
}

impl EventStream {
    pub fn new(rx: Receiver<Event>, filter: Option<String>) -> Self {
        Self { inner: rx, filter }
    }

    /// Block until the next matching event, or `None` if the stream
    /// has been closed.
    pub fn recv(&self) -> Option<Event> {
        loop {
            match self.inner.recv() {
                Ok(ev) => {
                    if let Some(topic) = &self.filter {
                        if ev.topic() != topic {
                            continue;
                        }
                    }
                    return Some(ev);
                }
                Err(_) => return None,
            }
        }
    }

    /// Non-blocking variant: returns immediately with the next
    /// matching event, or `None` if no event is queued.
    pub fn try_recv(&self) -> Option<Event> {
        loop {
            match self.inner.try_recv() {
                Ok(ev) => {
                    if let Some(topic) = &self.filter {
                        if ev.topic() != topic {
                            continue;
                        }
                    }
                    return Some(ev);
                }
                Err(_) => return None,
            }
        }
    }
}
