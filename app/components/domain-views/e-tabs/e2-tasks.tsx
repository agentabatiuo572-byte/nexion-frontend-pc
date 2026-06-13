import { Fragment, type ReactNode } from "react";
import { CodeTag } from "../design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { OpsTask } from "@/lib/store/admin/platform-config-store";
import type { EViewCtx } from "./types";
import { EStats } from "./stats";

/* ── 任务图标(按任务名推断 kind;OpsSchema 无 kind 字段)── */
type Kind = "llm" | "img" | "vid" | "ft" | "em";
function taskKind(n: string): Kind {
  if (/llm|405b|70b|推理/i.test(n)) return "llm";
  if (/图像|image|sdxl|img/i.test(n)) return "img";
  if (/视频|渲染|video|vid/i.test(n)) return "vid";
  if (/微调|lora|ft|fine/i.test(n)) return "ft";
  if (/embed|em\b|嵌入/i.test(n)) return "em";
  return "llm";
}
function KindIcon({ k }: { k: Kind }) {
  const p: Record<Kind, ReactNode> = {
    llm: <><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /><circle cx="12" cy="12" r="3" /></>,
    img: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></>,
    vid: <><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3z" /></>,
    ft: <><path d="M14 4l6 6-12 12H2v-6z" /><path d="M14 4l3-3 3 3-3 3z" /></>,
    em: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  };
  return <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{p[k]}</svg>;
}
const LockMini = () => <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>;
const LockSm = () => <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>;
const CheckSm = () => <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12l4 4 10-10" /></svg>;

const satColor = (pct: number): string => (pct >= 75 ? "var(--warning)" : pct >= 40 ? "var(--success)" : "var(--ink-4)");

/* ── 24h × 6 任务 热力图(静态监控:合成正弦昼夜分布)── */
const HEAT_BASE = [70, 50, 42, 60, 38, 28];
function makeRow(base: number): number[] {
  const out: number[] = [];
  for (let h = 0; h < 24; h++) {
    const diurn = Math.sin(((h - 4) / 24) * 2 * Math.PI) * 25 + 15;
    out.push(Math.max(8, Math.min(95, Math.round(base + diurn + Math.sin(h * 1.7) * 6))));
  }
  return out;
}
function heatBg(v: number): string {
  if (v < 20) return "var(--surface-3)";
  if (v < 40) return "rgba(41,210,127,.4)";
  if (v < 60) return "var(--success)";
  if (v < 75) return "var(--warning)";
  if (v < 88) return "var(--brand-2)";
  return "var(--danger)";
}
const HEAT_SCALE = ["var(--surface-3)", "rgba(41,210,127,.4)", "var(--success)", "var(--warning)", "var(--brand-2)", "var(--danger)"];

const HOOKS = [
  { nm: "LLM 405B 锁定展示", ct: "3,284 →", up: false },
  { nm: "视频渲染锁定展示", ct: "1,847 →", up: false },
  { nm: "LoRA 锁定展示", ct: "912 →", up: false },
  { nm: "→ Pro v2 升级", ct: "+34", up: true },
  { nm: "→ Rack P2 升级", ct: "+8", up: true },
];

