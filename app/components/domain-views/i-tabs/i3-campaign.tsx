"use client";

/**
 * 通知活动（列表页 + 宽抽屉编辑）。给一批 App 用户写一条站内通知：三语内容、优先级、类型、点了去哪、发给谁、预算记录；
 * 估算人数，排期，已排期的立即发送或取消，草稿和已取消的删除；每位用户各优先级最多保留几条提交审批。
 * 发送是真的写进用户的通知列表；预算只记录，不扣款、不发奖。
 * 写入先保存原请求；未知结果冻结并按原号恢复，当前列表独立重读。
 * 统一来源:后端 /content/campaigns/overview;空库时以后端初始化结果为准。
 * critical 档锁定 = 不渲染调整按钮。amplifies = false(I3 通知体系不动钱,不碰 B1 红线)。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Bell, CalendarClock, FilePen, Layers, Plus, RefreshCw, Route, Send, Trash2, Users } from "lucide-react";
import { BlockState, Button, Check, Conclusion, Decision, Drawer, Explain, Fact, Facts, Field, FilterBar, Fold, Input, IrreversibleTag, LocaleTabs, Modal, Notice, NumberInput, PageHeader, Panel, ReleaseModal, Segments, Select, Stat, StatBand, StatusTag, Table, Td, Textarea, Th, Tr } from "@/app/components/rd";
import { PaginationExemptionList } from "../design-kit";
import type { ActionConfirmReq, ConfirmReq, ICtx } from "./types";
import { pendingI3Commands, retryI3Command, i3RetryPermission, parseI3Json, fetchI3CampaignOverview, type NotificationCampaignOverview, type I3Command, type NotificationAudienceTarget } from "@/lib/admin/i-client";
import { canQueryI3Cap, i3CapPermission, pendingI3CapCommands, proposeI3Cap, queryI3CapCommand, releaseExpiredI3Cap, retryI3CapCommand, type I3CapCommand } from "@/lib/admin/i3-cap-commands";
import { isOutcomeUnknownError } from "@/lib/admin/outcome-classification";
import { useIConflictReview } from "@/lib/admin/i-conflict-review";
import { conflictRow, IConflictModal, IConflictPending, useIConflictView, type IConflictRow } from "./i-conflict";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { businessClock, businessZone } from "@/lib/admin/business-time";
import { useReach } from "@/lib/nav/use-reach";
import { BODY_SENT, CampaignCard, CampaignStatusTag, CapCard, chars, I3PendingCapNotice, I3RecoveryNotice, LANG_NAME, NotificationPreview, quantityText, reachLabel, ScheduleItem, splitBody, TIER, TierTag, TITLE_SENT, whenText, type CampaignRow, type I3RecoveryRow, type Lang, type TierK } from "./i3-parts";

type StFlt = "all" | "scheduled" | "sent" | "draft" | "failed" | "cancelled";
const ST_FLT: [StFlt, string][] = [
  ["all", "全部"],
  ["scheduled", "已排期"],
  ["sent", "已发送"],
  ["draft", "草稿"],
  ["failed", "发送失败"],
  ["cancelled", "已取消"],
];

const TIER_OPTS: TierK[] = ["critical", "high", "normal", "low"];
const I3_TIER_STATE: Record<TierK, [label: string, tone: string]> = {
  critical: ["紧急", "danger"],
  high: ["高", "warn"],
  normal: ["普通", "cyan"],
  low: ["低", "dim"],
};
/** 名称 → slug(小写、空格转 -、保留中英数字,去其他符号)。 */
function slug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-]+/gu, "")
    .slice(0, 48) || "untitled";
}

type NewForm = {
  name: string;
  titleZh: string;
  titleVi: string;
  titleEn: string;
  bodyZh: string;
  bodyVi: string;
  bodyEn: string;
  kind: string;
  ctaHref: string;
  tier: TierK;
  phaseMin: string;
  phaseMax: string;
  language: NotificationAudienceTarget["language"];
  registrationDaysMin: string;
  budget: string;
};

const FORM_INIT: NewForm = {
  name: "",
  titleZh: "",
  titleVi: "",
  titleEn: "",
  bodyZh: "",
  bodyVi: "",
  bodyEn: "",
  kind: "system",
  ctaHref: "",
  tier: "normal",
  phaseMin: "P1",
  phaseMax: "P6",
  language: "all",
  registrationDaysMin: "0",
  budget: "",
};

function splitNotificationBody(value: string): { title: string; body: string } {
  const [title = "", ...body] = value.split("\n");
  return { title, body: body.join("\n") };
}

function targetFromForm(form: NewForm): NotificationAudienceTarget {
  return {
    phaseMin: form.phaseMin,
    phaseMax: form.phaseMax,
    language: form.language,
    registrationDaysMin: Math.max(0, Number(form.registrationDaysMin || 0)),
  };
}

