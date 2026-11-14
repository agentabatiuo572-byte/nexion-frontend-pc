"use client";

/**
 * I4 信任中心的画面件：版块卡、字段清单、两版对照、草稿编辑区、结果未知提醒的位置。
 * 只负责排版和由已读到的数据推出来的显示（App 能不能打开、哪些字 App 公开时清空），不发请求、不改判断。
 * App 规则的出处：后端 OpsTrustDisclosureService.publishedSections（六个版块都公开、每块当前版完整）和
 * App src/api/trust-section-api.ts（每块最多 80 个字段）。这里只是提示，App 实际读取以后端为准。
 */
import { useState, type ReactNode } from "react";
import { BadgeCheck, CircleHelp, Coins, FileSearch, Landmark, ShieldCheck, Store, Users, type LucideIcon } from "lucide-react";
import { Explain, Field, IconTile, Input, LocaleTabs, Notice, StatusTag, Textarea, type StateTone } from "@/app/components/rd";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { validateTrustSectionTrilingualFields } from "@/lib/admin/trust-section-validation";

export type TrustField = { key: string; label: string; value: string };
export type Lang = "zh" | "vi" | "en";
export const LANGS: readonly { value: Lang; label: string }[] = [
  { value: "zh", label: "中文" },
  { value: "vi", label: "越南语" },
  { value: "en", label: "英语" },
];

/** App 合同里六个版块的顺序（后端 APP_PUBLISHED_TRUST_SECTION_KEYS、App trust-section-api 同一份）。 */
export const APP_SECTION_ORDER = ["financials", "leadership", "nexNarrative", "complianceBadges", "auditsReserves", "listings"] as const;
/** App 单个版块最多收 80 个字段，超过整份拒收（后端允许 150）。 */
export const APP_FIELD_LIMIT = 80;

