// 画布 —— 节点 + 连线的容器
//
// 拖拽分层：
//   - 平移 / 拖节点：Canvas 自己处理（onPointerDown + window listener）
//   - 拖端口画连线：PortHandle 自包含（node-card 内部，事件发到 window）
//
// 右键菜单：禁用默认 context menu，渲染自绘 ContextMenu（节点 / 模板 /
// 缩放 / 清空）。

import { useCallback, useEffect, useRef, useState } from "react";
import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAutodeployStore } from "../store";
import { NodeCard } from "./node-card";
import { ConnectionLine, PendingConnection } from "./connection-line";
import { portOffset } from "../lib/geometry";
import { BUILTIN_TEMPLATES } from "../lib/templates";
import type { NodeType } from "../types";
import { cn } from "@/lib/utils";

const NODE_W = 240;
const NODE_H = 96;

// 端口事件 payload
interface PortMoveDetail {
  fromNode: string;
  fromPort: number;
  fromSide: "input" | "output";
  screenX: number;
  screenY: number;
}

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    kind: "pan" | "node";
    pointerId: number;
    startScreenX: number;
    startScreenY: number;
    panOrigX?: number;
    panOrigY?: number;
    nodeId?: string;
    nodeOrigX?: number;
    nodeOrigY?: number;
  } | null>(null);

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
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
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
  const applyTemplate = useAutodeployStore((s) => s.applyTemplate);
  const resetWorkflow = useAutodeployStore((s) => s.resetWorkflow);

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

  // 端口命中测试（屏幕 → 端口）
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
  // 全局 window listener —— pan / node 拖拽
  // ─────────────────────────────────────────────
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
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
        moveNode(
          drag.nodeId,
          (drag.nodeOrigX ?? 0) + (w.x - startW.x),
          (drag.nodeOrigY ?? 0) + (w.y - startW.y),
        );
      }
    }
    function onUp(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [screenToWorld, setViewport, moveNode]);

  // ─────────────────────────────────────────────
  // 端口事件（PortHandle 通过 window CustomEvent 通知）
  // ─────────────────────────────────────────────
  useEffect(() => {
    function onPortMove(e: Event) {
      const detail = (e as CustomEvent<PortMoveDetail>).detail;
      const startW = getPortWorld(detail.fromNode, detail.fromPort, detail.fromSide);
      if (!startW) return;
      const w = screenToWorld(detail.screenX, detail.screenY);
      setPendingConn({ x1: startW.x, y1: startW.y, x2: w.x, y2: w.y });
      const target = hitTestPort(detail.screenX, detail.screenY);
      if (
        target &&
        target.nodeId !== detail.fromNode &&
        target.side !== detail.fromSide
      ) {
        setHoverPort(target);
      } else {
        setHoverPort(null);
      }
    }
    function onPortUp(e: Event) {
      const detail = (e as CustomEvent<PortMoveDetail>).detail;
      const target = hitTestPort(detail.screenX, detail.screenY);
      if (
        target &&
        target.nodeId !== detail.fromNode &&
        target.side !== detail.fromSide
      ) {
        const fromIsOutput = detail.fromSide === "output";
        addConnection(
          fromIsOutput ? detail.fromNode : target.nodeId,
          fromIsOutput ? detail.fromPort : target.port,
          fromIsOutput ? target.nodeId : detail.fromNode,
          fromIsOutput ? target.port : detail.fromPort,
        );
      }
      setPendingConn(null);
      setHoverPort(null);
    }

    window.addEventListener("autodeploy:port-move", onPortMove);
    window.addEventListener("autodeploy:port-up", onPortUp);
    return () => {
      window.removeEventListener("autodeploy:port-move", onPortMove);
      window.removeEventListener("autodeploy:port-up", onPortUp);
    };
  }, [hitTestPort, screenToWorld, addConnection]);

  // 画布本身 pointerdown
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
        };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
      } else if (e.button === 0) {
        selectNode(null);
        setContextMenu(null);
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

  // 拖节点
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
      };
      const container = containerRef.current;
      if (container) container.setPointerCapture(e.pointerId);
      selectNode(nodeId);
      e.preventDefault();
    },
    [selectNode],
  );

  // 端口开始画连线（被 PortHandle.onConnectStart 调用）
  const onConnectStart = useCallback(
    (info: {
      fromNode: string;
      fromPort: number;
      fromSide: "input" | "output";
    }) => {
      const startW = getPortWorld(info.fromNode, info.fromPort, info.fromSide);
      if (!startW) return;
      setPendingConn({ x1: startW.x, y1: startW.y, x2: startW.x, y2: startW.y });
    },
    [],
  );

  // 右键菜单
  const onContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const x = e.clientX;
    const y = e.clientY;
    setContextMenu({ x, y });
  }, []);

  // 右键菜单点外面关闭
  useEffect(() => {
    if (!contextMenu) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-context-menu]")) {
        setContextMenu(null);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [contextMenu]);

  // 右键菜单动作
  const onAddNodeAtMenu = (type: string) => {
    if (!contextMenu) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const w = screenToWorld(contextMenu.x, contextMenu.y);
    addNode(type, w.x - NODE_W / 2, w.y - NODE_H / 2);
    setContextMenu(null);
  };
  const onApplyTemplateFromMenu = (id: string) => {
    if (workflow.nodes.length > 0 && !window.confirm("加载模板会覆盖当前画布，继续？")) {
      setContextMenu(null);
      return;
    }
    applyTemplate(id);
    setContextMenu(null);
  };
  const onClearFromMenu = () => {
    if (workflow.nodes.length === 0) return;
    if (window.confirm("清空当前画布？")) resetWorkflow();
    setContextMenu(null);
  };
  const onZoomTo = (z: number) => {
    setViewport({ zoom: z, x: 0, y: 0 });
    setContextMenu(null);
  };

  return (
    <div
      ref={containerRef}
      onWheel={onWheel}
      onPointerDown={onCanvasPointerDown}
      onContextMenu={onContextMenu}
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

        {workflow.nodes.map((n) => (
          <NodeCard
            key={n.id}
            node={n}
            selected={n.id === selectedNodeId}
            onPointerDown={(e) => onNodePointerDown(e, n.id, n.x, n.y)}
            onConnectStart={onConnectStart}
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
            <div className="text-[14px] font-medium text-[#606266]">空白画布</div>
            <div className="mt-1.5 text-[12px] text-[#909399]">
              从左侧节点库拖拽，或在画布上右键新建
            </div>
          </div>
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeTypes={nodeTypes}
          hasNodes={workflow.nodes.length > 0}
          onAddNode={onAddNodeAtMenu}
          onApplyTemplate={onApplyTemplateFromMenu}
          onClear={onClearFromMenu}
          onZoomTo={onZoomTo}
        />
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

// ─────────────────────────────────────────────
// ContextMenu
// ─────────────────────────────────────────────
interface ContextMenuProps {
  x: number;
  y: number;
  nodeTypes: NodeType[];
  hasNodes: boolean;
  onAddNode: (type: string) => void;
  onApplyTemplate: (id: string) => void;
  onClear: () => void;
  onZoomTo: (z: number) => void;
}

function ContextMenu({
  x,
  y,
  nodeTypes,
  hasNodes,
  onAddNode,
  onApplyTemplate,
  onClear,
  onZoomTo,
}: ContextMenuProps) {
  // 避免溢出屏幕
  const MENU_W = 220;
  const MENU_MAX_H = 400;
  const adjustedX = Math.min(x, window.innerWidth - MENU_W - 8);
  const adjustedY = Math.min(y, window.innerHeight - MENU_MAX_H - 8);

  const byCategory = (() => {
    const map: Record<string, NodeType[]> = { source: [], process: [], transfer: [] };
    for (const t of nodeTypes) map[t.category].push(t);
    return map;
  })();

  return (
    <div
      data-context-menu
      className="fixed z-50 w-[220px] overflow-hidden rounded-md border border-[#dcdfe6] bg-white shadow-lg"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {/* 新建节点 */}
      <MenuLabel>新建节点</MenuLabel>
      {(Object.keys(byCategory) as Array<"source" | "process" | "transfer">).map(
        (cat) => {
          if (byCategory[cat].length === 0) return null;
          const label =
            cat === "source"
              ? "SOURCES"
              : cat === "process"
                ? "PROCESS"
                : "TRANSFER";
          return (
            <div key={cat}>
              <SubLabel>{label}</SubLabel>
              {byCategory[cat].map((t) => {
                const Icon =
                  (Icons as unknown as Record<string, LucideIcon>)[t.icon] ||
                  Icons.Circle;
                return (
                  <MenuItem
                    key={t.id}
                    icon={Icon}
                    label={t.label}
                    onClick={() => onAddNode(t.id)}
                  />
                );
              })}
            </div>
          );
        },
      )}

      <Divider />

      <MenuLabel>模板</MenuLabel>
      {BUILTIN_TEMPLATES.map((t) => (
        <MenuItem
          key={t.id}
          icon={Icons.FilePlus2}
          label={t.name}
          onClick={() => onApplyTemplate(t.id)}
        />
      ))}

      <Divider />

      <MenuLabel>视图</MenuLabel>
      <MenuItem
        icon={Icons.ZoomIn}
        label="放大 (125%)"
        onClick={() => onZoomTo(1.25)}
      />
      <MenuItem
        icon={Icons.ZoomIn}
        label="缩放至 100%"
        onClick={() => onZoomTo(1)}
      />
      <MenuItem
        icon={Icons.ZoomOut}
        label="缩小 (75%)"
        onClick={() => onZoomTo(0.75)}
      />
      <MenuItem
        icon={Icons.Maximize2}
        label="缩放至 50%"
        onClick={() => onZoomTo(0.5)}
      />

      <Divider />

      <MenuItem
        icon={Icons.Trash2}
        label="清空画布"
        danger
        disabled={!hasNodes}
        onClick={onClear}
      />
    </div>
  );
}

function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-[#ebeef5] bg-[#f5f7fa] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#909399]">
      {children}
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#c0c4cc]">
      {children}
    </div>
  );
}

interface MenuItemProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

function MenuItem({ icon: Icon, label, onClick, danger, disabled }: MenuItemProps) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors",
        danger
          ? "text-[#f56c6c] hover:bg-[#fef0f0]"
          : "text-[#303133] hover:bg-[#ecf5ff] hover:text-[#409eff]",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

function Divider() {
  return <div className="h-px bg-[#ebeef5]" />;
}
