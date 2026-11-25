"use client";
import { APPROVAL_REPLAY_RELEASE, APPROVAL_REPLAY_RELEASE_NO_AUDIT, canReadOwnRecoveryProposal, currentRecoveryActor } from "@/lib/admin/abe-recovery-access";
import { eCommandClosureOffer } from "@/lib/admin/e-command-investigation";

/**
 * 越南盾提现参数（配置页，PG-46，样板照 H2）：默认只看名称和值，8 项在抽屉里整组修改（闸门 2 第 37 条）。
 * 后端按整组版本保存：只要有一项放宽，整组提交审批，另一位超管批准后生效；全部收紧直接保存，立即生效。
 * 写操作结果未知照提现审核：先存好原内容和命令号再发，页面上方常显待确认，只能原样重试（OP-92～OP-96）。
 * 修改权 finance_d7_manage、强制保存权 finance_d7_force_inverted 各判各的；没有修改权不显示入口（OP-124）。
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CalendarClock, History, LockOpen, PencilLine, RefreshCw, SlidersHorizontal, Zap } from "lucide-react";
import {
  BlockState, Button, Change, Conclusion, ConfigList, ConfigRow, Decision, DiffList, Drawer, Explain, Fact, Facts, Field, Fold,
  InlineRetry, Modal, Notice, NumberInput, PageHeader, Panel, ReleaseModal, Stat, StatBand, StatusTag, type DiffRow,
} from "@/app/components/rd";
import { AutoGloss } from "@/app/components/kit/gloss";
import { isA2OutcomeUncertainError, type A2OperationRow } from "@/lib/admin/a2-client";
import { useBDomainDashboard } from "@/lib/admin/b-client";
import { businessClock, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { PAYOUT_VND_HELP, PAYOUT_VND_SOURCE_HELP } from "@/lib/admin/config-help/d7-payout-vnd";
import { DOutcomeUnknownError, DRequestError, isDOutcomeUnknownError } from "@/lib/admin/d-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { explicitRejectionCode, isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { loadPayoutVndConfig, updatePayoutVndConfig } from "@/lib/admin/payout-vnd-client";
import {
  PAYOUT_VND_FIELDS, derivePayoutVndRates, isPayoutVndInverted, vndText,
  type PayoutVndConfig, type PayoutVndValues, type PayoutVndWritableField,
} from "@/lib/admin/payout-vnd-contract";
import { fundInvestigationAccess, type FundCommandOrigin, type FundCommandRecord, type FundCommandEvidence, type FundInvestigationOutcome } from "@/lib/admin/fund-command-investigation";
import { dConfigCommandOrigin, isDConfigCommandOrigin, queryDConfigCommand } from "@/lib/admin/d-config-command-investigation";
import { FundCheckButtons, FundClosureModal, FundRecoveryPanel, type FundRecoveryRow, type FundSettled } from "../fund-command-check";
import { CommandClosureModal } from "../e-tabs/e-command-check";
import { RecoveryPanel, recoveryTitle } from "../recovery-panel";
import { createPendingMutationStore, isRetryExpired, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { B_DASHBOARD_READ_AUTHORITIES } from "@/lib/admin/shell-authorities";
import {
  canManageD7Approval, checkWithdrawalApprovalCommand, configApprovalOriginalInput, pendingConfigApproval, useWithdrawalApprovals,
  releaseConfigApproval, releaseRejectedWithdrawalApproval, submitWithdrawalConfigApproval, withdrawalApprovalDisabledReason,
  withdrawalApprovalReplayQueryBlock, withdrawalApprovalLookupStatus, lookupWithdrawalApproval, type WithdrawalProposalLookup,
  withdrawalDirectRecoveryStatus, withdrawalReplayQueryBlock, rememberWithdrawalProcessing,
  WITHDRAWAL_COMMAND_PROCESSING, WITHDRAWAL_CONFIG_READ_FAILED, WITHDRAWAL_REPLAY_RESEND,
  type WithdrawalReplayObservation, type WithdrawalApprovalReceipt,
} from "@/lib/admin/withdrawal-config-approval";
import { useReach } from "@/lib/nav/use-reach";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { ActionConfirmReq, DCtx } from "./types";

type Key = PayoutVndWritableField;
type Drafts = Record<Key, string>;

const KEYS = Object.keys(PAYOUT_VND_FIELDS) as Key[];
const QUOTE_KEYS: Key[] = ["sellSpreadPct", "quoteTtlMinWithdraw", "requoteTolerancePct"];
/** 跨字段错误写在这一项下面，另一项离开后也要亮出来，不然数量对不上看到的错误。 */
const RELATED: Partial<Record<Key, Key>> = { feeMinUsd: "minAmountUsd", feeMaxUsd: "feeMinUsd", maxAmountUsd: "minAmountUsd" };
const FORCE_PHRASE = "确认价格倒挂风险";
/** 读取中不能依据旧数据写入（ST-32）。 */
const READING = "正在加载最新数据，读完再操作";
const LOCKED = "上一次提交的结果未知，处理完再改";
const CONFLICT = "越南盾提现参数已被其他人员更新，当前输入已保留。请读取最新后重新核对。";
/** 抽屉没有改动时，底部问号只写规则，不说哪条路（「写的必须是真的」）。 */
const RULE = "有一项放宽，整组要另一位超级管理员批准，批准前参数不变；没有放宽的修改提交后立即生效。只影响之后的报价。";
const COVERAGE_CHECK = "提交和批准时都会检查兑付覆盖率，低于红线或读不到时不能提交，也不能批准。";
/** 过期后继续锁住（OP-153），不引导关标签页绕过。展开后的出路：行内已经说了不能重试、先查询，这里只说查到以后谁来核查结案。 */
const EXPIRED_CLOSE_HERE = "查到原结果后，可以在这一行核查结案。";
const EXPIRED_CLOSE_OTHER = "查到原结果后，请有调查权限的超级管理员核查结案。";
const EXPIRED_NO_QUERY = "这个账号查不了原审批单，请有调查权限的超级管理员查询并核查结案。";
const NO_WRITE = "这个账号现在没有这项修改权限，不能重试，请到操作记录核对";
const READY_EXPLAIN = "只表示 HDPay 付款配置已齐全，不代表打款一定到账。和充值收款用同一个商户。提现总开关关着时，用户也不能提现。";
const APPROVAL_COPY = "另一位超级管理员批准前参数不变。";
const IMPACT = "只影响之后的报价；用户还没提交的旧报价需要重新报价，已提交的订单金额不变。";
/** 确认框「批准后生效」标签的提示：谁来批、批准前什么不变（影响在执行摘要，不重复）。 */
const APPROVAL_NOTE = "另一位超级管理员批准后才用于新报价。";
const PROPOSAL_STATUS: Record<A2OperationRow["status"], string> = { pending: "等另一位超级管理员批准", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" };
/** 共用文字泛指「这个对象」并让人去「操作记录与审批」；这页写明是哪组参数，当前权限到不了那页的账号写等谁处理。 */
const PENDING_HERE = "已有放宽单在等批准，审批完或发起人撤回后才能再提交放宽";
const PENDING_ELSEWHERE = "已有放宽单在等批准，等超级管理员处理后再提交。";

/** 直接保存的原操作：结果未知时原样保存，重试只能发这一份（OP-92、OP-94）。 */
type DirectCommand = { values: PayoutVndValues; expectedVersion: number; reason: string; forceInverted: boolean };
type DirectRecord = PendingMutationRecord & WithdrawalReplayObservation & DirectCommand & { commandOrigin?: FundCommandOrigin };
const DIRECT_SCOPE = "config";

const directCommands = createPendingMutationStore<DirectRecord>({
  storageKey: "nexion-admin-d7-payout-config-commands-v1",
  // 过了 24 小时不能再用原号重试，但记录和修改入口的锁都留着，到操作记录核对（OP-96）。
  retainExpiredRecords: true,
  isValidRecord: (record) => typeof record.reason === "string" && record.reason.length > 0
    && Number.isSafeInteger(record.expectedVersion) && typeof record.forceInverted === "boolean"
    && !!record.values && KEYS.every((key) => typeof record.values[key] === "number" && Number.isFinite(record.values[key]))
    && isDConfigCommandOrigin(record.commandOrigin, "D7"),
});

export async function queryD7DirectCommand(record: DirectRecord, evidence?: FundCommandEvidence) {
  const saved = directCommands.list().find(row => row.commandKey === record.commandKey);
  if (!saved) throw new Error("INVESTIGATION_ORIGINAL_NOT_FOUND_REMAINS_LOCKED");
  const result = await queryDConfigCommand(saved, "D7", evidence);
  if (result.settled) directCommands.forget(saved.fingerprint, saved.commandKey);
  else rememberWithdrawalProcessing(directCommands, saved, result.receipt);
  return result;
}

function newCommandKey() {
  const uuid = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `d7-config-${uuid.replaceAll("-", "").slice(0, 16)}`;
}

const plain = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 6 });

