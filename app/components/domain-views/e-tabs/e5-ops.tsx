import { Badge, DataListPager } from "../design-kit";
import type { E5Device, E5DeviceState, E5Overview } from "@/lib/admin/e5-client";
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

export function E5Ops({ ctx }: { ctx: EViewCtx }) {
  const devices = ctx.e5Devices;
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
  const devAct = (d: E5Device, op: "device-activate" | "device-deactivate", name: string, detail: string, amplify = false) =>
    ctx.openActionConfirm({ name: `${name} · ${d.serial}`, op, deviceId: d.deviceId, deviceNo: d.serial, amplify, detail });

  const toggle = (dcId: string) => {
    const paused = ctx.isDcPaused(dcId);
    ctx.openActionConfirm({
      name: paused ? `恢复派单 · ${dcId}` : `批量 pause · ${dcId}`,
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
        { k: "单户设备上限", v: maxDevicesLabel, sub: "后端配置" },
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
        <div style={{ overflowX: "auto", padding: "4px 4px 0" }}>
          <table style={{ width: "100%", minWidth: 1020, borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink-4)", fontSize: 11.5 }}>
                <th style={{ padding: "8px 10px" }}>设备编号</th><th style={{ padding: "8px 10px" }}>设备名称</th><th style={{ padding: "8px 10px" }}>用户</th>
                <th style={{ padding: "8px 10px" }}>SKU / 产品</th><th style={{ padding: "8px 10px" }}>DC</th><th style={{ padding: "8px 10px" }}>用户槽位</th>
                <th style={{ padding: "8px 10px" }}>状态</th><th style={{ padding: "8px 10px", textAlign: "right" }}>动作</th>
              </tr>
            </thead>
            <tbody>
              {ctx.e5Loading && (
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td colSpan={8} style={{ padding: "18px 10px", color: "var(--ink-3)" }}>正在加载第 {ctx.e5Page} 页设备库存...</td>
                </tr>
              )}
              {!ctx.e5Loading && ctx.e5Error && (
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td colSpan={8} style={{ padding: "18px 10px", color: "var(--danger)" }}>设备库存读取异常:{ctx.e5Error}</td>
                </tr>
              )}
              {!ctx.e5Loading && !ctx.e5Error && devices.length === 0 && (
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td colSpan={8} style={{ padding: "18px 10px", color: "var(--ink-3)" }}>暂无设备库存数据</td>
                </tr>
              )}
              {!ctx.e5Loading && !ctx.e5Error && devices.map((d) => {
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
                    <td style={{ padding: "9px 10px" }}><Badge tone={DEV_STATE_TONE[d.state]}>{DEV_STATE_LABEL[d.state]}</Badge></td>
                    <td style={{ padding: "9px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                      {isActivatable(d.state) && (
                        <>
                          <button className="l-btn sm mc" onClick={() => devAct(d, "device-activate", "激活设备", `激活 ${d.serial}(用户 ${d.user} 槽位 ${slotLabel(d)})· 校验设备状态 + 单户上限(${maxDevicesLabel})`)}>激活</button>{" "}
                          <button className="l-btn sm mc" onClick={() => devAct(d, "device-activate", "强制激活设备", `强制激活 ${d.serial} · 运维异常补救 · force 不绕过单户上限(${maxDevicesLabel}) · 理由必填`, true)}>强制激活</button>
                        </>
                      )}
                      {isDeactivatable(d.state) && (
                        <>
                          <button className="l-btn sm mc" onClick={() => devAct(d, "device-deactivate", "取消激活设备", `取消激活 ${d.serial} · 停止派单与计提`)}>取消激活</button>{" "}
                          <button className="l-btn sm dgr" onClick={() => devAct(d, "device-deactivate", "解绑设备", `解绑 ${d.serial} · 与用户 ${d.user} 槽位解除关联(异常设备处置)· 理由必填`, true)}>解绑</button>
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
        <button className="l-btn sm mc" onClick={() => ctx.openDatacenter()}>+ 新增数据中心</button>
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
                <div className="t"><div className="nm">{dc.dcLocation}</div><div className="reg">{dc.regionLabel} · {dcStatusLabel(dc.status)}</div></div>
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
                <button onClick={() => ctx.toast(`${dc.dcLocation} · 健康详情已打开`)}>健康详情</button>
                <button onClick={() => ctx.openDatacenter(dc)}>编辑</button>
                <button className="dgr" onClick={() => ctx.deleteDatacenter(dc)}>删除</button>
                {paused
                  ? <button className="resume" onClick={() => toggle(dc.dcLocation)}>恢复派单</button>
                  : <button className="pause" onClick={() => toggle(dc.dcLocation)}><PauseIcon /> 批量 pause</button>}
              </div>
            </div>
          );
        })}
      </div>

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
