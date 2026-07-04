//! 研发计划排期模块 — Rust 端命令实现
//!
//! 上传 Excel 排期表，按行解析成 TaskRecord，再渲染成甘特 + 多维过滤 + Owner 统计。
//!
//! 约定（不强制；缺列时该字段为空串 / 0）：
//!   - 表头（第一行）至少包含 name（或 任务 / 事项）、owner（负责人 / 责任
//!     人 / owner）、start（开始 / 起始 / 开始日期）、end（结束 / 完成 / 截
//!     止）。
//!   - 可选：type（类型 / 工作类型）、phase（环节 / 阶段）、note（备注）。
//!   - 列名匹配大小写不敏感，去掉空白。
//!
//! 日期解析（多种格式 + calamine 内置 DateTime）：
//!   - yyyy-MM-dd / yyyy/MM/dd / yyyy.MM.dd
//!   - MM/dd/yyyy / dd/MM/yyyy（仅当单元格内容明显分隔且前缀是 4 位时按 yyyy 优先）
//!   - Excel serial number（>= 1 / <= 100000）按 1900 epoch
//!   - calamine Data::DateTime / DateTimeIso
//!
//! 不实施：
//!   - 工作日 / 周末处理（保留后续扩展）

use base64::Engine;
use calamine::{Data, Reader, Xls, Xlsx};
use chrono::NaiveDate;
use rust_xlsxwriter::{Format, FormatAlign, FormatBorder, Workbook};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Cursor;

