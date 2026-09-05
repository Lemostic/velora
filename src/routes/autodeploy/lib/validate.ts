// 工作流完整性校验
//
// 规则（流程编排语义）：
//   1. 画布只能有 1 个 START 节点
//   2. 画布只能有 1 个 END 节点
//   3. 所有节点必须挂在 START → ... → END 的路径上
//      （孤立节点 / 不在路径上 = 错误）
//   4. 不允许循环依赖
//
// 返回 errors[]；空数组 = 画布合法，可以执行 / 保存 / 运行。

import type { NodeType, Workflow } from "../types";
import { computeReachable, topoSort } from "./topology";

export type ValidationLevel = "error" | "warning";

export interface ValidationError {
  level: ValidationLevel;
  message: string;
  /** 相关节点 id 列表（UI 可用来在画布上高亮） */
  nodeIds?: string[];
}

const START_ID = "start";
const END_ID = "end";

export function validateWorkflow(
  wf: Workflow,
  nodeTypes: NodeType[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  const labelOf = (id: string): string => {
    const n = wf.nodes.find((x) => x.id === id);
    if (!n) return id;
    const t = nodeTypes.find((tt) => tt.id === n.type);
    return t?.label ?? n.type;
  };

  // ── 0. 空画布不报错（用户刚开始编辑时不应弹一堆红字） ──
  if (wf.nodes.length === 0) {
    return errors;
  }

  // ── 1. START / END 唯一性 ──
  const starts = wf.nodes.filter((n) => n.type === START_ID);
  const ends = wf.nodes.filter((n) => n.type === END_ID);

  if (starts.length === 0) {
    errors.push({
      level: "error",
      message: "缺少「开始」节点 — 从左侧节点库拖一个到画布",
    });
  } else if (starts.length > 1) {
    errors.push({
      level: "error",
      message: `「开始」节点只能有 1 个，当前有 ${starts.length} 个`,
      nodeIds: starts.map((n) => n.id),
    });
  }

  if (ends.length === 0) {
    errors.push({
      level: "error",
      message: "缺少「结束」节点 — 从左侧节点库拖一个到画布",
    });
  } else if (ends.length > 1) {
    errors.push({
      level: "error",
      message: `「结束」节点只能有 1 个，当前有 ${ends.length} 个`,
      nodeIds: ends.map((n) => n.id),
    });
  }

  // ── 2. 拓扑（环 + 孤立） ──
  const topo = topoSort(wf.nodes, wf.connections);
  if (topo.hasCycle) {
    errors.push({
      level: "error",
      message: "工作流存在循环依赖（连线形成闭环）",
    });
  }

  // roots（入度 0）里去掉 START，其它都是"悬空源头"——按用户语义属于孤立
  const validStartId = starts.length === 1 ? starts[0].id : null;
  // ↑ 简化：任何入度 0 且不是 START 的节点都视作孤立
  for (const id of topo.roots) {
    if (id === validStartId) continue;
    errors.push({
      level: "error",
      message: `节点「${labelOf(id)}」没有上游（孤立）`,
      nodeIds: [id],
    });
  }
  // unreachable：拓扑排序未触达的非起点节点
  for (const id of topo.unreachable) {
    errors.push({
      level: "error",
      message: `节点「${labelOf(id)}」未被任何连线触达（孤立）`,
      nodeIds: [id],
    });
  }

  // ── 3. START → 路径完整性 ──
  // 上面已经处理了"入度 0 的非 START 节点"，这里只检查"START 出发是否触达所有节点"
  if (validStartId) {
    const reached = computeReachable(validStartId, wf.connections);
    const offPath = wf.nodes.filter((n) => !reached.has(n.id));
    // END 没上游（孤立的 END）已经被 strayRoots / unreachable 覆盖；
    // 这里 END 在孤立里是 error，但"不在 START 路径上的非 END"也是 error
    for (const n of offPath) {
      errors.push({
        level: "error",
        message: `节点「${labelOf(n.id)}」不在「开始」出发的路径上`,
        nodeIds: [n.id],
      });
    }
  }

  // 去重（同一条 message 同一组 nodeIds 不重复出现）
  const seen = new Set<string>();
  return errors.filter((e) => {
    const key = `${e.level}|${e.message}|${(e.nodeIds ?? []).join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
