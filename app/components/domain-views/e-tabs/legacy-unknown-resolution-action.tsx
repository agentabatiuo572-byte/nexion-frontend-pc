"use client";

import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError } from "@/lib/admin/error-messages";
import { fetchLegacyUnknownCandidate, proposeLegacyUnknownCancellation, type E5Device } from "@/lib/admin/e5-client";
import { sameLegacyUnknownProof, type LegacyUnknownCandidate } from "@/lib/admin/legacy-unknown-resolution";
import { OperationConfirmModal } from "../design-kit";

export function LegacyUnknownResolutionAction({ device, canWrite, toast }: { device: E5Device; canWrite: boolean; toast: (message: string) => void }) {
  const adminId = useAdminAuth(state => state.session?.adminId);
  const epoch = useAdminAuth(state => state.authEpoch);
  const canPropose = useAdminAuth(state => state.session?.authorities.includes("platform_a2_proposal_create") ?? false);
  const allowed = canWrite && canPropose;
  const key = `${adminId}:${epoch}:${device.deviceId}:${device.userId}:${device.serial}:${allowed}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  const active = useRef(false);
  const [read, setRead] = useState<{ key: string; candidate: LegacyUnknownCandidate } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<LegacyUnknownCandidate | null>(null);
  const [ticketId, setTicketId] = useState("");
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    let live = true;
    active.current = true;
    const abort = new AbortController();
    setRead(null); setError(""); setSelected(null); setTicketId(""); setChecking(false);
    if (allowed && adminId) void fetchLegacyUnknownCandidate(device.deviceId, abort.signal).then(candidate => {
      if (candidate.caseId && (candidate.ownerId !== device.userId || candidate.instanceNo !== device.serial))
        throw new Error("LEGACY_UNKNOWN_DEVICE_IDENTITY_CHANGED");
      if (live) setRead({ key, candidate });
    }).catch(cause => { if (live) setError(displayAdminError(cause)); });
    return () => { live = false; active.current = false; abort.abort(); };
  }, [key, retry, allowed, adminId, device.deviceId, device.userId, device.serial]);

  if (!allowed) return null;
  const candidate = read?.key === key ? read.candidate : null;
  const currentAdmin = () => {
    const auth = useAdminAuth.getState();
    return active.current && currentKey.current === key && auth.session?.adminId === adminId && auth.authEpoch === epoch;
  };
  const open = async () => {
    if (!candidate?.eligible || checking) return;
    setError("");
    setChecking(true);
    try {
      const fresh = await fetchLegacyUnknownCandidate(device.deviceId);
      if (!currentAdmin()) return;
      setRead({ key, candidate: fresh });
      if (!sameLegacyUnknownProof(candidate, fresh)) throw new Error("退出证据或设备状态已更新，请刷新后重新核对。");
      setSelected(fresh);
    } catch (cause) { if (currentAdmin()) setError(displayAdminError(cause)); }
    finally { if (currentAdmin()) setChecking(false); }
  };
  return <>
    {error && <div className="tiny" role="alert" style={{ color: "var(--warning)", whiteSpace: "normal" }}>终结资格读取失败：{error}{" "}<button className="l-btn sm" type="button" onClick={() => setRetry(value => value + 1)}>重新核对</button></div>}
    {candidate?.caseId && !candidate.eligible && !candidate.resolution && <div className="tiny" style={{ whiteSpace: "normal" }} title={candidate.reason}>
      {candidate.status === "QUIESCENCE_REQUIRED" ? "等待有效退出证明" : "终结条件未满足，请核对原任务与资金证据"}
    </div>}
    {candidate?.resolution && <div className="tiny" style={{ whiteSpace: "normal" }}>已取消 · 不计收益 · A2 {candidate.resolution.a2OperationId}</div>}
    {ticketId && <div className="tiny" role="status" style={{ whiteSpace: "normal" }}>A2 {ticketId} 已提交，等待另一管理员复核。</div>}
    {candidate?.eligible && !ticketId && <button className="l-btn sm dgr" type="button" disabled={checking} onClick={() => void open()}>结束未确认任务（不计收益）</button>}
    {selected && read?.key === key && <OperationConfirmModal action="结束未确认任务（不计收益）"
      amplifies={false} reasonMin={8} reasonMax={200}
      completionCopy="仅提交 A2 提案，由另一管理员复核后执行；此处不会完成任务或发放收益。"
      detail={<div style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
        <p>仅取消这条未确认旧任务，不产生 USDT/UVT 收益；原请求、journal 和恢复预算保留，不授予重放。</p>
        <dl className="ui-facts-grid"><dt>设备 / 用户</dt><dd>{selected.instanceNo} / {selected.ownerId}</dd>
          <dt>原任务 / 代际</dt><dd>{selected.taskNo} / {selected.requestGeneration}</dd>
          <dt>案件</dt><dd>{selected.caseId}</dd><dt>退出证据 SHA-256</dt><dd>{selected.proofSha}</dd>
          <dt>后端实例</dt><dd>{selected.backendInstanceId}</dd></dl>
        <p>提交后到「操作记录与审批」核对精确案件、退出证明和无收益结论。</p>
      </div>}
      onClose={() => setSelected(null)} onConfirm={async reason => {
        if (!currentAdmin()) throw new Error("管理员会话已变化，请重新进入设备页面。");
        const ticket = await proposeLegacyUnknownCancellation(selected, reason);
        if (!currentAdmin()) return;
        setTicketId(ticket.id); setSelected(null); toast(`A2 ${ticket.id} 已提交，等待另一管理员复核。`);
      }} />}
  </>;
}
