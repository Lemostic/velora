// 前端执行器 —— 按拓扑顺序调用 autodeploy_execute
//
// 输入：当前 store 的 workflow + nodeTypes
// 流程：
//   1. 拓扑排序 → 拿到执行顺序
//   2. 检测环 → 有环直接报错
//   3. 顺序执行每个节点
//   4. 收集每个节点的 output，作为下游节点的 inputs
//   5. 任意节点 ok=false → 中断后续节点

import { invoke } from "@tauri-apps/api/core";
import type { ExecuteResult, LogLevel } from "../types";
import { topoSort } from "./topology";
import { useAutodeployStore } from "../store";

interface RunOptions {
  dryRun: boolean;
}

export async function runWorkflow(opts: RunOptions): Promise<void> {
  const { workflow, nodeTypes, setNodeStatus, setRunState, clearLogs } =
    useAutodeployStore.getState();

  // 重置
  clearLogs();
  for (const n of workflow.nodes) setNodeStatus(n.id, "idle");
  setRunState("running");

  log("info", `开始 ${opts.dryRun ? "dry-run" : "执行"} 工作流：${workflow.name}（${workflow.nodes.length} 节点）`);

  // 校验
  const { order, hasCycle } = topoSort(workflow.nodes, workflow.connections);
  if (hasCycle) {
    log("error", "工作流存在环，无法执行。请检查连线。");
    setRunState("error");
    return;
  }
  if (order.length === 0) {
    log("warn", "画布为空，无需执行。");
    setRunState("idle");
    return;
  }

  // 必填校验
  for (const id of order) {
    const n = workflow.nodes.find((x) => x.id === id)!;
    const def = nodeTypes.find((t) => t.id === n.type);
    if (!def) continue;
    const missing = def.fields
      .filter((f) => f.required && !n.params[f.name])
      .map((f) => f.label);
    if (missing.length > 0) {
      log("error", `节点 ${n.id} (${def.label}) 必填字段未填：${missing.join("、")}`, n.id);
      setNodeStatus(n.id, "error", "必填字段未填");
      setRunState("error");
      return;
    }
  }

  if (opts.dryRun) {
    log("info", "dry-run 模式：只校验，不实际执行");
    for (const id of order) {
      const n = workflow.nodes.find((x) => x.id === id)!;
      const def = nodeTypes.find((t) => t.id === n.type);
      log("ok", `${def?.label ?? n.type} 校验通过`, n.id);
      setNodeStatus(n.id, "success", "校验通过");
    }
    log("ok", "dry-run 完成");
    setRunState("success");
    return;
  }

  // 真正执行
  const outputCache = new Map<string, unknown>();
  for (const id of order) {
    const n = workflow.nodes.find((x) => x.id === id)!;
    const def = nodeTypes.find((t) => t.id === n.type);
    log("info", `执行 ${def?.label ?? n.type}（${n.type}）`, n.id);
    setNodeStatus(n.id, "running");

    // 收集上游 inputs
    const inputs: unknown[] = [];
    for (const c of workflow.connections) {
      if (c.toNode === n.id) {
        const upstreamOutput = outputCache.get(c.fromNode);
        if (upstreamOutput !== undefined) inputs.push(upstreamOutput);
      }
    }

    try {
      const req = {
        nodeId: n.id,
        nodeType: n.type,
        params: n.params,
        inputs,
      };
      const result = await invoke<ExecuteResult>("autodeploy_execute", { req });
      if (result.ok) {
        log("ok", result.message, n.id);
        setNodeStatus(n.id, "success", result.message);
        if (result.output !== undefined) outputCache.set(n.id, result.output);
      } else {
        log("error", result.message, n.id);
        setNodeStatus(n.id, "error", result.message);
        // 中断后续
        for (const later of order.slice(order.indexOf(id) + 1)) {
          setNodeStatus(later, "skipped", "因上游失败而跳过");
        }
        setRunState("error");
        log("error", "工作流执行失败");
        return;
      }
    } catch (e) {
      const msg = String(e);
      log("error", `调用失败：${msg}`, n.id);
      setNodeStatus(n.id, "error", msg);
      setRunState("error");
      return;
    }
  }

  log("ok", "工作流执行完成");
  setRunState("success");
}

function log(level: LogLevel, message: string, nodeId?: string) {
  useAutodeployStore.getState().appendLog({ level, message, nodeId });
}
