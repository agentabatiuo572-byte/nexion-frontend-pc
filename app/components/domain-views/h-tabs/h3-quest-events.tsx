"use client";

/**
 * H3 任务引擎 + H4 活动中心(合页) — design_handoff_h_domain · H3 任务与活动.html 1:1 port。
 *
 * 9 大块(严格按设计稿 DOM 顺序;两段统一渲染一页 · 不再做 chips 切换):
 *  (a) H3 顶部 4 张 f-stat KPI(H3_STATS 派生)
 *  (b) 首日任务(Day-One)
 *      - 3 行 q-row(== p-row):时窗 / 三相奖励 / 6 任务清单
 *      - 三相状态 strip(.sm-strip · DAY_ONE_STATES)
 *      - 改时窗 / 改奖励 操作确认(amplifies=true)+ 6 任务表(只读展示 · 单行调奖励走 操作确认 amplifies=true)
 *  (c) 每周任务(两档 + 周冠军 + 阶段倍率)
 *      - 一档 9 / 二档 8 → 两张 l-tbl
 *      - 6 阶段乘数曲线 .mult-track(P3 cur 高亮)
 *      - 周冠军 +500 NEX × P3 1.1× cyan tint
 *      - 单条 / 周冠军 / 阶段倍率三种 操作确认 均 amplifies=true(升 NEX 流出)
 *  (d) 月度挑战(5 主题表)
 *      - 改任一主题奖励 操作确认(amplifies=true)
 *  (e) 完成监控 3 行 + 阶段加成只读条
 *  (f) H4 顶部 4 张 f-stat KPI
 *  (g) 活动列表 8 玩法 CMS
 *      - 列:name / kind chip / state bdg / reward / featured ⭐ / 操作[编辑(操作确认)/ 上下架(操作确认 不挂)/ 切 featured(操作确认 不挂 · server 唯一性)]
 *      - 玩法图例 sm-strip(upcoming / ongoing / ended + joined / done / claimed)
 *  (h) 转盘治理(两栏 two-col):
 *      - 左:8 档 .wheel-row(tier/reward/prob/real 红 chip/kind)+ 合计校验(==100 绿,!=100 红)+ 改奖池 操作确认(amplifies=true)
 *      - 右:3 行护栏(budget/cap/kill)+ kill 走 KConfirmModal(急停 · 必填原因)
 *      - 转盘 EV ≈ $0.78/spin cyan tint
 *  (i) Trackable 4 行 l-tbl(只读消费 E/F/G 状态;表头注「只读 · 各域状态消费」)
 *
 * 真写键(全部 H3.* / H4.* 单源):
 *  H3.dayOne.<id>.reward(id = 0..5,任务序号)/ H3.dayOne.windowMs(amplifies)/
 *  H3.weekly.t1.<idx> / H3.weekly.t2.<idx> / H3.weekly.champBonus(amplifies)/
 *  H3.weekly.mult.<P>(P1..P6 · amplifies)/ H3.monthly.<id>.reward(amplifies)/
 *  H4.event.<id>.status(ongoing/upcoming/ended · 非 amplifies)/ H4.event.<id>.featured = "1"(server 同时只 1 个 422)/
 *  H4.event.<id>.reward(amplifies)/ H4.wheel(奖池签名 · amplifies · server 重算 weight 和 + 档位 + 真实奖过 B1)/
 *  H4.guard.budget / H4.guard.cap / H4.guard.kill(KConfirmModal 急停 · 必填原因)。
 *
 * amplifies 触发(过 B1 100% 红线):
 *  - 改首日 / 周 / 月奖励、改阶段倍率、改周冠军加奖、改活动奖励、改转盘奖池(真实奖 > B1 拒)。
 *  - 处置类(上下架 / 切 featured / 改窗注 detail A 方案不追溯)不挂。
 */
import Link from "next/link";
import { useState } from "react";
import { PaginationExemptionList } from "../design-kit";
import {
  H3_STATS,
  H4_STATS,
  DAY_ONE_TASKS,
  DAY_ONE_STATES,
  WEEKLY_T1,
  WEEKLY_T2,
  WEEKLY_MULT,
  MONTHLY_MISSIONS,
  TASK_MONITOR,
  EVENTS_CMS,
  EVENT_STATE,
  WHEEL_TIERS,
  WHEEL_EV_USD,
  WHEEL_GUARDS,
  TRACKABLES,
  type EventState,
} from "./data";
import type { HCtx } from "./types";

