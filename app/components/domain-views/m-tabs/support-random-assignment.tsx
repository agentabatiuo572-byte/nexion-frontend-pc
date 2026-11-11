"use client";
import { m1CustomerCode } from "./m1-customer-code";
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { supportEnhancements, parseRandomResult, type RandomPreview, type RandomResult } from "@/lib/admin/m-support-enhancements";
import { supportClient, SupportClientError, readSupportPoolCustomer, type SupportBindingPoolItem } from "@/lib/admin/m-support-client";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { canReplayGroupCommand } from "@/lib/admin/support-group-client";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { displayAdminError } from "@/lib/admin/error-messages";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { Modal, Button, Facts, Fact, Field, Textarea, Check, Notice, Fold, Table, Th, Td, Tr, Segments, StatusTag } from "@/app/components/rd";

type RandomPending = PendingMutationRecord & { actorId: number; payload: { previewId: string; expectedRulesVersion: number; reason: string }; customers: SupportBindingPoolItem[]; preview: RandomPreview };
export const randomAssignmentCommands = createPendingMutationStore<RandomPending>({ storageKey: "nexion-support-random-assignment", retainExpiredRecords: true, isValidRecord: r => Number.isSafeInteger(r.actorId) && Boolean(r.payload?.previewId) && Array.isArray(r.customers) && Array.isArray(r.preview?.customers) });
export const hasPendingRandomAssignment = (actorId: number) => randomAssignmentCommands.list().some(r => r.actorId === actorId);
const resultLabels: Record<string, string> = { ASSIGNED: "已分配", NO_CANDIDATE: "无合格候选", CONFLICT: "资料冲突，需刷新", SKIPPED: "本次跳过" };

