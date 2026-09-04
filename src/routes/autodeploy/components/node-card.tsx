// 节点卡 —— 画布上的单个节点
//
// 视觉：Element Plus 风格
//   - 220×88 矩形，bg-white border border-[#dcdfe6] rounded-md shadow-sm
//   - 左侧 3px 分类色条（source=绿 / process=蓝 / transfer=橙）
//   - 顶部：图标 + 标题（label）
//   - 底部：参数摘要（最多 1 行）
//   - 右上角：状态点（idle / running / success / error）
//   - 选中：ring-2 ring-primary
//   - 左侧 / 右侧：圆形端口（size 6px）

import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useAutodeployStore } from "../store";
import { portOffset } from "../lib/geometry";
import type { CanvasNode, NodeStatus } from "../types";
import { cn } from "@/lib/utils";

interface Props {
  node: CanvasNode;
  selected: boolean;
  width: number;
  height: number;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPortPointerDown: (
    e: ReactPointerEvent<HTMLDivElement>,
    nodeId: string,
    portIndex: number,
    side: "input" | "output",
  ) => void;
}

const CATEGORY_BAR: Record<string, string> = {
  source: "bg-[#67c23a]",
  process: "bg-[#409eff]",
  transfer: "bg-[#e6a23c]",
};

const STATUS_DOT: Record<NodeStatus, string> = {
  idle: "bg-[#dcdfe6]",
  running: "bg-[#409eff] pulse-ring",
  success: "bg-[#67c23a]",
  error: "bg-[#f56c6c]",
  skipped: "bg-[#909399]",
};

const STATUS_LABEL: Record<NodeStatus, string> = {
  idle: "空闲",
  running: "执行中",
  success: "成功",
  error: "失败",
  skipped: "跳过",
};

export function NodeCard({
  node,
  selected,
  width,
  height,
  onPointerDown,
  onPortPointerDown,
}: Props) {
  const nodeTypes = useAutodeployStore((s) => s.nodeTypes);
  const def = nodeTypes.find((t) => t.id === node.type);

  const Icon = (def?.icon && (Icons as unknown as Record<string, LucideIcon>)[def.icon]) || Icons.Circle;

  // 参数摘要：显示第一个非空字段
  const summary = def?.fields
    .map((f) => node.params[f.name])
    .find((v) => v && v.length > 0);

  const barColor = def ? CATEGORY_BAR[def.category] : "bg-[#909399]";

  return (
    <div
      onPointerDown={onPointerDown}
      className={cn(
        "absolute select-none rounded-md border bg-white shadow-sm transition-shadow",
        "border-[var(--border)] hover:shadow-md",
        selected && "ring-2 ring-[var(--primary)] ring-offset-1 ring-offset-white",
        node.status === "error" && "border-[#f56c6c]/50",
      )}
      style={{
        left: node.x,
        top: node.y,
        width,
        height,
      }}
    >
      {/* 左侧分类色条 */}
      <div
        className={cn("absolute left-0 top-0 h-full w-[3px] rounded-l-md", barColor)}
        aria-hidden
      />

      {/* 状态点（右上角） */}
      <div
        className="absolute -right-1.5 -top-1.5 flex items-center gap-1 rounded-full border border-white bg-white px-1.5 py-0.5 shadow-sm"
        title={STATUS_LABEL[node.status]}
      >
        <span
          className={cn("size-2 rounded-full", STATUS_DOT[node.status])}
        />
      </div>

      {/* 头部：图标 + 标签 */}
      <div className="flex h-7 items-center gap-2 px-2.5 pt-1.5 text-[13px] font-medium text-[#303133]">
        <Icon className="size-3.5 text-[#606266]" strokeWidth={1.75} />
        <span className="truncate">{def?.label ?? node.type}</span>
      </div>

      {/* 副标题：参数摘要 */}
      <div className="px-2.5 pb-1 text-[11px] text-[#909399] truncate">
        {summary ?? def?.description ?? ""}
      </div>

      {/* 类型标识（底部小字） */}
      <div className="px-2.5 pb-1 font-mono text-[10px] text-[#c0c4cc]">
        {def?.category.toUpperCase()} · {node.type}
      </div>

      {/* 输入端口 */}
      {def &&
        Array.from({ length: def.inputs }, (_, i) => {
          const p = portOffset(i, def.inputs, "input", width, height);
          return (
            <div
              key={`in-${i}`}
              onPointerDown={(e) => onPortPointerDown(e, node.id, i, "input")}
              className="group absolute -left-1.5 z-10 size-3 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-white bg-[#909399] transition-transform hover:scale-125 hover:bg-[var(--primary)]"
              style={{ top: p.y, left: p.x }}
              title={`输入 ${i + 1}`}
            />
          );
        })}

      {/* 输出端口 */}
      {def &&
        Array.from({ length: def.outputs }, (_, i) => {
          const p = portOffset(i, def.outputs, "output", width, height);
          return (
            <div
              key={`out-${i}`}
              onPointerDown={(e) => onPortPointerDown(e, node.id, i, "output")}
              className="group absolute -right-1.5 z-10 size-3 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-white bg-[#909399] transition-transform hover:scale-125 hover:bg-[var(--primary)]"
              style={{ top: p.y, left: p.x }}
              title={`输出 ${i + 1}`}
            />
          );
        })}
    </div>
  );
}
