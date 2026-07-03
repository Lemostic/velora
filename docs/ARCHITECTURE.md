# Velora Plugin Architecture — Design Document

> Status: **proposal**, awaiting user sign-off.
> Goal: turn Velora from a 2-module demo into a maintainable, extensible
> plugin platform where every tool (and every shared dependency) is a
> well-typed, decoupled, independently versionable unit.

---

## 1. 现状评估（Why this rewrite is needed）

| 问题 | 现在的样子 | 后果 |
|---|---|---|
| Rust 模块元数据硬编码 | `src-tauri/src/modules/registry.rs::builtin()` 返回 11 条静态 `ModuleMeta` | 加模块要改主入口文件，registry 散落多处 |
| Rust 命令直接挂在 `lib.rs` | `qrcode_encode_cmd`, `excel_to_json_cmd` 全写在 `lib.rs` 上方 | `tauri::generate_handler!` 宏手动列每条命令，10 条以上就失控 |
| 前端模块元数据镜像硬编码 | `src/lib/registry.ts` 跟 Rust 端是手写副本 | 两边对不上没人发现，bug 滋生 |
| 前端路由硬编码 | `src/App.tsx` 写死 11 条 `<Route>` | 加模块改 4 个文件（registry.rs + registry.ts + App.tsx + NavRail） |
| 模块没有依赖注入 | QRCode 直接 `use calamine`，Excel 直接 `use calamine` | 想统一换 DB / HTTP client / FS watcher 不可能 |
| 没有 Capability 概念 | 模块想用啥用啥 | 安全审计无从下手 |
| 没有事件总线 | 模块间不能通信 | 选了文件想给另一个模块用，要走"主程序" 中转 |
| 没有统一错误 | 各模块自己 try-catch，返回 `String` 错误 | 前端只能看到 `"decode failed"`，无类型 |
| 没有统一日志 | 用 `tracing` 但散乱 | 跨模块调用无法串联 span |
| 没有外部插件机制 | 编译期确定 | 第三方开发者没法独立发布插件 |
| 没有"模块可以声明自己的 config" | Preferences 页面写死几个字段 | 加新模块要改主偏好设置页 |

参考原 `tool-suite` 的设计（`@ToolModule` 注解 + `BaseToolModule` 抽象类 + `ToolModuleProvider` SPI + `SpiModuleLoader` ServiceLoader 扫描 + `ModuleRegistry`），思路是对的，但 Java SPI 在 Tauri/Rust 工程里**不能直接搬**，需要用 Rust 的 `inventory` + `libloading`（或者编译期 `#[ctor]`）重新实现等价物。

---

## 2. 设计目标

1. **每个模块完全自包含** — 加新模块只动 1 个新文件夹（crate + 模块文件夹），不碰主入口
2. **核心抽象稳定** — `velora-core` 一旦发布，破坏性变更需要 major version
3. **依赖通过接口注入** — 模块不直接 `use reqwest` / `use sqlx`，而是拿 `host.http()` / `host.db()`
4. **Capability 显式声明** — 模块说自己要用啥，宿主在加载时校验
5. **统一错误 / 统一日志 / 统一事件** — 跨模块可观测性零成本
6. **外部插件可加载** — `plugins/` 目录下的 `.so` / `.dll` / `.dylib` 运行时加载
7. **前端完全数据驱动** — `vite glob` 自动发现模块，路由 / 侧栏自动生成
8. **向下兼容** — 现有 QRCode / Excel 模块可以平滑迁移到新接口，主程序 API 表面不变

---

## 3. 目标 Workspace 布局

