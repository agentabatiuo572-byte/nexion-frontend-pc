"use client";
import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { uploadA1Avatar, cancelA1Avatar, uploadAccountAvatar, prepareDefaultAccountAvatar, cancelAccountAvatar, fetchSelfAvatar, isA1OutcomeUncertainError, A1OutcomeUncertainError, type A1Operator } from "@/lib/admin/a1-client";
import { avatarDrafts, avatarDraftFingerprint, avatarFileHash, rememberAvatarDraft, type AvatarDraft } from "@/lib/admin/account-avatar-pending";
import { type AvatarGender, type AvatarScope } from "@/lib/admin/account-avatar-contract";
import { supportClient } from "@/lib/admin/m-support-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { SupportAvatar } from "../m-tabs/support-avatar";
import "./account-avatar-controls.css";

export function AccountAvatarPicker({ account, name, disabled, scope = "admin", gender = "UNSPECIFIED", allowDefault = false, currentPath, currentVersion, onChange, onBlocking }: {
  account?: A1Operator; name: string; disabled?: boolean; scope?: AvatarScope; gender?: AvatarGender; allowDefault?: boolean;
  currentPath?: string; currentVersion?: number; onChange: (assetId?: string) => void; onBlocking: (blocking: boolean) => void;
}) {
  const session = useAdminAuth(s => s.session), epoch = useAdminAuth(s => s.authEpoch);
  const canUpload = scope === "self" || session?.role === "super" || session?.role === "superadmin";
  const actorId = session?.adminId;
  const fingerprint = actorId ? avatarDraftFingerprint(actorId, scope, scope === "self" ? "self" : account?.id ?? "new") : "";
  const [draft, setDraft] = useState<AvatarDraft | null>(null), [file, setFile] = useState<File | null>(null), [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [invalidSelection, setInvalidSelection] = useState(false), [assetExpired, setAssetExpired] = useState(false);
  const generation = useRef(0), controller = useRef<AbortController | null>(null), objectUrl = useRef("");
  const resetFile = () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = ""; setUrl(""); setFile(null); };
  const updateDraft = (next: AvatarDraft | null) => { setDraft(next); onChange(next?.asset?.assetId); onBlocking(Boolean(next && (!next.asset || next.cancelKey))); };
  useEffect(() => {
    generation.current++; controller.current?.abort(); resetFile(); setBusy(false); setError(""); setInvalidSelection(false);
    updateDraft(avatarDrafts.list().find(row => row.fingerprint === fingerprint && row.actorId === actorId) ?? null);
    return () => { generation.current++; controller.current?.abort(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); };
  }, [epoch, fingerprint]);
  const expired = Boolean(draft && Date.now() >= draft.expiresAt);
  useEffect(() => {
    setAssetExpired(false);
    if (!draft?.asset) return;
    const expire = () => { setAssetExpired(true); onBlocking(true); };
    const timer = setTimeout(expire, Math.max(0, Date.parse(draft.asset.expiresAt) - Date.now()));
    if (Date.now() >= Date.parse(draft.asset.expiresAt)) expire();
    return () => clearTimeout(timer);
  }, [draft?.asset?.assetId, draft?.asset?.expiresAt]);
  const active = (token: number) => token === generation.current && useAdminAuth.getState().session?.adminId === actorId;
  async function choose(nextFile?: File) {
    if (!nextFile || !canUpload || disabled || busy || draft?.asset || draft?.kind === "DEFAULT" || draft?.cancelKey || expired) return;
    const token = generation.current; setBusy(true); setError(""); onBlocking(true); setInvalidSelection(true);
    try {
      const policy = await supportClient.attachmentPolicy();
      if (!active(token)) return;
      if (!policy.available || !policy.allowedMimeTypes.includes(nextFile.type as "image/png" | "image/jpeg") || policy.maxBytes !== null && nextFile.size > policy.maxBytes) throw new Error("请选择符合当前格式及大小要求的 JPG 或 PNG 图片。");
      const bitmap = await createImageBitmap(nextFile); const pixels = bitmap.width * bitmap.height; bitmap.close();
      if (policy.maxPixels !== null && pixels > policy.maxPixels) throw new Error("图片像素超过当前上限。");
      const hash = await avatarFileHash(nextFile);
      if (!active(token)) return;
      if (draft?.fileHash && (draft.fileHash !== hash || draft.fileMime !== nextFile.type)) throw new Error("原上传结果尚未确认，请重新选择首次上传的同一张图片。");
      const originalFile = draft ? new File([nextFile], draft.fileName!, { type: draft.fileMime }) : nextFile;
      resetFile(); setFile(originalFile); objectUrl.current = URL.createObjectURL(originalFile); setUrl(objectUrl.current); setInvalidSelection(false);
      if (!draft) setDraft({ fingerprint, actorId: actorId!, scope, kind: "UPLOAD", clientUploadId: crypto.randomUUID(), commandKey: crypto.randomUUID(), fileHash: hash, fileName: nextFile.name, fileMime: nextFile.type, createdAt: Date.now(), expiresAt: Date.now() + 86400000 });
    } catch (e) { if (active(token)) setError(e instanceof Error && /^(图片|请选择|原上传)/.test(e.message) ? e.message : displayAdminError(e)); }
    finally { if (active(token)) setBusy(false); }
  }
  async function prepare(useDefault = false) {
    if (!actorId || !canUpload || disabled || busy || draft?.asset || draft?.cancelKey || expired) return;
    if (useDefault && !allowDefault || !useDefault && !file && draft?.kind !== "DEFAULT") return;
    const token = generation.current; setBusy(true); setError(""); onBlocking(true);
    let command = draft;
    const wasPending = Boolean(command && avatarDrafts.list().some(row => row.commandKey === command?.commandKey));
    let sent = false;
    try {
      if (!command) command = { fingerprint, actorId, scope, kind: "DEFAULT", gender, clientUploadId: crypto.randomUUID(), commandKey: crypto.randomUUID(), createdAt: Date.now(), expiresAt: Date.now() + 86400000 };
      command = rememberAvatarDraft(command); setDraft(command);
      if (scope === "self") await fetchSelfAvatar();
      if (!active(token)) return;
      const abort = new AbortController(); controller.current = abort;
      sent = true;
      const asset = command.kind === "DEFAULT" ? await prepareDefaultAccountAvatar(scope, command.gender!, command.clientUploadId, command.commandKey, abort.signal) : scope === "admin" ? await uploadA1Avatar(file!, command.clientUploadId, command.commandKey, abort.signal) : await uploadAccountAvatar("self", file!, command.clientUploadId, command.commandKey, abort.signal);
      if (!active(token)) return;
      try { updateDraft(rememberAvatarDraft({ ...command, asset })); }
      catch (cause) { throw new A1OutcomeUncertainError("A1_AVATAR_RESPONSE_UNREADABLE", command.commandKey, { cause }); }
    } catch (e) {
      if (active(token)) {
        setError(displayAdminError(e));
        if (command && !isA1OutcomeUncertainError(e) && (sent || !wasPending)) { avatarDrafts.forget(command.fingerprint, command.commandKey); updateDraft(null); resetFile(); }
      }
    } finally { if (active(token)) setBusy(false); }
  }
  async function clear() {
    if (busy || disabled || expired) return;
    if (draft && !draft.asset && avatarDrafts.list().some(row => row.commandKey === draft.commandKey)) { setError("原上传结果尚未确认，请先使用原命令查询或重试。原头像保持不变。"); return; }
    if (!draft?.asset) { updateDraft(null); resetFile(); setInvalidSelection(false); setError(""); onBlocking(false); return; }
    const token = generation.current; setBusy(true); setError(""); onBlocking(true);
    try {
      const command = rememberAvatarDraft({ ...draft, cancelKey: draft.cancelKey ?? crypto.randomUUID() }); setDraft(command);
      if (scope === "self") {
        const snapshot = await fetchSelfAvatar();
        if (!active(token)) return;
        if (snapshot.assetId === command.asset!.assetId) throw new Error("该头像已保存到本人账号，请刷新头像后再开始新的更换。");
      }
      if (scope === "admin") await cancelA1Avatar(command.asset!.assetId, command.cancelKey!);
      else await cancelAccountAvatar("self", command.asset!.assetId, command.cancelKey!);
      if (!active(token)) return;
      avatarDrafts.forget(command.fingerprint, command.commandKey); updateDraft(null); resetFile(); setInvalidSelection(false); onBlocking(false);
    } catch (e) { if (active(token)) setError(displayAdminError(e)); }
    finally { if (active(token)) setBusy(false); }
  }
  return <fieldset className="account-avatar-controls" disabled={disabled || busy} style={{ margin: "14px 0", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}><legend>账号头像</legend>
    <div style={{ display: "flex", gap: 20, alignItems: "center" }}><div><p>当前头像</p><SupportAvatar name={name || "运营账号"} path={currentPath ?? (account?.avatarAssetId ? `/api/admin/platform/accounts/${account.id}/avatar` : undefined)} version={currentVersion ?? account?.avatarVersion ?? undefined} size={64} /></div>
      {(draft?.asset || url) && <div><p>新头像 · 尚未保存到账号</p>{draft?.asset ? <SupportAvatar name={name || "运营账号"} path={draft.asset.previewRef} size={64} /> : <img src={url} alt="待上传账号头像" width={64} height={64} style={{ objectFit: "cover", borderRadius: "50%" }} />}</div>}</div>
    <p>{scope === "self" ? "仅更换本人头像，保存需要确认和理由；服务端会再次核对当前资格。" : "头像与账号资料一起提交；上传不会直接替换原图。"}失败、取消或冲突时原头像保持不变。</p>
    {canUpload ? <><label>选择 JPG / PNG 头像<input type="file" accept="image/jpeg,image/png" disabled={Boolean(draft?.asset || draft?.kind === "DEFAULT" || draft?.cancelKey || expired)} onChange={e => { void choose(e.target.files?.[0]); e.target.value = ""; }} /></label>
      {allowDefault && !draft && !invalidSelection && <button type="button" className="l-btn" onClick={() => void prepare(true)}>按所选性别准备默认头像</button>}</> : <p>需要超管权限，现有头像只读。</p>}
    {draft && <div>{!draft.asset && <button type="button" className="l-btn" disabled={expired || draft.kind === "UPLOAD" && !file} onClick={() => void prepare()}>{busy ? "正在上传…" : "上传或使用原命令重试"}</button>}
      <button type="button" className="l-btn" disabled={expired || Boolean(!draft.asset && avatarDrafts.list().some(row => row.commandKey === draft.commandKey))} onClick={() => void clear()}>{draft.cancelKey ? "重试原取消操作" : "取消新头像"}</button>
      {draft.kind === "UPLOAD" && !file && !draft.asset && <p>原上传结果尚未确认，请选择首次上传的同一张图片后使用原命令重试。</p>}
      {draft.asset && <small>素材有效期至 {new Date(draft.asset.expiresAt).toLocaleString("zh-CN")}</small>}
      {(expired || assetExpired) && <p role="alert">{expired ? "原命令已超过安全重试窗口，请联系管理员核对原结果。" : "新头像素材已过期，请取消该素材后重新选择。"}</p>}</div>}
    {invalidSelection && !draft && <button type="button" className="l-btn" onClick={() => void clear()}>取消失败的头像选择</button>}{error && <p role="alert">{error}</p>}
  </fieldset>;
}
