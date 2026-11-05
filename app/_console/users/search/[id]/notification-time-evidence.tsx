"use client";

import { useEffect, useRef, useState } from "react";
import { Clock3 } from "lucide-react";
import { OperationConfirmModal } from "@/app/components/domain-views/design-kit";
import { BlockState, Button, Decision, Drawer, Explain, Fact, Facts, JudgmentPoints, Modal, Notice, StatusTag } from "@/app/components/rd";
import { correctNotificationTime, fetchNotificationTimeEvidence, UsersOutcomeUnknownError, UsersRequestError, type NotificationTimeEvidence } from "@/lib/admin/user360-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";

type CorrectionCommand = PendingMutationRecord & { preview: NotificationTimeEvidence; reason: string; retryRejected?: boolean };
export type PendingCorrection = CorrectionCommand;
const corrections = createPendingMutationStore<CorrectionCommand>({
  storageKey: "nexion-admin-notification-time-corrections-v1",
  // 过期不能重试，记录也不删（OP-96）。
  retainExpiredRecords: true,
  isValidRecord: command => typeof command.reason === "string" && command.reason.trim().length > 0 && command.reason.length <= 500
    && !!command.preview && command.preview.status === "MATCHED" && Number.isSafeInteger(command.preview.notificationId)
    && command.preview.notificationId > 0 && typeof command.preview.storedCreatedAt === "string"
    && typeof command.preview.deliveryFactTime === "string" && Array.isArray(command.preview.facts) && command.preview.facts.length === 3,
});
/** 证据或快照已经变了：原校正不会再生效，清掉待确认，回读最新证据。 */
const SETTLED_CODES = ["NOTIFICATION_TIME_SNAPSHOT_CHANGED", "NOTIFICATION_TIME_EVIDENCE_CHANGED", "NOTIFICATION_TIME_ALREADY_CORRECT", "NOTIFICATION_TIME_CORRECTION_INVALID"];
const FACT_NAME: Record<string, string> = { "auth.register_completed": "注册完成", "nova.push_sent": "推送已发出", "notification.delivered": "通知已送达" };
const EXPIRED_TEXT = "已超过 24 小时，不能再重试，请到操作记录与审批核对";
/** 页面上方常显用：这个操作人、这个用户的未确认校正。槽位是 [操作人, 用户, 通知编号]。 */
export function pendingCorrections(actorKey: string, userKeys: readonly string[]) {
  return corrections.list().filter((command) => {
    const [actor, user] = JSON.parse(command.fingerprint) as [string, string];
    return actor === actorKey && userKeys.includes(user);
  });
}
const outcomeUnknown = (cause: unknown) => cause instanceof UsersOutcomeUnknownError || cause instanceof UsersRequestError && cause.code === "IDEMPOTENCY_RESULT_UNKNOWN";

