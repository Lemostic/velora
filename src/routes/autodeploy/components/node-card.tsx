// 节点卡 —— 画布上的单个节点
//
// 视觉：Element Plus 风格
//   - 240×96 矩形，bg-white border-[#dcdfe6] rounded-md
//   - 左侧 3px 分类色条（source=绿 / process=蓝 / transfer=橙）
//   - 顶部：图标 + 标题
//   - 中部：第一条非空参数摘要
//   - 底部：类型标识（category · type id）
//   - 右上角：状态点（idle / running / success / error / skipped）
//   - 选中：ring-2 ring-primary
//   - 左侧 / 右侧：圆形端口（10px），hover 放大并变 primary 色

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
  hoveredPort?: { port: number; side: "input" | "output" } | null;
}

// 用 Element Plus light 5 档做色条 —— 更克制
const CATEGORY_BAR: Record<string, string> = {
  source: "from-[#67c23a] to-[#95d475]",
  process: "from-[#409eff] to-[#79bbff]",
  transfer: "from-[#e6a23c] to-[#f3d19e]",
};

const CATEGORY_LABEL_TINT: Record<string, string> = {
  source: "text-[#67c23a]",
  process: "text-[#409eff]",
  transfer: "text-[#e6a23c]",
};

const STATUS_DOT: Record<NodeStatus, string> = {
  idle: "bg-[#c0c4cc]",
  running: "bg-[#409eff]",
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
  hoveredPort,
}: Props) {
  const nodeTypes = useAutodeployStore((s) => s.nodeTypes);
  const def = nodeTypes.find((t) => t.id === node.type);

  const Icon =
    (def?.icon && (Icons as unknown as Record<string, LucideIcon>)[def.icon]) ||
    Icons.Circle;

  // 取第一个非空参数做摘要
  const summary = def?.fields
    .map((f) => ({ label: f.label, value: node.params[f.name] }))
    .find((s) => s.value && s.value.length > 0);

  const bar = def ? CATEGORY_BAR[def.category] : "from-[#909399] to-[#b1b3b8]";
  const tint = def ? CATEGORY_LABEL_TINT[def.category] : "text-[#909399]";

  return (
    <div
      onPointerDown={onPointerDown}
      className={cn(
        "absolute select-none rounded-md border bg-white shadow-sm transition-shadow",
        "border-[#dcdfe6] hover:shadow-md",
        selected && "ring-2 ring-[#409eff] ring-offset-1 ring-offset-[#f5f7fa]",
        node.status === "error" && "border-[#f56c6c]/60",
        node.status === "running" && "border-[#409eff]/60",
      )}
      style={{
        left: node.x,
        top: node.y,
        width,
        height,
      }}
    >
      {/* 左侧分类色条（渐变） */}
      <div
        className={cn(
          "absolute left-0 top-0 h-full w-[3px] rounded-l-md bg-gradient-to-b",
          bar,
        )}
        aria-hidden
      />

      {/* 状态点（右上角小徽章） */}
      <div
        className="absolute -right-1.5 -top-1.5 flex items-center gap-1 rounded-full border border-white bg-white px-1.5 py-0.5 shadow-sm"
        title={STATUS_LABEL[node.status]}
      >
        <span
          className={cn(
            "size-2 rounded-full",
            STATUS_DOT[node.status],
            node.status === "running" && "pulse-ring",
          )}
        />
      </div>

      {/* 头部：图标 + 标题 */}
      <div className="flex h-7 items-center gap-2 px-2.5 pt-2 text-[13px] font-medium text-[#303133]">
        <Icon
          className={cn("size-3.5 shrink-0", tint)}
          strokeWidth={1.75}
        />
        <span className="truncate">{def?.label ?? node.type}</span>
      </div>

      {/* 摘要行：参数名 = 值 */}
      <div className="px-2.5 pb-1 text-[11px] text-[#909399] truncate">
        {summary ? (
          <span>
            <span className="text-[#c0c4cc]">{summary.label}:</span>{" "}
            <span className="font-mono text-[#606266]">{summary.value}</span>
          </span>
        ) : (
          <span>{def?.description ?? ""}</span>
        )}
      </div>

      {/* 底部 type id（小字） */}
      <div className="absolute bottom-1.5 left-2.5 right-2.5 flex items-center justify-between font-mono text-[10px] text-[#c0c4cc]">
        <span className="uppercase tracking-wider">{def?.category}</span>
        <span className="truncate">{node.type}</span>
      </div>

      {/* 输入端口 */}
      {def &&
        Array.from({ length: def.inputs }, (_, i) => {
          const p = portOffset(i, def.inputs, "input", width, height);
          const isHovered =
            hoveredPort?.side === "input" && hoveredPort.port === i;
          return (
            <div
              key={`in-${i}`}
              onPointerDown={(e) => onPortPointerDown(e, node.id, i, "input")}
              className={cn(
                "absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-white transition-all",
                "size-2.5 bg-[#c0c4cc] hover:scale-[1.6] hover:border-[#409eff] hover:bg-[#409eff]",
                isHovered && "scale-[1.8] border-[#409eff] bg-[#409eff] shadow-[0_0_0_4px_rgba(64,158,255,0.18)]",
              )}
              style={{ top: p.y, left: p.x }}
              title={`输入 ${i + 1}`}
            />
          );
        })}

      {/* 输出端口 */}
      {def &&
        Array.from({ length: def.outputs }, (_, i) => {
          const p = portOffset(i, def.outputs, "output", width, height);
          const isHovered =
            hoveredPort?.side === "output" && hoveredPort.port === i;
          return (
            <div
              key={`out-${i}`}
              onPointerDown={(e) => onPortPointerDown(e, node.id, i, "output")}
              className={cn(
                "absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-white transition-all",
                "size-2.5 bg-[#c0c4cc] hover:scale-[1.6] hover:border-[#409eff] hover:bg-[#409eff]",
                isHovered && "scale-[1.8] border-[#409eff] bg-[#409eff] shadow-[0_0_0_4px_rgba(64,158,255,0.18)]",
              )}
              style={{ top: p.y, left: p.x }}
              title={`输出 ${i + 1}`}
            />
          );
        })}
    </div>
  );
}