```
velora/
├── Cargo.toml                      # workspace root
├── docs/
│   ├── ARCHITECTURE.md             # 本文档
│   └── PLUGIN_DEV_GUIDE.md         # 插件开发者文档
├── src/                            # React 前端（不变）
└── src-tauri/                      # Tauri 集成层
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/
    └── crates/
        ├── velora-core/            # 零依赖：trait + 错误 + manifest
        │   ├── Cargo.toml
        │   └── src/
        │       ├── lib.rs
        │       ├── module.rs       # Module trait
        │       ├── manifest.rs     # ModuleManifest
        │       ├── capability.rs   # Capability 枚举
        │       ├── command.rs      # Command + CommandHandler
        │       ├── host.rs         # HostServices trait
        │       ├── context.rs      # ModuleContext
        │       ├── event.rs        # Event enum + EventBus trait
        │       └── error.rs        # VeloraError
        │
        ├── velora-infra/           # HostServices 的具体实现
        │   ├── Cargo.toml
        │   └── src/
        │       ├── lib.rs
        │       ├── host.rs         # DefaultHostServices
        │       ├── db.rs           # SqliteDatabase (sqlx)
        │       ├── http.rs         # ReqwestHttpClient
        │       ├── fs.rs           # TokioFsAccess + NotifyWatcher
        │       ├── shell.rs        # TokioShellAccess (受限)
        │       ├── events.rs       # BroadcastEventBus
        │       ├── config.rs       # StoreConfigStore (tauri-plugin-store)
        │       └── notify.rs       # NotificationSink
        │
        ├── velora-modules/         # 11 个内置模块
        │   ├── Cargo.toml
        │   └── src/
        │       ├── lib.rs          # 收集所有 inventory 提交
        │       ├── qrcode.rs
        │       ├── excel.rs
        │       ├── schedule.rs
        │       └── ...
        │
        └── velora-app/             # Tauri 入口（极薄壳）
            ├── Cargo.toml
            └── src/
                ├── main.rs
                ├── loader.rs        # 扫描 plugins/ + inventory
                ├── bridge.rs        # 把 Command 暴露给 tauri::generate_handler
                └── runtime.rs       # 给前端 list_modules / app_info
```

依赖方向（强约束，不可逆）：

```
velora-app  →  velora-modules  →  velora-infra  →  velora-core
                                                       ↑
                                                  velora-modules 也依赖 core
```

`velora-core` 零业务依赖（只 `serde` + `thiserror` + `tracing`）。

---

## 4. 核心抽象（velora-core）

### 4.1 `Module` trait

```rust
pub trait Module: Send + Sync + 'static {
    /// 静态元数据，编译期确定
    fn manifest(&self) -> &'static ModuleManifest;

    /// 声明需要的能力（宿主在 init 时校验）
    fn capabilities(&self) -> &'static [Capability] { &[] }

    /// 注册的 Tauri commands
    fn commands(&self) -> &'static [Command] { &[] }

    /// 可选：声明持久化配置 schema
    fn config_schema(&self) -> Option<ConfigSchema> { None }

    /// 启动时调用，host 上下文已就绪
    fn on_init(&self, _ctx: &ModuleContext) -> Result<(), VeloraError> { Ok(()) }

    /// 关闭时调用（应用退出 / 模块被禁用）
    fn on_shutdown(&self) -> Result<(), VeloraError> { Ok(()) }

    /// 接收其它模块/前端发布的事件
    fn on_event(&self, _event: &Event) -> Result<(), VeloraError> { Ok(()) }
}
```

### 4.2 `ModuleManifest`

```rust
pub struct ModuleManifest {
    pub id: &'static str,                  // "qrcode"
    pub name: &'static str,                // "二维码"
    pub version: &'static str,             // semver
    pub author: &'static str,
    pub category: ModuleCategory,
    pub description: &'static str,
    pub long_description: &'static str,
    pub icon: &'static str,                // lucide name
    pub tags: &'static [&'static str],
    pub menu_group: &'static str,
    pub menu_group_order: u32,
    pub priority: u32,                     // 加载顺序
    pub enabled_by_default: bool,
    pub min_app_version: Option<&'static str>,
}

pub enum ModuleCategory {
    Tools, Files, Convert, DevTools,
    Search, Productivity, System, Network, Database,
}
```

### 4.3 `Capability`（细粒度权限）

```rust
pub enum Capability {
    /// 文件系统：白名单路径 + 允许的操作
    FileSystem {
        paths: &'static [&'static str],
        modes: &'static [FsMode],            // Read, Write, Watch
    },
    /// 网络：白名单 host:port 模式
    Network {
        hosts: &'static [&'static str],     // glob, e.g. "*.example.com:443"
    },
    /// 数据库：允许的表 / 视图
    Database {
        tables: &'static [&'static str],
        mode: DbMode,                        // ReadOnly | ReadWrite
    },
    /// Shell：允许的二进制 + 参数模板
    Shell {
        binaries: &'static [&'static str],
    },
    /// 进程管理
    Process(ProcessMode),                   // List, ListAndKill
    /// 通知
    Notification,
    /// 持久化配置（带命名空间）
    ConfigStore { namespace: &'static str },
    /// 全局快捷键
    GlobalShortcut,
    /// 系统托盘
    SystemTray,
    /// 跨模块事件订阅
    EventSubscription { topics: &'static [&'static str] },
}
```

用户在 Preferences 页面可以看到所有模块声明的能力，可单独撤销。

### 4.4 `Command` + `CommandHandler`

