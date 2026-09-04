// 右侧 Inspector —— 当前选中节点的参数面板
//
// 视觉：Element Plus 风格
//   - 280px 宽
//   - 顶部：节点类型 + 描述
//   - 中部：动态字段表单（用 FieldInput）
//   - 底部：删除节点按钮
//   - 未选中时显示提示文案

import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAutodeployStore, useSelectedNode } from "../store";
import { FieldInput } from "./field-input";
import { cn } from "@/lib/utils";

export function Inspector() {
  const node = useSelectedNode();
  const nodeTypes = useAutodeployStore((s) => s.nodeTypes);
  const updateNodeParam = useAutodeployStore((s) => s.updateNodeParam);
  const removeNode = useAutodeployStore((s) => s.removeNode);

  if (!node) {
    return (
      <aside className="flex h-full w-72 flex-col border-l border-[var(--border)] bg-white">
        <div className="border-b border-[var(--border-lighter)] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#909399]">
          检查器
        </div>
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] text-[#c0c4cc]">
          选中画布上的节点查看参数
        </div>
      </aside>
    );
  }

  const def = nodeTypes.find((t) => t.id === node.type);
  const Icon =
    (def?.icon && (Icons as unknown as Record<string, LucideIcon>)[def.icon]) || Icons.Circle;

  // 必填校验：标红缺失项
  const missingRequired = (def?.fields ?? [])
    .filter((f) => f.required && !node.params[f.name])
    .map((f) => f.name);

  return (
    <aside className="flex h-full w-72 flex-col border-l border-[var(--border)] bg-white">
      {/* 节点头 */}
      <div className="border-b border-[var(--border-lighter)] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded text-white",
              def?.category === "source" && "bg-[#67c23a]",
              def?.category === "process" && "bg-[#409eff]",
              def?.category === "transfer" && "bg-[#e6a23c]",
            )}
          >
            <Icon className="size-3.5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-[#303133]">
              {def?.label ?? node.type}
            </div>
            <div className="truncate font-mono text-[10px] text-[#c0c4cc]">
              {node.type}
            </div>
          </div>
        </div>
        {def?.description && (
          <p className="mt-2 text-[11px] leading-relaxed text-[#909399]">
            {def.description}
          </p>
        )}
      </div>

      {/* 字段表单 */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {def?.fields.length ? (
          def.fields.map((f) => (
            <FieldInput
              key={f.name}
              field={f}
              value={node.params[f.name] ?? ""}
              onChange={(v) => updateNodeParam(node.id, f.name, v)}
            />
          ))
        ) : (
          <div className="text-[12px] text-[#c0c4cc]">此节点没有可配置参数</div>
        )}

        {missingRequired.length > 0 && (
          <div className="rounded border border-[#f56c6c]/40 bg-[#fef0f0] px-2.5 py-1.5 text-[11px] text-[#f56c6c]">
            {missingRequired.length} 个必填字段未填
          </div>
        )}
      </div>

      {/* 底部操作 */}
      <div className="border-t border-[var(--border-lighter)] p-2">
        <button
          onClick={() => {
            if (window.confirm(`删除节点「${def?.label ?? node.type}」？`)) {
              removeNode(node.id);
            }
          }}
          className="h-7 w-full rounded text-[12px] text-[#f56c6c] transition-colors hover:bg-[#fef0f0]"
        >
          删除节点
        </button>
      </div>
    </aside>
  );
}
