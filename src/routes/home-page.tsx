import { Link } from "react-router-dom";
import { ArrowRight, Sparkles, Wand2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  CATEGORY_LABELS,
  MODULE_REGISTRY,
  type ModuleCategory,
  type ModuleMeta,
} from "@/lib/registry";

const STATUS_BADGE: Record<ModuleMeta["status"], { label: string; variant: "default" | "secondary" | "outline" }> = {
  ready: { label: "已上线", variant: "default" },
  wip: { label: "开发中", variant: "secondary" },
  planned: { label: "规划中", variant: "outline" },
};

export function HomePage() {
  const grouped = groupByCategory(MODULE_REGISTRY);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-8 p-6 lg:p-8">
      {/* Hero */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            <Sparkles className="mr-1 h-3 w-3" />
            v0.1.0 · 骨架完成
          </Badge>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Velora
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          一个 Claude Desktop 风格的桌面工具箱。基于 Tauri 2 + React 19 + Rust，
          包体积 5-15MB、内存占用 1/5 Java 版本。从 JavaFX/WorkbenchFX
          重写而来，首批迁入的工具见下方。
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button asChild size="sm">
            <Link to="/modules/qrcode">
              <Wand2 className="h-4 w-4" />
              试试二维码
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/modules/excel-to-json">
              试试 Excel → JSON
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      <Separator />

      {/* Module grid by category */}
      {Array.from(grouped.entries()).map(([category, modules]) => (
        <section key={category} className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {CATEGORY_LABELS[category as ModuleCategory]}
            </h2>
            <span className="text-xs text-muted-foreground/70">
              {modules.length} 个模块
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {modules.map((m) => (
              <ModuleCard key={m.id} module={m} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ModuleCard({ module: m }: { module: ModuleMeta }) {
  const status = STATUS_BADGE[m.status];
  return (
    <Card className="group transition-colors hover:border-primary/50">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary">
              <m.icon className="h-5 w-5" />
            </div>
            <CardTitle className="text-base">{m.name}</CardTitle>
          </div>
          <Badge variant={status.variant} className="text-[10px]">
            {status.label}
          </Badge>
        </div>
        <CardDescription className="pt-1">{m.description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="w-full justify-between"
          disabled={m.status === "planned"}
        >
          <Link to={m.path}>
            {m.status === "planned" ? "尚未实现" : "打开模块"}
            {m.status !== "planned" && <ArrowRight className="h-4 w-4" />}
          </Link>
        </Button>
      </CardContent>
    </Card>
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
