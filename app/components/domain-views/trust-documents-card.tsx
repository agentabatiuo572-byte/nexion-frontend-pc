"use client";

import { useCallback, useEffect, useState } from "react";
import { Drawer } from "./design-kit";
import { createA2CommandKey, fetchA2ReasonPolicy } from "@/lib/admin/a2-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  fetchTrustDocumentFile, fetchTrustDocuments, restoreTrustDocument, uploadTrustDocument,
  TRUST_DOCUMENT_MAX_BYTES, TRUST_DOCUMENT_NAMES, TRUST_DOCUMENT_SENSITIVE_AUTHORITY,
  type TrustDocument, type TrustDocumentSlot, type TrustDocumentUpload,
} from "@/lib/admin/trust-documents-client";

/** I4 资料文件：App 信任中心与白皮书页展示的 PDF。未上传时显示随系统发布的默认文件。 */
// key 跟着表单内容走：内容不变的重试沿用同一个幂等键（超时后重试会拿回第一次的结果），改了文件或字段就换新键。
type Editor =
  | { mode: "upload"; document: TrustDocument; file: File | null; fields: TrustDocumentUpload; key: string }
  | { mode: "restore"; document: TrustDocument; reason: string; key: string };

export function TrustDocumentsCard() {
  const session = useAdminAuth((state) => state.session);
  const isSuperadmin = session?.role === "superadmin";
  const canRead = isSuperadmin || !!session?.authorities?.includes("content_i4_read");
  // 公司登记资料属合规内容，需信任中心管理权限；白皮书标准发布权限即可。
  const canPublish = (slot: TrustDocumentSlot) => isSuperadmin || !!session?.authorities?.some((authority) =>
    authority === TRUST_DOCUMENT_SENSITIVE_AUTHORITY || slot === "whitepaper" && authority === "content_i4_publish_standard");
  const [documents, setDocuments] = useState<TrustDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reasonMin, setReasonMin] = useState(8);

  const refresh = useCallback(async () => {
    if (!canRead) return;
    setLoading(true); setError(null);
    try { setDocuments(await fetchTrustDocuments()); }
    catch (cause) { setError(displayAdminError(cause)); }
    finally { setLoading(false); }
  }, [canRead]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { fetchA2ReasonPolicy().then((policy) => setReasonMin(policy.minChars), () => undefined); }, []);
  if (!canRead) return null;

  const openUpload = (document: TrustDocument) => {
    setEditorError(null);
    setEditor({ mode: "upload", document, file: null, fields: {
      version: document.slot === "whitepaper" ? "" : document.version ?? "",
      language: document.language ?? "",
      referenceNo: document.referenceNo ?? "",
      verifyUrl: document.verifyUrl ?? "",
      reason: "",
    }, key: createA2CommandKey("i4-trust-document") });
  };
  const openRestore = (document: TrustDocument) => {
    setEditorError(null);
    setEditor({ mode: "restore", document, reason: "", key: createA2CommandKey("i4-trust-document") });
  };
  const preview = async (document: TrustDocument) => {
    // 先同步开窗避免被拦截；读取失败时关掉空窗，在卡片里显示原因。
    const tab = window.open("", "_blank");
    try {
      const url = URL.createObjectURL(await fetchTrustDocumentFile(document));
      if (tab) { tab.opener = null; tab.location.href = url; } else window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      tab?.close();
      setError(displayAdminError(cause));
    }
  };
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
      if (fields.reason.trim().length < reasonMin) { setEditorError(`操作原因至少 ${reasonMin} 个字。`); return; }
    } else if (editor.reason.trim().length < reasonMin) { setEditorError(`操作原因至少 ${reasonMin} 个字。`); return; }
    setSaving(true); setEditorError(null);
    try {
      const updated = editor.mode === "upload"
        ? await uploadTrustDocument(editor.document, editor.file as File, editor.fields, editor.key)
        : await restoreTrustDocument(editor.document, editor.reason, editor.key);
      setDocuments((rows) => rows.map((row) => row.slot === updated.slot ? updated : row));
      setEditor(null);
    } catch (cause) { setEditorError(displayAdminError(cause)); }
    finally { setSaving(false); }
  };

  const name = editor ? TRUST_DOCUMENT_NAMES[editor.document.slot] : "";
  const setField = (key: keyof TrustDocumentUpload, value: string) =>
    editor?.mode === "upload" && setEditor({ ...editor, fields: { ...editor.fields, [key]: value }, key: createA2CommandKey("i4-trust-document") });

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
                  <div className="tiny muted">PDF · {document.sizeBytes >= 1024 * 1024 ? `${(document.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(document.sizeBytes / 1024))} KB`} · {document.pageCount} 页{document.language ? ` · ${document.language}` : ""}</div>
                </td>
                <td className="mono">{document.version ?? "—"}</td>
                <td className="mono">
                  {document.referenceNo ?? "—"}
                  {document.verifyUrl && <div className="tiny"><a href={document.verifyUrl} target="_blank" rel="noreferrer">官方查询</a></div>}
                </td>
                <td><span className={`bdg ${document.source === "UPLOADED" ? "ok" : ""}`}>{document.source === "UPLOADED" ? "已上传" : "默认文件"}</span></td>
                <td className="mono">{document.updatedAt ? `${document.updatedAt.replace("T", " ").slice(0, 16)} · ${document.updatedBy ?? "—"}` : "—"}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="l-btn sm" onClick={() => void preview(document)}>预览</button>{" "}
                  {canPublish(document.slot) && <button className="l-btn sm mc" onClick={() => openUpload(document)}>上传新版本</button>}
                  {canPublish(document.slot) && document.source === "UPLOADED" && <>{" "}<button className="l-btn sm" onClick={() => openRestore(document)}>恢复默认</button></>}
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
                onChange={(event) => setEditor({ ...editor, file: event.target.files?.[0] ?? null, key: createA2CommandKey("i4-trust-document") })} /></div>
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
              <textarea aria-label="操作原因" className="inp" rows={3} maxLength={200} value={editor.reason} onChange={(event) => setEditor({ ...editor, reason: event.target.value, key: createA2CommandKey("i4-trust-document") })} /></div>
          </>}
        </Drawer>
      )}
    </section>
  );
}
