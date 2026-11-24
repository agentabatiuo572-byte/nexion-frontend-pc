"use client";

/**
 * 邀请关系的显示件（PRD §4、§5；设计画布 01a–10，DESIGN.md「设计决定」）。
 * 页面把读到的数据翻成下面两种显示状态（邀请人、人数）再交给这些组件，组件不读回包、不判断权限。
 * 显示状态怎么从回包来（人数状态映射、能不能点、旧后端时隐藏）由 wiring.ts 与入口各自的读取状态决定。
 *
 * <InviterCell view={…} />    表格里一格两行：昵称 / 用户编码（C1 列表、客服两张表）
 * <InviterValue view={…} />   一行：页头事实、抽屉事实、客户资料、会话右栏头部
 * <CountsFacts view={…} />    客服个人资料抽屉的一组人数（07a–07c）
 * <CountsNotice view={…} />   人数数据异常、没读全时常显的提示条（DP-03）
 * <CountsExplain />           四个人数的口径，只放在「团队奖励范围内」旁，朝上开（不盖数字）
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Cell, Explain, Notice, StatusTag } from "@/app/components/rd";
import "./invitation-view.css";

export type InviterView =
  /** href：能打开时传（后端 navigable、目标页可达都满足）；scopeNote：不能打开时问号里写为什么。 */
  | { kind: "present"; nickname: string | null; userNo: string; href?: string; scopeNote?: string }
  | { kind: "none" }
  | { kind: "deleted"; userNo: string }
  | { kind: "unknown"; note: string };

export type CountsView =
  | { kind: "ready"; direct: number; within: number; beyond: number; total: number }
  /** 旧后端没有新口径：四个数写「—」，不提示原因（PRD §5 版本交叉）。旧采样代（GENERATION_UPGRADING）同样。 */
  | { kind: "absent" }
  | { kind: "anomaly" }
  /** rereading：这次重读正在进行，「重试」写「重试中…」（只因写操作进行中而禁用时仍写「重试」）。 */
  | { kind: "partial"; onRetry?: () => void; retrying?: boolean; rereading?: boolean }
  /** 只有人数读不出：一行「邀请人数」+ 加载失败 + 原因 + 重试（07c）。后台详情整块读不出走区块失败。 */
  | { kind: "failed"; reason: string; onRetry?: () => void; retrying?: boolean; rereading?: boolean }
  | { kind: "loading" };

export type CountKey = "direct" | "within" | "beyond" | "total";
export const COUNT_LABELS: Record<CountKey, string> = { direct: "直接邀请", within: "团队奖励范围内", beyond: "超出团队奖励范围", total: "全部团队成员" };

export const INVITER_UNKNOWN_NOTE = "邀请关系记录有异常，暂时无法确认邀请人。";
export const INVITER_SCOPE_NOTE = "不在你的客户范围内，只显示昵称和用户编码。";
export const COUNTS_RULE = "这里按邀请次数统计人数。具体奖励以团队奖励设置和实际结算为准。";
const COUNTS_ANOMALY = "邀请关系数据有异常，人数暂不显示。请联系值班人员核对。";
const COUNTS_PARTIAL = "人数没有读全";
/** 只有人数读不出时写的原因：后端这一段整段没读出（人数状态 FAILED），不是网络错误，其余资料照常显示（PRD §4.4、§5）。 */
export const COUNTS_FAILED_REASON = "这次没读出人数，其他资料照常。";

/** 四个数的口径只写这一处（DT-12），放在「团队奖励范围内」旁，朝上开（04 画板）。 */
export function CountsExplain() {
  return (
    <Explain label="人数怎么算" side="top" align="start"
      content={<><p>{COUNTS_RULE}</p><p>冻结、受限、封禁的成员也算；已删除的不算。</p></>}
      rows={[
        { k: COUNT_LABELS.direct, v: "相隔 1 次邀请" },
        { k: COUNT_LABELS.within, v: "相隔 1–7 次邀请，含直接邀请" },
        { k: COUNT_LABELS.beyond, v: "相隔 8 次及以上" },
        { k: COUNT_LABELS.total, v: "上面两项相加，不含本人" },
      ]} />
  );
}

