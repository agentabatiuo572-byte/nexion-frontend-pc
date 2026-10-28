"use client";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { nexGridBrandText } from "@/lib/admin/brand-copy";

import { fetchA2Overview } from "@/lib/admin/a2-client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PaginationExemptionList } from "../design-kit";
import {
  fetchH3QuestEvents,
  fetchH3WeeklyRegionPolicy,
  h3WeeklyRegionPolicyParams,
  validateH3WeeklyRegionMappings,
  withH3WeeklyRegionProposalKey,
  type H3WeeklyRegionPolicy,
  type H3WeeklyRegionMapping,
  updateH3QuestConfig,
  updateH3LocalizedContent,
  updateH4LocalizedContent,
  updateH4EventFeatured,
  updateH4EventReward,
  updateH4EventStatus,
  createH3Mission,
  createH3MonthlyMission,
  editH3Mission,
  updateH3MissionPresentation,
  transitionH3Mission,
  archiveH3Mission,
  deleteH3Mission,
  isH3MissionOutcomeUncertainError,
  type H3MissionKind,
  type H3QuestEventBinding,
  createH3QuestEventBinding,
  isH3BindingOutcomeUncertainError,
  updateH3QuestEventBinding,
  deleteH3QuestEventBinding,
  createH4QuestEvent,
  deleteH4QuestEvent,
  pendingH4EventDeletes,
  createH4WheelTier,
  updateH4WheelProbabilities,
  updateH4WheelTier,
  deleteH4WheelTier,
  createH4WheelGuard,
  updateH4WheelGuard,
} from "@/lib/admin/h-client";
import type { HCtx } from "./types";
import { displayAdminError } from "@/lib/admin/error-messages";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { isDeletableQuestEvent } from "@/lib/admin/activity-delete";
import H4EventRules from "./h4-event-rules";
import H4GenesisRaffle from "./h4-genesis-raffle";

type EventState = "upcoming" | "ongoing" | "ended";
type HSection = "tasks" | "events";

type QuestTask = Record<string, any>;
type QuestEvent = {
  id: string;
  name: string;
  kind?: string;
  state: EventState;
  deleteState?: "draft" | EventState;
  deleteVersion?: string;
  deletable?: boolean;
  reward?: string;
  description?: string;
  rewardName?: string;
  featured?: boolean;
  trackable?: boolean;
  condition?: string;
  geo?: string;
};

type H3Model = {
  h3Stats?: Record<string, any>;
  h4Stats?: Record<string, any>;
  dayOneWindow?: string;
  dayOneEligibilityHours?: string;
  dayOneTriReward?: string;
  dayOneTasks: QuestTask[];
  dayOneStates?: Array<{ st: string; label: string; tone: string }>;
  weeklyTier1: QuestTask[];
  weeklyTier2: QuestTask[];
  weeklyChampionBonus?: string;
  weeklyMultipliers?: Array<{ p: string; mult: string }>;
  monthlyMissions: QuestTask[];
  taskMonitor?: Array<{ label: string; note: string }>;
  taskContracts?: Array<Record<string, any>>;
  promoBanner?: Record<string, any>;
  contentLocales?: Record<string, Record<string, Record<string, Record<string, string>>>>;
  phaseMultiplierReadonly?: Record<string, any>;
  eventBindings?: H3QuestEventBinding[];
  // 🔴 tasks 段的服务端响应**不含** events(OpsGrowthService.questTasks 显式移除)。
  //   此前这里声明为必填,PC 在 tasks 段却仍无条件解引用它 → 渲染期 TypeError →
  //   /growth/quest 整页无法加载(zentao #139)。与同结构其它可选字段一致改为可选,
  //   取用处一律 `?? []` 兜底。
  events?: QuestEvent[];
  eventStates?: Array<{ state: EventState; label: string; tone: string }>;
  wheelTiers?: Array<Record<string, any>>;
  wheelSignature?: string;
  wheelEvUsd?: number | string;
  wheelGuards?: Array<{ key: string; label: string; value: string; note?: string }>;
  trackables?: Array<{ id: string; name: string; cond: string; join: string; done: string; claim: string; geo: string }>;
  coverage?: Record<string, any>;
};

const EVENT_LABEL: Record<EventState, [string, string]> = {
  upcoming: ["预告", "dim"],
  ongoing: ["进行中", "ok"],
  ended: ["已结束", "dim"],
};

const TASK_STATUS: Record<string, [string, string]> = {
  active: ["生效中", "ok"],
  paused: ["已停用", "dim"],
  archived: ["已归档", "dim"],
};

const COMPLETION_LABEL: Record<string, string> = {
  event: "完成指定操作",
  unbound: "还没绑定完成条件",
  visit: "访问指定页面",
  ledger: "到账后算完成",
};

// 三语列在表格里只有按钮本身可读，语言名必须进可访问名称才能区分同行的三枚按钮。
const LOCALE_LABEL: Record<"en" | "zh" | "vi", string> = {
  en: "英文",
  zh: "中文",
  vi: "越南语",
};

const LOCALIZED_FIELD_LABEL: Record<"name" | "description" | "rewardName", string> = {
  name: "标题",
  description: "活动说明",
  rewardName: "奖项名称",
};

const TASK_CATEGORY_OPTIONS = ["wallet", "explore", "recommend", "identity", "social"];
const TASK_CATEGORY_LABELS: Record<string, string> = {
  wallet: "钱包",
  explore: "探索",
  recommend: "推荐",
  identity: "身份",
  social: "社交",
};
const TASK_ACTION_ROUTES = [
  "/pages/missions/missions",
  "/pages/me/profile",
  "/pages/me/wallet-cards-new",
  "/pages/me/wallet-topup",
  "/pages/me/wallet-exchange",
  "/pages/me/wallet-repurchase",
  "/pages/me/devices",
  "/pages/earn/earn",
  "/pages/store/store",
  "/pages/store/detail?id=stellarbox-s1",
  "/pages/team/team",
  "/pages/team/commissions",
  "/pages/learn/courses",
  "/pages/staking/staking",
  "/pages/genesis/genesis",
  "/pages/genesis/marketplace",
];
const TASK_ACTION_ROUTE_LABELS: Record<string, string> = {
  "/pages/missions/missions": "任务中心",
  "/pages/me/profile": "个人资料",
  "/pages/me/wallet-cards-new": "绑定银行卡",
  "/pages/me/wallet-topup": "钱包充值",
  "/pages/me/wallet-exchange": "UVT / USDT 兑换",
  "/pages/me/wallet-repurchase": "复投",
  "/pages/me/devices": "我的设备",
  "/pages/earn/earn": "收益",
  "/pages/store/store": "商城",
  "/pages/store/detail?id=stellarbox-s1": "UVELBox S1 详情",
  "/pages/team/team": "团队",
  "/pages/team/commissions": "佣金",
  "/pages/learn/courses": "学习中心",
  "/pages/staking/staking": "Staking",
  "/pages/genesis/genesis": "创世节点",
  "/pages/genesis/marketplace": "创世节点 二级市场",
};

// 只暴露 Java OpsGrowthController 已接受的规范事件，避免运营手填 JSON 或拼接事件名。
const H3_BINDING_EVENT_PRODUCERS: Record<string, H3QuestEventBinding["producer"]> = {
  "checkout.started": "ORDER",
  H8_REFERRAL_REWARD_SETTLED: "REFERRAL",
  LEARNING_COURSE_COMPLETED: "LEARNING",
  "admin.device_activated": "DEVICE",
  COMMISSION_UNLOCKED: "COMMISSION",
  H3_STOREFRONT_THREE_PRODUCTS_VIEWED: "SYSTEM",
  H3_GENESIS_SECONDARY_MARKET_VIEWED: "SYSTEM",
  H3_COMPUTE_COMPLETED_50: "SYSTEM",
  H3_REFERRAL_REGISTERED: "SYSTEM",
  H3_EXCHANGE_COMPLETED: "SYSTEM",
  H3_DAY_ONE_PROFILE_SAVED: "SYSTEM",
  H3_DAY_ONE_CARD_BOUND: "SYSTEM",
  H3_DAY_ONE_EARN_PAGE_VIEWED: "SYSTEM",
  H3_DAY_ONE_STORE_PAGE_VIEWED: "SYSTEM",
  H3_DAY_ONE_S1_ROI_VIEWED: "SYSTEM",
};
const H3_BINDING_EVENT_OPTIONS = Object.keys(H3_BINDING_EVENT_PRODUCERS);

const H3_BINDING_EVENT_LABELS: Record<string, string> = {
  "checkout.started": "开始下单",
  H8_REFERRAL_REWARD_SETTLED: "邀请奖励结算",
  LEARNING_COURSE_COMPLETED: "学习课程完成",
  "admin.device_activated": "设备激活",
  COMMISSION_UNLOCKED: "佣金解锁",
  H3_STOREFRONT_THREE_PRODUCTS_VIEWED: "浏览3个不同商品",
  H3_GENESIS_SECONDARY_MARKET_VIEWED: "查看创世节点二级市场",
  H3_COMPUTE_COMPLETED_50: "完成50笔已验证AI任务",
  H3_REFERRAL_REGISTERED: "有效邀请注册",
  H3_EXCHANGE_COMPLETED: "完成一次兑换",
  H3_DAY_ONE_PROFILE_SAVED: "保存个人资料（首日）",
  H3_DAY_ONE_CARD_BOUND: "绑定支付卡（需服务商确认）",
  H3_DAY_ONE_EARN_PAGE_VIEWED: "查看收益页（首日）",
  H3_DAY_ONE_STORE_PAGE_VIEWED: "查看商城页（首日）",
  H3_DAY_ONE_S1_ROI_VIEWED: "查看 UVELBox S1 收益估算（首日）",
};
const H3_BINDING_USER_FIELDS = ["user_id", "inviter_user_id"];
const H3_BINDING_USER_FIELD_LABELS: Record<string, string> = {
  user_id: "事件发生用户",
  inviter_user_id: "邀请人",
};

function text(value: unknown, fallback = "-") {
  if (value == null || value === "") return fallback;
  return String(value);
}

function wheelRewardText(value: unknown) {
  return nexGridBrandText(text(value).replace(/\bNEX\b/gi, "UVT")).replace(/\bpoints\b/gi, "积分").replace(/\bdevice coupon\b/gi, "设备代金券");
}

function cleanPhaseKey(value: string) {
  return value.replace(/\s*当前\s*/g, "").trim();
}

