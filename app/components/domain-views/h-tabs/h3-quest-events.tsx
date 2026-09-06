"use client";

import { useEffect, useMemo, useState } from "react";
import { PaginationExemptionList } from "../design-kit";
import {
  fetchH3QuestEvents,
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
  createH4WheelTier,
  updateH4WheelProbabilities,
  updateH4WheelTier,
  deleteH4WheelTier,
  createH4WheelGuard,
  updateH4WheelGuard,
} from "@/lib/admin/h-client";
import type { HCtx } from "./types";
import { displayAdminError } from "@/lib/admin/error-messages";

type EventState = "upcoming" | "ongoing" | "ended";
type HSection = "tasks" | "events";

type QuestTask = Record<string, any>;
type QuestEvent = {
  id: string;
  name: string;
  kind?: string;
  state: EventState;
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
  events: QuestEvent[];
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
  event: "业务事件",
  visit: "访问路径",
  ledger: "账本入账",
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
  "/pages/me/wallet-exchange": "NEX / USDT 兑换",
  "/pages/me/wallet-repurchase": "复投",
  "/pages/me/devices": "我的设备",
  "/pages/earn/earn": "收益",
  "/pages/store/store": "商城",
  "/pages/store/detail?id=stellarbox-s1": "StellarBox S1 详情",
  "/pages/team/team": "团队",
  "/pages/team/commissions": "佣金",
  "/pages/learn/courses": "学习中心",
  "/pages/staking/staking": "Staking",
  "/pages/genesis/genesis": "Genesis",
  "/pages/genesis/marketplace": "Genesis 二级市场",
};

// 只暴露 Java OpsGrowthController 已接受的规范事件，避免运营手填 JSON 或拼接事件名。
const H3_BINDING_EVENT_PRODUCERS: Record<string, H3QuestEventBinding["producer"]> = {
  "checkout.started": "ORDER",
  H8_REFERRAL_REWARD_SETTLED: "REFERRAL",
  LEARNING_COURSE_COMPLETED: "LEARNING",
  "admin.device_activated": "DEVICE",
  COMMISSION_UNLOCKED: "COMMISSION",
};
const H3_BINDING_EVENT_OPTIONS = Object.keys(H3_BINDING_EVENT_PRODUCERS);
const H3_BINDING_EVENT_LABELS: Record<string, string> = {
  "checkout.started": "订单 · checkout.started",
  H8_REFERRAL_REWARD_SETTLED: "邀请奖励结算",
  LEARNING_COURSE_COMPLETED: "学习课程完成",
  "admin.device_activated": "设备激活",
  COMMISSION_UNLOCKED: "佣金解锁",
};
const H3_BINDING_USER_FIELDS = ["user_id", "inviter_user_id"];
const H3_BINDING_USER_FIELD_LABELS: Record<string, string> = {
  user_id: "事件用户 user_id",
  inviter_user_id: "邀请人 inviter_user_id",
};

