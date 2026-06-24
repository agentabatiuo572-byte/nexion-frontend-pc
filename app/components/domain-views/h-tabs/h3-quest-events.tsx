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
  PROMO_BANNER,
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
import { rhythmState } from "@/lib/mock/admin/command-center";

/** 首日任务行(seed + 运营增删改写 H3.dayOne.tasks JSON 的统一形状)。 */
type DayOneTask = { id: string; task: string; href: string; reward: string; status: string; completionType?: string; completionEvent?: string };
/** 完成判定方式中文标(visit 访问路径 / event 业务事件 / manual 手动核验)。 */
const COMP_LABEL: Record<string, string> = { visit: "访问路径", event: "业务事件", manual: "手动核验" };
/** 每周任务行(t1 一档 / t2 二档共用形状);运营增删改写 H3.weekly.{t1,t2}.tasks JSON。 */
type WeeklyTask = { id: string; cond: string; reward: string; status: string; completionType?: string; completionEvent?: string };
/** 月度挑战行;写 H3.monthly.tasks JSON。 */
type MonthlyTask = { id: string; theme: string; age: string; reward: string; goals: string; status: string };
const isWeeklyTask = (x: unknown): x is WeeklyTask =>
  !!x && typeof x === "object" &&
  typeof (x as WeeklyTask).id === "string" && typeof (x as WeeklyTask).cond === "string" &&
  typeof (x as WeeklyTask).reward === "string" && typeof (x as WeeklyTask).status === "string";
const isMonthlyTask = (x: unknown): x is MonthlyTask =>
  !!x && typeof x === "object" &&
  typeof (x as MonthlyTask).id === "string" && typeof (x as MonthlyTask).theme === "string" &&
  typeof (x as MonthlyTask).age === "string" && typeof (x as MonthlyTask).reward === "string" &&
  typeof (x as MonthlyTask).goals === "string" && typeof (x as MonthlyTask).status === "string";
/** 本周转化卡(首页促销 banner)单实例配置。写 H3.promoBanner.config JSON。 */
type PromoBanner = { baseReward: string; multiplier: string; countdownDays: string; countdownHours: string; targetDevice: string; targetDaily: string; status: string };
const isPromoBanner = (x: unknown): x is PromoBanner => {
  if (!x || typeof x !== "object") return false;
  const p = x as PromoBanner;
  // 全 7 字段必须是 string(缺字段 → 回退 seed,不露 undefinedd/undefined/d),与 isDayOneTask/isWeeklyTask 全字段校验风格一致。
  const allStr = typeof p.baseReward === "string" && typeof p.multiplier === "string" &&
    typeof p.countdownDays === "string" && typeof p.countdownHours === "string" &&
    typeof p.targetDevice === "string" && typeof p.targetDaily === "string" && typeof p.status === "string";
  if (!allStr) return false;
  // baseReward / multiplier 必须是有效非负数字(坏值 → 回退 seed,渲染面不露 NaN NEX)。
  return Number.isFinite(Number(p.baseReward)) && Number(p.baseReward) >= 0 &&
    Number.isFinite(Number(p.multiplier)) && Number(p.multiplier) >= 0;
};
/** 转化卡最终奖励 = 基础 × 倍率(NaN 安全;坏值返回 null,调用方兜底 "—")。渲染面 + toast 共用。 */
const promoFinalReward = (base: string, mult: string): number | null => {
  const f = Number(base) * Number(mult);
  return Number.isFinite(f) ? Math.round(f) : null;
};
/** 运行时校验(JSON.parse 的元素逐项核形状,防旧格式/损坏数据 id 缺失致编辑/删除静默失配)。 */
const isDayOneTask = (x: unknown): x is DayOneTask =>
  !!x && typeof x === "object" &&
  typeof (x as DayOneTask).id === "string" && typeof (x as DayOneTask).task === "string" &&
  typeof (x as DayOneTask).href === "string" && typeof (x as DayOneTask).reward === "string" &&
  typeof (x as DayOneTask).status === "string" &&
  (typeof (x as DayOneTask).completionType === "undefined" || typeof (x as DayOneTask).completionType === "string") &&
  (typeof (x as DayOneTask).completionEvent === "undefined" || typeof (x as DayOneTask).completionEvent === "string");

