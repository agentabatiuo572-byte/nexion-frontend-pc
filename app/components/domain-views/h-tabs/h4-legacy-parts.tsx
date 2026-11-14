"use client";

/**
 * H4「既有活动与转盘」页签的展示件：既有活动卡、App 上的样子、转盘概率条、奖档表、护栏卡、确认框里的概率对比。
 * 只排版：数据由页面按后端读模型传进来，不发请求、不判权限、不改请求内容。
 * 取值小工具照旧页面 h3-quest-events.tsx 原样搬过来（旧文件不动）。
 */
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { CalendarRange, CircleAlert, Clock3, Flag, Gift, Hourglass, CircleHelp, Smartphone, Star, Users } from "lucide-react";
import { Explain, Fact, Facts, MoreMenu, SegmentBar, Segments, StatusTag, type MoreMenuItem } from "@/app/components/rd";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { EVENT_KIND_LABELS } from "@/lib/admin/event-rule-form";
import { amountText, formatTime } from "./h4-promotion-ui";

// ===== 取值小工具：照旧页面原样 =====
export function text(value: unknown, fallback = "-") {
  if (value == null || value === "") return fallback;
  return String(value);
}
export function numericValue(value: unknown) {
  if (typeof value === "number") return value;
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
export function boolValue(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}
export function percentText(value: unknown) {
  const amount = numericValue(value);
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/\.?0+$/, "");
}
export function casExpected(value: string) {
  const normalized = value.trim();
  return !normalized || normalized === "-" ? "__MISSING__" : normalized;
}
export const wheelPointsTier = (tier: Record<string, unknown>) => text(tier.kind).toLowerCase() === "points";
export const wheelLegacyNexTier = (tier: Record<string, unknown>) => text(tier.kind).toLowerCase() === "nex";
// App 抽奖只认这三种奖型（AppGrowthWheelService.REWARD_KINDS），有一档不合格整池校验失败。
export const WHEEL_APP_KINDS = ["uvt", "usdt", "coupon"];

/** 后端旧名称里的 NEX 按真实类型写 UVT，并标出是旧名称（和 H3、H5 同一写法）。 */
export function legacyName(value: unknown): { text: string; legacy: boolean } {
  const raw = text(value, "");
  const legacy = /\bNEX\b/i.test(raw);
  return { text: nexGridBrandText(raw.replace(/\bNEX\b/gi, "UVT").replace(/\$\s?(?=\d)/g, "")).replace(/\bpoints\b/gi, "积分").replace(/\bdevice coupon\b/gi, "设备代金券"), legacy };
}
export function LegacyNameTag({ where }: { where: string }) {
  return <StatusTag tone="warn" icon={CircleAlert} explain={`后端存的${where}还写着 NEX（产品已改名 UVT），这里按真实类型写成 UVT；App 显示的是后端存的原文。改${where}时写成 UVT。后端待办 BUG-426 已提。`}>旧名称</StatusTag>;
}

// ===== 统一叫法 =====
/** 七类玩法全页只用一套叫法（V09）：取玩法区的叫法。 */
export const KIND_LABEL = (kind: unknown) => EVENT_KIND_LABELS[text(kind, "").toLowerCase()] ?? "其他活动";
export const KIND_OPTIONS = ["discount", "referral", "regional", "boost", "seasonal", "onboarding"];

export const WHEEL_KIND_LABEL: Record<string, string> = { uvt: "UVT", usdt: "USDT", coupon: "代金券", nex: "UVT（旧奖型 nex）", points: "积分（已退役）" };
export const wheelUnit = (tier: Record<string, unknown>) => ({ uvt: "UVT", nex: "UVT", usdt: "USDT", points: "积分" } as Record<string, string>)[text(tier.kind, "").toLowerCase()];

export type LegacyEvent = {
  id: string;
  name: string;
  kind?: string;
  state: "upcoming" | "ongoing" | "ended";
  deleteState?: "draft" | "upcoming" | "ongoing" | "ended";
  deleteVersion?: string;
  deletable?: boolean;
  reward?: string;
  description?: string;
  rewardName?: string;
  featured?: boolean;
  trackable?: boolean;
  condition?: string;
  geo?: string;
  joinCount?: number;
  doneCount?: number;
  claimCount?: number;
};

