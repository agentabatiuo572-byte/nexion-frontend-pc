"use client";

import { useEffect, useState } from "react";
import { PaginationExemptionList } from "../design-kit";
import {
  fetchH5CheckIn,
  updateH5CheckInRule,
  updateH5PowerUp,
  updateH5StreakMilestone,
  updateH6EarnMilestone,
  updateH6TickInterval,
} from "@/lib/admin/h-client";
import type { HCtx } from "./types";

type CheckInRule = { key: string; name: string; sub?: string; cur: string; hot?: boolean };
type StreakMilestone = { id: number; day: string; reward: string; kind?: string };
type PowerUp = { id: number; day: number; label: string; sub?: string; downstream?: string; note?: string };
type EarnMilestone = { id: number; key: string; threshold: number; nex: number; weekTrigger?: number };
type H5Model = {
  stats?: Record<string, any>;
  rules: CheckInRule[];
  streakMilestones: StreakMilestone[];
  streakDistribution?: Array<{ day: string; count: string; height: number }>;
  powerUps: PowerUp[];
  earnMilestones: EarnMilestone[];
  tickInterval?: { value: string; seconds: number; min?: number; max?: number; note?: string };
  coverage?: Record<string, any>;
};

function text(value: unknown, fallback = "-") {
  if (value == null || value === "") return fallback;
  return String(value);
}

