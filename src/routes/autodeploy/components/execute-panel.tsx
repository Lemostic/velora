// 底部 EXECUTE 面板 —— 实时日志
//
// 视觉：Element Plus 风格
//   - 高度 192px（可拖拽调整，先写死）
//   - bg-[#1d1e1f] 暗色背景 + 等宽字体（终端风格）
//   - 行首时间戳 + 等级色（info=灰 / ok=绿 / warn=黄 / error=红）
//   - 顶部 28px header：EXECUTE 标签 + 清空按钮
//   - 自动滚到底部

import { useEffect, useRef } from "react";
import { Terminal, Trash2 } from "lucide-react";
import { useAutodeployStore } from "../store";
import type { LogLevel } from "../types";
import { cn } from "@/lib/utils";

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: "text-[#909399]",
  ok: "text-[#67c23a]",
  warn: "text-[#e6a23c]",
  error: "text-[#f56c6c]",
};

const LEVEL_PREFIX: Record<LogLevel, string> = {
  info: "INFO",
  ok: " OK ",
  warn: "WARN",
  error: "ERR ",
};

function formatTs(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(
    d.getMilliseconds(),
  ).padStart(3, "0")}`;
}

export function ExecutePanel() {
  const logs = useAutodeployStore((s) => s.logs);
  const clearLogs = useAutodeployStore((s) => s.clearLogs);
  const workflow = useAutodeployStore((s) => s.workflow);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // 自动滚到底部
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  return (
    <div className="flex h-48 shrink-0 flex-col border-t border-[var(--border)] bg-[#1d1e1f]">
      <header className="flex h-7 shrink-0 items-center justify-between border-b border-[#363637] px-3 text-[11px] text-[#a3a6ad]">
        <span className="flex items-center gap-1.5 font-semibold uppercase tracking-[0.1em]">
          <Terminal className="size-3" strokeWidth={1.75} />
          EXECUTE
          <span className="font-mono text-[10px] text-[#606266]">
            · {logs.length} lines
          </span>
        </span>
        <span className="flex items-center gap-3 font-mono text-[10px] text-[#606266]">
          <span>nodes {workflow.nodes.length}</span>
          <span>links {workflow.connections.length}</span>
          <button
            onClick={clearLogs}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-[#363637] hover:text-[#cfd3dc]"
            title="清空日志"
          >
            <Trash2 className="size-3" strokeWidth={1.75} />
            清空
          </button>
        </span>
      </header>
      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-5"
      >
        {logs.length === 0 ? (
          <div className="text-[#606266]">No log output yet. Run a workflow to see its output here.</div>
        ) : (
          logs.map((l, i) => (
            <div
              key={i}
              className={cn(
                "whitespace-pre-wrap break-all",
                LEVEL_COLOR[l.level],
              )}
            >
              <span className="text-[#606266]">{formatTs(l.ts)}</span>
              <span className={cn("ml-2", LEVEL_COLOR[l.level])}>
                [{LEVEL_PREFIX[l.level]}]
              </span>
              {l.nodeId && (
                <span className="ml-2 text-[#409eff]">{l.nodeId}</span>
              )}
              <span className="ml-2">{l.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
