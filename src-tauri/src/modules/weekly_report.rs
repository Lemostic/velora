//! 周报管理模块 — Rust 端命令实现
//!
//! 把前端录入的本周完成 / 下周计划条目按「工作任务项」分组后，
//! 用 rust_xlsxwriter 生成与模板同构的 Excel：
//!   - 标题 + 投入情况 + 本周主要产出
//!   - 本周工作完成情况表 / 下周工作计划表
//!   - 相同工作任务项的 计划任务内容 / 进度说明 / 输出工件 / 投入人员 合并单元格

use base64::Engine;
use rust_xlsxwriter::{Format, FormatAlign, FormatBorder, Workbook, Worksheet, XlsxError};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const DONE_HEADERS: [&str; 10] = [
    "序号",
    "工作类别",
    "工作任务项",
    "计划任务内容",
    "进度完成情况&异常说明",
    "本周实际投入\n(人天)",
    "成本归属",
    "负责人",
    "输出工件",
    "投入人员（人天）",
];

const PLAN_HEADERS: [&str; 10] = [
    "序号",
    "工作类别",
    "工作任务项",
    "计划任务内容",
    "本周进度要求&检查点",
    "下周计划投入\n(人天)",
    "成本归属",
    "负责人",
    "输出工件",
    "投入人员（人天）",
];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyReportPerson {
    pub name: String,
    pub days: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyReportRow {
    pub category: String,
    pub task_item: String,
    pub content: String,
    pub progress: String,
    pub effort: String,
    pub cost_owner: String,
    pub owner: String,
    pub output: String,
    pub people: Vec<WeeklyReportPerson>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyReportExportRequest {
    pub week_label: String,
    pub investment_report: String,
    pub investment_leave: String,
    pub summary: String,
    pub done_rows: Vec<WeeklyReportRow>,
    pub plan_rows: Vec<WeeklyReportRow>,
}

#[derive(Debug, Serialize)]
pub struct WeeklyReportExportResult {
    pub xlsx_b64: String,
    pub done_rows: u32,
    pub plan_rows: u32,
    pub grouped_done: u32,
    pub grouped_plan: u32,
}

#[tauri::command]
pub fn weekly_report_export(
    req: WeeklyReportExportRequest,
) -> Result<WeeklyReportExportResult, String> {
    let mut workbook = Workbook::new();
    let sheet_name = sheet_name_from_label(&req.week_label);
    let sheet = workbook
        .add_worksheet()
        .set_name(&sheet_name)
        .map_err(|e: XlsxError| format!("add weekly report sheet: {e}"))?;

    let title_fmt = Format::new()
        .set_font_name("等线")
        .set_font_size(11)
        .set_background_color("#FDE9D9")
        .set_border(FormatBorder::Thin)
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter)
        .set_text_wrap();
    let header_fmt = Format::new()
        .set_font_name("等线")
        .set_font_size(11)
        .set_background_color("#B7DEE8")
        .set_border(FormatBorder::Thin)
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter)
        .set_text_wrap();
    let body_fmt = Format::new()
        .set_font_name("等线")
        .set_font_size(11)
        .set_border(FormatBorder::Thin)
        .set_align(FormatAlign::Left)
        .set_align(FormatAlign::VerticalCenter)
        .set_text_wrap();
    let center_fmt = body_fmt.clone().set_align(FormatAlign::Center);

    set_column_widths(sheet).map_err(|e: XlsxError| format!("set column widths: {e}"))?;

    write_section_title(sheet, 0, "本周工作完成情况", &title_fmt)
        .map_err(|e: XlsxError| format!("write section title: {e}"))?;
    let mut row = 3;

    sheet
        .merge_range(1, 0, 2, 0, "投入情况", &title_fmt)
        .map_err(|e: XlsxError| format!("merge investment label: {e}"))?;
    let investment = format!(
        "产品报工：{}\n请假：{}",
        display_str(&req.investment_report),
        display_str(&req.investment_leave)
    );
    sheet
        .merge_range(1, 1, 1, 9, &investment, &body_fmt)
        .map_err(|e: XlsxError| format!("merge investment: {e}"))?;
    sheet
        .set_row_height(1, 28.0)
        .map_err(|e: XlsxError| format!("set row height: {e}"))?;

    let summary = if req.summary.trim().is_empty() {
        "/".to_string()
    } else {
        format!("本周主要产出：\n{}", req.summary.trim())
    };
    sheet
        .merge_range(2, 1, 2, 9, &summary, &body_fmt)
        .map_err(|e: XlsxError| format!("merge summary: {e}"))?;
    sheet
        .set_row_height(2, estimate_text_height(&summary, 180.0))
        .map_err(|e: XlsxError| format!("set summary row height: {e}"))?;

    row = write_table_header(sheet, row, &DONE_HEADERS, &header_fmt)
        .map_err(|e: XlsxError| format!("write done header: {e}"))?;
    let (next, grouped_done) = write_rows(sheet, row, &req.done_rows, &body_fmt, &center_fmt)
        .map_err(|e: XlsxError| format!("write done rows: {e}"))?;
    row = next;

    row = write_section_title(sheet, row, "下周工作计划", &title_fmt)
        .map_err(|e: XlsxError| format!("write plan title: {e}"))?;
    row = write_table_header(sheet, row, &PLAN_HEADERS, &header_fmt)
        .map_err(|e: XlsxError| format!("write plan header: {e}"))?;
    let (_next_plan, grouped_plan) = write_rows(sheet, row, &req.plan_rows, &body_fmt, &center_fmt)
        .map_err(|e: XlsxError| format!("write plan rows: {e}"))?;

    sheet.set_landscape();
    let bytes = workbook
        .save_to_buffer()
        .map_err(|e: XlsxError| format!("save weekly report xlsx: {e}"))?;
    let xlsx_b64 = base64::engine::general_purpose::STANDARD.encode(bytes);

    Ok(WeeklyReportExportResult {
        xlsx_b64,
        done_rows: req.done_rows.len() as u32,
        plan_rows: req.plan_rows.len() as u32,
        grouped_done,
        grouped_plan,
    })
}

