"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { canReplayGroupCommand, commandRejected, groupPendingCommands, isInvitePending, supportGroupClient, type InviteCodeView, type InviteIssueRecord } from "@/lib/admin/support-group-client";
import { SupportClientError } from "@/lib/admin/m-support-client";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { useAdminAuth } from "@/lib/store/admin-auth";
import "./m1-invite-code.css";
import { Button, Notice, Fact, Facts, Fold, Explain, IrreversibleTag, StatusTag } from "@/app/components/rd";
import { OperationConfirmModal } from "../design-kit";

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
  // 走到这里的都是后端明确拒绝（结果未知另有处理），不是连接问题：按错误码写原因（TX-12、TX-13）。
  return displayAdminError(error);
}

function invitePermissionDenied(error: unknown) {
  return isPermissionDenied(error) || error instanceof SupportClientError && error.status === 403
    && error.backendMessage === "SUPPORT_PERSONAL_SERVICE_REQUIRED";
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
  const [denied, setDenied] = useState(false);
  const resetButton = useRef<HTMLButtonElement>(null);
  const clearDenied = (cause: unknown) => {
    setDenied(true); setView(null); setConfirming(false); setUnresolved(false);
    setError(errorText(cause));
    announcePermissionDenied();
  };
  useEffect(() => {
    const controller = new AbortController();
    setReadFailed(false);
    supportGroupClient.selfInviteCode(controller.signal)
      .then(next => { if (!controller.signal.aborted) setView(next); })
      .catch(cause => {
        if (controller.signal.aborted) return;
        if (invitePermissionDenied(cause)) clearDenied(cause);
        else { setView(null); setReadFailed(true); }
      });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => { window.dispatchEvent(new Event("m1-pending-changed")); }, [pending]);
  const qr = useMemo(() => view?.link ? qrPng(view.link) : null, [view?.link]);

  const settle = (record: InviteIssueRecord, current: InviteCodeView | null) => {
    groupPendingCommands.forget(record.fingerprint, record.commandKey);
    setPending(undefined); setUnresolved(false); setView(current); setReadFailed(false);
    if (!current) setReload(n => n + 1);
  };
  const submit = async (record: InviteIssueRecord, fromConfirm: boolean, recovering = false) => {
    const { expectedVersion } = record.intent.payload;
    const success = expectedVersion === null ? "邀请码已生成。" : "邀请码已重置，旧码已失效。";
    setBusy(true); setError("");
    let acknowledged: InviteIssueRecord | undefined;
    try {
      const next = await supportGroupClient.issueSelfInviteCode(expectedVersion, record.commandKey);
      acknowledged = { ...record, acknowledged: true };
      groupPendingCommands.remember(record.fingerprint, record.commandKey, acknowledged);
      const current = await supportGroupClient.selfInviteCode();
      if (current.code !== next.code || current.version !== next.version) throw new Error("SUPPORT_INVITE_READBACK_CHANGED");
      settle(record, current); setConfirming(false);
      toast(success);
    } catch (cause) {
      if (acknowledged) {
        setPending(acknowledged); setUnresolved(false); setView(null); setConfirming(false);
        toast(success);
        if (invitePermissionDenied(cause)) clearDenied(cause);
        return;
      }
      if (invitePermissionDenied(cause)) {
        if (!recovering) groupPendingCommands.forget(record.fingerprint, record.commandKey);
        clearDenied(cause);
        return;
      }
      if (!commandRejected(cause)) {
        setConfirming(false); setPending(record);
        if (recovering) setError("重试的结果仍然未知，原操作已保留，请稍后再查询或重试。");
        return;
      }
      const stale = cause instanceof SupportClientError && cause.status === 409;
      if (recovering) settle(record, null);
      else {
        groupPendingCommands.forget(record.fingerprint, record.commandKey);
        if (stale) { setView(null); setReload(n => n + 1); }
      }
      if (fromConfirm && !stale) throw new Error(errorText(cause));
      setConfirming(false);
      setError(errorText(cause));
    } finally { setBusy(false); }
  };

  const issue = async (fromConfirm = false) => {
    if (busy || !view || pending || !adminId) return;
    const reportUnsubmitted = (message: string) => {
      if (fromConfirm) throw new Error(message);
      setError(message);
    };
    if (view.code !== null && view.version === null) { reportUnsubmitted("当前邀请码的资料不全，暂时不能重置，请刷新后再试。"); return; }
    const expectedVersion = view.code === null ? null : view.version, commandKey = crypto.randomUUID();
    try {
      groupPendingCommands.remember(fingerprint, commandKey, { actorId: adminId, intent: { kind: "INVITE_ISSUE", payload: { expectedVersion } }, label: expectedVersion === null ? "生成邀请码" : "重置邀请码" });
    } catch (cause) {
      reportUnsubmitted(`还没提交。${displayAdminError(cause)}`);
      return;
    }
    const record = findPending();
    if (record?.commandKey !== commandKey || !groupPendingCommands.isDurablyStored(fingerprint, commandKey)) {
      groupPendingCommands.forget(fingerprint, commandKey);
      reportUnsubmitted("浏览器存不下这次操作，没有提交。请允许浏览器保存网站数据后重试。");
      return;
    }
    await submit(record, fromConfirm);
  };
  // Sharing comes back only after a fresh read of the current code.
  const reconcile = async () => {
    if (!pending || busy) return;
    setBusy(true); setError("");
    try {
      if (pending.acknowledged) {
        settle(pending, await supportGroupClient.selfInviteCode());
        return;
      }
      const receipt = await supportGroupClient.command(pending.commandKey);
      if (receipt.status !== "SUCCEEDED" && receipt.status !== "FAILED") { setUnresolved(false); setError("原操作仍在处理，请稍后再查询。"); return; }
      settle(pending, await supportGroupClient.selfInviteCode());
      toast(receipt.status === "SUCCEEDED" ? "原操作已生效，已重新读取邀请码。" : "原操作没有生效，已重新读取邀请码。");
    } catch (cause) {
      if (invitePermissionDenied(cause)) { clearDenied(cause); return; }
      if (pending.acknowledged) { setError(displayAdminReadError(cause)); return; }
      const absent = cause instanceof SupportClientError && cause.status === 404 && cause.backendMessage === "SUPPORT_COMMAND_NOT_FOUND";
      setUnresolved(absent);
      const reason = absent ? "还没查到原操作的结果，这说明不了它没有执行。" : "暂时查不到原结果。";
      setError(reason + (!canReplayGroupCommand(pending) ? "原操作已超过 24 小时，不能再重试，请稍后再查询。" : absent ? "可以按原操作重试。" : "原操作仍保留，请稍后再查询。"));
    } finally { setBusy(false); }
  };
  // Same key and frozen request body; the server dedupes it if the original did arrive.
  const replay = async () => {
    if (!pending || pending.acknowledged || busy || !canReplayGroupCommand(pending)) return;
    await submit(pending, false, true);
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

  // 共用确认框，不收理由（接口不收理由，02 EX-09 的 M1-A23）：后果写在执行摘要里，立即生效、不能撤销两个标签（OP-36、VS-106）。和这一栏同时挂着，关掉后焦点回到「重置」（OP-46）。
  const confirmBox = confirming && view?.code && <OperationConfirmModal action="重置邀请码" briefKind="record" requireReason={false}
    detail="旧码立即失效，之后不能用于注册；已经绑定的客户不受影响。"
    statedBrief={{ impact: "旧码立即失效，之后不能用于注册；已经绑定的客户不受影响。", check: "确认要换新码：已经发出去的旧码、链接和二维码都不能再用。" }}
    facts={<Facts><Fact k="当前邀请码"><span data-mono>{view.code}</span></Fact></Facts>}
    effect={<><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag /></>}
    confirmTone="danger" confirmLabel="确认重置" returnFocus={() => resetButton.current}
    onClose={() => { setConfirming(false); setError(""); }} onConfirm={() => issue(true)} />;

  return <section className="m1-invite" aria-label="我的邀请码">
    {confirmBox}

    {!denied && (pending ? <>
      <Notice tone="warn" action={<><Button type="button" size="sm" className="m1-invite-btn m1-invite-retry" disabled={busy} onClick={() => void reconcile()}>{busy ? "正在处理…" : pending.acknowledged ? "刷新邀请码" : "查询原操作"}</Button>{!pending.acknowledged && unresolved && canReplayGroupCommand(pending) && <Button type="button" size="sm" className="m1-invite-btn m1-invite-retry" disabled={busy} onClick={() => void replay()}>按原操作重试</Button>}</>}>{pending.acknowledged ? "邀请码已保存，最新的邀请码暂时读不到。" : `上次${pending.intent.payload.expectedVersion === null ? "生成" : "重置"}邀请码结果未知；查到结果前不能复制，也不显示链接和二维码。`}</Notice>
    </> : readFailed ? <>
      <Notice tone="danger" action={<Button type="button" size="sm" className="m1-invite-btn m1-invite-retry" onClick={() => setReload(n => n + 1)}>重试</Button>}>暂时无法读取邀请码，请重试。</Notice>
    </> : !view ? <p className="m1-invite-note m1-invite-muted" role="status">正在加载邀请码…</p>
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
        <Button ref={resetButton} type="button" size="sm" variant="ghost" icon={<InviteIcon name="reset" />} onClick={() => { setError(""); setConfirming(true); }}>重置</Button>
      </>)}
    {!confirming && errorLine}
  </section>;
}
