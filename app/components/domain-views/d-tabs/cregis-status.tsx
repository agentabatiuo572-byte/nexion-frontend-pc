"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, BellRing, Clock, Coins, FileSearch, Inbox, MapPin, Power, RefreshCw, ShieldAlert, ShieldCheck, ToggleRight, Wallet, XCircle } from "lucide-react";
import {
  BlockState, Button, Cell, ConfigList, ConfigRow, Decision, Drawer, Explain, Fact, Facts, Fold, Input, IrreversibleTag, JudgmentPoints, KeyValues, MoreMenu, Notice,
  PageTabs, Panel, Stat, StatBand, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr, useTabIds, FilterField, Change,
} from "@/app/components/rd";
import type { StateTone } from "@/app/components/rd";
import { D1_COMMAND_EXPIRED_TEXT, d1CommandReplayable, d1PendingObjectReason, financeAdminRequest, listD1PendingCommands, listD1PendingCregisSwitchCommands, releaseD1PendingCommand, retryD1PendingCommand, retryD1PendingCregisSwitchCommand, type D1PendingCommand, type D1PendingTopupCommand } from "@/lib/admin/d-client";
import { adminAuthLifecycleEpoch, AdminAuthEpochChangedError } from "@/lib/admin/auth-lifecycle";
import { useReach } from "@/lib/nav/use-reach";
import Link from "next/link";
import { ADMIN_ERROR_MESSAGES, displayAdminReadError } from "@/lib/admin/error-messages";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { exceptionObject } from "@/lib/admin/cregis-exceptions";
import type { OperatorBriefKind } from "../design-kit";
import type { DCtx } from "./types";
import { CregisExceptionOperations, type ClaimSource, type RecoveredChallenge } from "./cregis-exceptions";
import { CregisFundsPreparation } from "./cregis-funds-preparation";
import { CregisAutoForward } from "./cregis-auto-forward";
import { CregisPoolPolicy } from "./cregis-pool-policy";
import { CregisDepositPolicy, type DepositProposalActivity } from "./cregis-deposit-policy";
import { LongValue, PendingNotices, SwitchTag, countText, readParam, usdt, writeParams, zoneLabel, type D1Activity, type D1Count, type D1PendingItem } from "./d1-shared";

type ExceptionRow = Record<string, unknown>;
type FundsNetwork = "BEP20" | "ERC20" | "TRC20";
const FUNDS_NETWORKS: FundsNetwork[] = ["BEP20", "ERC20", "TRC20"];
const networkName = { BEP20: "BNB Smart Chain", ERC20: "Ethereum", TRC20: "TRON" };
type NetworkSwitch = { network: FundsNetwork; depositEnabled: boolean; version: number;
  depositAvailable: boolean; addressAvailable: boolean; depositDisabledReason: string | null };
const availabilityText = (reason: string | null) => ({ NETWORK_SWITCH_OFF: "该网络开关已关闭", GLOBAL_SWITCH_OFF: "全局开关已关闭",
  NOT_CONFIGURED: "接入配置未就绪", RISK_HOLD: "风险暂停，请核对异常与告警", RECONCILIATION_REQUIRED: "需完成资金对账",
  ADDRESS_POOL_EMPTY: "缺少可分配地址，已有地址按原状态处理", WITHDRAWAL_NETWORK_OFF: "请核对 D5 提现网络许可",
  SWITCH_OFF: "全局出款开关已关闭", PAYOUT_ASSET_UNAVAILABLE: "收款服务未开通该网络出款",
  PROVIDER_CAPABILITY_UNAVAILABLE: "暂时无法核实收款服务能力", ADDRESS_ASSET_UNAVAILABLE: "收款服务未开通该网络收款地址",
  CHAIN_PROOF_UNAVAILABLE: "TRON 节点或收款服务暂时读不到" } as Record<string,string>)[reason ?? ""] ?? (reason ? "状态待核实，请刷新或查看异常" : "可用");
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

type QueueKey = keyof Pick<CregisExceptions, "uncertainAddresses" | "heldDeposits" | "failedDeliveries" | "pendingDeliveries" | "unattributed" | "providerMissing">;
const QUEUES: Array<[QueueKey, string]> = [
  ["uncertainAddresses", "新地址待核对"],
  ["heldDeposits", "入金待人工处理"],
  ["failedDeliveries", "回调处理失败"],
  ["pendingDeliveries", "待处理的回调"],
  ["unattributed", "未归属链上入金"],
  ["providerMissing", "收款服务缺单 / 链上待核对"],
];
/** 后端每个队列最多给 50 条，到 50 写「50+」。 */
const QUEUE_LIMIT = 50;

/**
 * 异常表状态的颜色：一表都是待处理时默认灰字加时钟，颜色留给例外（VS-21）。失败红、结果未知橙、系统处理中蓝（VS-20、DT-13）。
 */
function entryTag(entry: { queue: QueueKey; counted: boolean; row: ExceptionRow }, label: string) {
  if (!entry.counted) return <StatusTag tone="progress">系统处理中</StatusTag>;
  if (entry.queue === "failedDeliveries") return <StatusTag tone="danger" icon={XCircle}>{label}</StatusTag>;
  if (String(entry.row.state ?? entry.row.status) === "UNKNOWN") return <StatusTag tone="warn">{label}</StatusTag>;
  return <StatusTag tone="neutral" icon={Clock}>{label}</StatusTag>;
}
/** 新地址里要人处理的状态；创建中、核对中由定时任务处理（需求第 28 条）。 */
const ADDRESS_ATTENTION = ["UNKNOWN", "UNATTRIBUTED_HOLD", "RETIRED_HOLD"];

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

const poolOf = (data: CregisExceptions, network: FundsNetwork) => data.addressPools?.[network] ?? (network === "BEP20" ? data.addressPool : undefined);

/** TRC20 要后端返回它的充值开关才算配置好；BEP20、ERC20 一直有。 */
const networkConfigured = (data: CregisExceptions, network: FundsNetwork) => network !== "TRC20" || data.networkSwitches?.some(row => row.network === network) === true;

/** 补充收款地址为什么不能点，写第一条不满足的（D1 第五节）。 */
function provisionBlock(data: CregisExceptions, network: FundsNetwork): string | undefined {
  const pool = poolOf(data, network);
  if (data.mode !== "PROVIDER") return "未接入收款服务";
  if (data.provisionGate.state !== "IDLE") return "新地址分配已停止";
  if (!data.provisionGate.assignEnabled) return "地址分配已关闭";
  if (pool?.available !== true) return "这个网络未开放";
  if (!networkConfigured(data, network)) return "这个网络尚未配置";
  if (pool.limit > 0 && pool.total >= pool.limit) return "已到总量上限";
  if (pool.verifying > 0) return "有地址在核对，等核对完";
  if (pool.unknown > 0) return "有地址待核查，先处理异常";
  return undefined;
}

/** 出款能力在值列只写状态，原因进名称旁的问号，1024 下也一行（DP-06、视觉复查必须改 15）。 */
function payoutCapabilityState(data: CregisExceptions): { value: string; note: string } {
  const capability = data.providerPayout;
  if (!capability) return { value: "待核实", note: "链上出款能力尚未确认，请刷新核对；当前不能开启" };
  if (capability.enabled) return { value: "已启用", note: "提现仍须通过原有资格、审核与链上确认" };
  switch (capability.disabledReason) {
    case "NOT_CONFIGURED": return { value: "未就绪", note: "链上出款接入尚未就绪，当前不能开启" };
    case "SWITCH_OFF": return { value: "已关闭", note: "开启须由另一位管理员复核" };
    case "RISK_HOLD": return { value: "风险暂停", note: "请先查看异常和告警" };
    case "RECONCILIATION_REQUIRED": return { value: "待对账", note: "需要先完成资金对账，请核对对账结果" };
    default: return { value: "待核实", note: "请刷新后再试；当前不能开启" };
  }
}

function payoutCapabilityText(data: CregisExceptions): string {
  const capability = data.providerPayout;
  if (!capability) return "链上出款能力尚未确认，请刷新核对；当前不能开启。";
  if (capability.enabled) return "链上出款能力已启用，提现仍须通过原有资格、审核与链上确认。";
  switch (capability.disabledReason) {
    case "NOT_CONFIGURED": return "链上出款接入尚未就绪，当前不能开启。";
    case "SWITCH_OFF": return "链上出款开关已关闭；开启须由另一位管理员复核。";
    case "RISK_HOLD": return "链上出款因风险暂停，请先查看异常和告警。";
    case "RECONCILIATION_REQUIRED": return "链上出款需要先完成资金对账，请核对对账结果。";
    default: return "链上出款能力待核实，请刷新后再试；当前不能开启。";
  }
}

