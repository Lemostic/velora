# AGENTS.md — Velora 项目协作说明

> 给所有 AI 编程助手（Claude Code、OpenCode、Codex 等）读的项目入口。
> 生成任何代码前请先读这个文件，再读 `.wolf/anatomy.md`（如有）。

## 这是什么

**Velora** — 一个 Claude Desktop 风格的桌面工具箱。从 JavaFX/WorkbenchFX
（[tool-suite](https://github.com/lemostic/tool-suite)）重写而来，技术栈换成
**Tauri 2 + React 19 + Rust**，目标包体积 5-15MB、内存 1/5 Java 版本。

## 技术栈（一句话版本）

- **桌面外壳**：Tauri 2（系统 WebView，不内嵌 Chromium）
- **前端**：React 19 + TypeScript + Vite 7
- **样式**：Tailwind CSS 4（CSS-first 配置，写在 `src/index.css`）
- **UI 组件**：shadcn/ui 模式（手写组件放在 `src/components/ui/`）
- **状态**：Zustand（带 localStorage 持久化）
- **路由**：React Router v7
- **图标**：lucide-react
- **后端**：Rust（写在 `src-tauri/src/`，Tauri commands 暴露给前端）
- **插件**：Tauri 官方插件（fs、dialog、notification、store、shell、updater、opener）
- **业务 crate**：qrcode（SVG）、calamine（Excel 解析）、base64

## 目录结构

```
velora/
├── src/                          # React 前端
│   ├── components/
│   │   ├── ui/                   # shadcn 风格原子组件（手写）
│   │   ├── nav/                  # NavRail 侧边栏
│   │   └── layout/               # AppShell, TopBar
│   ├── routes/                   # 路由页面（一个模块一个文件）
│   ├── store/                    # Zustand store
│   ├── lib/                      # 工具函数、registry、cn helper
│   ├── assets/                   # 图片、字体
│   ├── App.tsx                   # Router 配置
│   ├── main.tsx                  # React 入口
│   └── index.css                 # Tailwind 4 + 设计 token
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── main.rs               # 入口
│   │   ├── lib.rs                # 业务命令 + 插件注册
│   │   ├── modules/
│   │   │   ├── mod.rs
│   │   │   ├── registry.rs       # 静态模块清单（前后端共用语义）
│   │   │   ├── qrcode.rs         # QRCode 命令实现
│   │   │   └── excel.rs          # Excel→JSON 命令实现
│   │   └── plugins_ext/          # 未来按模块分文件的 commands
│   ├── capabilities/default.json # 权限白名单
│   ├── icons/
│   ├── Cargo.toml
│   └── tauri.conf.json
├── components.json               # shadcn/ui 配置
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
└── README.md
```

## 关键约定

### 1. 模块元数据 — 前后端共用语义

`src-tauri/src/modules/registry.rs`（Rust）和 `src/lib/registry.ts`（前端）
是**两份镜像**。两者必须保持 `id` 字符串一致：

- `qrcode`
- `excel-to-json`
- `excel-transpose`
- `file-treeview`
- `zip-clean`
- `xml-json`
- `markitdown`
- `process-manager`
- `es-query`
- `excel-schedule`
- `preferences`

新增模块时同时改两边。Category 也必须一致（`tools` / `files` / `convert` / `devtools` / `search` / `productivity` / `system`）。

### 2. Tauri command 命名

Tauri command 函数名 = 前端 `invoke()` 用的名字。**保持短名，无 `_cmd` 后缀**。
比如：

```rust
#[tauri::command]
fn qrcode_encode(req: QrEncodeRequest) -> Result<QrEncodeResult, VeloraError> { ... }
```

前端：

```ts
import { invoke } from "@tauri-apps/api/core";
const r = await invoke<EncodeResult>("qrcode_encode", { req: { ... } });
```

### 3. 错误处理

- Rust 端用 `VeloraError` 枚举（`thiserror`）
- `VeloraResult<T> = Result<T, VeloraError>`
- 命令返回 `Result<T, VeloraError>` 时，VeloraError 实现 `serde::Serialize` 把错误字符串传前端
- 前端 try/catch 时错误对象会是 string，直接显示

### 4. 状态管理

- 用 Zustand store（`src/store/app-store.ts`）
- 持久化用 `persist` middleware + `createJSONStorage(() => localStorage)`
- **不要**把所有状态都塞 store，本地组件状态用 `useState` 即可

### 5. 样式

- 用 Tailwind 4 utility class
- 颜色用 `bg-background` / `text-foreground` / `bg-card` / `text-primary` 等 semantic token
- **不要**写 `text-white` / `bg-black` 这种硬编码色
- 设计 token 定义在 `src/index.css` 的 `:root` 和 `.dark`

### 6. Tauri 权限

- 所有权限在 `src-tauri/capabilities/default.json` 白名单
- 用 `tauri-plugin-fs` 访问文件时必须先在 capabilities 里 allow 路径
- shell 调外部程序要 `shell:allow-open` + 限定 scope

## 常用命令

```bash
# 开发
pnpm tauri dev              # 启动桌面开发模式（Vite + Rust）
pnpm dev                    # 只跑前端

# 构建
pnpm tauri build            # 出 Windows MSI / NSIS 安装包
pnpm build                  # 只构建前端

# 类型检查
pnpm tsc --noEmit           # TS 检查
cd src-tauri && cargo check # Rust 检查（不编译）
cd src-tauri && cargo test  # Rust 单元测试
```

## 迁移进度（来自 tool-suite）

| 模块 | Java 路径 | Tauri 状态 |
|---|---|---|
| 二维码 | `modules/qrcode/` | ✅ Rust 命令 + UI 完成 |
| Excel → JSON | `modules/excel/json/` | ✅ Rust 命令 + UI 完成 |
| Excel 转置 | `modules/excel/transpose/` | 🟡 Coming Soon |
| XML ↔ JSON | `modules/convert/xmljson/` | 🟡 Coming Soon |
| 文件树 | `modules/file/treeview/` | 🟡 Coming Soon |
| Zip 清理 | `modules/file/zipclean/` | 🟡 Coming Soon |
| Markitdown | `modules/convert/markitdown/` | 🟡 Coming Soon |
| 进程管理 | `modules/devtools/processmanager/` | 🟡 Coming Soon |
| ES 查询 | `modules/search/es/` | 🟡 Coming Soon |
| **研发计划排期** | `modules/excel/schedule/` | ⭐ 计划第 3 阶段迁 |
| 偏好设置 | `modules/preferences/` | 🟡 Coming Soon |

## 编码风格

- **TypeScript strict**：`strict: true`、`noUnusedLocals: true`
- **Rust edition 2021**，`cargo fmt` + `cargo clippy` 必过
- **命名**：
  - TS 组件用 PascalCase 文件名 + 默认导出
  - TS 工具/函数用 camelCase
  - Rust 模块用 snake_case 文件名
- **注释**：业务逻辑加中文注释（这是国内项目），但 commit message 用英文
- **不要**塞 `console.log`，Rust 端用 `tracing::info!` / `tracing::error!`

## 不要做的事

- ❌ 不要把 secrets / API key 写进代码
- ❌ 不要用 `any` 滥用 TS 类型
- ❌ 不要硬编码颜色，主题切换会失效
- ❌ 不要在 `src-tauri/capabilities/default.json` 加 `*:*` 通配权限
- ❌ 不要直接复制 Java 版代码，**重新设计 Rust API**
- ❌ 不要忽略 Rust 编译警告，`cargo build` 必须零 warning

## 给 AI 的额外提示

- 修改前先看 `registry.ts` 和 `modules/registry.rs` 是否一致
- 加新模块时同步改：Rust registry + 前端 registry + 路由 + NavRail + 主页卡片
- 长文件用 `///` doc comment，公共 API 必须有
- 跨平台路径用 `std::path::PathBuf`，不要拼字符串
- 涉及文件 IO 用 `tokio::fs`（async），同步 IO 只在简单场景

## 插件架构（详见 `docs/ARCHITECTURE.md`）

Velora 后端已拆成 Cargo workspace（4 个 crate），目标是模块自包含 + 能力沙箱 + 第三方可扩展：

```
src-tauri/
├── Cargo.toml          # workspace root（velora-app + crates/*）
├── src/                # velora-app（Tauri 入口，极薄壳）
└── crates/
    ├── velora-core/    # ★ Module / HostServices / Capability / Command / Event 全部 trait
    ├── velora-infra/   # P3 填：HostServices 的 sqlx/reqwest/tokio 实现
    └── velora-modules/ # P2 填：QRCode/Excel 迁过来用新 trait
```

**新加模块的正确流程**：
1. 在 `velora-modules/src/<id>.rs` 实现 `Module` trait
2. 末尾加 `inventory::submit!(ModuleEntry::new(|| Box::new(MyModule)));`
3. 在 `src/lib/registry.ts` 加前端元数据
4. 完事，主入口 `lib.rs` / `App.tsx` / `NavRail` 都不动

**写新模块时**：
- 不要 `use reqwest` / `use sqlx` / `use tokio::fs` — 走 `host.http()` / `host.db()` / `host.fs()`
- 不要在 `velora-app` 加命令函数 — 在模块里 `Command::new(...)` 注册
- 错误用 `VeloraError::*` 变体，不要返回 `String`
- 跨模块通信用 `host.events().publish(Event::...)`

**当前阶段**：P1（velora-core trait）✅，P2（迁 QRCode/Excel）待办，P3-P8 待办。