/** 有效生命周期优先 deleteState，其次 state（H05）。 */
export function lifecycleOf(event: LegacyEvent) {
  const lifecycle = event.deleteState || event.state;
  if (lifecycle === "draft") return { key: "draft", label: "草稿", tone: "neutral" as const, explain: "还没开放过的活动。开放前要补齐中文、越南语的名称、说明和奖项名。" };
  if (lifecycle === "upcoming") return { key: "upcoming", label: "预告", tone: "neutral" as const, explain: "已登记、还没开放：App 上用户还参加不了。" };
  if (lifecycle === "ongoing") return { key: "ongoing", label: "进行中", tone: "ok" as const, explain: "已对用户开放。结束后不能再开。" };
  if (lifecycle === "ended") return { key: "ended", label: "已结束", tone: "done" as const, explain: "已结束：不能再开放，奖励不能再改；已有的参与、奖励和操作记录保留。" };
  return { key: "unknown", label: "状态未知", tone: "warn" as const, explain: "后端返回了这页不认识的状态，请联系后端核对。" };
}

export function unknownTag() {
  return <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，可能已经生效。先查询原结果；查不到才按原请求重试，后端认得出是同一次提交，不会重复执行。">结果未知</StatusTag>;
}
export function pendingTag(object: string) {
  return <StatusTag tone="warn" icon={Clock3} explain={`等另一位超级管理员在「操作记录与审批」批准。批准前${object}什么都不变；这期间同一对象的其他修改会被拦下。`}>待审批</StatusTag>;
}
export function expiredTag() {
  return <StatusTag tone="neutral" icon={Hourglass} explain="原请求超过 24 小时，不能再按原请求重试，只能查询原审批单；记录继续保留。">已过期</StatusTag>;
}

/** 走审批的修改在框里常显怎么生效：哪个方向要批、谁来批、批准前什么不变。 */
/** 一行写清哪个方向要批准、谁来批；放进确认框的 Facts 里。 */
export function ApprovalFact({ amplify, object }: { amplify: string; object: string }) {
  return <Fact k="要批准的">{amplify}：另一位超级管理员批准前{object}不变</Fact>;
}
export const effectDirect = <StatusTag tone="progress" filled>立即生效</StatusTag>;
export const effectByDirection = (amplify = "让平台多付钱的修改") => <><StatusTag tone="progress" filled>调低立即生效</StatusTag><StatusTag tone="neutral" explain={`${amplify}要另一位超级管理员（需有审批批准权限）批准，批准前什么都不变；其余确认后立即生效。提交时由系统判断方向。`}>调高要批准</StatusTag></>;
export const effectApproval = (note: string) => <StatusTag tone="progress" filled explain={`另一位超级管理员（需有审批批准权限）批准后才执行，批准前${note}不变。`}>批准后生效</StatusTag>;

// ===== 既有活动卡 =====
export type LocaleCode = "zh" | "en" | "vi";
export const LOCALES: LocaleCode[] = ["zh", "en", "vi"];
export const LOCALE_NAME: Record<LocaleCode, string> = { zh: "中文", en: "英文", vi: "越南语" };
export const FIELD_NAME: Record<"name" | "description" | "rewardName", string> = { name: "名称", description: "说明", rewardName: "奖项名" };

