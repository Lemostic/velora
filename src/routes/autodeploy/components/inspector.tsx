// 右侧 Inspector —— 当前选中节点的参数面板
//
// 视觉：Element Plus 风格
//   - 320px 宽
//   - 顶部：节点类型徽章 + 标题 + 描述
//   - 中部：动态字段表单（用 FieldInput）
//   - 必填校验缺失时高亮提示
//   - 底部：删除节点按钮
//   - 未选中时显示提示

import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAutodeployStore, useSelectedNode } from "../store";
import { FieldInput } from "./field-input";
import { cn } from "@/lib/utils";

const SSH_CONNECTION_FIELDS = new Set(["host", "user", "auth", "secret"]);

function hasSshSessionAncestor(
  nodeId: string,
  workflow: {
    nodes: ReadonlyArray<{ id: string; type: string }>;
    connections: ReadonlyArray<{ fromNode: string; toNode: string }>;
  },
): boolean {
  const byId = new Map(workflow.nodes.map((item) => [item.id, item]));
  const pending = workflow.connections
    .filter((connection) => connection.toNode === nodeId)
    .map((connection) => connection.fromNode);
  const visited = new Set<string>();

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (byId.get(current)?.type === "ssh_session") return true;
    for (const connection of workflow.connections) {
      if (connection.toNode === current) pending.push(connection.fromNode);
    }
  }
  return false;
}

