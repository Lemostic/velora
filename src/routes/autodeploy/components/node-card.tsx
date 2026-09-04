// 节点卡 —— 画布上的单个节点
//
// 视觉：Element Plus 风格
//   - 240×96 矩形，bg-white border-[#dcdfe6] rounded-md
//   - 左侧 3px 分类色条（source=绿 / process=蓝 / transfer=橙）
//   - 顶部：图标 + 标题
//   - 中部：第一条非空参数摘要
//   - 底部：类型标识（category · type id）
//   - 右上角：状态点
//   - 选中：ring-2 ring-primary
//   - 端口：自包含 PortHandle 子组件，setPointerCapture 到自身

import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
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
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  /** 开始画连线（port 自身 pointer down） */
  onConnectStart: (info: {
    fromNode: string;
    fromPort: number;
    fromSide: "input" | "output";
    pointerId: number;
    startX: number;
    startY: number;
  }) => void;
  hoveredPort?: { port: number; side: "input" | "output" } | null;
}

// ─────────────────────────────────────────────
// PortHandle —— 端口（自包含拖拽）
// ─────────────────────────────────────────────
interface PortProps {
  nodeId: string;
  portIndex: number;
  side: "input" | "output";
  x: number; // 节点内坐标（0 或 width）
  y: number;
  isHovered: boolean;
  onConnectStart: Props["onConnectStart"];
}

function PortHandle({ nodeId, portIndex, side, x, y, isHovered, onConnectStart }: PortProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dragInfoRef = useRef<{
    fromNode: string;
    fromPort: number;
    fromSide: "input" | "output";
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);

  // 自包含 pointermove / pointerup 监听 —— 绑到 port 自身
  // setPointerCapture(pointerId) 后 move/up 都会路由到 port，不管鼠标
  // 在 DOM 树哪个位置。比依赖 window 冒泡更可靠，跨 WebView 一致。
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let isActive = false;

    function onMove(e: PointerEvent) {
      if (
        !isActive ||
        !dragInfoRef.current ||
        e.pointerId !== dragInfoRef.current.pointerId
      )
        return;
      // 由画布层负责更新 pendingConn（需要访问画布状态）
      window.dispatchEvent(
        new CustomEvent("autodeploy:port-move", {
          detail: {
            fromNode: dragInfoRef.current!.fromNode,
            fromPort: dragInfoRef.current!.fromPort,
            fromSide: dragInfoRef.current!.fromSide,
            screenX: e.clientX,
            screenY: e.clientY,
          },
        }),
      );
    }

    function onUp(e: PointerEvent) {
      if (
        !isActive ||
        !dragInfoRef.current ||
        e.pointerId !== dragInfoRef.current.pointerId
      )
        return;
      window.dispatchEvent(
        new CustomEvent("autodeploy:port-up", {
          detail: {
            fromNode: dragInfoRef.current!.fromNode,
            fromPort: dragInfoRef.current!.fromPort,
            fromSide: dragInfoRef.current!.fromSide,
            screenX: e.clientX,
            screenY: e.clientY,
          },
        }),
      );
      try {
        el?.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      dragInfoRef.current = null;
      isActive = false;
    }

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, []);

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        // 关键：setPointerCapture 到 port 自身，move/up 都路由到它
        ref.current?.setPointerCapture(e.pointerId);
        dragInfoRef.current = {
          fromNode: nodeId,
          fromPort: portIndex,
          fromSide: side,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
        };
        onConnectStart({
          fromNode: nodeId,
          fromPort: portIndex,
          fromSide: side,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
        });
      }}
      className={cn(
        "absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-white transition-all",
        "size-2.5 bg-[#c0c4cc] hover:scale-[1.6] hover:border-[#409eff] hover:bg-[#409eff]",
        isHovered &&
          "scale-[1.8] border-[#409eff] bg-[#409eff] shadow-[0_0_0_4px_rgba(64,158,255,0.18)]",
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
  onPointerDown,
  onConnectStart,
  hoveredPort,
}: Props) {
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
