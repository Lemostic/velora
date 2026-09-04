import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { HomePage } from "@/routes/home-page";
import { QRCodePage } from "@/routes/qrcode-page";
import { ExcelToJsonPage } from "@/routes/excel-to-json-page";
import { ExcelTransposePage } from "@/routes/excel-transpose-page";
import { FileTreePage } from "@/routes/file-treeview-page";
import { ZipCleanPage } from "@/routes/zip-clean-page";
import { XmlJsonPage } from "@/routes/xml-json-page";
import { MarkitdownPage } from "@/routes/markitdown-page";
import { ExcelSchedulePage } from "@/routes/excel-schedule-page";
import { WeeklyReportPage } from "@/routes/weekly-report-page";
import { ProcessManagerPage } from "@/routes/process-manager-page";
import { EsQueryPage } from "@/routes/es-query-page";
import { AutodeployPage } from "@/routes/autodeploy-page";
import { PreferencesPage } from "@/routes/preferences-page";
import { NotFoundPage } from "@/routes/not-found-page";
import { useTheme } from "@/hooks/use-theme";

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
        element: <ExcelTransposePage />,
      },
      {
        path: "modules/file-treeview",
        element: <FileTreePage />,
      },
      {
        path: "modules/zip-clean",
        element: <ZipCleanPage />,
      },
      {
        path: "modules/xml-json",
        element: <XmlJsonPage />,
      },
      {
        path: "modules/markitdown",
        element: <MarkitdownPage />,
      },
      {
        path: "modules/process-manager",
        element: <ProcessManagerPage />,
      },
      {
        path: "modules/es-query",
        element: <EsQueryPage />,
      },
      {
        path: "modules/excel-schedule",
        element: <ExcelSchedulePage />,
      },
      {
        path: "modules/weekly-report",
        element: <WeeklyReportPage />,
      },
      {
        path: "modules/autodeploy",
        element: <AutodeployPage />,
      },
      { path: "modules/preferences", element: <PreferencesPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  useTheme();
  return <RouterProvider router={router} />;
}
