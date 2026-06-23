import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Btn, CodeTag } from "../design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { EViewCtx } from "./types";
import type { OpsTask } from "@/lib/store/admin/platform-config-store";
import { EStats } from "./stats";

/* ── 任务类型 → 图标 kind(单一真源:taskClass 权威枚举 ↔ 图标)── */
type Kind = "llm" | "img" | "vid" | "ft" | "em";
const KIND_ORDER: Kind[] = ["llm", "img", "vid", "ft", "em"];
const KIND_LABEL: Record<Kind, string> = { llm: "LLM 推理", img: "图像生成", vid: "视频渲染", ft: "微调", em: "Embedding" };
// 新增/编辑任务弹窗的 taskClass 权威枚举 → 图标 kind(与 e-view.tsx 抽屉 select 同源)。
const CLASS_TO_KIND: Record<string, Kind> = { "llm-inference": "llm", "image-gen": "img", "video-render": "vid", "fine-tune": "ft", "embedding": "em" };

/* 种子任务无持久化 config 时,按任务名推断 kind(seed 命名与类型一一对应)。 */
function kindByName(n: string): Kind {
  if (/llm|405b|70b|推理/i.test(n)) return "llm";
  if (/图像|image|sdxl|img/i.test(n)) return "img";
  if (/视频|渲染|video|vid/i.test(n)) return "vid";
  if (/微调|lora|ft|fine/i.test(n)) return "ft";
  if (/embed|em\b|嵌入/i.test(n)) return "em";
  return "llm";
}
/* 任务 kind 真源:优先读后台权威 taskClass(E.task.{id}.config),回退种子命名推断。
   修复点:此前图标只按名称正则推断,新增任务名不匹配正则 → 图标与所选 taskClass 不一致。 */
