// 画布 —— 节点 + 连线的容器
//
// 拖拽分层：
//   - 库 → 画布：LibraryPanel 自己用 mouse events
//   - 节点拖动：Canvas 用 mouse events（pan / node 拖动）
//   - 端口画连线：PortHandle 自己用 mouse events，调 props 回调通知 canvas
//
// 所有拖拽都用 mouse events 一致模式：onMouseDown 同步装 window listener。
// 这是因为 Playwright / 一些 WebView 的 pointer events 不可靠，统一用
// mouse events 跨环境最稳。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import * as Icons from "lucide-react";
import { AlertCircle, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAutodeployStore } from "../store";
import { NodeCard } from "./node-card";
import { ConnectionLine, PendingConnection } from "./connection-line";
import { portOffset } from "../lib/geometry";
import { BUILTIN_TEMPLATES } from "../lib/templates";
import { validateWorkflow } from "../lib/validate";
import type { NodeType } from "../types";
import { cn } from "@/lib/utils";

const NODE_W = 240;
const NODE_H = 96;

// 拖拽中的待确认连线。除了虚线两端的世界坐标，还携带起点端口信息：
// mouseup 时画布据此判断能否成线（不能同节点 / 不能同侧端口）。
interface PendingConn {
  fromNode: string;
  fromPort: number;
  fromSide: "input" | "output";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    kind: "pan" | "node";
    startScreenX: number;
    startScreenY: number;
    panOrigX?: number;
    panOrigY?: number;
    nodeId?: string;
    nodeOrigX?: number;
    nodeOrigY?: number;
  } | null>(null);

  const [pendingConn, setPendingConn] = useState<PendingConn | null>(null);
  // pendingConn 的同步镜像：window listener 内 mousemove / mouseup 必须
  // 立刻读到最新值（listener 闭包不依赖 React state 的异步刷新），所以同时
  // 维护一份 ref；render 期间同步写，listener 永远拿到最新。
  const pendingConnRef = useRef<PendingConn | null>(null);
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

  // API 镜像 ref：window listener 只装一次（useEffect 依赖 []），但 listener
  // 内部要调用的 setState / hitTestPort / addConnection / screenToWorld 每次
  // 渲染都换新引用。把它们集中存进 ref，listener 永远通过 ref 拿最新——
  // 既避免 useEffect 反复重装 listener 打断正在进行的拖拽，也避开"listener
  // 闭包过期"的经典坑。
  // 注：getScreenToWorld / getHitTestPort 字段在它们 useCallback 声明后
  // 才补（见 line 175 附近）。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null);
  apiRef.current = {
    ...apiRef.current,
    setViewport,
    moveNode,
    addConnection,
    setPendingConn,
    setHoverPort,
  };
  pendingConnRef.current = pendingConn;

  // 工作流完整性校验（与 top-toolbar 共用同一份逻辑）
  const validationErrors = useMemo(
    () => validateWorkflow(workflow, nodeTypes),
    [workflow, nodeTypes],
  );
  // banner 显示状态：纯 derived（useMemo）+ 单一 useState 存用户 dismiss
  // 时对应的 workflow 引用。**没有任何 useEffect 联动**，从根上消除
  // React #185 风险（之前的 `useEffect([workflow]) → setBannerDismissed`
  // 模式在 React 19 严格模式 + zustand useSyncExternalStore 下会循环）。
  // 用户点 X → setDismissedForWf(workflow) 记下当前引用；workflow 引用
  // 变化时 useMemo 自动重新判定 banner 是否该再次出现。
  const [dismissedForWf, setDismissedForWf] = useState<typeof workflow | null>(
    null,
  );
  const showBanner = useMemo(() => {
    if (validationErrors.length === 0) return false;
    if (dismissedForWf === workflow) return false;
    return true;
  }, [validationErrors, workflow, dismissedForWf]);
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

  const hitTestPort = useCallback(
    (
      sx: number,
      sy: number,
    ): { nodeId: string; port: number; side: "input" | "output" } | null => {
      const w = screenToWorld(sx, sy);
      // 命中半径按"屏幕像素"恒定：用 HIT_RADIUS_PX（屏幕像素）/ zoom
      // 转成世界单位作为半径，dx / dy 也保持世界单位，distSq 与 rSq 才是同单位。
      // 给世界半径设上限 32，防止缩得太小（<~62%）时一个落点命中多个端口。
      const HIT_RADIUS_PX = 20;
      const radWorld = Math.min(HIT_RADIUS_PX / viewport.zoom, 32);
      const rSq = radWorld * radWorld;
      for (let i = workflow.nodes.length - 1; i >= 0; i--) {
        const n = workflow.nodes[i];
        const def = nodeTypes.find((t) => t.id === n.type);
        if (!def) continue;
        for (let p = 0; p < def.inputs; p++) {
          const off = portOffset(p, def.inputs, "input", NODE_W, NODE_H);
          const dx = n.x + off.x - w.x;
          const dy = n.y + off.y - w.y;
          if (dx * dx + dy * dy < rSq) {
            return { nodeId: n.id, port: p, side: "input" };
          }
        }
        for (let p = 0; p < def.outputs; p++) {
          const off = portOffset(p, def.outputs, "output", NODE_W, NODE_H);
          const dx = n.x + off.x - w.x;
          const dy = n.y + off.y - w.y;
          if (dx * dx + dy * dy < rSq) {
            return { nodeId: n.id, port: p, side: "output" };
          }
        }
      }
      return null;
    },
    [workflow.nodes, nodeTypes, screenToWorld, viewport],
  );

  // 现在 screenToWorld / hitTestPort 已声明，把它们补进 apiRef（render 期
  // 间同步写，listener 永远拿最新值）。
  apiRef.current.getScreenToWorld = screenToWorld;
  apiRef.current.getHitTestPort = hitTestPort;

  // 工具：端口 → 世界坐标
  function getPortWorld(
    nodeId: string,
    portIndex: number,
    side: "input" | "output",
  ): { x: number; y: number } | null {
    const node = workflow.nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    const def = nodeTypes.find((t) => t.id === node.type);
    if (!def) return null;
    const total = side === "input" ? def.inputs : def.outputs;
    if (total === 0) return null;
    const off = portOffset(portIndex, total, side, NODE_W, NODE_H);
    return { x: node.x + off.x, y: node.y + off.y };
  }

  // ─────────────────────────────────────────────
  // 画布 / 节点 / 平移 / 画线 —— 一个统一的 window listener
  //
  // 之前每个拖动源（画布 pan / 节点 / port）各装一套 window listener，
  // 跨 listener 互踩导致"鼠标按下端口却拖动节点"、"port mousedown 进了
  // 但 onConnectMove 永不触发"等诡异失败。统一在这里：
  //   - mousedown 不在这里（mousedown 由各组件 React 合成事件响应）
  //   - mousemove：先看 pendingConnRef.current（画线中）→ 否则看 dragRef（pan / node 拖动）
  //   - mouseup：先看 pendingConnRef.current → 完成 addConnection 或清掉 → 否则 dragRef = null
  //   - keydown：Esc 取消画线
  // useEffect 依赖 []：listener 只装一次，所有 API 通过 apiRef / pendingConnRef
  // 拿最新，绝不重装打断拖拽。
  // ─────────────────────────────────────────────
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const api = apiRef.current;
      // 1) 画线中
      const pc = pendingConnRef.current;
      if (pc) {
        const w = api.getScreenToWorld(e.clientX, e.clientY);
        api.setPendingConn({ ...pc, x2: w.x, y2: w.y });
        api.setHoverPort(api.getHitTestPort(e.clientX, e.clientY));
        return;
      }
      // 2) pan / node 拖动
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === "pan") {
        const dx = e.clientX - drag.startScreenX;
        const dy = e.clientY - drag.startScreenY;
        api.setViewport({
          x: (drag.panOrigX ?? 0) + dx,
          y: (drag.panOrigY ?? 0) + dy,
        });
      } else if (drag.kind === "node" && drag.nodeId) {
        const w = api.getScreenToWorld(e.clientX, e.clientY);
        const startW = api.getScreenToWorld(
          drag.startScreenX,
          drag.startScreenY,
        );
        api.moveNode(
          drag.nodeId,
          (drag.nodeOrigX ?? 0) + (w.x - startW.x),
          (drag.nodeOrigY ?? 0) + (w.y - startW.y),
        );
      }
    }
    function onUp(e: MouseEvent) {
      const api = apiRef.current;
      // 1) 画线收尾
      const pc = pendingConnRef.current;
      if (pc) {
        const target = api.getHitTestPort(e.clientX, e.clientY);
        api.setPendingConn(null);
        api.setHoverPort(null);
        if (
          target &&
          target.nodeId !== pc.fromNode &&
          target.side !== pc.fromSide
        ) {
          const fromIsOutput = pc.fromSide === "output";
          api.addConnection(
            fromIsOutput ? pc.fromNode : target.nodeId,
            fromIsOutput ? pc.fromPort : target.port,
            fromIsOutput ? target.nodeId : pc.fromNode,
            fromIsOutput ? target.port : pc.fromPort,
          );
        }
        return;
      }
      // 2) pan / node 收尾
      dragRef.current = null;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && pendingConnRef.current) {
        pendingConnRef.current = null;
        apiRef.current.setPendingConn(null);
        apiRef.current.setHoverPort(null);
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // 画布本身 mousedown：pan / 取消选中
  const onCanvasMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        dragRef.current = {
          kind: "pan",
          startScreenX: e.clientX,
          startScreenY: e.clientY,
          panOrigX: viewport.x,
          panOrigY: viewport.y,
        };
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
  const onNodeMouseDown = useCallback(
    (
      e: ReactMouseEvent<HTMLDivElement>,
      nodeId: string,
      nodeX: number,
      nodeY: number,
    ) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      dragRef.current = {
        kind: "node",
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        nodeId,
        nodeOrigX: nodeX,
        nodeOrigY: nodeY,
      };
      selectNode(nodeId);
      e.preventDefault();
    },
    [selectNode],
  );

  // ─────────────────────────────────────────────
  // 端口画连线：start → canvas 用 window listener 接管 move/end
  //
  // port 这里只负责：mousedown 时把起点写进 state（pendingConn）。
  // 后续 mousemove / mouseup / Esc 全交给上面那个统一的 window listener，
  // 不在这里装自己的 listener —— 避免双轨并行时序竞态。
  //
  // 注意不要用空依赖 useCallback 包 onConnectStart —— 那会把闭包里的
  // workflow（节点坐标）冻结在组件首帧（首帧画布往往是空的），getPortWorld
  // 会永远返回 null，连线将完全无法开始。
  // ─────────────────────────────────────────────
  const onConnectStart = (
    info: { fromNode: string; fromPort: number; fromSide: "input" | "output" },
  ) => {
    const startW = getPortWorld(info.fromNode, info.fromPort, info.fromSide);
    if (!startW) return;
    const next: PendingConn = {
      fromNode: info.fromNode,
      fromPort: info.fromPort,
      fromSide: info.fromSide,
      x1: startW.x,
      y1: startW.y,
      x2: startW.x,
      y2: startW.y,
    };
    pendingConnRef.current = next;
    setPendingConn(next);
  };

  // 右键菜单
  const onContextMenu = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [],
  );

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

  const onAddNodeAtMenu = (type: string) => {
    if (!contextMenu) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const w = screenToWorld(contextMenu.x, contextMenu.y);
    addNode(type, w.x - NODE_W / 2, w.y - NODE_H / 2);
    setContextMenu(null);
  };
  const onApplyTemplateFromMenu = (id: string) => {
    if (
      workflow.nodes.length > 0 &&
      !window.confirm("加载模板会覆盖当前画布，继续？")
    ) {
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
      onMouseDown={onCanvasMouseDown}
      onContextMenu={onContextMenu}
      className="relative h-full w-full overflow-hidden bg-[#f5f7fa] select-none"
    >
      {/* 校验错误 banner：画布不合法时顶部红条，列出前若干条错误。
          关闭后只要 workflow 引用变化就重新显示。 */}
      {showBanner && (
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-30 flex justify-center px-3 pt-2">
          <div className="pointer-events-auto flex max-w-[640px] items-start gap-2 rounded-md border border-[#fbc4c4] bg-[#fef0f0] px-3 py-2 text-[12px] text-[#f56c6c] shadow-sm">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                工作流不完整（{validationErrors.length} 处问题）
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-[#c45656]">
                {validationErrors.slice(0, 4).map((e, i) => (
                  <li key={i} className="leading-relaxed">
                    {e.message}
                  </li>
                ))}
                {validationErrors.length > 4 && (
                  <li className="text-[#909399]">
                    还有 {validationErrors.length - 4} 处…
                  </li>
                )}
              </ul>
            </div>
            <button
              onClick={() => setDismissedForWf(workflow)}
              className="shrink-0 rounded p-0.5 text-[#c45656] transition-colors hover:bg-[#fde2e2]"
              title="关闭（下次画布变更会再次出现）"
            >
              <X className="size-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

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
            onMouseDown={(e) => onNodeMouseDown(e, n.id, n.x, n.y)}
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

// ─────────────────────────────────────────────
// ContextMenu（保持原样）
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
