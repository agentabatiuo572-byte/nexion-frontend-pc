"use client";

/**
 * I2 的三个填写抽屉：频道、模板、事件概率。只画表单，表单值、校验结果和提交都由 i2-nova.tsx 传进来，
 * 提交内容和改版前一样（频道直接保存，模板和概率再进共用确认框写理由）。
 */
import { FileText, Percent, Radio } from "lucide-react";
import { Button, Decision, Drawer, Field, Input, Notice, NumberInput, Select, StatusTag, Textarea } from "@/app/components/rd";
import { formatNovaDuration, NOVA_TIME_UNITS, type NovaTimeUnit } from "@/lib/admin/nova-cadence";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import type { NovaOptionView, NovaSocialEventView } from "@/lib/admin/i-client";
import { AppNotice, DistEditor, noticeCategory, DIST_SLOT, NO_SOURCE, PLACEHOLDERS, PLACEHOLDER_TEXT, cooldownSentence, placeholdersOf, previewText, tickSentence } from "./i2-parts";

export const UNREACHABLE_CTA = new Set(["/devices", "/support", "/me/weekly"]);
export const UNREACHABLE_TEXT = "App 目前打不开这个去向";
export const ctaLabel = (options: readonly NovaOptionView[], value: string) => {
  const found = options.find((option) => option.value === value);
  return found ? operatorCopyText(found.label) : value || "—";
};

export type ChannelFormValue = { name: string; runtimeSource: string; tickValue: string; tickUnit: NovaTimeUnit; cooldownValue: string; cooldownUnit: NovaTimeUnit };

