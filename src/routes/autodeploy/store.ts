// Autodeploy 的全局 store
//
// 设计要点：
//   1. 工作流（节点 + 连线）放在 store，方便任意组件读写；
//   2. 视口（平移 + 缩放）、选中状态、执行状态、日志也都放 store；
//   3. 工作流整体持久化到 localStorage（key 前缀 velora:autodeploy:*）；
//   4. 不持久化的：nodeTypes（启动时从后端拉）、logs、runState（运行时态）。

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import type {
  CanvasNode,
  LogEntry,
  NodeStatus,
  NodeType,
  RunState,
  Viewport,
  Workflow,
} from "./types";
import { BUILTIN_TEMPLATES } from "./lib/templates";

const PERSIST_KEY = "velora:autodeploy:workflow";

interface PersistShape {
  workflow: Workflow;
  viewport: Viewport;
}

// 非 Tauri 环境（vite dev / 单元测试）下的 fallback 节点定义，
// 与后端 autodeploy.rs 的 BUILTIN_NODES 一一对应。
const FALLBACK_NODE_TYPES: NodeType[] = [
  {
    id: "local_file",
    category: "source",
    label: "本地文件",
    description: "指定一个本地文件作为部署源",
    icon: "File",
    inputs: 0,
    outputs: 1,
    fields: [
      {
        name: "path",
        label: "文件路径",
        kind: "path",
        required: true,
        placeholder: "C:\\dist\\app.zip",
      },
    ],
  },
  {
    id: "local_dir",
    category: "source",
    label: "本地目录",
    description: "把一个目录作为整体作为部署源",
    icon: "FolderOpen",
    inputs: 0,
    outputs: 1,
    fields: [
      {
        name: "path",
        label: "目录路径",
        kind: "path",
        required: true,
        placeholder: "C:\\dist\\frontend",
      },
    ],
  },
  {
    id: "local_archive",
    category: "source",
    label: "本地压缩包",
    description: "从已有 zip / tar.gz 中挑选一个",
    icon: "FileArchive",
    inputs: 0,
    outputs: 1,
    fields: [
      {
        name: "path",
        label: "压缩包路径",
        kind: "path",
        required: true,
        placeholder: "C:\\dist\\release.zip",
      },
      {
        name: "strip_prefix",
        label: "去除顶层目录",
        kind: "text",
        required: false,
        placeholder: "dist/",
        default: "",
      },
    ],
  },
  {
    id: "compress",
    category: "process",
    label: "压缩",
    description: "把上游目录 / 文件压缩成 zip",
    icon: "FileArchive",
    inputs: 1,
    outputs: 1,
    fields: [
      {
        name: "output",
        label: "输出文件",
        kind: "path",
        required: true,
        placeholder: "C:\\dist\\release.zip",
      },
      {
        name: "level",
        label: "压缩级别",
        kind: "select",
        required: false,
        default: "deflate",
        options: [
          { value: "store", label: "不压缩" },
          { value: "deflate", label: "普通" },
          { value: "bzip2", label: "高压缩" },
        ],
      },
    ],
  },
  {
    id: "extract",
    category: "process",
    label: "解压",
    description: "把上游 zip 解压到指定目录",
    icon: "FolderOpen",
    inputs: 1,
    outputs: 1,
    fields: [
      {
        name: "output",
        label: "解压目录",
        kind: "path",
        required: true,
        placeholder: "C:\\dist\\unpacked",
      },
    ],
  },
  {
    id: "copy",
    category: "process",
    label: "复制",
    description: "复制上游文件 / 目录到新位置",
    icon: "Copy",
    inputs: 1,
    outputs: 1,
    fields: [
      {
        name: "output",
        label: "目标路径",
        kind: "path",
        required: true,
        placeholder: "D:\\backup",
      },
    ],
  },
  {
    id: "sftp_upload",
    category: "transfer",
    label: "SFTP 上传",
    description: "把上游文件 / 目录上传到远端",
    icon: "Upload",
    inputs: 1,
    outputs: 1,
    fields: [
      { name: "host", label: "服务器", kind: "text", required: true, placeholder: "10.20.30.40:22" },
      { name: "user", label: "用户名", kind: "text", required: true, placeholder: "deploy" },
      {
        name: "auth",
        label: "认证",
        kind: "select",
        required: true,
        default: "key",
        options: [
          { value: "password", label: "密码" },
          { value: "key", label: "私钥" },
        ],
      },
      { name: "secret", label: "凭据", kind: "text", required: true, placeholder: "从 credentials 选择" },
      { name: "remote_path", label: "远端目录", kind: "text", required: true, placeholder: "/var/www/app" },
    ],
  },
  {
    id: "sftp_download",
    category: "transfer",
    label: "SFTP 下载",
    description: "从远端拉文件回本地",
    icon: "Download",
    inputs: 1,
    outputs: 1,
    fields: [
      { name: "host", label: "服务器", kind: "text", required: true, placeholder: "10.20.30.40:22" },
      { name: "user", label: "用户名", kind: "text", required: true, placeholder: "deploy" },
      {
        name: "auth",
        label: "认证",
        kind: "select",
        required: true,
        default: "key",
        options: [
          { value: "password", label: "密码" },
          { value: "key", label: "私钥" },
        ],
      },
      { name: "secret", label: "凭据", kind: "text", required: true, placeholder: "从 credentials 选择" },
      { name: "remote_path", label: "远端文件", kind: "text", required: true, placeholder: "/var/log/app.log" },
      { name: "local_path", label: "本地路径", kind: "path", required: true, placeholder: "D:\\logs" },
    ],
  },
  {
    id: "sftp_delete",
    category: "transfer",
    label: "删除远端",
    description: "删除远端文件或目录",
    icon: "Trash2",
    inputs: 1,
    outputs: 1,
    fields: [
      { name: "host", label: "服务器", kind: "text", required: true, placeholder: "10.20.30.40:22" },
      { name: "user", label: "用户名", kind: "text", required: true, placeholder: "deploy" },
      {
        name: "auth",
        label: "认证",
        kind: "select",
        required: true,
        default: "key",
        options: [
          { value: "password", label: "密码" },
          { value: "key", label: "私钥" },
        ],
      },
      { name: "secret", label: "凭据", kind: "text", required: true, placeholder: "从 credentials 选择" },
      { name: "remote_path", label: "远端路径", kind: "text", required: true, placeholder: "/var/www/app/old" },
    ],
  },
  {
    id: "sftp_backup",
    category: "transfer",
    label: "备份远端",
    description: "远端文件 / 目录打包为带时间戳的 zip",
    icon: "ShieldCheck",
    inputs: 1,
    outputs: 1,
    fields: [
      { name: "host", label: "服务器", kind: "text", required: true, placeholder: "10.20.30.40:22" },
      { name: "user", label: "用户名", kind: "text", required: true, placeholder: "deploy" },
      {
        name: "auth",
        label: "认证",
        kind: "select",
        required: true,
        default: "key",
        options: [
          { value: "password", label: "密码" },
          { value: "key", label: "private key" },
        ],
      },
      { name: "secret", label: "凭据", kind: "text", required: true, placeholder: "从 credentials 选择" },
      { name: "remote_path", label: "远端路径", kind: "text", required: true, placeholder: "/var/www/app" },
      { name: "backup_dir", label: "备份目录", kind: "text", required: true, placeholder: "/var/backups" },
    ],
  },
];

