import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  BarChart3,
  Calendar,
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Filter,
  Loader2,
  Users,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ModuleHeader } from "@/components/module/module-header";
import { useAppStore } from "@/store/app-store";
import { PAGE_CONTAINER_CLASS, paddingToStyle } from "@/lib/spacing";
import { cn } from "@/lib/utils";

// ── Tauri command response shapes ────────────────────────────────────

type TaskRecord = {
  id: number;
  name: string;
  owner: string;
  type: string;
  phase: string;
  note: string;
  start: string;
  end: string;
  days: number;
  row_index: number;
};

type OwnerStat = { owner: string; tasks: number; days: number };
type TypeStat = { type: string; tasks: number; days: number };

type ParseResult = {
  sheet_name: string;
  total_rows: number;
  tasks: TaskRecord[];
  owners: OwnerStat[];
  types: TypeStat[];
  date_range: { earliest: string; latest: string };
  skipped_rows: number[];
};

type ExportResult = { xlsx_b64: string; written: number };

// ── Page ────────────────────────────────────────────────────────────

export function ExcelSchedulePage() {
  const contentPadding = useAppStore((s) => s.contentPadding);

  const [filePath, setFilePath] = useState<string | null>(null);
  const [data, setData] = useState<ParseResult | null>(null);

  // Filters
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickFile() {
    setError(null);
    setLoadingFile(true);
    try {
      const picked = await openDialog({
        multiple: false,
        filters: [{ name: "Excel", extensions: ["xlsx", "xls", "xlsm"] }],
      });
      if (!picked || Array.isArray(picked)) return;
      const fp = picked;
      setFilePath(fp);
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const buf = await readFile(fp);
      const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      const r = await invoke<ParseResult>("excel_schedule_parse", {
        req: { bytes: Array.from(u8), sheet_name: "" },
      });
      setData(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingFile(false);
    }
  }

  // Filtered list
  const filtered = useMemo(() => {
    if (!data) return [];
    return data.tasks.filter((t) => {
      if (ownerFilter && t.owner !== ownerFilter) return false;
      if (typeFilter && t.type !== typeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !t.name.toLowerCase().includes(q) &&
          !t.note.toLowerCase().includes(q) &&
          !t.owner.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [data, ownerFilter, typeFilter, search]);

  const ownerOptions = useMemo(
    () => (data?.owners ?? []).map((o) => o.owner).filter(Boolean),
    [data],
  );
  const typeOptions = useMemo(
    () => (data?.types ?? []).map((t) => t.type).filter(Boolean),
    [data],
  );

  async function exportXlsx() {
    if (!data || filtered.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const r = await invoke<ExportResult>("excel_schedule_export", {
        req: { tasks: filtered, sheet_name: data.sheet_name || "排期" },
      });
      const target = await saveDialog({
        defaultPath: `velora-schedule-${Date.now()}.xlsx`,
        filters: [{ name: "Excel", extensions: ["xlsx"] }],
      });
      if (!target) return;
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      const bin = atob(r.xlsx_b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      await writeFile(target, out);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={cn(PAGE_CONTAINER_CLASS, "gap-8")}
      style={paddingToStyle(contentPadding)}
    >
      <ModuleHeader moduleId="excel-schedule" />

      {/* Top filter bar — always visible */}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={pickFile} disabled={loadingFile}>
          {loadingFile ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileSpreadsheet className="h-4 w-4" />
          )}
          {filePath ? "换一份" : "选排期 Excel"}
        </Button>
        {filePath && (
          <span className="truncate font-mono text-[11.5px] text-foreground-muted max-w-[420px]">
            {filePath}
          </span>
        )}

        {data && (
          <>
            <FilterChip
              label="负责人"
              value={ownerFilter}
              options={ownerOptions}
              onChange={setOwnerFilter}
            />
            <FilterChip
              label="类型"
              value={typeFilter}
              options={typeOptions}
              onChange={setTypeFilter}
            />
            <div className="flex items-center gap-2 rounded-md border border-input bg-background px-2.5">
              <Filter className="h-3.5 w-3.5 text-foreground-muted" strokeWidth={1.75} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="任务 / 备注搜索"
                className="h-8 w-44 bg-transparent text-[12px] outline-none placeholder:text-foreground-subtle"
              />
            </div>
            <Button
              onClick={exportXlsx}
              disabled={saving || filtered.length === 0}
              variant="outline"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              导出过滤后的 {filtered.length} 行
            </Button>
          </>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {data ? (
        <ScheduleView
          data={data}
          filtered={filtered}
        />
      ) : (
        <EmptyState loading={loadingFile} hasFile={!!filePath} />
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function EmptyState({ loading, hasFile }: { loading: boolean; hasFile: boolean }) {
  return (
    <Card>
      <CardContent className="flex min-h-[420px] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-foreground-muted">
          {loading ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-sm">解析中…</span>
            </>
          ) : (
            <>
              <span className="grid h-12 w-12 place-items-center rounded-full border border-dashed border-border/80">
                <Calendar className="h-5 w-5 opacity-60" />
              </span>
              <span className="text-sm">
                {hasFile ? "解析失败，请检查列名" : "选个 .xlsx 开始解析"}
              </span>
              <span className="font-mono text-[10.5px] text-foreground-subtle">
                必须有列：name / owner / start / end（type / phase / note 可选）
              </span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ScheduleView({ data, filtered }: { data: ParseResult; filtered: TaskRecord[] }) {
  return (
    <div className="grid flex-1 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-6">
      <div className="flex flex-col gap-5">
        <GanttCard tasks={filtered} dateRange={data.date_range} />
        <TasksCard tasks={filtered} />
      </div>
      <div className="flex flex-col gap-5">
        <StatCard
          title="负责人统计"
          icon={Users}
          rows={data.owners}
          fields={(o) => [o.owner, o.tasks.toString(), `${o.days}d`]}
        />
        <StatCard
          title="类型统计"
          icon={BarChart3}
          rows={data.types}
          fields={(t) => [t.type, t.tasks.toString(), `${t.days}d`]}
        />
        {data.skipped_rows.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>跳过</CardTitle>
              <CardDescription>{data.skipped_rows.length} 行没识别出任务或日期</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="font-mono text-[10.5px] leading-relaxed text-foreground-muted">
                {data.skipped_rows.slice(0, 40).join(", ")}
                {data.skipped_rows.length > 40 && " …"}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function GanttCard({
  tasks,
  dateRange,
}: {
  tasks: TaskRecord[];
  dateRange: { earliest: string; latest: string };
}) {
  const gantt = useMemo(() => buildGantt(tasks, dateRange), [tasks, dateRange]);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>甘特</CardTitle>
            <CardDescription>
              {tasks.length} 行 ·{" "}
              {dateRange.earliest && dateRange.latest
                ? `${dateRange.earliest} → ${dateRange.latest}`
                : "未识别日期范围"}
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono">
            <BarChart3 className="mr-1 h-3 w-3" />
            {gantt.spanDays} 天
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="py-8 text-center font-mono text-[11.5px] text-foreground-subtle">
            没有匹配的任务
          </p>
        ) : gantt.spanDays <= 0 ? (
          <p className="py-8 text-center font-mono text-[11.5px] text-foreground-subtle">
            没识别到日期，画不出甘特图
          </p>
        ) : (
          <GanttList tasks={tasks} gantt={gantt} />
        )}
      </CardContent>
    </Card>
  );
}

interface Gantt {
  total: number;
  spanDays: number;
  xLabels: string[];
  originMs: number;
}

function buildGantt(
  tasks: TaskRecord[],
  dateRange: { earliest: string; latest: string },
): Gantt {
  if (tasks.length === 0) {
    return { total: 0, spanDays: 0, xLabels: [], originMs: 0 };
  }
  const earliest = dateRange.earliest || earliestOfTasks(tasks);
  const latest = dateRange.latest || latestOfTasks(tasks);
  if (!earliest || !latest) {
    return { total: tasks.length, spanDays: 0, xLabels: [], originMs: 0 };
  }
  const a = new Date(earliest).getTime();
  const b = new Date(latest).getTime();
  const spanDays = Math.max(1, Math.round((b - a) / 86400000) + 1);
  const labels: string[] = [];
  for (let i = 0; i <= 5; i++) {
    const t = new Date(a + ((spanDays - 1) * i / 5) * 86400000);
    labels.push(`${t.getMonth() + 1}/${t.getDate()}`);
  }
  return { total: tasks.length, spanDays, xLabels: labels, originMs: a };
}

function earliestOfTasks(tasks: TaskRecord[]): string {
  return tasks
    .map((t) => t.start)
    .filter(Boolean)
    .sort()[0] || "";
}

function latestOfTasks(tasks: TaskRecord[]): string {
  const ends = tasks.map((t) => t.end).filter(Boolean).sort();
  return ends[ends.length - 1] || "";
}

function GanttList({ tasks, gantt }: { tasks: TaskRecord[]; gantt: Gantt }) {
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[200px_minmax(0,1fr)] items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-foreground-subtle">
          {tasks.length} tasks
        </span>
        <div className="grid grid-cols-6 font-mono text-[10px] text-foreground-subtle">
          {gantt.xLabels.map((l, i) => (
            <span key={i} className="text-center">
              {l}
            </span>
          ))}
        </div>
      </div>
      {tasks.slice(0, 80).map((t) => (
        <GanttRow key={t.id} task={t} gantt={gantt} />
      ))}
      {tasks.length > 80 && (
        <p className="pt-2 text-center font-mono text-[10.5px] text-foreground-subtle">
          ……还有 {tasks.length - 80} 行
        </p>
      )}
    </div>
  );
}

function GanttRow({ task, gantt }: { task: TaskRecord; gantt: Gantt }) {
  if (!task.start) {
    return (
      <div className="grid grid-cols-[200px_minmax(0,1fr)] items-center gap-2">
        <span className="truncate font-mono text-[11.5px] text-foreground-muted">
          {task.name}
        </span>
        <span className="font-mono text-[10.5px] text-foreground-subtle">
          无日期
        </span>
      </div>
    );
  }
  const startMs = new Date(task.start).getTime();
  const endMs = task.end
    ? new Date(task.end).getTime()
    : startMs;
  const leftPct = Math.max(
    0,
    Math.min(100, ((startMs - gantt.originMs) / 86400000 / gantt.spanDays) * 100),
  );
  const widthPct = Math.max(
    0.6,
    Math.min(
      100 - leftPct,
      ((endMs - startMs) / 86400000 + 1) / gantt.spanDays * 100,
    ),
  );
  const tint = task.type
    ? TINT_BY_TYPE[hashString(task.type) % TINT_BY_TYPE.length]
    : "bg-primary/60";

  return (
    <div className="grid grid-cols-[200px_minmax(0,1fr)] items-center gap-2">
      <span
        className="truncate font-mono text-[11.5px] text-foreground"
        title={task.name}
      >
        {task.name}
      </span>
      <div className="relative h-5 overflow-hidden rounded-md bg-border/30">
        <div
          className={cn(
            "absolute inset-y-0 rounded-md",
            tint,
            "shadow-[0_0_0_1px_oklch(0_0_0_/_0.04)]",
          )}
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          title={`${task.start} → ${task.end} · ${task.days}d · ${task.owner}`}
        />
        {task.days > 0 && (
          <span
            className="pointer-events-none absolute inset-y-0 flex items-center font-mono text-[10px] text-primary-foreground/90"
            style={{ left: `calc(${leftPct}% + 4px)` }}
          >
            {task.days}d
          </span>
        )}
      </div>
    </div>
  );
}

const TINT_BY_TYPE = [
  "bg-primary",
  "bg-accent-emerald",
  "bg-accent-amber",
  "bg-accent-rose",
  "bg-[#6366f1]",
  "bg-[#0ea5e9]",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function FilterChip({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = !!value;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 font-mono text-[11.5px]",
          active
            ? "border-primary/40 bg-primary/[0.08] text-primary"
            : "border-border bg-background text-foreground-muted hover:border-primary/30 hover:text-foreground",
        )}
      >
        {label}：{value || "全部"}
        {active ? (
          <X
            className="h-3 w-3"
            strokeWidth={2}
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
          />
        ) : (
          <ChevronDown className="h-3 w-3" strokeWidth={2} />
        )}
      </button>
      {open && options.length > 0 && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-border bg-background-overlay shadow-diffusion glass-edge">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between px-3 py-1.5 text-left font-mono text-[11.5px] hover:bg-accent/40",
                o === value && "bg-primary/[0.08] text-foreground",
              )}
            >
              <span>{o}</span>
              {o === value && <Check className="h-3 w-3 text-primary" strokeWidth={2.25} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TasksCard({ tasks }: { tasks: TaskRecord[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>任务列表</CardTitle>
        <CardDescription>导出按当前过滤结果走</CardDescription>
      </CardHeader>
      <CardContent>
        <TasksTable tasks={tasks} />
      </CardContent>
    </Card>
  );
}

function TasksTable({ tasks }: { tasks: TaskRecord[] }) {
  if (tasks.length === 0) {
    return (
      <p className="py-4 text-center font-mono text-[11.5px] text-foreground-subtle">
        没有任务
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th className="border-b border-border/60 px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.06em] text-foreground-muted">
              任务
            </th>
            <th className="border-b border-border/60 px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.06em] text-foreground-muted">
              负责人
            </th>
            <th className="border-b border-border/60 px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.06em] text-foreground-muted">
              类型
            </th>
            <th className="border-b border-border/60 px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.06em] text-foreground-muted">
              阶段
            </th>
            <th className="border-b border-border/60 px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.06em] text-foreground-muted">
              开始
            </th>
            <th className="border-b border-border/60 px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.06em] text-foreground-muted">
              结束
            </th>
            <th className="border-b border-border/60 px-3 py-2 text-right font-mono text-[11px] uppercase tracking-[0.06em] text-foreground-muted">
              天
            </th>
          </tr>
        </thead>
        <tbody>
          {tasks.slice(0, 200).map((t) => (
            <tr key={t.id} className="transition-colors hover:bg-accent/30">
              <td className="border-b border-border/30 px-3 py-1.5 align-top font-mono text-[11.5px] text-foreground">
                {t.name}
              </td>
              <td className="border-b border-border/30 px-3 py-1.5 align-top font-mono text-[11.5px]">
                {t.owner}
              </td>
              <td className="border-b border-border/30 px-3 py-1.5 align-top font-mono text-[11.5px]">
                {t.type}
              </td>
              <td className="border-b border-border/30 px-3 py-1.5 align-top font-mono text-[11.5px]">
                {t.phase}
              </td>
              <td className="border-b border-border/30 px-3 py-1.5 align-top font-mono text-[11.5px]">
                {t.start || (
                  <span className="text-foreground-subtle">∅</span>
                )}
              </td>
              <td className="border-b border-border/30 px-3 py-1.5 align-top font-mono text-[11.5px]">
                {t.end || (
                  <span className="text-foreground-subtle">∅</span>
                )}
              </td>
              <td className="border-b border-border/30 px-3 py-1.5 align-top text-right font-mono text-[11.5px]">
                {t.days}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {tasks.length > 200 && (
        <p className="mt-3 text-center font-mono text-[10.5px] text-foreground-subtle">
          ……还有 {tasks.length - 200} 行，导出后看完整版
        </p>
      )}
    </div>
  );
}

function StatCard<T>({
  title,
  icon: Icon,
  rows,
  fields,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  rows: T[];
  fields: (row: T) => [string, string, string];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {rows.length === 0 && (
          <p className="font-mono text-[10.5px] text-foreground-subtle">无数据</p>
        )}
        {rows.slice(0, 12).map((r, i) => {
          const [k, v1, v2] = fields(r);
          return (
            <div
              key={i}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1"
            >
              <span className="flex-1 truncate font-mono text-[11.5px] text-foreground">
                {k}
              </span>
              <span className="font-mono text-[10.5px] text-foreground-muted">
                {v1}
              </span>
              <span className="font-mono text-[10px] text-foreground-subtle">
                {v2}
              </span>
            </div>
          );
        })}
        {rows.length > 12 && (
          <p className="pt-1 font-mono text-[10px] text-foreground-subtle">
            还有 {rows.length - 12} 项
          </p>
        )}
      </CardContent>
    </Card>
  );
}