import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { HomePage } from "@/routes/home-page";
import { QRCodePage } from "@/routes/qrcode-page";
import { ExcelToJsonPage } from "@/routes/excel-to-json-page";
import { ComingSoonPage } from "@/routes/coming-soon-page";
import { PreferencesPage } from "@/routes/preferences-page";
import { NotFoundPage } from "@/routes/not-found-page";

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "modules/qrcode", element: <QRCodePage /> },
      { path: "modules/excel-to-json", element: <ExcelToJsonPage /> },
      {
        path: "modules/excel-transpose",
        element: <ComingSoonPage moduleId="excel-transpose" />,
      },
      {
        path: "modules/file-treeview",
        element: <ComingSoonPage moduleId="file-treeview" />,
      },
      {
        path: "modules/zip-clean",
        element: <ComingSoonPage moduleId="zip-clean" />,
      },
      {
        path: "modules/xml-json",
        element: <ComingSoonPage moduleId="xml-json" />,
      },
      {
        path: "modules/markitdown",
        element: <ComingSoonPage moduleId="markitdown" />,
      },
      {
        path: "modules/process-manager",
        element: <ComingSoonPage moduleId="process-manager" />,
      },
      {
        path: "modules/es-query",
        element: <ComingSoonPage moduleId="es-query" />,
      },
      {
        path: "modules/excel-schedule",
        element: <ComingSoonPage moduleId="excel-schedule" />,
      },
      { path: "modules/preferences", element: <PreferencesPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
