"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  fetchD2WithdrawalDetail,
  fetchD2Withdrawals,
  fetchD5WithdrawalParams,
  reviewD2Withdrawal,
  reviewD2WithdrawalsBatch,
  type D2BatchResult,
  type D2ReviewAction,
  type D2ReviewInput,
  type D2Withdrawal,
  type D5Params,
  type PageResult,
} from "@/lib/admin/d-client";
import type { BusinessFormSpec, BusinessFormValue } from "../design-kit";
import type { DCtx } from "./types";

const OPERATOR = currentAdminOperator;
const STATUS_TABS = [
  ["", "全部"], ["SUBMITTED", "已提交"], ["REVIEW_PENDING", "待审核"], ["EXTENDED_HOLD", "延长持有"], ["FROZEN", "冻结"],
  ["REVIEW_PASSED", "已放行"], ["PROCESSING", "处理中"], ["SENT", "已广播"], ["CONFIRMED", "已确认"],
  ["REVIEW_REJECTED", "审核拒绝"], ["ADDRESS_INVALID", "地址无效"], ["TX_FAILED", "链上失败"], ["TX_ORPHANED", "孤块/死亡信件"], ["REFUNDED", "已退款"],
] as const;

const ACTION_AUTHORITY: Record<D2ReviewAction, string> = {
  APPROVE: "finance_d2_withdrawal_approve",
  DELAY: "finance_d2_withdrawal_delay",
  FREEZE: "finance_d2_withdrawal_freeze",
  UNFREEZE: "finance_d2_withdrawal_unfreeze",
  REJECT: "finance_d2_withdrawal_reject",
  REFUND: "finance_d2_withdrawal_refund",
};

/** 批量操作面支持的动作(与 reviewD2WithdrawalsBatch 服务端签名同集合)。"" = 运营尚未显式选择。 */
const BATCH_ACTIONS = ["APPROVE", "REJECT", "DELAY", "FREEZE"] as const;
type D2BatchAction = (typeof BATCH_ACTIONS)[number];

