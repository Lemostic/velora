// 画布几何工具 —— 正交圆角连线、命中测试、坐标变换

import type { Viewport } from "../types";

/**
 * 生成带圆角转角的正交连线。
 *
 * 连线始终从源节点水平引出，经过一条垂直干线，再水平进入目标节点，
 * 不使用贝塞尔曲线。这样多输入节点的连线方向更容易辨认，也更符合流程图
 * 的阅读习惯。两点足够接近时自动降低圆角半径，避免圆角互相穿过。
 */
export function orthogonalPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cornerRadius = 10,
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dy === 0) return `M ${x1} ${y1} L ${x2} ${y2}`;
  if (dx === 0) return `M ${x1} ${y1} L ${x2} ${y2}`;

  const directionX = Math.sign(dx);
  const directionY = Math.sign(dy);
  const middleX = x1 + dx / 2;
  const radius = Math.min(cornerRadius, Math.abs(dx) / 4, Math.abs(dy) / 2);
  const firstHorizontalX = middleX - directionX * radius;
  const firstVerticalY = y1 + directionY * radius;
  const secondVerticalY = y2 - directionY * radius;
  const secondHorizontalX = middleX + directionX * radius;

  return [
    `M ${x1} ${y1}`,
    `L ${firstHorizontalX} ${y1}`,
    `Q ${middleX} ${y1} ${middleX} ${firstVerticalY}`,
    `L ${middleX} ${secondVerticalY}`,
    `Q ${middleX} ${y2} ${secondHorizontalX} ${y2}`,
    `L ${x2} ${y2}`,
  ].join(" ");
}

/**
 * 屏幕坐标 → 画布世界坐标。
 */
export function screenToWorld(
  screenX: number,
  screenY: number,
  viewport: Viewport,
): { x: number; y: number } {
  return {
    x: (screenX - viewport.x) / viewport.zoom,
    y: (screenY - viewport.y) / viewport.zoom,
  };
}

/**
 * 画布世界坐标 → 屏幕坐标。
 */
export function worldToScreen(
  worldX: number,
  worldY: number,
  viewport: Viewport,
): { x: number; y: number } {
  return {
    x: worldX * viewport.zoom + viewport.x,
    y: worldY * viewport.zoom + viewport.y,
  };
}

/**
 * 端口在节点上的相对位置。
 * 输入端口在节点左侧垂直均布，输出端口在右侧。
 */
export function portOffset(
  portIndex: number,
  total: number,
  side: "input" | "output",
  nodeWidth: number,
  nodeHeight: number,
): { x: number; y: number } {
  const x = side === "input" ? 0 : nodeWidth;
  if (total <= 1) {
    return { x, y: nodeHeight / 2 };
  }
  const step = nodeHeight / (total + 1);
  return { x, y: step * (portIndex + 1) };
}

/**
 * 节点矩形是否包含点（用于命中测试）。
 */
export function pointInRect(
  px: number,
  py: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

/**
 * 距离平方（避免 sqrt）。
 */
export function distSq(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}
