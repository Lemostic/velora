import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ModuleCategory } from "@/lib/registry";

interface AppState {
  // UI state
  sidebarCollapsed: boolean;
  activeCategory: ModuleCategory | "all";

  // User prefs (persisted)
  theme: "dark" | "light" | "system";
  recentModules: string[];

  // Actions
  toggleSidebar: () => void;
  setActiveCategory: (cat: ModuleCategory | "all") => void;
  setTheme: (t: "dark" | "light" | "system") => void;
  trackRecent: (moduleId: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      activeCategory: "all",
      theme: "dark",
      recentModules: [],

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
    }),
    {
      name: "velora.app-state.v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        theme: s.theme,
        recentModules: s.recentModules,
        sidebarCollapsed: s.sidebarCollapsed,
      }),
    },
  ),
);
