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
  : value < other ? "较小侧 · 按这一侧计算" : "两侧相同";

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
        <div className="pane-h"><span className="ph-ttl">左右团队数据加载中</span><span className="ph-sub">请稍候</span></div>
        <div className="bin-empty">加载中...</div>
      </section>
    );
  }

  if (ctx.f3Error && rows.length === 0) {
    return (
      <section className="pane">
        <div className="pane-h"><span className="ph-ttl">左右团队数据加载失败</span><span className="ph-sub">{ctx.f3Error}</span></div>
        <div className="bin-empty"><button className="fbtn primary" onClick={() => void ctx.refreshF3()}>重试</button></div>
      </section>
    );
  }

  return (
    <>
      <F3Placements />
      {ctx.f3Error && (
        <section className="pane">
          <div className="pane-h"><span className="ph-ttl">左右团队数据刷新失败</span><span className="ph-sub">{ctx.f3Error}</span></div>
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
          <div className="pane-h"><span className="ph-ttl">左右团队奖怎么算</span><span className="ph-sub">{text(periodEff)}结算</span><span className="ph-r" style={{ marginLeft: "auto" }}><CodeTag tone="electric">左右团队</CodeTag></span></div>
          <div className="formula">
            <div className="track a"><div className="nm">A 侧团队</div><div className="gv">{formula ? usd(formula.trackA) : "—"}</div><div className="meta">{trackFormula ? trackLabel(trackFormula.trackA, trackFormula.trackB) : "暂无数据"}<br />本期累计业绩（每月 1 日归零）</div></div>
            <div className="balance">
              <div className="op">取较小值</div>
              <div className="fx"><div className="l">匹配奖励 {text(formula?.matchRate)}</div><div className="v">{formula ? usd(formula.matchAmount) : "—"}</div><div className="u">今日 · {text(formula?.user)}</div></div>
              <div className="op">× {text(formula?.matchRate)}</div>
            </div>
            <div className="track b"><div className="nm">B 侧团队</div><div className="gv">{formula ? usd(formula.trackB) : "—"}</div><div className="meta">{trackFormula ? trackLabel(trackFormula.trackB, trackFormula.trackA) : "暂无数据"}<br />奖励按较小一侧计算</div></div>
          </div>
          <div className="formula-foot">
            <span className="mono">奖励 = 较小一侧业绩 × <b>匹配比例</b></span>
            <span className="sep">·</span>
            <span><b>匹配比例 = {text(rateEff)}</b></span>
            <span className="sep">·</span>
            <span className="mono">每侧门槛 = {text(thEff)}</span>
            <span className="sep">·</span>
            <span className="mono">修改从下一期开始生效</span>
          </div>
        </section>

        <section className="pane cap-card">
          <div className="pane-h"><span className="ph-ttl">左右团队奖每日上限</span><span className="ph-sub">每期上限 = 每日上限 × 天数</span><span className="ph-r" style={{ marginLeft: "auto" }}><CodeTag tone="cyan">跟随运营阶段 · 只读</CodeTag></span></div>
          <div className="cap-body"><div className="vv" data-proof="f3-cap-h1">{text(dailyCap?.currentLabel)}</div><div className="lbl">{text(dailyCap?.windowLabel)}</div></div>
          <div className="next-step">跟随「运营阶段设置」当前值（<b>第 {dailyCap?.currentMonth ?? "—"} 个月 · {text(dailyCap?.currentPhase)}</b>），阶段推进后自动收紧。修改请到「运营阶段设置」。</div>
          <div className="cap-action"><button onClick={() => ctx.nav("H")}>去运营阶段设置 →</button></div>
        </section>
      </div>

      <section className="pane bin-table">
        <div className="pane-h">
          <span className="ph-ttl">今日用户结算</span>
          <span className="ph-sub">结算日按越南时间（UTC+7）划分</span>
          <span className="ph-r" style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Link className="fbtn" href="/network/commissions">去补发 / 冲正</Link>
            {canSettle && <button className="fbtn primary" onClick={() => ctx.openActionConfirm({
              name: "手动结算左右团队奖",
              businessForm: {
                kind: "multi-field",
                title: "用户和结算日",
                hint: "结算日按越南时间（UTC+7）划分；2026-10-19 之前按旧时区（UTC+8），不重算。系统会自动检查是否满足结算条件、是否已经结算过。",
                fields: [
                  { key: "ownerUserId", label: "用户编号", inputKind: "number", min: 1, required: true },
                  { key: "settlementDate", label: "结算日（YYYY-MM-DD）", inputKind: "text", placeholder: "例如 2026-10-19", required: true },
                ],
              },
              detail: "结算后奖励进入冷却期，并记入资金流水和操作记录。同一用户同一天重复提交不会重复发放。",
              run: async (reason, businessValue) => {
                const ownerUserId = Number(businessValue?.ownerUserId);
                const settlementDate = String(businessValue?.settlementDate ?? "").trim();
                if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) throw new Error("请输入有效用户编号");
                if (!/^\d{4}-\d{2}-\d{2}$/.test(settlementDate)) throw new Error("结算日格式应为 YYYY-MM-DD");
                const result = await ctx.executeF3Settlement(ownerUserId, settlementDate, reason);
                if (result.status === "BLOCKED") {
                  ctx.toast(`没有结算 · ${result.reason || "未满足结算条件"} · 没有资金变动`);
                  return;
                }
                ctx.toast(result.replayed
                  ? `这天已经结算过，没有重复发放 · 佣金记录 ${result.commissionEventId ?? "—"}`
                  : `已结算 · ${usd(result.amountUsdt)} 进入冷却期`);
              },
            })}>手动结算</button>}
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
                {userOptions.length === 0 && <div className="bin-user-empty">没有匹配的用户</div>}
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
        {pager.pageRows.length === 0 && <div className="bin-empty">没有匹配的用户</div>}
        <DataListPager
          label="用户结算明细"
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
          <div className="ch">每侧业绩门槛</div>
          <div className="cs">两侧都达到才参与结算 · 下一期生效</div>
          <div className="ckv"><span className="k">当前门槛</span><span className="v">{text(thEff)}</span></div>
          <div className="ckv"><span className="k">未达门槛的业绩</span><span className="v">{text(cfg?.residualPool)}</span></div>
          <div className="ckv"><span className="k">未匹配业绩处理</span><span className="v" style={{ color: "var(--ink-3)" }}>{text(residualEff)}</span></div>
          {canConfigure && <div className="cfg-foot"><button className="fbtn primary" onClick={() => ctx.openActionConfirm({ name: "调整每侧业绩门槛", op: "param", paramKey: "F.binary.threshold", edit: { kind: "text", current: thEff }, detail: `每侧业绩门槛 · 当前 ${text(thEff)} · 从下一期开始生效，本期已算的不变。` })}>调整门槛</button></div>}
        </div>

        <div className="cfg-card">
          <div className="ch">匹配比例</div>
          <div className="cs">⚡ 调高会多发佣金，先看兑付覆盖率</div>
          <div className="ckv"><span className="k">当前比例</span><span className="v" style={{ color: "var(--brand)" }}>{text(rateEff)}</span></div>
          <div className="ckv"><span className="k">今日匹配总额</span><span className="v">{usd(ctx.f3DailyMatchUsd)}</span></div>
          <div className="ckv"><span className="k">月累计匹配</span><span className="v">{usd(ctx.f3MonthlyMatchedUsd)}</span></div>
          {canConfigure && <div className="cfg-foot"><button className="fbtn primary amp" onClick={() => ctx.openActionConfirm({
            name: "调整匹配比例",
            amplify: true,
            op: "param",
            paramKey: "F.binary.matchRate",
            edit: { kind: "text", current: rateEff, unit: "%" },
            detail: `较小一侧业绩 × 这个比例 = 奖励 · 当前 ${text(rateEff)}。调高会多发佣金，先看兑付覆盖率。从下一期开始生效，已算的不变。`,
            completionCopy: "从下一期开始生效，已算的不变。",
          })}>调整比例</button></div>}
        </div>

        <div className="cfg-card">
          <div className="ch">自动安置与归零</div>
          <div className="cs">业绩每月 1 日 00:00（越南时间）归零</div>
          <div className="ckv"><span className="k">自动安置</span><span className="v" style={{ color: spillOn ? "var(--success)" : "var(--ink-3)" }}>{spillOn ? "已启用" : "已关闭"}</span></div>
          <div className="ckv"><span className="k">近 7 天自动安置</span><span className="v">{ctx.f3AutoPlacement7dCount.toLocaleString()} 成员</span></div>
          <div className="ckv"><span className="k">归零时间</span><span className="v" style={{ fontSize: 11 }}>{text(resetEff)}</span></div>
          {canConfigure && <div className="cfg-foot">
            <button className="fbtn" onClick={() => ctx.openActionConfirm({ name: "调整自动安置", op: "param", paramKey: "F.binary.spillover", edit: { kind: "select", current: spillOn ? "已启用" : "已关闭", options: ["已启用", "已关闭"] }, detail: "关闭后，新成员需要手动安排到 A 侧或 B 侧。" })}>自动安置</button>
            {/* 归零口径恢复可配(2026-08-06 主人裁决):后端结算策略一直读这个配置键、契约测试也把它
                列进合法配置键清单,只是页面把入口撤了 —— 后端可配而控制台无门,是半截状态。
                🔴 键名从 client 常量取、页面只出中文标签:本页有一道术语门扫原文(含注释),
                禁止开发代号出现在页面正文里。 */}
            <button className="fbtn" onClick={() => ctx.openActionConfirm({ name: "调整业绩归零时间", op: "param", paramKey: F3_GV_RESET_PARAM_KEY, edit: { kind: "select", current: resetEff, options: ["每月 1 日 00:00 Asia/Ho_Chi_Minh"], optionLabels: { "每月 1 日 00:00 Asia/Ho_Chi_Minh": "每月 1 日 00:00 越南时间 UTC+7" } }, detail: `两侧累计业绩的归零时间 · 当前 ${text(resetEff)} · 从下一期开始生效，已算的不变。` })}>归零时间</button>
          </div>}
        </div>

        <div className="cfg-card">
          <div className="ch">结算周期与未匹配业绩处理</div>
          <div className="cs">多久结算一次、没匹配上的业绩怎么处理 · 下一期生效</div>
          <div className="ckv"><span className="k">结算周期</span><span className="v" style={{ color: "var(--brand)" }}>{text(periodEff)}</span></div>
          <div className="ckv"><span className="k">未匹配业绩处理</span><span className="v">{text(residualEff)}</span></div>
          {canConfigure && <div className="cfg-foot"><button className="fbtn primary amp" onClick={() => ctx.openActionConfirm({
            name: "结算周期与未匹配业绩处理调整",
            op: "param-multi",
            amplify: true,
            businessForm: {
              kind: "multi-field",
              title: "结算周期与未匹配业绩处理",
              hint: "按越南时间（UTC+7）划分：每日 00:00、每周一 00:00、每月 1 日 00:00；2026-10-19 之前的周期不重算。「未匹配业绩」指两侧匹配后较大一侧多出来的业绩。选「转结」会留到下一期，增加之后要付的佣金，先看兑付覆盖率。",
              fields: [
                { key: "period", label: "结算周期", current: periodEff, inputKind: "select", options: ["每日", "每周", "每月"] },
                { key: "residual", label: "未匹配业绩处理", current: residualEff, inputKind: "select", options: ["每月清零", "每次对碰清零", "转结"] },
              ],
            },
            paramKeys: [
              { key: "period", paramKey: "F.binary.settlePeriod" },
              { key: "residual", paramKey: "F.binary.residualPolicy" },
            ],
            detail: "从下一期开始生效，已算的不变。选「转结」会增加之后要付的佣金，先看兑付覆盖率。",
            completionCopy: "从下一期开始生效，已算的不变。",
          })}>调整</button></div>}
        </div>

        <div className="cfg-card">
          <div className="ch">暂停左右团队奖</div>
          <div className="cs">⚡ 紧急情况下暂停全平台发放</div>
          <div className="ckv"><span className="k">状态</span><span className="v" style={{ color: binaryPaused ? "var(--danger)" : "var(--success)" }}>{binaryPaused ? "已暂停" : "运行中"}</span></div>
          <div className="ckv"><span className="k">影响范围</span><span className="v" style={{ color: "var(--ink-3)" }}>{binaryPaused ? "全平台暂停发放" : "按周期正常发放"}</span></div>
          {canPause && <div className="cfg-foot"><button className={`fbtn${binaryPaused ? " primary" : " danger"}`} onClick={() => ctx.openActionConfirm({
            name: binaryPaused ? "恢复左右团队业绩结算" : "暂停左右团队业绩结算",
            op: "dispose", paramKey: "F.binary.paused", fixedVal: binaryPaused ? "off" : "on",
            detail: binaryPaused
              ? "恢复后从下一期开始正常发放。"
              : "暂停后全平台所有用户的左右团队奖都停发，只在紧急情况下使用。",
          })}>{binaryPaused ? "恢复发放" : "暂停发放"}</button></div>}
        </div>
      </div>

      <p className="f-foot">两侧团队均达到门槛后参与结算。未匹配业绩按当前设置「{text(residualEff)}」处理；若结转至下期，会增加后续佣金应付款，修改前先看兑付覆盖率。</p>
    </>
  );
}
