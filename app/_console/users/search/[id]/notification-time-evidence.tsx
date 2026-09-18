"use client";

import { useEffect, useRef, useState } from "react";
import { Drawer, OperationConfirmModal } from "@/app/components/domain-views/design-kit";
import { correctNotificationTime, fetchNotificationTimeEvidence, UsersRequestError, type NotificationTimeEvidence } from "@/lib/admin/user360-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";

type CorrectionCommand = PendingMutationRecord & { preview: NotificationTimeEvidence; reason: string };
const corrections = createPendingMutationStore<CorrectionCommand>({
  storageKey: "nexion-admin-notification-time-corrections-v1",
  isValidRecord: command => typeof command.reason === "string" && command.reason.trim().length > 0 && command.reason.length <= 500
    && !!command.preview && command.preview.status === "MATCHED" && Number.isSafeInteger(command.preview.notificationId)
    && command.preview.notificationId > 0 && typeof command.preview.storedCreatedAt === "string"
    && typeof command.preview.deliveryFactTime === "string" && Array.isArray(command.preview.facts) && command.preview.facts.length === 3,
});

export function NotificationTimeEvidenceDrawer({ userKey, notificationId, actorKey, canCorrect = false, onCorrected, onClose }: {
  userKey: string; notificationId: number; actorKey?: string; canCorrect?: boolean; onCorrected?: () => void; onClose: () => void;
}) {
  const [data, setData] = useState<NotificationTimeEvidence | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [confirmation, setConfirmation] = useState<NotificationTimeEvidence | null>(null);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<CorrectionCommand | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const slot = JSON.stringify([actorKey, userKey, notificationId]);
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => { setNotice(""); setPending(corrections.list().find(command => command.fingerprint === slot) ?? null); }, [slot]);
  useEffect(() => {
    generation.current += 1;
    const controller = new AbortController();
    let active = true;
    setData(null); setError(""); setConfirmation(null);
    fetchNotificationTimeEvidence(userKey, notificationId, controller.signal)
      .then(result => {
        if (!active) return;
        if (result.notificationId !== notificationId) throw new Error("通知证据编号不匹配，请重试");
        setData(result);
      })
      .catch(cause => { if (active) setError(displayAdminError(cause)); });
    return () => { active = false; generation.current += 1; controller.abort(); };
  }, [userKey, notificationId, actorKey, canCorrect, attempt]);
  const submit = async (reason: string) => {
    if (!canCorrect || !actorKey || busy.current) return;
    let command = corrections.list().find(value => value.fingerprint === slot);
    if (!command) {
      if (!confirmation) return;
      corrections.remember(slot, `notification-time-${crypto.randomUUID()}`, { preview: confirmation, reason: reason.trim() });
      command = corrections.list().find(value => value.fingerprint === slot);
    }
    if (!command) throw new Error("无法保留原校正请求，请重试");
    setPending(command);
    busy.current = true;
    setSubmitting(true);
    const ownedGeneration = generation.current;
    try {
      await correctNotificationTime(userKey, command.preview, command.reason, command.commandKey);
      if (ownedGeneration !== generation.current) return;
      corrections.forget(slot);
      setPending(null);
      setNotice("已按投递事实校正通知时间，已读状态保持不变。");
      onCorrected?.();
    } catch (cause) {
      if (ownedGeneration !== generation.current) return;
      if (cause instanceof UsersRequestError && ["NOTIFICATION_TIME_SNAPSHOT_CHANGED", "NOTIFICATION_TIME_EVIDENCE_CHANGED", "NOTIFICATION_TIME_ALREADY_CORRECT", "NOTIFICATION_TIME_CORRECTION_INVALID"].includes(cause.code ?? "")) {
        corrections.forget(slot); setPending(null);
      }
      setNotice(displayAdminError(cause));
    } finally {
      busy.current = false;
      setSubmitting(false);
      if (ownedGeneration === generation.current) {
        setConfirmation(null); setData(null); setAttempt(value => value + 1);
      }
    }
  };
  return <Drawer title={`通知时间证据 · ${notificationId}`} onClose={onClose}>
    <div style={{ padding: 16, display: "grid", gap: 14 }}>
      <p>读取证据不会修改通知。校正时间需要单独确认，已读状态保持不变。</p>
      {notice && <p role="status">{notice}</p>}
      {pending && canCorrect && actorKey && <div role="status">
        <p>原校正请求尚未收敛。重试将保留原证据、理由和请求号。</p>
        <p>原理由：{pending.reason}</p><p>请求号：{pending.commandKey}</p>
        <button type="button" disabled={submitting} onClick={() => void submit(pending.reason)}>重试原校正</button>
      </div>}
      {!data && !error && <p role="status">正在读取关联证据…</p>}
      {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重试</button></div>}
      {data && <>
        <p role="status">{data.status === "MATCHED"
          ? data.storedCreatedAt === data.deliveryFactTime
            ? "当前记录时间与投递事实时间一致，无需校正。"
            : "关联证据一致；记录时间与投递事实时间不一致，尚未校正。"
          : data.reason}</p>
        <dl>
          <dt>当前记录时间（北京时间）</dt><dd>{data.storedCreatedAt}</dd>
          <dt>投递事实时间（北京时间）</dt><dd>{data.deliveryFactTime ?? "尚不可确认"}</dd>
        </dl>
        {data.facts.length > 0 && <ul>{data.facts.map(fact => <li key={fact.eventId}>
          <strong>{fact.eventName}</strong><br />事件编号：{fact.eventId}<br />
          UTC：{new Date(fact.timestampMillis).toISOString()}
        </li>)}</ul>}
        <p>此处展示当前回读证据；是否曾执行校正请查审计记录。</p>
        {!pending && canCorrect && actorKey && data.status === "MATCHED" && data.storedCreatedAt !== data.deliveryFactTime
          && <button type="button" onClick={() => setConfirmation(data)}>按投递事实校正时间</button>}
      </>}
    </div>
    {confirmation && canCorrect && actorKey && <OperationConfirmModal action={`校正通知 ${notificationId} 的时间`}
      detail={`仅此通知：${confirmation.storedCreatedAt} → ${confirmation.deliveryFactTime}（北京时间）。根据实际投递事实校正展示时间，不会重新发送通知或改变已读状态。`}
      reasonMax={500} onClose={() => { if (!busy.current) setConfirmation(null); }} onConfirm={submit} />}
  </Drawer>;
}