/** 配置原值加单位：1.5%、10 分钟、5,000 USDT。 */
function valueText(key: Key, value: number) {
  const { unit } = PAYOUT_VND_FIELDS[key];
  return unit === "%" ? `${plain(value)}%` : `${plain(value)}\u00a0${unit}`;
}

/** 汇率全站写「数字 ₫/USDT」，句子里写「1 USDT = 数字 ₫」（协调人 2026-11-08）。 */
const RATE_UNIT = "₫/USDT";
const vnd = (micro: bigint) => `${vndText(micro)} ${RATE_UNIT}`;

function draftsFrom(values: PayoutVndValues): Drafts {
  return Object.fromEntries(KEYS.map((key) => [key, String(values[key])])) as Drafts;
}

function alignsToStep(value: number, min: number, step: number) {
  const units = (value - min) / step;
  return Math.abs(units - Math.round(units)) < 1e-9;
}

/** 空、填坏和 0 分开（CP-54）：空输入不当 0，数字框里只填了一半（「-」「.」）算填坏。跨字段规则同后端 validateUpdateRequest，写在相关的那一项下面。 */
function parseDrafts(drafts: Drafts, bad: readonly Key[]) {
  const values = {} as PayoutVndValues;
  const errors: Partial<Record<Key, string>> = {};
  for (const key of KEYS) {
    const spec = PAYOUT_VND_FIELDS[key];
    const raw = drafts[key].trim();
    const value = raw === "" ? Number.NaN : Number(raw);
    values[key] = value;
    // 错误顶替字段下的帮助，所以把范围写全（VS-103）；字段名就在上面，不再重复。
    const range = `要填 ${PAYOUT_VND_HELP[key].how}`;
    if (bad.includes(key)) errors[key] = `不是有效数字，${range}`;
    else if (!Number.isFinite(value) || value < spec.min || value > spec.max
      || ("integer" in spec && spec.integer && !Number.isInteger(value)) || !alignsToStep(value, spec.min, spec.step)) errors[key] = range;
  }
  const valid = (key: Key) => !errors[key];
  const cross: Partial<Record<Key, string>> = {};
  if (valid("feeMinUsd") && valid("minAmountUsd") && values.feeMinUsd > 0 && values.feeMinUsd >= values.minAmountUsd) cross.feeMinUsd = "最低手续费须低于单笔最低金额";
  if (valid("feeMinUsd") && valid("feeMaxUsd") && values.feeMinUsd > values.feeMaxUsd) cross.feeMaxUsd = "手续费封顶不能低于最低手续费";
  if (valid("minAmountUsd") && valid("maxAmountUsd") && values.minAmountUsd > values.maxAmountUsd) cross.maxAmountUsd = "单笔最高金额不能低于单笔最低金额";
  return { values, errors: { ...cross, ...errors } };
}

/** 放宽方向和后端 PayoutVndConfigService.amplifies 一致，8 项任一放宽整组走审批。 */
function amplification(before: PayoutVndValues, after: PayoutVndValues) {
  return after.sellSpreadPct < before.sellSpreadPct
    || after.quoteTtlMinWithdraw > before.quoteTtlMinWithdraw
    || after.requoteTolerancePct > before.requoteTolerancePct
    || after.feeRatePct < before.feeRatePct
    || after.feeMinUsd < before.feeMinUsd
    || after.feeMaxUsd < before.feeMaxUsd
    || after.minAmountUsd < before.minAmountUsd
    || after.maxAmountUsd > before.maxAmountUsd;
}

function errorCode(error: unknown) {
  if (error instanceof DRequestError) return error.reasonCode;
  return error instanceof Error && "backendMessage" in error ? String(error.backendMessage) : undefined;
}

/** 接口错误常写「原因；建议」。待确认条里只留原因，下一步由页面写成做得到的事。 */
function reasonOf(message: string) {
  return message.split("；")[0].replace(/[。；]$/, "");
}

/** 结果未知的共用文字写「不要关闭弹窗…到操作记录核对」，这页的待确认条用不上，只取括号里的具体原因。 */
function uncertainDetail(error: Error) {
  return (error.message.match(/（([^（）]*)）$/)?.[1] ?? "").replace(/[。；]$/, "");
}

/** 放宽单上后端记的前后值（PayoutVndConfigService.previewValues）：「vN spread=… ttl=… tol=… rate=… minFee=… maxFee=… minAmt=… maxAmt=…」，强制保存倒挂价时末尾加 forceInverted。读不懂就返回 null。 */
const TICKET_KEYS: Record<string, Key> = { spread: "sellSpreadPct", ttl: "quoteTtlMinWithdraw", tol: "requoteTolerancePct", rate: "feeRatePct",
  minFee: "feeMinUsd", maxFee: "feeMaxUsd", minAmt: "minAmountUsd", maxAmt: "maxAmountUsd" };
function ticketValues(text: string | undefined) {
  const match = /^v\d+((?: [A-Za-z]+=-?\d+(?:\.\d+)?)+)( forceInverted)?$/.exec(text?.trim() ?? "");
  if (!match) return null;
  const values: Partial<Record<Key, number>> = {};
  for (const pair of match[1].trim().split(" ")) {
    const [name, value] = pair.split("=");
    if (!TICKET_KEYS[name]) return null;
    values[TICKET_KEYS[name]] = Number(value);
  }
  return KEYS.every((key) => values[key] !== undefined) ? { values: values as Record<Key, number>, forced: !!match[2] } : null;
}

/**
 * 放宽单拟改的值（OP-63）：前是提交时的值，后是拟改的值，只列改了的项；读不懂写「没读到」，不留空。
 * settled：单子已有结论（批准、驳回、撤回、过期），拟改值不再用待生效的蓝（VS-103）。
 */
function proposalFacts(row: { before?: string; after?: string }, settled = false) {
  const before = ticketValues(row.before);
  const after = ticketValues(row.after);
  if (!before || !after) return <Facts><Fact k="拟改值">没读到</Fact></Facts>;
  return <Facts>
    {KEYS.filter((key) => before.values[key] !== after.values[key]).map((key) => (
      <Fact key={key} k={PAYOUT_VND_FIELDS[key].label}><Change from={valueText(key, before.values[key])} to={valueText(key, after.values[key])} settled={settled} /></Fact>
    ))}
    {after.forced && <Fact k="倒挂价" tone="warn">强制保存</Fact>}
  </Facts>;
}

/** 待批行上的一句：改了哪几项，前后值点开这一行看。 */
function proposalLine(row: { before?: string; after?: string }) {
  const before = ticketValues(row.before);
  const after = ticketValues(row.after);
  if (!before || !after) return "拟改值没读到。";
  return `拟改 ${KEYS.filter((key) => before.values[key] !== after.values[key]).map((key) => PAYOUT_VND_FIELDS[key].label).join("、")}。`;
}

function valuesSummary(values: PayoutVndValues) {
  return KEYS.map((key) => `${PAYOUT_VND_FIELDS[key].label} ${valueText(key, values[key])}`).join("、");
}

type Editing = {
  /** 打开抽屉时的生效版本；读取最新后换成最新版本。 */
  base: PayoutVndConfig;
  drafts: Drafts;
  bad: Key[];
  touched: Key[];
  attempted: boolean;
  conflict: boolean;
  rereadError?: string;
  /** 读取最新后别人改了的项。 */
  others: Key[];
  othersFrom?: PayoutVndConfig;
};

