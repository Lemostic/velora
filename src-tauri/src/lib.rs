// Velora - Tauri 2 desktop toolkit
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use serde::Serialize;
use thiserror::Error;
use tracing_subscriber::EnvFilter;

mod modules;
mod plugins_ext;

use modules::{
    excel::{ExcelToJsonRequest, ExcelToJsonResult},
    qrcode::{QrEncodeRequest, QrEncodeResult},
    registry::ModuleRegistry,
};

#[derive(Debug, Error)]
pub enum VeloraError {
    #[error("module not found: {0}")]
    ModuleNotFound(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),
}

impl From<String> for VeloraError {
    fn from(s: String) -> Self {
        VeloraError::ModuleNotFound(s)
    }
}

impl serde::Serialize for VeloraError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type VeloraResult<T> = std::result::Result<T, VeloraError>;

#[derive(Debug, Serialize, Clone)]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub tauri_version: &'static str,
    pub modules: Vec<ModuleSummary>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ModuleSummary {
    pub id: &'static str,
    pub name: &'static str,
    pub category: &'static str,
    pub description: &'static str,
    pub enabled: bool,
}

#[tauri::command]
fn app_info() -> AppInfo {
    let registry = ModuleRegistry::builtin();
    AppInfo {
        name: "Velora",
        version: env!("CARGO_PKG_VERSION"),
        tauri_version: tauri::VERSION,
        modules: registry
            .list()
            .into_iter()
            .map(|m| ModuleSummary {
                id: m.id,
                name: m.name,
                category: m.category,
                description: m.description,
                enabled: true,
            })
            .collect(),
    }
}

#[tauri::command]
fn list_modules() -> Vec<ModuleSummary> {
    let registry = ModuleRegistry::builtin();
    registry
        .list()
        .into_iter()
        .map(|m| ModuleSummary {
            id: m.id,
            name: m.name,
            category: m.category,
            description: m.description,
            enabled: true,
        })
        .collect()
}

#[tauri::command]
fn qrcode_encode(req: QrEncodeRequest) -> Result<QrEncodeResult, VeloraError> {
    modules::qrcode::encode(req).map_err(VeloraError::from)
}

#[tauri::command]
fn excel_to_json(
    req: ExcelToJsonRequest,
) -> Result<ExcelToJsonResult, VeloraError> {
    modules::excel::convert(req).map_err(VeloraError::from)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize structured logging
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("velora_lib=info,tauri=info,warn")),
        )
        .with_target(false)
        .compact()
        .init();

    tracing::info!("starting Velora v{}", env!("CARGO_PKG_VERSION"));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            app_info,
            list_modules,
            qrcode_encode,
            excel_to_json
        ])
        .run(tauri::generate_context!())
        .expect("error while running Velora");
}
