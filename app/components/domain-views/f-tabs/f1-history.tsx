"use client";

/**
 * F1 的两份历史：晋升记录、奖励发放记录。各自筛选、各自往前翻（游标），点一行看全部字段。
 * 查询、翻页、重发、冲正都调旧页面现成的 ctx 函数，筛选条件和请求参数不变。
 */
import { useState } from "react";
import { ArrowRight, Cpu, History, ReceiptText, RotateCcw, Undo2, UserCog } from "lucide-react";
import {
  Button, Cell, Change, Drawer, Fact, Facts, FilterBar, FilterField, Fold, Input, KeyValues, Panel, Select, StatusTag, Table, TableLoading,
  TableMessage, Td, Th, Tr,
} from "@/app/components/rd";
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { businessZone, formatBusinessTimeCompact, formatBusinessTimeFull } from "@/lib/admin/business-time";
import type { F1PromotionRecord, F1RewardPayout, F1VRankRow } from "@/lib/admin/f1-client";
import type { FViewCtx } from "./types";
import { ADMIN_APPROVER, PAYOUT_STATUS, PAYOUT_TYPES, payoutReward, rewardKind, type F1Confirm } from "./f1-shared";

const dash = (value: string) => value || "—";
const snapshotText = (snapshot: unknown) => {
  if (snapshot == null || snapshot === "") return "";
  if (typeof snapshot === "string") return snapshot;
  try { return JSON.stringify(snapshot, null, 2); } catch { return ""; }
};

