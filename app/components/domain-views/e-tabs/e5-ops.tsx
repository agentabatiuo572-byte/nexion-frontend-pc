import type { ReactNode } from "react";
import { CodeTag } from "../design-kit";
import type { EViewCtx } from "./types";
import { EStats } from "./stats";

const FLEET_TOTAL = 41208;
const ECG_PATH = "M0,30 L80,30 L100,30 L110,12 L120,48 L130,18 L140,30 L220,30 L240,30 L250,10 L260,52 L270,18 L280,30 L360,30 L380,30 L390,12 L400,48 L410,18 L420,30 L500,30 L520,30 L530,10 L540,52 L550,18 L560,30 L640,30 L660,30 L670,12 L680,48 L690,18 L700,30 L800,30";

const DCS = [
  { id: "us-east-2", reg: "美国 · 弗吉尼亚", online: 18420, state: "online", qps: "420 tps", latency: "62ms", cpu: "58%", gpu: "72%", sp: [18280, 18380, 18420, 18395, 18410, 18445, 18420] },
  { id: "eu-west-1", reg: "欧洲 · 都柏林", online: 12880, state: "online", qps: "304 tps", latency: "48ms", cpu: "61%", gpu: "68%", sp: [12940, 12895, 12880, 12830, 12860, 12875, 12880] },
  { id: "ap-southeast-1", reg: "亚太 · 新加坡", online: 9908, state: "warn", qps: "241 tps", latency: "108ms", cpu: "74%", gpu: "82%", sp: [9985, 9952, 9920, 9892, 9876, 9898, 9908] },
];

