import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ReportSection = "done" | "plan";

export interface PersonDay {
  id: string;
  name: string;
  days: string;
}

export interface WeeklyTaskRow {
  id: string;
  category: string;
  taskItem: string;
  content: string;
  progress: string;
  effort: string;
  costOwner: string;
  owner: string;
  output: string;
  people: PersonDay[];
}

export function createEmptyRow(): WeeklyTaskRow {
  return {
    id: newId(),
    category: "",
    taskItem: "",
    content: "",
    progress: "",
    effort: "",
    costOwner: "",
    owner: "",
    output: "",
    people: [],
  };
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function currentWeekLabel(): string {
  const now = new Date();
  const year = now.getFullYear();
  const first = new Date(year, 0, 1);
  const dayOfYear = Math.floor(
    (now.getTime() - first.getTime()) / 86400000,
  );
  const week = Math.ceil((dayOfYear + first.getDay() + 1) / 7);
  return `${year}年第${week}周`;
}

interface WeeklyReportState {
  weekLabel: string;
  investmentReport: string;
  investmentLeave: string;
  summary: string;
  doneRows: WeeklyTaskRow[];
  planRows: WeeklyTaskRow[];

  setWeekLabel: (value: string) => void;
  setInvestmentReport: (value: string) => void;
  setInvestmentLeave: (value: string) => void;
  setSummary: (value: string) => void;
  addRow: (section: ReportSection, row: WeeklyTaskRow) => void;
  updateRow: (
    section: ReportSection,
    id: string,
    patch: Partial<WeeklyTaskRow>,
  ) => void;
  removeRow: (section: ReportSection, id: string) => void;
  duplicateRow: (section: ReportSection, id: string) => void;
  clearSection: (section: ReportSection) => void;
  clearAll: () => void;
}

function mutateRows(
  rows: WeeklyTaskRow[],
  id: string,
  patch: Partial<WeeklyTaskRow>,
): WeeklyTaskRow[] {
  return rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
}

export const useWeeklyReportStore = create<WeeklyReportState>()(
  persist(
    (set) => ({
      weekLabel: currentWeekLabel(),
      investmentReport: "",
      investmentLeave: "",
      summary: "",
      doneRows: [],
      planRows: [],

      setWeekLabel: (weekLabel) => set({ weekLabel }),
      setInvestmentReport: (investmentReport) => set({ investmentReport }),
      setInvestmentLeave: (investmentLeave) => set({ investmentLeave }),
      setSummary: (summary) => set({ summary }),
      addRow: (section, row) =>
        set((s) =>
          section === "done"
            ? { doneRows: [...s.doneRows, row] }
            : { planRows: [...s.planRows, row] },
        ),
      updateRow: (section, id, patch) =>
        set((s) =>
          section === "done"
            ? { doneRows: mutateRows(s.doneRows, id, patch) }
            : { planRows: mutateRows(s.planRows, id, patch) },
        ),
      removeRow: (section, id) =>
        set((s) =>
          section === "done"
            ? { doneRows: s.doneRows.filter((row) => row.id !== id) }
            : { planRows: s.planRows.filter((row) => row.id !== id) },
        ),
      duplicateRow: (section, id) =>
        set((s) => {
          const rows = section === "done" ? s.doneRows : s.planRows;
          const source = rows.find((row) => row.id === id);
          if (!source) return {};
          const copy: WeeklyTaskRow = {
            ...source,
            id: newId(),
            people: source.people.map((p) => ({ ...p, id: newId() })),
          };
          return section === "done"
            ? { doneRows: [...s.doneRows, copy] }
            : { planRows: [...s.planRows, copy] };
        }),
      clearSection: (section) =>
        set(section === "done" ? { doneRows: [] } : { planRows: [] }),
      clearAll: () =>
        set({ doneRows: [], planRows: [], summary: "", investmentReport: "", investmentLeave: "" }),
    }),
    {
      name: "velora.weekly-report.v1",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({
        weekLabel: s.weekLabel,
        investmentReport: s.investmentReport,
        investmentLeave: s.investmentLeave,
        summary: s.summary,
        doneRows: s.doneRows,
        planRows: s.planRows,
      }),
    },
  ),
);
