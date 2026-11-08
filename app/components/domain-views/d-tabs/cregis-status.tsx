"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { financeAdminRequest, listD1PendingCregisCommands, listD1PendingCregisSwitchCommands, retryD1PendingCregisSwitchCommand } from "@/lib/admin/d-client";
import { adminAuthLifecycleEpoch, AdminAuthEpochChangedError } from "@/lib/admin/auth-lifecycle";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { OperatorBriefKind } from "../design-kit";
import type { DCtx } from "./types";
import { CregisExceptionOperations } from "./cregis-exceptions";
import { CregisFundsPreparation } from "./cregis-funds-preparation";
import { CregisAutoForward } from "./cregis-auto-forward";
import { CregisPoolPolicy } from "./cregis-pool-policy";
import { CregisDepositPolicy, type DepositProposalActivity } from "./cregis-deposit-policy";

type ExceptionRow = Record<string, unknown>;
type FundsNetwork = "BEP20" | "ERC20" | "TRC20";
const FUNDS_NETWORKS: FundsNetwork[] = ["BEP20", "ERC20", "TRC20"];
const networkName = { BEP20: "BNB Smart Chain", ERC20: "Ethereum", TRC20: "TRON" };
type NetworkSwitch = { network: FundsNetwork; depositEnabled: boolean; version: number;
  depositAvailable: boolean; addressAvailable: boolean; depositDisabledReason: string | null };
type NetworkDraft = { depositEnabled: boolean; version: number };
const availabilityText = (reason: string | null) => ({ NETWORK_SWITCH_OFF: "该网络开关已关闭", GLOBAL_SWITCH_OFF: "全局开关已关闭",
  NOT_CONFIGURED: "接入配置未就绪", RISK_HOLD: "风险暂停，请核对异常与告警", RECONCILIATION_REQUIRED: "需完成资金对账",
  ADDRESS_POOL_EMPTY: "缺少可分配地址，已有地址按原状态处理", WITHDRAWAL_NETWORK_OFF: "请核对 D5 提现网络许可",
  SWITCH_OFF: "全局出款开关已关闭", PAYOUT_ASSET_UNAVAILABLE: "支付商未开通该网络出款",
  PROVIDER_CAPABILITY_UNAVAILABLE: "暂时无法核实支付商能力" } as Record<string,string>)[reason ?? ""] ?? (reason ? "状态待核实，请刷新或查看异常" : "可用");
type AddressPool = { available: boolean; total: number; unassigned: number; assigned: number; verifying: number; unknown: number; limit: number; reserveTarget?: number; automatic?: boolean; queued?: number; lastError?: string | null; retryAfter?: number | null };
type CregisExceptions = {
  mode: string;
  depositEnabled: boolean;
  depositCreditEnabled: boolean;
  addressPool?: AddressPool;
  addressPools?: Partial<Record<FundsNetwork, AddressPool>>;
  networkSwitches?: NetworkSwitch[];
  networkCapabilities?: Array<{ network: FundsNetwork; configured: boolean; enabled: boolean; disabledReason: string | null }>;
  providerPayout?: { configured: boolean; enabled: boolean; disabledReason: string | null };
  provisionGate: { state: string; updatedAt?: string; version?: number;
    assignEnabled?: boolean | number; creditEnabled?: boolean | number; payoutEnabled?: boolean | number };
  unresolvedExposureUsdt?: number | string;
  openRiskAlertCount?: number;
  pendingAcceptedDeliveries?: number;
  pendingDeliveries: ExceptionRow[];
  riskAlerts?: ExceptionRow[];
  reconcileRuns?: ExceptionRow[];
  reviewCases?: ExceptionRow[];
  openReviewCaseCount?: number;
  switchCases?: ExceptionRow[];
  uncertainAddresses: ExceptionRow[];
  heldDeposits: ExceptionRow[];
  failedDeliveries: ExceptionRow[];
  unattributed: ExceptionRow[];
  providerMissing: ExceptionRow[];
};

const QUEUES: Array<[keyof Pick<CregisExceptions,
  "uncertainAddresses" | "heldDeposits" | "failedDeliveries" | "pendingDeliveries" | "unattributed" | "providerMissing">, string]> = [
  ["uncertainAddresses", "新地址待核对"],
  ["heldDeposits", "入金待人工处理"],
  ["failedDeliveries", "回调处理失败"],
  ["pendingDeliveries", "待处理的回调"],
  ["unattributed", "未归属链上入金"],
  ["providerMissing", "Cregis 缺单 / 链上待核对"],
];

