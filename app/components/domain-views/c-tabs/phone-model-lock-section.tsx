"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LockKeyhole, RefreshCw } from "lucide-react";
import { BlockState, Button, Cell, Change, Decision, Drawer, Fact, Facts, Fold, IconButton, Notice, Panel, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr } from "@/app/components/rd";
import { OperationConfirmModal } from "../design-kit";
import { useVerifiedRelease, VerifiedReleaseButton } from "../verified-release";
import { PhoneApiError, fetchPhoneModelLocks, submitModelLockCommand, modelLockCommandBlocks, modelLockCommandRecords, settleReturnedModelLockCommands, recoverModelLockCommand, retryModelLockCommand, forgetModelLockCommand, type PendingModelLockCommand, type PhoneModelLock } from "@/lib/admin/phone-replacement-client";
import { PHONE_GRANT, phonePlatformLabel } from "@/lib/admin/phone-replacement-contract";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { PhoneIdentifier, phoneTimeCompact as phoneTime } from "../phone-replacement-receipt";
import { announcePermissionDenied } from "@/lib/admin/operation-confirm-error";
import { ConfirmReadConflict } from "@/lib/admin/h-conflict-review";

function state(lock: PhoneModelLock) {
  return lock.released ? "已解除，待重新校准" : lock.held ? "换报机型或芯片被拦截" : lock.releasable ? "已锁定" : "未锁定";
}

function confirmationFacts(userLabel: string, lock: PhoneModelLock, conflictBaseline: PhoneModelLock | null) {
  const before = conflictBaseline?.installationId === lock.installationId ? conflictBaseline : null;
  const field = (key: "lockedModel" | "lockedChip" | "reportedModel" | "revision") => {
    const current = lock[key] ?? "—";
    const previous = before?.[key] ?? "—";
    return before && previous !== current ? <Change from={previous} to={current} settled /> : current;
  };
  const status = state(lock);
  return <Facts>
    <Fact k="用户">{userLabel}</Fact>
    <Fact k="安装编号">{lock.installationId}</Fact>
    <Fact k="锁定机型">{field("lockedModel")}</Fact>
    <Fact k="锁定芯片">{field("lockedChip")}</Fact>
    <Fact k="最近上报">{field("reportedModel")}</Fact>
    {before && state(before) !== status && <Fact k="状态"><Change from={state(before)} to={status} settled /></Fact>}
    <Fact k="原版本">{field("revision")}</Fact>
  </Facts>;
}

