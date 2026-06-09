"use client";

/**
 * ThemeProvider — 把 persist store 的 mode 写到 <html data-theme>。
 * SSR 已在 layout.tsx 直写 data-theme="dark" 与默认一致;mount 后若用户存的是
 * light 则更新属性,body 200ms 过渡到浅色。
 */
import { useEffect } from "react";
import { useTheme } from "@/lib/store/theme";

export function ThemeProvider() {
  const mode = useTheme((s) => s.mode);

  useEffect(() => {
    const root = document.documentElement;
    if (mode === "dark") {
      root.setAttribute("data-theme", "dark");
    } else {
      root.removeAttribute("data-theme");
    }
  }, [mode]);

  return null;
}
