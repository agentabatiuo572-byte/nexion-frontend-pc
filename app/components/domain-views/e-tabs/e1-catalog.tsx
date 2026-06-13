import { useState, type CSSProperties } from "react";
import { CodeTag, Badge } from "../design-kit";
import type { OpsSku, OpsReview } from "@/lib/store/admin/platform-config-store";
import type { EViewCtx } from "./types";
import { EStats } from "./stats";

/* ── 静态设计数据(代际门 timeline · Gen-2 发布时点;真后台由 H1 月龄 + 发布门配置下发)── */
const PHASE_ORDER = ["P1", "P2", "P3", "P4", "P5", "P6"];
const PHASES = [
  { p: "P1", meta: "L0+", skus: "Entry · NexionBox S1" },
  { p: "P2", meta: "L1+", skus: "Genesis 节点" },
  { p: "P3", meta: "L2+", skus: "Pro v2 解锁" },
  { p: "P4", meta: "L3+", skus: "Cloud Share 池" },
  { p: "P5", meta: "L4+", skus: "Rack P2 解锁" },
  { p: "P6", meta: "L6+", skus: "Flagship · 顶配" },
];
const PLATFORM_MONTH = 4; // 平台月龄 M4(真后台取 H1 月龄)
const GEN_RELEASES = [
  { id: "stellarbox-pro-v2", name: "NexionBox Pro v2", releaseMonth: 5, phase: "P3", discount: 300, eligibility: true },
  { id: "stellarrack-p2", name: "NexionRack P2", releaseMonth: 10, phase: "P5", discount: 800, eligibility: false },
];

/* ── 评价筛选 + 翻页(港口增补:设计稿无此控件;真后台 server 分页/筛选参数预留)── */
const RV_FILTERS = [
  { k: "all", label: "全部" },
  { k: "published", label: "展示中" },
  { k: "hidden", label: "已隐藏" },
] as const;
const RV_RATINGS = [
  { r: 0, label: "全部评分" },
  { r: 5, label: "5★" },
  { r: 4, label: "4★" },
  { r: 3, label: "3★" },
  { r: 2, label: "2★" },
  { r: 1, label: "1★" },
] as const;
const RV_PAGE_SIZE = 6;

// 卡 badge 视觉类按 tier 着色(text 用 sku.badge);gate 开放 = unlock phase ≤ 当前 phase。
const badgeClass = (tier?: string): string =>
  tier === "Entry" ? "popular" : tier === "Pro" ? "new" : tier === "Flagship" ? "limited" : tier === "Share" ? "share" : "new";
const yld = (s: OpsSku): string =>
  s.tier === "Share" && s.shareYieldMin != null
    ? `${s.shareYieldMin}–${s.shareYieldMax}% 年化 · ${(s.dailyEarnNEX ?? 0).toLocaleString()} NEX`
    : `$${(s.dailyEarn ?? 0).toFixed(2)}/d · ${(s.dailyEarnNEX ?? 0).toLocaleString()} NEX`;

function RackIcon() {
  return (
    <svg width={44} height={44} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10v4M11 10v4M15 10v4M19 10v4" /><circle cx="6" cy="20" r="1" /><circle cx="18" cy="20" r="1" />
    </svg>
  );
}

