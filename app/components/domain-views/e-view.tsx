"use client";

/**
 * E 设备与商城 — 设计稿 design_handoff_e_domain 内容视图。
 * 全系统统一连续编号 E1-E5:E1 商品目录&上架门 / E2 收益&任务引擎 /
 * E3 生命周期&Trade-in / E4 订单状态机 / E5 设备运维。
 * nav id == 视图 key == prdAnchor == PRD §10 章节(已全部重编号统一,FOLD 现为恒等映射)。
 *
 * 本 shell 持有全部共享 store 接线 + SKU / 任务 / 订单详情抽屉 + OperationConfirmModal;
 * 各 tab 视觉/布局拆到 e-tabs/*(复用 design-kit 原语 + e-domain.css 设计类),经 EViewCtx 注入派生读 + 回调。
 * 真写落点:E1 SKU/上架门、E2 任务引擎、E3 生命周期&Trade-in、E4 订单状态机、E5 设备运维走后端 API。
 * 操作确认 显式 edit 契约:调参(param / task-price)传 edit{kind,current,unit};处置/纯动作(sku-status / param-fixed / order-* / ops-pause)不传 edit。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Icon, Btn, Chip, Drawer, KV, Badge, OperationConfirmModal, useToast } from "./design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { OpsSku, OpsTask } from "@/lib/admin/platform-types";
import {
  fetchE1Catalog,
  type E1GenerationGateData,
} from "@/lib/admin/e1-client";
import { fetchE2PhoneTiers, fetchE2TaskPricing, fetchE2Tasks, type E2PhoneTier, type E2TaskPricingSnapshot } from "@/lib/admin/e2-client";
import { fetchE3Snapshot, type E3OperationMetric, type E3Stats } from "@/lib/admin/e3-client";
import { fetchE4OrderDetail, fetchE4OrderPage, type E4OrderDetail } from "@/lib/admin/e4-client";
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
import { A2OutcomeUncertainError, createA2CommandKey } from "@/lib/admin/a2-client";
import type { ProposeSpec } from "@/lib/admin/propose-or-execute";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { refreshAdminMediaPreviewUrl, uploadAdminMedia } from "@/lib/admin/media-client";
import {
  FOLD, ORDER_FLOW, TERMINAL_STATES,
  EMPTY_SKU_FORM, type SkuForm, skuToForm, formToSku, formToGate, gateRemaining, validateGateForm, skuNum, stateLabel, ostate,
} from "./e-tabs/data";
import type { DatacenterForm, Mc, EViewCtx, EOrder } from "./e-tabs/types";
import { E1Catalog } from "./e-tabs/e1-catalog";
import { E2Tasks } from "./e-tabs/e2-tasks";
import { E3Lifecycle } from "./e-tabs/e3-lifecycle";
import { E3Manual } from "./e-tabs/e3-manual";
import { E4Orders } from "./e-tabs/e4-orders";
import { E5Ops } from "./e-tabs/e5-ops";
import { E6ComputeConfig as E6ComputeConfigComp } from "./e-tabs/e6-compute-config";
import "./e-domain.css";

/** E 域 A2 提交稳定命令号:槽位=动作名|目标对象,指纹=终值+结构化命令+理由。
 *  落 sessionStorage,结果未知后哪怕刷新页面,同弹窗同输入重试仍复用同一命令号被后端去重。 */
