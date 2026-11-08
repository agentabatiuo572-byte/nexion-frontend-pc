"use client";

/**
 * USDT 提现参数（配置页，PG-46）。默认只显示名称、值和「调整」，点「调整」打开抽屉整组填写，抽屉提交后才开最终确认（闸门 2 第 37 条）。
 * 命令边界照旧：额度和时效四项一条命令；提现网络、网络确认费、UVT 抵扣率各一条命令。一条命令里有一项放宽，整条走审批。
 * 写权按字段判，没有就不显示「调整」（OP-124）；判断看权限码，不看角色名。
 * 结果未知常显在页面上方：收紧按原操作重试，放宽先查原审批单（OP-92～96）。放宽结果未知只锁放宽，收紧照常（闸门 2 第 04 条）。
 */
import { useReach } from "@/lib/nav/use-reach";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
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
  Explain,
  Field,
  Fold,
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
  isDOutcomeUnknownError,
  updateD5WithdrawalLimits,
  D5_NETWORK_CONFIRM_FEE_DEFAULT,
  type D5OwnedChanges,
  type D5Params as D5ParamData,
} from "@/lib/admin/d-client";
import { fetchA2Overview, isA2OutcomeUncertainError, type A2OperationRow } from "@/lib/admin/a2-client";
import { businessClock, businessZone, formatBusinessTimeFull } from "@/lib/admin/business-time";
import { D5_NETWORK_BLOCK_REASON, D5_NETWORK_BLOCK_UNKNOWN, D5_PARAM_HELP, D5_WITHDRAW_SWITCH_OFF } from "@/lib/admin/config-help/d5-withdrawal";
import { fetchWithdrawalGateOpen } from "@/lib/admin/ops-dashboard-client";
import { createPendingMutationStore, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import {
  configApprovalOriginalInput,
  pendingConfigApproval,
  releaseConfigApproval,
  submitWithdrawalConfigApproval,
  withdrawalApprovalDisabledReason,
} from "@/lib/admin/withdrawal-config-approval";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { DCtx } from "./types";

const OPERATOR = currentAdminOperator;

// 「覆盖率低于红线」按后端译文匹配，在通用文案上再点明这项放宽没生效。
/** 两句中文接在一起：前一句没有句末标点就补「。」，中间不留空格。 */
const sentence = (text: string) => /[。！？.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}。`;

function errorText(err: unknown) {
  const message = err instanceof Error ? err.message : "";
  if (message.includes("覆盖率低于红线")) return "兑付覆盖率低于红线，这项放宽调整未生效";
  return displayAdminError(err);
}

/** 后端拒绝码。D 域请求的 code 运行时是码字符串；审批接口的码在 backendMessage。 */
function rejectionCode(err: unknown) {
  if (err instanceof DRequestError) return String(err.code ?? "");
  if (err instanceof Error && "backendMessage" in err) return String((err as Error & { backendMessage?: unknown }).backendMessage ?? "");
  return "";
}

/**
 * 后端明确拒绝了这次请求：有 4xx 状态和拒绝码。只有这种才能丢号、才能给「解除待确认」。
 * 本地出错、读不懂、存不下、网络断开都说明不了原命令的结果，原命令留着（OP-93、OP-153）。
 */
function explicitRejection(err: unknown) {
  if (isDOutcomeUnknownError(err) || isA2OutcomeUncertainError(err)) return false;
  if (err instanceof DRequestError) return err.status >= 400 && err.status < 500 && err.code !== undefined;
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500 && !!rejectionCode(err);
}

const NETWORKS = ["trc20", "bep20", "erc20"] as const;
type Net = (typeof NETWORKS)[number];
const NET_LABEL: Record<Net, string> = { trc20: "TRC20", bep20: "BEP20", erc20: "ERC20" };

/** 不舍入，只去掉浮点尾巴：0.57 写 57%，不写 56.99999999999999%。 */
const clean = (value: number) => Number(value.toPrecision(12));
const num = (value: number) => clean(value).toLocaleString("en-US", { maximumFractionDigits: 12 });
const usd = (value: number) => `${num(value)} USD`;
const pct = (value: number) => `${value.toFixed(1)}%`;

type Group = "limits" | "network" | "fee" | "nex";
type NumKey = "dailyLimitCount" | "maxBalanceRatio" | "smallAmountThresholdUsd" | "payoutSlaHours" | "nexFeeOffsetRate" | `fee.${Net}`;

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
  unit: "USD",
  min: 0,
  max: 25,
  step: 0.5,
  invalid: `${NET_LABEL[net]} 须在 0–25 之间，每档 0.5，例如 1 或 1.5`,
  range: "0–25 USD，每档 0.5",
  valid: (value) => value >= 0 && value <= 25 && Number.isInteger(value * 2),
  loosen: "down",
  tightest: 25,
  current: (p) => p.networkConfirmFeeUsd[net],
  show: usd,
  how: `0–25 USD，每档 0.5，默认 ${D5_NETWORK_CONFIRM_FEE_DEFAULT[net]} USD`,
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
  smallAmountThresholdUsd: {
    key: "smallAmountThresholdUsd",
    label: D5_PARAM_HELP.smallAmountThresholdUsd.label,
    unit: "USD",
    min: 0,
    max: 500,
    step: "any",
    invalid: "小额免审线要在 0–500 USD 之间。",
    range: "0–500 USD，0 表示关闭",
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
  nexFeeOffsetRate: {
    key: "nexFeeOffsetRate",
    label: D5_PARAM_HELP.nexFeeOffsetRate.label,
    unit: "USD / UVT",
    min: 0.000001,
    max: 999999999999.999999,
    step: "any",
    invalid: "UVT 抵扣率超出允许范围，最小 0.000001。",
    range: "最小 0.000001",
    valid: (value) => value >= 0.000001 && value <= 999999999999.999999,
    loosen: "up",
    tightest: 0.000001,
    current: (p) => p.nexFeeOffsetRate,
    show: (value) => `${num(value)} USD / UVT`,
    how: D5_PARAM_HELP.nexFeeOffsetRate.how,
    // 后端按整数 UVT 向上取整（AppWithdrawalService.submitOnce）。
    whatIf: (value) => `改成 ${num(value)}：1 USD 手续费要 ${Math.ceil(clean(1 / value))} UVT 抵满。`,
    authority: FEE_WRITE,
  },
  "fee.trc20": feeSpec("trc20"),
  "fee.bep20": feeSpec("bep20"),
  "fee.erc20": feeSpec("erc20"),
};

const GROUP_FIELDS: Record<Exclude<Group, "network">, readonly NumKey[]> = {
  limits: ["dailyLimitCount", "maxBalanceRatio", "smallAmountThresholdUsd", "payoutSlaHours"],
  fee: ["fee.trc20", "fee.bep20", "fee.erc20"],
  nex: ["nexFeeOffsetRate"],
};
const GROUP_TITLE: Record<Group, string> = { limits: "额度和时效", network: "提现网络", fee: "网络确认费", nex: "UVT 抵扣率" };
const GROUP_IMPACT: Record<Group, string> = {
  limits: "下一笔提现起按新值；调低每日次数时，当天超过新次数、还没放行的单放行时也被拦",
  network: "关掉的网络用户不能再发起提现；接打款服务时，这个网络上还没交给打款服务的提现也会暂停打款",
  fee: "之后的新提现按新费用收，已提交的提现不变",
  nex: "之后的新提现按新抵扣率算，已提交的提现不变",
};

const netKey = (net: Net) => `net.${net}`;
/** 关完之后一个网络都不开：抽屉和最终确认说同一句（DP-03）。 */
const NET_LAST_OPEN = "这是最后一条开着的网络，关掉后用户不能发起 USDT 提现。";
const NET_ALL_CLOSED = "提交后三个网络都关着，用户不能发起 USDT 提现。";
const NET_PAUSE = "接打款服务时，关掉的网络上还没交给打款服务的提现也会暂停打款。";
const NET_CLOSE_EFFECT = "关掉后用户不能再用这个网络发起提现。接打款服务时，这个网络上已提交、还没交给打款服务的提现也会暂停打款；已交给打款服务的继续查询核对。";
/**
 * 提现网络的实际状态（后端 networkStatus，和 App 提现用同一个判断）。旧后端没有这两个字段时 known 为 false，
 * 只能说配置，不说用户能不能用。开着的网络都用不了且原因相同时，合成一句话（出款服务没接通这类整体原因）。
 */
type WithdrawGate = "open" | "closed" | "unknown" | null;
const J1_CODE = "WITHDRAW_SWITCH_OFF";

function networkView(p: D5ParamData, gate: WithdrawGate) {
  // App 先看「紧急停用开关」的提现开关，关着就一个网络都不给（AppWithdrawalService.withdrawGateEnabled），再看网络本身。
  const known = !!p.networkStatus && !!p.effectiveNetworks;
  const states = NETWORKS.map((net) => {
    const row = p.networkStatus?.find((item) => item.network === `USDT-${NET_LABEL[net]}`);
    const configured = row?.configured ?? p.networkEnabled[net];
    // 提现开关关着，开着的网络用户都用不了，先说这个原因；开关开着再看网络本身。
    const usable: boolean | undefined = gate === "closed" ? false : !row ? undefined : !row.enabled ? false : gate === "open" ? true : undefined;
    const code = gate === "closed" ? J1_CODE : row && !row.enabled ? row.disabledReason : null;
    return { net, configured, usable, code, networkOk: row?.enabled };
  });
  const open = states.filter((item) => item.configured);
  const blocked = open.filter((item) => item.usable === false);
  const reasonOf = (code: string | null) => code === J1_CODE ? D5_WITHDRAW_SWITCH_OFF : (code && D5_NETWORK_BLOCK_REASON[code]?.text) || D5_NETWORK_BLOCK_UNKNOWN;
  const shared = blocked.length > 0 && blocked.length === open.length && blocked.every((item) => item.code === blocked[0].code) ? blocked[0].code : undefined;
  const names = (list: typeof states) => list.map((item) => NET_LABEL[item.net]).join("、");
  // 用户一个网络都用不了：配置全关，提现开关关着，或开着的都被挡住。
  const byConfig = open.length === 0;
  const outage = byConfig ? "三个网络都在这页关着"
    : gate === "closed" ? D5_WITHDRAW_SWITCH_OFF
      : known && p.effectiveNetworks!.length === 0
        ? shared ? `开着的 ${names(open)} 都用不了：${reasonOf(shared)}` : `开着的 ${names(open)} 都用不了，原因写在各网络那一行`
        : undefined;
  // 开着的网络本身能用，只差提现开关读不到：用户能不能用写「—」，不猜（F02）。
  const gateUnknown = known && open.some((item) => item.networkOk) && gate === "unknown";
  return { known, states, blocked, shared, outage, byConfig, gateUnknown, reasonOf };
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

function draftOf(group: Group, p: D5ParamData): Draft {
  if (group === "network") return Object.fromEntries(NETWORKS.map((net) => [netKey(net), p.networkEnabled[net] ? "on" : "off"]));
  return Object.fromEntries(GROUP_FIELDS[group].map((key) => [key, String(SPECS[key].current(p))]));
}

type NumEval = { spec: NumSpec; text: string; now: number; value?: number; error?: string; changed: boolean; loosens: boolean; writable: boolean };

/** 一条命令的草稿算出来的东西：每项的对错和方向、要提交的改动、前后值。 */
function evaluate(editing: Editing, p: D5ParamData, can: (authority: string) => boolean) {
  const { group, draft, bad } = editing;
  if (group === "network") {
    const next = Object.fromEntries(NETWORKS.map((net) => [net, draft[netKey(net)] === "on"])) as Record<Net, boolean>;
    const changedNets = NETWORKS.filter((net) => next[net] !== p.networkEnabled[net]);
    const allClosed = NETWORKS.every((net) => !next[net]);
    const closing = changedNets.filter((net) => !next[net]);
    const lastClosed = closing[closing.length - 1];
    const rows: DiffRow[] = NETWORKS.map((net) => ({
      key: net,
      label: `${NET_LABEL[net]} 提现`,
      before: p.networkEnabled[net] ? "开启" : "关闭",
      after: next[net] ? "开启" : "关闭",
      // 关网络的后果写在最后一个关掉的网络下面，确认框里看得到（DP-03、VS-103）：关完一个不剩时先说这句，再说没打出的单会暂停。
      note: net === lastClosed ? `${allClosed ? `${changedNets.length === 1 ? NET_LAST_OPEN : NET_ALL_CLOSED}` : ""}${NET_PAUSE}` : undefined,
    }));
    return {
      numbers: [] as NumEval[],
      next,
      changedCount: changedNets.length,
      issues: 0,
      loosens: changedNets.some((net) => next[net]),
      closesOnly: changedNets.length > 0 && changedNets.every((net) => !next[net]),
      allClosed,
      rows,
      changes: changedNets.length ? { networkEnabled: next } as D5OwnedChanges : null,
    };
  }
  const numbers = GROUP_FIELDS[group].map((key): NumEval => {
    const spec = SPECS[key];
    const text = draft[key] ?? "";
    const writable = can(spec.authority);
    const now = spec.current(p);
    if (!writable) return { spec, text, now, value: now, changed: false, loosens: false, writable };
    if (bad[key]) return { spec, text, now, error: spec.invalid, changed: true, loosens: false, writable };
    if (text.trim() === "") return { spec, text, now, error: `填写${spec.label}：${spec.range}，空着不算 0。`, changed: true, loosens: false, writable };
    const value = Number(text);
    if (!Number.isFinite(value) || !spec.valid(value)) return { spec, text, now, error: spec.invalid, changed: true, loosens: false, writable };
    const changed = clean(value) !== clean(now);
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
        else if (item.spec.key === "smallAmountThresholdUsd") changes.smallAmountThresholdUsd = item.value!;
        else if (item.spec.key === "payoutSlaHours") changes.payoutSlaHours = item.value!;
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
    rows,
    changes,
  };
}

/** 一组改动写成一句话：待确认条上看得懂发出去的是什么。 */
function describeChanges(changes: Record<string, unknown>) {
  const parts: string[] = [];
  const n = (value: unknown) => Number(value);
  if (changes.dailyLimitCount !== undefined) parts.push(`每日提现次数 ${n(changes.dailyLimitCount)} 次`);
  const ratio = changes.maxBalanceRatio ?? changes.balanceMaxRatio;
  if (ratio !== undefined) parts.push(`余额可提上限 ${num(n(ratio) * 100)}%`);
  if (changes.smallAmountThresholdUsd !== undefined) parts.push(`小额免审线 ${usd(n(changes.smallAmountThresholdUsd))}`);
  if (changes.payoutSlaHours !== undefined) parts.push(`到账时效 ${n(changes.payoutSlaHours)} 小时`);
  const fees = changes.networkConfirmFeeUsd as Record<Net, unknown> | undefined;
  if (fees) parts.push(`网络确认费 ${NETWORKS.map((net) => `${NET_LABEL[net]} ${usd(n(fees[net]))}`).join("、")}`);
  const enabled = changes.networkEnabled as Record<Net, unknown> | undefined;
  if (enabled) parts.push(`提现网络 ${NETWORKS.map((net) => `${NET_LABEL[net]} ${enabled[net] ? "开启" : "关闭"}`).join("、")}`);
  if (changes.nexFeeOffsetRate !== undefined) parts.push(`UVT 抵扣率 ${num(n(changes.nexFeeOffsetRate))} USD / UVT`);
  return parts.join("；") || "提现参数";
}

/** 收紧（直接生效）的原操作。结果未知时原样保存，重试只能发这一份（OP-92、OP-94）。版本可能已变，确认前整页不能再改。 */
type TightenRecord = PendingMutationRecord & { label: string; changes: D5OwnedChanges; expectedVersion: number; reason: string; operator: string };
const TIGHTEN_SCOPE = "d5|limits";
const tightenCommands = createPendingMutationStore<TightenRecord>({
  storageKey: "nexion-admin-d5-withdrawal-commands-v1",
  // 过了 24 小时不能再用原号重试，记录和锁都留着，到操作记录核对（OP-96）。
  retainExpiredRecords: true,
  isValidRecord: (record) => typeof record.label === "string" && record.label.length > 0
    && typeof record.reason === "string" && record.reason.length > 0
    && typeof record.operator === "string"
    && Number.isSafeInteger(record.expectedVersion)
    && !!record.changes && typeof record.changes === "object" && !Array.isArray(record.changes),
});

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
    if (["dailyLimitCount", "smallAmountThresholdUsd", "payoutSlaHours"].includes(key)) need.add(DAILY_WRITE);
    else if (["maxBalanceRatio", "balanceMaxRatio"].includes(key)) need.add(BALANCE_WRITE);
    else if (["networkConfirmFeeUsd", "networkEnabled", "nexFeeOffsetRate"].includes(key)) need.add(FEE_WRITE);
  }
  return [...need];
}

/** 解除框要解除的是哪一条：只是弹窗的对象，原命令还在各自的持久记录里。 */
type ReleaseTarget = { label: string; slot: string; commandKey: string; loosen: boolean };

const UNKNOWN_TOAST = "结果未确认，不要重复操作。到页面上方核对。";
const TIGHTEN_LOCK = "这页有修改的结果没确认，先到上方核对";
const NO_WRITE = "这个账号已没有这项权限，请有权限的同事处理";
const NETWORK_RULE = "用户能不能用和 App 提现是同一个判断：「紧急停用开关」的提现开关开着，这页的开关开着，出款服务接通；接打款服务时还要全局出款总闸开着、打款服务开通了这个网络、最近完成过完整对账、没有没处理的资金风险。";
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
  // 待批总览要 A2 读权；按命令号查自己发起的原单，发起审批权也行（后端 A2AccessPolicy、WithdrawalConfigApproval.canReadOwnProposal）。
  const canQuery = can("platform_a2_read");
  const canLookupOwn = canQuery || can("platform_a2_proposal_create");
  const proposeBlock = withdrawalApprovalDisabledReason(authorities);

  const [params, setParams] = useState<D5ParamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readAt, setReadAt] = useState("");
  const requestId = useRef(0);
  const [approvals, setApprovals] = useState<{ state: "loading" | "ready" | "failed"; rows: A2OperationRow[] }>({ state: "loading", rows: [] });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [leaveAsk, setLeaveAsk] = useState<false | "close" | "refresh">(false);
  const [withdrawGate, setWithdrawGate] = useState<WithdrawGate>(null);
  const [phaseOpen, setPhaseOpen] = useState(false);
  const [tightenPending, setTightenPending] = useState<TightenRecord[]>([]);
  const [loosenPending, setLoosenPending] = useState<ReturnType<typeof pendingConfigApproval>>(undefined);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [retryRejected, setRetryRejected] = useState<string[]>([]);
  const [queryMissing, setQueryMissing] = useState<string[]>([]);
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
  const load = useCallback(async () => {
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
    } catch (err) {
      if (id === requestId.current) setError(errorText(err));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  /** 有没有放宽在等批准。读不到时不说「没有」（决定 5）。审批单的 operationCode 是空的，按动作名认。 */
  const loadApprovals = useCallback(async () => {
    if (!canQuery) return;
    setApprovals((current) => ({ ...current, state: "loading" }));
    try {
      const overview = await fetchA2Overview({ domain: "D" });
      setApprovals({ state: "ready", rows: overview.operationQueue.filter((row) => row.status === "pending" && row.action === "放宽提现参数") });
    } catch {
      setApprovals({ state: "failed", rows: [] });
    }
  }, [canQuery]);

  /** 「紧急停用开关」的提现开关。登录的账号都能读这份摘要，不多要 J1 权限（同提现审核页）。读不到写 unknown。 */
  const loadGate = useCallback(async () => {
    setWithdrawGate(null);
    try {
      setWithdrawGate(await fetchWithdrawalGateOpen() ? "open" : "closed");
    } catch {
      setWithdrawGate("unknown");
    }
  }, []);

  useEffect(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [load]);
  useEffect(() => { void loadGate(); }, [loadGate]);
  useEffect(() => { void loadApprovals(); }, [loadApprovals]);
  useEffect(() => syncPending(), [syncPending]);

  const reloadAll = () => {
    void load();
    void loadApprovals();
    void loadGate();
  };

  const coverageBlock = params && (!params.coverageReliable
    ? "放宽已暂停：兑付覆盖率暂时读不到可靠结果"
    : params.coverageRatio < params.redlinePct
      ? `放宽已暂停：兑付覆盖率 ${pct(params.coverageRatio)}，低于红线 ${fmtConfigPct(params.redlinePct)}`
      : undefined);
  const pendingApproval = approvals.state === "ready" ? approvals.rows : [];
  /** 放宽现在为什么提交不了，从上往下取第一条。 */
  const loosenBlock = proposeBlock
    ?? (loosenPending ? "上一次放宽的结果没确认，先到上方核对" : undefined)
    ?? (pendingApproval.length ? "已有放宽等批准，批准、驳回或撤回后才能再提交" : undefined)
    ?? coverageBlock
    ?? undefined;

  const groupWritable = (group: Group) => group === "limits" ? canDailyWrite || canBalanceWrite : canFeeWrite;
  /** 这一组已经收到最紧：放宽被挡时打开也改不了，入口直接禁用（OP-126）。 */
  const atTightest = (group: Group, p: D5ParamData) => {
    if (group === "network") return NETWORKS.every((net) => !p.networkEnabled[net]);
    return GROUP_FIELDS[group].filter((key) => can(SPECS[key].authority)).every((key) => clean(SPECS[key].current(p)) === clean(SPECS[key].tightest));
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
      const draft = Object.fromEntries(Object.entries(current.draft).map(([key, value]) => [key, value === before[key] ? after[key] : value]));
      const moved = evaluate({ ...current, draft: after }, current.base, () => true).rows.filter((row) => row.before !== row.after);
      return {
        ...current,
        draft,
        base: latest,
        conflict: moved.length
          ? <>别人刚改过：{moved.map((row) => `${row.label} ${row.before} → ${row.after}`).join("；")}。你改的项还在，其余已换成最新值，核对后重新提交。</>
          : <>别人刚改过提现参数的其他项，版本已更新。核对后重新提交。</>,
      };
    });
  };

  /** 收紧走这里：先存原操作再发（OP-92）。明确失败丢号留在框里；结果未知保号，转成页面上方的待确认（OP-93）。 */
  const sendTighten = async (record: Omit<TightenRecord, keyof PendingMutationRecord>, retry = false) => {
    const retained = tightenCommands.get(TIGHTEN_SCOPE);
    if (retained && !retry) throw new Error(TIGHTEN_LOCK);
    const key = retained ?? tightenKey();
    tightenCommands.remember(TIGHTEN_SCOPE, key, record);
    if (!tightenCommands.isDurablyStored(TIGHTEN_SCOPE, key)) {
      if (!retained) tightenCommands.forget(TIGHTEN_SCOPE, key);
      throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
    try {
      const next = await updateD5WithdrawalLimits(record.changes, record.expectedVersion, record.reason, record.operator, key);
      tightenCommands.forget(TIGHTEN_SCOPE);
      syncPending();
      applySnapshot(next);
      return "done" as const;
    } catch (cause) {
      // 只有后端明确拒绝才丢号；读不懂、断开、本地出错都按结果未知留着（F03）。
      const rejected = explicitRejection(cause);
      if (rejected && !retained) tightenCommands.forget(TIGHTEN_SCOPE);
      syncPending();
      if (!rejected) return "unknown" as const;
      throw cause;
    }
  };

  /** 抽屉「提交修改」：方向已经定了，最终确认只填理由。 */
  const confirmEdit = () => {
    if (!editing || !params || !session || !evaluation?.changes) return;
    const { group } = editing;
    const changes = evaluation.changes;
    const loosens = evaluation.loosens;
    const restoreDefault = group === "fee" && NETWORKS.every((net) => Number(editing.draft[`fee.${net}`]) === D5_NETWORK_CONFIRM_FEE_DEFAULT[net]);
    const label = restoreDefault ? "网络确认费恢复默认" : GROUP_TITLE[group];
    const open = (p: D5ParamData, blockedReason?: ReactNode) => openActionConfirm({
      briefKind: "config",
      action: `调整提现参数 · ${label}`,
      title: editTitle(GROUP_TITLE[group]),
      detail: <>版本 v{p.version}。提交时带上这个版本，别人先改了这次不会生效。</>,
      // 等批准的提醒跟在前后值后面，同一块里看（有放宽在等时才有）。
      facts: <>
        <DiffList rows={evaluation.rows} restTitle="没改的项" />
        {!loosens && pendingApproval.length > 0 && <Notice tone="warn">有放宽在等批准，收紧后那张审批单要重新发起。</Notice>}
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
      completionCopy: loosens ? "另一位超管批准前，当前配置保持不变。" : "提交后立即生效。",
      statedBrief: { impact: GROUP_IMPACT[group], check: "核对改了哪几项和方向，理由写清调整原因和依据。" },
      blockedReason: blockedReason ?? (loosens ? proposeBlock : undefined),
      run: async (reason) => {
        try {
          if (loosens) {
            const result = await submitWithdrawalConfigApproval("D5", session, d5WithdrawalLimitsValues(changes, p.version), reason, fetchD5WithdrawalParams);
            syncPending();
            if (result) {
              applySnapshot(result.active);
              toast(result.acknowledgement, "success");
            }
            closeDrawer();
            void loadApprovals();
            return;
          }
          const outcome = await sendTighten({ label: `调整提现参数 · ${label}`, changes, expectedVersion: p.version, reason, operator: OPERATOR() });
          closeDrawer();
          if (outcome === "unknown") toast(UNKNOWN_TOAST, "warn");
          else toast(`${GROUP_TITLE[group]}已生效`, "success");
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
    if (record.expiresAt <= Date.now()) { syncPending(); return; }
    if (!commandAuthorities(record.changes).every(can)) { note(record.commandKey, NO_WRITE); return; }
    // 要在 list() 之前查：list() 会从内存副本恢复已删除的记录，那样就成了换号重发。
    if (!tightenCommands.isDurablyStored(record.fingerprint, record.commandKey)) {
      note(record.commandKey, "浏览器里查不到这条记录，本次没有发送。待确认继续保留，请到操作记录与审批核对。");
      return;
    }
    setRetryRejected((current) => current.filter((key) => key !== record.commandKey));
    note(record.commandKey, "");
    setRecovering(record.commandKey);
    try {
      const { label, changes, expectedVersion, reason, operator } = record;
      const outcome = await sendTighten({ label, changes, expectedVersion, reason, operator }, true);
      if (outcome === "unknown") note(record.commandKey, "重试的结果也没确认，原操作继续保留。稍后再试。");
      else toast(`${record.label.replace(/^调整提现参数 · /, "")}已生效`, "success");
    } catch (cause) {
      // 后端明确拒绝了这次重试才给「解除待确认」；本地出错不算（F03）。
      if (explicitRejection(cause)) {
        note(record.commandKey, `重试被拒绝：${sentence(errorText(cause))}这说明不了原操作的结果，原操作继续保留。`);
        setRetryRejected((current) => [...current, record.commandKey]);
      } else {
        note(record.commandKey, `重试没有完成：${sentence(errorText(cause))}结果还是没确认，原操作继续保留。`);
      }
    } finally {
      setRecovering("");
    }
  };

  /** 放宽的原审批单：查询或原样重试都走同一个命令号。查到就回读并清掉记录（OP-95）。 */
  const recoverLoosen = async (mode: "lookup" | "retry") => {
    if (!session || !loosenPending) return;
    const key = loosenPending.commandKey;
    note(key, "");
    setRecovering(key);
    try {
      const result = await submitWithdrawalConfigApproval("D5", session, null, "", fetchD5WithdrawalParams, mode === "lookup" ? true : "retry-original");
      syncPending();
      if (!result) {
        setQueryMissing((current) => [...current, key]);
        note(key, "暂未查到原审批单，可稍后再查，或按原配置和理由重试。");
        return;
      }
      applySnapshot(result.active);
      toast(result.acknowledgement, "success");
      void loadApprovals();
    } catch (cause) {
      syncPending();
      const kept = !!(session && pendingConfigApproval("D5", session.adminId));
      if (isA2OutcomeUncertainError(cause)) {
        // 原因写在括号里；只取中文说明，码不上屏。
        const detail = cause.message.match(/（([^（）]*[\u4e00-\u9fa5][^（）]*)）$/)?.[1];
        note(key, `${detail ? sentence(detail) : ""}结果还是没确认，原操作继续保留。`);
      }
      else if (!kept) toast(`重试被拒绝：${sentence(errorText(cause))}原审批命令已清除，可以重新发起。`, "warn");
      else if (mode === "retry" && explicitRejection(cause)) {
        note(key, `重试被拒绝：${sentence(errorText(cause))}这说明不了原操作的结果，原操作继续保留。`);
        setRetryRejected((current) => [...current, key]);
      } else {
        note(key, `${mode === "retry" ? "重试" : "查询"}没有完成：${sentence(errorText(cause))}结果还是没确认，原操作继续保留。`);
      }
    } finally {
      setRecovering("");
    }
  };

  /** 重试被拒后，人核实过原操作的结果才解除。只放开本页的锁，不发请求，不写操作记录。 */
  const releasePending = (record: ReleaseTarget) => {
    if (record.loosen) { if (session) releaseConfigApproval("D5", session.adminId, record.commandKey); }
    else tightenCommands.forget(record.slot, record.commandKey);
    syncPending();
    setReleasing(null);
    toast(record.loosen ? "已解除待确认，可以重新提交放宽" : "已解除待确认，这页可以重新修改", "success");
  };

  const auditHref = "/platform/audit";
  const auditLink = reach(auditHref, "platform_a2_read") && <> <Link className="rd-link" href="/platform/audit?domain=D&object=current" prefetch={false}>到操作记录与审批核对</Link></>;
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
  const pendingNotices = <>
    {loosenRecord && (() => {
      const key = loosenRecord.commandKey;
      const expired = loosenRecord.expiresAt <= Date.now();
      const needQuery = canLookupOwn && !queryMissing.includes(key);
      const canRetry = !!loosenRecord.values && commandAuthorities(loosenRecord.values).every(can) && !proposeBlock;
      return (
        <Notice tone="warn" title="放宽提现参数 · 结果未确认" action={<>
          {canLookupOwn && <Button size="sm" disabled={!!recovering} onClick={() => void recoverLoosen("lookup")}>查询原操作</Button>}
          {!expired && <Button size="sm" disabled={!!recovering}
            disabledReason={!canRetry ? NO_WRITE : needQuery ? "先查原审批单，明确查不到才能重试" : undefined}
            onClick={() => void recoverLoosen("retry")}>按原操作重试</Button>}
          {!expired && retryRejected.includes(key) && <Button size="sm" disabled={!!recovering}
            onClick={() => setReleasing({ label: "放宽提现参数", slot: loosenRecord.fingerprint, commandKey: key, loosen: true })}>解除待确认</Button>}
        </>}>
          {`${formatBusinessTimeFull(new Date(loosenRecord.createdAt).toISOString(), "—")}（${zone}）发出：${loosenRecord.values ? describeChanges(loosenRecord.values) : "原内容读不到"}。审批单可能已经提交，批准前当前值不变。结果确认前不能再提交放宽，收紧照常。`}
          {expired ? `${RETRY_EXPIRED_TEXT}。` : !canLookupOwn ? "这个账号查不了原审批单，重发原内容，已提交的不会重复提交。" : "先查原审批单，查不到再按原操作重试。"}
          {auditLink}
          <Explain label="技术信息" content={`命令号 ${key}${loosenRecord.reason ? ` ｜ 理由 ${loosenRecord.reason}` : ""}`} />
          {notes[key] && <div>{notes[key]}</div>}
        </Notice>
      );
    })()}
    {tightenPending.map((record) => {
      const expired = record.expiresAt <= Date.now();
      return (
        <Notice key={record.commandKey} tone="warn" title={`${editTitle(record.label.replace(/^调整提现参数 · /, ""))} · 结果未确认`} action={<>
          {!expired && <Button size="sm" disabled={!!recovering} disabledReason={commandAuthorities(record.changes).every(can) ? undefined : NO_WRITE} onClick={() => void retryTighten(record)}>按原操作重试</Button>}
          {retryRejected.includes(record.commandKey) && <Button size="sm" disabled={!!recovering} onClick={() => setReleasing({ label: record.label, slot: record.fingerprint, commandKey: record.commandKey, loosen: false })}>解除待确认</Button>}
        </>}>
          {`${formatBusinessTimeFull(new Date(record.createdAt).toISOString(), "—")}（${zone}）发出：${describeChanges(record.changes)}。可能已经生效，确认前这页不能再修改。`}
          {expired ? `${RETRY_EXPIRED_TEXT}。` : "用同一命令号重新发送，不会重复生效。"}
          {auditLink}
          <Explain label="技术信息" content={`命令号 ${record.commandKey} ｜ 版本 v${record.expectedVersion} ｜ 理由 ${record.reason}`} />
          {notes[record.commandKey] && <div>{notes[record.commandKey]}</div>}
        </Notice>
      );
    })}
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
          <li>{canQuery ? "能看到有没有放宽在等批准。" : "看不到放宽有没有在等批准，提交时被拒才知道，进度到操作记录与审批问有权限的同事。"}{!canQuery && canLookupOwn && "自己发起的放宽结果没确认时，能按原命令号查原审批单。"}</li>
        </ul>
      ) : <p>你只能查看，修改要有这页的修改权限。</p>}
      <h3>以前页头的说明</h3>
      <p>「设置每日提现次数、可提比例、网络费、UVT 抵扣、小额免审和到账时限。放宽限制前先看兑付覆盖率；随运营阶段变化的设置在「运营阶段设置」修改。」</p>
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
          {readAt && params ? `${readAt} 读取（${zone}）· ` : ""}打开时读取
          {params && <> · <Explain label="版本号是什么" content="每改一次参数版本加 1。提交时带上你看到的版本，别人先改了这次就不会生效。">版本 v{params.version}</Explain></>}
        </span>
        <Button variant="ghost" size="sm" loading={loading} icon={<RefreshCw size={14} aria-hidden />} onClick={refresh}>刷新</Button>
      </span>}
      readOnly={!canWriteAny ? "你只能查看；修改提现参数要有这页的修改权限。" : undefined}
    />
  );

  const releaseModal = releasing && (
    <ReleaseModal label={releasing.label} onCancel={() => setReleasing(null)} onConfirm={() => releasePending(releasing)}
      explain="重试被拒说明不了原操作的结果，先到操作记录核对它有没有生效。解除后原操作不再重试，系统仍按现在的版本校验。" />
  );

  const sections: SectionNavItem[] = [
    { id: "limits", label: "额度和时效" },
    { id: "network", label: "网络和费用", alert: !!params && networkView(params, withdrawGate).blocked.length > 0 },
    { id: "phase", label: "运营阶段" },
  ];
  const nav = useSectionNav(sections, { ready: !!params, onReveal: (id) => { if (id === "phase") setPhaseOpen(true); } });

  if (loading && !params) {
    return <>{header}{pendingNotices}<BlockState state="loading" title="提现参数加载中…" />{releaseModal}</>;
  }

  if (!params) {
    return <>
      {header}
      {pendingNotices}
      <BlockState state="error" title="提现参数加载失败" detail={<>提现参数加载失败，旧值已清空，修改已暂停。{error && <> {error.replace(/^提现参数/, "")}</>}</>} onRetry={refresh} />
      {releaseModal}
    </>;
  }

  const p = params;

  // 一句话结论：从上往下取第一条成立的（重构说明 3.2）。比较用接口原值。
  const coverageText = `兑付覆盖率 ${pct(p.coverageRatio)}，红线 ${fmtConfigPct(p.redlinePct)}`;
  // 覆盖率、红线和可不可靠每个状态都留一处读数（D5-V10，F05）：结论句没写的，写在第二行。
  const coverageLine = p.coverageReliable ? `${coverageText}。` : `读到的兑付覆盖率 ${pct(p.coverageRatio)} 不可靠，红线 ${fmtConfigPct(p.redlinePct)}。`;
  const poolHint = reach("/finance/pool") ? <Link className="rd-link" href="/finance/pool" prefetch={false}>去资金储备与应付款核对</Link> : "去资金储备与应付款核对";
  const coverageExplain = COVERAGE_RULE;
  const approvalLine = (row: A2OperationRow) => `审批单 ${row.id} · ${row.operator} · ${row.rawTs ? `${formatBusinessTimeFull(row.rawTs, row.ts)}（${zone}）` : row.ts}提交`;
  const networks = networkView(p, withdrawGate);
  const reconLink = reach("/finance/recon") && <Link className="rd-link" href="/finance/recon" prefetch={false}>去充值与收款对账核对</Link>;
  const j1Link = reach("/emergency/kill-switch", "emergency_j1_read") && <Link className="rd-link" href="/emergency/kill-switch" prefetch={false}>去紧急停用开关</Link>;
  const networkSection = <Link className="rd-link" href="?section=network" prefetch={false} onClick={(event) => { event.preventDefault(); nav.select("network"); }}>网络和费用</Link>;
  // 都用不了的下一步按原因走：这页关的回这页开，提现开关去紧急停用开关，出款侧的去对账页（DP-42）。
  const outageNext = networks.byConfig
    ? (loosenBlock
      ? <>开启算放宽，现在提交不了：{loosenBlock}。</>
      : canFeeWrite ? <>要恢复，在{networkSection}里点那个网络的「调整」开启，开启要审批。</> : <>开启要有提现网络修改权限的同事提交审批。</>)
    : withdrawGate === "closed" ? j1Link || "请有紧急停用开关权限的同事核对。"
      : reconLink;
  const pendingCount = tightenPending.length + (loosenRecord ? 1 : 0);
  const conclusion = tightenPending.length || loosenRecord
    // 大字留给答案：有待确认时结论只说后果，不放大、不再指路（DT-12、DT-21）。
    ? <Conclusion state="warn" hint={coverageLine}>{tightenPending.length ? `${pendingCount} 项修改结果没确认，确认前这页暂停修改` : "1 项放宽结果没确认，确认前暂停放宽，收紧照常"}</Conclusion>
    : coverageBlock
      ? <Conclusion state="danger" lead hint={<>{p.coverageReliable ? "" : `读到 ${pct(p.coverageRatio)}，红线 ${fmtConfigPct(p.redlinePct)}。`}收紧不受影响。{poolHint}</>} explain={coverageExplain}>{coverageBlock}</Conclusion>
      : networks.outage
      ? <Conclusion state="warn" lead hint={<>{networks.outage}。{outageNext} {coverageLine}</>} explain={NETWORK_RULE}>用户现在不能发起 USDT 提现</Conclusion>
      : pendingApproval.length
        ? <Conclusion state="warn" hint={<>{pendingApproval.map(approvalLine).join("；")}。{reach(auditHref, "platform_a2_read") && <><Link className="rd-link" href="/platform/audit?domain=D&object=current" prefetch={false}>到操作记录与审批查看</Link> </>}{coverageLine}</>} explain={APPROVAL_NOTE}>
          有 {pendingApproval.length} 项放宽等批准，批准前当前值不变
        </Conclusion>
        : <Conclusion state="ok" explain={coverageExplain}>
          {canWriteAny ? `${approvals.state === "ready" && networks.known && withdrawGate === "open" && networks.blocked.length === 0 ? "没有要处理的事，" : ""}${proposeBlock ? "" : "放宽可以提交。"}${coverageText}` : coverageText}
        </Conclusion>;
  // 结论句没说到的都用不了、等批准和读不到审批，单独一条（DT-12：同一件事只说一处）。
  const secondary = <>
    {networks.outage && (tightenPending.length || loosenRecord || coverageBlock) && (
      <Notice tone="warn" title="用户现在不能发起 USDT 提现">{networks.outage}。{outageNext}</Notice>
    )}
    {pendingApproval.length > 0 && (tightenPending.length || loosenRecord || coverageBlock || networks.outage) && (
      <Notice tone="warn" title={`有 ${pendingApproval.length} 项放宽等批准`}>{pendingApproval.map(approvalLine).join("；")}。批准前当前值不变。{auditLink}</Notice>
    )}
    {canQuery && approvals.state === "failed" && (
      <Notice tone="neutral" title="审批状态暂时读不到">有没有放宽在等批准现在不知道，到操作记录与审批核对。{auditLink}</Notice>
    )}
  </>;

  const action = (group: Group, label: string, focus?: string) => groupWritable(group)
    ? (describedBy: string | undefined) => <Button size="sm" aria-label={editTitle(label)} aria-describedby={describedBy} disabledReason={entryBlock(group, p)} onClick={() => openDrawer(group, focus)}>调整</Button>
    : undefined;
  const H = D5_PARAM_HELP;
  const numRow = (key: "dailyLimitCount" | "maxBalanceRatio" | "smallAmountThresholdUsd" | "payoutSlaHours") => {
    const help = H[key];
    const spec = SPECS[key];
    const value = spec.current(p);
    return <ConfigRow key={key} name={help.label} what={help.what} when={help.when} where={help.where} effect={help.effect}
      value={key === "smallAmountThresholdUsd" && value === 0 ? "0 USD（已关闭）" : spec.show(value)}
      action={can(spec.authority) ? action("limits", help.label, key) : undefined} />;
  };
  // 一个网络一行：配置和用户能不能用写在一个标签里；用不了的原因跟在后面，整体原因已在结论句说过的不再写（DT-12）。
  const netRow = ({ net, configured, usable, code, networkOk }: ReturnType<typeof networkView>["states"][number]) => {
    const help = H.networkEnabled;
    // 只有确实读到「用户能用」才给绿对勾；读不到的是中性，不给「正常」的信号（DP-65、VS-20）。
    const tag = !configured ? <StatusTag tone="neutral" icon={CircleMinus}>关闭</StatusTag>
      : usable === undefined ? <StatusTag tone="neutral" icon={CircleDot}>开启</StatusTag>
        : usable ? <StatusTag tone="ok">开启 · 用户能用</StatusTag>
          : <StatusTag tone="warn" icon={AlertTriangle}>开启 · 用户现在用不了</StatusTag>;
    const reason = !configured ? undefined
      : usable === false ? (networks.outage && networks.shared ? undefined : networks.reasonOf(code))
        : networkOk && networks.gateUnknown ? "用户能不能用：—" : undefined;
    return <ConfigRow key={net} name={`${NET_LABEL[net]} 提现`} explainLabel={`${NET_LABEL[net]} 提现`} what={help.what} when={help.when} where={help.where}
      effect={help.effect} note={help.note} value={tag} sub={reason} action={action("network", `${NET_LABEL[net]} 提现`, netKey(net))} />;
  };
  const phaseSummary = `${p.currentPhase} · 第 ${p.currentMonth} 月 · 到账审查窗口 ${p.cooldownDays} 天 · 加强合规审查${p.complianceHoldEnabled ? "开启" : "关闭"}`;
  // 大额门槛是后端合规规则下发的（complianceReviewThresholdUsdt）；旧接口没有时两网规则写待核实，不猜 1,000。
  const threshold = p.complianceReviewThresholdUsdt == null ? null : `${p.complianceReviewThresholdUsdt.toLocaleString("en-US", { maximumFractionDigits: 6 })} USDT`;
  const evmRule = threshold === null ? "待核实"
    : !p.complianceHoldEnabled ? "按小额免审和风控审核，不额外等待"
      : p.cooldownDays > 0 ? `全部人工复核，超过 ${threshold} 等 ${p.cooldownDays} 天` : "全部人工复核，不额外等待";
  const trc20Rule = p.cooldownDays > 0 ? `每笔满 ${p.cooldownDays} 天才能放行，小额免审和风控照常` : "不额外等待，按小额免审和风控审核";

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
        const state = view.states.find((item) => item.net === net)!;
        const now = !p.networkEnabled[net] ? "现在关闭"
          : state.usable === undefined ? (state.networkOk && view.gateUnknown ? "现在开启 · 用户能不能用：—" : "现在开启")
            : state.usable ? "现在开启 · 用户能用"
              : sharedReason ? "现在开启 · 用户现在用不了" : `现在开启 · 用户现在用不了：${view.reasonOf(state.code)}`;
        const help = !changed ? undefined
          : next[net] ? "开启要提交审批。打款方没开通的网络，这里开着 App 也不显示。"
            : NET_CLOSE_EFFECT;
        return (
          <div key={net} data-d5-field={netKey(net)}>
            <Field label={<>{NET_LABEL[net]} 提现{changed && <> <DirectionTag loosens={next[net]} /></>}</>}
              help={<><div>{now}</div>{help && <div>{help}</div>}</>}>
              {() => <Segments label={`${NET_LABEL[net]} 提现通道`} value={editing.draft[netKey(net)] ?? "off"}
                items={[{ value: "on", label: "开启" }, { value: "off", label: "关闭" }]}
                onChange={(value) => setEditing((current) => current && { ...current, draft: { ...current.draft, [netKey(net)]: value } })} />}
            </Field>
          </div>
        );
      });
      // 关完一个都不剩是能提交的，只提醒一次后果。
      return <>{sharedReason && <Notice tone="neutral">{`${view.blocked.map((item) => NET_LABEL[item.net]).join("、")} 现在用不了：${sharedReason}。`}</Notice>}{fields}{evaluation.allClosed && evaluation.changedCount > 0 && (
        <Notice tone="warn">{evaluation.changedCount === 1 ? NET_LAST_OPEN : NET_ALL_CLOSED}</Notice>
      )}</>;
    }
    if (group === "limits") return <>
      <D5NumberField {...fieldProps("dailyLimitCount")} aria-label="每日提现次数目标值" />
      <D5NumberField {...fieldProps("maxBalanceRatio")} aria-label="余额可提上限目标值" />
      <D5NumberField {...fieldProps("smallAmountThresholdUsd")} aria-label="小额免审线目标值" />
      <D5NumberField {...fieldProps("payoutSlaHours")} aria-label="到账时效目标值" />
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
    NETWORKS.every((net) => Number(editing.draft[`fee.${net}`]) === D5_NETWORK_CONFIRM_FEE_DEFAULT[net]) && !editing.bad["fee.trc20"] && !editing.bad["fee.bep20"] && !editing.bad["fee.erc20"]
      ? "已经是默认值"
      : loosenBlock && NETWORKS.some((net) => D5_NETWORK_CONFIRM_FEE_DEFAULT[net] < p.networkConfirmFeeUsd[net]) ? `默认值比现在低，算放宽。${loosenBlock}` : undefined
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
                explain="四项一起修改、一起提交。只要有一项放宽，整组提交审批；全部收紧时提交后立即生效。">
                <ConfigList label="额度和时效">
                  {numRow("dailyLimitCount")}
                  {numRow("maxBalanceRatio")}
                  {numRow("smallAmountThresholdUsd")}
                  {numRow("payoutSlaHours")}
                </ConfigList>
              </Panel>
            </div>

            <div id={nav.anchor("network")}>
              <Panel title={<span tabIndex={-1} data-section-focus="">网络和费用</span>} explainLabel="网络和费用" icon={Network} tone="role-2"
                explain="这一组管用户能用哪些网络、每笔收多少费。三个网络一起改。"
                actions={networks.known && networks.blocked.length > 0 && !networks.outage ? reconLink : undefined}>
                {/* 提现开关关着时用户能不能用已经确定（都用不了），网络都关着时也没有「开启」可说，这两种不再提示读不到。 */}
                {!networks.known && withdrawGate !== "closed" && !networks.byConfig && <Notice tone="neutral" title="提现网络的实际状态读不到">下面只写了配置，开启不等于用户能用。{reconLink}</Notice>}
                {networks.gateUnknown && <Notice tone="neutral" title="提现总开关读不到">「紧急停用开关」的提现开关现在读不到，用户能不能用写「—」。网络本身的状态照常显示。</Notice>}
                <ConfigList label="网络和费用">
                  {networks.states.map(netRow)}
                  <ConfigRow name={H.networkConfirmFeeUsd.label} what={H.networkConfirmFeeUsd.what} when={H.networkConfirmFeeUsd.when} where={H.networkConfirmFeeUsd.where}
                    effect={H.networkConfirmFeeUsd.effect} note={`默认 ${NETWORKS.map((net) => `${NET_LABEL[net]} ${usd(D5_NETWORK_CONFIRM_FEE_DEFAULT[net])}`).join("、")}，在调整抽屉里可以恢复默认`}
                    value={NETWORKS.map((net) => `${NET_LABEL[net]}\u00a0${usd(p.networkConfirmFeeUsd[net]).replace(" ", "\u00a0")}`).join("、")} action={action("fee", "网络确认费")} />
                  <ConfigRow name={H.nexFeeOffsetRate.label} what={H.nexFeeOffsetRate.what} when={H.nexFeeOffsetRate.when} where={H.nexFeeOffsetRate.where}
                    effect={H.nexFeeOffsetRate.effect} value={SPECS.nexFeeOffsetRate.show(p.nexFeeOffsetRate)} action={action("nex", "UVT 抵扣率")} />
                </ConfigList>
              </Panel>
            </div>

            <div id={nav.anchor("phase")}>
              <Fold title="随运营阶段变化的设置" icon={CalendarRange} tone="role-other" summary={phaseSummary}
                explain="只能查看，修改请到「运营阶段设置」"
                actions={reach("/growth/phase") ? <Link className="rd-link" href="/growth/phase" prefetch={false}>去运营阶段设置</Link> : undefined}
                open={phaseOpen} onOpenChange={setPhaseOpen}>
                <ConfigList label="随运营阶段变化的设置">
                  <ConfigRow name={H.currentPhase.label} what={H.currentPhase.what} when={H.currentPhase.when} value={`${p.currentPhase} · 第 ${p.currentMonth} 月`} />
                  <ConfigRow name={H.cooldownDays.label} what={H.cooldownDays.what} when={H.cooldownDays.when} where={H.cooldownDays.where} note={H.cooldownDays.note} value={`${p.cooldownDays} 天`} />
                  <ConfigRow name={H.complianceHoldEnabled.label} what={H.complianceHoldEnabled.what} when={H.complianceHoldEnabled.when} where={H.complianceHoldEnabled.where} note={H.complianceHoldEnabled.note}
                    value={<StatusTag tone={p.complianceHoldEnabled ? "progress" : "neutral"} icon={p.complianceHoldEnabled ? undefined : CircleMinus}>{p.complianceHoldEnabled ? "开启" : "关闭"}</StatusTag>} />
                  <ConfigRow name={H.complianceReviewThresholdUsdt.label} what={H.complianceReviewThresholdUsdt.what} when={H.complianceReviewThresholdUsdt.when} note={threshold === null ? `现在读不到，请刷新或到运营阶段设置核对。${H.complianceReviewThresholdUsdt.note}` : H.complianceReviewThresholdUsdt.note}
                    value={threshold ?? "待核实"} />
                  <ConfigRow name={`BEP20、ERC20 ${H.networkRules.label}`} explainLabel="BEP20、ERC20 现在怎么审" what={H.networkRules.what} when={H.networkRules.when} note={H.networkRules.note} value={evmRule} />
                  <ConfigRow name={`TRC20 ${H.networkRules.label}`} explainLabel="TRC20 现在怎么审" what={H.networkRules.what} when={H.networkRules.when}
                    note={`不受加强合规审查影响，不超过小额免审线也要等完窗口。${H.networkRules.note}`} value={trc20Rule} />
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
        tone={editing?.group === "limits" ? "role-4" : "role-2"} sub={`当前版本 v${p.version}`}
        explain={editing && (editing.group === "limits"
          ? "四项一起提交。只要有一项放宽，整组提交审批，另一位超管批准前当前值不变；全部收紧时提交后立即生效。"
          : editing.group === "network" ? "三个网络一起提交。开启算放宽，要提交审批；只关不开时提交后立即生效。"
            : editing.group === "fee" ? "三个网络一起保存。任一网络调低，三个一起走审批。"
              : "调高算放宽，要提交审批；调低提交后立即生效。")}
        footer={editing && <Decision note={directionNote || undefined}
          others={editing.group === "fee" && <Button disabledReason={feeDefaultBlock}
            onClick={() => setEditing((current) => current && { ...current, bad: {}, draft: { ...current.draft, ...Object.fromEntries(NETWORKS.map((net) => [`fee.${net}`, String(D5_NETWORK_CONFIRM_FEE_DEFAULT[net])])) } })}>恢复默认</Button>}
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