/** 没设「点了去哪」时 App 按类型去的默认位置（后端 AppNotificationService.canonicalRoute）。 */
const KIND_DEFAULT_ROUTE: Record<string, string> = {
  commission: "/pages/me/wallet-repurchase",
  team: "/pages/team/team",
  staking: "/pages/staking/staking",
  market: "/pages/market/market",
  genesis: "/pages/genesis/marketplace",
};
/** 一组里默认显示几张卡，多的点「显示全部」切到这个状态。 */
const GROUP_PREVIEW = 6;
const AUDIT_HREF = "/platform/audit?domain=I";
const RETRY_EXPIRED = "已超过 24 小时，不能再重试，只能查询。";
export function I3Campaign({ ctx, errorText }: { ctx: ICtx; errorText: string | null }) {
  const { toast, actions, content, contentLoading } = ctx;
  const reach = useReach();
  const session = useAdminAuth((state) => state.session);
  const isSuperadmin = session?.role === "superadmin";
  const authorities = session?.authorities ?? [];
  const canWriteI3 = isSuperadmin || authorities.includes("content_i3_write");
  const capPermission = i3CapPermission();
  const canAdjustI3Cap = !capPermission;
  /** 有保留上限调整权、缺提交审批权：按钮灰着并写原因。 */
  const showCapAdjust = canAdjustI3Cap || authorities.includes("content_i3_cap_adjust");
  const canReadI3 = isSuperadmin || authorities.includes("content_i3_read");
  const canSendCriticalI3 = isSuperadmin || authorities.includes("content_i3_critical_send");
  const canSendCampaign = (campaign: CampaignRow) =>
    canWriteI3 && (campaign.tier !== "critical" || canSendCriticalI3);
  const [stFlt, setStFlt] = useState<StFlt>("all");
  const [newOpen, setNewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<CampaignRow | null>(null);
  const [form, setForm] = useState<NewForm>(FORM_INIT);
  const [formBase, setFormBase] = useState<NewForm>(FORM_INIT);
  const [leaving, setLeaving] = useState(false);
  const [formLang, setFormLang] = useState<Lang>("zh");
  const [estimatedAudience, setEstimatedAudience] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimatedAt, setEstimatedAt] = useState<number | null>(null);
  const [scheduleRow, setScheduleRow] = useState<CampaignRow | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [scheduleReason, setScheduleReason] = useState("");
  const [scheduleVerified, setScheduleVerified] = useState(false);
  const [detail, setDetail] = useState<CampaignRow | null>(null);
  const [detailLang, setDetailLang] = useState<Lang>("zh");
  const [pending, setPending] = useState<I3Command[]>([]);
  const [pendingCaps, setPendingCaps] = useState<I3CapCommand[]>([]);
  const [drawerPendingKey, setDrawerPendingKey] = useState<string | null>(null);
  const [schedulePendingKey, setSchedulePendingKey] = useState<string | null>(null);
  const [recovering, setRecovering] = useState<string | null>(null);
  /** 按原请求查过、后端明确没有这张审批单的保留上限申请（过期后可以确认解除）。 */
  const [absentCaps, setAbsentCaps] = useState<Record<string, true>>({});
  const [releasing, setReleasing] = useState<I3CapCommand | null>(null);
  const [requiresReload, setRequiresReload] = useState(false);
  const recoveryInFlight = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [readAt, setReadAt] = useState<number | null>(null);
  const data = content.campaigns;
  const conflictReview = useIConflictReview<NotificationCampaignOverview, {
    reason: string; value?: string; business?: Record<string, string>; form?: NewForm;
    editing?: CampaignRow | null; scheduleRow?: CampaignRow | null; scheduledAt?: string;
  }, I3Command | I3CapCommand>();
  const conflictView = useIConflictView(conflictReview.review);
  /** 核对冲突后重开确认框时带回的理由和新值，只给紧接着打开的那一个框用。 */
  const prefill = useRef<{ reason: string; value?: string } | null>(null);
  const reviewConflict = (error: unknown, requested: NonNullable<typeof conflictReview.review>["requested"]) =>
    conflictReview.reject(error, requested, async () => {
      const latest = await fetchI3CampaignOverview();
      await actions.reloadIContent();
      return latest;
    });
  const I3_STATS = data?.stats ?? { monthCampaigns: 0, monthSent: 0, monthScheduled: 0, monthDraft: 0, criticalInflight: 0, avgReadRate: "—", weeklySwipe: "—" };
  const CAMPAIGNS: CampaignRow[] = (data?.campaigns ?? []).map((row) => ({
    ...row,
    st: row.status,
  }));
  const CAP_TIERS = data?.capRules ?? [];
  const AUDIENCE_CATALOG = data?.audienceCatalog;
  const DELIVERY_CATALOG = data?.deliveryCatalog;
  const SWIPE_ROWS = data?.swipeRoutes ?? [];
  const readBarrier = useRef(data);
  const latestRead = useRef(data);
  latestRead.current = data;
  const newMutationReason = conflictReview.blockedReason() ?? (!data || errorText || contentLoading || requiresReload ? "最新数据没读到" : undefined);
  const newMutationBlocked = useRef(newMutationReason);
  newMutationBlocked.current = newMutationReason;
  const syncPending = () => { setPending(pendingI3Commands()); setPendingCaps(pendingI3CapCommands()); };
  useEffect(syncPending, [session?.adminId]);
  useEffect(() => {
    const next = [...pending, ...pendingCaps].filter((row) => !isRetryExpired(row)).reduce((at, row) => Math.min(at, row.expiresAt), Infinity);
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(syncPending, Math.max(1, next - Date.now()));
    return () => clearTimeout(timer);
  }, [pending, pendingCaps]);
  useEffect(() => {
    if (data && !contentLoading && !errorText) {
      setReadAt(Date.now());
      if (data !== readBarrier.current) setRequiresReload(false);
      // Current ticket reads can both establish and revoke this page's local pending observation.
      if (canQueryI3Cap()) void Promise.allSettled(pendingI3CapCommands().map(queryI3CapCommand)).then(syncPending);
    }
  }, [data, contentLoading, errorText]);
  const lockReason = (id: string) => newMutationReason || (!canWriteI3 ? "当前账号没有这项操作权限，请查询原结果。" : undefined)
    || (pending.some((row) => !row.original || row.target === id) ? "此对象有结果未知的原操作，请先到页面上方核对。" : undefined);
  const requireNewMutation = (openedData = data) => {
    if (conflictReview.blockedReason()) throw new Error(conflictReview.blockedReason());
    if (newMutationBlocked.current || latestRead.current !== openedData) throw new Error(newMutationBlocked.current ?? "数据已更新，请重新核对原操作。");
  };
  const refreshAfterMutation = async () => {
    if (!active.current) return;
    readBarrier.current = latestRead.current;
    newMutationBlocked.current = "最新数据没读到";
    setRequiresReload(true);
    ctx.closeActionConfirm(); ctx.closeConfirm();
    setNewOpen(false); setEditing(null); setDrawerPendingKey(null);
    setScheduleRow(null); setSchedulePendingKey(null);
    syncPending();
    await actions.reloadIContent();
  };
  const runBackend = async (task: Promise<void>, ok: string) => {
    await task;
    await refreshAfterMutation();
    if (active.current) toast(ok);
    return true;
  };
  const replay = async (record: I3Command | I3CapCommand) => {
    try {
      if ("tier" in record) {
        const ticket = await retryI3CapCommand(record);
        toast(ticket.status === "pending" ? "已提交，等待审批后执行" : `审批单${I3_TICKET[ticket.status]}`);
      } else {
        await retryI3Command(record);
        toast(`${I3_ACTION[record.action]} · ${record.name}`);
      }
    } catch (error) {
      syncPending();
      const retained = [...pendingI3Commands(), ...pendingI3CapCommands()].some((row) => row.commandKey === record.commandKey);
      if (!retained) await refreshAfterMutation();
      throw new Error(displayAdminError(error));
    }
    await refreshAfterMutation();
    return true;
  };
  const openActionConfirm = (req: ActionConfirmReq, restored?: I3Command | I3CapCommand, cap = false) => {
    if (!restored) { try { requireNewMutation(); } catch (error) { toast(displayAdminError(error)); return; } }
    const openedData = data;
    let key = restored?.commandKey;
    const original = () => (cap ? pendingI3CapCommands() : pendingI3Commands()).find((row) => row.commandKey === key);
    const carried = restored ? null : prefill.current;
    prefill.current = null;
    ctx.openActionConfirm({ ...req, getPendingReason: () => original()?.reason, initialReason: carried?.reason,
      edit: req.edit && restored && "after" in restored ? { ...req.edit, initialValue: restored.after } : req.edit && carried?.value ? { ...req.edit, initialValue: carried.value } : req.edit,
      run: async (reason, value, business) => {
        if (key) {
          const record = original();
          if (!record) { ctx.closeActionConfirm(); return false; }
          return replay(record);
        }
        try {
          requireNewMutation(openedData);
          return await req.run(reason, value, business);
        } catch (error) {
          const candidate = (error as { commandKey?: string }).commandKey;
          key = (cap ? pendingI3CapCommands() : pendingI3Commands()).find((row) => row.commandKey === candidate)?.commandKey;
          if (await reviewConflict(error, { reason, value, business })) ctx.closeActionConfirm();
          syncPending();
          throw new Error(displayAdminError(error));
        }
      },
    });
  };
  const openConfirm = (req: ConfirmReq, restored?: I3Command) => {
    if (!restored) { try { requireNewMutation(); } catch (error) { toast(displayAdminError(error)); return; } }
    const openedData = data;
    let key = restored?.commandKey;
    const original = () => pendingI3Commands().find((row) => row.commandKey === key);
    ctx.openConfirm({ ...req, errorHandled: false, freezePendingInputs: true, getPendingReason: () => original()?.reason,
      run: async (reason, value) => {
        if (key) {
          const record = original();
          if (!record) { ctx.closeConfirm(); return false; }
          return replay(record);
        }
        try { requireNewMutation(openedData); return await req.run(reason, value); }
        catch (error) { const candidate = (error as { commandKey?: string }).commandKey; key = pendingI3Commands().find((row) => row.commandKey === candidate)?.commandKey; if (await reviewConflict(error, { reason, value })) ctx.closeConfirm(); syncPending(); throw new Error(displayAdminError(error)); }
      },
    });
  };

  useEffect(() => {
    if (!newOpen || drawerPendingKey) return;
    let active = true;
    setEstimating(true); setEstimatedAudience(null); setEstimatedAt(null);
    const timer = window.setTimeout(() => {
      actions.estimateI3Audience(targetFromForm(form))
        .then((result) => { if (active) { setEstimatedAudience(result.estimatedUsers); setEstimatedAt(Date.now()); } })
        .catch(() => { if (active) setEstimatedAudience(null); })
        .finally(() => { if (active) setEstimating(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [newOpen, drawerPendingKey, form.phaseMin, form.phaseMax, form.language, form.registrationDaysMin, actions]);

  const liveSt = (c: CampaignRow): CampaignRow["st"] => {
    return c.st;
  };
  const liveCap = (tier: string, cap: string): string => (tier === "critical" ? "∞ 永不淘汰" : cap);
  const liveCampaign = (c: CampaignRow): CampaignRow => c;
  const liveBudget = (id: string): string | undefined => {
    const row = CAMPAIGNS.find((c) => c.id === id);
    return row?.budget === undefined ? undefined : String(row.budget);
  };

  const filtered = useMemo(() => {
    return CAMPAIGNS.filter((c) => {
      if (stFlt === "all") return true;
      const st = liveSt(c);
      return st === stFlt;
    });
  }, [stFlt, CAMPAIGNS]);

  /* ---------- actions ---------- */

  const sendCmp = (c: CampaignRow) => {
    if (lockReason(c.id) || !canSendCampaign(c)) return;
    setSchedulePendingKey(null);
    setScheduleRow(c);
    setScheduledAt("");
    setScheduleReason("");
    setScheduleVerified(false);
  };

  const openNew = () => { if (lockReason("create")) return; setDrawerPendingKey(null); setEditing(null); setForm(FORM_INIT); setFormBase(FORM_INIT); setFormLang("zh"); setNewOpen(true); };

  const editDraft = (c: CampaignRow) => {
    if (lockReason(c.id)) return;
    setDrawerPendingKey(null);
    const zh = splitNotificationBody(c.bodyZh);
    const vi = splitNotificationBody(c.bodyVi);
    const en = splitNotificationBody(c.bodyEn);
    const next: NewForm = {
      name: c.name,
      titleZh: zh.title,
      titleVi: vi.title,
      titleEn: en.title,
      bodyZh: zh.body,
      bodyVi: vi.body,
      bodyEn: en.body,
      kind: c.kind || "system",
      ctaHref: c.ctaHref || "",
      tier: c.tier,
      phaseMin: c.audienceTarget?.phaseMin ?? "P1",
      phaseMax: c.audienceTarget?.phaseMax ?? "P6",
      language: c.audienceTarget?.language ?? "all",
      registrationDaysMin: String(c.audienceTarget?.registrationDaysMin ?? 0),
      budget: c.budget == null ? "" : String(c.budget),
    };
    setEditing(c);
    setForm(next);
    setFormBase(next);
    setFormLang("zh");
    setNewOpen(true);
  };

  const deleteDraft = (c: CampaignRow, restored?: I3Command) => openConfirm({ briefKind: "record",
    action: <>删除通知草稿 · {c.id}</>,
    title: c.st === "cancelled" ? "删除已取消的通知" : "删除通知草稿",
    detail: <>只有草稿和已取消的能删。删除后这页上找不回来；用户手里的通知不变。</>,
    effect: <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag>页面上不能恢复</IrreversibleTag></>,
    content: (
      <Facts>
        <Fact k="通知">{c.name}</Fact>
        <Fact k="状态">{STATUS_TEXT[c.st]}</Fact>
        <Fact k="编号"><span data-mono="">{c.id}</span></Fact>
      </Facts>
    ),
    statedBrief: { impact: "从列表里删掉这条活动；它没有发出过，用户手里的通知不受影响。", check: "删除后页面上不能恢复，操作记录里还查得到；要再发就新建一条。" },
    confirmTone: "danger",
    reasonPlaceholder: "例如：重复建了一条、内容作废",
    reason: true,
    okLabel: restored ? "按原请求重试" : "确认删除",
    run: (reason) => runBackend(actions.deleteI3Campaign(c.id, c.revision, reason, { ...c, status: c.st }), `${c.id} 已删除`),
  }, restored);

  const sendNow = (c: CampaignRow, restored?: I3Command) => openActionConfirm({ briefKind: "content",
    action: <>立即发送 · {c.name}</>,
    title: "立即发送通知",
    detail: (
      <>
        不等排期，马上发给现在符合条件的用户；发出后撤不回。
      </>
    ),
    effect: <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag>发出后撤不回</IrreversibleTag></>,
    facts: (
      <Facts>
        <Fact k="预计" lead unit="人">{quantityText(c.reach)}</Fact>
        <Fact k="通知">{c.name}</Fact>
        <Fact k="发给谁">{c.audience}</Fact>
        <Fact k="优先级" tone={c.tier === "critical" ? "danger" : undefined}>{`${I3_TIER_STATE[c.tier]?.[0] ?? "未知"}${c.tier === "critical" ? "（不看用户的通知设置）" : ""}`}</Fact>
        <Fact k="原定时间">{`${whenText(c)}（${businessZone().label}）`}</Fact>
      </Facts>
    ),
    statedBrief: {
      impact: c.tier === "critical"
        ? "马上写进现在符合条件的全部用户的通知列表；发出后撤不回。"
        : "马上写进现在符合条件、没关掉这类通知的用户的通知列表；发出后撤不回。",
      check: "预计人数是保存草稿时的估算；实际人数以发出后的送达为准，可能更少。",
    },
    confirmTone: "danger",
    confirmLabel: restored ? "按原请求重试" : "确认立即发送",
    reasonPlaceholder: "例如：活动提前开始，需要马上通知",
    amplifies: false,
    run: (reason) => {
      return runBackend(actions.sendI3CampaignNow(c.id, c.revision, reason, { ...c, status: c.st }), `已发送 · ${c.name}`);
    },
  }, restored);

  const cancelScheduled = (c: CampaignRow, restored?: I3Command) => openConfirm({ briefKind: "record",
    action: <>取消排期 · {c.id}</>,
    title: "取消排期",
    detail: (
      <>
        还没发出才能取消。取消后不能再编辑或排期，只能删除或新建一条。
      </>
    ),
    effect: <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag>取消后不能恢复</IrreversibleTag></>,
    content: (
      <Facts>
        <Fact k="通知">{c.name}</Fact>
        <Fact k="原定时间">{`${whenText(c)}（${businessZone().label}）`}</Fact>
        <Fact k="状态"><StatusChange from="已排期" to="已取消" /></Fact>
      </Facts>
    ),
    statedBrief: { impact: "这条不会再发出。已经开始发送的取消不了，用户已收到的也撤不回。", check: "取消后不能改回草稿，要再发就新建一条。" },
    reasonPlaceholder: "例如：活动改期，不再按原时间发送",
    reason: true,
    okLabel: restored ? "按原请求重试" : "确认取消",
    run: (reason) => {
      return runBackend(actions.cancelI3Campaign(c.id, c.revision, reason, { ...c, status: c.st }), `${c.id} 已取消`);
    },
  }, restored);

  const adjustCap = (tier: TierK, cap: string, restored?: I3CapCommand) => openActionConfirm({ briefKind: "config",
    action: <>调整通知保留数量 · {I3_TIER_STATE[tier]?.[0] ?? "未知"}</>,
    title: `调整${I3_TIER_STATE[tier]?.[0] ?? "未知"}优先级保留上限`,
    detail: (
      <>
        <span className="rd-keep">当前 <b>{cap}</b>。</span><span className="rd-keep">批准执行时按新上限立刻清理，未读的也删；</span><span className="rd-keep">调高不恢复已删的。</span>
        {tier === "low" && <span className="rd-keep">低优先级超过 48 小时的也会删。</span>}
      </>
    ),
    effect: <StatusTag tone="progress" filled explain="另一位管理员在「操作记录与审批」批准后才执行；批准前上限不变。">批准后生效</StatusTag>,
    completionCopy: "另一位管理员在「操作记录与审批」批准后执行；批准前上限不变。",
    statedBrief: {
      impact: "调低：批准执行时立刻删掉每位用户这一档超出上限的旧通知，未读的也删。调高：以后多留，已删的不恢复。",
      check: "会删多少条这页读不到。",
    },
    facts: (
      <Facts>
        <Fact k="谁来批">另一位有审批批准权限和通知保留上限调整权限的管理员，不能是提交人</Fact>
        <Fact k="提交人需有">提交审批权限和通知保留上限调整权限</Fact>
      </Facts>
    ),
    confirmLabel: restored ? "按原请求重试" : "提交审批",
    reasonPlaceholder: "例如：用户反馈普通通知太多，调低保留数量",
    amplifies: false,
    edit: {
      kind: "number",
      current: cap.match(/\d+/)?.[0] ?? "",
      unit: "条",
      min: 1,
      max: 10000,
      step: 1,
      hint: "1–10000 的整数",
      preview: (value) => capPreview(tier, cap.match(/\d+/)?.[0] ?? "", value),
    },
    run: async (reason, v) => {
      if (!v) return false;
      const ticket = await proposeI3Cap(tier, cap, v, reason);
      syncPending();
      toast(ticket.status === "pending" ? "已提交，等待审批后执行" : `审批单${I3_TICKET[ticket.status]}`);
      return true;
    },
  }, restored, true);

  /* ---------- 刚被别人改过：看最新的和自己填的，确认后按最新的重建表单或确认框 ---------- */
  const conflictUi = (() => {
    const conflict = conflictReview.review;
    if (!conflict) return null;
    const requested = conflict.requested;
    const rejected = conflict.rejectedCommand;
    const campaignCommand = rejected && "target" in rejected ? rejected : undefined;
    const capCommand = rejected && "tier" in rejected ? rejected : undefined;
    const latestRows = conflict.latest?.campaigns ?? [];
    const ready = !!conflict.latest;
    const path = campaignCommand?.original?.path ?? "";
    let subject: ReactNode = "这一项";
    let rows: IConflictRow[] = [];
    let columns: [string, string] = ["你打开时", "现在"];
    let gone: string | undefined;
    let note: ReactNode;
    let rebuildLabel = "按最新的重新确认";
    let rebuild: (() => void) | undefined;
    const reopen = (task: () => void, value?: string) => () => { prefill.current = { reason: requested.reason, value }; task(); prefill.current = null; };
    const stateText = (row?: { status?: string; st?: string; schedule: string }) => row ? `${STATUS_TEXT[(row.status ?? row.st) as CampaignRow["st"]] ?? "状态未知"}${row.schedule ? ` · ${row.schedule}` : ""}` : "没有了";
    const campaignId = requested.editing?.id ?? requested.scheduleRow?.id ?? campaignCommand?.target ?? "";
    const now = latestRows.find((row) => row.id === campaignId);
    const live = CAMPAIGNS.find((row) => row.id === campaignId);
    if (capCommand) {
      const tier = capCommand.tier as TierK;
      const capRow = (conflict.latest?.capRules ?? []).find((row) => row.tier === tier);
      subject = <>{TIER[tier]?.label ?? tier}优先级保留上限</>;
      rows = [conflictRow("上限", capCommand.before ? `${capCommand.before.replace(/\s*条$/, "")} 条` : "—", capRow?.cap)];
      note = <>你填的新上限 {capCommand.after} 条会带回确认框。</>;
      rebuild = capRow ? reopen(() => adjustCap(tier, capRow.cap), capCommand.after) : undefined;
      if (ready && !capRow) gone = "这一档在最新读取里没有了。";
    } else {
      subject = <>通知「{now?.name ?? live?.name ?? (campaignId || "—")}」</>;
      if (ready && campaignId && !now) gone = "这条通知在最新读取里没有了，不能按最新的重做。";
      if (requested.editing && requested.form) {
        const form = requested.form;
        columns = ["现在", "你填的"];
        rebuildLabel = "按最新的重新填写";
        const part = (value?: string) => value === undefined ? { title: undefined, body: undefined } : splitNotificationBody(value);
        rows = [conflictRow("状态", stateText(now), "草稿"), conflictRow("名称", now?.name, form.name),
          conflictRow("中文标题", part(now?.bodyZh).title, form.titleZh), conflictRow("中文正文", part(now?.bodyZh).body, form.bodyZh),
          conflictRow("越南语正文", part(now?.bodyVi).body, form.bodyVi), conflictRow("英语正文", part(now?.bodyEn).body, form.bodyEn)];
        rows[0].changed = !!now && now.status !== "draft";
        if (!gone && now && now.status !== "draft") gone = `这条通知现在是${stateText(now)}，不能再改草稿。`;
        note = "保存会用你填的整份内容替换现在的草稿；别人改的要留，先在表单里补上。";
        rebuild = live ? () => setEditing(live) : undefined;
      } else if (requested.scheduleRow) {
        columns = ["现在", "你填的"];
        rebuildLabel = "按最新的重新填写";
        rows = [conflictRow("状态", stateText(now), "草稿"), conflictRow("发送时间", now?.schedule, requested.scheduledAt?.replace("T", " ")),
          conflictRow("中文内容", now?.bodyZh, requested.scheduleRow.bodyZh)];
        rows[0].changed = !!now && now.status !== "draft";
        if (!gone && now && now.status !== "draft") gone = `这条通知现在是${stateText(now)}，不能再排期。`;
        note = "发送时间和理由留着；「已核对」要重新勾。";
        rebuild = live ? () => { setScheduleRow(live); setScheduleVerified(false); } : undefined;
      } else if (live) {
        const opened = campaignCommand?.snapshot;
        rows = [conflictRow("状态", opened ? stateText(opened) : "—", stateText(now)), conflictRow("中文内容", opened?.bodyZh, now?.bodyZh)];
        rows[0].changed = !opened || stateText(opened) !== stateText(now);
        rebuild = path.endsWith("/send-now") ? reopen(() => sendNow(live))
          : path.endsWith("/cancel") ? () => cancelScheduled(live)
            : campaignCommand?.original?.method === "DELETE" ? () => deleteDraft(live) : undefined;
        if (!path.endsWith("/send-now") && rebuild) note = "这个确认框带不回理由，重新打开后再填一次。";
      }
    }
    if (!rebuild && !gone) { rebuildLabel = "知道了"; note = "最新的已经读到页面上，关掉后重新打开要做的操作。"; }
    const finish = (task?: () => void) => {
      if (!conflictReview.confirm(conflict, () => undefined)) return;
      conflictView.show();
      if (task) window.setTimeout(task, 0);
    };
    return conflictView.open
      ? <IConflictModal review={conflict} subject={subject} rows={rows} columns={columns} gone={gone} note={note} rebuildLabel={rebuildLabel}
          onReread={() => void conflictReview.reread()} onClose={conflictView.hide} onRebuild={() => finish(rebuild)}
          onDiscard={() => finish(() => { if (requested.editing) { setNewOpen(false); setEditing(null); setForm(FORM_INIT); } if (requested.scheduleRow) setScheduleRow(null); })} />
      : <IConflictPending subject={subject} onOpen={conflictView.show} />;
  })();

  /* ---------- new campaign drawer 提交 ---------- */
  const submitNew = async () => {
    if (submitting) return;
    if (drawerPendingKey) {
      const original = pendingI3Commands().find((row) => row.commandKey === drawerPendingKey);
      if (!original) { setNewOpen(false); setDrawerPendingKey(null); return; }
      setSubmitting(true);
      try { await replay(original); } catch (error) { toast(displayAdminError(error)); } finally { setSubmitting(false); }
      return;
    }
    try { requireNewMutation(); } catch (error) { toast(displayAdminError(error)); return; }
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      toast("请填写 通知活动名称");
      return;
    }
    if (!form.titleZh.trim() || !form.titleVi.trim() || !form.bodyZh.trim() || !form.bodyVi.trim()) {
      toast("请完整填写中文和越南语标题与正文");
      return;
    }
    const minIndex = AUDIENCE_CATALOG?.phases.findIndex((item) => item.value === form.phaseMin) ?? -1;
    const maxIndex = AUDIENCE_CATALOG?.phases.findIndex((item) => item.value === form.phaseMax) ?? -1;
    if (minIndex < 0 || maxIndex < 0 || minIndex > maxIndex) {
      toast("P 阶段范围不正确");
      return;
    }
    const selectedCta = DELIVERY_CATALOG?.ctaRoutes.find((option) => option.value === form.ctaHref);
    const payload = {
      name: trimmedName,
      titleZh: form.titleZh.trim(),
      titleVi: form.titleVi.trim(),
      titleEn: form.titleEn.trim(),
      bodyZh: form.bodyZh.trim(),
      bodyVi: form.bodyVi.trim(),
      bodyEn: form.bodyEn.trim(),
      kind: form.kind,
      ctaHref: form.ctaHref,
      ctaLabel: selectedCta?.label ?? "",
      tier: form.tier,
      audienceTarget: targetFromForm(form),
      budget: form.budget.trim() || null,
    };
    const id = editing?.id ?? `CMP-N-${slug(trimmedName)}`;
    const originalForm = AUDIENCE_CATALOG && DELIVERY_CATALOG ? { audienceCatalog: AUDIENCE_CATALOG, deliveryCatalog: DELIVERY_CATALOG, estimatedAudience, estimatedAt } : undefined;
    const task = editing
      ? actions.updateI3CampaignDraft(editing.id, payload, editing.revision, `编辑通知草稿 ${editing.id}`, { ...editing, status: editing.st }, originalForm)
      : actions.createI3Campaign(payload, `新建通知草稿 ${id}`, originalForm);
    setSubmitting(true);
    try {
      if (await runBackend(task, editing ? `${editing.id} 草稿已保存` : `通知草稿已创建 · ${trimmedName}`)) {
        setNewOpen(false);
        setEditing(null);
        setForm(FORM_INIT);
      }
    } catch (error) {
      if (isOutcomeUnknownError(error)) setDrawerPendingKey((error as { commandKey?: string }).commandKey ?? null);
      await reviewConflict(error, { reason: editing ? `编辑通知草稿 ${editing.id}` : `新建通知草稿 ${id}`, form, editing });
      syncPending();
      toast(displayAdminError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const submitSchedule = async () => {
    if (!scheduleRow || submitting) return;
    setSubmitting(true);
    try {
      if (schedulePendingKey) {
        const original = pendingI3Commands().find((row) => row.commandKey === schedulePendingKey);
        if (original) await replay(original);
        else { setScheduleRow(null); setSchedulePendingKey(null); }
        return;
      }
      requireNewMutation();
      if (!canSendCampaign(scheduleRow)) throw new Error("排期、发送和取消紧急通知要有紧急通知发送权限");
      const saved = await runBackend(
        actions.scheduleI3Campaign(scheduleRow.id, scheduledAt, scheduleRow.revision, scheduleReason.trim(), { ...scheduleRow, status: scheduleRow.st }),
        `${scheduleRow.id} 已进入排期`,
      );
      if (saved) setScheduleRow(null);
    } catch (error) {
      if (isOutcomeUnknownError(error)) setSchedulePendingKey((error as { commandKey?: string }).commandKey ?? null);
      await reviewConflict(error, { reason: scheduleReason, scheduleRow, scheduledAt });
      setScheduleVerified(false);
      syncPending();
      toast(displayAdminError(error));
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- render helpers ---------- */
  const kindLabel = (kind: string) => DELIVERY_CATALOG?.kinds.find((option) => option.value === kind)?.label ?? "类型未知";
  const ctaLabelOf = (href: string) => DELIVERY_CATALOG?.ctaRoutes.find((option) => option.value === href)?.label ?? href;
  const NO_CRITICAL = "排期、发送和取消紧急通知要有紧急通知发送权限";

  const renderActions = (c: CampaignRow, size: "sm" | "md" = "sm"): ReactNode => {
    const st = liveSt(c);
    if (!canWriteI3) return null;
    if (st === "draft") {
      return (
        <>
          <Button size={size} variant={size === "md" ? "primary" : undefined} icon={<CalendarClock size={14} aria-hidden />} aria-label={`排期 ${c.name}`} disabledReason={lockReason(c.id) || (canSendCampaign(c) ? undefined : NO_CRITICAL)} onClick={() => sendCmp(c)}>排期</Button>
          <Button size={size} icon={<FilePen size={14} aria-hidden />} aria-label={`编辑 ${c.name}`} disabledReason={lockReason(c.id)} onClick={() => { setDetail(null); editDraft(c); }}>编辑</Button>
          <Button size={size} icon={<Trash2 size={14} aria-hidden />} aria-label={`删除 ${c.name}`} disabledReason={lockReason(c.id)} onClick={() => deleteDraft(c)}>删除</Button>
        </>
      );
    }
    if (st === "scheduled") {
      return (
        <>
          <Button size={size} variant="danger-outline" icon={<Send size={14} aria-hidden />} aria-label={`立即发送 ${c.name}`} disabledReason={lockReason(c.id) || (canSendCampaign(c) ? undefined : NO_CRITICAL)} onClick={() => sendNow(c)}>立即发送</Button>
          <Button size={size} aria-label={`取消排期 ${c.name}`} disabledReason={lockReason(c.id) || (canSendCampaign(c) ? undefined : NO_CRITICAL)} onClick={() => cancelScheduled(c)}>取消排期</Button>
        </>
      );
    }
    if (st === "sent" && size === "sm") {
      return <Button size={size} aria-label={`查看 ${c.name}`} onClick={() => setDetail(c)}>查看</Button>;
    }
    if (st === "cancelled") {
      return <Button size={size} icon={<Trash2 size={14} aria-hidden />} aria-label={`删除 ${c.name}`} disabledReason={lockReason(c.id)} onClick={() => deleteDraft(c)}>删除</Button>;
    }
    return null;
  };

  const restore = (record: I3Command) => {
    if (!record.original) return;
    const input = parseI3Json(record.original.body) as NewForm & { audienceTarget: NotificationAudienceTarget; schedule: string };
    if (record.action === "create" || record.action === "draft") {
      const next: NewForm = { name: input.name, titleZh: input.titleZh, titleVi: input.titleVi, titleEn: input.titleEn,
        bodyZh: input.bodyZh, bodyVi: input.bodyVi, bodyEn: input.bodyEn, kind: input.kind, ctaHref: input.ctaHref, tier: input.tier,
        phaseMin: input.audienceTarget.phaseMin, phaseMax: input.audienceTarget.phaseMax, language: input.audienceTarget.language,
        registrationDaysMin: String(input.audienceTarget.registrationDaysMin), budget: input.budget == null ? "" : String(input.budget) };
      setEditing(record.snapshot ? { ...record.snapshot, st: record.snapshot.status } : null);
      setForm(next); setFormBase(next); setFormLang("zh"); setDrawerPendingKey(record.commandKey);
      setEstimating(false); setEstimatedAudience(record.formSnapshot?.estimatedAudience ?? null); setEstimatedAt(record.formSnapshot?.estimatedAt ?? null);
      setNewOpen(true);
      return;
    }
    if (!record.snapshot) return;
    const originalRow = { ...record.snapshot, st: record.snapshot.status };
    if (record.action === "schedule") {
      setScheduleRow(originalRow); setScheduledAt(input.schedule); setScheduleReason(record.reason); setScheduleVerified(true);
      setSchedulePendingKey(record.commandKey);
    } else if (record.action === "send-now") sendNow(originalRow, record);
    else if (record.action === "cancel") cancelScheduled(originalRow, record);
    else if (record.action === "delete") deleteDraft(originalRow, record);
  };
  const query = async (record: I3Command | I3CapCommand) => {
    if (recoveryInFlight.current) return;
    recoveryInFlight.current = true; setRecovering(record.commandKey);
    try {
      if ("tier" in record) {
        const ticket = await queryI3CapCommand(record);
        if (ticket) {
          toast(ticket.status === "pending" ? "已提交，等待审批后执行" : `审批单${I3_TICKET[ticket.status]}`);
          if (ticket.status !== "pending") await refreshAfterMutation();
        } else {
          setAbsentCaps((prev) => ({ ...prev, [record.commandKey]: true }));
          toast("没有查到原审批单，原操作记录继续保留。");
        }
      } else {
        await fetchI3CampaignOverview();
        await actions.reloadIContent();
        toast("已重新读取活动列表；当前状态不能证明原操作结果，原记录继续保留。");
      }
      syncPending();
    } catch (error) { toast(displayAdminError(error)); }
    finally { recoveryInFlight.current = false; setRecovering(null); }
  };
  const recoveryRows: I3RecoveryRow[] = [
    ...pending.map((row) => ({ key: row.commandKey, name: I3_ACTION[row.action], object: row.name, change: row.change,
      submittedAt: row.createdAt, expired: isRetryExpired(row), actions: <>
        <Button size="sm" loading={recovering === row.commandKey} disabledReason={canReadI3 ? undefined : "缺少通知活动读取权限"} onClick={() => void query(row)}>查询原结果</Button>
        {!isRetryExpired(row) && <Button size="sm" disabledReason={!row.original || row.action !== "create" && !row.snapshot ? "原操作记录不完整，只能查询核对，不能重试。" : i3RetryPermission(row)} onClick={() => restore(row)}>按原请求重试</Button>}
      </> })),
    ...pendingCaps.filter((row) => row.ticketStatus !== "pending").map((row) => ({ key: row.commandKey, name: "调整通知保留数量", object: `${TIER[row.tier as TierK].label}优先级`,
      change: `${row.before} → ${row.after} 条`, submittedAt: row.createdAt, expired: isRetryExpired(row), submitted: !!row.receiptKnown,
      note: !row.receiptKnown && absentCaps[row.commandKey]
        ? `按原请求查不到这张审批单，说明没建成；${isRetryExpired(row) ? "可以确认解除。" : "24 小时内可以按原请求重试。"}`
        : row.receiptKnown ? "审批单已建，批没批准还没查到；点「查询原结果」看当前状态。" : undefined,
      actions: <>
        <Button size="sm" loading={recovering === row.commandKey} disabledReason={canQueryI3Cap() ? undefined : "缺少审批单查询权限"} onClick={() => void query(row)}>查询原结果</Button>
        {!isRetryExpired(row) && !row.receiptKnown && <Button size="sm" disabledReason={!row.request ? "原操作记录不完整，只能查询核对，不能重试。" : capPermission} onClick={() => adjustCap(row.tier as TierK, row.before, row)}>按原请求重试</Button>}
        {!row.receiptKnown && isRetryExpired(row) && absentCaps[row.commandKey] && <Button size="sm" disabled={!!recovering} onClick={() => setReleasing(row)}>确认解除</Button>}
      </> })),
  ];
  const pendingCapRows = pendingCaps.filter((row) => row.ticketStatus === "pending").map((row) => ({ key: row.commandKey, tier: `${TIER[row.tier as TierK].label}优先级`,
    change: `${row.before} → ${row.after} 条`, submittedAt: row.createdAt,
    actions: <Button size="sm" loading={recovering === row.commandKey} disabledReason={canQueryI3Cap() ? undefined : "缺少审批单查询权限"} onClick={() => void query(row)}>查询原结果</Button> }));
  const releaseCap = async (record: I3CapCommand) => {
    setReleasing(null);
    try {
      await releaseExpiredI3Cap(record);
      setAbsentCaps((prev) => { const next = { ...prev }; delete next[record.commandKey]; return next; });
      toast("已解除这条记录；需要的话可以重新提交调整");
    } catch (error) { toast(displayAdminError(error)); }
    syncPending();
  };
  const drawerOriginal = pending.find((row) => row.commandKey === drawerPendingKey);
  const drawerRetryReason = drawerOriginal && isRetryExpired(drawerOriginal) ? RETRY_EXPIRED : drawerOriginal ? i3RetryPermission(drawerOriginal) : undefined;
  const scheduleOriginal = pending.find((row) => row.commandKey === schedulePendingKey);
  const scheduleRetryReason = scheduleOriginal && isRetryExpired(scheduleOriginal) ? RETRY_EXPIRED : scheduleOriginal ? i3RetryPermission(scheduleOriginal) : undefined;

  const readStamp = readAt ? `${businessClock(readAt)} 读取（${businessZone().label}）` : "";
  const header = (
    <PageHeader
      pageId="I3"
      title="通知活动"
      summary="给一批 App 用户发站内通知，排期或立即发送。"
      meta={readAt ? <span className="rd-toolbar">
        <span>{readStamp}</span>
        <Button variant="ghost" size="sm" loading={contentLoading} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void actions.reloadIContent()}>刷新</Button>
      </span> : undefined}
      actions={canWriteI3 && data ? <Button variant="primary" icon={<Plus size={14} aria-hidden />} disabledReason={lockReason("create")} onClick={openNew}>新建通知</Button> : undefined}
      readOnly={!canWriteI3 ? "你只能查看；新建、排期和发送要有这页的修改权限。" : undefined}
    />
  );

  const upcoming = filtered.filter((c) => c.st === "scheduled" || c.st === "sending")
    .sort((a, b) => (a.st === "sending" ? 0 : 1) - (b.st === "sending" ? 0 : 1) || a.schedule.localeCompare(b.schedule));
  const nextScheduled = CAMPAIGNS.filter((c) => c.st === "scheduled").sort((a, b) => a.schedule.localeCompare(b.schedule))[0];
  const sendingN = CAMPAIGNS.filter((c) => c.st === "sending").length;
  const failedN = CAMPAIGNS.filter((c) => c.st === "failed").length;
  const scheduledN = CAMPAIGNS.filter((c) => c.st === "scheduled").length;
  const countOf = (key: StFlt) => key === "all" ? CAMPAIGNS.length : CAMPAIGNS.filter((c) => c.st === key).length;
  const auditReachable = reach(AUDIT_HREF, "platform_a2_read");
  const shownDetail = detail ? CAMPAIGNS.find((c) => c.id === detail.id) ?? null : null;
  const detailRow = shownDetail ?? (detail ? liveCampaign(detail) : null);

  const conclusion = CAMPAIGNS.length === 0
    ? <Conclusion state="neutral" icon={Bell} hint={canWriteI3 ? "点右上角「新建通知」写第一条。" : undefined}>还没有通知活动</Conclusion>
    : <Conclusion state={failedN > 0 ? "warn" : scheduledN + sendingN > 0 ? "neutral" : "ok"} icon={failedN > 0 ? undefined : CalendarClock}
      hint={failedN > 0 ? "发送失败的不能重发，要发请新建一条。" : undefined}
      explain={<>
        <p>等着发是已排期和发送中的活动；时间是北京时间。到点后由后台自动发出，后台每 30 秒检查一次，排队多时会晚。</p>
        <p>保留上限的修改要批准后才生效。这页只查得到你在这个标签页提交的申请，别人提交的到「操作记录与审批」看。</p>
      </>}
      action={auditReachable && pendingCapRows.length === 0 ? <Link className="rd-link" href={AUDIT_HREF} prefetch={false}>看等批准的上限修改</Link> : undefined}>
      {scheduledN + sendingN > 0
        ? <><b>{scheduledN + sendingN}</b>{" 条等着发"}{nextScheduled && <>，<span className="rd-keep">{`最近一条 ${whenText(nextScheduled)}`}</span></>}{sendingN > 0 && <>，<span className="rd-keep">{`${sendingN} 条正在发送`}</span></>}</>
        : "没有等着发的通知"}
      {failedN > 0 && <>；<span className="rd-keep">{`${failedN} 条发送失败`}</span></>}
    </Conclusion>;

  const group = (key: Exclude<StFlt, "all" | "scheduled">, title: string, rows: CampaignRow[], icon: typeof Bell) => {
    if (rows.length === 0) return null;
    const limited = stFlt === "all" && rows.length > GROUP_PREVIEW;
    return (
      <section className="i3-group" aria-labelledby={`i3-group-${key}`} key={key}>
        <h3 className="i3-group-title" id={`i3-group-${key}`}>{iconOf(icon)}{title}<span className="i3-group-count">{`${rows.length} 条`}</span></h3>
        <div className="i3-cards">
          {(limited ? rows.slice(0, GROUP_PREVIEW) : rows).map((row) => (
            <CampaignCard key={row.id} row={row} kindLabel={kindLabel(row.kind)} selected={row.id === detail?.id} onOpen={() => setDetail(row)} actions={renderActions(row)} />
          ))}
        </div>
        {limited && <Button variant="ghost" size="sm" onClick={() => setStFlt(key)}>{`显示全部 ${rows.length} 条`}</Button>}
      </section>
    );
  };

  const listEmpty = filtered.length === 0;

  return (
    <div className="i3-page-body">
      {header}
      {data && errorText && <Notice tone="warn" title="数据没有读到最新" action={<Button size="sm" loading={contentLoading} onClick={() => void actions.reloadIContent()}>重新加载</Button>}>{`${errorText} 下面是上次读到的内容。`}</Notice>}
      <I3RecoveryNotice rows={recoveryRows} />
      {conflictUi}
      <I3PendingCapNotice rows={pendingCapRows} link={auditReachable ? <Link className="rd-link" href={AUDIT_HREF} prefetch={false}>到操作记录与审批看</Link> : undefined} />
      {releasing && <ReleaseModal label={`调整${TIER[releasing.tier as TierK].label}优先级保留上限 · ${releasing.before} → ${releasing.after} 条`}
        explain="原申请超过 24 小时，按原请求查不到这张审批单，说明它没建成。确认时会再查一次，仍查不到才解除。"
        onCancel={() => setReleasing(null)} onConfirm={() => void releaseCap(releasing)} />}
      {!data ? contentLoading ? <BlockState state="loading" title="通知活动加载中…" /> : <BlockState state="error" title="通知活动读取失败" detail={errorText ?? "暂时读不到，请稍后重试。"} onRetry={() => void actions.reloadIContent()} /> : <>
      {conclusion}

      <StatBand label="通知活动概况">
        <Stat tone="role-3" icon={CalendarClock} label="等着发" value={String(I3_STATS.monthScheduled)} unit="条" sub={`其中紧急 ${I3_STATS.criticalInflight} 条`}
          explain="已排期和发送中的活动。紧急指紧急优先级的活动条数。" />
        <Stat tone="role-2" icon={FilePen} label="草稿" value={String(I3_STATS.monthDraft)} unit="条" explain="还没排期，不会发给任何人。" />
        <Stat tone="role-2" icon={Send} label="已发送" value={String(I3_STATS.monthSent)} unit="条" sub={`活动共 ${I3_STATS.monthCampaigns} 条`}
          explain="全部没删除的活动，不分月份。" />
        <Stat tone="role-3" icon={Users} label="已读率（活动记录）" value={I3_STATS.avgReadRate} sub={`左滑推算 ${I3_STATS.weeklySwipe}`}
          explain={<>
            <p>已读率：已发送活动记录里的已读数 ÷ 送达数。用户在 App 读通知后，这个已读数目前不更新（已提后端），不是实时已读率。</p>
            <p>左滑推算：已读数 × 3.1%，不是实际左滑次数，也不分本周。</p>
          </>} />
      </StatBand>

      <Panel title="通知活动" icon={Bell} tone="role-3" data-proof="i3-campaign-list" sub={`${filtered.length} 条 · 时间为${businessZone().label}`}
        explain="按状态分组：等着发的按发送时间排，最近要发的在前；其余按建立时间，新的在前。点卡片看内容和详情。">
        <FilterBar scope={<Segments label="按状态筛选" value={stFlt} onChange={setStFlt} items={ST_FLT.map(([value, label]) => ({ value, label, count: countOf(value) }))} />}
          sort={<span className="rd-filter-result">等着发的按时间排，最近的在前</span>} />
        {listEmpty
          ? <BlockState state="empty" title={CAMPAIGNS.length === 0 ? "新建的通知会显示在这里" : "这个状态下没有通知"} detail={CAMPAIGNS.length === 0 ? (canWriteI3 ? undefined : "有修改权限的同事新建后会显示在这里。") : "换一个状态看看。"} />
          : <div className="i3-groups">
            {upcoming.length > 0 && (
              <section className="i3-group" aria-labelledby="i3-group-upcoming">
                <h3 className="i3-group-title" id="i3-group-upcoming">{iconOf(CalendarClock)}等着发<span className="i3-group-count">{`${upcoming.length} 条`}</span></h3>
                <ol className="i3-rail" aria-label="排期时间线">
                  {upcoming.map((row, index) => (
                    <ScheduleItem key={row.id} row={row} first={index === 0 || (index === 1 && upcoming[0].st === "sending" && row.st === "scheduled")}>
                      <CampaignCard row={row} kindLabel={kindLabel(row.kind)} selected={row.id === detail?.id} onOpen={() => setDetail(row)} actions={renderActions(row)} />
                    </ScheduleItem>
                  ))}
                </ol>
              </section>
            )}
            {group("draft", "草稿", filtered.filter((c) => c.st === "draft"), FilePen)}
            {group("failed", "发送失败", filtered.filter((c) => c.st === "failed"), Send)}
            {group("sent", "已发送", filtered.filter((c) => c.st === "sent"), Send)}
            {group("cancelled", "已取消", filtered.filter((c) => c.st === "cancelled"), Trash2)}
          </div>}
      </Panel>

      <Panel title="每位用户最多保留几条" icon={Layers} tone="role-4" data-proof="i3-cap-rules"
        sub={`${CAP_TIERS.length} 档`}
        explain="按优先级分别算：每位用户每种优先级只留最新的几条，超出的删掉，未读的也删；清理在发送通知、执行调整或用户读通知时进行。调整要提交审批，批准执行时立刻对全体用户清理一次；调高不会恢复已删的。这是保留条数，不是发送数量。">
        {CAP_TIERS.length === 0
          ? <BlockState state="empty" title="没有读到保留规则" />
          : <div className="i3-caps">
            {CAP_TIERS.map((row) => {
              const tier = row.tier as TierK;
              const cap = liveCap(tier, row.cap);
              return (
                <CapCard key={tier} tier={tier} cap={row.cap} policy={operatorCopyText(row.policy)} locked={row.locked}
                  pending={(() => { const item = pendingCaps.find((p) => p.tier === tier && p.ticketStatus === "pending"); return item ? `${item.after} 条` : undefined; })()}
                  action={!row.locked && showCapAdjust ? <Button size="sm" aria-label={`调整${TIER[tier].label}优先级保留上限`} disabledReason={capPermission || newMutationReason || (pendingCaps.some((item) => item.tier === tier) ? (pendingCaps.some((item) => item.tier === tier && item.ticketStatus === "pending") ? "这一档有申请等另一位批准，批准或驳回后才能再调。" : pendingCaps.some((item) => item.tier === tier && item.receiptKnown) ? "这一档的申请已提交，审批状态还没查到；先点「查询原结果」。" : "这一档有结果未知的申请，先点「查询原结果」。") : undefined)} onClick={() => adjustCap(tier, cap)}>调整</Button> : undefined} />
              );
            })}
          </div>}
      </Panel>

      <Fold title="点了和左滑去哪" icon={Route} tone="role-other" summary={`App 实际规则 · 系统登记的说明 ${SWIPE_ROWS.length} 行`}
        explain="App 里点通知的按钮或左滑通知会跳到哪里。这页不跳转、不改用户的通知。">
        <div className="i3-route">
          <section aria-labelledby="i3-route-real">
            <h4 className="i3-sub-title" id="i3-route-real">App 实际怎么跳</h4>
            <p className="i3-route-lead">设了「点了去哪」：点按钮去那里，左滑也去（系统通知左滑不跳）。没设：点了只标已读，左滑按下表。</p>
            <Table label="没设跳转时左滑去哪" className="i3-route-table">
              <thead><tr><Th>通知类型</Th><Th>没设「点了去哪」时左滑去</Th></tr></thead>
              <tbody>
                {Object.entries(KIND_DEFAULT_ROUTE).map(([kind, href]) => (
                  <Tr key={kind}><Td>{kindLabel(kind)}</Td><Td grow>{ctaLabelOf(href)}</Td></Tr>
                ))}
                <Tr><Td>{kindLabel("system")}</Td><Td grow><span className="i3-weak">不跳转（系统通知左滑不跳）</span></Td></Tr>
              </tbody>
            </Table>
          </section>
          <section aria-labelledby="i3-route-catalog">
            <h4 className="i3-sub-title" id="i3-route-catalog">系统登记的说明<Explain label="系统登记的说明是什么" content="系统里写死的三行说明，和 App 实际跳转不全一致（比如退款没有对应的通知类型），以上面的实际规则为准；已提出统一。" /></h4>
            <Table label="系统登记的左滑说明" className="i3-route-table">
              <thead><tr><Th>通知类型</Th><Th>写的跳转</Th><Th>说明</Th></tr></thead>
              <tbody>
                {SWIPE_ROWS.map((r) => (
                  <Tr key={r.kind}>
                    <Td>{DELIVERY_CATALOG?.kinds.find((option) => option.value === r.kind)?.label ?? `类型未知（${r.kind}）`}</Td>
                    <Td>{r.to.trim() === "-" || r.to.startsWith("—") ? <span className="i3-weak">不跳转</span> : <span data-mono="">{r.to}</span>}</Td>
                    <Td grow>{operatorCopyText(r.note).replace(/\s*-\s*system kind\s*/i, "：系统通知").replace(/\s*->\s*/g, " → ")}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </section>
        </div>
      </Fold>

      <PaginationExemptionList
        items={[
          {
            label: "通知活动",
            kind: "reference-catalog",
            maxRows: GROUP_PREVIEW,
            reason: "后端一次返回全部活动、不分页；全部视图每个状态组先显示 6 条，其余点「显示全部」按状态筛出",
          },
          {
            label: "系统登记的左滑说明",
            maxRows: 3,
            reason: "系统固定的三行说明",
          },
        ]}
      />

      </>}

      {/* ===== 新建 / 编辑：左边填，右边是 App 里的样子 ===== */}
      {newOpen && (canWriteI3 || !!drawerPendingKey) && (
        <CampaignFormDrawer
          editing={editing}
          form={form}
          setForm={setForm}
          lang={formLang}
          setLang={setFormLang}
          submitting={submitting}
          frozen={!!drawerPendingKey}
          blocked={drawerPendingKey ? drawerRetryReason : lockReason(editing?.id ?? "create")}
          estimating={estimating}
          estimatedAudience={estimatedAudience}
          estimatedAt={estimatedAt}
          audienceCatalog={drawerOriginal?.formSnapshot?.audienceCatalog ?? AUDIENCE_CATALOG}
          deliveryCatalog={drawerOriginal?.formSnapshot?.deliveryCatalog ?? DELIVERY_CATALOG}
          tierOptions={TIER_OPTS}
          kindLabel={drawerOriginal?.formSnapshot ? (kind) => drawerOriginal.formSnapshot!.deliveryCatalog.kinds.find((option) => option.value === kind)?.label ?? kind : kindLabel}
          onSubmit={submitNew}
          onClose={() => {
            if (submitting) return;
            if (JSON.stringify(form) !== JSON.stringify(formBase)) { setLeaving(true); return; }
            setNewOpen(false); setEditing(null);
          }}
        />
      )}
      {leaving && <Modal title="放弃这次填写？" onClose={() => setLeaving(false)} footer={<>
        <Button onClick={() => setLeaving(false)}>继续填写</Button>
        <Button variant="danger-outline" onClick={() => { setLeaving(false); setNewOpen(false); setEditing(null); }}>放弃并关闭</Button>
      </>}><p>填的内容还没保存，关闭后不保留。</p></Modal>}

      {/* ===== 排期 ===== */}
      {scheduleRow && (canSendCampaign(scheduleRow) || !!schedulePendingKey) && (
        <Modal title="排期发送" icon={CalendarClock}
          sub={<><StatusTag tone="progress" filled>到点自动发送</StatusTag><StatusTag tone="neutral">发出前可以取消</StatusTag></>}
          busy={submitting} dirty={!!(scheduledAt || scheduleReason || scheduleVerified)}
          onClose={() => { if (!submitting) setScheduleRow(null); }}
          footer={<>
            <Button disabled={submitting} onClick={() => setScheduleRow(null)}>取消</Button>
            <Button variant="primary" loading={submitting}
              disabledReason={schedulePendingKey ? scheduleRetryReason : lockReason(scheduleRow.id) || (!scheduledAt ? "还没选发送时间" : !scheduleVerified ? "还没勾选已核对" : scheduleReason.trim().length < 8 ? "操作理由至少 8 字" : scheduleReason.trim().length > 200 ? "操作理由最多 200 字" : undefined)}
              onClick={() => void submitSchedule()}>{schedulePendingKey ? "按原请求重试" : "确认排期"}</Button>
          </>}>
          <Facts>
            <Fact k="预计" lead unit="人">{quantityText(scheduleRow.reach)}</Fact>
            <Fact k="通知">{scheduleRow.name}</Fact>
            <Fact k="发给谁">{scheduleRow.audience}</Fact>
            <Fact k="优先级" tone={scheduleRow.tier === "critical" ? "danger" : undefined}>{`${I3_TIER_STATE[scheduleRow.tier][0]}${scheduleRow.tier === "critical" ? "（不看用户的通知设置）" : ""}`}</Fact>
            <Fact k="能不能撤">发出前可以取消，取消后不能再排期；发出后撤不回</Fact>
          </Facts>
          {scheduleRow.reach.trim() === "0" && <Notice tone="warn">保存时估算是 0 人。排期时会重新估算，还是 0 人就排不上。</Notice>}
          <Field label={`发送时间（${businessZone().label}）`} required help="要晚于现在。到点后自动发出，排队多时会晚；按那时符合条件的用户发送。">
            {(control) => <Input {...control} disabled={!!schedulePendingKey} type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />}
          </Field>
          <Check label="我已核对中文、越南语、英语的标题和正文，以及发给谁" checked={scheduleVerified} disabled={!!schedulePendingKey} onChange={(e) => setScheduleVerified(e.target.checked)} />
          <Field label="操作理由" required hint="至少 8 字">
            {(control) => <Textarea {...control} disabled={!!schedulePendingKey} rows={3} maxLength={200} value={scheduleReason} count={`${scheduleReason.trim().length}/200`} placeholder="例如：11 月活动开始当天上午提醒" onChange={(e) => setScheduleReason(e.target.value)} />}
          </Field>
        </Modal>
      )}

      {/* ===== 详情：列表那一行的快照 ===== */}
      <Drawer open={!!detailRow} onClose={() => setDetail(null)} title="通知活动详情" sub={detailRow?.name} icon={Bell} tone="role-3"
        explain="内容来自打开页面或刷新时读到的列表，不是另读一次。"
        footer={shownDetail && !errorText && canWriteI3 ? <Decision others={renderActions(shownDetail, "md")} /> : undefined}>
        {detailRow && (() => {
          const c = detailRow;
          const lang = splitBody(detailLang === "zh" ? c.bodyZh : detailLang === "vi" ? c.bodyVi : c.bodyEn);
          const enMissing = !splitBody(c.bodyEn).title.trim() && !splitBody(c.bodyEn).body.trim();
          const budget = liveBudget(c.id);
          const fallbackRoute = KIND_DEFAULT_ROUTE[c.kind];
          return <>
            <div className="rd-toolbar i3-detail-read">
              <span>{`${readStamp || "—"} · 详情是这一刻的列表内容`}</span>
              <Button variant="ghost" size="sm" loading={contentLoading} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void actions.reloadIContent()}>刷新</Button>
            </div>
            {!shownDetail && <Notice tone="warn">刷新后的列表里没有这条了，可能已被删除。下面是之前读到的内容。</Notice>}
            <Facts>
              <Fact k={reachLabel(c)} lead unit={quantityText(c.reach) === "—" ? undefined : "人"}>{quantityText(c.reach)}</Fact>
              <Fact k="状态"><CampaignStatusTag st={liveSt(c)} /></Fact>
              <Fact k="发送">{c.st === "scheduled" ? `${whenText(c)}（${businessZone().label}）` : whenText(c)}</Fact>
              <Fact k="发给谁">{c.audience}</Fact>
              <Fact k="优先级"><TierTag tier={c.tier} /></Fact>
              <Fact k="类型">{kindLabel(c.kind)}</Fact>
            </Facts>
            <section className="i3-detail-block" aria-label="通知内容">
              <div className="i3-detail-head">
                <h3 className="i3-sub-title">App 里的样子</h3>
                <LocaleTabs label="查看语言" value={detailLang} onChange={setDetailLang} items={[
                  { value: "zh", label: "中文" },
                  { value: "vi", label: "越南语" },
                  { value: "en", label: "英语", missing: enMissing },
                ]} />
              </div>
              <NotificationPreview lang={detailLang} title={lang.title} body={lang.body} ctaLabel={c.ctaHref ? (c.ctaLabel || ctaLabelOf(c.ctaHref)) : ""} tier={c.tier} kindLabel={kindLabel(c.kind)}
                missing={detailLang === "en" && enMissing} fallback="英语没填：英语用户收到系统默认的英文；其他语言有译文用译文，没有也用默认英文。" />
            </section>
            <Facts>
              <Fact k="送达 / 已读">{c.st === "sent" ? `${quantityText(c.sent)} / ${quantityText(c.read)}` : "—"}</Fact>
              <Fact k="点了去哪">{c.ctaHref ? ctaLabelOf(c.ctaHref) : "无跳转（点了只标已读）"}</Fact>
              <Fact k="左滑">{c.kind === "system" ? "不跳转（系统通知左滑不跳）" : c.ctaHref ? `去「${ctaLabelOf(c.ctaHref)}」` : fallbackRoute ? `去「${ctaLabelOf(fallbackRoute)}」（按类型默认）` : "不跳转"}</Fact>
              <Fact k="预算">{budget === undefined || budget === "null" ? "—" : `${budget} USD（只记录，不扣款、不发奖）`}</Fact>
            </Facts>
            {c.tier === "critical" && <Notice tone="neutral">紧急通知不看用户的通知设置，也不按保留上限清理。</Notice>}
            <Fold title="技术信息" tone="role-other" inset summary={`版本 ${c.revision}`}>
              <Facts>
                <Fact k="编号"><span data-mono="">{c.id}</span></Fact>
                <Fact k="版本">{String(c.revision)}</Fact>
                <Fact k="后端的发送文字">{c.schedule || "—"}</Fact>
                <Fact k="旧的跳转设置">{c.swipeTo && c.swipeTo !== "-" ? c.swipeTo : "—（不代表实际跳转）"}</Fact>
              </Facts>
            </Fold>
          </>;
        })()}
      </Drawer>
    </div>
  );
}

const STATUS_TEXT: Record<CampaignRow["st"], string> = { draft: "草稿", scheduled: "已排期", sending: "发送中", sent: "已发送", failed: "发送失败", cancelled: "已取消" };

function iconOf(Icon: typeof Bell) {
  return <Icon size={16} aria-hidden className="i3-group-icon" />;
}

function StatusChange({ from, to }: { from: string; to: string }) {
  return <span className="i3-change">{from}<span aria-hidden> → </span><b>{to}</b></span>;
}

/** 调整保留上限：改了会怎样，随输入变。 */
function capPreview(tier: TierK, now: string, value: string): ReactNode {
  const next = Number(value);
  const current = Number(now);
  if (!value || !Number.isInteger(next) || !Number.isFinite(current)) return undefined;
  const name = `${TIER[tier].label}优先级`;
  if (next < current) return `调低到 ${next} 条：批准执行时，每位用户的${name}通知只留最新 ${next} 条，多出的立刻删除，未读的也删。会删多少条这页读不到。`;
  if (next > current) return `调高到 ${next} 条：以后每位用户多留一些；已经删掉的不会恢复。`;
  return "和现在一样，提交会被拒绝。";
}

type FormProps = {
  editing: CampaignRow | null;
  form: NewForm;
  setForm: (next: NewForm) => void;
  lang: Lang;
  setLang: (next: Lang) => void;
  submitting: boolean;
  frozen: boolean;
  blocked?: string;
  estimating: boolean;
  estimatedAudience: number | null;
  estimatedAt: number | null;
  audienceCatalog: NonNullable<ICtx["content"]["campaigns"]>["audienceCatalog"] | undefined;
  deliveryCatalog: NonNullable<ICtx["content"]["campaigns"]>["deliveryCatalog"] | undefined;
  tierOptions: TierK[];
  kindLabel: (kind: string) => string;
  onSubmit: () => void;
  onClose: () => void;
};

const TITLE_KEY: Record<Lang, "titleZh" | "titleVi" | "titleEn"> = { zh: "titleZh", vi: "titleVi", en: "titleEn" };
const BODY_KEY: Record<Lang, "bodyZh" | "bodyVi" | "bodyEn"> = { zh: "bodyZh", vi: "bodyVi", en: "bodyEn" };
const I3_TICKET = { pending: "待审批", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" };
const I3_ACTION: Record<I3Command["action"], string> = { create: "新建通知", draft: "编辑通知草稿", schedule: "排期发送", "send-now": "立即发送通知", cancel: "取消排期", delete: "删除通知草稿" };
const SAVE_TITLE_MAX = 160;
const SAVE_BODY_MAX = 4000;

/** 新建、编辑的宽抽屉：左边填，右边是通知列表里和点开后的样子。提交沿用页面的 submitNew。 */
function CampaignFormDrawer({ editing, form, setForm, lang, setLang, submitting, frozen, blocked: mutationBlocked, estimating, estimatedAudience, estimatedAt, audienceCatalog, deliveryCatalog, tierOptions, kindLabel, onSubmit, onClose }: FormProps) {
  const set = (key: keyof NewForm, value: string) => { if (!frozen) setForm({ ...form, [key]: value }); };
  const title = form[TITLE_KEY[lang]];
  const body = form[BODY_KEY[lang]];
  const titleLen = chars(title.trim()).length;
  const bodyLen = chars(body.trim()).length;
  const required = lang !== "en";
  const missing = [
    !form.name.trim() && "名称",
    !form.titleZh.trim() && "中文标题",
    !form.bodyZh.trim() && "中文正文",
    !form.titleVi.trim() && "越南语标题",
    !form.bodyVi.trim() && "越南语正文",
  ].filter(Boolean) as string[];
  const langMissing = (l: Lang) => l !== "en" && (!form[TITLE_KEY[l]].trim() || !form[BODY_KEY[l]].trim());
  const over = (["zh", "vi", "en"] as Lang[]).filter((l) => chars(form[TITLE_KEY[l]].trim()).length > TITLE_SENT || chars(form[BODY_KEY[l]].trim()).length > BODY_SENT);
  const selectedCta = deliveryCatalog?.ctaRoutes.find((option) => option.value === form.ctaHref);
  const enEmpty = !form.titleEn.trim() && !form.bodyEn.trim();
  const blocked = mutationBlocked || (!audienceCatalog && !frozen ? "受众目录没读到，不能保存；刷新页面后再试" : estimating && !frozen ? "正在估算人数，估完再保存" : undefined);
  const lengthHelp = (len: number, sent: number, saveMax: number) => len > saveMax
    ? `${len}/${sent} 字：超过 ${saveMax} 字，保存会被拒绝`
    : len > sent ? `${len}/${sent} 字：App 只收到前 ${sent} 字，后面的截掉（预览里划掉的部分）` : undefined;

  return (
    <Drawer open wide data-i3-form="" busy={submitting} onClose={onClose} title={editing ? "编辑通知草稿" : "新建通知"} sub={editing ? editing.name : "保存为草稿，不会发给任何人"} icon={FilePen} tone="role-3"
      explain="左边填，右边看 App 里的样子。保存后是草稿；之后在卡片上点「排期」或「立即发送」才会发出。"
      footer={<Decision note={missing.length ? `还缺：${missing.join("、")}` : over.length ? `${over.map((l) => LANG_NAME[l]).join("、")}有超长的内容，App 只收到前面一段` : undefined}
        primary={<Button variant="primary" loading={submitting} disabledReason={blocked} onClick={onSubmit}>{frozen ? "按原请求重试" : editing ? "保存修改" : "保存草稿"}</Button>}
        others={<Button disabled={submitting} onClick={onClose}>取消</Button>} />}>
      <div className="rd-split i3-form-split" data-detail="" data-preview="">
        <div className="i3-form">
          {frozen && <Notice tone="warn" title="结果未知">原请求已冻结，只能按原请求重试或在页面上方查询原结果。</Notice>}
          <section className="i3-form-section" aria-labelledby="i3-f-base">
            <h3 id="i3-f-base" className="i3-sub-title">基本信息</h3>
            <Field label="名称" required help="只给后台看，最多 160 字。">
              {(control) => <Input {...control} disabled={frozen} value={form.name} placeholder="如：11 月费率说明" onChange={(e) => set("name", e.target.value)} />}
            </Field>
            <Field label="优先级" required help={form.tier === "critical" ? "紧急：不看用户的通知设置，不按保留上限清理；排期和发送要有紧急通知发送权限。" : "决定按哪一档保留上限清理，见页面下方。"}>
              <Segments label="优先级" value={form.tier} onChange={(next) => set("tier", next)} items={tierOptions.map((t) => ({ value: t, label: TIER[t].label, disabled: frozen }))} />
            </Field>
            <div className="rd-form-grid" data-cols="2" data-dense="">
              <Field label="通知类型" required help="用户能按类型关掉，紧急除外。">
                {(control) => <Select {...control} aria-label="通知类型" value={form.kind} disabled={frozen || !deliveryCatalog} onChange={(next) => set("kind", next)}
                  options={(deliveryCatalog?.kinds ?? []).map((option) => ({ value: option.value, label: option.label }))} />}
              </Field>
              <Field label="点了去哪" help={form.ctaHref ? (form.kind === "system" ? "通知里出现按钮，点按钮去这里；系统通知左滑不跳。" : "通知里出现按钮，点按钮和左滑都去这里。") : form.kind === "system" ? "没有按钮，点了只标已读；系统通知左滑不跳。" : `没有按钮，点了只标已读；左滑仍按类型去默认页。`}>
                {(control) => <Select {...control} aria-label="点了去哪" value={form.ctaHref} disabled={frozen || !deliveryCatalog} onChange={(next) => set("ctaHref", next)}
                  options={(deliveryCatalog?.ctaRoutes ?? []).map((option) => ({ value: option.value, label: option.label }))} />}
              </Field>
            </div>
          </section>

          <section className="i3-form-section" aria-labelledby="i3-f-text">
            <div className="i3-form-head">
              <h3 id="i3-f-text" className="i3-sub-title">通知内容<Explain label="字数怎么算" content="这里按字符数。保存上限（标题 160、正文 4000）另按长度算，表情等特殊字符算 2 个，可能没到上限就被拒。" /></h3>
              <LocaleTabs label="内容语言" value={lang} onChange={setLang} items={[
                { value: "zh", label: "中文", missing: langMissing("zh") },
                { value: "vi", label: "越南语", missing: langMissing("vi") },
                { value: "en", label: enEmpty ? "英语（选填）" : "英语" },
              ]} />
            </div>
            <Field label={`${LANG_NAME[lang]}标题`} required={required} help={lengthHelp(titleLen, TITLE_SENT, SAVE_TITLE_MAX) ?? `${titleLen}/${TITLE_SENT} 字，App 收到前 ${TITLE_SENT} 字`}>
              {(control) => <Input {...control} disabled={frozen} value={title} placeholder={lang === "vi" ? "Dòng đầu tiên" : lang === "en" ? "First line in the list" : "通知列表里的第一行"} onChange={(e) => set(TITLE_KEY[lang], e.target.value)} />}
            </Field>
            <Field label={`${LANG_NAME[lang]}正文`} required={required} help={lengthHelp(bodyLen, BODY_SENT, SAVE_BODY_MAX) ?? (lang === "en" && enEmpty ? "不填时英语用户收到系统默认的英文；只填标题或正文时，缺的那部分用默认。" : "{name} 这类占位符三种语言要一致。")}>
              {(control) => <Textarea {...control} disabled={frozen} rows={6} value={body} count={`${bodyLen}/${BODY_SENT}`} placeholder={lang === "vi" ? "Nội dung thông báo" : lang === "en" ? "Notification body" : "点开后看到的正文"} onChange={(e) => set(BODY_KEY[lang], e.target.value)} />}
            </Field>
          </section>

          <section className="i3-form-section" aria-labelledby="i3-f-who">
            <h3 id="i3-f-who" className="i3-sub-title">发给谁<Explain label="受众怎么算" content={<>
              <p>条件要同时满足。P 阶段比的是全平台现在所处的阶段，不是每个用户自己的；现在的阶段不在范围内时估算为 0。</p>
              <p>注册天数是严格大于 N 天。</p>
              <p>到点发送时按那时的用户重新算，以后注册的用户不补发。</p>
            </>} /></h3>
            <div className="rd-form-grid" data-cols="2" data-dense="">
              <Field label="P 阶段从" required>
                {(control) => <Select {...control} aria-label="P 阶段从" value={form.phaseMin} disabled={frozen || !audienceCatalog} onChange={(next) => set("phaseMin", next)}
                  options={(audienceCatalog?.phases ?? []).map((item) => ({ value: item.value, label: item.label }))} />}
              </Field>
              <Field label="到" required>
                {(control) => <Select {...control} aria-label="P 阶段到" value={form.phaseMax} disabled={frozen || !audienceCatalog} onChange={(next) => set("phaseMax", next)}
                  options={(audienceCatalog?.phases ?? []).map((item) => ({ value: item.value, label: item.label }))} />}
              </Field>
              <Field label="语言" required>
                {(control) => <Select {...control} aria-label="语言" value={form.language} disabled={frozen || !audienceCatalog} onChange={(next) => set("language", next)}
                  options={(audienceCatalog?.languages ?? []).map((item) => ({ value: item.value, label: item.label }))} />}
              </Field>
              <Field label="注册超过" required help="0–36500 的整数，严格大于">
                {(control) => <NumberInput {...control} disabled={frozen} unit="天" min={0} step={1} value={form.registrationDaysMin} onChange={(e) => set("registrationDaysMin", e.target.value)} />}
              </Field>
            </div>
            <div className="i3-estimate" role="status" aria-live="polite">
              <span className="i3-estimate-label">预计</span>
              {frozen && estimatedAudience === null
                ? <span className="i3-estimate-num" data-words="">—</span>
                : estimating
                ? <span className="i3-estimate-num" data-words="">估算中…</span>
                : estimatedAudience === null
                  ? <span className="i3-estimate-num" data-words="">暂时估不出</span>
                  : <><span className="i3-estimate-num">{estimatedAudience.toLocaleString("en-US")}</span><span className="i3-estimate-unit">人</span></>}
              <span className="i3-estimate-note">
                {frozen && estimatedAudience === null ? "原记录没存提交时的估算" : estimatedAudience === null && !estimating ? "估算请求失败，改一下条件会重新估" : `${estimatedAt ? `${businessClock(estimatedAt)} 估算（${businessZone().label}）` : ""}，发出时可能更少`}
                <Explain label="估算和实际差多少" content={<>
                  <p>按估算那一刻的平台阶段和活跃用户数算，不看用户的通知设置。</p>
                  <p>发出时去掉关了这类通知的用户（紧急通知不去），所以实际送达可能更少，甚至是 0。</p>
                </>} />
              </span>
            </div>
          </section>

          <section className="i3-form-section" aria-labelledby="i3-f-budget">
            <h3 id="i3-f-budget" className="i3-sub-title">预算记录</h3>
            <Field label="预算" hint="选填" help="只记录，不扣款、不发奖。不填就不记。">
              {(control) => <NumberInput {...control} disabled={frozen} unit="USD" value={form.budget} onChange={(e) => set("budget", e.target.value)} />}
            </Field>
          </section>
        </div>

        <aside className="i3-form-preview" aria-label="App 里的样子">
          <div className="i3-detail-head">
            <h3 className="i3-sub-title">App 里的样子</h3>
            <span className="i3-weak">{LANG_NAME[lang]}</span>
          </div>
          <NotificationPreview lang={lang} title={title.trim()} body={body.trim()} ctaLabel={selectedCta?.value ? selectedCta.label : ""} tier={form.tier} kindLabel={kindLabel(form.kind)}
            missing={lang === "en" && enEmpty} fallback="英语没填：英语用户收到系统默认的英文；其他语言有译文用译文，没有也用默认英文。" />
          <p className="i3-weak">示意图，实际样式以 App 为准。</p>
        </aside>
      </div>
    </Drawer>
  );
}
