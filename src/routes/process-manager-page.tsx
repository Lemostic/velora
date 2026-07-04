import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Cpu,
  Eye,
  EyeOff,
  Filter,
  Loader2,
  Pause,
  Play,
  Search as SearchIcon,
  Skull,
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

type ProcessInfo = {
  pid: number;
  name: string;
  exe_path: string;
  user_id: string;
  status: string;
  mem_bytes: number;
  cpu_pct: number;
  start_time_ms: number;
  disk_read_bytes: number;
  disk_write_bytes: number;
};

type Result = {
  processes: ProcessInfo[];
  total: number;
  captured_at_ms: number;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatStartTime(ms: number, nowMs: number): string {
  if (ms <= 0) return "—";
  const deltaSec = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (deltaSec < 60) return `${deltaSec}s`;
  if (deltaSec < 3600) return `${Math.round(deltaSec / 60)}m`;
  if (deltaSec < 86400) return `${Math.round(deltaSec / 3600)}h`;
  return `${Math.round(deltaSec / 86400)}d`;
}

// ── Column model ────────────────────────────────────────────────────

type ColumnId =
  | "pid"
  | "name"
  | "user"
  | "status"
  | "cpu"
  | "mem"
  | "disk_read"
  | "disk_write"
  | "start_time";

interface ColumnDef {
  id: ColumnId;
  label: string;
  /** default visibility on first load */
  defaultOn: boolean;
  /** tailwind min-width class on the th */
  widthClass: string;
  /** alignment */
  align: "left" | "right";
  /** rendering for a row */
  render: (p: ProcessInfo, nowMs: number) => React.ReactNode;
}

const COLUMNS: ColumnDef[] = [
  {
    id: "pid",
    label: "PID",
    defaultOn: true,
    widthClass: "w-[64px]",
    align: "right",
    render: (p) => (
      <span className="font-mono text-[11.5px]">{p.pid}</span>
    ),
  },
  {
    id: "name",
    label: "名称",
    defaultOn: true,
    widthClass: "w-[260px]",
    align: "left",
    render: (p) => (
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[11.5px] text-foreground">
          {p.name}
        </span>
        {p.exe_path && (
          <span className="truncate font-mono text-[10.5px] text-foreground-subtle max-w-[320px]">
            {p.exe_path}
          </span>
        )}
      </div>
    ),
  },
  {
    id: "user",
    label: "用户",
    defaultOn: true,
    widthClass: "w-[120px]",
    align: "left",
    render: (p) => (
      <span className="font-mono text-[11.5px] text-foreground-muted">
        {p.user_id || "—"}
      </span>
    ),
  },
  {
    id: "status",
    label: "状态",
    defaultOn: true,
    widthClass: "w-[100px]",
    align: "left",
    render: (p) => (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10.5px]",
          statusTone(p.status),
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            statusDot(p.status),
          )}
        />
        {p.status}
      </span>
    ),
  },
  {
    id: "cpu",
    label: "CPU",
    defaultOn: true,
    widthClass: "w-[140px]",
    align: "right",
    render: (p) => <CpuBar value={p.cpu_pct} />,
  },
  {
    id: "mem",
    label: "内存",
    defaultOn: true,
    widthClass: "w-[100px]",
    align: "right",
    render: (p) => (
      <span className="font-mono text-[11.5px]">{formatBytes(p.mem_bytes)}</span>
    ),
  },
  {
    id: "disk_read",
    label: "磁盘读",
    defaultOn: false,
    widthClass: "w-[100px]",
    align: "right",
    render: (p) => (
      <span className="font-mono text-[11.5px] text-foreground-muted">
        {p.disk_read_bytes > 0 ? formatBytes(p.disk_read_bytes) : "—"}
      </span>
    ),
  },
  {
    id: "disk_write",
    label: "磁盘写",
    defaultOn: false,
    widthClass: "w-[100px]",
    align: "right",
    render: (p) => (
      <span className="font-mono text-[11.5px] text-foreground-muted">
        {p.disk_write_bytes > 0 ? formatBytes(p.disk_write_bytes) : "—"}
      </span>
    ),
  },
  {
    id: "start_time",
    label: "启动时长",
    defaultOn: false,
    widthClass: "w-[96px]",
    align: "right",
    render: (p, now) => (
      <span className="font-mono text-[11.5px] text-foreground-muted">
        {formatStartTime(p.start_time_ms, now)}
      </span>
    ),
  },
];