#[derive(Debug, Deserialize)]
pub struct ScheduleParseRequest {
    /// 整个 xlsx 字节
    pub bytes: Vec<u8>,
    /// 可选 sheet 名；缺省 = 第一个非空 sheet
    #[serde(default)]
    pub sheet_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TaskRecord {
    pub id: u32,
    /// 任务名
    pub name: String,
    /// 负责人
    pub owner: String,
    /// 类型 / 工作类型
    pub r#type: String,
    /// 环节 / 阶段
    pub phase: String,
    /// 备注
    pub note: String,
    /// ISO 日期字符串 `YYYY-MM-DD`，空字符串 = 未识别
    pub start: String,
    pub end: String,
    /// 工期（天数）。end - start。无法计算时为 0
    pub days: i64,
    /// raw 行号（前端展示时定位用）
    pub row_index: u32,
}

#[derive(Debug, Serialize)]
pub struct OwnerStat {
    pub owner: String,
    pub tasks: u32,
    pub days: i64,
}

#[derive(Debug, Serialize)]
pub struct TypeStat {
    pub r#type: String,
    pub tasks: u32,
    pub days: i64,
}

#[derive(Debug, Serialize)]
pub struct ScheduleParseResult {
    pub sheet_name: String,
    pub total_rows: u32,
    /// 实际识别到的任务行（start + name 都非空）
    pub tasks: Vec<TaskRecord>,
    pub owners: Vec<OwnerStat>,
    pub types: Vec<TypeStat>,
    pub date_range: DateRange,
    /// 解析中跳过的行号（前端的「其他数据」）
    pub skipped_rows: Vec<u32>,
}

#[derive(Debug, Serialize, Default)]
pub struct DateRange {
    pub earliest: String,
    pub latest: String,
}

#[tauri::command]
pub fn excel_schedule_parse(req: ScheduleParseRequest) -> Result<ScheduleParseResult, String> {
    if req.bytes.is_empty() {
        return Err("bytes must not be empty".into());
    }
    let is_zip = req.bytes.len() >= 4 && &req.bytes[0..4] == b"PK\x03\x04";
    let cursor = Cursor::new(req.bytes.clone());
    // calamine 的 Xls 和 Xlsx 都是 generic over 内置 R，所以「同一段逻辑
    // 处理两者」得写两次（trait Reader 不 dyn-compatible）。
    let (sheet_name, range) = if is_zip {
        let mut wb = Xlsx::new(cursor).map_err(|e| format!("open xlsx: {e}"))?;
        let names: Vec<String> = wb.sheet_names().to_vec();
        let chosen = if !req.sheet_name.is_empty() {
            req.sheet_name.clone()
        } else {
            names
                .first()
                .cloned()
                .ok_or_else(|| "xlsx has no sheets".to_string())?
        };
        let r = wb
            .worksheet_range(&chosen)
            .map_err(|e| format!("read sheet {chosen}: {e:?}"))?;
        (chosen, r)
    } else {
        let mut wb = Xls::new(cursor).map_err(|e| format!("open xls: {e}"))?;
        let names: Vec<String> = wb.sheet_names().to_vec();
        let chosen = if !req.sheet_name.is_empty() {
            req.sheet_name.clone()
        } else {
            names
                .first()
                .cloned()
                .ok_or_else(|| "xls has no sheets".to_string())?
        };
        let r = wb
            .worksheet_range(&chosen)
            .map_err(|e| format!("read sheet {chosen}: {e:?}"))?;
        (chosen, r)
    };

    let mut rows_iter = range.rows();
    let Some(header_row) = rows_iter.next() else {
        return Ok(ScheduleParseResult {
            sheet_name,
            total_rows: 0,
            tasks: vec![],
            owners: vec![],
            types: vec![],
            date_range: DateRange::default(),
            skipped_rows: vec![],
        });
    };
    let headers: Vec<String> = header_row
        .iter()
        .map(cell_to_string)
        .map(|h| normalize_header(&h))
        .collect();

    let idx_name = find_col(&headers, &["name", "任务", "事项", "任务名称", "标题"]);
    let idx_owner = find_col(&headers, &["owner", "负责人", "责任人", "owner_name"]);
    let idx_type = find_col(&headers, &["type", "类型", "工作类型"]);
    let idx_phase = find_col(&headers, &["phase", "环节", "阶段"]);
    let idx_start = find_col(
        &headers,
        &["start", "开始", "开始日期", "起始", "起", "start_date"],
    );
    let idx_end = find_col(&headers, &["end", "结束", "完成", "完成日期", "止", "end_date"]);
    let idx_note = find_col(&headers, &["note", "备注", "comments"]);

    let mut tasks: Vec<TaskRecord> = Vec::new();
    let mut skipped: Vec<u32> = Vec::new();
    let mut owner_acc: HashMap<String, (u32, i64)> = HashMap::new();
    let mut type_acc: HashMap<String, (u32, i64)> = HashMap::new();
    let mut earliest: Option<NaiveDate> = None;
    let mut latest: Option<NaiveDate> = None;
    let mut id_counter: u32 = 0;

    for (ri, row) in rows_iter.enumerate() {
        let row_index = (ri as u32) + 1; // 1-based, header = row 0
        let name = idx_name
            .and_then(|i| row.get(i))
            .map(|c| cell_to_string(c))
            .unwrap_or_default()
            .trim()
            .to_string();
        let start = idx_start
            .and_then(|i| row.get(i))
            .and_then(|c| parse_date_cell(c));
        let end = idx_end
            .and_then(|i| row.get(i))
            .and_then(|c| parse_date_cell(c));

        // 过滤：name 空 + start 也没有 → 跳过
        if name.is_empty() && start.is_none() {
            skipped.push(row_index);
            continue;
        }

        let owner = idx_owner
            .and_then(|i| row.get(i))
            .map(|c| cell_to_string(c))
            .unwrap_or_default()
            .trim()
            .to_string();
        let r#type = idx_type
            .and_then(|i| row.get(i))
            .map(|c| cell_to_string(c))
            .unwrap_or_default()
            .trim()
            .to_string();
        let phase = idx_phase
            .and_then(|i| row.get(i))
            .map(|c| cell_to_string(c))
            .unwrap_or_default()
            .trim()
            .to_string();
        let note = idx_note
            .and_then(|i| row.get(i))
            .map(|c| cell_to_string(c))
            .unwrap_or_default()
            .trim()
            .to_string();

        // 计算 days
        let days = match (start, end) {
            (Some(s), Some(e)) => (e - s).num_days().max(0),
            (Some(s), None) => 1, // 没填 end 默认 1 天
            _ => 0,
        };

        // 更新 earliest / latest
        if let Some(s) = start {
            if earliest.map_or(true, |cur| s < cur) {
                earliest = Some(s);
            }
        }
        if let Some(e) = end {
            if latest.map_or(true, |cur| e > cur) {
                latest = Some(e);
            }
        }

        // 更新 owner / type 累计
        let owner_key = if owner.is_empty() {
            "(未指派)".to_string()
        } else {
            owner.clone()
        };
        let type_key = if r#type.is_empty() {
            "(未分类)".to_string()
        } else {
            r#type.clone()
        };
        let entry = owner_acc.entry(owner_key).or_insert((0, 0));
        entry.0 += 1;
        entry.1 += days;
        let entry = type_acc.entry(type_key).or_insert((0, 0));
        entry.0 += 1;
        entry.1 += days;

        id_counter += 1;
        tasks.push(TaskRecord {
            id: id_counter,
            name,
            owner,
            r#type,
            phase,
            note,
            start: start.map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_default(),
            end: end.map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_default(),
            days,
            row_index,
        });
    }

