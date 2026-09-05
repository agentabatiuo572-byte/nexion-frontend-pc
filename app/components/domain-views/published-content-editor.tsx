"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { fetchDeveloperDocsAdmin, fetchRankHowPolicyAdmin, fetchPrivacyPolicyAdmin, updateDeveloperDocsAdmin, updateRankHowPolicyAdmin, updatePrivacyPolicyAdmin, type PublishedContentDocument } from "@/lib/admin/published-content-client";
import styles from "./published-content-editor.module.css";

type Kind = "developerDocs" | "rankHow" | "privacyPolicy";
type Row = Record<string, unknown>;
const META: Record<Kind, { title: string; subtitle: string; read: string; write: string }> = {
  privacyPolicy: { title: "隐私政策", subtitle: "注册、邀请页公开阅读；草稿保留当前公开版本，发布须使用新版本号。请仅发布已审核正文。", read: "content_legal_terms_read", write: "content_legal_terms_write" },
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
  const canPublish = kind !== "privacyPolicy" || session?.role === "superadmin" || session?.authorities?.includes("content_legal_terms_publish") === true;
  const [document, setDocument] = useState<PublishedContentDocument | null>(null);
  const [baseline, setBaseline] = useState<PublishedContentDocument | null>(null);
  const [locale, setLocale] = useState("en");
  const [newLocale, setNewLocale] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const refresh = useCallback(async () => {
    if (!canRead) return;
    setLoading(true); setError(null);
    try {
      const value = kind === "privacyPolicy" ? await fetchPrivacyPolicyAdmin() : kind === "developerDocs" ? await fetchDeveloperDocsAdmin() : await fetchRankHowPolicyAdmin();
      setDocument(value); setBaseline(value); setLocale(Object.keys(value.locales)[0] ?? "en"); setReason("");
    } catch (cause) { setDocument(null); setBaseline(null); setError(displayAdminError(cause)); setExpanded(true); }
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
    if (kind === "privacyPolicy" && document.status !== "DRAFT" && !canPublish) { setError("发布或撤下隐私政策需要发布权限，请先改为草稿。"); return; }
    if (kind === "privacyPolicy" && document.status === "PUBLISHED" && !document.locales.en) {
      setError("发布隐私政策必须包含完整的 en 默认语言，供其他未发布语言回退使用；未完成的译文可先保存为草稿。"); return;
    }
    if (reason.trim().length < 8 || reason.trim().length > 500) { setError("变更理由需为 8–500 个字符。"); return; }
    if (!hasChanges) { setError("内容没有变化，无需提交。"); return; }
    setSaving(true); setError(null);
    try {
      const payload = { ...document, status: document.status === "UNPUBLISHED" && kind !== "privacyPolicy" ? "DRAFT" as const : document.status };
      const value = kind === "privacyPolicy" ? await updatePrivacyPolicyAdmin(payload, reason.trim()) : kind === "developerDocs" ? await updateDeveloperDocsAdmin(payload, reason.trim()) : await updateRankHowPolicyAdmin(payload, reason.trim());
      setDocument(value); setBaseline(value); setReason("");
    } catch (cause) { setError(displayAdminError(cause)); }
    finally { setSaving(false); }
  };
  const current = row(document?.locales[locale]);
  return (
    <section className={styles.editor} data-testid={`published-content-${kind}`}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <div className={styles.title}>{meta.title}</div>
          <div className={styles.subtitle}>{meta.subtitle}</div>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.status}>{document?.status ?? "—"} · rev {document?.revision ?? 0}</span>
          <button className={`${styles.button} ${styles.smallButton}`} type="button" onClick={() => void refresh()} disabled={loading}>刷新</button>
          <button
            className={`${styles.button} ${styles.smallButton} ${styles.toggleButton}`}
            type="button"
            aria-expanded={expanded}
            aria-controls={`${kind}-published-content-body`}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "收起" : "维护策略"}
          </button>
        </div>
      </header>
      {expanded && (
      <div id={`${kind}-published-content-body`} className={styles.body}>
        {error && <div className={`${styles.notice} ${styles.warning}`} role="alert">{error}</div>}
        {loading && !document ? (
          <div className={styles.loading} aria-live="polite">读取发布内容中…</div>
        ) : !document ? (
          <div className={`${styles.notice} ${styles.warning}`}>当前暂无可发布内容，App remote 将保持失败关闭。</div>
        ) : (
          <>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>版本</span>
                <input maxLength={64} value={document.version} disabled={!canWrite} onChange={(event) => setDocument({ ...document, version: event.target.value })} />
              </label>
              <label className={styles.field}>
                <span>状态</span>
                <select value={document.status === "UNPUBLISHED" && kind !== "privacyPolicy" ? "DRAFT" : document.status} disabled={!canWrite} onChange={(event) => setDocument({ ...document, status: event.target.value as PublishedContentDocument["status"] })}>
                  <option value="DRAFT">DRAFT</option>
                  <option value="PUBLISHED" disabled={!canPublish}>PUBLISHED</option>
                  {kind === "privacyPolicy" && <option value="UNPUBLISHED" disabled={!canPublish}>UNPUBLISHED（撤下公开版本）</option>}
                </select>
              </label>
            </div>
            <div className={styles.localeToolbar}>
              <label className={styles.field}>
                <span>当前 Locale</span>
                <select aria-label={`${kind} Locale`} value={locale} onChange={(event) => setLocale(event.target.value)}>
                  {Object.keys(document.locales).map((key) => <option key={key}>{key}</option>)}
                </select>
              </label>
              {canWrite && (
                <>
                  <label className={styles.field}>
                    <span>新增 Locale</span>
                    <input aria-label="新增 Locale" placeholder="例如 vi、zh-cn" value={newLocale} maxLength={11} onChange={(event) => setNewLocale(event.target.value)} />
                  </label>
                  <button className={`${styles.button} ${styles.smallButton}`} type="button" onClick={addLocale}>新增 Locale</button>
                  <button className={`${styles.button} ${styles.smallButton} ${styles.dangerButton}`} type="button" onClick={removeLocale}>删除当前 Locale</button>
                </>
              )}
            </div>
            {kind === "developerDocs"
              ? <DeveloperLocaleEditor value={current} disabled={!canWrite} onChange={updateLocale} />
              : <RankLocaleEditor value={current} disabled={!canWrite} onChange={updateLocale} />}
            <details className={styles.preview}>
              <summary>变更预览（只读）</summary>
              <pre>{JSON.stringify(document.locales[locale], null, 2)}</pre>
            </details>
            {canWrite && (
              <div className={styles.footer}>
                <label className={styles.field}>
                  <span>变更理由（必填，8–500 字）</span>
                  <input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
                </label>
                <button className={`${styles.button} ${styles.primaryButton}`} type="button" disabled={saving || !hasChanges} onClick={() => void save()}>{saving ? "保存中…" : "保存并回读"}</button>
              </div>
            )}
          </>
        )}
      </div>
      )}
    </section>
  );
}

