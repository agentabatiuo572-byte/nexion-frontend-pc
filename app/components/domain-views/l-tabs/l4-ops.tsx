"use client";

/**
 * L4 · 设备 / 任务 / 网络报表 — 设备规模与衰减影响 / 任务市场承接 / 团队结构(#5 #7 完整下钻)/ Phase 节奏效果。
 * 机型对齐 E1 SKU 目录;队列饱和度与 E 域同口径(63%);佣金 kind 命名对齐 F5;
 * Phase 列标签引 PHASES 权威命名(P3 扩张〔当前〕)。承接率告警线为视图阈值(普通确认批)。
 */
import { useState } from "react";
import { AutoGloss } from "@/app/components/kit/gloss";
import { confirm } from "@/lib/store/ui";
import { PaginationExemptionList } from "../design-kit";
import { KPIS } from "@/lib/mock/admin/design-data";
import { PHASES, CURRENT_PHASE } from "@/lib/mock/admin/command-center";
import { DEV_DIST, DEV_TOTAL, DEV_TILES, DECAY_SEGS, TASK_TILES, TIERS, VR_HIST, REF_DIST, COMM_DIST, TEAM_GMV, PH_ROWS } from "./data";
import { ViewParamModal, type ViewParamReq } from "./view-param-modal";
import type { LCtx } from "./types";

const k5 = KPIS[4];
const k7 = KPIS[6];
const accRate = (TASK_TILES.doneN / TASK_TILES.dispatchedN) * 100; // 57.8

export function L4HeaderActions({ ctx }: { ctx: LCtx }) {
  const exportOps = async () => {
    const ok = await confirm({
      title: "导出运营报表 CSV",
      message: "内容:设备 / 任务 / 网络 / Phase 四类运营聚合指标(按当前报表周期与 Phase 切片)。不含任何用户明细——要导含 userId 的团队树请走「操作确认」入口。",
      confirmLabel: "导出",
    });
    if (!ok) return;
    ctx.logAudit({ actor: "总管理员", action: "导出运营报表 CSV(聚合 · 无用户明细)", target: "admin.report_exported", after: "export_type=operations_agg" });
    ctx.toast("已导出运营报表 CSV · 落 admin.report_exported 审计");
  };
  const exportTree = () => ctx.openActionConfirm({
    action: "导出网络 / 团队结构明细 · 含 userId 团队树",
    detail: <><b>隐私敏感批量导出</b> · 范围:全网团队树(userId 维度直推/团队边)· 行数预估 <b>{DEV_TOTAL.toLocaleString("en-US")}</b> · 脱敏策略:userId 保留(关联键)、手机号 hash、地址截断(L5 字段级规则表)· 操作链:增长 / 只读审计(操作员)→ 超管(执行门槛)· 落 admin.report_exported(含 operator / role_gate)。</>,
    run: (reason) => {
      ctx.setParam("L.export.networkTree", "requested", { action: "团队树明细导出任务(操作确认 · PII 敏感)", reason });
      ctx.logAudit({ actor: "总管理员", action: "团队树明细导出任务创建", target: "admin.report_exported", after: `export_type=network_tree · rows≈${DEV_TOTAL.toLocaleString("en-US")} · masking=partial`, reason });
      ctx.toast("团队明细导出任务已创建 · 待操作确认(L5 可跟踪)");
    },
  });
  return (
    <>
      <span className="f-ro"><span className="d" />只读运营报表 · 设备/任务/Phase 参数这里改不了</span>
      <button className="f-cta" onClick={exportOps}>导出运营报表</button>
      <button className="l-btn mc" onClick={exportTree}>导出团队明细(操作确认)</button>
    </>
  );
}

