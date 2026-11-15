"use client";

/**
 * 通知活动的展示件：活动卡、排期时间线的一行、App 通知预览、保留上限卡、结果未知逐条提醒。
 * 只排版，不发请求、不判权限；数据和按钮由 i3-campaign.tsx 传进来。
 */
import type { ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Ban, Bell, CheckCheck, CircleHelp, Clock3, FilePen, Hourglass, Lock, Minus, Send, Siren, type LucideIcon } from "lucide-react";
import { Explain, Notice, StatusTag, type StateTone } from "@/app/components/rd";
import type { NotificationCampaignRow } from "@/lib/admin/i-client";
import { businessStamp, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";

export type CampaignRow = Omit<NotificationCampaignRow, "status" | "kind"> & {
  kind: string;
  st: NotificationCampaignRow["status"];
};
export type TierK = CampaignRow["tier"];
export type Lang = "zh" | "vi" | "en";

/** 投递时后端截到的长度（I3-现状）：标题 128 字、正文 512 字，按字符数算。 */
export const TITLE_SENT = 128;
export const BODY_SENT = 512;
export const chars = (value: string) => [...value];

export const TIER: Record<TierK, { label: string; icon: LucideIcon; tone: StateTone }> = {
  critical: { label: "紧急", icon: Siren, tone: "danger" },
  high: { label: "高", icon: ArrowUp, tone: "neutral" },
  normal: { label: "普通", icon: Minus, tone: "neutral" },
  low: { label: "低", icon: ArrowDown, tone: "neutral" },
};

export const STATUS: Record<CampaignRow["st"], { label: string; tone: StateTone; icon: LucideIcon }> = {
  draft: { label: "草稿", tone: "neutral", icon: FilePen },
  scheduled: { label: "已排期", tone: "progress", icon: Clock3 },
  sending: { label: "发送中", tone: "progress", icon: Send },
  sent: { label: "已发送", tone: "done", icon: CheckCheck },
  failed: { label: "发送失败", tone: "danger", icon: AlertTriangle },
  cancelled: { label: "已取消", tone: "neutral", icon: Ban },
};

export const LANG_NAME: Record<Lang, string> = { zh: "中文", vi: "越南语", en: "英语" };

export function TierTag({ tier }: { tier: TierK }) {
  const meta = TIER[tier];
  return <StatusTag tone={meta.tone} icon={meta.icon}>{`${meta.label}优先级`}</StatusTag>;
}

export function CampaignStatusTag({ st }: { st: CampaignRow["st"] }) {
  const meta = STATUS[st];
  return <StatusTag tone={meta.tone} icon={meta.icon}>{meta.label}</StatusTag>;
}

/** reach、sent、read 是后端的字符串，「-」和空不是 0。 */
export const quantityText = (value?: string) => {
  const raw = (value ?? "").trim();
  if (!/^\d+$/.test(raw)) return "—";
  return Number(raw).toLocaleString("en-US");
};

/** 发送时间这一格：只有已排期的是时间，其余是后端写的状态说明。 */
export function whenText(row: CampaignRow): string {
  if (row.st === "scheduled") return /^\d{4}-\d{2}-\d{2}T/.test(row.schedule) ? formatBusinessTimeCompact(row.schedule, row.schedule) : row.schedule || "—";
  if (row.st === "draft") return "还没排期";
  if (row.st === "sending") return "正在写入用户通知";
  if (row.st === "sent") return "已发出";
  if (row.st === "cancelled") return "已取消，不会发送";
  return row.schedule && row.schedule !== "-" ? row.schedule : "没有发出";
}

/** 人数这一格的名字：发出后是实际写入的条数，之前是保存草稿时的估算。 */
export const reachLabel = (row: CampaignRow) => row.st === "sent" ? "送达" : row.st === "failed" || row.st === "cancelled" ? "保存时估算" : "预计";

export function splitBody(value: string) {
  const [title = "", ...body] = value.split("\n");
  return { title, body: body.join("\n") };
}

/** 超出投递长度的部分画成删除线，后面写「之后 N 字不会发出」。 */
export function CutText({ text, limit, className }: { text: string; limit: number; className?: string }) {
  const list = chars(text);
  if (list.length <= limit) return <span className={className}>{text}</span>;
  const kept = list.slice(0, limit).join("");
  const rest = list.slice(limit);
  return (
    <span className={className}>
      {kept}
      <del className="i3-cut" aria-label={`超出 ${limit} 字，下面 ${rest.length} 字不会发出`}>{rest.slice(0, 24).join("")}{rest.length > 24 ? "…" : ""}</del>
      <span className="i3-cut-note">{`之后 ${rest.length} 字不会发出`}</span>
    </span>
  );
}

/** App 通知列表里的一行和点开后的样子（示意）。按 App 收到的长度截断。 */
export function NotificationPreview({ lang, title, body, ctaLabel, tier, kindLabel, missing, fallback }: {
  lang: Lang;
  title: string;
  body: string;
  ctaLabel: string;
  tier: TierK;
  kindLabel: string;
  /** 这种语言没填。 */
  missing?: boolean;
  /** 没填时用户收到的是什么，一句话。 */
  fallback?: string;
}) {
  const emptyTitle = !title.trim();
  return (
    <div className="i3-preview" data-lang={lang}>
      {missing && <Notice tone="warn">{fallback ?? `${LANG_NAME[lang]}还没填`}</Notice>}
      <section className="i3-preview-block" aria-label="App 通知列表里的样子">
        <h4 className="i3-preview-title">通知列表里</h4>
        <div className="i3-phone-row" data-tier={tier}>
          <span className="i3-phone-icon" aria-hidden><Bell size={16} /></span>
          <div className="i3-phone-text">
            <div className="i3-phone-head">
              <span className="i3-phone-kind">{kindLabel}</span>
              {tier === "critical" && <span className="i3-phone-flag">紧急</span>}
              <span className="i3-phone-time">刚刚</span>
            </div>
            <p className="i3-phone-name" data-empty={emptyTitle ? "" : undefined}>{emptyTitle ? "（标题还没填）" : <CutText text={title} limit={TITLE_SENT} />}</p>
            <p className="i3-phone-snippet" data-empty={body.trim() ? undefined : ""}>{body.trim() ? body : "（正文还没填）"}</p>
          </div>
        </div>
      </section>
      <section className="i3-preview-block" aria-label="点开的样子">
        <h4 className="i3-preview-title">点开后</h4>
        <div className="i3-phone-open">
          <p className="i3-phone-name" data-empty={emptyTitle ? "" : undefined}>{emptyTitle ? "（标题还没填）" : <CutText text={title} limit={TITLE_SENT} />}</p>
          <p className="i3-phone-body" data-empty={body.trim() ? undefined : ""}>{body.trim() ? <CutText text={body} limit={BODY_SENT} /> : "（正文还没填）"}</p>
          {ctaLabel
            ? <span className="i3-phone-cta">{ctaLabel}</span>
            : <span className="i3-phone-nocta">没有跳转按钮</span>}
        </div>
      </section>
    </div>
  );
}

/** 一条活动的卡：标题、通知第一行、发给谁和人数、什么时候发、动作。整张可点开详情。 */
export function CampaignCard({ row, kindLabel, selected, onOpen, actions }: {
  row: CampaignRow;
  kindLabel: string;
  selected: boolean;
  onOpen: () => void;
  actions?: ReactNode;
}) {
  const zh = splitBody(row.bodyZh);
  return (
    <article className="i3-card" data-selected={selected ? "" : undefined} data-status={row.st}>
      <div className="i3-card-tags">
        <CampaignStatusTag st={row.st} />
        <TierTag tier={row.tier} />
        <span className="i3-card-kind">{kindLabel}</span>
      </div>
      <button type="button" className="i3-card-open" onClick={onOpen} aria-label={`打开 ${row.name} 详情`}>
        <span className="i3-card-name">{row.name}</span>
        <span className="i3-card-line">{zh.title || "（中文标题为空）"}</span>
      </button>
      <dl className="i3-card-facts">
        <div><dt>发给谁</dt><dd>{row.audience}</dd></div>
        <div><dt>{reachLabel(row)}</dt><dd data-num="" data-empty={quantityText(row.reach) === "—" ? "" : undefined}>{quantityText(row.reach) === "—" ? "—" : `${quantityText(row.reach)} 人`}</dd></div>
        <div><dt>发送</dt><dd>{whenText(row)}</dd></div>
      </dl>
      {actions && <div className="i3-card-actions">{actions}</div>}
    </article>
  );
}

/** 排期时间线的一行：左边是发送时间，右边是卡。第一条标「最近」。 */
export function ScheduleItem({ row, first, children }: { row: CampaignRow; first: boolean; children: ReactNode }) {
  const at = whenText(row);
  const [day = at, clock = ""] = at.split(" ");
  return (
    <li className="i3-rail-item" data-first={first ? "" : undefined}>
      <div className="i3-rail-time">
        {row.st === "sending"
          ? <span className="i3-rail-clock">发送中</span>
          : <><span className="i3-rail-clock">{clock || day}</span>{clock && <span className="i3-rail-day">{day}</span>}</>}
        {first && row.st !== "sending" && <span className="i3-rail-next">最近</span>}
      </div>
      <span className="i3-rail-dot" aria-hidden />
      <div className="i3-rail-card">{children}</div>
    </li>
  );
}

/** 一档保留上限：现在留几条、怎么清理、能不能调。 */
/** pending：这一档有本标签页提交、已查到在等批准的申请，写申请的新值。 */
export function CapCard({ tier, cap, policy, locked, pending, action }: { tier: TierK; cap: string; policy: string; locked: boolean; pending?: string; action?: ReactNode }) {
  const critical = tier === "critical";
  const digits = cap.match(/\d+/)?.[0];
  return (
    <div className="i3-cap" data-tier={tier}>
      <div className="i3-cap-head">
        <TierTag tier={tier} />
        {locked && <StatusTag tone="neutral" icon={Lock} explain="后端把这一档锁定了，不能调整。">锁定</StatusTag>}
        {pending && <StatusTag tone="progress" icon={Hourglass} explain="批准前上限不变。">{`等批准 → ${pending}`}</StatusTag>}
      </div>
      <div className="i3-cap-value">
        {critical
          ? <><span className="i3-cap-num" data-words="">不限</span><span className="i3-cap-unit">永久保留</span></>
          : <><span className="i3-cap-num">{digits ?? "—"}</span><span className="i3-cap-unit">{digits ? "条" : ""}</span></>}
      </div>
      <p className="i3-cap-note">
        {critical ? "不按数量清理" : tier === "low" ? "超出删最旧的；超过 48 小时的也删" : "超出的删最旧的，未读也删"}
        <Explain label={`${TIER[tier].label}优先级怎么清理`} content={policy} />
      </p>
      {action && <div className="i3-cap-action">{action}</div>}
    </div>
  );
}

/** submitted：审批单已建，批没批准还没查到。note：查询后的一句结论。 */
export type I3RecoveryRow = { key: string; name: string; object: string; change?: string; submittedAt: number; expired: boolean; submitted?: boolean; note?: string; actions: ReactNode };

/**
 * 结果未知逐条提醒：由页面传入持久化的原操作；未读取到概览时同样显示。
 * 每条写改的是什么、对哪条、从多少到多少、什么时候提交，按钮「查询原结果」「按原请求重试」。
 */
export function I3RecoveryNotice({ rows }: { rows: I3RecoveryRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Notice tone="warn" title={<>{`${rows.length} 项操作结果未知`}<Explain label="结果未知怎么处理" content={<>
      <p>提交时没收到确定结果，可能已经执行。先「查询原结果」。</p>
      <p>24 小时内可以「按原请求重试」，后端认得出是同一次提交，不会重复发送或重复建审批单；过了 24 小时只能查询。</p>
      <p>保留上限的申请过期后，后端按原请求明确查不到这张单，说明没建成，可以确认解除。</p>
    </>} /></>}>
      <ul className="i3-recovery" aria-label="结果未知的操作">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="i3-recovery-name">{row.name}</span>
            <span className="i3-recovery-object">{row.object}{row.change ? ` · ${row.change}` : ""}</span>
            <span className="i3-recovery-time">{`${businessStamp(row.submittedAt)} 提交`}</span>
            <StatusTag tone={row.expired || row.submitted ? "neutral" : "warn"} icon={CircleHelp}>{row.expired ? "已过期" : row.submitted ? "已提交，状态未查到" : "结果未知"}</StatusTag>
            <span className="i3-recovery-actions">{row.actions}</span>
            {row.note && <span className="i3-recovery-note">{row.note}</span>}
          </li>
        ))}
      </ul>
      <p className="i3-recovery-zone">{`提交时间为${businessZone().label}`}</p>
    </Notice>
  );
}

