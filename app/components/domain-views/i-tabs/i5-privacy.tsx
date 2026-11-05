"use client";

/**
 * 隐私政策页签：只有一份文档，没有版本列表。保存时选状态：草稿不动公开版，发布和撤下填完理由立即生效（Q-08）。
 * 「正文版本」是给人看的版本号，「修订号」是防并发的内部计数，两个不能都叫版本（TX-04）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileCheck2, FilePen, FileText, Languages, Plus, RefreshCw, Trash2 } from "lucide-react";
import { BlockState, Button, Cell, Conclusion, Decision, DiffList, Drawer, Fact, Facts, Field, Fold, Input, Modal, Notice, NumberInput, Panel, Segments, Select, StatusTag, Table, TableMessage, Td, Textarea, Th, Tr } from "@/app/components/rd";
import { displayAdminError } from "@/lib/admin/error-messages";
import { fetchPrivacyPolicyAdmin, type PublishedContentDocument } from "@/lib/admin/published-content-client";
import { useUnsavedGuard } from "./i5-disclosures";
import { WRITE_LOCKED, type I5Writes } from "./i5-writes";
import type { ICtx } from "./types";

type Section = { id: string; title: string; body: string; order: number };
type Content = { hero: string; sections: Section[] };
type Doc = PublishedContentDocument;

const LOCALE_NAME: Record<string, string> = { zh: "中文", "zh-cn": "简体中文", en: "英语", vi: "越南语" };
const STATUS_NAME: Record<Doc["status"], string> = { DRAFT: "草稿", PUBLISHED: "已发布", UNPUBLISHED: "已撤下公开版本" };
const localeName = (key: string) => LOCALE_NAME[key] ?? key;
const contentOf = (doc: Doc, locale: string): Content => {
  const raw = doc.locales[locale] as Partial<Content> | undefined;
  return { hero: raw?.hero ?? "", sections: raw?.sections ?? [] };
};

export function PrivacyTab({ ctx, writes, canWrite, canPublish, nonce }: { ctx: ICtx; writes: I5Writes; canWrite: boolean; canPublish: boolean; nonce: number }) {
  const { openActionConfirm, toast } = ctx;
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDoc(await fetchPrivacyPolicyAdmin());
    } catch (cause) {
      setDoc(null);
      setError(displayAdminError(cause));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh, nonce]);

  const locales = doc ? Object.keys(doc.locales) : [];
  const writeBlocked = loading ? "正在读取最新数据，读完再操作" : writes.isLocked("privacy") ? WRITE_LOCKED : undefined;

  const save = (form: Doc) => {
    const baseline = doc!;
    const changedLocales = [...new Set([...Object.keys(form.locales), ...Object.keys(baseline.locales)])].filter((key) => JSON.stringify(form.locales[key]) !== JSON.stringify(baseline.locales[key]));
    const live = form.status !== "DRAFT";
    openActionConfirm({ briefKind: "content",
      action: <>{form.status === "PUBLISHED" ? "发布隐私政策" : form.status === "UNPUBLISHED" ? "撤下隐私政策公开版本" : "保存隐私政策草稿"} · {form.version}</>,
      detail: <>{live ? "填完理由立即生效，不走审批。" : "只保存草稿，公开版本不变。"}</>,
      amplifies: false,
      confirmTone: live ? "danger" : "primary",
      effect: live ? <StatusTag tone="progress" filled>立即生效</StatusTag> : <StatusTag tone="neutral" filled>保存草稿，线上不变</StatusTag>,
      confirmLabel: form.status === "PUBLISHED" ? "确认发布，立即生效" : form.status === "UNPUBLISHED" ? "确认撤下，立即生效" : "保存草稿",
      statedBrief: form.status === "PUBLISHED"
        ? { impact: "注册页和邀请页马上显示这个版本，没有译文的语言回退到英语。", check: "核对正文版本和改动的语言，只发布已审核的正文，理由写清依据。" }
        : form.status === "UNPUBLISHED"
          ? { impact: "公开版本立即撤下，注册页和邀请页读不到隐私政策。", check: "确认要下架，理由写清依据。" }
          : { impact: "只保存草稿，注册页和邀请页显示的内容不变。", check: "核对改动，理由写清修改依据。" },
      facts: <DiffList rows={[
        { key: "status", label: "状态", before: STATUS_NAME[baseline.status], after: STATUS_NAME[form.status] },
        { key: "version", label: "正文版本", before: baseline.version || "—", after: form.version },
        { key: "locales", label: "语言", before: Object.keys(baseline.locales).map(localeName).join("、") || "—", after: Object.keys(form.locales).map(localeName).join("、") },
        { key: "content", label: "有改动的语言", before: "—", after: changedLocales.map(localeName).join("、") || "—" },
      ]} />,
      reasonPlaceholder: "例如：法务审定稿，工单号",
      run: async (reason) => {
        const { version, status, locales: nextLocales, revision } = form;
        const result = await writes.send({ target: "privacy", label: `保存隐私政策 · ${version}`, op: { kind: "privacy", document: { version, status, locales: nextLocales, revision }, reason } });
        setEditing(false);
        if (result === "done") toast(live ? "隐私政策已更新，请核对公开页" : "草稿已保存，公开版本不变");
      },
    });
  };

  if (loading && !doc) return <Conclusion state="unknown">正在加载发布内容…</Conclusion>;
  if (!doc) return <BlockState state="error" title="公开内容状态尚未确认，请刷新重试。" detail={error ?? undefined} onRetry={() => void refresh()} retryLabel="刷新" />;

  const conclusion = doc.status === "PUBLISHED"
    ? <Conclusion state="ok" icon={FileCheck2}>隐私政策：已发布，正文版本 {doc.version}</Conclusion>
    : doc.status === "UNPUBLISHED"
      ? <Conclusion state="warn">隐私政策：已撤下公开版本，用户读不到</Conclusion>
      : doc.hasPublishedVersion
        ? <Conclusion state="neutral" icon={FilePen}>隐私政策：有草稿 {doc.version}，已有公开版，草稿不替换</Conclusion>
        : <Conclusion state="warn">隐私政策：有草稿 {doc.version}，暂无公开版</Conclusion>;

  return <div data-testid="published-content-privacyPolicy" className="rd-tab-stack">
    {conclusion}
    <Panel title="各语言内容" icon={Languages} tone="role-2" flush actions={<>
      <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={loading} disabled={editing} onClick={() => void refresh()}>刷新</Button>
      {canWrite && <Button variant="primary" size="sm" disabledReason={writeBlocked} onClick={() => { setViewing(null); setEditing(true); }}>编辑隐私政策</Button>}
    </>}>
      <Table label="各语言内容">
        <thead><tr><Th>语言</Th><Th>页面主说明</Th><Th align="right">段落</Th></tr></thead>
        <tbody>
          {locales.map((key) => {
            const content = contentOf(doc, key);
            return (
              <Tr key={key} selected={key === viewing} onOpen={() => setViewing(key)}>
                <Td><Cell main={localeName(key)} /></Td>
                <Td><Cell main={content.hero || "未填写"} title={content.hero} /></Td>
                <Td align="right"><Cell num main={content.sections.length} /></Td>
              </Tr>
            );
          })}
          {!locales.length && <TableMessage columns={3}>公开内容尚未加载，请刷新重试。</TableMessage>}
        </tbody>
      </Table>
    </Panel>
    <Fold title="技术信息" icon={FileText} tone="role-other" summary={`修订号 ${doc.revision}`}>
      <Facts><Fact k="状态">{STATUS_NAME[doc.status] ?? "状态待核实"}</Fact><Fact k="公开版本">{doc.hasPublishedVersion ? "已有公开版" : "暂无公开版"}</Fact></Facts>
    </Fold>

    <Drawer open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `隐私政策 · ${localeName(viewing)}` : ""} sub={doc.version} icon={FileText} tone="role-3">
      {viewing && <div className="rd-doc">
        <p>{contentOf(doc, viewing).hero}</p>
        {[...contentOf(doc, viewing).sections].sort((a, b) => a.order - b.order).map((section) => <section key={section.id}><h3>{section.title}</h3><p>{section.body}</p></section>)}
      </div>}
    </Drawer>

    {editing && <PrivacyEditor initial={doc} canPublish={canPublish} blockedReason={writeBlocked} onSave={save} onClose={() => setEditing(false)} />}
  </div>;
}

function PrivacyEditor({ initial, canPublish, blockedReason, onSave, onClose }: { initial: Doc; canPublish: boolean; blockedReason?: string; onSave: (form: Doc) => void; onClose: () => void }) {
  const [form, setForm] = useState(initial);
  const [locale, setLocale] = useState(Object.keys(initial.locales)[0] ?? "en");
  const [newLocale, setNewLocale] = useState("");
  const [localeError, setLocaleError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  const contentChanged = JSON.stringify(form.locales) !== JSON.stringify(initial.locales);
  useUnsavedGuard(dirty);
  const localeKeys = Object.keys(form.locales);
  const current = contentOf(form, locale);
  const setContent = (next: Content) => setForm((doc) => ({ ...doc, locales: { ...doc.locales, [locale]: next } }));
  const setSection = (index: number, patch: Partial<Section>) => setContent({ ...current, sections: current.sections.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  const addSection = () => {
    const ids = new Set(current.sections.map((section) => section.id.trim()));
    let suffix = current.sections.length + 1;
    while (ids.has(`section-${suffix}`)) suffix += 1;
    setContent({ ...current, sections: [...current.sections, { id: `section-${suffix}`, title: "", body: "", order: current.sections.length }] });
  };
  const addLocale = () => {
    const normalized = newLocale.trim().toLowerCase().replace("_", "-");
    if (!/^[a-z]{2}(?:-[a-z0-9]{2,8})?$/.test(normalized)) { setLocaleError("语言 格式无效，例如 en、zh、vi 或 zh-cn。"); return; }
    if (!form.locales[normalized] && localeKeys.length >= 10) { setLocaleError("最多维护 10 种语言。"); return; }
    setForm((doc) => ({ ...doc, locales: { ...doc.locales, [normalized]: doc.locales[normalized] ?? { hero: "", sections: [{ id: "section-1", title: "", body: "", order: 0 }] } } }));
    setLocale(normalized);
    setNewLocale("");
    setLocaleError(null);
  };
  const removeLocale = () => {
    const next = { ...form.locales };
    delete next[locale];
    setForm((doc) => ({ ...doc, locales: next }));
    setLocale(Object.keys(next)[0]);
  };
  const localeProblem = (key: string) => {
    const content = contentOf(form, key);
    const ids = content.sections.map((section) => section.id.trim());
    if (!content.hero.trim()) return "主说明";
    if (!content.sections.length) return "段落";
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return "段落 ID（不能空、不能重复）";
    if (content.sections.some((section) => !section.title.trim() || !section.body.trim())) return "段落标题或正文";
    if (content.sections.some((section) => !Number.isSafeInteger(section.order) || section.order < 0 || section.order > 100000)) return "段落顺序（0–100000 的整数）";
    return null;
  };
  const problems = localeKeys.flatMap((key) => { const problem = localeProblem(key); return problem ? [`${localeName(key)}的${problem}`] : []; });
  const needNewVersion = form.status === "PUBLISHED" && initial.status === "PUBLISHED" && contentChanged && form.version.trim() === initial.version;
  const saveBlocked = blockedReason
    ?? (!dirty ? "内容没有变化，无需提交。"
      : form.status !== "DRAFT" && !canPublish ? "发布或撤下隐私政策需要发布权限，请先改为草稿。"
        : form.status === "PUBLISHED" && !form.locales.en ? "发布隐私政策必须包含完整的 en 默认语言，供其他未发布语言回退使用；未完成的译文可先保存为草稿。"
          : !form.version.trim() ? "请填写正文版本"
            : !localeKeys.length ? "至少保留一种语言。"
              : needNewVersion ? "发布修改后的隐私政策需要新的版本号，请修改版本号后再发布。"
                : problems.length ? `还缺：${problems.slice(0, 3).join("、")}` : undefined);
  const saveLabel = form.status === "PUBLISHED" ? "保存并发布" : form.status === "UNPUBLISHED" ? "保存并撤下" : "保存草稿";
  const close = () => { if (dirty) setLeaving(true); else onClose(); };
  return <>
    <Drawer open wide onClose={close} title="编辑隐私政策" sub={`修订号 ${initial.revision}`} icon={FilePen} tone="role-1"
      footer={<Decision note={form.status === "DRAFT" ? "草稿保留当前公开版本。" : "保存后立即生效，请仅发布已审核正文。"} others={<Button onClick={close}>取消</Button>} primary={<Button variant="primary" disabledReason={saveBlocked} onClick={() => onSave(form)}>{saveLabel}</Button>} />}>
      <div className="rd-form-stack">
        <div className="rd-form-grid">
          <Field label="正文版本" required error={needNewVersion ? "发布修改后的隐私政策需要新的版本号，请修改版本号后再发布。" : undefined}>{(control) => <Input {...control} maxLength={64} value={form.version} onChange={(event) => setForm((doc) => ({ ...doc, version: event.target.value }))} />}</Field>
          <Field label="保存后状态"><Select aria-label="保存后状态" value={form.status} options={[
            { value: "DRAFT", label: "草稿" },
            { value: "PUBLISHED", label: "已发布", disabled: !canPublish },
            { value: "UNPUBLISHED", label: "已撤下公开版本", disabled: !canPublish },
          ]} onChange={(next) => setForm((doc) => ({ ...doc, status: next as Doc["status"] }))} /></Field>
        </div>
        <div className="rd-form-grid">
          <Field label="新增语言" error={localeError}>{(control) => <div className="rd-inline-form"><Input {...control} placeholder="例如 vi、zh-cn" maxLength={11} value={newLocale} onChange={(event) => setNewLocale(event.target.value)} /><Button size="sm" onClick={addLocale}>新增语言</Button></div>}</Field>
        </div>
        {localeKeys.length > 0 && <>
          <div className="rd-inline-form rd-inline-form-between">
            <Segments label="内容语言" value={locale} onChange={setLocale} items={localeKeys.map((key) => ({ value: key, label: localeName(key), tone: localeProblem(key) ? "warn" as const : undefined }))} />
            <Button size="sm" variant="danger-outline" disabledReason={localeKeys.length <= 1 ? "至少保留一种语言。" : undefined} onClick={removeLocale}>删除当前语言</Button>
          </div>
          <Field label="页面主说明" required>{(control) => <Textarea {...control} rows={3} maxLength={500} value={current.hero} onChange={(event) => setContent({ ...current, hero: event.target.value })} />}</Field>
          <h3 className="rd-form-group-title">规则段落 · {current.sections.length} 段</h3>
          {current.sections.map((section, index) => (
            <Fold key={index} inset title={section.title || `第 ${index + 1} 段（未填标题）`} summary={section.body ? `${section.body.length} 字` : "未填写"} defaultOpen={!section.title || !section.body}>
              <div className="rd-form-stack">
                <div className="rd-form-grid">
                  <Field label="ID" required>{(control) => <Input {...control} maxLength={64} value={section.id} onChange={(event) => setSection(index, { id: event.target.value })} />}</Field>
                  <Field label="顺序">{(control) => <NumberInput {...control} aria-label="顺序" min={0} max={100000} step={1} value={String(section.order)} onChange={(event) => setSection(index, { order: Number(event.target.value) })} />}</Field>
                </div>
                <Field label="标题" required>{(control) => <Input {...control} maxLength={256} value={section.title} onChange={(event) => setSection(index, { title: event.target.value })} />}</Field>
                <Field label="正文" required>{(control) => <Textarea {...control} rows={5} maxLength={10000} value={section.body} onChange={(event) => setSection(index, { body: event.target.value })} />}</Field>
                <div><Button size="sm" variant="danger-outline" icon={<Trash2 size={14} aria-hidden />} onClick={() => setContent({ ...current, sections: current.sections.filter((_, itemIndex) => itemIndex !== index) })}>删除段落</Button></div>
              </div>
            </Fold>
          ))}
          <div><Button size="sm" icon={<Plus size={14} aria-hidden />} disabledReason={current.sections.length >= 100 ? "最多 100 段" : undefined} onClick={addSection}>新增段落</Button></div>
          <Fold inset title="变更预览（只读）" summary={`${localeName(locale)}的结构化内容`}><pre className="rd-json">{JSON.stringify(form.locales[locale], null, 2)}</pre></Fold>
        </>}
        {!localeKeys.length && <Notice tone="warn" title="还没有语言">先在上面新增一种语言。</Notice>}
      </div>
    </Drawer>
    {leaving && (
      <Modal title="有未保存的修改" onClose={() => setLeaving(false)} footer={<>
        <Button onClick={() => setLeaving(false)}>继续编辑</Button>
        <Button variant="danger-outline" onClick={onClose}>放弃改动</Button>
        <Button variant="primary" disabledReason={saveBlocked} onClick={() => { setLeaving(false); onSave(form); }}>{saveLabel}</Button>
      </>}><p>关闭后这次的修改不会保留。</p></Modal>
    )}
  </>;
}
