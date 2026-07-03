# Velora

> A sleek, extensible desktop toolkit for seamless productivity. ⚡️ Open-source, cross-platform & plugin-ready.

Claude Desktop 风格的桌面工具箱。基于 **Tauri 2 + React 19 + Rust**，包体积 5-15MB、内存占用 1/5 Java 版本。

从 JavaFX/WorkbenchFX 实现的 [tool-suite](https://github.com/lemostic/tool-suite) 重写而来。

## ✨ 特性

- 🚀 **轻量** — Tauri 2 渲染，5-15MB 安装包，启动 <1s
- 🎨 **Claude Desktop 风格** — 左侧 NavRail + 顶部 Header + 暗色主题
- 🧩 **可插拔** — Rust 端模块化，前端按需懒加载
- 🔌 **官方 Tauri 插件** — fs、dialog、notification、store、shell、updater 全开
- 🦀 **Rust 后端** — 文件、Excel、SSH 等高负载任务在 Rust 里跑

## 📦 内置模块（首批）

| 模块 | 状态 | 说明 |
|---|---|---|
| 二维码 | ✅ | 文本/URL → SVG 二维码，零网络 |
| Excel → JSON | ✅ | xlsx 解析，每个 sheet 转 JSON |
| Excel 转置 | 🟡 | 规划中 |
| 文件树 / Zip 清理 | 🟡 | 规划中 |
| XML ↔ JSON / Markitdown | 🟡 | 规划中 |
| 进程管理 / ES 查询 | 🟡 | 规划中 |
| ⭐ 研发计划排期 | ⭐ | 阶段 3 重点迁入 |

## 🛠 环境要求

- **Rust** 1.70+ （[rustup.rs](https://rustup.rs)）
- **Node.js** 18+ （推荐 20 LTS）
- **pnpm** 9+（`npm i -g pnpm`）
- **Windows**：Visual Studio 2022 Build Tools（C++ 桌面开发）+ WebView2（Win10 1803+ 默认装）
- **macOS**：Xcode Command Line Tools
- **Linux**：webkit2gtk + libsoup

## 🚀 开发

```bash
# 装依赖
pnpm install

# 启动桌面开发模式（Vite HMR + Rust 监听）
pnpm tauri dev

# 类型检查
pnpm tsc --noEmit
cd src-tauri && cargo check
```

## 📦 构建

```bash
# 出 Windows MSI / NSIS 安装包（默认路径：src-tauri/target/release/bundle/）
pnpm tauri build

# 只构建前端
pnpm build
```

## 📁 目录结构

```
velora/
├── src/                  # React 前端
│   ├── components/       # UI 组件（ui 原子、nav 导航、layout 布局）
│   ├── routes/           # 路由页面
│   ├── store/            # Zustand
│   ├── lib/              # 工具 + registry
│   └── index.css         # Tailwind 4 + 设计 token
├── src-tauri/            # Rust 后端
│   ├── src/modules/      # 各模块的 command 实现
│   ├── capabilities/     # 权限白名单
│   └── tauri.conf.json
├── AGENTS.md             # AI 编程助手的项目说明
└── README.md
```

## 🤖 给 AI 编程助手

读 [`AGENTS.md`](./AGENTS.md) — 包含完整约定、模块清单、编码规范。

## 📜 License

MIT
