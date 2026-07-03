import { NavLink } from "react-router-dom";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
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
  {
    to: "/modules/excel-to-json",
    label: "Excel → JSON",
    icon: FileSpreadsheet,
  },
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
    <div className="flex flex-col gap-0.5 px-2 py-1">
      {title && (
        <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
          {title}
        </div>
      )}
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          className={({ isActive }) =>
            cn(
              "group flex items-center gap-3 rounded-md px-2.5 py-1.5 text-sm transition-colors",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )
          }
        >
          <item.icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{item.label}</span>
        </NavLink>
      ))}
    </div>
  );
}

export function NavRail() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          "flex h-full shrink-0 flex-col border-r bg-card/40 backdrop-blur transition-[width] duration-200",
          sidebarCollapsed ? "w-14" : "w-60",
        )}
      >
        {/* Logo / brand */}
        <div className="flex h-12 items-center gap-2 border-b px-3">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-sm">
            <span className="text-xs font-bold">V</span>
          </div>
          {!sidebarCollapsed && (
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold">Velora</span>
              <span className="text-[10px] text-muted-foreground">
                v0.1.0 · dev
              </span>
            </div>
          )}
        </div>

        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-1 py-2">
            {sidebarCollapsed ? (
              <CollapsedSections />
            ) : (
              <>
                <NavSection items={PRIMARY_NAV} />
                <Separator className="my-2" />
                <NavSection title="工具" items={TOOL_NAV} />
                <NavSection title="文件 / 转换" items={FILE_NAV} />
                <NavSection title="开发者" items={DEV_NAV} />
                <Separator className="my-2" />
                <NavSection title="系统" items={SYSTEM_NAV} />
              </>
            )}
          </div>
        </ScrollArea>

        <div className="border-t p-2 text-[10px] text-muted-foreground">
          {sidebarCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="text-center">···</div>
              </TooltipTrigger>
              <TooltipContent side="right">Velora</TooltipContent>
            </Tooltip>
          ) : (
            <div className="text-center">Sleek · Extensible · Plugin-ready</div>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}

function CollapsedSections() {
  const all = [
    ...PRIMARY_NAV,
    ...TOOL_NAV,
    ...FILE_NAV,
    ...DEV_NAV,
    ...SYSTEM_NAV,
  ];
  return (
    <div className="flex flex-col items-center gap-0.5 px-1 py-1">
      {all.map((item) => (
        <Tooltip key={item.to}>
          <TooltipTrigger asChild>
            <NavLink
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4" />
            </NavLink>
          </TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
