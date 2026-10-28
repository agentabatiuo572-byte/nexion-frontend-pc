"use client";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { nexGridBrandText } from "@/lib/admin/brand-copy";

import { useEffect, useState } from "react";
import { PaginationExemptionList } from "../design-kit";
import {
  fetchH5CheckIn,
  updateH5EarnMilestone,
  updateH5EarnTickInterval,
  updateH5PowerUp,
  updateH5StreakMilestone,
} from "@/lib/admin/h-client";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { HCtx } from "./types";

type CheckInRule = { key: string; name: string; sub?: string; cur: string; hot?: boolean };
type StreakMilestone = { id: number; day: string; reward: string; kind?: string };
type PowerUp = {
  id: number;
  day: number;
  label: string;
  sub?: string;
  downstream?: string;
  note?: string;
  /** 该档指向的业务当前是否对客可用;null/undefined = 该档不依赖受管业务。 */
  businessAvailable?: boolean | null;
};
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

function rewardDestination(value: unknown) {
  const path = text(value, "");
  return ({
    "/team": "团队成长页",
    "/me/rewards": "我的奖励页",
    "/wallet/staking": "质押活动页",
    "/market/genesis": "创世节点 资格页",
  } as Record<string, string>)[path] ?? "相关权益页";
}

function numericInput(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const NUMERIC_RULE_KEYS = new Set(["baseline", "bonus7", "p15", "p2", "broken"]);

function numericText(value: unknown, fallback = "") {
  const match = String(value ?? "").match(/-?\d+(?:\.\d+)?/);
  return match ? match[0] : fallback;
}

export function H5DailyMilestones({ ctx }: { ctx: HCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const canRuleWrite = ctx.can("growth_h5_rule_write");
  const canWrite = ctx.can("growth_h5_write");
  const propose = usePropose();
  const [model, setModel] = useState<H5Model | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      setModel((await fetchH5CheckIn()) as H5Model);
      setError(null);
    } catch (err) {
      setError(displayAdminError(err));
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
    const currentNumber = numericText(current);
    const submit = (reason: string, value?: string) => {
      if (!value) return;
      const nextValue = NUMERIC_RULE_KEYS.has(rule.key) ? numericText(value, currentNumber) : value;
      if (!nextValue) return;
      const def = findHighOp("h5_checkin_rule")!;
      void propose(ctx.toast, {
        action: `签到规则 · ${operatorCopyText(rule.name)}`,
        obj: rule.key,
        before: current,
        after: String(nextValue),
        type: "param",
        amplifies: false,
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "H5",
        command: def.buildCommand({ ruleKey: rule.key, value: nextValue, expectedValue: currentNumber || current }),
        target: def.buildTarget({ ruleKey: rule.key }),
      });
    };
    if (rule.hot) {
      openActionConfirm({
        action: `签到规则 · ${operatorCopyText(rule.name)}`,
        detail: <>当前 <b>{current}</b>。两档幸运概率加起来不能超过 100%。</>,
        amplifies: true,
        edit: { kind: "number", current: currentNumber || current },
        run: submit,
      });
      return;
    }
    openConfirm({
      action: `签到规则 · ${operatorCopyText(rule.name)}`,
      detail: <>当前 <b>{current}</b>。保存后马上生效。</>,
      chips: [["记入操作记录", "done"]],
      reason: true,
      input: { label: "新值", placeholder: `当前 ${currentNumber || current}` },
      okLabel: "确认修改",
      run: submit,
    });
  };

  const openStreak = (milestone: StreakMilestone) => {
    openActionConfirm({
      action: `连签里程碑 · ${milestone.day}`,
      detail: <>当前奖励 <b>{operatorCopyText(milestone.reward)}</b>。调高奖励时，覆盖率低于红线无法保存。</>,
      amplifies: true,
      edit: { kind: "text", current: milestone.reward },
      run: async (reason, value) => {
        if (!value) return;
        apply(await updateH5StreakMilestone(milestone.id, value, milestone.reward, reason));
        toast(`连签 ${milestone.day} 奖励已更新`);
      },
    });
  };

  const openPowerUp = (powerUp: PowerUp) => {
    openActionConfirm({
      action: `连续签到成长奖励 · ${operatorCopyText(powerUp.label)}`,
      detail: <>当前连续签到 <b>{powerUp.day}</b> 天触发。可以顺便改运营备注。</>,
      amplifies: false,
      businessForm: {
        kind: "multi-field",
        title: "连续签到成长奖励设置",
        fields: [
          { key: "day", label: "触发天数", inputKind: "number", current: String(powerUp.day), placeholder: "例如 30" },
          { key: "note", label: "运营备注", inputKind: "text", current: text(powerUp.note, ""), placeholder: "可留空" },
        ],
      },
      run: async (reason, _value, form) => {
        if (!form) return;
        if (!form.day) return;
        const next = await updateH5PowerUp(
          powerUp.id,
          form.day,
          form.note ?? "",
          powerUp.day,
          text(powerUp.note, ""),
          reason,
        );
        apply(next);
        toast(`${operatorCopyText(powerUp.label)} 已更新`);
      },
    });
  };

  const openEarn = (milestone: EarnMilestone) => {
    openActionConfirm({
      action: `收益里程碑 · $${milestone.threshold}`,
      detail: <>当前门槛 <b>${milestone.threshold}</b>，奖励 <b>{milestone.nex} UVT</b>。门槛要从小到大排列。</>,
      amplifies: true,
      businessForm: {
        kind: "multi-field",
        title: "收益里程碑",
        fields: [
          { key: "threshold", label: "门槛（USD）", inputKind: "number", current: String(milestone.threshold), placeholder: "500" },
          { key: "nex", label: "奖励（UVT）", inputKind: "number", current: String(milestone.nex), placeholder: "250" },
        ],
      },
      run: async (reason, _value, form) => {
        if (!form) return;
        const threshold = numericInput(form.threshold, milestone.threshold);
        const nex = numericInput(form.nex, milestone.nex);
        apply(await updateH5EarnMilestone(milestone.key, threshold, nex, reason));
        toast(`${milestone.key} 已更新`);
      },
    });
  };

  const openTick = () => {
    const current = text(model?.tickInterval?.seconds ?? model?.tickInterval?.value, "4");
    const currentSeconds = String(model?.tickInterval?.seconds ?? numericText(model?.tickInterval?.value, "4"));
    openConfirm({
      action: "收益里程碑触发检查间隔",
      detail: <>当前 <b>{text(model?.tickInterval?.value, current)}</b>。系统每隔这么多秒检查一次谁达到了收益里程碑。</>,
      chips: [["记入操作记录", "done"]],
      reason: true,
      input: { label: "秒数", placeholder: currentSeconds },
      okLabel: "确认修改",
      run: async (reason, value) => {
        if (!value) return;
        const nextValue = numericText(value, currentSeconds);
        if (!nextValue) return;
        apply(await updateH5EarnTickInterval(nextValue, reason));
        toast("收益里程碑触发检查间隔已更新");
      },
    });
  };

  if (loading) {
    return <section className="l-card"><div className="l-b">签到数据加载中…</div></section>;
  }

  if (error || !model) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">签到数据加载失败</span></div>
        <div className="l-b">
          {error ?? "没有收到数据，请重试；一直失败请联系值班同事。"}
          <button className="l-btn sm" style={{ marginLeft: 8 }} onClick={() => void reload()}>重试</button>
        </div>
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
          <div className="k">幸运倍率 实际 / 设置</div>
          <div className="v">{text(stats.lucky15Actual)} / {text(stats.lucky15Config)}</div>
          <div className="sub">2x 实际 {text(stats.lucky2Actual)} · 设置 {text(stats.lucky2Config)}</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">本周断签后恢复</div>
          <div className="v">{Number(stats.weekRevive ?? 0).toLocaleString()}</div>
          <div className="sub">连签里程碑触发 {Number(stats.weekMsTrigger ?? 0).toLocaleString()}</div>
        </div>
        <div className="f-stat warn">
          <div className="k">本周里程碑 UVT</div>
          <div className="v">{nexGridBrandText(text(stats.weekMsNex))}</div>
          <div className="sub">覆盖率 {text(model.coverage?.coverageRatio)}% · 红线 {text(model.coverage?.redlinePct)}%</div>
        </div>
      </div>

      <div className="two-col">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">签到规则</span>
            <span className="sub">· 每日签到奖励和幸运倍率</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {model.rules.map((rule) => (
              <div className="p-row" key={rule.key}>
                <div className="k">
                  {operatorCopyText(rule.name)}
                  {rule.sub && <small>{operatorCopyText(rule.sub)}</small>}
                </div>
                <span className="v">{text(rule.cur)}</span>
                <button className={`l-btn sm${rule.hot ? " mc" : ""}`} aria-label={`调整 ${operatorCopyText(rule.name)}`} onClick={() => openRule(rule)} disabled={!canRuleWrite}>
                  调整
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">连签分布</span>
            <span className="sub">· 用户连续签到天数分布</span>
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
          <span className="sub">· 连续签到满指定天数的奖励</span>
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
                  <td>{({nex:"UVT奖励",NEX:"UVT奖励",usdt:"USDT奖励",USDT:"USDT奖励",voucher:"代金券奖励"} as Record<string,string>)[text(milestone.kind)] ?? "成长奖励"}</td>
                  <td className="num mono">{operatorCopyText(milestone.reward)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="l-btn sm mc" aria-label={`修改 ${milestone.day} 天连签奖励`} onClick={() => openStreak(milestone)} disabled={!canWrite}>改奖励</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">连签成长奖励</span>
          <span className="sub">· 连续签到满指定天数解锁的权益</span>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          {model.powerUps.map((powerUp) => (
            <div className="p-row" key={powerUp.id}>
              <span style={{ flex: 1 }}>
                <b>{powerUp.businessAvailable === false ? "目标业务已停用" : powerUp.businessAvailable == null && (powerUp.downstream === "/wallet/staking" || powerUp.downstream === "/market/genesis") ? "目标业务状态未知" : operatorCopyText(powerUp.label)}</b>
                <br />
                <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>
                  {powerUp.businessAvailable === false ? "现在用不了，已获得的记录保留"
                    : powerUp.businessAvailable == null && (powerUp.downstream === "/wallet/staking" || powerUp.downstream === "/market/genesis") ? "暂时无法确认能不能用"
                    : <>{text(powerUp.sub)} · 前往{rewardDestination(powerUp.downstream)}</>}
                </span>
                {/* BUG 195:该档指向的业务已停用时,App 不再给「激活」入口。
                    运营必须看得见这件事 —— 否则会一直以为用户连签 30/60 天后真能拿到入口。 */}
                {powerUp.businessAvailable === false && (
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--warning)", marginTop: 2 }}>
                    目标业务已停用，App 不会显示这项权益；请核对后再开放。
                  </span>
                )}
              </span>
              <span className="bdg">{powerUp.day} 天</span>
              <button className="l-btn sm mc" aria-label={`调整成长奖励 ${operatorCopyText(powerUp.label)}（${powerUp.day} 天）`} onClick={() => openPowerUp(powerUp)} disabled={!canWrite}>调整</button>
            </div>
          ))}
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">收益里程碑</span>
          <span className="sub">· 累计收益达到门槛就发 UVT 奖励</span>
          <div className="r">
            <button className="l-btn sm mc" onClick={openTick} disabled={!canWrite}>检查间隔: {text(model.tickInterval?.value)}</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>编号</th>
                <th className="num">门槛（USD）</th>
                <th className="num">奖励（UVT）</th>
                <th className="num">本周达成</th>
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
                    <button className="l-btn sm mc" aria-label={`调整收益里程碑 ${milestone.key}`} onClick={() => openEarn(milestone)} disabled={!canWrite}>调整</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="htint warn">
        签到规则和里程碑都按当前设置显示；没有数据时显示为空。
      </div>

      <PaginationExemptionList
        items={[
          {
            label: "连签里程碑",
            maxRows: model.streakMilestones.length,
            reason: "里程碑很少，需要一屏比较门槛和奖励",
          },
          {
            label: "收益里程碑",
            maxRows: model.earnMilestones.length,
            reason: "门槛要从小到大，需要一屏核对",
          },
        ]}
      />
    </>
  );
}

export default H5DailyMilestones;
