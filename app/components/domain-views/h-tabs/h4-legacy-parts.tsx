"use client";

/**
 * H4「既有活动与转盘」页签的展示件：既有活动卡、App 上的样子、转盘概率条、奖档表、护栏卡、确认框里的概率对比。
 * 只排版：数据由页面按后端读模型传进来，不发请求、不判权限、不改请求内容。
 */
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { CalendarRange, CircleAlert, Clock3, EyeOff, Flag, Gift, Hourglass, CircleHelp, Languages, Smartphone, Star, Users } from "lucide-react";
import { Button, Explain, Fact, Facts, MoreMenu, Notice, SegmentBar, Segments, StatusTag, type MoreMenuItem } from "@/app/components/rd";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { EVENT_KIND_LABELS } from "@/lib/admin/event-rule-form";
import type { H4EventCapabilities } from "@/lib/admin/h-client";
import { EVENT_CONTENT_LOCALES, type EventCopyReadiness } from "@/lib/admin/event-rule-form";
import { englishCopyHint, isEnglishCopy } from "@/lib/admin/content-language-rules";
import { amountText, formatTime } from "./h4-promotion-ui";
import { ConfirmReadConflict } from "@/lib/admin/h-conflict-review";
import { displayAdminReadError } from "@/lib/admin/error-messages";
import { RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";

export const H4_MISSING_ORIGINAL = "最新列表里已没有这个对象，你填的内容没有提交。";
export const H4_OLD_RECORD_REJECTED = "原来的修改没有保存，记录太旧无法逐项对比，请按最新配置重新修改。";
export const h4ReadConflict = (readLatest: () => Promise<boolean | void>) =>
  new ConfirmReadConflict({ readLatest, renderNotice: action => <H4StaleNote readLatest={action} /> });
export const h4OpeningReadFailure = (cause: unknown, readLatest: () => Promise<boolean | void>) =>
  new ConfirmReadConflict({ preserveReason: true, readLatest,
    renderNotice: retry => <Notice tone="danger" title="开启前所需数据加载失败"
      action={<Button size="sm" onClick={retry}>重试</Button>}>{displayAdminReadError(cause)}</Notice> });

/** 真实冲突（别人先改过）后的提示：拟改值留着、现在值换成最新的、旧理由清空，要重新填理由才能提交。结果未知的原请求恢复用原理由，是另一句提示。 */
export function H4StaleNote({ readLatest }: { readLatest?: () => void }) {
  return <Notice tone="warn" title="别人先改过，这次没有保存"
    action={readLatest && <Button size="sm" onClick={readLatest}>读取最新</Button>}>
    {readLatest ? <>读取最新值后再核对；<span className="rd-keep">你填的还在，理由要重填。</span></>
      : <>现在值已换成最新的；<span className="rd-keep">你填的内容还在，请重新填写操作理由。</span></>}
  </Notice>;
}

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
/**
 * 既有活动奖励名给运营看时：按名字显示，只把名字里完整的金额词元（数字可带千分位，空格可有可无，币种 USDT、UVT、USD、VND、₫ 且是完整的词、大小写都认，
 * 后面不紧跟「/币种」）的小数末尾 0 去掉；不舍入、不改正负号、不改大小写、不加千分位，带指数的和认不出的原样写。
 * 名字原文照旧用于比较、预览和提交（OP-39）。旧回包缺少实额字段时沿用名称。App 显示的文字和奖项名不走这里。
 */
const NAME_AMOUNT = /(?<![\w.,])([+-]?(?:\d{1,3}(?:,\d{3})+|\d+))\.(\d+)(?![\d.eE])(?=[ \u00a0]?(?:USDT|UVT|USD|VND|₫)(?![\w])(?!\/[A-Za-z₫]))/gi;
export function legacyRewardText(value: unknown): string {
  return legacyName(value).text.replace(NAME_AMOUNT, (_, whole: string, fraction: string) => {
    const kept = fraction.replace(/0+$/, "");
    return kept ? `${whole}.${kept}` : whole;
  });
}
export function actualRewardText(amount: unknown, asset: unknown): string {
  return typeof amount === "string" && /^\d+(?:\.\d+)?$/.test(amount) && (asset === "UVT" || asset === "USDT")
    ? `${amountText(amount)} ${asset}` : "—";
}
export function LegacyNameTag({ where }: { where: string }) {
  return <StatusTag tone="warn" icon={CircleAlert} explain={`系统存的${where}还写着 NEX（产品已改名 UVT），这里按真实类型写成 UVT；App 显示的也是存的名称（只做品牌替换）。改${where}时写成 UVT。`}>旧名称</StatusTag>;
}

// ===== 统一叫法 =====
/** 七类玩法全页只用一套叫法（V09）：取玩法区的叫法。 */
export const KIND_LABEL = (kind: unknown) => EVENT_KIND_LABELS[text(kind, "").toLowerCase()] ?? "其他活动";
export const KIND_OPTIONS = ["discount", "referral", "regional", "boost", "seasonal", "onboarding"];

export const WHEEL_KIND_LABEL: Record<string, string> = { uvt: "UVT", usdt: "USDT", coupon: "代金券", nex: "UVT（旧奖型 nex）", points: "积分（已退役）" };
export const wheelUnit = (tier: Record<string, unknown>) => ({ uvt: "UVT", nex: "UVT", usdt: "USDT", points: "积分" } as Record<string, string>)[text(tier.kind, "").toLowerCase()];

export type LegacyEvent = H4EventCapabilities & {
  id: string;
  name: string;
  kind?: string;
  state: "upcoming" | "ongoing" | "ended";
  deleteState?: "draft" | "upcoming" | "ongoing" | "ended";
  deleteVersion?: string;
  deletable?: boolean;
  reward?: string;
  rewardType?: "UVT" | "USDT" | null;
  rewardAmount?: string | null;
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
export function lifecycleOf(event: LegacyEvent, requiredLanguages: readonly LocaleCode[] = EVENT_CONTENT_LOCALES) {
  const lifecycle = event.deleteState || event.state;
  if (lifecycle === "draft") return { key: "draft", label: "草稿", tone: "neutral" as const, explain: `还没开放过的活动。开放前要填齐${languageNames(requiredLanguages)}的${contentFieldsText(event.appUsesAuthoredRewardName)}。` };
  if (lifecycle === "upcoming") return { key: "upcoming", label: "预告", tone: "neutral" as const, explain: "已登记、还没开放：App 上用户还参加不了。" };
  if (lifecycle === "ongoing") return { key: "ongoing", label: "进行中", tone: "ok" as const, explain: "已对用户开放。结束后不能再开。" };
  if (lifecycle === "ended") return { key: "ended", label: "已结束", tone: "done" as const, explain: "已结束：不能再开放，这页也不再提供改奖励；已有的参与、奖励和操作记录保留。" };
  return { key: "unknown", label: "状态未知", tone: "warn" as const, explain: "系统给的状态这页不认识，请联系值班人员核对。" };
}

export function unknownTag(kind: "approval" | "direct") {
  return <StatusTag tone="warn" icon={CircleHelp} explain={kind === "approval"
    ? "没收到确定结果，审批单可能已经建成。先查询原结果，查不到再按原请求重试，不会建第二张单。"
    : "没收到确定结果，可能已经生效。先查询原结果，明确查不到后才能按原请求重试。"}>结果未知</StatusTag>;
}
export function pendingTag(object: string) {
  return <StatusTag tone="warn" icon={Clock3} explain={`等另一位超级管理员在「操作记录与审批」批准。批准、驳回或撤回之前，${object}不能再改，调低和关闭也不行。`}>待审批</StatusTag>;
}
export function expiredTag() {
  return <StatusTag tone="neutral" icon={Hourglass} explain={RETRY_EXPIRED_TEXT}>已过期</StatusTag>;
}

/** 走审批的修改在框里常显怎么生效：哪个方向要批、谁来批、批准前什么不变。 */
/** 一行写清哪个方向要批准、谁来批；放进确认框的 Facts 里。 */
export function ApprovalFact({ amplify, object }: { amplify: string; object: string }) {
  return <Fact k="审批">{amplify}<span className="rd-keep">要另一位超级管理员批准，</span><span className="rd-keep">批准前{object}不变</span></Fact>;
}
export const effectDirect = <StatusTag tone="progress" filled>立即生效</StatusTag>;
export const effectByDirection = (amplify = "让平台多付钱的修改") => <><StatusTag tone="progress" filled>调低立即生效</StatusTag><StatusTag tone="neutral" explain={`${amplify}要另一位超级管理员（需有审批批准权限）批准，批准前什么都不变；其余确认后立即生效。提交时由系统判断方向。`}>调高要批准</StatusTag></>;
export const effectApproval = (note: string) => <StatusTag tone="progress" filled explain={`另一位超级管理员（需有审批批准权限）批准后才执行，批准前${note}不变。`}>批准后生效</StatusTag>;

// ===== 既有活动卡 =====
export type LocaleCode = "zh" | "en" | "vi";
/** 后台能维护的活动语言，英文在前。必填的是其中 EVENT_CONTENT_LOCALES 那几种。 */
export const LOCALES: LocaleCode[] = ["en", "zh", "vi"];
export const LOCALE_NAME: Record<LocaleCode, string> = { zh: "中文", en: "英文", vi: "越南语" };
export const FIELD_NAME: Record<"name" | "description" | "rewardName", string> = { name: "名称", description: "说明", rewardName: "奖项名" };
type ContentField = "name" | "description" | "rewardName";
const FIELDS: ContentField[] = ["name", "description", "rewardName"];
export const languageNames = (languages: readonly LocaleCode[]) => LOCALES.filter(code => languages.includes(code)).map(code => LOCALE_NAME[code]).join("、");
/** 开放前要填的几项：App 不用运营奖项名的活动（后端 appUsesAuthoredRewardName=false）不含奖项名；没有这项事实的旧数据照旧三项。 */
export const contentFieldsText = (authored?: boolean) => authored === false ? "名称、说明" : "名称、说明、奖项名";

/** 每种语言每一项没填的格（不只必填语言，选填语言没填也列出来，只是轻重不同）。 */
export function contentGaps(content?: Record<string, Record<string, unknown>>) {
  return LOCALES.flatMap(locale => FIELDS.filter(field => {
    const value = content?.[locale]?.[field];
    return typeof value !== "string" || !value.trim();
  }).map(field => ({ locale, field })));
}

/**
 * 一格没填有多要紧（卡片、待处理、文字抽屉共用一个口径）：
 * 开放前、首次开启玩法前，必填语言的格必须填（must）；
 * 有玩法规则的活动，奖项名一行 App 用规则摘要（不提示）；
 * 已开放的活动不追补：英文以外的必填语言没填要补（用户正看着英文或原文），其余只轻提示（soft）。
 */
export function gapWeight(gap: { locale: LocaleCode; field: ContentField }, requiresAll: boolean, rewardFromRule: boolean, requiredLanguages: readonly LocaleCode[]): "must" | "soft" | null {
  if (requiresAll && requiredLanguages.includes(gap.locale)) return "must";
  if (gap.field === "rewardName" && rewardFromRule) return null;
  return !requiresAll && requiredLanguages.includes(gap.locale) && gap.locale !== "en" ? "must" : "soft";
}

export function EventCard({ event, zh, en, gaps, softGaps, rewardFromRule, requiredLanguages, rule, pending, primary, menu, onContent }: {
  event: LegacyEvent;
  requiredLanguages: readonly LocaleCode[];
  zh: { name: string; description: string; rewardName: string };
  /** 中文没填时卡片显示英文那一份（带「英文」标记）。 */
  en: { name: string; description: string; rewardName: string };
  /** 必须补的有几项。 */
  gaps: number;
  /** 只需轻提示的没填的格：哪些语言。 */
  softGaps: LocaleCode[];
  /** 有玩法规则的非转盘活动：每种语言填了奖项名显示它，没填显示规则摘要。 */
  rewardFromRule: boolean;
  rule?: { enabled: boolean; ready: boolean; startsAt: string | null; endsAt: string | null } | null;
  pending?: ReactNode;
  primary?: ReactNode;
  menu: MoreMenuItem[];
  onContent: () => void;
}) {
  const life = lifecycleOf(event, requiredLanguages);
  const wheel = text(event.kind, "").toLowerCase() === "wheel";
  const hasRewardProjection = event.rewardType !== undefined || event.rewardAmount !== undefined;
  const legacyReward = !hasRewardProjection && legacyName(event.reward).legacy;
  // 上一行实际显示的奖励；「App 显示同上」按这一行和 App 原文是否完全一样判断（F04）。
  const shownReward = hasRewardProjection ? actualRewardText(event.rewardAmount, event.rewardType) : legacyRewardText(event.reward);
  // 卡片先显示中文；中文没填用英文那一份并标出来；名称、说明中英文都没填时显示原文（App 中文也显示它）并标出来；都没有才写「未配置」。
  const originals = { name: text(event.name, ""), description: text(event.description, "") };
  const pick = (field: ContentField) => zh[field] ? { text: zh[field], en: false, original: false } : en[field] ? { text: en[field], en: true, original: false }
    : field !== "rewardName" && originals[field] ? { text: originals[field], en: false, original: true } : null;
  // App 上的奖励文字有后端给的事实（appRewardNames）时原样照它写，不换旧名、不改格式；旧数据没有时照旧按填的奖项名推。
  const appReward = event.appRewardNames ? { text: event.appRewardNames.zh } : null;
  const name = pick("name"), description = pick("description"), rewardName = event.appUsesAuthoredRewardName === false ? null : pick("rewardName");
  // 一张卡只标一次，标在第一处用了英文的地方；原文也一样。
  const firstEn = ([["name", name], ["description", description], ["rewardName", rewardName]] as const).find(([, value]) => value?.en)?.[0];
  const enTag = (field: ContentField) => firstEn === field ? <> <StatusTag tone="neutral" icon={Languages} explain={field === "rewardName" && rewardFromRule && !appReward ? "中文没填，这里显示的是英文那一份；App 中文显示玩法规则摘要。" : field === "rewardName" && appReward ? "中文没填，App 中文显示英文那一份。" : "中文没填，这里显示的是英文那一份。"}>英文</StatusTag></> : null;
  const originalFields = ([["name", name], ["description", description]] as const).filter(([, value]) => value?.original).map(([field]) => field);
  const originalTag = <StatusTag tone="neutral" icon={Smartphone} explain={`${originalFields.map(field => FIELD_NAME[field]).join("和")}的中文、英文都没填，这里显示的是原文；活动在 App 上出现后，中文也显示原文。`}>原文</StatusTag>;
  return (
    <article className="h4-card h4l-event" aria-label={name?.text || event.id} data-dim={life.key === "ended" ? "" : undefined}>
      <header className="h4-card-head">
        <div className="h4-card-title">
          <h3 data-empty={name ? undefined : ""}>{name?.text ?? "名称未配置"}{enTag("name")}{originalFields[0] === "name" && <> {originalTag}</>}</h3>
          <span className="h4-card-meta"><span className="h4-card-kind">{KIND_LABEL(event.kind)}</span><span className="h4-mono" title={event.id}>{event.id}</span></span>
        </div>
        <span className="h4l-tags">
          {event.featured && <StatusTag tone="progress" icon={Star} explain="App 活动页把它放在主推位。同时只能有一个进行中的主推活动。">主推</StatusTag>}
          <StatusTag tone={life.tone} explain={life.explain}>{life.label}</StatusTag>
        </span>
      </header>
      <p className="h4l-desc" data-empty={description ? undefined : ""} data-user-content={description ? "" : undefined} data-clamp={description?.original ? "" : undefined} title={description?.original ? description.text : undefined}>
        {originalFields[0] === "description" && <>{originalTag} </>}{description?.text ?? "说明未配置"}{enTag("description")}</p>
      <dl className="h4l-facts">
        <div><dt><Gift size={14} aria-hidden />奖励</dt><dd>
          {wheel ? <span className="h4-dim">按转盘奖池</span> : <>{shownReward && shownReward !== "—" ? shownReward : <span className="h4-dim">—</span>}{legacyReward && <LegacyNameTag where="奖励文字" />}</>}
          <small>{appReward ? <>{!wheel && appReward.text === shownReward ? "App 显示同上" : `App 显示：${appReward.text || "—"}`}{enTag("rewardName")}</>
            : rewardFromRule && !rewardName ? "App 显示玩法规则摘要" : rewardName ? <>{rewardName.text !== shownReward ? `App 显示：${rewardName.text}` : "App 显示同上"}{enTag("rewardName")}</> : "奖项名未配置"}</small>
        </dd></div>
        {/* 后端的 condition 就是活动说明的原文（同一列），中文界面不再把原文另列成「参与条件」；说明在上面，原文在「App 上的文字」里。 */}
        <div><dt><Flag size={14} aria-hidden />地区</dt><dd>{event.geo ? <span className="h4l-clip" title={event.geo} data-user-content="">{event.geo}</span> : <span className="h4-dim">未设</span>}</dd></div>
        <div><dt><CalendarRange size={14} aria-hidden />时间</dt><dd>{!rule ? <span className="h4-dim">—</span>
          : rule.startsAt || rule.endsAt ? <><span className="h4-num">{formatTime(rule.startsAt, "Asia/Shanghai")}</span> → <span className="h4-num">{formatTime(rule.endsAt, "Asia/Shanghai")}</span><small>北京时间 · 玩法{rule.enabled ? "已开启" : rule.ready ? "已关闭，配置已就绪" : "已关闭，配置没就绪"}</small></>
          : <span className="h4-dim">未配置</span>}</dd></div>
        <div><dt><Users size={14} aria-hidden />参与</dt><dd>{event.trackable
          ? <span className="h4l-funnel"><span><b className="h4-num">{numericValue(event.joinCount)}</b> 参与</span><span aria-hidden>→</span><span><b className="h4-num">{numericValue(event.doneCount)}</b> 达标</span><span aria-hidden>→</span><span><b className="h4-num">{numericValue(event.claimCount)}</b> 已领</span></span>
          : <span className="h4-dim">不统计效果</span>}</dd></div>
      </dl>
      <footer className="h4-card-foot">
        <button type="button" className="h4-unresolved" data-tone={gaps > 0 ? "warn" : undefined} onClick={onContent}>
          {gaps > 0 ? <><CircleAlert size={14} aria-hidden /><b className="h4-num">{gaps}</b> 项翻译没填</> : softGaps.includes("en") ? <><Smartphone size={14} aria-hidden />英文没填，App 显示原文</>
            : softGaps.length > 0 ? <><Smartphone size={14} aria-hidden />{LOCALES.filter(code => softGaps.includes(code)).map(code => LOCALE_NAME[code]).join("、")}没填，App 显示英文</>
            : <><Smartphone size={14} aria-hidden />App 上的文字</>}
        </button>
        <span className="h4-card-actions">{pending}{primary}<MoreMenu label={`${name?.text || event.id} 的更多操作`} items={menu} /></span>
      </footer>
    </article>
  );
}

export function EventPreview({ names, original, onEdit, canEdit, requiresAll, opened, rewardFromRule, authored, appNames, copyReadiness, requiredLanguages, lockedReason }: {
  copyReadiness?: EventCopyReadiness;
  requiredLanguages: readonly LocaleCode[];
  names: Record<LocaleCode, Record<"name" | "description" | "rewardName", string>>;
  original: Record<"name" | "description" | "rewardName", string>;
  onEdit: (field: "name" | "description" | "rewardName", locale: LocaleCode) => () => void;
  canEdit: boolean;
  /** 还没开放，或玩法还能首次开启：必填语言都要填。 */
  requiresAll: boolean;
  /** 活动已开放过（不是预告）。 */
  opened: boolean;
  /** 有玩法规则的非转盘活动：每种语言填了奖项名显示它，没填显示规则摘要（只用于没有下面两项事实的旧数据）。 */
  rewardFromRule: boolean;
  /** 后端事实：App 用不用这里填的奖项名。false 时奖项名不显示、不必填；没有时照旧。 */
  authored?: boolean;
  /** 后端事实：每种语言用户实际看到的奖励文字，原样显示。 */
  appNames?: Record<LocaleCode, string>;
  /** 活动被审批锁住时的原因：入口照常显示，灰着并写原因，和活动卡上的其他入口一样。 */
  lockedReason?: string;
}) {
  const [locale, setLocale] = useState<LocaleCode>("en");
  // App 不用运营奖项名的活动，奖项名没填不算缺（和卡片上的缺项数同一口径）。
  const gaps = contentGaps(names).filter(gap => gap.field !== "rewardName" || authored !== false);
  const legacyRule = rewardFromRule && authored === undefined;
  const hiddenReward = authored === false;
  const weightOf = (code: LocaleCode, field: ContentField) => {
    const path = `localized.${code}.${field}`;
    if (copyReadiness?.missing.includes(path) || copyReadiness?.incomplete.includes(path)) return "must";
    const gap = gaps.find(row => row.locale === code && row.field === field);
    if (!gap) return null;
    return copyReadiness ? "soft" : gapWeight(gap, requiresAll, legacyRule, requiredLanguages);
  };
  const marks = (code: LocaleCode) => FIELDS.map(field => weightOf(code, field));
  const optionalText = languageNames(LOCALES.filter(code => !requiredLanguages.includes(code)));
  const englishHint = locale !== "en" && requiredLanguages.includes(locale) && isEnglishCopy(names.en, names[locale])
    ? englishCopyHint(locale) : undefined;
  const shown = (field: "name" | "description" | "rewardName") => names[locale][field] || names.en[field] || original[field];
  // 有玩法规则的活动：这种语言填了奖项名就显示它，没填显示规则摘要（不借用英文）。只用于没有后端奖励文字的旧数据。
  const ruleReward = legacyRule && !names[locale].rewardName;
  const fallback = (["name", "description", "rewardName"] as const).some((field) => !names[locale][field] && !(field === "rewardName" && (legacyRule || hiddenReward)));
  const appReward = appNames ? { text: appNames[locale] } : null;
  return (
    <div className="h4-dialog-body h4l-content">
      <Segments label="内容语言" value={locale} onChange={setLocale} items={LOCALES.map((code) => ({
        value: code,
        label: marks(code).includes("must") ? `${LOCALE_NAME[code]} · 缺失` : marks(code).includes("soft") ? `${LOCALE_NAME[code]} · 没填` : LOCALE_NAME[code],
        tone: marks(code).includes("must") ? "warn" as const : undefined,
      }))} />
      <ul className="h4l-locale-rows" aria-label={`${LOCALE_NAME[locale]}内容`}>
        {(["name", "description", "rewardName"] as const).map((field) => {
          const value = names[locale][field];
          const old = legacyName(value);
          const hidden = field === "rewardName" && hiddenReward;
          const blank = hidden ? !value : gaps.some(gap => gap.locale === locale && gap.field === field);
          const weight = weightOf(locale, field);
          const blankText = hidden ? "没填，不用填"
            : requiresAll && weight === "must" ? (opened ? "未填写，开启玩法前必须补齐" : "未填写，开放前必须补齐")
            : weight === null ? "未填写，App 显示玩法规则摘要"
            : locale !== "en" && names.en[field] ? "未填写，App 显示英文"
            : original[field] ? `未填写，App 显示原文：${original[field]}` : "未填写，App 上是空的";
          return <li key={field}>
            <span className="h4l-locale-key">{FIELD_NAME[field]}</span>
            <span className="h4l-locale-value" data-empty={!blank ? undefined : weight === "must" ? "" : "soft"}>{!blank ? old.text : blankText}{old.legacy && <LegacyNameTag where={`${LOCALE_NAME[locale]}${FIELD_NAME[field]}`} />}
              {hidden && <StatusTag tone="neutral" icon={EyeOff} explain={`App 的奖励一行显示系统按实际发放写的文字${appReward ? `（${LOCALE_NAME[locale]}：${appReward.text || "—"}）` : ""}，这一格填了也不显示，开放和开启玩法都不要求填。`}>App 不显示</StatusTag>}</span>
            {canEdit && (lockedReason
              ? <Button size="sm" variant="ghost" className="h4l-locale-edit" aria-label={`${value ? "编辑" : "填写"} ${LOCALE_NAME[locale]}${FIELD_NAME[field]}`} disabledReason={lockedReason}>{value ? "编辑" : "填写"}</Button>
              : <button type="button" className="rd-link" aria-label={`${value ? "编辑" : "填写"} ${LOCALE_NAME[locale]}${FIELD_NAME[field]}`} onClick={onEdit(field, locale)}>{value ? "编辑" : "填写"}</button>)}
          </li>;
        })}
      </ul>
      <aside className="h4l-preview" aria-label="App 上的样子">
        <span className="h4l-preview-title"><Smartphone size={14} aria-hidden />App 上的样子
          <Explain label="这个预览怎么来的" content={<><p>按现在保存的{LOCALE_NAME[locale]}内容示意活动卡上的文字，不是 App 截图{appReward ? "；奖励一行是 App 实际显示的文字" : ""}。</p>
            <p>{englishHint ?? (requiresAll ? `${languageNames(requiredLanguages)}的${contentFieldsText(authored)}填齐，才能开放活动、开启玩法。${optionalText ? `${optionalText}可以不填，没填时 App 显示英文。` : ""}` : "已开放的活动照常进行：没填的格 App 先用英文，再用原文，不自动翻译。")}</p>
            {legacyRule && <p>有玩法规则的活动，每种语言填了奖项名就显示它，没填显示系统按规则写的摘要，不借用英文。</p>}
            {hiddenReward && <p>奖励一行由系统按实际发放写，不用这里填的奖项名。</p>}
            {authored === true && <p>奖励一行显示这里填的奖项名；这种语言没填时先用英文，再用原文。</p>}</>} />
        </span>
        <div className="h4l-phone">
          <div className="h4l-phone-card">
            <b>{legacyName(shown("name")).text || "—"}</b>
            <span className="h4l-phone-desc">{legacyName(shown("description")).text || "—"}</span>
            <span className="h4l-phone-reward"><Gift size={13} aria-hidden />{appReward ? appReward.text || "—" : ruleReward ? <span className="h4-dim">玩法规则摘要</span> : legacyName(shown("rewardName")).text || "—"}</span>
            <span className="h4l-phone-go">去参加 ›</span>
          </div>
        </div>
        {fallback && <p className="h4l-preview-note">有内容没填{LOCALE_NAME[locale]}，这里按 App 的回退显示</p>}
        {legacyRule && names[locale].rewardName && <p className="h4l-preview-note" data-tone="warn">发奖按玩法规则，奖项名里写数额要和规则一致</p>}
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
    <li><span data-slot="other" />旧奖型</li>
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
    <div className="h4l-compare-row"><span className="h4l-compare-key">现在</span><WheelBar tiers={tiers} label="现在的概率" /><span className="h4l-compare-total"><Explain label="颜色表示什么" content="金色发真钱（USDT），青色代金券，紫色 UVT，灰色是旧奖型；橙色是还差的概率。" /></span></div>
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
