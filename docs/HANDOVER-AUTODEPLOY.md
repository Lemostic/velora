# Autodeploy 模块交接文档

> 写给后续接手的人：本模块当前在什么状态、还能做什么、哪些坑已经踩过。
> 上次更新：2026-09-04（v0.1.0 release 阶段）

---

## 1. 现状摘要

`自动化部署` 是一个 Node-RED 风格的工作流编辑器模块，给 Velora 加了 14 个内置节点，让用户能拖拽编排"压缩 → SFTP 上传"这种部署流水线。

| 维度 | 状态 |
| --- | --- |
| Rust 端命令骨架 | ✅ 完成（10 个原子节点 + 4 个控制流节点 = 14 个） |
| Rust 端实际执行 | ⚠️ local_* 完整可用，**SFTP 全部是 stub**（需 ssh crate） |
| 前端画布 + 节点 + 连线 | ✅ 完成（Pointer/Mouse events） |
| 前端执行引擎 | ✅ 拓扑排序 + 状态分发 + 失败重试（retry 是语义级） |
| Inspector 动态表单 | ✅ 完成（path / text / number / select / checkbox） |
| 右键菜单 | ✅ 完成（4 分组：新建 / 模板 / 视图 / 清空） |
| 持久化（localStorage） | ✅ workflow + viewport 自动保存 |
| 主题 | ✅ Element Plus 风格（#409eff 主色 / 4px 圆角 / system 字体） |
| 真 SFTP 执行 | ❌ 未实现（4 个 sftp_* 节点返回失败 + 占位错误） |
| 真 retry 循环 | ❌ 未实现（当前只标"重试策略已应用"，未做二次遍历） |
| 真 notify 系统通知 | ❌ 未实现（stub，等 tauri-plugin-notification 能力） |

---

## 2. 代码结构

```
src-tauri/src/modules/autodeploy.rs       # 后端：节点定义 + Tauri commands
src/routes/autodeploy/                    # 前端模块（独立子目录）
├── types.ts                               # 与后端对齐的类型
├── store.ts                               # Zustand store + FALLBACK_NODE_TYPES
├── lib/
│   ├── geometry.ts                        # 贝塞尔曲线、坐标变换
│   ├── topology.ts                        # Kahn 拓扑排序
│   ├── templates.ts                       # 3 个内置工作流模板
│   └── executor.ts                        # 前端执行器
└── components/
    ├── canvas.tsx                         # 画布（pan / zoom / drop / 拖拽）
    ├── library-panel.tsx                  # 左侧节点库
    ├── node-card.tsx                      # 单个节点 + PortHandle
    ├── connection-line.tsx                # SVG 连线
    ├── inspector.tsx                      # 右侧参数面板
    ├── top-toolbar.tsx                    # 顶部工具条
    ├── execute-panel.tsx                  # 底部日志
    └── field-input.tsx                    # Inspector 字段输入组件

src/routes/autodeploy-page.tsx            # 路由入口（layout 编排 + canvas ref 共享）
```

---

## 3. 14 个节点

| ID | 类别 | inputs / outputs | 备注 |
| --- | --- | --- | --- |
| `local_file` | source | 0 / 1 | 完整 |
| `local_dir` | source | 0 / 1 | 完整 |
| `local_archive` | source | 0 / 1 | 完整 |
| `compress` | process | 1 / 1 | 完整（zip crate） |
| `extract` | process | 1 / 1 | 完整（zip crate） |
| `copy` | process | 1 / 1 | 完整（fs::copy） |
| `sftp_upload` | transfer | 1 / 1 | **stub** |
| `sftp_download` | transfer | 0 / 1 | **stub**（之前错标为 1/1，已修） |
| `sftp_delete` | transfer | 0 / 0 | **stub**（之前错标为 1/1，已修） |
| `sftp_backup` | transfer | 0 / 0 | **stub**（之前错标为 1/1，已修） |
| `if_status` | process | 1 / 2 | 状态分支：上游 success → output 0 / failure → output 1 |
| `retry` | process | 1 / 1 | 字段 `max_retries` (3) / `retry_delay` (5s) — **当前只标语义，不做循环** |
| `end` | process | 1 / 0 | 标记工作流结束 |
| `notify` | process | 1 / 0 | 字段 `title` / `body` / `level` — **stub** |