function money(value: number) {
  return `$${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function timeText(value?: string) {
  return value ? value.replace("T", " ").slice(0, 19) : "—";
}

function reviewAtAfter(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 16);
}

function statusLabel(status: string) {
  return ({
    SUBMITTED: "已提交(submitted)", PENDING: "已提交(submitted)",
    REVIEW_PENDING: "待审核(review-pending)", REVIEWING: "待审核(review-pending)",
    EXTENDED_HOLD: "延长持有(extended-hold)", DELAYED: "延长持有(extended-hold)", FROZEN: "冻结(frozen)",
    REVIEW_PASSED: "已放行(review-passed)", PENDING_CHAIN: "已放行(review-passed)", PROCESSING: "处理中(processing)",
    SENT: "已广播(sent)", CHAIN_SUBMITTED: "已广播(sent)", CONFIRMED: "已确认(confirmed)", SUCCESS: "已确认(confirmed)",
    REVIEW_REJECTED: "审核拒绝(review-rejected)", REJECTED: "审核拒绝(review-rejected)", ADDRESS_INVALID: "地址无效(address-invalid)",
    TX_FAILED: "链上失败(tx-failed)", FAILED: "链上失败(tx-failed)", TX_ORPHANED: "孤块/死亡信件(tx-orphaned)", DEAD: "孤块/死亡信件(tx-orphaned)",
    REFUNDED: "已退款(refunded)",
  } as Record<string, string>)[status.toUpperCase()] ?? status;
}

function statusTone(status: string) {
  const value = status.toUpperCase();
  if (["CONFIRMED", "SUCCESS", "REFUNDED"].includes(value)) return "ok";
  if (["REVIEW_REJECTED", "REJECTED", "ADDRESS_INVALID", "TX_FAILED", "FAILED", "TX_ORPHANED", "DEAD"].includes(value)) return "bad";
  if (["FROZEN", "EXTENDED_HOLD", "DELAYED"].includes(value)) return "warn";
  return "dim";
}

function actionLabel(action: D2ReviewAction) {
  return ({ APPROVE: "放行", DELAY: "延迟", FREEZE: "冻结", UNFREEZE: "解冻", REJECT: "拒绝并退款", REFUND: "手动退款" } as const)[action];
}

function actionCandidates(row: D2Withdrawal): D2ReviewAction[] {
  const status = row.status.toUpperCase();
  if (["REVIEW_PENDING", "REVIEWING"].includes(status)) return ["APPROVE", "DELAY", "FREEZE", "REJECT"];
  if (["EXTENDED_HOLD", "DELAYED"].includes(status)) return [];
  if (["REVIEW_PASSED", "PENDING_CHAIN", "PROCESSING"].includes(status)) return ["FREEZE"];
  if (status === "FROZEN") return ["UNFREEZE"];
  if (["REVIEW_REJECTED", "REJECTED", "ADDRESS_INVALID", "TX_FAILED", "FAILED", "TX_ORPHANED", "DEAD"].includes(status)) return ["REFUND"];
  return [];
}

function k4RiskText(row: D2Withdrawal) {
  return row.riskScore === null ? "K4 风险评分不可用" : `K4 ${row.riskScore}`;
}

function routingPriority(row: D2Withdrawal) {
  return row.routingPriority || "UNAVAILABLE";
}

function routingPriorityLabel(row: D2Withdrawal) {
  return ({
    ESCALATED: "升级处置", HIGH: "高优先", NORMAL: "常规", LOW: "低优先", UNAVAILABLE: "事实不可用",
  } as const)[routingPriority(row)] ?? routingPriority(row);
}

function routingPriorityTone(row: D2Withdrawal) {
  const priority = routingPriority(row);
  if (priority === "ESCALATED" || priority === "HIGH") return "bad";
  if (priority === "UNAVAILABLE") return "warn";
  return "ok";
}

function routingUnavailable(row: D2Withdrawal) {
  return row.riskScore === null || routingPriority(row) === "UNAVAILABLE";
}

/**
 * 批量可执行判定 —— 勾选框禁用态与真正提交的 ids 共用这一处判定(两套判定必然漂移)。
 * 未选择动作("")时任何行都不可勾选:动作是批量语义的前提,先选动作再选行。
 */
function batchSelectable(row: D2Withdrawal, action: D2BatchAction | "") {
  if (!action) return false;
  return actionCandidates(row).includes(action) && !(action === "APPROVE" && routingUnavailable(row));
}

/**
 * 批量提交面 = 当前筛选后可见 ∩ 已勾选 ∩ 对当前动作可执行。
 * 「已选 N 笔」、批量按钮禁用态、确认弹窗笔数、真正提交的 ids 全部由这一处派生 ——
 * 否则前端筛选把行藏起来后,selected 里的隐藏行仍会被提交(运营看到 3 笔、实际提交 10 笔)。
 */
function batchTargets(visible: D2Withdrawal[], selectedIds: Set<string>, action: D2BatchAction | "") {
  return visible.filter((row) => selectedIds.has(row.withdrawalNo) && batchSelectable(row, action));
}

function actionBusinessForm(action: D2ReviewAction, row?: D2Withdrawal): BusinessFormSpec | undefined {
  if (action === "REJECT") return {
    kind: "multi-field", title: "拒绝与退款依据", fields: [
      { key: "reasonCode", label: "拒绝原因码", inputKind: "select", required: true, options: ["RISK_HIT", "ADDRESS_RISK", "DATA_MISMATCH", "USER_CANCELLED", "OTHER"], optionLabels: { RISK_HIT: "风控命中", ADDRESS_RISK: "地址风险", DATA_MISMATCH: "资料不符", USER_CANCELLED: "用户申诉撤回", OTHER: "其他" } },
    ],
  };
  if (action === "DELAY") return {
    kind: "multi-field", title: "延长持有生命周期", fields: [
      { key: "holdDays", label: "持有天数", inputKind: "number", required: true, min: 1, max: 45, current: "7" },
      { key: "owner", label: "责任人", required: true, current: OPERATOR() },
      { key: "reviewAt", label: "复查时间", inputKind: "datetime-local", required: true, current: reviewAtAfter(7) },
    ],
  };
  if (action === "FREEZE") return {
    kind: "multi-field", title: "冻结生命周期", fields: [
      { key: "period", label: "冻结期限", inputKind: "select", required: true, options: ["7d", "14d", "30d", "45d", "LONG_TERM"], optionLabels: { "7d": "7 天", "14d": "14 天", "30d": "30 天", "45d": "45 天", LONG_TERM: "长期需复查" } },
      { key: "owner", label: "责任人", required: true, current: OPERATOR() },
      { key: "reviewAt", label: "复查时间", inputKind: "datetime-local", required: true, current: reviewAtAfter(7) },
    ],
  };
  if (action === "REFUND") return {
    kind: "multi-field", title: "退款资金核验", fields: [
      { key: "fundsVerified", label: "链上未出金 / 资金未离开平台", inputKind: "select", required: true, options: ["true"], optionLabels: { true: "已核实" } },
    ],
  };
  if (action === "APPROVE" && (row?.amount ?? 0) >= 1000) return {
    kind: "multi-field", title: "大额放行核验", fields: [
      { key: "addressVerified", label: "地址与风险信息", inputKind: "select", required: true, options: ["true"], optionLabels: { true: "已核对" } },
    ],
  };
  return undefined;
}

function businessInput(value?: BusinessFormValue): D2ReviewInput {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    reason: "",
    reasonCode: typeof raw.reasonCode === "string" ? raw.reasonCode : undefined,
    holdDays: raw.holdDays === undefined ? undefined : Number(raw.holdDays),
    period: typeof raw.period === "string" ? raw.period : undefined,
    owner: typeof raw.owner === "string" ? raw.owner : undefined,
    reviewAt: typeof raw.reviewAt === "string" ? raw.reviewAt : undefined,
    fundsVerified: raw.fundsVerified === true || raw.fundsVerified === "true",
    addressVerified: raw.addressVerified === true || raw.addressVerified === "true",
  };
}

function operationKey(scope: string) {
  const compactScope = scope.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 12);
  const uuid = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `d2-${compactScope}-${uuid.replaceAll("-", "").slice(0, 16)}`;
}

/** 逐笔审核与批量审核共用一张表,靠 fingerprint 前缀分命名空间;刷新后仍能用同一命令号重试,
 *  避免运营在「结果未知」后重铸命令号导致重复放行 / 重复退款。 */
const pendingKeys = createPendingMutationStore({
  storageKey: "nexion-admin-d2-withdrawal-commands-v1",
});
/** 目标对象 id = 提现单号;动作类型 = APPROVE/REJECT/… —— 两者都进指纹,不同单不同动作不撞 key。 */
const reviewScope = (withdrawalNo: string, action: D2ReviewAction) => `review|${withdrawalNo}|${action}`;
/** 批量的目标对象 = 本次提交的提现单号集合(排序后),动作类型同上。 */
const batchScope = (action: D2BatchAction, ids: string[]) => `batch|${action}|${[...ids].sort().join(",")}`;

export function D2Withdrawals({ ctx }: { ctx: DCtx }) {
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const [rows, setRows] = useState<PageResult<D2Withdrawal>>({ total: 0, pageNum: 1, pageSize: 10, records: [] });
  const [d5, setD5] = useState<D5Params | null>(null);
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [minRiskScore, setMinRiskScore] = useState("");
  const [ruleFilter, setRuleFilter] = useState("");
  const [ipSegment, setIpSegment] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDirection, setSortDirection] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [writesEnabled, setWritesEnabled] = useState(false);
  const [submitting, setSubmitting] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 无默认动作:按权限过滤下拉后自动落到第一个可用项 =「运营以为选的是 A、实际执行 B」,与「提交隐藏行」同类。
  // 必须运营显式选择,选中前不可勾选、不可提交。
  const [batchAction, setBatchAction] = useState<D2BatchAction | "">("");
  const [detail, setDetail] = useState<D2Withdrawal | null>(null);
  /** 单调递增请求号:并发 load 时只有最后一发的响应可以落地,旧响应不许覆盖新筛选结果。 */
  const requestSeq = useRef(0);

  const hasAuthority = (authority: string) => authorities.includes(authority);
  const dailyLimit = d5?.dailyLimitCount ?? 0;

  const load = async (nextPage = page) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");
    setWritesEnabled(false);
    try {
      const [nextRows, nextD5] = await Promise.all([
        fetchD2Withdrawals({
          status, keyword, minAmount, maxAmount, minRiskScore, ipSegment, sortBy, sortDirection,
          pageNum: nextPage, pageSize,
        }),
        fetchD5WithdrawalParams(),
      ]);
      if (seq !== requestSeq.current) return;
      setRows(nextRows);
      setD5(nextD5);
      setSelected(new Set());
      setWritesEnabled(true);
    } catch (cause) {
      if (seq !== requestSeq.current) return;
      setRows({ total: 0, pageNum: 1, pageSize, records: [] });
      setD5(null);
      setError(cause instanceof Error ? displayAdminError(cause) : "D2 数据加载失败");
    } finally {
      // 过期响应连 loading 都不许收:新请求仍在飞,收了会假装「加载完成」。
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, page, pageSize]);

  const visibleRows = useMemo(() => {
    const rule = ruleFilter.trim().toLowerCase();
    return rule ? rows.records.filter((row) => `${row.hitRules} ${row.riskReason}`.toLowerCase().includes(rule)) : rows.records;
  }, [rows.records, ruleFilter]);
  const submittableRows = useMemo(() => batchTargets(visibleRows, selected, batchAction), [visibleRows, selected, batchAction]);
  // 纯前端筛选 / 批量动作变化时立即收窄选择:否则被筛掉的行还留在 selected 里,
  // 清空筛选后又悄悄复活成提交目标。
  useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) return current;
      const kept = batchTargets(visibleRows, current, batchAction).map((row) => row.withdrawalNo);
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [visibleRows, batchAction]);
  const pages = Math.max(1, Math.ceil(rows.total / Math.max(1, rows.pageSize)));

  const runReview = async (row: D2Withdrawal, action: D2ReviewAction, reason: string, form?: BusinessFormValue) => {
    const scope = reviewScope(row.withdrawalNo, action);
    const key = pendingKeys.get(scope) ?? operationKey(scope);
    pendingKeys.remember(scope, key);
    setSubmitting(scope);
    try {
      const updated = await reviewD2Withdrawal(row.withdrawalNo, action, { ...businessInput(form), reason }, OPERATOR(), key);
      pendingKeys.forget(scope);
      toast(`${row.withdrawalNo} 已${actionLabel(action)} · ${statusLabel(updated.status)} · 已记账/审计`);
      setDetail(updated);
      await load();
    } catch (cause) {
      const message = cause instanceof Error ? displayAdminError(cause) : "D2 审核失败";
      await load();
      setError(message);
      toast(message);
      throw cause;
    } finally {
      setSubmitting("");
    }
  };

  const confirmReview = (row: D2Withdrawal, action: D2ReviewAction) => {
    if (action === "APPROVE" && routingUnavailable(row)) {
      toast("K4 路由事实不可用，已关闭放行操作");
      return;
    }
    const label = actionLabel(action);
    openActionConfirm({
      action: `${label}提现 · ${row.withdrawalNo}`,
      detail: `${row.userNo} / ${money(row.amount)} ${row.asset}；当前 ${statusLabel(row.status)}；${k4RiskText(row)}；K3 命中 ${row.hitRules || "无"}；C4 KYC ${row.kycStatus}；C2 账户 ${row.userStatus}。${action === "APPROVE" ? `B1 当前覆盖率 ${d5?.coverageRatio ?? "—"}%，红线 ${d5?.redlinePct ?? "—"}%。确认后即时执行并核减 D3 储备。` : "确认后即时执行，结果写入审计与 A4 事件。"}`,
      amplifies: action === "APPROVE",
      coverage: d5 ? { coverageRatio: d5.coverageRatio, redlinePct: d5.redlinePct } : undefined,
      businessForm: actionBusinessForm(action, row),
      reasonMin: 8,
      reasonMax: 200,
      completionCopy: `${label}完成`,
      run: (reason, _newValue, businessValue) => runReview(row, action, reason, businessValue),
    });
  };

  const openDetail = async (row: D2Withdrawal) => {
    try { setDetail(await fetchD2WithdrawalDetail(row.withdrawalNo)); }
    catch (cause) { toast(cause instanceof Error ? displayAdminError(cause) : "单笔详情加载失败"); }
  };

  const confirmBatch = () => {
    const action = batchAction;
    if (!action) { toast("请先选择批量动作，再勾选要执行的提现单"); return; }
    // 只提交「当前筛选结果里真正可执行」的行；弹窗里报的笔数与下面 run 提交的是同一个 ids。
    const ids = submittableRows.map((row) => row.withdrawalNo);
    if (ids.length === 0) { toast("当前筛选结果里没有可执行该动作的提现单"); return; }
    openActionConfirm({
      action: `批量执行 · ${actionLabel(action)}`,
      detail: `将对当前筛选结果中的 ${ids.length} 笔执行${actionLabel(action)}（被筛选隐藏的、以及当前状态不能执行该动作的提现单已自动排除）。批量放行会由服务端自动分拣：小额执行，大额转单笔人工审核，不会整批失败；每笔单独审计并记录批次号。`,
      amplifies: batchAction === "APPROVE",
      coverage: d5 ? { coverageRatio: d5.coverageRatio, redlinePct: d5.redlinePct } : undefined,
      businessForm: actionBusinessForm(action),
      reasonMin: 8,
      reasonMax: 200,
      run: async (reason, _newValue, businessValue) => {
        const scope = batchScope(action, ids);
        const key = pendingKeys.get(scope) ?? operationKey(scope);
        pendingKeys.remember(scope, key);
        setSubmitting(scope);
        try {
          const result: D2BatchResult = await reviewD2WithdrawalsBatch(action, ids, { ...businessInput(businessValue), reason }, OPERATOR(), key);
          pendingKeys.forget(scope);
          toast(`批次 ${result.batchId} 已执行：${result.accepted.length} 成功 / ${result.rejected.length} 笔大额转单笔 / ${result.conflicts.length} 冲突`);
          await load();
        } finally { setSubmitting(""); }
      },
    });
  };

  if (loading && rows.records.length === 0) return <section className="l-card"><div className="l-b">D2 数据加载中...</div></section>;

  return <>
    {error && <div className="dtint warn" style={{ marginBottom: 12 }}>D2 数据加载失败 · {error} · 写操作已关闭，请重试。 <button className="l-btn sm" onClick={() => void load(1)}>重试</button></div>}
    <div className="f-stats">
      <div className="f-stat"><div className="k">当前筛选</div><div className="v">{rows.total}</div><div className="sub">服务端分页总数</div></div>
      <div className="f-stat cyan"><div className="k">本页金额</div><div className="v">{money(visibleRows.reduce((sum, row) => sum + row.amount, 0))}</div><div className="sub">{visibleRows.length} 笔</div></div>
      <div className="f-stat warn"><div className="k">高优先队列</div><div className="v">{visibleRows.filter((row) => ["HIGH", "ESCALATED"].includes(routingPriority(row))).length}</div><div className="sub">按当前生效 K4 模型动态路由</div></div>
      <div className="f-stat danger"><div className="k">D5 日限</div><div className="v">{dailyLimit || "—"}</div><div className="sub">依赖事实读取失败时关闭写操作</div></div>
    </div>

    <section className="l-card">
      <div className="l-h"><span className="ttl">提现审核队列</span><span className="sub">· 服务端权威状态 · 逐笔 / 批量</span></div>
      <div className="l-b d2-filter-grid">
        <label className="d2-filter-field"><span>提现单 / 用户</span><input value={keyword} onChange={(event) => setKeyword(event.target.value)} /></label>
        <label className="d2-filter-field"><span>状态</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>{STATUS_TABS.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}</select></label>
        <label className="d2-filter-field"><span>最低金额</span><input type="number" min="0" value={minAmount} onChange={(event) => setMinAmount(event.target.value)} /></label>
        <label className="d2-filter-field"><span>最高金额</span><input type="number" min="0" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} /></label>
        <label className="d2-filter-field"><span>最低风险分</span><input type="number" min="0" max="100" value={minRiskScore} onChange={(event) => setMinRiskScore(event.target.value)} /></label>
        <label className="d2-filter-field"><span>命中规则</span><input value={ruleFilter} onChange={(event) => setRuleFilter(event.target.value)} /></label>
        <label className="d2-filter-field"><span>IP 段</span><input placeholder="例如 192.168.1" value={ipSegment} onChange={(event) => setIpSegment(event.target.value)} /></label>
        <label className="d2-filter-field"><span>排序字段</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="createdAt">提交时间</option><option value="amount">金额</option><option value="riskScore">风险分</option><option value="status">状态</option></select></label>
        <label className="d2-filter-field"><span>排序方向</span><select value={sortDirection} onChange={(event) => setSortDirection(event.target.value)}><option value="desc">降序</option><option value="asc">升序</option></select></label>
        <button className="l-btn primary" onClick={() => { setPage(1); void load(1); }}>查询</button>
      </div>
      {hasAuthority("finance_d2_withdrawal_batch") && <div className="l-b" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong>批量操作面</strong>
        <select aria-label="批量动作" value={batchAction} onChange={(event) => setBatchAction(event.target.value as D2BatchAction | "")}>
          <option value="">请先选择批量动作</option>
          {BATCH_ACTIONS.filter((action) => hasAuthority(ACTION_AUTHORITY[action])).map((action) => <option key={action} value={action}>{actionLabel(action)}</option>)}
        </select>
        <span>已选 {submittableRows.length} 笔</span>
        <button className="l-btn primary" disabled={!writesEnabled || !batchAction || submittableRows.length === 0 || !!submitting} onClick={confirmBatch}>批量执行</button>
        <span className="sub">{!batchAction ? "未选择批量动作时不能勾选、不能提交" : "笔数只统计当前筛选结果里可执行的提现单，换筛选条件会同步收窄"}</span>
      </div>}
      <div style={{ overflowX: "auto" }}><table className="l-tbl" style={{ minWidth: 1360 }}>
        <thead><tr><th>选择</th><th>提现单</th><th>用户</th><th>资产/链</th><th className="num">金额/手续费</th><th>审核依据</th><th>24h</th><th>状态</th><th>生命周期/异常</th><th>提交时间</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
        <tbody>{visibleRows.length === 0 ? <tr><td colSpan={11} style={{ textAlign: "center", padding: 28 }}>暂无提现记录</td></tr> : visibleRows.map((row) => {
          const selectable = batchSelectable(row, batchAction);
          return <tr key={row.withdrawalNo}>
            <td><input aria-label={`选择 ${row.withdrawalNo}`} type="checkbox" disabled={!selectable} checked={selected.has(row.withdrawalNo)} onChange={(event) => setSelected((current) => { const next = new Set(current); event.target.checked ? next.add(row.withdrawalNo) : next.delete(row.withdrawalNo); return next; })} /></td>
            <td><button className="l-btn sm" onClick={() => void openDetail(row)}>{row.withdrawalNo}</button></td>
            <td>{row.userNo}<div className="sub">{row.nickname}</div></td>
            <td>{row.asset} / {row.chain}<div className="mono sub">{row.targetAddress}</div></td>
            {/* FEAT-WD02 费用双形态:新单(feeModel=confirm)只渲染确认费快照,旧单保持全量旧字段 ——
                单一渲染面对新单会打出一串 null/undefined,双形态分支是显式交付物。 */}
            <td className="num"><strong>{money(row.amount)}</strong>{row.feeModel === "confirm" ? <>
              <div className="sub">网络确认费 {money(row.networkConfirmUsd ?? 0)}(每笔固定 · 新费用模型)</div>
              <div className="sub">NEX抵扣 {row.nexBurned} × ${row.nexFeeOffsetRate}/NEX · 费用减免 {money(row.feeWaived)}</div>
              <div className="sub">实际手续费 {money(row.actualFee)} · 实际到账 {money(row.netReceive)}</div>
            </> : <>
              <div className="sub">网络费 {money(row.networkFee ?? 0)} · 费率 {row.networkFeeRate} · 区间 {money(row.networkFeeMin ?? 0)}–{money(row.networkFeeMax ?? 0)}</div>
              <div className="sub">毛手续费 {money(row.grossFee ?? 0)} · 按金额费率 {row.penaltyFeeRate}%(旧模型历史单)</div>
              <div className="sub">NEX抵扣 {row.nexBurned} × ${row.nexFeeOffsetRate}/NEX · 费用减免 {money(row.feeWaived)}</div>
              <div className="sub">实际手续费 {money(row.actualFee)} · 实际到账 {money(row.netReceive)}</div>
            </>}</td>
            <td><span className={`bdg ${routingPriorityTone(row)}`}>{routingPriorityLabel(row)} · {k4RiskText(row)}</span><div className="sub">当前模型阈值 {row.k4BandLowMax ?? "—"} / {row.k4BandHighMin ?? "—"} / 升级 {row.k4AutoEscalateScore ?? "—"}</div><div className="sub">K3 {row.k3RiskRoute || "—"} · {row.hitRules || "无"}</div><div className="sub">C4 {row.kycStatus} · C2 {row.userStatus}</div></td>
            <td>{row.withdrawalCount24h}/{dailyLimit || "—"}</td>
            <td><span className={`bdg ${statusTone(row.status)}`}>{statusLabel(row.status)}</span></td>
            <td className="sub">{row.failureReason || "—"}</td>
            <td>{timeText(row.createdAt)}</td>
            <td style={{ textAlign: "right" }}><div style={{ display: "flex", flexWrap: "wrap", gap: 5, justifyContent: "flex-end" }}>
              <button className="l-btn sm" onClick={() => void openDetail(row)}>单笔详情</button>
              {actionCandidates(row).filter((action) => hasAuthority(ACTION_AUTHORITY[action])).map((action) => <button key={action} className="l-btn sm" disabled={!writesEnabled || !!submitting || (action === "APPROVE" && routingUnavailable(row))} onClick={() => confirmReview(row, action)}>{actionLabel(action)}</button>)}
            </div></td>
          </tr>;
        })}</tbody>
      </table></div>
      <div className="l-b" style={{ display: "flex", justifyContent: "space-between" }}><span>共 {rows.total} 条 · 第 {rows.pageNum}/{pages} 页</span><div className="chips">{[10, 20, 50].map((size) => <button key={size} className={`chip${pageSize === size ? " sel" : ""}`} onClick={() => { setPageSize(size); setPage(1); }}>{size}/页</button>)}<button className="chip" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><button className="chip" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>下一页</button></div></div>
    </section>

    {detail && <section className="l-card" aria-label="D2 单笔详情">
      <div className="l-h"><span className="ttl">单笔详情 · {detail.withdrawalNo}</span><button className="l-btn sm" onClick={() => setDetail(null)}>关闭</button></div>
      <div className="l-b"><div className="f-stats">
        <div className="f-stat"><div className="k">C1 用户画像</div><div className="v">{detail.userNo} · {detail.userLevel}</div><div className="sub">{detail.nickname} · {detail.phoneMasked || "未展示手机号"} · IP 段 {detail.ipSegment}</div></div>
        <div className="f-stat warn"><div className="k">K4 / K3</div><div className="v">{routingPriorityLabel(detail)} · {k4RiskText(detail)}</div><div className="sub">当前模型阈值 {detail.k4BandLowMax ?? "—"} / {detail.k4BandHighMin ?? "—"} / 升级 {detail.k4AutoEscalateScore ?? "—"}</div><div className="sub">K3 路由 {detail.k3RiskRoute || "—"} · {detail.hitRules || "无命中"} · {detail.riskReason || "无补充原因"}</div><div className="sub">K4 评分明细：{detail.riskScoreBreakdown}</div></div>
        <div className="f-stat cyan"><div className="k">C4 / C2</div><div className="v">{detail.kycStatus}</div><div className="sub">账户 {detail.userStatus} · 24h 第 {detail.withdrawalCount24h} 笔</div></div>
        <div className="f-stat"><div className="k">当前状态</div><div className="v">{statusLabel(detail.status)}</div><div className="sub">{detail.failureReason || "无异常/生命周期备注"}</div><div className="sub">复查 {timeText(detail.holdUntil)} · 责任人 {detail.lifecycleOwner || "—"} · 期限 {detail.freezePeriod || "—"}</div></div>
      </div><p><strong>设备事实：</strong>{detail.deviceSummary}</p><p><strong>推荐位置：</strong>{detail.referralPosition}</p>{detail.feeModel === "confirm"
        ? <p><strong>费用明细：</strong>网络确认费 {money(detail.networkConfirmUsd ?? 0)}（每笔固定 · 新费用模型）；NEX抵扣 {detail.nexBurned}；NEX抵扣率 ${detail.nexFeeOffsetRate}/NEX；费用减免 {money(detail.feeWaived)}；实际手续费 {money(detail.actualFee)}；实际到账 {money(detail.netReceive)}</p>
        : <p><strong>费用明细：</strong>网络费 {money(detail.networkFee ?? 0)}（费率 {detail.networkFeeRate}，区间 {money(detail.networkFeeMin ?? 0)}–{money(detail.networkFeeMax ?? 0)}）；毛手续费 {money(detail.grossFee ?? 0)}；按金额费率 {detail.penaltyFeeRate}%（旧模型历史单）；NEX抵扣 {detail.nexBurned}；NEX抵扣率 ${detail.nexFeeOffsetRate}/NEX；费用减免 {money(detail.feeWaived)}；实际手续费 {money(detail.actualFee)}；实际到账 {money(detail.netReceive)}</p>}<p><strong>全部提现历史：</strong>{detail.withdrawalHistory}</p><p><strong>状态历史：</strong>{detail.statusHistory || "暂无"}</p><p><strong>审计轨迹：</strong>{detail.auditTrail || "暂无"}</p></div>
    </section>}
  </>;
}