export function EventCard({ event, zh, gaps, rule, pending, primary, menu, onContent }: {
  event: LegacyEvent;
  zh: { name: string; description: string; rewardName: string };
  /** 中文、越南语缺了几项。 */
  gaps: number;
  rule?: { enabled: boolean; ready: boolean; startsAt: string | null; endsAt: string | null } | null;
  pending?: ReactNode;
  primary?: ReactNode;
  menu: MoreMenuItem[];
  onContent: () => void;
}) {
  const life = lifecycleOf(event);
  const wheel = text(event.kind, "").toLowerCase() === "wheel";
  const reward = legacyName(event.reward);
  return (
    <article className="h4-card h4l-event" aria-label={zh.name || event.id} data-dim={life.key === "ended" ? "" : undefined}>
      <header className="h4-card-head">
        <div className="h4-card-title">
          <h3 data-empty={zh.name ? undefined : ""}>{zh.name || "中文标题未配置"}</h3>
          <span className="h4-card-meta"><span className="h4-card-kind">{KIND_LABEL(event.kind)}</span><span className="h4-mono" title={event.id}>{event.id}</span></span>
        </div>
        <span className="h4l-tags">
          {event.featured && <StatusTag tone="progress" icon={Star} explain="App 首页优先展示这个活动。同时只能有一个进行中的主推活动。">主推</StatusTag>}
          <StatusTag tone={life.tone} explain={life.explain}>{life.label}</StatusTag>
        </span>
      </header>
      <p className="h4l-desc" data-empty={zh.description ? undefined : ""}>{zh.description || "中文说明未配置"}</p>
      <dl className="h4l-facts">
        <div><dt><Gift size={14} aria-hidden />奖励</dt><dd>
          {wheel ? <span className="h4-dim">按转盘奖池</span> : <>{reward.text || <span className="h4-dim">—</span>}{reward.legacy && <LegacyNameTag where="奖励文字" />}</>}
          <small>{zh.rewardName ? (zh.rewardName !== text(event.reward, "") ? `App 显示：${zh.rewardName}` : "App 显示同上") : "中文奖项名未配置"}</small>
        </dd></div>
        <div><dt><Flag size={14} aria-hidden />参与条件</dt><dd>{text(event.condition, "") ? <span className="h4l-clip" title={text(event.condition)} data-user-content="">{text(event.condition)}</span> : <span className="h4-dim">—</span>}{event.geo ? <small>地区 {event.geo}</small> : null}</dd></div>
        <div><dt><CalendarRange size={14} aria-hidden />时间</dt><dd>{!rule ? <span className="h4-dim">—</span>
          : rule.startsAt || rule.endsAt ? <><span className="h4-num">{formatTime(rule.startsAt, "Asia/Shanghai")}</span> → <span className="h4-num">{formatTime(rule.endsAt, "Asia/Shanghai")}</span><small>北京时间 · 玩法{rule.enabled ? "已开启" : rule.ready ? "已关闭，配置已就绪" : "已关闭，配置没就绪"}</small></>
          : <span className="h4-dim">未配置</span>}</dd></div>
        <div><dt><Users size={14} aria-hidden />参与</dt><dd>{event.trackable
          ? <span className="h4l-funnel"><span><b className="h4-num">{numericValue(event.joinCount)}</b> 参与</span><span aria-hidden>→</span><span><b className="h4-num">{numericValue(event.doneCount)}</b> 达标</span><span aria-hidden>→</span><span><b className="h4-num">{numericValue(event.claimCount)}</b> 已领</span></span>
          : <span className="h4-dim">不统计效果</span>}</dd></div>
      </dl>
      <footer className="h4-card-foot">
        <button type="button" className="h4-unresolved" data-tone={gaps > 0 ? "warn" : undefined} onClick={onContent}>
          {gaps > 0 ? <><CircleAlert size={14} aria-hidden /><b className="h4-num">{gaps}</b> 项翻译没填</> : <><Smartphone size={14} aria-hidden />三语内容与 App 上的样子</>}
        </button>
        <span className="h4-card-actions">{pending}{primary}<MoreMenu label={`${zh.name || event.id} 的更多操作`} items={menu} /></span>
      </footer>
    </article>
  );
}

