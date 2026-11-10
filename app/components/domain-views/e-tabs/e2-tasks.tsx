"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ClipboardList, Plus, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { BatchBar, BlockState, Button, Cell, Check, CheckGroup, Checkbox, Conclusion, Explain, Fact, Facts, Field,
  FilterBar, FilterField, Fold, LevelStrip, Modal, Notice, NumberInput, PageHeader, Pager, Panel, RatioBar,
  ReleaseBody, ScaleBar, Stat, StatBand, StatusTag, Table, TableLoading, TableMessage, TaskClassTag, Td, Textarea, Th, Tr, useTabIds } from "@/app/components/rd";
import { nextTabValue } from "@/app/components/kit/tab-group-keyboard";
import { visibleReasonLength } from "@/lib/admin/a2-client";
import { businessClock, businessStamp, businessZoneText } from "@/lib/admin/business-time";
import { displayAdminError } from "@/lib/admin/error-messages";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { TASK_CLASSES, TASK_CLASS_LABELS } from "@/lib/admin/task-classes";
import { fetchDisableImpact, fetchPoolTasks, fetchTaskPools, sendTaskPoolCommand, TaskPoolApiError,
  type DisableImpact, type PoolTask, type TaskClass, type TaskPool } from "@/lib/admin/task-pool-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { Select } from "@/app/components/rd";
import type { EViewCtx } from "./types";
import { FIXED_DEVICE_LEVELS } from "./task-type-policy";
import { e2CommandLabel, e2Commands, type E2Pending } from "./e2-pending";

type Query = { code: string; taskClass: string; enabled: string; page: number; size: number; reset: boolean };
type Read<T> = { state: "loading" | "ready" | "error"; data: T; error: string };
type PoolDialog = { kind: "random" | "status"; key: string; pool: TaskPool; enabled: boolean; tasks: PoolTask[]; original?: E2Pending };
const LEVELS = FIXED_DEVICE_LEVELS.map(level => ({ key: level.code, label: level.code, name: level.name }));
const PRODUCT_STATES = { PUBLISHED: "已发布", DRAFT: "草稿", DELISTED_WITH_DEVICES: "已下架有设备" } as const;
const MINUTES = [{ value: 0, text: "0" }, { value: 60, text: "60" }, { value: 120, text: "120" }];
const TASK_RULES = "等级只决定跑什么任务，收益由商品的月收益目标决定。当前任务保持原配置，修改只影响之后的新任务。每级最多 200 个启用任务、300 个任务（含停用）。";
const GENERATION = "服务端生成同池唯一的英文名称，时长为 5 分钟整数倍：向量计算 30–60 分钟，语音处理 45–90 分钟，图像生成和大模型推理 60–120 分钟，模型微调和视频生成 90–120 分钟。新任务立即启用。";
const RETRY_HELP = "重新发送保存的原请求和原命令号，后端按命令号与内容去重。这不是只读查询，不会另发一批。";

function readQuery(params: URLSearchParams): Query {
  const code = params.get("pool") ?? "", taskClass = params.get("taskClass") ?? "", enabled = params.get("enabled") ?? "";
  const page = params.get("pageNum"), size = params.get("pageSize");
  const validCode = !code || FIXED_DEVICE_LEVELS.some(level => level.code === code);
  const validClass = !taskClass || TASK_CLASSES.includes(taskClass as TaskClass);
  const validEnabled = !enabled || ["true", "false"].includes(enabled);
  const validPage = page === null || /^\d+$/.test(page) && Number.isSafeInteger(Number(page)) && Number(page) > 0;
  const validSize = size === null || ["10", "20", "50"].includes(size);
  return { code: validCode ? code : "", taskClass: validClass ? taskClass : "", enabled: validEnabled ? enabled : "",
    page: validPage && page ? Number(page) : 1, size: validSize && size ? Number(size) : 20,
    reset: !validCode || !validClass || !validEnabled || !validPage || !validSize };
}

