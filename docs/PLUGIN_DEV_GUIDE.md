# Velora Plugin Development Guide

> Quick-start companion to [ARCHITECTURE.md](./ARCHITECTURE.md).
> Read this if you want to add a new module. Read the architecture doc
> if you want to understand the design.

---

## TL;DR

Three places to touch when adding a new module, **all in one folder**:

1. **Rust** — `src-tauri/crates/velora-modules/src/<your-module>.rs`
2. **Frontend** — `src/modules/<your-id>/index.ts` + `page.tsx` + `api.ts`
3. **None of**: `App.tsx`, `lib.rs`, `NavRail`, `lib/registry.ts`

That's it. The runtime auto-discovers your module via
`inventory` (Rust) and `vite glob` (frontend). No registration calls,
no manual route wiring.

---

## 1. Backend module (Rust)

```rust
// src-tauri/crates/velora-modules/src/my_module.rs

use velora_core::prelude::*;

pub struct MyModule;

impl Module for MyModule {
    fn manifest(&self) -> &'static ModuleManifest {
        &ModuleManifest {
            id: "my-module",
            name: "我的工具",
            version: "0.1.0",
            author: "lemostic",
            category: ModuleCategory::Tools,
            description: "一行简介",
            long_description: "多段详细说明...",
            icon: "wrench",
            tags: &["alpha", "experimental"],
            menu_group: "工具",
            menu_group_order: 10,
            priority: 100,
            enabled_by_default: true,
            min_app_version: None,
        }
    }

    fn capabilities(&self) -> &'static [Capability] {
        &[
            Capability::FileSystem {
                paths: &["./data/**"],
                modes: &[FsMode::Read, FsMode::Write],
            },
            Capability::Network {
                hosts: &["api.example.com:443"],
            },
        ]
    }

    fn commands(&self) -> &'static [Command] {
        &[Command {
            name: "run",
            handler: my_module_run,
            args_schema: None,
            return_schema: None,
            description: "执行我的工具",
        }]
    }
}

fn my_module_run(
    host: &dyn HostServices,
    args: serde_json::Value,
) -> Result<serde_json::Value, VeloraError> {
    let req: MyRequest = serde_json::from_value(args)?;
    // 通过 host 拿所有依赖
    let data = host.fs().read(&req.path)?;
    let response = host.http().get("https://api.example.com/ping")?;
    Ok(serde_json::json!({ "ok": true }))
}

#[derive(serde::Deserialize)]
struct MyRequest {
    path: std::path::PathBuf,
}

inventory::submit!(ModuleEntry::new(|| Box::new(MyModule)));
```

**Don't** import `reqwest`, `sqlx`, `tokio::fs` directly — go through
`host`. That's the whole point.

---

## 2. Frontend module (React)

### 2.1 Folder layout

```
src/modules/my-module/
├── index.ts       # exports default ModuleDefinition
├── page.tsx       # route component (lazy)
├── api.ts         # typed client
├── components/    # private UI
├── hooks/         # private hooks
└── README.md      # shown in module long description
```

### 2.2 `api.ts` — typed client

```ts
import { callCommand } from "@/core/api";

export interface MyRequest {
  path: string;
}
export interface MyResult {
  ok: boolean;
  message?: string;
}

export const myModule = {
  run: (req: MyRequest) =>
    callCommand<MyResult>("my-module", "run", req),
};
```

### 2.3 `page.tsx` — route component

```tsx
import { useState } from "react";
import { ModuleHeader } from "@/components/module/module-header";
import { Button } from "@/components/ui/button";
import { myModule } from "./api";

export default function MyModulePage() {
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4 p-6">
      <ModuleHeader moduleId="my-module" />
      <Button onClick={async () => {
        const r = await myModule.run({ path: "./data/x.json" });
        setResult(r.message ?? "done");
      }}>
        运行
      </Button>
      {result && <p>{result}</p>}
    </div>
  );
}
```

### 2.4 `index.ts` — module contract