export function ChannelDrawer({ editing, form, setForm, cadenceError, sources, fixedSource, locked, saving, blocked: requestBlocked, retry, error, onClose, onSubmit }: {
  editing: boolean;
  form: ChannelFormValue;
  setForm: (next: ChannelFormValue) => void;
  cadenceError: string | null;
  sources: readonly NovaOptionView[];
  /** 编辑固定频道：取材不能改，这里写它现在的取材。 */
  fixedSource?: string;
  locked?: boolean;
  saving?: boolean;
  blocked?: string;
  /** 结果未知后冻结的原请求：主按钮改叫「按原请求重试」。 */
  retry?: boolean;
  /** 后端明确拒绝时的原因，抽屉不关、输入保留。 */
  error?: string | null;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const name = form.name.trim();
  const blocked = requestBlocked || (!name ? "填写频道名称" : !editing && !form.runtimeSource ? "选择从哪类事情取材" : cadenceError ? "多久找一次、同一个人至少隔多久没填好" : undefined);
  // 校验规则仍是 validateNovaCadence，这里只把它的话换成这个抽屉里的字段名。
  const CADENCE_TEXT: Record<string, [field: "tick" | "cooldown", text: string]> = {
    "请填写检查间隔": ["tick", "填写多久找一次"],
    "检查间隔必须是正整数": ["tick", "要填正整数"],
    "请填写同一用户最短推送间隔": ["cooldown", "填写同一个人至少隔多久"],
    "同一用户最短推送间隔必须是正整数": ["cooldown", "要填正整数"],
    "同一用户最短推送间隔不能小于检查间隔": ["cooldown", "现在比「多久找一次」短"],
  };
  const shown = (form.tickValue || form.cooldownValue) && cadenceError ? CADENCE_TEXT[cadenceError] ?? ["cooldown", cadenceError] : null;
  const unitOptions = NOVA_TIME_UNITS.map((unit) => ({ value: unit.value, label: unit.label }));
  return (
    <Drawer open busy={saving} onClose={onClose} title={editing ? "编辑频道" : "新增频道"} icon={Radio} tone="role-2"
      explain={<>
        <p>系统按「多久找一次」扫描；有满足条件的业务事情、这个人又过了个人间隔，才给他发一条。</p>
        <p>点击率不用填，新频道从 0% 开始。</p>
      </>}
      footer={<Decision primary={<Button variant="primary" loading={saving} disabledReason={blocked} onClick={onSubmit}>{retry ? "按原请求重试" : editing ? "保存" : "新增频道"}</Button>} />}>
      <div className="rd-stack i2-form">
        {error && <Notice tone="danger" title={editing ? "没有保存" : "没有新增"}>{error}</Notice>}
        {retry && <Notice tone="warn" title="结果未知">原请求已冻结，只能按原请求重试或在页面上方查询原结果。</Notice>}
        {!editing && !retry && <Notice tone="progress">新增后是停用的：先给它写好模板并发布，再启用。</Notice>}
        <Field label="频道名称" required>
          <Input disabled={locked} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：每周回顾" />
        </Field>
        <Field label="从哪类事情取材" required={!editing} explain="只能从系统里登记过的业务事件里选，不能手填。">
          {fixedSource !== undefined
            ? <Input value={fixedSource} readOnly aria-readonly />
            : <Select disabled={locked} aria-label="从哪类事情取材" value={form.runtimeSource} onChange={(value) => setForm({ ...form, runtimeSource: value })} placeholder="请选择"
              options={sources.map((option) => ({ value: option.value, label: operatorCopyText(option.label) }))} />}
        </Field>
        <Field label="多久找一次" required hint="正整数" explain="只决定系统多久检查一次，不是多久发一条。" error={shown?.[0] === "tick" ? shown[1] : undefined}>
          {(control) => <span className="i2-duration">
            <NumberInput {...control} disabled={locked} min={1} step={1} value={form.tickValue} onChange={(e) => setForm({ ...form, tickValue: e.target.value })} placeholder="10" />
            <Select disabled={locked} aria-label="多久找一次的单位" value={form.tickUnit} onChange={(value) => setForm({ ...form, tickUnit: value as NovaTimeUnit })} options={unitOptions} />
          </span>}
        </Field>
        <Field label="同一个人至少隔多久" required hint="正整数" explain="同一个人收到这个频道一条后，这段时间内不再收到；不能比「多久找一次」短。" error={shown?.[0] === "cooldown" ? shown[1] : undefined}>
          {(control) => <span className="i2-duration">
            <NumberInput {...control} disabled={locked} min={1} step={1} value={form.cooldownValue} onChange={(e) => setForm({ ...form, cooldownValue: e.target.value })} placeholder="6" />
            <Select disabled={locked} aria-label="同一个人至少隔多久的单位" value={form.cooldownUnit} onChange={(value) => setForm({ ...form, cooldownUnit: value as NovaTimeUnit })} options={unitOptions} />
          </span>}
        </Field>
        {!cadenceError && <p className="i2-sentence">{`${tickSentence(formatNovaDuration(form.tickValue, form.tickUnit))}，${cooldownSentence(formatNovaDuration(form.cooldownValue, form.cooldownUnit))}。`}</p>}
      </div>
    </Drawer>
  );
}

export type TemplateFormValue = { channel: string; name: string; cta: string; version: string; titleZh: string; bodyZh: string; titleVi: string; bodyVi: string; titleEn: string; bodyEn: string };
type Locale = "Zh" | "Vi" | "En";
const LOCALES: readonly { key: Locale; lang: "ZH" | "VI" | "EN"; label: string; required: boolean }[] = [
  { key: "Zh", lang: "ZH", label: "中文", required: true },
  { key: "Vi", lang: "VI", label: "越南语", required: true },
  { key: "En", lang: "EN", label: "英语", required: false },
];

/** 三语里正文变量对不上、用了不认识的变量：只提醒，后端保存时会再查。 */
export function templateIssues(form: TemplateFormValue) {
  const sets = LOCALES.filter((l) => l.required || form[`body${l.key}`].trim()).map((l) => ({ label: l.label, vars: placeholdersOf(form[`body${l.key}`]) }));
  const all = [...new Set(sets.flatMap((s) => s.vars))];
  const mismatch = all.length ? sets.filter((s) => all.some((v) => !s.vars.includes(v))).map((s) => `${s.label}少了 ${all.filter((v) => !s.vars.includes(v)).join("、")}`) : [];
  const used = [...new Set(LOCALES.flatMap((l) => [...placeholdersOf(form[`title${l.key}`]), ...placeholdersOf(form[`body${l.key}`])]))];
  const unknown = used.filter((v) => !(PLACEHOLDERS as readonly string[]).includes(v));
  return { mismatch, unknown, used };
}

export function TemplateDrawer({ editing, form, setForm, channels, ctaOptions, social, sample, blocked, onClose, onSubmit }: {
  editing: boolean;
  form: TemplateFormValue;
  setForm: (next: TemplateFormValue) => void;
  channels: readonly { value: string; label: string }[];
  ctaOptions: readonly NovaOptionView[];
  /** 选的是真实动态频道：变量会换成真实事件的内容。 */
  social: boolean;
  sample: NovaSocialEventView | null;
  blocked?: string;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const issues = templateIssues(form);
  const enPair = !!form.titleEn.trim() !== !!form.bodyEn.trim();
  const ctaNote = UNREACHABLE_CTA.has(form.cta) ? <StatusTag tone="warn">{UNREACHABLE_TEXT}</StatusTag> : undefined;
  return (
    <Drawer open wide onClose={onClose} title={editing ? "编辑模板" : "新建模板"} icon={FileText} tone="role-4" sub={editing ? form.name : undefined}
      explain={<>
        <p>用户收到的标题和正文以模板为底：发送时可能替换变量、按长度截断，没填的语言用通用提示；已发出的通知不跟着改。保存后是草稿，发布后频道才用它。</p>
        <p>App 里标题最多显示 128 字、正文 512 字，按用户账户的语言选一种。</p>
      </>}
      footer={<Decision primary={<Button variant="primary" disabledReason={blocked} onClick={onSubmit}>保存草稿</Button>} />}>
      <div className="rd-stack i2-form">
        <div className="rd-form-grid i2-tpl-grid" data-cols="4">
          <Field label="频道" required explain={editing ? "一个频道只有一个模板，编辑时不能换频道。" : "只列出还没有模板的频道。"}>
            <Select aria-label="频道" value={form.channel} disabled={editing} onChange={(value) => setForm({ ...form, channel: value })} placeholder={channels.length ? "请选择" : "所有频道都有模板了"} options={channels} />
          </Field>
          <Field label="模板名称" required hint="最多 128 字">
            <Input value={form.name} maxLength={128} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：每周回顾提醒" />
          </Field>
          <Field label="版本" required hint="最多 32 字">
            <Input value={form.version} maxLength={32} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="v1" />
          </Field>
          <Field label="点击后去哪" required error={UNREACHABLE_CTA.has(form.cta) ? UNREACHABLE_TEXT : undefined}>
            <Select aria-label="点击后去哪" value={form.cta} onChange={(value) => setForm({ ...form, cta: value })} placeholder="请选择"
              options={ctaOptions.map((option) => ({ value: option.value, label: `${operatorCopyText(option.label)}${UNREACHABLE_CTA.has(option.value) ? "（App 打不开）" : ""}` }))} />
          </Field>
        </div>

        <div className="i2-vars">
          <span className="i2-vars-k">可用变量</span>
          {PLACEHOLDERS.map((v) => <code key={v} title={PLACEHOLDER_TEXT[v]} data-used={issues.used.includes(v) ? "" : undefined}>{v}</code>)}
          <span className="i2-vars-note">{social ? "真实动态频道发送时换成真实事件的内容" : "只有真实动态频道会替换变量"}</span>
        </div>
        {!social && issues.used.length > 0 && <Notice tone="warn">{`这个频道的变量目前不会被替换，用户会看到原样的 ${issues.used.join("、")}。`}</Notice>}
        {issues.unknown.length > 0 && <Notice tone="warn">{`不认识的变量：${issues.unknown.join("、")}，保存会被拒。`}</Notice>}
        {issues.mismatch.length > 0 && <Notice tone="warn">{`三种语言正文里的变量要一样：${issues.mismatch.join("；")}。`}</Notice>}

        <div className="i2-langs">
          {LOCALES.map((l) => {
            const title = form[`title${l.key}`];
            const body = form[`body${l.key}`];
            const filled = !!title.trim() && !!body.trim();
            const shown = social ? previewText(title, body, l.lang, sample) : { title, body };
            return (
              <section key={l.key} className="i2-lang" aria-label={l.label}>
                <h3 className="i2-lang-head">{l.label}{filled ? <StatusTag tone="ok">已填</StatusTag> : l.required ? <StatusTag tone="warn">缺</StatusTag> : <StatusTag tone="done">可选，未填</StatusTag>}</h3>
                <Field label="标题" required={l.required} error={l.key === "En" && enPair && !title.trim() ? "英语标题和正文要么都填，要么都空" : undefined}>
                  <Input value={title} maxLength={255} onChange={(e) => setForm({ ...form, [`title${l.key}`]: e.target.value })} placeholder={`${l.label}标题`} />
                </Field>
                <Field label="正文" required={l.required} error={l.key === "En" && enPair && !body.trim() ? "英语标题和正文要么都填，要么都空" : undefined}>
                  {(control) => <Textarea {...control} rows={4} maxLength={4000} value={body} count={`${body.length}/4000`} onChange={(e) => setForm({ ...form, [`body${l.key}`]: e.target.value })} placeholder={l.key === "Zh" ? "例如：{actor} 在 {city} 刚刚提现到账 {amount}" : `${l.label}正文`} />}
                </Field>
                <AppNotice lang={l.lang} title={shown.title} body={shown.body} cta={form.cta} ctaNote={ctaNote} raw={!social} category={noticeCategory(form.channel)}
                  missing={filled ? undefined : l.required ? `${l.label}还没填，发布前要补上` : "没填英语：中文、越南语以外的用户收到通用英文提示，有译文的语言用译文"} />
              </section>
            );
          })}
        </div>
        <p className="i2-sentence">{social
          ? sample ? `预览用最近一条真实事件 #${sample.id} 填进变量，只在这里显示，不会发出。` : "现在没有可用的真实事件，预览里变量原样显示。"
          : "预览是示意：变量原样显示，实际按 App 截断。"}</p>
      </div>
    </Drawer>
  );
}

export function DistDrawer({ items, draft, setDraft, total, valid, onClose, onSubmit }: {
  items: readonly { key: string; name: string; pct: number }[];
  draft: Record<string, string>;
  setDraft: (next: Record<string, string>) => void;
  total: number;
  valid: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Drawer open onClose={onClose} title="调整事件概率" icon={Percent} tone="role-2"
      explain={<>
        <p>真实动态每次先按这组概率选一类，再从这一类有效的事件里随机取一条。</p>
        <p>五类一起保存，合计必须是 100%；改一类不会自动调别的类。</p>
      </>}
      footer={<Decision note={<span className="rd-toolbar-note" data-tone={valid ? undefined : "warn"}>{`合计 ${total}%`}</span>}
        primary={<Button variant="primary" disabledReason={valid ? undefined : `每项填 0–100 的整数，合计要等于 100%（现在 ${total}%）`} onClick={onSubmit}>保存概率</Button>} />}>
      <div className="rd-stack i2-form">
        <DistEditor items={items} values={draft} onChange={setDraft} />
        <div className="i2-dist-rows">
          {items.map((item) => (
            <Field key={item.key} label={<span className="i2-dist-name"><span className="rd-chart-swatch" data-slot={DIST_SLOT[item.key] ?? "other"} aria-hidden />{operatorCopyText(item.name)}</span>}
              hint={`现在 ${item.pct}%`} explain={item.key === NO_SOURCE ? "没有真实数据源，设了概率也抽不到。" : undefined}>
              <NumberInput unit="%" min={0} max={100} step={1} value={draft[item.key] ?? ""} onChange={(e) => setDraft({ ...draft, [item.key]: e.target.value })} />
            </Field>
          ))}
        </div>
      </div>
    </Drawer>
  );
}
