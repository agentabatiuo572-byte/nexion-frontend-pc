// 后台 UI 状态 — 侧栏折叠 / 分组展开 / 表格密度 / 过滤。
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type Density = "normal" | "dense";
export const DEFAULT_EXPANDED_GROUPS: string[] = [];

/** 侧栏采用手风琴语义：同一时刻最多展开一个域，再次点击该域时全部折叠。 */
export function nextExpandedGroups(current: string[], code: string): string[] {
  return current.includes(code) ? [] : [code];
}

interface AdminUiState {
  sidebarCollapsed: boolean;
  expandedGroups: string[]; // 当前手动展开的域 code；最多一个，刷新后恢复默认折叠
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
      expandedGroups: [...DEFAULT_EXPANDED_GROUPS],
      density: "normal",
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebar: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleGroup: (code) =>
        set((s) => ({
          expandedGroups: nextExpandedGroups(s.expandedGroups, code),
        })),
      setExpanded: (codes) => set({ expandedGroups: codes.slice(-1) }),
      setDensity: (density) => set({ density }),
    }),
    {
      name: "nexion-admin-ui-v1",
      storage: createJSONStorage(() => localStorage),
      version: 3,
      migrate: (persistedState) => ({
        ...(persistedState as Partial<AdminUiState>),
        // v1 允许同时展开多个域，v2 仍会持久化展开态；升级时统一清空。
        expandedGroups: [...DEFAULT_EXPANDED_GROUPS],
      }),
      // 展开态只属于当前页面会话；不落盘，保证每次进入管理端时默认全折叠。
      partialize: ({ expandedGroups: _expandedGroups, ...persistedState }) => persistedState,
    },
  ),
);
