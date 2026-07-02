"use client";

/**
 * E 设备与商城 — 设计稿 design_handoff_e_domain 内容视图。
 * 全系统统一连续编号 E1-E5(代际门原 E2 并入 E1、设备生命周期原 E4 并入 E5→现 E3):
 * E1 商品目录&代际门 / E2 收益&任务引擎 / E3 生命周期&Trade-in / E4 订单状态机 / E5 设备运维。
 * nav id == 视图 key == prdAnchor == PRD §10 章节(已全部重编号统一,FOLD 现为恒等映射)。
 *
 * 本 shell 持有全部共享 store 接线 + 4 个抽屉(SKU / 任务 / 评价 / 订单详情)+ OperationConfirmModal;
 * 各 tab 视觉/布局拆到 e-tabs/*(复用 design-kit 原语 + e-domain.css 设计类),经 EViewCtx 注入派生读 + 回调。
 * 真写落点:E1 SKU/评价/代际门、E2 任务引擎、E3 生命周期&Trade-in、E4 订单状态机、E5 设备运维走后端 API。
 * 操作确认 显式 edit 契约:调参(param / task-price)传 edit{kind,current,unit};处置/纯动作(sku-status / param-fixed / order-* / ops-pause)不传 edit。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, Btn, Chip, Drawer, KV, Badge, OperationConfirmModal, useToast } from "./design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { confirm } from "@/lib/store/ui";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { OpsSku, OpsReview, OpsTask } from "@/lib/admin/platform-types";
import {
  archiveE1GenerationGate,
  archiveE1Phase,
  createE1GenerationGate,
  createE1Phase,
  deleteE1Review,
  deleteE1Sku,
  fetchE1Catalog,
  patchE1GenerationGate,
  patchE1Phase,
  saveE1Review,
  saveE1Sku,
  setE1CurrentPhase,
  updateE1GenerationGate,
  updateE1Review,
  updateE1ReviewStatus,
  updateE1SkuStatus,
  type E1GenerationGateData,
} from "@/lib/admin/e1-client";
import { createE2Task, deleteE2Task, fetchE2PhoneTiers, fetchE2Tasks, updateE2PhoneTier, updateE2Task, updateE2TaskPrice, type E2PhoneTier } from "@/lib/admin/e2-client";
import { fetchE3Snapshot, updateE3Param, updateE3Params, type E3OperationMetric, type E3Stats } from "@/lib/admin/e3-client";
import { cancelE4Order, fetchE4OrderPage, refundE4Order, terminalE4Order, updateE4OrderState } from "@/lib/admin/e4-client";
import {
  activateE5Device,
  createE5Datacenter,
  deactivateE5Device,
  deleteE5Datacenter,
  fetchE5Datacenters,
  fetchE5Devices,
  fetchE5Overview,
  setE5DatacenterPaused,
  updateE5Datacenter,
  type E5Datacenter,
  type E5DatacenterInput,
  type E5Device,
  type E5Overview,
} from "@/lib/admin/e5-client";
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
import "./e-domain.css";

let REVIEW_SEQ = 100; // 客户端新增评价临时 id 计数,提交后以后端 id 为准。

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
const REVIEW_STATUS_OPTIONS = [
  { value: "published", label: "展示中" },
  { value: "hidden", label: "已隐藏" },
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
function SkuFld({ label, value, onChange, placeholder, type = "text", hint, list }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; hint?: string; list?: string }) {
  return (
    <label className="col" style={{ gap: 5 }}>
      <span className="muted tiny">{label}{hint ? <span style={{ color: "var(--ink-4)" }}> · {hint}</span> : null}</span>
      <input className="fld" type={type} list={list} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
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
  const [manualOpen, setManualOpen] = useState(false); // E3 操作说明手册弹窗
  const operator = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
  const [e3Params, setE3Params] = useState<Record<string, string>>({});
  const [e3Stats, setE3Stats] = useState<E3Stats | null>(null);
  const [e3Operations, setE3Operations] = useState<E3OperationMetric[]>([]);
  const [e3Loading, setE3Loading] = useState(false);
  const [e3Error, setE3Error] = useState<string | null>(null);
  const isE3ParamKey = (k: string) => k.startsWith("E.device.") || k.startsWith("E.tradein.");
  const pE = (k: string): string => isE3ParamKey(k) ? (e3Params[k] ?? "—") : "—";
  const e3Ready = Object.keys(e3Params).length > 0;

  // ── E1 商品目录 / 评价 / 代际门:后端接口为单一来源 ──
  const [e1Skus, setE1Skus] = useState<OpsSku[]>([]);
  const [e1Reviews, setE1Reviews] = useState<OpsReview[]>([]);
  const [e1Gates, setE1Gates] = useState<E1GenerationGateData | null>(null);
  const [e1Loading, setE1Loading] = useState(false);
  const [e1Error, setE1Error] = useState<string | null>(null);
  const refreshE1 = useCallback(async () => {
    setE1Loading(true);
    setE1Error(null);
    try {
      const snapshot = await fetchE1Catalog();
      setE1Skus(snapshot.skus);
      setE1Reviews(snapshot.reviews);
      setE1Gates(snapshot.gates);
    } catch (error) {
      setE1Error(error instanceof Error ? error.message : "E1_SYNC_FAILED");
    } finally {
      setE1Loading(false);
    }
  }, []);
  useEffect(() => { if (tab === "E1") void refreshE1(); }, [tab, refreshE1]);
  const skus = e1Skus;
  const reviews = e1Reviews;
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
  const [e2Loading, setE2Loading] = useState(false);
  const [e2Error, setE2Error] = useState<string | null>(null);
  const refreshE2 = useCallback(async () => {
    setE2Loading(true);
    setE2Error(null);
    try {
      const [nextTasks, nextPhoneTiers] = await Promise.all([fetchE2Tasks(), fetchE2PhoneTiers()]);
      setTasks(nextTasks);
      setPhoneTiers(nextPhoneTiers);
    } catch (error) {
      setE2Error(error instanceof Error ? error.message : "E2_SYNC_FAILED");
      setTasks([]);
      setPhoneTiers([]);
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
  useEffect(() => { if (tab === "E3") void refreshE3(); }, [tab, refreshE3]);

  // ── E4 订单状态机:服务端数据为单一来源 ──
  const [orders, setOrders] = useState<EOrder[]>([]);
  const [e4Loading, setE4Loading] = useState(false);
  const [e4Error, setE4Error] = useState<string | null>(null);
  const [e4Page, setE4Page] = useState(1);
  const [e4PageSize, setE4PageSizeState] = useState(10);
  const [e4Total, setE4Total] = useState(0);
  const [e4Filter, setE4FilterState] = useState("all");
  const setE4PageSize = useCallback((pageSize: number) => {
    setE4PageSizeState(pageSize);
    setE4Page(1);
  }, []);
  const setE4Filter = useCallback((filter: string) => {
    setE4FilterState(filter);
    setE4Page(1);
  }, []);
  const refreshE4 = useCallback(async () => {
    setE4Loading(true);
    setE4Error(null);
    try {
      const nextPage = await fetchE4OrderPage({
        state: e4Filter === "all" ? undefined : e4Filter,
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
  }, [e4Filter, e4Page, e4PageSize]);
  useEffect(() => { if (tab === "E4") void refreshE4(); }, [tab, refreshE4]);
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
  const setE5PageSize = useCallback((pageSize: number) => {
    setE5PageSizeState(pageSize);
    setE5Page(1);
  }, []);
  const refreshE5 = useCallback(async () => {
    setE5Loading(true);
    setE5Error(null);
    try {
      const [nextDevicePage, nextOverview, nextDatacenters] = await Promise.all([
        fetchE5Devices({ pageNum: e5Page, pageSize: e5PageSize }),
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
  }, [e5Page, e5PageSize]);
  useEffect(() => { if (tab === "E5") void refreshE5(); }, [tab, refreshE5]);
  const e5PausedDcs = useMemo(() => new Map(e5Datacenters.map((dc) => [dc.dcLocation, dc.dispatchPaused])), [e5Datacenters]);
  const isDcPaused = (dc: string): boolean => e5PausedDcs.get(dc) ?? false;
  const skuDatacenterOptions = useMemo(() => {
    const seen = new Set<string>();
    return e5Datacenters.reduce<{ value: string; label: string }[]>((acc, dc) => {
      const value = dc.regionLabel.trim();
      if (!value || seen.has(value)) return acc;
      seen.add(value);
      acc.push({ value, label: `${value} · ${dc.dcLocation}` });
      return acc;
    }, []);
  }, [e5Datacenters]);
  const skuDatacenterSet = useMemo(() => new Set(skuDatacenterOptions.map((item) => item.value)), [skuDatacenterOptions]);
  const skuDatacenterDefault = skuDatacenterOptions[0]?.value ?? "";

  // ── 抽屉本地态 ──
  const [skuDrawer, setSkuDrawer] = useState(false);
  const [form, setForm] = useState<SkuForm>(EMPTY_SKU_FORM);
  const [skuMedia, setSkuMedia] = useState<SkuMedia>(null);
  const [skuMediaUploading, setSkuMediaUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [editName, setEditName] = useState<string | null>(null);
  const mediaSeq = useRef(0);
  const [taskDrawer, setTaskDrawer] = useState(false);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState<{ n: string; price: string; req: string; unit: string; sat: string; taskClass: string; model: string; minReward: string; maxReward: string; minVRAM: string; killInit: string }>({ n: "", price: "", req: "", unit: "", sat: "", taskClass: "", model: "", minReward: "", maxReward: "", minVRAM: "", killInit: "" });
  const [reviewDrawer, setReviewDrawer] = useState(false);
  const [editReviewId, setEditReviewId] = useState<string | null>(null);
  const [reviewForm, setReviewForm] = useState({ productId: "", author: "", rating: "5", content: "", date: "刚刚", status: "published" });
  const [dcDrawer, setDcDrawer] = useState(false);
  const [editDcLocation, setEditDcLocation] = useState<string | null>(null);
  const [dcForm, setDcForm] = useState<DatacenterForm>({ dcLocation: "", regionLabel: "", status: "active", sortOrder: "100" });

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
      if (datacenter && skuDatacenterSet.has(datacenter)) return current;
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
    setActionConfirm({
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
  const openAddReview = () => { const firstSku = skus.find((s) => (s.status || "on") !== "off"); setReviewForm({ productId: firstSku?.id || firstSku?.name || "", author: "", rating: "5", content: "", date: "刚刚", status: "published" }); setEditReviewId(null); setReviewDrawer(true); };
  const openEditReview = (r: OpsReview) => { setReviewForm({ productId: r.productId, author: r.author, rating: String(r.rating), content: r.content, date: r.date, status: r.status }); setEditReviewId(r.id); setReviewDrawer(true); };
  const submitReview = async () => {
    if (!reviewForm.author.trim() || !reviewForm.content.trim()) { setToast("请填写评价人 + 内容"); return; }
    const r: OpsReview = { id: editReviewId ?? ("rv-" + ++REVIEW_SEQ), productId: reviewForm.productId.trim(), author: reviewForm.author.trim(), rating: Number(reviewForm.rating) || 5, content: reviewForm.content.trim(), date: reviewForm.date.trim() || "刚刚", status: reviewForm.status };
    try {
      if (editReviewId) {
        await updateE1Review(r, "编辑评价 " + r.author, operator);
        setToast("评价已更新:" + r.author);
      } else {
        await saveE1Review(r, "新增评价 " + r.author, operator);
        setToast("评价已新增:" + r.author);
      }
      await refreshE1();
      setReviewDrawer(false); setEditReviewId(null);
    } catch (error) {
      setToast("评价保存失败:" + (error instanceof Error ? error.message : "E1_REVIEW_SAVE_FAILED"));
    }
  };
  const delReview = async (r: OpsReview) => {
    const ok = await confirm({ title: "删除评价?", message: `删除「${r.author}」的评价?需审计留痕。`, confirmLabel: "确认删除", danger: true });
    if (ok) {
      try {
        await deleteE1Review(r.id, "删除评价 " + r.author, operator);
        await refreshE1();
        setToast("评价已删除:" + r.author);
      } catch (error) {
        setToast("评价删除失败:" + (error instanceof Error ? error.message : "E1_REVIEW_DELETE_FAILED"));
      }
    }
  };
  const toggleReview = async (r: OpsReview) => {
    const ns = r.status === "published" ? "hidden" : "published";
    try {
      await updateE1ReviewStatus(r.id, ns, (ns === "hidden" ? "隐藏" : "恢复") + "评价 " + r.author, operator);
      await refreshE1();
      setToast("评价已" + (ns === "hidden" ? "隐藏" : "恢复"));
    } catch (error) {
      setToast("评价状态更新失败:" + (error instanceof Error ? error.message : "E1_REVIEW_STATUS_FAILED"));
    }
  };
  const openDatacenter = (dc?: E5Datacenter) => {
    setDcForm(dc
      ? {
          dcLocation: dc.dcLocation,
          regionLabel: dc.regionLabel,
          status: dc.status,
          sortOrder: String(dc.sortOrder),
        }
      : { dcLocation: "", regionLabel: "", status: "active", sortOrder: "100" });
    setEditDcLocation(dc?.dcLocation ?? null);
    setDcDrawer(true);
  };
  const openDatacenterSaveConfirm = () => {
    const dcLocation = dcForm.dcLocation.trim();
    const regionLabel = dcForm.regionLabel.trim();
    const sortOrder = Number(dcForm.sortOrder);
    if (!editDcLocation && !dcLocation) { setToast("请填写 DC 标识"); return; }
    if (!regionLabel) { setToast("请填写区域展示名"); return; }
    if (!Number.isFinite(sortOrder) || sortOrder < 0) { setToast("请填写有效排序值"); return; }
    const normalized: DatacenterForm = {
      dcLocation: editDcLocation ?? dcLocation,
      regionLabel,
      status: dcForm.status,
      sortOrder: String(Math.floor(sortOrder)),
    };
    const statusLabel = DC_STATUS_OPTIONS.find((item) => item.value === normalized.status)?.label ?? normalized.status;
    setActionConfirm({
      name: (editDcLocation ? "编辑数据中心 · " : "新增数据中心 · ") + normalized.dcLocation,
      op: "dc-save",
      dc: editDcLocation ?? normalized.dcLocation,
      dcForm: normalized,
      isNew: !editDcLocation,
      detail: `${editDcLocation ? "更新" : "新增"}数据中心卡片配置:${normalized.dcLocation} · ${normalized.regionLabel} · 状态 ${statusLabel} · 写入后端 MySQL 并刷新 E5 卡片。`,
    });
    setDcDrawer(false);
  };
  const deleteDatacenter = (dc: E5Datacenter) => {
    setActionConfirm({
      name: "删除数据中心 · " + dc.dcLocation,
      op: "dc-delete",
      dc: dc.dcLocation,
      detail: `软删除 ${dc.dcLocation} 数据中心卡片配置。不会删除设备库存,但该数据中心不再出现在 E5 卡片列表。需填写操作理由 + 审计留痕。`,
      businessForm: {
        kind: "destructive-reason",
        target: dc.dcLocation,
        impact: "E5 数据中心卡片列表会移除该配置;设备库存数据不回溯删除。",
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
    if (!Number.isFinite(minR) || !Number.isFinite(maxR) || minR <= 0 || maxR < minR) return "奖励区间非法:需 0 < minReward ≤ maxReward";
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
  const submitTask = async () => {
    const err = validateTaskForm();
    if (err) { setToast(err); return; }
    const price = Number(taskForm.price) || 0;
    const minR = Number(taskForm.minReward), maxR = Number(taskForm.maxReward);
    const sat = taskForm.sat.trim() ? Math.max(0, Math.min(100, Number(taskForm.sat))) / 100 : null;
    try {
      const created = await createE2Task(
        {
          id: "",
          n: taskForm.n.trim(),
          price,
          unit: taskForm.unit,
          req: taskForm.req,
          sat,
          taskClass: taskForm.taskClass,
          model: taskForm.model.trim(),
          minReward: minR,
          maxReward: maxR,
          minVRAM: taskForm.minVRAM.trim(),
          killInit: taskForm.killInit,
        },
        "新增任务核心配置",
        operator);
      await refreshE2();
      setToast("已新增任务:" + created.n + " · taskClass=" + taskForm.taskClass + " · 后端已生效");
      setTaskDrawer(false);
      setEditTaskId(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "E2_TASK_CREATE_FAILED";
      setToast("任务新增失败:" + msg);
    }
  };
  // 编辑提交:校验后走操作确认(高敏 · 改单价/门槛/taskClass server-canonical)→ onConfirm 真写 updateTask。
  const submitTaskEdit = () => {
    const err = validateTaskForm();
    if (err) { setToast(err); return; }
    setActionConfirm({ name: "编辑任务 · " + taskForm.n.trim(), op: "task-save", detail: `编辑任务「${taskForm.n.trim()}」全字段(单价 / 资格门槛 / taskClass / 代表模型 / 奖励区间 / minVRAM / kill 初始态)· server-canonical,改后对新派单生效,已派工单维持原配置完成 · 须操作确认。` });
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
    setActionConfirm({
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
  const openSkuSaveConfirm = () => {
    if (skuMediaUploading) { setToast("媒体仍在上传,请稍后提交"); return; }
    if (skuMedia && !skuMedia.assetId) { setToast("媒体未上传成功,请重新选择文件"); return; }
    if (!form.tier.trim() || !form.generation.trim() || !form.lifecycle.trim()) {
      setToast("请补全档位 / 产品代际 / 生命周期");
      return;
    }
    const datacenter = form.datacenter.trim();
    if (!datacenter || !skuDatacenterSet.has(datacenter)) {
      if (!skuDatacenterDefault) {
        setToast("请先在 E5 配置至少一个数据中心,再保存 SKU");
        return;
      }
      setForm({ ...form, datacenter: skuDatacenterDefault });
    }
    const poolErr = validateSkuUnlockPool();
    if (poolErr) { setToast(poolErr); return; }
    const gErr = validateGateForm(form);
    if (gErr) { setToast(gErr); return; }
    setActionConfirm({ name: (editName ? "编辑 SKU · " : "新增 SKU · ") + (form.name || "未命名"), op: "sku-save", isNew: !editName, hasImg: !!skuMedia });
    setSkuDrawer(false);
  };

  const ctx: EViewCtx = {
    pE, openActionConfirm: (m) => setActionConfirm(m), toast: setToast,
    skus, reviews, e1Loading, e1Error, e1Gates, phaseCur, refreshE1, openSku, delSku, openAddReview, openEditReview, toggleReview, delReview,
    tasks, phoneTiers, e2Loading, e2Error, refreshE2, openAddTask, openEditTask, delTask,
    e3Ready, e3Loading, e3Error, e3Stats, e3Operations, refreshE3,
    orders, e4Loading, e4Error, e4Page, e4PageSize, e4Total, e4Filter, setE4Page, setE4PageSize, setE4Filter, refreshE4, orderState, isCancelled, isRefunded, terminalOf, openOrder: (o) => setSelOrder(o),
    e5Devices, e5Overview, e5Datacenters, e5Loading, e5Error, e5Page, e5PageSize, e5Total, setE5Page, setE5PageSize, refreshE5, isDcPaused, openDatacenter, deleteDatacenter,
  };

  const headerRight =
    tab === "E1" ? <button className="f-cta" onClick={() => openSku()}>+ 新增 SKU</button>
      : tab === "E2" ? <button className="f-cta" onClick={openAddTask}>+ 新增任务</button>
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

      {/* E3 操作说明手册弹窗(右上角按钮触发) */}
      {tab === "E3" && manualOpen && <E3Manual ctx={ctx} onClose={() => setManualOpen(false)} />}

      {/* 订单详情抽屉 */}
      {selOrder && (() => {
        const o = orderById.get(selOrder.id) ?? selOrder;
        const eff = orderState(o);
        const finalized = isCancelled(o.id) || isRefunded(o.id) || !!terminalOf(o.id) || eff === "active" || eff === "refunded";
        const canCancel = !finalized && (eff === "created" || eff === "paid");
        // 设计稿:补建终态对所有非终态「始终」可达(含 failed —— 缺失终态 / DC 分配超时正是对账兜底场景)
        const canTerminal = !finalized;
        const idx = ORDER_FLOW.indexOf(o.state) >= 0 ? ORDER_FLOW.indexOf(o.state) : (o.state === "failed" ? 2 : -1);
        // #21 单订单推进 / 回滚:基于后端 live 态在主路径上的位置派生可达下一态 / 上一态。
        const flowIdx = ORDER_FLOW.indexOf(eff);
        const nextState = !finalized && flowIdx >= 0 && flowIdx < ORDER_FLOW.length - 1 ? ORDER_FLOW[flowIdx + 1] : undefined;
        const prevState = !finalized && flowIdx > 0 ? ORDER_FLOW[flowIdx - 1] : undefined;
        return (
          <Drawer title={o.id} sub={`${o.sku} · ${o.user}`} onClose={() => setSelOrder(null)}
            footer={finalized
              ? <Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => setSelOrder(null)}>关闭</Btn>
              : <>
                  {eff === "failed" && <Btn onClick={() => setActionConfirm({ name: `重试配机 · ${o.id}`, op: "order-state", orderId: o.id, fixedVal: "allocating", amplify: false, detail: `将 ${o.id} 从 failed 重新置为 allocating,重新进入 DC 分配队列 · 须操作确认` })}>重试配机</Btn>}
                  {nextState && <Btn onClick={() => setActionConfirm({ name: `推进订单 · ${o.id} → ${nextState}`, op: "order-state", orderId: o.id, fixedVal: nextState, amplify: false, detail: `手动推进 ${o.id} 状态机:${stateLabel(eff)} → ${stateLabel(nextState)} · 须操作确认` })}>推进下一态</Btn>}
                  {prevState && <Btn onClick={() => setActionConfirm({ name: `回滚订单 · ${o.id} → ${prevState}`, op: "order-state", orderId: o.id, fixedVal: prevState, amplify: false, detail: `回滚 ${o.id} 状态机:${stateLabel(eff)} → ${stateLabel(prevState)}(补救 / 纠错)· 须操作确认` })}>回滚上一态</Btn>}
                  {canCancel && <Btn onClick={() => setActionConfirm({ name: "取消订单 · " + o.id, op: "order-cancel", orderId: o.id, amplify: false, detail: `取消 ${o.id}(${stateLabel(eff)})· 终止后续分配/扣费,资产/额度回退联动 D4/C3 · 须操作确认 + 审计留痕` })}>取消订单</Btn>}
                  {canTerminal && <Btn onClick={() => setActionConfirm({ name: "补建订单终态 · " + o.id, op: "order-terminal", orderId: o.id, amplify: false, edit: { kind: "select", options: [...TERMINAL_STATES] }, detail: `为缺失终态的订单 ${o.id} 手动落定终态(支付失败/过期/退款/开通失败)· 状态机对账兜底 · 须操作确认 + 审计留痕` })}>补建终态</Btn>}
                  {eff === "failed"
                    ? <Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => setActionConfirm({ name: "退款 · " + o.id, op: "order-refund", orderId: o.id, amplify: true, detail: `退款 ${o.id} · $${o.amt.toLocaleString()} · 资产/额度回退联动 D4 + C3 · 不可逆` })}><AutoGloss>退款(操作确认)</AutoGloss></Btn>
                    : <Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => setSelOrder(null)}>关闭</Btn>}
                </>}>
            <div className="tint" style={{ marginBottom: 14, textAlign: "center" }}><div className="muted tiny">订单金额</div><div style={{ fontSize: 30, fontWeight: 600, color: "var(--ink)" }} className="tnum">${o.amt.toLocaleString()}</div></div>
            <KV k="状态" v={<Badge tone={ostate[eff] ?? "neutral"}>{stateLabel(eff)}</Badge>} />
            {!finalized && <KV k="可达下一态" v={nextState ? <>{stateLabel(nextState)}{prevState ? ` · 可回滚至 ${stateLabel(prevState)}` : ""}</> : <span style={{ color: "var(--ink-4)" }}>已达主路径末态（运行中）,仅可补建终态 / 退款</span>} />}
            <KV k="DC 分配" v={o.dc} />
            <KV k="用户" v={o.user} />
            <KV k="下单时间" v={o.age + " 前"} />
            {isCancelled(o.id) && <KV k="取消" v={<span style={{ color: "var(--ink-3)" }}>已取消 · 后续分配/扣费已终止,资产回退联动 D4/C3</span>} />}
            {isRefunded(o.id) && <KV k="退款" v={<span style={{ color: "var(--warning)" }}>已退款 · 资产回退已联动 D4/C3</span>} />}
            {!isCancelled(o.id) && !isRefunded(o.id) && terminalOf(o.id) && <KV k="补建终态" v={<span style={{ color: "var(--warning)" }}>{stateLabel(terminalOf(o.id)!)} · 人工补建</span>} />}
            {o.state === "failed" && <KV k="失败" v={<span style={{ color: "var(--danger)" }}>DC 分配超时 · 待处置</span>} />}
            <div style={{ fontSize: 12.5, fontWeight: 600, margin: "14px 0 8px", color: "var(--ink)" }}>状态轨迹</div>
            <div className="edrawer-trail">
              {ORDER_FLOW.map((s) => { const done = ORDER_FLOW.indexOf(s) <= idx; return <div key={s} className={`it ${done ? "done" : "grey"}`}><span className={`d ${done ? "done" : "grey"}`} /><span className="nm">{s}</span></div>; })}
              {o.state === "failed" && <div className="it red"><span className="d red" /><span className="nm">provisioning_failed · DC 分配超时</span></div>}
              {isCancelled(o.id) && <div className="it grey"><span className="d grey" /><span className="nm">cancelled · 人工取消</span></div>}
              {!isCancelled(o.id) && !isRefunded(o.id) && terminalOf(o.id) && <div className="it red"><span className="d red" /><span className="nm">{terminalOf(o.id)} · 人工补建终态</span></div>}
              {isRefunded(o.id) && <div className="it warn"><span className="d warn" /><span className="nm">refunded · 人工退款</span></div>}
            </div>
          </Drawer>
        );
      })()}

      {/* SKU 新增 / 编辑 抽屉 */}
      {skuDrawer && <Drawer title={editName ? "编辑 SKU" : "新增 SKU"} sub={<AutoGloss>{editName ? "改价 / 库存 / 日产基准 / 上架阶段 · 改后走操作确认" : "填写商品规格 · 提交后走操作确认"}</AutoGloss>} onClose={() => { setSkuDrawer(false); setEditName(null); resetSkuMedia(null); }}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => { setSkuDrawer(false); setEditName(null); resetSkuMedia(null); }}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!form.name || !form.price || skuMediaUploading || (!!skuMedia && !skuMedia.assetId)} onClick={openSkuSaveConfirm}>{editName ? "保存修改" : "提交确认"}</Btn></>}>
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
                <SkuFld label="库存 stock" value={form.stock} onChange={(v) => setForm({ ...form, stock: v })} placeholder="47" hint="留空=∞" />
              </div>
            ) : (
              <SkuFld label="累计销量" type="number" value={form.sold} onChange={(v) => setForm({ ...form, sold: v })} placeholder="12483" hint="份额无限量,不设库存" />
            )}
            <div className="grid g-2" style={{ gap: 12 }}>
              <SkuFld label="评分" type="number" value={form.rating} onChange={(v) => setForm({ ...form, rating: v })} placeholder="4.8" />
              <SkuFld label="评论数" type="number" value={form.reviews} onChange={(v) => setForm({ ...form, reviews: v })} placeholder="2847" />
            </div>
          </SkuFieldGroup>

          <SkuFieldGroup n="⑥" title="代际 & 生命周期">
            <div className="grid g-2" style={{ gap: 12 }}>
              <label className="col" style={{ gap: 5 }}><span className="muted tiny">产品代际</span><select className="fld" value={form.generation} onChange={(e) => setForm({ ...form, generation: e.target.value })}><option value="">请选择代际</option>{["1", "2", "3"].map((x) => <option key={x} value={x}>第 {x} 代</option>)}</select></label>
              <label className="col" style={{ gap: 5 }}><span className="muted tiny">生命周期</span><select className="fld" value={form.lifecycle} onChange={(e) => setForm({ ...form, lifecycle: e.target.value })}><option value="">请选择生命周期</option>{SKU_LIFECYCLE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            </div>
            {form.tier !== "Share" && <>
              <div className="grid g-2" style={{ gap: 12 }}>
                <label className="col" style={{ gap: 5 }}><span className="muted tiny"><AutoGloss>解锁阶段（代际发布门）</AutoGloss></span><select className="fld" value={form.unlock} onChange={(e) => setForm({ ...form, unlock: e.target.value })} disabled={skuPhaseIds.length === 0}>{skuPhaseIds.length === 0 ? <option value="">请先配置阶段</option> : skuPhaseIds.map((p) => <option key={p} value={p}>{e1PhaseLabel(p)}</option>)}</select></label>
                <SkuFld label="以旧换新折扣 USD" type="number" value={form.tradeinDiscount} onChange={(v) => setForm({ ...form, tradeinDiscount: v })} placeholder="300" hint="可空" />
              </div>
              <label className="col" style={{ gap: 5 }}>
                <span className="muted tiny">被替代为 supersededBy<span style={{ color: "var(--ink-4)" }}> · 可空 · 选下一代 SKU</span></span>
                <select className="fld" value={form.supersededBy} onChange={(e) => setForm({ ...form, supersededBy: e.target.value })}>
                  <option value="">— 无(未被替代)—</option>
                  {skus.filter((s) => (s.id || s.name) !== (form.id.trim() || editName)).map((s) => <option key={s.name} value={s.id || s.name}>{s.name} · {s.id || s.name}</option>)}
                  {/* 陈旧值兜底:当前 supersededBy 指向已删/不在目录的 SKU 时补一项,防 select 回显空→提交误清。 */}
                  {form.supersededBy.trim() && !skus.some((s) => (s.id || s.name) === form.supersededBy.trim()) && <option value={form.supersededBy}>{form.supersededBy}(已不在目录)</option>}
                </select>
              </label>
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
                {["llm-inference", "image-gen", "video-render", "fine-tune", "embedding"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">代表模型</span><input className="fld" value={taskForm.model} onChange={(e) => setTaskForm({ ...taskForm, model: e.target.value })} placeholder="如 Llama-3.1-405B" /></label>
          </div>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">minReward(USDT)</span><input className="fld" type="number" value={taskForm.minReward} onChange={(e) => setTaskForm({ ...taskForm, minReward: e.target.value })} placeholder="0.80" /></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">maxReward(USDT)</span><input className="fld" type="number" value={taskForm.maxReward} onChange={(e) => setTaskForm({ ...taskForm, maxReward: e.target.value })} placeholder="2.40" /></label>
          </div>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">minVRAM(最低显存)</span><input className="fld" value={taskForm.minVRAM} onChange={(e) => setTaskForm({ ...taskForm, minVRAM: e.target.value })} placeholder="如 80GB" /></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">kill 初始状态</span><div className="row wrap" style={{ gap: 6 }}>{["派发中", "已 kill", "限流中"].map((k) => <Chip key={k} tab sel={taskForm.killInit === k} onClick={() => setTaskForm({ ...taskForm, killInit: k })}>{k}</Chip>)}</div></label>
          </div>
          <div className="tint warn tiny"><AutoGloss>单价 / 门槛 / taskClass 为高敏字段 · 以后端为准;taskClass 建立与后台派单引擎的权威映射,改后对新派单生效 + 前端 /earn 任务池同步,需操作确认留痕。</AutoGloss></div>
        </div>
      </Drawer>}

      {/* 评价新增 / 编辑 抽屉 */}
      {reviewDrawer && <Drawer title={editReviewId ? "编辑评价" : "新增评价"} sub={<AutoGloss>用户评价 · 关联单个设备 · 增删改后对该商品详情页生效</AutoGloss>} onClose={() => { setReviewDrawer(false); setEditReviewId(null); }}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => { setReviewDrawer(false); setEditReviewId(null); }}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!reviewForm.author.trim() || !reviewForm.content.trim()} onClick={submitReview}>{editReviewId ? "保存修改" : "提交新增"}</Btn></>}>
        <div className="col" style={{ gap: 12 }}>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">关联商品(在售设备)</span><select className="fld" value={reviewForm.productId} onChange={(e) => setReviewForm({ ...reviewForm, productId: e.target.value })}>{skus.filter((s) => (s.status || "on") !== "off").map((s) => <option key={s.name} value={s.id || s.name}>{s.name}</option>)}</select></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">评分</span><select className="fld" value={reviewForm.rating} onChange={(e) => setReviewForm({ ...reviewForm, rating: e.target.value })}>{["5", "4", "3", "2", "1"].map((n) => <option key={n} value={n}>{n} ★</option>)}</select></label>
          </div>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">评价人</span><input className="fld" value={reviewForm.author} onChange={(e) => setReviewForm({ ...reviewForm, author: e.target.value })} placeholder="张三 · ID" /></label>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">评价内容</span><textarea className="fld" style={{ minHeight: 72, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} value={reviewForm.content} onChange={(e) => setReviewForm({ ...reviewForm, content: e.target.value })} placeholder="约 11 个月回本,托管稳定。" /></label>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">时间文案</span><input className="fld" value={reviewForm.date} onChange={(e) => setReviewForm({ ...reviewForm, date: e.target.value })} placeholder="2 天前" /></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">状态</span><select className="fld" value={reviewForm.status} onChange={(e) => setReviewForm({ ...reviewForm, status: e.target.value })}>{REVIEW_STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          </div>
          <div className="tint tiny"><AutoGloss>评价为内容运营动作 · 提交即写审计 A2;隐藏态不对用户展示。</AutoGloss></div>
        </div>
      </Drawer>}

      {/* E5 数据中心新增 / 编辑抽屉 */}
      {dcDrawer && <Drawer title={editDcLocation ? "编辑数据中心" : "新增数据中心"} sub={<AutoGloss>数据中心卡片配置 · 写入后端 MySQL</AutoGloss>} onClose={() => { setDcDrawer(false); setEditDcLocation(null); }}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => { setDcDrawer(false); setEditDcLocation(null); }}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={(!editDcLocation && !dcForm.dcLocation.trim()) || !dcForm.regionLabel.trim()} onClick={openDatacenterSaveConfirm}>{editDcLocation ? "保存修改" : "提交新增"}</Btn></>}>
        <div className="col" style={{ gap: 12 }}>
          <label className="col" style={{ gap: 5 }}>
            <span className="muted tiny">DC 标识</span>
            <input className="fld" value={dcForm.dcLocation} disabled={!!editDcLocation} onChange={(e) => setDcForm({ ...dcForm, dcLocation: e.target.value })} placeholder="us-east-2" />
          </label>
          <label className="col" style={{ gap: 5 }}>
            <span className="muted tiny">区域展示名</span>
            <input className="fld" value={dcForm.regionLabel} onChange={(e) => setDcForm({ ...dcForm, regionLabel: e.target.value })} placeholder="美国 · 弗吉尼亚" />
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
        onClose={() => setActionConfirm(null)}
        onConfirm={async (reason, newValue, businessValue) => {
          if (!mc) return;
          try {
            if (mc.op === "sku-save") {
              const ex = editName ? skus.find((x) => x.name === editName) : undefined;
              const sku = attachSkuMedia(formToSku(form, ex), skuMedia);
              await saveE1Sku(sku, editName ? (ex?.id || ex?.name || editName) : undefined, reason, operator);
              await refreshE1();
              setToast(editName ? "SKU 已更新:" + form.name : "SKU 已新增:" + form.name + " · 待上架");
              setEditName(null);
              resetSkuMedia(null);
            } else if (mc.op === "sku-delete" && mc.target) {
              const sku = skus.find((x) => x.name === mc.target || x.id === mc.target);
              await deleteE1Sku(sku?.id || mc.target, reason, operator);
              await refreshE1();
              setToast("SKU 已删除:" + mc.target);
            } else if (mc.op === "sku-status" && mc.target) {
              const sku = skus.find((x) => x.name === mc.target || x.id === mc.target);
              await updateE1SkuStatus(sku?.id || mc.target, mc.status!, reason, operator);
              await refreshE1();
              setToast("SKU " + mc.target + (mc.status === "off" ? " 已下架" : " 已上架"));
            } else if (mc.op === "task-down" && mc.taskId) {
              await deleteE2Task(mc.taskId, reason, operator);
              await refreshE2();
              setToast("任务已下架:" + (mc.target ?? mc.taskId));
            } else if (mc.op === "task-price" && mc.taskId) {
              const v = Number(newValue);
              if (Number.isFinite(v) && v > 0) {
                await updateE2TaskPrice(mc.taskId, v, reason, operator);
                await refreshE2();
                setToast(mc.name + ":已写入 $" + v + " · 后端已生效");
              }
              else setToast("请填写有效单价");
            } else if (mc.op === "task-save" && editTaskId) {
              // 任务全字段编辑:基础字段 + 扩展派单配置一并保存。
              const price = Number(taskForm.price) || 0;
              const sat = taskForm.sat.trim() ? Math.max(0, Math.min(100, Number(taskForm.sat))) / 100 : null;
              const minR = Number(taskForm.minReward), maxR = Number(taskForm.maxReward);
              await updateE2Task({
                id: editTaskId,
                n: taskForm.n.trim(),
                price,
                unit: taskForm.unit,
                req: taskForm.req,
                sat,
                taskClass: taskForm.taskClass,
                model: taskForm.model.trim(),
                minReward: minR,
                maxReward: maxR,
                minVRAM: taskForm.minVRAM.trim(),
                killInit: taskForm.killInit,
              }, reason, operator);
              await refreshE2();
              setToast("任务已更新:" + taskForm.n.trim() + " · 后端已生效");
              setEditTaskId(null);
            } else if (mc.op === "phone-tier" && mc.phoneTier && mc.phoneField) {
              const v = Number(newValue);
              if (Number.isFinite(v) && v > 0) {
                const patch = mc.phoneField === "dailyUsdt" ? { dailyUsdt: v } : { dailyNex: v };
                await updateE2PhoneTier(mc.phoneTier, patch, reason, operator);
                await refreshE2();
                setToast(mc.name + ":已写入 " + v + " · 后端已生效");
              } else {
                setToast("请填写有效档位收益");
              }
            } else if (mc.op === "param" && mc.paramKey) {
              const v = (newValue ?? "").trim();
              if (mc.paramKey.startsWith("E.gen.")) {
                setE1Gates(await updateE1GenerationGate(mc.paramKey, v, reason, operator));
              } else if (isE3ParamKey(mc.paramKey)) {
                setE3Params(await updateE3Param(mc.paramKey, v, reason, operator));
                await refreshE3();
              } else {
                throw new Error("E_PARAM_BACKEND_ROUTE_MISSING:" + mc.paramKey);
              }
              setToast(mc.name + ":已写入 " + v + " · server-canonical");
            } else if (mc.op === "param-multi" && mc.paramKeys && businessValue) {
              // 多字段调参:每字段写到自己的 param key;E 域只允许走后端配置接口。
              const e3Values: Record<string, string> = {};
              for (const { key, paramKey } of mc.paramKeys) {
                const next = (businessValue[key] ?? "").trim();
                if (isE3ParamKey(paramKey)) {
                  e3Values[paramKey] = next;
                } else {
                  throw new Error("E_PARAM_BACKEND_ROUTE_MISSING:" + paramKey);
                }
              }
              if (Object.keys(e3Values).length) {
                setE3Params(await updateE3Params(e3Values, reason, operator));
                await refreshE3();
              }
              const summary = mc.paramKeys.map(({ key }) => (businessValue[key] ?? "").trim()).join(" / ");
              setToast(mc.name + ":已写入 " + summary + " · server-canonical");
            } else if (mc.op === "param-fixed" && mc.paramKey && mc.fixedVal != null) {
              if (mc.paramKey.startsWith("E.gen.")) {
                setE1Gates(await updateE1GenerationGate(mc.paramKey, mc.fixedVal, reason, operator));
              } else if (isE3ParamKey(mc.paramKey)) {
                setE3Params(await updateE3Param(mc.paramKey, mc.fixedVal, reason, operator));
                await refreshE3();
              } else {
                throw new Error("E_PARAM_BACKEND_ROUTE_MISSING:" + mc.paramKey);
              }
              setToast(mc.name + " · 已生效 · 以后端为准");
            } else if (mc.op === "phase-save" && businessValue) {
              const payload = {
                label: businessValue.label?.trim(),
                meta: businessValue.meta?.trim(),
                skus: businessValue.skus?.trim(),
                sortOrder: Number(businessValue.sortOrder),
                status: businessValue.status || "active",
              };
              setE1Gates(mc.phaseId
                ? await patchE1Phase(mc.phaseId, payload, reason, operator)
                : await createE1Phase(payload, reason, operator));
              await refreshE1();
              setToast(mc.phaseId ? "阶段已更新:" + payload.label : "阶段已新增:" + payload.label);
            } else if (mc.op === "phase-archive" && mc.phaseId) {
              setE1Gates(await archiveE1Phase(mc.phaseId, reason, operator));
              await refreshE1();
              setToast("阶段已归档");
            } else if (mc.op === "phase-current" && mc.phaseId) {
              setE1Gates(await setE1CurrentPhase(mc.phaseId, reason, operator));
              await refreshE1();
              setToast("当前阶段已切换:" + (mc.target ?? mc.phaseId));
            } else if (mc.op === "generation-gate-save" && businessValue) {
              const payload = {
                skuId: businessValue.skuId,
                name: businessValue.name?.trim() || undefined,
                releaseMonth: Number(businessValue.releaseMonth),
                phase: businessValue.phase,
                discount: Number(businessValue.discount),
                eligibility: businessValue.eligibility === "true",
                phaseOffset: Number(businessValue.phaseOffset || "0"),
                forceUnlock: businessValue.forceUnlock === "true",
                status: "active",
              };
              setE1Gates(mc.generationGateId
                ? await patchE1GenerationGate(mc.generationGateId, payload, reason, operator)
                : await createE1GenerationGate(payload, reason, operator));
              await refreshE1(); // 对齐 phase-save/gate-force:刷新 e1Skus/phases 等派生面,防 SKU 解锁阶段下拉读 stale
              setToast(mc.generationGateId ? "代际门已更新:" + payload.skuId : "代际门已新增:" + payload.skuId);
            } else if (mc.op === "generation-gate-force" && mc.generationGateId && mc.generationGate?.forceUnlock != null) {
              const enabled = !!mc.generationGate.forceUnlock;
              setE1Gates(await patchE1GenerationGate(mc.generationGateId, { forceUnlock: enabled }, reason, operator));
              await refreshE1();
              setToast((enabled ? "强制提前开放已开启:" : "强制提前开放已撤销:") + mc.generationGateId);
            } else if (mc.op === "generation-gate-archive" && mc.generationGateId) {
              setE1Gates(await archiveE1GenerationGate(mc.generationGateId, reason, operator));
              await refreshE1(); // 对齐 phase-archive:刷新派生面
              setToast("代际门已移除:" + mc.generationGateId);
            } else if (mc.op === "order-state" && mc.orderId && mc.fixedVal) {
              await updateE4OrderState(mc.orderId, mc.fixedVal, reason, operator);
              await refreshE4();
              setToast("订单 " + mc.orderId + " 已更新为:" + stateLabel(mc.fixedVal));
              setSelOrder(null);
            } else if (mc.op === "order-refund" && mc.orderId) {
              await refundE4Order(mc.orderId, reason, operator);
              await refreshE4();
              setToast("订单 " + mc.orderId + " 已退款 · 资产回退已联动 D4 冲正 + C3");
              setSelOrder(null);
            } else if (mc.op === "order-cancel" && mc.orderId) {
              await cancelE4Order(mc.orderId, reason, operator);
              await refreshE4();
              setToast("订单 " + mc.orderId + " 已取消 · 后续分配/扣费已终止");
              setSelOrder(null);
            } else if (mc.op === "order-terminal" && mc.orderId) {
              const v = (newValue ?? "").trim();
              if (v) {
                await terminalE4Order(mc.orderId, v, reason, operator);
                await refreshE4();
                setToast("订单 " + mc.orderId + " 已补建终态:" + stateLabel(v));
              }
              setSelOrder(null);
            } else if (mc.op === "device-activate" && mc.deviceId) {
              await activateE5Device(mc.deviceId, reason, operator);
              await refreshE5();
              setToast("设备 " + (mc.deviceNo ?? mc.deviceId) + " 已提交激活 · 后端已生效");
            } else if (mc.op === "device-deactivate" && mc.deviceId) {
              await deactivateE5Device(mc.deviceId, reason, operator);
              await refreshE5();
              setToast("设备 " + (mc.deviceNo ?? mc.deviceId) + " 已取消激活/解绑 · 后端已生效");
            } else if (mc.op === "dc-save" && mc.dcForm) {
              const payload: E5DatacenterInput = {
                dcLocation: mc.dcForm.dcLocation.trim(),
                regionLabel: mc.dcForm.regionLabel.trim(),
                status: mc.dcForm.status,
                sortOrder: Number(mc.dcForm.sortOrder) || 100,
              };
              if (mc.isNew) {
                await createE5Datacenter(payload, reason, operator);
              } else {
                await updateE5Datacenter(mc.dc ?? payload.dcLocation, payload, reason, operator);
              }
              await refreshE5();
              setEditDcLocation(null);
              setToast((mc.isNew ? "数据中心已新增:" : "数据中心已更新:") + payload.dcLocation);
            } else if (mc.op === "dc-delete" && mc.dc) {
              await deleteE5Datacenter(mc.dc, reason, operator);
              await refreshE5();
              setToast("数据中心已删除:" + mc.dc);
            } else if (mc.op === "ops-pause" && mc.dc) {
              const paused = mc.fixedVal === "true";
              await setE5DatacenterPaused(mc.dc, paused, reason, operator);
              await refreshE5();
              setToast(mc.dc + (paused ? " 已暂停派单" : " 已恢复派单") + " · 后端已生效");
            } else { setToast("已确认生效"); }
          } catch (error) {
            setToast((mc.name || "操作") + ":失败 " + (error instanceof Error ? error.message : "E1_ACTION_FAILED"));
          } finally {
            setActionConfirm(null);
          }
        }} />}
      {toastNode}
    </div>
  );
}