```rust
pub type CommandHandler = fn(
    host: &dyn HostServices,
    args: serde_json::Value,
) -> Result<serde_json::Value, VeloraError>;

pub struct Command {
    pub name: &'static str,
    pub handler: CommandHandler,
    /// 可选：参数 schema（用于前端自动生成表单）
    pub args_schema: Option<JsonSchema>,
    /// 可选：返回 schema
    pub return_schema: Option<JsonSchema>,
    /// 描述（给前端 hover tooltip 用）
    pub description: &'static str,
}
```

简单同步 handler 够用；未来可加 `AsyncCommandHandler` 给长任务。

### 4.5 `HostServices`（依赖注入的根）

```rust
pub trait HostServices: Send + Sync {
    fn db(&self) -> &dyn DatabaseAccess;
    fn http(&self) -> &dyn HttpClient;
    fn fs(&self) -> &dyn FileSystemAccess;
    fn shell(&self) -> &dyn ShellAccess;
    fn events(&self) -> &dyn EventBus;
    fn config(&self) -> &dyn ConfigStore;
    fn notify(&self) -> &dyn NotificationSink;
    fn log(&self, scope: &str) -> Box<dyn LogSink>;
    fn shortcuts(&self) -> &dyn ShortcutRegistry;
    fn tray(&self) -> &dyn TrayBuilder;
}
```

每个模块在 init 时拿到 `&ModuleContext`，ctx 里有 `host: &dyn HostServices`。模块要用啥就调啥，**没有直接依赖**。

### 4.6 各 host trait 签名

```rust
pub trait DatabaseAccess: Send + Sync {
    fn query(&self, sql: &str, params: &[DbValue]) -> Result<Vec<Row>, VeloraError>;
    fn execute(&self, sql: &str, params: &[DbValue]) -> Result<u64, VeloraError>;
    fn transaction<F, R>(&self, f: F) -> Result<R, VeloraError>
    where F: FnOnce(&mut dyn Transaction) -> Result<R, VeloraError>;
}

pub trait HttpClient: Send + Sync {
    fn get(&self, url: &str) -> Result<Response, VeloraError>;
    fn post(&self, url: &str, body: &[u8]) -> Result<Response, VeloraError>;
    fn get_json<T: DeserializeOwned>(&self, url: &str) -> Result<T, VeloraError>;
}

pub trait FileSystemAccess: Send + Sync {
    fn read(&self, path: &Path) -> Result<Vec<u8>, VeloraError>;
    fn write(&self, path: &Path, data: &[u8]) -> Result<(), VeloraError>;
    fn watch(&self, path: &Path) -> Result<Box<dyn Watcher>, VeloraError>;
    fn metadata(&self, path: &Path) -> Result<FsMetadata, VeloraError>;
}

pub trait ShellAccess: Send + Sync {
    fn exec(&self, cmd: &str, args: &[&str]) -> Result<ExecOutput, VeloraError>;
    /// 启动 sidecar binary（Velora 控制其生命周期）
    fn sidecar(&self, name: &str) -> Result<SidecarHandle, VeloraError>;
}

pub trait EventBus: Send + Sync {
    fn publish(&self, event: Event) -> Result<(), VeloraError>;
    fn subscribe(&self, topic: &str) -> Result<EventStream, VeloraError>;
}

pub trait ConfigStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<JsonValue>, VeloraError>;
    fn set(&self, key: &str, value: JsonValue) -> Result<(), VeloraError>;
    fn delete(&self, key: &str) -> Result<(), VeloraError>;
    fn list(&self, prefix: &str) -> Result<Vec<(String, JsonValue)>, VeloraError>;
    /// 监听 key 变化
    fn watch(&self, key: &str) -> Result<ConfigStream, VeloraError>;
}

pub trait NotificationSink: Send + Sync {
    fn info(&self, title: &str, body: &str) -> Result<(), VeloraError>;
    fn warn(&self, title: &str, body: &str) -> Result<(), VeloraError>;
    fn error(&self, title: &str, body: &str) -> Result<(), VeloraError>;
}
```

### 4.7 `Event`（跨模块通信）

```rust
pub enum Event {
    FileSelected { path: PathBuf },
    DatabaseChanged { table: String },
    ModuleEnabled { id: String },
    ModuleDisabled { id: String },
    ConfigChanged { key: String, value: JsonValue },
    ThemeChanged { from: Theme, to: Theme },
    ShortcutTriggered { id: String },
    Custom { topic: String, payload: JsonValue },
}
```

模块订阅用 topic 字符串（`"file:selected"`），发和收解耦。

### 4.8 `VeloraError`（统一错误）

