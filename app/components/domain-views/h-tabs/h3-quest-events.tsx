"use client";

import { useEffect, useMemo, useState } from "react";
import { PaginationExemptionList } from "../design-kit";
import {
  fetchH3QuestEvents,
  updateH3QuestConfig,
  updateH4EventFeatured,
  updateH4EventReward,
  updateH4EventStatus,
  createH3Mission,
  createH3MonthlyMission,
  createH4QuestEvent,
  createH4WheelTier,
  createH4WheelGuard,
} from "@/lib/admin/h-client";
import type { HCtx } from "./types";

type EventState = "upcoming" | "ongoing" | "ended";
type HSection = "tasks" | "events";

type QuestTask = Record<string, any>;
type QuestEvent = {
  id: string;
  name: string;
  kind?: string;
  state: EventState;
  reward?: string;
  featured?: boolean;
  trackable?: boolean;
  condition?: string;
  geo?: string;
};

type H3Model = {
  h3Stats?: Record<string, any>;
  h4Stats?: Record<string, any>;
  dayOneWindow?: string;
  dayOneTriReward?: string;
  dayOneTasks: QuestTask[];
  dayOneStates?: Array<{ st: string; label: string; tone: string }>;
  weeklyTier1: QuestTask[];
  weeklyTier2: QuestTask[];
  weeklyChampionBonus?: string;
  weeklyMultipliers?: Array<{ p: string; mult: string }>;
  monthlyMissions: QuestTask[];
  taskMonitor?: Array<{ label: string; note: string }>;
  taskContracts?: Array<Record<string, any>>;
  promoBanner?: Record<string, any>;
  phaseMultiplierReadonly?: Record<string, any>;
  events: QuestEvent[];
  eventStates?: Array<{ state: EventState; label: string; tone: string }>;
  wheelTiers?: Array<Record<string, any>>;
  wheelSignature?: string;
  wheelEvUsd?: number | string;
  wheelGuards?: Array<{ key: string; label: string; value: string; note?: string }>;
  trackables?: Array<{ id: string; name: string; cond: string; join: string; done: string; claim: string; geo: string }>;
  coverage?: Record<string, any>;
};

const EVENT_LABEL: Record<EventState, [string, string]> = {
  upcoming: ["预告", "dim"],
  ongoing: ["进行中", "ok"],
  ended: ["已结束", "dim"],
};

const TASK_STATUS: Record<string, [string, string]> = {
  active: ["生效中", "ok"],
  paused: ["已停用", "dim"],
  archived: ["已归档", "dim"],
};

const COMPLETION_LABEL: Record<string, string> = {
  event: "业务事件",
  visit: "访问路径",
  ledger: "账本入账",
};

function text(value: unknown, fallback = "-") {
  if (value == null || value === "") return fallback;
  return String(value);
}

function cleanPhaseKey(value: string) {
  return value.replace(/\s*当前\s*/g, "").trim();
}

