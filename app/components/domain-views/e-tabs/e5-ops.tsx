import type { ReactNode } from "react";
import { CodeTag, Badge } from "../design-kit";
import { E5_MAX_DEVICES, type E5Device, type E5DeviceState, type E5Overview } from "@/lib/admin/e5-client";
import type { EViewCtx } from "./types";
import { EStats } from "./stats";

const MAX_DEVICES = E5_MAX_DEVICES;
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

const DC_META = [
  { id: "us-east-2", reg: "美国 · 弗吉尼亚" },
  { id: "eu-west-1", reg: "欧洲 · 都柏林" },
  { id: "ap-southeast-1", reg: "亚太 · 新加坡" },
];
const DC_REGION = new Map(DC_META.map((dc) => [dc.id, dc.reg]));

type FeedType = "heart" | "info" | "alert" | "audit" | "danger";
type FeedRow = { ts: string; type: FeedType; body: ReactNode; desc: string; actor: string };

const RackIcon = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="2" y="4" width="20" height="6" rx="1" /><rect x="2" y="14" width="20" height="6" rx="1" /><line x1="6" y1="7" x2="6.01" y2="7" /><line x1="6" y1="17" x2="6.01" y2="17" /></svg>;
const PauseIcon = () => <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 5v14M15 5v14" /></svg>;
function FeedIcon({ t }: { t: FeedType }) {
  const p: Record<FeedType, ReactNode> = {
    heart: <path d="M12 21s-7-4.5-9-9.5C2 8 5 5 8 5s4 2 4 2 1-2 4-2 6 3 5 6.5C20.5 16.5 12 21 12 21z" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></>,
    alert: <><path d="M12 4l9 16H3z" /><path d="M12 10v5M12 18h.01" /></>,
    audit: <><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></>,
    danger: <><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></>,
  };
  return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{p[t]}</svg>;
}
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

function currentSpark(value: number) {
  return Array.from({ length: 7 }, () => Math.max(value, 0));
}

function isActivatable(state: E5DeviceState) {
  return state === "inventory" || state === "unbound";
}

function isDeactivatable(state: E5DeviceState) {
  return state === "active" || state === "busy" || state === "offline" || state === "abnormal";
}

function buildFeed(devices: E5Device[], overview: E5Overview | null): FeedRow[] {
  const rows: FeedRow[] = [];
  if (overview) {
    rows.push({
      ts: "now",
      type: "heart",
      body: <>设备 overview 已同步 · 在线 <b>{fmtCount(overview.onlineDevices)}</b> / 总计 <b>{fmtCount(overview.totalDevices)}</b></>,
      desc: `异常 ${fmtCount(overview.abnormalDevices)} · 离线 ${fmtCount(overview.offlineDevices)} · 回收/停用 ${fmtCount(overview.recycledDevices)}`,
      actor: "device-ops-api",
    });
    overview.datacenters.filter((dc) => dc.dispatchPaused).slice(0, 2).forEach((dc) => {
      rows.push({
        ts: "now",
        type: "audit",
        body: <><b>{dc.dcLocation}</b> 派单暂停中</>,
        desc: `在线 ${fmtCount(dc.onlineDevices)} · 异常 ${fmtCount(dc.abnormalDevices)} · 平均 GPU ${Math.round(dc.avgGpuUsage)}%`,
        actor: "ops-dispatch",
      });
    });
    overview.datacenters.filter((dc) => dc.abnormalDevices > 0).slice(0, 2).forEach((dc) => {
      rows.push({
        ts: "now",
        type: "alert",
        body: <><b>{dc.dcLocation}</b> 存在异常设备</>,
        desc: `异常 ${fmtCount(dc.abnormalDevices)} · 平均 GPU ${Math.round(dc.avgGpuUsage)}% · 后端 heartbeat 聚合`,
        actor: "heartbeat",
      });
    });
  }

  devices.filter((device) => device.state === "abnormal" || device.state === "offline").slice(0, 2).forEach((device) => {
    rows.push({
      ts: "now",
      type: device.state === "abnormal" ? "danger" : "alert",
      body: <><b>{device.serial}</b> {DEV_STATE_LABEL[device.state]}</>,
      desc: `${device.dc || "未分配 DC"} · ${device.runtimeStatus || device.rawStatus || "后端状态待同步"}`,
      actor: "device-agent",
    });
  });

  const first = devices[0];
  if (first) {
    rows.push({
      ts: "now",
      type: "info",
      body: <><b>{first.serial}</b> 库存记录已从后端返回</>,
      desc: `${first.user || "未绑定用户"} · ${first.sku || "未配置 SKU"} · ${DEV_STATE_LABEL[first.state]}`,
      actor: "inventory",
    });
  }

  return rows.slice(0, 7);
}

