"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Boxes, ImageIcon } from "lucide-react";
import { BlockState, Button, Check, CheckGroup, Decision, DiffList, Drawer, Explain, Facts, Fact, Field, Fold, Input, LevelStrip, Modal, Notice, NumberInput, ReleaseModal, SectionNav, Select, Textarea, useSectionNav } from "@/app/components/rd";
import type { OpsSku } from "@/lib/admin/platform-types";
import type { E1GenerationGateData } from "@/lib/admin/e1-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { fetchSkuDatacenterLabels, fetchTaskPools, type TaskPool } from "@/lib/admin/task-pool-client";
import { refreshAdminMediaPreviewUrl } from "@/lib/admin/media-client";
import { guardedFetch, displayAdminError } from "@/lib/admin/error-messages";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { createA2CommandKey } from "@/lib/admin/a2-client";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { supportsDeviceMonthlyTarget, SKU_MODEL_UNRECOGNIZED_REASON } from "@/lib/admin/device-monthly-target";
import { EMPTY_SKU_FORM, skuToForm, formToSku, validateSkuSpecs, validateGateForm, type SkuForm } from "./data";
import { e1MediaCommands, E1_LEVELS, E1_SKU_FIELDS, e1Number, e1SkuDiff, type E1MediaPending } from "./e1-state";
import { E1TargetRange } from "./e1-catalog";

export type E1EditRequest = { sku?: OpsSku; unlock?: string; nonce: number };
type Media = { kind: "image" | "video"; src: string; name: string; size?: number; w?: number; h?: number; duration?: number; assetId?: string; objectKey?: string } | null;
const SECTIONS = [{ id: "e1-basic", label: "基本信息" }, { id: "e1-earnings", label: "收益与任务" }, { id: "e1-stock", label: "库存与购买条件" }, { id: "e1-specs", label: "规格与资料" }];

function EditorSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={`section-${id}`} className="e1-editor-section"><h3 tabIndex={-1} data-section-focus>{title}</h3>{children}</section>;
}

