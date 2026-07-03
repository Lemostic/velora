import { ArrowLeft, ChevronDown, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getModule, type ModuleId } from "@/lib/registry";

interface ModuleHeaderProps {
  moduleId: ModuleId;
  hideBack?: boolean;
  className?: string;
}

const STATUS = {
  ready: { label: "已上线", dot: "bg-emerald-500" },
  wip: { label: "开发中", dot: "bg-amber-500" },
  planned: { label: "规划中", dot: "bg-zinc-500" },
} as const;

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
  const status = STATUS[m.status];
  const hasLong = !!m.longDescription;
  const hasTags = !!m.tags && m.tags.length > 0;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Top row: compact icon + name + status + back */}
      <div className="flex items-start gap-3">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-border/60 bg-card/40 shadow-diffusion-sm glass-edge"
        >
          <Icon className="h-5 w-5 text-primary" strokeWidth={1.5} />
        </motion.div>

        <div className="flex flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">{m.name}</h1>
            <span className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10px] font-medium tracking-tight text-muted-foreground">
              <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
              {status.label}
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {m.description}
          </p>
        </div>

        {!hideBack && (
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-7 self-start rounded-md px-2 text-xs"
          >
            <Link to="/">
              <ArrowLeft className="h-3 w-3" strokeWidth={2} />
              返回
            </Link>
          </Button>
        )}
      </div>

      {/* Collapsible long description — default folded */}
      {hasLong && (
        <details className="group overflow-hidden rounded-lg border border-border/60 bg-card/30 shadow-diffusion-sm">
          <summary
            className={cn(
              "flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5",
              "text-[12px] font-medium tracking-tight text-foreground/85",
              "transition-colors hover:bg-accent/40",
              "[&::-webkit-details-marker]:hidden",
            )}
          >
            <span className="flex items-center gap-2">
              <Info
                className="h-3.5 w-3.5 text-muted-foreground"
                strokeWidth={1.75}
              />
              模块说明
              <span className="font-mono text-[10px] text-muted-foreground/60">
                {m.longDescription!.split("\n\n").length} 段
              </span>
            </span>
            <ChevronDown
              className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
              strokeWidth={2}
            />
          </summary>
          <div className="border-t border-border/60 px-3.5 py-3 text-[13px] leading-relaxed text-foreground/85">
            {m.longDescription!.split("\n\n").map((para, i) => (
              <p key={i} className="mb-2 last:mb-0">
                {para}
              </p>
            ))}
          </div>
        </details>
      )}

      {/* Tags — always visible, compact */}
      {hasTags && (
        <div className="flex flex-wrap items-center gap-1">
          {m.tags!.map((t) => (
            <span
              key={t}
              className="rounded-md border border-border/60 bg-background/40 px-2 py-0.5 text-[10px] font-medium tracking-tight text-muted-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
