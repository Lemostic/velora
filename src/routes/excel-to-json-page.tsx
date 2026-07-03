import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { save } from "@tauri-apps/plugin-dialog";
import { readFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { FileSpreadsheet, Play, Save } from "lucide-react";
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
import { PADDING_CLASSES, PAGE_CONTAINER_CLASS } from "@/lib/spacing";
import { cn } from "@/lib/utils";

type SheetResult = {
  name: string;
  rows: number;
  cols: number;
  json: string;
};

type ConvertResult = {
  sheets: SheetResult[];
  fileName: string;
  format: string;
};

export function ExcelToJsonPage() {
  const contentPadding = useAppStore((s) => s.contentPadding);
  const [file, setFile] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickFile() {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Excel", extensions: ["xlsx", "xls", "xlsm"] }],
      });
      if (typeof path === "string") setFile(path);
    } catch (e) {
      setError(String(e));
    }
  }

  async function convert() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const bytes = await readFile(file);
      const r = await invoke<ConvertResult>("excel_to_json", {
        req: { bytes: Array.from(bytes) },
      });
      setResult(r);
      setActiveSheet(0);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function exportJson() {
    if (!result) return;
    try {
      const path = await save({
        filters: [{ name: "JSON", extensions: ["json"] }],
        defaultPath: `${result.fileName}.json`,
      });
      if (!path) return;
      const sheet = result.sheets[activeSheet];
      await writeTextFile(path, sheet?.json ?? "{}");
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div
      className={cn(
        PAGE_CONTAINER_CLASS,
        "gap-8",
        PADDING_CLASSES[contentPadding],
      )}
    >
      <ModuleHeader moduleId="excel-to-json" />

      <Card>
        <CardHeader>
          <CardTitle>选择文件</CardTitle>
          <CardDescription>
            通过 Tauri 文件对话框选 .xlsx，整个解析在本地完成，零上传
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Button onClick={pickFile} variant="outline">
              <FileSpreadsheet className="h-4 w-4" />
              选择 Excel
            </Button>
            {file && (
              <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
                {file}
              </code>
            )}
            <Button
              onClick={convert}
              disabled={!file || loading}
            >
              <Play className="h-4 w-4" />
              {loading ? "解析中…" : "开始解析"}
            </Button>
          </div>
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>
                  解析结果 · {result.sheets.length} 个 sheet · {result.format}
                </CardTitle>
                <CardDescription>{result.fileName}</CardDescription>
              </div>
              <Button onClick={exportJson} variant="outline" size="sm">
                <Save className="h-4 w-4" />
                导出当前 sheet
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {result.sheets.length > 1 && (
              <div className="flex flex-wrap gap-1">
                {result.sheets.map((s, i) => (
                  <button
                    key={s.name}
                    onClick={() => setActiveSheet(i)}
                    className={`rounded-md px-3 py-1 text-xs transition-colors ${
                      i === activeSheet
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {s.name} ({s.rows}×{s.cols})
                  </button>
                ))}
              </div>
            )}
            <pre className="max-h-96 overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
              {result.sheets[activeSheet]?.json}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
