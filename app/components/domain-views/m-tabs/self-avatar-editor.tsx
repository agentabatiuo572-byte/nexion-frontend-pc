"use client";
import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { fetchSelfAvatar, saveSelfAvatar, type SelfAvatarSnapshot } from "@/lib/admin/a1-client";
import { avatarDrafts, avatarDraftFingerprint, selfAvatarCommands, type SelfAvatarPending } from "@/lib/admin/account-avatar-pending";
import { AVATAR_GENDER_OPTIONS, type AvatarGender } from "@/lib/admin/account-avatar-contract";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { ConfirmReadConflict } from "@/lib/admin/h-conflict-review";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { AccountAvatarPicker } from "../a-tabs/account-avatar-picker";
import { Button, Drawer, Field, Notice, Select, StatusTag } from "@/app/components/rd";
import type { MCtx } from "./types";

function avatarErrorIs(error: unknown, status: number, code: string) {
  return error instanceof Error && "status" in error && error.status === status
    && "backendMessage" in error && error.backendMessage === code;
}

/**
 * launch：账号菜单里打开时不画自己的按钮，挂上就打开抽屉，关掉后叫 onClosed（顶栏把焦点还给账号按钮）。
 * ctx 只用确认框、提示和刷新三样，客服工作台和顶栏各自给。
 */