const DEFAULT_VISIBLE: ColumnId[] = COLUMNS.filter((c) => c.defaultOn).map(
  (c) => c.id,
);

const STORAGE_KEY = "velora.process-manager.visible-columns.v1";

function loadVisible(): Set<ColumnId> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set(DEFAULT_VISIBLE);
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr as ColumnId[]);
  } catch {
    // ignore
  }
  return new Set(DEFAULT_VISIBLE);
}

function saveVisible(set: Set<ColumnId>) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Array.from(set)),
    );
  } catch {
    // ignore
  }
}

function statusTone(status: string): string {
  switch (status) {
    case "Running":
      return "border-accent-emerald/30 bg-accent-emerald/[0.08] text-accent-emerald";
    case "Sleeping":
      return "border-border bg-background-overlay/40 text-foreground-muted";
    case "Stopped":
    case "Traced":
      return "border-accent-amber/30 bg-accent-amber/[0.08] text-accent-amber";
    case "Zombie":
    case "Dead":
      return "border-accent-rose/30 bg-accent-rose/[0.08] text-accent-rose";
    default:
      return "border-border bg-background-overlay/40 text-foreground-subtle";
  }
}

function statusDot(status: string): string {
  switch (status) {
    case "Running":
      return "bg-accent-emerald";
    case "Sleeping":
      return "bg-foreground-subtle";
    case "Stopped":
    case "Traced":
      return "bg-accent-amber";
    case "Zombie":
    case "Dead":
      return "bg-accent-rose";
    default:
      return "bg-foreground-subtle";
  }
}

type SortKey = ColumnId;

