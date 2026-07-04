//! Excel 转置模块 — Rust 端命令实现
//!
//! 宽表 → 长表：把多列字段转成 `(key, field, value)` 三列布局。
//! 比如 汇总宽表：
//!
//!   日期       营业额   客户数   投诉数
//!   2024-01    12345    67       2
//!   2024-02    13210    72       1
//!
//! 转置后（key = 日期，fields = 营业额/客户数/投诉数）：
//!
//!   日期       field       value
//!   2024-01    营业额      12345
//!   2024-01    客户数      67
//!   2024-01    投诉数      2
//!   2024-02    营业额      13210
//!   ...

use base64::Engine;
use calamine::{Data, Reader, Xls, Xlsx};
use rust_xlsxwriter::{Format, FormatAlign, FormatBorder, Workbook};
use serde::{Deserialize, Serialize};
use std::io::Cursor;

#[derive(Debug, Deserialize)]
pub struct ExcelTransposeRequest {
    /// xlsx 文件 bytes
    pub bytes: Vec<u8>,
    /// 选择的 sheet 名
    pub sheet_name: String,
    /// 作为「行标识」的列名（转置后成为 key 列）
    pub key_column: String,
    /// 要被转置的列名（每一列展开成多行）
    pub value_columns: Vec<String>,
    /// 第一行是否作为表头。false 则用 `A/B/C/...` 作 header
    #[serde(default = "default_true")]
    pub has_header: bool,
    /// 数值列求和还是保留每行（聚合开关）。true = 同 key 同行求和；
    /// false = 每行展开。空单元格处理一致按零参与聚合。
    #[serde(default)]
    pub aggregate: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize)]
pub struct TransposePreviewResult {
    /// 转置后的表头列名 = `[key_column, "field", "value"]`
    pub headers: Vec<String>,
    /// 转置后的全部数据行
    pub rows: Vec<Vec<String>>,
    /// 原始表的 (rows, cols)
    pub source_rows: u32,
    pub source_cols: u32,
    /// 转置后 (rows, cols)
    pub result_rows: u32,
    pub result_cols: u32,
}

#[derive(Debug, Serialize)]
pub struct ExcelTransposeResult {
    pub sheet_name: String,
    pub preview: TransposePreviewResult,
    /// 写好的 .xlsx 字节（前端通过 base64 / path 保存）。
    /// 落盘版本（带 hash 文件名）和 data URL 双备，
    /// 但本期用 data URL（保持小数据 + 简单），未来长数据可改 asset 协议。
    pub xlsx_b64: String,
}

/// 仅做预览，不生成 xlsx —— 给前端实时展示。
#[tauri::command]
pub fn excel_transpose_preview(req: ExcelTransposeRequest) -> Result<TransposePreviewResult, String> {
    let table = read_sheet_table(&req.bytes, &req.sheet_name, req.has_header)?;
    let preview = transpose(&table, &req.key_column, &req.value_columns, req.aggregate)?;
    Ok(preview)
}

/// 预览 + 落盘 xlsx。一次调用返回两样东西。
#[tauri::command]
pub fn excel_transpose(req: ExcelTransposeRequest) -> Result<ExcelTransposeResult, String> {
    let table = read_sheet_table(&req.bytes, &req.sheet_name, req.has_header)?;
    let preview = transpose(&table, &req.key_column, &req.value_columns, req.aggregate)?;
    let xlsx_b64 = write_xlsx(&preview)?;
    Ok(ExcelTransposeResult {
        sheet_name: req.sheet_name,
        preview,
        xlsx_b64,
    })
}

// ───────────────────────────── internals ─────────────────────────────

#[derive(Debug)]
struct Table {
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
}