```rust
pub enum VeloraError {
    ModuleNotFound { id: String },
    CapabilityDenied { capability: String, module: String },
    Database { source: sqlx::Error },
    Network { source: reqwest::Error },
    FileSystem { path: PathBuf, source: std::io::Error },
    Shell { binary: String, source: std::io::Error },
    Serialization { source: serde_json::Error },
    PluginLoad { path: PathBuf, source: BoxError },
    InvalidArgument { name: String, reason: String },
    Internal(String),
}

impl Serialize for VeloraError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        // 输出结构化 JSON：{ kind, message, context }
        ...
    }
}
```

前端能拿到结构化错误，能根据 `kind` 字段本地化提示。

### 4.9 注册机制（`inventory` crate）

```rust
// core/src/registry.rs
pub struct ModuleEntry {
    pub factory: fn() -> Box<dyn Module>,
}

impl ModuleEntry {
    pub const fn new(factory: fn() -> Box<dyn Module>) -> Self {
        Self { factory }
    }
}

inventory::collect!(ModuleEntry);
```

模块实现：
```rust
// modules/qrcode/src/lib.rs
pub struct QrCodeModule;
impl Module for QrCodeModule { ... }

inventory::submit!(ModuleEntry::new(|| Box::new(QrCodeModule)));
```

主程序加载：
```rust
for entry in inventory::iter::<ModuleEntry> {
    let module = (entry.factory)();
    runtime.register(module)?;
}
```

---

## 5. velora-infra（HostServices 实现）

每个 trait 一个文件，文件结构：

```
infra/src/
├── lib.rs
├── host.rs        # DefaultHostServices { db, http, fs, ... }
├── db/
│   ├── mod.rs
│   ├── sqlite.rs   # 默认实现
│   └── memory.rs   # 测试用
├── http/
│   ├── mod.rs
│   └── reqwest.rs
├── fs/
│   ├── mod.rs
│   ├── tokio.rs
│   └── notify.rs   # 监听文件变化
├── shell/
│   ├── mod.rs
│   └── sandbox.rs  # 白名单 + 资源限制
├── events/
│   ├── mod.rs
│   └── broadcast.rs
├── config/
│   ├── mod.rs
│   └── store.rs    # tauri-plugin-store 包装
├── notify/
│   ├── mod.rs
│   └── tauri.rs
├── log/
│   ├── mod.rs
│   └── tracing.rs
├── shortcut/
│   └── tauri.rs
└── tray/
    └── tauri.rs
```

**关键设计**：
- `DefaultHostServices::new()` 用 `Arc` 持有所有 impl，可 clone
- 所有 impl 都是 `Send + Sync`（Tauri 多线程要求）
- `infra` 是 `core` 的 **唯一** 实现，模块不直接 `use sqlx` / `use reqwest`
- 测试时用 `MockHostServices` 替换

**例：DB 注入的实际好处**

之前 Excel 模块要写数据库的话：
```rust
// 旧：模块自己处理 MySQL/H2
use mysql_async::Pool;
// 加 connection pool 初始化、连接管理、错误处理 ...
```

新架构：
```rust
// 新：模块拿 host.db() 就能用
fn on_init(&self, ctx: &ModuleContext) -> Result<(), VeloraError> {
    let rows = ctx.host.db().query(
        "SELECT * FROM schedules WHERE project_id = ?",
        &[42.into()],
    )?;
    Ok(())
}
```

用户换 MySQL → Postgres → SQLite 只在 `infra` 里改 impl，**所有模块零改动**。

---

## 6. velora-app（极薄壳）

```rust
// app/src/main.rs
fn main() {
    let host = Arc::new(DefaultHostServices::new(AppPaths::new()));
    let mut runtime = Runtime::new(host);

    // 1. 加载内置模块（inventory 自动收集）
    for entry in inventory::iter::<ModuleEntry> {
        runtime.load_builtin((entry.factory)())?;
    }

    // 2. 扫描外部 plugins/ 目录
    runtime.load_external(PathBuf::from("./plugins"))?;

    // 3. 启动所有模块
    runtime.init_all()?;

    // 4. 启动 Tauri
    tauri::Builder::default()
        .plugin(...)
        .manage(runtime)
        .invoke_handler(tauri::generate_handler![
            app_info,
            list_modules,
            get_module,
            set_module_enabled,
            call_command,    // 通用命令调用入口
        ])
        .run(tauri::generate_context!())?;
}
```

**关键命令**：

- `app_info` — 返回 AppInfo（含 runtime 统计）
- `list_modules` — 返回所有已注册模块的 manifest 数组
- `get_module(id)` — 返回单个模块的详细 manifest
- `set_module_enabled(id, enabled)` — 启用/禁用模块
- `call_command(module_id, command_name, args)` — 通用调用入口（前端不用为每个模块写专门 invoke）

