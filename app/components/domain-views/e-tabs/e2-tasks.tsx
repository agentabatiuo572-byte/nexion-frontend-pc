import { useMemo, useState, type ReactNode } from "react";
import { Btn, CodeTag } from "../design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { EViewCtx } from "./types";
import type { OpsTask } from "@/lib/admin/platform-types";
import { EStats } from "./stats";

/* ── 任务类型 → 图标 kind(单一真源:taskClass 权威枚举 ↔ 图标)── */
type Kind = "llm" | "img" | "vid" | "ft" | "em" | "unknown";
const KIND_ORDER: Kind[] = ["llm", "img", "vid", "ft", "em", "unknown"];
const KIND_LABEL: Record<Kind, string> = { llm: "LLM 推理", img: "图像生成", vid: "视频渲染", ft: "微调", em: "Embedding", unknown: "未返回类型" };
// 新增/编辑任务弹窗的 taskClass 权威枚举 → 图标 kind(与 e-view.tsx 抽屉 select 同源)。
const CLASS_TO_KIND: Record<string, Exclude<Kind, "unknown">> = { "llm-inference": "llm", "image-gen": "img", "video-render": "vid", "fine-tune": "ft", "embedding": "em" };

function taskKindOf(t: OpsTask): Kind {
  if (t.taskClass && CLASS_TO_KIND[t.taskClass]) return CLASS_TO_KIND[t.taskClass];
  return "unknown";
}

function KindIcon({ k }: { k: Kind }) {
  const p: Record<Kind, ReactNode> = {
    llm: <><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /><circle cx="12" cy="12" r="3" /></>,
    img: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></>,
    vid: <><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3z" /></>,
    ft: <><path d="M14 4l6 6-12 12H2v-6z" /><path d="M14 4l3-3 3 3-3 3z" /></>,
    em: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    unknown: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.7 2.7 0 015 1.4c0 1.9-2.5 2.1-2.5 3.6" /><path d="M12 17h.01" /></>,
  };
  return <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{p[k]}</svg>;
}
const LockMini = () => <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>;
const LockSm = () => <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>;
const CheckSm = () => <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12l4 4 10-10" /></svg>;

const satColor = (pct: number): string => (pct >= 75 ? "var(--warning)" : pct >= 40 ? "var(--success)" : "var(--ink-4)");

function heatBg(v: number): string {
  if (v < 20) return "var(--surface-3)";
  if (v < 40) return "rgba(41,210,127,.4)";
  if (v < 60) return "var(--success)";
  if (v < 75) return "var(--warning)";
  if (v < 88) return "var(--brand-2)";
  return "var(--danger)";
}