export function SupportRandomAssignment({ customers, onClose, onDone }: { customers: SupportBindingPoolItem[]; onClose: () => void; onDone: () => void }) {
  const actorId = useAdminAuth(s => s.session?.adminId ?? 0), epoch = useAdminAuth(s => s.authEpoch);
  const [preview, setPreview] = useState<RandomPreview | null>(null), [reason, setReason] = useState(""), [ack, setAck] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<RandomResult | null>(null), [pending, setPending] = useState<RandomPending | null>(null), [notReceived, setNotReceived] = useState(false);
  const [list, setList] = useState("included"), [previewUnknown, setPreviewUnknown] = useState(false), [reasonLeft, setReasonLeft] = useState(false);
  const mounted = useRef(true), [draftOwner, setDraftOwner] = useState(0);
  const stamp = () => { const s = useAdminAuth.getState(); return `${s.authEpoch}:${s.session?.adminId}`; };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!actorId) return;
    try { setReason(sessionStorage.getItem(`nexion-random-reason:${actorId}`) ?? ""); } catch { setError("理由暂不能保留，请在本页完成核对。"); }
    setDraftOwner(actorId);
    const saved = randomAssignmentCommands.list().find(r => r.actorId === actorId);
    setPending(saved ?? null); setPreview(saved?.preview ?? null); setResult(null); setAck(false); setNotReceived(false);
    if (saved) { setReason(saved.payload.reason); setError("原分配结果待确认，请查询原操作，不能重新抽签。"); }
  }, [actorId, epoch]);
  useEffect(() => { if (draftOwner === actorId && actorId) { try { sessionStorage.setItem(`nexion-random-reason:${actorId}`, reason); } catch { setError("理由暂不能保留，请在本页完成核对。"); } } }, [reason, actorId, draftOwner]);
  async function generatePreview() {
    if (busy || hasPendingRandomAssignment(actorId) || !customers.length) return;
    const owner = stamp(); setBusy(true); setPreview(null); setAck(false); setError(""); setPreviewUnknown(false);
    try {
      // A new snapshot always re-reads the original, exact list; old confirmations are invalidated first.
      const current = await Promise.all(customers.map(c => readSupportPoolCustomer(c.customerId)));
      const next = await supportEnhancements.randomPreview(current.map(c => ({ id: c.customerId, poolVersion: c.version })));
      if (mounted.current && owner === stamp()) setPreview(next);
    } catch (e) { if (mounted.current && owner === stamp()) { setPreviewUnknown(true); setError(displayAdminError(e)); } }
    finally { if (mounted.current && owner === stamp()) setBusy(false); }
  }
  useEffect(() => { if (!hasPendingRandomAssignment(actorId)) void generatePreview(); }, [customers, actorId, epoch]);
  function complete(record: RandomPending, next: RandomResult) {
    if (next.customers.length !== record.preview.count || new Set(next.customers.map(c => c.customerId)).size !== next.customers.length || record.preview.customers.some(c => !next.customers.some(v => v.customerId === c.id))) throw new Error("SUPPORT_RANDOM_RESULT_INCOMPLETE");
    randomAssignmentCommands.forget(record.fingerprint, record.commandKey); setPending(null); setResult(next); setError(""); onDone();
  }
  async function send(record: RandomPending, replay = false) {
    if (busy || replay && (!notReceived || !canReplayGroupCommand(record))) return;
    const owner = stamp(); setBusy(true); setError(""); setNotReceived(false);
    let acknowledged = false;
    try {
      const next = await supportEnhancements.randomConfirm(record.payload, record.commandKey); acknowledged = true;
      if (!mounted.current || owner !== stamp()) return;
      complete(record, next);
    } catch (e) {
      if (!mounted.current || owner !== stamp()) return;
      setError("随机分配结果待确认，原名单、预览、理由与命令号已保留。" + displayAdminError(e));
      if (!acknowledged && !replay && isExplicitRejection(e)) { randomAssignmentCommands.forget(record.fingerprint, record.commandKey); setPending(null); setPreview(null); setPreviewUnknown(true); setError("本次分配被明确拒绝，请重新读取原名单并生成新预览。" + displayAdminError(e)); }
    } finally { if (mounted.current && owner === stamp()) setBusy(false); }
  }
  async function confirm() {
    if (busy || pending || !preview?.count || !ack || reason.trim().length < 8 || reason.trim().length > 200 || Date.parse(preview.expiresAt) <= Date.now()) return;
    const fingerprint = `${actorId}:random`, commandKey = crypto.randomUUID();
    randomAssignmentCommands.remember(fingerprint, commandKey, { actorId, payload: { previewId: preview.id, expectedRulesVersion: preview.rulesVersion, reason: reason.trim() }, customers, preview });
    const record = randomAssignmentCommands.list().find(r => r.commandKey === commandKey)!;
    if (!randomAssignmentCommands.isDurablyStored(fingerprint, commandKey)) { randomAssignmentCommands.forget(fingerprint, commandKey); setError("浏览器无法保存原操作，未提交分配。请恢复会话存储后重试。"); return; }
    setPending(record); await send(record);
  }
  async function query() {
    if (!pending || busy) return;
    const record = pending, owner = stamp(); setBusy(true); setError(""); setNotReceived(false);
    try {
      const receipt = await supportClient.command(record.commandKey);
      if (!mounted.current || owner !== stamp()) return;
      if (receipt.status === "SUCCEEDED") complete(record, parseRandomResult(receipt.result));
      else if (receipt.status === "FAILED") { randomAssignmentCommands.forget(record.fingerprint, record.commandKey); setPending(null); setPreview(null); setPreviewUnknown(true); setError("原命令已确认失败；理由保留，请重新生成原名单的新预览。"); }
      else setError("原分配仍在处理中，原命令保持不变；请稍后查询。");
    } catch (e) {
      if (!mounted.current || owner !== stamp()) return;
      const absent = e instanceof SupportClientError && e.status === 404 && e.backendMessage === "SUPPORT_COMMAND_NOT_FOUND";
      setNotReceived(absent && canReplayGroupCommand(record));
      setError(absent && canReplayGroupCommand(record) ? "尚未找到原回执，可在 24 小时内按原操作重试。" : "暂时无法确认原操作，原名单、内容与命令号仍保留。");
    } finally { if (mounted.current && owner === stamp()) setBusy(false); }
  }
  useEffect(() => { window.dispatchEvent(new Event("m1-pending-changed")); }, [pending]);
  const selected = pending?.customers ?? customers, expired = pending && !canReplayGroupCommand(pending), reasonOk = reason.trim().length >= 8 && reason.trim().length <= 200;
  return <Modal title={result ? "逐客随机分配结果" : "随机分配客户"} wide busy={busy} onClose={onClose} footer={<>
    <Button disabled={busy} onClick={onClose}>{result ? "关闭结果" : "返回客户池"}</Button>
    {pending ? <>{notReceived && !expired && <Button disabled={busy} onClick={() => void send(pending, true)}>按原操作重试</Button>}<Button variant="primary" loading={busy} onClick={() => void query()}>查询原操作</Button></> : !result && <Button variant="primary" disabled={!preview?.count || !ack || !reasonOk || busy || Date.parse(preview.expiresAt) <= Date.now()} onClick={() => void confirm()}>确认随机分配 {preview?.count ?? "—"} 位</Button>}
  </>}>
    {pending && <Notice tone="warn">原操作结果待确认，名单和理由已锁定；不能重新抽签。{expired && "已超过 24 小时，只能查询和核对，不能重新发送。"}</Notice>}
    {error && <Notice tone={pending || previewUnknown ? "warn" : "danger"}>{error}</Notice>}
    <Facts><Fact k="原选中客户" lead unit="位">{selected.length}</Fact><Fact k="纳入 / 排除">{preview ? `${preview.count} / ${preview.excluded.length}` : "尚未读取"}</Fact>{preview && <Fact k="预览有效期至">{formatBusinessTimeCompact(preview.expiresAt)}（北京时间）</Fact>}</Facts>
    <p>只处理本次选中的客户。每位成功客户成为新继承段的起点，未选客户及已有团队成员保持原归属。</p>
    {result ? <Table label="逐客随机分配结果"><thead><Tr><Th>客户编号</Th><Th>结果</Th><Th>专属客服</Th><Th>原因</Th></Tr></thead><tbody>{result.customers.map(c => <Tr key={c.customerId}><Td>{c.customerId}</Td><Td><StatusTag tone={c.status === "ASSIGNED" ? "ok" : c.status === "CONFLICT" ? "warn" : "done"}>{resultLabels[c.status] ?? "未知"}</StatusTag></Td><Td>{c.agentAdminId ?? "—"}</Td><Td>{c.status === "ASSIGNED" ? "已分配" : resultLabels[c.status] ?? "请核对原结果"}</Td></Tr>)}</tbody></Table> : <>
      <Segments label="随机预览名单" value={list} onChange={setList} items={[{ value: "included", label: "原选中名单" }, { value: "excluded", label: "排除名单" }]} />
      <Table label="随机预览名单"><thead><Tr><Th>客户</Th><Th>编码</Th><Th>结果</Th></Tr></thead><tbody>{list === "included" ? selected.map(c => <Tr key={c.customerId}><Td>{operatorNicknameText(c.displayName || "") || `客户 ${c.customerId}`}</Td><Td>{m1CustomerCode(c.customerId)}</Td><Td>{preview ? preview.customers.some(v => v.id === c.customerId) ? "纳入预览" : "已排除" : "待核对"}</Td></Tr>) : preview?.excluded.map(c => <Tr key={c.customerId}><Td>{c.customerId}</Td><Td>—</Td><Td>当前不符合条件，请核对客户池</Td></Tr>)}</tbody></Table>
      {preview && <Fold inset title="技术信息" summary="规则版本与原命令"><Facts><Fact k="规则版本">{preview.rulesVersion}</Fact>{pending && <Fact k="原命令号">{pending.commandKey}</Fact>}</Facts></Fold>}
      {!pending && (previewUnknown || preview && Date.parse(preview.expiresAt) <= Date.now()) && <Notice tone="warn" action={<Button disabled={busy} onClick={() => void generatePreview()}>重新生成预览</Button>}>重新读取原名单后生成新快照，旧预览的确认作废；这会生成新的预览。</Notice>}
      <Field label="处理理由" required hint="8–200 字" error={reasonLeft && !reasonOk ? "请填写 8–200 字的处理理由。" : undefined}>{control => <Textarea {...control} rows={3} value={reason} maxLength={200} count={`${reason.trim().length}/200`} disabled={busy || Boolean(pending)} onBlur={() => setReasonLeft(true)} onChange={e => setReason(e.target.value)} />}</Field>
      <Check checked={ack || Boolean(pending)} disabled={busy || Boolean(pending)} onChange={e => setAck(e.target.checked)} label="已核对人数、排除项和新继承段规则，只处理此名单。" />
    </>}
  </Modal>;
}
