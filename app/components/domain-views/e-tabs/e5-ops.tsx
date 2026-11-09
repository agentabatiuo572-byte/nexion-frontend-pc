import { useEffect, useState } from "react";
import { Btn, Badge, DataListPager, Drawer } from "../design-kit";
import { displayAdminError } from "@/lib/admin/error-messages";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { fetchE5Observability, type E5Device, type E5SimState, type E5Observability } from "@/lib/admin/e5-client";
import { TASK_CLASS_LABELS } from "@/lib/admin/task-classes";
import type { EViewCtx } from "./types";
import { EStats } from "./stats";
import { OpsHint } from "./ops-hint";
import { LegacyUnknownResolutionAction } from "./legacy-unknown-resolution-action";

const SIM_STATES: Record<E5SimState, [string, string]> = {
  WAITING_ACTIVATION: ["待激活", "warn"], WAITING_INIT: ["等待初始化", "neutral"], LEGACY_PENDING: ["旧任务未结清", "warn"],
  RUNNING: ["运行中", "ok"], WAITING_CONFIG: ["等待配置", "warn"], PAUSED: ["已暂停", "neutral"],
  CLOSING: ["停用中", "warn"], STOPPED: ["已停用", "neutral"], UNBOUND: ["已解绑", "neutral"], ERROR: ["出错重试中", "danger"], SIM_OFF: ["模拟任务已关闭", "neutral"],
};
const SOURCES: Record<string, string> = { ORDER: "购买", TRADE_IN: "置换", TRIAL: "试用转正", PROMOTION_GIFT: "赠送" };
const PHONE_STATES: Record<E5Device["state"], string> = { active: "在线", busy: "任务中", offline: "离线", inventory: "待激活", "pending-deactivate": "停用中", unbound: "已解绑 / 停用", abnormal: "异常", unknown: "状态未知" };