export function E2Tasks({ ctx }: { ctx: EViewCtx }) {
  const { tasks } = ctx;
  const heatNames = tasks.slice(0, 6).map((t) => t.n);

  const adj = (t: OpsTask) =>
    ctx.openActionConfirm({
      name: `任务单价调整 · ${t.n}`, op: "task-price", taskId: t.id,
      edit: { kind: "number", current: `$${t.price.toFixed(2)}`, unit: "USD" },
      detail: `当前 $${t.price.toFixed(2)}${t.unit} · 改后对新派单 server-canonical 生效,已派工单维持原单价完成`,
      amplify: false,
    });

  return (
    <>
      <EStats items={[
        { k: "24h 任务总额", v: "$184k", sub: "12,847 笔 · 全网派单", tone: "ok" },
        { k: "在线接单设备", v: "41,208", sub: "heartbeat 活跃 · 占 99.2%" },
        { k: "全网饱和度", v: "63%", sub: "峰值 78% · 19:00 UTC", tone: "warn" },
        { k: "锁定预览转化", v: "8.4%", sub: "锁定 → 升级 Pro/Rack", tone: "cyan" },
      ]} />

      <div className="e3-main">
        {/* 左:6 任务卡 */}
        <section className="pane">
          <div className="pane-h">
            <span className="ttl">{tasks.length} 类任务 · 单价 & 门槛</span>
            <span className="sub">前端 /earn 任务池映射</span>
            <span className="r"><CodeTag tone="electric">任务引擎</CodeTag><CodeTag>E.task.*</CodeTag></span>
          </div>
          <div className="task-list">
            {tasks.map((t) => {
              const k = taskKind(t.n);
              const pct = Math.round(t.sat * 100);
              const locked = t.req.includes("需");
              return (
                <div className="task" key={t.id}>
                  <span className={`ic ${k}`}><KindIcon k={k} /></span>
                  <div className="nm">{t.n}<span className="pid">{t.id}</span></div>
                  <div className="price">${t.price.toFixed(2)}<small>{t.unit}</small></div>
                  <span className={`req ${locked ? "lock" : "open"}`}>{locked && <LockMini />}{t.req}</span>
                  <div className="sat">
                    <div className="bar"><div className="f" style={{ width: `${pct}%`, background: satColor(pct) }} /></div>
                    <span className="pct">{pct}%</span>
                  </div>
                  <div className="acts">
                    <button className="primary" onClick={() => adj(t)}>改单价</button>
                    <button onClick={() => ctx.delTask({ id: t.id, n: t.n })}>下架</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 右 rail:饱和度 donut + 锁定钩子 */}
        <aside className="rail">
          <div className="donut-card">
            <div className="h">全网队列饱和度</div>
            <div className="s">动态调度 · 实时</div>
            <div className="donut-wrap">
              <svg width={180} height={180} viewBox="0 0 180 180">
                <circle className="ring-bg" cx="90" cy="90" r="74" fill="none" strokeWidth="14" />
                <circle className="ring-f" cx="90" cy="90" r="74" fill="none" strokeWidth="14" strokeDasharray="464.96" strokeDashoffset="172" />
              </svg>
              <div className="ctr"><div className="num">63<small>%</small></div><div className="lb">峰值 78%</div></div>
            </div>
            <div className="legend">
              <div className="row"><span className="dot" style={{ background: "var(--warning)" }} /><span className="nm">高负载(&gt;75%)</span><span className="pct">2 类</span></div>
              <div className="row"><span className="dot" style={{ background: "var(--success)" }} /><span className="nm">中负载(40–75%)</span><span className="pct">3 类</span></div>
              <div className="row"><span className="dot" style={{ background: "var(--ink-4)" }} /><span className="nm">低负载(&lt;40%)</span><span className="pct">1 类</span></div>
            </div>
          </div>
          <div className="hook-card">
            <div className="h">锁定预览钩子 · 24h<span className="tag">E1 转化</span></div>
            {HOOKS.map((h, i) => (
              <div className={`hook-row${h.up ? " up" : ""}`} key={i}>
                <span className="ic">{h.up ? <CheckSm /> : <LockSm />}</span>
                <span className="nm">{h.nm}</span>
                <span className="ct">{h.ct}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* 24h × 6 任务 热力图 */}
      <div className="heat-card">
        <div className="heat-h">
          <span className="ttl">24h × 6 任务 · 饱和度热力图</span>
          <span className="sub">UTC · 每小时平均</span>
          <span className="r">峰值 19:00 · LoRA 微调 92%</span>
        </div>
        <div className="heat-grid">
          {heatNames.map((nm, r) => {
            const row = makeRow(HEAT_BASE[r] ?? 40);
            return (
              <Fragment key={r}>
                <span className="lbl">{nm}</span>
                <div className="heat-row">
                  {row.map((v, h) => (
                    <div key={h} className="heat-cell" style={{ background: heatBg(v) }} title={`${nm} · ${h < 10 ? "0" + h : h}:00 UTC · ${v}%`} />
                  ))}
                </div>
              </Fragment>
            );
          })}
        </div>
        <div className="heat-axis-wrap">
          <span />
          <div className="heat-axis">{Array.from({ length: 24 }, (_, h) => <span key={h}>{h % 3 === 0 ? h : ""}</span>)}</div>
        </div>
        <div className="heat-legend">
          <span>低</span>
          <div className="scale">{HEAT_SCALE.map((c, i) => <span key={i} style={{ background: c }} />)}</div>
          <span>高</span>
          <span style={{ marginLeft: "auto" }}><AutoGloss>悬停查看小时 × 任务负载</AutoGloss></span>
        </div>
      </div>
      <p className="f-foot">高单价任务(LLM 405B / LoRA / 视频渲染)是<b>升级转化引擎</b> — 在前端 /earn 锁定展示,引导用户购买 Pro 或 Rack。任务单价改后<b>对新派单 server-canonical 生效</b>,已派工单维持原单价完成。</p>
    </>
  );
}
