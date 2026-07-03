// Map of scale key → Tailwind class string used by every page container.
// Padding is now width-invariant: the same scale applies at every viewport
// width, so the right-hand gutter stays at exactly 10 units no matter
// whether the window is narrow or fullscreen.

export type PaddingKey = 0 | 4 | 6 | 10 | 16;

export interface PaddingOption {
  value: PaddingKey;
  label: string;
  description: string;
}

export const PADDING_OPTIONS: readonly PaddingOption[] = [
  { value: 0, label: "无", description: "内容贴边" },
  { value: 4, label: "紧凑", description: "16px" },
  { value: 6, label: "略紧", description: "24px" },
  { value: 10, label: "标准", description: "40px · 默认" },
  { value: 16, label: "宽松", description: "64px" },
] as const;

/**
 * Tailwind class string per padding scale.
 * No breakpoint suffix — the same scale applies at every width.
 */
export const PADDING_CLASSES: Record<PaddingKey, string> = {
  0: "px-0 py-0",
  4: "px-4 py-4",
  6: "px-6 py-6",
  10: "px-10 py-8",
  16: "px-16 py-10",
};

export const DEFAULT_PADDING: PaddingKey = 10;

/**
 * Canonical outer-container max-width applied to every module page
 * (Home, QRCode, Excel, ComingSoon, Preferences, ...). Sharing a
 * single number means the user never sees a width jump when they
 * navigate between modules — only the inner content reflows.
 */
export const CONTENT_MAX_WIDTH = "max-w-[1400px]";

/**
 * Pre-built "page container" class string. Use exactly this string
 * on the root `<div>` of any new module page so we don't drift
 * again.
 *
 *   <div className={PAGE_CONTAINER_CLASS}>
 *     <ModuleHeader moduleId="my-module" />
 *     ...
 *   </div>
 */
export const PAGE_CONTAINER_CLASS =
  `mx-auto flex h-full w-full ${CONTENT_MAX_WIDTH} flex-col`;

export function isPaddingKey(n: number): n is PaddingKey {
  return n === 0 || n === 4 || n === 6 || n === 10 || n === 16;
}
