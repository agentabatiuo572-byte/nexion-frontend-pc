"use client";

/**
 * 通知活动（列表页 + 宽抽屉编辑）。给一批 App 用户写一条站内通知：三语内容、优先级、类型、点了去哪、发给谁、预算记录；
 * 估算人数，排期，已排期的立即发送或取消，草稿和已取消的删除；每位用户各优先级最多保留几条提交审批。
 * 发送是真的写进用户的通知列表；预算只记录，不扣款、不发奖。
 * 读取、提交、权限判断都沿用旧页面的写法（请求逐字节不变）；这里只换界面。
 * 统一来源:后端 /content/campaigns/overview;空库时以后端初始化结果为准。
 * critical 档锁定 = 不渲染调整按钮。amplifies = false(I3 通知体系不动钱,不碰 B1 红线)。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Bell, CalendarClock, FilePen, Layers, Plus, RefreshCw, Route, Send, Trash2, Users } from "lucide-react";
import { BlockState, Button, Check, Conclusion, Decision, Drawer, Explain, Fact, Facts, Field, FilterBar, Fold, Input, IrreversibleTag, LocaleTabs, Modal, Notice, NumberInput, PageHeader, Panel, Segments, Select, Stat, StatBand, StatusTag, Table, Td, Textarea, Th, Tr } from "@/app/components/rd";
import { PaginationExemptionList } from "../design-kit";
import type { ICtx } from "./types";
import type { NotificationAudienceTarget } from "@/lib/admin/i-client";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { A2OutcomeUncertainError, createA2CommandKey } from "@/lib/admin/a2-client";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { businessClock, businessZone } from "@/lib/admin/business-time";
import { useReach } from "@/lib/nav/use-reach";
import { BODY_SENT, CampaignCard, CampaignStatusTag, CapCard, chars, I3RecoveryNotice, LANG_NAME, NotificationPreview, quantityText, reachLabel, ScheduleItem, splitBody, TIER, TierTag, TITLE_SENT, whenText, type CampaignRow, type I3RecoveryRow, type Lang, type TierK } from "./i3-parts";

/** 每个 CAP 档位一个槽位:同档位改了值就铸新命令号并丢弃旧号(旧号可能已被后端消费,
 *  留着会让「改回原值」的新操作被当成重复提交吞掉)。落 sessionStorage,刷新后重试仍去重。 */
const capCommandAttempts = createSlotAttemptStore({
  storageKey: "nexion-admin-i3-campaign-commands-v1",
});

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
/** 结果未知逐条提醒：界面已备好，现在的逻辑不保存可恢复的原请求（B05），等代码 worker 接 R1。 */
const RECOVERY_PLACEHOLDER: I3RecoveryRow[] = [];