const onOff = (value: unknown, unknownText = "保持现值") => value === true || value === 1 ? "开" : value === false || value === 0 ? "关" : unknownText;
const MODE_TEXT: Record<string, string> = { PROVIDER: "已接入收款服务", provider: "已接入收款服务", MOCK: "模拟模式", DISABLED: "未接入" };
/** 告警类型中文，按后端写入的 kind（CregisDepositService、CregisDepositSwitchService、CregisExceptionRefundService、自动归集）。 */
const ALERT_KIND: Record<string, string> = {
  PROVIDER_ORPHAN: "收款服务有记录、平台没有", PLATFORM_ORPHAN: "平台有记录、收款服务没有", UNRESOLVED_EXPOSURE: "待处理资金过多",
  MANUAL_EMERGENCY_OFF: "管理员紧急停用", CREGIS_SWITCH_EMERGENCY_OFF: "紧急停用", REFUND_LATE_EVIDENCE: "退款后链上证据又变化", AUTO_FORWARD_UNKNOWN: "自动归集结果未知",
};
const cregisStateText = (value: unknown) => ({ IDLE: "暂无地址在创建", BUSY: "正在创建地址", BLOCKED: "风险暂停", DISABLED: "未接入收款服务", MISSING: "开关设置缺失", UNKNOWN: "创建结果待核实", PROVISIONING: "地址创建中", VERIFYING: "地址核对中", UNATTRIBUTED_HOLD: "未归属充值待处理", RETIRED_HOLD: "停用地址充值待处理", DUST_HOLD: "低额充值待处理", REVIEW_HOLD: "大额充值待审核", REORG_INVESTIGATING: "链重组调查中", PROVIDER_CONFLICT_HOLD: "收款服务与链上记录冲突待处理", PROVIDER_MISSING: "收款服务缺单待核对", CHAIN_MISMATCH_HOLD: "链上记录不符待核对", RUNNING: "对账中", COMPLETE: "完整对账完成", INCOMPLETE: "对账未完成", MAKER_DONE: "待另一位管理员复核", RESOLVED: "复核处理完成", REJECTED: "已驳回" } as Record<string,string>)[String(value)] ?? "状态待核实";
const SEVERITY: Record<string, [string, StateTone]> = { P0: ["紧急", "danger"], P1: ["严重", "danger"], P2: ["警告", "warn"], P3: ["提示", "neutral"] };
function rowNetwork(row: { network?: unknown; chainId?: unknown; chain_id?: unknown }): FundsNetwork | null {
  if (row.network === "BEP20" || row.network === "ERC20" || row.network === "TRC20") return row.network;
  if (row.network !== undefined && row.network !== null) return null;
  const chain = row.chainId ?? row.chain_id;
  return chain == null ? "BEP20" : chain === "60" || chain === 60 ? "ERC20" : chain === "2510" || chain === 2510 ? "BEP20" : chain === "195" || chain === 195 ? "TRC20" : null;
}
const text = (value: unknown) => value == null || value === "" ? "—" : String(value);
/** 表格里的长地址、哈希只写头尾，全文在悬停和详情里。 */
const shortHash = (value: unknown) => { const full = text(value); return full.length > 18 ? `${full.slice(0, 10)}…${full.slice(-6)}` : full; };
const time = (value: unknown) => formatBusinessTimeCompact(typeof value === "string" ? value : undefined, "—");
const isMaker = (row: ExceptionRow, adminId: unknown) => String(row.makerId) === String(adminId);

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
  REORG_INVESTIGATING: "链重组调查", PROVIDER_CONFLICT_HOLD: "收款服务记录冲突，已冻结",
};
const depositLabel = (row: DepositRow) => row.status === "CREDITED" && !row.depositNo ? "入账记录异常" : DEPOSIT_STATUS[row.status] ?? "充值状态待核实";
const depositTone = (row: DepositRow): StateTone => row.status === "CREDITED" && row.depositNo ? "ok" : row.status.endsWith("HOLD") || row.status === "REORG_INVESTIGATING" || row.status === "CREDITED" ? "warn" : "progress";

function CregisDepositHistory({ reloadKey }: { reloadKey: number }) {
  const [page, setPage] = useState<DepositPage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
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
      if (current === requestId.current) setError(displayAdminReadError(failure));
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); return () => { requestId.current++; }; }, [load, reloadKey]);
  const items = page?.items ?? [];
  const index = items.findIndex((row) => row.id === selected);
  const row = index >= 0 ? items[index] : null;
  const zone = zoneLabel();
  return <>
    <Panel flush icon={Inbox} tone="role-2" title="USDT 入金记录 / 充值单" explain="链上转账经收款服务和链上核实后生成入金记录，入账时生成充值单。未入账的净额只供核对。"
      actions={<Button size="sm" variant="ghost" icon={<RefreshCw size={14} aria-hidden />} loading={loading} onClick={() => void load()}>刷新</Button>}>
      <Table label="USDT 入金记录" aria-busy={loading}>
        <thead><tr>
          <Th sticky="start">入金 · 充值单</Th>
          <Th>用户 · 网络</Th>
          <Th align="right" icon={Coins} tone="money">净额（USDT）</Th>
          <Th>状态</Th>
          <Th>发现 · 入账（{zone}）</Th>
          <Th sticky="end" align="right">操作</Th>
        </tr></thead>
        <tbody>
          {loading && !page ? <TableLoading columns={6} rows={4} />
            : error ? <TableMessage columns={6} role="alert">入金记录读取失败。{error} <Button size="sm" onClick={() => void load()}>重试</Button></TableMessage>
              : page && !page.available ? <TableMessage columns={6} role="status">USDT 收款还没接入或已停用，历史记录暂时查不了（不代表没有入金）。</TableMessage>
                : items.length === 0 ? <TableMessage columns={6} role="status">暂无已核实的链上入金。待处理的回调和缺单可在“异常处理”查看。</TableMessage>
                  : items.map((item) => <Tr key={item.id} selected={item.id === selected} onOpen={() => setSelected(item.id)}>
                    <Td sticky="start"><Cell mono main={`CID ${item.cid}`} sub={item.depositNo ? <span data-mono>{item.depositNo}</span> : item.status === "CREDITED" ? "充值单缺失，请核对" : "尚未生成充值单"} /></Td>
                    <Td><Cell main={item.userId} sub={rowNetwork(item) ?? "网络待核实"} /></Td>
                    <Td align="right"><Cell num main={usdt(item.netAmount)} sub={`毛额 ${usdt(item.grossAmount)}`} /></Td>
                    <Td><Cell main={<StatusTag tone={depositTone(item)}>{depositLabel(item)}</StatusTag>} /></Td>
                    <Td><Cell num main={time(item.createdAt)} sub={item.creditedAt ? `入账 ${time(item.creditedAt)}` : "尚未入账"} /></Td>
                    <Td sticky="end" align="right"><Button size="sm" variant="ghost" onClick={() => setSelected(item.id)}>查看详情</Button></Td>
                  </Tr>)}
        </tbody>
      </Table>
      {page?.available && page.hasMore && <div className="rd-panel-foot"><Button size="sm" loading={loading} onClick={() => void load(page.nextBeforeId)}>加载更早记录</Button></div>}
    </Panel>
    <Drawer open={!!row} onClose={() => setSelected(null)} title="收款记录" sub={row ? `CID ${row.cid}` : undefined} icon={Inbox} tone="role-2"
      nav={{ hasPrev: index > 0, hasNext: index >= 0 && index < items.length - 1, onPrev: () => setSelected(items[index - 1]?.id ?? selected), onNext: () => setSelected(items[index + 1]?.id ?? selected) }}>
      {row && <>
        <JudgmentPoints rows={[
          { label: "净额", icon: Coins, tone: "money", value: `${usdt(row.netAmount)} USDT`, reason: `毛额 ${usdt(row.grossAmount)} · 手续费 ${usdt(row.feeAmount)}` },
          { label: "用户", value: row.userId, reason: rowNetwork(row) ?? "网络待核实" },
          { label: "状态", state: depositTone(row) === "progress" ? undefined : depositTone(row), value: depositLabel(row), reason: row.depositNo ? `充值单 ${row.depositNo}` : undefined },
        ]} />
        <Fold inset title="链上交易" summary={`确认数 ${row.confirmations}`}>
          <KeyValues rows={[
            { key: "tx", label: "交易哈希", value: row.txid, mono: true },
            { key: "log", label: "日志序号", value: row.logIndex },
            { key: "addr", label: "收款地址", value: row.address, mono: true },
            { key: "found", label: `发现（${zone}）`, value: time(row.createdAt) },
            { key: "credit", label: `入账（${zone}）`, value: row.creditedAt ? time(row.creditedAt) : "尚未入账" },
          ]} />
        </Fold>
      </>}
    </Drawer>
  </>;
}

type ExceptionEntry = { key: string; queue: QueueKey; label: string; row: ExceptionRow; counted: boolean };

/** 六个队列合成一张表；未归属和缺单查的是同一张表，按编号去重（需求第 28 条）。 */
function exceptionEntries(data: CregisExceptions): ExceptionEntry[] {
  const unattributedIds = new Set(data.unattributed.map(row => String(row.id)));
  return QUEUES.flatMap(([queue, label]) => data[queue]
    .filter(row => queue !== "providerMissing" || !unattributedIds.has(String(row.id)))
    .map(row => ({
      key: `${queue}:${String(row.id)}`, queue, label, row,
      counted: queue === "pendingDeliveries" ? false : queue === "uncertainAddresses" ? ADDRESS_ATTENTION.includes(String(row.state)) : true,
    })));
}

function entryObject(entry: ExceptionEntry) {
  const row = entry.row;
  if (entry.queue === "uncertainAddresses") return { main: shortHash(row.address), full: text(row.address), sub: `地址 #${text(row.id)}` };
  if (row.cid != null) return { main: `CID ${text(row.cid)}`, full: text(row.txid), sub: <span data-mono>{shortHash(row.txid)}</span> };
  return { main: shortHash(row.txid), full: text(row.txid), sub: row.logIndex != null ? `日志 ${text(row.logIndex)}` : `#${text(row.id)}` };
}
const entryAmount = (row: ExceptionRow) => row.grossAmount ?? row.rawAmount;
const entryState = (entry: ExceptionEntry) => entry.queue === "failedDeliveries" ? "处理失败" : entry.queue === "pendingDeliveries" ? "等待处理"
  : entry.queue === "unattributed" ? cregisStateText("UNATTRIBUTED_HOLD") : cregisStateText(entry.row.state ?? entry.row.status);
/** 没有处理入口的类型写去哪解决（DP-42）。 */
function entryGuide(entry: ExceptionEntry): string {
  if (!entry.counted) return "系统处理中，不用操作。";
  if (entry.queue === "uncertainAddresses") return "这里没有处理入口。新地址核对不过，地址不会分配给用户；补充地址前要先处理完。";
  if (entry.queue === "failedDeliveries") return "这里没有处理入口，请把 CID 和这条记录交给技术值班核对。";
  if (entry.queue === "providerMissing") return "这里没有处理入口。可以在「收款状态」里点「立即完整对账」重新核对。";
  return "";
}

