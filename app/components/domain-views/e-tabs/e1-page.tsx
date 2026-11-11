"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { BlockState, Button, Change, ConflictBar, DiffList, Facts, Fact, Fold, Notice, Drawer, PageHeader, RdPage, ReleaseModal, StatusTag } from "@/app/components/rd";
import { OperationConfirmModal, useToast } from "../design-kit";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { businessClock } from "@/lib/admin/business-time";
import { fetchE1Products, fetchE1GenerationGates, fetchE1Discount, type E1CatalogSnapshot, type E1BundleDiscount, type E1GenerationGateData, type E1InvalidSku } from "@/lib/admin/e1-client";
import { fetchE3Snapshot } from "@/lib/admin/e3-client";
import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { roleLabel } from "@/lib/nav/console-nav";
import { useReach } from "@/lib/nav/use-reach";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import type { ProposeSpec } from "@/lib/admin/propose-or-execute";
import type { OpsSku } from "@/lib/admin/platform-types";
import type { McSpec } from "./types";
import type { SkuForm } from "./data";
import { E1Catalog, type E1CatalogContext } from "./e1-catalog";
import { E1Editor, type E1EditRequest } from "./e1-editor";
import { e1Commands, e1MonthlyCommands, e1Pending, forgetE1, e1LegacyCommands, e1LegacyObject, e1MediaCommands, e1Number, e1Decimal, e1TargetPrecision, e1Object, e1SkuDiff, e1Value, type E1Pending, type E1Legacy, type E1MediaPending } from "./e1-state";

type Confirmation = McSpec & { sku?: OpsSku; beforeSku?: OpsSku; form?: SkuForm; gates?: E1GenerationGateData | null; discount?: E1BundleDiscount | null; early?: Record<string, string> };
const APPROVAL = "由另一位有批准及商品业务权限的管理员批准。批准前目录不变。";

function e1Error(error: unknown) {
  if (isA2OutcomeUncertainError(error)) return "提交结果未确认。原对象、内容、理由和命令号已保留，请在本页按原操作重试或读回核对。";
  const value = error as { backendMessage?: string; message?: string } | null;
  const code = value?.backendMessage ?? value?.message ?? "";
  if (code.includes("TASK_POOL_FORMAT_RETIRED")) return "原商品操作使用旧任务格式，请先核对原申请，再从商品管理与上架条件重新配置任务等级。";
  if (code.startsWith("IDEMPOTENCY_")) return "原命令状态仍需核查，请保留原请求和命令号；不要换号重发。";
  return displayAdminError(error);
}

