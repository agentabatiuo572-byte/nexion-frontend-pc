"use client";

/**
 * I4 信任中心的画面件：版块卡、字段清单、两版对照、草稿编辑区、结果未知提醒的位置。
 * 只负责排版和由已读到的数据推出来的显示（App 能不能打开、哪些字 App 公开时清空），不发请求、不改判断。
 * App 规则的出处：后端 OpsTrustDisclosureService.publishedSections（只给已公开的版块，每块当前版要完整）和
 * App src/api/trust-section-api.ts（接受 0–6 块，每块最多 80 个字段）。这里只是提示，App 实际读取以后端为准。
 */
import { englishCopyHint, isEnglishCopy } from "@/lib/admin/content-language-rules";
import { localizedTrustSectionField, mapTrustSectionLanguageFields } from "@/lib/admin/trust-section-validation";
import type { OperatingLanguageCode } from "@/lib/admin/platform-experience-client";
import { useState, type ReactNode } from "react";
import { BadgeCheck, CircleHelp, Coins, FileSearch, Landmark, ShieldCheck, Store, Users, type LucideIcon } from "lucide-react";
import { Button, Explain, Field, IconTile, Input, LocaleTabs, Notice, StatusTag, Textarea, type StateTone } from "@/app/components/rd";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { DIRECT_RECOVERY_INTRO } from "../direct-recovery-copy";
import { APP_FIELD_LIMIT, i4AppFieldIssue, i4HasEnglishFields } from "@/lib/admin/i4-trust-contract";
export { APP_FIELD_LIMIT, APP_SECTION_ORDER, appBlanking } from "@/lib/admin/i4-trust-contract";

import type { TrustPublishedSnapshotView, TrustSectionVersionView } from "@/lib/admin/i-client";

export type TrustField = { key: string; label: string; value: string };
export type Lang = "zh" | "vi" | "en";
export const LANGS: readonly { value: Lang; label: string }[] = [
  { value: "zh", label: "中文" },
  { value: "vi", label: "越南语" },
  { value: "en", label: "英语" },
];

export const SECTION_INFO: Record<string, { name: string; where: string; icon: LucideIcon }> = {
  financials: { name: "财务数字", where: "App 页面不读这块，平台数据另有来源", icon: Coins },
  leadership: { name: "管理团队", where: "信任中心「管理团队」，只列带有效链接的人", icon: Users },
  nexNarrative: { name: "UVT 介绍", where: "UVT 介绍页，和信任中心的托管、保修、账户安全说明", icon: Landmark },
  complianceBadges: { name: "合规徽章", where: "App 页面不读这块；公开时版本不完整会让整页读不出来", icon: BadgeCheck },
  auditsReserves: { name: "审计与储备", where: "信任中心「审计」和商品详情，有报告才出现", icon: FileSearch },
  listings: { name: "上市信息", where: "App 页面不读这块；公开时版本不完整会让整页读不出来", icon: Store },
};
/** 卡片上预览哪几个字段：挑信任中心真正显示的那几项，挑不到就取前两项。 */
export const PREVIEW_KEYS: Record<string, readonly string[]> = {
  leadership: ["leader1Name", "leader1Role"],
  nexNarrative: ["hostingContent", "securityContent"],
  auditsReserves: ["document1Primary", "document1Secondary"],
  complianceBadges: ["badge1Label", "badge1Body"],
  listings: ["listing1Exchange", "listing1State"],
};
export function previewFields(sectionKey: string, fields: readonly TrustField[]): TrustField[] {
  const zh = fieldsFor(fields, "zh").filter((field) => field.value.trim() && !/(url|href)$/i.test(field.key));
  const base = (key: string) => key.trim().replace(LOCALIZED, "$1");
  const wanted = (PREVIEW_KEYS[sectionKey] ?? []).map((key) => zh.find((field) => base(field.key) === key)).filter(Boolean) as TrustField[];
  return (wanted.length ? wanted : zh).slice(0, 2);
}
/** 这一块没公开（下架或没发布）时 App 上少了什么：App test@0306001c trust.vue、nex.vue、store/detail.vue（H5 Lite 同）。 */
export const UNPUBLISHED_EFFECT: Record<string, string> = {
  financials: "App 不读这一块，App 上没有变化",
  leadership: "信任中心的「管理团队」整块收起",
  nexNarrative: "信任中心「服务保障」里托管、保修、账户安全三行和「规则与资料」里的「UVT 使用说明」入口收起；直接打开 UVT 说明页显示「暂无 UVT 说明」",
  complianceBadges: "App 不读这一块，App 上没有变化",
  auditsReserves: "商品详情资料区显示「暂无相关资料」，信任中心「服务保障」的「审计与储备证明」一行收起",
  listings: "App 不读这一块，App 上没有变化",
};
export const unpublishedEffect = (key: string) => UNPUBLISHED_EFFECT[key] ?? "App 上这一块收起";
export const sectionName = (key: string, fallback?: string) => SECTION_INFO[key]?.name ?? fallback ?? key;

