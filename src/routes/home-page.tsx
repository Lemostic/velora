import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  FileSpreadsheet,
  FolderTree,
  type LucideIcon,
  QrCode,
  Repeat2,
  Search,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MODULE_REGISTRY, type ModuleMeta } from "@/lib/registry";
import { PAGE_CONTAINER_CLASS, paddingToStyle } from "@/lib/spacing";
import { useAppStore } from "@/store/app-store";

const STATUS_META = {
  ready: { label: "已上线", dot: "bg-accent-emerald" },
  wip: { label: "开发中", dot: "bg-accent-amber" },
  planned: { label: "规划中", dot: "bg-foreground-subtle" },
} as const;

export function HomePage() {
  const contentPadding = useAppStore((s) => s.contentPadding);
  return (
    <div
      className={cn(PAGE_CONTAINER_CLASS, "relative min-h-full gap-10")}
      style={paddingToStyle(contentPadding)}
    >
      {/* Asymmetric hero — left aligned, no centered text */}
      <HeroSection />

      {/* Bento grid — asymmetric tile sizes */}
      <BentoGrid />
    </div>
  );
}

function HeroSection() {
  return (
    <section className="relative shrink-0 overflow-hidden rounded-xl border border-metallic bg-background-elevated/60 px-8 py-12 shadow-diffusion lg:px-12 lg:py-20 surface-hero glass-edge">
      <div className="absolute inset-0 surface-grid opacity-50" />
      {/* Ambient halos — pull focus away from the right edge so the
          command-palette card reads as the visual anchor instead of empty
          whitespace. */}
      <div
        className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full opacity-50"
        style={{
          background:
            "radial-gradient(closest-side, var(--ambient-emerald), transparent 70%)",
        }}
      />
      <div
        className="pointer-events-none absolute -bottom-32 -left-24 h-72 w-72 rounded-full opacity-50"
        style={{
          background:
            "radial-gradient(closest-side, var(--ambient-blue), transparent 70%)",
        }}
      />

      <div className="relative grid items-end gap-10 lg:grid-cols-12 lg:gap-10">
        {/* Title block — 7/12 columns */}
        <div className="flex flex-col gap-6 lg:col-span-7">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-background-overlay/60 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-foreground-muted backdrop-blur"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/60" />
              <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
            Tauri 2 · React 19 · Rust
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
            className="text-balance text-4xl font-semibold leading-[1.05] tracking-tighter lg:text-5xl"
          >
            一个干净的
            <br />
            桌面工具箱。
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-xl text-[15px] leading-relaxed text-foreground-muted"
          >
            一个模块专注一件事。开发、文件、转换、效率——每一类都有趁手的工具，
            全部跑在本地 Rust 端，零上传、零依赖、零妥协。
          </motion.p>

          {/* Inline category chips — replaces the deleted "11 modules / 2 ready
              · 2 wip · 7 planned" stat block. Communicates scope without
              numbers. */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-wrap gap-1.5 pt-1"
          >
            {[
              { label: "开发", icon: SlidersHorizontal },
              { label: "文件", icon: FolderTree },
              { label: "转换", icon: Repeat2 },
              { label: "效率", icon: Settings },
            ].map(({ label, icon: Icon }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background-overlay/40 px-2.5 py-1 font-mono text-[11px] tracking-tight text-foreground-muted"
              >
                <Icon className="h-3 w-3" strokeWidth={1.75} />
                {label}
              </span>
            ))}
          </motion.div>
        </div>

        {/* Command palette mock — 5/12 columns. The "right column" is now
            a real product surface (a ⌘K search) instead of dead space. */}
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            duration: 0.7,
            delay: 0.2,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="lg:col-span-5"
        >
          <CommandPaletteMock />
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Command-palette mock — the visual anchor of the hero's right column.
// Communicates "this is a tool box with quick-launch" instead of listing
// numbers.
// ---------------------------------------------------------------------------

interface PaletteItem {
  icon: LucideIcon;
  name: string;
  hint: string;
  /** Visual status of the underlying module. */
  status: "wip" | "ready" | "planned";
}

const PALETTE_ITEMS: PaletteItem[] = [
  { icon: QrCode, name: "二维码", hint: "生成 / 解析", status: "wip" },
  {
    icon: FileSpreadsheet,
    name: "Excel → JSON",
    hint: "结构化多 sheet",
    status: "wip",
  },
  { icon: Repeat2, name: "Excel 转置", hint: "行列互换 + 字段映射", status: "planned" },
  { icon: FolderTree, name: "文件树", hint: "本地目录可视化", status: "planned" },
  { icon: Settings, name: "偏好设置", hint: "主题 / 快捷键", status: "planned" },
];

function CommandPaletteMock() {
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-background-elevated/80 shadow-diffusion glass-edge backdrop-blur">
      {/* Search row */}
      <div className="flex items-center gap-2.5 border-b border-border/60 px-3.5 py-3">
        <Search className="h-3.5 w-3.5 text-foreground-muted" strokeWidth={1.75} />
        <span className="flex-1 font-mono text-[12px] tracking-tight text-foreground-muted">
          搜索模块…
        </span>
        <kbd className="rounded border border-border/60 bg-background-overlay/60 px-1.5 py-0.5 font-mono text-[10px] tracking-tight text-foreground-muted">
          ⌘ K
        </kbd>
      </div>

      {/* Result list */}
      <ul className="divide-y divide-border/40 px-1 py-1">
        {PALETTE_ITEMS.map((item, i) => (
          <motion.li
            key={item.name}
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              duration: 0.35,
              delay: 0.4 + i * 0.05,
              ease: [0.16, 1, 0.3, 1],
            }}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 transition-colors",
              i === 0
                ? "bg-primary/[0.08] text-foreground"
                : "text-foreground-muted hover:bg-accent/40 hover:text-foreground",
            )}
          >
            <item.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            <span className="font-mono text-[12px] tracking-tight">
              {item.name}
            </span>
            <span className="flex-1 truncate font-mono text-[11px] text-foreground-subtle">
              {item.hint}
            </span>
            <StatusDot status={item.status} />
          </motion.li>
        ))}
      </ul>

      {/* Footer hint */}
      <div className="flex items-center justify-between border-t border-border/60 bg-background-overlay/30 px-3.5 py-2 font-mono text-[10px] tracking-tight text-foreground-subtle">
        <span>↑ ↓ 选择</span>
        <span>⏎ 打开</span>
        <span>esc 关闭</span>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: PaletteItem["status"] }) {
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

function BentoGrid() {
  // Define explicit asymmetric placements for the 11 modules.
  // Span values are based on a 6-col / auto-row grid.
  const layout: Record<string, BentoSpan> = {
    "excel-schedule": { col: "col-span-2", row: "row-span-2", size: "lg" },
    "excel-to-json": { col: "col-span-2", row: "row-span-1", size: "md" },
    "qrcode": { col: "col-span-2", row: "row-span-1", size: "md" },
    "file-treeview": { col: "col-span-1", row: "row-span-1", size: "sm" },
    "markitdown": { col: "col-span-1", row: "row-span-1", size: "sm" },
    "es-query": { col: "col-span-1", row: "row-span-1", size: "sm" },
    "process-manager": { col: "col-span-1", row: "row-span-1", size: "sm" },
    "excel-transpose": { col: "col-span-1", row: "row-span-1", size: "sm" },
    "xml-json": { col: "col-span-1", row: "row-span-1", size: "sm" },
    "zip-clean": { col: "col-span-1", row: "row-span-1", size: "sm" },
    "preferences": { col: "col-span-2", row: "row-span-1", size: "md" },
  };

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-foreground-muted">
          所有模块
        </h2>
      </div>

      <motion.div
        className="grid auto-rows-[140px] grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
        initial="hidden"
        animate="show"
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: 0.04, delayChildren: 0.1 } },
        }}
      >
        {MODULE_REGISTRY.map((m) => (
          <BentoTile
            key={m.id}
            module={m}
            span={layout[m.id] ?? { col: "col-span-1", row: "row-span-1", size: "sm" }}
          />
        ))}
      </motion.div>
    </section>
  );
}

