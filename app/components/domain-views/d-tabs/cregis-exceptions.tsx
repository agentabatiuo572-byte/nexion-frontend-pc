"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Coins, FileCheck2, HandCoins, Receipt, RotateCcw, Undo2 } from "lucide-react";
import {
  BlockState, Button, Cell, Change, ConfigList, ConfigRow, Decision, Drawer, Fact, Facts, Field, Fold, Input, IrreversibleTag, JudgmentPoints, KeyValues, Notice, Select, StatusTag, Steps,
  Table, Td, Textarea, Th, Tr,
} from "@/app/components/rd";
import type { KeyValueRow, StateTone } from "@/app/components/rd";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { adminAuthLifecycleEpoch, adminAuthActivityAllowed } from "@/lib/admin/auth-lifecycle";
import { d1PendingObjectReason, financeAdminRequest } from "@/lib/admin/d-client";
import { ADMIN_ERROR_MESSAGES, displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { exceptionChallengeId, exceptionCommand, exceptionFee, exceptionId, exceptionList, exceptionObject, exceptionRead, exceptionVersion,
  type ExceptionPage, type ExceptionRecord, type ExceptionRequestScope } from "@/lib/admin/cregis-exceptions";
import type { OperatorBriefKind } from "../design-kit";
import type { DCtx } from "./types";
import { usdt } from "./d1-shared";

const EMPTY: ExceptionPage = { records: [], hasMore: false, nextBeforeId: null };
const MODE: Record<string, string> = { UNCONFIGURED: "待配置（禁止退款）", PLATFORM_PAYS: "全额退回，平台承担网络费", FIXED_USDT: "扣除固定 USDT 费用" };
const ACTION: Record<string, string> = { REVERSE: "核实重组并冲正", RESTORE: "原入金恢复后还原账务", RELEASE_HOLD: "解除本事件误报冻结", COLLECT_DEBT: "追偿本事件欠款", UNFREEZE: "检查并解除本事件账户冻结" };
const STATE: Record<string, string> = { MAKER_DONE: "等待另一管理员复核", PROPOSED: "等待另一管理员复核", APPROVED: "已批准，等待发送", SUBMITTING: "发送请求处理中", UNKNOWN: "结果未知，保留原单核查", SENT: "已取得供应商订单，等待链确认", COMPLETED: "处置完成", RESOLVED: "处置完成", REJECTED: "已拒绝", CANCELLED: "已取消", FAILED_NO_TRANSFER: "确认未转出，可重新提案", REVERSED: "已冲正", DEBT_OPEN: "尚有欠款", OPEN: "等待处置", RELEASED: "本事件已释放", RESTORED: "原入金已恢复" };
Object.assign(STATE, { CREDITED: "认领已入账", INVESTIGATING: "调查中", REVERSED_DEBT: "已冲正，尚有欠款", REPROPOSED: "已生成新的复核提案", CANCELLED_LATE_EVIDENCE: "原单证据变化，已撤销此提案" });
const label = (value: unknown) => value == null || value === "" ? "—" : String(value);
const stateOf = (row: ExceptionRecord) => String(row.state ?? row.status);
const stateTone = (row: ExceptionRecord): StateTone => ["MAKER_DONE", "PROPOSED", "OPEN", "UNKNOWN", "DEBT_OPEN", "FAILED_NO_TRANSFER", "INVESTIGATING", "REVERSED_DEBT"].includes(stateOf(row)) ? "warn"
  : ["COMPLETED", "RESOLVED", "CREDITED", "REVERSED", "RELEASED", "RESTORED"].includes(stateOf(row)) ? "ok" : ["REJECTED", "CANCELLED", "CANCELLED_LATE_EVIDENCE"].includes(stateOf(row)) ? "done" : "progress";
const waitsReview = (row: ExceptionRecord) => ["MAKER_DONE", "PROPOSED"].includes(stateOf(row));
const isMaker = (row: ExceptionRecord, adminId: unknown) => String(row.makerId) === String(adminId);

/** 认领或退款的来源：低额入金（EVENT）、未归属链上入金（OBSERVATION）。 */
export type ClaimSource = { sourceType: string; sourceId: string; title: string; network: "BEP20" | "ERC20" | null; dust: boolean };
type CaseKind = "claim" | "refund" | "incident" | "reorg";
const CASE_TITLE: Record<CaseKind, string> = { claim: "认领工单", refund: "退款工单", incident: "重组事件", reorg: "重组处置提案" };

function caseRows(row: ExceptionRecord): KeyValueRow[] {
  const facts: Array<[string, string, unknown, boolean?]> = [
    ["user", "用户", row.userId ?? row.targetUserId ?? row.claimantUserId],
    ["gross", "毛额（USDT）", row.grossAmount], ["fee", "费用（USDT）", row.feeAmount], ["net", "净额（USDT）", row.netAmount],
    ["return", "原转出地址", row.returnAddress, true], ["cid", "Cregis 订单编号", row.providerCid, true],
    ["debt", "待追偿（USDT）", row.outstandingDebt], ["evidence", "证据摘要", row.evidenceHash, true], ["reason", "理由", row.reason], ["error", "待核查原因", row.lastError],
  ];
  return facts.filter(([, , value], index) => index < 4 || value != null && value !== "").map(([key, name, value, mono]) => ({ key, label: name,
    value: key === "error" ? ADMIN_ERROR_MESSAGES[String(value)] ?? `原因待核对（${label(value)}）` : label(value), mono: mono && value != null }));
}

type OperationsProps = {
  canManage: boolean; openActionConfirm: DCtx["openActionConfirm"]; sources: ClaimSource[];
  claim: ClaimSource | null; onClaimClose: () => void; onChanged: () => void;
};
export function CregisExceptionOperations(props: OperationsProps) {
  const session = useAdminAuth(state => state.session), epoch = useAdminAuth(state => state.authEpoch);
  if (!session?.authorities.includes("finance_d1_read")) return null;
  return <OwnedExceptionOperations key={`${session.adminId}:${epoch}:${adminAuthLifecycleEpoch()}:${props.canManage}:${session.authorities.join("|")}`}
    {...props} owner={session.adminId} ownerEpoch={epoch} />;
}
function OwnedExceptionOperations({ canManage, openActionConfirm, sources, claim, onClaimClose, onChanged, owner, ownerEpoch }: OperationsProps & { owner: number; ownerEpoch: number }) {
  const session = useAdminAuth(state => state.session);
  const canRefund = canManage && (session?.authorities ?? []).includes("finance_d2_withdrawal_approve");
  const lifecycleEpoch = useRef(adminAuthLifecycleEpoch()).current;
  const live = useRef(true);
  const assertOwner = useCallback((write = false, refund = false) => {
    const current = useAdminAuth.getState();
    const rights = current.session?.authorities ?? [];
    if (!live.current || !current.isAuthenticated || current.session?.adminId !== owner || current.authEpoch !== ownerEpoch
        || adminAuthLifecycleEpoch() !== lifecycleEpoch || !adminAuthActivityAllowed()
        || !rights.includes("finance_d1_read") || write && (!canManage || !rights.includes("finance_d1_channel_manage"))
        || refund && !rights.includes("finance_d2_withdrawal_approve"))
      throw new Error("登录身份或权限已变化，请重新打开异常处置后核对");
  }, [owner, ownerEpoch, lifecycleEpoch, canManage]);
  const owns = useCallback(() => { try { assertOwner(); return true; } catch { return false; } }, [assertOwner]);
  const scopeFor = useCallback((write = false, refund = false): ExceptionRequestScope => ({
    authEpoch: lifecycleEpoch, assertOwner: () => assertOwner(write, refund),
  }), [assertOwner, lifecycleEpoch]);
  const [policy, setPolicy] = useState<ExceptionRecord | null>(null);
  const [policyCases, setPolicyCases] = useState<ExceptionRecord[]>([]);
  const [refunds, setRefunds] = useState(EMPTY);
  const [claims, setClaims] = useState(EMPTY);
  const [incidents, setIncidents] = useState(EMPTY);
  const [reorgCases, setReorgCases] = useState(EMPTY);
  /** 六个读取各管各的：哪个失败只影响依赖它的部分，别的照常显示（D1-C95、S07）。 */
  const [errors, setErrors] = useState<Partial<Record<"fee" | "feeCases" | CaseKind, string>>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<{ kind: CaseKind; id: string } | null>(null);
  const refreshEpoch = useRef(0);
  const mutationLock = useRef(false);

  const refresh = useCallback(async () => {
    const scope = scopeFor(); scope.assertOwner();
    const epoch = ++refreshEpoch.current;
    setLoading(true); setError("");
    const [p, pc, rf, cl, ri, rc] = await Promise.allSettled([
      exceptionRead("/refunds/fee-policy", scope).then(value => {
        if (!(String(value.mode) in MODE)) throw new Error("退款费用规则响应无效");
        exceptionVersion(value.version); return value;
      }),
      financeAdminRequest<unknown>("/cregis/refunds/fee-policy/cases", { bankManualAuthEpoch: scope.authEpoch }).then(value => {
        if (!Array.isArray(value)) throw new Error("退款费用规则提案响应无效");
        return value.map(exceptionObject);
      }),
      exceptionList("/refunds/cases", undefined, scope), exceptionList("/exception-claims", undefined, scope),
      exceptionList("/reorg/incidents", undefined, scope), exceptionList("/reorg/proposals", undefined, scope),
    ]);
    if (epoch !== refreshEpoch.current || !owns() || adminAuthLifecycleEpoch() !== lifecycleEpoch) return;
    const failed = (result: PromiseSettledResult<unknown>) => result.status === "rejected" ? displayAdminReadError(result.reason) : undefined;
    setPolicy(p.status === "fulfilled" ? p.value : null);
    setPolicyCases(pc.status === "fulfilled" ? pc.value : []);
    setRefunds(rf.status === "fulfilled" ? rf.value : EMPTY);
    setClaims(cl.status === "fulfilled" ? cl.value : EMPTY);
    setIncidents(ri.status === "fulfilled" ? ri.value : EMPTY);
    setReorgCases(rc.status === "fulfilled" ? rc.value : EMPTY);
    setErrors({ fee: failed(p), feeCases: failed(pc), refund: failed(rf), claim: failed(cl), incident: failed(ri), reorg: failed(rc) });
    setLoading(false);
  }, [scopeFor, lifecycleEpoch, owns]);
  useEffect(() => { live.current = true; void refresh(); return () => { live.current = false; refreshEpoch.current++; }; }, [refresh]);

  const mutate = async (path: string, body: ExceptionRecord) => {
    const scope = scopeFor(true, path.startsWith("/refunds")); scope.assertOwner();
    if (mutationLock.current) throw new Error("上一项操作仍在处理，请先核对结果");
    mutationLock.current = true; setBusy(true);
    try {
      await exceptionCommand(path, body, scope); scope.assertOwner();
    } finally {
      mutationLock.current = false;
      if (owns()) { setBusy(false); onChanged(); await refresh(); }
    }
  };
  const readBlock = loading ? "正在读取最新数据" : busy ? "正在提交" : undefined;
  const approval = <StatusTag tone="progress" filled>另一位管理员复核后生效</StatusTag>;
  const confirm = (spec: { kind: OperatorBriefKind; action: string; title: string; path: string; body: ExceptionRecord; detail: string; confirmLabel: string; danger?: boolean; review?: boolean; facts?: React.ReactNode; completion?: string }) => {
    const held = d1PendingObjectReason(`/cregis${spec.path}`, spec.body);
    if (held) { setError(held); return; }
    openActionConfirm({ briefKind: spec.kind,
    action: spec.action, title: spec.title, detail: spec.detail, reasonMin: 10, reasonMax: 200, confirmLabel: spec.confirmLabel, confirmTone: spec.danger ? "danger" : "primary",
    effect: spec.review ? <><StatusTag tone="progress" filled>立即生效</StatusTag>{spec.danger && spec.kind === "funds" && spec.confirmLabel === "确认复核" && <IrreversibleTag />}</> : approval, facts: spec.facts,
    completionCopy: spec.completion ?? (spec.review ? "复核通过后系统会再次独立核验，再执行。" : "提交后需另一位管理员复核才执行。"),
    run: reason => mutate(spec.path, { ...spec.body, reason }),
  }); };
  const pageMore = async (path: string, page: ExceptionPage, setter: (page: ExceptionPage) => void) => {
    const scope = scopeFor(); scope.assertOwner();
    setBusy(true);
    try { const next = await exceptionList(path, page.nextBeforeId ?? undefined, scope); scope.assertOwner(); setter({ ...next, records: [...page.records, ...next.records] }); }
    catch (failure) { if (owns()) setError(displayAdminReadError(failure)); }
    finally { if (owns()) setBusy(false); }
  };
  const configureFee = () => openActionConfirm({ briefKind: "config", action: "提议异常退款费用规则", title: "配置退款手续费", confirmLabel: "提交审批", effect: approval,
    completionCopy: "提案提交后，须由另一管理员复核才生效", detail: "另一管理员复核后仅对新工单生效，已有工单保留原毛额、费用与净额快照。",
    reasonMin: 10, reasonMax: 200, businessForm: { kind: "multi-field", requireAnyChange: true, fields: [
      { key: "mode", label: "退款费用方式", inputKind: "select", current: String(policy?.mode ?? "UNCONFIGURED"), options: Object.keys(MODE), optionLabels: MODE, required: true, showDiff: true, help: `现在：${MODE[String(policy?.mode ?? "UNCONFIGURED")]}` },
      { key: "fee", label: "固定扣费（USDT）", current: policy?.mode === "FIXED_USDT" ? String(policy.feeUsdt ?? "0") : "0", inputKind: "text", help: policy?.mode === "FIXED_USDT" ? `现在 ${String(policy.feeUsdt ?? "0")} USDT` : "现在不扣固定费", visibleWhen: { key: "mode", equals: "FIXED_USDT" }, pattern: "^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,6})?$", patternMessage: "填不小于 0 的数，最多六位小数", required: true },
    ] }, run: (reason, _value, form) => mutate("/refunds/fee-policy/cases", { expectedVersion: exceptionVersion(policy?.version),
      mode: form?.mode, feeUsdt: exceptionFee(form?.mode ?? "", form?.fee ?? ""), reason }),
  });
  const recover = (row: ExceptionRecord) => openActionConfirm({ briefKind: "record", action: "核对并恢复原退款单 CID", title: "核对原单 CID", confirmLabel: "确认核对", effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
    completionCopy: "只核对原退款单，不重新发送退款", detail: "只核对原业务号、返款地址及净额，不重新发送退款。",
    facts: <Facts><Fact k="退款工单">#{label(row.id)}</Fact><Fact k="原转出地址">{label(row.returnAddress)}</Fact><Fact k="净额">{label(row.netAmount)} USDT</Fact></Facts>,
    reasonMin: 10, reasonMax: 200, businessForm: { kind: "multi-field", fields: [{ key: "cid", label: "供应商原单 CID", inputKind: "text", required: true, pattern: "^[1-9][0-9]{0,18}$", patternMessage: "CID 只能是数字", maxLength: 19 }] },
    run: (reason, _v, form) => mutate(`/refunds/cases/${exceptionId(row.id)}/recover`, { expectedVersion: exceptionVersion(row.version), providerCid: exceptionId(form?.cid), reason }),
  });
  const proposeReorg = async (row: ExceptionRecord, action: string) => {
    const scope = scopeFor(true); scope.assertOwner();
    setBusy(true); setError("");
    try {
      const proof = await exceptionRead(`/reorg/incidents/${exceptionId(row.id)}/evidence?action=${action}`, scope); scope.assertOwner();
      confirm({ kind: action === "UNFREEZE" ? "security" : "funds", action: ACTION[action], title: ACTION[action], confirmLabel: "提交审批", path: `/reorg/incidents/${exceptionId(row.id)}/proposals`,
        body: { action, expectedVersion: exceptionVersion(row.version), evidenceHash: proof.evidenceHash },
        facts: <Facts><Fact k="原净入账" lead tone="role-1" unit="USDT">{label(row.netAmount)}</Fact><Fact k="用户">{label(row.userId)}</Fact><Fact k="待追偿">{label(row.outstandingDebt)} USDT</Fact><Fact k="证据">{label(proof.evidenceHash)}</Fact></Facts>,
        detail: `用户 ${label(row.userId)}，原净入账 ${label(row.netAmount)} USDT，待追偿 ${label(row.outstandingDebt)} USDT。证据 ${label(proof.evidenceHash)}。只处置本事件，不自动重开资金开关。` });
    } catch (failure) { if (owns()) setError(displayAdminError(failure)); }
    finally { if (owns()) setBusy(false); }
  };

  const pages: Record<CaseKind, [string, ExceptionPage, (page: ExceptionPage) => void]> = {
    claim: ["/exception-claims", claims, setClaims], refund: ["/refunds/cases", refunds, setRefunds],
    incident: ["/reorg/incidents", incidents, setIncidents], reorg: ["/reorg/proposals", reorgCases, setReorgCases],
  };
  /** 每类工单在抽屉底部能做什么；发起人看不到复核按钮（D1-A46～A50）。 */
  const caseActions = (kind: CaseKind, row: ExceptionRecord) => {
    const own = isMaker(row, session?.adminId);
    const net = <Fact k="净额" lead tone="role-1" unit="USDT">{label(row.netAmount)}</Fact>;
    const actions: { key: string; label: string; danger?: boolean; primary?: boolean; run: () => void }[] = [];
    if (kind === "claim" && canManage && waitsReview(row) && !own) {
      const facts = <Facts>{net}<Fact k="目标用户">{label(row.userId ?? row.targetUserId ?? row.claimantUserId)}</Fact><Fact k="证据">{label(row.evidenceHash)}</Fact></Facts>;
      actions.push({ key: "approve", label: "复核认领", primary: true, run: () => confirm({ kind: "funds", review: true, danger: true, action: "复核认领入账", title: "复核认领入账", confirmLabel: "确认复核", path: `/exception-claims/${exceptionId(row.id)}/decision`, body: { expectedVersion: exceptionVersion(row.version), decision: "APPROVE" }, facts,
        detail: `目标用户 ${label(row.userId ?? row.targetUserId ?? row.claimantUserId)}，净额 ${label(row.netAmount)} USDT，证据 ${label(row.evidenceHash)}。系统将再次独立核验原资金及钱包归属。`, completion: "确认后系统再次核验归属，通过后净额入账到目标用户钱包，不能撤销。" }) });
      actions.push({ key: "reject", label: "拒绝", danger: true, run: () => confirm({ kind: "record", review: true, action: "拒绝认领", title: "拒绝认领", confirmLabel: "确认拒绝", path: `/exception-claims/${exceptionId(row.id)}/decision`, body: { expectedVersion: exceptionVersion(row.version), decision: "REJECT" }, facts,
        detail: `目标用户 ${label(row.userId ?? row.targetUserId ?? row.claimantUserId)}，净额 ${label(row.netAmount)} USDT。`, completion: "拒绝后这笔入金留在异常里，不入账。" }) });
    }
    if (kind === "refund" && canRefund) {
      const facts = <Facts>{net}<Fact k="原转出地址">{label(row.returnAddress)}</Fact><Fact k="毛额">{label(row.grossAmount)} USDT</Fact><Fact k="费用">{label(row.feeAmount)} USDT</Fact><Fact k="证据">{label(row.evidenceHash)}</Fact></Facts>;
      if (waitsReview(row) && !own) {
        actions.push({ key: "approve", label: "复核退款", primary: true, run: () => confirm({ kind: "funds", review: true, danger: true, action: "复核链上原路退款", title: "复核原路退款", confirmLabel: "确认复核", path: `/refunds/cases/${exceptionId(row.id)}/decision`, body: { expectedVersion: exceptionVersion(row.version), decision: "APPROVE" }, facts,
          detail: `原地址 ${label(row.returnAddress)}，毛额 ${label(row.grossAmount)}，费用 ${label(row.feeAmount)}，实退 ${label(row.netAmount)} USDT。证据 ${label(row.evidenceHash)}。`, completion: "确认后按净额原路退回到原转出地址，钱转出后不能撤销。" }) });
        actions.push({ key: "reject", label: "拒绝", danger: true, run: () => confirm({ kind: "funds", review: true, danger: true, action: "拒绝退款", title: "拒绝退款", confirmLabel: "确认拒绝", path: `/refunds/cases/${exceptionId(row.id)}/decision`, body: { expectedVersion: exceptionVersion(row.version), decision: "REJECT" }, facts,
          detail: `原地址 ${label(row.returnAddress)}，实退 ${label(row.netAmount)} USDT。`, completion: "拒绝后不退款，这笔入金留在异常里。" }) });
      }
      if (stateOf(row) === "MAKER_DONE" && own) actions.push({ key: "cancel", label: "取消提案", danger: true, run: () => confirm({ kind: "funds", review: true, danger: true, action: "取消退款提案", title: "取消退款提案", confirmLabel: "确认取消", path: `/refunds/cases/${exceptionId(row.id)}/decision`, body: { expectedVersion: exceptionVersion(row.version), decision: "CANCEL" }, facts,
        detail: "取消尚未批准的原退款提案并释放其资金占用。", completion: "取消尚未批准的原退款提案并释放其资金占用。" }) });
      if (stateOf(row) === "UNKNOWN" && !row.providerCid) actions.push({ key: "recover", label: "核对原单 CID", primary: true, run: () => recover(row) });
      if (stateOf(row) === "FAILED_NO_TRANSFER") actions.push({ key: "retry", label: "重新提案", primary: true, run: () => confirm({ kind: "funds", action: "重新提交退款审核", title: "重新提交退款审核", confirmLabel: "提交审批", path: `/refunds/cases/${exceptionId(row.id)}/retry`, body: { expectedVersion: exceptionVersion(row.version) }, facts,
        detail: "仅在原单已确认未转出后申请新工单，仍须另一管理员重新复核。" }) });
    }
    if (kind === "incident" && canManage && Array.isArray(row.allowedActions)) {
      row.allowedActions.filter(action => typeof action === "string" && action in ACTION).forEach((action, index) =>
        actions.push({ key: String(action), label: ACTION[String(action)], primary: index === 0, run: () => void proposeReorg(row, String(action)) }));
    }
    if (kind === "reorg" && canManage && waitsReview(row) && !own) {
      const facts = <Facts><Fact k="事件">{label(row.incidentId)}</Fact><Fact k="处置">{ACTION[String(row.action)] ?? label(row.action)}</Fact><Fact k="证据">{label(row.evidenceHash)}</Fact></Facts>;
      actions.push({ key: "approve", label: "复核处置", primary: true, run: () => confirm({ kind: row.action === "UNFREEZE" ? "security" : "funds", review: true, danger: true, action: `复核：${ACTION[String(row.action)] ?? "重组处置"}`, title: "复核重组处置", confirmLabel: "确认复核", path: `/reorg/proposals/${exceptionId(row.id)}/decision`, body: { expectedVersion: exceptionVersion(row.version), decision: "APPROVE" }, facts,
        detail: `事件 ${label(row.incidentId)}，${ACTION[String(row.action)] ?? label(row.action)}，证据 ${label(row.evidenceHash)}。只处置本事件，其他冻结和资金开关保持原规则。` }) });
      actions.push({ key: "reject", label: "拒绝", danger: true, run: () => confirm({ kind: "record", review: true, action: "拒绝重组处置", title: "拒绝重组处置", confirmLabel: "确认拒绝", path: `/reorg/proposals/${exceptionId(row.id)}/decision`, body: { expectedVersion: exceptionVersion(row.version), decision: "REJECT" }, facts,
        detail: `事件 ${label(row.incidentId)}，${ACTION[String(row.action)] ?? label(row.action)}。`, completion: "拒绝后这次处置不执行，事件保持原样。" }) });
    }
    const note = waitsReview(row) && own ? "你发起的，等另一位管理员复核" : actions.length === 0 ? (canManage ? "这一条现在没有要你做的事" : "没有修改权限，只能查看") : undefined;
    return { actions, note };
  };
  const caseFold = (kind: CaseKind, icon: typeof Coins) => {
    const [path, page, setter] = pages[kind];
    const waiting = page.records.filter(row => waitsReview(row) || ["OPEN", "UNKNOWN", "FAILED_NO_TRANSFER", "DEBT_OPEN"].includes(stateOf(row))).length;
    const failure = errors[kind];
    return <Fold key={kind} title={CASE_TITLE[kind]} icon={icon} tone="role-2" alert={waiting > 0 || !!failure} alertTone={failure ? "danger" : undefined} summary={failure ? "读取失败" : page.records.length === 0 ? "暂无记录" : waiting ? `${waiting} 条等处理，共 ${page.records.length} 条` : `共 ${page.records.length} 条，都已处理`}>
      {failure ? <BlockState state="error" compact title={`${CASE_TITLE[kind]}读取失败`} detail={failure} onRetry={() => void refresh()} />
        : page.records.length === 0 ? <p className="rd-note">暂无记录</p> : <Table label={CASE_TITLE[kind]}>
        <thead><tr><Th>编号</Th><Th>用户</Th><Th align="right">净额（USDT）</Th><Th>状态</Th><Th sticky="end" align="right">操作</Th></tr></thead>
        <tbody>{page.records.map(row => <Tr key={String(row.id)} selected={opened?.kind === kind && opened.id === String(row.id)} onOpen={() => setOpened({ kind, id: String(row.id) })}>
          <Td><Cell mono main={`#${label(row.id)}`} sub={kind === "incident" || kind === "reorg" ? (ACTION[String(row.action)] ?? undefined) : undefined} /></Td>
          <Td><Cell main={label(row.userId ?? row.targetUserId ?? row.claimantUserId)} /></Td>
          <Td align="right"><Cell num main={row.netAmount == null ? "—" : usdt(String(row.netAmount))} /></Td>
          <Td><Cell main={<StatusTag tone={stateTone(row)}>{STATE[stateOf(row)] ?? "状态未知"}</StatusTag>} sub={waitsReview(row) && isMaker(row, session?.adminId) ? "你发起的" : undefined} /></Td>
          <Td sticky="end" align="right"><Button size="sm" variant="ghost" onClick={() => setOpened({ kind, id: String(row.id) })}>打开</Button></Td>
        </Tr>)}</tbody>
      </Table>}
      {page.hasMore && <Button size="sm" disabled={busy || loading} onClick={() => void pageMore(path, page, setter)}>加载更早{CASE_TITLE[kind]}</Button>}
    </Fold>;
  };
  const openedRows = opened ? pages[opened.kind][1].records : [];
  const openedIndex = opened ? openedRows.findIndex(row => String(row.id) === opened.id) : -1;
  const openedRow = openedIndex >= 0 ? openedRows[openedIndex] : null;
  const openedActions = opened && openedRow ? caseActions(opened.kind, openedRow) : null;
  const policyWaiting = policyCases.filter(waitsReview);

  const firstLoad = loading && Object.keys(errors).length === 0 && !policy;
  return <>
    {error && <Notice tone="warn">{error}</Notice>}
    {firstLoad ? <BlockState state="loading" title="正在核对费用规则与处置工单…" /> : <>
      {caseFold("claim", HandCoins)}
      {caseFold("refund", Undo2)}
      {caseFold("incident", RotateCcw)}
      {caseFold("reorg", FileCheck2)}
      {!policy ? <Fold title="退款手续费" icon={Receipt} tone="role-4" alert alertTone="danger" summary="读取失败" defaultOpen
        explain="异常入金原路退款时扣多少费用。读不到时原路退款先不能提交，认领照常。">
        <BlockState state="error" compact title="退款手续费读取失败" detail={errors.fee} onRetry={() => void refresh()} />
      </Fold> : <Fold title="退款手续费" icon={Receipt} tone="role-4" alert={policy.mode === "UNCONFIGURED" || policyWaiting.length > 0 || !!errors.feeCases} defaultOpen={policyWaiting.length > 0}
        summary={`${MODE[String(policy.mode)]}${policy.mode === "FIXED_USDT" ? ` ${label(policy.feeUsdt)} USDT` : ""}${policyWaiting.length ? `，${policyWaiting.length} 个提案待复核` : ""}`}
        explain="异常入金原路退款时扣多少费用。另一位管理员复核后生效，只对新工单；待配置时不能退款。">
        <div className="rd-stack">
          {errors.feeCases && <BlockState state="error" compact title="费用规则提案读取失败" detail={errors.feeCases} onRetry={() => void refresh()} />}
          <ConfigList label="退款手续费">
            <ConfigRow name="退款手续费" what="异常退款时扣多少费用" when="另一位管理员复核后生效，只对新工单" effect="待配置时不能退款"
              value={`${MODE[String(policy.mode)]}${policy.mode === "FIXED_USDT" ? ` ${label(policy.feeUsdt)} USDT` : ""}`} sub={`版本 ${label(policy.version)}`}
              action={canRefund ? <Button size="sm" disabledReason={readBlock} onClick={configureFee}>配置退款手续费</Button> : undefined} />
          </ConfigList>
          {policyCases.length > 0 && <Table label="费用规则提案">
            <thead><tr><Th>提案</Th><Th>改成</Th><Th>状态</Th><Th sticky="end" align="right">操作</Th></tr></thead>
            <tbody>{policyCases.map(row => {
              const own = isMaker(row, session?.adminId);
              const facts = <Facts>
                <Fact k="费用方式"><Change from={MODE[String(policy.mode)]} to={MODE[String(row.mode)]} /></Fact>
                <Fact k="固定费"><Change from={`${policy.mode === "FIXED_USDT" ? label(policy.feeUsdt) : "0"} USDT`} to={`${label(row.feeUsdt)} USDT`} /></Fact>
                <Fact k="发起人">{label(row.makerId)}</Fact></Facts>;
              return <tr key={label(row.id)}>
                <Td><Cell mono main={`#${label(row.id)}`} sub={`发起人 ${label(row.makerId)}${own ? "（你）" : ""}`} /></Td>
                <Td><Cell main={MODE[String(row.mode)]} sub={`固定费 ${label(row.feeUsdt)} USDT`} /></Td>
                <Td><Cell main={<StatusTag tone={stateTone(row)}>{STATE[stateOf(row)] ?? "状态未知"}</StatusTag>} /></Td>
                <Td sticky="end" align="right">{canRefund && waitsReview(row) && (own ? <span className="rd-note">等另一位管理员复核</span> : <span className="rd-row-actions">
                  <Button size="sm" disabledReason={readBlock} onClick={() => confirm({ kind: "config", review: true, action: "复核费用规则", title: "复核退款费用规则", confirmLabel: "确认复核", path: `/refunds/fee-policy/cases/${exceptionId(row.id)}/decision`, body: { expectedVersion: exceptionVersion(row.version), decision: "APPROVE" }, facts, detail: `请独立核对费用规则 ${MODE[String(row.mode)]}、固定费用 ${label(row.feeUsdt)} USDT。`, completion: "复核通过后立即生效，只对新工单。" })}>复核费用规则</Button>
                  <Button size="sm" variant="ghost" disabledReason={readBlock} onClick={() => confirm({ kind: "config", review: true, action: "拒绝费用规则", title: "拒绝退款费用规则", confirmLabel: "确认拒绝", path: `/refunds/fee-policy/cases/${exceptionId(row.id)}/decision`, body: { expectedVersion: exceptionVersion(row.version), decision: "REJECT" }, facts, detail: `费用规则 ${MODE[String(row.mode)]}、固定费用 ${label(row.feeUsdt)} USDT。`, completion: "拒绝后现行费用规则不变。" })}>拒绝</Button>
                </span>)}</Td>
              </tr>;
            })}</tbody>
          </Table>}
        </div>
      </Fold>}
    </>}

    <Drawer open={!!openedRow} onClose={() => setOpened(null)} title={opened ? CASE_TITLE[opened.kind] : ""} sub={openedRow ? `#${label(openedRow.id)}` : undefined} icon={FileCheck2} tone="role-2" busy={busy}
      nav={{ hasPrev: openedIndex > 0, hasNext: openedIndex >= 0 && openedIndex < openedRows.length - 1, onPrev: () => opened && setOpened({ kind: opened.kind, id: String(openedRows[openedIndex - 1]?.id ?? opened.id) }), onNext: () => opened && setOpened({ kind: opened.kind, id: String(openedRows[openedIndex + 1]?.id ?? opened.id) }) }}
      footer={openedActions && <Decision note={openedActions.note}
        danger={openedActions.actions.filter(item => item.danger).map(item => <Button key={item.key} variant="danger-outline" disabledReason={readBlock} onClick={item.run}>{item.label}</Button>)}
        others={openedActions.actions.filter(item => !item.danger && !item.primary).map(item => <Button key={item.key} variant="ghost" disabledReason={readBlock} onClick={item.run}>{item.label}</Button>)}
        primary={openedActions.actions.filter(item => item.primary).map(item => <Button key={item.key} variant="primary" disabledReason={readBlock} onClick={item.run}>{item.label}</Button>)} />}>
      {openedRow && <>
        <JudgmentPoints rows={[
          { label: "状态", state: stateTone(openedRow) === "progress" ? undefined : stateTone(openedRow), value: STATE[stateOf(openedRow)] ?? "状态未知", reason: openedRow.makerId != null ? `发起人 ${label(openedRow.makerId)}${isMaker(openedRow, session?.adminId) ? "（你）" : ""}` : undefined },
          { label: "净额", icon: Coins, tone: "money", value: openedRow.netAmount == null ? "—" : `${usdt(String(openedRow.netAmount))} USDT`, reason: openedRow.grossAmount != null ? `毛额 ${usdt(String(openedRow.grossAmount))} · 费用 ${openedRow.feeAmount == null ? "—" : usdt(String(openedRow.feeAmount))}` : undefined },
          ...(openedRow.lastError ? [{ label: "待核查", state: "warn" as const, value: ADMIN_ERROR_MESSAGES[String(openedRow.lastError)] ?? "原因待核对", reason: `错误码 ${label(openedRow.lastError)}` }] : []),
        ]} />
        <Fold inset title="工单内容" summary={openedRow.evidenceHash ? "含证据摘要" : "工单字段"}><KeyValues rows={caseRows(openedRow)} /></Fold>
      </>}
    </Drawer>

    {claim && <ClaimDrawer key={`${claim.sourceType}:${claim.sourceId}`} source={claim} sources={sources} policyMode={policy ? String(policy.mode) : "UNREAD"} canRefund={canRefund}
      scopeFor={scopeFor} owns={owns} busy={busy} onClose={onClaimClose}
      onPropose={(intent, body, facts) => confirm({ kind: "funds", action: intent === "CLAIM_CREDIT" ? "提交认领入账提案" : "提交原路退款提案", title: intent === "CLAIM_CREDIT" ? "提交认领入账提案" : "提交原路退款提案", confirmLabel: "提交审批",
        path: intent === "CLAIM_CREDIT" ? "/exception-claims" : "/refunds/cases", body, facts,
        detail: `证据 ${label(body.evidenceHash)}。另一管理员须独立复核后才会执行。`, completion: "提交后需另一位管理员复核才执行。" })} />}
  </>;
}

/** 认领或原路退款：四步，换来源或方式清掉已生成的证明（D1-A43～A45）。 */
function ClaimDrawer({ source, sources, policyMode, canRefund, scopeFor, owns, busy, onClose, onPropose }: {
  source: ClaimSource; sources: ClaimSource[]; policyMode: string; canRefund: boolean;
  scopeFor: (write?: boolean, refund?: boolean) => ExceptionRequestScope; owns: () => boolean; busy: boolean; onClose: () => void;
  onPropose: (intent: string, body: ExceptionRecord, facts: React.ReactNode) => void;
}) {
  const [intent, setIntent] = useState(source.dust ? "REFUND_ORIGIN" : "CLAIM_CREDIT");
  const [userId, setUserId] = useState("");
  const [signature, setSignature] = useState("");
  const [challenge, setChallenge] = useState<ExceptionRecord | null>(null);
  const [evidence, setEvidence] = useState<ExceptionRecord | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const selection = useRef(0);
  const clearProof = () => { selection.current++; setChallenge(null); setEvidence(null); setSignature(""); setError(""); };
  const refund = intent === "REFUND_ORIGIN";
  const userValid = /^[1-9][0-9]{0,18}$/.test(userId);
  const prepareBlock = working || busy ? "正在处理" : refund && !canRefund ? "没有退款权限" : refund && policyMode === "UNREAD" ? "退款手续费没读到，刷新后再试" : refund && policyMode === "UNCONFIGURED" ? "退款手续费待配置，先在「退款手续费」里配置" : !refund && source.dust ? "这笔低额入金已有归属，仅支持原路退款" : !refund && !userValid ? "先填认领用户编号" : undefined;
  const prepare = async () => {
    const scope = scopeFor(true, refund); scope.assertOwner();
    setWorking(true); setError(""); const epoch = ++selection.current;
    setChallenge(null); setEvidence(null); setSignature("");
    try {
      if (!sources.some(row => row.sourceType === source.sourceType && row.sourceId === source.sourceId)) throw new Error("请选择当前待处理的资金记录");
      const result = await exceptionCommand("/exception-ownership/challenges", { sourceType: source.sourceType,
        sourceId: exceptionId(source.sourceId), action: intent, targetUserId: intent === "CLAIM_CREDIT" ? exceptionId(userId) : null }, scope);
      scope.assertOwner();
      if (epoch === selection.current) setChallenge(result);
    } catch (failure) { if (epoch === selection.current && owns()) setError(displayAdminError(failure)); }
    finally { if (owns()) setWorking(false); }
  };
  const preview = async () => {
    const scope = scopeFor(true, refund); scope.assertOwner();
    if (!challenge) return;
    setWorking(true); setError(""); const epoch = selection.current;
    try {
      const result = await exceptionCommand(intent === "CLAIM_CREDIT" ? "/exception-claims/preview" : "/refunds/preview", {
        challengeId: exceptionChallengeId(challenge.challengeId), signature, ...(intent === "CLAIM_CREDIT" ? { targetUserId: exceptionId(userId) } : {}),
      }, scope);
      scope.assertOwner();
      if (epoch === selection.current) setEvidence(result);
    } catch (failure) { if (epoch === selection.current && owns()) { setEvidence(null); setError(displayAdminError(failure)); } }
    finally { if (owns()) setWorking(false); }
  };
  const signatureValid = /^0x[0-9a-fA-F]{130}$/.test(signature);
  const step = evidence ? 3 : challenge ? (signatureValid ? 2 : 1) : 0;
  const proposeBlock = working || busy ? "正在处理" : !challenge ? "先生成钱包签名原文" : !evidence ? "先核对归属与资金证据" : refund && evidence.canPropose !== true ? "当前费用规则下不能提交退款，请核对净额及费用配置。" : undefined;
  const options = [
    { value: "CLAIM_CREDIT", label: source.dust ? "认领并入账（低额入金不能认领）" : "认领并入账", disabled: source.dust },
    ...(canRefund ? [{ value: "REFUND_ORIGIN", label: policyMode === "UNREAD" ? "原路退款（费用没读到）" : policyMode === "UNCONFIGURED" ? "原路退款（费用待配置）" : "原路退款", disabled: policyMode === "UNCONFIGURED" || policyMode === "UNREAD" }] : []),
  ];
  return <Drawer open onClose={onClose} title="认领或退款" sub={source.title} icon={HandCoins} tone="role-2" busy={working || busy}
    footer={<Decision note={proposeBlock}
      explain="由原转出钱包签名证明归属。交易所或合约不能提供该证明时，保留待核查并联系原平台补证；公开交易哈希不能代替签名。"
      primary={<Button variant="primary" disabledReason={proposeBlock} onClick={() => challenge && evidence && onPropose(intent, {
        challengeId: exceptionChallengeId(challenge.challengeId), signature, ...(intent === "CLAIM_CREDIT" ? { targetUserId: exceptionId(userId) } : {}), evidenceHash: evidence.evidenceHash,
      }, <Facts><Fact k="净额" lead tone="role-1" unit="USDT">{label(evidence.netAmount)}</Fact><Fact k="来源">{source.title}</Fact><Fact k="方式">{refund ? "原路退款" : `认领给用户 ${userId}`}</Fact><Fact k="证据">{label(evidence.evidenceHash)}</Fact></Facts>)}>提交处置提案</Button>} />}>
    <Steps label="认领或退款进度" items={[
      { label: "选方式", state: step > 0 ? "done" : "current" },
      { label: "生成签名原文", state: step > 0 ? "done" : "todo" },
      { label: "核对归属", state: step === 3 ? "done" : step > 0 ? "current" : "todo" },
      { label: "提交提案", state: step === 3 ? "current" : "todo" },
    ]} />
    <Facts><Fact k="来源">{source.title}</Fact></Facts>
    {source.dust && <p className="rd-note">这笔低额入金已有归属，仅支持原路退款；费用待配置时请先配置规则。</p>}
    <Field label="处置方式" required>
      <Select aria-label="异常处置方式" value={intent} onChange={(value) => { setIntent(value); clearProof(); }} disabled={working} options={options} />
    </Field>
    {intent === "CLAIM_CREDIT" && <Field label="认领用户编号" required error={userId && !userValid ? "用户编号只能是数字" : undefined}>
      <Input aria-label="认领用户编号" value={userId} disabled={working} inputMode="numeric" onChange={(event) => { setUserId(event.target.value.trim()); clearProof(); }} />
    </Field>}
    <div><Button disabledReason={prepareBlock} loading={working && !challenge} onClick={() => void prepare()}>生成钱包签名原文</Button></div>
    {error && <BlockState state="error" compact title="这一步没有完成" detail={error} />}
    {challenge && <>
      <Field label="钱包签名原文" help={`有效期至 ${label(challenge.expiresAt)}。请将以上原文交给原转出钱包签名，无须转账或提供私钥。`}>
        <Textarea aria-label="钱包签名原文" readOnly rows={6} value={label(challenge.message)} />
      </Field>
      <Field label="签名结果" required error={signature && !signatureValid ? "签名是 0x 开头的 130 位十六进制" : undefined}>
        <Textarea aria-label="钱包签名结果" rows={3} value={signature} disabled={working} onChange={(event) => { setSignature(event.target.value.trim()); setEvidence(null); }} />
      </Field>
      <div><Button disabledReason={working ? "正在处理" : signatureValid ? undefined : "先粘贴签名结果"} onClick={() => void preview()}>核对归属与资金证据</Button></div>
    </>}
    {evidence && <Fold inset defaultOpen title="归属与资金证据" summary={`净额 ${label(evidence.netAmount)} USDT`}>
      <KeyValues rows={caseRows(evidence)} />
      {refund && evidence.canPropose === false && <p className="rd-note">当前费用规则下不能提交退款，请核对净额及费用配置。</p>}
    </Fold>}
  </Drawer>;
}
