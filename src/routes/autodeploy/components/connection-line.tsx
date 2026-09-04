// 连线 SVG —— 节点之间的贝塞尔曲线
//
// 视觉：Element Plus 风格
//   - 默认 stroke 1.8px，颜色 #409eff
//   - hover 时 stroke 2.5px + 显示删除提示
//   - 节点 running 时 stroke 变 #e6a23c（橙）+ dasharray
//   - success 时变 #67c23a（绿），error 变 #f56c6c（红）

import { useState } from "react";
import { useAutodeployStore } from "../store";
import { bezierPath, portOffset } from "../lib/geometry";
import type { Connection } from "../types";

interface LineProps {
  conn: Connection;
  width: number;
  height: number;
}

export function ConnectionLine({ conn, width, height }: LineProps) {
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

  const p1 = portOffset(conn.fromPort, fromDef.outputs, "output", width, height);
  const p2 = portOffset(conn.toPort, toDef.inputs, "input", width, height);
  const x1 = from.x + p1.x;
  const y1 = from.y + p1.y;
  const x2 = to.x + p2.x;
  const y2 = to.y + p2.y;

  // 颜色与样式：跟随源节点 status
  let stroke = "#409eff";
  let dash: string | undefined;
  if (from.status === "success") stroke = "#67c23a";
  else if (from.status === "error") stroke = "#f56c6c";
  else if (from.status === "running") {
    stroke = "#e6a23c";
    dash = "6 4";
  }

  const d = bezierPath(x1, y1, x2, y2);

  return (
    <g
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{ pointerEvents: "all" }}
    >
      {/* 粗透明线吸收点击事件，方便 hover / 删除 */}
      <path
        d={d}
        stroke="transparent"
        strokeWidth={16}
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
        strokeWidth={hover ? 2.5 : 1.8}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={dash}
        className="transition-all"
        style={{ transitionDuration: "120ms" }}
      />
      {/* 端点小圆点（视觉对齐端口） */}
      <circle cx={x1} cy={y1} r={2.5} fill={stroke} />
      <circle cx={x2} cy={y2} r={2.5} fill={stroke} />
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
    <g>
      <path
        d={bezierPath(x1, y1, x2, y2)}
        stroke="#409eff"
        strokeWidth={1.8}
        strokeDasharray="4 4"
        fill="none"
        strokeLinecap="round"
        style={{ pointerEvents: "none" }}
      />
      <circle cx={x1} cy={y1} r={3} fill="#409eff" />
      <circle cx={x2} cy={y2} r={3} fill="#409eff" />
    </g>
  );
}
