// 画布 —— 节点 + 连线的容器
//
// 职责：
//   - 渲染 dot grid 背景
//   - 处理画布平移（鼠标中键 / Shift+拖空白）
//   - 处理缩放（Ctrl+滚轮 / 触控板捏合）
//   - 渲染所有节点和连线
//   - 处理节点拖拽、端口连线拖拽
//   - 处理空白处点击取消选中
//
// 坐标：所有节点 / 连线用世界坐标，CSS transform 把世界坐标投到屏幕。

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { useAutodeployStore } from "../store";
import { NodeCard } from "./node-card";
import { ConnectionLine, PendingConnection } from "./connection-line";
import { portOffset } from "../lib/geometry";
import type { NodeType } from "../types";

const NODE_W = 220;
const NODE_H = 88;

interface DragState {
  kind: "pan" | "node" | "connect";
  startX: number;
  startY: number;
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
  cursorX?: number;
  cursorY?: number;
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

  const workflow = useAutodeployStore((s) => s.workflow);
  const viewport = useAutodeployStore((s) => s.viewport);
  const selectedNodeId = useAutodeployStore((s) => s.selectedNodeId);
  const nodeTypes = useAutodeployStore((s) => s.nodeTypes);
  const setViewport = useAutodeployStore((s) => s.setViewport);
  const moveNode = useAutodeployStore((s) => s.moveNode);
  const selectNode = useAutodeployStore((s) => s.selectNode);
  const addConnection = useAutodeployStore((s) => s.addConnection);
  const addNode = useAutodeployStore((s) => s.addNode);

  // 计算连线端点（世界坐标）
  const getPortWorld = useCallback(
    (
      nodeId: string,
      side: "input" | "output",
      portIndex: number,
    ): { x: number; y: number } | null => {
      const node = workflow.nodes.find((n) => n.id === nodeId);
      if (!node) return null;
      const def = nodeTypes.find((t: NodeType) => t.id === node.type);
      const total = side === "input" ? def?.inputs ?? 0 : def?.outputs ?? 0;
      if (total === 0) return null;
      const off = portOffset(portIndex, total, side, NODE_W, NODE_H);
      return { x: node.x + off.x, y: node.y + off.y };
    },
    [workflow.nodes, nodeTypes],
  );

