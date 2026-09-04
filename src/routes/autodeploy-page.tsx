import { PAGE_CONTAINER_CLASS } from "@/lib/spacing";
import { Workflow } from "lucide-react";

/**
 * 自动化部署 — 占位页
 *
 * 完整实现分阶段在 src/routes/autodeploy/ 下：canvas / library-panel /
 * inspector / top-toolbar / execute-panel / node-card / port-handle /
 * connection-line 等。当前是路由占位，等模块就绪后会被替换。
 */
export function AutodeployPage() {
  return (
    <div className={PAGE_CONTAINER_CLASS}>
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div className="rounded-full bg-primary/10 p-4 text-primary">
          <Workflow className="size-8" strokeWidth={1.5} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          自动化部署
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Node-RED 风格工作流编辑器正在装配。下一步会接入画布、节点库、
          参数检查器与执行引擎。
        </p>
      </div>
    </div>
  );
}
