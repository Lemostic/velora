import { Link } from "react-router-dom";
import { Construction, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getModule, type ModuleId } from "@/lib/registry";

interface ComingSoonPageProps {
  moduleId: ModuleId;
}

export function ComingSoonPage({ moduleId }: ComingSoonPageProps) {
  const m = getModule(moduleId);
  const ModuleIcon = m?.icon ?? Construction;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-20 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-xl bg-primary/10 text-primary">
        <ModuleIcon className="h-7 w-7" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{m?.name ?? moduleId}</h1>
        <p className="text-sm text-muted-foreground">
          {m?.description ?? "该模块尚未实现"}
        </p>
      </div>
      <Badge variant="outline">尚未实现 · 见迁移计划</Badge>
      <Button asChild variant="ghost" size="sm">
        <Link to="/">
          <ArrowLeft className="h-4 w-4" />
          返回首页
        </Link>
      </Button>
    </div>
  );
}
