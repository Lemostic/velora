import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Check, Copy, Download, FileText, Loader2 } from "lucide-react";
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

type Result = {
  markdown: string;
  output_path: string | null;
  log: string;
};

export function MarkitdownPage() {
  const contentPadding = useAppStore((s) => s.contentPadding);
  const [inputPath, setInputPath] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function pick() {
    setError(null);
    try {
      const picked = await openDialog({
        multiple: false,
        filters: [
          { name: "Office / PDF / image", extensions: ["pdf", "docx", "xlsx", "pptx", "png", "jpg", "jpeg"] },
        ],
      });
      if (!picked || Array.isArray(picked)) return;
      setInputPath(picked);
      setResult(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function convert() {
    if (!inputPath) return;
    setLoading(true);
    setError(null);
    try {
      const r = await invoke<Result>("markitdown_run", {
        req: { input_path: inputPath },
      });
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function saveAs() {
    if (!result) return;
    const target = await saveDialog({
      defaultPath: `${inputPath?.replace(/\.[^./]+$/, "") ?? "output"}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!target) return;
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(target, result.markdown);
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  }

  return (
    <div
      className={cn(PAGE_CONTAINER_CLASS, "gap-8")}
      style={paddingToStyle(contentPadding)}
    >
      <ModuleHeader moduleId="markitdown" />

      <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[420px_minmax(0,1fr)] xl:gap-6">
        <Card>
          <CardHeader>
            <CardTitle>输入</CardTitle>
            <CardDescription>
              调本地 markitdown CLI（python pip install markitdown）
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <button
              type="button"
              onClick={pick}
              className={cn(
                "flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent/30",
                inputPath
                  ? "border-border bg-background text-foreground"
                  : "border-border bg-background text-foreground-muted",
              )}
            >
              <FileText className="h-3.5 w-3.5 text-foreground-muted" />
              <span className="flex-1 truncate font-mono text-[12px]">
                {inputPath ?? "选择文件…"}
              </span>
            </button>

            <Button onClick={convert} disabled={!inputPath || loading} className="w-full">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? "转换中…" : "转换为 Markdown"}
            </Button>

            {result && (
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[11px] text-foreground-muted transition-colors hover:border-primary/30 hover:text-foreground"
                >
                  {copied ? (
                    <Check className="h-3 w-3 text-accent-emerald" strokeWidth={2.25} />
                  ) : (
                    <Copy className="h-3 w-3" strokeWidth={1.75} />
                  )}
                  {copied ? "已复制" : "复制"}
                </button>
                <button
                  type="button"
                  onClick={saveAs}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[11px] text-foreground-muted transition-colors hover:border-primary/30 hover:text-foreground"
                >
                  <Download className="h-3 w-3" strokeWidth={1.75} />
                  保存 .md
                </button>
              </div>
            )}

            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                {error}
              </div>
            )}

            {result?.log && (
              <pre className="overflow-x-auto rounded-md border border-border bg-background-overlay/40 p-2 font-mono text-[10px] leading-relaxed text-foreground-subtle">
                {result.log}
              </pre>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Markdown</CardTitle>
                <CardDescription>
                  {result
                    ? `${result.markdown.length.toLocaleString()} 字符`
                    : "转换后会显示 Markdown 结果"}
                </CardDescription>
              </div>
              {result?.output_path && (
                <Badge variant="outline" className="font-mono">
                  {result.output_path.split(/[\\/]/).pop()}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {result ? (
              <textarea
                value={result.markdown}
                onChange={() => {}}
                readOnly
                spellCheck={false}
                className="min-h-[480px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-[12px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : (
              <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 text-foreground-muted">
                <span className="grid h-12 w-12 place-items-center rounded-full border border-dashed border-border/80">
                  <FileText className="h-5 w-5 opacity-60" />
                </span>
                <span className="text-sm">选择文件后点击转换</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
