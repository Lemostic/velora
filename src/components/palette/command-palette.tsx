import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  CornerDownLeft,
  Eraser,
  Hash,
  Search as SearchIcon,
} from "lucide-react";
import { enabledModules, type ModuleMeta } from "@/lib/registry";
import { usePluginStore } from "@/store/plugin-store";
import { useAppStore } from "@/store/app-store";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * 真的「command palette」。
 *
 *  - 全局快捷键 Cmd/Ctrl+K 唤起 / 关闭
 *  - 输入框内实时过滤（按 id、name、description、tags 模糊匹配）
 *  - ↑ / ↓ 在结果集里切换高亮
 *  - Enter 跳到对应路由 + 关闭
 *  - Esc 关闭
 *  - 高亮条用 framer-motion `layoutId` 在结果间滑动，质感像 native Spotlight
 *  - 数据源 = plugin-store 启用的模块（用户禁用过的从结果里剔除）
 */

interface PaletteEntry {
  module: ModuleMeta;
  /** fuzzy 评分，越小越相关 */
  score: number;
}

const SCORE = {
  ID_HIT: 0,
  NAME_HIT: 1,
  TAG_HIT: 2,
  DESC_HIT: 3,
  MISS: Infinity,
};

function scoreModule(m: ModuleMeta, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return SCORE.ID_HIT; // 无 query 时所有项排成 registry 顺序
  // id 命中（按 id 整段或前缀）
  if (m.id.toLowerCase().includes(q)) return SCORE.ID_HIT;
  // name 命中
  if (m.name.toLowerCase().includes(q)) return SCORE.NAME_HIT;
  // tag 命中
  if (m.tags?.some((t) => t.toLowerCase().includes(q))) return SCORE.TAG_HIT;
  // description 命中
  if (m.description.toLowerCase().includes(q)) return SCORE.DESC_HIT;
  return SCORE.MISS;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const disabledModules = usePluginStore((s) => s.disabledModules);
  const recentModules = useAppStore((s) => s.recentModules);

  // Global Cmd/Ctrl+K listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    // Autofocus the input slightly after open so Radix mount doesn't steal it.
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Compute the result list.
  const results: PaletteEntry[] = useMemo(() => {
    const enabled = enabledModules(disabledModules);
    const q = query.trim().toLowerCase();
    const scored = enabled
      .map((m) => ({ module: m, score: scoreModule(m, q) }))
      .filter((e) => e.score !== SCORE.MISS);

    if (!q) {
      // 空 query：把最近用过的放前面，剩下的保持 registry 顺序。
      const recentSet = new Set(recentModules);
      const recents = scored.filter((e) => recentSet.has(e.module.id));
      recents.sort(
        (a, b) =>
          recentModules.indexOf(a.module.id) -
          recentModules.indexOf(b.module.id),
      );
      const others = scored.filter((e) => !recentSet.has(e.module.id));
      return [...recents, ...others];
    }

    return scored.sort((a, b) => a.score - b.score);
  }, [query, disabledModules, recentModules]);

  // Keep `active` clamped when results shrink.
  useEffect(() => {
    if (active >= results.length) {
      setActive(Math.max(0, results.length - 1));
    }
  }, [results.length, active]);

  // Auto-scroll active into view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-pal-index="${active}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function commit(index: number) {
    const entry = results[index];
    if (!entry) return;
    setOpen(false);
    navigate(entry.module.path);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(active);
    }
  }

  const empty = results.length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        // Override Radix default position; we want top-anchored, not centered.
        className="top-[14vh] max-w-[640px] overflow-hidden p-0"
        hideClose
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <DialogTitle className="sr-only">命令面板</DialogTitle>

        {/* Search row */}
        <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
          <SearchIcon
            className="h-3.5 w-3.5 text-foreground-muted"
            strokeWidth={1.75}
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            placeholder="搜索模块、输入 id 或描述关键字…"
            className={cn(
              "flex-1 bg-transparent text-[13px] text-foreground outline-none",
              "placeholder:text-foreground-subtle",
            )}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
          {query && (
            <button
              type="button"
              aria-label="清空"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="grid h-6 w-6 place-items-center rounded-md text-foreground-muted transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <Eraser className="h-3 w-3" strokeWidth={1.75} />
            </button>
          )}
          <kbd className="rounded border border-border/60 bg-background-overlay/60 px-1.5 py-0.5 font-mono text-[10px] text-foreground-muted">
            esc
          </kbd>
        </div>

        {/* Result list */}
        <div
          ref={listRef}
          className="max-h-[min(60vh,420px)] overflow-y-auto px-1.5 py-1.5"
        >
          {empty ? (
            <EmptyState query={query} />
          ) : (
            <AnimatePresence initial={false}>
              {results.map((entry, i) => (
                <ResultRow
                  key={entry.module.id}
                  index={i}
                  entry={entry}
                  active={i === active}
                  onHover={() => setActive(i)}
                  onSelect={() => commit(i)}
                />
              ))}
            </AnimatePresence>
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center justify-between border-t border-border/60 bg-background-overlay/30 px-4 py-2 font-mono text-[10px] text-foreground-subtle">
          <span className="flex items-center gap-3">
            <Hint k="↑">上</Hint>
            <Hint k="↓">下</Hint>
            <Hint k={<CornerDownEnter />}>打开</Hint>
          </span>
          <span>
            {results.length} 个结果 · {disabledModules.length === 0
              ? "全部启用"
              : `${disabledModules.length} 个已禁用`}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CornerDownEnter() {
  return <CornerDownLeft className="h-3 w-3" strokeWidth={1.75} />;
}

function Hint({ k, children }: { k: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <kbd className="rounded border border-border/60 bg-background-overlay/40 px-1 py-px">
        {k}
      </kbd>
      <span>{children}</span>
    </span>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center gap-2 px-4 py-12 text-center"
    >
      <div className="grid h-9 w-9 place-items-center rounded-full border border-border/60 bg-background-overlay/40 text-foreground-muted">
        <SearchIcon className="h-4 w-4" strokeWidth={1.5} />
      </div>
      <div className="text-[13px] font-medium text-foreground">
        {query ? `没有匹配「${query}」的模块` : "没有可用的模块"}
      </div>
      <div className="max-w-xs text-[11px] leading-relaxed text-foreground-muted">
        {query
          ? "试试搜「json」、「正则」、模块名片段或 id。也可以去 Preferences 启用更多模块。"
          : "去 Preferences 启用几个模块再回来。"}
      </div>
    </motion.div>
  );
}

function ResultRow({
  index,
  entry,
  active,
  onHover,
  onSelect,
}: {
  index: number;
  entry: PaletteEntry;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  const Icon = entry.module.icon;
  return (
    <motion.button
      type="button"
      data-pal-index={index}
      onMouseEnter={onHover}
      onClick={onSelect}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left outline-none",
        "transition-colors",
        active ? "text-foreground" : "text-foreground-muted",
      )}
    >
      {/* Sliding highlight bar */}
      {active && (
        <motion.span
          layoutId="palette-highlight"
          className="absolute inset-0 -z-0 rounded-md bg-primary/[0.08]"
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
        />
      )}
      <span
        className={cn(
          "relative grid h-7 w-7 shrink-0 place-items-center rounded-md border transition-colors",
          active
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-border/60 bg-background-overlay/40 text-foreground-muted",
        )}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      </span>
      <span className="relative flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate font-mono text-[12.5px] tracking-tight text-foreground">
          {entry.module.name}
        </span>
        <span className="truncate font-mono text-[10.5px] text-foreground-subtle">
          <Hash className="mr-0.5 inline h-2.5 w-2.5 align-baseline" strokeWidth={2} />
          {entry.module.id}
        </span>
      </span>
      <span className="relative flex shrink-0 items-center gap-1.5">
        <span className="font-mono text-[10px] text-foreground-subtle">
          {CATEGORY_LABEL[entry.module.category]}
        </span>
        <StatusDot status={entry.module.status} />
      </span>
    </motion.button>
  );
}

const CATEGORY_LABEL = {
  tools: "工具",
  files: "文件",
  convert: "转换",
  devtools: "开发",
  search: "搜索",
  productivity: "效率",
  system: "系统",
} as const satisfies Record<ModuleMeta["category"], string>;

function StatusDot({ status }: { status: ModuleMeta["status"] }) {
  if (status === "ready") {
    return <span className="h-1.5 w-1.5 rounded-full bg-accent-emerald" />;
  }
  if (status === "wip") {
    return (
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inset-0 animate-ping rounded-full bg-accent-amber/60" />
        <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-accent-amber" />
      </span>
    );
  }
  return <span className="h-1.5 w-1.5 rounded-full bg-foreground-subtle" />;
}
