// 连线 SVG —— 在画布上画节点之间的贝塞尔曲线

import { useState } from "react";
import { useAutodeployStore } from "../store";
import { bezierPath, portOffset } from "../lib/geometry";
import type { Connection } from "../types";

const NODE_W = 220;
const NODE_H = 88;

interface LineProps {
  conn: Connection;
}

export function ConnectionLine({ conn }: LineProps) {
  const workflow = useAutodeployStore((s) => s.workflow);
  const nodeTypes = useAutodeployStore((s) => s.nodeTypes);
  const removeConnection = useAutodeployStore((s) => s.removeConnection);
  const [hover, setHover] = useState(false);

  const from = workflow.nodes.find((n) => n.id === conn.fromNode);
  const to = workflow.nodes.find((n) => n.id === conn.toNode);
  if (!from || !to) return null;

  const fromDef = nodeTypes.find((t) => t.id === from.type);
  const toDef = nodeTypes.find((t) => t.id === to.type);
  if (!fromDef || !toDef) return null;

  const p1 = portOffset(conn.fromPort, fromDef.outputs, "output", NODE_W, NODE_H);
  const p2 = portOffset(conn.toPort, toDef.inputs, "input", NODE_W, NODE_H);
  const x1 = from.x + p1.x;
  const y1 = from.y + p1.y;
  const x2 = to.x + p2.x;
  const y2 = to.y + p2.y;

  // success/error 状态变色
  let stroke = "#409eff";
  if (from.status === "success") stroke = "#67c23a";
  else if (from.status === "error") stroke = "#f56c6c";
  else if (from.status === "running") stroke = "#e6a23c";

  const d = bezierPath(x1, y1, x2, y2);
  const dWide = bezierPath(x1, y1, x2, y2);

  return (
    <g
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{ pointerEvents: "all" }}
    >
      {/* 透明粗线，吸收鼠标事件方便 hover/click */}
      <path
        d={dWide}
        stroke="transparent"
        strokeWidth={14}
        fill="none"
        style={{ cursor: "pointer", pointerEvents: "stroke" }}
        onClick={(e) => {
          e.stopPropagation();
          if (window.confirm("删除这条连线？")) removeConnection(conn.id);
        }}
      />
      <path
        d={d}
        stroke={stroke}
        strokeWidth={hover ? 2.4 : 1.6}
        fill="none"
        style={{ transition: "stroke-width 120ms ease" }}
      />
    </g>
  );
}

interface PendingProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function PendingConnection({ x1, y1, x2, y2 }: PendingProps) {
  return (
    <path
      d={bezierPath(x1, y1, x2, y2)}
      stroke="#409eff"
      strokeWidth={1.6}
      strokeDasharray="4 4"
      fill="none"
      style={{ pointerEvents: "none" }}
    />
  );
}
