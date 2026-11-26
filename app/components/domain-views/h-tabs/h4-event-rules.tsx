"use client";

import { fetchOperatingLanguages, OPERATING_LANGUAGE_CODES, type OperatingLanguageCode } from "@/lib/admin/platform-experience-client";
import { ConfirmReadConflict, PendingConfirmRejected, hConflictFields, type HConflictField } from "@/lib/admin/h-conflict-review";
import { isH4ReadConflict } from "@/lib/admin/h-write-conflict";
import { HApprovalRequired } from "@/lib/admin/h-approval-required";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { CalendarRange, CircleAlert, CircleCheck, Lock, Settings2, Sparkles } from "lucide-react";
import type { HCtx } from "./types";
import { fetchEventRules, fetchEventVouchers, parseEventRule, updateEventRule, type EventRuleReadiness, type EventRuleView, type EventRuleChange, type EventVoucherOption } from "@/lib/admin/event-rules-client";
import { EVENT_KIND_LABELS, eventRuleDraftRules, eventRuleFields, eventRuleMissingLabel, eventRuleReadiness, eventRegionText, parseEventRegions, type EventLocalizedContent } from "@/lib/admin/event-rule-form";
import { displayAdminError, displayAdminReadError, formatAdminApiError } from "@/lib/admin/error-messages";
import { isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { isDeterministicRejection } from "@/lib/admin/outcome-classification";
import { APP_VISIBLE_TEXT_HINT, appVisibleTextError } from "@/lib/admin/content-language-rules";
import { beginH4RuleRead, markH4Read, assertH4Fresh, h4ReadVersion, h4Blocked, h4ApprovalLockedReason, h4PendingFor, h4PendingConfirmRecovery, pendingH4Commands, retryH4Command, isH4ApprovalReceipt, h4TicketResult, confirmedH4Saves, type H4ReopenRejected } from "@/lib/admin/h4-mutations";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { useH4EditGuard, useH4Editor } from "./h4-edit-guard";
import { BlockState, Button, Check, Decision, Drawer, Fact, Facts, Field, Input, Notice, Panel, Segments, Select, StatusTag, Textarea } from "@/app/components/rd";
import { formatTime } from "./h4-promotion-ui";
import { ApprovalFact, h4OpeningReadFailure, h4ReadConflict, H4StaleNote, H4_MISSING_ORIGINAL, H4_OLD_RECORD_REJECTED, H4_UNKNOWN_SAVE, LOCALE_NAME, effectApproval, effectDirect, effectDraft, useH4DrawerFocus, type LocaleCode } from "./h4-legacy-parts";
import { H4ConflictCompare, h4ConflictGroups, type H4ConflictGroup } from "./h4-conflict-compare";
import { hApprovalReconfirm } from "./h-approval-reconfirm";
import { amountDisplay } from "@/lib/format";

/** 每类玩法一句人话：用户做什么、拿到什么（字段见 H4EventRuleService 的规则闭集）。 */
const PLAY_SENTENCE: Record<string, string> = {
  discount: "买关联促销的设备，多得创世抽奖券。",
  seasonal: "商城领全场八折券，关联促销再送抽奖券。",
  referral: "期限内直邀够人数购机，送赠品设备。",
  onboarding: "新用户期限内到等级，送 UVT 和补签卡。",
  regional: "地区按支付额排名，获胜地区分 USDT 奖池。",
  CHECKIN_MULTIPLIER: "指定星期签到，UVT 奖励按倍数加成。",
  REINVEST_TICKETS: "每锁定一档 USDT，送创世抽奖券。",
  wheel: "每天免费抽一次，奖品在「转盘奖池」。",
};
const playKey = (row: Pick<EventRuleView, "kind" | "rules">) => row.kind === "boost" ? String(row.rules.action ?? "") : row.kind;
const value = (rules: Record<string, unknown>, key: string) => rules[key] === undefined || rules[key] === null || rules[key] === "" ? "—" : String(rules[key]);
/** 金额参数按全站写法显示（amountDisplay）；读不到写「—」。 */
const money = (rules: Record<string, unknown>, key: string) => { const raw = value(rules, key); return raw === "—" ? raw : amountDisplay(raw); };
const unset = (text: string) => /—/.test(text) ? "未配置" : text;

function hasRuleChanges(base: EventRuleView, next: EventRuleChange) {
  const opened = { enabled: base.enabled, startsAt: base.startsAt, endsAt: base.endsAt, rules: eventRuleDraftRules(base) };
  return hConflictFields(opened, opened, next, (path, before, after) => {
    if ((path === "startsAt" || path === "endsAt") && typeof before === "string" && typeof after === "string") {
      const time = Date.parse(before);
      if (Number.isFinite(time)) return time === Date.parse(after);
    }
    return Object.is(before, after);
  }).some(field => field.changedByMe);
}

/** 卡上写的关键参数：用户拿到什么、平台最多付多少。 */
function keyParams(row: Pick<EventRuleView, "kind" | "rules">): Array<[string, string]> {
  return rawParams(row).map(([k, v]) => [k, unset(v)]);
}
function rawParams(row: Pick<EventRuleView, "kind" | "rules">): Array<[string, string]> {
  const r = row.rules;
  switch (playKey(row)) {
    case "referral": return [["门槛", `邀请 ${value(r, "targetInvites")} 人 · ${value(r, "windowDays")} 天内`], ["每人得", `${value(r, "giftQuantity")} 台 ${value(r, "giftProductNo")}`], ["平台最多付", `${value(r, "deviceBudget")} 台设备`]];
    case "onboarding": return [["门槛", `注册 ${value(r, "windowDays")} 天内到 V${value(r, "minRank")}`], ["每人得", `${money(r, "rewardNex")} UVT + ${value(r, "streakSavers")} 张补签卡`], ["平台最多付", `${money(r, "budgetNex")} UVT`]];
    case "regional": return [["参赛地区", Array.isArray(r.regions) ? `${r.regions.length} 个` : "—"], ["平台最多付", `${money(r, "poolUsdt")} USDT 奖池`]];
    case "CHECKIN_MULTIPLIER": return [["加成", `签到 UVT × ${value(r, "multiplier")}`], ["生效", Array.isArray(r.weekdays) && r.weekdays.length ? (r.weekdays as number[]).map((day) => `周${"一二三四五六日"[day - 1] ?? "?"}`).join("、") : "—"], ["平台最多付", `${money(r, "budgetNex")} UVT`]];
    case "REINVEST_TICKETS": return [["门槛", `每锁定 ${money(r, "thresholdUsdt")} USDT`], ["每档得", `${value(r, "ticketsPerThreshold")} 张抽奖券`], ["平台最多付", `${value(r, "ticketBudget")} 张抽奖券`]];
    case "discount": return [["关联促销", value(r, "promotionActivityId")], ["每人得", `${value(r, "extraGenesisTickets")} 张抽奖券`], ["平台最多付", `${value(r, "ticketBudget")} 张抽奖券`]];
    case "seasonal": return [["八折券", value(r, "voucherId")], ["每人得", `${value(r, "extraGenesisTickets")} 张抽奖券`], ["平台最多付", `${value(r, "ticketBudget")} 张抽奖券`]];
    default: return [];
  }
}

export default function H4EventRules({ ctx, eventContent, requiredLanguages = OPERATING_LANGUAGE_CODES, contentRefresh, onRowsChange, onApprovalCompleted, confirmRecovery, reopenRejected, readSaved }: {
  ctx: HCtx;
  eventContent?: Record<string, EventLocalizedContent>;
  requiredLanguages?: readonly OperatingLanguageCode[];
  contentRefresh?: number;
  onApprovalCompleted?: () => Promise<void>;
  onRowsChange?: (rows: EventRuleView[] | null) => void;
  confirmRecovery: typeof h4PendingConfirmRecovery;
  reopenRejected: RefObject<H4ReopenRejected | null>;
  readSaved: RefObject<((shouldClose: (scope: string) => boolean) => Promise<boolean>) | null>;
}) {
  const [ruleRows, setRuleRows] = useState<EventRuleView[] | null>(null);
  const rows = ruleRows ?? [];
  const [selected, setSelected] = useState<EventRuleView | null>(null);
  const [draft, setDraft] = useState<EventRuleChange | null>(null), [regions, setRegions] = useState("");
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [vouchers, setVouchers] = useState<EventVoucherOption[]>([]), [voucherLoading, setVoucherLoading] = useState(false), [voucherError, setVoucherError] = useState(""), [voucherRetry, setVoucherRetry] = useState(0);
  const [readError, setReadError] = useState("");
  const generation = useRef(0);
  const canRead = ctx.can("growth_h4_read"), canWrite = ctx.can("growth_h4_write");
  const canReadVouchers = ctx.can("growth_h7_read");
  const operator = currentAdminOperator();
  const previousOperator = useRef(operator);
  const choose = (row: EventRuleView) => { setConflictFields(null); setStale(""); setMerged(0); setSelected(row); setDraft({ enabled: row.enabled, startsAt: row.startsAt, endsAt: row.endsAt, rules: eventRuleDraftRules(row) }); setRegions(eventRegionText(row.rules.regions)); setError(""); };
  const [, pendingChanged] = useState(0);
  /** 保存被「别人先改过」拒绝、已重读后的提醒；只决定显示。 */
  const [stale, setStale] = useState("");
  const [conflictFields, setConflictFields] = useState<HConflictField[] | null>(null);
  /** 合并后回到表单：放回了几项自己改的。只决定显示。 */
  const [merged, setMerged] = useState(0);
  const load = async (preserve = false) => {
    const own = ++generation.current; setLoading(true); setReadError("");
    const readIsCurrent = beginH4RuleRead();
    try {
      const values = await fetchEventRules();
      if (own !== generation.current || !readIsCurrent()) return null;
      setRuleRows(values);
      markH4Read("rules", true);
      if (!preserve) close();
      return values;
    }
    catch (cause) { if (own === generation.current && readIsCurrent()) setReadError(displayAdminReadError(cause)); return null; }
    finally { if (own === generation.current) setLoading(false); }
  };
  useEffect(() => {
    if (!canRead || previousOperator.current !== operator) {
      setRuleRows(null);
      setReadError("");
    }
    previousOperator.current = operator;
    setSaving(false); setError(""); setSelected(null); setDraft(null);
    if (canRead) void load(); else setLoading(false);
    return () => { generation.current += 1; };
  }, [canRead, operator, contentRefresh]);
  useEffect(() => { onRowsChange?.(readError || !canRead ? null : ruleRows); }, [ruleRows, canRead, readError]);
  useEffect(() => {
    let alive = true; setVouchers([]); setVoucherError(""); setVoucherLoading(false);
    if (selected?.kind !== "seasonal" || !canRead || !canReadVouchers) return;
    setVoucherLoading(true);
    fetchEventVouchers().then(values => { if (alive) setVouchers(values); })
      .catch(cause => { if (alive) setVoucherError(displayAdminReadError(cause)); })
      .finally(() => { if (alive) setVoucherLoading(false); });
    return () => { alive = false; };
  }, [selected?.eventCode, selected?.kind, canRead, canReadVouchers, operator, voucherRetry]);
  useEffect(() => {
    const changed = () => pendingChanged(v => v + 1);
    window.addEventListener("admin-h4-pending-changed", changed);
    return () => { window.removeEventListener("admin-h4-pending-changed", changed); };
  }, []);
  const patchRule = (key: string, value: unknown) => setDraft(current => current ? { ...current, rules: { ...current.rules, [key]: value } } : current);
  const save = (restored?: { base: EventRuleView; draft: EventRuleChange; rejection: PendingConfirmRejected }, after?: () => void) => {
    const base = restored?.base ?? selected, input = restored?.draft ?? draft;
    if (base && confirmedH4Saves().some(record => record.scope === `H/h4_event_rule/${base.eventCode}`)) return;
    if (!base || !input || !canWrite || !restored && (saving || conflictFields)) return;
    const next = { ...input, rules: { ...input.rules } };
    if (base.kind === "regional" && !restored) {
      const baseRegionText = eventRegionText(base.rules.regions);
      const baseRules = eventRuleDraftRules(base);
      const disableOnly = base.enabled && !next.enabled
        && (["startsAt", "endsAt"] as const).every(key => next[key]?.replace(/\.000Z$/, "Z") === base[key]?.replace(/\.000Z$/, "Z"))
        && JSON.stringify(next.rules) === JSON.stringify(baseRules)
        && regions === baseRegionText;
      if (disableOnly) {
        // Keep the exact stored rules and timestamps in a status-only write.
        next.rules = base.rules;
        next.startsAt = base.startsAt;
        next.endsAt = base.endsAt;
      } else {
        let parsedRegions: ReturnType<typeof parseEventRegions>;
        try { parsedRegions = parseEventRegions(regions); }
        catch (cause) { setError(displayAdminError(cause)); return; }
        for (const [index, region] of parsedRegions.entries()) {
          const nameError = appVisibleTextError(region.name, `第 ${index + 1} 个地区名称`);
          if (nameError) { setError(nameError); return; }
        }
        if (regions !== baseRegionText) next.rules.regions = parsedRegions;
      }
    }
    const changed = hasRuleChanges(base, next);
    if (!changed && !restored) return;
    const firstOpen = next.enabled && !base.enabled && !base.rulesLocked;
    // 没开过、这次也不开：只存草稿，用户侧不变（OP-25）。
    const draftOnly = !base.enabled && !next.enabled;
    // 要去的地方只属于这一次保存：被拒、结果未知就作废，之后的普通关闭只关这个抽屉。
    let onward = after;
    /** 有了确定的成功，发出去成功和查到原结果走同一个后续。 */
    const finished = (message: string) => {
      ctx.toast(message);
      if (onward) { close(); onward(); }
    };
    let readVersion = h4ReadVersion("rules");
    let verifiedVersion: number | undefined;
    const missingRule = () => new ConfirmReadConflict({
      readLatest: async () => {
        if (!await load()) throw new Error("玩法规则加载失败");
        ctx.openActionConfirm(null);
      },
      renderNotice: readLatest => <Notice tone="warn" title="最新读取里没有这项活动"
        action={<Button size="sm" onClick={readLatest}>读取最新列表</Button>}>你填的内容没有提交。</Notice>,
    });
    const compareLatest = (latest: EventRuleView) => {
      setSelected(latest); setDraft(next);
      const opened = { enabled: base.enabled, startsAt: base.startsAt, endsAt: base.endsAt, rules: eventRuleDraftRules(base) };
      const current = { enabled: latest.enabled, startsAt: latest.startsAt, endsAt: latest.endsAt, rules: eventRuleDraftRules(latest) };
      setConflictFields(hConflictFields(opened, current, next));
      setStale(`${EVENT_KIND_LABELS[base.kind] ?? "其他活动"} · ${base.eventCode}`);
      ctx.openActionConfirm(null);
    };
    const readFirstOpen = async (): Promise<[EventRuleView[], readonly OperatingLanguageCode[]]> => {
      try { return await Promise.all([fetchEventRules(), fetchOperatingLanguages()]); }
      catch (cause) {
        if (isPermissionDenied(cause)) throw cause;
        throw h4OpeningReadFailure(cause, async () => {
          const [latest, required] = await readFirstOpen();
          const current = latest.find(row => row.eventCode === base.eventCode);
          if (!current) throw missingRule();
          if (current.revision !== base.revision || current.enabled !== base.enabled) {
            setRuleRows(latest);
            compareLatest(current);
            return;
          }
          checkFirstOpen(current, required);
          readVersion = verifiedVersion = h4ReadVersion("rules");
          return true;
        });
      }
    };
    const checkFirstOpen = (current: EventRuleView, required: readonly OperatingLanguageCode[]) => {
      const readiness = eventRuleReadiness(current, eventContent, required);
      const missing = readiness.missing.filter(key => key.startsWith("localized."));
      if (missing.length || readiness.incomplete?.length) {
        throw new Error(formatAdminApiError("EVENT_RULE_INCOMPLETE", "", "write", { missing, incomplete: readiness.incomplete }));
      }
    };
    const rereadConflict = () => h4ReadConflict(async () => {
      const values = await load(true);
      if (!values) throw new Error("玩法规则加载失败");
      const latest = values.find(row => row.eventCode === base.eventCode);
      if (!latest) throw restored ? new ConfirmReadConflict(undefined, H4_MISSING_ORIGINAL, true) : missingRule();
      compareLatest(latest);
    });
    const rejected = (error: PendingConfirmRejected) => error.reasonCode === "EVENT_NOT_FOUND" || error.reasonCode === "EVENT_RULE_NOT_FOUND"
      ? missingRule() : isH4ReadConflict(error) ? rereadConflict() : error;
    let originalKey: string | undefined;
    const pending = () => originalKey ? pendingH4Commands().find(record => record.commandKey === originalKey) : h4PendingFor(`H/h4_event_rule/${base.eventCode}`);
    ctx.openActionConfirm({ formKey: restored ? 0 : undefined, initialRejection: restored && rejected(restored.rejection), getPendingReason: () => pending()?.reason, briefKind: "config", action: `${next.enabled ? "保存并启用" : "保存关闭状态"} · ${base.eventCode}`,
      getPendingRecovery: () => {
        const record = pending();
        return confirmRecovery(record, async () => {
          await onApprovalCompleted?.();
          if (!await load()) throw new Error("已保存，但最新数据加载失败");
          ctx.openActionConfirm(null);
          finished("活动规则已保存");
        }, rejected);
      },
      title: firstOpen ? "开启玩法" : base.enabled && !next.enabled ? "关闭玩法" : draftOnly ? "保存玩法草稿" : "保存玩法配置",
      // 影响写这次保存的真实后果（OP-53）：第一次开启、关闭、只存草稿各不相同。
      statedBrief: firstOpen ? { impact: "批准后玩法开启，活动对用户开放。", check: "核对玩法、时间和平台最多付，理由写清依据。" }
        : base.enabled && !next.enabled ? { impact: "保存后玩法马上关闭。", check: "确认要关的是这个玩法，理由写清依据。" }
        : base.enabled ? { impact: "玩法继续开着，参与条件和时间不变。", check: "核对玩法和时间，理由写清依据。" }
        : next.enabled ? { impact: "开过又关了的玩法不能再开，这次保存会被拒绝。", check: "关过的玩法只能保持关闭。" }
        : { impact: "只保存配置，玩法仍关着，用户看不到变化。", check: "核对参与条件和时间，理由写清依据。" },
      effect: firstOpen ? effectApproval("玩法") : draftOnly ? effectDraft : effectDirect,
      detail: <>更新本活动的参与条件、奖励及有效期。{next.enabled ? "启用后符合条件的用户可参与；保存时会检查配置与奖励预算。" : "保存后活动保持关闭，不发放新奖励。"}</>,
      facts: <>
        {merged > 0 && <H4StaleNote />}
        <Facts>
          <Fact k="玩法">{EVENT_KIND_LABELS[base.kind] ?? "其他活动"} · {base.eventCode}</Fact>
          <Fact k="开放状态">{base.enabled === next.enabled ? (next.enabled ? "开着" : "关着") : <>{base.enabled ? "开着" : "关着"} → {next.enabled ? "开启" : "关闭"}</>}</Fact>
          <Fact k="时间（北京时间）">{formatTime(next.startsAt, "Asia/Shanghai")} → {formatTime(next.endsAt, "Asia/Shanghai")}</Fact>
          {next.enabled ? <Fact k="开了以后">{PLAY_SENTENCE[playKey({ kind: base.kind, rules: next.rules })] ?? "符合条件的用户可以参与"}</Fact>
            : !draftOnly && <Fact k="关了以后">不再发新奖励；已冻结的邀请和新手资格仍会兑现。开过一次的玩法关闭后不能再开</Fact>}
          {next.enabled && keyParams({ kind: base.kind, rules: next.rules }).filter(([k]) => k === "平台最多付").map(([k, v]) => <Fact key={k} k={k} tone="role-1">{v}</Fact>)}
          {firstOpen && <Fact k="开启后固定">玩法和时间不能再改，只能关闭；关了不能再开</Fact>}
          {firstOpen && <ApprovalFact amplify="第一次开启" object="玩法" />}
        </Facts>
      </>,
      confirmLabel: firstOpen ? "提交审批" : draftOnly ? "保存草稿" : base.enabled && !next.enabled ? "确认关闭" : "保存配置",
      reasonPlaceholder: firstOpen ? "例如：活动素材和预算已确认，申请开启" : "例如：按活动方案调整参与条件",
      amplifies: firstOpen,
      blockedReason: changed ? undefined : "没有改动",
      run: async reason => {
        if (operator !== currentAdminOperator() || !ctx.can("growth_h4_write")) throw new Error("登录身份或权限已变化，请重新打开活动配置。");
        const own = generation.current; setSaving(true); setError("");
        const complete = async (result: unknown) => {
          if (own !== generation.current) return;
          if (isH4ApprovalReceipt(result)) await onApprovalCompleted?.();
          await load();
          if (isH4ApprovalReceipt(result)) { setSelected(null); setDraft(null); }
          finished(isH4ApprovalReceipt(result) ? h4TicketResult(result.ticket) : "活动规则已保存");
        };
        try {
          const original = originalKey ? pendingH4Commands().find(r => r.commandKey === originalKey) : undefined;
          if (!original) {
            assertH4Fresh("rules", readVersion);
            if (firstOpen && verifiedVersion !== readVersion) {
              const [latest, required] = await readFirstOpen();
              const current = latest.find(row => row.eventCode === base.eventCode);
              if (!current) throw missingRule();
              if (current.revision !== base.revision || current.enabled !== base.enabled) throw new Error("H4_REFRESH_REQUIRED");
              assertH4Fresh("rules", readVersion);
              checkFirstOpen(current, required);
            }
            verifiedVersion = undefined;
          }
          const saved = original ? await retryH4Command(original) : await updateEventRule(base.eventCode, next, base.revision, reason, firstOpen, base);
          await complete(saved);
        } catch (cause) {
          // 直接保存被判定要走审批：换成审批确认，内容和理由沿用（H-改走审批）。
          if (!(cause instanceof HApprovalRequired)) onward = undefined;
          if (cause instanceof HApprovalRequired) {
            ctx.openActionConfirm(null);
            ctx.openConfirm(hApprovalReconfirm(cause, { action: `${next.enabled ? "保存并启用" : "保存关闭状态"} · ${base.eventCode}`, title: "保存玩法配置", reason,
              completed: complete, hasPending: () => !!h4PendingFor(`H/h4_event_rule/${base.eventCode}`),
              onUnknown: () => { ctx.closeConfirm?.(); setSelected(null); setDraft(null); }, approver: "另一位超级管理员", holds: "玩法", extra: <Fact k="玩法">{EVENT_KIND_LABELS[base.kind] ?? "其他活动"} · {base.eventCode}</Fact> }));
            return;
          }
          if (cause instanceof ConfirmReadConflict) throw cause;
          const failure = cause as { status?: number; apiCode?: number; reasonCode?: string; unknownOutcome?: boolean; bodyUnreadable?: boolean } | null;
          if (failure && !failure.unknownOutcome && !failure.bodyUnreadable && isDeterministicRejection(failure.status ?? 0, failure.apiCode)
            && (failure.reasonCode === "EVENT_NOT_FOUND" || failure.reasonCode === "EVENT_RULE_NOT_FOUND")) throw missingRule();
          if (isH4ReadConflict(cause) && !originalKey) {
            throw rereadConflict();
          }
          if (own === generation.current) setError(displayAdminError(cause));
          if (originalKey && !h4PendingFor(`H/h4_event_rule/${base.eventCode}`)) { ctx.openActionConfirm(null); await load(); }
          throw cause;
        }
        finally { originalKey = h4PendingFor(`H/h4_event_rule/${base.eventCode}`)?.commandKey; setSaving(false); }
      },
    });
  };
  useLayoutEffect(() => {
    reopenRejected.current = async (record, rejection) => {
      if ("proposal" in record.request) return;
      const code = decodeURIComponent(record.request.path.split("/")[2]);
      const body = JSON.parse(record.request.body) as EventRuleChange & { expectedRevision: number };
      const values = await load(true);
      if (!values) throw new ConfirmReadConflict(undefined, "玩法规则加载失败");
      const latest = values.find(row => row.eventCode === code);
      if (!latest) throw new ConfirmReadConflict(undefined, H4_MISSING_ORIGINAL, true);
      if (rejection.reasonCode === "EVENT_RULE_NOT_FOUND" || rejection.reasonCode === "EVENT_NOT_FOUND") {
        throw new ConfirmReadConflict(undefined, "这个玩法已被别人改过，原来的操作现在不能再做；你填的内容没有提交，请按最新状态重新操作。", true);
      }
      if (!ctx.can("growth_h4_write") || operator !== currentAdminOperator()) return;
      const base = record.opened ? parseEventRule(record.opened) : latest;
      if (!base || base.eventCode !== code || base.revision !== body.expectedRevision) {
        return () => { choose(latest); setError(H4_OLD_RECORD_REJECTED); };
      }
      const draft = { enabled: body.enabled, startsAt: body.startsAt, endsAt: body.endsAt, rules: body.rules };
      const error = base.revision === latest.revision || isH4ReadConflict(rejection) ? rejection : new PendingConfirmRejected("H4_REFRESH_REQUIRED");
      return () => {
        choose(base); setDraft(draft); setRegions(eventRegionText(draft.rules.regions));
        save({ base, draft, rejection: error });
      };
    };
    return () => { reopenRejected.current = null; };
  });
  const close = () => { setConflictFields(null); setSelected(null); setDraft(null); setError(""); };
  // 改过的地区名称含中文时写在框下，和保存时拦下的是同一句。
  const regionNameError = selected?.kind === "regional" && regions !== eventRegionText(selected.rules.regions)
    ? regions.split(/\r?\n/).filter(line => line.trim()).map((line, index) => appVisibleTextError(line.split(":")[0].trim(), `第 ${index + 1} 个地区名称`)).find(Boolean)
    : undefined;
  // 三方对比：项名、显示写法照表单；数字原样写，不舍入。
  const review = selected && draft ? conflictFields : null;
  const compareGroups: H4ConflictGroup[] = review && selected ? h4ConflictGroups(review,
    path => path.startsWith("rules.") ? path.split(".").slice(0, 2).join(".") : path.split(".")[0],
    key => key === "enabled" ? "开放状态" : key === "startsAt" ? "开始时间（北京时间）" : key === "endsAt" ? "结束时间（北京时间）"
      : eventRuleFields({ kind: selected.kind, rules: eventRuleDraftRules(selected) }).find(field => `rules.${field.key}` === key)?.label ?? "其他参数",
    (key, raw) => key === "enabled" ? raw === true ? "开启" : raw === false ? "关闭" : "—"
      : key === "startsAt" || key === "endsAt" ? formatTime(raw as string | null, "Asia/Shanghai")
      : key === "rules.regions" ? eventRegionText(raw).split("\n").join("；") || "—"
      : key === "rules.weekdays" ? Array.isArray(raw) && raw.length ? (raw as number[]).map(day => `周${"一二三四五六日"[day - 1] ?? "?"}`).join("、") : "—"
      : raw === undefined || raw === null || raw === "" ? "—" : Array.isArray(raw) ? raw.join("、") : String(raw)) : [];
  // 合并：最新配置为底，放回自己改过的项；回表单后照常保存（新确认框、新理由）。
  const mergeLocked = selected?.rulesLocked && compareGroups.some(group => group.byMe && (group.key !== "enabled" || !selected.enabled && !!draft?.enabled));
  const mergeConflict = () => {
    if (!selected || !draft || mergeLocked) return;
    const latest = selected, mine = draft, next: EventRuleChange = { enabled: latest.enabled, startsAt: latest.startsAt, endsAt: latest.endsAt, rules: eventRuleDraftRules(latest) };
    const kept = compareGroups.filter(group => group.byMe);
    for (const group of kept) {
      if (group.key.startsWith("rules.")) next.rules[group.key.slice(6)] = mine.rules[group.key.slice(6)];
      else if (group.key === "enabled") next.enabled = mine.enabled;
      else if (group.key === "startsAt" || group.key === "endsAt") next[group.key] = mine[group.key];
    }
    choose(latest); setDraft(next); setRegions(eventRegionText(next.rules.regions)); setMerged(kept.length);
  };
  const savedUnread = !!selected && confirmedH4Saves().some(record => record.scope === `H/h4_event_rule/${selected.eventCode}`);
  const unchanged = selected && draft && (() => {
    if (selected.kind !== "regional" || regions === eventRegionText(selected.rules.regions)) return !hasRuleChanges(selected, draft);
    try { return !hasRuleChanges(selected, { ...draft, rules: { ...draft.rules, regions: parseEventRegions(regions) } }); }
    catch { return false; }
  })();
  const focus = useH4DrawerFocus(!!selected && !!draft, "h4l-plays");
  const leave = useH4EditGuard();
  const scope = selected ? `H/h4_event_rule/${selected.eventCode}` : "";
  const openScope = useRef(scope);
  useLayoutEffect(() => {
    openScope.current = scope;
    readSaved.current = async shouldClose => {
      const rows = await load(true);
      if (rows && shouldClose(openScope.current)) close();
      return !!rows;
    };
    return () => { readSaved.current = null; };
  });
  const opening = !!selected && !!draft?.enabled && !selected.enabled && !selected.rulesLocked;
  // 没开过、这次也不开：只存草稿。
  const draftOnly = !!selected && !!draft && !selected.enabled && !draft.enabled;
  const saveLabel = draftOnly ? "保存草稿" : "保存配置";
  const saveReason = !canWrite ? "没有修改玩法的权限" : savedUnread ? "不用重新提交；关掉后点「刷新」，读到后再改。" : h4ReadVersion("rules") === undefined ? displayAdminError(new Error("H4_REFRESH_REQUIRED")) : review ? "先在上面选一种继续"
    : selected ? h4ApprovalLockedReason(scope) ?? (h4PendingFor(scope) ? H4_UNKNOWN_SAVE : unchanged ? "没有改动" : undefined) : undefined;
  const dirty = !!selected && !!draft && !savedUnread && unchanged === false;
  useH4Editor(selected && draft ? {
    scope, dirty, saveReason, close,
    saveName: opening ? "提交审批后继续" : draftOnly ? "保存草稿后继续" : "保存并立即生效",
    save: after => save(undefined, after),
  } : null);
  if (!canRead) return <BlockState state="denied" title="没有查看玩法规则的权限" detail="七类玩法需要「活动中心查看」权限。" />;

  const ended = (row: EventRuleView) => !!(row.rulesLocked && row.endsAt && Date.parse(row.endsAt) <= Date.now());
  const stateTag = (row: EventRuleView) => ended(row) ? <StatusTag tone="done" explain="开放时间已过：参与条件和时间保持原配置。">已结束</StatusTag>
    : row.enabled ? <StatusTag tone="ok" icon={CircleCheck} explain="开着：到了开始时间、符合条件的用户能参加。玩法和时间已固定，只能关闭；关闭后不能再开。">已开启</StatusTag>
    : <StatusTag tone="neutral" explain={row.rulesLocked ? "开过又关了：不能再开。" : "还没开过：配好并就绪后可以申请开启。"}>{row.rulesLocked ? "已关闭 · 不能再开" : "已关闭"}</StatusTag>;
  const missing = (keys: string[]) => [...new Set(keys.map(eventRuleMissingLabel))];
  /** 选填语言只填了一部分（后端 incomplete）的语言名；和必填没填（missing）分开说。 */
  const halfLanguages = (readiness: EventRuleReadiness) => [...new Set((readiness.incomplete ?? [])
    .map(key => /^localized\.(en|zh|vi)\./.exec(key)?.[1] as LocaleCode | undefined).filter((code): code is LocaleCode => !!code))].map(code => LOCALE_NAME[code]).join("、");
  /** 就绪说明一句：必填没填的「待补齐」，选填填了一半的「要么填齐、要么全部留空」。 */
  const readinessGapParts = (readiness: EventRuleReadiness) => {
    const must = missing(readiness.missing), half = halfLanguages(readiness);
    return [must.length || !half ? `待补齐：${must.join("、") || "参与条件与奖励配置"}` : "", half ? `${half}只填了一部分：要么填齐，要么全部留空` : ""].filter(Boolean);
  };
  /** 卡片底部的缺项：选填填了一半的语言算一项。 */
  const readinessLacks = (readiness: EventRuleReadiness) => [...missing(readiness.missing), ...(halfLanguages(readiness) ? [`${halfLanguages(readiness)}文字填了一半`] : [])];

  const editor = selected && draft && (() => {
    const saved = savedUnread;
    const lockedForm = !canWrite || saving || saved || h4Blocked(`H/h4_event_rule/${selected.eventCode}`) || !!review;
    const showSaved = saved && (!error || !!readError);
    const unknown = !!h4PendingFor(scope) && !h4PendingFor(scope)?.acknowledged;
    const readiness = eventRuleReadiness(selected, eventContent, requiredLanguages);
    const enableBlocked = !readiness.ready ? `还没就绪，${readinessGapParts(readiness).join("；")}` : selected.rulesLocked && !selected.enabled ? "开过又关了的玩法不能再开" : undefined;
    return <div className="h4-dialog-body">
      {review && <H4ConflictCompare groups={compareGroups} onMerge={mergeConflict} mergeDisabledReason={mergeLocked ? "玩法和时间已固定，只可关闭活动；关闭后不能重新开启" : undefined} />}
      {merged > 0 && <Notice tone="neutral" title="已合并，还没保存" action={<Button size="sm" variant="ghost" onClick={() => setMerged(0)}>知道了</Button>}>{`表单是最新配置，放回了你改的 ${merged} 项。核对后点「${saveLabel}」。`}</Notice>}
      <fieldset disabled={lockedForm} className="h4-fieldset">
      {!ended(selected) && !readiness.ready && <Notice tone="warn" title="还没就绪">{readinessGapParts(readiness).map(part => <div key={part}>{part.split("、").map((item, index, all) => <span key={index} className="rd-keep">{item}{index < all.length - 1 ? "、" : ""}</span>)}</div>)}</Notice>}
      <Facts>
        <Fact k="玩法">{PLAY_SENTENCE[playKey({ kind: selected.kind, rules: draft.rules })] ?? "—"}</Fact>
        {(ended(selected) || readiness.ready) && <Fact k="就绪" tone={readiness.ready ? "ok" : "warn"}>{ended(selected) ? "活动已结束，参与条件与有效期保持原配置" : "配置已满足开启条件"}</Fact>}
        <Fact k="改动范围">{selected.rulesLocked ? "玩法和时间已固定，只可关闭活动；关闭后不能重新开启" : "第一次开启后玩法和时间固定；关闭后不能重新开启"}</Fact>
      </Facts>
      <Field label="开放状态" explain={enableBlocked ? `不能选「开启」：${enableBlocked}。` : undefined}>
        <Segments label="开放状态" value={String(draft.enabled)} onChange={(v) => setDraft({ ...draft, enabled: v === "true" })} items={[
          { value: "false", label: "关闭", disabled: lockedForm },
          { value: "true", label: "开启", disabled: lockedForm || !readiness.ready || (selected.rulesLocked && !selected.enabled) },
        ]} />
      </Field>
      <fieldset disabled={selected.rulesLocked} className="h4-fieldset">
        <div className="rd-form-grid" data-cols="2" data-dense="">
          {(["startsAt", "endsAt"] as const).map((key, index) => <Field key={key} label={`${index ? "结束时间" : "开始时间"}（UTC）`} help={draft[key] ? `北京时间 ${formatTime(draft[key], "Asia/Shanghai")}` : "未配置"}>
            <Input type="datetime-local" step={60} value={draft[key] ? new Date(draft[key]!).toISOString().slice(0, 16) : ""} onChange={event => setDraft({ ...draft, [key]: event.target.value ? new Date(`${event.target.value}Z`).toISOString() : null })} />
          </Field>)}
        </div>
        {selected.kind === "boost" && <Facts><Fact k="加成玩法">{draft.rules.action === "CHECKIN_MULTIPLIER" ? "周末签到加倍" : "锁定计划加抽奖券"}</Fact></Facts>}
        <div className="rd-form-grid" data-cols="2" data-dense="">
          {eventRuleFields({ kind: selected.kind, rules: draft.rules }).map((field): ReactNode => {
            if (field.type === "voucher") {
              const current = String(draft.rules[field.key] ?? "");
              const help = !canReadVouchers ? "需要代金券查看权限才能选择优惠券。" : voucherLoading ? "正在加载优惠券…" : voucherError ? undefined : !vouchers.length ? "暂无百分比券，请先在代金券页配置。" : "选覆盖活动期限的全场八折券；券状态和使用条件在代金券页维护，每账号领取一次、单笔使用。";
              return <div key={field.key} className="h4-field" data-wide="">
                <Field label={field.label} help={help} error={voucherError || undefined}>
                  <Select aria-label={field.label} disabled={lockedForm || selected.rulesLocked || !canReadVouchers || voucherLoading || !!voucherError} value={current} onChange={v => patchRule(field.key, v)} options={[
                    { value: "", label: "请选择全场八折券" },
                    ...(current && !vouchers.some(v => v.id === current) ? [{ value: current, label: `${current} · 当前目录未提供`, disabled: true }] : []),
                    ...vouchers.map(v => ({ value: v.id, label: `${v.name} · ${v.id} · 减免 ${v.percent}%${v.status !== "active" ? " · 已停用" : ""}`, disabled: v.status !== "active" })),
                  ]} />
                </Field>
                {voucherError && <Button size="sm" onClick={() => setVoucherRetry(value => value + 1)}>重试读取优惠券</Button>}
              </div>;
            }
            if (field.type === "regions") return <div key={field.key} className="h4-field" data-wide="">
              <Field label={field.label} help={`每行一个地区，国家用两位代码；地区名称 ${APP_VISIBLE_TEXT_HINT}`} explain="同一国家只能属于一个地区。用户加入时按已验证手机号归属国家确定地区。" error={regionNameError}>
                <Textarea aria-label={field.label} rows={4} value={regions} onChange={event => { setRegions(event.target.value); if (error && error === regionNameError) setError(""); }} placeholder={"Southeast Asia: VN, TH\nEurope: DE, FR"} />
              </Field>
            </div>;
            if (field.type === "weekdays") return <div key={field.key} className="h4-field" data-wide="">
              <Field label={field.label}>
                <div className="h4-row" role="group" aria-label={field.label}>{["一", "二", "三", "四", "五", "六", "日"].map((day, index) => <Check key={day} label={`周${day}`} checked={Array.isArray(draft.rules.weekdays) && draft.rules.weekdays.includes(index + 1)} onChange={event => { const days = Array.isArray(draft.rules.weekdays) ? draft.rules.weekdays as number[] : []; patchRule("weekdays", event.target.checked ? [...days, index + 1].sort() : days.filter(day => day !== index + 1)); }} />)}</div>
              </Field>
            </div>;
            return <Field key={field.key} label={field.label}>
              <Input aria-label={field.label} type={field.type === "text" ? "text" : "number"} min={field.type === "text" ? undefined : 0} step={field.integer ? 1 : "any"} value={String(draft.rules[field.key] ?? "")} onChange={event => patchRule(field.key, field.type === "text" || event.target.value === "" ? event.target.value : Number(event.target.value))} />
            </Field>;
          })}
        </div>
      </fieldset>
      {selected.kind === "boost" && draft.rules.action === "CHECKIN_MULTIPLIER" && <Notice tone="neutral">加成预算耗尽后恢复原有签到奖励，不影响用户继续签到。</Notice>}
      {selected.kind === "wheel" && <Notice tone="neutral">抽奖奖项、概率和奖池限制在「转盘奖池」里维护。</Notice>}
      {selected.kind === "regional" && <Notice tone="neutral">排名按加入活动后的有效支付订单金额统计；获胜地区内按个人有效支付金额比例分配奖池，并列第一的地区共同分享总奖池。</Notice>}
      {(error && error !== regionNameError || saved) && !review && <Notice tone={showSaved || unknown ? "warn" : "danger"} title={showSaved ? "已保存，但没读到最新配置" : unknown ? "操作结果未知" : stale ? "没有保存：最新配置也没读到" : "没有保存"}>{showSaved ? "不用重新提交；关掉后点「刷新」，读到后再改。" : error}</Notice>}
    </fieldset></div>;
  })();

  return <Panel id="h4l-plays" title="七类玩法" icon={Sparkles} tone="role-4" sub={loading ? undefined : `共 ${rows.length} 条规则`}
    explain={<><p>每个内置活动背后是一类玩法：规则参数、开关、开放时间。先保存完整配置，就绪后再开启。</p><p>第一次开启要另一位超级管理员批准；开启后玩法和时间固定，只能关闭，关闭后不能再开。玩法开着没有，和「既有活动」卡上的状态是两件事，分别看。</p><p>App 支持的活动，「既有活动」里写的奖励只是展示文字，实际按这里的规则发。</p></>}
    actions={<Button disabledReason={loading ? "正在加载" : saving ? "正在保存" : draft ? "先关掉正在改的配置" : undefined} onClick={() => void load()}>刷新</Button>}>
    {loading ? <BlockState state="loading" title="正在加载活动规则" />
      : readError ? <BlockState state="error" title="玩法规则加载失败" detail={readError} onRetry={() => void load(true)} />
      : !rows.length ? <BlockState state="empty" title="暂无活动规则" />
      : <div className="h4-cards">{rows.map(row => {
        const supported = !!EVENT_KIND_LABELS[row.kind];
        const readiness = eventRuleReadiness(row, eventContent, requiredLanguages);
        const lack = readinessLacks(readiness);
        return <article key={row.eventCode} data-code={row.eventCode} className="h4-card h4l-play" aria-label={`${EVENT_KIND_LABELS[row.kind] ?? "其他活动"} · ${row.eventCode}`} data-dim={!supported || ended(row) ? "" : undefined}>
          <header className="h4-card-head">
            <div className="h4-card-title">
              <h3>{EVENT_KIND_LABELS[row.kind] ?? "其他活动（已停用）"}</h3>
              <span className="h4-card-meta" aria-hidden="true"><span className="h4-mono">&nbsp;</span></span>
            </div>
            <span className="h4l-tags">{row.supported === false && <StatusTag tone="warn" explain="App 还不支持这个活动：配置可以保存，开启会被拒绝。">App 暂不支持</StatusTag>}{row.rulesLocked && !ended(row) && <StatusTag tone="neutral" icon={Lock} explain="开过一次：玩法和时间已固定。">已固定</StatusTag>}{stateTag(row)}</span>
          </header>
          <p className="h4l-desc">{supported ? PLAY_SENTENCE[playKey({ kind: row.kind, rules: eventRuleDraftRules(row) })] ?? "—" : "这类玩法已停用，只能查看。"}</p>
          <dl className="h4l-facts">
            {keyParams({ kind: row.kind, rules: eventRuleDraftRules(row) }).map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={k === "平台最多付" ? "h4l-pay" : undefined}>{v}</dd></div>)}
            <div><dt><CalendarRange size={14} aria-hidden />时间</dt><dd>{row.startsAt || row.endsAt ? <><span className="h4-num">{formatTime(row.startsAt, "Asia/Shanghai")}</span> → <span className="h4-num">{formatTime(row.endsAt, "Asia/Shanghai")}</span></> : <span className="h4-dim">尚未配置</span>}</dd></div>
          </dl>
          <footer className="h4-card-foot">
            {ended(row) || row.enabled ? <span className="h4-dim">—</span> : readiness.ready
              ? <span className="h4l-ready"><CircleCheck size={14} aria-hidden />就绪，可以开启</span>
              : <span className="h4l-lack" title={lack.join("、")}><CircleAlert size={14} aria-hidden />缺 <b className="h4-num">{lack.length || 1}</b> 项：{lack.slice(0, 2).join("、") || "参与条件与奖励配置"}{lack.length > 2 ? " 等" : ""}</span>}
            <Button size="sm" icon={<Settings2 size={13} aria-hidden />} disabledReason={!supported ? "这类玩法已停用" : saving ? "正在保存" : selected ? "先关掉正在改的配置" : undefined} onClick={event => { const button = event.currentTarget; leave.attempt(() => { focus.from(button); choose(row); }); }}>配置</Button>
          </footer>
        </article>;
      })}</div>}
    {rows.length > 0 && error && !selected && <Notice tone="danger" title="玩法规则没有读到最新的">{error}</Notice>}
    {stale && !selected && <Notice tone="warn" title={`没有保存：${stale} 已被别人改过`} action={<Button size="sm" variant="ghost" onClick={() => setStale("")}>知道了</Button>}>{error ? "你这次改的没有提交。" : "已读到最新配置。你这次改的没有提交，关掉时已丢弃；要改就重新打开。"}</Notice>}
    {!loading && <p className="h4l-note">时间为北京时间</p>}
    <Drawer open={!!editor} onClose={dirty ? leave.askClose : close} keepOnControls={dirty} busy={saving} title={selected ? `${EVENT_KIND_LABELS[selected.kind] ?? "其他活动"}${/[A-Za-z0-9]$/.test(EVENT_KIND_LABELS[selected.kind] ?? "") ? " " : ""}的配置` : "玩法配置"} sub={selected?.eventCode} icon={Sparkles} tone="role-4"
      explain="先保存完整配置，再开启活动。没保存的改动，关闭时会先问。"
      footer={<Decision note={!canWrite ? "没有修改玩法的权限" : undefined} others={<Button disabled={saving} onClick={leave.askClose}>取消</Button>} primary={<Button variant="primary" loading={saving} loadingText="正在保存…" disabledReason={saveReason} onClick={() => save()}>{saveLabel}</Button>} />}>
      {editor}
    </Drawer>
  </Panel>;
}
