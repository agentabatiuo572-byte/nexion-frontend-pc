// 后台 UI 状态 — 侧栏折叠 / 分组展开 / 表格密度 / 过滤。持久化。
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type Density = "normal" | "dense";

interface AdminUiState {
  sidebarCollapsed: boolean;
  expandedGroups: string[]; // 手动展开的域 code;当前路由所在域始终展开
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
      expandedGroups: ["B"], // 默认展开驾驶舱
      density: "normal",
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebar: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleGroup: (code) =>
        set((s) => ({
          expandedGroups: s.expandedGroups.includes(code)
            ? s.expandedGroups.filter((c) => c !== code)
            : [...s.expandedGroups, code],
        })),
      setExpanded: (codes) => set({ expandedGroups: codes }),
      setDensity: (density) => set({ density }),
    }),
    {
      name: "nexion-admin-ui-v1",
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);