fn read_sheet_table(
    bytes: &[u8],
    sheet_name: &str,
    has_header: bool,
) -> Result<Table, String> {
    if bytes.is_empty() {
        return Err("bytes must not be empty".into());
    }
    let is_zip = bytes.len() >= 4 && &bytes[0..4] == b"PK\x03\x04";
    let cursor = Cursor::new(bytes.to_vec());
    let range = if is_zip {
        Xlsx::new(cursor)
            .map_err(|e| format!("open xlsx failed: {e}"))?
            .worksheet_range(sheet_name)
            .map_err(|e| format!("read sheet '{sheet_name}' failed: {e:?}"))?
    } else {
        Xls::new(cursor)
            .map_err(|e| format!("open xls failed: {e}"))?
            .worksheet_range(sheet_name)
            .map_err(|e| format!("read sheet '{sheet_name}' failed: {e:?}"))?
    };

    let mut rows_iter = range.rows();
    let (headers, body) = if has_header {
        let Some(h) = rows_iter.next() else {
            return Ok(Table {
                headers: vec![],
                rows: vec![],
            });
        };
        (h.iter().map(cell_to_string).collect(), rows_iter.collect::<Vec<_>>())
    } else {
        // 自动用 A/B/C/... 作 header
        let cols = range.width() as usize;
        let headers: Vec<String> = (0..cols).map(|i| col_letter(i)).collect();
        (headers, rows_iter.collect::<Vec<_>>())
    };

    let rows: Vec<Vec<String>> = body
        .iter()
        .map(|r| r.iter().map(cell_to_string).collect())
        .collect();

    Ok(Table { headers, rows })
}

fn col_letter(mut i: usize) -> String {
    // 0 -> A, 25 -> Z, 26 -> AA
    let mut s = String::new();
    loop {
        s.insert(0, (b'A' + (i % 26) as u8) as char);
        if i < 26 {
            break;
        }
        i = i / 26 - 1;
    }
    s
}

fn transpose(
    table: &Table,
    key_column: &str,
    value_columns: &[String],
    aggregate: bool,
) -> Result<TransposePreviewResult, String> {
    if table.headers.is_empty() {
        return Ok(TransposePreviewResult {
            headers: vec!["(empty)".into()],
            rows: vec![],
            source_rows: 0,
            source_cols: 0,
            result_rows: 0,
            result_cols: 3,
        });
    }

    let key_idx = table
        .headers
        .iter()
        .position(|h| h == key_column)
        .ok_or_else(|| format!("key column '{key_column}' not found"))?;
    let mut field_indices: Vec<(String, usize)> = Vec::new();
    for v in value_columns {
        let i = table
            .headers
            .iter()
            .position(|h| h == v)
            .ok_or_else(|| format!("value column '{v}' not found"))?;
        field_indices.push((v.clone(), i));
    }
    if field_indices.is_empty() {
        return Err("at least one value column required".into());
    }

    let result_headers = vec![key_column.to_string(), "field".to_string(), "value".to_string()];

    let mut out_rows: Vec<Vec<String>> = Vec::new();
    if !aggregate {
        for row in &table.rows {
            let key = row.get(key_idx).cloned().unwrap_or_default();
            for (name, idx) in &field_indices {
                let val = row.get(*idx).cloned().unwrap_or_default();
                out_rows.push(vec![key.clone(), name.clone(), val]);
            }
        }
    } else {
        // 聚合：同 (key, field) 求和（按数字），非数字保留首个非空。
        use std::collections::HashMap;
        let mut acc: HashMap<(String, String), (f64, bool)> = HashMap::new();
        let mut non_numeric: HashMap<(String, String), String> = HashMap::new();
        for row in &table.rows {
            let key = row.get(key_idx).cloned().unwrap_or_default();
            for (name, idx) in &field_indices {
                let raw = row.get(*idx).cloned().unwrap_or_default();
                let k = (key.clone(), name.clone());
                if let Ok(n) = raw.trim().parse::<f64>() {
                    let entry = acc.entry(k).or_insert((0.0, false));
                    entry.0 += n;
                    entry.1 = true;
                } else if !raw.trim().is_empty() {
                    non_numeric.entry(k).or_insert(raw);
                }
            }
        }
        for ((k, f), (sum, had_num)) in &acc {
            let val = if *had_num {
                if sum.fract() == 0.0 {
                    format!("{}", *sum as i64)
                } else {
                    format!("{sum}")
                }
            } else {
                non_numeric.get(&(k.clone(), f.clone())).cloned().unwrap_or_default()
            };
            out_rows.push(vec![k.clone(), f.clone(), val]);
        }
        // 稳定排序：key 升序，再 field 升序
        out_rows.sort_by(|a, b| a[0].cmp(&b[0]).then(a[1].cmp(&b[1])));
    }

    Ok(TransposePreviewResult {
        result_rows: out_rows.len() as u32,
        result_cols: 3,
        source_rows: table.rows.len() as u32,
        source_cols: table.headers.len() as u32,
        headers: result_headers,
        rows: out_rows,
    })
}

