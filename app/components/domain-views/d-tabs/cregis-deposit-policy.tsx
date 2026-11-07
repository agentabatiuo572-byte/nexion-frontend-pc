"use client";

import { useReach } from "@/lib/nav/use-reach";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Scale } from "lucide-react";
import { BlockState, Button, ConfigList, ConfigRow, DiffList, Notice, Panel, StatusTag } from "@/app/components/rd";
import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { financeAdminRequest } from "@/lib/admin/d-client";
import { displayAdminReadError } from "@/lib/admin/error-messages";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { depositPolicyUnits as units, validDepositPolicy as valid, parseDepositPolicy as parsePolicy, type DepositPolicy as Policy } from "@/lib/admin/cregis-deposit-policy";
import { businessStamp } from "@/lib/admin/business-time";
import { usdt, zoneLabel } from "./d1-shared";
import type { DCtx } from "./types";

type ProposalInput = Parameters<typeof createA2OperationProposal>[0];
type Pending = PendingMutationRecord & { owner: number; input: ProposalInput; ticketId?: string; terminal?: string };
const RETRY_WINDOW_MS = 10 * 60 * 1000;
const proposals = createPendingMutationStore<Pending>({ storageKey: "nexion-admin-cregis-deposit-policy-proposals-v1", retainExpiredRecords: true,
  isValidRecord: row => Number.isSafeInteger(row.owner) && !!row.input && !!row.input.command });
/** 共同充值规则的批准人（决定 13）。 */
const APPROVAL_TEXT = "超级管理员批准后生效，超管发起的由另一位超管批准。批准前当前规则不变。已发现的交易保留原规则。";

export type DepositProposalActivity = { unknown: number; awaitingApproval: number };

export function CregisDepositPolicy({ canManage, openActionConfirm, onActivityChange }: { canManage: boolean; openActionConfirm: DCtx["openActionConfirm"]; onActivityChange?: (activity: DepositProposalActivity) => void }) {
  const session = useAdminAuth(s => s.session), epoch = useAdminAuth(s => s.authEpoch);
  if (!session) return null;
  return <Editor key={`${session.adminId}:${epoch}`} owner={session.adminId} epoch={epoch} operator={session.operator || session.username}
    canManage={canManage} openActionConfirm={openActionConfirm} onActivityChange={onActivityChange} />;
}

