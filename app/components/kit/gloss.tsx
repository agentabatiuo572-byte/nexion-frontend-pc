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
import { createGlossaryMatcher } from "@/lib/admin/glossary-match";

export function Gloss({ children }: { children: string }) {
  const tip = GLOSSARY[children];
  if (!tip) return <>{children}</>;
  return <span className="gloss" data-tip={tip} role="note" aria-label={`${children}:${tip}`}>{children}</span>;
}

// 匹配边界规则(守护词 / 拉丁词边界 / 长词优先)见 lib/admin/glossary-match.ts。
// 术语表是模块常量 → 正则只编译一次,渲染路径不重复编译。
const matchTerms = createGlossaryMatcher(GLOSSARY_TERMS, GLOSSARY_GUARD);

export function AutoGloss({ children }: { children: ReactNode }) {
  if (typeof children !== "string" || !children) return <>{children}</>;
  const text = children;
  const nodes: ReactNode[] = [];
  let last = 0, key = 0;
  for (const hit of matchTerms(text)) {
    if (hit.start > last) nodes.push(<Fragment key={key++}>{text.slice(last, hit.start)}</Fragment>);
    nodes.push(<Gloss key={key++}>{hit.term}</Gloss>);
    last = hit.end;
  }
  if (last < text.length) nodes.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return <>{nodes}</>;
}
