import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Archive,
  Copy,
  FileWarning,
  Loader2,
  ShieldAlert,
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

type Finding =
  | {
      kind: "duplicate";
      path: string;
      siblings: string[];
      sha256: string;
      size: number;
    }
  | {
      kind: "empty";
      path: string;
      entries: number;
    }
  | {
      kind: "zero_size";
      path: string;
    };

type ScanResult = {
  scanned: number;
  findings: Finding[];
  trash_dir: string;
};

const KIND_META = {
  duplicate: { label: "重复", tone: "warning" },
  empty: { label: "空压缩包", tone: "muted" },
  zero_size: { label: "零字节", tone: "destructive" },
} as const;

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function ZipCleanPage() {
  const contentPadding = useAppStore((s) => s.contentPadding);
  const [root, setRoot] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick() {
    setError(null);
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (!picked || Array.isArray(picked)) return;
      setRoot(picked);
      setResult(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function scan() {
    if (!root) return;
    setLoading(true);
    setError(null);
    try {
      const r = await invoke<ScanResult>("scan_zip_dir", {
        req: { root, recursive: true },
      });
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const counts = result
    ? {
        duplicate: result.findings.filter((f) => f.kind === "duplicate").length,
        empty: result.findings.filter((f) => f.kind === "empty").length,
        zero_size: result.findings.filter((f) => f.kind === "zero_size").length,
      }
    : null;

  return (
    <div
      className={cn(PAGE_CONTAINER_CLASS, "gap-8")}
      style={paddingToStyle(contentPadding)}
    >
      <ModuleHeader moduleId="zip-clean" />

      <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)] xl:gap-6">
        <Card>
          <CardHeader>
            <CardTitle>扫描</CardTitle>
            <CardDescription>
              找出重复 / 空 / 0 字节 .zip。不直接删除，结果仅展示。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <button
              type="button"
              onClick={pick}
              className={cn(
                "flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent/30",
                root
                  ? "border-border bg-background text-foreground"
                  : "border-border bg-background text-foreground-muted",
              )}
            >
              <Archive className="h-3.5 w-3.5 text-foreground-muted" />
              <span className="flex-1 truncate font-mono text-[12px]">
                {root ?? "选择目录…"}
              </span>
            </button>

            <Button onClick={scan} disabled={!root || loading} className="w-full">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? "扫描中…" : "扫描"}
            </Button>

            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>结果</CardTitle>
                <CardDescription>
                  {result
                    ? `扫描 ${result.scanned} 个 .zip`
                    : "选目录后点击扫描"}
                </CardDescription>
              </div>
              {counts && (
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="font-mono">
                    <Copy className="mr-1 h-3 w-3" />
                    {counts.duplicate}
                  </Badge>
                  <Badge variant="outline" className="font-mono">
                    <FileWarning className="mr-1 h-3 w-3" />
                    {counts.empty}
                  </Badge>
                  <Badge variant="outline" className="font-mono">
                    <ShieldAlert className="mr-1 h-3 w-3" />
                    {counts.zero_size}
                  </Badge>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {result ? (
              <FindingsTable result={result} />
            ) : (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-foreground-muted">
                <span className="grid h-12 w-12 place-items-center rounded-full border border-dashed border-border/80">
                  <Archive className="h-5 w-5 opacity-60" />
                </span>
                <span className="text-sm">扫描完后会显示命中的 .zip 文件</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FindingsTable({ result }: { result: ScanResult }) {
  if (result.findings.length === 0) {
    return (
      <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 text-foreground-muted">
        <span className="text-sm">未发现问题</span>
        <span className="font-mono text-[11px] text-foreground-subtle">
          这个目录里的 .zip 都干净
        </span>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th className="border-b border-border/60 px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.06em] text-foreground-muted">
              类型
            </th>
            <th className="border-b border-border/60 px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.06em] text-foreground-muted">
              路径
            </th>
            <th className="border-b border-border/60 px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.06em] text-foreground-muted">
              详情
            </th>
          </tr>
        </thead>
        <tbody>
          {result.findings.map((f, i) => (
            <tr key={i} className="transition-colors hover:bg-accent/30">
              <td className="border-b border-border/30 px-3 py-1.5 align-top">
                <Badge variant="outline" className="font-mono">
                  {KIND_META[f.kind].label}
                </Badge>
              </td>
              <td className="border-b border-border/30 px-3 py-1.5 align-top font-mono text-[11.5px]">
                {f.path}
              </td>
              <td className="border-b border-border/30 px-3 py-1.5 align-top font-mono text-[11px] text-foreground-muted">
                {f.kind === "duplicate"
                  ? `${formatSize(f.size)} · sha256 ${f.sha256.slice(0, 8)}… · 同组 ${f.siblings.length + 1}`
                  : f.kind === "empty"
                    ? `${f.entries} 个内含条目（无内容）`
                    : "0 字节"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 font-mono text-[10.5px] text-foreground-subtle">
        待处理：{result.trash_dir}
      </p>
    </div>
  );
}
