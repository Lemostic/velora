import { motion } from "framer-motion";
import { Info, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const online = !error && appInfo != null;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 bg-card/20 px-4 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              aria-label="切换侧边栏"
              className="h-8 w-8 rounded-lg"
            >
              <PanelLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>切换侧边栏</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex items-center gap-3">
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1.5 text-[11px] font-medium tracking-tight"
        >
          {online ? (
            <>
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/60" />
                <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              <span className="font-mono text-muted-foreground">
                {moduleCount} modules
              </span>
              <span className="text-muted-foreground/40">·</span>
              <span className="font-mono text-muted-foreground">
                Tauri {appInfo?.tauriVersion}
              </span>
            </>
          ) : (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
              <span className="text-muted-foreground">后端离线</span>
            </>
          )}
        </motion.div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="关于 Velora"
              className="h-8 w-8 rounded-lg"
            >
              <Info className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Velora · Tauri 2 + React 19 · 桌面工具箱
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
