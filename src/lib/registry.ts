// 前端模块元数据 — 与 src-tauri/src/modules/registry.rs 保持一致
//
// 数据来源优先用 Tauri 后端 `list_modules` 命令（运行时从 Rust 拉取），
// 这份静态表是降级方案：后端拉不到时用这个保证 NavRail 至少有骨架。

import {
  ArrowLeftRight,
  Cpu,
  FileArchive,
  FileSpreadsheet,
  FileText,
  FolderTree,
  GanttChartSquare,
  type LucideIcon,
  QrCode,
  Repeat,
  Search,
  Settings,
} from "lucide-react";

export type ModuleId =
  | "qrcode"
  | "excel-to-json"
  | "excel-transpose"
  | "file-treeview"
  | "zip-clean"
  | "xml-json"
  | "markitdown"
  | "process-manager"
  | "es-query"
  | "excel-schedule"
  | "preferences";

export type ModuleCategory =
  | "tools"
  | "files"
  | "convert"
  | "devtools"
  | "search"
  | "productivity"
  | "system";

export interface ModuleMeta {
  id: ModuleId;
  name: string;
  category: ModuleCategory;
  description: string;
  icon: LucideIcon;
  path: string;
  status: "ready" | "wip" | "planned";
}

const ICON_MAP: Record<string, LucideIcon> = {
  QrCode,
  FileSpreadsheet,
  Repeat,
  FolderTree,
  FileArchive,
  ArrowLeftRight,
  FileText,
  Cpu,
  Search,
  GanttChartSquare,
  Settings,
};

export const MODULE_REGISTRY: ModuleMeta[] = [
  {
    id: "qrcode",
    name: "二维码",
    category: "tools",
    description: "文本 / URL / WiFi 一键生成二维码",
    icon: QrCode,
    path: "/modules/qrcode",
    status: "wip",
  },
  {
    id: "excel-to-json",
    name: "Excel → JSON",
    category: "tools",
    description: "把 Excel 表格转成结构化 JSON，支持多 sheet",
    icon: FileSpreadsheet,
    path: "/modules/excel-to-json",
    status: "wip",
  },
  {
    id: "excel-transpose",
    name: "Excel 转置",
    category: "tools",
    description: "行列互换 + 字段映射",
    icon: Repeat,
    path: "/modules/excel-transpose",
    status: "planned",
  },
  {
    id: "file-treeview",
    name: "文件树",
    category: "files",
    description: "浏览本地目录结构，支持搜索和大文件过滤",
    icon: FolderTree,
    path: "/modules/file-treeview",
    status: "planned",
  },
  {
    id: "zip-clean",
    name: "Zip 清理",
    category: "files",
    description: "扫描并清理重复/空 zip 压缩包",
    icon: FileArchive,
    path: "/modules/zip-clean",
    status: "planned",
  },
  {
    id: "xml-json",
    name: "XML ↔ JSON",
    category: "convert",
    description: "XML 与 JSON 双向互转",
    icon: ArrowLeftRight,
    path: "/modules/xml-json",
    status: "planned",
  },
  {
    id: "markitdown",
    name: "Markitdown",
    category: "convert",
    description: "把 PDF / Word / Excel 转成 Markdown",
    icon: FileText,
    path: "/modules/markitdown",
    status: "planned",
  },
  {
    id: "process-manager",
    name: "进程管理",
    category: "devtools",
    description: "查看本机进程、CPU/内存占用、结束进程",
    icon: Cpu,
    path: "/modules/process-manager",
    status: "planned",
  },
  {
    id: "es-query",
    name: "ES 查询",
    category: "search",
    description: "Elasticsearch 可视化查询",
    icon: Search,
    path: "/modules/es-query",
    status: "planned",
  },
  {
    id: "excel-schedule",
    name: "研发计划排期",
    category: "productivity",
    description: "Excel 排期 + 甘特图 + 多维度过滤 + Owner 统计",
    icon: GanttChartSquare,
    path: "/modules/excel-schedule",
    status: "planned",
  },
  {
    id: "preferences",
    name: "偏好设置",
    category: "system",
    description: "主题、快捷键、插件管理",
    icon: Settings,
    path: "/modules/preferences",
    status: "planned",
  },
];

export const CATEGORY_LABELS: Record<ModuleCategory, string> = {
  tools: "工具",
  files: "文件",
  convert: "转换",
  devtools: "开发者",
  search: "搜索",
  productivity: "效率",
  system: "系统",
};

export function getModule(id: ModuleId): ModuleMeta | undefined {
  return MODULE_REGISTRY.find((m) => m.id === id);
}

/** 把后端返回的字符串 icon 名映射到 lucide 图标组件（仅作为降级） */
export function iconFromName(name: string): LucideIcon {
  return ICON_MAP[name] ?? Settings;
}
