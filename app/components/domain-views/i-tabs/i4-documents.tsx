"use client";

/**
 * I4 的四份公司资料（App 信任中心和白皮书页展示的 PDF）。未上传时用随系统发布的默认文件。
 * 读取、预览、上传、恢复默认的逻辑和旧的 trust-documents-card 一样（请求、校验、命令号的换法都没改），这里只换画法。
 * 上传和恢复默认直接生效，不走审批；和版块的「提交审批」是两类。
 */
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FileBadge2, FileText, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { BlockState, Button, Decision, Drawer, Fact, Facts, Field, IconTile, Input, Notice, Panel, StatusTag, Textarea } from "@/app/components/rd";
import { createA2CommandKey, fetchA2ReasonPolicy } from "@/lib/admin/a2-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { businessZone } from "@/lib/admin/business-time";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  fetchTrustDocumentFile, fetchTrustDocuments, restoreTrustDocument, uploadTrustDocument,
  TRUST_DOCUMENT_MAX_BYTES, TRUST_DOCUMENT_NAMES, TRUST_DOCUMENT_SENSITIVE_AUTHORITY,
  type TrustDocument, type TrustDocumentSlot, type TrustDocumentUpload,
} from "@/lib/admin/trust-documents-client";
import { timeText } from "./i4-parts";

// key 跟着表单内容走：内容不变的重试沿用同一个幂等键，改了文件或字段就换新键（和旧卡片一样）。
type Editor =
  | { mode: "upload"; document: TrustDocument; file: File | null; fields: TrustDocumentUpload; key: string }
  | { mode: "restore"; document: TrustDocument; reason: string; key: string };

const sizeText = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const UPLOAD_PUBLIC = "上传成功后立即对所有用户公开";

