// 前端模块元数据 — 与后端 `list_modules` 命令语义保持一致。
//
// 真正的数据源是 Tauri 后端命令（运行时从 Rust 拉取）；
// 这份静态表是降级方案：后端拉不到时用这个保证 NavRail / Cmd+K 仍有骨架。

import {
  ArrowLeftRight,
  Binary,
  Braces,
  Clock,
  Cpu,
  Diff,
  type LucideIcon,
  FileArchive,
  FileSpreadsheet,
  FileText,
  FolderTree,
  GanttChartSquare,
  Hash,
  KeyRound,
  Palette,
  QrCode,
  Regex,
  Repeat,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
} from "lucide-react";

/**
 * ModuleId 是模块路由段的 TS 字面量联合。
 * 新增模块时：
 *  1) 在这里加 id；
 *  2) 加 `MODULE_REGISTRY` 里的一行；
 *  3) 同步 src-tauri/src/modules/registry.rs 的 id 字符串。
 *  4) 在 App.tsx 加路由。
 */
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
  | "preferences"
  | "json-formatter"
  | "regex-tester"
  | "base64-codec"
  | "url-codec"
  | "hash-tool"
  | "jwt-decoder"
  | "uuid-gen";

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
  /** 一句话简介，bento 卡片用 */
  description: string;
  /** 模块页面里展示的详细说明（多段，分隔符 \n\n） */
  longDescription?: string;
  /** 标签：阶段、特性、依赖等 */
  tags?: string[];
  category: ModuleCategory;
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
  Braces,
  Regex,
  Binary,
  Hash,
  KeyRound,
  ShieldCheck,
  ScrollText,
  Diff,
  Palette,
  Clock,
};