function Unconfirmed({ note }: { note: string }) {
  return (
    <span className="inv-value">
      <StatusTag tone="warn" icon={AlertTriangle}>无法确认</StatusTag>
      <Explain label="邀请人为什么无法确认" content={note} />
    </span>
  );
}

/** 表格里的邀请人：一格两行，昵称在上、用户编码在下（等宽、不截，TX-28）；不做链接，整行照旧打开这一行的用户（ST-06）。 */
export function InviterCell({ view }: { view: InviterView | undefined }) {
  if (!view) return <span className="rd-weak">—</span>;
  if (view.kind === "none") return <Cell main={<span className="rd-weak">无邀请人</span>} />;
  if (view.kind === "unknown") return <Cell main={<Unconfirmed note={view.note} />} />;
  if (view.kind === "deleted") return <Cell title={`${view.userNo} 已删除`} main={<span data-mono>{view.userNo}</span>} sub="已删除" />;
  const name = view.nickname?.trim();
  return <Cell title={name ? `${name} ${view.userNo}` : view.userNo} main={name || <span data-mono>{view.userNo}</span>} sub={name ? <span data-mono>{view.userNo}</span> : undefined} />;
}

/** 一行里的邀请人：「昵称 用户编码」。能打开时整段是正文色带下划线的链接（VS-06）；长昵称省略、编码不截，悬停看全文。 */
export function InviterValue({ view }: { view: InviterView | undefined }) {
  if (!view) return <span className="rd-weak">—</span>;
  if (view.kind === "none") return <span className="rd-weak">无邀请人</span>;
  if (view.kind === "unknown") return <Unconfirmed note={view.note} />;
  if (view.kind === "deleted") return <span className="inv-value"><span data-mono className="inv-code">{view.userNo}</span><span className="rd-weak">· 已删除</span></span>;
  const name = view.nickname?.trim();
  // 昵称和编码之间的空格放进编码那一段：整段是一条连着的下划线，读起来是一个链接，不像两个。
  const body = <>{name && <span className="inv-name">{name}</span>}<span data-mono className="inv-code">{name ? "\u00a0" : ""}{view.userNo}</span></>;
  return (
    <span className="inv-value" title={name ? `${name} ${view.userNo}` : view.userNo}>
      {view.href ? <Link className="rd-link inv-link" href={view.href} prefetch={false}>{body}</Link> : <span className="inv-text">{body}</span>}
      {!view.href && view.scopeNote && <Explain label="为什么不能点" content={view.scopeNote} />}
    </span>
  );
}

/** 人数的值：确数写「n 人」，其余写「—」弱字（ST-45，不写 0）。unit=false 时只写数（客服资料的行名已带「（人）」）。 */
export function countText(view: CountsView, key: CountKey, unit = true): ReactNode {
  return view.kind === "ready" ? (unit ? `${view[key]} 人` : String(view[key])) : <span className="rd-weak">—</span>;
}

/**
 * 人数的「重试」：和 rd InlineRetry 一个样子，但不能点时用 aria-disabled，不用原生 disabled。
 * 原生 disabled 一按下焦点就掉到页面上（Chrome，R01）；这里重读期间按钮留着、焦点也留着，写「重试中…」并标 aria-busy（CP-28）。
 */
export function CountsRetryButton({ onRetry, retrying, rereading }: { onRetry: () => void; retrying?: boolean; rereading?: boolean }) {
  return <button type="button" className="rd-inline-retry inv-retry" aria-disabled={retrying || undefined} aria-busy={rereading || undefined} onClick={retrying ? undefined : onRetry}>{rereading ? "重试中…" : "重试"}</button>;
}