export function I4Documents() {
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
  /** 只管显示：第一次读完之前画加载块，不画「没读到」。 */
  const [read, setRead] = useState(false);

  const refresh = useCallback(async () => {
    if (!canRead) return;
    setLoading(true); setError(null);
    try { setDocuments(await fetchTrustDocuments()); }
    catch (cause) { setError(displayAdminError(cause)); }
    finally { setLoading(false); setRead(true); }
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
    // 先同步开窗避免被拦截；读取失败时关掉空窗，在面板里显示原因。
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
  const uploaded = documents.filter((document) => document.source === "UPLOADED").length;

  return (
    <section data-testid="trust-documents">
      <Panel title="四份公司资料" icon={FileBadge2} tone="role-1"
        sub={documents.length ? `${uploaded} 份用上传的 · ${documents.length - uploaded} 份用默认文件` : undefined}
        explain={<><p>App 信任中心和白皮书页展示的 PDF。没上传过的显示随系统发布的默认文件。</p><p>上传和恢复默认不走审批，成功后立即对所有用户公开。白皮书要标准发布或信任中心管理权限，三份公司登记资料要信任中心管理权限。</p></>}
        actions={<Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={loading} onClick={() => void refresh()}>刷新</Button>}>
        {error && documents.length > 0 && <div className="rd-panel-line"><Notice tone="danger" title="资料没读到最新">{error} 下面是上次读到的。</Notice></div>}
        {!documents.length
          ? loading || !read ? <BlockState state="loading" title="资料文件加载中…" />
            : <BlockState state="error" title="四份资料没读到" detail={error ?? "暂时读不到，请稍后重试。"} onRetry={() => void refresh()} />
          : <div className="i4-docs">
            {documents.map((document) => {
              const isUploaded = document.source === "UPLOADED";
              const writable = canPublish(document.slot);
              return (
                <article className="i4-doc" key={document.slot} aria-label={TRUST_DOCUMENT_NAMES[document.slot]}>
                  <header className="i4-doc-head">
                    <IconTile tone="role-1" icon={FileText} size={28} />
                    <h3>{TRUST_DOCUMENT_NAMES[document.slot]}</h3>
                  </header>
                  <p className="i4-doc-file" title={document.fileName} data-user-content="">{document.fileName}</p>
                  <p className="i4-doc-size">PDF · {sizeText(document.sizeBytes)} · {document.pageCount} 页{document.language ? ` · ${document.language}` : ""}</p>
                  <dl className="i4-doc-facts">
                    <div><dt>现在用的</dt><dd><StatusTag tone={isUploaded ? "progress" : "neutral"} explain={isUploaded ? "用的是后台上传的文件，可以恢复成默认文件。" : "没上传过，用随系统发布的默认文件。"}>{isUploaded ? "上传的文件" : "默认文件"}</StatusTag></dd></div>
                    {document.slot === "whitepaper"
                      ? <div><dt>版本</dt><dd data-empty={document.version ? undefined : ""}>{document.version ?? "—"}</dd></div>
                      : <div><dt>登记号</dt><dd data-mono="" data-empty={document.referenceNo ? undefined : ""}>{document.referenceNo ?? "—"}</dd></div>}
                    <div><dt>最近上传</dt><dd data-empty={document.updatedAt ? undefined : ""}>{document.updatedAt ? timeText(document.updatedAt) : "— 没有上传记录"}</dd></div>
                    {document.updatedAt && <div><dt>上传人</dt><dd data-empty={document.updatedBy ? undefined : ""}>{document.updatedBy ?? "—"}</dd></div>}
                  </dl>
                  <footer className="i4-doc-actions">
                    <span className="i4-doc-reads">
                      <Button size="sm" variant="ghost" onClick={() => void preview(document)}>预览</Button>
                      {document.verifyUrl && <a className="rd-link i4-doc-verify" href={document.verifyUrl} target="_blank" rel="noreferrer">官方查询<ExternalLink size={12} aria-hidden /></a>}
                    </span>
                    {writable && <span className="i4-doc-writes">
                      {isUploaded && <Button size="sm" variant="ghost" icon={<RotateCcw size={14} aria-hidden />} onClick={() => openRestore(document)}>恢复默认</Button>}
                      <Button size="sm" icon={<Upload size={14} aria-hidden />} onClick={() => openUpload(document)}>上传新版本</Button>
                    </span>}
                  </footer>
                </article>
              );
            })}
          </div>}
        {documents.length > 0 && <p className="rd-note i4-docs-zone">上传时间为{businessZone().label}</p>}
      </Panel>

      <Drawer open={!!editor} onClose={close} busy={saving}
        title={editor?.mode === "restore" ? "恢复默认文件" : "上传新版本"} sub={name} icon={editor?.mode === "restore" ? RotateCcw : Upload} tone="role-1"
        footer={editor && <Decision
          others={<Button onClick={close} disabled={saving}>取消</Button>}
          primary={<Button variant="primary" loading={saving} loadingText="提交中…" onClick={() => void submit()}>{editor.mode === "upload" ? "上传并公开" : "恢复默认文件"}</Button>} />}>
        {editor && <div className="rd-stack i4-doc-editor">
          {editor.mode === "upload"
            ? <Notice tone="warn" title={UPLOAD_PUBLIC}>不走审批；之后可以恢复成默认文件。</Notice>
            : <Notice tone="warn" title="恢复后立即对所有用户生效">不走审批；App 改显示随系统发布的默认文件。</Notice>}
          {editorError && <Notice tone="danger" title={editor.mode === "upload" ? "没收到上传成功的结果" : "没收到恢复成功的结果"}
            action={<Button size="sm" loading={loading} onClick={() => void refresh()}>重新读取核对</Button>} actionBelow>
            <p>{editorError}</p>
            <p>{editor.mode === "upload" ? "刚才的上传可能已经成功：先重新读取，核对卡片上的文件名和上传时间，再决定要不要重传。" : "先重新读取，核对卡片上是不是已经变回默认文件。"}</p>
          </Notice>}
          <Facts>
            <Fact k="现在用的">{editor.document.source === "UPLOADED" ? "已上传的文件" : "默认文件"}</Fact>
            <Fact k="文件"><span title={editor.document.fileName} data-user-content="">{editor.document.fileName}</span></Fact>
            {editor.mode === "restore" && <Fact k="恢复成">随系统发布的默认文件</Fact>}
          </Facts>
          {editor.mode === "upload" ? <>
            <Field label="PDF 文件" required help="最大 20 MB、80 页">
              <input aria-label="PDF 文件" className="rd-input rd-file-input" type="file" accept="application/pdf,.pdf"
                onChange={(event) => setEditor({ ...editor, file: event.target.files?.[0] ?? null, key: createA2CommandKey("i4-trust-document") })} />
            </Field>
            <div className="rd-form-grid" data-cols="2" data-dense="">
              <Field label="版本号" required={editor.document.slot === "whitepaper"} hint={editor.document.slot === "whitepaper" ? undefined : "选填"}>
                <Input aria-label="版本号" maxLength={32} placeholder="如 v1.4" value={editor.fields.version} onChange={(event) => setField("version", event.target.value)} />
              </Field>
              <Field label="文件语言" hint="选填">
                <Input aria-label="文件语言" maxLength={32} placeholder="如 English" value={editor.fields.language} onChange={(event) => setField("language", event.target.value)} />
              </Field>
            </div>
            {editor.document.slot !== "whitepaper" && <div className="rd-form-grid" data-cols="2" data-dense="">
              <Field label="登记号" required>
                <Input aria-label="登记号" maxLength={64} value={editor.fields.referenceNo} onChange={(event) => setField("referenceNo", event.target.value)} />
              </Field>
              <Field label="官方查询链接" hint="选填，https 开头">
                <Input aria-label="官方查询链接" maxLength={512} placeholder="https://" value={editor.fields.verifyUrl} onChange={(event) => setField("verifyUrl", event.target.value)} />
              </Field>
            </div>}
            <Field label="操作原因" required hint={`至少 ${reasonMin} 字`}>
              <Textarea aria-label="操作原因" rows={3} maxLength={200} count={`${editor.fields.reason.trim().length}/200`} value={editor.fields.reason} onChange={(event) => setField("reason", event.target.value)} />
            </Field>
          </> : <>
            <Field label="操作原因" required hint={`至少 ${reasonMin} 字`}>
              <Textarea aria-label="操作原因" rows={3} maxLength={200} count={`${editor.reason.trim().length}/200`} value={editor.reason} onChange={(event) => setEditor({ ...editor, reason: event.target.value, key: createA2CommandKey("i4-trust-document") })} />
            </Field>
          </>}
        </div>}
      </Drawer>
    </section>
  );
}
