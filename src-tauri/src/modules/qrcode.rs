//! QR Code 模块 — Rust 端命令实现
//!
//! PNG 直接落盘到 `app_data_dir/qrcodes/`；前端通过 `convertFileSrc`
//! 转 `asset://` URL 给 `<img src>` 使用 —— 这是 Tauri 2 显示二进制图片的
//! 标准通路，绕过 data URL 的常见坑（base64 串超长时 IPC 序列化偶发截断）。
//!
//! 设计要点：
//!  - 始终 512×512 输出，文件 ~5KB，IPC 友好。
//!  - 缓存键 = text + ec，同一内容第二次直接复用磁盘文件。

use image::Luma;
use qrcode::{EcLevel, QrCode};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use tauri::Manager;

#[derive(Debug, Deserialize)]
pub struct QrEncodeRequest {
    pub text: String,
    #[serde(default = "default_size")]
    pub size: u32,
    #[serde(default = "default_ec")]
    pub error_correction: String, // "L" | "M" | "Q" | "H"
}

fn default_size() -> u32 {
    512
}
fn default_ec() -> String {
    "M".to_string()
}

#[derive(Debug, Serialize)]
pub struct QrEncodeResult {
    pub format: String,
    pub width: u32,
    pub height: u32,
    /// 磁盘绝对路径（POSIX 风格，用 `/`）。前端用
    /// `convertFileSrc(path)` 转 asset:// 后给 `<img src>`。
    pub path: String,
}

fn parse_ec(s: &str) -> EcLevel {
    match s.to_ascii_uppercase().as_str() {
        "L" => EcLevel::L,
        "H" => EcLevel::H,
        "Q" => EcLevel::Q,
        _ => EcLevel::M,
    }
}

fn cache_key(text: &str, ec: &str) -> String {
    let mut h = DefaultHasher::new();
    text.hash(&mut h);
    ec.to_ascii_uppercase().hash(&mut h);
    format!("qr_{:x}.png", h.finish())
}

/// 单命令：编码 + 落盘，返回 Tauri asset URL。
#[tauri::command]
pub fn qrcode_encode(app: tauri::AppHandle, req: QrEncodeRequest) -> Result<QrEncodeResult, String> {
    if req.text.trim().is_empty() {
        return Err("text must not be empty".into());
    }
    let ec_level = parse_ec(&req.error_correction);
    let code = QrCode::with_error_correction_level(req.text.as_bytes(), ec_level)
        .map_err(|e| format!("qr encode failed: {e}"))?;

    let target = req.size.max(64).min(2048);
    let img = code
        .render::<Luma<u8>>()
        .min_dimensions(target, target)
        .max_dimensions(target, target)
        .build();
    let (w, h) = (img.width(), img.height());

    let mut png_bytes: Vec<u8> = Vec::new();
    {
        use image::ImageEncoder;
        image::codecs::png::PngEncoder::new(&mut png_bytes)
            .write_image(
                img.as_raw(),
                img.width(),
                img.height(),
                image::ExtendedColorType::L8,
            )
            .map_err(|e| format!("png encode failed: {e}"))?;
    }

    // 落盘到 app_data_dir/qrcodes/<hash>.png
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let dir = data_dir.join("qrcodes");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {e}"))?;
    let fname = cache_key(&req.text, &req.error_correction);
    let abs = dir.join(&fname);
    std::fs::write(&abs, &png_bytes).map_err(|e| format!("write failed: {e}"))?;

    Ok(QrEncodeResult {
        format: "image/png".into(),
        width: w,
        height: h,
        path: abs.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_key_changes_with_text() {
        assert_ne!(
            cache_key("https://velora.dev", "M"),
            cache_key("https://velora.dev2", "M"),
        );
    }

    #[test]
    fn cache_key_changes_with_ec() {
        assert_ne!(
            cache_key("foo", "M"),
            cache_key("foo", "H"),
        );
    }
}
