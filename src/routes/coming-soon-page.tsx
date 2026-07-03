import { Link } from "react-router-dom";
import { Info } from "lucide-react";
import { ModuleHeader } from "@/components/module/module-header";
import { useAppStore } from "@/store/app-store";
import { PADDING_CLASSES } from "@/lib/spacing";
import { cn } from "@/lib/utils";
import type { ModuleId } from "@/lib/registry";

interface ComingSoonPageProps {
  moduleId: ModuleId;
}

export function ComingSoonPage({ moduleId }: ComingSoonPageProps) {
  const contentPadding = useAppStore((s) => s.contentPadding);
  return (
    <div
      className={cn(
        "mx-auto flex h-full w-full max-w-4xl flex-col gap-6",
        PADDING_CLASSES[contentPadding],
      )}
    >
      <ModuleHeader moduleId={moduleId} />

      {/* Not-yet-implemented notice */}
      <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="space-y-1">
          <div className="font-medium text-foreground/80">该模块尚未实现</div>
          <div>
            按迁移计划在后续阶段迁入。优先级参考
            <Link
              to="/"
              className="mx-1 text-primary underline-offset-2 hover:underline"
            >
              首页
            </Link>
            的状态徽章，或
            <code className="mx-1 rounded bg-background px-1 py-0.5 text-[10px]">
              AGENTS.md
            </code>
            里的模块清单。
          </div>
        </div>
      </div>
    </div>
  );
}
