//! Unified error type for the entire Velora runtime.
//!
//! Errors are serialised into a structured JSON shape so the frontend
//! can pattern-match on `kind` and localise messages.

use serde::{Serialize, Serializer};
use std::path::PathBuf;

pub type VeloraResult<T> = std::result::Result<T, VeloraError>;

#[derive(Debug, thiserror::Error)]
pub enum VeloraError {
    #[error("module not found: {id}")]
    ModuleNotFound { id: String },

    #[error("module `{module}` is not allowed to access `{capability}`")]
    CapabilityDenied { capability: String, module: String },

    #[error("database error: {0}")]
    Database(String),

    #[error("network error: {0}")]
    Network(String),

    #[error("filesystem error at {path}: {source}")]
    FileSystem {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("shell error running {binary}: {source}")]
    Shell {
        binary: String,
        #[source]
        source: std::io::Error,
    },

    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("plugin load error at {path}: {source}")]
    PluginLoad {
        path: PathBuf,
        #[source]
        source: Box<dyn std::error::Error + Send + Sync>,
    },

    #[error("invalid argument `{name}`: {reason}")]
    InvalidArgument { name: String, reason: String },

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Internal(String),
}

impl VeloraError {
    /// Stable string tag the frontend can pattern-match on.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::ModuleNotFound { .. } => "module_not_found",
            Self::CapabilityDenied { .. } => "capability_denied",
            Self::Database(_) => "database",
            Self::Network(_) => "network",
            Self::FileSystem { .. } => "filesystem",
            Self::Shell { .. } => "shell",
            Self::Serialization(_) => "serialization",
            Self::PluginLoad { .. } => "plugin_load",
            Self::InvalidArgument { .. } => "invalid_argument",
            Self::Io(_) => "io",
            Self::Internal(_) => "internal",
        }
    }
}

impl Serialize for VeloraError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut o = s.serialize_struct("VeloraError", 4)?;
        o.serialize_field("kind", self.kind())?;
        o.serialize_field("message", &self.to_string())?;
        // Module / path context, when known.
        match self {
            Self::ModuleNotFound { id } => o.serialize_field("context", &serde_json::json!({ "id": id }))?,
            Self::CapabilityDenied { capability, module } => o.serialize_field(
                "context",
                &serde_json::json!({ "capability": capability, "module": module }),
            )?,
            Self::FileSystem { path, .. } => o.serialize_field("context", &serde_json::json!({ "path": path }))?,
            Self::Shell { binary, .. } => o.serialize_field("context", &serde_json::json!({ "binary": binary }))?,
            Self::InvalidArgument { name, reason } => o.serialize_field(
                "context",
                &serde_json::json!({ "name": name, "reason": reason }),
            )?,
            Self::PluginLoad { path, .. } => o.serialize_field("context", &serde_json::json!({ "path": path }))?,
            _ => o.serialize_field("context", &serde_json::json!({}))?,
        }
        o.serialize_field("display", &self.to_string())?;
        o.end()
    }
}

impl From<String> for VeloraError {
    fn from(s: String) -> Self {
        VeloraError::Internal(s)
    }
}

impl From<&str> for VeloraError {
    fn from(s: &str) -> Self {
        VeloraError::Internal(s.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_is_stable() {
        assert_eq!(VeloraError::ModuleNotFound { id: "x".into() }.kind(), "module_not_found");
        assert_eq!(VeloraError::Internal("oops".into()).kind(), "internal");
    }

    #[test]
    fn serializes_to_structured_json() {
        let err = VeloraError::CapabilityDenied {
            capability: "fs:read".into(),
            module: "qrcode".into(),
        };
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v["kind"], "capability_denied");
        assert_eq!(v["context"]["capability"], "fs:read");
        assert_eq!(v["context"]["module"], "qrcode");
        assert!(v["message"].as_str().unwrap().contains("qrcode"));
    }
}