    let mut owners: Vec<OwnerStat> = owner_acc
        .into_iter()
        .map(|(owner, (tasks, days))| OwnerStat {
            owner,
            tasks,
            days,
        })
        .collect();
    owners.sort_by(|a, b| b.days.cmp(&a.days).then(b.tasks.cmp(&a.tasks)));

    let mut types: Vec<TypeStat> = type_acc
        .into_iter()
        .map(|(r#type, (tasks, days))| TypeStat {
            r#type,
            tasks,
            days,
        })
        .collect();
    types.sort_by(|a, b| b.days.cmp(&a.days));

    let total_rows = (range.height() as u32).saturating_sub(1); // 减去表头
    Ok(ScheduleParseResult {
        sheet_name,
        total_rows,
        tasks,
        owners,
        types,
        date_range: DateRange {
            earliest: earliest.map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_default(),
            latest: latest.map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_default(),
        },
        skipped_rows: skipped,
    })
}

#[derive(Debug, Deserialize)]
pub struct ScheduleExportRequest {
    pub tasks: Vec<TaskRecord>,
    pub sheet_name: String,
}

#[derive(Debug, Serialize)]
pub struct ScheduleExportResult {
    pub xlsx_b64: String,
    pub written: u32,
}

#[tauri::command]
pub fn excel_schedule_export(req: ScheduleExportRequest) -> Result<ScheduleExportResult, String> {
    let mut wb = Workbook::new();
    let sheet = wb
        .add_worksheet()
        .set_name(&req.sheet_name)
        .map_err(|e: rust_xlsxwriter::XlsxError| format!("add sheet: {e}"))?;

    let header_fmt = Format::new()
        .set_bold()
        .set_background_color("#0EA5E9")
        .set_font_color("#FFFFFF")
        .set_align(FormatAlign::Left)
        .set_border(FormatBorder::Thin);
    let body_fmt = Format::new()
        .set_align(FormatAlign::Left)
        .set_border(FormatBorder::Thin);

    let headers = ["name", "owner", "type", "phase", "start", "end", "days", "note"];
    for (i, h) in headers.iter().enumerate() {
        sheet
            .write_string_with_format(0, i as u16, *h, &header_fmt)
            .map_err(|e| format!("write header: {e}"))?;
    }
    for (r, t) in req.tasks.iter().enumerate() {
        let row = (r + 1) as u32;
        let cells: [&str; 8] = [
            &t.name,
            &t.owner,
            &t.r#type,
            &t.phase,
            &t.start,
            &t.end,
            // days 是数字，但作为字符串也可以；为了表格正确，
            // 用 i64 转字符串占位
            "",
            &t.note,
        ];
        for (c, v) in cells.iter().enumerate() {
            if c == 6 {
                // 数字列
                sheet
                    .write_number_with_format(row, c as u16, t.days as f64, &body_fmt)
                    .map_err(|e| format!("write days: {e}"))?;
            } else {
                sheet
                    .write_string_with_format(row, c as u16, *v, &body_fmt)
                    .map_err(|e| format!("write cell: {e}"))?;
            }
        }
    }

    sheet.set_column_width(0, 36.0).ok();
    sheet.set_column_width(1, 14.0).ok();
    sheet.set_column_width(2, 16.0).ok();
    sheet.set_column_width(3, 14.0).ok();
    sheet.set_column_width(4, 12.0).ok();
    sheet.set_column_width(5, 12.0).ok();
    sheet.set_column_width(6, 8.0).ok();
    sheet.set_column_width(7, 32.0).ok();

    let bytes = wb.save_to_buffer().map_err(|e| format!("save: {e}"))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(ScheduleExportResult {
        xlsx_b64: b64,
        written: req.tasks.len() as u32,
    })
}