function taskKindOf(t: OpsTask, pget: (k: string) => string | undefined): Kind {
  try {
    const raw = pget(`E.task.${t.id}.config`);
    if (raw) {
      const cfg = JSON.parse(raw) as { taskClass?: string };
      if (cfg.taskClass && CLASS_TO_KIND[cfg.taskClass]) return CLASS_TO_KIND[cfg.taskClass];
    }
  } catch { /* 种子任务无 config,落回名称推断 */ }
  return kindByName(t.n);
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

/* ── 24h 饱和度热力图(静态监控:合成正弦昼夜分布;base 由任务 sat 派生,口径单源)── */
// base ≈ sat*100 − 12(夹 12–80),复刻原 6 任务观感并对任意任务数泛化。
const heatBase = (sat: number): number => Math.max(12, Math.min(80, Math.round(sat * 100) - 12));
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
const HEAT_PER_ZONE = 6;   // 每个热力图区域最多 6 个任务,超出新增区域

function money(value: number) {
  return `$${value.toFixed(value >= 10 ? 0 : 2)}`;
}
function amount(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

const LIST_PAGE_SIZE = 6;   // 任务列表每页行数

export function E2Tasks({ ctx }: { ctx: EViewCtx }) {
  const { tasks, pget } = ctx;

  // ── 任务列表:分类筛选 + 翻页(纯视图态)──
  const [filterKind, setFilterKind] = useState<"all" | Kind>("all");
  const [page, setPage] = useState(1);

  // 每个任务的 kind(真源 taskClass)— 列表筛选/图标/计数共用,单点派生。
  const kindMap = useMemo(() => new Map(tasks.map((t) => [t.id, taskKindOf(t, pget)])), [tasks, pget]);
  const kindCount = (k: Kind): number => tasks.reduce((acc, t) => acc + (kindMap.get(t.id) === k ? 1 : 0), 0);

  const filtered = filterKind === "all" ? tasks : tasks.filter((t) => kindMap.get(t.id) === filterKind);
  const totalPages = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  const curPage = Math.min(page, totalPages);   // clamp 防筛选/缩页越界
  const pageRows = filtered.slice((curPage - 1) * LIST_PAGE_SIZE, curPage * LIST_PAGE_SIZE);

  // ── 热力图:全部任务按每区域 ≤6 切区域(网络级监控,不随列表筛选)──
  const zones = useMemo(() => {
    const out: OpsTask[][] = [];
    for (let i = 0; i < tasks.length; i += HEAT_PER_ZONE) out.push(tasks.slice(i, i + HEAT_PER_ZONE));
    return out;
  }, [tasks]);

  // 全网峰值(派生,不硬编码):遍历各任务合成行取最大。
  const peak = useMemo(() => {
    let pct = 0, hour = 0, name = "";
    for (const t of tasks) {
      const row = makeRow(heatBase(t.sat));
      for (let h = 0; h < 24; h++) if (row[h] > pct) { pct = row[h]; hour = h; name = t.n; }
    }
    return { pct, hour, name };
  }, [tasks]);

  // donut 负载分布(派生,与任务列表同源,随增删自动同步)。
  const hiLoad = tasks.filter((t) => t.sat >= 0.75).length;
  const loLoad = tasks.filter((t) => t.sat < 0.40).length;
  const midLoad = tasks.length - hiLoad - loLoad;

  return (
    <>
      <EStats items={[
        { k: "任务类型", v: tasks.length, sub: ctx.e2Loading ? "同步中" : ctx.e2Error ? "同步异常" : "已同步", tone: "ok" },
        { k: "平均单价", v: money(avgPrice), sub: tasks.length ? `${tasks.length} 类任务均价` : "暂无任务" },
        { k: "平均饱和度", v: `${avgSat}%`, sub: peakTask ? `最高 ${Math.round(peakTask.sat * 100)}% · ${peakTask.n}` : "暂无队列", tone: avgSat >= 75 ? "warn" : "cyan" },
        { k: "最高单价任务", v: money(maxPriceTask?.price ?? 0), sub: maxPriceTask?.n ?? "暂无任务", tone: "cyan" },
      ]} />

      {/* 手机算力档位收益 —— 手机端按校准能力分 5 档,每档日产 USDT/NEX 运营可调 */}
      <section className="pane">
        <div className="pane-h">
          <span className="ttl">手机算力档位收益 · 5 档</span>
        </div>
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {ctx.phoneTiers.length === 0 && !ctx.e2Loading ? <div className="tint tiny">暂无手机档位数据。</div> : ctx.phoneTiers.map((t) => {
            const u = amount(t.dailyUsdt);
            const n = amount(t.dailyNex);
            return (
              <div key={t.tier} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 14, alignItems: "center", paddingTop: t.tier === 1 ? 0 : 10, borderTop: t.tier === 1 ? "none" : "1px solid var(--border)" }}>
                <span style={{ minWidth: 40, height: 26, padding: "0 8px", borderRadius: 7, background: "var(--brand-soft)", color: "var(--brand)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, fontFamily: "var(--mono)" }}>T{t.tier}</span>
                <div className="col" style={{ gap: 2 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{t.name}</span>
                  <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{t.note}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="tnum" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>${u}<span style={{ fontSize: 11, color: "var(--ink-4)", fontWeight: 400 }}> /天</span></div>
                  <div className="tnum" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{n} NEX/天</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <Btn sm variant="primary" onClick={() => ctx.openActionConfirm({
                    name: `手机 T${t.tier} 日产 USDT 调整`, op: "phone-tier", phoneTier: t.tier, phoneField: "dailyUsdt", amplify: true,
                    edit: { kind: "text", current: u, unit: "USDT/天" },
                    detail: `手机算力 T${t.tier}(${t.name})· 日产 USDT 当前 $${u} · 调高为放大资金流出,须核验 B1 覆盖率;改后对下一结算周期生效,不回溯已计提。`,
                  })}>调 USDT</Btn>
                  <Btn sm onClick={() => ctx.openActionConfirm({
                    name: `手机 T${t.tier} 日产 NEX 调整`, op: "phone-tier", phoneTier: t.tier, phoneField: "dailyNex", amplify: true,
                    edit: { kind: "text", current: n, unit: "NEX/天" },
                    detail: `手机算力 T${t.tier}(${t.name})· 日产 NEX 当前 ${n} · NEX 派发为资金流出,受 B1 覆盖率约束;改后对下一结算周期生效。`,
                  })}>调 NEX</Btn>
                </div>
              </div>
            );
          })}
        </div>
        <div className="tint cyan tiny" style={{ margin: "0 16px 14px" }}>
          <AutoGloss>这 5 档就是用户 App 手机算力卡片上显示的每日收益,在这里改就等于改用户端看到的数字。把某一档调高 = 平台多发钱,提交时系统会先核对资金覆盖率(B1)够不够,不够会被拦下。改动从下一个结算周期开始算,之前已经发给用户的收益不会变。T3 是典型机型,对应营销文案里说的 </AutoGloss><span className="nowrap">$0.06/天</span>。
        </div>
      </section>

      <div className="e3-main">
        {/* 左:任务列表(分类筛选 + 翻页) */}
        <section className="pane">
          <div className="pane-h">
            <span className="ttl">任务列表</span>
            <span className="tcount">共 {tasks.length} 个{filterKind !== "all" ? ` · 筛选 ${filtered.length}` : ""}</span>
            <span className="sub">前端 /earn 任务池映射</span>
            <span className="r"><CodeTag tone="electric">任务引擎</CodeTag><CodeTag>E.task.*</CodeTag></span>
          </div>
          <div className="filter-bar">
            <span className={`fchip${filterKind === "all" ? " on" : ""}`} onClick={() => { setFilterKind("all"); setPage(1); }}>全部 {tasks.length}</span>
            <span className="fdiv" aria-hidden />
            {KIND_ORDER.map((k) => (
              <span key={k} className={`fchip${filterKind === k ? " on" : ""}`} onClick={() => { setFilterKind(k); setPage(1); }}>
                {KIND_LABEL[k]} {kindCount(k)}
              </span>
            ))}
          </div>
          <div className="task-list">
            {pageRows.length === 0 ? (
              <div className="rv-empty">当前分类无匹配任务</div>
            ) : pageRows.map((t) => {
              const k = kindMap.get(t.id) ?? "llm";
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
                    <button className="primary" onClick={() => ctx.openEditTask(t)}>编辑</button>
                    <button onClick={() => ctx.delTask({ id: t.id, n: t.n })}>下架</button>
                  </div>
                </div>
              );
            })}
          </div>
          {totalPages > 1 && (
            <div className="rv-pager">
              <button className="step" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>‹ 上一页</button>
              <span className="ind">第 <b>{curPage}</b> / {totalPages} 页 · 共 {filtered.length} 个</span>
              <button className="step" disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)}>下一页 ›</button>
            </div>
          )}
        </section>

        {/* 右 rail:饱和度 donut + 锁定钩子 */}
        <aside className="rail">
          <div className="donut-card">
            <div className="h">全网队列饱和度</div>
            <div className="s">当前均值</div>
            <div className="donut-wrap">
              <svg width={180} height={180} viewBox="0 0 180 180">
                <circle className="ring-bg" cx="90" cy="90" r="74" fill="none" strokeWidth="14" />
                <circle className="ring-f" cx="90" cy="90" r="74" fill="none" strokeWidth="14" strokeDasharray="464.96" strokeDashoffset={donutOffset} />
              </svg>
              <div className="ctr"><div className="num">{avgSat}<small>%</small></div><div className="lb">{peakTask ? `峰值 ${Math.round(peakTask.sat * 100)}%` : "暂无队列"}</div></div>
            </div>
            <div className="legend">
              <div className="row"><span className="dot" style={{ background: "var(--warning)" }} /><span className="nm">高负载(&gt;75%)</span><span className="pct">{hiLoad} 类</span></div>
              <div className="row"><span className="dot" style={{ background: "var(--success)" }} /><span className="nm">中负载(40–75%)</span><span className="pct">{midLoad} 类</span></div>
              <div className="row"><span className="dot" style={{ background: "var(--ink-4)" }} /><span className="nm">低负载(&lt;40%)</span><span className="pct">{loLoad} 类</span></div>
            </div>
          </div>
          <div className="hook-card">
            <div className="h">任务负载排行<span className="tag">实时</span></div>
            {queueRank.length === 0 ? <div className="tint tiny">暂无任务排行</div> : queueRank.map((task) => (
              <div className={`hook-row${task.req.includes("需") ? "" : " up"}`} key={task.id}>
                <span className="ic">{task.req.includes("需") ? <LockSm /> : <CheckSm />}</span>
                <span className="nm">{task.n}</span>
                <span className="ct">{Math.round(task.sat * 100)}% · {money(task.price)}{task.unit}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* 24h 任务饱和度热力图 —— 每区域最多 6 任务,超出新增区域,每行 2-3 区域随页面缩放自适应 */}
      <div className="heat-card">
        <div className="heat-h">
          <span className="ttl">24h 任务饱和度热力图</span>
          <span className="sub">每区域最多 6 任务 · UTC 每小时平均</span>
          {peak.name && <span className="r">峰值 {peak.hour < 10 ? "0" + peak.hour : peak.hour}:00 · {peak.name} {peak.pct}%</span>}
        </div>
        <div className="heat-zones">
          {zones.map((zone, zi) => (
            <div className="heat-zone" key={zi}>
              <div className="zone-h">
                <span className="z-ttl">区域 {zi + 1}</span>
                <span className="z-sub">{zone.length} 任务</span>
              </div>
              <div className="heat-grid">
                {zone.map((t) => {
                  const row = makeRow(heatBase(t.sat));
                  return (
                    <Fragment key={t.id}>
                      <span className="lbl" title={t.n}>{t.n}</span>
                      <div className="heat-row">
                        {row.map((v, h) => (
                          <div key={h} className="heat-cell" style={{ background: heatBg(v) }} title={`${t.n} · ${h < 10 ? "0" + h : h}:00 UTC · ${v}%`} />
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
            </div>
          ))}
        </div>
        <div className="heat-legend">
          <span>低</span>
          <div className="scale">{HEAT_SCALE.map((c, i) => <span key={i} style={{ background: c }} />)}</div>
          <span>高</span>
          <span style={{ marginLeft: "auto" }}><AutoGloss>悬停查看小时 × 任务负载</AutoGloss></span>
        </div>
      </div>
      <p className="f-foot">当前最高单价任务{maxPriceTask ? `「${maxPriceTask.n}」` : "暂无"}、最高负载任务{peakTask ? `「${peakTask.n}」` : "暂无"}会驱动 /earn 任务池展示。任务单价改后<b>对新派单 server-canonical 生效</b>,已派工单维持原单价完成。</p>
    </>
  );
}
