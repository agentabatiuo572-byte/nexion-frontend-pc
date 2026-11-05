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
import { BellOff, Ban, Coins, History, Lock, RefreshCw, Settings2, SlidersHorizontal, Ticket, TrendingUp, Users } from "lucide-react";
import { BlockState, Button, Cell, ConfigList, ConfigRow, Decision, Drawer, Fact, Facts, Fold, JudgmentPoints, Notice, PageHeader, Pager, Panel, SectionNav, Stat, StatBand, StatusTag, Table, TableMessage, Td, Th, Tr, useSectionNav, type SectionNavItem, type StateTone } from "@/app/components/rd";
import {
  fetchH2Trials,
  killH2AutoPush,
  updateH2TrialParam,
} from "@/lib/admin/h-client";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { createA2CommandKey, isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { ADVANCED_TRIAL_GROUPS, COMMON_TRIAL_PARAMS, TRIAL_PARAM_HELP, TRIAL_STATE_HELP } from "@/lib/admin/config-help/h2-trial";
import { displayAdminError, formatAdminApiError } from "@/lib/admin/error-messages";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
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

/** 提案结果未知时，重试要用同一个命令号；换了内容才换号（OP-94）。 */
const commandAttempts = createSlotAttemptStore({ storageKey: "nexion-admin-h2-trial-commands-v1" });

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

function stateTone(state: TrialState | undefined): StateTone {
  if (state?.key === "active") return "progress";
  if (state?.key === "idle") return "neutral";
  return STATE_TONE[state?.tone ?? ""] ?? "neutral";
}

function paramName(param: TrialParam) {
  return TRIAL_PARAM_HELP[param.key]?.label ?? operatorCopyText(param.name);
}

function paramValue(param: TrialParam, product: TrialProduct | undefined) {
  const unit = TRIAL_PARAM_HELP[param.key]?.input?.unit;
  if (param.key === "trialOffsetCapUSD" && text(param.cur, "") === "") return "不设上限";
  if (param.key === "trialProductId") return product?.name ?? text(param.cur);
  if (param.key === "trialPriceUSD") return `${text(param.cur)} USD`;
  if (param.serverOnly) return operatorCopyText(text(param.cur));
  if (unit === "%") return `${text(param.cur)}%`;
  return unit ? `${text(param.cur)} ${unit}` : text(param.cur);
}

function ParamRow({ ctx, param, trialProducts, onChanged, reach }: {
  ctx: HCtx;
  param: TrialParam;
  trialProducts: TrialProduct[];
  onChanged: () => Promise<void>;
  reach: ReturnType<typeof useReach>;
}) {
  const { toast, openActionConfirm } = ctx;
  const help = TRIAL_PARAM_HELP[param.key];
  const name = paramName(param);
  const isOffsetCap = param.key === "trialOffsetCapUSD";
  const isProduct = param.key === "trialProductId";
  const current = text(param.cur, "");
  const currentProduct = isProduct ? trialProducts.find((product) => product.productNo === current) : undefined;
  const displayCurrent = paramValue(param, currentProduct);
  const when = help?.when ?? (param.section === "newonly" ? "立即生效，只影响新开始的试用" : "立即生效");
  const productHref = `/devices/pricing?sku=${encodeURIComponent(current)}`;

  const submit = async (reason: string, value?: string) => {
    const normalizedValue = (value ?? "").trim();
    await updateH2TrialParam(param.key, normalizedValue, reason);
    await onChanged();
    toast(`${name} 已更新`);
  };

  const open = () => {
    const edit: EditSpec = isProduct ? {
      kind: "select",
      current,
      options: trialProducts.map((product) => product.productNo),
      optionLabels: Object.fromEntries(trialProducts.map((product) => [
        product.productNo,
        `${product.name} · ${product.productNo} · 库存 ${product.stock ?? 0} · $${text(product.priceUsdt)}${product.selectable ? "" : ` · 不可选：${trialProductReason(product.unavailableReason)}`}`,
      ])),
      disabledOptions: trialProducts.filter((product) => !product.selectable).map((product) => product.productNo),
      hint: help?.how,
    } : param.key === "autoPushEnabled" ? {
      kind: "select", current, options: ["开", "关"],
    } : {
      kind: help?.input ? "number" : "text",
      current: isOffsetCap && !current ? "不设上限" : current,
      ...help?.input,
      allowEmpty: isOffsetCap,
      hint: help?.how,
      preview: help?.whatIf,
    };
    openActionConfirm({
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
      confirmLabel: "确认修改",
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
      sub={currentProduct ? `${currentProduct.productNo} · 库存 ${currentProduct.stock ?? 0}` : undefined}
      action={ctx.can("growth_h2_write") ? (describedBy) => <Button size="sm" aria-label={`调整 ${name}`} aria-describedby={describedBy} onClick={open}>调整</Button> : undefined}
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
  const reloadEpochRef = useRef(0);

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
    { id: "records", label: "试用记录" },
  ];
  const nav = useSectionNav(sections, { ready: !!model, onReveal: (id) => setFolds((current) => ({ ...current, [id]: true })) });

  const sessions = model?.sessions ?? [];
  const currentIndex = sessions.findIndex((session) => session.sid === currentSid);
  const current = currentIndex >= 0 ? sessions[currentIndex] : null;

  /** 确认框等提案的结果：失败时不关框，理由留着（OP-44）。 */
  const submitProposal = async (spec: ProposeSpec) => {
    const slot = `${spec.command.op}|${spec.obj}`;
    const fingerprint = JSON.stringify([spec.before, spec.after, spec.reason]);
    let mintedFresh = false;
    const commandKey = commandAttempts.resolve(slot, fingerprint, () => {
      mintedFresh = true;
      return createA2CommandKey("h2-trial-session");
    });
    try {
      await propose(ctx.toast, { ...spec, commandKey });
      commandAttempts.forget(slot);
    } catch (cause) {
      if (mintedFresh && !isA2OutcomeUncertainError(cause)) commandAttempts.forget(slot);
      throw cause;
    }
  };

  const openSessionCancel = (session: TrialSession) => {
    openActionConfirm({
      action: `强制取消试用 · ${session.sid}`,
      detail: <>用户：<b>{trialOwnerLabel(session)}</b> · 试用：<b>{session.sid}</b>。这次试用会结束并标记为 <b>已取消</b>，重复提交不会重复处理。</>,
      amplifies: false,
      effect: <StatusTag tone="progress" filled>提交审批，批准后生效</StatusTag>,
      confirmLabel: "提交审批",
      statedBrief: {
        impact: "超级管理员批准后，这次试用结束，用户要等冷却期过去才能再试用。批准前试用状态不变。",
        check: "核对用户和试用记录编号，理由写清依据或工单号。",
      },
      run: (reason) => {
        const def = findHighOp("h2_trial_cancel")!;
        return submitProposal({
          action: `强制取消试用 · ${session.sid}`,
          obj: `${trialOwnerLabel(session)} · ${session.sid}`,
          before: session.state,
          after: "cancelled",
          type: "sos",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "H2",
          command: def.buildCommand({ sid: session.sid }),
          target: def.buildTarget({ sid: session.sid }),
        });
      },
    });
  };

  const openSessionCharge = (session: TrialSession) => {
    openActionConfirm({
      action: `强制触发扣款 · ${session.sid}`,
      detail: <>用户：<b>{trialOwnerLabel(session)}</b> · 试用：<b>{session.sid}</b>。按当前试用规则重新计算并扣款，重复提交不会重复扣。会直接动用户的 USDT，需要有权限的管理员在「操作记录与审批」批准。</>,
      amplifies: true,
      coverageLead: "这项操作会直接扣用户的 USDT",
      effect: <StatusTag tone="progress" filled>提交审批，批准后生效</StatusTag>,
      confirmLabel: "提交审批",
      statedBrief: {
        impact: "超级管理员批准后，按当前试用规则算金额，从用户 USDT 余额扣款并转成购买；余额不足时不扣款也不发货。批准前不动用户的钱。",
        check: "核对用户和试用记录编号，理由写清依据或工单号。",
      },
      run: (reason) => {
        const def = findHighOp("h2_trial_charge")!;
        return submitProposal({
          action: `强制触发扣款 · ${session.sid}`,
          obj: `${trialOwnerLabel(session)} · ${session.sid}`,
          before: session.state,
          after: "已扣款",
          type: "fund",
          amplifies: true,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "H2",
          command: def.buildCommand({ sid: session.sid }),
          target: def.buildTarget({ sid: session.sid }),
        });
      },
    });
  };

  const openPushKill = () => {
    openConfirm({
      action: "紧急关闭试用邀请弹窗",
      detail: <>马上停止给用户自动弹出试用邀请。</>,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      reason: true,
      reasonPlaceholder: "写清调整原因和依据",
      statedBrief: { impact: "立即停止自动弹出试用邀请，用户点试用卡领取不受影响。关闭后这页不能重新打开，这次操作记入操作记录。", check: "确认要关闭，理由写清原因和依据。" },
      okLabel: "确认关闭",
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
        <h3>开始试用前的四项检查</h3>
        <p>全部通过才能开始试用。</p>
        {model.gates.length === 0 ? <p>未配置检查项</p> : (
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

  const header = (status?: ReactNode) => (
    <PageHeader
      pageId="H2"
      title="免费试用设置"
      summary="设置试用商品、时长和优惠，查看试用记录。"
      guideExtra={guideExtra}
      meta={model ? <>{status}{status ? " " : ""}{readAt ? `${readAt} 读取（${businessZone().label}）· ` : ""}打开时读取 <Button variant="ghost" size="sm" loading={loading} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void reload()}>刷新</Button></> : undefined}
      readOnly={model && !canWrite ? "你只能查看；修改试用设置要有这页的修改权限。" : undefined}
    />
  );

  if (loading && !model) {
    return <>{header()}<BlockState state="loading" title="试用数据加载中…" /></>;
  }

  if (error || !model) {
    return <>{header()}<BlockState state="error" title="试用数据加载失败" detail={error ?? "没有收到数据，请重试；一直失败请联系值班同事。"} onRetry={() => void reload()} /></>;
  }

  const phaseHref = "/growth/phase";
  const pricingHref = `/devices/pricing?sku=${encodeURIComponent(productNo ?? "")}`;
  const j1Href = "/emergency/kill-switch";
  const issues: Array<{ key: string; tone: StateTone; title: string; body: ReactNode }> = [];
  if (j1Closed) issues.push({ key: "j1", tone: "danger", title: "试用已被紧急停用开关关闭", body: <>用户现在不能开始试用，强制扣款也不会执行。{reach(j1Href) && <Link className="rd-link" href={j1Href} prefetch={false}>去紧急停用开关</Link>}</> });
  if (productBlocked) issues.push({ key: "product", tone: "danger", title: "当前目标商品不可用", body: <>库存 {product?.stock ?? 0} · {trialProductReason(product?.unavailableReason)}</> });
  if (phaseClosed) issues.push({ key: "phase", tone: "warn", title: "当前运营阶段不开放试用", body: <>用户现在不能开始试用。{reach(phaseHref) && <Link className="rd-link" href={phaseHref} prefetch={false}>去运营阶段设置</Link>}</> });
  if (!seatsKnown) issues.push({ key: "seats", tone: "warn", title: "今日实际剩余名额读不到", body: operatorCopyText(seats?.sub ?? "名额计数暂不可用，请稍后刷新；不能作为领取依据") });
  else if (Number(seats?.cur) === 0) issues.push({ key: "seats", tone: "warn", title: "今日免费名额已用完", body: "用户今天不能开始试用，次日恢复。要今天多放名额，调高「每日免费名额上限」。" });

  const rows = sessions.map((session) => {
    const state = states.get(session.state);
    return { session, state, label: state?.label ?? session.state, tone: stateTone(state), terminal: TERMINAL_STATES.includes(session.state), owner: knownTrialOwner(session) };
  });
  const currentRow = current ? rows[currentIndex] : null;
  const sessionButtons = (row: (typeof rows)[number], variant: "row" | "drawer") => {
    const reason = row.owner ? undefined : "用户信息暂不可用";
    return {
      cancel: canCancel && <Button size={variant === "row" ? "sm" : "md"} disabledReason={reason} onClick={() => openSessionCancel(row.session)}>强制取消</Button>,
      charge: canCharge && <Button size={variant === "row" ? "sm" : "md"} variant={variant === "row" ? "secondary" : "danger-outline"} disabledReason={reason} onClick={() => openSessionCharge(row.session)}>强制扣款</Button>,
    };
  };
  const total = model.sessionsPage?.total ?? sessions.length;
  const canHandle = canCancel || canCharge;

  return (
    <>
      {header(issues.length === 0 ? <StatusTag tone="ok">试用正常开放，没有要处理的事</StatusTag> : undefined)}

      {issues.map((issue) => <Notice key={issue.key} tone={issue.tone} title={issue.title}>{issue.body}</Notice>)}

      <StatBand label="试用经营摘要">
        <Stat tone="role-3" icon={Users} label="进行中的试用" value={stats.activeSessions == null ? "—" : Number(stats.activeSessions).toLocaleString()} unit="人"
          sub={`试用中 ${text(stats.inTrial)} · 宽限 ${text(stats.inGrace)} · 延长 ${text(stats.inExtended)}`}
          explain="试用中、宽限中和已延长的账号数，每个账号只算最近一次试用，不受下方分页影响。" />
        <Stat tone="role-4" icon={TrendingUp} label="试用转购买率" value={text(stats.trialBuyRate)}
          sub={`提前购 ${text(stats.earlyBuyRate)}`}
          explain={<>已购买账号 ÷ 全部已开始试用的账号，每个账号只算最近一次。提前购是其中在试用期内提前买的。没有分母时显示「—」，表示不可计算，不是 0。绑卡转化 {text(stats.bindCardRate)}：绑卡环节已退役，不再计算。</>} />
        <Stat tone="role-2" icon={Ticket} label="今日实际剩余免费名额" value={seatsKnown ? text(seats?.cur) : "—"} unit={seatsKnown ? "张" : undefined}
          sub={seats?.businessDate && seats.businessDate !== "UNKNOWN" ? `日期 ${seats.businessDate}` : undefined}
          explain="按试用业务日实时读取，和 App 用同一个名额计数。「每日免费名额上限」是配置，这个是领取后的实际剩余。" />
        <Stat tone="role-other" icon={Ban} label="拦截反复薅试用" value={text(stats.k2Blocked)} unit="人" sub="这些用户已不能再试用"
          explain="被风控判定为循环试用的用户去重人数。" />
      </StatBand>

      <div className="rd-config-layout">
        <div className="rd-config-grid">
          <div className="rd-config-rail">
            <Panel title="试用邀请弹窗" icon={BellOff} tone={killed ? "warn" : pushOff ? "done" : "ok"} headingLevel={2}>
              <div className="rd-push-state">
                <StatusTag tone={killed ? "warn" : pushOff ? "done" : "ok"}>{killed ? "试用邀请弹窗已关闭" : pushOff ? "自动推送已关" : "开启中"}</StatusTag>
                <p>{killed ? "已紧急关闭，这页不能重新打开。" : "出问题时先关掉它，立即生效。用户点试用卡领取不受影响。"}</p>
                {canWrite && !killed && <Button variant="danger-outline" onClick={openPushKill}>紧急关闭试用邀请弹窗</Button>}
              </div>
            </Panel>
            <SectionNav label="本页分组" items={sections} nav={nav} />
          </div>

          <div className="rd-config-groups">
            <div id={nav.anchor("common")}>
              <Panel title={<span tabIndex={-1} data-section-focus="">常改参数</span>} icon={SlidersHorizontal} tone="role-4" sub="每项写明什么时候生效，改一项存一项">
                <ConfigList>
                  {commonParams.map((param) => <ParamRow key={param.key} ctx={ctx} param={param} trialProducts={trialProducts} onChanged={reload} reach={reach} />)}
                </ConfigList>
              </Panel>
            </div>

            <div id={nav.anchor("advanced")}>
              <Fold title="高级设置" icon={Settings2} tone="role-other" summary={`${advancedCount} 项：${advancedGroups.map((group) => group.title).join("、")}`} open={!!folds.advanced} onOpenChange={(open) => setFolds((state) => ({ ...state, advanced: open }))}>
                {advancedGroups.map((group) => (
                  <div className="rd-config-group" key={group.title}>
                    <h3 className="rd-config-group-title">{group.title}</h3>
                    <ConfigList>
                      {group.params.map((param) => <ParamRow key={param.key} ctx={ctx} param={param} trialProducts={trialProducts} onChanged={reload} reach={reach} />)}
                    </ConfigList>
                  </div>
                ))}
              </Fold>
            </div>

            <div id={nav.anchor("readonly")}>
              <Fold title="只读项" icon={Lock} tone="role-other" summary={phaseClosed ? "当前阶段不开放试用" : `${readOnlyParams.length} 项，由别处决定`} alert={phaseClosed} open={folds.readonly || phaseClosed} onOpenChange={(open) => setFolds((state) => ({ ...state, readonly: open }))}>
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
              <Fold title="试用记录" icon={History} tone="role-3" summary={`共 ${total} 条，${text(stats.activeSessions)} 条进行中`} open={!!folds.records} onOpenChange={(open) => setFolds((state) => ({ ...state, records: open }))}>
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
                        <Tr key={row.session.sid} selected={row.session.sid === currentSid} onOpen={() => setCurrentSid(row.session.sid)}>
                          <Td><Cell main={trialOwnerLabel(row.session)} sub={<span data-mono="">{row.session.sid}</span>} title={row.session.sid} full /></Td>
                          <Td><StatusTag tone={row.tone} explain={TRIAL_STATE_HELP[row.session.state]}>{row.label}</StatusTag></Td>
                          <Td align="right"><Cell num main={operatorCopyText(text(row.session.shadow))} /></Td>
                          {canHandle && <Td>{row.terminal ? "—" : <span className="rd-row-actions">{buttons.cancel}{buttons.charge}</span>}</Td>}
                        </Tr>
                      );
                    })}
                    {rows.length === 0 && <TableMessage columns={canHandle ? 4 : 3}>暂无试用记录；用户绑卡并开始试用后会显示在这里</TableMessage>}
                  </tbody>
                </Table>
                {rows.length > 0 && (
                  <Pager label="试用记录" total={total} page={model.sessionsPage?.pageNum ?? sessionPage} pageSize={model.sessionsPage?.pageSize ?? sessionPageSize} sizes={[10, 20, 50]} loading={loading}
                    onPage={(next) => { reloadEpochRef.current += 1; setCurrentSid(null); setSessionPage(next); }}
                    onPageSize={(next) => { reloadEpochRef.current += 1; setCurrentSid(null); setSessionPage(1); setSessionPageSize(next); }} />
                )}
              </Fold>
            </div>
          </div>
        </div>
      </div>

      <Drawer open={!!currentRow} onClose={() => setCurrentSid(null)} title="试用记录" sub={currentRow?.session.sid} icon={History} tone="role-3"
        nav={{ hasPrev: currentIndex > 0, hasNext: currentIndex >= 0 && currentIndex < sessions.length - 1, onPrev: () => setCurrentSid(sessions[currentIndex - 1].sid), onNext: () => setCurrentSid(sessions[currentIndex + 1].sid) }}
        footer={currentRow && !currentRow.terminal && canHandle ? (
          <Decision note="两个操作都要提交审批，超级管理员批准后才执行。" danger={sessionButtons(currentRow, "drawer").charge} others={sessionButtons(currentRow, "drawer").cancel} />
        ) : undefined}>
        {currentRow && (
          <>
            <JudgmentPoints rows={[
              { label: "状态", value: <StatusTag tone={currentRow.tone}>{currentRow.label}</StatusTag>, reason: TRIAL_STATE_HELP[currentRow.session.state] },
              { label: "账户", value: trialOwnerLabel(currentRow.session), state: currentRow.owner ? undefined : "warn" },
              { label: "累计收益", value: operatorCopyText(text(currentRow.session.shadow)) },
              { label: "能不能处理", value: currentRow.terminal ? "已结束，不能再取消或扣款" : !currentRow.owner ? "没有用户归属，不能取消或扣款" : canHandle ? "可以提交强制取消或强制扣款" : "这个账号只能查看" },
            ]} />
            <Facts>
              <Fact k="试用记录编号"><span data-mono="">{currentRow.session.sid}</span></Fact>
              <Fact k="开始时间">{text(currentRow.session.claimedAt)}</Fact>
              <Fact k="到期时间">{text(currentRow.session.expiresAt)}</Fact>
            </Facts>
          </>
        )}
      </Drawer>
    </>
  );
}

export default H2Trial;
