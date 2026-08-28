"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  fetchD2WithdrawalDetail,
  fetchD2Withdrawals,
  fetchD2DevelopmentCapabilities,
  fetchD5WithdrawalParams,
  reviewD2Withdrawal,
  reviewD2WithdrawalsBatch,
  simulateD2CooldownExpiry,
  type D2BatchResult,
  type D2DevelopmentCapabilities,
  type D2ReviewAction,
  type D2ReviewInput,
  type D2Withdrawal,
  type D5Params,
  type PageResult,
  isDOutcomeUnknownError,
} from "@/lib/admin/d-client";
import { Drawer, KV, type BusinessFormSpec, type BusinessFormValue } from "../design-kit";
import type { DCtx } from "./types";

const OPERATOR = currentAdminOperator;
const STATUS_TABS = [
  ["", "全部"], ["SUBMITTED", "已提交"], ["REVIEW_PENDING", "待审核"], ["EXTENDED_HOLD", "冷却期等待复查"], ["FROZEN", "冻结"],
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
    SUBMITTED: "已提交", PENDING: "已提交",
    REVIEW_PENDING: "待审核", REVIEWING: "待审核",
    EXTENDED_HOLD: "冷却期等待复查", DELAYED: "延迟复查", FROZEN: "冻结",
    REVIEW_PASSED: "已放行", PENDING_CHAIN: "已放行", PROCESSING: "处理中",
    SENT: "已广播", CHAIN_SUBMITTED: "已广播", CONFIRMED: "已确认", SUCCESS: "已确认",
    REVIEW_REJECTED: "审核拒绝", REJECTED: "审核拒绝", ADDRESS_INVALID: "地址无效",
    TX_FAILED: "链上失败", FAILED: "链上失败", TX_ORPHANED: "孤块/死亡信件", DEAD: "孤块/死亡信件",
    REFUNDED: "已退款",
  } as Record<string, string>)[status.toUpperCase()] ?? "未知状态";
}

const FAILURE_REASON_LABELS: Record<string, string> = {
  H1_COOLDOWN_FAST_TRACK: "低风险提现冷却中，到期后系统自动复查",
  H1_COOLDOWN_FAST_TRACK_APPROVED: "冷却期已结束，系统已自动放行",
  A3_STRONG_REVIEW_THRESHOLD: "达到大额加强审核门槛，需人工复核",
  K3_RULE_DELAY: "命中 K3 延迟规则，等待到期复查",
  K3_RULE_FREEZE: "命中 K3 冻结规则，需人工核验",
  K3_ROUTE_UNAVAILABLE: "K3 路由结论暂不可用，已转人工复核",
  K4_RISK_SCORE_UNAVAILABLE: "K4 风险评分暂不可用，已转人工复核",
  WITHDRAWAL_PAYOUT_SUBMISSION_UNKNOWN: "链上提交结果待确认，请勿重复放行",
  WITHDRAWAL_PAYOUT_PROVIDER_FAILED: "链上服务返回失败，等待人工处置",
};

const OPERATION_TEXT_LABELS: Record<string, string> = {
  REVIEW_REJECTED: "审核拒绝",
  ADDRESS_INVALID: "地址无效",
  EXTENDED_HOLD: "冷却期等待复查",
  REVIEW_PENDING: "待审核",
  REVIEW_PASSED: "已放行",
  TX_ORPHANED: "孤块/死亡信件",
  TX_FAILED: "链上失败",
  PROCESSING: "处理中",
  CONFIRMED: "已确认",
  REFUNDED: "已退款",
  SUBMITTED: "已提交",
  FROZEN: "冻结",
  SENT: "已广播",
  APPROVE: "放行",
  REJECT: "拒绝",
  DELAY: "延迟复查",
  UNFREEZE: "解冻",
  FREEZE: "冻结",
  REFUND: "退款",
  "K3_ROUTE:pass": "K3 路由：通过",
  "K3_ROUTE:delay": "K3 路由：延迟复查",
  "K3_ROUTE:manual": "K3 路由：人工复核",
  "K3_ROUTE:freeze": "K3 路由：冻结核验",
  "withdraw.submitted": "提现已提交",
  "withdraw.review_due": "到期转人工复核",
  "withdraw.approved": "提现已放行",
  "withdraw.rejected": "提现已拒绝",
  "withdraw.delayed": "提现已延迟复查",
  "withdraw.frozen": "提现已冻结",
  "withdraw.sent": "提现已广播上链",
  "withdraw.confirmed": "提现已确认到账",
};

