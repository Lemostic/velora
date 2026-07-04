//! QR Code 模块 — Rust 端命令实现
//!
//! 用 `qrcode` crate + `image` crate 生成 PNG，前端直接 `<img src=...>` 即可。
//!
//! 设计要点：
//!  - 输出 PNG 不是 SVG，因为 SVG 在 data URL 里有已知的字符编码坑
//!    （Tauri 的 WebView2 在某些版本对 `data:image/svg+xml;base64,...` 的
//!    image rendering 行为不一致），PNG 是最稳的位图。
//!  - 内部用 1024 px 高分辨率渲染，前端按容器自适应显示，
//!    调用方传入的 size 参数是兼容旧调用接口的占位（本模块不再用）。

use base64::Engine;
use image::Luma;
use qrcode::{EcLevel, QrCode};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct QrEncodeRequest {
    pub text: String,
    #[serde(default = "default_size")]
    pub size: u32,
    #[serde(default = "default_ec")]
    pub error_correction: String, // "L" | "M" | "Q" | "H"
}

fn default_size() -> u32 {
    1024 // 高分辨率；前端按容器缩放显示
}
fn default_ec() -> String {
    "M".to_string()
}

#[derive(Debug, Serialize)]
pub struct QrEncodeResult {
    pub format: String,
    pub width: u32,
    pub height: u32,
    pub data_url: String,
}

fn parse_ec(s: &str) -> EcLevel {
    match s.to_ascii_uppercase().as_str() {
        "L" => EcLevel::L,
        "H" => EcLevel::H,
        "Q" => EcLevel::Q,
        _ => EcLevel::M,
    }
}

pub fn encode(req: QrEncodeRequest) -> Result<QrEncodeResult, String> {
    if req.text.is_empty() {
        return Err("text must not be empty".into());
    }
    let ec = parse_ec(&req.error_correction);
    let code = QrCode::with_error_correction_level(req.text.as_bytes(), ec)
        .map_err(|e| format!("qr encode failed: {e}"))?;

    // 始终渲染到 1024×1024（自然像素），white bg + black dots。
    // 强制 min_dimensions 等于 max_dimensions 保证是正方形无 padding。
    let target = req.size.max(64).min(2048);
    let img = code
        .render::<Luma<u8>>()
        .min_dimensions(target, target)
        .max_dimensions(target, target)
        .build();

    let (w, h) = (img.width(), img.height());

    // PNG 编码到内存
    let mut png_bytes: Vec<u8> = Vec::new();
    {
        use image::ImageEncoder;
        let encoder = image::codecs::png::PngEncoder::new(&mut png_bytes);
        encoder
            .write_image(
                img.as_raw(),
                img.width(),
                img.height(),
                image::ExtendedColorType::L8,
            )
            .map_err(|e| format!("png encode failed: {e}"))?;
    }

    let data_url = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&png_bytes)
    );

    Ok(QrEncodeResult {
        format: "image/png".into(),
        width: w,
        height: h,
        data_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_simple_text() {
        let r = encode(QrEncodeRequest {
            text: "https://velora.dev".into(),
            size: 256,
            error_correction: "M".into(),
        })
        .unwrap();
        assert!(r.data_url.starts_with("data:image/png;base64,"));
        assert_eq!(r.format, "image/png");
        assert_eq!(r.width, r.height, "must be square");
    }

    #[test]
    fn empty_text_errors() {
        let r = encode(QrEncodeRequest {
            text: "".into(),
            size: 256,
            error_correction: "M".into(),
        });
        assert!(r.is_err());
    }
}