export function CregisStatus({ ctx, onCount, onActivity, onAlert, reloadTick }: {
  ctx: DCtx;
  onCount: (count: D1Count) => void;
  onActivity: (lines: D1Activity) => void;
  onAlert: (alert: boolean) => void;
  reloadTick: number;
}) {
  const { openActionConfirm, toast } = ctx;
  const reach = useReach();
  const session = useAdminAuth(state => state.session);
  const authorities = session?.authorities ?? [];
  const isSuper = session?.role === "superadmin" || session?.role === "super";
  const canRead = isSuper || authorities.includes("finance_d1_read");
  const canManage = isSuper || authorities.includes("finance_d1_channel_manage");
  const canRefund = canManage && authorities.includes("finance_d2_withdrawal_approve");
  const [data, setData] = useState<CregisExceptions | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sub, setSub] = useState(() => readParam("sub", ["records", "exceptions", "settings", "funds"]) ?? "records");
  const subIds = useTabIds();
  const [extraAlerts, setExtraAlerts] = useState<ExceptionRow[]>([]);
  const [extraReviewCases, setExtraReviewCases] = useState<ExceptionRow[]>([]);
  const [proposalActivity, setProposalActivity] = useState<DepositProposalActivity>({ unknown: 0, awaitingApproval: 0 });
  const [pending, setPending] = useState<D1PendingCommand[]>([]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [entryKey, setEntryKey] = useState<string | null>(null);
  const [review, setReview] = useState<{ cid: string; caseRow?: ExceptionRow } | null>(null);
  const [claim, setClaim] = useState<ClaimSource | null>(null);
  const [recoveredChallenge, setRecoveredChallenge] = useState<RecoveredChallenge | null>(null);
  const [manualCid, setManualCid] = useState("");
  const [childKey, setChildKey] = useState(0);
  const sequence = useRef(0);
  const [switchPending, setSwitchPending] = useState<D1PendingTopupCommand[]>([]);
  const syncPending = useCallback(() => {
    setPending(listD1PendingCommands().filter(command => command.path.startsWith("/cregis/")));
    setSwitchPending(listD1PendingCregisSwitchCommands());
  }, []);
  const refresh = useCallback(async () => {
    const current = ++sequence.current, authEpoch = adminAuthLifecycleEpoch();
    setLoading(true);
    setError("");
    setExtraAlerts([]);
    setExtraReviewCases([]);
    syncPending();
    try {
      const next = parseExceptions(await financeAdminRequest<unknown>("/cregis/exceptions", { bankManualAuthEpoch: authEpoch }));
      if (current === sequence.current && authEpoch === adminAuthLifecycleEpoch()) setData(next);
      return true;
    } catch (failure) {
      if (current === sequence.current && authEpoch === adminAuthLifecycleEpoch()) { setData(null); setError(displayAdminReadError(failure)); }
      return false;
    } finally {
      if (current === sequence.current && authEpoch === adminAuthLifecycleEpoch()) setLoading(false);
    }
  }, [syncPending]);
  useEffect(() => { if (canRead) void refresh(); }, [refresh, canRead]);
  const firstTick = useRef(reloadTick);
  useEffect(() => { if (reloadTick !== firstTick.current) { void refresh(); setChildKey(value => value + 1); } }, [reloadTick, refresh]);
  useEffect(() => { writeParams({ sub: sub === "records" ? null : sub }); }, [sub]);

  const entries = useMemo(() => data ? exceptionEntries(data) : [], [data]);
  const counted = entries.filter(entry => entry.counted).length;
  const capped = !!data && QUEUES.some(([key]) => data[key].length >= QUEUE_LIMIT);
  const count: D1Count = loading && !data ? undefined : data ? { n: counted, capped } : "failed";
  useEffect(() => { onCount(canRead ? count : { n: 0 }); }, [onCount, canRead, count && typeof count === "object" ? count.n : count, capped]); // eslint-disable-line react-hooks/exhaustive-deps
  const alertCount = data?.openRiskAlertCount ?? 0;
  useEffect(() => { onAlert(alertCount > 0); }, [onAlert, alertCount]);
  const switchWaiting = data?.switchCases?.filter((row) => row.status === "MAKER_DONE").length ?? 0;
  const activity = useMemo(() => [
    ...(pending.length ? [`有 ${pending.length} 次操作结果未确认`] : []),
    ...(switchPending.length ? [`有 ${switchPending.length} 次收款或出款开关操作结果未确认`] : []),
    ...(switchWaiting ? [`有 ${switchWaiting} 个开关提案待另一位管理员复核`] : []),
    ...(proposalActivity.unknown ? [`共同充值规则有 ${proposalActivity.unknown} 项提案结果待核对`] : []),
    ...(proposalActivity.awaitingApproval ? [`共同充值规则有 ${proposalActivity.awaitingApproval} 项提案待审批`] : []),
  ], [pending.length, switchPending.length, switchWaiting, proposalActivity.unknown, proposalActivity.awaitingApproval]);
  useEffect(() => { onActivity(activity); }, [onActivity, activity]);

  const command = async (path: string, body?: Record<string, unknown>) => {
    if (busy) throw new Error("上一项操作还在处理，请稍后再试");
    const authEpoch = adminAuthLifecycleEpoch();
    setBusy(true);
    try {
      await financeAdminRequest<unknown>(path, {
        method: "POST", body: body ? JSON.stringify(body) : undefined,
        idempotencyPrefix: "cregis-ops", bankManualAuthEpoch: authEpoch,
      });
      if (authEpoch === adminAuthLifecycleEpoch()) toast("已提交", "success");
    } finally {
      if (authEpoch === adminAuthLifecycleEpoch()) {
        setBusy(false);
        syncPending();
        await refresh();
      }
    }
  };

  type ConfirmSpec = { kind: OperatorBriefKind; action: string; title: string; detail: string; path: string; body?: Record<string, unknown>;
    confirmLabel: string; danger?: boolean; effect: ReactNode; facts?: ReactNode; completion: string; businessForm?: Parameters<DCtx["openActionConfirm"]>[0]["businessForm"];
    toBody?: (form: Record<string, string> | undefined, value?: string) => Record<string, unknown>; optionalPolicy?: boolean;
    edit?: Parameters<DCtx["openActionConfirm"]>[0]["edit"] };
  const confirmCommand = (spec: ConfirmSpec) => {
    const held = d1PendingObjectReason(spec.path, spec.body);
    if (held) { toast(held, "warn"); return; }
    const authEpoch = adminAuthLifecycleEpoch();
    openActionConfirm({ briefKind: spec.kind,
      action: spec.action, title: spec.title, detail: spec.detail, reasonMin: 10, reasonMax: 255,
      confirmLabel: spec.confirmLabel, confirmTone: spec.danger ? "danger" : "primary",
      effect: spec.effect, facts: spec.facts, completionCopy: spec.completion, businessForm: spec.businessForm, edit: spec.edit,
      reasonPolicyOptional: spec.optionalPolicy,
      run: (reason, _value, form) => {
        if (authEpoch !== adminAuthLifecycleEpoch()) throw new AdminAuthEpochChangedError();
        return command(spec.path, { ...spec.body, ...spec.toBody?.(form, _value), reason });
      },
    });
  };
  const approval = <StatusTag tone="progress" filled>另一位管理员复核后生效</StatusTag>;
  const now = <StatusTag tone="progress" filled>立即生效</StatusTag>;

  const loadMoreAlerts = async (beforeId: number) => {
    setBusy(true);
    try {
      const rows = await financeAdminRequest<ExceptionRow[]>(`/cregis/risk-alerts/${beforeId}`);
      setExtraAlerts((previous) => [...previous, ...rows]);
    } catch (failure) {
      toast(`告警加载失败：${displayAdminReadError(failure)}`, "error");
    } finally { setBusy(false); }
  };
  const loadMoreReviewCases = async (beforeId: number) => {
    setBusy(true);
    try {
      const rows = await financeAdminRequest<ExceptionRow[]>(`/cregis/review-cases/before/${beforeId}`);
      setExtraReviewCases((previous) => [...previous, ...rows]);
    } catch (failure) {
      toast(`复核工单加载失败：${displayAdminReadError(failure)}`, "error");
    } finally { setBusy(false); }
  };

  if (!canRead) return <BlockState state="denied" title="无权限访问" detail="这个账号没有 USDT 收款的读取权限。" />;

  const alerts = [...(data?.riskAlerts ?? []), ...extraAlerts];
  const reviewCases = [...(data?.reviewCases ?? []), ...extraReviewCases];
  const readBlock = loading ? "正在读取最新数据" : busy ? "正在提交" : !data ? "收款状态没读到，刷新后再试" : undefined;
  const gate = data?.provisionGate;
  const emergencyBlock = readBlock ?? (data?.mode !== "PROVIDER" ? "没有接入收款服务，没有可关闭的开关。" : gate?.version == null ? "开关状态读不到，刷新后再试。" : undefined);
  const switchBlock = readBlock ?? (data?.mode !== "PROVIDER" ? "没有接入收款服务，开关不能修改。" : gate?.version == null ? "开关状态读不到，刷新后再试。" : undefined);
  const proposalBlock = switchBlock ?? (switchPending.some(record => record.path === "/cregis/switch-cases") ? "上一个开关提案结果未确认，先在上方核对" : undefined);
  const globalPaused = !!gate && (gate.state !== "IDLE" || !gate.assignEnabled || !gate.creditEnabled);
  const switchState = (value: unknown): StateTone => gate?.state === "BLOCKED" ? "danger" : value ? "ok" : "neutral";
  /** 读回这条命令改的对象现在是什么样，只给事实，不当成原命令的结果（OP-93、OP-95）。 */
  const verifyCregisCommand = async (record: D1PendingCommand) => {
    const kept = "状态可能是别人改的，待确认继续保留。";
    if (record.path.startsWith("/cregis/exception-ownership/challenges")) return "生成签名原文不动钱；读回不能证明原操作的结果，待确认继续保留。请按原操作重试取回原文。";
    if (record.path.startsWith("/cregis/addresses/policy")) {
      const policy = await financeAdminRequest<Record<string, unknown>>("/cregis/addresses/policy");
      return `读回：地址池配置现在是第 ${text(policy.version)} 版，自动补充${policy.enabled ? "开启" : "关闭"}，备用目标 ${text(policy.target)} 个。${kept}`;
    }
    const next = parseExceptions(await financeAdminRequest<unknown>("/cregis/exceptions"));
    setData(next);
    const network = new URLSearchParams(record.path.split("?")[1] ?? "").get("network") as FundsNetwork | null;
    if (record.path.startsWith("/cregis/addresses/provision") && network) {
      const pool = poolOf(next, network);
      return pool?.available ? `读回：${network} 可分配 ${pool.unassigned}、待创建 ${pool.queued ?? 0}、总计 ${pool.total}。看待创建有没有多出这一个，再到操作记录确认。` : `读回：${network} 地址池暂时读不到。待确认继续保留。`;
    }
    if (record.path.startsWith("/cregis/reconciliation/run") && network) {
      const run = next.reconcileRuns?.find(row => rowNetwork(row) === network);
      return run ? `读回：${network} 最近一次完整对账「${cregisStateText(run.status)}」，${time(run.completedAt ?? run.startedAt)}（${zoneLabel()}）。${kept}` : `读回：${network} 还没有完整对账记录。${kept}`;
    }
    if (record.path.startsWith("/cregis/review-cases")) {
      let cid = "";
      try { cid = String((JSON.parse(record.body) as { cid?: unknown }).cid ?? ""); } catch { /* 复核决定的 body 里没有 cid */ }
      const id = record.path.split("/")[3];
      const found = (next.reviewCases ?? []).find(row => (id && id !== "" && String(row.id) === id) || (cid && String(row.cid) === cid));
      return found ? `读回：复核工单 #${text(found.id)} 现在是「${cregisStateText(found.status)}」。${kept}` : `读回：待复核列表里没有这条工单，可能已经处理完。请到操作记录确认。`;
    }
    return `读回：收款状态已重新读取。${kept}`;
  };
  const pendingItems: D1PendingItem[] = pending.map((record): D1PendingItem => {
    const refund = record.path.startsWith("/cregis/refunds") || record.path.startsWith("/cregis/auto-forward") || record.path.startsWith("/cregis/funds-preparation");
    const replayable = d1CommandReplayable(record.path);
    return {
      key: record.commandKey,
      label: cregisCommandLabel(record.path),
      createdAt: record.createdAt,
      hint: replayable ? "先读回核对；按原操作重试用同一个命令号，不会重复执行。"
        : "这项操作未接入命令号去重，不能重试。读回只展示当前事实，记录保留到关标签页。",
      blocked: record.expiresAt <= Date.now() ? D1_COMMAND_EXPIRED_TEXT : (refund ? canRefund : canManage) ? undefined : "这个账号没有这项权限",
      auditHref: "/platform/audit?domain=D",
      verify: () => verifyCregisCommand(record),
      retry: replayable ? async () => {
        setBusy(true);
        try {
          const result = await retryD1PendingCommand(record.commandKey);
          if (record.path === "/cregis/exception-ownership/challenges") {
            const request = exceptionObject(JSON.parse(record.body));
            setRecoveredChallenge({ request, challenge: exceptionObject(result) });
            const source = entries.map(claimSource).find(item => item?.sourceType === request.sourceType && item?.sourceId === request.sourceId);
            if (source) setClaim(source);
          }
        } finally { setBusy(false); }
      } : undefined,
      release: () => releaseD1PendingCommand(record.commandKey),
      after: () => { syncPending(); void refresh(); setChildKey(value => value + 1); },
    };
  }).concat(switchPending.map((record): D1PendingItem => ({
    key: record.commandKey,
    label: record.path === "/cregis/switch-cases" ? "开关提案" : record.path === "/cregis/switches/emergency-off" ? "紧急停用三网" : "开关提案复核",
    createdAt: record.createdAt,
    hint: "请按原请求恢复，不要另建提案或重新填写理由。",
    blocked: record.expiresAt <= Date.now() ? D1_COMMAND_EXPIRED_TEXT : canManage ? undefined : "这个账号没有这项权限",
    verify: async () => {
      const next = parseExceptions(await financeAdminRequest<unknown>("/cregis/exceptions"));
      setData(next);
      const gateNow = next.provisionGate;
      const nets = (next.networkSwitches ?? []).map(row => `${text(row.network)} 充值${row.depositEnabled ? "开" : "关"}`).join("、");
      return `读回：${nets || "各网充值开关读不到"}，链上出款${gateNow?.payoutEnabled ? "开" : "关"}，待复核提案 ${next.switchCases?.filter(row => row.status === "MAKER_DONE").length ?? 0} 个。状态可能是别人改的，待确认继续保留。`;
    },
    auditHref: "/platform/audit?domain=D",
    retry: async () => { setBusy(true); try { await retryD1PendingCregisSwitchCommand(record.commandKey); } finally { setBusy(false); } },
    release: () => releaseD1PendingCommand(record.commandKey),
    after: () => { syncPending(); void refresh(); },
  })));
  const entry = entries.find(item => item.key === entryKey) ?? null;
  const entryIndex = entry ? entries.indexOf(entry) : -1;
  const claimSource = (item: ExceptionEntry): ClaimSource | null => {
    if (item.queue === "unattributed") return { sourceType: "OBSERVATION", sourceId: String(item.row.id), title: `未归属入金 #${text(item.row.id)} · ${text(item.row.rawAmount)} USDT`, network: rowNetwork(item.row), dust: false };
    if (item.queue === "heldDeposits" && item.row.status === "DUST_HOLD") return { sourceType: "EVENT", sourceId: String(item.row.id), title: `低额入金 #${text(item.row.id)} · ${text(item.row.grossAmount)} USDT`, network: rowNetwork(item.row), dust: true };
    return null;
  };
  const claimBlock = (source: ClaimSource) => source.network === "ERC20" ? "ERC20 入金这里不能认领或退款" : readBlock;
  const entryAction = (item: ExceptionEntry): { label: string; block?: string; run: () => void } | null => {
    if (!canManage) return null;
    if (item.queue === "heldDeposits" && item.row.status === "REVIEW_HOLD" && item.row.cid != null) return { label: "入金复核", block: readBlock, run: () => setReview({ cid: String(item.row.cid) }) };
    const source = claimSource(item);
    if (source) return { label: "认领或退款", block: claimBlock(source), run: () => setClaim(source) };
    return null;
  };
  const pools = FUNDS_NETWORKS.map(network => ({ network, pool: data ? poolOf(data, network) : undefined }));
  const connected = data?.mode === "PROVIDER" || data?.mode === "provider";
  const statusSummary = !data ? (loading ? "正在读取" : "读取失败") : !connected ? "未接入"
    : [MODE_TEXT[data.mode] ?? "接入模式未知", ...pools.map(({ network, pool }) => pool?.available ? `${network} 可分配 ${pool.unassigned}` : pool || !data.addressPools ? `${network} 不可用` : `${network} 未配置`)].join(" · ");
  const reconLatest = (network: FundsNetwork) => data?.reconcileRuns?.find((row) => row.status === "COMPLETE" && rowNetwork(row) === network)?.completedAt;
  const openCases = reviewCases.filter(row => row.status === "MAKER_DONE" || row.status == null);
  const switchCases = data?.switchCases?.filter((row) => row.status === "MAKER_DONE") ?? [];
  const exceptionsCountText = countText(count);
  const zone = zoneLabel();

  return <>
    <PendingNotices items={pendingItems} disabled={busy} />
    {error && <Notice tone="danger" title="USDT 收款状态读取失败" action={<Button size="sm" loading={loading} onClick={() => void refresh()}>重试</Button>}>{error}读不到时，依赖收款状态的操作都先禁用。</Notice>}
    {/* 告警只在页头结论和下面的「未解除告警」一格说，不再另起一条提示（DT-12、DP-61）。 */}
    {/* 根因只写这一处；下面的汇总带、折叠摘要和键值用同一个词（DT-12、DT-14）。 */}
    {data && (!data.depositEnabled || !data.depositCreditEnabled || !gate?.assignEnabled) && <Notice tone="warn">{connected
      ? "USDT 充值还没开放，用户现在不能用 USDT 充值；请勿向测试地址转账。"
      : "USDT 收款还没接入，用户现在不能用 USDT 充值；请勿向测试地址转账。"}</Notice>}
    {data && data.depositEnabled && data.depositCreditEnabled && gate?.assignEnabled && !gate.creditEnabled && <Notice tone="warn">仅开放试点收款地址，到账后进入人工复核，暂不自动入账；请仅按测试安排转账。</Notice>}
    {data?.addressPool?.lastError && <Notice tone="warn">{data.addressPool.lastError === "CREGIS_ADDRESS_QUOTA_EXCEEDED"
      ? "收款服务的地址额度不足，请扩容后恢复补充。" : data.addressPool.lastError === "CREGIS_ADDRESS_RATE_LIMITED"
        ? "收款服务限制了请求频率，稍后会自动继续补充。" : "收款服务暂时不接受创建地址，请检查地址额度和服务状态后再恢复。"}</Notice>}

    <StatBand label="USDT 收款">
      <Stat tone={Number(data?.unresolvedExposureUsdt ?? 0) > 0 ? "warn" : undefined} icon={Wallet} label="待处理资金"
        value={data && data.unresolvedExposureUsdt != null ? usdt(data.unresolvedExposureUsdt) : "—"} unit={data && data.unresolvedExposureUsdt != null ? "USDT" : undefined}
        sub={data ? `待处理回调 ${data.pendingAcceptedDeliveries ?? "—"} 笔` : undefined}
        explain="链上已到账、还没入账或还没处理完的 USDT 合计，各网络加在一起。" />
      <Stat tone={alertCount > 0 ? "danger" : undefined} icon={BellRing} label="未解除告警" value={data?.openRiskAlertCount != null ? String(data.openRiskAlertCount) : "—"} unit={data?.openRiskAlertCount != null ? "条" : undefined}
        explain="紧急和严重两级、还没解除的告警。告警不算进页头要处理的数，它可能和异常是同一件事。"
        onOpen={data ? () => setAlertsOpen(true) : undefined} openLabel={alertCount > 0 ? "查看告警" : "查看最近对账与告警"} />
      <Stat tone={data && connected ? switchState(gate?.assignEnabled) : undefined} icon={MapPin} label="地址分配" value={!data ? "—" : !connected ? "未开放" : gate?.assignEnabled ? "已开启" : "已关闭"}
        sub={data && connected ? cregisStateText(gate?.state) : undefined} explain="给用户分配 USDT 收款地址。关掉后用户拿不到收款地址。" />
      <Stat tone={data && connected ? switchState(gate?.creditEnabled) : undefined} icon={ToggleRight} label="自动入账" value={!data ? "—" : !connected ? "未开放" : gate?.creditEnabled ? "已开启" : "已关闭"}
        explain="到账后自动进用户钱包。关掉后到账的进人工复核，App 写「该方式暂不自动入账。转账前请先联系客服。」" />
    </StatBand>

    {(data || loading) && <Fold title="收款状态" icon={ShieldCheck} tone="role-2" summary={statusSummary}>
      {!data ? <BlockState state="loading" title="正在读取收款状态…" />
        : <div className="rd-stack">
          <ConfigList label="收款状态">
            <ConfigRow name="接入模式" value={MODE_TEXT[data.mode] ?? "未知"} />
            <ConfigRow name="App 收款入口" value={<SwitchTag on={data.depositEnabled}>{data.depositEnabled ? "已启用" : "已关闭"}</SwitchTag>} />
            <ConfigRow name="自动入账能力" value={!connected ? "未接入" : data.depositCreditEnabled ? "已配置" : "未配置"} />
            <ConfigRow name="链上出款总闸" value={payoutCapabilityState(data).value} note={payoutCapabilityState(data).note} />
            {FUNDS_NETWORKS.map(network => {
              const capability = data.networkCapabilities?.find(item => item.network === network);
              const state = !capability ? ["待核实", "尚未配置，出款能力待核实"] : capability.enabled ? ["已启用", "是否放行仍看「USDT 提现参数」里的网络开关"] : !capability.configured ? ["未就绪", "出款接入尚未就绪"]
                : ["SWITCH_OFF", "NETWORK_SWITCH_OFF"].includes(capability.disabledReason ?? "") ? ["已关闭", "出款开关已关闭"]
                  : capability.disabledReason === "CHAIN_PROOF_UNAVAILABLE" ? ["暂停", "TRON 节点读不到，链上确认核不了"] : ["暂停", "出款暂停，须核对配置与风险状态"];
              return <ConfigRow key={network} name={`${network} 出款`} value={state[0]} note={state[1]} />;
            })}
          </ConfigList>
          <Table label="专属收款地址池">
            <thead><tr><Th>网络</Th><Th align="right">可分配</Th><Th align="right">已分配</Th><Th align="right">核对中</Th><Th>最近完整对账（{zone}）</Th>{canManage && <Th sticky="end" align="right">操作</Th>}</tr></thead>
            <tbody>{pools.map(({ network, pool }) => <tr key={network}>
              <Td><Cell main={network} sub={!pool ? undefined : pool.automatic ? `自动补充至 ${pool.reserveTarget ?? 5} 个` : "不自动补充"} /></Td>
              {pool?.available ? <>
                <Td align="right"><Cell num main={pool.unassigned} sub={`待创建 ${pool.queued ?? 0}`} /></Td>
                <Td align="right"><Cell num main={pool.assigned} sub={`总计 ${pool.total}${pool.limit > 0 ? ` / ${pool.limit}` : " · 无上限"}`} /></Td>
                <Td align="right"><Cell num main={pool.verifying} sub={`待核查 ${pool.unknown}`} /></Td>
              </> : <Td colSpan={3}><Cell main={pool || !data.addressPools ? "暂不可用，请刷新核对" : "尚未配置，请核对部署后刷新"} /></Td>}
              <Td><Cell num main={reconLatest(network) ? time(reconLatest(network)) : "尚无"} /></Td>
              {canManage && <Td sticky="end" align="right"><span className="rd-row-actions">
                <Button size="sm" disabledReason={provisionBlock(data, network) ?? readBlock ?? d1PendingObjectReason(`/cregis/addresses/provision?network=${network}`)} onClick={() => confirmCommand({ kind: "record",
                  action: `补充一个 ${network} 专属收款地址`, title: `补充 ${network} 收款地址`, confirmLabel: "确认补充", effect: now,
                  facts: pool && <Facts><Fact k="网络">{network}</Fact><Fact k="可分配">{pool.unassigned} 个</Fact><Fact k="总计">{pool.total}{pool.limit > 0 ? ` / 上限 ${pool.limit}` : "，无上限"}</Fact></Facts>,
                  detail: "向收款服务创建一个候选地址；系统核对归属、余额和链上历史后才可分配给用户。创建结果不明时请先核查，勿连续重试。",
                  completion: "提交后立即执行。地址核对通过后才会分配给用户。", path: `/cregis/addresses/provision?network=${network}` })}>补充收款地址</Button>
                <MoreMenu label={`${network} 更多操作`} items={[{ key: "recon", label: "立即完整对账", disabledReason: readBlock ?? (networkConfigured(data, network) ? undefined : "这个网络尚未配置") ?? d1PendingObjectReason(`/cregis/reconciliation/run?network=${network}`), onSelect: () => confirmCommand({ kind: "record",
                  action: `立即运行 ${network} 完整对账`, title: `立即完整对账`, confirmLabel: "确认对账", effect: now,
                  facts: <Facts><Fact k="网络">{network}</Fact><Fact k="最近完整对账">{reconLatest(network) ? `${time(reconLatest(network))}（${zone}）` : "尚无"}</Fact></Facts>,
                  detail: `核对收款服务和 ${network} 链上记录。`, completion: "发现异常会生成告警，不改余额，也不改开关。",
                  path: `/cregis/reconciliation/run?network=${network}` }) }]} />
              </span></Td>}
            </tr>)}</tbody>
          </Table>
          <div className="rd-links"><Button size="sm" variant="ghost" icon={<FileSearch size={14} aria-hidden />} onClick={() => setAlertsOpen(true)}>查看最近对账与告警</Button></div>
        </div>}
    </Fold>}

    <PageTabs ids={subIds} level={2} label="USDT 操作分区" value={sub} onChange={setSub} items={[
      { value: "records", label: "收款记录" },
      { value: "exceptions", label: "异常处理", count: exceptionsCountText },
      { value: "settings", label: "充值与地址设置" },
      { value: "funds", label: "归集与转入" },
    ]} />
    <div {...subIds.panel("records")} hidden={sub !== "records"} className="rd-tab-pane"><CregisDepositHistory reloadKey={childKey} /></div>

    <div {...subIds.panel("exceptions")} hidden={sub !== "exceptions"} className="rd-tab-pane">
      <Panel flush icon={AlertTriangle} tone="warn" title="异常" sub={data ? `共 ${entries.length} 条，其中 ${entries.length - counted} 条系统处理中` : undefined}
        explain="六类异常合在一张表。待处理的回调和创建中、核对中的新地址由系统继续处理，标「系统处理中」，不算进要处理的数。每类最多读 50 条。"
        actions={<Button size="sm" variant="ghost" icon={<RefreshCw size={14} aria-hidden />} loading={loading} onClick={() => { void refresh(); setChildKey(value => value + 1); }}>刷新</Button>}>
        <Table label="USDT 异常" aria-busy={loading}>
          <thead><tr><Th sticky="start">类型 · 时间（{zone}）</Th><Th>对象</Th><Th align="right" icon={Coins} tone="money">金额（USDT）</Th><Th>状态</Th><Th sticky="end" align="right">操作</Th></tr></thead>
          <tbody>
            {loading && !data ? <TableLoading columns={5} rows={3} />
              : !data ? <TableMessage columns={5} role="alert">异常读取失败。{error} <Button size="sm" onClick={() => void refresh()}>重试</Button></TableMessage>
                : entries.length === 0 ? <TableMessage columns={5} role="status">暂无异常。</TableMessage>
                  : entries.map(item => {
                    const object = entryObject(item);
                    const action = entryAction(item);
                    return <Tr key={item.key} selected={item.key === entryKey} onOpen={() => setEntryKey(item.key)}>
                      <Td sticky="start"><Cell main={item.label} sub={`${rowNetwork(item.row) ?? "网络待核实"} · ${time(item.row.createdAt ?? item.row.checkedAt)}`} /></Td>
                      <Td><Cell mono main={object.main} sub={object.sub} title={object.full} /></Td>
                      <Td align="right"><Cell num main={entryAmount(item.row) == null ? "—" : usdt(String(entryAmount(item.row)))} /></Td>
                      <Td><Cell main={entryTag(item, entryState(item))}
                        sub={item.counted ? undefined : `${entryState(item)}${item.row.ageSeconds != null ? ` · 等待 ${text(item.row.ageSeconds)} 秒` : ""}`} title={entryState(item)} /></Td>
                      <Td sticky="end" align="right">{action
                        ? <Button size="sm" disabledReason={action.block} onClick={action.run}>{action.label}</Button>
                        : <Button size="sm" variant="ghost" onClick={() => setEntryKey(item.key)}>查看详情</Button>}</Td>
                    </Tr>;
                  })}
          </tbody>
        </Table>
      </Panel>
      {data && <Fold title="入金复核工单" icon={ShieldCheck} tone="role-2" summary={`待复核 ${openCases.length}${data.openReviewCaseCount != null && data.openReviewCaseCount > openCases.length ? ` / 共 ${data.openReviewCaseCount}` : ""}`}
        alert={openCases.some(row => !isMaker(row, session?.adminId))} defaultOpen={openCases.some(row => !isMaker(row, session?.adminId))}
        explain="大额入金先冻结，一位管理员核验证据后发起复核，另一位管理员复核后入账。找不到对应订单的资金或链上交易重组时，须保持冻结并核查。">
        <div className="rd-stack">
          {canManage && <div className="rd-toolbar">
            <FilterField label="按 CID 发起"><Input data-search aria-label="待审核 CID" placeholder="CID" inputMode="numeric" value={manualCid} onChange={(event) => setManualCid(event.target.value.trim())} /></FilterField>
            <Button size="sm" disabledReason={readBlock ?? (/^[1-9]\d{0,18}$/.test(manualCid) ? undefined : "先填 CID，只能是数字")} onClick={() => setReview({ cid: manualCid })}>实时核验证据</Button>
          </div>}
          {openCases.length === 0 ? <p className="rd-note">现在没有待复核的入金工单。</p> : <Table label="入金复核工单">
            <thead><tr><Th>工单 · CID</Th><Th>用户</Th><Th align="right">净入账（USDT）</Th><Th>发起人</Th><Th sticky="end" align="right">操作</Th></tr></thead>
            <tbody>{openCases.map(row => <Tr key={String(row.id)} onOpen={() => setReview({ cid: String(row.cid), caseRow: row })}>
              <Td><Cell mono main={`#${text(row.id)}`} sub={`CID ${text(row.cid)}`} /></Td>
              <Td><Cell main={text(row.userId)} /></Td>
              <Td align="right"><Cell num main={usdt(text(row.proposedNetAmount))} sub={`毛额 ${usdt(text(row.grossAmount))}`} /></Td>
              <Td><Cell main={text(row.makerId)} sub={isMaker(row, session?.adminId) ? "你发起的" : undefined} /></Td>
              <Td sticky="end" align="right"><Button size="sm" variant="ghost" onClick={() => setReview({ cid: String(row.cid), caseRow: row })}>打开工单</Button></Td>
            </Tr>)}</tbody>
          </Table>}
          {reviewCases.length > 0 && reviewCases.length < (data.openReviewCaseCount ?? 0) && <div><Button size="sm" disabled={busy} onClick={() => void loadMoreReviewCases(Number(reviewCases[reviewCases.length - 1].id))}>加载更早工单</Button></div>}
        </div>
      </Fold>}
      {data && <CregisExceptionOperations key={childKey} canManage={canManage} openActionConfirm={openActionConfirm}
        recoveredChallenge={recoveredChallenge}
        onPendingChanged={syncPending}
        sources={entries.map(claimSource).filter((source): source is ClaimSource => !!source)}
        claim={claim} onClaimClose={() => { setClaim(null); setRecoveredChallenge(null); }} onChanged={() => { syncPending(); void refresh(); }} />}
    </div>

    <div {...subIds.panel("settings")} hidden={sub !== "settings"} className="rd-tab-pane">
      <CregisDepositPolicy key={`policy-${childKey}`} canManage={canManage} openActionConfirm={openActionConfirm} onActivityChange={setProposalActivity} />
      <CregisPoolPolicy key={`pool-${childKey}`} canManage={canManage} openActionConfirm={openActionConfirm} onChanged={syncPending} />
      <Panel icon={Power} tone="role-4" title="收款与出款开关"
        explain={<><p>BEP20、ERC20、TRC20 各有一个充值开关，选目标状态后提交审批，另一位管理员复核后生效。关闭一条网络会停止这条网的地址分配、链上直付新下单和自动入账，原交易继续核验，其他网络不受影响。</p><p>全局链上出款总闸是三条网共用的出款上限。BEP20 / ERC20 / TRC20 分别是否允许提现，在「USDT 提现参数」设置。</p></>}
        actions={reach("/finance/params", "finance_d5_read") ? <Link className="rd-link" href="/finance/params">前往 USDT 提现参数</Link> : undefined}>
        {!data ? <BlockState state={loading ? "loading" : "error"} compact title={loading ? "正在读取开关…" : "开关读取失败"} onRetry={loading ? undefined : () => void refresh()} />
          : <div className="rd-stack">
            {!data.networkSwitches ? <Notice tone="warn">读不到分网络充值开关，当前不能修改。请刷新后再试。</Notice>
              : <Table label="分网络充值开关">
                <thead><tr><Th>网络</Th><Th>充值开关</Th><Th>实际开放情况</Th>{canManage && <Th sticky="end" align="right">操作</Th>}</tr></thead>
                <tbody>{FUNDS_NETWORKS.map(network => {
                  const row = data.networkSwitches!.find(item => item.network === network);
                  if (!row) return <tr key={network}>
                    <Td><Cell main={network} sub={networkName[network]} /></Td>
                    <Td><Cell main="尚未配置" sub="待后端配置" /></Td>
                    <Td><Cell main={<StatusTag tone="warn">待核实</StatusTag>} sub="请核对部署后刷新" /></Td>
                    {canManage && <Td sticky="end" align="right"><Button size="sm" variant="secondary" disabledReason="这个网络尚未配置">调整</Button></Td>}
                  </tr>;
                  const waiting = switchCases.some(item => item.network === row.network);
                  const block = waiting ? "待另一位管理员复核" : proposalBlock;
                  const proposal = (target: boolean, restoring: boolean) => confirmCommand({ kind: "config",
                    action: `提交 ${row.network} 充值${restoring ? "恢复" : "开关"}审批`, title: restoring ? `恢复 ${row.network} 充值` : `调整 ${row.network} 充值开关`, confirmLabel: "提交审批", effect: approval,
                    facts: <Facts><Fact k="网络">{row.network}</Fact>{restoring && <Fact k="充值开关"><Change from={row.depositEnabled ? "开" : "关"} to="开（申请恢复）" /></Fact>}<Fact k="实际开放情况">{row.depositAvailable ? "已开放" : availabilityText(row.depositDisabledReason)}</Fact></Facts>,
                    detail: `${restoring ? "当前全局暂停，本次只申请恢复所选网络充值；其他网络充值继续保持暂停，不会恢复出款总闸。" : ""}关闭将停止该网地址分配、链上直付新下单与自动入账，原交易继续核验。`,
                    completion: `另一位管理员复核后生效。${restoring ? "只恢复这条网络的充值，其他网络和出款总闸保持现状。" : "关闭一条网络，不改变其他网络的充值开关。"}`,
                    path: "/cregis/switch-cases", body: { network: row.network, expectedVersion: gate?.version, expectedNetworkVersion: row.version, ...(restoring ? { depositEnabled: target } : {}) },
                    edit: restoring ? undefined : { kind: "select", label: `${row.network} 充值`, current: String(row.depositEnabled), options: ["true", "false"], optionLabels: { true: "开", false: "关" },
                      disallowCurrent: true, amplifiesWhen: { from: "false", to: "true" }, submitEditValue: true },
                    toBody: restoring ? undefined : (_form, value) => ({ depositEnabled: value === "true" }) });
                  return <tr key={row.network}>
                    <Td><Cell main={row.network} sub={networkName[row.network]} /></Td>
                    <Td><Cell main={<SwitchTag on={row.depositEnabled}>{row.depositEnabled ? "开启" : "关闭"}</SwitchTag>} sub={waiting ? "有提案待复核" : undefined} /></Td>
                    <Td><Cell main={row.depositAvailable ? (row.addressAvailable ? "已开放" : "已开放 · 地址准备中") : <StatusTag tone="warn">{availabilityText(row.depositDisabledReason)}</StatusTag>} /></Td>
                    {canManage && <Td sticky="end" align="right"><span className="rd-row-actions">
                      {globalPaused && <Button size="sm" disabledReason={block} onClick={() => proposal(true, true)}>申请恢复</Button>}
                      <Button size="sm" variant={globalPaused ? "ghost" : "secondary"} disabledReason={block} onClick={() => proposal(row.depositEnabled, false)}>调整</Button>
                    </span></Td>}
                  </tr>;
                })}</tbody>
              </Table>}
            <ConfigList label="全局链上出款总闸">
              <ConfigRow name="全局链上出款总闸" what="三条网共用的链上出款上限" when="另一位管理员复核后生效" effect="不会直接放行任何提现；开启后仍须满足收款服务、对账、风险和单笔审核条件。不恢复充值，也不修改分网络提现许可"
                note={payoutCapabilityText(data).replace(/。$/, "")}
                value={<SwitchTag on={Boolean(gate?.payoutEnabled)} stopped={gate?.state === "BLOCKED"}>{onOff(gate?.payoutEnabled, "未知")}</SwitchTag>}
                action={canManage ? <Button size="sm" disabledReason={proposalBlock} onClick={() => confirmCommand({ kind: "config",
                  action: "提交全局链上出款审批", title: "调整全局链上出款总闸", confirmLabel: "提交审批", effect: approval,
                  detail: "BEP20 / ERC20 / TRC20 三网共用这个总闸。不恢复充值，也不修改 D5 的分网络提现许可；开启后仍须满足收款服务、对账、风险和单笔审核条件。",
                  completion: "另一位管理员复核后生效。复核时条件不满足会被拒绝。不会直接放行任何提现。",
                  path: "/cregis/switch-cases", body: { expectedVersion: gate?.version },
                  edit: { kind: "select", label: "全局链上出款", current: String(Boolean(gate?.payoutEnabled)), options: ["true", "false"], optionLabels: { true: "开", false: "关" },
                    disallowCurrent: !globalPaused, amplifiesWhen: { from: "false", to: "true" }, hint: payoutCapabilityText(data), submitEditValue: true },
                  toBody: (_form, value) => ({ payoutEnabled: value === "true" }) })}>调整</Button> : undefined} />
            </ConfigList>
            {switchCases.length > 0 && <Fold inset title="待复核申请" summary={`${switchCases.length} 个提案待复核`} alert defaultOpen>
              <Table label="待复核申请">
              <thead><tr><Th>提案</Th><Th>改成</Th><Th>发起理由</Th>{canManage && <Th sticky="end" align="right">操作</Th>}</tr></thead>
              <tbody>{switchCases.map(row => {
                const own = isMaker(row, session?.adminId);
                const network = row.network ? String(row.network) : "全局出款";
                const target = row.network ? `${network} 充值 ${row.beforeDepositEnabled == null ? "原值" : row.beforeDepositEnabled ? "开" : "关"} → ${row.creditEnabled ? "开" : "关"}` : `全局链上出款 → ${onOff(row.payoutEnabled)}`;
                const stale = row.expectedVersion !== gate?.version || (!!row.network && data.networkSwitches?.find(item => item.network === row.network)?.version !== row.expectedNetworkVersion);
                const decisionBusy = switchPending.some(record => record.path === `/cregis/switch-cases/${text(row.id)}/decision`) ? "上次复核结果未确认，先在上方核对" : readBlock;
                const currentSwitch = row.network ? data.networkSwitches?.find(item => item.network === row.network)?.depositEnabled : gate?.payoutEnabled;
                const facts = <Facts><Fact k="提案">#{text(row.id)}</Fact>
                  <Fact k={row.network ? `${network} 充值` : "全局链上出款"}><Change from={currentSwitch == null ? "现在读不到" : `现在${currentSwitch ? "开" : "关"}`} to={row.network ? (row.creditEnabled ? "开" : "关") : onOff(row.payoutEnabled)} /></Fact>
                  <Fact k="发起人">{text(row.makerId)}</Fact><Fact k="发起理由">{text(row.reason)}</Fact></Facts>;
                return <tr key={String(row.id)}>
                  <Td><Cell mono main={`#${text(row.id)}`} sub={`发起人 ${text(row.makerId)}${own ? "（你）" : ""}`} /></Td>
                  <Td><Cell main={target} sub={stale ? "配置版本已变，请拒绝后重新申请" : undefined} /></Td>
                  <Td><Cell main={text(row.reason)} title={text(row.reason)} /></Td>
                  {canManage && <Td sticky="end" align="right"><span className="rd-row-actions">
                    <Button size="sm" disabledReason={own ? "这是你发起的，需要另一位管理员处理" : stale ? "配置版本已变，请拒绝后重新申请" : decisionBusy} onClick={() => confirmCommand({ kind: "config", action: `复核 ${network} 提案 #${text(row.id)}`, title: "复核通过开关提案", confirmLabel: "确认通过", effect: now, facts,
                      detail: `${target}；发起人 ${text(row.makerId)}；理由 ${text(row.reason)}。按当前条件核验后生效。`, completion: "复核通过后立即按提案生效。复核时条件不满足会被拒绝。",
                      path: `/cregis/switch-cases/${text(row.id)}/decision`, body: { decision: "APPROVE" } })}>复核通过</Button>
                    <MoreMenu label="更多操作" items={[{ key: "reject", label: "拒绝", danger: true, disabledReason: own ? "这是你发起的，需要另一位管理员处理" : decisionBusy, onSelect: () => confirmCommand({ kind: "record", action: `拒绝 ${network} 提案 #${text(row.id)}`, title: "拒绝开关提案", confirmLabel: "确认拒绝", effect: now, facts,
                      detail: `${target}；发起理由 ${text(row.reason)}`, completion: "拒绝后提案结束，开关保持现状。",
                      path: `/cregis/switch-cases/${text(row.id)}/decision`, body: { decision: "REJECT" } }) }]} />
                  </span></Td>}
                </tr>;
              })}</tbody>
              </Table>
            </Fold>}
          </div>}
      </Panel>
      <Panel icon={ShieldAlert} tone="danger" title="全局紧急停用" explain="立即停止 BEP20 / ERC20 / TRC20 三网的地址分配、自动入账和新出款，继续接收回调并查询原单。旧提案失效，恢复须重新核对条件并提交审批。"
        actions={canManage ? <Button variant="danger-outline" disabledReason={emergencyBlock ?? (switchPending.some(record => record.path === "/cregis/switches/emergency-off") ? "上次紧急停用结果未确认，先在上方核对" : undefined)} onClick={() => confirmCommand({ kind: "emergency", optionalPolicy: true,
          action: "紧急停用 BEP20、ERC20 与 TRC20", title: "紧急停用三网", confirmLabel: "确认紧急停用", danger: true, effect: now,
          facts: <Facts>
            {(data?.networkSwitches ?? []).map(row => <Fact key={row.network} k={`${row.network} 充值`}>{row.depositEnabled ? <Change from="开" to="关" /> : "关（不变）"}</Fact>)}
            <Fact k="全局链上出款">{gate?.payoutEnabled ? <Change from="开" to="关" /> : "关（不变）"}</Fact>
          </Facts>,
          detail: "立即停止三网地址分配、自动入账和新出款；原交易继续核验和查询。", completion: "确认后立即停止三网的地址分配、自动入账和新出款，继续接收回调并查询原单。旧提案失效，恢复要重新提交审批。",
          path: "/cregis/switches/emergency-off", body: { expectedVersion: gate?.version } })}>紧急停用三网</Button> : undefined}>
        <p className="rd-note">{!data ? "开关状态读不到。" : `现在：${(data.networkSwitches ?? []).map(row => `${row.network} 充值${row.depositEnabled ? "开" : "关"}`).join("，") || `地址分配${onOff(gate?.assignEnabled, "未知")}，自动入账${onOff(gate?.creditEnabled, "未知")}`}，链上出款${onOff(gate?.payoutEnabled, "未知")}。`}{emergencyBlock && canManage ? `不能停用：${emergencyBlock}` : ""}</p>
      </Panel>
    </div>
    <div {...subIds.panel("funds")} hidden={sub !== "funds"} className="rd-tab-pane">
      {data ? <>
        <CregisAutoForward key={`auto-${childKey}`} canManage={canManage} openActionConfirm={openActionConfirm} onChanged={syncPending} />
        <CregisFundsPreparation key={`prep-${childKey}`} canManage={canManage} openActionConfirm={openActionConfirm} onChanged={syncPending} />
      </> : <BlockState state={loading ? "loading" : "error"} title={loading ? "正在读取…" : "收款状态读取失败，自动流程与人工准备先不显示"} onRetry={loading ? undefined : () => void refresh()} />}
    </div>

    <Drawer open={alertsOpen} onClose={() => setAlertsOpen(false)} title="最近对账与告警" icon={BellRing} tone={alertCount > 0 ? "danger" : "role-other"}>
      {!data ? <BlockState state="error" title="收款状态读取失败" detail={error} onRetry={() => void refresh()} /> : <>
        <JudgmentPoints rows={[
          { label: "未解除告警", state: alertCount > 0 ? "danger" : undefined, value: `${alertCount} 条`, reason: alerts.length < alertCount ? `显示前 ${alerts.length} 条` : undefined },
          ...FUNDS_NETWORKS.map(network => ({ label: `${network} 完整对账`, value: reconLatest(network) ? `${time(reconLatest(network))}（${zone}）` : "尚无" })),
        ]} />
        <Fold inset title="最近对账" summary={`${data.reconcileRuns?.length ?? 0} 次`} defaultOpen>
          {(data.reconcileRuns ?? []).length === 0 ? <p className="rd-note">还没有对账记录。</p> : <Table label="最近对账">
            <thead><tr><Th>网络</Th><Th>结果</Th><Th>时间（{zone}）</Th></tr></thead>
            <tbody>{(data.reconcileRuns ?? []).slice(0, 6).map((row, index) => <tr key={index}>
              <Td><Cell main={rowNetwork(row) ?? "—"} /></Td>
              <Td><Cell main={<StatusTag tone={row.status === "COMPLETE" ? "ok" : row.status === "RUNNING" ? "progress" : "warn"}>{cregisStateText(row.status)}</StatusTag>} sub={row.failureCode ? <>{ADMIN_ERROR_MESSAGES[text(row.failureCode)] ?? "对账没完成，原因待核对"}<Explain label="失败码" content={`失败码 ${text(row.failureCode)}`} /></> : undefined} /></Td>
              <Td><Cell num main={time(row.completedAt ?? row.startedAt)} /></Td>
            </tr>)}</tbody>
          </Table>}
        </Fold>
        <Fold inset title="未解除告警" summary={alertCount ? `${alertCount} 条` : "没有"} defaultOpen={alertCount > 0}>
          {alerts.length === 0 ? <p className="rd-note">没有未解除的告警。</p> : <Table label="未解除告警">
            <thead><tr><Th>级别</Th><Th>类型</Th><Th>对象 · 时间（{zone}）</Th></tr></thead>
            <tbody>{alerts.map(row => {
              const [label, tone] = SEVERITY[String(row.severity)] ?? ["未知", "neutral" as StateTone];
              const object = text(row.txid ?? row.address ?? `#${text(row.id)}`);
              return <tr key={String(row.id)}>
                <Td><Cell main={<StatusTag tone={tone}>{label}</StatusTag>} /></Td>
                {/* 类型写中文；编号和原始证据收进提示，不在表里放 key=value（DP-30、DT-17）。 */}
                <Td><Cell main={<>{ALERT_KIND[text(row.kind)] ?? "其他告警"}<Explain label="告警证据" content={<><p>类型编号 {text(row.kind)}</p><p>{text(row.evidence)}</p></>} /></>} /></Td>
                {/* 时间并进对象一格：抽屉里三列放得下，不横滚（DT-17）。 */}
                <Td><Cell mono main={object.length > 22 ? `${object.slice(0, 10)}…${object.slice(-8)}` : object} sub={[rowNetwork(row), time(row.createdAt)].filter(Boolean).join(" · ")} title={object} /></Td>
              </tr>;
            })}</tbody>
          </Table>}
          {alerts.length > 0 && alerts.length < alertCount && <Button size="sm" disabled={busy} onClick={() => void loadMoreAlerts(Number(alerts[alerts.length - 1].id))}>加载更早告警</Button>}
        </Fold>
      </>}
    </Drawer>

    <Drawer open={!!entry} onClose={() => setEntryKey(null)} title="异常详情" sub={entry ? entry.label : undefined} icon={AlertTriangle} tone="warn"
      nav={{ hasPrev: entryIndex > 0, hasNext: entryIndex >= 0 && entryIndex < entries.length - 1, onPrev: () => setEntryKey(entries[entryIndex - 1]?.key ?? entryKey), onNext: () => setEntryKey(entries[entryIndex + 1]?.key ?? entryKey) }}
      footer={entry && (() => { const action = entryAction(entry); const source = claimSource(entry); return <Decision
        note={action ? action.block : entryGuide(entry) || undefined}
        explain={source?.network === "ERC20" ? "ERC20 异常入金先由财务人工处理，处理负责人待指定。这里不能认领或退款。" : undefined}
        primary={action ? <Button variant="primary" disabledReason={action.block} onClick={action.run}>{action.label}</Button> : undefined} />; })()}>
      {entry && <>
        <JudgmentPoints rows={[
          { label: "类型", value: entry.label, reason: entry.counted ? "要人处理" : "系统处理中，不用操作" },
          { label: "金额", icon: Coins, tone: "money", value: entryAmount(entry.row) == null ? "—" : `${usdt(String(entryAmount(entry.row)))} USDT` },
          { label: "状态", value: entryState(entry), state: entry.queue === "failedDeliveries" ? "danger" : String(entry.row.state ?? entry.row.status) === "UNKNOWN" ? "warn" : undefined, reason: entry.row.lastError ? "有错误记录，见下方" : undefined },
          { label: "网络", value: rowNetwork(entry.row) ?? "网络待核实", state: rowNetwork(entry.row) === "ERC20" && claimSource(entry) ? "warn" : undefined,
            reason: rowNetwork(entry.row) === "ERC20" && claimSource(entry) ? "ERC20 入金这里不能认领或退款，先由财务人工处理，负责人待指定" : undefined },
        ]} />
        <Fold inset title="记录" summary={entryObject(entry).main}>
          <KeyValues rows={[
            { key: "id", label: "编号", value: `#${text(entry.row.id)}` },
            ...(entry.row.cid != null ? [{ key: "cid", label: "CID", value: text(entry.row.cid), mono: true }] : []),
            ...(entry.row.userId != null ? [{ key: "user", label: "用户", value: text(entry.row.userId) }] : []),
            ...(entry.row.txid != null ? [{ key: "tx", label: "交易哈希", value: <LongValue value={text(entry.row.txid)} label="交易哈希" />, mono: true }] : []),
            ...(entry.row.logIndex != null ? [{ key: "log", label: "日志序号", value: text(entry.row.logIndex) }] : []),
            ...(entry.row.address != null ? [{ key: "addr", label: "地址", value: <LongValue value={text(entry.row.address)} label="地址" />, mono: true }] : []),
            ...(entry.row.ageSeconds != null ? [{ key: "age", label: "已等待", value: `${text(entry.row.ageSeconds)} 秒` }] : []),
            ...(entry.row.lastError != null || entry.row.last_error != null ? [{ key: "err", label: "错误记录", value: <>{ADMIN_ERROR_MESSAGES[text(entry.row.lastError ?? entry.row.last_error)] ?? "有错误记录，原因待核对"}<Explain label="错误码" content={`错误码 ${text(entry.row.lastError ?? entry.row.last_error)}`} /></> }] : []),
            { key: "time", label: `时间（${zone}）`, value: time(entry.row.createdAt ?? entry.row.checkedAt) },
          ]} />
        </Fold>
      </>}
    </Drawer>

    {review && <ReviewDrawer cid={review.cid} caseRow={review.caseRow} canManage={canManage} adminId={session?.adminId} busy={busy} readBlock={readBlock}
      onClose={() => setReview(null)} confirm={confirmCommand} approval={approval} />}
  </>;
}

