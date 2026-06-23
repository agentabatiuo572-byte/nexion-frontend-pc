import { useState, type ReactNode } from "react";
import { CodeTag, Badge, Drawer, KV } from "../design-kit";
import type { OpsDataCenter } from "@/lib/store/admin/platform-config-store";
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

// DC 监控遥测(runtime,真后台由 fleet 监控下发;按 id join 可配置的数据中心 ctx.dataCenters)。
// 数据中心的 {id,所在地,前端展示名称} 改由 store 单源 ctx.dataCenters 持有(E5 可增删改);此处只留遥测。
type DcTelemetry = { online: number; state: string; qps: string; latency: string; cpu: string; gpu: string; sp: number[] };
const DC_TELEMETRY: Record<string, DcTelemetry> = {
  "us-east-2": { online: 18420, state: "online", qps: "420 tps", latency: "62ms", cpu: "58%", gpu: "72%", sp: [18280, 18380, 18420, 18395, 18410, 18445, 18420] },
  "eu-west-1": { online: 12880, state: "online", qps: "304 tps", latency: "48ms", cpu: "61%", gpu: "68%", sp: [12940, 12895, 12880, 12830, 12860, 12875, 12880] },
  "ap-southeast-1": { online: 9908, state: "warn", qps: "241 tps", latency: "108ms", cpu: "74%", gpu: "82%", sp: [9985, 9952, 9920, 9892, 9876, 9898, 9908] },
};
const DC_TELEMETRY_FALLBACK: DcTelemetry = { online: 0, state: "online", qps: "—", latency: "—", cpu: "—", gpu: "—", sp: [0, 0, 0, 0, 0, 0, 0] };

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

