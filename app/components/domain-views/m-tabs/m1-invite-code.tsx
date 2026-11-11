"use client";

import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { canReplayGroupCommand, commandRejected, groupPendingCommands, isInvitePending, supportGroupClient, type InviteCodeView, type InviteIssueRecord } from "@/lib/admin/support-group-client";
import { SupportClientError } from "@/lib/admin/m-support-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import "./m1-invite-code.css";
import { Button, Modal, Notice, Fact, Facts, Fold, Explain } from "@/app/components/rd";

// Icon paths taken verbatim from the confirmed design (Main.dc.html).
const ICON_PATHS = {
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  link: <><path d="M9 17H7A5 5 0 0 1 7 7h2" /><path d="M15 7h2a5 5 0 0 1 0 10h-2" /><path d="M8 12h8" /></>,
  save: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
  reset: <><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 21v-5h5" /></>,
};
function InviteIcon({ name }: { name: keyof typeof ICON_PATHS }) {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON_PATHS[name]}</svg>;
}

function errorText(error: unknown): string {
  if (error instanceof SupportClientError) {
    if (error.status === 401) return "登录已失效，请重新登录后重试。";
    if (error.status === 403) return "当前账号没有有效的个人服务资格，不能管理邀请码。";
    if (error.status === 409) return "邀请码刚被修改过，已重新读取，请核对后再操作。";
  }
  return "暂时无法完成操作，请检查连接后重试。";
}

// Scanners need dark modules on a light quiet zone whatever the console theme is.
function qrPng(link: string): string {
  const qr = qrcode(0, "M");
  // Byte mode keeps only the low 8 bits of each character, so non-ASCII must be escaped first. Existing %XX escapes stay as they are.
  qr.addData(link.replace(/[^\x00-\x7f]+/g, encodeURI), "Byte");
  qr.make();
  const cell = 10, margin = 4, count = qr.getModuleCount(), size = (count + margin * 2) * cell;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, size, size); g.fillStyle = "#000000";
  for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) if (qr.isDark(row, col)) g.fillRect((col + margin) * cell, (row + margin) * cell, cell, cell);
  return canvas.toDataURL("image/png");
}

