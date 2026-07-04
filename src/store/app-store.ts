import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ModuleCategory } from "@/lib/registry";
import {
  DEFAULT_PADDING,
  clampAxis,
  type PagePadding,
} from "@/lib/spacing";

interface AppState {
  // UI state
  sidebarCollapsed: boolean;
  activeCategory: ModuleCategory | "all";

  // User prefs (persisted)
  theme: "dark" | "light" | "system";
  recentModules: string[];
  contentPadding: PagePadding;

  // Actions
  toggleSidebar: () => void;
  setActiveCategory: (cat: ModuleCategory | "all") => void;
  setTheme: (t: "dark" | "light" | "system") => void;
  trackRecent: (moduleId: string) => void;
  setContentPadding: (next: PagePadding) => void;
  resetContentPadding: () => void;
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
      setContentPadding: (next) => {
        // Each axis is independently clamped to the allowed window so the
        // preferences UI can stay loose with the inputs without poisoning
        // the persisted state.
        set({
          contentPadding: {
            vertical: clampAxis(next.vertical),
            horizontal: clampAxis(next.horizontal),
          },
        });
      },
      resetContentPadding: () => set({ contentPadding: DEFAULT_PADDING }),
    }),
    {
      name: "velora.app-state.v1",
      storage: createJSONStorage(() => localStorage),
      version: 5,
      partialize: (s) => ({
        theme: s.theme,
        recentModules: s.recentModules,
        sidebarCollapsed: s.sidebarCollapsed,
        contentPadding: s.contentPadding,
      }),
      migrate: (persisted: unknown, fromVersion: number) => {
        if (!persisted || typeof persisted !== "object") return persisted;
        const p = persisted as Record<string, unknown>;

        // ---- v5 ----
        // Switch from the 4-sided `{ top, right, bottom, left }` shape
        // to the 2-axis `{ vertical, horizontal }` shape. Vertical becomes
        // the average of top/bottom; horizontal becomes the average of
        // left/right. (In practice the previous version paired top=bottom
        // and left=right inside the UI, so the average equals either side.)
        if (fromVersion < 5) {
          const legacy = p.contentPadding as Record<string, unknown> | undefined;
          if (legacy && typeof legacy === "object") {
            const r = legacy;
            const topN = typeof r.top === "number" ? r.top : null;
            const bottomN = typeof r.bottom === "number" ? r.bottom : null;
            const leftN = typeof r.left === "number" ? r.left : null;
            const rightN = typeof r.right === "number" ? r.right : null;
            const hasFourSide =
              topN !== null || bottomN !== null || leftN !== null || rightN !== null;
            if (hasFourSide) {
              const vertical =
                topN !== null && bottomN !== null
                  ? Math.round((topN + bottomN) / 2)
                  : topN ?? bottomN ?? DEFAULT_PADDING.vertical;
              const horizontal =
                leftN !== null && rightN !== null
                  ? Math.round((leftN + rightN) / 2)
                  : leftN ?? rightN ?? DEFAULT_PADDING.horizontal;
              p.contentPadding = { vertical, horizontal };
            } else if (
              typeof r.vertical !== "number" ||
              typeof r.horizontal !== "number"
            ) {
              p.contentPadding = { ...DEFAULT_PADDING };
            }
          } else if (typeof legacy === "number") {
            // v3 and earlier stored a single numeric scale; map it to px.
            const side =
              legacy === 0 ? 0 :
              legacy === 4 ? 16 :
              legacy === 6 ? 24 :
              legacy === 10 ? 40 :
              legacy === 16 ? 64 :
              legacy === 20 ? 80 :
              DEFAULT_PADDING.vertical;
            p.contentPadding = { vertical: side, horizontal: side };
          } else {
            p.contentPadding = { ...DEFAULT_PADDING };
          }
        }

        return p as unknown as AppState;
      },
    },
  ),
);