export type I3PendingCapRow = { key: string; tier: string; change: string; submittedAt: number; actions: ReactNode };

/** 已查到在等批准的保留上限申请：读不到活动列表时也显示，能查询原审批单。 */
export function I3PendingCapNotice({ rows, link }: { rows: I3PendingCapRow[]; link?: ReactNode }) {
  if (rows.length === 0) return null;
  return (
    <Notice tone="progress" title={<>{`${rows.length} 张保留上限申请等批准`}<Explain label="等批准的申请" content={<>
      <p>批准前上限不变。批准后按新上限立刻清理一次。</p>
      <p>这里只列你在这个标签页提交的申请；别人提交的到「操作记录与审批」看。</p>
    </>} /></>} action={link}>
      <ul className="i3-recovery" aria-label="等批准的申请">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="i3-recovery-name">调整保留上限</span>
            <span className="i3-recovery-object">{`${row.tier} · ${row.change}`}</span>
            <span className="i3-recovery-time">{`${businessStamp(row.submittedAt)} 提交`}</span>
            <StatusTag tone="progress" icon={Hourglass}>等批准</StatusTag>
            <span className="i3-recovery-actions">{row.actions}</span>
          </li>
        ))}
      </ul>
      <p className="i3-recovery-zone">{`提交时间为${businessZone().label}`}</p>
    </Notice>
  );
}
