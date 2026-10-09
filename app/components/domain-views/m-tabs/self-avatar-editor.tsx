"use client";
import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { fetchSelfAvatar, saveSelfAvatar, isA1OutcomeUncertainError, type SelfAvatarSnapshot } from "@/lib/admin/a1-client";
import { avatarDrafts, avatarDraftFingerprint, selfAvatarCommands, type SelfAvatarPending } from "@/lib/admin/account-avatar-pending";
import { AVATAR_GENDER_OPTIONS, type AvatarGender } from "@/lib/admin/account-avatar-contract";
import { displayAdminError } from "@/lib/admin/error-messages";
import { AccountAvatarPicker } from "../a-tabs/account-avatar-picker";
import { Drawer } from "../design-kit";
import { HDSelect } from "./hd-ui";
import type { MCtx } from "./types";

export function SelfAvatarEditor({ name, ctx, onChanged }: { name: string; ctx: MCtx; onChanged: (snapshot: SelfAvatarSnapshot) => void }) {
  const actorId = useAdminAuth(s => s.session?.adminId), epoch = useAdminAuth(s => s.authEpoch);
  const [open, setOpen] = useState(false), [snapshot, setSnapshot] = useState<SelfAvatarSnapshot | null>(null), [allowed, setAllowed] = useState(false);
  const [gender, setGender] = useState<AvatarGender>("UNSPECIFIED"), [assetId, setAssetId] = useState<string | undefined>(), [blocking, setBlocking] = useState(false);
  const [pending, setPending] = useState<SelfAvatarPending | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const generation = useRef(0), controller = useRef<AbortController | null>(null);
  const active = (token: number) => generation.current === token && useAdminAuth.getState().session?.adminId === actorId;
  useEffect(() => {
    generation.current++; controller.current?.abort(); setOpen(false); setSnapshot(null); setAllowed(false); setAssetId(undefined); setBlocking(false); setBusy(false); setError("");
    setPending(selfAvatarCommands.list().find(row => row.actorId === actorId) ?? null);
    return () => { generation.current++; controller.current?.abort(); };
  }, [actorId, epoch]);
  const complete = (record: SelfAvatarPending, current: SelfAvatarSnapshot) => {
    selfAvatarCommands.forget(record.fingerprint, record.commandKey);
    avatarDrafts.forget(avatarDraftFingerprint(record.actorId, "self", "self"));
    setPending(null); setSnapshot(current); setAssetId(undefined); setBlocking(false); setOpen(false); onChanged(current);
    ctx.toast("本人头像已读回确认。");
    void ctx.refreshContent().catch(() => ctx.toast("本人头像已保存，客服名单暂未同步，请重新读取名单。"));
  };
  async function read() {
    if (!actorId || busy) return;
    const token = generation.current, abort = new AbortController(); controller.current = abort; setBusy(true); setError(""); setAllowed(false);
    try {
      const current = await fetchSelfAvatar(abort.signal); if (!active(token)) return;
      setSnapshot(current); setGender(current.avatarGender ?? "UNSPECIFIED"); setAllowed(true);
      const record = selfAvatarCommands.list().find(row => row.actorId === actorId); setPending(record ?? null);
      if (record && current.assetId === record.input.assetId) complete(record, current);
    } catch (e) { if (active(token)) setError(displayAdminError(e)); }
    finally { if (active(token)) setBusy(false); }
  }
  async function submit(record: SelfAvatarPending) {
    const token = generation.current, abort = new AbortController(); controller.current = abort; setBusy(true); setError("");
    let sent = false, saved = false;
    try {
      if (!active(token) || record.actorId !== actorId) return false;
      const current = await fetchSelfAvatar(abort.signal); if (!active(token)) return false;
      setSnapshot(current); setAllowed(true);
      if (current.assetId === record.input.assetId) { complete(record, current); return true; }
      if (Date.now() >= record.expiresAt) throw new Error("AVATAR_COMMAND_EXPIRED");
      if (!selfAvatarCommands.isDurablyStored(record.fingerprint, record.commandKey)) throw new Error("AVATAR_COMMAND_STORAGE_UNAVAILABLE");
      sent = true;
      await saveSelfAvatar(record.input, record.commandKey, abort.signal); saved = true; if (!active(token)) return false;
      const readback = await fetchSelfAvatar(abort.signal); if (!active(token)) return false;
      if (readback.assetId !== record.input.assetId) throw new Error("AVATAR_SAVE_READBACK_MISMATCH");
      complete(record, readback); return true;
    } catch (e) {
      if (active(token)) {
        setError(displayAdminError(e));
        setAllowed(false);
        // Read failure cannot decide whether an earlier write succeeded.
        if (sent && !saved && !isA1OutcomeUncertainError(e)) {
          selfAvatarCommands.forget(record.fingerprint, record.commandKey); setPending(null); setAllowed(false);
        }
      }
      return false;
    } finally { if (active(token)) setBusy(false); }
  }
  function confirm() {
    if (!snapshot || !assetId || busy || blocking || !allowed || !actorId || pending) return;
    const selected = assetId, expectedVersion = snapshot.accountVersion, confirmationGeneration = generation.current;
    ctx.openActionConfirm({ action: "更换本人头像", detail: <span className="self-avatar-confirm-detail">仅替换当前登录账号的头像；姓名、角色和接待资格保持原值。失败或冲突不会清除原头像。</span>, reasonMin: 8, reasonMax: 500,
      run: async reason => {
        if (!active(confirmationGeneration)) return false;
        const existing = selfAvatarCommands.list().find(row => row.actorId === actorId);
        if (existing) { setPending(existing); setError("原头像保存结果尚未确认，请先查询原操作。"); return false; }
        const fingerprint = `${actorId}:self-avatar-save`, commandKey = crypto.randomUUID();
        const input = { assetId: selected, expectedVersion, reason };
        selfAvatarCommands.remember(fingerprint, commandKey, { actorId, input });
        const record = selfAvatarCommands.list().find(row => row.commandKey === commandKey);
        if (!record || !selfAvatarCommands.isDurablyStored(fingerprint, commandKey)) { setError("原头像命令暂不能持久保存，尚未提交；请恢复浏览器会话存储后重试。"); return false; }
        setPending(record); return submit(record);
      },
    });
  }
  return <><button type="button" className="l-btn avatar-control-button" disabled={!actorId || busy} onClick={() => { setOpen(true); void read(); }}>更换本人头像</button>
    {open && <Drawer title="更换本人头像" sub={name} onClose={() => { if (!busy) setOpen(false); }} footer={<div className="account-avatar-controls" style={{ display: "flex", gap: 8, padding: 14 }}><button type="button" className="l-btn" disabled={busy} onClick={() => setOpen(false)}>返回工作台</button><button type="button" className="l-btn primary" disabled={!allowed || !assetId || blocking || busy || Boolean(pending)} onClick={confirm}>确认保存本人头像</button></div>}>
      <div className="account-avatar-controls"><p>仅本人可更换；有效客服或主管资格由服务端核对，不需要开放账号管理权限。</p>
      {busy && <p role="status">正在核对头像资料…</p>}{error && <p role="alert">{error}</p>}
      {!allowed && !busy && <button type="button" className="l-btn" onClick={() => void read()}>重新核对本人资格与头像</button>}
      {pending && <div role="status"><p>原头像保存结果待确认，原图片、版本、理由和命令号已保留。请先查询原结果。</p><button type="button" className="l-btn" disabled={busy} onClick={() => void read()}>查询原保存结果</button><button type="button" className="l-btn" disabled={busy || !allowed || Date.now() >= pending.expiresAt} onClick={() => void submit(pending)}>使用原资料与命令重试</button>{Date.now() >= pending.expiresAt && <p>原命令已超过安全重试窗口，只能查询结果；请联系管理员核对。</p>}</div>}
      {snapshot && <><fieldset disabled={!allowed || busy || Boolean(pending) || blocking} style={{ border: 0, padding: 0 }}><legend>默认头像分类</legend><HDSelect value={gender} options={AVATAR_GENDER_OPTIONS} onChange={value => setGender(value as AvatarGender)} /><p>只用于下一次明确准备默认头像；不会修改本人资料中的性别或立即换图。</p></fieldset>
        <AccountAvatarPicker key={`${actorId}:${epoch}`} scope="self" name={name} gender={gender} allowDefault currentPath={snapshot.assetId ? "/api/admin/platform/accounts/self/avatar/content" : undefined} currentVersion={snapshot.avatarVersion} disabled={!allowed || busy || Boolean(pending)} onChange={setAssetId} onBlocking={setBlocking} />
      </>}
      </div>
    </Drawer>}
  </>;
}
