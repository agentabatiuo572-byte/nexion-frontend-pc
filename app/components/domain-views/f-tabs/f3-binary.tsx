"use client";

/** F3 · 左右团队业绩结算。
 * 页面读模型来自后端 teams/binary。 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { Badge, CodeTag, DataListPager, useDataListPager } from "../design-kit";
import { F3_GV_RESET_PARAM_KEY } from "@/lib/admin/f1-client";
import type { FViewCtx } from "./types";
import { F3Placements } from "./f3-placements";

const usd = (n: number): string => "$" + n.toLocaleString();
const text = (value?: string | null) => operatorCopyText(value && value.trim() ? value.trim() : "—");
const trackLabel = (value: number, other: number) => value > other ? "较大侧"
  : value < other ? "较小侧 · 结算基数" : "两轨显示值相同";

function metricClass(tone: string) {
  return ["ok", "warn", "cyan"].includes(tone) ? `f-stat ${tone}` : "f-stat";
}

export function F3Binary({ ctx }: { ctx: FViewCtx }) {
  const canSettle = ctx.can("network_f3_write");
  const canConfigure = ctx.can("network_f3_match_rate");
  const canPause = ctx.can("network_f3_engine_pause");
  const [lookupText, setLookupText] = useState("");
  const [selectedUser, setSelectedUser] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [cohortFilter, setCohortFilter] = useState("");
  const [lookupOpen, setLookupOpen] = useState(false);
  const rows = ctx.f3Settlements;
  const lookupKw = lookupText.trim().toLowerCase();
  const userOptions = useMemo(() => {
    const source = lookupKw
      ? rows.filter((row) => `${row.user} ${({ paid: "已结算", blocked: "已阻断", pending: "待结算", processing: "结算中", failed: "结算失败" } as Record<string, string>)[row.state.toLowerCase()] ?? operatorCopyText(row.state)} ${row.a} ${row.b} ${row.match} ${row.today}`.toLowerCase().includes(lookupKw))
      : rows;
    return source.slice(0, 12);
  }, [lookupKw, rows]);
  const cohorts = useMemo(
    () => Array.from(new Set(rows.map((row) => row.cohort).filter(Boolean))).sort().reverse(),
    [rows],
  );
  const filtered = rows.filter((row) =>
    (!selectedUser || row.user === selectedUser)
    && (!statusFilter || row.state === statusFilter)
    && (!cohortFilter || row.cohort === cohortFilter),
  );
  const pager = useDataListPager(filtered, {
    initialPageSize: 10,
    resetKey: `${selectedUser || "all"}:${statusFilter || "all"}:${cohortFilter || "all"}`,
  });
  const cfg = ctx.f3Config;
  const formula = ctx.f3Formula;
  const trackFormula = formula?.user.trim() && Number.isFinite(formula.trackA) && Number.isFinite(formula.trackB) ? formula : null;
  const dailyCap = ctx.f3DailyCap;
  const maxTrackGmv = Math.max(1, ctx.f3MaxTrackGmv, ...rows.flatMap((row) => [row.a, row.b]));
  const thEff = cfg?.threshold ?? "";
  const rateEff = cfg?.matchRate ?? "";
  const spillOn = cfg?.spilloverEnabled ?? cfg?.spillover !== "已关闭";
  const resetEff = cfg?.gvResetCron ?? "";
  const periodEff = cfg?.settlePeriod ?? "";
  const residualEff = cfg?.residualPolicy ?? "";
  const residualSub = cfg?.residualSub ?? residualEff;
  const binaryPaused = (ctx.f3ConfigValues["F.binary.paused"] ?? "off") === "on";
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
        <div className="pane-h"><span className="ph-ttl">F3 数据加载中</span><span className="ph-sub">正在读取后端 团队结算数据</span></div>
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
      <F3Placements />
      {ctx.f3Error && (
        <section className="pane">
          <div className="pane-h"><span className="ph-ttl">F3 数据刷新失败</span><span className="ph-sub">{ctx.f3Error}</span></div>
        </section>
      )}

      <div className="f-stats">
        {ctx.f3Metrics.map((metric) => (
          <div key={metric.id} className={metricClass(metric.tone)}>
            <div className="k">{operatorCopyText(metric.name)}</div>
            <div className="v">{operatorCopyText(metric.value)}</div>
            <div className="sub">{metric.id === "residualPool" ? text(residualSub) : operatorCopyText(metric.sub)}</div>
          </div>
        ))}
      </div>

      <div className="f3-hero">
        <section className="pane">
          <div className="pane-h"><span className="ph-ttl">平衡匹配公式</span><span className="ph-sub">以服务器记录为准 · {text(periodEff)}结算窗口</span><span className="ph-r" style={{ marginLeft: "auto" }}><CodeTag tone="electric">双轨结算</CodeTag></span></div>
          <div className="formula">
            <div className="track a"><div className="nm">A 侧团队</div><div className="gv">{formula ? usd(formula.trackA) : "—"}</div><div className="meta">{trackFormula ? trackLabel(trackFormula.trackA, trackFormula.trackB) : "暂无轨道数据"}<br />本期累计团队业绩(月初归零)</div></div>
            <div className="balance">
              <div className="op">取较小值</div>
              <div className="fx"><div className="l">匹配奖励 {text(formula?.matchRate)}</div><div className="v">{formula ? usd(formula.matchAmount) : "—"}</div><div className="u">今日 · {text(formula?.user)}</div></div>
              <div className="op">× {text(formula?.matchRate)}</div>
            </div>
            <div className="track b"><div className="nm">B 侧团队</div><div className="gv">{formula ? usd(formula.trackB) : "—"}</div><div className="meta">{trackFormula ? trackLabel(trackFormula.trackB, trackFormula.trackA) : "暂无轨道数据"}<br />两侧较低业绩 决定匹配上限</div></div>
          </div>
          <div className="formula-foot">
            <span className="mono">匹配金额 = 两侧较低业绩 × <b>匹配比例</b></span>
            <span className="sep">·</span>
            <span><b>匹配比例 = {text(rateEff)}</b></span>
            <span className="sep">·</span>
            <span className="mono">每侧最低业绩 = {text(thEff)}</span>
            <span className="sep">·</span>
            <span className="mono">改后对下一周期结算生效</span>
          </div>
        </section>

        <section className="pane cap-card">
          <div className="pane-h"><span className="ph-ttl">双轨日封顶基准</span><span className="ph-sub">周期结算额度 = 日基准 × 周期天数</span><span className="ph-r" style={{ marginLeft: "auto" }}><CodeTag tone="cyan">H1 派发 · 只读</CodeTag></span></div>
          <div className="cap-body"><div className="vv" data-proof="f3-cap-h1">{text(dailyCap?.currentLabel)}</div><div className="lbl">{text(dailyCap?.windowLabel)}</div></div>
          <div className="next-step">只读镜像 H1 当前月(<b>月 {dailyCap?.currentMonth ?? "—"} · {text(dailyCap?.currentPhase)}</b>)派发值;运营阶段 推进后随 H1 自动收紧,改值去 H1。</div>
          <div className="cap-action"><button onClick={() => ctx.nav("H")}>前往 H1 调整 →</button></div>
        </section>
      </div>

      <section className="pane bin-table">
        <div className="pane-h">
          <span className="ph-ttl">用户结算视图 · 当日</span>
          <span className="ph-sub">A/B 侧团队业绩 · 匹配结算 · 状态 · 2026-10-19 起新周期按越南时间 UTC+7</span>
          <span className="ph-r" style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Link className="fbtn" href="/network/commissions">前往 F5 补发 / 冲正</Link>
            {canSettle && <button className="fbtn primary" onClick={() => ctx.openActionConfirm({
              name: "执行双轨结算",
              businessForm: {
                kind: "multi-field",
                title: "目标用户与结算日",
                hint: "2026-10-19 起新周期按越南时间 UTC+7 划分；此前历史周期沿用 UTC+8，不回溯重算。系统会复核轨道归属、已支付业绩、结算周期、H1 封顶、B1 覆盖率、重复结算与退款冲正状态。",
                fields: [
                  { key: "ownerUserId", label: "用户编号", inputKind: "number", min: 1, required: true },
                  { key: "settlementDate", label: "结算日(业务日期 · YYYY-MM-DD)", inputKind: "text", placeholder: "例如 2026-10-19", required: true },
                ],
              },
              detail: "执行后产生 F3 结算记录、佣金冷却事件、D4 不可变资金流水、A2 审计和 A4 佣金事件；同一用户与结算日重复提交会安全重放。",
              run: async (reason, businessValue) => {
                const ownerUserId = Number(businessValue?.ownerUserId);
                const settlementDate = String(businessValue?.settlementDate ?? "").trim();
                if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) throw new Error("请输入有效用户编号");
                if (!/^\d{4}-\d{2}-\d{2}$/.test(settlementDate)) throw new Error("结算日格式应为 YYYY-MM-DD");
                const result = await ctx.executeF3Settlement(ownerUserId, settlementDate, reason);
                if (result.status === "BLOCKED") {
                  ctx.toast(`结算未执行 · ${result.reason || "未满足结算条件"} · 未产生资金变动`);
                  return;
                }
                ctx.toast(result.replayed
                  ? `结算已存在 · 已安全重放 · 佣金事件 ${result.commissionEventId ?? "—"}`
                  : `结算已提交 · ${usd(result.amountUsdt)} 进入冷却 · D4/A2/A4 已联动`);
              },
            })}>执行结算</button>}
          </span>
        </div>
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
                    <span className="bin-user-main"><b>{row.user}</b><span>{({ paid: "已结算", blocked: "已阻断", pending: "待结算", processing: "结算中", failed: "结算失败" } as Record<string, string>)[row.state.toLowerCase()] ?? operatorCopyText(row.state)}</span></span>
                    <span className="bin-user-meta">A {usd(row.a)} · B {usd(row.b)} · 当日 {row.today ? usd(row.today) : "—"}</span>
                  </button>
                ))}
                {userOptions.length === 0 && <div className="bin-user-empty">无匹配用户 · 请从下拉结果选择</div>}
              </div>
            )}
          </div>
          {(lookupText || selectedUser) && <button className="fbtn" onClick={clearLookup}>清除</button>}
          <select
            className="fld"
            aria-label="按结算状态筛选"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">全部状态</option>
            {Array.from(new Set(rows.map((row) => row.state).filter(Boolean))).sort().map((state) => (
              <option key={state} value={state}>{({paid:"已结算",blocked:"已阻断",pending:"待结算",processing:"结算中",failed:"结算失败"} as Record<string,string>)[state.toLowerCase()] ?? operatorCopyText(state)}</option>
            ))}
          </select>
          <select
            className="fld"
            aria-label="按用户群筛选"
            value={cohortFilter}
            onChange={(event) => setCohortFilter(event.target.value)}
          >
            <option value="">全部用户群</option>
            {cohorts.map((cohort) => <option key={cohort} value={cohort}>{cohort}</option>)}
          </select>
          <span className="muted tiny">{selectedUser ? `已选择 ${selectedUser}` : "未选择时展示全部"}</span>
          <span className="muted tiny" style={{ marginLeft: "auto" }}>{pager.total} 名用户</span>
        </div>
        <div className="bin-row head"><span>用户</span><span>A 侧团队</span><span /><span>B 侧团队</span><span style={{ textAlign: "right" }}>匹配结算</span><span style={{ textAlign: "right" }}>当日已发</span><span style={{ textAlign: "right" }}>状态</span></div>
        {pager.pageRows.map((row) => (
          <div key={row.user} className="bin-row">
            <span className="uid">{row.user}</span>
            <span className="bar a"><span className="f" style={{ width: `${(row.a / maxTrackGmv) * 100}%` }} /><span className="blbl">{usd(row.a)}</span></span>
            <span className="ax">|</span>
            <span className="bar b"><span className="f" style={{ width: `${(row.b / maxTrackGmv) * 100}%` }} /><span className="blbl">{usd(row.b)}</span></span>
            <span className={`match${row.match ? "" : " zero"}`}>{row.match ? usd(row.match) : "—"}</span>
            <span className="today">{row.today ? usd(row.today) : "—"}</span>
            <span className="state"><Badge tone={row.tone}>{({ paid: "已结算", blocked: "已阻断", pending: "待结算", processing: "结算中", failed: "结算失败" } as Record<string, string>)[row.state.toLowerCase()] ?? operatorCopyText(row.state)}</Badge></span>
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
          <div className="ch">两轨门槛</div>
          <div className="cs">最低门槛 · 改后对下一周期结算生效</div>
          <div className="ckv"><span className="k">两轨结算门槛</span><span className="v">{text(thEff)}</span></div>
          <div className="ckv"><span className="k">未匹配业绩(未达门槛)</span><span className="v">{text(cfg?.residualPool)}</span></div>
          <div className="ckv"><span className="k">未匹配业绩处理</span><span className="v" style={{ color: "var(--ink-3)" }}>{text(residualEff)}</span></div>
          {canConfigure && <div className="cfg-foot"><button className="fbtn primary" onClick={() => ctx.openActionConfirm({ name: "两轨结算门槛调整", op: "param", paramKey: "F.binary.threshold", edit: { kind: "text", current: thEff }, detail: `两轨结算最低门槛 · 当前 ${text(thEff)} · 改后对下一周期结算生效,不影响本期已计提。` })}>调整门槛</button></div>}
        </div>

        <div className="cfg-card">
          <div className="ch">平衡匹配比例</div>
          <div className="cs">⚡ 放大佣金流出动作,受 B1 覆盖率约束</div>
          <div className="ckv"><span className="k">当前比例</span><span className="v" style={{ color: "var(--brand)" }}>{text(rateEff)}</span></div>
          <div className="ckv"><span className="k">今日匹配总额</span><span className="v">{usd(ctx.f3DailyMatchUsd)}</span></div>
          <div className="ckv"><span className="k">月累计匹配</span><span className="v">{usd(ctx.f3MonthlyMatchedUsd)}</span></div>
          {canConfigure && <div className="cfg-foot"><button className="fbtn primary amp" onClick={() => ctx.openActionConfirm({
            name: "平衡匹配比例调整",
            amplify: true,
            op: "param",
            paramKey: "F.binary.matchRate",
            edit: { kind: "text", current: rateEff, unit: "%" },
            detail: `两侧较低业绩 × 该比例，按当前配置周期结算 · 当前 ${text(rateEff)} · 放大佣金流出,受 B1 覆盖率约束。改后对下一周期结算生效,不回溯已计提。`,
            completionCopy: "保存后只影响下一周期结算，不回溯已计提。",
          })}>调整比例</button></div>}
        </div>

        <div className="cfg-card">
          <div className="ch">自动安置与归零</div>
          <div className="cs">2026-10-19 起新周期按越南自然月划分 · 每月 1 日 00:00 UTC+7</div>
          <div className="ckv"><span className="k">自动安置</span><span className="v" style={{ color: spillOn ? "var(--success)" : "var(--ink-3)" }}>{spillOn ? "已启用" : "已关闭"}</span></div>
          <div className="ckv"><span className="k">近7天 自动分配</span><span className="v">{ctx.f3AutoPlacement7dCount.toLocaleString()} 成员</span></div>
          <div className="ckv"><span className="k">归零时间</span><span className="v" style={{ fontSize: 11 }}>{text(resetEff)}</span></div>
          {canConfigure && <div className="cfg-foot">
            <button className="fbtn" onClick={() => ctx.openActionConfirm({ name: "自动安置策略调整", op: "param", paramKey: "F.binary.spillover", edit: { kind: "select", current: spillOn ? "已启用" : "已关闭", options: ["已启用", "已关闭"] }, detail: "自动安置开关 · 关闭后新成员需手动安置(运营压力↑)。" })}>分配策略</button>
            {/* 归零口径恢复可配(2026-08-06 主人裁决):后端结算策略一直读这个配置键、契约测试也把它
                列进合法配置键清单,只是页面把入口撤了 —— 后端可配而控制台无门,是半截状态。
                🔴 键名从 client 常量取、页面只出中文标签:本页有一道术语门扫原文(含注释),
                禁止开发代号出现在页面正文里。 */}
            <button className="fbtn" onClick={() => ctx.openActionConfirm({ name: "团队业绩归零统计规则调整", op: "param", paramKey: F3_GV_RESET_PARAM_KEY, edit: { kind: "select", current: resetEff, options: ["每月 1 日 00:00 Asia/Ho_Chi_Minh"], optionLabels: { "每月 1 日 00:00 Asia/Ho_Chi_Minh": "每月 1 日 00:00 越南时间 UTC+7" } }, detail: `两轨累计业绩的归零时点 · 当前 ${text(resetEff)} · 改后对下一周期结算生效,不回溯已计提。` })}>归零统计规则</button>
          </div>}
        </div>

        <div className="cfg-card">
          <div className="ch">结算周期与未匹配业绩处理</div>
          <div className="cs">双轨对碰派发节奏 + 未匹配业绩处置策略 · 改后下一周期生效</div>
          <div className="ckv"><span className="k">结算周期</span><span className="v" style={{ color: "var(--brand)" }}>{text(periodEff)}</span></div>
          <div className="ckv"><span className="k">未匹配业绩处理策略</span><span className="v">{text(residualEff)}</span></div>
          {canConfigure && <div className="cfg-foot"><button className="fbtn primary amp" onClick={() => ctx.openActionConfirm({
            name: "结算周期与未匹配业绩处理调整",
            op: "param-multi",
            amplify: true,
            businessForm: {
              kind: "multi-field",
              title: "目标新值 · 结算周期与未匹配业绩处理",
              hint: "2026-10-19 起新周期按越南时间 UTC+7：每日 00:00、每周一 00:00、每月 1 日 00:00 划分；此前历史周期沿用 UTC+8，不回溯重算。未匹配业绩处理=对碰后未匹配剩余点数的处理。「转结」沿用沉淀到下期会拉大佣金应付与利息负债(科目 #3),受 B1 覆盖率约束。",
              fields: [
                { key: "period", label: "结算周期", current: periodEff, inputKind: "select", options: ["每日", "每周", "每月"] },
                { key: "residual", label: "未匹配业绩处理策略", current: residualEff, inputKind: "select", options: ["每月清零", "每次对碰清零", "转结"] },
              ],
            },
            paramKeys: [
              { key: "period", paramKey: "F.binary.settlePeriod" },
              { key: "residual", paramKey: "F.binary.residualPolicy" },
            ],
            detail: "结算周期(每日/每周/每月) + 未匹配业绩处理(每月清零/每次对碰清零/转结) · 以服务器数据为准 · 改后对下一周期结算生效,不回溯已计提;「转结」放大负债须 B1 覆盖率评估。",
            completionCopy: "保存后只影响下一周期结算，不回溯已计提。",
          })}>调整周期与策略</button></div>}
        </div>

        <div className="cfg-card">
          <div className="ch">双轨引擎暂停</div>
          <div className="cs">⚡ 紧急暂停 · 暂停整个双轨 匹配结算 派发</div>
          <div className="ckv"><span className="k">引擎状态</span><span className="v" style={{ color: binaryPaused ? "var(--danger)" : "var(--success)" }}>{binaryPaused ? "已暂停" : "运行中"}</span></div>
          <div className="ckv"><span className="k">影响范围</span><span className="v" style={{ color: "var(--ink-3)" }}>{binaryPaused ? "全平台双轨派发冻结" : "正常按周期派发"}</span></div>
          {canPause && <div className="cfg-foot"><button className={`fbtn${binaryPaused ? " primary" : " danger"}`} onClick={() => ctx.openActionConfirm({
            name: binaryPaused ? "恢复左右团队业绩结算" : "暂停左右团队业绩结算",
            op: "dispose", paramKey: "F.binary.paused", fixedVal: binaryPaused ? "off" : "on",
            detail: binaryPaused
              ? "恢复双轨结算 · 下一周期起正常 匹配结算 派发,写 A2 审计。"
              : "暂停左右团队业绩结算 · 全平台 匹配结算 派发冻结,影响所有双轨用户结算,属极高风险止血动作,写 A2 审计。",
          })}>{binaryPaused ? "恢复引擎" : "暂停引擎"}</button></div>}
        </div>
      </div>

      <p className="f-foot">两侧团队均达到门槛后参与结算。未匹配业绩按当前设置「{text(residualEff)}」处理；若结转至下期，会增加后续佣金应付款，修改前须核验资金覆盖率。</p>
    </>
  );
}
