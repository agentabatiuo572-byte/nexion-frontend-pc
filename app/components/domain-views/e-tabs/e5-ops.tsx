import { useState } from "react";
import { Badge, DataListPager } from "../design-kit";
import { fetchE5Devices, type E5Device, type E5DeviceState } from "@/lib/admin/e5-client";
import type { EViewCtx } from "./types";
import { EStats } from "./stats";

const DEV_STATE_LABEL: Record<E5DeviceState, string> = {
  active: "已激活在线",
  busy: "任务中",
  offline: "已激活离线",
  inventory: "库存待激活",
  unbound: "已解绑/停用",
  abnormal: "异常",
};
const DEV_STATE_TONE: Record<E5DeviceState, string> = {
  active: "ok",
  busy: "cyan",
  offline: "neutral",
  inventory: "warn",
  unbound: "neutral",
  abnormal: "danger",
};
const ECG_PATH = "M0,30 L80,30 L100,30 L110,12 L120,48 L130,18 L140,30 L220,30 L240,30 L250,10 L260,52 L270,18 L280,30 L360,30 L380,30 L390,12 L400,48 L410,18 L420,30 L500,30 L520,30 L530,10 L540,52 L550,18 L560,30 L640,30 L660,30 L670,12 L680,48 L690,18 L700,30 L800,30";