export function H3QuestEvents({ ctx }: { ctx: HCtx }) {
  const { pget, setParam, toast, openActionConfirm, openConfirm, logAudit } = ctx;
  // segmented section:H3 任务引擎 ↔ H4 活动中心(忠实设计稿 chip 切换;FOLD 在 h-view 路由层完成,叶子页内仍按设计稿 .chip[sel] 分段)。
  const [sec, setSec] = useState<"h3" | "h4">("h3");

  /** 单源:取当前奖励(优先 pget,fallback 设计稿)。 */
  const dayOneReward = (id: number, seed: string) => pget(`H3.dayOne.${id}.reward`) ?? seed;
  const dayOneWindow = () => pget("H3.dayOne.windowMs") ?? "24h 全额 / 72h 宽限";
  const weeklyT1 = (idx: number, seed: string) => pget(`H3.weekly.t1.${idx}`) ?? seed;
  const weeklyT2 = (idx: number, seed: string) => pget(`H3.weekly.t2.${idx}`) ?? seed;
  const champBonus = () => pget("H3.weekly.champBonus") ?? "+500 NEX × P3 1.1×";
  const multAt = (p: string, seed: string) => pget(`H3.weekly.mult.${p}`) ?? seed;
  const monthlyReward = (id: string, seed: string) => pget(`H3.monthly.${id}.reward`) ?? seed;
  const eventStatus = (id: string, seed: EventState): EventState =>
    ((pget(`H4.event.${id}.status`) as EventState) ?? seed);
  const eventReward = (id: string, seed: string) => pget(`H4.event.${id}.reward`) ?? seed;
  const eventFeatured = (id: string, seed: boolean) => (pget(`H4.event.${id}.featured`) ?? (seed ? "1" : "")) === "1";

  /** 转盘:概率合计校验(WHEEL_TIERS reduce · 用户改值已写 H4.wheel 签名,前端只对设计稿做完整性显示)。 */
  const probSum = WHEEL_TIERS.reduce((s, t) => s + t.prob, 0);
  const probOk = Math.abs(probSum - 100) < 0.01;

  /* ========= 通用 操作确认 opener ========= */

  /** 改首日时窗 — A 方案不追溯。 */
  const openWindowMc = () => {
    const cur = dayOneWindow();
    openActionConfirm({
      action: "改首日任务时窗",
      detail: (
        <>
          <b>当前 {cur}</b> · 改窗的相位语义二选一:
          <b>per-instance 快照(A 方案)</b>= 在窗用户按各自进窗时间锁定不追溯;
          <b>全局即时重算(B 方案)</b>= 全部按新窗重算可能引发结算抖动 — <b>走 A 方案</b>。
          接口文档已固化,后端按 A 方案落地。改后只对<b>新进窗</b>用户生效;
          缩短窗 = 收紧不影响 B1,放宽窗 = 放大流出走 B1 红线核验。
        </>
      ),
      amplifies: true,
      edit: { kind: "text", current: cur },
      run: (reason, v) => {
        if (!v) return;
        setParam("H3.dayOne.windowMs", v, { action: "改首日任务时窗", reason });
        toast(`· 首日时窗已改为 ${v} · A 方案 · 仅新进窗生效 · 已过 B1 覆盖率核验`);
      },
    });
  };

  /** 改首日三相奖励(总分 500/200/0)。 */
  const openTriRewardMc = () => {
    const cur = pget("H3.dayOne.triReward") ?? "500 / 200 / 0 NEX";
    openActionConfirm({
      action: "改首日三相奖励",
      detail: (
        <>
          <b>当前 {cur}</b> · 24h 全额 / 72h 宽限 / expired 0。
          <b>升任一档 = 放大 NEX 流出</b>,提交即过 B1 备付金红线(不足直接 422);
          改动只对新进窗用户生效,在窗按锁定值结算。执行门槛 = 财务主管。
        </>
      ),
      amplifies: true,
      edit: { kind: "text", current: cur },
      run: (reason, v) => {
        if (!v) return;
        setParam("H3.dayOne.triReward", v, { action: "改首日三相奖励", reason });
        toast(`· 首日三相奖励已改为 ${v} · 已过 B1 覆盖率核验`);
      },
    });
  };

  /** 单首日任务奖励改。 */
  const openDayOneRewardMc = (id: number, name: string, cur: string) => {
    openActionConfirm({
      action: `改首日任务奖励 · ${name}`,
      detail: (
        <>
          <b>{name}</b> · 当前 {cur} · 跳转路径决定完成判定(服务器二次确认,谎报无效)。
          <b>升奖励 = 放大 NEX 流出</b>,提交即过 B1 红线;改动只对新进窗用户生效。
        </>
      ),
      amplifies: true,
      edit: { kind: "text", current: cur },
      run: (reason, v) => {
        if (!v) return;
        setParam(`H3.dayOne.${id}.reward`, v, { action: `改首日任务奖励 ${name}`, reason });
        toast(`· ${name} 奖励已改为 ${v} · 已过 B1 覆盖率核验`);
      },
    });
  };

  /** 周一档单条改。 */
  const openWeeklyT1Mc = (idx: number, cond: string, cur: string) => {
    openActionConfirm({
      action: `改周一档奖励 · ${cond}`,
      detail: (
        <>
          <b>{cond}</b> · 当前 {cur} NEX · 一档按从上到下优先级命中第一条派发。
          <b>升奖励 = 放大 NEX 流出</b>,过 B1 红线;同周锁定、下周生效。
        </>
      ),
      amplifies: true,
      edit: { kind: "text", current: cur },
      run: (reason, v) => {
        if (!v) return;
        setParam(`H3.weekly.t1.${idx}`, v, { action: `改周一档 ${cond}`, reason });
        toast(`· 周一档 ${cond} 已改为 ${v} · 下周生效`);
      },
    });
  };

  /** 周二档单条改。 */
  const openWeeklyT2Mc = (idx: number, cond: string, cur: string) => {
    openActionConfirm({
      action: `改周二档奖励 · ${cond}`,
      detail: (
        <>
          <b>{cond}</b> · 当前 {cur} NEX · 二档是完成池(每条独立派发)。
          <b>升奖励 = 放大 NEX 流出</b>,过 B1 红线;同周锁定、下周生效。
        </>
      ),
      amplifies: true,
      edit: { kind: "text", current: cur },
      run: (reason, v) => {
        if (!v) return;
        setParam(`H3.weekly.t2.${idx}`, v, { action: `改周二档 ${cond}`, reason });
        toast(`· 周二档 ${cond} 已改为 ${v} · 下周生效`);
      },
    });
  };

  /** 周冠军 bonus。 */
  const openChampMc = () => {
    const cur = champBonus();
    openActionConfirm({
      action: "改周冠军加奖",
      detail: (
        <>
          <b>当前 {cur}</b> · 周冠军(累计 NEX 最高)额外加奖,落在阶段倍率之上。
          <b>升加奖 = 放大 NEX 流出</b>,过 B1 红线;同周锁定、下周生效。
        </>
      ),
      amplifies: true,
      edit: { kind: "text", current: cur },
      run: (reason, v) => {
        if (!v) return;
        setParam("H3.weekly.champBonus", v, { action: "改周冠军加奖", reason });
        toast(`· 周冠军加奖已改为 ${v} · 下周生效`);
      },
    });
  };

  /** 阶段倍率某档改。 */
  const openMultMc = (p: string, cur: string) => {
    openActionConfirm({
      action: `改阶段倍率 · ${p}`,
      detail: (
        <>
          <b>{p} 当前 {cur}</b> · 阶段倍率乘在<b>每周任务</b>(一档 + 二档 + 周冠军)结算上;
          全局任务加成(H1 派发 · 本页只读)是另一条乘子,两者相乘生效。
          <b>升倍率 = 放大全周 NEX 流出</b>,过 B1 红线;执行门槛 = 财务主管;
          本档生效仅在该 phase 区间(P3 = 月 5–7 当前)。
        </>
      ),
      amplifies: true,
      edit: { kind: "text", current: cur },
      run: (reason, v) => {
        if (!v) return;
        setParam(`H3.weekly.mult.${p}`, v, { action: `改阶段倍率 ${p}`, reason });
        toast(`· ${p} 阶段倍率已改为 ${v} · 进入该 phase 时生效`);
      },
    });
  };

  /** 月度主题奖励改。 */
  const openMonthlyMc = (id: string, theme: string, cur: string) => {
    openActionConfirm({
      action: `改月度挑战奖励 · ${theme}`,
      detail: (
        <>
          <b>{theme}</b> · 当前 {cur} · 3 个子目标全达成才可领,跨月清空重派。
          <b>升奖励 = 放大 NEX 流出</b>,过 B1 红线;改动只对<b>本月新派</b>生效,
          在途按派发时锁定值结算不追溯。
        </>
      ),
      amplifies: true,
      edit: { kind: "text", current: cur },
      run: (reason, v) => {
        if (!v) return;
        setParam(`H3.monthly.${id}.reward`, v, { action: `改月度挑战奖励 ${theme}`, reason });
        toast(`· 月度 ${theme} 奖励已改为 ${v} · 本月新派生效`);
      },
    });
  };

  /** 活动编辑(奖励/文案/时窗)。 */
  const openEventEditMc = (id: string, name: string, curReward: string) => {
    openActionConfirm({
      action: `编辑活动 · ${name}`,
      detail: (
        <>
          可改字段:文案 key(本体归 I 域)/ 奖励 / 时窗(UTC)/ 判定条件 / 主推位。
          <b>主推位同时只能有一个</b>,违反直接 422;<b>升奖励 = 放大 NEX 流出</b>,过 B1 红线;
          改判定字段属前后端联动,走治理。当前奖励 {curReward}。
        </>
      ),
      amplifies: true,
      edit: { kind: "text", current: curReward },
      run: (reason, v) => {
        if (!v) return;
        setParam(`H4.event.${id}.reward`, v, { action: `改活动奖励 ${name}`, reason });
        toast(`· ${name} 奖励已改为 ${v} · 已过 B1 覆盖率核验`);
      },
    });
  };

  /** 活动上下架(处置类 · 不挂 amplifies)。 */
  const openEventToggleMc = (id: string, name: string, cur: EventState) => {
    const next: EventState = cur === "ongoing" ? "ended" : "ongoing";
    const labelNow = cur === "ongoing" ? "下架" : "上架";
    openActionConfirm({
      action: `${labelNow}活动 · ${name}`,
      detail: (
        <>
          <b>{name}</b> · 当前 {EVENT_STATE[cur][0]} · {labelNow}动作:
          {cur === "ongoing"
            ? "下架即停参与和领取,过点请求拒 409;已领不回收;ended 状态下仅可查不可领。"
            : "上架进入进行中,UTC 时窗内可参与。"}
          {" "}操作确认留痕。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        setParam(`H4.event.${id}.status`, next, { action: `${labelNow}活动 ${name}`, reason });
        logAudit({ actor: "总管理员", action: `${labelNow}活动`, target: `H4.event.${id}`, reason });
        toast(`· ${name} 已${labelNow} · 状态 = ${EVENT_STATE[next][0]}`);
      },
    });
  };

  /** 活动主推切换(处置类 · server 唯一性 422)。 */
  const openEventFeaturedMc = (id: string, name: string, curFeat: boolean) => {
    openActionConfirm({
      action: `${curFeat ? "取消主推" : "设为主推"} · ${name}`,
      detail: (
        <>
          <b>{name}</b> · 当前主推 = {curFeat ? "是" : "否"} · 主推位语义:
          <b>同时只能有一个进行中活动占主推位</b>,server 在写入时校验唯一性,
          已有其它活动占据则直接拒(422),需先取消原主推。操作确认留痕。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        setParam(`H4.event.${id}.featured`, curFeat ? "" : "1", {
          action: `${curFeat ? "取消主推" : "设为主推"} ${name}`,
          reason,
        });
        logAudit({ actor: "总管理员", action: curFeat ? "取消活动主推" : "设置活动主推", target: `H4.event.${id}.featured`, reason });
        toast(`· ${name} 主推位已${curFeat ? "取消" : "设置"} · server 唯一性已校验`);
      },
    });
  };

  /** 改转盘奖池(签名一次性写入 H4.wheel · server 三道护栏 + B1)。 */
  const openWheelMc = () => {
    const cur = pget("H4.wheel") ?? `8 档 · EV $${WHEEL_EV_USD.toFixed(2)}/spin`;
    openActionConfirm({
      action: "改转盘奖池 / 概率",
      detail: (
        <>
          <b>当前 {cur}</b> · 档位可增删(2–12 档),每档可改奖项 / 金额 / 概率 / 是否真实奖。
          <b>三道校验</b>:① 概率合计 = 100% · ② 档位 ∈ [2,12] · ③ 真实奖期望过 B1 红线,
          任一不过直接拒(422)。当前真实流出期望 ≈ ${WHEEL_EV_USD.toFixed(2)}/次(WHEEL_TIERS 实算派生)。
          增长执行门槛:财务主管;重复提交不会重复写入(幂等)。
        </>
      ),
      amplifies: true,
      edit: { kind: "text", current: cur },
      run: (reason, v) => {
        if (!v) return;
        setParam("H4.wheel", v, { action: "改转盘奖池", reason });
        toast(`· 转盘奖池已改为 ${v} · 三重校验在 server · 已过 B1`);
      },
    });
  };

  /** 转盘 budget / cap 护栏改(非 kill)。 */
  const openGuardMc = (key: "budget" | "cap", name: string, cur: string) => {
    openActionConfirm({
      action: `改转盘护栏 · ${name}`,
      detail: (
        <>
          <b>{name}</b> · 当前 {cur} · 护栏到顶的行为:真实奖档自动关闭、概率并入安慰档,
          次日(UTC)重置。{key === "budget"
            ? "日派彩预算 = 24h 真实流出累计阈值,到顶当日只发 NEX/积分/券。"
            : "单奖日库存 = 每档限量,某档抽完后该档自动关闭并入安慰档。"}
          操作确认留痕。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur },
      run: (reason, v) => {
        if (!v) return;
        setParam(`H4.guard.${key}`, v, { action: `改转盘护栏 ${name}`, reason });
        toast(`· ${name} 已改为 ${v}`);
      },
    });
  };

  /** 转盘真实奖总开关(KConfirmModal 急停 · 必填原因)。 */
  const openKillConfirm = () => {
    const cur = pget("H4.guard.kill") ?? "开";
    const turnOff = cur === "开";
    openConfirm({
      action: turnOff ? "急停 · 关闭真实奖总开关" : "恢复真实奖总开关",
      detail: (
        <>
          <b>当前 {cur}</b> · {turnOff
            ? "关闭后转盘只发 NEX/积分/券,所有真实奖档(现金 $1/$20/$500、券)立即停发;监管点名「抽奖涉赌」场景的应急止血开关,联动应急矩阵(J1)。"
            : "恢复后真实奖档按原概率开放,B1 覆盖率与 budget/cap 护栏照常生效。"}
          {" "}本动作普通确认但<b>必填原因</b>,1 秒内写日志、5 秒内全网生效。
        </>
      ),
      reason: true,
      okLabel: turnOff ? "确认急停" : "确认恢复",
      chips: turnOff
        ? [["真钱档全部停发", "ready"], ["NEX / 积分 / 券正常", "done"]]
        : [["真钱档按原概率恢复", "ready"], ["B1 + budget/cap 护栏照常", "done"]],
      run: (reason) => {
        setParam("H4.guard.kill", turnOff ? "关" : "开", {
          action: turnOff ? "急停关闭真实奖" : "恢复真实奖",
          reason,
        });
        logAudit({ actor: "总管理员", action: turnOff ? "急停真实奖总开关" : "恢复真实奖总开关", target: "H4.guard.kill", reason });
        toast(`· 真实奖总开关已${turnOff ? "关闭(急停)" : "恢复"} · 已留痕`);
      },
    });
  };

  return (
    <>
      {/* segmented 切换:H3 任务引擎 ↔ H4 活动中心(设计稿 .chips 原样还原)。 */}
      <div className="chips" style={{ marginBottom: 16 }}>
        <button className={`chip${sec === "h3" ? " sel" : ""}`} onClick={() => setSec("h3")}>H3 任务引擎</button>
        <button className={`chip${sec === "h4" ? " sel" : ""}`} onClick={() => setSec("h4")}>H4 活动中心</button>
      </div>

      {/* =========================================================== */}
      {/* 段 1 · H3 任务引擎(顶部 KPI + 首日 + 每周 + 月度 + 监控) */}
      {/* =========================================================== */}
      {sec === "h3" && <>

      {/* (a) H3 顶部 KPI */}
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">首日任务领取率</div>
          <div className="v">{H3_STATS.dayOneRate24h} / {H3_STATS.dayOneRateGrace}</div>
          <div className="sub">24h 内全额 · 宽限期降档领</div>
        </div>
        <div className="f-stat ok">
          <div className="k">本周任务完成</div>
          <div className="v">{H3_STATS.weeklyDone}</div>
          <div className="sub">Tier1 {H3_STATS.t1Done} · Tier2 {H3_STATS.t2Done}</div>
        </div>
        <div className="f-stat warn">
          <div className="k">本周 NEX 派发</div>
          <div className="v">{H3_STATS.weeklyNex}</div>
          <div className="sub">含 Phase 加成 {H3_STATS.phaseBonusP3}</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">月度挑战在途</div>
          <div className="v">{H3_STATS.monthlyInflight.toLocaleString()} 人</div>
          <div className="sub">5 主题按账龄自动派发</div>
        </div>
      </div>

      {/* (b)(c) Day-One + Weekly 双列 */}
      <div className="two-col">
        {/* (b) Day-One */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">首日任务(Day-One)</span>
            <span className="sub">· 新人转化最核心的钩子 · 改动只影响新进窗用户</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="p-row">
              <span className="k">
                时窗
                <small>改窗对在窗用户的相位语义:走 A 方案(per-instance 快照),按各自进窗时间锁定不追溯;接口文档已固化。</small>
              </span>
              <span className="v">{dayOneWindow()}</span>
              <button className="l-btn sm mc" onClick={openWindowMc}>调整</button>
            </div>
            <div className="p-row">
              <span className="k">完成奖励(三相)</span>
              <span className="v">{pget("H3.dayOne.triReward") ?? "500 / 200 / 0 NEX"}</span>
              <button className="l-btn sm mc" onClick={openTriRewardMc}>调整</button>
            </div>

            {/* 6 任务清单(逐行 · 可调) */}
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table className="l-tbl" style={{ minWidth: 460 }}>
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>跳转路径</th>
                    <th className="num">奖励</th>
                    <th style={{ textAlign: "right" }}>动作</th>
                  </tr>
                </thead>
                <tbody>
                  {DAY_ONE_TASKS.map((t, i) => {
                    const cur = dayOneReward(i, t.reward);
                    return (
                      <tr key={t.task}>
                        <td style={{ fontWeight: 600, color: "var(--ink)" }}>{t.task}</td>
                        <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{t.href}</td>
                        <td className="num mono" style={{ fontWeight: 700 }}>{cur}</td>
                        <td style={{ textAlign: "right" }}>
                          <button className="l-btn sm mc" onClick={() => openDayOneRewardMc(i, t.task, cur)}>调整</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 三相状态 strip */}
            <div className="sm-strip" style={{ marginTop: 10 }}>
              {DAY_ONE_STATES.map((s, idx) => (
                <span key={s.st}>
                  <span className={`st ${s.tone}`}>{s.label}</span>
                  {idx < DAY_ONE_STATES.length - 1 && <span className="ar">→</span>}
                </span>
              ))}
            </div>

            <div className="htint" style={{ marginTop: 10, fontSize: 12 }}>
              <b>状态机</b> · active(24h 内 6 项完成领 500)→ grace(72h 内 200)→ expired(0,首页让位)。
              逛商城等路径任务按真实行为二次确认,谎报无效。
            </div>
          </div>
        </section>

        {/* (c) Weekly */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">每周任务(两档 + 周冠军)</span>
            <span className="sub">· 按周键确定性派发 · 同周锁定 · 改动下周生效</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {/* 一档 9 条 */}
            <div style={{ fontSize: 12, fontWeight: 600, margin: "2px 0 6px", color: "var(--ink-2)" }}>
              一档(9 条优先级派发 · 命中第一条)
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="l-tbl" style={{ minWidth: 360 }}>
                <thead>
                  <tr>
                    <th>条件(优先级自上而下)</th>
                    <th className="num">奖励 NEX</th>
                    <th style={{ textAlign: "right" }}>动作</th>
                  </tr>
                </thead>
                <tbody>
                  {WEEKLY_T1.map((t, idx) => {
                    const cur = weeklyT1(idx, t.reward);
                    return (
                      <tr key={t.cond}>
                        <td style={{ fontWeight: 600, color: "var(--ink)" }}>{t.cond}</td>
                        <td className="num mono" style={{ fontWeight: 700 }}>{cur}</td>
                        <td style={{ textAlign: "right" }}>
                          <button className="l-btn sm mc" onClick={() => openWeeklyT1Mc(idx, t.cond, cur)}>调整</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 二档 8 条 */}
            <div style={{ fontSize: 12, fontWeight: 600, margin: "14px 0 6px", color: "var(--ink-2)" }}>
              二档(8 条完成池 · 每条独立派发)
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="l-tbl" style={{ minWidth: 360 }}>
                <thead>
                  <tr>
                    <th>任务</th>
                    <th className="num">奖励 NEX</th>
                    <th style={{ textAlign: "right" }}>动作</th>
                  </tr>
                </thead>
                <tbody>
                  {WEEKLY_T2.map((t, idx) => {
                    const cur = weeklyT2(idx, t.reward);
                    return (
                      <tr key={t.cond}>
                        <td style={{ fontWeight: 600, color: "var(--ink)" }}>{t.cond}</td>
                        <td className="num mono" style={{ fontWeight: 700 }}>{cur}</td>
                        <td style={{ textAlign: "right" }}>
                          <button className="l-btn sm mc" onClick={() => openWeeklyT2Mc(idx, t.cond, cur)}>调整</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 周冠军 cyan tint */}
            <div className="htint cyan" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
              <span style={{ flex: 1 }}>
                <b>周冠军加奖</b> · {champBonus()} · 累计 NEX 最高的当周用户额外加奖
              </span>
              <button className="l-btn sm mc" onClick={openChampMc}>调整</button>
            </div>

            {/* 6 阶段乘数曲线 */}
            <div style={{ fontSize: 12, fontWeight: 600, margin: "12px 0 6px", color: "var(--ink-2)" }}>
              阶段倍率曲线(点档位调整 · 执行门槛 = 财务主管)
            </div>
            <div className="mult-track">
              {WEEKLY_MULT.map((m) => {
                const cur = multAt(m.p, m.mult);
                const isCur = m.p.startsWith("P3");
                return (
                  <div
                    key={m.p}
                    className={`seg${isCur ? " cur" : ""}`}
                    onClick={() => openMultMc(m.p, cur)}
                    style={{ cursor: "pointer" }}
                    title="点击改值(操作确认)"
                  >
                    <div className="m">{m.p}</div>
                    <div className="vv">{cur}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      {/* (d)(e) Monthly + Monitor 双列 */}
      <div className="two-col">
        {/* (d) Monthly */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">月度挑战(5 主题按账龄派发)</span>
            <span className="sub">· 每主题 3 个子目标全达成才可领 · 跨月清空重派</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>主题</th>
                  <th>账龄段</th>
                  <th className="num">奖励</th>
                  <th>子目标</th>
                  <th style={{ textAlign: "right" }}>动作</th>
                </tr>
              </thead>
              <tbody>
                {MONTHLY_MISSIONS.map((m) => {
                  const cur = monthlyReward(m.id, m.reward);
                  return (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 600, color: "var(--ink)" }}>{m.theme}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{m.age}</td>
                      <td className="num mono" style={{ fontWeight: 700 }}>{cur} NEX</td>
                      <td style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{m.goals}</td>
                      <td style={{ textAlign: "right" }}>
                        <button className="l-btn sm mc" onClick={() => openMonthlyMc(m.id, m.theme, cur)}>编辑</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* (e) 阶段加成只读 + 完成监控 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">阶段加成(只读)与完成监控</span>
            <span className="sub">· 全局任务加成归 H1 派发 · 这页只套用</span>
            <div className="r">
              <Link href="/growth/phase" className="l-btn">去 H1 调整 →</Link>
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="htint warn" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1 }}>
                <b>全局任务加成 🔒 H1 派发</b> · 规划:月 1–2 = 4×(拉新期最强抓手),其他 1×;
                <b>用户端还没实装这个旋钮,实装前结算一律按 1×</b>。要调去 H1。
              </span>
              <span className="v mono" style={{ fontWeight: 700 }}>当前 1×</span>
            </div>
            <div className="htint" style={{ marginTop: 8, fontSize: 12 }}>
              <b>两套倍率别混</b> · 左边「一档阶段倍率」(1.0→1.5)是每周任务自己的曲线,本页可改;
              「全局任务加成」(4×)是 H1 的节奏旋钮,本页只读 —— 都在结算时相乘生效,但来源和确认线不同。
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, margin: "12px 0 4px", color: "var(--ink-2)" }}>
              完成 / 领取监控(服务器台账)
            </div>
            {TASK_MONITOR.map((t) => (
              <div className="p-row" key={t.label}>
                <span className="k"><b>{t.label}:</b> {t.note}</span>
              </div>
            ))}

            <div className="htint dim" style={{ marginTop: 8, fontSize: 12 }}>
              <b>结算</b> · 重复领取不重复入账;过期 vs 领取 → <b>过期优先</b>,窗后到的拒。
              任务事件喂 L 域 BI;任务引出的下单进 B3,任务本身不进。
            </div>
          </div>
        </section>
      </div>

      </>}

      {/* =========================================================== */}
      {/* 段 2 · H4 活动中心(顶部 KPI + 活动 CMS + 转盘 + Trackable) */}
      {/* =========================================================== */}
      {sec === "h4" && <>

      {/* (f) H4 顶部 KPI */}
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">进行中活动</div>
          <div className="v">{H4_STATS.ongoing}</div>
          <div className="sub">主推位:{H4_STATS.featuredEv}(唯一)</div>
        </div>
        <div className="f-stat ok">
          <div className="k">可追踪活动转化</div>
          <div className="v">参与 {H4_STATS.trackJoin}</div>
          <div className="sub">达标 {H4_STATS.trackDone} · 已领 {H4_STATS.trackClaim}</div>
        </div>
        <div className="f-stat warn">
          <div className="k">今日转盘派彩</div>
          <div className="v">{H4_STATS.wheelToday}</div>
          <div className="sub">预算护栏内 · 真实奖正常开放</div>
        </div>
        <div className="f-stat danger">
          <div className="k">地域屏蔽活动</div>
          <div className="v">{H4_STATS.geoBlocked}</div>
          <div className="sub">边缘 IP 判定 · 应急编排归 J1</div>
        </div>
      </div>

      {/* (g)(h) 活动列表 + 转盘治理 双列 */}
      <div className="two-col">
        {/* (g) 活动列表 8 玩法 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">活动列表(玩法闭集 8 种 · 当前演示 {EVENTS_CMS.length} 条)</span>
            <span className="sub">· 主推位同时只能有一个 · 时间全按 UTC · 闭集:discount/referral/wheel/regional/onboarding/boost/seasonal/holding</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>活动</th>
                  <th>玩法</th>
                  <th>状态</th>
                  <th className="num">奖励</th>
                  <th>主推</th>
                  <th style={{ textAlign: "right" }}>动作</th>
                </tr>
              </thead>
              <tbody>
                {EVENTS_CMS.map((e) => {
                  const st = eventStatus(e.id, e.state);
                  const stMeta = EVENT_STATE[st];
                  const rew = eventReward(e.id, e.reward);
                  const feat = eventFeatured(e.id, e.featured);
                  const canToggle = st !== "ended";
                  return (
                    <tr key={e.id}>
                      <td style={{ fontWeight: 600, color: "var(--ink)" }}>{e.name}</td>
                      <td><span className="bdg dim">{e.kind}</span></td>
                      <td><span className={`bdg ${stMeta[1]}`}>{stMeta[0]}</span></td>
                      <td className="num mono">{rew}</td>
                      <td>{feat ? <span className="bdg warn">⭐ 主推</span> : <span style={{ color: "var(--ink-4)" }}>—</span>}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button
                          className="l-btn sm mc"
                          onClick={() => openEventEditMc(e.id, e.name, rew)}
                          disabled={st === "ended"}
                        >
                          编辑
                        </button>{" "}
                        {canToggle && (
                          <>
                            <button className="l-btn sm mc" onClick={() => openEventToggleMc(e.id, e.name, st)}>
                              {st === "ongoing" ? "下架" : "上架"}
                            </button>{" "}
                          </>
                        )}
                        {st === "ongoing" && (
                          <button className="l-btn sm mc" onClick={() => openEventFeaturedMc(e.id, e.name, feat)}>
                            {feat ? "取消主推" : "设主推"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 10 }}>
            <div className="sm-strip">
              <span className="st">upcoming 预告</span>
              <span className="ar">到点 →</span>
              <span className="st ok">ongoing 进行中</span>
              <span className="ar">到期/下架 →</span>
              <span className="st">ended 已结束(可查不可领)</span>
              <span className="ar" style={{ marginLeft: 10 }}>参与:</span>
              <span className="st">joined</span>
              <span className="ar">→</span>
              <span className="st warn">done 达标</span>
              <span className="ar">→</span>
              <span className="st ok">claimed 已领</span>
            </div>
            <div className="htint" style={{ marginTop: 8, fontSize: 12 }}>
              <b>可追踪活动</b> · 进度按真实状态判(Pro 持有 / 直推数 / V 级 / NEX 余额),
              状态在各域维护这里只读;装饰型活动的「参与数」只是展示。文案归 I 域,活动结构归这页。
            </div>
          </div>
        </section>

        {/* (h) 转盘治理 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">抽奖转盘治理</span>
            <span className="sub">· 一个转盘一张奖池表(日免费 + 签到满 30 天加抽票共用)</span>
            <div className="r">
              <button className="l-btn mc" onClick={openWheelMc}>改奖池 / 概率(操作确认)</button>
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {/* 表头 */}
            <div
              className="wheel-row"
              style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-4)" }}
            >
              <span>档位</span>
              <span>奖项</span>
              <span>概率</span>
              <span>性质</span>
              <span></span>
            </div>
            {WHEEL_TIERS.map((w) => {
              const real = w.real;
              return (
                <div className="wheel-row" key={w.tier}>
                  <span style={{ fontWeight: 600, color: "var(--ink)" }}>{w.tier}</span>
                  <span className="mono">{w.reward}</span>
                  <span className="mono" style={{ fontWeight: 700 }}>{w.prob}%</span>
                  <span>
                    {real ? (
                      <span className="bdg bad">真实流出</span>
                    ) : (
                      <span className="bdg dim">{w.kind}</span>
                    )}
                  </span>
                  <span></span>
                </div>
              );
            })}

            {/* 概率合计校验 */}
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 12, color: "var(--ink-4)" }}>概率合计</span>
              <span className={`bdg ${probOk ? "ok" : "bad"}`}>
                = {probSum.toFixed(1)}%{probOk ? "" : " · 不等于 100,server 422"}
              </span>
            </div>

            {/* 3 行护栏 */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 8,
                marginTop: 10,
              }}
            >
              {WHEEL_GUARDS.map((g) => {
                const cur = pget(`H4.guard.${g.key}`) ?? g.value;
                const isKill = g.key === "kill";
                return (
                  <div
                    key={g.key}
                    className="htint"
                    style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span style={{ flex: 1 }}>
                      <b>{g.label}</b> {cur}
                      {g.note && (
                        <>
                          <br />
                          <span style={{ color: "var(--ink-4)" }}>{g.note}</span>
                        </>
                      )}
                    </span>
                    <button
                      className="l-btn sm mc"
                      onClick={() =>
                        isKill
                          ? openKillConfirm()
                          : openGuardMc(g.key as "budget" | "cap", g.label, cur)
                      }
                    >
                      {isKill ? "切" : "调"}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* 转盘 EV cyan */}
            <div className="htint cyan" style={{ marginTop: 8, fontSize: 12 }}>
              <b>当前 EV ≈ ${WHEEL_EV_USD.toFixed(2)} / spin</b>(WHEEL_TIERS 派生)· 真实流出期望由 $1 / $20 / $500 三档贡献;
              改奖池签名(H4.wheel)触发 server 重算 weight 和 / 档位 / 真实奖过 B1。
            </div>
            <div className="htint ok" style={{ marginTop: 8, fontSize: 12 }}>
              <b>第四道护栏(自动)</b> · 抽奖前查覆盖率,跌破 100% 真钱档暂停、只发 NEX/积分/券,
              回升自动恢复。中奖由平台裁决,概率表不外泄;每人每 UTC 日 1 次,超了拒(eventId × userId × spinDate 409)。
              Genesis 节点不进转盘。
            </div>
          </div>
        </section>
      </div>

      {/* (i) Trackable 4 行 — 只读消费各域状态 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">Trackable 可追踪活动监控</span>
          <span className="sub">· 只读 · 各域状态消费(E 设备 / F 团队 / G 金融)</span>
          <div className="r">
            <span className="bdg dim">参与 → 达标 → 领取漏斗</span>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 880 }}>
            <thead>
              <tr>
                <th>活动</th>
                <th>判定条件(只读消费各域)</th>
                <th className="num">参与</th>
                <th className="num">达标</th>
                <th className="num">已领</th>
                <th>地域</th>
              </tr>
            </thead>
            <tbody>
              {TRACKABLES.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600, color: "var(--ink)" }}>{t.name}</td>
                  <td style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{t.cond}</td>
                  <td className="num mono">{t.join}</td>
                  <td className="num mono">{t.done}</td>
                  <td className="num mono">{t.claim}</td>
                  <td>
                    {t.geo === "全区" ? (
                      <span className="bdg dim">全区</span>
                    ) : (
                      <span className="bdg warn">{t.geo}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="htint" style={{ fontSize: 12 }}>
            <b>并发与时窗</b> · 活动结束/下架和领取赛跑时<b>结束优先</b>(过点的领取请求拒 409);
            一次性活动按「活动 × 用户」防重,日重置转盘按「活动 × 用户 × 日」防重。
            下架 + 地域屏蔽是应急矩阵(J1)的生效面 —— 监管点名「抽奖涉赌」时从那边批量编排。
          </div>
        </div>
      </section>

      </>}

      <p className="f-foot">
        <b>执行门槛</b> · 动清单 / 时窗 / 主推位 = 增长 → 增长主管;
        <b>动钱</b>(升奖励、改转盘奖池) = 增长 → 财务主管,过 B1 红线;
        改地域 = 合规 → 超管。新玩法 / 新判定字段属结构变更,走治理。
        <b>真写键</b>:H3.dayOne.* / H3.weekly.* / H3.monthly.* / H4.event.* / H4.wheel / H4.guard.* —
        与 B1 红线 / L4 BI / J1 应急矩阵 / I 域文案 / C2 真实行为审计共面。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "首日任务(Day-One)",
            kind: "reference-catalog",
            maxRows: 6,
            reason: "首日任务固定六项,需要同屏校验跳转路径和奖励",
          },
          {
            label: "每周任务(两档 + 周冠军)",
            kind: "reference-catalog",
            maxRows: 9,
            reason: "每周任务为两档固定规则目录,同屏对比优先级与奖励",
          },
          {
            label: "月度挑战(5 主题按账龄派发)",
            maxRows: 5,
            reason: "月度挑战固定五主题,按账龄派发后不产生无限列表",
          },
        ]}
      />
    </>
  );
}

export default H3QuestEvents;
