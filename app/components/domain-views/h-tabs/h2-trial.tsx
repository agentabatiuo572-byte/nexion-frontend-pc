"use client";

/**
 * 免费试用设置（配置页样板，PG-46）：先看试用现在开着没、用得怎么样，再改常用参数；
 * 其他参数进「高级设置」，别处决定的值进「只读项」，试用记录收起，单条详情用抽屉。
 * 修改权 growth_h2_write、取消权 growth_h2_session_cancel、扣款权 growth_h2_session_charge 各判各的，没有就不显示按钮（OP-124）。
 * 强制取消和强制扣款提交审批，批准后才执行；紧急关闭和参数修改直接生效。
 */
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Bell, BellOff, Ban, Coins, History, Lock, RefreshCw, Settings2, SlidersHorizontal, Ticket, TrendingUp, Users } from "lucide-react";
import { BlockState, Button, Cell, Conclusion, ConfigList, ConfigRow, Decision, Drawer, Explain, Fact, Facts, Fold, JudgmentPoints, Modal, Notice, PageHeader, Pager, Panel, SectionNav, Stat, StatBand, StatusTag, Table, TableMessage, Td, Th, Tr, useSectionNav, type SectionNavItem, type StateTone } from "@/app/components/rd";
import {
  fetchH2Trials,
  killH2AutoPush,
  updateH2TrialParam,
} from "@/lib/admin/h-client";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { createA2CommandKey, fetchA2ProposalByKey, isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { businessZone, formatBusinessTimeCompact, formatBusinessTimeFull } from "@/lib/admin/business-time";
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
};

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
  autoPushKilled?: boolean;
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
const PROPOSAL_STATUS: Record<string, string> = { pending: "待审批", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" };

/** 一次强制操作的全部内容。结果未知时原样保存，重试只能发这一份（OP-92、OP-94）。 */
type TrialProposal = { kind: "cancel" | "charge"; sid: string; owner: string; before: string; reason: string; label: string };
type PendingProposal = PendingMutationRecord & TrialProposal;

const pendingProposals = createPendingMutationStore<PendingProposal>({
  storageKey: "nexion-admin-h2-trial-commands-v1",
  isValidRecord: (record) => (record.kind === "cancel" || record.kind === "charge")
    && [record.sid, record.owner, record.before, record.reason, record.label].every((value) => typeof value === "string" && value.length > 0),
});

function proposalSpec(item: TrialProposal): ProposeSpec {
  const charge = item.kind === "charge";
  const def = findHighOp(charge ? "h2_trial_charge" : "h2_trial_cancel")!;
  return {
    action: item.label,
    obj: `${item.owner} · ${item.sid}`,
    before: item.before,
    after: charge ? "已扣款" : "cancelled",
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

function sessionTime(value: string | undefined) {
  return value ? `${formatBusinessTimeFull(value, "—")}（${businessZone().label}）` : "—";
}

/** 接口给「USDT 数 + UVT 数 UVT」，前一个数补上单位。 */
function shadowText(value: string) {
  return operatorCopyText(text(value)).replace(/^([\d.,]+) \+ /, "$1 USDT + ");
}

function stateTone(state: TrialState | undefined): StateTone {
  if (state?.key === "active") return "progress";
  if (state?.key === "idle") return "neutral";
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

function paramValue(param: TrialParam, product: TrialProduct | undefined) {
  const unit = TRIAL_PARAM_HELP[param.key]?.input?.unit;
  if (param.key === "trialOffsetCapUSD" && text(param.cur, "") === "") return "不设上限";
  if (param.key === "trialProductId") return product?.name ?? text(param.cur);
  if (param.key === "trialPriceUSD") return `${text(param.cur)} USDT`;
  if (param.serverOnly) return operatorCopyText(text(param.cur));
  if (unit === "%") return `${text(param.cur)}%`;
  return unit ? `${paramInput(param)} ${unit}` : text(param.cur);
}

function ParamRow({ ctx, param, trialProducts, onChanged, reach, blocked }: {
  ctx: HCtx;
  param: TrialParam;
  trialProducts: TrialProduct[];
  onChanged: () => Promise<void>;
  reach: ReturnType<typeof useReach>;
  blocked?: string;
}) {
  const { toast, openActionConfirm } = ctx;
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
    await updateH2TrialParam(param.key, help?.scale ? String(Math.round(Number(normalizedValue) * help.scale)) : normalizedValue, reason);
    await onChanged();
    toast(`${name} 已更新`);
  };

  // 只有当前这一个可选时没什么好改，弹窗里只能看到一个选项。写清楚要换得先去开启别的商品。
  const noOtherProduct = isProduct && !trialProducts.some((product) => product.selectable && product.productNo !== current);

  const open = () => {
    const edit: EditSpec = isProduct ? {
      kind: "select",
      current,
      disallowCurrent: true,
      options: trialProducts.map((product) => product.productNo),
      optionLabels: Object.fromEntries(trialProducts.map((product) => [
        product.productNo,
        `${product.name} · 商品编号 ${product.productNo} · 库存 ${product.stock ?? 0} · ${text(product.priceUsdt)} USDT${product.selectable ? "" : ` · 不可选：${trialProductReason(product.unavailableReason)}`}`,
      ])),
      disabledOptions: trialProducts.filter((product) => !product.selectable).map((product) => product.productNo),
      hint: help?.how,
    } : param.key === "autoPushEnabled" ? {
      kind: "select", current, disallowCurrent: true, options: ["开", "关"],
    } : {
      kind: help?.input ? "number" : "text",
      current: isOffsetCap && !current ? "不设上限" : current,
      disallowCurrent: true,
      ...help?.input,
      emptyOption: isOffsetCap && current ? "不设上限" : undefined,
      hint: help?.how,
      preview: help?.whatIf,
    };
    openActionConfirm({ briefKind: "config",
      action: `调整试用参数 · ${name}`,
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
      effect: <StatusTag tone="progress" filled>{when}</StatusTag>,
      confirmLabel: "确认修改，立即生效",
      statedBrief: { impact: `${help?.what ?? operatorCopyText(param.sub ?? "")}。${when}。`, check: "核对新值和生效范围，理由写清调整原因和依据。" },
      run: submit,
    });
  };

  return (
    <ConfigRow
      name={<>{name}{isProduct && reach(productHref) && <> <Link className="rd-link rd-config-link" href={productHref} prefetch={false}>去商品管理查看</Link></>}</>}
      what={help?.what ?? operatorCopyText(param.sub ?? "")}
      when={when}
      where={help?.where}
      value={displayCurrent}
      sub={currentProduct ? `商品编号 ${currentProduct.productNo} · 库存 ${currentProduct.stock ?? 0}${noOtherProduct ? " · 现在只有这一个可选" : ""}` : undefined}
      action={ctx.can("growth_h2_write") ? (describedBy) => <Button size="sm" aria-label={`调整 ${name}`} aria-describedby={describedBy} disabledReason={blocked ?? (noOtherProduct ? "没有别的可选商品。要换商品，先到「商品管理与上架条件」给别的在售商品开启「允许试用」" : undefined)} onClick={open}>调整</Button> : undefined}
    />
  );
}

function ReadOnlyRow({ param, action }: { param: TrialParam; action?: ReactNode }) {
  const help = TRIAL_PARAM_HELP[param.key];
  return <ConfigRow name={paramName(param)} what={help?.what ?? operatorCopyText(param.sub ?? "")} when={help?.when} value={paramValue(param, undefined)} action={action ?? "只读"} />;
}

export function H2Trial({ ctx }: { ctx: HCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const canWrite = ctx.can("growth_h2_write");
  const canCancel = ctx.can("growth_h2_session_cancel");
  const canCharge = ctx.can("growth_h2_session_charge");
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
  const [pending, setPending] = useState<PendingProposal[]>([]);
  const [recovering, setRecovering] = useState("");
  const [retryRejected, setRetryRejected] = useState<string[]>([]);
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({});
  const [releasing, setReleasing] = useState<PendingProposal | null>(null);
  const reloadEpochRef = useRef(0);
  const syncPending = useCallback(() => setPending(pendingProposals.list()), []);
  const notePending = (record: PendingProposal, note: string) => setPendingNotes((current) => ({ ...current, [record.commandKey]: note }));

  const reload = useCallback(async () => {
    const requestEpoch = ++reloadEpochRef.current;
    setLoading(true);
    try {
      const nextModel = (await fetchH2Trials(sessionPage, sessionPageSize)) as H2Model;
      if (requestEpoch !== reloadEpochRef.current) return;
      setModel(nextModel);
      setReadAt(formatBusinessTimeCompact(new Date().toISOString(), ""));
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

  const params = useMemo(() => (model?.params ?? []).filter((param) => param.key !== "autoChargeAtEnd"), [model?.params]);
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
  const productBlocked = !!product && !product.selectable;
  const j1Closed = model?.j1TrialGate?.enabled === false;
  const killed = !!model?.autoPushKilled;
  const pushOff = paramOf("autoPushEnabled")?.cur === "关";

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
   * 强制操作共用一条路，做法同提现审核：先把原操作存好再发（OP-92）。确定失败丢号，留在确认框；
   * 结果未知保号，关框，转成页面上方的待确认，这条记录确认前不能再操作（OP-93）。
   * 重试的是保留下来的原命令时，确定失败也证明不了原命令的结果，继续保留。
   */
  const sendProposal = async (item: TrialProposal) => {
    const scope = `${item.kind}|${item.sid}`;
    const retained = pendingProposals.get(scope);
    const key = retained ?? createA2CommandKey("h2-trial-session");
    pendingProposals.remember(scope, key, item);
    if (!pendingProposals.isDurablyStored(scope, key)) {
      if (!retained) pendingProposals.forget(scope, key);
      throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
    try {
      await propose(ctx.toast, { ...proposalSpec(item), commandKey: key });
    } catch (cause) {
      const unknown = isA2OutcomeUncertainError(cause);
      if (!unknown && !retained) pendingProposals.forget(scope);
      syncPending();
      if (!unknown) throw cause;
      setCurrentSid(null);
      toast("结果未确认，不要重复操作。到页面上方按原操作重试或核查。");
      return;
    }
    pendingProposals.forget(scope);
    syncPending();
  };

  /** 按原操作重试：同命令号、同内容、同理由，不接受新输入（OP-94）。只有成功才解除待确认。 */
  const retryPending = async (record: PendingProposal) => {
    // 要在 list() 之前查：list() 会从内存副本恢复已删除的记录，那样就成了换号重发。
    if (!pendingProposals.isDurablyStored(record.fingerprint, record.commandKey)) {
      pendingProposals.forget(record.fingerprint, record.commandKey);
      syncPending();
      toast("原操作已结束或过期，本次未再次发送。请先核对记录，再决定如何处理。");
      return;
    }
    setRetryRejected((current) => current.filter((key) => key !== record.commandKey));
    notePending(record, "");
    setRecovering(record.commandKey);
    try {
      await sendProposal({ kind: record.kind, sid: record.sid, owner: record.owner, before: record.before, reason: record.reason, label: record.label });
    } catch (cause) {
      notePending(record, `重试没有成功：${displayAdminError(cause)} 这说明不了原操作的结果，原命令继续保留。`);
      setRetryRejected((current) => [...current, record.commandKey]);
    } finally {
      setRecovering("");
    }
  };

  /** 按命令号查原提案。查到就有了结果，可以解除；查不到说明不了没提交，继续保留（OP-95）。 */
  const checkPending = async (record: PendingProposal) => {
    setRecovering(record.commandKey);
    try {
      const original = await fetchA2ProposalByKey(record.commandKey);
      if (!original) {
        notePending(record, "暂未查到原提案，结果仍待核实。原命令继续保留，不会重新提交。");
        return;
      }
      pendingProposals.forget(record.fingerprint, record.commandKey);
      syncPending();
      toast(`查到原提案，${PROPOSAL_STATUS[original.status]}。结果到「操作记录与审批」看。`);
    } catch (cause) {
      notePending(record, `查询没有成功：${displayAdminError(cause)} 原命令继续保留。`);
    } finally {
      setRecovering("");
    }
  };

  /** 重试被拒后，人核实过原操作的结果才解除。只放开本页的锁，不发请求，后端仍按这条现在的状态校验。 */
  const releasePending = (record: PendingProposal) => {
    pendingProposals.forget(record.fingerprint, record.commandKey);
    syncPending();
    setReleasing(null);
    toast("已解除待确认，这条记录可以重新处理");
  };

  const openSessionCancel = (session: TrialSession) => {
    openActionConfirm({ briefKind: "record",
      action: `强制取消试用 · ${session.sid}`,
      facts: <Facts><Fact k="用户">{trialOwnerLabel(session)}</Fact><Fact k="试用">{session.sid}</Fact></Facts>,
      detail: <>用户：<b>{trialOwnerLabel(session)}</b> · 试用：<b>{session.sid}</b>。这次试用会结束并标记为 <b>已取消</b>，重复提交不会重复处理。</>,
      amplifies: false,
      effect: <StatusTag tone="progress" filled>提交审批，批准后生效</StatusTag>,
      confirmLabel: "提交审批，批准后生效",
      statedBrief: {
        impact: "超级管理员批准后，这次试用结束，用户要等冷却期过去才能再试用。批准前试用状态不变。",
        check: "核对用户和试用记录编号，理由写清依据或工单号。",
      },
      run: (reason) => sendProposal({ kind: "cancel", sid: session.sid, owner: trialOwnerLabel(session), before: session.state, reason, label: `强制取消试用 · ${session.sid}` }),
    });
  };

  const openSessionCharge = (session: TrialSession) => {
    openActionConfirm({ briefKind: "funds",
      action: `强制触发扣款 · ${session.sid}`,
      facts: <Facts><Fact k="用户">{trialOwnerLabel(session)}</Fact><Fact k="试用">{session.sid}</Fact></Facts>,
      detail: <>用户：<b>{trialOwnerLabel(session)}</b> · 试用：<b>{session.sid}</b>。按当前试用规则重新计算并扣款，重复提交不会重复扣。会直接动用户的 USDT，需要有权限的管理员在「操作记录与审批」批准。</>,
      amplifies: true,
      coverageLead: "这项操作会直接扣用户的 USDT",
      confirmTone: "danger",
      effect: <StatusTag tone="progress" filled>提交审批，批准后生效</StatusTag>,
      confirmLabel: "提交审批，批准后生效",
      statedBrief: {
        impact: "超级管理员批准后才执行，批准前不动用户的钱。金额批准时按当前规则算，后端可能拒绝，结果到「操作记录与审批」看。",
        check: "核对用户和试用记录编号，理由写清依据或工单号。",
      },
      run: (reason) => sendProposal({ kind: "charge", sid: session.sid, owner: trialOwnerLabel(session), before: session.state, reason, label: `强制触发扣款 · ${session.sid}` }),
    });
  };

  const openPushKill = () => {
    openConfirm({ briefKind: "record",
      action: "紧急关闭试用邀请弹窗",
      detail: <>记下紧急关闭，这页不能重新打开。App 和 H5 现在不自动弹试用邀请，这次关闭暂不影响用户。</>,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      reason: true,
      reasonPlaceholder: "写清调整原因和依据",
      statedBrief: { impact: "邀请开关立即变成关。App 和 H5 现在不自动弹，暂不影响用户，点试用卡领取也不受影响。关闭后这页不能重新打开，这次操作记入操作记录。", check: "确认要关闭，理由写清原因和依据。" },
      confirmTone: "danger",
      okLabel: "确认关闭，立即生效",
      run: async (reason) => {
        await killH2AutoPush(reason);
        await reload();
        toast("试用邀请弹窗已关闭");
      },
    });
  };

  const guideExtra = model && (
    <>
      <section className="rd-guide-section">
        <h3>开始试用前系统检查什么</h3>
        <p>都通过才能开始试用，这些是系统固定的检查，这页改不了：</p>
        <ol>
          <li>紧急停用开关和当前运营阶段都开着</li>
          <li>用户没有被风控判定为循环试用</li>
          <li>用户没有进行中的试用、没买过，也过了冷却期</li>
          <li>目标商品可用，今天还有名额，用户的设备位够</li>
        </ol>
        {model.gates.length === 0 ? <p>后台配置的检查项：未配置检查项</p> : (
          <dl>{model.gates.map((gate) => <div key={gate.gate}><dt>{gate.gate}：</dt><dd>已启用{gate.note ? `，${gate.note}` : ""}</dd></div>)}</dl>
        )}
      </section>
      <section className="rd-guide-section">
        <h3>试用流程的七种状态</h3>
        <p>状态由系统自动更新。</p>
        <dl>{model.states.map((state) => <div key={state.key}><dt>{state.label}：</dt><dd>{TRIAL_STATE_HELP[state.key] ?? ""}</dd></div>)}</dl>
      </section>
    </>
  );

  const header = () => (
    <PageHeader
      pageId="H2"
      title="免费试用设置"
      summary="设置试用商品、时长和优惠，查看试用记录。"
      guideExtra={guideExtra}
      meta={model ? <>{readAt ? `${readAt} 读取（${businessZone().label}）· ` : ""}打开时读取 <Button variant="ghost" size="sm" loading={loading} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void reload()}>刷新</Button></> : undefined}
      readOnly={model && !canWrite ? "你只能查看；修改试用设置要有这页的修改权限。" : undefined}
    />
  );

  const canQuery = ctx.can("platform_a2_read");
  const auditHref = "/platform/audit";
  // 待确认常显，读取失败时也在（OP-93）。
  const pendingNotices = pending.map((record) => (
    <Notice key={record.fingerprint} tone="warn" title={`${record.label} · 结果未确认`} action={<>
      {canQuery && <Button size="sm" disabled={!!recovering} onClick={() => void checkPending(record)}>查询原提案</Button>}
      <Button size="sm" disabled={!!recovering} onClick={() => void retryPending(record)}>按原操作重试</Button>
      {retryRejected.includes(record.commandKey) && <Button size="sm" disabled={!!recovering} onClick={() => setReleasing(record)}>解除待确认</Button>}
    </>}>
      {formatBusinessTimeFull(new Date(record.createdAt).toISOString(), "—")}（{businessZone().label}）发出，提案可能已经提交，批准前不会执行。这条记录确认前不能再操作。
      {canQuery ? " 先查原提案，查不到再按原操作重试。" : " 这个账号查不了原提案，按原操作重试，或请能看操作记录的同事核查。"}
      {reach(auditHref, "platform_a2_read") && <> <Link className="rd-link" href={`${auditHref}?domain=H&object=${encodeURIComponent(record.sid)}`} prefetch={false}>到操作记录核查</Link></>}
      <Explain label="技术信息" content={`命令号 ${record.commandKey} ｜ 用户 ${record.owner} ｜ 理由 ${record.reason}`} />
      {pendingNotes[record.commandKey] && <div>{pendingNotes[record.commandKey]}</div>}
    </Notice>
  ));
  const releaseModal = releasing && (
    <Modal title="解除待确认" onClose={() => setReleasing(null)} footer={<>
      <Button onClick={() => setReleasing(null)}>取消</Button>
      <Button variant="primary" onClick={() => releasePending(releasing)}>确认解除</Button>
    </>}>
      <p><b>{releasing.label}</b></p>
      <p>重试被拒说明不了原操作的结果。先到操作记录确认原提案有没有生成，再解除。</p>
      <p>解除后这条记录可以重新处理，原操作不再重试，系统仍按这条现在的状态校验。这一步只放开本页的锁，不发请求，不写操作记录。</p>
    </Modal>
  );

  if (loading && !model) {
    return <>{header()}{pendingNotices}<BlockState state="loading" title="试用数据加载中…" />{releaseModal}</>;
  }

  if (error || !model) {
    return <>{header()}{pendingNotices}<BlockState state="error" title="试用数据加载失败" detail={error ?? "没有收到数据，请重试；一直失败请联系值班同事。"} onRetry={() => void reload()} />{releaseModal}</>;
  }

  const phaseHref = "/growth/phase";
  const pricingHref = `/devices/pricing?sku=${encodeURIComponent(productNo ?? "")}`;
  const j1Href = "/emergency/kill-switch";
  const issues: Array<{ key: string; tone: StateTone; title: string; body: ReactNode }> = [];
  if (j1Closed) issues.push({ key: "j1", tone: "danger", title: "试用已被紧急停用开关关闭", body: <>用户现在不能开始试用，强制扣款也不会执行。{reach(j1Href) && <Link className="rd-link" href={j1Href} prefetch={false}>去紧急停用开关</Link>}</> });
  if (productBlocked) issues.push({ key: "product", tone: "danger", title: "当前目标商品不可用", body: <>库存 {product?.stock ?? 0} · {trialProductReason(product?.unavailableReason)}</> });
  if (phaseClosed) issues.push({ key: "phase", tone: "warn", title: "当前运营阶段不开放试用", body: <>用户现在不能开始试用。{reach(phaseHref) && <Link className="rd-link" href={phaseHref} prefetch={false}>去运营阶段设置</Link>}</> });
  if (!seatsKnown) issues.push({ key: "seats", tone: "warn", title: "今日实际剩余名额读不到", body: operatorCopyText(seats?.sub ?? "名额计数暂不可用，请稍后刷新；不能作为领取依据") });
  else if (Number(seats?.cur) === 0 && Number(paramOf("seatsLeftToday")?.cur) === 0) issues.push({ key: "seats", tone: "warn", title: "每日免费名额上限是 0", body: `用户不能开始试用，次日也不会恢复。${canWrite ? "要开放试用，调高「每日免费名额上限」。" : ""}` });
  else if (Number(seats?.cur) === 0) issues.push({ key: "seats", tone: "warn", title: "今日免费名额已用完", body: `用户今天不能开始试用，次日恢复。${canWrite ? "要今天多放名额，调高「每日免费名额上限」。" : ""}` });

  const lockedSids = new Set(pending.map((record) => record.sid));
  const rows = sessions.map((session) => {
    const state = states.get(session.state);
    return { session, state, label: state?.label ?? session.state, tone: stateTone(state), terminal: TERMINAL_STATES.includes(session.state), owner: knownTrialOwner(session) };
  });
  const currentRow = current ? rows[currentIndex] : null;
  const sessionButtons = (row: (typeof rows)[number], variant: "row" | "drawer") => {
    const reason = lockedSids.has(row.session.sid) ? LOCKED : loading ? READING : row.owner ? undefined : "用户信息暂不可用";
    return {
      cancel: canCancel && <Button size={variant === "row" ? "sm" : "md"} disabledReason={reason} onClick={() => openSessionCancel(row.session)}>强制取消</Button>,
      charge: canCharge && <Button size={variant === "row" ? "sm" : "md"} variant={variant === "row" ? "secondary" : "danger-outline"} disabledReason={reason} onClick={() => openSessionCharge(row.session)}>强制扣款</Button>,
    };
  };
  const total = model.sessionsPage?.total ?? sessions.length;
  const canHandle = canCancel || canCharge;

  return (
    <>
      {header()}

      {pendingNotices}

      {/* 一切正常时一句话、不放大，和其他页的结论条一个样子（VS-23）；有异常时下面的提示条就是结论。 */}
      {loading
        ? <Conclusion state="unknown">{READING}</Conclusion>
        : issues.length === 0 && pending.length === 0 && <Conclusion state="ok">{Number(stats.activeSessions) > 0 ? "试用正常开放，进行中的试用由系统自动结束，没有要处理的事" : "试用正常开放，没有要处理的事"}</Conclusion>}

      {issues.map((issue) => <Notice key={issue.key} tone={issue.tone} title={issue.title}>{issue.body}</Notice>)}

      <StatBand label="试用经营摘要">
        <Stat tone="role-3" icon={Users} label="进行中的试用" value={stats.activeSessions == null ? "—" : Number(stats.activeSessions).toLocaleString()} unit="人"
          sub={`试用中 ${text(stats.inTrial)} · 宽限 ${text(stats.inGrace)} · 延长 ${text(stats.inExtended)}`}
          explain="试用中、宽限中和已延长的账号数，每个账号只算最近一次试用，不受下方分页影响。" />
        <Stat tone="role-4" icon={TrendingUp} label="试用转购买率" value={text(stats.trialBuyRate)}
          sub={`提前购买 ${text(stats.earlyBuyRate)}（占已开始试用）`}
          explain={<>已购买账号 ÷ 全部已开始试用的账号，每个账号只算最近一次。提前购买 = 试用期内买、按提前购买规则结算的账号 ÷ 全部已开始试用的账号。没有分母时显示「—」，表示不可计算，不是 0。绑卡转化 {text(stats.bindCardRate)}：绑卡环节已退役，不再计算。</>} />
        <Stat tone="role-2" icon={Ticket} label="今日实际剩余免费名额" value={seatsKnown ? text(seats?.cur) : "—"} unit={seatsKnown ? "张" : undefined}
          sub={seats?.businessDate && seats.businessDate !== "UNKNOWN" ? `日期 ${seats.businessDate}` : undefined}
          explain="按试用业务日实时读取，和 App 用同一个名额计数。「每日免费名额上限」是配置，这个是领取后的实际剩余。" />
        <Stat tone="role-other" icon={Ban} label="拦截反复薅试用" value={text(stats.k2Blocked)} unit="人" sub="这些用户已不能再试用"
          explain="被风控判定为循环试用的用户去重人数。" />
      </StatBand>

      <div className="rd-config-layout">
        <div className="rd-config-grid">
          <div className="rd-config-rail">
            <SectionNav label="本页分组" items={sections} nav={nav} />
            <Panel title="试用邀请弹窗" icon={killed || pushOff ? BellOff : Bell} tone={killed ? "warn" : pushOff ? "done" : "ok"} headingLevel={2}>
              <div className="rd-push-state">
                <StatusTag tone={killed ? "warn" : pushOff ? "done" : "ok"}>{killed ? "试用邀请弹窗已关闭" : pushOff ? "自动推送已关" : "开启中"}</StatusTag>
                <p>{killed ? "已紧急关闭，这页不能重新打开。" : "出问题时先关掉它，立即生效。关闭后这页不能重新打开。用户点试用卡领取不受影响。"}</p>
                <p>App 和 H5 现在不自动弹这个邀请，这里的开关和高级设置「邀请弹窗」这几项暂不影响用户。</p>
                {canWrite && !killed && <Button variant="danger-outline" disabledReason={loading ? READING : undefined} onClick={openPushKill}>紧急关闭试用邀请弹窗</Button>}
              </div>
            </Panel>
          </div>

          <div className="rd-config-groups">
            <div id={nav.anchor("common")}>
              <Panel title={<span tabIndex={-1} data-section-focus="">常改参数</span>} icon={SlidersHorizontal} tone="role-4" sub="每项写明什么时候生效，改一项存一项">
                <ConfigList>
                  {commonParams.map((param) => <ParamRow key={param.key} ctx={ctx} param={param} trialProducts={trialProducts} onChanged={reload} reach={reach} blocked={loading ? READING : undefined} />)}
                </ConfigList>
                <p className="rd-config-note">三种优惠可以叠加：实付 = 售价 − 购买折扣 − 试用收益抵扣 − 提前购买立减，最低 0。提前购买立减只在试用期内有，在高级设置里改。</p>
              </Panel>
            </div>

            <div id={nav.anchor("advanced")}>
              <Fold title="高级设置" icon={Settings2} tone="role-other" summary={`${advancedCount} 项：${advancedGroups.map((group) => group.title).join("、")}`} open={!!folds.advanced} onOpenChange={(open) => setFolds((state) => ({ ...state, advanced: open }))}>
                {advancedGroups.map((group) => (
                  <div className="rd-config-group" key={group.title}>
                    <h3 className="rd-config-group-title">{group.title}</h3>
                    <ConfigList>
                      {group.params.map((param) => <ParamRow key={param.key} ctx={ctx} param={param} trialProducts={trialProducts} onChanged={reload} reach={reach} blocked={loading ? READING : undefined} />)}
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
              <Fold title="试用记录" icon={History} tone="role-3" summary={`共 ${total} 条，平时不用处理`} open={!!folds.records} onOpenChange={(open) => setFolds((state) => ({ ...state, records: open }))}>
                <p className="rd-config-note">宽限中是正常状态：到期系统自动结束，不扣款，不用处理。{canHandle && "强制取消用于怀疑刷试用等风控介入，强制扣款用于应急结算，平时不用点，都要提交审批。"}</p>
                <Table label="试用记录">
                  <thead>
                    <tr>
                      <Th icon={Users} tone="users">账户 · 试用记录编号</Th>
                      <Th>状态</Th>
                      <Th align="right" icon={Coins} tone="money">试用期累计收益</Th>
                      {canHandle && <Th>操作</Th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const buttons = sessionButtons(row, "row");
                      return (
                        <Tr key={row.session.sid} selected={row.session.sid === currentSid} onOpen={loading ? undefined : () => setCurrentSid(row.session.sid)}>
                          <Td><Cell main={trialOwnerLabel(row.session)} sub={<span data-mono="">{row.session.sid}</span>} title={row.session.sid} full /></Td>
                          <Td><StatusTag tone={row.tone} explain={TRIAL_STATE_HELP[row.session.state]}>{row.label}</StatusTag></Td>
                          <Td align="right"><Cell num main={shadowText(row.session.shadow)} /></Td>
                          {canHandle && <Td>{row.terminal ? "—" : <span className="rd-row-actions">{buttons.cancel}{buttons.charge}</span>}</Td>}
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

      <Drawer open={!!currentRow} onClose={() => setCurrentSid(null)} title="试用记录" sub={currentRow?.session.sid} icon={History} tone="role-3"
        nav={{ hasPrev: !loading && currentIndex > 0, hasNext: !loading && currentIndex >= 0 && currentIndex < sessions.length - 1, onPrev: () => setCurrentSid(sessions[currentIndex - 1].sid), onNext: () => setCurrentSid(sessions[currentIndex + 1].sid) }}
        footer={currentRow && !currentRow.terminal && canHandle ? (
          <Decision note="强制取消用于怀疑刷试用等风控介入，强制扣款用于应急结算。两个都要提交审批，超级管理员批准后才执行。" danger={sessionButtons(currentRow, "drawer").charge} others={sessionButtons(currentRow, "drawer").cancel} />
        ) : undefined}>
        {currentRow && (
          <>
            <JudgmentPoints rows={[
              { label: "状态", value: <StatusTag tone={currentRow.tone}>{currentRow.label}</StatusTag>, reason: TRIAL_STATE_HELP[currentRow.session.state] },
              { label: "账户", value: trialOwnerLabel(currentRow.session), state: currentRow.owner ? undefined : "warn" },
              { label: "累计收益", value: shadowText(currentRow.session.shadow) },
              { label: "能不能处理", value: currentRow.terminal ? "已结束，不能再取消或扣款" : lockedSids.has(currentRow.session.sid) ? "有结果未确认的操作，先处理页面上方的待确认" : !currentRow.owner ? "没有用户归属，不能取消或扣款" : canHandle ? "平时不用处理，确要干预才提交下面的操作" : "这个账号只能查看" },
            ]} />
            <Facts>
              <Fact k="试用记录编号"><span data-mono="">{currentRow.session.sid}</span></Fact>
              <Fact k="开始时间">{sessionTime(currentRow.session.claimedAt)}</Fact>
              <Fact k="到期时间">{sessionTime(currentRow.session.expiresAt)}</Fact>
            </Facts>
          </>
        )}
      </Drawer>

      {releaseModal}
    </>
  );
}

export default H2Trial;
