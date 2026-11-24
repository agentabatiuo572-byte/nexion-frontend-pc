"use client";

/**
 * 一笔奖励的详情抽屉：先给判断要点，再按先后画「这一笔是怎么来的」——来源、算出多少、现在到哪一步、入账记录、做过的处置。
 * 底部是这一笔能做的处置；按钮调页面传进来的处理函数，抽屉不发请求。
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { Coins, History, Receipt, ScrollText, User } from "lucide-react";
import { Button, Decision, Drawer, Explain, JudgmentPoints, type JudgmentRow } from "@/app/components/rd";
import type { F5CommissionEvent, F5OperationHistory } from "@/lib/admin/f1-client";
import { maskAuditActor } from "@/lib/admin/audit-actor";
import {
  KIND_LABELS, Money, STATUS_META, StatusBadge, amountText, deviceEarningSource, isFriend, isGrouped, kindNames, operationLabel, timeText, userCode, zoneNote,
} from "./f5-shared";
import { F5RecoveryAmounts } from "../a-tabs/a2-f5-current";

export type F5RowAction = { key: string; label: string; danger?: boolean; disabledReason?: string; onSelect: () => void };

/** 这一笔从哪来：好友两类有真实来源编号；其他类型后端只给来源用户和邀请层。 */
function sourceText(row: F5CommissionEvent): { title: ReactNode; sub?: ReactNode } {
  const who = row.sourceUserId ? userCode(row.sourceUserId) : undefined;
  if (row.kind === "direct_purchase") return { title: <>好友 {who ?? "—"} 的购买订单</>, sub: row.sourceRef ? <span data-mono>{row.sourceRef}</span> : undefined };
  if (row.kind === "direct_device_earning") return {
    title: <>{deviceEarningSource(row.layer)} {who ?? "—"} 的设备收益</>,
    sub: <>{row.sourceRef ? <><span data-mono>{row.sourceRef}</span> · </> : null}设备 {row.sourceDeviceId ? <span data-mono>{row.sourceDeviceId}</span> : "不适用"}</>,
  };
  const layer = row.layer ? `第 ${row.layer} 层` : undefined;
  if (!who && !layer && !row.sourceRef) return { title: KIND_LABELS[row.kind] ?? "未知奖励类型", sub: "没有来源用户" };
  return {
    title: <>{KIND_LABELS[row.kind] ?? "未知奖励类型"}{who ? <> · 来自 {who}</> : null}{layer ? ` · ${layer}` : ""}</>,
    sub: row.sourceRef ? <span data-mono>{row.sourceRef}</span> : undefined,
  };
}

function Step({ icon: Icon, title, children, tone }: { icon: typeof User; title: string; children: ReactNode; tone?: "warn" | "danger" }) {
  return (
    <li className="f5-trace-step" data-tone={tone}>
      <span className="f5-trace-dot" aria-hidden><Icon size={13} strokeWidth={2} /></span>
      <div className="f5-trace-body">
        <h4 className="f5-trace-title">{title}</h4>
        <div className="f5-trace-text">{children}</div>
      </div>
    </li>
  );
}

