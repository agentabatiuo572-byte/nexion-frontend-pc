"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { fetchDeveloperDocsAdmin, fetchRankHowPolicyAdmin, updateDeveloperDocsAdmin, updateRankHowPolicyAdmin, type PublishedContentDocument } from "@/lib/admin/published-content-client";

type Kind = "developerDocs" | "rankHow";
type Row = Record<string, unknown>;
const META: Record<Kind, { title: string; subtitle: string; read: string; write: string }> = {
  developerDocs: { title: "Developer API 发布内容", subtitle: "示例、接口和事件将由 App remote 读取", read: "platform_a3_read", write: "platform_a3_write" },
  rankHow: { title: "Rank How-it-works 策略", subtitle: "结构化规则说明将由 App remote 读取", read: "network_f1_read", write: "network_f1_write" },
};
function row(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }

export function PublishedContentEditor({ kind }: { kind: Kind }) {
  const session = useAdminAuth((state) => state.session);
  const meta = META[kind];
  const canRead = session?.role === "superadmin" || session?.authorities?.includes(meta.read) === true;
  const canWrite = session?.role === "superadmin" || session?.authorities?.includes(meta.write) === true;
  const [document, setDocument] = useState<PublishedContentDocument | null>(null);
  const [baseline, setBaseline] = useState<PublishedContentDocument | null>(null);
  const [locale, setLocale] = useState("en");
  const [newLocale, setNewLocale] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(async () => {
    if (!canRead) return;
    setLoading(true); setError(null);
    try {
      const value = kind === "developerDocs" ? await fetchDeveloperDocsAdmin() : await fetchRankHowPolicyAdmin();
      setDocument(value); setBaseline(value); setLocale(Object.keys(value.locales)[0] ?? "en"); setReason("");
    } catch (cause) { setDocument(null); setBaseline(null); setError(displayAdminError(cause)); }
    finally { setLoading(false); }
  }, [canRead, kind]);
  useEffect(() => { void refresh(); }, [refresh]);
  const hasChanges = useMemo(() => JSON.stringify(document) !== JSON.stringify(baseline), [document, baseline]);
  if (!canRead) return null;
  const updateLocale = (value: Row) => document && setDocument({ ...document, locales: { ...document.locales, [locale]: value } });
  const addLocale = () => {
    if (!document) return;
    const normalized = newLocale.trim().toLowerCase().replace("_", "-");
    if (!/^[a-z]{2}(?:-[a-z0-9]{2,8})?$/.test(normalized)) { setError("Locale 格式无效，例如 en、zh、vi 或 zh-cn。"); return; }
    if (!document.locales[normalized] && Object.keys(document.locales).length >= 10) { setError("最多维护 10 个 Locale。"); return; }
    const empty = kind === "developerDocs" ? { example: { request: "", response: "" }, endpoints: [{ method: "GET", path: "/" }], events: [""] } : { hero: "", sections: [{ id: "section-1", title: "", body: "", order: 0 }] };
    setDocument({ ...document, locales: { ...document.locales, [normalized]: document.locales[normalized] ?? empty } });
    setLocale(normalized); setNewLocale(""); setError(null);
  };
  const removeLocale = () => {
    if (!document || Object.keys(document.locales).length <= 1) { setError("至少保留一个 Locale。"); return; }
    const next = { ...document.locales }; delete next[locale]; const nextLocale = Object.keys(next)[0];
    setDocument({ ...document, locales: next }); setLocale(nextLocale);
  };
  const save = async () => {
    if (!document || !canWrite) return;
    if (reason.trim().length < 8 || reason.trim().length > 500) { setError("变更理由需为 8–500 个字符。"); return; }
    if (!hasChanges) { setError("内容没有变化，无需提交。"); return; }
    setSaving(true); setError(null);
    try {
      const payload = { ...document, status: document.status === "UNPUBLISHED" ? "DRAFT" as const : document.status };
      const value = kind === "developerDocs" ? await updateDeveloperDocsAdmin(payload, reason.trim()) : await updateRankHowPolicyAdmin(payload, reason.trim());
      setDocument(value); setBaseline(value); setReason("");
    } catch (cause) { setError(displayAdminError(cause)); }
    finally { setSaving(false); }
  };
  const current = row(document?.locales[locale]);
  return <section className="l-card" data-testid={`published-content-${kind}`}>
    <div className="l-h"><div><div className="ttl">{meta.title}</div><div className="sub">{meta.subtitle}</div></div><div className="r"><span className="bdg cyan">{document?.status ?? "—"} · rev {document?.revision ?? 0}</span><button className="l-btn sm" onClick={() => void refresh()} disabled={loading}>刷新</button></div></div>
    <div className="l-b">{error && <div className="atint warn" style={{ marginBottom: 10 }}>{error}</div>}
      {loading && !document ? <div className="tiny">读取发布内容中…</div> : !document ? <div className="atint warn">当前暂无可发布内容，App remote 将保持失败关闭。</div> : <>
        <div className="two-col"><label className="tiny">版本<input maxLength={64} value={document.version} disabled={!canWrite} onChange={(e) => setDocument({ ...document, version: e.target.value })} /></label><label className="tiny">状态<select value={document.status === "UNPUBLISHED" ? "DRAFT" : document.status} disabled={!canWrite} onChange={(e) => setDocument({ ...document, status: e.target.value as PublishedContentDocument["status"] })}><option value="DRAFT">DRAFT</option><option value="PUBLISHED">PUBLISHED</option></select></label></div>
        <div className="r" style={{ marginTop: 10, flexWrap: "wrap" }}><select aria-label={`${kind} Locale`} value={locale} onChange={(e) => setLocale(e.target.value)}>{Object.keys(document.locales).map((key) => <option key={key}>{key}</option>)}</select>{canWrite && <><input aria-label="新增 Locale" placeholder="vi" value={newLocale} maxLength={11} onChange={(e) => setNewLocale(e.target.value)} /><button className="l-btn sm" onClick={addLocale}>新增 Locale</button><button className="l-btn sm" onClick={removeLocale}>删除当前 Locale</button></>}</div>
        {kind === "developerDocs" ? <DeveloperLocaleEditor value={current} disabled={!canWrite} onChange={updateLocale} /> : <RankLocaleEditor value={current} disabled={!canWrite} onChange={updateLocale} />}
        <details style={{ marginTop: 12 }}><summary className="tiny">变更预览（只读）</summary><pre style={{ maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify(document.locales[locale], null, 2)}</pre></details>
        {canWrite && <><label className="tiny" style={{ display: "block", marginTop: 10 }}>变更理由（必填）<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} style={{ width: "100%" }} /></label><button className="l-btn mc" style={{ marginTop: 8 }} disabled={saving || !hasChanges} onClick={() => void save()}>{saving ? "保存中…" : "保存并回读"}</button></>}
      </>}</div>
  </section>;
}