const LOCALIZED = /^(.+?)[._-](zh|vi|en)$/i;
export const fieldLang = (key: string): Lang | null => (key.trim().match(LOCALIZED)?.[2]?.toLowerCase() as Lang | undefined) ?? null;
/** 这种语言要看的字段：不分语言的字段加这种语言的字段。 */
export const fieldsFor = <T extends { key: string }>(fields: readonly T[], lang: Lang) => fields.filter((field) => {
  const own = fieldLang(field.key);
  return own === null || own === lang;
});
/** 这种语言有没有空着的字段（页签上写「缺失」）。 */
export const langMissing = (fields: readonly TrustField[], lang: Lang) => {
  const own = fields.filter((field) => fieldLang(field.key) === lang);
  const families = new Set(fields.filter((field) => fieldLang(field.key)).map((field) => field.key.trim().replace(LOCALIZED, "$1").toLowerCase()));
  return families.size > 0 && (own.length < families.size || own.some((field) => !field.value.trim()));
};
export const localeItems = (fields: readonly TrustField[]) => LANGS.map((item) => ({ ...item, missing: langMissing(fields, item.value) }));

/** 后端存的旧名称里还有 NEX 的，写成 UVT，并标出是旧名称。 */
export function legacyName(text: string): { text: string; legacy: boolean } {
  return /NEX/.test(text) ? { text: text.replace(/NEX/g, "UVT"), legacy: true } : { text, legacy: false };
}
export function LegacyText({ text }: { text: string }) {
  const name = legacyName(text);
  return <>{name.text}{name.legacy && <> <StatusTag tone="neutral" explain={`后台存的是旧名称：${text}`}>旧名称</StatusTag></>}</>;
}

export const timeText = (value?: string | null) => value ? formatBusinessTimeCompact(value, "—") : "—";
export const operatorText = (value?: string) => !value ? "—" : value.startsWith("migration") ? "系统迁移" : value;
export const isPublished = (status: string) => status.toLowerCase() === "published";
export const isArchivedStatus = (status: string) => status.toLowerCase() === "archived" || status.toLowerCase().includes("archived");

/** 和另一版比改了哪些字段（按字段标识对；名称或内容变了都算）。 */
export function changedKeys(base: readonly TrustField[], next: readonly TrustField[]): Set<string> {
  const before = new Map(base.map((field) => [field.key, field]));
  const keys = new Set<string>();
  for (const field of next) {
    const old = before.get(field.key);
    if (!old || old.label !== field.label || old.value !== field.value) keys.add(field.key);
  }
  for (const field of base) if (!next.some((item) => item.key === field.key)) keys.add(field.key);
  return keys;
}

export const TRUST_MISSING_ENGLISH = "缺英文";

/** 一个版本过不过得了 App 公开的检查（不含后端的安全文本和链接细则）。返回问题，没问题是空数组。 */
export function versionProblems(version: { version: string; description: string; structure: string; fields: readonly TrustField[] } | undefined): string[] {
  if (!version) return ["读不到当前版本的内容"];
  const problems: string[] = [];
  if (!/^v[1-9][0-9]{0,8}$/.test(version.version)) problems.push("版本号不符合 App 规则");
  if (!version.description.trim() || !version.structure.trim()) problems.push("说明或结构是空的");
  if (version.fields.length === 0) problems.push("没有内容");
  else if (!i4HasEnglishFields(version.fields)) problems.push(TRUST_MISSING_ENGLISH);
  const fieldIssue = i4AppFieldIssue(version.fields);
  if (fieldIssue && version.fields.length) problems.push(fieldIssue);
  return problems;
}

