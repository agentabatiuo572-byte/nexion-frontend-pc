"use client";

/**
 * H4 活动中心「既有活动与转盘」页签（第二部分）：既有活动、七类玩法、创世抽奖、转盘奖池与护栏。
 * 既有表单保留；H4 写入由共享命令层保存原请求、分流审批并恢复。
 */
import type { BusinessFormValue } from "../design-kit";
import { useHConflictDraft } from "@/lib/admin/use-h-conflict-draft";
import { isHGrowthReadConflict } from "@/lib/admin/h-write-conflict";
import { HApprovalRequired } from "@/lib/admin/h-approval-required";
import { isValidElement, useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleDot, Coins, Disc3, Gift, ListChecks, Plus, Power, Ticket, Trash2, Wallet } from "lucide-react";
import {
  BlockState, Button, Change, Drawer, Conclusion, Explain, Fact, Facts, Fold, IrreversibleTag, Notice, Panel, RatioBar, ReleaseModal, Stat, StatBand, StatusTag,
  Table, Td, Th, Tr, type MoreMenuItem,
} from "@/app/components/rd";
import { fetchA2Overview, type A2OperationRow } from "@/lib/admin/a2-client";
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
  createH4WheelTier,
  updateH4WheelProbabilities,
  updateH4WheelTier,
  deleteH4WheelTier,
  createH4WheelGuard,
  updateH4WheelGuard,
} from "@/lib/admin/h-client";
import type { H4Statistics } from "@/lib/admin/h4-statistics";
import { fetchH4WheelDailyUsage, type H4WheelDailyUsage } from "@/lib/admin/h4-daily-usage";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { HI_WHEEL_SCOPE, hiEventScope, hiRewardProposal, pendingHIRewardCommand } from "@/lib/admin/hi-reward-commands";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { isDeletableQuestEvent } from "@/lib/admin/activity-delete";
import { H4_EVENT_RULE_CODES, type EventRuleView } from "@/lib/admin/event-rules-client";
import type { AdminRaffle } from "@/lib/admin/genesis-raffle-client";
import type { HCtx, ActionConfirmReq, ConfirmReq } from "./types";
import { H4_APPROVAL_OPS, h4Scope, assertH4Fresh, h4ReadVersion, h4PendingFor, h4Blocked, h4ApprovalPending, h4ApprovalLockedReason, h4TicketObservations, replaceH4TicketObservations, h4CommandHasPendingTicket, pendingH4Commands, submitH4Proposal, queryH4Command, retryH4Command, canRetryH4Command, releaseExpiredH4Proposal, h4CommandRequest, isH4ApprovalReceipt, confirmedH4Saves, type H4Command } from "@/lib/admin/h4-mutations";
import { hApprovalReconfirm } from "./h-approval-reconfirm";
import H4EventRules from "./h4-event-rules";
import H4GenesisRaffle from "./h4-genesis-raffle";
import { amountText, formatTime } from "./h4-promotion-ui";
import {
  ApprovalFact, EventCard, EventPreview, GuardCard, KIND_LABEL, KIND_OPTIONS, LOCALE_NAME, FIELD_NAME, LegacyNameTag, ProbabilityCompare,
  WHEEL_APP_KINDS, WHEEL_KIND_LABEL, WheelBar, WheelLegend, boolValue, casExpected, effectApproval, effectByDirection, effectDirect, expiredTag, formStore,
  legacyName, lifecycleOf, numericValue, pendingTag, percentText, text, unknownTag, wheelLegacyNexTier, wheelPointsTier, wheelUnit,
  type LegacyEvent, type LocaleCode, type WheelTier,
} from "./h4-legacy-parts";

type Model = H4Statistics & {
  events?: LegacyEvent[];
  contentLocales?: Record<string, Record<string, Record<string, Record<string, string>>>>;
  wheelTiers?: WheelTier[];
  wheelSignature?: string;
  wheelGuards?: Array<{ key: string; label: string; value: string; note?: string }>;
  trackables?: Array<{ id: string; name: string; cond: string; join: string; done: string; claim: string; geo: string }>;
};

const GUARD_NAME: Record<string, string> = { budget: "每日真钱奖预算", cap: "各奖档每日库存", kill: "真钱奖发放开关" };
const killOn = (value: string) => ["1", "true", "on", "enabled", "open", "开"].includes(value.trim().toLowerCase());
const budgetNumber = (value: string) => value.replace(/[$,\s]/g, "");
/** 今天还剩多少预算：两个十进制串按位相减，不经浮点、不舍入。只用于显示。 */
const decimalMinus = (left: string, right: string) => {
  if (!/^\d+(\.\d+)?$/.test(left) || !/^\d+(\.\d+)?$/.test(right)) return null;
  const places = Math.max(...[left, right].map((value) => (value.split(".")[1] ?? "").length));
  const scaled = (value: string) => { const [whole, fraction = ""] = value.split("."); return BigInt(whole + fraction.padEnd(places, "0")); };
  const diff = scaled(left) - scaled(right);
  const digits = (diff < BigInt(0) ? -diff : diff).toString().padStart(places + 1, "0");
  return `${diff < BigInt(0) ? "-" : ""}${places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits}`;
};
const USAGE_DAY = "按 UTC 日统计，北京时间每天早上 8 点换日。";
/** 今天实际发出按奖型分行：USDT 是真钱，UVT 和代金券只给笔数。 */
const AWARD_ASSET: Record<string, { label: string; noMoney?: string }> = {
  USDT: { label: "USDT 真钱奖" },
  UVT: { label: "UVT（含安慰奖）", noMoney: "UVT 不算真钱，只记笔数" },
  NEX: { label: "UVT · 旧名称", noMoney: "UVT 不算真钱，只记笔数" },
  COUPON: { label: "代金券", noMoney: "券不是钱，只记张数" },
};

/** 原操作写成一句「做什么 · 对哪一项」，不露命令号和对象键。 */
/** 审批申请按操作写动词；后端登记的 action 是一类操作的统称，不够具体。 */
const H4_OP_VERB: Record<string, string> = {
  h4_legacy_event_reward_update: "修改活动奖励", h4_legacy_event_open: "开放活动", h4_event_rule_enable: "开启玩法", h4_genesis_raffle_open: "开放抽奖报名",
  h4_wheel_guard_create: "新建转盘护栏", h4_wheel_guard_update: "调整转盘护栏", h4_wheel_tier_create: "新建转盘奖项", h4_wheel_tier_update: "编辑转盘奖项",
  h4_wheel_tier_delete: "删除转盘奖项", h4_wheel_probabilities_update: "调整转盘概率",
};
const H4_EVENT_FIELD: Record<string, string> = { reward: "活动奖励", status: "活动状态", featured: "活动主推", content: "三语内容" };

function hiCommandSubject(record: H4Command, eventName: (id: string) => string) {
  if (!("proposal" in record.request)) {
    const guard = /^\/quest-events\/wheel-guards\/([^/]+)$/.exec(record.request.path);
    if (guard) return `转盘护栏 · ${GUARD_NAME[decodeURIComponent(guard[1])] ?? decodeURIComponent(guard[1])}`;
    const rule = /^\/event-rules\/([^/]+)$/.exec(record.request.path);
    if (rule) return `保存玩法配置 · ${eventName(decodeURIComponent(rule[1]))}`;
    const event = /^\/quest-events\/events\/([^/]+)\/(reward|status|featured|content)(?:\/|$)/.exec(record.request.path);
    return event ? `${H4_EVENT_FIELD[event[2]]} · ${eventName(decodeURIComponent(event[1]))}` : record.action;
  }
  const input = record.request.proposal, values = input.command.params.values as Record<string, unknown>;
  const guardKey = values.guardKey === undefined ? undefined : String(values.guardKey);
  return `${H4_OP_VERB[input.command.op] ?? input.action} · ${String(values.eventCode ? eventName(String(values.eventCode)) : values.tierName ?? (guardKey && (GUARD_NAME[guardKey] ?? guardKey)) ?? values.id ?? "转盘奖池")}`;
}

