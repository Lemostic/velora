import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ModuleCategory } from "@/lib/registry";
import {
  DEFAULT_PADDING,
  isPaddingKey,
  type PaddingKey,
} from "@/lib/spacing";

interface AppState {
  // UI state
  sidebarCollapsed: boolean;
  activeCategory: ModuleCategory | "all";

  // User prefs (persisted)
  theme: "dark" | "light" | "system";
  recentModules: string[];
  contentPadding: PaddingKey;

  // Actions
  toggleSidebar: () => void;
  setActiveCategory: (cat: ModuleCategory | "all") => void;
  setTheme: (t: "dark" | "light" | "system") => void;
  trackRecent: (moduleId: string) => void;
  setContentPadding: (n: PaddingKey) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      activeCategory: "all",
      theme: "dark",
      recentModules: [],
      contentPadding: DEFAULT_PADDING,

      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setActiveCategory: (cat) => set({ activeCategory: cat }),
      setTheme: (theme) => set({ theme }),
      trackRecent: (moduleId) =>
        set((s) => {
          const next = [
            moduleId,
            ...s.recentModules.filter((id) => id !== moduleId),
          ].slice(0, 8);
          return { recentModules: next };
        }),
      setContentPadding: (n) => {
        if (!isPaddingKey(n)) return;
        set({ contentPadding: n });
      },
    }),
    {
      name: "velora.app-state.v1",
      storage: createJSONStorage(() => localStorage),
      version: 2,
      partialize: (s) => ({
        theme: s.theme,
        recentModules: s.recentModules,
        sidebarCollapsed: s.sidebarCollapsed,
        contentPadding: s.contentPadding,
      }),
      migrate: (persisted: unknown, fromVersion: number) => {
        if (!persisted || typeof persisted !== "object") return persisted;
        const p = persisted as Record<string, unknown>;
        if (fromVersion < 2 && typeof p.contentPadding !== "number") {
          p.contentPadding = DEFAULT_PADDING;
        }
        return p as unknown as AppState;
      },
    },
  ),
);
