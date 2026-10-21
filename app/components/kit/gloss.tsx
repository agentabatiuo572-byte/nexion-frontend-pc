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

const PLAIN_LABELS: Record<string, string> = {
  "RBAC": "角色权限",
  "CAS": "版本校验",
  "KPI": "关键指标",
  "Phase": "运营阶段",
  "schema": "事件字段格式",
  "i18n": "多语言",
  "CMS": "内容管理",
  "BI": "数据分析",
  "SOP": "操作流程",
  "outbox": "待投递事件",
  "cron": "自动执行时间",
  "CIDR": "IP 地址段",
  "server-canonical": "以服务器数据为准",
  "server 权威": "以服务器数据为准",
  "server-authoritative": "以服务器数据为准",
  "append-only": "只能新增记录",
  "Kill-Switch": "紧急停用开关",
  "灰度": "分批开放",
  "灰度比例": "分批开放比例",
  "漏斗": "转化过程",
  "cohort": "同一批用户",
  "归因": "原因分析",
  "口径": "计算方式",
  "SLA": "处理时限",
  "2FA": "双重验证",
  "TVL": "质押资产总额",
  "GMV": "成交总额",
  "GV": "团队业绩",
  "直推": "直接邀请",
  "树位": "团队位置",
  "置信度": "判断把握度",
  "净敞口": "储备与应付款差额",
  "日切": "每日结算",
  "网络版税": "团队分成",
  "双轨": "左右团队",
};

export function Gloss({ children }: { children: string }) {
  const tip = GLOSSARY[children];
  if (!tip) return <>{children}</>;
  const label = PLAIN_LABELS[children] ?? children;
  return <span className="gloss" data-tip={`${children}：${tip}`} role="note" aria-label={`${label}：${tip}`}>{label}</span>;
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
