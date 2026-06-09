"use client";

/**
 * 术语注释组件 — 给初级运营者看不懂的专业黑话加「虚线下划线 + hover 浮层解释」。
 * 数据源:lib/admin/glossary.ts(术语→通俗解释)。两种用法:
 *   <Gloss>红冲</Gloss>                         单个已知术语显式标注
 *   <AutoGloss>{"红冲 / 净敞口 ..."}</AutoGloss>  自动扫描文本里的所有术语并标注(配置页 note/effect 等批量文本首选)
 * 词不在词典 → 原样渲染(无虚线),不影响版面。
 */
import { Fragment, type ReactNode } from "react";
import { GLOSSARY, GLOSSARY_TERMS, GLOSSARY_GUARD } from "@/lib/admin/glossary";

export function Gloss({ children }: { children: string }) {
  const tip = GLOSSARY[children];
  if (!tip) return <>{children}</>;
  return <span className="gloss" data-tip={tip} role="note" aria-label={`${children}:${tip}`}>{children}</span>;
}

// 术语匹配正则:长词优先(GLOSSARY_TERMS 已按长度降序),转义正则特殊字符,一次构建。
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TERM_RE = new RegExp("(" + GLOSSARY_TERMS.map(escapeRe).join("|") + ")", "g");

export function AutoGloss({ children }: { children: ReactNode }) {
  if (typeof children !== "string" || !children) return <>{children}</>;
  const text = children;
  // 守护词区间:完整词内部不拆术语(如「累计提现」不把「计提」拆出误标)
  const guards: Array<[number, number]> = [];
  for (const g of GLOSSARY_GUARD) {
    for (let i = text.indexOf(g); i >= 0; i = text.indexOf(g, i + g.length)) guards.push([i, i + g.length]);
  }
  const inGuard = (s: number, e: number) => guards.some(([gs, ge]) => s >= gs && e <= ge);
  // 按术语扫描,跳过落在守护词内部的匹配;长词优先由 GLOSSARY_TERMS 降序保证。
  const nodes: ReactNode[] = [];
  let last = 0, key = 0;
  TERM_RE.lastIndex = 0;
  for (let m = TERM_RE.exec(text); m; m = TERM_RE.exec(text)) {
    const s = m.index, e = s + m[0].length;
    if (inGuard(s, e)) continue;
    if (s > last) nodes.push(<Fragment key={key++}>{text.slice(last, s)}</Fragment>);
    nodes.push(<Gloss key={key++}>{m[0]}</Gloss>);
    last = e;
  }
  if (last < text.length) nodes.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return <>{nodes}</>;
}
