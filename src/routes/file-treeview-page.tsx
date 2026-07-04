import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  Minus,
  Search as SearchIcon,
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

type TreeNode =
  | {
      type: "dir";
      path: string;
      name: string;
      children: TreeNode[];
      total_descendants: number;
    }
  | {
      type: "file";
      path: string;
      name: string;
      size: number;
    };

type TreeResult = {
  root: string;
  nodes: TreeNode[];
  total_count: number;
  truncated: boolean;
  max_nodes: number;
};

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function FileTreePage() {
  const contentPadding = useAppStore((s) => s.contentPadding);
  const [root, setRoot] = useState<string | null>(null);
  const [maxDepth, setMaxDepth] = useState(6);
  const [ignoreText, setIgnoreText] = useState("node_modules,.git,.cache,dist,target");
  const [result, setResult] = useState<TreeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  async function pickRoot() {
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
      const r = await invoke<TreeResult>("scan_tree", {
        req: {
          root,
          max_depth: maxDepth,
          follow_links: false,
          ignore_patterns: ignoreText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
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
      <ModuleHeader moduleId="file-treeview" />

      <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)] xl:gap-6">
        <Card>
          <CardHeader>
            <CardTitle>输入</CardTitle>
            <CardDescription>本地目录浏览，第一层 + 忽略规则</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                根目录
              </label>
              <button
                type="button"
                onClick={pickRoot}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent/30",
                  root
                    ? "border-border bg-background text-foreground"
                    : "border-border bg-background text-foreground-muted",
                )}
              >
                <HardDrive className="h-3.5 w-3.5 text-foreground-muted" />
                <span className="flex-1 truncate font-mono text-[12px]">
                  {root ?? "选择目录…"}
                </span>
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                最大深度
              </label>
              <select
                value={maxDepth}
                onChange={(e) => setMaxDepth(Number(e.target.value))}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value={2}>2 层</option>
                <option value={4}>4 层</option>
                <option value={6}>6 层（默认）</option>
                <option value={10}>10 层</option>
                <option value={0}>不限</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                忽略规则（逗号分隔，文件名 glob）
              </label>
              <textarea
                value={ignoreText}
                onChange={(e) => setIgnoreText(e.target.value)}
                className="min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-[11.5px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="node_modules, .git, *.tmp"
              />
            </div>

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
                    ? `${result.total_count} 节点${result.truncated ? " · 已截断" : ""}`
                    : "选择目录后点击扫描"}
                </CardDescription>
              </div>
              {result && (
                <Badge variant="outline" className="font-mono">
                  max {result.max_nodes}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {result && (
              <div className="flex items-center gap-2 border-b border-border/40 pb-3">
                <SearchIcon
                  className="h-3.5 w-3.5 text-foreground-muted"
                  strokeWidth={1.75}
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="按名称过滤（空白过滤全部）…"
                  className="flex-1 bg-transparent text-[12px] outline-none placeholder:text-foreground-subtle"
                />
              </div>
            )}

            {result ? (
              <TreeView nodes={result.nodes} query={query.toLowerCase()} depth={0} />
            ) : (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-foreground-muted">
                <span className="grid h-12 w-12 place-items-center rounded-full border border-dashed border-border/80">
                  <Folder className="h-5 w-5 opacity-60" />
                </span>
                <span className="text-sm">选择目录后会显示一级目录</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TreeView({
  nodes,
  query,
  depth,
}: {
  nodes: TreeNode[];
  query: string;
  depth: number;
}) {
  const filtered = query
    ? nodes.filter((n) => n.name.toLowerCase().includes(query))
    : nodes;
  if (filtered.length === 0) {
    if (depth === 0) {
      return (
        <div className="rounded-md border border-dashed border-border/60 p-6 text-center font-mono text-[11px] text-foreground-subtle">
          没有匹配项
        </div>
      );
    }
    return null;
  }
  return (
    <ul className={cn("space-y-0.5", depth > 0 && "ml-3 border-l border-border/30 pl-3")}>
      {filtered.map((node) => (
        <TreeRow key={node.path} node={node} query={query} depth={depth} />
      ))}
    </ul>
  );
}

function TreeRow({
  node,
  query,
  depth,
}: {
  node: TreeNode;
  query: string;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 1);
  if (node.type === "file") {
    return (
      <li className="flex items-center gap-2 rounded-md px-2 py-1 font-mono text-[11.5px] transition-colors hover:bg-accent/30">
        <Minus className="h-3 w-3 text-foreground-subtle" strokeWidth={2} />
        <span className="flex-1 truncate">{node.name}</span>
        <span className="text-foreground-subtle">{formatSize(node.size)}</span>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1 font-mono text-[12px] transition-colors hover:bg-accent/30",
          open && "bg-accent/40 text-foreground",
        )}
      >
        <ChevronDown
          className={cn(
            "h-3 w-3 text-foreground-muted transition-transform",
            !open && "-rotate-90",
          )}
          strokeWidth={2}
        />
        {open ? (
          <FolderOpen className="h-3.5 w-3.5 text-primary" />
        ) : (
          <Folder className="h-3.5 w-3.5 text-foreground-muted" />
        )}
        <span className="flex-1 truncate text-left">{node.name}</span>
        <span className="text-[10.5px] text-foreground-subtle">
          {node.total_descendants} 项
        </span>
      </button>
      {open && (
        <div className="ml-3 border-l border-border/30 pl-2">
          <TreeView nodes={node.children} query={query} depth={depth + 1} />
          {node.children.length === 0 && node.total_descendants > 0 && (
            <p className="ml-3 mt-1 font-mono text-[10.5px] text-foreground-subtle">
              共 {node.total_descendants} 个子项 / 懒加载待递归展开
            </p>
          )}
        </div>
      )}
    </li>
  );
}