export function E1Catalog({ ctx }: { ctx: EViewCtx }) {
  const { skus, reviews, phaseCur } = ctx;
  const curIdx = Math.max(0, PHASE_ORDER.indexOf(phaseCur));
  const phaseIdx = (p: string): number => PHASE_ORDER.indexOf(p);

  // 评价筛选(双轴 AND:状态 全部/展示中/已隐藏 × 评分 1-5★)+ 翻页(页大小 RV_PAGE_SIZE,rvCur clamp 防缩页越界)
  const [rvFilter, setRvFilter] = useState<string>("all");
  const [rvRating, setRvRating] = useState(0); // 0 = 全部评分
  const [rvPage, setRvPage] = useState(1);
  // facet 计数:各轴计数落在「另一轴当前选择」上 —— 点选所得即所见,不误导
  const byRating = rvRating === 0 ? reviews : reviews.filter((r) => r.rating === rvRating);
  const byStatus = rvFilter === "all" ? reviews : reviews.filter((r) => r.status === rvFilter);
  const rvCount = (k: string): number => (k === "all" ? byRating.length : byRating.filter((r) => r.status === k).length);
  const rvRateCount = (rr: number): number => (rr === 0 ? byStatus.length : byStatus.filter((r) => r.rating === rr).length);
  const rvFiltered = reviews.filter((r) => (rvFilter === "all" || r.status === rvFilter) && (rvRating === 0 || r.rating === rvRating));
  const rvTotalPages = Math.max(1, Math.ceil(rvFiltered.length / RV_PAGE_SIZE));
  const rvCur = Math.min(rvPage, rvTotalPages);
  const rvRows = rvFiltered.slice((rvCur - 1) * RV_PAGE_SIZE, rvCur * RV_PAGE_SIZE);

  // 真 store 派生 stat(改 SKU 即刷新)
  const onSale = skus.filter((s) => (s.status || "on") === "on").length;
  const pending = skus.filter((s) => s.status === "pending").length;
  const gated = skus.filter((s) => phaseIdx(s.unlock) > curIdx && phaseIdx(s.unlock) >= 0).length;
  const gen2 = skus.filter((s) => (s.generation ?? 1) >= 2).length;
  const gen2Pct = skus.length ? Math.round((gen2 / skus.length) * 100) : 0;

  // 代际门连接线渐变:success 到当前节点、brand 当前段、surface-3 锁定段(随 phaseCur 动态)
  const doneEnd = Math.max(0, curIdx * 20 - 2);
  const curEnd = curIdx * 20 + 10;
  const phaseLine = `linear-gradient(90deg, var(--success) 0%, var(--success) ${doneEnd}%, var(--brand) ${doneEnd}%, var(--brand) ${curEnd}%, var(--surface-3) ${curEnd}%)`;

  const genShift = (g: typeof GEN_RELEASES[number], offset: number, delta: number) =>
    ctx.openActionConfirm({
      name: `代际发布 · ${delta < 0 ? "提前" : "延迟"} ${Math.abs(delta)} 个月 · ${g.name}`,
      op: "param", paramKey: `E.gen.${g.id}.phaseOffset`,
      edit: { kind: "number", current: String(offset), unit: "M" },
      detail: `当前计划发布月 ${g.releaseMonth}${offset ? `(偏移 ${offset}M)` : ""} · 调 phaseOffset 改发布门时点 · server-canonical,改后对发布门生效`,
      amplify: false,
    });
  const genForceUnlock = (g: typeof GEN_RELEASES[number]) => {
    if (!g.eligibility) { ctx.toast(`拒绝 · ${g.name} E5 eligibility 未补录 · server gate 不能解锁`); return; }
    ctx.openActionConfirm({
      name: `强制解锁 · ${g.name}`, op: "param-fixed", paramKey: `E.gen.${g.id}.forceUnlock`, fixedVal: "true", amplify: true,
      detail: `绕过 H1 月龄门 · coming-soon → active · E5 eligibility 已配 · 放大供给须操作确认 + A2 审计`,
    });
  };
  const genForceLock = (g: typeof GEN_RELEASES[number]) =>
    ctx.openActionConfirm({
      name: `撤销解锁 · ${g.name}`, op: "param-fixed", paramKey: `E.gen.${g.id}.forceUnlock`, fixedVal: "false", amplify: false,
      detail: `active → coming-soon · 重新纳入月龄门控 · 操作确认 + A2 审计`,
    });

  return (
    <>
      <EStats items={[
        { k: "硬件 GMV(月)", v: "$23.8M", sub: "2,847 笔订单" },
        { k: "在售 SKU", v: onSale, sub: `+ ${pending} pending 待确认`, tone: "ok" },
        { k: "Gen2 SKU 占比", v: `${gen2Pct}%`, sub: "Pro v2 · Rack P2 主力", tone: "cyan" },
        { k: "门控 SKU", v: gated, sub: "解锁需 Phase 推进", tone: "warn" },
      ]} />

      {/* 1. 代际发布门 timeline */}
      <div className="phase-bar">
        <div className="lbl">
          <span className="h">代际发布门 · H1 Phase 联动</span>
          <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>门控随 Phase 推进自动开放 · server-canonical</span>
          <span className="now"><span className="d" />当前 {phaseCur} · Pro v2 已开放</span>
        </div>
        <div className="phase-track" style={{ ["--phase-line" as string]: phaseLine } as CSSProperties}>
          {PHASES.map((ph, i) => {
            const st = i < curIdx ? "done" : i === curIdx ? "cur" : "lock";
            return (
              <div key={ph.p} className={`phase ${st}`}>
                <div className="dot">{ph.p}</div>
                <div className="nm">{ph.meta}</div>
                <div className="skus">{ph.skus}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Gen-2 发布时点表 */}
      <div className="genrel">
        <div className="genrel-h">
          <span className="ttl">Gen-2 发布时点</span>
          <span className="sub">· releaseMonth 是发布门原子 · 控制 SKU coming-soon → active</span>
          <span className="r"><CodeTag tone="electric">E.gen.releases</CodeTag><span>平台月龄 M{PLATFORM_MONTH} · {phaseCur}</span></span>
        </div>
        <div className="genrel-table">
          <div className="hd">
            <div className="c">SKU</div><div className="c">计划发布</div><div className="c">当前状态</div><div className="c">Phase</div>
            <div className="c">距发布</div><div className="c">折扣 USDT</div><div className="c">E5 eligibility 互锁</div><div className="c">动作</div>
          </div>
          {GEN_RELEASES.map((g) => {
            const offset = parseInt(ctx.pget(`E.gen.${g.id}.phaseOffset`) ?? "0", 10) || 0;
            const forced = ctx.pget(`E.gen.${g.id}.forceUnlock`) === "true";
            const eff = g.releaseMonth + offset;
            const unlocked = forced || PLATFORM_MONTH >= eff;
            const remain = eff - PLATFORM_MONTH;
            const cdCls = unlocked ? "ok" : remain <= 1 ? "warn" : "";
            const cdTxt = unlocked ? "已发布" : remain === 1 ? "下个月 · 1M" : `+ ${remain} M`;
            const relLbl = `月 ${g.releaseMonth}` + (offset ? (offset > 0 ? ` (+${offset})` : ` (${offset})`) : "");
            return (
              <div className="rw" key={g.id}>
                <div className="c sku">{g.name}<span className="id">{g.id}</span></div>
                <div className="c mono">{relLbl}</div>
                <div className="c"><span className={`st ${unlocked ? "active" : "coming"}`}>{unlocked ? "ACTIVE" : "COMING-SOON"}</span></div>
                <div className="c"><span className="phaseChip">{g.phase}</span></div>
                <div className="c"><span className={`countdown ${cdCls}`}>{cdTxt}</span></div>
                <div className="c mono">${g.discount}</div>
                <div className="c"><span className={`elg ${g.eligibility ? "ok" : "miss"}`}><span className="dot" />{g.eligibility ? "E5 已配" : "E5 未补录"}</span></div>
                <div className="c acts">
                  {unlocked ? (
                    <>
                      <button onClick={() => genShift(g, offset, 1)}>推迟 1M</button>
                      <button className="warn" onClick={() => genForceLock(g)}>撤销解锁</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => genShift(g, offset, -1)}>提前 1M</button>
                      <button onClick={() => genShift(g, offset, 1)}>延迟 1M</button>
                      <button className="brand" onClick={() => genForceUnlock(g)}>强制解锁</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="genrel-foot">
          <span><b>server gate</b> · Gen-2 SKU coming-soon → active 需同时满足 H1 月龄 + E5 eligibility 非空</span>
          <span className="sep">·</span>
          <span><b>强制解锁</b> 绕过月龄门 · 提前 / 延迟 / 撤销均走 操作确认 + A2 审计</span>
        </div>
      </div>

      {/* 3. SKU 4 卡 matrix */}
      <div className="sku-grid">
        {skus.map((s) => {
          const st = s.status || "on";
          const open = phaseIdx(s.unlock) >= 0 && phaseIdx(s.unlock) <= curIdx;
          const isShare = s.tier === "Share";
          return (
            <div key={s.name} className={`sku-card${st === "off" ? " off" : ""}`}>
              <div className="img">
                {s.badge ? <span className={`badge ${badgeClass(s.tier)}`}>{s.badge}</span> : null}
                <span className="gen">Gen {s.generation ?? 1}</span>
                <div className="ph"><RackIcon /></div>
              </div>
              <div className="body">
                <div className="top">
                  <div className="l">
                    <div className="nm">{s.name}</div>
                    {s.tagline ? <div className="tagline">{s.tagline}</div> : null}
                  </div>
                  <div className="r">
                    <div className="px">${s.price.toLocaleString()}</div>
                    <div className="yld">{yld(s)}</div>
                  </div>
                </div>
                <div className="spec">
                  <div className="it"><span className="k">GPU</span><span className="v">{s.gpu || "—"}</span></div>
                  <div className="it"><span className="k">显存</span><span className="v">{s.vram || "—"}</span></div>
                  <div className="it"><span className="k">DC</span><span className="v">{s.datacenter || "—"}</span></div>
                  <div className="it"><span className="k">特性</span><span className="v">{s.features?.[0] || s.aiUnlocks || "—"}</span></div>
                </div>
                <div className="meta">
                  {s.rating != null && <span className="rt">★ {s.rating.toFixed(1)}</span>}
                  {s.sold != null && <span className="sold">{s.sold.toLocaleString()} 售</span>}
                  {s.reviews != null && <><span>·</span><span>{s.reviews.toLocaleString()} 评价</span></>}
                  <span className={`gate ${open ? "open" : "gated"}`}>{s.unlock} · {open ? "已开放" : "门控"}</span>
                  <span className="stk">库存 {s.stock}</span>
                </div>
                <div className="acts">
                  <button className="primary" onClick={() => ctx.openSku(s.name)}>改价 / 编辑</button>
                  <button onClick={() => ctx.openActionConfirm({ name: st === "on" ? `下架 SKU · ${s.name}` : `上架 SKU · ${s.name}`, op: "sku-status", target: s.name, status: st === "on" ? "off" : "on", detail: st === "on" ? "下架后从商城隐藏,不影响已售设备结算" : "上架后对用户可见", amplify: false })}>{st === "on" ? "下架" : "上架"}</button>
                  <button className="danger" onClick={() => ctx.delSku(s.name)}>删除</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 4. 用户评价表 */}
      <div className="rv">
        <div className="rv-h">
          <span className="ttl">用户评价 · {reviews.length} 条</span>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>关联 productId · 商品详情页可见</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <CodeTag tone="electric">A2 审计</CodeTag>
            <button className="f-cta" style={{ padding: "5px 11px", fontSize: 12 }} onClick={ctx.openAddReview}>+ 新增评价</button>
          </div>
        </div>
        <div className="filter-bar">
          {RV_FILTERS.map((f) => (
            <span key={f.k} className={`fchip${rvFilter === f.k ? " on" : ""}`} onClick={() => { setRvFilter(f.k); setRvPage(1); }}>
              {f.label} {rvCount(f.k)}
            </span>
          ))}
          <span className="fdiv" aria-hidden />
          {RV_RATINGS.map((rt) => (
            <span key={rt.r} className={`fchip${rvRating === rt.r ? " on" : ""}`} onClick={() => { setRvRating(rt.r); setRvPage(1); }}>
              {rt.label}{rt.r === 0 ? "" : ` ${rvRateCount(rt.r)}`}
            </span>
          ))}
        </div>
        <div className="rv-row head"><div>商品</div><div>评价人</div><div>评分</div><div>内容</div><div>时间</div><div>状态</div><div style={{ textAlign: "right" }}>动作</div></div>
        {rvRows.length === 0 ? (
          <div className="rv-empty">当前筛选无匹配评价</div>
        ) : rvRows.map((r: OpsReview) => {
          const pname = r.productId === "*" ? "通用" : (skus.find((x) => (x.id || x.name) === r.productId)?.name ?? r.productId);
          return (
            <div key={r.id} className={`rv-row${r.status === "hidden" ? " hidden" : ""}`}>
              <div className="pid">{pname}</div>
              <div className="author">{r.author}</div>
              <div className="stars">{"★".repeat(r.rating)}<span className="e">{"★".repeat(Math.max(0, 5 - r.rating))}</span></div>
              <div className="content">{r.content}</div>
              <div className="date">{r.date}</div>
              <div><Badge tone={r.status === "published" ? "ok" : "neutral"}>{r.status === "published" ? "展示中" : "已隐藏"}</Badge></div>
              <div className="acts">
                <button onClick={() => ctx.openEditReview(r)}>编辑</button>
                <button onClick={() => ctx.toggleReview(r)}>{r.status === "published" ? "隐藏" : "恢复"}</button>
                <button onClick={() => ctx.delReview(r)}>删除</button>
              </div>
            </div>
          );
        })}
        {rvTotalPages > 1 && (
          <div className="rv-pager">
            <button className="step" disabled={rvCur <= 1} onClick={() => setRvPage(rvCur - 1)}>‹ 上一页</button>
            <span className="ind">第 <b>{rvCur}</b> / {rvTotalPages} 页 · 共 {rvFiltered.length} 条</span>
            <button className="step" disabled={rvCur >= rvTotalPages} onClick={() => setRvPage(rvCur + 1)}>下一页 ›</button>
          </div>
        )}
      </div>
      <p className="f-foot">SKU 卡片 = 前端 ProductCard 全字段镜像;前端商城与运营后台共享同一 server-canonical SKU 配置,任何上下架/改价/库存调整<b>立即对前端商城生效</b>。每条评价关联 productId · 隐藏后前端立刻不再展示。</p>
    </>
  );
}
