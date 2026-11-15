"use client";

/** H3 requests, approval routing and recovery use the existing redesigned markup.
 * The legacy H3/H4 component stays intact for its remaining callers. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeftRight, Archive, CalendarClock, CircleAlert, CircleCheck, CircleSlash, Gift, History, Link2, ListChecks, Megaphone, Pause, Pencil, Play, Plus, RefreshCw,
  Route, Sparkles, Trash2, Trophy,
} from "lucide-react";
import {
  BlockState, Button, Cell, Change, Conclusion, ConfigList, ConfigRow, Decision, Drawer, Explain, Fact, Facts, Fold, IrreversibleTag,
  JudgmentPoints, MoreMenu, Notice, PageHeader, PageTabs, Panel, ReleaseModal, Stat, StatBand, StatusTag, Table, Td, Th, Tr, useTabIds, type MoreMenuItem,
} from "@/app/components/rd";
import { OperationConfirmModal, PaginationExemptionList } from "../design-kit";
import {
  fetchH3QuestEvents,
  type H3MissionKind,
  type H3QuestEventBinding,
} from "@/lib/admin/h-client";
import { compareH3Decimal, h3Decimal, parseH3Model } from "@/lib/admin/h3-contract";
import { useH3Mutations, type H3PendingCommand, type H3Write } from "@/lib/admin/use-h3-mutations";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { useHConflictDraft } from "@/lib/admin/use-h-conflict-draft";
import { isHGrowthReadConflict } from "@/lib/admin/h-write-conflict";
import { HApprovalRequired } from "@/lib/admin/h-approval-required";
import { businessClock, businessZone } from "@/lib/admin/business-time";
import { useReach } from "@/lib/nav/use-reach";
import type { ActionConfirmReq, ConfirmReq, HCtx } from "./types";
import {
  AppPreview, DayOneTimeline, H3RecoveryList, PhaseStrip, TaskCard, TaskStatusTag, WeeklyFormula,
  H3_BINDING_EVENT_LABELS, H3_BINDING_EVENT_OPTIONS, H3_BINDING_EVENT_PRODUCERS, H3_BINDING_USER_FIELDS, H3_BINDING_USER_FIELD_LABELS,
  TASK_ACTION_ROUTES, TASK_ACTION_ROUTE_LABELS, TASK_CATEGORY_LABELS, TASK_CATEGORY_OPTIONS,
  activeUnbound, amountText, bindingEventText, boolValue, casExpected, cleanPhaseKey, contractForTask, decimalOf, legacyAssetText, mulDecimal,
  acknowledgedTag, expiredTag, numericValue, parseTriReward, pendingTag, producerText, sumDecimal, taskStatusOf, taskTitleText, taskUnbound, text, unknownTag,
  type FormulaRow, type H3Model, type H3RecoveryRow, type PreviewTask, type QuestTask,
} from "./h3-quest-parts";
import { H3RegionPanel, REGION_APPROVER, useH3RegionPolicy } from "./h3-region-policy";
import { hApprovalReconfirm } from "./h-approval-reconfirm";
import { H3MissionFormDrawer, type H3MissionForm } from "./h3-mission-form";

type H3ActionConfirmReq = ActionConfirmReq & { target?: string; confirmLabelForValue?: (value?: string) => string };
type Tab = "dayOne" | "weekly" | "bindings" | "monthly" | "promo";
type ListKey = "dayOne" | "t1" | "t2";
type Locale = "en" | "zh" | "vi";

const LOCALE_LABEL: Record<Locale, string> = { en: "英文", zh: "中文", vi: "越南语" };
const FUND_APPROVER = "另一位超级管理员";
const TYPE_LABEL: Record<string, string> = { DAY_ONE: "首日任务", WEEKLY_T1: "每周一档", WEEKLY_T2: "每周二档", DAILY: "每日任务（签到页管理）", MONTHLY: "月度挑战" };

function directionOf(current: string | null, next: string | null): "up" | "down" | "same" | null {
  if (current == null || next == null) return null;
  const a = h3Decimal(current), b = h3Decimal(next);
  if (a === null || b === null) return null;
  const direction = compareH3Decimal(b, a);
  return direction > 0 ? "up" : direction < 0 ? "down" : "same";
}

/** 调高要审批、调低立即生效的参数：生效标签、事实行和按钮字照 G2、G7。 */
function directionEffect(subject: string) {
  return <StatusTag tone="neutral" icon={ArrowLeftRight} explain={<>
    <p>调高是放大：提交审批，{FUND_APPROVER}在「操作记录与审批」批准后才生效，你自己不能批；批准前什么都不变。</p>
    <p>调低确认后立即生效。两种都只影响之后的{subject}，已经发给用户的那一份不变。</p>
  </>}>调高要批准 · 调低立即生效</StatusTag>;
}
function whenFact(direction: "up" | "down" | "same" | null, first = false) {
  if (first || direction === "up") return <Fact k="什么时候生效" tone="warn">{`${first ? "第一次设置" : "调高"}：提交审批，${FUND_APPROVER}批准后才生效；批准前什么都不变，这一项被锁住`}</Fact>;
  if (direction === "down") return <Fact k="什么时候生效">调低：确认后立即生效</Fact>;
  if (direction === "same") return <Fact k="什么时候生效">和现在一样，没有改动</Fact>;
  return <Fact k="什么时候生效">调高要批准；调低确认后立即生效</Fact>;
}
function approverFacts(show: boolean) {
  return show ? <>
    <Fact k="谁来批">{`${FUND_APPROVER}，不能是提交人`}</Fact>
    <Fact k="需有权限">审批批准权限</Fact>
  </> : null;
}
const immediate = <StatusTag tone="progress" filled>立即生效</StatusTag>;

