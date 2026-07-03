import { ArrowLeft } from "lucide-react";
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
    <div className={cn("flex flex-col gap-6", className)}>
      {/* Split layout: icon block on left, content on right */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="grid h-20 w-20 shrink-0 place-items-center rounded-3xl border border-border/60 bg-card/40 shadow-diffusion glass-edge"
        >
          <Icon className="h-9 w-9 text-primary" strokeWidth={1.5} />
        </motion.div>

        <div className="flex flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tighter">
              {m.name}
            </h1>
            <span className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-2.5 py-0.5 text-[10px] font-medium tracking-tight text-muted-foreground">
              <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
              {status.label}
            </span>
          </div>
          <p className="max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
            {m.description}
          </p>
        </div>

        {!hideBack && (
          <Button asChild variant="ghost" size="sm" className="self-start rounded-lg">
            <Link to="/">
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
              返回
            </Link>
          </Button>
        )}
      </div>

      {hasLong && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-2xl border border-border/60 bg-card/30 p-5 shadow-diffusion-sm glass-edge"
        >
          <div className="space-y-3 text-[14px] leading-relaxed text-foreground/85">
            {m.longDescription!.split("\n\n").map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </motion.div>
      )}

      {hasTags && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-wrap items-center gap-1.5"
        >
          {m.tags!.map((t) => (
            <span
              key={t}
              className="rounded-full border border-border/60 bg-background/40 px-2.5 py-0.5 text-[11px] font-medium tracking-tight text-muted-foreground"
            >
              {t}
            </span>
          ))}
        </motion.div>
      )}
    </div>
  );
}
