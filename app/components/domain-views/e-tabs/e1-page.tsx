"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, RotateCcw, SearchCheck, Server } from "lucide-react";
import { BlockState, Button, Change, ConflictBar, DiffList, Explain, Facts, Fact, Fold, Notice, Drawer, PageHeader, RdPage, ReleaseModal, StatusTag } from "@/app/components/rd";
import { OperationConfirmModal, useToast } from "../design-kit";
import { operationConfirmErrorMessage } from "@/lib/admin/operation-confirm-error";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { datacenterNameText } from "@/lib/admin/brand-copy";
import { businessClock, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { fetchE1Products, fetchE1GenerationGates, fetchE1Discount, type E1CatalogSnapshot, type E1BundleDiscount, type E1GenerationGateData, type E1InvalidSku } from "@/lib/admin/e1-client";
import { fetchE3Snapshot } from "@/lib/admin/e3-client";
import { A2OutcomeUncertainError, createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { roleLabel } from "@/lib/nav/console-nav";
import { useReach } from "@/lib/nav/use-reach";
import { ADMIN_ERROR_MESSAGES, displayAdminError, displayAdminReadError, formatAdminApiError } from "@/lib/admin/error-messages";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isDeterministicRejection } from "@/lib/admin/outcome-classification";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { supportsDeviceMonthlyTarget } from "@/lib/admin/device-monthly-target";
import type { ProposeSpec } from "@/lib/admin/propose-or-execute";
import type { OpsSku } from "@/lib/admin/platform-types";
import type { McSpec } from "./types";
import { E1_CURRENT_PHASE_UNVERIFIED, e1CurrentPhase, e1SkuOpening, resolveE1PhaseId } from "./data";
import { E1Catalog, E1_MISSING_SERIES_REASON, type E1CatalogContext } from "./e1-catalog";
import { E1Editor, type E1EditRequest, type E1SkuReview } from "./e1-editor";
import { MissingProposalReleaseModal, PROPOSAL_END, RECOVERY_LINE, RecoveryPanel, eReadError, recoveryTitle, type RecoveryItem } from "./e-command-check";
import { e1Commands, e1MonthlyCommands, e1Pending, forgetE1, e1LegacyCommands, e1LegacyObject, e1MediaCommands, e1Number, e1Decimal, e1TargetPrecision, e1Object, e1ShownDiff, e1SkuDiff, e1Value, type E1Pending, type E1Legacy, type E1MediaPending } from "./e1-state";

type Confirmation = McSpec & Partial<E1SkuReview> & { gates?: E1GenerationGateData | null; discount?: E1BundleDiscount | null; early?: Record<string, string> };
type E1Receipt = ProposeSpec & { id: string; commandKey: string; object: string; status: string; reading?: boolean; readError?: string };
const APPROVAL = "由另一位有批准及商品业务权限的管理员批准。批准前目录不变。";
const RECEIPT_STATUS: Record<string, string> = { pending: "待审批", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" };
const E1_UNKNOWN = "结果还不确定，原请求和理由已保留；请先查询原结果，查不到才能按原请求重试。";
const TICKET_UNREAD = "刚查过：还是没查到审批进度，稍后再查。";
const RETRY_REQUIRES_LOOKUP = "先查询原结果，查不到才能重试";
const endToast = (obj: string, id: string, status: string) => PROPOSAL_END[status] ? `${obj} · 审批单 ${id} ${PROPOSAL_END[status].tag}：${PROPOSAL_END[status].text}` : `${obj} · 审批单 ${id} 状态待核实`;

function e1Error(error: unknown) {
  if (isA2OutcomeUncertainError(error)) return E1_UNKNOWN;
  const value = error as { backendMessage?: string; message?: string } | null;
  const code = value?.backendMessage ?? value?.message ?? "";
  if (code.includes("TASK_POOL_FORMAT_RETIRED")) return "原商品操作使用旧任务格式，请先核对原申请，再从商品管理与上架条件重新配置任务等级。";
  if (code.startsWith("IDEMPOTENCY_")) return "原请求的结果还在核对，记录保留；请先查询原结果，不要重新填写提交。";
  return displayAdminError(error);
}

/** onOpenHosting：E1Area 传入，页头显示「托管机房」入口。 */
export function E1Page({ onOpenHosting }: { onOpenHosting?: () => void } = {}) {
  const [toastNode, toast] = useToast();
  const actor = useAdminAuth(s => String(s.session?.adminId ?? ""));
  const session = useAdminAuth(s => s.session);
  const authorities = useAdminAuth(s => s.session?.authorities ?? []);
  const canRead = authorities.includes("device_e1_read");
  const canReadE3 = authorities.includes("device_e3_read");
  const canWrite = authorities.includes("device_e1_write") && authorities.some(a => a === "platform_a2_proposal_create" || a === "platform_a2_write");
  const canQuery = authorities.some(a => a === "platform_a2_read" || a === "platform_a2_proposal_create");
  const reach = useReach();
  const canOpenAudit = reach("/platform/audit", "platform_a2_read");
  const forceUnlock = authorities.includes("device_e1_generation_gate_force_unlock"), forceLock = authorities.includes("device_e1_generation_gate_force_lock");
  const [skus, setSkus] = useState<OpsSku[]>([]);
  const [invalid, setInvalid] = useState<E1InvalidSku[]>([]);
  const [gates, setGates] = useState<E1GenerationGateData | null>(null);
  const [discount, setDiscount] = useState<E1BundleDiscount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readAt, setReadAt] = useState("");
  const [receipts, setReceipts] = useState<E1Receipt[]>([]);
  const [receiptDetailId, setReceiptDetailId] = useState<string | null>(null);
  const receiptDetail = receipts.find(row => row.id === receiptDetailId);
  const receipt = receipts.at(-1);
  const [businessValues, setBusinessValues] = useState<Record<string, string>>({});
  const [mediaSending, setMediaSending] = useState("");
  const [gatesLoading, setGatesLoading] = useState(true), [gatesError, setGatesError] = useState<string | null>(null);
  const [discountLoading, setDiscountLoading] = useState(true), [discountError, setDiscountError] = useState<string | null>(null);
  const [early, setEarly] = useState<Record<string, string>>({});
  const [earlyError, setEarlyError] = useState<string | null>(null);
  const [earlyLoading, setEarlyLoading] = useState(true);
  const [edit, setEdit] = useState<E1EditRequest | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [pending, setPending] = useState<E1Pending[]>([]);
  const [legacy, setLegacy] = useState<E1Legacy[]>([]);
  const [media, setMedia] = useState<E1MediaPending[]>([]);
  const [busy, setBusy] = useState("");
  const sending = useRef(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rejected, setRejected] = useState<string[]>([]);
  const [absent, setAbsent] = useState<string[]>([]);
  const [release, setRelease] = useState<E1Pending | null>(null);
  const [conflict, setConflict] = useState(false);
  // 首次提交被后端明确拒绝：同一份输入再点也会被拒，按钮停住，给「返回修改」（只管这个框的界面状态）。
  const [refused, setRefused] = useState<{ on: Confirmation; text: string } | null>(null);
  const [conflictLatest, setConflictLatest] = useState<E1CatalogSnapshot | null>(null);
  const [skuConflict, setSkuConflict] = useState<{ nonce: number; latest?: OpsSku | null } | null>(null);
  const draftConflict = skuConflict?.nonce === edit?.nonce ? skuConflict : null;
  const currentSku = edit?.sku ? skus.find(sku => sku.id === edit.sku?.id) : undefined;
  const hasSkuVersionConflict = (review: Confirmation) => review.op === "sku-save" && !!review.beforeSku
    && (!!draftConflict || currentSku?.updatedAt !== review.beforeSku.updatedAt);
  const [attemptKey, setAttemptKey] = useState("");
  const syncPending = useCallback(() => { const records = e1Pending(actor); setPending(records); setAbsent(records.filter(r => r.absent && !r.receivedTicketId).map(r => r.commandKey)); setRejected(records.filter(r => r.retryRejection).map(r => r.commandKey)); setLegacy(e1LegacyCommands(actor)); setMedia(e1MediaCommands.list().filter(r => r.actorId === actor)); }, [actor]);
  useEffect(syncPending, [syncPending]);
  const refreshProducts = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await fetchE1Products();
      setSkus(result.skus); setInvalid(result.invalidSkus); setReadAt(businessClock(Date.now())); return result;
    } catch (failure) { setError(displayAdminReadError(failure)); setSkus([]); setInvalid([]); return null; }
    finally { setLoading(false); }
  }, []);
  const refreshGates = useCallback(async () => {
    setGatesLoading(true); setGatesError(null);
    try { const result = await fetchE1GenerationGates(); setGates(result); return result; }
    catch (failure) { setGates(null); setGatesError(displayAdminReadError(failure)); return null; }
    finally { setGatesLoading(false); }
  }, []);
  const refreshDiscount = useCallback(async () => {
    setDiscountLoading(true); setDiscountError(null);
    try { const result = await fetchE1Discount(); setDiscount(result); return result; }
    catch (failure) { setDiscount(null); setDiscountError(displayAdminReadError(failure)); return null; }
    finally { setDiscountLoading(false); }
  }, []);
  const refresh = useCallback(async (): Promise<E1CatalogSnapshot | undefined> => {
    const [products, nextGates, nextDiscount] = await Promise.all([refreshProducts(), refreshGates(), refreshDiscount()]);
    if (products && nextGates && nextDiscount) return { ...products, gates: nextGates, bundleDiscount: nextDiscount };
  }, [refreshProducts, refreshGates, refreshDiscount]);
  const refreshEarly = useCallback(async () => {
    setEarlyLoading(true); setEarlyError(null);
    if (!canReadE3) { setEarly({}); setEarlyError("当前账号没有抢先购关联设置的读取权限"); setEarlyLoading(false); return; }
    try { const snapshot = await fetchE3Snapshot(); setEarly(snapshot.params); }
    catch (failure) { setEarly({}); setEarlyError(displayAdminReadError(failure)); }
    finally { setEarlyLoading(false); }
  }, [canReadE3]);
  useEffect(() => { if (canRead) { void refresh(); void refreshEarly(); } }, [canRead, refresh, refreshEarly]);
  const earlyReady = !earlyLoading && !earlyError && ["开", "关"].includes(early["E.release.earlyAccess.enabled"]) && ["7", "14", "30", "60", "90"].includes(early["E.release.earlyAccess.leadDays"]);
  const catalogReadBlock = loading || error ? "商品目录读取成功前不能提交修改" : undefined;
  const gatesReadBlock = gatesLoading || gatesError || !gates ? "开放阶段读取成功前不能提交修改" : undefined;
  const discountReadBlock = discountLoading || discountError || !discount ? "组合购折扣读取成功前不能提交修改" : undefined;
  const currentPhase = e1CurrentPhase(gates);
  const phaseBlock = currentPhase.phaseId ? undefined : `${E1_CURRENT_PHASE_UNVERIFIED}，暂不能提交`;
  const archiveCurrentBlock = (phaseId?: string) => phaseBlock ?? (phaseId === currentPhase.phaseId ? "当前阶段不能删除" : undefined);
  const readBlock: E1CatalogContext["writeBlockedReason"] = (input, values) => {
    switch (input.op) {
      case "sku-save": return catalogReadBlock ?? (gatesReadBlock ? "商品编辑需要开放阶段和审核契约，请先读取开放阶段" : edit?.unlock ? phaseBlock : undefined);
      case "sku-delete": return catalogReadBlock;
      case "sku-status": {
        if (catalogReadBlock || input.status !== "on") return catalogReadBlock;
        const sku = skus.find(item => item.id === input.target);
        if (sku && !supportsDeviceMonthlyTarget(sku.seriesCode)) return E1_MISSING_SERIES_REASON;
        if (gatesReadBlock) return gatesReadBlock;
        return sku && gates ? e1SkuOpening(sku, gates, currentPhase.phaseId).blockers.join("；") || undefined : undefined;
      }
      case "phase-archive": return gatesReadBlock ?? catalogReadBlock ?? archiveCurrentBlock(input.phaseId);
      case "generation-gate-save": {
        const sourceBlock = gatesReadBlock ?? (!input.generationGateId ? catalogReadBlock : undefined);
        if (sourceBlock || !values || !phaseBlock) return sourceBlock;
        if ((values.forceUnlock ?? String(input.generationGate?.forceUnlock)) === "true") return phaseBlock;
        if (input.generationGateId) return undefined;
        const phaseId = values.phase;
        if (!phaseId) return "当前阶段待核实，请手动选择开放阶段";
        if (!gates?.phaseOrder.includes(phaseId) || !gates.phases.some(phase => phase.p === phaseId && phase.status !== "archived")) {
          return formatAdminApiError("E1_GATE_PHASE_INVALID", "");
        }
        const sku = skus.find(item => item.id === (values.skuId ?? input.generationGate?.skuId));
        if (!sku || resolveE1PhaseId(gates.phases, sku.unlock.trim()) !== phaseId) return formatAdminApiError("E1_GATE_SKU_PHASE_MISMATCH", "");
        return undefined;
      }
      case "generation-gate-force": return gatesReadBlock ?? (input.generationGate?.forceUnlock ? catalogReadBlock ?? phaseBlock : undefined);
      case "phase-save": return gatesReadBlock ?? (input.phaseId && values?.status === "archived"
        && gates?.phases.some(phase => phase.p === input.phaseId && phase.status !== "archived") ? archiveCurrentBlock(input.phaseId) : undefined);
      case "param": return gatesReadBlock ?? (gates?.releases.some(gate => gate.id === input.generationGateId && gate.forceUnlock) ? phaseBlock : undefined);
      case "generation-gate-archive": return gatesReadBlock;
      case "bundle-discount": return discountReadBlock;
      case "early-access": return earlyReady ? undefined : "当前设置未读取，请先重新读取抢先购设置";
      default: return undefined;
    }
  };
  const skuReadBlock = readBlock({ op: "sku-save" });
  const skuWritesReady = canWrite && !skuReadBlock;
  const refreshReceipt = async (receipt: E1Receipt) => {
    setReceipts(rows => rows.map(row => row.id === receipt.id ? { ...row, reading: true, readError: undefined } : row));
    try {
      if (!canQuery) throw new Error("当前账号不能读取审批状态，请保留审批单号核对");
      const result = await fetchA2ProposalByKey(receipt.commandKey, true);
      if (!result || result.id !== receipt.id) throw new Error("没有查到这张审批单的进度，请稍后再查，或到操作记录与审批核对");
      setReceipts(rows => rows.map(row => row.id === receipt.id ? { ...row, status: result.status } : row));
      if (result.status !== "pending" && receipt.status === "pending") toast(endToast(receipt.action, receipt.id, result.status));
    } catch (failure) {
      setReceipts(rows => rows.map(row => row.id === receipt.id ? { ...row, readError: displayAdminReadError(failure) } : row));
    } finally {
      setReceipts(rows => rows.map(row => row.id === receipt.id ? { ...row, reading: false } : row));
    }
  };
  const openReceipt = (id: string) => {
    const receipt = receipts.find(row => row.id === id);
    if (!receipt) return;
    setReceiptDetailId(id);
    void refreshReceipt(receipt);
  };
  const locked = (type: string, id: string) => pending.some(r => e1Object(r.spec) === `${type}|${id}`)
    || legacy.some(r => e1LegacyObject(r) === `${type}|${id}`)
    || receipts.some(r => r.status === "pending" && r.object === `${type}|${id}`);

  const openSku = (skuId?: string, unlock?: string) => {
    if (!skuWritesReady || unlock && unlock !== currentPhase.phaseId || skuId && locked("device_sku", skuId)) return;
    if (edit) { toast("请先完成或关闭正在编辑的商品草稿"); return; }
    setEdit({ sku: skuId ? skus.find(s => s.id === skuId) : undefined, unlock, nonce: Date.now() });
  };
  const openConfirm = (input: McSpec) => {
    if (!canWrite || readBlock(input)) return;
    setConflict(false); setConflictLatest(null); setAttemptKey("");
    setBusinessValues(input.businessForm?.kind === "multi-field" ? Object.fromEntries(input.businessForm.fields.map(f => [f.key, f.current ?? ""])) : {});
    setConfirmation({ ...input, sku: skus.find(s => s.id === input.target), gates, discount, early: { ...early } });
  };
  const send = async (record: E1Pending, retry: boolean) => {
    if (!canWrite || !actor || record.actorId !== actor || sending.current) throw new Error("账号、权限或提交状态不允许重试，请先核对原操作");
    if (retry) {
      const original = e1Pending(actor).find(row => row.commandKey === record.commandKey);
      if (!original?.absent || original.receivedTicketId) throw new Error(RETRY_REQUIRES_LOOKUP);
      record = original;
    }
    if (isRetryExpired(record)) throw new Error(RETRY_EXPIRED_TEXT);
    const store = record.fingerprint.startsWith("sku|") ? e1MonthlyCommands : e1Commands;
    record = { ...record, retryRejection: undefined, absent: false };
    store.remember(record.fingerprint, record.commandKey, record);
    if (!store.isDurablyStored(record.fingerprint, record.commandKey)) throw new Error("浏览器无法保存原操作，本次没有发送；原记录和对象锁仍保留。");
    sending.current = true; setBusy(record.commandKey); setRejected(keys => keys.filter(k => k !== record.commandKey));
    try {
      const spec = record.spec;
      const result = await createA2OperationProposal({ action: spec.action, obj: spec.obj, beforeValue: spec.before, afterValue: spec.after,
        operator: session?.operator || session?.username || "", operatorRole: roleLabel(session!.role), type: spec.type,
        amplifies: !!spec.amplifies, sos: !!spec.sos, roleGate: spec.gateLabel, reason: spec.reason, sourceDomain: spec.sourceDomain,
        command: spec.command, target: spec.target, targets: spec.targets,
      }, record.commandKey, true);
      record = { ...record, receivedTicketId: result.id };
      store.remember(record.fingerprint, record.commandKey, record);
      if (retry) {
        setConfirmation(null); setEdit(null);
        await check(record, true);
        return;
      }
      forgetE1(record); toast(`已提交，等待审批后执行 · 审批单 ${result.id}`);
      setReceipts(rows => [...rows.filter(row => row.object !== e1Object(spec)), { ...spec, id: result.id, commandKey: record.commandKey, object: e1Object(spec), status: result.status }]);
      setConfirmation(null); if (record.spec.command.op === "e1_sku_create" || record.spec.command.op === "e1_sku_update") setEdit(null);
      const latest = await refresh();
      if (!latest) toast("申请已提交，部分目录或关联设置未读取完整");
    } catch (failure) {
      const response = failure as { httpStatus?: number; apiCode?: number; backendMessage?: string; message?: string };
      const firstRejection = !record.receivedTicketId && !retry && !isA2OutcomeUncertainError(failure) && response.httpStatus !== undefined
        && isDeterministicRejection(response.httpStatus, response.apiCode);
      if (firstRejection) forgetE1(record);
      else if (!record.receivedTicketId && retry && isExplicitRejection(failure)) {
        store.remember(record.fingerprint, record.commandKey, { ...record, retryRejection: e1Error(failure) });
        setRejected(keys => [...keys, record.commandKey]);
      }
      const shown = record.receivedTicketId ? TICKET_UNREAD : e1Error(failure);
      setNotes(n => ({ ...n, [record.commandKey]: shown }));
      if (!firstRejection && !isExplicitRejection(failure)) { setConfirmation(null); setEdit(null); }
      const skuReview = !retry && confirmation?.op === "sku-save" ? confirmation : null;
      const code = response.backendMessage;
      if (firstRejection && skuReview && code?.startsWith("SKU_SERIES_") && ADMIN_ERROR_MESSAGES[code]) {
        skuReview.setSeriesError?.(ADMIN_ERROR_MESSAGES[code].replace(/。$/, ""));
      }
      if ((code ?? response.message)?.includes("VERSION_CONFLICT")) {
        if (skuReview?.beforeSku && edit) setSkuConflict({ nonce: edit.nonce });
        else setConflict(true);
      }
      // Throw the original error so OperationConfirmModal keeps reason and fields.
      throw failure;
    } finally { sending.current = false; setBusy(""); syncPending(); }
  };
  const submit = async (spec: ProposeSpec) => {
    if (!canWrite || !actor || sending.current) throw new Error("正在提交或账号没有提交权限，本次没有提交");
    const object = e1Object(spec);
    if (e1Pending(actor).some(r => e1Object(r.spec) === object) || locked(object.split("|")[0], object.split("|").slice(1).join("|"))) throw new Error("此对象有待审批或待核对的操作，请先核对原操作");
    const commandKey = createA2CommandKey("e1-proposal"), fingerprint = `${actor}|${object}`;
    const savedSpec = JSON.parse(JSON.stringify(spec)) as ProposeSpec;
    e1Commands.remember(fingerprint, commandKey, { actorId: actor, spec: savedSpec });
    if (!e1Commands.isDurablyStored(fingerprint, commandKey)) { e1Commands.forget(fingerprint, commandKey); throw new Error("浏览器无法保存原操作，本次没有提交。请检查浏览器设置后重试。"); }
    syncPending();
    setAttemptKey(commandKey);
    return send(e1Commands.list().find(r => r.commandKey === commandKey)!, false);
  };
  const check = async (record: { commandKey: string }, propagate = false) => {
    const full = e1Pending(actor).find(r => r.commandKey === record.commandKey);
    const store = full?.fingerprint.startsWith("sku|") ? e1MonthlyCommands : e1Commands;
    if (full) { store.remember(full.fingerprint, full.commandKey, { ...full, absent: false }); syncPending(); }
    try {
      const row = await fetchA2ProposalByKey(record.commandKey, true, "f");
      if (row && full && (!row.mine || row.obj !== full.spec.obj || full.receivedTicketId && row.id !== full.receivedTicketId)) throw new A2OutcomeUncertainError("查到的审批单和原请求对不上，记录保留；请到操作记录与审批核对。", record.commandKey);
      if (!row && full?.receivedTicketId) throw new A2OutcomeUncertainError(TICKET_UNREAD, record.commandKey);
      if (!row && full) { store.remember(full.fingerprint, full.commandKey, { ...full, absent: true }); syncPending(); }
      if (!row) { setNotes(n => ({ ...n, [record.commandKey]: full ? "刚查过：没有这张审批单。" : "按原请求没有查到审批单。旧记录不能重试或解除，请到操作记录与审批核对。" })); return; }
      setNotes(n => ({ ...n, [record.commandKey]: `审批单 ${row.id} · ${RECEIPT_STATUS[row.status] ?? "状态待核实"}` }));
      toast(row.status === "pending" ? `查到了审批单 ${row.id}，还在等批准` : endToast(full?.spec.action ?? "原操作", row.id, row.status));
      if (full) {
        const spec = full.spec;
        setReceipts(rows => [...rows.filter(receipt => receipt.object !== e1Object(spec)), { ...spec, id: row.id, commandKey: record.commandKey, object: e1Object(spec), status: row.status }]);
        forgetE1(full); syncPending();
        if (row.status !== "pending") { await refresh(); await refreshEarly(); }
      }
    } catch (failure) {
      const message = full?.receivedTicketId ? TICKET_UNREAD : isA2OutcomeUncertainError(failure) ? (failure as Error).message : `这次没查到：${eReadError(failure)}`;
      setNotes(n => ({ ...n, [record.commandKey]: message }));
      if (propagate) throw failure;
    }
  };

  const releaseMissing = async (record: E1Pending) => {
    if (String(useAdminAuth.getState().session?.adminId ?? "") !== record.actorId || !isRetryExpired(record) || record.receivedTicketId) return;
    await check(record, true);
    const current = e1Pending(record.actorId).find(r => r.commandKey === record.commandKey);
    if (current?.absent && !current.receivedTicketId) { forgetE1(current); syncPending(); return true; }
    return false;
  };

  const confirm = async (reason: string, value?: string, business?: Record<string, string>) => {
    const mc = confirmation;
    if (!mc || !canWrite) throw new Error("当前不能提交，请保留输入并刷新目录核对");
    if (hasSkuVersionConflict(mc)) throw new Error("商品或配置已被别人改过，你填的内容还在；读取最新后重新核对。");
    const missingSource = readBlock(mc, business);
    if (missingSource) throw new Error(missingSource);
    let op = "", context: Record<string, unknown> = {}, before = "", after = "", obj = "", amplifies = !!mc.amplify;
    if (mc.op === "sku-save" && mc.sku) {
      if (gates?.skuReviewContractVersion !== 1) throw new Error("商品审核暂时不可用，请刷新后重试；已填写的内容会保留");
      const sku = mc.sku, old = mc.beforeSku, changes = e1SkuDiff(old, sku, mc.form).filter(r => r.before !== r.after);
      op = old ? "e1_sku_update" : "e1_sku_create"; obj = sku.id;
      context = { ...sku, skuId: sku.id, computePoints: mc.form?.computePoints.trim() || sku.computePoints };
      for (const key of ["price", "dailyEarnNEX", "phoneDailyEarn", "phoneDailyEarnNEX", ...sku.monthlyTargetUsdt == null ? ["dailyEarn", "shareYieldMin", "shareYieldMax"] as const : []] as const) {
        if (mc.form?.[key].trim()) context[key] = mc.form[key].trim();
      }
      // Preserve Long inputs as decimal strings; Jackson accepts them without Number rounding.
      for (const key of ["aiImageGenPerMin", "aiLlmTokensPerSec", "aiVideoMinPerHour", "aiFineTuneMins"] as const) if (mc.form?.[key].trim()) context[key] = mc.form[key].trim();
      before = changes.map(r => `${r.label}：${r.before}`).join("；") || "未创建";
      after = changes.map(r => `${r.label}：${r.after}${r.note ? `（${r.note}）` : ""}`).join("；");
      amplifies = false; // Backend independently evaluates monthly upper-bound amplification.
    } else if ((mc.op === "sku-status" || mc.op === "sku-delete") && mc.sku) {
      obj = mc.sku.id; op = mc.op === "sku-delete" ? "e1_sku_delete" : "e1_sku_status";
      context = { skuId: mc.sku.id, status: mc.status, updatedAt: mc.sku.updatedAt };
      before = `${mc.sku.name} · ${e1Value(mc.sku.status)} · ${e1Decimal(mc.sku.price)} USD`;
      after = mc.op === "sku-delete" ? "已移除" : e1Value(mc.status);
    } else if (mc.op === "bundle-discount" && business && mc.discount) {
      if ([business.twoItemsPct, business.threeItemsPct, business.fourPlusItemsPct].some(v => !/^\d+(?:\.\d{1,2})?$/.test(v) || Number(v) < 0.01 || Number(v) > 30) || Number(business.threeItemsPct) < Number(business.twoItemsPct) || Number(business.fourPlusItemsPct) < Number(business.threeItemsPct)) throw new Error("折扣须为0.01 %～30 %，最多 2 位小数，且件数增加时折扣不能下降");
      op = "e1_bundle_discount"; obj = "App 组合购阶梯折扣"; amplifies = true;
      context = { twoItemsPct: Number(business.twoItemsPct), threeItemsPct: Number(business.threeItemsPct), fourPlusItemsPct: Number(business.fourPlusItemsPct), expectedVersion: mc.discount.version };
      before = `v${mc.discount.version} · 2 件 ${mc.discount.twoItemsPct} % · 3 件 ${mc.discount.threeItemsPct} % · 4+ 件 ${mc.discount.fourPlusItemsPct} %`;
      after = `2 件 ${business.twoItemsPct} % · 3 件 ${business.threeItemsPct} % · 4+ 件 ${business.fourPlusItemsPct} %`;
      if (Number(business.twoItemsPct) === mc.discount.twoItemsPct && Number(business.threeItemsPct) === mc.discount.threeItemsPct && Number(business.fourPlusItemsPct) === mc.discount.fourPlusItemsPct) throw new Error("没有修改折扣，无需提交");
    } else if (mc.op === "phase-save" && business) {
      if (!business.label?.trim() || !/^\d+$/.test(business.sortOrder) || Number(business.sortOrder) > 9999) throw new Error("请填写阶段名称和0～9999的整数排序");
      op = mc.phaseId ? "e1_phase_patch" : "e1_phase_create"; obj = mc.phaseId ?? business.label.trim();
      context = { phaseId: mc.phaseId ?? "", label: business.label.trim(), meta: business.meta?.trim() ?? "", skus: business.skus?.trim() ?? "", sortOrder: Number(business.sortOrder), status: business.status || "active" };
      before = mc.phaseId ? JSON.stringify(mc.gates?.phases.find(p => p.p === mc.phaseId)) : "未创建"; after = JSON.stringify(context);
      if (mc.phaseId) {
        const old = mc.gates?.phases.find(p => p.p === mc.phaseId);
        if (old && old.label === context.label && (old.meta ?? "") === context.meta && old.skus === context.skus && old.sortOrder === context.sortOrder && old.status === context.status) throw new Error("阶段设置没有变化，无需提交");
      }
    } else if (mc.op === "phase-archive" && mc.phaseId) {
      op = "e1_phase_archive"; obj = mc.phaseId; context = { phaseId: mc.phaseId };
      before = JSON.stringify(mc.gates?.phases.find(p => p.p === mc.phaseId)); after = "已归档";
    } else if (mc.op === "generation-gate-save" && business) {
      const old = mc.gates?.releases.find(g => g.id === mc.generationGateId);
      const force = business.forceUnlock === undefined ? !!mc.generationGate?.forceUnlock : business.forceUnlock === "true";
      if (force !== !!old?.forceUnlock && !(force ? forceUnlock : forceLock)) throw new Error(force ? "当前账号没有强制提前开放权限" : "当前账号没有撤销强制权限");
      if (!/^\d+$/.test(business.releaseMonth) || Number(business.releaseMonth) < 1 || Number(business.releaseMonth) > 12 || !/^-?\d+$/.test(business.phaseOffset) || Math.abs(Number(business.phaseOffset)) > 12) throw new Error("计划月须为1～12，开放偏移须为-12～12的整数");
      op = mc.generationGateId ? "e1_gate_patch" : "e1_gate_create"; obj = business.skuId ?? mc.generationGate?.skuId ?? "";
      context = { skuId: obj, name: business.name?.trim() ?? "", releaseMonth: Number(business.releaseMonth), phase: business.phase ?? mc.generationGate?.phase, eligibility: business.eligibility === "true", phaseOffset: Number(business.phaseOffset), forceUnlock: force, status: "active" };
      before = old ? JSON.stringify(old) : "未创建"; after = JSON.stringify(context); amplifies = force;
    } else if (mc.op === "generation-gate-force" && mc.generationGateId) {
      const enabled = mc.generationGate?.forceUnlock === true;
      if (!(enabled ? forceUnlock : forceLock)) throw new Error("当前账号没有这个方向的强制开放权限");
      op = "e1_gate_field"; obj = mc.generationGateId; context = { key: `E.gen.${obj}.forceUnlock`, value: String(enabled) };
      before = enabled ? "未强制" : "已强制"; after = enabled ? "强制提前开放（只跳运营月数）" : "撤销强制，自然条件仍满足时继续开放"; amplifies = enabled;
    } else if (mc.op === "generation-gate-archive" && mc.generationGateId) {
      op = "e1_gate_archive"; obj = mc.generationGateId; context = { skuId: obj };
      before = JSON.stringify(mc.gates?.releases.find(g => g.id === obj)); after = "已归档；本页没有恢复入口";
    } else if (mc.op === "param" && mc.paramKey?.startsWith("E.gen.") && value !== undefined) {
      if (!/^-?\d+$/.test(value) || Math.abs(Number(value)) > 12) throw new Error("开放偏移须为-12～12的整数");
      if (Number(value) === Number(mc.edit?.current)) throw new Error("开放偏移没有变化，无需提交");
      op = "e1_gate_field"; obj = mc.paramKey.replace(/^E\.gen\./, "").replace(/\.phaseOffset$/, ""); context = { key: mc.paramKey, value };
      before = `绝对偏移 ${mc.edit?.current} 个月`; after = `绝对偏移 ${value} 个月`;
    } else if (mc.op === "early-access" && business && earlyReady) {
      if (!["关", "开"].includes(business.enabled) || !["7", "14", "30", "60", "90"].includes(business.leadDays)) throw new Error("请选择开关及7/14/30/60/90天");
      op = "e1_early_access_update"; obj = "置换侧抢先购"; context = { enabled: business.enabled === "开", leadDays: Number(business.leadDays) };
      before = `${mc.early?.["E.release.earlyAccess.enabled"]} · ${mc.early?.["E.release.earlyAccess.leadDays"]}天`; after = `${business.enabled} · ${business.leadDays}天`;
    } else throw new Error("原操作数据不完整，请核对后重新打开入口");
    const def = findHighOp(op)!;
    await submit({ action: mc.name, obj, before, after, type: def.type, amplifies, gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E1", command: def.buildCommand(context), target: op === "e1_gate_field" ? { domain: "E", type: "device_generation_gate", id: obj } : def.buildTarget(context) });
  };
  const mc = confirmation;
  const reviewingSku = mc?.op === "sku-save";
  const conflictRead = reviewingSku ? draftConflict?.latest !== undefined : !!conflictLatest;
  const latestConflictSku = reviewingSku ? draftConflict?.latest : conflictLatest?.skus.find(sku => sku.id === mc?.sku?.id);
  const canAcceptRevision = reviewingSku ? !!latestConflictSku?.updatedAt && latestConflictSku.updatedAt !== mc?.beforeSku?.updatedAt
    : !mc?.sku || !!latestConflictSku;
  const readConflict = async () => {
    if (reviewingSku && edit) {
      const products = await refreshProducts();
      if (!products) throw new Error("目录暂时读不到");
      setSkuConflict({ nonce: edit.nonce, latest: products.skus.find(sku => sku.id === mc.sku?.id) ?? null });
    } else {
      const snapshot = await refresh();
      if (!snapshot) throw new Error("目录暂时读不到");
      setConflictLatest(snapshot);
    }
  };
  const acceptConflictRevision = () => {
    if (!mc || !canAcceptRevision) return;
    if (reviewingSku && latestConflictSku) {
      if (!mc.acceptRevision?.(latestConflictSku)) setConfirmation(null);
    } else if (conflictLatest) {
      setConfirmation(c => c ? { ...c, discount: conflictLatest.bundleDiscount, gates: conflictLatest.gates, sku: latestConflictSku ?? c.sku } : c);
      setConflict(false); setConflictLatest(null); setAttemptKey("");
    }
  };
  // 只用于显示：开放阶段写阶段名，不写阶段编号。
  const phaseName = (text?: string) => mc?.gates?.phases.find(phase => phase.p === resolveE1PhaseId(mc.gates!.phases, text ?? ""))?.label || text;
  const skuDiff = mc?.op === "sku-save" && mc.sku ? e1ShownDiff(e1SkuDiff(mc.beforeSku, mc.sku, mc.form), mc.beforeSku, mc.sku).map(row => row.key === "unlock" ? { ...row, before: phaseName(row.before), after: phaseName(row.after) } : row) : null;
  // 新增商品只列填了的项；只改系列时关键信息写系列，不拿没变的售价当关键数字。
  const skuFilled = skuDiff && !mc?.beforeSku ? skuDiff.filter(row => !["未设置", "未填写", "未配置"].includes(row.after ?? "")) : [];
  const skuChanges = skuDiff && mc?.beforeSku ? skuDiff.filter(row => row.before !== row.after) : [];
  const seriesChange = skuChanges.length === 1 && skuChanges[0].key === "seriesCode" ? skuChanges[0] : undefined;
  // 只改系列时上面常显的几项不再在「其余设置」里写第二遍（DP-61）。
  // 改动多时收起完整明细，但钱、收益、能不能卖的前后值常显（OP-47–49、OP-151、DP-03）。
  const E1_DECISION_KEYS = ["price", "computePoints", "allowedPoolCodes", "monthlyTargetUsdt", "monthlyTargetBandPct", "dailyEarn", "dailyEarnNEX", "phoneDailyEarn", "phoneDailyEarnNEX", "shareYieldMin", "shareYieldMax", "status", "inventoryMode", "stock", "unlock", "purchaseGate"];
  const SERIES_ONLY_SHOWN = ["seriesCode", "price", "name", "allowedPoolCodes", "monthlyTargetUsdt", "monthlyTargetBandPct", "datacenter"];
  const currentPending = mc ? pending.find(r => r.commandKey === attemptKey || (mc.sku ? e1Object(r.spec) === `device_sku|${mc.sku.id}` : mc.generationGateId ? e1Object(r.spec) === `device_generation_gate|${mc.generationGateId}` : mc.phaseId ? e1Object(r.spec) === `device_phase|${mc.phaseId}` : mc.op === "bundle-discount" ? e1Object(r.spec) === "store_bundle_discount|canonical" : mc.op === "early-access" ? e1Object(r.spec) === "device_release_early_access|trade-in" : false)) : undefined;
  const ctx: E1CatalogContext = {
    skus, canWriteE1: canWrite, e1InvalidSkus: invalid, e1Loading: loading, e1Error: error, e1Gates: gates, e1BundleDiscount: discount, currentPhase, refreshE1: async () => { await refresh(); },
    pE: k => early[k] ?? "—", earlyReady, earlyLoading, earlyError, refreshEarly: () => void refreshEarly(),
    gatesLoading, gatesError, discountLoading, discountError, refreshGates: () => void refreshGates(), refreshDiscount: () => void refreshDiscount(), writeBlockedReason: readBlock,
    pendingProposal: id => receipts.find(row => row.status === "pending" && ["device_sku", "device_generation_gate"].some(type => row.object === `${type}|${id}`)),
    openPending: openReceipt,
    readPending: id => { receipts.filter(row => row.status === "pending" && ["device_sku", "device_generation_gate"].some(type => row.object === `${type}|${id}`)).forEach(row => { void refreshReceipt(row); }); },
    forceUnlock, forceLock, locked, openSku, openActionConfirm: openConfirm, toast,
    delSku: (id, name) => openConfirm({ briefKind: "config", name: `删除商品 · ${name}`, op: "sku-delete", target: id, detail: "从商城移除后用户无法再购买，已售设备和原订单不受影响。", businessForm: { kind: "destructive-reason", target: name, impact: "从商城移除，用户无法再购买；已售设备和原订单不受影响。" } }),
  };
  const copy = (text: string, done: string) => { void navigator.clipboard.writeText(text).then(() => toast(done), () => toast("复制失败，请手动选择原请求编号")); };
  const sent = (at: number) => `${formatBusinessTimeCompact(new Date(at).toISOString(), "—")} 提交`;
  const recovery: RecoveryItem[] = [
    ...receipts.filter(row => row.status === "pending").map(row => ({ key: `receipt:${row.id}`, object: row.action,
      tag: <StatusTag tone="warn">待审批</StatusTag>,
      line: row.reading ? "正在查询审批进度…" : RECOVERY_LINE.pending,
      note: row.readError ? `这次没查到审批进度：${row.readError}` : undefined,
      actions: <Button size="sm" disabled={row.reading} onClick={() => openReceipt(row.id)}>{row.readError ? "重新查询" : "查看审批状态"}</Button>,
      detail: <p>审批单 {row.id}；批准前目录不变，这个对象暂停新修改。</p> })),
    ...pending.filter(record => record.commandKey !== busy).map(record => {
      const expired = isRetryExpired(record), canRelease = rejected.includes(record.commandKey) && !expired || absent.includes(record.commandKey) && expired;
      const retryDisabledReason = !canWrite ? "当前账号不能重试"
        : busy ? "正在提交原操作"
          : expired ? "超过 24 小时不能再重试"
            : record.receivedTicketId ? "审批单已经建了，只能查询"
              : !absent.includes(record.commandKey) ? RETRY_REQUIRES_LOOKUP : undefined;
      const state = record.receivedTicketId ? { tag: "进度没读到", line: RECOVERY_LINE.created, more: "点「查询原结果」再查。" }
        : rejected.includes(record.commandKey) && !expired ? { tag: "重试被拒绝", line: RECOVERY_LINE.refused, more: "解除前先核对原操作有没有生效。" }
          : absent.includes(record.commandKey) ? expired ? { tag: "没有建成", line: RECOVERY_LINE.missing, more: "确认解除时会再查一次。" }
            : { tag: "结果未知", line: RECOVERY_LINE.absent, more: "重试不会重复建单。" }
            : expired ? { tag: "结果未知", line: RECOVERY_LINE.expired, more: "查不到这张审批单时可以确认解除。" }
              : { tag: "结果未知", line: RECOVERY_LINE.unknown, more: "重试只发原内容和原理由。" };
      return { key: record.commandKey, object: record.spec.action, createdAt: record.createdAt,
        tag: <StatusTag tone={state.tag === "重试被拒绝" ? "danger" : "warn"}>{state.tag}</StatusTag>, line: state.line, note: notes[record.commandKey] === E1_UNKNOWN ? undefined : notes[record.commandKey] ?? record.retryRejection,
        actions: <>
          {canQuery && <Button size="sm" icon={<SearchCheck size={14} aria-hidden />} disabled={!!busy} onClick={() => void check(record)}>查询原结果</Button>}
          {<Button size="sm" disabledReason={retryDisabledReason} onClick={() => { void send(record, true).catch(failure => toast(e1Pending(actor).find(r => r.commandKey === record.commandKey)?.receivedTicketId ? TICKET_UNREAD : e1Error(failure))); }}>按原请求重试</Button>}
          {canRelease && <Button size="sm" disabled={!!busy} onClick={() => setRelease(record)}>解除原操作记录</Button>}
        </>,
        detail: <>
          <p>{sent(record.createdAt)}，理由：{record.spec.reason}</p>
          <p>{state.more}</p>
          {!canOpenAudit && <p>请把原请求编号发给能查看操作记录与审批的管理员核对。</p>}</>, tech: <Fold inset title="技术信息" summary={record.commandKey}><Facts><Fact k="原对象">{record.spec.obj}</Fact><Fact k="原请求编号"><span data-mono>{record.commandKey}</span></Fact></Facts><div className="e1-table-actions"><Button size="sm" onClick={() => copy(JSON.stringify(record.spec, null, 2), "已复制完整原请求")}>复制完整原请求</Button><Button size="sm" onClick={() => copy(record.commandKey, "已复制原请求编号")}>复制原请求编号</Button></div></Fold> };
    }),
    ...legacy.map(record => ({ key: record.commandKey, object: e1LegacyObject(record).split("|").slice(1).join("|") || "原对象未保留",
      tag: <StatusTag tone="warn">缺完整原请求</StatusTag>, line: "旧记录缺原请求，只能查询，不能重试或解除。", note: notes[record.commandKey],
      actions: canQuery ? <Button size="sm" icon={<SearchCheck size={14} aria-hidden />} onClick={() => void check(record)}>查询原结果</Button> : undefined,
      detail: <><p>{sent(record.createdAt)}；升级前的记录没有原理由。</p></>, tech: <Fold inset title="技术信息" summary={record.commandKey}><Button size="sm" onClick={() => copy(JSON.stringify(record, null, 2), "已复制完整旧记录")}>复制完整旧记录</Button></Fold> })),
    ...media.filter(record => record.commandKey !== mediaSending).map(record => ({ key: record.commandKey, object: record.fileName, createdAt: record.createdAt,
      tag: <StatusTag tone="warn">上传结果未知</StatusTag>, line: isRetryExpired(record) ? RECOVERY_LINE.expired : "重新打开商品、选同一个文件，可以原样重试。",
      actions: <Button size="sm" onClick={() => openSku(record.skuId || undefined)}>核对媒体上传</Button>,
      detail: <p>{sent(record.createdAt)}；原文件摘要和原请求已保留。</p> })),
  ];
  return <RdPage className="e1-page">
    <PageHeader pageId="E1" title="商品管理与上架条件" meta={!canRead ? "未读取目录" : error ? "目录读取失败" : readAt ? <>{readAt} 读取<Explain label="数据时间说明" content="打开和点「刷新」时读取，不自动刷新。" /></> : "正在读取目录"} readOnly={!canWrite ? "当前账号只读" : undefined} actions={<>{onOpenHosting && <Button id="e1-hosting-entry" icon={<Server size={14} aria-hidden />} onClick={onOpenHosting}>托管机房</Button>}<Button icon={<RefreshCw size={14} />} disabled={loading} onClick={() => { void refresh(); void refreshEarly(); receipts.filter(row => row.status === "pending").forEach(row => { void refreshReceipt(row); }); }}>刷新</Button>{canWrite && <Button variant="primary" disabledReason={skuReadBlock || (edit ? "请先完成当前商品草稿" : undefined)} onClick={() => openSku()}>+ 新增商品</Button>}</>} />
    {!canRead ? <BlockState state="denied" title="没有商品目录读取权限" /> : <>
      {receipt && error && <Notice tone="warn" title="申请已提交，目录暂时读不到"><p>{receipt.obj} · 审批单 {receipt.id}</p></Notice>}
      <RecoveryPanel tone={recovery.every(item => item.key.startsWith("receipt:")) ? "progress" : "warn"} title={recoveryTitle(recovery.filter(item => !item.key.startsWith("receipt:")).length, recovery.filter(item => item.key.startsWith("receipt:")).length)}
        explain="有结论前，这些对象不能提交新修改。点行首的箭头看提交时间、说明和原请求。" foot={canOpenAudit ? <Link className="rd-link" href="/platform/audit">到操作记录与审批核对</Link> : undefined} items={recovery} />
      <E1Catalog ctx={ctx} />
    </>}
    <E1Editor request={edit} gates={gates} currentPhaseId={currentPhase.phaseId} writable={skuWritesReady} writeBlockedReason={skuReadBlock} currentSku={currentSku} onClose={() => { setEdit(null); setSkuConflict(null); }} busy={!!busy} toast={toast} onMediaChange={key => { setMediaSending(key ?? ""); syncPending(); }} onRevisionAccepted={() => { setSkuConflict(null); setAttemptKey(""); }} onReview={review => { setAttemptKey(""); setConfirmation({ ...review, briefKind: "config", name: `${review.beforeSku ? "编辑" : "新增"}商品 · ${review.sku.name}`, op: "sku-save", gates, isNew: !review.beforeSku }); }} />
    {mc && <OperationConfirmModal action={mc.name} title={mc.title ?? mc.name.split(" · ")[0]} briefKind={mc.briefKind} detail={mc.detail ?? "核对完整变更，批准后生效。"} edit={mc.edit} businessForm={mc.businessForm?.kind === "multi-field" ? { ...mc.businessForm, onFieldChange: (key, next) => { const value = mc.businessForm?.kind === "multi-field" && mc.businessForm.onFieldChange ? mc.businessForm.onFieldChange(key, next) : next; setBusinessValues(value); setRefused(null); return value; } } : mc.businessForm}
      amplifies={!!mc.amplify} reasonMin={8} reasonMax={200} completionCopy={APPROVAL} confirmLabel="提交审批" confirmTone={["sku-delete", "phase-archive", "generation-gate-archive"].includes(mc.op) ? "danger" : "primary"}
      effect={<StatusTag tone="progress" filled explain={APPROVAL}>批准后生效</StatusTag>}
      statedBrief={{ impact: mc.detail ?? (mc.isNew ? "批准后创建商品草稿；上架仍须满足购买与开放条件。" : "批准后保存本次商品资料、购买条件和任务配置；售价供之后购买读取，已冻结任务不重算。"), check: "核对对象、完整前后值及操作理由。" }}
      facts={mc.sku ? <Facts>{seriesChange && <Fact k="所属系列"><Change from={seriesChange.before} to={seriesChange.after} /></Fact>}<Fact k="售价" lead={!seriesChange} unit="USD">{e1Decimal(mc.sku.price)}</Fact><Fact k="商品">{mc.sku.name}</Fact><Fact k="任务等级">{mc.sku.allowedPoolCodes?.join("、") || "未配置"}</Fact><Fact k="月收益目标">{mc.sku.monthlyTargetUsdt == null ? "未设月收益目标" : `${e1Decimal(mc.sku.monthlyTargetUsdt, e1TargetPrecision(mc.sku))} USDT/月 · ±${e1Number(mc.sku.monthlyTargetBandPct)} %`}</Fact><Fact k="托管机房">{mc.sku.datacenter?.trim() ? `按托管机房清单分配（原填 ${datacenterNameText(mc.sku.datacenter)}）` : "按托管机房清单分配"}</Fact>{mc.op === "sku-status" && <><Fact k="状态"><Change from={e1Value(mc.sku.status)} to={e1Value(mc.status)} /></Fact><Fact k="库存">{mc.sku.inventoryMode === "UNLIMITED" ? "不限（非实物）" : e1Number(mc.sku.stock)}</Fact></>}{mc.op === "sku-delete" && <Fact k="当前状态">{e1Value(mc.sku.status)}</Fact>}</Facts> : mc.facts}
      content={skuDiff ? !mc.beforeSku ? <Fold inset title="完整商品资料" summary={`已填 ${skuFilled.length} 项${skuDiff.length > skuFilled.length ? `，其余 ${skuDiff.length - skuFilled.length} 项未设置` : ""}`}><Facts>{skuFilled.map(row => <Fact key={row.key} k={row.label}>{row.after}</Fact>)}</Facts></Fold>
        : seriesChange ? <Fold inset title="其余设置" summary={`${skuDiff.filter(row => !SERIES_ONLY_SHOWN.includes(row.key)).length} 项不变`}><Facts>{skuDiff.filter(row => !SERIES_ONLY_SHOWN.includes(row.key)).map(row => <Fact key={row.key} k={row.label}>{row.after}</Fact>)}</Facts></Fold>
        : skuChanges.length > 4
        ? <>{skuChanges.some(row => E1_DECISION_KEYS.includes(row.key)) && <Facts>{skuChanges.filter(row => E1_DECISION_KEYS.includes(row.key)).map(row => <Fact key={row.key} k={row.label}><Change from={row.before ?? ""} to={row.after ?? ""} /></Fact>)}</Facts>}<Fold inset title="完整商品变更" summary={`${skuChanges.length} 项改动`}><DiffList rows={skuDiff} /></Fold></>
        : <DiffList rows={skuDiff} /> : <>{mc.businessForm?.kind === "multi-field" && (mc.op === "bundle-discount" || mc.op === "early-access" || mc.op === "generation-gate-save" && !!mc.generationGateId || mc.op === "phase-save" && !!mc.phaseId) && <Facts>{mc.businessForm.fields.map(f => <Fact key={f.key} k={f.label}><Change from={f.optionLabels?.[f.current ?? ""] ?? (f.current || "未设置")} to={(f.optionLabels?.[businessValues[f.key] ?? f.current ?? ""] ?? (businessValues[f.key] ?? f.current)) || "未填写"} /></Fact>)}</Facts>}{mc.content}</>}
      blockedReason={currentPending && currentPending.commandKey !== busy ? "这个对象有一次结果未知的提交，先在页面上方查询原结果" : (reviewingSku ? hasSkuVersionConflict(mc) : conflict) ? <>
        <ConflictBar message="商品或配置已被别人改过，你填的内容还在；读取最新后重新核对。" onRead={readConflict} />
        {conflictRead && <Notice tone="warn" title="核对别人改了什么，再决定是否保留你的修改">
          {mc.op === "bundle-discount" && conflictLatest ? <DiffList rows={[{ key: "two", label: "2件折扣", before: `${mc.discount?.twoItemsPct}%`, after: `${conflictLatest.bundleDiscount.twoItemsPct}%` }, { key: "three", label: "3件折扣", before: `${mc.discount?.threeItemsPct}%`, after: `${conflictLatest.bundleDiscount.threeItemsPct}%` }, { key: "four", label: "4+件折扣", before: `${mc.discount?.fourPlusItemsPct}%`, after: `${conflictLatest.bundleDiscount.fourPlusItemsPct}%` }]} /> : mc.sku && latestConflictSku ? <DiffList rows={e1ShownDiff(e1SkuDiff(mc.beforeSku ?? mc.sku, latestConflictSku), mc.beforeSku ?? mc.sku, latestConflictSku)} /> : <p>原对象未读取到，请保留草稿并核查。</p>}
          <Button disabledReason={canAcceptRevision ? undefined : "原对象未读取到"} onClick={acceptConflictRevision}>已核对，保留我的修改</Button>
        </Notice>}
      </> : refused?.on === mc ? <span className="rd-toolbar"><span>{refused.text}</span><Button size="sm" icon={<RotateCcw size={14} aria-hidden />} onClick={() => { setRefused(null); if (reviewingSku) setConfirmation(null); }}>返回修改</Button></span>
      : !canWrite ? "当前不能提交，请先核对权限和读取状态" : readBlock(mc, businessValues)}
      onClose={() => setConfirmation(null)} onConfirm={async (...args) => {
        try { await confirm(...args); } catch (failure) {
          const response = failure as { httpStatus?: number; apiCode?: number };
          if (!isA2OutcomeUncertainError(failure) && response.httpStatus !== undefined && isDeterministicRejection(response.httpStatus, response.apiCode)) setRefused({ on: mc, text: operationConfirmErrorMessage(failure) });
          throw failure;
        }
      }} />}
    {receiptDetail && <Drawer open title="商品变更审批" sub={receiptDetail.obj} onClose={() => setReceiptDetailId(null)} footer={<div className="e1-receipt-actions"><Button disabled={receiptDetail.reading} onClick={() => { void refreshReceipt(receiptDetail); }}>{receiptDetail.reading ? "正在读取…" : "重新读取审批状态"}</Button><Button onClick={() => setReceiptDetailId(null)}>关闭</Button>{canOpenAudit && <Link className="rd-link" href="/platform/audit">操作记录与审批</Link>}</div>}><Facts><Fact k="审批单号">{receiptDetail.id}</Fact><Fact k="状态">{RECEIPT_STATUS[receiptDetail.status] ?? "状态待核实"}</Fact><Fact k="操作">{receiptDetail.action}</Fact><Fact k="原值">{receiptDetail.before}</Fact><Fact k="新值">{receiptDetail.after}</Fact><Fact k="原理由">{receiptDetail.reason}</Fact></Facts>{receiptDetail.readError && <Notice tone="warn" title="审批状态暂时读不到"><p>{receiptDetail.readError}；{receiptDetail.status === "pending" ? "对象锁保留，可重新读取。" : "保留已核对的审批结果，可重新读取。"}</p></Notice>}<p>{receiptDetail.status === "pending" ? APPROVAL : "审批已结束，这张审批单不再锁住商品；请按现在的目录重新核对后编辑。"}</p></Drawer>}
    {release && (isRetryExpired(release)
      ? <MissingProposalReleaseModal label={release.spec.action} createdAt={release.createdAt} onCancel={() => setRelease(null)} onConfirm={async () => { const released = await releaseMissing(release); setRelease(null); if (released) toast("已解除这条记录，可以重新提交", "success"); else if (released === false) toast("查到了这张审批单，没有解除", "warn"); }} />
      : <ReleaseModal label={release.spec.action} onCancel={() => setRelease(null)} onConfirm={() => { forgetE1(release); syncPending(); setRelease(null); toast("已解除这条记录", "success"); }} />)}
    {toastNode}
  </RdPage>;
}
