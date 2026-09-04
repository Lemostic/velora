// 顶部工具条 —— 工作流名 / 状态 / 保存 / 模板 / dry-run / run
//
// 视觉：Element Plus 风格
//   - 高 44px，bg-white，底部 1px border
//   - 左侧：工作流名（可编辑）
//   - 中间：状态徽章
//   - 右侧：模板、保存、dry-run、run 按钮

import {
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
import { useAutodeployStore } from "../store";
import { BUILTIN_TEMPLATES } from "../lib/templates";
import { useState } from "react";

interface Props {
  onRun: () => void;
  onDryRun: () => void;
}

export function TopToolbar({ onRun, onDryRun }: Props) {
  const workflow = useAutodeployStore((s) => s.workflow);
  const runState = useAutodeployStore((s) => s.runState);
  const renameWorkflow = useAutodeployStore((s) => s.renameWorkflow);
  const applyTemplate = useAutodeployStore((s) => s.applyTemplate);
  const resetWorkflow = useAutodeployStore((s) => s.resetWorkflow);
  const nodeCount = workflow.nodes.length;
  const [name, setName] = useState(workflow.name);

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-white px-3">
      {/* 工作流名 */}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => renameWorkflow(name || "未命名工作流")}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="h-7 max-w-[200px] rounded border border-transparent bg-transparent px-2 text-[13px] font-medium text-[#303133] outline-none transition-colors hover:border-[var(--border)] focus:border-[var(--primary)] focus:bg-white"
      />

      {/* 状态徽章 */}
      <RunStateBadge state={runState} />

      <span className="font-mono text-[10px] text-[#c0c4cc]">
        {nodeCount} 节点 · {workflow.connections.length} 连线
      </span>

      <div className="flex-1" />

      {/* 模板按钮 */}
      <TemplateMenu
        onPick={(id) => {
          if (nodeCount > 0 && !window.confirm("加载模板会覆盖当前画布，继续？")) {
            return;
          }
          applyTemplate(id);
          const tpl = BUILTIN_TEMPLATES.find((t) => t.id === id);
          if (tpl) setName(tpl.workflow.name);
        }}
      />

      {/* 重置 */}
      <button
        onClick={() => {
          if (nodeCount === 0) return;
          if (window.confirm("清空当前画布？")) {
            resetWorkflow();
            setName("新建工作流");
          }
        }}
        className="flex h-7 items-center gap-1 rounded px-2 text-[12px] text-[#606266] transition-colors hover:bg-[#f5f7fa] hover:text-[#303133]"
        title="清空画布"
      >
        <Trash2 className="size-3.5" strokeWidth={1.75} />
        清空
      </button>

      {/* 保存（持久化已自动，仅作视觉提示） */}
      <button
        onClick={() => {
          // 状态已经在 zustand persist 中自动保存
          flash("已自动保存到 localStorage");
        }}
        className="flex h-7 items-center gap-1 rounded border border-[var(--border)] bg-white px-2.5 text-[12px] text-[#606266] transition-colors hover:border-[var(--primary-light-3)] hover:text-[var(--primary)]"
        title="工作流自动保存到 localStorage"
      >
        <Save className="size-3.5" strokeWidth={1.75} />
        保存
      </button>

      {/* dry-run */}
      <button
        onClick={onDryRun}
        disabled={runState === "running" || nodeCount === 0}
        className="flex h-7 items-center gap-1 rounded border border-[var(--border)] bg-white px-2.5 text-[12px] text-[#606266] transition-colors hover:border-[var(--primary-light-3)] hover:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
        title="只校验，不真正执行"
      >
        <FlaskConical className="size-3.5" strokeWidth={1.75} />
        dry-run
      </button>

      {/* run */}
      <button
        onClick={onRun}
        disabled={runState === "running" || nodeCount === 0}
        className="flex h-7 items-center gap-1 rounded bg-[var(--primary)] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[var(--primary-dark-2)] disabled:cursor-not-allowed disabled:opacity-50"
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

function RunStateBadge({ state }: { state: import("../types").RunState }) {
  if (state === "idle") {
    return (
      <span className="flex h-6 items-center gap-1 rounded-full bg-[#f5f7fa] px-2 text-[11px] text-[#909399]">
        <CircleDashed className="size-3" strokeWidth={2} /> idle
      </span>
    );
  }
  if (state === "running") {
    return (
      <span className="flex h-6 items-center gap-1 rounded-full bg-[#ecf5ff] px-2 text-[11px] text-[#409eff]">
        <Loader2 className="size-3 animate-spin" strokeWidth={2} /> running
      </span>
    );
  }
  if (state === "success") {
    return (
      <span className="flex h-6 items-center gap-1 rounded-full bg-[#e1f3d8] px-2 text-[11px] text-[#67c23a]">
        <CheckCircle2 className="size-3" strokeWidth={2} /> success
      </span>
    );
  }
  return (
    <span className="flex h-6 items-center gap-1 rounded-full bg-[#fef0f0] px-2 text-[11px] text-[#f56c6c]">
      <XCircle className="size-3" strokeWidth={2} /> error
    </span>
  );
}

function TemplateMenu({ onPick }: { onPick: (id: string) => void }) {
  return (
    <div className="group relative">
      <button className="flex h-7 items-center gap-1 rounded px-2 text-[12px] text-[#606266] transition-colors hover:bg-[#f5f7fa] hover:text-[#303133]">
        <Sparkles className="size-3.5" strokeWidth={1.75} />
        模板
      </button>
      <div className="invisible absolute right-0 top-full z-50 mt-1 w-64 origin-top-right scale-95 rounded-md border border-[var(--border)] bg-white opacity-0 shadow-lg transition-all group-hover:visible group-hover:scale-100 group-hover:opacity-100">
        <div className="border-b border-[var(--border-lighter)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#909399]">
          内置模板
        </div>
        {BUILTIN_TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => onPick(t.id)}
            className="flex w-full items-start gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-[#f5f7fa]"
          >
            <FilePlus2 className="mt-0.5 size-3.5 shrink-0 text-[#909399]" strokeWidth={1.75} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-[#303133]">{t.name}</span>
              <span className="block text-[11px] text-[#909399]">{t.description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function flash(msg: string) {
  // 简易提示：浏览器自带的 title 闪烁
  const orig = document.title;
  document.title = msg;
  window.setTimeout(() => {
    document.title = orig;
  }, 1500);
}