/** 写请求的名字，按路径认，不露路径（D1-A09）。 */
function cregisCommandLabel(path: string) {
  if (path.startsWith("/cregis/addresses/provision")) return "补充收款地址";
  if (path.startsWith("/cregis/reconciliation/run")) return "立即完整对账";
  if (path === "/cregis/review-cases") return "提交入金复核";
  if (path.startsWith("/cregis/review-cases/")) return "复核入金";
  if (path === "/cregis/switch-cases") return "提交开关修改";
  if (path.startsWith("/cregis/switch-cases/")) return "复核开关提案";
  if (path.startsWith("/cregis/switches/emergency-off")) return "紧急关闭三项开关";
  if (path.startsWith("/cregis/addresses/policy")) return "保存地址池配置";
  if (path.startsWith("/cregis/refunds/fee-policy")) return "退款手续费";
  if (path.startsWith("/cregis/refunds")) return "原路退款";
  if (path.startsWith("/cregis/exception-claims")) return "认领入账";
  if (path.startsWith("/cregis/exception-ownership")) return "生成钱包签名原文";
  if (path.startsWith("/cregis/reorg")) return "重组处置";
  if (path.startsWith("/cregis/auto-forward")) return `${new URLSearchParams(path.split("?")[1]).get("network") ?? "BEP20"} 自动资金流程`;
  if (path.startsWith("/cregis/funds-preparation")) return "资金准备单";
  return "USDT 收款操作";
}

