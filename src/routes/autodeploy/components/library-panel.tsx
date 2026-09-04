// 左侧节点库 —— 列出 SOURCES / PROCESS / TRANSFER 三大类节点
//
// 拖拽：使用 Pointer Events 在 window 上监听（与 Canvas 统一风格）。
// 拖动时显示一个跟随鼠标的 ghost 卡片；松开时调用 onLibraryDrop
// 把节点类型 + 屏幕坐标抛给父组件，父组件决定是否创建节点。
//
// 视觉：Element Plus 风格，浅灰底 + 节点项 hover 高亮 + 分类标题分隔。

import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

export interface LibraryDropEvent {
  type: string;
  screenX: number;
  screenY: number;
}

interface LibraryPanelProps {
  /**
   * 用户从库拖出一个节点到画布某处时调用。父组件应做坐标转换 + addNode。
   * 如果不需要（例如只是 hover 看预览），可以不接。
   */
  onLibraryDrop: (e: LibraryDropEvent) => void;
}

export function LibraryPanel({ onLibraryDrop }: LibraryPanelProps) {
  const nodeTypes = useAutodeployStore((s) => s.nodeTypes);
  const [draggingType, setDraggingType] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const dragInfoRef = useRef<{
    type: string;
    pointerId: number;
  } | null>(null);

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

  // window 级 pointer 监听 —— 即使鼠标移出库面板也不丢
  useEffect(() => {
    if (!draggingType) return;

    function onMove(e: PointerEvent) {
      if (
        dragInfoRef.current &&
        e.pointerId === dragInfoRef.current.pointerId
      ) {
        setCursor({ x: e.clientX, y: e.clientY });
      }
    }
    function onUp(e: PointerEvent) {
      if (
        dragInfoRef.current &&
        e.pointerId === dragInfoRef.current.pointerId
      ) {
        const type = dragInfoRef.current.type;
        onLibraryDrop({ type, screenX: e.clientX, screenY: e.clientY });
        dragInfoRef.current = null;
        setDraggingType(null);
        setCursor(null);
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [draggingType, onLibraryDrop]);

  const onItemPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    type: string,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragInfoRef.current = { type, pointerId: e.pointerId };
    setDraggingType(type);
    setCursor({ x: e.clientX, y: e.clientY });
  };

  const draggingDef = draggingType
    ? nodeTypes.find((t) => t.id === draggingType)
    : null;

  return (
    <>
      <aside className="flex h-full w-60 shrink-0 flex-col border-r border-[#dcdfe6] bg-[#f5f7fa]">
        <div className="border-b border-[#ebeef5] px-3 py-2.5">
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
                  <LibraryItem
                    key={t.id}
                    nodeType={t}
                    onPointerDown={onItemPointerDown}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </aside>

      {/* 跟随鼠标的 ghost */}
      {draggingDef && cursor && (
        <div
          className="pointer-events-none fixed z-50"
          style={{ left: cursor.x + 12, top: cursor.y + 12 }}
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
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>, type: string) => void;
}

function LibraryItem({ nodeType, onPointerDown }: ItemProps) {
  const Icon =
    (Icons as unknown as Record<string, LucideIcon>)[nodeType.icon] ||
    Icons.Circle;
  return (
    <div
      onPointerDown={(e) => onPointerDown(e, nodeType.id)}
      className={cn(
        "group flex cursor-grab select-none items-center gap-2 rounded border border-transparent border-l-[3px] bg-white px-2 py-2 text-[12px] text-[#303133] shadow-sm transition-all",
        "hover:-translate-y-px hover:border-[#dcdfe6] hover:shadow-md active:cursor-grabbing active:translate-y-0 active:shadow",
        CATEGORY_TINT[nodeType.category],
      )}
      title={nodeType.description}
    >
      <Icon
        className="size-3.5 shrink-0 text-[#606266]"
        strokeWidth={1.75}
      />
      <span className="flex-1 truncate font-medium">{nodeType.label}</span>
    </div>
  );
}

function GhostIcon({ name }: { name: string }) {
  const Icon =
    (Icons as unknown as Record<string, LucideIcon>)[name] || Icons.Circle;
  return <Icon className="size-3.5 text-[var(--primary)]" strokeWidth={1.75} />;
}