export function L4Ops({ ctx }: { ctx: LCtx }) {
  const [accLine, setAccLine] = useState(60);
  const [vp, setVp] = useState<ViewParamReq | null>(null);
  const [period, setPeriod] = useState(1);
  const [phSlice, setPhSlice] = useState(0);
  const below = accRate < accLine;
  const devMax = Math.max(...DEV_DIST.map((d) => d.n));
  const tierMax = TIERS[0].n;
  const vrMax = Math.max(...VR_HIST);
  const refMax = Math.max(...REF_DIST.map((r) => r.n));

  return (
    <div>
      {/* stat strip */}
      <div className="f-stats">
        <div className="f-stat"><div className="k">活跃设备(在网)</div><div className="v">{DEV_TOTAL.toLocaleString("en-US")}</div><div className="sub">device.* 事件 · 周环比 +3.1%</div></div>
        <div className="f-stat ok"><div className="k">设备日产聚合</div><div className="v">{DEV_TILES.dailyUsd}</div><div className="sub">+ {DEV_TILES.dailyNex} · earnings.credited</div></div>
        <div className={"f-stat" + (below ? " warn" : " ok")}><div className="k">任务承接率</div><div className="v">{accRate.toFixed(1)}%</div><div className="sub">完成 ÷ 派发 · {below ? `低于告警线 ${accLine}%` : `高于告警线 ${accLine}%`}</div></div>
        <div className="f-stat cyan"><div className="k">佣金触发率(#7)</div><div className="v">{k7.value}%</div><div className="sub">目标 &gt; {k7.target}% · 完整下钻在本页</div></div>
      </div>

      {/* view bar */}
      <div className="view-bar">
        <div className="chips"><span className="lb">报表周期</span>
          {["日", "周度(运营周更)", "月", "自定义"].map((c, i) => (
            <button key={c} className={"chip" + (i === period ? " sel" : "")} onClick={() => { setPeriod(i); ctx.toast(`视图已切换:${c} · 仅视图,实时生效`); }}>{c}</button>
          ))}
        </div>
        <div className="sep" />
        <div className="chips"><span className="lb">Phase 切片</span>
          {["P1–P6 全量对比", `仅当前 ${CURRENT_PHASE.code}`].map((c, i) => (
            <button key={c} className={"chip" + (i === phSlice ? " sel" : "")} onClick={() => { setPhSlice(i); ctx.toast(`视图已切换:${c} · 仅视图,实时生效`); }}>{c}</button>
          ))}
        </div>
        <div className="sep" />
        <div className="chips"><span className="lb">承接率告警线</span>
          <span className="lcode">{accLine}%</span>
          <button className="l-btn sm" onClick={() => setVp({
            title: "任务承接率告警线",
            detail: "看板预警阈值(不是业务规则):承接率(完成 ÷ 派发)低于该线时,任务报表标黄提示队列饱和。任务定价与队列参数在 E 域调,这条线只影响本页显示。",
            current: accLine, unit: "%", min: 40, max: 80,
            onApply: (n) => { setAccLine(n); ctx.toast(`承接率告警线 → ${n}% · 仅视图阈值,实时生效`); },
          })}>调整</button>
        </div>
        <button className="l-btn sm" style={{ marginLeft: "auto" }} onClick={() => ctx.toast("当前周期+Phase 切片组合已保存为视图 · 不改业务规则,普通确认批")}>保存为视图</button>
        <span className="lcode lock" title="参数权威:E 域 / H1">🔒 业务参数锁定 · 设备任务归 E 域,节奏归 H1</span>
      </div>

      <div className="two-col">
        {/* (a) 设备运营 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">设备运营报表</span>
            <span className="sub">· 规模 / 代际 / 产出 / 衰减影响</span>
            <div className="r"><span className="lcode">device.* + earnings.credited</span></div>
          </div>
          <div className="l-b">
            <div className="mini-tiles">
              <div className="t"><div className="k">活跃设备</div><div className="v">{DEV_TOTAL.toLocaleString("en-US")}</div><div className="s">按首笔产出事件去重统计</div></div>
              <div className="t"><div className="k">在锁(staking 绑定)</div><div className="v">{DEV_TILES.locked.toLocaleString("en-US")}</div><div className="s">占 {((DEV_TILES.locked / DEV_TOTAL) * 100).toFixed(1)}%</div></div>
              <div className="t"><div className="k">已退役</div><div className="v">{DEV_TILES.retired.toLocaleString("en-US")}</div><div className="s">trade-in 归 E3</div></div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>按代际 × 机型分布 <span className="lcode" style={{ marginLeft: 6 }}>机型对齐 E1 商品目录</span></div>
            {DEV_DIST.map((d) => (
              <div key={d.nm} className="dist-row">
                <span className="nm"><span className="gtag">{d.gen}</span>{d.nm}</span>
                <span className="track"><i style={{ width: `${(d.n / devMax) * 100}%`, background: d.color }} /></span>
                <span className="amt">{d.n.toLocaleString("en-US")}</span>
              </div>
            ))}
            <div style={{ fontSize: 12, fontWeight: 600, margin: "14px 0 2px" }}>衰减对总产出的影响 <span className="lcode" style={{ marginLeft: 6 }} title="衰减曲线权威:E 域 device-lifecycle">🔒 衰减曲线归 E 域管,这里只看影响</span></div>
            <div className="decay-strip">
              {DECAY_SEGS.map((d) => (
                <div key={d.m} className="seg"><div className="m">{d.m}</div><div className="r" style={{ color: d.tone }}>{d.r}</div><div className="imp">{d.imp}</div></div>
              ))}
            </div>
            <div className="ltint" style={{ marginTop: 12, fontSize: 12 }}><b>解读</b> · <AutoGloss>衰减合计拖累日产 −$11.1K(−7.3%)。月 7–12 段设备占比上升中——trade-in 转化窗口,联动 E3 生命周期运营。</AutoGloss></div>
          </div>
        </section>

        {/* (b) 任务报表 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">任务报表</span>
            <span className="sub">· <AutoGloss>任务市场承接 · 定价效果归因跳 E 域任务引擎</AutoGloss></span>
            <div className="r"><span className="lcode">quest.completed + daily.checkin</span></div>
          </div>
          <div className="l-b">
            <div className="mini-tiles">
              <div className="t"><div className="k">任务完成(周)</div><div className="v">{TASK_TILES.done}</div><div className="s">quest.completed</div></div>
              <div className="t"><div className="k">承接率</div><div className="v" style={{ color: below ? "var(--warning)" : "var(--success)" }}>{accRate.toFixed(1)}%</div><div className="s">完成 ÷ 派发 · {below ? "低于告警线" : "高于告警线"}</div></div>
              <div className="t"><div className="k">队列饱和度</div><div className="v" style={{ color: "var(--warning)" }}>{TASK_TILES.saturation}</div><div className="s">排队拥挤程度 · 与 E 域同口径,参数归 E 域</div></div>
              <div className="t"><div className="k">签到活跃(日)</div><div className="v">{TASK_TILES.checkin}</div><div className="s">daily.checkin</div></div>
              <div className="t"><div className="k">派发量(周)</div><div className="v">{TASK_TILES.dispatched}</div><div className="s">派发给市场的任务总量</div></div>
              <div className="t"><div className="k">tier 均奖励</div><div className="v">{TASK_TILES.tierAvg}</div><div className="s">🔒 定价归 E 域,这里只看</div></div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>按 6 类任务 tier 分布(完成量)</div>
            {TIERS.map((t) => (
              <div key={t.nm} className="dist-row">
                <span className="nm"><AutoGloss>{t.nm}</AutoGloss></span>
                <span className="track"><i style={{ width: `${(t.n / tierMax) * 100}%`, background: t.color }} /></span>
                <span className="amt">{(t.n / 1000).toFixed(0)}K · <span style={{ color: t.acc < accLine ? "var(--warning)" : "var(--success)" }}>承接 {t.acc}%</span></span>
              </div>
            ))}
            <div className="ltint warn" style={{ marginTop: 12, fontSize: 12 }}><b>承接率 {accRate.toFixed(1)}% {below ? "<" : "≥"} {accLine}% 告警线{below ? "(黄)" : ""}</b> · <AutoGloss>tier-5/6 高价值任务承接显著不足(队列饱和 63%)——市场端供给跟不上派发节奏,定价调整入口归 E 域任务引擎(本页只观察,不改价)。</AutoGloss></div>
          </div>
        </section>
      </div>

      {/* (c) 网络/团队结构 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">网络 / 团队结构报表</span>
          <span className="sub">· <AutoGloss>团队关系归 F 域管,这里只汇总 · KPI #5 推广率和 #7 佣金触发率点进来就是看这里</AutoGloss></span>
          <div className="r"><span className="bdg cyan">#5 下钻</span><span className="bdg cyan">#7 下钻</span><span className="lcode">commission.paid</span></div>
        </div>
        <div className="l-b">
          <div className="net-grid">
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>V-Rank 层级分布(13 阶)</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-4)" }}>🔒 晋升门槛归 F 域 · V6 以上的头部集中度会同步给风险雷达</div>
              <div className="vr-hist">
                {VR_HIST.map((v, i) => (
                  <div key={i} className={"b" + (i >= 6 ? " hl" : "")}>
                    <span className="ct">{v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v}</span>
                    <i style={{ height: `${Math.max((v / vrMax) * 100, 2)}%` }} />
                    <span className="lb">V{i}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>直推 / 团队规模分布</div>
              {REF_DIST.map((r) => (
                <div key={r.nm} className="dist-row tight">
                  <span className="nm">{r.nm}</span>
                  <span className="track"><i style={{ width: `${(r.n / refMax) * 100}%`, background: r.color }} /></span>
                  <span className="amt">{r.n.toLocaleString("en-US")}</span>
                </div>
              ))}
              <div className="ltint" style={{ marginTop: 10, fontSize: 11.5 }}><b>#5 推广率 {k5.value}%</b>(达标)· <AutoGloss>设备持有者 {DEV_TOTAL.toLocaleString("en-US")} 人中 17,103 人发出过邀请。</AutoGloss></div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>佣金触发结构 / 团队 GMV <span className="lcode" style={{ marginLeft: 4 }}>kind 对齐 F5</span></div>
              {COMM_DIST.map((c) => (
                <div key={c.nm} className="dist-row tight">
                  <span className="nm"><AutoGloss>{c.nm}</AutoGloss></span>
                  <span className="track"><i style={{ width: `${c.pct}%`, background: c.color }} /></span>
                  <span className="amt">{c.pct}%</span>
                </div>
              ))}
              <div className="dist-row tight" style={{ borderTop: "1px dashed var(--border)", marginTop: 4, paddingTop: 8 }}>
                <span className="nm" style={{ fontWeight: 600, color: "var(--ink-2)" }}>团队 GMV 贡献</span><span />
                <span className="amt" style={{ fontWeight: 700, color: "var(--ink)" }}>{TEAM_GMV}</span>
              </div>
              <div className="ltint warn" style={{ marginTop: 10, fontSize: 11.5 }}><b>#7 触发率 {k7.value}%</b>(未达 {k7.target}%)· <AutoGloss>缺口集中在「直推后 7 天未发生首单」段——首单激励文案归 I 域,佣金事件审计归 F5。</AutoGloss></div>
            </div>
          </div>
        </div>
      </section>

      {/* (d) Phase 节奏效果 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">Phase 节奏效果报表</span>
          <span className="sub">· <AutoGloss>P1–P6 各阶段效果对比 + 切换前后的跳变 · 和节奏看板读同一份数据,不二手转抄</AutoGloss></span>
          <div className="r"><span className="lcode lock" title="dial 参数权威归 H1">🔒 节奏旋钮归 H1 管,这里只看效果不看参数</span></div>
        </div>
        <div className="l-b">
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl ph-tbl" style={{ minWidth: 860 }}>
              <thead><tr>
                <th>指标 \ Phase</th>
                {PHASES.map((p, i) => (
                  <th key={p.code} className={i === 2 ? "cur" : undefined} style={{ textAlign: "center" }}>
                    {p.code} {p.name}{i === 2 ? "(当前)" : i > 2 ? "(计划)" : ""}
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {PH_ROWS.map((r) => (
                  <tr key={r.nm}>
                    <td style={{ fontWeight: 600, color: "var(--ink)" }}><AutoGloss>{r.nm}</AutoGloss></td>
                    {r.vals.map((v, i) => (
                      <td key={i} className={"pv" + (i === 2 ? " cur" : "")}>
                        {v}{r.steps[i] && <span className={"stp " + (r.steps[i].startsWith("-") ? "dn" : "up")}>{r.steps[i]}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="xd-foot">
            <span className="ltint" style={{ flex: 1, minWidth: 260, fontSize: 12 }}><b>P2→P3 切换阶跃</b> · <AutoGloss>留存 −2.8pt / 首购 CVR +0.6pt / 提现量 −18%——扩张期预期内表现(拉新放量稀释留存 + 提现冷却拉长至 30d 压提现量)。dial 调整的效果归因 →</AutoGloss></span>
            <button className="l-btn sm" onClick={() => ctx.toast("跳 B4 节奏状态(实时概览,同一份数据)· 原型占位")}>B4 节奏状态</button>
            <button className="l-btn sm" onClick={() => ctx.toast("跳 H1 Phase 调度(节奏参数在那里调)· 原型占位")}>H1 Phase 调度</button>
          </div>
        </div>
      </section>

      <p className="f-foot"><b>L4 没有任何「写数据」动作</b>:<AutoGloss>设备规格、衰减曲线、任务定价归 E 域,节奏参数归 H1,团队结构归 F 域——本页只读聚合,发现问题跳对应域处理。任务完成与签到由服务端判定(抽奖类奖励也是服务端掷签,客户端伪造无效)。</AutoGloss><b>导出分两档</b>:<AutoGloss>聚合运营指标(无用户明细)仍需操作确认、落</AutoGloss> <b>admin.report_exported</b> <AutoGloss>审计;</AutoGloss><b>网络/团队结构明细含 userId 维度团队树 = 隐私敏感</b>,<AutoGloss>必须操作确认(增长/只读审计执行门槛:超管)。Phase 效果和节奏看板读的是同一份事件数据:那边看实时,这边看跨阶段历史对比,不会出现两套数字。</AutoGloss></p>
      <PaginationExemptionList
        items={[
          {
            label: "Phase 节奏效果报表",
            kind: "fixed-matrix",
            maxRows: 6,
            reason: "六阶段运营效果表需同屏横向比较阶段差异",
          },
        ]}
      />

      {vp && <ViewParamModal req={vp} onClose={() => setVp(null)} />}
    </div>
  );
}
