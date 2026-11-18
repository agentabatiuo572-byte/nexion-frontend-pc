"use client";

/** H3 requests, approval routing and recovery use the existing redesigned markup.
 * The legacy H3/H4 component stays intact for its remaining callers. */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { compareH3Decimal, h3Decimal, h3HasConfigValue, h3MissionCreationRefusal, h3MissionEnableRefusal, parseH3Model } from "@/lib/admin/h3-contract";
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
  AppPreview, DayOneTimeline, H3RecoveryList, PhaseStrip, TaskCard, TaskStatusTag, WeeklyFormula, taskRetired,
  H3_BINDING_EVENT_LABELS, H3_BINDING_EVENT_OPTIONS, H3_BINDING_EVENT_PRODUCERS, H3_BINDING_USER_FIELDS, H3_BINDING_USER_FIELD_LABELS,
  TASK_ACTION_ROUTES, TASK_ACTION_ROUTE_LABELS, TASK_CATEGORY_LABELS, TASK_CATEGORY_OPTIONS,
  activeUnbound, amountText, bindingEventText, boolValue, casExpected, cleanPhaseKey, contractForTask, decimalOf, legacyAssetText, mulDecimal,
  acknowledgedTag, expiredTag, numericValue, parseTriReward, pendingTag, producerText, sumDecimal, taskStatusOf, taskTitleText, taskUnbound, text, unknownTag,
  H3CreationList, H3PendingLine, backendPendingTag, lockedTag, pendingChangeText,
  type FormulaRow, type H3Model, type H3RecoveryRow, type PreviewTask, type QuestTask,
} from "./h3-quest-parts";
import { H3RegionPanel, REGION_APPROVER, useH3RegionPolicy } from "./h3-region-policy";
import { H3OperatingFold, H3OperatingStat, hasH3OperatingStats } from "./h3-operating-stats";
import { hApprovalReconfirm } from "./h-approval-reconfirm";
import { H3MissionFormDrawer, type H3MissionForm } from "./h3-mission-form";

type H3ActionConfirmReq = ActionConfirmReq & { target?: string; confirmLabelForValue?: (value?: string) => string };
type Tab = "dayOne" | "weekly" | "bindings" | "monthly";
type ListKey = "dayOne" | "t1" | "t2";
type Locale = "en" | "zh" | "vi";

const LOCALE_LABEL: Record<Locale, string> = { en: "英文", zh: "中文", vi: "越南语" };
/** 已填的三语名称能不能清空：后端只放开从没启用过的草稿（内容状态是草稿且停用中）；启用过的、看不出来的、没给这一项的都不能清空。 */
type NameClear = "draft" | "opened" | "unknown";
const nameClearOf = (task: QuestTask): NameClear =>
  task.contentState === "DRAFT" && taskStatusOf(task) === "paused" ? "draft" : task.contentState === "OPENED" ? "opened" : "unknown";
const NAME_CLEAR_NOTE: Record<NameClear, string> = {
  draft: "任务还没启用过，已填的名称可以清空。",
  opened: "任务启用过，已填的名称不能清空。",
  unknown: "看不出启用过没有，已填的名称不能清空。",
};
const NAME_EDIT_HINT: Record<NameClear, string> = {
  draft: "最多 512 字；要留空，用「清空」",
  opened: "最多 512 字；任务启用过，不能留空",
  unknown: "最多 512 字；看不出任务启用过没有，不能留空",
};
const FUND_APPROVER = "另一位超级管理员";
const TYPE_LABEL: Record<string, string> = { DAY_ONE: "新手任务", WEEKLY_T1: "每周一档", WEEKLY_T2: "每周二档", DAILY: "每日任务（签到页管理）", MONTHLY: "月度挑战" };

function directionOf(current: string | null, next: string | null): "up" | "down" | "same" | null {
  if (current == null || next == null) return null;
  const a = h3Decimal(current), b = h3Decimal(next);
  if (a === null || b === null) return null;
  const direction = compareH3Decimal(b, a);
  return direction > 0 ? "up" : direction < 0 ? "down" : "same";
}

