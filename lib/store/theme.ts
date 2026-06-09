// 主题 store — 暗/浅切换,持久化。
// SSR 安全:默认 "dark"(后台首版主推),app/layout.tsx 服务端直写 data-theme="dark"
// 与默认一致,首帧即暗,无 hydration mismatch。用户切到 light 后由 persist 恢复。
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ThemeMode = "light" | "dark";

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      mode: "dark",
      setMode: (mode) => set({ mode }),
      toggle: () => set((s) => ({ mode: s.mode === "light" ? "dark" : "light" })),
    }),
    {
      name: "nexion-admin-theme-v1",
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);
