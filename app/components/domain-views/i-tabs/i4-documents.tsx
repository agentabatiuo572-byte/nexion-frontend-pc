"use client";

/**
 * I4 的四份公司资料（App 信任中心和白皮书页展示的 PDF）。未上传时用随系统发布的默认文件。
 * 沿用既有画面；上传原文件和完整表单在发送前持久化，未知只读回；恢复默认可以按原请求原号恢复。
 * 上传和恢复默认直接生效，不走审批；和版块的「提交审批」是两类。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, FileBadge2, FileText, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { BlockState, Button, Decision, Drawer, Fact, Facts, Field, IconTile, Input, Notice, Panel, StatusTag, Textarea } from "@/app/components/rd";
import { fetchA2ReasonPolicy, visibleReasonLength } from "@/lib/admin/a2-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { businessZone } from "@/lib/admin/business-time";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  fetchTrustDocumentFile, fetchTrustDocuments,
  TRUST_DOCUMENT_MAX_BYTES, TRUST_DOCUMENT_NAMES, TRUST_DOCUMENT_SENSITIVE_AUTHORITY,
  type TrustDocument, type TrustDocumentSlot, type TrustDocumentUpload,
} from "@/lib/admin/trust-documents-client";
import { timeText } from "./i4-parts";
import { IConflictModal, useIConflictView, type IConflictRow } from "./i-conflict";
import { pendingI4DocumentCommands, submitI4Document, retryI4DocumentRestore, queryI4DocumentCommand, i4DocumentPermission, type I4DocumentCommand } from "@/lib/admin/i4-document-commands";
import { useIConflictReview, isIConflictRejection } from "@/lib/admin/i-conflict-review";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";

// 原请求由 i4-document-commands 保存；编辑器仅持有输入，未知时冻结。
export type I4DocumentEditor =
  | { mode: "upload"; document: TrustDocument; file: File | null; fields: TrustDocumentUpload }
  | { mode: "restore"; document: TrustDocument; reason: string };

const sizeText = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const UPLOAD_PUBLIC = "上传成功后立即公开";
const fingerprint = (sha256?: string) => sha256 ? <span title={sha256}>{`${sha256.slice(0, 12)}…`}</span> : "—";
/** 读回的事实写成一句：哪份文件、指纹、谁什么时候换上的。 */
const observedText = (document: TrustDocument) => `${document.source === "UPLOADED" ? "上传的" : "默认的"} ${document.fileName} · 指纹 ${document.sha256.slice(0, 12)}… · ${document.updatedAt ? `${timeText(document.updatedAt)} ${document.updatedBy ?? ""}`.trim() : "没有上传记录"}`;