fn set_column_widths(sheet: &mut Worksheet) -> Result<(), XlsxError> {
    sheet.set_column_width(0, 5.5)?;
    sheet.set_column_width(1, 12.0)?;
    sheet.set_column_width(2, 18.0)?;
    sheet.set_column_width(3, 46.0)?;
    sheet.set_column_width(4, 34.0)?;
    sheet.set_column_width(5, 12.0)?;
    sheet.set_column_width(6, 10.0)?;
    sheet.set_column_width(7, 12.0)?;
    sheet.set_column_width(8, 24.0)?;
    sheet.set_column_width(9, 42.0)?;
    Ok(())
}

fn sheet_name_from_label(label: &str) -> String {
    let cleaned: String = label
        .trim()
        .chars()
        .map(|ch| match ch {
            ':' | '\\' | '/' | '?' | '*' | '[' | ']' => '_',
            _ => ch,
        })
        .take(31)
        .collect();
    if cleaned.trim().is_empty() {
        "Sheet1".to_string()
    } else {
        cleaned
    }
}

fn write_section_title(
    sheet: &mut Worksheet,
    row: u32,
    title: &str,
    format: &Format,
) -> Result<u32, XlsxError> {
    sheet.merge_range(row, 0, row, 9, title, format)?;
    sheet.set_row_height(row, 20.0)?;
    Ok(row + 1)
}

fn write_table_header(
    sheet: &mut Worksheet,
    row: u32,
    headers: &[&str; 10],
    format: &Format,
) -> Result<u32, XlsxError> {
    for (col, header) in headers.iter().enumerate() {
        sheet.write_string_with_format(row, col as u16, *header, format)?;
    }
    sheet.set_row_height(row, 42.0)?;
    Ok(row + 1)
}

/// 按工作任务项分组（跨行合并，保留首次出现顺序），空任务项不合并。
fn group_rows(rows: &[WeeklyReportRow]) -> Vec<Vec<&WeeklyReportRow>> {
    let mut groups: Vec<Vec<&WeeklyReportRow>> = Vec::new();
    let mut index: HashMap<&str, usize> = HashMap::new();

    for row in rows {
        let key = row.task_item.trim();
        if key.is_empty() {
            groups.push(vec![row]);
            continue;
        }
        if let Some(&group_idx) = index.get(key) {
            groups[group_idx].push(row);
        } else {
            index.insert(key, groups.len());
            groups.push(vec![row]);
        }
    }
    groups
}