```ts
import { lazy } from "react";
import { Wrench } from "lucide-react";
import type { ModuleDefinition } from "@/core/module-contract";
import { myModule } from "./api";

export default {
  id: "my-module",
  name: "我的工具",
  category: "tools",
  description: "一行简介",
  longDescription: "多段详细说明...",
  icon: Wrench,
  tags: ["alpha"],
  path: "/modules/my-module",
  status: "wip",
  Page: lazy(() => import("./page")),
  api: myModule,
} satisfies ModuleDefinition;
```

**That's it.** `vite glob` picks it up, runtime registers it, NavRail
shows it, route works, API is typed.

---

## 3. Capability declarations

Declare what you need; users see and can revoke them in Preferences.

| Capability | Means |
|---|---|
| `FileSystem { paths, modes }` | Read/write/watch whitelisted paths |
| `Network { hosts }` | Make HTTP requests to whitelisted hosts |
| `Database { tables, mode }` | Query/insert whitelisted tables |
| `Shell { binaries }` | Spawn whitelisted binaries |
| `Process(ProcessMode)` | List / list+kill system processes |
| `Notification` | Send desktop notifications |
| `ConfigStore { namespace }` | Persist per-module config |
| `GlobalShortcut` | Register global hotkeys |
| `SystemTray` | Add tray menu items |
| `EventSubscription { topics }` | Receive events on whitelisted topics |

A module **cannot** access anything not declared. The host will
return `VeloraError::CapabilityDenied` and log the attempt.

---

## 4. Cross-module communication

### Emit
```rust
ctx.host.events().publish(Event::Custom {
    topic: "file:selected".into(),
    payload: json!({ "path": "/x.json" }),
})?;
```

### Subscribe (in another module's `on_event`)
```rust
fn on_event(&self, event: &Event) -> Result<(), VeloraError> {
    if let Event::Custom { topic, payload } = event {
        if topic == "file:selected" {
            // ...
        }
    }
    Ok(())
}
```

### Subscribe (stream)
```rust
let mut stream = ctx.host.events().subscribe("file:selected")?;
while let Some(event) = stream.next().await {
    // react in real time
}
```

---

## 5. Per-module configuration

If your module needs persistent settings:

```rust
fn config_schema(&self) -> Option<ConfigSchema> {
    Some(schemars::schema_for!(MyConfig))
}

fn on_init(&self, ctx: &ModuleContext) -> Result<(), VeloraError> {
    let cfg: MyConfig = ctx.host.config()
        .get("my-module.api_url")?
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    self.api_url = cfg.api_url;
    Ok(())
}
```

The Preferences page auto-generates a form for it.

---

## 6. Common mistakes

❌ **Don't** import `reqwest` / `sqlx` / `tokio::fs` directly.
Always go through `host.http()` / `host.db()` / `host.fs()`.

❌ **Don't** write to files outside your declared `FileSystem` paths.
You'll get `CapabilityDenied`.

❌ **Don't** spawn binaries outside your declared `Shell` list.

❌ **Don't** modify `App.tsx` or `lib/registry.ts`. Add a folder
under `src/modules/<id>/` and it auto-registers.

❌ **Don't** panic in `on_init` or command handlers. Return
`Err(VeloraError::Internal(...))` instead. The host will log
and surface the error to the UI.

---

## 7. External plugin (advanced)

Build a separate crate that depends on `velora-core`:

```toml
# my-plugin/Cargo.toml
[lib]
crate-type = ["cdylib"]

[dependencies]
velora-core = { path = "../../velora/crates/velora-core" }
```

```rust
// my-plugin/src/lib.rs
use velora_core::prelude::*;

pub struct MyPlugin;
impl Module for MyPlugin { /* same shape as built-in */ }

#[no_mangle]
pub extern "C" fn velora_plugin_entry() -> *mut dyn Module {
    Box::into_raw(Box::new(MyPlugin) as Box<dyn Module>)
}
```

Compile and drop the `.dll` / `.so` / `.dylib` into `<velora>/plugins/`.
Restart Velora — your plugin shows up in the nav rail and is fully
isolated by the capability sandbox.

---

## 8. Where to get help

- `docs/ARCHITECTURE.md` — full design rationale
- `src-tauri/crates/velora-core/src/` — trait definitions are the source of truth
- `src-tauri/crates/velora-modules/src/qrcode.rs` — minimal working example
- `src/modules/qrcode/` — minimal frontend example