function Editor({ owner, epoch, operator, canManage, openActionConfirm, onActivityChange }: { owner: number; epoch: number; operator: string; canManage: boolean; openActionConfirm: DCtx["openActionConfirm"]; onActivityChange?: (activity: DepositProposalActivity) => void }) {
  const reach = useReach();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [pending, setPending] = useState<Pending | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(""), [message, setMessage] = useState("");
  const live = useRef(true), sequence = useRef(0), mutation = useRef(false);
  const owns = useCallback(() => live.current && useAdminAuth.getState().isAuthenticated && useAdminAuth.getState().session?.adminId === owner && useAdminAuth.getState().authEpoch === epoch, [owner, epoch]);
  const syncPending = useCallback(() => setPending(proposals.list().find(row => row.owner === owner) ?? null), [owner]);
  const refresh = useCallback(async () => {
    const current = ++sequence.current; setLoading(true); setError(""); setPolicy(null);
    try {
      const next = parsePolicy(await financeAdminRequest<unknown>("/cregis/deposit-policy"));
      if (owns() && current === sequence.current) setPolicy(next);
    } catch (failure) { if (owns() && current === sequence.current) setError(displayAdminReadError(failure)); }
    finally { if (owns() && current === sequence.current) setLoading(false); }
  }, [owns]);
  useEffect(() => { live.current = true; syncPending(); void refresh(); return () => { live.current = false; sequence.current++; }; }, [refresh, syncPending]);
  const unknown = pending && !pending.terminal && !pending.ticketId ? 1 : 0;
  const awaitingApproval = pending && !pending.terminal && pending.ticketId ? 1 : 0;
  useEffect(() => { onActivityChange?.({ unknown, awaitingApproval }); }, [onActivityChange, unknown, awaitingApproval]);

  const submit = () => {
    if (!policy || pending || busy || !canManage || !owns()) return;
    const current = policy;
    const minText = String(Number(current.minDepositUsdt));
    openActionConfirm({ briefKind: "config", action: "提交 USDT BEP20 / ERC20 共同充值规则", title: "调整共同充值规则", confirmLabel: "提交审批",
      effect: <StatusTag tone="progress" filled>超级管理员批准后生效</StatusTag>,
      detail: `当前：最低 ${current.minDepositUsdt} USDT；手续费 ${current.feeUsdt} USDT；确认数 ${current.confirmations}；版本 ${current.version}。提交后需审批，批准前不生效。`,
      completionCopy: APPROVAL_TEXT,
      reasonMin: 10, reasonMax: 200,
      businessForm: { kind: "multi-field", requireAnyChange: true,
        feedback: (form) => {
          const min = form.min ?? "", fee = form.fee ?? "", confirmations = Number(form.confirmations);
          if (!/^[1-9]\d*$/.test(min) || !/^\d+$/.test(form.confirmations ?? "")) return { message: "", invalid: false };
          return valid(min, fee, confirmations) ? { message: "", invalid: false } : { field: "fee", message: "手续费要低于最低充值额，最多六位小数", invalid: true };
        },
        fields: [
          { key: "min", label: "最低充值额（USDT）", inputKind: "number", current: minText, min: 1, step: 1, showDiff: true, required: true,
            explain: "正整数。低于它的到账不自动入账。显示位置：App 充值页 › USDT 链上「最低充值」。" },
          { key: "fee", label: "固定手续费（USDT）", inputKind: "text", current: current.feeUsdt, pattern: "^(0|[1-9]\\d{0,11})(\\.\\d{1,6})?$", patternMessage: "填不小于 0 的数，最多六位小数", showDiff: true, required: true,
            explain: "每笔到账扣的手续费，要低于最低充值额。改成 1：每笔到账少入 1 USDT。显示位置：App 充值页 › USDT 链上「手续费」。" },
          { key: "confirmations", label: "链上确认数", inputKind: "number", current: String(current.confirmations), min: 15, max: 10000, step: 1, showDiff: true, required: true,
            explain: "到账前要等的区块确认数，15–10000 的整数；环境下限更高时按提示调高。调大：到账更慢。显示位置：App 充值页 › USDT 链上「确认数」。" },
        ] },
      run: async (reason, _value, form) => {
        const min = form?.min?.trim() ?? "", fee = form?.fee?.trim() ?? "", confirmations = form?.confirmations?.trim() ?? "";
        if (!/^[1-9]\d*$/.test(min) || !/^\d+$/.test(confirmations) || !valid(min, fee, Number(confirmations))) throw new Error("规则填得不对，请按字段下的提示改");
        if (units(min) === units(current.minDepositUsdt) && units(fee) === units(current.feeUsdt) && Number(confirmations) === current.confirmations) throw new Error("和现在的规则一样，没有改动");
        const auth = useAdminAuth.getState().session;
        if (!owns() || !auth || !(auth.role === "superadmin" || auth.role === "super" || auth.authorities.includes("finance_d1_channel_manage"))) throw new Error("登录身份或权限已变化，请重新打开页面。");
        if (mutation.current || proposals.list().some(row => row.owner === owner)) throw new Error("已有提案待核实，请先查询原提案。");
        const before = `最低 ${current.minDepositUsdt} USDT；手续费 ${current.feeUsdt} USDT；确认数 ${current.confirmations}；版本 ${current.version}`;
        const after = `最低 ${min} USDT；手续费 ${fee} USDT；确认数 ${confirmations}`;
        mutation.current = true; setBusy(true); setError(""); setMessage("");
        const input: ProposalInput = { action: "调整 USDT BEP20 / ERC20 共同充值规则", obj: "current", beforeValue: before, afterValue: after,
          operator, operatorRole: "运营人员", type: "param", amplifies: true, sos: false, roleGate: "另一位有审批权的管理员", reason, sourceDomain: "D1",
          command: { domain: "D", op: "d_cregis_deposit_policy", params: { minDepositUsdt: min, feeUsdt: fee, confirmations: Number(confirmations), expectedVersion: current.version, reason } },
          target: { domain: "D", type: "cregis_deposit_policy", id: "current" } };
        const key = createA2CommandKey("cregis-deposit-policy"), fingerprint = `${owner}|${key}`;
        proposals.remember(fingerprint, key, { owner, input });
        if (!proposals.isDurablyStored(fingerprint, key)) { proposals.forget(fingerprint, key); mutation.current = false; setBusy(false); throw new Error("浏览器无法保存恢复记录，请允许会话存储后重试。"); }
        syncPending();
        try {
          const ticket = await createA2OperationProposal(input, key, true);
          proposals.remember(fingerprint, key, { owner, input, ticketId: ticket.id });
          if (owns()) { syncPending(); setMessage("提案已提交，尚未生效。等超级管理员批准。"); }
        } catch (failure) {
          if (!isA2OutcomeUncertainError(failure)) proposals.forget(fingerprint, key);
          if (owns()) syncPending();
          if (isA2OutcomeUncertainError(failure)) { if (owns()) setError("提交结果待核实，请查询原提案，或使用原请求重试。"); return; }
          throw failure;
        } finally { mutation.current = false; if (owns()) setBusy(false); }
      } });
  };
  async function check() {
    if (!pending || mutation.current || !owns()) return;
    mutation.current = true; setBusy(true); setError("");
    try {
      const result = await fetchA2ProposalByKey(pending.commandKey);
      if (!owns()) return;
      if (!result) { setMessage("暂未查到原提案。可在首次提交后 10 分钟内使用原请求重试，或继续核实。"); return; }
      const status = result.status.toLowerCase();
      const terminal = ["approved", "rejected", "withdrawn", "expired"].includes(status) ? status : undefined;
      proposals.remember(pending.fingerprint, pending.commandKey, { owner, input: pending.input, ticketId: result.id, terminal });
      syncPending(); setMessage(terminal === "approved" ? "提案已批准，请重新读取生效规则并核对。" : terminal ? "提案已结束，请核对审批记录。" : "提案仍待处理，尚未确认生效。");
    } catch { if (owns()) setError("查询提案失败，请稍后重试或前往操作记录与审批。"); }
    finally { mutation.current = false; if (owns()) setBusy(false); }
  }
  async function retry() {
    const auth = useAdminAuth.getState().session;
    if (!pending || pending.ticketId || pending.terminal || mutation.current || !owns() || !canManage
      || !auth || !(auth.role === "superadmin" || auth.role === "super" || auth.authorities.includes("finance_d1_channel_manage"))) return;
    if (Date.now() < pending.createdAt || Date.now() >= Math.min(pending.expiresAt, pending.createdAt + RETRY_WINDOW_MS)) {
      setError("原请求已超过重试时间或本机时间异常，请通过操作记录继续核实。"); return;
    }
    mutation.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const ticket = await createA2OperationProposal(pending.input, pending.commandKey, true);
      if (owns()) {
        proposals.remember(pending.fingerprint, pending.commandKey, { owner, input: pending.input, ticketId: ticket.id });
        syncPending(); setMessage("原提案已提交，尚未生效。等超级管理员批准。");
      }
    } catch (failure) {
      if (owns()) {
        const rejection = failure as { status?: number; backendMessage?: string } | null;
        if ((rejection?.status === 409 && rejection.backendMessage === "CREGIS_DEPOSIT_POLICY_VERSION_CONFLICT")
          || (rejection?.status === 422 && rejection.backendMessage === "CREGIS_DEPOSIT_POLICY_INVALID")) {
          proposals.forget(pending.fingerprint, pending.commandKey);
          syncPending();
          await refresh();
          if (owns()) setMessage("原提案未创建，请核对最新规则后重新提交。");
        } else setError("原提案结果仍待核实，请查询原提案；恢复记录已保留。");
      }
    } finally { mutation.current = false; if (owns()) setBusy(false); }
  }
  const canRetry = !!pending && !pending.ticketId && !pending.terminal && Date.now() >= pending.createdAt && Date.now() < Math.min(pending.expiresAt, pending.createdAt + RETRY_WINDOW_MS);
  const entryBlock = loading ? "正在读取最新数据" : busy ? "正在提交" : !policy ? "规则没读到，刷新后再试" : pending && !pending.terminal ? "有一个提案还没结束，先在上面查询原提案" : pending ? "先点「核对完成，准备新变更」" : undefined;
  const audit = reach("/platform/audit", "platform_a2_read") && <Link className="rd-link" href="/platform/audit?domain=D">查看操作记录与审批</Link>;
  return <Panel icon={Scale} tone="role-4" title="USDT 共同充值规则" sub={policy ? `生效版本 v${policy.version}` : undefined}
    explain={<><p>BEP20 和 ERC20 共用这三项。三项一起提交审批。</p><p>{APPROVAL_TEXT}未入账交易仍须满足环境安全确认数下限。</p></>}
    actions={<>
      <Button size="sm" variant="ghost" icon={<RefreshCw size={14} aria-hidden />} loading={loading} disabled={busy} onClick={() => void refresh()}>刷新规则</Button>
      {canManage && <Button size="sm" disabledReason={entryBlock} onClick={submit}>调整</Button>}
    </>}>
    <div className="rd-stack">
      {pending && <Notice tone={pending.terminal ? "done" : pending.ticketId ? "progress" : "warn"}
        title={pending.terminal ? "原提案已结束" : pending.ticketId ? "提案待超级管理员批准" : "提案提交结果待核实"}
        action={<>
          <Button size="sm" disabled={busy} onClick={() => void check()}>查询原提案</Button>
          {!pending.ticketId && !pending.terminal && canManage && <Button size="sm" disabled={busy} disabledReason={canRetry ? undefined : "原请求已超过重试时间或本机时间异常，请通过操作记录继续核实。"} onClick={() => void retry()}>使用原请求重试</Button>}
          {pending.terminal && <Button size="sm" disabled={busy} onClick={() => { proposals.forget(pending.fingerprint, pending.commandKey); syncPending(); void refresh(); }}>核对完成，准备新变更</Button>}
        </>}>
        {businessStamp(pending.createdAt)}（{zoneLabel()}）提交。原提案：{pending.ticketId ?? "结果待核实"}。批准前当前规则不变。 {audit}
        <DiffList rows={[{ key: "change", label: "这次要改", before: pending.input.beforeValue ?? "—", after: pending.input.afterValue ?? "—" }]} />
      </Notice>}
      {error && <Notice tone="warn">{error}</Notice>}
      {message && <Notice tone="progress">{message}</Notice>}
      {loading && !policy ? <BlockState state="loading" title="正在读取充值规则…" />
        : !policy ? <BlockState state="error" title="充值规则读取失败" detail={error} onRetry={() => void refresh()} />
          : <ConfigList label="USDT 共同充值规则">
            <ConfigRow name="最低充值额" what="USDT 充值的最低金额" when="超级管理员批准后生效" where="App 充值页 › USDT 链上「最低充值」" effect="低于它的到账不自动入账"
              value={`${usdt(policy.minDepositUsdt)} USDT`} />
            <ConfigRow name="固定手续费" what="USDT 充值每笔扣的手续费" when="超级管理员批准后生效" where="App 充值页 › USDT 链上「手续费」" effect="改成 1：每笔到账少入 1 USDT"
              value={`${usdt(policy.feeUsdt)} USDT`} />
            <ConfigRow name="链上确认数" what="到账前要等的区块确认数" when="超级管理员批准后生效" where="App 充值页 › USDT 链上「确认数」" effect="调大：到账更慢"
              value={`${policy.confirmations} 次`} />
          </ConfigList>}
    </div>
  </Panel>;
}
