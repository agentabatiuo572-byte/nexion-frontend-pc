"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { fetchHowContentAdmin, updateHowContentAdmin, type PublishedHowContentDocument } from "@/lib/admin/published-content-client";

const KEYS = ["genesis-how", "wallet-exchange-how", "wallet-repurchase-how", "team-binary-how", "team-commissions-how", "team-unilevel-how"] as const;
type Row = Record<string, unknown>;
function row(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function blocks(value: unknown): Row[] { return Array.isArray(value) ? value.map(row) : []; }
function initialDocument(): PublishedHowContentDocument {
  const contents: Record<string, Record<string, unknown>> = {};
  for (const key of KEYS) contents[key] = { locales: { en: { blocks: [{ id: "intro", kind: "text", title: key, body: "" }] } } };
  return { version: "draft-local", status: "DRAFT", contents, revision: 0, source: "server", configKey: "how-it-works.published" };
}

export function PublishedHowContentEditor() {
  const session = useAdminAuth((state) => state.session);
  const canRead = session?.role === "superadmin" || session?.authorities?.includes("platform_a3_read") === true;
  const canWrite = session?.role === "superadmin" || session?.authorities?.includes("platform_a3_write") === true;
  const [document, setDocument] = useState<PublishedHowContentDocument | null>(null);
  const [baseline, setBaseline] = useState<PublishedHowContentDocument | null>(null);
  const [key, setKey] = useState<(typeof KEYS)[number]>(KEYS[0]);
  const [locale, setLocale] = useState("en");
  const [newLocale, setNewLocale] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(async () => {
    if (!canRead) return;
    setLoading(true); setError(null);
    try { const value = await fetchHowContentAdmin(); const next = Object.keys(value.contents).length ? value : initialDocument(); setDocument(next); setBaseline(next); const entry = row(next.contents[KEYS[0]]); const locales = row(entry.locales); setLocale(Object.keys(locales)[0] ?? "en"); }
    catch (cause) { setDocument(null); setBaseline(null); setError(displayAdminError(cause)); }
    finally { setLoading(false); }
  }, [canRead]);
  useEffect(() => { void refresh(); }, [refresh]);
  const current = row(row(document?.contents[key]).locales)[locale];
  const currentBlocks = blocks(row(current).blocks);
  const hasChanges = useMemo(() => JSON.stringify(document) !== JSON.stringify(baseline), [document, baseline]);
  if (!canRead) return null;
  const patchLocale = (next: Row) => { if (!document) return; const entry = row(document.contents[key]); const locales = row(entry.locales); setDocument({ ...document, contents: { ...document.contents, [key]: { ...entry, locales: { ...locales, [locale]: next } } } }); };
  const addLocale = () => { if (!document) return; const normalized = newLocale.trim().toLowerCase().replace("_", "-"); if (!/^[a-z]{2}(?:-[a-z0-9]{2,8})?$/.test(normalized)) { setError("Locale 格式无效，例如 en、zh、vi 或 zh-cn。"); return; } const entry = row(document.contents[key]); const locales = row(entry.locales); if (locales[normalized]) { setLocale(normalized); setNewLocale(""); return; } if (Object.keys(locales).length >= 10) { setError("单页最多 10 个 Locale。"); return; } setDocument({ ...document, contents: { ...document.contents, [key]: { ...entry, locales: { ...locales, [normalized]: { blocks: [{ id: "intro", kind: "text", title: key, body: "" }] } } } } }); setLocale(normalized); setNewLocale(""); setError(null); };
  const patchBlock = (index: number, patch: Row) => patchLocale({ ...row(current), blocks: currentBlocks.map((item, i) => i === index ? { ...item, ...patch } : item) });
  const save = async () => {
    if (!document || !canWrite) return;
    if (reason.trim().length < 8) { setError("变更理由需至少 8 个字符。"); return; }
    if (!hasChanges) { setError("内容没有变化，无需提交。"); return; }
    setSaving(true); setError(null);
    try { const value = await updateHowContentAdmin({ ...document, status: document.status === "UNPUBLISHED" ? "DRAFT" : document.status }, reason.trim()); setDocument(value); setBaseline(value); setReason(""); }
    catch (cause) { setError(`${displayAdminError(cause)}；请刷新后按 CAS 版本重试。`); }
    finally { setSaving(false); }
  };
  return <section className="l-card" data-testid="published-content-how"><div className="l-h"><div><div className="ttl">How-it-works 服务端发布内容</div><div className="sub">6 个页面共用一个版本化文档；规则块只能引用 canonical key，不能在此复制业务数值</div></div><div className="r"><span className="bdg cyan">{document?.status ?? "—"} · rev {document?.revision ?? 0}</span><button className="l-btn sm" onClick={() => void refresh()} disabled={loading}>刷新</button></div></div><div className="l-b">{error && <div className="atint warn">{error}</div>}{loading && !document ? <div className="tiny">读取说明内容中…</div> : !document ? <div className="atint warn">暂无内容；App remote 将失败关闭。</div> : <><div className="two-col"><label className="tiny">版本<input value={document.version} disabled={!canWrite} onChange={(e) => setDocument({ ...document, version: e.target.value })} /></label><label className="tiny">发布状态<select value={document.status === "UNPUBLISHED" ? "DRAFT" : document.status} disabled={!canWrite} onChange={(e) => setDocument({ ...document, status: e.target.value as PublishedHowContentDocument["status"] })}><option>DRAFT</option><option>PUBLISHED</option></select></label></div><div className="r" style={{ marginTop: 10 }}><select aria-label="How content key" value={key} onChange={(e) => { const next = e.target.value as (typeof KEYS)[number]; setKey(next); const locales = row(row(document.contents[next]).locales); setLocale(Object.keys(locales)[0] ?? "en"); }}>{KEYS.map((item) => <option key={item}>{item}</option>)}</select><select aria-label="How content locale" value={locale} onChange={(e) => setLocale(e.target.value)}>{Object.keys(row(row(document.contents[key]).locales)).map((item) => <option key={item}>{item}</option>)}</select>{canWrite && <><input aria-label="新增 How Locale" placeholder="vi" value={newLocale} maxLength={11} onChange={(e) => setNewLocale(e.target.value)} /><button className="l-btn sm" onClick={addLocale}>新增 Locale</button></>}</div><div className="tiny" style={{ marginTop: 10 }}>结构化内容块</div>{currentBlocks.map((item, index) => <div className="l-card" key={String(item.id) || index} style={{ padding: 10, marginTop: 8 }}><div className="two-col"><label className="tiny">ID<input value={text(item.id)} disabled={!canWrite} onChange={(e) => patchBlock(index, { id: e.target.value })} /></label><label className="tiny">类型<select value={text(item.kind)} disabled={!canWrite} onChange={(e) => patchBlock(index, { kind: e.target.value })}><option>text</option><option>list</option><option>callout</option><option>ruleRef</option></select></label></div><label className="tiny">标题<input value={text(item.title)} disabled={!canWrite} onChange={(e) => patchBlock(index, { title: e.target.value })} /></label><label className="tiny">正文（规则块必须保留 {'{value}'} 占位符）<textarea rows={3} value={text(item.body)} disabled={!canWrite} onChange={(e) => patchBlock(index, { body: e.target.value })} /></label>{item.kind === "ruleRef" && <label className="tiny">Canonical 引用 JSON（只读版本由后端校验）<input value={JSON.stringify(item.ref ?? { source: "canonical", key: "", version: "" })} disabled={!canWrite} onChange={(e) => { try { patchBlock(index, { ref: JSON.parse(e.target.value) }); } catch { /* backend returns structured validation */ } }} /></label>}{item.kind === "list" && <label className="tiny">列表项 JSON<textarea rows={2} value={JSON.stringify(item.items ?? [])} disabled={!canWrite} onChange={(e) => { try { patchBlock(index, { items: JSON.parse(e.target.value) }); } catch { /* backend validates */ } }} /></label>}</div>)}{canWrite && <><label className="tiny" style={{ display: "block", marginTop: 10 }}>变更理由（必填）<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label><button className="l-btn mc" style={{ marginTop: 8 }} disabled={saving || !hasChanges} onClick={() => void save()}>{saving ? "保存中…" : "保存并回读"}</button></>}</>}</div></section>;
}
