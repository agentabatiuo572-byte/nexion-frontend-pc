"use client";

/**
 * D5 提现参数配置 — 提现摩擦的运营杠杆生效面,两类分清(§3.14 防双源):
 *  - D5 owns 三参数(日限次数 / 余额上限 / 网络费):操作确认 + 放松方向 B1 覆盖率红线核验(amplifies);
 *  - 节奏派发三项(冷却 / 积分 / 增强合规审查):权威归 H1(/growth/phase),本页只读 + 跳转,
 *    接口层拒收(PUT 携带返 422 PHASE_PARAM_READONLY)。
 * 当前 = P3 · 月 7(PHASE 单源);月 8=35d 为 12 月节奏表权威目标值。
 */
import Link from "next/link";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { D_FUND, PHASE } from "@/lib/mock/admin/design-data";
import { OWN_PARAMS, PHASE_RO } from "./data";
import type { DCtx } from "./types";

export function D5Params({ ctx }: { ctx: DCtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;
  const cov = LEDGER.coverageRatio.toFixed(1);
  // H1 派发现值同源镜像(与 h-view 同键 H.phase.dial.<key>;H1 改 dial 本页实时跟,不缓存为权威)
  const h1 = (key: string, seed: string) => pget(`H.phase.dial.${key}`) ?? seed;
  const cooldownV = h1(PHASE_RO.cooldown.h1Key, PHASE_RO.cooldown.seed);
  const pointsV = h1(PHASE_RO.points.h1Key, PHASE_RO.points.seed);
  const holdV = h1(PHASE_RO.hold.h1Key, PHASE_RO.hold.seed);
  const holdShort = holdV.includes("未激活") || holdV === "false" ? "未激活" : holdV;

  return (
    <>
      <div className="f-stats">
        <div className="f-stat"><div className="k">今日提现申请</div><div className="v">{D_FUND.applyTodayCnt} 笔</div><div className="sub">${(D_FUND.payoutTodayUsd / 1000).toFixed(1)}K 已放行 · 队列在提现审核</div></div>
        <div className="f-stat ok"><div className="k">覆盖率(B1 · 放松前自动核验)</div><div className="v">{cov}%</div><div className="sub">红线 {LEDGER.redlinePct} · 低于红线拒绝放松</div></div>
        <div className="f-stat cyan"><div className="k">当前冷却 / 积分(H1 派发)</div><div className="v">{/^\d+$/.test(cooldownV) ? `${cooldownV}d` : cooldownV} · {/^\d+$/.test(pointsV) ? `${pointsV} 分` : pointsV}</div><div className="sub">月 8 → 35d · 月 9 → 45d + 20 分</div></div>
        <div className="f-stat warn"><div className="k">增强合规审查</div><div className="v">{holdShort}</div><div className="sub">月 8(P5 带)起自动开 · H1 派发</div></div>
      </div>

      <div className="two-col r11">
        {/* D5 owns */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">本页可调(操作确认)</span>
            <span className="sub">· 三个非节奏参数 · 放松方向要过覆盖率红线核验</span>
            <div className="r"><span className="dcode electric">实时生效 · 网络费只对新单</span></div>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {OWN_PARAMS.map((p) => {
              const cur = pget(`D.${p.key}`) ?? p.cur;
              const loosenNote = p.dir === "loosen-up"
                ? `上调是放松方向:确认时服务器核验覆盖率(当前 ${cov}% > 红线 ${LEDGER.redlinePct},可过);下调收紧不受限。`
                : `下调是放松方向:确认时服务器核验覆盖率;上调收紧不受限。`;
              return (
                <div className="p-row" key={p.key}>
                  <div className="txt">
                    <div className="k">{p.name}</div>
                    <div className="s">{p.sub}</div>
                  </div>
                  <span className="v">{cur}</span>
                  <button className="l-btn sm mc" onClick={() => openActionConfirm({
                    action: `提现参数调整 · ${p.name}`,
                    detail: <><b>{p.name}</b> · 当前 {cur} · {p.range}。{loosenNote} 改动产 admin.withdraw_limit_changed 审计,喂财务报表(L3)。</>,
                    amplifies: true,
                    edit: { kind: "text", current: cur },
                    run: (reason, v) => { if (v) setParam(`D.${p.key}`, v, { action: `提现参数调整 ${p.name}`, reason }); toast(`${p.name} 已更新为 ${v} · 放松方向已过覆盖率核验`); },
                  })}>调整</button>
                </div>
              );
            })}
            <div className="dtint ok" style={{ marginTop: 12 }}><b>红线核验怎么工作</b> · 确认放行时服务器自动检查:这次改动是放松方向(升日限、升上限、降费)且覆盖率 &lt; {LEDGER.redlinePct}% → 直接拒绝并返回当前覆盖率(422);收紧方向(降日限、降上限、升费)随时可过。</div>
          </div>
        </section>

        {/* Phase 派发只读 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">节奏派发 · 只读</span>
            <span className="sub">· 权威在 H1,按用户所处月份下发 · 这里提交会被退回(422)</span>
            <div className="r"><Link href="/growth/phase" className="l-btn">去 H1 调整 →</Link></div>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="p-row">
              <div className="txt"><div className="k">{PHASE_RO.cooldown.name} <span className="bdg dim">🔒 H1 派发</span></div><div className="s">{PHASE_RO.cooldown.sub}</div></div>
              <span className="v">{PHASE_RO.cooldown.fmt(cooldownV)}</span>
            </div>
            <div className="ph-track">
              {PHASE_RO.cooldown.segs.map(([m, v, on]) => (
                <div className={`seg${on ? " cur" : ""}`} key={m}><div className="m">{m}</div><div className="vv">{v}</div></div>
              ))}
            </div>
            <div className="p-row">
              <div className="txt"><div className="k">{PHASE_RO.points.name} <span className="bdg dim">🔒 H1 派发</span></div><div className="s">{PHASE_RO.points.sub}</div></div>
              <span className="v">{PHASE_RO.points.fmt(pointsV)}</span>
            </div>
            <div className="ph-track">
              {PHASE_RO.points.segs.map(([m, v, on]) => (
                <div className={`seg${on ? " cur" : ""}`} key={m}><div className="m">{m}</div><div className="vv">{v}</div></div>
              ))}
            </div>
            <div className="p-row">
              <div className="txt"><div className="k">{PHASE_RO.hold.name} <span className="bdg dim">🔒 H1 派发</span></div><div className="s">{PHASE_RO.hold.sub}</div></div>
              <span className="v">{PHASE_RO.hold.fmt(holdV)}</span>
            </div>
            <div className="dtint" style={{ marginTop: 10 }}><b>为什么这里改不了</b> · 这三项是 12 月节奏的派发参数,提现队列(D2)按它们判「冷却到没到、积分够不够、要不要进增强审查」。如果这页也能改,就成了两套来源打架——所以服务器在接口层直接拒收这三个字段(422 退回并指向 H1),调整一律去 H1 走操作确认,变更记录也由 H1 留(phase.dial_changed)。</div>
            <div className="dtint warn" style={{ marginTop: 10 }}><b>月 8 = 35 天的注</b> · 35 天是 12 月节奏表的权威目标值,用户端目前的简化实现里还没有这个中间档,要前端补——上线前以 35d 为准核对。当前 {PHASE.current} · 月 {PHASE.month},距月 8 拐点还有 1 个月。</div>
          </div>
        </section>
      </div>

      <p className="f-foot"><b>「提现摩擦 = 节奏参数(H1)+ 固定参数(本页)」</b>就是这页的全部分工。本页三个参数(日限次数/余额上限/网络费)改动产 <b>admin.withdraw_limit_changed</b> 审计,喂财务报表(L3);提现限额变化也会间接影响挤兑阈值,雷达(B5)在高摩擦阶段联动关注。节奏三项(冷却/积分/合规审查)的变更事件由 H1 产生(phase.dial_changed),本页只在拐点同步展示新派发值——月 8、月 9 两个拐点前运营要心里有数:展示值变了不是这页有人动了手,是节奏到点了。</p>
    </>
  );
}