fn write_rows(
    sheet: &mut Worksheet,
    mut row: u32,
    rows: &[WeeklyReportRow],
    body: &Format,
    center: &Format,
) -> Result<(u32, u32), XlsxError> {
    if rows.is_empty() {
        return Ok((row, 0));
    }

    let groups = group_rows(rows);
    let mut seq = 0u32;
    let mut grouped_count = 0u32;

    for group in groups {
        let start = row;
        let end = row + group.len() as u32 - 1;

        for (i, item) in group.iter().enumerate() {
            let cur = row + i as u32;
            seq += 1;
            sheet.write_number_with_format(cur, 0, f64::from(seq), center)?;
            sheet.write_string_with_format(cur, 1, display_str(&item.category), body)?;
            sheet.write_string_with_format(cur, 2, display_str(&item.task_item), body)?;
            sheet.write_string_with_format(cur, 5, display_str(&item.effort), center)?;
            sheet.write_string_with_format(cur, 6, display_str(&item.cost_owner), center)?;
            sheet.write_string_with_format(cur, 7, display_str(&item.owner), body)?;
        }

        let content = join_text(group.iter().map(|r| r.content.as_str()));
        let progress = join_text(group.iter().map(|r| r.progress.as_str()));
        let output = join_text(group.iter().map(|r| r.output.as_str()));
        let people = people_text_group(&group);

        if group.len() > 1 {
            sheet.merge_range(start, 3, end, 3, &content, body)?;
            sheet.merge_range(start, 4, end, 4, &progress, body)?;
            sheet.merge_range(start, 8, end, 8, &output, body)?;
            sheet.merge_range(start, 9, end, 9, &people, body)?;
            grouped_count += 1;

            if all_equal(group.iter().map(|r| r.effort.as_str()))
                && !group[0].effort.trim().is_empty()
            {
                sheet.merge_range(start, 5, end, 5, display_str(&group[0].effort), center)?;
            }
            if all_equal(group.iter().map(|r| r.cost_owner.as_str()))
                && !group[0].cost_owner.trim().is_empty()
            {
                sheet.merge_range(start, 6, end, 6, display_str(&group[0].cost_owner), center)?;
            }
            if all_equal(group.iter().map(|r| r.owner.as_str()))
                && !group[0].owner.trim().is_empty()
            {
                sheet.merge_range(start, 7, end, 7, display_str(&group[0].owner), body)?;
            }
        } else {
            sheet.write_string_with_format(start, 3, &content, body)?;
            sheet.write_string_with_format(start, 4, &progress, body)?;
            sheet.write_string_with_format(start, 8, &output, body)?;
            sheet.write_string_with_format(start, 9, &people, body)?;
        }

        let mut heights: Vec<f64> = group.iter().map(|item| estimate_row_height(item)).collect();
        let merged_needed = estimate_group_height(&content, &progress, &output, &people);
        let total: f64 = heights.iter().sum();
        let extra = ((merged_needed - total).max(0.0)) / group.len() as f64;
        for (i, height) in heights.iter_mut().enumerate() {
            *height += extra;
            sheet.set_row_height(start + i as u32, *height)?;
        }

        row = end + 1;
    }

    Ok((row, grouped_count))
}

fn display_str(s: &str) -> &str {
    if s.trim().is_empty() {
        "/"
    } else {
        s
    }
}

fn join_text<'a>(values: impl IntoIterator<Item = &'a str>) -> String {
    let parts: Vec<String> = values
        .into_iter()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
        .collect();
    if parts.is_empty() {
        "/".to_string()
    } else {
        parts.join("\n")
    }
}

fn person_text(person: &WeeklyReportPerson) -> String {
    let name = person.name.trim();
    let days = person.days.trim();
    if name.is_empty() {
        return String::new();
    }
    if days.is_empty() {
        name.to_string()
    } else {
        format!("{name}（{days}）")
    }
}

