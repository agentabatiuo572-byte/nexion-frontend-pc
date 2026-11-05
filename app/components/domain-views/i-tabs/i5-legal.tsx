"use client";

/**
 * 法律条款页签：按语言和适用法律地区看版本。填理由直接生效，不走审批（Q-08）。
 * 当前生效和草稿分开放；版本详情和草稿编辑用抽屉（PG-47）。理由在确认框里填（OP-24），发布只发已保存的内容（OP-26）。
 * 既有多节草稿能改每节内容，不增删节；新建草稿只有一节，单节草稿不替换七节版本（PG-59、OPS-16）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FileCheck2, FilePen, FileText, History, RefreshCw, Scale } from "lucide-react";
import { BlockState, Button, Cell, Conclusion, Decision, Drawer, Explain, Fact, Facts, Field, FilterField, Fold, Input, Modal, Notice, Panel, Select, StatusTag, Table, TableMessage, Td, Textarea, Th, Tr, type StateTone } from "@/app/components/rd";
import { displayAdminError } from "@/lib/admin/error-messages";
import { fetchLegalTermsAdmin, type LegalTermsSection, type LegalTermsVersion } from "@/lib/admin/legal-terms-client";
import { currentLegalTermsDateTime, normalizeLegalTermsDateTime } from "@/lib/admin/legal-terms-contract";
import { useUnsavedGuard } from "./i5-disclosures";
import { WRITE_LOCKED, type I5Writes } from "./i5-writes";
import type { ICtx } from "./types";

const LOCALE_OPTIONS = [{ value: "en", label: "英文" }, { value: "zh", label: "中文" }, { value: "vi", label: "越南语" }];
const localeName = (value: string) => LOCALE_OPTIONS.find((item) => item.value === value)?.label ?? value;
const STATUS: Record<string, { text: string; tone: StateTone }> = {
  DRAFT: { text: "草稿", tone: "neutral" },
  PUBLISHED: { text: "已发布", tone: "ok" },
  SUPERSEDED: { text: "历史版本", tone: "done" },
  REVOKED: { text: "已撤回", tone: "warn" },
};
const statusOf = (row: LegalTermsVersion) => STATUS[row.status] ?? { text: "版本状态待核实", tone: "warn" as StateTone };
const validTime = (value: string) => { try { normalizeLegalTermsDateTime(value); return true; } catch { return false; } };

function scopeProblem(jurisdiction: string) {
  if (!jurisdiction) return "请填写适用法律地区，例如 GLOBAL。";
  return /^[A-Z][A-Z0-9_-]{1,15}$/.test(jurisdiction) ? null : "适用法律地区需为 2–16 位，以字母开头，只含字母、数字、下划线或短横线。";
}

export function LegalTab({ ctx, writes, canWrite, canPublish, nonce }: { ctx: ICtx; writes: I5Writes; canWrite: boolean; canPublish: boolean; nonce: number }) {
  const { openActionConfirm, toast } = ctx;
  const [locale, setLocale] = useState("en");
  const [jurisdictionInput, setJurisdictionInput] = useState("GLOBAL");
  const [jurisdiction, setJurisdiction] = useState("GLOBAL");
  const scopeError = scopeProblem(jurisdictionInput.trim().toUpperCase());
  const [rows, setRows] = useState<LegalTermsVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [viewing, setViewing] = useState<number | null>(null);
  const [editing, setEditing] = useState<LegalTermsVersion | null>(null);
  const requestSequence = useRef(0);
  const target = `legal:${locale}:${jurisdiction}`;

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setError(null);
    setRows([]);
    setViewing(null);
    setBusy(true);
    try {
      const value = await fetchLegalTermsAdmin(locale, jurisdiction);
      if (sequence === requestSequence.current) setRows(value);
    } catch (cause) {
      if (sequence === requestSequence.current) setError(displayAdminError(cause));
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }, [locale, jurisdiction]);
  useEffect(() => {
    void refresh();
    return () => { requestSequence.current += 1; };
  }, [refresh, nonce]);

  const applyScope = () => {
    const next = jurisdictionInput.trim().toUpperCase();
    setJurisdictionInput(next);
    if (!scopeProblem(next)) setJurisdiction(next);
  };

  const published = rows.find((row) => row.status === "PUBLISHED") ?? null;
  const drafts = rows.filter((row) => row.status === "DRAFT");
  const history = rows.filter((row) => row.status !== "PUBLISHED" && row.status !== "DRAFT");
  const shown = viewing === null ? null : rows.find((row) => row.id === viewing) ?? null;
  const scopeText = `${localeName(locale)} · ${jurisdiction}`;
  const writeBlocked = busy ? "正在读取最新数据，读完再操作" : error ? "当前范围的条款尚未确认，请刷新重试。" : writes.isLocked(target) ? WRITE_LOCKED : undefined;

  const newDraft = () => {
    const next = rows.reduce((max, row) => Math.max(max, Number(/^v(\d+)/.exec(row.version)?.[1] ?? 0)), 0) + 1;
    setViewing(null);
    setEditing({ id: 0, locale, jurisdiction, version: `v${next}`, effectiveAt: currentLegalTermsDateTime(), status: "DRAFT", title: "", summary: "", sections: [{ key: "general", title: "", body: "", sortOrder: 10 }], revision: 0, publishedAt: null, revokedAt: null });
  };

  const saveDraft = (form: LegalTermsVersion) => openActionConfirm({ briefKind: "content",
    action: <>保存法律条款草稿 · {form.version}</>,
    detail: <>只保存草稿，用户看到的条款不变。</>,
    amplifies: false,
    effect: <StatusTag tone="neutral" filled>保存草稿，线上不变</StatusTag>,
    confirmLabel: "保存草稿",
    statedBrief: { impact: "只保存草稿，用户看到的条款不变。", check: "核对标题、摘要和每节正文，理由写清修改依据。" },
    facts: <Facts><Fact k="范围">{scopeText}</Fact><Fact k="草稿">{form.version} · {form.sections.length} 节</Fact></Facts>,
    reasonPlaceholder: "例如：法务要求更新第 3 节",
    run: async (reason) => {
      const result = await writes.send({ target, label: `保存法律条款草稿 · ${scopeText} ${form.version}`, op: { kind: "legal-save", body: {
        locale: form.locale, jurisdiction: form.jurisdiction, version: form.version, effectiveAt: form.effectiveAt, title: form.title, summary: form.summary, sections: form.sections, expectedRevision: form.revision, reason,
      } } });
      setEditing(null);
      if (result === "done") toast("草稿已保存，用户看到的条款不变");
    },
  });

  const publish = (row: LegalTermsVersion) => {
    const fewer = published && row.sections.length < published.sections.length;
    openActionConfirm({ briefKind: "content",
      action: <>发布法律条款 · {row.version}</>,
      detail: <>发布已保存的草稿，填完理由立即生效，不走审批。</>,
      amplifies: false,
      confirmTone: "danger",
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: "确认发布，立即生效",
      statedBrief: { impact: `这个版本立即替换 ${scopeText} 的公开条款，旧发布版转为历史版本。发布后不能再改。`, check: "核对版本、节数和生效时间，理由写清发布依据。" },
      facts: <>
        <Facts><Fact k="范围">{scopeText}</Fact><Fact k="版本">{published ? `${published.version}（${published.sections.length} 节）` : "无已发布版本"} → {row.version}（{row.sections.length} 节）</Fact><Fact k="生效时间">{row.effectiveAt}</Fact></Facts>
        {fewer && <Notice tone="warn" title={`节数变少：${published.sections.length} 节 → ${row.sections.length} 节`}>单节草稿不能替换完整条款。发布前核对节数，系统不会拦。</Notice>}
      </>,
      reasonPlaceholder: "例如：法务审定稿，工单号",
      run: async (reason) => {
        const result = await writes.send({ target, label: `发布法律条款 · ${scopeText} ${row.version}`, op: { kind: "legal-transition", action: "publish", row, reason } });
        setEditing(null);
        setViewing(null);
        if (result === "done") toast("条款已发布，请核对公开版本");
      },
    });
  };

  const revoke = (row: LegalTermsVersion) => openActionConfirm({ briefKind: "content",
    action: <>撤回法律条款 · {row.version}</>,
    detail: <>撤回当前发布版本，填完理由立即生效，不走审批。</>,
    amplifies: false,
    confirmTone: "danger",
    effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
    confirmLabel: "确认撤回，立即生效",
    statedBrief: { impact: `${scopeText} 的公开条款立即下架，不能恢复这个版本。${locale === "en" && jurisdiction === "GLOBAL" ? "这是最后的回退范围，撤回后用户读不到英文条款，其他语言回退到这里的也读不到。" : "App 改读英文或 GLOBAL 的已发布版本，都没有时用户读不到条款。"}`, check: "确认要下架线上条款，理由写清依据。" },
    facts: <Facts><Fact k="范围">{scopeText}</Fact><Fact k="版本">{row.version} · {row.title}</Fact><Fact k="状态">已发布 → 已撤回</Fact></Facts>,
    reasonPlaceholder: "例如：条款有误，法务要求下架",
    run: async (reason) => {
      const result = await writes.send({ target, label: `撤回法律条款 · ${scopeText} ${row.version}`, op: { kind: "legal-transition", action: "revoke", row, reason } });
      setViewing(null);
      if (result === "done") toast("条款已撤回");
    },
  });

  const conclusion = busy ? <Conclusion state="unknown">正在加载条款…</Conclusion>
    : error ? null
      : !rows.length ? <Conclusion state="warn">当前适用地区暂无条款版本。</Conclusion>
        : !published ? <Conclusion state="warn">{scopeText}：没有已发布版本，应用暂不提供该内容</Conclusion>
          : drafts.length ? <Conclusion state="neutral" icon={FilePen}>{scopeText}：{published.version} 生效中，有 {drafts.length} 个草稿待发布</Conclusion>
            : <Conclusion state="ok" icon={FileCheck2}>{scopeText}：{published.version} 生效中，没有草稿</Conclusion>;

  const openRow = (row: LegalTermsVersion) => {
    if (row.status === "DRAFT" && canWrite) { setViewing(null); setEditing(row); }
    else setViewing(row.id);
  };

  return <div data-testid="legal-terms-editor" className="rd-tab-stack">
    <div className="rd-scope-bar">
      <FilterField label="语言"><Select aria-label="语言" value={locale} options={LOCALE_OPTIONS} disabled={!!editing} onChange={setLocale} /></FilterField>
      <FilterField label={<span>适用法律地区 <Explain label="适用法律地区是什么" content="按这个代码读条款，大写字母开头，默认 GLOBAL。回车或离开输入框后读取。" /></span>}>
        <Input aria-label="适用法律地区" value={jurisdictionInput} maxLength={32} aria-invalid={!!scopeError} disabled={!!editing} onChange={(event) => setJurisdictionInput(event.target.value)} onBlur={applyScope} onKeyDown={(event) => { if (event.key === "Enter") applyScope(); }} />
      </FilterField>
      <Button variant="ghost" icon={<RefreshCw size={14} aria-hidden />} loading={busy} disabled={!!scopeError || !!editing} onClick={() => void refresh()}>刷新</Button>
    </div>
    {scopeError && <Notice tone="warn" title="请先完成适用法律地区，再加载条款。">{scopeError}</Notice>}
    {conclusion}
    {error && !busy && <BlockState state="error" title="当前范围的条款尚未确认，请刷新重试。" detail={error} onRetry={() => void refresh()} retryLabel="刷新" />}

    {!error && !busy && <>
      <Panel title="当前生效版本" icon={Scale} tone="role-2" actions={published ? <>
        <Button size="sm" onClick={() => setViewing(published.id)}>查看全文</Button>
        {canPublish && <Button size="sm" variant="danger-outline" disabledReason={writeBlocked} onClick={() => revoke(published)}>撤回</Button>}
      </> : undefined}>
        {published ? <Facts>
          <Fact k="版本">{published.version} · {published.sections.length} 节</Fact>
          <Fact k="生效时间">{published.effectiveAt}</Fact>
          <Fact k="标题">{published.title}</Fact>
        </Facts> : <BlockState state="empty" compact title="当前适用地区暂无有效条款版本，应用暂不提供该内容。" />}
      </Panel>

      <Panel title="草稿" icon={FilePen} tone="role-1" flush={drafts.length > 0} actions={canWrite ? <Button variant="primary" size="sm" disabledReason={writeBlocked} onClick={newDraft}>新建草稿</Button> : undefined}>
        {drafts.length ? (
          <Table label="法律条款草稿">
            <thead><tr><Th>版本</Th><Th>标题</Th><Th>生效时间</Th><Th>操作</Th></tr></thead>
            <tbody>
              {drafts.map((row) => (
                <Tr key={row.id} onOpen={() => openRow(row)}>
                  <Td><Cell main={row.version} sub={`${row.sections.length} 节`} /></Td>
                  <Td><Cell main={row.title || "未填写"} /></Td>
                  <Td><Cell num main={row.effectiveAt} /></Td>
                  <Td><span className="rd-row-actions">
                    {canWrite && <Button size="sm" disabledReason={writeBlocked} onClick={() => openRow(row)}>编辑</Button>}
                    {canPublish && <Button size="sm" disabledReason={writeBlocked} onClick={() => publish(row)}>发布</Button>}
                  </span></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : <BlockState state="empty" compact title="没有草稿" />}
      </Panel>

      <Fold title="版本历史" icon={History} tone="role-3" summary={history.length ? `${history.length} 个历史或已撤回版本` : "没有历史版本"}>
        <Table label="法律条款版本历史">
          <thead><tr><Th>版本</Th><Th>状态</Th><Th>标题</Th><Th>生效时间</Th></tr></thead>
          <tbody>
            {history.map((row) => (
              <Tr key={row.id} selected={row.id === viewing} onOpen={() => setViewing(row.id)}>
                <Td><Cell main={row.version} sub={`${row.sections.length} 节`} /></Td>
                <Td><StatusTag tone={statusOf(row).tone}>{statusOf(row).text}</StatusTag></Td>
                <Td><Cell main={row.title} /></Td>
                <Td><Cell num main={row.effectiveAt} /></Td>
              </Tr>
            ))}
            {!history.length && <TableMessage columns={4}>这个范围没有历史版本。</TableMessage>}
          </tbody>
        </Table>
      </Fold>
    </>}

    <Drawer open={!!shown} onClose={() => setViewing(null)} title={shown ? `法律条款 · ${shown.version}` : ""} sub={shown ? scopeText : undefined} icon={FileText} tone="role-3"
      footer={shown?.status === "PUBLISHED" && canPublish ? <Decision danger={<Button variant="danger-outline" disabledReason={writeBlocked} onClick={() => revoke(shown)}>撤回</Button>} />
        : shown?.status === "DRAFT" && canPublish ? <Decision primary={<Button variant="primary" disabledReason={writeBlocked} onClick={() => publish(shown)}>发布</Button>} /> : undefined}>
      {shown && <>
        <Facts>
          <Fact k="状态">{statusOf(shown).text}</Fact>
          <Fact k="生效时间">{shown.effectiveAt}</Fact>
          <Fact k="节数">{shown.sections.length} 节</Fact>
        </Facts>
        <div className="rd-doc">
          <h3>{shown.title}</h3>
          <p>{shown.summary}</p>
          {shown.sections.map((section, index) => <section key={section.key}><h3>第 {index + 1} 节 · {section.title}</h3><p>{section.body}</p></section>)}
        </div>
        <Fold inset title="技术信息" summary={`修订号 ${shown.revision}`}>
          <Facts>{shown.sections.map((section, index) => <Fact key={section.key} k={`第 ${index + 1} 节标识`}><span data-mono="">{section.key}</span></Fact>)}</Facts>
        </Fold>
      </>}
    </Drawer>

    {editing && <LegalEditor key={`${editing.id}|${editing.version}`} initial={editing} published={published} canPublish={canPublish} blockedReason={writeBlocked} onSave={saveDraft} onPublish={publish} onClose={() => setEditing(null)} />}
  </div>;
}

function LegalEditor({ initial, published, canPublish, blockedReason, onSave, onPublish, onClose }: {
  initial: LegalTermsVersion;
  published: LegalTermsVersion | null;
  canPublish: boolean;
  blockedReason?: string;
  onSave: (form: LegalTermsVersion) => void;
  onPublish: (form: LegalTermsVersion) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [leaving, setLeaving] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const isNew = initial.id === 0;
  useUnsavedGuard(dirty);
  const update = (patch: Partial<LegalTermsVersion>) => setForm((current) => ({ ...current, ...patch }));
  const updateSection = (index: number, patch: Partial<LegalTermsSection>) => setForm((current) => ({ ...current, sections: current.sections.map((section, itemIndex) => itemIndex === index ? { ...section, ...patch } : section) }));
  const missing = [
    !form.title.trim() && "标题",
    !form.summary.trim() && "摘要",
    !validTime(form.effectiveAt) && "生效时间",
    form.sections.some((section) => !section.title.trim() || !section.body.trim()) && "条款段落",
  ].filter(Boolean);
  const saveBlocked = blockedReason ?? (missing.length ? `还缺：${missing.join("、")}` : !dirty && !isNew ? "没有改动" : undefined);
  const publishBlocked = blockedReason ?? (isNew || dirty ? "先保存草稿，发布只发已保存的内容" : undefined);
  const close = () => { if (dirty) setLeaving(true); else onClose(); };
  return <>
    <Drawer open wide onClose={close} title={`法律条款草稿 · ${form.version}`} sub={`${localeName(form.locale)} · ${form.jurisdiction}`} icon={FilePen} tone="role-1"
      footer={<Decision note="保存草稿不改变用户看到的条款。" others={<>
        <Button onClick={close}>取消</Button>
        <Button variant={canPublish ? "secondary" : "primary"} disabledReason={saveBlocked} onClick={() => onSave(form)}>保存草稿</Button>
      </>} primary={canPublish ? <Button variant="primary" disabledReason={publishBlocked} onClick={() => onPublish(form)}>发布</Button> : undefined} />}>
      <div className="rd-form-stack">
        {form.sections.length === 1 && (published?.sections.length ?? 0) > 1 && <Notice tone="warn" title="这是单节草稿">当前版本有 {published?.sections.length} 节，单节草稿不能替换完整条款。这里不能增删节。</Notice>}
        <div className="rd-form-grid">
          <Field label="版本"><div className="rd-form-static">{form.version}<Explain label="版本号怎么来的" content="现有最大版本号加一，不能手填。" /></div></Field>
          <Field label="生效时间" required error={validTime(form.effectiveAt) ? undefined : "格式：2026-11-05 09:00:00"}>{(control) => <Input {...control} value={form.effectiveAt} onChange={(event) => update({ effectiveAt: event.target.value })} />}</Field>
        </div>
        <Field label="标题" required>{(control) => <Input {...control} maxLength={200} value={form.title} onChange={(event) => update({ title: event.target.value })} />}</Field>
        <Field label="摘要" required>{(control) => <Textarea {...control} rows={3} maxLength={2000} value={form.summary} onChange={(event) => update({ summary: event.target.value })} />}</Field>
        <h3 className="rd-form-group-title">条款段落 · {form.sections.length} 节</h3>
        {form.sections.map((section, index) => (
          <section key={section.key} className="rd-form-stack" aria-label={`第 ${index + 1} 节`}>
            <Field label={`第 ${index + 1} 节标题`} required>{(control) => <Input {...control} maxLength={200} value={section.title} onChange={(event) => updateSection(index, { title: event.target.value })} />}</Field>
            <Field label={`第 ${index + 1} 节正文`} required>{(control) => <Textarea {...control} rows={6} maxLength={10000} value={section.body} onChange={(event) => updateSection(index, { body: event.target.value })} />}</Field>
          </section>
        ))}
      </div>
    </Drawer>
    {leaving && (
      <Modal title="有未保存的修改" onClose={() => setLeaving(false)} footer={<>
        <Button onClick={() => setLeaving(false)}>继续编辑</Button>
        <Button variant="danger-outline" onClick={onClose}>放弃改动</Button>
        <Button variant="primary" disabledReason={saveBlocked} onClick={() => { setLeaving(false); onSave(form); }}>保存草稿后继续</Button>
      </>}><p>关闭后这次的修改不会保留。</p></Modal>
    )}
  </>;
}