// ---------- App 实际公开的状态（published-snapshot） ----------
/** 原因码译成运营的话；原码只放技术信息。 */
export function snapshotReasonText(code: string | null, sectionKey = ""): string {
  switch (code) {
    case "UNSUPPORTED_SECTION_CLAIM": return ["leadership", "auditsReserves"].includes(sectionKey) ? "这一版是系统迁移写入的，正式环境不公开" : "正式环境不公开运营写的财务、徽章和上市文字";
    case "AUDIT_DOCUMENT_URL_MISSING": return "报告地址没填或不是有效链接，整块文字不公开";
    case "AUDIT_HOMEPAGE_PROOF": return "首页证明一律不对外";
    case "AI_CLIENT_COUNT_UNSUPPORTED": return "没有真实统计";
    case "SUBHERO_CLAIM_UNSUPPORTED": return "宣传语没有依据";
    case "SUBHERO_ADDITIONAL_LANGUAGE_UNSUPPORTED": return "跟英文宣传语一起不公开";
    case "TRUST_SECTION_PUBLISHED_SNAPSHOT_INVALID": return "有公开的版块当前版不完整";
    case "TRUST_SECTION_SANDBOX_RUN_ID_REQUIRED": return "测试环境没配运行号";
    default: return "其他原因";
  }
}
const WHOLE_SECTION_REASONS = new Set(["UNSUPPORTED_SECTION_CLAIM", "AUDIT_DOCUMENT_URL_MISSING"]);
export type SnapshotState = { view?: TrustPublishedSnapshotView; loading: boolean; error?: string };
export type FieldBlanking = { all?: string; keys: Set<string>; reasons?: Map<string, string>; actual?: boolean };
/** 一个版块在 App 上实际被扣下的部分；没读到快照或测试环境时返回 undefined，由调用方按后台版本推断。 */
export function snapshotBlanking(view: TrustPublishedSnapshotView | undefined, sectionKey: string): FieldBlanking | undefined {
  if (!view || view.sourceEnvironment === "SANDBOX" && view.available) return undefined;
  if (!view.available) return { all: `App 信任中心整页打不开：${snapshotReasonText(view.reason)}。`, keys: new Set(), actual: true };
  const section = view.sections.find((row) => row.sectionKey === sectionKey);
  if (!section) return undefined;
  const whole = section.fields.find((field) => field.reason && WHOLE_SECTION_REASONS.has(field.reason));
  const reasons = new Map(section.fields.filter((field) => field.reason).map((field) => [field.key, snapshotReasonText(field.reason, sectionKey)]));
  // 整块没公开时和推断写法一致：keys 留空，卡片照常灰显后台存的内容。
  if (whole) return { all: `${snapshotReasonText(whole.reason, sectionKey)}。`, keys: new Set(), actual: true };
  return { keys: new Set(reasons.keys()), reasons, actual: true };
}
/** 结论下面一行：App 此刻实际给出的是不是完整的、什么时候取的样。 */
export function SnapshotLine({ state, clearedCount, versionDiff, onRetry }: { state: SnapshotState; clearedCount: number; versionDiff: number; onRetry: () => void }) {
  const { view } = state;
  const sampled = view ? <span className="i4-actual-time">取样 <span data-num="">{timeText(view.sampledAt)}</span>（{businessZone().label}）</span> : null;
  const explain = <Explain label="App 实际公开怎么来的" content={<><p>取自 App 此刻对外给出的内容，在换成各语言文字之前；每种语言最终显示的文字以 App 为准。</p><p>打开这页、点刷新、有版块换版时重新取样。</p></>} />;
  if (!view) return <div className="i4-actual" role="status">
    {state.error ? <><StatusTag tone="warn">没读到</StatusTag><span>App 实际公开的内容没读到，卡上先按后台版本推断</span>{explain}<Button size="sm" onClick={onRetry}>重试</Button></>
      : <><StatusTag tone="neutral">读取中</StatusTag><span>正在读取 App 实际公开的内容…</span></>}
  </div>;
  if (!view.available) return <div className="i4-actual" role="status"><StatusTag tone="danger">整页打不开</StatusTag><span>App 实际：信任中心整页打不开，{snapshotReasonText(view.reason)}</span>{sampled}{explain}</div>;
  if (view.sourceEnvironment === "SANDBOX") return <div className="i4-actual" role="status"><StatusTag tone="neutral">测试环境</StatusTag><span>App 给的是演示内容，不是后台的版本</span>{sampled}{explain}</div>;
  // 整块没公开的个数已在结论里，这里只补结论没说的：零散被清空的项、版本对不上的块。
  const parts = [clearedCount > 0 && `另有 ${clearedCount} 项被清空`, versionDiff > 0 && `${versionDiff} 块 App 给的不是后台当前版`].filter(Boolean);
  return <div className="i4-actual" role="status">
    <StatusTag tone={versionDiff > 0 ? "warn" : "ok"}>{versionDiff > 0 ? "版本对不上" : "已核对"}</StatusTag>
    <span>{["已和 App 实际公开的核对", ...parts].join("；")}</span>{sampled}{explain}
  </div>;
}