/** 数据异常、没读全：四个数「—」，下面常显一条橙黄提示（DP-03，VS-107）；没读全的「重试」在右侧。 */
export function CountsNotice({ view }: { view: CountsView }) {
  if (view.kind === "anomaly") return <Notice tone="warn">{COUNTS_ANOMALY}</Notice>;
  if (view.kind === "partial") return <Notice tone="warn" action={view.onRetry && <CountsRetryButton onRetry={view.onRetry} retrying={view.retrying} rereading={view.rereading} />}>{COUNTS_PARTIAL}</Notice>;
  return null;
}

/** 只有人数读不出时的一行（07c）：橙黄「加载失败」、原因、重试；和没读全同类，不用红（用户已确认）。 */
export function CountsFailed({ view }: { view: Extract<CountsView, { kind: "failed" }> }) {
  return (
    <span className="inv-failed" role="alert">
      <StatusTag tone="warn" icon={AlertTriangle}>加载失败</StatusTag>
      <span className="inv-failed-reason">{view.reason}</span>
      {view.onRetry && <CountsRetryButton onRetry={view.onRetry} retrying={view.retrying} rereading={view.rereading} />}
    </span>
  );
}

/** 客服个人资料抽屉里的一组人数（07a），排在事实下面（DP-16）。 */
export function CountsFacts({ view }: { view: CountsView }) {
  if (view.kind === "failed") {
    return <dl className="rd-facts inv-counts"><div className="rd-fact"><dt>邀请人数</dt><dd><CountsFailed view={view} /></dd></div></dl>;
  }
  if (view.kind === "loading") {
    return <dl className="rd-facts inv-counts"><div className="rd-fact" data-empty=""><dt>邀请人数</dt><dd role="status">正在加载…</dd></div></dl>;
  }
  const keys: CountKey[] = ["direct", "within", "beyond", "total"];
  return (
    <>
      <dl className="rd-facts inv-counts">
        {keys.map((key) => (
          <div key={key} className="rd-fact" data-empty={view.kind === "ready" ? undefined : ""}>
            <dt className="inv-nowrap">{COUNT_LABELS[key]}{key === "within" && <CountsExplain />}</dt>
            <dd>{countText(view, key)}</dd>
          </div>
        ))}
      </dl>
      <CountsNotice view={view} />
    </>
  );
}

/**
 * 人数「重试」读完后焦点去哪（R01；CP-05、rubric 26）。重读期间按钮留着、写「重试中…」，读完：
 * 还有「重试」（仍没读到）焦点落到它上面；没有了焦点回到这一块折叠的标题，人数读到了再读出「人数已更新」。
 * 按下「重试」时记住它所在的折叠；读完时焦点已去了别处（不在这一块里、不在页面上、也不在包着它的外框上）就不动。
 * 页面在按下时调 arm()，把 status 放进一直挂着的 role="status"（rd-sr-only）里。
 */
export function useCountsRetryFocus(rereading: boolean, updated: boolean) {
  const fold = useRef<HTMLDetailsElement | null>(null);
  const was = useRef(false);
  const [status, setStatus] = useState("");
  const arm = () => {
    const active = document.activeElement;
    fold.current = active instanceof HTMLElement ? active.closest("details") : null;
    setStatus("");
  };
  useEffect(() => {
    if (rereading) { was.current = true; return; }
    if (!was.current) return;
    was.current = false;
    const target = fold.current;
    fold.current = null;
    if (updated) setStatus("人数已更新");
    if (!target?.isConnected) return;
    const active = document.activeElement;
    // 焦点掉到页面上，或被弹窗的焦点圈接到外框上（外框包着这一块）时才接回来；已经去了别处就不动。
    if (active && active !== document.body && !target.contains(active) && !active.contains(target)) return;
    (target.querySelector<HTMLElement>(".rd-inline-retry:not(:disabled)") ?? target.querySelector<HTMLElement>(":scope > summary"))?.focus();
  }, [rereading, updated]);
  return { arm, status };
}
