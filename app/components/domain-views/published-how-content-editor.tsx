"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const busyRef = useRef(false);
  const identitySequence = useRef(0);
  const identities = useRef(new WeakMap<Row, { block: string; items: string[] }>());
  const contentHeading = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef({ document, baseline, key, locale });
  stateRef.current = { document, baseline, key, locale };
  const refresh = useCallback(async (confirmDiscard = true) => {
    if (!canRead || busyRef.current) return;
    const previous = stateRef.current;
    if (confirmDiscard && JSON.stringify(previous.document) !== JSON.stringify(previous.baseline)
      && !window.confirm("刷新会丢弃尚未保存的说明内容，是否继续？")) return;
    busyRef.current = true; setLoading(true); setError(null);
    try {
      const value = await fetchHowContentAdmin();
      const next = Object.keys(value.contents).length ? value : { ...initialDocument(), ...value, contents: initialDocument().contents };
      const nextKey = next.contents[previous.key] ? previous.key : KEYS.find(item => next.contents[item]) ?? KEYS[0];
      const locales = row(row(next.contents[nextKey]).locales);
      setDocument(next); setBaseline(next); setKey(nextKey);
      setLocale(locales[previous.locale] ? previous.locale : Object.keys(locales)[0] ?? "en");
    }
    catch (cause) { setError(displayAdminError(cause)); }
    finally { busyRef.current = false; setLoading(false); }
  }, [canRead]);
  useEffect(() => { void refresh(false); }, [refresh]);
  const current = row(row(document?.contents[key]).locales)[locale];
  const currentBlocks = blocks(row(current).blocks);
  const hasChanges = useMemo(() => JSON.stringify(document) !== JSON.stringify(baseline), [document, baseline]);
  if (!canRead) return null;
  const locked = !canWrite || loading || saving;
  const patchLocale = (next: Row) => { if (!document || locked || busyRef.current) return; const entry = row(document.contents[key]); const locales = row(entry.locales); setDocument({ ...document, contents: { ...document.contents, [key]: { ...entry, locales: { ...locales, [locale]: next } } } }); };
  const addLocale = () => { if (!document || locked || busyRef.current) return; const normalized = newLocale.trim().toLowerCase().replace("_", "-"); if (!/^[a-z]{2}(?:-[a-z0-9]{2,8})?$/.test(normalized)) { setError("Locale 格式无效，例如 en、zh、vi 或 zh-cn。"); return; } const entry = row(document.contents[key]); const locales = row(entry.locales); if (locales[normalized]) { setLocale(normalized); setNewLocale(""); return; } if (Object.keys(locales).length >= 10) { setError("单页最多 10 个 Locale。"); return; } setDocument({ ...document, contents: { ...document.contents, [key]: { ...entry, locales: { ...locales, [normalized]: { blocks: [{ id: "intro", kind: "text", title: key, body: "" }] } } } } }); setLocale(normalized); setNewLocale(""); setError(null); };
  // UI identity is independent of the editable business ID and never enters the API payload.
  const nextIdentity = (kind: string) => `how-${kind}-${++identitySequence.current}`;
  const identityOf = (item: Row) => {
    let identity = identities.current.get(item);
    if (!identity) {
      identity = { block: nextIdentity("block"), items: Array.isArray(item.items) ? item.items.map(() => nextIdentity("item")) : [] };
      identities.current.set(item, identity);
    }
    return identity;
  };
  const patchBlock = (index: number, patch: Row, replace = false, listKeys?: string[]) => {
    const previous = currentBlocks[index];
    const next = replace ? patch : { ...previous, ...patch };
    const identity = identityOf(previous);
    const itemCount = Array.isArray(next.items) ? next.items.length : 0;
    identities.current.set(next, { block: identity.block, items: listKeys ?? Array.from({ length: itemCount }, (_, i) => identity.items[i] ?? nextIdentity("item")) });
    patchLocale({ ...row(current), blocks: currentBlocks.map((item, i) => i === index ? next : item) });
  };
  const removeBlock = (index: number) => {
    if (locked || busyRef.current || currentBlocks.length <= 1) return;
    patchLocale({ ...row(current), blocks: currentBlocks.filter((_, i) => i !== index) });
    contentHeading.current?.focus();
  };
  const removeListItem = (index: number, itemIndex: number) => {
    const item = currentBlocks[index];
    if (locked || busyRef.current || !Array.isArray(item.items) || item.items.length <= 1) return;
    patchBlock(index, { items: item.items.filter((_, i) => i !== itemIndex) }, false,
      identityOf(item).items.filter((_, i) => i !== itemIndex));
    contentHeading.current?.focus();
  };
  const changeKind = (index: number, kind: string) => {
    const next: Row = { ...currentBlocks[index], kind };
    delete next.ref; delete next.items;
    if (kind === "ruleRef") next.ref = { source: "canonical", key: "", version: "" };
    if (kind === "list") next.items = [""];
    patchBlock(index, next, true);
  };
  const addBlock = () => {
    if (!current || currentBlocks.length >= 200) return;
    let number = currentBlocks.length + 1;
    while (currentBlocks.some(item => item.id === `block-${number}`)) number++;
    patchLocale({ ...row(current), blocks: [...currentBlocks, { id: `block-${number}`, kind: "text", title: "", body: "" }] });
  };
  const save = async () => {
    if (!document || locked || busyRef.current) return;
    if (reason.trim().length < 8) { setError("变更理由需至少 8 个字符。"); return; }
    if (!hasChanges) { setError("内容没有变化，无需提交。"); return; }
    busyRef.current = true; setSaving(true); setError(null);
    try { const value = await updateHowContentAdmin({ ...document, status: document.status === "UNPUBLISHED" ? "DRAFT" : document.status }, reason.trim()); setDocument(value); setBaseline(value); setReason(""); }
    catch (cause) { setError(`${displayAdminError(cause)}；当前未保存内容已保留。刷新会丢弃本地修改，请先核对并保留需要的内容。`); }
    finally { busyRef.current = false; setSaving(false); }
  };
  return <section className="l-card" data-testid="published-content-how">
    <div className="l-h"><div><div className="ttl">How-it-works 服务端发布内容</div><div className="sub">6 个页面共用一个版本化文档；规则块只能引用 canonical key，不能在此复制业务数值</div></div>
      <div className="r"><span className="bdg cyan">{document?.status ?? "—"} · rev {document?.revision ?? 0}</span><button className="l-btn sm" onClick={() => void refresh()} disabled={loading || saving}>刷新</button></div></div>
    <div className="l-b">
      {document && <div className="tiny">{document.hasPublishedVersion ? "当前有公开版本；保存草稿不会替换公开内容。" : "当前没有公开版本；保存草稿不会发布内容。"}</div>}
      {error && <div className="atint warn" role="alert">{error}</div>}
      {loading && !document ? <div className="tiny">读取说明内容中…</div> : !document ? <div className="atint warn">暂无内容；App remote 将失败关闭。</div> : <>
        <div className="two-col">
          <label className="tiny">版本<input value={document.version} maxLength={64} disabled={locked} onChange={e => setDocument({ ...document, version: e.target.value })} /></label>
          <label className="tiny">发布状态<select value={document.status === "UNPUBLISHED" ? "DRAFT" : document.status} disabled={locked} onChange={e => setDocument({ ...document, status: e.target.value as PublishedHowContentDocument["status"] })}><option>DRAFT</option><option>PUBLISHED</option></select></label>
        </div>
        <div className="r" style={{ marginTop: 10 }}>
          <select aria-label="How content key" value={key} disabled={loading || saving} onChange={e => { const next = e.target.value as (typeof KEYS)[number]; setKey(next); setLocale(Object.keys(row(row(document.contents[next]).locales))[0] ?? "en"); }}>{KEYS.map(item => <option key={item}>{item}</option>)}</select>
          <select aria-label="How content locale" value={locale} disabled={loading || saving || !current} onChange={e => setLocale(e.target.value)}>{Object.keys(row(row(document.contents[key]).locales)).map(item => <option key={item}>{item}</option>)}</select>
          {canWrite && <><input aria-label="新增 How Locale" placeholder="vi" value={newLocale} maxLength={11} disabled={locked} onChange={e => setNewLocale(e.target.value)} /><button className="l-btn sm" disabled={locked} onClick={addLocale}>新增 Locale</button></>}
        </div>
        {!current && <div className="tiny">本页尚无所选语言内容，请先新增 Locale。</div>}
        <div className="tiny" style={{ marginTop: 10 }} ref={contentHeading} tabIndex={-1}>结构化内容块</div>
        {currentBlocks.map((item, index) => <div className="l-card" key={identityOf(item).block} style={{ padding: 10, marginTop: 8 }}>
          <div className="two-col">
            <label className="tiny">ID<input value={text(item.id)} maxLength={64} disabled={locked} onChange={e => patchBlock(index, { id: e.target.value })} /></label>
            <label className="tiny">类型<select value={text(item.kind)} disabled={locked} onChange={e => changeKind(index, e.target.value)}><option>text</option><option>list</option><option>callout</option><option>ruleRef</option></select></label>
          </div>
          <label className="tiny">标题<input value={text(item.title)} maxLength={256} disabled={locked} onChange={e => patchBlock(index, { title: e.target.value })} /></label>
          <label className="tiny">正文（规则块必须保留 {'{value}'} 占位符）<textarea rows={3} value={text(item.body)} maxLength={20000} disabled={locked} onChange={e => patchBlock(index, { body: e.target.value })} /></label>
          {item.kind === "ruleRef" && <div className="two-col">
            <label className="tiny">规则键<input value={text(row(item.ref).key)} maxLength={160} disabled={locked} onChange={e => patchBlock(index, { ref: { ...row(item.ref), source: "canonical", key: e.target.value } })} /></label>
            <label className="tiny">引用版本<input value={text(row(item.ref).version)} maxLength={128} disabled={locked} onChange={e => patchBlock(index, { ref: { ...row(item.ref), source: "canonical", version: e.target.value } })} /></label>
          </div>}
          {item.kind === "list" && <div>
            {(Array.isArray(item.items) ? item.items : []).map((value, itemIndex, items) => <div className="r" key={identityOf(item).items[itemIndex]}>
              <label className="tiny">列表项 {itemIndex + 1}<textarea rows={2} value={text(value)} maxLength={2000} disabled={locked} onChange={e => patchBlock(index, { items: items.map((entry, i) => i === itemIndex ? e.target.value : entry) })} /></label>
              {canWrite && <button className="l-btn sm" disabled={locked || items.length <= 1} onClick={() => removeListItem(index, itemIndex)}>删除列表项</button>}
            </div>)}
            {canWrite && <button className="l-btn sm" disabled={locked || (Array.isArray(item.items) && item.items.length >= 50)} onClick={() => patchBlock(index, { items: [...(Array.isArray(item.items) ? item.items : []), ""] })}>新增列表项</button>}
          </div>}
          {canWrite && <button className="l-btn sm" disabled={locked || currentBlocks.length <= 1} onClick={() => removeBlock(index)}>删除内容块</button>}
        </div>)}
        {canWrite && <>
          <button className="l-btn sm" style={{ marginTop: 8 }} disabled={locked || !current || currentBlocks.length >= 200} onClick={addBlock}>新增内容块</button>
          <label className="tiny" style={{ display: "block", marginTop: 10 }}>变更理由（必填）<input value={reason} maxLength={500} disabled={locked} onChange={e => setReason(e.target.value)} /></label>
          <button className="l-btn mc" style={{ marginTop: 8 }} disabled={locked || !hasChanges} onClick={() => void save()}>{saving ? "保存中…" : "保存并回读"}</button>
        </>}
      </>}
    </div>
  </section>;
}
