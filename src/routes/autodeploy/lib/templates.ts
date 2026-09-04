// 内置工作流模板
//
// 提供两个常见发布场景作为起始模板，用户加载后可以微调。

import type { Workflow, WorkflowTemplate } from "../types";

const FRONTEND_PUBLISH: Workflow = {
  version: 1,
  name: "前端页面发布",
  nodes: [
    {
      id: "n_src",
      type: "local_dir",
      x: 80,
      y: 80,
      params: { path: "" },
      status: "idle",
    },
    {
      id: "n_zip",
      type: "compress",
      x: 380,
      y: 80,
      params: { output: "", level: "deflate" },
      status: "idle",
    },
    {
      id: "n_upload",
      type: "sftp_upload",
      x: 680,
      y: 80,
      params: {
        host: "",
        user: "",
        auth: "key",
        secret: "",
        remote_path: "/var/www/app",
      },
      status: "idle",
    },
  ],
  connections: [
    { id: "c1", fromNode: "n_src", fromPort: 0, toNode: "n_zip", toPort: 0 },
    {
      id: "c2",
      fromNode: "n_zip",
      fromPort: 0,
      toNode: "n_upload",
      toPort: 0,
    },
  ],
};

const BACKEND_WAR_PUBLISH: Workflow = {
  version: 1,
  name: "后端 War 发布",
  nodes: [
    {
      id: "n_war",
      type: "local_file",
      x: 80,
      y: 80,
      params: { path: "" },
      status: "idle",
    },
    {
      id: "n_backup",
      type: "sftp_backup",
      x: 380,
      y: 80,
      params: {
        host: "",
        user: "",
        auth: "key",
        secret: "",
        remote_path: "/var/www/app",
        backup_dir: "/var/backups",
      },
      status: "idle",
    },
    {
      id: "n_delete",
      type: "sftp_delete",
      x: 680,
      y: 80,
      params: {
        host: "",
        user: "",
        auth: "key",
        secret: "",
        remote_path: "/var/www/app/old",
      },
      status: "idle",
    },
    {
      id: "n_upload",
      type: "sftp_upload",
      x: 980,
      y: 80,
      params: {
        host: "",
        user: "",
        auth: "key",
        secret: "",
        remote_path: "/var/www/app",
      },
      status: "idle",
    },
  ],
  connections: [
    {
      id: "c1",
      fromNode: "n_war",
      fromPort: 0,
      toNode: "n_backup",
      toPort: 0,
    },
    {
      id: "c2",
      fromNode: "n_backup",
      fromPort: 0,
      toNode: "n_delete",
      toPort: 0,
    },
    {
      id: "c3",
      fromNode: "n_delete",
      fromPort: 0,
      toNode: "n_upload",
      toPort: 0,
    },
  ],
};

export const BUILTIN_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "frontend-publish",
    name: "前端页面发布",
    description: "本地 dist 目录 → 压缩 → SFTP 上传到服务器",
    workflow: FRONTEND_PUBLISH,
  },
  {
    id: "backend-war-publish",
    name: "后端 War 发布",
    description: "本地 war → 远端备份 → 删旧版本 → 上传新版本",
    workflow: BACKEND_WAR_PUBLISH,
  },
];