export const SECTION_INFO: Record<string, { name: string; where: string; icon: LucideIcon }> = {
  financials: { name: "财务数字", where: "App 页面不读这块，平台数据另有来源", icon: Coins },
  leadership: { name: "核心团队", where: "信任中心「核心团队」，只列带有效链接的人", icon: Users },
  nexNarrative: { name: "UVT 介绍", where: "UVT 介绍页，和信任中心的托管、保修、账户安全说明", icon: Landmark },
  complianceBadges: { name: "合规徽章", where: "App 页面不读这块，只参加整页检查", icon: BadgeCheck },
  auditsReserves: { name: "审计与储备", where: "信任中心「审计」和商品详情，有报告才出现", icon: FileSearch },
  listings: { name: "上市信息", where: "App 页面不读这块，只参加整页检查", icon: Store },
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

const UNSUPPORTED_SUBHERO = new Set([
  "透明、可验证，并服务于真实使用场景。",
  "Transparent, verifiable and built for real utility.",
  "Minh bạch, có thể kiểm chứng và hướng đến tiện ích thực tế.",
]);
const safeLink = (value: string) => /^https:\/\/[^\s/@]+/.test(value.trim()) || ["/pages/trust/nex", "/pages/market/market"].includes(value.trim().split("?")[0]);

/** App 公开时后端清空哪些字（publishedSections 里的过滤），只用来提示运营。 */
export function appBlanking(sectionKey: string, operator: string, fields: readonly TrustField[]): { all?: string; keys: Set<string> } {
  const keys = new Set<string>();
  if (["financials", "complianceBadges", "listings"].includes(sectionKey)) return { all: "正式环境不公开运营写的财务、徽章和上市文字。", keys };
  if (operator.trim().startsWith("migration") && ["leadership", "auditsReserves"].includes(sectionKey)) return { all: "这一版是系统迁移写入的，正式环境不公开。", keys };
  if (sectionKey === "auditsReserves") {
    if (!fields.some((field) => field.key === "document1Url" && safeLink(field.value))) return { all: "报告地址没填或不是有效链接，整块文字不公开。", keys };
    fields.filter((field) => field.key.startsWith("homepageProof.")).forEach((field) => keys.add(field.key));
  }
  if (sectionKey === "nexNarrative") {
    const enClaim = fields.some((field) => field.key === "subhero.en" && UNSUPPORTED_SUBHERO.has(field.value));
    fields.forEach((field) => {
      if (field.key === "activeAiClients") keys.add(field.key);
      if (field.key.startsWith("subhero.") && (UNSUPPORTED_SUBHERO.has(field.value) || (enClaim && !["zh", "vi", "en"].includes(field.key.slice(8))))) keys.add(field.key);
    });
  }
  return { keys };
}

/** 一个版本过不过得了 App 公开的检查（不含后端的安全文本和链接细则）。返回问题，没问题是空数组。 */
export function versionProblems(version: { description: string; structure: string; fields: readonly TrustField[] } | undefined): string[] {
  if (!version) return ["读不到当前版本的内容"];
  const problems: string[] = [];
  if (!version.description.trim() || !version.structure.trim()) problems.push("说明或结构是空的");
  if (version.fields.length === 0) problems.push("没有字段");
  else if (!validateTrustSectionTrilingualFields(version.fields.map((field) => ({ key: field.key, value: field.value }))).valid) problems.push("中越英字段不全");
  if (version.fields.length > APP_FIELD_LIMIT) problems.push(`字段超过 ${APP_FIELD_LIMIT} 个，App 拒收`);
  return problems;
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
        </span>
        {card.preview.length
          ? <dl className="i4-app-lines" data-user-content="" data-blank={card.appHidden ? "" : undefined}>{card.preview.map((field) => <div key={field.key}><dt>{field.label}</dt><dd title={field.value}>{field.value || "—"}</dd></div>)}</dl>
          : <p className="i4-app-blank">没有可显示的字段</p>}
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
export function FieldList({ fields, lang, blanked, changed, label }: { fields: readonly TrustField[]; lang: Lang; blanked?: { all?: string; keys: Set<string> }; changed?: Set<string>; label: string }) {
  const shown = fieldsFor(fields, lang);
  if (!shown.length) return <p className="rd-note">这一版没有字段。</p>;
  return (
    <dl className="i4-fields" aria-label={label} data-user-content="">
      {shown.map((field) => (
        <div key={field.key} className="i4-field" data-changed={changed?.has(field.key) ? "" : undefined}>
          <dt>{field.label}{changed?.has(field.key) && <StatusTag tone="progress">已改</StatusTag>}</dt>
          <dd>
            {field.value ? <span>{field.value}</span> : <span className="rd-weak">—</span>}
            {!blanked?.all && blanked?.keys.has(field.key) && <span className="i4-field-note">App 公开时清空</span>}
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
          <span role="columnheader">字段</span>
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
      {unchanged > 0 && <p className="rd-note">其余 {unchanged} 个字段两版一样。</p>}
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
};

/** 草稿编辑区：左边填，右边是 App 里的样子，三语切换；和公开版不同的字段标「已改」。 */
export function DraftEditorBody({ editor, published, publishedVersion, onChange, blanked }: {
  editor: EditorState;
  published: readonly TrustField[];
  publishedVersion: string;
  onChange: (next: EditorState) => void;
  blanked: { all?: string; keys: Set<string> };
}) {
  const [lang, setLang] = useState<Lang>("zh");
  const changed = changedKeys(published, editor.fields);
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
            <Input aria-label="版本号" disabled={editor.mode === "edit"} value={editor.version} placeholder="如 v12" onChange={(event) => onChange({ ...editor, version: event.target.value })} />
          </Field>
          <Field label="保存说明" required>
            <Input aria-label="保存说明" value={editor.reason} onChange={(event) => onChange({ ...editor, reason: event.target.value })} />
          </Field>
          <Field label="版块说明" required>
            <Input aria-label="版块说明" value={editor.description} onChange={(event) => onChange({ ...editor, description: event.target.value })} />
          </Field>
          <Field label="内容结构" required>
            <Input aria-label="内容结构" value={editor.structure} onChange={(event) => onChange({ ...editor, structure: event.target.value })} />
          </Field>
        </div>
        <div className="i4-editor-fields-head">
          <span className="i4-editor-count">字段 {editor.fields.length} 个<span className="rd-form-hint">App 最多 {APP_FIELD_LIMIT} 个</span>
            <Explain label="字段怎么改" content={<><p>字段标识跟着现在公开的版本走，不能增删、不能改名，只改名称和内容。</p><p>中文、越南语、英语三种都要填；链接字段可以空。</p></>} />
          </span>
          {changed.size > 0 && <StatusTag tone="progress">和 {publishedVersion || "公开版"} 比改了 {changed.size} 项</StatusTag>}
        </div>
        {overLimit && <Notice tone="warn">字段超过 {APP_FIELD_LIMIT} 个：后台能保存，但发布后 App 会拒收整份内容。</Notice>}
        <LocaleTabs label="编辑语言" value={lang} onChange={setLang} items={localeItems(editor.fields)} />
        <div className="i4-editor-list">
          {shown.map(({ field, index }) => (
            <div className="i4-editor-field" key={field.key} data-changed={changed.has(field.key) ? "" : undefined}>
              <div className="i4-editor-key">
                <span data-mono="" data-trust-field-key="fixed" title="字段标识，不能改">{field.key}</span>
                {changed.has(field.key) && <StatusTag tone="progress">已改</StatusTag>}
                {!blanked.all && blanked.keys.has(field.key) && <span className="i4-field-note">App 公开时清空</span>}
              </div>
              <div className="i4-editor-pair">
                <Field label="字段名称">
                  <Input aria-label="字段名称" value={field.label} onChange={(event) => setField(index, { label: event.target.value })} />
                </Field>
                <Field label="字段内容" hint={/(url|href)$/i.test(field.key.trim()) ? "选填" : undefined}>
                  <Textarea aria-label="字段内容" rows={1} value={field.value} onChange={(event) => setField(index, { value: event.target.value })} />
                </Field>
              </div>
            </div>
          ))}
          {shown.length === 0 && <p className="rd-note">这种语言没有字段。</p>}
        </div>
      </div>
      <aside className="i4-editor-preview" aria-label="App 里的样子">
        <div className="i4-preview-head">
          <span>App 里的样子 · {LANGS.find((item) => item.value === lang)?.label}</span>
          <Explain label="预览说明" content="按字段原样排列，只示意用户看到的文字，不是 App 的真实排版。" />
        </div>
        {blanked.all && <Notice tone="neutral">{blanked.all}</Notice>}
        <FieldList label="App 里的样子" fields={editor.fields} lang={lang} blanked={blanked} changed={changed} />
      </aside>
    </div>
  );
}

/** 结果未知、待审批的原操作逐条列在页头下（R1）。现在的逻辑进不了这个状态，界面先备好，等代码 worker 接。 */
export type RecoveryRow = { key: string; name: string; change: ReactNode; submittedAt?: string; tag: ReactNode; actions: ReactNode };
export const RECOVERY_PLACEHOLDER: RecoveryRow[] = [];
export function unknownTag() {
  return <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，可能已经建了审批单。先「查询原结果」；24 小时内也可以「按原请求重试」，后端认得出是同一次提交，不会建第二张。">结果未知</StatusTag>;
}
export function I4RecoveryNotice({ rows }: { rows: RecoveryRow[] }) {
  if (!rows.length) return null;
  return (
    <Notice tone="warn" title={`${rows.length} 项操作结果未知`}>
      <ul className="i4-recovery" aria-label="结果未知的操作">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="i4-recovery-name">{row.name}</span>
            <span>{row.change}</span>
            <span>{row.submittedAt ? `${row.submittedAt} 提交` : ""}</span>
            <span>{row.tag}</span>
            <span className="rd-row-actions">{row.actions}</span>
          </li>
        ))}
      </ul>
      <p className="rd-note">提交时间为{businessZone().label}</p>
    </Notice>
  );
}