/** M 第 5 节：本人工作台「我的邀请码」。Remount (key) on actor change. */
export function SelfInviteCodeBar({ toast }: { toast: (message: string) => void }) {
  const adminId = useAdminAuth(state => state.session?.adminId);
  const fingerprint = `invite-code:self:${adminId}`;
  // Generate/reset commands persist in the group command store, so an unsettled one survives leaving the workbench.
  const findPending = () => groupPendingCommands.list().find((r): r is InviteIssueRecord => isInvitePending(r) && r.intent.kind === "INVITE_ISSUE" && r.actorId === adminId);
  const [pending, setPending] = useState<InviteIssueRecord | undefined>(findPending);
  // Set when the server has no record of the original command (or cannot be asked), which allows a same-key retry.
  const [unresolved, setUnresolved] = useState(false);
  const [view, setView] = useState<InviteCodeView | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setReadFailed(false);
    supportGroupClient.selfInviteCode(controller.signal)
      .then(next => { if (!controller.signal.aborted) setView(next); })
      .catch(() => { if (!controller.signal.aborted) { setView(null); setReadFailed(true); } });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => { window.dispatchEvent(new Event("m1-pending-changed")); }, [pending]);
  const qr = useMemo(() => view?.link ? qrPng(view.link) : null, [view?.link]);

  const issue = async () => {
    if (busy || !view || pending || !adminId) return;
    if (view.code !== null && view.version === null) { setError("当前邀请码没有版本号，暂时不能重置；请刷新后再试。"); return; }
    const expectedVersion = view.code === null ? null : view.version, commandKey = crypto.randomUUID();
    groupPendingCommands.remember(fingerprint, commandKey, { actorId: adminId, intent: { kind: "INVITE_ISSUE", payload: { expectedVersion } }, label: expectedVersion === null ? "生成邀请码" : "重置邀请码" });
    const record = findPending();
    if (record?.commandKey !== commandKey || !groupPendingCommands.isDurablyStored(fingerprint, commandKey)) { groupPendingCommands.forget(fingerprint, commandKey); setError("浏览器无法保存这次操作的记录，已停止提交。请检查浏览器设置后重试。"); return; }
    setBusy(true); setError("");
    let acknowledged = false;
    try {
      const next = await supportGroupClient.issueSelfInviteCode(expectedVersion, commandKey);
      acknowledged = true;
      const current = await supportGroupClient.selfInviteCode();
      if (current.code !== next.code || current.version !== next.version) throw new Error("SUPPORT_INVITE_READBACK_CHANGED");
      groupPendingCommands.forget(fingerprint, commandKey);
      setView(current); setConfirming(false);
      toast(expectedVersion === null ? "邀请码已生成。" : "邀请码已重置，旧码已失效。");
    } catch (cause) {
      setConfirming(false);
      if (acknowledged || !commandRejected(cause)) { setPending(record); return; } // unknown result: the shown code may already be revoked
      groupPendingCommands.forget(fingerprint, commandKey);
      if (cause instanceof SupportClientError && cause.status === 409) { setView(null); setReload(n => n + 1); }
      setError(errorText(cause));
    } finally { setBusy(false); }
  };
  // Sharing comes back only after a fresh read of the current code.
  const settle = (record: InviteIssueRecord) => { groupPendingCommands.forget(record.fingerprint, record.commandKey); setPending(undefined); setUnresolved(false); setView(null); setReload(n => n + 1); };
  const reconcile = async () => {
    if (!pending || busy) return;
    setBusy(true); setError("");
    try {
      const receipt = await supportGroupClient.command(pending.commandKey);
      if (receipt.status !== "SUCCEEDED" && receipt.status !== "FAILED") { setUnresolved(false); setError("原操作仍在处理，请稍后再查询。"); return; }
      await supportGroupClient.selfInviteCode();
      settle(pending);
      toast(receipt.status === "SUCCEEDED" ? "原操作已生效，已重新读取邀请码。" : "原操作没有生效，已重新读取邀请码。");
    } catch (cause) {
      const absent = cause instanceof SupportClientError && cause.status === 404 && cause.backendMessage === "SUPPORT_COMMAND_NOT_FOUND";
      setUnresolved(absent);
      const reason = absent ? "尚未找到原命令回执，这不能证明原请求没有执行。" : "暂时无法查询原操作。";
      setError(reason + (!canReplayGroupCommand(pending) ? "原操作已超过可重发时间，不能直接重发，请稍后再查询。" : absent ? "可以用原命令重试原操作。" : "原命令仍保留，请稍后继续查询。"));
    } finally { setBusy(false); }
  };
  // Same key and frozen request body; the server dedupes it if the original did arrive.
  const replay = async () => {
    if (!pending || busy || !canReplayGroupCommand(pending)) return;
    setBusy(true); setError("");
    try {
      const next = await supportGroupClient.issueSelfInviteCode(pending.intent.payload.expectedVersion, pending.commandKey);
      const current = await supportGroupClient.selfInviteCode();
      if (current.code !== next.code || current.version !== next.version) throw new Error("SUPPORT_INVITE_READBACK_CHANGED");
      settle(pending);
      toast(pending.intent.payload.expectedVersion === null ? "邀请码已生成。" : "邀请码已重置，旧码已失效。");
    } catch (cause) {
      if (!commandRejected(cause)) { setError("重试结果仍未确认，原命令已保留，请稍后再查询或重试。"); return; }
      settle(pending);
      setError(errorText(cause));
    } finally { setBusy(false); }
  };
  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); toast(`${label}已复制。`); }
    catch { setError(`自动复制失败，请手动选择${label}复制。`); }
  };
  const saveQr = (code: string) => {
    if (!qr) return;
    const anchor = document.createElement("a");
    anchor.href = qr; anchor.download = `客服邀请码-${code}.png`;
    anchor.click();
  };
  const errorLine = error && <div className="m1-invite-error"><Notice tone="danger">{error}</Notice></div>;

  if (confirming && view?.code) return <Modal title="重置邀请码" busy={busy} onClose={() => setConfirming(false)} footer={<><Button disabled={busy} onClick={() => { setConfirming(false); setError(""); }}>取消</Button><Button variant="danger" loading={busy} onClick={() => void issue()}>确认重置</Button></>}>
    <div className="m1-command-form"><Facts><Fact k="当前邀请码"><span data-mono>{view.code}</span></Fact></Facts><Notice tone="danger">旧码立即失效，之后不能用于注册；已经绑定的客户不受影响。</Notice>{errorLine}</div>
  </Modal>;

  return <section className="m1-invite" aria-label="我的邀请码">

    {pending ? <>
      <Notice tone="warn" action={<><Button type="button" size="sm" className="m1-invite-btn m1-invite-retry" disabled={busy} onClick={() => void reconcile()}>{busy ? "正在处理…" : "查询原操作"}</Button>{unresolved && canReplayGroupCommand(pending) && <Button type="button" size="sm" className="m1-invite-btn m1-invite-retry" disabled={busy} onClick={() => void replay()}>重试原操作</Button>}</>}>上次{pending.intent.payload.expectedVersion === null ? "生成" : "重置"}邀请码的结果还没确认；确认前暂不提供复制、链接和二维码。</Notice>
    </> : readFailed ? <>
      <Notice tone="danger" action={<Button type="button" size="sm" className="m1-invite-btn m1-invite-retry" onClick={() => setReload(n => n + 1)}>重试</Button>}>暂时无法读取邀请码，请重试。</Notice>
    </> : !view ? <p className="m1-invite-note m1-invite-muted" role="status">正在读取邀请码…</p>
      : view.code === null ? <>
        <p className="m1-invite-note">生成后可以复制邀请码、链接或二维码发给新用户。</p>
        <Button type="button" variant="primary" disabled={busy} onClick={() => void issue()}>{busy ? "正在生成…" : "生成邀请码"}</Button>
      </> : <>
        <div className="m1-invite-box">
          <div className="m1-invite-field"><span>邀请码</span><strong className="m1-invite-code">{view.code}</strong></div>
          <Button type="button" size="sm" className="m1-invite-btn" icon={<InviteIcon name="copy" />} onClick={() => void copy(view.code!, "邀请码")}>复制</Button>
        </div>
        {view.link && qr ? <>
          <div className="m1-invite-box m1-invite-linkbox">
            <div className="m1-invite-field"><span>邀请链接</span><span className="m1-invite-link" title={view.link}>{view.link}</span></div>
            <Button type="button" size="sm" className="m1-invite-btn" icon={<InviteIcon name="link" />} onClick={() => void copy(view.link!, "邀请链接")}>复制链接</Button>
          </div>
          <div className="m1-invite-qr">
            <img src={qr} alt={`邀请二维码 ${view.code}`} width={56} height={56} />
            <Button type="button" size="sm" className="m1-invite-btn" icon={<InviteIcon name="save" />} onClick={() => saveQr(view.code!)}>保存二维码</Button>
          </div>
        </> : <p className="m1-invite-note m1-invite-muted">分享地址未配置，暂时只能复制邀请码</p>}
        <Button type="button" size="sm" variant="ghost" icon={<InviteIcon name="reset" />} onClick={() => { setError(""); setConfirming(true); }}>重置</Button>
      </>}
    {errorLine}
  </section>;
}