// 检测 Tauri runtime 是否存在
const hasTauri = (): boolean =>
  typeof window !== "undefined" &&
  typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
    "undefined";

interface State {
  // 从后端拉的节点定义（不持久化）
  nodeTypes: NodeType[];
  // 工作流（持久化）
  workflow: Workflow;
  // 视口（持久化）
  viewport: Viewport;
  // 选中节点
  selectedNodeId: string | null;
  // 运行态（不持久化）
  runState: RunState;
  logs: LogEntry[];

  // 启动
  loadNodeTypes: () => Promise<void>;
  // 工作流编辑
  addNode: (type: string, x: number, y: number) => string;
  moveNode: (id: string, x: number, y: number) => void;
  removeNode: (id: string) => void;
  selectNode: (id: string | null) => void;
  updateNodeParam: (nodeId: string, key: string, value: string) => void;
  renameWorkflow: (name: string) => void;
  // 连线
  addConnection: (
    from: string,
    fromPort: number,
    to: string,
    toPort: number,
  ) => void;
  removeConnection: (id: string) => void;
  // 视口
  setViewport: (vp: Partial<Viewport>) => void;
  // 模板
  applyTemplate: (templateId: string) => void;
  resetWorkflow: () => void;
  // 执行
  setNodeStatus: (
    id: string,
    status: NodeStatus,
    message?: string,
  ) => void;
  setRunState: (s: RunState) => void;
  appendLog: (entry: Omit<LogEntry, "ts">) => void;
  clearLogs: () => void;
}

