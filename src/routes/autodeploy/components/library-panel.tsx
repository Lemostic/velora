// 左侧节点库 —— 列出 SOURCES / PROCESS / TRANSFER 三大类节点
//
// 节点可拖拽到画布（用 HTML5 drag & drop API）。
// 视觉：Element Plus 风格，浅灰底 + 节点项 hover 高亮 + 分类标题分隔。

import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { useAutodeployStore } from "../store";
import type { NodeCategory, NodeType } from "../types";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<NodeCategory, string> = {
  source: "SOURCES",
  process: "PROCESS",
  transfer: "TRANSFER",
};

const CATEGORY_DESC: Record<NodeCategory, string> = {
  source: "起点 · 指定本地 / 远端的数据源",
  process: "处理 · 压缩 / 解压 / 复制",
  transfer: "传输 · 远端 SFTP 上传 / 下载 / 备份 / 删除",
};

const CATEGORY_TINT: Record<NodeCategory, string> = {
  source: "border-l-[#67c23a]",
  process: "border-l-[#409eff]",
  transfer: "border-l-[#e6a23c]",
};

export function LibraryPanel() {
  const nodeTypes = useAutodeployStore((s) => s.nodeTypes);

  const byCategory = useMemo(() => {
    const map: Record<NodeCategory, NodeType[]> = {
      source: [],
      process: [],
      transfer: [],
    };
    for (const t of nodeTypes) {
      map[t.category].push(t);
    }
    return map;
  }, [nodeTypes]);

  return (
    <aside className="flex h-full w-64 flex-col border-r border-[var(--border)] bg-[#f5f7fa]">
      <div className="border-b border-[var(--border-lighter)] px-3 py-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#909399]">
          节点库
        </div>
        <div className="mt-0.5 text-[11px] text-[#c0c4cc]">
          拖到画布即可创建
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {(Object.keys(byCategory) as NodeCategory[]).map((cat) => (
          <section key={cat} className="mb-3">
            <header className="px-2 pb-1.5 pt-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#606266]">
                {CATEGORY_LABEL[cat]}
              </div>
              <div className="mt-0.5 text-[10px] text-[#c0c4cc]">
                {CATEGORY_DESC[cat]}
              </div>
            </header>
            <div className="space-y-1">
              {byCategory[cat].map((t) => (
                <LibraryItem key={t.id} nodeType={t} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}

interface ItemProps {
  nodeType: NodeType;
}

function LibraryItem({ nodeType }: ItemProps) {
  const Icon = (Icons as unknown as Record<string, LucideIcon>)[nodeType.icon] || Icons.Circle;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          "application/autodeploy-node-type",
          nodeType.id,
        );
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={cn(
        "group flex cursor-grab items-center gap-2 rounded border border-transparent border-l-[3px] bg-white px-2 py-1.5 text-[12px] text-[#303133] shadow-sm transition-all hover:border-[var(--border)] hover:shadow active:cursor-grabbing",
        CATEGORY_TINT[nodeType.category],
      )}
      title={nodeType.description}
    >
      <Icon className="size-3.5 text-[#606266]" strokeWidth={1.75} />
      <span className="flex-1 truncate font-medium">{nodeType.label}</span>
      <span className="font-mono text-[10px] text-[#c0c4cc]">{nodeType.id}</span>
    </div>
  );
}
