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
      nodeTypes: [],
      workflow: EMPTY_WORKFLOW,
      viewport: DEFAULT_VIEWPORT,
      selectedNodeId: null,
      runState: "idle",
      logs: [],

      loadNodeTypes: async () => {
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
