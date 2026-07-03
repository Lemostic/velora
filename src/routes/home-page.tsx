import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MODULE_REGISTRY, type ModuleMeta } from "@/lib/registry";
import { PADDING_CLASSES } from "@/lib/spacing";
import { useAppStore } from "@/store/app-store";

const STATUS_META = {
  ready: { label: "已上线", dot: "bg-emerald-500" },
  wip: { label: "开发中", dot: "bg-amber-500" },
  planned: { label: "规划中", dot: "bg-zinc-500" },
} as const;

export function HomePage() {
  const contentPadding = useAppStore((s) => s.contentPadding);
  return (
    <div
      className={cn(
        "relative mx-auto flex min-h-full w-full max-w-[1400px] flex-col gap-10",
        PADDING_CLASSES[contentPadding],
      )}
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
    <section className="relative overflow-hidden rounded-xl border border-border/60 bg-card/40 px-8 py-10 shadow-diffusion lg:px-12 lg:py-14 surface-hero glass-edge">
      <div className="absolute inset-0 surface-grid opacity-60" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex max-w-2xl flex-col gap-4">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="inline-flex w-fit items-center gap-2 rounded-full border border-border/60 bg-background/40 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground backdrop-blur"
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
            className="max-w-xl text-[15px] leading-relaxed text-muted-foreground"
          >
            从 JavaFX/WorkbenchFX 重写而来。11 个内置模块，覆盖开发、文件、转换、效率四大场景，
            每个都在本地 Rust 端跑，零上传、零依赖、零妥协。
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="flex shrink-0 flex-col gap-2 lg:items-end"
        >
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-5xl font-semibold tracking-tighter text-foreground">
              11
            </span>
            <span className="text-sm text-muted-foreground">个模块</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="h-1 w-1 rounded-full bg-emerald-500" />
            <span className="font-mono">2 ready</span>
            <span className="h-1 w-1 rounded-full bg-amber-500" />
            <span className="font-mono">2 wip</span>
            <span className="h-1 w-1 rounded-full bg-zinc-500" />
            <span className="font-mono">7 planned</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
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
        <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
          所有模块
        </h2>
        <span className="font-mono text-[11px] text-muted-foreground/60">
          {MODULE_REGISTRY.length} / 11
        </span>
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
        "group relative flex h-full w-full flex-col justify-between overflow-hidden rounded-xl border border-border/60 bg-card/40 p-5 shadow-diffusion glass-edge transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
        disabled
          ? "opacity-50"
          : "hover:-translate-y-0.5 hover:border-primary/30 hover:bg-card/70 hover:shadow-[0_24px_48px_-20px_oklch(0.72_0.16_230/0.25),inset_0_1px_0_0_oklch(1_0_0/0.08),inset_0_-1px_0_0_oklch(0_0_0/0.2)]",
      )}
    >
      {/* Subtle accent gradient overlay on hover (only on interactive tiles) */}
      {!disabled && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.04] via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      )}

      <div className="relative flex items-start justify-between">
        <div
          className={cn(
            "grid place-items-center rounded-lg border border-border/60 bg-background/50 text-foreground shadow-diffusion-sm",
            size === "lg" ? "h-11 w-11" : "h-9 w-9",
          )}
        >
          {icon}
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10px] font-medium tracking-tight text-muted-foreground backdrop-blur">
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
            "line-clamp-2 leading-snug text-muted-foreground",
            size === "lg" ? "text-[13px]" : "text-[12px]",
          )}
        >
          {m.description}
        </p>
      </div>

      {!disabled && (
        <div className="relative flex items-center justify-end">
          <span className="grid h-7 w-7 place-items-center rounded-full border border-border/60 bg-background/40 text-muted-foreground transition-all duration-300 group-hover:border-primary/40 group-hover:bg-primary/10 group-hover:text-primary">
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
