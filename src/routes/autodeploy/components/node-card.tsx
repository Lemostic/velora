// 节点卡 —— 画布上的单个节点
//
// 视觉：Element Plus 风格
//   - 168×56 单行紧凑布局（icon + 标签 + 状态点），bg-white border-[#dcdfe6] rounded-md
//   - 左侧 3px 分类色条
//   - 端口：自包含 PortHandle 子组件，用 onMouseDown + window 同步
//     native listener（Playwright drag dispatch 的是 mouse events，
//     React onPointerDown 不一定触发）

import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useAutodeployStore } from "../store";
import { portOffset } from "../lib/geometry";
import type { CanvasNode, NodeStatus } from "../types";
import { cn } from "@/lib/utils";

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

interface Props {
  node: CanvasNode;
  selected: boolean;
  width: number;
  height: number;
  onMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => void;
  hoveredPort?: { port: number; side: "input" | "output" } | null;
  /**
   * 右键回调：把右键事件上抛到 Canvas，由 Canvas 统一渲染菜单位于鼠标位置。
   * 之所以不在 NodeCard 内部用 createPortal + position:fixed，是因为父级
   * 世界层有 `transform: translate() scale()`，会创建一个 containing block
   * 把 fixed 元素困在画布里（甚至完全不可见）；通过 Canvas 渲染则可以
   * 把菜单作为 canvas div 的直接子元素（canvas div 本身没有 transform），
   * 用 position:fixed 直接锚定到视口。
   */
  onContextMenuAt: (nodeId: string, clientX: number, clientY: number) => void;
}

// ─────────────────────────────────────────────
// PortHandle —— 端口（自包含 mouse 拖拽）
// ─────────────────────────────────────────────
interface PortProps {
  nodeId: string;
  portIndex: number;
  side: "input" | "output";
  x: number;
  y: number;
  isHovered: boolean;
  /** 通知 canvas 这条 port 起始了画线（canvas 内部统一接管后续 mousemove / mouseup） */
  onConnectStart: (info: { fromNode: string; fromPort: number; fromSide: "input" | "output" }) => void;
}

function PortHandle({
  nodeId,
  portIndex,
  side,
  x,
  y,
  isHovered,
  onConnectStart,
}: Omit<PortProps, "onConnectMove" | "onConnectEnd">) {
  return (
    <div
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        // 通知 canvas 起点：canvas 内部装的那套 window listener 接管
        // mousemove / mouseup / Esc。这里完全不装 listener，事件流唯一确定。
        onConnectStart({ fromNode: nodeId, fromPort: portIndex, fromSide: side });
      }}
      className={cn(
        "absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-white transition-all",
        "size-3.5 bg-[#c0c4cc] hover:scale-[1.3] hover:border-[#409eff] hover:bg-[#409eff]",
        isHovered &&
          "scale-[1.4] border-[#409eff] bg-[#409eff] shadow-[0_0_0_4px_rgba(64,158,255,0.18)]",
      )}
      style={{ top: y, left: x }}
    >
      {/* 自定义 tooltip：port hover 时显示在 port 旁。不能用 HTML title，
          WebView2 会把 title 渲染为 OS native tooltip window，浮在 web content
          之上并拦截 mousedown，导致 port 完全点不动。 */}
      {isHovered && (
        <div
          className={cn(
            "pointer-events-none absolute z-20 whitespace-nowrap rounded bg-[#303133] px-1.5 py-0.5 text-[10px] text-white shadow-md",
            side === "input" ? "left-full ml-2" : "right-full mr-2",
          )}
        >
          {side === "input" ? `输入 ${portIndex + 1}` : `输出 ${portIndex + 1}`}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// NodeCard
// ─────────────────────────────────────────────
export function NodeCard({
  node,
  selected,
  width,
  height,
  onMouseDown,
  onConnectStart,
  hoveredPort,
  onContextMenuAt,
}: Props & {
  onConnectStart: PortProps["onConnectStart"];
}) {
  const nodeTypes = useAutodeployStore((s) => s.nodeTypes);

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation(); // 不冒泡到 Canvas，避免触发画布级右键菜单
    onContextMenuAt(node.id, e.clientX, e.clientY);
  };

  const def = nodeTypes.find((t) => t.id === node.type);

  const Icon =
    (def?.icon && (Icons as unknown as Record<string, LucideIcon>)[def.icon]) ||
    Icons.Circle;

  const bar = def ? CATEGORY_BAR[def.category] : "from-[#909399] to-[#b1b3b8]";
  const tint = def ? CATEGORY_LABEL_TINT[def.category] : "text-[#909399]";

  return (
    <div
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
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
      <div
        className={cn(
          "absolute left-0 top-0 h-full w-[3px] rounded-l-md bg-gradient-to-b",
          bar,
        )}
        aria-hidden
      />

      {/* 单行紧凑布局：图标 + 标签 + 状态点。56px 节点高度刚好放得下。
          摘要 / category / type 这种次要信息放到右侧 Inspector，不再占
          画布空间。 */}
      <div className="flex h-full items-center gap-2 pl-2.5 pr-2 text-[12px] font-medium text-[#303133]">
        <Icon className={cn("size-3.5 shrink-0", tint)} strokeWidth={1.75} />
        <span className="flex-1 truncate">{def?.label ?? node.type}</span>
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            STATUS_DOT[node.status],
            node.status === "running" && "pulse-ring",
          )}
          title={STATUS_LABEL[node.status]}
        />
      </div>

      {def?.inputs &&
        Array.from({ length: def.inputs }, (_, i) => {
          const p = portOffset(i, def.inputs, "input", width, height);
          return (
            <PortHandle
              key={`in-${i}`}
              nodeId={node.id}
              portIndex={i}
              side="input"
              x={p.x}
              y={p.y}
              isHovered={hoveredPort?.side === "input" && hoveredPort.port === i}
              onConnectStart={onConnectStart}
            />
          );
        })}

      {def?.outputs &&
        Array.from({ length: def.outputs }, (_, i) => {
          const p = portOffset(i, def.outputs, "output", width, height);
          return (
            <PortHandle
              key={`out-${i}`}
              nodeId={node.id}
              portIndex={i}
              side="output"
              x={p.x}
              y={p.y}
              isHovered={hoveredPort?.side === "output" && hoveredPort.port === i}
              onConnectStart={onConnectStart}
            />
          );
        })}

    </div>
  );
}