function text(value: unknown, fallback = "-") {
  if (value == null || value === "") return fallback;
  return String(value);
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

export function H3QuestEvents({ ctx, section = "tasks" }: { ctx: HCtx; section?: HSection }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const canModuleWrite = ctx.can(section === "events" ? "growth_h4_write" : "growth_h3_write");
  const canWheelWrite = ctx.can("growth_h4_wheel_pool_write");
  const [model, setModel] = useState<H3Model | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const moduleLabel = section === "events" ? "H4 活动中心" : "H3 任务引擎";

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
      const missionCode = text(task.taskCode ?? task.missionCode ?? task.completionEvent ?? task.id, "").trim();
      if (!missionCode || text(task.status, "") !== "active" || seen.has(missionCode)) return [];
      seen.add(missionCode);
      return [{ missionCode, label: `${text(task.task ?? task.cond, missionCode)} · ${missionCode}` }];
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
        toast("写入结果未知；已回读当前服务端状态，请核对后以相同理由重试");
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
        toast("任务写入结果未知；已回读当前服务端状态，请核对后以同一命令重试");
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
      detail: <>当前值 <b>{current}</b>,提交后写入后端配置并刷新读模型。</>,
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
      detail: <>当前奖励 <b>{current}</b>。升奖励可能放大流出,后端会做覆盖率红线校验。</>,
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
      detail: <>当前奖励 <b>{current}</b>,后端保存到活动配置。</>,
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
      detail: <>当前状态 <b>{EVENT_LABEL[event.state]?.[0] ?? event.state}</b>,状态变更由后端校验。</>,
      chips: [["写活动配置", "ready"], ["审计留痕", "done"]],
      reason: true,
      input: { label: "目标状态", options: statusOptions(event.state) },
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
      detail: <>主推活动唯一性由后端校验;若已有进行中主推活动,接口会拒绝。</>,
      chips: [["后端唯一校验", "ready"], ["审计留痕", "done"]],
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
      detail: <>新建一条{subject};编号英文唯一,奖励放大 NEX 流出过 B1 红线。</>,
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
        toast(`· 任务「${missionName}」已新建`);
      },
    });
  };

  const openCreateMonthlyMission = () => {
    openActionConfirm({
      action: "新建月度挑战",
      detail: <>新建月度挑战主题;按账龄段派发,奖励 &gt; 0 过 B1 红线。</>,
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
          rewardType: bv.rewardType || "NEX",
          rewardAmount: Number(bv.rewardAmount) || 0,
          rewardName: String(bv.rewardName || "").trim(),
        };
        if (!payload.challengeCode || !payload.challengeName) return;
        await applyMissionMutation(createH3MonthlyMission(payload, reason));
        toast(`· 月度挑战「${payload.challengeName}」已新建`);
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
      detail: <>这是运营填写的 {locale.toUpperCase()} 文案；未填写时 App 明确回退为现有原文，不会自动翻译或改名。</>,
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
    taskCode: text(task.taskCode ?? task.completionEvent ?? task.id),
    taskKind: (text(task.taskKind, monthly ? "MONTHLY" : "MISSION") === "MONTHLY" ? "MONTHLY" : "MISSION") as H3MissionKind,
    status: text(task.status, "paused") as "active" | "paused" | "archived",
  });

  const openMissionEdit = (task: QuestTask, label: string, monthly = false) => {
    const { taskCode, taskKind, status } = taskIdentity(task, monthly);
    if (status === "archived") return;
    openActionConfirm({
      action: `编辑任务 · ${label}`,
      detail: <>只修改任务名称;奖励仍由“改奖励”独立提交。后端会校验页面旧值并返回最新任务清单。</>,
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
      detail: <>保存后由 Java 持久化并下发 App；App 不再根据任务编号猜类别或跳转页面。并发修改会按页面旧值拒绝覆盖。</>,
      businessForm: {
        kind: "multi-field",
        title: `App 展示与动作 · ${label}`,
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
            label: "去完成路径",
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
      detail: <>仅允许 active 与 paused 双向切换;归档任务不可恢复。后端按当前状态做 CAS 校验。</>,
      chips: [["状态机校验", "ready"], ["审计留痕", "done"]],
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
      detail: <>归档后不可重新启用或编辑;如需删除,必须先完成本次归档并以服务端回读状态为准。</>,
      chips: [["不可逆状态", "ready"], ["审计留痕", "done"]],
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
      detail: <>后端只允许删除 archived 状态任务;操作采用软删除并保留审计记录。</>,
      chips: [["仅已归档", "ready"], ["软删除", "done"]],
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
      action: `${enabled ? "停用" : "启用"}事件绑定 · ${binding.bindingCode}`,
      detail: <>绑定只会在目标任务仍为生效中时被 Java 接受；保存按当前整行 CAS 校验，避免覆盖并发配置。</>,
      chips: [["启用任务校验", "ready"], ["审计留痕", "done"]],
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
        toast(`事件绑定「${binding.bindingCode}」已${enabled ? "停用" : "启用"}`);
      },
    });
  };

  const bindingFormFields = (binding?: H3QuestEventBinding) => {
    const currentQuestCode = binding?.questCode ?? bindingMissionOptions[0]?.missionCode ?? "";
    const questCodes = binding && !bindingMissionLabels[currentQuestCode]
      ? [currentQuestCode, ...bindingMissionOptions.map((item) => item.missionCode)]
      : bindingMissionOptions.map((item) => item.missionCode);
    const questLabels = binding && !bindingMissionLabels[currentQuestCode]
      ? { ...bindingMissionLabels, [currentQuestCode]: `${currentQuestCode} · 当前绑定（已不在生效任务列表）` }
      : bindingMissionLabels;
    return [
      ...(binding ? [] : [{
        key: "bindingCode",
        label: "绑定编号",
        current: "",
        inputKind: "text" as const,
        required: true,
        placeholder: "例如 ORDER_FIRST_CHECKOUT",
        hint: "仅英文大写、数字、_ 或 -；创建后不可修改。",
      }]),
      {
        key: "eventType",
        label: "规范业务事件",
        current: binding?.eventType ?? H3_BINDING_EVENT_OPTIONS[0],
        inputKind: "select" as const,
        options: H3_BINDING_EVENT_OPTIONS,
        optionLabels: H3_BINDING_EVENT_LABELS,
        required: true,
        showDiff: Boolean(binding),
      },
      {
        key: "questCode",
        label: "目标生效任务",
        current: currentQuestCode,
        inputKind: "select" as const,
        options: questCodes,
        optionLabels: questLabels,
        required: true,
        showDiff: Boolean(binding),
      },
      {
        key: "userIdField",
        label: "事件用户字段",
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
      toast("没有可绑定的生效任务，请先创建并启用 H3 任务");
      return;
    }
    openActionConfirm({
      action: "新增任务完成事件绑定",
      detail: <>选择 Java 已发布的规范事件与一条生效任务。事件生产者由选择自动确定，后端会校验重复事件槽位并记录理由。</>,
      businessForm: {
        kind: "multi-field",
        title: "新增事件绑定",
        hint: "不接受 JSON；请选择规范事件、目标任务和事件用户字段。",
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
        toast(`事件绑定「${bindingCode}」已新增并回读`);
      },
    });
  };

  const openBindingEdit = (binding: H3QuestEventBinding) => {
    openActionConfirm({
      action: `改绑事件 · ${binding.bindingCode}`,
      detail: <>选择新的规范事件、目标生效任务或用户字段；提交带当前整行 CAS，冲突或结果未知时不会以页面猜测覆盖服务端状态。</>,
      businessForm: {
        kind: "multi-field",
        title: `改绑 · ${binding.bindingCode}`,
        hint: "事件生产者随规范事件自动确定；保存成功后从 H3 任务接口重新读取。",
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
        toast(`事件绑定「${binding.bindingCode}」已改绑并回读`);
      },
    });
  };

  const openBindingDelete = (binding: H3QuestEventBinding) => {
    const enabled = Number(binding.status) === 1;
    openConfirm({
      action: `删除事件绑定 · ${binding.bindingCode}`,
      detail: <>删除为软删除并留下审计记录；删除后该业务事件不会再驱动任务完成。</>,
      chips: [["软删除", "ready"], ["审计留痕", "done"]],
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
        toast(`事件绑定「${binding.bindingCode}」已删除`);
      },
    });
  };

  const missionLifecycleActions = (task: QuestTask, label: string, monthly = false) => {
    const { status } = taskIdentity(task, monthly);
    return <>
      <button className="l-btn sm" onClick={() => openMissionEdit(task, label, monthly)} disabled={!canModuleWrite || status === "archived"}>编辑</button>{" "}
      {!monthly ? <><button className="l-btn sm mc" onClick={() => openMissionPresentation(task, label)} disabled={!canModuleWrite || status === "archived"}>配置类别/去完成</button>{" "}</> : null}
      {status === "archived" ? (
        <button className="l-btn sm" onClick={() => openMissionDelete(task, label, monthly)} disabled={!canModuleWrite}>删除</button>
      ) : <>
        <button className="l-btn sm" onClick={() => openMissionStatus(task, label, monthly)} disabled={!canModuleWrite}>{status === "active" ? "停用" : "启用"}</button>{" "}
        <button className="l-btn sm" onClick={() => openMissionArchive(task, label, monthly)} disabled={!canModuleWrite}>归档</button>
      </>}
    </>;
  };

  const openCreateEvent = () => {
    openActionConfirm({
      action: "新建活动",
      detail: <>新建活动事件;id 英文唯一,主推需进行中且全局唯一。</>,
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
        toast(`· 活动「${payload.name}」已新建`);
      },
    });
  };

  const openCreateWheelTier = () => {
    openActionConfirm({
      action: "新建轮盘档位",
      detail: <>新建抽奖档位;概率 0-100,所有档位概率和应=100,真实出金过 B1 红线。</>,
      amplifies: true,
      businessForm: { kind: "wheel-tier-config", subject: "新档位" },
      run: async (reason, _v, bv) => {
        if (!bv) return;
        const payload = {
          tierName: String(bv.tierName || "").trim(),
          rewardName: String(bv.rewardName || "").trim(),
          probabilityPct: Number(bv.probabilityPct) || 0,
          realOutflow: bv.realOutflow === "1" ? 1 : 0,
          rewardKind: bv.rewardKind || "nex",
          rewardAmount: Number(bv.rewardAmount) || 0,
          voucherId: String(bv.voucherId || "").trim() || null,
          dailyStock: Math.max(0, Number(bv.dailyStock) || 0),
        };
        if (!payload.tierName || !payload.rewardName) return;
        apply(await createH4WheelTier(payload, text(model?.wheelSignature, "__EMPTY__"), reason));
        toast(`· 档位「${payload.tierName}」已新建`);
      },
    });
  };

  const openCreateWheelGuard = () => {
    openActionConfirm({
      action: "新建轮盘护栏",
      detail: <>新建轮盘护栏目录项;key 小写英文唯一。</>,
      businessForm: { kind: "wheel-guard-config", subject: "新护栏" },
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
        toast(`· 护栏「${payload.guardLabel}」已新建`);
      },
    });
  };

  const openWheelGuard = (guard: { key: string; label: string; value: string }) => {
    const current = text(guard.value);
    openActionConfirm({
      action: `转盘护栏 · ${guard.label}`,
      detail: <>当前值 <b>{current}</b>；提交直接更新服务端抽奖裁决读取的 H4 护栏行，并做陈旧值比较。</>,
      amplifies: guard.key !== "kill",
      edit: { kind: "text", current },
      run: async (reason, value) => {
        if (!value) return;
        apply(await updateH4WheelGuard(guard.key, value, current, reason));
        toast(`· 转盘护栏「${guard.label}」已更新`);
      },
    });
  };

  const openWheelProbabilities = () => {
    const tiers = model?.wheelTiers ?? [];
    openActionConfirm({
      action: "调整转盘档位概率",
      detail: <>一次提交整张奖池概率,服务端锁定奖池并强制合计等于 100%;提高真实流出档概率需通过 B1 红线。</>,
      amplifies: true,
      businessForm: {
        kind: "multi-field",
        title: "转盘档位概率",
        hint: "所有档位必须同时提交,合计必须等于 100%。",
        requireAnyChange: true,
        fields: tiers.map((tier) => ({
          key: text(tier.tier),
          label: `${text(tier.tier)} · ${text(tier.reward)}`,
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
          throw new Error("转盘档位概率合计必须等于 100%");
        }
        apply(await updateH4WheelProbabilities(
          probabilities,
          text(model?.wheelSignature, "__EMPTY__"),
          reason,
        ));
        toast("· 转盘档位概率已更新并重新计算奖池签名");
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
      detail: <>当前值 <b>{current}</b>，提交使用当前值比较，若其他管理员已修改则拒绝覆盖。</>,
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
      action: next === "active" ? "启用首页促销兜底" : "暂停首页促销兜底",
      detail: <>当前促销兜底 <b>{current === "active" ? "已启用" : "已暂停"}</b>。该状态只控制“没有未领取周任务时跳商店”的兜底卡，不影响活动周任务卡及其倒计时、目标设备和日产展示；并发变更会被拒绝。</>,
      amplifies: next === "active",
      run: async (reason) => {
        await updateConfigWithExpected("promoBanner.status", next, current, reason, "首页促销兜底状态");
      },
    });
  };

  const openEditWheelTier = (tier: Record<string, any>) => {
    const tierName = text(tier.tier);
    openActionConfirm({
      action: `编辑转盘档位 · ${tierName}`,
      detail: <>编辑奖项展示、奖励类型和真实流出属性；概率统一在“改奖池 / 概率”中调整，保证提交始终合计 100%。</>,
      amplifies: true,
      businessForm: {
        kind: "multi-field",
        title: `档位配置 · ${tierName}`,
        requireAnyChange: true,
        fields: [
          { key: "rewardName", label: "奖项展示", current: text(tier.reward), inputKind: "text", required: true, showDiff: true },
          { key: "rewardKind", label: "奖励类型", current: text(tier.kind, "nex"), inputKind: "select", options: ["nex", "points", "usdt", "coupon"], optionLabels: { nex: "NEX", points: "积分", usdt: "USDT", coupon: "代金券" }, required: true, showDiff: true },
          { key: "realOutflow", label: "真实流出", current: boolValue(tier.real) ? "1" : "0", inputKind: "select", options: ["0", "1"], optionLabels: { "0": "否", "1": "是" }, required: true, showDiff: true },
          { key: "rewardAmount", label: "实际派奖数量", current: String(numericValue(tier.amount)), inputKind: "number", min: 0.000001, max: 1000000, step: 0.000001, required: true, showDiff: true },
          { key: "voucherId", label: "代金券 ID", current: text(tier.voucherId, ""), inputKind: "text", showDiff: true },
          { key: "dailyStock", label: "每日全局库存(0=不限)", current: String(numericValue(tier.dailyStock)), inputKind: "number", min: 0, max: 1000000, step: 1, required: true, showDiff: true },
        ],
      },
      run: async (reason, _value, bv) => {
        if (!bv) return;
        apply(await updateH4WheelTier(tierName, {
          tierName,
          rewardName: String(bv.rewardName || "").trim(),
          probabilityPct: numericValue(tier.prob),
          realOutflow: bv.realOutflow === "1" ? 1 : 0,
          rewardKind: bv.rewardKind || "nex",
          rewardAmount: Number(bv.rewardAmount),
          voucherId: String(bv.voucherId || "").trim() || null,
          dailyStock: Math.max(0, Number(bv.dailyStock) || 0),
        }, text(model?.wheelSignature, "__EMPTY__"), reason));
        toast(`· 档位「${tierName}」已更新并记审计`);
      },
    });
  };

  const openDeleteWheelTier = (tier: Record<string, any>) => {
    const tierName = text(tier.tier);
    const probability = numericValue(tier.prob);
    openActionConfirm({
      action: `删除转盘档位 · ${tierName}`,
      detail: probability === 0
        ? <>删除后仍至少保留 2 个档位；服务端在奖池互斥锁内复核。</>
        : <>为避免概率总和失真，请先在“改奖池 / 概率”把该档概率调为 0%，再删除。</>,
      run: async (reason) => {
        if (probability !== 0) throw new Error("删除档位前必须先将概率调整为 0%");
        apply(await deleteH4WheelTier(
          tierName,
          text(model?.wheelSignature, "__EMPTY__"),
          reason,
        ));
        toast(`· 档位「${tierName}」已删除并记审计`);
      },
    });
  };

  if (loading) {
    return <section className="l-card"><div className="l-b">{moduleLabel} 数据加载中...</div></section>;
  }

  if (error || !model) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">{moduleLabel} 数据加载失败</span></div>
        <div className="l-b">
          <div>{error ?? "未收到本页数据，请重试；持续失败时请联系值班人员。"}</div>
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
  const phaseMultiplier = text(model.phaseMultiplierReadonly?.value, "0");
  const currentWeeklyMultiplier = text(
    model.weeklyMultipliers?.find((item) => cleanPhaseKey(item.p) === currentPhaseCode)?.mult,
    "0×",
  );
  const promoBanner = model.promoBanner ?? {};
  const wheelProbabilitySum = (model.wheelTiers ?? []).reduce((sum, tier) => sum + numericValue(tier.prob), 0);
  const wheelProbabilityOk = Math.abs(wheelProbabilitySum - 100) < 0.001;
  const localizedRows = section === "tasks"
    ? [
        ...[...model.dayOneTasks, ...model.weeklyTier1, ...model.weeklyTier2].map((task) => ({
          entity: "mission" as const, code: text(task.taskCode ?? task.completionEvent ?? task.id, ""), label: text(task.task),
        })),
      ]
    : model.events.map((event) => ({ entity: "event" as const, code: event.id, label: event.name }));

  return (
    <>
      {section === "tasks" ? (
        <div className="f-stats">
          <div className="f-stat">
            <div className="k">首日任务领取率</div>
            <div className="v">{text(h3Stats.dayOneRate24h)} / {text(h3Stats.dayOneRateGrace)}</div>
            <div className="sub">24h 内全额 · 宽限期降档领</div>
          </div>
          <div className="f-stat ok">
            <div className="k">本周任务完成</div>
            <div className="v">{text(h3Stats.weeklyDone)}</div>
            <div className="sub">Tier1 {text(h3Stats.t1Done)} · Tier2 {text(h3Stats.t2Done)}</div>
          </div>
          <div className="f-stat warn">
            <div className="k">本周 NEX 派发</div>
            <div className="v">{text(h3Stats.weeklyNex)}</div>
            <div className="sub">含 Phase 加成 {currentPhaseCode} {currentWeeklyMultiplier}</div>
          </div>
          <div className="f-stat cyan">
            <div className="k">月度挑战在途</div>
            <div className="v">{numericValue(h3Stats.monthlyInflight).toLocaleString("en-US")} 人</div>
            <div className="sub">5 主题按账龄自动派发</div>
          </div>
        </div>
      ) : (
        <div className="f-stats">
          <div className="f-stat">
            <div className="k">进行中活动</div>
            <div className="v">{text(h4Stats.ongoing)}</div>
            <div className="sub">主推位:{text(h4Stats.featuredEv)}(唯一)</div>
          </div>
          <div className="f-stat ok">
            <div className="k">可追踪活动转化</div>
            <div className="v">参与 {text(h4Stats.trackJoin)}</div>
            <div className="sub">达标 {text(h4Stats.trackDone)} · 已领 {text(h4Stats.trackClaim)}</div>
          </div>
          <div className="f-stat warn">
            <div className="k">今日转盘派彩</div>
            <div className="v">{text(h4Stats.wheelToday)}</div>
            <div className="sub">预算护栏内 · 真实奖正常开放</div>
          </div>
          <div className="f-stat danger">
            <div className="k">地域屏蔽活动</div>
            <div className="v">{text(h4Stats.geoBlocked)}</div>
            <div className="sub">边缘 IP 判定 · 应急编排归 J1</div>
          </div>
        </div>
      )}

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">App 运营内容（三语）</span>
          <span className="sub">· en / 简体中文 / Tiếng Việt；缺失时保留当前原文，不自动生成翻译</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 740 }}>
            <thead><tr><th>内容</th><th>原文</th><th>英文</th><th>中文</th><th>越南语</th></tr></thead>
            <tbody>{localizedRows.flatMap((item) => {
              const rows: Array<{ field: "name" | "description" | "rewardName"; source: string; label: string }> = [
                { field: "name", source: item.label, label: item.code },
              ];
              if (item.entity === "event") {
                rows.push(
                  { field: "description", source: text(model.events.find((event) => event.id === item.code)?.description), label: `${item.code} · 活动说明` },
                  { field: "rewardName", source: text(model.events.find((event) => event.id === item.code)?.rewardName), label: `${item.code} · 奖项名称` },
                );
              }
              return rows.map((row) => (
                <tr key={`${item.entity}:${item.code}:${row.field}`}>
                  <td className="mono">{row.label}</td>
                  <td>{row.source}</td>
                  {(["en", "zh", "vi"] as const).map((language) => (
                    <td key={language}>
                      <button className="l-btn sm mc" disabled={!canModuleWrite || !item.code}
                        onClick={() => openLocalizedContent(item.entity, item.code, row.field, language, row.source)}>
                        {localizedValue(item.entity, item.code, row.field, language) || "填写"}
                      </button>
                    </td>
                  ))}
                </tr>
              ));
            })}</tbody>
          </table>
        </div>
        {section === "tasks" && model.monthlyMissions.length > 0 && (
          <div className="sub" style={{ marginTop: 10 }}>月度任务尚无正式 App 消费入口，已禁用三语编辑，避免保存后无可见效果。</div>
        )}
      </section>

      {section === "tasks" && (
        <>
      <div className="two-col">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">首日任务(Day-One)</span>
            <span className="sub">· 新人转化最核心的钩子 · 改动只影响新进窗用户</span>
            <div className="r">
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("dayOne.windowMs", "首日任务时窗", text(model.dayOneWindow), false)} disabled={!canModuleWrite}>
                调整
              </button>
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("dayOne.triReward", "首日三相奖励", text(model.dayOneTriReward), true)} disabled={!canModuleWrite}>
                调整奖励
              </button>
              <button className="l-btn sm mc" onClick={() => openCreateMission("DAY_ONE", "首日任务")} disabled={!canModuleWrite}>+ 新建任务</button>
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="p-row">
              <span className="k">
                时窗
                <small>改窗对在窗用户按各自进窗时间锁定,不追溯。</small>
              </span>
              <span className="v">{text(model.dayOneWindow)}</span>
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("dayOne.windowMs", "首日任务时窗", text(model.dayOneWindow), false)} disabled={!canModuleWrite}>调整</button>
            </div>
            <div className="p-row">
              <span className="k">
                资格有效期
                <small>服务端按注册时间裁决；到期后不再展示、完成或领取。</small>
              </span>
              <span className="v">注册后 {text(model.dayOneEligibilityHours)} 小时</span>
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("dayOne.eligibilityHours", "新手任务资格有效期（小时）", text(model.dayOneEligibilityHours), false)} disabled={!canModuleWrite}>调整</button>
            </div>
            <div className="p-row">
              <span className="k">完成奖励(三相)</span>
              <span className="v">{text(model.dayOneTriReward)}</span>
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("dayOne.triReward", "首日三相奖励", text(model.dayOneTriReward), true)} disabled={!canModuleWrite}>调整</button>
            </div>

            <div className="l-h" style={{ marginTop: 12, border: 0, paddingBottom: 0 }}>
              <span className="ttl" style={{ fontSize: 13 }}>任务清单</span>
              <span className="sub">· 多字段读模型 · 奖励可调 · 停用任务不在用户端展示</span>
            </div>
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table className="l-tbl" style={{ minWidth: 680 }}>
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>类别</th>
                    <th>去完成路径</th>
                    <th className="num">奖励</th>
                    <th>状态</th>
                    <th>完成判定</th>
                    <th style={{ textAlign: "right" }}>动作</th>
                  </tr>
                </thead>
                <tbody>
                  {model.dayOneTasks.map((task, index) => {
                    const id = numberId(task.id, index);
                    const [statusLabel, statusTone] = statusMeta(task.status);
                    const active = text(task.status, "") === "active";
                    return (
                      <tr key={id}>
                        <td style={{ fontWeight: 600, color: active ? "var(--ink)" : "var(--ink-3)" }}>{text(task.task)}</td>
                        <td><span className="bdg">{TASK_CATEGORY_LABELS[text(task.category, "explore")] ?? text(task.category)}</span></td>
                        <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{text(task.href)}</td>
                        <td style={{ color: "var(--ink-3)" }}>计入新手总奖励</td>
                        <td><span className={`bdg ${statusTone}`}>{statusLabel}</span></td>
                        <td style={{ fontSize: 11.5 }}>
                          <span style={{ color: "var(--ink-2)" }}>{COMPLETION_LABEL[text(task.completionType, "visit")] ?? "访问路径"}</span>
                          {task.completionEvent ? <span className="mono" style={{ color: "var(--ink-4)", marginLeft: 4 }}>{text(task.completionEvent)}</span> : null}
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
                  <span className={`st ${state.tone}`}>{state.label}</span>
                  {index < states.length - 1 && <span className="ar">→</span>}
                </span>
              ))}
            </div>
            <div className="htint" style={{ marginTop: 10, fontSize: 12 }}>
              <b>状态机</b> · active(24h 内 6 项完成领 500)→ grace(72h 内 200)→ expired(0,首页让位)。
            </div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">每周任务(两档 + 周冠军)</span>
            <span className="sub">· 按周键确定性派发 · 同周锁定 · 改动下周生效</span>
            <div className="r">
              <button className="l-btn sm mc" onClick={() => openCreateMission("WEEKLY_T1", "每周一档")} disabled={!canModuleWrite}>+ 新建一档</button>
              <button className="l-btn sm mc" onClick={() => openCreateMission("WEEKLY_T2", "每周二档")} disabled={!canModuleWrite}>+ 新建二档</button>
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="l-h" style={{ marginTop: 2, border: 0, paddingBottom: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>一档(优先级派发 · 命中第一条)</span>
            </div>
            <div style={{ overflowX: "auto", marginTop: 6 }}>
              <table className="l-tbl" style={{ minWidth: 600 }}>
                <thead>
                  <tr>
                    <th>条件(优先级自上而下)</th>
                    <th>类别</th>
                    <th>去完成路径</th>
                    <th className="num">奖励 NEX</th>
                    <th>状态</th>
                    <th>完成判定</th>
                    <th style={{ textAlign: "right" }}>动作</th>
                  </tr>
                </thead>
                <tbody>
                  {model.weeklyTier1.map((task, index) => {
                    const [statusLabel, statusTone] = statusMeta(task.status);
                    return (
                      <tr key={`${task.cond}-${index}`}>
                        <td style={{ fontWeight: 600 }}>{text(task.cond)}</td>
                        <td><span className="bdg">{TASK_CATEGORY_LABELS[text(task.category, "explore")] ?? text(task.category)}</span></td>
                        <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{text(task.href)}</td>
                        <td className="num mono" style={{ fontWeight: 700 }}>{text(task.reward)}</td>
                        <td><span className={`bdg ${statusTone}`}>{statusLabel}</span></td>
                        <td style={{ fontSize: 11.5 }}>
                          <span style={{ color: "var(--ink-2)" }}>{COMPLETION_LABEL[text(task.completionType, "event")] ?? "业务事件"}</span>
                          {task.completionEvent ? <span className="mono" style={{ color: "var(--ink-4)", marginLeft: 4 }}>{text(task.completionEvent)}</span> : null}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button className="l-btn sm mc" onClick={() => openTaskReward(`mission.${text(task.completionEvent)}.reward`, text(task.cond), text(task.reward))} disabled={!canModuleWrite}>改奖励</button>
                          {" "}{missionLifecycleActions(task, text(task.cond))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="l-h" style={{ marginTop: 14, border: 0, paddingBottom: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>二档(完成池 · 每条独立派发)</span>
            </div>
            <div style={{ overflowX: "auto", marginTop: 6 }}>
              <table className="l-tbl" style={{ minWidth: 600 }}>
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>类别</th>
                    <th>去完成路径</th>
                    <th className="num">奖励 NEX</th>
                    <th>状态</th>
                    <th>完成判定</th>
                    <th style={{ textAlign: "right" }}>动作</th>
                  </tr>
                </thead>
                <tbody>
                  {model.weeklyTier2.map((task, index) => {
                    const [statusLabel, statusTone] = statusMeta(task.status);
                    return (
                      <tr key={`${task.cond}-${index}`}>
                        <td style={{ fontWeight: 600 }}>{text(task.cond)}</td>
                        <td><span className="bdg">{TASK_CATEGORY_LABELS[text(task.category, "explore")] ?? text(task.category)}</span></td>
                        <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{text(task.href)}</td>
                        <td className="num mono" style={{ fontWeight: 700 }}>{text(task.reward)}</td>
                        <td><span className={`bdg ${statusTone}`}>{statusLabel}</span></td>
                        <td style={{ fontSize: 11.5 }}>
                          <span style={{ color: "var(--ink-2)" }}>{COMPLETION_LABEL[text(task.completionType, "event")] ?? "业务事件"}</span>
                          {task.completionEvent ? <span className="mono" style={{ color: "var(--ink-4)", marginLeft: 4 }}>{text(task.completionEvent)}</span> : null}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button className="l-btn sm mc" onClick={() => openTaskReward(`mission.${text(task.completionEvent)}.reward`, text(task.cond), text(task.reward))} disabled={!canModuleWrite}>改奖励</button>
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
                <b>周冠军加奖</b> · {text(model.weeklyChampionBonus)} · 累计 NEX 最高的当周用户额外加奖
              </span>
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("weekly.champBonus", "周冠军加奖", text(model.weeklyChampionBonus), true)} disabled={!canModuleWrite}>调整</button>
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, margin: "12px 0 6px", color: "var(--ink-2)" }}>
              阶段倍率曲线(点档位调整)
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
          <span className="ttl">任务完成事件绑定</span>
          <span className="sub">· Java 规范事件 → 已启用 H3 任务；新增、改绑、启停和删除都保留理由、CAS 与服务端回读</span>
          <div className="r"><button className="l-btn sm mc" onClick={openCreateBinding} disabled={!canModuleWrite}>+ 新增绑定</button></div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 780 }}>
            <thead><tr><th>绑定编号</th><th>生产者</th><th>事件</th><th>目标任务</th><th>用户字段</th><th>状态</th><th>操作</th></tr></thead>
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
                    <button className="l-btn sm mc" onClick={() => openBindingEdit(binding)} disabled={!canModuleWrite}>改绑</button>{" "}
                    <button className="l-btn sm" onClick={() => openBindingStatus(binding)} disabled={!canModuleWrite}>{enabled ? "停用" : "启用"}</button>{" "}
                    <button className="l-btn sm" onClick={() => openBindingDelete(binding)} disabled={!canModuleWrite}>删除</button>
                  </td>
                </tr>;
              })}
              {(model.eventBindings ?? []).length === 0 ? <tr><td colSpan={7} className="sub">暂无绑定</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="l-card" data-proof="h3-event-contract">
        <div className="l-h">
          <span className="ttl">任务事件契约与归因(只读)</span>
          <span className="sub">· task_key / 服务端完成事件 / 下游业务事件 / B3 漏斗 / BI 口径</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1080 }}>
            <thead>
              <tr>
                <th>任务</th>
                <th>task_key</th>
                <th>服务端完成事件</th>
                <th>下游业务事件</th>
                <th>B3 漏斗</th>
                <th>仅留存</th>
                <th>Day7 贡献</th>
                <th>L 域 BI 表.字段</th>
                <th className="num">24h 样本</th>
                <th className="num">异常率</th>
              </tr>
            </thead>
            <tbody>
              {model.dayOneTasks.map((task, index) => {
                const contract = contractForTask(task, model.taskContracts, index);
                return (
                  <tr key={`${text(task.id, String(index))}-${text(contract.taskKey, String(index))}`}>
                    <td style={{ fontWeight: 600, color: "var(--ink)" }}>{text(task.task)}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{text(contract.taskKey)}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{text(contract.serverEvent)}</td>
                    <td className="mono" style={{ fontSize: 11, color: text(contract.downstream) === "-" ? "var(--ink-4)" : undefined }}>{text(contract.downstream)}</td>
                    <td>{boolValue(contract.b3) ? <span className="bdg ok">进 B3</span> : <span className="bdg dim">否</span>}</td>
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
            <b>契约 = 归因共同事实源</b> · task_key 串起任务配置、服务端完成事件、下游业务事件、B3 漏斗和 L 域 BI。
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">月度挑战(按账龄派发)</span>
          <span className="sub">· 每主题 3 个子目标全达成才可领 · 跨月清空重派</span>
          <div className="r">
            <button className="l-btn sm mc" onClick={() => openCreateMonthlyMission()} disabled={!canModuleWrite}>+ 新建月度挑战</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 680 }}>
            <thead>
              <tr>
                <th>主题</th>
                <th>账龄段</th>
                <th className="num">奖励 NEX</th>
                <th>子目标</th>
                <th>状态</th>
                <th style={{ textAlign: "right" }}>动作</th>
              </tr>
            </thead>
            <tbody>
              {model.monthlyMissions.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 24, color: "var(--ink-4)" }}>
                    当前没有月度挑战。可点击右上角“+ 新建月度挑战”，按用户账龄配置主题、子目标与奖励。
                  </td>
                </tr>
              )}
              {model.monthlyMissions.map((mission) => {
                const [statusLabel, statusTone] = statusMeta(mission.status);
                return (
                  <tr key={text(mission.id)}>
                    <td style={{ fontWeight: 600 }}>{text(mission.theme)}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{text(mission.age)}</td>
                    <td className="num mono" style={{ fontWeight: 700 }}>{text(mission.reward)}</td>
                    <td style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{text(mission.goals)}</td>
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
          <span className="ttl">阶段加成(只读)与完成监控</span>
          <span className="sub">· 全局任务加成归 H1 派发 · 这页只套用</span>
          <div className="r">
            <a href="/growth/phase" className="l-btn">去 H1 调整 →</a>
          </div>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          <div className="htint warn" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1 }}>
              <b>全局任务加成 H1 派发</b> · 当前阶段 {currentPhaseCode},当前全局任务倍率 {phaseMultiplier}x。要调去 H1。
            </span>
            <span className="v mono" style={{ fontWeight: 700 }}>{phaseMultiplier}x</span>
          </div>
          <div className="htint" style={{ marginTop: 8, fontSize: 12 }}>
            <b>两套倍率别混</b> · 上方“一档阶段倍率”是每周任务自己的曲线;“全局任务加成”是 H1 的节奏旋钮。
          </div>

          <div style={{ fontSize: 12, fontWeight: 600, margin: "12px 0 4px", color: "var(--ink-2)" }}>
            完成 / 领取监控(服务器台账)
          </div>
          {(model.taskMonitor ?? []).map((item) => (
            <div className="p-row" key={item.label}>
              <span className="k"><b>{item.label}:</b> {item.note}</span>
            </div>
          ))}
          <div className="htint dim" style={{ marginTop: 8, fontSize: 12 }}>
            <b>结算</b> · 重复领取不重复入账;过期 vs 领取按过期优先。
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">本周任务卡展示参数（首页）</span>
          <span className="sub">· 周任务优先、促销兜底 · 首页固定视觉槽位 · 单实例配置</span>
          <div className="r">
            <span className={`bdg ${text(promoBanner.status, "") === "active" ? "ok" : "dim"}`}>
              {text(promoBanner.status, "") === "active" ? "促销兜底已启用" : "促销兜底已暂停"}
            </span>
          </div>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          <div className="p-row">
            <span className="k">
              基础奖励 × 倍率 = 最终奖励
              <small>仅在没有活动周任务时计算促销兜底奖励。</small>
            </span>
            <span className="v">{text(promoBanner.baseReward)} × {text(promoBanner.multiplier)} = {promoFinalReward(promoBanner.baseReward, promoBanner.multiplier)} NEX</span>
            <button className="l-btn sm mc" onClick={() => openNumericConfig("promoBanner.baseReward", "转化卡基础奖励", text(promoBanner.baseReward), 0, 100000, 1, "increase")} disabled={!canModuleWrite}>改基础</button>
            <button className="l-btn sm mc" onClick={() => openNumericConfig("promoBanner.multiplier", "转化卡倍率", text(promoBanner.multiplier), 0.1, 5, 0.1, "increase")} disabled={!canModuleWrite}>改倍率</button>
          </div>
          <div className="p-row">
            <span className="k">倒计时窗口</span>
            <span className="v">{text(promoBanner.countdownDays)}d {text(promoBanner.countdownHours)}h</span>
            <button className="l-btn sm mc" onClick={() => openNumericConfig("promoBanner.countdownDays", "转化卡倒计时天数", text(promoBanner.countdownDays), 0, 365, 1)} disabled={!canModuleWrite}>改天数</button>
            <button className="l-btn sm mc" onClick={() => openNumericConfig("promoBanner.countdownHours", "转化卡倒计时小时", text(promoBanner.countdownHours), 0, 23, 1)} disabled={!canModuleWrite}>改小时</button>
          </div>
          <div className="p-row">
            <span className="k">目标设备 / 日产展示</span>
            <span className="v">{text(promoBanner.targetDevice)} · ${text(promoBanner.targetDaily)}/d</span>
            <button className="l-btn sm mc" onClick={() => openSimpleConfig("promoBanner.targetDevice", "转化卡目标设备", text(promoBanner.targetDevice), false)} disabled={!canModuleWrite}>改设备</button>
            <button className="l-btn sm mc" onClick={() => openNumericConfig("promoBanner.targetDaily", "转化卡日产展示", text(promoBanner.targetDaily), 0, 1000000, 0.01)} disabled={!canModuleWrite}>改日产</button>
          </div>
          <div className="p-row">
            <span className="k">促销兜底状态</span>
            <span className="v">{text(promoBanner.status, "") === "active" ? "已启用" : "已暂停"}</span>
            <button
              className="l-btn sm mc"
              onClick={openPromoStatus}
              disabled={!canModuleWrite}
            >
              {text(promoBanner.status, "") === "active" ? "暂停兜底" : "启用兜底"}
            </button>
          </div>
          <div className="htint" style={{ marginTop: 10, fontSize: 12 }}>
            <b>数据归属</b> · 周任务名称和奖励来自活动任务，任务倍率来自 H1；倒计时、目标设备和日产展示来自本区配置。
            暂停只禁止“没有活动周任务时跳商店”的促销兜底，不影响活动周任务及其展示参数；升奖励 / 倍率走 B1 红线。
          </div>
        </div>
      </section>
        </>
      )}

      {section === "events" && (
        <>
      <div className="two-col">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">活动列表(玩法闭集 8 种 · 当前 {model.events.length} 条)</span>
            <span className="sub">· 主推位同时只能有一个 · 陈旧页面提交会被拒绝</span>
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
                {model.events.map((event) => {
                  const [label, tone] = stateTone.get(event.state) ?? EVENT_LABEL[event.state] ?? [event.state, "dim"];
                  const ended = event.state === "ended";
                  const wheelEvent = text(event.kind).toLowerCase() === "wheel";
                  return (
                    <tr key={event.id}>
                      <td style={{ fontWeight: 600, color: "var(--ink)" }}>{event.name}</td>
                      <td><span className="bdg dim">{text(event.kind)}</span></td>
                      <td><span className={`bdg ${tone}`}>{label}</span></td>
                      <td className="num mono">{text(event.reward)}</td>
                      <td>{event.featured ? <span className="bdg warn">主推</span> : <span style={{ color: "var(--ink-4)" }}>-</span>}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {wheelEvent ? (
                          <span className="bdg dim" title="转盘实际奖励由下方奖池档位统一管理" style={{ marginRight: 6 }}>
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
                        {event.state === "ongoing" && (
                          <button className="l-btn sm mc" onClick={() => openEventFeatured(event)} disabled={!canModuleWrite}>
                            {event.featured ? "取消主推" : "设主推"}
                          </button>
                        )}
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
                  <span className={`st ${state.tone}`}>{state.state} {state.label}</span>
                  {index < states.length - 1 && <span className="ar">→</span>}
                </span>
              ))}
              <span className="ar" style={{ marginLeft: 10 }}>参与:</span>
              <span className="st">joined</span>
              <span className="ar">→</span>
              <span className="st warn">done 达标</span>
              <span className="ar">→</span>
              <span className="st ok">claimed 已领</span>
            </div>
            <div className="htint" style={{ marginTop: 8, fontSize: 12 }}>
              <b>可追踪活动</b> · 进度按真实状态判定,状态在各业务域维护,这里做统一展示。
            </div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">抽奖转盘治理</span>
            <span className="sub">· 一个转盘一张奖池表(日免费 + 签到满 30 天加抽票共用)</span>
            <div className="r">
              <button className="l-btn mc" onClick={openWheelProbabilities} disabled={!canWheelWrite}>
                改奖池 / 概率
              </button>
              <button className="l-btn sm mc" onClick={() => openCreateWheelTier()} disabled={!canWheelWrite}>+ 新建档位</button>
              <button className="l-btn sm mc" onClick={() => openCreateWheelGuard()} disabled={!canWheelWrite}>+ 新建护栏</button>
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="wheel-row" style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-4)" }}>
              <span>档位</span>
              <span>奖项</span>
              <span>概率</span>
              <span>性质</span>
              <span />
            </div>
            {(model.wheelTiers ?? []).map((tier) => {
              const real = boolValue(tier.real);
              return (
                <div className="wheel-row" key={text(tier.tier)}>
                  <span style={{ fontWeight: 600, color: "var(--ink)" }}>{text(tier.tier)}</span>
                  <span className="mono">{text(tier.reward)}</span>
                  <span className="mono" style={{ fontWeight: 700 }}>{percentText(tier.prob)}%</span>
                  <span>{real ? <span className="bdg bad">真实流出</span> : <span className="bdg dim">{text(tier.kind)}</span>}</span>
                  <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button className="l-btn sm mc" onClick={() => openEditWheelTier(tier)} disabled={!canWheelWrite}>编辑</button>
                    <button className="l-btn sm" onClick={() => openDeleteWheelTier(tier)} disabled={numericValue(tier.prob) !== 0 || !canWheelWrite} title={numericValue(tier.prob) === 0 ? "删除档位" : "先将概率调为 0%"}>删除</button>
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
                    <b>{guard.label}</b> {guard.value}
                    {guard.note && (
                      <>
                        <br />
                        <span style={{ color: "var(--ink-4)" }}>{guard.note}</span>
                      </>
                    )}
                  </span>
                  {guard.key === "cap" ? (
                    <span className="bdg dim" title="真实上限由每个奖池档位的 dailyStock 执行">
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
              <b>当前 EV ≈ ${text(model.wheelEvUsd)} / spin</b> · 真实流出期望由现金档贡献,奖池变更后重新计算。
            </div>
            <div className="htint ok" style={{ marginTop: 8, fontSize: 12 }}>
              <b>第四道护栏(自动)</b> · 抽奖前查覆盖率,跌破 100% 真钱档暂停、只发 NEX/券,回升自动恢复。
            </div>
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">Trackable 可追踪活动监控</span>
          <span className="sub">· 只读 · 各域状态消费(E 设备 / F 团队 / G 金融)</span>
          <div className="r">
            <span className="bdg dim">参与 → 达标 → 领取漏斗</span>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 880 }}>
            <thead>
              <tr>
                <th>活动</th>
                <th>判定条件(只读消费各域)</th>
                <th className="num">参与</th>
                <th className="num">达标</th>
                <th className="num">已领</th>
                <th>地域</th>
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
            <b>并发与时窗</b> · 活动结束/下架和领取赛跑时结束优先;一次性活动按「活动 × 用户」防重,日重置转盘按「活动 × 用户 × 日」防重。
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
                reason: "首日任务为小型配置清单,需要同屏核对奖励",
              },
              {
                label: "周任务",
                maxRows: model.weeklyTier1.length + model.weeklyTier2.length,
                reason: "周任务需要同屏核对两档奖励",
              },
              {
                label: "月度任务",
                maxRows: model.monthlyMissions.length,
                reason: "月度主题数量固定较少,同屏核对奖励更高效",
              },
            ]
          : [
              {
                label: "活动列表",
                maxRows: model.events.length,
                reason: "活动状态和主推关系需要同屏校验",
              },
              {
                label: "可追踪活动",
                maxRows: model.trackables?.length ?? 0,
                reason: "可追踪活动监控为小型只读清单",
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