/** Shared actions retain E5 authorities when the list is mounted in E6. */
function DeviceActions({ device: d, ctx, phones }: { device: E5Device; ctx: EViewCtx; phones: boolean }) {
  const [action, setAction] = useState<"activate" | "deactivate" | "pause" | "resume" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const readOnly = !phones && d.simState === "SIM_OFF";
  const activatable = phones ? d.state === "inventory" || d.state === "unbound" : d.simState === "WAITING_ACTIVATION" || d.simState === "STOPPED" || d.simState === "UNBOUND";
  const deactivatable = phones ? ["active", "busy", "offline", "abnormal", "unknown"].includes(d.state) : ["WAITING_INIT", "LEGACY_PENDING", "RUNNING", "WAITING_CONFIG", "PAUSED", "ERROR"].includes(d.simState ?? "");
  const full = d.activeDevicesForUser >= d.maxDevicesPerUser;
  const title = action === "activate" ? "激活设备" : action === "deactivate" ? "取消激活" : action === "pause" ? "暂停该用户" : "恢复该用户";
  const open = (next: typeof action) => { setReason(""); setError(""); setAction(next); };
  return <>
    {!readOnly && <details className="device-menu"><summary aria-label={`操作 ${d.serial}`}>⋯</summary><div onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}>
      {activatable && ctx.canWriteE5 && (phones ? d.state === "inventory" : d.simState === "WAITING_ACTIVATION") && <button type="button" onClick={() => open("activate")}>激活</button>}
      {activatable && ctx.canForceActivateE5 && <button type="button" disabled={full} title={full ? `已达 ${d.maxDevicesPerUser} 台上限` : undefined} onClick={() => ctx.openActionConfirm({ briefKind: "record", op: "device-activate", deviceId: d.deviceId, deviceNo: d.serial, deviceAction: "force-activate", name: `强制激活 · ${d.serial}`, detail: `用户 ${d.user}，当前激活 ${d.activeDevicesForUser}/${d.maxDevicesPerUser} 台（含手机）。强制激活也不能绕过每人 6 台上限。` })}>强制激活</button>}
      {deactivatable && ctx.canWriteE5 && <button type="button" onClick={() => open("deactivate")}>取消激活</button>}
      {deactivatable && ctx.canUnbindE5 && <button type="button" onClick={() => ctx.openActionConfirm({ briefKind: "record", op: "device-deactivate", deviceId: d.deviceId, deviceNo: d.serial, deviceAction: "unbind", name: `解绑设备 · ${d.serial}`, detail: `设备将不再属于 ${d.user}，不退款，购入时间不变。` })}>解绑</button>}
      {deactivatable && ctx.canWriteE5 && <button type="button" onClick={() => open(d.pausedReason ? "resume" : "pause")}>{d.pausedReason ? "恢复该用户" : "暂停该用户"}</button>}
      {!ctx.canWriteE5 && !ctx.canForceActivateE5 && !ctx.canUnbindE5 && <span className="muted">只读</span>}
      <LegacyUnknownResolutionAction device={d} canWrite={ctx.canWriteE5} toast={ctx.toast} />
    </div></details>}
    {readOnly && <span className="muted">只读</span>}
    {action && <Drawer title={title} sub={d.serial} onClose={() => { if (!busy) setAction(null); }} footer={<><Btn disabled={busy} onClick={() => setAction(null)}>取消</Btn><Btn variant={action === "deactivate" || action === "pause" ? "danger" : "primary"} disabled={busy || reason.trim().length < 8 || reason.trim().length > 200 || action === "activate" && full} onClick={async () => {
      setBusy(true); setError("");
      try {
        if (action === "activate" || action === "deactivate") await ctx.runE5DeviceAction(d.deviceId, action, reason.trim());
        else await ctx.runE5UserBatch(Number(d.userId), action === "pause", reason.trim());
        setAction(null);
      } catch (cause) { setError(displayAdminError(cause)); }
      finally { setBusy(false); }
    }}>{busy ? "提交中…" : "确认执行"}</Btn></>}>
      <div className="tp-dialog"><div className="tp-key-info">{d.deviceName}<div style={{ fontSize: 14, fontWeight: 400, marginTop: 8 }}>{d.user}</div></div>
        {action === "activate" && <div className={`tint ${full ? "warn" : "cyan"}`}><strong>当前激活 {d.activeDevicesForUser}/{d.maxDevicesPerUser} 台</strong><p>每人最多 6 台，包含手机。{full ? "已达上限，请先停用其他设备。" : "激活后占用一个设备名额。"}</p></div>}
        {action === "deactivate" && <div className="tint warn">有运行中任务时，本单完成并结算后自动停用；停用期间不再接新任务。</div>}
        {(action === "pause" || action === "resume") && <div className="tint warn">{action === "pause" ? "将暂停该用户的全部设备（含手机）。停跑期间不计收益、不补发。" : "将恢复该用户的设备派单；停跑期间收益不补发。"}</div>}
        <label className="col">操作理由<textarea className="fld" rows={3} maxLength={200} value={reason} onChange={event => setReason(event.target.value)} placeholder="8–200 字" /><span className="muted">{reason.trim().length}/200</span></label>
        {error && <div className="tint danger" role="alert">{error}</div>}
      </div>
    </Drawer>}
  </>;
}