function DeveloperLocaleEditor({ value, disabled, onChange }: { value: Row; disabled: boolean; onChange: (value: Row) => void }) {
  const example = row(value.example); const endpoints = list(value.endpoints).map(row); const events = list(value.events).map(text);
  const setExample = (key: string, next: string) => onChange({ ...value, example: { ...example, [key]: next } });
  return (
    <div className={styles.localeEditor}>
      <div className={styles.formGrid}>
        <label className={styles.field}><span>请求示例</span><textarea rows={4} maxLength={10000} value={text(example.request)} disabled={disabled} onChange={(event) => setExample("request", event.target.value)} /></label>
        <label className={styles.field}><span>响应示例</span><textarea rows={4} maxLength={10000} value={text(example.response)} disabled={disabled} onChange={(event) => setExample("response", event.target.value)} /></label>
      </div>
      <div className={styles.listBlock}>
        <div className={styles.sectionHeading}>接口列表</div>
        {endpoints.map((item, index) => (
          <div className={`${styles.listRow} ${styles.endpointRow}`} key={index}>
            <input aria-label={`接口 ${index + 1} 方法`} maxLength={16} value={text(item.method)} disabled={disabled} onChange={(event) => onChange({ ...value, endpoints: endpoints.map((entry, itemIndex) => itemIndex === index ? { ...entry, method: event.target.value } : entry) })} />
            <input aria-label={`接口 ${index + 1} 路径`} maxLength={256} value={text(item.path)} disabled={disabled} onChange={(event) => onChange({ ...value, endpoints: endpoints.map((entry, itemIndex) => itemIndex === index ? { ...entry, path: event.target.value } : entry) })} />
            {!disabled && <button className={`${styles.button} ${styles.smallButton} ${styles.dangerButton}`} type="button" onClick={() => onChange({ ...value, endpoints: endpoints.filter((_, itemIndex) => itemIndex !== index) })}>删除</button>}
          </div>
        ))}
        {!disabled && endpoints.length < 100 && <button className={`${styles.button} ${styles.smallButton}`} type="button" onClick={() => onChange({ ...value, endpoints: [...endpoints, { method: "GET", path: "/" }] })}>新增接口</button>}
      </div>
      <div className={styles.listBlock}>
        <div className={styles.sectionHeading}>事件列表</div>
        {events.map((event, index) => (
          <div className={`${styles.listRow} ${styles.eventRow}`} key={index}>
            <input aria-label={`事件 ${index + 1}`} maxLength={128} value={event} disabled={disabled} onChange={(changeEvent) => onChange({ ...value, events: events.map((item, itemIndex) => itemIndex === index ? changeEvent.target.value : item) })} />
            {!disabled && <button className={`${styles.button} ${styles.smallButton} ${styles.dangerButton}`} type="button" onClick={() => onChange({ ...value, events: events.filter((_, itemIndex) => itemIndex !== index) })}>删除</button>}
          </div>
        ))}
        {!disabled && events.length < 100 && <button className={`${styles.button} ${styles.smallButton}`} type="button" onClick={() => onChange({ ...value, events: [...events, ""] })}>新增事件</button>}
      </div>
    </div>
  );
}

