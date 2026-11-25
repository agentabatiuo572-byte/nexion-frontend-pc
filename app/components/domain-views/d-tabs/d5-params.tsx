"use client";
import { APPROVAL_REPLAY_RELEASE, APPROVAL_REPLAY_RELEASE_NO_AUDIT, canReadOwnRecoveryProposal } from "@/lib/admin/abe-recovery-access";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { eCommandClosureOffer } from "@/lib/admin/e-command-investigation";

/**
 * USDT 提现参数（配置页，PG-46）。默认只显示名称、值和「调整」，点「调整」打开抽屉整组填写，抽屉提交后才开最终确认（闸门 2 第 37 条）。
 * 额度和时效共用一条命令；提现网络、网络确认费、UVT 抵扣率各一条命令。一条命令里有一项放宽，整条走审批。
 * 写权按字段判，没有就不显示「调整」（OP-124）；判断看权限码，不看角色名。
 * 结果未知常显在页面上方：收紧按原操作重试，放宽先查原审批单（OP-92～96）。放宽结果未知只锁放宽，收紧照常（闸门 2 第 04 条）。
 */
import { useReach } from "@/lib/nav/use-reach";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
import { explicitRejectionCode, isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { fmtConfigPct } from "@/lib/format";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarClock, CalendarRange, CircleDot, CircleMinus, Gauge, Lock, LockOpen, Network, RefreshCw, ShieldCheck, Zap, type LucideIcon } from "lucide-react";
import {
  BlockState,
  Button,
  Conclusion,
  ConfigList,
  ConfigRow,
  Decision,
  DiffList,
  Drawer,
  Change,
  Explain,
  Fact,
  Facts,
  Field,
  Fold,
  InlineRetry,
  KeepText,
  Modal,
  Notice,
  NumberInput,
  PageHeader,
  Panel,
  ReleaseModal,
  SectionNav,
  Segments,
  StatusTag,
  useSectionNav,
  type DiffRow,
  type SectionNavItem,
} from "@/app/components/rd";
import {
  d5WithdrawalLimitsValues,
  DRequestError,
  fetchD5WithdrawalParams,
  updateD5WithdrawalLimits,
  D5_NETWORK_CONFIRM_FEE_DEFAULT,
  type D5OwnedChanges,
  D5_MIN_USDT_MAX,
  D5_ADDRESS_EFFECTIVE_DELAY_HOURS_MAX,
  D5_ADDRESS_CHANGE_COOLDOWN_DAYS_MAX,
  isD5MinimumUsdt,
  type D5Params as D5ParamData,
} from "@/lib/admin/d-client";
import { isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { businessClock, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { D5_NETWORK_BLOCK_REASON, D5_NETWORK_BLOCK_UNKNOWN, D5_PARAM_HELP } from "@/lib/admin/config-help/d5-withdrawal";
import { d5Trc20ReplayBlock, TRC20_CHANGES_FEE, TRC20_CLOSED, TRC20_OPENS_WITHDRAWAL } from "@/lib/admin/trc20-closed";
import { fundInvestigationAccess, type FundCommandOrigin, type FundCommandRecord, type FundCommandEvidence, type FundInvestigationOutcome } from "@/lib/admin/fund-command-investigation";
import { dConfigCommandOrigin, isDConfigCommandOrigin, queryDConfigCommand } from "@/lib/admin/d-config-command-investigation";
import { FundCheckButtons, FundClosureModal, FundRecoveryPanel, fundReadBlock, fundRecoveryStatus, type FundRecoveryRow, type FundSettled } from "../fund-command-check";
import { CommandClosureModal } from "../e-tabs/e-command-check";
import { createPendingMutationStore, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import {
  configApprovalOriginalInput,
  checkWithdrawalApprovalCommand,
  withdrawalApprovalReplayQueryBlock,
  withdrawalApprovalLookupStatus,
  withdrawalDirectRecoveryStatus,
  lookupWithdrawalApproval,
  withdrawalReplayQueryBlock,
  pendingConfigApproval,
  useWithdrawalApprovals,
  releaseConfigApproval,
  releaseRejectedWithdrawalApproval,
  submitWithdrawalConfigApproval,
  withdrawalApprovalDisabledReason,
  rememberWithdrawalProcessing,
  WITHDRAWAL_COMMAND_PROCESSING,
  type WithdrawalReplayObservation,
  type WithdrawalProposalLookup,
  WITHDRAWAL_CONFIG_READ_FAILED,
  type WithdrawalApprovalReceipt,
} from "@/lib/admin/withdrawal-config-approval";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { DCtx } from "./types";

const OPERATOR = currentAdminOperator;

// 按后端原因码补充这项放宽未生效，不依赖可变的中文译文。
/** 两句中文接在一起：前一句没有句末标点就补「。」，中间不留空格。 */
const sentence = (text: string) => /[。！？.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}。`;

function errorText(err: unknown) {
  const code = err instanceof DRequestError ? err.reasonCode : rejectionCode(err);
  if (code === "COVERAGE_BELOW_REDLINE") return "兑付覆盖率低于红线，这项放宽调整未生效";
  return displayAdminError(err);
}

/** 后端拒绝码。D 域请求的 code 运行时是码字符串；审批接口的码在 backendMessage。 */
function rejectionCode(err: unknown) {
  if (err instanceof DRequestError) return String(err.code ?? "");
  if (err instanceof Error && "backendMessage" in err) return String((err as Error & { backendMessage?: unknown }).backendMessage ?? "");
  return "";
}

const NETWORKS = ["trc20", "bep20", "erc20"] as const;
type Net = (typeof NETWORKS)[number];
const NET_LABEL: Record<Net, string> = { trc20: "TRC20", bep20: "BEP20", erc20: "ERC20" };
/** TRC20 通道暂未开放（产品 2026-11-23）：这页不能改它，三网一起提交时带现在的值；算用户还能不能提现时不算它。 */
const CLOSED_NET: Net = "trc20";
const OPEN_NETS = NETWORKS.filter((net) => net !== CLOSED_NET);

/** 不舍入，只去掉浮点尾巴：0.57 写 57%，不写 56.99999999999999%。 */
const clean = (value: number) => Number(value.toPrecision(12));
const num = (value: number) => clean(value).toLocaleString("en-US", { maximumFractionDigits: 12 });
const usd = (value: number) => `${num(value)} USDT`;
const minimumUsd = (value: number) => value === 0 ? "不限制" : `${value.toLocaleString("en-US")} USDT`;
const pct = (value: number) => `${value.toFixed(1)}%`;

type Group = "limits" | "network" | "fee" | "nex";
const ADDRESS_PROTECTION_FIELDS = ["addressEffectiveDelayHours", "addressChangeCooldownDays"] as const;
type LimitsKey = "dailyLimitCount" | "maxBalanceRatio" | "minUsdt" | "smallAmountThresholdUsd"
  | "payoutSlaHours" | (typeof ADDRESS_PROTECTION_FIELDS)[number];
type NumKey = LimitsKey | "nexFeeOffsetRate" | `fee.${Net}`;

interface NumSpec {
  key: NumKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number | "any";
  /** 填错时写在字段下的话；范围写全，它会顶替怎么填。 */
  invalid: string;
  /** 空着时错误里写的范围。 */
  range: string;
  valid: (value: number) => boolean;
  /** 调高算放宽传 up，调低算放宽传 down。 */
  loosen: "up" | "down";
  /** 收紧的尽头。 */
  tightest: number;
  /** 页面单位的当前值：余额比例写成百分数。 */
  current: (p: D5ParamData) => number;
  show: (value: number) => string;
  how?: string;
  whatIf?: (value: number) => string;
  authority: string;
}

const DAILY_WRITE = "finance_d5_daily_limit_write";
const BALANCE_WRITE = "finance_d5_balance_max_write";
const FEE_WRITE = "finance_d5_fee_write";

const feeSpec = (net: Net): NumSpec => ({
  key: `fee.${net}`,
  label: NET_LABEL[net],
  unit: "USDT",
  min: 0,
  max: 25,
  step: 0.5,
  invalid: `${NET_LABEL[net]} 须在 0–25 之间，每档 0.5，例如 1 或 1.5`,
  range: "0–25 USDT，每档 0.5",
  valid: (value) => value >= 0 && value <= 25 && Number.isInteger(value * 2),
  loosen: "down",
  tightest: 25,
  current: (p) => p.networkConfirmFeeUsd[net],
  show: usd,
  how: `0–25 USDT，每档 0.5，默认 ${D5_NETWORK_CONFIRM_FEE_DEFAULT[net]} USDT`,
  authority: FEE_WRITE,
});

const SPECS: Record<NumKey, NumSpec> = {
  dailyLimitCount: {
    key: "dailyLimitCount",
    label: D5_PARAM_HELP.dailyLimitCount.label,
    unit: "次",
    min: 1,
    max: 10,
    step: 1,
    invalid: "每日提现次数要填 1–10 的整数。",
    range: "1–10 的整数",
    valid: (value) => Number.isInteger(value) && value >= 1 && value <= 10,
    loosen: "up",
    tightest: 1,
    current: (p) => p.dailyLimitCount,
    show: (value) => `${value} 次`,
    how: D5_PARAM_HELP.dailyLimitCount.how,
    whatIf: (value) => `改成 ${value}：用户每天最多发起 ${value} 笔提现。`,
    authority: DAILY_WRITE,
  },
  maxBalanceRatio: {
    key: "maxBalanceRatio",
    label: D5_PARAM_HELP.maxBalanceRatio.label,
    unit: "%",
    min: 50,
    max: 100,
    step: "any",
    invalid: "余额可提上限要在 50%–100% 之间。",
    range: "50%–100%",
    valid: (value) => value >= 50 && value <= 100,
    loosen: "up",
    tightest: 50,
    current: (p) => clean(p.maxBalanceRatio * 100),
    show: (value) => `${num(value)}%`,
    how: D5_PARAM_HELP.maxBalanceRatio.how,
    whatIf: (value) => `改成 ${num(value)}%：可提余额 1,000 USDT 时，一笔最多提 ${num(value * 10)} USDT。`,
    authority: BALANCE_WRITE,
  },
  minUsdt: {
    key: "minUsdt",
    label: D5_PARAM_HELP.minUsdt.label,
    unit: "USDT",
    min: 0,
    max: D5_MIN_USDT_MAX,
    step: 1,
    invalid: "最低提现额要填 0 或范围内的正整数。",
    range: "0 或正整数，0 表示不限制",
    valid: isD5MinimumUsdt,
    loosen: "down",
    tightest: D5_MIN_USDT_MAX,
    current: (p) => p.minUsdt,
    show: minimumUsd,
    how: D5_PARAM_HELP.minUsdt.how,
    whatIf: (value) => value === 0 ? "取消链上提现的最低金额限制。" : `低于 ${minimumUsd(value)} 的链上提现申请会被拒绝。`,
    authority: DAILY_WRITE,
  },
  smallAmountThresholdUsd: {
    key: "smallAmountThresholdUsd",
    label: D5_PARAM_HELP.smallAmountThresholdUsd.label,
    unit: "USDT",
    min: 0,
    max: 500,
    step: "any",
    invalid: "小额免审线要在 0–500 USDT 之间。",
    range: "0–500 USDT，0 表示关闭",
    valid: (value) => value >= 0 && value <= 500,
    loosen: "up",
    tightest: 0,
    current: (p) => p.smallAmountThresholdUsd,
    show: usd,
    how: D5_PARAM_HELP.smallAmountThresholdUsd.how,
    whatIf: (value) => value === 0
      ? "改成 0：关闭小额自动过审。"
      : `改成 ${num(value)}：${num(value)} USD 及以下、满足其他风控条件的 USDT 提现自动过审，超过的进人工审核。`,
    authority: DAILY_WRITE,
  },
  payoutSlaHours: {
    key: "payoutSlaHours",
    label: D5_PARAM_HELP.payoutSlaHours.label,
    unit: "小时",
    min: 1,
    max: 168,
    step: 1,
    invalid: "到账时效要填 1–168 的整数小时。",
    range: "1–168 的整数小时",
    valid: (value) => Number.isInteger(value) && value >= 1 && value <= 168,
    loosen: "down",
    tightest: 168,
    current: (p) => p.payoutSlaHours,
    show: (value) => `${value} 小时`,
    how: D5_PARAM_HELP.payoutSlaHours.how,
    whatIf: (value) => `改成 ${value}：新提现的截止时间是审查窗口结束后 ${value} 小时。`,
    authority: DAILY_WRITE,
  },
  addressEffectiveDelayHours: {
    key: "addressEffectiveDelayHours",
    label: D5_PARAM_HELP.addressEffectiveDelayHours.label,
    unit: "小时",
    min: 1,
    max: D5_ADDRESS_EFFECTIVE_DELAY_HOURS_MAX,
    step: 1,
    invalid: "新地址生效等待要填 1–8,760 的整数小时。",
    range: "1–8,760 的整数小时",
    valid: (value) => Number.isInteger(value) && value >= 1 && value <= D5_ADDRESS_EFFECTIVE_DELAY_HOURS_MAX,
    loosen: "down",
    tightest: D5_ADDRESS_EFFECTIVE_DELAY_HOURS_MAX,
    current: (p) => p.addressEffectiveDelayHours ?? NaN,
    show: (value) => `${num(value)} 小时`,
    how: D5_PARAM_HELP.addressEffectiveDelayHours.how,
    authority: DAILY_WRITE,
  },
  addressChangeCooldownDays: {
    key: "addressChangeCooldownDays",
    label: D5_PARAM_HELP.addressChangeCooldownDays.label,
    unit: "天",
    min: 1,
    max: D5_ADDRESS_CHANGE_COOLDOWN_DAYS_MAX,
    step: 1,
    invalid: "地址再次更换间隔要填 1–365 的整数天。",
    range: "1–365 的整数天",
    valid: (value) => Number.isInteger(value) && value >= 1 && value <= D5_ADDRESS_CHANGE_COOLDOWN_DAYS_MAX,
    loosen: "down",
    tightest: D5_ADDRESS_CHANGE_COOLDOWN_DAYS_MAX,
    current: (p) => p.addressChangeCooldownDays ?? NaN,
    show: (value) => `${num(value)} 天`,
    how: D5_PARAM_HELP.addressChangeCooldownDays.how,
    authority: DAILY_WRITE,
  },
  nexFeeOffsetRate: {
    key: "nexFeeOffsetRate",
    label: D5_PARAM_HELP.nexFeeOffsetRate.label,
    unit: "USDT / UVT",
    min: 0.000001,
    max: 999999999999.999999,
    step: "any",
    invalid: "UVT 抵扣率超出允许范围，最小 0.000001。",
    range: "最小 0.000001",
    valid: (value) => value >= 0.000001 && value <= 999999999999.999999,
    loosen: "up",
    tightest: 0.000001,
    current: (p) => p.nexFeeOffsetRate,
    show: (value) => `${num(value)} USDT / UVT`,
    how: D5_PARAM_HELP.nexFeeOffsetRate.how,
    // 后端按整数 UVT 向上取整（AppWithdrawalService.submitOnce）。
    whatIf: (value) => `改成 ${num(value)}：1 USDT 手续费要 ${Math.ceil(clean(1 / value))} UVT 抵满。`,
    authority: FEE_WRITE,
  },
  "fee.trc20": feeSpec("trc20"),
  "fee.bep20": feeSpec("bep20"),
  "fee.erc20": feeSpec("erc20"),
};

const GROUP_FIELDS: Record<Exclude<Group, "network">, readonly NumKey[]> = {
  limits: ["dailyLimitCount", "maxBalanceRatio", "minUsdt", "smallAmountThresholdUsd", "payoutSlaHours", ...ADDRESS_PROTECTION_FIELDS],
  fee: ["fee.trc20", "fee.bep20", "fee.erc20"],
  nex: ["nexFeeOffsetRate"],
};
const GROUP_TITLE: Record<Group, string> = { limits: "额度和时效", network: "提现网络", fee: "网络确认费", nex: "UVT 抵扣率" };
const GROUP_IMPACT: Record<Group, string> = {
  limits: "地址保护适用于之后保存的地址。其他参数从下一笔提现起按新值；调低每日次数时，当天超过新次数、还没放行的单放行时也被拦",
  network: "关掉的网络用户不能再发起提现；接打款服务时，这个网络上还没交给打款服务的提现也会暂停打款",
  fee: "之后的新提现按新费用收，已提交的提现不变",
  nex: "之后的新提现按新抵扣率算，已提交的提现不变",
};

const netKey = (net: Net) => `net.${net}`;
/** 关完之后 App、H5 能选的网络一个不剩：抽屉和最终确认说同一句（DP-03）。TRC20 不在 App、H5 的选择里，配置还开着时另说一句。 */
const NET_LAST_OPEN = "这是 App、H5 能选的最后一条网络，关掉后 App、H5 用户不能发起 USDT 提现。";
const NET_ALL_CLOSED = "提交后 App、H5 能选的 BEP20、ERC20 都关着，App、H5 用户不能发起 USDT 提现。";
const NET_TRC20_STAYS = "TRC20 配置还开着，旧版本 App 可能仍会用它提现。";
const TRC20_ROW_NOTE = `TRC20 ${TRC20_CLOSED}，这里不能开启。配置开着、实际可用时，旧版本 App 仍可能用它发起提现，已提交的 TRC20 提现照常走审核和打款；关掉后按「改了会怎样」处理`;
const NET_PAUSE = "接打款服务时，关掉的网络上还没交给打款服务的提现也会暂停打款。";
const NET_CLOSE_EFFECT = "关掉后用户不能再用这个网络发起提现。接打款服务时，这个网络上已提交、还没交给打款服务的提现也会暂停打款；已交给打款服务的继续查询核对。";
/** 顶部结论用可选通道的三态，行内保留各条通道的后端状态。 */
function networkView(p: D5ParamData) {
  const states = NETWORKS.map((net) => {
    const row = p.networkStatus?.find((item) => item.network === `USDT-${NET_LABEL[net]}`);
    const configured = row?.configured ?? p.networkEnabled[net];
    const usable = row?.state === "AVAILABLE" ? true : row?.state === "UNAVAILABLE" ? false : undefined;
    return { net, configured, usable, code: row?.disabledReason ?? null };
  });
  const open = states.filter((item) => item.configured && item.net !== CLOSED_NET);
  const blocked = open.filter((item) => item.usable === false);
  const unknown = open.filter((item) => item.usable === undefined);
  const known = unknown.length === 0;
  const reasonOf = (code: string | null) => (code && D5_NETWORK_BLOCK_REASON[code]?.text) || D5_NETWORK_BLOCK_UNKNOWN;
  const shared = blocked.length > 0 && blocked.length === open.length && blocked.every((item) => item.code === blocked[0].code) ? blocked[0].code : undefined;
  const names = (list: typeof states) => list.map((item) => NET_LABEL[item.net]).join("、");
  const byConfig = open.length === 0;
  // TRC20 配置开着、后端没说用不了：App、H5 当前版本不给选，旧版本 App 还可能用它发起提现。
  const trc20 = states.find((item) => item.net === CLOSED_NET)!;
  const trc20Live = trc20.configured && trc20.usable !== false;
  const trc20Tail = trc20Live ? "；TRC20 配置还开着，旧版本 App 可能仍在用它提现" : "";
  const outage = byConfig ? `App、H5 能选的 BEP20、ERC20 都在这页关着${trc20Tail}`
    : blocked.length === open.length
      ? `App、H5 能选的 ${names(open)} ${open.length > 1 ? "都" : ""}用不了${shared ? `：${reasonOf(shared)}` : "，原因写在各网络那一行"}${trc20Tail}`
      : undefined;
  return { known, states, blocked, unknown, shared, outage, byConfig, reasonOf, trc20Live };
}

/** 「调整」和组名之间，组名是英文开头时空一格（TX：中英文之间加空格）。和样板页 H2 一样叫「调整」。 */
const editTitle = (name: string) => `调整${/^[A-Za-z]/.test(name) ? " " : ""}${name}`;

type Draft = Record<string, string>;
type Editing = {
  group: Group;
  draft: Draft;
  /** 数字框里填了浏览器认不出的内容：值是空串，但不算没填（CP-54）。 */
  bad: Record<string, boolean>;
  touched: Record<string, boolean>;
  attempted: boolean;
  /** 打开时读到的值，用来判断哪些项是自己改的。 */
  base: D5ParamData;
  /** 提交时发现别人先改过：写在抽屉顶部。 */
  conflict?: ReactNode;
};

function configuredFields(group: Exclude<Group, "network">, p: D5ParamData) {
  return GROUP_FIELDS[group].filter((key) => Number.isFinite(SPECS[key].current(p)));
}

function draftOf(group: Group, p: D5ParamData): Draft {
  if (group === "network") return Object.fromEntries(NETWORKS.map((net) => [netKey(net), p.networkEnabled[net] ? "on" : "off"]));
  return Object.fromEntries(configuredFields(group, p).map((key) => [key, String(SPECS[key].current(p))]));
}

type NumEval = { spec: NumSpec; text: string; now: number; value?: number; error?: string; changed: boolean; loosens: boolean; writable: boolean; locked?: boolean };

/** 一条命令的草稿算出来的东西：每项的对错和方向、要提交的改动、前后值。 */
function evaluate(editing: Editing, p: D5ParamData, can: (authority: string) => boolean) {
  const { group, draft, bad } = editing;
  if (group === "network") {
    const next = Object.fromEntries(NETWORKS.map((net) => [net, draft[netKey(net)] === "on"])) as Record<Net, boolean>;
    const changedNets = NETWORKS.filter((net) => next[net] !== p.networkEnabled[net]);
    const closing = changedNets.filter((net) => !next[net]);
    const lastClosed = closing[closing.length - 1];
    // 用户还能不能提现只看 BEP20、ERC20：只关 TRC20 不算「关完」（TRC20 通道暂未开放，用户本来就用不了）。
    const openClosing = closing.filter((net) => net !== CLOSED_NET);
    const allClosed = OPEN_NETS.every((net) => !next[net]) && openClosing.length > 0;
    const lastOpen = openClosing.length === 1;
    const closedNote = allClosed ? `${lastOpen ? NET_LAST_OPEN : NET_ALL_CLOSED}${next[CLOSED_NET] && networkView(p).trc20Live ? NET_TRC20_STAYS : ""}` : "";
    const rows: DiffRow[] = NETWORKS.map((net) => ({
      key: net,
      label: `${NET_LABEL[net]} 提现`,
      before: p.networkEnabled[net] ? "开启" : "关闭",
      after: next[net] ? "开启" : "关闭",
      // 关网络的后果写在最后一个关掉的网络下面，确认框里看得到（DP-03、VS-103）：关完一个不剩时先说这句，再说没打出的单会暂停。
      note: net === lastClosed ? `${closedNote}${NET_PAUSE}` : undefined,
    }));
    return {
      numbers: [] as NumEval[],
      next,
      changedCount: changedNets.length,
      issues: 0,
      loosens: changedNets.some((net) => next[net]),
      closesOnly: changedNets.length > 0 && changedNets.every((net) => !next[net]),
      allClosed,
      lastOpen,
      closedNote,
      rows,
      changes: changedNets.length ? { networkEnabled: next } as D5OwnedChanges : null,
    };
  }
  const numbers = configuredFields(group, p).map((key): NumEval => {
    const spec = SPECS[key];
    const text = draft[key] ?? "";
    const writable = can(spec.authority);
    const now = spec.current(p);
    if (!writable) return { spec, text, now, value: now, changed: false, loosens: false, writable };
    if (key === `fee.${CLOSED_NET}`) return { spec, text, now, value: now, changed: false, loosens: false, writable, locked: true };
    if (bad[key]) return { spec, text, now, error: spec.invalid, changed: true, loosens: false, writable };
    if (text.trim() === "") return { spec, text, now, error: `填写${spec.label}：${spec.range}，空着不算 0。`, changed: true, loosens: false, writable };
    const value = Number(text);
    if (!Number.isFinite(value) || !spec.valid(value)) return { spec, text, now, error: spec.invalid, changed: true, loosens: false, writable };
    const changed = key === "minUsdt" ? value !== now : clean(value) !== clean(now);
    const loosens = changed && (spec.loosen === "up" ? value > now : value < now);
    return { spec, text, now, value, changed, loosens, writable };
  });
  const changed = numbers.filter((item) => item.changed);
  const issues = numbers.filter((item) => item.error).length;
  const rows: DiffRow[] = numbers.map((item) => ({
    key: item.spec.key,
    label: group === "fee" ? `${item.spec.label} 网络确认费` : item.spec.label,
    before: item.spec.show(item.now),
    after: item.value === undefined ? "—" : item.spec.show(item.value),
    note: group === "fee" && item.value === 0 && item.changed ? "设为 0 的网络将不收手续费，请确认。" : undefined,
  }));
  let changes: D5OwnedChanges | null = null;
  if (!issues && changed.length) {
    const valueOf = (key: NumKey) => numbers.find((item) => item.spec.key === key)?.value;
    if (group === "fee") {
      changes = { networkConfirmFeeUsd: { trc20: valueOf("fee.trc20")!, bep20: valueOf("fee.bep20")!, erc20: valueOf("fee.erc20")! } };
    } else if (group === "nex") {
      changes = { nexFeeOffsetRate: valueOf("nexFeeOffsetRate")! };
    } else {
      changes = {};
      for (const item of changed) {
        if (item.spec.key === "maxBalanceRatio") changes.maxBalanceRatio = clean(item.value! / 100);
        else if (item.spec.key === "dailyLimitCount") changes.dailyLimitCount = item.value!;
        else if (item.spec.key === "minUsdt") changes.minUsdt = item.value!;
        else if (item.spec.key === "smallAmountThresholdUsd") changes.smallAmountThresholdUsd = item.value!;
        else if (item.spec.key === "payoutSlaHours") changes.payoutSlaHours = item.value!;
        else if (item.spec.key === "addressEffectiveDelayHours" || item.spec.key === "addressChangeCooldownDays") {
          changes[item.spec.key] = item.value!;
        }
      }
    }
  }
  return {
    numbers,
    next: undefined,
    changedCount: changed.length,
    issues,
    loosens: numbers.some((item) => item.loosens),
    closesOnly: false,
    allClosed: false,
    lastOpen: false,
    closedNote: "",
    rows,
    changes,
  };
}

/** 一组改动逐项的名字和值：待确认条上的一句话（describeChanges）和放宽单的前后值（ProposalFacts）共用。 */
function changeParts(changes: Record<string, unknown>): [string, string][] {
  const parts: [string, string][] = [];
  const n = (value: unknown) => Number(value);
  if (changes.dailyLimitCount !== undefined) parts.push(["每日提现次数", `${n(changes.dailyLimitCount)} 次`]);
  const ratio = changes.maxBalanceRatio ?? changes.balanceMaxRatio;
  if (ratio !== undefined) parts.push(["余额可提上限", `${num(n(ratio) * 100)}%`]);
  if (changes.minUsdt !== undefined) parts.push(["最低提现额", minimumUsd(n(changes.minUsdt))]);
  if (changes.smallAmountThresholdUsd !== undefined) parts.push(["小额免审线", usd(n(changes.smallAmountThresholdUsd))]);
  if (changes.payoutSlaHours !== undefined) parts.push(["到账时效", `${n(changes.payoutSlaHours)} 小时`]);
  if (changes.addressEffectiveDelayHours !== undefined) parts.push(["新地址生效等待", `${n(changes.addressEffectiveDelayHours)} 小时`]);
  if (changes.addressChangeCooldownDays !== undefined) parts.push(["地址再次更换间隔", `${n(changes.addressChangeCooldownDays)} 天`]);
  const fees = changes.networkConfirmFeeUsd as Record<Net, unknown> | undefined;
  if (fees) parts.push(["网络确认费", NETWORKS.map((net) => `${NET_LABEL[net]} ${usd(n(fees[net]))}`).join("、")]);
  const enabled = changes.networkEnabled as Record<Net, unknown> | undefined;
  if (enabled) parts.push(["提现网络", NETWORKS.map((net) => `${NET_LABEL[net]} ${enabled[net] ? "开启" : "关闭"}`).join("、")]);
  if (changes.nexFeeOffsetRate !== undefined) parts.push(["UVT 抵扣率", `${num(n(changes.nexFeeOffsetRate))} USDT / UVT`]);
  return parts;
}

/** 一组改动写成一句话：待确认条上看得懂发出去的是什么。 */
function describeChanges(changes: Record<string, unknown>) {
  return changeParts(changes).map(([label, value]) => `${label} ${value}`).join("；") || "提现参数";
}

/** 放宽单上后端记的前后值（OpsFinanceService.previewWithdrawalLimits）：「{字段=值, …}」，网络两项是「[TRC20=…, BEP20=…, ERC20=…]」。读不懂就返回 null，不拼半截。 */
const TICKET_FIELDS = new Set(["dailyLimitCount", "balanceMaxRatio", "minUsdt", "smallAmountThresholdUsd", "payoutSlaHours",
  "addressEffectiveDelayHours", "addressChangeCooldownDays", "networkConfirmFeeUsd", "networkEnabled", "nexFeeOffsetRate"]);
function ticketChanges(text: string | undefined) {
  const body = /^\{(.+)\}$/.exec(text?.trim() ?? "")?.[1];
  if (!body) return null;
  const changes: Record<string, unknown> = {};
  for (const part of body.split(/, (?![^[]*\])/)) {
    const [, key, value] = /^(\w+)=(.+)$/.exec(part) ?? [];
    if (!key || !TICKET_FIELDS.has(key)) return null;
    const nets = /^\[(.+)\]$/.exec(value)?.[1];
    if (nets === undefined) {
      if (!Number.isFinite(Number(value))) return null;
      changes[key] = value;
      continue;
    }
    const pairs = new Map(nets.split(", ").map((item) => item.split("=") as [string, string]));
    const byNet: Record<string, unknown> = {};
    for (const net of NETWORKS) {
      const raw = pairs.get(NET_LABEL[net]);
      if (key === "networkEnabled" ? raw !== "true" && raw !== "false" : !Number.isFinite(Number(raw))) return null;
      byNet[net] = key === "networkEnabled" ? raw === "true" : raw;
    }
    changes[key] = byNet;
  }
  return changes;
}

/**
 * 放宽单拟改的值，紧跟在审批单那一行下面（OP-63）：前是提交时的值，后是拟改的值；读不懂写「没读到」，不留空。
 * settled：单子已有结论（批准、驳回、撤回、过期），拟改值不再用待生效的蓝（VS-103）。
 */
function ProposalFacts({ rows, settled }: { rows: readonly { id: string; before?: string; after?: string }[]; settled?: boolean }) {
  if (!rows.length) return null;
  return <div className="d-proposal"><Facts>{rows.flatMap((row) => {
    const before = ticketChanges(row.before);
    const after = ticketChanges(row.after);
    const head = rows.length > 1 ? [<Fact key={`${row.id}:id`} k="审批单">{row.id}</Fact>] : [];
    if (!before || !after) return [...head, <Fact key={`${row.id}:none`} k="拟改值">没读到</Fact>];
    const from = new Map(changeParts(before));
    // 只列改了的项（和越南盾一样）；摘要里一组字段整组带上时，没变的不列。
    const changed = changeParts(after).filter(([label, value]) => from.get(label) !== value);
    return [...head, ...(changed.length ? changed : changeParts(after)).map(([label, value]) => (
      <Fact key={`${row.id}:${label}`} k={label}><Change from={from.get(label) ?? "—"} to={value} settled={settled} /></Fact>
    ))];
  })}</Facts></div>;
}

/** 收紧（直接生效）的原操作。结果未知时原样保存，重试只能发这一份（OP-92、OP-94）。版本可能已变，确认前整页不能再改。 */
type TightenRecord = PendingMutationRecord & WithdrawalReplayObservation & {
  label: string;
  changes: D5OwnedChanges;
  expectedVersion: number;
  reason: string;
  operator: string;
  commandOrigin?: FundCommandOrigin;
  trc20FeeBefore?: number;
};
const TIGHTEN_SCOPE = "d5|limits";
const tightenCommands = createPendingMutationStore<TightenRecord>({
  storageKey: "nexion-admin-d5-withdrawal-commands-v1",
  // 过了 24 小时不能再用原号重试，记录和锁都留着，到操作记录核对（OP-96）。
  retainExpiredRecords: true,
  isValidRecord: (record) => typeof record.label === "string" && record.label.length > 0
    && typeof record.reason === "string" && record.reason.length > 0
    && typeof record.operator === "string"
    && Number.isSafeInteger(record.expectedVersion)
    && !!record.changes && typeof record.changes === "object" && !Array.isArray(record.changes)
    && isDConfigCommandOrigin(record.commandOrigin, "D5"),
});

function tightenReplayBlock(record: TightenRecord, params: D5ParamData | null) {
  return d5Trc20ReplayBlock({ ...record.changes, expectedVersion: record.expectedVersion }, params, record.trc20FeeBefore);
}

/**
 * 只能查询的原请求（会打开 TRC20、改它的确认费，或读不到原值）：为什么不能重试和下一步写在行上常显（OP-126、OP-93），
 * 不只放在按钮提示里；共用状态里叫人按原操作重试的那句换成读现值和操作记录。
 */
function queryOnlyStatus(reason: string, base: NonNullable<FundRecoveryRow["status"]>, canQuery: boolean, notFound = false) {
  const head = /按原(操作|请求)重试/.test(reason) ? `${reason}。` : `${reason}，不能按原操作重试。`;
  const next = notFound ? "原审批单暂未查到；刷新页面读现在的值，到操作记录与审批核对。"
    : base.label === "已处理" ? "后台已处理，看不出成没成；刷新页面读现在的值，再到操作记录与审批核对。"
      : base.label === "结果未知" ? canQuery ? "先查询原操作，再刷新页面读现在的值，或到操作记录与审批核对。" : "刷新页面读现在的值，到操作记录与审批核对。"
        : base.line;
  return { ...base, line: head + next };
}

function replayReasonFor(block: string | undefined) {
  return block === TRC20_OPENS_WITHDRAWAL || block === TRC20_CHANGES_FEE ? `原请求${block}，TRC20 ${TRC20_CLOSED}` : block;
}

export async function queryD5DirectCommand(record: TightenRecord, evidence?: FundCommandEvidence) {
  const saved = tightenCommands.list().find(row => row.commandKey === record.commandKey);
  if (!saved) throw new Error("INVESTIGATION_ORIGINAL_NOT_FOUND_REMAINS_LOCKED");
  const result = await queryDConfigCommand(saved, "D5", evidence);
  if (result.settled) tightenCommands.forget(saved.fingerprint, saved.commandKey);
  else rememberWithdrawalProcessing(tightenCommands, saved, result.receipt);
  return result;
}

function tightenKey() {
  const uuid = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `d5-limits-${uuid.replaceAll("-", "").slice(0, 16)}`;
}

/**
 * 抽屉里的一个数字项。放在组件外面：在页面里现定义的话每次渲染都换新组件，输入框会被卸掉、丢焦点。
 * 刚打开不报错，离开这一项或点过提交才在下面写原因（OP-141）；空、填坏、超范围分开说（CP-54、PCM-25）。
 */
function D5NumberField({ item, value, showError, onChange, onBadInput, onLeave, "aria-label": ariaLabel }: {
  item: NumEval | undefined;
  value: string;
  showError: boolean;
  onChange: (value: string) => void;
  onBadInput: (bad: boolean) => void;
  onLeave: () => void;
  "aria-label": string;
}) {
  if (!item) return null;
  const { spec } = item;
  const now = `现在 ${spec.show(item.now)}`;
  if (!item.writable) {
    return <div data-d5-field={spec.key}><Field label={spec.label} help={`${now} · 这个账号没有这一项的修改权限，只能看。`}>{null}</Field></div>;
  }
  if (item.locked) {
    return <div data-d5-field={spec.key}><Field label={spec.label} help={`${now} · ${TRC20_CLOSED}`}>
      {(control) => <NumberInput {...control} aria-label={ariaLabel} unit={spec.unit} value={String(item.now)} disabled />}
    </Field></div>;
  }
  const tag = item.changed && !item.error && <DirectionTag loosens={item.loosens} />;
  const zeroFee = spec.key.startsWith("fee.") && item.value === 0 && item.changed;
  // 框下两行：第一行现在值和范围一直在，填错时错误顶替范围；第二行改了才有，写改了会怎样（VS-103、VS-104）。
  const erring = showError && !!item.error;
  const effect = !item.error && item.changed && item.value !== undefined
    ? zeroFee ? "设为 0 的网络将不收手续费，请确认。" : spec.whatIf?.(item.value)
    : undefined;
  const help = <>
    <div>{erring || !spec.how ? now : `${now} · ${spec.how}`}</div>
    {effect && <div>{effect}</div>}
  </>;
  return (
    <div data-d5-field={spec.key}>
      <Field label={<>{spec.label}{tag && <> {tag}</>}</>} help={help} error={erring ? item.error : undefined}>
        {(control) => <NumberInput {...control} aria-label={ariaLabel} unit={spec.unit} min={spec.min} max={spec.max} step={spec.step} value={value}
          onChange={(event) => onChange(event.target.value)}
          onInput={(event) => onBadInput(event.currentTarget.validity.badInput)}
          onBlur={onLeave} />}
      </Field>
    </div>
  );
}

/** 放宽是开锁、收紧是锁（VS-103，同 K1）。收紧不用蓝：蓝在框里说的是「待生效」。 */
function DirectionTag({ loosens }: { loosens: boolean }) {
  return loosens ? <StatusTag tone="warn" icon={LockOpen}>放宽</StatusTag> : <StatusTag tone="neutral" icon={Lock}>收紧</StatusTag>;
}

/** 原命令要的写权：按原命令里的字段算，和后端 D5WithdrawalAuthorization 一样每个字段都要有（F10）。 */
function commandAuthorities(changes: Record<string, unknown>) {
  const need = new Set<string>();
  for (const key of Object.keys(changes)) {
    if (["dailyLimitCount", "minUsdt", "smallAmountThresholdUsd", "payoutSlaHours", ...ADDRESS_PROTECTION_FIELDS].includes(key)) need.add(DAILY_WRITE);
    else if (["maxBalanceRatio", "balanceMaxRatio"].includes(key)) need.add(BALANCE_WRITE);
    else if (["networkConfirmFeeUsd", "networkEnabled", "nexFeeOffsetRate"].includes(key)) need.add(FEE_WRITE);
  }
  return [...need];
}

/** 解除框要解除的是哪一条：只是弹窗的对象，原命令还在各自的持久记录里。 */
type ReleaseTarget = { label: string; slot: string; commandKey: string; loosen: boolean };

const UNKNOWN_TOAST = "结果未知，不要重复操作。到页面上方查询原操作。";
const TIGHTEN_LOCK = "这页有修改的结果未知，先到上方查询原操作";
const NO_WRITE = "这个账号已没有这项权限，请有权限的同事处理";
/** 过期、还没查询时展开后的出路：行内已经说了不能重试、先查询，这里只说查到以后谁来核查结案。 */
const EXPIRED_CLOSE_HERE = "查到原结果后，可以在这一行核查结案。";
const EXPIRED_CLOSE_OTHER = "查到原结果后，请有调查权限的超级管理员核查结案。";
const EXPIRED_NO_QUERY = "这个账号查不了原审批单，请有调查权限的超级管理员查询并核查结案。";
/** 过期、还没查询的行展开后说一次出路；查不了原结果的旧记录不说。 */
function expiredNext(record: FundCommandRecord) {
  const access = fundInvestigationAccess(record);
  return access.unavailableReason ? "" : access.canSubmit ? EXPIRED_CLOSE_HERE : EXPIRED_CLOSE_OTHER;
}
const NETWORK_RULE = "用户能不能用和 App 提现是同一个判断：「紧急停用开关」的提现开关和这页的开关都开着，出款服务接通；接打款服务时还要全局出款总闸开着、打款服务开通了这个网络、最近完成过完整对账、没有没处理的资金风险。";
const COVERAGE_RULE = "放宽在提交和批准时各查一次兑付覆盖率，低于红线或读不到可靠结果都会被拒。收紧不查。";
const APPROVAL_NOTE = "另一位超级管理员批准后才生效，批准前当前值不变。发起人不能批自己提交的单。";

export function D5Params({ ctx }: { ctx: DCtx }) {
  const reach = useReach();
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = useMemo(() => session?.authorities ?? [], [session]);
  const can = useCallback((authority: string) => authorities.includes(authority), [authorities]);
  const canDailyWrite = can("finance_d5_daily_limit_write");
  const canBalanceWrite = can("finance_d5_balance_max_write");
  const canFeeWrite = can("finance_d5_fee_write");
  const canWriteAny = canDailyWrite || canBalanceWrite || canFeeWrite;
  // 按原号恢复结果未知的本人单时，发起审批权也可查询。
  const canQuery = can("platform_a2_read");
  const canLookupOwn = canReadOwnRecoveryProposal(authorities);
  const proposeBlock = withdrawalApprovalDisabledReason(authorities);

  const [params, setParams] = useState<D5ParamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readAt, setReadAt] = useState("");
  const requestId = useRef(0);
  const approvals = useWithdrawalApprovals("D5", session?.adminId, authorities);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [leaveAsk, setLeaveAsk] = useState<false | "close" | "refresh">(false);
  const [phaseOpen, setPhaseOpen] = useState(false);
  const [tightenPending, setTightenPending] = useState<TightenRecord[]>([]);
  const [loosenPending, setLoosenPending] = useState<ReturnType<typeof pendingConfigApproval>>(undefined);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [queryMissing, setQueryMissing] = useState<string[]>([]);
  // 按原号查审批单这一路的结果，和通用核查（investigationResults）分开记。
  const [proposalLookups, setProposalLookups] = useState<Partial<Record<string, WithdrawalProposalLookup>>>({});
  const [recovering, setRecovering] = useState("");
  const [releasing, setReleasing] = useState<ReleaseTarget | null>(null);

  const syncPending = useCallback(() => {
    setTightenPending(tightenCommands.list());
    setLoosenPending(session ? pendingConfigApproval("D5", session.adminId) : undefined);
  }, [session]);
  const note = (key: string, text: string) => setNotes((current) => ({ ...current, [key]: text }));

  const applySnapshot = useCallback((next: D5ParamData) => {
    requestId.current += 1;
    setParams(next);
    setReadAt(businessClock(Date.now()));
    setError("");
    setLoading(false);
  }, []);

  // 刷新时清空并显示加载，失败不留旧值（D5-S04，失败关闭）。
  const load = useCallback(async (afterApproval = false) => {
    const id = ++requestId.current;
    setLoading(true);
    setParams(null);
    setError("");
    try {
      const next = await fetchD5WithdrawalParams();
      if (id === requestId.current) {
        setParams(next);
        setReadAt(businessClock(Date.now()));
      }
      return next;
    } catch (err) {
      if (id === requestId.current) setError(afterApproval ? WITHDRAWAL_CONFIG_READ_FAILED : errorText(err));
      return null;
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [load]);
  useEffect(() => syncPending(), [syncPending]);

  const reloadAll = () => {
    void load();
    approvals.refreshApprovals();
  };

  const applyApproval = (result: WithdrawalApprovalReceipt & { acknowledgement: string }) => {
    approvals.registerReceipt(result);
    syncPending();
    toast(result.acknowledgement, "success");
    void load(true);
  };

  const coverageBlock = params && (!params.coverageReliable
    ? "放宽已暂停：兑付覆盖率暂时读不到可靠结果"
    : params.coverageRatio < params.redlinePct
      ? `放宽已暂停：兑付覆盖率 ${pct(params.coverageRatio)}，低于红线 ${fmtConfigPct(params.redlinePct)}`
      : undefined);
  const { pendingRows: pendingApproval, stale: ownStale, pendingTitle, loadQueue: loadApprovals } = approvals;
  /** 放宽现在为什么提交不了，从上往下取第一条。 */
  const loosenBlock = proposeBlock
    ?? (loosenPending?.withdrawalSubmissionConfirmed ? "上一次放宽已提交，先到上方查询审批单"
      : loosenPending ? "上一次放宽的结果未知，先到上方查询原操作" : undefined)
    ?? approvals.blockReason
    ?? coverageBlock
    ?? undefined;

  const groupWritable = (group: Group) => group === "limits" ? canDailyWrite || canBalanceWrite : canFeeWrite;
  /** 这一组已经收到最紧：放宽被挡时打开也改不了，入口直接禁用（OP-126）。 */
  const atTightest = (group: Group, p: D5ParamData) => {
    if (group === "network") return NETWORKS.every((net) => !p.networkEnabled[net]);
    return configuredFields(group, p).filter((key) => key !== `fee.${CLOSED_NET}` && can(SPECS[key].authority)).every((key) => clean(SPECS[key].current(p)) === clean(SPECS[key].tightest));
  };
  const entryBlock = (group: Group, p: D5ParamData) => tightenPending.length ? TIGHTEN_LOCK
    : loosenBlock && atTightest(group, p) ? `${loosenBlock}。这一组已经是最紧的值，现在没有能改的` : undefined;

  const openDrawer = (group: Group, focus?: string) => {
    if (!params) return;
    setEditing({ group, draft: draftOf(group, params), bad: {}, touched: {}, attempted: false, base: params });
    if (focus) window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-d5-field="${focus}"] :is(input, [role="radio"][tabindex="0"])`)?.focus());
  };
  const closeDrawer = () => { setEditing(null); setLeaveAsk(false); };
  const evaluation = editing && params ? evaluate(editing, params, can) : null;
  const dirty = !!editing && JSON.stringify(editing.draft) !== JSON.stringify(draftOf(editing.group, editing.base));
  const askClose = () => { if (dirty) setLeaveAsk("close"); else closeDrawer(); };
  // 刷新拿到的是新版本，抽屉里的草稿按旧值填的，不能带过去：有改动先问，再关抽屉重读（F06、D5-S04）。
  const refresh = () => {
    if (editing && dirty) { setLeaveAsk("refresh"); return; }
    closeDrawer();
    reloadAll();
  };

  // 权限被收回时抽屉里的输入也没用了。
  useEffect(() => {
    if (editing && !groupWritable(editing.group)) closeDrawer();
  });

  /** 版本冲突：最新值换进来，自己改过的项留着，其余跟最新值走，抽屉顶部写别人改了什么（OP-97）。 */
  const takeLatest = (latest: D5ParamData) => {
    setEditing((current) => {
      if (!current) return current;
      const before = draftOf(current.group, current.base);
      const after = draftOf(current.group, latest);
      const draft = Object.fromEntries(Object.entries(after).map(([key, value]) => [
        key, current.draft[key] !== undefined && current.draft[key] !== before[key] ? current.draft[key] : value,
      ]));
      const moved = evaluate({ ...current, draft: after }, current.base, () => true).rows.filter((row) => row.before !== row.after);
      return {
        ...current,
        draft,
        base: latest,
        conflict: moved.length
          ? <>别人刚改过：{moved.map((row) => `${row.label} ${row.before} → ${row.after}`).join("；")}。你改的项还在，其余已换成最新值，核对后重新提交。</>
          : <>别人刚改过提现参数的其他项，核对后重新提交。</>,
      };
    });
  };

  /** 收紧走这里：先存原操作再发（OP-92）。明确失败丢号留在框里；结果未知保号，转成页面上方的待确认（OP-93）。 */
  const sendTighten = async (record: Omit<TightenRecord, keyof PendingMutationRecord>, retry = false) => {
    const retained = tightenCommands.get(TIGHTEN_SCOPE);
    if (retained && !retry) throw new Error(TIGHTEN_LOCK);
    const key = retained ?? tightenKey();
    tightenCommands.remember(TIGHTEN_SCOPE, key, { ...record, commandOrigin: retained ? record.commandOrigin : dConfigCommandOrigin("D5") });
    if (!tightenCommands.isDurablyStored(TIGHTEN_SCOPE, key)) {
      if (!retained) tightenCommands.forget(TIGHTEN_SCOPE, key);
      throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
    try {
      await updateD5WithdrawalLimits(record.changes, record.expectedVersion, record.reason, record.operator, key, retry);
      tightenCommands.forget(TIGHTEN_SCOPE);
      syncPending();
      return "done" as const;
    } catch (cause) {
      // 只有后端明确拒绝才丢号；读不懂、断开、本地出错都按结果未知留着（F03）。
      const rejected = isExplicitRejection(cause);
      if (rejected && !retained) tightenCommands.forget(TIGHTEN_SCOPE, key);
      syncPending();
      if (rejected || isPermissionDenied(cause)) throw cause;
      return "unknown" as const;
    }
  };

  /** 抽屉「提交修改」：方向已经定了，最终确认只填理由。 */
  const confirmEdit = () => {
    if (!editing || !params || !session || !evaluation?.changes) return;
    const { group } = editing;
    const changes = evaluation.changes;
    const loosens = evaluation.loosens;
    const restoreDefault = group === "fee" && OPEN_NETS.every((net) => Number(editing.draft[`fee.${net}`]) === D5_NETWORK_CONFIRM_FEE_DEFAULT[net]);
    const label = restoreDefault ? "网络确认费恢复默认" : GROUP_TITLE[group];
    const open = (p: D5ParamData, blockedReason?: ReactNode) => openActionConfirm({
      briefKind: "config",
      action: `调整提现参数 · ${label}`,
      title: editTitle(GROUP_TITLE[group]),
      detail: <>提交前别人改过提现参数时，这次不会生效。</>,
      // 等批准的提醒跟在前后值后面，同一块里看（有放宽在等时才有）。
      facts: <>
        <DiffList rows={evaluation.rows} restTitle="没改的项" />
        {!loosens && approvals.pendingOnTighten && <Notice tone="warn">{approvals.pendingUnverified ? "放宽单如果还在等批准，收紧后要重新发起。" : "有放宽在等批准，收紧后那张审批单要重新发起。"}</Notice>}
      </>,
      amplifies: loosens,
      coverage: p.coverageReliable ? { coverageRatio: p.coverageRatio, redlinePct: p.redlinePct } : undefined,
      coverageLead: "放宽让用户更容易提现，平台付出去的钱可能变多",
      coverageCheck: COVERAGE_RULE,
      // 走审批的生效方式写在标题下的标签上，谁批、批准前什么不变进标签的提示图标（README 写操作确认）。
      effect: loosens
        ? <StatusTag tone="progress" filled explain={APPROVAL_NOTE}>批准后生效</StatusTag>
        : <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: loosens ? "提交审批" : evaluation.closesOnly ? "确认关闭，立即生效" : "确认修改，立即生效",
      reasonMin: 8,
      reasonMax: 200,
      reasonPlaceholder: "例如：资金会议决定、工单号",
      completionCopy: loosens ? "另一位超级管理员批准前，当前值不变。" : "提交后立即生效。",
      statedBrief: { impact: GROUP_IMPACT[group], check: "核对改了哪几项和方向，理由写清调整原因和依据。" },
      blockedReason: blockedReason ?? (loosens ? proposeBlock : undefined),
      run: async (reason) => {
        try {
          if (loosens) {
            const result = await submitWithdrawalConfigApproval("D5", session, d5WithdrawalLimitsValues(changes, p.version), reason);
            if (result) applyApproval(result);
            closeDrawer();
            return;
          }
          const outcome = await sendTighten({ label: `调整提现参数 · ${label}`, changes, expectedVersion: p.version, reason, operator: OPERATOR(),
            ...(changes.networkConfirmFeeUsd ? { trc20FeeBefore: p.networkConfirmFeeUsd.trc20 } : {}) });
          closeDrawer();
          if (outcome === "unknown") { toast(UNKNOWN_TOAST, "warn"); return; }
          // 写入后另读一次当前配置（OP-86）；读不到时仍说已生效，页面给「重试」（OP-87）。
          const latest = await load(true);
          toast(latest ? `${GROUP_TITLE[group]}已生效` : `${GROUP_TITLE[group]}已生效，最新参数暂时没读到`, latest ? "success" : "warn");
        } catch (cause) {
          syncPending();
          if (loosens && isA2OutcomeUncertainError(cause)) {
            closeDrawer();
            toast(UNKNOWN_TOAST, "warn");
            return;
          }
          const code = rejectionCode(cause);
          if (code === "CONFIG_VERSION_CONFLICT") {
            const latest = await fetchD5WithdrawalParams().catch(() => null);
            if (latest) {
              applySnapshot(latest);
              takeLatest(latest);
            }
            open(latest ?? p, latest
              ? "别人刚改过提现参数，这次没有提交。取消回到抽屉，核对最新值后重新提交。"
              : "别人刚改过提现参数，最新值读不到，这次不能提交。取消后刷新页面再改。");
          } else if (/COVERAGE/.test(code) || errorText(cause).includes("覆盖率")) {
            // 放宽被覆盖率拒绝：页面重读，结论句和框里的数一起更新。
            const latest = await fetchD5WithdrawalParams().catch(() => null);
            if (latest) applySnapshot(latest);
            open(latest ?? p, errorText(cause));
          } else if (code === "OBJECT_ALREADY_PENDING") {
            void loadApprovals();
          }
          // 原样抛回：共用确认框要按它认出权限层的 403（关框、重读权限）。
          throw cause;
        }
      },
    });
    open(params);
  };

  /** 按原操作重试：同命令号、同内容、同理由（OP-94）。只有成功才解除待确认。 */
  const retryTighten = async (record: TightenRecord) => {
    if (record.expiresAt <= Date.now() || record.replayRejection) { syncPending(); return; }
    const target = { ...record, commandOrigin: record.commandOrigin ?? dConfigCommandOrigin("D5") };
    const canInvestigate = fundInvestigationAccess(target).canRead;
    if (recovering || record.withdrawalStillProcessing || withdrawalReplayQueryBlock(investigationResults[record.commandKey], canInvestigate)) return;
    if (!commandAuthorities(record.changes).every(can)) { note(record.commandKey, NO_WRITE); return; }
    const block = tightenReplayBlock(record, params);
    if (block) { note(record.commandKey, block); return; }
    // 要在 list() 之前查：list() 会从内存副本恢复已删除的记录，那样就成了换号重发。
    if (!tightenCommands.isDurablyStored(record.fingerprint, record.commandKey)) {
      note(record.commandKey, "浏览器里查不到这条记录，本次没有发送。记录继续保留，请到操作记录与审批核对。");
      return;
    }
    note(record.commandKey, "");
    setInvestigationResults(current => ({ ...current, [record.commandKey]: undefined }));
    setRecovering(record.commandKey);
    try {
      const { label, changes, expectedVersion, reason, operator, commandOrigin, trc20FeeBefore } = record;
      const outcome = await sendTighten({ label, changes, expectedVersion, reason, operator, commandOrigin, trc20FeeBefore }, true);
      if (outcome === "unknown") note(record.commandKey, canInvestigate
        ? "重试结果仍未知，原操作继续保留，请先查询原操作。" : "重试结果仍未知，原操作继续保留。");
      else await settleDirect(record, "SUCCEEDED");
    } catch (cause) {
      if (isPermissionDenied(cause)) announcePermissionDenied();
      // 后端明确拒绝了这次重试才给「解除待确认」；本地出错、登录、权限、限流不算（F03、OP-153）。
      const rejection = explicitRejectionCode(cause);
      if (rejection) {
        note(record.commandKey, `重试被拒绝：${sentence(errorText(cause))}这说明不了原操作的结果，原操作继续保留。`);
        tightenCommands.markReplayRejected(record.fingerprint, record.commandKey, rejection);
        syncPending();
      } else {
        note(record.commandKey, `重试没有完成：${sentence(errorText(cause))}结果还是未知，记录继续保留。`);
      }
    } finally {
      setRecovering("");
    }
  };

  /** 放宽的原审批单：先按原号核对建单结果，再单独读取当前配置（OP-87、OP-95）。 */
  const recoverLoosen = async (mode: "lookup" | "retry") => {
    if (!session || !loosenPending) return;
    const key = loosenPending.commandKey;
    if (mode === "retry" && (recovering || loosenPending.expiresAt <= Date.now() || loosenPending.replayRejection || loosenPending.withdrawalSubmissionConfirmed
      || loosenPending.withdrawalStillProcessing || withdrawalApprovalReplayQueryBlock(investigationResults[key], fundInvestigationAccess(loosenPending).canRead, queryMissing.includes(key))
      || !loosenRecord?.values || !commandAuthorities(loosenRecord.values).every(can) || proposeBlock || loosenReplayBlock)) return;
    setQueryMissing(current => current.filter(saved => saved !== key));
    setInvestigationResults(current => ({ ...current, [key]: undefined }));
    setProposalLookups(current => ({ ...current, [key]: undefined }));
    note(key, "");
    setRecovering(key);
    try {
      if (mode === "lookup") {
        const lookup = await lookupWithdrawalApproval("D5", session);
        if (!lookup) { syncPending(); return; }
        if (lookup.state === "found") { applyApproval(lookup.result); return; }
        // 这一路的结果单独记：没查成时行上常显原因，查无才和通用核查一起算「没有查到」。
        setProposalLookups(current => ({ ...current, [key]: lookup }));
        if (lookup.state === "failed") {
          if (loosenPending.withdrawalSubmissionConfirmed) note(key, `原审批单加载失败：${lookup.reason}。稍后再点「查询原操作」。`);
          return;
        }
        if (!loosenPending.withdrawalSubmissionConfirmed) note(key, loosenPending.expiresAt <= Date.now()
          ? "原审批申请已过期，还没查到结果。请到操作记录核对，不要重复提交。" : "暂未查到原审批单，可稍后再查。");
        return true;
      }
      const result = await submitWithdrawalConfigApproval("D5", session, null, "", "retry-original");
      if (!result) {
        if (!loosenPending.withdrawalSubmissionConfirmed) note(key, "暂未查到原审批单，可稍后再查。");
        return true;
      }
      applyApproval(result);
    } catch (cause) {
      syncPending();
      if (mode === "retry" && isExplicitRejection(cause)) return;
      if (loosenPending.withdrawalSubmissionConfirmed) note(key, "原审批单加载失败，稍后再点「查询原操作」。");
      else if (isA2OutcomeUncertainError(cause)) {
        // 原因写在括号里；只取中文说明，码不上屏。
        const detail = cause.message.match(/（([^（）]*[\u4e00-\u9fa5][^（）]*)）$/)?.[1];
        note(key, `${detail ? sentence(detail) : ""}结果还是未知，记录继续保留。`);
      } else {
        note(key, `${mode === "retry" ? "重试" : "查询"}没有完成：${sentence(errorText(cause))}结果还是未知，记录继续保留。`);
      }
    } finally {
      setRecovering("");
    }
  };

  const [investigationResults, setInvestigationResults] = useState<Partial<Record<string, FundInvestigationOutcome>>>({});
  const [closing, setClosing] = useState(false);
  const [settled, setSettled] = useState<FundSettled[]>([]);
  const checkProposalInvestigation = async (record: NonNullable<ReturnType<typeof pendingConfigApproval>>, evidence?: FundCommandEvidence) => {
    setRecovering(record.commandKey);
    try {
      const { receipt, settled: done } = await checkWithdrawalApprovalCommand(record, evidence);
      setInvestigationResults(current => ({ ...current, [record.commandKey]: { receipt } }));
      if (done) {
        if (session) releaseConfigApproval("D5", session.adminId, record.commandKey);
        setSettled(current => [...current.filter(item => item.key !== record.commandKey), { key: record.commandKey, label: "放宽提现参数", status: receipt!.originalStatus, proposal: true }]);
        await load();
      }
      syncPending();
      return receipt;
    } catch (cause) {
      const error = displayAdminError(cause);
      // 结案失败由结案框自己说，不覆盖这一行上次查询的结果。
      if (!evidence) setInvestigationResults(current => ({ ...current, [record.commandKey]: { error } }));
      throw cause;
    } finally { setRecovering(""); }
  };
  /** 查询原操作：先按原请求查审批单（原有查询），还没有结论时再查原请求的执行记录。两次都是读取。 */
  const lookupLoosen = async () => {
    const missing = await recoverLoosen("lookup");
    const original = session ? pendingConfigApproval("D5", session.adminId) : undefined;
    if (!original || original.withdrawalSubmissionConfirmed) return;
    if (fundInvestigationAccess(original).canRead && await checkProposalInvestigation(original).catch(() => undefined)) note(original.commandKey, "");
    const latest = session ? pendingConfigApproval("D5", session.adminId) : undefined;
    if (missing && latest?.commandKey === original.commandKey && !latest.withdrawalStillProcessing && !latest.withdrawalSubmissionConfirmed) {
      setQueryMissing(current => [...current, latest.commandKey]);
    }
  };
  /** 收紧（直接保存）：按原请求查原结果，业务上确认成功或核查确认才解除；查到的结论写在这一行。 */
  const [directClosing, setDirectClosing] = useState<TightenRecord | null>(null);
  const settleDirect = async (record: TightenRecord, status: FundSettled["status"]) => {
    setSettled(current => [...current.filter(item => item.key !== record.commandKey), { key: record.commandKey, label: editTitle(record.label.replace(/^调整提现参数 · /, "")), status }]);
    syncPending();
    await load();
  };
  const lookupTighten = async (record: TightenRecord) => {
    setRecovering(record.commandKey);
    try {
      const { receipt, settled: done } = await queryD5DirectCommand(record);
      setInvestigationResults(current => ({ ...current, [record.commandKey]: { receipt } }));
      if (done) await settleDirect(record, receipt?.originalStatus ?? "SUCCEEDED");
      else syncPending();
    } catch (cause) {
      const error = displayAdminError(cause);
      setInvestigationResults(current => ({ ...current, [record.commandKey]: { error } }));
    } finally { setRecovering(""); }
  };
  const releasePending = (record: ReleaseTarget) => {
    setReleasing(null);
    // Local release only; evidence-based closure is the separate 核查结案 entry.
    if (record.loosen) {
      if (!session || !releaseRejectedWithdrawalApproval("D5", session.adminId, record.commandKey)) return;
    } else tightenCommands.forget(record.slot, record.commandKey);
    syncPending();
    toast("已解除本页这条原操作记录；系统里原操作的结果和锁定不变", "success");
  };

  const auditHref = "/platform/audit";
  const auditLink = reach(auditHref, "platform_a2_read") && <Link className="rd-link" href="/platform/audit?domain=D&object=current" prefetch={false}>到操作记录与审批核对</Link>;
  const zone = businessZone().label;

  // 待确认常显，读取失败时也在（OP-93）。
  const loosenRecord = (() => {
    if (!loosenPending) return null;
    try {
      const [values, reason] = configApprovalOriginalInput("D5", loosenPending.input);
      return { ...loosenPending, values: values as Record<string, unknown>, reason };
    } catch {
      return { ...loosenPending, values: null, reason: "" };
    }
  })();
  const loosenReplayBlock = loosenRecord?.values ? replayReasonFor(d5Trc20ReplayBlock(loosenRecord.values, params)) : undefined;
  const pendingRows: FundRecoveryRow[] = [
    ...(loosenRecord ? [((): FundRecoveryRow => {
      const key = loosenRecord.commandKey;
      const expired = loosenRecord.expiresAt <= Date.now();
      const outcome = investigationResults[key];
      const confirmed = loosenRecord.withdrawalSubmissionConfirmed;
      const processing = loosenRecord.withdrawalStillProcessing;
      const queryBlock = withdrawalApprovalReplayQueryBlock(outcome, fundInvestigationAccess(loosenRecord).canRead, queryMissing.includes(key));
      const retryDisabled = !loosenRecord.values || !commandAuthorities(loosenRecord.values).every(can) || proposeBlock ? NO_WRITE
        : loosenRecord.replayRejection ? "重试已被拒绝，请核实后解除"
          : processing ? WITHDRAWAL_COMMAND_PROCESSING.line : loosenReplayBlock ?? queryBlock;
      const expiredNote = expired && !investigationResults[key] ? canLookupOwn ? expiredNext(loosenRecord) : EXPIRED_NO_QUERY : "";
      const copy = { missingOrigin: "只能按操作编号查审批单进度；这条记录早于执行核查，查不了更细的执行结果。" };
      return { key, title: "放宽提现参数", record: loosenRecord, outcome, createdAt: loosenRecord.createdAt, expired, canRetry: !expired && !retryDisabled && !confirmed,
        canQuery: canLookupOwn, copy,
        status: confirmed ? withdrawalApprovalLookupStatus(proposalLookups[key], undefined, expired, true)
          // TRC20 确认费的限制排在查询失败前面：查询再成功也解不开它，要一直看得到（OP-126）。
          : loosenReplayBlock && !expired && !processing
          ? queryOnlyStatus(loosenReplayBlock, withdrawalApprovalLookupStatus(proposalLookups[key], outcome, expired)
            ?? fundRecoveryStatus({ record: loosenRecord, outcome: investigationResults[key], expired, canRetry: false, canQuery: canLookupOwn, copy }), canLookupOwn, queryMissing.includes(key))
          : withdrawalApprovalLookupStatus(proposalLookups[key], outcome, expired)
          ?? (processing ? WITHDRAWAL_COMMAND_PROCESSING
          : !expired && !canLookupOwn ? { tone: "warn", label: "结果未知", line: "这个账号查不了原审批单，请有权限的同事核对。" }
          : !expired && !outcome && retryDisabled ? { tone: "warn", label: "结果未知", line: retryDisabled } : undefined),
        actions: <>
          {canLookupOwn && <FundCheckButtons record={loosenRecord} canLookupOwnProposal={canLookupOwn} outcome={confirmed ? undefined : outcome} expired={expired} busy={!!recovering} checking={recovering === key}
            onCheck={() => void lookupLoosen()} onClose={() => setClosing(true)} />}
          {!expired && !confirmed && <Button size="sm" disabled={!!recovering}
            disabledReason={retryDisabled}
            onClick={() => void recoverLoosen("retry")}>按原操作重试</Button>}
          {!confirmed && loosenRecord.replayRejection && <Button size="sm" disabled={!!recovering} onClick={() => setReleasing({ label: "放宽提现参数", slot: loosenRecord.fingerprint, commandKey: key, loosen: true })}>解除原操作记录</Button>}
        </>,
        detail: <>
          <p>{`改动：${loosenRecord.values ? describeChanges(loosenRecord.values) : "原内容读不到"}。${confirmed ? "审批已提交，查到审批单状态后再提交放宽。" : "审批单可能已经提交，批准前现在的值不变。有结果前不能再提交放宽，收紧照常。"}`}</p>
          {expiredNote && <p>{expiredNote}</p>}
          {loosenRecord.replayRejection && <p>重试没有成功：{errorText(new Error(loosenRecord.replayRejection))} {reach("/platform/audit", "platform_a2_read") ? APPROVAL_REPLAY_RELEASE : APPROVAL_REPLAY_RELEASE_NO_AUDIT}</p>}
          {notes[key] && <p>{notes[key]}</p>}
        </>,
        tech: loosenRecord.reason ? `理由 ${loosenRecord.reason}` : undefined };
    })()] : []),
    ...tightenPending.map((record): FundRecoveryRow => {
      const expired = record.expiresAt <= Date.now();
      const replayBlock = tightenReplayBlock(record, params);
      // 原请求改 TRC20 确认费，或读不到它提交时的原费率：只能查询，写明为什么和下一步（OP-93、OP-126）。
      const replayReason = replayReasonFor(replayBlock);
      const outcome = investigationResults[record.commandKey];
      // 改版前没存出处的记录按当前账号查，queryD5DirectCommand 再核原操作人。
      const target = { ...record, commandOrigin: record.commandOrigin ?? dConfigCommandOrigin("D5") };
      const canInvestigate = fundInvestigationAccess(target).canRead;
      const queryBlock = withdrawalReplayQueryBlock(outcome, canInvestigate);
      const retryDisabled = record.replayRejection ? "重试已被拒绝，请核实后解除"
        : !commandAuthorities(record.changes).every(can) ? NO_WRITE : replayReason ?? queryBlock;
      // 查到记为失败时，「可能已经生效」不再写。
      const processing = record.withdrawalStillProcessing;
      const failed = !!outcome && "receipt" in outcome && outcome.receipt?.originalStatus === "FAILED";
      const status = withdrawalDirectRecoveryStatus(outcome, { canInvestigate, expired, processing, retryDisabled });
      const shown = replayReason && !expired ? fundRecoveryStatus({ record: target, outcome, expired, canRetry: false }) : undefined;
      return { key: record.commandKey, title: editTitle(record.label.replace(/^调整提现参数 · /, "")), record: target, outcome,
        createdAt: record.createdAt, expired, canRetry: !expired && !retryDisabled && !processing,
        status: !processing && replayReason && shown ? queryOnlyStatus(replayReason, shown, !fundReadBlock(target)) : status,
        actions: <>
          <FundCheckButtons record={target} outcome={investigationResults[record.commandKey]} expired={expired} busy={!!recovering} checking={recovering === record.commandKey}
            onCheck={() => void lookupTighten(record)} onClose={() => setDirectClosing(record)} />
          {!expired && <Button size="sm" disabled={!!recovering} disabledReason={processing && !record.replayRejection ? WITHDRAWAL_COMMAND_PROCESSING.line : retryDisabled} onClick={() => void retryTighten(record)}>按原操作重试</Button>}
          {record.replayRejection && <Button size="sm" disabled={!!recovering} onClick={() => setReleasing({ label: record.label, slot: record.fingerprint, commandKey: record.commandKey, loosen: false })}>解除原操作记录</Button>}
        </>,
        detail: <>
          <p>{`改动：${describeChanges(record.changes)}。${failed ? "" : "可能已经生效，"}有结果前这页不能再修改。`}{expired && !outcome && expiredNext(target)}</p>
          {notes[record.commandKey] && <p>{notes[record.commandKey]}</p>}
        </>,
        tech: `版本 v${record.expectedVersion} ｜ 理由 ${record.reason}` };
    }),
  ];
  const ownTicket = approvals.terminal ?? pendingApproval.find((row) => row.id === approvals.ownId);
  const pendingNotices = <>
    <FundRecoveryPanel rows={pendingRows} link={auditLink || undefined} settled={settled} onDismissSettled={key => setSettled(current => current.filter(item => item.key !== key))} />
    {approvals.ownNotice && (!params || approvals.terminal) && <Notice tone={approvals.terminal ? "neutral" : "warn"}>{approvals.ownNotice}{ownTicket && <ProposalFacts rows={[ownTicket]} settled={!!approvals.terminal} />}</Notice>}
    {closing && loosenRecord && <FundClosureModal label="放宽提现参数" createdAt={loosenRecord.createdAt} offer={eCommandClosureOffer(investigationResults[loosenRecord.commandKey], isRetryExpired(loosenRecord))} facts={loosenRecord.values ? <Fact k="改动">{describeChanges(loosenRecord.values)}</Fact> : undefined}
      onClose={() => setClosing(false)} onSubmit={async evidence => { await checkProposalInvestigation(loosenRecord, evidence); setClosing(false); }} />}
    {directClosing && <CommandClosureModal label={editTitle(directClosing.label.replace(/^调整提现参数 · /, ""))} commandKey={directClosing.commandKey} createdAt={directClosing.createdAt}
      offer={eCommandClosureOffer(investigationResults[directClosing.commandKey], isRetryExpired(directClosing))} facts={<Fact k="改动">{describeChanges(directClosing.changes)}</Fact>}
      onClose={() => setDirectClosing(null)} onSubmit={async evidence => {
        const record = directClosing;
        const { receipt, settled: done } = await queryD5DirectCommand(record, evidence);
        setInvestigationResults(current => ({ ...current, [record.commandKey]: { receipt } }));
        setDirectClosing(null);
        if (done) await settleDirect(record, receipt?.originalStatus ?? "SUCCEEDED");
      }} />}
  </>;

  const writableNames = [
    canDailyWrite && "每日提现次数、小额免审线、到账时效",
    canBalanceWrite && "余额可提上限",
    canFeeWrite && "提现网络、网络确认费、UVT 抵扣率",
  ].filter(Boolean).join("、");
  const guideExtra = (
    <section className="rd-guide-section">
      <h3>这个账号能做什么</h3>
      {canWriteAny ? (
        <ul>
          <li>能改：{writableNames}。</li>
          <li>{proposeBlock ? "只能收紧。放宽要提交审批，这个账号缺少发起审批的权限。" : "收紧提交后立即生效；放宽提交审批，另一位超级管理员批准后生效。"}</li>
          <li>{canQuery ? "能看到有没有放宽在等批准。" : "看不到放宽有没有在等批准，提交时被拒才知道，进度到操作记录与审批问有权限的同事。"}{!canQuery && canLookupOwn && "自己发起的放宽结果未知时，能查询原操作。"}</li>
        </ul>
      ) : <p>你只能查看，修改要有这页的修改权限。</p>}
      <h3>以前页头的说明</h3>
      <p><KeepText text="「设置每日提现次数、可提比例、网络费、UVT 抵扣、小额免审和到账时限。放宽限制前先看兑付覆盖率；随运营阶段变化的设置在「运营阶段设置」修改。」" phrases={["在「运营阶段设置」修改。」"]} /></p>
    </section>
  );

  const header = (
    <PageHeader
      pageId="D5"
      title="USDT 提现参数"
      summary="设置提现次数、比例、网络费和到账时效。"
      guideExtra={guideExtra}
      meta={<span className="rd-toolbar">
        <span>
          {readAt && params && `${readAt} 读取（${zone}）`}<Explain label="数据时间说明" content="打开和点「刷新」时读取，不自动刷新。" />
        </span>
        <Button variant="ghost" size="sm" loading={loading} icon={<RefreshCw size={14} aria-hidden />} onClick={refresh}>刷新</Button>
      </span>}
      readOnly={!canWriteAny ? "你只能查看；修改提现参数要有这页的修改权限。" : undefined}
    />
  );

  const releaseModal = releasing && (
    <ReleaseModal label={releasing.label} onCancel={() => setReleasing(null)} onConfirm={() => releasePending(releasing)}
      explain={releasing.loosen ? reach("/platform/audit", "platform_a2_read") ? APPROVAL_REPLAY_RELEASE : APPROVAL_REPLAY_RELEASE_NO_AUDIT : `重试被拒说明不了原操作的结果，${canQuery ? "先到操作记录核对" : "先请能看操作记录的同事核对"}它有没有生效。解除只清本页这条记录，不算核查结案；系统仍可能阻止再次提交。`} />
  );

  const sections: SectionNavItem[] = [
    { id: "limits", label: "额度和时效" },
    { id: "network", label: "网络和费用", alert: !!params && (networkView(params).blocked.length > 0 || networkView(params).unknown.length > 0) },
    { id: "phase", label: "运营阶段" },
  ];
  const nav = useSectionNav(sections, { ready: !!params, onReveal: (id) => { if (id === "phase") setPhaseOpen(true); } });
  const approvalLine = (row: typeof pendingApproval[number]) => row.operator && row.ts
    ? `审批单 ${row.id} · ${row.operator} · ${row.rawTs ? `${formatBusinessTimeCompact(row.rawTs, row.ts)}（${zone}）` : row.ts}提交`
    : `审批单 ${row.id}`;
  const queueReadNotice = canQuery && (approvals.queueState === "failed" || approvals.queueRetrying) && (
    <Notice tone="neutral" title="待批列表加载失败" action={<InlineRetry onRetry={() => void loadApprovals()} retrying={approvals.queueRetrying} />}>{approvals.queueError}{auditLink && <> {auditLink}</>}</Notice>
  );
  const queueRowsOutsideConfig = approvals.rows.filter(row => row.id !== approvals.ownId || !approvals.ownNotice);
  const queueNoticeOutsideConfig = queueRowsOutsideConfig.length > 0 && (
    <Notice tone="warn" title={pendingTitle}>{queueRowsOutsideConfig.map(approvalLine).join("；")}。<ProposalFacts rows={queueRowsOutsideConfig} />{approvals.pendingDetail}{auditLink && <> {auditLink}</>}</Notice>
  );

  if (loading && !params) {
    return <>{header}{pendingNotices}{queueNoticeOutsideConfig}{queueReadNotice}<BlockState state="loading" title="正在加载…" />{releaseModal}</>;
  }

  if (!params) {
    return <>
      {header}
      {pendingNotices}
      {queueNoticeOutsideConfig}
      {queueReadNotice}
      <BlockState state="error" title="提现参数加载失败" detail={error === WITHDRAWAL_CONFIG_READ_FAILED
        ? error : <>提现参数加载失败，旧值已清空，修改已暂停。{error && <> {error.replace(/^提现参数/, "")}</>}</>} onRetry={refresh} />
      {releaseModal}
    </>;
  }

  const p = params;

  // 一句话结论：从上往下取第一条成立的（重构说明 3.2）。比较用接口原值。
  const coverageText = `兑付覆盖率 ${pct(p.coverageRatio)}，红线 ${fmtConfigPct(p.redlinePct)}`;
  // 覆盖率、红线和可不可靠每个状态都留一处读数（D5-V10，F05）：结论句没写的，写在第二行。
  const coverageLine = <KeepText text={p.coverageReliable ? `${coverageText}。` : `读到的兑付覆盖率 ${pct(p.coverageRatio)} 不可靠，红线 ${fmtConfigPct(p.redlinePct)}。`} />;
  const poolHint = reach("/finance/pool") ? <Link className="rd-link" href="/finance/pool" prefetch={false}>去资金储备与应付款核对 →</Link> : "去资金储备与应付款核对";
  const coverageExplain = COVERAGE_RULE;
  const networks = networkView(p);
  const reconLink = reach("/finance/recon") && <Link className="rd-link" href="/finance/recon" prefetch={false}>去充值与收款对账核对 →</Link>;
  const j1Link = reach("/emergency/kill-switch", "emergency_j1_read") && <Link className="rd-link" href="/emergency/kill-switch" prefetch={false}>去紧急停用开关 →</Link>;
  const networkSection = <Link className="rd-link" href="?section=network" prefetch={false} onClick={(event) => { event.preventDefault(); nav.select("network"); }}>网络和费用</Link>;
  // 都用不了的下一步按原因走：这页关的回这页开，提现开关去紧急停用开关，出款侧的去对账页（DP-42）。
  const outageNext = networks.byConfig
    ? (loosenBlock
      ? <>开启算放宽，现在提交不了：{loosenBlock}。</>
      : canFeeWrite ? <>要恢复，在{networkSection}里点那个网络的「调整」开启，开启要审批。</> : <>开启要有提现网络修改权限的同事提交审批。</>)
    : networks.shared === "WITHDRAWAL_KILL_SWITCH_DISABLED" ? j1Link || "请有紧急停用开关权限的同事核对。"
      : reconLink;
  const pendingCount = tightenPending.length + (loosenRecord ? 1 : 0);
  const conclusion = tightenPending.length || loosenRecord
    // 大字留给答案：有待确认时结论只说后果，不放大、不再指路（DT-12、DT-21）。
    ? <Conclusion state="warn" hint={coverageLine}>{tightenPending.length ? `${pendingCount} 项修改结果未知，有结果前这页暂停修改`
      : loosenRecord?.withdrawalSubmissionConfirmed ? "放宽审批已提交，查到审批单状态后再提交放宽"
        : "1 项放宽结果未知，有结果前暂停放宽，收紧照常"}</Conclusion>
    : coverageBlock
      ? <Conclusion state="danger" lead hint={<>{p.coverageReliable ? "" : `读到 ${pct(p.coverageRatio)}，红线 ${fmtConfigPct(p.redlinePct)}。`}收紧不受影响。{poolHint}</>} explain={coverageExplain}>{coverageBlock}</Conclusion>
      : networks.outage
      ? <Conclusion state="warn" lead hint={<>{networks.outage}。{outageNext} {coverageLine}</>} explain={NETWORK_RULE}>App、H5 用户现在不能发起 USDT 提现</Conclusion>
      : pendingApproval.length
        ? <Conclusion state="warn" hint={<>{pendingApproval.map(approvalLine).join("；")}。<ProposalFacts rows={pendingApproval} />{reach(auditHref, "platform_a2_read") && <><Link className="rd-link" href="/platform/audit?domain=D&object=current" prefetch={false}>到操作记录与审批查看</Link> </>}{coverageLine}</>} explain={APPROVAL_NOTE}>
          {ownStale || approvals.checking ? pendingTitle : `${pendingTitle}，批准前当前值不变`}
        </Conclusion>
        : networks.unknown.length > 0
          ? <Conclusion state="warn" hint={<>配置照常显示，实际状态未知的网络请到「网络和费用」核对原因。{coverageLine}</>} explain={NETWORK_RULE}>部分提现网络的实际状态暂未知</Conclusion>
        : <Conclusion state={loosenBlock ? "neutral" : "ok"} explain={coverageExplain}>
          {canWriteAny ? `${approvals.queueKnown && !approvals.terminal && networks.known && networks.blocked.length === 0 ? "没有要处理的事，" : ""}${loosenBlock ? "" : "放宽可以提交。"}${coverageText}` : coverageText}
        </Conclusion>;
  // 结论句没说到的都用不了、等批准和读不到审批，单独一条（DT-12：同一件事只说一处）。
  const secondary = <>
    {networks.outage && (tightenPending.length || loosenRecord || coverageBlock) && (
      <Notice tone="warn" title="App、H5 用户现在不能发起 USDT 提现">{networks.outage}。{outageNext}</Notice>
    )}
    {pendingApproval.length > 0 && (tightenPending.length || loosenRecord || coverageBlock || networks.outage) && (
      <Notice tone="warn" title={pendingTitle}>{pendingApproval.map(approvalLine).join("；")}。<ProposalFacts rows={pendingApproval} />{approvals.pendingDetail}{auditLink && <> {auditLink}</>}</Notice>
    )}
    {networks.unknown.length > 0 && (tightenPending.length || loosenRecord || coverageBlock || pendingApproval.length > 0) && (
      <Notice tone="warn" title="部分提现网络的实际状态暂未知">配置照常显示，请到「网络和费用」核对原因。</Notice>
    )}
    {queueReadNotice}
  </>;

  const action = (group: Group, label: string, focus?: string, blocked?: string) => groupWritable(group)
    ? (describedBy: string | undefined) => <Button size="sm" aria-label={editTitle(label)} aria-describedby={describedBy} disabledReason={blocked ?? entryBlock(group, p)} onClick={() => openDrawer(group, focus)}>调整</Button>
    : undefined;
  const H = D5_PARAM_HELP;
  const numRow = (key: LimitsKey) => {
    const help = H[key];
    const spec = SPECS[key];
    const value = spec.current(p);
    return <ConfigRow key={key} name={help.label} what={help.what} when={help.when} where={help.where} effect={help.effect} note={"note" in help ? help.note : undefined}
      value={!Number.isFinite(value) ? "待核实" : key === "smallAmountThresholdUsd" && value === 0 ? "0 USDT（已关闭）" : spec.show(value)}
      action={Number.isFinite(value) && can(spec.authority) ? action("limits", help.label, key) : undefined} />;
  };
  // 一个网络一行：配置和用户能不能用写在一个标签里；用不了的原因跟在后面，整体原因已在结论句说过的不再写（DT-12）。
  const netRow = ({ net, configured, usable, code }: ReturnType<typeof networkView>["states"][number]) => {
    const help = H.networkEnabled;
    const closed = net === CLOSED_NET;
    // 只有确实读到「用户能用」才给绿对勾；读不到的是中性，不给「正常」的信号（DP-65、VS-20）。
    // TRC20 不在 App、H5 当前版本的选择里：写这页的配置和后端实际状态，不写「用户能用」，实际可用也不给绿对勾。
    const tag = closed
      ? !configured ? <StatusTag tone="neutral" icon={CircleMinus}>关闭</StatusTag>
        : usable === undefined ? <StatusTag tone="neutral" icon={CircleDot}>配置开启，实际状态暂未知</StatusTag>
          : usable ? <StatusTag tone="neutral" icon={CircleDot}>开启 · 实际可用</StatusTag>
            : <StatusTag tone="warn" icon={AlertTriangle}>开启 · 现在用不了</StatusTag>
      : !configured ? <StatusTag tone="neutral" icon={CircleMinus}>关闭</StatusTag>
      : usable === undefined ? <StatusTag tone="neutral" icon={CircleDot}>配置开启，实际状态暂未知</StatusTag>
        : usable ? <StatusTag tone="ok">开启 · 用户能用</StatusTag>
          : <StatusTag tone="warn" icon={AlertTriangle}>开启 · 用户现在用不了</StatusTag>;
    // TRC20 开着时只能关、关着时不能开（产品 2026-11-23）：原因常显（OP-126）；实际用不了的原因写在前面，结论句已说过的不再写（DT-12）。
    const reason = closed
      // 结论句只说 App、H5 能选的网络，TRC20 用不了的原因一直写在这一行。
      ? [configured && usable !== true ? networks.reasonOf(code) : undefined,
        configured ? `${TRC20_CLOSED}，只能关闭${usable ? "；旧版本 App 可能仍在用" : ""}` : `${TRC20_CLOSED}，不能开启`].filter(Boolean).join("；")
      : !configured ? undefined
      : usable === false ? (networks.outage && networks.shared ? undefined : networks.reasonOf(code))
        : usable === undefined ? networks.reasonOf(code) : undefined;
    return <ConfigRow key={net} name={`${NET_LABEL[net]} 提现`} explainLabel={`${NET_LABEL[net]} 提现`} what={help.what} when={help.when} where={closed ? "App、H5 当前版本不给用户选 TRC20" : help.where}
      effect={help.effect} note={closed ? TRC20_ROW_NOTE : help.note} value={tag} sub={reason} action={action("network", `${NET_LABEL[net]} 提现`, netKey(net), closed && !p.networkEnabled[net] ? TRC20_CLOSED : undefined)} />;
  };
  const phaseSummary = `${p.currentPhase} · 第 ${p.currentMonth} 月 · 到账审查窗口 ${p.cooldownDays} 天 · 加强合规审查${p.complianceHoldEnabled ? "开启" : "关闭"}`;
  // 三个网络共用后端合规规则；大额门槛未读到时不猜。
  const threshold = p.complianceReviewThresholdUsdt == null ? null : `${p.complianceReviewThresholdUsdt.toLocaleString("en-US", { maximumFractionDigits: 6 })} USDT`;
  const networkRule = threshold === null ? "待核实"
    : !p.complianceHoldEnabled ? "按小额免审和风控审核，不额外等待"
      : p.cooldownDays > 0 ? `全部人工复核，超过 ${threshold} 等 ${p.cooldownDays} 天` : "全部人工复核，不额外等待";

  const drawerIcon: Record<Group, LucideIcon> = { limits: Gauge, network: Network, fee: Network, nex: Network };
  const fieldProps = (key: NumKey) => ({
    item: evaluation?.numbers.find((entry) => entry.spec.key === key),
    value: editing?.draft[key] ?? "",
    showError: !!editing && (editing.attempted || !!editing.touched[key]),
    onChange: (value: string) => setEditing((current) => current && { ...current, draft: { ...current.draft, [key]: value } }),
    onBadInput: (bad: boolean) => setEditing((current) => current && { ...current, bad: { ...current.bad, [key]: bad } }),
    onLeave: () => setEditing((current) => current && { ...current, touched: { ...current.touched, [key]: true } }),
  });

  const drawerBody = editing && evaluation && (() => {
    const { group } = editing;
    if (group === "network") {
      const next = evaluation.next!;
      const view = networks;
      // 几个网络因为同一个原因都用不了时，原因在抽屉顶上说一次，各网络下面只写状态（DT-12）。
      const sharedReason = view.shared && view.blocked.length > 1 ? view.reasonOf(view.shared) : undefined;
      const fields = NETWORKS.map((net) => {
        const changed = next[net] !== p.networkEnabled[net];
        const closed = net === CLOSED_NET;
        const state = view.states.find((item) => item.net === net)!;
        // TRC20 关着时两项都不能选；开着时「开启」是现值，可以选回来，不能从关变开。现状按后端实际状态写。
        const now = closed
          ? !p.networkEnabled[net] ? `现在关闭 · ${TRC20_CLOSED}，不能开启`
            : state.usable === undefined ? `配置开启，实际状态暂未知：${view.reasonOf(state.code)}`
              : state.usable ? "现在开启 · 实际可用，旧版本 App 可能仍在用" : `现在开启 · 用不了：${view.reasonOf(state.code)}`
          : !p.networkEnabled[net] ? "现在关闭"
          : state.usable === undefined ? `配置开启，实际状态暂未知：${view.reasonOf(state.code)}`
            : state.usable ? "现在开启 · 用户能用"
              : sharedReason ? "现在开启 · 用户现在用不了" : `现在开启 · 用户现在用不了：${view.reasonOf(state.code)}`;
        const help = !changed ? undefined
          : next[net] ? "开启要提交审批。打款方没开通的网络，这里开着 App 也不显示。"
            : NET_CLOSE_EFFECT;
        return (
          <div key={net} data-d5-field={netKey(net)}>
            <Field label={<>{NET_LABEL[net]} 提现{changed && <> <DirectionTag loosens={next[net]} /></>}</>}
              help={<><div>{now}</div>{closed && p.networkEnabled[net] && <div>{`${TRC20_CLOSED}，只能关闭`}</div>}{help && <div>{help}</div>}</>}>
              {() => <Segments label={`${NET_LABEL[net]} 提现通道`} value={editing.draft[netKey(net)] ?? "off"}
                items={[{ value: "on", label: "开启", disabled: closed && !p.networkEnabled[net] }, { value: "off", label: "关闭", disabled: closed && !p.networkEnabled[net] }]}
                onChange={(value) => setEditing((current) => current && { ...current, draft: { ...current.draft, [netKey(net)]: value } })} />}
            </Field>
          </div>
        );
      });
      // 关完一个都不剩是能提交的，只提醒一次后果。
      return <>{sharedReason && <Notice tone="neutral">{`${view.blocked.map((item) => NET_LABEL[item.net]).join("、")} 现在用不了：${sharedReason}。`}</Notice>}{fields}{evaluation.allClosed && (
        <Notice tone="warn">{evaluation.closedNote}</Notice>
      )}</>;
    }
    if (group === "limits") return <>
      <D5NumberField {...fieldProps("dailyLimitCount")} aria-label="每日提现次数目标值" />
      <D5NumberField {...fieldProps("maxBalanceRatio")} aria-label="余额可提上限目标值" />
      <D5NumberField {...fieldProps("minUsdt")} aria-label="最低提现额目标值" />
      <D5NumberField {...fieldProps("smallAmountThresholdUsd")} aria-label="小额免审线目标值" />
      <D5NumberField {...fieldProps("payoutSlaHours")} aria-label="到账时效目标值" />
      {ADDRESS_PROTECTION_FIELDS.map((key) => (
        <D5NumberField key={key} {...fieldProps(key)} aria-label={`${SPECS[key].label}目标值`} />
      ))}
    </>;
    if (group === "fee") return <>
      <D5NumberField {...fieldProps("fee.trc20")} aria-label="TRC20 网络确认费目标值" />
      <D5NumberField {...fieldProps("fee.bep20")} aria-label="BEP20 网络确认费目标值" />
      <D5NumberField {...fieldProps("fee.erc20")} aria-label="ERC20 网络确认费目标值" />
    </>;
    return <D5NumberField {...fieldProps("nexFeeOffsetRate")} aria-label="UVT 抵扣率目标值" />;
  })();

  const submitBlock = editing && evaluation && (
    tightenPending.length ? TIGHTEN_LOCK
      : evaluation.changedCount === 0 ? "没有改动"
        : evaluation.issues ? `有 ${evaluation.issues} 项要修改`
          : evaluation.loosens && loosenBlock ? loosenBlock
            : undefined);
  const feeDefaultBlock = editing?.group === "fee" ? (
    OPEN_NETS.every((net) => Number(editing.draft[`fee.${net}`]) === D5_NETWORK_CONFIRM_FEE_DEFAULT[net]) && !editing.bad["fee.bep20"] && !editing.bad["fee.erc20"]
      ? "已经是默认值"
      : loosenBlock && OPEN_NETS.some((net) => D5_NETWORK_CONFIRM_FEE_DEFAULT[net] < p.networkConfirmFeeUsd[net]) ? `默认值比现在低，算放宽。${loosenBlock}` : undefined
  ) : undefined;
  // 底部：方向和生效方式分开两个标签，放宽和字段旁一样是橙色开锁，生效方式是蓝色（VS-103、DT-13）。
  // 说明图标放进同一行的标签后面，窄屏不单独掉到下一行。
  const directionMark = <Explain label="这些操作会怎样" side="top"
    content="放宽在提交和批准时各查一次兑付覆盖率，低于红线或读不到可靠结果都会被拒。收紧不查，提交后立即生效。" />;
  const directionNote = evaluation && evaluation.changedCount > 0 && !evaluation.issues && (
    evaluation.loosens && loosenBlock
      ? <>{loosenBlock}{directionMark}</>
      : <span className="rd-toolbar">已改 {evaluation.changedCount} 项{evaluation.loosens
        ? <><StatusTag tone="warn" icon={LockOpen}>含放宽</StatusTag><StatusTag tone="progress" filled icon={CalendarClock}>批准后生效</StatusTag></>
        : <StatusTag tone="progress" filled icon={Zap}>立即生效</StatusTag>}{directionMark}</span>
  );

  return (
    <>
      {header}
      {pendingNotices}
      {conclusion}
      {secondary}

      <div className="rd-config-layout">
        <div className="rd-config-grid">
          <div className="rd-config-rail">
            <SectionNav label="本页分组" items={sections} nav={nav} />
          </div>

          <div className="rd-config-groups">
            <div id={nav.anchor("limits")}>
              <Panel title={<span tabIndex={-1} data-section-focus="">额度和时效</span>} explainLabel="额度和时效" icon={Gauge} tone="role-4"
                explain="这一组一起提交。只要有一项放宽，整组提交审批；全部收紧时提交后立即生效。">
                <ConfigList label="额度和时效">
                  {numRow("dailyLimitCount")}
                  {numRow("maxBalanceRatio")}
                  {numRow("minUsdt")}
                  {numRow("smallAmountThresholdUsd")}
                  {numRow("payoutSlaHours")}
                </ConfigList>
                <div className="rd-config-group d5-address-protection">
                  <h3 className="rd-config-group-title">提现地址保护</h3>
                  <ConfigList label="提现地址保护">
                    {ADDRESS_PROTECTION_FIELDS.map(numRow)}
                  </ConfigList>
                </div>
              </Panel>
            </div>

            <div id={nav.anchor("network")}>
              <Panel title={<span tabIndex={-1} data-section-focus="">网络和费用</span>} explainLabel="网络和费用" icon={Network} tone="role-2"
                explain="这一组管用户能用哪些网络、每笔收多少费。三个网络一起改。"
                actions={networks.known && networks.blocked.length > 0 && !networks.outage ? reconLink : undefined}>
                {/* 提现开关关着时用户能不能用已经确定（都用不了），网络都关着时也没有「开启」可说，这两种不再提示读不到。 */}
                <ConfigList label="网络和费用">
                  {networks.states.map(netRow)}
                  <ConfigRow name={H.networkConfirmFeeUsd.label} what={H.networkConfirmFeeUsd.what} when={H.networkConfirmFeeUsd.when} where={H.networkConfirmFeeUsd.where}
                    effect={H.networkConfirmFeeUsd.effect} note={`默认 ${OPEN_NETS.map((net) => `${NET_LABEL[net]} ${usd(D5_NETWORK_CONFIRM_FEE_DEFAULT[net])}`).join("、")}，在调整抽屉里可以恢复默认。TRC20 ${TRC20_CLOSED}，不能改`}
                    value={NETWORKS.map((net) => `${NET_LABEL[net]}\u00a0${usd(p.networkConfirmFeeUsd[net]).replace(" ", "\u00a0")}`).join("、")} action={action("fee", "网络确认费")} />
                  <ConfigRow name={H.nexFeeOffsetRate.label} what={H.nexFeeOffsetRate.what} when={H.nexFeeOffsetRate.when} where={H.nexFeeOffsetRate.where}
                    effect={H.nexFeeOffsetRate.effect} value={SPECS.nexFeeOffsetRate.show(p.nexFeeOffsetRate)} action={action("nex", "UVT 抵扣率")} />
                </ConfigList>
              </Panel>
            </div>

            <div id={nav.anchor("phase")}>
              <Fold title="随运营阶段变化的设置" icon={CalendarRange} tone="role-other" summary={phaseSummary}
                explain="只能查看，修改请到「运营阶段设置」"
                actions={reach("/growth/phase") ? <Link className="rd-link" href="/growth/phase" prefetch={false}>去运营阶段设置 →</Link> : undefined}
                open={phaseOpen} onOpenChange={setPhaseOpen}>
                <ConfigList label="随运营阶段变化的设置">
                  <ConfigRow name={H.currentPhase.label} what={H.currentPhase.what} when={H.currentPhase.when} value={`${p.currentPhase} · 第 ${p.currentMonth} 月`} />
                  <ConfigRow name={H.cooldownDays.label} what={H.cooldownDays.what} when={H.cooldownDays.when} where={H.cooldownDays.where} note={H.cooldownDays.note} value={`${p.cooldownDays} 天`} />
                  <ConfigRow name={H.complianceHoldEnabled.label} what={H.complianceHoldEnabled.what} when={H.complianceHoldEnabled.when} where={H.complianceHoldEnabled.where} note={H.complianceHoldEnabled.note}
                    value={<StatusTag tone={p.complianceHoldEnabled ? "progress" : "neutral"} icon={p.complianceHoldEnabled ? undefined : CircleMinus}>{p.complianceHoldEnabled ? "开启" : "关闭"}</StatusTag>} />
                  <ConfigRow name={H.complianceReviewThresholdUsdt.label} what={H.complianceReviewThresholdUsdt.what} when={H.complianceReviewThresholdUsdt.when} note={threshold === null ? `现在读不到，请刷新或到运营阶段设置核对。${H.complianceReviewThresholdUsdt.note}` : H.complianceReviewThresholdUsdt.note}
                    value={threshold ?? "待核实"} />
                  <ConfigRow name={`BEP20、ERC20 ${H.networkRules.label}`} explainLabel="BEP20、ERC20 现在怎么审" what={H.networkRules.what} when={H.networkRules.when} note={H.networkRules.note} value={networkRule} />
                  <ConfigRow name={`TRC20 ${H.networkRules.label}`} explainLabel="TRC20 现在怎么审" what={H.networkRules.what} when={H.networkRules.when}
                    note={H.networkRules.note} value={networkRule} />
                </ConfigList>
              </Fold>
            </div>

            <nav className="rd-links" aria-label="相关页面">
              <span>相关页面</span>
              {reach("/finance/pool") && <Link className="rd-link" href="/finance/pool" prefetch={false}>资金储备与应付款</Link>}
              {reach("/overview/dual-ledger") && <Link className="rd-link" href="/overview/dual-ledger" prefetch={false}>资金与应付款总览</Link>}
              {reach("/finance/withdrawals") && <Link className="rd-link" href="/finance/withdrawals" prefetch={false}>提现审核</Link>}
              {reach("/platform/audit", "platform_a2_read") && <Link className="rd-link" href="/platform/audit" prefetch={false}>操作记录与审批</Link>}
              {reach("/platform/events") && <Link className="rd-link" href="/platform/events" prefetch={false}>用户行为事件</Link>}
            </nav>
          </div>
        </div>
      </div>

      <Drawer open={!!editing} onClose={askClose} title={editing ? editTitle(GROUP_TITLE[editing.group]) : ""} icon={editing ? drawerIcon[editing.group] : undefined}
        tone={editing?.group === "limits" ? "role-4" : "role-2"} 
        explain={editing && (editing.group === "limits"
          ? "这一组一起提交。只要有一项放宽，整组提交审批，另一位超级管理员批准前当前值不变；全部收紧时提交后立即生效。"
          : editing.group === "network" ? `三个网络一起提交。开启算放宽，要提交审批；只关不开时提交后立即生效。TRC20 ${TRC20_CLOSED}，开着时只能关闭。`
            : editing.group === "fee" ? `三个网络一起保存。任一网络调低，三个一起走审批。TRC20 ${TRC20_CLOSED}，保持现在的值。`
              : "调高算放宽，要提交审批；调低提交后立即生效。")}
        footer={editing && <Decision note={directionNote || undefined}
          others={editing.group === "fee" && <Button disabledReason={feeDefaultBlock}
            onClick={() => setEditing((current) => current && { ...current, bad: {}, draft: { ...current.draft, ...Object.fromEntries(OPEN_NETS.map((net) => [`fee.${net}`, String(D5_NETWORK_CONFIRM_FEE_DEFAULT[net])])) } })}>恢复默认</Button>}
          primary={<Button variant="primary" disabledReason={submitBlock || undefined}
            onBlockedClick={() => setEditing((current) => current && { ...current, attempted: true })} onClick={confirmEdit}>提交修改</Button>} />}>
        {editing?.conflict && <Notice tone="warn">{editing.conflict}</Notice>}
        {drawerBody}
      </Drawer>

      {leaveAsk && (
        <Modal title="有未保存的修改" icon={ShieldCheck} onClose={() => setLeaveAsk(false)} footer={<>
          <Button onClick={() => setLeaveAsk(false)}>继续编辑</Button>
          <Button variant="danger-outline" onClick={() => { const then = leaveAsk; closeDrawer(); if (then === "refresh") reloadAll(); }}>{leaveAsk === "refresh" ? "放弃改动并刷新" : "放弃改动"}</Button>
        </>}><p>{leaveAsk === "refresh" ? "刷新会读最新的值，这次填的内容不会保留。" : "关掉后这次填的内容不会保留。"}</p></Modal>
      )}
      {releaseModal}
    </>
  );
}
