"use client";

import { useCallback, useEffect, useState } from "react";
import { Drawer } from "./design-kit";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  fetchTrustDocuments, restoreTrustDocument, trustDocumentPreviewHref, uploadTrustDocument,
  TRUST_DOCUMENT_MAX_BYTES, TRUST_DOCUMENT_NAMES, type TrustDocument, type TrustDocumentUpload,
} from "@/lib/admin/trust-documents-client";

/** I4 资料文件：App 信任中心与白皮书页展示的 PDF。未上传时显示随系统发布的默认文件。 */
type Editor =
  | { mode: "upload"; document: TrustDocument; file: File | null; fields: TrustDocumentUpload }
  | { mode: "restore"; document: TrustDocument; reason: string };

function sizeText(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function TrustDocumentsCard() {
  const session = useAdminAuth((state) => state.session);
  const isSuperadmin = session?.role === "superadmin";
  const canRead = isSuperadmin || !!session?.authorities?.includes("content_i4_read");
  const canPublish = isSuperadmin || !!session?.authorities?.some((authority) =>
    authority === "content_i4_publish_standard" || authority === "content_i4_trust_section_manage");
  const [documents, setDocuments] = useState<TrustDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!canRead) return;
    setLoading(true); setError(null);
    try { setDocuments(await fetchTrustDocuments()); }
    catch (cause) { setError(displayAdminError(cause)); }
    finally { setLoading(false); }
  }, [canRead]);
  useEffect(() => { void refresh(); }, [refresh]);
  if (!canRead) return null;

  const openUpload = (document: TrustDocument) => {
    setEditorError(null);
    setEditor({ mode: "upload", document, file: null, fields: {
      version: document.slot === "whitepaper" ? "" : document.version ?? "",
      language: document.language ?? "",
      referenceNo: document.referenceNo ?? "",
      verifyUrl: document.verifyUrl ?? "",
      reason: "",
    } });
  };
  const openRestore = (document: TrustDocument) => { setEditorError(null); setEditor({ mode: "restore", document, reason: "" }); };
  const close = () => { if (!saving) setEditor(null); };

  const submit = async () => {
    if (!editor) return;
    if (editor.mode === "upload") {
      const { file, fields, document } = editor;
      if (!file) { setEditorError("请选择要上传的 PDF 文件。"); return; }
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { setEditorError("只能上传 PDF 文件。"); return; }
      if (file.size > TRUST_DOCUMENT_MAX_BYTES) { setEditorError("文件不能超过 20 MB。"); return; }
      if (document.slot === "whitepaper" && !fields.version.trim()) { setEditorError("白皮书需要填写版本号，例如 v1.4。"); return; }
      if (document.slot !== "whitepaper" && !fields.referenceNo.trim()) { setEditorError("资质文件需要填写登记号。"); return; }
      if (fields.verifyUrl.trim() && !fields.verifyUrl.trim().startsWith("https://")) { setEditorError("官方查询链接需以 https:// 开头。"); return; }
      if (fields.reason.trim().length < 8) { setEditorError("操作原因至少 8 个字。"); return; }
    } else if (editor.reason.trim().length < 8) { setEditorError("操作原因至少 8 个字。"); return; }
    setSaving(true); setEditorError(null);
    try {
      const updated = editor.mode === "upload"
        ? await uploadTrustDocument(editor.document, editor.file as File, editor.fields)
        : await restoreTrustDocument(editor.document, editor.reason);
      setDocuments((rows) => rows.map((row) => row.slot === updated.slot ? updated : row));
      setEditor(null);
    } catch (cause) { setEditorError(displayAdminError(cause)); }
    finally { setSaving(false); }
  };

  const name = editor ? TRUST_DOCUMENT_NAMES[editor.document.slot] : "";
  const setField = (key: keyof TrustDocumentUpload, value: string) =>
    editor?.mode === "upload" && setEditor({ ...editor, fields: { ...editor.fields, [key]: value } });

  return (
    <section className="l-card" data-testid="trust-documents">
      <div className="l-h">
        <span className="ttl">资料文件</span>
        <span className="sub">· App 信任中心与白皮书页展示 · 未上传时显示默认文件</span>
        <div className="r">
          <button className="l-btn sm" onClick={() => void refresh()} disabled={loading}>刷新</button>
        </div>
      </div>
      {error && <div className="itint danger" role="alert" style={{ margin: "0 16px 12px" }}>{error}</div>}
      <div style={{ overflowX: "auto" }}>
        <table className="l-tbl" style={{ minWidth: 920 }}>
          <thead><tr><th>资料</th><th>当前文件</th><th>版本</th><th>登记号</th><th>来源</th><th>最近上传</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
          <tbody>
            {documents.map((document) => (
              <tr key={document.slot}>
                <td style={{ fontWeight: 600 }}>{TRUST_DOCUMENT_NAMES[document.slot]}</td>
                <td>
                  <div>{document.fileName}</div>
                  <div className="tiny muted">PDF · {sizeText(document.sizeBytes)} · {document.pageCount} 页{document.language ? ` · ${document.language}` : ""}</div>
                </td>
                <td className="mono">{document.version ?? "—"}</td>
                <td className="mono">
                  {document.referenceNo ?? "—"}
                  {document.verifyUrl && <div className="tiny"><a href={document.verifyUrl} target="_blank" rel="noreferrer">官方查询</a></div>}
                </td>
                <td><span className={`bdg ${document.source === "UPLOADED" ? "ok" : ""}`}>{document.source === "UPLOADED" ? "已上传" : "默认文件"}</span></td>
                <td className="mono">{document.updatedAt ? `${document.updatedAt.replace("T", " ").slice(0, 16)} · ${document.updatedBy ?? "—"}` : "—"}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <a className="l-btn sm" href={trustDocumentPreviewHref(document)} target="_blank" rel="noreferrer">预览</a>{" "}
                  {canPublish && <button className="l-btn sm mc" onClick={() => openUpload(document)}>上传新版本</button>}
                  {canPublish && document.source === "UPLOADED" && <>{" "}<button className="l-btn sm" onClick={() => openRestore(document)}>恢复默认</button></>}
                </td>
              </tr>
            ))}
            {!documents.length && <tr><td colSpan={7}><div className="itint">{loading ? "资料文件加载中…" : "暂无资料文件，请刷新。"}</div></td></tr>}
          </tbody>
        </table>
      </div>

      {editor && (
        <Drawer
          title={`${editor.mode === "upload" ? "上传新版本" : "恢复默认"} · ${name}`}
          sub={editor.mode === "upload" ? "上传后 App 立即显示新文件，可随时恢复默认文件" : "恢复后 App 显示随系统发布的默认文件"}
          onClose={close}
          footer={<>
            <button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={close} disabled={saving}>取消</button>
            <button className="l-btn mc" style={{ flex: 1, justifyContent: "center" }} onClick={() => void submit()} disabled={saving}>
              {saving ? "提交中…" : editor.mode === "upload" ? "上传并发布" : "恢复默认文件"}
            </button>
          </>}
        >
          {editorError && <div className="itint danger" role="alert" style={{ marginBottom: 12 }}>{editorError}</div>}
          {editor.mode === "upload" ? <>
            <div className="field"><span className="bf-legend">PDF 文件（最大 20 MB、80 页）</span>
              <input aria-label="PDF 文件" className="inp" type="file" accept="application/pdf,.pdf"
                onChange={(event) => setEditor({ ...editor, file: event.target.files?.[0] ?? null })} /></div>
            <div className="field"><span className="bf-legend">版本号{editor.document.slot === "whitepaper" ? "" : "（选填）"}</span>
              <input aria-label="版本号" className="inp" maxLength={32} placeholder="如 v1.4" value={editor.fields.version} onChange={(event) => setField("version", event.target.value)} /></div>
            <div className="field"><span className="bf-legend">文件语言（选填）</span>
              <input aria-label="文件语言" className="inp" maxLength={32} placeholder="如 English" value={editor.fields.language} onChange={(event) => setField("language", event.target.value)} /></div>
            {editor.document.slot !== "whitepaper" && <>
              <div className="field"><span className="bf-legend">登记号</span>
                <input aria-label="登记号" className="inp" maxLength={64} value={editor.fields.referenceNo} onChange={(event) => setField("referenceNo", event.target.value)} /></div>
              <div className="field"><span className="bf-legend">官方查询链接（选填，https）</span>
                <input aria-label="官方查询链接" className="inp" maxLength={512} placeholder="https://" value={editor.fields.verifyUrl} onChange={(event) => setField("verifyUrl", event.target.value)} /></div>
            </>}
            <div className="field"><span className="bf-legend">操作原因</span>
              <textarea aria-label="操作原因" className="inp" rows={3} maxLength={200} value={editor.fields.reason} onChange={(event) => setField("reason", event.target.value)} /></div>
          </> : <>
            <div className="itint" style={{ marginBottom: 12 }}>当前文件 {editor.document.fileName} 不再展示，App 改为显示默认文件。</div>
            <div className="field"><span className="bf-legend">操作原因</span>
              <textarea aria-label="操作原因" className="inp" rows={3} maxLength={200} value={editor.reason} onChange={(event) => setEditor({ ...editor, reason: event.target.value })} /></div>
          </>}
        </Drawer>
      )}
    </section>
  );
}