function DeveloperLocaleEditor({ value, disabled, onChange }: { value: Row; disabled: boolean; onChange: (value: Row) => void }) {
  const example = row(value.example); const endpoints = list(value.endpoints).map(row); const events = list(value.events).map(text);
  const setExample = (key: string, next: string) => onChange({ ...value, example: { ...example, [key]: next } });
  return <div style={{ marginTop: 12 }}><div className="two-col"><label className="tiny">请求示例<textarea rows={4} maxLength={10000} value={text(example.request)} disabled={disabled} onChange={(e) => setExample("request", e.target.value)} /></label><label className="tiny">响应示例<textarea rows={4} maxLength={10000} value={text(example.response)} disabled={disabled} onChange={(e) => setExample("response", e.target.value)} /></label></div>
    <div className="tiny" style={{ marginTop: 10 }}>接口列表</div>{endpoints.map((item, index) => <div className="r" key={index}><input maxLength={16} value={text(item.method)} disabled={disabled} onChange={(e) => onChange({ ...value, endpoints: endpoints.map((row, i) => i === index ? { ...row, method: e.target.value } : row) })} /><input maxLength={256} value={text(item.path)} disabled={disabled} onChange={(e) => onChange({ ...value, endpoints: endpoints.map((row, i) => i === index ? { ...row, path: e.target.value } : row) })} />{!disabled && <button className="l-btn sm" onClick={() => onChange({ ...value, endpoints: endpoints.filter((_, i) => i !== index) })}>删除</button>}</div>)}{!disabled && endpoints.length < 100 && <button className="l-btn sm" onClick={() => onChange({ ...value, endpoints: [...endpoints, { method: "GET", path: "/" }] })}>新增接口</button>}
    <div className="tiny" style={{ marginTop: 10 }}>事件列表</div>{events.map((event, index) => <div className="r" key={index}><input maxLength={128} value={event} disabled={disabled} onChange={(e) => onChange({ ...value, events: events.map((item, i) => i === index ? e.target.value : item) })} />{!disabled && <button className="l-btn sm" onClick={() => onChange({ ...value, events: events.filter((_, i) => i !== index) })}>删除</button>}</div>)}{!disabled && events.length < 100 && <button className="l-btn sm" onClick={() => onChange({ ...value, events: [...events, ""] })}>新增事件</button>}
  </div>;
}

function RankLocaleEditor({ value, disabled, onChange }: { value: Row; disabled: boolean; onChange: (value: Row) => void }) {
  const sections = list(value.sections).map(row);
  const setSection = (index: number, key: string, next: unknown) => onChange({ ...value, sections: sections.map((item, i) => i === index ? { ...item, [key]: next } : item) });
  return <div style={{ marginTop: 12 }}><label className="tiny">页面主说明<textarea rows={3} maxLength={500} value={text(value.hero)} disabled={disabled} onChange={(e) => onChange({ ...value, hero: e.target.value })} /></label><div className="tiny" style={{ marginTop: 10 }}>规则段落</div>{sections.map((item, index) => <div className="l-card" key={index} style={{ padding: 10, marginTop: 8 }}><div className="two-col"><label className="tiny">ID<input maxLength={64} value={text(item.id)} disabled={disabled} onChange={(e) => setSection(index, "id", e.target.value)} /></label><label className="tiny">顺序<input type="number" min={0} step={1} value={Number.isSafeInteger(item.order) ? String(item.order) : "0"} disabled={disabled} onChange={(e) => setSection(index, "order", Number(e.target.value))} /></label></div><label className="tiny">标题<input maxLength={256} value={text(item.title)} disabled={disabled} onChange={(e) => setSection(index, "title", e.target.value)} /></label><label className="tiny">正文<textarea rows={4} maxLength={10000} value={text(item.body)} disabled={disabled} onChange={(e) => setSection(index, "body", e.target.value)} /></label>{!disabled && <button className="l-btn sm" onClick={() => onChange({ ...value, sections: sections.filter((_, i) => i !== index) })}>删除段落</button>}</div>)}{!disabled && sections.length < 100 && <button className="l-btn sm" onClick={() => onChange({ ...value, sections: [...sections, { id: `section-${sections.length + 1}`, title: "", body: "", order: sections.length }] })}>新增段落</button>}</div>;
}