export function I4Documents({ onPendingChange, recovery }: { onPendingChange: () => void; recovery: I4DocumentCommand | null }) {
  const session = useAdminAuth((state) => state.session);
  const canRead = !!session?.authorities?.includes("content_i4_read");
  // 公司登记资料属合规内容，需信任中心管理权限；白皮书标准发布权限即可。
  const canPublish = (slot: TrustDocumentSlot) => !!session?.authorities?.some((authority) =>
    authority === TRUST_DOCUMENT_SENSITIVE_AUTHORITY || slot === "whitepaper" && authority === "content_i4_publish_standard");
  const [documents, setDocuments] = useState<TrustDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<I4DocumentEditor | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reasonMin, setReasonMin] = useState(8);
  const [reasonPolicyReady, setReasonPolicyReady] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const [editorBaselineReady, setEditorBaselineReady] = useState(true);
  /** 第一次提交被明确拒绝是因为资料刚被别人换过（不是结果未知）。 */
  const [conflicted, setConflicted] = useState(false);
  // 别人先换过：核对框把 review.latest 对着 review.requested 和 review.rejectedCommand.file 给运营看；
  // 只有运营点「在最新的基础上继续」（review.confirm）才换基准、解锁提交。
  const conflictReview = useIConflictReview<TrustDocument, I4DocumentEditor, I4DocumentCommand>();
  const conflictView = useIConflictView(conflictReview.review);
  const submitting = useRef(false);
  /** 只管显示：第一次读完之前画加载块，不画「没读到」。 */
  const [read, setRead] = useState(false);

  const refresh = useCallback(async () => {
    if (!canRead) return;
    setLoading(true); setError(null);
    try { const latest = await fetchTrustDocuments(); setDocuments(latest); setFresh(true); return latest; }
    catch (cause) { setFresh(false); setError(displayAdminError(cause)); }
    finally { setLoading(false); setRead(true); }
  }, [canRead]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    fetchA2ReasonPolicy().then(policy => { setReasonMin(policy.minChars); setReasonPolicyReady(true); }, cause => { setEditorError(displayAdminError(cause)); });
  }, []);
  useEffect(() => {
    if (!recovery) return;
    setConflicted(false);
    setPendingKey(recovery.commandKey);
    setEditor(recovery.mode === "upload" ? { mode: "upload", document: recovery.document, file: null, fields: recovery.fields }
      : { mode: "restore", document: recovery.document, reason: recovery.fields.reason });
    const observed = recovery.observation;
    setEditorError((recovery.mode === "upload" ? "文件可能已经对外公开。" : "可能已经恢复。")
      + (observed ? `上次读到现在用的：${observedText(observed)}` : ""));
    if (observed) void refresh();
  }, [recovery]);
  if (!canRead) return null;

  const openUpload = (document: TrustDocument) => {
    if (!fresh || loading || i4DocumentPermission(document.slot) || pendingI4DocumentCommands().some(row => row.document.slot === document.slot)) return;
    setPendingKey(null); setEditorError(null); setEditorBaselineReady(true); setConflicted(false);
    setEditor({ mode: "upload", document, file: null, fields: {
      version: document.slot === "whitepaper" ? "" : document.version ?? "",
      language: document.language ?? "",
      referenceNo: document.referenceNo ?? "",
      verifyUrl: document.verifyUrl ?? "",
      reason: "",
    } });
  };
  const openRestore = (document: TrustDocument) => {
    if (!fresh || loading || i4DocumentPermission(document.slot) || pendingI4DocumentCommands().some(row => row.document.slot === document.slot)) return;
    setPendingKey(null); setEditorError(null); setEditorBaselineReady(true); setConflicted(false);
    setEditor({ mode: "restore", document, reason: "" });
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
  const close = () => { if (!submitting.current) { setEditor(null); setPendingKey(null); } };

  const submit = async () => {
    if (!editor || submitting.current) return;
    if (pendingKey) {
      const original = pendingI4DocumentCommands().find(row => row.commandKey === pendingKey);
      if (!original || original.mode !== "restore") return;
      submitting.current = true; setSaving(true);
      try { await retryI4DocumentRestore(original); setEditor(null); setPendingKey(null); setFresh(false); await refresh(); }
      catch (cause) {
        setEditorError(displayAdminError(cause));
        if (!pendingI4DocumentCommands().some(row => row.commandKey === pendingKey)) { setEditor(null); setPendingKey(null); setFresh(false); await refresh(); }
      } finally { submitting.current = false; setSaving(false); onPendingChange(); }
      return;
    }
    if (editor.mode === "restore" && editor.document.source === "DEFAULT") { setEditorError("现在已经是默认文件了，不用再恢复。"); return; }
    if (!fresh || loading || !editorBaselineReady) { setEditorError("请先成功重新读取最新资料后再修改。"); return; }
    if (!reasonPolicyReady) { setEditorError("理由规则加载失败，暂时无法提交。请关闭弹窗后重试。"); return; }
    const fields = editor.mode === "upload" ? editor.fields : { version: "", language: "", referenceNo: "", verifyUrl: "", reason: editor.reason };
    if (editor.mode === "upload") {
      const { file, document } = editor;
      if (!file) { setEditorError("请选择要上传的 PDF 文件。"); return; }
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { setEditorError("只能上传 PDF 文件。"); return; }
      if (file.size > TRUST_DOCUMENT_MAX_BYTES) { setEditorError("文件不能超过 20 MB。"); return; }
      if (document.slot === "whitepaper" && !fields.version.trim()) { setEditorError("白皮书需要填写版本号，例如 v1.4。"); return; }
      if (document.slot !== "whitepaper" && !fields.referenceNo.trim()) { setEditorError("资质文件需要填写登记号。"); return; }
      if (fields.verifyUrl.trim() && !fields.verifyUrl.trim().startsWith("https://")) { setEditorError("官方查询链接需以 https:// 开头。"); return; }
    }
    if (visibleReasonLength(fields.reason) < reasonMin || visibleReasonLength(fields.reason) > 200) { setEditorError(`操作原因至少 ${reasonMin} 个字。`); return; }
    submitting.current = true; setSaving(true); setEditorError(null);
    try {
      await submitI4Document(editor.document, fields, editor.mode === "upload" ? editor.file! : undefined);
      setEditor(null); setPendingKey(null); setFresh(false);
      await refresh();
    } catch (cause) {
      setEditorError(editor.mode === "restore" && (cause as { reasonCode?: string }).reasonCode === "TRUST_DOCUMENT_ALREADY_DEFAULT"
        ? "现在已经是默认文件了，不用再恢复。" : displayAdminError(cause));
      const pending = pendingI4DocumentCommands().find(row => row.document.slot === editor.document.slot);
      if (pending) setPendingKey(pending.commandKey);
      else if (editor.mode === "restore" && (cause as { reasonCode?: string }).reasonCode === "TRUST_DOCUMENT_ALREADY_DEFAULT") {
        setEditorBaselineReady(false); setFresh(false); setDocuments([]);
        const document = (await refresh())?.find(row => row.slot === editor.document.slot);
        if (document) { setEditor({ ...editor, document }); setEditorBaselineReady(true); }
        else setEditor(null);
      } else if (isIConflictRejection(cause)) {
        setConflicted(true);
        setEditorBaselineReady(false);
        await conflictReview.reject(cause, editor, async () => {
          const document = (await refresh())?.find(row => row.slot === editor.document.slot);
          if (!document) throw new Error("四份资料这次没读到，点「重新读取」再试。");
          return document;
        });
      }
    } finally { submitting.current = false; setSaving(false); onPendingChange(); }
  };
  const readBack = async () => {
    if (conflicted) {
      await conflictReview.reread();
      return;
    }
    if (pendingKey) {
      const original = pendingI4DocumentCommands().find(row => row.commandKey === pendingKey);
      if (original) {
        try {
          const current = await queryI4DocumentCommand(original);
          setEditorError(`${original.mode === "upload" ? "文件可能已经对外公开。" : "可能已经恢复。"}刚读到现在用的：${observedText(current)}`);
        } catch (cause) { setEditorError(displayAdminError(cause)); }
        onPendingChange();
      }
    }
    const latest = await refresh();
    if (!pendingKey && editor) {
      const document = latest?.find(row => row.slot === editor.document.slot);
      if (document) {
        // This existing action is the operator's reread. Keep file, metadata and reason,
        // and show the fresh document in the existing facts before the next submission.
        setEditor(current => current ? { ...current, document } : null);
        setEditorBaselineReady(true);
        setConflicted(false);
        setEditorError(null);
      } else setEditorBaselineReady(false);
    }
  };

  const name = editor ? TRUST_DOCUMENT_NAMES[editor.document.slot] : "";
  const pendingFile = pendingKey && editor?.mode === "upload" ? pendingI4DocumentCommands().find(row => row.commandKey === pendingKey)?.file : undefined;
  const setField = (key: keyof TrustDocumentUpload, value: string) =>
    !saving && !pendingKey && !conflicted && editor?.mode === "upload" && setEditor({ ...editor, fields: { ...editor.fields, [key]: value } });
  const uploaded = documents.filter((document) => document.source === "UPLOADED").length;

  /* ---------- 别人先换过：现在用的文件对着运营要传的，确认后在最新的基础上继续 ---------- */
  const conflict = conflictReview.review;
  const conflictUi = (() => {
    if (!conflict || !conflictView.open || !editor || !conflicted) return null;
    const { requested } = conflict;
    const latest = conflict.latest;
    const file = conflict.rejectedCommand?.file;
    const upload = requested.mode === "upload";
    const sourceText = (document?: TrustDocument) => !document ? "—" : document.source === "UPLOADED" ? "上传的文件" : "默认文件";
    const same = (a?: string | null, b?: string | null) => (a ?? "").trim() === (b ?? "").trim();
    const rows: IConflictRow[] = !latest ? [] : [
      { label: "来源", left: sourceText(latest), right: upload ? "上传的文件" : "默认文件", changed: upload ? latest.source !== "UPLOADED" : latest.source !== "DEFAULT" },
      { label: "文件", left: latest.fileName, right: upload ? file?.name ?? requested.file?.name ?? "—" : "随系统发布的默认文件", changed: false },
      { label: "文件指纹", left: fingerprint(latest.sha256), right: upload ? fingerprint(file?.sha256) : "—", changed: upload && latest.sha256 !== file?.sha256 },
      { label: "换上的人", left: latest.updatedBy ?? "—", right: "—" },
      { label: "换上的时间", left: timeText(latest.updatedAt), right: "—" },
      ...(upload ? [
        ...(latest.slot === "whitepaper"
          ? [{ label: "版本号", left: latest.version ?? "—", right: requested.fields.version.trim() || "—", changed: !same(latest.version, requested.fields.version) }]
          : [{ label: "登记号", left: latest.referenceNo ?? "—", right: requested.fields.referenceNo.trim() || "—", changed: !same(latest.referenceNo, requested.fields.referenceNo) }]),
        ...(!same(latest.language, requested.fields.language) ? [{ label: "文件语言", left: latest.language ?? "—", right: requested.fields.language.trim() || "—", changed: true }] : []),
        ...(!same(latest.verifyUrl, requested.fields.verifyUrl) ? [{ label: "官方查询链接", left: latest.verifyUrl ?? "—", right: requested.fields.verifyUrl.trim() || "—", changed: true }] : []),
      ] : []),
    ];
    const gone = latest && !upload && latest.source === "DEFAULT" ? "现在已经是默认文件了，不用再恢复。" : undefined;
    const finish = (task: () => void) => {
      if (!conflictReview.confirm(conflict, () => undefined)) return;
      conflictView.show();
      task();
    };
    return <IConflictModal review={conflict} subject={TRUST_DOCUMENT_NAMES[requested.document.slot]}
      lead={upload ? "别人先换了文件，这次没上传；你选的文件和填的都还在。" : "别人先换了文件，这次没恢复；你填的理由还在。"}
      rows={rows} columns={upload ? ["现在用的", "你要传的"] : ["现在用的", "你要恢复成"]} gone={gone}
      note={upload ? "继续上传会替换现在这份；不想替换就放弃这次修改。" : "继续恢复会替换现在这份；不想替换就放弃这次修改。"}
      rebuildLabel="在最新的基础上继续"
      onReread={() => void conflictReview.reread()} onClose={conflictView.hide}
      onRebuild={() => { conflictReview.confirm(conflict, (reviewed, document) => {
        setEditor({ ...reviewed, document }); setEditorBaselineReady(true); setConflicted(false); setEditorError(null);
      }); }}
      onDiscard={() => finish(() => { setEditor(null); setPendingKey(null); setConflicted(false); setEditorError(null); })} />;
  })();

  return (
    <section data-testid="trust-documents">
      <Panel title="四份公司资料" icon={FileBadge2} tone="role-1"
        sub={documents.length ? `${uploaded} 份用上传的 · ${documents.length - uploaded} 份用默认文件` : undefined}
        explain={<><p>App 信任中心和白皮书页展示的 PDF。没有用上传的文件时，显示随系统发布的默认文件。</p><p>上传和恢复默认不走审批，成功后立即公开，App 下次读取时换上。白皮书要标准发布或信任中心管理权限，三份公司登记资料要信任中心管理权限。</p></>}
        actions={<Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={loading} onClick={() => void refresh()}>刷新</Button>}>
        {error && documents.length > 0 && <div className="rd-panel-line"><Notice tone="danger" title="资料没读到最新">{error} 下面是上次读到的。</Notice></div>}
        {!documents.length
          ? loading || !read ? <BlockState state="loading" title="资料文件加载中…" />
            : <BlockState state="error" title="四份资料没读到" detail={error ?? "暂时读不到，请稍后重试。"} onRetry={() => void refresh()} />
          : <div className="i4-docs">
            {documents.map((document) => {
              const isUploaded = document.source === "UPLOADED";
              const writable = canPublish(document.slot);
              const blocked = !fresh || loading ? "请先成功重新读取最新资料后再修改。" : pendingI4DocumentCommands().some(row => row.document.slot === document.slot) ? "这份资料有结果未知的原操作，请先重新读取核对。" : undefined;
              return (
                <article className="i4-doc" key={document.slot} aria-label={TRUST_DOCUMENT_NAMES[document.slot]}>
                  <header className="i4-doc-head">
                    <IconTile tone="role-1" icon={FileText} size={28} />
                    <h3>{TRUST_DOCUMENT_NAMES[document.slot]}</h3>
                  </header>
                  <p className="i4-doc-file" title={document.fileName} data-user-content="">{document.fileName}</p>
                  <p className="i4-doc-size">PDF · {sizeText(document.sizeBytes)} · {document.pageCount} 页{document.language ? ` · ${document.language}` : ""}</p>
                  <dl className="i4-doc-facts">
                    <div><dt>现在用的</dt><dd><StatusTag tone={isUploaded ? "progress" : "neutral"} explain={isUploaded ? "用的是后台上传的文件，可以恢复成默认文件。" : "现在用随系统发布的默认文件。"}>{isUploaded ? "上传的文件" : "默认文件"}</StatusTag></dd></div>
                    {document.slot === "whitepaper"
                      ? <div><dt>版本</dt><dd data-empty={document.version ? undefined : ""}>{document.version ?? "—"}</dd></div>
                      : <div><dt>登记号</dt><dd data-mono="" data-empty={document.referenceNo ? undefined : ""}>{document.referenceNo ?? "—"}</dd></div>}
                    <div><dt>最近上传</dt><dd data-empty={document.updatedAt ? undefined : ""}>{document.updatedAt ? timeText(document.updatedAt) : "—"}</dd></div>
                    {document.updatedAt && <div><dt>上传人</dt><dd data-empty={document.updatedBy ? undefined : ""}>{document.updatedBy ?? "—"}</dd></div>}
                  </dl>
                  <footer className="i4-doc-actions">
                    <span className="i4-doc-reads">
                      <Button size="sm" variant="ghost" onClick={() => void preview(document)}>预览</Button>
                      {document.verifyUrl && <a className="rd-link i4-doc-verify" href={document.verifyUrl} target="_blank" rel="noreferrer">官方查询<ExternalLink size={12} aria-hidden /></a>}
                    </span>
                    {writable && <span className="i4-doc-writes">
                      {isUploaded && <Button size="sm" variant="ghost" icon={<RotateCcw size={14} aria-hidden />} disabledReason={blocked} onClick={() => openRestore(document)}>恢复默认</Button>}
                      <Button size="sm" icon={<Upload size={14} aria-hidden />} disabledReason={blocked} onClick={() => openUpload(document)}>上传新版本</Button>
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
          primary={<Button variant="primary" loading={saving} loadingText="提交中…" disabledReason={pendingKey ? (editor.mode === "upload" ? "上传结果未知，请重新读取核对，不能重发原上传请求。" : isRetryExpired(pendingI4DocumentCommands().find(row => row.commandKey === pendingKey) ?? { expiresAt: 0 }) ? RETRY_EXPIRED_TEXT : i4DocumentPermission(editor.document.slot)) : !reasonPolicyReady ? "理由规则加载失败，暂时无法提交。" : conflicted ? "先核对别人刚换上的文件" : !fresh || !editorBaselineReady ? "请先成功重新读取最新资料后再修改。" : editor.mode === "restore" && editor.document.source === "DEFAULT" ? "现在已经是默认文件了，不用再恢复。" : undefined} onClick={() => void submit()}>{editor.mode === "upload" ? "上传并公开" : pendingKey ? "按原请求重试" : "恢复默认文件"}</Button>} />}>
        {editor && <div className="rd-stack i4-doc-editor">
          {editor.mode === "upload"
            ? <Notice tone="warn" title={UPLOAD_PUBLIC}>不走审批；App 下次读取时换成这份，之后可以恢复成默认文件。</Notice>
            : <Notice tone="warn" title="恢复后立即生效">不走审批；App 下次读取时改显示随系统发布的默认文件。</Notice>}
          {editorError && (pendingKey
            ? <Notice tone="warn" title={editor.mode === "upload" ? "上传结果未知" : "恢复结果未知"}
              action={<Button size="sm" loading={loading} onClick={() => void readBack()}>重新读取核对</Button>} actionBelow>
              <p>{editorError}</p>
              <p>{editor.mode === "upload" ? "上传不能重发：第一次若已成功，重发会被当成文件已变而拒绝。重新读取后，对照文件指纹和上传时间。" : "重新读取，看卡片是不是已经变回默认文件；没变可以按原请求重试。"}</p>
            </Notice>
            : conflicted
              ? <Notice tone="warn" title={editor.mode === "upload" ? "这次没有上传" : "这次没有恢复"}
                action={<Button size="sm" onClick={conflictView.show}>核对</Button>} actionBelow>
                这份资料刚被别人换过；核对完之前，下面的内容都改不了。
              </Notice>
              : <Notice tone="danger" title={editor.mode === "upload" ? "这次没有上传" : "这次没有恢复"}>{editorError}</Notice>)}
          <Facts>
            <Fact k={conflicted ? "你打开时用的" : "现在用的"}>{editor.document.source === "UPLOADED" ? "已上传的文件" : "默认文件"}</Fact>
            <Fact k="文件"><span title={editor.document.fileName} data-user-content="">{editor.document.fileName}</span></Fact>
            {editor.mode === "restore" && <Fact k="恢复成">随系统发布的默认文件</Fact>}
            {pendingFile && <Fact k="原上传的文件"><span data-user-content="" title={`SHA256 ${pendingFile.sha256}`}>{`${pendingFile.name} · ${sizeText(pendingFile.size)} · 指纹 ${pendingFile.sha256.slice(0, 12)}…`}</span></Fact>}
          </Facts>
          {editor.mode === "upload" ? <>
            {!pendingFile && <Field label="PDF 文件" required help="最大 20 MB、80 页">
              <input aria-label="PDF 文件" className="rd-input rd-file-input" type="file" disabled={saving || !!pendingKey || conflicted} accept="application/pdf,.pdf"
                onChange={(event) => { if (!saving && !pendingKey && !conflicted) setEditor({ ...editor, file: event.target.files?.[0] ?? null }); }} />
            </Field>}
            <div className="rd-form-grid" data-cols="2" data-dense="">
              <Field label="版本号" required={editor.document.slot === "whitepaper"} hint={editor.document.slot === "whitepaper" ? undefined : "选填"}>
                <Input aria-label="版本号" disabled={saving || !!pendingKey || conflicted} maxLength={32} placeholder="如 v1.4" value={editor.fields.version} onChange={(event) => setField("version", event.target.value)} />
              </Field>
              <Field label="文件语言" hint="选填">
                <Input aria-label="文件语言" disabled={saving || !!pendingKey || conflicted} maxLength={32} placeholder="如 English" value={editor.fields.language} onChange={(event) => setField("language", event.target.value)} />
              </Field>
            </div>
            {editor.document.slot !== "whitepaper" && <div className="rd-form-grid" data-cols="2" data-dense="">
              <Field label="登记号" required>
                <Input aria-label="登记号" disabled={saving || !!pendingKey || conflicted} maxLength={64} value={editor.fields.referenceNo} onChange={(event) => setField("referenceNo", event.target.value)} />
              </Field>
              <Field label="官方查询链接" hint="选填，https 开头">
                <Input aria-label="官方查询链接" disabled={saving || !!pendingKey || conflicted} maxLength={512} placeholder="https://" value={editor.fields.verifyUrl} onChange={(event) => setField("verifyUrl", event.target.value)} />
              </Field>
            </div>}
            <Field label="操作原因" required hint={`至少 ${reasonMin} 字`}>
              <Textarea aria-label="操作原因" disabled={saving || !!pendingKey || conflicted} rows={3} maxLength={200} count={`${editor.fields.reason.trim().length}/200`} value={editor.fields.reason} onChange={(event) => setField("reason", event.target.value)} />
            </Field>
          </> : <>
            <Field label="操作原因" required hint={`至少 ${reasonMin} 字`}>
              <Textarea aria-label="操作原因" disabled={saving || !!pendingKey || conflicted} rows={3} maxLength={200} count={`${editor.reason.trim().length}/200`} value={editor.reason} onChange={(event) => { if (!saving && !pendingKey && !conflicted) setEditor({ ...editor, reason: event.target.value }); }} />
            </Field>
          </>}
        </div>}
      </Drawer>
      {conflictUi}
    </section>
  );
}
