// 工作流拓扑排序 —— 按连线依赖算出执行顺序
//
// 算法：Kahn 风格 BFS + 节点入度表。
// 输入: nodes + connections（按 fromNode/toNode 关联）
// 输出: 按依赖顺序的节点 id 列表；如果存在环，返回空数组 + 错误。

import type { CanvasNode, Connection } from "../types";

export interface TopoResult {
  order: string[];
  hasCycle: boolean;
  roots: string[]; // 入度为 0 的节点（即"起点"）
  unreachable: string[]; // 没有任何连线触达的节点
}

export function topoSort(
  nodes: CanvasNode[],
  connections: Connection[],
): TopoResult {
  const byId = new Map<string, CanvasNode>(nodes.map((n) => [n.id, n]));
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const n of nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }

  for (const c of connections) {
    if (!byId.has(c.fromNode) || !byId.has(c.toNode)) continue;
    adj.get(c.fromNode)!.push(c.toNode);
    indeg.set(c.toNode, (indeg.get(c.toNode) ?? 0) + 1);
  }

  const roots = [...indeg.entries()]
    .filter(([, d]) => d === 0)
    .map(([id]) => id);

  const order: string[] = [];
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }

  const hasCycle = order.length !== nodes.length;
  const reachable = new Set(order);
  const unreachable = nodes
    .filter((n) => !reachable.has(n.id) && !roots.includes(n.id))
    .map((n) => n.id);
  // 起点（roots）也是不可达的"无上游"，分开标记
  return { order, hasCycle, roots, unreachable };
}

/**
 * 从指定起点沿连线 BFS，收集所有可达节点 id。
 * 用来判断"是否每个节点都在 START 出发的路径上"。
 */
export function computeReachable(
  startId: string,
  connections: Connection[],
): Set<string> {
  const adj = new Map<string, string[]>();
  for (const c of connections) {
    const list = adj.get(c.fromNode) ?? [];
    list.push(c.toNode);
    adj.set(c.fromNode, list);
  }
  const reached = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of adj.get(id) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  return reached;
}
