"use client";

/**
 * 页面文案对比测试的界面件：位置卡、用户看到的样子、实验卡、内容对比、文案编辑抽屉、实验创建抽屉。
 * 只管画和本地表单状态；请求、提交和成功失败都走 i1-copy-ab.tsx 里原来的处理函数。
 * 两个抽屉的初始值和「还缺什么」照搬 design-kit 的 copy-edit、copy-create、copy-experiment-create
 * （initBusinessForm、missingBusinessFields、增删变体的均分），同样的输入得到同样的表单值，请求逐字节不变。
 */
import { useState, type ReactNode } from "react";
import { FilePen, FlaskConical, MapPin, Plus, Trash2, Trophy } from "lucide-react";
import { Button, Cell, Decision, Drawer, Explain, Fact, Facts, Field, IconButton, Input, Modal, MoreMenu, Notice, NumberInput, Panel, RatioBar, ScaleBar, Segments, Select, StatusTag, Table, Td, Textarea, Th, type MoreMenuItem, type StateTone } from "@/app/components/rd";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { i6CopyQualityIssues } from "@/lib/admin/i6-copy-quality";
import type { BusinessFormSpec, BusinessFormValue } from "../design-kit";

export type Lang = "zh" | "vi" | "en";
export const LANGS: readonly { key: Lang; label: string }[] = [
  { key: "zh", label: "中文" },
  { key: "vi", label: "越南语" },
  { key: "en", label: "英语" },
];
export type Texts = Record<Lang, string>;

export const MODULE_LABELS: Record<string, string> = { home: "首页", store: "商城", earn: "收益", me: "我的" };
export const moduleLabel = (surface?: string) => (surface && MODULE_LABELS[surface]) || "模块未知";

export const missingLangs = (texts: Texts) => LANGS.filter((lang) => !texts[lang.key]?.trim()).map((lang) => lang.label);

/** 文案状态：后端小写、下划线换短横线；存草稿是 draft-saved，这时按位置取不到它（B01）。 */
export function copyStatus(status: string): { tone: StateTone; text: string; explain?: string } {
  const value = status.toLowerCase();
  if (value === "published") return { tone: "ok", text: "已发布" };
  if (value === "archived") return { tone: "done", text: "已下架" };
  if (value === "draft-saved" || value === "draft") return { tone: "warn", text: "暂停投放", explain: "存了草稿，这条文案的状态变成草稿，按位置取文案时取不到它。发布草稿后恢复；删掉草稿只在现在的版本还是已发布时恢复。" };
  return { tone: "neutral", text: "状态待核实", explain: `后端返回的状态是 ${status}，这页不认识。` };
}

export function versionStatus(status: string): { tone: StateTone; text: string } {
  const value = status.toLowerCase();
  if (value === "draft") return { tone: "neutral", text: "草稿" };
  if (value === "published") return { tone: "ok", text: "已发布" };
  return { tone: "done", text: "已归档" };
}

export function experimentState(state: string): { tone: StateTone; text: string } {
  if (state === "scheduled") return { tone: "warn", text: "待启动" };
  if (state === "running") return { tone: "progress", text: "进行中" };
  if (state === "concluded") return { tone: "warn", text: "已结束，待决定" };
  if (state === "stopped") return { tone: "warn", text: "已停止，待决定" };
  if (state === "adopted") return { tone: "done", text: "已采纳" };
  return { tone: "done", text: "已弃用" };
}