export function I3Campaign({ ctx, errorText }: { ctx: ICtx; errorText: string | null }) {
  const { toast, openActionConfirm, openConfirm, actions, content, contentLoading } = ctx;
  const propose = usePropose();
  const reach = useReach();
  const session = useAdminAuth((state) => state.session);
  const isSuperadmin = session?.role === "superadmin";
  const authorities = session?.authorities ?? [];
  const canWriteI3 = isSuperadmin || authorities.includes("content_i3_write");
  const canAdjustI3Cap = isSuperadmin || authorities.includes("content_i3_cap_adjust");
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
  const [newRows, setNewRows] = useState<CampaignRow[]>([]);
  const [readAt, setReadAt] = useState<number | null>(null);
  const data = content.campaigns;
  const I3_STATS = data?.stats ?? { monthCampaigns: 0, monthSent: 0, monthScheduled: 0, monthDraft: 0, criticalInflight: 0, avgReadRate: "—", weeklySwipe: "—" };
  const CAMPAIGNS: CampaignRow[] = (data?.campaigns ?? []).map((row) => ({
    ...row,
    st: row.status,
  }));
  const CAP_TIERS = data?.capRules ?? [];
  const AUDIENCE_CATALOG = data?.audienceCatalog;
  const DELIVERY_CATALOG = data?.deliveryCatalog;
  const SWIPE_ROWS = data?.swipeRoutes ?? [];
  const runBackend = (task: Promise<void>, ok: string) => {
    return task
      .then(() => actions.reloadIContent())
      .then(() => { toast(ok); return true; })
      .catch((error) => {
        toast(`操作失败:${displayAdminError(error)}`);
        return false;
      });
  };

  useEffect(() => {
    if (!newOpen) return;
    const timer = window.setTimeout(() => {
      setEstimating(true);
      actions.estimateI3Audience(targetFromForm(form))
        .then((result) => setEstimatedAudience(result.estimatedUsers))
        .catch(() => setEstimatedAudience(null))
        .finally(() => setEstimating(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [newOpen, form.phaseMin, form.phaseMax, form.language, form.registrationDaysMin, actions]);

  // 只为显示：数据和估算是什么时候读到的（详情是列表那一行的快照）。
  useEffect(() => { if (data) setReadAt(Date.now()); }, [data]);
  useEffect(() => { if (!estimating) setEstimatedAt(Date.now()); }, [estimating, estimatedAudience]);

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
    return [...newRows, ...CAMPAIGNS].filter((c) => {
      if (stFlt === "all") return true;
      const st = liveSt(c);
      return st === stFlt;
    });
  }, [stFlt, newRows, CAMPAIGNS]);

  /* ---------- actions ---------- */

  const sendCmp = (c: CampaignRow) => {
    setScheduleRow(c);
    setScheduledAt("");
    setScheduleReason("");
    setScheduleVerified(false);
  };

  const openNew = () => { setEditing(null); setForm(FORM_INIT); setFormBase(FORM_INIT); setFormLang("zh"); setNewOpen(true); };

  const editDraft = (c: CampaignRow) => {
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
      budget: c.budget === undefined ? "" : String(c.budget),
    };
    setEditing(c);
    setForm(next);
    setFormBase(next);
    setFormLang("zh");
    setNewOpen(true);
  };

  const deleteDraft = (c: CampaignRow) => openConfirm({ briefKind: "record",
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
    statedBrief: { impact: "从列表里删掉这条活动；它没有发出过，用户手里的通知不受影响。", check: "后端保留记录用于操作记录，页面上没有恢复入口；要再发就新建一条。" },
    confirmTone: "danger",
    reasonPlaceholder: "例如：重复建了一条、内容作废",
    reason: true,
    okLabel: "确认删除",
    run: (reason) => runBackend(actions.deleteI3Campaign(c.id, c.revision, reason), `${c.id} 已删除`),
  });

  const sendNow = (c: CampaignRow) => openActionConfirm({ briefKind: "content",
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
    confirmLabel: "确认立即发送",
    reasonPlaceholder: "例如：活动提前开始，需要马上通知",
    amplifies: false,
    run: (reason) => {
      return runBackend(actions.sendI3CampaignNow(c.id, c.revision, reason), `已发送 · ${c.name}`);
    },
  });

  const cancelScheduled = (c: CampaignRow) => openConfirm({ briefKind: "record",
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
    okLabel: "确认取消",
    run: (reason) => {
      return runBackend(actions.cancelI3Campaign(c.id, c.revision, reason), `${c.id} 已取消`);
    },
  });

  const adjustCap = (tier: TierK, cap: string) => openActionConfirm({ briefKind: "config",
    action: <>调整通知保留数量 · {I3_TIER_STATE[tier]?.[0] ?? "未知"}</>,
    title: `调整${I3_TIER_STATE[tier]?.[0] ?? "未知"}优先级保留上限`,
    detail: (
      <>
        当前 <b>{cap}</b> · 批准执行时，按新上限立刻清理全体用户多出来的通知，未读的也删；调高不会恢复已删的。紧急通知永久保留，不能调。
        {tier === "low" && (
          <>{` `}低优先级除数量上限外,仍固定执行 48 小时自动过期清理。</>
        )}
      </>
    ),
    effect: <StatusTag tone="progress" filled explain="另一位管理员在「操作记录与审批」批准后才执行；批准前上限不变。">批准后生效</StatusTag>,
    completionCopy: "另一位管理员在「操作记录与审批」批准后执行；批准前上限不变。",
    statedBrief: {
      impact: "调低：批准执行时立刻删掉每位用户这一档超出上限的旧通知，未读的也删。调高：以后多留，已删的不恢复。",
      check: "会删多少条这页读不到；等批准的修改也在「操作记录与审批」看。",
    },
    facts: (
      <Facts>
        <Fact k="谁来批">另一位管理员，不能是提交人</Fact>
        <Fact k="需有权限">提交审批权限和通知保留上限调整权限</Fact>
      </Facts>
    ),
    confirmLabel: "提交审批",
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
      const def = findHighOp("i3_cap_adjust")!;
      const fingerprint = JSON.stringify([tier, cap, v, reason]);
      const commandKey = capCommandAttempts.resolve(`cap|${tier}`, fingerprint, () => createA2CommandKey("i3-cap-adjust"));
      try {
        const result = await propose(toast, {
          action: `调整通知保留数量 · ${tier}`,
          obj: tier,
          before: cap,
          after: v,
          type: "param",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "I3",
          commandKey,
          command: def.buildCommand({ tier, cap: v, expectedCap: cap }),
          target: def.buildTarget({ tier }),
        });
        capCommandAttempts.forget(`cap|${tier}`);
        return result;
      } catch (error) {
        if (!(error instanceof A2OutcomeUncertainError)) {
          capCommandAttempts.forget(`cap|${tier}`);
        }
        throw error;
      }
    },
  });

  /* ---------- new campaign drawer 提交 ---------- */
  const submitNew = async () => {
    if (submitting) return;
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
      budget: Number(form.budget || 0),
    };
    const id = editing?.id ?? `CMP-N-${slug(trimmedName)}`;
    const task = editing
      ? actions.updateI3CampaignDraft(editing.id, payload, editing.revision, `编辑通知草稿 ${editing.id}`)
      : actions.createI3Campaign(payload, `新建通知草稿 ${id}`);
    setSubmitting(true);
    try {
      if (await runBackend(task, editing ? `${editing.id} 草稿已保存` : `通知草稿已创建 · ${trimmedName}`)) {
        setNewOpen(false);
        setEditing(null);
        setForm(FORM_INIT);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitSchedule = async () => {
    if (!scheduleRow) return;
    setSubmitting(true);
    try {
      const saved = await runBackend(
        actions.scheduleI3Campaign(scheduleRow.id, scheduledAt, scheduleRow.revision, scheduleReason.trim()),
        `${scheduleRow.id} 已进入排期`,
      );
      if (saved) setScheduleRow(null);
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
          <Button size={size} variant={size === "md" ? "primary" : undefined} icon={<CalendarClock size={14} aria-hidden />} aria-label={`排期 ${c.name}`} disabledReason={canSendCampaign(c) ? undefined : NO_CRITICAL} onClick={() => sendCmp(c)}>排期</Button>
          <Button size={size} icon={<FilePen size={14} aria-hidden />} aria-label={`编辑 ${c.name}`} onClick={() => { setDetail(null); editDraft(c); }}>编辑</Button>
          <Button size={size} icon={<Trash2 size={14} aria-hidden />} aria-label={`删除 ${c.name}`} onClick={() => deleteDraft(c)}>删除</Button>
        </>
      );
    }
    if (st === "scheduled") {
      return (
        <>
          <Button size={size} variant="danger-outline" icon={<Send size={14} aria-hidden />} aria-label={`立即发送 ${c.name}`} disabledReason={canSendCampaign(c) ? undefined : NO_CRITICAL} onClick={() => sendNow(c)}>立即发送</Button>
          <Button size={size} aria-label={`取消排期 ${c.name}`} disabledReason={canSendCampaign(c) ? undefined : NO_CRITICAL} onClick={() => cancelScheduled(c)}>取消排期</Button>
        </>
      );
    }
    if (st === "sent" && size === "sm") {
      return <Button size={size} aria-label={`查看 ${c.name}`} onClick={() => setDetail(c)}>查看</Button>;
    }
    if (st === "cancelled") {
      return <Button size={size} icon={<Trash2 size={14} aria-hidden />} aria-label={`删除 ${c.name}`} onClick={() => deleteDraft(c)}>删除</Button>;
    }
    return null;
  };

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
      actions={canWriteI3 && data ? <Button variant="primary" icon={<Plus size={14} aria-hidden />} onClick={openNew}>新建通知</Button> : undefined}
      readOnly={!canWriteI3 ? "你只能查看；新建、排期和发送要有这页的修改权限。" : undefined}
    />
  );

  if (contentLoading && !data) {
    return <div className="i3-page-body">{header}<I3RecoveryNotice rows={RECOVERY_PLACEHOLDER} /><BlockState state="loading" title="通知活动加载中…" /></div>;
  }
  if (!data) {
    return <div className="i3-page-body">{header}<I3RecoveryNotice rows={RECOVERY_PLACEHOLDER} /><BlockState state="error" title="通知活动读取失败" detail={errorText ?? "暂时读不到，请稍后重试。"} onRetry={() => void actions.reloadIContent()} /></div>;
  }

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
        <p>等着发是已排期和发送中的活动；时间是北京时间，到点后约 30 秒内发出。</p>
        <p>保留上限的修改要批准后才生效，等批准的修改这页读不到，到「操作记录与审批」看。</p>
      </>}
      action={auditReachable ? <Link className="rd-link" href={AUDIT_HREF} prefetch={false}>看等批准的上限修改</Link> : undefined}>
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
      {errorText && <Notice tone="warn" title="数据没有读到最新" action={<Button size="sm" loading={contentLoading} onClick={() => void actions.reloadIContent()}>重新加载</Button>}>{`${errorText} 下面是上次读到的内容。`}</Notice>}
      <I3RecoveryNotice rows={RECOVERY_PLACEHOLDER} />
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
        <FilterBar scope={<Segments label="按状态筛选" value={stFlt} onChange={setStFlt} items={ST_FLT.map(([value, label]) => ({ value, label, count: countOf(value) }))} />} />
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
        explain="按优先级分别算：每位用户每种优先级只留最新的几条，超出的删掉，未读的也删。调整要提交审批，批准执行时立刻对全体用户清理一次；调高不会恢复已删的。这是保留条数，不是发送数量。">
        {CAP_TIERS.length === 0
          ? <BlockState state="empty" title="没有读到保留规则" />
          : <div className="i3-caps">
            {CAP_TIERS.map((row) => {
              const tier = row.tier as TierK;
              const cap = liveCap(tier, row.cap);
              return (
                <CapCard key={tier} tier={tier} cap={row.cap} policy={operatorCopyText(row.policy)} locked={row.locked}
                  action={!row.locked && canAdjustI3Cap ? <Button size="sm" aria-label={`调整${TIER[tier].label}优先级保留上限`} onClick={() => adjustCap(tier, cap)}>调整</Button> : undefined} />
              );
            })}
          </div>}
      </Panel>

      <Fold title="点了和左滑去哪" icon={Route} tone="role-other" summary={`App 实际规则 · 后端目录 ${SWIPE_ROWS.length} 行`}
        explain="App 里点通知的按钮或左滑通知会跳到哪里。这页不跳转、不改用户的通知。">
        <div className="i3-route">
          <section aria-labelledby="i3-route-real">
            <h4 className="i3-sub-title" id="i3-route-real">App 实际怎么跳</h4>
            <p className="i3-route-lead">设了「点了去哪」：点按钮和左滑都去那里。没设：点了只标已读，左滑按下表。</p>
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
            <h4 className="i3-sub-title" id="i3-route-catalog">后端目录<Explain label="后端目录是什么" content="后端返回的固定说明，和 App 实际跳转不全一致（比如退款没有对应的通知类型），以上面的实际规则为准。已提后端统一。" /></h4>
            <Table label="后端左滑目录" className="i3-route-table">
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
            label: "后端左滑目录",
            maxRows: 3,
            reason: "后端固定的三行说明",
          },
        ]}
      />

      {/* ===== 新建 / 编辑：左边填，右边是 App 里的样子 ===== */}
      {newOpen && canWriteI3 && (
        <CampaignFormDrawer
          editing={editing}
          form={form}
          setForm={setForm}
          lang={formLang}
          setLang={setFormLang}
          submitting={submitting}
          estimating={estimating}
          estimatedAudience={estimatedAudience}
          estimatedAt={estimatedAt}
          audienceCatalog={AUDIENCE_CATALOG}
          deliveryCatalog={DELIVERY_CATALOG}
          tierOptions={TIER_OPTS}
          kindLabel={kindLabel}
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
      {scheduleRow && canSendCampaign(scheduleRow) && (
        <Modal title="排期发送" icon={CalendarClock}
          sub={<><StatusTag tone="progress" filled>到点自动发送</StatusTag><StatusTag tone="neutral">发出前可以取消</StatusTag></>}
          busy={submitting} dirty={!!(scheduledAt || scheduleReason || scheduleVerified)}
          onClose={() => { if (!submitting) setScheduleRow(null); }}
          footer={<>
            <Button disabled={submitting} onClick={() => setScheduleRow(null)}>取消</Button>
            <Button variant="primary" loading={submitting}
              disabledReason={!scheduledAt ? "还没选发送时间" : !scheduleVerified ? "还没勾选已核对" : scheduleReason.trim().length < 8 ? "操作理由至少 8 字" : scheduleReason.trim().length > 200 ? "操作理由最多 200 字" : undefined}
              onClick={() => void submitSchedule()}>确认排期</Button>
          </>}>
          <Facts>
            <Fact k="预计" lead unit="人">{quantityText(scheduleRow.reach)}</Fact>
            <Fact k="通知">{scheduleRow.name}</Fact>
            <Fact k="发给谁">{scheduleRow.audience}</Fact>
            <Fact k="优先级" tone={scheduleRow.tier === "critical" ? "danger" : undefined}>{`${I3_TIER_STATE[scheduleRow.tier][0]}${scheduleRow.tier === "critical" ? "（不看用户的通知设置）" : ""}`}</Fact>
            <Fact k="能不能撤">发出前可以取消，取消后不能再排期；发出后撤不回</Fact>
          </Facts>
          {scheduleRow.reach.trim() === "0" && <Notice tone="warn">保存时估算是 0 人。排期时后端会重新估算，还是 0 人会被拒绝。</Notice>}
          <Field label={`发送时间（${businessZone().label}）`} required help="要晚于现在。到点后约 30 秒内发出，按那时符合条件的用户发送；预计人数是保存草稿时的估算。">
            {(control) => <Input {...control} type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />}
          </Field>
          <Check label="我已核对中文、越南语、英语的标题和正文，以及发给谁" checked={scheduleVerified} onChange={(e) => setScheduleVerified(e.target.checked)} />
          <Field label="操作理由" required hint="至少 8 字">
            {(control) => <Textarea {...control} rows={3} maxLength={200} value={scheduleReason} count={`${scheduleReason.trim().length}/200`} placeholder="例如：11 月活动开始当天上午提醒" onChange={(e) => setScheduleReason(e.target.value)} />}
          </Field>
        </Modal>
      )}

      {/* ===== 详情：列表那一行的快照 ===== */}
      <Drawer open={!!detailRow} onClose={() => setDetail(null)} title="通知活动详情" sub={detailRow?.name} icon={Bell} tone="role-3"
        explain="内容来自打开页面或刷新时读到的列表，不是另读一次。"
        footer={detailRow && canWriteI3 ? <Decision others={renderActions(detailRow, "md")} /> : undefined}>
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
                missing={detailLang === "en" && enMissing} fallback="英语没填：英语和其他语言的用户收到后端默认的英文标题和正文。" />
            </section>
            <Facts>
              <Fact k="送达 / 已读">{c.st === "sent" ? `${quantityText(c.sent)} / ${quantityText(c.read)}` : "—"}</Fact>
              <Fact k="点了去哪">{c.ctaHref ? ctaLabelOf(c.ctaHref) : "无跳转（点了只标已读）"}</Fact>
              <Fact k="左滑">{c.ctaHref ? `去「${ctaLabelOf(c.ctaHref)}」` : c.kind === "system" ? "不跳转" : fallbackRoute ? `去「${ctaLabelOf(fallbackRoute)}」（按类型默认）` : "不跳转"}</Fact>
              <Fact k="预算">{budget === undefined || budget === "null" ? "—" : `${budget} USD（只记录，不扣款、不发奖）`}</Fact>
            </Facts>
            {c.tier === "critical" && <Notice tone="neutral">紧急通知不看用户的通知设置，也不按保留上限清理。</Notice>}
            <Fold title="技术信息" tone="role-other" inset summary={`版本 ${c.revision}`}>
              <Facts>
                <Fact k="编号"><span data-mono="">{c.id}</span></Fact>
                <Fact k="版本">{String(c.revision)}</Fact>
                <Fact k="后端的发送文字">{c.schedule || "—"}</Fact>
                <Fact k="旧跳转字段">{c.swipeTo && c.swipeTo !== "-" ? c.swipeTo : "—（不代表实际跳转）"}</Fact>
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
  return "和现在一样，后端会拒绝。";
}

type FormProps = {
  editing: CampaignRow | null;
  form: NewForm;
  setForm: (next: NewForm) => void;
  lang: Lang;
  setLang: (next: Lang) => void;
  submitting: boolean;
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
const SAVE_TITLE_MAX = 160;
const SAVE_BODY_MAX = 4000;

/** 新建、编辑的宽抽屉：左边填，右边是通知列表里和点开后的样子。提交沿用页面的 submitNew。 */
function CampaignFormDrawer({ editing, form, setForm, lang, setLang, submitting, estimating, estimatedAudience, estimatedAt, audienceCatalog, deliveryCatalog, tierOptions, kindLabel, onSubmit, onClose }: FormProps) {
  const set = (key: keyof NewForm, value: string) => setForm({ ...form, [key]: value });
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
  const blocked = !audienceCatalog ? "受众目录没读到，不能保存；刷新页面后再试" : estimating ? "正在估算人数，估完再保存" : undefined;
  const lengthHelp = (len: number, sent: number, saveMax: number) => len > saveMax
    ? `超过 ${saveMax} 字，保存会被拒绝`
    : len > sent ? `超过 ${sent} 字：App 只收到前 ${sent} 字，后面的截掉（右边预览里划掉的部分）` : undefined;

  return (
    <Drawer open wide data-i3-form="" busy={submitting} onClose={onClose} title={editing ? "编辑通知草稿" : "新建通知"} sub={editing ? editing.name : "保存为草稿，不会发给任何人"} icon={FilePen} tone="role-3"
      explain="左边填，右边看 App 里的样子。保存后是草稿；之后在卡片上点「排期」或「立即发送」才会发出。"
      footer={<Decision note={missing.length ? `还缺：${missing.join("、")}` : over.length ? `${over.map((l) => LANG_NAME[l]).join("、")}有超长的内容，App 只收到前面一段` : undefined}
        primary={<Button variant="primary" loading={submitting} disabledReason={blocked} onClick={onSubmit}>{editing ? "保存修改" : "保存草稿"}</Button>}
        others={<Button disabled={submitting} onClick={onClose}>取消</Button>} />}>
      <div className="rd-split i3-form-split" data-detail="" data-preview="">
        <div className="i3-form">
          <section className="i3-form-section" aria-labelledby="i3-f-base">
            <h3 id="i3-f-base" className="i3-sub-title">基本信息</h3>
            <Field label="名称" required hint="最多 160 字" help="只给后台看，用户看不到。">
              {(control) => <Input {...control} value={form.name} placeholder="如：11 月费率说明" onChange={(e) => set("name", e.target.value)} />}
            </Field>
            <Field label="优先级" required help={form.tier === "critical" ? "紧急：不看用户的通知设置，不按保留上限清理；排期和发送要有紧急通知发送权限。" : "决定按哪一档保留上限清理，见页面下方。"}>
              <Segments label="优先级" value={form.tier} onChange={(next) => set("tier", next)} items={tierOptions.map((t) => ({ value: t, label: TIER[t].label }))} />
            </Field>
            <div className="rd-form-grid" data-cols="2" data-dense="">
              <Field label="通知类型" required help="用户可以按类型关掉通知（紧急除外）。">
                {(control) => <Select {...control} aria-label="通知类型" value={form.kind} disabled={!deliveryCatalog} onChange={(next) => set("kind", next)}
                  options={(deliveryCatalog?.kinds ?? []).map((option) => ({ value: option.value, label: option.label }))} />}
              </Field>
              <Field label="点了去哪" help={form.ctaHref ? "通知里出现按钮，点按钮和左滑都去这里。" : form.kind === "system" ? "没有按钮，点了只标已读；系统通知左滑不跳。" : `没有按钮，点了只标已读；左滑仍按类型去默认页。`}>
                {(control) => <Select {...control} aria-label="点了去哪" value={form.ctaHref} disabled={!deliveryCatalog} onChange={(next) => set("ctaHref", next)}
                  options={(deliveryCatalog?.ctaRoutes ?? []).map((option) => ({ value: option.value, label: option.label }))} />}
              </Field>
            </div>
          </section>

          <section className="i3-form-section" aria-labelledby="i3-f-text">
            <div className="i3-form-head">
              <h3 id="i3-f-text" className="i3-sub-title">通知内容</h3>
              <LocaleTabs label="内容语言" value={lang} onChange={setLang} items={[
                { value: "zh", label: "中文", missing: langMissing("zh") },
                { value: "vi", label: "越南语", missing: langMissing("vi") },
                { value: "en", label: enEmpty ? "英语（选填）" : "英语" },
              ]} />
            </div>
            <Field label={`${LANG_NAME[lang]}标题`} required={required} hint={`${titleLen}/${TITLE_SENT} 字`} help={lengthHelp(titleLen, TITLE_SENT, SAVE_TITLE_MAX)}>
              {(control) => <Input {...control} value={title} placeholder={lang === "vi" ? "Dòng đầu tiên" : lang === "en" ? "First line in the list" : "通知列表里的第一行"} onChange={(e) => set(TITLE_KEY[lang], e.target.value)} />}
            </Field>
            <Field label={`${LANG_NAME[lang]}正文`} required={required} hint={`App 收到前 ${BODY_SENT} 字`} help={lengthHelp(bodyLen, BODY_SENT, SAVE_BODY_MAX) ?? (lang === "en" && enEmpty ? "不填时，英语和其他语言的用户收到后端默认的英文内容。" : "{name} 这类占位符三种语言要一致。")}>
              {(control) => <Textarea {...control} rows={6} value={body} count={`${bodyLen}/${BODY_SENT}`} placeholder={lang === "vi" ? "Nội dung thông báo" : lang === "en" ? "Notification body" : "点开后看到的正文"} onChange={(e) => set(BODY_KEY[lang], e.target.value)} />}
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
                {(control) => <Select {...control} aria-label="P 阶段从" value={form.phaseMin} disabled={!audienceCatalog} onChange={(next) => set("phaseMin", next)}
                  options={(audienceCatalog?.phases ?? []).map((item) => ({ value: item.value, label: item.label }))} />}
              </Field>
              <Field label="到" required>
                {(control) => <Select {...control} aria-label="P 阶段到" value={form.phaseMax} disabled={!audienceCatalog} onChange={(next) => set("phaseMax", next)}
                  options={(audienceCatalog?.phases ?? []).map((item) => ({ value: item.value, label: item.label }))} />}
              </Field>
              <Field label="语言" required>
                {(control) => <Select {...control} aria-label="语言" value={form.language} disabled={!audienceCatalog} onChange={(next) => set("language", next)}
                  options={(audienceCatalog?.languages ?? []).map((item) => ({ value: item.value, label: item.label }))} />}
              </Field>
              <Field label="注册超过" required hint="0–36500 天">
                {(control) => <NumberInput {...control} unit="天" min={0} step={1} value={form.registrationDaysMin} onChange={(e) => set("registrationDaysMin", e.target.value)} />}
              </Field>
            </div>
            <div className="i3-estimate" role="status" aria-live="polite">
              <span className="i3-estimate-label">预计</span>
              {estimating
                ? <span className="i3-estimate-num" data-words="">估算中…</span>
                : estimatedAudience === null
                  ? <span className="i3-estimate-num" data-words="">暂时估不出</span>
                  : <><span className="i3-estimate-num">{estimatedAudience.toLocaleString("en-US")}</span><span className="i3-estimate-unit">人</span></>}
              <span className="i3-estimate-note">
                {estimatedAudience === null && !estimating ? "估算请求失败，改一下条件会重新估" : `${estimatedAt ? `${businessClock(estimatedAt)} 估算（${businessZone().label}）` : ""}，发出时可能更少`}
                <Explain label="估算和实际差多少" content={<>
                  <p>按估算那一刻的平台阶段和活跃用户数算，不看用户的通知设置。</p>
                  <p>发出时去掉关了这类通知的用户（紧急通知不去），所以实际送达可能更少，甚至是 0。</p>
                </>} />
              </span>
            </div>
          </section>

          <section className="i3-form-section" aria-labelledby="i3-f-budget">
            <h3 id="i3-f-budget" className="i3-sub-title">预算记录</h3>
            <Field label="预算" hint="选填" help="只记录，不扣款、不发奖。不填按 0 保存。">
              {(control) => <NumberInput {...control} unit="USD" value={form.budget} onChange={(e) => set("budget", e.target.value)} />}
            </Field>
          </section>
        </div>

        <aside className="i3-form-preview" aria-label="App 里的样子">
          <div className="i3-detail-head">
            <h3 className="i3-sub-title">App 里的样子</h3>
            <span className="i3-weak">{LANG_NAME[lang]}</span>
          </div>
          <NotificationPreview lang={lang} title={title.trim()} body={body.trim()} ctaLabel={selectedCta?.value ? selectedCta.label : ""} tier={form.tier} kindLabel={kindLabel(form.kind)}
            missing={lang === "en" && enEmpty} fallback="英语没填：英语和其他语言的用户收到后端默认的英文标题和正文。" />
          <p className="i3-weak">示意图，实际样式以 App 为准。</p>
        </aside>
      </div>
    </Drawer>
  );
}
