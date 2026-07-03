import { motion } from "framer-motion";
import { Check, Palette, RotateCcw, Sliders, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { ModuleHeader } from "@/components/module/module-header";
import {
  PADDING_CLASSES,
  PADDING_OPTIONS,
  PAGE_CONTAINER_CLASS,
  type PaddingKey,
} from "@/lib/spacing";

export function PreferencesPage() {
  const contentPadding = useAppStore((s) => s.contentPadding);
  const theme = useAppStore((s) => s.theme);
  const setContentPadding = useAppStore((s) => s.setContentPadding);
  const setTheme = useAppStore((s) => s.setTheme);
  const recentModules = useAppStore((s) => s.recentModules);

  return (
    <div
      className={cn(
        PAGE_CONTAINER_CLASS,
        "gap-8",
        PADDING_CLASSES[contentPadding],
      )}
    >
      <ModuleHeader moduleId="preferences" />

      {/* Layout preview — visualizes the current padding scale */}
      <PaddingPreview value={contentPadding} />

      {/* Padding scale segmented control */}
      <SettingsGroup
        title="内容边距"
        description="控制主区域四周的留白。值越大，文字行越短，阅读越舒适；值越小，每屏能展示更多内容。"
        icon={<Sliders className="h-4 w-4" />}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {PADDING_OPTIONS.map((opt) => {
            const active = opt.value === contentPadding;
            return (
              <button
                key={opt.value}
                onClick={() => setContentPadding(opt.value)}
                className={cn(
                  "group relative flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all",
                  active
                    ? "border-primary/50 bg-primary/[0.06] shadow-glow"
                    : "border-border/60 bg-card/40 hover:border-border hover:bg-card/70",
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <span
                    className={cn(
                      "text-sm font-medium tracking-tight",
                      active ? "text-foreground" : "text-foreground/80",
                    )}
                  >
                    {opt.label}
                  </span>
                  {active && (
                    <motion.span
                      layoutId="padding-active"
                      className="grid h-4 w-4 place-items-center rounded-full bg-primary text-primary-foreground"
                      transition={{ type: "spring", stiffness: 300, damping: 24 }}
                    >
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    </motion.span>
                  )}
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {opt.description}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsGroup>

      {/* Theme */}
      <SettingsGroup
        title="主题"
        description="应用整体配色方案。暗色是 Velora 的默认。"
        icon={<Palette className="h-4 w-4" />}
      >
        <div className="grid grid-cols-3 gap-2">
          {(["dark", "light", "system"] as const).map((t) => {
            const active = t === theme;
            return (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={cn(
                  "rounded-lg border p-3 text-sm font-medium tracking-tight transition-all",
                  active
                    ? "border-primary/50 bg-primary/[0.06]"
                    : "border-border/60 bg-card/40 hover:border-border hover:bg-card/70",
                )}
              >
                {t === "dark" ? "暗色" : t === "light" ? "亮色" : "跟随系统"}
              </button>
            );
          })}
        </div>
      </SettingsGroup>

      {/* Recent modules */}
      <SettingsGroup
        title="最近使用"
        description="按访问顺序排列，最多 8 个。"
        icon={<Sparkles className="h-4 w-4" />}
      >
        {recentModules.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card/30 p-6 text-center text-sm text-muted-foreground">
            还没有访问过模块。打开任意模块后会出现在这里。
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {recentModules.map((id) => (
              <span
                key={id}
                className="rounded-full border border-border/60 bg-background/40 px-2.5 py-0.5 font-mono text-[11px] tracking-tight text-muted-foreground"
              >
                {id}
              </span>
            ))}
          </div>
        )}
      </SettingsGroup>

      {/* Reset */}
      <div className="flex items-center justify-end">
        <ResetButton />
      </div>
    </div>
  );
}

function PaddingPreview({ value }: { value: PaddingKey }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-card/30 shadow-diffusion-sm">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
          实时预览
        </span>
        <span className="font-mono text-[10px] text-muted-foreground/60">
          {PADDING_OPTIONS.find((o) => o.value === value)?.description}
        </span>
      </div>
      <div className="bg-[radial-gradient(oklch(0.27_0_0/0.3)_1px,transparent_1px)] [background-size:12px_12px] p-4">
        <div
          className={cn(
            "rounded-xl border border-dashed border-primary/40 bg-primary/[0.04] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
            PADDING_CLASSES[value],
          )}
        >
          <div className="space-y-1.5">
            <div className="h-2 w-1/3 rounded-full bg-foreground/30" />
            <div className="h-1.5 w-2/3 rounded-full bg-foreground/15" />
            <div className="h-1.5 w-1/2 rounded-full bg-foreground/15" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsGroup({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card/30 p-5 shadow-diffusion-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border/60 bg-background/40 text-foreground/80">
          {icon}
        </div>
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}

function ResetButton() {
  const reset = () => {
    useAppStore.setState({
      contentPadding: 10,
      theme: "dark",
      sidebarCollapsed: false,
      recentModules: [],
    });
  };
  return (
    <button
      onClick={reset}
      className="group flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/40 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/[0.06] hover:text-destructive"
    >
      <RotateCcw className="h-3 w-3 transition-transform group-hover:-rotate-45" />
      恢复默认设置
    </button>
  );
}