/** 三种语言一行一种，缺的写「缺失」。全文在悬停里。 */
export function LangLines({ texts, dim }: { texts: Texts; dim?: boolean }) {
  return (
    <dl className="i1-langs" data-dim={dim ? "" : undefined}>
      {LANGS.map((lang) => {
        const text = texts[lang.key]?.trim();
        return (
          <div key={lang.key} className="i1-lang">
            <dt>{lang.label}</dt>
            <dd data-user-content="" title={text ? nexGridBrandText(text) : undefined}>
              {text ? nexGridBrandText(text) : <StatusTag tone="warn">缺失</StatusTag>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** 三种语言整段，详情和确认框里看全文。 */
export function LangBlocks({ texts }: { texts: Texts }) {
  return (
    <dl className="i1-lang-blocks">
      {LANGS.map((lang) => {
        const text = texts[lang.key]?.trim();
        return (
          <div key={lang.key}>
            <dt>{lang.label}</dt>
            <dd data-user-content="">{text ? nexGridBrandText(text) : <StatusTag tone="warn">缺失</StatusTag>}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** 用户看到的样子：按模块排的示意，一次看一种语言。 */
export function UserPreview({ surface, texts }: { surface?: string; texts: Texts }) {
  const [lang, setLang] = useState<Lang>("zh");
  const text = texts[lang]?.trim();
  return (
    <figure className="i1-preview">
      <figcaption className="i1-preview-head">
        用户看到的样子
        <Explain label="预览怎么来的" content="按现在发布的内容排的示意，不是 App 截图。" />
      </figcaption>
      <div className="i1-phone">
        <span className="i1-phone-bar">{moduleLabel(surface)}</span>
        <p className="i1-phone-text" data-user-content="">{text ? nexGridBrandText(text) : <StatusTag tone="warn">这种语言缺失</StatusTag>}</p>
      </div>
      <Segments label="预览语言" value={lang} onChange={setLang}
        items={LANGS.map((item) => ({ value: item.key, label: item.label, tone: texts[item.key]?.trim() ? undefined : "warn" as const }))} />
    </figure>
  );
}

/** 位置卡上一条文案（通常一个位置一条）。 */
export type PositionCopy = {
  key: string;
  name: string;
  status: string;
  version: string;
  versionName?: string;
  texts: Texts | null;
  versionCount: number;
  draftVersion?: string;
  lastChange: string;
  experiment?: { id: string; text: string; tone: StateTone };
};

export function PositionCard({ title, sub, statusTag, surface, copies, problem, empty, menu, openLabel = "查看和编辑", onOpenCopy, onOpenExperiment }: {
  title: ReactNode;
  sub: ReactNode;
  statusTag?: ReactNode;
  surface?: string;
  copies: readonly PositionCopy[];
  problem?: ReactNode;
  empty?: ReactNode;
  menu?: readonly MoreMenuItem[];
  /** 打开文案详情的按钮名：没有写权限时只写「查看」。 */
  openLabel?: string;
  onOpenCopy: (key: string) => void;
  onOpenExperiment: (id: string) => void;
}) {
  return (
    <Panel className="i1-pos" title={title} sub={sub} icon={MapPin} tone="role-2" headingLevel={3}
      actions={<>{statusTag}{menu && menu.length > 0 && <MoreMenu label="位置操作" items={menu} />}</>}>
      {problem}
      {copies.length === 0 && <div className="i1-pos-empty">{empty}</div>}
      {copies.map((copy) => {
        const status = copyStatus(copy.status);
        return (
          <div key={copy.key} className="i1-pos-copy">
            <div className="i1-pos-main">
              <div className="i1-pos-line">
                <span className="i1-pos-name">{copy.name}</span>
                <span className="i1-key" data-mono="">{copy.key}</span>
                <StatusTag tone={status.tone} explain={status.explain}>{status.text}</StatusTag>
              </div>
              {copy.texts
                ? <LangLines texts={copy.texts} dim={copy.status.toLowerCase() !== "published"} />
                : <p className="i1-weak">读不到 {copy.version} 的内容</p>}
              <div className="i1-pos-meta">
                <span><b data-mono="">{copy.version}</b>{copy.versionName ? ` · ${copy.versionName}` : ""}</span>
                <span>{copy.versionCount} 个版本{copy.draftVersion ? ` · 草稿 ${copy.draftVersion}` : ""}</span>
                <span>最近改版 {copy.lastChange || "—"}</span>
                {copy.experiment
                  ? <button type="button" className="rd-link i1-exp-link" onClick={() => onOpenExperiment(copy.experiment!.id)}>
                      <StatusTag tone={copy.experiment.tone} icon={FlaskConical}>{copy.experiment.text}</StatusTag>
                    </button>
                  : <span className="i1-weak">没有实验</span>}
                <Button size="sm" onClick={() => onOpenCopy(copy.key)}>{openLabel}</Button>
              </div>
            </div>
            {copy.texts && <UserPreview surface={surface} texts={copy.texts} />}
          </div>
        );
      })}
    </Panel>
  );
}

/** 实验卡里的一组：这组用户看到的版本、分流、转化率。 */
export type VariantView = { name: string; version: string; versionName?: string; split: number; cvr: number; text?: string; impressions?: number; conversions?: number };

export function ExperimentCard({ id, title, sub, state, variants, impressions, conversions, leader, sample, audience, note, actions, selected }: {
  id: string;
  title: ReactNode;
  sub: ReactNode;
  state: string;
  variants: readonly VariantView[];
  impressions: number | null;
  conversions: number | null;
  /** 页面上的数里转化率唯一最高的那组；没有曝光或并列时为空。 */
  leader?: string;
  sample: { text: ReactNode; tone: StateTone | null };
  audience: ReactNode;
  note?: string;
  actions?: ReactNode;
  selected?: boolean;
}) {
  const st = experimentState(state);
  const started = state !== "scheduled";
  const hasData = started && impressions !== null && impressions > 0;
  const maxCvr = Math.max(0, ...variants.map((variant) => variant.cvr));
  const axis = niceMax(maxCvr);
  const ticks = [{ value: 0, text: "0" }, { value: axis, text: `${axis}%` }];
  return (
    <Panel id={`i1-exp-${id}`} className="i1-exp" data-selected={selected ? "" : undefined} title={title} sub={sub} icon={FlaskConical} tone="role-3" headingLevel={3}
      actions={<StatusTag tone={st.tone}>{st.text}</StatusTag>}>
      <div className="i1-variants" data-count={Math.min(variants.length, 4)}>
        {variants.map((variant) => {
          const lead = leader === variant.name;
          return (
            <section key={`${variant.name}-${variant.version}`} className="i1-variant" data-lead={lead ? "" : undefined} aria-label={`${variant.name} 组`}>
              <header className="i1-variant-head">
                <span className="i1-variant-badge">{variant.name}</span>
                <span className="i1-variant-ver"><b data-mono="">{variant.version || "—"}</b>{variant.versionName ? ` · ${variant.versionName}` : ""}</span>
                {lead && <StatusTag tone="ok" icon={Trophy} explain="按转化人数 ÷ 看到人数的原始数比较，转化率四舍五入后相同也能分出高低。">领先</StatusTag>}
              </header>
              <p className="i1-variant-text" data-user-content="" title={variant.text ? nexGridBrandText(variant.text) : undefined}>
                {variant.text ? nexGridBrandText(variant.text) : <span className="i1-weak">读不到这个版本的中文</span>}
              </p>
              <dl className="i1-variant-nums">
                <div><dt>分流</dt><dd>{variant.split}%</dd></div>
                <RatioBar quiet label="分流" value={variant.split} total={100} valueText={`${variant.split}%`} tone="role-3" />
                <div>
                  <dt>转化率</dt>
                  <dd className="i1-cvr" data-empty={hasData ? undefined : ""}>{hasData ? `${variant.cvr.toFixed(2)}%` : "—"}</dd>
                </div>
                {hasData
                  ? <ScaleBar quiet label="转化率" valueText={`${variant.cvr.toFixed(2)}%，刻度 0 到 ${axis}%`} max={axis} value={variant.cvr} fill ticks={ticks} tone="role-3" />
                  : <span className="i1-weak">{started ? "还没有人看到" : "还没开始"}</span>}
                <div>
                  <dt>看到 / 转化</dt>
                  <dd data-empty={variant.impressions == null ? "" : undefined}>{variant.impressions == null ? "—" : `${variant.impressions.toLocaleString()} / ${variant.conversions == null ? "—" : variant.conversions.toLocaleString()} 人`}</dd>
                </div>
              </dl>
            </section>
          );
        })}
      </div>
      <div className="i1-exp-foot">
        <dl className="i1-exp-facts">
          <div><dt>合计看到</dt><dd data-empty={impressions ? undefined : ""}>{started && impressions !== null ? `${impressions.toLocaleString()} 人` : "—"}</dd></div>
          <div><dt>转化</dt><dd data-empty={conversions ? undefined : ""}>{started && conversions !== null ? `${conversions.toLocaleString()} 人` : "—"}</dd></div>
          <div>
            <dt>样本<Explain label="样本怎么判断" content={<><p>采纳要求每一组都至少 100 人看到，并且转化率唯一最高，否则不能采纳。合计再多，有一组不到 100 人也不够。</p><p>人数按人累计，同一人只算一次。转化只算已付款或已完成的订单，一人只算一次。</p></>} /></dt>
            <dd>{sample.tone ? <StatusTag tone={sample.tone}>{sample.text}</StatusTag> : sample.text}</dd>
          </div>
          <div className="i1-exp-aud"><dt>受众</dt><dd>{audience}</dd></div>
          {note && <div className="i1-exp-note"><dt>备注</dt><dd data-user-content="">{note}</dd></div>}
        </dl>
        {actions && <div className="i1-exp-actions">{actions}</div>}
      </div>
    </Panel>
  );
}

/** 转化率轴的上限：包住最大值的整齐数。 */
function niceMax(value: number) {
  if (!(value > 0)) return 1;
  const steps = [1, 2, 5, 10, 20, 25, 50, 100];
  return steps.find((step) => step >= value) ?? Math.ceil(value);
}

/** 确认框里的内容对比：现在一列、之后一列，一种语言一行，没变的写「不变」。 */
export function CompareTexts({ beforeLabel, afterLabel, before, after }: { beforeLabel: string; afterLabel: string; before: Texts | null; after: Texts }) {
  return (
    <div className="rd-impact i1-compare">
      <div className="rd-impact-title">内容对比</div>
      <Table label="内容对比">
        <thead><tr><Th>语言</Th><Th>{beforeLabel}</Th><Th>{afterLabel}</Th></tr></thead>
        <tbody>
          {LANGS.map((lang) => {
            const was = before?.[lang.key]?.trim() ?? "";
            const next = after[lang.key]?.trim() ?? "";
            return (
              <tr key={lang.key}>
                <Td>{lang.label}</Td>
                <Td>{was ? <Cell main={nexGridBrandText(was)} title={nexGridBrandText(was)} /> : <span className="i1-weak">—</span>}</Td>
                <Td>{!next ? <StatusTag tone="warn">缺失</StatusTag> : next === was ? <span className="i1-weak">不变</span> : <Cell main={nexGridBrandText(next)} title={nexGridBrandText(next)} />}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}

/* ---------- 文案编辑抽屉 ---------- */

export type CopyEditSpec = Extract<BusinessFormSpec, { kind: "copy-edit" }>;
export type CopyCreateSpec = Extract<BusinessFormSpec, { kind: "copy-create" }>;
export type SaveMode = "存草稿" | "发布生效";

const PHASES = ["P1", "P2", "P3", "P4", "P5", "P6"];
const LANGUAGE_OPTIONS = [
  { value: "all", label: "全部语言" },
  { value: "zh", label: "中文" },
  { value: "en", label: "英语" },
  { value: "vi", label: "越南语" },
];

/** 同 design-kit parseCopyAudience。 */
export function parseCopyAudience(audience?: string) {
  const raw = audience?.trim() ?? "";
  const phaseRange = raw.match(/P([1-6])(?:\s*[-–]\s*P?([1-6]))?/i);
  const language = raw.match(/(?:^|[·\s])(zh|en|vi)(?:$|[·\s])/i)?.[1]?.toLowerCase() ?? "all";
  const days = raw.match(/注册\s*(?:>|≥)\s*(\d+)\s*天/)?.[1] ?? "0";
  return {
    phaseMin: phaseRange?.[1] ? `P${phaseRange[1]}` : "P1",
    phaseMax: phaseRange?.[2] ? `P${phaseRange[2]}` : phaseRange?.[1] ? `P${phaseRange[1]}` : "P3",
    language,
    registrationDaysGt: days,
  };
}

/** 同 design-kit initBusinessForm 的 copy-edit、copy-create。 */
function initCopyForm(spec: CopyEditSpec | CopyCreateSpec): BusinessFormValue {
  const audience = parseCopyAudience(spec.audience);
  if (spec.kind === "copy-edit") {
    return {
      zh: spec.zh ?? "",
      en: spec.en ?? "",
      vi: spec.vi ?? "",
      version: spec.version || spec.versionOptions?.[0]?.value || "",
      surface: spec.surface ?? "",
      copyPosition: spec.copyPosition ?? spec.positions?.find((item) => item.surface === spec.surface && item.status !== "disabled")?.value ?? "",
      audience: spec.audience ?? spec.audiences?.[0] ?? "",
      phaseMin: spec.phaseMin ?? audience.phaseMin,
      phaseMax: spec.phaseMax ?? audience.phaseMax,
      language: spec.language ?? audience.language,
      registrationDaysGt: spec.registrationDaysGt ?? audience.registrationDaysGt,
      trafficSplit: spec.trafficSplit ?? spec.trafficSplits?.[0] ?? "",
      versionNote: spec.versionNote ?? "日常内容迭代",
      saveMode: "存草稿",
    };
  }
  const surface = spec.surface ?? spec.modules?.[0]?.value ?? "home";
  return {
    copyKey: spec.copyKey ?? "",
    description: spec.description ?? "",
    surface,
    copyPosition: spec.copyPosition ?? spec.positions?.find((item) => item.surface === surface && item.status !== "disabled")?.value ?? "",
    audience: spec.audience ?? "",
    phaseMin: spec.phaseMin ?? audience.phaseMin,
    phaseMax: spec.phaseMax ?? audience.phaseMax,
    language: spec.language ?? audience.language,
    registrationDaysGt: spec.registrationDaysGt ?? audience.registrationDaysGt,
    trafficSplit: spec.trafficSplits?.[0] ?? "",
    version: spec.version ?? spec.versionOptions?.[0]?.value ?? "",
    versionNote: spec.versionNote ?? "新增文案初始内容",
    zh: spec.zh ?? "",
    en: spec.en ?? "",
    vi: spec.vi ?? "",
  };
}

const FIELD_NAMES: Record<string, string> = {
  copyKey: "文案标识", description: "文案名称", version: "文案版本", surface: "投放模块", copyPosition: "文案位置",
  phaseMin: "最低阶段", phaseMax: "最高阶段", language: "语言", registrationDaysGt: "注册天数", trafficSplit: "分流比例",
  versionNote: "版本说明", zh: "中文", en: "英语", vi: "越南语",
};

/** 同 design-kit missingBusinessFields 的 copy-edit、copy-create：返回还缺什么，按字段分开。 */
function copyFormIssues(spec: CopyEditSpec | CopyCreateSpec, state: BusinessFormValue, mode: SaveMode) {
  const fields: Record<string, string> = {};
  const other: string[] = [];
  const keys = spec.kind === "copy-create"
    ? ["copyKey", "description", "surface", "copyPosition", "phaseMin", "phaseMax", "language", "registrationDaysGt", "trafficSplit", "version", "versionNote", "zh", "en", "vi"]
    : ["version", "surface", "copyPosition", "phaseMin", "phaseMax", "language", "registrationDaysGt", "trafficSplit", "versionNote", "zh", "en", "vi"];
  keys.forEach((key) => { if (!state[key]?.trim()) fields[key] = `请填写${FIELD_NAMES[key]}`; });
  if (Number(state.phaseMin?.replace("P", "")) > Number(state.phaseMax?.replace("P", ""))) fields.phaseMax = "最高阶段不能低于最低阶段";
  if (!fields.registrationDaysGt && (!Number.isInteger(Number(state.registrationDaysGt)) || Number(state.registrationDaysGt) < 0)) fields.registrationDaysGt = "填 0 或正整数";
  const split = Number(state.trafficSplit);
  if (!fields.trafficSplit && (!Number.isFinite(split) || split <= 0 || split > 100)) fields.trafficSplit = "填 1–100";
  (spec.placeholders ?? []).forEach((ph) => {
    for (const lang of LANGS) if (!state[lang.key]?.includes(ph) && !fields[lang.key]) fields[lang.key] = `缺少占位符 ${ph}`;
  });
  if (spec.kind === "copy-create" || mode === "发布生效") other.push(...i6CopyQualityIssues(state.zh ?? "", state.en ?? "", state.vi ?? ""));
  const list = [...Object.keys(fields).map((key) => FIELD_NAMES[key] ?? key), ...other];
  return { fields, other, blocked: list.length ? `还缺：${[...new Set(list)].join("、")}` : undefined };
}

export function CopyEditorDrawer({ spec, title, sub, basedOn, pausesDelivery, onClose, onSubmit }: {
  spec: CopyEditSpec | CopyCreateSpec;
  title: string;
  sub?: ReactNode;
  basedOn?: ReactNode;
  /** 这条文案现在是已发布：存草稿会让它暂停投放（B01）。 */
  pausesDelivery?: boolean;
  onClose: () => void;
  onSubmit: (form: BusinessFormValue, mode: SaveMode) => void;
}) {
  const [initial] = useState(() => initCopyForm(spec));
  const [form, setForm] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const isCreate = spec.kind === "copy-create";
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const draftCheck = copyFormIssues(spec, form, "存草稿");
  const publishCheck = copyFormIssues(spec, form, "发布生效");
  const shown = attempted ? publishCheck : { fields: {} as Record<string, string>, other: [] as string[] };
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const modules = spec.modules ?? [];
  const positions = (spec.positions ?? []).filter((item) => item.surface === form.surface && item.status !== "disabled");
  const changeSurface = (surface: string) => setForm((current) => ({
    ...current,
    surface,
    copyPosition: (spec.positions ?? []).find((item) => item.surface === surface && item.status !== "disabled")?.value ?? "",
  }));
  const close = () => (dirty ? setLeaving(true) : onClose());
  const fixedVersion = spec.kind === "copy-edit" ? spec.version : undefined;
  const placeholders = spec.placeholders ?? [];

  return (
    <>
      <Drawer open wide onClose={close} title={title} sub={sub} icon={FilePen} tone="role-1"
        footer={<Decision
          note={!isCreate && pausesDelivery ? "存草稿会撤下线上内容，发布或删掉草稿后恢复投放。" : undefined}
          others={<Button onClick={close}>取消</Button>}
          primary={<>
            {!isCreate && <Button disabledReason={draftCheck.blocked} onBlockedClick={() => setAttempted(true)} onClick={() => onSubmit(form, "存草稿")}>存草稿</Button>}
            <Button variant="primary" disabledReason={publishCheck.blocked} onBlockedClick={() => setAttempted(true)} onClick={() => onSubmit(form, "发布生效")}>{isCreate ? "新增并发布" : "发布"}</Button>
          </>} />}>
        <div className="rd-form-stack" data-business-form={spec.kind}>
          {basedOn && <Facts>{basedOn}</Facts>}
          {isCreate && (
            <div className="rd-form-grid" data-cols="2">
              <Field label="文案标识" required error={shown.fields.copyKey} explain="字母开头，可用字母、数字、点、下划线、短横线；同时用作多语言与课程里的词条名。">
                {(control) => <Input {...control} value={form.copyKey ?? ""} placeholder="home.newBanner" onChange={(event) => set("copyKey", event.target.value)} />}
              </Field>
              <Field label="文案名称" required error={shown.fields.description}>
                {(control) => <Input {...control} value={form.description ?? ""} placeholder="首页新横幅" onChange={(event) => set("description", event.target.value)} />}
              </Field>
            </div>
          )}
          <div className="rd-form-grid" data-cols="3">
            <Field label="文案版本" required error={shown.fields.version} explain="从「版本目录」里启用、这条文案没用过的版本选；当前草稿的版本不能换。">
              {fixedVersion
                ? <div className="rd-form-static"><b data-mono="">{fixedVersion}</b> · 当前草稿</div>
                : <Select aria-label="文案版本" value={form.version ?? ""} options={(spec.versionOptions ?? []).map((item) => ({ value: item.value, label: item.label }))} onChange={(next) => set("version", next)} />}
            </Field>
            <Field label="投放模块" required error={shown.fields.surface}>
              <Select aria-label="投放模块" value={form.surface ?? ""} options={modules.map((item) => ({ value: item.value, label: item.label }))} onChange={changeSurface} />
            </Field>
            <Field label="文案位置" required error={shown.fields.copyPosition} help={positions.length ? undefined : "这个模块没有启用的位置"}>
              <Select aria-label="文案位置" value={form.copyPosition ?? ""} options={positions.map((item) => ({ value: item.value, label: item.label }))} onChange={(next) => set("copyPosition", next)} />
            </Field>
          </div>

          <h3 className="rd-form-group-title">三种语言</h3>
          {placeholders.length > 0 && <Notice tone="neutral">三种语言都要保留：{placeholders.map((ph, index) => <span key={ph}><span data-mono="">{ph}</span>{index < placeholders.length - 1 ? "、" : ""}</span>)}</Notice>}
          <div className="rd-form-grid i1-tri" data-cols="3">
            {LANGS.map((lang) => {
              const value = form[lang.key] ?? "";
              return (
                <Field key={lang.key} label={<>{lang.label}{!value.trim() && <StatusTag tone="warn">缺失</StatusTag>}</>} required error={shown.fields[lang.key]}>
                  {(control) => <Textarea {...control} aria-label={`${lang.label}文案`} rows={4} value={value} count={`${value.length}/1000`} onChange={(event) => set(lang.key, event.target.value)} />}
                </Field>
              );
            })}
          </div>
          {shown.other.length > 0 && <Notice tone="warn">发布前要改：{shown.other.join("、")}</Notice>}

          <h3 className="rd-form-group-title">
            实验用的受众和分流
            <Explain label="受众和分流管什么" content="只对实验起作用：创建实验时各组沿用这里的受众。普通发布不按受众和分流筛选用户。" />
          </h3>
          <div className="rd-form-grid" data-cols="3">
            <Field label="最低阶段" required error={shown.fields.phaseMin}>
              <Select aria-label="最低阶段" value={form.phaseMin ?? ""} options={PHASES.map((value) => ({ value, label: value }))} onChange={(next) => set("phaseMin", next)} />
            </Field>
            <Field label="最高阶段" required error={shown.fields.phaseMax}>
              <Select aria-label="最高阶段" value={form.phaseMax ?? ""} options={PHASES.map((value) => ({ value, label: value }))} onChange={(next) => set("phaseMax", next)} />
            </Field>
            <Field label="语言" required error={shown.fields.language}>
              <Select aria-label="语言" value={form.language ?? ""} options={LANGUAGE_OPTIONS} onChange={(next) => set("language", next)} />
            </Field>
            <Field label="注册超过" required error={shown.fields.registrationDaysGt} explain="阶段是全平台当前的运营阶段，不是用户等级。">
              {(control) => <NumberInput {...control} unit="天" min={0} step={1} value={form.registrationDaysGt ?? ""} onChange={(event) => set("registrationDaysGt", event.target.value)} />}
            </Field>
            <Field label="分流比例" required error={shown.fields.trafficSplit} help={shown.fields.trafficSplit ? undefined : "1–100"}>
              {(control) => <NumberInput {...control} unit="%" min={0} max={100} value={form.trafficSplit ?? ""} onChange={(event) => set("trafficSplit", event.target.value)} />}
            </Field>
          </div>
          <Field label="版本说明" required error={shown.fields.versionNote}>
            {(control) => <Input {...control} value={form.versionNote ?? ""} maxLength={255} placeholder="这次改了什么、想达到什么效果" onChange={(event) => set("versionNote", event.target.value)} />}
          </Field>
        </div>
      </Drawer>
      {leaving && (
        <Modal title="放弃没保存的修改？" icon={FilePen} onClose={() => setLeaving(false)} footer={<>
          <Button onClick={() => setLeaving(false)}>继续编辑</Button>
          <Button variant="primary" onClick={onClose}>放弃修改</Button>
        </>}>
          <p>关掉后，这次填的内容不会保留。</p>
        </Modal>
      )}
    </>
  );
}

/* ---------- 实验创建抽屉 ---------- */

export type ExperimentCopyOption = Extract<BusinessFormSpec, { kind: "copy-experiment-create" }>["copies"][number];
type ExperimentVersionOption = ExperimentCopyOption["versions"][number];

/** 同 design-kit copyExperimentAudienceSignature。 */
function audienceSignature(version?: ExperimentVersionOption): string {
  if (!version) return "";
  const parsed = parseCopyAudience(version.audience);
  const start = Number(parsed.phaseMin.slice(1));
  const end = Number(parsed.phaseMax.slice(1));
  const tiers = version.audienceTarget?.tiers?.length
    ? [...version.audienceTarget.tiers].map((tier) => tier.toUpperCase()).sort()
    : Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => `P${start + index}`);
  const locales = version.audienceTarget
    ? (version.audienceTarget.locales?.length ? [...version.audienceTarget.locales].map((locale) => locale.toLowerCase()).sort() : ["all"])
    : [parsed.language.toLowerCase()];
  const registrationDaysMin = version.audienceTarget?.registrationDaysMin ?? Number(parsed.registrationDaysGt) + 1;
  const registrationDaysMax = version.audienceTarget?.registrationDaysMax ?? null;
  return JSON.stringify({ tiers, locales, registrationDaysMin, registrationDaysMax });
}

/** 受众写成一句：阶段、语言、注册天数（同 design-kit 实验表单的读法）。 */
export function audienceText(version?: { audience?: string; audienceTarget?: ExperimentVersionOption["audienceTarget"] | null }) {
  const target = version?.audienceTarget;
  const parsed = parseCopyAudience(version?.audience);
  const tiers = target?.tiers?.length
    ? `${target.tiers[0]}${target.tiers.length > 1 ? `–${target.tiers[target.tiers.length - 1]}` : ""}`
    : `${parsed.phaseMin}${parsed.phaseMin === parsed.phaseMax ? "" : `–${parsed.phaseMax}`}`;
  const languages = target?.locales?.length
    ? target.locales.map((item) => LANGUAGE_OPTIONS.find((option) => option.value === item)?.label ?? item).join("、")
    : parsed.language === "all" ? "全部语言" : LANGUAGE_OPTIONS.find((option) => option.value === parsed.language)?.label ?? parsed.language;
  const days = target?.registrationDaysMin != null ? Math.max(0, target.registrationDaysMin - 1) : Number(parsed.registrationDaysGt || 0);
  return `阶段 ${tiers} · ${languages} · 注册超过 ${days} 天`;
}

/** 同 design-kit initBusinessForm 的 copy-experiment-create。 */
function initExperimentForm(copies: readonly ExperimentCopyOption[]): BusinessFormValue {
  const copy = copies[0];
  return {
    copyKey: copy?.value ?? "",
    variantCount: "2",
    "variantVersion.0": copy?.versions[0]?.value ?? "",
    "variantSplit.0": "50",
    "variantVersion.1": copy?.versions[1]?.value ?? "",
    "variantSplit.1": "50",
    note: "",
  };
}

export function ExperimentDrawer({ copies, versionText, onClose, onSubmit }: {
  copies: readonly ExperimentCopyOption[];
  /** 这个版本的中文，给「这组用户看到」用。 */
  versionText: (copyKey: string, version: string) => string | undefined;
  onClose: () => void;
  onSubmit: (form: BusinessFormValue) => void;
}) {
  const [initial] = useState(() => initExperimentForm(copies));
  const [form, setForm] = useState(initial);
  const [leaving, setLeaving] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const close = () => (dirty ? setLeaving(true) : onClose());
  const copy = copies.find((item) => item.value === form.copyKey) ?? copies[0];
  const count = Math.max(2, Number(form.variantCount || 2));
  const selected = Array.from({ length: count }, (_, index) => form[`variantVersion.${index}`] ?? "");
  const splitTotal = Array.from({ length: count }, (_, index) => Number(form[`variantSplit.${index}`] || 0)).reduce((sum, split) => sum + split, 0);
  const signatures = selected.map((version) => audienceSignature(copy?.versions.find((item) => item.value === version))).filter(Boolean);
  const audienceConsistent = signatures.length === selected.length && new Set(signatures).size <= 1;
  const first = copy?.versions.find((item) => item.value === selected[0]);

  // 同 design-kit missingBusinessFields 的 copy-experiment-create。
  const missing: string[] = [];
  if (!form.copyKey?.trim()) missing.push("选择文案");
  const versions = Array.from({ length: Number(form.variantCount || 0) }, (_, index) => form[`variantVersion.${index}`]?.trim() ?? "");
  const splits = Array.from({ length: Number(form.variantCount || 0) }, (_, index) => Number(form[`variantSplit.${index}`]));
  if (!Number.isInteger(Number(form.variantCount || 0)) || Number(form.variantCount || 0) < 2) missing.push("至少选择 2 个不同的非草稿内容版本");
  if (versions.some((version) => !version) || new Set(versions).size !== versions.length) missing.push("至少选择 2 个不同的非草稿内容版本");
  const sigs = versions.map((version) => audienceSignature(copy?.versions.find((item) => item.value === version))).filter(Boolean);
  if (sigs.length === versions.length && new Set(sigs).size > 1) missing.push("所选版本的受众须一致");
  if (splits.some((split) => !Number.isInteger(split) || split <= 0 || split >= 100)) missing.push("每组分流为 1–99 的整数");
  if (splits.reduce((sum, split) => sum + split, 0) !== 100) missing.push("分流合计 100%");
  if ((form.note?.length ?? 0) > 255) missing.push("备注不超过 255 字");
  const blocked = missing.length ? `还缺：${[...new Set(missing)].join("、")}` : undefined;

  const changeCopy = (copyKey: string) => {
    const next = copies.find((item) => item.value === copyKey);
    setForm((current) => ({
      ...current,
      copyKey,
      variantCount: "2",
      "variantVersion.0": next?.versions[0]?.value ?? "",
      "variantSplit.0": "50",
      "variantVersion.1": next?.versions[1]?.value ?? "",
      "variantSplit.1": "50",
    }));
  };
  const removeVariant = (removeIndex: number) => {
    if (count <= 2) return;
    const next: BusinessFormValue = { ...form, variantCount: String(count - 1) };
    const remaining = count - 1;
    const base = Math.floor(100 / remaining);
    for (let index = 0; index < count - 1; index += 1) {
      const source = index >= removeIndex ? index + 1 : index;
      next[`variantVersion.${index}`] = form[`variantVersion.${source}`] ?? "";
      next[`variantSplit.${index}`] = String(base + (index === 0 ? 100 - base * remaining : 0));
    }
    delete next[`variantVersion.${count - 1}`];
    delete next[`variantSplit.${count - 1}`];
    setForm(next);
  };
  const addVariant = () => {
    if (!copy || count >= copy.versions.length) return;
    const unused = copy.versions.find((item) => !selected.includes(item.value));
    const nextCount = count + 1;
    const base = Math.floor(100 / nextCount);
    const next: BusinessFormValue = { ...form, variantCount: String(nextCount), [`variantVersion.${count}`]: unused?.value ?? "" };
    for (let index = 0; index < nextCount; index += 1) next[`variantSplit.${index}`] = String(base + (index === 0 ? 100 - base * nextCount : 0));
    setForm(next);
  };

  return (
    <>
      <Drawer open wide onClose={close} title="创建对比实验" icon={FlaskConical} tone="role-3"
        explain="创建后是待启动，要人点「启动」才开始分组。"
        footer={<Decision others={<Button onClick={close}>取消</Button>} primary={<Button variant="primary" disabledReason={blocked} onClick={() => onSubmit(form)}>创建实验</Button>} />}>
        <div className="rd-form-stack" data-business-form="copy-experiment-create">
          <Field label="文案" required explain="同一条文案至少要有两个非草稿版本，并且没有待启动或进行中的实验。">
            <Select aria-label="选择文案" value={copy?.value ?? ""} options={copies.map((item) => ({ value: item.value, label: item.label }))} onChange={changeCopy} />
          </Field>
          <h3 className="rd-form-group-title">各组看到的版本<span className="i1-split-total" data-ok={splitTotal === 100 ? "" : undefined}>分流合计 {splitTotal}%</span></h3>
          <div className="i1-variant-edit">
            {Array.from({ length: count }, (_, index) => {
              const letter = String.fromCharCode(65 + index);
              const current = selected[index];
              const taken = new Set(selected.filter((_, other) => other !== index));
              const preview = copy && current ? versionText(copy.value, current) : undefined;
              return (
                <div key={index} className="i1-variant-row" data-proof={`experiment-variant-${index}`}>
                  <span className="i1-variant-badge">{letter}</span>
                  <Field label={`${letter} 组版本`}>
                    <Select aria-label={`${letter} 组内容版本`} value={current} onChange={(next) => setForm((value) => ({ ...value, [`variantVersion.${index}`]: next }))}
                      options={(copy?.versions ?? []).map((item) => ({ value: item.value, label: item.label, disabled: item.value !== current && taken.has(item.value) }))} />
                  </Field>
                  <Field label="分流" help="1–99 的整数">
                    {(control) => <NumberInput {...control} aria-label={`${letter} 组分流比例`} unit="%" min={1} max={99} step={1} value={form[`variantSplit.${index}`] ?? ""} onChange={(event) => setForm((value) => ({ ...value, [`variantSplit.${index}`]: event.target.value }))} />}
                  </Field>
                  <IconButton aria-label={`移除 ${letter} 组`} disabled={count <= 2} onClick={() => removeVariant(index)}><Trash2 size={14} aria-hidden /></IconButton>
                  <p className="i1-variant-preview" data-user-content="">{preview ? nexGridBrandText(preview) : <span className="i1-weak">读不到这个版本的中文</span>}</p>
                </div>
              );
            })}
          </div>
          <div><Button size="sm" icon={<Plus size={14} aria-hidden />} disabledReason={!copy || count >= copy.versions.length ? "这条文案没有更多可选的版本" : undefined} onClick={addVariant}>添加一组</Button></div>
          <Facts>
            <Fact k="受众（沿用文案）">{audienceText(first)}</Fact>
            <Fact k="估算人数">{first?.estimatedAudience == null ? "—" : `约 ${first.estimatedAudience.toLocaleString()} 人（按现在的条件）`}</Fact>
          </Facts>
          {!audienceConsistent && <Notice tone="warn">所选版本的受众不一致，换成受众相同的版本。</Notice>}
          <Field label="实验备注" help="选填，最多 255 字">
            {(control) => <Input {...control} value={form.note ?? ""} maxLength={255} placeholder="想验证什么、看哪个指标" onChange={(event) => setForm((value) => ({ ...value, note: event.target.value }))} />}
          </Field>
        </div>
      </Drawer>
      {leaving && (
        <Modal title="放弃没保存的实验？" icon={FlaskConical} onClose={() => setLeaving(false)} footer={<>
          <Button onClick={() => setLeaving(false)}>继续编辑</Button>
          <Button variant="primary" onClick={onClose}>放弃</Button>
        </>}>
          <p>关掉后，这次选的版本和分流不会保留。</p>
        </Modal>
      )}
    </>
  );
}