export function EventPreview({ names, original, onEdit, canEdit }: {
  names: Record<LocaleCode, Record<"name" | "description" | "rewardName", string>>;
  original: Record<"name" | "description" | "rewardName", string>;
  onEdit: (field: "name" | "description" | "rewardName", locale: LocaleCode) => void;
  canEdit: boolean;
}) {
  const [locale, setLocale] = useState<LocaleCode>("zh");
  const shown = (field: "name" | "description" | "rewardName") => names[locale][field] || names.en[field] || original[field];
  const fallback = (["name", "description", "rewardName"] as const).some((field) => !names[locale][field]);
  return (
    <div className="h4-dialog-body h4l-content">
      <Segments label="内容语言" value={locale} onChange={setLocale} items={LOCALES.map((code) => ({
        value: code,
        label: code !== "en" && (["name", "description", "rewardName"] as const).some((field) => !names[code][field]) ? `${LOCALE_NAME[code]} · 缺失` : LOCALE_NAME[code],
        tone: code !== "en" && (["name", "description", "rewardName"] as const).some((field) => !names[code][field]) ? "warn" as const : undefined,
      }))} />
      <ul className="h4l-locale-rows" aria-label={`${LOCALE_NAME[locale]}内容`}>
        {(["name", "description", "rewardName"] as const).map((field) => {
          const value = names[locale][field];
          const old = legacyName(value);
          const missing = !value && locale !== "en";
          return <li key={field}>
            <span className="h4l-locale-key">{FIELD_NAME[field]}</span>
            <span className="h4l-locale-value" data-empty={value ? undefined : ""}>{value ? old.text : missing ? "未填写，开放前必须补齐" : `未填写，App 显示原文：${original[field] || "—"}`}{old.legacy && <LegacyNameTag where={`${LOCALE_NAME[locale]}${FIELD_NAME[field]}`} />}</span>
            {canEdit && <button type="button" className="rd-link" aria-label={`${value ? "编辑" : "填写"} ${LOCALE_NAME[locale]}${FIELD_NAME[field]}`} onClick={() => onEdit(field, locale)}>{value ? "编辑" : "填写"}</button>}
          </li>;
        })}
      </ul>
      <aside className="h4l-preview" aria-label="App 上的样子">
        <span className="h4l-preview-title"><Smartphone size={14} aria-hidden />App 上的样子
          <Explain label="这个预览怎么来的" content={<><p>按现在保存的{LOCALE_NAME[locale]}内容示意活动卡上的文字，不是 App 截图。</p><p>没填某种语言时 App 先用英文，再用原文，不自动翻译。中文和越南语的名称、说明、奖项名都填齐，活动才能开放。</p></>} />
        </span>
        <div className="h4l-phone">
          <div className="h4l-phone-card">
            <b>{legacyName(shown("name")).text || "—"}</b>
            <span className="h4l-phone-desc">{legacyName(shown("description")).text || "—"}</span>
            <span className="h4l-phone-reward"><Gift size={13} aria-hidden />{legacyName(shown("rewardName")).text || "—"}</span>
            <span className="h4l-phone-go">去参加 ›</span>
          </div>
        </div>
        {fallback && <p className="h4l-preview-note">有内容没填{LOCALE_NAME[locale]}，这里按 App 的回退显示</p>}
      </aside>
    </div>
  );
}

// ===== 转盘 =====
export type WheelTier = Record<string, any>;
const tierSlot = (tier: WheelTier) => boolValue(tier.real) ? 1 as const : text(tier.kind, "").toLowerCase() === "coupon" ? 2 as const : wheelPointsTier(tier) || wheelLegacyNexTier(tier) ? "other" as const : 3 as const;

/** 每一档的概率画成一条分段的比例条：看它能判断奖池是不是正好 100%、真钱奖占多少。 */
export function WheelBar({ tiers, label = "每一档的中奖概率", values, quiet }: { tiers: WheelTier[]; label?: string; values?: Record<string, number>; quiet?: boolean }) {
  const prob = (tier: WheelTier) => values?.[text(tier.tier)] ?? numericValue(tier.prob);
  const total = tiers.reduce((sum, tier) => sum + prob(tier), 0);
  const gap = Math.round((100 - total) * 10000) / 10000;
  const segments = [
    ...tiers.map((tier) => ({ key: text(tier.tier), label: text(tier.tier), value: prob(tier), slot: tierSlot(tier), text: `${text(tier.tier)} ${percentText(prob(tier))}%` })),
    ...(gap > 0 ? [{ key: "__gap", label: "空缺", value: gap, tone: "warn" as const, text: `还差 ${percentText(gap)}%` }] : []),
  ];
  return <div className="h4l-wheelbar">
    {total > 100.0001 ? <p className="rd-gfx-note" data-kind="problem">概率合计 {percentText(total)}%，超过 100%，没有画图</p>
      : <SegmentBar label={label} quiet={quiet} segments={segments} legend={false} />}
  </div>;
}