function dayOneRewardText(value: string) {
  const reward = legacyAssetText(value);
  return reward.legacy ? `${reward.text}（旧名称 NEX）` : value;
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
  // 页签自己关框时记下来：框关了才需要轻提示，框开着错误就写在框里。
  const openMc = useRef<H3ActionConfirmReq | null>(null);
  openMc.current = mc;
  // 保存被「别人先改过」拒绝：页面已重读，这里留住这次要改的内容，让运营和现值对照。
  const [stale, setStale] = useState<{ title: string; before: string; after: string } | null>(null);
  const [releasing, setReleasing] = useState<H3PendingCommand | null>(null);
  const toast = shellCtx.toast;
  const canModuleWrite = shellCtx.can("growth_h3_write");
  const fresh = useRef(false);
  const confirmation = useRef<{ action: string; title: string; target?: string; editValue?: string; businessValue?: Record<string, string>; commandKey?: string; finish: () => void } | null>(null);
  const openActionConfirm = (req: H3ActionConfirmReq | null) => {
    if (!req) { setMc(null); return; }
    if (!fresh.current || req.target && mutations.blocked(req.target)) {
      toast("请先查询原结果并成功刷新用户任务数据，再发起新的修改。");
      return;
    }
    req = conflictDraft.action(req, () => !!(confirmation.current?.target && mutations.record(confirmation.current.target)));
    const attempt = { action: String(req.action), title: String(req.title ?? req.action), target: req.target } as NonNullable<typeof confirmation.current>;
    confirmation.current = attempt;
    const editor = creating;
    const request: H3ActionConfirmReq = { ...req, getPendingReason: () => attempt.target ? mutations.record(attempt.target)?.change.reason : undefined,
      getPendingBusinessValue: () => (attempt.target ? mutations.record(attempt.target)?.change.businessValue : undefined) ?? req.getPendingBusinessValue?.(),
      run: async (reason, value, businessValue) => {
        attempt.editValue = value; attempt.businessValue = businessValue;
        confirmation.current = attempt;
        await req.run(reason, value, businessValue);
      },
    };
    attempt.finish = () => {
      if (openMc.current === request) openMc.current = null;
      setMc(current => current === request ? null : current);
      setCreating(current => current === editor ? null : current);
    };
    setMc(request);
  };
  const openConfirm = (req: ConfirmReq & { target?: string }) => {
    if (!fresh.current || req.target && mutations.blocked(req.target)) {
      toast("请先查询原结果并成功刷新用户任务数据，再发起新的修改。");
      return;
    }
    req = { ...req, ...conflictDraft.confirm(req, () => !!(confirmation.current?.target && mutations.record(confirmation.current.target))) };
    const attempt = { action: String(req.action), title: String(req.title ?? req.action), target: req.target } as NonNullable<typeof confirmation.current>;
    confirmation.current = attempt;
    const request: ConfirmReq = { ...req, freezePendingInput: true,
      getPendingReason: () => attempt.target ? mutations.record(attempt.target)?.change.reason : undefined,
      getPendingBlockReason: () => {
        const saved = attempt.target ? mutations.record(attempt.target) : undefined;
        return saved && !mutations.canRetry(saved) ? isRetryExpired(saved) ? RETRY_EXPIRED_TEXT : "请查询原结果" : undefined;
      },
      run: async (reason) => { confirmation.current = attempt; await req.run(reason); },
    };
    attempt.finish = () => shellCtx.closeConfirm?.(request);
    shellCtx.openConfirm(request);
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
  const [statsOpen, setStatsOpen] = useState(false);
  const [creating, setCreating] = useState<{ type: "DAY_ONE" | "WEEKLY_T1" | "WEEKLY_T2" } | null>(null);
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

  const mutations = useH3Mutations(toast, async (commandKey) => {
    fresh.current = false;
    if (commandKey && confirmation.current?.commandKey === commandKey) confirmation.current.finish();
    await reload();
    await region.reload();
  }, () => fresh.current, model);
  const refresh = async () => {
    openMc.current = null; setMc(null); shellCtx.closeConfirm?.();
    await reload();
    await region.reload();
    const results = await mutations.refreshTickets();
    for (const result of results) if (result.status === "rejected") toast(displayAdminError(result.reason));
  };
  useEffect(() => { void refresh().catch(cause => toast(displayAdminError(cause))); }, []);

  const runWrite = async (write: Omit<H3Write, "change"> & Pick<H3Write["change"], "target" | "before" | "after" | "success" | "rewardCurrency">, reason: string) => {
    const attempt = confirmation.current;
    if (!attempt) throw new Error("请重新打开原操作。");
    const recovering = !!attempt.commandKey;
    if (!recovering && mutations.blocked(write.target)) throw new Error("这一项有未结束的原操作，请先查询原结果。");
    attempt.target = write.target;
    if (recovering) {
      const original = mutations.record(write.target);
      if (!original || original.commandKey !== attempt.commandKey) throw new Error("原操作已处理，请刷新后重新操作。");
      await mutations.retry(original);
      return;
    }
    try {
      await mutations.run({ ...write, change: { target: write.target, action: attempt.action, title: attempt.title,
        before: write.before, after: write.after, success: write.success, editValue: attempt.editValue, businessValue: attempt.businessValue, rewardCurrency: write.rewardCurrency } }, reason, false, commandKey => { attempt.commandKey = commandKey; });
      setStale(null);
    } catch (error) {
      if (isHGrowthReadConflict(error)) {
        setStale({ title: attempt.action, before: write.before, after: write.after });
        if (write.store === "region" && !recovering) await region.reload(true);
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

  const updateConfigWithExpected = async (key: string, value: string, expectedValue: string, reason: string, label: string, rewardCurrency?: string) => {
    await runWrite({ store: "config", path: `/quest-events/config/${encodeURIComponent(key)}`, method: "PATCH",
      body: { key, value, expectedValue }, target: key, configKey: key,
      before: expectedValue === "__MISSING__" ? "—" : expectedValue, after: value, success: `${label} 已更新`, rewardCurrency }, reason);
  };

  /** Keep the established confirmation fields; transport owns the approval route. */
  type Look = Pick<H3ActionConfirmReq, "title" | "effect" | "facts" | "statedBrief" | "confirmLabel" | "confirmLabelForValue" | "coverageLead" | "coverageCheck"> & { hint?: ReactNode; preview?: (value: string) => ReactNode; detail?: ReactNode; displayCurrent?: string; unit?: string };

  const openSimpleConfig = (key: string, label: string, current: string, amplifies = false, look: Look = {}, detail?: ReactNode) => {
    const { hint, preview, displayCurrent, ...shown } = look;
    openActionConfirm({ target: key, briefKind: "config",
      action: label,
      detail: detail ?? <>当前值 <b>{current}</b>。</>,
      ...shown,
      amplifies,
      edit: { kind: "text", current, displayCurrent, disallowCurrent: true, hint, preview },
      run: async (reason, value) => {
        if (!value) return;
        const expectedValue = key === "dayOne.triReward" ? (current || "__MISSING__") : casExpected(current);
        await updateConfigWithExpected(key, value, expectedValue, reason, label);
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
        await updateConfigWithExpected(key, value, decimalOf(current) ?? "__MISSING__", reason, `奖励 ${label}`, key.startsWith("monthly.") ? unit : undefined);
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

  const runCreateMission = (missionType: "DAY_ONE" | "WEEKLY_T1" | "WEEKLY_T2", subject: string, bv: H3MissionForm) => {
    const refusal = h3MissionCreationRefusal(missionType, bv.missionCode?.trim() ?? "");
    if (refusal) { toast(displayAdminError(new Error(refusal))); return; }
    const reward = /^\d+$/.test(bv.rewardPoints?.trim() ?? "") ? bv.rewardPoints.trim() : null;
    const approval = Number(bv.rewardPoints) > 0;
    const editor = creating;
    // 同编号已有新建申请：后端给的事实写清楚；拦截本身仍在提交处（mutations.blocked）。
    const code = String(bv.missionCode ?? "").trim();
    const creation = model?.pendingMissionCreations?.find((item) => item.missionCode === code);
    const blockedReason = creation
      ? creation.ticketId == null ? "这个编号被审批锁定，读不出申请内容。到「操作记录与审批」核对后再建。"
        : "这个编号已有一张新建申请在等批准，审批结束前不能再建。"
      : pendingOf(code) ? "这个编号已有一张新建申请在等批准，审批结束前不能再建。"
        : mutations.blocked(code) ? "这个编号有结果未知的原操作，先在页面上方查询原结果。" : undefined;
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
        <Fact k="奖励">{reward == null ? "—" : `${amountText(reward)} UVT${missionType === "DAY_ONE" ? "（不单发，统一领新手任务奖励）" : ""}`}</Fact>
        <Fact k="类别和跳转">{`${TASK_CATEGORY_LABELS[bv.category] ?? bv.category} · ${TASK_ACTION_ROUTE_LABELS[bv.actionRoute] ?? bv.actionRoute}`}</Fact>
        <Fact k="建好后">已停用；绑定完成条件、启用以后用户才看得到</Fact>
        {approval ? <Fact k="什么时候生效" tone="warn">奖励大于 0：提交审批，批准后才建好</Fact> : <Fact k="什么时候生效">奖励是 0：确认后直接建好</Fact>}
        {approverFacts(approval)}
      </Facts>,
      statedBrief: { impact: "只在目录里加一条已停用的任务；不自动绑定、不启用、不发钱。", check: "核对编号（建好后不能改）、名称和奖励；理由写清依据。" },
      confirmLabel: approval ? "提交审批" : "确认新建",
      blockedReason,
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
        setCreating(current => current === editor ? null : current);
      },
    } as H3ActionConfirmReq);
  };

  const localizedValue = (code: string, locale: Locale) => text(model?.contentLocales?.mission?.[code]?.[locale]?.name, "");

  const openLocalizedContent = (code: string, locale: Locale, source: string, clear: NameClear) => {
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
      statedBrief: { impact: "只改这个任务这一种语言的名称，其他语言不动。", check: "核对语言和拼写；理由写清依据。" },
      confirmLabel: "确认修改",
      edit: { kind: "text", current, disallowCurrent: true, hint: current ? NAME_EDIT_HINT[clear] : "最多 512 字" },
      run: async (reason, value) => {
        if (!value) return;
        await updateConfigWithExpected(`content.mission.${code}.name.${locale}`, value, casExpected(current), reason, `${source} ${locale.toUpperCase()} 文案`);
      },
    } as H3ActionConfirmReq);
  };

  /** 清空一种语言的名称：只给从没启用过的草稿任务（nameClearOf），发的是同一个写入，值为空。 */
  const openLocalizedClear = (code: string, locale: Locale, source: string) => {
    const current = localizedValue(code, locale);
    openActionConfirm({ target: `content.mission.${code}.name.${locale}`, briefKind: "config",
      action: `清空 ${locale.toUpperCase()} 内容 · ${source}`,
      title: `清空${LOCALE_LABEL[locale]}名称`,
      detail: <>清空后 App {locale === "en" ? "显示原名" : "先显示英文，再显示原名"}。</>,
      effect: immediate,
      confirmTone: "danger",
      facts: <Facts>
        <Fact k="任务">{taskTitleText(source)}</Fact>
        <Fact k="语言">{LOCALE_LABEL[locale]}</Fact>
        <Fact k="现在的名称">{current}</Fact>
        <Fact k="清空后">{locale === "en" ? "App 显示原名" : "App 先显示英文，再显示原名"}</Fact>
        <Fact k="为什么能清空">任务还没启用过，用户没看到过</Fact>
      </Facts>,
      statedBrief: { impact: "只清空这个任务这一种语言的名称，其他语言不动。", check: "核对任务和语言；理由写清为什么撤回。" },
      confirmLabel: "确认清空",
      run: async (reason) => {
        await updateConfigWithExpected(`content.mission.${code}.name.${locale}`, "", casExpected(current), reason, `${source} ${locale.toUpperCase()} 文案`);
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
    const refusal = enabling ? h3MissionEnableRefusal(taskKind, taskCode) : undefined;
    if (refusal) { toast(displayAdminError(new Error(refusal))); return; }
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
        {!nextEnabled && <Fact k="会被拒绝的情况">它是已启用新手任务的最后一条启用条件</Fact>}
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
        {enabled && <Fact k="会被拒绝的情况">它是已启用新手任务的最后一条启用条件</Fact>}
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
  const pendingApprovals = mutations.pendingTargets;
  const pendingOf = (key: string) => pendingApprovals.includes(key);
  /** 后端读回的这一项：null 是没有锁；单号读不出的是审批锁定，不叫待审批。 */
  const backendLock = (key: string) => model?.pendingApprovals?.[key] ?? null;
  const auditHref = (object: string | null) => canAudit ? `/platform/audit?domain=H${object ? `&object=${encodeURIComponent(object)}` : ""}` : undefined;
  const pendingFormat = (key: string) => (value: string) => key === "dayOne.triReward" ? dayOneRewardText(value)
    : key.startsWith("weekly.mult.") ? `${value.replace(/[×x]\s*$/, "")}×` : `${amountText(value) ?? value} UVT`;
  const codeOf = (task: QuestTask) => text(task.taskCode ?? task.missionCode ?? task.id, "");
  // 月度奖励只改金额，币种沿用后端存的（UVT 或 USDT）：现在的奖励、申请改成的金额都带这一行的币种。
  // 后端把金额补到 6 位小数：去掉末尾的 0，最少留 2 位，不舍入。
  const monthlyAmount = (value: string) => value.replace(/^(\d+)(?:\.(\d+))?/, (_, w: string, f = "") => `${amountText(w)}.${f.replace(/0+$/, "").padEnd(2, "0")}`);
  const monthlyRow = (mission: QuestTask) => {
    const rewardKey = `monthly.${codeOf(mission)}.reward`;
    const reward = legacyAssetText(text(mission.reward));
    const unit = /[A-Za-z]+$/.exec(reward.text.trim())?.[0];
    const format = (value: string) => unit ? `${monthlyAmount(value)} ${unit}` : monthlyAmount(value);
    return { rewardKey, reward, unit, rewardShown: monthlyAmount(reward.text), format, lock: backendLock(rewardKey), label: text(mission.theme) };
  };
  const lockReason = (key: string) => {
    const lock = backendLock(key);
    if (lock && lock.ticketId == null) return "审批锁定：读不出申请内容，到「操作记录与审批」核对";
    return pendingOf(key) ? "已有一张申请在等批准，审批结束前不能再改" : mutations.blocked(key) ? "这一项结果未知，请先查询原结果" : undefined;
  };
  const lockTag = (key: string) => {
    const lock = backendLock(key);
    if (!lock) return pendingOf(key) ? pendingTag() : null;
    if (lock.ticketId == null) return lockedTag();
    const format = pendingFormat(key);
    return backendPendingTag(lock, pendingChangeText(lock, format), auditHref(key));
  };
  const pendingLine = (key: string, label?: string) => {
    const lock = backendLock(key);
    return lock && <H3PendingLine approval={lock} format={pendingFormat(key)} auditHref={auditHref(key)} label={label} />;
  };

  // ===== 渲染 =====
  const zone = businessZone().label;
  const header = (
    <PageHeader pageId="H3" title="用户任务管理" summary="管 App 的新手任务、每周任务和它们的奖励。"
      meta={readAt ? <span className="rd-toolbar">
        <span>{`${businessClock(readAt)} 读取（${zone}）· 打开时读取`}</span>
        <Button variant="ghost" size="sm" loading={loading} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void refresh().catch(cause => toast(displayAdminError(cause)))}>刷新</Button>
      </span> : undefined}
      readOnly={!canModuleWrite ? "你只能查看；新建、修改、启停任务要有用户任务的修改权限。" : undefined} />
  );
  const openRecovery = (original: H3PendingCommand) => {
    const c = original.change;
    const request: H3ActionConfirmReq = { briefKind: "config", action: c.action, title: c.title, detail: changeOf(c),
      facts: <Facts><Fact k="改的是">{c.action}</Fact><Fact k="原请求">{changeOf(c)}</Fact></Facts>,
      initialReason: c.reason, getPendingReason: () => mutations.record(c.target)?.change.reason,
      inlineApproval: { pending: true, initialRecovery: "retry", expired: isRetryExpired(original), resolve: () => undefined,
        disabledReason: mutations.canRetry(original) ? undefined : isRetryExpired(original) ? RETRY_EXPIRED_TEXT : "请查询原结果",
        recover: async () => { await mutations.query(original); return true; }, retry: () => mutations.retry(original) },
      run: async () => { await mutations.retry(original); },
    };
    confirmation.current = { action: c.action, title: c.title, target: c.target, commandKey: original.commandKey,
      finish: () => { if (openMc.current === request) openMc.current = null; setMc(current => current === request ? null : current); } };
    setMc(request);
  };
  // 记录里存的是请求里的原值（状态码、类别码），显示时换成页面上的叫法。
  const shownValue = (value: string) => value === "" ? "—" : value.split(" · ").map(part => ({ active: "已启用", paused: "已停用", archived: "已归档", deleted: "已删除", __MISSING__: "—" })[part]
    ?? TASK_CATEGORY_LABELS[part] ?? TASK_ACTION_ROUTE_LABELS[part] ?? part).join(" · ");
  // 月度奖励优先用原记录的展示币种，旧记录从对应任务核对。
  const monthlyUnit = (target: string, rewardCurrency?: string) => {
    const mission = rewardCurrency ? undefined : model?.monthlyMissions?.find((row) => `monthly.${codeOf(row)}.reward` === target);
    return rewardCurrency ?? (mission ? monthlyRow(mission).unit : undefined);
  };
  const changeValue = (target: string, value: string, rewardCurrency?: string) => {
    if (value === "—" || !/^(?:mission\.[^.]+\.reward|monthly\.[^.]+\.reward|weekly\.mult\.[^.]+|dayOne\.triReward)$/.test(target)) return shownValue(value);
    if (!h3HasConfigValue(value)) return "—";
    if (!target.startsWith("monthly.")) return pendingFormat(target)(value);
    const unit = monthlyUnit(target, rewardCurrency);
    return unit ? `${monthlyAmount(value)} ${unit}` : monthlyAmount(value);
  };
  // 旧记录没存币种、任务列表里又找不到这项时，数字照写，币种在后面说一次，不跟在每个数后面。
  const changeOf = (c: H3PendingCommand["change"]) => <>
    <Change from={changeValue(c.target, c.before, c.rewardCurrency)} to={changeValue(c.target, c.after, c.rewardCurrency)} />
    {/^monthly\.[^.]+\.reward$/.test(c.target) && !monthlyUnit(c.target, c.rewardCurrency) && <span className="rd-weak"> · 币种没读到</span>}
  </>;
  const releasable = (original: H3PendingCommand) => original.request.kind !== "direct" && isRetryExpired(original) && !original.acknowledged && !original.ticket;
  const recoveryRows: H3RecoveryRow[] = mutations.records.map(original => {
    const approval = original.request.kind !== "direct";
    return {
      key: original.commandKey, name: original.change.action, change: changeOf(original.change),
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
      <p>结果未知：提交时没收到确定结果，可能已经生效。先「查询原结果」；没过 24 小时可以「按原请求重试」，不会重复执行。过了 24 小时只能查询。</p>
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
  // 固定 key：重读失败换成整页失败状态时，开着的确认框不重挂，填的值和理由留着。
  const confirmModal = mc && (<Fragment key="h3-confirm">
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
          onClose={() => setMc(current => current === mc ? null : current)}
          onConfirm={async (reason, newValue, businessValue) => {
            try {
              await mc.run(reason, newValue, businessValue);
              setMc(current => current === mc ? null : current);
            } catch (error) {
              // 直接保存被判定要走审批：换成审批确认，值和理由沿用，运营再确认一次才建单（H-改走审批）。
              if (error instanceof HApprovalRequired) {
                const { write, reason: kept } = error.input as { write: H3Write; reason: string };
                setMc(null);
                shellCtx.openConfirm(hApprovalReconfirm(error, { hasPending: () => !!mutations.record(write.change.target), onUnknown: () => shellCtx.closeConfirm?.(), action: write.change.action, title: write.change.title, reason: kept,
                  change: <Change from={`${shownValue(write.change.before)}${mc.edit?.unit ? ` ${mc.edit.unit}` : ""}`} to={`${shownValue(write.change.after)}${mc.edit?.unit ? ` ${mc.edit.unit}` : ""}`} />, approver: FUND_APPROVER, holds: "这一项" }));
                return;
              }
              if (openMc.current !== mc) toast(error instanceof Error ? displayAdminError(error) : "操作失败");
              throw error;
            }
          }}
        />
      </Fragment>);
  // 新建任务抽屉同理：旧操作收尾后的重读失败时不卸掉，提示没读到、读到前不能进下一步。
  const missionDrawer = creating && <H3MissionFormDrawer key="h3-mission-drawer" missionType={creating.type} onClose={() => setCreating(null)}
    readFailed={error ? { retrying: loading, onRetry: () => void refresh().catch(cause => toast(displayAdminError(cause))) } : undefined}
    onReview={(bv) => runCreateMission(creating.type, creating.type === "DAY_ONE" ? "新手任务" : creating.type === "WEEKLY_T1" ? "每周一档" : "每周二档", bv)} />;

  if (loading && !model) return <div className="h3-page">{header}{recovery}{confirmModal}{releaseModal}<BlockState state="loading" title="用户任务读取中…" /></div>;
  if (error || !model) return (
    <div className="h3-page">
      {header}
      {recovery}
      {staleNotice}
      {confirmModal}
      {releaseModal}
      <BlockState state="error" title="用户任务读取失败" detail={`${error ?? "没有收到数据"} · 读到之前不能修改。`} retryLabel="重试读取" onRetry={() => void refresh().catch(cause => toast(displayAdminError(cause)))} />
      {missionDrawer}
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
  const triRaw = model.dayOneTriReward;
  const triFirst = !h3HasConfigValue(triRaw);
  const triLegacy = legacyAssetText(triRaw);
  const tri = parseTriReward(triLegacy.text);
  const eligibility = text(model.dayOneEligibilityHours, "");
  const promo = model.promoBanner ?? {};
  const promoStatus = text(promo.status, "");
  const regionPending = region.pending;
  // 后端读回的新建申请：读得出的按类型放进对应页签；读不出的（审批锁定）只在要处理的事里提一句。
  const creations = model.pendingMissionCreations ?? [];
  const creationsOf = (types: string[]) => creations.filter((item) => item.ticketId != null && types.includes(String(item.missionType).toUpperCase()));
  const lockedCreations = creations.filter((item) => item.ticketId == null);
  const lockedConfigs = Object.entries(model.pendingApprovals ?? {}).filter(([, lock]) => lock != null && lock.ticketId == null).map(([key]) => key);
  // 等批准的对象：配置项的键带「.」，新建申请是任务编号（不带「.」）。
  const configPending = pendingApprovals.filter((key) => key.includes("."));
  const creationPending = pendingApprovals.filter((key) => !key.includes("."));
  const tabOfKey = (key: string): Tab => key.startsWith("weekly.") ? "weekly" : key.startsWith("monthly.") ? "monthly"
    : key.startsWith("mission.") && !dayOne.some((task) => `mission.${codeOf(task)}.reward` === key) ? "weekly" : "dayOne";
  const tabOfCode = (code: string): Tab => String(creations.find((item) => item.missionCode === code)?.missionType).toUpperCase() === "DAY_ONE" ? "dayOne" : "weekly";
  const typeLabel = (type: string | null) => TYPE_LABEL[String(type).toUpperCase()] ?? "类型读不出";

  const stuckIn = (list: QuestTask[]) => list.filter(activeUnbound).length;
  const attention: Array<{ key: string; tone: "warn" | "neutral"; title: string; go?: Tab; href?: string }> = [
    ...(stuck.length ? [{ key: "stuck", tone: "warn" as const, title: `${stuck.length} 个已启用的任务没绑定完成事件，用户做不完`, go: (stuckIn(dayOne) ? "dayOne" : "weekly") as Tab }] : []),
    ...(orphans.length ? [{ key: "orphan", tone: "warn" as const, title: `${orphans.length} 条启用的完成条件对应的任务不在这页，要核查`, go: "bindings" as Tab }] : []),
    ...(regionPending ? [{ key: "region", tone: "neutral" as const, title: "每周区号规则的修改在等批准", go: "weekly" as Tab }] : []),
    ...(region.reviewError ? [{ key: "region-read", tone: "warn" as const, title: "区号规则的审批进度读取失败，暂不能再次提交", go: "weekly" as Tab }] : []),
    ...(configPending.length + creationPending.length ? [{ key: "fund", tone: "neutral" as const,
      title: `${[configPending.length && `${configPending.length} 项奖励或倍率的修改`, creationPending.length && `${creationPending.length} 个新建任务`].filter(Boolean).join("、")}在等批准`,
      go: configPending.length ? tabOfKey(configPending[0]) : tabOfCode(creationPending[0]) }] : []),
    ...(lockedConfigs.length + lockedCreations.length ? [{ key: "locked", tone: "warn" as const, title: `${lockedConfigs.length + lockedCreations.length} 项被审批锁定，读不出申请内容`,
      go: lockedConfigs.length ? tabOfKey(lockedConfigs[0]) : undefined, href: auditHref(lockedCreations.length === 1 ? lockedCreations[0].missionCode : null) }] : []),
  ];
  const conclusionState = stuck.length || orphans.length || unknownCount ? "warn" : active.length === 0 ? "neutral" : "ok";
  const conclusion = (
    <Conclusion state={conclusionState} icon={conclusionState === "warn" ? CircleAlert : undefined}
      explain={<>
        <p>启用中按任务的状态数，只算新手任务和每周任务；历史月度挑战不算。</p>
        <p>「做不完」是已启用、但还没有启用的完成条件的任务：它会发给之后的用户，用户却完成不了。</p>
        {active.length === 0 && <p>没有启用的任务时，已发出的那一份不变；之后注册的用户、之后发布的每周任务都不会有新任务。</p>}
        <p>等批准的修改和新建任务，打开这页的人都看得到，对应项会锁住。</p>
        <p>结果未知只记在提交它的浏览器标签页里。</p>
      </>}
      action={canAudit ? <Link className="rd-link" href="/platform/audit?domain=H" prefetch={false}>看待批准的申请</Link> : undefined}>
      {active.length === 0
        ? "没有启用的新手任务或每周任务"
        : `新手任务 ${dayOne.filter((task) => taskStatusOf(task) === "active").length} 个、每周任务 ${[...t1, ...t2].filter((task) => taskStatusOf(task) === "active").length} 个在启用`}
      {unknownCount > 0 && `；${unknownCount} 个修改结果未知`}
      {attention.length > 0 ? `；${attention.length} 件要处理` : mutations.auditKnown ? "，没有要处理的事" : shellCtx.can("platform_a2_read") ? "；审批进度这次没读到，点刷新重试" : ""}
    </Conclusion>
  );

  const stats = (
    <StatBand label="任务概况">
      <Stat tone="role-2" icon={ListChecks} label="已启用的任务" value={String(active.length)} unit="个"
        sub={`共 ${all.length} 个：新手任务 ${dayOne.length} · 每周 ${t1.length + t2.length}`}
        explain="新手任务和每周任务里状态是已启用的。已启用的才会发给之后注册的用户和之后发布的每周任务。" />
      <Stat tone={stuck.length ? "warn" : "role-other"} icon={CircleAlert} label="用户做不完的任务" value={String(stuck.length)} unit="个"
        sub={`另有 ${all.filter((task) => taskStatusOf(task) === "paused" && taskUnbound(task)).length} 个停用的还没绑定`}
        explain="已启用、但没有启用的完成条件的任务。停用的任务启用前要先绑定，没绑定时启用会被拒绝。" />
      <Stat tone="role-4" icon={Sparkles} label="任务加成（运营阶段设置）" value={h1Value ?? "—"} unit={h1Value ? "倍" : undefined}
        sub={currentPhase ? `现在是 ${currentPhase} · 只读` : "当前阶段没读到"} href={canPhase ? "/growth/phase" : undefined} openLabel="去运营阶段设置"
        explain="新手任务和每周任务的奖励都乘它，在「运营阶段设置」改。新手任务在用户注册时、每周任务在发布时定下倍数，之后改不影响已发出的。" />
      {hasH3OperatingStats(model.h3Stats) ? <H3OperatingStat stats={model.h3Stats} onOpen={() => {
        setStatsOpen(true);
        requestAnimationFrame(() => document.getElementById("h3-operating-stats")?.scrollIntoView({ block: "nearest" }));
      }} /> : <Stat tone="role-other" icon={History} label="经营统计" value="—"
        sub="领取率 · 本周完成和发放 · 月度人数"
        explain={<>
          <p>新手任务奖励领取率（全额、宽限）、本周完成（一档、二档）、本周发放 UVT、正在做月度挑战的人数：这几项数据现在没有。</p>
          <p>显示「—」，不是 0，也不代表没有人。</p>
        </>} />}
    </StatBand>
  );
  const operatingStats = hasH3OperatingStats(model.h3Stats) && <H3OperatingFold stats={model.h3Stats} open={statsOpen} onOpenChange={setStatsOpen} />;

  const attentionList = attention.length > 0 && (
    <ul className="h3-todo" aria-label="要处理的事">
      {attention.map((item) => (
        <li key={item.key} data-tone={item.tone}>
          {item.tone === "warn" ? <CircleAlert size={16} aria-hidden /> : <CalendarClock size={16} aria-hidden />}
          <span>{item.title}</span>
          {item.go ? <Button size="sm" variant="ghost" onClick={() => item.go && setTab(item.go)}>去看</Button>
            : item.href && <Link className="rd-link" href={item.href} prefetch={false}>去核对</Link>}
        </li>
      ))}
    </ul>
  );

  // ----- 任务卡和详情 -----
  const rewardOf = (task: QuestTask, list: ListKey) => {
    if (list === "dayOne") return { reward: <span className="h3-card-muted">按新手任务奖励统一发</span>, note: undefined };
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
      disabledReason={missionEnableReason(task)}
      onClick={conflictDraft.register(JSON.stringify(["openMissionStatus:1", task.taskCode ?? task.id]), () => openMissionStatus(task, name))}>{status === "active" ? "停用" : "启用"}</Button>;
  };

  const missionEnableReason = (task: QuestTask) => {
    const { taskKind, taskCode, status } = taskIdentity(task);
    const refusal = status === "paused" ? h3MissionEnableRefusal(taskKind, taskCode) : undefined;
    return refusal ? displayAdminError(new Error(refusal)) : undefined;
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
      coverageCheck: "提交审批时和批准时各检查一次兑付覆盖率；低于红线会被拒绝。",
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
        const lock = backendLock(rewardKey);
        const proposed = list !== "dayOne" && lock?.proposedValue != null ? `申请改成 ${pendingFormat(rewardKey)(lock.proposedValue)}` : undefined;
        return <TaskCard key={codeOf(task) || String(task.id)} task={task} name={nameOf(task)} bindings={bindingsOf(task)}
          reward={reward.reward} rewardNote={proposed ? <>{reward.note && `${reward.note} · `}<span className="h3-card-proposed">{proposed}</span></> : reward.note} localeGaps={localeGaps(task)} pending={lockTag(rewardKey)}
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
  const triCurrent = triFirst ? "还没设置" : dayOneRewardText(triRaw);
  const triDirection = (value?: string) => {
    const next = parseTriReward(value);
    if (!tri || !next) return null;
    const full = compareH3Decimal(next.full, tri.full);
    const grace = compareH3Decimal(next.grace, tri.grace);
    return full > 0 || grace > 0 ? "up" : full === 0 && grace === 0 ? "same" : "down";
  };
  const windowRaw = text(model.dayOneWindow, "");
  const dayOneTab = (
    <div {...tabIds.panel("dayOne")} className="h3-tabpanel">
      <Panel title="新手任务奖励和期限" icon={Gift} tone="role-4" sub={`完成期限 ${eligibility ? `注册后 ${eligibility} 小时` : "—"}`}
        explain="新用户注册后拿到一组新手任务，做完全部才领一次奖励。三档奖励和完成期限按注册那一刻的设置，之后改只影响之后注册的用户。">
        <DayOneTimeline triReward={triRaw} eligibilityHours={eligibility} />
        <ConfigList label="新手任务设置">
          <ConfigRow name="新手任务奖励" value={tri && !triLegacy.legacy ? `全额 ${amountText(tri.full)} UVT · 宽限 ${amountText(tri.grace)} UVT · 过期 0` : triCurrent}
            sub={pendingLine("dayOne.triReward") || (lockTag("dayOne.triReward") ?? "调高或第一次设置要批准")}
            what="做完全部新手任务后领一次。按领取时离注册多久分三档：注册后 24 小时内领是全额，之后到完成期限前领是宽限，过了完成期限是 0。"
            when={`调高或第一次设置：提交审批，${FUND_APPROVER}批准后生效；调低确认后立即生效。`}
            effect="只影响之后注册的用户；已经注册的按注册时定下的三档。"
            action={canModuleWrite ? <Button size="sm" disabledReason={lockReason("dayOne.triReward")} onClick={conflictDraft.register(JSON.stringify(["openSimpleConfig:1"]), () => openSimpleConfig("dayOne.triReward", "新手任务奖励", triFirst ? "" : triRaw, true, {
              title: "改新手任务奖励",
              displayCurrent: triFirst ? undefined : triCurrent,
              effect: directionEffect("注册用户"),
              facts: (value) => {
                const direction = triDirection(value);
                return <Facts>
                  <Fact k="三档奖励">{value ? <Change from={triCurrent} to={value} /> : triCurrent}</Fact>
                  {whenFact(direction, triFirst && !!value)}
                  <Fact k="已经注册的用户">不变：按注册时定下的三档</Fact>
                  <Fact k="之后注册的用户">按新三档</Fact>
                  {approverFacts(!tri || direction === "up")}
                </Facts>;
              },
              statedBrief: { impact: "只改之后注册用户的新手任务奖励，不立即发钱。", check: "全额大于 0，宽限不超过全额，最后一档是 0。" },
              confirmLabelForValue: (value) => !tri || triDirection(value) === "up" ? "提交审批" : "确认修改",
              coverageLead: "调高会多付 UVT，要另一位超级管理员批准",
              coverageCheck: "提交审批时和批准时各检查一次兑付覆盖率；低于红线会被拒绝。",
              hint: "格式：全额 / 宽限 / 0 UVT，例如 100 / 50 / 0 UVT",
            }, <>全额、宽限、过期三档一起改。</>))}>调整</Button> : undefined} />
          <ConfigRow name="完成期限" value={eligibility ? `注册后 ${eligibility} 小时` : "—"}
            what="从注册算，过了这个时间新手任务过期，不能再完成和领取。"
            when="确认后立即生效，只对之后注册的用户。" effect="已经注册的用户按注册时定下的期限。"
            action={canModuleWrite ? <Button size="sm" onClick={conflictDraft.register(JSON.stringify(["openSimpleConfig:2"]), () => openSimpleConfig("dayOne.eligibilityHours", "新手任务完成期限", text(model.dayOneEligibilityHours), false, {
              title: "改新手任务完成期限",
              effect: immediate,
              facts: <Facts>
                <Fact k="已经注册的用户">不变：按注册时定下的期限</Fact>
                <Fact k="之后注册的用户">按新期限</Fact>
                <Fact k="全额时限">固定 24 小时，不跟着变</Fact>
              </Facts>,
              statedBrief: { impact: "只改之后注册用户的新手任务完成期限。", check: "填 24–720 的整数小时。" },
              confirmLabel: "确认修改",
              hint: "24–720 的整数小时",
              preview: (value) => /^\d+$/.test(value.trim()) ? `之后注册的用户，注册后 ${value.trim()} 小时新手任务过期。` : null,
            }, <>从注册算，过了这个时间新手任务过期。</>))}>调整</Button> : undefined} />
          {/* 任务时长说明文字已停用（后端 d9e2038f：新保存被拒，返回里带 dayOneWindowConfig 只读标记）：只读显示原来的文字，不再给调整入口。 */}
          {windowRaw && <ConfigRow name="任务时长说明文字" value={operatorCopyText(windowRaw)}
            sub={<StatusTag tone="neutral" icon={CircleSlash}>已停用，不能再改</StatusTag>}
            what="以前填的一段展示文字，现在只显示，不能再改。"
            effect="不改变 App 的倒计时和奖励：倒计时按完成期限走，全额时限固定 24 小时。" />}
        </ConfigList>
      </Panel>
      <Panel title="新手任务" icon={ListChecks} tone="role-2" sub={`${dayOne.length} 个 · 已启用 ${dayOneActive.length} 个`}
          explain="用户注册时拿到的是那一刻已启用、绑定了完成条件的新手任务；做完全部才能领奖。之后改任务不影响已经注册的用户。"
          actions={canModuleWrite ? <Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={() => setCreating({ type: "DAY_ONE" })}>新建新手任务</Button> : undefined}>
          <H3CreationList rows={creationsOf(["DAY_ONE"])} typeLabel={typeLabel} auditHref={auditHref} />
          <div className="h3-tasks-layout">
          {cards("dayOne", dayOne)}
        <AppPreview kind="dayOne" tasks={dayOneActive.map((task) => previewTask(task, false))}
          header={<><b>新手任务</b>{dayOneActive.length > 0 && <span>{`${dayOneActive.length} 项 · 倒计时 ${eligibility ? `${eligibility}:00:00` : "—"}`}</span>}</>}
          footer={dayOneActive.length > 0 ? <>做完全部出现「领取新手任务奖励」<br />到期显示「资格已结束」</> : undefined}
          empty="未参加新手任务" />
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
  const multAction = canModuleWrite ? (phase: string, mult: string | null) => {
    const first = !h3HasConfigValue(mult);
    const current = decimalOf(mult);
    const shown = first ? "-" : mult;
    return <Button size="sm" variant="ghost" aria-label={`调整 ${phase} 每周阶段倍率`} disabledReason={lockReason(`weekly.mult.${phase}`)} onClick={conflictDraft.register(JSON.stringify(["openSimpleConfig:4", phase]), () => openSimpleConfig(`weekly.mult.${phase}`, `阶段倍率 ${phase}`, shown, true, {
      title: `改 ${phase} 每周阶段倍率`,
      effect: directionEffect("每周任务"),
      facts: (value) => {
        const direction = current == null ? null : directionOf(current, decimalOf(value));
        return <Facts>
          <Fact k={`${phase} 倍率`}>{value ? <Change from={shown} to={`${value.replace(/[×x]\s*$/, "")}×`} /> : shown}</Fact>
          {whenFact(direction, first && !!value)}
          <Fact k="已发布的每周任务">不变：按发布时冻结的倍率</Fact>
          <Fact k="之后发布的">平台在 {phase} 时发布的每周任务乘新倍率</Fact>
          {approverFacts(current == null || direction === "up")}
        </Facts>;
      },
      statedBrief: { impact: "只改之后发布的每周任务的阶段倍率；和运营阶段设置的任务加成相乘。", check: "填 0.1–5，最多 6 位小数。" },
      confirmLabelForValue: (value) => current == null || directionOf(current, decimalOf(value ?? null)) === "up" ? "提交审批" : "确认修改",
      coverageLead: "调高会多付 UVT，要另一位超级管理员批准",
      coverageCheck: "提交审批时和批准时各检查一次兑付覆盖率；低于红线会被拒绝。",
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
          ? <p className="h3-empty-line">每周阶段倍率现在没有，算不出每周奖励。</p>
          : <PhaseStrip items={multipliers} currentPhase={currentPhase} action={multAction} mark={(phase) => lockTag(`weekly.mult.${phase}`)} />}
        {multipliers.some((item) => backendLock(`weekly.mult.${cleanPhaseKey(item.p)}`)) && <div className="h3-pending-lines">
          {multipliers.map((item) => cleanPhaseKey(item.p)).filter((phase) => backendLock(`weekly.mult.${phase}`))
            .map((phase) => <Fragment key={phase}>{pendingLine(`weekly.mult.${phase}`, phase)}</Fragment>)}
        </div>}
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
          actions={canModuleWrite ? <><Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={() => setCreating({ type: "WEEKLY_T1" })}>新建一档</Button><Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={() => setCreating({ type: "WEEKLY_T2" })}>新建二档</Button></> : undefined}>
          <H3CreationList rows={creationsOf(["WEEKLY_T1", "WEEKLY_T2"])} typeLabel={typeLabel} auditHref={auditHref} />
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
          <p>这页只列新手任务和每周任务。先到后台核查这个任务编号的真实目标，再决定修改或删除；不按它补任务。</p>
        </Notice></div>}
      </Panel>
    </div>
  );

  // ----- 历史月度 -----
  const monthlyPending = monthly.map(monthlyRow).filter((row) => row.lock);
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
                const { rewardKey, reward, unit, rewardShown, format, lock, label } = monthlyRow(mission);
                const status = taskStatusOf(mission);
                // 待审批、审批锁定在奖励下面标一个标签；申请改成多少、谁提交的写在表下面。
                const mark = lock ? lock.ticketId == null ? lockedTag() : backendPendingTag(lock, pendingChangeText(lock, format), auditHref(rewardKey))
                  : pendingOf(rewardKey) ? pendingTag() : null;
                return <Tr key={text(mission.id)}>
                  <Td grow><Cell main={label} sub={text(mission.goals, "") || "—"} title={label} /></Td>
                  <Td><Cell main={text(mission.age)} /></Td>
                  <Td align="right"><Cell num main={rewardShown} sub={mark || reward.legacy ? <span data-tagline="">{mark}{reward.legacy && "旧名称 NEX"}</span> : undefined} /></Td>
                  <Td><TaskStatusTag task={mission} /></Td>
                  {canModuleWrite && <Td sticky="end" data-fit=""><span className="rd-row-actions">
                    <Button size="sm" disabledReason={lockReason(rewardKey)} onClick={conflictDraft.register(JSON.stringify(["openTaskReward:1", mission.id]), () => openTaskReward(rewardKey, text(mission.theme), text(mission.reward), {
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
        {/* 主题长短不一：主题单独一列，后面的标签和申请内容上下对齐。 */}
        {monthlyPending.length > 0 && <div className="h3-pending-lines" data-named="">
          {monthlyPending.map((row) => <Fragment key={row.rewardKey}>
            <span className="h3-pending-label">{row.label}</span>
            {row.lock && <H3PendingLine approval={row.lock} format={row.format} auditHref={auditHref(row.rewardKey)} />}
          </Fragment>)}
        </div>}
      </Panel>
    </div>
  );

  // ----- 首页备用卡（d7540265：七项设置已停用，新保存一律被拒；只读显示以前存的值，收在页底折叠里） -----
  const promoBase = decimalOf(promo.baseReward);
  const promoMult = decimalOf(promo.multiplier);
  const promoFold = (
    <Fold title="首页备用卡" icon={Megaphone} tone="role-other"
      summary={<span className="h3-retired-sum"><StatusTag tone="neutral" icon={CircleSlash}>已停用</StatusTag>{promoStatus ? "以前存的值，仅供查看" : "没读到以前存的值"}</span>}
      explain="这 7 项设置已停用，不能再改，也不能启用；这里只显示以前存的值。">
      <ConfigList label="首页备用卡以前存的值">
        <ConfigRow name="状态" value={promoStatus === "active" ? "已启用" : promoStatus === "paused" ? "已暂停" : "—"} />
        <ConfigRow name="基础奖励" value={promoBase == null ? "—" : `${amountText(promoBase)} UVT`} />
        <ConfigRow name="展示倍率" value={promoMult == null ? "—" : `${promoMult}×`} />
        <ConfigRow name="卡上写的奖励" value={mulDecimal(promoBase, promoMult) == null ? "—" : `${mulDecimal(promoBase, promoMult)} UVT`}
          sub="基础奖励 × 展示倍率" what="按上面两项算，不是实际发的奖励。" />
        <ConfigRow name="倒计时" value={promo.countdownDays == null && promo.countdownHours == null ? "—" : `${text(promo.countdownDays, "—")} 天 ${text(promo.countdownHours, "—")} 小时`} />
        <ConfigRow name="推荐设备" value={text(promo.targetDevice, "") || "—"} />
        <ConfigRow name="卡上写的日收益" value={decimalOf(promo.targetDaily) == null ? "—" : text(promo.targetDaily)}
          sub="没有币种" />
      </ConfigList>
    </Fold>
  );

  // ----- 数据口径（第三层） -----
  const monitor = model.taskMonitor ?? [];
  // 11ea3732 起同一个数改按完成时间数；旧后端没有口径字段时仍是新建记录数，表头跟着返回的口径走。
  const completedBasis = model.taskContracts.some((contract) => contract.fieldSemantics?.sample24h === "TIMESTAMPED_COMPLETED_MISSION_INSTANCES");
  const contracts = (
    <Fold title="数据口径（只读）" icon={Route} tone="role-other" summary={`任务定义 ${monitor.length} 类 · 新手任务 ${dayOne.length} 条`}
      explain="给核对报表的同事看：任务定义的数量，以及新手任务的完成记录口径。这些不是完成人数或发奖数。">
      <div className="h3-contract">
        <div className="h3-sub-head"><h3>任务定义数量</h3><Explain label="任务定义数量怎么算" content="按任务类型数后台里的任务定义（含已停用、已归档），不是完成或领取人数。读取异常时这里是空的，空不代表 0 个。" /></div>
        {monitor.length === 0
          ? <p className="h3-empty-line">暂时读不到，不能据此判断有 0 个。</p>
          : <dl className="h3-monitor">{monitor.map((item) => <div key={item.label}><dt>{TYPE_LABEL[item.label] ?? operatorCopyText(item.label)}</dt><dd>{operatorCopyText(item.note).replace(/\s*来自\s*nx_\w+/, "")}</dd></div>)}</dl>}
        <div className="h3-sub-head"><h3>新手任务的完成记录口径</h3><Explain label="口径怎么算" content={completedBasis ? <>
          <p>「过去 24 小时完成」：过去 24 小时里做完的任务记录（含待领取、已领取），一条只算一次，不是人数。</p>
          <p>「新建记录的异常占比」：过去 24 小时新建的记录里失败、异常、被拒的占比，和完成的不是同一批；算到 1 位小数，没有记录时是「—」。</p>
          <p>转化和留存是默认设置，实际归因的数现在没有，不能当成已计入的结果。</p>
        </> : <>
          <p>「过去一天新建的任务记录」是过去 24 小时新建的用户任务记录数，不管做没做完，不是完成数。</p>
          <p>「异常占比」是同一段时间里失败、异常、被拒的记录占比，算到 1 位小数；没有记录时是「—」。</p>
          <p>转化和留存是默认设置，不能据此认定发奖和报表数字一致。</p>
        </>} /></div>
        {dayOne.length === 0
          ? <p className="h3-empty-line">还没有新手任务。</p>
          : <Table label="新手任务的完成记录口径">
            <thead><tr><Th>任务</Th><Th>任务编号</Th><Th align="right">{completedBasis ? "过去 24 小时完成" : "过去一天新建的任务记录"}</Th><Th align="right">{completedBasis ? "新建记录的异常占比" : "异常占比"}</Th><Th>转化和留存（默认设置）</Th></tr></thead>
            <tbody>
              {dayOne.map((task, index) => {
                const contract = contractForTask(task, model.taskContracts);
                const sample = contract.completed24h === undefined ? contract.sample24h : contract.completed24h;
                return <Tr key={`${text(task.id, String(index))}-${text(contract.taskKey, String(index))}`}>
                  <Td><Cell main={nameOf(task)} title={`${nameOf(task)} · ${text(contract.taskKey, "—")}`} /></Td>
                  <Td><Cell main={<span data-mono="">{text(contract.missionCode ?? contract.serverEvent, "—")}</span>} /></Td>
                  <Td align="right"><Cell num main={sample == null || sample === "" ? "—" : numericValue(sample).toLocaleString("en-US")} /></Td>
                  <Td align="right"><Cell num main={text(contract.anomalyPct, "—")} /></Td>
                  <Td grow><Cell title={`后续业务 ${text(contract.downstream, "—")} · 七天 ${text(contract.day7, "—")} · 报表项 ${text(contract.bi, "—")}`} main={`默认：${boolValue(contract.b3Default === undefined ? contract.b3 : contract.b3Default) ? "计入转化" : "不计入转化"} · ${boolValue(contract.retentionOnlyDefault === undefined ? contract.retentionOnly : contract.retentionOnlyDefault) ? "仅留存" : "不只算留存"}`}
                    sub={`后续业务 ${text(contract.downstream, "—")} · 七天 ${text(contract.day7, "—")} · 报表项 ${text(contract.bi, "—")}`} /></Td>
                </Tr>;
              })}
            </tbody>
          </Table>}
      </div>
    </Fold>
  );

  const tabItems = [
    { value: "dayOne" as const, label: "新手任务", count: stuckIn(dayOne) },
    { value: "weekly" as const, label: "每周任务", count: stuckIn(t1) + stuckIn(t2) + (regionPending ? 1 : 0) },
    { value: "bindings" as const, label: "完成条件", count: orphans.length },
    { value: "monthly" as const, label: "历史月度挑战" },
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
      {operatingStats}
      <PageTabs label="任务类型" value={tab} onChange={(next) => { setTab(next); setDetail(null); }} ids={tabIds} items={tabItems} />
      {tab === "dayOne" && dayOneTab}
      {tab === "weekly" && weeklyTab}
      {tab === "bindings" && bindingsTab}
      {tab === "monthly" && monthlyTab}
      {contracts}
      {promoFold}

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
          primary={!detailArchived ? <Button variant={taskStatusOf(detailTask) === "active" ? "secondary" : "primary"} disabledReason={missionEnableReason(detailTask)} onClick={conflictDraft.register(JSON.stringify(["openMissionStatus:3", detailTask?.taskCode ?? detailTask?.id]), () => openMissionStatus(detailTask, detailName))}>{taskStatusOf(detailTask) === "active" ? "停用" : "启用"}</Button> : undefined} /> : undefined}>
        {detailTask && detail && <>
          <JudgmentPoints rows={[
            { label: "状态", value: <TaskStatusTag task={detailTask} />, reason: taskRetired(detailTask) ? "质押类每周任务已下线，不能再启用；改名称、奖励和归档照常" : undefined },
            { label: "做了什么算完成", state: activeUnbound(detailTask) ? "warn" : undefined,
              value: !taskUnbound(detailTask) && detailBindings.some((binding) => Number(binding.status) === 1)
                ? detailBindings.filter((binding) => Number(binding.status) === 1).map(bindingEventText).join("、")
                : activeUnbound(detailTask) ? "没绑定完成事件，用户做不完" : "还没有启用的完成条件",
              reason: detailBindings.length ? `完成条件：${detailBindings.map((binding) => `${binding.bindingCode}（${Number(binding.status) === 1 ? "启用" : "停用"}）`).join("、")}` : "到「完成条件」页签绑定" },
            { label: "点了跳到", value: TASK_ACTION_ROUTE_LABELS[text(detailTask.href, "")] ?? text(detailTask.href, "—"), reason: <span data-mono="">{text(detailTask.href, "—")}</span> },
            { label: "奖励", value: detailReward?.reward, reason: backendLock(`mission.${codeOf(detailTask)}.reward`)
              ? <>{detailReward?.note && <span className="h3-detail-note">{detailReward.note}</span>}{pendingLine(`mission.${codeOf(detailTask)}.reward`)}</> : detailReward?.note },
          ]} />
          <section className="h3-detail-block" aria-label="三语名称">
            <div className="h3-sub-head"><h3>三语名称</h3><Explain label="三语名称怎么显示" content={<>
              <p>App 按用户的语言显示；没填的先显示英文，再显示原名，不会自动翻译。</p>
              <p>{NAME_CLEAR_NOTE[nameClearOf(detailTask)]}</p>
              <p>只影响之后注册的用户和新发布的每周任务。</p>
            </>} /></div>
            <dl className="h3-locales">
              <div><dt>原名</dt><dd>{detailName}</dd><span>{!detailArchived && canModuleWrite && <Button size="sm" variant="ghost" onClick={conflictDraft.register(JSON.stringify(["openMissionEdit:3", detailTask?.taskCode ?? detailTask?.id]), () => openMissionEdit(detailTask, detailName))}>改</Button>}</span></div>
              {(["en", "zh", "vi"] as const).map((locale) => {
                const value = localizedValue(codeOf(detailTask), locale);
                return <div key={locale}>
                  <dt>{LOCALE_LABEL[locale]}</dt>
                  <dd data-empty={value ? undefined : ""}>{value || (detailArchived ? "未填写" : "没填，App 回退显示")}</dd>
                  <span>{!detailArchived && canModuleWrite && <Button size="sm" variant="ghost" disabled={!codeOf(detailTask)}
                    aria-label={`${value ? "编辑" : "填写"} ${codeOf(detailTask)} ${LOCALE_LABEL[locale]}`}
                    onClick={conflictDraft.register(JSON.stringify(["openLocalizedContent:1", detailTask?.taskCode ?? detailTask?.id, locale]), () => openLocalizedContent(codeOf(detailTask), locale, detailName, nameClearOf(detailTask)))}>{value ? "改" : "填写"}</Button>}
                    {!detailArchived && canModuleWrite && value && nameClearOf(detailTask) === "draft" && <Button size="sm" variant="ghost" disabled={!codeOf(detailTask)}
                      aria-label={`清空 ${codeOf(detailTask)} ${LOCALE_LABEL[locale]}`}
                      onClick={conflictDraft.register(JSON.stringify(["openLocalizedClear:1", detailTask?.taskCode ?? detailTask?.id, locale]), () => openLocalizedClear(codeOf(detailTask), locale, detailName))}>清空</Button>}</span>
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

      {missionDrawer}

      <PaginationExemptionList
        items={[
          { label: "新手任务", maxRows: dayOne.length, reason: "任务很少，需要一屏核对奖励" },
          { label: "周任务", maxRows: t1.length + t2.length, reason: "需要一屏核对两档奖励" },
          { label: "月度任务", maxRows: monthly.length, reason: "主题很少，一屏核对更方便" },
        ]}
      />

      {confirmModal}
    </div>
  );
}

export default H3QuestTasks;
