"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import Link from "next/link";
import { ArrowUpRight, Boxes, CirclePause, Clock3, Copy, Play, RefreshCw } from "lucide-react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
import { announcePermissionDenied } from "@/lib/admin/operation-confirm-error";
import { displayAdminReadError, guardedFetch } from "@/lib/admin/error-messages";
import { businessClock, businessZoneText, formatBusinessTimeCompact, parseBusinessTime } from "@/lib/admin/business-time";
import { fetchE5Devices, fetchE5Overview, fetchE5Observability, type E5Device, type E5Overview, type E5Observability, type E5SimState } from "@/lib/admin/e5-client";
import { BlockState, Button, Cell, ColumnPicker, Conclusion, Drawer, Explain, Fact, Facts, FilterBar, FilterField, Fold, IconButton, Input, JudgmentPoints, Modal, PageHeader, Panel, RatioBar, RdPage, RecordList, ScaleBar, Select, Stat, StatBand, StatusDistributionBar, StatusTag, Table, TableLoading, TableMessage, TaskClassTag, Td, Th, Tr, useTableColumns, type TaskClass } from "@/app/components/rd";
import { E5CommandScope, E5DeviceActions, E5PendingMark, E5Slots } from "./e5-device-actions";
import { E5_STATES, pausedReasonText } from "./e5-device-state";
import type { EViewCtx } from "./types";