export function E5Ops({ ctx, phones = false }: { ctx: EViewCtx; phones?: boolean }) {
  const [activity, setActivity] = useState<E5Observability | null>(null);
  const [activityError, setActivityError] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);
  useEffect(() => {
    if (!activityOpen || phones) return;
    let live = true;
    void fetchE5Observability().then(value => { if (live) { setActivity(value); setActivityError(""); } }).catch(cause => { if (live) setActivityError(displayAdminError(cause)); });
    return () => { live = false; };
  }, [activityOpen, phones, ctx.e5Devices]);
  const overview = ctx.e5Overview;
  const productOptions = new Map(ctx.skus.map(sku => [sku.id, sku.name]));
  for (const d of ctx.e5Devices) if (!productOptions.has(d.productCode)) productOptions.set(d.productCode, d.productCode);
  return <>
    {!phones && <><EStats items={[
      { k: "设备总数", v: overview?.total ?? "—" }, { k: "运行中", v: overview?.running ?? "—", tone: "ok" },
      { k: <span className="row" style={{ gap: 6 }}>等待启动<OpsHint label="等待启动统计范围">包含待激活、等待初始化和旧任务未结清的设备。</OpsHint></span>, v: overview?.waitingActivation ?? "—", tone: "warn" }, { k: "已停用", v: overview?.stopped ?? "—" },
    ]} />{ctx.e5OverviewError && <div className="tint warn" role="alert">{ctx.e5OverviewError}</div>}</>}
    <section className="pane" data-proof={phones ? "e6-phone-devices" : "e5-devices"}>
      {phones && <div className="pane-h"><span className="ttl">用户手机</span><OpsHint>操作权限与设备管理一致；每人 6 台上限包含手机。</OpsHint></div>}
      <div className="tp-toolbar">
        <input className="fld" style={{ flex: 1, minWidth: 220 }} value={ctx.e5Keyword} onChange={event => ctx.setE5Keyword(event.target.value)} placeholder={phones ? "搜索用户 / 手机" : "搜索用户 / 设备 / 商品"} aria-label={phones ? "搜索用户手机" : "搜索用户设备"} />
        {!phones && <><select className="fld" aria-label="设备状态筛选" value={ctx.e5StateFilter} onChange={event => ctx.setE5StateFilter(event.target.value)}><option value="all">全部状态</option>{Object.entries(SIM_STATES).map(([key, value]) => <option key={key} value={key}>{value[0]}</option>)}</select>
          <select className="fld" aria-label="设备来源筛选" value={ctx.e5SourceFilter} onChange={event => ctx.setE5SourceFilter(event.target.value)}><option value="all">全部来源</option>{Object.entries(SOURCES).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
          <select className="fld" aria-label="商品筛选" value={ctx.e5ProductFilter} onChange={event => ctx.setE5ProductFilter(event.target.value)}><option value="all">全部商品</option>{Array.from(productOptions).filter(([key]) => key).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></>}
        <Btn sm disabled={ctx.e5Loading} onClick={() => void ctx.refreshE5()}>刷新</Btn>
      </div>
      {ctx.e5DeviceError && <div className="tint danger" role="alert">{ctx.e5DeviceError}</div>}
      <div className="tp-table-wrap" style={{ minHeight: ctx.e5Devices.length ? 300 : undefined }}><table className="tp-table"><thead><tr><th>设备</th><th>用户</th><th>{phones ? "手机状态" : "商品 · 托管机房"}</th>{!phones && <th>来源</th>}<th>状态</th><th>{phones ? "每日收益" : "本月收益"}</th><th>当前任务</th><th>操作</th></tr></thead>
        <tbody>{ctx.e5Loading ? <tr><td colSpan={8} className="empty">正在加载…</td></tr> : ctx.e5DeviceError ? <tr><td colSpan={8} className="empty">设备读取失败，请刷新重试</td></tr> : !ctx.e5Devices.length ? <tr><td colSpan={8} className="empty">暂无符合条件的{phones ? "手机" : "设备"}</td></tr> : ctx.e5Devices.map(d => {
          const state = d.simState ? SIM_STATES[d.simState] : [d.pausedReason ? "已暂停" : PHONE_STATES[d.state], "neutral"];
          const target = d.monthlyTarget; const task = d.currentTask;
          return <tr key={d.deviceId}><td><strong>{d.deviceName}</strong><small>{d.serial}</small></td><td><strong>{d.nickname}</strong><small>{d.userNo}</small></td>
            <td>{phones ? <div className="row"><span>{d.batteryLevel == null ? "—" : `${d.batteryLevel}%`}</span><OpsHint>心跳：{d.heartbeatAt}<br />{d.isCharging ? "充电中" : "未充电"} · {d.isWifiConnected ? "网络可达" : "网络断开"}<br />温控：{d.thermalState}</OpsHint></div> : <><strong>{productOptions.get(d.productCode) || d.productCode || "—"}</strong><small>{d.hostingLabel || "—"}</small></>}</td>
            {!phones && <td>{SOURCES[d.sourceChannel] ?? "—"}</td>}
            <td><div className="row" style={{ gap: 6 }}><Badge tone={state[1]}>{state[0]}</Badge>{d.simState === "ERROR" && <OpsHint>错误：{d.simLastError || "未提供错误原因"}<br />下次自动重试：{d.simNextActionAt ? formatBusinessTimeCompact(d.simNextActionAt) : "等待调度"}<br />系统每 30 秒自动重试。</OpsHint>}{d.simState === "CLOSING" && <OpsHint>当前单完成并结算后停用。</OpsHint>}{d.simState === "WAITING_INIT" && <OpsHint>系统会自动开始，无需操作。</OpsHint>}{d.simState === "LEGACY_PENDING" && <OpsHint>设备还有旧版任务没结算完，结清前不会开始新任务；改任务池配置不能解决。</OpsHint>}{d.simState === "WAITING_CONFIG" && <OpsHint>商品的任务等级没有可用任务，请添加或启用任务。停跑期间不计收益、不补发。</OpsHint>}</div></td>
            <td>{phones ? `${d.dailyUsdt ?? "—"} USDT` : target ? <div className="row" style={{ gap: 6 }}><div><strong style={{ color: "var(--success)" }}>${target.creditedUsdt.toFixed(2)}</strong><small>/ {target.rangeLowUsdt == null || target.rangeHighUsdt == null ? "—" : `$${target.rangeLowUsdt.toFixed(2)}–${target.rangeHighUsdt.toFixed(2)}`}（预估）</small></div><OpsHint>第 {target.cycleIndex} 个设备月：{formatBusinessTimeCompact(target.cycleStartAt)} 至 {formatBusinessTimeCompact(target.cycleEndAt)}（不含结束时刻）。<br />当前产能 {target.capacityPct}%；已到账为本周期已完成目标任务 USDT。{!target.targetActive && "目标已关闭。"}{target.configChangedInCycle && "本周期配置曾变化，历史到账不重算。"}区间按当前配置满运行预估。</OpsHint></div> : "—"}</td>
            <td>{task ? <><strong>{TASK_CLASS_LABELS[task.taskClass as keyof typeof TASK_CLASS_LABELS] ?? task.taskClass}</strong><small>{Math.max(0, Math.ceil((Date.parse(task.dueAt) - Date.parse(task.startedAt)) / 60000))} 分钟 <OpsHint>{task.name}<br />任务号：{task.taskNo}<br />开始：{formatBusinessTimeCompact(task.startedAt)}<br />预计完成：{formatBusinessTimeCompact(task.dueAt)}</OpsHint></small></> : phones && d.activeTaskNo !== "—" ? d.activeTaskNo : "—"}</td>
            <td><DeviceActions device={d} ctx={ctx} phones={phones} /></td></tr>;
        })}</tbody></table></div>
      <DataListPager label={phones ? "用户手机" : "设备"} total={ctx.e5Total} page={ctx.e5Page} pageSize={ctx.e5PageSize} onPageChange={ctx.setE5Page} onPageSizeChange={ctx.setE5PageSize} pageSizeOptions={[10, 20, 50]} />
    </section>
    {!phones && <details className="pane device-activity" onToggle={event => setActivityOpen(event.currentTarget.open)}><summary>最近 24 小时操作</summary><div style={{ padding: "0 22px 18px" }}>{activityError ? <div className="tint warn" role="alert">{activityError}</div> : !activity ? "正在加载…" : !activity.activity.length ? "暂无设备操作" : activity.activity.map((entry, index) => <div className="pkv" key={`${entry.aggregateId}:${index}`}><span>{({ E5_DEVICE_ACTIVATED: "激活设备", E5_DEVICE_DEACTIVATED: "取消激活", E5_DEVICE_UNBOUND: "解绑设备", E5_DEVICE_FORCE_ACTIVATED: "强制激活设备", E5_DEVICE_BATCH_PAUSED: "暂停用户设备", E5_DEVICE_BATCH_RESUMED: "恢复用户设备", "admin.device_activated": "激活设备", "admin.device_deactivation_requested": "取消激活", "admin.device_deactivated": "设备已停用", "admin.device_unbound": "解绑设备", "admin.device_paused": "暂停用户设备", "admin.device_resumed": "恢复用户设备" } as Record<string, string>)[entry.eventType] ?? "设备操作"} · {entry.aggregateId}</span><span className="muted">{formatBusinessTimeCompact(entry.occurredAt)}</span></div>)}</div></details>}
  </>;
}
