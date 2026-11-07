"use client";

/**
 * E 设备与商城 — 设计稿 design_handoff_e_domain 内容视图。
 * 全系统统一连续编号 E1-E5:E1 商品目录&上架门 / E2 收益&用户任务管理 /
 * E3 生命周期&Trade-in / E4 订单进度 / E5 设备运行管理。
 * nav id == 视图 key == prdAnchor == PRD §10 章节(已全部重编号统一,FOLD 现为恒等映射)。
 *
 * 本 shell 持有全部共享 store 接线 + SKU / 任务 / 订单详情抽屉 + OperationConfirmModal;
 * 各 tab 视觉/布局拆到 e-tabs/*(复用 design-kit 原语 + e-domain.css 设计类),经 EViewCtx 注入派生读 + 回调。
 * 真写落点:E1 SKU/上架门、E2 用户任务管理、E3 生命周期&Trade-in、E4 订单进度、E5 设备运行管理走后端 API。
 * 操作确认 显式 edit 契约:调参(param / task-price)传 edit{kind,current,unit};处置/纯动作(sku-status / param-fixed / order-* / ops-pause)不传 edit。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Icon, Btn, Chip, Drawer, KV, OperationConfirmModal, useToast } from "./design-kit";
import { RdPage } from "@/app/components/rd";
import { businessClock } from "@/lib/admin/business-time";
import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";
import { AutoGloss } from "@/app/components/kit/gloss";
import { displayAdminError } from "@/lib/admin/error-messages";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { OpsSku, OpsTask } from "@/lib/admin/platform-types";
import { TASK_DURATION_DEFAULTS, validateComputeTaskConfig } from "@/lib/admin/e2-compute-config";
import { TASK_CLASSES } from "@/lib/admin/task-classes";
import {
  fetchE1Catalog,
  type E1BundleDiscount,
  type E1GenerationGateData,
  type E1InvalidSku,
} from "@/lib/admin/e1-client";
import { fetchE2PhoneTiers, fetchE2TaskPricing, fetchE2Tasks, type E2PhoneTier, type E2TaskPricingSnapshot, type E2YieldComparison } from "@/lib/admin/e2-client";
import { fetchE3Snapshot, type E3OperationMetric, type E3Stats } from "@/lib/admin/e3-client";
import { E4_CLOSE_REASONS, E4_REFUND_REASONS, fetchE4OrderDetail, fetchE4OrderGroupPage, fetchE4OrderPage, type E4OrderDetail } from "@/lib/admin/e4-client";
import {
  fetchE5Datacenters,
  fetchE5Devices,
  fetchE5Overview,
  activateE5Device,
  deactivateE5Device,
  setE5UserDevicesPaused,
  type E5Datacenter,
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
import type { DatacenterForm, E4PendingCommand, Mc, EOp, EViewCtx, EOrder } from "./e-tabs/types";
import { TaskClassChoices, PhoneTaskPolicy } from "./e-tabs/task-type-policy";
import { E1Catalog } from "./e-tabs/e1-catalog";
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


type SkuMediaKind = "image" | "video";
type SkuMedia = {
  kind: SkuMediaKind;
  src: string;
  name: string;
  size: number;
  w?: number;
  h?: number;
  duration?: number;
  assetId?: string;
  objectKey?: string;
  previewUrl?: string;
  contentType?: string;
} | null;

const SKU_IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const SKU_VIDEO_EXTS = new Set(["mp4", "webm", "mov"]);
const SKU_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SKU_MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const SKU_MEDIA_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime";
const SKU_TIER_OPTIONS = [
  { value: "Entry", label: "入门档" },
  { value: "Pro", label: "专业档" },
  { value: "Flagship", label: "旗舰档" },
  { value: "Share", label: "共享份额" },
] as const;
const SKU_LIFECYCLE_OPTIONS = [
  { value: "active", label: "在售" },
  { value: "legacy", label: "已停产" },
] as const;
const DC_STATUS_OPTIONS: { value: DatacenterForm["status"]; label: string }[] = [
  { value: "active", label: "启用中" },
  { value: "maintenance", label: "维护中" },
  { value: "disabled", label: "已禁用" },
];

const E2_TASK_MUTATION_OPS = new Set<EOp>(["task-create", "task-down", "task-price", "task-save"]);
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

function fileExt(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ext === name.toLowerCase() ? "" : ext;
}

function inferSkuMediaKind(file: File): SkuMediaKind | null {
  const ext = fileExt(file.name);
  const mime = file.type.toLowerCase();
  if (SKU_IMAGE_EXTS.has(ext) && (!mime || mime.startsWith("image/"))) return "image";
  if (SKU_VIDEO_EXTS.has(ext) && (!mime || mime.startsWith("video/"))) return "video";
  return null;
}

function mediaKindFromPath(path?: string | null): SkuMediaKind {
  const ext = fileExt(path ?? "");
  return SKU_VIDEO_EXTS.has(ext) ? "video" : "image";
}

function mediaSizeLabel(bytes: number) {
  if (!bytes) return "未知大小";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(mb >= 10 ? 0 : 1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function durationLabel(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return "";
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
}

function skuMediaFromSku(sku: OpsSku): SkuMedia {
  // 预签名预览会过期；刷新失败时仍必须保留权威 asset/object，只有运营明确点“移除”才能清空媒体。
  if (!sku.imageAssetId || !sku.imageObjectKey) return null;
  const kind = mediaKindFromPath(sku.imageObjectKey);
  return {
    kind,
    src: sku.imagePreviewUrl ?? "",
    name: sku.imageObjectKey.split("/").pop() || (kind === "video" ? "商品视频" : "商品主图"),
    size: 0,
    assetId: sku.imageAssetId,
    objectKey: sku.imageObjectKey,
    previewUrl: sku.imagePreviewUrl || undefined,
  };
}

function attachSkuMedia(sku: OpsSku, media: SkuMedia): OpsSku {
  return {
    ...sku,
    imageAssetId: media?.assetId,
    imageObjectKey: media?.objectKey,
    imagePreviewUrl: media?.previewUrl,
  };
}

function skuMediaPreviewSrc(media: NonNullable<SkuMedia>) {
  return media.previewUrl || media.src;
}

function readSkuMediaMetadata(kind: SkuMediaKind, src: string) {
  return new Promise<Partial<NonNullable<SkuMedia>>>((resolve, reject) => {
    if (kind === "image") {
      const image = new Image();
      image.onload = () => resolve({ w: image.width, h: image.height });
      image.onerror = () => reject(new Error("IMAGE_METADATA_FAILED"));
      image.src = src;
      return;
    }
    const video = document.createElement("video");
    let settled = false;
    const settleVideo = (metadata: Partial<NonNullable<SkuMedia>>) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(metadata);
    };
    const timer = window.setTimeout(() => settleVideo({}), 2500);
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => settleVideo({
      w: video.videoWidth || undefined,
      h: video.videoHeight || undefined,
      duration: Number.isFinite(video.duration) ? video.duration : undefined,
    });
    video.onerror = () => settleVideo({});
    video.src = src;
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
    image.src = src;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("CANVAS_TO_BLOB_FAILED"));
    }, "image/png");
  });
}

// SKU 抽屉分节头(① 24×24 brand-soft 圆贴 + 14.5/600 标题 + 顶部分隔)。
function SkuFieldGroup({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 10, alignItems: "center", marginTop: 4, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
        <span style={{ width: 24, height: 24, borderRadius: 7, background: "var(--brand-soft)", color: "var(--brand)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, fontFamily: "var(--mono)" }}>{n}</span>
        <span style={{ fontSize: 14.5, fontWeight: 600, color: "var(--ink)" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}
function SkuFld({ label, value, onChange, placeholder, type = "text", hint, list, min, max, step, disabled = false }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; hint?: string; list?: string; min?: number; max?: number; step?: number; disabled?: boolean }) {
  return (
    <label className="col" style={{ gap: 5 }}>
      <span className="muted tiny">{label}{hint ? <span style={{ color: "var(--ink-4)" }}> · {hint}</span> : null}</span>
      <input className="fld" type={type} list={list} min={min} max={max} step={step} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} />
    </label>
  );
}

// 营销角标不在前端预置;已有值来自后端 SKU,新增值由运营明确输入。
const SKU_BADGE_PRESETS: readonly string[] = [];

export function EDomainView({ meta }: { meta: DomainViewMeta }) {
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
  const canWriteE1 = useAdminAuth((s) => s.session?.authorities.includes("device_e1_write") ?? false);
  const canWriteE2 = useAdminAuth((s) => s.session?.authorities.includes("device_e2_write") ?? false);
  const canWriteE3 = useAdminAuth((s) => s.session?.authorities.includes("device_e3_write") ?? false);
  const canWriteE4 = useAdminAuth((s) => s.session?.authorities.includes("device_e4_write") ?? false);
  const canRefundE4 = useAdminAuth((s) => s.session?.authorities.includes("device_e4_order_refund") ?? false);
  const canQueryE4 = useAdminAuth((s) => s.session?.authorities.includes("platform_a2_read") ?? false);
  const canWriteE5 = useAdminAuth((s) => s.session?.authorities.includes("device_e5_write") ?? false);
  const hasForceActivateE5 = useAdminAuth((s) => s.session?.authorities.includes("device_e5_device_force_activate") ?? false);
  const hasUnbindE5 = useAdminAuth((s) => s.session?.authorities.includes("device_e5_device_unbind") ?? false);
  const canProposeE5 = useAdminAuth((s) =>
    s.session?.role === "growth"
      && s.session.authorities.includes("platform_a2_proposal_create"));
  const canForceActivateE5 = hasForceActivateE5 || canProposeE5;
  const canUnbindE5 = hasUnbindE5 || canProposeE5;
  const canPauseDcE5 = useAdminAuth((s) => s.session?.authorities.includes("device_e5_datacenter_pause") ?? false);
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
  useEffect(() => { if (tab === "E1") void refreshE1(); }, [tab, refreshE1]);
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

  // ── E2 用户任务管理:服务端数据为单一来源 ──
  const [tasks, setTasks] = useState<OpsTask[]>([]);
  const [phoneTiers, setPhoneTiers] = useState<E2PhoneTier[]>([]);
  const [yieldComparisons, setYieldComparisons] = useState<E2YieldComparison[]>([]);
  const [e2Pricing, setE2Pricing] = useState<E2TaskPricingSnapshot | null>(null);
  const [e2Loading, setE2Loading] = useState(false);
  const [e2Error, setE2Error] = useState<string | null>(null);
  const [e2TaskCatalogReady, setE2TaskCatalogReady] = useState(false);
  const canMutateE2 = canWriteE2 && !e2Loading && !e2Error && !!e2Pricing;
  const canMutateE2Tasks = canWriteE2 && !e2Loading && e2TaskCatalogReady;
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
    const [tasksResult, phoneResult, pricingResult] = await Promise.allSettled([
      fetchE2Tasks(), fetchE2PhoneTiers(), fetchE2TaskPricing(),
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
    if (pricingResult.status === "fulfilled") {
      setE2Pricing(pricingResult.value);
    } else {
      setE2Pricing(null);
      errors.push(`任务定价：${displayAdminError(pricingResult.reason)}`);
    }
    if (errors.length) {
      // 简报要求失败时可定位:附上读取时刻与逐面结果,值班人员据此能直接区分
      // 「后端没有 6 类权威定价」和「前端解析拒绝」,不必靠猜。
      errors.push(`加载时间 ${new Date().toLocaleString("zh-CN", { hour12: false })}`);
      errors.push(`任务目录${tasksResult.status === "fulfilled" ? "正常" : "失败"} · 手机档位${phoneResult.status === "fulfilled" ? "正常" : "失败"} · 任务定价${pricingResult.status === "fulfilled" ? "正常" : "失败"}`);
    }
    setE2Error(errors.length ? errors.join("；") : null);
    setE2Loading(false);
  }, []);
  useEffect(() => { if (tab === "E1" || tab === "E2") void refreshE2(); }, [tab, refreshE2]);

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
  const orderState = useCallback((order: EOrder): string => orderById.get(order.id)?.state ?? order.state, [orderById]);
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
      e4PendingCommands.forget(scope, key);
      throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
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
    // 要在 list() 之前查：list() 会从内存副本恢复已删除的记录，那样就成了换号重发。
    if (!e4PendingCommands.isDurablyStored(record.fingerprint, record.commandKey)) {
      e4PendingCommands.forget(record.fingerprint, record.commandKey);
      syncE4Pending();
      await refreshE4();
      setToast("原操作已结束或过期，本次未再次发送。请先核对列表，再决定如何处理。", "warn");
      return;
    }
    setE4Retrying(record.fingerprint);
    setE4RetryRejected((current) => current.filter((key) => key !== record.commandKey));
    try {
      if (await sendE4Proposal(record.spec, record)) await refreshE4();
      else noteE4Pending(record, "这次也没有确认结果，原操作继续保留。");
    } catch (error) {
      noteE4Pending(record, `重试没有成功：${displayAdminError(error)} 这说明不了原操作的结果，原操作继续保留。`);
      setE4RetryRejected((current) => [...current, record.commandKey]);
    } finally {
      setE4Retrying("");
    }
  };
  /** 按命令号查原提案。查到就有了结果，可以解除；查不到说明不了没提交，继续保留（OP-93）。 */
  const checkE4Pending = async (record: E4PendingCommand) => {
    setE4Retrying(record.fingerprint);
    try {
      const original = await fetchA2ProposalByKey(record.commandKey);
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
    setToast("已解除待确认，这单可以重新处理", "success");
  };

  // ── E5 设备运行管理:服务端 fleet / overview 为单一来源 ──
  const [e5Devices, setE5Devices] = useState<E5Device[]>([]);
  const [e5Overview, setE5Overview] = useState<E5Overview | null>(null);
  const [e5Datacenters, setE5Datacenters] = useState<E5Datacenter[]>([]);
  const [e5Loading, setE5Loading] = useState(tab === "E5");
  // 🔴 zentao #44:三个服务面各留各的失败态。此前只有一个 e5Error,任一面失败就把它写满,
  // 而设备表以它为准 —— 于是「概览」或「数据中心」5xx 会把**已经读到的设备**整表藏掉,
  // 运维台在单面故障时对设备失明(工单截图正是:页脚「当前页命中 4 台 / 筛选后 4 条」还在,
  // 表体却只有一行「设备库存读取异常」)。上面 Promise.allSettled 的注释早就写明「任一面失败
  // 只冻结它自己,不能把另外两面的真实数据一起清空」—— 分状态才是那句话的落地。
  const [e5DeviceError, setE5DeviceError] = useState<string | null>(null);
  const [e5OverviewError, setE5OverviewError] = useState<string | null>(null);
  const [e5DatacenterError, setE5DatacenterError] = useState<string | null>(null);
  const [e5Page, setE5Page] = useState(1);
  const [e5PageSize, setE5PageSizeState] = useState(10);
  const [e5Total, setE5Total] = useState(0);
  const [e5Keyword, setE5KeywordState] = useState("");
  const [e5StateFilter, setE5StateFilterState] = useState("all");
  const [e5KindFilter, setE5KindFilterState] = useState("all");
  const [e5HeartbeatFilter, setE5HeartbeatFilterState] = useState("all");
  const setE5Keyword = useCallback((value: string) => { setE5KeywordState(value); setE5Page(1); }, []);
  const setE5StateFilter = useCallback((value: string) => { setE5StateFilterState(value); setE5Page(1); }, []);
  const setE5KindFilter = useCallback((value: string) => { setE5KindFilterState(value); setE5Page(1); }, []);
  const setE5HeartbeatFilter = useCallback((value: string) => { setE5HeartbeatFilterState(value); setE5Page(1); }, []);
  const setE5PageSize = useCallback((pageSize: number) => {
    setE5PageSizeState(pageSize);
    setE5Page(1);
  }, []);
  const refreshE5 = useCallback(async () => {
    setE5Loading(true);
    setE5DeviceError(null);
    setE5OverviewError(null);
    setE5DatacenterError(null);
    // 设备库存 / 概览 / 数据中心是三个独立服务面:任一面失败只冻结它自己,
    // 不能把另外两面的真实数据一起清空 —— 那会让运维台在单面故障时整页失明。
    const [deviceResult, overviewResult, datacenterResult] = await Promise.allSettled([
      fetchE5Devices({ pageNum: e5Page, pageSize: e5PageSize,
        keyword: e5Keyword, status: e5StateFilter, kind: e5KindFilter, heartbeat: e5HeartbeatFilter }),
      fetchE5Overview(),
      fetchE5Datacenters(),
    ]);
    if (deviceResult.status === "fulfilled") {
      setE5Devices(deviceResult.value.records);
      setE5Total(deviceResult.value.total);
      setE5Page(deviceResult.value.pageNum);
      setE5PageSizeState(deviceResult.value.pageSize);
    } else {
      setE5Devices([]);
      setE5Total(0);
      setE5DeviceError(`设备库存：${displayAdminError(deviceResult.reason)}`);
    }
    if (overviewResult.status === "fulfilled") {
      setE5Overview(overviewResult.value);
    } else {
      setE5Overview(null);
      setE5OverviewError(`设备概览：${displayAdminError(overviewResult.reason)}`);
    }
    if (datacenterResult.status === "fulfilled") {
      setE5Datacenters(datacenterResult.value);
    } else {
      setE5Datacenters([]);
      setE5DatacenterError(`数据中心：${displayAdminError(datacenterResult.reason)}`);
    }
    setE5Loading(false);
  }, [e5HeartbeatFilter, e5Keyword, e5KindFilter, e5Page, e5PageSize, e5StateFilter]);
  useEffect(() => { if (tab === "E5") void refreshE5(); }, [tab, refreshE5]);
  const e5PausedDcs = useMemo(() => new Map(e5Datacenters.map((dc) => [dc.dcLocation, dc.dispatchPaused])), [e5Datacenters]);
  const isDcPaused = (dc: string): boolean => e5PausedDcs.get(dc) ?? false;
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
  const skuDatacenterOptions = useMemo(() => {
    const seen = new Set<string>();
    return e5Datacenters.reduce<{ value: string; label: string }[]>((acc, dc) => {
      const value = dc.displayName.trim();
      if (!value || seen.has(value)) return acc;
      seen.add(value);
      acc.push({ value, label: `${value} · ${dc.dcLocation}` });
      return acc;
    }, []);
  }, [e5Datacenters]);
  const skuDatacenterSet = useMemo(() => new Set(skuDatacenterOptions.map((item) => item.value)), [skuDatacenterOptions]);
  const skuDatacenterDefault = skuDatacenterOptions[0]?.value ?? "";

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
  useEffect(() => { if (tab === "E6") void refreshE6(); }, [tab, refreshE6]);

  // ── 抽屉本地态 ──
  const [skuDrawer, setSkuDrawer] = useState(false);
  const [form, setForm] = useState<SkuForm>(EMPTY_SKU_FORM);
  const staleSkuDatacenter = form.datacenter.trim() && !skuDatacenterSet.has(form.datacenter.trim())
    ? form.datacenter.trim()
    : "";
  const [skuMedia, setSkuMedia] = useState<SkuMedia>(null);
  const [skuMediaUploading, setSkuMediaUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [editSkuId, setEditSkuId] = useState<string | null>(null);
  const mediaSeq = useRef(0);
  const [taskDrawer, setTaskDrawer] = useState(false);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const emptyTaskForm = { simulated: true, durationMinutes: "5", baseReward: "", asset: "USDT", enabled: true, version: 0, n: "", price: "", req: "", unit: "", sat: "", taskClass: "", model: "", minReward: "", maxReward: "", minVRAM: "", killInit: "", selectionWeight: "1", expectedDurationMinSec: "18", expectedDurationMaxSec: "18", executionTimeoutSec: "", runtimeKey: "", validatorKey: "", workloadConfigJson: "" };
  const [taskForm, setTaskForm] = useState(emptyTaskForm);
  const taskSimulation = () => taskForm.simulated ? ({ durationMinutes: Number(taskForm.durationMinutes), baseReward: taskForm.baseReward.trim(), asset: taskForm.asset, enabled: taskForm.enabled, expectedVersion: taskForm.version }) : undefined;
  const taskComputeConfig = () => ({
    selectionWeight: Number(taskForm.selectionWeight),
    expectedDurationMinSec: Number(taskForm.expectedDurationMinSec),
    expectedDurationMaxSec: Number(taskForm.expectedDurationMaxSec),
    executionTimeoutSec: taskForm.executionTimeoutSec.trim() ? Number(taskForm.executionTimeoutSec) : undefined,
    runtimeKey: taskForm.runtimeKey.trim() || undefined,
    validatorKey: taskForm.validatorKey.trim() || undefined,
    workloadConfigJson: taskForm.workloadConfigJson.trim() || undefined,
  });
  const editedSku = editSkuId ? skus.find((sku) => sku.id === editSkuId) : undefined;
  const skuTaskClassesReady = e1Gates?.taskClassPolicySupported === true && (!editSkuId || Array.isArray(editedSku?.allowedTaskClasses));
  const skuFormChanged = !editSkuId || !editedSku
    || summarizeSkuProposal(editedSku, attachSkuMedia(formToSku(form, editedSku), skuMedia), { includeDerived: false }) !== null;
  const [dcDrawer, setDcDrawer] = useState(false);
  const [editDcLocation, setEditDcLocation] = useState<string | null>(null);
  const [dcForm, setDcForm] = useState<DatacenterForm>({ dcLocation: "", regionLabel: "", location: "", displayName: "", status: "active", sortOrder: "100" });

  const resetSkuMedia = useCallback((media: SkuMedia = null) => {
    mediaSeq.current += 1;
    setSkuMediaUploading(false);
    setSkuMedia(media);
  }, []);

  useEffect(() => {
    const src = skuMedia?.src;
    if (!src?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(src);
  }, [skuMedia?.src]);
  useEffect(() => {
    if (!skuDrawer || e5Loading || skuDatacenterOptions.length === 0) return;
    setForm((current) => {
      const datacenter = current.datacenter.trim();
      // 已有 SKU 可能仍引用已删除 DC 的历史展示名。PRD 要求保留旧值，
      // 不能在打开编辑抽屉时静默覆盖；仅为空时给新 SKU 选择当前首项。
      if (datacenter) return current;
      return { ...current, datacenter: skuDatacenterDefault };
    });
  }, [skuDrawer, e5Loading, skuDatacenterOptions.length, skuDatacenterSet, skuDatacenterDefault]);

  const refreshCurrentSkuMediaPreview = useCallback(async (assetId?: string) => {
    if (!assetId) return;
    try {
      const asset = await refreshAdminMediaPreviewUrl(assetId);
      setSkuMedia((current) => {
        if (!current || current.assetId !== assetId) return current;
        return {
          ...current,
          src: asset.previewUrl,
          previewUrl: asset.previewUrl,
          objectKey: asset.objectKey || current.objectKey,
          size: asset.sizeBytes ?? current.size,
          contentType: asset.contentType ?? current.contentType,
        };
      });
    } catch {
      setToast("图片预览加载失败，请重新上传或稍后重试");
    }
  }, [setToast]);

  // ── 回调(注入 ctx)──
  const openSku = (skuId?: string, unlockPhase?: string) => {
    if (!tasks.length && !e2Loading) void refreshE2();
    if (!e5Datacenters.length && !e5Loading) void refreshE5();
    if (skuId) {
      const s = skus.find((x) => x.id === skuId);
      if (s) {
        const media = skuMediaFromSku(s);
        const current = skuToForm(s);
        setForm({ ...current, unlock: unlockPhase ?? current.unlock });
        setEditSkuId(skuId);
        resetSkuMedia(media);
        if (media?.assetId) void refreshCurrentSkuMediaPreview(media.assetId);
      }
      else { setForm({ ...EMPTY_SKU_FORM, unlock: e1PhaseIds[0] ?? "" }); setEditSkuId(null); resetSkuMedia(null); }
    } else { setForm({ ...EMPTY_SKU_FORM, unlock: e1PhaseIds[0] ?? "" }); setEditSkuId(null); resetSkuMedia(null); }
    setSkuDrawer(true);
  };
  const delSku = (skuId: string, rawDisplayName: string) => {
    const displayName = (rawDisplayName);
    openActionConfirm({ briefKind: "config",
      name: "删除商品 · " + displayName,
      op: "sku-delete",
      target: skuId,
      detail: `删除「${displayName}」：从商城下架移除，用户无法再购买；已售出的设备不受影响。`,
      businessForm: {
        kind: "destructive-reason",
        target: displayName,
        impact: "商城里会看不到这个商品；已售出的设备和订单不受影响。",
      },
    });
  };
  const openDatacenter = (dc?: E5Datacenter) => {
    setDcForm(dc
      ? {
          dcLocation: dc.dcLocation,
          regionLabel: dc.regionLabel,
          location: dc.location,
          displayName: dc.displayName,
          status: dc.status,
          sortOrder: String(dc.sortOrder),
        }
      : { dcLocation: "", regionLabel: "", location: "", displayName: "", status: "active", sortOrder: "100" });
    setEditDcLocation(dc?.dcLocation ?? null);
    setDcDrawer(true);
  };
  const openDatacenterSaveConfirm = () => {
    const dcLocation = dcForm.dcLocation.trim();
    const regionLabel = dcForm.regionLabel.trim();
    const location = dcForm.location.trim();
    const displayName = dcForm.displayName.trim();
    const sortOrder = Number(dcForm.sortOrder.trim() || "100");
    if (!editDcLocation && !dcLocation) { setToast("请填写数据中心编号"); return; }
    if (!regionLabel || !location || !displayName) { setToast("请填写区域、所在地和展示名称"); return; }
    if (!Number.isFinite(sortOrder) || sortOrder < 0) { setToast("请填写有效排序值"); return; }
    const normalized: DatacenterForm = {
      dcLocation,
      regionLabel,
      location,
      displayName,
      status: dcForm.status,
      sortOrder: String(Math.floor(sortOrder)),
    };
    const statusLabel = DC_STATUS_OPTIONS.find((item) => item.value === normalized.status)?.label ?? normalized.status;
    openActionConfirm({ briefKind: "config",
      name: (editDcLocation ? "编辑数据中心 · " : "新增数据中心 · ") + normalized.dcLocation,
      op: "dc-save",
      dc: editDcLocation ?? normalized.dcLocation,
      dcForm: normalized,
      isNew: !editDcLocation,
      detail: `${editDcLocation ? "更新" : "新增"}数据中心:${normalized.dcLocation} · ${normalized.location} · ${normalized.displayName} · 状态 ${statusLabel}。修改编号时，设备和暂停状态会一起迁移。`,
    });
    setDcDrawer(false);
  };
  const deleteDatacenter = (dc: E5Datacenter) => {
    openActionConfirm({ briefKind: "config",
      name: "删除数据中心 · " + dc.dcLocation,
      op: "dc-delete",
      dc: dc.dcLocation,
      detail: `删除数据中心 ${dc.dcLocation}。只有没有设备、没有待开通订单、也没有商品在用时才能删除；请先确认「操作记录与审批」里没有相关的待确认操作。`,
      businessForm: {
        kind: "destructive-reason",
        target: dc.dcLocation,
        impact: "数据中心列表里会移除这一项，不会删除设备库存。",
      },
    });
  };
  // 任务表单校验(新增 + 编辑共用):取值完整性,非锁死业务值。
  const validateTaskForm = (): string | null => {
    if (taskForm.simulated) {
      if (!taskForm.n.trim()) return "请填写任务名称";
      if (!/^[1-9]\d*$/.test(taskForm.durationMinutes) || Number(taskForm.durationMinutes) > 1440) return "固定时长须为 1–1440 的整数分钟";
      if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(taskForm.baseReward.trim())) return "固定奖励须为非负数，最多 12 位整数、6 位小数";
      return null;
    }
    const price = Number(taskForm.price) || 0;
    if (!taskForm.n.trim() || !price) return "请填写任务名称和单价";
    if (!taskForm.unit.trim() || !taskForm.req.trim() || !taskForm.killInit.trim()) return "请填写计价单位、设备要求和初始接单状态";
    const satText = taskForm.sat.trim();
    if (satText) {
      const sat = Number(satText);
      if (!Number.isFinite(sat) || sat < 0 || sat > 100) return "饱和度需为 0-100";
    }
    // #36 核心配置字段校验:taskClass / 代表模型 / min·maxReward / minVRAM 必填,reward 区间须 min ≤ max
    if (!taskForm.taskClass.trim() || !taskForm.model.trim() || !taskForm.minVRAM.trim()) return "请填写任务类型、代表模型和最低显存";
    const minR = Number(taskForm.minReward), maxR = Number(taskForm.maxReward);
    const minVram = Number(taskForm.minVRAM.replace(/GB$/i, "").trim());
    if (![taskForm.minReward, taskForm.maxReward].every((value) => /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(value.trim()))
      || !Number.isFinite(minR) || !Number.isFinite(maxR) || minR < 0 || maxR < minR) return "奖励须为最多 6 位小数，且 0 ≤ 最低奖励 ≤ 最高奖励";
    if (!Number.isInteger(minVram) || minVram < 0) return "最低显存须为不小于 0 的整数（GB）";
    if (![taskForm.selectionWeight, taskForm.expectedDurationMinSec, taskForm.expectedDurationMaxSec, taskForm.executionTimeoutSec || "1"].every((value) => /^\d+$/.test(value.trim()))) return "权重、预计时长和执行超时须填写整数";
    return validateComputeTaskConfig(taskComputeConfig());
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
    setTaskForm({
      simulated: !!t.simulation, durationMinutes: String(t.simulation?.durationMinutes ?? 5), baseReward: String(t.simulation?.baseReward ?? ""), asset: t.simulation?.asset ?? "USDT", enabled: t.simulation?.enabled ?? true, version: t.simulation?.version ?? 0,
      n: t.n, price: String(t.price), req: t.req, unit: t.unit, sat: t.sat == null ? "" : String(Math.round(t.sat * 100)),
      taskClass: t.taskClass || "", model: t.model || "",
      minReward: t.minReward != null ? String(t.minReward) : "", maxReward: t.maxReward != null ? String(t.maxReward) : "",
      minVRAM: t.minVRAM || "", killInit: t.killInit || "",
      selectionWeight: String(t.selectionWeight ?? 1),
      expectedDurationMinSec: String(t.expectedDurationMinSec ?? TASK_DURATION_DEFAULTS[t.taskClass || ""] ?? 18),
      expectedDurationMaxSec: String(t.expectedDurationMaxSec ?? TASK_DURATION_DEFAULTS[t.taskClass || ""] ?? 18),
      executionTimeoutSec: t.executionTimeoutSec == null ? "" : String(t.executionTimeoutSec),
      runtimeKey: t.runtimeKey || "", validatorKey: t.validatorKey || "", workloadConfigJson: t.workloadConfigJson || "",
    });
    setEditTaskId(t.id);
    setTaskDrawer(true);
  };
  const submitTask = () => {
    if (!canMutateE2Tasks) return rejectE2Mutation();
    const err = validateTaskForm();
    if (err) { setToast(err); return; }
    openActionConfirm({ briefKind: "config", name: "新增任务 · " + taskForm.n.trim(), op: "task-create", detail: `新增任务「${taskForm.n.trim()}」。批准后，对之后新派的任务生效。` });
    setTaskDrawer(false);
  };
  // 编辑提交:校验后走操作确认(高敏 · 改单价/门槛/taskClass server-canonical)→ onConfirm 真写 updateTask。
  const submitTaskEdit = () => {
    if (!canMutateE2Tasks) return rejectE2Mutation();
    const err = validateTaskForm();
    if (err) { setToast(err); return; }
    openActionConfirm({ briefKind: "config", name: "编辑任务 · " + taskForm.n.trim(), op: "task-save", detail: `修改任务「${taskForm.n.trim()}」。只对之后新派的任务生效，已派出的按原设置完成。` });
    setTaskDrawer(false);
  };
  const skuLabelsUsingTask = (taskId: string, taskName: string) => skus
    .filter((sku) => {
      const unlocks = sku.aiUnlocks?.trim();
      return unlocks === taskId || unlocks === taskName;
    })
    .map((sku) => {
      const id = sku.id || sku.name;
      return id && id !== sku.name ? `${sku.name}(${id})` : sku.name;
  });
  const delTask = (t: { id: string; n: string }) => {
    if (!canMutateE2Tasks) return rejectE2Mutation();
    const refSkus = skuLabelsUsingTask(t.id, t.n);
    if (refSkus.length > 0) {
      setToast(`无法下架：${t.n} 正被这些商品使用：${refSkus.join("、")}。请先在「商品管理与上架条件」修改它们的解锁算力池。`);
      return;
    }
    openActionConfirm({ briefKind: "config",
      name: "下架任务 · " + t.n,
      op: "task-down",
      taskId: t.id,
      target: t.n,
      detail: `下架「${t.n}」：停止派发，用户任务页也不再显示。`,
      businessForm: {
        kind: "destructive-reason",
        target: t.n,
        impact: "不再派发这个任务；已完成或已结算的不受影响。",
      },
    });
  };

  // ── 产品媒体上传(SKU 抽屉)──
  const onPickSkuMedia = async (file?: File) => {
    if (!file) return;
    const kind = inferSkuMediaKind(file);
    if (!kind) { setToast("请上传图片或视频：JPG / PNG / WebP / GIF / MP4 / WebM / MOV"); return; }
    const maxBytes = kind === "image" ? SKU_MAX_IMAGE_BYTES : SKU_MAX_VIDEO_BYTES;
    if (file.size > maxBytes) { setToast(`${kind === "image" ? "图片" : "视频"}超过 ${mediaSizeLabel(maxBytes)}，请压缩后再传`); return; }

    const src = URL.createObjectURL(file);
    const seq = ++mediaSeq.current;
    setSkuMediaUploading(true);
    setSkuMedia({ kind, src, name: file.name, size: file.size });

    try {
      const [metadata, asset] = await Promise.all([
        readSkuMediaMetadata(kind, src),
        uploadAdminMedia(file, {
          domain: "E",
          usage: kind === "video" ? "sku-video" : "sku-image",
          entityType: "SKU",
          entityId: form.id.trim() || form.name.trim() || editSkuId || "draft-sku",
          operator,
        }),
      ]);
      if (seq !== mediaSeq.current) {
        URL.revokeObjectURL(src);
        return;
      }
      setSkuMedia({
        kind,
        src: asset.previewUrl,
        name: file.name,
        size: asset.sizeBytes ?? file.size,
        ...metadata,
        assetId: asset.assetId,
        objectKey: asset.objectKey,
        previewUrl: asset.previewUrl,
        contentType: asset.contentType ?? undefined,
      });
      setToast(`${kind === "video" ? "商品视频" : "商品主图"}已上传`);
    } catch (error) {
      if (seq === mediaSeq.current) {
        setSkuMedia(null);
        setToast("上传失败：" + displayAdminError(error));
      } else {
        URL.revokeObjectURL(src);
      }
    } finally {
      if (seq === mediaSeq.current) {
        setSkuMediaUploading(false);
      }
    }
  };
  const cropSquare = async () => {
    const current = skuMedia;
    if (!current || current.kind !== "image") return;
    let seq: number | null = null;
    try {
      const image = await loadImage(current.src);
      const s = Math.min(image.width, image.height);
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = s;
      const x = (image.width - s) / 2, y = (image.height - s) / 2;
      canvas.getContext("2d")!.drawImage(image, x, y, s, s, 0, 0, s, s);
      const nextSrc = canvas.toDataURL("image/png");
      const blob = await canvasToPngBlob(canvas);
      const nextName = current.name.replace(/\.[^.]+$/, "") + "-1x1.png";
      const nextFile = new File([blob], nextName, { type: "image/png" });

      seq = ++mediaSeq.current;
      setSkuMediaUploading(true);
      setSkuMedia({ ...current, src: nextSrc, name: nextName, size: nextFile.size, w: s, h: s, assetId: undefined, objectKey: undefined, previewUrl: undefined, contentType: "image/png" });
      const asset = await uploadAdminMedia(nextFile, {
        domain: "E",
        usage: "sku-image",
        entityType: "SKU",
        entityId: form.id.trim() || form.name.trim() || editSkuId || "draft-sku",
        operator,
      });
      if (seq !== mediaSeq.current) return;
      setSkuMedia({
        ...current,
        src: asset.previewUrl,
        name: nextName,
        size: asset.sizeBytes ?? nextFile.size,
        w: s,
        h: s,
        assetId: asset.assetId,
        objectKey: asset.objectKey,
        previewUrl: asset.previewUrl,
        contentType: asset.contentType ?? "image/png",
      });
      setToast("已居中裁剪为 1:1 并重新上传");
    } catch (error) {
      if (seq == null || seq === mediaSeq.current) {
        setToast("裁剪后上传失败：" + displayAdminError(error));
      }
    } finally {
      if (seq == null || seq === mediaSeq.current) {
        setSkuMediaUploading(false);
      }
    }
  };
  const isSquare = !!(skuMedia?.kind === "image" && skuMedia.w && skuMedia.h && Math.abs(skuMedia.w - skuMedia.h) <= Math.max(skuMedia.w, skuMedia.h) * 0.02);
  const skuUnlockPoolOptions = useMemo(() => {
    const seen = new Set<string>();
    return tasks.reduce<{ id: string; name: string }[]>((acc, task) => {
      const id = task.id.trim();
      if (!id || seen.has(id)) return acc;
      seen.add(id);
      acc.push({ id, name: task.n.trim() || id });
      return acc;
    }, []);
  }, [tasks]);
  const skuUnlockPoolIdSet = useMemo(() => new Set(skuUnlockPoolOptions.map((item) => item.id)), [skuUnlockPoolOptions]);
  const validateSkuUnlockPool = () => {
    const poolId = form.aiUnlocks.trim();
    if (!poolId || skuUnlockPoolIdSet.has(poolId)) return "";
    if (e2Loading) return "任务列表正在加载，请稍后再提交";
    return "解锁算力池请选择 6 类任务中的一项";
  };
  const canUseE1Writes = canWriteE1 && !e1Loading && !e1Error
    && e1Gates !== null && e1BundleDiscount !== null;
  const openSkuSaveConfirm = () => {
    if (e1Gates?.skuReviewContractVersion !== 1) {
      setToast("商品审核暂时不可用，请刷新后重试；已填写的内容会保留");
      return;
    }
    if (skuMediaUploading) { setToast("图片还在上传，请稍后提交"); return; }
    if (skuMedia && !skuMedia.assetId) { setToast("图片没有上传成功，请重新选择文件"); return; }
    if (!form.tier.trim() || !form.lifecycle.trim()) {
      setToast("请选择档位和生命周期");
      return;
    }
    const datacenter = form.datacenter.trim();
    if (!datacenter) {
      setToast(skuDatacenterDefault
        ? "请选择一个当前有效的数据中心"
        : "请先在「设备运行管理」添加至少一个数据中心，再保存商品");
      return;
    }
    // 已有 SKU 可继续保留已删除 DC 的历史展示名，避免编辑其它字段时静默改写部署中心。
    // 新 SKU 则必须显式选择当前 E5 配置中的有效展示名。
    if (!skuDatacenterSet.has(datacenter) && !editSkuId) {
      setToast("请选择一个当前有效的数据中心");
      return;
    }
    if (!skuTaskClassesReady) { setToast("商品任务大类尚未加载，请刷新后再提交"); return; }
    if (editedSku?.status === "on" && !form.allowedTaskClasses.length) { setToast("在售商品至少要勾选一个可跑任务大类"); return; }
    const specErr = validateSkuSpecs(form);
    if (specErr) { setToast(specErr); return; }
    const poolErr = validateSkuUnlockPool();
    if (poolErr) { setToast(poolErr); return; }
    const inventoryMode = form.inventoryMode === "UNLIMITED" ? "UNLIMITED" : "FINITE";
    if (inventoryMode === "UNLIMITED" && form.tier !== "Share") {
      setToast("无限库存只适用于云端共享份额这类非实物商品");
      return;
    }
    const stock = form.stock.trim();
    if (inventoryMode === "FINITE" && (!stock || !/^\d+$/.test(stock) || !Number.isSafeInteger(Number(stock)) || Number(stock) > 2147483647)) {
      setToast("库存必须填写 0 到 2147483647 之间的整数");
      return;
    }
    const gErr = validateGateForm(form);
    if (gErr) { setToast(gErr); return; }
    const currentSku = editSkuId ? skus.find((sku) => sku.id === editSkuId) : undefined;
    if (editSkuId && !currentSku) {
      setToast("商品信息已更新，请重新打开商品后再提交");
      return;
    }
    const candidateSku = attachSkuMedia(formToSku(form, currentSku), skuMedia);
    const previewSummary = currentSku
      ? summarizeSkuProposal(currentSku, candidateSku, { includeDerived: false })
      : summarizeSkuCreation(candidateSku);
    if (editSkuId && !previewSummary) {
      setToast("没有任何修改，无需提交");
      return;
    }
    openActionConfirm({ briefKind: "config", name: (editSkuId ? "编辑商品 · " : "新增商品 · ") + (form.name || "未命名"), op: "sku-save", isNew: !editSkuId, hasImg: !!skuMedia });
    setSkuDrawer(false);
  };

  const ctx: EViewCtx = {
    pE, openActionConfirm, toast: setToast,
    canWriteE1: canUseE1Writes, skus, e1InvalidSkus, e1Loading, e1Error, e1Gates, e1BundleDiscount, phaseCur, refreshE1, openSku, delSku,
    canWriteE2, tasks, phoneTiers, yieldComparisons, e2Pricing, e2Loading, e2Error, e2TaskCatalogReady, refreshE2, openAddTask, openEditTask, delTask,
    canWriteE3, e3Ready, e3Loading, e3Error, e3Stats, e3Operations, refreshE3,
    canWriteE4, canRefundE4, orders, e4Loading, e4Error, e4ReadBlock, e4Total, e4Query, e4KeywordInput, e4Counts, e4CountsFailed, e4ReadAt, updateE4Query, setE4KeywordInput, clearE4Filters, refreshE4,
    orderState, e4Pending, e4ReceiptAttempts, checkE4Receipt, e4PendingNotes, e4RetryRejected, e4Retrying, retryE4Pending, checkE4Pending, canQueryE4, e4QueryMissing, releaseE4Pending, selOrder, e4Detail, e4DetailLoading, e4DetailError, openOrder, closeOrder,
    canWriteE5, canForceActivateE5, canUnbindE5, canPauseDcE5,
    runE5DeviceAction, runE5UserBatch,
    e5Devices, e5Overview, e5Datacenters, e5Loading, e5DeviceError, e5OverviewError, e5DatacenterError, e5Page, e5PageSize, e5Total,
    e5Keyword, e5StateFilter, e5KindFilter, e5HeartbeatFilter, setE5Keyword, setE5StateFilter, setE5KindFilter, setE5HeartbeatFilter,
    setE5Page, setE5PageSize, refreshE5, isDcPaused, openDatacenter, deleteDatacenter,
    canWriteE6, canToggleE6, e6Config, e6Loading, e6Error, refreshE6,
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
    if (paramKey.startsWith("E.gen.")) {
      const def = findHighOp("e1_gate_field")!;
      // Task4 #1:后端 normalizeE1GateKey(key)[0]=generationId 是锁单位;
      // 解析 E.gen.<generationId>.<field> 取 generationId 作 target.id,使前端提案锁与后端锁一致。
      const parts = paramKey.split(".");
      const generationId = parts.length >= 3 ? parts[2] : paramKey;
      await propose(ctx.toast, {
        action, obj: paramKey, before, after: value, type: def.type, amplifies: amplify,
        gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E1",
        command: def.buildCommand({ key: paramKey, value }),
        target: { domain: "E", type: def.targetType, id: generationId },
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
    tab === "E1" ? (canUseE1Writes ? <button className="f-cta" onClick={() => openSku()}>+ 新增商品</button> : undefined)
      : tab === "E2" ? (canMutateE2Tasks ? <button className="f-cta" onClick={openAddTask}>+ 新增任务</button> : undefined)
        : tab === "E3" ? <button className="f-cta manual" onClick={() => setManualOpen(true)}><Icon name="doc" size={15} /> 操作说明手册</button>
          : undefined;

  const page = (
    <>
      {tab !== "E4" && <DomainHeader {...meta} right={headerRight} />}

      {tab === "E1" && <><PhoneTaskPolicy canWrite={canUseE1Writes} toast={setToast} /><E1Catalog ctx={ctx} /></>}
      {tab === "E2" && <E2Tasks ctx={ctx} />}
      {tab === "E3" && <E3Lifecycle ctx={ctx} />}
      {tab === "E4" && <E4Orders ctx={ctx} />}
      {tab === "E5" && <E5Ops ctx={ctx} />}
      {tab === "E6" && <E6ComputeConfigComp ctx={ctx} />}

      {/* E3 操作说明手册弹窗(右上角按钮触发) */}
      {tab === "E3" && manualOpen && <E3Manual ctx={ctx} onClose={() => setManualOpen(false)} />}

      {/* SKU 新增 / 编辑 抽屉 */}
      {skuDrawer && <Drawer title={editSkuId ? "编辑商品" : "新增商品"} sub={<AutoGloss>{editSkuId ? "改价、库存、每日收益、开放阶段等，提交后需确认" : "填写商品信息，提交后需确认"}</AutoGloss>} onClose={() => { setSkuDrawer(false); setEditSkuId(null); resetSkuMedia(null); }}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => { setSkuDrawer(false); setEditSkuId(null); resetSkuMedia(null); }}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!form.name || !form.price || !skuFormChanged || skuMediaUploading || (!!skuMedia && !skuMedia.assetId)} onClick={openSkuSaveConfirm}>{editSkuId ? "保存修改" : "提交确认"}</Btn></>}>
        <div className="col" style={{ gap: 12 }}>
          <div className="col" style={{ gap: 5 }}><span className="muted tiny">产品图 / 视频</span>
            <label className={"sku-drop" + (dragOver ? " drag" : "")} style={skuMedia ? { padding: 0, borderStyle: "solid" } : {}}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); void onPickSkuMedia(e.dataTransfer.files[0]); }}>
              <input type="file" accept={SKU_MEDIA_ACCEPT} style={{ display: "none" }} onChange={(e) => { void onPickSkuMedia(e.target.files?.[0]); e.currentTarget.value = ""; }} />
              {skuMedia
                ? !skuMediaPreviewSrc(skuMedia)
                  ? <div className="col" style={{ alignItems: "center", gap: 6, padding: "22px 0", color: "var(--ink-3)" }}><Icon name="image" size={26} /><span className="tiny">图片已保存，预览暂时显示不了</span><span className="muted tiny">可稍后重试，也可选择新文件替换</span></div>
                  : skuMedia.kind === "video"
                  ? <video key={skuMediaPreviewSrc(skuMedia)} src={skuMediaPreviewSrc(skuMedia)} controls muted playsInline preload="auto" onError={() => void refreshCurrentSkuMediaPreview(skuMedia.assetId)} style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 9, display: "block", background: "var(--surface-3)" }} />
                  : <img key={skuMediaPreviewSrc(skuMedia)} src={skuMediaPreviewSrc(skuMedia)} alt="" onError={() => void refreshCurrentSkuMediaPreview(skuMedia.assetId)} style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 9, display: "block" }} />
                : <div className="col" style={{ alignItems: "center", gap: 6, padding: "22px 0", color: dragOver ? "var(--brand)" : "var(--ink-3)" }}><Icon name="image" size={26} /><span className="tiny">{dragOver ? "松开即上传" : "点击或拖拽图片/视频到此"}</span><span className="muted tiny">图片 ≤ 10MB · 视频 ≤ 200MB · JPG/PNG/WebP/GIF/MP4/WebM/MOV</span></div>}
            </label>
            {skuMedia && <div className="row" style={{ gap: 8 }}>
              <span className="muted tiny" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {skuMedia.kind === "video" ? "视频" : "图片"} · {skuMedia.name} · {mediaSizeLabel(skuMedia.size)}
                {skuMedia.w && skuMedia.h ? ` · ${skuMedia.w}×${skuMedia.h}px` : ""}
                {skuMedia.kind === "video" && skuMedia.duration ? ` · ${durationLabel(skuMedia.duration)}` : ""}
                {skuMediaUploading ? <span style={{ color: "var(--warning)" }}> · 上传中</span> : skuMedia.assetId ? <span style={{ color: "var(--success)" }}> · 已上传</span> : <span style={{ color: "var(--danger)" }}> · 未上传</span>}
                {skuMedia.kind === "image" && skuMedia.w && skuMedia.h ? (isSquare ? <span style={{ color: "var(--success)" }}> · 1:1 ✓</span> : <span style={{ color: "var(--warning)" }}> · 非 1:1,建议裁剪</span>) : null}
              </span>
              {skuMedia.kind === "image" && skuMedia.w && skuMedia.h && !isSquare && <Btn sm disabled={skuMediaUploading} onClick={() => void cropSquare()}>裁剪为 1:1</Btn>}
              <Btn sm disabled={skuMediaUploading} onClick={() => resetSkuMedia(null)}>移除</Btn>
            </div>}
          </div>
          <section className="col e1-sku-task-policy" aria-labelledby="e1-sku-task-heading">
            <header className="row">
              <span className="e1-sku-task-icon"><Icon name="tree" size={15} /></span>
              <h3 id="e1-sku-task-heading">可跑任务类型</h3>
              {skuTaskClassesReady && <output>已选 <b>{form.allowedTaskClasses.length}/{TASK_CLASSES.length}</b></output>}
            </header>
            <TaskClassChoices selected={form.allowedTaskClasses} onChange={(classes) => setForm({ ...form, allowedTaskClasses: classes })} ready={skuTaskClassesReady} />
            <p className="muted tiny">设备从已选大类的启用任务中随机接单。同类新任务启用后自动加入，正在运行的任务按原配置结算。</p>
          </section>
          <SkuFieldGroup n="①" title="基本信息">
            <SkuFld label="型号名称" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="如 UVELBox Pro v3" />
            <div className="grid g-2" style={{ gap: 12 }}>
              <label className="col" style={{ gap: 5 }}><span className="muted tiny">档位</span><select className="fld" value={form.tier} onChange={(e) => {
                const tier = e.target.value;
                setForm({ ...form, tier, inventoryMode: tier === "Share" ? form.inventoryMode : "FINITE" });
              }}><option value="">请选择档位</option>{SKU_TIER_OPTIONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
              <SkuFld label="营销角标" value={form.badge} onChange={(v) => setForm({ ...form, badge: v })} placeholder="输入活动角标" hint="可自定义" list="sku-badge-presets" />
            </div>
            <datalist id="sku-badge-presets">{SKU_BADGE_PRESETS.map((b) => <option key={b} value={b} />)}</datalist>
            <SkuFld label="商品标语" value={form.tagline} onChange={(v) => setForm({ ...form, tagline: v })} placeholder="个人 AI 算力设备，由平台托管" hint="每款商品单独设置" />
            <div className="grid g-2" style={{ gap: 12 }}>
              <SkuFld label="售价(USD)" type="number" value={form.price} onChange={(v) => setForm({ ...form, price: v })} placeholder="1319" />
              <SkuFld label="每件算力点" type="number" min={0} step={1} value={form.computePoints} onChange={(v) => setForm({ ...form, computePoints: v })} placeholder={editSkuId ? "留空保留原值" : "留空按售价 × 10"} hint="计入团队等级与配额，只影响之后的订单" />
              <SkuFld label="商品编号" value={form.id} onChange={(v) => setForm({ ...form, id: v })} placeholder="uvelbox-pro-v2" disabled={Boolean(editSkuId)} hint={editSkuId ? "创建后不能修改" : undefined} />
            </div>
          </SkuFieldGroup>

          <SkuFieldGroup n="②" title="硬件规格">
            <div className="grid g-2" style={{ gap: 12 }}>
              <SkuFld label="GPU 型号（单卡）" value={form.gpu} onChange={(v) => setForm({ ...form, gpu: v })} placeholder="RTX 4090" />
              <SkuFld label="GPU 数量" type="number" min={1} step={1} value={form.gpuCount} onChange={(v) => setForm({ ...form, gpuCount: v })} placeholder="4" hint="按实际配置填写；留空不会按 1 张计算" />
              <SkuFld label="显存" value={form.vram} onChange={(v) => setForm({ ...form, vram: v })} placeholder="96GB VRAM" />
            </div>
            {form.tier !== "Share" && <div className="grid g-2" style={{ gap: 12 }}>
              <SkuFld label="算力" value={form.hashRate} onChange={(v) => setForm({ ...form, hashRate: v })} placeholder="1,240 MH/s" />
              <SkuFld label="功耗 / 功率说明" value={form.power} onChange={(v) => setForm({ ...form, power: v })} placeholder="1,800W（GPU 额定合计）" hint="注明是单卡、显卡合计还是整机实测" />
            </div>}
            <label className="col" style={{ gap: 5 }}>
              <span className="muted tiny">数据中心<span style={{ color: "var(--ink-4)" }}> · 在「设备运行管理」增删改</span></span>
              <select className="fld" value={form.datacenter} onChange={(e) => setForm({ ...form, datacenter: e.target.value })}>
                {skuDatacenterOptions.length === 0 && <option value="">暂无数据中心</option>}
                {staleSkuDatacenter && <option value={staleSkuDatacenter}>{staleSkuDatacenter} · 旧值（现在不能选）</option>}
                {skuDatacenterOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <div className="grid g-2" style={{ gap: 12 }}>
              <SkuFld label="在线率" value={form.uptime} onChange={(v) => setForm({ ...form, uptime: v })} placeholder="99.9%" />
              <SkuFld label="质保期限" value={form.warranty} onChange={(v) => setForm({ ...form, warranty: v })} placeholder="24 个月" />
            </div>
          </SkuFieldGroup>

          <SkuFieldGroup n="③" title={form.tier === "Share" ? "收益（参考年奖励率 + UVT）" : "收益（USDT + UVT）"}>
            {form.tier !== "Share" ? (
              <div className="grid g-2" style={{ gap: 12 }}>
                <SkuFld label="每日收益 USDT" type="number" value={form.dailyEarn} onChange={(v) => setForm({ ...form, dailyEarn: v })} placeholder="38.50" />
                <SkuFld label="每日收益 UVT" type="number" value={form.dailyEarnNEX} onChange={(v) => setForm({ ...form, dailyEarnNEX: v })} placeholder="65" />
                <SkuFld label="手机每日收益 USDT" type="number" min={0} step={0.000001} value={form.phoneDailyEarn} onChange={(v) => setForm({ ...form, phoneDailyEarn: v })} placeholder="0.06" hint="可留空，留空时 App 不显示" />
                <SkuFld label="手机每日收益 UVT" type="number" min={0} step={0.000001} value={form.phoneDailyEarnNEX} onChange={(v) => setForm({ ...form, phoneDailyEarnNEX: v })} placeholder="10" hint="可留空，留空时 App 不显示" />
              </div>
            ) : (
              <>
                <div className="grid g-2" style={{ gap: 12 }}>
                  <SkuFld label="共享份额参考年奖励率下限 %" type="number" value={form.shareYieldMin} onChange={(v) => setForm({ ...form, shareYieldMin: v })} placeholder="8" />
                  <SkuFld label="共享份额参考年奖励率上限 %" type="number" value={form.shareYieldMax} onChange={(v) => setForm({ ...form, shareYieldMax: v })} placeholder="15" />
                </div>
                <SkuFld label="每日额外发放 UVT" type="number" value={form.dailyEarnNEX} onChange={(v) => setForm({ ...form, dailyEarnNEX: v })} placeholder="30" />
              </>
            )}
          </SkuFieldGroup>

          <SkuFieldGroup n="④" title="AI 性能">
            {form.tier !== "Share" && <>
              <div className="grid g-2" style={{ gap: 12 }}>
                <SkuFld label="图像生成 张/分钟" type="number" value={form.aiImageGenPerMin} onChange={(v) => setForm({ ...form, aiImageGenPerMin: v })} placeholder="320" />
                <SkuFld label="大模型推理（词元/秒）" type="number" value={form.aiLlmTokensPerSec} onChange={(v) => setForm({ ...form, aiLlmTokensPerSec: v })} placeholder="12400" />
              </div>
              <div className="grid g-2" style={{ gap: 12 }}>
                <SkuFld label="每小时可渲染视频时长（分钟）" type="number" value={form.aiVideoMinPerHour} onChange={(v) => setForm({ ...form, aiVideoMinPerHour: v })} placeholder="18" />
                <SkuFld label="LoRA 微调（分钟）" type="number" value={form.aiFineTuneMins} onChange={(v) => setForm({ ...form, aiFineTuneMins: v })} placeholder="6" />
              </div>
            </>}
            <label className="col" style={{ gap: 5 }}>
              <span className="muted tiny">{form.tier === "Share" ? "解锁算力池（份额可访问的池）" : "解锁算力池"}</span>
              <select className="fld" value={form.aiUnlocks} onChange={(e) => setForm({ ...form, aiUnlocks: e.target.value })} disabled={skuUnlockPoolOptions.length === 0}>
                <option value="">{e2Loading ? "任务列表加载中" : skuUnlockPoolOptions.length ? "请选择算力池" : "暂无可选任务"}</option>
                {skuUnlockPoolOptions.map((item) => <option key={item.id} value={item.id}>{nexGridBrandText(item.name)}</option>)}
              </select>
            </label>
          </SkuFieldGroup>

          <SkuFieldGroup n="" title="相关资料">
            <SkuFld label="资料名称" value={form.specDocumentTitle} onChange={(v) => setForm({ ...form, specDocumentTitle: v })} placeholder="厂商规格或产品说明" />
            <SkuFld label="资料链接" value={form.specDocumentUrl} onChange={(v) => setForm({ ...form, specDocumentUrl: v })} placeholder="https://" hint="填写与该商品匹配的公开资料链接；清空名称和链接可移除" />
          </SkuFieldGroup>

          <SkuFieldGroup n="⑤" title="营销与销量信息">
            <div className="grid g-2" style={{ gap: 12 }}>
              <label className="col" style={{ gap: 5 }}>
                <span className="muted tiny">库存模式</span>
                <select className="fld" value={form.inventoryMode} onChange={(e) => {
                  const inventoryMode = e.target.value === "UNLIMITED" ? "UNLIMITED" : "FINITE";
                  setForm({ ...form, inventoryMode, stock: inventoryMode === "UNLIMITED" ? "" : form.stock });
                }}>
                  <option value="FINITE">有限库存（卖一件少一件）</option>
                  {form.tier === "Share" && <option value="UNLIMITED">无限库存（非实物份额商品）</option>}
                </select>
                <span className="muted tiny">无限库存只能用于共享份额商品，成交后只增加销量，不减库存。</span>
              </label>
              <label className="col" style={{ gap: 5 }}>
                <span className="muted tiny">累计销量</span>
                <span className="tiny" style={{ color: "var(--ink-3)", minHeight: 34, display: "flex", alignItems: "center" }}>按已付款订单自动累计，新商品从 0 开始，不能手动修改。</span>
              </label>
            </div>
            {form.inventoryMode !== "UNLIMITED" && <SkuFld label="库存" type="number" min={0} step={1} value={form.stock} onChange={(v) => setForm({ ...form, stock: v })} placeholder="47" hint="必填，0 表示售罄（不会自动下架）" />}
          </SkuFieldGroup>

          <SkuFieldGroup n="⑥" title="生命周期与上架">
            <label className="col" style={{ gap: 6 }}>
              <span className="muted tiny">允许试用</span>
              <span className="row" style={{ alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={form.trialEligible === "true"}
                  onChange={(e) => setForm({ ...form, trialEligible: e.target.checked ? "true" : "false" })}
                />
                <span className="tiny">{form.trialEligible === "true" ? "可在「免费试用设置」里选为试用商品" : "不允许试用（默认）"}</span>
              </span>
              <span className="muted tiny">关闭后，「免费试用设置」就不能再选这个商品。</span>
            </label>
            <div className="grid g-2" style={{ gap: 12 }}>
              <label className="col" style={{ gap: 5 }}><span className="muted tiny">生命周期</span><select className="fld" value={form.lifecycle} onChange={(e) => setForm({ ...form, lifecycle: e.target.value })}><option value="">请选择生命周期</option>{SKU_LIFECYCLE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            </div>
            {form.tier !== "Share" && <>
              <div className="grid g-2" style={{ gap: 12 }}>
                <label className="col e-field"><span className="muted tiny"><AutoGloss>开放阶段</AutoGloss></span><select className="fld" value={form.unlock} onChange={(e) => setForm({ ...form, unlock: e.target.value })} disabled={skuPhaseIds.length === 0}><option value="">{skuPhaseIds.length === 0 ? "请先配置阶段" : "请选择开放阶段"}</option>{skuPhaseIds.map((p) => <option key={p} value={p}>{e1PhaseLabel(p)}{p === phaseCur ? " · 当前阶段 · A2 执行后 App 进入正常商品区" : ""}</option>)}</select></label>
              </div>
            </>}
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">特性清单 · 每行一条</span><textarea className="fld" style={{ minHeight: 72, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} placeholder={"UVEL 托管服务\n设备规格\n服务说明"} /></label>
          </SkuFieldGroup>

          <SkuFieldGroup n="⑦" title="购买条件与限量">
            <div className="tint tiny">设置用户需满足什么条件才能购买，App 下单时会自动检查。不设条件就是所有人都能买。</div>
            <label className="col" style={{ gap: 5 }}>
              <span className="muted tiny">购买条件类型</span>
              <select className="fld" value={form.gateType} onChange={(e) => setForm({ ...form, gateType: e.target.value as SkuForm["gateType"] })}>
                <option value="none">无用户条件</option>
                <option value="activeDirect">活跃直接邀请人数</option>
                <option value="rank">最低会员等级</option>
                <option value="combo">组合条件（会员等级 / 直接邀请 / 团队算力点）</option>
              </select>
            </label>
            {form.gateType !== "none" && <>
              <div className="grid g-2" style={{ gap: 12 }}>
                {(form.gateType === "rank" || form.gateType === "combo") && <SkuFld label="最低会员等级" type="number" min={0} max={8} step={1} value={form.gateRankMin} onChange={(v) => setForm({ ...form, gateRankMin: v })} placeholder="0" hint="0–8；0 为不设条件" />}
                {(form.gateType === "activeDirect" || form.gateType === "combo") && <SkuFld label="活跃直接邀请人数" type="number" min={0} step={1} value={form.gateActiveDirectMin} onChange={(v) => setForm({ ...form, gateActiveDirectMin: v })} placeholder="0" hint="非负整数；0 为不设条件" />}
                {form.gateType === "combo" && <SkuFld label="团队算力点" type="number" min={0} step={1} value={form.gateTeamComputePointsMin} onChange={(v) => setForm({ ...form, gateTeamComputePointsMin: v })} placeholder="0" hint="非负整数；0 为不设条件" />}
              </div>
              {form.gateType === "combo" && <label className="col" style={{ gap: 5 }}>
                <span className="muted tiny">多条件关系</span>
                <select className="fld" value={form.gateMode} onChange={(e) => setForm({ ...form, gateMode: e.target.value as SkuForm["gateMode"] })}>
                  <option value="all">全部满足</option>
                  <option value="either">任一满足</option>
                </select>
              </label>}
            </>}
            <div className="grid g-2" style={{ gap: 12 }}>
              <SkuFld label="本期可售上限" type="number" min={1} step={1} value={form.gateQuotaCap} onChange={(v) => setForm({ ...form, gateQuotaCap: v })} placeholder="留空 = 不限量" hint="留空不限量" />
              <label className="col" style={{ gap: 5 }}>
                <span className="muted tiny">本期已售数量</span>
                <input className="fld" type="number" min={0} step={1} value={form.gateQuotaSold} readOnly aria-readonly="true" />
              </label>
            </div>
            {(form.gateType !== "none" || form.gateQuotaCap.trim()) && <div className="grid g-2" style={{ gap: 12 }}>
              <label className="col" style={{ gap: 5 }}>
                <span className="muted tiny">售卖统计周期</span>
                <select className="fld" value={form.gateQuotaPeriod} onChange={(e) => setForm({ ...form, gateQuotaPeriod: e.target.value as SkuForm["gateQuotaPeriod"] })}>
                  <option value="lifetime">不分周期（累计）</option>
                </select>
                {form.gateQuotaPeriod === "month" && <span className="muted tiny">按月统计已停用，请改为「不分周期」后保存</span>}
              </label>
              <label className="col" style={{ gap: 5 }}>
                <span className="muted tiny">售罄后限制购买</span>
                <select className="fld" value={form.gateEnforce} onChange={(e) => setForm({ ...form, gateEnforce: e.target.value as SkuForm["gateEnforce"] })}>
                  <option value="true">卖完后不能再买</option>
                  <option value="false">卖完只显示售罄，仍可购买</option>
                </select>
              </label>
            </div>}
          </SkuFieldGroup>

          {(() => {
            if (form.tier === "Share") {
              const lo = skuNum(form.shareYieldMin); const hi = skuNum(form.shareYieldMax); const nex = skuNum(form.dailyEarnNEX); const pr = skuNum(form.price);
              const complete = form.shareYieldMin.trim() !== "" && form.shareYieldMax.trim() !== "" && lo > 0 && hi >= lo;
              return <div className="tint cyan tiny">估算 · {complete ? <>参考年奖励率 <span className="nowrap">{lo}–{hi}%</span></> : "参考年奖励率区间暂不可用"} · 每日收益 <span className="nowrap">{nex.toLocaleString()} UVT/天</span>{pr > 0 ? <> · 起购 <span className="nowrap">${pr.toLocaleString()}</span></> : null}</div>;
            }
            const p = skuNum(form.price); const d = skuNum(form.dailyEarn);
            return p > 0 && d > 0 ? <div className="tint cyan tiny">估算 · 回本 ≈ <span className="nowrap">{Math.round(p / d)} 天</span> · 首年净 ≈ <span className="nowrap">${(d * 365 - p).toLocaleString()}</span> · 参考年奖励率 ≈ <span className="nowrap">{Math.round((d * 365 / p) * 100)}%</span> · vs 手机 ≈ <span className="nowrap">{Math.round(d / 0.08).toLocaleString()}×</span></div> : null;
          })()}
          <div className="tint warn tiny"><AutoGloss>价格、每日收益和状态修改需确认后才生效；新商品确认后才会上架</AutoGloss></div>
        </div>
      </Drawer>}

      {/* 任务新增 抽屉 */}
      {taskDrawer && <Drawer title={editTaskId ? "编辑任务" : "新增任务"} sub={<AutoGloss>{editTaskId ? "修改后需确认，只对之后新派的任务生效" : "新增任务类型，确认后对新任务生效"}</AutoGloss>} onClose={() => { setTaskDrawer(false); setEditTaskId(null); }}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => { setTaskDrawer(false); setEditTaskId(null); }}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!canMutateE2Tasks || !taskForm.n.trim()} onClick={editTaskId ? submitTaskEdit : submitTask}>{editTaskId ? "保存修改" : "提交新增"}</Btn></>}>
        <div className="col" style={{ gap: 12 }}>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">任务名称</span><input className="fld" value={taskForm.n} onChange={(e) => setTaskForm({ ...taskForm, n: e.target.value })} placeholder="如 大模型推理 405B" /></label>
          {taskForm.simulated ? <>
            <div className="grid g-2" style={{ gap: 12 }}>
              <SkuFld label="固定时长（分钟）" type="number" value={taskForm.durationMinutes} onChange={(v) => setTaskForm({ ...taskForm, durationMinutes: v })} hint="1–1440，整数分钟" />
              <SkuFld label="固定基础奖励" value={taskForm.baseReward} onChange={(v) => setTaskForm({ ...taskForm, baseReward: v })} hint="最多 6 位小数" />
              <label className="col" style={{ gap: 5 }}><span className="muted tiny">奖励资产</span><select className="fld" value={taskForm.asset} onChange={(e) => setTaskForm({ ...taskForm, asset: e.target.value })}><option value="USDT">USDT</option><option value="UVT">UVT</option></select></label>
              <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={taskForm.enabled} onChange={(e) => setTaskForm({ ...taskForm, enabled: e.target.checked })} />启用新任务</label>
              <label className="col" style={{ gap: 5 }}><span className="muted tiny">展示类别</span><select className="fld" value={taskForm.taskClass || "EM"} onChange={(e) => setTaskForm({ ...taskForm, taskClass: e.target.value })}>{["IG", "VG", "LL", "FT", "EM", "SP"].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            </div>
            <div className="tint tiny">商品及手机类别单独勾选可跑类型。各类型等概率抽取；发布修改只影响之后的新任务，运行中任务保留原版本。{taskForm.version ? ` 当前版本 v${taskForm.version}` : ""}</div>
          </> : <>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny"><AutoGloss>单价(USDT)</AutoGloss></span><input className="fld" type="number" value={taskForm.price} onChange={(e) => setTaskForm({ ...taskForm, price: e.target.value })} placeholder="1.20" /></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">计价单位</span><div className="row wrap" style={{ gap: 6 }}>{["/job", "/1k", "/min"].map((u) => <Chip key={u} tab sel={taskForm.unit === u} onClick={() => setTaskForm({ ...taskForm, unit: u })}>{({ "/job": "每项任务", "/1k": "每千单位", "/min": "每分钟" } as Record<string,string>)[u]}</Chip>)}</div></label>
          </div>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">设备要求<span style={{ color: "var(--ink-4)" }}> · 手机+ 表示手机也能接</span></span><div className="row wrap" style={{ gap: 6 }}>{["手机+", "S1+", "需 UVELBox Pro", "需 UVELRack"].map((r) => <Chip key={r} tab sel={taskForm.req === r} onClick={() => setTaskForm({ ...taskForm, req: r })}>{r}</Chip>)}</div></label>
          <SkuFld label="初始饱和度 %（预估）" type="number" value={taskForm.sat} onChange={(v) => setTaskForm({ ...taskForm, sat: v })} placeholder="50" hint="0-100" />
          {/* #36 任务核心配置:taskClass / 代表模型 / 奖励区间 / 最低显存 / kill 初始态 */}
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">任务类型</span>
              <select className="fld" value={taskForm.taskClass} onChange={(e) => setTaskForm({ ...taskForm, taskClass: e.target.value, ...(!editTaskId && TASK_DURATION_DEFAULTS[e.target.value] ? { expectedDurationMinSec: String(TASK_DURATION_DEFAULTS[e.target.value]), expectedDurationMaxSec: String(TASK_DURATION_DEFAULTS[e.target.value]) } : {}) })}>
                <option value="">请选择任务类型</option>
                {["IG", "VG", "LL", "FT", "EM", "SP"].map((c) => <option key={c} value={c}>{({IG:"图像生成",VG:"视频生成",LL:"大模型推理",FT:"模型微调",EM:"向量计算",SP:"语音处理"} as Record<string,string>)[c]}</option>)}
              </select>
            </label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">代表模型</span><input className="fld" value={taskForm.model} onChange={(e) => setTaskForm({ ...taskForm, model: e.target.value })} placeholder="如 Llama-3.1-405B" /></label>
          </div>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">最低奖励（USDT）</span><input className="fld" type="number" value={taskForm.minReward} onChange={(e) => setTaskForm({ ...taskForm, minReward: e.target.value })} placeholder="0.80" /></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">最高奖励（USDT）</span><input className="fld" type="number" value={taskForm.maxReward} onChange={(e) => setTaskForm({ ...taskForm, maxReward: e.target.value })} placeholder="2.40" /></label>
          </div>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">抽选权重（1–1000000）</span><input className="fld" type="number" min={1} max={1000000} step={1} value={taskForm.selectionWeight} onChange={(e) => setTaskForm({ ...taskForm, selectionWeight: e.target.value })} /></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">执行超时（秒，可留空沿用）</span><input className="fld" type="number" min={1} max={172800} step={1} value={taskForm.executionTimeoutSec} onChange={(e) => setTaskForm({ ...taskForm, executionTimeoutSec: e.target.value })} /></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">预计最短时长（秒）</span><input className="fld" type="number" min={1} max={86400} step={1} value={taskForm.expectedDurationMinSec} onChange={(e) => setTaskForm({ ...taskForm, expectedDurationMinSec: e.target.value })} /></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">预计最长时长（秒）</span><input className="fld" type="number" min={1} max={86400} step={1} value={taskForm.expectedDurationMaxSec} onChange={(e) => setTaskForm({ ...taskForm, expectedDurationMaxSec: e.target.value })} /></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">执行器标识</span><input className="fld" maxLength={96} value={taskForm.runtimeKey} onChange={(e) => setTaskForm({ ...taskForm, runtimeKey: e.target.value })} /></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">独立校验器标识</span><input className="fld" maxLength={96} value={taskForm.validatorKey} onChange={(e) => setTaskForm({ ...taskForm, validatorKey: e.target.value })} /></label>
          </div>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">任务输入配置（JSON 对象，最多 16KB）</span><textarea className="fld" rows={4} value={taskForm.workloadConfigJson} onChange={(e) => setTaskForm({ ...taskForm, workloadConfigJson: e.target.value })} placeholder="留空沿用服务端配置" /></label>
          <div className="tint tiny">预计时长只用于展示；排队不计运行时长。只有已安装且通过能力校验的执行器才可接单，填写标识不会安装执行器。配置仅影响新派任务。</div>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">最低显存（GB）</span><input className="fld" type="number" min={0} step={1} value={taskForm.minVRAM.replace(/GB$/i, "")} onChange={(e) => setTaskForm({ ...taskForm, minVRAM: e.target.value })} placeholder="80" /></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">初始接单状态</span><div className="row wrap" style={{ gap: 6 }}>{["派发中", "已 kill", "限流中"].map((k) => <Chip key={k} tab sel={taskForm.killInit === k} onClick={() => setTaskForm({ ...taskForm, killInit: k })}>{k === "已 kill" ? "已停止接单" : k === "派发中" ? "正常接单" : "限量接单"}</Chip>)}</div></label>
          </div>
          <div className="tint warn tiny"><AutoGloss>单价、设备要求和任务类型修改后需确认，只对之后新派的任务生效，用户任务页同步更新。</AutoGloss></div>
          </>}
        </div>
      </Drawer>}

      {/* E5 数据中心新增 / 编辑抽屉 */}
      {dcDrawer && <Drawer title={editDcLocation ? "编辑数据中心" : "新增数据中心"} sub={<AutoGloss>保存后生效</AutoGloss>} onClose={() => { setDcDrawer(false); setEditDcLocation(null); }}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => { setDcDrawer(false); setEditDcLocation(null); }}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!dcForm.dcLocation.trim() || !dcForm.regionLabel.trim() || !dcForm.location.trim() || !dcForm.displayName.trim()} onClick={openDatacenterSaveConfirm}>{editDcLocation ? "保存修改" : "提交新增"}</Btn></>}>
        <div className="col" style={{ gap: 12 }}>
          <label className="col" style={{ gap: 5 }}>
            <span className="muted tiny">数据中心编号</span>
            <input className="fld" value={dcForm.dcLocation} onChange={(e) => setDcForm({ ...dcForm, dcLocation: e.target.value })} placeholder="us-east-2" />
          </label>
          <label className="col" style={{ gap: 5 }}>
            <span className="muted tiny">区域</span>
            <input className="fld" value={dcForm.regionLabel} onChange={(e) => setDcForm({ ...dcForm, regionLabel: e.target.value })} placeholder="美国 · 弗吉尼亚" />
          </label>
          <label className="col" style={{ gap: 5 }}>
            <span className="muted tiny">所在地</span>
            <input className="fld" value={dcForm.location} onChange={(e) => setDcForm({ ...dcForm, location: e.target.value })} placeholder="美国弗吉尼亚州阿什本" />
          </label>
          <label className="col" style={{ gap: 5 }}>
            <span className="muted tiny">展示名称</span>
            <input className="fld" value={dcForm.displayName} onChange={(e) => setDcForm({ ...dcForm, displayName: e.target.value })} placeholder="美东算力中心" />
          </label>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}>
              <span className="muted tiny">状态</span>
              <select className="fld" value={dcForm.status} onChange={(e) => setDcForm({ ...dcForm, status: e.target.value as DatacenterForm["status"] })}>
                {DC_STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="col" style={{ gap: 5 }}>
              <span className="muted tiny">排序</span>
              <input className="fld" type="number" min={0} value={dcForm.sortOrder} onChange={(e) => setDcForm({ ...dcForm, sortOrder: e.target.value })} placeholder="100" />
            </label>
          </div>
          <div className="tint warn tiny"><AutoGloss>删除数据中心不会删除设备库存；暂停或恢复派单请在「设备运行管理」操作。</AutoGloss></div>
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
        reasonMax={200}
        completionCopy={mc.orderId ? undefined : "批准后生效：提交后请另一位超级管理员在「操作记录与审批」中批准。"}
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
          try {
            if (mc.op === "bundle-discount" && businessValue) {
              const current = e1BundleDiscount;
              if (!current) { setToast("组合优惠设置加载失败，请刷新后重试"); return; }
              const next = {
                twoItemsPct: Number(businessValue.twoItemsPct),
                threeItemsPct: Number(businessValue.threeItemsPct),
                fourPlusItemsPct: Number(businessValue.fourPlusItemsPct),
              };
              if (Object.values(next).some((value) => !Number.isFinite(value) || value < 0.01 || value > 30)
                  || next.threeItemsPct < next.twoItemsPct
                  || next.fourPlusItemsPct < next.threeItemsPct) {
                setToast("折扣须在 0.01%–30% 之间，且买得越多折扣不能越少");
                return;
              }
              const def = findHighOp("e1_bundle_discount")!;
              const commandContext = { ...next, expectedVersion: current.version };
              await propose(ctx.toast, {
                action: mc.name,
                obj: "App 组合购阶梯折扣",
                before: `v${current.version} · 2 件 ${current.twoItemsPct}% · 3 件 ${current.threeItemsPct}% · 4+ 件 ${current.fourPlusItemsPct}%`,
                after: `2 件 ${next.twoItemsPct}% · 3 件 ${next.threeItemsPct}% · 4+ 件 ${next.fourPlusItemsPct}%`,
                type: def.type,
                amplifies: def.amplifies,
                gate: { roles: [] },
                gateLabel: def.gateLabel,
                reason,
                sourceDomain: "E1",
                command: def.buildCommand(commandContext),
                target: def.buildTarget(commandContext),
              });
            } else if (mc.op === "sku-save") {
              if (e1Gates?.skuReviewContractVersion !== 1) {
                throw new Error("商品审核暂时不可用，请刷新后重试；已填写的内容会保留");
              }
              const ex = editSkuId ? skus.find((x) => x.id === editSkuId) : undefined;
              const sku = attachSkuMedia(formToSku(form, ex), skuMedia);
              const skuId = editSkuId ?? (form.id.trim() || form.name.trim());
              const def = findHighOp(editSkuId ? "e1_sku_update" : "e1_sku_create")!;
              if (editSkuId && !ex) {
                setToast("商品信息已更新，请重新打开商品后再提交");
                setActionConfirm(null);
                return;
              }
              if (ex && !summarizeSkuProposal(ex, sku, { includeDerived: false })) {
                setToast("没有任何修改，无需提交");
                setActionConfirm(null);
                return;
              }
              const summary = ex ? summarizeSkuProposal(ex, sku) : summarizeSkuCreation(sku);
              await propose(ctx.toast, {
                action: mc.name, obj: skuId,
                before: summary?.before ?? "未创建",
                after: summary?.after ?? "未配置",
                type: def.type, amplifies: false, gate: { roles: [] }, gateLabel: def.gateLabel, reason,
                sourceDomain: "E1",
                command: def.buildCommand({ skuId, ...sku }),
                target: def.buildTarget({ skuId }),
              });
              setEditSkuId(null);
              resetSkuMedia(null);
            } else if (mc.op === "sku-delete" && mc.target) {
              const sku = skus.find((x) => x.id === mc.target);
              const skuId = mc.target;
              const def = findHighOp("e1_sku_delete")!;
              await propose(ctx.toast, {
                action: mc.name, obj: skuId, before: sku?.name ?? skuId, after: "已移除", type: def.type, amplifies: false,
                gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E1",
                command: def.buildCommand({ skuId, updatedAt: sku?.updatedAt }),
                target: def.buildTarget({ skuId }),
              });
            } else if (mc.op === "sku-status" && mc.target) {
              const sku = skus.find((x) => x.id === mc.target);
              const skuId = mc.target;
              const def = findHighOp("e1_sku_status")!;
              await propose(ctx.toast, {
                action: mc.name, obj: skuId, before: sku?.name ?? skuId, after: mc.status === "off" ? "下架" : "上架",
                type: def.type, amplifies: false, gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E1",
                command: def.buildCommand({ skuId, status: String(mc.status ?? ""), updatedAt: sku?.updatedAt }),
                target: def.buildTarget({ skuId }),
              });
            } else if (mc.op === "task-create") {
              // 任务 create:taskId 后端序列生成;propose 时未知,锁 id 暂空(create-id 已知缺口,可接受)。
              const price = Number(taskForm.price) || 0;
              const minR = Number(taskForm.minReward), maxR = Number(taskForm.maxReward);
              const sat = taskForm.sat.trim() ? Math.max(0, Math.min(100, Number(taskForm.sat))) / 100 : null;
              const def = findHighOp("e2_task_create")!;
              const taskCtx = {
                taskId: "", name: taskForm.n.trim(), price, unit: taskForm.unit, requirement: taskForm.req,
                saturation: sat, status: "active", taskClass: taskForm.taskClass, model: taskForm.model.trim(),
                minReward: minR, maxReward: maxR, minVram: taskForm.minVRAM.trim(), killInit: taskForm.killInit,
                ...taskComputeConfig(), simulation: taskSimulation(),
              };
              await propose(ctx.toast, {
                action: mc.name, obj: taskForm.n.trim(), before: "—", after: taskForm.n.trim() + " · taskClass=" + taskForm.taskClass,
                type: def.type, amplifies: false, gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E2",
                command: def.buildCommand(taskCtx),
                target: def.buildTarget(taskCtx),
              });
              setEditTaskId(null);
            } else if (mc.op === "task-down" && mc.taskId) {
              const def = findHighOp("e2_task_delete")!;
              await propose(ctx.toast, {
                action: mc.name, obj: mc.taskId, before: mc.target ?? mc.taskId, after: "已下架", type: def.type, amplifies: false,
                gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E2",
                command: def.buildCommand({ taskId: mc.taskId }),
                target: def.buildTarget({ taskId: mc.taskId }),
              });
            } else if (mc.op === "task-price" && mc.taskId) {
              const v = Number(newValue);
              if (!(Number.isFinite(v) && v > 0)) { setToast("请填写有效单价"); return; }
              const def = findHighOp("e2_task_price")!;
              await propose(ctx.toast, {
                action: mc.name, obj: mc.taskId, before: String(v), after: String(v), type: def.type, amplifies: true,
                gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E2",
                command: def.buildCommand({ taskId: mc.taskId, price: v }),
                target: def.buildTarget({ taskId: mc.taskId }),
              });
            } else if (mc.op === "task-save" && editTaskId) {
              const price = Number(taskForm.price) || 0;
              const minR = Number(taskForm.minReward), maxR = Number(taskForm.maxReward);
              const sat = taskForm.sat.trim() ? Math.max(0, Math.min(100, Number(taskForm.sat))) / 100 : null;
              const currentTask = tasks.find((task) => task.id === editTaskId);
              if (!currentTask) { setToast("任务已更新，请重新打开后再编辑"); return; }
              const def = findHighOp("e2_task_update")!;
              const taskCtx = {
                taskId: editTaskId, name: taskForm.n.trim(), price, unit: taskForm.unit, requirement: taskForm.req,
                saturation: sat, status: currentTask.status, taskClass: taskForm.taskClass, model: taskForm.model.trim(),
                minReward: minR, maxReward: maxR, minVram: taskForm.minVRAM.trim(), killInit: taskForm.killInit,
                ...taskComputeConfig(), simulation: taskSimulation(),
              };
              await propose(ctx.toast, {
                action: mc.name, obj: editTaskId, before: "编辑前任务", after: taskForm.n.trim(), type: def.type, amplifies: false,
                gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E2",
                command: def.buildCommand(taskCtx),
                target: def.buildTarget(taskCtx),
              });
              setEditTaskId(null);
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
            } else if (mc.op === "early-access" && businessValue) {
              const enabled = businessValue.enabled === "开" || businessValue.enabled === "true";
              const leadDays = Number(businessValue.leadDays);
              if (![7, 14, 30, 60, 90].includes(leadDays)) { setToast("提前天数只能选 7、14、30、60 或 90 天"); return; }
              const def = findHighOp("e1_early_access_update")!;
              await propose(ctx.toast, {
                action: mc.name, obj: "置换侧抢先购", before: `${pE("E.release.earlyAccess.enabled")} · ${pE("E.release.earlyAccess.leadDays")} 天`, after: `${enabled ? "开" : "关"} · ${leadDays} 天`,
                type: def.type, amplifies: false, gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E1",
                command: def.buildCommand({ enabled, leadDays }), target: def.buildTarget({}),
              });
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
            } else if (mc.op === "phase-save" && businessValue) {
              const label = businessValue.label?.trim() ?? "";
              const phaseCtx = {
                phaseId: mc.phaseId ?? "", label, meta: businessValue.meta?.trim() ?? "", skus: businessValue.skus?.trim() ?? "",
                sortOrder: Number(businessValue.sortOrder), status: (businessValue.status as string) || "active",
              };
              const def = findHighOp(mc.phaseId ? "e1_phase_patch" : "e1_phase_create")!;
              await propose(ctx.toast, {
                action: mc.name, obj: mc.phaseId ?? label, before: mc.phaseId ? "编辑前阶段" : "—", after: label, type: def.type, amplifies: false,
                gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E1",
                command: def.buildCommand(phaseCtx),
                target: def.buildTarget(phaseCtx),
              });
            } else if (mc.op === "phase-archive" && mc.phaseId) {
              const def = findHighOp("e1_phase_archive")!;
              await propose(ctx.toast, {
                action: mc.name, obj: mc.phaseId, before: mc.target ?? mc.phaseId, after: "已归档", type: def.type, amplifies: false,
                gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E1",
                command: def.buildCommand({ phaseId: mc.phaseId }),
                target: def.buildTarget({ phaseId: mc.phaseId }),
              });
            } else if (mc.op === "generation-gate-save" && businessValue) {
              const gateCtx = {
                skuId: String(businessValue.skuId ?? ""), name: businessValue.name?.trim() ?? "", releaseMonth: Number(businessValue.releaseMonth),
                phase: String(businessValue.phase ?? ""), eligibility: businessValue.eligibility === "true",
                phaseOffset: Number(businessValue.phaseOffset || "0"), forceUnlock: businessValue.forceUnlock === "true", status: "active",
              };
              const def = findHighOp(mc.generationGateId ? "e1_gate_patch" : "e1_gate_create")!;
              await propose(ctx.toast, {
                action: mc.name, obj: mc.generationGateId ?? gateCtx.skuId, before: mc.generationGateId ? "编辑前上架条件" : "—", after: gateCtx.skuId,
                type: def.type, amplifies: false, gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E1",
                command: def.buildCommand(gateCtx),
                target: def.buildTarget(gateCtx),
              });
            } else if (mc.op === "generation-gate-force" && mc.generationGateId && mc.generationGate?.forceUnlock != null) {
              const enabled = !!mc.generationGate.forceUnlock;
              const def = findHighOp("e1_gate_field")!;
              const key = `E.gen.${mc.generationGateId}.forceUnlock`;
              await propose(ctx.toast, {
                action: mc.name, obj: mc.generationGateId, before: enabled ? "未强制" : "已强制", after: enabled ? "已强制开放" : "已撤销强制",
                type: def.type, amplifies: enabled, gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E1",
                command: def.buildCommand({ key, value: String(enabled) }),
                target: { domain: "E", type: def.targetType, id: mc.generationGateId },
              });
            } else if (mc.op === "generation-gate-archive" && mc.generationGateId) {
              const def = findHighOp("e1_gate_archive")!;
              await propose(ctx.toast, {
                action: mc.name, obj: mc.generationGateId, before: mc.generationGateId, after: "已归档", type: def.type, amplifies: false,
                gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E1",
                command: def.buildCommand({ skuId: mc.generationGateId }),
                target: def.buildTarget({ skuId: mc.generationGateId }),
              });
            } else if (mc.op === "order-state" && mc.orderId && mc.fixedVal) {
              const def = findHighOp("e4_order_state")!;
              if (await sendE4Proposal({
                action: mc.name, obj: mc.orderId, before: stateLabel(effOrderState(mc.orderId)), after: stateLabel(mc.fixedVal), type: def.type, amplifies: false,
                gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E4",
                command: def.buildCommand({ orderNo: mc.orderId, state: mc.fixedVal }),
                target: def.buildTarget({ orderNo: mc.orderId }),
              })) setSelOrder(null);
            } else if (mc.op === "order-refund" && mc.orderId) {
              const refundChannel = (businessValue?.refundChannel ?? mc.fixedVal ?? "").trim();
              if (!refundChannel) { throw new Error("请选择退款渠道"); }
              const refundReasonCode = (businessValue?.refundReasonCode ?? "").trim();
              if (!(E4_REFUND_REASONS as readonly string[]).includes(refundReasonCode)) { throw new Error("请选择退款原因"); }
              const def = findHighOp("e4_order_refund")!;
              if (await sendE4Proposal({
                action: mc.name, obj: mc.orderId, before: stateLabel(effOrderState(mc.orderId)), after: "已退款", type: def.type, amplifies: true,
                gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E4",
                command: def.buildCommand({ orderNo: mc.orderId, refundChannel, refundReasonCode }),
                target: def.buildTarget({ orderNo: mc.orderId }),
              })) setSelOrder(null);
            } else if (mc.op === "order-cancel" && mc.orderId) {
              const closeReasonCode = (businessValue?.closeReasonCode ?? "").trim();
              if (!E4_CLOSE_REASONS.cancelled.includes(closeReasonCode)) { throw new Error("请选择取消原因"); }
              const def = findHighOp("e4_order_cancel")!;
              if (await sendE4Proposal({
                action: mc.name, obj: mc.orderId, before: stateLabel(effOrderState(mc.orderId)), after: "已取消", type: def.type, amplifies: false,
                gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E4",
                command: def.buildCommand({ orderNo: mc.orderId, closeReasonCode }),
                target: def.buildTarget({ orderNo: mc.orderId }),
              })) setSelOrder(null);
            } else if (mc.op === "order-terminal" && mc.orderId) {
              const v = (businessValue?.terminalState ?? mc.fixedVal ?? "").trim();
              if (!v) { throw new Error("请选择失败结果"); }
              const choices = E4_CLOSE_REASONS[v];
              const closeReasonCode = choices ? (businessValue?.closeReasonCode ?? "").trim() : "";
              if (choices && !choices.includes(closeReasonCode)) { throw new Error("请选择原因"); }
              const def = findHighOp("e4_order_terminal")!;
              if (await sendE4Proposal({
                action: mc.name, obj: mc.orderId, before: stateLabel(effOrderState(mc.orderId)), after: stateLabel(v), type: def.type, amplifies: false,
                gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E4",
                command: def.buildCommand({ orderNo: mc.orderId, terminalState: v, closeReasonCode }),
                target: def.buildTarget({ orderNo: mc.orderId }),
              })) setSelOrder(null);
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
            } else if (mc.op === "dc-save" && mc.dcForm) {
              const dcCtx = {
                dcLocation: mc.dcForm.dcLocation.trim(), regionLabel: mc.dcForm.regionLabel.trim(),
                oldDcLocation: mc.dc ?? mc.dcForm.dcLocation.trim(),
                location: mc.dcForm.location.trim(), displayName: mc.dcForm.displayName.trim(),
                status: mc.dcForm.status, sortOrder: Number(mc.dcForm.sortOrder),
              };
              const def = findHighOp(mc.isNew ? "e5_datacenter_create" : "e5_datacenter_update")!;
              await propose(ctx.toast, {
                action: mc.name, obj: dcCtx.dcLocation, before: mc.isNew ? "—" : "编辑前数据中心", after: dcCtx.dcLocation + " · " + dcCtx.regionLabel,
                type: def.type, amplifies: false, gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E5",
                command: def.buildCommand(dcCtx),
                target: def.buildTarget(dcCtx),
              });
              setEditDcLocation(null);
            } else if (mc.op === "dc-delete" && mc.dc) {
              const def = findHighOp("e5_datacenter_delete")!;
              await propose(ctx.toast, {
                action: mc.name, obj: mc.dc, before: mc.dc, after: "已删除", type: def.type, amplifies: false,
                gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E5",
                command: def.buildCommand({ dcLocation: mc.dc }),
                target: def.buildTarget({ dcLocation: mc.dc }),
              });
            } else if (mc.op === "ops-pause" && mc.dc) {
              // pause/resume 按 fixedVal 选 op:false→resume(放大)、true→pause(收缩)
              const paused = mc.fixedVal === "true";
              const def = findHighOp(paused ? "e5_datacenter_pause" : "e5_datacenter_resume")!;
              await propose(ctx.toast, {
                action: mc.name, obj: mc.dc, before: paused ? "派单中" : "已暂停", after: paused ? "已暂停派单" : "已恢复派单",
                type: def.type, amplifies: !paused, gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E5",
                command: def.buildCommand({ dcLocation: mc.dc }),
                target: def.buildTarget({ dcLocation: mc.dc }),
              });
            } else { setToast("已确认生效"); }
          } catch (error) {
            // 不在这里再 toast 一次:本 try 块内每条会失败的路径都经 propose(含 proposeParam),
            // 它在 rethrow 前已 toast 过;这里再弹就是同一个错误两条。
            // 反馈不丢:rethrow 后确认弹窗的 alertbar 会经 displayAdminError 显示同一错误。
            throw error;
          }
          setActionConfirm(null);
          if (mc.orderId) void refreshE4();
        }} />}
      {toastNode}
    </>
  );
  return tab === "E4" ? <RdPage>{page}</RdPage> : <div className="dkpage edom">{page}</div>;
}