function numericInput(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function H5DailyMilestones({ ctx }: { ctx: HCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const [model, setModel] = useState<H5Model | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      setModel((await fetchH5CheckIn()) as H5Model);
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

  const apply = (next: Record<string, any>) => setModel(next as H5Model);

  const openRule = (rule: CheckInRule) => {
    const current = text(rule.cur);
    const submit = async (reason: string, value?: string) => {
      if (!value) return;
      apply(await updateH5CheckInRule(rule.key, value, reason));
      toast(`${rule.name} 已更新`);
    };
    if (rule.hot) {
      openActionConfirm({
        action: `签到规则 · ${rule.name}`,
        detail: <>当前 <b>{current}</b>。幸运概率由后端校验两档合计不超过 100%。</>,
        amplifies: true,
        edit: { kind: "text", current },
        run: submit,
      });
      return;
    }
    openConfirm({
      action: `签到规则 · ${rule.name}`,
      detail: <>当前 <b>{current}</b>,提交后写入后端配置。</>,
      chips: [["写后端配置", "ready"], ["审计留痕", "done"]],
      reason: true,
      input: { label: "目标新值", placeholder: `当前 ${current}` },
      okLabel: "确认修改",
      run: submit,
    });
  };

  const openStreak = (milestone: StreakMilestone) => {
    openActionConfirm({
      action: `连签里程碑 · ${milestone.day}`,
      detail: <>当前奖励 <b>{milestone.reward}</b>,升高奖励时后端会检查覆盖率红线。</>,
      amplifies: true,
      edit: { kind: "text", current: milestone.reward },
      run: async (reason, value) => {
        if (!value) return;
        apply(await updateH5StreakMilestone(milestone.id, value, reason));
        toast(`连签 ${milestone.day} 奖励已更新`);
      },
    });
  };

  const openPowerUp = (powerUp: PowerUp) => {
    openActionConfirm({
      action: `Power-Up · ${powerUp.label}`,
      detail: <>当前触发天数 <b>{powerUp.day}</b>。可同步更新运营备注,两项都写后端。</>,
      amplifies: false,
      businessForm: {
        kind: "multi-field",
        title: "Power-Up 配置",
        fields: [
          { key: "day", label: "触发天数", inputKind: "number", current: String(powerUp.day), placeholder: "例如 30" },
          { key: "note", label: "运营备注", inputKind: "text", current: text(powerUp.note, ""), placeholder: "可留空" },
        ],
      },
      run: async (reason, _value, form) => {
        if (!form) return;
        let next: Record<string, any> | null = null;
        if (form.day) {
          next = await updateH5PowerUp(powerUp.id, "day", form.day, reason);
        }
        if (form.note != null) {
          next = await updateH5PowerUp(powerUp.id, "note", form.note, reason);
        }
        if (next) apply(next);
        toast(`${powerUp.label} 已更新`);
      },
    });
  };

  const openEarn = (milestone: EarnMilestone) => {
    openActionConfirm({
      action: `收益里程碑 · $${milestone.threshold}`,
      detail: <>当前门槛 <b>${milestone.threshold}</b>,奖励 <b>{milestone.nex} NEX</b>。后端校验门槛顺序。</>,
      amplifies: true,
      businessForm: {
        kind: "multi-field",
        title: "收益里程碑",
        fields: [
          { key: "threshold", label: "门槛(USD)", inputKind: "number", current: String(milestone.threshold), placeholder: "500" },
          { key: "nex", label: "奖励(NEX)", inputKind: "number", current: String(milestone.nex), placeholder: "250" },
        ],
      },
      run: async (reason, _value, form) => {
        if (!form) return;
        const threshold = numericInput(form.threshold, milestone.threshold);
        const nex = numericInput(form.nex, milestone.nex);
        apply(await updateH6EarnMilestone(milestone.key, threshold, nex, reason));
        toast(`${milestone.key} 已更新`);
      },
    });
  };

  const openTick = () => {
    const current = text(model?.tickInterval?.seconds ?? model?.tickInterval?.value, "4");
    openConfirm({
      action: "H6 触发检查间隔",
      detail: <>当前 <b>{text(model?.tickInterval?.value, current)}</b>,后端限制最小/最大值。</>,
      chips: [["写后端配置", "ready"], ["审计留痕", "done"]],
      reason: true,
      input: { label: "秒数", placeholder: current },
      okLabel: "确认修改",
      run: async (reason, value) => {
        if (!value) return;
        apply(await updateH6TickInterval(value, reason));
        toast("H6 触发检查间隔已更新");
      },
    });
  };

  if (loading) {
    return <section className="l-card"><div className="l-b">H5/H6 数据加载中...</div></section>;
  }

  if (error || !model) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">H5/H6 数据加载失败</span></div>
        <div className="l-b">{error ?? "UNKNOWN_ERROR"}</div>
      </section>
    );
  }

  const stats = model.stats ?? {};

  return (
    <>
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">今日签到</div>
          <div className="v">{Number(stats.todaySign ?? 0).toLocaleString()}</div>
          <div className="sub">签到率 {text(stats.signRate)}</div>
        </div>
        <div className="f-stat ok">
          <div className="k">幸运倍率实际 / 配置</div>
          <div className="v">{text(stats.lucky15Actual)} / {text(stats.lucky15Config)}</div>
          <div className="sub">2x 实际 {text(stats.lucky2Actual)} · 配置 {text(stats.lucky2Config)}</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">本周复活</div>
          <div className="v">{Number(stats.weekRevive ?? 0).toLocaleString()}</div>
          <div className="sub">连签里程碑触发 {Number(stats.weekMsTrigger ?? 0).toLocaleString()}</div>
        </div>
        <div className="f-stat warn">
          <div className="k">本周里程碑 NEX</div>
          <div className="v">{text(stats.weekMsNex)}</div>
          <div className="sub">覆盖率 {text(model.coverage?.coverageRatio)}% · 红线 {text(model.coverage?.redlinePct)}%</div>
        </div>
      </div>

      <div className="two-col">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">签到规则</span>
            <span className="sub">· H5 rules 来自后端</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {model.rules.map((rule) => (
              <div className="p-row" key={rule.key}>
                <div className="k">
                  {rule.name}
                  {rule.sub && <small>{rule.sub}</small>}
                </div>
                <span className="v">{text(rule.cur)}</span>
                <button className={`l-btn sm${rule.hot ? " mc" : ""}`} onClick={() => openRule(rule)}>
                  调整
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">连签分布</span>
            <span className="sub">· 后端摘要</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {(model.streakDistribution ?? []).map((item) => (
              <div className="p-row" key={item.day}>
                <span style={{ width: 64, fontWeight: 600 }}>{item.day}</span>
                <div style={{ flex: 1, height: 8, background: "var(--surface-3)", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ width: `${item.height}%`, height: "100%", background: "var(--success)" }} />
                </div>
                <span className="mono" style={{ width: 64, textAlign: "right" }}>{item.count}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">连签里程碑</span>
          <span className="sub">· 奖励从后端配置读取</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 680 }}>
            <thead>
              <tr>
                <th>天数</th>
                <th>类型</th>
                <th className="num">奖励</th>
                <th style={{ textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {model.streakMilestones.map((milestone) => (
                <tr key={milestone.id}>
                  <td style={{ fontWeight: 600 }}>{milestone.day}</td>
                  <td>{text(milestone.kind)}</td>
                  <td className="num mono">{milestone.reward}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="l-btn sm mc" onClick={() => openStreak(milestone)}>改奖励</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">Power-Ups</span>
          <span className="sub">· 触发天数和备注写后端</span>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          {model.powerUps.map((powerUp) => (
            <div className="p-row" key={powerUp.id}>
              <span style={{ flex: 1 }}>
                <b>{powerUp.label}</b>
                <br />
                <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{text(powerUp.sub)} · {text(powerUp.downstream)}</span>
              </span>
              <span className="bdg">{powerUp.day} 天</span>
              <button className="l-btn sm mc" onClick={() => openPowerUp(powerUp)}>调整</button>
            </div>
          ))}
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">H6 收益里程碑</span>
          <span className="sub">· 门槛顺序和奖励由后端校验</span>
          <div className="r">
            <button className="l-btn sm mc" onClick={openTick}>检查间隔: {text(model.tickInterval?.value)}</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>键</th>
                <th className="num">门槛(USD)</th>
                <th className="num">奖励(NEX)</th>
                <th className="num">周触发</th>
                <th style={{ textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {model.earnMilestones.map((milestone) => (
                <tr key={milestone.key}>
                  <td className="mono" style={{ fontWeight: 600 }}>{milestone.key}</td>
                  <td className="num mono">${Number(milestone.threshold).toLocaleString()}</td>
                  <td className="num mono">{Number(milestone.nex).toLocaleString()}</td>
                  <td className="num mono">{Number(milestone.weekTrigger ?? 0).toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="l-btn sm mc" onClick={() => openEarn(milestone)}>调整</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="htint warn">
        <b>server-canonical</b> · H5/H6 读模型为空时后端先写入默认配置,再从 MySQL 配置表查询返回;前端不再以本地 mock 作为有效数据源。
      </div>

      <PaginationExemptionList
        items={[
          {
            label: "连签里程碑",
            maxRows: model.streakMilestones.length,
            reason: "里程碑数量有限,需要同屏比较门槛和奖励",
          },
          {
            label: "H6 收益里程碑",
            maxRows: model.earnMilestones.length,
            reason: "门槛必须严格递增,不适合分页割裂校验",
          },
        ]}
      />
    </>
  );
}

export default H5DailyMilestones;
