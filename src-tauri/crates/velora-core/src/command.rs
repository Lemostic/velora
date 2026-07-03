//! Commands exposed by a module. The runtime maps these onto Tauri
//! `#[tauri::command]` handlers (see velora-app) so the frontend can
//! call them uniformly via `callCommand(module_id, command_name, args)`.

use crate::error::{VeloraError, VeloraResult};
use crate::host::HostServices;

/// Synchronous command handler. Receives the host services bundle
/// and the JSON-serialised args, returns a JSON-serialisable value.
///
/// Synchronous is enough for v1 — most modules are CPU-bound or wrap
/// cheap IO. Long-running async work can use `tokio::task::spawn_blocking`
/// inside the handler.
pub type CommandHandler =
    fn(host: &dyn HostServices, args: serde_json::Value) -> VeloraResult<serde_json::Value>;

#[derive(Debug, Clone, Copy)]
pub struct Command {
    /// Command name, unique within the module. Becomes the Tauri
    /// command name with the `velora:<module>:<name>` prefix.
    pub name: &'static str,
    pub handler: CommandHandler,
    /// Optional JSON Schema for the args; surfaces in the auto-
    /// generated typed client and in the UI form.
    pub args_schema: Option<fn() -> serde_json::Value>,
    /// Optional JSON Schema for the return value.
    pub return_schema: Option<fn() -> serde_json::Value>,
    /// Shown in tooltips, command palette, and the docs.
    pub description: &'static str,
}

impl Command {
    pub const fn new(name: &'static str, handler: CommandHandler, description: &'static str) -> Self {
        Self {
            name,
            handler,
            args_schema: None,
            return_schema: None,
            description,
        }
    }
}

/// Helper for the most common case: a command that takes a typed
/// request and returns a typed response. The runtime uses these
/// implicitly when generating Tauri handlers.
pub fn call<TReq, TResp>(
    host: &dyn HostServices,
    args: serde_json::Value,
    f: fn(&dyn HostServices, TReq) -> VeloraResult<TResp>,
) -> VeloraResult<serde_json::Value>
where
    TReq: serde::de::DeserializeOwned,
    TResp: serde::Serialize,
{
    let req: TReq = serde_json::from_value(args)?;
    let resp = f(host, req)?;
    Ok(serde_json::to_value(resp)?)
}

/// Convert a `VeloraError` to a serialisable value (used by the
/// Tauri handler adapter to surface errors to the frontend).
pub fn map_err(e: VeloraError) -> VeloraError {
    e
}
