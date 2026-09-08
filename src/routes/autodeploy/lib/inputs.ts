// 给当前节点拼出要传给后端的 inputs 数组。
//
// 纯函数：没有任何外部依赖，方便 Node 单测。
// 规则是遍历所有连入当前节点的连线，收集已经执行完的上游节点的 output
// （不是消息文案，是后端 result.output 里的真数据）。之前用 `{ path: "" }`
// 占位是错，会让 compress / extract 等依赖 path 的下游节点拿到空路径。

export function buildInputs(
  nodeId: string,
  connections: ReadonlyArray<{ fromNode: string; toNode: string }>,
  executed: ReadonlySet<string>,
  outputsByNode: ReadonlyMap<string, unknown>,
  allNodes: ReadonlyArray<{ id: string }>,
): unknown[] {
  const inputs: unknown[] = [];
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  for (const c of connections) {
    if (c.toNode !== nodeId) continue;
    const upstream = byId.get(c.fromNode);
    if (!upstream || !executed.has(c.fromNode)) continue;
    const upstreamOut = outputsByNode.get(c.fromNode);
    if (upstreamOut !== undefined) {
      inputs.push(upstreamOut);
    }
  }
  return inputs;
}