`call_command` 模式让前端不用关心每个模块的 Tauri command 名，按统一协议调用：
```ts
const result = await callCommand("qrcode", "encode", { text: "...", size: 320 });
```

但为了**类型安全 + IDE 提示**，可以用 codegen 生成 typed client：
```ts
// codegen/velora-client.ts
export const qrcode = {
  encode: (req: QrEncodeRequest) =>
    callCommand<EncodeResult>("qrcode", "encode", req),
};
```

---

## 7. 前端模块化（src/）

### 7.1 模块契约

```ts
// src/core/module-contract.ts
import type { ComponentType, LazyExoticComponent } from "react";
import type { LucideIcon } from "lucide-react";
import type { ModuleCategory } from "./registry";

export interface ModuleDefinition {
  /** 必须与 Rust ModuleManifest.id 一致 */
  id: string;
  name: string;
  category: ModuleCategory;
  description: string;
  longDescription?: string;
  icon: LucideIcon;
  tags?: string[];
  path: string;
  status?: "ready" | "wip" | "planned";
  /** 路由组件，必须是 lazy */
  Page: LazyExoticComponent<ComponentType>;
  /** 模块可声明 API client（自动生成或手写） */
  api?: Record<string, (...args: unknown[]) => Promise<unknown>>;
  /** 可选：能力展示（用户偏好里能看到） */
  capabilities?: CapabilityDescriptor[];
}
```

### 7.2 自动发现

```ts
// src/core/plugin-registry.ts
const modules = import.meta.glob<{ default: ModuleDefinition }>(
  "/src/modules/*/index.ts",
  { eager: true },
);

export const moduleRegistry: ModuleDefinition[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.category.localeCompare(b.category));
```

Vite 把 `/src/modules/*/index.ts` 都打到 bundle 里，**新加模块不需要改主入口**。

### 7.3 动态路由

```ts
// src/App.tsx
import { moduleRegistry } from "@/core/plugin-registry";
import { lazy, Suspense } from "react";

const routes = moduleRegistry.map((m) => ({
  path: m.path,
  element: (
    <Suspense fallback={<ModuleLoading name={m.name} />}>
      <m.Page />
    </Suspense>
  ),
}));

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      ...routes,
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
```

### 7.4 自动侧栏

```ts
// src/components/nav/nav-rail.tsx
import { moduleRegistry } from "@/core/plugin-registry";

const grouped = groupByCategory(moduleRegistry);
// 直接渲染，无需在 NavRail 里手写 11 个项目
```

### 7.5 一个模块的完整结构

```
src/modules/qrcode/
├── index.ts          # 导出 default ModuleDefinition
├── page.tsx          # 路由组件
├── api.ts            # typed client: qrcode.encode(req) → invoke(...)
├── components/       # 模块私有 UI（不在主 components/ui 里）
├── hooks/            # 模块私有 hooks
└── README.md         # 模块说明（自动被 ModuleHeader 读取）
```

`api.ts` 用 `callCommand`：
```ts
import { callCommand } from "@/core/api";

export const qrcode = {
  encode: (text: string, size = 320, ec: "L"|"M"|"Q"|"H" = "M") =>
    callCommand<EncodeResult>("qrcode", "encode", { text, size, errorCorrection: ec }),
};
```

`index.ts`：
```ts
import { lazy } from "react";
import { QrCode } from "lucide-react";
import type { ModuleDefinition } from "@/core/module-contract";
import { qrcode } from "./api";

export default {
  id: "qrcode",
  name: "二维码",
  category: "tools",
  description: "文本 / URL / WiFi 一键生成二维码",
  longDescription: "...",
  icon: QrCode,
  tags: ["纯本地", "SVG 矢量", "零网络"],
  path: "/modules/qrcode",
  status: "wip",
  Page: lazy(() => import("./page")),
  api: qrcode,
} satisfies ModuleDefinition;
```

**加新模块 = 新建一个文件夹**，主入口零修改。

### 7.6 共享 API 层（src/core/）

```
src/core/
├── api.ts                # callCommand + invoke 包装
├── plugin-registry.ts    # vite glob 自动发现
├── module-contract.ts    # ModuleDefinition interface
├── capability.ts         # 前端 capability 展示
├── error.ts              # VeloraError 解析 + 国际化
├── theme.ts              # useTheme (已有, 移到 core)
├── store.ts              # 全局 zustand stores
└── codegen/              # 可选：Rust → TS 类型生成
    └── client.ts         # 自动生成的 typed client
```

---

## 8. 依赖管理（CRITICAL：这是用户问的重点）

### 8.1 当前问题

