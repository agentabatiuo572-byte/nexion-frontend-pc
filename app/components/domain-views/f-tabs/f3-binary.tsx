"use client";

/** F3 · 双轨结算引擎 —— 平衡匹配公式 hero(Track A / min×10% MATCH / Track B)+ 用户当日结算 A/B bar + 门槛/比例/自动安置 配置卡。
 *  贯穿口径:server-canonical · 放大流出→amplifies · 不回溯已计提 · 日封顶只读(权威归 H1)。 */
import { Badge, CodeTag } from "../design-kit";
import { BINARY, BINARY_MAX_AB } from "./data";
import type { FViewCtx } from "./types";

const usd = (n: number): string => "$" + n.toLocaleString();

export function F3Binary({ ctx }: { ctx: FViewCtx }) {
  const thEff = ctx.pget("F.binary.threshold") ?? "$1,000 / 轨";
  const rateEff = ctx.pget("F.binary.matchRate") ?? "10%";
  const spillOn = ctx.pget("F.binary.spillover") !== "已关闭";  // 默认启用,仅显式写入「已关闭」才关(显示值=写入值,防自由文本错配)
  const resetEff = ctx.pget("F.binary.gvResetCron") ?? "每月 1 日 00:00 UTC";
  return (
    <>
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">今日 Balance Match</div><div className="v">$10,490</div><div className="sub">4 用户参与结算</div></div>
        <div className="f-stat"><div className="k">参与结算用户</div><div className="v">1,842</div><div className="sub">两轨均 ≥ $1k 阈值</div></div>
        <div className="f-stat warn"><div className="k">阻塞用户(轨不平衡)</div><div className="v">468</div><div className="sub">单轨 &lt; $1k 门槛</div></div>
        <div className="f-stat cyan"><div className="k">沉淀池(未匹配)</div><div className="v">$1.2M</div><div className="sub">月底归零 · 不结转</div></div>
      </div>

      <div className="f3-hero">
        <section className="pane">
          <div className="pane-h"><span className="ph-ttl">平衡匹配公式</span><span className="ph-sub">服务端权威 · 每日结算窗口</span><span className="ph-r" style={{ marginLeft: "auto" }}><CodeTag tone="electric">双轨结算</CodeTag></span></div>
          <div className="formula">
            <div className="track a"><div className="nm">TRACK A · 左轨</div><div className="gv">$84,000</div><div className="meta">较大侧 · 自动安置流入<br />本期累计 GV(月初归零)</div></div>
            <div className="balance">
              <div className="op">min</div>
              <div className="fx"><div className="l">MATCH 10%</div><div className="v">$6,200</div><div className="u">today · usr_31E8</div></div>
              <div className="op">× 10%</div>
            </div>
            <div className="track b"><div className="nm">TRACK B · 右轨</div><div className="gv">$62,000</div><div className="meta">较小侧 · <b>结算基数</b><br />min(A,B) 决定匹配上限</div></div>
          </div>
          <div className="formula-foot">
            <span className="mono">balanceMatch = min(A, B) × <b>matchRate</b></span>
            <span className="sep">·</span>
            <span><b>matchRate = 10%</b></span>
            <span className="sep">·</span>
            <span className="mono">trackMinUsd = $1,000 / 轨</span>
            <span className="sep">·</span>
            <span className="mono">改后对下一周期结算生效</span>
          </div>
        </section>

        <section className="pane cap-card">
          <div className="pane-h"><span className="ph-ttl">双轨日封顶</span><span className="ph-sub">左右两轨每日计酬上限</span><span className="ph-r" style={{ marginLeft: "auto" }}><CodeTag tone="cyan">H1 派发 · 只读</CodeTag></span></div>
          <div className="cap-body"><div className="vv">$5,000</div><div className="lbl">月 1–6 现值 · 全局统一</div></div>
          <div className="next-step">下一拐点:<b>月 7</b> → $2,000(权威归 H1,以月份为口径)。Phase 推进后自动收紧,放大节奏抓收尾。</div>
          <div className="cap-action"><button onClick={() => ctx.nav("H")}>前往 H1 调整 →</button></div>
        </section>
      </div>

      <section className="pane bin-table">
        <div className="pane-h"><span className="ph-ttl">用户结算视图 · 当日</span><span className="ph-sub">A/B 轨 GV · Balance Match · 状态</span><span className="ph-r" style={{ marginLeft: "auto" }}><CodeTag>F.binary.engine</CodeTag></span></div>
        <div className="bin-row head"><span>用户</span><span>Track A · 左轨</span><span /><span>Track B · 右轨</span><span style={{ textAlign: "right" }}>Balance Match</span><span style={{ textAlign: "right" }}>当日已发</span><span style={{ textAlign: "right" }}>状态</span></div>
        {BINARY.map((b) => (
          <div key={b.user} className="bin-row">
            <span className="uid">{b.user}</span>
            <span className="bar a"><span className="f" style={{ width: `${(b.a / BINARY_MAX_AB) * 100}%` }} /><span className="blbl">{usd(b.a)}</span></span>
            <span className="ax">|</span>
            <span className="bar b"><span className="f" style={{ width: `${(b.b / BINARY_MAX_AB) * 100}%` }} /><span className="blbl">{usd(b.b)}</span></span>
            <span className={`match${b.match ? "" : " zero"}`}>{b.match ? usd(b.match) : "—"}</span>
            <span className="today">{b.today ? usd(b.today) : "—"}</span>
            <span className="state"><Badge tone={b.tone}>{b.state}</Badge></span>
          </div>
        ))}
      </section>

      <div className="cfg-grid">
        <div className="cfg-card">
          <div className="ch">两轨门槛<span className="tag">F.binary.threshold</span></div>
          <div className="cs">最低门槛 · 改后对下一周期结算生效</div>
          <div className="ckv"><span className="k">两轨结算门槛</span><span className="v">{thEff}</span></div>
          <div className="ckv"><span className="k">沉淀池(未达门槛)</span><span className="v">$1.2M</span></div>
          <div className="ckv"><span className="k">沉淀处置</span><span className="v" style={{ color: "var(--ink-3)" }}>月底归零</span></div>
          <div className="cfg-foot"><button className="fbtn primary" onClick={() => ctx.openActionConfirm({ name: "两轨结算门槛调整", op: "param", paramKey: "F.binary.threshold", edit: { kind: "text", current: thEff }, detail: `两轨结算最低门槛 · 当前 ${thEff} · 改后对下一周期结算生效,不影响本期已计提。` })}>调整门槛</button></div>
        </div>

        <div className="cfg-card">
          <div className="ch">平衡匹配比例<span className="tag">F.binary.matchRate</span></div>
          <div className="cs">⚡ 放大佣金流出动作,受 B1 覆盖率约束</div>
          <div className="ckv"><span className="k">当前比例</span><span className="v" style={{ color: "var(--brand)" }}>{rateEff}</span></div>
          <div className="ckv"><span className="k">今日匹配总额</span><span className="v">$10,490</span></div>
          <div className="ckv"><span className="k">月累计匹配</span><span className="v">$214,800</span></div>
          <div className="cfg-foot"><button className="fbtn primary amp" onClick={() => ctx.openActionConfirm({ name: "平衡匹配比例调整", amplify: true, op: "param", paramKey: "F.binary.matchRate", edit: { kind: "text", current: rateEff, unit: "%" }, detail: `min(A,B) × 该比例日结算 · 当前 ${rateEff} · 放大佣金流出,受 B1 覆盖率约束。` })}>调整比例</button></div>
        </div>

        <div className="cfg-card">
          <div className="ch">自动安置 & 归零<span className="tag">F.binary.placement</span></div>
          <div className="cs">自动安置 + 月度 GV reset · server cron</div>
          <div className="ckv"><span className="k">自动安置</span><span className="v" style={{ color: spillOn ? "var(--success)" : "var(--ink-3)" }}>{spillOn ? "已启用" : "已关闭"}</span></div>
          <div className="ckv"><span className="k">近 7d 自动分配</span><span className="v">1,284 成员</span></div>
          <div className="ckv"><span className="k">gvResetCron</span><span className="v" style={{ fontSize: 11 }}>{resetEff}</span></div>
          <div className="cfg-foot">
            <button className="fbtn" onClick={() => ctx.openActionConfirm({ name: "自动安置策略调整", op: "param", paramKey: "F.binary.spillover", edit: { kind: "select", current: spillOn ? "已启用" : "已关闭", options: ["已启用", "已关闭"] }, detail: "自动安置开关 · 关闭后新成员需手动安置(运营压力↑)。" })}>分配策略</button>
            <button className="fbtn" onClick={() => ctx.openActionConfirm({ name: "GV 归零口径调整", op: "param", paramKey: "F.binary.gvResetCron", edit: { kind: "text", current: resetEff }, detail: "GV 月度归零 cron · 改为「保留」会拉大利息负债(科目 #3)与佣金应付,须严格 操作确认。" })}>归零口径</button>
          </div>
        </div>
      </div>

      <p className="f-foot">阻塞用户(单轨 &lt; $1k)占比 25%,是双轨制设计意图 — <b>逼用户两侧均衡发展</b>,而不只是单边狂铺。沉淀池月底归零是 B 端杠杆,但口径若改为「保留」则会拉大利息负债(科目 #3)与佣金应付,须严格 操作确认。</p>
    </>
  );
}