function makeId(prefix = "n"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

const EMPTY_WORKFLOW: Workflow = {
  version: 1,
  name: "新建工作流",
  nodes: [],
  connections: [],
};

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

export const useAutodeployStore = create<State>()(
  persist(
    (set, get) => ({
      nodeTypes: FALLBACK_NODE_TYPES,
      workflow: EMPTY_WORKFLOW,
      viewport: DEFAULT_VIEWPORT,
      selectedNodeId: null,
      runState: "idle",
      logs: [],

      loadNodeTypes: async () => {
        if (!hasTauri()) {
          // 非 Tauri 环境（vite dev / 浏览器预览）：用前端 hardcoded
          set({ nodeTypes: FALLBACK_NODE_TYPES });
          return;
        }
        try {
          const list = await invoke<NodeType[]>("autodeploy_list_node_types");
          set({ nodeTypes: list });
        } catch (e) {
          set({
            logs: [
              {
                ts: Date.now(),
                level: "error",
                message: `加载节点定义失败：${String(e)}`,
              },
            ],
          });
        }
      },

      addNode: (type, x, y) => {
        const id = makeId("n");
        const def = get().nodeTypes.find((n) => n.id === type);
        const params: Record<string, string> = {};
        if (def) {
          for (const f of def.fields) {
            params[f.name] = f.default ?? "";
          }
        }
        const node: CanvasNode = {
          id,
          type,
          x,
          y,
          params,
          status: "idle",
        };
        set((s) => ({
          workflow: { ...s.workflow, nodes: [...s.workflow.nodes, node] },
          selectedNodeId: id,
        }));
        return id;
      },

      moveNode: (id, x, y) => {
        set((s) => ({
          workflow: {
            ...s.workflow,
            nodes: s.workflow.nodes.map((n) =>
              n.id === id ? { ...n, x, y } : n,
            ),
          },
        }));
      },

      removeNode: (id) => {
        set((s) => ({
          workflow: {
            ...s.workflow,
            nodes: s.workflow.nodes.filter((n) => n.id !== id),
            connections: s.workflow.connections.filter(
              (c) => c.fromNode !== id && c.toNode !== id,
            ),
          },
          selectedNodeId:
            s.selectedNodeId === id ? null : s.selectedNodeId,
        }));
      },

      selectNode: (id) => set({ selectedNodeId: id }),

      updateNodeParam: (nodeId, key, value) => {
        set((s) => ({
          workflow: {
            ...s.workflow,
            nodes: s.workflow.nodes.map((n) =>
              n.id === nodeId
                ? { ...n, params: { ...n.params, [key]: value } }
                : n,
            ),
          },
        }));
      },

      renameWorkflow: (name) => {
        set((s) => ({ workflow: { ...s.workflow, name } }));
      },

      addConnection: (from, fromPort, to, toPort) => {
        // 同节点不自连；同目标端口已存在则替换
        if (from === to) return;
        const id = makeId("c");
        set((s) => ({
          workflow: {
            ...s.workflow,
            connections: [
              ...s.workflow.connections.filter(
                (c) => !(c.toNode === to && c.toPort === toPort),
              ),
              { id, fromNode: from, fromPort, toNode: to, toPort },
            ],
          },
        }));
      },

      removeConnection: (id) => {
        set((s) => ({
          workflow: {
            ...s.workflow,
            connections: s.workflow.connections.filter((c) => c.id !== id),
          },
        }));
      },

      setViewport: (vp) => {
        set((s) => ({ viewport: { ...s.viewport, ...vp } }));
      },

      applyTemplate: (templateId) => {
        const tpl = BUILTIN_TEMPLATES.find((t) => t.id === templateId);
        if (!tpl) return;
        set({
          workflow: structuredClone(tpl.workflow),
          selectedNodeId: null,
          logs: [],
          runState: "idle",
        });
      },

      resetWorkflow: () => {
        set({
          workflow: { ...EMPTY_WORKFLOW },
          selectedNodeId: null,
          logs: [],
          runState: "idle",
        });
      },

      setNodeStatus: (id, status, message) => {
        set((s) => ({
          workflow: {
            ...s.workflow,
            nodes: s.workflow.nodes.map((n) =>
              n.id === id ? { ...n, status, message } : n,
            ),
          },
        }));
      },

      setRunState: (s) => set({ runState: s }),

      appendLog: (entry) => {
        set((s) => ({
          logs: [
            ...s.logs,
            { ...entry, ts: Date.now() } as LogEntry,
          ].slice(-500), // 最多保留 500 行
        }));
      },

      clearLogs: () => set({ logs: [] }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => localStorage),
      // 只持久化工作流和视口
      partialize: (s): PersistShape => ({
        workflow: s.workflow,
        viewport: s.viewport,
      }),
      version: 1,
    },
  ),
);

// 选中导出便捷 selector
export const useSelectedNode = (): CanvasNode | null => {
  return useAutodeployStore((s) => {
    if (!s.selectedNodeId) return null;
    return s.workflow.nodes.find((n) => n.id === s.selectedNodeId) ?? null;
  });
};
