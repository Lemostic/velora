import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  Check,
  ClipboardList,
  Download,
  ListPlus,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ModuleHeader } from "@/components/module/module-header";
import { PageBody } from "@/components/module/page-body";
import { PAGE_CONTAINER_CLASS, paddingToStyle } from "@/lib/spacing";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import {
  createEmptyRow,
  useWeeklyReportStore,
  type PersonDay,
  type ReportSection,
  type WeeklyTaskRow,
} from "@/store/weekly-report-store";

type ExportResult = {
  xlsx_b64: string;
  done_rows: number;
  plan_rows: number;
  grouped_done: number;
  grouped_plan: number;
};

const CATEGORY_OPTIONS = [
  "需求分析",
  "产品研发",
  "产品运维",
  "测试消缺",
  "管理工作",
  "其他",
];

const COST_OPTIONS = ["专项", "项目", "产品", "请假", "/"];

const DONE_HEADERS = [
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

const PLAN_HEADERS = [
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

export function WeeklyReportPage() {
  const contentPadding = useAppStore((s) => s.contentPadding);
  const report = useWeeklyReportStore();
  const [section, setSection] = useState<ReportSection>("done");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<WeeklyTaskRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = section === "done" ? report.doneRows : report.planRows;
  const headers = section === "done" ? DONE_HEADERS : PLAN_HEADERS;

  function openCreate() {
    setEditingRow(createEmptyRow());
    setEditorOpen(true);
  }

  function openEdit(row: WeeklyTaskRow) {
    setEditingRow({
      ...row,
      people: row.people.map((p) => ({ ...p })),
    });
    setEditorOpen(true);
  }

  function handleSave(row: WeeklyTaskRow) {
    if (editingRow) {
      report.updateRow(section, editingRow.id, row);
    } else {
      report.addRow(section, row);
    }
    setEditorOpen(false);
  }

  async function exportReport() {
    setSaving(true);
    setError(null);
    try {
      const result = await invoke<ExportResult>("weekly_report_export", {
        req: {
          weekLabel: report.weekLabel,
          investmentReport: report.investmentReport,
          investmentLeave: report.investmentLeave,
          summary: report.summary,
          doneRows: report.doneRows,
          planRows: report.planRows,
        },
      });
      const base = sanitizeFileName(
        report.weekLabel.trim() ||
          `周报-${new Date().toISOString().slice(0, 10)}`,
      );
      const target = await saveDialog({
        defaultPath: `${base}.xlsx`,
        filters: [{ name: "Excel", extensions: ["xlsx"] }],
      });
      if (!target) return;
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      const bin = atob(result.xlsx_b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await writeFile(target, bytes);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={cn(PAGE_CONTAINER_CLASS, "gap-6")}
      style={paddingToStyle(contentPadding)}
    >
      <ModuleHeader moduleId="weekly-report" />
      <PageBody gap="gap-5">
        <SummaryCard
          weekLabel={report.weekLabel}
          investmentReport={report.investmentReport}
          investmentLeave={report.investmentLeave}
          summary={report.summary}
          onWeekLabelChange={report.setWeekLabel}
          onInvestmentReportChange={report.setInvestmentReport}
          onInvestmentLeaveChange={report.setInvestmentLeave}
          onSummaryChange={report.setSummary}
        />

        <TaskSection
          section={section}
          onSectionChange={setSection}
          rows={rows}
          headers={headers}
          saving={saving}
          onAdd={openCreate}
          onEdit={openEdit}
          onDuplicate={(id) => report.duplicateRow(section, id)}
          onDelete={(id) => report.removeRow(section, id)}
          onClear={() => report.clearSection(section)}
          onExport={exportReport}
        />

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </PageBody>

      <RowEditorDialog
        key={editingRow?.id ?? "new"}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        section={section}
        row={editingRow}
        onSave={handleSave}
      />
    </div>
  );
}

function SummaryCard({
  weekLabel,
  investmentReport,
  investmentLeave,
  summary,
  onWeekLabelChange,
  onInvestmentReportChange,
  onInvestmentLeaveChange,
  onSummaryChange,
}: {
  weekLabel: string;
  investmentReport: string;
  investmentLeave: string;
  summary: string;
  onWeekLabelChange: (value: string) => void;
  onInvestmentReportChange: (value: string) => void;
  onInvestmentLeaveChange: (value: string) => void;
  onSummaryChange: (value: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="inline-flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" strokeWidth={1.75} />
            周报概览
          </CardTitle>
          <CardDescription>投入情况与主要产出会写进 Excel 顶部</CardDescription>
        </div>
        <Badge variant="outline" className="font-mono">
          {weekLabel || "未设置周次"}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="周次">
            <input
              value={weekLabel}
              onChange={(e) => onWeekLabelChange(e.target.value)}
              placeholder="2026年第33周"
              className={inputClass}
            />
          </Field>
          <Field label="产品报工 (人天)">
            <input
              value={investmentReport}
              onChange={(e) => onInvestmentReportChange(e.target.value)}
              inputMode="decimal"
              placeholder="32"
              className={inputClass}
            />
          </Field>
          <Field label="请假 (人天)">
            <input
              value={investmentLeave}
              onChange={(e) => onInvestmentLeaveChange(e.target.value)}
              inputMode="decimal"
              placeholder="1"
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="本周主要产出">
          <textarea
            value={summary}
            onChange={(e) => onSummaryChange(e.target.value)}
            rows={4}
            placeholder="一行一条产出说明"
            className={cn(inputClass, "resize-none leading-relaxed")}
          />
        </Field>
      </CardContent>
    </Card>
  );
}

function TaskSection({
  section,
  onSectionChange,
  rows,
  headers,
  saving,
  onAdd,
  onEdit,
  onDuplicate,
  onDelete,
  onClear,
  onExport,
}: {
  section: ReportSection;
  onSectionChange: (section: ReportSection) => void;
  rows: WeeklyTaskRow[];
  headers: string[];
  saving: boolean;
  onAdd: () => void;
  onEdit: (row: WeeklyTaskRow) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onExport: () => void;
}) {
  const totalPeople = useMemo(
    () => rows.reduce((sum, row) => sum + row.people.length, 0),
    [rows],
  );
  const totalEffort = useMemo(() => sumEffort(rows), [rows]);
  const itemCounts = useMemo(() => countTaskItems(rows), [rows]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div className="flex items-center gap-2">
          <TabButton
            active={section === "done"}
            onClick={() => onSectionChange("done")}
          >
            本周完成情况
            <span className="font-mono text-[10px] opacity-70">
              {rows.length}
            </span>
          </TabButton>
          <TabButton
            active={section === "plan"}
            onClick={() => onSectionChange("plan")}
          >
            下周工作计划
            <span className="font-mono text-[10px] opacity-70">
              {rows.length}
            </span>
          </TabButton>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono">
            {totalPeople} 人次 · {totalEffort} 人天
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={onClear}
            disabled={rows.length === 0}
          >
            <X className="h-3.5 w-3.5" />
            清空
          </Button>
          <Button onClick={onAdd} size="sm">
            <Plus className="h-3.5 w-3.5" />
            新增条目
          </Button>
          <Button
            size="sm"
            onClick={onExport}
            disabled={saving || (rows.length === 0 && section === "plan")}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            导出 Excel
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0 pt-0">
        {rows.length === 0 ? (
          <EmptyRows onAdd={onAdd} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1240px] border-collapse text-[12px]">
              <thead>
                <tr>
                  {headers.map((header) => (
                    <th
                      key={header}
                      className="whitespace-pre-line border-b border-border/60 bg-background-overlay/40 px-2.5 py-2 text-left font-mono text-[10.5px] font-medium tracking-[0.04em] text-foreground-muted"
                    >
                      {header}
                    </th>
                  ))}
                  <th className="sticky right-0 border-b border-border/60 bg-background-overlay/40 px-2 py-2 font-mono text-[10.5px] font-medium tracking-[0.04em] text-foreground-muted">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const count = row.taskItem.trim()
                    ? itemCounts.get(row.taskItem.trim()) ?? 1
                    : 1;
                  return (
                    <tr
                      key={row.id}
                      className="align-top transition-colors hover:bg-accent/30"
                    >
                      <td className="border-b border-border/30 px-2.5 py-2 text-center font-mono text-[11px] text-foreground-muted">
                        {index + 1}
                      </td>
                      <Cell value={row.category} />
                      <td className="border-b border-border/30 px-2.5 py-2">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="line-clamp-2 whitespace-pre-line font-mono text-[11.5px] text-foreground"
                            title={row.taskItem}
                          >
                            {row.taskItem || "/"}
                          </span>
                          {count > 1 && (
                            <Badge
                              variant="outline"
                              className="shrink-0 px-1.5 py-0 text-[9.5px] font-mono"
                            >
                              ×{count}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <Cell value={row.content} />
                      <Cell value={row.progress} />
                      <td className="border-b border-border/30 px-2.5 py-2 text-center font-mono text-[11.5px]">
                        {row.effort || "/"}
                      </td>
                      <Cell value={row.costOwner} center />
                      <Cell value={row.owner} />
                      <Cell value={row.output} />
                      <Cell value={peopleText(row.people)} />
                      <td className="sticky right-0 border-b border-border/30 bg-background px-2 py-1.5">
                        <div className="flex items-center justify-end gap-0.5">
                          <IconButton
                            label="编辑"
                            onClick={() => onEdit(row)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton
                            label="复制"
                            onClick={() => onDuplicate(row.id)}
                          >
                            <ListPlus className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton
                            label="删除"
                            onClick={() => onDelete(row.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyRows({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-foreground-muted">
      <span className="grid h-12 w-12 place-items-center rounded-full border border-dashed border-border/80">
        <ClipboardList className="h-5 w-5 opacity-60" />
      </span>
      <span className="text-sm">还没有条目</span>
      <Button variant="outline" size="sm" onClick={onAdd}>
        <Plus className="h-3.5 w-3.5" />
        新增第一条
      </Button>
    </div>
  );
}

function Cell({
  value,
  center = false,
}: {
  value: string;
  center?: boolean;
}) {
  return (
    <td
      className={cn(
        "border-b border-border/30 px-2.5 py-2 font-mono text-[11.5px]",
        center && "text-center",
      )}
    >
      <span
        className={cn(
          "line-clamp-3 block max-w-[220px] whitespace-pre-line",
          center && "text-center",
        )}
        title={value}
      >
        {value || "/"}
      </span>
    </td>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11.5px] transition-colors",
        active
          ? "border-primary/40 bg-primary/[0.08] text-primary"
          : "border-border bg-background text-foreground-muted hover:border-primary/30 hover:text-foreground",
      )}
    >
      {active && <Check className="h-3 w-3" strokeWidth={2.25} />}
      {children}
    </button>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7 rounded-md"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function RowEditorDialog({
  open,
  onOpenChange,
  section,
  row,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: ReportSection;
  row: WeeklyTaskRow | null;
  onSave: (row: WeeklyTaskRow) => void;
}) {
  const [draft, setDraft] = useState<WeeklyTaskRow | null>(row);
  const [dialogError, setDialogError] = useState<string | null>(null);

  useEffect(() => {
    if (open && row) {
      setDraft({
        ...row,
        people: row.people.map((p) => ({ ...p })),
      });
      setDialogError(null);
    }
  }, [open, row]);

  function patch(patch: Partial<WeeklyTaskRow>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function updatePeople(next: PersonDay[]) {
    setDraft((d) => {
      if (!d) return d;
      const auto = formatDays(sumDays(next));
      return { ...d, people: next, effort: auto || d.effort };
    });
  }

  function submit() {
    if (!draft) return;
    if (!draft.taskItem.trim() && !draft.content.trim()) {
      setDialogError("请填写工作任务项或计划任务内容");
      return;
    }
    onSave({
      ...draft,
      category: draft.category.trim(),
      taskItem: draft.taskItem.trim(),
      content: draft.content.trim(),
      progress: draft.progress.trim(),
      effort: draft.effort.trim(),
      costOwner: draft.costOwner.trim(),
      owner: draft.owner.trim(),
      output: draft.output.trim(),
      people: draft.people
        .map((p) => ({ ...p, name: p.name.trim(), days: p.days.trim() }))
        .filter((p) => p.name || p.days),
    });
  }

  const effortLabel =
    section === "done" ? "本周实际投入 (人天)" : "下周计划投入 (人天)";
  const progressLabel =
    section === "done"
      ? "进度完成情况&异常说明"
      : "本周进度要求&检查点";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogTitle>
          {row && row.content ? "编辑条目" : "新增条目"}
        </DialogTitle>
        <DialogDescription>
          {section === "done" ? "本周工作完成情况" : "下周工作计划"}
        </DialogDescription>

        {draft && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="工作类别">
              <input
                value={draft.category}
                onChange={(e) => patch({ category: e.target.value })}
                list="weekly-category-options"
                className={inputClass}
              />
            </Field>
            <Field label="工作任务项">
              <input
                value={draft.taskItem}
                onChange={(e) => patch({ taskItem: e.target.value })}
                placeholder="如：后端模块开发"
                className={inputClass}
              />
            </Field>

            <Field label="计划任务内容" className="sm:col-span-2">
              <textarea
                value={draft.content}
                onChange={(e) => patch({ content: e.target.value })}
                rows={4}
                placeholder="一行一条子项"
                className={cn(inputClass, "resize-none leading-relaxed")}
              />
            </Field>

            <Field label={progressLabel} className="sm:col-span-2">
              <textarea
                value={draft.progress}
                onChange={(e) => patch({ progress: e.target.value })}
                rows={3}
                placeholder="完成 / 进行中 / 异常说明"
                className={cn(inputClass, "resize-none leading-relaxed")}
              />
            </Field>

            <Field label={effortLabel}>
              <input
                value={draft.effort}
                onChange={(e) => patch({ effort: e.target.value })}
                inputMode="decimal"
                className={inputClass}
              />
            </Field>
            <Field label="成本归属">
              <input
                value={draft.costOwner}
                onChange={(e) => patch({ costOwner: e.target.value })}
                list="weekly-cost-options"
                className={inputClass}
              />
            </Field>
            <Field label="负责人">
              <input
                value={draft.owner}
                onChange={(e) => patch({ owner: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="输出工件">
              <input
                value={draft.output}
                onChange={(e) => patch({ output: e.target.value })}
                className={inputClass}
              />
            </Field>

            <div className="sm:col-span-2">
              <div className="mb-1.5 text-[11px] font-medium tracking-[0.06em] text-foreground-muted">
                投入人员（人天）
              </div>
              <div className="space-y-2 rounded-md border border-border bg-background-overlay/30 p-2.5">
                {draft.people.length === 0 && (
                  <p className="text-[11.5px] text-foreground-subtle">
                    暂无人员
                  </p>
                )}
                {draft.people.map((person, index) => (
                  <div
                    key={person.id}
                    className="grid grid-cols-[minmax(0,1fr)_96px_28px] gap-2"
                  >
                    <input
                      value={person.name}
                      onChange={(e) => {
                        const next = draft.people.map((p, i) =>
                          i === index ? { ...p, name: e.target.value } : p,
                        );
                        updatePeople(next);
                      }}
                      placeholder="姓名"
                      className={inputClass}
                    />
                    <input
                      value={person.days}
                      onChange={(e) => {
                        const next = draft.people.map((p, i) =>
                          i === index ? { ...p, days: e.target.value } : p,
                        );
                        updatePeople(next);
                      }}
                      inputMode="decimal"
                      placeholder="人天"
                      className={cn(inputClass, "text-center")}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-md"
                      aria-label="移除人员"
                      title="移除人员"
                      onClick={() =>
                        updatePeople(
                          draft.people.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updatePeople([
                      ...draft.people,
                      { id: uid(), name: "", days: "" },
                    ])
                  }
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  添加人员
                </Button>
              </div>
            </div>
          </div>
        )}

        {dialogError && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {dialogError}
          </div>
        )}

        <div className="mt-2 flex items-center justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline">取消</Button>
          </DialogClose>
          <Button onClick={submit}>
            <Check className="h-4 w-4" />
            保存
          </Button>
        </div>
      </DialogContent>

      <datalist id="weekly-category-options">
        {CATEGORY_OPTIONS.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <datalist id="weekly-cost-options">
        {COST_OPTIONS.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </Dialog>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[11px] font-medium tracking-[0.06em] text-foreground-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-2.5 text-[12.5px] text-foreground outline-none transition-colors placeholder:text-foreground-subtle focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50";

function sumDays(people: PersonDay[]): number {
  return people.reduce((sum, person) => {
    const value = Number(person.days.trim());
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function sumEffort(rows: WeeklyTaskRow[]): string {
  const numeric = rows.reduce((sum, row) => {
    const value = Number(row.effort.trim());
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  return formatDays(numeric);
}

function formatDays(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "";
  return Number.isInteger(value)
    ? String(value)
    : String(Math.round(value * 100) / 100);
}

function peopleText(people: PersonDay[]): string {
  const parts = people
    .map((person) => {
      const name = person.name.trim();
      if (!name) return "";
      return person.days.trim()
        ? `${name}（${person.days.trim()}）`
        : name;
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join("、") : "/";
}

function countTaskItems(rows: WeeklyTaskRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.taskItem.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "周报";
}

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