export function SelfAvatarEditor({ name, ctx, onChanged, onSnapshot, launch = false, onClosed }: { name: string; ctx: Pick<MCtx, "openActionConfirm" | "toast" | "refreshContent">; onChanged: (snapshot: SelfAvatarSnapshot) => void; onSnapshot?: (snapshot: SelfAvatarSnapshot | null) => void; launch?: boolean; onClosed?: () => void }) {
  const actorId = useAdminAuth(s => s.session?.adminId), epoch = useAdminAuth(s => s.authEpoch);
  const [open, setOpen] = useState(false), [snapshot, setSnapshot] = useState<SelfAvatarSnapshot | null>(null), [allowed, setAllowed] = useState(false);
  const [gender, setGender] = useState<AvatarGender>("UNSPECIFIED"), [assetId, setAssetId] = useState<string | undefined>(), [blocking, setBlocking] = useState(false);
  const [pending, setPending] = useState<SelfAvatarPending | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const generation = useRef(0), controller = useRef<AbortController | null>(null);
  const active = (token: number) => generation.current === token && useAdminAuth.getState().session?.adminId === actorId && useAdminAuth.getState().authEpoch === epoch;
  useEffect(() => {
    generation.current++; controller.current?.abort(); setOpen(false); setSnapshot(null); setAllowed(false); setAssetId(undefined); setBlocking(false); setBusy(false); setError("");
    setPending(selfAvatarCommands.list().find(row => row.actorId === actorId) ?? null);
    if (onSnapshot) void read(true);
    return () => { generation.current++; controller.current?.abort(); };
  }, [actorId, epoch]);
  useEffect(() => { window.dispatchEvent(new Event("m1-pending-changed")); }, [pending]);
  const instance = useRef({}).current;
  useEffect(() => {
    const onChangedElsewhere = (event: Event) => {
      const { source, snapshot: next } = (event as CustomEvent<{ source: object; snapshot: SelfAvatarSnapshot }>).detail;
      if (source === instance) return;
      setSnapshot(next); onSnapshot?.(next);
      void ctx.refreshContent().catch(() => undefined);
    };
    window.addEventListener("self-avatar-changed", onChangedElsewhere);
    return () => window.removeEventListener("self-avatar-changed", onChangedElsewhere);
  }, [ctx, onSnapshot]);
  // 放在上面那个重置之后：挂上先清空，再打开。
  useEffect(() => { if (launch) { setOpen(true); void read(); } }, []);
  const opened = useRef(false), queryButton = useRef<HTMLButtonElement>(null), pendingFocused = useRef(false);
  useEffect(() => { if (open) opened.current = true; else if (launch && opened.current) onClosed?.(); }, [open]);
  // 从账号菜单打开、上次保存结果未知时，核对完落在「查询保存结果」上（OP-93）。
  useEffect(() => { if (launch && open && pending && !busy && !pendingFocused.current && queryButton.current) { pendingFocused.current = true; queryButton.current.focus(); } }, [launch, open, pending, busy]);
  const complete = (record: SelfAvatarPending, current: SelfAvatarSnapshot) => {
    selfAvatarCommands.forget(record.fingerprint, record.commandKey);
    avatarDrafts.forget(avatarDraftFingerprint(record.actorId, "self", "self"));
    setPending(null); setSnapshot(current); setAssetId(undefined); setBlocking(false); setOpen(false); onChanged(current);
    // 账号菜单和客服工作台各挂一个编辑器：一边保存成功，另一边的本人头像和名单跟着换。
    window.dispatchEvent(new CustomEvent("self-avatar-changed", { detail: { source: instance, snapshot: current } }));
    ctx.toast("本人头像已读回确认。");
    void ctx.refreshContent().catch(() => ctx.toast("头像已保存，客服名单还没同步，请刷新名单。"));
  };
  const permissionDenied = (error: unknown) => avatarErrorIs(error, 403, "AVATAR_SELF_FORBIDDEN") || isPermissionDenied(error);
  const clearDenied = (error: unknown) => {
    if (actorId) avatarDrafts.forget(avatarDraftFingerprint(actorId, "self", "self"));
    setSnapshot(null); onSnapshot?.(null); setAssetId(undefined); setBlocking(false); setAllowed(false); setOpen(false);
    ctx.toast(displayAdminError(error));
  };
  async function read(hydrate = false) {
    if (!actorId || (!hydrate && busy)) return;
    const token = generation.current, abort = new AbortController(); controller.current = abort; setBusy(true); setError(""); setAllowed(false);
    try {
      const current = await fetchSelfAvatar(abort.signal); if (!active(token)) return;
      const record = selfAvatarCommands.list().find(row => row.actorId === actorId); setPending(record ?? null);
      if (!hydrate && record && current.assetId === record.input.assetId) complete(record, current);
      else {
        setSnapshot(current); setGender(current.avatarGender ?? "UNSPECIFIED"); setAllowed(true); onSnapshot?.(current);
        if (!hydrate && record?.acknowledged) setError("读到的当前头像与本次保存不一致，请刷新核对。");
      }
    } catch (e) {
      if (!active(token)) return;
      if (permissionDenied(e)) { clearDenied(e); announcePermissionDenied(); }
      else setError(displayAdminReadError(e));
    }
    finally { if (active(token)) setBusy(false); }
  }
  async function submit(record: SelfAvatarPending, firstAttempt?: { current: SelfAvatarSnapshot; versionConflict: () => ConfirmReadConflict }) {
    if (record.acknowledged) return false;
    const token = generation.current, abort = new AbortController(); controller.current = abort; setBusy(true); setError("");
    let sent = false, saved = false;
    try {
      if (!active(token) || record.actorId !== actorId) return false;
      const current = firstAttempt?.current ?? await fetchSelfAvatar(abort.signal); if (!active(token)) return false;
      if (!firstAttempt) setSnapshot(current);
      setAllowed(true);
      if (current.assetId === record.input.assetId) { complete(record, current); return true; }
      if (Date.now() >= record.expiresAt) throw new Error("AVATAR_COMMAND_EXPIRED");
      if (!selfAvatarCommands.isDurablyStored(record.fingerprint, record.commandKey)) throw new Error(firstAttempt ? "AVATAR_COMMAND_STORAGE_UNAVAILABLE" : "AVATAR_COMMAND_RETRY_STORAGE_UNAVAILABLE");
      sent = true;
      await saveSelfAvatar(record.input, record.commandKey, abort.signal); saved = true; if (!active(token)) return false;
      const acknowledged = { ...record, acknowledged: true as const };
      selfAvatarCommands.remember(record.fingerprint, record.commandKey, acknowledged);
      setPending(acknowledged);
      const readback = await fetchSelfAvatar(abort.signal); if (!active(token)) return false;
      if (readback.assetId !== record.input.assetId) throw new Error("AVATAR_SAVE_READBACK_MISMATCH");
      complete(record, readback); return true;
    } catch (e) {
      if (!active(token)) return false;
      const denied = permissionDenied(e);
      if (firstAttempt && !saved && (!sent || denied || isExplicitRejection(e))) {
        selfAvatarCommands.forget(record.fingerprint, record.commandKey);
        setPending(null);
      }
      if (denied) {
        clearDenied(e); announcePermissionDenied();
        return true;
      }
      if (saved) {
        avatarDrafts.forget(avatarDraftFingerprint(record.actorId, "self", "self"));
        setSnapshot(null); setAssetId(undefined); setBlocking(false); setAllowed(false);
        ctx.toast("本人头像已保存。");
        return true;
      }
      if (firstAttempt) {
        if (!sent) {
          setAllowed(false);
          throw new Error(`还没提交。${displayAdminReadError(e)} 可以再次确认。`);
        }
        if (avatarErrorIs(e, 409, "ACCOUNT_VERSION_STALE")) throw firstAttempt.versionConflict();
        if (isExplicitRejection(e)) throw e;
        setPending(record);
        return true;
      }
      setError(sent ? displayAdminError(e) : displayAdminReadError(e));
      setAllowed(false);
      return false;
    } finally { if (active(token)) setBusy(false); }
  }
  function confirm() {
    if (!snapshot || !assetId || busy || blocking || !allowed || !actorId || pending) return;
    const selected = assetId, confirmationGeneration = generation.current;
    let expectedVersion = snapshot.accountVersion;
    const versionConflict = () => new ConfirmReadConflict({
      renderNotice: readLatest => <Notice tone="warn" action={<Button type="button" size="sm" onClick={readLatest}>读取最新</Button>}>账号资料已变化，请读取最新头像资料，再核对并确认。</Notice>,
      readLatest: async () => {
        const abort = new AbortController();
        controller.current = abort;
        try {
          const current = await fetchSelfAvatar(abort.signal);
          if (!active(confirmationGeneration)) return false;
          expectedVersion = current.accountVersion;
          setSnapshot(current); onSnapshot?.(current); setAllowed(true);
          return true;
        } catch (e) {
          if (active(confirmationGeneration) && permissionDenied(e)) {
            clearDenied(e);
            // Let the existing confirm close and notify the shell during conflict recovery.
            throw Object.assign(new Error(displayAdminError(e)), { reasonCode: "ADMIN_PERMISSION_DENIED" });
          }
          throw e;
        }
      },
    });
    ctx.openActionConfirm({ action: "更换本人头像", briefKind: "self-avatar", effect: <StatusTag tone="progress" filled>立即生效</StatusTag>, detail: <span className="self-avatar-confirm-detail">仅替换当前登录账号的头像；姓名、角色和接待资格保持原值。失败或冲突不会清除原头像。</span>, reasonMin: 8, reasonMax: 500,
      run: async reason => {
        if (!active(confirmationGeneration)) return false;
        const abort = new AbortController(); controller.current = abort; setBusy(true); setError("");
        let current: SelfAvatarSnapshot;
        try { current = await fetchSelfAvatar(abort.signal); }
        catch (e) {
          if (!active(confirmationGeneration)) return false;
          if (permissionDenied(e)) { clearDenied(e); announcePermissionDenied(); return true; }
          setAllowed(false);
          throw new Error(`还没提交。${displayAdminReadError(e)} 可以再次确认。`);
        } finally { if (active(confirmationGeneration)) setBusy(false); }
        if (!active(confirmationGeneration)) return false;
        const existing = selfAvatarCommands.list().find(row => row.actorId === actorId);
        if (existing) { setPending(existing); return true; }
        const fingerprint = `${actorId}:self-avatar-save`, commandKey = crypto.randomUUID();
        const input = { assetId: selected, expectedVersion, reason };
        try { selfAvatarCommands.remember(fingerprint, commandKey, { actorId, input }); }
        catch (e) { throw new Error(`还没提交。${displayAdminError(e)}`); }
        const record = selfAvatarCommands.list().find(row => row.commandKey === commandKey);
        if (!record || !selfAvatarCommands.isDurablyStored(fingerprint, commandKey)) {
          selfAvatarCommands.forget(fingerprint, commandKey);
          throw new Error("浏览器无法保存这次操作的记录，还没提交。请检查浏览器设置后重试。");
        }
        return submit(record, { current, versionConflict });
      },
    });
  }
  return <>{!launch && <Button size="sm" className="avatar-control-button" disabled={!actorId || busy} onClick={() => { setOpen(true); void read(); }}>更换本人头像</Button>}
    {open && <Drawer open title="更换本人头像" sub={name} busy={busy} explain="仅具备有效客服或主管资格的本人可更换，不需要账号管理权限。" onClose={() => { if (!busy) setOpen(false); }} footer={<div className="m1-drawer-actions"><Button type="button" disabled={busy} onClick={() => setOpen(false)}>{launch ? "关闭" : "返回工作台"}</Button><Button type="button" variant="primary" disabledReason={busy ? "正在处理，稍候" : pending?.acknowledged ? "头像已保存，请先刷新核对" : pending ? "原头像保存结果未知，请先查询原操作" : !allowed ? "本人头像资料还没加载到，加载后才能保存" : blocking ? "图片还在准备，准备好才能保存" : !assetId ? "先选一张头像" : undefined} onClick={confirm}>确认保存本人头像</Button></div>}>
      <div className="account-avatar-controls m1-avatar-editor">
      {busy && <p className="rd-note" role="status">正在核对头像资料…</p>}{error && <Notice tone="danger">{error}</Notice>}
      {!allowed && !busy && !pending?.acknowledged && <div><Button type="button" onClick={() => void read()}>重新核对本人资格与头像</Button></div>}
      {pending && <Notice tone="warn" title={pending.acknowledged ? "头像已保存，最新的头像暂时读不到。" : "上次保存头像的结果还没确认，请先查询结果。"} actionBelow action={<><Button ref={queryButton} size="sm" type="button" disabled={busy} onClick={() => void read()}>{pending.acknowledged ? "刷新头像" : "查询保存结果"}</Button>{!pending.acknowledged && <Button size="sm" type="button" disabled={busy || !allowed || Date.now() >= pending.expiresAt} onClick={() => void submit(pending)}>使用原资料与命令重试</Button>}</>}>{!pending.acknowledged && Date.now() >= pending.expiresAt && <p>原命令已超过安全重试窗口，只能查询结果；请联系管理员核对。</p>}</Notice>}
      {snapshot && <><Field label="默认头像分类" explain="只用于下一次明确准备默认头像；不会修改本人资料中的性别或立即换图。"><Select aria-label="默认头像分类" value={gender} options={AVATAR_GENDER_OPTIONS} disabled={!allowed || busy || Boolean(pending) || blocking} onChange={value => setGender(value as AvatarGender)} /></Field>
        <AccountAvatarPicker key={`${actorId}:${epoch}`} scope="self" name={name} gender={gender} allowDefault currentPath={snapshot.assetId ? "/api/admin/platform/accounts/self/avatar/content" : undefined} currentVersion={snapshot.avatarVersion} disabled={!allowed || busy || Boolean(pending)} onChange={setAssetId} onBlocking={setBlocking} />
      </>}
      </div>
    </Drawer>}
  </>;
}
