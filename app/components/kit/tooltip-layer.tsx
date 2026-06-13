"use client";

/**
 * TooltipLayer — 全局术语浮层(遮挡根治)。
 * 监听任意 `[data-tip]` 元素的鼠标悬停,用 `position:fixed` + portal 到 <body> 渲染浮层,
 * 从而逃出 `.tbl-wrap`(overflow-x:auto 连带裁切 y)/`.card.pad-0`/`.modal`/`.drawer` 等
 * overflow 祖先的裁切 —— `::after`/`::before` 伪元素浮层无法逃出 overflow:hidden,故改用本层。
 *
 * 覆盖 `.gloss`(术语)与 `.has-tip`(代号/出处)两套 data-tip,统一一处渲染。
 * 在 (console)/layout.tsx 挂载一次即全站生效。近顶部自动改向下、近右缘自动夹紧、滚动/缩放即隐藏。
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Tip = { text: string; left: number; top: number; place: "above" | "below" };

const TIP_MAX_W = 264;
const EDGE = 8;
const FLIP_TOP = 130; // 元素顶部距视口 < 此值 → 浮层改向下展开,避免顶部越界被裁

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    const show = (host: HTMLElement) => {
      const text = host.getAttribute("data-tip");
      if (!text) return;
      const r = host.getBoundingClientRect();
      const place: "above" | "below" = r.top < FLIP_TOP ? "below" : "above";
      const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - TIP_MAX_W - EDGE));
      const top = place === "below" ? r.bottom + 6 : r.top - 6;
      setTip({ text, left, top, place });
    };
    const onOver = (e: MouseEvent) => {
      const host = (e.target as HTMLElement | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (host) show(host);
    };
    const onOut = (e: MouseEvent) => {
      const host = (e.target as HTMLElement | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (!host) return;
      const to = e.relatedTarget as Node | null;
      if (to && host.contains(to)) return; // 仍在同一元素内移动 → 保持
      setTip(null);
    };
    const hide = () => setTip(null);
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  if (!tip || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="gloss-tip"
      role="tooltip"
      style={{ left: tip.left, top: tip.top, transform: tip.place === "above" ? "translateY(-100%)" : "none" }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