function numberId(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function statusMeta(value: unknown) {
  return TASK_STATUS[text(value, "")] ?? ["未知", "dim"];
}

/**
 * 生效中但完成判定仍为「待绑定规范事件」的任务必须被标出来。
 * 后端 `H3_MISSION_ACTIVE_BINDING_REQUIRED` 只拦「新启用」,历史遗留的 active+unbound
 * 行会照常下发到 App 引导用户做真实动作,却因为没有规范完成事件而无法完成/发奖。
 * 权威页面显示成普通「生效中」会让运营误以为任务可用。
 */
function taskStatusMeta(task: QuestTask) {
  const label = text(task.status, "");
  if (label === "active" && text(task.completionType, "unbound") === "unbound") {
    return ["生效中 · 待绑定", "warn"] as const;
  }
  return statusMeta(task.status);
}

function promoFinalReward(base: unknown, multiplier: unknown) {
  const result = numericValue(base) * numericValue(multiplier);
  return result > 0 ? result.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "-";
}

function contractForTask(task: QuestTask, contracts: Array<Record<string, any>> | undefined, index: number) {
  // Mission codes are stable across legacy numeric projections and reordering.
  // A missing contract must stay missing, never borrow the adjacent task's facts.
  if (task.taskCode) return contracts?.find((item) => item.taskKey === task.taskCode) ?? {};
  return task.id == null ? {} : contracts?.find((item) => String(item.taskId) === String(task.id)) ?? {};
}

function statusOptions(current: EventState) {
  if (current === "upcoming") return ["ongoing", "ended"] as EventState[];
  if (current === "ongoing") return ["ended"] as EventState[];
  return [] as EventState[];
}

function numericValue(value: unknown) {
  if (typeof value === "number") return value;
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function boolValue(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function percentText(value: unknown) {
  const amount = numericValue(value);
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/\.?0+$/, "");
}

function casExpected(value: string) {
  const normalized = value.trim();
  return !normalized || normalized === "-" ? "__MISSING__" : normalized;
}

export function H3WeeklyRegionPolicyPanel({ ctx }: { ctx: HCtx }) {
  const canRead = ctx.can("growth_h3_read");
  const canWrite = ctx.can("growth_h3_write");
  const propose = usePropose();
  const [policy, setPolicy] = useState<H3WeeklyRegionPolicy | null>(null);
  const [draft, setDraft] = useState<H3WeeklyRegionMapping[] | null>(null);
  const [draftBase, setDraftBase] = useState<H3WeeklyRegionPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submittedRevision, setSubmittedRevision] = useState<number | null>(null);
  const canReadA2 = ctx.can("platform_a2_read");
  const [pendingReview, setPendingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const generation = useRef(0);
  const reload = async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const [rules, audit] = await Promise.allSettled([
        fetchH3WeeklyRegionPolicy(),
        canReadA2 ? fetchA2Overview({ object: "growth.h3.weekly-region-policy" }) : Promise.resolve(null),
      ]);
      if (request !== generation.current) return;
      if (rules.status === "rejected") throw rules.reason;
      setPolicy(rules.value);
      setError(null);
      if (audit.status === "rejected") {
        setReviewError("审批进度读取失败，请刷新后重试；暂不能再次提交。");
      } else {
        setReviewError(null);
        if (audit.value) {
          const waiting = audit.value.operationQueue.some(row => row.obj === "growth.h3.weekly-region-policy" && row.status === "pending");
          setPendingReview(waiting);
          if (!waiting) setSubmittedRevision(null);
        } else if (submittedRevision !== rules.value.revision) {
          setSubmittedRevision(null);
          setPendingReview(false);
        }
      }
    } catch (cause) {
      if (request === generation.current) setError(displayAdminError(cause));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (canRead) void reload();
    return () => { generation.current += 1; };
  }, [canRead, canReadA2]);
  if (!canRead) return null;
  const invalid = draft ? validateH3WeeklyRegionMappings(draft) : null;
  const pending = pendingReview || (policy && submittedRevision === policy.revision);
  const staleDraft = draftBase && policy && (draftBase.revision !== policy.revision
    || JSON.stringify(draftBase.nextActivation) !== JSON.stringify(policy.nextActivation));
  const describe = (rows: H3WeeklyRegionMapping[]) => rows.length
    ? rows.map(row => `${row.callingCode} → ${row.zoneId}`).join("；") : "全部区号使用越南时间";
  const submit = () => {
    if (!policy || !draftBase || !draft || invalid || loading || error || reviewError || pending || staleDraft || !canWrite) return;
    const params = h3WeeklyRegionPolicyParams(draftBase, draft);
    const def = findHighOp("h3_weekly_region_policy")!;
    ctx.openActionConfirm({
      action: def.action,
      detail: <><p>当前：{describe(draftBase.mappings)}</p><p>调整为：{describe(draft)}</p>
        <p>没设置的区号一律用越南时间。本周已开始的不变，批准后从用户的下一周开始生效。</p>
        {draftBase.revision === 0 && <p>首次生效时间：{draftBase.nextActivation!.effectiveFrom}（UTC）。过了这个时间需要刷新后重新提交。</p>}</>,
      amplifies: true,
      run: async reason => {
        await withH3WeeklyRegionProposalKey(params, reason, commandKey => propose(ctx.toast, {
          action: def.action, obj: "growth.h3.weekly-region-policy",
          before: describe(draftBase.mappings), after: describe(params.mappings),
          type: def.type, amplifies: true, gate: { roles: [] }, gateLabel: def.gateLabel,
          reason, sourceDomain: "H", commandKey,
          command: def.buildCommand(params), target: def.buildTarget(params),
        }));
        generation.current += 1;
        setLoading(false);
        setSubmittedRevision(draftBase.revision);
        setPendingReview(true);
        setDraft(null);
      },
    });
  };
  return <section className="l-card ui-weekly-region" aria-label="每周任务地区规则">
    <div className="l-h"><span className="ttl">每周任务地区规则</span><div className="r">
      <button className="l-btn sm" disabled={loading} onClick={() => void reload()}>刷新地区规则</button>
    </div></div>
    <div style={{ padding: 16 }}>
      <p>按用户注册手机号的区号决定时区，每周一 00:00 开始新的一周。没设置的区号用越南时间。</p>
      <p>本周已开始的不变，批准后从用户的下一周开始生效。团队和财务的周期仍按越南时间。</p>
      {loading && <p role="status">正在加载地区规则…</p>}
      {error && <p role="alert">地区规则加载失败：{error} 请刷新后重试。</p>}
      {policy && <>
        <p>当前使用{policy.source === "DEFAULT" ? "默认规则" : `已发布规则 · 版本 ${policy.revision}`}
          {policy.effectiveFrom ? ` · 首次生效时间 ${policy.effectiveFrom}（UTC）` : " · 还没发布地区规则"}</p>
        <dl className="ui-facts-grid">{policy.mappings.map(row => <div key={row.callingCode}><dt>电话区号 {row.callingCode}</dt><dd>{row.zoneId}</dd></div>)}</dl>
        {policy.mappings.length === 0 && <p>全部区号使用越南时间。</p>}
        {pending && <p role="status">修改已提交，等待审批。批准前仍按当前规则执行。{canReadA2
          ? <><a href="/platform/audit">查看审批进度</a>；批准后刷新这里核对。</>
          : "你没有查看审批的权限，请让有权限的同事核对结果。"}</p>}
        {reviewError && <p role="alert">{reviewError}</p>}
        {policy.revision === 0 && !policy.nextActivation && <p role="status">首次生效时间还没确定，暂时不能提交修改。</p>}
        {canWrite && !draft && <button className="l-btn sm mc" disabled={loading || !!error || !!reviewError || !!pending || (policy.revision === 0 && !policy.nextActivation)}
          onClick={() => { setDraftBase(policy); setDraft(policy.mappings.map(row => ({ ...row }))); }}>编辑地区规则</button>}
      </>}
      {canWrite && draft && <fieldset disabled={loading || !!error || !!reviewError || !!pending} style={{ marginTop: 12 }}>
        <legend>修改地区规则</legend>
        {draft.map((row, index) => <div key={index} className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
          <label>电话区号<input className="fld" aria-label={`电话区号 ${index + 1}`} value={row.callingCode} placeholder="+84"
            onChange={event => setDraft(draft.map((item, i) => i === index ? { ...item, callingCode: event.target.value.trim() } : item))} /></label>
          <label>任务时区<input className="fld" aria-label={`任务时区 ${index + 1}`} value={row.zoneId} placeholder="Asia/Shanghai"
            onChange={event => setDraft(draft.map((item, i) => i === index ? { ...item, zoneId: event.target.value.trim() } : item))} /></label>
          <button className="l-btn sm" onClick={() => setDraft(draft.filter((_, i) => i !== index))}>删除 {row.callingCode || index + 1}</button>
        </div>)}
        <button className="l-btn sm" disabled={draft.length >= 999} onClick={() => setDraft([...draft, { callingCode: "", zoneId: "" }])}>添加区号</button>
        {draft.length === 0 && <p>全部删除后，以后所有用户都用越南时间。</p>}
        {invalid && <p role="alert">{invalid}</p>}
        {staleDraft && <p role="alert">规则刚被别人修改过，你填写的内容还在。请取消编辑、刷新后重新修改。</p>}
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button className="l-btn sm mc" disabled={!!invalid || !!staleDraft || !draftBase || (draftBase.revision === 0 && !draftBase.nextActivation)} onClick={submit}>提交审批</button>
          <button className="l-btn sm" onClick={() => setDraft(null)}>取消编辑</button>
        </div>
      </fieldset>}
    </div>
  </section>;
}

