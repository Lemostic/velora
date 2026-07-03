import { useEffect } from "react";
import { useAppStore } from "@/store/app-store";

/**
 * Sync the persisted theme preference onto the document root.
 *
 * - "dark"   → add `dark` class
 * - "light"  → remove `dark` class
 * - "system" → follow `prefers-color-scheme`, react to live OS changes
 *
 * The CSS in `index.css` defines `:root` (light) and `.dark` tokens,
 * so toggling the class on `<html>` is the only thing needed to switch
 * the entire app between the two palettes.
 */
export function useTheme() {
  const theme = useAppStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const isDark =
        theme === "dark" || (theme === "system" && mql.matches);
      root.classList.toggle("dark", isDark);
    };

    apply();

    if (theme !== "system") return;

    const onChange = () => apply();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);
}
