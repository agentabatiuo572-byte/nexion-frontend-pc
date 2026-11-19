"use client";

/**
 * 主题。深色是默认，浅色挂 data-theme="light"，两套都正式保留（产品 2026-11-05 定）。
 * - <ThemeScript />：放在 <head> 里同步执行，首屏按记住的选择设属性，不闪屏。
 * - <ThemeToggle />：顶栏和登录页的左右两侧选择，只有图标：左太阳浅色、右月亮深色，滑块停在已选的一侧。
 *   单选组（radiogroup「主题」，两个 radio「浅色」「深色」）：点哪一侧选哪一侧，点已选的一侧不变；Tab 停在已选项，
 *   左右方向键移到另一侧并选中，空格、回车选中焦点项。悬停和聚焦写这一侧是什么（「浅色」「深色」）。
 *   滑块位置和图标明暗由 CSS 按 <html data-theme> 定，首屏就在对的一侧，不会滑一下。
 * - useAdminTheme(adminId)：登录后按这个账号记住的选择切换，在绘制前生效，内容不会先按本机选择画一次。
 * 记忆：localStorage `nexion-admin-rd-theme` 是本机最近一次的选择，登录前也用它；
 * `nexion-admin-rd-theme:<adminId>` 是每个账号的选择，登录后以它为准。
 * 网址参数 ?theme=light|dark 只给截图和验收脚本用，页面上不写它，也不当入口。
 */
import { useLayoutEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { IconTip } from "./button";

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

const OPTIONS: readonly { value: Theme; label: string; icon: typeof Sun; className: string }[] = [
  { value: "light", label: "浅色", icon: Sun, className: "rd-theme-sun" },
  { value: "dark", label: "深色", icon: Moon, className: "rd-theme-moon" },
];

export function ThemeToggle({ adminId, floating }: { adminId?: number; floating?: boolean }) {
  const theme = useTheme();
  return (
    <div className="rd-theme" role="radiogroup" aria-label="主题" data-floating={floating ? "" : undefined}>
      <span className="rd-theme-thumb" aria-hidden />
      {OPTIONS.map(({ value, label, icon: Icon, className }) => (
        <IconTip key={value} label={label}>
          <button
            type="button"
            role="radio"
            aria-label={label}
            aria-checked={theme === value}
            tabIndex={theme === value ? 0 : -1}
            data-value={value}
            onClick={() => {
              if (theme !== value) applyTheme(value, adminId);
            }}
            onKeyDown={(e) => {
              const pick = e.key === "ArrowLeft" || e.key === "ArrowUp" ? "light" : e.key === "ArrowRight" || e.key === "ArrowDown" ? "dark" : null;
              if (!pick) return;
              e.preventDefault();
              if (pick !== theme) applyTheme(pick, adminId);
              e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-value="${pick}"]`)?.focus();
            }}
          >
            <Icon className={className} size={14} aria-hidden />
          </button>
        </IconTip>
      ))}
    </div>
  );
}