const RackIcon = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="2" y="4" width="20" height="6" rx="1" /><rect x="2" y="14" width="20" height="6" rx="1" /><line x1="6" y1="7" x2="6.01" y2="7" /><line x1="6" y1="17" x2="6.01" y2="17" /></svg>;
const PauseIcon = () => <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 5v14M15 5v14" /></svg>;
function DcSpark({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * 100).toFixed(1)},${(30 - ((v - min) / range) * 26).toFixed(1)}`);
  const line = pts.join(" ");
  return (
    <svg viewBox="0 0 100 36" preserveAspectRatio="none">
      <polyline points={`${line} 100,36 0,36`} fill={color} opacity="0.12" stroke="none" />
      <polyline className="line" points={line} fill="none" stroke={color} />
    </svg>
  );
}

function fmtCount(value: number | null | undefined, fallback = "—") {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : fallback;
}

function isActivatable(state: E5DeviceState) {
  return state === "inventory" || state === "unbound";
}

function isDeactivatable(state: E5DeviceState) {
  return state === "active" || state === "busy" || state === "offline" || state === "abnormal";
}

function dcStatusLabel(status: string) {
  if (status === "maintenance") return "维护中";
  if (status === "disabled") return "已禁用";
  return "启用";
}

function heartbeatLagMinutes(value: string) {
  if (!value || value === "—") return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.round((Date.now() - time) / 60_000));
}

function percentile95(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

export function E5Ops({ ctx }: { ctx: EViewCtx }) {
  const devices = ctx.e5Devices;
  const [actionReason, setActionReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [selectedDc, setSelectedDc] = useState<string | null>(null);
  const [healthDevices, setHealthDevices] = useState<E5Device[]>([]);
  const [healthTotal, setHealthTotal] = useState(0);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState("");
  const overview = ctx.e5Overview;
  const maxDevicesPerUser = overview?.maxDevicesPerUser ?? null;
  const maxDevicesLabel = maxDevicesPerUser ? String(maxDevicesPerUser) : "—";
  const slotLabel = (device: E5Device) => {
    if (device.slotNo == null) return "—";
    return maxDevicesPerUser ? `${device.slotNo}/${maxDevicesPerUser}` : String(device.slotNo);
  };
  const totalDevices = overview?.totalDevices ?? devices.length;
  const onlineDevices = overview?.onlineDevices ?? devices.filter((d) => d.state === "active" || d.state === "busy").length;
  const abnormalDevices = overview?.abnormalDevices ?? devices.filter((d) => d.state === "abnormal" || d.state === "offline").length;
  const recycledDevices = overview?.recycledDevices ?? devices.filter((d) => d.state === "unbound").length;
  const dcStats = new Map((overview?.datacenters ?? []).map((dc) => [dc.dcLocation, dc]));
  const dcRows = ctx.e5Datacenters.length ? ctx.e5Datacenters : overview?.datacenters ?? [];
  const filteredDevices = devices;
  const devAct = (d: E5Device, op: "device-activate" | "device-deactivate", action: NonNullable<import("./types").McSpec["deviceAction"]>, name: string, detail: string, amplify = false) =>
    ctx.openActionConfirm({ name: `${name} · ${d.serial}`, op, deviceAction: action, deviceId: d.deviceId, deviceNo: d.serial, amplify, detail });
  const reasonReady = actionReason.trim().length >= 8 && actionReason.trim().length <= 200;
  const runDirect = async (work: () => Promise<void>) => {
    if (!reasonReady || actionBusy) return;
    setActionBusy(true);
    try { await work(); }
    catch (error) { ctx.toast(error instanceof Error ? error.message : "E5 操作失败"); }
    finally { setActionBusy(false); }
  };
  const batchUser = (d: E5Device) => {
    const paused = !!d.pausedReason;
    const userId = Number(d.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) return;
    void runDirect(() => ctx.runE5UserBatch(userId, !paused, actionReason.trim()));
  };
  const openHealth = async (dcId: string) => {
    setSelectedDc(dcId);
    setHealthDevices([]);
    setHealthTotal(0);
    setHealthError("");
    setHealthLoading(true);
    try {
      const page = await fetchE5Devices({ dcLocation: dcId, pageNum: 1, pageSize: 200 });
      setHealthDevices(page.records);
      setHealthTotal(page.total);
    } catch (error) {
      setHealthError(error instanceof Error ? error.message : "数据中心健康详情读取失败");
    } finally {
      setHealthLoading(false);
    }
  };

  const toggle = (dcId: string) => {
    const paused = ctx.isDcPaused(dcId);
    ctx.openActionConfirm({
      name: paused ? `恢复派单 · ${dcId}` : `批量暂停 · ${dcId}`,
      op: "ops-pause", dc: dcId, fixedVal: paused ? "false" : "true", amplify: false,
      detail: paused
        ? `恢复 ${dcId} 派单 · 重新接入调度,无需重启设备`
        : `暂停 ${dcId} 全节点派单 · 仅运维窗口,不影响已售设备结算(用户按 baseRate 继续计提)· 处置限单 DC`,
    });
  };

  return (
    <>
      <EStats items={[
        { k: "在线设备(全网)", v: fmtCount(onlineDevices), sub: "全网设备概览", tone: "ok" },
        { k: "离线 / 异常", v: fmtCount(abnormalDevices), sub: "运行状态汇总", tone: "warn" },
        { k: "单户设备上限", v: maxDevicesLabel, sub: "服务端固定上限(V2=6)" },
        { k: "回收 / 停用", v: fmtCount(recycledDevices), sub: "可恢复设备", tone: "cyan" },
      ]} />

      {/* Global heartbeat banner */}
      <section className="heartbeat">
        <div>
          <div className="hb-num">{fmtCount(totalDevices)}</div>
          <div className="hb-lbl"><b>实时</b> 在网设备 · 最近状态同步</div>
        </div>
        <div className="ecg-wrap">
          <svg viewBox="0 0 800 60" preserveAspectRatio="none">
            <line className="ecg-base" x1="0" y1="30" x2="800" y2="30" />
            <path className="ecg-line ecg-pulse" d={ECG_PATH} />
          </svg>
        </div>
        <div className="hb-ctrl">
          <div className="row"><span>过去 1h 心跳失联</span><span className="v">{fmtCount(abnormalDevices)}</span></div>
          <div className="row"><span>过去 24h 自动重连</span><span className="v">—</span></div>
          <div className="row"><span>持续异常 &gt; 1h</span><span className="v warn">{fmtCount(overview?.offlineDevices)}</span></div>
          <div className="row"><span>调度延迟 P95</span><span className="v">—</span></div>
        </div>
      </section>

      {/* #22 设备库存 & 激活 */}
      <section className="feed-card" data-proof="e5-inventory" style={{ marginBottom: 16 }}>
        <div className="feed-h">
          <span className="ttl">设备库存 & 激活</span>
          <span className="sub">激活 / 取消激活 / 强制激活 / 解绑 · 校验订单关系 + 用户槽位 + 单户上限({maxDevicesLabel})</span>
        </div>
        <div className="row" style={{ gap: 8, padding: "8px 10px", flexWrap: "wrap" }} data-proof="e5-device-filters">
          <input className="fld" style={{ maxWidth: 280 }} value={ctx.e5Keyword} onChange={(event) => ctx.setE5Keyword(event.target.value)} placeholder="搜索用户 / 设备 / SKU" aria-label="搜索用户设备" />
          <select className="fld" style={{ maxWidth: 160 }} value={ctx.e5StateFilter} onChange={(event) => ctx.setE5StateFilter(event.target.value)} aria-label="设备状态筛选">
            <option value="all">全部状态</option><option value="active">在线</option><option value="busy">任务中</option><option value="offline">离线</option><option value="inventory">库存</option><option value="unbound">已解绑</option><option value="abnormal">异常</option>
          </select>
          <select className="fld" style={{ maxWidth: 160 }} value={ctx.e5KindFilter} onChange={(event) => ctx.setE5KindFilter(event.target.value)} aria-label="设备类型筛选">
            <option value="all">全部类型</option><option value="MOBILE">手机</option><option value="S1">S1</option><option value="PRO">Pro</option><option value="RACK">Rack</option>
          </select>
          <select className="fld" style={{ maxWidth: 180 }} value={ctx.e5HeartbeatFilter} onChange={(event) => ctx.setE5HeartbeatFilter(event.target.value)} aria-label="心跳筛选">
            <option value="all">全部心跳</option><option value="fresh">10 分钟内</option><option value="stale">失联 / 未采集</option>
          </select>
          <span className="muted tiny">当前页命中 {filteredDevices.length} 台</span>
          {ctx.canWriteE5 && <input className="fld" style={{ minWidth: 300 }} maxLength={200} value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="直接操作理由(8–200 字)" aria-label="E5 直接操作理由" />}
          {ctx.canWriteE5 && <span className="muted tiny">{actionReason.trim().length}/200{reasonReady ? " · 可执行" : " · 需 8–200 字"}</span>}
        </div>
        <div style={{ overflowX: "auto", padding: "4px 4px 0" }}>
          <table style={{ width: "100%", minWidth: 1480, borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink-4)", fontSize: 11.5 }}>
                <th style={{ padding: "8px 10px" }}>设备编号</th><th style={{ padding: "8px 10px" }}>设备名称</th><th style={{ padding: "8px 10px" }}>用户</th>
                <th style={{ padding: "8px 10px" }}>SKU / 产品</th><th style={{ padding: "8px 10px" }}>DC</th><th style={{ padding: "8px 10px" }}>用户槽位</th>
                <th style={{ padding: "8px 10px" }}>购入 / 激活</th><th style={{ padding: "8px 10px" }}>基础收益 / 效率</th>
                <th style={{ padding: "8px 10px" }}>心跳与任务</th><th style={{ padding: "8px 10px" }}>状态</th><th style={{ padding: "8px 10px", textAlign: "right" }}>动作</th>
              </tr>
            </thead>
            <tbody>
              {ctx.e5Loading && (
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td colSpan={11} style={{ padding: "18px 10px", color: "var(--ink-3)" }}>正在加载第 {ctx.e5Page} 页设备库存...</td>
                </tr>
              )}
              {!ctx.e5Loading && ctx.e5Error && (
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td colSpan={11} style={{ padding: "18px 10px", color: "var(--danger)" }}>设备库存读取异常:{ctx.e5Error}</td>
                </tr>
              )}
              {!ctx.e5Loading && !ctx.e5Error && filteredDevices.length === 0 && (
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td colSpan={11} style={{ padding: "18px 10px", color: "var(--ink-3)" }}>当前筛选无设备数据</td>
                </tr>
              )}
              {!ctx.e5Loading && !ctx.e5Error && filteredDevices.map((d) => {
                const skuMain = d.productCode || d.sku;
                const skuSub = d.productTier && d.productTier !== skuMain ? d.productTier : "";
                return (
                  <tr key={`${d.deviceId}-${d.serial}`} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "9px 10px", fontFamily: "var(--mono)", color: "var(--ink)", fontWeight: 600 }}>{d.serial}</td>
                    <td style={{ padding: "9px 10px" }}>
                      <div style={{ color: "var(--ink)", fontWeight: 600 }}>{d.deviceName}</div>
                      <div className="mono" style={{ marginTop: 2, color: "var(--ink-4)", fontSize: 11.5 }}>{d.rawStatus}</div>
                    </td>
                    <td style={{ padding: "9px 10px" }}>
                      <div style={{ color: "var(--ink)", fontWeight: 600 }}>{d.nickname}</div>
                      <div className="mono" style={{ marginTop: 2, color: "var(--ink-4)", fontSize: 11.5 }}>{d.userNo || (d.userId ? `uid:${d.userId}` : "—")}</div>
                    </td>
                    <td style={{ padding: "9px 10px" }}>
                      <div className="mono" style={{ color: "var(--ink)" }}>{skuMain}</div>
                      {skuSub ? <div style={{ marginTop: 2, color: "var(--ink-4)", fontSize: 11.5 }}>{skuSub}</div> : null}
                    </td>
                    <td style={{ padding: "9px 10px", fontFamily: "var(--mono)", color: "var(--ink-3)" }}>{d.dc}</td>
                    <td style={{ padding: "9px 10px", fontFamily: "var(--mono)" }}>{slotLabel(d)}</td>
                    <td style={{ padding: "9px 10px" }}><div className="mono">购 {d.purchasedAt}</div><div className="mono" style={{ marginTop: 2 }}>激 {d.activatedAt}</div></td>
                    <td style={{ padding: "9px 10px" }}><div>{d.baseRate}</div><div style={{ marginTop: 2 }}>{(d.currentEfficiency * 100).toFixed(1)}%</div></td>
                    <td style={{ padding: "9px 10px" }}>
                      <div className="mono">{d.heartbeatAt}</div>
                      <div className="muted tiny" style={{ marginTop: 2 }}>电量 {d.batteryLevel == null ? "未采集" : `${d.batteryLevel}%`} · {d.isCharging == null ? "充电未采集" : d.isCharging ? "充电中" : "未充电"} · {d.isWifiConnected == null ? "网络未采集" : d.isWifiConnected ? "网络可达" : "网络断开"}</div>
                      <div className="muted tiny" style={{ marginTop: 2 }}>温控 {d.thermalState} · 任务 {d.activeTaskNo}{d.pausedReason ? ` · 暂停:${d.pausedReason}` : ""}</div>
                    </td>
                    <td style={{ padding: "9px 10px" }}><Badge tone={DEV_STATE_TONE[d.state]}>{DEV_STATE_LABEL[d.state]}</Badge></td>
                    <td style={{ padding: "9px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                      {isActivatable(d.state) && (ctx.canWriteE5 || ctx.canForceActivateE5) && (
                        <>
                          {ctx.canWriteE5 && d.state === "inventory" && <><button className="l-btn sm mc" disabled={!reasonReady || actionBusy || d.activeDevicesForUser >= 6} title={d.activeDevicesForUser >= 6 ? "该用户已占满 6 个激活槽位" : undefined} onClick={() => void runDirect(() => ctx.runE5DeviceAction(d.deviceId, "activate", actionReason.trim()))}>激活</button>{" "}</>}
                          {ctx.canForceActivateE5 && <button className="l-btn sm mc" disabled={d.activeDevicesForUser >= 6} title={d.activeDevicesForUser >= 6 ? "强制激活也不能绕过 6 台上限" : undefined} onClick={() => devAct(d, "device-activate", "force-activate", "强制激活设备", `设备 ${d.deviceId} / 用户 ${d.userNo} / 类型 ${d.productTier || d.deviceName} / 购入 ${d.purchasedAt} / 已激活 ${d.activeDevicesForUser}/${maxDevicesLabel} · 强制激活不绕过固定上限 · 非资金动作`, false)}>强制激活</button>}
                          {d.activeDevicesForUser >= 6 && <div className="tiny" style={{ color: "var(--danger)", marginTop: 4 }}>槽位已满 {d.activeDevicesForUser}/6</div>}
                        </>
                      )}
                      {isDeactivatable(d.state) && (ctx.canWriteE5 || ctx.canUnbindE5) && (
                        <>
                          {ctx.canWriteE5 && <button className="l-btn sm mc" disabled={!reasonReady || actionBusy} onClick={() => void runDirect(() => ctx.runE5DeviceAction(d.deviceId, "deactivate", actionReason.trim()))}>取消激活</button>}{" "}
                          {ctx.canUnbindE5 && <button className="l-btn sm dgr" onClick={() => devAct(d, "device-deactivate", "unbind", "解绑设备", `解绑 ${d.serial} · 解除资产关系但不退款、不改写购入时间 · 理由 8–200 字`, false)}>解绑</button>}{" "}
                          {ctx.canWriteE5 && <button className="l-btn sm" disabled={!reasonReady || actionBusy} onClick={() => batchUser(d)}>{d.pausedReason ? "恢复该用户" : "暂停该用户"}</button>}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="设备库存"
          page={ctx.e5Page}
          pageSize={ctx.e5PageSize}
          total={ctx.e5Total}
          onPageChange={ctx.setE5Page}
          onPageSizeChange={ctx.setE5PageSize}
          pageSizeOptions={[10, 20, 50, 100]}
        />
      </section>

      {/* 3 DC 控制面板 */}
      <div className="dc-toolbar">
        <div>
          <div className="ttl">数据中心</div>
          <div className="sub">区域、状态与派单控制</div>
        </div>
        {ctx.canWriteE5 && <button className="l-btn sm mc" onClick={() => ctx.openDatacenter()}>+ 新增数据中心</button>}
      </div>
      <div className="dc-grid">
        {!ctx.e5Loading && !ctx.e5Error && dcRows.length === 0 && (
          <section className="feed-card dc-empty">暂无数据中心配置</section>
        )}
        {dcRows.map((dc) => {
          const realDc = dcStats.get(dc.dcLocation) ?? dc;
          const paused = ctx.isDcPaused(dc.dcLocation);
          const abnormal = realDc?.abnormalDevices ?? 0;
          const disabled = dc.status === "disabled";
          const cls = paused || disabled ? "paused" : abnormal > 0 ? "warn" : realDc ? "online" : "idle";
          const stateLbl = disabled ? "已禁用" : paused ? "已暂停" : abnormal > 0 ? "波动中" : realDc ? "在线" : "未返回";
          const sparkColor = paused ? "var(--ink-4)" : abnormal > 0 ? "var(--warning)" : "var(--success)";
          const online = realDc?.onlineDevices;
          const onlineValue = online ?? 0;
          const pct = realDc && totalDevices > 0 ? ((onlineValue / totalDevices) * 100).toFixed(1) : "—";
          const gpu = realDc ? `${Math.round(realDc.avgGpuUsage)}%` : "—";
          const spark = realDc.onlineSeries;
          return (
            <div className={`dc-card ${cls}`} key={dc.dcLocation}>
              <div className="dc-h">
                <span className="ic"><RackIcon /></span>
                <div className="t"><div className="nm">{dc.displayName}</div><div className="reg">ID {dc.dcLocation} · {dc.regionLabel} · {dc.location} · {dcStatusLabel(dc.status)}</div></div>
                <span className="state"><span className="d" />{stateLbl}</span>
              </div>
              <div className="dc-body">
                <div className="dc-num"><span className={`v${abnormal > 0 && !paused ? " warn" : ""}`}>{fmtCount(online)}</span></div>
                <div className="lbl">在线设备 · 占比 {pct}%</div>
                <div className="dc-spark">{spark.length >= 2 ? <DcSpark data={spark} color={sparkColor} /> : <span className="muted tiny">后端未返回趋势</span>}</div>
                <div className="dc-sub">
                  <div className="stat"><div className="k">任务吞吐</div><div className="v">—</div></div>
                  <div className="stat"><div className="k">P95 延迟</div><div className={`v ${abnormal > 0 ? "warn" : "ok"}`}>—</div></div>
                  <div className="stat"><div className="k">CPU 平均</div><div className="v">—</div></div>
                  <div className="stat"><div className="k">GPU 平均</div><div className={`v${parseInt(gpu, 10) > 80 ? " warn" : ""}`}>{gpu}</div></div>
                </div>
              </div>
              <div className="dc-foot">
                <button onClick={() => void openHealth(dc.dcLocation)}>健康详情</button>
                {ctx.canWriteE5 && <button onClick={() => ctx.openDatacenter(dc)}>编辑</button>}
                {ctx.canWriteE5 && <button className="dgr" onClick={() => ctx.deleteDatacenter(dc)}>删除</button>}
                {(paused ? ctx.canWriteE5 : ctx.canPauseDcE5) && (paused
                  ? <button className="resume" onClick={() => toggle(dc.dcLocation)}>恢复派单</button>
                  : <button className="pause" onClick={() => toggle(dc.dcLocation)}><PauseIcon /> 批量 pause</button>)}
              </div>
            </div>
          );
        })}
      </div>

      {selectedDc && (() => {
        const dc = dcRows.find((item) => item.dcLocation === selectedDc);
        const live = dcStats.get(selectedDc) ?? dc;
        if (!dc || !live) return null;
        const heartbeatLags = healthDevices.map((device) => heartbeatLagMinutes(device.heartbeatAt)).filter((value): value is number => value != null);
        const heartbeatP95 = percentile95(heartbeatLags);
        const freshHeartbeats = heartbeatLags.filter((value) => value <= 10).length;
        const activeTasks = healthDevices.filter((device) => device.activeTaskNo && device.activeTaskNo !== "—").length;
        return <section className="feed-card" role="dialog" aria-label={`${selectedDc} 健康详情`} data-proof="e5-dc-health-detail" style={{ marginTop: 14 }}>
          <div className="feed-h"><span className="ttl">{selectedDc} · 健康详情</span><button className="l-btn sm" onClick={() => setSelectedDc(null)}>关闭</button></div>
          <div className="row" style={{ gap: 18, padding: 14, flexWrap: "wrap" }}>
            <span>绑定设备 <b>{fmtCount(live.totalDevices)}</b></span><span>在线 <b>{fmtCount(live.onlineDevices)}</b></span><span>异常 <b>{fmtCount(live.abnormalDevices)}</b></span>
            <span>GPU 平均 <b>{Math.round(live.avgGpuUsage)}%</b></span><span>GPU 温度 <b>{Math.round(live.avgGpuTempC)}℃</b></span><span>GPU 功耗 <b>{Math.round(live.avgGpuPowerW)}W</b></span>
            <span>派单 <b>{live.dispatchPaused ? `已暂停:${live.pausedReason || "未填写"}` : "正常"}</b></span><span>当前任务设备 <b>{healthLoading ? "读取中" : fmtCount(activeTasks)}</b></span>
            <span>心跳延迟 P95 <b>{healthLoading ? "读取中" : heartbeatP95 == null ? "未采集" : `${heartbeatP95} 分钟`}</b></span><span>CPU 平均 <b>未采集</b></span>
          </div>
          <div style={{ margin: "0 14px 14px", padding: 12, border: "1px solid var(--border)", borderRadius: 10 }} data-proof="e5-dc-heartbeat-samples">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}><b>心跳新鲜度样本</b><span className="muted tiny">10 分钟内 {freshHeartbeats}/{heartbeatLags.length} · 取该 DC 当前最新心跳，不伪造历史时序</span></div>
            <div style={{ display: "flex", gap: 3, minHeight: 28, alignItems: "end" }}>
              {heartbeatLags.length === 0 ? <span className="muted tiny">暂无可用心跳样本</span> : heartbeatLags.slice(0, 80).map((lag, index) => <span key={`${lag}-${index}`} title={`延迟 ${lag} 分钟`} style={{ width: 6, height: `${Math.max(4, Math.min(28, lag + 4))}px`, background: lag <= 10 ? "var(--success)" : "var(--warning)", borderRadius: 2 }} />)}
            </div>
          </div>
          <div style={{ overflowX: "auto", margin: "0 14px 14px" }} data-proof="e5-dc-bound-devices">
            <table style={{ width: "100%", minWidth: 860, borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ textAlign: "left", color: "var(--ink-4)" }}><th style={{ padding: 7 }}>设备</th><th style={{ padding: 7 }}>用户</th><th style={{ padding: 7 }}>状态</th><th style={{ padding: 7 }}>当前任务</th><th style={{ padding: 7 }}>最新心跳</th><th style={{ padding: 7 }}>暂停原因</th></tr></thead>
              <tbody>
                {healthLoading && <tr><td colSpan={6} style={{ padding: 10 }}>正在读取该数据中心绑定设备...</td></tr>}
                {!healthLoading && healthError && <tr><td colSpan={6} style={{ padding: 10, color: "var(--danger)" }}>{healthError}</td></tr>}
                {!healthLoading && !healthError && healthDevices.length === 0 && <tr><td colSpan={6} style={{ padding: 10 }}>该数据中心暂无绑定设备</td></tr>}
                {!healthLoading && !healthError && healthDevices.map((device) => <tr key={device.deviceId} style={{ borderTop: "1px solid var(--border)" }}><td style={{ padding: 7 }} className="mono">{device.serial}</td><td style={{ padding: 7 }}>{device.userNo || device.userId || "—"}</td><td style={{ padding: 7 }}>{DEV_STATE_LABEL[device.state]}</td><td style={{ padding: 7 }}>{device.activeTaskNo}</td><td style={{ padding: 7 }} className="mono">{device.heartbeatAt}</td><td style={{ padding: 7 }}>{device.pausedReason || "—"}</td></tr>)}
              </tbody>
            </table>
            {!healthLoading && healthTotal > healthDevices.length && <div className="muted tiny" style={{ marginTop: 8 }}>当前显示前 {healthDevices.length} / {healthTotal} 台；完整吞吐与历史心跳曲线需 fleet 遥测接口继续提供。</div>}
          </div>
          <div className="tint tiny" style={{ margin: "0 14px 14px" }}>任务吞吐、派单 P95、CPU 与历史心跳曲线尚无 fleet 遥测字段；当前任务数、心跳延迟 P95、GPU 与设备清单均来自实时服务端数据，未使用估算值。</div>
        </section>;
      })()}

      {/* 运维活动 feed */}
      <section className="feed-card">
        <div className="feed-h">
          <span className="ttl">运维活动 · 最近 24h</span>
          <span className="sub">等待后端运维事件接口返回真实事件</span>
        </div>
        <div className="feed">
          <div className="tint tiny">后端未返回运维活动数据</div>
        </div>
      </section>
      <p className="f-foot">批量 pause 是<b>仅限运维窗口</b>的处置 — 暂停 DC 全节点派单,但不影响已售设备结算(用户依然按 baseRate 计提收益)。处置范围限单 DC,跨 DC 联动须分次操作。<b>心跳失联 &gt; 24h</b> 的设备自动进入永久离线列表,资产回退由系统定时任务兜底。</p>
    </>
  );
}
