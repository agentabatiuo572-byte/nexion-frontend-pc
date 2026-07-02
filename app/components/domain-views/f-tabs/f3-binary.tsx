"use client";

/** F3 · 双轨结算引擎。
 * 页面读模型来自后端 teams/binary。 */
import { useMemo, useState } from "react";
import { Badge, CodeTag, DataListPager, useDataListPager } from "../design-kit";
import type { FViewCtx } from "./types";

const usd = (n: number): string => "$" + n.toLocaleString();
const text = (value?: string | null) => (value && value.trim() ? value.trim() : "—");

function metricClass(tone: string) {
  return ["ok", "warn", "cyan"].includes(tone) ? `f-stat ${tone}` : "f-stat";
}

export function F3Binary({ ctx }: { ctx: FViewCtx }) {
  const [lookupText, setLookupText] = useState("");
  const [selectedUser, setSelectedUser] = useState("");
  const [lookupOpen, setLookupOpen] = useState(false);
  const rows = ctx.f3Settlements;
  const lookupKw = lookupText.trim().toLowerCase();
  const userOptions = useMemo(() => {
    const source = lookupKw
      ? rows.filter((row) => `${row.user} ${row.state} ${row.a} ${row.b} ${row.match} ${row.today}`.toLowerCase().includes(lookupKw))
      : rows;
    return source.slice(0, 12);
  }, [lookupKw, rows]);
  const filtered = selectedUser ? rows.filter((row) => row.user === selectedUser) : rows;
  const pager = useDataListPager(filtered, { initialPageSize: 10, resetKey: selectedUser || "all" });
  const cfg = ctx.f3Config;
  const formula = ctx.f3Formula;
  const dailyCap = ctx.f3DailyCap;
  const maxTrackGmv = Math.max(1, ctx.f3MaxTrackGmv, ...rows.flatMap((row) => [row.a, row.b]));
  const thEff = cfg?.threshold ?? "";
  const rateEff = cfg?.matchRate ?? "";
  const spillOn = cfg?.spilloverEnabled ?? cfg?.spillover !== "已关闭";
  const resetEff = cfg?.gvResetCron ?? "";
  const periodEff = cfg?.settlePeriod ?? "";
  const residualEff = cfg?.residualPolicy ?? "";
  const residualSub = cfg?.residualSub ?? residualEff;
  const selectUser = (user: string) => {
    setSelectedUser(user);
    setLookupText(user);
    setLookupOpen(false);
  };
  const updateLookup = (value: string) => {
    setLookupText(value);
    setLookupOpen(true);
    if (selectedUser && value !== selectedUser) setSelectedUser("");
  };
  const clearLookup = () => {
    setSelectedUser("");
    setLookupText("");
    setLookupOpen(false);
  };

  if (ctx.f3Loading && rows.length === 0) {
    return (
      <section className="pane">
        <div className="pane-h"><span className="ph-ttl">F3 数据加载中</span><span className="ph-sub">正在读取后端 teams/binary</span></div>
        <div className="bin-empty">加载中...</div>
      </section>
    );
  }

  if (ctx.f3Error && rows.length === 0) {
    return (
      <section className="pane">
        <div className="pane-h"><span className="ph-ttl">F3 数据加载失败</span><span className="ph-sub">{ctx.f3Error}</span></div>
        <div className="bin-empty"><button className="fbtn primary" onClick={() => void ctx.refreshF3()}>重试</button></div>
      </section>
    );
  }

  return (
    <>
      {ctx.f3Error && (
        <section className="pane">
          <div className="pane-h"><span className="ph-ttl">F3 数据刷新失败</span><span className="ph-sub">{ctx.f3Error}</span></div>
        </section>
      )}

      <div className="f-stats">
        {ctx.f3Metrics.map((metric) => (
          <div key={metric.id} className={metricClass(metric.tone)}>
            <div className="k">{metric.name}</div>
            <div className="v">{metric.value}</div>
            <div className="sub">{metric.id === "residualPool" ? text(residualSub) : metric.sub}</div>
          </div>
        ))}
      </div>

      <div className="f3-hero">
        <section className="pane">
          <div className="pane-h"><span className="ph-ttl">平衡匹配公式</span><span className="ph-sub">服务端权威 · {text(periodEff)}结算窗口</span><span className="ph-r" style={{ marginLeft: "auto" }}><CodeTag tone="electric">双轨结算</CodeTag></span></div>
          <div className="formula">
            <div className="track a"><div className="nm">TRACK A · 左轨</div><div className="gv">{formula ? usd(formula.trackA) : "—"}</div><div className="meta">较大侧 · 自动安置流入<br />本期累计 GV(月初归零)</div></div>
            <div className="balance">
              <div className="op">min</div>
              <div className="fx"><div className="l">MATCH {text(formula?.matchRate)}</div><div className="v">{formula ? usd(formula.matchAmount) : "—"}</div><div className="u">today · {text(formula?.user)}</div></div>
              <div className="op">× {text(formula?.matchRate)}</div>
            </div>
            <div className="track b"><div className="nm">TRACK B · 右轨</div><div className="gv">{formula ? usd(formula.trackB) : "—"}</div><div className="meta">较小侧 · <b>结算基数</b><br />min(A,B) 决定匹配上限</div></div>
          </div>
          <div className="formula-foot">
            <span className="mono">balanceMatch = min(A, B) × <b>matchRate</b></span>
            <span className="sep">·</span>
            <span><b>matchRate = {text(rateEff)}</b></span>
            <span className="sep">·</span>
            <span className="mono">trackMinUsd = {text(thEff)}</span>
            <span className="sep">·</span>
            <span className="mono">改后对下一周期结算生效</span>
          </div>
        </section>

        <section className="pane cap-card">
          <div className="pane-h"><span className="ph-ttl">双轨日封顶</span><span className="ph-sub">左右两轨每日计酬上限</span><span className="ph-r" style={{ marginLeft: "auto" }}><CodeTag tone="cyan">H1 派发 · 只读</CodeTag></span></div>
          <div className="cap-body"><div className="vv" data-proof="f3-cap-h1">{text(dailyCap?.currentLabel)}</div><div className="lbl">{text(dailyCap?.windowLabel)}</div></div>
          <div className="next-step">只读镜像 H1 当前月(<b>月 {dailyCap?.currentMonth ?? "—"} · {text(dailyCap?.currentPhase)}</b>)派发值;Phase 推进后随 H1 自动收紧,改值去 H1。</div>
          <div className="cap-action"><button onClick={() => ctx.nav("H")}>前往 H1 调整 →</button></div>
        </section>
      </div>

      <section className="pane bin-table">
        <div className="pane-h"><span className="ph-ttl">用户结算视图 · 当日</span><span className="ph-sub">A/B 轨 GV · Balance Match · 状态</span><span className="ph-r" style={{ marginLeft: "auto" }}><CodeTag>F.binary.engine</CodeTag></span></div>
        <div className="bin-search">
          <div className="bin-user-select">
            <input
              className="fld"
              placeholder="搜索并选择用户编码"
              value={lookupText}
              onChange={(e) => updateLookup(e.target.value)}
              onFocus={() => setLookupOpen(true)}
              onBlur={() => window.setTimeout(() => setLookupOpen(false), 120)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && userOptions[0]) {
                  e.preventDefault();
                  selectUser(userOptions[0].user);
                }
                if (e.key === "Escape") setLookupOpen(false);
              }}
              aria-label="搜索并选择用户编码"
              role="combobox"
              aria-expanded={lookupOpen}
              aria-controls="f3-user-options"
              aria-autocomplete="list"
            />
            {lookupOpen && (
              <div id="f3-user-options" className="bin-user-pop" role="listbox">
                {userOptions.map((row) => (
                  <button
                    key={row.user}
                    type="button"
                    className="bin-user-option"
                    role="option"
                    aria-selected={selectedUser === row.user}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectUser(row.user)}
                  >
                    <span className="bin-user-main"><b>{row.user}</b><span>{row.state}</span></span>
                    <span className="bin-user-meta">A {usd(row.a)} · B {usd(row.b)} · 当日 {row.today ? usd(row.today) : "—"}</span>
                  </button>
                ))}
                {userOptions.length === 0 && <div className="bin-user-empty">无匹配用户 · 请从下拉结果选择</div>}
              </div>
            )}
          </div>
          {(lookupText || selectedUser) && <button className="fbtn" onClick={clearLookup}>清除</button>}
          <span className="muted tiny">{selectedUser ? `已选择 ${selectedUser}` : "未选择时展示全部"}</span>
          <span className="muted tiny" style={{ marginLeft: "auto" }}>{pager.total} 名用户</span>
        </div>
        <div className="bin-row head"><span>用户</span><span>Track A · 左轨</span><span /><span>Track B · 右轨</span><span style={{ textAlign: "right" }}>Balance Match</span><span style={{ textAlign: "right" }}>当日已发</span><span style={{ textAlign: "right" }}>状态</span></div>
        {pager.pageRows.map((row) => (
          <div key={row.user} className="bin-row">
            <span className="uid">{row.user}</span>
            <span className="bar a"><span className="f" style={{ width: `${(row.a / maxTrackGmv) * 100}%` }} /><span className="blbl">{usd(row.a)}</span></span>
            <span className="ax">|</span>
            <span className="bar b"><span className="f" style={{ width: `${(row.b / maxTrackGmv) * 100}%` }} /><span className="blbl">{usd(row.b)}</span></span>
            <span className={`match${row.match ? "" : " zero"}`}>{row.match ? usd(row.match) : "—"}</span>
            <span className="today">{row.today ? usd(row.today) : "—"}</span>
            <span className="state"><Badge tone={row.tone}>{row.state}</Badge></span>
          </div>
        ))}
        {pager.pageRows.length === 0 && <div className="bin-empty">无匹配用户 · 请从下拉结果选择用户</div>}
        <DataListPager
          label="用户结算视图"
          page={pager.page}
          pageSize={pager.pageSize}
          total={pager.total}
          rawTotal={rows.length}
          onPageChange={pager.setPage}
          onPageSizeChange={pager.setPageSize}
          pageSizeOptions={[10, 20, 50]}
        />
      </section>

      <div className="cfg-grid">
        <div className="cfg-card">
          <div className="ch">两轨门槛<span className="tag">F.binary.threshold</span></div>
          <div className="cs">最低门槛 · 改后对下一周期结算生效</div>
          <div className="ckv"><span className="k">两轨结算门槛</span><span className="v">{text(thEff)}</span></div>
          <div className="ckv"><span className="k">沉淀池(未达门槛)</span><span className="v">{text(cfg?.residualPool)}</span></div>
          <div className="ckv"><span className="k">沉淀处置</span><span className="v" style={{ color: "var(--ink-3)" }}>{text(residualEff)}</span></div>
          <div className="cfg-foot"><button className="fbtn primary" onClick={() => ctx.openActionConfirm({ name: "两轨结算门槛调整", op: "param", paramKey: "F.binary.threshold", edit: { kind: "text", current: thEff }, detail: `两轨结算最低门槛 · 当前 ${text(thEff)} · 改后对下一周期结算生效,不影响本期已计提。` })}>调整门槛</button></div>
        </div>

        <div className="cfg-card">
          <div className="ch">平衡匹配比例<span className="tag">F.binary.matchRate</span></div>
          <div className="cs">⚡ 放大佣金流出动作,受 B1 覆盖率约束</div>
          <div className="ckv"><span className="k">当前比例</span><span className="v" style={{ color: "var(--brand)" }}>{text(rateEff)}</span></div>
          <div className="ckv"><span className="k">今日匹配总额</span><span className="v">{usd(ctx.f3DailyMatchUsd)}</span></div>
          <div className="ckv"><span className="k">月累计匹配</span><span className="v">{usd(ctx.f3MonthlyMatchedUsd)}</span></div>
          <div className="cfg-foot"><button className="fbtn primary amp" onClick={() => ctx.openActionConfirm({ name: "平衡匹配比例调整", amplify: true, op: "param", paramKey: "F.binary.matchRate", edit: { kind: "text", current: rateEff, unit: "%" }, detail: `min(A,B) × 该比例日结算 · 当前 ${text(rateEff)} · 放大佣金流出,受 B1 覆盖率约束。` })}>调整比例</button></div>
        </div>

        <div className="cfg-card">
          <div className="ch">自动安置 & 归零<span className="tag">F.binary.placement</span></div>
          <div className="cs">自动安置 + 月度 GV reset · server cron</div>
          <div className="ckv"><span className="k">自动安置</span><span className="v" style={{ color: spillOn ? "var(--success)" : "var(--ink-3)" }}>{spillOn ? "已启用" : "已关闭"}</span></div>
          <div className="ckv"><span className="k">近 7d 自动分配</span><span className="v">{ctx.f3AutoPlacement7dCount.toLocaleString()} 成员</span></div>
          <div className="ckv"><span className="k">gvResetCron</span><span className="v" style={{ fontSize: 11 }}>{text(resetEff)}</span></div>
          <div className="cfg-foot">
            <button className="fbtn" onClick={() => ctx.openActionConfirm({ name: "自动安置策略调整", op: "param", paramKey: "F.binary.spillover", edit: { kind: "select", current: spillOn ? "已启用" : "已关闭", options: ["已启用", "已关闭"] }, detail: "自动安置开关 · 关闭后新成员需手动安置(运营压力↑)。" })}>分配策略</button>
            <button className="fbtn" onClick={() => ctx.openActionConfirm({ name: "GV 归零口径调整", op: "param", paramKey: "F.binary.gvResetCron", edit: { kind: "text", current: resetEff }, detail: "GV 月度归零 cron · 改为「保留」会拉大利息负债(科目 #3)与佣金应付,须严格 操作确认。" })}>归零口径</button>
          </div>
        </div>

        <div className="cfg-card">
          <div className="ch">结算周期 &amp; 沉淀处置<span className="tag">F.binary.settlement</span></div>
          <div className="cs">双轨对碰派发节奏 + 沉淀池处置策略 · 改后下一周期生效</div>
          <div className="ckv"><span className="k">结算周期</span><span className="v" style={{ color: "var(--brand)" }}>{text(periodEff)}</span></div>
          <div className="ckv"><span className="k">沉淀处置策略</span><span className="v">{text(residualEff)}</span></div>
          <div className="cfg-foot"><button className="fbtn primary amp" onClick={() => ctx.openActionConfirm({
            name: "结算周期 & 沉淀处置调整",
            op: "param-multi",
            amplify: true,
            businessForm: {
              kind: "multi-field",
              title: "目标新值 · 结算周期 & 沉淀处置",
              hint: "结算周期=双轨对碰的派发节奏(每日/每周/每月);沉淀处置=对碰后未匹配剩余点数的处理。「转结」沿用沉淀到下期会拉大佣金应付与利息负债(科目 #3),受 B1 覆盖率约束。",
              fields: [
                { key: "period", label: "结算周期", current: periodEff, inputKind: "select", options: ["每日", "每周", "每月"] },
                { key: "residual", label: "沉淀处置策略", current: residualEff, inputKind: "select", options: ["每月清零", "每次对碰清零", "转结"] },
              ],
            },
            paramKeys: [
              { key: "period", paramKey: "F.binary.settlePeriod" },
              { key: "residual", paramKey: "F.binary.residualPolicy" },
            ],
            detail: "结算周期(每日/每周/每月) + 沉淀处置(每月清零/每次对碰清零/转结) · server-canonical · 改后对下一周期结算生效,不回溯已计提;「转结」放大负债须 B1 覆盖率评估。",
          })}>调整周期 &amp; 策略</button></div>
        </div>
      </div>

      <p className="f-foot">阻塞用户(单轨 &lt; $1k)占比 {ctx.f3ParticipantCount ? Math.round((ctx.f3BlockedCount / ctx.f3ParticipantCount) * 100) : 0}%,是双轨制设计意图 — <b>逼用户两侧均衡发展</b>,而不只是单边狂铺。沉淀池当前口径「{text(residualEff)}」是 B 端杠杆;改为「转结」会拉大利息负债(科目 #3)与佣金应付,须严格 操作确认 + B1 覆盖率评估。</p>
    </>
  );
}