function numberId(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function statusMeta(value: unknown) {
  return TASK_STATUS[text(value, "")] ?? ["未知", "dim"];
}

function promoFinalReward(base: unknown, multiplier: unknown) {
  const result = numericValue(base) * numericValue(multiplier);
  return result > 0 ? result.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "-";
}

function contractForTask(task: QuestTask, contracts: Array<Record<string, any>> | undefined, index: number) {
  return contracts?.find((item) => String(item.taskId) === String(task.id ?? index)) ?? {};
}

function statusOptions(current: EventState) {
  return [current, ...(["upcoming", "ongoing", "ended"] as EventState[]).filter((item) => item !== current)];
}

function numericValue(value: unknown) {
  if (typeof value === "number") return value;
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function boolValue(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function percentText(value: unknown) {
  const amount = numericValue(value);
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/\.?0+$/, "");
}

export function H3QuestEvents({ ctx, section = "tasks" }: { ctx: HCtx; section?: HSection }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const [model, setModel] = useState<H3Model | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const moduleLabel = section === "events" ? "H4 活动中心" : "H3 任务引擎";

  const reload = async () => {
    setLoading(true);
    try {
      setModel((await fetchH3QuestEvents()) as H3Model);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "UNKNOWN_ERROR");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const stateTone = useMemo(() => {
    const pairs: Array<[EventState, [string, string]]> = (model?.eventStates ?? []).map((item) => [
      item.state,
      [item.label, item.tone],
    ]);
    return new Map<EventState, [string, string]>(pairs);
  }, [model?.eventStates]);

  const apply = (next: Record<string, any>) => setModel(next as H3Model);

  const updateConfig = async (key: string, value: string, reason: string, label: string) => {
    apply(await updateH3QuestConfig(key, value, reason));
    toast(`${label} 已更新`);
  };

  const openSimpleConfig = (key: string, label: string, current: string, amplifies = false) => {
    openActionConfirm({
      action: label,
      detail: <>当前值 <b>{current}</b>,提交后写入后端配置并刷新读模型。</>,
      amplifies,
      edit: { kind: "text", current },
      run: async (reason, value) => {
        if (!value) return;
        await updateConfig(key, value, reason, label);
      },
    });
  };

  const openTaskReward = (key: string, label: string, current: string) => {
    openActionConfirm({
      action: `调整奖励 · ${label}`,
      detail: <>当前奖励 <b>{current}</b>。升奖励可能放大流出,后端会做覆盖率红线校验。</>,
      amplifies: true,
      edit: { kind: "text", current },
      run: async (reason, value) => {
        if (!value) return;
        await updateConfig(key, value, reason, `奖励 ${label}`);
      },
    });
  };

  const openEventReward = (event: QuestEvent) => {
    const current = text(event.reward);
    openActionConfirm({
      action: `活动奖励 · ${event.name}`,
      detail: <>当前奖励 <b>{current}</b>,后端保存到活动配置。</>,
      amplifies: true,
      edit: { kind: "text", current },
      run: async (reason, value) => {
        if (!value) return;
        apply(await updateH4EventReward(event.id, value, reason));
        toast(`${event.name} 奖励已更新`);
      },
    });
  };

  const openEventStatus = (event: QuestEvent) => {
    openConfirm({
      action: `活动状态 · ${event.name}`,
      detail: <>当前状态 <b>{EVENT_LABEL[event.state]?.[0] ?? event.state}</b>,状态变更由后端校验。</>,
      chips: [["写活动配置", "ready"], ["审计留痕", "done"]],
      reason: true,
      input: { label: "目标状态", options: statusOptions(event.state) },
      okLabel: "确认修改",
      run: async (reason, value) => {
        if (!value) return;
        apply(await updateH4EventStatus(event.id, value, reason));
        toast(`${event.name} 状态已更新`);
      },
    });
  };

  const openEventFeatured = (event: QuestEvent) => {
    openConfirm({
      action: `${event.featured ? "取消主推" : "设为主推"} · ${event.name}`,
      detail: <>主推活动唯一性由后端校验;若已有进行中主推活动,接口会拒绝。</>,
      chips: [["后端唯一校验", "ready"], ["审计留痕", "done"]],
      reason: true,
      okLabel: event.featured ? "取消主推" : "设为主推",
      run: async (reason) => {
        apply(await updateH4EventFeatured(event.id, !event.featured, reason));
        toast(`${event.name} 主推状态已更新`);
      },
    });
  };

  const openCreateMission = (missionType: "DAY_ONE" | "WEEKLY_T1" | "WEEKLY_T2", subject: string) => {
    openActionConfirm({
      action: `新建任务 · ${subject}`,
      detail: <>新建一条{subject};编号英文唯一,奖励放大 NEX 流出过 B1 红线。</>,
      amplifies: true,
      businessForm: { kind: "mission-create", subject },
      run: async (reason, _v, bv) => {
        if (!bv) return;
        const missionCode = String(bv.missionCode || "").trim();
        const missionName = String(bv.missionName || "").trim();
        if (!missionCode || !missionName) return;
        apply(await createH3Mission({ missionCode, missionName, missionType, rewardPoints: Number(bv.rewardPoints) || 0 }, reason));
        toast(`· 任务「${missionName}」已新建`);
      },
    });
  };

  const openCreateMonthlyMission = () => {
    openActionConfirm({
      action: "新建月度挑战",
      detail: <>新建月度挑战主题;按账龄段派发,奖励 &gt; 0 过 B1 红线。</>,
      amplifies: true,
      businessForm: { kind: "monthly-mission-create", subject: "新月度挑战" },
      run: async (reason, _v, bv) => {
        if (!bv) return;
        const payload = {
          challengeCode: String(bv.challengeCode || "").trim(),
          challengeName: String(bv.challengeName || "").trim(),
          theme: String(bv.theme || "").trim(),
          monthsFrom: Number(bv.monthsFrom) || 0,
          monthsTo: Number(bv.monthsTo) || 999,
          targetType: String(bv.targetType || "").trim(),
          targetValue: Number(bv.targetValue) || 1,
          rewardType: bv.rewardType || "NEX",
          rewardAmount: Number(bv.rewardAmount) || 0,
          rewardName: String(bv.rewardName || "").trim(),
        };
        if (!payload.challengeCode || !payload.challengeName) return;
        apply(await createH3MonthlyMission(payload, reason));
        toast(`· 月度挑战「${payload.challengeName}」已新建`);
      },
    });
  };

  const openCreateEvent = () => {
    openActionConfirm({
      action: "新建活动",
      detail: <>新建活动事件;id 英文唯一,主推需进行中且全局唯一。</>,
      amplifies: true,
      businessForm: { kind: "quest-event-config", subject: "新活动" },
      run: async (reason, _v, bv) => {
        if (!bv) return;
        const payload = {
          id: String(bv.id || "").trim(),
          name: String(bv.name || "").trim(),
          kind: bv.kind || "EVENT_ACTIONS",
          state: bv.state || "ongoing",
          reward: String(bv.reward || "").trim(),
          condition: String(bv.condition || "").trim(),
          featured: bv.featured === "true",
          trackable: bv.trackable === "true",
        };
        if (!payload.id || !payload.name) return;
        apply(await createH4QuestEvent(payload, reason));
        toast(`· 活动「${payload.name}」已新建`);
      },
    });
  };

  const openCreateWheelTier = () => {
    openActionConfirm({
      action: "新建轮盘档位",
      detail: <>新建抽奖档位;概率 0-100,所有档位概率和应=100,真实出金过 B1 红线。</>,
      amplifies: true,
      businessForm: { kind: "wheel-tier-config", subject: "新档位" },
      run: async (reason, _v, bv) => {
        if (!bv) return;
        const payload = {
          tierName: String(bv.tierName || "").trim(),
          rewardName: String(bv.rewardName || "").trim(),
          probabilityPct: Number(bv.probabilityPct) || 0,
          realOutflow: bv.realOutflow === "1" ? 1 : 0,
          rewardKind: bv.rewardKind || "nex",
        };
        if (!payload.tierName || !payload.rewardName) return;
        apply(await createH4WheelTier(payload, reason));
        toast(`· 档位「${payload.tierName}」已新建`);
      },
    });
  };

  const openCreateWheelGuard = () => {
    openActionConfirm({
      action: "新建轮盘护栏",
      detail: <>新建轮盘护栏目录项;key 小写英文唯一。</>,
      businessForm: { kind: "wheel-guard-config", subject: "新护栏" },
      run: async (reason, _v, bv) => {
        if (!bv) return;
        const payload = {
          guardKey: String(bv.guardKey || "").trim(),
          guardLabel: String(bv.guardLabel || "").trim(),
          guardValue: String(bv.guardValue || "").trim(),
          note: String(bv.note || "").trim(),
        };
        if (!payload.guardKey || !payload.guardLabel) return;
        apply(await createH4WheelGuard(payload, reason));
        toast(`· 护栏「${payload.guardLabel}」已新建`);
      },
    });
  };

  if (loading) {
    return <section className="l-card"><div className="l-b">{moduleLabel} 数据加载中...</div></section>;
  }

  if (error || !model) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">{moduleLabel} 数据加载失败</span></div>
        <div className="l-b">{error ?? "UNKNOWN_ERROR"}</div>
      </section>
    );
  }

  const h3Stats = model.h3Stats ?? {};
  const h4Stats = model.h4Stats ?? {};
  const currentPhase = text(model.phaseMultiplierReadonly?.currentPhase, "");
  const currentPhaseCode = cleanPhaseKey(currentPhase);
  const phaseMultiplier = text(model.phaseMultiplierReadonly?.value, "0");
  const currentWeeklyMultiplier = text(
    model.weeklyMultipliers?.find((item) => cleanPhaseKey(item.p) === currentPhaseCode)?.mult,
    "0×",
  );
  const promoBanner = model.promoBanner ?? {};
  const wheelProbabilitySum = (model.wheelTiers ?? []).reduce((sum, tier) => sum + numericValue(tier.prob), 0);
  const wheelProbabilityOk = Math.abs(wheelProbabilitySum - 100) < 0.001;

  return (
    <>
      {section === "tasks" ? (
        <div className="f-stats">
          <div className="f-stat">
            <div className="k">首日任务领取率</div>
            <div className="v">{text(h3Stats.dayOneRate24h)} / {text(h3Stats.dayOneRateGrace)}</div>
            <div className="sub">24h 内全额 · 宽限期降档领</div>
          </div>
          <div className="f-stat ok">
            <div className="k">本周任务完成</div>
            <div className="v">{text(h3Stats.weeklyDone)}</div>
            <div className="sub">Tier1 {text(h3Stats.t1Done)} · Tier2 {text(h3Stats.t2Done)}</div>
          </div>
          <div className="f-stat warn">
            <div className="k">本周 NEX 派发</div>
            <div className="v">{text(h3Stats.weeklyNex)}</div>
            <div className="sub">含 Phase 加成 {currentPhaseCode} {currentWeeklyMultiplier}</div>
          </div>
          <div className="f-stat cyan">
            <div className="k">月度挑战在途</div>
            <div className="v">{numericValue(h3Stats.monthlyInflight).toLocaleString("en-US")} 人</div>
            <div className="sub">5 主题按账龄自动派发</div>
          </div>
        </div>
      ) : (
        <div className="f-stats">
          <div className="f-stat">
            <div className="k">进行中活动</div>
            <div className="v">{text(h4Stats.ongoing)}</div>
            <div className="sub">主推位:{text(h4Stats.featuredEv)}(唯一)</div>
          </div>
          <div className="f-stat ok">
            <div className="k">可追踪活动转化</div>
            <div className="v">参与 {text(h4Stats.trackJoin)}</div>
            <div className="sub">达标 {text(h4Stats.trackDone)} · 已领 {text(h4Stats.trackClaim)}</div>
          </div>
          <div className="f-stat warn">
            <div className="k">今日转盘派彩</div>
            <div className="v">{text(h4Stats.wheelToday)}</div>
            <div className="sub">预算护栏内 · 真实奖正常开放</div>
          </div>
          <div className="f-stat danger">
            <div className="k">地域屏蔽活动</div>
            <div className="v">{text(h4Stats.geoBlocked)}</div>
            <div className="sub">边缘 IP 判定 · 应急编排归 J1</div>
          </div>
        </div>
      )}

      {section === "tasks" && (
        <>
      <div className="two-col">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">首日任务(Day-One)</span>
            <span className="sub">· 新人转化最核心的钩子 · 改动只影响新进窗用户</span>
            <div className="r">
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("dayOne.windowMs", "首日任务时窗", text(model.dayOneWindow), false)}>
                调整
              </button>
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("dayOne.triReward", "首日三相奖励", text(model.dayOneTriReward), true)}>
                调整奖励
              </button>
              <button className="l-btn sm mc" onClick={() => openCreateMission("DAY_ONE", "首日任务")}>+ 新建任务</button>
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="p-row">
              <span className="k">
                时窗
                <small>改窗对在窗用户按各自进窗时间锁定,不追溯。</small>
              </span>
              <span className="v">{text(model.dayOneWindow)}</span>
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("dayOne.windowMs", "首日任务时窗", text(model.dayOneWindow), false)}>调整</button>
            </div>
            <div className="p-row">
              <span className="k">完成奖励(三相)</span>
              <span className="v">{text(model.dayOneTriReward)}</span>
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("dayOne.triReward", "首日三相奖励", text(model.dayOneTriReward), true)}>调整</button>
            </div>

            <div className="l-h" style={{ marginTop: 12, border: 0, paddingBottom: 0 }}>
              <span className="ttl" style={{ fontSize: 13 }}>任务清单</span>
              <span className="sub">· 多字段读模型 · 奖励可调 · 停用任务不在用户端展示</span>
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
                  {model.dayOneTasks.map((task, index) => {
                    const id = numberId(task.id, index);
                    const [statusLabel, statusTone] = statusMeta(task.status);
                    const active = text(task.status, "") === "active";
                    return (
                      <tr key={id}>
                        <td style={{ fontWeight: 600, color: active ? "var(--ink)" : "var(--ink-3)" }}>{text(task.task)}</td>
                        <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{text(task.href)}</td>
                        <td className="num mono" style={{ fontWeight: 700, color: active ? undefined : "var(--ink-3)" }}>{text(task.reward)}</td>
                        <td><span className={`bdg ${statusTone}`}>{statusLabel}</span></td>
                        <td style={{ fontSize: 11.5 }}>
                          <span style={{ color: "var(--ink-2)" }}>{COMPLETION_LABEL[text(task.completionType, "visit")] ?? "访问路径"}</span>
                          {task.completionEvent ? <span className="mono" style={{ color: "var(--ink-4)", marginLeft: 4 }}>{text(task.completionEvent)}</span> : null}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <button className="l-btn sm mc" onClick={() => openTaskReward(`dayOne.tasks.${id}.reward`, text(task.task), text(task.reward))}>改奖励</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="sm-strip" style={{ marginTop: 10 }}>
              {(model.dayOneStates ?? []).map((state, index, states) => (
                <span key={state.st}>
                  <span className={`st ${state.tone}`}>{state.label}</span>
                  {index < states.length - 1 && <span className="ar">→</span>}
                </span>
              ))}
            </div>
            <div className="htint" style={{ marginTop: 10, fontSize: 12 }}>
              <b>状态机</b> · active(24h 内 6 项完成领 500)→ grace(72h 内 200)→ expired(0,首页让位)。
            </div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">每周任务(两档 + 周冠军)</span>
            <span className="sub">· 按周键确定性派发 · 同周锁定 · 改动下周生效</span>
            <div className="r">
              <button className="l-btn sm mc" onClick={() => openCreateMission("WEEKLY_T1", "每周一档")}>+ 新建一档</button>
              <button className="l-btn sm mc" onClick={() => openCreateMission("WEEKLY_T2", "每周二档")}>+ 新建二档</button>
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="l-h" style={{ marginTop: 2, border: 0, paddingBottom: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>一档(优先级派发 · 命中第一条)</span>
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
                  {model.weeklyTier1.map((task, index) => {
                    const [statusLabel, statusTone] = statusMeta(task.status);
                    return (
                      <tr key={`${task.cond}-${index}`}>
                        <td style={{ fontWeight: 600 }}>{text(task.cond)}</td>
                        <td className="num mono" style={{ fontWeight: 700 }}>{text(task.reward)}</td>
                        <td><span className={`bdg ${statusTone}`}>{statusLabel}</span></td>
                        <td style={{ fontSize: 11.5 }}>
                          <span style={{ color: "var(--ink-2)" }}>{COMPLETION_LABEL[text(task.completionType, "event")] ?? "业务事件"}</span>
                          {task.completionEvent ? <span className="mono" style={{ color: "var(--ink-4)", marginLeft: 4 }}>{text(task.completionEvent)}</span> : null}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button className="l-btn sm mc" onClick={() => openTaskReward(`weekly.tier1.${index}.reward`, text(task.cond), text(task.reward))}>改奖励</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="l-h" style={{ marginTop: 14, border: 0, paddingBottom: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>二档(完成池 · 每条独立派发)</span>
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
                  {model.weeklyTier2.map((task, index) => {
                    const [statusLabel, statusTone] = statusMeta(task.status);
                    return (
                      <tr key={`${task.cond}-${index}`}>
                        <td style={{ fontWeight: 600 }}>{text(task.cond)}</td>
                        <td className="num mono" style={{ fontWeight: 700 }}>{text(task.reward)}</td>
                        <td><span className={`bdg ${statusTone}`}>{statusLabel}</span></td>
                        <td style={{ fontSize: 11.5 }}>
                          <span style={{ color: "var(--ink-2)" }}>{COMPLETION_LABEL[text(task.completionType, "event")] ?? "业务事件"}</span>
                          {task.completionEvent ? <span className="mono" style={{ color: "var(--ink-4)", marginLeft: 4 }}>{text(task.completionEvent)}</span> : null}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button className="l-btn sm mc" onClick={() => openTaskReward(`weekly.tier2.${index}.reward`, text(task.cond), text(task.reward))}>改奖励</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="htint cyan" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
              <span style={{ flex: 1 }}>
                <b>周冠军加奖</b> · {text(model.weeklyChampionBonus)} · 累计 NEX 最高的当周用户额外加奖
              </span>
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("weekly.champBonus", "周冠军加奖", text(model.weeklyChampionBonus), true)}>调整</button>
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, margin: "12px 0 6px", color: "var(--ink-2)" }}>
              阶段倍率曲线(点档位调整)
            </div>
            <div className="mult-track">
              {(model.weeklyMultipliers ?? []).map((item) => {
                const phase = cleanPhaseKey(item.p);
                const isCurrent = phase === currentPhaseCode;
                return (
                  <div
                    key={item.p}
                    className={`seg${isCurrent ? " cur" : ""}`}
                    onClick={() => openSimpleConfig(`weekly.mult.${phase}`, `阶段倍率 ${phase}`, text(item.mult), true)}
                    style={{ cursor: "pointer" }}
                    title="点击改值"
                  >
                    <div className="m">{phase}{isCurrent ? " 当前" : ""}</div>
                    <div className="vv">{text(item.mult)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      <section className="l-card" data-proof="h3-event-contract">
        <div className="l-h">
          <span className="ttl">任务事件契约与归因(只读)</span>
          <span className="sub">· task_key / 服务端完成事件 / 下游业务事件 / B3 漏斗 / BI 口径</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1080 }}>
            <thead>
              <tr>
                <th>任务</th>
                <th>task_key</th>
                <th>服务端完成事件</th>
                <th>下游业务事件</th>
                <th>B3 漏斗</th>
                <th>仅留存</th>
                <th>Day7 贡献</th>
                <th>L 域 BI 表.字段</th>
                <th className="num">24h 样本</th>
                <th className="num">异常率</th>
              </tr>
            </thead>
            <tbody>
              {model.dayOneTasks.map((task, index) => {
                const contract = contractForTask(task, model.taskContracts, index);
                return (
                  <tr key={`${text(task.id, String(index))}-${text(contract.taskKey, String(index))}`}>
                    <td style={{ fontWeight: 600, color: "var(--ink)" }}>{text(task.task)}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{text(contract.taskKey)}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{text(contract.serverEvent)}</td>
                    <td className="mono" style={{ fontSize: 11, color: text(contract.downstream) === "-" ? "var(--ink-4)" : undefined }}>{text(contract.downstream)}</td>
                    <td>{boolValue(contract.b3) ? <span className="bdg ok">进 B3</span> : <span className="bdg dim">否</span>}</td>
                    <td>{boolValue(contract.retentionOnly) ? <span className="bdg warn">是</span> : <span className="bdg dim">否</span>}</td>
                    <td style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{text(contract.day7)}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{text(contract.bi)}</td>
                    <td className="num mono">{numericValue(contract.sample24h).toLocaleString("en-US")}</td>
                    <td className="num mono">{text(contract.anomalyPct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="htint" style={{ fontSize: 12 }}>
            <b>契约 = 归因共同事实源</b> · task_key 串起任务配置、服务端完成事件、下游业务事件、B3 漏斗和 L 域 BI。
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">月度挑战(按账龄派发)</span>
          <span className="sub">· 每主题 3 个子目标全达成才可领 · 跨月清空重派</span>
          <div className="r">
            <button className="l-btn sm mc" onClick={() => openCreateMonthlyMission()}>+ 新建月度挑战</button>
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
              {model.monthlyMissions.map((mission) => {
                const [statusLabel, statusTone] = statusMeta(mission.status);
                return (
                  <tr key={text(mission.id)}>
                    <td style={{ fontWeight: 600 }}>{text(mission.theme)}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{text(mission.age)}</td>
                    <td className="num mono" style={{ fontWeight: 700 }}>{text(mission.reward)}</td>
                    <td style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{text(mission.goals)}</td>
                    <td><span className={`bdg ${statusTone}`}>{statusLabel}</span></td>
                    <td style={{ textAlign: "right" }}>
                      <button className="l-btn sm mc" onClick={() => openTaskReward(`monthly.${text(mission.id)}.reward`, text(mission.theme), text(mission.reward))}>改奖励</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">阶段加成(只读)与完成监控</span>
          <span className="sub">· 全局任务加成归 H1 派发 · 这页只套用</span>
          <div className="r">
            <a href="/growth/phase" className="l-btn">去 H1 调整 →</a>
          </div>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          <div className="htint warn" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1 }}>
              <b>全局任务加成 H1 派发</b> · 当前阶段 {currentPhaseCode},当前全局任务倍率 {phaseMultiplier}x。要调去 H1。
            </span>
            <span className="v mono" style={{ fontWeight: 700 }}>{phaseMultiplier}x</span>
          </div>
          <div className="htint" style={{ marginTop: 8, fontSize: 12 }}>
            <b>两套倍率别混</b> · 上方“一档阶段倍率”是每周任务自己的曲线;“全局任务加成”是 H1 的节奏旋钮。
          </div>

          <div style={{ fontSize: 12, fontWeight: 600, margin: "12px 0 4px", color: "var(--ink-2)" }}>
            完成 / 领取监控(服务器台账)
          </div>
          {(model.taskMonitor ?? []).map((item) => (
            <div className="p-row" key={item.label}>
              <span className="k"><b>{item.label}:</b> {item.note}</span>
            </div>
          ))}
          <div className="htint dim" style={{ marginTop: 8, fontSize: 12 }}>
            <b>结算</b> · 重复领取不重复入账;过期 vs 领取按过期优先。
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">本周转化卡(首页促销 banner)</span>
          <span className="sub">· 首页“激活设备领 NEX”促销卡 · 设备 upsell · 单实例配置</span>
          <div className="r">
            <span className={`bdg ${text(promoBanner.status, "") === "active" ? "ok" : "dim"}`}>
              {text(promoBanner.status, "") === "active" ? "上架中" : "已下架"}
            </span>
          </div>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          <div className="p-row">
            <span className="k">
              基础奖励 × 倍率 = 最终奖励
              <small>对应用户端首页促销卡展示。</small>
            </span>
            <span className="v">{text(promoBanner.baseReward)} × {text(promoBanner.multiplier)} = {promoFinalReward(promoBanner.baseReward, promoBanner.multiplier)} NEX</span>
            <button className="l-btn sm mc" onClick={() => openSimpleConfig("promoBanner.baseReward", "转化卡基础奖励", text(promoBanner.baseReward), true)}>改基础</button>
            <button className="l-btn sm mc" onClick={() => openSimpleConfig("promoBanner.multiplier", "转化卡倍率", text(promoBanner.multiplier), true)}>改倍率</button>
          </div>
          <div className="p-row">
            <span className="k">倒计时窗口</span>
            <span className="v">{text(promoBanner.countdownDays)}d {text(promoBanner.countdownHours)}h</span>
            <button className="l-btn sm mc" onClick={() => openSimpleConfig("promoBanner.countdownDays", "转化卡倒计时天数", text(promoBanner.countdownDays), false)}>改天数</button>
            <button className="l-btn sm mc" onClick={() => openSimpleConfig("promoBanner.countdownHours", "转化卡倒计时小时", text(promoBanner.countdownHours), false)}>改小时</button>
          </div>
          <div className="p-row">
            <span className="k">目标设备 / 日产展示</span>
            <span className="v">{text(promoBanner.targetDevice)} · ${text(promoBanner.targetDaily)}/d</span>
            <button className="l-btn sm mc" onClick={() => openSimpleConfig("promoBanner.targetDevice", "转化卡目标设备", text(promoBanner.targetDevice), false)}>改设备</button>
            <button className="l-btn sm mc" onClick={() => openSimpleConfig("promoBanner.targetDaily", "转化卡日产展示", text(promoBanner.targetDaily), false)}>改日产</button>
          </div>
          <div className="p-row">
            <span className="k">首页上下架</span>
            <span className="v">{text(promoBanner.status, "") === "active" ? "上架中" : "已下架"}</span>
            <button
              className="l-btn sm mc"
              onClick={() => openSimpleConfig("promoBanner.status", "转化卡上下架", text(promoBanner.status, "") === "active" ? "paused" : "active", false)}
            >
              {text(promoBanner.status, "") === "active" ? "下架" : "上架"}
            </button>
          </div>
          <div className="htint" style={{ marginTop: 10, fontSize: 12 }}>
            <b>本周转化卡</b> = 首页设备 upsell 促销 banner,不是任务清单。最终奖励 = 基础 × 倍率;升奖励 / 倍率走 B1 红线。
          </div>
        </div>
      </section>
        </>
      )}

      {section === "events" && (
        <>
      <div className="two-col">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">活动列表(玩法闭集 8 种 · 当前演示 {model.events.length} 条)</span>
            <span className="sub">· 主推位同时只能有一个 · 时间全按 UTC</span>
            <div className="r">
              <button className="l-btn sm mc" onClick={() => openCreateEvent()}>+ 新建活动</button>
            </div>
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
                {model.events.map((event) => {
                  const [label, tone] = stateTone.get(event.state) ?? EVENT_LABEL[event.state] ?? [event.state, "dim"];
                  const ended = event.state === "ended";
                  return (
                    <tr key={event.id}>
                      <td style={{ fontWeight: 600, color: "var(--ink)" }}>{event.name}</td>
                      <td><span className="bdg dim">{text(event.kind)}</span></td>
                      <td><span className={`bdg ${tone}`}>{label}</span></td>
                      <td className="num mono">{text(event.reward)}</td>
                      <td>{event.featured ? <span className="bdg warn">主推</span> : <span style={{ color: "var(--ink-4)" }}>-</span>}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="l-btn sm mc" onClick={() => openEventReward(event)} disabled={ended} style={{ marginRight: 6 }}>编辑</button>
                        {!ended && (
                          <button className="l-btn sm mc" onClick={() => openEventStatus(event)} style={{ marginRight: 6 }}>
                            {event.state === "ongoing" ? "下架" : "上架"}
                          </button>
                        )}
                        {event.state === "ongoing" && (
                          <button className="l-btn sm mc" onClick={() => openEventFeatured(event)}>
                            {event.featured ? "取消主推" : "设主推"}
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
              {(model.eventStates?.length ? model.eventStates : [
                { state: "upcoming" as EventState, label: "预告", tone: "dim" },
                { state: "ongoing" as EventState, label: "进行中", tone: "ok" },
                { state: "ended" as EventState, label: "已结束", tone: "dim" },
              ]).map((state, index, states) => (
                <span key={state.state} style={{ display: "contents" }}>
                  <span className={`st ${state.tone}`}>{state.state} {state.label}</span>
                  {index < states.length - 1 && <span className="ar">→</span>}
                </span>
              ))}
              <span className="ar" style={{ marginLeft: 10 }}>参与:</span>
              <span className="st">joined</span>
              <span className="ar">→</span>
              <span className="st warn">done 达标</span>
              <span className="ar">→</span>
              <span className="st ok">claimed 已领</span>
            </div>
            <div className="htint" style={{ marginTop: 8, fontSize: 12 }}>
              <b>可追踪活动</b> · 进度按真实状态判定,状态在各业务域维护,这里做统一展示。
            </div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">抽奖转盘治理</span>
            <span className="sub">· 一个转盘一张奖池表(日免费 + 签到满 30 天加抽票共用)</span>
            <div className="r">
              <button className="l-btn mc" onClick={() => openSimpleConfig("wheel.pool", "转盘奖池签名", text(model.wheelSignature), true)}>
                改奖池 / 概率
              </button>
              <button className="l-btn sm mc" onClick={() => openCreateWheelTier()}>+ 新建档位</button>
              <button className="l-btn sm mc" onClick={() => openCreateWheelGuard()}>+ 新建护栏</button>
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="wheel-row" style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-4)" }}>
              <span>档位</span>
              <span>奖项</span>
              <span>概率</span>
              <span>性质</span>
              <span />
            </div>
            {(model.wheelTiers ?? []).map((tier) => {
              const real = boolValue(tier.real);
              return (
                <div className="wheel-row" key={text(tier.tier)}>
                  <span style={{ fontWeight: 600, color: "var(--ink)" }}>{text(tier.tier)}</span>
                  <span className="mono">{text(tier.reward)}</span>
                  <span className="mono" style={{ fontWeight: 700 }}>{percentText(tier.prob)}%</span>
                  <span>{real ? <span className="bdg bad">真实流出</span> : <span className="bdg dim">{text(tier.kind)}</span>}</span>
                  <span />
                </div>
              );
            })}

            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 12, color: "var(--ink-4)" }}>概率合计</span>
              <span className={`bdg ${wheelProbabilityOk ? "ok" : "bad"}`}>
                = {wheelProbabilitySum.toFixed(1)}%{wheelProbabilityOk ? "" : " · 不等于 100"}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
              {(model.wheelGuards ?? []).map((guard) => (
                <div key={guard.key} className="htint" style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1 }}>
                    <b>{guard.label}</b> {guard.value}
                    {guard.note && (
                      <>
                        <br />
                        <span style={{ color: "var(--ink-4)" }}>{guard.note}</span>
                      </>
                    )}
                  </span>
                  <button className="l-btn sm mc" onClick={() => openSimpleConfig(`wheel.guards.${guard.key}`, `转盘护栏 · ${guard.label}`, guard.value, guard.key !== "kill")}>
                    {guard.key === "kill" ? "切" : "调"}
                  </button>
                </div>
              ))}
            </div>

            <div className="htint cyan" style={{ marginTop: 8, fontSize: 12 }}>
              <b>当前 EV ≈ ${text(model.wheelEvUsd)} / spin</b> · 真实流出期望由现金档贡献,奖池变更后重新计算。
            </div>
            <div className="htint ok" style={{ marginTop: 8, fontSize: 12 }}>
              <b>第四道护栏(自动)</b> · 抽奖前查覆盖率,跌破 100% 真钱档暂停、只发 NEX/券,回升自动恢复。
            </div>
          </div>
        </section>
      </div>

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
              {(model.trackables ?? []).map((item) => (
                <tr key={item.id}>
                  <td style={{ fontWeight: 600, color: "var(--ink)" }}>{item.name}</td>
                  <td style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{item.cond}</td>
                  <td className="num mono">{item.join}</td>
                  <td className="num mono">{item.done}</td>
                  <td className="num mono">{item.claim}</td>
                  <td>{item.geo === "全区" ? <span className="bdg dim">全区</span> : <span className="bdg warn">{item.geo}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="htint" style={{ fontSize: 12 }}>
            <b>并发与时窗</b> · 活动结束/下架和领取赛跑时结束优先;一次性活动按「活动 × 用户」防重,日重置转盘按「活动 × 用户 × 日」防重。
          </div>
        </div>
      </section>
        </>
      )}

      <PaginationExemptionList
        items={section === "tasks"
          ? [
              {
                label: "首日任务",
                maxRows: model.dayOneTasks.length,
                reason: "首日任务为小型配置清单,需要同屏核对奖励",
              },
              {
                label: "周任务",
                maxRows: model.weeklyTier1.length + model.weeklyTier2.length,
                reason: "周任务需要同屏核对两档奖励",
              },
              {
                label: "月度任务",
                maxRows: model.monthlyMissions.length,
                reason: "月度主题数量固定较少,同屏核对奖励更高效",
              },
            ]
          : [
              {
                label: "活动列表",
                maxRows: model.events.length,
                reason: "活动状态和主推关系需要同屏校验",
              },
              {
                label: "可追踪活动",
                maxRows: model.trackables?.length ?? 0,
                reason: "可追踪活动监控为小型只读清单",
              },
            ]}
      />
    </>
  );
}

export function H4ActivityCenter({ ctx }: { ctx: HCtx }) {
  return <H3QuestEvents ctx={ctx} section="events" />;
}

export default H3QuestEvents;