export function H3QuestTasks({ ctx: shellCtx }: { ctx: HCtx }) {
  const [mc, setMc] = useState<H3ActionConfirmReq | null>(null);
  // 保存被「别人先改过」拒绝：页面已重读，这里留住这次要改的内容，让运营和现值对照。
  const [stale, setStale] = useState<{ title: string; before: string; after: string } | null>(null);
  const [releasing, setReleasing] = useState<H3PendingCommand | null>(null);
  const toast = shellCtx.toast;
  const canModuleWrite = shellCtx.can("growth_h3_write");
  const fresh = useRef(false);
  const confirmation = useRef<{ action: string; title: string; target?: string; editValue?: string; businessValue?: Record<string, string>; commandKey?: string } | null>(null);
  const openActionConfirm = (req: H3ActionConfirmReq | null) => {
    if (!req) { setMc(null); return; }
    if (!fresh.current || req.target && mutations.blocked(req.target)) {
      toast("请先查询原结果并成功刷新用户任务数据，再发起新的修改。");
      return;
    }
    req = conflictDraft.action(req, () => !!confirmation.current?.commandKey);
    const attempt = { action: String(req.action), title: String(req.title ?? req.action), target: req.target } as NonNullable<typeof confirmation.current>;
    confirmation.current = attempt;
    setMc({ ...req, getPendingReason: () => attempt.target ? mutations.record(attempt.target)?.change.reason : undefined,
      getPendingBusinessValue: () => (attempt.target ? mutations.record(attempt.target)?.change.businessValue : undefined) ?? req.getPendingBusinessValue?.(),
      run: async (reason, value, businessValue) => {
        attempt.editValue = value; attempt.businessValue = businessValue;
        confirmation.current = attempt;
        await req.run(reason, value, businessValue);
      },
    });
  };
  const openConfirm = (req: ConfirmReq & { target?: string }) => {
    if (!fresh.current || req.target && mutations.blocked(req.target)) {
      toast("请先查询原结果并成功刷新用户任务数据，再发起新的修改。");
      return;
    }
    req = { ...req, ...conflictDraft.confirm(req, () => !!confirmation.current?.commandKey) };
    const attempt = { action: String(req.action), title: String(req.title ?? req.action), target: req.target } as NonNullable<typeof confirmation.current>;
    confirmation.current = attempt;
    shellCtx.openConfirm({ ...req, freezePendingInput: true,
      getPendingReason: () => attempt.target ? mutations.record(attempt.target)?.change.reason : undefined,
      getPendingBlockReason: () => {
        const saved = attempt.target ? mutations.record(attempt.target) : undefined;
        return saved && !mutations.canRetry(saved) ? isRetryExpired(saved) ? RETRY_EXPIRED_TEXT : "请查询原结果" : undefined;
      },
      run: async (reason) => { confirmation.current = attempt; await req.run(reason); },
    });
  };
  const ctx: HCtx = { ...shellCtx, openActionConfirm, openConfirm };
  const reach = useReach();
  const canAudit = reach("/platform/audit");
  const canPhase = reach("/growth/phase");
  const [model, setModel] = useState<H3Model | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const conflictDraft = useHConflictDraft(!loading && !error && fresh.current);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("dayOne");
  const [detail, setDetail] = useState<{ list: ListKey; code: string } | null>(null);
  const [creating, setCreating] = useState<"DAY_ONE" | "WEEKLY_T1" | "WEEKLY_T2" | null>(null);
  const tabIds = useTabIds();


  const reload = async () => {
    fresh.current = false;
    setLoading(true);
    try {
      setModel(parseH3Model(await fetchH3QuestEvents("tasks")));
      fresh.current = true;
      setError(null);
      setReadAt(Date.now());
    } catch (err) {
      setError(displayAdminReadError(err));
    } finally {
      setLoading(false);
    }
  };

  const mutations = useH3Mutations(toast, async () => {
    fresh.current = false;
    setMc(null);
    setCreating(null);
    shellCtx.closeConfirm?.();
    await reload();
    await region.reload();
  }, () => fresh.current);
  const refresh = async () => {
    setMc(null); shellCtx.closeConfirm?.();
    await reload();
    await region.reload();
    const results = await mutations.refreshTickets();
    for (const result of results) if (result.status === "rejected") toast(displayAdminError(result.reason));
  };
  useEffect(() => { void refresh().catch(cause => toast(displayAdminError(cause))); }, []);

  const runWrite = async (write: Omit<H3Write, "change"> & { target: string; before: string; after: string; success: string }, reason: string) => {
    const attempt = confirmation.current;
    if (!attempt) throw new Error("请重新打开原操作。");
    if (!attempt.commandKey && mutations.blocked(write.target)) throw new Error("这一项有未结束的原操作，请先查询原结果。");
    attempt.target = write.target;
    if (attempt.commandKey) {
      const original = mutations.record(write.target);
      if (!original || original.commandKey !== attempt.commandKey) throw new Error("原操作已处理，请刷新后重新操作。");
      await mutations.retry(original);
      return;
    }
    try {
      await mutations.run({ ...write, change: { target: write.target, action: attempt.action, title: attempt.title,
        before: write.before, after: write.after, success: write.success, editValue: attempt.editValue, businessValue: attempt.businessValue } }, reason);
      setStale(null);
    } catch (error) {
      if (isHGrowthReadConflict(error)) {
        setStale({ title: attempt.action, before: write.before, after: write.after });
        if (write.store === "region" && !attempt.commandKey) await region.reload(true);
      }
      throw error;
    } finally {
      attempt.commandKey = mutations.record(write.target)?.commandKey;
    }
  };
  const region = useH3RegionPolicy(ctx, async (params, reason, before, after) => {
    await runWrite({ store: "region", path: "", method: "POST", body: {}, target: "growth.h3.weekly-region-policy",
      before, after, regionParams: params, success: "已提交审批" }, reason);
  }, () => ({ blocked: mutations.blocked("growth.h3.weekly-region-policy"), pending: mutations.pendingApprovals.some(t => t.obj === "growth.h3.weekly-region-policy" && t.status === "pending") }));

  region.submit = conflictDraft.register("weekly-region", region.submit);

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
      return [{ missionCode, label: `${text(model?.contentLocales?.mission?.[missionCode]?.zh?.name, "") || taskTitleText(text(task.task ?? task.cond, missionCode))}${status === "paused" ? " · 已停用" : ""}` }];
    });
  }, [model?.dayOneTasks, model?.weeklyTier1, model?.weeklyTier2, model?.contentLocales]);

  const bindingMissionLabels = useMemo(
    () => Object.fromEntries(bindingMissionOptions.map((item) => [item.missionCode, item.label])),
    [bindingMissionOptions],
  );

  const updateConfigWithExpected = async (key: string, value: string, expectedValue: string, reason: string, label: string) => {
    await runWrite({ store: "config", path: `/quest-events/config/${encodeURIComponent(key)}`, method: "PATCH",
      body: { key, value, expectedValue }, target: key, configKey: key,
      before: expectedValue === "__MISSING__" ? "—" : expectedValue, after: value, success: `${label} 已更新` }, reason);
  };

  /** Keep the established confirmation fields; transport owns the approval route. */
  type Look = Pick<H3ActionConfirmReq, "title" | "effect" | "facts" | "statedBrief" | "confirmLabel" | "confirmLabelForValue" | "coverageLead" | "coverageCheck"> & { hint?: ReactNode; preview?: (value: string) => ReactNode; detail?: ReactNode; displayCurrent?: string; unit?: string };

  const openSimpleConfig = (key: string, label: string, current: string, amplifies = false, look: Look = {}, detail?: ReactNode) => {
    const { hint, preview, ...shown } = look;
    openActionConfirm({ target: key, briefKind: "config",
      action: label,
      detail: detail ?? <>当前值 <b>{current}</b>。</>,
      ...shown,
      amplifies,
      edit: { kind: "text", current, hint, preview },
      run: async (reason, value) => {
        if (!value) return;
        await updateConfigWithExpected(key, value, casExpected(current), reason, label);
      },
    } as H3ActionConfirmReq);
  };

  const openTaskReward = (key: string, label: string, current: string, look: Look = {}) => {
    const { hint, preview, displayCurrent, unit, ...shown } = look;
    openActionConfirm({ target: key, briefKind: "config",
      action: `调整奖励 · ${label}`,
      detail: <>当前奖励 <b>{current}</b>。</>,
      ...shown,
      edit: {
        kind: "number",
        current: decimalOf(current) ?? "",
        ...(key.startsWith("monthly.") ? { displayCurrent, unit } : {}),
        min: 0,
        max: 100000,
        step: key.startsWith("monthly.") ? 0.000001 : 1,
        disallowCurrent: true,
        amplifiesWhen: "increase",
        hint,
        preview,
      },
      run: async (reason, value) => {
        if (!value) return;
        await updateConfigWithExpected(key, value, decimalOf(current) ?? "__MISSING__", reason, `奖励 ${label}`);
      },
    } as H3ActionConfirmReq);
  };

  const openNumericConfig = (
    key: string,
    label: string,
    current: string,
    min: number,
    max: number,
    step: number,
    amplifiesWhen?: "increase" | "decrease",
    look: Look = {},
  ) => {
    const expected = decimalOf(current) ?? "__MISSING__";
    const { hint, preview, ...shown } = look;
    openActionConfirm({ target: key, briefKind: "config",
      action: label,
      detail: <>当前值 <b>{current}</b>。如果别人刚改过，需要刷新后再改。</>,
      ...shown,
      edit: { kind: "number", current: expected === "__MISSING__" ? "" : expected, min, max,
        step: key === "promoBanner.multiplier" ? 0.000001 : key === "promoBanner.targetDaily" ? undefined : step,
        inputStep: key === "promoBanner.multiplier" || key === "promoBanner.targetDaily" ? step : undefined,
        disallowCurrent: true, amplifiesWhen, hint, preview },
      run: async (reason, value) => {
        if (!value) return;
        await updateConfigWithExpected(key, value, expected, reason, label);
      },
    } as H3ActionConfirmReq);
  };

  const openPromoStatus = () => {
    const current = text(model?.promoBanner?.status, "").toLowerCase();
    if (!current) { toast(displayAdminError(new Error("PROMO_BANNER_NOT_CONFIGURED"))); return; }
    const next = conflictDraft.intent ?? (current === "active" ? "paused" : "active");
    if (next === current) { if (conflictDraft.intent !== undefined) setStale(null); toast(conflictDraft.intent !== undefined ? "别人已经改成这个状态，不用再提交" : "和现在一样，没有改动"); return; }
    openActionConfirm({ rebaseValue: next, target: "promoBanner.status", briefKind: "record",
      action: next === "active" ? "启用首页备用促销卡" : "暂停首页备用促销卡",
      title: next === "active" ? "启用首页备用促销卡" : "暂停首页备用促销卡",
      detail: <>只改备用促销卡的状态，不影响每周任务卡。App 目前不显示备用卡。</>,
      effect: next === "active"
        ? <StatusTag tone="progress" filled explain={`${FUND_APPROVER}在「操作记录与审批」批准后才启用；批准前什么都不变。`}>批准后生效</StatusTag>
        : immediate,
      facts: <Facts>
        <Fact k="状态"><Change from={current === "active" ? "已启用" : "已暂停"} to={next === "active" ? "已启用" : "已暂停"} /></Fact>
        <Fact k="App 上">目前不显示，也没有领取</Fact>
        <Fact k="每周任务卡">不受影响</Fact>
        {approverFacts(next === "active")}
      </Facts>,
      statedBrief: { impact: "只改备用促销卡的状态；不停周任务卡，也不发钱。", check: "确认是要改备用卡；理由写清依据。" },
      confirmLabel: next === "active" ? "提交审批" : "确认暂停",
      coverageLead: "启用备用卡是放大方向，要另一位超级管理员批准",
      amplifies: next === "active",
      run: async (reason) => {
        await updateConfigWithExpected("promoBanner.status", next, current, reason, "首页备用促销卡状态");
      },
    } as H3ActionConfirmReq);
  };

  const runCreateMission = (missionType: "DAY_ONE" | "WEEKLY_T1" | "WEEKLY_T2", subject: string, bv: H3MissionForm) => {
    const reward = /^\d+$/.test(bv.rewardPoints?.trim() ?? "") ? bv.rewardPoints.trim() : null;
    const approval = Number(bv.rewardPoints) > 0;
    openActionConfirm({ briefKind: "config",
      action: `新建任务 · ${subject}`,
      title: `新建${subject}`,
      detail: <>新建一条{subject}，建好后先是已停用。要先在「完成条件」里绑定用户做了什么算完成，再启用。</>,
      effect: approval
        ? <StatusTag tone="progress" filled explain={`奖励大于 0：${FUND_APPROVER}批准后才建；批准前任务不存在。`}>批准后生效</StatusTag>
        : immediate,
      facts: <Facts>
        <Fact k="任务名称">{String(bv.missionName ?? "").trim()}</Fact>
        <Fact k="任务编号"><span data-mono="">{String(bv.missionCode ?? "").trim()}</span></Fact>
        <Fact k="奖励">{reward == null ? "—" : `${amountText(reward)} UVT${missionType === "DAY_ONE" ? "（首日任务按首日奖励统一发）" : ""}`}</Fact>
        <Fact k="类别和跳转">{`${TASK_CATEGORY_LABELS[bv.category] ?? bv.category} · ${TASK_ACTION_ROUTE_LABELS[bv.actionRoute] ?? bv.actionRoute}`}</Fact>
        <Fact k="建好后">已停用；绑定完成条件、启用以后用户才看得到</Fact>
        {approval ? <Fact k="什么时候生效" tone="warn">奖励大于 0：提交审批，批准后才建好</Fact> : <Fact k="什么时候生效">奖励是 0：确认后直接建好</Fact>}
        {approverFacts(approval)}
      </Facts>,
      statedBrief: { impact: "只在目录里加一条已停用的任务；不自动绑定、不启用、不发钱。", check: "核对编号（建好后不能改）、名称和奖励；理由写清依据。" },
      confirmLabel: approval ? "提交审批" : "确认新建",
      coverageLead: "新建带奖励的任务是放大方向，要另一位超级管理员批准",
      amplifies: true,
      run: async (reason) => {
        if (!bv) return;
        const missionCode = String(bv.missionCode || "").trim();
        const missionName = String(bv.missionName || "").trim();
        if (!missionCode || !missionName) return;
        await runWrite({ store: "mission", path: "/quest-events/missions", method: "POST", target: missionCode,
          body: { missionCode, missionName, missionType, rewardPoints: Number(bv.rewardPoints), category: bv.category.trim(), actionRoute: bv.actionRoute.trim() },
          before: "任务不存在", after: `${missionName} · ${bv.rewardPoints} UVT · 已停用`,
          success: `任务「${missionName}」已新建（停用中，绑定完成条件后再启用）` }, reason);
        setCreating(null);
      },
    } as H3ActionConfirmReq);
  };

  const localizedValue = (code: string, locale: Locale) => text(model?.contentLocales?.mission?.[code]?.[locale]?.name, "");

  const openLocalizedContent = (code: string, locale: Locale, source: string) => {
    const current = localizedValue(code, locale);
    openActionConfirm({ target: `content.mission.${code}.name.${locale}`, briefKind: "config",
      action: `编辑 ${locale.toUpperCase()} 内容 · ${source}`,
      title: `${current ? "改" : "填写"}${LOCALE_LABEL[locale]}名称`,
      detail: <>没填时 App 先显示英文，再显示原名。</>,
      effect: immediate,
      facts: <Facts>
        <Fact k="任务">{taskTitleText(source)}</Fact>
        <Fact k="语言">{LOCALE_LABEL[locale]}</Fact>
        <Fact k="已经发给用户的">不变，按拿到时定下的那一份</Fact>
        <Fact k="之后的用户">之后注册的用户、之后发布的每周任务用新名称</Fact>
      </Facts>,
      statedBrief: { impact: "只改这个任务这一种语言的名称，其他语言不动；已填的不能清空。", check: "核对语言和拼写；理由写清依据。" },
      confirmLabel: "确认修改",
      edit: { kind: "text", current, hint: "最多 512 字" },
      run: async (reason, value) => {
        if (!value) return;
        await updateConfigWithExpected(`content.mission.${code}.name.${locale}`, value, casExpected(current), reason, `${source} ${locale.toUpperCase()} 文案`);
      },
    } as H3ActionConfirmReq);
  };

  const taskIdentity = (task: QuestTask, monthly = false) => ({
    taskCode: text(task.taskCode ?? task.missionCode ?? task.id),
    taskKind: (text(task.taskKind, monthly ? "MONTHLY" : "MISSION") === "MONTHLY" ? "MONTHLY" : "MISSION") as H3MissionKind,
    status: text(task.status, "paused") as "active" | "paused" | "archived",
  });

  const whoFacts = (monthly: boolean, change: string) => monthly
    ? <Fact k="用户">App 现在没有月度入口，改了不会发给任何人</Fact>
    : <>
      <Fact k="已经发给用户的">不变，按拿到时定下的那一份</Fact>
      <Fact k="之后的用户">{change}</Fact>
    </>;

  const openMissionEdit = (task: QuestTask, label: string, monthly = false) => {
    const { taskCode, taskKind, status } = taskIdentity(task, monthly);
    if (status === "archived") return;
    openActionConfirm({ target: taskCode, briefKind: "config",
      action: `编辑任务 · ${label}`,
      title: monthly ? "改月度挑战名称" : "改任务原名",
      detail: <>只改名称；奖励单独改。</>,
      effect: immediate,
      facts: <Facts>
        <Fact k="改的是">{monthly ? "主题名称" : "原名：没填某种语言名称时 App 显示它"}</Fact>
        {whoFacts(monthly, "之后注册的用户、之后发布的每周任务用新名称")}
      </Facts>,
      statedBrief: { impact: monthly ? "只改历史月度挑战的主题名称。" : "只改原名；英文、中文、越南语名称在任务详情里分别改。", check: "核对新名称；理由写清依据。" },
      confirmLabel: "确认修改",
      edit: { kind: "text", current: label, disallowCurrent: true, hint: "最多 128 字" },
      run: async (reason, value) => {
        if (!value) return;
        await runWrite({ store: "mission", path: `/quest-events/tasks/${encodeURIComponent(taskCode)}`, method: "PATCH", target: taskCode,
          body: { taskKind, name: value, expectedName: label }, before: label, after: value, success: `任务「${label}」已编辑` }, reason);
      },
    } as H3ActionConfirmReq);
  };

  const openMissionPresentation = (task: QuestTask, label: string) => {
    const { taskCode, status } = taskIdentity(task);
    if (status === "archived") return;
    const currentCategory = text(task.category, "explore").toLowerCase();
    const currentActionRoute = text(task.href, "/pages/missions/missions");
    openActionConfirm({ target: taskCode, briefKind: "config",
      action: `配置任务类别与去完成页面 · ${label}`,
      title: "改类别和跳转",
      detail: <>App 上显示的类别和「去完成」跳到哪页。</>,
      effect: immediate,
      facts: <Facts>
        <Fact k="任务">{taskTitleText(label)}</Fact>
        {whoFacts(false, "之后注册、之后发布的任务按新的显示")}
      </Facts>,
      statedBrief: { impact: "只改类别和跳转页面；不改奖励和完成条件。", check: "核对跳转页面能完成这个任务；理由写清依据。" },
      confirmLabel: "确认修改",
      businessForm: {
        kind: "multi-field",
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
            options: TASK_ACTION_ROUTES.includes(currentActionRoute)
              ? TASK_ACTION_ROUTES : [currentActionRoute, ...TASK_ACTION_ROUTES],
            optionLabels: TASK_ACTION_ROUTE_LABELS,
            required: true,
            showDiff: true,
          },
        ],
      },
      run: async (reason, _value, businessValue) => {
        if (!businessValue) return;
        await runWrite({ store: "mission", path: `/quest-events/tasks/${encodeURIComponent(taskCode)}/presentation`, method: "PATCH", target: taskCode,
          body: { category: String(businessValue.category).trim(), actionRoute: String(businessValue.actionRoute).trim(), expectedCategory: currentCategory, expectedActionRoute: currentActionRoute },
          before: `${currentCategory} · ${currentActionRoute}`, after: `${businessValue.category} · ${businessValue.actionRoute}`, success: `任务「${label}」的类别与去完成页面已更新` }, reason);
      },
    } as H3ActionConfirmReq);
  };

  const openMissionStatus = (task: QuestTask, label: string, monthly = false) => {
    const { taskCode, taskKind, status } = taskIdentity(task, monthly);
    if (status === "archived") return;
    const targetStatus = conflictDraft.intent ?? (status === "active" ? "paused" : "active");
    if (targetStatus === status) { if (conflictDraft.intent !== undefined) setStale(null); toast(conflictDraft.intent !== undefined ? "别人已经改成这个状态，不用再提交" : "和现在一样，没有改动"); return; }
    const enabling = targetStatus === "active";
    openConfirm({ rebaseValue: targetStatus, briefKind: "config",
      target: taskCode,
      action: `${targetStatus === "active" ? "启用" : "停用"}任务 · ${label}`,
      title: `${enabling ? "启用" : "停用"}${monthly ? "月度挑战" : "任务"}`,
      detail: <>只能在启用和停用之间切换；已归档的不能恢复。</>,
      effect: immediate,
      content: <Facts>
        <Fact k={monthly ? "月度挑战" : "任务"}>{taskTitleText(label)}</Fact>
        <Fact k="状态"><Change from={status === "active" ? "已启用" : "已停用"} to={enabling ? "已启用" : "已停用"} /></Fact>
        {monthly
          ? <Fact k="用户">只维护历史状态：App 没有月度入口</Fact>
          : <>
            <Fact k="已领到的用户">不受影响，照旧能完成和领取</Fact>
            <Fact k="以后的用户">{enabling ? "之后的用户会拿到它" : "之后的用户拿不到它"}</Fact>
            {enabling && <Fact k="前提" tone={taskUnbound(task) ? "warn" : undefined}>{taskUnbound(task) ? "没有启用的完成条件，会被拒绝，先去绑定" : "要有启用的完成条件；目标业务不可用时也会被拒绝"}</Fact>}
          </>}
      </Facts>,
      statedBrief: { impact: enabling ? "启用后之后的用户会拿到这个任务。" : "停用后之后的用户拿不到这个任务；已经拿到的照旧。", check: "核对任务和完成条件；理由写清依据。" },
      reason: true,
      reasonPlaceholder: "例如：工单号、调整依据",
      okLabel: targetStatus === "active" ? "确认启用" : "确认停用",
      run: async (reason) => {
        await runWrite({ store: "mission", path: `/quest-events/tasks/${encodeURIComponent(taskCode)}/status`, method: "PATCH", target: taskCode,
          body: { taskKind, targetStatus, expectedStatus: status }, before: status, after: targetStatus, success: `任务「${label}」已${targetStatus === "active" ? "启用" : "停用"}` }, reason);
      },
    });
  };

  const openMissionArchive = (task: QuestTask, label: string, monthly = false) => {
    const { taskCode, taskKind, status } = taskIdentity(task, monthly);
    if (status === "archived") return;
    openConfirm({ briefKind: "record",
      target: taskCode,
      action: `归档任务 · ${label}`,
      title: monthly ? "归档月度挑战" : "归档任务",
      detail: <>归档后不能再启用；名称、类别和文字不能改，奖励仍可维护。要删除，先归档。</>,
      effect: <>{immediate}<IrreversibleTag /></>,
      confirmTone: "danger",
      content: <Facts>
        <Fact k={monthly ? "月度挑战" : "任务"}>{taskTitleText(label)}</Fact>
        <Fact k="状态"><Change from={status === "active" ? "已启用" : "已停用"} to="已归档" tone="danger" /></Fact>
        {!monthly && <Fact k="已领到的用户">照旧能完成和领取</Fact>}
        <Fact k="以后的用户">{monthly ? "App 没有月度入口，不涉及" : "不会再拿到这个任务"}</Fact>
        <Fact k="归档后还能改">只有奖励；名称、类别、跳转、三语名称都不能改</Fact>
        <Fact k="和删除的区别">归档后才能删除；只想暂时不发用「停用」</Fact>
      </Facts>,
      statedBrief: { impact: "归档是终态，不能恢复成启用或停用。", check: "确认不再需要这个任务；理由写清依据。" },
      reason: true,
      reasonPlaceholder: "例如：工单号、调整依据",
      okLabel: "确认归档",
      run: async (reason) => {
        await runWrite({ store: "mission", path: `/quest-events/tasks/${encodeURIComponent(taskCode)}/archive`, method: "POST", target: taskCode,
          body: { taskKind, targetStatus: "archived", expectedStatus: status }, before: status, after: "archived", success: `任务「${label}」已归档` }, reason);
      },
    });
  };

  const openMissionDelete = (task: QuestTask, label: string, monthly = false) => {
    const { taskCode, taskKind, status } = taskIdentity(task, monthly);
    if (status !== "archived") return;
    openConfirm({ briefKind: "record",
      target: taskCode,
      action: `删除已归档任务 · ${label}`,
      title: monthly ? "删除月度挑战" : "删除任务",
      detail: <>只能删除已归档的。删除后从列表消失，操作记录保留。</>,
      effect: <>{immediate}<IrreversibleTag /></>,
      confirmTone: "danger",
      content: <Facts>
        <Fact k={monthly ? "月度挑战" : "任务"}>{taskTitleText(label)}</Fact>
        <Fact k="列表里">消失，页面上没有恢复入口</Fact>
        {!monthly && <Fact k="已领到的用户">那一份和领取记录保留，不退不追</Fact>}
        <Fact k="操作记录">保留</Fact>
      </Facts>,
      statedBrief: { impact: "只删任务定义；已发出的任务、记录和审计都不删。", check: "确认是要永久从列表删掉；理由写清依据。" },
      reason: true,
      reasonPlaceholder: "例如：工单号、调整依据",
      okLabel: "确认删除",
      run: async (reason) => {
        await runWrite({ store: "mission", path: `/quest-events/tasks/${encodeURIComponent(taskCode)}`, method: "DELETE", target: taskCode,
          body: { taskKind, targetStatus: "deleted", expectedStatus: "archived" }, before: "archived", after: "deleted", success: `任务「${label}」已删除` }, reason);
      },
    });
  };

  const bindingTaskName = (code: string) => {
    const task = [...(model?.dayOneTasks ?? []), ...(model?.weeklyTier1 ?? []), ...(model?.weeklyTier2 ?? [])]
      .find((item) => text(item.taskCode ?? item.missionCode ?? item.id, "") === code);
    return task ? text(model?.contentLocales?.mission?.[code]?.zh?.name, "") || taskTitleText(text(task.task ?? task.cond)) : null;
  };

  const openBindingStatus = (binding: H3QuestEventBinding) => {
    const enabled = Number(binding.status) === 1;
    const nextEnabled = conflictDraft.intent === undefined ? !enabled : conflictDraft.intent === "true";
    if (nextEnabled === enabled) { if (conflictDraft.intent !== undefined) setStale(null); toast(conflictDraft.intent !== undefined ? "别人已经改成这个状态，不用再提交" : "和现在一样，没有改动"); return; }
    openConfirm({ rebaseValue: String(nextEnabled), briefKind: "record",
      target: binding.bindingCode,
      action: `${!nextEnabled ? "停用" : "启用"}完成条件 · ${binding.bindingCode}`,
      title: `${!nextEnabled ? "停用" : "启用"}完成条件`,
      detail: <>对应的任务要处于已停用或已启用状态。</>,
      effect: immediate,
      content: <Facts>
        <Fact k="条件"><span data-mono="">{binding.bindingCode}</span></Fact>
        <Fact k="用户做了什么">{bindingEventText(binding)}</Fact>
        <Fact k="对应任务">{bindingTaskName(binding.questCode) ?? `不在本页任务里（${binding.questCode}）`}</Fact>
        <Fact k="状态"><Change from={enabled ? "已启用" : "已停用"} to={!nextEnabled ? "已停用" : "已启用"} /></Fact>
        <Fact k="已领到的用户">不变，按拿到时的条件算</Fact>
        <Fact k="以后的用户">{!nextEnabled ? "之后注册、之后发布的任务里，做这件事不再算完成" : "之后注册、之后发布的任务里，做这件事算完成"}</Fact>
        {!nextEnabled && <Fact k="会被拒绝的情况">它是已启用首日任务的最后一条启用条件</Fact>}
      </Facts>,
      statedBrief: { impact: "只改以后的任务怎么算完成，不改已经发出的任务。", check: "核对条件和对应任务；理由写清依据。" },
      reason: true,
      reasonPlaceholder: "例如：工单号、调整依据",
      okLabel: nextEnabled ? "确认启用" : "确认停用",
      run: async (reason) => {
        await runWrite({ store: "binding", path: `/quest-events/bindings/${encodeURIComponent(binding.bindingCode)}`, method: "PATCH", target: binding.bindingCode,
          body: {
          producer: binding.producer,
          eventType: binding.eventType,
          questCode: binding.questCode,
          userIdField: binding.userIdField,
          enabled: nextEnabled,
          expectedProducer: binding.producer,
          expectedEventType: binding.eventType,
          expectedQuestCode: binding.questCode,
          expectedUserIdField: binding.userIdField,
          expectedEnabled: enabled,
        }, before: `${bindingEventText(binding)} · ${bindingTaskName(binding.questCode) ?? binding.questCode} · ${H3_BINDING_USER_FIELD_LABELS[binding.userIdField]} · ${Number(binding.status) === 1 ? "已启用" : "已停用"}`, after: `${bindingEventText(binding)} · ${bindingTaskName(binding.questCode) ?? binding.questCode} · ${H3_BINDING_USER_FIELD_LABELS[binding.userIdField]} · ${nextEnabled ? "已启用" : "已停用"}`, success: `完成条件「${binding.bindingCode}」已${!nextEnabled ? "停用" : "启用"}` }, reason);
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

  const bindingWhoFacts = <>
    <Fact k="已领到的用户">不变，按拿到时的条件算</Fact>
    <Fact k="以后的用户">之后注册、之后发布的任务按这里算完成</Fact>
  </>;

  const openCreateBinding = () => {
    if (bindingMissionOptions.length === 0) {
      toast("没有可以绑定的任务，请先新建任务，绑定完成条件后再启用");
      return;
    }
    openActionConfirm({ briefKind: "config",
      action: "新增任务完成条件",
      title: "新增完成条件",
      detail: <>用户做了这件事，对应任务就算完成；先绑定再启用。</>,
      effect: immediate,
      facts: <Facts>{bindingWhoFacts}<Fact k="不会做的事">不自动启用任务，也不发钱</Fact></Facts>,
      statedBrief: { impact: "只决定以后的任务怎么算完成。", check: "核对用户操作、对应任务和算谁完成；同一件事不能有两条启用的条件。" },
      confirmLabel: "确认新增",
      businessForm: {
        kind: "multi-field",
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
        await runWrite({ store: "binding", path: `/quest-events/bindings/${encodeURIComponent(bindingCode)}`, method: "POST", target: bindingCode,
          body: {
          producer,
          eventType,
          questCode,
          userIdField,
          enabled: form?.enabled === "true",
        }, before: "—", after: `${H3_BINDING_EVENT_LABELS[eventType]} · ${bindingTaskName(questCode) ?? questCode} · ${H3_BINDING_USER_FIELD_LABELS[userIdField]} · ${form?.enabled === "true" ? "已启用" : "已停用"}`, success: `完成条件「${bindingCode}」已新增` }, reason);
      },
    } as H3ActionConfirmReq);
  };

  const openBindingEdit = (binding: H3QuestEventBinding) => {
    openActionConfirm({ target: binding.bindingCode, briefKind: "config",
      action: `修改完成条件 · ${binding.bindingCode}`,
      title: "修改完成条件",
      detail: <>可以改「用户做了什么」、对应任务或「算谁完成」。如果别人刚改过，需要刷新后重改。</>,
      effect: immediate,
      facts: <Facts><Fact k="条件"><span data-mono="">{binding.bindingCode}</span></Fact>{bindingWhoFacts}</Facts>,
      statedBrief: { impact: "只决定以后的任务怎么算完成；已经发出的任务按原条件。", check: "核对改后的用户操作、对应任务和算谁完成。" },
      confirmLabel: "确认修改",
      businessForm: {
        kind: "multi-field",
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
        await runWrite({ store: "binding", path: `/quest-events/bindings/${encodeURIComponent(binding.bindingCode)}`, method: "PATCH", target: binding.bindingCode,
          body: {
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
        }, before: `${bindingEventText(binding)} · ${bindingTaskName(binding.questCode) ?? binding.questCode} · ${H3_BINDING_USER_FIELD_LABELS[binding.userIdField]} · ${Number(binding.status) === 1 ? "已启用" : "已停用"}`, after: `${H3_BINDING_EVENT_LABELS[eventType]} · ${bindingTaskName(questCode) ?? questCode} · ${H3_BINDING_USER_FIELD_LABELS[userIdField]} · ${enabled ? "已启用" : "已停用"}`, success: `完成条件「${binding.bindingCode}」已修改` }, reason);
      },
    } as H3ActionConfirmReq);
  };

  const openBindingDelete = (binding: H3QuestEventBinding) => {
    const enabled = Number(binding.status) === 1;
    openConfirm({ briefKind: "record",
      target: binding.bindingCode,
      action: `删除完成条件 · ${binding.bindingCode}`,
      title: "删除完成条件",
      detail: <>删除后，以后做这件事不再算完成；操作记录保留。</>,
      effect: <>{immediate}<IrreversibleTag /></>,
      confirmTone: "danger",
      content: <Facts>
        <Fact k="条件"><span data-mono="">{binding.bindingCode}</span></Fact>
        <Fact k="用户做了什么">{bindingEventText(binding)}</Fact>
        <Fact k="对应任务">{bindingTaskName(binding.questCode) ?? `不在本页任务里（${binding.questCode}）`}</Fact>
        <Fact k="已领到的用户">不变，按拿到时的条件算</Fact>
        <Fact k="以后的用户">之后注册、之后发布的任务里，做这件事不再算完成</Fact>
        {enabled && <Fact k="会被拒绝的情况">它是已启用首日任务的最后一条启用条件</Fact>}
      </Facts>,
      statedBrief: { impact: "只删现在的设置；历史和已发出任务里的条件不删。", check: "只想暂时不算用「停用」；理由写清依据。" },
      reason: true,
      reasonPlaceholder: "例如：工单号、调整依据",
      okLabel: "确认删除",
      run: async (reason) => {
        await runWrite({ store: "binding", path: `/quest-events/bindings/${encodeURIComponent(binding.bindingCode)}`, method: "DELETE", target: binding.bindingCode,
          body: {
          expectedProducer: binding.producer,
          expectedEventType: binding.eventType,
          expectedQuestCode: binding.questCode,
          expectedUserIdField: binding.userIdField,
          expectedEnabled: enabled,
        }, before: `${bindingEventText(binding)} · ${bindingTaskName(binding.questCode) ?? binding.questCode} · ${H3_BINDING_USER_FIELD_LABELS[binding.userIdField]} · ${Number(binding.status) === 1 ? "已启用" : "已停用"}`, after: "deleted", success: `完成条件「${binding.bindingCode}」已删除` }, reason);
      },
    });
  };

  // ===== 权威待审批读取和保存的原请求 =====
  const pendingApprovals = mutations.pendingApprovals.filter(t => ["h3_quest_config", "h3_mission_create"].includes(t.operationCode ?? ""));
  const pendingOf = (key: string) => pendingApprovals.find((item) => item.obj === key);
  const lockReason = (key: string) => pendingOf(key) ? "这一项有一张等批准的申请，审批结束前不能再改" : mutations.record(key) ? "这一项结果未知，请先查询原结果" : undefined;
  const lockTag = (key: string) => pendingOf(key) ? pendingTag() : null;

  // ===== 渲染 =====
  const zone = businessZone().label;
  const header = (
    <PageHeader pageId="H3" title="用户任务管理" summary="管 App 的首日任务、每周任务和它们的奖励。"
      meta={readAt ? <span className="rd-toolbar">
        <span>{`${businessClock(readAt)} 读取（${zone}）· 打开时读取`}</span>
        <Button variant="ghost" size="sm" loading={loading} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void refresh().catch(cause => toast(displayAdminError(cause)))}>刷新</Button>
      </span> : undefined}
      readOnly={!canModuleWrite ? "你只能查看；新建、修改、启停任务要有用户任务的修改权限。" : undefined} />
  );
  const openRecovery = (original: H3PendingCommand) => {
    const c = original.change;
    setMc({ briefKind: "config", action: c.action, title: c.title, detail: <Change from={shownValue(c.before)} to={shownValue(c.after)} />,
      facts: <Facts><Fact k="改的是">{c.action}</Fact><Fact k="原请求"><Change from={shownValue(c.before)} to={shownValue(c.after)} /></Fact></Facts>,
      initialReason: c.reason, getPendingReason: () => mutations.record(c.target)?.change.reason,
      inlineApproval: { pending: true, initialRecovery: "retry", expired: isRetryExpired(original), resolve: () => undefined,
        disabledReason: mutations.canRetry(original) ? undefined : isRetryExpired(original) ? RETRY_EXPIRED_TEXT : "请查询原结果",
        recover: async () => { await mutations.query(original); return true; }, retry: () => mutations.retry(original) },
      run: async () => { await mutations.retry(original); },
    });
  };
  // 记录里存的是请求里的原值（状态码、类别码），显示时换成页面上的叫法。
  const shownValue = (value: string) => value.split(" · ").map(part => ({ active: "已启用", paused: "已停用", archived: "已归档", deleted: "已删除", __MISSING__: "—" })[part]
    ?? TASK_CATEGORY_LABELS[part] ?? TASK_ACTION_ROUTE_LABELS[part] ?? part).join(" · ");
  const releasable = (original: H3PendingCommand) => original.request.kind !== "direct" && isRetryExpired(original) && !original.acknowledged && !original.ticket;
  const recoveryRows: H3RecoveryRow[] = mutations.records.map(original => {
    const approval = original.request.kind !== "direct";
    return {
      key: original.commandKey, name: original.change.action, change: <Change from={shownValue(original.change.before)} to={shownValue(original.change.after)} />,
      submittedAt: original.createdAt,
      tag: original.ticket ? pendingTag(original.store === "region" ? REGION_APPROVER : undefined) : original.acknowledged ? acknowledgedTag()
        : isRetryExpired(original) ? expiredTag(approval ? "approval" : "direct") : unknownTag(approval ? "approval" : "direct"),
      actions: <><Button size="sm" onClick={() => void mutations.query(original).catch(cause => toast(displayAdminError(cause)))}>查询原结果</Button>
        {!original.ticket && !original.acknowledged && !isRetryExpired(original)
          && <Button size="sm" disabledReason={mutations.canRetry(original) ? undefined : "请查询原结果"} onClick={() => openRecovery(original)}>按原请求重试</Button>}
        {releasable(original) && <Button size="sm" variant="ghost" onClick={() => setReleasing(original)}>查无此单时解除</Button>}</>,
    };
  });
  const unknownCount = mutations.records.filter(r => !r.ticket && !r.acknowledged).length;
  const pendingCount = mutations.records.filter(r => r.ticket).length;
  const builtCount = mutations.records.filter(r => !r.ticket && r.acknowledged).length;
  const recoveryTitle = [unknownCount && `${unknownCount} 个修改结果未知`, pendingCount && `${pendingCount} 个修改在等批准`, builtCount && `${builtCount} 个申请没查到进度`].filter(Boolean).join("；");
  const recovery = recoveryRows.length > 0 && (
    <Notice tone="warn" title={<>{recoveryTitle}<Explain label="原操作怎么处理" content={<>
      <p>结果未知：提交时没收到确定结果，可能已经生效。先「查询原结果」；没过 24 小时可以「按原请求重试」，后端认得出是同一次提交，不会重复执行。过了 24 小时只能查询。</p>
      <p>待审批、已建单：申请已经建好，点「查询原结果」看审批进度，不会重发。</p>
      <p>结果确认之前，这页不能再改同一项。</p>
    </>} /></>}>
      <H3RecoveryList rows={recoveryRows} />
    </Notice>
  );
  const releasingRow = releasing && recoveryRows.find(row => row.key === releasing.commandKey);
  const releaseModal = releasing && <ReleaseModal label={<>{releasing.change.action}{releasingRow && <> · {releasingRow.change}</>}</>}
    explain={<><p>原申请已超过 24 小时，不会再重发。</p><p>确认时先按原申请再查一次：明确查不到这张审批单才解除，说明申请没建成；查到了就按它现在的状态显示，不解除。</p></>}
    onCancel={() => setReleasing(null)} onConfirm={() => {
      const record = releasing;
      setReleasing(null);
      void mutations.releaseExpired(record)
        .then(() => toast("已解除这条记录，可以重新提交。"))
        .catch(cause => toast(displayAdminError(cause)));
    }} />;
  const staleNotice = stale && <Notice tone="warn" title={`没有保存：「${stale.title}」已被别人改过`}
    action={<Button size="sm" variant="ghost" onClick={() => setStale(null)}>知道了</Button>}>
    你打开时是 {shownValue(stale.before)}，要改成 {shownValue(stale.after)}。{error || !model ? "最新值没读到；重试读取成功后，会带着你填的内容重新打开。" : "已读到最新值，你填的还在，核对后再提交。"}
  </Notice>;

  const savedForConfirm = confirmation.current?.target ? mutations.record(confirmation.current.target) : undefined;
  const confirmModal = mc && (
        <OperationConfirmModal key={mc.formKey} briefKind={mc.briefKind}
          action={mc.action}
          title={mc.title}
          detail={mc.detail}
          amplifies={mc.amplifies}
          edit={mc.edit}
          businessForm={mc.businessForm}
          facts={mc.facts}
          effect={mc.effect}
          confirmLabel={mc.confirmLabel}
          confirmLabelForValue={mc.confirmLabelForValue}
          confirmTone={mc.confirmTone}
          statedBrief={mc.statedBrief}
          coverageLead={mc.coverageLead}
          coverageCheck={mc.coverageCheck}
          reasonPlaceholder={mc.reasonPlaceholder}
          blockedReason={mc.blockedReason}
          reasonPolicyOptional={mc.reasonPolicyOptional}
          inlineApproval={mc.inlineApproval ?? {
            pending: !!savedForConfirm, initialRecovery: "retry", resolve: () => undefined,
            expired: savedForConfirm ? isRetryExpired(savedForConfirm) : false,
            disabledReason: savedForConfirm && !mutations.canRetry(savedForConfirm) ? isRetryExpired(savedForConfirm) ? RETRY_EXPIRED_TEXT : "请查询原结果" : undefined,
            recover: async () => { const saved = confirmation.current?.target && mutations.record(confirmation.current.target); if (saved) await mutations.query(saved); return true; },
            retry: async () => { const saved = confirmation.current?.target && mutations.record(confirmation.current.target); if (saved) await mutations.retry(saved); },
          }}
          reasonMin={mc.reasonMin}
          reasonMax={mc.reasonMax}
          initialReason={mc.initialReason}
          getPendingReason={mc.getPendingReason}
          getPendingBusinessValue={mc.getPendingBusinessValue}
          completionCopy={mc.inlineApproval ? mc.completionCopy : undefined}
          onClose={() => setMc(null)}
          onConfirm={async (reason, newValue, businessValue) => {
            try {
              await mc.run(reason, newValue, businessValue);
              setMc(null);
            } catch (error) {
              // 直接保存被判定要走审批：换成审批确认，值和理由沿用，运营再确认一次才建单（H-改走审批）。
              if (error instanceof HApprovalRequired) {
                const { write, reason: kept } = error.input as { write: H3Write; reason: string };
                setMc(null);
                shellCtx.openConfirm(hApprovalReconfirm(error, { action: write.change.action, title: write.change.title, reason: kept,
                  change: <Change from={shownValue(write.change.before)} to={shownValue(write.change.after)} />, approver: FUND_APPROVER, holds: "这一项" }));
                return;
              }
              toast(error instanceof Error ? displayAdminError(error) : "操作失败");
              throw error;
            }
          }}
        />
      );

  if (loading && !model) return <div className="h3-page">{header}{recovery}{confirmModal}{releaseModal}<BlockState state="loading" title="用户任务读取中…" /></div>;
  if (error || !model) return (
    <div className="h3-page">
      {header}
      {recovery}
      {staleNotice}
      {confirmModal}
      {releaseModal}
      <BlockState state="error" title="用户任务读取失败" detail={`${error ?? "没有收到数据"} · 读到之前不能修改。`} retryLabel="重试读取" onRetry={() => void refresh().catch(cause => toast(displayAdminError(cause)))} />
    </div>
  );

  // ----- 派生（只读，不改请求） -----
  const dayOne = model.dayOneTasks ?? [];
  const t1 = model.weeklyTier1 ?? [];
  const t2 = model.weeklyTier2 ?? [];
  const monthly = model.monthlyMissions ?? [];
  const bindings = model.eventBindings ?? [];
  const lists: Record<ListKey, QuestTask[]> = { dayOne, t1, t2 };
  const all = [...dayOne, ...t1, ...t2];
  const codeOf = (task: QuestTask) => text(task.taskCode ?? task.missionCode ?? task.id, "");
  const nameOf = (task: QuestTask) => localizedValue(codeOf(task), "zh") || taskTitleText(text(task.task ?? task.cond));
  const bindingsOf = (task: QuestTask) => bindings.filter((binding) => binding.questCode === codeOf(task));
  const localeGaps = (task: QuestTask) => (["en", "zh", "vi"] as const).filter((locale) => !localizedValue(codeOf(task), locale)).map((locale) => LOCALE_LABEL[locale]);
  const active = all.filter((task) => taskStatusOf(task) === "active");
  const stuck = all.filter(activeUnbound);
  const codes = new Set(all.map(codeOf));
  const orphans = bindings.filter((binding) => Number(binding.status) === 1 && !codes.has(binding.questCode));
  const h1 = model.phaseMultiplierReadonly ?? {};
  const currentPhase = cleanPhaseKey(text(h1.currentPhase, ""));
  const h1Value = decimalOf(h1.value);
  const multipliers = model.weeklyMultipliers ?? [];
  const weeklyCurrent = multipliers.find((item) => cleanPhaseKey(item.p) === currentPhase);
  const weeklyValue = weeklyCurrent ? decimalOf(weeklyCurrent.mult) : null;
  const tri = parseTriReward(model.dayOneTriReward);
  const eligibility = text(model.dayOneEligibilityHours, "");
  const promo = model.promoBanner ?? {};
  const promoStatus = text(promo.status, "");
  const regionPending = region.pending;

  const stuckIn = (list: QuestTask[]) => list.filter(activeUnbound).length;
  const attention: Array<{ key: string; tone: "warn" | "neutral"; title: string; go: Tab }> = [
    ...(stuck.length ? [{ key: "stuck", tone: "warn" as const, title: `${stuck.length} 个已启用的任务没绑定完成事件，用户做不完`, go: (stuckIn(dayOne) ? "dayOne" : "weekly") as Tab }] : []),
    ...(orphans.length ? [{ key: "orphan", tone: "warn" as const, title: `${orphans.length} 条启用的完成条件对应的任务不在这页，要核查`, go: "bindings" as Tab }] : []),
    ...(regionPending ? [{ key: "region", tone: "neutral" as const, title: "每周区号规则的修改在等批准", go: "weekly" as Tab }] : []),
    ...(region.reviewError ? [{ key: "region-read", tone: "warn" as const, title: "区号规则的审批进度读取失败，暂不能再次提交", go: "weekly" as Tab }] : []),
    ...(pendingApprovals.length ? [{ key: "fund", tone: "neutral" as const, title: `${pendingApprovals.length} 个奖励或倍率的修改在等批准`, go: "dayOne" as Tab }] : []),
  ];
  const conclusionState = stuck.length || orphans.length || unknownCount ? "warn" : active.length === 0 ? "neutral" : "ok";
  const conclusion = (
    <Conclusion state={conclusionState} icon={conclusionState === "warn" ? CircleAlert : undefined}
      explain={<>
        <p>启用中按任务的状态数，只算首日和每周任务；历史月度挑战不算。</p>
        <p>「做不完」是已启用、但后端判定还没有启用的完成条件的任务：它会发给之后的用户，用户却完成不了。</p>
        {active.length === 0 && <p>没有启用的任务时，已发出的那一份不变；之后注册的用户、之后发布的每周任务都不会有新任务。</p>}
        <p>等批准的奖励和倍率修改：有查看审批权限时这页会读出来并锁住对应项；没有这个权限时只显示你在这个标签页提交过的。</p>
      </>}
      action={canAudit ? <Link className="rd-link" href="/platform/audit?domain=H" prefetch={false}>看待批准的申请</Link> : undefined}>
      {active.length === 0
        ? "没有启用的首日或每周任务"
        : `首日 ${dayOne.filter((task) => taskStatusOf(task) === "active").length} 个、每周 ${[...t1, ...t2].filter((task) => taskStatusOf(task) === "active").length} 个任务在启用`}
      {unknownCount > 0 && `；${unknownCount} 个修改结果未知`}
      {attention.length > 0 ? `；${attention.length} 件要处理` : mutations.auditKnown ? "，没有要处理的事" : shellCtx.can("platform_a2_read") ? "；审批进度这次没读到，点刷新重试" : ""}
    </Conclusion>
  );

  const stats = (
    <StatBand label="任务概况">
      <Stat tone="role-2" icon={ListChecks} label="已启用的任务" value={String(active.length)} unit="个"
        sub={`共 ${all.length} 个：首日 ${dayOne.length} · 每周 ${t1.length + t2.length}`}
        explain="首日和每周任务里状态是已启用的。已启用的才会发给之后注册的用户和之后发布的每周任务。" />
      <Stat tone={stuck.length ? "warn" : "role-other"} icon={CircleAlert} label="用户做不完的任务" value={String(stuck.length)} unit="个"
        sub={`另有 ${all.filter((task) => taskStatusOf(task) === "paused" && taskUnbound(task)).length} 个停用的还没绑定`}
        explain="已启用、但没有启用的完成条件的任务。停用的任务启用前要先绑定，后端会拦。" />
      <Stat tone="role-4" icon={Sparkles} label="任务加成（运营阶段设置）" value={h1Value ?? "—"} unit={h1Value ? "倍" : undefined}
        sub={currentPhase ? `现在是 ${currentPhase} · 只读` : "当前阶段没读到"} href={canPhase ? "/growth/phase" : undefined} openLabel="去运营阶段设置"
        explain="首日和每周奖励都乘它，在「运营阶段设置」改。首日在注册时、每周在发布时把它冻结进那一份任务，之后改不影响已发出的。" />
      <Stat tone="role-other" icon={History} label="经营统计" value="—"
        sub="领取率 · 本周完成和发放 · 月度人数"
        explain={<>
          <p>首日领取率（24 小时内、宽限）、本周完成（一档、二档）、本周发放 UVT、正在做月度挑战的人数：后端现在只给任务定义的数量，这几项没有数。</p>
          <p>显示「—」，不是 0，也不代表没有人。已提后端补统计。</p>
        </>} />
    </StatBand>
  );

  const attentionList = attention.length > 0 && (
    <ul className="h3-todo" aria-label="要处理的事">
      {attention.map((item) => (
        <li key={item.key} data-tone={item.tone}>
          {item.tone === "warn" ? <CircleAlert size={16} aria-hidden /> : <CalendarClock size={16} aria-hidden />}
          <span>{item.title}</span>
          <Button size="sm" variant="ghost" onClick={() => setTab(item.go)}>去看</Button>
        </li>
      ))}
    </ul>
  );

  // ----- 任务卡和详情 -----
  const rewardOf = (task: QuestTask, list: ListKey) => {
    if (list === "dayOne") return { reward: <span className="h3-card-muted">按首日奖励统一发</span>, note: undefined };
    const base = decimalOf(task.reward);
    const result = mulDecimal(base, h1Value, weeklyValue);
    return {
      reward: base == null ? <b data-empty="">—</b> : <><b>{amountText(base)}</b> UVT</>,
      note: result == null ? undefined : `乘倍率后 ${result} UVT`,
    };
  };

  const taskMenu = (task: QuestTask, list: ListKey): MoreMenuItem[] => {
    const name = text(task.task ?? task.cond);
    const status = taskStatusOf(task);
    const archived = status === "archived";
    const rewardKey = `mission.${text(task.taskCode ?? task.missionCode ?? task.id)}.reward`;
    return [
      ...(!archived ? [
        { key: "name", label: "改原名", onSelect: conflictDraft.register(JSON.stringify(["openMissionEdit:1", task.taskCode ?? task.id]), () => openMissionEdit(task, name)) },
        { key: "present", label: "改类别和跳转", onSelect: conflictDraft.register(JSON.stringify(["openMissionPresentation:1", task.taskCode ?? task.id]), () => openMissionPresentation(task, name)) },
      ] : []),
      ...(list !== "dayOne" ? [{ key: "reward", label: "改奖励", disabledReason: lockReason(rewardKey), onSelect: conflictDraft.register(JSON.stringify(["openWeeklyReward:1", task.taskCode ?? task.id]), () => openWeeklyReward(task)) }] : []),
      ...(!archived ? [{ key: "archive", label: "归档", danger: true, onSelect: conflictDraft.register(JSON.stringify(["openMissionArchive:1", task.taskCode ?? task.id]), () => openMissionArchive(task, name)) }] : []),
    ];
  };
  const taskPrimary = (task: QuestTask) => {
    const name = text(task.task ?? task.cond);
    const status = taskStatusOf(task);
    if (status === "archived") return <Button size="sm" variant="danger-outline" icon={<Trash2 size={14} aria-hidden />} aria-label={`删除 ${nameOf(task)}`} onClick={conflictDraft.register(JSON.stringify(["openMissionDelete:1", task.taskCode ?? task.id]), () => openMissionDelete(task, name))}>删除</Button>;
    return <Button size="sm" icon={status === "active" ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />} aria-label={`${status === "active" ? "停用" : "启用"} ${nameOf(task)}`}
      onClick={conflictDraft.register(JSON.stringify(["openMissionStatus:1", task.taskCode ?? task.id]), () => openMissionStatus(task, name))}>{status === "active" ? "停用" : "启用"}</Button>;
  };

  const openWeeklyReward = (task: QuestTask) => {
    const code = text(task.taskCode ?? task.missionCode ?? task.id);
    const current = decimalOf(task.reward);
    openTaskReward(`mission.${code}.reward`, text(task.cond), text(task.reward), {
      title: "改每周任务奖励",
      effect: directionEffect("每周任务"),
      facts: (value) => {
        const direction = directionOf(current, value ?? null);
        return <Facts>
          <Fact k="任务">{nameOf(task)}</Fact>
          <Fact k="基础奖励">{value ? <Change from={`${amountText(current) ?? "—"} UVT`} to={`${amountText(value)} UVT`} /> : `${amountText(current) ?? "—"} UVT`}</Fact>
          {whenFact(direction)}
          <Fact k="已发布的每周任务">不变：按发布时冻结的奖励和倍率</Fact>
          <Fact k="之后发布的">新基础奖励 × 任务加成 × 每周阶段倍率</Fact>
          {approverFacts(direction === "up")}
        </Facts>;
      },
      statedBrief: { impact: "只改之后发布的每周任务的基础奖励，不即时发钱。", check: "核对新奖励；调高写清预算依据。" },
      confirmLabelForValue: (value) => directionOf(current, value ?? null) === "up" ? "提交审批" : "确认修改",
      coverageLead: "调高会多付 UVT，要另一位超级管理员批准",
      coverageCheck: "提交审批时和批准时，后端各检查一次兑付覆盖率；低于红线拒绝。",
      hint: "0–100,000 的整数",
    });
  };

  const detailTask = detail ? lists[detail.list].find((task) => codeOf(task) === detail.code) ?? null : null;
  const detailList = detail ? lists[detail.list] : [];
  const detailIndex = detailTask ? detailList.indexOf(detailTask) : -1;

  const cards = (list: ListKey, tasks: QuestTask[]) => tasks.length === 0
    ? <BlockState state="empty" title="还没有任务" detail={canModuleWrite ? "点右上角新建；建好后先绑定完成条件再启用。" : "有修改权限的同事新建后会显示在这里。"} />
    : <div className="h3-cards">
      {tasks.map((task) => {
        const reward = rewardOf(task, list);
        const rewardKey = `mission.${codeOf(task)}.reward`;
        return <TaskCard key={codeOf(task) || String(task.id)} task={task} name={nameOf(task)} bindings={bindingsOf(task)}
          reward={reward.reward} rewardNote={reward.note} localeGaps={localeGaps(task)} pending={lockTag(rewardKey)}
          selected={detail?.code === codeOf(task)} onOpen={() => setDetail({ list, code: codeOf(task) })}
          primary={canModuleWrite ? taskPrimary(task) : undefined} menu={canModuleWrite ? taskMenu(task, list) : undefined} />;
      })}
    </div>;

  const previewTask = (task: QuestTask, withReward: boolean): PreviewTask => ({
    key: codeOf(task),
    names: { en: localizedValue(codeOf(task), "en"), zh: localizedValue(codeOf(task), "zh"), vi: localizedValue(codeOf(task), "vi") },
    source: text(task.task ?? task.cond),
    category: text(task.category, "").toLowerCase(),
    route: text(task.href, ""),
    reward: withReward ? mulDecimal(decimalOf(task.reward), h1Value, weeklyValue) : undefined,
  });
  const dayOneActive = dayOne.filter((task) => taskStatusOf(task) === "active");
  const t1Active = t1.filter((task) => taskStatusOf(task) === "active");
  const t2Active = t2.filter((task) => taskStatusOf(task) === "active");

  // ----- 首日 -----
  const triRaw = text(model.dayOneTriReward, "");
  const windowRaw = text(model.dayOneWindow, "");
  const dayOneTab = (
    <div {...tabIds.panel("dayOne")} className="h3-tabpanel">
      <Panel title="首日奖励和时限" icon={Gift} tone="role-4" sub={`资格期限 ${eligibility ? `注册后 ${eligibility} 小时` : "—"}`}
        explain="新用户注册后第一天的任务：做完全部才领一次奖励。三档奖励、资格期限都在用户注册时定下，之后改只影响之后注册的用户。">
        <DayOneTimeline triReward={triRaw} eligibilityHours={eligibility} />
        <ConfigList label="首日参数">
          <ConfigRow name="首日奖励" value={tri ? `全额 ${amountText(tri.full)} UVT · 宽限 ${amountText(tri.grace)} UVT · 过期 0` : triRaw ? operatorCopyText(triRaw) : "还没设置"}
            sub={lockTag("dayOne.triReward") ?? "调高或第一次设置要批准"}
            what="做完全部首日任务后领取的奖励，按领取时离注册多久分全额、宽限、过期三档。"
            when={`调高或第一次设置：提交审批，${FUND_APPROVER}批准后生效；调低确认后立即生效。`}
            effect="只影响之后注册的用户；已经注册的按注册时定下的三档。"
            action={canModuleWrite ? <Button size="sm" disabledReason={lockReason("dayOne.triReward")} onClick={conflictDraft.register(JSON.stringify(["openSimpleConfig:1"]), () => openSimpleConfig("dayOne.triReward", "首日任务奖励", text(model.dayOneTriReward), true, {
              title: "改首日奖励",
              effect: directionEffect("注册用户"),
              facts: (value) => {
                const next = parseTriReward(value);
                const first = !tri;
                const direction = first ? null : next ? (Number(next.full) > Number(tri.full) || Number(next.grace) > Number(tri.grace) ? "up" : next.full === tri.full && next.grace === tri.grace ? "same" : "down") : null;
                return <Facts>
                  <Fact k="三档奖励">{value ? <Change from={triRaw ? operatorCopyText(triRaw) : "还没设置"} to={value} /> : triRaw ? operatorCopyText(triRaw) : "还没设置"}</Fact>
                  {whenFact(direction, first && !!value)}
                  <Fact k="已经注册的用户">不变：按注册时定下的三档</Fact>
                  <Fact k="之后注册的用户">按新三档</Fact>
                  {approverFacts(first || direction === "up")}
                </Facts>;
              },
              statedBrief: { impact: "只改之后注册用户的首日奖励，不立即发钱。", check: "全额大于 0，宽限不超过全额，最后一档是 0。" },
              confirmLabelForValue: (value) => {
                const next = parseTriReward(value);
                return !tri || (next && (Number(next.full) > Number(tri.full) || Number(next.grace) > Number(tri.grace))) ? "提交审批" : "确认修改";
              },
              coverageLead: "调高会多付 UVT，要另一位超级管理员批准",
              coverageCheck: "提交审批时和批准时，后端各检查一次兑付覆盖率；低于红线拒绝。",
              hint: "格式：全额 / 宽限 / 0 UVT，例如 100 / 50 / 0 UVT",
            }, <>全额、宽限、过期三档一起改。</>))}>调整</Button> : undefined} />
          <ConfigRow name="资格期限" value={eligibility ? `注册后 ${eligibility} 小时` : "—"}
            what="从注册算，到这个时间首日任务过期，不能再完成和领取。"
            when="确认后立即生效，只对之后注册的用户。" effect="已经注册的用户按注册时定下的期限。"
            action={canModuleWrite ? <Button size="sm" onClick={conflictDraft.register(JSON.stringify(["openSimpleConfig:2"]), () => openSimpleConfig("dayOne.eligibilityHours", "新手任务资格有效期（小时）", text(model.dayOneEligibilityHours), false, {
              title: "改首日资格期限",
              effect: immediate,
              facts: <Facts>
                <Fact k="已经注册的用户">不变：按注册时定下的期限</Fact>
                <Fact k="之后注册的用户">按新期限</Fact>
                <Fact k="全额时限">固定 24 小时，不跟着变</Fact>
              </Facts>,
              statedBrief: { impact: "只改之后注册用户的首日资格期限。", check: "填 24–720 的整数小时。" },
              confirmLabel: "确认修改",
              hint: "24–720 的整数小时",
              preview: (value) => /^\d+$/.test(value.trim()) ? `之后注册的用户，注册后 ${value.trim()} 小时首日任务过期。` : null,
            }, <>从注册算，过了这个时间首日任务过期。</>))}>调整</Button> : undefined} />
          <ConfigRow name="任务时长说明文字" value={windowRaw ? operatorCopyText(windowRaw) : "还没填"}
            sub={<StatusTag tone="neutral">只是展示文字，不改变倒计时</StatusTag>}
            what="后台记的一段说明文字。"
            effect="不改变任何用户的倒计时：真实全额时限固定 24 小时。已提后端决定接上还是退役。"
            action={canModuleWrite ? <Button size="sm" onClick={conflictDraft.register(JSON.stringify(["openSimpleConfig:3"]), () => openSimpleConfig("dayOne.windowMs", "首日任务时长", text(model.dayOneWindow), false, {
              title: "改任务时长说明文字",
              effect: <StatusTag tone="neutral">只改文字</StatusTag>,
              facts: <Facts>
                <Fact k="改的是">一段展示文字</Fact>
                <Fact k="用户的倒计时">不变：全额时限固定 24 小时</Fact>
              </Facts>,
              statedBrief: { impact: "只改一段说明文字，不改变任何用户的首日倒计时。", check: "核对文字；理由写清依据。" },
              confirmLabel: "确认修改",
              hint: "最多 160 字",
            }, <>只是一段展示文字。</>))}>调整</Button> : undefined} />
        </ConfigList>
      </Panel>
      <Panel title="首日任务" icon={ListChecks} tone="role-2" sub={`${dayOne.length} 个 · 已启用 ${dayOneActive.length} 个`}
          explain="用户注册时拿到的是那一刻已启用、绑定了完成条件的首日任务；做完全部才能领奖。之后改任务不影响已经注册的用户。"
          actions={canModuleWrite ? <Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={() => setCreating("DAY_ONE")}>新建首日任务</Button> : undefined}>
          <div className="h3-tasks-layout">
          {cards("dayOne", dayOne)}
        <AppPreview kind="dayOne" tasks={dayOneActive.map((task) => previewTask(task, false))}
          header={<><b>新手任务</b><span>{tri ? `注册 24 小时内领得 ${amountText(tri.full)} UVT` : "首日奖励还没设置"}</span></>}
          footer={tri && eligibility ? `之后领得 ${amountText(tri.grace)} UVT · 注册 ${eligibility} 小时后过期` : undefined}
          empty="新用户看不到首日任务卡" />
          </div>
        </Panel>
    </div>
  );

  // ----- 每周 -----
  const t1Hero = t1Active[0];
  const t1Base = t1Hero ? decimalOf(t1Hero.reward) : null;
  const t2Bases = t2Active.map((task) => decimalOf(task.reward)).filter((value): value is string => value != null);
  const t2Sum = t2Bases.length === t2Active.length ? sumDecimal(t2Bases) : null;
  const bothBase = t1Base != null && t2Sum != null ? sumDecimal([t1Base, t2Sum]) : null;
  const formulaRows: FormulaRow[] = [
    { key: "t1", label: "做完一档", base: t1Base, baseNote: t1Hero ? `首页那个：${nameOf(t1Hero)}` : "没有启用的一档任务",
      result: mulDecimal(t1Base, h1Value, weeklyValue), missing: t1Base == null ? "没有启用的一档任务" : undefined },
    { key: "all", label: "一档加全部二档", base: bothBase, baseNote: t2Active.length ? `另加二档 ${t2Active.length} 个` : "没有启用的二档任务",
      result: mulDecimal(bothBase, h1Value, weeklyValue), missing: bothBase == null ? t1Base == null ? "没有启用的一档任务" : "没有启用的二档任务" : undefined },
  ];
  const multAction = canModuleWrite ? (phase: string, mult: string) => {
    const current = decimalOf(mult);
    return <Button size="sm" variant="ghost" aria-label={`调整 ${phase} 每周阶段倍率`} disabledReason={lockReason(`weekly.mult.${phase}`)} onClick={conflictDraft.register(JSON.stringify(["openSimpleConfig:4", phase]), () => openSimpleConfig(`weekly.mult.${phase}`, `阶段倍率 ${phase}`, mult, true, {
      title: `改 ${phase} 每周阶段倍率`,
      effect: directionEffect("每周任务"),
      facts: (value) => {
        const direction = current == null ? null : directionOf(current, decimalOf(value));
        return <Facts>
          <Fact k={`${phase} 倍率`}>{value ? <Change from={mult} to={value} /> : mult}</Fact>
          {whenFact(direction, current == null && !!value)}
          <Fact k="已发布的每周任务">不变：按发布时冻结的倍率</Fact>
          <Fact k="之后发布的">平台在 {phase} 时发布的每周任务乘新倍率</Fact>
          {approverFacts(current == null || direction === "up")}
        </Facts>;
      },
      statedBrief: { impact: "只改之后发布的每周任务的阶段倍率；和运营阶段设置的任务加成相乘。", check: "填 0.1–5，最多 6 位小数。" },
      confirmLabelForValue: (value) => current == null || directionOf(current, decimalOf(value ?? null)) === "up" ? "提交审批" : "确认修改",
      coverageLead: "调高会多付 UVT，要另一位超级管理员批准",
      coverageCheck: "提交审批时和批准时，后端各检查一次兑付覆盖率；低于红线拒绝。",
      hint: "0.1–5，例如 1.2",
    }))}>调整</Button>;
  } : undefined;
  const champion = text(model.weeklyChampionBonus, "");
  const weeklyTab = (
    <div {...tabIds.panel("weekly")} className="h3-tabpanel">
      <Panel title="每周奖励怎么算" icon={Sparkles} tone="role-4" sub={currentPhase ? `现在是 ${currentPhase}` : "当前阶段没读到"}
        actions={canPhase ? <Link className="rd-link" href="/growth/phase" prefetch={false}>去运营阶段设置改任务加成</Link> : undefined}
        explain="每周任务发布时，把基础奖励、运营阶段设置的任务加成、这里的每周阶段倍率一起冻结；用户领取时按冻结的乘积到账，向下保留 6 位小数。之后改设置不影响已发布的。">
        <WeeklyFormula rows={formulaRows} h1={h1Value} h1Phase={currentPhase} weekly={weeklyValue} weeklyPhase={currentPhase}
          h1Link={null} />
        <div className="h3-sub-head">
          <h3>每周阶段倍率</h3>
          <Explain label="每周阶段倍率是什么" content={<>
            <p>只作用于每周任务；和「运营阶段设置」的任务加成相乘，不是同一个倍率。</p>
            <p>调高要提交审批，{FUND_APPROVER}批准后生效；调低立即生效。都只影响之后发布的每周任务。</p>
          </>} />
        </div>
        {multipliers.length === 0
          ? <p className="h3-empty-line">后端没有返回每周阶段倍率，算不出每周奖励。</p>
          : <PhaseStrip items={multipliers} currentPhase={currentPhase} action={multAction} />}
        <ConfigList label="周冠军">
          <ConfigRow name="周冠军说明文字" value={champion ? operatorCopyText(champion) : "还没填"}
            sub={<StatusTag tone="neutral" icon={Trophy}>只是展示文字，不发奖</StatusTag>}
            what="一段说明文字。" effect="系统不选冠军、不发奖，也不按里面的数字算钱。真正的冠军奖励规则还没定。"
            action={canModuleWrite ? <Button size="sm" onClick={conflictDraft.register(JSON.stringify(["openSimpleConfig:5"]), () => openSimpleConfig("weekly.champBonus", "周冠军展示文字", text(model.weeklyChampionBonus), false, {
              title: "改周冠军说明文字",
              effect: <StatusTag tone="neutral">只改文字</StatusTag>,
              facts: <Facts>
                <Fact k="改的是">一段展示文字</Fact>
                <Fact k="发奖">不发：系统不选冠军，也不按文字里的数字算钱</Fact>
              </Facts>,
              statedBrief: { impact: "只改说明文字，不会给任何人发奖。", check: "文字里别承诺系统做不到的奖励。" },
              confirmLabel: "确认修改",
              hint: "最多 160 字",
            }, <>只是一段展示文字。</>))}>调整</Button> : undefined} />
        </ConfigList>
      </Panel>
      <Panel title="每周任务" icon={ListChecks} tone="role-2" sub={`一档 ${t1.length} 个 · 二档 ${t2.length} 个 · 已启用 ${t1Active.length + t2Active.length} 个`}
          explain="每周发布时，把那一刻已启用、绑定了完成条件的任务冻结成这一周的任务。之后改任务只影响之后发布的。"
          actions={canModuleWrite ? <><Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={() => setCreating("WEEKLY_T1")}>新建一档</Button><Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={() => setCreating("WEEKLY_T2")}>新建二档</Button></> : undefined}>
          <div className="h3-tasks-layout"><div className="h3-tier-groups">
          <div className="h3-sub-head">
            <h3>{`一档 · ${t1.length} 个`}</h3>
            <Explain label="一档怎么给用户" content="App 首页只放一个一档任务：用户本周拿到的一档里，排在最前、还在有效期内、还没领的那个；领完就不再显示。后台不能按用户挑选。" />
          </div>
          {cards("t1", t1)}
          <div className="h3-sub-head">
            <h3>{`二档 · ${t2.length} 个`}</h3>
            <Explain label="二档怎么给用户" content="每个都能做、各自领奖；目标业务不可用或过了周期时仍可能领不了。" />
          </div>
          {cards("t2", t2)}
          </div>
        <AppPreview kind="weekly" hero={t1Hero ? previewTask(t1Hero, true) : null} tasks={t2Active.map((task) => previewTask(task, true))}
          header={<><b>本周任务</b><span>{currentPhase ? `${currentPhase} · 乘倍率后` : "乘倍率后"}</span></>}
          empty="下一次发布时没有每周任务" />
          </div>
        </Panel>
      <H3RegionPanel region={region} canAudit={canAudit} />
    </div>
  );

  // ----- 完成条件 -----
  const bindingsTab = (
    <div {...tabIds.panel("bindings")} className="h3-tabpanel">
      <Panel title="完成条件" icon={Link2} tone="role-2" sub={`${bindings.length} 条 · 启用 ${bindings.filter((binding) => Number(binding.status) === 1).length} 条`} data-proof="h3-event-binding"
        explain="用户在 App 里做了某件事（系统记下的事件），对应任务就算完成。新任务要先绑定再启用。改这里只影响之后注册、之后发布的任务；已经发出的按原条件。"
        actions={canModuleWrite ? <Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={conflictDraft.register(JSON.stringify(["openCreateBinding:1"]), openCreateBinding)}>新增完成条件</Button> : undefined}>
        {bindings.length === 0
          ? <BlockState state="empty" title="暂无完成条件" detail="没有完成条件的任务用户做不完；新建任务后在这里绑定。" />
          : <Table label="完成条件" className="h3-binding-table">
            <thead>
              <tr>
                <Th>用户做了什么</Th>
                <Th>对应任务</Th>
                <Th>算谁完成</Th>
                <Th>状态</Th>
                {canModuleWrite && <Th sticky="end">操作</Th>}
              </tr>
            </thead>
            <tbody>
              {bindings.map((binding) => {
                const enabled = Number(binding.status) === 1;
                const task = bindingTaskName(binding.questCode);
                return <Tr key={binding.bindingCode} mark={enabled && !task ? "danger" : undefined}>
                  <Td grow><Cell main={bindingEventText(binding)} title={`${binding.bindingCode} · ${producerText(binding.producer)} · ${binding.eventType}`} sub={<><span data-mono="">{binding.bindingCode}</span>{` · ${producerText(binding.producer)} · `}<span data-mono="">{binding.eventType}</span></>} /></Td>
                  <Td>{task
                    ? <Cell main={task} sub={<span data-mono="">{binding.questCode}</span>} />
                    : <Cell main={<span className="h3-card-alert"><CircleAlert size={14} aria-hidden />不在本页任务里</span>} sub={<span data-mono="">{binding.questCode}</span>} />}</Td>
                  <Td><Cell main={H3_BINDING_USER_FIELD_LABELS[binding.userIdField] ?? binding.userIdField} sub={<span data-mono="">{binding.userIdField}</span>} /></Td>
                  <Td>{enabled ? <StatusTag tone="ok" icon={CircleCheck}>已启用</StatusTag> : <StatusTag tone="neutral" icon={CircleSlash}>已停用</StatusTag>}</Td>
                  {canModuleWrite && <Td sticky="end" data-fit=""><span className="rd-row-actions">
                    <Button size="sm" icon={<Pencil size={14} aria-hidden />} aria-label={`修改 ${binding.bindingCode}`} onClick={conflictDraft.register(JSON.stringify(["openBindingEdit:1", binding.bindingCode]), () => openBindingEdit(binding))}>修改</Button>
                    <MoreMenu label={`${binding.bindingCode} 的更多操作`} items={[
                      { key: "toggle", label: enabled ? "停用" : "启用", onSelect: conflictDraft.register(JSON.stringify(["openBindingStatus:1", binding.bindingCode]), () => openBindingStatus(binding)) },
                      { key: "delete", label: "删除", danger: true, onSelect: conflictDraft.register(JSON.stringify(["openBindingDelete:1", binding.bindingCode]), () => openBindingDelete(binding)) },
                    ]} />
                  </span></Td>}
                </Tr>;
              })}
            </tbody>
          </Table>}
        {orphans.length > 0 && <div className="h3-block-gap"><Notice tone="warn" title={`${orphans.length} 条启用的完成条件对应的任务不在这页`}>
          <p>这页只列首日和每周任务。先到后台核查这个任务编号的真实目标，再决定修改或删除；不按它补任务。</p>
        </Notice></div>}
      </Panel>
    </div>
  );

  // ----- 历史月度 -----
  const monthlyTab = (
    <div {...tabIds.panel("monthly")} className="h3-tabpanel">
      <Panel title="历史月度挑战" icon={History} tone="role-other" sub={`${monthly.length} 个 · 历史功能`}
        explain="月度挑战已经不再使用：App 没有月度入口，也没有领取；不能新建。这里只保留历史记录的维护：改名称、改奖励、启停、归档和删除。">
        {monthly.length === 0
          ? <BlockState state="empty" title="没有历史月度挑战。" detail="月度挑战已不能新建。" />
          : <Table label="历史月度挑战">
            <thead>
              <tr>
                <Th>主题</Th>
                <Th>注册月龄</Th>
                <Th align="right">奖励</Th>
                <Th>状态</Th>
                {canModuleWrite && <Th sticky="end">操作</Th>}
              </tr>
            </thead>
            <tbody>
              {monthly.map((mission) => {
                const reward = legacyAssetText(text(mission.reward));
                // 月度奖励只改金额，币种沿用后端存的（UVT 或 USDT），确认框里新金额带上同一个币种。
                const unit = /[A-Za-z]+$/.exec(reward.text.trim())?.[0];
                // 后端把金额补到 6 位小数：去掉末尾的 0，最少留 2 位，不舍入。
                const rewardShown = reward.text.replace(/^(\d+)(?:\.(\d+))?/, (_, w: string, f = "") => `${amountText(w)}.${f.replace(/0+$/, "").padEnd(2, "0")}`);
                const status = taskStatusOf(mission);
                const label = text(mission.theme);
                return <Tr key={text(mission.id)}>
                  <Td grow><Cell main={label} sub={text(mission.goals, "") || "—"} title={label} /></Td>
                  <Td><Cell main={text(mission.age)} /></Td>
                  <Td align="right"><Cell num main={rewardShown} sub={reward.legacy ? "旧名称 NEX" : undefined} /></Td>
                  <Td><TaskStatusTag task={mission} /></Td>
                  {canModuleWrite && <Td sticky="end" data-fit=""><span className="rd-row-actions">
                    <Button size="sm" disabledReason={lockReason(`monthly.${text(mission.id)}.reward`)} onClick={conflictDraft.register(JSON.stringify(["openTaskReward:1", mission.id]), () => openTaskReward(`monthly.${text(mission.id)}.reward`, text(mission.theme), text(mission.reward), {
                      title: "改月度挑战奖励",
                      displayCurrent: rewardShown.replace(/\s*[A-Za-z]+$/, ""), unit,
                      detail: <>当前奖励 <b>{rewardShown}</b>{reward.legacy ? "（旧名称 NEX）" : ""}。</>,
                      effect: directionEffect("月度挑战"),
                      facts: (value) => {
                        const current = decimalOf(mission.reward);
                        const direction = directionOf(current, value ?? null);
                        return <Facts>
                          <Fact k="月度挑战">{label}</Fact>
                          <Fact k="奖励金额">{value ? <Change from={rewardShown} to={unit ? `${value} ${unit}` : value} /> : rewardShown}</Fact>
                          <Fact k="奖励类型">不变，只改金额</Fact>
                          {whenFact(direction)}
                          <Fact k="用户">App 现在没有月度入口，改了不会发给任何人</Fact>
                          {approverFacts(direction === "up")}
                        </Facts>;
                      },
                      statedBrief: { impact: "只改历史记录里的金额。", check: "核对新金额。" },
                      confirmLabelForValue: (value) => directionOf(decimalOf(mission.reward), value ?? null) === "up" ? "提交审批" : "确认修改",
                      coverageLead: "调高月度挑战奖励是放大方向，要另一位超级管理员批准",
                      hint: "0–100,000，最多 6 位小数",
                    }))}>改奖励</Button>
                    <MoreMenu label={`${label} 的更多操作`} items={status === "archived"
                      ? [{ key: "delete", label: "删除", danger: true, onSelect: conflictDraft.register(JSON.stringify(["openMissionDelete:2", mission.id]), () => openMissionDelete(mission, label, true)) }]
                      : [
                        { key: "name", label: "改名称", onSelect: conflictDraft.register(JSON.stringify(["openMissionEdit:2", mission.id]), () => openMissionEdit(mission, label, true)) },
                        { key: "toggle", label: status === "active" ? "停用" : "启用", onSelect: conflictDraft.register(JSON.stringify(["openMissionStatus:2", mission.id]), () => openMissionStatus(mission, label, true)) },
                        { key: "archive", label: "归档", danger: true, onSelect: conflictDraft.register(JSON.stringify(["openMissionArchive:2", mission.id]), () => openMissionArchive(mission, label, true)) },
                      ]} />
                  </span></Td>}
                </Tr>;
              })}
            </tbody>
          </Table>}
      </Panel>
    </div>
  );

  // ----- 首页备用卡 -----
  const promoBase = decimalOf(promo.baseReward);
  const promoMult = decimalOf(promo.multiplier);
  const promoFacts = (key: string, label: string, current: string | null, unit: string) => (value?: string) => {
    const direction = directionOf(current, value ?? null);
    return <Facts>
      <Fact k={label}>{value ? <Change from={current == null ? "—" : `${current}${unit}`} to={`${value}${unit}`} /> : current == null ? "—" : `${current}${unit}`}</Fact>
      {key === "promoBanner.baseReward" || key === "promoBanner.multiplier" ? whenFact(direction) : null}
      <Fact k="App 上">目前不显示备用卡，改了用户看不到</Fact>
      <Fact k="发钱">不发：只存参数</Fact>
      {approverFacts((key === "promoBanner.baseReward" || key === "promoBanner.multiplier") && direction === "up")}
    </Facts>;
  };
  const promoTab = (
    <div {...tabIds.panel("promo")} className="h3-tabpanel">
      <Panel title="首页备用促销卡" icon={Megaphone} tone="role-other"
        sub={<StatusTag tone="neutral" icon={CircleSlash}>App 目前不显示</StatusTag>}
        explain="原设计是首页没有可领的每周任务时，显示一张跳商城的备用卡。现在 App 只读到这些参数，没有显示和领取，改了用户看不到；已提后端和 App 决定接上还是退役。">
        <ConfigList label="备用卡参数">
          <ConfigRow name="状态" value={promoStatus === "active" ? "已启用" : promoStatus === "paused" ? "已暂停" : "—"}
            sub={promoStatus ? (lockTag("promoBanner.status") ?? "启用要批准") : "没读到备用卡配置"}
            what="备用卡开还是关。" when={`启用：提交审批，${FUND_APPROVER}批准后生效；暂停立即生效。`} effect="不影响每周任务卡。"
            action={canModuleWrite ? <Button size="sm" disabledReason={lockReason("promoBanner.status")} onClick={conflictDraft.register(JSON.stringify(["openPromoStatus:1"]), openPromoStatus)}>{promoStatus === "active" ? "暂停" : "启用"}</Button> : undefined} />
          <ConfigRow name="基础奖励" value={promoBase == null ? "—" : `${amountText(promoBase)} UVT`} sub={lockTag("promoBanner.baseReward") ?? "调高要批准"}
            what="备用卡上写的基础奖励。" when={`调高：提交审批，${FUND_APPROVER}批准后生效；调低立即生效。`}
            action={canModuleWrite ? <Button size="sm" disabledReason={lockReason("promoBanner.baseReward")} onClick={conflictDraft.register(JSON.stringify(["openNumericConfig:1"]), () => openNumericConfig("promoBanner.baseReward", "转化卡基础奖励", text(promo.baseReward), 0, 100000, 1, "increase", {
              title: "改备用卡基础奖励", effect: directionEffect("备用卡"), facts: promoFacts("promoBanner.baseReward", "基础奖励", promoBase, " UVT"),
              statedBrief: { impact: "只存参数，App 目前不显示，不发钱。", check: "0–100,000 的整数。" },
              confirmLabelForValue: (value) => directionOf(promoBase, value ?? null) === "up" ? "提交审批" : "确认修改",
              coverageLead: "调高备用卡奖励是放大方向，要另一位超级管理员批准", hint: "0–100,000 的整数",
            }))}>调整</Button> : undefined} />
          <ConfigRow name="展示倍率" value={promoMult == null ? "—" : `${promoMult}×`} sub={lockTag("promoBanner.multiplier") ?? "调高要批准"}
            what="备用卡上写的倍率，和每周任务的倍率无关。" when={`调高：提交审批，${FUND_APPROVER}批准后生效；调低立即生效。`}
            action={canModuleWrite ? <Button size="sm" disabledReason={lockReason("promoBanner.multiplier")} onClick={conflictDraft.register(JSON.stringify(["openNumericConfig:2"]), () => openNumericConfig("promoBanner.multiplier", "转化卡倍率", text(promo.multiplier), 0.1, 5, 0.1, "increase", {
              title: "改备用卡展示倍率", effect: directionEffect("备用卡"), facts: promoFacts("promoBanner.multiplier", "展示倍率", promoMult, "×"),
              statedBrief: { impact: "只存参数，App 目前不显示，不改每周任务倍率。", check: "0.1–5。" },
              confirmLabelForValue: (value) => directionOf(promoMult, value ?? null) === "up" ? "提交审批" : "确认修改",
              coverageLead: "调高备用卡倍率是放大方向，要另一位超级管理员批准", hint: "0.1–5",
            }))}>调整</Button> : undefined} />
          <ConfigRow name="卡上写的奖励" value={mulDecimal(promoBase, promoMult) == null ? "—" : `${mulDecimal(promoBase, promoMult)} UVT`}
            sub="基础奖励 × 展示倍率" what="只读，按上面两项算。" effect="没有对应的领取和发币，不是实际应付金额。" />
          <ConfigRow name="倒计时" value={promo.countdownDays == null && promo.countdownHours == null ? "—" : `${text(promo.countdownDays, "—")} 天 ${text(promo.countdownHours, "—")} 小时`}
            what="卡上显示的倒计时。" effect="只是展示，不改任何任务的真实期限。"
            action={canModuleWrite ? <span className="rd-row-actions">
              <Button size="sm" onClick={conflictDraft.register(JSON.stringify(["openNumericConfig:3"]), () => openNumericConfig("promoBanner.countdownDays", "转化卡倒计时天数", text(promo.countdownDays), 0, 365, 1, undefined, {
                title: "改备用卡倒计时天数", effect: immediate, facts: promoFacts("promoBanner.countdownDays", "倒计时天数", decimalOf(promo.countdownDays), " 天"),
                statedBrief: { impact: "只存参数，App 目前不显示。", check: "0–365 的整数。" }, confirmLabel: "确认修改", hint: "0–365 的整数",
              }))}>改天数</Button>
              <Button size="sm" onClick={conflictDraft.register(JSON.stringify(["openNumericConfig:4"]), () => openNumericConfig("promoBanner.countdownHours", "转化卡倒计时小时", text(promo.countdownHours), 0, 23, 1, undefined, {
                title: "改备用卡倒计时小时", effect: immediate, facts: promoFacts("promoBanner.countdownHours", "倒计时小时", decimalOf(promo.countdownHours), " 小时"),
                statedBrief: { impact: "只存参数，App 目前不显示。", check: "0–23 的整数。" }, confirmLabel: "确认修改", hint: "0–23 的整数",
              }))}>改小时</Button>
            </span> : undefined} />
          <ConfigRow name="推荐设备" value={text(promo.targetDevice, "") || "—"}
            what="卡上写的设备名称，是一段文字，不是商品编号。"
            action={canModuleWrite ? <Button size="sm" onClick={conflictDraft.register(JSON.stringify(["openSimpleConfig:6"]), () => openSimpleConfig("promoBanner.targetDevice", "转化卡目标设备", text(promo.targetDevice), false, {
              title: "改备用卡推荐设备", effect: immediate,
              facts: <Facts><Fact k="App 上">目前不显示备用卡，改了用户看不到</Fact><Fact k="商品">只是文字，不核对商品是否存在</Fact></Facts>,
              statedBrief: { impact: "只存一段文字，App 目前不显示。", check: "最多 128 字。" }, confirmLabel: "确认修改", hint: "最多 128 字",
            }))}>调整</Button> : undefined} />
          <ConfigRow name="卡上写的日收益" value={decimalOf(promo.targetDaily) == null ? "—" : text(promo.targetDaily)}
            sub="后端没给币种" what="卡上显示的设备日收益数字。" effect="只是展示，不改设备收益和用户钱包；币种等后端补上。"
            action={canModuleWrite ? <Button size="sm" onClick={conflictDraft.register(JSON.stringify(["openNumericConfig:5"]), () => openNumericConfig("promoBanner.targetDaily", "转化卡显示的日收益", text(promo.targetDaily), 0, 1000000, 0.01, undefined, {
              title: "改备用卡日收益", effect: immediate, facts: promoFacts("promoBanner.targetDaily", "日收益", decimalOf(promo.targetDaily), ""),
              statedBrief: { impact: "只存参数，App 目前不显示。", check: "0–1,000,000。" }, confirmLabel: "确认修改", hint: "0–1,000,000",
            }))}>调整</Button> : undefined} />
        </ConfigList>
      </Panel>
    </div>
  );

  // ----- 数据口径（第三层） -----
  const monitor = model.taskMonitor ?? [];
  const contracts = (
    <Fold title="数据口径（只读）" icon={Route} tone="role-other" summary={`任务定义 ${monitor.length} 类 · 首日任务 ${dayOne.length} 条`}
      explain="给核对报表的同事看：任务定义的数量，以及首日任务的完成记录口径。这些不是完成人数或发奖数。">
      <div className="h3-contract">
        <div className="h3-sub-head"><h3>任务定义数量</h3><Explain label="任务定义数量怎么算" content="按任务类型数后台里的任务定义（含已停用、已归档），不是完成或领取人数。读取异常时后端会返回空，空不代表 0 个。" /></div>
        {monitor.length === 0
          ? <p className="h3-empty-line">后端没有返回，不能据此判断有 0 个。</p>
          : <dl className="h3-monitor">{monitor.map((item) => <div key={item.label}><dt>{TYPE_LABEL[item.label] ?? operatorCopyText(item.label)}</dt><dd>{operatorCopyText(item.note).replace(/\s*来自\s*nx_\w+/, "")}</dd></div>)}</dl>}
        <div className="h3-sub-head"><h3>首日任务的完成记录口径</h3><Explain label="口径怎么算" content={<>
          <p>「过去一天新建的任务记录」是过去 24 小时新建的用户任务记录数，不管做没做完，不是完成数。</p>
          <p>「异常占比」是同一段时间里失败、异常、被拒的记录占比，后端算到 1 位小数；没有记录时是「—」。</p>
          <p>记录事件实际是任务编号；转化、留存几项是后端写死的值，不能据此认定发奖和报表数字一致。</p>
        </>} /></div>
        {dayOne.length === 0
          ? <p className="h3-empty-line">还没有首日任务。</p>
          : <Table label="首日任务的完成记录口径">
            <thead><tr><Th>任务</Th><Th>记录事件</Th><Th align="right">过去一天新建的任务记录</Th><Th align="right">异常占比</Th><Th>其他口径</Th></tr></thead>
            <tbody>
              {dayOne.map((task, index) => {
                const contract = contractForTask(task, model.taskContracts);
                const sample = contract.sample24h;
                return <Tr key={`${text(task.id, String(index))}-${text(contract.taskKey, String(index))}`}>
                  <Td><Cell main={nameOf(task)} title={`${nameOf(task)} · ${text(contract.taskKey, "—")}`} sub={<span data-mono="">{text(contract.taskKey, "—")}</span>} /></Td>
                  <Td><Cell main={<span data-mono="">{text(contract.serverEvent, "—")}</span>} /></Td>
                  <Td align="right"><Cell num main={sample == null || sample === "" ? "—" : numericValue(sample).toLocaleString("en-US")} /></Td>
                  <Td align="right"><Cell num main={text(contract.anomalyPct, "—")} /></Td>
                  <Td grow><Cell title={`后续业务 ${text(contract.downstream, "—")} · 七天 ${text(contract.day7, "—")} · 报表字段 ${text(contract.bi, "—")}`} main={`${boolValue(contract.b3) ? "计入转化" : "不计入转化"} · ${boolValue(contract.retentionOnly) ? "仅留存" : "不只算留存"}`}
                    sub={`后续业务 ${text(contract.downstream, "—")} · 七天 ${text(contract.day7, "—")} · 报表字段 ${text(contract.bi, "—")}`} /></Td>
                </Tr>;
              })}
            </tbody>
          </Table>}
      </div>
    </Fold>
  );

  const tabItems = [
    { value: "dayOne" as const, label: "首日任务", count: stuckIn(dayOne) },
    { value: "weekly" as const, label: "每周任务", count: stuckIn(t1) + stuckIn(t2) + (regionPending ? 1 : 0) },
    { value: "bindings" as const, label: "完成条件", count: orphans.length },
    { value: "monthly" as const, label: "历史月度挑战" },
    { value: "promo" as const, label: "首页备用卡" },
  ];

  const detailName = detailTask ? text(detailTask.task ?? detailTask.cond) : "";
  const detailArchived = detailTask ? taskStatusOf(detailTask) === "archived" : false;
  const detailBindings = detailTask ? bindingsOf(detailTask) : [];
  const detailReward = detailTask && detail ? rewardOf(detailTask, detail.list) : null;

  return (
    <div className="h3-page">
      {header}
      {recovery}
      {staleNotice}
      {releaseModal}
      {conclusion}
      {attentionList}
      {stats}
      <PageTabs label="任务类型" value={tab} onChange={(next) => { setTab(next); setDetail(null); }} ids={tabIds} items={tabItems} />
      {tab === "dayOne" && dayOneTab}
      {tab === "weekly" && weeklyTab}
      {tab === "bindings" && bindingsTab}
      {tab === "monthly" && monthlyTab}
      {tab === "promo" && promoTab}
      {contracts}

      <Drawer open={!!detailTask} onClose={() => setDetail(null)} title="任务详情" icon={ListChecks} tone="role-2" sub={detailTask ? nameOf(detailTask) : undefined}
        nav={{ hasPrev: detailIndex > 0, hasNext: detailIndex >= 0 && detailIndex < detailList.length - 1,
          onPrev: () => detail && setDetail({ list: detail.list, code: codeOf(detailList[detailIndex - 1]) }),
          onNext: () => detail && setDetail({ list: detail.list, code: codeOf(detailList[detailIndex + 1]) }) }}
        footer={detailTask && detail && canModuleWrite ? <Decision
          danger={detailArchived
            ? <Button variant="danger-outline" icon={<Trash2 size={14} aria-hidden />} onClick={conflictDraft.register(JSON.stringify(["openMissionDelete:3", detailTask?.taskCode ?? detailTask?.id]), () => openMissionDelete(detailTask, detailName))}>删除</Button>
            : <Button variant="danger-outline" icon={<Archive size={14} aria-hidden />} onClick={conflictDraft.register(JSON.stringify(["openMissionArchive:3", detailTask?.taskCode ?? detailTask?.id]), () => openMissionArchive(detailTask, detailName))}>归档</Button>}
          others={<>
            {!detailArchived && <Button onClick={conflictDraft.register(JSON.stringify(["openMissionPresentation:2", detailTask?.taskCode ?? detailTask?.id]), () => openMissionPresentation(detailTask, detailName))}>改类别和跳转</Button>}
            {detail.list !== "dayOne" && <Button disabledReason={lockReason(`mission.${codeOf(detailTask)}.reward`)} onClick={conflictDraft.register(JSON.stringify(["openWeeklyReward:2", detailTask?.taskCode ?? detailTask?.id]), () => openWeeklyReward(detailTask))}>改奖励</Button>}
          </>}
          primary={!detailArchived ? <Button variant={taskStatusOf(detailTask) === "active" ? "secondary" : "primary"} onClick={conflictDraft.register(JSON.stringify(["openMissionStatus:3", detailTask?.taskCode ?? detailTask?.id]), () => openMissionStatus(detailTask, detailName))}>{taskStatusOf(detailTask) === "active" ? "停用" : "启用"}</Button> : undefined} /> : undefined}>
        {detailTask && detail && <>
          <JudgmentPoints rows={[
            { label: "状态", value: <TaskStatusTag task={detailTask} /> },
            { label: "做了什么算完成", state: activeUnbound(detailTask) ? "warn" : undefined,
              value: !taskUnbound(detailTask) && detailBindings.some((binding) => Number(binding.status) === 1)
                ? detailBindings.filter((binding) => Number(binding.status) === 1).map(bindingEventText).join("、")
                : activeUnbound(detailTask) ? "没绑定完成事件，用户做不完" : "还没有启用的完成条件",
              reason: detailBindings.length ? `完成条件：${detailBindings.map((binding) => `${binding.bindingCode}（${Number(binding.status) === 1 ? "启用" : "停用"}）`).join("、")}` : "到「完成条件」页签绑定" },
            { label: "点了跳到", value: TASK_ACTION_ROUTE_LABELS[text(detailTask.href, "")] ?? text(detailTask.href, "—"), reason: <span data-mono="">{text(detailTask.href, "—")}</span> },
            { label: "奖励", value: detailReward?.reward, reason: detailReward?.note },
          ]} />
          <section className="h3-detail-block" aria-label="三语名称">
            <div className="h3-sub-head"><h3>三语名称</h3><Explain label="三语名称怎么显示" content="App 按用户的语言显示；没填的先显示英文，再显示原名，不会自动翻译。已填的不能清空。改了只影响之后注册的用户和之后发布的每周任务。" /></div>
            <dl className="h3-locales">
              <div><dt>原名</dt><dd>{detailName}</dd><span>{!detailArchived && canModuleWrite && <Button size="sm" variant="ghost" onClick={conflictDraft.register(JSON.stringify(["openMissionEdit:3", detailTask?.taskCode ?? detailTask?.id]), () => openMissionEdit(detailTask, detailName))}>改</Button>}</span></div>
              {(["en", "zh", "vi"] as const).map((locale) => {
                const value = localizedValue(codeOf(detailTask), locale);
                return <div key={locale}>
                  <dt>{LOCALE_LABEL[locale]}</dt>
                  <dd data-empty={value ? undefined : ""}>{value || (detailArchived ? "未填写" : "没填，App 回退显示")}</dd>
                  <span>{!detailArchived && canModuleWrite && <Button size="sm" variant="ghost" disabled={!codeOf(detailTask)}
                    aria-label={`${value ? "编辑" : "填写"} ${codeOf(detailTask)} ${LOCALE_LABEL[locale]}`}
                    onClick={conflictDraft.register(JSON.stringify(["openLocalizedContent:1", detailTask?.taskCode ?? detailTask?.id, locale]), () => openLocalizedContent(codeOf(detailTask), locale, detailName))}>{value ? "改" : "填写"}</Button>}</span>
                </div>;
              })}
            </dl>
            {detailArchived && <p className="h3-empty-line">已归档：名称、类别和文字不能改，奖励仍可维护。</p>}
          </section>
          <section className="h3-detail-block" aria-label="改了以后谁受影响">
            <div className="h3-sub-head"><h3>改了以后谁受影响</h3></div>
            <Facts>
              <Fact k="已拿到的用户">{`不受影响，按${detail.list === "dayOne" ? "注册" : "发布"}时定下的那一份`}</Fact>
              <Fact k="以后的用户">{detail.list === "dayOne" ? "之后注册的用户" : "之后发布的每周任务"}按新设置</Fact>
            </Facts>
          </section>
          <Fold title="技术信息" tone="role-other" inset summary={codeOf(detailTask) || "—"}>
            <Facts>
              <Fact k="任务编号"><span data-mono="">{codeOf(detailTask) || "—"}</span></Fact>
              <Fact k="类型"><span data-mono="">{text(detailTask.taskKind, "—")}</span></Fact>
              <Fact k="类别原值"><span data-mono="">{text(detailTask.category, "—")}</span></Fact>
              <Fact k="内部编号"><span data-mono="">{text(detailTask.id, "—")}</span></Fact>
            </Facts>
          </Fold>
        </>}
      </Drawer>

      {creating && <H3MissionFormDrawer missionType={creating} onClose={() => setCreating(null)}
        onReview={(bv) => runCreateMission(creating, creating === "DAY_ONE" ? "首日任务" : creating === "WEEKLY_T1" ? "每周一档" : "每周二档", bv)} />}

      <PaginationExemptionList
        items={[
          { label: "首日任务", maxRows: dayOne.length, reason: "任务很少，需要一屏核对奖励" },
          { label: "周任务", maxRows: t1.length + t2.length, reason: "需要一屏核对两档奖励" },
          { label: "月度任务", maxRows: monthly.length, reason: "主题很少，一屏核对更方便" },
        ]}
      />

      {confirmModal}
    </div>
  );
}

export default H3QuestTasks;
