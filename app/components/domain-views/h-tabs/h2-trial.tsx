"use client";

/**
 * 免费试用设置（配置页样板，PG-46）：先看试用现在开着没、用得怎么样，再改常用参数；
 * 其他参数进「高级设置」，别处决定的值进「只读项」，试用记录收起，单条详情用抽屉。
 * 修改权 growth_h2_write、取消权 growth_h2_session_cancel、扣款权 growth_h2_session_charge 各判各的，没有就不显示按钮（OP-124）。
 * 强制取消提交审批，批准后执行；强制扣款已退役，历史申请仍可查询。参数修改直接生效，结果未知时保留原操作。
 */
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, Coins, Copy, History, Lock, RefreshCw, Settings2, SlidersHorizontal, Ticket, TrendingUp, Users } from "lucide-react";
import { BlockState, Button, Cell, Change, Conclusion, ConfigList, ConfigRow, Decision, Drawer, Explain, Fact, Facts, Fold, IconButton, IrreversibleTag, JudgmentPoints, Modal, Notice, PageHeader, Pager, Panel, RecordList, ReleaseModal, SectionNav, Stat, StatBand, StatusTag, Table, TableMessage, Td, Th, Tr, useSectionNav, type SectionNavItem, type StateTone } from "@/app/components/rd";
import {
  createH2CommandKey,
  fetchH2Trials,
  isH2OutcomeUnknown,
  updateH2TrialParam,
} from "@/lib/admin/h-client";
import { usePropose } from "@/lib/admin/use-propose";
import { finishRetiredH2TrialChargeLookup, H2_TRIAL_ACTIONS, pendingH2TrialApprovals, submitH2TrialApproval, type H2TrialApprovalMode } from "@/lib/admin/h2-trial-approval";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { createA2CommandKey, fetchA2ProposalByKey, isA2OutcomeUncertainError, type A2OperationRow } from "@/lib/admin/a2-client";
import { businessClock, businessZone, formatBusinessTimeFull } from "@/lib/admin/business-time";
import { ADVANCED_TRIAL_GROUPS, COMMON_TRIAL_PARAMS, TRIAL_PARAM_HELP, TRIAL_STATE_HELP } from "@/lib/admin/config-help/h2-trial";
import { displayAdminError, formatAdminApiError } from "@/lib/admin/error-messages";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import type { ProposeSpec } from "@/lib/admin/propose-or-execute";
import { useReach } from "@/lib/nav/use-reach";
import type { EditSpec } from "../design-kit";
import type { HCtx } from "./types";

type TrialParam = {
  key: string;
  name: string;
  sub?: string;
  cur: string;
  hot?: boolean | number;
  section?: "newonly" | "live" | "pricing";
  serverOnly?: boolean | number;
  readOnly?: boolean;
  businessDate?: string;
};

type TrialSession = {
  sid: string;
  userId?: number;
  displayName?: string | null;
  state: string;
  shadow: string;
  claimedAt?: string;
  expiresAt?: string;
  cancelledAt?: string;
  chargedAt?: string;
  pendingApproval?: { action?: string | null; submittedBy?: string | null; submittedAt?: string | null } | null;
};

/** 列表格里只留「待审批」，动作、提交人和时间写在抽屉里（PG-43 每格最多两行）。动作名后面带的记录编号抽屉标题下已有，这里去掉，一行放得下。 */
function trialApprovalMeta(approval: NonNullable<TrialSession["pendingApproval"]>, sid: string) {
  const bare = sid.replace(/^trial-/, "");
  return [approval.action?.split(" · ").filter((part) => !part.endsWith(bare)).join(" · "), approval.submittedBy, approval.submittedAt && formatBusinessTimeFull(approval.submittedAt, "—")].filter(Boolean).join(" · ");
}

type TrialState = { key: string; label: string; tone: string };

type TrialProduct = {
  productNo: string;
  name: string;
  priceUsdt?: number | string;
  stock?: number | string | null;
  status?: string;
  productType?: string;
  inventoryMode?: string;
  selectable?: boolean;
  unavailableReason?: string;
};

type H2Model = {
  stats?: Record<string, any>;
  params: TrialParam[];
  gates: Array<{ gate: string; note?: string }>;
  states: TrialState[];
  sessions: TrialSession[];
  trialProducts?: TrialProduct[];
  j1TrialGate?: { enabled?: boolean };
  modelA?: Record<string, any>;
  serverOnlyFields?: string[];
  sessionsPage?: { total: number; pageNum: number; pageSize: number };
};

/** 系统或别处决定的值：只读，不给修改入口（PCM-36）。 */
const READ_ONLY_KEYS = ["phaseOpen", "trialPriceUSD", "chargeFailRate"];
const TERMINAL_STATES = ["cancelled", "redeemed", "failed"];
const STATE_TONE: Record<string, StateTone> = { dim: "done", ok: "ok", warn: "warn", bad: "danger" };

