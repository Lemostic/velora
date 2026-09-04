// 自动化部署 — 主页面
//
// 布局：
//   ┌────────────────────────────────────────────────────┐
//   │ TopToolbar（工作流名 / 状态 / 模板 / dry-run / run）│
//   ├──────┬───────────────────────────────┬──────────────┤
//   │ 库   │           画布                │   Inspector  │
//   │ 240  │       （节点 + 连线）          │     280      │
//   │      │                               │              │
//   ├──────┴───────────────────────────────┴──────────────┤
//   │ EXECUTE 日志（192px 终端风格）                       │
//   └────────────────────────────────────────────────────┘

import { useEffect } from "react";
import { Canvas } from "./autodeploy/components/canvas";
import { LibraryPanel } from "./autodeploy/components/library-panel";
import { Inspector } from "./autodeploy/components/inspector";
import { TopToolbar } from "./autodeploy/components/top-toolbar";
import { ExecutePanel } from "./autodeploy/components/execute-panel";
import { useAutodeployStore } from "./autodeploy/store";
import { runWorkflow } from "./autodeploy/lib/executor";

export function AutodeployPage() {
  const loadNodeTypes = useAutodeployStore((s) => s.loadNodeTypes);

  // 首次挂载：拉节点定义
  useEffect(() => {
    loadNodeTypes();
  }, [loadNodeTypes]);

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col bg-[var(--bg-page)]">
      <TopToolbar
        onRun={() => void runWorkflow({ dryRun: false })}
        onDryRun={() => void runWorkflow({ dryRun: true })}
      />
      <div className="flex min-h-0 flex-1">
        <LibraryPanel />
        <main className="relative min-w-0 flex-1">
          <Canvas />
        </main>
        <Inspector />
      </div>
      <ExecutePanel />
    </div>
  );
}
