"use client";

/**
 * 页面进入转场 — 每次路由变化 fade + 轻微 y 位移,key={pathname} 重触发。
 * SSR 安全:初始态即 SSR DOM(opacity 0),framer 水合后动到可见;verify/Playwright
 * 的文本断言仍能命中(DOM 存在,只是视觉渐显)。reduced-motion 直接跳过。
 */
import { motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <PageTransitionInner key={pathname}>{children}</PageTransitionInner>;
}

function PageTransitionInner({ children }: { children: React.ReactNode }) {
  const prefersReduced = useReducedMotion();
  if (prefersReduced) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] as const }}
    >
      {children}
    </motion.div>
  );
}
