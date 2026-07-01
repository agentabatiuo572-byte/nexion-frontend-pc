/**
 * (console) 路由组布局 — server 组件,仅挂载 client 外壳 ConsoleShell。
 * 所有 hook/动效/Zustand 交互收在 ConsoleShell 子树内。
 */
import { ConsoleShell } from "@/app/components/shell/console-shell";
import { TooltipLayer } from "@/app/components/kit/tooltip-layer";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ConsoleShell>{children}</ConsoleShell>
      <TooltipLayer />
    </>
  );
}

