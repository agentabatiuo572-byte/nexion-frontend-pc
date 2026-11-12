"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LockKeyhole, RefreshCw } from "lucide-react";
import { BlockState, Button, Cell, Decision, Drawer, Fact, Facts, Fold, IconButton, Notice, Panel, ReleaseModal, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr } from "@/app/components/rd";
import { OperationConfirmModal } from "../design-kit";
import { PhoneApiError, fetchPhoneModelLocks, submitModelLockCommand, pendingModelLockCommands, settleReturnedModelLockCommands, recoverModelLockCommand, retryModelLockCommand, forgetModelLockCommand, type PendingModelLockCommand, type PhoneModelLock } from "@/lib/admin/phone-replacement-client";
import { PHONE_GRANT, phonePlatformLabel } from "@/lib/admin/phone-replacement-contract";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { PhoneIdentifier, phoneTimeCompact as phoneTime } from "../phone-replacement-receipt";
import { announcePermissionDenied } from "@/lib/admin/operation-confirm-error";

function state(lock: PhoneModelLock) {
  return lock.released ? "已解除，待重新校准" : lock.held ? "换报机型或芯片被拦截" : lock.releasable ? "已锁定" : "未锁定";
}
export function PhoneModelLockSection({ userId, userCode, userLabel, rights, active = true, onPendingChange, onBusyChange }: { active?: boolean; userId: string; userCode: string; userLabel: string; rights: string[]; onPendingChange?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const owner = useAdminAuth(value => value.session?.adminId ?? 0), canRelease = rights.includes(PHONE_GRANT);
  const [locks, setLocks] = useState<PhoneModelLock[] | null>(null), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [target, setTarget] = useState<PhoneModelLock | null>(null), [detail, setDetail] = useState<PhoneModelLock | null>(null);
  const [denied, setDenied] = useState(false);
  const [release, setRelease] = useState<PendingModelLockCommand | null>(null);
  const [pending, setPending] = useState(() => pendingModelLockCommands(owner, userId));
  const live = useRef(true), generation = useRef(0), mutation = useRef(false);
  const load = useCallback(async () => {
    const id = ++generation.current; setLoading(true); setError(""); setLocks(null);
    try { const next = await fetchPhoneModelLocks(userId); if (live.current && id === generation.current) { setDenied(false); setLocks(next); settleReturnedModelLockCommands(owner, userId); setPending(pendingModelLockCommands(owner, userId)); onPendingChange?.(); } return true; }
    catch (failure) { if (live.current && id === generation.current) { setError(failure instanceof Error ? failure.message : "查询暂不可用，请稍后重试。"); if (failure instanceof PhoneApiError && [401, 403].includes(failure.status)) { setDenied(true); setTarget(null); setDetail(null); setRelease(null); announcePermissionDenied(); } } return false; }
    finally { if (live.current && id === generation.current) setLoading(false); }
  }, [userId, owner, onPendingChange]);
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; generation.current++; }; }, [load]);
  const blocked = busy ? "正在提交" : pending.length ? "原解除结果待核实，请先核对原操作" : loading ? "正在读取机型锁" : undefined;
  const recover = async (row: PendingModelLockCommand, retry: boolean) => {
    if (mutation.current || retry && !canRelease) return;
    mutation.current = true; setBusy(true); onBusyChange?.(true); setError(""); setMessage("");
    try {
      const succeeded = retry ? !!await retryModelLockCommand(row) : await recoverModelLockCommand(row);
      if (!live.current) return;
      setPending(pendingModelLockCommands(owner, userId)); onPendingChange?.();
      if (succeeded) { setMessage("原解除已成功，用户仍需在 App 重新校准。"); if (!await load()) setMessage("已取得原解除成功回执，当前安装状态尚未刷新，请读回核对。"); }
      else setMessage(row.rejection ? "原操作重试已被明确拒绝，原记录继续保留；核实原结果后可解除本页待确认。" : "原解除结果尚未确认，原记录继续保留，请稍后查询。");
    } catch (failure) { if (live.current) { setError(failure instanceof Error ? failure.message : "原解除结果尚未确认，原记录继续保留。"); if (failure instanceof PhoneApiError && [401, 403].includes(failure.status)) { setDenied(true); setTarget(null); setDetail(null); setRelease(null); announcePermissionDenied(); } } }
    finally { mutation.current = false; onBusyChange?.(false); if (live.current) { setBusy(false); setPending(pendingModelLockCommands(owner, userId)); onPendingChange?.(); } }
  };
  return <Panel aria-label="手机机型锁" title="手机机型锁" icon={LockKeyhole} explain="每台手机首次校准后锁定机型。仅核实用户确实换机后解除；随后由用户在 App 重新校准锁定新机型。" actions={<IconButton aria-label="刷新手机机型锁" disabled={busy || loading || !!target} onClick={() => void load()}><RefreshCw size={16} /></IconButton>} flush>
    <div data-proof="c5-phone-model-lock">
      {error && (locks ? <Notice tone="warn">{error}</Notice> : <BlockState state="error" title="机型锁未能读取或处置" detail={error} onRetry={() => void load()} retryLabel="刷新" />)}
      {message && <Notice tone="progress">{message}</Notice>}
      {pending.map(row => <Notice key={row.commandKey} tone="warn" title="机型锁解除结果待核实" action={<><Button size="sm" disabled={loading || busy} onClick={async () => { if (await load()) setMessage("已读回当前安装状态。当前状态不能证明原命令结果，原记录继续保留。"); }}>读回核对</Button>{!denied && row.receiptSupported && <><Button size="sm" disabled={loading || busy} onClick={() => void recover(row, false)}>查原解除结果</Button>{canRelease && !row.returned && !row.rejection && row.expiresAt > Date.now() && <Button size="sm" disabled={loading || busy} onClick={() => void recover(row, true)}>按原操作重试</Button>}{row.rejection && <Button size="sm" variant="danger-outline" disabled={loading || busy} onClick={() => setRelease(row)}>解除待确认</Button>}</>}</>}>{!denied && <Fold title="查看原解除记录" summary={`${row.installationId} · ${phoneTime(row.createdAt)}`}><Facts><Fact k="原安装">{row.installationId}</Fact><Fact k="原机型">{row.lock.lockedModel ?? "—"}</Fact><Fact k="原芯片">{row.lock.lockedChip ?? "—"}</Fact><Fact k="原版本">{row.body.expectedRevision}</Fact><Fact k="原理由">{row.body.reason}</Fact><Fact k="原命令号">{row.commandKey}</Fact>{row.rejection && <Fact k="重试拒绝">{row.rejection}</Fact>}<Fact k="恢复方式">{row.rejection ? "已明确拒绝，核实后可解除待确认" : !row.receiptSupported ? "升级前的记录，只读回核对，不提供重发" : row.expiresAt <= Date.now() ? "已过 24 小时，保留记录，只查询原结果" : "按原操作重试或查原解除结果"}</Fact></Facts></Fold>}</Notice>)}
      <Table aria-label="手机机型锁" label="手机机型锁" className="c5-model-locks"><thead><tr><Th>手机</Th><Th>锁定机型</Th><Th>最近上报</Th><Th>状态</Th><Th sticky="end">操作</Th></tr></thead><tbody>{loading ? <TableLoading columns={5} /> : locks?.map(lock => <Tr key={lock.installationId} selected={detail?.installationId === lock.installationId} onOpen={() => setDetail(lock)}><Td><Cell main={phonePlatformLabel(lock.platform)} sub={<PhoneIdentifier value={lock.installationId} />} title={lock.installationId} /></Td><Td><Cell main={lock.lockedModel ?? "—"} title={lock.lockedModel ?? "—"} /></Td><Td><Cell main={lock.reportedModel ?? "—"} title={lock.reportedModel ?? "—"} /></Td><Td><StatusTag tone={lock.held ? "warn" : "done"}>{state(lock)}</StatusTag></Td><Td sticky="end">{canRelease ? <Button size="sm" disabledReason={blocked ?? (!lock.releasable ? "当前安装没有可解除的机型锁" : undefined)} onClick={() => { setMessage(""); setTarget(lock); }}>解除机型锁</Button> : <Button size="sm" variant="ghost" onClick={() => setDetail(lock)}>查看详情</Button>}</Td></Tr>)}{!loading && !locks?.length && <TableMessage columns={5}>{error ? "机型锁记录尚未确认" : "这个用户还没有手机校准记录"}</TableMessage>}</tbody></Table>
    </div>
    {active && detail && <Drawer open onClose={() => setDetail(null)} title="手机机型锁详情" icon={LockKeyhole} footer={<Decision primary={canRelease && <Button disabledReason={blocked ?? (!detail.releasable ? "当前安装没有可解除的机型锁" : undefined)} onClick={() => setTarget(detail)}>解除机型锁</Button>} />}><Facts><Fact k="手机">{phonePlatformLabel(detail.platform)}</Fact><Fact k="安装编号">{detail.installationId}</Fact><Fact k="锁定机型">{detail.lockedModel ?? "—"}</Fact><Fact k="锁定芯片">{detail.lockedChip ?? "—"}</Fact><Fact k="最近上报机型">{detail.reportedModel ?? "—"}</Fact><Fact k="状态">{state(detail)}</Fact><Fact k="更新时间">{phoneTime(detail.updatedAt)}</Fact><Fact k="版本">{detail.revision}</Fact><Fact k="校准状态">{({ MATCHED: "已匹配", PENDING_VERIFICATION: "待核验" } as Record<string, string>)[detail.calibrationStatus ?? ""] ?? "未确认"}</Fact><Fact k="激活状态">{({ ACTIVE: "已激活", CALIBRATED: "已校准", PENDING: "待处理" } as Record<string, string>)[detail.activationStatus ?? ""] ?? "未确认"}</Fact></Facts></Drawer>}
    {active && target && <OperationConfirmModal briefKind="record" title="解除手机机型锁" action="解除手机机型锁" reasonMin={8} reasonMax={200} confirmLabel="确认解除机型锁" blockedReason={pending.length ? "原解除结果待核实，请先核对原操作" : undefined} detail="解除后，请用户在 App 里重新校准；下一次校准锁定新机型。" statedBrief={{ impact: "解除当前安装的机型锁，用户仍需重新校准", check: "提交时检查换机特批权限、当前安装与原版本" }} facts={<Facts><Fact k="用户">{userLabel}</Fact><Fact k="安装编号">{target.installationId}</Fact><Fact k="锁定机型">{target.lockedModel ?? "—"}</Fact><Fact k="锁定芯片">{target.lockedChip ?? "—"}</Fact><Fact k="最近上报">{target.reportedModel ?? "—"}</Fact><Fact k="原版本">{target.revision}</Fact></Facts>} onClose={() => setTarget(null)} onConfirm={async reason => {
      if (!canRelease || mutation.current || pending.length) return;
      mutation.current = true; setBusy(true); onBusyChange?.(true);
      try { await submitModelLockCommand(owner, userId, target, reason, { label: userLabel, userNo: userCode }); if (!live.current) return; setTarget(null); setDetail(null); setMessage("已解除机型锁。请告诉用户在 App 里重新校准。"); if (!await load()) setMessage("解除已返回，页面尚未刷新。请读回核对。"); }
      catch (failure) { if (live.current) { const next = pendingModelLockCommands(owner, userId); setPending(next); if (failure instanceof PhoneApiError && [401, 403].includes(failure.status)) { setDenied(true); setTarget(null); setDetail(null); setRelease(null); announcePermissionDenied(); } if (next.length) { setTarget(null); setError(failure instanceof PhoneApiError && [401, 403].includes(failure.status) ? failure.message : "提交结果待核实，原请求已保留。请按原操作重试或查原解除结果，不要另提解除。"); } else throw failure; } }
      finally { mutation.current = false; onBusyChange?.(false); if (live.current) { setBusy(false); setPending(pendingModelLockCommands(owner, userId)); onPendingChange?.(); } }
    }} />}
    {active && !denied && release && <ReleaseModal label={`解除手机机型锁 · ${release.installationId}`} explain={release.rejection} onCancel={() => setRelease(null)} onConfirm={() => {
      forgetModelLockCommand(release); setRelease(null); setPending(pendingModelLockCommands(owner, userId)); onPendingChange?.(); setError(""); setMessage("已解除本页待确认，后端原操作不受影响，请读回核对。"); void load();
    }} />}
  </Panel>;
}