export function F1PromotionHistory({ ctx, rows, canPromote, onOverride }: { ctx: FViewCtx; rows: F1VRankRow[]; canPromote: boolean; onOverride: () => void }) {
  const [filters, setFilters] = useState({ userId: "", v: "", cohort: "", from: "", to: "" });
  const [openId, setOpenId] = useState<string | null>(null);
  const set = (key: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const records = ctx.promotionRecords;
  const current = records.find((record) => record.id === openId) ?? null;
  const at = current ? records.indexOf(current) : -1;
  const moreCount = [filters.cohort, filters.from || filters.to].filter(Boolean).length;
  return (
    <>
      <FilterBar onSubmit={() => void ctx.queryPromotions(filters)} querying={ctx.f1PromotionLoading}
        more={<>
          <FilterField label="用户批次"><Input aria-label="晋升批次" value={filters.cohort} onChange={(event) => set("cohort", event.target.value)} placeholder="设备批次，包含即可" /></FilterField>
          <FilterField label="日期" wide><span className="rd-filter-range">
            <Input aria-label="晋升开始日期" type="date" value={filters.from} onChange={(event) => set("from", event.target.value)} />
            <span aria-hidden>–</span>
            <Input aria-label="晋升结束日期" type="date" value={filters.to} onChange={(event) => set("to", event.target.value)} />
          </span></FilterField>
        </>} moreCount={moreCount}>
        <FilterField><Input aria-label="晋升用户编号" value={filters.userId} onChange={(event) => set("userId", event.target.value)} placeholder="用户编号" inputMode="numeric" /></FilterField>
        <FilterField><Select aria-label="晋升涉及等级" value={filters.v} onChange={(value) => set("v", value)}
          options={[{ value: "", label: "全部等级" }, ...rows.map((row) => ({ value: row.v, label: row.v }))]} /></FilterField>
      </FilterBar>
    <Panel title="晋升记录" icon={History} tone="role-3" flush
      sub={`当前筛选 ${ctx.promotionTotal.toLocaleString("en-US")} 条`}
      explain="自动评估和人工调整都会留一条；按记录先后倒序，每次读 100 条。自动评估每次最多升一级；人工调整可以一次跨几级。"
      actions={canPromote ? <Button size="sm" icon={<UserCog size={14} aria-hidden />} onClick={onOverride}>人工调整等级</Button> : undefined}>
      <Table label="晋升记录" className="f1-table">
        <colgroup><col className="f1-col-user" /><col className="f1-col-change" /><col className="f1-col-way" /><col className="f1-col-reason" /><col className="f1-col-time" /></colgroup>
        <thead><tr><Th>用户</Th><Th>等级变化</Th><Th>方式</Th><Th>触发原因</Th><Th>时间（{businessZone().label}）</Th></tr></thead>
        <tbody>
          {ctx.f1PromotionError ? <TableMessage columns={5} role="alert">晋升记录读取失败 · {ctx.f1PromotionError}</TableMessage>
            : records.length === 0 ? ctx.f1PromotionLoading ? <TableLoading columns={5} /> : <TableMessage columns={5}>没有符合条件的晋升记录</TableMessage>
              : records.map((record) => (
                <Tr key={record.id} selected={record.id === openId} onOpen={() => setOpenId(record.id)}>
                  <Td><Cell main={operatorNicknameText(record.nickname || "—")} sub={`用户 ${record.userId}`} title={record.nickname || undefined} /></Td>
                  <Td><span className="f1-change">{dash(record.fromCode)}<ArrowRight size={13} aria-label="到" />{dash(record.toCode)}</span></Td>
                  <Td><Cell main={record.isManual ? <StatusTag tone="progress" icon={UserCog}>人工</StatusTag> : <StatusTag tone="neutral" icon={Cpu}>自动</StatusTag>}
                    sub={record.isManual ? dash(record.operator) : record.cohort ? `批次 ${record.cohort}` : undefined} /></Td>
                  <Td grow><Cell main={dash(record.reason)} title={record.reason || undefined} /></Td>
                  <Td><Cell main={formatBusinessTimeCompact(record.createdAt, "—")} num /></Td>
                </Tr>
              ))}
        </tbody>
      </Table>
      {ctx.promotionNextCursor && <div className="f1-more">
        <Button size="sm" loading={ctx.f1PromotionLoading} onClick={() => void ctx.queryPromotions({ ...filters, cursor: ctx.promotionNextCursor }, true)}>加载更早记录</Button>
      </div>}
      <Drawer open={!!current} onClose={() => setOpenId(null)} title="晋升记录" sub={current ? `用户 ${current.userId}` : undefined}
        nav={{ onPrev: () => setOpenId(records[at - 1]?.id ?? null), onNext: () => setOpenId(records[at + 1]?.id ?? null), hasPrev: at > 0, hasNext: at >= 0 && at < records.length - 1 }}>
        {current && <PromotionDetail record={current} />}
      </Drawer>
    </Panel>
    </>
  );
}

function PromotionDetail({ record }: { record: F1PromotionRecord }) {
  const snapshot = snapshotText(record.snapshot);
  return <>
    <KeyValues rows={[
      { key: "user", label: "用户", value: <>{operatorNicknameText(record.nickname || "—")} · {record.userId}</> },
      { key: "change", label: "等级变化", value: `${dash(record.fromCode)} → ${dash(record.toCode)}` },
      { key: "way", label: "方式", value: record.isManual ? "人工调整" : "自动评估" },
      { key: "operator", label: "操作人", value: dash(record.operator) },
      { key: "cohort", label: "用户批次", value: dash(record.cohort), explain: "这位用户最近使用的设备批次，不一定是这次晋升当时的批次。" },
      { key: "reason", label: "触发原因", value: dash(record.reason) },
      { key: "event", label: "触发事件", value: dash(record.triggerEventId), mono: !!record.triggerEventId },
      { key: "audit", label: "审计编号", value: dash(record.auditNo), mono: !!record.auditNo },
      { key: "at", label: `时间（${businessZone().label}）`, value: formatBusinessTimeFull(record.createdAt, "—"), explain: "抽屉里写到秒，方便和操作记录、审计编号逐条对时间。" },
    ]} />
    <Fold inset title="当时的达标情况" summary={snapshot ? "评估时记下的原始数据" : "没有记录"}>
      {snapshot ? <pre className="f1-json">{snapshot}</pre> : <p className="f1-empty">这条记录没有达标快照。</p>}
    </Fold>
  </>;
}

export function F1PayoutHistory({ ctx, rows, canReissue, canReverse, openConfirm }: {
  ctx: FViewCtx; rows: F1VRankRow[]; canReissue: boolean; canReverse: boolean; openConfirm: (confirm: F1Confirm) => void;
}) {
  const [filters, setFilters] = useState({ type: "", v: "", status: "", userId: "" });
  const [openId, setOpenId] = useState<string | null>(null);
  const set = (key: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const records = ctx.payoutRecords;
  const current = records.find((record) => record.payoutId === openId) ?? null;
  const at = current ? records.indexOf(current) : -1;
  const canAct = canReissue || canReverse;
  const cols = canAct ? 5 : 4;
  const allowed = (record: F1RewardPayout) => ({
    reissue: canReissue && record.status === "REVERSED",
    reverse: canReverse && ["GRANTED", "REISSUED", "PENDING_GRANT"].includes(record.status),
  });

  const openAction = (record: F1RewardPayout, action: "reissue" | "reverse") => {
    const kind = rewardKind(record.rewardType);
    const reward = payoutReward(record);
    const rewardText = reward.unit ? `${reward.main} ${reward.unit}` : reward.main;
    const from = PAYOUT_STATUS[record.status]?.label ?? "状态未知";
    const impact = action === "reissue"
      ? kind === "fund" ? `批准后重新记一笔 ${rewardText} 应付：有邀请人的付给邀请人并立即可用，没有的付给用户本人、先进冷却期。批准时检查兑付覆盖率。`
        : kind === "sku" ? "批准后恢复原商品的履约和权益，并核对库存；库存不够或状态变了会被拒。"
          : kind === "voucher" ? "只更新这笔发放记录的状态，不会补发或收回用户手里的券。"
            : "只更新这笔发放记录的状态，不会补发或收回自定义奖品。"
      : kind === "fund" ? record.commissionEventId
        ? `批准后按原奖励记录反向记账，收回这笔 ${rewardText}。`
        : "这笔没有关联的奖励记录，批准后只把状态改成已冲正，不动账。"
        : kind === "sku" ? "批准后取消对应的履约、收回权益，按履约状态退回库存。"
          : kind === "voucher" ? "只更新这笔发放记录的状态，不会补发或收回用户手里的券。"
            : "只更新这笔发放记录的状态，不会补发或收回自定义奖品。";
    openConfirm({
      proposalSlot: `f-payout-action:${record.payoutId}`,
      action: `${action === "reissue" ? "重新发放" : "冲正"}奖励`,
      title: action === "reissue" ? "重发奖励" : "冲正奖励",
      briefKind: "funds",
      amplify: action === "reissue",
      confirmTone: action === "reverse" ? "danger" : "primary",
      confirmLabel: "提交审批",
      coverageLead: kind === "fund" ? "重发会让平台再付一次这笔钱" : kind === "sku" ? "重发会恢复商品履约，按会让平台多付钱的操作检查" : "按会让平台多付钱的操作检查；这笔实际不会补发",
      coverageCheck: "提交时先检查兑付覆盖率；资金奖励在批准执行时后端再检查一次。",
      effect: <StatusTag tone="progress" filled explain={`${ADMIN_APPROVER}（需有${action === "reissue" ? "重发" : "冲正"}奖励权限和审批批准权限）在「操作记录与审批」批准后才执行；批准前这笔记录不变。`}>批准后生效</StatusTag>,
      facts: <Facts>
        {kind === "fund" ? <Fact k="奖励" lead tone="role-2" unit={reward.unit}>{reward.main}</Fact> : <Fact k="奖励">{rewardText}</Fact>}
        <Fact k="发放单">{record.payoutId}</Fact>
        <Fact k="用户">用户 {record.userId} · {dash(record.rankCode)}</Fact>
        <Fact k="状态"><Change from={from} to={action === "reissue" ? "已重发" : "已冲正"} /></Fact>
      </Facts>,
      statedBrief: { impact: `${impact}不改奖励模板，也不改用户等级。`, check: "核对发放单、用户和奖励；理由写清依据或工单号。" },
      detail: `${action === "reissue" ? "只有已冲正的奖励可以重新发放，平台会多付钱。" : "只有已发放、已重发或待发放的奖励可以冲正。"}提交后需确认才生效。`,
      submit: async (reason) => ctx.proposePayoutAction(record.payoutId, action, reason),
    });
  };

  const actions = (record: F1RewardPayout, size: "sm" | "md" = "sm") => {
    const can = allowed(record);
    if (!can.reissue && !can.reverse) return null;
    return <span className="f1-row-actions">
      {can.reissue && <Button size={size} icon={<RotateCcw size={14} aria-hidden />} aria-label={`重发 ${record.payoutId}`} onClick={() => openAction(record, "reissue")}>重发</Button>}
      {can.reverse && <Button size={size} variant="danger-outline" icon={<Undo2 size={14} aria-hidden />} aria-label={`冲正 ${record.payoutId}`} onClick={() => openAction(record, "reverse")}>冲正</Button>}
    </span>;
  };

  return (
    <>
      <FilterBar onSubmit={() => void ctx.queryPayouts(filters)} querying={ctx.f1PayoutLoading}
        more={<FilterField label="奖励类型"><Select aria-label="奖励类型" value={filters.type} onChange={(value) => set("type", value)}
          options={[{ value: "", label: "全部奖励" }, ...PAYOUT_TYPES.map((item) => ({ value: item.value, label: item.label }))]} /></FilterField>}
        moreCount={filters.type ? 1 : 0}>
        <FilterField><Input aria-label="发放用户编号" value={filters.userId} onChange={(event) => set("userId", event.target.value)} placeholder="用户编号" inputMode="numeric" /></FilterField>
        <FilterField><Select aria-label="发放等级" value={filters.v} onChange={(value) => set("v", value)}
          options={[{ value: "", label: "全部等级" }, ...rows.map((row) => ({ value: row.v, label: row.v }))]} /></FilterField>
        <FilterField><Select aria-label="发放状态" value={filters.status} onChange={(value) => set("status", value)}
          options={[{ value: "", label: "全部状态" }, ...Object.entries(PAYOUT_STATUS).map(([value, item]) => ({ value, label: item.label }))]} /></FilterField>
      </FilterBar>
    <Panel title="奖励发放记录" icon={ReceiptText} tone="role-2" flush
      sub={`当前筛选 ${ctx.payoutTotal.toLocaleString("en-US")} 条`}
      explain="每次有人升级、按模板发出的每一项奖励各一条。已冲正的可以重发，已发放、已重发、待发放的可以冲正，都要提交审批；发放失败的这页没有重试入口。">
      <Table label="奖励发放记录" className="f1-table">
        <colgroup><col className="f1-col-payout" /><col className="f1-col-reward" /><col className="f1-col-status" /><col className="f1-col-time" />{canAct && <col className="f1-col-act" />}</colgroup>
        <thead><tr><Th>发放单</Th><Th>等级 · 奖励</Th><Th>状态</Th><Th>时间（{businessZone().label}）</Th>{canAct && <Th align="right" sticky="end">操作</Th>}</tr></thead>
        <tbody>
          {ctx.f1PayoutError ? <TableMessage columns={cols} role="alert">发放记录读取失败 · {ctx.f1PayoutError}</TableMessage>
            : records.length === 0 ? ctx.f1PayoutLoading ? <TableLoading columns={cols} /> : <TableMessage columns={cols}>没有符合条件的发放记录</TableMessage>
              : records.map((record) => {
                const reward = payoutReward(record);
                const status = PAYOUT_STATUS[record.status];
                return (
                  <Tr key={record.payoutId} selected={record.payoutId === openId} onOpen={() => setOpenId(record.payoutId)}>
                    <Td><Cell main={<span data-mono>{record.payoutId}</span>} sub={`用户 ${record.userId}`} /></Td>
                    <Td><Cell main={<span title={reward.raw}>{reward.main}{reward.unit && <small className="f1-unit"> {reward.unit}</small>}</span>} sub={`${dash(record.rankCode)} · ${record.rewardType.toUpperCase() === "USDT" || record.rewardType.toUpperCase() === "UVT" ? "资金" : PAYOUT_TYPES.find((item) => item.value === record.rewardType.toUpperCase())?.label ?? dash(record.rewardType)}`} /></Td>
                    <Td>{status ? <StatusTag tone={status.tone} icon={status.icon}>{status.label}</StatusTag> : <StatusTag tone="warn">状态未知</StatusTag>}</Td>
                    <Td><Cell main={formatBusinessTimeCompact(record.reversedAt || record.grantedAt, "—")} sub={record.reversedAt ? "冲正时间" : record.grantedAt ? "发放时间" : undefined} num /></Td>
                    {canAct && <Td align="right" sticky="end" data-fit="">{actions(record) ?? <span className="f1-weak">—</span>}</Td>}
                  </Tr>
                );
              })}
        </tbody>
      </Table>
      {ctx.payoutNextCursor && <div className="f1-more">
        <Button size="sm" loading={ctx.f1PayoutLoading} onClick={() => void ctx.queryPayouts({ ...filters, cursor: ctx.payoutNextCursor }, true)}>加载更早记录</Button>
      </div>}
      <Drawer open={!!current} onClose={() => setOpenId(null)} title="奖励发放" sub={current?.payoutId}
        nav={{ onPrev: () => setOpenId(records[at - 1]?.payoutId ?? null), onNext: () => setOpenId(records[at + 1]?.payoutId ?? null), hasPrev: at > 0, hasNext: at >= 0 && at < records.length - 1 }}
        footer={current && actions(current, "md") ? <div className="rd-toolbar" data-end="">{actions(current, "md")}</div> : undefined}>
        {current && <PayoutDetail record={current} />}
      </Drawer>
    </Panel>
    </>
  );
}

function PayoutDetail({ record }: { record: F1RewardPayout }) {
  const reward = payoutReward(record);
  const status = PAYOUT_STATUS[record.status];
  return <KeyValues rows={[
    { key: "reward", label: "奖励", value: <span title={reward.raw}>{reward.main}{reward.unit && ` ${reward.unit}`}</span> },
    { key: "status", label: "状态", value: status ? <StatusTag tone={status.tone} icon={status.icon}>{status.label}</StatusTag> : "状态未知",
      explain: record.status === "FAILED" ? "发放失败的这页没有重试入口。" : undefined },
    { key: "user", label: "用户", value: record.userId },
    { key: "rank", label: "等级", value: dash(record.rankCode) },
    { key: "sponsor", label: "邀请人", value: dash(record.sponsorUserId), explain: "UVT 奖励默认发给邀请人；没有邀请人时发给本人。" },
    { key: "bill", label: "账单", value: dash(record.billId), mono: !!record.billId },
    { key: "event", label: "奖励记录", value: dash(record.commissionEventId), mono: !!record.commissionEventId, explain: "资金奖励对应的奖励记录；券、商品、自定义奖品没有。" },
    { key: "trigger", label: "触发事件", value: dash(record.triggerEventId), mono: !!record.triggerEventId },
    { key: "operator", label: "操作人", value: dash(record.operator) },
    { key: "reason", label: "原因", value: dash(record.reason) },
    { key: "granted", label: `发放时间（${businessZone().label}）`, value: formatBusinessTimeFull(record.grantedAt, "—"), explain: "抽屉里写到秒，方便和账单、奖励记录逐条对时间。" },
    { key: "reversed", label: `冲正时间（${businessZone().label}）`, value: formatBusinessTimeFull(record.reversedAt, "—") },
  ]} />;
}
