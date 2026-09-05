// 左侧节点库 —— 列出 SOURCES / PROCESS / TRANSFER 三大类节点
//
// 拖拽：Library item pointerdown 时**同步**给 window 装 pointermove/up 监听
//（不等 React useEffect 异步 commit），保证 pointerup 一定能命中 listener。
// Playwright / 一些 WebView 在 drag 过程中 pointerId 会变，因此 listener
// 只判"是否在拖拽中"，不再校验 pointerId。ESC = 放弃。

import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useAutodeployStore } from "../store";
import type { NodeCategory, NodeType } from "../types";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<NodeCategory, string> = {
  source: "SOURCES",
  process: "PROCESS",
  transfer: "TRANSFER",
  flow: "FLOW",
};

const CATEGORY_DESC: Record<NodeCategory, string> = {
  source: "起点 · 指定本地 / 远端的数据源",
  process: "处理 · 压缩 / 解压 / 复制",
  transfer: "传输 · 远端 SFTP 上传 / 下载 / 备份 / 删除",
  flow: "流程标记 · 开始 / 结束（画布唯一）",
};

const CATEGORY_TINT: Record<NodeCategory, string> = {
  source: "border-l-[#67c23a]",
  process: "border-l-[#409eff]",
  transfer: "border-l-[#e6a23c]",
  flow: "border-l-[#909399]",
};

export interface LibraryDropEvent {
  type: string;
  screenX: number;
  screenY: number;
}

interface LibraryPanelProps {
  onLibraryDrop: (e: LibraryDropEvent) => void;
}

export function LibraryPanel({ onLibraryDrop }: LibraryPanelProps) {
  const nodeTypes = useAutodeployStore((s) => s.nodeTypes);
  const [dragging, setDragging] = useState<{
    type: string;
    cursor: { x: number; y: number };
  } | null>(null);

  const byCategory = useMemo(() => {
    const map: Record<NodeCategory, NodeType[]> = {
      source: [],
      process: [],
      transfer: [],
      flow: [],
    };
    for (const t of nodeTypes) {
      map[t.category].push(t);
    }
    return map;
  }, [nodeTypes]);

  // START / END 唯一性：画布已存在则禁用 library 里的对应项
  const existingNodeTypes = useAutodeployStore(
    (s) => new Set(s.workflow.nodes.map((n) => n.type)),
  );

  // 同步装 native 监听（不进 useEffect 异步陷阱）。
  // 用 onMouseDown 触发：Playwright drag 派发的是 mouse events（mousedown
  // → mousemove → mouseup），现代浏览器会把 mouse event 提升为 pointer
  // event，但 React 19 的事件委托有时不会触发 onPointerDown。直接绑
  // mousedown 是最可靠的。
  const onItemPointerDown = (
    e: React.MouseEvent<HTMLDivElement>,
    type: string,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging({ type, cursor: { x: e.clientX, y: e.clientY } });

    function onMove(ev: MouseEvent) {
      setDragging({ type, cursor: { x: ev.clientX, y: ev.clientY } });
    }
    function onUp(ev: MouseEvent) {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDragging(null);
      onLibraryDrop({ type, screenX: ev.clientX, screenY: ev.clientY });
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const draggingDef = dragging
    ? nodeTypes.find((t) => t.id === dragging.type)
    : null;

  return (
    <>
      <aside className="flex h-full w-60 shrink-0 flex-col border-r border-[#dcdfe6] bg-[#f5f7fa]">
        <div className="border-b border-[#ebeef5] px-3 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#909399]">
            节点库
          </div>
          <div className="mt-0.5 text-[11px] text-[#c0c4cc]">拖到画布即可创建</div>
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
                {byCategory[cat].map((t) => {
                  // 流程标记节点（start / end）画布唯一，已存在则禁用
                  const disabled =
                    (t.id === "start" || t.id === "end") &&
                    existingNodeTypes.has(t.id);
                  return (
                    <LibraryItem
                      key={t.id}
                      nodeType={t}
                      disabled={disabled}
                      onPointerDown={onItemPointerDown}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </aside>

      {draggingDef && dragging && (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            left: dragging.cursor.x + 12,
            top: dragging.cursor.y + 12,
          }}
        >
          <div
            className={cn(
              "flex items-center gap-1.5 rounded border border-[var(--primary)] bg-white px-2.5 py-1.5 text-[12px] text-[#303133] shadow-lg",
              CATEGORY_TINT[draggingDef.category],
              "border-l-[3px]",
            )}
          >
            <GhostIcon name={draggingDef.icon} />
            <span className="font-medium">{draggingDef.label}</span>
          </div>
        </div>
      )}
    </>
  );
}

interface ItemProps {
  nodeType: NodeType;
  disabled?: boolean;
  onPointerDown: (e: React.MouseEvent<HTMLDivElement>, type: string) => void;
}

function LibraryItem({ nodeType, disabled, onPointerDown }: ItemProps) {
  const Icon =
    (Icons as unknown as Record<string, LucideIcon>)[nodeType.icon] ||
    Icons.Circle;
  return (
    <div
      onMouseDown={(e) => {
        if (disabled) return;
        onPointerDown(e, nodeType.id);
      }}
      className={cn(
        "group flex select-none items-center gap-2 rounded border border-transparent border-l-[3px] bg-white px-2 py-2 text-[12px] text-[#303133] shadow-sm transition-all",
        !disabled &&
          "cursor-grab hover:-translate-y-px hover:border-[#dcdfe6] hover:shadow-md active:cursor-grabbing active:translate-y-0 active:shadow",
        disabled && "cursor-not-allowed opacity-50",
        CATEGORY_TINT[nodeType.category],
      )}
      title={disabled ? `${nodeType.description}（画布已存在）` : nodeType.description}
    >
      <Icon
        className="size-3.5 shrink-0 text-[#606266]"
        strokeWidth={1.75}
      />
      <span className="flex-1 truncate font-medium">{nodeType.label}</span>
      {disabled && (
        <span className="rounded bg-[#f0f9ff] px-1 text-[9px] font-medium uppercase tracking-wider text-[#909399]">
          已添加
        </span>
      )}
    </div>
  );
}

function GhostIcon({ name }: { name: string }) {
  const Icon =
    (Icons as unknown as Record<string, LucideIcon>)[name] || Icons.Circle;
  return <Icon className="size-3.5 text-[var(--primary)]" strokeWidth={1.75} />;
}
