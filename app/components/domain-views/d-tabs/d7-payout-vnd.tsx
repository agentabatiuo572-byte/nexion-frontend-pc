"use client";

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
import { fetchA2Overview, isA2OutcomeUncertainError, type A2OperationRow } from "@/lib/admin/a2-client";
import { useBDomainDashboard } from "@/lib/admin/b-client";
import { businessClock, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { PAYOUT_VND_HELP, PAYOUT_VND_SOURCE_HELP } from "@/lib/admin/config-help/d7-payout-vnd";
import { DRequestError, isDOutcomeUnknownError } from "@/lib/admin/d-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { loadPayoutVndConfig, updatePayoutVndConfig } from "@/lib/admin/payout-vnd-client";
import {
  PAYOUT_VND_FIELDS, derivePayoutVndRates, isPayoutVndInverted, vndText,
  type PayoutVndConfig, type PayoutVndValues, type PayoutVndWritableField,
} from "@/lib/admin/payout-vnd-contract";
import { createPendingMutationStore, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { B_DASHBOARD_READ_AUTHORITIES } from "@/lib/admin/shell-authorities";
import { configApprovalOriginalInput, pendingConfigApproval, releaseConfigApproval, submitConfigApproval, withdrawalApprovalDisabledReason } from "@/lib/admin/withdrawal-config-approval";
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
const READING = "正在读取最新数据，读完再操作";
const LOCKED = "上一次提交的结果未确认，处理完再改";
const CONFLICT = "越南盾提现参数已被其他人员更新，当前输入已保留。请读取最新后重新核对。";
/** 抽屉没有改动时，底部问号只写规则，不说哪条路（「写的必须是真的」）。 */
const RULE = "只要有一项放宽，整组走审批，另一位超管批准前当前参数不变；全部收紧提交后立即生效。只影响之后的报价。";
const COVERAGE_CHECK = "提交和批准时都会检查兑付覆盖率，低于红线或读不到时不能提交，也不能批准。";
/** 过期后继续锁住，受控核查后端已交付，但本页本轮未接入结案入口（OP-153）；不引导关标签页绕过。到不了操作记录的账号写这页上能走的路，再交财务负责人（同汇率设置）。 */
const EXPIRED_DIRECT_NO_AUDIT = "已超过 24 小时，不能再重试。这个账号看不到操作记录，请点「读回核对」看版本有没有变，核对后交财务负责人处理。";
const EXPIRED_APPROVAL_NO_AUDIT = "已超过 24 小时，不能再重试。这个账号看不到操作记录，请点「查询原操作」核对有没有生成审批单，核对后交财务负责人处理。";
const EXPIRED_NO_QUERY = "已超过 24 小时，不能再重试。这个账号看不到操作记录，也查不了原审批单，请交财务负责人处理。";
const NO_WRITE = "这个账号现在没有这项修改权限，不能重试，请到操作记录核对";
const READY_EXPLAIN = "只表示服务端配置齐全，不代表已确认真实到账。和充值收款共用同一商户。提现总开关关闭时，用户也不能提现。";
const APPROVAL_COPY = "另一位超管批准前，当前配置保持不变。批准后新报价使用新参数，未提交的旧报价需重新报价，已提交订单金额不变。";
const IMPACT = "只影响之后的报价；用户还没提交的旧报价需要重新报价，已提交的订单金额不变。";
/** 确认框「批准后生效」标签的提示：谁来批、批准前什么不变（影响在执行摘要，不重复）。 */
const APPROVAL_NOTE = "另一位超管批准前，当前参数不变；批准后新报价使用新参数。";
const PROPOSAL_STATUS: Record<A2OperationRow["status"], string> = { pending: "等待另一位超管批准", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" };
/** 共用文字泛指「这个对象」并让人去「操作记录与审批」；这页写明是哪组参数，当前权限到不了那页的账号写等谁处理。 */
const PENDING_HERE = "这组参数已有放宽单在等批准，批准或驳回后才能再提交放宽";
const PENDING_ELSEWHERE = "已有放宽单在等批准，等超级管理员处理后再提交。";

/** 直接保存的原操作：结果未知时原样保存，重试只能发这一份（OP-92、OP-94）。 */
type DirectCommand = { values: PayoutVndValues; expectedVersion: number; reason: string; forceInverted: boolean };
type DirectRecord = PendingMutationRecord & DirectCommand;
const DIRECT_SCOPE = "config";

const directCommands = createPendingMutationStore<DirectRecord>({
  storageKey: "nexion-admin-d7-payout-config-commands-v1",
  // 过了 24 小时不能再用原号重试，但记录和修改入口的锁都留着，到操作记录核对（OP-96）。
  retainExpiredRecords: true,
  isValidRecord: (record) => typeof record.reason === "string" && record.reason.length > 0
    && Number.isSafeInteger(record.expectedVersion) && typeof record.forceInverted === "boolean"
    && !!record.values && KEYS.every((key) => typeof record.values[key] === "number" && Number.isFinite(record.values[key])),
});

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
  const canQueryOriginal = canReadQueue || has("platform_a2_proposal_create");
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
  // loaded：读完过一次。读不到（没有审批读权、读取中、失败）都不能当成没有待批单（F2）。
  const [queue, setQueue] = useState<{ rows: A2OperationRow[]; failed: boolean; loading: boolean; loaded: boolean }>({ rows: [], failed: false, loading: false, loaded: false });
  const queueSeq = useRef(0);
  const [direct, setDirect] = useState<DirectRecord[]>([]);
  const [approval, setApproval] = useState<ReturnType<typeof pendingConfigApproval>>();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [retryRejected, setRetryRejected] = useState<string[]>([]);
  const [queryMissing, setQueryMissing] = useState<string[]>([]);
  const [recovering, setRecovering] = useState("");
  const [releasing, setReleasing] = useState<{ kind: "direct"; record: DirectRecord } | { kind: "approval"; commandKey: string } | null>(null);
  const [approvalRejected, setApprovalRejected] = useState<string | null>(null);
  // 这次会话刚登记的放宽单。看不到审批列表的账号（财务主管）靠它知道单还在等批准（F2）。
  const [sentTicket, setSentTicket] = useState<A2OperationRow | null>(null);
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
  const reload = useCallback(async () => {
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
      setLoadError({ message: displayAdminError(cause), code: cause instanceof DRequestError ? cause.reasonCode : undefined });
      return null;
    } finally {
      if (seq === readSeq.current) setLoading(false);
    }
  }, []);

  /** 待批的放宽单：后端只给有审批读权、且能看 D 域的账号；读不到不等于没有。 */
  const loadQueue = useCallback(async () => {
    if (!canReadQueue) return;
    const seq = ++queueSeq.current;
    setQueue((current) => ({ ...current, loading: true }));
    try {
      const overview = await fetchA2Overview({ domain: "D" });
      if (seq !== queueSeq.current) return;
      setQueue({ rows: overview.operationQueue.filter((row) => row.status === "pending" && row.action === "放宽越南盾提现参数" && row.obj === "current"
        && (!row.operationCode || row.operationCode === "d7_payout_vnd_config")), failed: false, loading: false, loaded: true });
    } catch {
      if (seq !== queueSeq.current) return;
      setQueue({ rows: [], failed: true, loading: false, loaded: false });
    }
  }, [canReadQueue]);

  useEffect(() => {
    void reload();
    void loadQueue();
  }, [reload, loadQueue]);

  /** 写入成功后的权威回读结果。 */
  const applyRead = (next: PayoutVndConfig) => {
    readSeq.current += 1;
    setConfig(next);
    setReadAt(Date.now());
    setLoadError(null);
    setLoading(false);
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
    const pendingTicket = queue.rows[0];
    const coverageLow = !!coverage && coverage.coverageRatio < coverage.redlinePct;
    // 「提交修改」的禁用原因，从上往下取第一条（5.1）。
    const shared = editing.conflict ? "先读取最新数据再提交"
      : changed.length === 0 ? "没有改动"
      : errorCount > 0 ? `有 ${errorCount} 项要修改`
      : undefined;
    const approvalReason = amplifies
      ? approvalBlocked ?? (pendingTicket ? "已有放宽单在等批准，批准或驳回后才能再提交放宽。" : coverageLow ? "兑付覆盖率低于红线，放宽提交不了。" : undefined)
      : undefined;
    const submitBlock = shared ?? (inverted ? (canForce ? "价格倒挂，默认不能保存" : "价格倒挂，默认不能保存。强制保存只有超级管理员能做") : approvalReason);
    const forceBlock = shared ?? approvalReason;
    const atDefaults = editing.bad.length === 0 && KEYS.every((key) => values[key] === base.defaults[key]);
    return { base, values, errors, changed, errorCount, live, rates, inverted, amplifies, pendingTicket, submitBlock, forceBlock, atDefaults };
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
      setApprovalRejected(null);
      void reload();
      void loadQueue();
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
    const { base, values, changed, amplifies, rates, live, pendingTicket } = draft;
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
        {pendingTicket && !amplifies && <Notice tone="warn">放宽单 {pendingTicket.id} 批准时会因版本变化被拒，要重新发起。</Notice>}
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
            const result = await submitConfigApproval("D7", session, { ...values, expectedVersion: base.version, forceInverted }, reason, loadPayoutVndConfig);
            syncPending();
            if (result) {
              applyRead(result.active);
              setSentTicket(result.ticket);
              toast(result.acknowledgement, "success");
            }
            closeAfterWrite();
            void loadQueue();
            after?.();
            return;
          }
          const key = newCommandKey();
          directCommands.remember(DIRECT_SCOPE, key, { values, expectedVersion: base.version, reason, forceInverted });
          if (!directCommands.isDurablyStored(DIRECT_SCOPE, key)) {
            directCommands.forget(DIRECT_SCOPE, key);
            throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
          }
          try {
            const next = await updatePayoutVndConfig(values, base.version, reason, forceInverted, key);
            directCommands.forget(DIRECT_SCOPE, key);
            syncPending();
            applyRead(next);
            toast("越南盾提现参数已生效", "success");
            closeAfterWrite();
            after?.();
          } catch (cause) {
            // 确定被拒才丢号；结果未知保号，转成页面上方的待确认（OP-93）。
            if (!isDOutcomeUnknownError(cause)) directCommands.forget(DIRECT_SCOPE, key);
            syncPending();
            throw cause;
          }
        } catch (cause) {
          if (isA2OutcomeUncertainError(cause) || isDOutcomeUnknownError(cause)) {
            syncPending();
            closeAfterWrite();
            toast("结果未确认，不要重复提交。到页面上方核对或按原操作重试。", "warn");
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

  /** 直接保存的读回：只给现在的事实。版本没变说明还没看到这次修改；变了也可能是别人改的，待确认都保留（OP-95）。 */
  const verifyDirect = async (record: DirectRecord) => {
    setRecovering(`verify:${record.commandKey}`);
    const latest = await reload();
    setRecovering("");
    note(record.commandKey, !latest
      ? "读回失败，暂时读不到。待确认继续保留。"
      : latest.version === record.expectedVersion
        ? `读回：现在还是版本 v${latest.version}，和发出时一样，暂时没看到这次修改。可以按原操作重试。`
        : `读回：现在是版本 v${latest.version}，发出时是 v${record.expectedVersion}。版本变了可能是别人改的，待确认继续保留。`);
  };

  /** 按原操作重试：同命令号、同内容、同理由（OP-94）。只有成功才解除；被明确拒绝后人核实过才能解除。 */
  const retryDirect = async (record: DirectRecord) => {
    if (isRetryExpired(record)) { syncPending(); return; }
    // 要在 list() 之前查：list() 会从内存副本恢复已删除的记录，那样就成了换号重发。
    if (!directCommands.isDurablyStored(record.fingerprint, record.commandKey)) {
      note(record.commandKey, "浏览器里查不到这条记录，本次没有发送。待确认继续保留，请先读回核对。");
      return;
    }
    setRecovering(`retry:${record.commandKey}`);
    setRetryRejected((current) => current.filter((key) => key !== record.commandKey));
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
        note(record.commandKey, "重试的结果也没有确认，原操作继续保留。稍后再读回核对或重试。");
      } else if (isExplicitRejection(cause)) {
        note(record.commandKey, `重试被拒绝：${reasonOf(displayAdminError(cause))}。先点「读回核对」核实当前状态。本地解除不证明原操作未执行，也不办理后端核查结案。`);
        setRetryRejected((current) => [...current, record.commandKey]);
      } else {
        // 登录、权限、限流这类不是对原操作的结论，不给解除（OP-153）。
        note(record.commandKey, `重试没有完成：${reasonOf(displayAdminError(cause))}。原操作继续保留，稍后再读回核对或重试。`);
      }
    } finally {
      setRecovering("");
    }
  };

  /** 解除只放开本页的锁，不发请求，不写操作记录（OP-96）。 */
  const releasePending = () => {
    if (!releasing) return;
    if (releasing.kind === "direct") directCommands.forget(releasing.record.fingerprint, releasing.record.commandKey);
    else if (session) releaseConfigApproval("D7", session.adminId, releasing.commandKey);
    syncPending();
    setReleasing(null);
    toast("已移除本地待确认记录，后端结果和锁定状态不变", "success");
  };

  /** 放宽提交的结果未知：先按命令号查原审批单，查到就有了结果（OP-95）。 */
  const queryApproval = async () => {
    if (!session || !approval) return;
    const key = approval.commandKey;
    setRecovering("query");
    try {
      const result = await submitConfigApproval("D7", session, null, "", loadPayoutVndConfig, true);
      if (!result) {
        setQueryMissing((current) => [...current, key]);
        note(key, "没有查到原审批单。原操作继续保留，可以按原操作重试。");
        return;
      }
      syncPending();
      applyRead(result.active);
      setSentTicket(result.ticket);
      // 只是查询，没有提交新内容；共用回执会写「本次输入未提交」，这里按查到的单写。
      toast(`已找到原审批单 ${result.ticket.id}，${PROPOSAL_STATUS[result.ticket.status]}`, "success");
      void loadQueue();
    } catch (cause) {
      note(key, isA2OutcomeUncertainError(cause) && isRetryExpired(approval)
        ? `暂未查到原审批单，不能据此认定没有提交。${canReachAudit ? "请到「操作记录与审批」核对，不要重复提交。" : "核对后交财务负责人处理，不要重复提交。"}`
        : `查询没有成功：${isA2OutcomeUncertainError(cause) ? uncertainDetail(cause) || "结果还没确认" : reasonOf(displayAdminError(cause))}。原操作继续保留。`);
    } finally {
      setRecovering("");
    }
  };

  /**
   * 查不到原单后按原操作重试。查到确实没有原单、重试又被明确拒绝时，记录由 submitConfigApproval 清掉，页面写拒绝原因；
   * 其余明确拒绝保留记录，人核实过再「解除待确认」，和 USDT 提现参数一样（协调人决定 1）。
   */
  const retryApproval = async () => {
    if (!session || !approval) return;
    const key = approval.commandKey;
    setRecovering("approval-retry");
    setRetryRejected((current) => current.filter((item) => item !== key));
    note(key, "");
    try {
      const result = await submitConfigApproval("D7", session, null, "", loadPayoutVndConfig, "retry-original");
      syncPending();
      if (result) {
        applyRead(result.active);
        setSentTicket(result.ticket);
        toast(result.acknowledgement, "success");
      }
      void loadQueue();
    } catch (cause) {
      if (isPermissionDenied(cause)) announcePermissionDenied();
      syncPending();
      if (isA2OutcomeUncertainError(cause)) {
        note(key, `重试的结果也没有确认${uncertainDetail(cause) ? `：${uncertainDetail(cause)}` : ""}。原操作继续保留，稍后再查询或重试。`);
        return;
      }
      const message = reasonOf(errorCode(cause) === "OBJECT_ALREADY_PENDING" ? (canReachAudit ? PENDING_HERE : PENDING_ELSEWHERE) : displayAdminError(cause));
      const kept = pendingConfigApproval("D7", session.adminId);
      if (kept && isExplicitRejection(cause)) {
        note(key, `重试被拒绝：${message}。先核对原审批单；查不到不代表没有生成。本地解除不办理后端核查结案。`);
        setRetryRejected((current) => [...current, key]);
      } else if (kept) {
        // 登录、权限、限流这类不是对原操作的结论，不给解除（OP-153）。
        note(key, `重试没有完成：${message}。原操作继续保留，稍后再查询或重试。`);
      } else {
        setApprovalRejected(`${message}。原本地记录已清除，重新提交仍须通过服务端校验。`);
      }
    } finally {
      setRecovering("");
    }
  };

  const auditLink = canReachAudit && <> <Link className="rd-link" href="/platform/audit?domain=D" prefetch={false} onClick={guard("/platform/audit?domain=D")}>到操作记录与审批核对</Link></>;
  const sentAt = (record: PendingMutationRecord) => `${formatBusinessTimeCompact(new Date(record.createdAt).toISOString(), "—")}（${zone}）发出`;
  const expiredDirect = canReachAudit ? `${RETRY_EXPIRED_TEXT}。` : EXPIRED_DIRECT_NO_AUDIT;
  const expiredApproval = canReachAudit ? `${RETRY_EXPIRED_TEXT}。` : canQueryOriginal ? EXPIRED_APPROVAL_NO_AUDIT : EXPIRED_NO_QUERY;

  const directNotices = direct.map((record) => {
    const expired = isRetryExpired(record);
    const canRetry = canManage && (!record.forceInverted || canForce);
    return (
      <Notice key={record.commandKey} tone="warn" title="参数修改 · 结果未确认" action={<>
        <Button size="sm" disabled={!!recovering} loading={recovering === `verify:${record.commandKey}`} onClick={() => void verifyDirect(record)}>读回核对</Button>
        {!expired && <Button size="sm" disabled={!!recovering} loading={recovering === `retry:${record.commandKey}`} disabledReason={canRetry ? undefined : NO_WRITE} onClick={() => void retryDirect(record)}>按原操作重试</Button>}
        {!expired && retryRejected.includes(record.commandKey) && <Button size="sm" disabled={!!recovering} onClick={() => setReleasing({ kind: "direct", record })}>解除待确认</Button>}
      </>}>
        {sentAt(record)}，可能已经生效。这组参数确认前不能再改。{expired ? expiredDirect : "重发原内容，已成功的不会重复执行。"}
        {auditLink}
        <Explain label="技术信息" content={`命令号 ${record.commandKey} ｜ 发出时版本 v${record.expectedVersion} ｜ 理由 ${record.reason} ｜ 拟改值：${valuesSummary(record.values)}${record.forceInverted ? " ｜ 强制保存倒挂价" : ""}`} />
        {notes[record.commandKey] && <div>{notes[record.commandKey]}</div>}
      </Notice>
    );
  });

  const approvalNotice = approval && (() => {
    const expired = isRetryExpired(approval);
    const missing = queryMissing.includes(approval.commandKey);
    const showRetry = !expired && (missing || !canQueryOriginal);
    let original: string;
    try {
      const [values, reason] = configApprovalOriginalInput("D7", approval.input);
      original = `理由 ${reason} ｜ 拟改值：${valuesSummary(values as unknown as PayoutVndValues)}`;
    } catch (cause) {
      original = cause instanceof Error ? cause.message : "原审批内容读不到";
    }
    return (
      <Notice tone="warn" title="放宽提交 · 结果未确认" action={<>
        {canQueryOriginal && <Button size="sm" disabled={!!recovering} loading={recovering === "query"} onClick={() => void queryApproval()}>查询原操作</Button>}
        {showRetry && <Button size="sm" disabled={!!recovering} loading={recovering === "approval-retry"} disabledReason={canManage ? undefined : NO_WRITE} onClick={() => void retryApproval()}>按原操作重试</Button>}
        {showRetry && retryRejected.includes(approval.commandKey) && <Button size="sm" disabled={!!recovering} onClick={() => setReleasing({ kind: "approval", commandKey: approval.commandKey })}>解除待确认</Button>}
      </>}>
        {sentAt(approval)}，可能已生成审批单。这组参数确认前不能再改。
        {expired ? expiredApproval : !canQueryOriginal ? "这个账号查不了原审批单，可以按原操作重试，已成功的不会重复执行。" : missing ? "" : "先查询原操作，查不到再按原操作重试。"}
        {auditLink}
        <Explain label="技术信息" content={`命令号 ${approval.commandKey} ｜ ${original}`} />
        {notes[approval.commandKey] && <div>{notes[approval.commandKey]}</div>}
      </Notice>
    );
  })();

  const releaseModal = releasing && (
    <ReleaseModal label={releasing.kind === "direct" ? "参数修改" : "放宽提交"} onCancel={() => setReleasing(null)} onConfirm={releasePending}
      explain={releasing.kind === "direct"
        ? "重试被拒说明不了原操作的结果，先读回核对版本有没有变。解除后原操作不再重试。"
        : "重试被拒说明不了原操作的结果，先确认没有生成审批单。解除后原操作不再重试。"} />
  );

  const guideExtra = (
    <section className="rd-guide-section">
      <h3>这个账号能做什么</h3>
      {canManage
        ? <p>能修改参数。只要有一项放宽，整组走审批，另一位超管批准前，当前配置保持不变；全部收紧提交后立即生效。</p>
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
        <span>{readAt ? `${businessClock(readAt)} 读取（${zone}）· ` : ""}打开时读取</span>
        <Button variant="ghost" size="sm" loading={loading} icon={<RefreshCw size={14} aria-hidden />} onClick={refresh}>刷新</Button>
      </span>}
      readOnly={canManage ? undefined : "当前账号只能查看这页"}
    />
  );

  if (!config) {
    return <>
      {header}
      {directNotices}
      {approvalNotice}
      {loading
        ? <BlockState state="loading" title="正在读取越南盾提现参数…" />
        // 资金页读取失败不留旧值（ST-36），写法和汇率设置一样：一句话加「失败原因」问号，汇率来源不可用时另起一行给去处。
        : <BlockState state="error" title="越南盾提现参数加载失败" onRetry={() => void reload()}
          detail={<>
            <p>读不到参数，页面不显示旧值。点「重试」，一直失败请联系财务值班人员。{loadError && <Explain label="失败原因" content={loadError.message} />}</p>
            {loadError?.code === "D7_D6_SOURCE_UNAVAILABLE" && canReachFx && <p><Link className="rd-link" href="/finance/fx-rate" prefetch={false}>去汇率设置</Link></p>}
          </>} />}
      {releaseModal}
    </>;
  }

  const live = derivePayoutVndRates(config);
  const liveInverted = isPayoutVndInverted(config.buySpreadPct, config.sellSpreadPct);
  const editBlock = direct.length > 0 || approval ? LOCKED : loading ? READING : undefined;
  // 「没有要处理的事」只在待批单读到了、读完了才说；看不到审批列表、读取中、读取失败都不下这个结论（F2）。
  const queueKnown = canReadQueue && queue.loaded && !queue.loading && !queue.failed;
  const nothingToDo = queueKnown && direct.length === 0 && !approval && queue.rows.length === 0 && !approvalRejected && !sentTicket;
  const showSentTicket = sentTicket && !queue.rows.some((row) => row.id === sentTicket.id) && sentTicket.status === "pending";
  const fxLink = canReachFx && <Link className="rd-link" href="/finance/fx-rate" prefetch={false} onClick={guard("/finance/fx-rate")}>去修改</Link>;

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
    : draft.amplifies ? `只要有一项放宽，整组走审批。${APPROVAL_COPY}` : `全部收紧，提交后立即生效。${IMPACT}`);

  return (
    <>
      {header}

      {!config.providerReady
        ? <Conclusion state="warn" hint="请联系技术人员检查商户设置和服务状态。" explain="已放行的提现暂时不会发给 HDPay。参数还能修改。">HDPay 设置不可用，用户现在不能发起新的银行卡提现</Conclusion>
        : <Conclusion state={nothingToDo ? "ok" : "neutral"} explain={canReadQueue ? READY_EXPLAIN : `${READY_EXPLAIN}这个账号看不到放宽单的审批进度。`}>
          {nothingToDo ? "HDPay 打款设置已配置，没有要处理的事" : "HDPay 打款设置已配置"}
        </Conclusion>}

      {directNotices}
      {approvalNotice}
      {approvalRejected && <Notice tone="danger" title="放宽提交被拒绝">{approvalRejected}</Notice>}
      {queue.rows.map((ticket) => (
        <Notice key={ticket.id} tone="progress" action={canReachAudit ? <Link className="rd-link" href="/platform/audit?domain=D" prefetch={false} onClick={guard("/platform/audit?domain=D")}>到操作记录与审批查看</Link> : undefined}>
          放宽单 {ticket.id} 等待批准，批准前当前参数不变
        </Notice>
      ))}
      {showSentTicket && !canReadQueue && (
        <Notice tone="progress">放宽单 {sentTicket.id} 已提交，等待另一位超管批准，批准前当前参数不变。这个账号看不到后续进度，结果请问超级管理员。</Notice>
      )}
      {queue.failed && <Notice tone="warn" action={<InlineRetry onRetry={() => void loadQueue()} retrying={queue.loading} />}>放宽单状态暂时读不到</Notice>}

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
                : "别人改的项和你看到的值相同，你的改动都保留。"}
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
