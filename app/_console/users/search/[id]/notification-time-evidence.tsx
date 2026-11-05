"use client";

import { useEffect, useRef, useState } from "react";
import { Clock3 } from "lucide-react";
import { OperationConfirmModal } from "@/app/components/domain-views/design-kit";
import { BlockState, Button, Change, Decision, Drawer, Explain, Fact, Facts, JudgmentPoints, Notice, ReleaseModal, StatusTag } from "@/app/components/rd";
import { correctNotificationTime, fetchNotificationTimeEvidence, UsersOutcomeUnknownError, UsersRequestError, type NotificationTimeEvidence } from "@/lib/admin/user360-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";

type CorrectionCommand = PendingMutationRecord & { preview: NotificationTimeEvidence; reason: string };
const corrections = createPendingMutationStore<CorrectionCommand>({
  storageKey: "nexion-admin-notification-time-corrections-v1",
  isValidRecord: command => typeof command.reason === "string" && command.reason.trim().length > 0 && command.reason.length <= 500
    && !!command.preview && command.preview.status === "MATCHED" && Number.isSafeInteger(command.preview.notificationId)
    && command.preview.notificationId > 0 && typeof command.preview.storedCreatedAt === "string"
    && typeof command.preview.deliveryFactTime === "string" && Array.isArray(command.preview.facts) && command.preview.facts.length === 3,
});
/** 证据或快照已经变了：原校正不会再生效，清掉待确认，回读最新证据。 */
const SETTLED_CODES = ["NOTIFICATION_TIME_SNAPSHOT_CHANGED", "NOTIFICATION_TIME_EVIDENCE_CHANGED", "NOTIFICATION_TIME_ALREADY_CORRECT", "NOTIFICATION_TIME_CORRECTION_INVALID"];
const FACT_NAME: Record<string, string> = { "auth.register_completed": "注册完成", "nova.push_sent": "推送已发出", "notification.delivered": "通知已送达" };
const outcomeUnknown = (cause: unknown) => cause instanceof UsersOutcomeUnknownError || cause instanceof UsersRequestError && cause.code === "IDEMPOTENCY_RESULT_UNKNOWN";

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
  const [retryRejected, setRetryRejected] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const slot = JSON.stringify([actorKey, userKey, notificationId]);
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => { setNotice(""); setRetryRejected(false); setPending(corrections.list().find(command => command.fingerprint === slot) ?? null); }, [slot]);
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
    const retained = !!command;
    if (!command) {
      if (!confirmation) return;
      corrections.remember(slot, `notification-time-${crypto.randomUUID()}`, { preview: confirmation, reason: reason.trim() });
      command = corrections.list().find(value => value.fingerprint === slot);
    }
    if (!command) throw new Error("无法保留原校正请求，请重试");
    setPending(command);
    busy.current = true;
    setSubmitting(true);
    setRetryRejected(false);
    const ownedGeneration = generation.current;
    const reread = () => { setConfirmation(null); setData(null); setAttempt(value => value + 1); };
    try {
      await correctNotificationTime(userKey, command.preview, command.reason, command.commandKey);
      if (ownedGeneration !== generation.current) return;
      corrections.forget(slot);
      setPending(null);
      setNotice("已按投递事实校正通知时间，已读状态保持不变。");
      reread();
      onCorrected?.();
    } catch (cause) {
      if (ownedGeneration !== generation.current) return;
      const settled = cause instanceof UsersRequestError && SETTLED_CODES.includes(cause.code ?? "");
      if (settled) { corrections.forget(slot); setPending(null); }
      if (outcomeUnknown(cause)) { reread(); return; }
      if (settled) {
        setNotice(displayAdminError(cause));
        reread();
        return;
      }
      if (retained) {
        // 重试被拒说明不了原操作的结果：原命令继续保留，人核实后才解除（OP-93 第 8 条）。
        setNotice(`重试没有成功：${displayAdminError(cause)} 这说明不了原校正的结果，原命令继续保留。`);
        setRetryRejected(true);
        return;
      }
      // 第一次提交被明确拒绝：框留着写原因，理由不丢。
      corrections.forget(slot);
      setPending(null);
      if (isPermissionDenied(cause)) throw cause;
      throw new Error(displayAdminError(cause));
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };
  const release = () => {
    corrections.forget(slot);
    setPending(null);
    setRetryRejected(false);
    setReleasing(false);
    setNotice("已解除待确认，可以重新校正。");
  };
  const correctable = !pending && canCorrect && !!actorKey && data?.status === "MATCHED" && data.storedCreatedAt !== data.deliveryFactTime;
  const conclusion = data && (data.status === "MATCHED"
    ? data.storedCreatedAt === data.deliveryFactTime
      ? "当前记录时间与投递事实时间一致，无需校正。"
      : "关联证据一致；记录时间与投递事实时间不一致，尚未校正。"
    : data.reason);
  return <Drawer open onClose={onClose} busy={submitting} icon={Clock3} tone="role-3" title="通知时间证据" sub={`通知 ${notificationId}`}
    explain={<><p>读取证据不会修改通知。校正时间需要单独确认，已读状态保持不变。</p><p>此处展示当前回读证据；是否曾执行校正请查审计记录。</p></>}
    footer={correctable ? <Decision primary={<Button variant="primary" onClick={() => setConfirmation(data)}>按投递事实校正时间</Button>} /> : undefined}>
    {notice && <Notice tone="progress">{notice}</Notice>}
    {pending && canCorrect && actorKey && <Notice tone="warn" title="原校正请求结果尚未确认。"
      action={<>
        <Button size="sm" loading={submitting} onClick={() => void submit(pending.reason)}>重试原校正</Button>
        {retryRejected && <Button size="sm" disabled={submitting} onClick={() => setReleasing(true)}>解除待确认</Button>}
      </>}>
      重试将保留原证据、理由和请求号。原理由：{pending.reason}
      <Explain label="技术信息" content={`请求号：${pending.commandKey}`} />
    </Notice>}
    {!data && !error && <BlockState state="loading" title="正在读取关联证据…" />}
    {error && <BlockState state="error" title={error} onRetry={() => setAttempt(value => value + 1)} />}
    {data && <>
      <JudgmentPoints title="判断要点" rows={[
        { label: "结论", value: conclusion, state: data.status === "MATCHED" ? undefined : "warn" },
        { label: "当前记录时间（北京时间）", value: data.storedCreatedAt },
        { label: "投递事实时间（北京时间）", value: data.deliveryFactTime ?? "尚不可确认" },
      ]} />
      {data.facts.length > 0 && <Facts>{data.facts.map(fact => <Fact key={fact.eventId} k={FACT_NAME[fact.eventName] ?? fact.eventName}>
        <span data-mono>事件编号：{fact.eventId}</span><br />UTC：{new Date(fact.timestampMillis).toISOString()}
      </Fact>)}</Facts>}
    </>}
    {confirmation && canCorrect && actorKey && <OperationConfirmModal briefKind={"content"} action={`校正通知 ${notificationId} 的时间`} title="校正通知时间"
      detail={`仅此通知：${confirmation.storedCreatedAt} → ${confirmation.deliveryFactTime}（北京时间）。根据实际投递事实校正展示时间，不会重新发送通知或改变已读状态。`}
      facts={<Facts>
        <Fact k="通知编号">{notificationId}</Fact>
        <Fact k="展示时间（北京时间）"><Change from={confirmation.storedCreatedAt} to={confirmation.deliveryFactTime} /></Fact>
      </Facts>}
      effect={<StatusTag tone="progress" filled>立即生效</StatusTag>} confirmLabel="确认校正，立即生效"
      statedBrief={{ impact: "只改这条通知显示的时间，不重新发送，已读状态不变。", check: "核对当前记录时间和投递事实时间，理由写明依据。" }}
      reasonMax={500} onClose={() => { if (!busy.current) setConfirmation(null); }} onConfirm={submit} />}
    {releasing && pending && <ReleaseModal label={`校正通知 ${notificationId} 的时间`} onCancel={() => setReleasing(false)} onConfirm={release}
      explain="重试被拒说明不了原校正的结果，先到操作记录确认原操作有没有生效。解除后原操作不再重试。" />}
  </Drawer>;
}