export function E2Tasks({ ctx }: { ctx: EViewCtx }) {
  const params = useSearchParams();
  const session = useAdminAuth(state => state.session);
  const actorId = session ? String(session.adminId) : "";
  const [query, setQuery] = useState(() => readQuery(new URLSearchParams(params.toString())));
  const [pools, setPools] = useState<Read<TaskPool[]>>({ state: "loading", data: [], error: "" });
  const [tasks, setTasks] = useState<Read<{ records: PoolTask[]; total: number }>>({ state: "loading", data: { records: [], total: 0 }, error: "" });
  const [selected, setSelected] = useState<string[]>([]);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [denied, setDenied] = useState(false);
  const [pending, setPending] = useState<E2Pending[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<PoolDialog | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [count, setCount] = useState("10");
  const [classes, setClasses] = useState<TaskClass[]>([]);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState({ count: false, reason: false });
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [dialogErrorCode, setDialogErrorCode] = useState("");
  const [pendingNote, setPendingNote] = useState("");
  const [receipt, setReceipt] = useState("");
  const [impact, setImpact] = useState<DisableImpact | null>(null);
  const [impactAt, setImpactAt] = useState<number | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState("");
  const sequence = useRef(0), impactSequence = useRef(0), lastQuery = useRef("");
  const busy = useRef(false);
  const tabIds = useTabIds();
  const pool = pools.data.find(row => row.code === query.code);
  const rows = tasks.data.records;
  const syncPending = useCallback(() => setPending(e2Commands.list().filter(record => record.actorId === actorId)), [actorId]);

  const refresh = useCallback(async () => {
    if (!ctx.canReadE2) return false;
    const serial = ++sequence.current;
    const key = JSON.stringify(query);
    const changed = key !== lastQuery.current;
    lastQuery.current = key;
    setSelected([]);
    setPools(old => ({ ...old, state: "loading", error: "" }));
    setTasks(old => ({ state: "loading", data: changed ? { records: [], total: 0 } : old.data, error: "" }));
    const [poolResult, taskResult] = await Promise.allSettled([
      fetchTaskPools(), query.code ? fetchPoolTasks(query.code, { taskClass: query.taskClass, enabled: query.enabled, pageNum: query.page, pageSize: query.size }) : Promise.resolve(null),
    ]);
    if (sequence.current !== serial) return false;
    const permissionFailure = [poolResult, taskResult].some(result => result.status === "rejected"
      && (isPermissionDenied(result.reason) || result.reason instanceof TaskPoolApiError && [401, 403].includes(result.reason.status ?? result.reason.httpStatus ?? 0)));
    if (permissionFailure) {
      setDenied(true); setPools({ state: "error", data: [], error: "这个账号没有这项读取权限" });
      setTasks({ state: "error", data: { records: [], total: 0 }, error: "这个账号没有这项读取权限" });
      announcePermissionDenied(); return false;
    }
    if (poolResult.status === "fulfilled") {
      setPools({ state: "ready", data: poolResult.value, error: "" });
      if (!query.code || !poolResult.value.some(level => level.code === query.code)) {
        setQuery(old => ({ ...old, code: poolResult.value[0].code, page: 1 })); return false;
      }
    } else setPools(old => ({ ...old, state: "error", error: displayAdminError(poolResult.reason) }));
    if (taskResult.status === "fulfilled" && taskResult.value) {
      const page = taskResult.value;
      const last = Math.max(1, Math.ceil(page.total / query.size));
      if (query.page > last) { setQuery(old => ({ ...old, page: last })); return false; }
      setTasks({ state: "ready", data: page, error: "" });
    } else if (taskResult.status === "rejected") setTasks({ state: "error", data: { records: [], total: 0 }, error: displayAdminError(taskResult.reason) });
    const ready = poolResult.status === "fulfilled" && taskResult.status === "fulfilled" && taskResult.value !== null;
    if (ready) setReadAt(Date.now());
    return ready;
  }, [ctx.canReadE2, query]);
  useEffect(() => { void refresh(); return () => { sequence.current++; }; }, [refresh]);
  useEffect(() => { syncPending(); setDenied(false); }, [actorId, ctx.canReadE2, syncPending]);
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const key of ["pool", "taskClass", "enabled", "pageNum", "pageSize"]) url.searchParams.delete(key);
    if (query.code) url.searchParams.set("pool", query.code);
    if (query.taskClass) url.searchParams.set("taskClass", query.taskClass);
    if (query.enabled) url.searchParams.set("enabled", query.enabled);
    if (query.page !== 1) url.searchParams.set("pageNum", String(query.page));
    if (query.size !== 20) url.searchParams.set("pageSize", String(query.size));
    window.history.replaceState(window.history.state, "", url);
  }, [query]);
  useEffect(() => {
    const pop = () => setQuery(readQuery(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  const readingTasks = tasks.state === "loading" || lastQuery.current !== JSON.stringify(query);
  const fresh = pools.state === "ready" && !readingTasks && tasks.state === "ready" && !!pool;
  const locked = pending.some(record => record.pool.code === query.code);
  const writeBlock = !ctx.canWriteE2 ? "只读，你只能查看任务池" : locked ? "这个等级有待确认操作，请先查看原操作"
    : !fresh ? "请先重新读取任务等级和任务列表" : undefined;
  const selectedRows = rows.filter(row => selected.includes(row.taskTypeId));
  const toDisable = selectedRows.filter(row => row.enabled).length, toEnable = selectedRows.length - toDisable;
  const emptyLevels = pools.data.filter(level => level.enabledCount === 0);
  const referenced = new Map<string, TaskPool[]>();
  for (const level of pools.data) for (const product of level.referencedBy) if (product.state !== "DRAFT") {
    referenced.set(product.productKey, [...(referenced.get(product.productKey) ?? []), level]);
  }
  const noCandidates = [...referenced.values()].filter(levels => levels.every(level => level.enabledCount === 0)).length;
  const emptyNames = emptyLevels.map(level => `${level.code} ${level.name}`).join("、");
  const onlineEmpty = emptyLevels.some(level => level.referencedBy.some(product => product.state !== "DRAFT"));
  const conclusion = pools.state !== "ready" ? pools.state === "loading" ? "正在读取任务等级…" : "任务等级暂时读不到，无法判断哪些等级需要补任务"
    : !emptyLevels.length ? "四个等级都有启用的任务"
      : noCandidates > 0 ? `${emptyNames}没有启用的任务，${noCandidates} 个商品的设备之后接不到新任务`
        : onlineEmpty ? `${emptyNames}没有启用的任务，使用它的商品仍有其他等级任务`
          : "部分等级还没有启用的任务，当前未见线上商品引用这些等级";

  async function readImpact(target: PoolDialog) {
    const serial = ++impactSequence.current;
    setImpactLoading(true); setImpactError("");
    try {
      const result = await fetchDisableImpact(target.pool.code, target.tasks.map(row => row.taskTypeId));
      if (serial === impactSequence.current) { setImpact(result); setImpactAt(Date.now()); }
    } catch (error) { if (serial === impactSequence.current) setImpactError(displayAdminError(error)); }
    finally { if (serial === impactSequence.current) setImpactLoading(false); }
  }
  function open(kind: PoolDialog["kind"], enabled = true) {
    if (!pool || writeBlock) return;
    const target: PoolDialog = { kind, enabled, pool, key: crypto.randomUUID(), tasks: kind === "status" ? selectedRows.filter(row => row.enabled !== enabled) : [] };
    setCount("10"); setClasses([]); setReason(""); setTouched({ count: false, reason: false });
    setDialogError(""); setDialogErrorCode(""); setImpact(null); setImpactAt(null); setImpactError(""); setReleasing(false); setDialog(target);
    if (kind === "status" && !enabled) void readImpact(target);
  }
  function viewOriginal(record: E2Pending) {
    setDialog({ kind: record.request.kind, enabled: record.request.kind === "status" ? record.request.body.enabled : true,
      pool: record.pool, key: record.commandKey, tasks: record.tasks, original: record });
    setImpact(record.impact); setImpactAt(record.impactAt); setImpactError(""); setDialogError(""); setDialogErrorCode(""); setReleasing(false);
  }
  function close() { if (!busy.current) { impactSequence.current++; setDialog(null); setReleasing(false); } }
  function retryBlock(record: E2Pending) {
    return !ctx.canWriteE2 ? "当前账号没有任务池修改权限" : actorId !== record.actorId ? "仅原操作者可以重试"
      : isRetryExpired(record) ? RETRY_EXPIRED_TEXT
        : !e2Commands.isDurablyStored(record.fingerprint, record.commandKey) ? "原操作没有完整持久保存，不能重试" : undefined;
  }
  const countReady = /^\d+$/.test(count) && Number(count) >= 1 && Number(count) <= 50;
  const reasonLength = visibleReasonLength(reason);
  const reasonReady = reasonLength >= 8 && reasonLength <= 200 && reason.trim().length <= 200;
  const formBlock = writeBlock ?? (!reasonReady ? "请填写 8–200 字的操作理由" : dialog?.kind === "random" && !countReady ? "任务数量要填 1–50 的整数"
    : dialog?.kind === "status" && !dialog.tasks.length ? "没有可执行的任务" : dialog?.kind === "status" && !dialog.enabled && (!impact || impactLoading || impactError) ? "请先成功读取停用影响" : undefined);

  async function send(record: E2Pending, retry: boolean) {
    if (busy.current || retryBlock(record)) return;
    busy.current = true; setSaving(true); setDialogError(""); setPendingNote("");
    try {
      const result = await sendTaskPoolCommand(record.request);
      e2Commands.forget(record.fingerprint, record.commandKey); syncPending();
      const message = "created" in result ? `已添加 ${result.created.length} 个任务`
        : result.updated === 0 ? `所选任务已是${record.request.kind === "status" && record.request.body.enabled ? "启用" : "停用"}状态，本次未新增状态变更`
          : `已${record.request.kind === "status" && record.request.body.enabled ? "启用" : "停用"} ${result.updated} 个任务`;
      setDialog(null); setSelected([]); setReceipt(message); ctx.toast(message);
      if (!await refresh()) setReceipt(`${message}。操作已生效，最新任务列表暂时读不到。`);
      document.getElementById("e2-task-heading")?.focus();
    } catch (error) {
      const explicit = isExplicitRejection(error) && !(error instanceof TaskPoolApiError && error.reasonCode === "TASK_POOL_IDEMPOTENCY_CONFLICT");
      if (!retry && explicit) {
        e2Commands.forget(record.fingerprint, record.commandKey); syncPending();
        setDialog(old => old ? { ...old, key: crypto.randomUUID() } : old);
        setDialogError(displayAdminError(error));
      } else {
        syncPending(); viewOriginal(record);
        setDialogError(`${explicit ? "原样重试被拒，请先核实原操作结果。" : "操作结果未确认，原内容已保留。"}${displayAdminError(error)}`);
        if (retry && explicit) setRejected(old => [...old.filter(key => key !== record.commandKey), record.commandKey]);
        else setRejected(old => old.filter(key => key !== record.commandKey));
      }
      setDialogErrorCode(error instanceof TaskPoolApiError ? error.reasonCode : "");
      if (isPermissionDenied(error) || error instanceof TaskPoolApiError && [401, 403].includes(error.status ?? error.httpStatus ?? 0)) { announcePermissionDenied(); setDialog(null); }
    } finally { busy.current = false; setSaving(false); }
  }
  async function submit() {
    if (!dialog || formBlock || busy.current || !session) return;
    const fingerprint = `pool|${dialog.pool.code}`;
    const request: E2Pending["request"] = dialog.kind === "random"
      ? { kind: "random", method: "POST", path: `/task-pools/${dialog.pool.code}/random-tasks`,
        body: { count: Number(count), ...(classes.length ? { taskClasses: TASK_CLASSES.filter(item => classes.includes(item)) } : {}), reason: reason.trim(), idempotencyKey: dialog.key } }
      : { kind: "status", method: "POST", path: `/task-pools/${dialog.pool.code}/tasks/status`,
        body: { taskTypeIds: dialog.tasks.map(row => row.taskTypeId), enabled: dialog.enabled, reason: reason.trim(), idempotencyKey: dialog.key } };
    e2Commands.remember(fingerprint, dialog.key, { actorId, actorName: session.operator, pool: dialog.pool, request, tasks: dialog.tasks,
      impact: dialog.kind === "status" && !dialog.enabled ? impact : null, impactAt: dialog.kind === "status" && !dialog.enabled ? impactAt : null });
    if (!e2Commands.isDurablyStored(fingerprint, dialog.key)) {
      e2Commands.forget(fingerprint, dialog.key); setDialogError("浏览器存不下这次操作，没有提交。"); return;
    }
    const record = e2Commands.list().find(item => item.commandKey === dialog.key)!;
    syncPending(); await send(record, false);
  }

  if (!ctx.canReadE2 || denied) return <><BlockState state="denied" title="无权限访问" detail="这个账号没有任务池读取权限，请从侧栏返回有权查看的页面。" /><Button onClick={() => window.history.back()}>返回</Button></>;
  return <>
    <PageHeader pageId="E2" title={<>任务池<Explain label="任务池的说明" content="补充商城任务，查看等级和停用影响。" /></>}
      meta={readAt ? `${businessClock(readAt)} 读取 · ${businessZoneText()}` : "正在读取…"}
      readOnly={!ctx.canWriteE2 ? "只读，你只能查看任务池" : undefined}
      actions={<Button icon={<RefreshCw size={16} />} loading={pools.state === "loading" || tasks.state === "loading"} onClick={() => void refresh()}>刷新</Button>} />
    <Conclusion state={pools.state !== "ready" ? "unknown" : noCandidates > 0 ? "warn" : emptyLevels.length ? "neutral" : "ok"}
      explain="按同一次读取的四个等级联合判断：商品所有已发布等级都没有启用任务，才计入没有候选的商品。草稿不计入，不代表当前单已停止。"
      action={pools.state === "ready" && emptyLevels.length > 0 ? <Button size="sm" onClick={() => setQuery(old => ({ ...old, code: emptyLevels[0].code, page: 1 }))}>查看{emptyLevels[0].code} {emptyLevels[0].name}</Button> : undefined}>{conclusion}</Conclusion>
    {query.reset && <Notice tone="warn" action={<Button size="sm" onClick={() => setQuery(old => ({ ...old, reset: false }))}>知道了</Button>}>网址里无效的查询条件已重置。</Notice>}
    {receipt && <Notice tone={receipt.includes("读不到") ? "warn" : "ok"} action={<Button size="sm" onClick={() => void refresh()}>刷新</Button>}>{receipt}</Notice>}
    {pending.map(record => <Notice key={record.commandKey} tone="warn" title={`${record.pool.code} ${record.pool.name} · ${e2CommandLabel(record)}，结果未确认`}
      actionBelow action={<><Button size="sm" disabled={saving} onClick={() => { setQuery(old => ({ ...old, code: record.pool.code, page: 1 })); if (query.code === record.pool.code && query.page === 1) void refresh(); setPendingNote("正在读回原等级的当前事实；当前数量或状态不能证明原操作结果，待确认继续保留。"); }}>读回核对</Button>
        <Button size="sm" disabledReason={saving ? "正在提交" : retryBlock(record)} onClick={() => { viewOriginal(record); void send(record, true); }}>按原操作重试</Button>
        <Button size="sm" disabled={saving} onClick={() => viewOriginal(record)}>查看原操作</Button>
        {rejected.includes(record.commandKey) && !isRetryExpired(record) && <Button size="sm" disabled={saving} onClick={() => { viewOriginal(record); setReleasing(true); }}>解除待确认</Button>}
        <Explain label="原样重试的说明" content={RETRY_HELP} /></>}>
      <p>首次提交 {businessStamp(record.createdAt)} · {businessZoneText()}</p>
      <p>{isRetryExpired(record) ? RETRY_EXPIRED_TEXT : "原对象、内容、理由和命令号已保留。这个等级暂停新操作。"}</p>
      {pendingNote && <p>{pendingNote}</p>}
    </Notice>)}
    {pools.state === "error" && <BlockState state="error" title="任务等级读取失败" detail={pools.error} onRetry={() => void refresh()} />}
    {pools.data.length > 0 && pools.state !== "ready" && <Notice tone="warn">以下为上次读取的数据，读取完成前不能操作。</Notice>}
    <StatBand cards role="tablist" label="任务等级">
      {(pools.data.length ? pools.data.map(data => ({ code: data.code, name: data.name, data })) : FIXED_DEVICE_LEVELS.map(card => ({ ...card, data: undefined }))).map(({ data: level, ...card }, index) => {
        const loaded = !!level;
        const current = card.code === query.code;
        const ready = loaded && pools.state === "ready";
        return <Stat key={card.code} head={<>{card.code} {card.name}<LevelStrip quiet variant="mini" label="等级位置" levels={LEVELS} selectedKeys={[card.code]} /></>}
          label="启用任务" value={loaded ? String(level.enabledCount) : pools.state === "loading" ? <span className="rd-skeleton">　　</span> : "—"} unit={loaded ? "个" : undefined}
          sub={loaded ? `共 ${level.taskCount} 个` : undefined} tone="role-2" selected={current} selectedText="当前等级"
          surface={ready && level.enabledCount === 0 ? "warn" : undefined}
          onOpen={loaded ? () => { setSelected([]); setQuery(old => ({ ...old, code: card.code, page: 1 })); } : undefined}
          openLabel={`${card.code} ${card.name}，启用 ${loaded ? level.enabledCount : "未知"} 个，共 ${loaded ? level.taskCount : "未知"} 个${current ? "，当前等级" : ""}`}
          role="tab" id={tabIds.tab(card.code)} aria-selected={current} aria-controls="e2-current-tasks" tabIndex={current || !query.code && index === 0 ? 0 : -1}
          onKeyDown={event => { const next = nextTabValue(pools.data.map(item => item.code), query.code, event.key); if (next === null) return; event.preventDefault(); setQuery(old => ({ ...old, code: next, page: 1 })); document.getElementById(tabIds.tab(next))?.focus(); }}>
          {loaded ? <>
            {level.enabledCount === 0 ? <StatusTag tone="warn" icon={TriangleAlert}>{level.taskCount === 0 ? "还没有任务" : "没有启用的任务"}</StatusTag>
              : level.enabledCount === level.taskCount ? <StatusTag tone="neutral">全部启用</StatusTag>
                : <RatioBar quiet label="启用占比" value={level.enabledCount} total={level.taskCount} valueText={`启用 ${level.enabledCount} 个，共 ${level.taskCount} 个`} tone="role-2" />}
            <dl className="rd-stat-rows"><div className="rd-stat-row"><dt>平均时长<Explain label={`${card.code}平均时长的口径`} content={level.enabledCount === 0 ? "没有启用任务，无法计算。" : "本级启用任务时长的平均值；0–120 分钟是四级共同标尺。"} /></dt><dd data-empty={level.avgDurationMinutes === null ? "" : undefined}>{level.avgDurationMinutes === null ? "—" : `${level.avgDurationMinutes} 分钟`}</dd></div>
              {level.avgDurationMinutes !== null && <ScaleBar quiet label="平均时长" max={120} value={Number(level.avgDurationMinutes)} ticks={MINUTES} valueText={`平均 ${level.avgDurationMinutes} 分钟，刻度 0 到 120 分钟`} tone="role-2" />}
              <div className="rd-stat-row"><dt>约每天单数<Explain label={`${card.code}约每天单数的口径`} content="连续运行时的理论节奏，来自本级启用任务的均值；不承诺某商品的实际单量或收益。没有启用任务，无法计算。" /></dt><dd data-empty={level.estTasksPerDevicePerDay === null ? "" : undefined}>{level.estTasksPerDevicePerDay === null ? "—" : `约 ${level.estTasksPerDevicePerDay} 单/台/天`}</dd></div></dl>
            <dl className="rd-stat-rows"><div className="rd-stat-row" data-stack=""><dt>使用它的商品<Explain label={`查看使用${card.code}的商品`} content={ready ? <div className="rd-stack">{level.referencedBy.length ? Object.entries(PRODUCT_STATES).map(([state, label]) => <div key={state}><strong>{label}</strong>{level.referencedBy.filter(item => item.state === state).map(item => <p key={item.productKey}>{item.productName}</p>)}{!level.referencedBy.some(item => item.state === state) && <p>无</p>}</div>) : "还没有商品使用"}</div> : "商品引用暂不可用，请刷新任务等级。"} /></dt>
              <dd>{level.referencedBy.length ? <>已发布 {level.referencedBy.filter(item => item.state === "PUBLISHED").length} · 草稿 {level.referencedBy.filter(item => item.state === "DRAFT").length} · 已下架有设备 {level.referencedBy.filter(item => item.state === "DELISTED_WITH_DEVICES").length}</> : "还没有商品使用"}</dd></div></dl>
          </> : <ScaleBar state={pools.state === "loading" ? "loading" : "failed"} label="任务节奏" max={120} valueText="任务节奏暂不可用" failedText="任务节奏暂不可用" />}
        </Stat>;
      })}
    </StatBand>
    <section id="e2-current-tasks" role="tabpanel" aria-labelledby={query.code ? tabIds.tab(query.code) : undefined}>
      <Panel title={<span id="e2-task-heading" tabIndex={-1}>{pool ? `${pool.code} ${pool.name}任务` : "当前等级任务"}</span>} icon={ClipboardList} flush
        explain={TASK_RULES} actions={ctx.canWriteE2 ? <Button variant="primary" icon={<Plus size={16} />} disabledReason={writeBlock} onClick={() => open("random")}>随机添加任务</Button> : undefined}>
        <FilterBar onClear={() => setQuery(old => ({ ...old, taskClass: "", enabled: "", page: 1 }))} canClear={!!(query.taskClass || query.enabled)}>
          <FilterField><Select aria-label="任务类型筛选" value={query.taskClass} onChange={taskClass => { setSelected([]); setQuery(old => ({ ...old, taskClass, page: 1 })); }} options={[{ value: "", label: "全部类型" }, ...TASK_CLASSES.map(value => ({ value, label: TASK_CLASS_LABELS[value] }))]} /></FilterField>
          <FilterField><Select aria-label="任务启用状态筛选" value={query.enabled} onChange={enabled => { setSelected([]); setQuery(old => ({ ...old, enabled, page: 1 })); }} options={[{ value: "", label: "全部状态" }, { value: "true", label: "已启用" }, { value: "false", label: "已停用" }]} /></FilterField>
        </FilterBar>
        {selected.length > 0 && ctx.canWriteE2 && <BatchBar summary={`已选 ${selected.length} 项 · 可停用 ${toDisable} 个 · 可启用 ${toEnable} 个`} hint="只提交当前页已勾选且与目标状态不同的任务；不跨页选择。">
          <Button variant="danger-outline" aria-label="批量停用" disabledReason={writeBlock ?? (!toDisable ? "所选任务均已停用" : undefined)} onClick={() => open("status", false)}>停用</Button>
          <Button aria-label="批量启用" disabledReason={writeBlock ?? (!toEnable ? "所选任务均已启用" : undefined)} onClick={() => open("status", true)}>启用</Button>
        </BatchBar>}
        <Table label="当前等级任务"><thead><tr>
          <Th control><Checkbox aria-label="选择本页全部任务" disabled={!!writeBlock || !rows.length} checked={rows.length > 0 && selected.length === rows.length} indeterminate={selected.length > 0 && selected.length < rows.length}
            onChange={event => setSelected(event.target.checked ? rows.map(row => row.taskTypeId) : [])} /></Th>
          <Th>任务名称</Th><Th>类型</Th><Th align="right">时长</Th><Th>状态<Explain label="任务启用状态的说明" content="已启用的任务可参加新派单；已停用的任务不再参加新派单，当前单照常完成。" /></Th>
        </tr></thead><tbody>{readingTasks ? <TableLoading columns={5} /> : tasks.state === "error" ? <TableMessage columns={5} role="alert"><BlockState state="error" title="任务读取失败" detail={tasks.error} onRetry={() => void refresh()} /></TableMessage>
          : rows.length ? rows.map(row => <Tr key={row.taskTypeId} selected={selected.includes(row.taskTypeId)}><Td><Checkbox aria-label={`选择 ${row.name}`} title={writeBlock} disabled={!!writeBlock} checked={selected.includes(row.taskTypeId)} onChange={event => setSelected(event.target.checked ? [...selected, row.taskTypeId] : selected.filter(id => id !== row.taskTypeId))} /></Td>
            <Td grow><Cell main={row.name} title={row.name} /></Td><Td><TaskClassTag taskClass={row.taskClass} /></Td>
            <Td align="right"><Cell num main={`${row.durationMinutes} 分钟`} sub={<ScaleBar quiet compact label="任务时长" max={120} value={row.durationMinutes} valueText={`${row.durationMinutes} 分钟，刻度 0 到 120 分钟`} tone="role-2" />} /></Td>
            <Td><StatusTag tone={query.enabled ? "neutral" : row.enabled ? "ok" : "done"}>{row.enabled ? "已启用" : "已停用"}</StatusTag></Td></Tr>)
            : <TableMessage columns={5}>{query.taskClass || query.enabled ? <><p>当前筛选没有任务</p><Button size="sm" onClick={() => setQuery(old => ({ ...old, taskClass: "", enabled: "", page: 1 }))}>清除筛选</Button></>
              : <><p>{ctx.canWriteE2 ? "暂无任务，可随机添加" : "暂无任务，请联系有任务池修改权的管理员"}</p>{ctx.canWriteE2 && <Button size="sm" disabledReason={writeBlock} onClick={() => open("random")}>随机添加任务</Button>}</>}</TableMessage>}</tbody></Table>
        {tasks.data.total > 0 && tasks.state !== "error" && <Pager label="任务" total={tasks.data.total} page={query.page} pageSize={query.size} sizes={[10, 20, 50]} loading={readingTasks}
          onPage={page => { setSelected([]); setQuery(old => ({ ...old, page })); }} onPageSize={size => { setSelected([]); setQuery(old => ({ ...old, size, page: 1 })); }} />}
      </Panel>
    </section>
    {dialog && <Modal title={releasing ? "解除待确认" : dialog.kind === "random" ? "随机添加任务" : dialog.enabled ? "批量启用任务" : "批量停用任务"}
      icon={releasing ? ShieldCheck : dialog.kind === "random" ? Plus : ClipboardList} tone={!releasing && dialog.kind === "status" && !dialog.enabled ? "danger" : "neutral"}
      sub={releasing ? undefined : <StatusTag tone="progress" filled>立即生效</StatusTag>} busy={saving} dirty={!!dialog.original || !!reason || count !== "10" || classes.length > 0} onClose={close}
      footer={releasing && dialog.original ? <><Button onClick={() => setReleasing(false)}>返回</Button><Button variant="primary" onClick={() => { e2Commands.forget(dialog.original!.fingerprint, dialog.original!.commandKey); syncPending(); close(); void refresh(); }}>确认解除</Button></>
        : <><Button disabled={saving} onClick={close}>{dialog.original ? "收起" : "取消"}</Button>
          <Button variant={dialog.kind === "status" && !dialog.enabled ? "danger" : "primary"} loading={saving} loadingText="提交中…" disabledReason={dialog.original ? retryBlock(dialog.original) : formBlock}
            onClick={() => { if (dialog.original) void send(dialog.original, true); else { setTouched({ count: true, reason: true }); void submit(); } }}>{dialog.original ? "按原操作重试" : dialog.kind === "random" ? "确认添加并生效" : dialog.enabled ? "确认启用" : "确认停用"}</Button></>}>
      {releasing && dialog.original ? <div className="rd-stack"><ReleaseBody label={`${dialog.pool.code} ${dialog.pool.name} · ${e2CommandLabel(dialog.original)}`} explain="重试被拒说明不了原操作的结果，先核实。解除只移除本地待确认记录，不办理后端核查结案。" /><Facts><Fact k="首次提交">{businessStamp(dialog.original.createdAt)}</Fact><Fact k="原理由">{dialog.original.request.body.reason}</Fact></Facts></div>
        : <div className="rd-stack">
          <Facts><Fact k="任务等级">{dialog.pool.code} {dialog.pool.name}</Fact>
            {dialog.original && <Fact k="首次提交">{businessStamp(dialog.original.createdAt)} · {dialog.original.actorName}</Fact>}
            {dialog.kind === "status" && <Fact k={dialog.enabled ? "本次启用" : "本次停用"}>{dialog.tasks.length} 个任务</Fact>}
            {dialog.kind === "random" && dialog.original && <><Fact k="任务数量">{dialog.original.request.kind === "random" ? dialog.original.request.body.count : "—"} 个</Fact><Fact k="限定类型">{dialog.original.request.kind === "random" && dialog.original.request.body.taskClasses ? dialog.original.request.body.taskClasses.map(value => TASK_CLASS_LABELS[value]).join("、") : "不限类型"}</Fact></>}
          </Facts>
          {dialog.original && <Notice tone="warn"><p>结果未确认，原操作已冻结，只能按原操作重试。</p><p>{retryBlock(dialog.original) ?? RETRY_HELP}</p></Notice>}
          {dialog.kind === "status" && <div className="rd-impact"><h3 className="rd-impact-title">本次任务</h3><ul className="rd-recipients">{dialog.tasks.map(task => <li key={task.taskTypeId}>{task.name}</li>)}</ul></div>}
          {dialog.kind === "status" && !dialog.enabled && <>{impactLoading ? <BlockState state="loading" title="正在计算停用影响…" />
            : impactError ? <BlockState state="error" title="停用影响读取失败" detail={impactError} onRetry={() => void readImpact(dialog)} retryLabel="重新计算影响" />
              : impact && <>{dialog.original && <p className="rd-aux">首次读取的影响 · {impactAt ? businessStamp(impactAt) : "—"}</p>}
                {impact.productsLosingAllTasks.length > 0 ? <Notice tone="warn" title="以下商品将没有可用任务"><ul className="rd-recipients">{impact.productsLosingAllTasks.map(item => <li key={item.productKey}>{item.productName}</li>)}</ul>
                  <Facts><Fact lead tone="warn" k="影响设备" unit="台">{impact.devicesAffected}</Fact></Facts><p>当前单照常完成，之后等待配置；停跑期间不计收益、不补发。</p>
                  <Explain label="影响设备的口径" content="按商品全部已发布等级判断候选。设备数只计已激活且当前没有运行单的生产设备，不等于设备管理列表总数。影响是读取时的快照，提交时人数可能变化。" /></Notice>
                  : <Notice tone="neutral">没有商品会失去全部可用任务。</Notice>}</>}</>}
          {!dialog.original && dialog.kind === "random" && <><Field label="任务数量" required help="1–50 个，整数" explain={<>生成后立即加入当前等级，仅影响之后新派的任务。{GENERATION}</>} error={touched.count && !countReady ? "任务数量要填 1–50 的整数" : undefined}>
            <NumberInput unit="个" min={1} max={50} step={1} value={count} disabled={saving} onChange={event => setCount(event.target.value)} onBlur={() => setTouched(old => ({ ...old, count: true }))} /></Field>
            <CheckGroup legend="限定类型" summary={classes.length ? `已选 ${classes.length} 类` : "不限类型"} explain="限制本次随机生成的类型；可多选，不选则不限。不保证每类均匀分到或至少分到一个，不改变已有任务。">
              {TASK_CLASSES.map(value => <Check key={value} label={<TaskClassTag taskClass={value} />} aria-label={TASK_CLASS_LABELS[value]} disabled={saving} checked={classes.includes(value)} onChange={event => setClasses(event.target.checked ? TASK_CLASSES.filter(item => classes.includes(item) || item === value) : classes.filter(item => item !== value))} />)}</CheckGroup></>}
          <Notice tone="neutral">{dialog.kind === "random" ? "生成后立即加入当前等级，仅影响之后新派的任务。" : "只影响之后新派的任务，当前单照常完成。"}</Notice>
          {dialog.original ? <Facts><Fact k="原操作理由">{dialog.original.request.body.reason}</Fact></Facts>
            : <Field label="操作理由" required hint="至少 8 字" explain="记录这次调整的依据，随命令写入操作记录。" error={touched.reason && !reasonReady ? "请填写 8–200 字的操作理由" : undefined}>
              <Textarea rows={3} maxLength={200} count={`${reasonLength}/200`} placeholder="例如：按本周运营计划补充候选任务" value={reason} disabled={saving} onChange={event => setReason(event.target.value)} onBlur={() => setTouched(old => ({ ...old, reason: true }))} /></Field>}
          {dialogError && <Notice tone={dialog.original ? "warn" : "danger"}>{dialogError}</Notice>}
          {dialog.original && rejected.includes(dialog.original.commandKey) && !isRetryExpired(dialog.original) && <Button disabled={saving} onClick={() => setReleasing(true)}>解除待确认</Button>}
          <Fold title="执行摘要" summary="立即生效，不经审批"><p>{TASK_RULES}</p></Fold>
          <Fold title="技术信息" summary="任务池与命令号"><Facts><Fact k="任务池">{dialog.pool.code}</Fact><Fact k="命令号">{dialog.key}<Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText(dialog.key).then(() => ctx.toast("命令号已复制"), () => setDialogError("复制失败，请选择完整命令号复制。")); }}>复制命令号</Button></Fact>{dialogErrorCode && <Fact k="原错误码">{dialogErrorCode}</Fact>}</Facts><p>{GENERATION}</p></Fold>
        </div>}
    </Modal>}
  </>;
}
