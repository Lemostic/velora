import { Link } from "react-router-dom";
import { Sparkles, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CATEGORY_LABELS,
  MODULE_REGISTRY,
  type ModuleCategory,
  type ModuleMeta,
} from "@/lib/registry";

const STATUS_BADGE: Record<
  ModuleMeta["status"],
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  ready: { label: "已上线", variant: "default" },
  wip: { label: "开发中", variant: "secondary" },
  planned: { label: "规划中", variant: "outline" },
};

const STATUS_TONE: Record<ModuleMeta["status"], string> = {
  ready: "bg-primary/10 text-primary",
  wip: "bg-amber-500/10 text-amber-500",
  planned: "bg-muted text-muted-foreground",
};

export function HomePage() {
  const grouped = groupByCategory(MODULE_REGISTRY);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1600px] flex-col gap-5 p-5 lg:p-6">
      {/* Compact desktop-style header — not a webpage hero */}
      <header className="flex shrink-0 items-center justify-between border-b pb-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-sm">
            <span className="text-xs font-bold">V</span>
          </div>
          <div className="flex flex-col leading-tight">
            <h1 className="text-sm font-semibold">Velora</h1>
            <p className="text-[11px] text-muted-foreground">
              {MODULE_REGISTRY.length} 个模块 · Claude Desktop 风格桌面工具箱
            </p>
          </div>
        </div>
        <Badge variant="outline" className="gap-1 text-[10px]">
          <Sparkles className="h-3 w-3" />
          v0.1.0
        </Badge>
      </header>

      {/* Module tiles by category — denser, more native-app feel */}
      <div className="flex-1 space-y-4 overflow-auto pr-1">
        {Array.from(grouped.entries()).map(([category, modules]) => (
          <section key={category} className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                {CATEGORY_LABELS[category as ModuleCategory]}
              </h2>
              <span className="text-[10px] tabular-nums text-muted-foreground/60">
                {modules.length}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
              {modules.map((m) => (
                <ModuleTile key={m.id} module={m} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

interface ModuleTileProps {
  module: ModuleMeta;
}

function ModuleTile({ module: m }: ModuleTileProps) {
  const status = STATUS_BADGE[m.status];
  const disabled = m.status === "planned";
  const Icon: LucideIcon = m.icon;

  const tile = (
    <Card
      className={cn(
        "flex h-full flex-col gap-2 p-3 transition-colors",
        disabled
          ? "cursor-not-allowed opacity-55"
          : "cursor-pointer hover:border-primary/60 hover:bg-accent/40 active:bg-accent/60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-md",
            STATUS_TONE[m.status],
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <Badge
          variant={status.variant}
          className="px-1.5 py-0 text-[9px] leading-tight"
        >
          {status.label}
        </Badge>
      </div>
      <div className="flex flex-1 flex-col gap-0.5">
        <div className="text-[13px] font-medium leading-tight">{m.name}</div>
        <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {m.description}
        </p>
      </div>
    </Card>
  );

  if (disabled) {
    return <div className="block h-full">{tile}</div>;
  }

  return (
    <Link
      to={m.path}
      className="block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {tile}
    </Link>
  );
}

function groupByCategory(
  modules: ModuleMeta[],
): Map<ModuleCategory, ModuleMeta[]> {
  const m = new Map<ModuleCategory, ModuleMeta[]>();
  for (const mod of modules) {
    const list = m.get(mod.category) ?? [];
    list.push(mod);
    m.set(mod.category, list);
  }
  return m;
}