export function E5Ops({ ctx }: { ctx: EViewCtx }) {
  const devices = ctx.e5Devices;
  const overview = ctx.e5Overview;
  const totalDevices = overview?.totalDevices ?? devices.length;
  const onlineDevices = overview?.onlineDevices ?? devices.filter((d) => d.state === "active" || d.state === "busy").length;
  const abnormalDevices = overview?.abnormalDevices ?? devices.filter((d) => d.state === "abnormal" || d.state === "offline").length;
  const recycledDevices = overview?.recycledDevices ?? devices.filter((d) => d.state === "unbound").length;
  const dcStats = new Map((overview?.datacenters ?? []).map((dc) => [dc.dcLocation, dc]));
  const dcRows = overview?.datacenters?.length
    ? overview.datacenters.map((dc) => ({ id: dc.dcLocation, reg: DC_REGION.get(dc.dcLocation) ?? "后端返回 DC" }))
    : DC_META;
  const devAct = (d: E5Device, op: "device-activate" | "device-deactivate", name: string, detail: string, amplify = false) =>
    ctx.openActionConfirm({ name: `${name} · ${d.serial}`, op, deviceId: d.deviceId, deviceNo: d.serial, amplify, detail });
  const feed = buildFeed(devices, overview);

  const toggle = (dcId: string) => {
    const paused = ctx.isDcPaused(dcId);
    ctx.openActionConfirm({
      name: paused ? `恢复派单 · ${dcId}` : `批量 pause · ${dcId}`,
      op: "ops-pause", dc: dcId, fixedVal: paused ? "false" : "true", amplify: false,
      detail: paused
        ? `恢复 ${dcId} 派单 · heartbeat 重新接入调度,无需重启设备`
        : `暂停 ${dcId} 全节点派单 · 仅运维窗口,不影响已售设备结算(用户按 baseRate 继续计提)· 处置限单 DC`,
    });
  };

  return (
    <>
      <EStats items={[
        { k: "在线设备(全网)", v: fmtCount(onlineDevices), sub: "来自 /api/admin/devices/overview", tone: "ok" },
        { k: "离线 / 异常", v: fmtCount(abnormalDevices), sub: "后端 runtime / heartbeat 聚合", tone: "warn" },
        { k: "单户设备上限", v: "6", sub: "MAX_DEVICES 闸门" },
        { k: "回收 / 停用", v: fmtCount(recycledDevices), sub: "可恢复设备走后端恢复接口", tone: "cyan" },
      ]} />

      {/* Global heartbeat banner */}
      <section className="heartbeat">
        <div>
          <div className="hb-num">{fmtCount(totalDevices)}</div>
          <div className="hb-lbl"><b>实时</b> 在网设备 · heartbeat 心跳 30s · 后端概览同步</div>
        </div>
        <div className="ecg-wrap">
          <svg viewBox="0 0 800 60" preserveAspectRatio="none">
            <line className="ecg-base" x1="0" y1="30" x2="800" y2="30" />
            <path className="ecg-line ecg-pulse" d={ECG_PATH} />
          </svg>
        </div>
        <div className="hb-ctrl">
          <div className="row"><span>过去 1h heartbeat 失联</span><span className="v">{fmtCount(abnormalDevices)}</span></div>
          <div className="row"><span>过去 24h 自动重连</span><span className="v">—</span></div>
          <div className="row"><span>持续异常 &gt; 1h</span><span className="v warn">{fmtCount(overview?.offlineDevices)}</span></div>
          <div className="row"><span>调度延迟 P95</span><span className="v">—</span></div>
        </div>
      </section>

      {/* #22 设备库存 & 激活 */}
      <section className="feed-card" data-proof="e5-inventory" style={{ marginBottom: 16 }}>
        <div className="feed-h">
          <span className="ttl">设备库存 & 激活</span>
          <span className="sub">激活 / 取消激活 / 强制激活 / 解绑 · 校验订单关系 + 用户槽位 + MAX_DEVICES({MAX_DEVICES})</span>
          <span className="r"><CodeTag tone="electric">GET /api/admin/devices</CodeTag></span>
        </div>
        <div style={{ overflowX: "auto", padding: "4px 4px 0" }}>
          <table style={{ width: "100%", minWidth: 880, borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink-4)", fontSize: 11.5 }}>
                <th style={{ padding: "8px 10px" }}>设备</th><th style={{ padding: "8px 10px" }}>用户</th><th style={{ padding: "8px 10px" }}>SKU</th>
                <th style={{ padding: "8px 10px" }}>设备编号</th><th style={{ padding: "8px 10px" }}>DC</th><th style={{ padding: "8px 10px" }}>用户槽位</th>
                <th style={{ padding: "8px 10px" }}>状态</th><th style={{ padding: "8px 10px", textAlign: "right" }}>动作</th>
              </tr>
            </thead>
            <tbody>
              {ctx.e5Loading && (
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td colSpan={8} style={{ padding: "18px 10px", color: "var(--ink-3)" }}>正在从后端加载设备库存...</td>
                </tr>
              )}
              {!ctx.e5Loading && ctx.e5Error && (
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td colSpan={8} style={{ padding: "18px 10px", color: "var(--danger)" }}>设备库存接口异常:{ctx.e5Error}</td>
                </tr>
              )}
              {!ctx.e5Loading && !ctx.e5Error && devices.length === 0 && (
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td colSpan={8} style={{ padding: "18px 10px", color: "var(--ink-3)" }}>后端暂无设备库存数据</td>
                </tr>
              )}
              {!ctx.e5Loading && !ctx.e5Error && devices.map((d) => (
                <tr key={`${d.deviceId}-${d.serial}`} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "9px 10px", fontFamily: "var(--mono)", color: "var(--ink)", fontWeight: 600 }}>{d.deviceId || d.serial}</td>
                  <td style={{ padding: "9px 10px", fontFamily: "var(--mono)" }}>{d.user}</td>
                  <td style={{ padding: "9px 10px" }}>{d.sku}</td>
                  <td style={{ padding: "9px 10px", fontFamily: "var(--mono)", color: "var(--ink-3)" }}>{d.serial}</td>
                  <td style={{ padding: "9px 10px", fontFamily: "var(--mono)", color: "var(--ink-3)" }}>{d.dc}</td>
                  <td style={{ padding: "9px 10px", fontFamily: "var(--mono)" }}>{d.slot}</td>
                  <td style={{ padding: "9px 10px" }}><Badge tone={DEV_STATE_TONE[d.state]}>{DEV_STATE_LABEL[d.state]}</Badge></td>
                  <td style={{ padding: "9px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                    {isActivatable(d.state) && (
                      <>
                        <button className="l-btn sm mc" onClick={() => devAct(d, "device-activate", "激活设备", `激活 ${d.serial}(用户 ${d.user} 槽位 ${d.slot})· 后端校验设备状态 + MAX_DEVICES(${MAX_DEVICES}) + A2 审计`)}>激活</button>{" "}
                        <button className="l-btn sm mc" onClick={() => devAct(d, "device-activate", "强制激活设备", `强制激活 ${d.serial} · 运维异常补救 · force 不绕过 MAX_DEVICES(${MAX_DEVICES})硬上限 · 理由必填 + A2`, true)}>强制激活</button>
                      </>
                    )}
                    {isDeactivatable(d.state) && (
                      <>
                        <button className="l-btn sm mc" onClick={() => devAct(d, "device-deactivate", "取消激活设备", `取消激活 ${d.serial} · 停止派单与计提 · 后端写设备状态并留审计`)}>取消激活</button>{" "}
                        <button className="l-btn sm dgr" onClick={() => devAct(d, "device-deactivate", "解绑设备", `解绑 ${d.serial} · 与用户 ${d.user} 槽位解除关联(异常设备处置)· 理由必填 + A2`, true)}>解绑</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="f-foot" style={{ margin: "10px 14px 14px" }}><b>库存激活闭环</b> · 列表读取 <span className="mono">/api/admin/devices</span>;激活调用设备恢复/激活接口;取消激活与解绑调用设备停用接口。所有写操作必须带理由、幂等键、操作人,由后端写设备状态并进入 A2 审计。</p>
      </section>

      {/* 3 DC 控制面板 */}
      <div className="dc-grid">
        {dcRows.map((dc) => {
          const realDc = dcStats.get(dc.id);
          const paused = ctx.isDcPaused(dc.id);
          const abnormal = realDc?.abnormalDevices ?? 0;
          const cls = paused ? "paused" : abnormal > 0 ? "warn" : realDc ? "online" : "idle";
          const stateLbl = paused ? "已暂停" : abnormal > 0 ? "波动中" : realDc ? "在线" : "未返回";
          const sparkColor = paused ? "var(--ink-4)" : abnormal > 0 ? "var(--warning)" : "var(--success)";
          const online = realDc?.onlineDevices;
          const onlineValue = online ?? 0;
          const pct = realDc && totalDevices > 0 ? ((onlineValue / totalDevices) * 100).toFixed(1) : "—";
          const gpu = realDc ? `${Math.round(realDc.avgGpuUsage)}%` : "—";
          const spark = currentSpark(onlineValue);
          return (
            <div className={`dc-card ${cls}`} key={dc.id}>
              <div className="dc-h">
                <span className="ic"><RackIcon /></span>
                <div className="t"><div className="nm">{dc.id}</div><div className="reg">{dc.reg}</div></div>
                <span className="state"><span className="d" />{stateLbl}</span>
              </div>
              <div className="dc-body">
                <div className="dc-num"><span className={`v${abnormal > 0 && !paused ? " warn" : ""}`}>{fmtCount(online)}</span></div>
                <div className="lbl">在线设备 · 占比 {pct}%</div>
                <div className="dc-spark"><DcSpark data={spark} color={sparkColor} /></div>
                <div className="dc-sub">
                  <div className="stat"><div className="k">任务吞吐</div><div className="v">—</div></div>
                  <div className="stat"><div className="k">P95 延迟</div><div className={`v ${abnormal > 0 ? "warn" : "ok"}`}>—</div></div>
                  <div className="stat"><div className="k">CPU 平均</div><div className="v">—</div></div>
                  <div className="stat"><div className="k">GPU 平均</div><div className={`v${parseInt(gpu, 10) > 80 ? " warn" : ""}`}>{gpu}</div></div>
                </div>
              </div>
              <div className="dc-foot">
                <button onClick={() => ctx.toast(`${dc.id} · 健康详情已打开`)}>健康详情</button>
                {paused
                  ? <button className="resume" onClick={() => toggle(dc.id)}>恢复派单</button>
                  : <button className="pause" onClick={() => toggle(dc.id)}><PauseIcon /> 批量 pause</button>}
              </div>
            </div>
          );
        })}
      </div>

      {/* 运维活动 feed */}
      <section className="feed-card">
        <div className="feed-h">
          <span className="ttl">运维活动 · 最近 24h</span>
          <span className="sub">heartbeat 异常 + 批量操作 + 自动重连</span>
          <span className="r"><CodeTag tone="electric">A2 审计</CodeTag></span>
        </div>
        <div className="feed">
          {feed.length ? feed.map((f, i) => (
            <div className="feed-it" key={i}>
              <div className="ts">{f.ts}</div>
              <div className={`dot ${f.type}`}><FeedIcon t={f.type} /></div>
              <div className="body">{f.body}<div className="desc">{f.desc}</div></div>
              <div className="actor">{f.actor}</div>
            </div>
          )) : (
            <div className="feed-it">
              <div className="ts">now</div>
              <div className="dot info"><FeedIcon t="info" /></div>
              <div className="body">后端暂无运维活动数据<div className="desc">等待 /api/admin/devices/overview 或设备列表返回</div></div>
              <div className="actor">device-ops-api</div>
            </div>
          )}
        </div>
      </section>
      <p className="f-foot">批量 pause 是<b>仅限运维窗口</b>的处置 — 暂停 DC 全节点派单,但不影响已售设备结算(用户依然按 baseRate 计提收益)。处置范围限单 DC,跨 DC 联动须分次操作。<b>heartbeat 失联 &gt; 24h</b> 的设备自动进入永久离线列表,资产回退由 server cron 兜底。</p>
    </>
  );
}
