// 顶部工具条 —— 工作流名 / 校验 / 状态 / 暂存 / 模板 / dry-run / run
//
// 视觉：Element Plus 风格
//   - 高 48px，bg-white，底部 1px border
//   - 左侧：可编辑工作流名 + 校验徽章 + 状态徽章 + 自动暂存时间
//   - 右侧：模板、清空、保存、dry-run、run 按钮
//
// 校验（lib/validate.ts）：
//   - 任何 errors > 0 → 校验徽章变红，run / dry-run / 保存到文件 按钮全部 disabled
//   - 鼠标悬停 disabled 按钮显示错误清单 tooltip

import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  CirclePlay,
  FilePlus2,
  FlaskConical,
  Loader2,
  Save,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAutodeployStore } from "../store";
import { BUILTIN_TEMPLATES } from "../lib/templates";
import { validateWorkflow } from "../lib/validate";
import { cn } from "@/lib/utils";

interface Props {
  onRun: () => void;
  onDryRun: () => void;
}

export function TopToolbar({ onRun, onDryRun }: Props) {
  const workflow = useAutodeployStore((s) => s.workflow);
  const runState = useAutodeployStore((s) => s.runState);
  const nodeTypes = useAutodeployStore((s) => s.nodeTypes);
  const renameWorkflow = useAutodeployStore((s) => s.renameWorkflow);
  const applyTemplate = useAutodeployStore((s) => s.applyTemplate);
  const resetWorkflow = useAutodeployStore((s) => s.resetWorkflow);
  const nodeCount = workflow.nodes.length;
  const [name, setName] = useState(workflow.name);

  // 校验
  const errors = useMemo(
    () => validateWorkflow(workflow, nodeTypes),
    [workflow, nodeTypes],
  );
  const errorCount = errors.length;
  const errorMessages = useMemo(
    () => errors.map((e) => e.message).join("\n"),
    [errors],
  );

  // 自动暂存时间戳 —— 纯组件本地 state（不要进 store，store 同步 setState
  // 会与 zustand useSyncExternalStore 触发 React #185 无限渲染）。
  // 每次 workflow 引用变化就刷新，组件级 setState 不会引发循环。
  const [savedAt, setSavedAt] = useState(() => Date.now());
  useEffect(() => {
    setSavedAt(Date.now());
  }, [workflow]);

  return (
    <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-[#dcdfe6] bg-white px-3">
      {/* 工作流名 */}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => renameWorkflow(name || "未命名工作流")}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="工作流名"
        className="h-7 max-w-[220px] rounded border border-transparent bg-transparent px-2 text-[13px] font-medium text-[#303133] outline-none transition-colors hover:border-[#dcdfe6] focus:border-[#409eff] focus:bg-white"
      />

      {/* 校验徽章 */}
      <ValidationBadge
        errorCount={errorCount}
        message={errorCount > 0 ? errorMessages : "工作流结构完整"}
      />

      {/* 运行态徽章 */}
      <RunStateBadge state={runState} />

      <span className="font-mono text-[10px] text-[#c0c4cc]">
        {nodeCount} 节点 · {workflow.connections.length} 连线
      </span>

      {/* 自动暂存时间 */}
      <AutosaveIndicator ts={savedAt} />

      <div className="flex-1" />

      {/* 模板 */}
      <TemplateMenu
        onPick={(id) => {
          if (
            nodeCount > 0 &&
            !window.confirm("加载模板会覆盖当前画布，继续？")
          ) {
            return;
          }
          applyTemplate(id);
          const tpl = BUILTIN_TEMPLATES.find((t) => t.id === id);
          if (tpl) setName(tpl.workflow.name);
        }}
      />

      {/* 清空 */}
      <button
        onClick={() => {
          if (nodeCount === 0) return;
          if (window.confirm("清空当前画布？")) {
            resetWorkflow();
            setName("新建工作流");
          }
        }}
        className="inline-flex h-7 items-center gap-1 rounded px-2.5 text-[12px] text-[#606266] transition-colors hover:bg-[#f5f7fa] hover:text-[#303133]"
        title="清空画布"
      >
        <Trash2 className="size-3.5" strokeWidth={1.75} />
        清空
      </button>

      {/* 保存到文件（不通过校验就 disable） */}
      <button
        onClick={() => void saveWorkflowToFile(workflow)}
        disabled={errorCount > 0}
        title={
          errorCount > 0
            ? `工作流不完整，无法保存：\n${errorMessages}`
            : "导出工作流 JSON 到本地文件"
        }
        className="inline-flex h-7 items-center gap-1 rounded border border-[#dcdfe6] bg-white px-2.5 text-[12px] text-[#606266] transition-colors hover:border-[#409eff]/40 hover:text-[#409eff] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Save className="size-3.5" strokeWidth={1.75} />
        保存
      </button>

      {/* dry-run */}
      <button
        onClick={onDryRun}
        disabled={
          runState === "running" || nodeCount === 0 || errorCount > 0
        }
        title={
          errorCount > 0
            ? `工作流不完整：\n${errorMessages}`
            : "只校验，不真正执行"
        }
        className="inline-flex h-7 items-center gap-1 rounded border border-[#dcdfe6] bg-white px-2.5 text-[12px] text-[#606266] transition-colors hover:border-[#409eff]/40 hover:text-[#409eff] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <FlaskConical className="size-3.5" strokeWidth={1.75} />
        dry-run
      </button>

      {/* run */}
      <button
        onClick={onRun}
        disabled={
          runState === "running" || nodeCount === 0 || errorCount > 0
        }
        title={
          errorCount > 0
            ? `工作流不完整：\n${errorMessages}`
            : undefined
        }
        className="inline-flex h-7 items-center gap-1 rounded bg-[#409eff] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[#337ecc] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {runState === "running" ? (
          <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
        ) : (
          <CirclePlay className="size-3.5" strokeWidth={1.75} />
        )}
        run
      </button>
    </div>
  );
}

