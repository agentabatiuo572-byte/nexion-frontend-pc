// 后台 UI 状态 — 侧栏折叠 / 分组展开 / 表格密度 / 过滤。持久化。
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type Density = "normal" | "dense";

interface AdminUiState {
  sidebarCollapsed: boolean;
  expandedGroups: string[]; // 手风琴状态，始终只保存 0 或 1 个域 code
  density: Density;
  toggleSidebar: () => void;
  setSidebar: (collapsed: boolean) => void;
  toggleGroup: (code: string) => void;
  setExpanded: (codes: string[]) => void;
  setDensity: (d: Density) => void;
}

export const useAdminUi = create<AdminUiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      expandedGroups: [], // 默认全部折叠
      density: "normal",
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebar: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleGroup: (code) =>
        set((s) => ({
          expandedGroups: s.expandedGroups[0] === code ? [] : [code],
        })),
      setExpanded: (codes) => set({ expandedGroups: codes.length > 0 ? [codes[codes.length - 1]] : [] }),
      setDensity: (density) => set({ density }),
    }),
    {
      name: "nexion-admin-ui-v1",
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (persistedState) => ({
        ...(persistedState as Partial<AdminUiState>),
        // v1 允许同时展开多个域；升级时清空，确保新默认和手风琴不变量立即生效。
        expandedGroups: [],
      }),
    },
  ),
);
