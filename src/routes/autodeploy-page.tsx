// 自动化部署 — 主页面
//
// 布局：
//   ┌────────────────────────────────────────────────────┐
//   │ TopToolbar（工作流名 / 状态 / 模板 / dry-run / run）│
//   ├──────┬───────────────────────────────┬──────────────┤
//   │ 库   │           画布                │   Inspector  │
//   │ 240  │       （节点 + 连线）          │     288      │
//   │      │                               │              │
//   ├──────┴───────────────────────────────┴──────────────┤
//   │ EXECUTE 日志（200px 终端风格）                       │
//   └────────────────────────────────────────────────────┘

import { useEffect, useRef } from "react";
import { Canvas } from "./autodeploy/components/canvas";
import {
  LibraryPanel,
  type LibraryDropEvent,
} from "./autodeploy/components/library-panel";
import { Inspector } from "./autodeploy/components/inspector";
import { TopToolbar } from "./autodeploy/components/top-toolbar";
import { ExecutePanel } from "./autodeploy/components/execute-panel";
import { useAutodeployStore } from "./autodeploy/store";
import { runWorkflow } from "./autodeploy/lib/executor";

const NODE_W = 240;
const NODE_H = 96;

export function AutodeployPage() {
  const loadNodeTypes = useAutodeployStore((s) => s.loadNodeTypes);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadNodeTypes();
  }, [loadNodeTypes]);

  // 库拖拽到画布：坐标转换 + addNode
  const onLibraryDrop = (e: LibraryDropEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const inside =
      e.screenX >= rect.left &&
      e.screenX <= rect.right &&
      e.screenY >= rect.top &&
      e.screenY <= rect.bottom;
    if (!inside) return;
    const { viewport, addNode } = useAutodeployStore.getState();
    const wx = (e.screenX - rect.left - viewport.x) / viewport.zoom;
    const wy = (e.screenY - rect.top - viewport.y) / viewport.zoom;
    addNode(e.type, wx - NODE_W / 2, wy - NODE_H / 2);
  };

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col bg-[#f5f7fa]">
      <TopToolbar
        onRun={() => void runWorkflow({ dryRun: false })}
        onDryRun={() => void runWorkflow({ dryRun: true })}
      />
      <div className="flex min-h-0 flex-1">
        <LibraryPanel onLibraryDrop={onLibraryDrop} />
        <main ref={canvasRef} className="relative min-w-0 flex-1">
          <Canvas />
        </main>
        <Inspector />
      </div>
      <ExecutePanel />
    </div>
  );
}