每个模块各自 import 各自用的 crate：
- `qrcode.rs` → `use qrcode; use base64;`
- `excel.rs` → `use calamine;`
- 未来 `schedule.rs` → `use chrono; use regex; use ...`
- `process-manager.rs` → `use sysinfo;`
- `es-query.rs` → `use elasticsearch;`
- `ssh-tool.rs` → `use russh;`

后果：
- 重复依赖（不同版本难协调）
- 编译时间指数增长
- 安全审计散落
- 加新模块要看懂每个模块用啥

### 8.2 解决方案：基础设施层 + Capability 注入

**原则**：模块 **不直接 import** 任何 infra crate，只通过 `host.xxx()` 接口。

**实际能落地的策略**：

| 依赖类型 | 做法 | 例子 |
|---|---|---|
| **HTTP 客户端** | 通过 `host.http()` 拿，所有模块共享一个 `reqwest::Client` 实例 | `es-query` 调 ES，`webhook-tester` 调 webhook，都走 `host.http()` |
| **数据库** | 通过 `host.db()` 拿统一 SQLite/MySQL 连接池 | `schedule`、`process-manager`（保存历史）都走 `host.db()` |
| **Excel 解析** | 提供 host trait 扩展 `excel(): &dyn ExcelEngine` | `qrcode` 不需要，但 `schedule` 和 `excel-to-json` 都用 |
| **文件系统** | 通过 `host.fs()` | `file-treeview`、`zip-clean` 都用 |
| **进程管理** | 通过 `host.processes()` (新 trait) | `process-manager` 用，可复用给未来的 `port-monitor` |
| **SSH** | 通过 `host.ssh()` | `ssh-tool`、`remote-deploy` 都用 |
| **通知 / 进度条** | 通过 `host.notify()` | 所有长任务模块用，UI 统一弹 |
| **配置存储** | 通过 `host.config()` | 所有模块的偏好存这里 |

### 8.3 Cargo workspace 集中管理

```toml
# Cargo.toml (workspace root)
[workspace]
resolver = "2"
members = [
    "src-tauri/crates/velora-core",
    "src-tauri/crates/velora-infra",
    "src-tauri/crates/velora-modules",
    "src-tauri/crates/velora-app",
]

[workspace.dependencies]
# 业务 crate
qrcode = "0.14"
calamine = "0.26"
base64 = "0.22"
chrono = { version = "0.4", features = ["serde"] }
regex = "1"
sysinfo = "0.32"
elasticsearch = "8.5.0-alpha.1"
russh = "0.44"
sqlx = { version = "0.8", features = ["runtime-tokio", "sqlite", "mysql", "chrono"] }
reqwest = { version = "0.12", features = ["json", "rustls-tls"] }
tokio = { version = "1", features = ["full"] }
notify = "6"
notify-rust = "4"

# 核心 crate
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
tracing = "0.1"
inventory = "0.3"
async-trait = "0.1"
schemars = "0.8"
```

每个子 crate 只用 `crate-name.workspace = true`：
```toml
# velora-modules/Cargo.toml
[dependencies]
velora-core = { path = "../velora-core" }
velora-infra = { path = "../velora-infra" }
qrcode = { workspace = true }
calamine = { workspace = true }
```

**好处**：
- 依赖版本 100% 锁定
- 加新 crate 改 1 处
- `cargo update` 一处生效
- 未来想换 `reqwest` → `ureq` 改 1 处

### 8.4 前端依赖同样集中

`package.json` 已经走 workspace 模式，加新依赖就 `pnpm add xxx@^x`，各模块子目录里 `import { } from "xxx"` 即可，无需每个模块自带 package.json。

---

## 9. 模块发现 / 加载机制

### 9.1 Rust 端：双层加载

```rust
// app/src/loader.rs
pub struct Loader {
    builtin: Vec<Box<dyn Module>>,
    external: Vec<ExternalModule>,
    host: Arc<DefaultHostServices>,
}

pub struct ExternalModule {
    manifest: ModuleManifest,
    path: PathBuf,
    lib: Arc<libloading::Library>,
}

impl Loader {
    pub fn load_all() -> Result<Self, VeloraError> {
        let mut s = Self::default();
        // 内置
        for entry in inventory::iter::<ModuleEntry> {
            let module = (entry.factory)();
            s.builtin.push(module);
        }
        // 外部
        s.external = Self::scan_external(Path::new("./plugins"))?;
        Ok(s)
    }

    fn scan_external(dir: &Path) -> Result<Vec<ExternalModule>, VeloraError> {
        let mut out = vec![];
        if !dir.exists() { return Ok(out); }
        for entry in fs::read_dir(dir)? {
            let path = entry?.path();
            if path.extension() != Some(OsStr::new(PLUGIN_EXT)) { continue; }
            let plugin = ExternalModule::load(&path)?;
            out.push(plugin);
        }
        Ok(out)
    }
}
```