export function E1Editor({ request, gates, writable, currentSku, onClose, onReview, busy, toast, onMediaChange }: {
  request: E1EditRequest | null; gates: E1GenerationGateData | null; writable: boolean; currentSku?: OpsSku;
  onClose: () => void; onReview: (sku: OpsSku, before: OpsSku | undefined, form: SkuForm) => void;
  busy: boolean; toast: (text: string) => void; onMediaChange: () => void;
}) {
  const actor = useAdminAuth(s => String(s.session?.adminId ?? ""));
  const operator = useAdminAuth(s => s.operator || s.session?.operator || s.session?.username || "");
  const canReadE2 = useAdminAuth(s => s.session?.authorities.includes("device_e2_read") ?? false);
  const [form, setForm] = useState<SkuForm>(EMPTY_SKU_FORM);
  const [original, setOriginal] = useState<OpsSku>();
  const [initialForm, setInitialForm] = useState("");
  const [media, setMedia] = useState<Media>(null);
  const [initialMedia, setInitialMedia] = useState("");
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [mediaPending, setMediaPending] = useState<E1MediaPending | null>(null);
  const [mediaRejected, setMediaRejected] = useState(false);
  const [mediaRelease, setMediaRelease] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<File | null>(null);
  const uploadBusy = useRef(false);
  const [pools, setPools] = useState<TaskPool[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [labelError, setLabelError] = useState("");
  const [leave, setLeave] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [versionAccepted, setVersionAccepted] = useState(false);
  const editId = original?.id;
  const nav = useSectionNav(SECTIONS, { ready: !!request });
  const imageIdentity = (m: Media) => JSON.stringify([m?.assetId ?? "", m?.objectKey ?? ""]);
  const dirty = !!request && (JSON.stringify(form) !== initialForm || imageIdentity(media) !== initialMedia);
  const latestChanged = !!original && !!currentSku && original.updatedAt !== currentSku.updatedAt;
  const draft: OpsSku = { ...original, ...formToSku(form, original), imageAssetId: media?.assetId, imageObjectKey: media?.objectKey, imagePreviewUrl: undefined };
  if (original) {
    const opened = skuToForm(original);
    // A complete snapshot must retain untouched values, including legacy formatting.
    const earningsChanged = ["monthlyTargetUsdt", "monthlyTargetBandPct", "dailyEarn", "dailyEarnNEX", "shareYieldMin", "shareYieldMax", "tier", "price"].some(key => form[key as keyof SkuForm] !== opened[key as keyof SkuForm]);
    for (const { key } of E1_SKU_FIELDS) {
      if (["dailyEarn", "shareYieldMin", "shareYieldMax", "gpu"].includes(key)) continue;
      if (key in opened && JSON.stringify(form[key as keyof SkuForm]) === JSON.stringify(opened[key as keyof SkuForm])) Object.assign(draft, { [key]: original[key] });
    }
    if (form.gpu === opened.gpu && form.gpuCount === opened.gpuCount) draft.gpu = original.gpu;
    if (Object.keys(opened).filter(key => key.startsWith("gate")).every(key => form[key as keyof SkuForm] === opened[key as keyof SkuForm])) draft.purchaseGate = original.purchaseGate;
    if (!earningsChanged) {
      draft.dailyEarn = original.dailyEarn; draft.shareYieldMin = original.shareYieldMin; draft.shareYieldMax = original.shareYieldMax;
      draft.baseRate = original.baseRate; draft.derivedDailyEarnUsdt = original.derivedDailyEarnUsdt;
      draft.derivedShareYieldMinPct = original.derivedShareYieldMinPct; draft.derivedShareYieldMaxPct = original.derivedShareYieldMaxPct;
    }
  }
  const changes = e1SkuDiff(original, draft, form).filter(r => r.before !== r.after);
  const update = (key: keyof SkuForm, value: string) => { setForm(f => ({ ...f, [key]: value })); setErrors(e => ({ ...e, [key]: "" })); };
  const refreshPreview = useCallback(async (assetId: string) => {
    try {
      const asset = await refreshAdminMediaPreviewUrl(assetId);
      setMedia(m => m?.assetId === assetId ? { ...m, src: asset.previewUrl, size: asset.sizeBytes ?? undefined } : m);
    } catch { setMediaError("图片已保存，预览暂时显示不了；可重新加载图片。"); }
  }, []);
  useEffect(() => {
    if (!request) return;
    const sku = request.sku, next = sku ? skuToForm(sku) : { ...EMPTY_SKU_FORM, allowedPoolCodes: [], unlock: gates?.phaseOrder[0] ?? "" };
    if (request.unlock !== undefined) next.unlock = request.unlock;
    const m: Media = sku?.imageAssetId && sku.imageObjectKey ? { kind: /\.(mp4|webm|mov)$/i.test(sku.imageObjectKey) ? "video" : "image", src: "", name: sku.imageObjectKey.split("/").pop() ?? "商品媒体", assetId: sku.imageAssetId, objectKey: sku.imageObjectKey } : null;
    setOriginal(sku); setForm(next); setInitialForm(JSON.stringify(sku ? skuToForm(sku) : next));
    setMedia(m); setInitialMedia(imageIdentity(m)); setErrors({}); setLeave(false); setVersionAccepted(false); setMediaError("");
    setMediaPending(e1MediaCommands.list().find(r => r.actorId === actor) ?? null);
    if (m?.assetId) void refreshPreview(m.assetId);
    void Promise.allSettled([canReadE2 ? fetchTaskPools() : Promise.resolve([]), fetchSkuDatacenterLabels()]).then(([p, l]) => {
      setPools(p.status === "fulfilled" ? p.value : []);
      if (l.status === "fulfilled") { setLabels(l.value); setLabelError(""); } else setLabelError("建议暂不可用，可直接填写");
    });
  // Only an explicit open replaces the draft. Background reads never overwrite it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce, actor, canReadE2, refreshPreview]);
  useEffect(() => {
    if (!dirty && !mediaBusy && !mediaPending) return;
    const prevent = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, mediaBusy, mediaPending]);
  useEffect(() => {
    if (!media?.src.startsWith("blob:")) return;
    const src = media.src;
    return () => URL.revokeObjectURL(src);
  }, [media?.src]);

  const upload = async (record: E1MediaPending, file: File, retry: boolean) => {
    if (!writable || uploadBusy.current || record.actorId !== actor || isRetryExpired(record)) throw new Error(isRetryExpired(record) ? RETRY_EXPIRED_TEXT : "没有上传权限、原文件正在上传或账号不符");
    e1MediaCommands.remember(record.fingerprint, record.commandKey, record);
    if (!e1MediaCommands.isDurablyStored(record.fingerprint, record.commandKey)) { setMediaError("浏览器无法保存原上传，本次没有发送；请保留原文件核对。"); return; }
    uploadBusy.current = true; setMediaBusy(true); setMediaRejected(false); setMediaError("");
    try {
      const body = new FormData(); body.append("file", file);
      const response = await guardedFetch(`/api/admin/media/uploads?${new URLSearchParams(record.params)}`, { method: "POST", body, headers: { "Idempotency-Key": record.commandKey }, cache: "no-store" });
      const raw: unknown = await response.json().catch(() => null);
      const result = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
      const data = result?.data && typeof result.data === "object" && !Array.isArray(result.data) ? result.data as Record<string, unknown> : null;
      const message = typeof result?.message === "string" ? result.message : "";
      if (!response.ok || result?.code !== 0 || !data || typeof data.assetId !== "string" || !data.assetId.trim() || typeof data.objectKey !== "string" || !data.objectKey.trim()
        || data.sizeBytes != null && (typeof data.sizeBytes !== "number" || !Number.isFinite(data.sizeBytes) || data.sizeBytes < 0)) {
        throw Object.assign(new Error(message || "上传结果未确认，请保留原文件和命令号核对"), { status: response.status, backendMessage: message, unknownOutcome: response.status >= 500 || response.ok });
      }
      const assetId = data.assetId, objectKey = data.objectKey, size = data.sizeBytes == null ? record.size : data.sizeBytes as number;
      setMedia(m => ({ kind: record.kind, src: `/api/admin/media/uploads/${encodeURIComponent(assetId)}/content`, name: record.fileName, size, w: m?.w, h: m?.h, duration: m?.duration, assetId, objectKey }));
      e1MediaCommands.forget(record.fingerprint, record.commandKey); setMediaPending(null); fileRef.current = null; onMediaChange(); toast("已上传；商品关联仍需提交审批");
    } catch (error) {
      if (!retry && isExplicitRejection(error)) { e1MediaCommands.forget(record.fingerprint, record.commandKey); setMediaPending(null); fileRef.current = null; }
      else { setMediaPending(record); if (retry && isExplicitRejection(error)) setMediaRejected(true); }
      setMediaError(displayAdminError(error)); onMediaChange();
    } finally { uploadBusy.current = false; setMediaBusy(false); }
  };
  const pickMedia = async (file?: File) => {
    if (!file || uploadBusy.current || !writable) return;
    const ext = file.name.split(".").pop()?.toLowerCase(), mime = file.type.toLowerCase();
    const kinds: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
    if (!ext || !kinds[ext] || mime && mime !== kinds[ext]) { setMediaError("请上传匹配扩展名与类型的 JPG / PNG / WebP / GIF / MP4 / WebM / MOV"); return; }
    const kind = kinds[ext].startsWith("image/") ? "image" : "video";
    if (file.size > (kind === "image" ? 10 : 200) * 1024 * 1024) { setMediaError(kind === "image" ? "图片不能超过 10 MiB" : "视频不能超过 200 MiB"); return; }
    setMediaBusy(true);
    let record = mediaPending;
    try {
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), b => b.toString(16).padStart(2, "0")).join("");
      if (record) {
        if (record.fileName !== file.name || record.size !== file.size || record.mime !== file.type || record.digest !== digest) { setMediaError("与原文件名称、类型、大小或摘要不一致；只能重新选择原文件核对"); return; }
      } else {
        const key = createA2CommandKey("e1-media"), fingerprint = `media|${actor}`;
        const params = { domain: "E", usage: kind === "video" ? "sku-video" : "sku-image", entityType: "SKU", entityId: form.id.trim() || form.name.trim() || editId || "draft-sku", operator };
        e1MediaCommands.remember(fingerprint, key, { actorId: actor, skuId: editId ?? "", fileName: file.name, mime: file.type, size: file.size, digest, params, kind });
        if (!e1MediaCommands.isDurablyStored(fingerprint, key)) { e1MediaCommands.forget(fingerprint, key); throw new Error("浏览器无法保存原操作，本次没有上传"); }
        record = e1MediaCommands.list().find(r => r.commandKey === key)!;
      }
      setMediaPending(record); fileRef.current = file; onMediaChange();
      const src = URL.createObjectURL(file);
      setMedia(m => m?.assetId ? m : { kind, src, name: file.name, size: file.size });
      if (kind === "image") {
        const image = new Image(); image.onload = () => { setMedia(m => m && !m.assetId ? { ...m, w: image.width, h: image.height } : m); }; image.src = src;
      } else {
        const video = document.createElement("video"); video.preload = "metadata"; video.muted = true;
        video.onloadedmetadata = () => { setMedia(m => m && !m.assetId ? { ...m, w: video.videoWidth, h: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration : undefined } : m); video.removeAttribute("src"); video.load(); };
        video.src = src;
      }
      if (!mediaPending) await upload(record, file, false);
      else setMediaError("已核对原文件，现可按原文件重试");
    } catch (error) { setMediaError(displayAdminError(error)); }
    finally { setMediaBusy(false); }
  };
  const crop = async () => {
    if (!media || media.kind !== "image" || mediaPending || mediaBusy || !writable) return;
    setMediaBusy(true);
    try {
      const image = new Image(); image.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = media.src; });
      const side = Math.min(image.width, image.height), canvas = document.createElement("canvas"); canvas.width = canvas.height = side;
      canvas.getContext("2d")!.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, side, side);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("裁剪失败")), "image/png"));
      setMediaBusy(false);
      await pickMedia(new File([blob], `${media.name.replace(/\.[^.]+$/, "")}-1x1.png`, { type: "image/png" }));
    } catch { setMediaError("裁剪没有完成，原媒体保留；请稍后重试"); } finally { setMediaBusy(false); }
  };

  const review = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "请填写型号名称";
    if (!form.tier) e.tier = "请选择档位";
    if (!form.lifecycle) e.lifecycle = "请选择生命周期";
    if (!/^\d+(?:\.\d+)?$/.test(form.price.trim()) || Number(form.price) <= 0) e.price = "售价须为大于 0 的 USD 金额";
    if (!editId && !supportsDeviceMonthlyTarget(form.id.trim() || form.name.trim(), form.tier)) e.id = SKU_MODEL_UNRECOGNIZED_REASON;
    if (form.id.trim().toLowerCase() === "phone") e.id = "phone 是手机策略的专用编号";
    if (form.datacenter.trim().length > 128) e.datacenter = "托管机房最多 128 字";
    if (original?.status === "on") {
      if (!form.allowedPoolCodes.length) e.allowedPoolCodes = "在售商品至少要选择一个任务等级";
      if (!form.datacenter.trim()) e.datacenter = "在售商品必须填写托管机房";
      if (!form.monthlyTargetUsdt.trim()) e.monthlyTargetUsdt = "在售商品不能清空月收益目标";
    }
    if (original?.monthlyTargetUsdt != null && !form.monthlyTargetUsdt.trim() && form.monthlyTargetBandPct.trim()) e.monthlyTargetBandPct = "关闭目标时请使用关闭选项，同时清空允许波动";
    for (const key of ["phoneDailyEarn", "phoneDailyEarnNEX"] as const) {
      const raw = form[key].trim();
      if (raw && (!/^\d+(?:\.\d{1,6})?$/.test(raw) || raw.replace(".", "").replace(/^0+/, "").length > 18)) e[key] = "须为非负数，总精度最多 18 位、小数最多 6 位";
    }
    for (const key of ["dailyEarn", "dailyEarnNEX", "shareYieldMin", "shareYieldMax"] as const) if (form[key].trim() && !/^\d+(?:\.\d+)?$/.test(form[key].trim())) e[key] = "请填写有效的非负数";
    for (const key of ["aiImageGenPerMin", "aiLlmTokensPerSec", "aiVideoMinPerHour", "aiFineTuneMins"] as const) if (form[key].trim() && (!/^-?\d+$/.test(form[key].trim()) || BigInt(form[key]) < BigInt("-9223372036854775808") || BigInt(form[key]) > BigInt("9223372036854775807"))) e[key] = "请填写 64 位整数，不能含小数";
    for (const key of ["gateRankMin", "gateActiveDirectMin", "gateTeamComputePointsMin", "gateQuotaCap"] as const) if (form[key].trim() && !/^\d+$/.test(form[key].trim())) e[key] = "请填写非负整数";
    if (form.uptime.length > 64) e.uptime = "在线率最多 64 字";
    if (form.warranty.length > 128) e.warranty = "质保期限最多 128 字";
    if (form.inventoryMode === "FINITE" && (!/^\d+$/.test(form.stock) || Number(form.stock) > 2147483647)) e.stock = "库存须为 0～2147483647 的整数";
    if (form.tier !== "Share" && form.inventoryMode === "UNLIMITED") e.inventoryMode = "仅共享份额可用不限库存";
    const specError = validateSkuSpecs(form, original);
    if (specError) {
      const key = /GPU/.test(specError) ? "gpuCount" : /算力点/.test(specError) ? "computePoints" : /资料|HTTPS/.test(specError) ? "specDocumentUrl" : /波动/.test(specError) ? "monthlyTargetBandPct" : /托管/.test(specError) ? "datacenter" : /年奖励率/.test(specError) ? "shareYieldMin" : /每日收益/.test(specError) ? "dailyEarn" : "monthlyTargetUsdt";
      e[key] = specError;
    }
    // Removing a quota clears its entire tuple; the read-only sold value remains in the draft.
    const gateError = validateGateForm(form.gateQuotaCap.trim() ? form : { ...form, gateQuotaSold: "" });
    if (gateError) e[/阶段/.test(gateError) ? "unlock" : /周期/.test(gateError) ? "gateQuotaPeriod" : /会员/.test(gateError) ? "gateRankMin" : /直接/.test(gateError) ? "gateActiveDirectMin" : /算力点/.test(gateError) ? "gateTeamComputePointsMin" : "gateQuotaCap"] = gateError;
    if (gates?.skuReviewContractVersion !== 1) e.form = "商品审核暂时不可用，请刷新后重试；已填写的内容会保留";
    if (!writable) e.form = "当前不能提交，请核对权限和目录读取状态";
    if (mediaBusy || mediaPending || media && !media.assetId) e.media = "媒体上传尚未确认，请先核对原文件";
    if (latestChanged && !versionAccepted) e.form = "商品修订已变化，请核对新旧修订后继续";
    setErrors(e);
    if (Object.keys(e).length) {
      const first = Object.keys(e)[0];
      const section = ["name", "id", "tier", "lifecycle", "tagline", "badge", "media"].includes(first) ? "e1-basic" : ["stock", "unlock", "inventoryMode", "gateQuotaPeriod", "gateQuotaCap", "gateRankMin", "gateActiveDirectMin", "gateTeamComputePointsMin"].includes(first) ? "e1-stock" : ["gpuCount", "specDocumentUrl", "uptime", "warranty"].includes(first) || first.startsWith("ai") ? "e1-specs" : "e1-earnings";
      nav.select(section); return;
    }
    if (original && !changes.length) { toast("没有任何修改，无需提交"); return; }
    setLeave(false);
    onReview(draft, original, form);
  };
  const close = () => { if (busy || mediaBusy) return; if (dirty) setLeave(true); else onClose(); };
  const field = (key: keyof SkuForm, label: string, options: { number?: boolean; unit?: string; min?: number; max?: number; step?: number; hint?: string; help?: string; explain?: string; disabled?: boolean; required?: boolean; placeholder?: string } = {}) => <Field label={label} required={options.required} hint={options.hint} help={options.help} error={errors[key]} explain={options.explain ?? `${label}是商品目录资料；批准后供之后的目录读取，不回写原订单。`}>
    {options.number ? <NumberInput aria-label={label} value={String(form[key])} onChange={e => update(key, e.target.value)} unit={options.unit} min={options.min} max={options.max} step={options.step} disabled={options.disabled || busy} placeholder={options.placeholder} /> : <Input aria-label={label} value={String(form[key])} onChange={e => update(key, e.target.value)} disabled={options.disabled || busy} placeholder={options.placeholder} />}
  </Field>;
  const blocked = !writable ? "当前账号不能提交" : gates?.skuReviewContractVersion !== 1 ? "商品审核契约未读取，请刷新" : mediaBusy ? "媒体正在上传" : mediaPending ? "媒体上传结果未确认" : !dirty || original && !changes.length ? "没有修改" : undefined;
  const sectionItems = SECTIONS.map((s, index) => {
    const keys = index === 0 ? ["name", "id", "tier", "lifecycle", "badge", "tagline", "media"] : index === 1 ? ["price", "computePoints", "allowedPoolCodes", "monthlyTargetUsdt", "monthlyTargetBandPct", "datacenter", "dailyEarn", "dailyEarnNEX", "phoneDailyEarn", "phoneDailyEarnNEX", "shareYieldMin", "shareYieldMax"] : index === 2 ? ["inventoryMode", "stock", "unlock", "gateRankMin", "gateActiveDirectMin", "gateTeamComputePointsMin", "gateQuotaCap", "gateQuotaPeriod"] : ["gpuCount", "uptime", "warranty", "specDocumentTitle", "specDocumentUrl", "aiImageGenPerMin", "aiLlmTokensPerSec", "aiVideoMinPerHour", "aiFineTuneMins"];
    const invalid = keys.some(key => !!errors[key]);
    const state = invalid ? "有错误" : index === 0 ? form.name && form.tier && form.lifecycle ? "已填" : "待填" : index === 1 ? form.price && (!form.allowedPoolCodes.length || form.monthlyTargetUsdt) ? "已填" : "待填" : index === 2 ? form.inventoryMode === "UNLIMITED" || form.stock !== "" ? "已填" : "待填" : "选填";
    return { ...s, label: `${s.label} · ${state}`, alert: invalid };
  });
  const hasTarget = form.monthlyTargetUsdt.trim() !== "";
  const canClear = original?.monthlyTargetUsdt != null && original.status !== "on" && !form.allowedPoolCodes.length;
  return <>
    <Drawer open={!!request} onClose={close} title={editId ? "编辑商品" : "新增商品"} sub={original?.name ?? "草稿 · 批准后生效"} icon={Boxes} wide busy={busy || mediaBusy} explain="四区可直接定位，不需要依次下一步。上传仅保存媒体，商品内容须提交审批。" footer={<Decision note={`${form.name || "未命名商品"} · ${changes.length} 项改动 · 批准后生效`} primary={<Button variant="primary" disabledReason={blocked} onClick={review}>{editId ? "保存修改" : "提交确认"}</Button>} others={<Button disabled={busy || mediaBusy} onClick={close}>取消</Button>} />}>
      {errors.form && <Notice tone="warn" title={errors.form} />}
      {latestChanged && <Notice tone="warn" title="商品修订已变化，本地输入仍保留"><Facts><Fact k="打开时修订">{original.updatedAt}</Fact><Fact k="最新修订">{currentSku?.updatedAt}</Fact></Facts>{currentSku && <Fold inset title="读取期间的商品变化" summary="核对完整前后值"><DiffList rows={e1SkuDiff(original, currentSku)} /></Fold>}<Check label="我已核对最新修订，保留本地改动" checked={versionAccepted} onChange={e => { setVersionAccepted(e.target.checked); if (e.target.checked && currentSku) setOriginal(currentSku); }} /></Notice>}
      <div className="e1-editor-shell"><div className="e1-editor-layout"><SectionNav label="商品编辑分区" items={sectionItems} nav={nav} /><div className="e1-editor-content">
        <EditorSection id="e1-basic" title="基本信息">
          <div className="rd-form-grid">{field("name", "型号名称", { required: true })}{field("id", "商品编号", { disabled: !!editId, help: editId ? "创建后不能修改" : "留空沿型号名称生成；编号需包含型号标识" })}
            <Field label="档位" required error={errors.tier} explain="商品分类。共享份额可用不限库存，部分硬件字段收起后原值仍保留。"><Select aria-label="档位" required value={form.tier} onChange={v => setForm(f => ({ ...f, tier: v, inventoryMode: v === "Share" ? f.inventoryMode : "FINITE" }))} placeholder="请选择档位" options={[{ value: "Entry", label: "入门档" }, { value: "Pro", label: "专业档" }, { value: "Flagship", label: "旗舰档" }, { value: "Share", label: "共享份额" }]} /></Field>
            <Field label="生命周期" required error={errors.lifecycle} explain="现行或已停产，与商城上下架状态独立。"><Select aria-label="生命周期" required value={form.lifecycle} onChange={v => update("lifecycle", v)} placeholder="请选择生命周期" options={[{ value: "active", label: "现行" }, { value: "legacy", label: "已停产" }]} /></Field>
            {field("badge", "营销角标", { explain: "商品媒体旁的活动文字，批准后显示在商品卡。" })}{field("tagline", "商品标语", { explain: "商品识别文案，批准后供商品卡和商品详情读取。" })}
          </div>
          {(!editId && (form.id || form.name) && !supportsDeviceMonthlyTarget(form.id || form.name, form.tier) || original && !supportsDeviceMonthlyTarget(original.id, form.tier, original.productType)) && <Notice tone="warn" title={SKU_MODEL_UNRECOGNIZED_REASON} />}
          <Field label="产品图 / 视频" error={errors.media} explain="图片≤10 MiB；视频≤200 MiB。直接上传不经审批；关联商品由商品提案批准，移除不删除原资源。">
            <label className="e1-upload" data-drag={drag ? "" : undefined} onDragOver={e => { e.preventDefault(); if (!mediaBusy) setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); void pickMedia(e.dataTransfer.files[0]); }}>
              <input type="file" aria-label={mediaPending ? "重新选择原文件" : "上传商品图片或视频"} accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" disabled={!writable || mediaBusy || busy} onChange={e => { void pickMedia(e.target.files?.[0]); e.currentTarget.value = ""; }} />
              <ImageIcon size={24} aria-hidden /><span>{drag ? "松开即上传" : mediaPending ? "重新选择原文件核对" : "点击或拖拽图片/视频到此"}</span>
            </label>
          </Field>
          {media && <div className="e1-editor-media">{media.src ? media.kind === "video" ? <video src={media.src} controls muted playsInline preload="metadata" onLoadedMetadata={e => { const v = e.currentTarget; setMedia(m => m ? { ...m, w: v.videoWidth, h: v.videoHeight, duration: Number.isFinite(v.duration) ? v.duration : undefined } : m); }} onError={() => setMediaError("视频已保存，预览暂时显示不了")} /> : <img src={media.src} alt="商品媒体预览" onLoad={e => { const i = e.currentTarget; setMedia(m => m ? { ...m, w: i.naturalWidth, h: i.naturalHeight } : m); }} onError={() => setMediaError("图片已保存，预览暂时显示不了")} /> : <BlockState compact state="error" title="图片已保存，预览暂时显示不了" />}
            <div className="e1-muted">{media.name} · {media.size == null ? "大小未读取" : `${e1Number(media.size)} 字节`} · {media.w && media.h ? `${media.w}×${media.h}px` : "尺寸未读取"}{media.kind === "video" && ` · ${media.duration == null ? "时长未读取" : `${e1Number(media.duration)} 秒`}`}</div>
            <div className="e1-table-actions">{media.assetId && <Button size="sm" onClick={() => void refreshPreview(media.assetId!)}>重新加载图片</Button>}{media.kind === "image" && media.w && media.h && Math.abs(media.w - media.h) > Math.max(media.w, media.h) * 0.02 && <Button size="sm" disabledReason={mediaBusy || mediaPending ? "先核对上传结果" : undefined} onClick={() => void crop()}>裁剪为 1:1</Button>}<Button size="sm" disabledReason={mediaBusy || mediaPending ? "先核对上传结果" : undefined} onClick={() => setMedia(null)}>移除</Button></div>
          </div>}
          {mediaError && <Notice tone="warn" title={mediaError} />}
          {mediaPending && <Notice tone="warn" title="媒体上传结果未确认" actionBelow action={<><Button disabledReason={mediaBusy ? "正在上传" : isRetryExpired(mediaPending) ? RETRY_EXPIRED_TEXT : !fileRef.current ? "请重新选择原文件核对摘要" : undefined} onClick={() => fileRef.current && void upload(mediaPending, fileRef.current, true)}>按原文件重试</Button>{mediaRejected && !isRetryExpired(mediaPending) && <Button onClick={() => setMediaRelease(true)}>解除待确认</Button>}</>}><p>{isRetryExpired(mediaPending) ? RETRY_EXPIRED_TEXT : "只允许原文件、原参数和原命令号重试；新文件不能替代原操作。"}</p><Fold inset title="原上传与技术信息" summary={mediaPending.fileName}><pre className="e1-raw">{JSON.stringify(mediaPending, null, 2)}</pre></Fold></Notice>}
        </EditorSection>
        <EditorSection id="e1-earnings" title="收益与任务">
          <div className="rd-form-grid">{field("price", "售价(USD)", { number: true, unit: "USD", min: 0, required: true, explain: "购买一件商品的目录价，批准后影响新交易；原订单快照不回写。" })}{field("computePoints", "每件算力点", { number: true, min: 0, step: 1, help: editId ? "留空保留原值；0 为真实零" : "留空按售价 × 10", explain: "购买一件计入团队的点数，最多18位非负整数，只影响之后的新订单快照；App为0时当前隐藏。" })}</div>
          <CheckGroup legend="任务等级" explain="等级只决定跑什么任务；每单收益按月目标配平。已发布策略决定用户端等级文字，未批准的草稿不生效。" summary={`${form.allowedPoolCodes.length} 级已选`}>{E1_LEVELS.map(level => <Check key={level.key} label={`${level.label} ${level.name}`} explain={pools.find(p => p.code === level.key) ? `该等级当前启用 ${pools.find(p => p.code === level.key)!.enabledCount} 个任务；数量不决定是否可选。` : "固定设备任务等级，可自由选择，不依赖任务池读取权限。"} checked={form.allowedPoolCodes.includes(level.key)} onChange={e => setForm(f => ({ ...f, allowedPoolCodes: e.target.checked ? [...f.allowedPoolCodes, level.key] : f.allowedPoolCodes.filter(c => c !== level.key) }))} />)}</CheckGroup>
          {errors.allowedPoolCodes && <Notice tone="warn" title={errors.allowedPoolCodes} />}
          <div className="e1-draft-preview"><span className="e1-muted">本次草稿 · App 等级文字预览<Explain label="等级文字显示位置" content="批准发布后的等级文字由用户端本地化；商品卡、详情、组合购买与活动组合均可读取。空等级隐藏此句，不代表设备能运行任务。" /></span><LevelStrip label="本次草稿任务等级" levels={E1_LEVELS} selectedKeys={form.allowedPoolCodes} /><strong>{form.allowedPoolCodes.length ? `可运行${E1_LEVELS.filter(l => form.allowedPoolCodes.includes(l.key)).map(l => l.name).join(" / ")} AI算力任务` : "未配置任务等级；等级句隐藏"}</strong></div>
          <div className="rd-form-grid">{field("monthlyTargetUsdt", "月收益目标（USDT）", { number: true, min: 1, max: 1000000, step: 0.01, hint: "1～1,000,000，最多2位小数", explain: "持续运行的设备月预估边界。设备月从购入日、缺失时从激活日起算；停跑不补发，已冻结任务不重算。" })}{field("monthlyTargetBandPct", "允许波动 %", { number: true, min: 1, max: 50, step: 0.1, disabled: !hasTarget, hint: "1～50%，最多1位小数", explain: "目标 ×（1±波动）是配置范围，不是到账保证；提高上界按后端判断覆盖率。" })}</div>
          {canClear && <Check label="关闭已有月收益目标，改用兼容展示值" checked={!hasTarget} onChange={e => setForm(f => ({ ...f, monthlyTargetUsdt: e.target.checked ? "" : String(original!.monthlyTargetUsdt), monthlyTargetBandPct: e.target.checked ? "" : String(original!.monthlyTargetBandPct) }))} />}
          {form.allowedPoolCodes.length > 0 && !hasTarget && <Notice tone="warn" title="已选任务等级，必须填写月收益目标" />}
          {hasTarget && Number(form.monthlyTargetUsdt) >= 1 && Number(form.monthlyTargetBandPct) >= 1 && Number(form.monthlyTargetBandPct) <= 50 && <div className="e1-draft-preview"><span className="e1-muted">本次草稿 · 配置边界</span><E1TargetRange sku={draft} /></div>}
          <Field label="托管机房" error={errors.datacenter} hint="最多128字" explain="交付时复制到新设备的文字，已交付设备不随SKU修改。建议英文城市和编号，可自由手填。"><Input aria-label="托管机房" list="e1-hosting-labels" maxLength={128} value={form.datacenter} onChange={e => update("datacenter", e.target.value)} /><datalist id="e1-hosting-labels">{labels.map(label => <option key={label} value={label} />)}</datalist></Field>
          {labelError && <span className="e1-muted">{labelError}</span>}
          <div className="rd-form-grid">{form.tier !== "Share" ? <>
            {!hasTarget && field("dailyEarn", "每日收益 USDT", { number: true, min: 0, step: 0.000001, help: original?.monthlyTargetUsdt != null ? "关闭月目标时须在同一申请中手填" : "兼容展示值" })}
            {field("dailyEarnNEX", "每日收益 UVT", { number: true, min: 0 })}{field("phoneDailyEarn", "手机每日收益 USDT", { number: true, min: 0, step: 0.000001, help: "可留空，留空时不显示对比" })}{field("phoneDailyEarnNEX", "手机每日收益 UVT", { number: true, min: 0, step: 0.000001, help: "可留空，最多6位小数" })}
          </> : <>{!hasTarget && <>{field("shareYieldMin", "共享份额参考年奖励率下限 %", { number: true, min: 0 })}{field("shareYieldMax", "共享份额参考年奖励率上限 %", { number: true, min: 0 })}</>}{field("dailyEarnNEX", "每日额外发放 UVT", { number: true, min: 0 })}</>}</div>
          {hasTarget && <Facts><Fact k="派生日均">{e1Number(draft.derivedDailyEarnUsdt)} USDT/天</Fact>{form.tier === "Share" && <><Fact k="派生年率下限">{e1Number(draft.derivedShareYieldMinPct)}%</Fact><Fact k="派生年率上限">{e1Number(draft.derivedShareYieldMaxPct)}%</Fact></>}</Facts>}
          {Number(form.price) > 0 && draft.dailyEarn > 0 && <Fold inset title="旧参考测算" summary="参考口径未换汇" explain="沿旧公式保留参考测算。USD售价与USDT日均未换汇，不是实际利润。手机基准固定0.08，不是E6当前档。"><Facts><Fact k="参考回本天数">≈ {e1Number(Number(form.price) / draft.dailyEarn)} 天</Fact><Fact k="首年净额旧算式">{e1Number(draft.dailyEarn * 365 - Number(form.price))}（USDT日均×365 − USD售价，未换汇）</Fact><Fact k="参考年率">≈ {e1Number(draft.dailyEarn * 365 / Number(form.price) * 100)}%</Fact><Fact k="固定手机基准比">≈ {e1Number(draft.dailyEarn / 0.08)} 倍</Fact><Fact k="计算输入">{e1Number(form.price)} USD；{e1Number(draft.dailyEarn)} USDT/天；0.08 USDT/天</Fact></Facts></Fold>}
        </EditorSection>
        <EditorSection id="e1-stock" title="库存与购买条件">
          <div className="rd-form-grid">
            <Field label="库存模式" error={errors.inventoryMode} explain="库存是当前剩余量；不限库存仅适用于非实物共享份额，销量仍累计。">{form.tier === "Share" ? <Select aria-label="库存模式" value={form.inventoryMode} onChange={v => setForm(f => ({ ...f, inventoryMode: v, stock: v === "UNLIMITED" ? "" : f.stock }))} options={[{ value: "FINITE", label: "有限库存（卖一件少一件）" }, { value: "UNLIMITED", label: "不限库存（非实物份额）" }]} /> : <Input aria-label="库存模式" value="有限库存（卖一件少一件）" readOnly />}</Field>
            {form.inventoryMode !== "UNLIMITED" && field("stock", "库存", { number: true, min: 0, max: 2147483647, step: 1, required: true, help: "0 表示售罄，不会自动下架" })}
          </div>
          <Field label="累计销量" explain="按已付款订单累计，新商品从0开始；这里不能修改。"><Input aria-label="累计销量" value={original?.sold == null ? original ? "— · 未读取" : "0" : e1Number(original.sold)} readOnly /></Field>
          <Check label="允许试用" checked={form.trialEligible === "true"} onChange={e => update("trialEligible", String(e.target.checked))} explain="批准后供免费试用设置选择，仍须满足DEVICE/SERVER与有限库存等资格；不自动开始试用，不改存量试用快照。" />
          {form.tier !== "Share" && <Field label="开放阶段" required error={errors.unlock} explain="商品允许开放的阶段，须与上架规则一致。不能在此推进平台阶段。">{gates?.phaseOrder.length === 1 ? control => <div className="e1-table-actions"><Input {...control} aria-label="开放阶段" readOnly value={form.unlock ? gates.phases.find(p => p.p === form.unlock)?.label || form.unlock : "尚未选择开放阶段"} /><Button size="sm" onClick={() => update("unlock", gates.phaseOrder[0])}>选择 {gates.phases.find(p => p.p === gates.phaseOrder[0])?.label || gates.phaseOrder[0]}</Button></div> : <Select aria-label="开放阶段" required value={form.unlock} disabled={!gates?.phaseOrder.length} onChange={v => update("unlock", v)} placeholder={gates?.phaseOrder.length ? "请选择开放阶段" : "请先配置阶段"} options={gates?.phaseOrder.map(id => ({ value: id, label: `${gates.phases.find(p => p.p === id)?.label || id}${id === gates.phaseCurrent ? " · 当前阶段" : ""}` })) ?? []} />}</Field>}
          <Field label="购买条件类型" explain="限制哪些用户可购买；无用户条件仍可独立设置销售配额。"><Select aria-label="购买条件类型" value={form.gateType} onChange={v => update("gateType", v)} options={[{ value: "none", label: "无用户条件" }, { value: "activeDirect", label: "活跃直接邀请人数" }, { value: "rank", label: "最低会员等级" }, { value: "combo", label: "组合条件（会员等级 / 直接邀请 / 团队算力点）" }]} /></Field>
          <div className="rd-form-grid">{(form.gateType === "rank" || form.gateType === "combo") && field("gateRankMin", "最低会员等级", { number: true, min: 0, max: 8, step: 1, help: "0～8；0 为不设条件" })}{(form.gateType === "activeDirect" || form.gateType === "combo") && field("gateActiveDirectMin", "活跃直接邀请人数", { number: true, min: 0, max: 1000000, step: 1, help: "0～1,000,000 的整数" })}{form.gateType === "combo" && field("gateTeamComputePointsMin", "团队算力点", { number: true, min: 0, step: 1, help: "非负整数，0 为不设条件" })}
            {form.gateType === "combo" && <Field label="多条件关系" explain="全部满足是all；任一满足是either。"><Select aria-label="多条件关系" value={form.gateMode} onChange={v => update("gateMode", v)} options={[{ value: "all", label: "全部满足" }, { value: "either", label: "任一满足" }]} /></Field>}
            {field("gateQuotaCap", "本期可售上限", { number: true, min: 1, step: 1, help: "留空不限量；有值时不小于已有售量" })}
            <Field label="本期已售数量" explain="只读销售计数，随商品原快照保留；移除上限时清整组配额。"><Input aria-label="本期已售数量" value={form.gateQuotaSold || "— · 未配置"} readOnly /></Field>
          </div>
          {(form.gateType !== "none" || form.gateQuotaCap) && <>
            <Field label="售卖统计周期" error={errors.gateQuotaPeriod} explain="当前只支持不分周期累计。旧按月值必须人工改选后提交。">{form.gateQuotaPeriod === "month" ? <Select aria-label="售卖统计周期" value={form.gateQuotaPeriod} onChange={v => update("gateQuotaPeriod", v)} options={[{ value: "month", label: "按月统计（已停用）" }, { value: "lifetime", label: "不分周期（累计）" }]} /> : <Input aria-label="售卖统计周期" value="不分周期（累计）" readOnly />}</Field>
            {form.gateQuotaPeriod === "month" && <Notice tone="warn" title="按月统计已停用，请改为不分周期后保存" />}
            <Field label="售罄后限制购买" explain="此项是软配额限制；允许继续购买不代表实体库存不限。"><Select aria-label="售罄后限制购买" value={form.gateEnforce} onChange={v => update("gateEnforce", v)} options={[{ value: "true", label: "卖完后不能再买" }, { value: "false", label: "卖完只显示售罄，仍可购买" }]} /></Field>
          </>}
        </EditorSection>
        <EditorSection id="e1-specs" title="规格与资料">
          <div className="rd-form-grid">{field("gpu", "GPU 型号（单卡）")}{field("gpuCount", "GPU 数量", { number: true, min: 1, max: 1024, step: 1, help: "1～1024，须同时填写单卡型号" })}{field("vram", "显存")}
            {form.tier !== "Share" && <>{field("hashRate", "算力")}{field("power", "功耗 / 功率说明", { help: "注明单卡、显卡合计或整机实测" })}</>}
            {field("uptime", "在线率", { hint: "最多64字" })}{field("warranty", "质保期限", { hint: "最多128字" })}
            {form.tier !== "Share" && <>{field("aiImageGenPerMin", "图像生成 张/分钟", { number: true, step: 1 })}{field("aiLlmTokensPerSec", "大模型推理（词元/秒）", { number: true, step: 1 })}{field("aiVideoMinPerHour", "每小时可渲染视频时长（分钟）", { number: true, step: 1 })}{field("aiFineTuneMins", "LoRA 微调（分钟）", { number: true, step: 1 })}</>}
          </div>
          {field("specDocumentTitle", "资料名称", { hint: "最多200字", explain: "商品外部资料的入口名称；批准后商品详情在名称与安全链接同时存在时显示。" })}
          {field("specDocumentUrl", "资料链接", { hint: "HTTPS，最多2048字", help: "不能含账号密码；同时清空名称和链接可移除", explain: "公开资料的HTTPS地址，不会自动下载或审核链接内容。" })}
          <Field label="特性清单 · 每行一条" explain="商品特性文字，批准后供目录读取；逐行去除空行。"><Textarea aria-label="特性清单 · 每行一条" value={form.features} onChange={e => update("features", e.target.value)} /></Field>
          <Fold inset title="保留的历史资料" summary="原快照随完整商品保留"><Facts><Fact k="历史算力标记">{original?.aiUnlocks || "—"}</Fact><Fact k="评分与评价">{e1Number(original?.rating)} / {e1Number(original?.reviews)}</Fact><Fact k="代际">{e1Number(original?.generation)}</Fact><Fact k="替代商品">{original?.supersededBy || "—"}</Fact><Fact k="置换折扣">{e1Number(original?.tradeinDiscount)}</Fact><Fact k="历史标签">{original?.tag || "—"}</Fact></Facts></Fold>
        </EditorSection>
      </div></div></div>
    </Drawer>
    {leave && <Modal title="保留未保存的商品改动" onClose={() => setLeave(false)} footer={<><Button onClick={() => setLeave(false)}>继续编辑</Button><Button variant="danger-outline" onClick={() => { setLeave(false); onClose(); }}>放弃改动并返回</Button><Button variant="primary" disabledReason={blocked} onClick={review}>提交确认</Button></>}><p>商品改动还没有提交审批。放弃后关闭本地草稿，已上传的媒体资源不删除。</p></Modal>}
    {mediaRelease && mediaPending && <ReleaseModal label={`${mediaPending.fileName} · 媒体上传`} onCancel={() => setMediaRelease(false)} onConfirm={() => { e1MediaCommands.forget(mediaPending.fingerprint, mediaPending.commandKey); setMediaPending(null); fileRef.current = null; setMediaRelease(false); onMediaChange(); }} />}
  </>;
}