export function E1Page() {
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
  const [receipts, setReceipts] = useState<(ProposeSpec & { id: string; object: string; status: string })[]>([]);
  const [receiptDetail, setReceiptDetail] = useState<(typeof receipts)[number] | null>(null);
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
  const [release, setRelease] = useState<E1Pending | null>(null);
  const [conflict, setConflict] = useState(false);
  const [conflictLatest, setConflictLatest] = useState<E1CatalogSnapshot | null>(null);
  const [attemptKey, setAttemptKey] = useState("");
  const syncPending = useCallback(() => { setPending(e1Pending(actor)); setLegacy(e1LegacyCommands(actor)); setMedia(e1MediaCommands.list().filter(r => r.actorId === actor)); }, [actor]);
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
  const readBlock = loading || error ? "商品目录读取成功前不能提交修改" : gatesLoading || gatesError || !gates ? "开放阶段读取成功前不能提交修改" : discountLoading || discountError || !discount ? "组合购折扣读取成功前不能提交修改" : !earlyReady ? "抢先购关联设置读取成功前不能提交修改" : undefined;
  const writesReady = canWrite && !readBlock;
  const locked = (type: string, id: string) => pending.some(r => e1Object(r.spec) === `${type}|${id}`)
    || legacy.some(r => e1LegacyObject(r) === `${type}|${id}`)
    || receipts.some(r => r.status === "pending" && r.object === `${type}|${id}`);

  const openSku = (skuId?: string, unlock?: string) => {
    if (!writesReady || skuId && locked("device_sku", skuId)) return;
    if (edit) { toast("请先完成或关闭正在编辑的商品草稿"); return; }
    setEdit({ sku: skuId ? skus.find(s => s.id === skuId) : undefined, unlock, nonce: Date.now() });
  };
  const openConfirm = (input: McSpec) => {
    if (!writesReady) return;
    setConflict(false); setConflictLatest(null); setAttemptKey("");
    setBusinessValues(input.businessForm?.kind === "multi-field" ? Object.fromEntries(input.businessForm.fields.map(f => [f.key, f.current ?? ""])) : {});
    setConfirmation({ ...input, sku: skus.find(s => s.id === input.target), gates, discount, early: { ...early } });
  };
  const send = async (record: E1Pending, retry: boolean) => {
    if (!canWrite || !actor || record.actorId !== actor || sending.current) throw new Error("账号、权限或提交状态不允许重试，请先核对原操作");
    if (isRetryExpired(record)) throw new Error(RETRY_EXPIRED_TEXT);
    const store = record.fingerprint.startsWith("sku|") ? e1MonthlyCommands : e1Commands;
    store.remember(record.fingerprint, record.commandKey, { actorId: record.actorId, spec: record.spec });
    if (!store.isDurablyStored(record.fingerprint, record.commandKey)) throw new Error("浏览器无法保存原操作，本次没有发送；原记录和对象锁仍保留。");
    sending.current = true; setBusy(record.commandKey); setRejected(keys => keys.filter(k => k !== record.commandKey));
    try {
      const spec = record.spec;
      const result = await createA2OperationProposal({ action: spec.action, obj: spec.obj, beforeValue: spec.before, afterValue: spec.after,
        operator: session?.operator || session?.username || "", operatorRole: roleLabel(session!.role), type: spec.type,
        amplifies: !!spec.amplifies, sos: !!spec.sos, roleGate: spec.gateLabel, reason: spec.reason, sourceDomain: spec.sourceDomain,
        command: spec.command, target: spec.target, targets: spec.targets,
      }, record.commandKey, true);
      forgetE1(record); toast(`已提交，等待审批后执行 · 审批单 ${result.id}`);
      setReceipts(rows => [...rows.filter(row => row.object !== e1Object(spec)), { ...spec, id: result.id, object: e1Object(spec), status: result.status }]);
      setConfirmation(null); if (record.spec.command.op === "e1_sku_create" || record.spec.command.op === "e1_sku_update") setEdit(null);
      const latest = await refresh();
      if (!latest) toast("申请已提交，部分目录或关联设置未读取完整");
    } catch (failure) {
      if (!retry && isExplicitRejection(failure) && !isA2OutcomeUncertainError(failure)) forgetE1(record);
      else if (retry && isExplicitRejection(failure)) setRejected(keys => [...keys, record.commandKey]);
      setNotes(n => ({ ...n, [record.commandKey]: e1Error(failure) }));
      if (!isExplicitRejection(failure)) { setConfirmation(null); setEdit(null); }
      if (String((failure as Error).message).includes("VERSION_CONFLICT") || String((failure as { backendMessage?: string }).backendMessage).includes("VERSION_CONFLICT")) setConflict(true);
      // Throw the original error so OperationConfirmModal keeps reason and fields.
      if (retry) toast(e1Error(failure));
      throw failure;
    } finally { sending.current = false; setBusy(""); syncPending(); }
  };
  const submit = async (spec: ProposeSpec) => {
    if (!writesReady || !actor || sending.current) throw new Error("目录未读取完整、正在提交或账号没有提交权限，本次没有提交");
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
  const check = async (record: { commandKey: string }) => {
    try {
      const row = await fetchA2ProposalByKey(record.commandKey, true);
      if (!row) { setNotes(n => ({ ...n, [record.commandKey]: "没有查到原审批单，不能据此认定没有提交；请保留原记录核对。" })); return; }
      setNotes(n => ({ ...n, [record.commandKey]: `原审批单 ${row.id} · ${{ pending: "待审批", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" }[row.status] ?? "状态待核实"}` }));
      toast(`已找到原审批单 ${row.id}，原操作已有回执`);
      const full = e1Pending(actor).find(r => r.commandKey === record.commandKey);
      if (full) {
        const spec = full.spec;
        setReceipts(rows => [...rows.filter(receipt => receipt.object !== e1Object(spec)), { ...spec, id: row.id, object: e1Object(spec), status: row.status }]);
        forgetE1(full); syncPending();
      }
    } catch (failure) { setNotes(n => ({ ...n, [record.commandKey]: e1Error(failure) })); }
  };

  const confirm = async (reason: string, value?: string, business?: Record<string, string>) => {
    const mc = confirmation;
    if (!mc || !writesReady) throw new Error("当前不能提交，请保留输入并刷新目录核对");
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
  const skuDiff = mc?.op === "sku-save" && mc.sku ? e1SkuDiff(mc.beforeSku, mc.sku, mc.form) : null;
  const currentPending = mc ? pending.find(r => r.commandKey === attemptKey || (mc.sku ? e1Object(r.spec) === `device_sku|${mc.sku.id}` : mc.generationGateId ? e1Object(r.spec) === `device_generation_gate|${mc.generationGateId}` : mc.phaseId ? e1Object(r.spec) === `device_phase|${mc.phaseId}` : mc.op === "bundle-discount" ? e1Object(r.spec) === "store_bundle_discount|canonical" : mc.op === "early-access" ? e1Object(r.spec) === "device_release_early_access|trade-in" : false)) : undefined;
  const ctx: E1CatalogContext = {
    skus, canWriteE1: canWrite, e1InvalidSkus: invalid, e1Loading: loading, e1Error: error, e1Gates: gates, e1BundleDiscount: discount, phaseCur: gates?.phaseCurrent ?? "", refreshE1: async () => { await refresh(); },
    pE: k => early[k] ?? "—", earlyReady, earlyLoading, earlyError, refreshEarly: () => void refreshEarly(),
    gatesLoading, gatesError, discountLoading, discountError, refreshGates: () => void refreshGates(), refreshDiscount: () => void refreshDiscount(), writeBlockedReason: readBlock,
    pendingProposal: id => receipts.find(row => row.status === "pending" && ["device_sku", "device_generation_gate"].some(type => row.object === `${type}|${id}`)),
    openPending: id => setReceiptDetail(receipts.find(row => row.id === id) ?? null),
    forceUnlock, forceLock, locked, openSku, openActionConfirm: openConfirm, toast,
    delSku: (id, name) => openConfirm({ briefKind: "config", name: `删除商品 · ${name}`, op: "sku-delete", target: id, detail: "从商城移除后用户无法再购买，已售设备和原订单不受影响。", businessForm: { kind: "destructive-reason", target: name, impact: "从商城移除，用户无法再购买；已售设备和原订单不受影响。" } }),
  };
  return <RdPage className="e1-page">
    <PageHeader pageId="E1" title="商品管理与上架条件" meta={!canRead ? "未读取目录" : error ? "目录读取失败" : readAt ? `${readAt} 读取 · 手动刷新` : "正在读取目录"} readOnly={!canWrite ? "当前账号只读" : undefined} actions={<><Button icon={<RefreshCw size={14} />} disabled={loading} onClick={() => { void refresh(); void refreshEarly(); }}>刷新</Button>{canWrite && <Button variant="primary" disabledReason={!writesReady ? "请先读取完整目录" : edit ? "请先完成当前商品草稿" : undefined} onClick={() => openSku()}>+ 新增商品</Button>}</>} />
    {!canRead ? <BlockState state="denied" title="没有商品目录读取权限" /> : <>
      {receipt && error && <Notice tone="warn" title="申请已提交，目录暂时读不到"><p>{receipt.obj} · 审批单 {receipt.id}</p></Notice>}
      {pending.filter(record => record.commandKey !== busy).map(record => <Notice key={record.commandKey} tone="warn" title="结果未确认" actionBelow action={<>
        <Button disabledReason={!canWrite ? "当前账号不能重试" : busy ? "正在提交原操作" : isRetryExpired(record) ? RETRY_EXPIRED_TEXT : undefined} onClick={() => { void send(record, true).catch(failure => toast(e1Error(failure))); }}>按原操作重试</Button>
        {canQuery && <Button disabled={!!busy} onClick={() => void check(record)}>读回核对</Button>}
        {rejected.includes(record.commandKey) && !isRetryExpired(record) && <Button disabled={!!busy} onClick={() => setRelease(record)}>解除待确认</Button>}
        {canOpenAudit && <Link className="rd-link" href="/platform/audit">操作记录与审批</Link>}
      </>}>
        <p><strong>{record.spec.obj}</strong> · {record.spec.action}</p>
        <p>{isRetryExpired(record) ? RETRY_EXPIRED_TEXT : "原对象、内容、理由和命令号已保留；此对象暂停新修改，只能原样重试。"}</p>
        {!canOpenAudit && <p>可复制原命令号，请有权查看操作记录与审批的管理员核对。</p>}
        {notes[record.commandKey] && <p role="status">{notes[record.commandKey]}</p>}
        <Fold inset title="原操作与技术信息" summary={`${businessClock(record.createdAt)} · ${record.commandKey}`}><Facts><Fact k="原对象">{record.spec.obj}</Fact><Fact k="原操作">{record.spec.action}</Fact><Fact k="原理由">{record.spec.reason}</Fact><Fact k="命令号">{record.commandKey}</Fact></Facts><p>完整参数、原版本和理由随原操作保存，可复制后逐项核对。</p><div className="e1-table-actions"><Button size="sm" onClick={() => { void navigator.clipboard.writeText(JSON.stringify(record.spec, null, 2)).then(() => toast("已复制完整原操作"), () => toast("复制失败，请保留原命令号核对")); }}>复制完整原操作</Button><Button size="sm" onClick={() => { void navigator.clipboard.writeText(record.commandKey).then(() => toast("已复制命令号"), () => toast("复制失败，请选择命令号")); }}>复制命令号</Button></div></Fold>
      </Notice>)}
      {legacy.map(record => <Notice key={record.commandKey} tone="warn" title="旧商品操作结果未确认 · 缺完整原请求" action={canQuery && <Button onClick={() => void check(record)}>读回核对</Button>}><p><strong>{e1LegacyObject(record).split("|").slice(1).join("|") || "原对象未保留"}</strong></p><p>升级前记录缺少原理由，不能重试或解除；请保留原号，到操作记录与审批核对。</p><Fold inset title="旧记录技术信息" summary={record.commandKey}><Facts><Fact k="原对象">{e1LegacyObject(record).split("|").slice(1).join("|")}</Fact><Fact k="原命令号">{record.commandKey}</Fact><Fact k="原提交时间">{businessClock(record.createdAt)}</Fact></Facts><p>旧记录没有完整原请求和理由，只能核对原操作。</p><Button size="sm" onClick={() => { void navigator.clipboard.writeText(JSON.stringify(record, null, 2)).then(() => toast("已复制完整旧记录"), () => toast("复制失败，请保留原命令号核对")); }}>复制完整旧记录</Button></Fold>{notes[record.commandKey] && <p>{notes[record.commandKey]}</p>}</Notice>)}
      {media.filter(record => record.commandKey !== mediaSending).map(record => <Notice key={record.commandKey} tone="warn" title={`${record.fileName} · 媒体上传结果未确认`} action={<Button onClick={() => openSku(record.skuId || undefined)}>核对媒体上传</Button>}><p>{isRetryExpired(record) ? RETRY_EXPIRED_TEXT : "原文件摘要和命令号已保留；重新打开商品选择同一文件后可原样重试。"}</p></Notice>)}
      <E1Catalog ctx={ctx} />
    </>}
    <E1Editor request={edit} gates={gates} writable={writesReady} writeBlockedReason={readBlock} currentSku={edit?.sku ? skus.find(s => s.id === edit.sku!.id) : undefined} onClose={() => setEdit(null)} busy={!!busy} toast={toast} onMediaChange={key => { setMediaSending(key ?? ""); syncPending(); }} onReview={(sku, beforeSku, form) => { setConflict(false); setConflictLatest(null); setAttemptKey(""); setConfirmation({ briefKind: "config", name: `${beforeSku ? "编辑" : "新增"}商品 · ${sku.name}`, op: "sku-save", sku, beforeSku, form, gates, isNew: !beforeSku }); }} />
    {mc && <OperationConfirmModal action={mc.name} title={mc.title ?? mc.name.split(" · ")[0]} briefKind={mc.briefKind} detail={mc.detail ?? "核对完整变更，批准后生效。"} edit={mc.edit} businessForm={mc.businessForm?.kind === "multi-field" ? { ...mc.businessForm, onFieldChange: (key, next) => { const value = mc.businessForm?.kind === "multi-field" && mc.businessForm.onFieldChange ? mc.businessForm.onFieldChange(key, next) : next; setBusinessValues(value); return value; } } : mc.businessForm}
      amplifies={!!mc.amplify} reasonMin={8} reasonMax={200} completionCopy={mc.detail ?? APPROVAL} confirmLabel="提交审批" confirmTone={["sku-delete", "phase-archive", "generation-gate-archive"].includes(mc.op) ? "danger" : "primary"}
      effect={<StatusTag tone="progress" filled explain={APPROVAL}>批准后生效</StatusTag>}
      statedBrief={{ impact: mc.detail ?? "商品变更经另一位有权限的管理员批准后执行。", check: "核对对象、完整前后值及操作理由。" }}
      facts={mc.sku ? <Facts><Fact k="售价" lead unit="USD">{e1Decimal(mc.sku.price)}</Fact><Fact k="商品">{mc.sku.name}</Fact><Fact k="任务等级">{mc.sku.allowedPoolCodes?.join("、") || "未配置"}</Fact><Fact k="月收益目标">{mc.sku.monthlyTargetUsdt == null ? "未设月收益目标" : `${e1Decimal(mc.sku.monthlyTargetUsdt, e1TargetPrecision(mc.sku))} USDT/月 · ±${e1Number(mc.sku.monthlyTargetBandPct)} %`}</Fact><Fact k="托管机房">{mc.sku.datacenter || "— · 未填写"}</Fact>{mc.op === "sku-status" && <><Fact k="状态"><Change from={e1Value(mc.sku.status)} to={e1Value(mc.status)} /></Fact><Fact k="库存">{mc.sku.inventoryMode === "UNLIMITED" ? "不限（非实物）" : e1Number(mc.sku.stock)}</Fact></>}{mc.op === "sku-delete" && <Fact k="当前状态">{e1Value(mc.sku.status)}</Fact>}</Facts> : mc.facts}
      content={skuDiff ? !mc.beforeSku || skuDiff.filter(row => row.before !== row.after).length > 4
        ? <Fold inset title="完整商品变更" summary="展开核对所有字段的前后值"><DiffList rows={skuDiff} /></Fold>
        : <DiffList rows={skuDiff} /> : <>{mc.businessForm?.kind === "multi-field" && (mc.op === "bundle-discount" || mc.op === "early-access" || mc.op === "generation-gate-save" && !!mc.generationGateId || mc.op === "phase-save" && !!mc.phaseId) && <Facts>{mc.businessForm.fields.map(f => <Fact key={f.key} k={f.label}><Change from={f.optionLabels?.[f.current ?? ""] ?? (f.current || "未设置")} to={(f.optionLabels?.[businessValues[f.key] ?? f.current ?? ""] ?? (businessValues[f.key] ?? f.current)) || "未填写"} /></Fact>)}</Facts>}{mc.content}</>}
      blockedReason={currentPending && currentPending.commandKey !== busy ? "提交结果未确认，原操作已保留，请在本页按原操作重试或读回核对" : conflict ? <>
        <ConflictBar message="商品或配置版本已变化，本地输入保留；读取最新后请重新核对。" onRead={async () => { const snapshot = await refresh(); if (!snapshot) throw new Error("目录暂时读不到"); setConflictLatest(snapshot); }} />
        {conflictLatest && <Notice tone="warn" title="请核对最新值，再决定是否沿用本地输入">
          {mc.op === "bundle-discount" ? <DiffList rows={[{ key: "two", label: "2件折扣", before: `${mc.discount?.twoItemsPct}%`, after: `${conflictLatest.bundleDiscount.twoItemsPct}%` }, { key: "three", label: "3件折扣", before: `${mc.discount?.threeItemsPct}%`, after: `${conflictLatest.bundleDiscount.threeItemsPct}%` }, { key: "four", label: "4+件折扣", before: `${mc.discount?.fourPlusItemsPct}%`, after: `${conflictLatest.bundleDiscount.fourPlusItemsPct}%` }]} /> : mc.sku && conflictLatest.skus.find(s => s.id === mc.sku!.id) ? <DiffList rows={e1SkuDiff(mc.beforeSku ?? mc.sku, conflictLatest.skus.find(s => s.id === mc.sku!.id)!)} /> : <p>原对象未读取到，请保留草稿并核查。</p>}
          <Button disabledReason={mc.sku && !conflictLatest.skus.some(s => s.id === mc.sku!.id) ? "原对象未读取到" : undefined} onClick={() => {
            const latestSku = conflictLatest.skus.find(s => s.id === mc.sku?.id);
            setConfirmation(c => c ? { ...c, discount: conflictLatest.bundleDiscount, gates: conflictLatest.gates, beforeSku: c.op === "sku-save" ? latestSku : c.beforeSku, sku: c.sku && latestSku ? c.op === "sku-save" ? { ...c.sku, updatedAt: latestSku.updatedAt } : latestSku : c.sku } : c);
            setConflict(false); setConflictLatest(null); setAttemptKey("");
          }}>已核对，保留输入并采用此修订</Button>
        </Notice>}
      </> : !writesReady ? "当前不能提交，请先核对权限和读取状态" : undefined}
      onClose={() => setConfirmation(null)} onConfirm={confirm} />}
    {receiptDetail && <Drawer open title="商品变更待审批" sub={receiptDetail.obj} onClose={() => setReceiptDetail(null)} footer={<><Button onClick={() => setReceiptDetail(null)}>关闭</Button>{canOpenAudit && <Link className="rd-link" href="/platform/audit">操作记录与审批</Link>}</>}><Facts><Fact k="审批单号">{receiptDetail.id}</Fact><Fact k="状态">待审批</Fact><Fact k="操作">{receiptDetail.action}</Fact><Fact k="原值">{receiptDetail.before}</Fact><Fact k="新值">{receiptDetail.after}</Fact><Fact k="原理由">{receiptDetail.reason}</Fact></Facts><p>{APPROVAL}</p></Drawer>}
    {release && <ReleaseModal label={`${release.spec.obj} · ${release.spec.action}`} onCancel={() => setRelease(null)} onConfirm={() => { forgetE1(release); syncPending(); setRelease(null); }} />}
    {toastNode}
  </RdPage>;
}