function money(value: number) {
  return `$${value.toFixed(value >= 10 ? 0 : 2)}`;
}
function amount(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

const LIST_PAGE_SIZE = 6;   // 任务列表每页行数

export function E2Tasks({ ctx }: { ctx: EViewCtx }) {
  const { tasks } = ctx;

  // ── 任务列表:分类筛选 + 翻页(纯视图态)──
  const [filterKind, setFilterKind] = useState<"all" | Kind>("all");
  const [page, setPage] = useState(1);

  // 每个任务的 kind(真源 taskClass)— 列表筛选/图标/计数共用,单点派生。
  const kindMap = useMemo(() => new Map(tasks.map((t) => [t.id, taskKindOf(t)])), [tasks]);
  const kindCount = (k: Kind): number => tasks.reduce((acc, t) => acc + (kindMap.get(t.id) === k ? 1 : 0), 0);
  const tasksWithSat = tasks.filter((t): t is OpsTask & { sat: number } => t.sat != null && Number.isFinite(t.sat));
  const avgPrice = tasks.length ? tasks.reduce((sum, t) => sum + t.price, 0) / tasks.length : 0;
  const avgSat = tasksWithSat.length ? Math.round((tasksWithSat.reduce((sum, t) => sum + t.sat, 0) / tasksWithSat.length) * 100) : null;
  const peakTask = [...tasksWithSat].sort((a, b) => b.sat - a.sat)[0];
  const maxPriceTask = [...tasks].sort((a, b) => b.price - a.price)[0];
  const queueRank = [...tasksWithSat].sort((a, b) => b.sat - a.sat).slice(0, 5);
  const donutOffset = avgSat == null ? 464.96 : 464.96 * (1 - avgSat / 100);

  const filtered = filterKind === "all" ? tasks : tasks.filter((t) => kindMap.get(t.id) === filterKind);
  const totalPages = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  const curPage = Math.min(page, totalPages);   // clamp 防筛选/缩页越界
  const pageRows = filtered.slice((curPage - 1) * LIST_PAGE_SIZE, curPage * LIST_PAGE_SIZE);

  // donut 负载分布(派生,与任务列表同源,随增删自动同步)。
  const hiLoad = tasksWithSat.filter((t) => t.sat >= 0.75).length;
  const loLoad = tasksWithSat.filter((t) => t.sat < 0.40).length;
  const midLoad = tasksWithSat.length - hiLoad - loLoad;

  return (
    <>
      <EStats items={[
        { k: "任务类型", v: tasks.length, sub: ctx.e2Loading ? "同步中" : ctx.e2Error ? "同步异常" : "已同步", tone: "ok" },
        { k: "平均单价", v: money(avgPrice), sub: tasks.length ? `${tasks.length} 类任务均价` : "暂无任务" },
        { k: "平均饱和度", v: avgSat == null ? "—" : `${avgSat}%`, sub: peakTask ? `最高 ${Math.round(peakTask.sat * 100)}% · ${peakTask.n}` : "后端未返回饱和度", tone: avgSat != null && avgSat >= 75 ? "warn" : "cyan" },
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
              const k = kindMap.get(t.id) ?? "unknown";
              const pct = t.sat == null ? null : Math.round(t.sat * 100);
              const reqLabel = t.req || "未返回门槛";
              const locked = t.req.includes("需");
              return (
                <div className="task" key={t.id}>
                  <span className={`ic ${k}`}><KindIcon k={k} /></span>
                  <div className="nm">{t.n}<span className="pid">{t.id}</span></div>
                  <div className="price">${t.price.toFixed(2)}<small>{t.unit}</small></div>
                  <span className={`req ${locked ? "lock" : "open"}`}>{locked && <LockMini />}{reqLabel}</span>
                  <div className="sat">
                    <div className="bar">{pct == null ? null : <div className="f" style={{ width: `${pct}%`, background: satColor(pct) }} />}</div>
                    <span className="pct">{pct == null ? "—" : `${pct}%`}</span>
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
              <div className="ctr"><div className="num">{avgSat == null ? "—" : avgSat}<small>{avgSat == null ? "" : "%"}</small></div><div className="lb">{peakTask ? `峰值 ${Math.round(peakTask.sat * 100)}%` : "后端未返回饱和度"}</div></div>
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

      {/* 任务饱和度快照:只使用任务接口返回的当前 sat 字段,不在前端合成 24h 曲线。 */}
      <div className="heat-card">
        <div className="heat-h">
          <span className="ttl">任务饱和度快照</span>
          <span className="sub">来自后端任务接口 · 当前队列饱和度</span>
          {peakTask && <span className="r">最高 · {peakTask.n} {Math.round(peakTask.sat * 100)}%</span>}
        </div>
        <div className="heat-zones">
          <div className="heat-zone">
              <div className="zone-h">
                <span className="z-ttl">任务队列</span>
                <span className="z-sub">{tasks.length} 任务</span>
              </div>
              <div className="heat-grid">
                {tasks.map((t) => {
                  const pct = t.sat == null ? null : Math.max(0, Math.min(100, Math.round(t.sat * 100)));
                  return (
                    <div key={t.id} style={{ display: "contents" }}>
                      <span className="lbl" title={t.n}>{t.n}</span>
                      <div className="heat-row" title={pct == null ? `${t.n} · 后端未返回饱和度` : `${t.n} · 当前饱和度 ${pct}%`}>
                        {pct == null
                          ? <span className="muted tiny">未返回</span>
                          : <div className="heat-cell" style={{ background: heatBg(pct), width: `${Math.max(3, pct)}%`, minWidth: 10 }} />}
                      </div>
                    </div>
                  );
                })}
              </div>
          </div>
        </div>
        <div className="heat-legend">
          <span>当前饱和度来自 /api/admin/devices/tasks 的 sat 字段</span>
          <span style={{ marginLeft: "auto" }}><AutoGloss>需要小时级曲线时应由后端返回时间序列</AutoGloss></span>
        </div>
      </div>
      <p className="f-foot">当前最高单价任务{maxPriceTask ? `「${maxPriceTask.n}」` : "暂无"}、最高负载任务{peakTask ? `「${peakTask.n}」` : "暂无"}会驱动 /earn 任务池展示。任务单价改后<b>对新派单 server-canonical 生效</b>,已派工单维持原单价完成。</p>
    </>
  );
}
