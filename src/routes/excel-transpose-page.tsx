import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Filter,
  Loader2,
  RotateCw,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { ModuleHeader } from "@/components/module/module-header";
import { useAppStore } from "@/store/app-store";
import { PAGE_CONTAINER_CLASS, paddingToStyle } from "@/lib/spacing";
import { cn } from "@/lib/utils";

// ── Tauri command response shapes ────────────────────────────────────

type TransposePreview = {
  headers: string[];
  rows: string[][];
  source_rows: number;
  source_cols: number;
  result_rows: number;
  result_cols: number;
};

type TransposeResult = {
  sheet_name: string;
  preview: TransposePreview;
  /** base64-encoded xlsx bytes */
  xlsx_b64: string;
};

type Request = {
  bytes: number[];
  sheet_name: string;
  key_column: string;
  value_columns: string[];
  has_header: boolean;
  aggregate: boolean;
};

// ── Main page ────────────────────────────────────────────────────────

export function ExcelTransposePage() {
  const contentPadding = useAppStore((s) => s.contentPadding);

  const [filePath, setFilePath] = useState<string | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sheetName, setSheetName] = useState<string>("");
  const [keyColumn, setKeyColumn] = useState<string>("");
  const [valueColumns, setValueColumns] = useState<string[]>([]);
  const [aggregate, setAggregate] = useState(false);

  const [preview, setPreview] = useState<TransposePreview | null>(null);

  const [loadingFile, setLoadingFile] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Re-decode the chosen file with the user-chosen options.
   *  Uses a tiny Tauri command that just returns the headers + sheet names.
   *  To keep the data model simple, we read the file via the existing
   *  excel_to_json flow once on load to get the column names. */
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
      // Load bytes via Tauri's fs plugin
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const buf = await readFile(fp);
      const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      setBytes(u8);

      // Use the existing excel_to_json to fetch column names + sheet list.
      // (We get back full sheets — but only keep header[0] per sheet.)
      type Sheet = { name: string; rows: number; cols: number; json: string };
      type Resp = { file_name: string; sheets: Sheet[]; format: string };
      const r = await invoke<Resp>("excel_to_json", {
        req: { bytes: Array.from(u8) },
      });
      if (r.sheets.length === 0) {
        setError("xlsx 文件没有 sheet");
        return;
      }
      // Pick the first sheet by default
      const firstSheet = r.sheets[0];
      const rows: Record<string, unknown>[] = JSON.parse(firstSheet.json);
      const derivedHeaders = rows.length === 0 ? [] : Object.keys(rows[0]);
      setSheetName(firstSheet.name);
      setHeaders(derivedHeaders);
      setKeyColumn(derivedHeaders[0] ?? "");
      setValueColumns(derivedHeaders.slice(1));
      // Reset downstream
      setPreview(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingFile(false);
    }
  }

  async function switchSheet(name: string) {
    if (!bytes) return;
    setSheetName(name);
    setError(null);
    try {
      type Sheet = { name: string; rows: number; cols: number; json: string };
      type Resp = { sheets: Sheet[] };
      const r = await invoke<Resp>("excel_to_json", {
        req: { bytes: Array.from(bytes) },
      });
      const sheet = r.sheets.find((s) => s.name === name);
      if (!sheet) return;
      const rows: Record<string, unknown>[] = JSON.parse(sheet.json);
      const derivedHeaders = rows.length === 0 ? [] : Object.keys(rows[0]);
      setHeaders(derivedHeaders);
      setKeyColumn(derivedHeaders[0] ?? "");
      setValueColumns(derivedHeaders.slice(1));
      setPreview(null);
    } catch (e) {
      setError(String(e));
    }
  }

  // Live preview whenever the user changes key/value/aggregate.
  // Debounced via simple "fire on next tick after change" effect.
  useEffect(() => {
    if (!bytes || !sheetName || !keyColumn || valueColumns.length === 0) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoadingPreview(true);
      setError(null);
      try {
        const req: Request = {
          bytes: Array.from(bytes),
          sheet_name: sheetName,
          key_column: keyColumn,
          value_columns: valueColumns,
          has_header: true,
          aggregate,
        };
        const r = await invoke<TransposePreview>("excel_transpose_preview", { req });
        if (!cancelled) {
          setPreview(r);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [bytes, sheetName, keyColumn, valueColumns, aggregate]);

  async function save() {
    if (!bytes) return;
    setSaving(true);
    setError(null);
    try {
      const req: Request = {
        bytes: Array.from(bytes),
        sheet_name: sheetName,
        key_column: keyColumn,
        value_columns: valueColumns,
        has_header: true,
        aggregate,
      };
      const r = await invoke<TransposeResult>("excel_transpose", { req });
      const target = await saveDialog({
        defaultPath: `velora-transposed-${Date.now()}.xlsx`,
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
      <ModuleHeader moduleId="excel-transpose" />

      <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[420px_minmax(0,1fr)] xl:gap-6">
        {/* ── LEFT: controls ─────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>输入</CardTitle>
            <CardDescription>宽表 → 长表，列名 / 列值一键转置</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* File picker */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Excel 文件
              </label>
              <button
                type="button"
                onClick={pickFile}
                disabled={loadingFile}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-left text-sm transition-colors",
                  "hover:border-primary/40 hover:bg-accent/30",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                  filePath
                    ? "border-border bg-background text-foreground"
                    : "border-border bg-background text-foreground-muted",
                )}
              >
                {loadingFile ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground-muted" />
                ) : (
                  <FileSpreadsheet className="h-3.5 w-3.5 text-foreground-muted" />
                )}
                <span className="flex-1 truncate font-mono text-[12px]">
                  {filePath ?? "选择 .xlsx 文件…"}
                </span>
              </button>
            </div>

            {/* Sheet selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Sheet
              </label>
              <SheetPicker
                bytes={bytes}
                value={sheetName}
                onChange={switchSheet}
                disabled={!bytes}
              />
            </div>

            {/* Key column */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                行标识列 (key)
              </label>
              <ColumnPicker
                headers={headers}
                value={keyColumn}
                onChange={setKeyColumn}
                disabled={!headers.length}
              />
              <p className="font-mono text-[10px] text-foreground-subtle">
                这一列的每个值会成为转置后新行的 key
              </p>
            </div>

            {/* Value columns */}
            <div className="space-y-1.5">
              <label className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>字段列 (fields)</span>
                <span className="font-mono text-[10px] text-foreground-subtle">
                  {valueColumns.length}/{headers.length}
                </span>
              </label>
              <FieldChipPicker
                headers={headers}
                value={valueColumns}
                onChange={setValueColumns}
                excludeColumn={keyColumn}
                disabled={!headers.length}
              />
              <p className="font-mono text-[10px] text-foreground-subtle">
                每个被勾选的列展开成 {`(key, field, value)`} 多行
              </p>
            </div>

            {/* Aggregate toggle */}
            <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2">
              <input
                type="checkbox"
                checked={aggregate}
                onChange={(e) => setAggregate(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer accent-primary"
              />
              <span className="flex flex-1 flex-col gap-0.5 leading-tight">
                <span className="text-[12px] font-medium text-foreground">
                  聚合求和
                </span>
                <span className="font-mono text-[10px] text-foreground-subtle">
                  同 key + 同 field 数值相加
                </span>
              </span>
              <Filter className="h-3 w-3 text-foreground-muted" />
            </label>

            {/* Action */}
            <Button
              onClick={save}
              disabled={
                !preview || saving || !bytes || !keyColumn || valueColumns.length === 0
              }
              className="w-full"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {saving ? "保存中…" : "保存为 xlsx"}
            </Button>

            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── RIGHT: preview ─────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>预览</CardTitle>
                <CardDescription>
                  {preview
                    ? `${preview.result_rows} 行 × ${preview.result_cols} 列 · 原表 ${preview.source_rows} × ${preview.source_cols}`
                    : "选择文件后会显示转置结果"}
                </CardDescription>
              </div>
              {preview && (
                <Badge variant="outline" className="font-mono">
                  <ArrowLeftRight className="mr-1 h-3 w-3" />
                  {preview.headers.join(" · ")}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <PreviewTable preview={preview} loading={loadingPreview} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function SheetPicker({
  bytes,
  value,
  onChange,
  disabled,
}: {
  bytes: Uint8Array | null;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const [sheets, setSheets] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!bytes) {
      setSheets([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        type Sheet = { name: string };
        type Resp = { sheets: Sheet[] };
        const r = await invoke<Resp>("excel_to_json", {
          req: { bytes: Array.from(bytes) },
        });
        if (!cancelled) setSheets(r.sheets.map((s) => s.name));
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm",
          "transition-colors hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        <span className="font-mono text-[12px]">{value || "—"}</span>
        <ChevronDown className="h-3.5 w-3.5 text-foreground-muted" />
      </button>
      {open && sheets.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-border bg-background-overlay shadow-diffusion glass-edge">
          {sheets.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                onChange(name);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between px-3 py-1.5 text-left font-mono text-[12px] transition-colors hover:bg-accent/40",
                name === value && "bg-primary/[0.08] text-foreground",
              )}
            >
              <span>{name}</span>
              {name === value && (
                <Check className="h-3 w-3 text-primary" strokeWidth={2.25} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ColumnPicker({
  headers,
  value,
  onChange,
  disabled,
}: {
  headers: string[];
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  if (disabled) {
    return (
      <div className="flex h-9 items-center rounded-md border border-dashed border-border bg-background px-3 text-xs text-foreground-subtle">
        暂无列
      </div>
    );
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {headers.map((h) => (
        <option key={h} value={h}>
          {h}
        </option>
      ))}
    </select>
  );
}

function FieldChipPicker({
  headers,
  value,
  onChange,
  excludeColumn,
  disabled,
}: {
  headers: string[];
  value: string[];
  onChange: (next: string[]) => void;
  excludeColumn: string;
  disabled: boolean;
}) {
  const candidates = useMemo(
    () => headers.filter((h) => h !== excludeColumn),
    [headers, excludeColumn],
  );
  if (disabled) {
    return (
      <div className="flex h-9 items-center rounded-md border border-dashed border-border bg-background px-3 text-xs text-foreground-subtle">
        暂无列
      </div>
    );
  }
  const set = new Set(value);
  function toggle(h: string) {
    if (set.has(h)) {
      onChange(value.filter((x) => x !== h));
    } else {
      onChange([...value, h]);
    }
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {candidates.map((h) => {
        const active = set.has(h);
        return (
          <button
            key={h}
            type="button"
            onClick={() => toggle(h)}
            className={cn(
              "rounded-md border px-2 py-1 font-mono text-[11px] transition-all",
              active
                ? "border-primary/50 bg-primary/[0.08] text-primary"
                : "border-border bg-background text-foreground-muted hover:border-primary/30 hover:text-foreground",
            )}
            aria-pressed={active}
          >
            {active && <Check className="mr-1 inline h-3 w-3" strokeWidth={2.25} />}
            {h}
          </button>
        );
      })}
      {candidates.length === 0 && (
        <span className="text-[11px] text-foreground-subtle">
          没有可用的字段列（仅 key 列）
        </span>
      )}
    </div>
  );
}

function PreviewTable({
  preview,
  loading,
}: {
  preview: TransposePreview | null;
  loading: boolean;
}) {
  // Fixed-height region (480 px) on every state. Empty/loading states
  // center their content vertically so the top/bottom margin to the
  // Card border is symmetric. The data branch keeps the same height
  // and scrolls internally when rows overflow.
  const fixedWrap = "h-[480px] flex items-center justify-center";
  const tableWrap = "h-[480px] flex flex-col";

  if (loading) {
    return (
      <div className={cn(fixedWrap, "gap-2 text-sm text-foreground-muted")}>
        <Loader2 className="h-4 w-4 animate-spin" />
        正在计算…
      </div>
    );
  }
  if (!preview) {
    return (
      <div className={cn(fixedWrap, "flex-col gap-3 text-foreground-muted")}>
        <span className="grid h-12 w-12 place-items-center rounded-full border border-dashed border-border/80">
          <RotateCw className="h-5 w-5 opacity-60" />
        </span>
        <span className="text-sm">选择文件后会看到转置结果</span>
      </div>
    );
  }
  if (preview.rows.length === 0) {
    return (
      <div className={cn(fixedWrap, "flex-col gap-2 text-foreground-muted")}>
        <span className="text-sm">没有数据</span>
        <span className="font-mono text-[11px] text-foreground-subtle">
          确认 key 列和字段列都选择了
        </span>
      </div>
    );
  }
  return (
    <ScrollArea className={tableWrap}>
      <table className="w-full border-collapse text-[12px]">
        <thead className="sticky top-0 z-[1] bg-background-overlay/95 backdrop-blur">
          <tr>
            {preview.headers.map((h, i) => (
              <th
                key={i}
                className="border-b border-border/60 px-3 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-foreground-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row, ri) => (
            <tr
              key={ri}
              className="transition-colors hover:bg-accent/30"
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="border-b border-border/30 px-3 py-1.5 align-top font-mono text-[11.5px] text-foreground"
                >
                  {cell || (
                    <span className="text-foreground-subtle">∅</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}