  // 滚轮缩放 / 拖空白平移
  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const delta = -e.deltaY * 0.0015;
      const newZoom = Math.min(2, Math.max(0.4, viewport.zoom * (1 + delta)));
      // 缩放时保持鼠标下的世界点不动
      const worldX = (cx - viewport.x) / viewport.zoom;
      const worldY = (cy - viewport.y) / viewport.zoom;
      const newX = cx - worldX * newZoom;
      const newY = cy - worldY * newZoom;
      setViewport({ zoom: newZoom, x: newX, y: newY });
    },
    [viewport, setViewport],
  );

  // 画布平移
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // 只响应中键 / Shift+左键
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        dragRef.current = {
          kind: "pan",
          startX: e.clientX,
          startY: e.clientY,
          panOrigX: viewport.x,
          panOrigY: viewport.y,
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
      } else if (e.button === 0) {
        // 空白处点击 → 取消选中
        selectNode(null);
      }
    },
    [viewport, selectNode],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === "pan") {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        setViewport({
          x: (drag.panOrigX ?? 0) + dx,
          y: (drag.panOrigY ?? 0) + dy,
        });
      } else if (drag.kind === "node" && drag.nodeId) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const wx =
          (e.clientX - rect.left - viewport.x) / viewport.zoom;
        const wy =
          (e.clientY - rect.top - viewport.y) / viewport.zoom;
        const nx = (drag.nodeOrigX ?? 0) + (wx - drag.startX);
        const ny = (drag.nodeOrigY ?? 0) + (wy - drag.startY);
        moveNode(drag.nodeId, nx, ny);
      } else if (drag.kind === "connect") {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const wx = (e.clientX - rect.left - viewport.x) / viewport.zoom;
        const wy = (e.clientY - rect.top - viewport.y) / viewport.zoom;
        setPendingConn({ x1: drag.startX, y1: drag.startY, x2: wx, y2: wy });
        drag.cursorX = wx;
        drag.cursorY = wy;
      }
    },
    [viewport, setViewport, moveNode],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      if (drag?.kind === "connect" && drag.fromNode) {
        // 命中检测：找鼠标位置下的节点 + 端口
        const target = hitTestPort(
          drag.cursorX ?? 0,
          drag.cursorY ?? 0,
          workflow.nodes,
          nodeTypes,
        );
        if (target) {
          const fromIsOutput = drag.fromSide === "output";
          addConnection(
            fromIsOutput ? drag.fromNode : target.nodeId,
            fromIsOutput ? drag.fromPort! : target.portIndex,
            fromIsOutput ? target.nodeId : drag.fromNode,
            fromIsOutput ? target.portIndex : drag.fromPort!,
          );
        }
      }
      setPendingConn(null);
    },
    [workflow.nodes, nodeTypes, addConnection],
  );

  // 节点拖拽
  const onNodePointerDown = useCallback(
    (
      e: ReactPointerEvent<HTMLDivElement>,
      nodeId: string,
      nodeX: number,
      nodeY: number,
    ) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const wx = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const wy = (e.clientY - rect.top - viewport.y) / viewport.zoom;
      dragRef.current = {
        kind: "node",
        startX: wx,
        startY: wy,
        nodeId,
        nodeOrigX: nodeX,
        nodeOrigY: nodeY,
      };
      selectNode(nodeId);
    },
    [viewport, selectNode],
  );

  // 端口开始连线
  const onPortPointerDown = useCallback(
    (
      e: ReactPointerEvent<HTMLDivElement>,
      nodeId: string,
      portIndex: number,
      side: "input" | "output",
    ) => {
      e.stopPropagation();
      const p = getPortWorld(nodeId, side, portIndex);
      if (!p) return;
      dragRef.current = {
        kind: "connect",
        startX: p.x,
        startY: p.y,
        fromNode: nodeId,
        fromPort: portIndex,
        fromSide: side,
        cursorX: p.x,
        cursorY: p.y,
      };
      setPendingConn({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    },
    [getPortWorld],
  );

  // 拖入节点：dragover 必须 preventDefault 才能触发 drop
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer?.getData("application/autodeploy-node-type");
      if (!type) return;
      const rect = el.getBoundingClientRect();
      const wx = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const wy = (e.clientY - rect.top - viewport.y) / viewport.zoom;
      addNode(type, wx - NODE_W / 2, wy - NODE_H / 2);
    };
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("drop", onDrop);
    };
  }, [viewport, addNode]);

  // 渲染
  return (
    <div
      ref={containerRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="relative h-full w-full overflow-hidden bg-[var(--bg-page)]"
      style={{
        cursor: dragRef.current?.kind === "pan" ? "grabbing" : "default",
      }}
    >
      {/* dot grid — 跟随视口移动 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--border) 1px, transparent 1px)",
          backgroundSize: `${20 * viewport.zoom}px ${20 * viewport.zoom}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
          opacity: 0.5,
        }}
      />

      {/* 节点 + 连线的世界层 */}
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        }}
      >
        {/* SVG 层放连线 */}
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
            <ConnectionLine key={c.id} conn={c} />
          ))}
          {pendingConn && (
            <PendingConnection x1={pendingConn.x1} y1={pendingConn.y1} x2={pendingConn.x2} y2={pendingConn.y2} />
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
          />
        ))}
      </div>

      {/* 视口信息（右下角小水印） */}
      <div className="pointer-events-none absolute bottom-2 right-3 text-[10px] font-mono text-muted-foreground/60">
        zoom {Math.round(viewport.zoom * 100)}% · {workflow.nodes.length} nodes · {workflow.connections.length} links
      </div>
    </div>
  );
}

// 命中测试：找点附近的端口
function hitTestPort(
  wx: number,
  wy: number,
  nodes: import("../types").CanvasNode[],
  types: NodeType[],
): { nodeId: string; portIndex: number; side: "input" | "output" } | null {
  // 距离阈值（世界坐标 12px）
  for (const n of nodes) {
    const def = types.find((t) => t.id === n.type);
    if (!def) continue;
    for (let i = 0; i < def.inputs; i++) {
      const p = portOffset(i, def.inputs, "input", NODE_W, NODE_H);
      const dx = n.x + p.x - wx;
      const dy = n.y + p.y - wy;
      if (dx * dx + dy * dy < 14 * 14) {
        return { nodeId: n.id, portIndex: i, side: "input" };
      }
    }
    for (let i = 0; i < def.outputs; i++) {
      const p = portOffset(i, def.outputs, "output", NODE_W, NODE_H);
      const dx = n.x + p.x - wx;
      const dy = n.y + p.y - wy;
      if (dx * dx + dy * dy < 14 * 14) {
        return { nodeId: n.id, portIndex: i, side: "output" };
      }
    }
  }
  return null;
}
