"use client";

/**
 * H4 活动中心「既有活动与转盘」页签（第二部分）：既有活动、七类玩法、创世抽奖、转盘奖池与护栏。
 * 读取、提交、恢复和审批提案的逻辑从 h3-quest-events.tsx 的 H4 分支原样搬过来（旧文件不动，H3 仍用它）：
 * 请求地址、请求体、命令号、校验和恢复都和旧页面一样，这里只改界面。
 */
import { useEffect, useState, type ReactNode } from "react";
import { CircleAlert, CircleDot, Coins, Disc3, Gift, ListChecks, Plus, Power, Ticket, Trash2, Wallet } from "lucide-react";
import {
  BlockState, Button, Change, Drawer, Conclusion, Explain, Fact, Facts, IrreversibleTag, Notice, PageTabs, Panel, Stat, StatBand, StatusTag,
  Table, Td, Th, Tr, useTabIds, type MoreMenuItem, type PageTabItem,
} from "@/app/components/rd";
import { REVIEW_OPERATION_BY_ACTION, fetchA2Overview, type A2OperationRow } from "@/lib/admin/a2-client";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import {
  fetchH3QuestEvents,
  updateH4LocalizedContent,
  updateH4EventFeatured,
  updateH4EventReward,
  previewH4EventReward,
  updateH4EventStatus,
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
import { useAdminAuth } from "@/lib/store/admin-auth";
import { HI_WHEEL_SCOPE, hiEventScope, hiRewardProposal, pendingHIRewardCommand, pendingHIRewardCommands, retireH4PointsTier, submitHIRewardCommand, type HIRewardCommand } from "@/lib/admin/hi-reward-commands";
import { displayAdminError } from "@/lib/admin/error-messages";
import { isDeletableQuestEvent } from "@/lib/admin/activity-delete";
import type { EventRuleView } from "@/lib/admin/event-rules-client";
import type { AdminRaffle } from "@/lib/admin/genesis-raffle-client";
import type { HCtx } from "./types";
import H4EventRules from "./h4-event-rules";
import H4GenesisRaffle from "./h4-genesis-raffle";
import { amountText, formatTime } from "./h4-promotion-ui";
import {
  ApprovalFacts, EventCard, EventPreview, GuardCard, KIND_LABEL, KIND_OPTIONS, LOCALE_NAME, FIELD_NAME, LegacyNameTag, ProbabilityCompare,
  WHEEL_APP_KINDS, WHEEL_KIND_LABEL, WheelBar, WheelLegend, boolValue, casExpected, effectApproval, effectByDirection, effectDirect, expiredTag, formStore,
  legacyName, lifecycleOf, numericValue, pendingTag, percentText, text, unknownTag, wheelLegacyNexTier, wheelPointsTier, wheelUnit,
  type LegacyEvent, type LocaleCode, type WheelTier,
} from "./h4-legacy-parts";

type Model = {
  h4Stats?: Record<string, any>;
  events?: LegacyEvent[];
  contentLocales?: Record<string, Record<string, Record<string, Record<string, string>>>>;
  wheelTiers?: WheelTier[];
  wheelSignature?: string;
  wheelEvUsd?: number | string;
  wheelGuards?: Array<{ key: string; label: string; value: string; note?: string }>;
  trackables?: Array<{ id: string; name: string; cond: string; join: string; done: string; claim: string; geo: string }>;
};
type Sub = "events" | "plays" | "raffle" | "wheel";

const H4_APPROVAL_OPS = new Set(["h4_legacy_event_reward_update", "h4_wheel_tier_create", "h4_wheel_tier_update", "h4_wheel_probabilities_update", "h4_wheel_tier_delete"]);
const GUARD_NAME: Record<string, string> = { budget: "每日真钱奖预算", cap: "各奖档每日库存", kill: "真钱奖发放开关" };
const killOn = (value: string) => ["1", "true", "on", "enabled", "open", "开"].includes(value.trim().toLowerCase());
const budgetNumber = (value: string) => value.replace(/[$,\s]/g, "");

/** 原操作写成一句「做什么 · 对哪一项」，不露命令号和对象键。 */
function hiCommandSubject(record: HIRewardCommand, eventName: (id: string) => string) {
  const payload = record.payload;
  if (payload.kind === "retire") return `退役积分奖项 · ${payload.tierName}`;
  const values = payload.input.command.params.values as Record<string, unknown>;
  if (payload.input.command.op === "h4_legacy_event_reward_update") return `${payload.input.action} · ${eventName(String(values.eventCode))} · 改成 ${String(values.value)}`;
  if (payload.input.command.op === "h4_wheel_probabilities_update") return `${payload.input.action} · 转盘全部奖项`;
  return `${payload.input.action} · ${String(values.tierName ?? "转盘奖池")}`;
}

// A2's decimal parser requires a leading digit and no plus sign; keep every entered digit.
function h4ProposalDecimal(value: string | undefined, field: string) {
  const raw = value?.trim();
  if (!raw) throw new Error(`请填写${field}`);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) {
    throw new Error(`${field}请填写普通十进制数字，不支持科学计数法`);
  }
  return raw.replace(/^\+/, "").replace(/^(-?)\./, (_match, sign: string) => `${sign}0.`).replace(/\.$/, "");
}

// Mirrors OpsGrowthService.increasesUvtFallback, including the backend's ordered comfort pool.
function increasesUvtFallback(tiers: Array<Record<string, any>>, changed: Record<string, any>, directlyDrawn: boolean) {
  let afterChanged = false;
  for (const tier of tiers) {
    if (boolValue(tier.real) || text(tier.kind).toLowerCase() !== "uvt") continue;
    if (tier === changed) { afterChanged = true; continue; }
    const higher = (directlyDrawn || afterChanged) && numericValue(tier.amount) > numericValue(changed.amount);
    if (higher && (directlyDrawn || tiers.some(draw => draw !== changed && draw !== tier && numericValue(draw.prob) > 0
      && (boolValue(draw.real) || numericValue(draw.dailyStock) > 0)))) return true;
    if (numericValue(tier.dailyStock) <= 0) return false;
  }
  return false;
}

