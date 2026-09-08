import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Command } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MODULE_REGISTRY, type ModuleMeta } from "@/lib/registry";
import { PAGE_CONTAINER_CLASS, paddingToStyle } from "@/lib/spacing";
import { useAppStore } from "@/store/app-store";

// Element Plus 状态色（与画布 NodeCard / Inspector 状态点同色），不引额外 token。
const STATUS_META = {
  ready: { label: "已上线", dot: "bg-[#67c23a]" },
  wip: { label: "开发中", dot: "bg-[#e6a23c]" },
  planned: { label: "规划中", dot: "bg-[#909399]" },
} as const;

export function HomePage() {
  const contentPadding = useAppStore((s) => s.contentPadding);
  return (
    <div
      className={`${PAGE_CONTAINER_CLASS} relative min-h-full gap-8`}
      style={paddingToStyle(contentPadding)}
    >
      <HeroSection />
      <ModulesGrid />
    </div>
  );
}

// Hero —— 简洁一行式头版，左标题、右键盘快捷键提示
function HeroSection() {
  return (
    <section className="flex shrink-0 flex-col items-stretch gap-4 rounded-lg border border-[#ebeef5] bg-white px-6 py-7 shadow-sm lg:flex-row lg:items-center lg:justify-between lg:gap-8 lg:px-8">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[#ebeef5] bg-[#f5f7fa] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#909399]">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-[#409eff]/60" />
            <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-[#409eff]" />
          </span>
          Tauri 2 · React 19 · Rust
        </div>
        <motion.h1
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
          className="text-balance text-2xl font-semibold leading-tight tracking-tight text-[#303133] lg:text-[26px]"
        >
          一个干净的桌面工具箱
        </motion.h1>
        <p className="max-w-2xl text-[12px] leading-relaxed text-[#606266]">
          一个模块专注一件事——开发、文件、转换、效率，每一类都有趁手的工具。
          全部跑在本地 Rust 端，零上传、零依赖、零妥协。
        </p>
      </div>
      <PaletteHint />
    </section>
  );
}

// 单个键盘快捷键提示，点击触发 Cmd+K 命令面板
function PaletteHint() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("velora:open-palette"))}
      className="group flex shrink-0 items-center gap-2.5 rounded-md border border-[#ebeef5] bg-[#f5f7fa] px-3 py-2 text-[11px] text-[#606266] transition-all hover:border-[#c6e2ff] hover:bg-white hover:shadow-sm"
    >
      <Command className="h-3.5 w-3.5 text-[#409eff]" strokeWidth={1.75} />
      <span>跳到任何模块</span>
      <kbd className="rounded border border-[#ebeef5] bg-white px-1.5 py-0.5 font-mono text-[10px] tracking-tight text-[#909399]">
        Ctrl K
      </kbd>
    </button>
  );
}

// 模块网格 —— 统一尺寸，避免不对称布局带来的"溢出"错觉。
// 高度固定 112px，描述严格 line-clamp-2，标题 truncate，状态点 + 文案同行。
function ModulesGrid() {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#909399]">
          所有模块 · {MODULE_REGISTRY.length}
        </h2>
      </div>
      <motion.div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        initial="hidden"
        animate="show"
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: 0.035, delayChildren: 0.05 } },
        }}
      >
        {MODULE_REGISTRY.map((m) => (
          <ModuleTile key={m.id} module={m} />
        ))}
      </motion.div>
    </section>
  );
}

function ModuleTile({ module: m }: { module: ModuleMeta }) {
  const Icon: LucideIcon = m.icon;
  const status = STATUS_META[m.status];
  const disabled = m.status === "planned";

  const card = (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 8 },
        show: {
          opacity: 1,
          y: 0,
          transition: { type: "spring", stiffness: 120, damping: 22 },
        },
      }}
      className={[
        "group relative flex h-[112px] flex-col overflow-hidden rounded-md border bg-white p-3.5 transition-all",
        "border-[#ebeef5] shadow-sm",
        disabled
          ? "cursor-not-allowed opacity-55"
          : "hover:-translate-y-px hover:border-[#c6e2ff] hover:shadow-md",
      ].join(" ")}
    >
      {/* 上：图标 + 状态点 */}
      <div className="flex items-start justify-between">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[#ebeef5] bg-[#f5f7fa] text-[#409eff]">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <span
          className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-[#909399]"
          title={status.label}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>
      </div>

      {/* 下：标题 + 描述（严格限两行，绝不溢出） */}
      <div className="mt-auto flex flex-col gap-1">
        <div className="truncate text-[13px] font-medium text-[#303133]">
          {m.name}
        </div>
        <p className="line-clamp-2 text-[11px] leading-[1.4] text-[#909399]">
          {m.description}
        </p>
      </div>
    </motion.div>
  );

  if (disabled) return <div className="block">{card}</div>;

  return (
    <Link
      to={m.path}
      className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#409eff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f7fa]"
    >
      {card}
    </Link>
  );
}