const SOURCES: Record<string, string> = { ORDER: "购买", TRADE_IN: "置换", TRIAL: "试用转正", PROMOTION_GIFT: "赠送" };
const WAITING: E5SimState[] = ["WAITING_ACTIVATION", "WAITING_INIT", "LEGACY_PENDING"];
const OTHER: E5SimState[] = ["WAITING_CONFIG", "PAUSED", "CLOSING", "UNBOUND", "ERROR", "SIM_OFF"];
/** Backend counts by each device's effective state; they are a separate measure from the four overview numbers. */
const ATTENTION = [{ field: "errorRetry", state: "ERROR" }, { field: "legacyPending", state: "LEGACY_PENDING" }, { field: "waitingConfig", state: "WAITING_CONFIG" }] as const;
const GROUPS = [
  { label: "待启动与需核对", keys: ["WAITING_ACTIVATION", "WAITING_INIT", "LEGACY_PENDING", "WAITING_CONFIG", "ERROR"] },
  { label: "运行、暂停、停用中", keys: ["RUNNING", "PAUSED", "CLOSING"] },
  { label: "已结束与关闭", keys: ["STOPPED", "UNBOUND", "SIM_OFF"] },
];
interface Query { keyword: string; userId: string; simState: string; source: string; productCode: string; pageNum: number; pageSize: number }
const DEFAULT_QUERY: Query = { keyword: "", userId: "", simState: "all", source: "all", productCode: "all", pageNum: 1, pageSize: 10 };
function readQuery() {
  const p = new URLSearchParams(window.location.search);
  const q: Query = { keyword: p.get("keyword") ?? "", userId: p.get("userId") ?? "", simState: p.get("simState") ?? "all", source: p.get("source") ?? "all", productCode: p.get("productCode") ?? "all", pageNum: Number(p.get("pageNum") ?? 1), pageSize: Number(p.get("pageSize") ?? 10) };
  const error = q.simState !== "all" && !Object.hasOwn(E5_STATES, q.simState) ? "设备状态筛选无效，请清除筛选。" : q.source !== "all" && !Object.hasOwn(SOURCES, q.source) ? "设备来源筛选无效，请清除筛选。" : !Number.isSafeInteger(q.pageNum) || q.pageNum < 1 || ![10, 20, 50].includes(q.pageSize) ? "页码或每页条数无效，请清除筛选。" : "";
  return { q, error };
}
function amount(value: number | string, digits = 2) {
  const raw = String(value);
  let expanded = raw;
  const scientific = /^(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(raw);
  if (scientific) {
    const digits = scientific[1] + (scientific[2] ?? "");
    const point = scientific[1].length + Number(scientific[3]);
    expanded = point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length ? digits + "0".repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  const [whole, decimal = ""] = expanded.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${decimal.replace(/0+$/, "").padEnd(digits, "0")}`;
}

function RawAmount({ value, digits }: { value: number | string; digits: number }) {
  return <Tooltip.Provider><Tooltip.Root><Tooltip.Trigger asChild><span tabIndex={0} className="e5-raw-amount" aria-label={`${amount(value, digits)} USDT，后端原值 ${value}`}>{amount(value, digits)}</span></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="rd-tip" sideOffset={6}>后端原值：{String(value)} USDT</Tooltip.Content></Tooltip.Portal></Tooltip.Root></Tooltip.Provider>;
}

function MonthlyIncome({ device, compact = false, digits, rangeDigits }: { device: E5Device; compact?: boolean; digits?: number; rangeDigits?: number }) {
  const target = device.monthlyTarget;
  if (!target) return <span className="e5-empty-value">—{!compact && <Explain label="没有设备月数据" content="没有可显示的设备月数据，不能据此认定已到账为 0。" />}</span>;
  const { rangeLowUsdt: low, rangeHighUsdt: high, creditedUsdt: credited } = target;
  const hasRange = low !== null && high !== null;
  const precision = digits ?? Math.max(...[credited, low, high].filter(value => value !== null).map(value => amount(value!).split(".")[1].length));
  const rangePrecision = rangeDigits ?? Math.max(2, ...[low, high].filter(value => value !== null).map(value => amount(value!).split(".")[1].length));
  const max = hasRange ? Math.max(Number(high), Number(credited)) : 0;
  return <div className="e5-income">
    <div className="e5-amount" data-zero={Number(credited) === 0 ? "" : undefined}><RawAmount value={credited} digits={precision} />{!compact && <> <span className="rd-muted">USDT</span><Explain label="设备月收益口径" content={<>
      <p>第 {target.cycleIndex} 个设备月，{formatBusinessTimeCompact(target.cycleStartAt)}（含）至{formatBusinessTimeCompact(target.cycleEndAt)}（不含）。</p>
      <p>当前产能 {target.capacityPct}%，已到账来自本周期已完成目标任务。</p>
      {!target.targetActive && <p>目标已关闭，保留历史到账，没有预估。</p>}{target.configChangedInCycle && <p>本周期配置曾变化，历史到账不重算。</p>}
      <p>区间按当前配置满运行预估；停跑期间不计收益、不补发。</p>
    </>} /></>}</div>
    {hasRange ? <div className="e5-income-range"><span className="e5-sub">预估 <RawAmount value={low} digits={rangePrecision} />–<RawAmount value={high} digits={rangePrecision} /></span><ScaleBar label="已到账相对满运行预估" valueText={`已到账 ${amount(credited)} USDT，预估 ${amount(low)} 至 ${amount(high)} USDT`} max={max} value={Number(credited)} fill range={{ low: Number(low), high: Number(high) }} tone="role-2" compact quiet state={max === 0 ? "empty" : "ready"} /></div> : <span className="e5-sub">没有预估</span>}
  </div>;
}
function CurrentTask({ device, readAt }: { device: E5Device; readAt: number }) {
  const task = device.currentTask;
  if (!task) return <span className="rd-muted">—</span>;
  const start = parseBusinessTime(task.startedAt), due = parseBusinessTime(task.dueAt);
  const valid = Number.isFinite(start) && Number.isFinite(due) && start < due;
  const text = !valid ? "任务时间不可计算" : readAt >= due ? "已到应完成时间，刷新核对" : readAt < start ? "尚未到开始时间" : `距应完成 ${Math.ceil((due - readAt) / 60000)} 分钟`;
  return <div className="e5-task"><div className="e5-task-head"><Explain label={`当前任务详情：${task.name}`} content={<>
    <p>{task.name}</p><p>任务号：{task.taskNo}</p><p>开始：{formatBusinessTimeCompact(task.startedAt)}</p><p>应完成：{formatBusinessTimeCompact(task.dueAt)}</p><p>总时长：{valid ? `${Math.ceil((due - start) / 60000)} 分钟` : "无法计算"}</p><p>读取：{formatBusinessTimeCompact(new Date(readAt).toISOString())}</p><p>时间位置按读取时刻估算，不是执行完成率。</p>
  </>}><TaskClassTag taskClass={task.taskClass as TaskClass} /></Explain></div><div className="e5-task-time">{valid && readAt >= start && readAt < due && <RatioBar label="读取时刻的时间位置" value={readAt - start} total={due - start} valueText={text} tone="neutral" compact quiet />}<span className="e5-sub" title={text}>{text}</span></div></div>;
}
function DeviceStatus({ device: d, detail = false }: { device: E5Device; detail?: boolean }) {
  const value = E5_STATES[d.simState!];
  const reach = useReach();
  const specific = d.simState !== "SIM_OFF" && (d.simState === "ERROR" || !!d.pausedReason);
  const reason = <>{d.simState === "ERROR" ? <><p>原错误：{d.simLastError || "未提供错误原因"}</p><p>下次自动重试：{d.simNextActionAt ? formatBusinessTimeCompact(d.simNextActionAt) : "等待调度"}</p><p>系统每 30 秒自动重试。</p></> : <>{d.pausedReason && <p>暂停原因：{pausedReasonText(d.pausedReason)}</p>}<p>{d.simState === "WAITING_CONFIG" && detail && reach("/devices/tasks") ? <>没有可用任务，<Link href="/devices/tasks">去任务池核对</Link>。停跑期间不计收益、不补发。</> : value.reason}</p></>}</>;
  return <div className="e5-state"><div className="e5-task-head"><StatusTag tone={value.tone} icon={value.icon}>{value.label}</StatusTag>{specific && !detail && <Explain label={`${value.label}的原因`} content={reason} />}</div>
    {detail ? <div className="e5-status-detail">{reason}</div> : <>{d.simState === "LEGACY_PENDING" && <span className="e5-sub">先核对旧任务</span>}{d.simState === "WAITING_CONFIG" && <span className="e5-sub">{reach("/devices/tasks") ? <Link href="/devices/tasks">去任务池核对</Link> : "去任务池核对"}</span>}{d.simState === "CLOSING" && <span className="e5-sub">结算后自动停用</span>}</>}
  </div>;
}
const EVENTS: Record<string, string> = { E5_DEVICE_ACTIVATED: "激活", E5_DEVICE_DEACTIVATED: "取消激活", E5_DEVICE_UNBOUND: "解绑", E5_DEVICE_FORCE_ACTIVATED: "强制激活", E5_DEVICE_BATCH_PAUSED: "暂停该用户", E5_DEVICE_BATCH_RESUMED: "恢复该用户", "admin.device_activated": "激活", "admin.device_deactivation_requested": "取消激活", "admin.device_deactivated": "设备已停用", "admin.device_unbound": "解绑", "admin.device_paused": "暂停该用户", "admin.device_resumed": "恢复该用户" };

export function E5DevicePage({ ctx }: { ctx: EViewCtx }) {
  const reach = useReach();
  const actor = useAdminAuth(s => s.session?.adminId);
  const epoch = useAdminAuth(s => s.authEpoch);
  const canReadE1 = useAdminAuth(s => s.session?.authorities.includes("device_e1_read"));
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState<Query>(DEFAULT_QUERY);
  const [queryError, setQueryError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<E5Device[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [overview, setOverview] = useState<E5Overview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState("");
  const [readAt, setReadAt] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [totalSelected, setTotalSelected] = useState(false);
  const [group, setGroup] = useState<"waiting" | "other" | null>(null);
  const [products, setProducts] = useState<Map<string, string>>(new Map());
  const [activityOpen, setActivityOpen] = useState(false);
  const [activity, setActivity] = useState<E5Observability | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [activityVersion, setActivityVersion] = useState(0);
  const request = useRef(0);
  const overviewRequest = useRef(0);
  // 列宽排法只给样式用：第一次读完前不定；之后重读、翻页、筛选沿用上一次，只有新一页数据需要另一种时才换，表头不来回跳。
  const [tableLayout, setTableLayout] = useState<{ noRange: boolean; noTask: boolean } | null>(null);
  const columns = useTableColumns("e5-devices", [{ key: "device", label: "设备", locked: "设备不能收起" }, { key: "user", label: "用户", locked: "用户不能收起" }, { key: "status", label: "状态", locked: "状态不能收起" }, { key: "income", label: "本月收益", locked: "收益不能收起" }, { key: "task", label: "当前任务", locked: "当前任务不能收起" }, { key: "actions", label: "操作", locked: "操作不能收起" }, { key: "product", label: "商品 · 托管机房", extra: true }, { key: "source", label: "来源", extra: true }]);
  const showProduct = columns.isVisible("product"), showSource = columns.isVisible("source");
  const extraColumns = showProduct || showSource;
  useEffect(() => {
    const restore = () => { const value = readQuery(); setQuery(value.q); setKeyword(value.q.keyword); setQueryError(value.error); setTotalSelected(false); const id = new URLSearchParams(window.location.search).get("deviceId"); setSelectedId(id && /^\d+$/.test(id) ? Number(id) : null); setReady(true); };
    restore(); window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore);
  }, []);
  const change = useCallback((patch: Partial<Query>) => {
    const next = { ...query, pageNum: 1, ...patch }; const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(next)) {
      if (value === "all" || value === "" || key === "pageNum" && value === 1 || key === "pageSize" && value === 10) url.searchParams.delete(key); else url.searchParams.set(key, String(value));
    }
    url.searchParams.delete("deviceId"); window.history.pushState(null, "", url);
    setSelectedId(null); setTotalSelected(false); setQueryError(""); setQuery(next);
  }, [query]);
  useEffect(() => { if (!ready || keyword === query.keyword) return; const timer = setTimeout(() => change({ keyword }), 300); return () => clearTimeout(timer); }, [keyword, ready, query.keyword, change]);
  const readList = useCallback(async (successMessage?: string) => {
    if (!ready || !ctx.canReadE5 || queryError) { setRows([]); setTotal(0); setLoading(false); return; }
    const id = ++request.current; setLoading(true); setError(""); setRows([]);
    try { const result = await fetchE5Devices(query); if (request.current !== id) return; setRows(result.records); setTotal(result.total); setReadAt(Date.now()); setSelectedId(current => result.records.some(row => row.deviceId === current) ? current : null); return result.records; }
    catch (cause) { if (cause instanceof Error && "status" in cause && (cause.status === 401 || cause.status === 403)) announcePermissionDenied(); if (request.current === id) { setRows([]); setTotal(0); setError(`${successMessage ? `${successMessage}，最新设备状态暂时读不到。` : ""}${displayAdminReadError(cause)}`); setSelectedId(null); } }
    finally { if (request.current === id) setLoading(false); }
  }, [ready, ctx.canReadE5, query, queryError]);
  const readOverview = useCallback(async () => {
    if (!ctx.canReadE5) return;
    const id = ++overviewRequest.current; setOverviewLoading(true); setOverview(null); setOverviewError("");
    try { const value = await fetchE5Overview(); if (id === overviewRequest.current) setOverview(value); }
    catch (cause) { if (cause instanceof Error && "status" in cause && (cause.status === 401 || cause.status === 403)) announcePermissionDenied(); if (id === overviewRequest.current) setOverviewError(displayAdminReadError(cause)); }
    finally { if (id === overviewRequest.current) setOverviewLoading(false); }
  }, [ctx.canReadE5]);
  useEffect(() => { void readList(); return () => { request.current++; }; }, [readList, actor, epoch]);
  useEffect(() => { void readOverview(); return () => { overviewRequest.current++; }; }, [readOverview, actor, epoch]);
  useEffect(() => {
    if (!canReadE1) { setProducts(new Map()); return; }
    let live = true;
    // Names are optional: directory failures never block the device list or its actions.
    void (async () => {
      const names = new Map<string, string>(); let pageNum = 1; let count = 0;
      do {
        const response = await guardedFetch(`/api/admin/devices/skus?pageNum=${pageNum}&pageSize=100`, { cache: "no-store" });
        const result: unknown = await response.json();
        if (!response.ok || !result || typeof result !== "object") return;
        const envelope = result as { code?: unknown; data?: { total?: unknown; records?: unknown } };
        if (envelope.code !== 0 || !Array.isArray(envelope.data?.records) || typeof envelope.data.total !== "number") return;
        for (const raw of envelope.data.records) { if (!raw || typeof raw !== "object") return; const row = raw as Record<string, unknown>; if (typeof row.skuId !== "string" || typeof row.name !== "string") return; names.set(row.skuId, row.name); }
        count += envelope.data.records.length; if (count >= envelope.data.total || !envelope.data.records.length) break; pageNum++;
      } while (live);
      if (live) setProducts(names);
    })().catch(() => { if (live) setProducts(new Map()); });
    return () => { live = false; };
  }, [canReadE1, actor, epoch]);
  useEffect(() => {
    if (!activityOpen || !ctx.canReadE5) return;
    let live = true; setActivityLoading(true); setActivity(null); setActivityError("");
    void fetchE5Observability().then(value => { if (live) setActivity(value); }).catch(cause => { if (live) setActivityError(displayAdminReadError(cause)); }).finally(() => { if (live) setActivityLoading(false); });
    return () => { live = false; };
  }, [activityOpen, activityVersion, actor, epoch, ctx.canReadE5]);
  const refresh = async (successMessage?: string) => { await Promise.all([readList(successMessage), readOverview()]); if (activityOpen) setActivityVersion(value => value + 1); };
  const readBack = async (record: import("@/lib/admin/e5-command").E5Command) => {
    const [fresh] = await Promise.all([readList(), readOverview()]);
    if (!fresh) return "最新设备列表未读到，请重试读取；原操作继续待确认。";
    const matches = fresh.filter(row => record.intent === "pause" || record.intent === "resume" ? row.userId === record.device.userId : row.deviceId === record.device.deviceId);
    return matches.length ? `已读到：${matches.map(row => `${row.serial} · ${E5_STATES[row.simState!].label}`).join("；")}。当前列表状态不能单独确认原操作结果，请结合操作记录与审批核对。` : "已读取当前列表，原对象不在当前页或筛选结果中。请清除筛选核对；原操作继续待确认。";
  };
  const selected = rows.find(row => row.deviceId === selectedId);
  const index = rows.findIndex(row => row.deviceId === selectedId);
  const select = (id: number | null) => { setSelectedId(id); const url = new URL(window.location.href); if (id) url.searchParams.set("deviceId", String(id)); else url.searchParams.delete("deviceId"); window.history.replaceState(null, "", url); };
  const clear = () => { setKeyword(""); change(DEFAULT_QUERY); };
  const productOptions = new Map(products); for (const row of rows) if (!productOptions.has(row.productCode)) productOptions.set(row.productCode, row.productCode); if (query.productCode !== "all" && !productOptions.has(query.productCode)) productOptions.set(query.productCode, query.productCode);
  const activeFilters = Object.entries(query).filter(([key, value]) => ["keyword", "userId", "simState", "source", "productCode"].includes(key) && value !== "" && (key === "userId" || value !== "all"));
  const other = overview ? overview.total - overview.running - overview.waitingActivation - overview.stopped : 0;
  const attention = overview ? ATTENTION.filter(item => overview[item.field] > 0) : [];
  const attentionTotal = attention.reduce((sum, item) => sum + overview![item.field], 0);
  const selectedGroup = query.simState === "RUNNING" ? "running" : query.simState === "STOPPED" ? "stopped" : WAITING.includes(query.simState as E5SimState) ? "waiting" : OTHER.includes(query.simState as E5SimState) ? "other" : undefined;
  const incomeDigits = Math.max(2, ...rows.flatMap(row => row.monthlyTarget ? [row.monthlyTarget.creditedUsdt].filter(value => value !== null).map(value => amount(value!).split(".")[1].length) : []));
  const rangeDigits = Math.max(2, ...rows.flatMap(row => row.monthlyTarget ? [row.monthlyTarget.rangeLowUsdt, row.monthlyTarget.rangeHighUsdt].filter(value => value !== null).map(value => amount(value!).split(".")[1].length) : []));
  // SIM_OFF is the backend's global-switch projection, never mixed with enabled SIM states.
  const simOff = rows.some(row => row.simState === "SIM_OFF");
  const roleReadOnly = !ctx.canWriteE5 && !ctx.canForceActivateE5 && !ctx.canUnbindE5;
  const pageLayout = rows.length ? { noRange: !rows.some(row => row.monthlyTarget && row.monthlyTarget.rangeLowUsdt !== null && row.monthlyTarget.rangeHighUsdt !== null), noTask: !rows.some(row => row.currentTask) } : null;
  const layout = pageLayout ?? tableLayout;
  if (pageLayout && (pageLayout.noRange !== tableLayout?.noRange || pageLayout.noTask !== tableLayout?.noTask)) setTableLayout(pageLayout);
  return <RdPage><PageHeader pageId="E5" title="设备管理" summary={roleReadOnly || simOff ? "查看用户设备的运行状态和本月到账。" : "看用户设备运行、到账，处理激活和停用。"} meta={readAt ? `${businessClock(readAt)}读取 · ${businessZoneText()} · 打开或筛选时读取` : "打开时读取"} readOnly={simOff ? "任务已关闭，本页只读" : roleReadOnly ? "当前账号只能查看设备" : undefined} actions={<Button icon={<RefreshCw size={14} />} disabled={loading || overviewLoading} onClick={() => void refresh()}>刷新</Button>} />
    {!ctx.canReadE5 ? <BlockState state="denied" title="无设备管理读取权限" /> : <E5CommandScope refresh={refresh} readBack={readBack} toast={ctx.toast}>
      <Panel plain className="e5-summary" aria-label="用户设备概览与状态分布">
      {overview?.total !== 0 && <Conclusion state={overviewError || attentionTotal ? "warn" : overview ? "neutral" : "unknown"} icon={Boxes} explain={<><p>这里是用户通过购买、置换、试用转正、赠送得到的设备，不含手机。</p><p>手机在{reach("/devices/compute-config", "device_e5_read") ? <Link href="/devices/compute-config">手机算力配置</Link> : "手机算力配置"}的用户手机里。统计不随筛选变。</p><p>等待启动含待激活、等待初始化、旧任务未结清，后两者不能笼统当成点激活。</p><p>其他含等待配置、已暂停、停用中、已解绑、出错重试中、任务已关闭。</p></>}>
        {overviewLoading ? "正在读取用户设备概览…" : overview ? simOff ? `任务已关闭，${overview.total} 台用户设备仅可查看` : overview.total ? `${overview.total} 台用户设备，${overview.running} 台运行中${overview.waitingActivation ? `，${overview.waitingActivation} 台等待启动` : ""}${attentionTotal ? `，${attentionTotal} 台需要处理` : ""}` : "还没有用户设备" : "暂时无法判断设备运行情况"}
      </Conclusion>}
      <StatBand label="全部用户设备概览">
        <Stat icon={Boxes} label={<>设备总数 <ArrowUpRight size={12} aria-hidden /></>} value={overviewLoading ? <span className="rd-skeleton" aria-label="正在读取" /> : overview?.total ?? "—"} unit="台" tone="role-2" onOpen={() => { change({ simState: "all" }); setTotalSelected(true); }} openLabel="查看全部设备状态" selected={totalSelected} selectedText="已筛选" />
        <Stat icon={Play} label={<>运行中 <ArrowUpRight size={12} aria-hidden /></>} value={overviewLoading ? <span className="rd-skeleton" aria-label="正在读取" /> : overview?.running ?? "—"} unit="台" tone="ok" onOpen={() => change({ simState: "RUNNING" })} openLabel="查运行中" selected={query.simState === "RUNNING"} selectedText="已筛选" />
        <Stat icon={Clock3} label={<>等待启动 <ArrowUpRight size={12} aria-hidden /></>} value={overviewLoading ? <span className="rd-skeleton" aria-label="正在读取" /> : overview?.waitingActivation ?? "—"} unit="台" tone="progress" explain="包含待激活、等待初始化和旧任务未结清；请选择一个真实状态筛选。" onOpen={() => setGroup("waiting")} openLabel="选择等待启动状态" selected={selectedGroup === "waiting"} selectedText="已筛选" />
        <Stat icon={CirclePause} label={<>已停用 <ArrowUpRight size={12} aria-hidden /></>} value={overviewLoading ? <span className="rd-skeleton" aria-label="正在读取" /> : overview?.stopped ?? "—"} unit="台" tone="done" onOpen={() => change({ simState: "STOPPED" })} openLabel="查已停用" selected={query.simState === "STOPPED"} selectedText="已筛选" />
      </StatBand>
      {overview?.total !== 0 && <Panel title="状态分布" className="e5-distribution" explain="只统计用户通过购买、置换、试用转正、赠送得到的设备，不含手机；四数不随筛选变。点击等待启动或其他后，选择一个真实状态。">
      {overviewLoading && <BlockState compact state="loading" title="正在读取状态分布…" />}
      {overviewError && <BlockState compact state="error" title="概览读取失败" detail={overviewError} onRetry={() => void readOverview()} />}
      {overview && other < 0 ? <BlockState compact state="error" title="状态分布暂时无法核对" onRetry={() => void readOverview()} /> : overview && overview.total > 0 && <StatusDistributionBar label={`用户设备状态分布，共 ${overview.total} 台`} emptyText="暂无用户设备" selectedKey={selectedGroup} segments={[
        { key: "running", label: "运行中", value: overview.running, text: `${overview.running} 台`, tone: "ok", onSelect: () => change({ simState: "RUNNING" }) },
        { key: "waiting", label: "等待启动", value: overview.waitingActivation, text: `${overview.waitingActivation} 台`, tone: "progress", onSelect: () => setGroup("waiting") },
        { key: "stopped", label: "已停用", value: overview.stopped, text: `${overview.stopped} 台`, tone: "done", onSelect: () => change({ simState: "STOPPED" }) },
        { key: "other", label: "其他", value: other, text: `${other} 台`, tone: "role-other", onSelect: () => setGroup("other") },
      ]} />}
      {attention.length > 0 && <div className="e5-attention" role="group" aria-label="需要处理的设备">
        <span className="e5-attention-label">需要处理<Explain label="需要处理的统计口径" content={<><p>按设备当前的有效状态统计，和上面四个数分开算；同一台设备可能两边都算到，不能相加。</p><p>为 0 的状态不显示；三数不随筛选变。点一项按这个状态筛选设备。</p></>} /></span>
        {attention.map(item => <Button key={item.state} size="sm" variant="ghost" className="e5-attention-item" data-selected={query.simState === item.state ? "" : undefined} aria-label={`按${E5_STATES[item.state].label}筛选，共 ${overview![item.field]} 台`} onClick={() => change({ simState: item.state })}>
          <StatusTag tone={E5_STATES[item.state].tone}>{E5_STATES[item.state].label}</StatusTag><span className="e5-attention-count">{overview![item.field]} 台</span>{query.simState === item.state ? <span className="e5-attention-on">已筛选</span> : <ArrowUpRight size={12} aria-hidden />}
        </Button>)}
      </div>}
      </Panel>}
      </Panel>
      <Panel title="用户设备" flush className="e5-list-panel" actions={<ColumnPicker columns={columns} />}>
        <FilterBar onClear={clear} canClear={!!activeFilters.length || !!queryError} onSubmit={() => change({ keyword })} action={<></>} moreCount={query.productCode !== "all" ? 1 : 0}
          applied={activeFilters.map(([key, value]) => ({ key, label: key === "simState" ? E5_STATES[value as E5SimState]?.label ?? String(value) : key === "source" ? SOURCES[String(value)] ?? String(value) : key === "productCode" ? products.get(String(value)) ?? String(value) : key === "userId" ? `只看用户 ${rows.find(row => row.userId === String(value))?.userNo ?? `ID ${value}`}` : String(value), onRemove: () => { if (key === "keyword") setKeyword(""); change({ [key]: key === "keyword" || key === "userId" ? "" : "all" }); } }))}
          more={<FilterField><Select aria-label="商品筛选" value={query.productCode} onChange={productCode => change({ productCode })} options={[{ value: "all", label: "全部商品" }, ...Array.from(productOptions).map(([value, label]) => ({ value, label }))]} /></FilterField>}>
          <FilterField><Select aria-label="设备状态筛选" value={Object.hasOwn(E5_STATES, query.simState) || query.simState === "all" ? query.simState : "invalid"} onChange={simState => change({ simState })} options={[{ value: "all", label: "全部状态" }, ...(query.simState !== "all" && !Object.hasOwn(E5_STATES, query.simState) ? [{ value: "invalid", label: "无效状态", disabled: true }] : [])]} groups={GROUPS.map(group => ({ label: group.label, options: group.keys.map(value => ({ value, label: E5_STATES[value as E5SimState].label })) }))} /></FilterField>
          <FilterField grow><Input value={keyword} aria-label="搜索用户设备" placeholder="搜索用户 / 设备 / 商品" onChange={event => setKeyword(event.target.value)} /></FilterField>
          <FilterField><Select aria-label="设备来源筛选" value={query.source} onChange={source => change({ source })} options={[{ value: "all", label: "全部来源" }, ...Object.entries(SOURCES).map(([value, label]) => ({ value, label }))]} /></FilterField>
        </FilterBar>
        <div className="e5-table-host" data-proof="e5-devices" data-layout-pending={!layout && loading ? "" : undefined} data-no-range={layout?.noRange ? "" : undefined} data-no-task={layout?.noTask ? "" : undefined} data-extra={extraColumns ? "" : undefined} data-product={showProduct ? "" : undefined} data-source={showSource ? "" : undefined}><Table label="用户设备" className="e5-table"><colgroup><col className="e5-col-device" /><col className="e5-col-user" />{showProduct && <col className="e5-col-product" />}{showSource && <col className="e5-col-source" />}<col className="e5-col-status" /><col className="e5-col-income" /><col className="e5-col-task" /><col className="e5-col-action" /></colgroup><thead><tr><Th sticky={extraColumns ? "start" : undefined} className="e5-device-col">设备</Th><Th className="e5-user-col">用户</Th>{showProduct && <Th className="e5-product-col">商品 · 托管机房</Th>}{showSource && <Th>来源</Th>}<Th align="left" sticky={extraColumns ? "end" : undefined} className="e5-status-col">状态<Explain label="设备状态说明" content={Object.entries(E5_STATES).map(([key, value]) => <p key={key}>{value.label}：{value.reason}</p>)} /></Th><Th align="right" className="e5-income-col">本月收益（USDT）<Explain label="设备月收益口径" content="到账是本设备月已完成目标任务的收益，预估按当前配置满运行计算；没有设备月数据不认定为 0。点设备行可核对周期起止、产能、目标关闭和周期内配置变化。停跑期间不计收益、不补发。" /></Th><Th className="e5-task-col">当前任务<Explain label="当前任务口径" content="当前任务为空不代表设备没有运行。点任务类型可核对任务名、任务号、起止与读取时间；时间位置不是执行完成率。" /></Th><Th align="right" sticky={extraColumns ? "end" : undefined} className="e5-action-col">操作</Th></tr></thead><tbody>
          {loading ? <TableLoading columns={6 + Number(columns.isVisible("product")) + Number(columns.isVisible("source"))} /> : error || queryError ? <TableMessage columns={6 + Number(showProduct) + Number(showSource)}><BlockState state="error" title={queryError ? "筛选条件无效" : "用户设备读取失败"} detail={queryError || error} retryLabel={queryError ? "清除筛选" : "重试读取"} onRetry={queryError ? clear : () => void readList()} /></TableMessage> : !rows.length ? <TableMessage columns={6 + Number(showProduct) + Number(showSource)}><BlockState state="empty" title={activeFilters.length ? "暂无符合条件的用户设备" : "暂无用户设备"} onRetry={activeFilters.length ? clear : undefined} retryLabel="清除筛选" /></TableMessage> : rows.map(d => <Tr key={d.deviceId} selected={d.deviceId === selectedId} onOpen={() => select(d.deviceId)}>
            <Td sticky={extraColumns ? "start" : undefined} className="e5-device-col"><Cell main={<span className="e5-device-name"><span title={d.deviceName}>{d.deviceName}</span><E5PendingMark device={d} /></span>} sub={<Tooltip.Provider><Tooltip.Root><Tooltip.Trigger asChild><span className="e5-serial" tabIndex={0} aria-label={d.serial} title={d.serial}><span className="e5-serial-prefix" aria-hidden>{d.serial.slice(0, -8)}</span><span className="e5-serial-suffix" aria-hidden>{d.serial.slice(-8)}</span></span></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="rd-tip e5-serial-tip" sideOffset={6}>{d.serial}</Tooltip.Content></Tooltip.Portal></Tooltip.Root></Tooltip.Provider>} /></Td><Td className="e5-user-col"><Cell main={d.nickname} sub={<span className="e5-user-meta">{reach(`/users/search/${d.userNo}`) ? <Link href={`/users/search/${d.userNo}`}>{d.userNo}</Link> : d.userNo}<span aria-hidden>·</span><Button size="sm" variant="ghost" className="e5-user-slots" data-full={d.activeDevicesForUser >= d.maxDevicesPerUser ? "" : undefined} aria-label={`这位用户已激活 ${d.activeDevicesForUser} 台设备（含手机），每人最多 ${d.maxDevicesPerUser} 台。点击只看这位用户的设备`} title={`这位用户已激活 ${d.activeDevicesForUser} 台设备（含手机），每人最多 ${d.maxDevicesPerUser} 台。点击只看这位用户的设备`} onClick={() => { setKeyword(""); change({ userId: d.userId, keyword: "" }); }}><span><span className="e5-slot-prefix" aria-hidden>已激活 </span>{d.activeDevicesForUser}/{d.maxDevicesPerUser}</span><ArrowUpRight size={11} aria-hidden /></Button></span>} title={d.user} /></Td>
            {showProduct && <Td className="e5-product-col"><Cell main={products.get(d.productCode) ?? d.productCode} sub={d.hostingLabel || "—"} title={d.hostingLabel} /></Td>}{showSource && <Td>{SOURCES[d.sourceChannel]}</Td>}
            <Td align="left" sticky={extraColumns ? "end" : undefined} className="e5-status-col"><DeviceStatus device={d} /></Td><Td align="right" className="e5-income-col"><MonthlyIncome device={d} compact digits={incomeDigits} rangeDigits={rangeDigits} /></Td><Td className="e5-task-col"><CurrentTask device={d} readAt={readAt} /></Td><Td align="right" sticky={extraColumns ? "end" : undefined} className="e5-action-col"><E5DeviceActions device={d} ctx={ctx} /></Td>
          </Tr>)}
        </tbody></Table></div>
        {total > 0 && <div className="rd-pager" data-list-pager="" data-list-label="设备"><span className="rd-pager-range">第 {query.pageNum} / {Math.max(1, Math.ceil(total / query.pageSize))} 页 · 共 {total} 台</span><div className="rd-pager-tools"><Select aria-label="设备每页条数" value={String(query.pageSize)} onChange={value => change({ pageSize: Number(value) })} options={[10, 20, 50].map(size => ({ value: String(size), label: `${size} 台/页` }))} /><Button size="sm" aria-label="设备 上一页" disabled={loading || query.pageNum <= 1} onClick={() => change({ pageNum: query.pageNum - 1 })}>上一页</Button><Button size="sm" aria-label="设备 下一页" disabled={loading || query.pageNum >= Math.ceil(total / query.pageSize)} onClick={() => change({ pageNum: query.pageNum + 1 })}>下一页</Button></div></div>}
      </Panel>
      <div className="e5-activity"><Fold title="最近 24 小时操作" summary={activityLoading ? "正在加载…" : activityError ? "读取失败" : activity ? `最近 ${activity.activity.length} 条` : "尚未读取"} explain="最多 50 条，不等于完整操作总数。" open={activityOpen} onOpenChange={setActivityOpen}>
        {activityLoading ? <BlockState state="loading" title="正在加载…" /> : activityError ? <BlockState state="error" title="操作记录读取失败" detail={activityError} onRetry={() => setActivityVersion(value => value + 1)} /> : activity && !activity.activity.length ? <BlockState state="empty" title="暂无设备操作" /> : activity && <RecordList label="设备操作" records={activity.activity.map((entry, index) => {
          const batch = entry.aggregateType === "E5_DEVICE_BATCH";
          const device = rows.find(row => batch ? row.userId === String(entry.aggregateId) : String(row.deviceId) === String(entry.aggregateId));
          return { id: `${entry.aggregateId}:${index}`, value: <>{EVENTS[entry.eventType] ?? "设备操作"}<Explain label="这条操作的技术信息" content={<><p>原事件：{entry.eventType}</p><p>原对象：{entry.aggregateType} / {entry.aggregateId}</p></>} /></>, object: device ? batch ? device.user : `${device.deviceName} · ${device.serial}` : `${batch ? "用户" : "设备"}编号 ${entry.aggregateId}（不在当前页）`, at: entry.occurredAt };
        })} />}
      </Fold></div>
      {selected && <Drawer open data-e5-detail="" title="设备详情" sub={<span className="e5-serial" data-mono title={selected.serial}><span className="e5-serial-prefix">{selected.serial.slice(0, -8)}</span><span className="e5-serial-suffix">{selected.serial.slice(-8)}</span></span>} onClose={() => select(null)} nav={{ hasPrev: index > 0, hasNext: index < rows.length - 1, onPrev: () => select(rows[index - 1].deviceId), onNext: () => select(rows[index + 1].deviceId) }} footer={<E5DeviceActions device={selected} ctx={ctx} inline />}>
        <JudgmentPoints rows={[{ label: "状态与下一步", value: <DeviceStatus device={selected} detail /> }, { label: "本月收益", value: <MonthlyIncome device={selected} />, reason: selected.monthlyTarget ? `当前产能 ${selected.monthlyTarget.capacityPct}%` : undefined }, { label: "当前任务", value: <CurrentTask device={selected} readAt={readAt} /> }]} />
        <Panel title="设备事实" plain><Facts><Fact k="设备">{selected.deviceName}</Fact><Fact k="实例号"><span className="e5-instance" data-mono>{selected.serial}</span><IconButton aria-label="复制实例号" onClick={() => { void navigator.clipboard.writeText(selected.serial).then(() => ctx.toast("已复制实例号"), () => ctx.toast("复制失败，请手动选择实例号")); }}><Copy size={14} /></IconButton></Fact><Fact k="用户">{selected.user}</Fact><Fact k="商品">{products.get(selected.productCode) ?? selected.productCode}</Fact><Fact k="托管机房标签">{selected.hostingLabel || "—"}</Fact><Fact k="来源">{SOURCES[selected.sourceChannel]}</Fact><Fact k="购入时间">{formatBusinessTimeCompact(selected.purchasedAt, "—")}</Fact><Fact k="激活时间">{formatBusinessTimeCompact(selected.activatedAt, "—")}</Fact><Fact k="停用时间">{formatBusinessTimeCompact(selected.deactivatedAt, "—")}</Fact></Facts></Panel>
        <Panel title="用户名额" plain explain="停用中仍占名额。"><E5Slots device={selected} /></Panel>
        <Fold inset title="技术信息" summary="设备原码、任务与时间"><Facts><Fact k="设备ID">{selected.deviceId}</Fact><Fact k="原生命周期状态">{selected.rawStatus}</Fact><Fact k="SIM原码">{selected.simState}</Fact><Fact k="SIM原错误">{selected.simLastError || "—"}</Fact><Fact k="暂停原因">{selected.pausedReason || "—"}</Fact><Fact k="原任务号">{selected.currentTask?.taskNo ?? "—"}</Fact><Fact k="开始原时间">{selected.currentTask?.startedAt ?? "—"}</Fact><Fact k="应完成原时间">{selected.currentTask?.dueAt ?? "—"}</Fact></Facts></Fold>
      </Drawer>}
      {group && <Modal title={`选择${group === "waiting" ? "等待启动" : "其他"}状态`} onClose={() => setGroup(null)} footer={<Button onClick={() => setGroup(null)}>取消</Button>}><div className="e5-group-choices">{(group === "waiting" ? WAITING : OTHER).map(key => <Button key={key} onClick={() => { change({ simState: key }); setGroup(null); }}><StatusTag tone={E5_STATES[key].tone} icon={E5_STATES[key].icon}>{E5_STATES[key].label}</StatusTag><ArrowUpRight size={14} aria-hidden /></Button>)}</div></Modal>}
    </E5CommandScope>}
  </RdPage>;
}
