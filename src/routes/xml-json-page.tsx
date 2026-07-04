import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeftRight, Copy, Loader2, Repeat } from "lucide-react";
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

type JsonToJson = { json: unknown; errors: string[] };
type XmlToJson = { xml: string };

export function XmlJsonPage() {
  const contentPadding = useAppStore((s) => s.contentPadding);
  const [direction, setDirection] = useState<"xml-to-json" | "json-to-xml">(
    "xml-to-json",
  );
  const [input, setInput] = useState(SAMPLE_XML);
  const [output, setOutput] = useState("{\n  \"root\": {}\n}");
  const [arrays, setArrays] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [rootName, setRootName] = useState("root");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function convert() {
    setError(null);
    setLoading(true);
    try {
      if (direction === "xml-to-json") {
        const r = await invoke<JsonToJson>("xml_to_json", {
          req: { xml: input, arrays },
        });
        const formatted = JSON.stringify(r.json, null, 2);
        setOutput(formatted);
        if (r.errors.length) {
          setError(`解析警告：${r.errors.join("; ")}`);
        }
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(input);
        } catch (e) {
          throw new Error(`输入不是合法 JSON：${String(e)}`);
        }
        const r = await invoke<XmlToJson>("json_to_xml", {
          req: { json: parsed, root_name: rootName, wrap_array_items: wrap },
        });
        setOutput(r.xml);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function swap() {
    setDirection((d) =>
      d === "xml-to-json" ? "json-to-xml" : "xml-to-json",
    );
    setInput(output);
    setOutput(input);
  }

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  }

  const inLabel = direction === "xml-to-json" ? "XML" : "JSON";
  const outLabel = direction === "xml-to-json" ? "JSON" : "XML";

  const inWordCount = useMemo(() => input.length, [input]);

  return (
    <div
      className={cn(PAGE_CONTAINER_CLASS, "gap-8")}
      style={paddingToStyle(contentPadding)}
    >
      <ModuleHeader moduleId="xml-json" />

      <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] xl:gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{inLabel} 输入</CardTitle>
                <CardDescription>
                  {inWordCount.toLocaleString()} 字符 ·{" "}
                  {direction === "xml-to-json"
                    ? "属性 → @key 前缀；同名子元素 → 数组"
                    : "顶层对象会被序列化为单个根元素"}
                </CardDescription>
              </div>
              {direction === "json-to-xml" && (
                <input
                  value={rootName}
                  onChange={(e) => setRootName(e.target.value)}
                  placeholder="根元素名"
                  className="h-7 w-24 rounded-md border border-input bg-background px-2 font-mono text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              )}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
              className="min-h-[420px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-[12px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap items-center gap-3">
              {direction === "xml-to-json" ? (
                <label className="flex items-center gap-2 font-mono text-[11px] text-foreground-muted">
                  <input
                    type="checkbox"
                    checked={arrays}
                    onChange={(e) => setArrays(e.target.checked)}
                    className="h-3 w-3 accent-primary"
                  />
                  同名子元素 → 数组
                </label>
              ) : (
                <label className="flex items-center gap-2 font-mono text-[11px] text-foreground-muted">
                  <input
                    type="checkbox"
                    checked={wrap}
                    onChange={(e) => setWrap(e.target.checked)}
                    className="h-3 w-3 accent-primary"
                  />
                  数组项包一层 wrapper（默认展开）
                </label>
              )}
              <Button onClick={convert} disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowLeftRight className="h-4 w-4" />
                )}
                转换
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-center lg:flex-col">
          <button
            type="button"
            onClick={swap}
            className="grid h-10 w-10 place-items-center rounded-full border border-border bg-background text-foreground-muted transition-all hover:border-primary/40 hover:bg-accent hover:text-primary"
            aria-label="交换方向"
          >
            <Repeat className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{outLabel} 输出</CardTitle>
                <CardDescription>
                  {error ? (
                    <span className="text-destructive">{error}</span>
                  ) : (
                    "对输入应用转换后的结果"
                  )}
                </CardDescription>
              </div>
              <button
                type="button"
                onClick={copyOutput}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[11px] text-foreground-muted transition-colors hover:border-primary/30 hover:text-foreground"
              >
                <Copy className="h-3 w-3" strokeWidth={1.75} />
                {copied ? "已复制" : "复制"}
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <textarea
              value={output}
              onChange={(e) => setOutput(e.target.value)}
              spellCheck={false}
              className="min-h-[420px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-[12px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<order id="42" status="paid">
  <customer name="Ada" email="ada@example.com" />
  <items>
    <item sku="A-100"><name>Widget</name><qty>3</qty></item>
    <item sku="A-100"><name>Widget</name><qty>5</qty></item>
    <item sku="B-200"><name>Sprocket</name><qty>1</qty></item>
  </items>
  <total currency="USD">52.50</total>
</order>`;
