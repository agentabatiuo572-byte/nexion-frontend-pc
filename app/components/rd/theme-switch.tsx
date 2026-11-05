"use client";

/**
 * 主题。深色是默认，浅色挂 data-theme="light"，两套都正式保留（产品 2026-11-05 定）。
 * - <ThemeScript />：放在 <head> 里同步执行，首屏按记住的选择设属性，不闪屏。
 * - <ThemeToggle />：顶栏和登录页的开关，太阳「浅色」、月亮「深色」，有文字。
 * - useAdminTheme(adminId)：登录后按这个账号记住的选择切换，在绘制前生效，内容不会先按本机选择画一次。
 * 记忆：localStorage `nexion-admin-rd-theme` 是本机最近一次的选择，登录前也用它；
 * `nexion-admin-rd-theme:<adminId>` 是每个账号的选择，登录后以它为准。
 * 网址参数 ?theme=light|dark 只给截图和验收脚本用，页面上不写它，也不当入口。
 */
import { useLayoutEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

export type Theme = "light" | "dark";
const KEY = "nexion-admin-rd-theme";
const EVENT = "nexion-admin-rd-theme";
const SCRIPT = `(function(){var k="${KEY}",t=null;try{var q=new URLSearchParams(location.search).get("theme");if(q==="light"||q==="dark"){t=q;localStorage.setItem(k,q)}else t=localStorage.getItem(k)}catch(e){}document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark")})()`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}

export function readTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme, adminId?: number) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(KEY, theme);
    if (adminId !== undefined) localStorage.setItem(`${KEY}:${adminId}`, theme);
  } catch {
    // 存不下只影响下次打开的默认主题。
  }
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (onChange: () => void) => {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
};

/** 服务端和水合时按深色渲染，挂载后读 <html> 上的真实值，不会和首屏脚本打架。 */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => "dark");
}

export function useAdminTheme(adminId: number | undefined) {
  useLayoutEffect(() => {
    if (adminId === undefined) return;
    try {
      const saved = localStorage.getItem(`${KEY}:${adminId}`);
      if ((saved === "light" || saved === "dark") && saved !== readTheme()) applyTheme(saved);
    } catch {
      // 读不到就沿用本机最近一次的选择。
    }
  }, [adminId]);
}

const OPTIONS: readonly { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
];

export function ThemeToggle({ adminId, floating }: { adminId?: number; floating?: boolean }) {
  const theme = useTheme();
  return (
    <div className="rd-theme" role="radiogroup" aria-label="界面主题" data-floating={floating ? "" : undefined}>
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button key={value} type="button" role="radio" aria-checked={theme === value} data-on={theme === value ? "" : undefined} title={`${label}主题`} onClick={() => applyTheme(value, adminId)}>
          <Icon size={14} aria-hidden />
          <span className="rd-theme-label">{label}</span>
        </button>
      ))}
    </div>
  );
}