export function D7PayoutVnd({ ctx }: { ctx: DCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const reach = useReach();
  const router = useRouter();
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const has = (code: string) => authorities.includes(code);
  const canManage = has("finance_d7_manage");
  const canForce = has("finance_d7_force_inverted");
  const canReadQueue = has("platform_a2_read");
  // 发起人能按命令号查自己发起的单（闸门 2 第 11 条），查询入口不只给有审批读权的账号。
  const canQueryOriginal = canReadOwnRecoveryProposal(authorities);
  const approvalBlocked = withdrawalApprovalDisabledReason(authorities);
  // 和顶栏同一份兑付覆盖率；读不到不传，提交和批准时后端再查。
  const bDomain = useBDomainDashboard(B_DASHBOARD_READ_AUTHORITIES.every(has));
  const coverage = bDomain.hasData && !bDomain.error && bDomain.ledger.valuationReliable
    ? { coverageRatio: bDomain.ledger.coverageRatio, redlinePct: bDomain.ledger.redlinePct, healthyPct: bDomain.ledger.healthyPct }
    : undefined;
  const zone = businessZone().label;
  const canReachAudit = reach("/platform/audit", "platform_a2_read");
  const canReachFx = reach("/finance/fx-rate", "finance_d6_read");

  const [config, setConfig] = useState<PayoutVndConfig | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ message: string; code?: string } | null>(null);
  const readSeq = useRef(0);
  const approvals = useWithdrawalApprovals("D7", session?.adminId, authorities);
  const { loadQueue, queueKnown, rows: queueRows, queueState } = approvals;
  const [direct, setDirect] = useState<DirectRecord[]>([]);
  const [approval, setApproval] = useState<ReturnType<typeof pendingConfigApproval>>();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [queryMissing, setQueryMissing] = useState<string[]>([]);
  // 按原号查审批单这一路的结果，和通用核查（investigationResults）分开记。
  const [proposalLookups, setProposalLookups] = useState<Partial<Record<string, WithdrawalProposalLookup>>>({});
  const [recovering, setRecovering] = useState("");
  const [releasing, setReleasing] = useState<{ kind: "direct"; record: DirectRecord } | { kind: "approval"; commandKey: string } | null>(null);
  const [rereading, setRereading] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [leaving, setLeaving] = useState<{ then?: () => void } | null>(null);

  const note = (commandKey: string, text: string) => setNotes((current) => ({ ...current, [commandKey]: text }));

  const syncPending = useCallback(() => {
    setDirect(directCommands.list());
    setApproval(session ? pendingConfigApproval("D7", session.adminId) : undefined);
  }, [session]);
  useEffect(() => syncPending(), [syncPending]);

  /** 请求带序号，旧响应不覆盖新数据。资金页读取失败不保留旧值（ST-36，和汇率设置一样）。 */
  const reload = useCallback(async (afterApproval = false) => {
    const seq = ++readSeq.current;
    setLoading(true);
    try {
      const next = await loadPayoutVndConfig();
      if (seq !== readSeq.current) return null;
      setConfig(next);
      setReadAt(Date.now());
      setLoadError(null);
      return next;
    } catch (cause) {
      if (seq !== readSeq.current) return null;
      setConfig(null);
      setReadAt(null);
      setLoadError({ message: afterApproval ? WITHDRAWAL_CONFIG_READ_FAILED : displayAdminError(cause), code: cause instanceof DRequestError ? cause.reasonCode : undefined });
      return null;
    } finally {
      if (seq === readSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 写入成功后的权威回读结果。 */
  const applyRead = (next: PayoutVndConfig) => {
    readSeq.current += 1;
    setConfig(next);
    setReadAt(Date.now());
    setLoadError(null);
    setLoading(false);
  };

  const applyApproval = (result: WithdrawalApprovalReceipt & { acknowledgement: string }, message = result.acknowledgement) => {
    approvals.registerReceipt(result);
    syncPending();
    toast(message, "success");
    void reload(true);
  };

  const draft = editing && (() => {
    const { base } = editing;
    const { values, errors } = parseDrafts(editing.drafts, editing.bad);
    const changed = KEYS.filter((key) => values[key] !== base[key]);
    const errorCount = Object.keys(errors).length;
    const sellValid = !errors.sellSpreadPct;
    const live = derivePayoutVndRates(base);
    const rates = sellValid ? derivePayoutVndRates({ ...base, sellSpreadPct: values.sellSpreadPct }) : null;
    const inverted = sellValid && isPayoutVndInverted(base.buySpreadPct, values.sellSpreadPct);
    const amplifies = errorCount === 0 && amplification(base, values);
    const coverageLow = !!coverage && coverage.coverageRatio < coverage.redlinePct;
    // 「提交修改」的禁用原因，从上往下取第一条（5.1）。
    const shared = editing.conflict ? "先读取最新数据再提交"
      : changed.length === 0 ? "没有改动"
      : errorCount > 0 ? `有 ${errorCount} 项要修改`
      : undefined;
    const approvalReason = amplifies
      ? approvalBlocked ?? (approval?.withdrawalSubmissionConfirmed ? "上一次放宽已提交，先到上方查询审批单" : approvals.blockReason)
        ?? (coverageLow ? "兑付覆盖率低于红线，放宽提交不了。" : undefined)
      : undefined;
    const submitBlock = shared ?? (inverted ? (canForce ? "价格倒挂，默认不能保存" : "价格倒挂，默认不能保存。强制保存只有超级管理员能做") : approvalReason);
    const forceBlock = shared ?? approvalReason;
    const atDefaults = editing.bad.length === 0 && KEYS.every((key) => values[key] === base.defaults[key]);
    return { base, values, errors, changed, errorCount, live, rates, inverted, amplifies, submitBlock, forceBlock, atDefaults };
  })();
  const dirty = !!editing && (editing.bad.length > 0 || (draft?.changed.length ?? 0) > 0);

  // 抽屉不挡背景，「修改参数」开着时还能点到：已在编辑就不重建，草稿留着（F5）。
  const openEditor = () => {
    if (config && !editing) setEditing({ base: config, drafts: draftsFrom(config), bad: [], touched: [], attempted: false, conflict: false, others: [] });
  };
  /** 抽屉有改动时，点关闭、点外面、按 Esc 或刷新都先问（OP-29）。 */
  const requestClose = (then?: () => void) => {
    if (dirty) { setLeaving({ then }); return; }
    setEditing(null);
    then?.();
  };
  const refresh = () => {
    const run = () => {
      void reload();
      approvals.refreshApprovals();
    };
    if (editing) requestClose(run);
    else run();
  };
  /** 页内的跳转链接也先问，选了放弃或保存成功后再走（F5）。 */
  const guard = (href: string) => (event: MouseEvent) => {
    if (!dirty) return;
    event.preventDefault();
    requestClose(() => router.push(href));
  };

  const setDraft = (key: Key, value: string, badInput: boolean) => setEditing((current) => current && {
    ...current,
    drafts: { ...current.drafts, [key]: value },
    bad: badInput ? [...new Set([...current.bad, key])] : current.bad.filter((item) => item !== key),
  });
  const touch = (key: Key) => setEditing((current) => current && (current.touched.includes(key) ? current : { ...current, touched: [...current.touched, key] }));
  const attempt = () => setEditing((current) => current && { ...current, attempted: true });

  /** 读取最新（OP-97）：自己改过的项保留，其余取最新；两边都改的项标出来。理由在重新打开确认框时为空。 */
  const rereadLatest = async () => {
    // 抽屉里重读，失败只写在抽屉里，草稿不动；成功后页面一起换成最新。
    setRereading(true);
    const latest = await loadPayoutVndConfig().catch(() => null);
    setRereading(false);
    if (latest) applyRead(latest);
    setEditing((current) => {
      if (!current) return current;
      if (!latest) return { ...current, rereadError: "读取失败，没有拿到最新数据。稍后再点「读取最新」。" };
      const mine = (key: Key) => current.bad.includes(key) || current.drafts[key].trim() === "" || Number(current.drafts[key]) !== current.base[key];
      return {
        ...current,
        base: latest,
        drafts: Object.fromEntries(KEYS.map((key) => [key, mine(key) ? current.drafts[key] : String(latest[key])])) as Drafts,
        bad: current.bad.filter(mine),
        conflict: false,
        rereadError: undefined,
        others: KEYS.filter((key) => latest[key] !== current.base[key]),
        othersFrom: current.base,
      };
    });
  };

  const closeAfterWrite = () => {
    setLeaving(null);
    setEditing(null);
  };

  /** after：离开确认里选了「保存」时，成功后接着做原来要做的事（关抽屉、刷新、跳转）。 */
  const submit = (forceInverted: boolean, after?: () => void) => {
    if (!session || !draft || draft.submitBlock && !(forceInverted && !draft.forceBlock)) return;
    const { base, values, changed, amplifies, rates, live } = draft;
    const pendingTicket = approvals.pendingOnTighten;
    const rows: DiffRow[] = KEYS.map((key) => ({ key, label: PAYOUT_VND_FIELDS[key].label, before: valueText(key, base[key]), after: valueText(key, values[key]) }));
    if (changed.includes("sellSpreadPct") && rates) rows.splice(1, 0, { key: "sell", label: "卖出价", before: vnd(live.sell), after: vnd(rates.sell) });
    if (forceInverted) {
      // 风险写在改动的那一行下面，不另铺横幅（VS-103）；卖出点差没变（买入点差在汇率设置改成 0）时挂在第一项改动上。
      const target = rows.find((row) => row.key === "sell") ?? rows.find((row) => row.before !== row.after);
      if (target) Object.assign(target, { note: "卖出价不低于买入价，用户可能来回兑换套利", tone: "danger" });
    }
    const request: ActionConfirmReq = {
      briefKind: "config",
      action: forceInverted && !amplifies ? "强制保存越南盾提现参数（价格倒挂）" : "调整越南盾提现参数",
      title: forceInverted ? "强制保存倒挂的价格" : "修改越南盾提现参数",
      detail: <>
        <div>{amplifies ? `批准后所有参数一起生效（当前版本 v${base.version}）。` : `所有参数一起保存（版本 v${base.version} → v${base.version + 1}）。`}</div>
        {!amplifies && <div>这次没有放宽项，不用别人批准。</div>}
      </>,
      facts: <div className="rd-stack">
        <DiffList rows={rows} />
        {pendingTicket && !amplifies && <Notice tone="warn">{approvals.pendingUnverified ? `上次读取的放宽单 ${pendingTicket.id} 如果还在等批准，保存后它批准时会被拒，要重新发起。` : `保存后，在等批准的放宽单 ${pendingTicket.id} 批准时会被拒，要重新发起。`}</Notice>}
      </div>,
      amplifies,
      coverage: amplifies ? coverage : undefined,
      coverageLead: "这次修改有放宽项",
      // 放宽走审批：生效方式和方向都是标题下的标签，谁来批、批准前什么不变进标签的提示（VS-106）。
      approval: amplifies ? { coverageCheckCopy: COVERAGE_CHECK } : undefined,
      effect: amplifies
        ? <><StatusTag tone="progress" filled explain={APPROVAL_NOTE}>批准后生效</StatusTag><StatusTag tone="warn" icon={LockOpen}>放宽</StatusTag></>
        : <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: amplifies ? undefined : "确认修改，立即生效",
      confirmTone: forceInverted ? "danger" : undefined,
      statedBrief: { impact: IMPACT, check: "核对改了哪几项和方向，理由写清调整原因和依据。" },
      reasonMin: 8,
      reasonMax: 200,
      reasonPlaceholder: "例如：调价依据、审批或工单号",
      // 生效方式在标题下的标签上，批准说明在标签的提示里，摘要只写影响，不再重复。
      completionCopy: amplifies ? APPROVAL_COPY : undefined,
      run: async (reason) => {
        try {
          if (amplifies) {
            const result = await submitWithdrawalConfigApproval("D7", session, { ...values, expectedVersion: base.version, forceInverted }, reason);
            if (result) applyApproval(result);
            closeAfterWrite();
            after?.();
            return;
          }
          const key = newCommandKey();
          directCommands.remember(DIRECT_SCOPE, key, { values, expectedVersion: base.version, reason, forceInverted, commandOrigin: dConfigCommandOrigin("D7") });
          if (!directCommands.isDurablyStored(DIRECT_SCOPE, key)) {
            directCommands.forget(DIRECT_SCOPE, key);
            throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
          }
          try {
            await updatePayoutVndConfig(values, base.version, reason, forceInverted, key);
            directCommands.forget(DIRECT_SCOPE, key);
            syncPending();
            closeAfterWrite();
            // 写入后另读一次当前配置（OP-86）；读不到时仍说已生效，页面给「重试」（OP-87）。
            const latest = await reload(true);
            toast(latest ? "越南盾提现参数已生效" : "越南盾提现参数已生效，最新参数暂时没读到", latest ? "success" : "warn");
            after?.();
          } catch (cause) {
            // 确定被拒才丢号；结果未知保号，转成页面上方的待确认（OP-93）。
            const rejected = isExplicitRejection(cause);
            if (rejected) directCommands.forget(DIRECT_SCOPE, key);
            syncPending();
            if (rejected || isPermissionDenied(cause)) throw cause;
            throw new DOutcomeUnknownError(key);
          }
        } catch (cause) {
          if (isA2OutcomeUncertainError(cause) || isDOutcomeUnknownError(cause)) {
            syncPending();
            closeAfterWrite();
            toast("结果未知，不要重复提交。到页面上方查询原操作。", "warn");
            return;
          }
          const code = errorCode(cause);
          if (code === "D7_CONFIG_VERSION_CONFLICT") {
            // 框不关、理由留着，写清原因；取消后回抽屉读取最新（OP-97）。
            setEditing((current) => current && { ...current, conflict: true });
            openActionConfirm({ ...request, blockedReason: CONFLICT });
          }
          if (code === "OBJECT_ALREADY_PENDING") throw new Error(canReachAudit ? `${PENDING_HERE}。` : PENDING_ELSEWHERE);
          throw cause;
        }
      },
    };
    openActionConfirm(request);
  };

  /** 倒挂先核对文字，这一步不发请求；文字框关掉后才打开理由框，不叠两层弹窗（PG-38）。 */
  const startForcedSave = () => {
    if (!draft?.rates) return;
    openConfirm({
      briefKind: "config",
      action: "确认保存倒挂的价格",
      title: "强制保存倒挂的价格",
      detail: <>卖出价不低于买入价，系统默认不允许保存。请输入「{FORCE_PHRASE}」后再填写理由。</>,
      content: <div className="rd-confirm-facts"><Facts>
        <Fact k="买入价">{vnd(draft.rates.buy)}</Fact>
        <Fact k="卖出价" tone="danger">{vnd(draft.rates.sell)}</Fact>
      </Facts></div>,
      statedBrief: { impact: "这一步还没提交，下一步写理由后才提交。", check: "确认知道倒挂的风险，再输入指定文字。" },
      // 备注不写进命令（EX-18）：占位不邀请人写一段话。
      reasonPlaceholder: "这里写的不会保存",
      input: {
        label: `输入“${FORCE_PHRASE}”`,
        placeholder: FORCE_PHRASE,
        kind: "text",
        validate: (value) => value.trim() === "" || value.trim() === FORCE_PHRASE ? undefined : `和「${FORCE_PHRASE}」不一致`,
      },
      remarkHint: "选填，不会保存",
      okLabel: "继续填写理由",
      confirmTone: "danger",
      run: () => { window.setTimeout(() => submit(true), 0); },
    });
  };

  const restoreDefaults = () => setEditing((current) => current && { ...current, drafts: draftsFrom(current.base.defaults), bad: [] });

  /** 直接保存业务上确认成功或核查确认：换成一行完成提示，重读参数。 */
  const settleDirect = async (record: DirectRecord, status: FundSettled["status"]) => {
    setSettled(current => [...current.filter(item => item.key !== record.commandKey), { key: record.commandKey, label: "参数修改", status }]);
    syncPending();
    setEditing(null);
    await reload();
  };
  /** 先按原请求查结果，查到的结论写在这一行，确定结论才解除；查不出结论再读回现在的值，版本对比只是现在的事实，记录保留（OP-95）。 */
  const verifyDirect = async (record: DirectRecord) => {
    setRecovering(`verify:${record.commandKey}`);
    try {
      const { receipt, settled: done } = await queryD7DirectCommand(record);
      setInvestigationResults(current => ({ ...current, [record.commandKey]: { receipt } }));
      if (done) {
        await settleDirect(record, receipt?.originalStatus ?? "SUCCEEDED");
        setRecovering("");
        return;
      }
      syncPending();
    } catch (cause) {
      // The current-values read remains available without a receipt conclusion.
      const error = displayAdminError(cause);
      setInvestigationResults(current => ({ ...current, [record.commandKey]: { error } }));
    }
    const latest = await reload();
    setRecovering("");
    note(record.commandKey, !latest
      ? "现在的值暂时读不到。"
      : latest.version === record.expectedVersion
        ? "现在的参数和发出时一样，还没看到这次修改。"
        : "现在的参数在发出后被改过，可能是这次修改，也可能是别人改的。");
  };

  /** 按原操作重试：同命令号、同内容、同理由（OP-94）。只有成功才解除；被明确拒绝后人核实过才能解除。 */
  const retryDirect = async (record: DirectRecord) => {
    if (isRetryExpired(record) || record.replayRejection) { syncPending(); return; }
    const target = { ...record, commandOrigin: record.commandOrigin ?? dConfigCommandOrigin("D7") };
    const canInvestigate = fundInvestigationAccess(target).canRead;
    if (recovering || record.withdrawalStillProcessing || !canManage || record.forceInverted && !canForce
      || withdrawalReplayQueryBlock(investigationResults[record.commandKey], canInvestigate)) return;
    // 要在 list() 之前查：list() 会从内存副本恢复已删除的记录，那样就成了换号重发。
    if (!directCommands.isDurablyStored(record.fingerprint, record.commandKey)) {
      note(record.commandKey, "浏览器里查不到这条记录，本次没有发送。记录继续保留，请先查询原操作。");
      return;
    }
    setRecovering(`retry:${record.commandKey}`);
    setInvestigationResults(current => ({ ...current, [record.commandKey]: undefined }));
    note(record.commandKey, "");
    try {
      await updatePayoutVndConfig(record.values, record.expectedVersion, record.reason, record.forceInverted, record.commandKey);
      directCommands.forget(record.fingerprint, record.commandKey);
      syncPending();
      // 原号重试拿到的是当时的回执，不一定是现在的参数：再读一次当前配置（F3）。
      const latest = await reload();
      toast(latest ? "原修改已生效，已读取最新参数" : "原修改已生效，最新参数读取失败，点「重试」再读", latest ? "success" : "warn");
    } catch (cause) {
      if (isPermissionDenied(cause)) announcePermissionDenied();
      if (isDOutcomeUnknownError(cause)) {
        note(record.commandKey, canInvestigate
          ? "重试的结果也未知，记录继续保留。请先查询原操作。" : "重试的结果也未知，记录继续保留。");
      } else {
        const rejection = explicitRejectionCode(cause);
        if (rejection) {
          note(record.commandKey, `重试被拒绝：${reasonOf(displayAdminError(cause))}。先点「查询原操作」核实。解除原操作记录不代表原操作没执行，也不算核查结案。`);
          directCommands.markReplayRejected(record.fingerprint, record.commandKey, rejection);
          syncPending();
        } else {
          // 登录、权限、限流这类不是对原操作的结论，不给解除（OP-153）。
          note(record.commandKey, `重试没有完成：${reasonOf(displayAdminError(cause))}。记录继续保留。${canInvestigate ? "请先查询原操作。" : ""}`);
        }
      }
    } finally {
      setRecovering("");
    }
  };

  const [investigationResults, setInvestigationResults] = useState<Partial<Record<string, FundInvestigationOutcome>>>({});
  const [closing, setClosing] = useState(false);
  const [directClosing, setDirectClosing] = useState<DirectRecord | null>(null);
  const [settled, setSettled] = useState<FundSettled[]>([]);
  const checkProposalInvestigation = async (record: NonNullable<ReturnType<typeof pendingConfigApproval>>, evidence?: FundCommandEvidence) => {
    setRecovering(record.commandKey);
    try {
      const { receipt, settled: done } = await checkWithdrawalApprovalCommand(record, evidence);
      setInvestigationResults(current => ({ ...current, [record.commandKey]: { receipt } }));
      if (done) {
        if (session) releaseConfigApproval("D7", session.adminId, record.commandKey);
        setSettled(current => [...current.filter(item => item.key !== record.commandKey), { key: record.commandKey, label: "放宽提交", status: receipt!.originalStatus, proposal: true }]);
        await reload(); await loadQueue();
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
  const lookupApproval = async () => {
    const missing = await queryApproval();
    const original = session ? pendingConfigApproval("D7", session.adminId) : undefined;
    if (!original || original.withdrawalSubmissionConfirmed) return;
    if (fundInvestigationAccess(original).canRead && await checkProposalInvestigation(original).catch(() => undefined)) note(original.commandKey, "");
    const latest = session ? pendingConfigApproval("D7", session.adminId) : undefined;
    if (missing && latest?.commandKey === original.commandKey && !latest.withdrawalStillProcessing && !latest.withdrawalSubmissionConfirmed) {
      setQueryMissing(current => [...current, latest.commandKey]);
    }
  };
  const releasePending = () => {
    if (!releasing) return;
    // Local release only; evidence-based closure is the separate 核查结案 entry.
    if (releasing.kind === "approval") {
      if (!session || !releaseRejectedWithdrawalApproval("D7", session.adminId, releasing.commandKey)) return;
    } else directCommands.forget(releasing.record.fingerprint, releasing.record.commandKey);
    syncPending(); setReleasing(null);
    toast("已解除本页这条原操作记录；系统里原操作的结果和锁定不变", "success");
  };

  /** 放宽提交的结果未知：先按命令号查原审批单，查到就有了结果（OP-95）。 */
  const queryApproval = async () => {
    if (!session || !approval) return;
    const key = approval.commandKey;
    setQueryMissing(current => current.filter(saved => saved !== key));
    setInvestigationResults(current => ({ ...current, [key]: undefined }));
    setProposalLookups(current => ({ ...current, [key]: undefined }));
    setRecovering("query");
    try {
      const lookup = await lookupWithdrawalApproval("D7", session);
      if (!lookup) { syncPending(); return; }
      if (lookup.state === "found") {
        applyApproval(lookup.result, `已找到原审批单 ${lookup.result.ticket.id}，${PROPOSAL_STATUS[lookup.result.ticket.status]}`);
        return;
      }
      // 这一路的结果单独记：没查成时行上常显原因，查无才和通用核查一起算「没有查到」。
      setProposalLookups(current => ({ ...current, [key]: lookup }));
      if (lookup.state === "failed") {
        if (approval.withdrawalSubmissionConfirmed) note(key, `原审批单加载失败：${lookup.reason}。稍后再点「查询原操作」。`);
        return;
      }
      if (!approval.withdrawalSubmissionConfirmed) note(key, isRetryExpired(approval)
        ? `暂时没查到原审批单，不代表没有提交。${canReachAudit ? "请到「操作记录与审批」核对，不要重复提交。" : "核对后交财务负责人处理，不要重复提交。"}`
        : "没有查到原审批单，原记录继续保留。");
      return true;
    } catch (cause) {
      note(key, approval.withdrawalSubmissionConfirmed ? "原审批单加载失败，稍后再点「查询原操作」。"
        : isA2OutcomeUncertainError(cause) && isRetryExpired(approval)
        ? `暂时没查到原审批单，不代表没有提交。${canReachAudit ? "请到「操作记录与审批」核对，不要重复提交。" : "核对后交财务负责人处理，不要重复提交。"}`
        : `查询没有成功：${isA2OutcomeUncertainError(cause) ? uncertainDetail(cause) || "结果仍未知" : reasonOf(displayAdminError(cause))}。记录继续保留。`);
    } finally {
      setRecovering("");
    }
  };

  const retryApprovalBlock = (record: NonNullable<typeof approval>, rights: readonly string[]) => {
    if (record.replayRejection) return "重试已被拒绝，请核实后解除";
    if (record.withdrawalStillProcessing) return WITHDRAWAL_COMMAND_PROCESSING.line;
    if (withdrawalApprovalDisabledReason(rights)) return NO_WRITE;
    try { if (!canManageD7Approval(rights, configApprovalOriginalInput("D7", record.input)[0])) return NO_WRITE; }
    catch { return "原审批内容读不到，请核对原操作"; }
    return withdrawalApprovalReplayQueryBlock(investigationResults[record.commandKey], fundInvestigationAccess(record).canRead, queryMissing.includes(record.commandKey));
  };

  /** 查不到原单后按原操作重试。明确拒绝后保留原记录供核实。 */
  const retryApproval = async () => {
    if (recovering || !session || !approval) return;
    const actor = currentRecoveryActor(session.adminId);
    if (!actor || isRetryExpired(approval) || approval.withdrawalSubmissionConfirmed || retryApprovalBlock(approval, actor.authorities)) return;
    const key = approval.commandKey;
    setQueryMissing(current => current.filter(saved => saved !== key));
    setInvestigationResults(current => ({ ...current, [key]: undefined }));
    setRecovering("approval-retry");
    note(key, "");
    try {
      const result = await submitWithdrawalConfigApproval("D7", session, null, "", "retry-original");
      if (result) applyApproval(result);
    } catch (cause) {
      if (isPermissionDenied(cause)) announcePermissionDenied();
      syncPending();
      if (isExplicitRejection(cause)) return;
      // 本次查无资格已消耗。尚无结论时，下一步是再查原结果。
      const message = isA2OutcomeUncertainError(cause)
        ? uncertainDetail(cause) || "没有收到明确结果"
        : reasonOf(displayAdminError(cause));
      note(key, `重试没有完成：${message}。记录继续保留，请先查询原操作。`);
    } finally {
      setRecovering("");
    }
  };

  const auditLink = canReachAudit && <Link className="rd-link" href="/platform/audit?domain=D" prefetch={false} onClick={guard("/platform/audit?domain=D")}>到操作记录与审批核对</Link>;
  const sentAt = (record: PendingMutationRecord) => `${formatBusinessTimeCompact(new Date(record.createdAt).toISOString(), "—")}（${zone}）发出`;
  const expiredNext = (record: FundCommandRecord) => {
    const access = fundInvestigationAccess(record);
    return access.unavailableReason ? "" : access.canSubmit ? EXPIRED_CLOSE_HERE : EXPIRED_CLOSE_OTHER;
  };

  const directRows = direct.map((record): FundRecoveryRow => {
    const expired = isRetryExpired(record);
    const canRetry = canManage && (!record.forceInverted || canForce);
    const outcome = investigationResults[record.commandKey];
    // 改版前没存出处的记录按当前账号查，queryD7DirectCommand 再核原操作人。
    const target = { ...record, commandOrigin: record.commandOrigin ?? dConfigCommandOrigin("D7") };
    const canInvestigate = fundInvestigationAccess(target).canRead;
    const queryBlock = withdrawalReplayQueryBlock(outcome, canInvestigate);
    const retryBlock = record.replayRejection ? "重试已被拒绝，请核实后解除" : canRetry ? queryBlock : NO_WRITE;
    // 查到记为失败时，「可能已经生效」不再写。
    const processing = record.withdrawalStillProcessing;
    const failed = !!outcome && "receipt" in outcome && outcome.receipt?.originalStatus === "FAILED";
    return { key: record.commandKey, title: "参数修改", record: target, outcome, createdAt: record.createdAt, expired, canRetry: !expired && !retryBlock && !processing,
      status: withdrawalDirectRecoveryStatus(outcome, { canInvestigate, expired, processing, retryDisabled: retryBlock }),
      actions: <>
        <FundCheckButtons record={target} outcome={investigationResults[record.commandKey]} expired={expired} busy={!!recovering} checking={recovering === `verify:${record.commandKey}`}
          onCheck={() => void verifyDirect(record)} onClose={() => setDirectClosing(record)} />
        {!expired && <Button size="sm" disabled={!!recovering} loading={recovering === `retry:${record.commandKey}`} disabledReason={processing && !record.replayRejection ? WITHDRAWAL_COMMAND_PROCESSING.line : retryBlock} onClick={() => void retryDirect(record)}>按原操作重试</Button>}
        {record.replayRejection && <Button size="sm" disabled={!!recovering} onClick={() => setReleasing({ kind: "direct", record })}>解除原操作记录</Button>}
      </>,
      detail: <>
        <p>{failed ? "" : "可能已经生效，"}这组参数有结果前不能再改。{expired ? outcome ? "" : expiredNext(target) : canInvestigate && !retryBlock && !processing ? WITHDRAWAL_REPLAY_RESEND : ""}</p>
        {notes[record.commandKey] && <p>{notes[record.commandKey]}</p>}
      </>,
      tech: `操作编号 ${record.commandKey} ｜ 发出时版本 v${record.expectedVersion} ｜ 理由 ${record.reason} ｜ 拟改值：${valuesSummary(record.values)}${record.forceInverted ? " ｜ 强制保存倒挂价" : ""}` };
  });

  const approvalRow = approval && ((): FundRecoveryRow => {
    const expired = isRetryExpired(approval);
    const confirmed = approval.withdrawalSubmissionConfirmed;
    const outcome = investigationResults[approval.commandKey];
    const retryDisabled = retryApprovalBlock(approval, authorities);
    let original: string;
    try {
      const [values, reason] = configApprovalOriginalInput("D7", approval.input);
      original = `理由 ${reason} ｜ 拟改值：${valuesSummary(values as unknown as PayoutVndValues)}`;
    } catch (cause) {
      original = cause instanceof Error ? cause.message : "原审批内容读不到";
    }
    return { key: approval.commandKey, title: "放宽提交", record: approval, outcome, createdAt: approval.createdAt, expired, canRetry: !expired && !confirmed && !retryDisabled,
      canQuery: canQueryOriginal, copy: { missingOrigin: "只能查审批单进度，查不了更细的执行结果。" },
      status: confirmed ? withdrawalApprovalLookupStatus(proposalLookups[approval.commandKey], undefined, expired, true)
        : withdrawalApprovalLookupStatus(proposalLookups[approval.commandKey], outcome, expired)
        ?? (approval.withdrawalStillProcessing ? WITHDRAWAL_COMMAND_PROCESSING
          : !expired && !canQueryOriginal ? { tone: "warn", label: "结果未知", line: "这个账号查不了原审批单，请有权限的同事核对。" }
          : !expired && !outcome && retryDisabled ? { tone: "warn", label: "结果未知", line: retryDisabled } : undefined),
      actions: <>
        {canQueryOriginal && <FundCheckButtons record={approval} canLookupOwnProposal={canQueryOriginal} outcome={confirmed ? undefined : outcome} expired={expired} busy={!!recovering} checking={recovering === "query" || recovering === approval.commandKey}
          onCheck={() => void lookupApproval()} onClose={() => setClosing(true)} />}
        {!expired && !confirmed && <Button size="sm" disabled={!!recovering} disabledReason={retryDisabled} loading={recovering === "approval-retry"}
          onClick={() => void retryApproval()}>按原操作重试</Button>}
        {!confirmed && approval.replayRejection && <Button size="sm" disabled={!!recovering} onClick={() => setReleasing({ kind: "approval", commandKey: approval.commandKey })}>解除原操作记录</Button>}
      </>,
      detail: <>
        <p>{confirmed ? "审批已提交，查到审批单状态后再提交放宽。"
          : <>可能已生成审批单，这组参数有结果前不能再改。{expired && !outcome && (canQueryOriginal ? expiredNext(approval) : EXPIRED_NO_QUERY)}</>}</p>
        {!expired && approvalBlocked && <p>{approvalBlocked}</p>}
        {approval.replayRejection && <p>重试没有成功：{reasonOf(displayAdminError(new Error(approval.replayRejection)))}。 {canReachAudit ? APPROVAL_REPLAY_RELEASE : APPROVAL_REPLAY_RELEASE_NO_AUDIT}</p>}
        {notes[approval.commandKey] && <p>{notes[approval.commandKey]}</p>}
      </>,
      tech: original };
  })();
  const pendingPanel = <FundRecoveryPanel rows={[...directRows, ...(approvalRow ? [approvalRow] : [])]} link={auditLink || undefined}
    settled={settled} onDismissSettled={key => setSettled(current => current.filter(item => item.key !== key))} />;
  const releaseModal = <>
    {releasing && <ReleaseModal label={releasing.kind === "approval" ? "放宽提交" : "参数修改"} onCancel={() => setReleasing(null)} onConfirm={releasePending}
      explain={releasing.kind === "approval" ? canReachAudit ? APPROVAL_REPLAY_RELEASE : APPROVAL_REPLAY_RELEASE_NO_AUDIT : "重试被拒说明不了原操作的结果，先查询原操作。解除后原操作不再重试。"} />}
    {directClosing && <CommandClosureModal label="参数修改" commandKey={directClosing.commandKey} createdAt={directClosing.createdAt}
      offer={eCommandClosureOffer(investigationResults[directClosing.commandKey], isRetryExpired(directClosing))} facts={<Fact k="提交的值">{valuesSummary(directClosing.values).split("、").map((item, index, all) => <span key={item} className="rd-keep">{item}{index < all.length - 1 ? "、" : ""}</span>)}</Fact>}
      onClose={() => setDirectClosing(null)} onSubmit={async evidence => {
        const record = directClosing;
        const { receipt, settled: done } = await queryD7DirectCommand(record, evidence);
        setInvestigationResults(current => ({ ...current, [record.commandKey]: { receipt } }));
        setDirectClosing(null);
        if (done) await settleDirect(record, receipt?.originalStatus ?? "SUCCEEDED");
      }} />}
    {closing && approval && <FundClosureModal label="放宽提交" createdAt={approval.createdAt} offer={eCommandClosureOffer(investigationResults[approval.commandKey], isRetryExpired(approval))}
      onClose={() => setClosing(false)} onSubmit={async evidence => { await checkProposalInvestigation(approval, evidence); setClosing(false); }} />}
  </>;

  const guideExtra = (
    <section className="rd-guide-section">
      <h3>这个账号能做什么</h3>
      {canManage
        ? <p>能修改参数。有一项放宽，整组要另一位超级管理员批准，批准前参数不变；没有放宽的修改提交后立即生效。</p>
        : <p>这个账号只能查看。</p>}
      {canForce && <p>价格倒挂时能强制保存：先输入「{FORCE_PHRASE}」，再写理由。强制保存倒挂价的单，批准人还要有强制保存权限。</p>}
    </section>
  );

  const header = (
    <PageHeader
      pageId="D7"
      title="越南盾提现参数"
      summary={<AutoGloss>设置银行卡提现的报价、手续费和单笔限额。</AutoGloss>}
      guideExtra={guideExtra}
      meta={<span className="rd-toolbar">
        <span>{readAt && `${businessClock(readAt)} 读取（${zone}）`}<Explain label="数据时间说明" content="打开和点「刷新」时读取，不自动刷新。" /></span>
        <Button variant="ghost" size="sm" loading={loading} icon={<RefreshCw size={14} aria-hidden />} onClick={refresh}>刷新</Button>
      </span>}
      readOnly={canManage ? undefined : "当前账号只能查看这页"}
    />
  );

  const ownTicket = approvals.terminal ?? approvals.pendingRows.find((row) => row.id === approvals.ownId);
  const ownApprovalNotice = approvals.ownNotice && (!config || approvals.showOwnNotice)
    && <Notice tone={approvals.terminal ? "neutral" : "warn"}>{approvals.ownNotice}{ownTicket && proposalFacts(ownTicket, !!approvals.terminal)}</Notice>;
  const visibleQueueRows = config ? queueRows : queueRows.filter(row => row.id !== approvals.ownId || !approvals.ownNotice);
  const queuePanel = <RecoveryPanel title={recoveryTitle(0, visibleQueueRows.length)} tone="warn" label="等待批准的放宽单"
    foot={canReachAudit ? <Link className="rd-link" href="/platform/audit?domain=D" prefetch={false} onClick={guard("/platform/audit?domain=D")}>到操作记录与审批查看</Link> : undefined}
    items={visibleQueueRows.map((ticket) => {
      const stale = approvals.queueRowStale(ticket.id);
      return { key: ticket.id, object: `放宽单 ${ticket.id}`, tag: <StatusTag tone="warn">{stale ? "上次待审批" : "待审批"}</StatusTag>,
        line: `${proposalLine(ticket)}${stale ? "上次读取的结果，正在刷新待批列表。" : approvals.queueLine}`,
        // 读不懂时这一行已经写了「拟改值没读到」，展开后不再写一遍（DT-12）。
        detail: ticketValues(ticket.before) && ticketValues(ticket.after) ? proposalFacts(ticket) : undefined };
    })} />;
  const queueReadNotice = (queueState === "failed" || approvals.queueRetrying)
    && <Notice tone="warn" title="待批列表加载失败" action={<InlineRetry onRetry={() => void loadQueue()} retrying={approvals.queueRetrying} />}>{approvals.queueError}</Notice>;

  if (!config) {
    return <>
      {header}
      {pendingPanel}
      {queuePanel}
      {ownApprovalNotice}
      {queueReadNotice}
      {loading
        ? <BlockState state="loading" title="正在加载越南盾提现参数…" />
        // 资金页读取失败不留旧值（ST-36），写法和汇率设置一样：一句话加「失败原因」问号，汇率来源不可用时另起一行给去处。
        : <BlockState state="error" title="越南盾提现参数加载失败" onRetry={() => void reload()}
          detail={<>
            <p>{loadError?.message === WITHDRAWAL_CONFIG_READ_FAILED
              ? loadError.message : <>读不到参数，页面不显示旧值。点「重试」，一直失败请联系财务值班人员。{loadError && <Explain label="失败原因" content={loadError.message} />}</>}</p>
            {loadError?.code === "D7_D6_SOURCE_UNAVAILABLE" && canReachFx && <p><Link className="rd-link" href="/finance/fx-rate" prefetch={false}>去汇率设置 →</Link></p>}
          </>} />}
      {releaseModal}
    </>;
  }

  const live = derivePayoutVndRates(config);
  const liveInverted = isPayoutVndInverted(config.buySpreadPct, config.sellSpreadPct);
  const editBlock = direct.length > 0 || approval && !approval.withdrawalSubmissionConfirmed ? LOCKED : loading ? READING : undefined;
  const nothingToDo = queueKnown && direct.length === 0 && !approval && !approvals.blockReason && !approvals.ownNotice;
  const fxLink = canReachFx && <Link className="rd-link" href="/finance/fx-rate" prefetch={false} onClick={guard("/finance/fx-rate")}>去修改 →</Link>;

  const row = (key: Key) => {
    const help = PAYOUT_VND_HELP[key];
    return <ConfigRow key={key} name={PAYOUT_VND_FIELDS[key].label} what={help.what} when={help.when} where={help.where} effect={help.effect}
      value={valueText(key, config[key])} sub={key === "requoteTolerancePct" ? "当前不起作用" : undefined} />;
  };

  const field = (key: Key) => {
    if (!editing || !draft) return null;
    const spec = PAYOUT_VND_FIELDS[key];
    const help = PAYOUT_VND_HELP[key];
    const changed = draft.changed.includes(key);
    const related = RELATED[key];
    const shown = editing.attempted || editing.touched.includes(key) || (!!related && editing.touched.includes(related));
    const theirs = editing.others.includes(key) && changed;
    return (
      <Field key={key}
        label={<>{spec.label}<Explain label={`${spec.label}的说明`} rows={[
          { k: "这是什么", v: help.what },
          { k: "显示位置", v: help.where },
          { k: "生效时间", v: help.when },
          { k: "填写规则", v: help.rule },
          { k: "改了会怎样", v: help.effect },
        ]} /></>}
        hint={changed && <StatusTag tone="progress" icon={PencilLine}>已改</StatusTag>}
        // 填错时错误顶替帮助，范围写在错误里（VS-103）。
        help={shown && draft.errors[key] ? undefined : <>现在 {valueText(key, draft.base[key])}。{help.how}，默认 {valueText(key, draft.base.defaults[key])}{theirs && <span className="rd-form-error">。这项刚被别人改过</span>}</>}
        error={shown ? draft.errors[key] : undefined}>
        {(control) => (
          <NumberInput {...control} aria-label={`${spec.label}目标值`} unit={spec.unit} min={spec.min} max={spec.max} step={spec.step}
            value={editing.drafts[key]} onBlur={() => touch(key)}
            onChange={(event) => setDraft(key, event.target.value, event.target.value.trim() !== "" && !Number.isFinite(Number(event.target.value)))} />
        )}
      </Field>
    );
  };

  // 底部：生效方式和确认框同一种标签（VS-106）；挡住的原因是结论，另起一行用正文色（VS-108），只有填错用橙黄。
  const decisionNote = draft && (draft.changed.length === 0 && draft.errorCount === 0 ? "没有改动" : <>
    {draft.errorCount > 0 ? <span className="rd-form-error">有 {draft.errorCount} 项要修改</span> : <>已改 {draft.changed.length} 项 {draft.amplifies
      ? <><StatusTag tone="warn" icon={LockOpen}>放宽</StatusTag> <StatusTag tone="progress" icon={CalendarClock} filled>批准后生效</StatusTag></>
      : <StatusTag tone="progress" icon={Zap} filled>立即生效</StatusTag>}</>}
    {draft.submitBlock && draft.errorCount === 0 && <><br />{draft.submitBlock}</>}
  </>);
  const decisionExplain = draft && (draft.changed.length === 0 ? RULE
    : draft.amplifies ? `只要有一项放宽，整组走审批。${APPROVAL_COPY}批准后${IMPACT}` : `没有放宽项，提交后立即生效。${IMPACT}`);

  return (
    <>
      {header}

      {!config.providerReady
        ? <Conclusion state="warn" hint="请联系值班人员检查商户设置和服务状态。" explain="已放行的提现暂时不会发给 HDPay。参数还能修改。">HDPay 设置不可用，用户现在不能发起新的银行卡提现</Conclusion>
        : <Conclusion state={nothingToDo ? "ok" : "neutral"} explain={canReadQueue ? READY_EXPLAIN : `${READY_EXPLAIN}这个账号看不到待批列表，可刷新查看本标签页提交的放宽单。`}>
          {nothingToDo ? "HDPay 打款设置已配置，没有要处理的事" : "HDPay 打款设置已配置"}
        </Conclusion>}

      {pendingPanel}
      {queuePanel}
      {ownApprovalNotice}
      {queueReadNotice}

      <StatBand label="越南盾报价">
        <Stat tone="role-2" icon={ArrowDownLeft} label="买入价" value={vndText(live.buy)} unit={RATE_UNIT}
          explain="基准价 ×（1 + 买入点差），取整到十位。在「汇率设置」修改。" />
        <Stat tone="role-4" icon={ArrowUpRight} label="卖出价" value={vndText(live.sell)} unit={RATE_UNIT}
          explain="基准价 ×（1 − 卖出点差），和用户拿到的报价一致，不取整。" />
        <Stat tone={liveInverted ? "danger" : "role-3"} icon={ArrowLeftRight} label="买卖价差" value={vndText(live.spread)} unit={RATE_UNIT}
          sub={liveInverted ? "价格倒挂" : undefined} explain="买入价 − 卖出价" />
      </StatBand>

      <Panel title="当前参数" icon={SlidersHorizontal} tone="role-4"
        explain="8 项一起修改，只要有一项放宽，整组走审批。每项是什么、显示在哪，看名称旁的提示。"
        actions={canManage && <Button variant="primary" size="sm" icon={<PencilLine size={14} aria-hidden />} disabledReason={editBlock} onClick={openEditor}>修改参数</Button>}>
        {/* 两组并排，倒挂和手续费约束要对照看（01 映射行的破例）；外层 section 被拉齐高度，组内行距不跟着撑开。 */}
        <div className="rd-split" data-even="">
          <section aria-label="卖出报价">
            <div className="rd-config-group">
              <h3 className="rd-config-group-title">卖出报价</h3>
              <ConfigList label="卖出报价">{QUOTE_KEYS.map(row)}</ConfigList>
            </div>
          </section>
          <section aria-label="手续费与限额">
            <div className="rd-config-group">
              <h3 className="rd-config-group-title">手续费与限额</h3>
              <ConfigList label="手续费与限额">{KEYS.filter((key) => !QUOTE_KEYS.includes(key)).map(row)}</ConfigList>
            </div>
          </section>
        </div>
      </Panel>

      <Fold title="版本与来源" icon={History} tone="role-other"
        summary={`版本 v${config.version} · ${formatBusinessTimeCompact(config.effectiveAt, "—")}（${zone}）生效`}>
        {/* 只读镜像照 H2「只读项」：别处管的值带「去修改」（PG-46）。 */}
        <ConfigList label="版本与来源">
          <ConfigRow name="基准价" what={PAYOUT_VND_SOURCE_HELP.baseRateVndPerUsdt.what} when={PAYOUT_VND_SOURCE_HELP.baseRateVndPerUsdt.when}
            value={`${plain(config.baseRateVndPerUsdt)} ${RATE_UNIT}`} action={fxLink} />
          <ConfigRow name="买入点差" what={PAYOUT_VND_SOURCE_HELP.buySpreadPct.what} when={PAYOUT_VND_SOURCE_HELP.buySpreadPct.when}
            value={`${plain(config.buySpreadPct)}%`} action={fxLink} />
          <ConfigRow name="最近操作者" value={config.lastUpdatedBy === "migration" ? "系统初始值" : config.lastUpdatedBy} />
        </ConfigList>
      </Fold>

      <nav className="rd-links" aria-label="相关页面">
        <span>相关页面</span>
        {canReachFx && <Link className="rd-link" href="/finance/fx-rate" prefetch={false} onClick={guard("/finance/fx-rate")}>汇率设置</Link>}
        {reach("/finance/withdrawals") && <Link className="rd-link" href="/finance/withdrawals" prefetch={false} onClick={guard("/finance/withdrawals")}>提现审核</Link>}
        {reach("/finance/params", "finance_d5_read") && <Link className="rd-link" href="/finance/params" prefetch={false} onClick={guard("/finance/params")}>USDT 提现参数</Link>}
        {canReachAudit && <Link className="rd-link" href="/platform/audit" prefetch={false} onClick={guard("/platform/audit")}>操作记录与审批</Link>}
      </nav>

      <Drawer open={!!editing} onClose={() => requestClose()} title="修改越南盾提现参数" icon={SlidersHorizontal} tone="role-4"
        sub={draft && `当前版本 v${draft.base.version}`}
        footer={draft && (
          <Decision
            note={decisionNote}
            explain={decisionExplain}
            danger={draft.inverted && canForce
              ? <Button variant="danger-outline" disabledReason={draft.forceBlock} onBlockedClick={attempt} onClick={startForcedSave}>强制保存（价格倒挂）</Button>
              : undefined}
            others={<Button variant="ghost" disabledReason={draft.atDefaults ? "已经是默认值" : undefined} onClick={restoreDefaults}>恢复默认值</Button>}
            primary={<Button variant="primary" disabledReason={draft.submitBlock} onBlockedClick={attempt} onClick={() => submit(false)}>提交修改</Button>}
          />
        )}>
        {editing && draft && <>
          {editing.conflict && (
            <Notice tone="warn" title="参数已被其他人员更新" action={<Button size="sm" loading={rereading} onClick={() => void rereadLatest()}>读取最新</Button>}>
              当前输入已保留，点「读取最新」后重新核对。{editing.rereadError && <div>{editing.rereadError}</div>}
            </Notice>
          )}
          {editing.othersFrom && (
            // 别人改的已经生效，不是待生效：条用中性色，新值用正文色（VS-103）。
            <Notice tone="neutral" title={`已读取最新版本 v${draft.base.version}${editing.others.length > 0 ? `，别人已改 ${editing.others.length} 项` : ""}`}>
              {editing.others.length > 0
                ? <>你改过的项保留你的值，其余已换成最新。
                  <Facts>{editing.others.map((key) => <Fact key={key} k={PAYOUT_VND_FIELDS[key].label}><Change settled from={valueText(key, editing.othersFrom![key])} to={valueText(key, draft.base[key])} /></Fact>)}</Facts></>
                : "最新的值和你打开时一样，你的改动都保留。"}
            </Notice>
          )}
          <section className="rd-config-group" aria-label="价格预览">
            <h3 className="rd-config-group-title">价格预览</h3>
            <Facts>
              <Fact k="买入价">{vnd(draft.live.buy)}</Fact>
              <Fact k="卖出价">{draft.rates
                ? draft.rates.sell !== draft.live.sell ? <Change from={vnd(draft.live.sell)} to={vnd(draft.rates.sell)} /> : vnd(draft.rates.sell)
                : "—"}</Fact>
              <Fact k="买卖价差" tone={draft.inverted ? "danger" : undefined}>{draft.rates
                ? <>{draft.rates.spread !== draft.live.spread ? <Change from={vnd(draft.live.spread)} to={vnd(draft.rates.spread)} /> : vnd(draft.rates.spread)}{draft.inverted && " · 价格倒挂"}</>
                : "—"}</Fact>
            </Facts>
          </section>
          <section className="rd-config-group" aria-label="卖出报价">
            <h3 className="rd-config-group-title">卖出报价</h3>
            <div className="rd-stack">{QUOTE_KEYS.map(field)}</div>
          </section>
          <section className="rd-config-group" aria-label="手续费与限额">
            <h3 className="rd-config-group-title">手续费与限额</h3>
            <div className="rd-stack">
              {/* 一项一行：540 宽的抽屉里两列时帮助断词折行（VS-105）。 */}
              {KEYS.filter((key) => !QUOTE_KEYS.includes(key)).map(field)}
            </div>
          </section>
        </>}
      </Drawer>

      {leaving && draft && (
        <Modal title="还有没提交的修改" icon={PencilLine} onClose={() => setLeaving(null)} footer={<>
          <Button onClick={() => setLeaving(null)}>继续编辑</Button>
          <Button onClick={() => { const then = leaving.then; setLeaving(null); setEditing(null); then?.(); }}>放弃改动</Button>
          <Button variant="primary" disabledReason={draft.submitBlock} onClick={() => { const then = leaving.then; setLeaving(null); submit(false, then); }}>
            {draft.amplifies ? "提交审批后继续" : "保存并立即生效"}
          </Button>
        </>}>
          <p>已改 {draft.changed.length} 项还没提交。放弃后这些改动不保留。</p>
        </Modal>
      )}
      {releaseModal}
    </>
  );
}