interface BentoSpan {
  col: string;
  row: string;
  size: "sm" | "md" | "lg";
}

function BentoTile({ module: m, span }: { module: ModuleMeta; span: BentoSpan }) {
  const Icon: LucideIcon = m.icon;
  const status = STATUS_META[m.status];
  const disabled = m.status === "planned";
  const isLg = span.size === "lg";

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 16 },
        show: {
          opacity: 1,
          y: 0,
          transition: { type: "spring", stiffness: 110, damping: 20 },
        },
      }}
      className={cn("min-h-0", span.col, span.row)}
    >
      <BentoCard
        module={m}
        icon={<Icon className={isLg ? "h-5 w-5" : "h-4 w-4"} strokeWidth={1.75} />}
        status={status}
        disabled={disabled}
        size={span.size}
      />
    </motion.div>
  );
}

interface BentoCardProps {
  module: ModuleMeta;
  icon: React.ReactNode;
  status: (typeof STATUS_META)[keyof typeof STATUS_META];
  disabled: boolean;
  size: "sm" | "md" | "lg";
}

function BentoCard({ module: m, icon, status, disabled, size }: BentoCardProps) {
  const inner = (
    <div
      className={cn(
        "group relative flex h-full w-full flex-col justify-between overflow-hidden rounded-xl border border-border bg-background-elevated/50 p-5 shadow-diffusion glass-edge transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
        disabled
          ? "opacity-55"
          : "hover:-translate-y-0.5 hover:border-primary/40 hover:bg-background-elevated/80 hover:shadow-glow",
      )}
    >
      {/* Subtle accent gradient overlay on hover (only on interactive tiles) */}
      {!disabled && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      )}

      <div className="relative flex items-start justify-between">
        <div
          className={cn(
            "grid place-items-center rounded-lg border border-border bg-background-overlay/60 text-foreground shadow-diffusion-sm",
            size === "lg" ? "h-11 w-11" : "h-9 w-9",
          )}
        >
          {icon}
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-background-overlay/60 px-2 py-0.5 text-[10px] font-medium tracking-tight text-foreground-muted backdrop-blur">
          <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
          {status.label}
        </div>
      </div>

      <div className="relative flex flex-col gap-1">
        <div
          className={cn(
            "font-semibold tracking-tight",
            size === "lg" ? "text-2xl" : "text-[15px]",
          )}
        >
          {m.name}
        </div>
        <p
          className={cn(
            "line-clamp-2 leading-snug text-foreground-muted",
            size === "lg" ? "text-[13px]" : "text-[12px]",
          )}
        >
          {m.description}
        </p>
      </div>

      {!disabled && (
        <div className="relative flex items-center justify-end">
          <span className="grid h-7 w-7 place-items-center rounded-full border border-border bg-background-overlay/60 text-foreground-muted transition-all duration-300 group-hover:border-primary/50 group-hover:bg-primary/15 group-hover:text-primary">
            <ArrowUpRight
              className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              strokeWidth={2}
            />
          </span>
        </div>
      )}
    </div>
  );

  if (disabled) {
    return <div className="block h-full">{inner}</div>;
  }

  return (
    <Link
      to={m.path}
      className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {inner}
    </Link>
  );
}