export function Inspector() {
  const node = useSelectedNode();
  const nodeTypes = useAutodeployStore((s) => s.nodeTypes);
  const workflow = useAutodeployStore((s) => s.workflow);
  const updateNodeParam = useAutodeployStore((s) => s.updateNodeParam);
  const removeNode = useAutodeployStore((s) => s.removeNode);

  if (!node) {
    return (
      <aside className="flex h-full w-72 shrink-0 flex-col border-l border-[#dcdfe6] bg-white">
        <div className="border-b border-[#ebeef5] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#909399]">
          检查器
        </div>
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] text-[#c0c4cc]">
          <div>
            <div className="font-medium text-[#909399]">未选中节点</div>
            <div className="mt-1.5 text-[11px] leading-relaxed">
              点击画布上的节点
              <br />
              在此编辑参数
            </div>
          </div>
        </div>
      </aside>
    );
  }

  const def = nodeTypes.find((t) => t.id === node.type);
  const Icon =
    (def?.icon && (Icons as unknown as Record<string, LucideIcon>)[def.icon]) ||
    Icons.Circle;

  const inheritsSshSession =
    node.type !== "ssh_session" && hasSshSessionAncestor(node.id, workflow);
  const visibleFields = (def?.fields ?? []).filter(
    (field) => !(inheritsSshSession && SSH_CONNECTION_FIELDS.has(field.name)),
  );

  const missingRequired = visibleFields
    .filter((f) => f.required && !node.params[f.name])
    .map((f) => f.name);

  const statusBadge = (() => {
    const map = {
      idle: { bg: "bg-[#f5f7fa]", color: "text-[#909399]", label: "空闲" },
      running: { bg: "bg-[#ecf5ff]", color: "text-[#409eff]", label: "执行中" },
      success: { bg: "bg-[#e1f3d8]", color: "text-[#67c23a]", label: "成功" },
      error: { bg: "bg-[#fef0f0]", color: "text-[#f56c6c]", label: "失败" },
      skipped: { bg: "bg-[#e9e9eb]", color: "text-[#909399]", label: "跳过" },
    };
    const b = map[node.status];
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
          b.bg,
          b.color,
        )}
      >
        <span
          className={cn(
            "size-1.5 rounded-full",
            node.status === "running" && "bg-[#409eff] pulse-ring",
            node.status === "success" && "bg-[#67c23a]",
            node.status === "error" && "bg-[#f56c6c]",
            node.status === "idle" && "bg-[#c0c4cc]",
            node.status === "skipped" && "bg-[#909399]",
          )}
        />
        {b.label}
      </span>
    );
  })();

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-l border-[#dcdfe6] bg-white">
      {/* 节点头 */}
      <div className="border-b border-[#ebeef5] px-3 py-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded text-white",
              def?.category === "source" && "bg-[#67c23a]",
              def?.category === "process" && "bg-[#409eff]",
              def?.category === "transfer" && "bg-[#e6a23c]",
            )}
          >
            <Icon className="size-3.5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-[#303133]">
              {def?.label ?? node.type}
            </div>
            <div className="truncate font-mono text-[10px] text-[#c0c4cc]">
              {node.type}
            </div>
          </div>
          {statusBadge}
        </div>
        {def?.description && (
          <p className="mt-2.5 text-[11px] leading-relaxed text-[#909399]">
            {def.description}
          </p>
        )}
        {node.type === "ssh_session" && (
          <div className="mt-2.5 rounded border border-[#b3d8ff] bg-[#ecf5ff] px-2.5 py-2 text-[11px] leading-relaxed text-[#409eff]">
            <div className="font-semibold">使用方式</div>
            <div className="mt-1">
              1. 填好服务器、用户名和凭据；
              <br />
              2. 将本节点输出连接到远端节点的输入 1；
              <br />
              3. 将远端路径来源连接到输入 2。
            </div>
            <div className="mt-1 text-[#79bbff]">
              同一工作流只建立一次 SSH 连接，后续远端步骤会复用它。
            </div>
          </div>
        )}
        {def && node.type !== "ssh_session" && node.type.startsWith("remote_") && (
            <div className="mt-2.5 rounded border border-[#e6a23c]/40 bg-[#fdf6ec] px-2.5 py-2 text-[11px] leading-relaxed text-[#b88230]">
              远端节点的输入 1 接 SSH 会话，输入 2 接远端路径。若路径已填写在节点参数中，可不连接输入 2。
            </div>
          )}
        {def && node.type === "sftp_upload" && (
          <div className="mt-2.5 rounded border border-[#e6a23c]/40 bg-[#fdf6ec] px-2.5 py-2 text-[11px] leading-relaxed text-[#b88230]">
            SFTP 上传的输入 1 接 SSH 会话，输入 2 接本地文件或目录；远端节点可以继续使用本节点输出的远端路径。
          </div>
        )}
        {def && ["sftp_download", "sftp_delete", "sftp_backup"].includes(node.type) && (
          <div className="mt-2.5 rounded border border-[#e6a23c]/40 bg-[#fdf6ec] px-2.5 py-2 text-[11px] leading-relaxed text-[#b88230]">
            可将 SSH 会话输出连接到输入 1 来复用连接；不连接时，填写本节点自己的服务器、用户名、认证和凭据。
          </div>
        )}
      </div>

      {/* 字段表单 */}
      <div className="flex-1 space-y-3.5 overflow-y-auto px-3 py-3">
        {visibleFields.length ? (
          visibleFields.map((f) => (
            <FieldInput
              key={f.name}
              field={f}
              value={node.params[f.name] ?? ""}
              onChange={(v) => updateNodeParam(node.id, f.name, v)}
            />
          ))
        ) : (
          <div className="text-[12px] text-[#c0c4cc]">
            此节点没有可配置参数
          </div>
        )}

        {inheritsSshSession && (
          <div className="rounded border border-[#67c23a]/40 bg-[#f0f9eb] px-2.5 py-2 text-[11px] leading-relaxed text-[#529b2e]">
            已连接 SSH 会话，服务器、用户名、认证和凭据由会话节点提供。
          </div>
        )}

        {missingRequired.length > 0 && (
          <div className="rounded border border-[#f56c6c]/40 bg-[#fef0f0] px-2.5 py-1.5 text-[11px] text-[#f56c6c]">
            <span className="font-semibold">× </span>
            {missingRequired.length} 个必填字段未填，运行时会被阻止
          </div>
        )}

        {node.message && (
          <div
            className={cn(
              "rounded border px-2.5 py-1.5 text-[11px] font-mono",
              node.status === "error"
                ? "border-[#f56c6c]/40 bg-[#fef0f0] text-[#f56c6c]"
                : "border-[#67c23a]/40 bg-[#e1f3d8] text-[#67c23a]",
            )}
          >
            {node.message}
          </div>
        )}
      </div>

      {/* 底部操作 */}
      <div className="border-t border-[#ebeef5] p-2">
        <button
          onClick={() => {
            if (
              window.confirm(`删除节点「${def?.label ?? node.type}」？`)
            ) {
              removeNode(node.id);
            }
          }}
          className="h-8 w-full rounded text-[12px] text-[#f56c6c] transition-colors hover:bg-[#fef0f0]"
        >
          删除节点
        </button>
      </div>
    </aside>
  );
}