---

## 4. 端口语义约定（再确认一次）

为了避免后端 / 前端 / Inspector 渲染之间的歧义，**这是当前写死的设计**：

- **SOURCES** 永远 `0 inputs / 1 output`（除了 delete / backup 是 `0/0`）
- **PROCESS** 永远 `1 input / 1 output`，除了 `if_status` (1/2)、`end` (1/0)、`notify` (1/0)
- **TRANSFER** 永远 `0 inputs`，输出按需：
  - upload: 1
  - download: 1（自起，不需上游）
  - delete / backup: 0（独立操作，不入流水线）

后续加新节点也按这个约定。如果出现 `1 input / 0 outputs` 的 process 节点，**没问题**（end / notify 就是）。

---

## 5. 三个模板

- `frontend-publish`：dist → compress → sftp_upload → notify(success) → end
- `backend-war-publish`：war → sftp_backup → sftp_delete → sftp_upload → **if_status**（成功 / 失败各发通知）→ end
- `robust-publish`：dist → compress → **retry**(3/5s) → sftp_upload → notify(success) / end

---

## 6. 拖拽系统踩过的坑（必读）

**最坑的是事件类型**：之前用 React `onPointerDown` + `setPointerCapture`，在 Playwright / 部分 WebView 下 pointer events 不可靠（pointerId 跨 drag 会变、合成事件不上抛）。当前统一改用 `onMouseDown` + 同步装 `window.addEventListener('mousemove' / 'mouseup')`。

**关键代码模式**（LibraryPanel + PortHandle 都用这个）：

```tsx
const onMouseDown = (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  // ... 同步装 window listener，不进 useEffect 异步 commit 陷阱
  function onMove(ev: MouseEvent) { /* ... */ }
  function onUp(ev: MouseEvent) {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    // 触发完成回调
  }
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
};
```

**别再退回 onPointerDown**——Tauri WebView 在 macOS / Linux 表现不一，统一 mouse events 是跨平台最稳的。

---

## 7. 已知问题

### 7.1 SFTP 是 stub
4 个 transfer 节点都返回：
```
"xxx：SFTP 后端待实现，需引入 ssh crate 才能真正联通服务器"
```

要接真后端，引入 `russh` 或 `ssh2` crate，在 `autodeploy.rs` 里替换 `sftp_stub` 函数。字段 `host` `user` `auth` `secret` `remote_path` `local_path` `backup_dir` 都已准备好。

### 7.2 retry 是语义级
`retry` 节点当前只标"重试策略已应用"，**不做实际循环**。完整实现需要第二次拓扑遍历：节点失败时，找它的所有上游 `retry` 节点，按 `max_retries` 字段重新执行失败的子树，每次间隔 `retry_delay` 秒。

当前替代方案：用户看到 retry 节点 success 标识，知道"重试已配置"，但实际下游失败时不会真的重试。

### 7.3 notify 是 stub
Rust 端 `control_notify` 只返回 metadata + 日志。要实发系统通知：
1. 在 `Cargo.toml` 启用 `tauri-plugin-notification`（当前是 tauri 2 自带，但需要 capabilities allow）
2. `control_notify` 内调 `app_handle.notification().builder().title(...).body(...).show()`
3. `level` 字段映射到 `NotificationKind::Info / Warning / Error` 等

### 7.4 视觉问题（待办）
- Inspector 节点参数摘要行（第 1 行）字体 11px，渲染中文时偏小
- 画布 dot grid 在缩放 50% 时太密（背景尺寸 28px × zoom）
- 空状态提示"右键新建"实际未在右键菜单显示对应内容——右键菜单的"新建节点"分组是固定列表，不依赖画布状态。这个文案是误导，需要改成"右键新建节点"