export function E5Ops({ ctx }: { ctx: EViewCtx }) {
  const [healthDc, setHealthDc] = useState<OpsDataCenter | null>(null); // 数据中心健康详情抽屉
  // #22 设备库存激活闭环:激活 / 取消激活 / 强制激活 / 解绑(E.device.<id>.state 真写,param-fixed)
  const devState = (id: string, seed: string): string => ctx.pget(`E.device.${id}.state`) ?? seed;
  const devAct = (id: string, next: string, name: string, detail: string, amplify = false) =>
    ctx.openActionConfirm({ name: `${name} · ${id}`, op: "param-fixed", paramKey: `E.device.${id}.state`, fixedVal: next, amplify, detail });

  const toggle = (dc: OpsDataCenter) => {
    const paused = ctx.isDcPaused(dc.id);
    ctx.openActionConfirm({
      name: paused ? `恢复派单 · ${dcId}` : `批量 pause · ${dcId}`,
      op: "ops-pause", dc: dcId, fixedVal: paused ? "false" : "true", amplify: false,
      detail: paused
        ? `恢复 ${dcId} 派单 · heartbeat 重新接入调度,无需重启设备`
        : `暂停 ${dcId} 全节点派单 · 仅运维窗口,不影响已售设备结算(用户按 baseRate 继续计提)· 处置限单 DC`,
    });
  };
  // 区域 id → 前端展示名称(数据中心单源 ctx.dataCenters;未匹配回退原 id)。
  const dcName = (id: string): string => ctx.dataCenters.find((x) => x.id === id)?.displayName ?? id;

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
          <span className="sub">激活 / 取消激活 / 强制激活 / 解绑</span>
          <span className="r"><CodeTag tone="electric">E.device.*</CodeTag></span>
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
                  <td colSpan={8} style={{ padding: "18px 10px", color: "var(--ink-3)" }}>正在从后端加载第 {ctx.e5Page} 页设备库存...</td>
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
              {!ctx.e5Loading && !ctx.e5Error && devices.map((d) => {
                const skuMain = d.productCode || d.sku;
                const skuSub = d.productTier && d.productTier !== skuMain ? d.productTier : "";
                return (
                  <tr key={d.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "9px 10px", fontFamily: "var(--mono)", color: "var(--ink)", fontWeight: 600 }}>{d.id}</td>
                    <td style={{ padding: "9px 10px", fontFamily: "var(--mono)" }}>{d.user}</td>
                    <td style={{ padding: "9px 10px" }}>{d.sku}</td>
                    <td style={{ padding: "9px 10px", fontFamily: "var(--mono)", color: "var(--ink-3)" }}>{d.order}</td>
                    <td style={{ padding: "9px 10px", color: "var(--ink-3)" }} title={d.dc}>{dcName(d.dc)}</td>
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
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="f-foot" style={{ margin: "10px 14px 14px", textAlign: "right" }}><b>激活</b>=让仓库里的设备正式上线干活;<b>强制激活</b>=跳过检查硬上线,出问题时救急用;<b>取消激活</b>=收回仓库先停工,以后还能再开;<b>解绑</b>=和用户彻底断开,开不回来了。</p>
      </section>

      {/* 数据中心管理(运营可增删改 {区域 ID / 所在地 / 前端展示名称};SKU datacenter 下拉读此处单源) */}
      <section className="feed-card" data-proof="e5-datacenters" style={{ marginBottom: 16 }}>
        <div className="feed-h">
          <span className="ttl">数据中心管理</span>
          <span className="sub">区域 ID · 所在地 · 前端展示名称 · 可增删改 · SKU「数据中心」下拉读「前端展示名称」</span>
          <span className="r"><button className="l-btn sm mc" onClick={() => ctx.openDcEdit()}>+ 新增数据中心</button></span>
        </div>
        <div style={{ overflowX: "auto", padding: "4px 4px 0" }}>
          <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink-4)", fontSize: 11.5 }}>
                <th style={{ padding: "8px 10px" }}>区域 ID</th><th style={{ padding: "8px 10px" }}>所在地</th>
                <th style={{ padding: "8px 10px" }}>前端展示名称</th><th style={{ padding: "8px 10px" }}>在线设备</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>动作</th>
              </tr>
            </thead>
            <tbody>
              {ctx.dataCenters.map((dc) => {
                const t = DC_TELEMETRY[dc.id] ?? DC_TELEMETRY_FALLBACK;
                return (
                  <tr key={dc.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "9px 10px", fontFamily: "var(--mono)", color: "var(--ink)", fontWeight: 600 }}>{dc.id}</td>
                    <td style={{ padding: "9px 10px" }}>{dc.location}</td>
                    <td style={{ padding: "9px 10px", color: "var(--ink)", fontWeight: 600 }}>{dc.displayName}</td>
                    <td style={{ padding: "9px 10px", fontFamily: "var(--mono)", color: "var(--ink-3)" }}>{t.online ? t.online.toLocaleString() : "—"}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="l-btn sm mc" onClick={() => ctx.openDcEdit(dc)}>编辑</button>{" "}
                      <button className="l-btn sm dgr" onClick={() => ctx.delDc(dc)}>删除</button>
                    </td>
                  </tr>
                );
              })}
              {ctx.dataCenters.length === 0 && <tr><td colSpan={5} style={{ padding: "12px 10px", color: "var(--ink-4)" }}>暂无数据中心 · 点「+ 新增数据中心」添加</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="f-foot" style={{ margin: "10px 14px 14px" }}><b>单源</b> · 数据中心的 区域 ID / 所在地 / 前端展示名称 在此增删改;SKU 新增/编辑的「数据中心」下拉直接读「前端展示名称」,用户购买激活展示该名称。改动走操作确认 + A2 审计。</p>
      </section>

      {/* DC 控制面板(读 ctx.dataCenters,遥测按 id join DC_TELEMETRY) */}
      <div className="dc-grid">
        {ctx.dataCenters.map((dc) => {
          const t = DC_TELEMETRY[dc.id] ?? DC_TELEMETRY_FALLBACK;
          const paused = ctx.isDcPaused(dc.id);
          const cls = paused ? "paused" : t.state;
          const stateLbl = paused ? "已暂停" : t.state === "warn" ? "波动中" : "在线";
          const sparkColor = paused ? "var(--ink-4)" : t.state === "warn" ? "var(--warning)" : "var(--success)";
          const pct = ((t.online / FLEET_TOTAL) * 100).toFixed(1);
          return (
            <div className={`dc-card ${cls}`} key={dc.dcLocation}>
              <div className="dc-h">
                <span className="ic"><RackIcon /></span>
                <div className="t"><div className="nm">{dc.displayName}</div><div className="reg">{dc.id} · {dc.location}</div></div>
                <span className="state"><span className="d" />{stateLbl}</span>
              </div>
              <div className="dc-body">
                <div className="dc-num"><span className={`v${t.state === "warn" && !paused ? " warn" : ""}`}>{t.online.toLocaleString()}</span></div>
                <div className="lbl">在线设备 · 占比 {pct}%</div>
                <div className="dc-spark"><DcSpark data={t.sp} color={sparkColor} /></div>
                <div className="dc-sub">
                  <div className="stat"><div className="k">任务吞吐</div><div className="v">{t.qps}</div></div>
                  <div className="stat"><div className="k">P95 延迟</div><div className={`v ${t.state === "warn" ? "warn" : "ok"}`}>{t.latency}</div></div>
                  <div className="stat"><div className="k">CPU 平均</div><div className="v">{t.cpu}</div></div>
                  <div className="stat"><div className="k">GPU 平均</div><div className={`v${parseInt(t.gpu, 10) > 80 ? " warn" : ""}`}>{t.gpu}</div></div>
                </div>
              </div>
              <div className="dc-foot">
                <button onClick={() => setHealthDc(dc)}>健康详情</button>
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

      {/* 数据中心健康详情抽屉(遥测 + 本 DC 设备 + 运行状态;只读监控) */}
      {healthDc && (() => {
        const dc = healthDc;
        const t = DC_TELEMETRY[dc.id] ?? DC_TELEMETRY_FALLBACK;
        const hasTelemetry = !!DC_TELEMETRY[dc.id];
        const paused = ctx.isDcPaused(dc.id);
        const stateLbl = paused ? "已暂停" : t.state === "warn" ? "波动中" : "在线";
        const sparkColor = paused ? "var(--ink-4)" : t.state === "warn" ? "var(--warning)" : "var(--success)";
        const pct = ((t.online / FLEET_TOTAL) * 100).toFixed(1);
        const devs = FLEET.filter((d) => d.dc === dc.id);
        const activeDevs = devs.filter((d) => devState(d.id, d.seed) === "active").length;
        return (
          <Drawer title={`${dc.displayName} · 健康详情`} sub={`${dc.id} · ${dc.location}`} onClose={() => setHealthDc(null)}
            footer={<button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setHealthDc(null)}>关闭</button>}>
            {!hasTelemetry && <div className="tint" style={{ marginBottom: 12 }}><span className="tiny"><b>新增数据中心</b> · 监控遥测待 fleet 接入后下发,以下为占位值。</span></div>}
            <div style={{ textAlign: "center", padding: "6px 0 14px" }}>
              <div className="muted tiny">在线设备</div>
              <div style={{ fontSize: 30, fontWeight: 600, color: paused ? "var(--ink-3)" : t.state === "warn" ? "var(--warning)" : "var(--ink)" }}>{t.online.toLocaleString()}</div>
              <div className="muted tiny">占全网 {pct}%</div>
            </div>
            <div style={{ height: 40, marginBottom: 14 }}><DcSpark data={t.sp} color={sparkColor} /></div>
            <KV k="运行状态" v={<Badge tone={paused ? "neutral" : t.state === "warn" ? "warn" : "ok"}>{stateLbl}</Badge>} />
            <KV k="派单状态" v={paused ? "已暂停 · 运维窗口" : "正常派单"} />
            <KV k="任务吞吐" v={t.qps} />
            <KV k="P95 延迟" v={t.latency} />
            <KV k="CPU 平均" v={t.cpu} />
            <KV k="GPU 平均" v={t.gpu} />
            <div style={{ fontSize: 13, fontWeight: 600, margin: "16px 0 8px", color: "var(--ink)" }}>本数据中心设备 · {devs.length} 台({activeDevs} 在网)</div>
            {devs.length === 0 ? (
              <div className="muted tiny">本数据中心暂无绑定设备</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ textAlign: "left", color: "var(--ink-4)", fontSize: 11 }}>
                  <th style={{ padding: "6px 8px" }}>设备</th><th style={{ padding: "6px 8px" }}>用户</th><th style={{ padding: "6px 8px" }}>SKU</th><th style={{ padding: "6px 8px" }}>槽位</th><th style={{ padding: "6px 8px" }}>状态</th>
                </tr></thead>
                <tbody>{devs.map((d) => { const st = devState(d.id, d.seed); return (
                  <tr key={d.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "7px 8px", fontFamily: "var(--mono)" }}>{d.id}</td>
                    <td style={{ padding: "7px 8px", fontFamily: "var(--mono)" }}>{d.user}</td>
                    <td style={{ padding: "7px 8px" }}>{d.sku}</td>
                    <td style={{ padding: "7px 8px", fontFamily: "var(--mono)" }}>{d.slot}</td>
                    <td style={{ padding: "7px 8px" }}><Badge tone={st === "active" ? "ok" : st === "inventory" ? "warn" : "neutral"}>{DEV_STATE_LABEL[st] ?? st}</Badge></td>
                  </tr>
                ); })}</tbody>
              </table>
            )}
            <div className="tint" style={{ marginTop: 14 }}><span className="tiny"><b>只读监控</b> · 健康数据由 fleet 监控实时下发;批量 pause / 设备激活等处置在数据中心卡与设备库存表操作 · 走操作确认 + A2 审计。</span></div>
          </Drawer>
        );
      })()}
    </>
  );
}