export function PhoneModelLockSection({ userId, userCode, userLabel, rights, active = true, onPendingChange, onBusyChange }: { active?: boolean; userId: string; userCode: string; userLabel: string; rights: string[]; onPendingChange?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const owner = useAdminAuth(value => value.session?.adminId ?? 0), canRelease = rights.includes(PHONE_GRANT);
  const [locks, setLocks] = useState<PhoneModelLock[] | null>(null), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [pendingAll, setPendingAll] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [targetId, setTarget] = useState<string | null>(null), [detailId, setDetail] = useState<string | null>(null);
  const [readError, setReadError] = useState("");
  const [confirmationRound, setConfirmationRound] = useState(0);
  const [conflictBaseline, setConflictBaseline] = useState<PhoneModelLock | null>(null);
  const [denied, setDenied] = useState(false);
  const [notFoundKey, setNotFoundKey] = useState<string | null>(null);
  const verifiedRelease = useVerifiedRelease((text, kind) => (kind === "warn" ? setError : setMessage)(text));
  const [records, setRecords] = useState(() => modelLockCommandRecords(owner, userId));
  const live = useRef(true), generation = useRef(0), mutation = useRef(false);
  const load = useCallback(async () => {
    const id = ++generation.current; setLoading(true); setReadError(""); setError(""); setLocks(null);
    try {
      const next = await fetchPhoneModelLocks(userId);
      if (!live.current || id !== generation.current) return null;
      setDenied(false); setLocks(next); settleReturnedModelLockCommands(owner, userId);
      setRecords(modelLockCommandRecords(owner, userId)); onPendingChange?.();
      return next;
    }
    catch (failure) { if (live.current && id === generation.current) { setReadError(failure instanceof Error ? failure.message : "查询暂不可用，请稍后重试。"); if (failure instanceof PhoneApiError && [401, 403].includes(failure.status)) { setDenied(true); setTarget(null); setDetail(null); announcePermissionDenied(); } } return null; }
    finally { if (live.current && id === generation.current) setLoading(false); }
  }, [userId, owner, onPendingChange]);
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; generation.current++; }; }, [load]);
  const currentLock = (installationId: string) => locks?.find(lock => lock.installationId === installationId);
  const detail = detailId ? currentLock(detailId) : undefined;
  const target = targetId ? currentLock(targetId) : undefined;
  const blocked = (installationId: string) => {
    if (busy) return "正在提交";
    if (loading) return "正在加载机型锁";
    if (!locks || denied) return "先重新读取机型锁";
    const lock = currentLock(installationId);
    if (!lock) return "最新记录中没有这台安装";
    if (records.some(row => modelLockCommandBlocks(row, installationId))) return "原解除结果待核实，请先核对原操作";
    if (!lock.releasable) return "当前安装没有可解除的机型锁";
  };
  const readFailure = readError && <BlockState state="error" title="机型锁加载失败" detail={readError} onRetry={() => void load()} compact />;
  const openConfirmation = (installationId: string) => {
    const lock = currentLock(installationId);
    if (!canRelease || !lock || blocked(installationId)) return;
    setMessage(""); setConflictBaseline(null); setTarget(installationId);
  };
  const releaseConflict = (submitted: PhoneModelLock) => new ConfirmReadConflict({
    preserveReason: true,
    renderNotice: readLatest => <Notice tone="warn" action={<Button size="sm" onClick={readLatest}>读取最新</Button>}>
      这台手机的机型锁记录刚被改过。读取最新后，请重新核对并填写理由。
    </Notice>,
    readLatest: async () => {
      if (!await load()) throw new Error("没有读到最新机型锁，请再试一次。");
      setConflictBaseline(submitted);
      setConfirmationRound(round => round + 1);
      return true;
    },
  });
  const askRelease = (row: PendingModelLockCommand) => verifiedRelease.ask({
    operation: "解除手机机型锁",
    target: row.installationId,
    createdAt: row.createdAt,
    getSnapshot: () => {
      if (!live.current || useAdminAuth.getState().session?.adminId !== owner) return;
      const saved = modelLockCommandRecords(owner, userId).find(original => original.commandKey === row.commandKey);
      return saved?.rejection ? JSON.stringify(saved) : undefined;
    },
    release: () => {
      forgetModelLockCommand(row);
      setRecords(modelLockCommandRecords(owner, userId));
      onPendingChange?.();
      setError("");
      void load();
    },
  });
  const recover = async (row: PendingModelLockCommand, retry: boolean) => {
    if (mutation.current || retry && (!canRelease || notFoundKey !== row.commandKey)) return;
    setNotFoundKey(key => key === row.commandKey ? null : key);
    mutation.current = true; setBusy(true); onBusyChange?.(true); setError(""); setMessage("");
    try {
      const result = retry ? await retryModelLockCommand(row).then(() => "succeeded" as const) : await recoverModelLockCommand(row);
      if (!live.current) return;
      setRecords(modelLockCommandRecords(owner, userId)); onPendingChange?.();
      if (result === "succeeded") { setMessage("原解除已成功，用户仍需在 App 重新校准。"); if (!await load()) setMessage("查到原结果：解除已成功，但现在的安装状态没读到，请刷新页面核对。"); }
      else if (result === "not-executed") { setMessage("原解除未执行，请刷新后核实当前状态。"); await load(); }
      else if (result === "not-found") {
        if (!row.rejection) setNotFoundKey(row.commandKey);
        setMessage("原操作查不到结果，原记录继续保留，没有重发。");
      } else setMessage("原解除结果未知，记录继续保留，请稍后再查。");
    } catch (failure) { if (live.current) {
      if (retry && modelLockCommandRecords(owner, userId).some(original => original.commandKey === row.commandKey && original.rejection)) await load();
      if (!live.current) return;
      setError(failure instanceof Error ? failure.message : "原解除结果未知，记录继续保留，请稍后再查。"); if (failure instanceof PhoneApiError && [401, 403].includes(failure.status)) { setDenied(true); setTarget(null); setDetail(null); announcePermissionDenied(); } } }
    finally { mutation.current = false; onBusyChange?.(false); if (live.current) { setBusy(false); setRecords(modelLockCommandRecords(owner, userId)); onPendingChange?.(); } }
  };
  return <Panel aria-label="手机机型锁" title="手机机型锁" icon={LockKeyhole} explain="每台手机首次校准后锁定机型。仅核实用户确实换机后解除；随后由用户在 App 重新校准锁定新机型。" actions={<IconButton aria-label="刷新手机机型锁" disabled={busy || loading || !!targetId} onClick={() => void load()}><RefreshCw size={16} /></IconButton>} flush>
    <div data-proof="c5-phone-model-lock">
      {!(active && (detailId || targetId)) && readFailure}
      {error && (locks ? <Notice tone="warn">{error}</Notice> : <BlockState state="error" title="机型锁未能读取或处置" detail={error} onRetry={() => void load()} retryLabel="刷新" />)}
      {message && <Notice tone="progress">{message}</Notice>}
      {(pendingAll ? records : records.slice(0, 3)).map(row => <Notice key={row.commandKey} tone="warn" title={row.rejection ? "机型锁解除重试被拒绝" : "机型锁解除结果未知"} action={<>{!row.rejection && <Button size="sm" disabled={loading || busy} onClick={async () => { if (await load()) setMessage("已读取现在的值。现在的状态说明不了原解除有没有执行，记录继续保留。"); }}>读取现在的值</Button>}{!denied && row.receiptSupported && <><Button size="sm" disabled={loading || busy} onClick={() => void recover(row, false)}>查询原操作</Button>{canRelease && !row.returned && !row.rejection && row.expiresAt > Date.now() && <Button size="sm" disabled={loading || busy || notFoundKey !== row.commandKey} onClick={() => void recover(row, true)}>按原操作重试</Button>}{row.rejection && <VerifiedReleaseButton disabled={loading || busy} onClick={() => askRelease(row)} />}</>}</>}>{!denied && <Fold title="查看原解除记录" summary={`${row.installationId} · ${phoneTime(row.createdAt)}`}><Facts><Fact k="原安装">{row.installationId}</Fact><Fact k="原机型">{row.lock.lockedModel ?? "—"}</Fact><Fact k="原芯片">{row.lock.lockedChip ?? "—"}</Fact><Fact k="原版本">{row.body.expectedRevision}</Fact><Fact k="原理由">{row.body.reason}</Fact><Fact k="操作编号">{row.commandKey}</Fact>{row.rejection && <Fact k="拒绝原因">{row.rejection}{row.rejectionCode && <> · <span data-mono>{row.rejectionCode}</span></>}</Fact>}<Fact k="恢复方式">{row.rejection ? "重试被拒绝，原请求已保留" : !row.receiptSupported ? "早期版本留下的记录，查不了原结果，只能读取现在的值核对，不能重试" : row.expiresAt <= Date.now() ? "已过 24 小时，保留记录，只查询原操作" : "按原操作重试或查原解除结果"}</Fact></Facts></Fold>}</Notice>)}
      {records.length > 3 && <Button size="sm" variant="ghost" aria-expanded={pendingAll} onClick={() => setPendingAll(value => !value)}>{pendingAll ? "只看前 3 条" : `展开全部 ${records.length} 条`}</Button>}
      <Table aria-label="手机机型锁" label="手机机型锁" className="c5-model-locks"><thead><tr><Th>手机</Th><Th>锁定机型</Th><Th>最近上报</Th><Th>状态</Th><Th sticky="end">操作</Th></tr></thead><tbody>{loading ? <TableLoading columns={5} /> : locks?.map(lock => <Tr key={lock.installationId} selected={detailId === lock.installationId} onOpen={() => setDetail(lock.installationId)}><Td><Cell main={phonePlatformLabel(lock.platform)} sub={<PhoneIdentifier value={lock.installationId} />} title={lock.installationId} /></Td><Td><Cell main={lock.lockedModel ?? "—"} title={lock.lockedModel ?? "—"} /></Td><Td><Cell main={lock.reportedModel ?? "—"} title={lock.reportedModel ?? "—"} /></Td><Td><StatusTag tone={lock.held ? "warn" : "done"}>{state(lock)}</StatusTag></Td><Td sticky="end">{canRelease ? <Button size="sm" disabledReason={blocked(lock.installationId)} onClick={() => openConfirmation(lock.installationId)}>解除机型锁</Button> : <Button size="sm" variant="ghost" onClick={() => setDetail(lock.installationId)}>查看详情</Button>}</Td></Tr>)}{!loading && locks?.length === 0 && <TableMessage columns={5}>这个用户还没有手机校准记录</TableMessage>}</tbody></Table>
    </div>
    {active && detailId && <Drawer open onClose={() => setDetail(null)} title="手机机型锁详情" icon={LockKeyhole} footer={<Decision primary={canRelease && <Button disabledReason={blocked(detailId)} onClick={() => openConfirmation(detailId)}>解除机型锁</Button>} />}>{!targetId && readFailure}{detail && <Facts><Fact k="手机">{phonePlatformLabel(detail.platform)}</Fact><Fact k="安装编号">{detail.installationId}</Fact><Fact k="锁定机型">{detail.lockedModel ?? "—"}</Fact><Fact k="锁定芯片">{detail.lockedChip ?? "—"}</Fact><Fact k="最近上报机型">{detail.reportedModel ?? "—"}</Fact><Fact k="状态">{state(detail)}</Fact><Fact k="更新时间">{phoneTime(detail.updatedAt)}</Fact><Fact k="版本">{detail.revision}</Fact><Fact k="校准状态">{({ MATCHED: "已匹配", PENDING_VERIFICATION: "待核验" } as Record<string, string>)[detail.calibrationStatus ?? ""] ?? "未确认"}</Fact><Fact k="激活状态">{({ ACTIVE: "已激活", CALIBRATED: "已校准", PENDING: "待处理" } as Record<string, string>)[detail.activationStatus ?? ""] ?? "未确认"}</Fact></Facts>}</Drawer>}
    {active && targetId && <OperationConfirmModal key={`${targetId}:${confirmationRound}`} briefKind="record" title="解除手机机型锁" action="解除手机机型锁" reasonMin={8} reasonMax={200} confirmLabel="确认解除机型锁" blockedReason={!canRelease ? "当前账号没有解除机型锁的权限" : readFailure || blocked(targetId)} detail="解除后，请用户在 App 里重新校准；下一次校准锁定新机型。" statedBrief={{ impact: "解除当前安装的机型锁，用户仍需重新校准", check: "提交时检查换机特批权限、当前安装与原版本" }} facts={target && confirmationFacts(userLabel, target, conflictBaseline)} onClose={() => setTarget(null)} onConfirm={async reason => {
      const lock = currentLock(targetId);
      if (!canRelease || mutation.current || !lock || blocked(lock.installationId)) return;
      mutation.current = true; setBusy(true); onBusyChange?.(true);
      try { await submitModelLockCommand(owner, userId, lock, reason, { label: userLabel, userNo: userCode }); if (!live.current) return; setTarget(null); setDetail(null); setMessage("已解除机型锁。请告诉用户在 App 里重新校准。"); if (!await load()) setMessage("解除已完成，但页面没能重新读取。请刷新后核对。"); }
      catch (failure) { if (live.current) { const next = modelLockCommandRecords(owner, userId); setRecords(next); if (failure instanceof PhoneApiError && [401, 403].includes(failure.status)) { setDenied(true); setTarget(null); setDetail(null); announcePermissionDenied(); } if (next.some(row => modelLockCommandBlocks(row, targetId))) { setTarget(null); setError(failure instanceof PhoneApiError && [401, 403].includes(failure.status) ? failure.message : "提交结果待核实，原请求已保留。请按原操作重试或查原解除结果，不要另提解除。"); } else if (failure instanceof PhoneApiError && failure.reasonCode === "PHONE_MODEL_LOCK_RELEASE_CONFLICT") throw releaseConflict(lock); else throw failure; } }
      finally { mutation.current = false; onBusyChange?.(false); if (live.current) { setBusy(false); setRecords(modelLockCommandRecords(owner, userId)); onPendingChange?.(); } }
    }} />}
    {active && !denied && verifiedRelease.dialog}
  </Panel>;
}
