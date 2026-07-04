import { motion } from "framer-motion";
import { Check, Palette, RotateCcw, Sliders, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { ModuleHeader } from "@/components/module/module-header";
import {
  PADDING_MAX,
  PADDING_MIN,
  PADDING_PRESETS,
  PADDING_STEP,
  PAGE_CONTAINER_CLASS,
  clampPadding,
  isUniformPadding,
  paddingToStyle,
  type PagePadding,
} from "@/lib/spacing";

export function PreferencesPage() {
  const contentPadding = useAppStore((s) => s.contentPadding);
  const theme = useAppStore((s) => s.theme);
  const setContentPadding = useAppStore((s) => s.setContentPadding);
  const resetContentPadding = useAppStore((s) => s.resetContentPadding);
  const setTheme = useAppStore((s) => s.setTheme);
  const recentModules = useAppStore((s) => s.recentModules);

  return (
    <div className={cn(PAGE_CONTAINER_CLASS, "gap-8")} style={paddingToStyle(contentPadding)}>
      <ModuleHeader moduleId="preferences" />

      {/* Live preview — visualises the current vertical/horizontal padding */}
      <PaddingPreview value={contentPadding} />

      {/* Preset row + per-axis sliders */}
      <SettingsGroup
        title="内容边距"
        description="分别控制主区域上下边距和左右边距。上下保持一致、左右保持一致。值越大阅读越舒适；值越小每屏能展示更多内容。点击预设可一键填入，或拖动滑块微调。"
        icon={<Sliders className="h-4 w-4" />}
      >
        <PaddingEditor value={contentPadding} onChange={setContentPadding} />
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
      <div className="flex items-center justify-end gap-2">
        {!isUniformPadding(contentPadding) && (
          <span className="text-[11px] text-muted-foreground">
            上下 ≠ 左右 — 预设不会高亮
          </span>
        )}
        <ResetButton onReset={resetContentPadding} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live preview
// ---------------------------------------------------------------------------

function PaddingPreview({ value }: { value: PagePadding }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-card/30 shadow-diffusion-sm">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
          实时预览
        </span>
        <span className="font-mono text-[10px] text-muted-foreground/60">
          上下 {value.vertical}px · 左右 {value.horizontal}px
        </span>
      </div>
      <div className="bg-[radial-gradient(oklch(0.27_0_0/0.3)_1px,transparent_1px)] [background-size:12px_12px] p-4">
        <div
          className="mx-auto h-48 max-w-md rounded-xl border border-dashed border-border/60 bg-background/30 transition-[padding] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={paddingToStyle(value)}
        >
          <div className="h-full rounded-lg border border-dashed border-primary/40 bg-primary/[0.04] p-3">
            <div className="space-y-1.5">
              <div className="h-2 w-1/3 rounded-full bg-foreground/30" />
              <div className="h-1.5 w-2/3 rounded-full bg-foreground/15" />
              <div className="h-1.5 w-1/2 rounded-full bg-foreground/15" />
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                <div className="h-3 rounded bg-foreground/10" />
                <div className="h-3 rounded bg-foreground/10" />
                <div className="h-3 rounded bg-foreground/10" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preset row + per-axis editor
// ---------------------------------------------------------------------------

function PaddingEditor({
  value,
  onChange,
}: {
  value: PagePadding;
  onChange: (next: PagePadding) => void;
}) {
  const update = (patch: Partial<PagePadding>) =>
    onChange(clampPadding({ ...value, ...patch }));

  return (
    <div className="flex flex-col gap-5">
      {/* Preset row — highlighted only when both axes match a preset */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {PADDING_PRESETS.map((preset) => {
          const active =
            value.vertical === preset.padding.vertical &&
            value.horizontal === preset.padding.horizontal;
          return (
            <button
              key={preset.label}
              onClick={() => onChange({ ...preset.padding })}
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
                  {preset.label}
                </span>
                {active && (
                  <motion.span
                    layoutId="padding-preset-active"
                    className="grid h-4 w-4 place-items-center rounded-full bg-primary text-primary-foreground"
                    transition={{ type: "spring", stiffness: 300, damping: 24 }}
                  >
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  </motion.span>
                )}
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">
                {preset.description}
              </span>
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border/60" />
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
          单独调整
        </span>
        <div className="h-px flex-1 bg-border/60" />
      </div>

      {/* Two-axis sliders + number inputs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <AxisControl
          label="上下边距"
          axis="vertical"
          icon={<VerticalIcon />}
          value={value.vertical}
          onChange={(v) => update({ vertical: v })}
        />
        <AxisControl
          label="左右边距"
          axis="horizontal"
          icon={<HorizontalIcon />}
          value={value.horizontal}
          onChange={(v) => update({ horizontal: v })}
        />
      </div>

      {/* Range hint */}
      <p className="font-mono text-[10px] text-muted-foreground/60">
        范围 {PADDING_MIN}–{PADDING_MAX}px · 步长 {PADDING_STEP}px
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Axis control — slider + number input with a visual indicator
// ---------------------------------------------------------------------------

interface AxisControlProps {
  label: string;
  axis: "vertical" | "horizontal";
  icon: React.ReactNode;
  value: number;
  onChange: (next: number) => void;
}

function AxisControl({ label, icon, value, onChange }: AxisControlProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/30 px-3 py-2.5 shadow-diffusion-sm">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border/60 bg-background/40 text-primary">
        {icon}
      </div>

      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium tracking-tight text-foreground/80">
            {label}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground/70">
            {value}px
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={PADDING_MIN}
            max={PADDING_MAX}
            step={PADDING_STEP}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className={cn(
              "h-1 flex-1 cursor-pointer appearance-none rounded-full bg-border/60 accent-primary",
              "[&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5",
              "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
              "[&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-glow",
              "[&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full",
              "[&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-0",
            )}
          />
          <input
            type="number"
            min={PADDING_MIN}
            max={PADDING_MAX}
            step={PADDING_STEP}
            value={value}
            onChange={(e) => onChange(Number(e.target.value || 0))}
            onBlur={(e) => {
              const n = Number(e.target.value || 0);
              const clamped = Math.min(
                PADDING_MAX,
                Math.max(PADDING_MIN, Math.round(n / PADDING_STEP) * PADDING_STEP),
              );
              if (clamped !== value) onChange(clamped);
            }}
            className={cn(
              "w-16 rounded-md border border-border/60 bg-background/40 px-2 py-1 text-right",
              "font-mono text-[12px] tabular-nums text-foreground",
              "focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30",
            )}
          />
        </div>
      </div>
    </div>
  );
}

function VerticalIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <line x1="7" y1="2" x2="7" y2="12" />
      <polyline points="4 4.5 7 2 10 4.5" />
      <polyline points="4 9.5 7 12 10 9.5" />
    </svg>
  );
}

function HorizontalIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <line x1="2" y1="7" x2="12" y2="7" />
      <polyline points="4.5 4 2 7 4.5 10" />
      <polyline points="9.5 4 12 7 9.5 10" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Reused bits
// ---------------------------------------------------------------------------

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

function ResetButton({ onReset }: { onReset: () => void }) {
  return (
    <button
      onClick={onReset}
      className="group flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/40 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/[0.06] hover:text-destructive"
    >
      <RotateCcw className="h-3 w-3 transition-transform group-hover:-rotate-45" />
      恢复默认设置
    </button>
  );
}