export default function H4LegacyCenter({ ctx }: { ctx: HCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const canModuleWrite = ctx.can("growth_h4_write");
  const canWheelWrite = ctx.can("growth_h4_wheel_pool_write");
  const [, pendingDeleteChanged] = useState(0);
  const [model, setModel] = useState<Model | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canReadA2 = ctx.can("platform_a2_read");
  // 已建成、等别人批的 H4 审批单只在审批中心里；这里读一次，好让运营在本页看到哪项在等批。
  const [h4Approvals, setH4Approvals] = useState<A2OperationRow[] | "error" | null>(null);
  const [lookupKey, setLookupKey] = useState("");
  const [sub, setSub] = useState<Sub>("events");
  const [rules, setRules] = useState<EventRuleView[] | null>(null);
  const [raffles, setRaffles] = useState<AdminRaffle[] | null>(null);
  const [contentId, setContentId] = useState<string | null>(null);
  const tabIds = useTabIds();
  const reloadH4Approvals = async () => {
    if (!canReadA2) return;
    try {
      const overview = await fetchA2Overview();
      setH4Approvals(overview.operationQueue.filter(row => {
        const op = REVIEW_OPERATION_BY_ACTION[row.action];
        return row.status === "pending" && H4_APPROVAL_OPS.has(op)
          && (!row.operationCode || row.operationCode === op)
          && (op === "h4_legacy_event_reward_update" ? !!row.obj : row.obj === "ACTIVE_POOL");
      }));
    } catch {
      setH4Approvals("error");
    }
  };
  useEffect(() => { void reloadH4Approvals(); }, [canReadA2]);

  const reload = async () => {
    setLoading(true);
    try {
      setModel((await fetchH3QuestEvents("events")) as Model);
      setError(null);
    } catch (err) {
      setError(displayAdminError(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void reload(); }, []);

  const apply = (next: Record<string, any>) => setModel(next as Model);

  const proposeH4 = async (scope: string, op: string, values: Record<string, unknown>, before: string, after: string,
    reason: string, form?: Record<string, string>, editValue?: string) => {
    const session = useAdminAuth.getState().session;
    if (!session) throw new Error("登录已失效，请重新登录后核对原操作。");
    const result = await submitHIRewardCommand(scope, { kind: "proposal", input: hiRewardProposal(session, op, values, before, after, reason) }, form, editValue);
    if (result.kind !== "proposal") throw new Error("原退役操作已取得回执，请刷新奖池核对后再修改。");
    await reloadH4Approvals();
    toast("已提交，等待审批后执行");
  };

  const wheelCommandBlocks = (op: string, tierName?: string) => {
    const pending = pendingHIRewardCommand(HI_WHEEL_SCOPE);
    if (!pending) return false;
    const original = pending.payload;
    if (original.kind === "proposal" && original.input.command.op === op
      && (!tierName || (original.input.command.params.values as Record<string, unknown>).tierName === tierName)) return false;
    const label = original.kind === "proposal" ? `${original.input.action} · ${String((original.input.command.params.values as Record<string, unknown>).tierName ?? original.input.obj)}`
      : `积分退役 · ${original.tierName}`;
    toast(`原操作「${label}」结果未知，请先在本页顶部查询原结果。`, "warn");
    return true;
  };

  const resumeH4Wheel = async () => {
    const pending = pendingHIRewardCommand(HI_WHEEL_SCOPE);
    if (!pending) return false;
    const result = await submitHIRewardCommand(HI_WHEEL_SCOPE, pending.payload);
    await reloadH4Approvals();
    if (result.kind === "retire") { apply(result.overview); toast("原退役操作已完成，积分奖项已退役。请用合法奖型把概率补足到 100%"); }
    else toast(result.ticket.status === "pending" ? "已提交，等待审批后执行" : "已查询到原审批单，请在操作记录核对执行状态");
    return true;
  };

  const localizedValue = (code: string, field: "name" | "description" | "rewardName", locale: LocaleCode) =>
    text(model?.contentLocales?.event?.[code]?.[locale]?.[field], "");
  const eventName = (id: string) => {
    const zh = text(model?.contentLocales?.event?.[id]?.zh?.name, "");
    return zh || text((model?.events ?? []).find((event) => event.id === id)?.name, id);
  };

  // ===== 既有活动 =====
  const openEventReward = (event: LegacyEvent) => {
    const current = text(event.reward);
    openActionConfirm({ briefKind: "config",
      action: `活动奖励 · ${event.name}`,
      title: "修改活动奖励",
      effect: effectByDirection,
      detail: <>当前奖励 <b>{current}</b>。填写新奖励后确认。</>,
      facts: <>
        <Facts><Fact k="活动">{eventName(event.id)}</Fact><Fact k="现在的奖励">{legacyName(current).text}{legacyName(current).legacy && <LegacyNameTag where="奖励文字" />}</Fact></Facts>
        <ApprovalFacts amplify="活动开放且在发奖时间内，换成别的资产或提高数量" direct="其他修改（只改文字、降低数量）" object="活动奖励" />
      </>,
      amplifies: true,
      confirmLabel: "提交修改",
      reasonPlaceholder: "例如：按运营排期调整奖励，工单号",
      getPendingReason: () => pendingHIRewardCommand(hiEventScope(event.id))?.payload.input.reason,
      edit: { kind: "text", current, initialValue: pendingHIRewardCommand(hiEventScope(event.id))?.editValue },
      run: async (reason, value) => {
        const scope = hiEventScope(event.id);
        const pending = pendingHIRewardCommand(scope);
        if (pending?.payload.kind === "proposal") {
          const result = await submitHIRewardCommand(scope, pending.payload);
          await reloadH4Approvals();
          toast(result.kind === "proposal" && result.ticket.status === "pending"
            ? "已提交，等待审批后执行" : "已查询到原审批单，请在操作记录核对执行状态");
          return;
        }
        if (!value) return;
        const preview = await previewH4EventReward(event.id, value, current, reason);
        if (preview.approvalRequired) {
          await proposeH4(scope, "h4_legacy_event_reward_update", { eventCode: event.id, value, expectedValue: current },
            preview.current, preview.proposed, reason, undefined, value);
          return;
        }
        apply(await updateH4EventReward(event.id, value, current, reason));
        toast(`${event.name} 奖励已更新`);
      },
    });
  };

  const missingFor = (event: LegacyEvent) => (["zh", "vi"] as const).flatMap((locale) =>
    (["name", "description", "rewardName"] as const).filter((field) => !localizedValue(event.id, field, locale)).map((field) => `${LOCALE_NAME[locale]}${FIELD_NAME[field]}`));

  /** 旧页面一个「上架 / 下架」框里选新状态；这里拆成「开放」「结束」两个入口，提交的状态值和旧框选中的一样。 */
  const openEventStatus = (event: LegacyEvent, value: "ongoing" | "ended") => {
    const missing = missingFor(event);
    const opening = value === "ongoing";
    openConfirm({ briefKind: "config",
      action: `活动状态 · ${event.name}`,
      title: opening ? "开放活动" : "结束活动",
      effect: opening ? effectByDirection : <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag /></>,
      detail: <>当前状态 <b>{lifecycleOf(event).label}</b>。</>,
      content: <>
        <Facts>
          <Fact k="活动">{eventName(event.id)}</Fact>
          <Fact k="状态"><Change from={lifecycleOf(event).label} to={opening ? "进行中" : "已结束"} /></Fact>
          {opening
            ? <Fact k="开放后">App 上的用户可以参加这个活动，按活动的奖励发放</Fact>
            : <Fact k="结束后">用户不能再参加；同时停掉这个活动的玩法、取消主推。已有的参与和奖励记录保留，结束后不能再开放</Fact>}
          {opening && <Fact k="要批准的">没有玩法规则、又有正奖励的旧活动开放时要另一位超级管理员批准，批准前活动不变；其他直接开放</Fact>}
        </Facts>
        {opening && missing.length > 0 && <Notice tone="warn" title={`还缺 ${missing.length} 项翻译，后端会拒绝开放`}>{missing.join("、")}。先在卡片底部的「三语内容」里补齐。</Notice>}
      </>,
      reason: true,
      okLabel: opening ? "开放活动" : "结束活动",
      confirmTone: opening ? undefined : "danger",
      reasonPlaceholder: opening ? "例如：活动素材已就绪，按排期开放" : "例如：活动到期，按排期结束",
      run: async (reason) => {
        apply(await updateH4EventStatus(event.id, value, event.state, reason));
        toast(`${event.name} 状态已更新`);
      },
    });
  };

  const openEventFeatured = (event: LegacyEvent) => {
    openConfirm({ briefKind: "record",
      action: `${event.featured ? "取消主推" : "设为主推"} · ${event.name}`,
      title: event.featured ? "取消主推" : "设为主推",
      effect: effectDirect,
      detail: <>同时只能有一个进行中的主推活动。</>,
      content: <Facts>
        <Fact k="活动">{eventName(event.id)}</Fact>
        <Fact k="主推"><Change from={event.featured ? "是" : "否"} to={event.featured ? "否" : "是"} /></Fact>
        <Fact k="影响">只改 App 首页先展示哪个活动，不发奖、不改奖励{event.featured ? "" : "；已经有别的主推活动时后端会拒绝，先取消那一个"}</Fact>
      </Facts>,
      reason: true,
      okLabel: event.featured ? "取消主推" : "设为主推",
      reasonPlaceholder: "例如：按运营排期调整首页主推",
      run: async (reason) => {
        apply(await updateH4EventFeatured(event.id, !Boolean(event.featured), Boolean(event.featured), reason));
        toast(`${event.name} 主推状态已更新`);
      },
    });
  };

  const openLocalizedContent = (code: string, field: "name" | "description" | "rewardName", locale: LocaleCode, source: string) => {
    const current = localizedValue(code, field, locale);
    openActionConfirm({ briefKind: "config",
      action: `编辑 ${locale.toUpperCase()} 内容 · ${source}`,
      title: `编辑${LOCALE_NAME[locale]}${FIELD_NAME[field]}`,
      effect: effectDirect,
      detail: <>这里填写 {locale.toUpperCase()} 文案；不填时 App 显示原文，不会自动翻译。</>,
      facts: <Facts><Fact k="活动">{eventName(code)}</Fact><Fact k="原文">{source || "—"}</Fact></Facts>,
      reasonPlaceholder: "例如：补齐上线前的翻译",
      edit: { kind: "text", current },
      run: async (reason, value) => {
        if (!value) return;
        apply(await updateH4LocalizedContent(code, field, locale, value, casExpected(current), reason));
        toast(`${source} ${locale.toUpperCase()} 文案已保存`);
      },
    });
  };

  const runEventDelete = async (eventId: string, expectedVersion: string, reason: string) => {
    if (!ctx.can("growth_h4_write")) throw new Error("你没有删除活动的权限。");
    try {
      apply(await deleteH4QuestEvent(eventId, expectedVersion, reason));
      toast("活动已删除，历史参与、奖励与操作记录保留");
    } finally { pendingDeleteChanged(value => value + 1); }
  };
  const openEventDelete = (event: LegacyEvent) => {
    if (!canModuleWrite || loading || error || !isDeletableQuestEvent(event)) return;
    openActionConfirm({ briefKind: "record",
      action: `删除活动 · ${event.name}`,
      title: "删除既有活动",
      effect: <IrreversibleTag />,
      detail: <>删除后活动从活动中心消失，已有的参与、奖励和操作记录仍保留。只能删除草稿或已结束的活动。</>,
      facts: <Facts><Fact k="活动">{eventName(event.id)}</Fact><Fact k="状态">{lifecycleOf(event).label}</Fact><Fact k="删除后">这个活动的玩法一起停掉；已有的参与、奖励和操作记录保留</Fact></Facts>,
      confirmLabel: "删除活动",
      confirmTone: "danger",
      reasonPlaceholder: "例如：草稿建错了，按工单删除",
      run: reason => runEventDelete(event.id, event.deleteVersion!, reason),
    });
  };

  const openCreateEvent = () => {
    openActionConfirm({ briefKind: "config",
      action: "新建活动",
      title: "新建既有活动",
      effect: <StatusTag tone="neutral" filled>建成预告，不开放</StatusTag>,
      detail: <>新建一个活动。活动 ID 用英文且不能重复；主推活动必须在进行中，且同时只能有一个。</>,
      content: <Notice tone="warn" title="目前只有内置活动可以开放">自定义编号的活动建好后暂时不能开放（后端只认九个内置活动编号，待办 H4-BE-01 已提）。建成后一律是「预告」、不主推，要开放还得在「七类玩法」里配好。</Notice>,
      amplifies: true,
      reasonPlaceholder: "例如：按运营排期登记新活动",
      businessForm: {
        kind: "multi-field",
        fields: [
          { key: "id", label: "活动编号", current: "", placeholder: "如 evt-summer", required: true, help: "英文字母、数字、_ 或 -，2–63 位，不能重复，建好后不能改" },
          { key: "name", label: "活动名", current: "", placeholder: "如 夏日狂欢", required: true },
          { key: "kind", label: "玩法", current: "discount", inputKind: "select", options: KIND_OPTIONS, optionLabels: Object.fromEntries(KIND_OPTIONS.map((kind) => [kind, KIND_LABEL(kind)])) },
          { key: "state", label: "状态", current: "ongoing", inputKind: "select", options: ["ongoing", "upcoming", "ended"], optionLabels: { ongoing: "进行中", upcoming: "预告", ended: "已结束" }, explain: "这一项照原样提交，但后端建成后一律是「预告」，不会因为选了「进行中」就开放。" },
          { key: "reward", label: "奖励", current: "", placeholder: "如 100 UVT", required: false, help: "没有玩法规则的活动只认正数的 UVT 或 USDT" },
          { key: "condition", label: "完成条件", current: "", placeholder: "如 order.paid", required: false },
          { key: "targetValue", label: "目标值", current: "", placeholder: "留空按 1", inputKind: "number", min: 1, max: 1_000_000_000, step: 1, required: false },
          { key: "geo", label: "地区", current: "", placeholder: "如 VN / GLOBAL", required: false },
          { key: "href", label: "App 跳转", current: "", placeholder: "如 /pages/store/store", required: false, help: "只能填 /pages/ 开头的页面" },
          { key: "trackable", label: "统计效果", current: "false", inputKind: "select", options: ["false", "true"], optionLabels: { false: "不统计", true: "统计参与、达标、领取" } },
          { key: "startsAt", label: "开始时间（UTC）", current: "", inputKind: "datetime-local", required: false },
          { key: "endsAt", label: "结束时间（UTC）", current: "", inputKind: "datetime-local", required: false, help: "要晚于开始时间" },
          { key: "featured", label: "设为主推", current: "false", inputKind: "select", options: ["false", "true"], optionLabels: { false: "否", true: "是" }, explain: "这一项照原样提交，但后端建成后一律不主推；开放以后再在卡片上设主推。" },
        ],
      },
      run: async (reason, _v, bv) => {
        if (!bv) return;
        const payload = {
          id: String(bv.id || "").trim(),
          name: String(bv.name || "").trim(),
          kind: bv.kind || "discount",
          state: bv.state || "ongoing",
          reward: String(bv.reward || "").trim(),
          condition: String(bv.condition || "").trim(),
          targetValue: bv.targetValue?.trim() ? Number(bv.targetValue) : 1,
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

  // ===== 转盘 =====
  const tierFacts = (tier: WheelTier) => <Facts>
    <Fact k="奖项">{text(tier.tier)}</Fact>
    <Fact k="奖品">{legacyName(tier.reward).text}{legacyName(tier.reward).legacy && <LegacyNameTag where="奖项名称" />}</Fact>
    <Fact k="概率">{percentText(tier.prob)}%（这里不改概率）</Fact>
  </Facts>;

  const openCreateWheelTier = () => {
    if (wheelCommandBlocks("h4_wheel_tier_create")) return;
    openActionConfirm({ briefKind: "config",
      action: "新建转盘奖项",
      title: "新建转盘奖项",
      effect: effectByDirection,
      detail: <>新建一个转盘奖项。概率填 0–100，所有奖项加起来要等于 100%。发真钱的奖项，覆盖率低于红线时无法保存。</>,
      facts: <ApprovalFacts amplify="新建 UVT 奖项，或概率大于 0 的 USDT、代金券奖项" direct="概率为 0 的 USDT、代金券奖项" object="奖池" />,
      amplifies: true,
      coverageLead: "这一档会让转盘多发奖",
      reasonPlaceholder: "例如：按活动方案新增一档奖品",
      getPendingReason: () => pendingHIRewardCommand(HI_WHEEL_SCOPE)?.payload.input.reason,
      getPendingBusinessValue: () => pendingHIRewardCommand(HI_WHEEL_SCOPE)?.form,
      businessForm: {
        kind: "multi-field",
        fields: [
          { key: "tierName", label: "奖项编号", current: "", placeholder: "如 uvt-100", required: true, help: "不能和已有奖项重复" },
          { key: "rewardName", label: "奖品名称", current: "", placeholder: "如 100 UVT", required: true, help: "App 抽中时显示这串文字，不影响发放" },
          { key: "rewardKind", label: "奖励类型", current: "uvt", inputKind: "select", options: ["uvt", "usdt", "coupon"], optionLabels: { uvt: "UVT", usdt: "USDT", coupon: "代金券" } },
          { key: "realOutflow", label: "是否发真钱", current: "0", inputKind: "select", options: ["0", "1"], optionLabels: { "0": "否", "1": "是" },
            warning: (value) => (value.rewardKind === "usdt") !== (value.realOutflow === "1") ? "USDT 奖项要选「是」，UVT 和代金券要选「否」，否则后端会拒绝" : undefined },
          { key: "rewardAmount", label: "每次发放数量", current: "", placeholder: "如 100", inputKind: "number", min: 0.000001, max: 1000000, step: 0.000001, required: true, help: "代金券每次发 1 张，这里照样填一个正数" },
          { key: "probabilityPct", label: "中奖概率（%）", current: "", placeholder: "0–100", inputKind: "number", min: 0, max: 100, step: 0.0001, required: true, help: "加上原有各档不能超过 100%；保存前要合计正好 100% 才能抽" },
          { key: "dailyStock", label: "每日库存", current: "", placeholder: "0 为不限", inputKind: "number", min: 0, max: 1000000, step: 1, required: true, help: "这一档每天最多发出几次，0 为不限" },
          { key: "voucherId", label: "代金券编号", current: "", placeholder: "如 WHEEL-50", required: false, visibleWhen: { key: "rewardKind", equals: "coupon" } },
        ],
      },
      run: async (reason, _v, bv) => {
        if (await resumeH4Wheel()) return;
        if (!bv) return;
        const probabilityPct = h4ProposalDecimal(bv.probabilityPct, "中奖概率（%）");
        const rewardAmount = h4ProposalDecimal(bv.rewardAmount, "实际发放数量");
        const dailyStock = Number(h4ProposalDecimal(bv.dailyStock, "每日总数量（0 为不限）"));
        if (Number(probabilityPct) < 0 || Number(probabilityPct) > 100) throw new Error("中奖概率须在 0–100% 之间");
        if (Number(rewardAmount) <= 0) throw new Error("实际发放数量须大于 0");
        if (!Number.isInteger(dailyStock) || dailyStock < 0 || dailyStock > 1000000) throw new Error("每日总数量须为 0–1000000 的整数（0 为不限）");
        const payload = {
          tierName: String(bv.tierName || "").trim(),
          rewardName: String(bv.rewardName || "").trim(),
          probabilityPct,
          realOutflow: bv.realOutflow === "1" ? 1 : 0,
          rewardKind: bv.rewardKind || "uvt",
          rewardAmount,
          voucherId: String(bv.voucherId || "").trim() || null,
          dailyStock,
        };
        if (!payload.tierName || !payload.rewardName) return;
        const expectedSignature = text(model?.wheelSignature, "__EMPTY__");
        const amplifies = payload.rewardKind === "uvt" || (["usdt", "coupon"].includes(payload.rewardKind)
          && Math.floor(Number(payload.probabilityPct) * 10000 + 0.5) > 0);
        if (amplifies) {
          await proposeH4(HI_WHEEL_SCOPE, "h4_wheel_tier_create", { ...payload, expectedSignature },
            JSON.stringify(model?.wheelTiers ?? []), JSON.stringify(payload), reason, bv);
          return;
        }
        apply(await createH4WheelTier(payload, expectedSignature, reason));
        toast(`奖项「${payload.tierName}」已新建`);
      },
    });
  };

  const openCreateWheelGuard = () => {
    openActionConfirm({ briefKind: "config",
      action: "新建转盘安全限制",
      title: "新建转盘护栏",
      effect: effectByDirection,
      detail: <>新建一条转盘安全限制。标识只能用小写英文字母，不能重复。</>,
      facts: <ApprovalFacts amplify="首次设正数预算，或首次开启真钱奖" direct="其他新建" object="转盘" />,
      reasonPlaceholder: "例如：上线前补齐转盘护栏",
      businessForm: {
        kind: "multi-field",
        fields: [
          { key: "guardKey", label: "护栏类型", current: "", inputKind: "select", mustChoose: true, options: ["budget", "kill"], optionLabels: { budget: "每日真钱奖预算", kill: "真钱奖发放开关" }, required: true, help: "每种只能有一条；各奖档每日库存由奖项自己的库存决定，不在这里建" },
          { key: "guardLabel", label: "名称", current: "", placeholder: "如 奖池预算", required: true },
          { key: "guardValue", label: "值", current: "", placeholder: "预算填数字（USDT），开关填 开 或 关", required: false },
          { key: "note", label: "备注", current: "", placeholder: "如 单日真钱奖上限", required: false },
        ],
      },
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

  const openWheelBudget = (guard: { key: string; label: string; value: string }) => {
    const current = text(guard.value);
    openActionConfirm({ briefKind: "config",
      action: `转盘安全限制 · 每日实际奖励预算（美元）`,
      title: "调整每日真钱奖预算",
      effect: effectByDirection,
      detail: <>当前值 <b>{current}</b>。如果别人刚改过，需要刷新后再改。</>,
      facts: <>
        <Facts><Fact k="现在">{amountText(budgetNumber(current))} USDT / 天</Fact><Fact k="怎么用">每次抽中真钱奖前，今天已发的真钱加上这一次超过预算，就改发 UVT 安慰奖</Fact></Facts>
        <ApprovalFacts amplify="调高预算" direct="调低预算" object="预算" />
      </>,
      amplifies: true,
      coverageLead: "调高预算会让转盘每天多发真钱",
      reasonPlaceholder: "例如：活动期放宽每日真钱奖预算",
      edit: { kind: "number", current: budgetNumber(current), min: 0.01, max: 1_000_000_000, step: 0.01, hint: "大于 0，最多两位小数，单位 USDT" },
      run: async (reason, value) => {
        if (!value) return;
        apply(await updateH4WheelGuard(guard.key, value, current, reason));
        toast("转盘安全限制「每日实际奖励预算（美元）」已更新");
      },
    });
  };

  const openWheelKill = (guard: { key: string; label: string; value: string }) => {
    const current = text(guard.value);
    const on = killOn(current);
    const next = on ? "关" : "开";
    openActionConfirm({ briefKind: "config",
      action: `转盘安全限制 · 实际奖品发放开关`,
      title: on ? "关闭真钱奖发放" : "开启真钱奖发放",
      effect: on ? effectDirect : effectApproval("开关"),
      detail: <>当前值 <b>{on ? "开" : "关"}</b>。如果别人刚改过，需要刷新后再改。</>,
      facts: <>
        <Facts>
          <Fact k="真钱奖发放"><Change from={on ? "开" : "关"} to={on ? "关" : "开"} /></Fact>
          <Fact k={on ? "关闭后" : "开启后"}>{on ? "抽中 USDT 奖项的用户改拿 UVT 安慰奖，转盘照常能抽；已经发出的奖不变" : "抽中 USDT 奖项的用户按预算和覆盖率拿真钱"}</Fact>
        </Facts>
        {!on && <ApprovalFacts amplify="从关到开" direct="从开到关" object="开关" />}
      </>,
      confirmLabel: on ? "关闭真钱奖" : "提交审批",
      confirmTone: on ? "danger" : undefined,
      reasonPlaceholder: on ? "例如：覆盖率告警，先停发真钱奖" : "例如：覆盖率恢复，重新开启真钱奖",
      run: async (reason) => {
        apply(await updateH4WheelGuard(guard.key, next, current, reason));
        toast("转盘安全限制「实际奖品发放开关」已更新");
      },
    });
  };

  const openWheelProbabilities = () => {
    if (wheelCommandBlocks("h4_wheel_probabilities_update")) return;
    const tiers = model?.wheelTiers ?? [];
    const fixed = tiers.filter(wheelPointsTier);
    const probabilityText = (tier: Record<string, unknown>, values: Record<string, string>) =>
      wheelPointsTier(tier) ? String(numericValue(tier.prob)) : values[text(tier.tier)] ?? "";
    const initial = pendingHIRewardCommand(HI_WHEEL_SCOPE)?.form
      ?? Object.fromEntries(tiers.filter((tier) => !wheelPointsTier(tier)).map((tier) => [text(tier.tier), String(numericValue(tier.prob))]));
    const store = formStore(initial);
    openActionConfirm({ briefKind: "config",
      action: "调整转盘奖项概率",
      title: "调整转盘概率",
      effect: effectByDirection,
      detail: <>一次设置所有奖项，加起来要等于 100%。调高发钱奖项的概率时，覆盖率低于红线无法保存。</>,
      facts: <ApprovalFacts amplify="调高了任一 UVT、USDT 或代金券奖项的概率（降低别的奖项不能抵消）" direct="不调高这三类奖项概率的修改" object="奖池" />,
      content: <ProbabilityCompare tiers={tiers} store={store} valueOf={probabilityText} />,
      amplifies: true,
      coverageLead: "调高中奖概率会让转盘多发奖",
      reasonPlaceholder: "例如：按活动方案调整各档概率",
      getPendingReason: () => pendingHIRewardCommand(HI_WHEEL_SCOPE)?.payload.input.reason,
      getPendingBusinessValue: () => pendingHIRewardCommand(HI_WHEEL_SCOPE)?.form,
      businessForm: {
        kind: "multi-field",
        onFieldChange: (_key, next) => { store.set(next); return next; },
        feedback: (values) => {
          const decimal = tiers.every((tier) => /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(probabilityText(tier, values).trim()));
          const total = tiers.reduce((sum, tier) => sum + Math.round(Number(probabilityText(tier, values)) * 10000), 0) / 10000;
          const invalid = !decimal || total !== 100;
          return { message: `概率合计 ${Number(total.toFixed(4))}%；${!decimal ? "概率请填写普通十进制数字，不支持科学计数法" : invalid ? "所有奖项的概率加起来必须等于 100%" : "合计符合 100% 要求"}。`, invalid };
        },
        hint: fixed.length
          ? `历史积分档只读：${fixed.map((tier) => `${text(tier.tier)} ${numericValue(tier.prob)}%`).join("、")}。所有奖项合计须为 100%。`
          : "所有奖项一起提交，加起来要等于 100%。",
        requireAnyChange: true,
        fields: tiers.filter((tier) => !wheelPointsTier(tier)).map((tier) => ({
          key: text(tier.tier),
          label: `${text(tier.tier)} · ${legacyName(tier.reward).text}`,
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
        if (await resumeH4Wheel()) return;
        if (!businessValue) return;
        const decimalProbabilities = Object.fromEntries(tiers.map((tier) => [
          text(tier.tier),
          h4ProposalDecimal(probabilityText(tier, businessValue), `${text(tier.tier)} 的中奖概率（%）`),
        ]));
        const probabilities = Object.fromEntries(Object.entries(decimalProbabilities).map(([tier, value]) => [tier, Number(value)]));
        const total = Object.values(probabilities).reduce((sum, value) => sum + value, 0);
        if (Math.round(total * 10000) !== 1000000) {
          throw new Error("所有奖项的概率加起来要等于 100%");
        }
        const amplifies = tiers.some(tier => ["uvt", "usdt", "coupon"].includes(text(tier.kind).toLowerCase())
          && probabilities[text(tier.tier)] > numericValue(tier.prob));
        if (amplifies) {
          await proposeH4(HI_WHEEL_SCOPE, "h4_wheel_probabilities_update", {
            probabilities: decimalProbabilities,
            expectedSignature: text(model?.wheelSignature, "__EMPTY__"),
          }, JSON.stringify(tiers), JSON.stringify(probabilities), reason, businessValue);
          return;
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

  const openEditWheelTier = (tier: WheelTier) => {
    const tierName = text(tier.tier);
    if (wheelCommandBlocks("h4_wheel_tier_update", tierName)) return;
    openActionConfirm({ briefKind: "config",
      action: `编辑转盘奖项 · ${tierName}`,
      title: "编辑转盘奖项",
      effect: effectByDirection,
      detail: <>编辑奖项名称、奖励类型、是否发真钱。概率请在「改奖池 / 概率」里统一调，保证加起来是 100%。</>,
      facts: <>{tierFacts(tier)}<ApprovalFacts amplify="换奖型、提高发放数量、放宽每日库存，或收紧 UVT 库存使安慰奖变多" direct="改名称和其他收紧的修改" object="奖池" /></>,
      amplifies: true,
      coverageLead: "这一档会让转盘多发奖",
      reasonPlaceholder: "例如：按活动方案调整这一档奖品",
      getPendingReason: () => pendingHIRewardCommand(HI_WHEEL_SCOPE)?.payload.input.reason,
      getPendingBusinessValue: () => pendingHIRewardCommand(HI_WHEEL_SCOPE)?.form,
      businessForm: {
        kind: "multi-field",
        requireAnyChange: true,
        fields: [
          { key: "rewardName", label: "奖项名称", current: text(tier.reward), inputKind: "text", required: true, showDiff: true },
          { key: "rewardKind", label: "奖励类型", current: tier.kind === "nex" ? "uvt" : text(tier.kind, "uvt"), inputKind: "select", options: ["uvt", "usdt", "coupon"], optionLabels: { uvt: "UVT", usdt: "USDT", coupon: "代金券" }, required: true, showDiff: true },
          { key: "realOutflow", label: "是否发真钱", current: boolValue(tier.real) ? "1" : "0", inputKind: "select", options: ["0", "1"], optionLabels: { "0": "否", "1": "是" }, required: true, showDiff: true,
            warning: (value) => (value.rewardKind === "usdt") !== (value.realOutflow === "1") ? "USDT 奖项要选「是」，UVT 和代金券要选「否」，否则后端会拒绝" : undefined },
          { key: "rewardAmount", label: "每次发放数量", current: String(numericValue(tier.amount)), inputKind: "number", min: 0.000001, max: 1000000, step: 0.000001, required: true, showDiff: true },
          { key: "voucherId", label: "代金券 ID", current: text(tier.voucherId, ""), inputKind: "text", required: true, visibleWhen: { key: "rewardKind", equals: "coupon" }, showDiff: true },
          { key: "dailyStock", label: "每日库存（0 = 不限）", current: String(numericValue(tier.dailyStock)), inputKind: "number", min: 0, max: 1000000, step: 1, required: true, showDiff: true },
        ],
      },
      run: async (reason, _value, bv) => {
        if (await resumeH4Wheel()) return;
        if (!bv) return;
        const rewardAmount = h4ProposalDecimal(bv.rewardAmount, "每次发放数量");
        const dailyStock = Number(h4ProposalDecimal(bv.dailyStock, "每日库存（0 为不限）"));
        if (!Number.isInteger(dailyStock) || dailyStock < 0 || dailyStock > 1000000) throw new Error("每日库存须为 0–1000000 的整数（0 为不限）");
        const payload = {
          tierName,
          rewardName: String(bv.rewardName || "").trim(),
          probabilityPct: numericValue(tier.prob),
          realOutflow: bv.realOutflow === "1" ? 1 : 0,
          rewardKind: bv.rewardKind || "uvt",
          rewardAmount,
          voucherId: bv.rewardKind === "coupon" ? String(bv.voucherId || "").trim() || null : null,
          dailyStock,
        };
        const expectedSignature = text(model?.wheelSignature, "__EMPTY__");
        const sameKind = payload.rewardKind.toLowerCase() === text(tier.kind).toLowerCase();
        const previousStock = numericValue(tier.dailyStock);
        const increasesAmount = Number(payload.rewardAmount) > (sameKind ? numericValue(tier.amount) : 0);
        const increasesStock = previousStock > 0 && (payload.dailyStock === 0 || payload.dailyStock > previousStock);
        const reducesUvtStock = sameKind && payload.rewardKind === "uvt" && payload.dailyStock > 0
          && (previousStock === 0 || payload.dailyStock < previousStock);
        const amplifies = ["uvt", "usdt", "coupon"].includes(payload.rewardKind)
          && (increasesAmount || increasesStock || (reducesUvtStock
            && increasesUvtFallback(model?.wheelTiers ?? [], tier, numericValue(tier.prob) > 0)));
        if (amplifies) {
          await proposeH4(HI_WHEEL_SCOPE, "h4_wheel_tier_update", { ...payload,
            probabilityPct: String(numericValue(tier.prob)), expectedSignature },
            JSON.stringify(tier), JSON.stringify(payload), reason, bv);
          return;
        }
        apply(await updateH4WheelTier(tierName, payload, expectedSignature, reason));
        toast(`奖项「${tierName}」已更新`);
      },
    });
  };

  const openDeleteWheelTier = (tier: WheelTier) => {
    const tierName = text(tier.tier);
    if (wheelCommandBlocks("h4_wheel_tier_delete", tierName)) return;
    const probability = numericValue(tier.prob);
    openActionConfirm({ briefKind: "record",
      action: `删除转盘奖项 · ${tierName}`,
      title: "删除转盘奖项",
      effect: <><StatusTag tone="progress" filled>多数立即生效</StatusTag><IrreversibleTag /></>,
      detail: probability === 0
        ? <>删除后至少还要保留 2 个奖项。</>
        : <>请先在「改奖池 / 概率」把这个奖项的概率调成 0%，再删除。</>,
      facts: <>{tierFacts(tier)}{probability === 0 && <ApprovalFacts amplify="删除后 UVT 安慰奖会变多" direct="其他删除" object="奖池" />}</>,
      confirmLabel: "删除奖项",
      confirmTone: "danger",
      reasonPlaceholder: "例如：这一档已下线，按工单删除",
      getPendingReason: () => pendingHIRewardCommand(HI_WHEEL_SCOPE)?.payload.input.reason,
      run: async (reason) => {
        if (await resumeH4Wheel()) return;
        if (probability !== 0) throw new Error("删除前请先把概率调成 0%");
        const amplifies = !boolValue(tier.real) && text(tier.kind).toLowerCase() === "uvt"
          && increasesUvtFallback(model?.wheelTiers ?? [], tier, false);
        if (amplifies) {
          await proposeH4(HI_WHEEL_SCOPE, "h4_wheel_tier_delete", { tierName, expectedSignature: text(model?.wheelSignature, "__EMPTY__") },
            JSON.stringify(tier), "删除档位", reason);
          return;
        }
        apply(await deleteH4WheelTier(
          tierName,
          text(model?.wheelSignature, "__EMPTY__"),
          reason,
        ));
        toast(`奖项「${tierName}」已删除`);
      },
    });
  };

  const openRetirePointsTier = (tier: WheelTier) => {
    const tierName = text(tier.tier);
    const pending = pendingHIRewardCommand(HI_WHEEL_SCOPE);
    if (pending && !(pending.payload.kind === "retire" && pending.payload.tierName === tierName) && wheelCommandBlocks("__retire__")) return;
    const probability = numericValue(tier.prob);
    const otherInvalid = (model?.wheelTiers ?? []).filter((row) => text(row.tier) !== tierName && !WHEEL_APP_KINDS.includes(text(row.kind).toLowerCase()));
    openActionConfirm({ briefKind: "record",
      action: `退役积分奖项 · ${tierName}`,
      title: "退役积分奖项",
      effect: <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag /></>,
      detail: <>停用积分奖项 <b>{tierName}</b>，并从奖池移除。</>,
      statedBrief: {
        impact: "这一档停用并从奖池移除，历史记录保留；不会换成别的奖品，也不会自动补概率。",
        check: "核对奖项名称和概率；退役后用合法奖型把概率补足到 100% 才能抽奖。",
      },
      facts: <>
        <Facts>
          <Fact k="退役哪一档">{tierName}（{legacyName(tier.reward).text}，概率 {percentText(tier.prob)}%）</Fact>
          <Fact k="为什么">后端已不支持积分奖型。奖池里只要还有这一档，App 抽奖会整池校验失败，用户抽不了</Fact>
          <Fact k="退役之后" tone="warn">奖池概率合计少 {percentText(probability)}%，要在「调整概率」里用 UVT、USDT 或代金券补足到 100%，App 才能抽奖；调高概率要提交审批单</Fact>
        </Facts>
        {otherInvalid.length > 0 && <Notice tone="warn" title="还要等后端">{otherInvalid.map((row) => text(row.tier)).join("、")} 的奖型是后端不认的旧名，这一步不处理，修好前 App 仍抽不了。</Notice>}
      </>,
      confirmLabel: "确认退役",
      confirmTone: "danger",
      reasonPlaceholder: "例如：积分奖型已下线，按工单停用这一档",
      getPendingReason: () => {
        const original = pendingHIRewardCommand(HI_WHEEL_SCOPE);
        return original?.payload.kind === "retire" ? original.payload.input.reason : undefined;
      },
      run: async (reason) => {
        if (await resumeH4Wheel()) return;
        const result = await retireH4PointsTier(tierName, text(model?.wheelSignature, "__EMPTY__"), reason);
        if (result.kind === "retire") apply(result.overview);
        toast(`积分奖项「${tierName}」已退役。请用合法奖型把概率补足到 100%`);
      },
    });
  };

  // ===== 结果未知、待审批 =====
  // 超过 24 小时的原操作只查原审批单、不重发：查询直接做，不经确认框。
  const lookupExpiredHICommand = async (record: HIRewardCommand) => {
    setLookupKey(record.commandKey);
    try {
      if (record.scope === HI_WHEEL_SCOPE) {
        await resumeH4Wheel();
        return;
      }
      const result = await submitHIRewardCommand(record.scope, record.payload);
      toast(result.kind === "proposal" && result.ticket.status === "pending"
        ? "已提交，等待审批后执行" : "已查询到原审批单，请在操作记录核对执行状态");
      void reloadH4Approvals();
    } catch (error) {
      toast(displayAdminError(error), "warn");
    } finally {
      setLookupKey("");
    }
  };

  const openResumeHICommand = (record: HIRewardCommand, subject: string) => {
    const expired = isRetryExpired(record);
    openActionConfirm({ briefKind: "record",
      action: `核对原操作 · ${subject}`,
      title: "查询原结果",
      detail: expired
        ? <>原操作已超过 24 小时，只查询原审批单，不会重发。</>
        : <>先按原请求查询；查不到才按原请求原样重发，不会重复执行。理由沿用原操作。</>,
      facts: <Facts><Fact k="原操作">{subject}</Fact><Fact k="提交时间">{formatTime(new Date(record.createdAt).toISOString(), "Asia/Shanghai")}（北京时间）</Fact><Fact k="原请求">内容和理由锁住，按原样查询或重试</Fact></Facts>,
      confirmLabel: expired ? "查询原审批单" : "查询原结果",
      getPendingReason: () => pendingHIRewardCommands().find((row) => row.commandKey === record.commandKey)?.payload.input.reason,
      run: async () => {
        if (record.scope === HI_WHEEL_SCOPE) {
          await resumeH4Wheel();
          return;
        }
        const result = await submitHIRewardCommand(record.scope, record.payload);
        toast(result.kind === "proposal" && result.ticket.status === "pending"
          ? "已提交，等待审批后执行" : "已查询到原审批单，请在操作记录核对执行状态");
        void reloadH4Approvals();
      },
    });
  };

  const hiRecords = pendingHIRewardCommands().filter((record) => record.scope.startsWith("H/"));
  const deleteRecords = pendingH4EventDeletes();
  const h4Pending = Array.isArray(h4Approvals) ? h4Approvals : [];
  const unknownCount = hiRecords.length + deleteRecords.length;
  const recovery = <>
    {unknownCount > 0 && <Notice tone="warn" title={`有 ${unknownCount} 个操作结果未知`} actionBelow action={<ul className="h4-pending">
      {hiRecords.map((record) => {
        const subject = hiCommandSubject(record, eventName);
        const expired = isRetryExpired(record);
        const retire = record.payload.kind === "retire";
        const allowed = record.scope === HI_WHEEL_SCOPE ? canWheelWrite : canModuleWrite;
        return <li key={record.commandKey}>
          <span className="h4-pending-what"><b>{subject}</b></span>
          <span className="h4-pending-when">提交于 <span className="h4-num">{formatTime(new Date(record.createdAt).toISOString(), "Asia/Shanghai")}</span>（北京时间）</span>
          {expired ? expiredTag() : unknownTag()}
          {expired && retire ? <Button size="sm" onClick={() => void reload()}>刷新奖池</Button>
            : <Button size="sm" disabledReason={!allowed ? "没有这项修改的权限" : lookupKey ? "正在查询" : undefined} loading={lookupKey === record.commandKey}
              onClick={() => expired ? void lookupExpiredHICommand(record) : openResumeHICommand(record, subject)}>{expired ? "查询原审批单" : "查询原结果"}</Button>}
        </li>;
      })}
      {deleteRecords.map((record) => <li key={record.commandKey}>
        <span className="h4-pending-what"><b>删除既有活动 · {eventName(record.eventId)}</b></span>
        <span className="h4-pending-when">提交于 <span className="h4-num">{formatTime(new Date(record.createdAt).toISOString(), "Asia/Shanghai")}</span>（北京时间）</span>
        {unknownTag()}
        <Button size="sm" disabledReason={!canModuleWrite ? "没有删除活动的权限" : undefined} onClick={() => openActionConfirm({ briefKind: "record",
          action: `查看删除结果 · ${record.eventId}`,
          title: "查询原结果",
          detail: <>查看上次删除是否成功，不会重复删除。</>,
          facts: <Facts><Fact k="原操作">删除既有活动 · {eventName(record.eventId)}</Fact><Fact k="原理由">{record.reason}</Fact><Fact k="怎么查">按原请求再发一次，后端认得出是同一次提交，不会重复删除；查完重新读取列表</Fact></Facts>,
          confirmLabel: "查询原结果",
          run: () => runEventDelete(record.eventId, record.expectedVersion, record.reason),
        })}>查询原结果</Button>
      </li>)}
    </ul>}>关闭或刷新页面不会重新提交。</Notice>}
    {(h4Pending.length > 0 || h4Approvals === "error") && <Notice tone="warn" title={h4Approvals === "error" ? "审批进度没有读到" : `${h4Pending.length} 项修改在等审批`} actionBelow
      action={h4Approvals === "error" ? <Button size="sm" onClick={() => void reloadH4Approvals()}>重试</Button> : <ul className="h4-pending">
        {h4Pending.map((row) => {
          const eventOp = REVIEW_OPERATION_BY_ACTION[row.action] === "h4_legacy_event_reward_update";
          return <li key={row.id}>
            <span className="h4-pending-what"><b>{row.action} · {eventOp ? eventName(row.obj) : "转盘奖池"}</b></span>
            <span className="h4-pending-when">{row.mine ? "你发起的" : "别人发起的"}</span>
            {pendingTag(eventOp ? "活动奖励" : "转盘奖池")}
            <a className="rd-link" href="/platform/audit">去操作记录与审批</a>
          </li>;
        })}
      </ul>}>
      {h4Approvals === "error" ? "看不到哪些修改在等批。" : "另一位超级管理员批准前，这些对象什么都不变，也不能再改。"}
    </Notice>}
  </>;

  if (loading && !model) return <>{recovery}<BlockState state="loading" title="正在加载既有活动与转盘" /></>;
  if (error || !model) return <>{recovery}<BlockState state="error" title="既有活动与转盘没有读到" detail={error ?? "没有收到数据，请重试；一直失败请联系值班同事。"} onRetry={() => void reload()} retryLabel="重试读取 · 既有活动与转盘" /></>;

  const events = model.events ?? [];
  const tiers = model.wheelTiers ?? [];
  const guards = model.wheelGuards ?? [];
  const h4Stats = model.h4Stats ?? {};
  const probabilitySum = tiers.reduce((sum, tier) => sum + numericValue(tier.prob), 0);
  const probabilityOk = Math.abs(probabilitySum - 100) < 0.001;
  const pointsTiers = tiers.filter(wheelPointsTier);
  const nexTiers = tiers.filter(wheelLegacyNexTier);
  const wheelBroken = pointsTiers.length > 0 || nexTiers.length > 0 || !probabilityOk;
  const legacyTierNames = tiers.filter((tier) => legacyName(tier.reward).legacy);
  const gapsByEvent = events.map((event) => ({ event, missing: missingFor(event) })).filter((row) => row.missing.length > 0);
  const gapCount = gapsByEvent.reduce((sum, row) => sum + row.missing.length, 0);
  const ruleOf = (id: string) => rules?.find((rule) => rule.eventCode === id);
  const wheelPending = h4Pending.some((row) => row.obj === "ACTIVE_POOL");
  const eventPending = (id: string) => h4Pending.some((row) => REVIEW_OPERATION_BY_ACTION[row.action] === "h4_legacy_event_reward_update" && row.obj === id);
  const notReady = (rules ?? []).filter((rule) => !rule.enabled && !rule.readiness.ready && !(rule.rulesLocked && rule.endsAt && Date.parse(rule.endsAt) <= Date.now()));
  const openRaffles = (raffles ?? []).filter((draw) => draw.status === "OPEN");
  const budget = guards.find((guard) => guard.key === "budget");
  const kill = guards.find((guard) => guard.key === "kill");
  const cap = guards.find((guard) => guard.key === "cap");
  const killState = kill ? killOn(text(kill.value, "")) : null;

  const go = (next: Sub, anchor?: string) => {
    setSub(next);
    if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }));
  };
  const todos: Array<{ key: string; tag: ReactNode; title: string; sub: string; onOpen: () => void }> = [
    ...(wheelBroken ? [{ key: "wheel", tag: <StatusTag tone="danger" icon={CircleAlert}>转盘抽不了</StatusTag>, title: "转盘奖池",
      sub: [pointsTiers.length ? `${pointsTiers.length} 档积分奖型要退役` : "", nexTiers.length ? `${nexTiers.length} 档旧奖型 nex 等后端修` : "", probabilityOk ? "" : `概率合计 ${percentText(probabilitySum)}%，要正好 100%`].filter(Boolean).join("；"),
      onOpen: () => go("wheel", "h4l-wheel") }] : []),
    ...(gapCount > 0 ? [{ key: "locale", tag: <StatusTag tone="warn">翻译没填</StatusTag>, title: `${gapsByEvent.length} 个既有活动`,
      sub: `${gapCount} 项中文、越南语内容没填，这些活动不能开放`, onOpen: () => go("events", "h4l-events") }] : []),
    ...(legacyTierNames.length > 0 ? [{ key: "nex", tag: <StatusTag tone="warn">旧名称</StatusTag>, title: "转盘奖项名称",
      sub: `${legacyTierNames.map((tier) => text(tier.tier)).join("、")} 的名称还写着 NEX，App 抽中时显示原文`, onOpen: () => go("wheel", "h4l-tiers") }] : []),
    ...(killState === false ? [{ key: "kill", tag: <StatusTag tone="warn">真钱奖已关</StatusTag>, title: "真钱奖发放开关",
      sub: "抽中 USDT 奖项的用户现在都改拿 UVT 安慰奖", onOpen: () => go("wheel", "h4l-guards") }] : []),
  ];

  const eventMenu = (event: LegacyEvent): MoreMenuItem[] => {
    const life = lifecycleOf(event);
    const ended = life.key === "ended";
    const wheelEvent = text(event.kind).toLowerCase() === "wheel";
    return [
      ...(!wheelEvent ? [{ key: "reward", label: "修改奖励", disabledReason: !canModuleWrite ? "没有修改既有活动的权限" : ended ? "已结束的活动不能改奖励" : undefined, onSelect: () => openEventReward(event) }]
        : [{ key: "wheel", label: "去转盘奖池改奖品", onSelect: () => go("wheel", "h4l-wheel") }]),
      ...(!ended && event.state === "ongoing" ? [{ key: "featured", label: event.featured ? "取消主推" : "设为主推", disabledReason: !canModuleWrite ? "没有修改既有活动的权限" : undefined, onSelect: () => openEventFeatured(event) }] : []),
      { key: "content", label: "三语内容与 App 上的样子", onSelect: () => setContentId(event.id) },
      ...(!ended && event.state !== "ended" ? [{ key: "end", label: "结束活动", danger: true, disabledReason: !canModuleWrite ? "没有修改既有活动的权限" : undefined, onSelect: () => openEventStatus(event, "ended") }] : []),
      { key: "delete", label: "删除", danger: true, disabledReason: !canModuleWrite ? "没有删除活动的权限" : !isDeletableQuestEvent(event) ? "只能删除草稿或已结束的活动" : undefined, onSelect: () => openEventDelete(event) },
    ];
  };
  const eventPrimary = (event: LegacyEvent) => {
    const life = lifecycleOf(event);
    if (life.key === "ended") return null;
    if (event.state === "upcoming") return <Button size="sm" disabledReason={!canModuleWrite ? "没有修改既有活动的权限" : undefined} onClick={() => openEventStatus(event, "ongoing")}>开放</Button>;
    return null;
  };
  const contentEvent = contentId ? events.find((event) => event.id === contentId) : undefined;
  const tabItems: PageTabItem<Sub>[] = [
    { value: "events", label: "既有活动", count: events.length },
    { value: "plays", label: "七类玩法", count: rules ? notReady.length || undefined : "—" },
    { value: "raffle", label: "创世抽奖", count: raffles ? openRaffles.length || undefined : "—" },
    { value: "wheel", label: "转盘奖池" },
  ];
  const conclusion = wheelBroken
    ? <Conclusion state="danger" lead icon={CircleAlert} hint="先处理「等你处理」第一行。">App 转盘现在抽不了{gapCount > 0 ? `，还有 ${gapsByEvent.length} 个活动缺翻译` : ""}</Conclusion>
    : todos.length > 0 ? <Conclusion state="warn" lead icon={ListChecks}>有 {todos.length} 件事等你处理</Conclusion>
    : <Conclusion state="ok" icon={ListChecks} explain="按这页读到的既有活动、转盘奖池和护栏判断；玩法和抽奖的状态在各自分段里。">{numericValue(h4Stats.ongoing)} 个既有活动进行中，转盘可以抽，没有等你处理的事</Conclusion>;

  return <div className="h4l">
    {recovery}
    {conclusion}
    <StatBand label="既有活动与转盘的关键数">
      <Stat label="进行中的既有活动" value={numericValue(h4Stats.ongoing)} unit="个" icon={CircleDot} tone="role-3" sub={`主推：${text(h4Stats.featuredEv, "--") === "--" ? "—" : text(h4Stats.featuredEv)}`} explain="按活动存的状态数「进行中」的个数（不看删除状态）。限地区的活动数后端没有提供；紧急处理去「紧急停用开关」。" />
      <Stat label="可追踪活动参与" value={numericValue(h4Stats.trackJoin)} unit="人次" icon={ListChecks} tone="role-3" sub={`达标 ${numericValue(h4Stats.trackDone)} · 已领 ${numericValue(h4Stats.trackClaim)}`} explain="开了「统计效果」的活动的参与、达标、领取次数合计，不是转化率。" />
      <Stat label="平均每次抽奖发出" value={text(model.wheelEvUsd, "") === "" ? "—" : amountText(text(model.wheelEvUsd))} unit="USDT" icon={Coins} tone="role-1" sub="只算发真钱的奖项" explain="后端按各档「金额 × 概率」逐档算到 6 位再相加、保留 2 位，是按概率的估算，不是实际发出的钱。" />
      <Stat label="今天转盘发出" value="—" icon={Disc3} tone="role-2" sub="后端没有提供" explain="后端读模型没有今天的抽奖和发奖数，这里画不出来，不当成 0。" />
    </StatBand>
    {todos.length > 0 && <Panel title="等你处理" icon={ListChecks} tone="role-3" sub={`${todos.length} 件`}>
      <ul className="h4-todo">{todos.map((todo) => <li key={todo.key}><button type="button" onClick={todo.onOpen}>{todo.tag}<span className="h4-todo-title">{todo.title}</span><span className="h4-todo-sub">{todo.sub}</span></button></li>)}</ul>
    </Panel>}
    <PageTabs level={2} label="既有活动与转盘分段" value={sub} items={tabItems} onChange={setSub} ids={tabIds} />

    <div role="tabpanel" id={tabIds.panelId("events")} aria-labelledby={tabIds.tab("events")} hidden={sub !== "events"} className="h4-tabpanel">
      <Panel id="h4l-events" title="既有活动" icon={Gift} tone="role-3" sub={`共 ${events.length} 个`}
        explain={<><p>平台内置的运营活动，一张卡一个：中文名称和说明、奖励、参与条件、时间、参与情况。卡底部改三语内容，右下角开放、结束、主推和删除。</p><p>同时只能有一个进行中的主推活动。时间来自「七类玩法」里这个活动的开放时间。</p></>}
        actions={<Button icon={<Plus size={14} aria-hidden />} disabledReason={!canModuleWrite ? "没有新建既有活动的权限" : undefined} onClick={openCreateEvent}>新建既有活动</Button>}>
        {gapCount > 0 && <Notice tone="warn" title={`有 ${gapCount} 项翻译没填，相关活动不能设为「进行中」`}>
          {gapsByEvent.slice(0, 6).map((row) => `${eventName(row.event.id)} 缺 ${row.missing.length} 项`).join("、")}{gapsByEvent.length > 6 ? ` 等 ${gapsByEvent.length} 个活动` : ""}。点卡片底部的「项翻译没填」逐格补齐。
        </Notice>}
        {events.length === 0 ? <BlockState state="empty" title="还没有既有活动" detail="点右上角「新建既有活动」登记一个。" />
          : <div className="h4-cards">{events.map((event) => <EventCard key={event.id} event={event}
            zh={{ name: localizedValue(event.id, "name", "zh"), description: localizedValue(event.id, "description", "zh"), rewardName: localizedValue(event.id, "rewardName", "zh") }}
            gaps={missingFor(event).length}
            rule={rules ? (() => { const rule = ruleOf(event.id); return rule ? { enabled: rule.enabled, ready: rule.readiness.ready, startsAt: rule.startsAt, endsAt: rule.endsAt } : null; })() : null}
            pending={eventPending(event.id) ? pendingTag("活动奖励") : undefined}
            primary={eventPrimary(event)} menu={eventMenu(event)} onContent={() => setContentId(event.id)} />)}</div>}
        <p className="h4l-note">时间为北京时间</p>
      </Panel>
    </div>

    <div role="tabpanel" id={tabIds.panelId("plays")} aria-labelledby={tabIds.tab("plays")} hidden={sub !== "plays"} className="h4-tabpanel">
      <H4EventRules ctx={ctx} onRowsChange={setRules} />
    </div>

    <div role="tabpanel" id={tabIds.panelId("raffle")} aria-labelledby={tabIds.tab("raffle")} hidden={sub !== "raffle"} className="h4-tabpanel">
      <H4GenesisRaffle ctx={ctx} onRowsChange={setRaffles} />
    </div>

    <div role="tabpanel" id={tabIds.panelId("wheel")} aria-labelledby={tabIds.tab("wheel")} hidden={sub !== "wheel"} className="h4-tabpanel">
      <Panel id="h4l-wheel" title="转盘奖池" icon={Disc3} tone="role-1" sub={`${tiers.length} 档 · 合计 ${percentText(probabilitySum)}%`}
        explain={<><p>每日免费抽奖和签到满 30 天的加抽共用这一个奖池。每次抽奖按各档概率依次落档。</p><p>App 每次抽奖前检查整个奖池：2–12 档，只认 UVT、USDT、代金券三种奖型，合计正好 100%，至少有一档不发真钱的 UVT 当安慰奖。有一项不合格，整个转盘报错。</p></>}
        actions={<>{wheelPending && pendingTag("转盘奖池")}<Button variant="primary" disabledReason={!canWheelWrite ? "没有修改转盘奖池的权限" : undefined} onClick={openWheelProbabilities}>调整概率</Button><Button icon={<Plus size={14} aria-hidden />} disabledReason={!canWheelWrite ? "没有修改转盘奖池的权限" : undefined} onClick={openCreateWheelTier}>新建奖项</Button></>}>
        {wheelBroken && <Notice tone="danger" title="App 转盘现在抽不了">
          {[pointsTiers.length ? `积分奖项 ${pointsTiers.map((tier) => text(tier.tier)).join("、")}：后端已不支持积分奖型，在下表点「退役」停用（不能撤销），再用合法奖型补足概率。` : "",
            nexTiers.length ? `${nexTiers.map((tier) => text(tier.tier)).join("、")}：奖型存成了旧名 nex，后端只认 uvt，已提后端修（BUG-426）。修好前这几档的「编辑」先关着：编辑保存会把奖型改成 UVT。` : "",
            probabilityOk ? "" : `现在概率合计 ${percentText(probabilitySum)}%，要在「调整概率」里补足到 100%；调高概率要提交审批单。`].filter(Boolean).map((line) => <p key={line}>{line}</p>)}
        </Notice>}
        <div className="h4l-wheel-figure">
          <WheelBar tiers={tiers} />
          <div className="h4l-wheel-foot"><WheelLegend /><span className="h4l-sum" data-tone={probabilityOk ? undefined : "danger"}>合计 <b className="h4-num">{percentText(probabilitySum)}%</b>{probabilityOk ? "" : " · 不等于 100%"}</span></div>
        </div>
        <div id="h4l-tiers">
          {tiers.length === 0 ? <BlockState state="empty" title="奖池里还没有奖项" detail="点「新建奖项」添加；至少 2 档才能抽。" /> : <Table label="转盘奖项">
            <thead><tr><Th>奖项</Th><Th>奖品</Th><Th>类型</Th><Th align="right">每次发放</Th><Th align="right">概率</Th><Th align="right">每 1000 次约中</Th><Th align="right">每日库存</Th><Th sticky="end">操作</Th></tr></thead>
            <tbody>{tiers.map((tier) => {
              const name = legacyName(tier.reward);
              const kindKey = text(tier.kind, "").toLowerCase();
              const unit = wheelUnit(tier);
              return <Tr key={text(tier.tier)}>
                <Td><span data-mono="">{text(tier.tier)}</span></Td>
                <Td><span className="h4l-reward">{name.text}{name.legacy && <LegacyNameTag where="奖项名称" />}</span></Td>
                <Td>{wheelPointsTier(tier) ? <StatusTag tone="danger" explain="后端已不支持积分奖型，要退役">积分奖型</StatusTag>
                  : wheelLegacyNexTier(tier) ? <StatusTag tone="warn" explain="奖型存成了旧名 nex，后端只认 uvt，等后端修数据（BUG-426）">UVT · 旧奖型</StatusTag>
                  : <span className="h4l-kind">{WHEEL_KIND_LABEL[kindKey] ?? "其他奖励"}{boolValue(tier.real) && <StatusTag tone="warn" explain="这一档发真钱（USDT）：抽中前还要过真钱奖开关、覆盖率和每日预算，不过就改发 UVT 安慰奖。">发真钱</StatusTag>}</span>}</Td>
                <Td align="right">{kindKey === "coupon" ? <span>1 张<small className="h4-dim"> · {text(tier.voucherId, "未配券")}</small></span> : <span className="h4-num">{amountText(text(tier.amount, ""))} {unit}</span>}</Td>
                <Td align="right"><b className="h4-num">{percentText(tier.prob)}%</b></Td>
                <Td align="right"><span className="h4-num">{percentText(numericValue(tier.prob) * 10)}</span> 次</Td>
                <Td align="right">{numericValue(tier.dailyStock) === 0 ? <span className="h4-dim">不限</span> : <span className="h4-num">{numericValue(tier.dailyStock)} 次</span>}</Td>
                <Td sticky="end" data-fit=""><span className="h4-row h4l-ops">{wheelPointsTier(tier)
                  ? <Button size="sm" variant="danger-outline" aria-label={`退役 ${text(tier.tier)}（${name.text}）`} disabledReason={!canWheelWrite ? "没有修改转盘奖池的权限" : undefined} onClick={() => openRetirePointsTier(tier)}>退役</Button>
                  : <>
                    <Button size="sm" aria-label={`编辑 ${text(tier.tier)}（${name.text}）`} disabledReason={!canWheelWrite ? "没有修改转盘奖池的权限" : wheelLegacyNexTier(tier) ? "这一档的奖型是旧名 nex，编辑保存会把它改成 UVT；等后端修正数据（BUG-426）后再编辑" : undefined} onClick={() => openEditWheelTier(tier)}>编辑</Button>
                    <Button size="sm" icon={<Trash2 size={13} aria-hidden />} aria-label={`删除 ${text(tier.tier)}（${name.text}）`} disabledReason={numericValue(tier.prob) !== 0 ? "先把概率调成 0%" : !canWheelWrite ? "没有修改转盘奖池的权限" : undefined} onClick={() => openDeleteWheelTier(tier)}>删除</Button>
                  </>}</span></Td>
              </Tr>;
            })}</tbody>
          </Table>}
          <p className="h4l-note">「每 1000 次约中」按概率估算，不计库存用完和改发安慰奖<Explain label="改发安慰奖是什么" content="每次抽奖先按概率落档；这一档今天库存用完，或是真钱奖而开关关着、覆盖率不够、今天预算不够时，改发排在最前、还有库存的那一档不发真钱的 UVT。" /></p>
        </div>
      </Panel>
      <Panel id="h4l-guards" title="资金护栏" icon={Wallet} tone="role-1" sub={`${guards.length} 条`}
        explain="护栏保护平台的钱：真钱奖要同时过开关、覆盖率和每日预算才发出，不过就改发 UVT 安慰奖。调高预算、开启真钱奖要另一位超级管理员批准；调低、关闭立即生效。"
        actions={<Button icon={<Plus size={14} aria-hidden />} disabledReason={!canWheelWrite ? "没有修改转盘奖池的权限" : undefined} onClick={openCreateWheelGuard}>新建护栏</Button>}>
        {guards.length === 0 ? <BlockState state="empty" title="还没有护栏" detail="没有预算或开关时真钱奖一律改发 UVT 安慰奖。" /> : <div className="h4l-guards">
          {kill && <GuardCard title={GUARD_NAME.kill} icon={<Power size={14} aria-hidden />} value={killState ? "开" : "关"} valueTone={killState ? "ok" : "danger"}
            sub={killState ? "抽中 USDT 奖项按预算和覆盖率发真钱" : "抽中 USDT 奖项的用户改拿 UVT 安慰奖"}
            explain="关掉后不再发真钱奖，转盘照常能抽。从关到开要另一位超级管理员批准。"
            action={<Button size="sm" variant={killState ? "danger-outline" : undefined} disabledReason={!canWheelWrite ? "没有修改转盘奖池的权限" : undefined} onClick={() => openWheelKill(kill)}>{killState ? "关闭" : "开启"}</Button>} />}
          {budget && <GuardCard title={GUARD_NAME.budget} icon={<Wallet size={14} aria-hidden />} value={<><span className="h4-num">{amountText(budgetNumber(text(budget.value, "")))}</span><small>USDT / 天</small></>}
            sub={<>今天已发 <span className="h4-dim">—</span>，后端没有提供，画不出用了多少</>}
            explain="每次抽中真钱奖前，今天已发的真钱加上这一次超过预算，就改发 UVT 安慰奖。后端按美元记，真钱奖只有 USDT。"
            action={<Button size="sm" disabledReason={!canWheelWrite ? "没有修改转盘奖池的权限" : undefined} onClick={() => openWheelBudget(budget)}>调整</Button>} />}
          {cap && <GuardCard title={GUARD_NAME.cap} icon={<Ticket size={14} aria-hidden />} value={<small>按各档的每日库存</small>}
            sub={`${tiers.filter((tier) => numericValue(tier.dailyStock) > 0).length} 档限量，其余不限`}
            explain="每天每档最多发几次由奖项表的「每日库存」决定，这一条只是历史记录，不能改。" action={<StatusTag tone="neutral">历史只读</StatusTag>} />}
          {guards.filter((guard) => !["budget", "kill", "cap"].includes(guard.key)).map((guard) => <GuardCard key={guard.key} title={text(guard.label)} icon={<Gift size={14} aria-hidden />} value={text(guard.value)} explain="后端返回了这页不认识的护栏，只显示，不提供修改。" />)}
        </div>}
      </Panel>
    </div>

    <Drawer open={!!contentEvent} onClose={() => setContentId(null)} title="三语内容与 App 上的样子" sub={contentEvent?.id} wide
      explain="改一格保存一格，下次读取 App 就用新内容，不用发布。中文和越南语的名称、说明、奖项名都填齐，活动才能开放；英文没填时 App 用原文。">
      {contentEvent && <EventPreview canEdit={canModuleWrite}
        names={Object.fromEntries((["zh", "en", "vi"] as const).map((locale) => [locale, { name: localizedValue(contentEvent.id, "name", locale), description: localizedValue(contentEvent.id, "description", locale), rewardName: localizedValue(contentEvent.id, "rewardName", locale) }])) as Record<LocaleCode, Record<"name" | "description" | "rewardName", string>>}
        original={{ name: text(contentEvent.name, ""), description: text(contentEvent.description, ""), rewardName: text(contentEvent.rewardName, "") }}
        onEdit={(field, locale) => openLocalizedContent(contentEvent.id, field, locale, field === "name" ? contentEvent.name : field === "description" ? text(contentEvent.description) : text(contentEvent.rewardName))} />}
    </Drawer>
  </div>;
}