### 9.2 外部插件编译协议

外部插件是个独立 Rust crate，编译为 `cdylib`：
```toml
# my-plugin/Cargo.toml
[lib]
crate-type = ["cdylib"]

[dependencies]
velora-core = { git = "...", version = "0.1" }
```

```rust
// my-plugin/src/lib.rs
use velora_core::prelude::*;

pub struct MyModule;
impl Module for MyModule { ... }

// 导出符号：Velora 加载器通过这个名字找到 entry
#[no_mangle]
pub extern "C" fn velora_plugin_entry() -> *mut dyn Module {
    Box::into_raw(Box::new(MyModule) as Box<dyn Module>)
}
```

**注意**：`Box<dyn Module>` 是 trait object，跨 dylib 边界需要 dyn-compatible trait。需要在 core 里设计成 dyn-safe（不能有泛型方法、不能有 Self: Sized 等）。

### 9.3 前端发现

Vite glob（无需运行时）：
```ts
const modules = import.meta.glob("/src/modules/*/index.ts", { eager: true });
// 加新模块只动 src/modules/ 目录，主程序零修改
```

---

## 10. 能力 / 权限 / 偏好设置

模块启动时 host 校验声明的 Capability。Preferences 页面新增"插件管理"section：

- 列出所有模块
- 每个模块显示：版本、作者、描述、声明的 capabilities
- 每个 capability 有 toggle（撤销 / 授予）
- 模块的"启用 / 禁用"开关
- "重置全部" 按钮

```tsx
// PreferencesPage 未来会有的样子
<ModuleManager
  modules={runtime.listModules()}
  capabilities={runtime.listCapabilities()}
  onToggle={(moduleId, enabled) => runtime.setModuleEnabled(moduleId, enabled)}
  onRevokeCapability={(moduleId, cap) => runtime.revokeCapability(moduleId, cap)}
/>
```

---

## 11. 错误处理 / 日志 / 事件

### 11.1 错误

```rust
// 模块里
let result = ctx.host.db().query(sql, &[]).map_err(|e| {
    tracing::error!(module = "schedule", sql, "query failed: {e}");
    e
})?;
```

错误序列化为结构化 JSON 传到前端：
```json
{
  "kind": "Database",
  "message": "connection refused",
  "context": { "module": "schedule", "command": "list_projects" }
}
```

前端 `core/error.ts` 把 `kind` 映射到中文提示。

### 11.2 日志

所有 host 调用自动 wrap 在 `tracing::span!` 里：
```rust
#[tracing::instrument(skip(host), fields(module = self.manifest().id))]
fn on_init(&self, host: &dyn HostServices) -> Result<(), VeloraError> { ... }
```

输出格式：
```
2026-07-04T15:30:00 INFO  velora.app loader: starting Velora v0.1.0
2026-07-04T15:30:00 INFO  velora.modules.qrcode on_init{module="qrcode"}: enter
2026-07-04T15:30:00 INFO  velora.modules.qrcode on_init{module="qrcode"}: ok in 2ms
```

### 11.3 事件

模块 A 发：
```rust
ctx.host.events().publish(Event::FileSelected { path })?;
```

模块 B 收（在自己的 on_event 里）：
```rust
fn on_event(&self, event: &Event) -> Result<(), VeloraError> {
    if let Event::FileSelected { path } = event {
        self.last_file = Some(path.clone());
    }
    Ok(())
}
```

或订阅 stream：
```rust
let mut stream = ctx.host.events().subscribe("file:selected")?;
while let Some(event) = stream.next().await {
    // ...
}
```

---

## 12. 测试策略

| 层 | 测试方法 | 工具 |
|---|---|---|
| `velora-core` trait | 单元测试 trait 边界 | `cargo test` |
| `velora-infra` impl | 集成测试用 mock host + 真实 impl | `#[tokio::test]` |
| `velora-modules` 每个 | 单元测试业务逻辑 | 注入 `MockHostServices` |
| 端到端 | 跑 velora.exe 自动化 | `tauri-driver` + `playwright` |
| 前端模块 | vitest + RTL | `vitest`, `@testing-library/react` |

Mock host：
```rust
pub struct MockHostServices {
    pub db: MockDb,
    pub http: MockHttp,
    pub fs: MockFs,
    // ...
}

impl HostServices for MockHostServices { ... }
```

---

## 13. 实施路线（6 阶段）