type ConfirmFn = (spec: { kind: OperatorBriefKind; action: string; title: string; detail: string; path: string; body?: Record<string, unknown>; confirmLabel: string; danger?: boolean; effect: ReactNode; facts?: ReactNode; completion: string }) => void;

/** 入金复核：按 CID 核验证据，发起复核；工单由另一位管理员复核入账或拒绝（D1-A30～A32）。 */
function ReviewDrawer({ cid, caseRow, canManage, adminId, busy, readBlock, onClose, confirm, approval }: {
  cid: string; caseRow?: ExceptionRow; canManage: boolean; adminId?: number; busy: boolean; readBlock?: string;
  onClose: () => void; confirm: ConfirmFn; approval: ReactNode;
}) {
  const [evidence, setEvidence] = useState<ExceptionRow | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true); setError(""); setEvidence(null);
    try {
      const next = await financeAdminRequest<ExceptionRow>(`/cregis/review-evidence/${cid}`);
      if (current === sequence.current) setEvidence(next);
    } catch (failure) {
      if (current === sequence.current) setError(displayAdminReadError(failure));
    } finally { if (current === sequence.current) setLoading(false); }
  }, [cid]);
  // 发起时直接核验；打开已有工单时等人点「刷新证据」，复核前必须读最新的（D1-A32）。
  useEffect(() => { if (!caseRow) void load(); return () => { sequence.current++; }; }, [load, caseRow]);
  const matches = !!evidence && String(evidence.cid) === cid;
  const own = caseRow ? String(caseRow.makerId) === String(adminId) : false;
  const sameEvidence = matches && !!caseRow && String(evidence?.evidenceHash) === String(caseRow.evidenceHash);
  const proposeBlock = readBlock ?? d1PendingObjectReason("/cregis/review-cases", { cid: Number(cid) }) ?? (loading ? "正在核验证据" : !matches ? "证据没读到，先点「刷新证据」" : undefined);
  const decideBlock = own ? "发起人不能复核自己的工单" : readBlock ?? (caseRow ? d1PendingObjectReason(`/cregis/review-cases/${text(caseRow.id)}/decision`) : undefined) ?? (loading ? "正在核验证据" : !evidence ? "先点「刷新证据」" : !sameEvidence ? "证据和发起时不一致，不能复核" : undefined);
  const net = caseRow?.proposedNetAmount ?? evidence?.proposedNetAmount;
  const caseFacts = caseRow && <Facts>
    <Fact k="净入账" lead tone="role-1" unit="USDT">{usdt(text(caseRow.proposedNetAmount))}</Fact>
    <Fact k="毛额">{usdt(text(caseRow.grossAmount))} USDT</Fact>
    <Fact k="用户">{text(caseRow.userId)}</Fact>
    <Fact k="地址">{text(caseRow.address)}</Fact>
    <Fact k="交易">{text(caseRow.txid)}</Fact>
    <Fact k="发起理由">{text(caseRow.reason)}</Fact>
    <Fact k="证据摘要">{text(caseRow.evidenceHash)}</Fact>
  </Facts>;
  return <Drawer open onClose={onClose} title={caseRow ? "入金复核工单" : "入金复核"} sub={`CID ${cid}`} icon={ShieldCheck} tone="role-2" busy={busy}
    footer={canManage ? caseRow
      ? <Decision note={decideBlock}
        danger={<Button variant="danger-outline" disabledReason={own ? "发起人不能复核自己的工单" : readBlock} onClick={() => confirm({ kind: "record",
          action: `拒绝入金复核 #${text(caseRow.id)}`, title: "拒绝入金复核", confirmLabel: "确认拒绝", effect: <StatusTag tone="progress" filled>立即生效</StatusTag>, facts: caseFacts,
          detail: `CID ${cid} · 证据 ${text(caseRow.evidenceHash)}`, completion: "拒绝后这笔入金保持冻结，不入账。",
          path: `/cregis/review-cases/${text(caseRow.id)}/decision`, body: { expectedVersion: caseRow.version, decision: "REJECT" } })}>拒绝</Button>}
        others={<Button variant="ghost" loading={loading} onClick={() => void load()}>刷新证据</Button>}
        primary={<Button variant="primary" disabledReason={decideBlock} onClick={() => confirm({ kind: "funds",
          action: `复核入账 CID ${cid}`, title: "复核入账", confirmLabel: "确认复核", danger: true,
          effect: <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag /></>, facts: caseFacts,
          detail: `交易 ${text(caseRow.txid)}，毛额 ${text(caseRow.grossAmount)} USDT，净入账 ${text(caseRow.proposedNetAmount)} USDT 给用户 ${text(caseRow.userId)}。请独立核对地址、发起理由与证据。`,
          completion: "确认后立即把净额入账到用户钱包，不能撤销。",
          path: `/cregis/review-cases/${text(caseRow.id)}/decision`, body: { expectedVersion: caseRow.version, decision: "APPROVE" } })}>复核入账</Button>} />
      : <Decision note={proposeBlock}
        others={<Button variant="ghost" loading={loading} onClick={() => void load()}>刷新证据</Button>}
        primary={<Button variant="primary" disabledReason={proposeBlock} onClick={() => evidence && confirm({ kind: "funds",
          action: "提交入金复核", title: "提交入金复核", confirmLabel: "提交审批", effect: approval,
          facts: <Facts><Fact k="净入账" lead tone="role-1" unit="USDT">{usdt(text(evidence.proposedNetAmount))}</Fact><Fact k="CID">{cid}</Fact><Fact k="用户">{text(evidence.userId)}</Fact><Fact k="证据摘要">{text(evidence.evidenceHash)}</Fact></Facts>,
          detail: `CID ${cid} · 证据 ${text(evidence.evidenceHash)}。需另一位管理员复核。`, completion: "提交后需另一位管理员复核才生效。",
          path: "/cregis/review-cases", body: { cid: Number(cid), evidenceHash: evidence.evidenceHash } })}>提交入金复核</Button>} />
      : undefined}>
    {error && <BlockState state="error" title="证据核验失败" detail={error} onRetry={() => void load()} />}
    <JudgmentPoints loading={loading} rows={[
      { label: "净入账", icon: Coins, tone: "money", value: net == null ? "—" : `${usdt(text(net))} USDT`, reason: `毛额 ${usdt(text(caseRow?.grossAmount ?? evidence?.grossAmount))} · 手续费 ${evidence?.feeAmount != null ? usdt(text(evidence.feeAmount)) : caseRow?.feeAmount != null ? usdt(text(caseRow.feeAmount)) : "未提供"}` },
      { label: "用户", value: text(caseRow?.userId ?? evidence?.userId) },
      { label: "证据", state: !evidence ? "warn" : evidence.providerMatched && evidence.chainMatched ? undefined : "danger",
        value: !evidence ? (caseRow ? "还没刷新证据" : "正在核验") : `收款服务${evidence.providerMatched ? "匹配" : "未匹配"} · 链上${evidence.chainMatched ? "匹配" : "未匹配"}`,
        reason: evidence ? `核对时间 ${time(evidence.checkedAt)}` : undefined },
      ...(caseRow ? [{ label: "发起", value: `管理员 ${text(caseRow.makerId)}${own ? "（你）" : ""}`, reason: text(caseRow.reason), state: own ? "warn" as const : undefined }] : []),
    ]} />
    {(evidence || caseRow) && <Fold inset title="链上证据" summary={`确认数 ${text(evidence?.confirmations ?? caseRow?.confirmations)}`}>
      <KeyValues rows={[
        { key: "tx", label: "交易哈希", value: <LongValue value={text(evidence?.txid ?? caseRow?.txid)} label="交易哈希" />, mono: true },
        { key: "log", label: "日志序号", value: text(evidence?.logIndex ?? caseRow?.logIndex) },
        { key: "addr", label: "地址", value: <LongValue value={text(evidence?.address ?? caseRow?.address)} label="地址" />, mono: true },
        { key: "blockNumber", label: "区块号", value: text(evidence?.blockNumber ?? caseRow?.blockNumber) },
        { key: "blockHash", label: "区块哈希", value: evidence?.blockHash != null ? <LongValue value={text(evidence.blockHash)} label="区块哈希" /> : caseRow?.blockHash != null ? <LongValue value={text(caseRow.blockHash)} label="区块哈希" /> : "刷新证据后显示", mono: true },
        { key: "hash", label: "证据摘要", value: <LongValue value={text(evidence?.evidenceHash ?? caseRow?.evidenceHash)} label="证据摘要" />, mono: true },
      ]} />
    </Fold>}
  </Drawer>;
}
