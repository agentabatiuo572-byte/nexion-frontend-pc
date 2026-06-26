"use client";

import { useEffect, useMemo, useState } from "react";
import { PaginationExemptionList } from "../design-kit";
import {
  fetchH3QuestEvents,
  updateH3QuestConfig,
  updateH4EventFeatured,
  updateH4EventReward,
  updateH4EventStatus,
} from "@/lib/admin/h-client";
import type { HCtx } from "./types";

type EventState = "upcoming" | "ongoing" | "ended";

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
  phaseMultiplierReadonly?: Record<string, any>;
  events: QuestEvent[];
  eventStates?: Array<{ state: EventState; label: string; tone: string }>;
  wheelTiers?: Array<Record<string, any>>;
  wheelSignature?: string;
  wheelEvUsd?: number | string;
  wheelGuards?: Array<{ key: string; label: string; value: string; note?: string }>;
  trackables?: Array<Record<string, any>>;
  coverage?: Record<string, any>;
};

const EVENT_LABEL: Record<EventState, [string, string]> = {
  upcoming: ["预告", "dim"],
  ongoing: ["进行中", "ok"],
  ended: ["已结束", "dim"],
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

function statusOptions(current: EventState) {
  return [current, ...(["upcoming", "ongoing", "ended"] as EventState[]).filter((item) => item !== current)];
}

export function H3QuestEvents({ ctx }: { ctx: HCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const [model, setModel] = useState<H3Model | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return <section className="l-card"><div className="l-b">H3/H4 数据加载中...</div></section>;
  }

  if (error || !model) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">H3/H4 数据加载失败</span></div>
        <div className="l-b">{error ?? "UNKNOWN_ERROR"}</div>
      </section>
    );
  }

  const h3Stats = model.h3Stats ?? {};
  const h4Stats = model.h4Stats ?? {};
  const currentPhase = text(model.phaseMultiplierReadonly?.currentPhase, "P3");
  const phaseMultiplier = text(model.phaseMultiplierReadonly?.value, "1");

  return (
    <>
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">首日任务 24h 领取</div>
          <div className="v">{text(h3Stats.dayOneRate24h)}</div>
          <div className="sub">宽限领取 {text(h3Stats.dayOneRateGrace)}</div>
        </div>
        <div className="f-stat ok">
          <div className="k">周任务完成</div>
          <div className="v">{text(h3Stats.weeklyDone)}</div>
          <div className="sub">一档 {text(h3Stats.t1Done)} · 二档 {text(h3Stats.t2Done)}</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">当前阶段任务倍率</div>
          <div className="v">{currentPhase} · {phaseMultiplier}x</div>
          <div className="sub">H1 阶段旋钮派生,H3 只消费</div>
        </div>
        <div className="f-stat warn">
          <div className="k">进行中活动</div>
          <div className="v">{text(h4Stats.ongoing)}</div>
          <div className="sub">主推 {text(h4Stats.featuredEv)} · 今日转盘 {text(h4Stats.wheelToday)}</div>
        </div>
      </div>

      <div className="two-col">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">首日任务</span>
            <span className="sub">· 后端 dayOneTasks 读模型</span>
            <div className="r">
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("dayOne.windowMs", "首日任务时窗", text(model.dayOneWindow), false)}>
                改时窗
              </button>
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("dayOne.triReward", "首日三相奖励", text(model.dayOneTriReward), true)}>
                改三相奖励
              </button>
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="sm-strip" style={{ marginBottom: 10 }}>
              {(model.dayOneStates ?? []).map((state) => (
                <span key={state.st} className={`st ${state.tone}`}>{state.label}</span>
              ))}
            </div>
            {model.dayOneTasks.map((task, index) => {
              const id = numberId(task.id, index);
              return (
                <div className="p-row" key={id}>
                  <span style={{ flex: 1 }}>
                    <b>{text(task.task)}</b>
                    <br />
                    <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{text(task.href)}</span>
                  </span>
                  <span className="bdg">{text(task.reward)}</span>
                  <button className="l-btn sm mc" onClick={() => openTaskReward(`dayOne.tasks.${id}.reward`, text(task.task), text(task.reward))}>
                    改奖励
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">任务监控</span>
            <span className="sub">· 后端摘要</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {(model.taskMonitor ?? []).map((item) => (
              <div className="p-row" key={item.label}>
                <span className="bdg cyan">{item.label}</span>
                <span style={{ flex: 1, color: "var(--ink-3)", fontSize: 12 }}>{item.note}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="two-col">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">周任务一档</span>
            <span className="sub">· 奖励从 nx_config_item 查询</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {model.weeklyTier1.map((task, index) => (
              <div className="p-row" key={`${task.cond}-${index}`}>
                <span style={{ flex: 1 }}><b>{text(task.cond)}</b></span>
                <span className="bdg">{text(task.reward)}</span>
                <button className="l-btn sm mc" onClick={() => openTaskReward(`weekly.tier1.${index}.reward`, text(task.cond), text(task.reward))}>改奖励</button>
              </div>
            ))}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">周任务二档</span>
            <span className="sub">· 奖励从 nx_config_item 查询</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {model.weeklyTier2.map((task, index) => (
              <div className="p-row" key={`${task.cond}-${index}`}>
                <span style={{ flex: 1 }}><b>{text(task.cond)}</b></span>
                <span className="bdg">{text(task.reward)}</span>
                <button className="l-btn sm mc" onClick={() => openTaskReward(`weekly.tier2.${index}.reward`, text(task.cond), text(task.reward))}>改奖励</button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">周任务倍率 / 月度任务</span>
          <span className="sub">· H3 配置接口写入</span>
          <div className="r">
            <button className="l-btn sm mc" onClick={() => openSimpleConfig("weekly.champBonus", "周冠军加奖", text(model.weeklyChampionBonus), true)}>
              改周冠军加奖
            </button>
          </div>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          <div className="sm-strip" style={{ marginBottom: 12 }}>
            {(model.weeklyMultipliers ?? []).map((item) => {
              const phase = cleanPhaseKey(item.p);
              return (
                <span
                  key={item.p}
                  className={`st ${phase === currentPhase ? "ok" : "dim"}`}
                  onClick={() => openSimpleConfig(`weekly.mult.${phase}`, `阶段倍率 ${phase}`, text(item.mult), true)}
                  style={{ cursor: "pointer" }}
                >
                  {item.p} · {item.mult}
                </span>
              );
            })}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th>月度主题</th>
                  <th>账龄</th>
                  <th>目标</th>
                  <th className="num">奖励</th>
                  <th style={{ textAlign: "right" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {model.monthlyMissions.map((mission) => (
                  <tr key={text(mission.id)}>
                    <td style={{ fontWeight: 600 }}>{text(mission.theme)}</td>
                    <td>{text(mission.age)}</td>
                    <td>{text(mission.goals)}</td>
                    <td className="num mono">{text(mission.reward)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="l-btn sm mc" onClick={() => openTaskReward(`monthly.${text(mission.id)}.reward`, text(mission.theme), text(mission.reward))}>改奖励</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">H4 活动 CMS</span>
          <span className="sub">· 活动状态、奖励、主推均走后端接口</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>活动</th>
                <th>类型</th>
                <th>状态</th>
                <th>条件</th>
                <th className="num">奖励</th>
                <th>主推</th>
                <th style={{ textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {model.events.map((event) => {
                const [label, tone] = stateTone.get(event.state) ?? EVENT_LABEL[event.state] ?? [event.state, "dim"];
                return (
                  <tr key={event.id}>
                    <td style={{ fontWeight: 600 }}>{event.name}</td>
                    <td>{text(event.kind)}</td>
                    <td><span className={`bdg ${tone}`}>{label}</span></td>
                    <td>{text(event.condition)}</td>
                    <td className="num mono">{text(event.reward)}</td>
                    <td>{event.featured ? <span className="bdg ok">主推</span> : <span className="bdg dim">普通</span>}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="l-btn sm mc" onClick={() => openEventReward(event)} style={{ marginRight: 6 }}>改奖励</button>
                      <button className="l-btn sm" onClick={() => openEventStatus(event)} style={{ marginRight: 6 }}>改状态</button>
                      <button className="l-btn sm" onClick={() => openEventFeatured(event)}>{event.featured ? "取消主推" : "主推"}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="two-col">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">转盘奖池</span>
            <span className="sub">· 奖池签名和护栏写后端</span>
            <div className="r">
              <button className="l-btn sm mc" onClick={() => openSimpleConfig("wheel.pool", "转盘奖池签名", text(model.wheelSignature), true)}>
                改奖池
              </button>
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="p-row">
              <span style={{ flex: 1 }}><b>真实流出 EV</b><small>由后端奖池计算</small></span>
              <span className="bdg warn">${text(model.wheelEvUsd)}</span>
            </div>
            {(model.wheelTiers ?? []).map((tier) => (
              <div className="p-row" key={text(tier.tier)}>
                <span style={{ flex: 1 }}><b>{text(tier.tier)}</b><small>{text(tier.kind)}</small></span>
                <span className="bdg">{text(tier.reward)}</span>
                <span className="mono" style={{ width: 70, textAlign: "right" }}>{text(tier.prob)}%</span>
              </div>
            ))}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">转盘护栏</span>
            <span className="sub">· 三项均为真实接口配置</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {(model.wheelGuards ?? []).map((guard) => (
              <div className="p-row" key={guard.key}>
                <span style={{ flex: 1 }}><b>{guard.label}</b><small>{guard.note}</small></span>
                <span className="bdg">{guard.value}</span>
                <button className="l-btn sm mc" onClick={() => openSimpleConfig(`wheel.guards.${guard.key}`, `转盘护栏 · ${guard.label}`, guard.value, guard.key !== "kill")}>
                  调整
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <PaginationExemptionList
        items={[
          {
            label: "首日任务",
            maxRows: model.dayOneTasks.length,
            reason: "首日任务为小型配置清单,需要同屏核对奖励",
          },
          {
            label: "H4 活动 CMS",
            maxRows: model.events.length,
            reason: "活动状态和主推关系需要同屏校验",
          },
        ]}
      />
    </>
  );
}

export default H3QuestEvents;