type FeedType = "heart" | "info" | "alert" | "audit" | "danger";
const FEED: { ts: string; type: FeedType; body: ReactNode; desc: string; actor: string }[] = [
  { ts: "2m", type: "heart", body: <>DC <b>ap-southeast-1</b> 在线设备从 <b>9,892</b> 抬升至 <b>9,908</b></>, desc: "+16 自动重连 · 自然回升 · 无需人工介入", actor: "scheduler" },
  { ts: "8m", type: "info", body: <>设备 <b>dev-8472A1</b>(用户 usr_19C7)恢复在线</>, desc: "heartbeat 异常 14m 后自动恢复 · DC us-east-2", actor: "heartbeat-svc" },
  { ts: "23m", type: "alert", body: <><b>ap-southeast-1</b> 设备掉线告警</>, desc: "12 台设备 heartbeat 失联 > 5m · 排查中:DC 网络抖动", actor: "monitor" },
  { ts: "1h", type: "audit", body: <>批量 pause <b>eu-west-1</b> 已恢复</>, desc: "2h 维护窗口结束 · 12,880 设备已重新接入调度 · 写 A2 审计", actor: "ops · 张 · 操作确认" },
  { ts: "3h", type: "audit", body: <>批量 pause <b>eu-west-1</b> 启动维护窗口</>, desc: "12,880 设备停止派单,2h 滚动升级 firmware v3.2.1", actor: "ops · 张 · 操作确认" },
  { ts: "7h", type: "danger", body: <>设备 <b>dev-1184B7</b> 标记 <b style={{ color: "var(--danger)" }}>永久离线</b></>, desc: "heartbeat 失联 > 24h · 已触发用户通知(I3)· 资产回退给主账户", actor: "heartbeat-svc" },
  { ts: "14h", type: "info", body: <>夜间任务调度高峰 · 全网负载 78%</>, desc: "UTC 19:00 高峰 · 队列饱和度短暂超过 75% 持续 22min", actor: "scheduler" },
];

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
  const toggle = (dc: typeof DCS[number]) => {
    const paused = ctx.isDcPaused(dc.id);
    ctx.openActionConfirm({
      name: paused ? `恢复派单 · ${dc.id}` : `批量 pause · ${dc.id}`,
      op: "ops-pause", dc: dc.id, fixedVal: paused ? "false" : "true", amplify: false,
      detail: paused
        ? `恢复 ${dc.id} 派单 · heartbeat 重新接入调度,无需重启设备`
        : `暂停 ${dc.id} 全节点派单 · 仅运维窗口,不影响已售设备结算(用户按 baseRate 继续计提)· 处置限单 DC`,
    });
  };

  return (
    <>
      <EStats items={[
        { k: "在线设备(全网)", v: "41,208", sub: "heartbeat 99.2%", tone: "ok" },
        { k: "离线 / 异常", v: "312", sub: "需排查 · ap-southeast-1 居多", tone: "warn" },
        { k: "单户设备上限", v: "6", sub: "MAX_DEVICES 闸门" },
        { k: "平均 NPU 算力", v: "~28 TOPS", sub: "Pro v2 主导", tone: "cyan" },
      ]} />

      {/* Global heartbeat banner */}
      <section className="heartbeat">
        <div>
          <div className="hb-num">41,208</div>
          <div className="hb-lbl"><b>实时</b> 在网设备 · heartbeat 心跳 30s · 99.2% 接入</div>
        </div>
        <div className="ecg-wrap">
          <svg viewBox="0 0 800 60" preserveAspectRatio="none">
            <line className="ecg-base" x1="0" y1="30" x2="800" y2="30" />
            <path className="ecg-line ecg-pulse" d={ECG_PATH} />
          </svg>
        </div>
        <div className="hb-ctrl">
          <div className="row"><span>过去 1h heartbeat 失联</span><span className="v">312</span></div>
          <div className="row"><span>过去 24h 自动重连</span><span className="v">1,847</span></div>
          <div className="row"><span>持续异常 &gt; 1h</span><span className="v warn">28</span></div>
          <div className="row"><span>调度延迟 P95</span><span className="v">142ms</span></div>
        </div>
      </section>

      {/* 3 DC 控制面板 */}
      <div className="dc-grid">
        {DCS.map((dc) => {
          const paused = ctx.isDcPaused(dc.id);
          const cls = paused ? "paused" : dc.state;
          const stateLbl = paused ? "已暂停" : dc.state === "warn" ? "波动中" : "在线";
          const sparkColor = paused ? "var(--ink-4)" : dc.state === "warn" ? "var(--warning)" : "var(--success)";
          const pct = ((dc.online / FLEET_TOTAL) * 100).toFixed(1);
          return (
            <div className={`dc-card ${cls}`} key={dc.id}>
              <div className="dc-h">
                <span className="ic"><RackIcon /></span>
                <div className="t"><div className="nm">{dc.id}</div><div className="reg">{dc.reg}</div></div>
                <span className="state"><span className="d" />{stateLbl}</span>
              </div>
              <div className="dc-body">
                <div className="dc-num"><span className={`v${dc.state === "warn" && !paused ? " warn" : ""}`}>{dc.online.toLocaleString()}</span></div>
                <div className="lbl">在线设备 · 占比 {pct}%</div>
                <div className="dc-spark"><DcSpark data={dc.sp} color={sparkColor} /></div>
                <div className="dc-sub">
                  <div className="stat"><div className="k">任务吞吐</div><div className="v">{dc.qps}</div></div>
                  <div className="stat"><div className="k">P95 延迟</div><div className={`v ${dc.state === "warn" ? "warn" : "ok"}`}>{dc.latency}</div></div>
                  <div className="stat"><div className="k">CPU 平均</div><div className="v">{dc.cpu}</div></div>
                  <div className="stat"><div className="k">GPU 平均</div><div className={`v${parseInt(dc.gpu, 10) > 80 ? " warn" : ""}`}>{dc.gpu}</div></div>
                </div>
              </div>
              <div className="dc-foot">
                <button onClick={() => ctx.toast(`${dc.id} · 健康详情已打开`)}>健康详情</button>
                {paused
                  ? <button className="resume" onClick={() => toggle(dc)}>恢复派单</button>
                  : <button className="pause" onClick={() => toggle(dc)}><PauseIcon /> 批量 pause</button>}
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
          {FEED.map((f, i) => (
            <div className="feed-it" key={i}>
              <div className="ts">{f.ts}</div>
              <div className={`dot ${f.type}`}><FeedIcon t={f.type} /></div>
              <div className="body">{f.body}<div className="desc">{f.desc}</div></div>
              <div className="actor">{f.actor}</div>
            </div>
          ))}
        </div>
      </section>
      <p className="f-foot">批量 pause 是<b>仅限运维窗口</b>的处置 — 暂停 DC 全节点派单,但不影响已售设备结算(用户依然按 baseRate 计提收益)。处置范围限单 DC,跨 DC 联动须分次操作。<b>heartbeat 失联 &gt; 24h</b> 的设备自动进入永久离线列表,资产回退由 server cron 兜底。</p>
    </>
  );
}