function operationalText(value?: string) {
  const raw = value?.trim();
  if (!raw) return "—";
  if (FAILURE_REASON_LABELS[raw]) return FAILURE_REASON_LABELS[raw];
  let result = raw;
  for (const [code, label] of Object.entries(OPERATION_TEXT_LABELS).sort(([left], [right]) => right.length - left.length)) {
    result = result.replaceAll(code, label);
  }
  for (const [code, label] of Object.entries(FAILURE_REASON_LABELS).sort(([left], [right]) => right.length - left.length)) {
    result = result.replaceAll(code, label);
  }
  if (result === raw && /^[A-Z0-9_.:-]+$/i.test(raw)) {
    return "系统返回了未收录的处置原因，请联系技术人员排查";
  }
  if (!/[\u3400-\u9fff]/.test(result) && /[A-Z_]/i.test(result)) {
    return "系统返回了未收录的处置说明，请联系技术人员排查";
  }
  return result;
}

function ruleSummary(value?: string) {
  const localized = operationalText(value);
  return localized === "—" ? "无命中" : localized;
}

function lifecycleSummary(row: D2Withdrawal) {
  const reason = operationalText(row.failureReason);
  if (reason !== "—") return reason;
  if (["EXTENDED_HOLD", "DELAYED"].includes(row.status.toUpperCase())) return "等待复查时间，到期后系统自动转回待审核";
  if (row.status.toUpperCase() === "FROZEN") return "资金已冻结，需由有权限人员核验后解冻";
  return "无异常，按提现状态机正常流转";
}

function routeLabel(value?: string) {
  return ({ pass: "通过", delay: "延迟复查", manual: "人工复核", freeze: "冻结核验", "fast-pass": "快速通道" } as Record<string, string>)[value?.toLowerCase() ?? ""] ?? (value ? "未识别路由" : "未提供");
}

function userStatusLabel(value?: string) {
  return ({ active: "正常", enabled: "正常", frozen: "冻结", disabled: "停用", locked: "锁定" } as Record<string, string>)[value?.toLowerCase() ?? ""] ?? (value ? "未识别账户状态" : "未知");
}