function RankLocaleEditor({ value, disabled, onChange }: { value: Row; disabled: boolean; onChange: (value: Row) => void }) {
  const sections = list(value.sections).map(row);
  const setSection = (index: number, key: string, next: unknown) => onChange({ ...value, sections: sections.map((item, i) => i === index ? { ...item, [key]: next } : item) });
  return (
    <div className={styles.localeEditor}>
      <label className={styles.field}><span>页面主说明</span><textarea rows={3} maxLength={500} value={text(value.hero)} disabled={disabled} onChange={(event) => onChange({ ...value, hero: event.target.value })} /></label>
      <div className={styles.sectionHeading}>规则段落</div>
      <div className={styles.sectionGrid}>
        {sections.map((item, index) => (
          <section className={styles.sectionCard} key={index}>
            <div className={styles.formGrid}>
              <label className={styles.field}><span>ID</span><input maxLength={64} value={text(item.id)} disabled={disabled} onChange={(event) => setSection(index, "id", event.target.value)} /></label>
              <label className={styles.field}><span>顺序</span><input type="number" min={0} step={1} value={Number.isSafeInteger(item.order) ? String(item.order) : "0"} disabled={disabled} onChange={(event) => setSection(index, "order", Number(event.target.value))} /></label>
            </div>
            <label className={styles.field}><span>标题</span><input maxLength={256} value={text(item.title)} disabled={disabled} onChange={(event) => setSection(index, "title", event.target.value)} /></label>
            <label className={styles.field}><span>正文</span><textarea rows={4} maxLength={10000} value={text(item.body)} disabled={disabled} onChange={(event) => setSection(index, "body", event.target.value)} /></label>
            {!disabled && <button className={`${styles.button} ${styles.smallButton} ${styles.dangerButton} ${styles.sectionAction}`} type="button" onClick={() => onChange({ ...value, sections: sections.filter((_, itemIndex) => itemIndex !== index) })}>删除段落</button>}
          </section>
        ))}
      </div>
      {!disabled && sections.length < 100 && <button className={`${styles.button} ${styles.smallButton} ${styles.addAction}`} type="button" onClick={() => onChange({ ...value, sections: [...sections, { id: `section-${sections.length + 1}`, title: "", body: "", order: sections.length }] })}>新增段落</button>}
    </div>
  );
}