export const MODULE_REGISTRY: ModuleMeta[] = [
  // ─── 原 11 个模块（保留原文案 + 拓展描述） ─────────────────────
  {
    id: "qrcode",
    name: "二维码",
    category: "tools",
    description: "文本 / URL / WiFi 一键生成二维码",
    longDescription:
      "把任意 UTF-8 字符串、URL、JSON、WiFi 配置（SSID/密码）等转成可扫描的二维码。编码完全在本地 Rust 端用 `qrcode` crate 完成，零网络依赖，零隐私泄露。\n\n支持 4 档容错率（L/M/Q/H），尺寸可调（128-1024 px），输出 SVG 矢量图（任何尺寸都清晰）。后续会加入颜色定制、Logo 嵌入、批量生成。",
    tags: ["纯本地", "SVG 矢量", "零网络"],
    icon: QrCode,
    path: "/modules/qrcode",
    status: "wip",
  },
  {
    id: "excel-to-json",
    name: "Excel → JSON",
    category: "tools",
    description: "把 Excel 表格转成结构化 JSON，支持多 sheet",
    longDescription:
      "解析 .xlsx / .xls / .xlsm 文件，每个 sheet 转成 JSON 数组，第一行作为表头。Rust 端用 `calamine` crate 直接读内存字节，**Apache POI 速度的 5-10 倍**。\n\n支持多 sheet 切换预览、导出单个 sheet 为独立 .json 文件。后续会加入字段类型推断、JSON Schema 导出、空单元格策略配置。",
    tags: ["calamine", "内存解析", "多 sheet"],
    icon: FileSpreadsheet,
    path: "/modules/excel-to-json",
    status: "wip",
  },
  {
    id: "excel-transpose",
    name: "Excel 转置",
    category: "tools",
    description: "行列互换 + 字段映射",
    longDescription:
      "把 Excel 表格行列互换，配合字段映射把横向数据转成纵向记录。常见用途：把「汇总宽表」转成「长表」喂给 BI 工具或数据库。",
    tags: ["待实现", "宽转长"],
    icon: Repeat,
    path: "/modules/excel-transpose",
    status: "planned",
  },
  {
    id: "file-treeview",
    name: "文件树",
    category: "files",
    description: "浏览本地目录结构，支持搜索和大文件过滤",
    longDescription:
      "高性能浏览本地目录，Rust 端用 `walkdir` 异步扫描，前端用虚拟列表渲染百万级条目不卡顿。\n\n支持按大小/时间过滤、glob 搜索、忽略规则（.gitignore 语法）。",
    tags: ["待实现", "虚拟列表", "walkdir"],
    icon: FolderTree,
    path: "/modules/file-treeview",
    status: "planned",
  },
  {
    id: "zip-clean",
    name: "Zip 清理",
    category: "files",
    description: "扫描并清理重复/空 zip 压缩包",
    longDescription:
      "扫描指定目录下的所有 .zip，找出：① 完全重复（CRC + 大小相同） ② 体积为 0 或内容为空的压缩包 ③ 同名重复版本（v1.zip / v1 (1).zip 这种）。一键归档到 `_velora_zip_trash/` 目录，不直接删，可回滚。",
    tags: ["待实现", "去重", "安全清理"],
    icon: FileArchive,
    path: "/modules/zip-clean",
    status: "planned",
  },
  {
    id: "xml-json",
    name: "XML ↔ JSON",
    category: "convert",
    description: "XML 与 JSON 双向互转",
    longDescription:
      "XML 与 JSON 双向互转，支持自定义根节点、属性处理策略（转字段或保留前缀）、CDATA、命名空间。适合 SOAP 接口对接、配置文件互转。",
    tags: ["待实现", "SOAP", "命名空间"],
    icon: ArrowLeftRight,
    path: "/modules/xml-json",
    status: "planned",
  },
  {
    id: "markitdown",
    name: "Markitdown",
    category: "convert",
    description: "把 PDF / Word / Excel 转成 Markdown",
    longDescription:
      "调外部 `markitdown` CLI（sidecar 模式），把 PDF / Word / Excel / PPT / 图片 OCR 转成结构化 Markdown。适合把「客户发来的文档」塞进 LLM 的上下文。",
    tags: ["待实现", "sidecar", "LLM 友好"],
    icon: FileText,
    path: "/modules/markitdown",
    status: "planned",
  },
  {
    id: "process-manager",
    name: "进程管理",
    category: "devtools",
    description: "查看本机进程、CPU/内存占用、结束进程",
    longDescription:
      "用 Rust 端 `sysinfo` crate 拉本机进程列表，按 CPU/内存/启动时间排序，搜索 PID / 名称 / 路径，一键结束进程（带二次确认）。\n\n数据每 2 秒刷新一次，比任务管理器更轻量、更易过滤。",
    tags: ["待实现", "sysinfo", "实时刷新"],
    icon: Cpu,
    path: "/modules/process-manager",
    status: "planned",
  },
  {
    id: "es-query",
    name: "ES 查询",
    category: "search",
    description: "Elasticsearch 可视化查询",
    longDescription:
      "连接 Elasticsearch 集群（多套环境可保存），可视化构建查询、查看结果分页、字段统计、保存常用查询。Rust 端用官方 `elasticsearch` 客户端。\n\n支持 DSL 模式和表单模式切换，结果可导出 JSON / CSV。",
    tags: ["待实现", "多集群", "DSL"],
    icon: Search,
    path: "/modules/es-query",
    status: "planned",
  },
  {
    id: "excel-schedule",
    name: "研发计划排期",
    category: "productivity",
    description: "Excel 排期 + 甘特图 + 多维度过滤 + Owner 统计",
    longDescription:
      "主力模块。功能：上传项目排期 Excel（多日期格式自动识别）→ 解析任务 / 负责人 / 工作类型 → 渲染甘特图 → 按类型/环节/责任人多维过滤 → 导出新 Excel。\n\n核心算法基于 `ScheduleEngine` + `OwnerStatsCalculator`，UI 用 `frappe-gantt` / `dhtmlx-gantt` 渲染。",
    tags: ["主力模块", "第 3 阶段", "几百人天级项目"],
    icon: GanttChartSquare,
    path: "/modules/excel-schedule",
    status: "planned",
  },
  {
    id: "preferences",
    name: "偏好设置",
    category: "system",
    description: "主题、快捷键、插件管理",
    longDescription:
      "全局偏好设置：主题切换（暗 / 亮 / 跟随系统）、语言、快捷键自定义、第三方插件启用 / 禁用、清理缓存、日志查看。",
    tags: ["待实现", "全局"],
    icon: Settings,
    path: "/modules/preferences",
    status: "planned",
  },

  // ─── 新增 7 个 dev-utility 模块 ──────────────────────────────────
  {
    id: "json-formatter",
    name: "JSON 格式化",
    category: "devtools",
    description: "实时格式化 / 校验 / 折叠展开 JSON",
    longDescription:
      "粘一段 JSON 进去，左边输入，右边立刻看到格式化结果和高亮。错误位置会在错误指针处精确给出，indent 2/4/Tab 切换、自动检测非法尾逗号、单引号转双引号。\n\n完全在浏览器本地完成，零网络。",
    tags: ["纯本地", "实时"],
    icon: Braces,
    path: "/modules/json-formatter",
    status: "ready",
  },
  {
    id: "regex-tester",
    name: "正则测试",
    category: "devtools",
    description: "实时高亮正则匹配 + capture group 表格",
    longDescription:
      "输入 pattern 和测试串，每按键一次实时匹配并把 hits 高亮在原文上。所有 capture group 表格展示，命中的 index 范围一目了然。flag 开关(i / m / s / x / u)即时生效。",
    tags: ["纯本地", "实时高亮"],
    icon: Regex,
    path: "/modules/regex-tester",
    status: "ready",
  },
  {
    id: "base64-codec",
    name: "Base64 编解码",
    category: "devtools",
    description: "文本 / 文件 与 Base64 互转，支持 URL-safe",
    longDescription:
      "标准 Base64 和 URL-safe Base64 双输出，文本编码与解码共用输入框，自动判断输入合法性，UTF-8 安全。",
    tags: ["纯本地"],
    icon: Binary,
    path: "/modules/base64-codec",
    status: "ready",
  },
  {
    id: "url-codec",
    name: "URL 编解码",
    category: "devtools",
    description: "encodeURI / encodeURIComponent 双向",
    longDescription:
      "一个框同时看 encodeURI 和 encodeURIComponent 的差异。带「URL 解析」子面板，把 query string 拆成 key/value 表。",
    tags: ["纯本地"],
    icon: Hash,
    path: "/modules/url-codec",
    status: "ready",
  },
  {
    id: "hash-tool",
    name: "哈希计算",
    category: "devtools",
    description: "md5 / sha1 / sha256 / sha512 / blake3 一键计算",
    longDescription:
      "输入文本或拖入文件，并行列出五种算法的 hex 结果，一键复制。流式计算大文件不卡 UI。",
    tags: ["纯本地"],
    icon: ShieldCheck,
    path: "/modules/hash-tool",
    status: "ready",
  },
  {
    id: "jwt-decoder",
    name: "JWT 解码",
    category: "devtools",
    description: "header / payload 一键查看，可选验签",
    longDescription:
      "粘一段 JWT token，自动分段展示 header / payload / signature，可选填 HS256 secret 或公钥对 RS256 验签，结果用 ✓/✗ 大字呈现。",
    tags: ["纯本地", "可选验签"],
    icon: KeyRound,
    path: "/modules/jwt-decoder",
    status: "ready",
  },
  {
    id: "uuid-gen",
    name: "UUID 生成",
    category: "devtools",
    description: "v1 / v4 / v5 一键批量生成",
    longDescription:
      "数量 spin 选定一次生成几个，版本切换 v1/v4/v5(v5 需要 namespace + name)。所有结果一行一个，蓝点点击单条复制，整列表可一键导出成 txt。",
    tags: ["纯本地", "批量"],
    icon: ScrollText,
    path: "/modules/uuid-gen",
    status: "ready",
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

/**
 * 过滤出启用的模块。默认所有模块启用；当用户在前端 Preferences 关掉时，
 * 会从 disabledModules 数组里剔除对应项。
 */
export function enabledModules(disabledIds: readonly string[]): ModuleMeta[] {
  if (disabledIds.length === 0) return MODULE_REGISTRY;
  const set = new Set(disabledIds);
  return MODULE_REGISTRY.filter((m) => !set.has(m.id));
}