export type SectionCardModel = {
  key: string;
  index: number;
  name: string;
  status: { text: string; tone: StateTone };
  version: string;
  updatedAt?: string;
  /** 当前版本最后保存的人（系统迁移写「系统迁移」）。 */
  operator?: string;
  preview: TrustField[];
  blankedAll?: string;
  /** 内容块的标题：App 里 / 后台存的内容（公开时清空）/ 下架前的内容。 */
  appLabel: string;
  /** 用户看不到这块内容的原因；有值时标题旁标「App 不显示」。 */
  appHidden?: string;
  /** App 实际给出时的补充标记：被清空的项、版本对不上。 */
  appTags?: Array<{ text: string; explain: string }>;
  draft?: string;
  pending: boolean;
  problems: string[];
  lastChange: string;
  actions: ReactNode;
  onOpen: () => void;
  selected: boolean;
};

/** 一个版块一张卡：序号、名称、状态 → App 里的样子 → 草稿、待审批、问题 → 最近改动和动作。 */
export function SectionCard({ card }: { card: SectionCardModel }) {
  const info = SECTION_INFO[card.key];
  return (
    <article className="i4-card" data-selected={card.selected ? "" : undefined} data-problem={card.problems.length || card.status.tone === "danger" ? "" : undefined} aria-label={`${card.name}，${card.status.text}`}>
      <header className="i4-card-head">
        <span className="i4-card-no" aria-hidden>{card.index}</span>
        <IconTile tone="role-2" icon={info?.icon ?? ShieldCheck} size={28} />
        <div className="i4-card-title">
          <h3><button type="button" className="i4-card-open" onClick={card.onOpen}>{card.name}</button></h3>
          <span className="i4-card-meta">当前版本 {card.version || "—"}</span>
        </div>
        <StatusTag tone={card.status.tone}>{card.status.text}</StatusTag>
      </header>
      <div className="i4-app" data-blank={card.blankedAll ? "" : undefined}>
        <span className="i4-app-label">{card.appLabel}
          <Explain label={`${card.name}在 App 里的位置`} content={<><p>{info?.where ?? "App 里的位置待核实。"}</p>{card.appHidden && <p>{card.appHidden}</p>}</>} />
          {card.appHidden && <StatusTag tone="warn" explain={card.appHidden}>App 不显示</StatusTag>}
          {card.appTags?.map((tag) => <StatusTag key={tag.text} tone="warn" explain={tag.explain}>{tag.text}</StatusTag>)}
        </span>
        {card.preview.length
          ? <dl className="i4-app-lines" data-user-content="" data-blank={card.appHidden ? "" : undefined}>{card.preview.map((field) => <div key={field.key}><dt>{field.label}</dt><dd title={field.value}>{field.value || "—"}</dd></div>)}</dl>
          : <p className="i4-app-blank">没有可显示的内容</p>}
      </div>
      {(card.draft || card.pending || card.problems.length > 0) && <div className="i4-card-tags">
        {card.problems.length > 0 && <StatusTag tone="danger" explain={`${card.problems.join("；")}。App 信任中心整页打不开。`}>{card.problems[0]}</StatusTag>}
        {card.pending && <StatusTag tone="warn" explain="有申请等另一位管理员批准，批准或驳回前这一块不能改。批准前用户看到的不变。">等另一位批准</StatusTag>}
        {card.draft && <StatusTag tone="neutral" explain="草稿只在后台，用户看不到；提交发布并批准后才公开。">草稿 {card.draft} 待发布</StatusTag>}
      </div>}
      <footer className="i4-card-foot">
        <div className="i4-card-change">
          <span className="i4-card-who">{card.updatedAt ?? "—"} · {card.operator ?? "—"}</span>
          <span>最近改动：{card.lastChange ? <span data-user-content="">{card.lastChange}</span> : "—"}</span>
        </div>
        <span className="rd-row-actions">{card.actions}</span>
      </footer>
    </article>
  );
}