function ValidationBadge({
  errorCount,
  message,
}: {
  errorCount: number;
  message: string;
}) {
  if (errorCount === 0) {
    return (
      <span
        title={message}
        className="inline-flex h-6 items-center gap-1 rounded-full bg-[#f0f9eb] px-2 text-[11px] font-medium text-[#67c23a]"
      >
        <CheckCircle2 className="size-3" strokeWidth={2} />
        valid
      </span>
    );
  }
  return (
    <span
      title={message}
      className="inline-flex h-6 max-w-[260px] cursor-help items-center gap-1 truncate rounded-full bg-[#fef0f0] px-2 text-[11px] font-medium text-[#f56c6c]"
    >
      <AlertCircle className="size-3 shrink-0" strokeWidth={2} />
      <span className="truncate">{errorCount} 处问题</span>
    </span>
  );
}

function AutosaveIndicator({ ts }: { ts: number }) {
  // 每 30s 强制刷新一次以更新 hh:mm:ss 显示
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const time = new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
  return (
    <span
      className="hidden items-center gap-1 font-mono text-[10px] text-[#c0c4cc] sm:inline-flex"
      title={`最近一次自动暂存时间（zustand persist middleware 每次画布变更都自动写 localStorage）`}
    >
      <Save className="size-2.5" strokeWidth={2} />
      已暂存 {time}
    </span>
  );
}

function RunStateBadge({ state }: { state: import("../types").RunState }) {
  const config = (() => {
    if (state === "running")
      return {
        bg: "bg-[#ecf5ff]",
        color: "text-[#409eff]",
        label: "running",
        icon: Loader2,
        spin: true,
      };
    if (state === "success")
      return {
        bg: "bg-[#e1f3d8]",
        color: "text-[#67c23a]",
        label: "success",
        icon: CheckCircle2,
        spin: false,
      };
    if (state === "error")
      return {
        bg: "bg-[#fef0f0]",
        color: "text-[#f56c6c]",
        label: "error",
        icon: XCircle,
        spin: false,
      };
    return {
      bg: "bg-[#f5f7fa]",
      color: "text-[#909399]",
      label: "idle",
      icon: CircleDashed,
      spin: false,
    };
  })();
  const Icon = config.icon;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-medium",
        config.bg,
        config.color,
      )}
    >
      <Icon
        className={cn("size-3", config.spin && "animate-spin")}
        strokeWidth={2}
      />
      {config.label}
    </span>
  );
}

function TemplateMenu({ onPick }: { onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      <button
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded px-2.5 text-[12px] transition-colors",
          open
            ? "bg-[#ecf5ff] text-[#409eff]"
            : "text-[#606266] hover:bg-[#f5f7fa] hover:text-[#303133]",
        )}
      >
        <Sparkles className="size-3.5" strokeWidth={1.75} />
        模板
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-50 mt-1 w-72 origin-top-right overflow-hidden rounded-md border border-[#dcdfe6] bg-white shadow-lg"
          >
            <div className="border-b border-[#ebeef5] bg-[#f5f7fa] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#909399]">
              内置模板
            </div>
            {BUILTIN_TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => onPick(t.id)}
                className="flex w-full items-start gap-2.5 border-b border-[#f5f7fa] px-3 py-2.5 text-left text-[12px] transition-colors last:border-b-0 hover:bg-[#f5f7fa]"
              >
                <FilePlus2
                  className="mt-0.5 size-3.5 shrink-0 text-[#909399]"
                  strokeWidth={1.75}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-[#303133]">
                    {t.name}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-[#909399]">
                    {t.description}
                  </span>
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// 把工作流 JSON 写到用户选的本地文件。先通过 Tauri dialog 让用户选路径，
// 再用 plugin-fs 写入。不在 Tauri runtime（vite dev）就 fallback 到浏览器下载。
async function saveWorkflowToFile(workflow: import("../types").Workflow) {
  const json = JSON.stringify(workflow, null, 2);
  const hasTauri =
    typeof window !== "undefined" &&
    typeof (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ !== "undefined";
  if (hasTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const safeName =
      workflow.name.replace(/[\\/:*?"<>|]/g, "_") || "workflow";
    const target = await save({
      title: "保存工作流",
      defaultPath: `${safeName}.velora.json`,
      filters: [{ name: "Velora workflow", extensions: ["json"] }],
    });
    if (!target) return;
    await writeTextFile(target, json);
    flash(`已保存到 ${target}`);
  } else {
    // vite dev 浏览器预览：触发下载
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workflow.name || "workflow"}.velora.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

function flash(msg: string) {
  const orig = document.title;
  document.title = msg;
  window.setTimeout(() => {
    document.title = orig;
  }, 1500);
}
