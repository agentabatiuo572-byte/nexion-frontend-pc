"use client";

/**
 * 「待处理风险 · 按类型」（design-plan 板 2）：「最近风险信号」页签顶部一列，每类一行。
 * 和首页风控那一行同一份数据（/treasury/b-domain?riskFeed=OPEN_BY_CATEGORY，要 B1＋B5 两项查看权限），
 * 页面读好、排好（按严重度从高到低，同级保持后端顺序）再传进来；组件不发请求、不判权限。
 * 去处写在每行右侧：信号类「下方名单」（点了筛下方名单），评分类「风险评分规则」，提现压力「上方提现压力」。
 */
import Link from "next/link";
import { ChevronRight, ListChecks } from "lucide-react";
import { BlockState, Button, Notice, Panel, StatusTag } from "@/app/components/rd";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { SEVERITY } from "./insights";

export type RiskSev = "p0" | "p1" | "p2" | "p3";

export interface RiskCategoryRow {
  /** 信号类是后端 category（TAMPER…），评分类是 band（AUTO_REPORT、HIGH_BELOW_AUTO、MEDIUM、STALE），评分暂时不可用写 SCORE_UNAVAILABLE，提现压力写 FUND。 */
  key: string;
  kind: "signal" | "score" | "fund";
  /** 信号类用后端 categoryName；评分类、提现压力用 SCORE_BAND_NAME、FUND_NAME。 */
  name: string;
  sev: RiskSev;
  /** 信号类是待处理条数，评分类是账户数；评分暂时不可用、提现压力没有。 */
  count?: number;
  /** 信号类的去重账户数。 */
  accountCount?: number;
  /** 信号类最近一条的记录时间（后端 latestAt，带偏移）。 */
  latestAt?: string;
  /** 评分类的一句补充，比如高风险的「未到自动升级线」。 */
  note?: string;
  /** 评分类去风险评分规则对应档的地址；信号类和提现压力不传，点了走 onSelect。 */
  href?: string;
}

/** 评分各档的叫法，首页、类型列表、风险评分规则页同一套。 */
export const SCORE_BAND_NAME: Record<"AUTO_REPORT" | "HIGH_BELOW_AUTO" | "MEDIUM" | "STALE" | "SCORE_UNAVAILABLE", { name: string; note?: string }> = {
  AUTO_REPORT: { name: "达到自动升级线" },
  HIGH_BELOW_AUTO: { name: "高风险", note: "未到自动升级线" },
  MEDIUM: { name: "中风险" },
  STALE: { name: "等待重新评分" },
  SCORE_UNAVAILABLE: { name: "评分暂时不可用" },
};

/** 提现压力那一类的叫法：到黄线、到红线。 */
export const FUND_NAME = { yellow: "提现压力已到黄线", red: "提现压力已到红线" } as const;

/** 同条件后续读取失败时保留上次成功的值：at 是这个来源自己上次成功的时间；auto 是 30 秒自动重读连续失败（ST-36、ST-51）。 */
export type StaleRead = { at: string; auto: boolean };

export type RiskCategoriesState =
  | { state: "loading" }
  | { state: "error"; error: string }
  /** 只有风险提醒查看权限、没有资金与应付款总览查看权限（ST-39）。 */
  | { state: "noperm" }
  | { state: "ready"; rows: readonly RiskCategoryRow[]; stale?: StaleRead };

const DEST: Record<RiskCategoryRow["kind"], string> = { signal: "下方名单", score: "风险评分规则", fund: "上方提现压力" };

const titleText = (row: RiskCategoryRow) => row.kind === "signal" && row.count !== undefined
  ? `${row.name} ${row.count} 条${row.accountCount !== undefined ? ` · 涉及 ${row.accountCount} 个账户` : ""}`
  : row.count !== undefined ? `${row.name} ${row.count} 个账户` : row.name;

/** 「以下是 {时间} 的数据，刷新失败」：保留旧值时标明时间，旁边重试（名单、类型列表共用）。 */
export function StaleNotice({ stale, onRetry }: { stale: StaleRead; onRetry: () => void }) {
  const at = `${formatBusinessTimeCompact(stale.at, "—")}（${businessZone().label}）`;
  return (
    <Notice tone="warn" action={<Button size="sm" onClick={onRetry}>重试</Button>}>
      {stale.auto ? `自动刷新失败，下面是 ${at} 的数据` : `以下是 ${at} 的数据，刷新失败`}
    </Notice>
  );
}

export function RiskCategoryPanel({ data, selectedKey, onSelect, onRetry }: {
  data: RiskCategoriesState;
  /** 下方名单正按这一类筛着：这一行高亮（VS-74）。 */
  selectedKey?: string | null;
  /** 信号类筛下方名单，提现压力定位到上方提现压力卡。 */
  onSelect: (row: RiskCategoryRow) => void;
  onRetry: () => void;
}) {
  const zone = businessZone().label;
  const sub = data.state === "noperm" ? "无权限" : data.state === "ready" && data.rows.length ? `${data.rows.length} 类 · 时间为${zone}` : undefined;
  return (
    <Panel title="待处理风险 · 按类型" icon={ListChecks} tone="role-other" sub={sub} className="b5-cats-panel" aria-busy={data.state === "loading" || undefined}
      explain={<>
        <p>只数还没处理的事：风险信号按类型数近 7×24 小时待处理的条数，评分各档数账户，提现压力到黄线或红线时一行。</p>
        <p>和今日概览「风控待处理」是同一份数据。</p>
      </>}>
      {data.state === "loading" && <BlockState state="loading" title="正在加载待处理风险…" />}
      {data.state === "error" && <BlockState state="error" title="待处理风险加载失败" detail={data.error} onRetry={onRetry} />}
      {data.state === "noperm" && <p className="b5-line">要看这块，需要「资金与应付款总览」的查看权限。</p>}
      {data.state === "ready" && (
        <div className="b5-stack">
          {data.stale && <StaleNotice stale={data.stale} onRetry={onRetry} />}
          {data.rows.length === 0 ? <p className="b5-line">现在没有待处理的风险。</p> : (
            <ul className="rd-todo b5-cats" aria-label="待处理风险 · 按类型">
              {data.rows.map((row) => {
                const level = SEVERITY[row.sev.toUpperCase() as keyof typeof SEVERITY];
                const selected = row.key === selectedKey;
                const body = (
                  <>
                    <span className="rd-todo-text" data-tone={row.sev === "p0" ? "danger" : undefined}>
                      <span className="rd-todo-title">{selected && <span className="b5-cat-dot" aria-hidden />}{titleText(row)}</span>
                      <span className="rd-todo-sub">
                        <StatusTag tone={level.tone} icon={level.icon}>{level.text}</StatusTag>
                        {row.note && <span>{row.note}</span>}
                        {row.latestAt && <span>最近 {formatBusinessTimeCompact(row.latestAt, "—")}</span>}
                      </span>
                    </span>
                    <span className="rd-todo-owner">{DEST[row.kind]}</span>
                    <ChevronRight className="rd-todo-chevron" size={16} aria-hidden />
                  </>
                );
                return (
                  <li key={row.key} className="rd-todo-item">
                    {row.href
                      ? <Link className="rd-todo-row" href={row.href} prefetch={false}>{body}</Link>
                      : <button type="button" className="rd-todo-row b5-cat-row" aria-pressed={row.kind === "signal" ? selected : undefined} onClick={() => onSelect(row)}>{body}</button>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}
