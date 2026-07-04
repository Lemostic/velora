import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy, Download, Sparkles, Wand2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ModuleHeader } from "@/components/module/module-header";
import { useAppStore } from "@/store/app-store";
import { PAGE_CONTAINER_CLASS, paddingToStyle } from "@/lib/spacing";
import { cn } from "@/lib/utils";

type EncodeResult = {
  format: string;
  width: number;
  height: number;
  dataUrl: string;
};

const EC_OPTIONS = [
  { value: "L", label: "L", pct: "7%" },
  { value: "M", label: "M", pct: "15%" },
  { value: "Q", label: "Q", pct: "25%" },
  { value: "H", label: "H", pct: "30%" },
] as const;

export function QRCodePage() {
  const contentPadding = useAppStore((s) => s.contentPadding);
  const [text, setText] = useState("https://velora.dev");
  const [errorCorrection, setErrorCorrection] = useState<"L" | "M" | "Q" | "H">(
    "M",
  );
  const [result, setResult] = useState<EncodeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!text.trim()) {
      setError("请输入内容");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // size 现在被 Rust 端无视（始终 1024），前端按容器自适应。
      // 这里传 1024 是为了和老 invoke 接口兼容，避免遗漏字段触发 Tauri 反序列化报错。
      const r = await invoke<EncodeResult>("qrcode_encode", {
        req: {
          text: text.trim(),
          size: 1024,
          errorCorrection,
        },
      });
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={cn(PAGE_CONTAINER_CLASS, "gap-8")}
      style={paddingToStyle(contentPadding)}
    >
      <ModuleHeader moduleId="qrcode" />

      <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-2 xl:gap-6">
        {/* ── Left: input card ─────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>输入</CardTitle>
            <CardDescription>
              支持纯文本、URL、JSON、任何 UTF-8 字符串
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                内容
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="flex min-h-32 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="https://velora.dev 或任意文本"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                容错率
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {EC_OPTIONS.map((opt) => {
                  const active = errorCorrection === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setErrorCorrection(opt.value)}
                      className={cn(
                        "flex flex-col items-center justify-center gap-0.5 rounded-md border px-2 py-2 text-xs font-medium transition-all",
                        active
                          ? "border-primary/50 bg-primary/[0.08] text-primary shadow-[0_0_0_1px_var(--primary)]"
                          : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground",
                      )}
                      aria-pressed={active}
                    >
                      <span className="font-mono text-[13px] tracking-tight">
                        {opt.label}
                      </span>
                      <span className="font-mono text-[10px] opacity-70">
                        {opt.pct}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <Button
              onClick={generate}
              disabled={loading}
              className="w-full"
            >
              <Wand2 className="h-4 w-4" />
              {loading ? "生成中…" : "生成二维码"}
            </Button>

            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Right: preview card, image fills & centers ────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>预览</CardTitle>
            <CardDescription>
              {result
                ? `${result.width}×${result.height} · ${result.format}`
                : "点击生成后在这里预览"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-center p-6">
            {result ? (
              <div className="flex w-full flex-col items-center justify-center gap-4">
                <div className="flex w-full items-center justify-center">
                  <img
                    src={result.dataUrl}
                    alt="QR Code"
                    draggable={false}
                    className={cn(
                      // 居中 + 永远是正方形：宽度跟 Card 走，高度由 aspect-ratio 决定
                      "rounded-lg border border-border bg-white p-3 shadow-diffusion-sm",
                      "aspect-square w-full max-w-[360px]",
                      "object-contain",
                    )}
                  />
                </div>
                <PreviewActions dataUrl={result.dataUrl} text={text} />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <span className="grid h-12 w-12 place-items-center rounded-full border border-dashed border-border/80">
                  <Sparkles className="h-5 w-5 opacity-60" />
                </span>
                <span className="text-sm">等待生成…</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PreviewActions({ dataUrl, text }: { dataUrl: string; text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore — clipboard may be unavailable in some WebView contexts
    }
  }

  function download() {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `velora-qr-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[11px] text-foreground-muted transition-colors hover:border-primary/30 hover:text-foreground"
      >
        {copied ? (
          <Check className="h-3 w-3 text-accent-emerald" strokeWidth={2.25} />
        ) : (
          <Copy className="h-3 w-3" strokeWidth={1.75} />
        )}
        复制文本
      </button>
      <button
        type="button"
        onClick={download}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[11px] text-foreground-muted transition-colors hover:border-primary/30 hover:text-foreground"
      >
        <Download className="h-3 w-3" strokeWidth={1.75} />
        下载 PNG
      </button>
    </div>
  );
}