/** 原记录里存的改动，写成「从多少到多少」。只读保存的原请求，不拿现在读到的数据补。 */
function hiCommandChange(record: H4Command): string | undefined {
  const plain = (value: unknown) => value === undefined || value === null || value === "" ? "—" : legacyName(value).text;
  const guard = (key: unknown, from: unknown, to: unknown) => key === "kill" ? `${killOn(String(from ?? "")) ? "开" : "关"} → ${killOn(String(to ?? "")) ? "开" : "关"}`
    : key === "budget" ? `${from === undefined ? "—" : amountText(budgetNumber(String(from)))} → ${amountText(budgetNumber(String(to ?? "")))} USDT / 天` : `${plain(from)} → ${plain(to)}`;
  const tier = (v: Record<string, unknown>) => `概率 ${plain(v.probabilityPct)}% · 每次 ${plain(v.rewardAmount)} ${WHEEL_KIND_LABEL[String(v.rewardKind ?? "").toLowerCase()] ?? ""}`.trim();
  const probabilities = (map: unknown) => Object.entries((map ?? {}) as Record<string, unknown>).map(([name, pct]) => `${name} ${plain(pct)}%`).join(" · ");
  if ("proposal" in record.request) {
    const v = record.request.proposal.command.params.values as Record<string, unknown>;
    switch (record.request.proposal.command.op) {
      case "h4_legacy_event_reward_update": return `${plain(v.expectedValue)} → ${plain(v.value)}`;
      case "h4_legacy_event_open": return "预告 → 开放";
      case "h4_event_rule_enable": return "关闭 → 第一次开启";
      case "h4_genesis_raffle_open": return "草稿 → 开放报名";
      case "h4_wheel_guard_update": return guard(v.guardKey, v.expectedValue, v.value);
      case "h4_wheel_guard_create": return guard(v.guardKey, undefined, v.guardValue).replace(/^.*→ /, "新建：");
      case "h4_wheel_tier_create": return `新建：${tier(v)}`;
      case "h4_wheel_tier_update": return `改成：${tier(v)}`;
      case "h4_wheel_tier_delete": return "删除这一档";
      case "h4_wheel_probabilities_update": return probabilities(v.probabilities);
      default: return undefined;
    }
  }
  const { path, method } = record.request;
  if (path.startsWith("/media/uploads?")) {
    const target = record.uploadTarget;
    const place = !target ? "" : target.kind === "banner" ? ` · 原活动 v${target.version} 草稿` : " · 原奖励的处置证据";
    try { return `文件 ${String(JSON.parse(record.request.body).fileName ?? "—")}${place}`; } catch { return undefined; }
  }
  let b: Record<string, unknown>;
  try { b = JSON.parse(record.request.body); } catch { return undefined; }
  if (path.startsWith("/quest-events/wheel-guards/")) return guard(decodeURIComponent(path.split("/")[3]), b.expectedValue, b.value);
  if (path === "/quest-events/wheel-guards") return guard(b.guardKey, undefined, b.guardValue).replace(/^.*→ /, "新建：");
  if (path === "/quest-events/wheel-tiers/probabilities") return probabilities(b.probabilities);
  if (path.startsWith("/quest-events/wheel-tiers")) return method === "DELETE" ? "删除这一档" : `${method === "POST" ? "新建" : "改成"}：${tier(b)}`;
  if (/\/featured$/.test(path)) return String(b.value) === "true" ? "设为主推" : "取消主推";
  if (/\/status$/.test(path)) return `→ ${b.value === "ongoing" ? "开放" : b.value === "ended" ? "结束" : plain(b.value)}`;
  if (/\/reward$/.test(path) || path.includes("/content/")) return `${plain(b.expectedValue === "__MISSING__" ? "" : b.expectedValue)} → ${plain(b.value)}`;
  return undefined;
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

export type LegacySection = "events" | "plays" | "wheel";

/** 输入框不带单位（共用改值框放不下长单位）、再确认里要写单位的改值框，按标题给单位，只用于显示。 */
const RECONFIRM_UNIT: Record<string, string> = { 调整每日真钱奖预算: "USDT / 天" };

export default function H4LegacyCenter({ ctx, section: sub, onSection }: { ctx: HCtx; section: LegacySection; onSection: (section: LegacySection) => void }) {
  const { toast } = ctx;
  const adminId = useAdminAuth(state => state.session?.adminId);
  const activeRecovery = useRef<string | null>(null);
  /** 直接保存被判定要走审批：换成审批确认，值和理由沿用（H-改走审批）。 */
  const approvalReconfirm = (error: HApprovalRequired, req: ActionConfirmReq | ConfirmReq, reason: string, value?: string, businessValue?: BusinessFormValue) => {
    const edit = "edit" in req ? req.edit : undefined;
    const facts = "facts" in req ? typeof req.facts === "function" ? req.facts(value) : req.facts : "content" in req ? req.content : undefined;
    const fields = "businessForm" in req && req.businessForm?.kind === "multi-field" ? req.businessForm.fields : [];
    const creating = (error.input as { method: string }).method === "POST";
    const before = Object.fromEntries(fields.map(field => [field.key, field.current]));
    const unit = (key: string, values: Record<string, string | undefined>) => key === "probabilityPct" ? "%"
      : key === "rewardAmount" ? values.rewardKind === "coupon" ? "张" : wheelUnit({ kind: values.rewardKind })
      : key === "guardValue" && values.guardKey === "budget" ? "USDT / 天" : undefined;
    const changes = businessValue && !(isValidElement(facts) && facts.type === ProbabilityCompare) ? fields.filter(field => !field.key.startsWith("__")).map(field => ({ key: field.key, label: field.label, labels: field.optionLabels,
      before: creating ? null : field.current ?? null, after: businessValue[field.key] ?? null,
      beforeUnit: creating ? undefined : unit(field.key, before), afterUnit: unit(field.key, businessValue),
      // 代金券不管填多少，每次只发 1 张（AppGrowthWheelService.award）。
      ...(field.key === "rewardAmount" && !creating && before.rewardKind === "coupon" ? { beforeShown: "1 张" } : {}),
      ...(field.key === "rewardAmount" && businessValue.rewardKind === "coupon" ? { afterShown: "1 张" } : {}),
    })) : undefined;
    return hApprovalReconfirm(error, { changes,
      hasPending: () => !!h4PendingFor(h4Scope((error.input as { path: string }).path, JSON.parse((error.input as { body: string }).body))),
      onUnknown: () => ctx.closeConfirm?.(), action: req.action, title: req.title, reason, approver: "另一位超级管理员", holds: creating ? "现有配置" : "这一项",
      change: edit && value !== undefined ? (unit => <Change from={`${edit.current || "—"}${unit ? ` ${unit}` : ""}`} to={`${value}${unit ? ` ${unit}` : ""}`} />)(edit.unit ?? RECONFIRM_UNIT[String(req.title)]) : undefined,
      // 有逐项改动时不再放原框的「现在」事实；只有改已有一项时补一行对象（目前是转盘奖项编辑）。
      context: edit || changes ? undefined : facts,
      subject: changes && !creating && typeof req.action === "string" && req.action.includes(" · ") ? <Fact k="奖项">{req.action.slice(req.action.indexOf(" · ") + 3)}</Fact> : undefined,
      completed: async result => { await apply(result); } });
  };
  const openActionConfirm = (req: ActionConfirmReq) => {
    const version = h4ReadVersion("overview");
    let retained: H4Command | undefined;
    ctx.openActionConfirm(conflictDraft.action({ ...req,
      blockedReason: req.blockedReason ?? (version === undefined ? displayAdminError(new Error("H4_REFRESH_REQUIRED")) : undefined),
      getPendingReason: () => retained && pendingH4Commands().some(r => r.commandKey === retained!.commandKey) ? retained.reason : undefined,
      run: async (reason, value, businessValue) => {
        if (retained && pendingH4Commands().some(r => r.commandKey === retained!.commandKey)) {
          try { if (!retained.acknowledged) await retryH4Command(retained); }
          finally { if (!pendingH4Commands().some(r => r.commandKey === retained!.commandKey)) ctx.openActionConfirm(null); await reloadH4Approvals(); await reload(); }
          return;
        }
        assertH4Fresh("overview", version);
        const before = new Set(pendingH4Commands().map(r => r.commandKey));
        setStale(null);
        try { await req.run(reason, value, businessValue); }
        catch (cause) {
          if (cause instanceof HApprovalRequired) { ctx.openActionConfirm(null); ctx.openConfirm(approvalReconfirm(cause, req, reason, value, businessValue)); return; }
          if (isHGrowthReadConflict(cause)) { setStale(typeof req.title === "string" ? req.title : typeof req.action === "string" ? req.action : "这次修改"); ctx.openActionConfirm(null); await reload(); }
          throw cause;
        }
        finally { retained = pendingH4Commands().find(r => !before.has(r.commandKey)); }
      },
    }));
  };
  const openConfirm = (req: ConfirmReq) => {
    const version = h4ReadVersion("overview");
    let retained: H4Command | undefined;
    ctx.openConfirm(conflictDraft.confirm({ ...req, freezePendingInput: true,
      getPendingBlockReason: () => req.getPendingBlockReason?.() ?? (version === undefined ? displayAdminError(new Error("H4_REFRESH_REQUIRED")) : undefined),
      getPendingReason: () => retained && pendingH4Commands().some(r => r.commandKey === retained!.commandKey) ? retained.reason : undefined,
      run: async (reason, value) => {
        if (retained && pendingH4Commands().some(r => r.commandKey === retained!.commandKey)) {
          try { if (!retained.acknowledged) await retryH4Command(retained); }
          finally { if (!pendingH4Commands().some(r => r.commandKey === retained!.commandKey)) ctx.closeConfirm?.(); await reloadH4Approvals(); await reload(); }
          return;
        }
        assertH4Fresh("overview", version);
        const before = new Set(pendingH4Commands().map(r => r.commandKey));
        setStale(null);
        try { return await req.run(reason, value); }
        catch (cause) {
          // 返回 false：原确认框不自己关，换成审批确认。
          if (cause instanceof HApprovalRequired) { ctx.openConfirm(approvalReconfirm(cause, req, reason, value)); return false; }
          if (isHGrowthReadConflict(cause)) { setStale(typeof req.title === "string" ? req.title : typeof req.action === "string" ? req.action : "这次修改"); ctx.closeConfirm?.(); await reload(); }
          throw cause;
        }
        finally { retained = pendingH4Commands().find(r => !before.has(r.commandKey)); }
      },
    }));
  };
  const canModuleWrite = ctx.can("growth_h4_write");
  const canWheelWrite = ctx.can("growth_h4_wheel_pool_write");
  const [, pendingDeleteChanged] = useState(0);
  useEffect(() => { const changed = () => pendingDeleteChanged(v => v + 1); window.addEventListener("admin-h4-pending-changed", changed); return () => window.removeEventListener("admin-h4-pending-changed", changed); }, []);
  const [wheelDailyUsage, setWheelDailyUsage] = useState<H4WheelDailyUsage | null>(null);
  const [wheelDailyUsageError, setWheelDailyUsageError] = useState<string | null>(null);
  const reloadWheelUsage = async () => {
    setWheelDailyUsage(null); setWheelDailyUsageError(null);
    try { setWheelDailyUsage(await fetchH4WheelDailyUsage()); }
    catch (cause) { setWheelDailyUsageError(displayAdminError(cause)); }
  };
  const [model, setModel] = useState<Model | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const conflictDraft = useHConflictDraft(!loading && !error && h4ReadVersion("overview") !== undefined);
  const canReadA2 = ctx.can("platform_a2_read");
  // 已建成、等别人批的 H4 审批单只在审批中心里；这里读一次，好让运营在本页看到哪项在等批。
  const [h4Approvals, setH4Approvals] = useState<A2OperationRow[] | "error" | null>(null);
  const [lookupKey, setLookupKey] = useState("");
  /** 被「别人先改过」拒绝后，页面已重读；这条提醒留到运营关掉或下次提交。只决定显示。 */
  const [stale, setStale] = useState<string | null>(null);
  const [releasing, setReleasing] = useState<H4Command | null>(null);
  const [rules, setRules] = useState<EventRuleView[] | null>(null);
  const [raffles, setRaffles] = useState<AdminRaffle[] | null>(null);
  const [contentId, setContentId] = useState<string | null>(null);
  const localizedDraft = useRef<{ code: string; field: string; locale: LocaleCode; value: string; reason: string } | null>(null);
  const reloadH4Approvals = async () => {
    const owner = useAdminAuth.getState().session?.adminId;
    setH4Approvals(null);
    const originals = pendingH4Commands().filter(r => "proposal" in r.request);
    await Promise.allSettled(originals.map(r => queryH4Command(r)));
    if (!canReadA2) { setH4Approvals("error"); return; }
    try {
      const overview = await fetchA2Overview({ domain: "H" });
      if (owner !== useAdminAuth.getState().session?.adminId) return;
      const rows = overview.operationQueue.filter(row => row.status === "pending" && H4_APPROVAL_OPS.has(row.operationCode ?? ""));
      replaceH4TicketObservations(rows);
      setH4Approvals(rows);
    } catch { setH4Approvals("error"); }
  };
  useEffect(() => { void reloadH4Approvals().then(reload); }, [canReadA2, adminId]);

  const reload = async () => {
    void reloadWheelUsage();
    setLoading(true);
    try {
      const owner = useAdminAuth.getState().session?.adminId;
      const result = await fetchH3QuestEvents("events");
      if (owner !== useAdminAuth.getState().session?.adminId) return false;
      setModel(result as Model); setError(null);
      return true;
    } catch (err) {
      setError(displayAdminReadError(err));
      return false;
    } finally {
      setLoading(false);
    }
  };

  const apply = async (next: unknown) => {
    if (isH4ApprovalReceipt(next)) { await reloadH4Approvals(); await reload(); toast(next.ticket.status === "pending" ? "已提交，等待审批后执行" : "已查询到原审批单，请在操作记录核对执行状态"); return false; }
    return await reload();
  };

  const proposeH4 = async (scope: string, op: string, values: Record<string, unknown>, before: string, after: string,
    reason: string, form?: Record<string, string>, editValue?: string) => {
    const session = useAdminAuth.getState().session;
    if (!session) throw new Error("登录已失效，请重新登录后核对原操作。");
    const result = await submitH4Proposal(scope, hiRewardProposal(session, op, values, before, after, reason), form, editValue);
    await apply(result);
  };

  const wheelCommandBlocks = (_op: string, _tierName?: string) => {
    if (!h4Blocked(HI_WHEEL_SCOPE)) return false;
    toast("原操作结果未知，请先在本页顶部查询原结果。", "warn");
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
    if (h4Blocked(hiEventScope(event.id))) { toast("原操作结果未知，请先在本页顶部查询原结果。", "warn"); return; }
    const current = text(event.reward);
    // Rule existence and fixed-code support are independent backend conditions.
    // Unknown reads must not be interpreted as a rule-less event.
    const ruleBased = event.rewardCopyOnly !== undefined ? event.rewardCopyOnly
      : rules === null ? null : H4_EVENT_RULE_CODES.has(event.id) && !!ruleOf(event.id);
    if (ruleBased === null) { toast("活动规则读取失败，请刷新后重试。", "warn"); return; }
    openActionConfirm({ briefKind: "config",
      action: `活动奖励 · ${event.name}`,
      title: "修改活动奖励",
      effect: ruleBased ? effectDirect : effectByDirection(),
      detail: ruleBased ? "只改 App 上显示的奖励文字，不影响发多少。" : <>当前奖励 <b>{current}</b>。填写新奖励后确认。</>,
      facts: <>
        <Facts><Fact k="活动">{eventName(event.id)}</Fact><Fact k="现在的奖励">{legacyName(current).text}{legacyName(current).legacy && <LegacyNameTag where="奖励文字" />}</Fact>{ruleBased
          ? <><Fact k="改的是">App 上显示的奖励文字</Fact><Fact k="发奖">按「七类玩法」的规则，不变</Fact></>
          : <ApprovalFact amplify="开放期间换资产或提高数量" object="奖励" />}</Facts>
      </>,
      amplifies: !ruleBased,
      confirmLabel: "提交修改",
      reasonPlaceholder: "例如：按运营排期调整奖励，工单号",
      getPendingReason: () => pendingHIRewardCommand(hiEventScope(event.id))?.payload.input.reason,
      edit: { kind: "text", current, initialValue: pendingHIRewardCommand(hiEventScope(event.id))?.editValue, hint: ruleBased ? undefined : "只认正数的 UVT 或 USDT，如 100 UVT" },
      run: async (reason, value) => {
        const scope = hiEventScope(event.id);
        if (!value) return;
        const preview = await previewH4EventReward(event.id, value, current, reason);
        if (preview.approvalRequired) {
          await proposeH4(scope, "h4_legacy_event_reward_update", { eventCode: event.id, value, expectedValue: current },
            preview.current, preview.proposed, reason, undefined, value);
          return;
        }
        if (await apply(await updateH4EventReward(event.id, value, current, reason))) toast(`${event.name} 奖励已更新`);
      },
    });
  };

  const missingFor = (event: LegacyEvent) => (["zh", "vi"] as const).flatMap((locale) =>
    (["name", "description", "rewardName"] as const).filter((field) => !localizedValue(event.id, field, locale)).map((field) => `${LOCALE_NAME[locale]}${FIELD_NAME[field]}`));

  /** 旧页面一个「上架 / 下架」框里选新状态；这里拆成「开放」「结束」两个入口，提交的状态值和旧框选中的一样。 */
  const openEventStatus = (event: LegacyEvent, value: "ongoing" | "ended") => {
    if (h4Blocked(hiEventScope(event.id))) { toast("原操作结果未知，请先在本页顶部查询原结果。", "warn"); return; }
    const missing = missingFor(event);
    const opening = value === "ongoing";
    openConfirm({ briefKind: "config",
      action: `活动状态 · ${event.name}`,
      title: opening ? "开放活动" : "结束活动",
      effect: opening ? effectByDirection() : <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag /></>,
      detail: <>当前状态 <b>{lifecycleOf(event).label}</b>。</>,
      content: <>
        <Facts>
          <Fact k="活动">{eventName(event.id)}</Fact>
          <Fact k="状态"><Change from={lifecycleOf(event).label} to={opening ? "进行中" : "已结束"} /></Fact>
          {opening
            ? <Fact k="开放后">用户可以在 App 上参加，按活动奖励发放</Fact>
            : <Fact k="结束后">用户不能再参加；同时停掉这个活动的玩法、取消主推。已有的参与和奖励记录保留，结束后不能再开放</Fact>}
          {opening && <ApprovalFact amplify="没有玩法规则又有正奖励的活动" object="活动" />}
        </Facts>
        {opening && missing.length > 0 && <Notice tone="warn" title={`还缺 ${missing.length} 项翻译，后端会拒绝开放`}>{missing.join("、")}。先在卡片底部的「三语内容」里补齐。</Notice>}
      </>,
      reason: true,
      okLabel: opening ? "开放活动" : "结束活动",
      confirmTone: opening ? undefined : "danger",
      reasonPlaceholder: opening ? "例如：活动素材已就绪，按排期开放" : "例如：活动到期，按排期结束",
      run: async (reason) => {
        if (await apply(await updateH4EventStatus(event.id, value, event.state, reason))) toast(`${event.name} 状态已更新`);
      },
    });
  };

  const openEventFeatured = (event: LegacyEvent) => {
    if (h4Blocked(hiEventScope(event.id))) { toast("原操作结果未知，请先在本页顶部查询原结果。", "warn"); return; }
    const next = conflictDraft.intent === undefined ? !Boolean(event.featured) : conflictDraft.intent === "true";
    if (next === Boolean(event.featured)) { if (conflictDraft.intent !== undefined) setStale(null); toast(conflictDraft.intent !== undefined ? "别人已经改成这个状态，不用再提交" : "没有改动"); return; }
    openConfirm({ rebaseValue: String(next), briefKind: "record",
      action: `${next ? "设为主推" : "取消主推"} · ${event.name}`,
      title: next ? "设为主推" : "取消主推",
      effect: effectDirect,
      detail: <>同时只能有一个进行中的主推活动。</>,
      content: <Facts>
        <Fact k="活动">{eventName(event.id)}</Fact>
        <Fact k="主推"><Change from={event.featured ? "是" : "否"} to={next ? "是" : "否"} /></Fact>
        <Fact k="影响">只改 App 活动页的主推位，不发奖、不改奖励{!next ? "" : "；已经有别的主推活动时后端会拒绝，先取消那一个"}</Fact>
      </Facts>,
      reason: true,
      okLabel: next ? "设为主推" : "取消主推",
      reasonPlaceholder: "例如：按运营排期调整首页主推",
      run: async (reason) => {
        if (await apply(await updateH4EventFeatured(event.id, next, Boolean(event.featured), reason))) toast(`${event.name} 主推状态已更新`);
      },
    });
  };

  const openLocalizedContent = (code: string, field: "name" | "description" | "rewardName", locale: LocaleCode, source: string) => {
    if (h4Blocked(hiEventScope(code))) { toast(h4ApprovalLockedReason(hiEventScope(code)) ?? "原操作结果未知，请先在本页顶部查询原结果。", "warn"); return; }
    const current = localizedValue(code, field, locale);
    const saved = localizedDraft.current;
    const draft = saved?.code === code && saved.field === field && saved.locale === locale ? saved : undefined;
    openActionConfirm({ initialReason: draft?.reason, briefKind: "config",
      action: `编辑 ${locale.toUpperCase()} 内容 · ${source}`,
      title: `编辑${LOCALE_NAME[locale]}${FIELD_NAME[field]}`,
      effect: effectDirect,
      detail: <>不填时 App 显示英文或原文，不自动翻译。</>,
      facts: <Facts><Fact k="活动">{eventName(code)}</Fact><Fact k="原文">{source || "—"}</Fact></Facts>,
      reasonPlaceholder: "例如：补齐上线前的翻译",
      edit: { kind: "text", current, initialValue: draft?.value },
      run: async (reason, value) => {
        if (!value) return;
        localizedDraft.current = { code, field, locale, value, reason };
        const result = await updateH4LocalizedContent(code, field, locale, value, casExpected(current), reason);
        localizedDraft.current = null;
        if (await apply(result)) toast(`${source} ${locale.toUpperCase()} 文案已保存`);
      },
    });
  };

  const runEventDelete = async (eventId: string, expectedVersion: string, reason: string) => {
    if (!ctx.can("growth_h4_write")) throw new Error("你没有删除活动的权限。");
    try {
      if (await apply(await deleteH4QuestEvent(eventId, expectedVersion, reason))) toast("活动已删除，历史参与、奖励与操作记录保留");
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
    const builtIds = new Set((model?.events ?? []).map((event) => event.id));
    const freeCodes = [...H4_EVENT_RULE_CODES].filter((code) => !builtIds.has(code));
    const builtCount = H4_EVENT_RULE_CODES.size - freeCodes.length;
    openActionConfirm({ briefKind: "config",
      action: "新建活动",
      title: "新建既有活动",
      statedBrief: { impact: "建成预告，不对用户开放。", check: "核对编号、玩法和奖励，理由写清依据。" },
      effect: <StatusTag tone="neutral" filled>建成预告，不开放</StatusTag>,
      detail: <>只能新建内置活动，每个编号只能建一个。</>,
      amplifies: true,
      reasonPlaceholder: "例如：按运营排期登记新活动",
      confirmLabel: "新建活动",
      businessForm: {
        kind: "multi-field",
        fields: [
          { key: "id", label: "活动编号", current: "", inputKind: "select", mustChoose: true, options: freeCodes, required: true,
            help: freeCodes.length === 0 ? "内置活动都已建好，没有能新建的编号" : builtCount > 0 ? `已建的 ${builtCount} 个不在列表里` : undefined,
            explain: "只能用这几个内置编号，建好后不能改。" },
          { key: "name", label: "活动名", current: "", placeholder: "如 夏日狂欢", required: true },
          { key: "kind", label: "玩法", current: "discount", inputKind: "select", options: KIND_OPTIONS, optionLabels: Object.fromEntries(KIND_OPTIONS.map((kind) => [kind, KIND_LABEL(kind)])) },
          { key: "reward", label: "奖励", current: "", placeholder: "如 100 UVT", required: false, explain: "没有玩法规则的活动只认正数的 UVT 或 USDT。" },
          { key: "condition", label: "完成条件", current: "", placeholder: "如 order.paid", required: false },
          { key: "__more", label: "其余设置", current: "hide", inputKind: "select", options: ["hide", "show"], optionLabels: { hide: "收起，没填的用默认值", show: "展开逐项填写" }, wide: true, explain: "只控制状态、目标值、地区、App 跳转、时间、主推、统计效果这几项显示不显示，这一项本身不提交。已填的值收起后照样提交；没填的按默认值：进行中、目标值 1、不限地区、不跳转、不设时间、不主推、不统计。" },
          { key: "state", label: "状态", current: "ongoing", inputKind: "select", options: ["ongoing", "upcoming", "ended"], optionLabels: { ongoing: "进行中", upcoming: "预告", ended: "已结束" }, explain: "这一项照原样提交，但后端建成后一律是「预告」，不会因为选了「进行中」就开放。", visibleWhen: { key: "__more", equals: "show" } },
          { key: "targetValue", label: "目标值", current: "", placeholder: "留空按 1", inputKind: "number", min: 1, max: 1_000_000_000, step: 1, required: false, visibleWhen: { key: "__more", equals: "show" } },
          { key: "geo", label: "地区", current: "", placeholder: "如 VN / GLOBAL", required: false, visibleWhen: { key: "__more", equals: "show" } },
          { key: "href", label: "App 跳转", current: "", placeholder: "如 /pages/store/store", required: false, help: "只能填 /pages/ 开头的页面", visibleWhen: { key: "__more", equals: "show" } },
          { key: "trackable", label: "统计效果", current: "false", inputKind: "select", options: ["false", "true"], optionLabels: { false: "不统计", true: "统计参与、达标、领取" }, visibleWhen: { key: "__more", equals: "show" } },
          { key: "startsAt", label: "开始时间（UTC）", current: "", inputKind: "datetime-local", required: false, visibleWhen: { key: "__more", equals: "show" } },
          { key: "endsAt", label: "结束时间（UTC）", current: "", inputKind: "datetime-local", required: false, help: "要晚于开始时间", visibleWhen: { key: "__more", equals: "show" } },
          { key: "featured", label: "设为主推", current: "false", inputKind: "select", options: ["false", "true"], optionLabels: { false: "否", true: "是" }, explain: "这一项照原样提交，但后端建成后一律不主推；开放以后再在卡片上设主推。", visibleWhen: { key: "__more", equals: "show" } },
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
        if (await apply(await createH4QuestEvent(payload, reason))) toast(`活动「${payload.name}」已新建`);
      },
    });
  };

  // ===== 转盘 =====
  const tierFacts = (tier: WheelTier, extra?: ReactNode) => <Facts>
    <Fact k="奖项">{text(tier.tier)}</Fact>
    <Fact k="奖品">{legacyName(tier.reward).text}{legacyName(tier.reward).legacy && <LegacyNameTag where="奖项名称" />}</Fact>
    <Fact k="概率">{percentText(tier.prob)}%（这里不改概率）</Fact>
    {extra}
  </Facts>;

  const openCreateWheelTier = () => {
    if (wheelCommandBlocks("h4_wheel_tier_create")) return;
    openActionConfirm({ briefKind: "config",
      action: "新建转盘奖项",
      title: "新建转盘奖项",
      statedBrief: { impact: "这一档进奖池，按概率参与抽奖。", check: "核对奖型、发真钱和每日库存。" },
      effect: effectByDirection("新建 UVT 奖项，或概率大于 0 的 USDT、代金券奖项"),
      detail: <>概率 0–100，所有奖项合计要等于 100%；发真钱的奖项在覆盖率低于红线时存不了。</>,

      amplifies: true,
      coverageLead: "这一档会让转盘多发奖",
      reasonPlaceholder: "例如：按活动方案新增一档奖品",
      getPendingReason: () => pendingHIRewardCommand(HI_WHEEL_SCOPE)?.payload.input.reason,
      getPendingBusinessValue: () => h4PendingFor(HI_WHEEL_SCOPE)?.form,
      businessForm: {
        kind: "multi-field",
        fields: [
          { key: "tierName", label: "奖项编号", current: "", placeholder: "如 uvt-100", required: true, help: "不能和已有奖项重复" },
          { key: "rewardName", label: "奖品名称", current: "", placeholder: "如 100 UVT", required: true, help: "App 抽中时显示这串文字，不影响发放" },
          { key: "rewardKind", label: "奖励类型", current: "uvt", inputKind: "select", options: ["uvt", "usdt", "coupon"], optionLabels: { uvt: "UVT", usdt: "USDT", coupon: "代金券" } },
          { key: "realOutflow", label: "是否发真钱", current: "0", inputKind: "select", options: ["0", "1"], optionLabels: { "0": "否", "1": "是" },
            warning: (value) => (value.rewardKind === "usdt") !== (value.realOutflow === "1") ? "USDT 奖项要选「是」，UVT 和代金券要选「否」，否则后端会拒绝" : undefined },
          { key: "rewardAmount", label: "每次发放数量", current: "", placeholder: "如 100", inputKind: "number", min: 0.000001, max: 1000000, step: 0.000001, required: true, help: "代金券每次发 1 张，填任意正数" },
          { key: "probabilityPct", label: "中奖概率（%）", current: "", placeholder: "0–100", inputKind: "number", min: 0, max: 100, step: 0.0001, required: true, help: "加上原有各档不能超过 100%；保存前要合计正好 100% 才能抽" },
          { key: "dailyStock", label: "每日库存", current: "", placeholder: "0 为不限", inputKind: "number", min: 0, max: 1000000, step: 1, required: true, help: "这一档每天最多发出几次，0 为不限" },
          { key: "voucherId", label: "代金券编号", current: "", placeholder: "如 WHEEL-50", required: false, visibleWhen: { key: "rewardKind", equals: "coupon" } },
        ],
      },
      run: async (reason, _v, bv) => {
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
        if (await apply(await createH4WheelTier(payload, expectedSignature, reason))) toast(`奖项「${payload.tierName}」已新建`);
      },
    });
  };

  const openCreateWheelGuard = () => {
    openActionConfirm({ briefKind: "config",
      action: "新建转盘安全限制",
      title: "新建转盘护栏",
      effect: effectByDirection(),
      detail: <>每种护栏只能建一条。</>,
      facts: <Facts><ApprovalFact amplify="首次设正数预算或首次开启真钱奖" object="转盘" /></Facts>,
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
        if (await apply(await createH4WheelGuard(payload, reason))) toast(`安全限制「${payload.guardLabel}」已新建`);
      },
    });
  };

  const openWheelBudget = (guard: { key: string; label: string; value: string }) => {
    if (h4Blocked(`H/h4_wheel_guard/${guard.key}`)) { toast("原操作结果未知，请先在本页顶部查询原结果。", "warn"); return; }
    const current = text(guard.value);
    openActionConfirm({ briefKind: "config",
      action: `转盘安全限制 · 每日实际奖励预算（美元）`,
      title: "调整每日真钱奖预算",
      statedBrief: { impact: "保存后按新预算拦当天的真钱奖。", check: "核对新预算的金额和单位。" },
      effect: effectByDirection(),
      detail: <>当前值 <b>{current}</b>。如果别人刚改过，需要刷新后再改。</>,
      facts: <>
        <Facts><Fact k="现在">{amountText(budgetNumber(current))} USDT / 天</Fact><Fact k="超过后">当天再抽中真钱奖改发 UVT 安慰奖</Fact><ApprovalFact amplify="调高预算" object="预算" /></Facts>
      </>,
      amplifies: true,
      coverageLead: "调高预算会让转盘每天多发真钱",
      reasonPlaceholder: "例如：活动期放宽每日真钱奖预算",
      edit: { kind: "number", current: budgetNumber(current), min: 0.01, max: 1_000_000_000, step: 0.01, hint: "大于 0，最多两位小数，单位 USDT" },
      run: async (reason, value) => {
        if (!value) return;
        if (await apply(await updateH4WheelGuard(guard.key, value, current, reason))) toast("转盘安全限制「每日实际奖励预算（美元）」已更新");
      },
    });
  };

  const openWheelKill = (guard: { key: string; label: string; value: string }) => {
    if (h4Blocked(`H/h4_wheel_guard/${guard.key}`)) { toast("原操作结果未知，请先在本页顶部查询原结果。", "warn"); return; }
    const current = text(guard.value);
    const on = killOn(current);
    const next = conflictDraft.intent ?? (on ? "关" : "开");
    if (killOn(next) === on) { if (conflictDraft.intent !== undefined) setStale(null); toast(conflictDraft.intent !== undefined ? "别人已经改成这个状态，不用再提交" : "没有改动"); return; }
    const closing = next === "关", approval = !on && !closing;
    openActionConfirm({ rebaseValue: next, blockedReason: killOn(next) === on ? "没有改动" : undefined, briefKind: "config",
      action: `转盘安全限制 · 实际奖品发放开关`,
      title: closing ? "关闭真钱奖发放" : "开启真钱奖发放",
      effect: approval ? effectApproval("开关") : effectDirect,
      detail: <>当前值 <b>{on ? "开" : "关"}</b>。如果别人刚改过，需要刷新后再改。</>,
      facts: <>
        <Facts>
          <Fact k="真钱奖发放"><Change from={on ? "开" : "关"} to={next} /></Fact>
          <Fact k={closing ? "关闭后" : "开启后"}>{closing ? "抽中 USDT 改发 UVT 安慰奖，已发的不变" : "抽中 USDT 按预算和覆盖率发真钱"}</Fact>
          {approval && <ApprovalFact amplify="从关到开" object="开关" />}
        </Facts>
      </>,
      confirmLabel: closing ? "关闭真钱奖" : "提交审批",
      confirmTone: closing ? "danger" : undefined,
      reasonPlaceholder: closing ? "例如：覆盖率告警，先停发真钱奖" : "例如：覆盖率恢复，重新开启真钱奖",
      run: async (reason) => {
        if (await apply(await updateH4WheelGuard(guard.key, next, current, reason))) toast("转盘安全限制「实际奖品发放开关」已更新");
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
      ?? conflictDraft.business
      ?? Object.fromEntries(tiers.filter((tier) => !wheelPointsTier(tier)).map((tier) => [text(tier.tier), String(numericValue(tier.prob))]));
    const store = formStore(initial);
    openActionConfirm({ briefKind: "config",
      action: "调整转盘奖项概率",
      title: "调整转盘概率",
      statedBrief: { impact: "保存后按新概率抽，已抽的不变。", check: "核对各档概率合计正好 100%。" },
      effect: effectByDirection("调高任一 UVT、USDT 或代金券奖项的概率（降低别的奖项不能抵消）"),
      detail: <>一次设置所有奖项，加起来要等于 100%。调高发钱奖项的概率时，覆盖率低于红线无法保存。</>,
      facts: <ProbabilityCompare tiers={tiers} store={store} valueOf={probabilityText} />,
      amplifies: true,
      coverageLead: "调高中奖概率会让转盘多发奖",
      reasonPlaceholder: "例如：按活动方案调整各档概率",
      getPendingReason: () => pendingHIRewardCommand(HI_WHEEL_SCOPE)?.payload.input.reason,
      getPendingBusinessValue: () => h4PendingFor(HI_WHEEL_SCOPE)?.form,
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
        const amplifies = tiers.some(tier => ["nex", "uvt", "usdt", "coupon"].includes(text(tier.kind).toLowerCase())
          && probabilities[text(tier.tier)] > numericValue(tier.prob));
        if (amplifies) {
          await proposeH4(HI_WHEEL_SCOPE, "h4_wheel_probabilities_update", {
            probabilities: decimalProbabilities,
            expectedSignature: text(model?.wheelSignature, "__EMPTY__"),
          }, JSON.stringify(tiers), JSON.stringify(probabilities), reason, businessValue);
          return;
        }
        if (await apply(await updateH4WheelProbabilities(
          probabilities,
          text(model?.wheelSignature, "__EMPTY__"),
          reason,
        ))) toast("转盘概率已更新");
      },
    });
  };

  const openEditWheelTier = (tier: WheelTier) => {
    const tierName = text(tier.tier);
    if (wheelCommandBlocks("h4_wheel_tier_update", tierName)) return;
    openActionConfirm({ briefKind: "config",
      action: `编辑转盘奖项 · ${tierName}`,
      title: "编辑转盘奖项",
      statedBrief: { impact: "生效后下一次抽奖就按新内容发，已经抽中的不变。", check: "核对奖型、发真钱、每次数量和每日库存。" },
      effect: effectByDirection(),
      detail: <>编辑奖项名称、奖励类型、是否发真钱。概率请在「改奖池 / 概率」里统一调，保证加起来是 100%。</>,
      facts: tierFacts(tier, <ApprovalFact amplify="换奖型、提高数量、放宽库存，或收紧 UVT 库存使安慰奖变多" object="奖池" />),
      amplifies: true,
      coverageLead: "这一档会让转盘多发奖",
      reasonPlaceholder: "例如：按活动方案调整这一档奖品",
      getPendingReason: () => pendingHIRewardCommand(HI_WHEEL_SCOPE)?.payload.input.reason,
      getPendingBusinessValue: () => h4PendingFor(HI_WHEEL_SCOPE)?.form,
      businessForm: {
        kind: "multi-field",
        requireAnyChange: true,
        fields: [
          { key: "rewardName", label: "奖项名称", current: text(tier.reward), inputKind: "text", required: true, showDiff: true },
          // 451dd37e normalizes the App projection only; retain the admin's stored kind.
          { key: "rewardKind", label: "奖励类型", current: text(tier.kind, "uvt"), inputKind: "select", options: ["uvt", "usdt", "coupon"], optionLabels: { uvt: "UVT", usdt: "USDT", coupon: "代金券" }, required: true, showDiff: true },
          { key: "realOutflow", label: "是否发真钱", current: boolValue(tier.real) ? "1" : "0", inputKind: "select", options: ["0", "1"], optionLabels: { "0": "否", "1": "是" }, required: true, showDiff: true,
            warning: (value) => (value.rewardKind === "usdt") !== (value.realOutflow === "1") ? "USDT 奖项要选「是」，UVT 和代金券要选「否」，否则后端会拒绝" : undefined },
          { key: "rewardAmount", label: "每次发放数量", current: String(numericValue(tier.amount)), inputKind: "number", min: 0.000001, max: 1000000, step: 0.000001, required: true, showDiff: true },
          { key: "voucherId", label: "代金券 ID", current: text(tier.voucherId, ""), inputKind: "text", required: true, visibleWhen: { key: "rewardKind", equals: "coupon" }, showDiff: true },
          { key: "dailyStock", label: "每日库存（0 = 不限）", current: String(numericValue(tier.dailyStock)), inputKind: "number", min: 0, max: 1000000, step: 1, required: true, showDiff: true },
        ],
      },
      run: async (reason, _value, bv) => {
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
        if (await apply(await updateH4WheelTier(tierName, payload, expectedSignature, reason))) toast(`奖项「${tierName}」已更新`);
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
      facts: tierFacts(tier, probability === 0 ? <ApprovalFact amplify="删除后 UVT 安慰奖会变多" object="奖池" /> : null),
      confirmLabel: "删除奖项",
      confirmTone: "danger",
      reasonPlaceholder: "例如：这一档已下线，按工单删除",
      getPendingReason: () => pendingHIRewardCommand(HI_WHEEL_SCOPE)?.payload.input.reason,
      run: async (reason) => {
        if (probability !== 0) throw new Error("删除前请先把概率调成 0%");
        const amplifies = !boolValue(tier.real) && text(tier.kind).toLowerCase() === "uvt"
          && increasesUvtFallback(model?.wheelTiers ?? [], tier, false);
        if (amplifies) {
          await proposeH4(HI_WHEEL_SCOPE, "h4_wheel_tier_delete", { tierName, expectedSignature: text(model?.wheelSignature, "__EMPTY__") },
            JSON.stringify(tier), "删除档位", reason);
          return;
        }
        if (await apply(await deleteH4WheelTier(
          tierName,
          text(model?.wheelSignature, "__EMPTY__"),
          reason,
        ))) toast(`奖项「${tierName}」已删除`);
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
        {otherInvalid.length > 0 && <Notice tone="warn" title="还有旧奖型">{otherInvalid.map((row) => text(row.tier)).join("、")} 不受这一步影响。</Notice>}
      </>,
      confirmLabel: "确认退役",
      confirmTone: "danger",
      reasonPlaceholder: "例如：积分奖型已下线，按工单停用这一档",
      getPendingReason: () => {
        const original = pendingHIRewardCommand(HI_WHEEL_SCOPE);
        return original?.payload.kind === "retire" ? original.payload.input.reason : undefined;
      },
      run: async (reason) => {
        const result = await h4CommandRequest(`/quest-events/wheel-tiers/${encodeURIComponent(tierName)}/retire`, {
          method: "POST", body: JSON.stringify({ reason, operator: useAdminAuth.getState().session?.operator || useAdminAuth.getState().session?.username, confirmed: true, expectedSignature: text(model?.wheelSignature, "__EMPTY__") }),
        }, `退役积分奖项 · ${tierName}`);
        await apply(result);
        toast(`积分奖项「${tierName}」已退役。请用合法奖型把概率补足到 100%`);
      },
    });
  };

  // ===== 结果未知、待审批 =====
  const refreshAll = async () => {
    await reloadH4Approvals();
    await reload();
    const [rules, raffles] = await Promise.allSettled([import("@/lib/admin/event-rules-client").then(m => m.fetchEventRules()), import("@/lib/admin/genesis-raffle-client").then(m => m.fetchAdminRaffles())]);
    window.dispatchEvent(new CustomEvent("admin-h4-readback", { detail: {
      rules: rules.status === "fulfilled" ? rules.value : undefined, ruleError: rules.status === "rejected" ? displayAdminError(rules.reason) : "",
      raffles: raffles.status === "fulfilled" ? raffles.value : undefined, raffleError: raffles.status === "rejected" ? displayAdminError(raffles.reason) : "",
    } }));
  };
  const lookupH4Command = async (record: H4Command) => {
    setLookupKey(record.commandKey);
    try {
      const ticket = await queryH4Command(record);
      if (!pendingH4Commands().some(row => row.commandKey === record.commandKey) && activeRecovery.current === record.commandKey) {
        activeRecovery.current = null; ctx.openActionConfirm(null);
      }
      if (ticket === null) toast("暂未查到原审批单，原请求继续保留。", "warn");
      await refreshAll();
    } catch (cause) { toast(displayAdminError(cause), "warn"); }
    finally { setLookupKey(""); }
  };
  const openResumeHICommand = (record: H4Command, subject: string) => {
    activeRecovery.current = record.commandKey;
    const expired = isRetryExpired(record);
    const approval = "proposal" in record.request;
    const change = hiCommandChange(record);
    ctx.openActionConfirm({ briefKind: "record",
      action: `核对原操作 · ${subject}`, title: "按原请求重试",
      detail: approval
        ? expired ? <>原申请已超过 24 小时，只查询原审批单，不会重发。</> : <>先按原申请查审批单；查不到才原样重发，不会建第二张单。理由沿用原操作。</>
        : <>按原请求原样重发，后端认得出同一次提交，不会重复执行。理由沿用原操作。</>,
      facts: <Facts><Fact k="原操作">{subject}</Fact>{change && <Fact k="原改动">{change}</Fact>}<Fact k="提交时间">{formatTime(new Date(record.createdAt).toISOString(), "Asia/Shanghai")}（北京时间）</Fact><Fact k="原请求">内容和理由锁住，原样重发</Fact></Facts>,
      confirmLabel: "按原请求重试",
      getPendingReason: () => pendingH4Commands().some(r => r.commandKey === record.commandKey) ? record.reason : undefined,
      run: async () => {
        if (activeRecovery.current !== record.commandKey || !pendingH4Commands().some(r => r.commandKey === record.commandKey)) throw new Error("H4_ORIGINAL_RESOLVED");
        try { await retryH4Command(record); }
        finally {
          if (!pendingH4Commands().some(r => r.commandKey === record.commandKey) || h4CommandHasPendingTicket(record.commandKey)) { activeRecovery.current = null; ctx.openActionConfirm(null); }
          await refreshAll();
        }
      },
    });
  };
  const hiRecords = pendingH4Commands().filter(r => !r.asset && (!r.acknowledged || "proposal" in r.request));
  const h4Pending = [...new Map(h4TicketObservations().map(row => [row.id, row])).values()];
  const unknownCount = hiRecords.filter(r => !h4CommandHasPendingTicket(r.commandKey)).length;
  const confirmed = confirmedH4Saves();
  const recovery = <>
    {hiRecords.length > 0 && <Notice tone="warn" title={`${unknownCount ? `有 ${unknownCount} 个操作结果未知` : ""}${unknownCount && hiRecords.length > unknownCount ? "；" : ""}${hiRecords.length > unknownCount ? `${hiRecords.length - unknownCount} 个操作在等审批` : ""}`} actionBelow action={<ul className="h4-pending">
      {hiRecords.map((record) => {
        const subject = hiCommandSubject(record, eventName);
        const expired = isRetryExpired(record);
        const allowed = canRetryH4Command(record);
        const pending = h4CommandHasPendingTicket(record.commandKey);
        return <li key={record.commandKey}>
          <span className="h4-pending-what"><b>{subject}</b>{hiCommandChange(record) && <span className="h4-pending-change">{hiCommandChange(record)}</span>}</span>
          <span className="h4-pending-when">提交于 <span className="h4-num">{formatTime(new Date(record.createdAt).toISOString(), "Asia/Shanghai")}</span>（北京时间）</span>
          {pending ? pendingTag(subject) : expired ? expiredTag("proposal" in record.request ? "approval" : "direct") : unknownTag("proposal" in record.request ? "approval" : "direct")}
          <span className="h4-pending-actions">
            <Button size="sm" disabledReason={lookupKey ? "正在查询" : undefined} loading={lookupKey === record.commandKey} onClick={() => void lookupH4Command(record)}>查询原结果</Button>
            {!expired && !record.acknowledged && <Button size="sm" disabledReason={!allowed ? "没有这项修改的权限" : undefined} onClick={() => openResumeHICommand(record, subject)}>按原请求重试</Button>}
            {expired && !record.acknowledged && "proposal" in record.request && <Button size="sm" variant="ghost" disabledReason={lookupKey ? "正在查询" : undefined} onClick={() => setReleasing(record)}>查无此单时解除</Button>}
          </span>
        </li>;
      })}

    </ul>}>关闭或刷新页面不会重新提交。</Notice>}
    {releasing && <ReleaseModal label={<>{hiCommandSubject(releasing, eventName)}{hiCommandChange(releasing) ? ` · ${hiCommandChange(releasing)}` : ""}</>}
      explain={<><p>原申请已超过 24 小时，不会再重发。</p><p>确认时先按原申请再查一次：明确查不到这张审批单才解除，说明申请没建成；查到了就按它现在的状态显示，不解除。</p></>}
      onCancel={() => setReleasing(null)} onConfirm={() => {
        const record = releasing;
        setReleasing(null);
        setLookupKey(record.commandKey);
        void releaseExpiredH4Proposal(record)
          .then(() => { toast("已解除这条记录，可以重新提交修改。", "success"); return refreshAll(); })
          .catch(cause => { toast(displayAdminError(cause), "warn"); return refreshAll(); })
          .finally(() => setLookupKey(""));
      }} />}
    {stale && <Notice tone="warn" title={`没有保存：别人先改过（${stale}）`} action={<Button size="sm" variant="ghost" onClick={() => setStale(null)}>知道了</Button>}>{error ? "最新值没读到；重试读取成功后再核对，你填的还在。" : "已读到最新值，你填的还在，核对后再提交。"}</Notice>}
    {confirmed.length > 0 && <Notice tone="warn" title="已保存，但没读到最新数据" action={<Button size="sm" loading={loading} onClick={() => void refreshAll()}>重新读取</Button>}>
      {`${confirmed.map(record => `「${hiCommandSubject(record, eventName)}」`).join("、")}已保存，不用重新提交。重新读取成功后才能再改。`}
    </Notice>}
    {(h4Pending.length > 0 || h4Approvals === "error") && <Notice tone="warn" title={h4Approvals === "error" ? "审批进度没有读到" : `${h4Pending.length} 项修改在等审批`} actionBelow
      action={h4Approvals === "error" ? <Button size="sm" onClick={() => void reloadH4Approvals()}>重试</Button> : <ul className="h4-pending">
        {h4Pending.map((row) => {
          const eventOp = ["h4_legacy_event_reward_update", "h4_legacy_event_open", "h4_event_rule_enable"].includes(row.operationCode ?? "");
          const subject = eventOp ? eventName(row.obj) : row.operationCode === "h4_genesis_raffle_open" ? raffles?.find(draw => draw.id === row.obj)?.titleZh || row.obj
            : row.operationCode?.startsWith("h4_wheel_guard_") ? GUARD_NAME[row.obj] || row.obj : "转盘奖池";
          return <li key={row.id}>
            <span className="h4-pending-what"><b>{row.action} · {subject}</b></span>
            <span className="h4-pending-when">{row.mine ? "你发起的" : "别人发起的"}</span>
            {pendingTag(subject)}
            <a className="rd-link" href="/platform/audit">去操作记录与审批</a>
          </li>;
        })}
      </ul>}>
      {h4Approvals === "error" ? "看不到哪些修改在等批。" : "批准、驳回或撤回之前，这些对象不能再改，调低和关闭也不行。"}
    </Notice>}
  </>;

  if (loading && !model) return <>{recovery}<BlockState state="loading" title="正在加载既有活动与转盘" /></>;
  if (error || !model) return <>{recovery}<BlockState state="error" title="既有活动与转盘没有读到" detail={error ?? "没有收到数据，请重试；一直失败请联系值班同事。"} onRetry={() => void reload()} retryLabel="重试读取 · 既有活动与转盘" /></>;

  const events = model.events ?? [];
  const tiers = model.wheelTiers ?? [];
  const guards = model.wheelGuards ?? [];
  const h4Stats = model.h4Stats ?? {};
  const wheelEvUsdt = model.wheelEvByAsset === undefined ? model.wheelEvUsd : model.wheelEvByAsset?.USDT;
  const wheelEvOthers = Object.entries(model.wheelEvByAsset ?? {}).filter(([asset, value]) => asset !== "USDT" && value != null);
  const awards = model.wheelAwardsToday;
  const awardRows = awards?.available ? Object.entries(awards.byAsset).sort(([a], [b]) => Number(b === "USDT") - Number(a === "USDT")) : [];
  const awardUsdt = awards?.available ? awards.byAsset.USDT : undefined;
  const probabilitySum = tiers.reduce((sum, tier) => sum + numericValue(tier.prob), 0);
  const probabilityOk = Math.abs(probabilitySum - 100) < 0.001;
  const pointsTiers = tiers.filter(wheelPointsTier);
  const wheelBroken = pointsTiers.length > 0 || !probabilityOk;
  const legacyTierNames = tiers.filter((tier) => legacyName(tier.reward).legacy);
  const gapsByEvent = events.map((event) => ({ event, missing: missingFor(event) })).filter((row) => row.missing.length > 0);
  const gapCount = gapsByEvent.reduce((sum, row) => sum + row.missing.length, 0);
  const ruleOf = (id: string) => rules?.find((rule) => rule.eventCode === id);
  const wheelPending = h4Pending.some((row) => row.obj === "ACTIVE_POOL");
  const eventPending = (id: string) => h4ApprovalPending(hiEventScope(id)) || h4ApprovalPending(`H/h4_event_rule/${id}`);
  const budget = guards.find((guard) => guard.key === "budget");
  const kill = guards.find((guard) => guard.key === "kill");
  const cap = guards.find((guard) => guard.key === "cap");
  const killState = kill ? killOn(text(kill.value, "")) : null;

  const go = (next: LegacySection, anchor?: string) => {
    onSection(next);
    if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }));
  };
  const todos: Array<{ key: string; tag: ReactNode; title: string; sub: string; onOpen: () => void }> = [
    ...(wheelBroken ? [{ key: "wheel", tag: <StatusTag tone="danger" icon={CircleAlert}>转盘抽不了</StatusTag>, title: "转盘奖池",
      sub: [pointsTiers.length ? `${pointsTiers.length} 档积分奖型要退役` : "", probabilityOk ? "" : `概率合计 ${percentText(probabilitySum)}%，要正好 100%`].filter(Boolean).join("；"),
      onOpen: () => go("wheel", "h4l-wheel") }] : []),
    ...(gapCount > 0 ? [{ key: "locale", tag: <StatusTag tone="warn">翻译没填</StatusTag>, title: `${gapsByEvent.length} 个既有活动`,
      sub: `${gapCount} 项中文、越南语内容没填，这些活动不能开放`, onOpen: () => go("events", "h4l-events") }] : []),
    ...(legacyTierNames.length > 0 ? [{ key: "nex", tag: <StatusTag tone="warn">旧名称</StatusTag>, title: "转盘奖项名称",
      sub: `${legacyTierNames.map((tier) => text(tier.tier)).join("、")} 的名称还写着 NEX，要改成 UVT`, onOpen: () => go("wheel", "h4l-tiers") }] : []),
    ...(killState === false ? [{ key: "kill", tag: <StatusTag tone="warn">真钱奖已关</StatusTag>, title: "真钱奖发放开关",
      sub: "抽中 USDT 奖项的用户现在都改拿 UVT 安慰奖", onOpen: () => go("wheel", "h4l-guards") }] : []),
  ];

  const eventMenu = (event: LegacyEvent): MoreMenuItem[] => {
    const life = lifecycleOf(event);
    const ended = life.key === "ended";
    const lockedReason = h4ApprovalLockedReason(hiEventScope(event.id));
    const wheelEvent = text(event.kind).toLowerCase() === "wheel";
    return [
      ...(!wheelEvent ? [{ key: "reward", label: "修改奖励", disabledReason: !canModuleWrite ? "没有修改既有活动的权限" : rules === null ? "玩法规则没读到，判断不了改奖励的后果。到「玩法与抽奖」刷新「七类玩法」后再改。" : ended ? "已结束的活动不能改奖励" : lockedReason, onSelect: conflictDraft.register(JSON.stringify(["openEventReward:1", event.id]), () => openEventReward(event)) }]
        : [{ key: "wheel", label: "去转盘奖池改奖品", onSelect: () => go("wheel", "h4l-wheel") }]),
      ...(!ended && event.state === "ongoing" ? [{ key: "featured", label: event.featured ? "取消主推" : "设为主推", disabledReason: !canModuleWrite ? "没有修改既有活动的权限" : lockedReason, onSelect: conflictDraft.register(JSON.stringify(["openEventFeatured:1", event.id]), () => openEventFeatured(event)) }] : []),
      { key: "content", label: "三语内容与 App 上的样子", onSelect: () => setContentId(event.id) },
      ...(!ended && event.state !== "ended" ? [{ key: "end", label: "结束活动", danger: true, disabledReason: !canModuleWrite ? "没有修改既有活动的权限" : lockedReason, onSelect: conflictDraft.register(JSON.stringify(["openEventStatus:1", event.id]), () => openEventStatus(event, "ended")) }] : []),
      { key: "delete", label: "删除", danger: true, disabledReason: !canModuleWrite ? "没有删除活动的权限" : !isDeletableQuestEvent(event) ? "只能删除草稿或已结束的活动" : lockedReason, onSelect: conflictDraft.register(JSON.stringify(["openEventDelete:1", event.id]), () => openEventDelete(event)) },
    ];
  };
  const eventPrimary = (event: LegacyEvent) => {
    const life = lifecycleOf(event);
    if (life.key === "ended") return null;
    if (event.state === "upcoming") return <Button size="sm" disabledReason={!canModuleWrite ? "没有修改既有活动的权限" : h4ApprovalLockedReason(hiEventScope(event.id))} onClick={conflictDraft.register(JSON.stringify(["openEventStatus:2", event.id]), () => openEventStatus(event, "ongoing"))}>开放</Button>;
    return null;
  };
  const contentEvent = contentId ? events.find((event) => event.id === contentId) : undefined;
  const usedPayout = wheelDailyUsage?.realPayoutUsdt == null ? null : String(wheelDailyUsage.realPayoutUsdt);
  const budgetText = budget ? budgetNumber(text(budget.value, "")) : "";
  const budgetLeft = usedPayout !== null && budgetText ? decimalMinus(budgetText, usedPayout) : null;
  const budgetSpent = budgetLeft !== null && (budgetLeft.startsWith("-") || /^0(\.0+)?$/.test(budgetLeft));
  const tierUsage = new Map((wheelDailyUsage?.tiers ?? []).map((row) => [row.tierName, row.usedToday]));
  const conclusion = wheelBroken
    ? <Conclusion state="danger" lead icon={CircleAlert} hint="先处理「等你处理」第一行。">App 转盘现在抽不了{gapCount > 0 ? `，还有 ${gapsByEvent.length} 个活动缺翻译` : ""}</Conclusion>
    : todos.length > 0 ? <Conclusion state="warn" lead icon={ListChecks}>有 {todos.length} 件事等你处理</Conclusion>
    : <Conclusion state="ok" icon={ListChecks} explain="只按这页读到的既有活动、转盘奖池和护栏判断；用户能不能抽还看开始时间、资格和当天库存。玩法和抽奖在「玩法与抽奖」页签。">{h4Stats.ongoing == null ? "—" : numericValue(h4Stats.ongoing)} 个既有活动进行中，转盘奖池没有查出问题，没有等你处理的事</Conclusion>;

  return <div className="h4l">
    {recovery}
    {conclusion}
    <StatBand label="既有活动与转盘的关键数">
      <Stat label="进行中的既有活动" value={h4Stats.ongoing == null ? "—" : numericValue(h4Stats.ongoing)} unit="个" icon={CircleDot} tone="role-3" sub={`主推：${text(h4Stats.featuredEv, "--") === "--" ? "—" : text(h4Stats.featuredEv)}`} explain="按活动存的状态数「进行中」的个数（不看删除状态）。限地区的活动数：系统没有这项数据。紧急处理去「紧急停用开关」。" />
      <Stat label="可追踪活动参与" value={h4Stats.trackJoin == null ? "—" : numericValue(h4Stats.trackJoin)} unit="人次" icon={ListChecks} tone="role-3" sub={`达标 ${h4Stats.trackDone == null ? "—" : numericValue(h4Stats.trackDone)} · 已领 ${h4Stats.trackClaim == null ? "—" : numericValue(h4Stats.trackClaim)}`} explain="开了「统计效果」的活动的参与、达标、领取次数合计，不是转化率。" />
      <Stat label="每次抽奖估计发出" value={wheelEvUsdt == null ? "—" : amountText(wheelEvUsdt)} unit="USDT" icon={Coins} tone="role-1"
        sub={wheelEvOthers.length ? `另有 ${wheelEvOthers.map(([asset, value]) => `${amountText(value)} ${asset === "NEX" ? "UVT" : asset}`).join("、")}` : model.wheelEvByAsset && Object.keys(model.wheelEvByAsset).length === 0 ? "没有发真钱的档" : "按概率估算，不是实发"}
        explain={<><p>只算发真钱的档：每档「每次发放 × 概率」算到 6 位小数再相加，币种分开算。</p><p>这是按概率的估算，不计库存用完和改发安慰奖；实际发了多少看「今天已发真钱」。</p></>} />
      <Stat label="今天已发真钱" value={usedPayout === null ? "—" : amountText(usedPayout)} unit={usedPayout === null ? undefined : "USDT"} icon={Disc3} tone="role-2"
        sub={wheelDailyUsageError ? "今天的用量没读到" : !wheelDailyUsage ? "正在读取…" : <>抽奖 <span className="h4-num">{wheelDailyUsage.spinCount}</span> 次 · UTC <span className="h4-num">{wheelDailyUsage.serverDate.slice(5)}</span></>}
        explain={<><p>转盘今天发出的 USDT 真钱奖合计，和每日预算比的就是这个数。抽奖次数含每日免费抽奖和签到加抽。</p><p>{USAGE_DAY}</p></>}
        onOpen={() => go("wheel", "h4l-guards")} openLabel="看预算和各档今天的用量" />
    </StatBand>
    {todos.length > 0 && <Panel title="等你处理" icon={ListChecks} tone="role-3" sub={`${todos.length} 件`}>
      <ul className="h4-todo">{todos.map((todo) => <li key={todo.key}><button type="button" onClick={todo.onOpen}>{todo.tag}<span className="h4-todo-title">{todo.title}</span><span className="h4-todo-sub">{todo.sub}</span></button></li>)}</ul>
    </Panel>}
    <div hidden={sub !== "events"} className="h4-tabpanel">
      <Panel id="h4l-events" title="既有活动" icon={Gift} tone="role-3" sub={`共 ${events.length} 个`}
        explain={<><p>平台内置的运营活动，一张卡一个：中文名称和说明、奖励、参与条件、时间、参与情况。卡底部改三语内容，右下角开放、结束、主推和删除。</p><p>同时只能有一个进行中的主推活动。时间来自「七类玩法」里这个活动的开放时间。</p></>}
        actions={<Button icon={<Plus size={14} aria-hidden />} disabledReason={!canModuleWrite ? "没有新建既有活动的权限" : undefined} onClick={conflictDraft.register(JSON.stringify(["openCreateEvent:1"]), openCreateEvent)}>新建既有活动</Button>}>
        {gapCount > 0 && <Notice tone="warn" title={`有 ${gapCount} 项翻译没填，相关活动不能设为「进行中」`}>
          {gapsByEvent.slice(0, 6).map((row) => eventName(row.event.id)).join("、")}{gapsByEvent.length > 6 ? ` 等 ${gapsByEvent.length} 个活动` : ""}，在卡片底部逐格补。
        </Notice>}
        {events.length === 0 ? <BlockState state="empty" title="还没有既有活动" detail="点右上角「新建既有活动」登记一个。" />
          : <div className="h4-cards">{events.map((event) => <EventCard key={event.id} event={event}
            zh={{ name: localizedValue(event.id, "name", "zh"), description: localizedValue(event.id, "description", "zh"), rewardName: localizedValue(event.id, "rewardName", "zh") }}
            gaps={missingFor(event).length}
            rule={rules ? (() => { const rule = ruleOf(event.id); return rule ? { enabled: rule.enabled, ready: rule.readiness.ready, startsAt: rule.startsAt, endsAt: rule.endsAt } : null; })() : null}
            pending={eventPending(event.id) ? pendingTag(eventName(event.id)) : undefined}
            primary={eventPrimary(event)} menu={eventMenu(event)} onContent={() => setContentId(event.id)} />)}</div>}
        <p className="h4l-note">时间为北京时间</p>
      </Panel>
    </div>

    <div hidden={sub !== "plays"} className="h4-tabpanel">
      <H4EventRules ctx={ctx} onApprovalCompleted={reloadH4Approvals} onRowsChange={setRules} />
      <H4GenesisRaffle ctx={ctx} onApprovalCompleted={reloadH4Approvals} onRowsChange={setRaffles} />
    </div>

    <div hidden={sub !== "wheel"} className="h4-tabpanel">
      <Panel id="h4l-wheel" title="转盘奖池" icon={Disc3} tone="role-1" sub={`${tiers.length} 档 · 合计 ${percentText(probabilitySum)}%`}
        explain={<><p>每日免费抽奖和签到满 30 天的加抽共用这个奖池。真钱档概率调高，用户中真钱的次数变多，平台多付。</p><p>下面有一项不满足，App 整个转盘都抽不了：</p>
          <ul className="h4l-explain-list"><li>2–12 档</li><li>奖型只有 UVT、USDT、代金券</li><li>概率合计正好 100%</li><li>至少一档不发真钱的 UVT 安慰奖</li></ul></>}
        actions={<>{wheelPending && pendingTag("转盘奖池")}<Button variant="primary" disabledReason={!canWheelWrite ? "没有修改转盘奖池的权限" : h4ApprovalLockedReason(HI_WHEEL_SCOPE)} onClick={conflictDraft.register(JSON.stringify(["openWheelProbabilities:1"]), openWheelProbabilities)}>调整概率</Button><Button icon={<Plus size={14} aria-hidden />} disabledReason={!canWheelWrite ? "没有修改转盘奖池的权限" : h4ApprovalLockedReason(HI_WHEEL_SCOPE)} onClick={conflictDraft.register(JSON.stringify(["openCreateWheelTier:1"]), openCreateWheelTier)}>新建奖项</Button></>}>
        {wheelBroken && <Notice tone="danger" title="抽不了的原因">
          {[pointsTiers.length ? `${pointsTiers.map((tier) => text(tier.tier)).join("、")} 是积分奖型，后端已不支持：点「退役」后补足概率。` : "",
            probabilityOk ? "" : `概率合计 ${percentText(probabilitySum)}%，要在「调整概率」里补到 100%。`].filter(Boolean).map((line) => <p key={line}>{line}</p>)}
        </Notice>}
        {wheelDailyUsageError && <Notice tone="warn" title="今天的用量没读到" action={<Button size="sm" onClick={() => void reloadWheelUsage()}>重试</Button>}>已用次数和今天已发先显示「—」，不是 0；奖池其他内容照常。</Notice>}
        <div className="h4l-wheel-figure">
          <WheelBar tiers={tiers} />
          <div className="h4l-wheel-foot"><WheelLegend /><span className="h4l-sum" data-tone={probabilityOk ? undefined : "danger"}>合计 <b className="h4-num">{percentText(probabilitySum)}%</b>{probabilityOk ? "" : " · 不等于 100%"}</span></div>
        </div>
        <div id="h4l-tiers">
          {tiers.length === 0 ? <BlockState state="empty" title="奖池里还没有奖项" detail="点「新建奖项」添加；至少 2 档才能抽。" /> : <Table label="转盘奖项">
            <thead><tr><Th>奖项</Th><Th>奖品</Th><Th className="h4l-kind-col">类型</Th><Th align="right">每次发放</Th><Th align="right">概率</Th><Th align="right" className="h4l-per1k">每 1000 次约中</Th><Th align="right">今天已用 / 库存<Explain label="今天已用怎么算" content={<><p>每档今天实际发出的次数，改发的安慰奖算在安慰奖那一档。库存用完的档改发 UVT 安慰奖。</p><p>{USAGE_DAY}</p></>} /></Th><Th sticky="end">操作</Th></tr></thead>
            <tbody>{tiers.map((tier) => {
              const name = legacyName(tier.reward);
              const kindKey = text(tier.kind, "").toLowerCase();
              const unit = wheelUnit(tier);
              const kindNode = wheelPointsTier(tier) ? <StatusTag tone="danger" explain="后端已不支持积分奖型，要退役">积分奖型</StatusTag>
                  : wheelLegacyNexTier(tier) ? <StatusTag tone="warn" explain="后台存的是旧奖型，App 按 UVT 发奖。这一档不能编辑，可以调概率，调高要提交审批。">UVT · 旧奖型</StatusTag>
                  : <span className="h4l-kind">{WHEEL_KIND_LABEL[kindKey] ?? "其他奖励"}{boolValue(tier.real) && <StatusTag tone="warn" explain="这一档发真钱（USDT）：抽中前还要过真钱奖开关、覆盖率和每日预算，不过就改发 UVT 安慰奖。">发真钱</StatusTag>}</span>;
              /** 1024 宽时类型列收起，奖品格第二行只留要人注意的标签（奖品名已带币种）。 */
              const kindTag = wheelPointsTier(tier) || wheelLegacyNexTier(tier) ? kindNode : boolValue(tier.real) ? <StatusTag tone="warn" explain="这一档发真钱（USDT）：抽中前还要过真钱奖开关、覆盖率和每日预算，不过就改发 UVT 安慰奖。">发真钱</StatusTag> : null;
              return <Tr key={text(tier.tier)}>
                <Td><span data-mono="" className="h4l-nowrap">{text(tier.tier)}</span></Td>
                <Td><span className="h4l-reward"><span className="h4l-nowrap">{name.text}</span>{name.legacy && <LegacyNameTag where="奖项名称" />}</span>{kindTag && <span className="h4l-kind-sub">{kindTag}</span>}</Td>
                <Td className="h4l-kind-col">{kindNode}</Td>
                <Td align="right">{kindKey === "coupon" ? <span className="h4l-voucher"><span className="h4l-nowrap">1 张</span><small className="h4-dim" title={text(tier.voucherId, "未配券")}>{text(tier.voucherId, "未配券")}</small></span> : <span className="h4-num h4l-nowrap">{amountText(text(tier.amount, ""))} {unit}</span>}</Td>
                <Td align="right"><b className="h4-num">{percentText(tier.prob)}%</b><small className="h4l-per1k-sub h4-dim">千次约 <span className="h4-num">{percentText(numericValue(tier.prob) * 10)}</span></small></Td>
                <Td align="right" className="h4l-per1k"><span className="h4l-nowrap"><span className="h4-num">{percentText(numericValue(tier.prob) * 10)}</span> 次</span></Td>
                <Td align="right">{(() => {
                  const stock = numericValue(tier.dailyStock), used = tierUsage.get(text(tier.tier));
                  if (used === undefined) return stock === 0 ? <span className="h4-dim">不限</span> : <span className="h4l-nowrap"><span className="h4-dim">—</span> / <span className="h4-num">{stock}</span> 次</span>;
                  if (stock === 0) return <span className="h4l-nowrap"><b className="h4-num">{used}</b> 次 · <span className="h4-dim">不限</span></span>;
                  return <span className="h4l-stock"><span className="h4l-nowrap"><b className="h4-num" data-tone={used >= stock ? "warn" : undefined}>{used}</b> / <span className="h4-num">{stock}</span> 次</span>
                    <RatioBar compact quiet label={`${text(tier.tier)} 今天已用`} value={Math.min(used, stock)} total={stock} tone={used >= stock ? "warn" : "role-2"} valueText={`已用 ${used} 次，库存 ${stock} 次`} /></span>;
                })()}</Td>
                <Td sticky="end" data-fit=""><span className="h4-row h4l-ops">{wheelPointsTier(tier)
                  ? <Button size="sm" variant="danger-outline" aria-label={`退役 ${text(tier.tier)}（${name.text}）`} disabledReason={!canWheelWrite ? "没有修改转盘奖池的权限" : h4ApprovalLockedReason(HI_WHEEL_SCOPE)} onClick={conflictDraft.register(JSON.stringify(["openRetirePointsTier:1", tier.tier]), () => openRetirePointsTier(tier))}>退役</Button>
                  : <>
                    <Button size="sm" aria-label={`编辑 ${text(tier.tier)}（${name.text}）`} disabledReason={!canWheelWrite ? "没有修改转盘奖池的权限" : wheelLegacyNexTier(tier) ? "这一档存的是旧奖型，整档保存会把奖型改掉；要改只能调概率。" : h4ApprovalLockedReason(HI_WHEEL_SCOPE)} onClick={conflictDraft.register(JSON.stringify(["openEditWheelTier:1", tier.tier]), () => openEditWheelTier(tier))}>编辑</Button>
                    <Button size="sm" icon={<Trash2 size={13} aria-hidden />} aria-label={`删除 ${text(tier.tier)}（${name.text}）`} disabledReason={numericValue(tier.prob) !== 0 ? "先把概率调成 0%" : !canWheelWrite ? "没有修改转盘奖池的权限" : h4ApprovalLockedReason(HI_WHEEL_SCOPE)} onClick={conflictDraft.register(JSON.stringify(["openDeleteWheelTier:1", tier.tier]), () => openDeleteWheelTier(tier))}>删除</Button>
                  </>}</span></Td>
              </Tr>;
            })}</tbody>
          </Table>}
          <p className="h4l-note">「每 1000 次约中」按概率估算，不计库存用完和改发安慰奖<Explain label="改发安慰奖是什么" content="每次抽奖先按概率落档；这一档今天库存用完，或是真钱奖而开关关着、覆盖率不够、今天预算不够时，改发排在最前、还有库存的那一档不发真钱的 UVT。" /></p>
        </div>
        {awards !== undefined && <div className="h4l-awards"><Fold inset title="今天实际发出"
          summary={!awards?.available ? "读不到" : awardRows.length === 0 ? "今天还没有人抽" : <>真钱 <span className="h4-num">{amountText(awardUsdt?.amount ?? "0")}</span> USDT · 发奖 <span className="h4-num">{awardRows.reduce((sum, [, row]) => sum + row.count, 0)}</span> 次</>}
          explain={<><p>转盘今天真正发给用户的奖励，按奖型分开，不同币种不相加。代金券只记张数，面额不算钱。</p><p>{awards?.spinDate ? `统计日 UTC ${awards.spinDate}，` : ""}{USAGE_DAY}</p></>}>
          {!awards?.available ? <BlockState compact state="error" title={awards?.reason === "GROWTH_BUSINESS_TABLE_UNAVAILABLE" ? "抽奖记录暂时读不到" : "这次没读到"} detail={awards?.reason === "GROWTH_BUSINESS_TABLE_UNAVAILABLE" ? "不是没发奖。一直读不到请联系值班同事。" : "不是没发奖。点刷新重读。"} />
            : awardRows.length === 0 ? <p className="h4l-note">UTC {awards.spinDate?.slice(5) ?? "今天"} 还没有抽奖记录。</p>
            : <>
              <Table label="今天实际发出">
                <thead><tr><Th>奖型</Th><Th align="right">发出</Th><Th align="right">真钱金额</Th></tr></thead>
                <tbody>{awardRows.map(([asset, row]) => {
                  const kind = AWARD_ASSET[asset.toUpperCase()];
                  const money = row.realOutflowCount == null ? null : row.realOutflowCount > 0 ? row.amount : undefined;
                  return <Tr key={asset}>
                    <Td>{kind?.label ?? `其他奖励（${asset}）`}</Td>
                    <Td align="right"><span className="h4l-nowrap"><b className="h4-num">{row.count}</b> {asset.toUpperCase() === "COUPON" ? "张" : "笔"}</span></Td>
                    <Td align="right">{money ? <span className="h4l-nowrap"><b className="h4-num">{amountText(money)}</b> {asset.toUpperCase()}</span>
                      : <span className="h4-dim">{money === undefined ? kind?.noMoney ?? "不发真钱" : "—"}</span>}</Td>
                  </Tr>;
                })}</tbody>
              </Table>
              <p className="h4l-note">对照估算：每次抽奖估计发出 <b className="h4-num">{wheelEvUsdt == null ? "—" : amountText(wheelEvUsdt)}</b> USDT{h4Stats.wheelSpinsToday != null && <> · 今天抽奖 <b className="h4-num">{h4Stats.wheelSpinsToday}</b> 次</>}</p>
            </>}
        </Fold></div>}
      </Panel>
      <Panel id="h4l-guards" title="资金护栏" icon={Wallet} tone="role-1" sub={`${guards.length} 条`}
        explain="护栏保护平台的钱：真钱奖要同时过开关、覆盖率和每日预算才发出，不过就改发 UVT 安慰奖。调高预算、开启真钱奖要另一位超级管理员批准；调低、关闭立即生效。"
        actions={<Button icon={<Plus size={14} aria-hidden />} disabledReason={!canWheelWrite ? "没有修改转盘奖池的权限" : undefined} onClick={conflictDraft.register(JSON.stringify(["openCreateWheelGuard:1"]), openCreateWheelGuard)}>新建护栏</Button>}>
        {guards.length === 0 ? <BlockState state="empty" title="还没有护栏" detail="没有预算或开关时真钱奖一律改发 UVT 安慰奖。" /> : <div className="h4l-guards">
          {kill && <GuardCard title={GUARD_NAME.kill} icon={<Power size={14} aria-hidden />} value={killState ? "开" : "关"} valueTone={killState ? "ok" : "danger"}
            sub={killState ? "抽中 USDT 按预算和覆盖率发真钱" : "抽中 USDT 改发 UVT 安慰奖"}
            explain="关掉后不再发真钱奖，抽中 USDT 改发 UVT 安慰奖。从关到开要另一位超级管理员批准。"
            action={<Button size="sm" variant={killState ? "danger-outline" : undefined} disabledReason={!canWheelWrite ? "没有修改转盘奖池的权限" : h4ApprovalLockedReason(`H/h4_wheel_guard/${kill.key}`)} onClick={conflictDraft.register(JSON.stringify(["openWheelKill:1"]), () => openWheelKill(kill))}>{killState ? "关闭" : "开启"}</Button>} />}
          {budget && <GuardCard title={GUARD_NAME.budget} icon={<Wallet size={14} aria-hidden />} value={<><span className="h4-num">{amountText(budgetNumber(text(budget.value, "")))}</span><small>USDT / 天</small></>}
            explain={<><p>每次抽中真钱奖前，今天已发的真钱加上这一次超过预算，就改发 UVT 安慰奖。调高预算，平台每天最多多付；调低，更多真钱奖改发 UVT。后端按美元记，真钱奖只有 USDT。</p><p>今天已发{USAGE_DAY}</p></>}
            action={<Button size="sm" disabledReason={!canWheelWrite ? "没有修改转盘奖池的权限" : h4ApprovalLockedReason(`H/h4_wheel_guard/${budget.key}`)} onClick={conflictDraft.register(JSON.stringify(["openWheelBudget:1"]), () => openWheelBudget(budget))}>调整</Button>}>
            <div className="h4l-usage">
              {Number(budgetText) > 0 && <RatioBar label="今天已发占每日预算" quiet tone={budgetSpent ? "warn" : "role-1"} state={usedPayout === null ? wheelDailyUsageError ? "empty" : "loading" : "ready"}
                value={usedPayout === null ? 0 : Math.min(Number(usedPayout), Number(budgetText))} total={Number(budgetText)} valueText={`今天已发 ${usedPayout ?? "—"} USDT，预算 ${budgetText} USDT`} />}
              <span>今天已发 {usedPayout === null ? <span className="h4-dim">{wheelDailyUsageError ? "没读到" : "—"}</span> : <><b className="h4-num">{amountText(usedPayout)}</b> USDT{budgetLeft !== null && <> · {budgetSpent ? <span data-tone="warn">预算已用完，真钱奖改发 UVT</span> : <>还剩 <b className="h4-num">{amountText(budgetLeft)}</b> USDT</>}</>}</>}</span>
            </div>
          </GuardCard>}
          {cap && <GuardCard title={GUARD_NAME.cap} icon={<Ticket size={14} aria-hidden />} value={<small>按各档的每日库存</small>}
            sub={`${tiers.filter((tier) => numericValue(tier.dailyStock) > 0).length} 档限量，其余不限`}
            explain="每天每档最多发几次由奖项表的「每日库存」决定，这一条只是历史记录，不能改。" action={<StatusTag tone="neutral">历史只读</StatusTag>} />}
          {guards.filter((guard) => !["budget", "kill", "cap"].includes(guard.key)).map((guard) => <GuardCard key={guard.key} title={text(guard.label)} icon={<Gift size={14} aria-hidden />} value={text(guard.value)} explain="后端返回了这页不认识的护栏，只显示，不提供修改。" />)}
        </div>}
      </Panel>
    </div>

    <Drawer open={!!contentEvent} onClose={() => setContentId(null)} title="三语内容与 App 上的样子" sub={contentEvent?.id}
      explain="改一格保存一格，下次读取 App 就用新内容，不用发布。中文和越南语的名称、说明、奖项名都填齐，活动才能开放；英文没填时 App 用原文。">
      {contentEvent && <EventPreview canEdit={canModuleWrite} lockedReason={h4ApprovalLockedReason(hiEventScope(contentEvent.id))}
        names={Object.fromEntries((["zh", "en", "vi"] as const).map((locale) => [locale, { name: localizedValue(contentEvent.id, "name", locale), description: localizedValue(contentEvent.id, "description", locale), rewardName: localizedValue(contentEvent.id, "rewardName", locale) }])) as Record<LocaleCode, Record<"name" | "description" | "rewardName", string>>}
        original={{ name: text(contentEvent.name, ""), description: text(contentEvent.description, ""), rewardName: text(contentEvent.rewardName, "") }}
        onEdit={(field, locale) => openLocalizedContent(contentEvent.id, field, locale, field === "name" ? contentEvent.name : field === "description" ? text(contentEvent.description) : text(contentEvent.rewardName))} />}
    </Drawer>
  </div>;
}