export function H3QuestEvents({ ctx, section = "tasks" }: { ctx: HCtx; section?: HSection }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const canModuleWrite = ctx.can(section === "events" ? "growth_h4_write" : "growth_h3_write");
  const canWheelWrite = ctx.can("growth_h4_wheel_pool_write");
  const [, pendingDeleteChanged] = useState(0);
  const [model, setModel] = useState<H3Model | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const moduleLabel = section === "events" ? "活动中心" : "用户任务";

  const reload = async () => {
    setLoading(true);
    try {
      setModel((await fetchH3QuestEvents(section)) as H3Model);
      setError(null);
    } catch (err) {
      setError(displayAdminError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [section]);

  const stateTone = useMemo(() => {
    const pairs: Array<[EventState, [string, string]]> = (model?.eventStates ?? []).map((item) => [
      item.state,
      [item.label, item.tone],
    ]);
    return new Map<EventState, [string, string]>(pairs);
  }, [model?.eventStates]);

  const bindingMissionOptions = useMemo(() => {
    const tasks = [
      ...(model?.dayOneTasks ?? []),
      ...(model?.weeklyTier1 ?? []),
      ...(model?.weeklyTier2 ?? []),
    ];
    const seen = new Set<string>();
    return tasks.flatMap((task) => {
      const missionCode = text(task.taskCode ?? task.missionCode ?? task.id, "").trim();
      const status = text(task.status, "");
      if (!missionCode || !["active", "paused"].includes(status) || seen.has(missionCode)) return [];
      seen.add(missionCode);
      return [{ missionCode, label: `${text(task.task ?? task.cond, missionCode)} · ${missionCode}${status === "paused" ? " · 待启用" : ""}` }];
    });
  }, [model?.dayOneTasks, model?.weeklyTier1, model?.weeklyTier2]);

  const bindingMissionLabels = useMemo(
    () => Object.fromEntries(bindingMissionOptions.map((item) => [item.missionCode, item.label])),
    [bindingMissionOptions],
  );

  const applyBindingMutation = async (mutation: Promise<Record<string, any>>) => {
    try {
      apply(await mutation);
    } catch (error) {
      if (isH3BindingOutcomeUncertainError(error) && error.readback) {
        apply(error.readback);
        toast("保存结果暂未确认，页面已刷新。请核对后用相同理由重试");
      }
      throw error;
    }
  };

  const applyMissionMutation = async (mutation: Promise<Record<string, any>>) => {
    try {
      apply(await mutation);
    } catch (error) {
      if (isH3MissionOutcomeUncertainError(error) && error.readback) {
        apply(error.readback);
        toast("任务保存结果暂未确认，页面已刷新。请核对后重试");
      }
      throw error;
    }
  };

  const apply = (next: Record<string, any>) => setModel(next as H3Model);

  const updateConfigWithExpected = async (
    key: string,
    value: string,
    expectedValue: string,
    reason: string,
    label: string,
  ) => {
    apply(await updateH3QuestConfig(key, value, reason, expectedValue));
    toast(`${label} 已更新`);
  };

  const openSimpleConfig = (key: string, label: string, current: string, amplifies = false) => {
    openActionConfirm({
      action: label,
      detail: <>当前值 <b>{current}</b>。保存后马上生效。</>,
      amplifies,
      edit: { kind: "text", current },
      run: async (reason, value) => {
        if (!value) return;
        await updateConfigWithExpected(key, value, casExpected(current), reason, label);
      },
    });
  };

  const openTaskReward = (key: string, label: string, current: string) => {
    openActionConfirm({
      action: `调整奖励 · ${label}`,
      detail: <>当前奖励 <b>{current}</b>。调高奖励会多发钱，覆盖率低于红线时无法保存。</>,
      edit: {
        kind: "number",
        current: String(numericValue(current)),
        min: 0,
        max: 100000,
        step: 1,
        disallowCurrent: true,
        amplifiesWhen: "increase",
      },
      run: async (reason, value) => {
        if (!value) return;
        await updateConfigWithExpected(key, value, String(numericValue(current)), reason, `奖励 ${label}`);
      },
    });
  };

  const openEventReward = (event: QuestEvent) => {
    const current = text(event.reward);
    openActionConfirm({
      action: `活动奖励 · ${event.name}`,
      detail: <>当前奖励 <b>{current}</b>。确认后更新活动奖励。</>,
      amplifies: true,
      edit: { kind: "text", current },
      run: async (reason, value) => {
        if (!value) return;
        apply(await updateH4EventReward(event.id, value, current, reason));
        toast(`${event.name} 奖励已更新`);
      },
    });
  };

  const openEventStatus = (event: QuestEvent) => {
    openConfirm({
      action: `活动状态 · ${event.name}`,
      detail: <>当前状态 <b>{EVENT_LABEL[event.state]?.[0] ?? "状态未知"}</b>，请选择新状态。</>,
      chips: [["记入操作记录", "done"]],
      reason: true,
      input: { label: "新状态", options: statusOptions(event.state) },
      okLabel: "确认修改",
      run: async (reason, value) => {
        if (!value) return;
        apply(await updateH4EventStatus(event.id, value, event.state, reason));
        toast(`${event.name} 状态已更新`);
      },
    });
  };

  const openEventFeatured = (event: QuestEvent) => {
    openConfirm({
      action: `${event.featured ? "取消主推" : "设为主推"} · ${event.name}`,
      detail: <>同时只能有一个进行中的主推活动。</>,
      chips: [["只能有一个主推", "ready"], ["记入操作记录", "done"]],
      reason: true,
      okLabel: event.featured ? "取消主推" : "设为主推",
      run: async (reason) => {
        apply(await updateH4EventFeatured(event.id, !Boolean(event.featured), Boolean(event.featured), reason));
        toast(`${event.name} 主推状态已更新`);
      },
    });
  };

  const openCreateMission = (missionType: "DAY_ONE" | "WEEKLY_T1" | "WEEKLY_T2", subject: string) => {
    openActionConfirm({
      action: `新建任务 · ${subject}`,
      detail: <>新建一条{subject}，新建后先是停用状态。请先在下方「任务完成条件」里绑定完成条件，再启用。</>,
      amplifies: true,
      businessForm: { kind: "mission-create", subject },
      run: async (reason, _v, bv) => {
        if (!bv) return;
        const missionCode = String(bv.missionCode || "").trim();
        const missionName = String(bv.missionName || "").trim();
        if (!missionCode || !missionName) return;
        await applyMissionMutation(createH3Mission({
          missionCode,
          missionName,
          missionType,
          rewardPoints: Number(bv.rewardPoints) || 0,
          category: String(bv.category || "").trim(),
          actionRoute: String(bv.actionRoute || "").trim(),
        }, reason));
        toast(`任务「${missionName}」已新建（停用中，绑定完成条件后再启用）`);
      },
    });
  };

  const openCreateMonthlyMission = () => {
    openActionConfirm({
      action: "新建月度挑战",
      detail: <>新建一个月度挑战主题，按用户注册时长分配。奖励大于 0 时，覆盖率低于红线无法保存。</>,
      amplifies: true,
      businessForm: { kind: "monthly-mission-create", subject: "新月度挑战" },
      run: async (reason, _v, bv) => {
        if (!bv) return;
        const payload = {
          challengeCode: String(bv.challengeCode || "").trim(),
          challengeName: String(bv.challengeName || "").trim(),
          theme: String(bv.theme || "").trim(),
          monthsFrom: Number(bv.monthsFrom) || 0,
          monthsTo: Number(bv.monthsTo) || 999,
          targetType: String(bv.targetType || "").trim(),
          targetValue: Number(bv.targetValue) || 1,
          rewardType: bv.rewardType || "UVT",
          rewardAmount: Number(bv.rewardAmount) || 0,
          rewardName: String(bv.rewardName || "").trim(),
        };
        if (!payload.challengeCode || !payload.challengeName) return;
        await applyMissionMutation(createH3MonthlyMission(payload, reason));
        toast(`月度挑战「${payload.challengeName}」已新建`);
      },
    });
  };

  const localizedValue = (
    entity: "mission" | "event", code: string,
    field: "name" | "description" | "rewardName", locale: "en" | "zh" | "vi",
  ) => text(model?.contentLocales?.[entity]?.[code]?.[locale]?.[field], "");

  const openLocalizedContent = (
    entity: "mission" | "event", code: string,
    field: "name" | "description" | "rewardName", locale: "en" | "zh" | "vi", source: string,
  ) => {
    const current = localizedValue(entity, code, field, locale);
    openActionConfirm({
      action: `编辑 ${locale.toUpperCase()} 内容 · ${source}`,
      detail: <>这里填写 {locale.toUpperCase()} 文案；不填时 App 显示原文，不会自动翻译。</>,
      edit: { kind: "text", current },
      run: async (reason, value) => {
        if (!value) return;
        apply(await (entity === "event"
          ? updateH4LocalizedContent(code, field, locale, value, casExpected(current), reason)
          : updateH3LocalizedContent("mission", code, "name", locale, value, casExpected(current), reason)));
        toast(`${source} ${locale.toUpperCase()} 文案已保存`);
      },
    });
  };

  const taskIdentity = (task: QuestTask, monthly = false) => ({
    taskCode: text(task.taskCode ?? task.missionCode ?? task.id),
    taskKind: (text(task.taskKind, monthly ? "MONTHLY" : "MISSION") === "MONTHLY" ? "MONTHLY" : "MISSION") as H3MissionKind,
    status: text(task.status, "paused") as "active" | "paused" | "archived",
  });

  const openMissionEdit = (task: QuestTask, label: string, monthly = false) => {
    const { taskCode, taskKind, status } = taskIdentity(task, monthly);
    if (status === "archived") return;
    openActionConfirm({
      action: `编辑任务 · ${label}`,
      detail: <>只改任务名称；奖励用「改奖励」单独修改。</>,
      edit: { kind: "text", current: label, disallowCurrent: true },
      run: async (reason, value) => {
        if (!value) return;
        await applyMissionMutation(editH3Mission(taskCode, taskKind, value, label, reason));
        toast(`任务「${label}」已编辑`);
      },
    });
  };

  const openMissionPresentation = (task: QuestTask, label: string) => {
    const { taskCode, status } = taskIdentity(task);
    if (status === "archived") return;
    const currentCategory = text(task.category, "explore").toLowerCase();
    const currentActionRoute = text(task.href, "/pages/missions/missions");
    openActionConfirm({
      action: `配置任务类别与去完成页面 · ${label}`,
      detail: <>保存后 App 马上按这里的设置显示类别、跳转页面。</>,
      businessForm: {
        kind: "multi-field",
        title: `App 显示与跳转 · ${label}`,
        requireAnyChange: true,
        fields: [
          {
            key: "category",
            label: "任务类别",
            current: currentCategory,
            inputKind: "select",
            options: TASK_CATEGORY_OPTIONS,
            optionLabels: TASK_CATEGORY_LABELS,
            required: true,
            showDiff: true,
          },
          {
            key: "actionRoute",
            label: "点「去完成」跳转到",
            current: currentActionRoute,
            inputKind: "select",
            options: TASK_ACTION_ROUTES,
            optionLabels: TASK_ACTION_ROUTE_LABELS,
            required: true,
            showDiff: true,
          },
        ],
      },
      run: async (reason, _value, businessValue) => {
        if (!businessValue) return;
        await applyMissionMutation(updateH3MissionPresentation(
          taskCode,
          String(businessValue.category || "").trim(),
          String(businessValue.actionRoute || "").trim(),
          currentCategory,
          currentActionRoute,
          reason,
        ));
        toast(`任务「${label}」的类别与去完成页面已更新`);
      },
    });
  };

  const openMissionStatus = (task: QuestTask, label: string, monthly = false) => {
    const { taskCode, taskKind, status } = taskIdentity(task, monthly);
    if (status === "archived") return;
    const targetStatus = status === "active" ? "paused" : "active";
    openConfirm({
      action: `${targetStatus === "active" ? "启用" : "停用"}任务 · ${label}`,
      detail: <>只能在启用和停用之间切换；已归档的任务不能恢复。</>,
      chips: [["记入操作记录", "done"]],
      reason: true,
      okLabel: targetStatus === "active" ? "确认启用" : "确认停用",
      run: async (reason) => {
        await applyMissionMutation(transitionH3Mission(taskCode, taskKind, targetStatus, status, reason));
        toast(`任务「${label}」已${targetStatus === "active" ? "启用" : "停用"}`);
      },
    });
  };

  const openMissionArchive = (task: QuestTask, label: string, monthly = false) => {
    const { taskCode, taskKind, status } = taskIdentity(task, monthly);
    if (status === "archived") return;
    openConfirm({
      action: `归档任务 · ${label}`,
      detail: <>归档后不能再启用或编辑。要删除任务，需先归档。</>,
      chips: [["不能撤回", "ready"], ["记入操作记录", "done"]],
      reason: true,
      okLabel: "确认归档",
      run: async (reason) => {
        await applyMissionMutation(archiveH3Mission(taskCode, taskKind, status, reason));
        toast(`任务「${label}」已归档`);
      },
    });
  };

  const openMissionDelete = (task: QuestTask, label: string, monthly = false) => {
    const { taskCode, taskKind, status } = taskIdentity(task, monthly);
    if (status !== "archived") return;
    openConfirm({
      action: `删除已归档任务 · ${label}`,
      detail: <>只能删除已归档的任务。删除后操作记录仍保留。</>,
      chips: [["仅限已归档", "ready"], ["保留操作记录", "done"]],
      reason: true,
      okLabel: "确认删除",
      run: async (reason) => {
        await applyMissionMutation(deleteH3Mission(taskCode, taskKind, reason));
        toast(`任务「${label}」已删除`);
      },
    });
  };

  const openBindingStatus = (binding: H3QuestEventBinding) => {
    const enabled = Number(binding.status) === 1;
    openConfirm({
      action: `${enabled ? "停用" : "启用"}完成条件 · ${binding.bindingCode}`,
      detail: <>对应的任务要处于待启用或已启用状态。</>,
      chips: [["记入操作记录", "done"]],
      reason: true,
      okLabel: enabled ? "确认停用" : "确认启用",
      run: async (reason) => {
        await applyBindingMutation(updateH3QuestEventBinding(binding.bindingCode, {
          producer: binding.producer,
          eventType: binding.eventType,
          questCode: binding.questCode,
          userIdField: binding.userIdField,
          enabled: !enabled,
          expectedProducer: binding.producer,
          expectedEventType: binding.eventType,
          expectedQuestCode: binding.questCode,
          expectedUserIdField: binding.userIdField,
          expectedEnabled: enabled,
          reason,
        }));
        toast(`完成条件「${binding.bindingCode}」已${enabled ? "停用" : "启用"}`);
      },
    });
  };

  const bindingFormFields = (binding?: H3QuestEventBinding) => {
    const currentQuestCode = binding?.questCode ?? bindingMissionOptions[0]?.missionCode ?? "";
    const questCodes = binding && !bindingMissionLabels[currentQuestCode]
      ? [currentQuestCode, ...bindingMissionOptions.map((item) => item.missionCode)]
      : bindingMissionOptions.map((item) => item.missionCode);
    const questLabels = binding && !bindingMissionLabels[currentQuestCode]
      ? { ...bindingMissionLabels, [currentQuestCode]: `${currentQuestCode} · 当前绑定（这个任务已不能发布）` }
      : bindingMissionLabels;
    return [
      ...(binding ? [] : [{
        key: "bindingCode",
        label: "条件编号",
        current: "",
        inputKind: "text" as const,
        required: true,
        placeholder: "例如 ORDER_FIRST_CHECKOUT",
        hint: "只能用大写英文、数字、_ 或 -；创建后不能改。",
      }]),
      {
        key: "eventType",
        label: "用户做了什么",
        current: binding?.eventType ?? H3_BINDING_EVENT_OPTIONS[0],
        inputKind: "select" as const,
        options: H3_BINDING_EVENT_OPTIONS,
        optionLabels: H3_BINDING_EVENT_LABELS,
        required: true,
        showDiff: Boolean(binding),
      },
      {
        key: "questCode",
        label: "对应任务",
        current: currentQuestCode,
        inputKind: "select" as const,
        options: questCodes,
        optionLabels: questLabels,
        required: true,
        showDiff: Boolean(binding),
      },
      {
        key: "userIdField",
        label: "算谁完成",
        current: binding?.userIdField ?? "user_id",
        inputKind: "select" as const,
        options: H3_BINDING_USER_FIELDS,
        optionLabels: H3_BINDING_USER_FIELD_LABELS,
        required: true,
        showDiff: Boolean(binding),
      },
      {
        key: "enabled",
        label: "启用状态",
        current: binding && Number(binding.status) !== 1 ? "false" : "true",
        inputKind: "select" as const,
        options: ["true", "false"],
        optionLabels: { true: "启用", false: "停用" },
        required: true,
        showDiff: Boolean(binding),
      },
    ];
  };

  const openCreateBinding = () => {
    if (bindingMissionOptions.length === 0) {
      toast("没有可以绑定的任务，请先新建任务，绑定完成条件后再启用");
      return;
    }
    openActionConfirm({
      action: "新增任务完成条件",
      detail: <>选择「用户做了什么」和对应的任务。用户做了这件事，任务就算完成。新任务要先绑定再启用。</>,
      businessForm: {
        kind: "multi-field",
        title: "新增完成条件",
        hint: "依次选择用户操作、对应任务和算谁完成。",
        fields: bindingFormFields(),
      },
      run: async (reason, _value, form) => {
        const bindingCode = String(form?.bindingCode ?? "").trim();
        const eventType = String(form?.eventType ?? "").trim();
        const questCode = String(form?.questCode ?? "").trim();
        const userIdField = String(form?.userIdField ?? "").trim() as H3QuestEventBinding["userIdField"];
        const producer = H3_BINDING_EVENT_PRODUCERS[eventType];
        if (!bindingCode || !producer || !questCode || !userIdField) return;
        await applyBindingMutation(createH3QuestEventBinding(bindingCode, {
          producer,
          eventType,
          questCode,
          userIdField,
          enabled: form?.enabled === "true",
          reason,
        }));
        toast(`完成条件「${bindingCode}」已新增`);
      },
    });
  };

  const openBindingEdit = (binding: H3QuestEventBinding) => {
    openActionConfirm({
      action: `修改完成条件 · ${binding.bindingCode}`,
      detail: <>可以改「用户做了什么」、对应任务或「算谁完成」。如果别人刚改过，需要刷新后重改。</>,
      businessForm: {
        kind: "multi-field",
        title: `修改 · ${binding.bindingCode}`,
        hint: "保存后列表自动刷新。",
        requireAnyChange: true,
        fields: bindingFormFields(binding),
      },
      run: async (reason, _value, form) => {
        const eventType = String(form?.eventType ?? "").trim();
        const producer = H3_BINDING_EVENT_PRODUCERS[eventType];
        const questCode = String(form?.questCode ?? "").trim();
        const userIdField = String(form?.userIdField ?? "").trim() as H3QuestEventBinding["userIdField"];
        if (!producer || !questCode || !userIdField) return;
        const enabled = form?.enabled === "true";
        await applyBindingMutation(updateH3QuestEventBinding(binding.bindingCode, {
          producer,
          eventType,
          questCode,
          userIdField,
          enabled,
          expectedProducer: binding.producer,
          expectedEventType: binding.eventType,
          expectedQuestCode: binding.questCode,
          expectedUserIdField: binding.userIdField,
          expectedEnabled: Number(binding.status) === 1,
          reason,
        }));
        toast(`完成条件「${binding.bindingCode}」已修改`);
      },
    });
  };

  const openBindingDelete = (binding: H3QuestEventBinding) => {
    const enabled = Number(binding.status) === 1;
    openConfirm({
      action: `删除完成条件 · ${binding.bindingCode}`,
      detail: <>删除后，用户做这件事不再算完成任务。操作记录会保留。</>,
      chips: [["保留操作记录", "done"]],
      reason: true,
      okLabel: "确认删除",
      run: async (reason) => {
        await applyBindingMutation(deleteH3QuestEventBinding(binding.bindingCode, {
          expectedProducer: binding.producer,
          expectedEventType: binding.eventType,
          expectedQuestCode: binding.questCode,
          expectedUserIdField: binding.userIdField,
          expectedEnabled: enabled,
          reason,
        }));
        toast(`完成条件「${binding.bindingCode}」已删除`);
      },
    });
  };

  const missionLifecycleActions = (task: QuestTask, label: string, monthly = false) => {
    const { status } = taskIdentity(task, monthly);
    return <>
      <button className="l-btn sm" onClick={() => openMissionEdit(task, label, monthly)} disabled={!canModuleWrite || status === "archived"}>编辑</button>{" "}
      {!monthly ? <><button className="l-btn sm mc" onClick={() => openMissionPresentation(task, label)} disabled={!canModuleWrite || status === "archived"}>设置类别/跳转</button>{" "}</> : null}
      {status === "archived" ? (
        <button className="l-btn sm" onClick={() => openMissionDelete(task, label, monthly)} disabled={!canModuleWrite}>删除</button>
      ) : <>
        <button className="l-btn sm" onClick={() => openMissionStatus(task, label, monthly)} disabled={!canModuleWrite}>{status === "active" ? "停用" : "启用"}</button>{" "}
        <button className="l-btn sm" onClick={() => openMissionArchive(task, label, monthly)} disabled={!canModuleWrite}>归档</button>
      </>}
    </>;
  };

  const runEventDelete = async (eventId: string, expectedVersion: string, reason: string) => {
    if (!ctx.can("growth_h4_write")) throw new Error("你没有删除活动的权限。");
    try {
      apply(await deleteH4QuestEvent(eventId, expectedVersion, reason));
      toast("活动已删除，历史参与、奖励与操作记录保留");
    } finally { pendingDeleteChanged(value => value + 1); }
  };
  const openEventDelete = (event: QuestEvent) => {
    if (!canModuleWrite || loading || error || !isDeletableQuestEvent(event)) return;
    openActionConfirm({
      action: `删除活动 · ${event.name}`,
      detail: <>删除后活动从活动中心消失，已有的参与、奖励和操作记录仍保留。只能删除草稿或已结束的活动。</>,
      run: reason => runEventDelete(event.id, event.deleteVersion!, reason),
    });
  };

  const openCreateEvent = () => {
    openActionConfirm({
      action: "新建活动",
      detail: <>新建一个活动。活动 ID 用英文且不能重复；主推活动必须在进行中，且同时只能有一个。</>,
      amplifies: true,
      businessForm: { kind: "quest-event-config", subject: "新活动" },
      run: async (reason, _v, bv) => {
        if (!bv) return;
        const payload = {
          id: String(bv.id || "").trim(),
          name: String(bv.name || "").trim(),
          kind: bv.kind || "discount",
          state: bv.state || "ongoing",
          reward: String(bv.reward || "").trim(),
          condition: String(bv.condition || "").trim(),
          targetValue: Number(bv.targetValue) || 1,
          geo: String(bv.geo || "").trim(),
          href: String(bv.href || "").trim(),
          startsAt: String(bv.startsAt || "").trim() || null,
          endsAt: String(bv.endsAt || "").trim() || null,
          featured: bv.featured === "true",
          trackable: bv.trackable === "true",
        };
        if (!payload.id || !payload.name) return;
        apply(await createH4QuestEvent(payload, reason));
        toast(`活动「${payload.name}」已新建`);
      },
    });
  };

  const openCreateWheelTier = () => {
    openActionConfirm({
      action: "新建转盘奖项",
      detail: <>新建一个转盘奖项。概率填 0–100，所有奖项加起来要等于 100%。发真钱的奖项，覆盖率低于红线时无法保存。</>,
      amplifies: true,
      businessForm: { kind: "wheel-tier-config", subject: "新档位" },
      run: async (reason, _v, bv) => {
        if (!bv) return;
        const payload = {
          tierName: String(bv.tierName || "").trim(),
          rewardName: String(bv.rewardName || "").trim(),
          probabilityPct: Number(bv.probabilityPct) || 0,
          realOutflow: bv.realOutflow === "1" ? 1 : 0,
          rewardKind: bv.rewardKind || "uvt",
          rewardAmount: Number(bv.rewardAmount) || 0,
          voucherId: String(bv.voucherId || "").trim() || null,
          dailyStock: Math.max(0, Number(bv.dailyStock) || 0),
        };
        if (!payload.tierName || !payload.rewardName) return;
        apply(await createH4WheelTier(payload, text(model?.wheelSignature, "__EMPTY__"), reason));
        toast(`奖项「${payload.tierName}」已新建`);
      },
    });
  };

  const openCreateWheelGuard = () => {
    openActionConfirm({
      action: "新建转盘安全限制",
      detail: <>新建一条转盘安全限制。标识只能用小写英文字母，不能重复。</>,
      businessForm: { kind: "wheel-guard-config", subject: "新安全限制" },
      run: async (reason, _v, bv) => {
        if (!bv) return;
        const payload = {
          guardKey: String(bv.guardKey || "").trim(),
          guardLabel: String(bv.guardLabel || "").trim(),
          guardValue: String(bv.guardValue || "").trim(),
          note: String(bv.note || "").trim(),
        };
        if (!payload.guardKey || !payload.guardLabel) return;
        apply(await createH4WheelGuard(payload, reason));
        toast(`安全限制「${payload.guardLabel}」已新建`);
      },
    });
  };

  const taskTitleText = (value: string) => {
    const branded = nexGridBrandText(value);
    return ({
      "Start your first order": "开始首笔订单", "Complete a qualified referral": "完成一次符合条件的邀请",
      "Complete a learning course": "完成一门课程", "Activate a device": "激活一台设备",
      "查看 UVELBox S1 ROI": "查看 UVELBox S1 预计回报", "购入 Genesis 创世节点": "购入创世节点",
      "锁仓 USDT $1,000+ 进入 365 天 Staking": "锁定不少于 1,000 USDT，参与 365 天质押",
      "扩展硬件 fleet · 加购一台": "扩充设备 · 加购一台", "首台 UVELBox · 止血 $7/天": "首台 UVELBox · 每日收益 7 美元",
    } as Record<string,string>)[branded] ?? branded;
  };
  const openWheelGuard = (guard: { key: string; label: string; value: string }) => {
    const current = text(guard.value);
    openActionConfirm({
      action: `转盘安全限制 · ${({ budget: "每日实际奖励预算（美元）", cap: "各奖档每日库存", kill: "实际奖品发放开关" } as Record<string,string>)[guard.key] ?? operatorCopyText(guard.label)}`,
      detail: <>当前值 <b>{guard.key === "cap" ? "按各奖档每日库存" : ({on:"启用",off:"停用"} as Record<string,string>)[current] ?? operatorCopyText(current)}</b>。如果别人刚改过，需要刷新后再改。</>,
      amplifies: guard.key !== "kill",
      edit: { kind: "text", current },
      run: async (reason, value) => {
        if (!value) return;
        apply(await updateH4WheelGuard(guard.key, value, current, reason));
        toast(`转盘安全限制「${({ budget: "每日实际奖励预算（美元）", cap: "各奖档每日库存", kill: "实际奖品发放开关" } as Record<string,string>)[guard.key] ?? operatorCopyText(guard.label)}」已更新`);
      },
    });
  };

  const openWheelProbabilities = () => {
    const tiers = model?.wheelTiers ?? [];
    openActionConfirm({
      action: "调整转盘奖项概率",
      detail: <>一次设置所有奖项，加起来要等于 100%。调高发钱奖项的概率时，覆盖率低于红线无法保存。</>,
      amplifies: true,
      businessForm: {
        kind: "multi-field",
        title: "转盘奖项概率",
        hint: "所有奖项一起提交，加起来要等于 100%。",
        requireAnyChange: true,
        fields: tiers.map((tier) => ({
          key: text(tier.tier),
          label: `${text(tier.tier)} · ${wheelRewardText(tier.reward)}`,
          current: String(numericValue(tier.prob)),
          inputKind: "number" as const,
          min: 0,
          max: 100,
          step: 0.0001,
          required: true,
          showDiff: true,
        })),
      },
      run: async (reason, _value, businessValue) => {
        if (!businessValue) return;
        const probabilities = Object.fromEntries(tiers.map((tier) => [
          text(tier.tier),
          Number(businessValue[text(tier.tier)]),
        ]));
        const total = Object.values(probabilities).reduce((sum, value) => sum + value, 0);
        if (Math.abs(total - 100) > 0.0001) {
          throw new Error("所有奖项的概率加起来要等于 100%");
        }
        apply(await updateH4WheelProbabilities(
          probabilities,
          text(model?.wheelSignature, "__EMPTY__"),
          reason,
        ));
        toast("转盘概率已更新");
      },
    });
  };

  const openNumericConfig = (
    key: string,
    label: string,
    current: string,
    min: number,
    max: number,
    step: number,
    amplifiesWhen?: "increase" | "decrease",
  ) => {
    const expected = String(numericValue(current));
    openActionConfirm({
      action: label,
      detail: <>当前值 <b>{current}</b>。如果别人刚改过，需要刷新后再改。</>,
      edit: { kind: "number", current: expected, min, max, step, disallowCurrent: true, amplifiesWhen },
      run: async (reason, value) => {
        if (!value) return;
        await updateConfigWithExpected(key, value, expected, reason, label);
      },
    });
  };

  const openPromoStatus = () => {
    const current = text(model?.promoBanner?.status, "paused").toLowerCase();
    const next = current === "active" ? "paused" : "active";
    openActionConfirm({
      action: next === "active" ? "启用首页备用促销卡" : "暂停首页备用促销卡",
      detail: <>当前 <b>{current === "active" ? "已启用" : "已暂停"}</b>。只控制「没有未领取的周任务时，显示跳转商城」的备用卡，不影响周任务卡本身。</>,
      amplifies: next === "active",
      run: async (reason) => {
        await updateConfigWithExpected("promoBanner.status", next, current, reason, "首页备用促销卡状态");
      },
    });
  };

  const openEditWheelTier = (tier: Record<string, any>) => {
    const tierName = text(tier.tier);
    openActionConfirm({
      action: `编辑转盘奖项 · ${tierName}`,
      detail: <>编辑奖项名称、奖励类型、是否发真钱。概率请在「改奖池 / 概率」里统一调，保证加起来是 100%。</>,
      amplifies: true,
      businessForm: {
        kind: "multi-field",
        title: `奖项设置 · ${tierName}`,
        requireAnyChange: true,
        fields: [
          { key: "rewardName", label: "奖项名称", current: text(tier.reward), inputKind: "text", required: true, showDiff: true },
          { key: "rewardKind", label: "奖励类型", current: text(tier.kind, "uvt"), inputKind: "select", options: ["uvt", "points", "usdt", "coupon"], optionLabels: { uvt: "UVT", points: "积分", usdt: "USDT", coupon: "代金券" }, required: true, showDiff: true },
          { key: "realOutflow", label: "是否发真钱", current: boolValue(tier.real) ? "1" : "0", inputKind: "select", options: ["0", "1"], optionLabels: { "0": "否", "1": "是" }, required: true, showDiff: true },
          { key: "rewardAmount", label: "每次发放数量", current: String(numericValue(tier.amount)), inputKind: "number", min: 0.000001, max: 1000000, step: 0.000001, required: true, showDiff: true },
          { key: "voucherId", label: "代金券 ID", current: text(tier.voucherId, ""), inputKind: "text", showDiff: true },
          { key: "dailyStock", label: "每日库存（0 = 不限）", current: String(numericValue(tier.dailyStock)), inputKind: "number", min: 0, max: 1000000, step: 1, required: true, showDiff: true },
        ],
      },
      run: async (reason, _value, bv) => {
        if (!bv) return;
        apply(await updateH4WheelTier(tierName, {
          tierName,
          rewardName: String(bv.rewardName || "").trim(),
          probabilityPct: numericValue(tier.prob),
          realOutflow: bv.realOutflow === "1" ? 1 : 0,
          rewardKind: bv.rewardKind || "uvt",
          rewardAmount: Number(bv.rewardAmount),
          voucherId: String(bv.voucherId || "").trim() || null,
          dailyStock: Math.max(0, Number(bv.dailyStock) || 0),
        }, text(model?.wheelSignature, "__EMPTY__"), reason));
        toast(`奖项「${tierName}」已更新`);
      },
    });
  };

  const openDeleteWheelTier = (tier: Record<string, any>) => {
    const tierName = text(tier.tier);
    const probability = numericValue(tier.prob);
    openActionConfirm({
      action: `删除转盘奖项 · ${tierName}`,
      detail: probability === 0
        ? <>删除后至少还要保留 2 个奖项。</>
        : <>请先在「改奖池 / 概率」把这个奖项的概率调成 0%，再删除。</>,
      run: async (reason) => {
        if (probability !== 0) throw new Error("删除前请先把概率调成 0%");
        apply(await deleteH4WheelTier(
          tierName,
          text(model?.wheelSignature, "__EMPTY__"),
          reason,
        ));
        toast(`奖项「${tierName}」已删除`);
      },
    });
  };

  if (loading) {
    return <section className="l-card"><div className="l-b">{moduleLabel}数据加载中…</div></section>;
  }

  if (error || !model) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">{moduleLabel}数据加载失败</span></div>
        <div className="l-b">
          <div>{error ?? "没有收到数据，请重试；一直失败请联系值班同事。"}</div>
          <button className="l-btn sm mc" style={{ marginTop: 12 }} onClick={() => void reload()}>
            重试加载
          </button>
        </div>
      </section>
    );
  }

  const h3Stats = model.h3Stats ?? {};
  const h4Stats = model.h4Stats ?? {};
  const currentPhase = text(model.phaseMultiplierReadonly?.currentPhase, "");
  const currentPhaseCode = cleanPhaseKey(currentPhase);
  // 同一页面出现两个互斥倍率的根因:顶部读「每周任务自己的阶段倍率曲线」,底部读「H1 全局任务加成」,
  // 两者是不同旋钮,却都被说成「当前 P2 任务加成」(#138)。这里只保留 H1 权威值作为「任务加成」,
  // 周任务曲线单独标注为「每周任务曲线倍率」,并在服务端未返回时统一显示「暂不可计算」而不是 0×。
  const phaseMultiplierRaw = text(model.phaseMultiplierReadonly?.value, "");
  const phaseMultiplier = phaseMultiplierRaw ? `${phaseMultiplierRaw}x` : "暂无法计算";
  const weeklyCurveMultiplier = model.weeklyMultipliers?.find((item) => cleanPhaseKey(item.p) === currentPhaseCode)?.mult;
  const weeklyCurveLabel = weeklyCurveMultiplier ? `${weeklyCurveMultiplier}` : "暂无法计算";
  const promoBanner = model.promoBanner ?? {};
  const wheelProbabilitySum = (model.wheelTiers ?? []).reduce((sum, tier) => sum + numericValue(tier.prob), 0);
  const wheelProbabilityOk = Math.abs(wheelProbabilitySum - 100) < 0.001;
  const localizedRows = section === "tasks"
    ? [
        ...[...model.dayOneTasks, ...model.weeklyTier1, ...model.weeklyTier2].map((task) => ({
          entity: "mission" as const, code: text(task.taskCode ?? task.missionCode ?? task.id, ""), label: text(task.task),
        })),
      ]
    : (model.events ?? []).map((event) => ({ entity: "event" as const, code: event.id, label: event.name }));

  /**
   * 目标语言缺失清单。
   *
   * 从 PC 已经收到的 `contentLocales` 直接派生,不额外要后端下发一份 —— 同一份数据算两遍
   * 就有两个真相。英文可回退事件原文,zh/vi 没有回退来源:缺了就是中文/越南语用户看到英文。
   * 该清单同时用于表格标记与顶部阻断提示,并被后端「转入 ongoing 必须填全」的门对齐。
   */
  const localizedGaps = (model.events ?? []).flatMap((event) =>
    (["zh", "vi"] as const).flatMap((locale) =>
      (["name", "description", "rewardName"] as const)
        .filter((field) => !text(model.contentLocales?.event?.[event.id]?.[locale]?.[field], ""))
        .map((field) => ({ eventCode: event.id, locale, field })),
    ),
  );

  return (
    <>
      {section === "tasks" ? (
        <div className="f-stats">
          <div className="f-stat">
            <div className="k">首日任务领取率</div>
            <div className="v">{text(h3Stats.dayOneRate24h)} / {text(h3Stats.dayOneRateGrace)}</div>
            <div className="sub">24 小时内领全额 · 超时后领得少</div>
          </div>
          <div className="f-stat ok">
            <div className="k">本周完成任务（越南时间）</div>
            <div className="v">{text(h3Stats.weeklyDone)}</div>
            <div className="sub">基础任务 {text(h3Stats.t1Done)} · 进阶任务 {text(h3Stats.t2Done)}</div>
          </div>
          <div className="f-stat warn">
            <div className="k">本周发放 UVT（越南时间）</div>
            <div className="v">{text(h3Stats.weeklyNex)}</div>
            <div className="sub">含运营阶段加成 {currentPhaseCode} {phaseMultiplier}；每周任务倍率 {weeklyCurveLabel}</div>
          </div>
          <div className="f-stat cyan">
            <div className="k">正在做月度挑战</div>
            <div className="v">{numericValue(h3Stats.monthlyInflight).toLocaleString("en-US")} 人</div>
            <div className="sub">5 个主题按注册时长自动分配</div>
          </div>
        </div>
      ) : (
        <div className="f-stats">
          <div className="f-stat">
            <div className="k">进行中活动</div>
            <div className="v">{text(h4Stats.ongoing)}</div>
            <div className="sub">主推：{text(h4Stats.featuredEv)}</div>
          </div>
          <div className="f-stat ok">
            <div className="k">可追踪活动转化</div>
            <div className="v">参与 {text(h4Stats.trackJoin)}</div>
            <div className="sub">达标 {text(h4Stats.trackDone)} · 已领 {text(h4Stats.trackClaim)}</div>
          </div>
          <div className="f-stat warn">
            <div className="k">今日转盘奖励</div>
            <div className="v">{text(h4Stats.wheelToday)}</div>
          </div>
          <div className="f-stat danger">
            <div className="k">限地区的活动</div>
            <div className="v">{text(h4Stats.geoBlocked)}</div>
            <div className="sub">紧急处理请去「紧急停用开关」</div>
          </div>
        </div>
      )}

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">App 运营内容（三语）</span>
          <span className="sub">· 英语 / 简体中文 / 越南语；没填的显示原文，不自动翻译</span>
        </div>
        {/* 缺失即阻断:事件转入「进行中」= 对用户发布,后端要求 zh/vi 填全。此前表格只把空值
            显示成中性的「填写」按钮,运营看不出缺内容会挡住发布;中文 App 于是直接回退英文原文。 */}
        {localizedGaps.length > 0 && (
          <div className="gtint" role="status" style={{ margin: "0 0 10px" }}>
            有 {localizedGaps.length} 项翻译没填，相关活动不能设为「进行中」：
            {localizedGaps.slice(0, 6).map((gap) => `${gap.eventCode} ${LOCALE_LABEL[gap.locale]} ${LOCALIZED_FIELD_LABEL[gap.field]}`).join(" · ")}
            {localizedGaps.length > 6 ? ` 等 ${localizedGaps.length} 项` : ""}
          </div>
        )}
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 740 }}>
            <thead><tr><th>内容</th><th>内容预览</th><th>英文</th><th>中文</th><th>越南语</th></tr></thead>
            <tbody>{localizedRows.flatMap((item) => {
              const rows: Array<{ field: "name" | "description" | "rewardName"; source: string; label: string }> = [
                { field: "name", source: item.label, label: item.code },
              ];
              if (item.entity === "event") {
                rows.push(
                  { field: "description", source: text((model.events ?? []).find((event) => event.id === item.code)?.description), label: `${item.code} · 活动说明` },
                  { field: "rewardName", source: text((model.events ?? []).find((event) => event.id === item.code)?.rewardName), label: `${item.code} · 奖项名称` },
                );
              }
              return rows.map((row) => (
                <tr key={`${item.entity}:${item.code}:${row.field}`}>
                  <td className="mono">{row.label}</td>
                  <td>{taskTitleText(row.source)}</td>
                  {(["en", "zh", "vi"] as const).map((language) => {
                    const current = localizedValue(item.entity, item.code, row.field, language);
                    // 目标语言缺失(zh/vi)是发布阻断项,不是可忽略的空值 —— 单独标出。
                    const missing = !current && item.entity === "event" && language !== "en";
                    return (
                      <td key={language}>
                        <button className="l-btn sm mc" disabled={!canModuleWrite || !item.code}
                          aria-label={`${current ? "编辑" : missing ? "填写（上线前必须补齐）" : "填写"} ${row.label} ${LOCALE_LABEL[language]}`}
                          onClick={() => openLocalizedContent(item.entity, item.code, row.field, language, row.source)}>
                          {current || (missing ? "缺失" : "填写")}
                        </button>
                        {missing && <span className="bdg warn" style={{ marginLeft: 6 }} title="活动设为「进行中」前必须补齐这个语言">缺</span>}
                      </td>
                    );
                  })}
                </tr>
              ));
            })}</tbody>
          </table>
        </div>
        {section === "tasks" && model.monthlyMissions.length > 0 && (
          <div className="sub" style={{ marginTop: 10 }}>App 还没有月度任务入口，暂不提供翻译编辑。</div>
        )}
      </section>

      {section === "tasks" && (
        <>
      <div className="two-col">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">首日任务</span>
            <span className="sub">· 新用户转化最关键的一环 · 用户开始做任务时就锁定任务和奖励，之后的修改只影响还没开始的用户</span>
            <div className="r">
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("dayOne.windowMs", "首日任务时长", text(model.dayOneWindow), false)} disabled={!canModuleWrite}>
                调整
              </button>
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("dayOne.triReward", "首日任务奖励", text(model.dayOneTriReward), true)} disabled={!canModuleWrite}>
                调整奖励
              </button>
              <button className="l-btn sm mc" onClick={() => openCreateMission("DAY_ONE", "首日任务")} disabled={!canModuleWrite}>+ 新建任务</button>
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="p-row">
              <span className="k">
                任务时长
                <small>已开始的用户按各自开始时间计算，修改不影响他们。</small>
              </span>
              <span className="v">{text(model.dayOneWindow)}</span>
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("dayOne.windowMs", "首日任务时长", text(model.dayOneWindow), false)} disabled={!canModuleWrite}>调整</button>
            </div>
            <div className="p-row">
              <span className="k">
                资格有效期
                <small>按注册时间计算；过期后不再显示，也不能完成或领取。</small>
              </span>
              <span className="v">注册后 {text(model.dayOneEligibilityHours)} 小时</span>
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("dayOne.eligibilityHours", "新手任务资格有效期（小时）", text(model.dayOneEligibilityHours), false)} disabled={!canModuleWrite}>调整</button>
            </div>
            <div className="p-row">
              <span className="k">完成奖励</span>
              <span className="v">{operatorCopyText(text(model.dayOneTriReward))}</span>
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("dayOne.triReward", "首日任务奖励", text(model.dayOneTriReward), true)} disabled={!canModuleWrite}>调整</button>
            </div>

            <div className="l-h" style={{ marginTop: 12, border: 0, paddingBottom: 0 }}>
              <span className="ttl" style={{ fontSize: 13 }}>任务清单</span>
              <span className="sub">· 停用只影响还没开始的用户，已开始的照旧</span>
            </div>
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table className="l-tbl" style={{ minWidth: 680 }}>
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>类别</th>
                    <th>跳转页面</th>
                    <th className="num">奖励</th>
                    <th>状态</th>
                    <th>完成条件</th>
                    <th style={{ textAlign: "right" }}>动作</th>
                  </tr>
                </thead>
                <tbody>
                  {model.dayOneTasks.map((task, index) => {
                    const id = numberId(task.id, index);
                    const [statusLabel, statusTone] = taskStatusMeta(task);
                    const active = text(task.status, "") === "active";
                    return (
                      <tr key={id}>
                        <td style={{ fontWeight: 600, color: active ? "var(--ink)" : "var(--ink-3)" }}>{taskTitleText(text(task.task))}</td>
                        <td><span className="bdg">{TASK_CATEGORY_LABELS[text(task.category, "explore")] ?? "其他"}</span></td>
                        <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{text(task.href)}</td>
                        <td style={{ color: "var(--ink-3)" }}>见上方完成奖励</td>
                        <td><span className={`bdg ${statusTone}`}>{statusLabel}</span></td>
                        <td style={{ fontSize: 11.5 }}>
                          <span style={{ color: task.completionEvent ? "var(--ink-2)" : "var(--warning)" }}>{COMPLETION_LABEL[text(task.completionType, "unbound")] ?? "还没绑定完成条件"}</span>
                          {task.completionEvent ? <span className="mono" style={{ color: "var(--ink-4)", marginLeft: 4 }}>{text(task.completionEvent)}</span> : <span style={{ color: "var(--warning)", marginLeft: 4 }}>· 不绑定就无法完成和发奖</span>}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <span className="tiny" style={{ color: "var(--ink-3)" }}>统一奖励</span>
                          {" "}{missionLifecycleActions(task, text(task.task))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="sm-strip" style={{ marginTop: 10 }}>
              {(model.dayOneStates ?? []).map((state, index, states) => (
                <span key={state.st}>
                  <span className={`st ${state.tone}`}>{({ ACTIVE: "进行中", GRACE: "宽限中", EXPIRED: "已过期" } as Record<string,string>)[state.st.toUpperCase()] ?? "状态未知"}</span>
                  {index < states.length - 1 && <span className="ar">→</span>}
                </span>
              ))}
            </div>
            <div className="htint" style={{ marginTop: 10, fontSize: 12 }}>
              <b>流程</b> · 按时完成（做完全部任务领奖励）→ 超时（奖励变少）→ 过期（没有奖励，首页不再显示）。
            </div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">每周任务（两档 + 周冠军）</span>
            <span className="sub">· 按注册手机号区号的时区，每周一 00:00 开始新一周 · 没设置的区号用越南时间</span>
            <div className="r">
              <button className="l-btn sm mc" onClick={() => openCreateMission("WEEKLY_T1", "每周一档")} disabled={!canModuleWrite}>+ 新建一档</button>
              <button className="l-btn sm mc" onClick={() => openCreateMission("WEEKLY_T2", "每周二档")} disabled={!canModuleWrite}>+ 新建二档</button>
            </div>
          </div>
          <H3WeeklyRegionPolicyPanel ctx={ctx} />
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="l-h" style={{ marginTop: 2, border: 0, paddingBottom: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>一档（从上往下，用户符合哪条就做哪条）</span>
            </div>
            <div style={{ overflowX: "auto", marginTop: 6 }}>
              <table className="l-tbl" style={{ minWidth: 600 }}>
                <thead>
                  <tr>
                    <th>条件（从上往下优先）</th>
                    <th>类别</th>
                    <th>跳转页面</th>
                    <th className="num">奖励 UVT</th>
                    <th>状态</th>
                    <th>完成条件</th>
                    <th style={{ textAlign: "right" }}>动作</th>
                  </tr>
                </thead>
                <tbody>
                  {model.weeklyTier1.map((task, index) => {
                    const [statusLabel, statusTone] = taskStatusMeta(task);
                    return (
                      <tr key={`${task.cond}-${index}`}>
                        <td style={{ fontWeight: 600 }}>{taskTitleText(text(task.cond))}</td>
                        <td><span className="bdg">{TASK_CATEGORY_LABELS[text(task.category, "explore")] ?? "其他"}</span></td>
                        <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{text(task.href)}</td>
                        <td className="num mono" style={{ fontWeight: 700 }}>{nexGridBrandText(text(task.reward))}</td>
                        <td><span className={`bdg ${statusTone}`}>{statusLabel}</span></td>
                        <td style={{ fontSize: 11.5 }}>
                          <span style={{ color: task.completionEvent ? "var(--ink-2)" : "var(--warning)" }}>{COMPLETION_LABEL[text(task.completionType, "unbound")] ?? "还没绑定完成条件"}</span>
                          {task.completionEvent ? <span className="mono" style={{ color: "var(--ink-4)", marginLeft: 4 }}>{text(task.completionEvent)}</span> : <span style={{ color: "var(--warning)", marginLeft: 4 }}>· 不绑定就无法完成和发奖</span>}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button className="l-btn sm mc" onClick={() => openTaskReward(`mission.${text(task.taskCode ?? task.missionCode ?? task.id)}.reward`, text(task.cond), text(task.reward))} disabled={!canModuleWrite}>改奖励</button>
                          {" "}{missionLifecycleActions(task, text(task.cond))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="l-h" style={{ marginTop: 14, border: 0, paddingBottom: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>二档（每条都可以做，各自发奖）</span>
            </div>
            <div style={{ overflowX: "auto", marginTop: 6 }}>
              <table className="l-tbl" style={{ minWidth: 600 }}>
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>类别</th>
                    <th>跳转页面</th>
                    <th className="num">奖励 UVT</th>
                    <th>状态</th>
                    <th>完成条件</th>
                    <th style={{ textAlign: "right" }}>动作</th>
                  </tr>
                </thead>
                <tbody>
                  {model.weeklyTier2.map((task, index) => {
                    const [statusLabel, statusTone] = taskStatusMeta(task);
                    return (
                      <tr key={`${task.cond}-${index}`}>
                        <td style={{ fontWeight: 600 }}>{taskTitleText(text(task.cond))}</td>
                        <td><span className="bdg">{TASK_CATEGORY_LABELS[text(task.category, "explore")] ?? "其他"}</span></td>
                        <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{text(task.href)}</td>
                        <td className="num mono" style={{ fontWeight: 700 }}>{nexGridBrandText(text(task.reward))}</td>
                        <td><span className={`bdg ${statusTone}`}>{statusLabel}</span></td>
                        <td style={{ fontSize: 11.5 }}>
                          <span style={{ color: task.completionEvent ? "var(--ink-2)" : "var(--warning)" }}>{COMPLETION_LABEL[text(task.completionType, "unbound")] ?? "还没绑定完成条件"}</span>
                          {task.completionEvent ? <span className="mono" style={{ color: "var(--ink-4)", marginLeft: 4 }}>{text(task.completionEvent)}</span> : <span style={{ color: "var(--warning)", marginLeft: 4 }}>· 不绑定就无法完成和发奖</span>}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button className="l-btn sm mc" onClick={() => openTaskReward(`mission.${text(task.taskCode ?? task.missionCode ?? task.id)}.reward`, text(task.cond), text(task.reward))} disabled={!canModuleWrite}>改奖励</button>
                          {" "}{missionLifecycleActions(task, text(task.cond))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="htint cyan" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
              <span style={{ flex: 1 }}>
                <b>周冠军加奖</b> · {operatorCopyText(text(model.weeklyChampionBonus))} · 本周累计 UVT 最多的用户额外奖励
              </span>
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("weekly.champBonus", "周冠军加奖", text(model.weeklyChampionBonus), true)} disabled={!canModuleWrite}>调整</button>
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, margin: "12px 0 6px", color: "var(--ink-2)" }}>
              各阶段倍率（点击修改）
            </div>
            <div className="mult-track">
              {(model.weeklyMultipliers ?? []).map((item) => {
                const phase = cleanPhaseKey(item.p);
                const isCurrent = phase === currentPhaseCode;
                return (
                  <div
                    key={item.p}
                    className={`seg${isCurrent ? " cur" : ""}`}
                    onClick={canModuleWrite ? () => openSimpleConfig(`weekly.mult.${phase}`, `阶段倍率 ${phase}`, text(item.mult), true) : undefined}
                    style={{ cursor: canModuleWrite ? "pointer" : "default" }}
                    title={canModuleWrite ? "点击改值" : "只读"}
                  >
                    <div className="m">{phase}{isCurrent ? " 当前" : ""}</div>
                    <div className="vv">{text(item.mult)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      <section className="l-card" data-proof="h3-event-binding">
        <div className="l-h">
          <span className="ttl">任务完成条件</span>
          <span className="sub">· 用户做了某件事 → 对应任务算完成。新任务要先绑定再启用</span>
          <div className="r"><button className="l-btn sm mc" onClick={openCreateBinding} disabled={!canModuleWrite}>+ 新增绑定</button></div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 780 }}>
            <thead><tr><th>条件编号</th><th>来源</th><th>用户操作</th><th>对应任务</th><th>算谁完成</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {(model.eventBindings ?? []).map((binding) => {
                const enabled = Number(binding.status) === 1;
                return <tr key={binding.bindingCode}>
                  <td className="mono">{binding.bindingCode}</td>
                  <td>{binding.producer}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{binding.eventType}</td>
                  <td className="mono">{binding.questCode}</td>
                  <td className="mono">{binding.userIdField}</td>
                  <td>{enabled ? <span className="bdg ok">生效</span> : <span className="bdg dim">停用</span>}</td>
                  <td>
                    <button className="l-btn sm mc" onClick={() => openBindingEdit(binding)} disabled={!canModuleWrite}>修改</button>{" "}
                    <button className="l-btn sm" onClick={() => openBindingStatus(binding)} disabled={!canModuleWrite}>{enabled ? "停用" : "启用"}</button>{" "}
                    <button className="l-btn sm" onClick={() => openBindingDelete(binding)} disabled={!canModuleWrite}>删除</button>
                  </td>
                </tr>;
              })}
              {(model.eventBindings ?? []).length === 0 ? <tr><td colSpan={7} className="sub">暂无完成条件</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="l-card" data-proof="h3-event-contract">
        <div className="l-h">
          <span className="ttl">任务数据口径（只读）</span>
          <span className="sub">· 每个任务的完成记录会进入哪些统计</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1080 }}>
            <thead>
              <tr>
                <th>任务</th>
                <th>任务编号</th>
                <th>完成记录</th>
                <th>后续业务</th>
                <th>用户转化分析</th>
                <th>仅留存</th>
                <th>注册满七天后的活跃贡献</th>
                <th>数据表字段</th>
                <th className="num">24 小时完成数</th>
                <th className="num">异常率</th>
              </tr>
            </thead>
            <tbody>
              {model.dayOneTasks.map((task, index) => {
                const contract = contractForTask(task, model.taskContracts, index);
                return (
                  <tr key={`${text(task.id, String(index))}-${text(contract.taskKey, String(index))}`}>
                    <td style={{ fontWeight: 600, color: "var(--ink)" }}>{taskTitleText(text(task.task))}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{text(contract.taskKey)}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{text(contract.serverEvent)}</td>
                    <td className="mono" style={{ fontSize: 11, color: text(contract.downstream) === "-" ? "var(--ink-4)" : undefined }}>{text(contract.downstream)}</td>
                    <td>{boolValue(contract.b3) ? <span className="bdg ok">计入转化</span> : <span className="bdg dim">否</span>}</td>
                    <td>{boolValue(contract.retentionOnly) ? <span className="bdg warn">是</span> : <span className="bdg dim">否</span>}</td>
                    <td style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{text(contract.day7)}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{text(contract.bi)}</td>
                    <td className="num mono">{numericValue(contract.sample24h).toLocaleString("en-US")}</td>
                    <td className="num mono">{text(contract.anomalyPct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="htint" style={{ fontSize: 12 }}>
            <b>任务和统计用同一份完成记录</b>，所以发奖和报表的数字一致。
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">月度挑战（按注册时长分配）</span>
          <span className="sub">· 每个主题 3 个小目标全部完成才能领 · 每月重新开始</span>
          <div className="r">
            <button className="l-btn sm mc" onClick={() => openCreateMonthlyMission()} disabled={!canModuleWrite}>+ 新建月度挑战</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 680 }}>
            <thead>
              <tr>
                <th>主题</th>
                <th>注册时长</th>
                <th className="num">奖励 UVT</th>
                <th>小目标</th>
                <th>状态</th>
                <th style={{ textAlign: "right" }}>动作</th>
              </tr>
            </thead>
            <tbody>
              {model.monthlyMissions.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 24, color: "var(--ink-4)" }}>
                    还没有月度挑战。点右上角「+ 新建月度挑战」，按用户注册时长设置主题、小目标和奖励。
                  </td>
                </tr>
              )}
              {model.monthlyMissions.map((mission) => {
                const [statusLabel, statusTone] = statusMeta(mission.status);
                return (
                  <tr key={text(mission.id)}>
                    <td style={{ fontWeight: 600 }}>{nexGridBrandText(text(mission.theme))}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{text(mission.age)}</td>
                    <td className="num mono" style={{ fontWeight: 700 }}>{nexGridBrandText(text(mission.reward))}</td>
                    <td style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{nexGridBrandText(text(mission.goals))}</td>
                    <td><span className={`bdg ${statusTone}`}>{statusLabel}</span></td>
                    <td style={{ textAlign: "right" }}>
                      <button className="l-btn sm mc" onClick={() => openTaskReward(`monthly.${text(mission.id)}.reward`, text(mission.theme), text(mission.reward))} disabled={!canModuleWrite}>改奖励</button>
                      {" "}{missionLifecycleActions(mission, text(mission.theme), true)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">阶段加成（只读）与领取情况</span>
          <span className="sub">· 全局任务加成在「运营阶段设置」里改</span>
          <div className="r">
            <a href="/growth/phase" className="l-btn">去运营阶段设置 →</a>
          </div>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          <div className="htint warn" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1 }}>
              <b>全局任务加成</b> · 当前阶段 {currentPhaseCode}，全局任务倍率 {phaseMultiplier}。修改请到「运营阶段设置」。
            </span>
            <span className="v mono" style={{ fontWeight: 700 }}>{phaseMultiplier}</span>
          </div>
          <div className="htint" style={{ marginTop: 8, fontSize: 12 }}>
            <b>两种倍率别混</b> · 上方「各阶段倍率」只作用于每周任务；「全局任务加成」作用于所有任务，在「运营阶段设置」里改。
          </div>

          <div style={{ fontSize: 12, fontWeight: 600, margin: "12px 0 4px", color: "var(--ink-2)" }}>
            完成 / 领取情况
          </div>
          {(model.taskMonitor ?? []).map((item) => (
            <div className="p-row" key={item.label}>
              <span className="k"><b>{operatorCopyText(item.label)}:</b> {operatorCopyText(item.note)}</span>
            </div>
          ))}
          <div className="htint dim" style={{ marginTop: 8, fontSize: 12 }}>
            <b>发放</b> · 重复领取不会重复到账；刚好过期时按过期处理。
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">本周任务卡展示参数（首页）</span>
          <span className="sub">· 优先显示周任务，没有时显示备用促销卡</span>
          <div className="r">
            <span className={`bdg ${text(promoBanner.status, "") === "active" ? "ok" : "dim"}`}>
              {text(promoBanner.status, "") === "active" ? "备用促销卡已启用" : "备用促销卡已暂停"}
            </span>
          </div>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          <div className="p-row">
            <span className="k">
              基础奖励 × 倍率 = 最终奖励
              <small>只在没有周任务时，用于备用促销卡的奖励。</small>
            </span>
            <span className="v">{text(promoBanner.baseReward)} × {text(promoBanner.multiplier)} = {promoFinalReward(promoBanner.baseReward, promoBanner.multiplier)} UVT</span>
            <button className="l-btn sm mc" onClick={() => openNumericConfig("promoBanner.baseReward", "转化卡基础奖励", text(promoBanner.baseReward), 0, 100000, 1, "increase")} disabled={!canModuleWrite}>改基础</button>
            <button className="l-btn sm mc" onClick={() => openNumericConfig("promoBanner.multiplier", "转化卡倍率", text(promoBanner.multiplier), 0.1, 5, 0.1, "increase")} disabled={!canModuleWrite}>改倍率</button>
          </div>
          <div className="p-row">
            <span className="k">倒计时</span>
            <span className="v">{text(promoBanner.countdownDays)} 天 {text(promoBanner.countdownHours)} 小时</span>
            <button className="l-btn sm mc" onClick={() => openNumericConfig("promoBanner.countdownDays", "转化卡倒计时天数", text(promoBanner.countdownDays), 0, 365, 1)} disabled={!canModuleWrite}>改天数</button>
            <button className="l-btn sm mc" onClick={() => openNumericConfig("promoBanner.countdownHours", "转化卡倒计时小时", text(promoBanner.countdownHours), 0, 23, 1)} disabled={!canModuleWrite}>改小时</button>
          </div>
          <div className="p-row">
            <span className="k">推荐设备 / 显示的日收益</span>
            <span className="v">{(text(promoBanner.targetDevice))} · ${text(promoBanner.targetDaily)}/天</span>
            <button className="l-btn sm mc" onClick={() => openSimpleConfig("promoBanner.targetDevice", "转化卡目标设备", text(promoBanner.targetDevice), false)} disabled={!canModuleWrite}>改设备</button>
            <button className="l-btn sm mc" onClick={() => openNumericConfig("promoBanner.targetDaily", "转化卡显示的日收益", text(promoBanner.targetDaily), 0, 1000000, 0.01)} disabled={!canModuleWrite}>改日收益</button>
          </div>
          <div className="p-row">
            <span className="k">备用促销卡</span>
            <span className="v">{text(promoBanner.status, "") === "active" ? "已启用" : "已暂停"}</span>
            <button
              className="l-btn sm mc"
              onClick={openPromoStatus}
              disabled={!canModuleWrite}
            >
              {text(promoBanner.status, "") === "active" ? "暂停备用" : "启用备用"}
            </button>
          </div>
          <div className="htint" style={{ marginTop: 10, fontSize: 12 }}>
            <b>数据来源</b> · 周任务名称和奖励来自上方每周任务，倍率来自「运营阶段设置」；倒计时、推荐设备和日收益在这里设置。
            暂停只关闭「没有周任务时跳商城」的备用卡，不影响周任务卡。调高奖励或倍率时，覆盖率低于红线无法保存。
          </div>
        </div>
      </section>
        </>
      )}

      {section === "events" && (
        <>
      {pendingH4EventDeletes().map(record => <div className="l-card" key={record.commandKey} role="status">
        删除「{record.eventId}」的结果暂未确认；填写的理由：{record.reason}。
        <button className="l-btn sm" disabled={!canModuleWrite} onClick={() => openActionConfirm({
          action: `查看删除结果 · ${record.eventId}`,
          detail: <>查看上次删除是否成功，不会重复删除。</>,
          run: () => runEventDelete(record.eventId, record.expectedVersion, record.reason),
        })}>查看结果</button>
      </div>)}
      <H4EventRules ctx={ctx} />
      <H4GenesisRaffle ctx={ctx} />
      <div className="two-col">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">活动列表（8 种玩法 · 共 {(model.events ?? []).length} 个）</span>
            <span className="sub">· 同时只能有一个主推活动</span>
            <div className="r">
              <button className="l-btn sm mc" onClick={() => openCreateEvent()} disabled={!canModuleWrite}>+ 新建活动</button>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>活动</th>
                  <th>玩法</th>
                  <th>状态</th>
                  <th className="num">奖励</th>
                  <th>主推</th>
                  <th style={{ textAlign: "right" }}>动作</th>
                </tr>
              </thead>
              <tbody>
                {(model.events ?? []).map((event) => {
                  const lifecycle = event.deleteState || event.state;
                  const [label, tone] = lifecycle === "draft" ? ["草稿", "dim"] : EVENT_LABEL[lifecycle] ?? stateTone.get(event.state) ?? ["状态未知", "dim"];
                  const ended = lifecycle === "ended";
                  const wheelEvent = text(event.kind).toLowerCase() === "wheel";
                  const zhName = localizedValue("event", event.id, "name", "zh");
                  const zhDescription = localizedValue("event", event.id, "description", "zh");
                  const zhRewardName = localizedValue("event", event.id, "rewardName", "zh");
                  return (
                    <tr key={event.id}>
                      <td style={{ color: "var(--ink)" }}>
                        <div style={{ fontWeight: 600 }}>{zhName || "中文标题未配置"}</div>
                        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{zhDescription || "中文说明未配置"}</div>
                      </td>
                      <td><span className="bdg dim">{({ discount: "限时优惠", referral: "邀请推广", wheel: "幸运转盘", regional: "地区活动", boost: "收益加成", seasonal: "节日活动", holding: "持有奖励", onboarding: "新人活动" } as Record<string,string>)[text(event.kind)] ?? "其他活动"}</span></td>
                      <td><span className={`bdg ${tone}`}>{label}</span></td>
                      <td className="num">{zhRewardName || "中文奖项未配置"}</td>
                      <td>{event.featured ? <span className="bdg warn">主推</span> : <span style={{ color: "var(--ink-4)" }}>-</span>}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {wheelEvent ? (
                          <span className="bdg dim" title="转盘奖励在下方「抽奖转盘设置」里管理" style={{ marginRight: 6 }}>
                            奖池管理
                          </span>
                        ) : (
                          <button className="l-btn sm mc" onClick={() => openEventReward(event)} disabled={ended || !canModuleWrite} style={{ marginRight: 6 }}>编辑</button>
                        )}
                        {!ended && (
                          <button className="l-btn sm mc" onClick={() => openEventStatus(event)} disabled={!canModuleWrite} style={{ marginRight: 6 }}>
                            {event.state === "ongoing" ? "下架" : "上架"}
                          </button>
                        )}
                        {!ended && event.state === "ongoing" && (
                          <button className="l-btn sm mc" onClick={() => openEventFeatured(event)} disabled={!canModuleWrite}>
                            {event.featured ? "取消主推" : "设主推"}
                          </button>
                        )}
                        <button className="l-btn sm" style={{ marginLeft: 6 }} disabled={!canModuleWrite || loading || !!error || !isDeletableQuestEvent(event)} onClick={() => openEventDelete(event)}>删除</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 10 }}>
            <div className="sm-strip">
              {(model.eventStates?.length ? model.eventStates : [
                { state: "upcoming" as EventState, label: "预告", tone: "dim" },
                { state: "ongoing" as EventState, label: "进行中", tone: "ok" },
                { state: "ended" as EventState, label: "已结束", tone: "dim" },
              ]).map((state, index, states) => (
                <span key={state.state} style={{ display: "contents" }}>
                  <span className={`st ${state.tone}`}>{state.label}</span>
                  {index < states.length - 1 && <span className="ar">→</span>}
                </span>
              ))}
              <span className="ar" style={{ marginLeft: 10 }}>参与:</span>
              <span className="st">已参与</span>
              <span className="ar">→</span>
              <span className="st warn">已达标</span>
              <span className="ar">→</span>
              <span className="st ok">已领取</span>
            </div>
            <div className="htint" style={{ marginTop: 8, fontSize: 12 }}>
              <b>可追踪活动</b> · 查看参与、达标与领取进度。
            </div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">抽奖转盘设置</span>
            <span className="sub">· 每日免费抽奖和签到满 30 天的加抽共用一个奖池</span>
            <div className="r">
              <button className="l-btn mc" onClick={openWheelProbabilities} disabled={!canWheelWrite}>
                改奖池 / 概率
              </button>
              <button className="l-btn sm mc" onClick={() => openCreateWheelTier()} disabled={!canWheelWrite}>+ 新建奖项</button>
              <button className="l-btn sm mc" onClick={() => openCreateWheelGuard()} disabled={!canWheelWrite}>+ 新建安全限制</button>
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="wheel-row" style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-4)" }}>
              <span>奖项</span>
              <span>奖品</span>
              <span>概率</span>
              <span>类型</span>
              <span />
            </div>
            {(model.wheelTiers ?? []).map((tier) => {
              const real = boolValue(tier.real);
              return (
                <div className="wheel-row" key={text(tier.tier)}>
                  <span style={{ fontWeight: 600, color: "var(--ink)" }}>{text(tier.tier)}</span>
                  <span className="mono">{wheelRewardText(tier.reward)}</span>
                  <span className="mono" style={{ fontWeight: 700 }}>{percentText(tier.prob)}%</span>
                  <span>{real ? <span className="bdg bad">发真钱</span> : <span className="bdg dim">{({nex:"UVT奖励",UVT:"UVT奖励",usdt:"USDT奖励",USDT:"USDT奖励",voucher:"代金券",none:"未中奖"} as Record<string,string>)[text(tier.kind)] ?? "其他奖励"}</span>}</span>
                  <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button className="l-btn sm mc" aria-label={`编辑 ${text(tier.tier)}（${wheelRewardText(tier.reward)}）`} onClick={() => openEditWheelTier(tier)} disabled={!canWheelWrite}>编辑</button>
                    <button className="l-btn sm" aria-label={`删除 ${text(tier.tier)}（${wheelRewardText(tier.reward)}）`} onClick={() => openDeleteWheelTier(tier)} disabled={numericValue(tier.prob) !== 0 || !canWheelWrite} title={numericValue(tier.prob) === 0 ? "删除档位" : "先将概率调为 0%"}>删除</button>
                  </span>
                </div>
              );
            })}

            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 12, color: "var(--ink-4)" }}>概率合计</span>
              <span className={`bdg ${wheelProbabilityOk ? "ok" : "bad"}`}>
                = {wheelProbabilitySum.toFixed(1)}%{wheelProbabilityOk ? "" : " · 不等于 100"}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
              {(model.wheelGuards ?? []).map((guard) => (
                <div key={guard.key} className="htint" style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1 }}>
                    <b>{({ budget: "每日实际奖励预算（美元）", cap: "各奖档每日库存", kill: "实际奖品发放开关" } as Record<string,string>)[guard.key] ?? operatorCopyText(guard.label)}</b> {guard.key === "cap" ? "按各奖档每日库存" : ({ on: "启用", off: "停用" } as Record<string,string>)[guard.value] ?? operatorCopyText(guard.value)}
                    {guard.note && (
                      <>
                        <br />
                        <span style={{ color: "var(--ink-4)" }}>{({ budget: "按每日实际发放金额限制奖励预算。", cap: "每日数量由各奖项库存决定。", kill: "关闭后不再发放实际奖品。" } as Record<string,string>)[guard.key] ?? operatorCopyText(guard.note)}</span>
                      </>
                    )}
                  </span>
                  {guard.key === "cap" ? (
                    <span className="bdg dim" title="每日上限按各奖项的每日库存设置">
                      历史只读
                    </span>
                  ) : (
                    <button className="l-btn sm mc" onClick={() => openWheelGuard(guard)} disabled={!canWheelWrite}>
                      {guard.key === "kill" ? "切" : "调"}
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="htint cyan" style={{ marginTop: 8, fontSize: 12 }}>
              <b>平均每次抽奖发出 ≈ ${text(model.wheelEvUsd)}</b> · 只算发真钱的奖项，改奖池后自动重算。
            </div>
            <div className="htint ok" style={{ marginTop: 8, fontSize: 12 }}>
              <b>自动保护</b> · 每次抽奖前检查覆盖率，低于 100% 时暂停发钱、改发 UVT 安慰奖，恢复后自动恢复。
            </div>
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">可追踪活动监控</span>
          <span className="sub">· 只读 · 设备、团队、理财类活动的进度</span>
          <div className="r">
            <span className="bdg dim">参与 → 达标 → 领取</span>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 880 }}>
            <thead>
              <tr>
                <th>活动</th>
                <th>达标条件</th>
                <th className="num">参与</th>
                <th className="num">达标</th>
                <th className="num">已领</th>
                <th>地区</th>
              </tr>
            </thead>
            <tbody>
              {(model.trackables ?? []).map((item) => (
                <tr key={item.id}>
                  <td style={{ fontWeight: 600, color: "var(--ink)" }}>{item.name}</td>
                  <td style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{item.cond}</td>
                  <td className="num mono">{item.join}</td>
                  <td className="num mono">{item.done}</td>
                  <td className="num mono">{item.claim}</td>
                  <td>{item.geo === "全区" ? <span className="bdg dim">全区</span> : <span className="bdg warn">{item.geo}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="htint" style={{ fontSize: 12 }}>
            <b>时间限制</b> · 活动关闭或结束后不能再参加，已获得的奖励按活动规则领取。
          </div>
        </div>
      </section>
        </>
      )}

      <PaginationExemptionList
        items={section === "tasks"
          ? [
              {
                label: "首日任务",
                maxRows: model.dayOneTasks.length,
                reason: "任务很少，需要一屏核对奖励",
              },
              {
                label: "周任务",
                maxRows: model.weeklyTier1.length + model.weeklyTier2.length,
                reason: "需要一屏核对两档奖励",
              },
              {
                label: "月度任务",
                maxRows: model.monthlyMissions.length,
                reason: "主题很少，一屏核对更方便",
              },
            ]
          : [
              {
                label: "活动列表",
                maxRows: (model.events ?? []).length,
                reason: "需要一屏核对活动状态和主推",
              },
              {
                label: "可追踪活动",
                maxRows: model.trackables?.length ?? 0,
                reason: "清单很短，只读",
              },
            ]}
      />
    </>
  );
}

export function H4ActivityCenter({ ctx }: { ctx: HCtx }) {
  return <H3QuestEvents ctx={ctx} section="events" />;
}

export default H3QuestEvents;
