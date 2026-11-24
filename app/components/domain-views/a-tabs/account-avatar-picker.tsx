"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { uploadA1Avatar, cancelA1Avatar, uploadAccountAvatar, prepareDefaultAccountAvatar, cancelAccountAvatar, fetchSelfAvatar, isA1OutcomeUncertainError, A1OutcomeUncertainError, type A1Operator } from "@/lib/admin/a1-client";
import { a1AvatarCancellation, a1AvatarCancellationRecovery, a1AvatarPreparationRecovery, avatarDrafts, avatarDraftFingerprint, avatarFileHash, canWriteA1Avatar, queryAvatarCancellation, rememberAvatarDraft, replayAvatarCancellation, type AvatarDraft } from "@/lib/admin/account-avatar-pending";
import { RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { type AvatarGender, type AvatarScope } from "@/lib/admin/account-avatar-contract";
import { supportClient } from "@/lib/admin/m-support-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import { isDeterministicRejection } from "@/lib/admin/outcome-classification";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { SupportAvatar } from "../m-tabs/support-avatar";
import { usePendingReplayDeadline } from "../design-kit";
import "./account-avatar-controls.css";

export function AccountAvatarPicker({ account, targetId, name, disabled, scope = "admin", gender = "UNSPECIFIED", allowDefault = false, currentPath, currentVersion, onChange, onBlocking }: {
  /** 没有账号资料时（原头像的独立处理位置），按原记录里的账号编号对上同一条原记录。 */
  account?: A1Operator; targetId?: string; name: string; disabled?: boolean; scope?: AvatarScope; gender?: AvatarGender; allowDefault?: boolean;
  currentPath?: string; currentVersion?: number; onChange: (assetId?: string) => void; onBlocking: (blocking: boolean) => void;
}) {
  const session = useAdminAuth(s => s.session), epoch = useAdminAuth(s => s.authEpoch);
  const canUpload = scope === "self" || canWriteA1Avatar(session?.adminId);
  const actorId = session?.adminId;
  const fingerprint = actorId ? avatarDraftFingerprint(actorId, scope, scope === "self" ? "self" : account?.id ?? targetId ?? "new") : "";
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
  const cancellation = draft ? a1AvatarCancellation(draft) : undefined;
  const cancellationState = cancellation && a1AvatarCancellationRecovery.state(cancellation);
  usePendingReplayDeadline(scope === "admin" ? cancellationState?.expiresAt ?? draft?.expiresAt : undefined);
  useSyncExternalStore(a1AvatarCancellationRecovery.subscribe, a1AvatarCancellationRecovery.getRevision, () => 0);
  useSyncExternalStore(a1AvatarPreparationRecovery.subscribe, a1AvatarPreparationRecovery.getRevision, () => 0);
  const replayBlock = scope === "admin" && draft?.commandOwnerId ? a1AvatarPreparationRecovery.state(draft).replayBlock : undefined;
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
      if (draft?.fileHash && (draft.fileHash !== hash || draft.fileMime !== nextFile.type)) throw new Error("原上传结果未知，请重新选择首次上传的同一张图片。");
      const originalFile = draft ? new File([nextFile], draft.fileName!, { type: draft.fileMime }) : nextFile;
      resetFile(); setFile(originalFile); objectUrl.current = URL.createObjectURL(originalFile); setUrl(objectUrl.current); setInvalidSelection(false);
      if (!draft) setDraft({ fingerprint, actorId: actorId!, scope, kind: "UPLOAD", clientUploadId: crypto.randomUUID(), commandKey: crypto.randomUUID(), fileHash: hash, fileName: nextFile.name, fileMime: nextFile.type, createdAt: Date.now(), expiresAt: Date.now() + 86400000 });
    } catch (e) { if (active(token)) setError(e instanceof Error && /^(图片|请选择|原上传)/.test(e.message) ? e.message : displayAdminError(e)); }
    finally { if (active(token)) setBusy(false); }
  }
  async function prepare(useDefault = false) {
    if (!actorId || !canUpload || disabled || busy || draft?.asset || draft?.cancelKey || expired) return;
    if (scope === "admin" && !canWriteA1Avatar(actorId)) return;
    if (useDefault && !allowDefault || !useDefault && !file && draft?.kind !== "DEFAULT") return;
    const token = generation.current; setBusy(true); setError(""); onBlocking(true);
    let command = draft;
    const wasPending = Boolean(command && avatarDrafts.list().some(row => row.commandKey === command?.commandKey));
    let sent = false;
    try {
      if (!command) command = { fingerprint, actorId, scope, kind: "DEFAULT", gender, clientUploadId: crypto.randomUUID(), commandKey: crypto.randomUUID(), createdAt: Date.now(), expiresAt: Date.now() + 86400000 };
      if (!wasPending || scope === "self") command = rememberAvatarDraft(command, wasPending);
      setDraft(command);
      if (scope === "self") await fetchSelfAvatar();
      if (!active(token)) return;
      const abort = new AbortController(); controller.current = abort;
      const send = (original: AvatarDraft) => {
        if (original.kind === "UPLOAD" && (!file || original.fileHash !== command?.fileHash || original.fileMime !== file.type || original.fileName !== file.name)) {
          throw new Error("AVATAR_COMMAND_INVALID");
        }
        sent = true;
        return original.kind === "DEFAULT"
          ? prepareDefaultAccountAvatar(scope, original.gender!, original.clientUploadId, original.commandKey, abort.signal)
          : scope === "admin" ? uploadA1Avatar(file!, original.clientUploadId, original.commandKey, abort.signal)
            : uploadAccountAvatar("self", file!, original.clientUploadId, original.commandKey, abort.signal);
      };
      const asset = await (scope === "admin" && wasPending ? a1AvatarPreparationRecovery.replay(command, send) : send(command));
      if (!active(token)) return;
      try { updateDraft(rememberAvatarDraft({ ...command, asset })); }
      catch (cause) { throw new A1OutcomeUncertainError("A1_AVATAR_RESPONSE_UNREADABLE", command.commandKey, { cause }); }
    } catch (e) {
      if (active(token)) {
        setError(displayAdminError(e));
        if (command && !sent && !wasPending) {
          avatarDrafts.forget(command.fingerprint, command.commandKey);
          updateDraft(draft);
        }
        const firstAdminRefusal = scope === "admin" && !wasPending && !isA1OutcomeUncertainError(e) && isDeterministicRejection((e as { status?: number }).status ?? 0);
        if (command && (firstAdminRefusal || scope === "self" && isExplicitRejection(e)) && (sent || !wasPending)) { avatarDrafts.forget(command.fingerprint, command.commandKey); updateDraft(null); resetFile(); }
      }
    } finally { if (active(token)) setBusy(false); }
  }
  async function clear() {
    if (busy || disabled || (scope === "admin" && !canWriteA1Avatar(actorId))) return;
    if (cancellation) {
      if (a1AvatarCancellationRecovery.state(cancellation).replayBlock) return;
      const token = generation.current;
      setBusy(true); setError("");
      try {
        await replayAvatarCancellation(cancellation);
        if (active(token)) { updateDraft(null); resetFile(); setInvalidSelection(false); }
      } catch (cause) { if (active(token)) setError(displayAdminError(cause)); }
      finally { if (active(token)) setBusy(false); }
      return;
    }
    if (expired) return;
    if (draft && !draft.asset && avatarDrafts.list().some(row => row.commandKey === draft.commandKey)) { setError("头像准备结果未知，请先重试；当前头像保持不变。"); return; }
    if (!draft?.asset) { updateDraft(null); resetFile(); setInvalidSelection(false); setError(""); onBlocking(false); return; }
    let sent = false;
    const token = generation.current; setBusy(true); setError(""); onBlocking(true);
    try {
      const command = rememberAvatarDraft({ ...draft, cancelKey: draft.cancelKey ?? crypto.randomUUID(),
        cancelCreatedAt: scope === "admin" ? Date.now() : undefined }, Boolean(draft.cancelKey)); setDraft(command);
      if (scope === "self") {
        const snapshot = await fetchSelfAvatar();
        if (!active(token)) return;
        if (snapshot.assetId === command.asset!.assetId) throw new Error("该头像已保存到本人账号，请刷新头像后再开始新的更换。");
      }
      sent = true;
      if (scope === "admin") await cancelA1Avatar(command.asset!.assetId, command.cancelKey!);
      else await cancelAccountAvatar("self", command.asset!.assetId, command.cancelKey!);
      if (!active(token)) return;
      avatarDrafts.forget(command.fingerprint, command.commandKey); updateDraft(null); resetFile(); setInvalidSelection(false); onBlocking(false);
    } catch (e) {
      if (active(token)) {
        const refused = !isA1OutcomeUncertainError(e) && isDeterministicRejection((e as { status?: number }).status ?? 0);
        if (scope === "admin" && (!sent || refused)) {
          avatarDrafts.remember(draft.fingerprint, draft.commandKey, { ...draft, cancelKey: undefined, cancelCreatedAt: undefined });
          updateDraft(draft);
        }
        setError(displayAdminError(scope === "admin" && sent && !refused ? new Error("A1_AVATAR_CANCEL_QUERY_ONLY") : e));
      }
    }
    finally { if (active(token)) setBusy(false); }
  }
  async function checkCancellation() {
    if (!cancellation || busy || disabled) return;
    const token = generation.current;
    setBusy(true); setError("");
    try {
      const state = await queryAvatarCancellation(cancellation);
      if (!active(token)) return;
      if (state === "SUCCEEDED" || state === "REJECTED" || state === "NOT_EXECUTED") {
        updateDraft(avatarDrafts.list().find(row => row.commandKey === cancellation.draftKey) ?? null);
      } else if (state !== "NOT_FOUND") setError(displayAdminError(new Error("A1_AVATAR_CANCEL_QUERY_ONLY")));
    } catch (cause) { if (active(token)) setError(displayAdminError(cause)); }
    finally { if (active(token)) setBusy(false); }
  }
  return <fieldset className="account-avatar-controls" disabled={disabled || busy}><legend>账号头像</legend>
    <p>{scope === "self" ? "保存本人头像需确认并填写理由，保存前原头像保持不变。" : account || targetId && targetId !== "new" ? "新头像随资料修改批准后生效，批准前原头像不变。" : "新头像在账号建好时一起生效。"}</p>
    <div className="account-avatar-row">
      {canUpload ? <label className="account-avatar-field">选择 JPG / PNG 头像<input type="file" accept="image/jpeg,image/png" title={file?.name} disabled={Boolean(draft?.asset || draft?.kind === "DEFAULT" || draft?.cancelKey || expired)} onChange={e => { void choose(e.target.files?.[0]); e.target.value = ""; }} />{file && <small title={file.name}>{file.name}</small>}</label> : <p>需要超级管理员权限，现有头像只读。</p>}
      <div className="account-avatar-preview"><div><p>当前头像</p><SupportAvatar name={name || "运营账号"} path={currentPath ?? (account?.avatarAssetId ? `/api/admin/platform/accounts/${account.id}/avatar` : undefined)} version={currentVersion ?? account?.avatarVersion ?? undefined} size={64} /></div>
        {(draft?.asset || url) && <div><p>新头像</p>{draft?.asset ? <SupportAvatar name={name || "运营账号"} path={draft.asset.previewRef} size={64} /> : <img src={url} alt="待上传账号头像" width={64} height={64} style={{ objectFit: "cover", borderRadius: "50%" }} />}<small>尚未保存到账号</small></div>}
      </div>
    </div>
    {canUpload && allowDefault && !draft && !invalidSelection && <button type="button" className="l-btn" onClick={() => void prepare(true)}>按所选分类准备默认头像</button>}
    {draft && <div className="account-avatar-actions">{!draft.asset && <button type="button" className="l-btn" disabled={expired || !!replayBlock || draft.kind === "UPLOAD" && !file} onClick={() => void prepare()}>{busy ? "正在准备…" : draft.kind === "DEFAULT" ? "重试获取默认头像" : "上传或重试"}</button>}
      {cancellation
        ? <><button type="button" className="l-btn" disabled={!!cancellationState?.busy} onClick={() => void checkCancellation()}>查询原结果</button>
          {!cancellationState?.replayRejection && <button type="button" className="l-btn" disabled={!!cancellationState?.replayBlock} onClick={() => void clear()}>重试取消头像</button>}</>
        : <button type="button" className="l-btn" disabled={expired || Boolean(!draft.asset && avatarDrafts.list().some(row => row.commandKey === draft.commandKey))} onClick={() => void clear()}>{draft.cancelKey ? "重试取消头像" : "取消新头像"}</button>}
      {draft.kind === "UPLOAD" && !file && !draft.asset && <p>上传结果未知，请选择首次上传的同一张图片后重试。</p>}
      {draft.asset && <small>新头像有效期至 {businessStamp(new Date(draft.asset.expiresAt).getTime())}（{businessZone().label}）</small>}
      {(cancellationState?.expired ?? expired) && <p role="alert">{scope === "admin" ? RETRY_EXPIRED_TEXT : "重试期限已过，请联系管理员核对结果。"}</p>}
      {assetExpired && !(cancellationState?.expired ?? expired) && <p role="alert">新头像已过期，请取消后重新选择。</p>}</div>}
    {invalidSelection && !draft && <button type="button" className="l-btn" onClick={() => void clear()}>取消失败的头像选择</button>}{error && <p role="alert">{error}</p>}
  </fieldset>;
}
