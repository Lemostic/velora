import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Cpu,
  Filter,
  Loader2,
  Pause,
  Play,
  Search as SearchIcon,
  Skull,
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
  mem_bytes: number;
  cpu_pct: number;
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

type SortKey = "pid" | "name" | "cpu" | "mem";

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

  // 自动刷新轮询
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, filter]);

  const rows = useMemo(() => {
    if (!data) return [];
    const r = [...data.processes];
    r.sort((a, b) => {
      let d = 0;
      if (sortKey === "pid") d = a.pid - b.pid;
      else if (sortKey === "name") d = a.name.localeCompare(b.name);
      else if (sortKey === "cpu") d = a.cpu_pct - b.cpu_pct;
      else if (sortKey === "mem") d = a.mem_bytes - b.mem_bytes;
      return sortDir === "asc" ? d : -d;
    });
    return r;
  }, [data, sortKey, sortDir]);

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

  function sortHeader(k: SortKey, label: string) {
    return (
      <button
        type="button"
        onClick={() => {
          if (sortKey === k) {
            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
          } else {
            setSortKey(k);
            setSortDir("desc");
          }
        }}
        className={cn(
          "inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.06em] transition-colors",
          sortKey === k ? "text-primary" : "text-foreground-muted hover:text-foreground",
        )}
      >
        {label}
        {sortKey === k && (
          <span className="font-mono text-[10px]">
            {sortDir === "asc" ? "↑" : "↓"}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      className={cn(PAGE_CONTAINER_CLASS, "gap-8")}
      style={paddingToStyle(contentPadding)}
    >
      <ModuleHeader moduleId="process-manager" />

      <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)] xl:gap-6">
        <Card>
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

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>进程列表</CardTitle>
                <CardDescription>
                  {data ? `当前 ${rows.length} 行` : "未拉取"}
                </CardDescription>
              </div>
              {data && (
                <Badge variant="outline" className="font-mono">
                  <Cpu className="mr-1 h-3 w-3" />
                  CPU avg {avgCpu(rows).toFixed(1)}%
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {data ? (
              <ProcessTable
                rows={rows}
                sortHeader={sortHeader}
                onConfirm={setConfirmPid}
                confirmingPid={confirmPid}
                onKill={kill}
                onCancel={() => setConfirmPid(null)}
              />
            ) : (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-foreground-muted">
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

function avgCpu(rows: ProcessInfo[]): number {
  if (rows.length === 0) return 0;
  return rows.reduce((a, r) => a + r.cpu_pct, 0) / rows.length;
}

function ProcessTable({
  rows,
  sortHeader,
  onConfirm,
  confirmingPid,
  onKill,
  onCancel,
}: {
  rows: ProcessInfo[];
  sortHeader: (k: SortKey, label: string) => React.ReactNode;
  onConfirm: (pid: number) => void;
  confirmingPid: number | null;
  onKill: (pid: number) => void;
  onCancel: () => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th className="border-b border-border/60 px-3 py-2 text-left">
              {sortHeader("pid", "PID")}
            </th>
            <th className="border-b border-border/60 px-3 py-2 text-left">
              {sortHeader("name", "名称")}
            </th>
            <th className="border-b border-border/60 px-3 py-2 text-left">
              {sortHeader("cpu", "CPU%")}
            </th>
            <th className="border-b border-border/60 px-3 py-2 text-left">
              {sortHeader("mem", "内存")}
            </th>
            <th className="border-b border-border/60 px-3 py-2 text-right">
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
                <td className="border-b border-border/30 px-3 py-1.5 align-top font-mono text-[11.5px]">
                  {p.pid}
                </td>
                <td className="border-b border-border/30 px-3 py-1.5 align-top">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-[11.5px] text-foreground">
                      {p.name}
                    </span>
                    {p.exe_path && (
                      <span className="truncate font-mono text-[10.5px] text-foreground-subtle max-w-[420px]">
                        {p.exe_path}
                      </span>
                    )}
                  </div>
                </td>
                <td className="border-b border-border/30 px-3 py-1.5 align-top font-mono text-[11.5px]">
                  <CpuBar value={p.cpu_pct} />
                </td>
                <td className="border-b border-border/30 px-3 py-1.5 align-top font-mono text-[11.5px]">
                  {formatBytes(p.mem_bytes)}
                </td>
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
  // 限到 0..100，视觉上是 fill 比例
  const pct = Math.max(0, Math.min(100, value));
  const w = `${pct}%`;
  const tint =
    pct > 50 ? "bg-accent-rose" : pct > 20 ? "bg-accent-amber" : "bg-primary/60";
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-border/50">
        <div
          className={cn("absolute inset-y-0 left-0", tint, "transition-[width] duration-300")}
          style={{ width: w }}
        />
      </div>
      <span className="font-mono text-[10.5px] text-foreground-muted">
        {value.toFixed(1)}%
      </span>
    </div>
  );
}

// suppress unused import warning if user omits
void SearchIcon;
