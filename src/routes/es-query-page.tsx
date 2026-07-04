import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, Lock, Search as SearchIcon, Send } from "lucide-react";
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

type Hit = {
  id: string;
  index: string;
  score: number;
  source: string;
};

type QueryResult = {
  took_ms: number;
  total: number;
  hits: Hit[];
  cluster_name: string;
};

const SAMPLE_QUERY = JSON.stringify(
  {
    query: { match_all: {} },
    sort: [{ "@timestamp": { order: "desc", missing: "_last" } }],
  },
  null,
  2,
);

export function EsQueryPage() {
  const contentPadding = useAppStore((s) => s.contentPadding);
  const [url, setUrl] = useState("http://localhost:9200");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [index, setIndex] = useState("_all");
  const [queryBody, setQueryBody] = useState(SAMPLE_QUERY);
  const [size, setSize] = useState(50);

  const [indices, setIndices] = useState<string[]>([]);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  async function listIndices() {
    setError(null);
    try {
      const r = await invoke<{ indices: string[] }>("es_list_indices", {
        req: { url, username, password, pattern: "*" },
      });
      setIndices(r.indices);
      if (r.indices.length > 0 && index === "_all") {
        // 默认选第一个非系统索引
        const userIdx = r.indices.find(
          (i) => !i.startsWith(".") && i !== "_all",
        );
        if (userIdx) setIndex(userIdx);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function run() {
    setError(null);
    setLoading(true);
    try {
      const r = await invoke<QueryResult>("es_query", {
        req: {
          url,
          username,
          password,
          index,
          query_body: queryBody,
          size,
        },
      });
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    listIndices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={cn(PAGE_CONTAINER_CLASS, "gap-8")}
      style={paddingToStyle(contentPadding)}
    >
      <ModuleHeader moduleId="es-query" />

      <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[420px_minmax(0,1fr)] xl:gap-6">
        <Card>
          <CardHeader>
            <CardTitle>集群 / 查询</CardTitle>
            <CardDescription>REST 直发 ES / Opensearch</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Cluster URL
              </label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:9200"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                认证
              </label>
              <button
                type="button"
                onClick={() => setShowAuth((s) => !s)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px]",
                  showAuth
                    ? "border-primary/40 bg-primary/[0.08] text-primary"
                    : "border-border bg-background text-foreground-muted hover:border-primary/30 hover:text-foreground",
                )}
              >
                <Lock className="h-3 w-3" strokeWidth={1.75} />
                {showAuth ? "关闭 Basic Auth" : "使用 Basic Auth（用户名 / 密码）"}
              </button>
              {showAuth && (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="username"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-[12px]"
                  />
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="password"
                    type="password"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-[12px]"
                  />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>Index / pattern</span>
                <button
                  type="button"
                  onClick={listIndices}
                  className="font-mono text-[10.5px] text-primary hover:underline"
                >
                  拉取索引列表
                </button>
              </label>
              <input
                value={index}
                onChange={(e) => setIndex(e.target.value)}
                placeholder="_all / logs-* / filebeat-*"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-[12px]"
              />
              {indices.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {indices.slice(0, 12).map((i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setIndex(i)}
                      className={cn(
                        "rounded-md border px-2 py-0.5 font-mono text-[10.5px]",
                        i === index
                          ? "border-primary/50 bg-primary/[0.08] text-primary"
                          : "border-border bg-background text-foreground-muted hover:border-primary/30 hover:text-foreground",
                      )}
                    >
                      {i}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Query body (JSON DSL)
              </label>
              <textarea
                value={queryBody}
                onChange={(e) => setQueryBody(e.target.value)}
                spellCheck={false}
                className="min-h-32 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-[11.5px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Size
              </label>
              <input
                type="number"
                min={1}
                max={1000}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="flex h-9 w-24 rounded-md border border-input bg-background px-3 font-mono text-[12px]"
              />
            </div>

            <Button onClick={run} disabled={loading} className="w-full">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {loading ? "查询中…" : "执行查询"}
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
                    ? `${result.cluster_name} · total ${result.total.toLocaleString()} · ${result.took_ms} ms`
                    : "执行后显示 hits"}
                </CardDescription>
              </div>
              {result && (
                <Badge variant="outline" className="font-mono">
                  {result.hits.length} hits
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {result ? (
              <HitsTable hits={result.hits} />
            ) : (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-foreground-muted">
                <span className="grid h-12 w-12 place-items-center rounded-full border border-dashed border-border/80">
                  <SearchIcon className="h-5 w-5 opacity-60" />
                </span>
                <span className="text-sm">输入查询后点击执行</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function HitsTable({ hits }: { hits: Hit[] }) {
  if (hits.length === 0) {
    return (
      <p className="text-center font-mono text-[11.5px] text-foreground-subtle">
        没有命中
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {hits.map((h, i) => (
        <details
          key={`${h.id}-${i}`}
          className="group overflow-hidden rounded-lg border border-border/60 bg-card/30"
        >
          <summary
            className={cn(
              "flex cursor-pointer list-none items-center gap-3 px-3 py-2 text-[12px]",
              "[&::-webkit-details-marker]:hidden",
            )}
          >
            <span className="grid h-6 w-6 place-items-center rounded-md bg-background-overlay/60 font-mono text-[10px] text-foreground-muted">
              {i + 1}
            </span>
            <span className="font-mono text-[11.5px] text-foreground">
              {h.id}
            </span>
            <span className="font-mono text-[10.5px] text-foreground-subtle">
              @ {h.index}
            </span>
            <span className="ml-auto font-mono text-[10.5px] text-foreground-subtle">
              score {h.score.toFixed(3)}
            </span>
          </summary>
          <pre className="overflow-x-auto border-t border-border/40 bg-background-overlay/30 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-foreground">
            {prettyJson(h.source)}
          </pre>
        </details>
      ))}
    </div>
  );
}

function prettyJson(s: string): string {
  try {
    const v = JSON.parse(s);
    return JSON.stringify(v, null, 2);
  } catch {
    return s;
  }
}
