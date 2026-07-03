//! QR Code 模块 — Rust 端命令实现
//!
//! 用 `qrcode` crate 生成 SVG data URL，前端直接 `<img src=...>` 即可。

use base64::Engine;
use qrcode::render::svg;
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
    320
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

    let svg = code
        .render::<svg::Color<'_>>()
        .min_dimensions(req.size, req.size)
        .build();

    let data_url = format!(
        "data:image/svg+xml;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(svg.as_bytes())
    );

    let (w, h) = parse_svg_dims(&svg).unwrap_or((req.size, req.size));

    Ok(QrEncodeResult {
        format: "image/svg+xml".into(),
        width: w,
        height: h,
        data_url,
    })
}

fn parse_svg_dims(svg: &str) -> Option<(u32, u32)> {
    let start = svg.find("viewBox=\"")? + "viewBox=\"".len();
    let end = svg[start..].find('"')? + start;
    let viewbox = &svg[start..end];
    let mut parts = viewbox.split_whitespace();
    let _x: f32 = parts.next()?.parse().ok()?;
    let _y: f32 = parts.next()?.parse().ok()?;
    let w: f32 = parts.next()?.parse().ok()?;
    let h: f32 = parts.next()?.parse().ok()?;
    Some((w as u32, h as u32))
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
        assert!(r.data_url.starts_with("data:image/svg+xml;base64,"));
        assert_eq!(r.format, "image/svg+xml");
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