export function WheelLegend() {
  return <ul className="h4l-legend" aria-label="颜色表示什么">
    <li><span data-slot="1" />发真钱（USDT）</li>
    <li><span data-slot="2" />代金券</li>
    <li><span data-slot="3" />UVT</li>
    <li><span data-slot="other" />后端不认的旧奖型</li>
  </ul>;
}

/** 确认框里的新旧概率对比，随填写变。 */
export type FormStore = { get: () => Record<string, string>; set: (next: Record<string, string>) => void; subscribe: (listener: () => void) => () => void };
export function formStore(initial: Record<string, string>): FormStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => { value = next; listeners.forEach((listener) => listener()); },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

export function ProbabilityCompare({ tiers, store, valueOf }: { tiers: WheelTier[]; store: FormStore; valueOf: (tier: WheelTier, values: Record<string, string>) => string }) {
  const values = useSyncExternalStore(store.subscribe, store.get, store.get);
  const next: Record<string, number> = {};
  let readable = true;
  tiers.forEach((tier) => {
    const raw = valueOf(tier, values).trim();
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) readable = false;
    next[text(tier.tier)] = Number(raw);
  });
  const total = Object.values(next).reduce((sum, value) => sum + Math.round(value * 10000), 0) / 10000;
  const changed = tiers.filter((tier) => readable && next[text(tier.tier)] !== numericValue(tier.prob));
  return <div className="h4l-compare">
    <div className="h4l-compare-row"><span className="h4l-compare-key">现在</span><WheelBar tiers={tiers} label="现在的概率" /><span className="h4l-compare-total"><Explain label="颜色表示什么" content="金色发真钱（USDT），青色代金券，紫色 UVT，灰色是后端不认的旧奖型；橙色是还差的概率。" /></span></div>
    <div className="h4l-compare-row"><span className="h4l-compare-key">改后</span>{readable ? <WheelBar tiers={tiers} values={next} label="改后的概率" /> : <span className="h4-dim">填好全部概率后画出来</span>}<span className="h4l-compare-total" data-tone={readable && total !== 100 ? "warn" : undefined}>{readable ? <>合计 <b className="h4-num">{percentText(total)}%</b></> : null}</span></div>
    {changed.length > 0 && <ul className="h4l-delta" aria-label="每 1000 次抽奖大约的变化">
      {changed.map((tier) => {
        const delta = Math.round((next[text(tier.tier)] - numericValue(tier.prob)) * 10 * 10000) / 10000;
        const unit = wheelUnit(tier);
        const money = boolValue(tier.real) ? Math.round(delta * numericValue(tier.amount) * 10000) / 10000 : null;
        return <li key={text(tier.tier)}>
          <span className="h4l-delta-name">{text(tier.tier)}</span>
          <span data-tone={delta > 0 ? "up" : undefined}>{delta > 0 ? "多出" : "少出"} <b className="h4-num">{percentText(Math.abs(delta))}</b> 次</span>
          <span className="h4-dim">{money === null ? (unit ? `每次 ${amountText(text(tier.amount, ""))} ${unit}` : "代金券每次 1 张") : `真钱约 ${delta > 0 ? "多" : "少"} ${amountText(String(Math.abs(money)))} USDT`}</span>
        </li>;
      })}
      <li className="h4l-delta-note">每 1000 次抽奖按概率估算，不计库存用完和改发安慰奖</li>
    </ul>}
  </div>;
}

export function GuardCard({ title, icon, value, valueTone, sub, explain, action, children }: { title: string; icon: ReactNode; value: ReactNode; valueTone?: "ok" | "danger" | "neutral"; sub?: ReactNode; explain: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return <section className="h4l-guard" aria-label={title}>
    <header><span className="h4-block-label">{icon}{title}<Explain label={`${title}是什么`} content={explain} /></span>{action}</header>
    <div className="h4l-guard-value" data-tone={valueTone}>{value}</div>
    {sub && <div className="h4l-guard-sub">{sub}</div>}
    {children}
  </section>;
}
