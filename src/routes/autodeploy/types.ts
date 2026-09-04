// 自动化部署模块 — 前端类型
//
// 与 Rust 端 autodeploy.rs 的 NodeType / FieldDef 形状一致；
// 后端通过 autodeploy_list_node_types 返回这些数据。

export type NodeCategory = "source" | "process" | "transfer";

export type FieldKind = "text" | "path" | "number" | "select" | "checkbox";

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  name: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  placeholder?: string;
  default?: string;
  options?: FieldOption[];
}

export interface NodeType {
  id: string;
  category: NodeCategory;
  label: string;
  description: string;
  icon: string; // lucide 名
  inputs: number;
  outputs: number;
  fields: FieldDef[];
}

// 画布上的节点实例
export type NodeStatus = "idle" | "running" | "success" | "error" | "skipped";

export interface CanvasNode {
  id: string;
  type: string; // NodeType.id
  x: number;
  y: number;
  params: Record<string, string>;
  status: NodeStatus;
  message?: string;
}

// 节点之间的连线
export interface Connection {
  id: string;
  fromNode: string;
  fromPort: number; // 0-based
  toNode: string;
  toPort: number; // 0-based
}

// 视口（平移 + 缩放）
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

// 日志条目
export type LogLevel = "info" | "ok" | "warn" | "error";

export interface LogEntry {
  ts: number;
  level: LogLevel;
  nodeId?: string;
  message: string;
}

// 整体执行状态
export type RunState = "idle" | "running" | "success" | "error";

// 整个工作流的 JSON 形状（持久化用）
export interface Workflow {
  version: 1;
  name: string;
  nodes: CanvasNode[];
  connections: Connection[];
}

// 后端 execute 的返回
export interface ExecuteResult {
  ok: boolean;
  nodeId: string;
  message: string;
  output?: unknown;
  elapsedMs: number;
}

// 工作流模板
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  workflow: Workflow;
}