export function H3QuestEvents({ ctx }: { ctx: HCtx }) {
  const { pget, setParam, toast, openActionConfirm, openConfirm, logAudit } = ctx;
  // segmented section:H3 任务引擎 ↔ H4 活动中心(忠实设计稿 chip 切换;FOLD 在 h-view 路由层完成,叶子页内仍按设计稿 .chip[sel] 分段)。
  const [sec, setSec] = useState<"h3" | "h4">("h3");

  /** 首日任务列表单源:运营改过(增删改/启停)= H3.dayOne.tasks JSON;否则 seed(已含 id/status)。 */
  const effectiveDayOneTasks = (): DayOneTask[] => {
    const raw = pget("H3.dayOne.tasks");
    if (raw) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.every(isDayOneTask)) return arr as DayOneTask[];
        console.error("[H3] H3.dayOne.tasks 结构不符,回退 seed");
      } catch (e) {
        console.error("[H3] H3.dayOne.tasks JSON 损坏,回退 seed", e);
      }
    }
    return DAY_ONE_TASKS.map((t) => ({ ...t }));
  };
  const writeDayOneTasks = (next: DayOneTask[], action: string, reason: string) =>
    setParam("H3.dayOne.tasks", JSON.stringify(next), { action, reason });
  const dayOneWindow = () => pget("H3.dayOne.windowMs") ?? "24h 全额 / 72h 宽限";
  /** 每周任务列表单源:运营改过 = H3.weekly.<tier>.tasks JSON;否则 seed。 */
  const effectiveWeekly = (tier: "t1" | "t2"): WeeklyTask[] => {
    const raw = pget(`H3.weekly.${tier}.tasks`);
    if (raw) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.every(isWeeklyTask)) return arr as WeeklyTask[];
        console.error(`[H3] H3.weekly.${tier}.tasks 结构不符,回退 seed`);
      } catch (e) {
        console.error(`[H3] H3.weekly.${tier}.tasks JSON 损坏,回退 seed`, e);
      }
    }
    return (tier === "t1" ? WEEKLY_T1 : WEEKLY_T2).map((t) => ({ ...t }));
  };
  const writeWeekly = (tier: "t1" | "t2", next: WeeklyTask[], action: string, reason: string) =>
    setParam(`H3.weekly.${tier}.tasks`, JSON.stringify(next), { action, reason });
  const champBonus = () => pget("H3.weekly.champBonus") ?? "+500 NEX × P3 1.1×";
  const multAt = (p: string, seed: string) => pget(`H3.weekly.mult.${p}`) ?? seed;
  // 当前阶段倍率(live;随节奏单源 currentPhase 流转,不固定 P3)。
  const rs = rhythmState(pget);
  const phaseMultRow = WEEKLY_MULT.find((m) => m.p === rs.currentPhase);
  const phaseBonusLive = `${phaseMultRow?.mult ?? "1.0×"}(${rs.currentPhase})`;
  /** 月度挑战列表单源。 */
  const effectiveMonthly = (): MonthlyTask[] => {
    const raw = pget("H3.monthly.tasks");
    if (raw) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.every(isMonthlyTask)) return arr as MonthlyTask[];
        console.error("[H3] H3.monthly.tasks 结构不符,回退 seed");
      } catch (e) {
        console.error("[H3] H3.monthly.tasks JSON 损坏,回退 seed", e);
      }
    }
    return MONTHLY_MISSIONS.map((m) => ({ ...m }));
  };
  const writeMonthly = (next: MonthlyTask[], action: string, reason: string) =>
    setParam("H3.monthly.tasks", JSON.stringify(next), { action, reason });
  /** 本周转化卡单实例配置:运营改过 = H3.promoBanner.config JSON;否则 seed。 */
  const effectivePromoBanner = (): PromoBanner => {
    const raw = pget("H3.promoBanner.config");
    if (raw) {
      try {
        const obj = JSON.parse(raw);
        if (isPromoBanner(obj)) return obj as PromoBanner;
        console.error("[H3] H3.promoBanner.config 结构不符,回退 seed");
      } catch (e) {
        console.error("[H3] H3.promoBanner.config JSON 损坏,回退 seed", e);
      }
    }
    return { ...PROMO_BANNER };
  };
  const writePromoBanner = (next: PromoBanner, action: string, reason: string) =>
    setParam("H3.promoBanner.config", JSON.stringify(next), { action, reason });
  const eventStatus = (id: string, seed: EventState): EventState =>
    ((pget(`H4.event.${id}.status`) as EventState) ?? seed);
  const eventReward = (id: string, seed: string) => pget(`H4.event.${id}.reward`) ?? seed;
  const eventFeatured = (id: string, seed: boolean) => (pget(`H4.event.${id}.featured`) ?? (seed ? "1" : "")) === "1";

  /** 转盘:概率合计校验(WHEEL_TIERS reduce · 用户改值已写 H4.wheel 签名,前端只对设计稿做完整性显示)。 */
  const probSum = WHEEL_TIERS.reduce((s, t) => s + t.prob, 0);
  const probOk = Math.abs(probSum - 100) < 0.01;

  // 渲染期一次性计算(各任务表共用同一引用,避免同帧不一致);run 回调内仍实时 effective* 读最新。
  const dayOneTasksView = effectiveDayOneTasks();
  const weeklyT1View = effectiveWeekly("t1");
  const weeklyT2View = effectiveWeekly("t2");
  const monthlyView = effectiveMonthly();
  const promoBanner = effectivePromoBanner();

  // #38 任务事件契约与归因:每个首日任务派生 task_key / 服务端完成事件 / 下游业务事件 / B3 漏斗归属 / BI 口径,
  // 作为「任务配置 ↔ 事件上报 ↔ BI 归因」的共同事实源(Day7/B3 异常时定位问题层)。
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const questContract = (t: DayOneTask, i: number) => {
    const blob = `${t.task} ${t.href}`;
    const buy = /购买|首购|下单|商城|box|store|pricing/i.test(blob);
    const deposit = /充值|入金|deposit|topup|钱包|wallet/i.test(blob);
    const b3 = buy || deposit;
    return {
      taskKey: `quest.day1.${slugify(t.task) || `t${i}`}`,
      serverEvent: "quest.task_completed",
      downstream: buy ? "order.created → order.paid" : deposit ? "wallet.deposited" : "—",
      b3,
      retentionOnly: !b3,
      day7: b3 ? "下单 / 入金 → Day7 留存正相关" : "登录 / 浏览类 → 仅 Day7 留存信号",
      bi: "fct_quest_events.task_key",
      sample: 1200 - i * 130,
      anomaly: Number((i === 2 ? 2.4 : 0.3 + i * 0.1).toFixed(1)),
    };
  };

  /* ========= 通用 操作确认 opener ========= */

  /** 改首日时窗 — A 方案不追溯。 */
  const openWindowMc = () => {
    const cur = dayOneWindow();
    const hrs = cur.match(/\d+/g) ?? [];
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
      businessForm: {
        kind: "day-one-window",
        currentActiveHours: hrs[0] ?? "24",
        currentGraceHours: hrs[1] ?? "72",
      },
      run: (reason, _v, bv) => {
        if (!bv) return;
        const v = `${bv.activeHours}h 全额 / ${bv.graceHours}h 宽限`;
        setParam("H3.dayOne.windowMs", v, { action: "改首日任务时窗", reason });
        toast(`· 首日时窗已改为 ${v} · A 方案 · 仅新进窗生效 · 已过 B1 覆盖率核验`);
      },
    });
  };

  /** 改首日三相奖励(总分 500/200/0)。 */
  const openTriRewardMc = () => {
    const cur = pget("H3.dayOne.triReward") ?? "500 / 200 / 0 NEX";
    const nums = cur.match(/\d+/g) ?? [];
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
      businessForm: {
        kind: "day-one-tri-reward",
        currentActive: nums[0] ?? "500",
        currentGrace: nums[1] ?? "200",
        currentExpired: nums[2] ?? "0",
      },
      run: (reason, _v, bv) => {
        if (!bv) return;
        const v = `${bv.active} / ${bv.grace} / ${bv.expired} NEX`;
        setParam("H3.dayOne.triReward", v, { action: "改首日三相奖励", reason });
        toast(`· 首日三相奖励已改为 ${v} · 已过 B1 覆盖率核验`);
      },
    });
  };

  /** 首日单任务多字段编辑(名称 / 跳转路径 / 奖励 / 状态)。 */
  const openDayOneTaskEditMc = (task: DayOneTask) => {
    openActionConfirm({
      action: `编辑首日任务 · ${task.task}`,
      detail: (
        <>
          <b>{task.task}</b> · 多字段编辑:名称 / 跳转路径 / 奖励 / 状态。
          跳转路径决定完成判定(服务器二次确认,谎报无效);<b>升奖励 = 放大 NEX 流出</b>,提交即过 B1 红线;改动只对新进窗用户生效。
        </>
      ),
      amplifies: true,
      businessForm: {
        kind: "task-edit",
        subject: task.task,
        currentName: task.task,
        currentPath: task.href,
        currentReward: task.reward,
        currentStatus: task.status,
        currentCompletionType: task.completionType ?? "visit",
        currentCompletionEvent: task.completionEvent ?? "",
      },
      run: (reason, _v /* 未用:task-edit 走 businessForm,不消费 edit 的 newValue */, bv) => {
        if (!bv) return;
        const next = effectiveDayOneTasks().map((t) =>
          t.id === task.id ? { ...t, task: bv.name, href: bv.path, reward: bv.reward, status: bv.status, completionType: bv.completionType, completionEvent: bv.completionEvent } : t,
        );
        writeDayOneTasks(next, `编辑首日任务 ${task.task}`, reason);
        toast(`· 首日任务「${bv.name}」已更新 · 已过 B1 覆盖率核验`);
      },
    });
  };

  /** 新增首日任务(多字段表单)。 */
  const openAddDayOneTask = () => {
    openActionConfirm({
      action: "新增首日任务",
      detail: (
        <>
          新增一条首日新人任务:名称 / 跳转路径 / 奖励 / 状态。<b>新增即放大 NEX 流出</b>,提交即过 B1 红线;
          <b>接真后台前,新任务需有对应前端页面 + 完成判定才会派发</b>。
        </>
      ),
      amplifies: true,
      businessForm: {
        kind: "task-edit",
        subject: "新任务",
        currentName: "",
        currentPath: "",
        currentReward: "",
        currentStatus: "active",
        currentCompletionType: "visit",
        currentCompletionEvent: "",
      },
      run: (reason, _v /* 未用:task-edit 走 businessForm */, bv) => {
        if (!bv) return;
        const newTask: DayOneTask = { id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, task: bv.name, href: bv.path, reward: bv.reward, status: bv.status, completionType: bv.completionType, completionEvent: bv.completionEvent };
        writeDayOneTasks([...effectiveDayOneTasks(), newTask], `新增首日任务 ${bv.name}`, reason);
        toast(`· 首日任务「${bv.name}」已新增 · 已过 B1 覆盖率核验`);
      },
    });
  };

  /** 启用 / 停用首日任务(处置类 · 不挂 amplifies)。 */
  const openToggleDayOneTask = (task: DayOneTask) => {
    const next = task.status === "active" ? "paused" : "active";
    const labelNow = next === "active" ? "启用" : "停用";
    openActionConfirm({
      action: `${labelNow}首日任务 · ${task.task}`,
      detail: (
        <>
          <b>{task.task}</b> · 当前 {task.status === "active" ? "生效中" : "已停用"} · {labelNow}动作:
          {next === "paused" ? "停用后用户端不再展示此任务,已派发不回收;生效即时。" : "启用后用户端恢复展示。"}
          {" "}操作确认留痕。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        const list = effectiveDayOneTasks().map((t) => (t.id === task.id ? { ...t, status: next } : t));
        writeDayOneTasks(list, `${labelNow}首日任务 ${task.task}`, reason);
        logAudit({ actor: "总管理员", action: `${labelNow}首日任务`, target: `H3.dayOne.${task.id}`, reason });
        toast(`· ${task.task} 已${labelNow}`);
      },
    });
  };

  /** 删除首日任务(处置类 · 不挂 amplifies)。 */
  const openDeleteDayOneTask = (task: DayOneTask) => {
    openActionConfirm({
      action: `删除首日任务 · ${task.task}`,
      detail: (
        <>
          <b>{task.task}</b> · 从首日新人清单<b>永久移除</b>这条任务,已派发不回收;生效即时。
          如只是临时下线,建议改用「停用」。操作确认留痕。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        const list = effectiveDayOneTasks().filter((t) => t.id !== task.id);
        writeDayOneTasks(list, `删除首日任务 ${task.task}`, reason);
        logAudit({ actor: "总管理员", action: "删除首日任务", target: `H3.dayOne.${task.id}`, reason });
        toast(`· ${task.task} 已删除`);
      },
    });
  };

  const weeklyTierLabel = (tier: "t1" | "t2") => (tier === "t1" ? "周一档" : "周二档");

  /** 每周单任务多字段编辑(条件/奖励/状态/完成判定)。 */
  const openWeeklyEdit = (tier: "t1" | "t2", task: WeeklyTask) => {
    openActionConfirm({
      action: `编辑${weeklyTierLabel(tier)} · ${task.cond}`,
      detail: (
        <>
          <b>{task.cond}</b> · {tier === "t1" ? "一档按优先级命中第一条派发" : "二档完成池每条独立派发"} · 多字段:条件 / 奖励 / 状态 / 完成判定。
          <b>升奖励 = 放大 NEX 流出</b>,过 B1 红线;同周锁定、下周生效。
        </>
      ),
      amplifies: true,
      businessForm: {
        kind: "weekly-task-edit",
        subject: `${weeklyTierLabel(tier)} · ${task.cond}`,
        currentCond: task.cond,
        currentReward: task.reward,
        currentStatus: task.status,
        currentCompletionType: task.completionType ?? "event",
        currentCompletionEvent: task.completionEvent ?? "",
      },
      run: (reason, _v, bv) => {
        if (!bv) return;
        const next = effectiveWeekly(tier).map((t) =>
          t.id === task.id ? { ...t, cond: bv.cond, reward: bv.reward, status: bv.status, completionType: bv.completionType, completionEvent: bv.completionEvent } : t,
        );
        writeWeekly(tier, next, `编辑${weeklyTierLabel(tier)} ${task.cond}`, reason);
        toast(`· ${weeklyTierLabel(tier)}「${bv.cond}」已更新 · 已过 B1 覆盖率核验`);
      },
    });
  };

  /** 新增每周任务。 */
  const openWeeklyAdd = (tier: "t1" | "t2") => {
    openActionConfirm({
      action: `新增${weeklyTierLabel(tier)}任务`,
      detail: (
        <>
          新增一条{weeklyTierLabel(tier)}任务:条件 / 奖励 / 状态 / 完成判定。<b>新增即放大 NEX 流出</b>,过 B1 红线;下周生效。
        </>
      ),
      amplifies: true,
      businessForm: {
        kind: "weekly-task-edit",
        subject: `新${weeklyTierLabel(tier)}任务`,
        currentCond: "",
        currentReward: "",
        currentStatus: "active",
        currentCompletionType: "event",
        currentCompletionEvent: "",
      },
      run: (reason, _v, bv) => {
        if (!bv) return;
        const newTask: WeeklyTask = { id: `${tier}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, cond: bv.cond, reward: bv.reward, status: bv.status, completionType: bv.completionType, completionEvent: bv.completionEvent };
        writeWeekly(tier, [...effectiveWeekly(tier), newTask], `新增${weeklyTierLabel(tier)} ${bv.cond}`, reason);
        toast(`· ${weeklyTierLabel(tier)}「${bv.cond}」已新增 · 已过 B1 覆盖率核验`);
      },
    });
  };

  /** 启用 / 停用每周任务(处置类)。 */
  const openWeeklyToggle = (tier: "t1" | "t2", task: WeeklyTask) => {
    const next = task.status === "active" ? "paused" : "active";
    const labelNow = next === "active" ? "启用" : "停用";
    openActionConfirm({
      action: `${labelNow}${weeklyTierLabel(tier)} · ${task.cond}`,
      detail: (
        <>
          <b>{task.cond}</b> · 当前 {task.status === "active" ? "生效中" : "已停用"} · {labelNow}:
          {next === "paused" ? "本周起不派发此条,已派发不回收。" : "恢复派发。"}{" "}操作确认留痕。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        const list = effectiveWeekly(tier).map((t) => (t.id === task.id ? { ...t, status: next } : t));
        writeWeekly(tier, list, `${labelNow}${weeklyTierLabel(tier)} ${task.cond}`, reason);
        logAudit({ actor: "总管理员", action: `${labelNow}${weeklyTierLabel(tier)}`, target: `H3.weekly.${tier}.${task.id}`, reason });
        toast(`· ${task.cond} 已${labelNow}`);
      },
    });
  };

  /** 删除每周任务(处置类)。 */
  const openWeeklyDelete = (tier: "t1" | "t2", task: WeeklyTask) => {
    openActionConfirm({
      action: `删除${weeklyTierLabel(tier)} · ${task.cond}`,
      detail: (
        <>
          <b>{task.cond}</b> · 从{weeklyTierLabel(tier)}<b>永久移除</b>,已派发不回收。临时下线建议改用「停用」。操作确认留痕。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        const list = effectiveWeekly(tier).filter((t) => t.id !== task.id);
        writeWeekly(tier, list, `删除${weeklyTierLabel(tier)} ${task.cond}`, reason);
        logAudit({ actor: "总管理员", action: `删除${weeklyTierLabel(tier)}`, target: `H3.weekly.${tier}.${task.id}`, reason });
        toast(`· ${task.cond} 已删除`);
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

  /** 月度单主题多字段编辑(主题/账龄/奖励/子目标/状态)。 */
  const openMonthlyEdit = (task: MonthlyTask) => {
    openActionConfirm({
      action: `编辑月度挑战 · ${task.theme}`,
      detail: (
        <>
          <b>{task.theme}</b> · 多字段:主题 / 账龄段 / 奖励 / 子目标 / 状态 · 3 子目标全达成才可领,跨月清空重派。
          <b>升奖励 = 放大 NEX 流出</b>,过 B1 红线;改动只对<b>本月新派</b>生效。
        </>
      ),
      amplifies: true,
      businessForm: {
        kind: "monthly-task-edit",
        subject: task.theme,
        currentTheme: task.theme,
        currentAge: task.age,
        currentReward: task.reward,
        currentGoals: task.goals,
        currentStatus: task.status,
      },
      run: (reason, _v, bv) => {
        if (!bv) return;
        const next = effectiveMonthly().map((m) =>
          m.id === task.id ? { ...m, theme: bv.theme, age: bv.age, reward: bv.reward, goals: bv.goals, status: bv.status } : m,
        );
        writeMonthly(next, `编辑月度挑战 ${task.theme}`, reason);
        toast(`· 月度「${bv.theme}」已更新 · 已过 B1 覆盖率核验`);
      },
    });
  };

  /** 新增月度挑战。 */
  const openMonthlyAdd = () => {
    openActionConfirm({
      action: "新增月度挑战",
      detail: (
        <>
          新增一个月度主题:主题 / 账龄段 / 奖励 / 子目标 / 状态。<b>新增即放大 NEX 流出</b>,过 B1 红线;本月新派生效。
        </>
      ),
      amplifies: true,
      businessForm: {
        kind: "monthly-task-edit",
        subject: "新月度主题",
        currentTheme: "",
        currentAge: "",
        currentReward: "",
        currentGoals: "",
        currentStatus: "active",
      },
      run: (reason, _v, bv) => {
        if (!bv) return;
        const newTask: MonthlyTask = { id: `mc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, theme: bv.theme, age: bv.age, reward: bv.reward, goals: bv.goals, status: bv.status };
        writeMonthly([...effectiveMonthly(), newTask], `新增月度挑战 ${bv.theme}`, reason);
        toast(`· 月度「${bv.theme}」已新增 · 已过 B1 覆盖率核验`);
      },
    });
  };

  /** 启用 / 停用月度挑战(处置类)。 */
  const openMonthlyToggle = (task: MonthlyTask) => {
    const next = task.status === "active" ? "paused" : "active";
    const labelNow = next === "active" ? "启用" : "停用";
    openActionConfirm({
      action: `${labelNow}月度挑战 · ${task.theme}`,
      detail: (
        <>
          <b>{task.theme}</b> · 当前 {task.status === "active" ? "生效中" : "已停用"} · {labelNow}:
          {next === "paused" ? "本月起不派发此主题,已派发不回收。" : "恢复派发。"}{" "}操作确认留痕。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        const list = effectiveMonthly().map((m) => (m.id === task.id ? { ...m, status: next } : m));
        writeMonthly(list, `${labelNow}月度挑战 ${task.theme}`, reason);
        logAudit({ actor: "总管理员", action: `${labelNow}月度挑战`, target: `H3.monthly.${task.id}`, reason });
        toast(`· ${task.theme} 已${labelNow}`);
      },
    });
  };

  /** 删除月度挑战(处置类)。 */
  const openMonthlyDelete = (task: MonthlyTask) => {
    openActionConfirm({
      action: `删除月度挑战 · ${task.theme}`,
      detail: (
        <>
          <b>{task.theme}</b> · 从月度挑战<b>永久移除</b>,已派发不回收。临时下线建议改用「停用」。操作确认留痕。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        const list = effectiveMonthly().filter((m) => m.id !== task.id);
        writeMonthly(list, `删除月度挑战 ${task.theme}`, reason);
        logAudit({ actor: "总管理员", action: "删除月度挑战", target: `H3.monthly.${task.id}`, reason });
        toast(`· ${task.theme} 已删除`);
      },
    });
  };

  /** 编辑本周转化卡(多字段:奖励/倍率/倒计时/目标/日产/状态)。 */
  const openPromoBannerEdit = () => {
    const pb = effectivePromoBanner();
    openActionConfirm({
      action: "编辑本周转化卡",
      detail: (
        <>
          首页「激活设备领 NEX」促销卡 · 多字段:基础奖励 / 倍率 / 倒计时 / 目标设备 / 日产 / 上下架。
          最终奖励 = 基础 × 倍率;<b>升奖励 / 倍率 = 放大 NEX 流出</b>,过 B1 红线;文案归 I 域。
        </>
      ),
      amplifies: true,
      businessForm: {
        kind: "promo-banner-edit",
        currentBaseReward: pb.baseReward,
        currentMultiplier: pb.multiplier,
        currentCountdownDays: pb.countdownDays,
        currentCountdownHours: pb.countdownHours,
        currentTargetDevice: pb.targetDevice,
        currentTargetDaily: pb.targetDaily,
        currentStatus: pb.status,
      },
      run: (reason, _v, bv) => {
        if (!bv) return;
        const next: PromoBanner = { baseReward: bv.baseReward, multiplier: bv.multiplier, countdownDays: bv.countdownDays, countdownHours: bv.countdownHours, targetDevice: bv.targetDevice, targetDaily: bv.targetDaily, status: bv.status };
        writePromoBanner(next, "编辑本周转化卡", reason);
        const final = promoFinalReward(bv.baseReward, bv.multiplier) ?? 0;
        toast(`· 本周转化卡已更新 · 最终奖励 ${final} NEX · 已过 B1 覆盖率核验`);
      },
    });
  };

  /** 上架 / 下架本周转化卡(处置类)。 */
  const openPromoBannerToggle = () => {
    const pb = effectivePromoBanner();
    const next = pb.status === "active" ? "paused" : "active";
    const labelNow = next === "active" ? "上架" : "下架";
    openActionConfirm({
      action: `${labelNow}本周转化卡`,
      detail: (
        <>
          <b>本周转化卡</b> · 当前 {pb.status === "active" ? "上架中" : "已下架"} · {labelNow}:
          {next === "paused" ? "下架后首页不再展示此促销卡。" : "上架后首页恢复展示。"}{" "}操作确认留痕。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        writePromoBanner({ ...effectivePromoBanner(), status: next }, `${labelNow}本周转化卡`, reason);
        logAudit({ actor: "总管理员", action: `${labelNow}本周转化卡`, target: "H3.promoBanner.config", reason });
        toast(`· 本周转化卡已${labelNow}`);
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
            ? "日派彩预算 = 24h 真实流出累计阈值,到顶当日只发 NEX/券。"
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
            ? "关闭后转盘只发 NEX/券,所有真实奖档(现金 $1/$20/$500、券)立即停发;监管点名「抽奖涉赌」场景的应急止血开关,联动应急矩阵(J1)。"
            : "恢复后真实奖档按原概率开放,B1 覆盖率与 budget/cap 护栏照常生效。"}
          {" "}本动作普通确认但<b>必填原因</b>,1 秒内写日志、5 秒内全网生效。
        </>
      ),
      reason: true,
      okLabel: turnOff ? "确认急停" : "确认恢复",
      chips: turnOff
        ? [["真钱档全部停发", "ready"], ["NEX / 券正常", "done"]]
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
          <div className="sub">含 Phase 加成 {phaseBonusLive}</div>
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

            {/* 任务清单(逐行多字段编辑 + 启停 + 增删) */}
            <div className="l-h" style={{ marginTop: 12, border: 0, paddingBottom: 0 }}>
              <span className="ttl" style={{ fontSize: 13 }}>任务清单</span>
              <span className="sub">· 多字段可编辑(名称/路径/奖励/状态)· 可增删 · 停用即用户端不展示</span>
              <div className="r">
                <button className="l-btn sm mc" onClick={openAddDayOneTask}>+ 新增任务</button>
              </div>
            </div>
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table className="l-tbl" style={{ minWidth: 680 }}>
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>跳转路径</th>
                    <th className="num">奖励</th>
                    <th>状态</th>
                    <th>完成判定</th>
                    <th style={{ textAlign: "right" }}>动作</th>
                  </tr>
                </thead>
                <tbody>
                  {dayOneTasksView.map((t) => {
                    const isActive = t.status === "active";
                    const stLabel = isActive ? "生效中" : t.status === "paused" ? "已停用" : "已归档";
                    const stTone = isActive ? "ok" : "dim";
                    const dimColor = isActive ? undefined : "var(--ink-3)";
                    return (
                      <tr key={t.id}>
                        <td style={{ fontWeight: 600, color: isActive ? "var(--ink)" : "var(--ink-3)" }}>{t.task}</td>
                        <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{t.href}</td>
                        <td className="num mono" style={{ fontWeight: 700, color: dimColor }}>{t.reward}</td>
                        <td><span className={`bdg ${stTone}`}>{stLabel}</span></td>
                        <td style={{ fontSize: 11.5 }}>
                          <span style={{ color: isActive ? "var(--ink-2)" : "var(--ink-3)" }}>{COMP_LABEL[t.completionType ?? "visit"] ?? "访问路径"}</span>
                          {t.completionEvent ? <span className="mono" style={{ color: "var(--ink-4)", marginLeft: 4 }}>{t.completionEvent}</span> : null}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                            <button className="l-btn sm mc" onClick={() => openDayOneTaskEditMc(t)}>编辑</button>
                            <button className="l-btn sm mc" aria-label={`${isActive ? "停用" : "启用"} ${t.task}`} onClick={() => openToggleDayOneTask(t)}>{isActive ? "停用" : "启用"}</button>
                            <button className="l-btn sm mc" style={{ color: "var(--danger)" }} aria-label={`删除任务 · ${t.task}`} onClick={() => openDeleteDayOneTask(t)}>删除</button>
                          </span>
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
            {/* 一档(优先级派发 · 多字段可编辑 + 增删 + 启停) */}
            <div className="l-h" style={{ marginTop: 2, border: 0, paddingBottom: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>一档(优先级派发 · 命中第一条)</span>
              <div className="r">
                <button className="l-btn sm mc" onClick={() => openWeeklyAdd("t1")}>+ 新增任务</button>
              </div>
            </div>
            <div style={{ overflowX: "auto", marginTop: 6 }}>
              <table className="l-tbl" style={{ minWidth: 600 }}>
                <thead>
                  <tr>
                    <th>条件(优先级自上而下)</th>
                    <th className="num">奖励 NEX</th>
                    <th>状态</th>
                    <th>完成判定</th>
                    <th style={{ textAlign: "right" }}>动作</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyT1View.map((t) => {
                    const isActive = t.status === "active";
                    const stLabel = isActive ? "生效中" : t.status === "paused" ? "已停用" : "已归档";
                    return (
                      <tr key={t.id}>
                        <td style={{ fontWeight: 600, color: isActive ? "var(--ink)" : "var(--ink-3)" }}>{t.cond}</td>
                        <td className="num mono" style={{ fontWeight: 700, color: isActive ? undefined : "var(--ink-3)" }}>{t.reward}</td>
                        <td><span className={`bdg ${isActive ? "ok" : "dim"}`}>{stLabel}</span></td>
                        <td style={{ fontSize: 11.5 }}>
                          <span style={{ color: "var(--ink-2)" }}>{COMP_LABEL[t.completionType ?? "event"] ?? "业务事件"}</span>
                          {t.completionEvent ? <span className="mono" style={{ color: "var(--ink-4)", marginLeft: 4 }}>{t.completionEvent}</span> : null}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                            <button className="l-btn sm mc" onClick={() => openWeeklyEdit("t1", t)}>编辑</button>
                            <button className="l-btn sm mc" aria-label={`${isActive ? "停用" : "启用"} ${t.cond}`} onClick={() => openWeeklyToggle("t1", t)}>{isActive ? "停用" : "启用"}</button>
                            <button className="l-btn sm mc" style={{ color: "var(--danger)" }} aria-label={`删除 ${t.cond}`} onClick={() => openWeeklyDelete("t1", t)}>删除</button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 二档(完成池 · 多字段可编辑 + 增删 + 启停) */}
            <div className="l-h" style={{ marginTop: 14, border: 0, paddingBottom: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>二档(完成池 · 每条独立派发)</span>
              <div className="r">
                <button className="l-btn sm mc" onClick={() => openWeeklyAdd("t2")}>+ 新增任务</button>
              </div>
            </div>
            <div style={{ overflowX: "auto", marginTop: 6 }}>
              <table className="l-tbl" style={{ minWidth: 600 }}>
                <thead>
                  <tr>
                    <th>任务</th>
                    <th className="num">奖励 NEX</th>
                    <th>状态</th>
                    <th>完成判定</th>
                    <th style={{ textAlign: "right" }}>动作</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyT2View.map((t) => {
                    const isActive = t.status === "active";
                    const stLabel = isActive ? "生效中" : t.status === "paused" ? "已停用" : "已归档";
                    return (
                      <tr key={t.id}>
                        <td style={{ fontWeight: 600, color: isActive ? "var(--ink)" : "var(--ink-3)" }}>{t.cond}</td>
                        <td className="num mono" style={{ fontWeight: 700, color: isActive ? undefined : "var(--ink-3)" }}>{t.reward}</td>
                        <td><span className={`bdg ${isActive ? "ok" : "dim"}`}>{stLabel}</span></td>
                        <td style={{ fontSize: 11.5 }}>
                          <span style={{ color: "var(--ink-2)" }}>{COMP_LABEL[t.completionType ?? "event"] ?? "业务事件"}</span>
                          {t.completionEvent ? <span className="mono" style={{ color: "var(--ink-4)", marginLeft: 4 }}>{t.completionEvent}</span> : null}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                            <button className="l-btn sm mc" onClick={() => openWeeklyEdit("t2", t)}>编辑</button>
                            <button className="l-btn sm mc" aria-label={`${isActive ? "停用" : "启用"} ${t.cond}`} onClick={() => openWeeklyToggle("t2", t)}>{isActive ? "停用" : "启用"}</button>
                            <button className="l-btn sm mc" style={{ color: "var(--danger)" }} aria-label={`删除 ${t.cond}`} onClick={() => openWeeklyDelete("t2", t)}>删除</button>
                          </span>
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
                const isCur = m.p === rs.currentPhase;
                return (
                  <div
                    key={m.p}
                    className={`seg${isCur ? " cur" : ""}`}
                    onClick={() => openMultMc(m.p, cur)}
                    style={{ cursor: "pointer" }}
                    title="点击改值(操作确认)"
                  >
                    <div className="m">{m.p}{isCur ? " 当前" : ""}</div>
                    <div className="vv">{cur}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      {/* #38 任务事件契约与归因(只读) */}
      <section className="l-card" data-proof="h3-event-contract">
        <div className="l-h">
          <span className="ttl">任务事件契约与归因(只读)</span>
          <span className="sub">· 每个首日任务的 task_key / 服务端完成事件 / 下游业务事件 / B3 漏斗归属 / BI 口径 —— 异常时分清问题来自配置 / 上报 / 归因 / 真实转化</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1080 }}>
            <thead>
              <tr><th>任务</th><th>task_key</th><th>服务端完成事件</th><th>下游业务事件</th><th>B3 漏斗</th><th>仅留存</th><th>Day7 贡献</th><th>L 域 BI 表.字段</th><th className="num">24h 样本</th><th className="num">异常率</th></tr>
            </thead>
            <tbody>
              {dayOneTasksView.map((t, i) => { const c = questContract(t, i); return (
                <tr key={t.task}>
                  <td style={{ fontWeight: 600, color: "var(--ink)" }}>{t.task}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{c.taskKey}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{c.serverEvent}</td>
                  <td className="mono" style={{ fontSize: 11, color: c.downstream === "—" ? "var(--ink-4)" : undefined }}>{c.downstream}</td>
                  <td>{c.b3 ? <span className="bdg ok">进 B3</span> : <span className="bdg dim">否</span>}</td>
                  <td>{c.retentionOnly ? <span className="bdg warn">是</span> : <span className="bdg dim">否</span>}</td>
                  <td style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{c.day7}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{c.bi}</td>
                  <td className="num mono">{c.sample.toLocaleString()}</td>
                  <td className="num mono" style={{ color: c.anomaly > 1 ? "var(--warning)" : undefined }}>{c.anomaly}%</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="htint" style={{ fontSize: 12 }}><b>契约 = 归因共同事实源</b> · task_key 串起任务配置 → 服务端 <span className="mono">quest.task_completed</span> → 下游业务事件 → B3 漏斗 → L 域 BI;Day7 活跃 / B3 转化异常时,先比对「24h 样本数」与「异常率」定位问题层(配置 / 上报 / 归因 / 真实转化)。Weekly / Monthly 任务沿用同一 task_key 命名空间。</div>
        </div>
      </section>

      {/* (d)(e) Monthly + Monitor 双列 */}
      <div className="two-col">
        {/* (d) Monthly */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">月度挑战(按账龄派发)</span>
            <span className="sub">· 每主题 3 个子目标全达成才可领 · 跨月清空重派 · 可增删 / 启停</span>
            <div className="r">
              <button className="l-btn sm mc" onClick={openMonthlyAdd}>+ 新增主题</button>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 680 }}>
              <thead>
                <tr>
                  <th>主题</th>
                  <th>账龄段</th>
                  <th className="num">奖励 NEX</th>
                  <th>子目标</th>
                  <th>状态</th>
                  <th style={{ textAlign: "right" }}>动作</th>
                </tr>
              </thead>
              <tbody>
                {monthlyView.map((m) => {
                  const isActive = m.status === "active";
                  const stLabel = isActive ? "生效中" : m.status === "paused" ? "已停用" : "已归档";
                  return (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 600, color: isActive ? "var(--ink)" : "var(--ink-3)" }}>{m.theme}</td>
                      <td className="mono" style={{ fontSize: 11.5, color: isActive ? "var(--ink-3)" : "var(--ink-4)" }}>{m.age}</td>
                      <td className="num mono" style={{ fontWeight: 700, color: isActive ? undefined : "var(--ink-3)" }}>{m.reward}</td>
                      <td style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{m.goals}</td>
                      <td><span className={`bdg ${isActive ? "ok" : "dim"}`}>{stLabel}</span></td>
                      <td style={{ textAlign: "right" }}>
                        <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                          <button className="l-btn sm mc" onClick={() => openMonthlyEdit(m)}>编辑</button>
                          <button className="l-btn sm mc" aria-label={`${isActive ? "停用" : "启用"} ${m.theme}`} onClick={() => openMonthlyToggle(m)}>{isActive ? "停用" : "启用"}</button>
                          <button className="l-btn sm mc" style={{ color: "var(--danger)" }} aria-label={`删除 ${m.theme}`} onClick={() => openMonthlyDelete(m)}>删除</button>
                        </span>
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

      {/* (f) 本周转化卡(首页促销 banner · G1 补口)*/}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">本周转化卡(首页促销 banner)</span>
          <span className="sub">· 首页「激活设备领 NEX」促销卡 · 设备 upsell · 单实例配置(非任务清单)</span>
          <div className="r">
            <span className={`bdg ${promoBanner.status === "active" ? "ok" : "dim"}`}>{promoBanner.status === "active" ? "上架中" : "已下架"}</span>
          </div>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          <div className="p-row">
            <span className="k">
              基础奖励 × 倍率 = 最终奖励
              <small>对应前端 conversion-banner.vue 的 baseReward × promoMult = finalReward(800×1.5=1200)。</small>
            </span>
            <span className="v">{promoBanner.baseReward} × {promoBanner.multiplier} = {promoFinalReward(promoBanner.baseReward, promoBanner.multiplier) ?? "—"} NEX</span>
            <button className="l-btn sm mc" onClick={openPromoBannerEdit}>调整</button>
          </div>
          <div className="p-row">
            <span className="k">倒计时窗口</span>
            <span className="v">{promoBanner.countdownDays}d {promoBanner.countdownHours}h</span>
          </div>
          <div className="p-row">
            <span className="k">目标设备 / 日产展示</span>
            <span className="v">{promoBanner.targetDevice} · ${promoBanner.targetDaily}/d</span>
          </div>
          <div className="p-row">
            <span className="k">首页上下架</span>
            <span className="v">{promoBanner.status === "active" ? "上架中" : "已下架"}</span>
            <button className="l-btn sm mc" onClick={openPromoBannerToggle}>{promoBanner.status === "active" ? "下架" : "上架"}</button>
          </div>
          <div className="htint" style={{ marginTop: 10, fontSize: 12 }}>
            <b>本周转化卡</b> = 首页一张设备 upsell 促销 banner(激活 {promoBanner.targetDevice} 领最终奖励),<b>不是任务清单</b>。最终奖励 = 基础 × 倍率;升奖励 / 倍率 = 放大 NEX 流出过 B1 红线。文案(eyebrow / CTA)归 I 域,本块只配奖励 / 倍率 / 倒计时 / 目标设备 / 日产 / 上下架。真写键 <span className="mono">H3.promoBanner.config</span>。
          </div>
        </div>
      </section>

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
              <b>第四道护栏(自动)</b> · 抽奖前查覆盖率,跌破 100% 真钱档暂停、只发 NEX/券,
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
            maxRows: 20,
            reason: "首日任务运营可增删,常态约六项,上限 20 同屏校验跳转路径/奖励/状态",
          },

          {
            label: "每周任务(两档 + 周冠军)",
            kind: "reference-catalog",
            maxRows: 20,
            reason: "每周两档运营可增删,常态一档9/二档8,上限 20 同屏对比优先级/奖励/状态",
          },
          {
            label: "月度挑战(5 主题按账龄派发)",
            maxRows: 20,
            reason: "月度挑战运营可增删,常态约五主题,上限 20 同屏校验账龄/奖励/状态",
          },
        ]}
      />
    </>
  );
}

export default H3QuestEvents;
