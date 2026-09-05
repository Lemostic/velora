// 节点卡 —— 画布上的单个节点
//
// 视觉：Element Plus 风格
//   - 240×96 矩形，bg-white border-[#dcdfe6] rounded-md
//   - 左侧 3px 分类色条
//   - 端口：自包含 PortHandle 子组件，用 onMouseDown + window 同步
//     native listener（Playwright drag dispatch 的是 mouse events，
//     React onPointerDown 不一定触发）

import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRef } from "react";
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
  /** 通知 canvas 这条 port 起始了画线 */
  onConnectStart: (info: { fromNode: string; fromPort: number; fromSide: "input" | "output" }) => void;
  /** 通知 canvas 鼠标移动（更新 pendingConn） */
  onConnectMove: (screenX: number, screenY: number) => void;
  /** 通知 canvas mouseup（完成画线） */
  onConnectEnd: (screenX: number, screenY: number) => void;
}

function PortHandle({
  nodeId,
  portIndex,
  side,
  x,
  y,
  isHovered,
  onConnectStart,
  onConnectMove,
  onConnectEnd,
}: PortProps) {
  const ref = useRef<HTMLDivElement>(null);

  // window native listener 只在 mousedown 那一次渲染里安装，但画布在拖拽中
  // 会因 pendingConn / hoverPort 更新持续重渲染、不断换新的回调 props。
  // 把最新回调存进 ref，listener 每次触发都经 ref 调用 —— 否则闭包会一直
  // 调用 mousedown 时的旧回调（旧回调里 pendingConn 还是 null，虚线永不跟手、
  // hit test 也永远拿不到最新节点数据）。
  const latestRef = useRef({ onConnectMove, onConnectEnd });
  latestRef.current = { onConnectMove, onConnectEnd };

  return (
    <div
      ref={ref}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        // 通知 canvas 起点（同步调用，走当前渲染的最新闭包）
        onConnectStart({ fromNode: nodeId, fromPort: portIndex, fromSide: side });
        // 同步装 native window listener（不进 useEffect 异步 commit 陷阱）
        function onMove(ev: MouseEvent) {
          latestRef.current.onConnectMove(ev.clientX, ev.clientY);
        }
        function onUp(ev: MouseEvent) {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          window.removeEventListener("keydown", onKey);
          latestRef.current.onConnectEnd(ev.clientX, ev.clientY);
        }
        function onKey(ev: KeyboardEvent) {
          if (ev.key === "Escape") {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            window.removeEventListener("keydown", onKey);
            // ESC = 取消画线：给画布外的坐标，让 hit test 必然落空
            latestRef.current.onConnectEnd(-9999, -9999);
          }
        }
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        window.addEventListener("keydown", onKey);
      }}
      className={cn(
        "absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-white transition-all",
        "size-3.5 bg-[#c0c4cc] hover:scale-[1.3] hover:border-[#409eff] hover:bg-[#409eff]",
        isHovered &&
          "scale-[1.4] border-[#409eff] bg-[#409eff] shadow-[0_0_0_4px_rgba(64,158,255,0.18)]",
      )}
      style={{ top: y, left: x }}
      title={side === "input" ? `输入 ${portIndex + 1}` : `输出 ${portIndex + 1}`}
    />
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
  onConnectMove,
  onConnectEnd,
  hoveredPort,
}: Props & {
  onConnectStart: PortProps["onConnectStart"];
  onConnectMove: PortProps["onConnectMove"];
  onConnectEnd: PortProps["onConnectEnd"];
}) {
  const nodeTypes = useAutodeployStore((s) => s.nodeTypes);
  const def = nodeTypes.find((t) => t.id === node.type);

  const Icon =
    (def?.icon && (Icons as unknown as Record<string, LucideIcon>)[def.icon]) ||
    Icons.Circle;

  const summary = def?.fields
    .map((f) => ({ label: f.label, value: node.params[f.name] }))
    .find((s) => s.value && s.value.length > 0);

  const bar = def ? CATEGORY_BAR[def.category] : "from-[#909399] to-[#b1b3b8]";
  const tint = def ? CATEGORY_LABEL_TINT[def.category] : "text-[#909399]";

  return (
    <div
      onMouseDown={onMouseDown}
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

      <div className="flex h-7 items-center gap-2 px-2.5 pt-2 text-[13px] font-medium text-[#303133]">
        <Icon className={cn("size-3.5 shrink-0", tint)} strokeWidth={1.75} />
        <span className="truncate">{def?.label ?? node.type}</span>
      </div>

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

      <div className="absolute bottom-1.5 left-2.5 right-2.5 flex items-center justify-between font-mono text-[10px] text-[#c0c4cc]">
        <span className="uppercase tracking-wider">{def?.category}</span>
        <span className="truncate">{node.type}</span>
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
              onConnectMove={onConnectMove}
              onConnectEnd={onConnectEnd}
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
              onConnectMove={onConnectMove}
              onConnectEnd={onConnectEnd}
            />
          );
        })}
    </div>
  );
}