fn people_text_group(group: &[&WeeklyReportRow]) -> String {
    let parts: Vec<String> = group
        .iter()
        .flat_map(|row| row.people.iter())
        .map(person_text)
        .filter(|s| !s.is_empty())
        .collect();
    if parts.is_empty() {
        "/".to_string()
    } else {
        parts.join("\n")
    }
}

fn all_equal<'a>(mut values: impl Iterator<Item = &'a str>) -> bool {
    let Some(first) = values.next() else {
        return false;
    };
    let first = first.trim();
    values.all(|v| v.trim() == first)
}

fn estimate_row_height(row: &WeeklyReportRow) -> f64 {
    let lines = [
        text_lines(&row.category, 12.0),
        text_lines(&row.task_item, 18.0),
        text_lines(&row.effort, 12.0),
        text_lines(&row.cost_owner, 10.0),
        text_lines(&row.owner, 12.0),
    ]
    .into_iter()
    .max()
    .unwrap_or(1);
    (lines as f64 * 14.0 + 16.0).max(28.0)
}

fn estimate_group_height(content: &str, progress: &str, output: &str, people: &str) -> f64 {
    let lines = [
        text_lines(content, 46.0),
        text_lines(progress, 34.0),
        text_lines(output, 24.0),
        text_lines(people, 42.0),
    ]
    .into_iter()
    .max()
    .unwrap_or(1);
    (lines as f64 * 14.0 + 16.0).max(28.0)
}

fn estimate_text_height(text: &str, width: f64) -> f64 {
    (text_lines(text, width) as f64 * 14.0 + 16.0).max(28.0)
}

fn text_lines(text: &str, width: f64) -> usize {
    if text.trim().is_empty() {
        return 1;
    }
    text.split('\n')
        .map(|line| {
            let chars = line.chars().count() as f64;
            (chars / width).ceil().max(1.0) as usize
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(task_item: &str, people: Vec<(&str, &str)>) -> WeeklyReportRow {
        WeeklyReportRow {
            category: "产品研发".to_string(),
            task_item: task_item.to_string(),
            content: "内容".to_string(),
            progress: "进行中".to_string(),
            effort: "1".to_string(),
            cost_owner: "专项".to_string(),
            owner: "张三".to_string(),
            output: "代码".to_string(),
            people: people
                .into_iter()
                .map(|(name, days)| WeeklyReportPerson {
                    name: name.to_string(),
                    days: days.to_string(),
                })
                .collect(),
        }
    }

    #[test]
    fn groups_same_task_item_across_non_adjacent_rows() {
        let rows = vec![
            row("后端开发", vec![]),
            row("前端开发", vec![]),
            row("后端开发", vec![]),
        ];
        let groups = group_rows(&rows);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].len(), 2);
        assert_eq!(groups[0][0].task_item, "后端开发");
        assert_eq!(groups[1].len(), 1);
    }

    #[test]
    fn empty_task_items_are_not_grouped() {
        let rows = vec![row("", vec![]), row("", vec![])];
        let groups = group_rows(&rows);
        assert_eq!(groups.len(), 2);
    }

    #[test]
    fn people_text_uses_fullwidth_parentheses() {
        let row = row("后端开发", vec![("张三", "2"), ("李四", "0.5")]);
        assert_eq!(people_text_group(&[&row]), "张三（2）\n李四（0.5）");
    }

    #[test]
    fn join_text_falls_back_to_slash() {
        assert_eq!(join_text([""].into_iter()), "/");
        assert_eq!(join_text(["a", "", "b"].into_iter()), "a\nb");
    }

    #[test]
    fn export_builds_xlsx_with_grouped_rows() {
        let req = WeeklyReportExportRequest {
            week_label: "2026年第33周".to_string(),
            investment_report: "32".to_string(),
            investment_leave: "1".to_string(),
            summary: "编码规则管理开发".to_string(),
            done_rows: vec![row("后端开发", vec![]), row("后端开发", vec![])],
            plan_rows: vec![row("前端开发", vec![])],
        };
        let result = weekly_report_export(req).expect("export should succeed");
        assert!(!result.xlsx_b64.is_empty());
        assert_eq!(result.done_rows, 2);
        assert_eq!(result.grouped_done, 1);
        assert_eq!(result.grouped_plan, 0);
    }
}
