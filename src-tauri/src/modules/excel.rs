//! Excel → JSON 模块 — Rust 端命令实现
//!
//! 用 `calamine` 解析 xlsx/xls/xlsm（从内存 bytes 读取），输出每个 sheet 的 JSON。
//! 约定：第一行作为表头，剩余行作为数据行。

use calamine::{Data, Reader, Xls, Xlsx};
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Read, Seek};

#[derive(Debug, Deserialize)]
pub struct ExcelToJsonRequest {
    /// 整个 .xlsx 文件的字节（前端通过 `readFile` 拿到 ArrayBuffer 后转成 Vec<u8>）
    pub bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
pub struct SheetResult {
    pub name: String,
    pub rows: u32,
    pub cols: u32,
    pub json: String,
}

#[derive(Debug, Serialize)]
pub struct ExcelToJsonResult {
    pub file_name: String,
    pub sheets: Vec<SheetResult>,
    pub format: String,
}

/// 探测文件格式：xlsx/xlsm (ZIP 魔数) vs xls (OLE2 魔数)。
/// 失败时默认 xlsx。
fn detect_format(bytes: &[u8]) -> &'static str {
    if bytes.len() >= 4 && &bytes[0..4] == b"PK\x03\x04" {
        "xlsx"
    } else if bytes.len() >= 8 && &bytes[0..8] == b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1" {
        "xls"
    } else {
        "xlsx"
    }
}

pub fn convert(req: ExcelToJsonRequest) -> Result<ExcelToJsonResult, String> {
    if req.bytes.is_empty() {
        return Err("bytes must not be empty".into());
    }

    let format = detect_format(&req.bytes);
    let cursor = Cursor::new(req.bytes);

    let sheets: Vec<SheetResult> = match format {
        "xls" => read_from(Xls::new(cursor).map_err(|e| format!("open xls failed: {e}"))?)?,
        _ => read_from(Xlsx::new(cursor).map_err(|e| format!("open xlsx failed: {e}"))?)?,
    };

    Ok(ExcelToJsonResult {
        file_name: "uploaded.xlsx".into(),
        sheets,
        format: format.to_string(),
    })
}

/// 对任意实现了 `calamine::Reader` 的 workbook 提取所有 sheet 为 JSON
fn read_from<R, S>(mut wb: R) -> Result<Vec<SheetResult>, String>
where
    R: Reader<S>,
    S: Read + Seek,
    R::Error: std::fmt::Debug,
{
    let names: Vec<String> = wb.sheet_names().to_vec();
    let mut sheets = Vec::with_capacity(names.len());
    for name in names {
        let range = wb
            .worksheet_range(&name)
            .map_err(|e| format!("read sheet {name} failed: {e:?}"))?;
        sheets.push(range_to_sheet(&name, range));
    }
    Ok(sheets)
}

fn range_to_sheet(name: &str, range: calamine::Range<Data>) -> SheetResult {
    let mut rows_iter = range.rows();
    let Some(header) = rows_iter.next() else {
        return SheetResult {
            name: name.to_string(),
            rows: 0,
            cols: 0,
            json: "[]".into(),
        };
    };

    let headers: Vec<String> = header.iter().map(cell_to_string).collect();
    let cols = headers.len() as u32;

    let mut data_rows: Vec<serde_json::Value> = Vec::new();
    for row in rows_iter {
        let mut obj = serde_json::Map::with_capacity(headers.len());
        for (i, cell) in row.iter().enumerate() {
            let key = headers
                .get(i)
                .cloned()
                .unwrap_or_else(|| format!("col_{i}"));
            obj.insert(key, cell_to_json(cell));
        }
        data_rows.push(serde_json::Value::Object(obj));
    }

    let rows = data_rows.len() as u32;
    let json =
        serde_json::to_string_pretty(&data_rows).unwrap_or_else(|_| "[]".into());

    SheetResult {
        name: name.to_string(),
        rows,
        cols,
        json,
    }
}

fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::String(s) => s.clone(),
        Data::Int(i) => i.to_string(),
        Data::Float(f) => f.to_string(),
        Data::Bool(b) => b.to_string(),
        Data::DateTime(d) => d.to_string(),
        Data::DateTimeIso(s) | Data::DurationIso(s) => s.clone(),
        Data::Error(e) => format!("#{e:?}"),
        Data::Empty => String::new(),
    }
}

fn cell_to_json(cell: &Data) -> serde_json::Value {
    match cell {
        Data::Empty => serde_json::Value::Null,
        Data::String(s) => serde_json::Value::String(s.clone()),
        Data::Int(i) => serde_json::json!(i),
        Data::Float(f) => serde_json::json!(f),
        Data::Bool(b) => serde_json::Value::Bool(*b),
        Data::DateTime(d) => serde_json::Value::String(d.to_string()),
        Data::DateTimeIso(s) | Data::DurationIso(s) => {
            serde_json::Value::String(s.clone())
        }
        Data::Error(e) => serde_json::Value::String(format!("#{e:?}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_bytes_errors() {
        let r = convert(ExcelToJsonRequest { bytes: vec![] });
        assert!(r.is_err());
    }

    #[test]
    fn detect_zip_magic() {
        assert_eq!(detect_format(b"PK\x03\x04rest"), "xlsx");
    }

    #[test]
    fn detect_ole2_magic() {
        assert_eq!(
            detect_format(b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1rest"),
            "xls"
        );
    }

    #[test]
    fn detect_unknown_falls_back_to_xlsx() {
        assert_eq!(detect_format(b"garbage"), "xlsx");
    }
}