// 画布 —— 节点 + 连线的容器
//
// 全部拖拽统一用 Pointer Events + window 级 listener：
//   - pan：拖空白平移（中键 / Shift+左键）
//   - node：拖节点移动
//   - connect：从端口拖出新连线
//   - library：从左侧库拖入新节点（由 LibraryPanel 触发，回调通过
//              props.onLibraryDragStart 注入）
//
// 关键修复：所有 move/up 在 window 上监听，配合 setPointerCapture，
// 即便鼠标移出画布 / 跨 DOM 元素，拖拽也不会丢。HTML5 DragEvent 在
// Tauri WebView 里支持不稳定，弃用。

import { useCallback, useEffect, useRef, useState } from "react";
import { useAutodeployStore } from "../store";
import { NodeCard } from "./node-card";
import { ConnectionLine, PendingConnection } from "./connection-line";
import { portOffset } from "../lib/geometry";

const NODE_W = 240;
const NODE_H = 96;

type DragKind = "pan" | "node" | "connect" | "library";

export interface DragState {
  kind: DragKind;
  pointerId: number;
  startScreenX: number;
  startScreenY: number;
  // pan
  panOrigX?: number;
  panOrigY?: number;
  // node
  nodeId?: string;
  nodeOrigX?: number;
  nodeOrigY?: number;
  // connect
  fromNode?: string;
  fromPort?: number;
  fromSide?: "input" | "output";
  // library
  libType?: string;
  // 当前 hover 的端口（连线和库拖拽都用）
  hoverNodeId?: string;
  hoverPort?: number;
  hoverPortSide?: "input" | "output";
  cursorScreenX: number;
  cursorScreenY: number;
}

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [pendingConn, setPendingConn] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const [hoverPort, setHoverPort] = useState<{
    nodeId: string;
    port: number;
    side: "input" | "output";
  } | null>(null);

  const workflow = useAutodeployStore((s) => s.workflow);
  const viewport = useAutodeployStore((s) => s.viewport);
  const selectedNodeId = useAutodeployStore((s) => s.selectedNodeId);
  const nodeTypes = useAutodeployStore((s) => s.nodeTypes);
  const setViewport = useAutodeployStore((s) => s.setViewport);
  const moveNode = useAutodeployStore((s) => s.moveNode);
  const selectNode = useAutodeployStore((s) => s.selectNode);
  const addConnection = useAutodeployStore((s) => s.addConnection);

  // 屏幕坐标 → 画布世界坐标
  const screenToWorld = useCallback(
    (sx: number, sy: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (sx - rect.left - viewport.x) / viewport.zoom,
        y: (sy - rect.top - viewport.y) / viewport.zoom,
      };
    },
    [viewport],
  );

  // 命中测试：端口
  const hitTestPort = useCallback(
    (
      sx: number,
      sy: number,
    ): { nodeId: string; port: number; side: "input" | "output" } | null => {
      const w = screenToWorld(sx, sy);
      const RADIUS_SQ = 16 * 16;
      for (let i = workflow.nodes.length - 1; i >= 0; i--) {
        const n = workflow.nodes[i];
        const def = nodeTypes.find((t) => t.id === n.type);
        if (!def) continue;
        for (let p = 0; p < def.inputs; p++) {
          const off = portOffset(p, def.inputs, "input", NODE_W, NODE_H);
          const dx = n.x + off.x - w.x;
          const dy = n.y + off.y - w.y;
          if (dx * dx + dy * dy < RADIUS_SQ) {
            return { nodeId: n.id, port: p, side: "input" };
          }
        }
        for (let p = 0; p < def.outputs; p++) {
          const off = portOffset(p, def.outputs, "output", NODE_W, NODE_H);
          const dx = n.x + off.x - w.x;
          const dy = n.y + off.y - w.y;
          if (dx * dx + dy * dy < RADIUS_SQ) {
            return { nodeId: n.id, port: p, side: "output" };
          }
        }
      }
      return null;
    },
    [workflow.nodes, nodeTypes, screenToWorld],
  );

  // ─────────────────────────────────────────────
  // 全局 pointer 监听（pan / node / connect）
  // ─────────────────────────────────────────────
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      drag.cursorScreenX = e.clientX;
      drag.cursorScreenY = e.clientY;

      if (drag.kind === "pan") {
        const dx = e.clientX - drag.startScreenX;
        const dy = e.clientY - drag.startScreenY;
        setViewport({
          x: (drag.panOrigX ?? 0) + dx,
          y: (drag.panOrigY ?? 0) + dy,
        });
      } else if (drag.kind === "node" && drag.nodeId) {
        const w = screenToWorld(e.clientX, e.clientY);
        const startW = screenToWorld(drag.startScreenX, drag.startScreenY);
        const nx = (drag.nodeOrigX ?? 0) + (w.x - startW.x);
        const ny = (drag.nodeOrigY ?? 0) + (w.y - startW.y);
        moveNode(drag.nodeId, nx, ny);
      } else if (drag.kind === "connect") {
        const w = screenToWorld(e.clientX, e.clientY);
        const startW = getPortWorld(
          drag.fromNode!,
          drag.fromPort!,
          drag.fromSide!,
        );
        if (!startW) return;
        setPendingConn({ x1: startW.x, y1: startW.y, x2: w.x, y2: w.y });
        const target = hitTestPort(e.clientX, e.clientY);
        if (
          target &&
          target.nodeId !== drag.fromNode &&
          target.side !== drag.fromSide
        ) {
          if (
            drag.hoverNodeId !== target.nodeId ||
            drag.hoverPort !== target.port ||
            drag.hoverPortSide !== target.side
          ) {
            drag.hoverNodeId = target.nodeId;
            drag.hoverPort = target.port;
            drag.hoverPortSide = target.side;
            setHoverPort(target);
          }
        } else if (drag.hoverNodeId) {
          drag.hoverNodeId = undefined;
          drag.hoverPort = undefined;
          drag.hoverPortSide = undefined;
          setHoverPort(null);
        }
      }
    }

    function onUp(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      if (drag.kind === "connect" && drag.fromNode) {
        const target = hitTestPort(e.clientX, e.clientY);
        if (
          target &&
          target.nodeId !== drag.fromNode &&
          target.side !== drag.fromSide
        ) {
          const fromIsOutput = drag.fromSide === "output";
          addConnection(
            fromIsOutput ? drag.fromNode : target.nodeId,
            fromIsOutput ? drag.fromPort! : target.port,
            fromIsOutput ? target.nodeId : drag.fromNode,
            fromIsOutput ? target.port : drag.fromPort!,
          );
        }
      }
      setPendingConn(null);
      setHoverPort(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [viewport, screenToWorld, hitTestPort, setViewport, moveNode, addConnection]);

  // 画布本身 pointerdown —— 启动 pan / 取消选中
  const onCanvasPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        dragRef.current = {
          kind: "pan",
          pointerId: e.pointerId,
          startScreenX: e.clientX,
          startScreenY: e.clientY,
          panOrigX: viewport.x,
          panOrigY: viewport.y,
          cursorScreenX: e.clientX,
          cursorScreenY: e.clientY,
        };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
      } else if (e.button === 0) {
        selectNode(null);
      }
    },
    [viewport, selectNode],
  );

  // 滚轮缩放
  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const delta = -e.deltaY * 0.0015;
      const newZoom = Math.min(2, Math.max(0.4, viewport.zoom * (1 + delta)));
      const worldX = (cx - viewport.x) / viewport.zoom;
      const worldY = (cy - viewport.y) / viewport.zoom;
      setViewport({
        zoom: newZoom,
        x: cx - worldX * newZoom,
        y: cy - worldY * newZoom,
      });
    },
    [viewport, setViewport],
  );

  // 给 NodeCard 用：开始拖节点
  const onNodePointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      nodeId: string,
      nodeX: number,
      nodeY: number,
    ) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      dragRef.current = {
        kind: "node",
        pointerId: e.pointerId,
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        nodeId,
        nodeOrigX: nodeX,
        nodeOrigY: nodeY,
        cursorScreenX: e.clientX,
        cursorScreenY: e.clientY,
      };
      const container = containerRef.current;
      if (container) container.setPointerCapture(e.pointerId);
      selectNode(nodeId);
      e.preventDefault();
    },
    [selectNode],
  );

  // 给 NodeCard 用：开始画连线
  const onPortPointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      nodeId: string,
      portIndex: number,
      side: "input" | "output",
    ) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const p = getPortWorld(nodeId, portIndex, side);
      if (!p) return;
      dragRef.current = {
        kind: "connect",
        pointerId: e.pointerId,
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        fromNode: nodeId,
        fromPort: portIndex,
        fromSide: side,
        cursorScreenX: e.clientX,
        cursorScreenY: e.clientY,
      };
      setPendingConn({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      const container = containerRef.current;
      if (container) container.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      onWheel={onWheel}
      onPointerDown={onCanvasPointerDown}
      className="relative h-full w-full overflow-hidden bg-[#f5f7fa] select-none"
    >
      {/* dot grid */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, #c0c4cc 1px, transparent 1.5px)",
          backgroundSize: `${28 * viewport.zoom}px ${28 * viewport.zoom}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
          opacity: 0.55,
        }}
      />

      {/* 世界层 */}
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        }}
      >
        {/* SVG 层 */}
        <svg
          className="pointer-events-none absolute overflow-visible"
          style={{
            left: -10000,
            top: -10000,
            width: 20000,
            height: 20000,
          }}
        >
          {workflow.connections.map((c) => (
            <ConnectionLine
              key={c.id}
              conn={c}
              width={NODE_W}
              height={NODE_H}
            />
          ))}
          {pendingConn && (
            <PendingConnection
              x1={pendingConn.x1}
              y1={pendingConn.y1}
              x2={pendingConn.x2}
              y2={pendingConn.y2}
            />
          )}
        </svg>

        {/* 节点层 */}
        {workflow.nodes.map((n) => (
          <NodeCard
            key={n.id}
            node={n}
            selected={n.id === selectedNodeId}
            onPointerDown={(e) => onNodePointerDown(e, n.id, n.x, n.y)}
            onPortPointerDown={onPortPointerDown}
            width={NODE_W}
            height={NODE_H}
            hoveredPort={
              hoverPort && hoverPort.nodeId === n.id
                ? { port: hoverPort.port, side: hoverPort.side }
                : null
            }
          />
        ))}
      </div>

      {/* 视口信息 */}
      <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-white/80 px-2 py-0.5 font-mono text-[10px] text-[#909399] shadow-sm">
        zoom {Math.round(viewport.zoom * 100)}% · {workflow.nodes.length} 节点 · {workflow.connections.length} 连线
      </div>

      {/* 空状态 */}
      {workflow.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-md border border-dashed border-[#dcdfe6] bg-white/60 px-8 py-5 text-center">
            <div className="text-[14px] font-medium text-[#606266]">
              空白画布
            </div>
            <div className="mt-1.5 text-[12px] text-[#909399]">
              从左侧节点库拖拽到此处，或点击工具条「模板」加载示例
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 工具：端口 → 世界坐标
function getPortWorld(
  nodeId: string,
  portIndex: number,
  side: "input" | "output",
): { x: number; y: number } | null {
  const state = useAutodeployStore.getState();
  const node = state.workflow.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const def = state.nodeTypes.find((t) => t.id === node.type);
  if (!def) return null;
  const total = side === "input" ? def.inputs : def.outputs;
  if (total === 0) return null;
  const off = portOffset(portIndex, total, side, NODE_W, NODE_H);
  return { x: node.x + off.x, y: node.y + off.y };
}
