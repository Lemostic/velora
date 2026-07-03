import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getModule, type ModuleId } from "@/lib/registry";
import { cn } from "@/lib/utils";

interface ModuleHeaderProps {
  moduleId: ModuleId;
  /** 隐藏"返回"按钮（首页用） */
  hideBack?: boolean;
  className?: string;
}

const STATUS_BADGE = {
  ready: { label: "已上线", variant: "default" as const },
  wip: { label: "开发中", variant: "secondary" as const },
  planned: { label: "规划中", variant: "outline" as const },
};

const STATUS_TONE = {
  ready: "bg-primary/10 text-primary",
  wip: "bg-amber-500/10 text-amber-500",
  planned: "bg-muted text-muted-foreground",
};

export function ModuleHeader({
  moduleId,
  hideBack = false,
  className,
}: ModuleHeaderProps) {
  const m = getModule(moduleId);
  if (!m) {
    return (
      <div className="px-6 py-4 text-sm text-muted-foreground">
        未知模块：{moduleId}
      </div>
    );
  }
  const Icon = m.icon;
  const status = STATUS_BADGE[m.status];
  const hasLong = !!m.longDescription;
  const hasTags = !!m.tags && m.tags.length > 0;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Top bar: icon + name + status + back button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-md",
              STATUS_TONE[m.status],
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex flex-col leading-tight">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold">{m.name}</h1>
              <Badge variant={status.variant} className="text-[10px]">
                {status.label}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{m.description}</p>
          </div>
        </div>
        {!hideBack && (
          <Button asChild variant="ghost" size="sm">
            <Link to="/">
              <ArrowLeft className="h-3.5 w-3.5" />
              返回
            </Link>
          </Button>
        )}
      </div>

      {(hasLong || hasTags) && <Separator />}

      {/* Long description — multi-paragraph module overview */}
      {hasLong && (
        <div className="space-y-2.5 rounded-md border bg-card/40 p-3.5 text-sm leading-relaxed text-foreground/90">
          {m.longDescription!.split("\n\n").map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      )}

      {/* Tags */}
      {hasTags && (
        <div className="flex flex-wrap items-center gap-1.5">
          {m.tags!.map((t) => (
            <Badge key={t} variant="outline" className="text-[10px]">
              {t}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
