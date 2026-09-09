"use client";

import { useCallback, useEffect, useState } from "react";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  fetchLegalTermsAdmin,
  saveLegalTermsDraft,
  transitionLegalTerms,
  type LegalTermsSection,
  type LegalTermsVersion,
} from "@/lib/admin/legal-terms-client";
import { currentLegalTermsDateTime } from "@/lib/admin/legal-terms-contract";
import styles from "./legal-terms-editor.module.css";

export function LegalTermsEditor() {
  const session = useAdminAuth((state) => state.session);
  const canRead = session?.role === "superadmin" || session?.authorities?.includes("content_legal_terms_read") === true;
  const canWrite = session?.role === "superadmin" || session?.authorities?.includes("content_legal_terms_write") === true;
  const canPublish = session?.role === "superadmin" || session?.authorities?.includes("content_legal_terms_publish") === true;
  const [locale, setLocale] = useState("en");
  const [jurisdiction, setJurisdiction] = useState("GLOBAL");
  const [rows, setRows] = useState<LegalTermsVersion[]>([]);
  const [selected, setSelected] = useState<LegalTermsVersion | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!canRead) return;
    setBusy(true);
    setError(null);
    try {
      const value = await fetchLegalTermsAdmin(locale, jurisdiction);
      setRows(value);
      setSelected(value.find((row) => row.status === "DRAFT") ?? value[0] ?? null);
    } catch (e) {
      setError(displayAdminError(e));
    } finally {
      setBusy(false);
    }
  }, [canRead, locale, jurisdiction]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!canRead) return null;

  const update = (patch: Partial<LegalTermsVersion>) => selected && setSelected({ ...selected, ...patch });
  const updateSection = (index: number, patch: Partial<LegalTermsSection>) => selected && setSelected({
    ...selected,
    sections: selected.sections.map((section, i) => i === index ? { ...section, ...patch } : section),
  });
  const editable = Boolean(selected && canWrite && selected.status === "DRAFT");

  const save = async () => {
    if (!selected || !editable || reason.trim().length < 8) {
      setError("只能编辑草稿，并填写至少 8 个字符的变更理由。");
      return;
    }
    setBusy(true);
    try {
      await saveLegalTermsDraft({
        locale: selected.locale,
        jurisdiction: selected.jurisdiction,
        version: selected.version,
        effectiveAt: selected.effectiveAt,
        title: selected.title,
        summary: selected.summary,
        sections: selected.sections,
        expectedRevision: selected.revision,
        reason: reason.trim(),
      });
      setReason("");
      await refresh();
    } catch (e) {
      setError(displayAdminError(e));
    } finally {
      setBusy(false);
    }
  };

  const transition = async (action: "publish" | "revoke") => {
    if (!selected || !canPublish || (action === "publish" ? selected.status !== "DRAFT" : selected.status !== "PUBLISHED") || reason.trim().length < 8) {
      setError("仅可发布草稿或撤回已发布版本，并填写理由。");
      return;
    }
    setBusy(true);
    try {
      await transitionLegalTerms(action, selected, reason.trim());
      setReason("");
      await refresh();
    } catch (e) {
      setError(displayAdminError(e));
    } finally {
      setBusy(false);
    }
  };

  const createDraft = () => {
    const next = rows.reduce((max, row) => {
      const match = /^v(\d+)/.exec(row.version);
      return Math.max(max, match ? Number(match[1]) : 0);
    }, 0) + 1;
    setSelected({
      id: 0,
      locale,
      jurisdiction,
      version: `v${next}`,
      effectiveAt: currentLegalTermsDateTime(),
      status: "DRAFT",
      title: "",
      summary: "",
      sections: [{ key: "general", title: "", body: "", sortOrder: 10 }],
      revision: 0,
      publishedAt: null,
      revokedAt: null,
    });
  };

  return (
    <section className={`l-card ${styles.root}`} data-testid="legal-terms-editor">
      <div className="l-h">
        <div className={styles.headerCopy}>
          <div className="ttl">Terms / 法律条款</div>
          <div className="sub">按 Locale + Jurisdiction 管理结构化版本，App 只读已发布真源</div>
        </div>
        <button className="l-btn sm" onClick={() => void refresh()} disabled={busy}>刷新</button>
      </div>
      <div className={`l-b ${styles.body}`}>
        {error && <div className={`atint warn ${styles.alert}`} role="alert">{error}</div>}
        <div className={styles.scopeGrid}>
          <label className={styles.field}>
            <span>Locale</span>
            <select value={locale} onChange={(e) => setLocale(e.target.value)}>
              <option>en</option>
              <option>zh</option>
              <option>vi</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Jurisdiction</span>
            <input value={jurisdiction} maxLength={32} onChange={(e) => setJurisdiction(e.target.value.toUpperCase())} />
          </label>
        </div>

        {rows.length > 0 && (
          <div className={styles.versionStrip} aria-label="条款版本">
            {rows.map((row) => (
              <button
                key={row.id}
                className={`l-btn sm ${styles.versionButton} ${selected?.id === row.id ? styles.versionSelected : ""}`}
                aria-pressed={selected?.id === row.id}
                onClick={() => setSelected(row)}
              >
                {row.version} · {row.status}
              </button>
            ))}
          </div>
        )}

        {canWrite && <div className={styles.createRow}><button className="l-btn sm" onClick={createDraft}>新建草稿</button></div>}

        {selected ? (
          <div className={styles.editor}>
            <div className={styles.metadataGrid}>
              <label className={styles.field}>
                <span>版本</span>
                <input value={selected.version} disabled />
              </label>
              <label className={styles.field}>
                <span>生效时间</span>
                <input value={selected.effectiveAt} disabled={!editable} onChange={(e) => update({ effectiveAt: e.target.value })} />
              </label>
            </div>

            <label className={styles.field}>
              <span>标题</span>
              <input value={selected.title} disabled={!editable} onChange={(e) => update({ title: e.target.value })} />
            </label>
            <label className={styles.field}>
              <span>摘要</span>
              <textarea className={styles.summary} rows={4} value={selected.summary} disabled={!editable} onChange={(e) => update({ summary: e.target.value })} />
            </label>

            <div className={styles.sectionHeading}>
              <div>
                <strong>条款段落</strong>
                <span>按章节维护标题与正文</span>
              </div>
              <span>{selected.sections.length} 节</span>
            </div>
            <div className={styles.sectionList}>
              {selected.sections.map((section, index) => (
                <section className={`l-card ${styles.sectionCard}`} key={section.key}>
                  <div className={styles.sectionMeta}>
                    <span>第 {index + 1} 节</span>
                    <code>{section.key}</code>
                  </div>
                  <label className={styles.field}>
                    <span>标题</span>
                    <input value={section.title} disabled={!editable} onChange={(e) => updateSection(index, { title: e.target.value })} />
                  </label>
                  <label className={styles.field}>
                    <span>正文</span>
                    <textarea className={styles.sectionBody} rows={8} value={section.body} disabled={!editable} onChange={(e) => updateSection(index, { body: e.target.value })} />
                  </label>
                </section>
              ))}
            </div>

            <label className={`${styles.field} ${styles.reasonField}`}>
              <span>变更理由</span>
              <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className={styles.actions}>
              {editable && <button className="l-btn mc" onClick={() => void save()} disabled={busy}>保存草稿</button>}
              {canPublish && selected.status === "DRAFT" && <button className="l-btn mc" onClick={() => void transition("publish")} disabled={busy}>发布</button>}
              {canPublish && selected.status === "PUBLISHED" && <button className="l-btn sm" onClick={() => void transition("revoke")} disabled={busy}>撤回</button>}
            </div>
          </div>
        ) : <div className={`atint warn ${styles.emptyState}`}>当前法域暂无版本；服务端无有效条款时 App 将失败关闭。</div>}
      </div>
    </section>
  );
}
