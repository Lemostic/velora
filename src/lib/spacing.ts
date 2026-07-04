// ---------------------------------------------------------------------------
// Page padding model
// ---------------------------------------------------------------------------
// The outer `<div>` of every module page applies a 4-sided padding around
// its content. The two axes are independently configurable — vertical
// (top/bottom together) and horizontal (left/right together). Pairing the
// sides this way is the design contract: we don't allow the top to differ
// from the bottom, or the left to differ from the right. The single-
// value-per-axis shape makes the controls obvious and keeps the persisted
// state minimal.
//
// Storage is a plain `{ vertical, horizontal }` object (in pixels). We
// apply it via inline `style` rather than Tailwind classes because the
// values are dynamic arbitrary numbers — Tailwind's JIT can't statically
// detect `pt-[${p.vertical}px]` style template strings.
// ---------------------------------------------------------------------------

export interface PagePadding {
  /** Top and bottom padding in pixels. */
  vertical: number;
  /** Left and right padding in pixels. */
  horizontal: number;
}

/**
 * Recommended default — `5rem` (80px) on both axes. Generous enough to
 * give the hero / module-header real breathing room against the top bar,
 * nav rail, and bottom edge, without crowding small windows.
 */
export const DEFAULT_PADDING: PagePadding = {
  vertical: 80,
  horizontal: 80,
};

/** Min/max range for each axis, in pixels. */
export const PADDING_MIN = 0;
export const PADDING_MAX = 200;
export const PADDING_STEP = 4;

/**
 * One-click preset rows. Both axes share the same value so a preset is a
 * sensible starting point the user can fine-tune afterwards.
 */
export interface PaddingPreset {
  label: string;
  description: string;
  padding: PagePadding;
}

export const PADDING_PRESETS: readonly PaddingPreset[] = [
  { label: "无",   description: "0px",  padding: { vertical: 0,  horizontal: 0  } },
  { label: "紧凑", description: "16px", padding: { vertical: 16, horizontal: 16 } },
  { label: "略紧", description: "24px", padding: { vertical: 24, horizontal: 24 } },
  { label: "标准", description: "40px", padding: { vertical: 40, horizontal: 40 } },
  { label: "宽松", description: "64px", padding: { vertical: 64, horizontal: 64 } },
  { label: "5rem", description: "80px · 默认", padding: { vertical: 80, horizontal: 80 } },
] as const;

/**
 * Convert a {@link PagePadding} to an inline-style object. This is the
 * canonical way to apply padding to a page container so any value in
 * `[PADDING_MIN, PADDING_MAX]` works at runtime.
 */
export function paddingToStyle(p: PagePadding): React.CSSProperties {
  return {
    paddingTop: p.vertical,
    paddingBottom: p.vertical,
    paddingLeft: p.horizontal,
    paddingRight: p.horizontal,
  };
}

/**
 * Clamp a single axis value to the allowed range and snap to
 * {@link PADDING_STEP}.
 */
export function clampAxis(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_PADDING.vertical;
  const clamped = Math.min(PADDING_MAX, Math.max(PADDING_MIN, n));
  return Math.round(clamped / PADDING_STEP) * PADDING_STEP;
}

/** Clamp both axes of a padding object. */
export function clampPadding(p: PagePadding): PagePadding {
  return {
    vertical: clampAxis(p.vertical),
    horizontal: clampAxis(p.horizontal),
  };
}

/** True when both axes match the corresponding axis of the default. */
export function isDefaultPadding(p: PagePadding): boolean {
  return (
    p.vertical === DEFAULT_PADDING.vertical &&
    p.horizontal === DEFAULT_PADDING.horizontal
  );
}

/** True when both axes are equal (i.e. matches a preset pattern). */
export function isUniformPadding(p: PagePadding): boolean {
  return p.vertical === p.horizontal;
}

/**
 * Run-time guard used by the persisted store. Accepts anything that
 * *looks* like a valid {@link PagePadding} and clamps out-of-range
 * values to the allowed window.
 */
export function coercePagePadding(input: unknown): PagePadding {
  const fallback = DEFAULT_PADDING;
  if (!input || typeof input !== "object") return { ...fallback };
  const r = input as Record<string, unknown>;
  return clampPadding({
    vertical:
      typeof r.vertical === "number" ? r.vertical : fallback.vertical,
    horizontal:
      typeof r.horizontal === "number" ? r.horizontal : fallback.horizontal,
  });
}

// ---------------------------------------------------------------------------
// Container width — kept here so all the page-level layout knobs live in a
// single module. The page container fills the available width and lets
// `paddingToStyle` be the *only* knob that drives whitespace — that way
// setting padding to `0` truly zeroes the gutter at any window width, and
// there's no `max-w-[1400px]` ceiling leaving dead space on the right.
// ---------------------------------------------------------------------------

/**
 * Canonical outer-container class string. Use exactly this string on the
 * root `<div>` of any new module page.
 *
 *   <div className={PAGE_CONTAINER_CLASS} style={paddingToStyle(contentPadding)}>
 *     <ModuleHeader moduleId="my-module" />
 *     ...
 *   </div>
 *
 * Page-level content (hero cards, bento grids, etc.) is responsible for
 * imposing its own `max-w` and `mx-auto` so long-form text doesn't run the
 * full window width.
 */
export const PAGE_CONTAINER_CLASS =
  `flex h-full w-full flex-col`;