function parseExceptions(value: unknown): CregisExceptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("USDT 资金状态加载不完整，请刷新后再试");
  const row = value as Record<string, unknown>;
  const gate = row.provisionGate as Record<string, unknown> | undefined;
  if (typeof row.mode !== "string" || typeof row.depositEnabled !== "boolean"
      || typeof row.depositCreditEnabled !== "boolean" || !gate || typeof gate.state !== "string"
      || QUEUES.some(([key]) => !Array.isArray(row[key]))) throw new Error("USDT 资金状态加载不完整，请刷新后再试");
  const flags = [gate.assignEnabled, gate.creditEnabled, gate.payoutEnabled];
  const unavailableGate = ["DISABLED", "MISSING"].includes(gate.state as string)
    && flags.every((flag) => flag === undefined);
  if (!unavailableGate && !flags
      .every((flag) => flag === true || flag === false || flag === 0 || flag === 1)) {
    throw new Error("USDT 资金开关状态加载不完整，请刷新后再试");
  }
  if (row.providerPayout !== undefined) {
    const payout = row.providerPayout as Record<string, unknown> | null;
    if (!payout || typeof payout !== "object" || Array.isArray(payout)
        || typeof payout.configured !== "boolean" || typeof payout.enabled !== "boolean"
        || !(payout.disabledReason === null || (typeof payout.disabledReason === "string" && payout.disabledReason.length > 0))
        || (payout.enabled && (!payout.configured || payout.disabledReason !== null || !gate.payoutEnabled))) {
      throw new Error("链上出款状态加载不完整，请刷新后再试");
    }
  }
  if (row.networkCapabilities !== undefined && (!Array.isArray(row.networkCapabilities)
      || row.networkCapabilities.some((capability, index, all) => !capability || !FUNDS_NETWORKS.includes(capability.network)
        || all.findIndex(item => item.network === capability.network) !== index
        || typeof capability.configured !== "boolean" || typeof capability.enabled !== "boolean"
        || !(capability.disabledReason === null || typeof capability.disabledReason === "string")
        || capability.enabled && (!capability.configured || capability.disabledReason !== null || !gate.payoutEnabled)))) {
    throw new Error("各网络出款状态加载不完整，请刷新后再试");
  }
  if (row.networkSwitches !== undefined && (!Array.isArray(row.networkSwitches) || ![2, 3].includes(row.networkSwitches.length)
      || !["BEP20", "ERC20"].every(network => (row.networkSwitches as NetworkSwitch[]).some(item => item?.network === network))
      || row.networkSwitches.some((item, index, all) => !item || !FUNDS_NETWORKS.includes(item.network)
        || all.findIndex(other => other.network === item.network) !== index || !Number.isSafeInteger(item.version) || item.version < 0
        || [item.depositEnabled, item.depositAvailable, item.addressAvailable].some(value => typeof value !== "boolean")
        || [item.depositDisabledReason].some(value => value !== null && (typeof value !== "string" || !value))
        || item.depositAvailable !== (item.depositDisabledReason === null)
        || item.depositAvailable && !item.depositEnabled)))
    throw new Error("分网络资金开关加载不完整，请刷新后再试");
  for (const pool of [row.addressPool, ...(row.addressPools ? Object.values(row.addressPools as Record<string, AddressPool>) : [])].filter(value => value !== undefined) as AddressPool[]) {
    if (!pool || typeof pool.available !== "boolean" || [pool.total, pool.unassigned, pool.assigned, pool.verifying, pool.unknown, pool.limit]
      .some((count) => !Number.isSafeInteger(count) || count < 0)
      || (pool.limit > 0 && pool.total > pool.limit)
      || pool.unassigned + pool.assigned + pool.verifying + pool.unknown > pool.total) {
      throw new Error("地址池状态加载不完整，请刷新后再试");
    }
  }
  return value as CregisExceptions;
}

function canProvisionAddress(data: CregisExceptions, network: FundsNetwork = "BEP20"): boolean {
  const pool = data.addressPools?.[network] ?? (network === "BEP20" ? data.addressPool : undefined);
  return data.mode === "PROVIDER" && data.provisionGate.state === "IDLE"
    && Boolean(data.provisionGate.assignEnabled) && pool?.available === true
    && (network !== "TRC20" || data.networkSwitches?.some(row => row.network === network) === true)
    && (pool.limit === 0 || pool.total < pool.limit) && pool.verifying === 0
    && pool.unknown === 0;
}

function payoutCapabilityText(data: CregisExceptions): string {
  const capability = data.providerPayout;
  if (!capability) return "链上出款能力尚未确认，请刷新核对；当前不能开启。";
  if (capability.enabled) return "链上出款能力已启用，提现仍须通过原有资格、审核与链上确认。";
  switch (capability.disabledReason) {
    case "NOT_CONFIGURED": return "链上出款接入尚未就绪，当前不能开启。";
    case "SWITCH_OFF": return "链上出款开关已关闭；开启须由另一管理员复核。";
    case "RISK_HOLD": return "链上出款因风险暂停，请先查看异常和告警。";
    case "RECONCILIATION_REQUIRED": return "链上出款需要先完成资金对账，请核对对账结果。";
    default: return "链上出款能力待核实，请刷新后再试；当前不能开启。";
  }
}

function payoutSwitchText(row: ExceptionRow, unknownText = "保持现值"): string {
  return row.payoutEnabled === true || row.payoutEnabled === 1 ? "开"
    : row.payoutEnabled === false || row.payoutEnabled === 0 ? "关" : unknownText;
}

const cregisStateText = (value: unknown) => ({ IDLE: "暂无地址在创建", BUSY: "正在创建地址", BLOCKED: "风险暂停", DISABLED: "未启用支付商收款", MISSING: "开关设置缺失", UNKNOWN: "创建结果待核实", PROVISIONING: "地址创建中", VERIFYING: "地址核对中", UNATTRIBUTED_HOLD: "未归属充值待处理", RETIRED_HOLD: "停用地址充值待处理", DUST_HOLD: "低额充值待处理", REVIEW_HOLD: "大额充值待审核", REORG_INVESTIGATING: "链重组调查中", PROVIDER_CONFLICT_HOLD: "支付商与链上记录冲突待处理", PROVIDER_MISSING: "支付商缺单待核对", CHAIN_MISMATCH_HOLD: "链上记录不符待核对", RUNNING: "对账中", COMPLETE: "完整对账完成", INCOMPLETE: "对账未完成", MAKER_DONE: "待另一管理员复核", RESOLVED: "复核处理完成", REJECTED: "已驳回" } as Record<string,string>)[String(value)] ?? "状态待核实";
function rowNetwork(row: { network?: unknown; chainId?: unknown; chain_id?: unknown }): FundsNetwork | null {
  if (row.network === "BEP20" || row.network === "ERC20" || row.network === "TRC20") return row.network;
  if (row.network !== undefined && row.network !== null) return null;
  const chain = row.chainId ?? row.chain_id;
  return chain == null ? "BEP20" : chain === "60" || chain === 60 ? "ERC20" : chain === "2510" || chain === 2510 ? "BEP20" : chain === "195" || chain === 195 ? "TRC20" : null;
}
function rowSummary(row: ExceptionRow) {
  return [row.id == null ? null : `#${row.id}`, row.state == null && row.status == null ? null : cregisStateText(row.state ?? row.status),
    rowNetwork(row), row.address, row.cid == null ? null : `CID ${row.cid}`, row.txid,
    row.ageSeconds == null ? null : `等待 ${row.ageSeconds} 秒`,
    row.lastError ?? row.last_error].filter((part) => part != null && part !== "").join(" · ");
}

type DepositRow = {
  network?: FundsNetwork; chain_id?: string; chainId?: string; id: string; cid: string; userId: string; txid: string; logIndex: number; address: string;
  grossAmount: string; feeAmount: string; netAmount: string;
  confirmations: number; status: string; depositNo?: string | null;
  createdAt: string; creditedAt?: string | null;
};
type DepositPage = { available: boolean; items: DepositRow[]; hasMore: boolean; nextBeforeId: string };