export function ProcessManagerPage() {
  const contentPadding = useAppStore((s) => s.contentPadding);
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("pid");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [confirmPid, setConfirmPid] = useState<number | null>(null);
  const [visible, setVisible] = useState<Set<ColumnId>>(() => loadVisible());
  const [colPickerOpen, setColPickerOpen] = useState(false);

  useEffect(() => {
    saveVisible(visible);
  }, [visible]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await invoke<Result>("list_processes", {
        req: { name_filter: filter, limit: 500 },
      });
      setData(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, filter]);

  const rows = useMemo(() => {
    if (!data) return [];
    const r = [...data.processes];
    r.sort((a, b) => compareRow(a, b, sortKey, sortDir));
    return r;
  }, [data, sortKey, sortDir]);

  const activeCols = useMemo(
    () => COLUMNS.filter((c) => visible.has(c.id)),
    [visible],
  );

  async function kill(pid: number) {
    if (!data) return;
    try {
      const r = await invoke<{ killed: boolean; message: string }>(
        "kill_process",
        { req: { pid, list_total: data.total } },
      );
      if (r.killed) {
        setConfirmPid(null);
        await refresh();
      } else {
        setError(r.message);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  function toggleCol(id: ColumnId) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function resetCols() {
    setVisible(new Set(DEFAULT_VISIBLE));
  }

  return (
    <div
      className={cn(PAGE_CONTAINER_CLASS, "gap-8")}
      style={paddingToStyle(contentPadding)}
    >
      <ModuleHeader moduleId="process-manager" />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)] xl:gap-6">
        <Card className="flex min-h-0 flex-col h-full">
          <CardHeader>
            <CardTitle>过滤</CardTitle>
            <CardDescription>sysinfo 实时拉取本机进程</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                名称过滤
              </label>
              <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3">
                <Filter className="h-3.5 w-3.5 text-foreground-muted" strokeWidth={1.75} />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="如 chrome / velora"
                  className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-foreground-subtle"
                />
              </div>
            </div>

            <Button onClick={refresh} disabled={loading} className="w-full">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? "拉取中…" : "刷新一次"}
            </Button>

            <button
              type="button"
              onClick={() => setAuto((a) => !a)}
              className={cn(
                "inline-flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                auto
                  ? "border-primary/40 bg-primary/[0.08] text-primary"
                  : "border-border bg-background text-foreground-muted hover:border-primary/30 hover:text-foreground",
              )}
            >
              {auto ? (
                <Pause className="h-3.5 w-3.5" strokeWidth={1.75} />
              ) : (
                <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              {auto ? "停止自动刷新" : "每 2 秒自动刷新"}
            </button>

            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                {error}
              </div>
            )}

            {data && (
              <p className="font-mono text-[10.5px] text-foreground-subtle">
                共 {data.total} 个进程 · 快照于{" "}
                {new Date(data.captured_at_ms).toLocaleTimeString()}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col h-full">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>进程列表</CardTitle>
                <CardDescription>
                  {data ? `当前 ${rows.length} 行` : "未拉取"}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {data && (
                  <Badge variant="outline" className="font-mono">
                    <Cpu className="mr-1 h-3 w-3" />
                    CPU avg {avgCpu(rows).toFixed(1)}%
                  </Badge>
                )}
                <ColumnPicker
                  open={colPickerOpen}
                  setOpen={setColPickerOpen}
                  visible={visible}
                  onToggle={toggleCol}
                  onReset={resetCols}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            {data ? (
              <ProcessTable
                rows={rows}
                columns={activeCols}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={(k) => {
                  if (sortKey === k) {
                    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                  } else {
                    setSortKey(k);
                    setSortDir(k === "name" || k === "user" ? "asc" : "desc");
                  }
                }}
                nowMs={data.captured_at_ms}
                confirmingPid={confirmPid}
                onConfirm={setConfirmPid}
                onKill={kill}
                onCancel={() => setConfirmPid(null)}
              />
            ) : (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 px-6 py-12 text-foreground-muted">
                <span className="grid h-12 w-12 place-items-center rounded-full border border-dashed border-border/80">
                  <Cpu className="h-5 w-5 opacity-60" />
                </span>
                <span className="text-sm">点击「刷新一次」开始</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Compare / Aggregate helpers ────────────────────────────────────

function compareRow(
  a: ProcessInfo,
  b: ProcessInfo,
  key: SortKey,
  dir: "asc" | "desc",
): number {
  let d = 0;
  switch (key) {
    case "pid":
      d = a.pid - b.pid;
      break;
    case "name":
      d = a.name.localeCompare(b.name);
      break;
    case "user":
      d = a.user_id.localeCompare(b.user_id);
      break;
    case "status":
      d = a.status.localeCompare(b.status);
      break;
    case "cpu":
      d = a.cpu_pct - b.cpu_pct;
      break;
    case "mem":
      d = a.mem_bytes - b.mem_bytes;
      break;
    case "disk_read":
      d = a.disk_read_bytes - b.disk_read_bytes;
      break;
    case "disk_write":
      d = a.disk_write_bytes - b.disk_write_bytes;
      break;
    case "start_time":
      d = a.start_time_ms - b.start_time_ms;
      break;
  }
  return dir === "asc" ? d : -d;
}

function avgCpu(rows: ProcessInfo[]): number {
  if (rows.length === 0) return 0;
  return rows.reduce((a, r) => a + r.cpu_pct, 0) / rows.length;
}

// ── Column picker popover ──────────────────────────────────────────

function ColumnPicker({
  open,
  setOpen,
  visible,
  onToggle,
  onReset,
}: {
  open: boolean;
  setOpen: (o: boolean) => void;
  visible: Set<ColumnId>;
  onToggle: (id: ColumnId) => void;
  onReset: () => void;
}) {
  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        className="h-7 gap-1.5 px-2.5 font-mono text-[11.5px]"
      >
        {open ? (
          <EyeOff className="h-3 w-3" strokeWidth={1.75} />
        ) : (
          <Eye className="h-3 w-3" strokeWidth={1.75} />
        )}
        列 · {visible.size}/{COLUMNS.length}
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-md border border-border bg-background-overlay shadow-diffusion glass-edge">
          <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-foreground-muted">
              显示列
            </span>
            <button
              type="button"
              onClick={onReset}
              className="font-mono text-[10.5px] text-primary hover:underline"
            >
              重置默认
            </button>
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {COLUMNS.map((c) => {
              const on = visible.has(c.id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onToggle(c.id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-accent/40",
                      on && "text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-3.5 w-3.5 place-items-center rounded-sm border transition-colors",
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background",
                      )}
                      aria-pressed={on}
                    >
                      {on && (
                        <svg
                          viewBox="0 0 12 12"
                          className="h-2.5 w-2.5"
                          aria-hidden
                        >
                          <path
                            d="M2 6l3 3 5-7"
                            stroke="currentColor"
                            strokeWidth="2"
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                    <span className="font-mono text-[11.5px]">{c.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Process table ──────────────────────────────────────────────────

function ProcessTable({
  rows,
  columns,
  sortKey,
  sortDir,
  onSort,
  nowMs,
  confirmingPid,
  onConfirm,
  onKill,
  onCancel,
}: {
  rows: ProcessInfo[];
  columns: ColumnDef[];
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  nowMs: number;
  confirmingPid: number | null;
  onConfirm: (pid: number) => void;
  onKill: (pid: number) => void;
  onCancel: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full min-w-[720px] border-collapse text-[12px]">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.id}
                className={cn(
                  "border-b border-border/60 px-3 py-2",
                  c.align === "right" ? "text-right" : "text-left",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSort(c.id)}
                  className={cn(
                    "inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.06em] transition-colors",
                    sortKey === c.id
                      ? "text-primary"
                      : "text-foreground-muted hover:text-foreground",
                  )}
                >
                  {c.label}
                  {sortKey === c.id && (
                    <span className="font-mono text-[10px]">
                      {sortDir === "asc" ? "↑" : "↓"}
                    </span>
                  )}
                </button>
              </th>
            ))}
            <th className="border-b border-border/60 px-3 py-2 text-right font-mono text-[11px] uppercase tracking-[0.06em] text-foreground-muted">
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const isConfirming = confirmingPid === p.pid;
            return (
              <tr
                key={p.pid}
                className="transition-colors hover:bg-accent/30"
              >
                {columns.map((c) => (
                  <td
                    key={c.id}
                    className={cn(
                      "border-b border-border/30 px-3 py-1.5 align-top",
                      c.align === "right" ? "text-right" : "text-left",
                    )}
                  >
                    {c.render(p, nowMs)}
                  </td>
                ))}
                <td className="border-b border-border/30 px-3 py-1.5 align-top text-right">
                  {isConfirming ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="font-mono text-[10.5px] text-destructive">
                        确定 kill {p.pid}?
                      </span>
                      <button
                        type="button"
                        onClick={() => onKill(p.pid)}
                        className="rounded-md border border-destructive/50 bg-destructive/10 px-2 py-0.5 font-mono text-[10.5px] text-destructive hover:bg-destructive/20"
                      >
                        是
                      </button>
                      <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-[10.5px] text-foreground-muted"
                      >
                        否
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onConfirm(p.pid)}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 font-mono text-[10.5px] text-foreground-muted hover:border-destructive/40 hover:text-destructive"
                      title={`PID ${p.pid}`}
                    >
                      <Skull className="h-3 w-3" strokeWidth={1.75} />
                      kill
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="mt-3 text-center font-mono text-[11px] text-foreground-subtle">
          没有匹配的进程
        </p>
      )}
    </div>
  );
}

function CpuBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const w = `${pct}%`;
  const tint =
    pct > 50 ? "bg-accent-rose" : pct > 20 ? "bg-accent-amber" : "bg-primary/60";
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-16 overflow-hidden rounded-full bg-border/50">
        <div
          className={cn(
            "absolute inset-y-0 left-0",
            tint,
            "transition-[width] duration-300",
          )}
          style={{ width: w }}
        />
      </div>
      <span className="font-mono text-[10.5px] text-foreground-muted">
        {value.toFixed(1)}%
      </span>
    </div>
  );
}

void SearchIcon;
void X;