| 阶段 | 内容 | 估时 | 依赖 |
|---|---|---|---|
| **P1 内核抽象** | 写 `velora-core`（trait + manifest + capability + error + event） | 1-2 周 | — |
| **P2 模块迁移** | QRCode + Excel 用新接口重写（核心 2 个跑通新模式） | 1 周 | P1 |
| **P3 基础设施** | `velora-infra`（DB/HTTP/FS/Shell/Event/Notify/Config 实现） | 1-2 周 | P1 |
| **P4 Workspace 拆分** | 把现在 `src-tauri` 单 crate 拆成 4 个 crate | 3-5 天 | P1-P3 |
| **P5 前端模块化** | `vite glob` 自动发现 + 动态路由 + 模块契约 | 3-5 天 | — |
| **P6 外部插件** | `plugins/` 目录扫描 + `libloading` 加载 | 1-2 周 | P1, P2 |
| **P7 扩展点** | 全局快捷键、托盘菜单、命令面板、事件订阅 | 1 周 | P3, P6 |
| **P8 文档 + 模板** | `docs/PLUGIN_DEV_GUIDE.md` + `create-velora-plugin` 脚手架 | 3-5 天 | P6 |

**总估时**：6-8 周全职，或 3-4 个月兼职。

### 推荐切入点

如果想**最低风险、最大收益**开始：
- 先做 **P1 + P2**（2-3 周）：核心 trait 跑通，QRCode/Excel 验证模式
- 然后 **P3**（1-2 周）：基础设施有了
- 然后 **P4**（3-5 天）：拆 workspace（这步可以提前到 P2 之前做）
- 然后 **P5**（3-5 天）：前端自动发现
- 然后看需求决定要不要 P6（外部插件）

**P6 是"杀手锏"功能**，但实现成本最高（要解决 dylib 跨边界、ABI 稳定性、安全沙箱）。如果只需要"内置模块解耦"，P1-P5 就够了。

---

## 14. 与原 tool-suite 的对比

| 维度 | tool-suite (JavaFX) | velora v0.1 (现在) | velora v2 (本设计) |
|---|---|---|---|
| 模块发现 | `ServiceLoader` SPI | 硬编码 | `inventory` (内置) + `libloading` (外部) |
| 模块抽象 | `BaseToolModule` extends `WorkbenchModule` | 散乱 | `impl Module` trait |
| 元数据 | `@ToolModule` 注解 | 硬编码 Vec | `ModuleManifest` struct (单源) |
| 分类 | `ModuleCategory` enum | string union | 强类型 enum |
| 依赖注入 | `Preferences` 单例 | 直接 import | `HostServices` trait |
| 错误处理 | 自定义 exception | 字符串错误 | `VeloraError` enum (结构化) |
| 事件 | 无 | 无 | `EventBus` trait |
| 外部插件 | 写 META-INF/services + 打包 jar | 编译期 | dylib 运行时加载 |
| Capability 声明 | 无 | 无 | 强类型 + 偏好设置可撤销 |
| 跨模块通信 | 静态调用 | 不支持 | EventBus pub/sub |
| 测试 | 单测 + JavaFX TestFX | 零测试 | mock host + e2e |
| 工具链 | Maven 多模块 | 单 crate | Cargo workspace + 工具宏 |

**关键升级**：从"Java 反射 + SPI" → "Rust trait + inventory + libloading"，**类型安全**+**零运行时反射**+**原生性能**。

---

## 15. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 跨 dylib 边界的 trait object ABI 不稳定 | 锁定 `velora-core` semver；core 不变，插件随便升级 |
| 用户禁用某个 capability 但模块硬要 | host 调用前校验 → 返 `CapabilityDenied` 错误，前端提示 |
| 模块 panic 拖垮主程序 | 每个 `on_init` / `commands` 都在 `catch_unwind` 里调用，错误隔离 |
| 模块加载慢拖累启动 | 懒加载：模块不在视口时不调 `on_init`，路由进入才初始化 |
| 第三方插件恶意操作 | capability 沙箱 + 文件路径白名单 + shell 二进制白名单 |
| 配置文件 schema 演化 | `config_schema` 跟随 Rust struct 走，前端表单自动生成 |
| 事件总线背压 | `tokio::broadcast` 有界 channel + backpressure 处理 |
| 日志洪水 | 模块可声明 `log_level`，runtime 过滤 |

---

## 16. 下一步

等用户确认：
1. **整体方向是否 OK**？
2. **从哪一阶段开始**？推荐先 P1 + P2（风险最低、收益最高）
3. **P6 外部插件要不要做**？（要的话需要 P1-P3 全部完成）
4. **是否需要 codegen**（Rust → TS 类型生成）？
5. **P8 文档/脚手架**是否需要立刻做（给未来插件作者看）？

确认后我会把对应阶段的任务拆成 todo 推进。