function parseDepositPage(value: unknown): DepositPage {
  if (!value || typeof value !== "object") throw new Error("入金记录加载不完整，请刷新后再试");
  const page = value as Record<string, unknown>;
  if (typeof page.available !== "boolean" || !Array.isArray(page.items) || typeof page.hasMore !== "boolean"
      || typeof page.nextBeforeId !== "string" || !/^(0|[1-9]\d*)$/.test(page.nextBeforeId)
      || page.items.some((item) => !item || typeof item !== "object"
        || typeof item.id !== "string" || !/^[1-9]\d*$/.test(item.id)
        || (item.network !== undefined && !FUNDS_NETWORKS.includes(item.network))
        || typeof item.cid !== "string" || !/^[1-9]\d*$/.test(item.cid)
        || typeof item.userId !== "string" || !/^[1-9]\d*$/.test(item.userId)
        || typeof item.txid !== "string"
        || typeof item.status !== "string" || typeof item.address !== "string"
        || !Number.isSafeInteger(item.logIndex) || !Number.isSafeInteger(item.confirmations)
        || typeof item.grossAmount !== "string" || !/^\d+\.\d{6}$/.test(item.grossAmount)
        || typeof item.feeAmount !== "string" || !/^\d+\.\d{6}$/.test(item.feeAmount)
        || typeof item.netAmount !== "string" || !/^\d+\.\d{6}$/.test(item.netAmount)
        || typeof item.createdAt !== "string")) {
    throw new Error("入金记录加载不完整，请刷新后再试");
  }
  return value as DepositPage;
}

const DEPOSIT_STATUS: Record<string, string> = {
  CREDITED: "已入账", REVIEW_HOLD: "待人工复核", DUST_HOLD: "低额冻结",
  REORG_INVESTIGATING: "链重组调查", PROVIDER_CONFLICT_HOLD: "支付商记录冲突，已冻结",
};

function CregisDepositHistory() {
  const [page, setPage] = useState<DepositPage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  const load = useCallback(async (beforeId = "0") => {
    const current = ++requestId.current;
    setLoading(true);
    setError("");
    if (beforeId === "0") setPage(null);
    try {
      const next = parseDepositPage(await financeAdminRequest<unknown>(`/cregis/deposits?beforeId=${encodeURIComponent(beforeId)}&limit=20`));
      if (current === requestId.current) setPage((previous) => beforeId !== "0" && previous
        ? { ...next, items: [...previous.items, ...next.items] } : next);
    } catch (failure) {
      if (current === requestId.current) setError(failure instanceof Error ? failure.message : "入金记录加载失败");
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); return () => { requestId.current++; }; }, [load]);

  return <div className="cregis-history">
    <div className="cregis-section-title">USDT 入金记录 / 充值单
      <button className="l-btn sm" disabled={loading} onClick={() => void load()}>刷新列表</button>
    </div>
    <div className="sub">链上转账经 Cregis 和链上核实后生成入金记录，入账时生成充值单。未入账的净额只供核对。</div>
    {error && <div className="dtint warn">入金记录加载失败：{error}</div>}
    {loading && !page && <div className="dtint">正在加载…</div>}
    {page && !page.available && <div className="dtint warn">Cregis 收款已停用，历史记录暂时查不了（不代表没有入金）。</div>}
    {page?.available && <>
      <div className="cregis-history-scroll"><table className="l-tbl">
        <thead><tr><th>记录 / 充值单</th><th>用户</th><th>网络</th><th>链上交易 / 地址</th><th className="num">毛额 USDT</th><th className="num">手续费</th><th className="num">净额 USDT</th><th>确认数</th><th>状态</th><th>发现 / 入账时间</th></tr></thead>
        <tbody>{page.items.length === 0 ? <tr><td colSpan={10} className="cregis-history-empty">暂无已核实的链上入金。待处理的回调和缺单可在“异常处理”查看。</td></tr>
          : page.items.map((row) => <tr key={row.id}>
            <td className="mono">CID {row.cid}<div className="sub">{row.depositNo || (row.status === "CREDITED" ? "充值单缺失，请核对" : "尚未生成充值单")}</div></td>
            <td className="mono">{row.userId}</td><td>{rowNetwork(row) ?? "网络待核实"}</td>
            <td className="cregis-chain-cell mono">{row.txid} <span>日志 {row.logIndex} · {row.address}</span></td>
            <td className="num mono">{String(row.grossAmount)}</td>
            <td className="num mono">{String(row.feeAmount)}</td>
            <td className="num mono">{String(row.netAmount)}</td>
            <td className="mono">{row.confirmations}</td>
            <td><span className={`bdg ${row.status === "CREDITED" && row.depositNo ? "ok" : row.status.endsWith("HOLD") || row.status === "REORG_INVESTIGATING" ? "bad" : "warn"}`}>{row.status === "CREDITED" && !row.depositNo ? "入账记录异常" : DEPOSIT_STATUS[row.status] ?? "充值状态待核实"}</span></td>
            <td className="mono">{String(row.createdAt).replace("T", " ")}<div className="sub">{row.creditedAt ? `入账 ${String(row.creditedAt).replace("T", " ")}` : "尚未入账"}</div></td>
          </tr>)}</tbody>
      </table></div>
      {page.hasMore && <button className="l-btn sm" disabled={loading} onClick={() => void load(page.nextBeforeId)}>加载更早记录</button>}
    </>}
  </div>;
}

export type D1CregisActivity = { pendingCommands: number; needsAttention: boolean; proposalUnknown: number; proposalPending: number };