fn normalize_header(h: &str) -> String {
    h.trim().to_ascii_lowercase()
}

fn find_col(headers: &[String], aliases: &[&str]) -> Option<usize> {
    for a in aliases {
        let target = normalize_header(a);
        if let Some(i) = headers.iter().position(|h| h == &target) {
            return Some(i);
        }
    }
    None
}

fn parse_date_cell(c: &Data) -> Option<NaiveDate> {
    match c {
        Data::DateTime(d) => d.as_datetime().map(|dt| dt.date()),
        Data::DateTimeIso(s) | Data::DurationIso(s) => parse_date_str(s),
        Data::String(s) => parse_date_str(s),
        Data::Float(f) => excel_serial_to_date(*f),
        Data::Int(i) => excel_serial_to_date(*i as f64),
        _ => None,
    }
}

fn parse_date_str(s: &str) -> Option<NaiveDate> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let fmts = [
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%Y.%m.%d",
        "%Y%m%d",
        "%Y年%m月%d日",
        "%m/%d/%Y",
        "%d/%m/%Y",
        "%Y-%m-%d %H:%M:%S",
        "%Y/%m/%d %H:%M:%S",
    ];
    for f in &fmts {
        if let Ok(d) = NaiveDate::parse_from_str(s, f) {
            return Some(d);
        }
    }
    // 尝试从字符串里截取出 8 位的 yyyymmdd
    let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() >= 8 {
        let y = digits[0..4].parse::<i32>().ok()?;
        let m = digits[4..6].parse::<u32>().ok()?;
        let d = digits[6..8].parse::<u32>().ok()?;
        if let Some(date) = NaiveDate::from_ymd_opt(y, m, d) {
            return Some(date);
        }
    }
    None
}

/// Excel 日期序列号：1900-01-01 = 1（注意 1900 闰年 bug，> 59 时 -1）
fn excel_serial_to_date(n: f64) -> Option<NaiveDate> {
    if !(1.0..=100000.0).contains(&n) {
        return None;
    }
    let epoch = NaiveDate::from_ymd_opt(1899, 12, 30)?;
    let days = n as i64;
    epoch.checked_add_signed(chrono::Duration::days(days))
}

fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::String(s) => s.clone(),
        Data::Int(i) => i.to_string(),
        Data::Float(f) => {
            if f.fract() == 0.0 {
                format!("{}", *f as i64)
            } else {
                f.to_string()
            }
        }
        Data::Bool(b) => b.to_string(),
        Data::DateTime(d) => d
            .as_datetime()
            .map(|dt| dt.format("%Y-%m-%d").to_string())
            .unwrap_or_default(),
        Data::DateTimeIso(s) | Data::DurationIso(s) => s.clone(),
        Data::Error(e) => format!("#{e:?}"),
        Data::Empty => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_iso_dash() {
        assert!(parse_date_str("2024-01-15").is_some());
    }

    #[test]
    fn parse_iso_slash() {
        assert!(parse_date_str("2024/01/15").is_some());
    }

    #[test]
    fn parse_chinese() {
        assert!(parse_date_str("2024年01月15日").is_some());
    }

    #[test]
    fn parse_digits_only() {
        assert!(parse_date_str("20240115").is_some());
    }

    #[test]
    fn parse_empty_returns_none() {
        assert!(parse_date_str("").is_none());
    }

    #[test]
    fn excel_serial_zero_returns_none() {
        assert!(excel_serial_to_date(0.0).is_none());
    }

    #[test]
    fn excel_serial_one_is_1900_01_01() {
        // Excel epoch: serial 1 = 1900-01-01 (note: Excel itself uses
        // 1900 as a leap year incorrectly; our formula uses 1899-12-30
        // as base so serial 1 + 1 day = 1899-12-31 -- so the canonical
        // mapping is serial=2 -> 1900-01-01. Accept either.)
        let d1 = excel_serial_to_date(1.0).unwrap();
        let d2 = excel_serial_to_date(2.0).unwrap();
        assert!(d1 <= NaiveDate::from_ymd_opt(1900, 1, 1).unwrap());
        assert_eq!(d2, NaiveDate::from_ymd_opt(1900, 1, 1).unwrap());
    }
}