const commandAttempts = createSlotAttemptStore({ storageKey: "nexion-admin-e-domain-commands-v1" });

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
  { value: "active", label: "在产" },
  { value: "legacy", label: "停代" },
] as const;
const DC_STATUS_OPTIONS: { value: DatacenterForm["status"]; label: string }[] = [
  { value: "active", label: "启用中" },
  { value: "maintenance", label: "维护中" },
  { value: "disabled", label: "已禁用" },
];

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
  if (!sku.imagePreviewUrl || !sku.imageAssetId || !sku.imageObjectKey) return null;
  const kind = mediaKindFromPath(sku.imageObjectKey);
  return {
    kind,
    src: sku.imagePreviewUrl,
    name: sku.imageObjectKey.split("/").pop() || (kind === "video" ? "商品视频" : "商品主图"),
    size: 0,
    assetId: sku.imageAssetId,
    objectKey: sku.imageObjectKey,
    previewUrl: sku.imagePreviewUrl,
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
function SkuFld({ label, value, onChange, placeholder, type = "text", hint, list, min, max, step }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; hint?: string; list?: string; min?: number; max?: number; step?: number }) {
  return (
    <label className="col" style={{ gap: 5 }}>
      <span className="muted tiny">{label}{hint ? <span style={{ color: "var(--ink-4)" }}> · {hint}</span> : null}</span>
      <input className="fld" type={type} list={list} min={min} max={max} step={step} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

// 营销角标不在前端预置;已有值来自后端 SKU,新增值由运营明确输入。
const SKU_BADGE_PRESETS: readonly string[] = [];

export function EDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const [tab] = useState(FOLD[meta.l2Id] ?? "E1");
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
  const propose = async (toast: (message: string) => void, spec: ProposeSpec) => {
    if (spec.commandKey) return rawPropose(toast, spec); // 显式携号的调用点尊重原号
    const slot = `${spec.action}|${spec.obj}`;
    const fingerprint = JSON.stringify([spec.after, spec.command, spec.reason]);
    const commandKey = commandAttempts.resolve(slot, fingerprint, () => createA2CommandKey("e-domain-action"));
    try {
      const result = await rawPropose(toast, { ...spec, commandKey });
      commandAttempts.forget(slot);
      return result;
    } catch (error) {
      if (!(error instanceof A2OutcomeUncertainError)) commandAttempts.forget(slot);
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
  const [e1Gates, setE1Gates] = useState<E1GenerationGateData | null>(null);
  const [e1Loading, setE1Loading] = useState(false);
  const [e1Error, setE1Error] = useState<string | null>(null);
  const refreshE1 = useCallback(async () => {
    setE1Loading(true);
    setE1Error(null);
    try {
      const snapshot = await fetchE1Catalog();
      setE1Skus(snapshot.skus);
      setE1Gates(snapshot.gates);
    } catch (error) {
      setE1Error(error instanceof Error ? error.message : "E1_SYNC_FAILED");
      setE1Skus([]);
      setE1Gates(null);
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

  // ── E2 任务引擎:服务端数据为单一来源 ──
  const [tasks, setTasks] = useState<OpsTask[]>([]);
  const [phoneTiers, setPhoneTiers] = useState<E2PhoneTier[]>([]);
  const [e2Pricing, setE2Pricing] = useState<E2TaskPricingSnapshot | null>(null);
  const [e2Loading, setE2Loading] = useState(false);
  const [e2Error, setE2Error] = useState<string | null>(null);
  const refreshE2 = useCallback(async () => {
    setE2Loading(true);
    setE2Error(null);
    try {
      const [nextTasks, nextPhoneTiers, nextPricing] = await Promise.all([
        fetchE2Tasks(), fetchE2PhoneTiers(), fetchE2TaskPricing(),
      ]);
      setTasks(nextTasks);
      setPhoneTiers(nextPhoneTiers);
      setE2Pricing(nextPricing);
    } catch (error) {
      setE2Error(error instanceof Error ? error.message : "E2_SYNC_FAILED");
      setTasks([]);
      setPhoneTiers([]);
      setE2Pricing(null);
    } finally {
      setE2Loading(false);
    }
  }, []);
  useEffect(() => { if (tab === "E1" || tab === "E2") void refreshE2(); }, [tab, refreshE2]);

  // ── E3 生命周期 & Trade-in:服务端配置 / 概览 / tx 监控为单一来源 ──
  const refreshE3 = useCallback(async () => {
    setE3Loading(true);
    setE3Error(null);
    try {
      const snapshot = await fetchE3Snapshot();
      setE3Params(snapshot.params);
      setE3Stats(snapshot.stats);
      setE3Operations(snapshot.operations);
    } catch (error) {
      setE3Error(error instanceof Error ? error.message : "E3_SYNC_FAILED");
      setE3Params({});
      setE3Stats(null);
      setE3Operations([]);
    } finally {
      setE3Loading(false);
    }
  }, []);
  useEffect(() => { if (tab === "E1" || tab === "E3") void refreshE3(); }, [tab, refreshE3]);

  // ── E4 订单状态机:服务端数据为单一来源 ──
  const [orders, setOrders] = useState<EOrder[]>([]);
  const [e4Loading, setE4Loading] = useState(false);
  const [e4Error, setE4Error] = useState<string | null>(null);
  const [e4Page, setE4Page] = useState(1);
  const [e4PageSize, setE4PageSizeState] = useState(10);
  const [e4Total, setE4Total] = useState(0);
  const [e4Filter, setE4FilterState] = useState("all");
  const [e4Keyword, setE4KeywordState] = useState("");
  const setE4PageSize = useCallback((pageSize: number) => {
    setE4PageSizeState(pageSize);
    setE4Page(1);
  }, []);
  const setE4Filter = useCallback((filter: string) => {
    setE4FilterState(filter);
    setE4Page(1);
  }, []);
  const setE4Keyword = useCallback((keyword: string) => {
    setE4KeywordState(keyword);
    setE4Page(1);
  }, []);
  const refreshE4 = useCallback(async () => {
    setE4Loading(true);
    setE4Error(null);
    try {
      const nextPage = await fetchE4OrderPage({
        state: e4Filter === "all" ? undefined : e4Filter,
        keyword: e4Keyword,
        pageNum: e4Page,
        pageSize: e4PageSize,
      });
      setOrders(nextPage.records);
      setE4Total(nextPage.total);
      setE4Page(nextPage.pageNum);
      setE4PageSizeState(nextPage.pageSize);
    } catch (error) {
      setE4Error(error instanceof Error ? error.message : "E4_SYNC_FAILED");
      setOrders([]);
      setE4Total(0);
    } finally {
      setE4Loading(false);
    }
  }, [e4Filter, e4Keyword, e4Page, e4PageSize]);
  useEffect(() => { if (tab === "E4") void refreshE4(); }, [tab, refreshE4]);
  useEffect(() => {
    if (tab !== "E4") return;
    const refreshOnReturn = () => { if (document.visibilityState === "visible") void refreshE4(); };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [tab, refreshE4]);
  const openOrder = useCallback(async (order: EOrder) => {
    setSelOrder(order);
    setE4Detail(null);
    setE4DetailError(null);
    setE4DetailLoading(true);
    try {
      setE4Detail(await fetchE4OrderDetail(order.id));
    } catch (error) {
      setE4DetailError(error instanceof Error ? error.message : "E4_DETAIL_FAILED");
    } finally {
      setE4DetailLoading(false);
    }
  }, []);
  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);
  const orderState = useCallback((order: EOrder): string => orderById.get(order.id)?.state ?? order.state, [orderById]);
  const isRefunded = useCallback((id: string): boolean => orderById.get(id)?.state === "refunded", [orderById]);
  const isCancelled = useCallback((id: string): boolean => orderById.get(id)?.state === "cancelled", [orderById]);
  const terminalOf = useCallback((id: string): string | undefined => {
    const state = orderById.get(id)?.state;
    return state && (TERMINAL_STATES as readonly string[]).includes(state) ? state : undefined;
  }, [orderById]);

  // ── E5 设备运维:服务端 fleet / overview 为单一来源 ──
  const [e5Devices, setE5Devices] = useState<E5Device[]>([]);
  const [e5Overview, setE5Overview] = useState<E5Overview | null>(null);
  const [e5Datacenters, setE5Datacenters] = useState<E5Datacenter[]>([]);
  const [e5Loading, setE5Loading] = useState(tab === "E5");
  const [e5Error, setE5Error] = useState<string | null>(null);
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
    setE5Error(null);
    try {
      const [nextDevicePage, nextOverview, nextDatacenters] = await Promise.all([
        fetchE5Devices({ pageNum: e5Page, pageSize: e5PageSize,
          keyword: e5Keyword, status: e5StateFilter, kind: e5KindFilter, heartbeat: e5HeartbeatFilter }),
        fetchE5Overview(),
        fetchE5Datacenters(),
      ]);
      setE5Devices(nextDevicePage.records);
      setE5Total(nextDevicePage.total);
      setE5Page(nextDevicePage.pageNum);
      setE5PageSizeState(nextDevicePage.pageSize);
      setE5Overview(nextOverview);
      setE5Datacenters(nextDatacenters);
    } catch (error) {
      setE5Error(error instanceof Error ? error.message : "E5_SYNC_FAILED");
      setE5Devices([]);
      setE5Total(0);
      setE5Overview(null);
      setE5Datacenters([]);
    } finally {
      setE5Loading(false);
    }
  }, [e5HeartbeatFilter, e5Keyword, e5KindFilter, e5Page, e5PageSize, e5StateFilter]);
  useEffect(() => { if (tab === "E5") void refreshE5(); }, [tab, refreshE5]);
  const e5PausedDcs = useMemo(() => new Map(e5Datacenters.map((dc) => [dc.dcLocation, dc.dispatchPaused])), [e5Datacenters]);
  const isDcPaused = (dc: string): boolean => e5PausedDcs.get(dc) ?? false;
  const runE5DeviceAction = useCallback(async (deviceId: number, action: "activate" | "deactivate", reason: string) => {
    if (action === "activate") await activateE5Device(deviceId, false, reason, operator);
    else await deactivateE5Device(deviceId, false, reason, operator);
    await refreshE5();
    setToast(action === "activate" ? "设备已激活" : "设备已取消激活");
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
      setE6Error(error instanceof Error ? error.message : "E6_SYNC_FAILED");
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
  const [editName, setEditName] = useState<string | null>(null);
  const mediaSeq = useRef(0);
  const [taskDrawer, setTaskDrawer] = useState(false);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState<{ n: string; price: string; req: string; unit: string; sat: string; taskClass: string; model: string; minReward: string; maxReward: string; minVRAM: string; killInit: string }>({ n: "", price: "", req: "", unit: "", sat: "", taskClass: "", model: "", minReward: "", maxReward: "", minVRAM: "", killInit: "" });
  const editedSku = editName ? skus.find((sku) => sku.name === editName) : undefined;
  const skuFormChanged = !editName || !editedSku
    || JSON.stringify(form) !== JSON.stringify(skuToForm(editedSku))
    || (skuMedia?.assetId ?? "") !== (editedSku.imageAssetId ?? "");
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
      setToast("媒体预览链接刷新失败,请重新上传或稍后重试");
    }
  }, [setToast]);

  // ── 回调(注入 ctx)──
  const openSku = (name?: string) => {
    if (!tasks.length && !e2Loading) void refreshE2();
    if (!e5Datacenters.length && !e5Loading) void refreshE5();
    if (name) {
      const s = skus.find((x) => x.name === name);
      if (s) {
        const media = skuMediaFromSku(s);
        setForm(skuToForm(s));
        setEditName(name);
        resetSkuMedia(media);
        if (media?.assetId) void refreshCurrentSkuMediaPreview(media.assetId);
      }
      else { setForm({ ...EMPTY_SKU_FORM, unlock: e1PhaseIds[0] ?? "" }); setEditName(null); resetSkuMedia(null); }
    } else { setForm({ ...EMPTY_SKU_FORM, unlock: e1PhaseIds[0] ?? "" }); setEditName(null); resetSkuMedia(null); }
    setSkuDrawer(true);
  };
  const delSku = (name: string) => {
    openActionConfirm({
      name: "删除 SKU · " + name,
      op: "sku-delete",
      target: name,
      detail: `删除「${name}」:从商品目录移除,不影响已售设备,但会影响前台商品列表、详情页入口和后续购买。需填写操作理由 + 审计留痕。`,
      businessForm: {
        kind: "destructive-reason",
        target: name,
        impact: "商品目录与用户端购买入口会移除;已售设备订单和账本不回溯。",
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
    const sortOrder = Number(dcForm.sortOrder);
    if (!editDcLocation && !dcLocation) { setToast("请填写 DC 标识"); return; }
    if (!regionLabel || !location || !displayName) { setToast("请填写区域、所在地与前端展示名"); return; }
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
    openActionConfirm({
      name: (editDcLocation ? "编辑数据中心 · " : "新增数据中心 · ") + normalized.dcLocation,
      op: "dc-save",
      dc: editDcLocation ?? normalized.dcLocation,
      dcForm: normalized,
      isNew: !editDcLocation,
      detail: `${editDcLocation ? "更新" : "新增"}数据中心:${normalized.dcLocation} · ${normalized.location} · ${normalized.displayName} · 状态 ${statusLabel} · ID 变更时同步迁移设备与暂停状态。`,
    });
    setDcDrawer(false);
  };
  const deleteDatacenter = (dc: E5Datacenter) => {
    openActionConfirm({
      name: "删除数据中心 · " + dc.dcLocation,
      op: "dc-delete",
      dc: dc.dcLocation,
      detail: `软删除 ${dc.dcLocation} 数据中心卡片配置。服务端会硬阻断仍被 E5 设备、E4 待履约订单或 E1 SKU 引用的数据中心；三类引用计数全部为 0 后才允许删除。提交前还需核对 A2 无相关待确认申请，并填写操作理由完成审计留痕。`,
      businessForm: {
        kind: "destructive-reason",
        target: dc.dcLocation,
        impact: "E5 数据中心卡片列表会移除该配置。服务端确认无跨域引用后才执行软删除，并同步清理数据中心运营状态；不会删除设备库存。",
      },
    });
  };
  // 任务表单校验(新增 + 编辑共用):取值完整性,非锁死业务值。
  const validateTaskForm = (): string | null => {
    const price = Number(taskForm.price) || 0;
    if (!taskForm.n.trim() || !price) return "请填写任务名称 + 单价";
    if (!taskForm.unit.trim() || !taskForm.req.trim() || !taskForm.killInit.trim()) return "请补全计价单位 / 资格门槛 / kill 初始状态";
    const satText = taskForm.sat.trim();
    if (satText) {
      const sat = Number(satText);
      if (!Number.isFinite(sat) || sat < 0 || sat > 100) return "饱和度需为 0-100";
    }
    // #36 核心配置字段校验:taskClass / 代表模型 / min·maxReward / minVRAM 必填,reward 区间须 min ≤ max
    if (!taskForm.taskClass.trim() || !taskForm.model.trim() || !taskForm.minVRAM.trim()) return "请补全 taskClass / 代表模型 / minVRAM";
    const minR = Number(taskForm.minReward), maxR = Number(taskForm.maxReward);
    const minVram = Number(taskForm.minVRAM.replace(/GB$/i, "").trim());
    if (!Number.isFinite(minR) || !Number.isFinite(maxR) || minR < 0 || maxR < minR) return "奖励区间非法:需 0 ≤ minReward ≤ maxReward";
    if (!Number.isInteger(minVram) || minVram < 0) return "minVRAM 需为不小于 0 的整数 GB";
    return null;
  };
  const openAddTask = () => { setEditTaskId(null); setTaskForm({ n: "", price: "", req: "", unit: "", sat: "", taskClass: "", model: "", minReward: "", maxReward: "", minVRAM: "", killInit: "" }); setTaskDrawer(true); };
  // 编辑任务:把任务字段回填到抽屉全字段。
  const openEditTask = (t: OpsTask) => {
    setTaskForm({
      n: t.n, price: String(t.price), req: t.req, unit: t.unit, sat: t.sat == null ? "" : String(Math.round(t.sat * 100)),
      taskClass: t.taskClass || "", model: t.model || "",
      minReward: t.minReward != null ? String(t.minReward) : "", maxReward: t.maxReward != null ? String(t.maxReward) : "",
      minVRAM: t.minVRAM || "", killInit: t.killInit || "",
    });
    setEditTaskId(t.id);
    setTaskDrawer(true);
  };
  const submitTask = () => {
    const err = validateTaskForm();
    if (err) { setToast(err); return; }
    openActionConfirm({ name: "新增任务 · " + taskForm.n.trim(), op: "task-create", detail: `新增任务「${taskForm.n.trim()}」全字段(单价 / 资格门槛 / taskClass / 代表模型 / 奖励区间 / minVRAM / kill 初始态)· server-canonical · 进入 A2 待确认队列,批准后对新派单生效。` });
    setTaskDrawer(false);
  };
  // 编辑提交:校验后走操作确认(高敏 · 改单价/门槛/taskClass server-canonical)→ onConfirm 真写 updateTask。
  const submitTaskEdit = () => {
    const err = validateTaskForm();
    if (err) { setToast(err); return; }
    openActionConfirm({ name: "编辑任务 · " + taskForm.n.trim(), op: "task-save", detail: `编辑任务「${taskForm.n.trim()}」全字段(单价 / 资格门槛 / taskClass / 代表模型 / 奖励区间 / minVRAM / kill 初始态)· server-canonical,改后对新派单生效,已派工单维持原配置完成 · 须操作确认。` });
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
    const refSkus = skuLabelsUsingTask(t.id, t.n);
    if (refSkus.length > 0) {
      setToast(`任务无法下架:${t.n} 正在被 E1 SKU 使用:${refSkus.join("、")}。请先到 E1 修改这些 SKU 的解锁算力池。`);
      return;
    }
    openActionConfirm({
      name: "下架任务 · " + t.n,
      op: "task-down",
      taskId: t.id,
      target: t.n,
      detail: `下架「${t.n}」:停止派单并从 /earn 任务池移除。需填写操作理由、确认影响并写 A2 审计。`,
      businessForm: {
        kind: "destructive-reason",
        target: t.n,
        impact: "任务池不再派发该任务;已完成或已结算任务不回溯。",
      },
    });
  };

  // ── 产品媒体上传(SKU 抽屉)──
  const onPickSkuMedia = async (file?: File) => {
    if (!file) return;
    const kind = inferSkuMediaKind(file);
    if (!kind) { setToast("请上传图片或视频文件:JPG / PNG / WebP / GIF / MP4 / WebM / MOV"); return; }
    const maxBytes = kind === "image" ? SKU_MAX_IMAGE_BYTES : SKU_MAX_VIDEO_BYTES;
    if (file.size > maxBytes) { setToast(`${kind === "image" ? "图片" : "视频"}超过 ${mediaSizeLabel(maxBytes)},请压缩后再传`); return; }

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
          entityId: form.id.trim() || form.name.trim() || editName || "draft-sku",
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
        setToast("媒体上传失败:" + (error instanceof Error ? error.message : "MEDIA_UPLOAD_FAILED"));
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
        entityId: form.id.trim() || form.name.trim() || editName || "draft-sku",
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
        setToast("裁剪上传失败:" + (error instanceof Error ? error.message : "SKU_MEDIA_CROP_FAILED"));
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
    if (e2Loading) return "E2 任务列表正在加载,请稍后再提交";
    return "解锁算力池请选择 E2 6 类任务中的一项";
  };
  const canUseE1Writes = canWriteE1 && !e1Loading && !e1Error && e1Gates !== null;
  const openSkuSaveConfirm = () => {
    if (skuMediaUploading) { setToast("媒体仍在上传,请稍后提交"); return; }
    if (skuMedia && !skuMedia.assetId) { setToast("媒体未上传成功,请重新选择文件"); return; }
    if (!form.tier.trim() || !form.lifecycle.trim()) {
      setToast("请补全档位 / 生命周期");
      return;
    }
    const datacenter = form.datacenter.trim();
    if (!datacenter) {
      setToast(skuDatacenterDefault
        ? "请选择一个当前有效的数据中心"
        : "请先在 E5 配置至少一个数据中心,再保存 SKU");
      return;
    }
    // 已有 SKU 可继续保留已删除 DC 的历史展示名，避免编辑其它字段时静默改写部署中心。
    // 新 SKU 则必须显式选择当前 E5 配置中的有效展示名。
    if (!skuDatacenterSet.has(datacenter) && !editName) {
      setToast("请选择 E5 当前有效的数据中心");
      return;
    }
    const poolErr = validateSkuUnlockPool();
    if (poolErr) { setToast(poolErr); return; }
    const stock = form.stock.trim();
    if (stock && (!/^\d+$/.test(stock) || !Number.isSafeInteger(Number(stock)))) {
      setToast("库存必须是非负整数,或留空表示不限量");
      return;
    }
    const gErr = validateGateForm(form);
    if (gErr) { setToast(gErr); return; }
    openActionConfirm({ name: (editName ? "编辑 SKU · " : "新增 SKU · ") + (form.name || "未命名"), op: "sku-save", isNew: !editName, hasImg: !!skuMedia });
    setSkuDrawer(false);
  };

  const ctx: EViewCtx = {
    pE, openActionConfirm, toast: setToast,
    canWriteE1: canUseE1Writes, skus, e1Loading, e1Error, e1Gates, phaseCur, refreshE1, openSku, delSku,
    canWriteE2, tasks, phoneTiers, e2Pricing, e2Loading, e2Error, refreshE2, openAddTask, openEditTask, delTask,
    canWriteE3, e3Ready, e3Loading, e3Error, e3Stats, e3Operations, refreshE3,
    canWriteE4, canRefundE4, orders, e4Loading, e4Error, e4Page, e4PageSize, e4Total, e4Filter, e4Keyword, setE4Page, setE4PageSize, setE4Filter, setE4Keyword, refreshE4, orderState, isCancelled, isRefunded, terminalOf, openOrder,
    canWriteE5, canForceActivateE5, canUnbindE5, canPauseDcE5,
    runE5DeviceAction, runE5UserBatch,
    e5Devices, e5Overview, e5Datacenters, e5Loading, e5Error, e5Page, e5PageSize, e5Total,
    e5Keyword, e5StateFilter, e5KindFilter, e5HeartbeatFilter, setE5Keyword, setE5StateFilter, setE5KindFilter, setE5HeartbeatFilter,
    setE5Page, setE5PageSize, refreshE5, isDcPaused, openDatacenter, deleteDatacenter,
    canWriteE6, canToggleE6, e6Config, e6Loading, e6Error, refreshE6,
  };

  // ── 批6 A2 propose 辅助(壳集中回调,被 onConfirm 复用)──
  // 取订单当前 live 态(基于 orderById),用于 propose 的 before 描述。
  const effOrderState = (orderId: string): string => orderState({ id: orderId } as EOrder);
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
    if (isE6ParamKey(paramKey)) {
      const def = findHighOp("e6_compute_config")!;
      await propose(ctx.toast, {
        action, obj: paramKey, before, after: value, type: def.type, amplifies: amplify,
        gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E6",
        command: def.buildCommand({ paramKey, value }),
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
    tab === "E1" ? (canUseE1Writes ? <button className="f-cta" onClick={() => openSku()}>+ 新增 SKU</button> : undefined)
      : tab === "E2" ? (canWriteE2 ? <button className="f-cta" onClick={openAddTask}>+ 新增任务</button> : undefined)
        : tab === "E3" ? <button className="f-cta manual" onClick={() => setManualOpen(true)}><Icon name="doc" size={15} /> 操作说明手册</button>
          : undefined;

  return (
    <div className="dkpage edom">
      <DomainHeader {...meta} right={headerRight} />

      {tab === "E1" && <E1Catalog ctx={ctx} />}
      {tab === "E2" && <E2Tasks ctx={ctx} />}
      {tab === "E3" && <E3Lifecycle ctx={ctx} />}
      {tab === "E4" && <E4Orders ctx={ctx} />}
      {tab === "E5" && <E5Ops ctx={ctx} />}
      {tab === "E6" && <E6ComputeConfigComp ctx={ctx} />}

      {/* E3 操作说明手册弹窗(右上角按钮触发) */}
      {tab === "E3" && manualOpen && <E3Manual ctx={ctx} onClose={() => setManualOpen(false)} />}

      {/* 订单详情抽屉 */}
      {selOrder && (() => {
        const o = orderById.get(selOrder.id) ?? selOrder;
        const eff = orderState(o);
        const finalized = isCancelled(o.id) || isRefunded(o.id) || !!terminalOf(o.id);
        const canCancel = canWriteE4 && eff === "placed";
        const terminalOptions = eff === "placed" ? ["payment_failed", "expired"]
          : eff === "paid" ? ["chargeback"]
            : eff === "provisioning" ? ["provisioning_failed"] : [];
        const idx = ORDER_FLOW.indexOf(eff);
        const hasSettledFunding = e4Detail?.funding.some((item) => {
          const source = item.source.toUpperCase();
          const status = item.status.toUpperCase();
          return ["PAID", "SUCCESS", "POSTED", "COMPLETED"].includes(status)
            && (source === "D1_PAYMENT"
              || ((source === "D4_LEDGER" || source === "D4_BILL") && item.direction.toUpperCase() === "OUT"));
        }) === true;
        const hasAllocatedDevice = !!e4Detail?.deviceId
          && !!e4Detail.deviceInstanceNo
          && !!o.dc && o.dc !== "—";
        const nextState = canWriteE4 && !finalized
          ? eff === "paid" && hasSettledFunding && hasAllocatedDevice
            ? "provisioning"
            : eff === "provisioning" && !!e4Detail?.deviceActivatedAt
              ? "activated"
              : undefined
          : undefined;
        const progressBlock = eff === "placed"
          ? { code: "ORDER_PAYMENT_CONFIRMATION_REQUIRED", text: "等待 D1 / PSP 或 D4 确认真实支付，后台不能手工伪造已支付。" }
          : eff === "paid" && (!hasSettledFunding || !hasAllocatedDevice)
            ? { code: "ORDER_PROVISIONING_EVIDENCE_REQUIRED", text: "须先存在已结算资金证据，并由 E5 绑定设备与数据中心。" }
            : eff === "provisioning" && !e4Detail?.deviceActivatedAt
              ? { code: "ORDER_DEVICE_ACTIVATION_REQUIRED", text: "须先由 E5 真正激活设备，E4 才能确认订单完成。" }
              : null;
        const refundableState = ["paid", "provisioning", "activated"].includes(eff);
        const refundReady = canRefundE4 && refundableState && e4Detail?.refundAllowed === true;
        const closeOrder = () => { setSelOrder(null); setE4Detail(null); setE4DetailError(null); };
        const coverageText = e4Detail?.coverageCurrent == null
          ? "覆盖率不可用"
          : `当前 ${e4Detail.coverageCurrent.toFixed(2)}% → 执行后 ${(e4Detail.coverageProjected ?? e4Detail.coverageCurrent).toFixed(2)}% · 红线 ${(e4Detail.coverageRedline ?? 0).toFixed(2)}%`;
        return (
          <Drawer title={o.id} sub={`${o.sku} · ${o.user}`} onClose={closeOrder}
            footer={<>
                  {nextState && <Btn onClick={() => openActionConfirm({ name: `推进订单 · ${o.id} → ${stateLabel(nextState)}`, op: "order-state", orderId: o.id, fixedVal: nextState, amplify: false, detail: `手动推进 ${o.id} 状态机:${stateLabel(eff)} → ${stateLabel(nextState)} · 须操作确认` })}>推进下一态</Btn>}
                  {canCancel && <Btn onClick={() => openActionConfirm({ name: "取消订单 · " + o.id, op: "order-cancel", orderId: o.id, amplify: false, detail: `取消 ${o.id}(${stateLabel(eff)})· 未扣款订单终止后续流程 · 须操作确认 + 审计留痕` })}>取消订单</Btn>}
                  {canWriteE4 && terminalOptions.length > 0 && <Btn onClick={() => openActionConfirm({ name: "落定失败终态 · " + o.id, op: "order-terminal", orderId: o.id, amplify: false, edit: { kind: "select", options: terminalOptions }, detail: `按当前 ${stateLabel(eff)} 状态落定合法失败终态;退款不走此入口 · 须操作确认 + 审计留痕` })}>落定失败终态</Btn>}
                  {canRefundE4 && refundableState && <Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!refundReady} onClick={() => {
                    if (!e4Detail || !refundReady) return;
                    const channels = e4Detail.refundChannels.length ? e4Detail.refundChannels : ["WALLET"];
                    openActionConfirm({
                      name: "退款 · " + o.id, op: "order-refund", orderId: o.id, amplify: true,
                      businessForm: { kind: "multi-field", title: "退款渠道", hint: coverageText, fields: [{ key: "refundChannel", label: "退款渠道", current: channels[0], inputKind: "select", options: channels, optionLabels: { WALLET: "退回 USDT 钱包", ORIGINAL_PAYMENT: "原支付渠道" }, required: true, showDiff: true }] },
                      detail: `退款 ${o.id} · $${o.amt.toLocaleString()} · ${coverageText} · D1/D4/钱包/累计充值同事务回退 · 不可逆`,
                    });
                  }}><AutoGloss>{e4DetailLoading ? "校验退款条件中..." : e4Detail?.refundAllowed === false ? "B1 红线阻断退款" : "退款(操作确认)"}</AutoGloss></Btn>}
                  <Btn style={{ flex: 1, justifyContent: "center" }} onClick={closeOrder}>关闭</Btn>
                </>}>
            <div className="tint" style={{ marginBottom: 14, textAlign: "center" }}><div className="muted tiny">订单金额</div><div style={{ fontSize: 30, fontWeight: 600, color: "var(--ink)" }} className="tnum">${o.amt.toLocaleString()}</div></div>
            <KV k="状态" v={<Badge tone={ostate[eff] ?? "neutral"}>{stateLabel(eff)}</Badge>} />
            {!finalized && <KV k="可达下一态" v={nextState ? stateLabel(nextState) : <span style={{ color: "var(--ink-4)" }}>无可用主路径推进</span>} />}
            {progressBlock && <div className="tint warn tiny" style={{ marginBottom: 10 }} title={progressBlock.code}>{progressBlock.text}</div>}
            <KV k="DC 分配" v={o.dc} />
            <KV k="用户" v={o.user} />
            <KV k="下单时间" v={o.age + " 前"} />
            {e4DetailLoading && <div className="tint tiny">正在读取支付、设备、资金与状态历史...</div>}
            {e4DetailError && <div className="tint warn tiny">详情读取失败:{e4DetailError} <button className="fchip" onClick={() => void openOrder(o)}>重试</button></div>}
            {e4Detail && <>
              <KV k="数量 / 类型" v={`${e4Detail.quantity} · ${e4Detail.orderType}`} />
              <KV k="支付" v={`${e4Detail.paymentMethod} · ${e4Detail.paymentStatus}${e4Detail.paymentNo ? ` · ${e4Detail.paymentNo}` : ""}`} />
              <KV k="设备实例" v={e4Detail.deviceInstanceNo ?? "尚未生成"} />
              <KV k="B1 覆盖率" v={<span style={{ color: e4Detail.refundAllowed ? "var(--ok)" : "var(--danger)" }}>{coverageText}</span>} />
            </>}
            {isCancelled(o.id) && <KV k="取消" v={<span style={{ color: "var(--ink-3)" }}>已取消 · 未支付订单后续流程已终止</span>} />}
            {isRefunded(o.id) && <KV k="退款" v={<span style={{ color: "var(--warning)" }}>已退款 · D1/D4/钱包/累计充值已回退</span>} />}
            {!isCancelled(o.id) && !isRefunded(o.id) && terminalOf(o.id) && <KV k="补建终态" v={<span style={{ color: "var(--warning)" }}>{stateLabel(terminalOf(o.id)!)} · 人工补建</span>} />}
            <div style={{ fontSize: 12.5, fontWeight: 600, margin: "14px 0 8px", color: "var(--ink)" }}>状态轨迹</div>
            <div className="edrawer-trail">
              {ORDER_FLOW.map((s) => { const done = ORDER_FLOW.indexOf(s) <= idx; return <div key={s} className={`it ${done ? "done" : "grey"}`}><span className={`d ${done ? "done" : "grey"}`} /><span className="nm">{stateLabel(s)}</span></div>; })}
              {e4Detail?.history.map((item, index) => <div className="it" key={`${item.createdAt}-${index}`}><span className="d done" /><span className="nm">{stateLabel(item.fromState)} → {stateLabel(item.toState)} · {item.operator} · {item.reason}</span></div>)}
              {isCancelled(o.id) && <div className="it grey"><span className="d grey" /><span className="nm">已取消 · 运营手动取消</span></div>}
              {!isCancelled(o.id) && !isRefunded(o.id) && terminalOf(o.id) && <div className="it red"><span className="d red" /><span className="nm">{stateLabel(terminalOf(o.id)!)} · 人工补建终态</span></div>}
              {isRefunded(o.id) && <div className="it warn"><span className="d warn" /><span className="nm">已退款 · 人工退款</span></div>}
            </div>
            {e4Detail && <><div style={{ fontSize: 12.5, fontWeight: 600, margin: "14px 0 8px", color: "var(--ink)" }}>资金证据</div>
              {e4Detail.funding.length === 0 ? <div className="muted tiny">暂无支付 / D4 流水</div> : e4Detail.funding.map((item, index) => <KV key={`${item.source}-${item.bizNo}-${index}`} k={item.source} v={`${item.direction} ${item.amount.toLocaleString()} USDT · ${item.status} · ${item.bizNo}`} />)}
            </>}
            <div className="chips" style={{ marginTop: 14 }}>
              <Link className="chip" href={`/platform/audit?domain=E&object=${encodeURIComponent(o.id)}`}>A2 审计追踪</Link>
              <Link className="chip" href="/platform/events">A4 订单事件</Link>
              <Link className="chip" href={`/finance/ledger?bizNo=${encodeURIComponent(o.id)}`}>D4 资金流水</Link>
            </div>
          </Drawer>
        );
      })()}

      {/* SKU 新增 / 编辑 抽屉 */}
      {skuDrawer && <Drawer title={editName ? "编辑 SKU" : "新增 SKU"} sub={<AutoGloss>{editName ? "改价 / 库存 / 日产基准 / 上架阶段 · 改后走操作确认" : "填写商品规格 · 提交后走操作确认"}</AutoGloss>} onClose={() => { setSkuDrawer(false); setEditName(null); resetSkuMedia(null); }}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => { setSkuDrawer(false); setEditName(null); resetSkuMedia(null); }}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!form.name || !form.price || !skuFormChanged || skuMediaUploading || (!!skuMedia && !skuMedia.assetId)} onClick={openSkuSaveConfirm}>{editName ? "保存修改" : "提交确认"}</Btn></>}>
        <div className="col" style={{ gap: 12 }}>
          <div className="col" style={{ gap: 5 }}><span className="muted tiny">产品图 / 视频</span>
            <label className={"sku-drop" + (dragOver ? " drag" : "")} style={skuMedia ? { padding: 0, borderStyle: "solid" } : {}}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); void onPickSkuMedia(e.dataTransfer.files[0]); }}>
              <input type="file" accept={SKU_MEDIA_ACCEPT} style={{ display: "none" }} onChange={(e) => { void onPickSkuMedia(e.target.files?.[0]); e.currentTarget.value = ""; }} />
              {skuMedia
                ? skuMedia.kind === "video"
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
          <SkuFieldGroup n="①" title="基本信息">
            <SkuFld label="型号名称" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="如 NexionBox Pro v3" />
            <div className="grid g-2" style={{ gap: 12 }}>
              <label className="col" style={{ gap: 5 }}><span className="muted tiny">档位 tier</span><select className="fld" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}><option value="">请选择档位</option>{["Entry", "Pro", "Flagship", "Share"].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
              <SkuFld label="营销角标 badge" value={form.badge} onChange={(v) => setForm({ ...form, badge: v })} placeholder="输入活动角标" hint="可自定义" list="sku-badge-presets" />
            </div>
            <datalist id="sku-badge-presets">{SKU_BADGE_PRESETS.map((b) => <option key={b} value={b} />)}</datalist>
            <SkuFld label="标语 tagline" value={form.tagline} onChange={(v) => setForm({ ...form, tagline: v })} placeholder="Personal AI inference box · fully managed" hint="每款独立 slogan · 自由文案" />
            <div className="grid g-2" style={{ gap: 12 }}>
              <SkuFld label="售价(USD)" type="number" value={form.price} onChange={(v) => setForm({ ...form, price: v })} placeholder="1319" />
              <SkuFld label="槽位 ID(slug)" value={form.id} onChange={(v) => setForm({ ...form, id: v })} placeholder="stellarbox-pro-v2" />
            </div>
          </SkuFieldGroup>

          <SkuFieldGroup n="②" title="硬件规格">
            <div className="grid g-2" style={{ gap: 12 }}>
              <SkuFld label="GPU" value={form.gpu} onChange={(v) => setForm({ ...form, gpu: v })} placeholder="4× RTX 4090" />
              <SkuFld label="显存 VRAM" value={form.vram} onChange={(v) => setForm({ ...form, vram: v })} placeholder="96GB VRAM" />
            </div>
            {form.tier !== "Share" && <div className="grid g-2" style={{ gap: 12 }}>
              <SkuFld label="算力" value={form.hashRate} onChange={(v) => setForm({ ...form, hashRate: v })} placeholder="1,240 MH/s" />
              <SkuFld label="功率" value={form.power} onChange={(v) => setForm({ ...form, power: v })} placeholder="1,200W TDP" />
            </div>}
            <label className="col" style={{ gap: 5 }}>
              <span className="muted tiny">数据中心 datacenter<span style={{ color: "var(--ink-4)" }}> · 选 E5 数据中心(前端展示名称)· 在 E5 运维增删改</span></span>
              <select className="fld" value={form.datacenter} onChange={(e) => setForm({ ...form, datacenter: e.target.value })}>
                {skuDatacenterOptions.length === 0 && <option value="">E5 暂无数据中心</option>}
                {staleSkuDatacenter && <option value={staleSkuDatacenter}>{staleSkuDatacenter} · 历史值(当前不可选)</option>}
                {skuDatacenterOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          </SkuFieldGroup>

          <SkuFieldGroup n="③" title={form.tier === "Share" ? "收益参数(年化 + NEX)" : "收益参数(双币)"}>
            {form.tier !== "Share" ? (
              <div className="grid g-2" style={{ gap: 12 }}>
                <SkuFld label="日产 USDT" type="number" value={form.dailyEarn} onChange={(v) => setForm({ ...form, dailyEarn: v })} placeholder="38.50" />
                <SkuFld label="日产 NEX" type="number" value={form.dailyEarnNEX} onChange={(v) => setForm({ ...form, dailyEarnNEX: v })} placeholder="65" />
              </div>
            ) : (
              <>
                <div className="grid g-2" style={{ gap: 12 }}>
                  <SkuFld label="共享份额年化下限 %" type="number" value={form.shareYieldMin} onChange={(v) => setForm({ ...form, shareYieldMin: v })} placeholder="8" />
                  <SkuFld label="共享份额年化上限 %" type="number" value={form.shareYieldMax} onChange={(v) => setForm({ ...form, shareYieldMax: v })} placeholder="15" />
                </div>
                <SkuFld label="日产 NEX(份额每日额外发放)" type="number" value={form.dailyEarnNEX} onChange={(v) => setForm({ ...form, dailyEarnNEX: v })} placeholder="30" />
              </>
            )}
          </SkuFieldGroup>

          <SkuFieldGroup n="④" title="AI 性能">
            {form.tier !== "Share" && <>
              <div className="grid g-2" style={{ gap: 12 }}>
                <SkuFld label="图像生成 张/min" type="number" value={form.aiImageGenPerMin} onChange={(v) => setForm({ ...form, aiImageGenPerMin: v })} placeholder="320" />
                <SkuFld label="LLM 推理 tok/s" type="number" value={form.aiLlmTokensPerSec} onChange={(v) => setForm({ ...form, aiLlmTokensPerSec: v })} placeholder="12400" />
              </div>
              <div className="grid g-2" style={{ gap: 12 }}>
                <SkuFld label="视频渲染 s/min" type="number" value={form.aiVideoMinPerHour} onChange={(v) => setForm({ ...form, aiVideoMinPerHour: v })} placeholder="18" />
                <SkuFld label="LoRA 微调 min" type="number" value={form.aiFineTuneMins} onChange={(v) => setForm({ ...form, aiFineTuneMins: v })} placeholder="6" />
              </div>
            </>}
            <label className="col" style={{ gap: 5 }}>
              <span className="muted tiny">{form.tier === "Share" ? "解锁算力池（份额可访问的池）" : "解锁算力池"}</span>
              <select className="fld" value={form.aiUnlocks} onChange={(e) => setForm({ ...form, aiUnlocks: e.target.value })} disabled={skuUnlockPoolOptions.length === 0}>
                <option value="">{e2Loading ? "任务列表加载中" : skuUnlockPoolOptions.length ? "请选择算力池" : "暂无可选任务"}</option>
                {skuUnlockPoolOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          </SkuFieldGroup>

          <SkuFieldGroup n="⑤" title="营销 & 社会证明">
            {form.tier !== "Share" ? (
              <div className="grid g-2" style={{ gap: 12 }}>
                <SkuFld label="累计销量" type="number" value={form.sold} onChange={(v) => setForm({ ...form, sold: v })} placeholder="4821" />
                <SkuFld label="库存 stock" type="number" min={0} step={1} value={form.stock} onChange={(v) => setForm({ ...form, stock: v })} placeholder="47" hint="非负整数;留空=∞" />
              </div>
            ) : (
              <SkuFld label="累计销量" type="number" value={form.sold} onChange={(v) => setForm({ ...form, sold: v })} placeholder="12483" hint="份额无限量,不设库存" />
            )}
          </SkuFieldGroup>

          <SkuFieldGroup n="⑥" title="生命周期 & 上架">
            <div className="grid g-2" style={{ gap: 12 }}>
              <label className="col" style={{ gap: 5 }}><span className="muted tiny">生命周期</span><select className="fld" value={form.lifecycle} onChange={(e) => setForm({ ...form, lifecycle: e.target.value })}><option value="">请选择生命周期</option>{SKU_LIFECYCLE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            </div>
            {form.tier !== "Share" && <>
              <div className="grid g-2" style={{ gap: 12 }}>
                <label className="col" style={{ gap: 5 }}><span className="muted tiny"><AutoGloss>解锁阶段（上架节奏门）</AutoGloss></span><select className="fld" value={form.unlock} onChange={(e) => setForm({ ...form, unlock: e.target.value })} disabled={skuPhaseIds.length === 0}>{skuPhaseIds.length === 0 ? <option value="">请先配置阶段</option> : skuPhaseIds.map((p) => <option key={p} value={p}>{e1PhaseLabel(p)}</option>)}</select></label>
              </div>
            </>}
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">特性清单 · 每行一条</span><textarea className="fld" style={{ minHeight: 72, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} placeholder={"Nexion 全托管\n99.9% 在线率 SLA\n免运费与安装"} /></label>
          </SkuFieldGroup>

          <SkuFieldGroup n="⑦" title="购买限制">
            <label className="col" style={{ gap: 5 }}>
              <span className="muted tiny">等级门类型 · 谁可购买<span style={{ color: "var(--ink-4)" }}> · 锁额另设(正交)· server 二次校验为权威</span></span>
              <div className="row wrap" style={{ gap: 6 }}>
                {[{ k: "none", l: "无等级门" }, { k: "activeDirect", l: "单活跃直推" }, { k: "rank", l: "单 V 级" }, { k: "combo", l: "组合门槛" }].map((t) => (
                  <Chip key={t.k} tab sel={form.gateType === t.k} onClick={() => { if (form.gateType !== t.k) setForm({ ...form, gateType: t.k, gateRankMin: "", gateActiveDirectMin: "", gateTeamVolumeMin: "" }); }}>{t.l}</Chip>
                ))}
              </div>
            </label>
            {form.gateType === "activeDirect" && (
              <SkuFld label="最少活跃直推数" type="number" value={form.gateActiveDirectMin} onChange={(v) => setForm({ ...form, gateActiveDirectMin: v })} placeholder="5" hint="达标方可购买" />
            )}
            {form.gateType === "rank" && (
              <SkuFld label="最低 V 级(0-12)" type="number" value={form.gateRankMin} onChange={(v) => setForm({ ...form, gateRankMin: v })} placeholder="2" hint="用户 V 级 ≥ 此值" />
            )}
            {form.gateType === "combo" && (
              <>
                <div className="grid g-2" style={{ gap: 12 }}>
                  <SkuFld label="最低 V 级(可空)" type="number" value={form.gateRankMin} onChange={(v) => setForm({ ...form, gateRankMin: v })} placeholder="2" hint="0-12" />
                  <SkuFld label="最少活跃直推(可空)" type="number" value={form.gateActiveDirectMin} onChange={(v) => setForm({ ...form, gateActiveDirectMin: v })} placeholder="15" />
                </div>
                <SkuFld label="最低团队业绩 USD(可空)" type="number" value={form.gateTeamVolumeMin} onChange={(v) => setForm({ ...form, gateTeamVolumeMin: v })} placeholder="20000" />
                <label className="col" style={{ gap: 5 }}>
                  <span className="muted tiny">多条件判定</span>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <Chip tab sel={form.gateMode === "all"} onClick={() => setForm({ ...form, gateMode: "all" })}>全部满足</Chip>
                    <Chip tab sel={form.gateMode === "either"} onClick={() => setForm({ ...form, gateMode: "either" })}>任一满足</Chip>
                  </div>
                </label>
              </>
            )}
            <SkuFld label="锁额上限" type="number" value={form.gateQuotaCap} onChange={(v) => setForm({ ...form, gateQuotaCap: v })} placeholder="1000" hint="留空=不限量;设值=本期可售上限" />
            {form.gateQuotaCap.trim() && (
              <>
                <div className="grid g-2" style={{ gap: 12 }}>
                  <SkuFld label="已售数量" type="number" value={form.gateQuotaSold} onChange={(v) => setForm({ ...form, gateQuotaSold: v })} placeholder="977" hint="后端维护" />
                  <label className="col" style={{ gap: 5 }}><span className="muted tiny">锁额周期</span><select className="fld" value={form.gateQuotaPeriod} onChange={(e) => setForm({ ...form, gateQuotaPeriod: e.target.value })}><option value="month">本月</option><option value="lifetime">永久</option></select></label>
                </div>
                <label className="col" style={{ gap: 5 }}><span className="muted tiny">购买限制执行方式</span><select className="fld" value={form.gateEnforce} onChange={(e) => setForm({ ...form, gateEnforce: e.target.value })}><option value="true">硬拦截（售罄即禁购）</option><option value="false">仅展示（不拦截购买）</option></select></label>
              </>
            )}
            {(() => {
              const g = formToGate(form);
              if (!g) return <div className="tint tiny">无购买门 · 任何用户可直接购买</div>;
              const parts: string[] = [];
              if (g.rankMin != null) parts.push(`V≥${g.rankMin}`);
              if (g.activeDirectMin != null) parts.push(`≥${g.activeDirectMin} 活跃直推`);
              if (g.teamVolumeMin != null) parts.push(`团队业绩 ≥$${g.teamVolumeMin.toLocaleString()}`);
              const condTxt = parts.length ? parts.join(g.mode === "either" ? " 或 " : " 且 ") : "无等级条件";
              const remaining = gateRemaining(g);
              const quotaTxt = remaining != null ? ` · 锁额 ${g.quotaCap}(余 ${remaining}${g.enforce ? " · 售罄硬拦" : " · 仅展示"})` : "";
              return <div className="tint cyan tiny">购买门 · {condTxt}{quotaTxt} · 改后对前端商城 / 详情 / 结算页生效,以后端校验为准</div>;
            })()}
          </SkuFieldGroup>

          {(() => {
            if (form.tier === "Share") {
              const lo = skuNum(form.shareYieldMin); const hi = skuNum(form.shareYieldMax); const nex = skuNum(form.dailyEarnNEX); const pr = skuNum(form.price);
              return (lo > 0 || hi > 0) ? <div className="tint cyan tiny">派生 · 年化 <span className="nowrap">{lo}–{hi}%</span> · 日产 <span className="nowrap">{nex.toLocaleString()} NEX</span>{pr > 0 ? <> · 起投 <span className="nowrap">${pr.toLocaleString()}</span></> : null}</div> : null;
            }
            const p = skuNum(form.price); const d = skuNum(form.dailyEarn);
            return p > 0 && d > 0 ? <div className="tint cyan tiny">派生 · 回本 ≈ <span className="nowrap">{Math.round(p / d)} 天</span> · 首年净 ≈ <span className="nowrap">${(d * 365 - p).toLocaleString()}</span> · 年化 ≈ <span className="nowrap">{Math.round((d * 365 / p) * 100)}%</span> · vs 手机 ≈ <span className="nowrap">{Math.round(d / 0.08).toLocaleString()}×</span></div> : null;
          })()}
          <div className="tint warn tiny"><AutoGloss>定价 / 日产基准 / 状态为高敏字段 · 新增 SKU 需操作确认后才上架</AutoGloss></div>
        </div>
      </Drawer>}

      {/* 任务新增 抽屉 */}
      {taskDrawer && <Drawer title={editTaskId ? "编辑任务" : "新增任务"} sub={<AutoGloss>{editTaskId ? "编辑全字段 · 单价/门槛/taskClass 改后走操作确认 · 对新派单 server-canonical 生效" : "AI 算力任务类型 · 单价/门槛改后对新派单 server-canonical 生效"}</AutoGloss>} onClose={() => { setTaskDrawer(false); setEditTaskId(null); }}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => { setTaskDrawer(false); setEditTaskId(null); }}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!taskForm.n.trim() || !Number(taskForm.price)} onClick={editTaskId ? submitTaskEdit : submitTask}>{editTaskId ? "保存修改" : "提交新增"}</Btn></>}>
        <div className="col" style={{ gap: 12 }}>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">任务名称</span><input className="fld" value={taskForm.n} onChange={(e) => setTaskForm({ ...taskForm, n: e.target.value })} placeholder="如 LLM 推理 405B" /></label>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny"><AutoGloss>单价(USDT)</AutoGloss></span><input className="fld" type="number" value={taskForm.price} onChange={(e) => setTaskForm({ ...taskForm, price: e.target.value })} placeholder="1.20" /></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">计价单位</span><div className="row wrap" style={{ gap: 6 }}>{["/job", "/1k", "/min"].map((u) => <Chip key={u} tab sel={taskForm.unit === u} onClick={() => setTaskForm({ ...taskForm, unit: u })}>{u}</Chip>)}</div></label>
          </div>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">资格门槛(设备要求)<span style={{ color: "var(--ink-4)" }}> · 手机+ = 含手机的最低门槛(手机可接)</span></span><div className="row wrap" style={{ gap: 6 }}>{["手机+", "S1+", "需 NexionBox Pro", "需 NexionRack"].map((r) => <Chip key={r} tab sel={taskForm.req === r} onClick={() => setTaskForm({ ...taskForm, req: r })}>{r}</Chip>)}</div></label>
          <SkuFld label="初始饱和度 %(预估)" type="number" value={taskForm.sat} onChange={(v) => setTaskForm({ ...taskForm, sat: v })} placeholder="50" hint="0-100" />
          {/* #36 任务核心配置:taskClass / 代表模型 / 奖励区间 / 最低显存 / kill 初始态 */}
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">taskClass(权威枚举)</span>
              <select className="fld" value={taskForm.taskClass} onChange={(e) => setTaskForm({ ...taskForm, taskClass: e.target.value })}>
                <option value="">请选择 taskClass</option>
                {["IG", "VG", "LL", "FT", "EM", "SP"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">代表模型</span><input className="fld" value={taskForm.model} onChange={(e) => setTaskForm({ ...taskForm, model: e.target.value })} placeholder="如 Llama-3.1-405B" /></label>
          </div>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">minReward(USDT)</span><input className="fld" type="number" value={taskForm.minReward} onChange={(e) => setTaskForm({ ...taskForm, minReward: e.target.value })} placeholder="0.80" /></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">maxReward(USDT)</span><input className="fld" type="number" value={taskForm.maxReward} onChange={(e) => setTaskForm({ ...taskForm, maxReward: e.target.value })} placeholder="2.40" /></label>
          </div>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">minVRAM(最低显存 GB)</span><input className="fld" type="number" min={0} step={1} value={taskForm.minVRAM.replace(/GB$/i, "")} onChange={(e) => setTaskForm({ ...taskForm, minVRAM: e.target.value })} placeholder="80" /></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">kill 初始状态</span><div className="row wrap" style={{ gap: 6 }}>{["派发中", "已 kill", "限流中"].map((k) => <Chip key={k} tab sel={taskForm.killInit === k} onClick={() => setTaskForm({ ...taskForm, killInit: k })}>{k}</Chip>)}</div></label>
          </div>
          <div className="tint warn tiny"><AutoGloss>单价 / 门槛 / taskClass 为高敏字段 · 以后端为准;taskClass 建立与后台派单引擎的权威映射,改后对新派单生效 + 前端 /earn 任务池同步,需操作确认留痕。</AutoGloss></div>
        </div>
      </Drawer>}

      {/* E5 数据中心新增 / 编辑抽屉 */}
      {dcDrawer && <Drawer title={editDcLocation ? "编辑数据中心" : "新增数据中心"} sub={<AutoGloss>数据中心卡片配置 · 写入后端 MySQL</AutoGloss>} onClose={() => { setDcDrawer(false); setEditDcLocation(null); }}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => { setDcDrawer(false); setEditDcLocation(null); }}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!dcForm.dcLocation.trim() || !dcForm.regionLabel.trim() || !dcForm.location.trim() || !dcForm.displayName.trim()} onClick={openDatacenterSaveConfirm}>{editDcLocation ? "保存修改" : "提交新增"}</Btn></>}>
        <div className="col" style={{ gap: 12 }}>
          <label className="col" style={{ gap: 5 }}>
            <span className="muted tiny">DC 标识</span>
            <input className="fld" value={dcForm.dcLocation} onChange={(e) => setDcForm({ ...dcForm, dcLocation: e.target.value })} placeholder="us-east-2" />
          </label>
          <label className="col" style={{ gap: 5 }}>
            <span className="muted tiny">区域 ID</span>
            <input className="fld" value={dcForm.regionLabel} onChange={(e) => setDcForm({ ...dcForm, regionLabel: e.target.value })} placeholder="美国 · 弗吉尼亚" />
          </label>
          <label className="col" style={{ gap: 5 }}>
            <span className="muted tiny">所在地</span>
            <input className="fld" value={dcForm.location} onChange={(e) => setDcForm({ ...dcForm, location: e.target.value })} placeholder="美国弗吉尼亚州阿什本" />
          </label>
          <label className="col" style={{ gap: 5 }}>
            <span className="muted tiny">前端展示名</span>
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
          <div className="tint warn tiny"><AutoGloss>删除数据中心只移除卡片配置,不会删除设备库存;暂停/恢复派单仍走 E5 运维处置接口。</AutoGloss></div>
        </div>
      </Drawer>}

      {/* 操作确认(唯一动作出口)*/}
      {mc && <OperationConfirmModal
        action={mc.name}
        detail={mc.detail ?? "以后端为准 · 改后对下一笔结算 / 新派单生效,不回溯已计提"}
        amplifies={!!mc.amplify}
        edit={mc.edit}
        businessForm={mc.businessForm}
        reasonMax={200}
        completionCopy="提交后进入 A2 待确认队列,批准执行后生效"
        onClose={() => setActionConfirm(null)}
        onConfirm={async (reason, newValue, businessValue) => {
          if (!mc) return;
          // 批6: E 域高敏动作统一 propose 入 A2 后端待确认队列(壳集中回调)。
          // propose 内部自管成功/失败 toast;此处仅做 mc.op → op 映射 + 构造 ctx + 本地 UI 状态收尾。
          try {
            if (mc.op === "sku-save") {
              const ex = editName ? skus.find((x) => x.name === editName) : undefined;
              const sku = attachSkuMedia(formToSku(form, ex), skuMedia);
              const skuId = editName ? (ex?.id || ex?.name || editName) : (form.id.trim() || form.name.trim());
              const def = findHighOp(editName ? "e1_sku_update" : "e1_sku_create")!;
              await propose(ctx.toast, {
                action: mc.name, obj: skuId, before: editName ? "编辑前 SKU" : "—", after: form.name || skuId,
                type: def.type, amplifies: false, gate: { roles: [] }, gateLabel: def.gateLabel, reason,
                sourceDomain: "E1",
                command: def.buildCommand({ skuId, ...sku }),
                target: def.buildTarget({ skuId }),
              });
              setEditName(null);
              resetSkuMedia(null);
            } else if (mc.op === "sku-delete" && mc.target) {
              const sku = skus.find((x) => x.name === mc.target || x.id === mc.target);
              const skuId = sku?.id || mc.target;
              const def = findHighOp("e1_sku_delete")!;
              await propose(ctx.toast, {
                action: mc.name, obj: skuId, before: mc.target, after: "已移除", type: def.type, amplifies: false,
                gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E1",
                command: def.buildCommand({ skuId }),
                target: def.buildTarget({ skuId }),
              });
            } else if (mc.op === "sku-status" && mc.target) {
              const sku = skus.find((x) => x.name === mc.target || x.id === mc.target);
              const skuId = sku?.id || mc.target;
              const def = findHighOp("e1_sku_status")!;
              await propose(ctx.toast, {
                action: mc.name, obj: skuId, before: mc.target, after: mc.status === "off" ? "下架" : "上架",
                type: def.type, amplifies: false, gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E1",
                command: def.buildCommand({ skuId, status: String(mc.status ?? "") }),
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
              const def = findHighOp("e2_task_update")!;
              const taskCtx = {
                taskId: editTaskId, name: taskForm.n.trim(), price, unit: taskForm.unit, requirement: taskForm.req,
                saturation: sat, status: "active", taskClass: taskForm.taskClass, model: taskForm.model.trim(),
                minReward: minR, maxReward: maxR, minVram: taskForm.minVRAM.trim(), killInit: taskForm.killInit,
              };
              await propose(ctx.toast, {
                action: mc.name, obj: editTaskId, before: "编辑前任务", after: taskForm.n.trim(), type: def.type, amplifies: false,
                gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E2",
                command: def.buildCommand(taskCtx),
                target: def.buildTarget(taskCtx),
              });
              setEditTaskId(null);
            } else if (mc.op === "phone-tier" && mc.phoneTier && mc.phoneField) {
              const v = Number(newValue);
              if (!(Number.isFinite(v) && v > 0)) { setToast("请填写有效档位收益"); return; }
              const def = findHighOp("e2_phone_tier")!;
              const tierCtx = { tier: mc.phoneTier, dailyUsdt: mc.phoneField === "dailyUsdt" ? v : undefined, dailyNex: mc.phoneField === "dailyNex" ? v : undefined };
              await propose(ctx.toast, {
                action: mc.name, obj: String(mc.phoneTier), before: String(v), after: String(v), type: def.type, amplifies: true,
                gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E2",
                command: def.buildCommand(tierCtx),
                target: def.buildTarget(tierCtx),
              });
            } else if (mc.op === "param" && mc.paramKey) {
              const v = (newValue ?? "").trim();
              const before = typeof mc.edit?.current === "string" ? mc.edit.current : "—";
              await proposeParam(mc.paramKey, v, before, reason, mc.name, !!mc.amplify);
            } else if (mc.op === "early-access" && businessValue) {
              const enabled = businessValue.enabled === "开" || businessValue.enabled === "true";
              const leadDays = Number(businessValue.leadDays);
              if (![7, 14, 30, 60, 90].includes(leadDays)) { setToast("提前天数仅支持 7/14/30/60/90 天"); return; }
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
                amplifies: !!mc.amplify, gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: isE6Batch ? "E6" : "E3",
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
                action: mc.name, obj: mc.generationGateId ?? gateCtx.skuId, before: mc.generationGateId ? "编辑前上架门" : "—", after: gateCtx.skuId,
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
              const def = findHighOp("e4_order_refund")!;
              await propose(ctx.toast, {
                action: mc.name, obj: mc.orderId, before: effOrderState(mc.orderId), after: "已退款", type: def.type, amplifies: true,
                gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E4",
                command: def.buildCommand({ orderNo: mc.orderId, refundChannel }),
                target: def.buildTarget({ orderNo: mc.orderId }),
              });
              setSelOrder(null);
            } else if (mc.op === "order-cancel" && mc.orderId) {
              const def = findHighOp("e4_order_cancel")!;
              await propose(ctx.toast, {
                action: mc.name, obj: mc.orderId, before: effOrderState(mc.orderId), after: "已取消", type: def.type, amplifies: false,
                gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E4",
                command: def.buildCommand({ orderNo: mc.orderId }),
                target: def.buildTarget({ orderNo: mc.orderId }),
              });
              setSelOrder(null);
            } else if (mc.op === "order-terminal" && mc.orderId) {
              const v = (newValue ?? "").trim();
              if (!v) { setSelOrder(null); return; }
              const def = findHighOp("e4_order_terminal")!;
              await propose(ctx.toast, {
                action: mc.name, obj: mc.orderId, before: effOrderState(mc.orderId), after: stateLabel(v), type: def.type, amplifies: false,
                gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E4",
                command: def.buildCommand({ orderNo: mc.orderId, terminalState: v }),
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
            } else if (mc.op === "dc-save" && mc.dcForm) {
              const dcCtx = {
                dcLocation: mc.dcForm.dcLocation.trim(), regionLabel: mc.dcForm.regionLabel.trim(),
                oldDcLocation: mc.dc ?? mc.dcForm.dcLocation.trim(),
                location: mc.dcForm.location.trim(), displayName: mc.dcForm.displayName.trim(),
                status: mc.dcForm.status, sortOrder: Number(mc.dcForm.sortOrder) || 100,
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
            setToast((mc.name || "操作") + ":失败 " + (error instanceof Error ? error.message : "E1_ACTION_FAILED"));
            throw error;
          }
          setActionConfirm(null);
        }} />}
      {toastNode}
    </div>
  );
}
