import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * plugin-store: 用户启/停插件的真值源（前端侧）。
 *
 * 这里只持有「用户主动关闭的模块 id 数组」，没列出来的都视为启用。
 * 持久化到 localStorage，跨启动保留。
 *
 * 注意：本期不接后端，所以 `list_modules` 还不会过滤；
 * 但前端 NavRail / bento / Cmd+K 都已接入，下一步接通后端时这里复用即可。
 */

interface PluginState {
  /** 用户在 Preferences 关掉的模块 id 列表。 */
  disabledModules: string[];

  /** 关掉一个模块（若已关则 no-op）。 */
  disable: (id: string) => void;
  /** 启用一个模块（从禁用列表里移除）。 */
  enable: (id: string) => void;
  /** 切换（开关）。 */
  toggle: (id: string) => void;
  /** 一键全开。 */
  resetToEnabled: () => void;

  /** 查询助手。 */
  isEnabled: (id: string) => boolean;
}

export const usePluginStore = create<PluginState>()(
  persist(
    (set, get) => ({
      disabledModules: [],

      disable: (id) =>
        set((s) =>
          s.disabledModules.includes(id)
            ? s
            : { disabledModules: [...s.disabledModules, id] },
        ),
      enable: (id) =>
        set((s) => ({
          disabledModules: s.disabledModules.filter((x) => x !== id),
        })),
      toggle: (id) => {
        const cur = get().disabledModules;
        set({
          disabledModules: cur.includes(id)
            ? cur.filter((x) => x !== id)
            : [...cur, id],
        });
      },
      resetToEnabled: () => set({ disabledModules: [] }),

      isEnabled: (id) => !get().disabledModules.includes(id),
    }),
    {
      name: "velora.plugin-state.v1",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({ disabledModules: s.disabledModules }),
    },
  ),
);
