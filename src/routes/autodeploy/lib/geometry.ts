// 画布几何工具 —— 贝塞尔曲线、命中测试、坐标变换

import type { Viewport } from "../types";

/**
 * 两点间的水平贝塞尔曲线路径（Node-RED / n8n 风格）。
 * x1/y1 在源点右侧引出，x2/y2 在目标点左侧引入。
 */
export function bezierPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  curvature = 0.5,
): string {
  const dx = x2 - x1;
  const handle = Math.max(Math.abs(dx) * curvature, 32);
  const cx1 = x1 + handle;
  const cy1 = y1;
  const cx2 = x2 - handle;
  const cy2 = y2;
  return `M ${x1} ${y1} C ${cx1} ${cy1} ${cx2} ${cy2} ${x2} ${y2}`;
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
