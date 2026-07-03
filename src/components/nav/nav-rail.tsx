import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Cpu,
  FileArchive,
  FileSpreadsheet,
  FileText,
  FolderTree,
  GanttChartSquare,
  Home,
  type LucideIcon,
  QrCode,
  Repeat,
  Search,
  Settings as SettingsIcon,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppStore } from "@/store/app-store";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const PRIMARY_NAV: NavItem[] = [
  { to: "/", label: "首页", icon: Home },
];

const TOOL_NAV: NavItem[] = [
  { to: "/modules/qrcode", label: "二维码", icon: QrCode },
  { to: "/modules/excel-to-json", label: "Excel → JSON", icon: FileSpreadsheet },
  { to: "/modules/excel-transpose", label: "Excel 转置", icon: Repeat },
  { to: "/modules/excel-schedule", label: "研发计划排期", icon: GanttChartSquare },
];

const FILE_NAV: NavItem[] = [
  { to: "/modules/file-treeview", label: "文件树", icon: FolderTree },
  { to: "/modules/zip-clean", label: "Zip 清理", icon: FileArchive },
  { to: "/modules/xml-json", label: "XML ↔ JSON", icon: Repeat },
  { to: "/modules/markitdown", label: "Markitdown", icon: FileText },
];

const DEV_NAV: NavItem[] = [
  { to: "/modules/process-manager", label: "进程管理", icon: Cpu },
  { to: "/modules/es-query", label: "ES 查询", icon: Search },
];

const SYSTEM_NAV: NavItem[] = [
  { to: "/modules/preferences", label: "偏好设置", icon: SettingsIcon },
];

interface NavSectionProps {
  title?: string;
  items: NavItem[];
}

function NavSection({ title, items }: NavSectionProps) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-1">
      {title && (
        <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
          {title}
        </div>
      )}
      {items.map((item) => (
        <DockLink key={item.to} item={item} />
      ))}
    </div>
  );
}

function DockLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={item.to}
          end={item.to === "/"}
          className={({ isActive }) =>
            cn(
              "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
              isActive
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId="nav-active-indicator"
                  className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-primary"
                  transition={{ type: "spring", stiffness: 300, damping: 28 }}
                />
              )}
              <span
                className={cn(
                  "grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "bg-transparent text-current group-hover:bg-background/40",
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              </span>
              <span className="truncate">{item.label}</span>
            </>
          )}
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function CollapsedLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={item.to}
          end={item.to === "/"}
          className={({ isActive }) =>
            cn(
              "relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
              isActive
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId="nav-active-indicator"
                  className="absolute -left-0.5 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-primary"
                  transition={{ type: "spring", stiffness: 300, damping: 28 }}
                />
              )}
              <Icon
                className={cn("h-4 w-4", isActive && "text-primary")}
                strokeWidth={1.75}
              />
            </>
          )}
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function CollapsedSection({ title, items }: NavSectionProps) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-1 py-1">
      {title && (
        <div className="my-1 h-px w-6 bg-border" />
      )}
      {items.map((item) => (
        <CollapsedLink key={item.to} item={item} />
      ))}
    </div>
  );
}

export function NavRail() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border/60 bg-card/30 backdrop-blur-xl transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
        sidebarCollapsed ? "w-[68px]" : "w-[244px]",
      )}
    >
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 border-b border-border/60 px-4">
        <div className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-primary/90 to-primary/40 shadow-glow">
          <Sparkles className="h-4 w-4 text-primary-foreground" strokeWidth={2} />
        </div>
        {!sidebarCollapsed && (
          <div className="flex flex-col leading-tight">
            <span className="text-[15px] font-semibold tracking-tight">
              Velora
            </span>
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
              v0.1.0
            </span>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 py-3">
          {sidebarCollapsed ? (
            <>
              <CollapsedSection items={PRIMARY_NAV} />
              <CollapsedSection title="·" items={TOOL_NAV} />
              <CollapsedSection title="·" items={FILE_NAV} />
              <CollapsedSection title="·" items={DEV_NAV} />
              <CollapsedSection title="·" items={SYSTEM_NAV} />
            </>
          ) : (
            <>
              <NavSection items={PRIMARY_NAV} />
              <Separator className="mx-3 my-2 opacity-50" />
              <NavSection title="工具" items={TOOL_NAV} />
              <NavSection title="文件 / 转换" items={FILE_NAV} />
              <NavSection title="开发者" items={DEV_NAV} />
              <Separator className="mx-3 my-2 opacity-50" />
              <NavSection title="系统" items={SYSTEM_NAV} />
            </>
          )}
        </div>
      </ScrollArea>

      {!sidebarCollapsed && (
        <div className="border-t border-border/60 px-4 py-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/60" />
              <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Tauri 运行时
          </div>
        </div>
      )}
    </aside>
  );
}