function freezePeriodLabel(value?: string) {
  return ({ "7d": "7 天", "14d": "14 天", "30d": "30 天", "45d": "45 天", LONG_TERM: "长期（需复查）", SEVEN_DAYS: "7 天" } as Record<string, string>)[value ?? ""] ?? (value ? "未识别期限" : "—");
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

/** 状态流转图。节点名取 STATUS_TABS,分支与 actionCandidates 同一套判断。 */
const STATUS_CN: Record<string, string> = Object.fromEntries(STATUS_TABS.filter(([code]) => code).map(([code, label]) => [code, label]));
const D2_HAPPY_PATH = ["SUBMITTED", "REVIEW_PENDING", "REVIEW_PASSED", "PROCESSING", "SENT", "CONFIRMED"];
/** 终态:走到这里就结束,没有出边是对的,不该被下面的死结自检报出来。 */
const D2_TERMINAL = new Set(["CONFIRMED", "REFUNDED"]);
const D2_BRANCHES: { from: string[]; trigger: string; to: string[]; note: string }[] = [
  { from: ["REVIEW_PENDING"], trigger: "点「延迟」", to: ["EXTENDED_HOLD"], note: "操作时要填复查时间" },
  { from: ["EXTENDED_HOLD"], trigger: "等到复查时间", to: ["REVIEW_PENDING"], note: "这一步本页没有按钮,到点由系统送回待审核" },
  { from: ["REVIEW_PENDING", "REVIEW_PASSED", "PROCESSING"], trigger: "点「冻结」", to: ["FROZEN"], note: "广播上链之前都还拦得住" },
  { from: ["FROZEN"], trigger: "点「解冻」", to: ["REVIEW_PENDING"], note: "回到待审核重新决定" },
  { from: ["REVIEW_PENDING"], trigger: "点「拒绝并退款」", to: ["REVIEW_REJECTED"], note: "要填拒绝原因码" },
  { from: ["SENT"], trigger: "链上回执", to: ["ADDRESS_INVALID", "TX_FAILED", "TX_ORPHANED"], note: "由链上结果决定,不是人工动作" },
  { from: ["REVIEW_REJECTED", "ADDRESS_INVALID", "TX_FAILED", "TX_ORPHANED"], trigger: "手动退款", to: ["REFUNDED"], note: "提交前要先核实资金没离开平台" },
];

function StatusFlowChip({ code }: { code: string }) {
  return <span className={`bdg ${statusTone(code)}`} style={{ whiteSpace: "nowrap" }}>{STATUS_CN[code] ?? code}</span>;
}

function D2StatusFlow() {
  const drawn = new Set([...D2_HAPPY_PATH, ...D2_BRANCHES.flatMap((b) => [...b.from, ...b.to])]);
  const undrawn = Object.keys(STATUS_CN).filter((code) => !drawn.has(code));
  // 「画上了」不等于「说清楚了」:只查节点在不在,查不出「有入边没出边」的死结 ——
  // 而死结恰恰是最误导的形态(图看着完整,读的人却找不到这个状态之后会怎样)。
  const hasOutEdge = new Set([
    ...D2_HAPPY_PATH.slice(0, -1),
    ...D2_BRANCHES.flatMap((b) => b.from),
  ]);
  const deadEnds = [...drawn].filter((code) => !D2_TERMINAL.has(code) && !hasOutEdge.has(code));
  return (
    <section className="l-card">
      <div className="l-h"><span className="ttl">提现状态怎么流转</span><span className="sub">· 共 {Object.keys(STATUS_CN).length} 个状态 · 与队列里的筛选项同一套</span></div>
      <div className="l-b" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, textWrap: "pretty" }}>
        <span style={{ color: "var(--ink-3)", fontSize: 12, marginRight: 4 }}>正常走完:</span>
        {D2_HAPPY_PATH.map((code, index) => (
          <span key={code} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {index > 0 && <span style={{ color: "var(--ink-4)" }}>→</span>}
            <StatusFlowChip code={code} />
          </span>
        ))}
      </div>
      <div className="l-b">
        <table className="l-tbl" style={{ width: "100%" }}>
          <thead><tr><th>从哪个状态</th><th>发生什么</th><th>去哪个状态</th><th>说明</th></tr></thead>
          <tbody>
            {D2_BRANCHES.map((branch) => (
              <tr key={`${branch.from.join("+")}-${branch.trigger}`}>
                <td><span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>{branch.from.map((code) => <StatusFlowChip key={code} code={code} />)}</span></td>
                <td style={{ whiteSpace: "nowrap" }}>{branch.trigger}</td>
                <td><span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>{branch.to.map((code) => <StatusFlowChip key={code} code={code} />)}</span></td>
                <td style={{ color: "var(--ink-3)", fontSize: 12, textWrap: "pretty" }}>{branch.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {undrawn.length > 0 && (
          <div className="dtint warn" style={{ marginTop: 10 }}>
            这张图还没画到的状态:{undrawn.map((code) => STATUS_CN[code]).join("、")}。请补进流转图后再对外讲。
          </div>
        )}
        {deadEnds.length > 0 && (
          <div className="dtint warn" style={{ marginTop: 10 }}>
            这些状态画上了、却没写它之后会怎样:{deadEnds.map((code) => STATUS_CN[code] ?? code).join("、")}。
            补一条出边,或把它登记成终态。
          </div>
        )}
      </div>
    </section>
  );
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
  } as const)[routingPriority(row)] ?? "事实不可用";
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
 * 未选择动作时允许先勾选具备任一可用批量动作的行；真正提交时仍按已选动作再次收窄。
 */
function batchSelectable(row: D2Withdrawal, action: D2BatchAction | "", allowedActions: readonly D2BatchAction[]) {
  const candidates = action ? [action] : allowedActions;
  return candidates.some((candidate) => allowedActions.includes(candidate)
    && actionCandidates(row).includes(candidate)
    && !(candidate === "APPROVE" && routingUnavailable(row)));
}

/**
 * 批量提交面 = 当前筛选后可见 ∩ 已勾选 ∩ 对当前动作可执行。
 * 「已选 N 笔」、批量按钮禁用态、确认弹窗笔数、真正提交的 ids 全部由这一处派生 ——
 * 否则前端筛选把行藏起来后,selected 里的隐藏行仍会被提交(运营看到 3 笔、实际提交 10 笔)。
 */
function batchTargets(visible: D2Withdrawal[], selectedIds: Set<string>, action: D2BatchAction | "", allowedActions: readonly D2BatchAction[]) {
  return visible.filter((row) => selectedIds.has(row.withdrawalNo) && batchSelectable(row, action, allowedActions));
}

function actionBusinessForm(action: D2ReviewAction, row?: D2Withdrawal): BusinessFormSpec | undefined {
  if (action === "REJECT") return {
    kind: "multi-field", title: "拒绝与退款依据", fields: [
      { key: "reasonCode", label: "拒绝原因码", inputKind: "select", required: true, options: ["RISK_HIT", "ADDRESS_RISK", "DATA_MISMATCH", "USER_CANCELLED", "OTHER"], optionLabels: { RISK_HIT: "风控命中", ADDRESS_RISK: "地址风险", DATA_MISMATCH: "资料不符", USER_CANCELLED: "用户申诉撤回", OTHER: "其他" } },
    ],
  };
  if (action === "DELAY") return {
    kind: "multi-field", title: "延迟这笔提现，到期后自动回到待审核", fields: [
      { key: "holdDays", label: "等待天数", inputKind: "number", required: true, min: 1, max: 45, current: "7" },
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
const developmentSimulationScope = (withdrawalNo: string) => `simulate-due|${withdrawalNo}`;

function developmentSimulationEligible(row: D2Withdrawal) {
  return row.status.toUpperCase() === "EXTENDED_HOLD"
    && row.lifecycleOwner === "H1_PHASE_COOLDOWN"
    && row.previousStatus.toUpperCase() === "REVIEW_PASSED"
    && !!row.holdUntil;
}

export function D2Withdrawals({ ctx }: { ctx: DCtx }) {
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const [rows, setRows] = useState<PageResult<D2Withdrawal>>({ total: 0, pageNum: 1, pageSize: 10, records: [] });
  const [d5, setD5] = useState<D5Params | null>(null);
  const [developmentCapabilities, setDevelopmentCapabilities] = useState<D2DevelopmentCapabilities | null>(null);
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [minRiskScore, setMinRiskScore] = useState("");
  const [ruleFilter, setRuleFilter] = useState("");
  const [ipSegment, setIpSegment] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDirection, setSortDirection] = useState("desc");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [writesEnabled, setWritesEnabled] = useState(false);
  const [submitting, setSubmitting] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 无默认动作：必须由运营显式选择后才可提交；但允许先勾选，再选动作。
  const [batchAction, setBatchAction] = useState<D2BatchAction | "">("");
  const [detail, setDetail] = useState<D2Withdrawal | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  /** 单调递增请求号:并发 load 时只有最后一发的响应可以落地,旧响应不许覆盖新筛选结果。 */
  const requestSeq = useRef(0);
  /** 详情抽屉同样只接受最后一次请求；关闭抽屉会主动让在途响应失效。 */
  const detailRequestSeq = useRef(0);

  const hasAuthority = (authority: string) => authorities.includes(authority);
  const availableBatchActions = BATCH_ACTIONS.filter((action) => hasAuthority(ACTION_AUTHORITY[action]));
  const dailyLimit = d5?.dailyLimitCount ?? 0;

  type D2FilterOverrides = Partial<{
    status: string; keyword: string; minAmount: string; maxAmount: string; minRiskScore: string;
    ipSegment: string; sortBy: string; sortDirection: string; pageSize: number;
  }>;

  const load = async (nextPage = page, overrides: D2FilterOverrides = {}) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");
    setWritesEnabled(false);
    try {
      const [nextRows, nextD5] = await Promise.all([
        fetchD2Withdrawals({
          status: overrides.status ?? status,
          keyword: overrides.keyword ?? keyword,
          minAmount: overrides.minAmount ?? minAmount,
          maxAmount: overrides.maxAmount ?? maxAmount,
          minRiskScore: overrides.minRiskScore ?? minRiskScore,
          ipSegment: overrides.ipSegment ?? ipSegment,
          sortBy: overrides.sortBy ?? sortBy,
          sortDirection: overrides.sortDirection ?? sortDirection,
          pageNum: nextPage,
          pageSize: overrides.pageSize ?? pageSize,
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
  useEffect(() => {
    let active = true;
    void fetchD2DevelopmentCapabilities()
      .then((capabilities) => { if (active) setDevelopmentCapabilities(capabilities); })
      .catch(() => { if (active) setDevelopmentCapabilities(null); });
    return () => { active = false; };
  }, []);

  const visibleRows = useMemo(() => {
    const rule = ruleFilter.trim().toLowerCase();
    return rule ? rows.records.filter((row) => `${row.hitRules} ${row.riskReason}`.toLowerCase().includes(rule)) : rows.records;
  }, [rows.records, ruleFilter]);
  const selectedRows = useMemo(
    () => batchTargets(visibleRows, selected, "", availableBatchActions),
    // authorities only changes with the authenticated session; keeping the derived action list explicit avoids hidden defaults.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleRows, selected, authorities],
  );
  const submittableRows = useMemo(
    () => batchTargets(visibleRows, selected, batchAction, availableBatchActions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleRows, selected, batchAction, authorities],
  );
  // 纯前端筛选变化时只剔除已不可见或完全没有批量权限的行。
  // 切换批量动作不静默取消勾选；不适用当前动作的行保留勾选，并在提交面明确显示“可执行 N 笔”。
  useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) return current;
      const kept = batchTargets(visibleRows, current, "", availableBatchActions).map((row) => row.withdrawalNo);
      return kept.length === current.size ? current : new Set(kept);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows, authorities]);
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
      // 🔴 确定性拒绝必须丢号(2026-08-06 收尾审计,运营镜头与红队镜头独立同时点名):
      //   4xx 被驳回后运营会改输入重提,若还留着旧号 = 同号不同载荷 → 后端判载荷不符 →
      //   这张单子的这个动作 24h 内做不了,界面还没有清除入口。
      //   结果未知则必须保号 —— 丢了重试就是铸新号 = 重复出金。
      if (!isDOutcomeUnknownError(cause)) pendingKeys.forget(scope);
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
      detail: `${row.userNo} / ${money(row.amount)} ${row.asset}；当前 ${statusLabel(row.status)}；${k4RiskText(row)}；K3 命中 ${ruleSummary(row.hitRules)}；C2 账户 ${userStatusLabel(row.userStatus)}。${action === "APPROVE" ? `B1 当前覆盖率 ${d5?.coverageRatio ?? "—"}%，红线 ${d5?.redlinePct ?? "—"}%。确认后即时执行并核减 D3 储备。` : "确认后即时执行，结果写入审计与 A4 事件。"}`,
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
    const seq = ++detailRequestSeq.current;
    setDetail(row);
    setDetailLoading(true);
    setDetailError("");
    try {
      const latest = await fetchD2WithdrawalDetail(row.withdrawalNo);
      if (seq === detailRequestSeq.current) setDetail(latest);
    } catch (cause) {
      if (seq !== detailRequestSeq.current) return;
      const message = cause instanceof Error ? displayAdminError(cause) : "单笔详情加载失败";
      setDetailError(message);
      toast(message);
    } finally {
      if (seq === detailRequestSeq.current) setDetailLoading(false);
    }
  };

  const runDevelopmentSimulation = async (row: D2Withdrawal, reason: string) => {
    const scope = developmentSimulationScope(row.withdrawalNo);
    const key = pendingKeys.get(scope) ?? operationKey(scope);
    pendingKeys.remember(scope, key);
    setSubmitting(scope);
    try {
      const updated = await simulateD2CooldownExpiry(row.withdrawalNo, reason, key);
      pendingKeys.forget(scope);
      setDetail(updated);
      toast(`${row.withdrawalNo} 已模拟冷却到期 · 真实状态机结果：${statusLabel(updated.status)}`);
      await load();
    } catch (cause) {
      if (!isDOutcomeUnknownError(cause)) pendingKeys.forget(scope);
      const message = cause instanceof Error ? displayAdminError(cause) : "模拟冷却到期失败";
      await load();
      setError(message);
      toast(message);
      throw cause;
    } finally {
      setSubmitting("");
    }
  };

  const confirmDevelopmentSimulation = (row: D2Withdrawal) => {
    openActionConfirm({
      action: `模拟冷却到期 · ${row.withdrawalNo}`,
      detail: "仅开发环境。只把这笔开发账号提现单的冷却时间推进到当前时刻；随后按真实到期状态机重新检查 K3、K4、B1 和提现开关，不直接标记成功。A2 对象锁、D3 储备、审计与幂等仍然生效。",
      amplifies: true,
      coverage: d5 ? { coverageRatio: d5.coverageRatio, redlinePct: d5.redlinePct } : undefined,
      reasonMin: 8,
      reasonMax: 200,
      completionCopy: "到期模拟已提交",
      run: (reason) => runDevelopmentSimulation(row, reason),
    });
  };

  const closeDetail = () => {
    detailRequestSeq.current += 1;
    setDetail(null);
    setDetailLoading(false);
    setDetailError("");
  };

  const resetAdvancedFilters = () => {
    setMinAmount("");
    setMaxAmount("");
    setMinRiskScore("");
    setRuleFilter("");
    setIpSegment("");
    setSortBy("createdAt");
    setSortDirection("desc");
    setPage(1);
    void load(1, {
      minAmount: "", maxAmount: "", minRiskScore: "", ipSegment: "", sortBy: "createdAt", sortDirection: "desc",
    });
  };

  const selectableVisibleRows = visibleRows.filter((row) => batchSelectable(row, batchAction, availableBatchActions));
  const allVisibleSelected = selectableVisibleRows.length > 0
    && selectableVisibleRows.every((row) => selected.has(row.withdrawalNo));
  const toggleVisibleSelection = (checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of selectableVisibleRows) checked ? next.add(row.withdrawalNo) : next.delete(row.withdrawalNo);
      return next;
    });
  };

  const confirmBatch = () => {
    const action = batchAction;
    if (!action) { toast("请先选择批量动作，再勾选要执行的提现单"); return; }
    // 只提交「当前筛选结果里真正可执行」的行；弹窗里报的笔数与下面 run 提交的是同一个 ids。
    const ids = submittableRows.map((row) => row.withdrawalNo).sort();
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
        } catch (cause) {
          // 批量原本只有 try/finally:失败时既不丢号也**不回读列表** —— 运营看不出哪几笔已出金,
          //   而批量指纹含 ids 集合,改一下勾选就是新号,重叠的那部分会被重复放行。
          //   回读让已生效的行先亮出来,再配合下面的提示劝阻「改选重来」。
          if (!isDOutcomeUnknownError(cause)) pendingKeys.forget(scope);
          await load();
          const message = cause instanceof Error ? cause.message : "D2 批量审核失败";
          setError(isDOutcomeUnknownError(cause)
            ? `${message}｜请勿改动勾选范围后重来:换一批单号=换新请求号,已放行的那部分会被重复放行`
            : message);
          throw cause;
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

    <D2StatusFlow />

    <section className="l-card">
      <div className="l-h"><span className="ttl">提现审核队列</span><span className="sub">· 服务端权威状态 · 逐笔 / 批量</span></div>
      <div className="l-b d2-search-panel">
        <div className="d2-search-toolbar">
          <label className="d2-filter-field d2-keyword-field"><span>提现单 / 用户</span><input placeholder="输入提现单号、用户编号或昵称" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></label>
          <label className="d2-filter-field"><span>状态</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>{STATUS_TABS.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}</select></label>
          <button className="l-btn primary" onClick={() => { setPage(1); void load(1); }}>查询</button>
          <button className="l-btn" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((value) => !value)}>{advancedOpen ? "收起高级筛选" : "高级筛选"}</button>
        </div>
        {advancedOpen && <div className="d2-advanced-filters">
          <label className="d2-filter-field"><span>最低金额</span><input type="number" min="0" value={minAmount} onChange={(event) => setMinAmount(event.target.value)} /></label>
          <label className="d2-filter-field"><span>最高金额</span><input type="number" min="0" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} /></label>
          <label className="d2-filter-field"><span>最低风险分</span><input type="number" min="0" max="100" value={minRiskScore} onChange={(event) => setMinRiskScore(event.target.value)} /></label>
          <label className="d2-filter-field"><span>命中规则</span><input value={ruleFilter} onChange={(event) => setRuleFilter(event.target.value)} /></label>
          <label className="d2-filter-field"><span>IP 段</span><input placeholder="例如 192.168.1" value={ipSegment} onChange={(event) => setIpSegment(event.target.value)} /></label>
          <label className="d2-filter-field"><span>排序字段</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="createdAt">提交时间</option><option value="amount">金额</option><option value="riskScore">风险分</option><option value="status">状态</option></select></label>
          <label className="d2-filter-field"><span>排序方向</span><select value={sortDirection} onChange={(event) => setSortDirection(event.target.value)}><option value="desc">降序</option><option value="asc">升序</option></select></label>
          <button className="l-btn" onClick={resetAdvancedFilters}>清空高级筛选</button>
        </div>}
      </div>
      {hasAuthority("finance_d2_withdrawal_batch") && <div className="l-b d2-batch-toolbar">
        <strong>批量操作面</strong>
        <select aria-label="批量动作" value={batchAction} onChange={(event) => setBatchAction(event.target.value as D2BatchAction | "")}>
          <option value="">选择批量动作</option>
          {availableBatchActions.map((action) => <option key={action} value={action}>{actionLabel(action)}</option>)}
        </select>
        <span>已勾选 {selectedRows.length} 笔{batchAction ? ` · 可执行 ${submittableRows.length} 笔` : ""}</span>
        <button className="l-btn primary" disabled={!writesEnabled || !batchAction || submittableRows.length === 0 || !!submitting} onClick={confirmBatch}>批量执行</button>
        <span className="sub">{!batchAction ? "可先勾选提现单，再选择批量动作；提交前会按权限和状态再次校验" : "不适用当前动作的勾选会保留但不会提交；服务端仍会逐笔校验"}</span>
      </div>}
      <div className="d2-table-wrap"><table className="l-tbl d2-table">
        <thead><tr><th><label className="d2-check"><input aria-label="全选本页可批量处理的提现单" type="checkbox" disabled={selectableVisibleRows.length === 0} checked={allVisibleSelected} onChange={(event) => toggleVisibleSelection(event.target.checked)} /><span>选择</span></label></th><th>提现单</th><th>用户</th><th>资产 / 链</th><th className="num">金额 / 到账</th><th>审核依据</th><th>状态</th><th>生命周期 / 异常</th><th>提交时间</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
        <tbody>{visibleRows.length === 0 ? <tr><td colSpan={10} style={{ textAlign: "center", padding: 28 }}>暂无提现记录</td></tr> : visibleRows.map((row) => {
          const selectedNow = selected.has(row.withdrawalNo);
          const anyBatchAction = batchSelectable(row, "", availableBatchActions);
          const selectable = batchSelectable(row, batchAction, availableBatchActions);
          const selectionHint = !anyBatchAction
            ? "该状态由系统自动流转，没有可执行的批量动作"
            : batchAction && !selectable
              ? `当前批量动作“${actionLabel(batchAction)}”不适用于该状态，可取消勾选或更换动作`
              : "选择这笔提现";
          return <tr key={row.withdrawalNo}>
            <td><input aria-label={`${selectionHint}：${row.withdrawalNo}`} title={selectionHint} type="checkbox" disabled={!selectable && !selectedNow} checked={selectedNow} onChange={(event) => setSelected((current) => { const next = new Set(current); event.target.checked ? next.add(row.withdrawalNo) : next.delete(row.withdrawalNo); return next; })} />{!selectable && <span className="d2-selection-note">{anyBatchAction ? "当前动作不适用" : "系统自动流转"}</span>}</td>
            <td><button className="l-btn sm d2-withdrawal-link" title={row.withdrawalNo} aria-label={`打开提现单 ${row.withdrawalNo} 的详情`} onClick={() => void openDetail(row)}><span className="d2-cell-ellipsis">{row.withdrawalNo}</span></button></td>
            <td>{row.userNo}<div className="sub">{row.nickname}</div></td>
            <td className="d2-asset-cell"><span className="d2-cell-ellipsis" title={`${row.asset} / ${row.chain}`} aria-label={`资产与链：${row.asset} / ${row.chain}`}>{row.asset} / {row.chain}</span><div className="mono sub d2-address" title={row.targetAddress}>{row.targetAddress}</div></td>
            <td className="num d2-fee-summary"><strong>{money(row.amount)}</strong><div className="sub">到账 {money(row.netReceive)}</div><div className="sub">手续费 {money(row.actualFee)}</div><button className="d2-inline-link" onClick={() => void openDetail(row)}>详情中查看完整费用</button></td>
            <td className="d2-review-cell"><span className={`bdg ${routingPriorityTone(row)}`} title={`K4 当前阈值：低风险上限 ${row.k4BandLowMax ?? "—"}，高风险起点 ${row.k4BandHighMin ?? "—"}，自动升级 ${row.k4AutoEscalateScore ?? "—"}`}>{routingPriorityLabel(row)} · {k4RiskText(row)}</span><div className="sub">K3 {routeLabel(row.k3RiskRoute)} · {ruleSummary(row.hitRules)}</div><div className="sub">账户 {userStatusLabel(row.userStatus)} · 24h 第 {row.withdrawalCount24h}/{dailyLimit || "—"} 笔</div></td>
            <td><span className={`bdg ${statusTone(row.status)}`}>{statusLabel(row.status)}</span></td>
            <td className="sub d2-lifecycle-cell">{lifecycleSummary(row)}{row.holdUntil && <div>复查时间：{timeText(row.holdUntil)}</div>}</td>
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

    {detail && <Drawer title={`单笔详情 · ${detail.withdrawalNo}`} sub={`${detail.userNo} · ${statusLabel(detail.status)}`} wide onClose={closeDetail} footer={<>
      <button className="l-btn" onClick={closeDetail}>关闭</button>
      {developmentCapabilities?.simulateCooldownExpiry
        && hasAuthority("finance_d2_withdrawal_approve")
        && developmentSimulationEligible(detail)
        && <button className="l-btn primary" disabled={!writesEnabled || !!submitting || detailLoading || !!detailError} onClick={() => confirmDevelopmentSimulation(detail)}>模拟冷却到期</button>}
      {actionCandidates(detail).filter((action) => hasAuthority(ACTION_AUTHORITY[action])).map((action) => <button key={action} className="l-btn primary" disabled={!writesEnabled || !!submitting || detailLoading || !!detailError || (action === "APPROVE" && routingUnavailable(detail))} onClick={() => confirmReview(detail, action)}>{actionLabel(action)}</button>)}
    </>}>
      {detailLoading && <div className="dtint">正在读取服务端最新详情…</div>}
      {detailError && <div className="dtint warn">服务端最新详情加载失败 · {detailError} · 为避免按旧数据处置，写操作已关闭，请关闭后重试。</div>}
      <div className="f-stats d2-detail-stats">
        <div className="f-stat"><div className="k">用户画像</div><div className="v">{detail.userNo}</div><div className="sub">{detail.nickname} · {detail.userLevel} · {detail.phoneMasked || "未展示手机号"}</div></div>
        <div className="f-stat warn"><div className="k">风险路由</div><div className="v">{routingPriorityLabel(detail)} · {k4RiskText(detail)}</div><div className="sub">K3 {routeLabel(detail.k3RiskRoute)} · {ruleSummary(detail.hitRules)}</div></div>
        <div className="f-stat cyan"><div className="k">账户状态</div><div className="v">{userStatusLabel(detail.userStatus)}</div><div className="sub">24h 第 {detail.withdrawalCount24h} 笔 · IP 段 {detail.ipSegment || "—"}</div></div>
        <div className="f-stat"><div className="k">当前状态</div><div className="v">{statusLabel(detail.status)}</div><div className="sub">{lifecycleSummary(detail)}</div></div>
      </div>
      <div className="d2-detail-grid">
        <section className="d2-detail-section">
          <h3>提现与费用</h3>
          <KV k="提现金额" v={money(detail.amount)} />
          <KV k="实际手续费" v={money(detail.actualFee)} />
          <KV k="实际到账" v={money(detail.netReceive)} />
          {detail.feeModel === "confirm" ? <KV k="网络确认费" v={`${money(detail.networkConfirmUsd ?? 0)}（每笔固定）`} /> : <>
            <KV k="网络费" v={money(detail.networkFee ?? 0)} />
            <KV k="网络费率 / 区间" v={`${detail.networkFeeRate ?? "—"} · ${money(detail.networkFeeMin ?? 0)}–${money(detail.networkFeeMax ?? 0)}`} />
            <KV k="毛手续费 / 金额费率" v={`${money(detail.grossFee ?? 0)} · ${detail.penaltyFeeRate ?? "—"}%`} />
          </>}
          <KV k="NEX 抵扣" v={`${detail.nexBurned} NEX`} />
          <KV k="费用减免" v={money(detail.feeWaived)} />
          <KV k="NEX抵扣率" v={`$${detail.nexFeeOffsetRate}/NEX`} />
        </section>
        <section className="d2-detail-section">
          <h3>生命周期</h3>
          <KV k="状态" v={<span className={`bdg ${statusTone(detail.status)}`}>{statusLabel(detail.status)}</span>} />
          <KV k="说明" v={lifecycleSummary(detail)} />
          <KV k="复查时间" v={timeText(detail.holdUntil)} />
          <KV k="责任人" v={detail.lifecycleOwner || "系统自动"} />
          <KV k="持有 / 冻结期限" v={freezePeriodLabel(detail.freezePeriod)} />
          <KV k="上一状态" v={detail.previousStatus ? statusLabel(detail.previousStatus) : "—"} />
        </section>
        <section className="d2-detail-section">
          <h3>收款与用户事实</h3>
          <KV k="资产 / 网络" v={`${detail.asset} / ${detail.chain}`} />
          <KV k="目标地址" v={<span className="mono d2-break-text">{detail.targetAddress}</span>} />
          <KV k="设备事实" v={operationalText(detail.deviceSummary)} />
          <KV k="推荐位置" v={operationalText(detail.referralPosition)} />
          <KV k="全部提现历史" v={operationalText(detail.withdrawalHistory)} />
        </section>
        <section className="d2-detail-section">
          <h3>风控与审计</h3>
          <KV k="K4 评分明细" v={operationalText(detail.riskScoreBreakdown)} />
          <KV k="K3 风险原因" v={operationalText(detail.riskReason)} />
          <KV k="状态历史" v={operationalText(detail.statusHistory)} />
          <KV k="审计轨迹" v={operationalText(detail.auditTrail)} />
        </section>
      </div>
    </Drawer>}
  </>;
}
