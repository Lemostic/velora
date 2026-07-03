// Tailwind JIT requires all utility classes to be statically present in
// source files, so we enumerate every padding scale up-front and look them
// up by key at runtime. Adding a new scale means adding a literal key here
// AND using the matching class string somewhere in the codebase so the
// scanner picks it up.

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

/** Map of scale key → Tailwind class string used by every page container. */
export const PADDING_CLASSES: Record<PaddingKey, string> = {
  0: "px-0 py-0",
  4: "px-4 py-4 lg:px-4 lg:py-6",
  6: "px-6 py-6 lg:px-6 lg:py-8",
  10: "px-6 py-8 lg:px-10 lg:py-10",
  16: "px-8 py-10 lg:px-16 lg:py-12",
};

export const DEFAULT_PADDING: PaddingKey = 10;

export function isPaddingKey(n: number): n is PaddingKey {
  return n === 0 || n === 4 || n === 6 || n === 10 || n === 16;
}