/** 读取中不能依据旧数据写入（ST-32）。 */
const READING = "正在读取最新数据，读完再操作";
const LOCKED = "这条记录有结果未确认的操作，先处理页面上方的待确认";
const PARAM_LOCKED = "这项有结果未确认的修改，先处理页面上方的待确认";
const APPROVAL_SENT = "已提交，等待审批后执行。等超级管理员批准，进度到「操作记录与审批」看。";
// 后端的强制扣款走已退役的入口，固定回 410 TRIAL_EXPLICIT_PURCHASE_REQUIRED（AppTrialLifecycleService.redeemOnce）。
const CHARGE_RESULT = "强制扣款已停用，系统要求用户主动确认购买。请用户到 App 或 H5 的试用页确认购买";
const NO_WRITE = "这个账号已没有这项权限，请有权限的同事处理";
// 每个审批框都一样的话，收进生效标签的提示图标（N09）。发起人不能批自己的单（后端 A2_MAKER_CHECKER_REQUIRED）。
const APPROVAL_NOTE = "超级管理员批准后才执行，批准前这条记录不变。发起人不能批自己提交的单。";
const PROPOSAL_STATUS: Record<string, string> = { pending: "待审批", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" };

/** 一次写操作的全部内容。结果未知时原样保存，重试只能发这一份（OP-92、OP-94）。 */
type TrialProposal = { kind: "cancel" | "charge"; sid: string; owner: string; before: string; reason: string; label: string };
type TrialCommand = TrialProposal
  | { kind: "param"; paramKey: string; value: string; name: string; reason: string; label: string };
type PendingCommand = PendingMutationRecord & TrialCommand;
type RetiredCharge = { adminId: number } & (
  | { source: "legacy"; record: ReturnType<typeof pendingH2TrialApprovals>[number] }
  | { source: "redesign"; record: PendingCommand & TrialProposal }
);

const pendingCommands = createPendingMutationStore<PendingCommand>({
  storageKey: "nexion-admin-h2-trial-commands-v1",
  // 过了 24 小时不能再用原号重试，但记录和对象的锁都留着，到操作记录核对（OP-96）。
  retainExpiredRecords: true,
  isValidRecord: (record) => {
    const filled = (...values: unknown[]) => values.every((value) => typeof value === "string" && value.length > 0);
    if (!filled(record.reason, record.label)) return false;
    if (record.kind === "cancel" || record.kind === "charge") return filled(record.sid, record.owner, record.before);
    return record.kind === "param" && filled(record.paramKey, record.name) && typeof record.value === "string";
  },
});

const commandScope = (item: TrialCommand) => item.kind === "param" ? `param|${item.paramKey}` : `${item.kind}|${item.sid}`;
const isProposal = (item: TrialCommand): item is TrialProposal => item.kind === "cancel" || item.kind === "charge";
/** label 是进后端提案的 action，不改；页面上统一叫「强制扣款」。 */
const commandTitle = (item: TrialCommand) => (item.kind === "charge" ? `强制扣款 · ${item.sid}` : item.label);

function proposalSpec(item: TrialProposal): ProposeSpec {
  const charge = item.kind === "charge";
  const def = findHighOp(charge ? "h2_trial_charge" : "h2_trial_cancel")!;
  return {
    action: item.label,
    obj: `${item.owner} · ${item.sid}`,
    before: ({ idle: "待启动", active: "试用中", grace: "宽限中", extended: "已延长", cancelled: "已取消", redeemed: "已购买", failed: "扣款失败" } as Record<string, string>)[item.before] ?? item.before,
    after: charge ? "已扣款" : "已取消",
    type: charge ? "fund" : "sos",
    amplifies: charge,
    gate: { roles: [] },
    gateLabel: def.gateLabel,
    reason: item.reason,
    sourceDomain: "H2",
    command: def.buildCommand({ sid: item.sid }),
    target: def.buildTarget({ sid: item.sid }),
  };
}

function text(value: unknown, fallback = "—") {
  if (value == null || value === "") return fallback;
  return String(value);
}

function knownTrialOwner(session: TrialSession): boolean {
  return typeof session.userId === "number" && Number.isSafeInteger(session.userId) && session.userId > 0;
}

function trialOwnerLabel(session: TrialSession): string {
  if (!knownTrialOwner(session)) return "用户信息暂不可用";
  const name = typeof session.displayName === "string" ? operatorNicknameText(session.displayName.trim()) : "";
  return `用户编号 ${session.userId}${name ? ` · ${name}` : ""}`;
}

function trialProductReason(reason: string | undefined) {
  return formatAdminApiError(reason, "请到「商品管理与上架条件」核对商品状态");
}

/** 时区只写第一条（TX-25）。 */
function sessionTime(value: string | undefined, zoned = false) {
  return value ? `${formatBusinessTimeFull(value, "—")}${zoned ? `（${businessZone().label}）` : ""}` : "—";
}

/** 中间省略，全值在悬停和复制里（ST-04）。编号开头都一样，留开头分不出谁是谁。 */
function shortSid(sid: string) {
  return sid.length > 24 ? `${sid.slice(0, 6)}…${sid.slice(-12)}` : sid;
}

/** 接口给「USDT 数 + UVT 数 UVT」，前一个数补上单位。 */
function shadowText(value: string) {
  return operatorCopyText(text(value)).replace(/^([\d.,]+) \+ /, "$1 USDT + ");
}

function stateTone(state: TrialState | undefined): StateTone {
  // 宽限中、已延长都是还在走的正常状态，不用人处理，不用橙黄（VS-107）。
  if (state?.key === "active" || state?.key === "grace" || state?.key === "extended") return "progress";
  if (state?.key === "idle") return "neutral";
  // 扣款失败是历史结果，这条不用处理，不标红（DT-13）。
  if (state?.key === "failed") return "done";
  return STATE_TONE[state?.tone ?? ""] ?? "neutral";
}

function paramName(param: TrialParam) {
  return TRIAL_PARAM_HELP[param.key]?.label ?? operatorCopyText(param.name);
}

/** 页面上的值。接口存的单位和页面不同时按 scale 换算，比如毫秒写成秒。 */
function paramInput(param: TrialParam) {
  const scale = TRIAL_PARAM_HELP[param.key]?.scale;
  return scale ? String(Number(param.cur) / scale) : text(param.cur, "");
}

/** 金额带千分位，不舍入。 */
function usdt(value: unknown) {
  return `${Number(value).toLocaleString("en-US", { maximumFractionDigits: 6 })} USDT`;
}

function paramValue(param: TrialParam, product: TrialProduct | undefined) {
  const unit = TRIAL_PARAM_HELP[param.key]?.input?.unit;
  if (param.key === "trialOffsetCapUSD" && text(param.cur, "").trim() === "") return "不设上限";
  if (param.key === "trialProductId") return product?.name ?? text(param.cur);
  if (param.key === "trialPriceUSD") return usdt(param.cur);
  if (param.serverOnly) return operatorCopyText(text(param.cur));
  if (unit === "%") return `减 ${text(param.cur)}%`;
  return unit ? `${paramInput(param)} ${unit}` : text(param.cur);
}

function ParamRow({ ctx, param, trialProducts, send, reach, blocked, seatsLeft }: {
  ctx: HCtx;
  param: TrialParam;
  trialProducts: TrialProduct[];
  send: (item: TrialCommand) => Promise<void>;
  reach: ReturnType<typeof useReach>;
  blocked?: string;
  /** 今日实际剩余。修改框盖住了页面，不能让人回头看，直接写数字。 */
  seatsLeft?: string;
}) {
  const { openActionConfirm } = ctx;
  const help = TRIAL_PARAM_HELP[param.key];
  const name = paramName(param);
  const isOffsetCap = param.key === "trialOffsetCapUSD";
  const isProduct = param.key === "trialProductId";
  const current = paramInput(param);
  const currentProduct = isProduct ? trialProducts.find((product) => product.productNo === current) : undefined;
  const displayCurrent = paramValue(param, currentProduct);
  const when = help?.when ?? (param.section === "newonly" ? "立即生效，只影响新试用" : "立即生效");
  const productHref = `/devices/pricing?sku=${encodeURIComponent(current)}`;

  const submit = async (reason: string, value?: string) => {
    const normalizedValue = (value ?? "").trim();
    const rejected = help?.reject?.(normalizedValue);
    if (rejected) throw new Error(rejected);
    return send({ kind: "param", paramKey: param.key, value: help?.scale ? String(Math.round(Number(normalizedValue) * help.scale)) : normalizedValue, name, reason, label: `调整试用参数 · ${name}` });
  };

  const hasOtherProduct = isProduct && trialProducts.some((product) => product.selectable && product.productNo !== current);
  // 没有别的可选时没什么好改，不开框。当前商品可选就写「只有这一个」，也不可选就写「没有可选商品」。
  const deadEndLead = !isProduct || hasOtherProduct ? undefined : currentProduct?.selectable ? "现在只有这一个可选" : "没有可选商品";
  const productDeadEnd = deadEndLead && `${deadEndLead}。要换商品，先到「商品管理与上架条件」给别的在售商品开启「允许试用」`;
  // 商品退出「允许试用」后不会出现在候选列表里，这里读不到它（REV2-03）。
  const productMissing = isProduct && !currentProduct;

  const open = () => {
    // 怎么填留一句单位和范围，其余进提示图标。
    const hint = (hintText: string | undefined, more: string | undefined) => (hintText || more) && <>{hintText}{more && <Explain label={`${name}怎么填`} content={more} />}</>;
    const offsetClear = isOffsetCap && current ? "要清空点「不设上限」。" : "";
    const seatsNote = param.key === "seatsLeftToday" ? (seatsLeft === undefined ? "今日实际剩余读不到。" : `今日还可领取试用 ${seatsLeft} 人。`) : "";
    const edit: EditSpec | undefined = isProduct ? {
      kind: "select",
      label: "换成",
      options: trialProducts.map((product) => product.productNo),
      optionLabels: Object.fromEntries(trialProducts.map((product) => [product.productNo, (
        <span className="h2-product-option" key={product.productNo}>
          <span className="h2-product-dot" aria-hidden />
          <span className="h2-product-name">{product.name}{product.productNo === current && <small>当前</small>}</span>
          <span className="h2-product-meta">库存 {product.stock ?? 0} · {usdt(product.priceUsdt)}</span>
          {!product.selectable && <span className="h2-product-reason">不可选：{trialProductReason(product.unavailableReason)}</span>}
        </span>
      )])),
      // 当前商品在列表里只标「当前」，不能再选；不传 current，当前值就只出现这一处。
      disabledOptions: trialProducts.filter((product) => !product.selectable || product.productNo === current).map((product) => product.productNo),
    } : {
      kind: help?.input ? "number" : "text",
      current: isOffsetCap && !current ? "不设上限" : current,
      disallowCurrent: true,
      ...help?.input,
      emptyOption: isOffsetCap && current ? "不设上限" : undefined,
      hint: hint(help?.how && `${help.how}${offsetClear}${seatsNote}`, help?.howMore),
      preview: help?.whatIf && ((value) => {
        const rejected = help.reject?.(value);
        return rejected ? <span className="h2-field-warn">{rejected}</span> : help.whatIf!(value);
      }),
    };
    openActionConfirm({ briefKind: "config",
      action: `调整试用参数 · ${operatorCopyText(param.name)}`,
      title: <>调整{name}<Explain label={`${name}的说明`} rows={[{ k: "这是什么", v: help?.what ?? operatorCopyText(param.sub ?? "") }, { k: "显示位置", v: help?.where }]} /></>,
      detail: (
        <>
          <b>{name}</b> · 当前 <span className="mono">{displayCurrent}</span>。
          {param.serverOnly ? "这个值只在系统内部使用，页面不显示真实值。" : ""}
          {isProduct && currentProduct && !currentProduct.selectable ? (
            <span className="rd-form-error">当前目标商品不可用 · 库存 {currentProduct.stock ?? 0} · {trialProductReason(currentProduct.unavailableReason)}</span>
          ) : null}
        </>
      ),
      amplifies: false,
      edit,
      facts: isProduct ? <Facts>
        <Fact k="现在">{currentProduct?.name ?? (current || "未设置")}{productMissing && "，不在可选列表"}<Explain label="可选条件和商品编号" content={<>
          <p>{help?.howMore}</p>
          <RecordList label="可选商品编号" records={trialProducts.map((product) => ({ id: product.productNo, value: product.name, reference: product.productNo }))} />
        </>} /></Fact>
      </Facts> : undefined,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: "确认修改，立即生效",
      // 标题行写影响谁（OP-48）。这是什么和显示位置在标题旁的提示图标里。
      statedBrief: { impact: help?.impact ?? help?.what ?? operatorCopyText(param.sub ?? ""), check: "核对新值和生效范围，理由写清调整原因和依据。" },
      run: submit,
    });
  };

  // 名称这一列只放名称和提示图标（PG-46）；库存、阻断原因和入口是值的补充，排在值后面。
  const productLine = [
    currentProduct && `库存 ${currentProduct.stock ?? 0}`,
    productMissing && "不在可选列表",
    // 阻断原因要看得见，不只放在灰按钮的提示里（OP-126）。
    deadEndLead,
  ].filter(Boolean).join(" · ");
  const productLink = isProduct && reach(productHref) && <Link className="rd-link" href={productHref} prefetch={false}>到商品管理与上架条件查看</Link>;

  return (
    <ConfigRow
      name={name}
      what={help?.what ?? operatorCopyText(param.sub ?? "")}
      when={when}
      where={help?.where}
      note={[currentProduct && `商品编号 ${currentProduct.productNo}`, productDeadEnd].filter(Boolean).join("。") || undefined}
      value={displayCurrent}
      sub={productLine || productLink ? <>{productLine}{productLine && productLink && " · "}{productLink}</> : undefined}
      action={ctx.can("growth_h2_write") ? (describedBy) => <Button size="sm" aria-label={`调整 ${name}`} aria-describedby={describedBy} disabledReason={blocked ?? productDeadEnd} onClick={open}>调整</Button> : undefined}
    />
  );
}

function ReadOnlyRow({ param, action }: { param: TrialParam; action?: ReactNode }) {
  const help = TRIAL_PARAM_HELP[param.key];
  return <ConfigRow name={paramName(param)} what={help?.what ?? operatorCopyText(param.sub ?? "")} when={help?.when} value={paramValue(param, undefined)} action={action ?? "只读"} />;
}

export function H2Trial({ ctx }: { ctx: HCtx }) {
  const { toast, openActionConfirm } = ctx;
  const canWrite = ctx.can("growth_h2_write");
  const canCancel = ctx.can("growth_h2_session_cancel");
  const canCharge = ctx.can("growth_h2_session_charge");
  const adminSession = useAdminAuth((state) => state.session);
  const [legacyApprovals, setLegacyApprovals] = useState<ReturnType<typeof pendingH2TrialApprovals>>([]);
  const propose = usePropose();
  const reach = useReach();
  const [model, setModel] = useState<H2Model | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readAt, setReadAt] = useState("");
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionPageSize, setSessionPageSize] = useState(20);
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const [currentSid, setCurrentSid] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingCommand[]>([]);
  const [recovering, setRecovering] = useState("");
  const [retryRejected, setRetryRejected] = useState<string[]>([]);
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({});
  const [releasing, setReleasing] = useState<PendingCommand | null>(null);
  const [queryMissing, setQueryMissing] = useState<string[]>([]);
  const [retiredCharge, setRetiredCharge] = useState<RetiredCharge | null>(null);
  const [chargeLookup, setChargeLookup] = useState<{ missing?: boolean; ticket?: A2OperationRow; error?: string }>({});
  const [chargeLookupBusy, setChargeLookupBusy] = useState(false);
  const reloadEpochRef = useRef(0);
  const syncPending = useCallback(() => setPending(pendingCommands.list()), []);
  const notePending = (record: PendingCommand, note: string) => setPendingNotes((current) => ({ ...current, [record.commandKey]: note }));

  const reload = useCallback(async () => {
    const requestEpoch = ++reloadEpochRef.current;
    setLoading(true);
    try {
      const nextModel = (await fetchH2Trials(sessionPage, sessionPageSize)) as H2Model;
      if (requestEpoch !== reloadEpochRef.current) return;
      setModel(nextModel);
      setReadAt(businessClock(Date.now()));
      setError(null);
    } catch (err) {
      if (requestEpoch !== reloadEpochRef.current) return;
      setError(displayAdminError(err));
    } finally {
      if (requestEpoch === reloadEpochRef.current) setLoading(false);
    }
  }, [sessionPage, sessionPageSize]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => syncPending(), [syncPending]);
  useEffect(() => { setLegacyApprovals(adminSession ? pendingH2TrialApprovals(adminSession.adminId) : []); }, [adminSession]);

  // 后端仍返回旧邀请配置和延长参数，先过滤再分区，避免展示、计数或进入保存流程。
  const params = useMemo(() => (model?.params ?? []).filter((param) => param.key !== "autoChargeAtEnd" && ![
    "autoPushEnabled",
    "autoPushDelayMs",
    "autoPushCooldownHours",
    "autoPushMaxPerSession",
    "extensionDays",
    "highQualityThresholdUSD",
  ].includes(param.key)), [model?.params]);
  const states = useMemo(() => new Map((model?.states ?? []).map((state) => [state.key, state])), [model?.states]);
  const paramOf = (key: string) => params.find((param) => param.key === key);
  const isReadOnly = (param: TrialParam) => !!param.readOnly || READ_ONLY_KEYS.includes(param.key);
  const stats = model?.stats ?? {};
  const trialProducts = model?.trialProducts ?? [];
  const seats = paramOf("actualSeatsLeftToday");
  const seatsKnown = !!seats && seats.cur !== "UNKNOWN";
  const productNo = paramOf("trialProductId")?.cur;
  const product = trialProducts.find((item) => item.productNo === productNo);
  const phaseClosed = paramOf("phaseOpen")?.cur === "关闭";
  // 找不到也算不可用：商品退出「允许试用」后不在候选列表里，用户开始试用会被拒（REV2-03）。
  const productBlocked = !product || !product.selectable;
  const j1Closed = model?.j1TrialGate?.enabled === false;

  const commonParams = COMMON_TRIAL_PARAMS.flatMap((key) => paramOf(key) ?? []);
  const readOnlyParams = params.filter((param) => param.key !== "actualSeatsLeftToday" && isReadOnly(param));
  const advancedGroups = [
    ...ADVANCED_TRIAL_GROUPS.map((group) => ({ title: group.title as string, params: (group.keys as readonly string[]).flatMap((key) => paramOf(key) ?? []).filter((param) => !isReadOnly(param)) })),
    { title: "其他", params: params.filter((param) => !isReadOnly(param) && !(COMMON_TRIAL_PARAMS as readonly string[]).includes(param.key) && !ADVANCED_TRIAL_GROUPS.some((group) => (group.keys as readonly string[]).includes(param.key))) },
  ].filter((group) => group.params.length > 0);
  const advancedCount = advancedGroups.reduce((sum, group) => sum + group.params.length, 0);

  const sections: SectionNavItem[] = [
    { id: "common", label: "常改参数", alert: productBlocked },
    { id: "advanced", label: "高级设置" },
    { id: "readonly", label: "只读项", alert: phaseClosed },
    { id: "records", label: "试用记录", alert: pending.length > 0 },
  ];
  const nav = useSectionNav(sections, { ready: !!model, onReveal: (id) => setFolds((current) => ({ ...current, [id]: true })) });

  const sessions = model?.sessions ?? [];
  const currentIndex = sessions.findIndex((session) => session.sid === currentSid);
  const current = currentIndex >= 0 ? sessions[currentIndex] : null;

  /**
   * 四种写操作共用一条路，做法同提现审核：先把原操作存好再发（OP-92）。确定失败丢号，留在确认框；
   * 结果未知保号，关框，转成页面上方的待确认，同一对象确认前不能再操作（OP-93）。
   * 重试的是保留下来的原命令时，确定失败也证明不了原命令的结果，继续保留。
   */
  const sendCommand = async (item: TrialCommand) => {
    if (item.kind === "charge") throw new Error(CHARGE_RESULT);
    const scope = commandScope(item);
    const retained = pendingCommands.get(scope);
    const key = retained ?? (item.kind === "param" ? createH2CommandKey("h2-param") : createA2CommandKey("h2-trial-session"));
    pendingCommands.remember(scope, key, item);
    if (!pendingCommands.isDurablyStored(scope, key)) {
      if (!retained) pendingCommands.forget(scope, key);
      throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
    try {
      if (item.kind === "param") await updateH2TrialParam(item.paramKey, item.value, item.reason, key);
      else await propose(() => undefined, { ...proposalSpec(item), commandKey: key });
    } catch (cause) {
      const unknown = isProposal(item) ? isA2OutcomeUncertainError(cause) : isH2OutcomeUnknown(cause);
      if (!unknown && !retained) pendingCommands.forget(scope);
      syncPending();
      if (!unknown) throw cause;
      setCurrentSid(null);
      toast("结果未确认，不要重复操作。到页面上方按原操作重试或核查。", "warn");
      return;
    }
    pendingCommands.forget(scope);
    syncPending();
    if (isProposal(item)) {
      toast(APPROVAL_SENT, "success");
      await reload();
      return;
    }
    await reload();
    toast(`${item.name} 已更新`, "success");
  };

  /** 按原操作重试：同命令号、同内容、同理由，不接受新输入（OP-94）。只有成功才解除待确认。 */
  const retryPending = async (record: PendingCommand) => {
    if (record.expiresAt <= Date.now()) { syncPending(); return; }
    if (record.kind === "charge") { notePending(record, CHARGE_RESULT); return; }
    if (!(record.kind === "cancel" ? canCancel : canWrite)) { notePending(record, NO_WRITE); return; }
    // 要在 list() 之前查：list() 会从内存副本恢复已删除的记录，那样就成了换号重发。
    if (!pendingCommands.isDurablyStored(record.fingerprint, record.commandKey)) {
      pendingCommands.forget(record.fingerprint, record.commandKey);
      syncPending();
      toast("原操作已结束或过期，本次未再次发送。请先核对记录，再决定如何处理。", "warn");
      return;
    }
    setRetryRejected((current) => current.filter((key) => key !== record.commandKey));
    notePending(record, "");
    setRecovering(record.commandKey);
    try {
      await sendCommand(record);
    } catch (cause) {
      notePending(record, `重试没有成功：${displayAdminError(cause)} 这说明不了原操作的结果，原操作继续保留。`);
      setRetryRejected((current) => [...current, record.commandKey]);
    } finally {
      setRecovering("");
    }
  };

  /** 按命令号查原提案。查到就有了结果，可以解除；查不到说明不了没提交，继续保留（OP-95）。 */
  const checkPending = async (record: PendingCommand) => {
    setRecovering(record.commandKey);
    try {
      const original = await fetchA2ProposalByKey(record.commandKey);
      if (!original) {
        setQueryMissing((current) => [...current, record.commandKey]);
        notePending(record, "暂未查到原提案，结果仍待核实。原操作继续保留，不会重新提交。");
        return;
      }
      pendingCommands.forget(record.fingerprint, record.commandKey);
      syncPending();
      toast(`已找回原审批单 ${original.id}，${PROPOSAL_STATUS[original.status]}。结果到「操作记录与审批」看。`, "success");
      await reload();
    } catch (cause) {
      notePending(record, `查询没有成功：${displayAdminError(cause)} 原操作继续保留。`);
    } finally {
      setRecovering("");
    }
  };

  /** 重试被拒后，人核实过原操作的结果才解除。不发请求，后端仍按这条现在的状态校验。 */
  const releasePending = (record: PendingCommand) => {
    pendingCommands.forget(record.fingerprint, record.commandKey);
    syncPending();
    setReleasing(null);
    toast(isProposal(record) ? "已解除待确认，这条记录可以重新处理" : "已解除待确认，这项可以重新修改", "success");
  };

  const openSessionCancel = (session: TrialSession, stateLabel: string) => {
    openActionConfirm({ briefKind: "record",
      action: `强制取消试用 · ${session.sid}`,
      title: "强制取消试用",
      facts: <Facts>
        <Fact k="用户">{trialOwnerLabel(session)}</Fact>
        <Fact k="试用"><span data-mono="" title={session.sid}>{shortSid(session.sid)}</span></Fact>
        <Fact k="状态变化"><Change from={stateLabel} to="已取消" /></Fact>
      </Facts>,
      detail: "重复提交不会重复处理。",
      amplifies: false,
      confirmTone: "danger",
      effect: <><StatusTag tone="progress" filled explain={APPROVAL_NOTE}>批准后生效</StatusTag><IrreversibleTag /></>,
      confirmLabel: "提交审批",
      statedBrief: {
        impact: "这次试用结束，用户要等冷却期过去才能再试用",
        check: "核对用户和试用记录编号，理由写清依据或工单号。",
      },
      run: (reason) => sendCommand({ kind: "cancel", sid: session.sid, owner: trialOwnerLabel(session), before: session.state, reason, label: `强制取消试用 · ${session.sid}` }),
    });
  };

  const guideExtra = model && (
    <>
      <section className="rd-guide-section">
        <h3>开始试用前系统检查什么</h3>
        <ol>
          <li>
            <b>都通过才能开始试用，这些是系统固定的检查，这页改不了</b>
            <ol>
              <li>紧急停用开关和当前运营阶段都开着</li>
              <li>用户没有被风控判定为循环试用</li>
              <li>用户没有进行中的试用，试用也没转成过购买</li>
              <li>以前领过的，上次试用已取消或扣款失败，并过了冷却期</li>
              <li>目标商品是允许试用且已上架的可用实物商品</li>
              <li>今天还有免费名额，用户的实物设备位够</li>
              <li>本次若带有支付方式，该方式仍可用；不要求先绑卡</li>
            </ol>
          </li>
        </ol>
        {/* 后台门禁表不控制领取（闸门 2 第 33 条）：没有记录时不提它，有记录时写明只做记录。 */}
        {model.gates.length > 0 && <>
          <p>后台另外记着下面这些检查项，只做记录，不影响领取：</p>
          <dl>{model.gates.map((gate) => <div key={gate.gate}><dt>{gate.gate}：</dt><dd>只做记录{gate.note ? `，${gate.note}` : ""}</dd></div>)}</dl>
        </>}
      </section>
      <section className="rd-guide-section">
        <h3>试用流程的七种状态</h3>
        <p>状态由系统自动更新。</p>
        <dl>{model.states.map((state) => <div key={state.key}><dt><StatusTag tone={stateTone(state)}>{state.label}</StatusTag></dt> <dd>{TRIAL_STATE_HELP[state.key] ?? ""}</dd></div>)}</dl>
      </section>
    </>
  );

  const header = () => (
    <PageHeader
      pageId="H2"
      title="免费试用设置"
      summary="设置试用商品、时长和优惠，查看试用记录。"
      guideExtra={guideExtra}
      meta={model ? <span className="rd-toolbar">
        <span>{readAt ? `${readAt} 读取（${businessZone().label}）· ` : ""}打开时读取</span>
        <Button variant="ghost" size="sm" loading={loading} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void reload()}>刷新</Button>
      </span> : undefined}
      readOnly={model && !canWrite ? "你只能查看；修改试用设置要有这页的修改权限。" : undefined}
    />
  );

  const canQuery = ctx.can("platform_a2_read");
  const auditHref = "/platform/audit";
  const recoverLegacy = async (record: (typeof legacyApprovals)[number], mode: H2TrialApprovalMode) => {
    if (!adminSession || useAdminAuth.getState().session?.adminId !== adminSession.adminId) return;
    setRecovering(record.commandKey);
    try {
      const ticket = await submitH2TrialApproval(adminSession, record, "", mode);
      if (!ticket) {
        setQueryMissing((current) => [...current, record.commandKey]);
        toast("暂未查到原审批单，原命令号和记录继续保留。", "warn");
        return;
      }
      setLegacyApprovals(pendingH2TrialApprovals(adminSession.adminId));
      toast(`已找回原审批单 ${ticket.id}，${PROPOSAL_STATUS[ticket.status]}。`, "success");
      await reload();
    } catch (cause) {
      toast(displayAdminError(cause), "error");
    } finally {
      setRecovering("");
    }
  };

  const finishChargeLookup = (charge: RetiredCharge) => {
    if (charge.source === "legacy") finishRetiredH2TrialChargeLookup(charge.adminId, charge.record.sid, charge.record.commandKey);
    else pendingCommands.forget(charge.record.fingerprint, charge.record.commandKey);
    setLegacyApprovals(pendingH2TrialApprovals(charge.adminId));
    syncPending();
  };

  const queryRetiredCharge = async () => {
    if (!retiredCharge || !canCharge || adminSession?.adminId !== retiredCharge.adminId) return;
    setChargeLookupBusy(true);
    setChargeLookup({});
    try {
      const ticket = retiredCharge.source === "legacy"
        ? await submitH2TrialApproval(adminSession, retiredCharge.record, "", "lookup")
        : await fetchA2ProposalByKey(retiredCharge.record.commandKey, true);
      if (useAdminAuth.getState().session?.adminId !== retiredCharge.adminId) return;
      if (ticket && retiredCharge.source === "redesign" && (!ticket.mine
          || ticket.obj !== `${retiredCharge.record.owner} · ${retiredCharge.record.sid}`
          || ticket.action !== retiredCharge.record.label
          || ticket.operationCode !== "h2_trial_charge" || ticket.retiredOperation !== true)) {
        throw new Error("审批回执与原操作不符，原命令已保留，请到操作记录核对。");
      }
      if (ticket) finishChargeLookup(retiredCharge);
      setChargeLookup(ticket ? { ticket } : { missing: true });
      if (ticket) await reload();
    } catch (cause) {
      setChargeLookup({ error: `暂时无法确认原申请，原命令已保留。${displayAdminError(cause)}` });
    } finally {
      setChargeLookupBusy(false);
    }
  };

  const retiredChargeModal = retiredCharge && adminSession?.adminId === retiredCharge.adminId && canCharge && (
    <Modal title="核对旧扣款申请" busy={chargeLookupBusy} onClose={() => setRetiredCharge(null)} footer={<>
      <Button disabled={chargeLookupBusy} onClick={() => setRetiredCharge(null)}>关闭</Button>
      {chargeLookup.missing && <Button disabled={chargeLookupBusy} onClick={() => {
        if (useAdminAuth.getState().session?.adminId !== retiredCharge.adminId) return;
        finishChargeLookup(retiredCharge);
        setRetiredCharge(null);
      }}>结束本机核对</Button>}
      {!chargeLookup.ticket && <Button variant="primary" loading={chargeLookupBusy} onClick={() => void queryRetiredCharge()}>查询原申请</Button>}
    </>}>
      <Facts>
        <Fact k="原试用记录">{retiredCharge.source === "legacy" ? retiredCharge.record.obj : `${retiredCharge.record.owner} · ${retiredCharge.record.sid}`}</Fact>
        <Fact k="原操作理由"><span className="rd-pre">{retiredCharge.record.reason}</span></Fact>
      </Facts>
      <p>强制扣款已停用，这里只查原申请，不会新建或执行扣款。<Explain label="技术信息" content={`命令号 ${retiredCharge.record.commandKey}`} /></p>
      {chargeLookup.error && <p role="alert" className="rd-form-error">{chargeLookup.error}</p>}
      {chargeLookup.missing && <p role="status">未找到可核对的原申请，旧入口不能重建。可结束本机这一条核对；历史事实请到操作记录核查，不会删除服务端记录。</p>}
      {chargeLookup.ticket && <p role="status">已找到原审批单 {chargeLookup.ticket.id} · {{ pending: "待审批，已停用，不会执行", approved: "历史已执行", rejected: "历史已取消", withdrawn: "历史已撤回", expired: "已过期" }[chargeLookup.ticket.status]}。请到操作记录查看原申请和处理结果。</p>}
      {reach(auditHref, "platform_a2_read") && <Link className="rd-link" href={`${auditHref}?domain=H&object=${encodeURIComponent(retiredCharge.record.sid)}`} prefetch={false}>到操作记录与审批核对</Link>}
    </Modal>
  );

  // 待确认常显，读取失败时也在（OP-93）。
  const pendingNotices = [
    ...legacyApprovals.map((record) => record.op === "h2_trial_charge" ? (
      <Notice key={record.commandKey} tone="warn" title={`强制扣款 · ${record.sid} · 原结果未确认`}
        action={adminSession && canCharge && <Button size="sm" disabled={!!recovering} onClick={() => { setChargeLookup({}); setRetiredCharge({ adminId: adminSession.adminId, source: "legacy", record }); }}>核对旧申请</Button>}>
        原对象 {record.obj}，原理由 {record.reason}。旧强制扣款已停用，只能核对原申请。
      </Notice>
    ) : <Notice key={record.commandKey} tone="warn" title={`${H2_TRIAL_ACTIONS[record.op]} · ${record.sid} · 原结果未确认`}
      action={<>
        {canQuery && <Button size="sm" disabled={!!recovering} onClick={() => void recoverLegacy(record, "lookup")}>查询原操作</Button>}
        {record.expiresAt > Date.now() && <Button size="sm" disabled={!!recovering}
          disabledReason={!canCancel ? NO_WRITE : !queryMissing.includes(record.commandKey) ? "先查原审批单，明确查不到才能重试" : undefined}
          onClick={() => void recoverLegacy(record, "retry")}>按原操作重试</Button>}
      </>}>原对象 {record.obj}，原理由 {record.reason}。查询和重试均使用原命令号，结果确认前这条试用不能再操作。{record.expiresAt <= Date.now() && "已超过 24 小时，只能核对原审批单。"}</Notice>),
    ...pending.map((record) => {
    if (record.kind === "charge") return (
      <Notice key={record.fingerprint} tone="warn" title={`${commandTitle(record)} · 结果未确认`}
        action={adminSession && canCharge && <Button size="sm" disabled={!!recovering} onClick={() => { setChargeLookup({}); setRetiredCharge({ adminId: adminSession.adminId, source: "redesign", record }); }}>核对旧申请</Button>}>
        原对象 {record.owner} · {record.sid}，原理由 {record.reason}。旧强制扣款已停用，只能核对原申请。
      </Notice>
    );
    const proposal = isProposal(record);
    const expired = record.expiresAt <= Date.now();
    const object = proposal ? record.sid : record.paramKey;
    // 能查原提案就先查，明确查不到才重试；重试要当前还有这项写权（OP-93）。没有查询能力的路径只能重试，照实写。
    const canRetry = record.kind === "cancel" ? canCancel : canWrite;
    const needQuery = proposal && canQuery && !queryMissing.includes(record.commandKey);
    const retryBlock = !canRetry ? NO_WRITE : needQuery ? "先查原提案，明确查不到才能重试" : undefined;
    return (
      <Notice key={record.fingerprint} tone="warn" title={`${commandTitle(record)} · 结果未确认`} action={<>
        {proposal && canQuery && <Button size="sm" disabled={!!recovering} onClick={() => void checkPending(record)}>查询原提案</Button>}
        {!expired && <Button size="sm" disabled={!!recovering} disabledReason={retryBlock} onClick={() => void retryPending(record)}>按原操作重试</Button>}
        {!expired && retryRejected.includes(record.commandKey) && <Button size="sm" disabled={!!recovering} onClick={() => setReleasing(record)}>解除待确认</Button>}
      </>}>
        {formatBusinessTimeFull(new Date(record.createdAt).toISOString(), "—")}（{businessZone().label}）发出，
        {proposal ? "提案可能已经提交，批准前不会执行。这条记录确认前不能再操作。" : "可能已经生效。这项确认前不能再改。"}
        {proposal && !canQuery ? " 这个账号查不了原提案，请能看操作记录的同事核查。" : ""}
        {expired ? " 已超过 24 小时，不能再重试，请到操作记录与审批核对。" : !canRetry ? " 这个账号已没有这项权限，不能重试。" : needQuery ? " 先查原提案，查不到再按原操作重试。" : " 重发原内容，已成功的不会重复执行。"}
        {reach(auditHref, "platform_a2_read") && <> <Link className="rd-link" href={`${auditHref}?domain=H&object=${encodeURIComponent(object)}`} prefetch={false}>到操作记录与审批核对</Link></>}
        <Explain label="技术信息" content={`命令号 ${record.commandKey}${proposal ? ` ｜ 用户 ${record.owner}` : ` ｜ 新值 ${record.value || "空"}`} ｜ 理由 ${record.reason}`} />
        {!expired && pendingNotes[record.commandKey] && <div>{pendingNotes[record.commandKey]}</div>}
      </Notice>
    );
  })];
  const releaseModal = releasing && (
    <ReleaseModal label={commandTitle(releasing)} onCancel={() => setReleasing(null)} onConfirm={() => releasePending(releasing)}
      explain="重试被拒说明不了原操作的结果，先到操作记录确认它有没有生效。解除后原操作不再重试，系统仍按现在的状态校验。" />
  );

  if (loading && !model) {
    return <>{header()}{pendingNotices}<BlockState state="loading" title="试用数据加载中…" />{releaseModal}{retiredChargeModal}</>;
  }

  if (error || !model) {
    return <>{header()}{pendingNotices}<BlockState state="error" title="试用数据加载失败" detail={error ?? "没有收到数据，请重试；一直失败请联系值班同事。"} onRetry={() => void reload()} />{releaseModal}{retiredChargeModal}</>;
  }

  const phaseHref = "/growth/phase";
  const pricingHref = `/devices/pricing?sku=${encodeURIComponent(productNo ?? "")}`;
  const j1Href = "/emergency/kill-switch";
  const issues: Array<{ key: string; tone: StateTone; title: string; body: ReactNode }> = [];
  if (j1Closed) issues.push({ key: "j1", tone: "danger", title: "试用已被紧急停用开关关闭", body: <>用户现在不能开始试用。{reach(j1Href) && <Link className="rd-link" href={j1Href} prefetch={false}>去紧急停用开关</Link>}</> });
  if (productBlocked) issues.push({ key: "product", tone: "danger", title: "当前目标商品不可用", body: product
    ? <>库存 {product.stock ?? 0} · {trialProductReason(product.unavailableReason)}</>
    : <>商品编号 {productNo || "未设置"} 不在可选列表，用户现在不能开始试用。{reach(pricingHref) && <Link className="rd-link" href={pricingHref} prefetch={false}>到商品管理与上架条件核对「允许试用」</Link>}</> });
  if (phaseClosed) issues.push({ key: "phase", tone: "warn", title: "当前运营阶段不开放试用", body: <>用户现在不能开始试用。{reach(phaseHref) && <Link className="rd-link" href={phaseHref} prefetch={false}>去运营阶段设置</Link>}</> });
  if (!seatsKnown) issues.push({ key: "seats", tone: "warn", title: "今日实际剩余名额读不到", body: operatorCopyText(seats?.sub ?? "名额计数暂不可用，请稍后刷新；不能作为领取依据") });
  else if (Number(seats?.cur) === 0 && Number(paramOf("seatsLeftToday")?.cur) === 0) issues.push({ key: "seats", tone: "warn", title: "每日免费名额上限是 0", body: `用户不能开始试用，次日也不会恢复。${canWrite ? "要开放试用，调高「每日免费名额上限」。" : ""}` });
  else if (Number(seats?.cur) === 0) issues.push({ key: "seats", tone: "warn", title: "今日免费名额已用完", body: `用户今天不能开始试用，次日恢复。${canWrite ? "要今天多放名额，调高「每日免费名额上限」。" : ""}` });

  const lockedSids = new Set([...pending.flatMap((record) => isProposal(record) ? [record.sid] : []), ...legacyApprovals.map((record) => record.sid)]);
  const lockedParams = new Set(pending.flatMap((record) => record.kind === "param" ? [record.paramKey] : []));
  const paramBlock = (key: string) => loading ? READING : lockedParams.has(key) ? PARAM_LOCKED : undefined;
  const rows = sessions.map((session) => {
    const state = states.get(session.state);
    return { session, state, label: state?.label ?? session.state, tone: stateTone(state), terminal: TERMINAL_STATES.includes(session.state), owner: knownTrialOwner(session) };
  });
  const currentRow = current ? rows[currentIndex] : null;
  const sessionButtons = (row: (typeof rows)[number], variant: "row" | "drawer") => {
    const reason = row.session.pendingApproval ? "这条试用已有待审批操作，审批结束后才能再次处理" : lockedSids.has(row.session.sid) ? LOCKED : loading ? READING : row.owner ? undefined : "用户信息暂不可用";
    return {
      cancel: canCancel && <Button variant="danger-outline" size={variant === "row" ? "sm" : "md"} disabledReason={reason} onClick={() => openSessionCancel(row.session, row.label)}>强制取消</Button>,
    };
  };
  const total = model.sessionsPage?.total ?? sessions.length;
  const canHandle = canCancel;

  return (
    <>
      {header()}

      {pendingNotices}

      {/* 一切正常时一句话、不放大，和其他页的结论条一个样子（VS-23）；有异常时下面的提示条就是结论。 */}
      {loading
        ? <Conclusion state="unknown">{READING}</Conclusion>
        : issues.length === 0 && pending.length === 0 && legacyApprovals.length === 0 && <Conclusion state="ok">{Number(stats.activeSessions) > 0 ? "试用正常开放，进行中的试用由系统自动结束，没有要处理的事" : "试用正常开放，没有要处理的事"}</Conclusion>}

      {issues.map((issue) => <Notice key={issue.key} tone={issue.tone} title={issue.title}>{issue.body}</Notice>)}

      <StatBand label="试用经营摘要">
        <Stat tone="role-3" icon={Users} label="进行中的试用" value={stats.activeSessions == null ? "—" : Number(stats.activeSessions).toLocaleString()} unit="人"
          sub={`试用中 ${text(stats.inTrial)} · 宽限 ${text(stats.inGrace)} · 延长 ${text(stats.inExtended)}`}
          explain="试用中、宽限中和已延长的账号数，每个账号只算最近一次试用，不受下方分页影响。" />
        <Stat tone="role-4" icon={TrendingUp} label="试用转购买率" value={text(stats.trialBuyRate)}
          sub={`提前购买率 ${text(stats.earlyBuyRate)}`}
          explain={<>已购买账号 ÷ 全部已开始试用的账号，每个账号只算最近一次。提前购买率 = 按提前购买规则结算的账号 ÷ 全部已开始试用的账号。提前购买立减为 0 时，试用期内购买也不计入提前购买率。没有分母时显示「—」，表示不可计算，不是 0。绑卡转化 {text(stats.bindCardRate)}：绑卡环节已停用，不再计算。</>} />
        <Stat tone="role-2" icon={Ticket} label="今日实际剩余免费名额" value={seatsKnown ? text(seats?.cur) : "—"} unit={seatsKnown ? "人" : undefined}
          sub={seats?.businessDate && seats.businessDate !== "UNKNOWN" ? `日期 ${seats.businessDate}` : undefined}
          explain="按试用业务日实时读取，和 App 用同一个名额计数。「每日免费名额上限」是配置，这个是领取后的实际剩余。" />
        <Stat tone="role-other" icon={Ban} label="拦截反复薅试用" value={text(stats.k2Blocked)} unit="人"
          explain="被风控判定为循环试用的用户去重人数，这些用户已不能再试用。" />
      </StatBand>

      <div className="rd-config-layout">
        <div className="rd-config-grid">
          <div className="rd-config-rail">
            <SectionNav label="本页分组" items={sections} nav={nav} />
          </div>

          <div className="rd-config-groups">
            <div id={nav.anchor("common")}>
              <Panel title={<span tabIndex={-1} data-section-focus="">常改参数</span>} explainLabel="常改参数" icon={SlidersHorizontal} tone="role-4"
                explain={<>
                  <p>每项是什么、显示在哪、什么时候生效，看名称旁的提示；改一项存一项。</p>
                  <p>三种优惠可以叠加：实付 = 售价 − 购买减价 − 试用收益抵扣 − 提前购买立减，最低 0。提前购买立减只在试用期内有，在高级设置里改。</p>
                </>}>
                <ConfigList>
                  {commonParams.map((param) => <ParamRow key={param.key} ctx={ctx} param={param} trialProducts={trialProducts} send={sendCommand} reach={reach} blocked={paramBlock(param.key)} seatsLeft={seatsKnown ? seats?.cur : undefined} />)}
                </ConfigList>
              </Panel>
            </div>

            <div id={nav.anchor("advanced")}>
              <Fold title="高级设置" icon={Settings2} tone="role-other" summary={`${advancedCount} 项：${advancedGroups.map((group) => group.title).join("、")}`} open={!!folds.advanced} onOpenChange={(open) => setFolds((state) => ({ ...state, advanced: open }))}>
                {advancedGroups.map((group) => (
                  <div className="rd-config-group" key={group.title}>
                    <h3 className="rd-config-group-title">{group.title}</h3>
                    <ConfigList>
                      {group.params.map((param) => <ParamRow key={param.key} ctx={ctx} param={param} trialProducts={trialProducts} send={sendCommand} reach={reach} blocked={paramBlock(param.key)} />)}
                    </ConfigList>
                  </div>
                ))}
              </Fold>
            </div>

            <div id={nav.anchor("readonly")}>
              <Fold title="只读项" icon={Lock} tone="role-other" summary={phaseClosed ? "当前阶段不开放试用" : `${readOnlyParams.length} 项，由别处决定`} alert={phaseClosed} open={folds.readonly ?? phaseClosed} onOpenChange={(open) => setFolds((state) => ({ ...state, readonly: open }))}>
                <ConfigList>
                  {readOnlyParams.map((param) => (
                    <ReadOnlyRow key={param.key} param={param} action={
                      param.key === "phaseOpen" ? (reach(phaseHref) ? <Link className="rd-link" href={phaseHref} prefetch={false}>去修改</Link> : undefined)
                        : param.key === "trialPriceUSD" ? (reach(pricingHref) ? <Link className="rd-link" href={pricingHref} prefetch={false}>去修改</Link> : undefined)
                          : param.key === "chargeFailRate" ? "系统只读" : undefined
                    } />
                  ))}
                </ConfigList>
              </Fold>
            </div>

            <div id={nav.anchor("records")}>
              <Fold title="试用记录" icon={History} tone="role-3" summary={`共 ${total} 条，平时不用处理`} open={!!folds.records} onOpenChange={(open) => setFolds((state) => ({ ...state, records: open }))}
                explain={<>宽限中是正常状态：到期系统自动结束，不扣款，不用处理。{canHandle && "强制取消用于怀疑刷试用等风控介入，平时不用点，要提交审批。强制扣款已停用。"}</>}>
                {canCharge && <Notice tone="neutral">{CHARGE_RESULT}。</Notice>}
                <Table label="试用记录">
                  <thead>
                    <tr>
                      <Th icon={Users} tone="users">账户 · 试用记录编号</Th>
                      <Th>状态</Th>
                      <Th align="right" icon={Coins} tone="money">试用期累计收益</Th>
                      {canHandle && <Th sticky="end">操作</Th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const buttons = sessionButtons(row, "row");
                      return (
                        <Tr key={row.session.sid} selected={row.session.sid === currentSid} onOpen={loading ? undefined : () => setCurrentSid(row.session.sid)}>
                          <Td><Cell main={trialOwnerLabel(row.session)} sub={<span data-mono="">{shortSid(row.session.sid)}</span>} title={row.session.sid} full /></Td>
                          <Td><Cell main={<StatusTag tone={row.tone} explain={TRIAL_STATE_HELP[row.session.state]}>{row.label}</StatusTag>} sub={row.session.pendingApproval && <StatusTag tone="warn">待审批</StatusTag>} /></Td>
                          <Td align="right"><Cell num main={shadowText(row.session.shadow)} /></Td>
                          {canHandle && <Td sticky="end">{row.terminal ? "—" : <span className="rd-row-actions">{buttons.cancel}</span>}</Td>}
                        </Tr>
                      );
                    })}
                    {rows.length === 0 && <TableMessage columns={canHandle ? 4 : 3}>暂无试用记录；用户绑卡并开始试用后会显示在这里</TableMessage>}
                  </tbody>
                </Table>
                {rows.length > 0 && (
                  <Pager label="试用记录" total={total} page={model.sessionsPage?.pageNum ?? sessionPage} pageSize={model.sessionsPage?.pageSize ?? sessionPageSize} sizes={[10, 20, 50]} loading={loading} note={loading ? READING : undefined}
                    onPage={(next) => { reloadEpochRef.current += 1; setCurrentSid(null); setSessionPage(next); }}
                    onPageSize={(next) => { reloadEpochRef.current += 1; setCurrentSid(null); setSessionPage(1); setSessionPageSize(next); }} />
                )}
              </Fold>
            </div>
          </div>
        </div>
      </div>

      <Drawer open={!!currentRow} onClose={() => setCurrentSid(null)} title="试用记录" icon={History} tone="role-3"
        sub={currentRow && <><span title={currentRow.session.sid}>{shortSid(currentRow.session.sid)}</span> <IconButton aria-label="复制试用记录编号" data-size="sm" onClick={() => void navigator.clipboard?.writeText(currentRow.session.sid).then(() => toast("已复制试用记录编号", "success"), () => toast("复制失败，请手动选择编号", "error"))}><Copy size={13} aria-hidden /></IconButton></>}
        nav={{ hasPrev: !loading && currentIndex > 0, hasNext: !loading && currentIndex >= 0 && currentIndex < sessions.length - 1, onPrev: () => setCurrentSid(sessions[currentIndex - 1].sid), onNext: () => setCurrentSid(sessions[currentIndex + 1].sid) }}
        footer={currentRow && !currentRow.terminal && canHandle ? (
          <Decision explain="强制取消用于怀疑刷试用等风控介入，要提交审批，超级管理员批准后才执行。强制扣款已停用，用户要购买只能自己确认。" others={sessionButtons(currentRow, "drawer").cancel} />
        ) : undefined}>
        {currentRow && (
          <>
            <JudgmentPoints rows={[
              { label: "状态", value: <StatusTag tone={currentRow.tone}>{currentRow.label}</StatusTag>, reason: TRIAL_STATE_HELP[currentRow.session.state] },
              ...(currentRow.session.pendingApproval ? [{ label: "审批", value: <StatusTag tone="warn">待审批</StatusTag>, reason: <>{trialApprovalMeta(currentRow.session.pendingApproval, currentRow.session.sid)}<br />审批进度看「操作记录与审批」。{currentRow.session.pendingApproval.action?.startsWith(H2_TRIAL_ACTIONS.h2_trial_charge) && "这是强制扣款停用前提交的申请，批准也不会扣款，只能按原权限取消或撤回。"}</> }] : []),
              { label: "账户", value: trialOwnerLabel(currentRow.session), state: currentRow.owner ? undefined : "warn" },
              { label: "累计收益", value: shadowText(currentRow.session.shadow) },
              { label: "能不能处理", reason: canCharge && !currentRow.terminal ? `${CHARGE_RESULT}。` : undefined, value: currentRow.session.pendingApproval ? "等待审批结果，审批结束后才能再次处理" : currentRow.terminal ? "已结束，不能再取消或扣款" : lockedSids.has(currentRow.session.sid) ? "有结果未确认的操作，先处理页面上方的待确认" : !currentRow.owner ? "没有用户归属，不能取消或扣款" : canCancel ? "平时不用处理，确要干预才提交强制取消审批" : "这个账号只能查看" },
            ]} />
            <Facts>
              <Fact k="开始时间">{sessionTime(currentRow.session.claimedAt, true)}</Fact>
              <Fact k="到期时间">{sessionTime(currentRow.session.expiresAt, !currentRow.session.claimedAt)}</Fact>
            </Facts>
          </>
        )}
      </Drawer>

      {releaseModal}
      {retiredChargeModal}
    </>
  );
}

export default H2Trial;
