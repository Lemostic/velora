import { Bug, Info, PanelLeft, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store/app-store";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TopBarProps {
  appInfo: {
    name: string;
    version: string;
    tauriVersion: string;
    modules: unknown[];
  } | null;
  error: string | null;
}

export function TopBar({ appInfo, error }: TopBarProps) {
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const moduleCount = appInfo?.modules.length ?? 0;

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card/40 px-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              aria-label="切换侧边栏"
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>切换侧边栏</TooltipContent>
        </Tooltip>

        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">
            {appInfo?.name ?? "Velora"}
          </span>
          {appInfo && (
            <Badge variant="secondary" className="text-[10px]">
              v{appInfo.version}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {error ? (
          <div className="flex items-center gap-1.5 text-destructive">
            <Bug className="h-3.5 w-3.5" />
            <span>后端不可用</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-primary" />
            <span>
              {moduleCount > 0
                ? `${moduleCount} modules · Tauri ${appInfo?.tauriVersion ?? "?"}`
                : "加载中…"}
            </span>
          </div>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="关于 Velora">
              <Info className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Velora · Tauri 2 + React 19 · Claude Desktop 风格桌面工具箱
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