export function CregisStatus({ canManage = false, openActionConfirm, embedded = false, onActivityChange }: {
  canManage?: boolean; openActionConfirm: DCtx["openActionConfirm"]; embedded?: boolean;
  onActivityChange?: (activity: D1CregisActivity) => void;
}) {
  const adminId = useAdminAuth(state => state.session?.adminId);
  const [data, setData] = useState<CregisExceptions | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState("records");
  const [cid, setCid] = useState("");
  const [reviewEvidence, setReviewEvidence] = useState<ExceptionRow | null>(null);
  const [extraAlerts, setExtraAlerts] = useState<ExceptionRow[]>([]);
  const [extraReviewCases, setExtraReviewCases] = useState<ExceptionRow[]>([]);
  const [globalPayout, setGlobalPayout] = useState<{ enabled: boolean; version: number } | null>(null);
  const [networkDrafts, setNetworkDrafts] = useState<Partial<Record<FundsNetwork, NetworkDraft>>>({});
  const [poolNetwork, setPoolNetwork] = useState<FundsNetwork>("BEP20");
  const [proposalActivity, setProposalActivity] = useState<DepositProposalActivity>({ unknown: 0, awaitingApproval: 0 });
  const selectedPool = data?.addressPools?.[poolNetwork] ?? (poolNetwork === "BEP20" ? data?.addressPool : undefined);
  const refresh = useCallback(async () => {
    const authEpoch = adminAuthLifecycleEpoch();
    setLoading(true);
    setError("");
    setExtraAlerts([]);
    setExtraReviewCases([]);
    try {
      const next = parseExceptions(await financeAdminRequest<unknown>("/cregis/exceptions", { bankManualAuthEpoch: authEpoch }));
      if (authEpoch !== adminAuthLifecycleEpoch()) return false;
      setData(next);
      setNetworkDrafts(previous => Object.fromEntries((next.networkSwitches ?? []).map(row => [row.network,
        previous[row.network]?.version === row.version ? previous[row.network] : { depositEnabled: row.depositEnabled, version: row.version }])));
      setGlobalPayout(previous => next.provisionGate.version == null ? null : previous?.version === next.provisionGate.version ? previous : { enabled: Boolean(next.provisionGate.payoutEnabled), version: next.provisionGate.version });
      return true;
    } catch (failure) {
      if (authEpoch !== adminAuthLifecycleEpoch()) return false;
      setData(null);
      setError(failure instanceof Error ? failure.message : "加载失败");
      return false;
    } finally {
      if (authEpoch === adminAuthLifecycleEpoch()) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const pendingCommands = listD1PendingCregisCommands().length, needsAttention = !!error;
  const pendingSwitchCommands = listD1PendingCregisSwitchCommands();
  const proposalBlocked = busy || pendingSwitchCommands.some(pending => pending.path === "/cregis/switch-cases");
  useEffect(() => { onActivityChange?.({ pendingCommands, needsAttention, proposalUnknown: proposalActivity.unknown, proposalPending: proposalActivity.awaitingApproval }); }, [onActivityChange, pendingCommands, needsAttention, proposalActivity.unknown, proposalActivity.awaitingApproval]);

  const command = async (path: string, body?: Record<string, unknown>) => {
    if (busy) return;
    const authEpoch = adminAuthLifecycleEpoch();
    setBusy(true);
    setError("");
    try {
      await financeAdminRequest<unknown>(path, {
        method: "POST", body: body ? JSON.stringify(body) : undefined,
        idempotencyPrefix: "cregis-ops",
        bankManualAuthEpoch: authEpoch,
      });
      if (authEpoch !== adminAuthLifecycleEpoch()) return;
      if (!await refresh()) {
        setError("操作已提交，但状态没刷新出来。请先刷新查看，不要重复提交。");
      }
    } catch (failure) {
      if (authEpoch !== adminAuthLifecycleEpoch()) throw failure;
      setError(failure instanceof Error ? failure.message : "操作结果未确认，请刷新查看后再试");
      throw failure;
    } finally { if (authEpoch === adminAuthLifecycleEpoch()) setBusy(false); }
  };

  const recoverSwitchCommand = async (commandKey: string) => {
    if (busy || !canManage) return;
    const authEpoch = adminAuthLifecycleEpoch();
    setBusy(true); setError("");
    try {
      await retryD1PendingCregisSwitchCommand(commandKey);
      if (authEpoch !== adminAuthLifecycleEpoch()) return;
      if (!await refresh()) setError("原请求已返回结果，但当前资金状态读取失败，请刷新核对后再操作。");
    } catch (failure) {
      if (authEpoch === adminAuthLifecycleEpoch()) setError(failure instanceof Error ? failure.message : "原请求结果仍未确认，请保留原请求后再恢复");
    } finally { if (authEpoch === adminAuthLifecycleEpoch()) setBusy(false); }
  };

  const confirmCommand = (briefKind: OperatorBriefKind, action: string, detail: string, path: string,
                          body?: Record<string, unknown>) => {
    const authEpoch = adminAuthLifecycleEpoch();
    openActionConfirm({ briefKind,
      action, detail, reasonMin: 10, reasonMax: 255,
      completionCopy: path === "/cregis/switch-cases" || path === "/cregis/review-cases"
        ? "提交后需另一位管理员复核才生效。" : "提交后立即执行。",
      run: (reason) => {
        if (authEpoch !== adminAuthLifecycleEpoch()) throw new AdminAuthEpochChangedError();
        return command(path, { ...body, reason });
      },
    });
  };

  const previewReview = async (targetCid: number) => {
    setBusy(true);
    setError("");
    setReviewEvidence(null);
    try {
      setReviewEvidence(await financeAdminRequest<ExceptionRow>(`/cregis/review-evidence/${targetCid}`));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "核对失败");
    } finally { setBusy(false); }
  };

  const loadMoreAlerts = async (beforeId: number) => {
    setBusy(true);
    setError("");
    try {
      const rows = await financeAdminRequest<ExceptionRow[]>(`/cregis/risk-alerts/${beforeId}`);
      setExtraAlerts((previous) => [...previous, ...rows]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "告警加载失败");
    } finally { setBusy(false); }
  };

  const loadMoreReviewCases = async (beforeId: number) => {
    setBusy(true);
    setError("");
    try {
      const rows = await financeAdminRequest<ExceptionRow[]>(`/cregis/review-cases/before/${beforeId}`);
      setExtraReviewCases((previous) => [...previous, ...rows]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "审核工单加载失败");
    } finally { setBusy(false); }
  };

  const count = data ? QUEUES.reduce((sum, [key]) => sum + data[key].length, 0) : 0;
  const alerts = [...(data?.riskAlerts ?? []), ...extraAlerts];
  const reviewCases = [...(data?.reviewCases ?? []), ...extraReviewCases];
  return <section className={embedded ? "l-card cregis-status-embedded cregis-workspace" : "l-card cregis-status cregis-workspace"} style={embedded ? undefined : { marginBottom: 12 }}>
    <div className="l-h">
      <span className="ttl">USDT 资金状态（BEP20 / ERC20 / TRC20）</span>
      <span className="sub">Cregis · 地址、入账、出款与链上异常</span>
      <div className="r"><button className="l-btn sm" disabled={loading} onClick={() => void refresh()}>刷新</button></div>
    </div>
    <div className="l-b">
      {loading && !data && <div className="dtint">正在加载…</div>}
      {error && <div className="dtint warn">Cregis 状态加载失败：{error}</div>}
      {data && <>
        <div className="cregis-intro">
          <div><strong>接入模式：{({PROVIDER:"支付服务商模式",provider:"支付服务商模式",MOCK:"模拟模式",DISABLED:"未启用"} as Record<string,string>)[data.mode] ?? "未知"}</strong><span>全局 App 收款入口{data.depositEnabled ? "已启用" : "已关闭"} · 全局自动入账能力{data.depositCreditEnabled ? "已配置" : "未配置"}</span></div>
          <span className={`bdg ${data.provisionGate.state === "IDLE" ? "ok" : "bad"}`}>{data.provisionGate.state === "IDLE" ? "暂无地址在创建" : "停止新地址分配"}</span>
        </div>
        <div className="dtint">全局出款总闸：{payoutCapabilityText(data)}</div>
        <div className="cregis-recon" aria-label="分网络出款能力">{FUNDS_NETWORKS.map(network => {
          const capability = data.networkCapabilities?.find(item => item.network === network);
          return <span key={network}>{network}：{!capability ? "尚未配置，能力待核实" : capability.enabled ? "出款能力已启用，是否放行仍看「提现参数配置」里的网络开关" : !capability.configured ? "出款接入未就绪" : ["SWITCH_OFF", "NETWORK_SWITCH_OFF"].includes(capability.disabledReason ?? "") ? "出款开关已关闭" : "出款暂停，须核对配置与风险状态"}</span>;
        })}</div>
        <div className="cregis-recon">
          <label>网络 <select aria-label="地址池网络" value={poolNetwork} disabled={busy || loading} onChange={event => setPoolNetwork(event.target.value as FundsNetwork)}>{FUNDS_NETWORKS.map(network => <option key={network} value={network}>{network}</option>)}</select></label>
          <span>{poolNetwork} 专属收款地址池：{selectedPool?.available
            ? `可分配 ${selectedPool.unassigned} · 待创建 ${selectedPool.queued ?? 0} · 已分配 ${selectedPool.assigned} · 核对中 ${selectedPool.verifying} · 待核查 ${selectedPool.unknown} · 总计 ${selectedPool.total}${selectedPool.limit > 0 ? `/${selectedPool.limit}` : " · 无总量上限"}${selectedPool.automatic ? ` · 自动补充至 ${selectedPool.reserveTarget ?? 5} 个备用地址` : ""}`
            : selectedPool ? "暂不可用，请刷新核对" : "尚未配置，请核对部署后刷新"}</span>
          {canManage && <button className="l-btn sm" disabled={busy || loading || !canProvisionAddress(data, poolNetwork)} onClick={() => confirmCommand("record",
            `补充一个 ${poolNetwork} 专属收款地址`, "向 Cregis 创建一个候选地址；系统核对归属、余额和链上历史后才可分配给用户。创建结果不明时请先核查，勿连续重试。",
            `/cregis/addresses/provision?network=${poolNetwork}`,
          )}>补充收款地址</button>}
        </div>
        <div className="f-stats cregis-overview">
          <div className="f-stat"><div className="k">全局地址分配</div><div className={`v ${data.provisionGate.assignEnabled ? "" : "cregis-off"}`}>{data.provisionGate.assignEnabled ? "已开启" : "已关闭"}</div><div className="sub">{cregisStateText(data.provisionGate.state)} · {data.provisionGate.updatedAt ?? "更新时间未知"}</div></div>
          <div className="f-stat"><div className="k">全局自动入账</div><div className={`v ${data.provisionGate.creditEnabled ? "" : "cregis-off"}`}>{data.provisionGate.creditEnabled ? "已开启" : "已关闭"}</div><div className="sub">以资金开关为准</div></div>
          <div className="f-stat"><div className="k">待处理资金</div><div className="v">{String(data.unresolvedExposureUsdt ?? "未知")} <small>USDT</small></div><div className="sub">待处理回调 {data.pendingAcceptedDeliveries ?? "未知"}</div></div>
          <div className={`f-stat ${(data.openRiskAlertCount ?? 0) > 0 ? "warn" : ""}`}><div className="k">未解除的紧急与严重告警</div><div className="v">{data.openRiskAlertCount ?? "未知"}</div><div className="sub">全局出款总闸：{payoutSwitchText(data.provisionGate, "未知")}</div></div>
        </div>
        <div className="cregis-recon">
          <span>{poolNetwork} 最近完整对账：<strong>{data.reconcileRuns?.find((row) => row.status === "COMPLETE" && rowNetwork(row) === poolNetwork)?.completedAt?.toString() ?? "尚无"}</strong></span>
          {canManage && <>
          <button className="l-btn sm" disabled={busy || loading || poolNetwork === "TRC20" && !data.networkSwitches?.some(row => row.network === poolNetwork)} onClick={() => confirmCommand("record",
            `立即运行 Cregis ${poolNetwork} 完整对账`, `核对 Cregis 和 ${poolNetwork} 链上记录，发现异常会生成告警。`,
            `/cregis/reconciliation/run?network=${poolNetwork}`,
          )}>立即完整对账</button>
          </>}
          <details><summary>查看最近对账与告警（{data.openRiskAlertCount ?? "未知"}）</summary>
            {data.reconcileRuns?.slice(0, 3).map((row, index) => <div className="s" key={`recon-${index}`}>对账 {cregisStateText(row.status)} · {String(row.completedAt ?? row.startedAt ?? "时间未知")}{row.failureCode ? ` · ${String(row.failureCode)}` : ""}</div>)}
            <div className="s">未解除告警：已载入 {alerts.length} / {data.openRiskAlertCount ?? "未知"}</div>
            {alerts.map((row) => <div className="s" key={`risk-${row.id}`}>{rowSummary(row)} · {({ P0: "紧急", P1: "严重", P2: "警告", P3: "提示" } as Record<string,string>)[String(row.severity)] ?? "未知"} · 告警类型编号：{String(row.kind)} · 证据：{String(row.evidence)}</div>)}
            {alerts.length > 0 && alerts.length < (data.openRiskAlertCount ?? 0) && <button className="l-btn sm" disabled={busy} onClick={() => void loadMoreAlerts(Number(alerts[alerts.length - 1].id))}>加载更早告警</button>}
          </details>
        </div>
        {(!data.depositEnabled || !data.depositCreditEnabled || !data.provisionGate.assignEnabled) && <div className="dtint warn">USDT 充值尚未开放；请勿向测试地址转账。</div>}
        {data.depositEnabled && data.depositCreditEnabled && data.provisionGate.assignEnabled && !data.provisionGate.creditEnabled && <div className="dtint warn">仅开放试点收款地址，到账后进入人工复核，暂不自动入账；请仅按测试安排转账。</div>}
      </>}
      <nav className="cregis-navigation" aria-label="USDT 操作分区">
        {[["records", "收款记录"], ["exceptions", `异常处理${count ? `（${count}）` : ""}`], ["settings", "充值与地址设置"], ["funds", "归集与付款"]].map(([key, title]) =>
          <button key={key} type="button" aria-pressed={section === key} aria-controls={`cregis-${key}`} onClick={() => setSection(key)}>{title}</button>)}
      </nav>
      <section id="cregis-records" hidden={section !== "records"} aria-label="收款记录" className="cregis-content">
        <CregisDepositHistory />
      </section>
      <section id="cregis-exceptions" hidden={section !== "exceptions"} aria-label="异常处理" className="cregis-content">
        <p className="sub">先看异常原因，核对证据后提交处理结果。资金仍按原有复核规则处理。</p>
        {data && <>
        <div className="cregis-exceptions">
          <div className="cregis-section-title">异常队列 <span>共 {count} 项</span></div>
          {count === 0 && (data.openRiskAlertCount ?? 0) === 0 && (data.pendingAcceptedDeliveries ?? 0) === 0 && <div className="dtint">暂无异常。</div>}
          <div className="cregis-queue-grid">{QUEUES.map(([key, label]) => <div className={`cregis-queue ${data[key].length ? "active" : ""}`} key={key}>
            <div className="cregis-queue-head"><span>{label}</span><strong>{data[key].length}</strong></div>
            {data[key].slice(0, 5).map((item, index) => <div className="s" key={`${key}-${index}`}>{rowSummary(item)}</div>)}
            {data[key].length > 5 && <div className="s">只显示前 5 项。</div>}
          </div>)}</div>
        </div>
        {data.addressPool?.lastError && <div className="dtint warn">{data.addressPool.lastError === "CREGIS_ADDRESS_QUOTA_EXCEEDED"
          ? "Cregis 地址额度不足，请扩容后恢复补充。" : data.addressPool.lastError === "CREGIS_ADDRESS_RATE_LIMITED"
          ? "Cregis 限制了请求频率，稍后会自动继续补充。" : "Cregis 暂时不接受创建地址，请检查地址额度和服务状态后再恢复。"}</div>}
        {canManage && <>
        <div className="cregis-panel">
          <div className="cregis-panel-title">大额入金复核</div>
          <p>只支持暂停审核；找不到对应订单的资金或链上交易重组时，须保持冻结并核查。</p>
          <div className="cregis-review-form">
          <input aria-label="待审核 Cregis CID" placeholder="Cregis CID" value={cid} onChange={(event) => setCid(event.target.value)} />{" "}
          <button className="l-btn sm" disabled={busy || !/^\d+$/.test(cid) || !Number.isSafeInteger(Number(cid)) || Number(cid) <= 0} onClick={() => void previewReview(Number(cid))}>实时核验证据</button>{" "}
          <button className="l-btn sm mc" disabled={busy || String(reviewEvidence?.cid) !== cid} onClick={() => confirmCommand("funds",
            "提交 Cregis 入金复核", `CID ${cid} · 证据 ${String(reviewEvidence?.evidenceHash)}。需另一位管理员复核。`,
            "/cregis/review-cases", { cid: Number(cid), evidenceHash: reviewEvidence?.evidenceHash },
          )}>提交入金复核</button>
          </div>
          {reviewEvidence && <div className="cregis-case"><dl className="ui-facts-grid">
            {[["核对时间", reviewEvidence.checkedAt], ["支付商核对", reviewEvidence.providerMatched ? "匹配" : "未匹配"], ["链上核对", reviewEvidence.chainMatched ? "匹配" : "未匹配"], ["Cregis 订单编号", reviewEvidence.cid], ["用户", reviewEvidence.userId], ["毛额（USDT）", reviewEvidence.grossAmount], ["手续费（USDT）", reviewEvidence.feeAmount ?? "未提供"], ["净入账（USDT）", reviewEvidence.proposedNetAmount], ["交易哈希", reviewEvidence.txid], ["地址", reviewEvidence.address], ["区块哈希", reviewEvidence.blockHash], ["确认数", reviewEvidence.confirmations], ["证据摘要", reviewEvidence.evidenceHash]].map(([title, value]) => <div key={String(title)}><dt>{String(title)}</dt><dd>{String(value)}</dd></div>)}
          </dl></div>}
          <div className="cregis-case-count">待审核工单：已载入 {reviewCases.length} / {data.openReviewCaseCount ?? "未知"}</div>
          {reviewCases.map((row) => <div className="cregis-case" key={`review-${row.id}`}>
            <dl className="ui-facts-grid">{[["工单", row.id], ["Cregis 订单编号", row.cid], ["用户", row.userId], ["链上毛额（USDT）", row.grossAmount], ["手续费（USDT）", row.feeAmount ?? "未提供"], ["钱包净入账（USDT）", row.proposedNetAmount], ["地址", row.address], ["交易哈希", row.txid], ["区块", row.blockNumber], ["日志序号", row.logIndex], ["确认数", row.confirmations], ["发起人", row.makerId], ["理由", row.reason], ["证据摘要", row.evidenceHash]].map(([title, value]) => <div key={String(title)}><dt>{String(title)}</dt><dd>{String(value)}</dd></div>)}</dl>
            <button className="l-btn sm" disabled={busy} onClick={() => void previewReview(Number(row.cid))}>刷新证据</button>{" "}
            <button className="l-btn sm" disabled={busy || String(reviewEvidence?.cid) !== String(row.cid) || String(reviewEvidence?.evidenceHash) !== String(row.evidenceHash)} onClick={() => confirmCommand("funds",
              `复核入账 CID ${String(row.cid)}`, `交易 ${String(row.txid)}，毛额 ${String(row.grossAmount)} USDT，净入账 ${String(row.proposedNetAmount)} USDT 给用户 ${String(row.userId)}。请独立核对地址 ${String(row.address)}、发起理由 ${String(row.reason)} 与证据 ${String(row.evidenceHash)}。`,
              `/cregis/review-cases/${row.id}/decision`, { expectedVersion: row.version, decision: "APPROVE" },
            )}>复核入账</button>{" "}
            <button className="l-btn sm" disabled={busy} onClick={() => confirmCommand("record",
              `拒绝 Cregis 入金复核 #${row.id}`, `CID ${String(row.cid)} · 证据 ${String(row.evidenceHash)}`,
              `/cregis/review-cases/${row.id}/decision`, { expectedVersion: row.version, decision: "REJECT" },
            )}>拒绝</button>
          </div>)}
          {reviewCases.length > 0 && reviewCases.length < (data.openReviewCaseCount ?? 0) && <button className="l-btn sm" disabled={busy} onClick={() => void loadMoreReviewCases(Number(reviewCases[reviewCases.length - 1].id))}>加载更早工单</button>}
        </div>
        </>}
        <CregisExceptionOperations canManage={canManage} openActionConfirm={openActionConfirm}
          sources={[
            ...data.heldDeposits.filter(row => row.status === "DUST_HOLD").map(row => ({ sourceType: "EVENT", sourceId: String(row.id), title: `低额入金 #${row.id} · ${row.grossAmount ?? "待核对"} USDT` })),
            ...data.unattributed.map(row => ({ sourceType: "OBSERVATION", sourceId: String(row.id), title: `未归属入金 #${row.id} · ${row.rawAmount ?? "待核对"} USDT` })),
          ]} />
        </>}
      </section>
      <section id="cregis-settings" hidden={section !== "settings"} aria-label="充值与地址设置" className="cregis-content">
        {pendingSwitchCommands.length > 0 && <div className="dtint warn" role="status">资金开关操作结果待确认，可能已经生效。请按原请求恢复，不要另建提案或重新填写理由。
          {pendingSwitchCommands.map(pending => <div className="p-row" key={pending.commandKey}><div className="txt"><div>{pending.path === "/cregis/switch-cases" ? "开关提案" : pending.path === "/cregis/switches/emergency-off" ? "紧急停用" : "提案复核"}</div><div className="sub mono">原请求：{pending.commandKey}</div></div>
            {canManage && <button className="l-btn sm" disabled={busy || loading} onClick={() => void recoverSwitchCommand(pending.commandKey)}>按原请求恢复</button>}
          </div>)}
        </div>}
        <CregisDepositPolicy canManage={canManage} openActionConfirm={openActionConfirm} onActivityChange={setProposalActivity} />
        {data && <CregisPoolPolicy canManage={canManage} openActionConfirm={openActionConfirm} />}
        {data && <>
        <div className="cregis-panel cregis-network-controls">
          <h3 className="cregis-panel-title">分网络充值开关</h3>
          <p>选择目标状态后提交审批，另一位管理员复核后生效。</p>
          {!data.networkSwitches && <div className="dtint warn">后端尚未提供分网络充值开关，当前不能修改。请核对部署并刷新。</div>}
          {data.networkSwitches && <div className="cregis-network-grid" role="table" aria-label="分网络充值开关">
            <div className="cregis-network-row cregis-network-head" role="row">
              {["网络 / 当前配置", "充值目标", "实际开放情况", "操作"].map(label => <div role="columnheader" key={label}>{label}</div>)}
            </div>
            {FUNDS_NETWORKS.map(network => {
              const row = data.networkSwitches!.find(item => item.network === network);
              if (!row) return <div className="cregis-network-row" role="row" key={network}>
                <div role="cell"><strong>{network}</strong><div className="sub">{networkName[network]} / 当前：尚未配置</div></div>
                <div role="cell" className="sub">待后端配置</div>
                <div role="cell" className="cregis-network-availability cregis-network-blocked">实际开放情况待核实，请核对部署后刷新</div>
                <div role="cell">{canManage ? <button className="l-btn sm" disabled>尚未配置</button> : <span className="sub">只读</span>}</div>
              </div>;
              const draft = networkDrafts[row.network];
              const pending = data.switchCases?.some(item => item.status === "MAKER_DONE" && item.network === row.network);
              const restoring = (data.provisionGate.state !== "IDLE" || !data.provisionGate.assignEnabled || !data.provisionGate.creditEnabled) && draft?.depositEnabled === true;
              return <div className="cregis-network-row" role="row" key={row.network}>
                <div role="cell"><strong>{row.network}</strong><div className="sub">{networkName[row.network]} / 当前：{row.depositEnabled ? "开启" : "关闭"}</div></div>
                <div role="cell"><label><input type="checkbox" aria-label={`${row.network} 充值目标`} checked={draft?.depositEnabled ?? row.depositEnabled}
                  disabled={!canManage || proposalBlocked || loading || pending || !draft} onChange={event => setNetworkDrafts(previous => ({ ...previous, [row.network]: { ...draft!, depositEnabled: event.target.checked } }))} />开启</label></div>
                <div role="cell" className="cregis-network-availability"><span className={!row.depositAvailable || !row.addressAvailable ? "cregis-network-blocked" : ""}>{row.depositAvailable ? row.addressAvailable ? "已开放" : "已开放 · 地址准备中" : availabilityText(row.depositDisabledReason)}</span></div>
                <div role="cell">{canManage ? <button className="l-btn sm" disabled={proposalBlocked || loading || !draft || pending || data.provisionGate.version == null || draft.depositEnabled === row.depositEnabled && !restoring}
                  onClick={() => confirmCommand("config", `提交 ${row.network} 充值${restoring ? "恢复" : "开关"}审批`,
                    `${restoring ? "当前全局暂停，本次只申请恢复所选网络充值；其他网络充值继续保持暂停，不会恢复出款总闸。" : ""}${row.network} 充值：${row.depositEnabled ? "开" : "关"} → ${draft!.depositEnabled ? "开" : "关"}。关闭将停止该网地址分配、链上直付新下单与自动入账，原交易继续核验。`,
                    "/cregis/switch-cases", { network: row.network, expectedVersion: data.provisionGate.version, expectedNetworkVersion: row.version, depositEnabled: draft!.depositEnabled })}>{pending ? "待另一管理员复核" : restoring ? "提交恢复审批" : "提交审批"}</button> : <span className="sub">只读</span>}</div>
              </div>;
            })}
          </div>}
          <p>关闭该网将停止地址分配、链上直付新下单和自动入账，原交易继续核验。关闭一条网络，不改变其他网络的充值开关。</p>
          <div className="cregis-global-payout"><strong>全局链上出款总闸</strong><label><input type="checkbox" aria-label="全局链上出款目标" checked={globalPayout?.enabled ?? Boolean(data.provisionGate.payoutEnabled)} disabled={!canManage || proposalBlocked || loading || !globalPayout} onChange={event => setGlobalPayout(previous => previous ? { ...previous, enabled: event.target.checked } : previous)} />开启</label>
            {canManage && <button className="l-btn sm" disabled={proposalBlocked || loading || !globalPayout || globalPayout.enabled === Boolean(data.provisionGate.payoutEnabled) && data.provisionGate.state === "IDLE"}
              onClick={() => confirmCommand("config", "提交全局链上出款审批", `BEP20 / ERC20 / TRC20 三网共用出款总闸：${data.provisionGate.payoutEnabled ? "开" : "关"} → ${globalPayout!.enabled ? "开" : "关"}。不恢复充值，也不修改 D5 的分网络提现许可；开启后仍须满足支付商、对账、风险和单笔审核条件。`,
                "/cregis/switch-cases", { expectedVersion: data.provisionGate.version, payoutEnabled: globalPayout!.enabled })}>提交出款审批</button>}
            <span>BEP20 / ERC20 / TRC20 分别是否允许提现，在 D5 设置。</span>
          </div>
          <a className="cregis-config-link" href="/finance/params">前往 USDT 提现参数 →</a>
        </div>
        <div className="cregis-panel cregis-network-controls">
          <h3 className="cregis-panel-title">待复核申请</h3>
          {!data.switchCases?.some(row => row.status === "MAKER_DONE") && <p>暂无待复核申请。</p>}
          {data.switchCases?.filter(row => row.status === "MAKER_DONE").map(row => {
            const network = row.network ?? "全局出款";
            const detail = row.network ? `${network} 充值 ${row.beforeDepositEnabled == null ? "原值" : row.beforeDepositEnabled ? "开" : "关"} → ${row.creditEnabled ? "开" : "关"}` : `全局链上出款 → ${payoutSwitchText(row)}`;
            const stale = Boolean(row.expectedVersion !== data.provisionGate.version || row.network && data.networkSwitches?.find(item => item.network === row.network)?.version !== row.expectedNetworkVersion);
            const ownProposal = adminId != null && String(row.makerId) === String(adminId);
            const decisionBlocked = busy || pendingSwitchCommands.some(pending => pending.path === `/cregis/switch-cases/${row.id}/decision`);
            return <div className="cregis-case" key={`switch-${row.id}`}><div>提案 #{String(row.id)} · {detail} · 发起人 {String(row.makerId)} · {String(row.reason)}</div>{stale && <p>配置版本已变，请拒绝后重新申请。</p>}{ownProposal && <p>这是你发起的，需要另一位管理员处理</p>}{canManage && <div className="cregis-switch-form">
              <button className="l-btn sm" disabled={decisionBlocked || loading || ownProposal || Boolean(stale)} onClick={() => confirmCommand("config", `复核 ${network} 提案 #${row.id}`, `${detail}；发起人 ${String(row.makerId)}；理由 ${String(row.reason)}。按当前条件核验后生效。`,
                `/cregis/switch-cases/${row.id}/decision`, { decision: "APPROVE" })}>复核通过</button>
              <button className="l-btn sm" disabled={decisionBlocked || loading || ownProposal} onClick={() => confirmCommand("record", `拒绝 ${network} 提案 #${row.id}`, `${detail}；发起理由 ${String(row.reason)}`,
                `/cregis/switch-cases/${row.id}/decision`, { decision: "REJECT" })}>拒绝</button>
            </div>}</div>;
          })}
        </div>
        {canManage && <div className="cregis-danger-zone cregis-network-controls"><strong>全局紧急停用</strong><p>立即停止 BEP20 / ERC20 / TRC20 三网的地址分配、自动入账和新出款，继续接收回调并查询原单。旧提案失效，恢复须重新核对条件并提交审批。</p>
          <button className="l-btn sm cregis-danger-button" disabled={busy || loading || pendingSwitchCommands.some(pending => pending.path === "/cregis/switches/emergency-off") || data.provisionGate.version == null} onClick={() => confirmCommand("emergency", "紧急停用 BEP20、ERC20 与 TRC20", "立即停止三网地址分配、自动入账和新出款；原交易继续核验和查询。",
            "/cregis/switches/emergency-off", { expectedVersion: data.provisionGate.version })}>紧急停用三网</button>
        </div>}
        </>}
      </section>
      <section id="cregis-funds" hidden={section !== "funds"} aria-label="归集与付款" className="cregis-content">
        <p className="sub">自动任务与人工准备单分别管理。查看各自的运行状态和执行条件后再操作。</p>
        {data && <>
          <CregisAutoForward canManage={canManage} openActionConfirm={openActionConfirm} />
          <CregisFundsPreparation canManage={canManage} openActionConfirm={openActionConfirm} />
        </>}
      </section>
    </div>
  </section>;
}