fn write_xlsx(preview: &TransposePreviewResult) -> Result<String, String> {
    let mut wb = Workbook::new();
    let sheet = wb.add_worksheet().set_name("transposed").map_err(
        |e: rust_xlsxwriter::XlsxError| format!("add sheet: {e}"),
    )?;

    let header_fmt = Format::new()
        .set_bold()
        .set_background_color("#0EA5E9")
        .set_font_color("#FFFFFF")
        .set_align(FormatAlign::Left)
        .set_border(FormatBorder::Thin);

    let body_fmt = Format::new()
        .set_align(FormatAlign::Left)
        .set_border(FormatBorder::Thin);

    for (i, h) in preview.headers.iter().enumerate() {
        sheet
            .write_string_with_format(0, i as u16, h, &header_fmt)
            .map_err(|e| format!("write header: {e}"))?;
    }

    for (r, row) in preview.rows.iter().enumerate() {
        for (c, cell) in row.iter().enumerate() {
            sheet
                .write_string_with_format((r + 1) as u32, c as u16, cell, &body_fmt)
                .map_err(|e| format!("write cell: {e}"))?;
        }
    }

    // 列宽：key 列稍宽
    sheet.set_column_width(0, 24.0).ok();
    sheet.set_column_width(1, 22.0).ok();
    sheet.set_column_width(2, 28.0).ok();

    let bytes = wb.save_to_buffer().map_err(|e| format!("save xlsx: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::String(s) => s.clone(),
        Data::Int(i) => i.to_string(),
        Data::Float(f) => {
            // 去尾巴的 .0 让整数干净显示
            if f.fract() == 0.0 {
                format!("{}", *f as i64)
            } else {
                f.to_string()
            }
        }
        Data::Bool(b) => b.to_string(),
        Data::DateTime(d) => d.to_string(),
        Data::DateTimeIso(s) | Data::DurationIso(s) => s.clone(),
        Data::Error(e) => format!("#{e:?}"),
        Data::Empty => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn col_letter_basic() {
        assert_eq!(col_letter(0), "A");
        assert_eq!(col_letter(25), "Z");
        assert_eq!(col_letter(26), "AA");
        assert_eq!(col_letter(27), "AB");
        assert_eq!(col_letter(701), "ZZ");
        assert_eq!(col_letter(702), "AAA");
    }

    #[test]
    fn transpose_simple_long_form() {
        let table = Table {
            headers: vec!["date".into(), "rev".into(), "cust".into(), "comp".into()],
            rows: vec![
                vec!["2024-01".into(), "100".into(), "5".into(), "1".into()],
                vec!["2024-02".into(), "200".into(), "7".into(), "0".into()],
            ],
        };
        let r = transpose(&table, "date", &["rev".into(), "cust".into()], false).unwrap();
        assert_eq!(r.headers, vec!["date", "field", "value"]);
        assert_eq!(r.rows.len(), 4);
        // value_columns iterates in input order: rev before cust
        assert_eq!(r.rows[0], vec!["2024-01", "rev", "100"]);
        assert_eq!(r.rows[1], vec!["2024-01", "cust", "5"]);
    }

    #[test]
    fn transpose_aggregate_sums_numbers() {
        let table = Table {
            headers: vec!["k".into(), "v".into()],
            rows: vec![
                vec!["a".into(), "1".into()],
                vec!["a".into(), "2".into()],
                vec!["b".into(), "5".into()],
            ],
        };
        let r = transpose(&table, "k", &["v".into()], true).unwrap();
        assert_eq!(r.rows, vec![
            vec!["a".to_string(), "v".to_string(), "3".to_string()],
            vec!["b".to_string(), "v".to_string(), "5".to_string()],
        ]);
    }

    #[test]
    fn transpose_missing_key_errors() {
        let table = Table {
            headers: vec!["a".into()],
            rows: vec![vec!["1".into()]],
        };
        let r = transpose(&table, "missing", &["a".into()], false);
        assert!(r.is_err());
    }
}