### 7.5 capabilities
当前 `src-tauri/capabilities/default.json` 允许了 `core:default` + `notification:default`，但 autodeply 的 notify 节点还是 stub。如果要实接通知，capabilities 已经准备好。

---

## 8. 怎么跑

### 开发
```bash
pnpm install
pnpm tauri dev          # 桌面调试（需要 WebView2，Windows 11 自带）
# 或
pnpm dev                # 只跑前端（vite 1420），Tauri 命令会失败但 UI 完整可用
```

### 打包
```bash
pnpm tauri build        # 5-15 分钟首次，1-2 分钟增量
# 产物：src-tauri/target/release/bundle/{msi,nsis}/
```

### 测试
```bash
# Rust 单元测试（4 个，autodeploy 模块）
cd src-tauri && cargo test --lib autodeploy

# TypeScript 类型检查
cd .. && pnpm tsc --noEmit
```

---

## 9. 后续可加的功能

按优先级：

1. **真 SFTP 后端**（替换 `sftp_stub`）—— ssh2 或 russh crate
2. **真 retry 循环**（executor.ts 二次遍历）—— 失败节点找 retry 上游，按字段重做
3. **真 notify 系统通知**（capabilities 已有，差 Rust 端调 plugin API）
4. **`parallel_split` 节点**（1 input / N outputs）—— 并行触发 N 条分支
5. **`shell` 节点**（0/1）—— 执行用户给的 shell 命令
6. **HTTP 节点**（fetch）
7. **工作流复制 / 导入 / 导出 JSON** —— 现在只能在浏览器 localStorage
8. **执行历史** —— 当前 logs 只在内存，刷新就丢；存 IndexedDB
9. **撤销 / 重做**（history stack）—— 加新节点 / 移动 / 删除都可 undo

---

## 10. 决策记录（重要）

- **Tauri 2 插件架构没用**：velora-core trait 已经定义但 P2 还没迁过去，autodeploy 直接在 `src-tauri/src/modules/autodeploy.rs` 写（与 qrcode / excel / weekly_report 同级）。原因是 velora-infra 还是空壳，HostServices trait 没有实现。autodeploy 用了 `invoke('autodeploy_execute', ...)` 直接拿后端数据，没走 trait 抽象。**迁 P2 架构时 autodeploy 是最难迁的**（节点定义 + executor + 模板都耦合了）。
- **没用 dnd-kit / reactflow / @xyflow**：自己实现 600 行的 canvas + library + port 拖拽。原因是这些库都基于 pointer events，在 Tauri WebView 表现不稳。自己的实现用 mouse events 跨平台稳。代价：约 600 行手写代码要维护。
- **没用 react-router 的 split** —— Velora 用 createBrowserRouter，所有模块都在一个 bundle 里（1.25MB / gzip 367KB），首屏 1 个 HTTP 请求。后续模块超过 30 个时考虑动态 import 拆 chunk。
- **FALLBACK_NODE_TYPES**：前端 hardcode 了 14 个节点定义，与后端 BUILTIN_NODES 一一对应。这是为了让 vite dev（无 Tauri runtime）下节点库也完整可用。**这两份必须同步改**，改后端 autodeploy.rs 时也要改前端 store.ts。

---

## 11. Commit 约定

- type 前缀保持英文（feat / fix / refactor / chore / docs）
- 冒号后第一个字符起全部中文（包括 title 和 body）
- 例：`feat(autodeploy): 加 4 个控制流节点（if_status / retry / end / notify）`

---

## 12. 联系

代码 owner: Lemostic
AI 助手: Mavis (Velora 项目协作者)
问题反馈：在 Velora 仓库 issue 中开。

下次接手建议从 `cargo test --lib autodeploy` 开始，确认 4 个测试都过，然后看本文件第 7 节"已知问题"挑一个做。