/** 一种语言下的字段清单：名称、内容；App 公开时清空的、和对照版不同的都标出来。 */
export function FieldList({ fields, lang, blanked, changed, label }: { fields: readonly TrustField[]; lang: Lang; blanked?: FieldBlanking; changed?: Set<string>; label: string }) {
  const shown = fieldsFor(fields, lang);
  if (!shown.length) return <p className="rd-note">这一版没有内容。</p>;
  return (
    <dl className="i4-fields" aria-label={label} data-user-content="">
      {shown.map((field) => (
        <div key={field.key} className="i4-field" data-changed={changed?.has(field.key) ? "" : undefined}>
          <dt>{field.label}{changed?.has(field.key) && <StatusTag tone="progress">已改</StatusTag>}</dt>
          <dd>
            {field.value ? <span>{field.value}</span> : <span className="rd-weak">—</span>}
            {!blanked?.all && blanked?.keys.has(field.key) && <span className="i4-field-note">{blanked.actual ? `App 没公开：${blanked.reasons?.get(field.key) ?? "其他原因"}` : "App 公开时清空"}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** 两版并排：左边现在公开的，右边批准后公开的。只列改了的字段，其余写一句。 */
export function VersionCompare({ beforeLabel, afterLabel, before, after, problems, afterBlanked }: {
  beforeLabel: string;
  afterLabel: string;
  before: readonly TrustField[];
  after: readonly TrustField[];
  problems?: string[];
  afterBlanked?: string;
}) {
  const [lang, setLang] = useState<Lang>("zh");
  const changed = changedKeys(before, after);
  const keys = [...new Set([...fieldsFor(after, lang), ...fieldsFor(before, lang)].map((field) => field.key))].filter((key) => changed.has(key));
  const unchanged = fieldsFor(after, lang).filter((field) => !changed.has(field.key)).length;
  const find = (list: readonly TrustField[], key: string) => list.find((field) => field.key === key);
  return (
    <div className="i4-compare rd-stack">
      <LocaleTabs label="对照语言" value={lang} onChange={setLang} items={localeItems(after)} />
      <div className="i4-compare-grid" role="table" aria-label="现在公开的和批准后公开的">
        <div className="i4-compare-row i4-compare-headrow" role="row">
          <span role="columnheader">内容项</span>
          <span role="columnheader">{beforeLabel}</span>
          <span role="columnheader">{afterLabel}</span>
        </div>
        {keys.map((key) => {
          const old = find(before, key);
          const next = find(after, key);
          return (
            <div className="i4-compare-row" role="row" key={key} data-user-content="">
              <span role="cell" className="i4-compare-name">{next?.label || old?.label || key}</span>
              <span role="cell">{old?.value || <span className="rd-weak">—</span>}</span>
              <span role="cell" className="i4-compare-after">{next?.value || <span className="rd-weak">—</span>}</span>
            </div>
          );
        })}
        {keys.length === 0 && <div className="i4-compare-row" role="row"><span role="cell" className="i4-compare-empty">这种语言没有改动</span></div>}
      </div>
      {unchanged > 0 && <p className="rd-note">其余 {unchanged} 项两版一样。</p>}
      {problems && problems.length > 0 && <Notice tone="danger" title={`${afterLabel}：${problems.join("、")}`}>批准后 App 的信任中心整页不可用。</Notice>}
      {afterBlanked && <p className="rd-note">{afterBlanked}</p>}
    </div>
  );
}

export type EditorState = {
  mode: "create" | "edit";
  sectionKey: string;
  version: string;
  description: string;
  structure: string;
  revision?: number;
  reason: string;
  fields: TrustField[];
  expectedSectionVersion: string;
  expectedSectionStatus: string;
  published?: TrustSectionVersionView;
};

/** 草稿编辑区：左边填，右边是 App 里的样子，三语切换；和公开版不同的字段标「已改」。 */
export function DraftEditorBody({ editor, published, publishedVersion, onChange, blanked, requiredLanguages, frozen = false }: {
  editor: EditorState;
  requiredLanguages: readonly OperatingLanguageCode[];
  published: readonly TrustField[];
  publishedVersion: string;
  frozen?: boolean;
  onChange: (next: EditorState) => void;
  blanked: { all?: string; keys: Set<string> };
}) {
  const [lang, setLang] = useState<Lang>("zh");
  const changed = changedKeys(mapTrustSectionLanguageFields([...published], requiredLanguages, "load"), editor.fields);
  const groups = { en: {} as Record<string, string>, zh: {} as Record<string, string>, vi: {} as Record<string, string> };
  for (const field of editor.fields) {
    const localized = localizedTrustSectionField(field.key);
    if (localized) groups[localized.language][localized.family] = field.value;
  }
  const required = requiredLanguages.includes(lang);
  const copyHint = lang !== "en" && required && Object.keys(groups.en).length === Object.keys(groups[lang]).length
    && isEnglishCopy(groups.en, groups[lang]) ? englishCopyHint(lang) : undefined;
  const shown = editor.fields.map((field, index) => ({ field, index })).filter(({ field }) => {
    const own = fieldLang(field.key);
    return own === null || own === lang;
  });
  const setField = (index: number, patch: Partial<TrustField>) => onChange({ ...editor, fields: editor.fields.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  const overLimit = editor.fields.length > APP_FIELD_LIMIT;
  return (
    <div className="i4-editor">
      <div className="i4-editor-form rd-stack">
        <div className="rd-form-grid" data-cols="2" data-dense="">
          <Field label="版本号" required hint={editor.mode === "edit" ? "不能改" : undefined} help={editor.mode === "edit" ? undefined : "v 加数字，比如 v12"}>
            <Input aria-label="版本号" disabled={frozen || editor.mode === "edit"} value={editor.version} placeholder="如 v12" onChange={(event) => onChange({ ...editor, version: event.target.value })} />
          </Field>
          <Field label="保存说明" required>
            <Input aria-label="保存说明" disabled={frozen} value={editor.reason} onChange={(event) => onChange({ ...editor, reason: event.target.value })} />
          </Field>
          <Field label="版块说明" required>
            <Input aria-label="版块说明" disabled={frozen} value={editor.description} onChange={(event) => onChange({ ...editor, description: event.target.value })} />
          </Field>
          <Field label="内容结构" required>
            <Input aria-label="内容结构" disabled={frozen} value={editor.structure} onChange={(event) => onChange({ ...editor, structure: event.target.value })} />
          </Field>
        </div>
        <div className="i4-editor-fields-head">
          <span className="i4-editor-count">{editor.fields.length} 项内容<span className="rd-form-hint">App 最多 {APP_FIELD_LIMIT} 项</span>
            <Explain label="内容怎么改" content={<><p>有哪几项跟着现在公开的版本走，不能增删，只改每项的名称和内容。</p><p>提交发布时中文、越南语、英语三种都要齐，链接可以空；草稿可以先存。</p></>} />
          </span>
          {changed.size > 0 && <StatusTag tone="progress">和 {publishedVersion || "公开版"} 比改了 {changed.size} 项</StatusTag>}
        </div>
        {overLimit && <Notice tone="warn">内容超过 {APP_FIELD_LIMIT} 项：后台能保存，但发布后 App 会拒收整份内容。</Notice>}
        <LocaleTabs label="编辑语言" value={lang} onChange={setLang} items={localeItems(mapTrustSectionLanguageFields(editor.fields, requiredLanguages, "submit"))} />
        <div className="i4-editor-list">
          {shown.map(({ field, index }) => (
            <div className="i4-editor-field" key={field.key} data-changed={changed.has(field.key) ? "" : undefined}>
              <div className="i4-editor-key">
                <span data-mono="" data-trust-field-key="fixed" title="内容项标识，不能改">{field.key}</span>
                {changed.has(field.key) && <StatusTag tone="progress">已改</StatusTag>}
                {!blanked.all && blanked.keys.has(field.key) && <span className="i4-field-note">App 公开时清空</span>}
              </div>
              <div className="i4-editor-pair">
                <Field label="名称">
                  <Input aria-label="名称" disabled={frozen} value={field.label} onChange={(event) => setField(index, { label: event.target.value })} />
                </Field>
                <Field label="内容" hint={/(url|href)$/i.test(field.key.trim()) || !required && fieldLang(field.key) === lang ? "选填" : undefined} help={fieldLang(field.key) === lang ? copyHint : undefined}>
                  <Textarea aria-label="内容" disabled={frozen} rows={1} value={field.value} onChange={(event) => setField(index, { value: event.target.value })} />
                </Field>
              </div>
            </div>
          ))}
          {shown.length === 0 && <p className="rd-note">这种语言没有内容。</p>}
        </div>
      </div>
      <aside className="i4-editor-preview" aria-label="App 里的样子">
        <div className="i4-preview-head">
          <span>App 里的样子 · {LANGS.find((item) => item.value === lang)?.label}</span>
          <Explain label="预览说明" content="按内容项原样排列，只示意用户看到的文字，不是 App 的真实排版。" />
        </div>
        {blanked.all && <Notice tone="neutral">{blanked.all}</Notice>}
        <FieldList label="App 里的样子" fields={editor.fields} lang={lang} blanked={blanked} changed={changed} />
      </aside>
    </div>
  );
}

/** 结果未知、待审批的原操作逐条列在页头下（R1）。现在的逻辑进不了这个状态，界面先备好，等代码 worker 接。 */
/** kind：结果未知、查到结果但还没结案、已建单但状态没查到、已查到在等批准。note：这一行下面的一句说明。 */
export type RecoveryRow = { key: string; kind: "unknown" | "open" | "submitted" | "pending"; name: string; change: ReactNode; submittedAt?: string; tag: ReactNode; actions: ReactNode; note?: ReactNode };
export const RECOVERY_PLACEHOLDER: RecoveryRow[] = [];
export function unknownTag() {
  return <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，可能已经建了审批单。先「查询原结果」；24 小时内也可以「按原请求重试」，系统认得出是同一次提交，不会建第二张。">结果未知</StatusTag>;
}
export function I4RecoveryNotice({ rows }: { rows: RecoveryRow[] }) {
  // 多条时默认露出三条，其余点开再看，首屏留给版块（提示不盖正事）。
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const pending = rows.filter((row) => row.kind === "pending").length;
  const submitted = rows.filter((row) => row.kind === "submitted").length;
  const ended = rows.filter((row) => row.kind === "open").length;
  const open = rows.length - pending - submitted - ended;
  const title = [open > 0 && `${open} 项操作结果未知`, ended > 0 && `${ended} 项操作还没结案`, submitted > 0 && `${submitted} 张申请已提交，状态未查到`, pending > 0 && `${pending} 张申请等另一位批准`].filter(Boolean).join(" · ");
  return (
    <Notice tone={open + ended + submitted > 0 ? "warn" : "progress"} title={<>{title}<Explain label="这些操作怎么处理" content={<>
      <p>结果未知：{DIRECT_RECOVERY_INTRO}</p>
      <p>提交发布、回滚、下架走审批：24 小时内重试不会建第二张审批单。</p>
      <p>申请过期后，按原请求查不到这张审批单，说明没建成，可以确认解除。</p>
      <p>PDF 上传这页不能重发，点「查询原结果」核对。</p>
    </>} /></>}>
      <ul className="i4-recovery" aria-label="结果未知的操作">
        {(all ? rows : rows.slice(0, 3)).map((row) => (
          <li key={row.key}>
            <span className="i4-recovery-name">{row.name}</span>
            <span>{row.change}</span>
            <span>{row.submittedAt ? `${row.submittedAt} 提交` : ""}</span>
            <span>{row.tag}</span>
            <span className="rd-row-actions">{row.actions}</span>
            {row.note && <span className="i4-recovery-note">{row.note}</span>}
          </li>
        ))}
      </ul>
      {rows.length > 3 && <div className="i-recovery-more"><Button size="sm" variant="ghost" onClick={() => setAll((open) => !open)}>{all ? "只看前 3 条" : `显示全部 ${rows.length} 条`}</Button></div>}
      <p className="rd-note">提交时间为{businessZone().label}</p>
    </Notice>
  );
}
