"use client";

/**
 * E 设备与商城 — 设计稿 design_handoff_e_domain 内容视图。
 * 全系统统一连续编号 E1-E5:E1 商品目录&上架门 / E2 任务池 /
 * E3 生命周期&Trade-in / E4 订单进度 / E5 设备管理。
 * nav id == 视图 key == prdAnchor == PRD §10 章节(已全部重编号统一,FOLD 现为恒等映射)。
 *
 * 本 shell 持有全部共享 store 接线 + SKU / 任务 / 订单详情抽屉 + OperationConfirmModal;
 * 各 tab 视觉/布局拆到 e-tabs/*(复用 design-kit 原语 + e-domain.css 设计类),经 EViewCtx 注入派生读 + 回调。
 * 真写落点:E1 SKU/上架门、E6 手机任务与收益、E3 生命周期&Trade-in、E4 订单进度、E5 设备管理走后端 API。
 * 操作确认 显式 edit 契约:调参(param / task-price)传 edit{kind,current,unit};处置/纯动作(sku-status / param-fixed / order-*)不传 edit。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Icon, Btn, Chip, Drawer, KV, OperationConfirmModal, useToast } from "./design-kit";
import { RdPage, ReleaseModal } from "@/app/components/rd";
import { businessClock } from "@/lib/admin/business-time";
import { createPendingMutationStore, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { AutoGloss } from "@/app/components/kit/gloss";
import { displayAdminError } from "@/lib/admin/error-messages";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { supportsDeviceMonthlyTarget, SKU_MODEL_UNRECOGNIZED_REASON } from "@/lib/admin/device-monthly-target";
import { monthlyTargetEstimateText } from "@/lib/admin/operator-copy";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { OpsSku, OpsTask } from "@/lib/admin/platform-types";
import { TASK_CLASSES, TASK_CLASS_LABELS } from "@/lib/admin/task-classes";
import { fetchTaskPools, fetchSkuDatacenterLabels, type TaskPool } from "@/lib/admin/task-pool-client";
import { OpsHint } from "./e-tabs/ops-hint";
import {
  fetchE1Catalog,
  type E1BundleDiscount,
  type E1GenerationGateData,
  type E1InvalidSku,
} from "@/lib/admin/e1-client";
import { fetchE2PhoneTiers, fetchE2Tasks, type E2PhoneTier, type E2YieldComparison } from "@/lib/admin/e2-client";
import { fetchE3Snapshot, type E3OperationMetric, type E3Stats } from "@/lib/admin/e3-client";
import { E4_CLOSE_REASONS, E4_REFUND_REASONS, fetchE4OrderDetail, fetchE4OrderGroupPage, fetchE4OrderPage, type E4OrderDetail } from "@/lib/admin/e4-client";
import {
  fetchE5Devices,
  fetchE5Overview,
  activateE5Device,
  deactivateE5Device,
  setE5UserDevicesPaused,
  type E5Device,
  type E5Overview,
} from "@/lib/admin/e5-client";
import { fetchE6ComputeConfig, isE6ParamKey, type E6ComputeConfigView } from "@/lib/admin/e6-client";
import { usePropose } from "@/lib/admin/use-propose";
import { createA2CommandKey, fetchA2ProposalByKey, isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import type { ProposeSpec } from "@/lib/admin/propose-or-execute";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { summarizeSkuCreation, summarizeSkuProposal } from "@/lib/admin/e1-a2-proposal-summary";
import { refreshAdminMediaPreviewUrl, uploadAdminMedia } from "@/lib/admin/media-client";
import {
  E4_DEFAULT_QUERY, FOLD, ORDER_STATES, e4GroupStates, e4QueryFromUrl, writeE4QueryToUrl, type E4Query,
  EMPTY_SKU_FORM, type SkuForm, skuToForm, formToSku, formToGate, gateRemaining, validateGateForm, validateSkuSpecs, skuNum, stateLabel,
} from "./e-tabs/data";
import type { E4PendingCommand, Mc, EOp, EViewCtx, EOrder } from "./e-tabs/types";
import { DevicePoolChoices, FIXED_DEVICE_LEVELS } from "./e-tabs/task-type-policy";
import { E1Page } from "./e-tabs/e1-page";
import { E2Tasks } from "./e-tabs/e2-tasks";
import { E3Lifecycle } from "./e-tabs/e3-lifecycle";
import { E3Manual } from "./e-tabs/e3-manual";
import { E4Orders } from "./e-tabs/e4-orders";
import { E5Ops } from "./e-tabs/e5-ops";
import { E6ComputeConfig as E6ComputeConfigComp } from "./e-tabs/e6-compute-config";
import "./e-domain.css";

/** E 域 A2 提交稳定命令号:槽位=动作 op|目标对象,指纹=终值+结构化命令+目标锁(**不含 reason**)。
 *  落 sessionStorage,结果未知后哪怕刷新页面,同弹窗同业务输入重试仍复用同一命令号被后端去重。 */
const commandAttempts = createSlotAttemptStore({ storageKey: "nexion-admin-e-domain-commands-v1" });
const E4_APPROVAL_OPS = ["e4_order_refund", "e4_order_cancel", "e4_order_terminal", "e4_order_state"];
const E4_PROPOSAL_STATUS: Record<string, string> = { pending: "待审批", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" };

/** E4 四个提案走这张表：一单一条，结果未知时原内容、理由和命令号留到有结论（OP-92～OP-95）。坏记录不能当原操作重发。 */
const e4PendingCommands = createPendingMutationStore<E4PendingCommand>({
  storageKey: "nexion-admin-e4-order-commands-v1",
  // 过了 24 小时不能再用原号重试，但记录和这单的锁都留着，到操作记录核对（OP-96）。
  retainExpiredRecords: true,
  isValidRecord: (record) => typeof record.orderNo === "string" && typeof record.label === "string"
    && record.fingerprint === `order|${record.orderNo}`
    && record.spec?.obj === record.orderNo && typeof record.spec.reason === "string" && !!record.spec.command,
});


const E2_TASK_MUTATION_OPS = new Set<EOp>(["task-create", "task-save", "task-status"]);
const E2_CONFIG_MUTATION_OPS = new Set<EOp>(["phone-tier", "yield-comparison"]);

function isE2TaskMutation(op: EOp) {
  return E2_TASK_MUTATION_OPS.has(op);
}

function isE2ConfigMutation(op: EOp) {
  return E2_CONFIG_MUTATION_OPS.has(op);
}

function normalizePositiveDecimal18x6(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(normalized)) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric > 0 ? normalized : null;
}

function SkuFld({ label, value, onChange, placeholder, type = "text", hint, tip, error, list, min, max, step, disabled = false }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; hint?: string; tip?: string; error?: string; list?: string; min?: number; max?: number; step?: number; disabled?: boolean }) {
  return (
    <label className="col" style={{ gap: 5 }}>
      <span className="muted tiny">{label}{tip ? <span className="has-tip" data-tip={tip} aria-label={`${label}说明：${tip}`} /> : null}{hint ? <span className="sku-field-hint"> · {hint}</span> : null}</span>
      <input className="fld" aria-invalid={error ? true : undefined} type={type} list={list} min={min} max={max} step={step} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} />
      {error && <span role="alert" className="sku-field-error tiny">{error}</span>}
    </label>
  );
}

export function EDomainView({ meta }: { meta: DomainViewMeta }) {
  return meta.l2Id === "E1" ? <E1Page /> : <ELegacyDomainView meta={meta} />;
}

function ELegacyDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const [tab] = useState(FOLD[meta.l2Id] ?? "E1");
  const searchParams = useSearchParams();
  const [mc, setActionConfirm] = useState<Mc>(null);
  const [selOrder, setSelOrder] = useState<EOrder | null>(null);
  const [e4Detail, setE4Detail] = useState<E4OrderDetail | null>(null);
  const [e4DetailLoading, setE4DetailLoading] = useState(false);
  const [e4DetailError, setE4DetailError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false); // E3 操作说明手册弹窗
  const operator = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
  const canReadE1 = useAdminAuth((s) => s.session?.authorities.includes("device_e1_read") ?? false);
  const canWriteE1 = useAdminAuth((s) => s.session?.authorities.includes("device_e1_write") ?? false);
  const canReadE2 = useAdminAuth((s) => s.session?.authorities.includes("device_e2_read") ?? false);
  const canWriteE2 = useAdminAuth((s) => s.session?.authorities.includes("device_e2_write") ?? false);
  const canWriteE3 = useAdminAuth((s) => s.session?.authorities.includes("device_e3_write") ?? false);
  const canWriteE4 = useAdminAuth((s) => s.session?.authorities.includes("device_e4_write") ?? false);
  // 会话没有逐权限的 grant-role 投影，主角色不能证明退款权来源，也不能排除其他主角色兼任财务主管。
  // 同时有退款和提案权才给受限申请入口，资格仍由后端按实际授权来源核实。
  const canRefundE4 = useAdminAuth((s) => !!s.session
    && s.session.authorities.includes("device_e4_order_refund")
    && s.session.authorities.some((code) => ["platform_a2_proposal_create", "platform_a2_write"].includes(code)));
  const canQueryE4 = useAdminAuth((s) => s.session?.authorities.some((code) => ["platform_a2_read", "platform_a2_proposal_create"].includes(code)) ?? false);
  const canReadE5 = useAdminAuth((s) => s.session?.authorities.includes("device_e5_read") ?? false);
  const canWriteE5 = useAdminAuth((s) => s.session?.authorities.includes("device_e5_write") ?? false);
  const hasForceActivateE5 = useAdminAuth((s) => s.session?.authorities.includes("device_e5_device_force_activate") ?? false);
  const hasUnbindE5 = useAdminAuth((s) => s.session?.authorities.includes("device_e5_device_unbind") ?? false);
  const canProposeE5 = useAdminAuth((s) =>
    s.session?.role === "growth"
      && s.session.authorities.includes("platform_a2_proposal_create"));
  const canForceActivateE5 = hasForceActivateE5 || canProposeE5;
  const canUnbindE5 = hasUnbindE5 || canProposeE5;
  const canReadE6 = useAdminAuth((s) => s.session?.authorities.includes("device_e6_read") ?? false);
  const canWriteE6 = useAdminAuth((s) => s.session?.authorities.includes("device_e6_write") ?? false);
  const hasToggleE6 = useAdminAuth((s) => s.session?.authorities.includes("device_e6_flag_toggle") ?? false);
  const canProposeE6 = useAdminAuth((s) =>
    s.session?.role === "growth"
      && s.session.authorities.includes("platform_a2_proposal_create"));
  const canToggleE6 = canWriteE6 || hasToggleE6 || canProposeE6;
  const rawPropose = usePropose(); // E 域高敏动作统一入 A2 后端待确认队列
  // A2 提案咽喉:E 域每一次提案的命令号都由本函数派,调用点携号也一律以稳定号为准。
  // 指纹**不含 reason**:理由是审计元数据不是意图 —— 运营在「结果未知」后补一句理由再点是极自然的
  // 动作,理由进指纹就会换新号 → 同一笔退款进两次审批队列。改理由复用旧号最坏只是审计记原措辞。
  // 目标锁一并进指纹,防某个动作的 command 不含目标 id 时指纹失去区分度。
  const propose = async (toast: (message: string) => void, spec: ProposeSpec) => {
    // 槽位用**结构化动作标识**(command.op)而不是 spec.action:后者是运营展示文案,常内嵌输入值
    // (「上架节奏 · 延迟 1 个月 · Gen3」),值进槽位就退化成 store 文档明令避开的形态 ——
    // 换个值提交成功只清了新槽,旧槽的号原样滞留,改回原值时会复用它被后端静默去重。
    const slot = `${spec.command.op}|${spec.obj}`;
    // 指纹必须覆盖**整个提案信封**,不只是 command:后端防重复提交 payload-bound,提案 body 里的
    // before/after/type/amplifies 任何一项变了都是异载荷 → 409「内容已变化」。
    // before 尤其关键 —— 它是「变更前」快照(如订单当前状态、参数当前值),刷新页面重开弹窗时
    // 会随最新数据变化;漏掉它则指纹相同而 body 变了,重试撞 409 且因非全新尝试而不弃号 = 24h 死锁。
    // 易变字段(媒体预签名 URL)在 command 构造源头 canonicalE1SkuParams 就已剔除,两侧天然对称。
    const fingerprint = JSON.stringify([
      spec.before, spec.after, spec.command, spec.type, !!spec.amplifies,
      spec.target ?? spec.targets ?? null,
    ]);
    let mintedFresh = false;
    const commandKey = commandAttempts.resolve(slot, fingerprint, () => {
      mintedFresh = true;
      return createA2CommandKey("e-domain-action");
    });
    try {
      const result = await rawPropose(toast, { ...spec, commandKey });
      commandAttempts.forget(slot);
      return result;
    } catch (error) {
      // 鸭型判据(不用裸 instanceof:打包边界下会失真,失真方向恰好是「该保号却弃号」)。
      // 只有全新尝试才在确定性失败时弃号:复用来的号说明上次结果未知,这次的 4xx 证明不了那次没落地。
      if (mintedFresh && !isA2OutcomeUncertainError(error)) commandAttempts.forget(slot);
      throw error;
    }
  };
  const openActionConfirm = (spec: NonNullable<Mc>) => setActionConfirm(spec);
  const [e3Params, setE3Params] = useState<Record<string, string>>({});
  const [e3Stats, setE3Stats] = useState<E3Stats | null>(null);
  const [e3Operations, setE3Operations] = useState<E3OperationMetric[]>([]);
  const [e3Loading, setE3Loading] = useState(false);
  const [e3Error, setE3Error] = useState<string | null>(null);
  const isE3ParamKey = (k: string) =>
    k.startsWith("E.device.") || k.startsWith("E.tradein.") || k.startsWith("E.release.earlyAccess.");
  const pE = (k: string): string => isE3ParamKey(k) ? (e3Params[k] ?? "—") : "—";
  const e3Ready = Object.keys(e3Params).length > 0;

  // ── E1 商品目录 / 上架门:后端接口为单一来源 ──
  const [e1Skus, setE1Skus] = useState<OpsSku[]>([]);
  const [e1InvalidSkus, setE1InvalidSkus] = useState<E1InvalidSku[]>([]);
  const [e1Gates, setE1Gates] = useState<E1GenerationGateData | null>(null);
  const [e1BundleDiscount, setE1BundleDiscount] = useState<E1BundleDiscount | null>(null);
  const [e1Loading, setE1Loading] = useState(false);
  const [e1Error, setE1Error] = useState<string | null>(null);
  const refreshE1 = useCallback(async () => {
    setE1Loading(true);
    setE1Error(null);
    try {
      const snapshot = await fetchE1Catalog();
      setE1Skus(snapshot.skus);
      // 逐行不合规的行不再让整页失败,但也不能静默丢弃 —— 交给目录页具名展示。
      setE1InvalidSkus(snapshot.invalidSkus);
      setE1Gates(snapshot.gates);
      setE1BundleDiscount(snapshot.bundleDiscount);
    } catch (error) {
      // 只有页级契约坏了(响应根本不是分页形状)才清空:此时没有任何可信的行可展示。
      setE1Error(displayAdminError(error));
      setE1Skus([]);
      setE1InvalidSkus([]);
      setE1Gates(null);
      setE1BundleDiscount(null);
    } finally {
      setE1Loading(false);
    }
  }, []);
  useEffect(() => { if (tab === "E1" || tab === "E5" && canReadE1) void refreshE1(); }, [tab, canReadE1, refreshE1]);
  const skus = e1Skus;
  const phaseCur = e1Gates?.phaseCurrent ?? "P3";
  const e1PhaseIds = e1Gates?.phaseOrder?.length
    ? e1Gates.phaseOrder
    : (e1Gates?.phases ?? []).map((phase) => phase.p);
  const skuPhaseIds = e1PhaseIds;
  const e1PhaseLabel = (phaseId: string): string => {
    const phase = e1Gates?.phases.find((item) => item.p === phaseId);
    return phase?.label || phaseId;
  };

  // ── E6 手机任务与收益:服务端数据为单一来源 ──
  const [tasks, setTasks] = useState<OpsTask[]>([]);
  const [phoneTiers, setPhoneTiers] = useState<E2PhoneTier[]>([]);
  const [yieldComparisons, setYieldComparisons] = useState<E2YieldComparison[]>([]);
  const [e2Loading, setE2Loading] = useState(false);
  const [e2Error, setE2Error] = useState<string | null>(null);
  const [e2TaskCatalogReady, setE2TaskCatalogReady] = useState(false);
  const canMutateE2 = canReadE2 && canWriteE2 && !e2Loading && !e2Error;
  const canMutateE2Tasks = canReadE2 && canWriteE2 && !e2Loading && e2TaskCatalogReady;
  useEffect(() => {
    setActionConfirm((current) => {
      if (current && isE2TaskMutation(current.op) && !canMutateE2Tasks) return null;
      if (current && isE2ConfigMutation(current.op) && !canMutateE2) return null;
      return current;
    });
  }, [canMutateE2, canMutateE2Tasks]);
  const refreshE2 = useCallback(async () => {
    setE2Loading(true);
    setE2Error(null);
    const [tasksResult, phoneResult] = await Promise.allSettled([
      canReadE2 ? fetchE2Tasks() : Promise.resolve([]),
      canReadE2 ? fetchE2PhoneTiers() : Promise.resolve({ tiers: [], comparisons: [] }),
    ]);
    const errors: string[] = [];
    if (tasksResult.status === "fulfilled") {
      setTasks(tasksResult.value);
      setE2TaskCatalogReady(true);
    } else {
      setTasks([]);
      setE2TaskCatalogReady(false);
      errors.push(`任务目录：${displayAdminError(tasksResult.reason)}`);
    }
    if (phoneResult.status === "fulfilled") {
      setPhoneTiers(phoneResult.value.tiers);
      setYieldComparisons(phoneResult.value.comparisons);
    } else {
      setPhoneTiers([]);
      setYieldComparisons([]);
      errors.push(`手机档位：${displayAdminError(phoneResult.reason)}`);
    }
    setE2Error(errors.length ? errors.join("；") : null);
    setE2Loading(false);
  }, [canReadE2]);
  useEffect(() => { if (tab === "E6" && canReadE2) void refreshE2(); }, [tab, canReadE2, refreshE2]);

  // ── E3 设备使用与升级置换:服务端配置 / 概览 / tx 监控为单一来源 ──
  const refreshE3 = useCallback(async () => {
    setE3Loading(true);
    setE3Error(null);
    try {
      const snapshot = await fetchE3Snapshot();
      setE3Params(snapshot.params);
      setE3Stats(snapshot.stats);
      setE3Operations(snapshot.operations);
    } catch (error) {
      setE3Error(displayAdminError(error));
      setE3Params({});
      setE3Stats(null);
      setE3Operations([]);
    } finally {
      setE3Loading(false);
    }
  }, []);
  useEffect(() => { if (tab === "E1" || tab === "E3") void refreshE3(); }, [tab, refreshE3]);

  // ── E4 订单进度:服务端数据为单一来源 ──
  const [orders, setOrders] = useState<EOrder[]>([]);
  const [e4Loading, setE4Loading] = useState(false);
  // 切回页面的后台重读不换骨架屏，所以和 e4Loading 分开记。写操作的锁看这个。
  const [e4Reading, setE4Reading] = useState(false);
  // 切回页面时重读开着的详情。旧详情留在屏幕上不闪，写操作等它读完。
  const [e4DetailReading, setE4DetailReading] = useState(false);
  const [e4Error, setE4Error] = useState<string | null>(null);
  const [e4Total, setE4Total] = useState(0);
  const [e4Query, setE4Query] = useState<E4Query>(() => e4QueryFromUrl(searchParams));
  const [e4KeywordInput, setE4KeywordInput] = useState(e4Query.keyword);
  const [e4Counts, setE4Counts] = useState<Record<string, number> | null>(null);
  const [e4CountsFailed, setE4CountsFailed] = useState(false);
  const [e4ReadAt, setE4ReadAt] = useState("");
  const e4ListSeq = useRef(0);
  const e4CountSeq = useRef(0);
  const e4DetailSeq = useRef(0);
  const updateE4Query = useCallback((patch: Partial<Omit<E4Query, "keyword">>) => {
    setE4Query((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  }, []);
  const clearE4Filters = useCallback(() => {
    setE4KeywordInput("");
    setE4Query((current) => ({ ...E4_DEFAULT_QUERY, pageSize: current.pageSize }));
  }, []);
  // 只有一个搜索框，停止输入 300 毫秒后查询（ST-17）。
  useEffect(() => {
    if (tab !== "E4" || e4KeywordInput.trim() === e4Query.keyword) return;
    const timer = setTimeout(() => setE4Query((current) => ({ ...current, keyword: e4KeywordInput.trim(), page: 1 })), 300);
    return () => clearTimeout(timer);
  }, [tab, e4KeywordInput, e4Query.keyword]);
  useEffect(() => { if (tab === "E4") writeE4QueryToUrl(e4Query); }, [tab, e4Query]);
  // silent 是切回页面时的后台重读：不换成骨架屏，抽屉和高亮行不动。失败照样清掉旧数据（E4-S02）。
  const readE4List = useCallback(async (silent = false) => {
    const seq = ++e4ListSeq.current;
    setE4Reading(true);
    if (!silent) setE4Loading(true);
    try {
      const states = e4Query.state ? [e4Query.state] : e4GroupStates(e4Query.group);
      const nextPage = states.length > 1
        ? await fetchE4OrderGroupPage(states, { keyword: e4Query.keyword, pageNum: e4Query.page, pageSize: e4Query.pageSize })
        : await fetchE4OrderPage({ state: states[0], keyword: e4Query.keyword, pageNum: e4Query.page, pageSize: e4Query.pageSize });
      if (seq !== e4ListSeq.current) return;
      setOrders(nextPage.records);
      setE4Total(nextPage.total);
      setE4Error(null);
      setE4ReadAt(businessClock(Date.now()));
      // 数据变少时收回到最后一页，只在读取成功后收回（ST-13）。
      const lastPage = Math.max(1, Math.ceil(nextPage.total / e4Query.pageSize));
      if (e4Query.page > lastPage) setE4Query((current) => ({ ...current, page: lastPage }));
    } catch (error) {
      if (seq !== e4ListSeq.current) return;
      setE4Error(displayAdminError(error));
      setOrders([]);
      setE4Total(0);
    } finally {
      if (seq === e4ListSeq.current) {
        setE4Loading(false);
        setE4Reading(false);
      }
    }
  }, [e4Query]);
  /** 列表或开着的详情在读、读失败时事实不是最新的，抽屉和确认框都不能提交（OP-150）。 */
  const e4ReadBlock = e4Reading || e4DetailReading ? "正在读取最新订单状态，读完才能操作"
    : e4Error ? "订单列表读取失败，重试成功后才能操作"
      : e4DetailError ? "订单详情读取失败，重试成功后才能操作" : undefined;
  /** 汇总和流程表的数量。接口没有按组计数，11 个状态各取总数，跟着搜索词走，读不到写「—」，不挡列表和操作。
   *  换条件时先清掉旧数，新数读齐前不能当当前范围显示；切回页面的后台重读范围没变，读齐再换。 */
  const readE4Counts = useCallback(async (silent = false) => {
    const seq = ++e4CountSeq.current;
    if (!silent) {
      setE4Counts(null);
      setE4CountsFailed(false);
    }
    try {
      const pages = await Promise.all(ORDER_STATES.map((state) => fetchE4OrderPage({ state, keyword: e4Query.keyword, pageNum: 1, pageSize: 1 })));
      if (seq !== e4CountSeq.current) return;
      setE4Counts(Object.fromEntries(ORDER_STATES.map((state, index) => [state, pages[index].total])));
      setE4CountsFailed(false);
    } catch {
      if (seq !== e4CountSeq.current) return;
      setE4Counts(null);
      setE4CountsFailed(true);
    }
  }, [e4Query.keyword]);
  const refreshE4 = useCallback(() => Promise.all([readE4List(), readE4Counts()]), [readE4List, readE4Counts]);
  useEffect(() => { if (tab === "E4") void readE4List(); }, [tab, readE4List]);
  useEffect(() => { if (tab === "E4") void readE4Counts(); }, [tab, readE4Counts]);
  /** 不清屏重读开着的详情。读失败要清掉旧详情，不能再按它操作。 */
  const rereadE4Detail = useCallback(async (orderId: string) => {
    const seq = ++e4DetailSeq.current;
    setE4DetailReading(true);
    try {
      const detail = await fetchE4OrderDetail(orderId);
      if (seq !== e4DetailSeq.current) return;
      setE4Detail(detail);
      setE4DetailError(null);
    } catch (error) {
      if (seq !== e4DetailSeq.current) return;
      setE4Detail(null);
      setE4DetailError(displayAdminError(error));
    } finally {
      // 序号已经顶掉还在读的 openOrder，它的加载状态由这里收。
      if (seq === e4DetailSeq.current) {
        setE4DetailReading(false);
        setE4DetailLoading(false);
      }
    }
  }, []);
  const openOrderId = selOrder?.id;
  useEffect(() => {
    if (tab !== "E4") return;
    const refreshOnReturn = () => {
      if (document.visibilityState !== "visible") return;
      void readE4List(true);
      void readE4Counts(true);
      if (openOrderId) void rereadE4Detail(openOrderId);
    };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [tab, readE4List, readE4Counts, rereadE4Detail, openOrderId]);
  const openOrder = useCallback(async (order: EOrder) => {
    const seq = ++e4DetailSeq.current;
    setE4DetailReading(false);
    setSelOrder(order);
    setE4Detail(null);
    setE4DetailError(null);
    setE4DetailLoading(true);
    try {
      const detail = await fetchE4OrderDetail(order.id);
      if (seq === e4DetailSeq.current) setE4Detail(detail);
    } catch (error) {
      if (seq === e4DetailSeq.current) setE4DetailError(displayAdminError(error));
    } finally {
      if (seq === e4DetailSeq.current) setE4DetailLoading(false);
    }
  }, []);
  const closeOrder = useCallback(() => {
    e4DetailSeq.current += 1;
    setE4DetailReading(false);
    setSelOrder(null);
    setE4Detail(null);
    setE4DetailError(null);
    setE4DetailLoading(false);
  }, []);
  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);
  const orderState = useCallback((order: EOrder): string => e4Detail?.order.id === order.id
    ? e4Detail.order.state
    : orderById.get(order.id)?.state ?? order.state, [e4Detail, orderById]);
  // ── E4 结果未确认：做法同提现审核的 sendCommand、retryPending、releasePending ──
  const [e4Pending, setE4Pending] = useState<E4PendingCommand[]>([]);
  const [e4PendingNotes, setE4PendingNotes] = useState<Record<string, string>>({});
  const [e4RetryRejected, setE4RetryRejected] = useState<string[]>([]);
  const [e4Retrying, setE4Retrying] = useState("");
  const [e4QueryMissing, setE4QueryMissing] = useState<string[]>([]);
  const syncE4Pending = useCallback(() => setE4Pending(e4PendingCommands.list()), []);
  const e4ReceiptAttempts = commandAttempts.list().flatMap((record) => {
    const [op, orderNo] = record.fingerprint.split("|");
    return E4_APPROVAL_OPS.includes(op) && orderNo ? [{ ...record, orderNo }] : [];
  });
  const checkE4Receipt = async (record: EViewCtx["e4ReceiptAttempts"][number]) => {
    setE4Retrying(record.fingerprint);
    try {
      const receipt = await fetchA2ProposalByKey(record.commandKey);
      if (!receipt?.mine || receipt.obj !== record.orderNo
          || (receipt.operationCode && receipt.operationCode !== record.fingerprint.split("|")[0])) {
        setToast("暂未找到对应的原审批单，请稍后再查。原命令号继续保留。", "warn");
        return;
      }
      commandAttempts.forget(record.fingerprint, record.commandKey);
      syncE4Pending();
      setToast(`已找回原审批单 ${receipt.id}`, "success");
      await refreshE4();
    } catch (error) {
      setToast(displayAdminError(error), "error");
    } finally {
      setE4Retrying("");
    }
  };
  useEffect(() => { if (tab === "E4") syncE4Pending(); }, [tab, syncE4Pending]);
  /**
   * 先把原操作存好再发。确定失败丢号，留在确认框；结果未知保号，关框，转成页面上方的待确认条，这单在有结论前不能再操作。
   * 重试的是保留下来的原命令时，确定失败也证明不了原命令的结果，继续保留。只有成功才解除。返回 true 表示已提交。
   */
  const sendE4Proposal = async (spec: ProposeSpec, retained?: E4PendingCommand) => {
    const scope = `order|${spec.obj}`;
    const key = retained?.commandKey ?? createA2CommandKey("e-domain-action");
    e4PendingCommands.remember(scope, key, { label: spec.action, orderNo: spec.obj, spec });
    if (!e4PendingCommands.isDurablyStored(scope, key)) {
      if (!retained) e4PendingCommands.forget(scope, key);
      throw new Error(retained
        ? "浏览器存不下原操作，本次没有发送，结果仍未知。原命令继续保留，请查询原操作。"
        : "浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
    try {
      await rawPropose(() => undefined, { ...spec, commandKey: key });
    } catch (error) {
      const unknown = isA2OutcomeUncertainError(error);
      if (!unknown && !retained) e4PendingCommands.forget(scope);
      syncE4Pending();
      if (!unknown) throw error;
      setToast("结果未确认，不要重复操作。到页面上方按原操作重试，或到操作记录核查。", "warn");
      return false;
    }
    e4PendingCommands.forget(scope);
    syncE4Pending();
    setToast("已提交，等待审批后执行。等超级管理员批准，进度到「操作记录与审批」看。", "success");
    return true;
  };
  const noteE4Pending = (record: E4PendingCommand, note: string) => setE4PendingNotes((current) => ({ ...current, [record.fingerprint]: note }));
  /** 按原操作重试：同命令号、同内容、同理由，不接受新输入（OP-94）。只有后端明确拒绝才给解除入口。 */
  const retryE4Pending = async (record: E4PendingCommand) => {
    if (record.expiresAt <= Date.now()) { syncE4Pending(); return; }
    if (!(record.spec.command.op === "e4_order_refund" ? canRefundE4 : canWriteE4)) {
      noteE4Pending(record, "这个账号已没有这项权限，请有权限的同事处理");
      return;
    }
    // 先核实持久副本；读取失败只停发，不能把本地故障当成原命令结案。
    if (!e4PendingCommands.isDurablyStored(record.fingerprint, record.commandKey)) {
      noteE4Pending(record, "浏览器里查不到这条记录，本次没有发送，结果仍未知。原命令继续保留，请查询原操作。");
      return;
    }
    setE4Retrying(record.fingerprint);
    setE4RetryRejected((current) => current.filter((key) => key !== record.commandKey));
    try {
      if (await sendE4Proposal(record.spec, record)) await refreshE4();
      else noteE4Pending(record, "这次也没有确认结果，原操作继续保留。");
    } catch (error) {
      noteE4Pending(record, `重试没有成功：${displayAdminError(error)} 这说明不了原操作的结果，原操作继续保留。`);
      if (isExplicitRejection(error)) setE4RetryRejected((current) => [...current, record.commandKey]);
    } finally {
      setE4Retrying("");
    }
  };
  /** 按命令号查原提案。查到就有了结果，可以解除；查不到说明不了没提交，继续保留（OP-93）。 */
  const checkE4Pending = async (record: E4PendingCommand) => {
    setE4Retrying(record.fingerprint);
    try {
      const original = await fetchA2ProposalByKey(record.commandKey, true);
      if (!original) {
        setE4QueryMissing((current) => [...current, record.commandKey]);
        noteE4Pending(record, "暂未查到原提案，结果仍待核实。原操作继续保留，不会重新提交。");
        return;
      }
      e4PendingCommands.forget(record.fingerprint, record.commandKey);
      syncE4Pending();
      await refreshE4();
      setToast(`已找回原审批单 ${original.id}，${E4_PROPOSAL_STATUS[original.status]}。结果到「操作记录与审批」看。`, "success");
    } catch (error) {
      noteE4Pending(record, `查询没有成功：${displayAdminError(error)} 原操作继续保留。`);
    } finally {
      setE4Retrying("");
    }
  };
  /** 重试被拒后，人核实过原操作的结果才解除。不发请求，不写操作记录。 */
  const releaseE4Pending = (record: E4PendingCommand) => {
    e4PendingCommands.forget(record.fingerprint, record.commandKey);
    syncE4Pending();
    setToast("已解除本页待确认；后端原操作未结案时仍会阻止新提交", "success");
  };

  // ── E5 设备管理:服务端 fleet / overview 为单一来源 ──
  const [e5Devices, setE5Devices] = useState<E5Device[]>([]);
  const [e5Overview, setE5Overview] = useState<E5Overview | null>(null);
  const [e5Loading, setE5Loading] = useState(tab === "E5");
  const [e5DeviceError, setE5DeviceError] = useState<string | null>(null);
  const [e5OverviewError, setE5OverviewError] = useState<string | null>(null);
  const [e5Page, setE5Page] = useState(1);
  const [e5PageSize, setE5PageSizeState] = useState(10);
  const [e5Total, setE5Total] = useState(0);
  const [e5Keyword, setE5KeywordState] = useState("");
  const [e5StateFilter, setE5StateFilterState] = useState("all");
  const [e5SourceFilter, setE5SourceFilterState] = useState("all");
  const [e5ProductFilter, setE5ProductFilterState] = useState("all");
  const setE5Keyword = useCallback((value: string) => { setE5KeywordState(value); setE5Page(1); }, []);
  const setE5StateFilter = useCallback((value: string) => { setE5StateFilterState(value); setE5Page(1); }, []);
  const setE5SourceFilter = useCallback((value: string) => { setE5SourceFilterState(value); setE5Page(1); }, []);
  const setE5ProductFilter = useCallback((value: string) => { setE5ProductFilterState(value); setE5Page(1); }, []);
  const setE5PageSize = useCallback((pageSize: number) => {
    setE5PageSizeState(pageSize);
    setE5Page(1);
  }, []);
  const refreshE5 = useCallback(async () => {
    setE5Loading(true);
    setE5DeviceError(null);
    setE5OverviewError(null);
    const [deviceResult, overviewResult] = await Promise.allSettled([
      fetchE5Devices(tab === "E6" ? { pageNum: e5Page, pageSize: e5PageSize, keyword: e5Keyword } : {
        pageNum: e5Page, pageSize: e5PageSize, keyword: e5Keyword, simState: e5StateFilter, source: e5SourceFilter, productCode: e5ProductFilter,
      }, tab === "E6"),
      tab === "E5" ? fetchE5Overview() : Promise.resolve(null),
    ]);
    if (deviceResult.status === "fulfilled") {
      setE5Devices(deviceResult.value.records);
      setE5Total(deviceResult.value.total);
      setE5Page(deviceResult.value.pageNum);
      setE5PageSizeState(deviceResult.value.pageSize);
    } else {
      setE5Devices([]);
      setE5Total(0);
      setE5DeviceError(`${tab === "E6" ? "手机列表" : "设备列表"}：${displayAdminError(deviceResult.reason)}`);
    }
    if (overviewResult.status === "fulfilled") {
      setE5Overview(overviewResult.value);
    } else {
      setE5Overview(null);
      setE5OverviewError(`设备概览：${displayAdminError(overviewResult.reason)}`);
    }
    setE5Loading(false);
  }, [tab, e5ProductFilter, e5Keyword, e5SourceFilter, e5Page, e5PageSize, e5StateFilter]);
  useEffect(() => { if ((tab === "E5" || tab === "E6") && canReadE5) void refreshE5(); }, [tab, canReadE5, refreshE5]);
  const runE5DeviceAction = useCallback(async (deviceId: number, action: "activate" | "deactivate", reason: string) => {
    const device = action === "activate"
      ? await activateE5Device(deviceId, false, reason, operator)
      : await deactivateE5Device(deviceId, false, reason, operator);
    await refreshE5();
    setToast(action === "activate" ? "设备已激活" : device.pendingDeactivate ? "已申请停用，等待当前任务结算后自动停用" : "设备已取消激活");
  }, [operator, refreshE5, setToast]);
  const runE5UserBatch = useCallback(async (userId: number, paused: boolean, reason: string) => {
    const result = await setE5UserDevicesPaused(userId, paused, reason, operator);
    await refreshE5();
    setToast(`${paused ? "暂停" : "恢复"}成功 · ${result.changedCount} 台设备`);
  }, [operator, refreshE5, setToast]);
  // ── E6 算力与设备配置:服务端聚合视图为单一来源 ──
  const [e6Config, setE6Config] = useState<E6ComputeConfigView | null>(null);
  const [e6Loading, setE6Loading] = useState(false);
  const [e6Error, setE6Error] = useState<string | null>(null);
  const refreshE6 = useCallback(async () => {
    setE6Loading(true);
    setE6Error(null);
    try {
      setE6Config(await fetchE6ComputeConfig());
    } catch (error) {
      setE6Error(displayAdminError(error));
      setE6Config(null);
    } finally {
      setE6Loading(false);
    }
  }, []);
  useEffect(() => { if (tab === "E6" && canReadE6) void refreshE6(); }, [tab, canReadE6, refreshE6]);

  // ── 抽屉本地态 ──
  const [taskDrawer, setTaskDrawer] = useState(false);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const emptyTaskForm = { durationMinutes: "10", baseReward: "", asset: "USDT", enabled: true, version: 0, n: "", taskClass: "EM" };
  const [taskForm, setTaskForm] = useState(emptyTaskForm);
  const taskSimulation = () => ({ durationMinutes: Number(taskForm.durationMinutes), baseReward: taskForm.baseReward.trim(), asset: taskForm.asset, enabled: taskForm.enabled, expectedVersion: taskForm.version });
  const validateTaskForm = (): string | null => {
    if (!taskForm.n.trim()) return "请填写任务名称";
    if (!/^[1-9]\d*$/.test(taskForm.durationMinutes) || Number(taskForm.durationMinutes) > 1440) return "固定时长须为 1–1440 的整数分钟";
    if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(taskForm.baseReward.trim())) return "固定奖励须为非负数，最多 12 位整数、6 位小数";
    return null;
  };
  const rejectE2Mutation = () => {
    setToast("设备收益设置加载失败，本次没有提交");
    return false;
  };
  const openAddTask = () => {
    if (!canMutateE2Tasks) return rejectE2Mutation();
    setEditTaskId(null); setTaskForm(emptyTaskForm); setTaskDrawer(true);
  };
  // 编辑任务:把任务字段回填到抽屉全字段。
  const openEditTask = (t: OpsTask) => {
    if (!canMutateE2Tasks) return rejectE2Mutation();
    setTaskForm({ durationMinutes: String(t.simulation!.durationMinutes), baseReward: String(t.simulation!.baseReward),
      asset: t.simulation!.asset, enabled: t.simulation!.enabled, version: t.simulation!.version, n: t.n, taskClass: t.taskClass! });
    setEditTaskId(t.id);
    setTaskDrawer(true);
  };
  const submitTask = () => {
    if (!canMutateE2Tasks) return rejectE2Mutation();
    const err = validateTaskForm();
    if (err) { setToast(err); return; }
    openActionConfirm({ briefKind: "config", name: "新增任务 · " + taskForm.n.trim(), op: "task-create", content: <div className="col e-confirm-details"><KV k="任务类型" v={TASK_CLASS_LABELS[taskForm.taskClass as keyof typeof TASK_CLASS_LABELS]} /><KV k="时长" v={`${taskForm.durationMinutes} 分钟`} /><KV k="每任务奖励" v={`${taskForm.baseReward} ${taskForm.asset}`} /><KV k="状态" v={taskForm.enabled ? "启用" : "停用"} /></div>, detail: `新增任务「${taskForm.n.trim()}」。批准后，对之后新派的任务生效。` });
    setTaskDrawer(false);
  };
  // 编辑提交:校验后走操作确认(高敏 · 改单价/门槛/taskClass server-canonical)→ onConfirm 真写 updateTask。
  const submitTaskEdit = () => {
    if (!canMutateE2Tasks) return rejectE2Mutation();
    const err = validateTaskForm();
    if (err) { setToast(err); return; }
    const current = tasks.find(task => task.id === editTaskId);
    if (!current) { setToast("手机任务已变化，请刷新后重试"); return; }
    const amplify = Number(taskForm.baseReward) > Number(current.simulation!.baseReward)
      || (!current.simulation!.enabled && taskForm.enabled);
    openActionConfirm({ briefKind: "config", name: "编辑任务 · " + taskForm.n.trim(), op: "task-save", amplify, content: <div className="col e-confirm-details"><KV k="任务类型" v={TASK_CLASS_LABELS[taskForm.taskClass as keyof typeof TASK_CLASS_LABELS]} /><KV k="时长" v={`${taskForm.durationMinutes} 分钟`} /><KV k="每任务奖励" v={`${taskForm.baseReward} ${taskForm.asset}`} /><KV k="状态" v={taskForm.enabled ? "启用" : "停用"} /></div>, detail: `修改任务「${taskForm.n.trim()}」。只对之后新派的任务生效，已派出的按原设置完成。` });
    setTaskDrawer(false);
  };
  const ctx: EViewCtx = {
    pE, openActionConfirm, toast: setToast,
    canWriteE1: false, skus, e1InvalidSkus, e1Loading, e1Error, e1Gates, e1BundleDiscount, phaseCur, refreshE1,
    openSku: () => setToast("请到商品管理与上架条件编辑商品"), delSku: () => setToast("请到商品管理与上架条件删除商品"),
    canReadE2, canWriteE2, tasks, phoneTiers, yieldComparisons, e2Loading, e2Error, e2TaskCatalogReady, refreshE2, openAddTask, openEditTask,
    canWriteE3, e3Ready, e3Loading, e3Error, e3Stats, e3Operations, refreshE3,
    canWriteE4, canRefundE4, orders, e4Loading, e4Error, e4ReadBlock, e4Total, e4Query, e4KeywordInput, e4Counts, e4CountsFailed, e4ReadAt, updateE4Query, setE4KeywordInput, clearE4Filters, refreshE4,
    orderState, e4Pending, e4ReceiptAttempts, checkE4Receipt, e4PendingNotes, e4RetryRejected, e4Retrying, retryE4Pending, checkE4Pending, canQueryE4, e4QueryMissing, releaseE4Pending, selOrder, e4Detail, e4DetailLoading, e4DetailError, openOrder, closeOrder,
    canReadE5, canWriteE5, canForceActivateE5, canUnbindE5,
    runE5DeviceAction, runE5UserBatch,
    e5Devices, e5Overview, e5Loading, e5DeviceError, e5OverviewError, e5Page, e5PageSize, e5Total,
    e5Keyword, e5StateFilter, e5SourceFilter, e5ProductFilter, setE5Keyword, setE5StateFilter, setE5SourceFilter, setE5ProductFilter,
    setE5Page, setE5PageSize, refreshE5,
    canReadE6, canWriteE6, canToggleE6, e6Config, e6Loading, e6Error, refreshE6,
  };

  // ── 批6 A2 propose 辅助(壳集中回调,被 onConfirm 复用)──
  // 取订单当前 live 态(基于 orderById),用于 propose 的 before 描述。
  const effOrderState = (orderId: string): string => orderState({ id: orderId, state: selOrder?.state } as EOrder);
  const canonicalE3Value = (paramKey: string, value: string) => {
    if (paramKey.includes("capacity.applyTo.")) {
      if (value === "参与递减") return "true";
      if (value === "免递减") return "false";
    }
    if (["E.tradein.enabled", "E.tradein.requireHigherPrice", "E.release.earlyAccess.enabled"].includes(paramKey)) {
      if (value === "开") return "true";
      if (value === "关") return "false";
    }
    return value;
  };
  // 自由值/固定值/多字段调参统一入口:按 paramKey 路由到 e6_compute_config / e1_gate_field / e3_config。
  const proposeParam = async (paramKey: string, value: string, before: string, reason: string, action: string, amplify: boolean) => {
    if (paramKey === "E.compute.phoneBinding.minReplacementIntervalDays") {
      const days = Number(value);
      if (!value.trim() || !Number.isSafeInteger(days) || days < 0) {
        throw new Error("手机换机间隔须为非负整数天数，0 表示不限制间隔。");
      }
      value = String(days);
    }
    if (isE6ParamKey(paramKey)) {
      const def = findHighOp("e6_compute_config")!;
      const expectedPolicyVersion = paramKey.startsWith("E.compute.phoneBinding.") ? e6Config?.phoneBinding?.policyVersion : undefined;
      if (paramKey.startsWith("E.compute.phoneBinding.") && !expectedPolicyVersion) throw new Error("手机设置已变化，请刷新后重试。");
      await propose(ctx.toast, {
        action, obj: paramKey, before, after: value, type: def.type, amplifies: amplify,
        gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E6",
        command: def.buildCommand({ paramKey, value, expectedPolicyVersion }),
        target: def.buildTarget({ paramKey }),
      });
      return;
    }
    if (isE3ParamKey(paramKey)) {
      const def = findHighOp("e3_config")!;
      const canonicalValue = canonicalE3Value(paramKey, value);
      await propose(ctx.toast, {
        action, obj: paramKey, before, after: value, type: def.type, amplifies: amplify,
        gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E3",
        command: def.buildCommand({ key: paramKey, value: canonicalValue }),
        target: def.buildTarget({ key: paramKey }),
      });
      return;
    }
    setToast("E_PARAM_BACKEND_ROUTE_MISSING:" + paramKey);
  };

  const headerRight =
    tab === "E3" ? <button className="f-cta manual" onClick={() => setManualOpen(true)}><Icon name="doc" size={15} /> 操作说明手册</button>
          : undefined;

  const page = (
    <>
      {tab !== "E4" && <DomainHeader {...meta} right={headerRight} />}

      {tab === "E2" && <E2Tasks ctx={ctx} />}
      {tab === "E3" && <E3Lifecycle ctx={ctx} />}
      {tab === "E4" && <E4Orders ctx={ctx} />}
      {tab === "E5" && <E5Ops ctx={ctx} />}
      {tab === "E6" && <E6ComputeConfigComp ctx={ctx} />}

      {/* E3 操作说明手册弹窗(右上角按钮触发) */}
      {tab === "E3" && manualOpen && <E3Manual ctx={ctx} onClose={() => setManualOpen(false)} />}

      {taskDrawer && <Drawer title={editTaskId ? "编辑手机任务" : "新增手机任务"} sub="仅用于手机任务池 · 另一位管理员批准后生效" onClose={() => setTaskDrawer(false)}
        footer={<><Btn onClick={() => setTaskDrawer(false)}>取消</Btn><Btn variant="primary" disabled={!canMutateE2Tasks || !taskForm.n.trim()} onClick={editTaskId ? submitTaskEdit : submitTask}>提交审批</Btn></>}>
        <div className="tp-dialog"><div className="tp-key-info">{editTaskId ? taskForm.n : "新任务将加入手机任务池"}</div>
          <label className="col">任务名称<input className="fld" value={taskForm.n} onChange={event => setTaskForm({ ...taskForm, n: event.target.value })} /></label>
          <div className="grid g-2 phone-task-fields">
            <SkuFld label="固定时长（分钟）" type="number" min={1} max={1440} step={1} value={taskForm.durationMinutes} onChange={value => setTaskForm({ ...taskForm, durationMinutes: value })} />
            <SkuFld label="每任务奖励" value={taskForm.baseReward} onChange={value => setTaskForm({ ...taskForm, baseReward: value })} tip="最多 12 位整数、6 位小数。修改仍走 A2 双人审批和覆盖率检查。" />
            <label className="col">奖励资产<select className="fld" value={taskForm.asset} onChange={event => setTaskForm({ ...taskForm, asset: event.target.value })}><option value="USDT">USDT</option><option value="UVT">UVT</option></select></label>
            <label className="col">任务类型<select className="fld" value={taskForm.taskClass} onChange={event => setTaskForm({ ...taskForm, taskClass: event.target.value })}>{TASK_CLASSES.map(c => <option key={c} value={c}>{TASK_CLASS_LABELS[c]}</option>)}</select></label>
          </div>
          <label className="row phone-task-toggle"><input type="checkbox" checked={taskForm.enabled} onChange={event => setTaskForm({ ...taskForm, enabled: event.target.checked })} />启用任务</label>
          <div className="row"><span className="muted">当前版本 {taskForm.version || "待创建"}</span><OpsHint>批准后只影响新派的任务，运行中的任务保留原版本。手机任务在线有效期仍为 1 小时。</OpsHint></div>
        </div>
      </Drawer>}

      {/* 操作确认(唯一动作出口)*/}
      {mc && <OperationConfirmModal briefKind={mc.briefKind}
        action={mc.name}
        title={mc.title}
        detail={mc.detail ?? "从下一次结算或新派任务开始生效，已累计的收益不变。"}
        content={mc.content}
        amplifies={!!mc.amplify}
        edit={mc.edit}
        businessForm={mc.businessForm}
        reasonMin={8}
        reasonMax={200}
        completionCopy={mc.orderId ? undefined : isE2TaskMutation(mc.op)
          ? "批准后生效：提交后请另一位有批准权限和任务池修改权限的管理员在「操作记录与审批」中批准。"
          : ["sku-save", "sku-status", "sku-delete"].includes(mc.op)
            ? "批准后生效：提交后请另一位有批准权限和商品修改权限的管理员在「操作记录与审批」中批准。"
            : "批准后生效：提交后请另一位超级管理员在「操作记录与审批」中批准。"}
        effect={mc.effect}
        confirmLabel={mc.confirmLabel}
        confirmTone={mc.confirmTone}
        coverageLead={mc.coverageLead}
        facts={mc.facts}
        statedBrief={mc.statedBrief}
        reasonPlaceholder={mc.reasonPlaceholder}
        blockedReason={mc.orderId ? e4ReadBlock : undefined}
        onClose={() => setActionConfirm(null)}
        onConfirm={async (reason, newValue, businessValue) => {
          if (!mc) return;
          if (isE2TaskMutation(mc.op) && !canMutateE2Tasks) {
            setToast("设备收益设置加载失败，本次没有提交");
            setActionConfirm(null);
            return;
          }
          if (isE2ConfigMutation(mc.op) && !canMutateE2) {
            setToast("设备收益设置加载失败，本次没有提交");
            setActionConfirm(null);
            return;
          }
          // 批6: E 域高敏动作统一 propose 入 A2 后端待确认队列(壳集中回调)。
          // propose 内部自管成功/失败 toast;此处仅做 mc.op → op 映射 + 构造 ctx + 本地 UI 状态收尾。
          if (mc.op === "task-create" || mc.op === "task-save") {
            const current = tasks.find(task => task.id === editTaskId);
            if (mc.op === "task-save" && !current) throw new Error("手机任务已变化，请刷新后重试");
            const def = findHighOp(mc.op === "task-create" ? "e2_task_create" : "e2_task_update")!;
            const taskCtx = { taskId: editTaskId ?? "", name: taskForm.n.trim(), taskClass: taskForm.taskClass, simulation: taskSimulation() };
            const describe = (task: typeof taskForm) => `${task.n} · ${task.taskClass} · ${task.durationMinutes} 分钟 · ${task.baseReward} ${task.asset} · ${task.enabled ? "启用" : "停用"}`;
            await propose(ctx.toast, { action: mc.name, obj: editTaskId ?? taskForm.n.trim(),
              before: current ? `${current.n} · ${current.simulation!.durationMinutes} 分钟 · ${current.simulation!.baseReward} ${current.simulation!.asset}` : "未创建",
              after: describe(taskForm), type: def.type, amplifies: !!mc.amplify, gate: { roles: [] }, gateLabel: def.gateLabel,
              reason, sourceDomain: "E6", command: def.buildCommand(taskCtx), target: def.buildTarget(taskCtx) });
            setEditTaskId(null);
          } else if (mc.op === "task-status" && mc.taskId) {
            const current = tasks.find(task => task.id === mc.taskId);
            if (!current) throw new Error("手机任务已变化，请刷新后重试");
            const def = findHighOp("e2_task_status")!;
            await propose(ctx.toast, { action: mc.name, obj: mc.taskId, before: current.simulation!.enabled ? "启用" : "停用", after: mc.fixedVal === "active" ? "启用" : "停用",
              type: def.type, amplifies: !!mc.amplify, gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E6",
              command: def.buildCommand({ taskId: mc.taskId, status: mc.fixedVal }), target: def.buildTarget({ taskId: mc.taskId }) });
          } else if (mc.op === "phone-tier" && mc.phoneTier && mc.phoneField) {
            const v = normalizePositiveDecimal18x6(newValue);
            if (!v) { setToast("收益必须为正数，且最多 12 位整数、6 位小数"); return; }
            const def = findHighOp("e2_phone_tier")!;
            const currentTier = phoneTiers.find((row) => row.tier === mc.phoneTier);
            if (!currentTier) { setToast("手机档位设置已更新，请重试"); return; }
            const tierCtx = { tier: mc.phoneTier, expectedRevision: currentTier.revision,
              dailyUsdt: mc.phoneField === "dailyUsdt" ? v : undefined,
              dailyNex: mc.phoneField === "dailyNex" ? v : undefined };
            await propose(ctx.toast, {
              action: mc.name, obj: String(mc.phoneTier),
              before: String(mc.phoneField === "dailyUsdt" ? currentTier.dailyUsdt : currentTier.dailyNex),
              after: v, type: def.type, amplifies: true,
              gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E2",
              command: def.buildCommand(tierCtx),
              target: def.buildTarget(tierCtx),
            });
          } else if (mc.op === "yield-comparison" && mc.comparisonKey && mc.comparisonField) {
            const isLabel = mc.comparisonField === "label";
            const labelValue = String(newValue ?? "").trim();
            const numericValue = normalizePositiveDecimal18x6(newValue);
            if ((isLabel && !labelValue) || (!isLabel && !numericValue)) {
              setToast(isLabel ? "请填写配置名称" : "收益必须为正数，且最多 12 位整数、6 位小数"); return;
            }
            if (isLabel && labelValue.length > 128) { setToast("配置名称最多 128 个字符"); return; }
            const def = findHighOp("e2_phone_tier")!;
            const comparison = yieldComparisons.find((row) => row.configKey === mc.comparisonKey);
            if (!comparison) { setToast("收益对比设置已更新，请重试"); return; }
            const comparisonCtx = {
              configKey: comparison.configKey,
              expectedRevision: comparison.revision,
              label: isLabel ? labelValue : comparison.label,
              dailyUsdt: mc.comparisonField === "dailyUsdt" ? numericValue! : String(comparison.dailyUsdt),
              dailyNex: mc.comparisonField === "dailyNex" ? numericValue! : String(comparison.dailyNex),
            };
            await propose(ctx.toast, {
              action: mc.name, obj: comparison.configKey,
              before: isLabel ? comparison.label : `${comparison.dailyUsdt} USDT / ${comparison.dailyNex} UVT`,
              after: isLabel ? comparisonCtx.label : `${comparisonCtx.dailyUsdt} USDT / ${comparisonCtx.dailyNex} UVT`,
              type: def.type, amplifies: !isLabel,
              gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E2",
              command: def.buildCommand(comparisonCtx), target: def.buildTarget(comparisonCtx),
            });
          } else if (mc.op === "param" && mc.paramKey) {
            const v = (newValue ?? "").trim();
            const before = typeof mc.edit?.current === "string" ? mc.edit.current : "—";
            await proposeParam(mc.paramKey, v, before, reason, mc.name, typeof mc.edit?.amplifiesWhen === "function" ? mc.edit.amplifiesWhen(v) : !!mc.amplify);
          } else if (mc.op === "param-multi" && mc.paramKeys && businessValue) {
            const isE6Batch = mc.paramKeys.every(({ paramKey }) => isE6ParamKey(paramKey));
            const def = findHighOp(isE6Batch ? "e6_compute_config_batch" : "e3_config_batch")!;
            const values = Object.fromEntries(mc.paramKeys.map(({ key, paramKey }) => [
              paramKey,
              isE6Batch ? (businessValue[key] ?? "").trim() : canonicalE3Value(paramKey, (businessValue[key] ?? "").trim()),
            ]));
            await propose(ctx.toast, {
              action: mc.name, obj: mc.paramKeys.map(({ paramKey }) => paramKey).sort().join(","), before: "批量配置变更前", after: "批量配置待审批", type: def.type,
              amplifies: (mc.businessForm?.kind === "multi-field" ? mc.businessForm.amplifies?.(businessValue) : undefined) ?? !!mc.amplify, gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: isE6Batch ? "E6" : "E3",
              command: def.buildCommand({ values }), targets: def.buildTargets?.({ values }),
            });
          } else if (mc.op === "param-fixed" && mc.paramKey && mc.fixedVal != null) {
            await proposeParam(mc.paramKey, mc.fixedVal, "—", reason, mc.name, !!mc.amplify);
          } else if (mc.op === "order-state" && mc.orderId && mc.fixedVal) {
            const def = findHighOp("e4_order_state")!;
            await propose(ctx.toast, {
              action: mc.name, obj: mc.orderId, before: stateLabel(effOrderState(mc.orderId)), after: stateLabel(mc.fixedVal), type: def.type, amplifies: false,
              gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E4",
              command: def.buildCommand({ orderNo: mc.orderId, state: mc.fixedVal }),
              target: def.buildTarget({ orderNo: mc.orderId }),
            });
            setSelOrder(null);
          } else if (mc.op === "order-refund" && mc.orderId) {
            const refundChannel = (businessValue?.refundChannel ?? "").trim();
            if (!refundChannel) { throw new Error("请选择退款渠道"); }
            const refundReasonCode = (businessValue?.refundReasonCode ?? "").trim();
            if (!(E4_REFUND_REASONS as readonly string[]).includes(refundReasonCode)) { throw new Error("请选择退款原因"); }
            const def = findHighOp("e4_order_refund")!;
            await propose(ctx.toast, {
              action: mc.name, obj: mc.orderId, before: effOrderState(mc.orderId), after: "已退款", type: def.type, amplifies: true,
              gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E4",
              command: def.buildCommand({ orderNo: mc.orderId, refundChannel, refundReasonCode }),
              target: def.buildTarget({ orderNo: mc.orderId }),
            });
            setSelOrder(null);
          } else if (mc.op === "order-cancel" && mc.orderId) {
            const closeReasonCode = (businessValue?.closeReasonCode ?? "").trim();
            if (!E4_CLOSE_REASONS.cancelled.includes(closeReasonCode)) { throw new Error("请选择取消原因"); }
            const def = findHighOp("e4_order_cancel")!;
            await propose(ctx.toast, {
              action: mc.name, obj: mc.orderId, before: effOrderState(mc.orderId), after: "已取消", type: def.type, amplifies: false,
              gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E4",
              command: def.buildCommand({ orderNo: mc.orderId, closeReasonCode }),
              target: def.buildTarget({ orderNo: mc.orderId }),
            });
            setSelOrder(null);
          } else if (mc.op === "order-terminal" && mc.orderId) {
            const v = (businessValue?.terminalState ?? "").trim();
            if (!v) { throw new Error("请选择失败结果"); }
            const choices = E4_CLOSE_REASONS[v];
            const closeReasonCode = choices ? (businessValue?.closeReasonCode ?? "").trim() : "";
            if (choices && !choices.includes(closeReasonCode)) { throw new Error("请选择原因"); }
            const def = findHighOp("e4_order_terminal")!;
            await propose(ctx.toast, {
              action: mc.name, obj: mc.orderId, before: effOrderState(mc.orderId), after: stateLabel(v), type: def.type, amplifies: false,
              gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E4",
              command: def.buildCommand({ orderNo: mc.orderId, terminalState: v, closeReasonCode }),
              target: def.buildTarget({ orderNo: mc.orderId }),
            });
            setSelOrder(null);
          } else if (mc.op === "device-activate" && mc.deviceId) {
            const highOp = mc.deviceAction === "force-activate" ? "e5_device_force_activate" : "e5_device_activate";
            const def = findHighOp(highOp)!;
            await propose(ctx.toast, {
              action: mc.name, obj: String(mc.deviceId), before: "未激活", after: "已激活", type: def.type, amplifies: !!def.amplifies,
              gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E5",
              command: def.buildCommand({ deviceId: mc.deviceId }),
              target: def.buildTarget({ deviceId: mc.deviceId }),
            });
          } else if (mc.op === "device-deactivate" && mc.deviceId) {
            const highOp = mc.deviceAction === "unbind" ? "e5_device_unbind" : "e5_device_deactivate";
            const def = findHighOp(highOp)!;
            await propose(ctx.toast, {
              action: mc.name, obj: String(mc.deviceId), before: "已激活", after: "已取消激活/解绑", type: def.type, amplifies: false,
              gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E5",
              command: def.buildCommand({ deviceId: mc.deviceId }),
              target: def.buildTarget({ deviceId: mc.deviceId }),
            });
          } else if (mc.op === "device-batch" && mc.userId) {
            const paused = mc.fixedVal === "true";
            const def = findHighOp(paused ? "e5_device_batch_pause" : "e5_device_batch_resume")!;
            await propose(ctx.toast, {
              action: mc.name, obj: String(mc.userId), before: paused ? "派单中" : "已暂停",
              after: paused ? "该用户设备已暂停" : "该用户设备已恢复", type: def.type, amplifies: !paused,
              gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E5",
              command: def.buildCommand({ userId: mc.userId }),
              target: def.buildTarget({ userId: mc.userId }),
            });
          } else { setToast("已确认生效"); }
          setActionConfirm(null);
          if (mc.orderId) void refreshE4();
          if (mc.op.startsWith("sku-")) void refreshE1();
          if (isE2TaskMutation(mc.op) || isE2ConfigMutation(mc.op)) void refreshE2();
          if (mc.op.startsWith("device-")) void refreshE5();
        }} />}
      {toastNode}
    </>
  );
  return tab === "E4" ? <RdPage>{page}</RdPage> : <div className="dkpage edom">{page}</div>;
}
