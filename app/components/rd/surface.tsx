"use client";

/**
 * RdPage 改版页面的根节点。迁移一页时把页面内容包在里面：
 *
 * <RdPage><PageHeader … /> … </RdPage>
 *
 * 做三件事：保留 .dkpage（旧类继续生效，CP-13）；把旧组件的颜色变量接到新配色；
 * 告诉里面的旧 Modal 和 OperationConfirmModal 走新的 Radix 弹窗。
 * 抽屉和弹窗挂在这个节点里，不挂 body，域样式不丢（CP-13 的风险）。
 */
import { createContext, useContext, useState, type ReactNode } from "react";

const RdSurfaceContext = createContext<{ container: HTMLElement | null } | null>(null);

export function useRdSurface() {
  return useContext(RdSurfaceContext);
}

export function RdPage({ children, className }: { children: ReactNode; className?: string }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  return (
    <div ref={setContainer} className={className ? `dkpage rd-page ${className}` : "dkpage rd-page"}>
      <RdSurfaceContext.Provider value={{ container }}>{children}</RdSurfaceContext.Provider>
    </div>
  );
}