export function F5Drawer({ row, rows, history, ledgerAllowed, coverageAllowed, l4Allowed, a2Allowed, actions, readOnly, busyReason, onOpen, onClose }: {
  row: F5CommissionEvent | null;
  rows: readonly F5CommissionEvent[];
  history: readonly F5OperationHistory[];
  ledgerAllowed: boolean;
  coverageAllowed: boolean;
  l4Allowed: boolean;
  a2Allowed: boolean;
  actions: (row: F5CommissionEvent) => F5RowAction[];
  readOnly: boolean;
  /** 列表读取中时写原因，按钮全部禁用。 */
  busyReason?: string;
  onOpen: (row: F5CommissionEvent) => void;
  onClose: () => void;
}) {
  if (!row) return <Drawer open={false} onClose={onClose} title="奖励详情">{null}</Drawer>;
  const meta = STATUS_META[row.status];
  const index = rows.findIndex((item) => item.id === row.id);
  const prev = index > 0 ? rows[index - 1] : undefined;
  const next = index >= 0 ? rows[index + 1] : undefined;
  const friend = isFriend(row);
  const grouped = isGrouped(row);
  const money = `${amountText(row.amt)} ${row.cur}`;
  const groupMoney = row.amountUSDT !== undefined && row.amountNEX !== undefined ? `${amountText(row.amountUSDT)} USDT + ${amountText(row.amountNEX)} UVT` : undefined;
  const source = sourceText(row);
  const related = history.filter((item) => item.sourceCommissionId === row.id || item.resultCommissionId === row.id);
  const list = actions(row);
  const danger = list.filter((item) => item.danger);
  const others = list.filter((item) => !item.danger);
  const button = (item: F5RowAction) => (
    <Button key={item.key} variant={item.danger ? "danger-outline" : undefined} disabledReason={busyReason ?? item.disabledReason} onClick={item.onSelect}>{item.label}</Button>
  );

  const nowText = row.status === "cooling"
    ? row.coolingDaysLeft > 0 ? `还要冷却 ${row.coolingDaysLeft} 天，到期后系统按条件解锁` : "到期日是今天或没有到期时间，以到期时间为准"
    : meta?.text ?? "这个状态页面还不认识，请联系技术同事";
  const points: JudgmentRow[] = [
    { label: "现在", value: <StatusBadge status={row.status} explain={false} />, reason: nowText, state: meta?.tone === "warn" || meta?.tone === "danger" ? meta.tone : undefined },
    { label: "金额", icon: Coins, tone: "money", value: <Money value={row.amt} currency={row.cur} />, reason: row.status === "recovery_pending" && row.kind === "vrank_salary"
      ? <span className="f5-trace-warn"><F5RecoveryAmounts id={row.id} /></span>
      : friend && groupMoney ? `整组 ${groupMoney}` : grouped ? "结算组里的一笔；同组另一种币（如有）是另一条记录" : undefined },
    { label: "用户", icon: User, tone: "users", value: row.user, reason: KIND_LABELS[row.kind] ?? "未知奖励类型" },
    {
      label: "处置范围",
      value: friend ? "好友奖励整组一起处理" : grouped ? "只动这一笔" : "单笔记录",
      reason: friend ? "冻结、解冻、冲正对整组的每一笔一起做" : grouped ? "同组另一笔只供参考，处置不动它" : undefined,
    },
  ];
  const ledger = row.ledgerBizNo
    ? ledgerAllowed
      ? <><Link className="rd-link" href={`/finance/ledger?bizNo=${encodeURIComponent(row.ledgerBizNo)}`} prefetch={false}>到账本与账单核对查看</Link> <span data-mono>{row.ledgerBizNo}</span></>
      : <>有账本记录 <span data-mono>{row.ledgerBizNo}</span>，你没有查看账本与账单核对的权限</>
    : ledgerAllowed ? "这笔还没有资金账本记录" : "你没有查看账本与账单核对的权限";
  const note = readOnly ? "你只能查看这笔。"
    : busyReason ? `${busyReason}。`
      : !list.length ? "这笔现在没有可做的处置。" : undefined;

  return (
    <Drawer open onClose={onClose} title="奖励详情" icon={ScrollText} tone="role-1"
      sub={<><span data-mono>{row.id}</span><StatusBadge status={row.status} /></>}
      nav={{ hasPrev: !!prev, hasNext: !!next, onPrev: () => { if (prev) onOpen(prev); }, onNext: () => { if (next) onOpen(next); } }}
      footer={<Decision note={note}
        explain={list.length ? "每个处置都先提交审批，另一位管理员批准后才执行。暂停此类奖励针对这位用户，不只这一笔。" : undefined}
        danger={danger.length ? <>{danger.map(button)}</> : undefined}
        others={others.length ? <>{others.map(button)}</> : undefined} />}>
      <JudgmentPoints rows={points} />
      <section className="f5-trace-wrap" aria-label="这一笔是怎么来的">
        <h3 className="f5-trace-heading">这一笔是怎么来的<span className="f5-weak">时间为{zoneNote()}</span></h3>
        <ol className="f5-trace">
          <Step icon={User} title="来源">
            <p>{source.title}</p>
            {source.sub && <p className="f5-weak">{source.sub}</p>}
          </Step>
          <Step icon={Coins} title="算出来多少">
            {friend ? <>
              <p>整组 {groupMoney ?? "—"}<Explain label="好友奖励怎么算" content="按奖励来源当时的好友奖励政策，用计价基数和来源锁定的 UVT 价格算出两种币；金额为 0 的币种不建记录。" /></p>
              <p className="f5-weak">计价基数 {row.basisUsdt !== undefined ? `${amountText(row.basisUsdt)} USDT` : "—"} · 锁定的 UVT 价格 {row.nexUsdtPrice !== undefined ? `${amountText(row.nexUsdtPrice)} USDT` : "—"} · 政策版本 {row.policyVersion ?? "—"}</p>
              {(Number(row.recoveryPendingUSDT) > 0 || Number(row.recoveryPendingNEX) > 0) ? <p className="f5-trace-warn">待追回 {amountText(row.recoveryPendingUSDT ?? 0)} USDT + {amountText(row.recoveryPendingNEX ?? 0)} UVT</p> : null}
            </> : <>
              <p>这一笔 {money}</p>
              {grouped && (row.basisUsdt !== undefined || row.nexUsdtPrice !== undefined || row.policyVersion !== undefined)
                ? <p className="f5-weak">结算组 <span data-mono>{row.settlementNo}</span> · 计价基数 {row.basisUsdt !== undefined ? `${amountText(row.basisUsdt)} USDT` : "—"} · 锁定的 UVT 价格 {row.nexUsdtPrice !== undefined ? `${amountText(row.nexUsdtPrice)} USDT` : "—"} · 政策版本 {row.policyVersion ?? "—"}</p>
                : <p className="f5-weak">{grouped ? <>结算组 <span data-mono>{row.settlementNo}</span>，没有计算明细</> : "没有计算明细"}</p>}
            </>}
          </Step>
          <Step icon={History} title="现在到哪一步" tone={meta?.tone === "warn" || meta?.tone === "danger" ? meta.tone : undefined}>
            <p><StatusBadge status={row.status} explain={false} />{row.status === "cooling" ? <> {nowText}</> : null}</p>
            <p className="f5-weak">最后变动 {timeText(row.settledAt)}<Explain label="最后变动时间是什么" content="这笔记录最后一次变动的时间，没变过就是生成时间；不一定是发奖的时刻。" /></p>
          </Step>
          <Step icon={Receipt} title="入账记录">
            <p>{ledger}</p>
          </Step>
          <Step icon={ScrollText} title="做过的处置">
            {related.length ? (
              <ul className="f5-trace-ops">
                {related.map((item) => (
                  <li key={item.operationNo}>
                    <span className="f5-trace-op-name">{operationLabel(item.operationType)}{item.resultCommissionId && item.resultCommissionId !== row.id ? <> → 新记录 <span data-mono>{item.resultCommissionId}</span></> : null}</span>
                    <span className="f5-weak">{timeText(item.createdAt)} · {item.operator ? maskAuditActor(item.operator) : "—"}{item.evidenceRef ? <> · 凭证 <span data-mono>{item.evidenceRef}</span></> : null}</span>
                    {item.reason && <span className="f5-weak">{item.reason}</span>}
                    {item.kinds && <span className="f5-weak">{kindNames(item.kinds)}</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="f5-weak">最近 50 条处置记录里没有这一笔。</p>}
            <p className="f5-weak">谁提交、谁批准在{a2Allowed ? <> <Link className="rd-link" href={`/platform/audit?domain=F&object=${encodeURIComponent(row.id)}`} prefetch={false}>操作记录与审批</Link> </> : "「操作记录与审批」"}查{a2Allowed ? "" : "，需要有查看权限的同事"}。</p>
          </Step>
        </ol>
      </section>
      <nav className="rd-links" aria-label="相关页面">
        <span>相关页面</span>
        {coverageAllowed ? <Link className="rd-link" href="/overview/dual-ledger" prefetch={false}>资金与应付款总览</Link> : <span className="f5-weak" title="你没有查看资金与应付款总览的权限">资金与应付款总览 无权限</span>}
        {l4Allowed ? <Link className="rd-link" href="/analytics/operations" prefetch={false}>设备、任务与团队报表</Link> : <span className="f5-weak" title="你没有查看设备、任务与团队报表的权限">设备、任务与团队报表 无权限</span>}
      </nav>
    </Drawer>
  );
}
