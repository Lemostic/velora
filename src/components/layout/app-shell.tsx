import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Outlet } from "react-router-dom";
import { motion } from "framer-motion";
import { NavRail } from "@/components/nav/nav-rail";
import { TopBar } from "@/components/layout/top-bar";
import { useAppStore } from "@/store/app-store";
import { TooltipProvider } from "@/components/ui/tooltip";

interface BackendAppInfo {
  name: string;
  version: string;
  tauriVersion: string;
  modules: { id: string; name: string; category: string; enabled: boolean }[];
}

export function AppShell() {
  const [appInfo, setAppInfo] = useState<BackendAppInfo | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const trackRecent = useAppStore((s) => s.trackRecent);

  useEffect(() => {
    invoke<BackendAppInfo>("app_info")
      .then(setAppInfo)
      .catch((err) => setBackendError(String(err)));
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const path = (e as CustomEvent<string>).detail;
      const m = path.match(/^\/modules\/([^/]+)/);
      if (m) trackRecent(m[1]);
    };
    window.addEventListener("velora:nav", handler);
    return () => window.removeEventListener("velora:nav", handler);
  }, [trackRecent]);

  return (
    <TooltipProvider delayDuration={200}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="flex h-screen w-screen overflow-hidden bg-background text-foreground"
      >
        <NavRail />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar appInfo={appInfo} error={backendError} />
          <main
            className="flex-1 overflow-auto"
            style={{ overscrollBehavior: "contain" }}
          >
            <Outlet />
          </main>
        </div>
      </motion.div>
    </TooltipProvider>
  );
}