export function NotificationTimeEvidenceDrawer({ userKey, notificationId, actorKey, canCorrect = false, onCorrected, onPendingChange, onClose }: {
  userKey: string; notificationId: number; actorKey?: string; canCorrect?: boolean; onCorrected?: () => void; onPendingChange?: () => void; onClose: () => void;
}) {
  const [data, setData] = useState<NotificationTimeEvidence | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [confirmation, setConfirmation] = useState<NotificationTimeEvidence | null>(null);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<CorrectionCommand | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [releasing, setReleasing] = useState(false);
  // 页面可能用编码或用户号打开，槽位用记录里的原值，查得到才算同一条。
  const saved = corrections.list().find((command) => {
    const [actor, , id] = JSON.parse(command.fingerprint) as [string, string, number];
    return actor === actorKey && id === notificationId;
  });
  const slot = saved?.fingerprint ?? JSON.stringify([actorKey, userKey, notificationId]);
  const generation = useRef(0);
  const busy = useRef(false);
  const refreshPending = () => { setPending(corrections.list().find(command => command.fingerprint === slot) ?? null); onPendingChange?.(); };
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
    const retained = !!command;
    if (command && command.expiresAt <= Date.now()) return;
    if (!command) {
      if (!confirmation) return;
      corrections.remember(slot, `notification-time-${crypto.randomUUID()}`, { preview: confirmation, reason: reason.trim() });
      command = corrections.list().find(value => value.fingerprint === slot);
    }
    if (!command) throw new Error("无法保留原校正请求，请重试");
    // 先落盘再发（OP-92）：存不下时刷新就丢命令号，结果未知后没法恢复。
    if (!corrections.isDurablyStored(slot, command.commandKey)) {
      if (retained) { setNotice("本机存储里查不到原校正，这次没有发送。到操作记录与审批核对，待确认继续保留。"); return; }
      corrections.forget(slot, command.commandKey);
      throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
    corrections.remember(slot, command.commandKey, { preview: command.preview, reason: command.reason, retryRejected: false });
    setPending(command);
    onPendingChange?.();
    busy.current = true;
    setSubmitting(true);
    const ownedGeneration = generation.current;
    const reread = () => { setConfirmation(null); setData(null); setAttempt(value => value + 1); };
    try {
      await correctNotificationTime(userKey, command.preview, command.reason, command.commandKey);
      if (ownedGeneration !== generation.current) return;
      corrections.forget(slot);
      refreshPending();
      setNotice("已按投递事实校正通知时间，已读状态保持不变。");
      reread();
      onCorrected?.();
    } catch (cause) {
      if (ownedGeneration !== generation.current) return;
      const settled = cause instanceof UsersRequestError && SETTLED_CODES.includes(cause.code ?? "");
      if (outcomeUnknown(cause)) { reread(); return; }
      if (settled) {
        corrections.forget(slot);
        refreshPending();
        setNotice(displayAdminError(cause));
        reread();
        return;
      }
      if (retained) {
        // 重试被拒说明不了原操作的结果：原命令继续保留，人核实后才解除（OP-93 第 8 条）。
        setNotice(`重试没有成功：${displayAdminError(cause)} 这说明不了原校正的结果，原命令继续保留。`);
        corrections.remember(slot, command.commandKey, { preview: command.preview, reason: command.reason, retryRejected: true });
        refreshPending();
        return;
      }
      // 第一次提交被明确拒绝：框留着写原因，理由不丢。
      corrections.forget(slot);
      refreshPending();
      if (isPermissionDenied(cause)) throw cause;
      throw new Error(displayAdminError(cause));
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };
  const release = () => {
    corrections.forget(slot);
    refreshPending();
    setReleasing(false);
    setNotice("已解除待确认，可以重新校正。");
  };
  const expired = !!pending && pending.expiresAt <= Date.now();
  const correctable = !pending && canCorrect && !!actorKey && data?.status === "MATCHED" && data.storedCreatedAt !== data.deliveryFactTime;
  const conclusion = data && (data.status === "MATCHED"
    ? data.storedCreatedAt === data.deliveryFactTime
      ? "当前记录时间与投递事实时间一致，无需校正。"
      : "关联证据一致；记录时间与投递事实时间不一致，尚未校正。"
    : data.reason);
  return <Drawer open onClose={onClose} busy={submitting} icon={Clock3} tone="role-3" title={`通知时间证据 · ${notificationId}`}
    explain={<><p>读取证据不会修改通知。校正时间需要单独确认，已读状态保持不变。</p><p>此处展示当前回读证据；是否曾执行校正请查审计记录。</p></>}
    footer={correctable ? <Decision primary={<Button variant="primary" onClick={() => setConfirmation(data)}>按投递事实校正时间</Button>} /> : undefined}>
    {notice && <Notice tone="progress">{notice}</Notice>}
    {pending && canCorrect && actorKey && <Notice tone="warn" title="原校正请求结果尚未确认。"
      action={<>
        <Button size="sm" loading={submitting} disabledReason={expired ? EXPIRED_TEXT : undefined} onClick={() => void submit(pending.reason)}>重试原校正</Button>
        {pending.retryRejected && <Button size="sm" disabled={submitting} onClick={() => setReleasing(true)}>解除待确认</Button>}
      </>}>
      {expired ? `${EXPIRED_TEXT}。` : "重试将保留原证据、理由和请求号。"}原理由：{pending.reason}
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
    {confirmation && canCorrect && actorKey && <OperationConfirmModal briefKind={"content"} action={`校正通知 ${notificationId} 的时间`}
      detail={`仅此通知：${confirmation.storedCreatedAt} → ${confirmation.deliveryFactTime}（北京时间）。根据实际投递事实校正展示时间，不会重新发送通知或改变已读状态。`}
      facts={<Facts>
        <Fact k="通知编号">{notificationId}</Fact>
        <Fact k="展示时间（北京时间）">{confirmation.storedCreatedAt} → {confirmation.deliveryFactTime}</Fact>
      </Facts>}
      effect={<StatusTag tone="progress" filled>立即生效</StatusTag>} confirmLabel="确认校正，立即生效"
      statedBrief={{ impact: "只改这条通知显示的时间，不重新发送，已读状态不变。", check: "核对当前记录时间和投递事实时间，理由写明依据。" }}
      reasonMax={500} onClose={() => { if (!busy.current) setConfirmation(null); }} onConfirm={submit} />}
    {releasing && pending && <Modal title="解除待确认" onClose={() => setReleasing(false)} footer={<>
      <Button onClick={() => setReleasing(false)}>取消</Button>
      <Button variant="primary" onClick={release}>确认解除</Button>
    </>}>
      <p><b>校正通知 {notificationId} 的时间</b></p>
      <p>重试被拒说明不了原校正的结果。先到操作记录确认原操作有没有生效，再解除。</p>
      <p>解除后这条通知可以重新校正，原操作不再重试。这一步只放开本页的锁，不发请求，不写操作记录。</p>
    </Modal>}
  </Drawer>;
}
