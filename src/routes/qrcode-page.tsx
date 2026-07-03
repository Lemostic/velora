import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sparkles, Wand2 } from "lucide-react";
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
import { PADDING_CLASSES } from "@/lib/spacing";
import { cn } from "@/lib/utils";

type EncodeResult = {
  format: string;
  width: number;
  height: number;
  dataUrl: string;
};

export function QRCodePage() {
  const contentPadding = useAppStore((s) => s.contentPadding);
  const [text, setText] = useState("https://velora.dev");
  const [size, setSize] = useState(320);
  const [errorCorrection, setErrorCorrection] = useState("M");
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
      const r = await invoke<EncodeResult>("qrcode_encode", {
        req: {
          text: text.trim(),
          size,
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
      className={cn(
        "mx-auto flex h-full w-full max-w-[1400px] flex-col gap-8",
        PADDING_CLASSES[contentPadding],
      )}
    >
      <ModuleHeader moduleId="qrcode" />

      <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-2 xl:gap-6">
        <Card>
          <CardHeader>
            <CardTitle>输入</CardTitle>
            <CardDescription>
              支持纯文本、URL、JSON、任何 UTF-8 字符串
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                内容
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="https://velora.dev 或任意文本"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  尺寸 (px)
                </label>
                <input
                  type="number"
                  min={128}
                  max={1024}
                  step={32}
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  容错率
                </label>
                <select
                  value={errorCorrection}
                  onChange={(e) => setErrorCorrection(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="L">L · 7%</option>
                  <option value="M">M · 15%</option>
                  <option value="Q">Q · 25%</option>
                  <option value="H">H · 30%</option>
                </select>
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

        <Card>
          <CardHeader>
            <CardTitle>预览</CardTitle>
            <CardDescription>
              {result
                ? `${result.width}×${result.height} · ${result.format}`
                : "点击生成后在这里预览"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-80 items-center justify-center">
            {result ? (
              <img
                src={result.dataUrl}
                alt="QR Code"
                className="rounded-md border bg-white p-3 shadow-sm"
                style={{ width: size, height: size }}
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Sparkles className="h-8 w-8 opacity-50" />
                <span className="text-sm">等待生成…</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
