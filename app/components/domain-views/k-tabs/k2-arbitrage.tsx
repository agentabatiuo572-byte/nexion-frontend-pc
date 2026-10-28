"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PaginationExemptionList } from "../design-kit";
import { TabGroup } from "@/app/components/kit/tab-group";
import type { BusinessFormSpec, BusinessFormValue } from "../design-kit";
import { K1OutcomeUncertainError, newK1CommandKey, type K2Row, type KRiskParam } from "@/lib/admin/k-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { fetchE3Snapshot } from "@/lib/admin/e3-client";
import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { KCtx } from "./types";

/** K2 标记 / 拦礼 / 看板 / 调参 / 联动冻结共用一张表,调用点 scope 已带动作类型前缀 + 目标行号 + 版本
 *  (`k2-flag:行号:版本`、`k2-param:参数键:版本:当前值`),刷新后仍能用同一命令号重试。 */
const commandAttempt = createPendingMutationStore({
  storageKey: "nexion-admin-k2-arbitrage-commands-v1",
});

function errorText(error: unknown) {
  return displayAdminError(error);
}

export function K2HeaderActions() {
  return null;
}

const lvlBadge = (n: number) => <span className={`bdg ${n >= 3 ? "bad" : n === 2 ? "warn" : "dim"}`}>{n} / 3 步</span>;
const judge = (n: number): [string, string] => (n >= 3 ? ["判定套利", "bad"] : n === 2 ? ["可疑预警", "warn"] : ["观察", "dim"]);

type TrialThreshold = { kind: "trial"; operator: string; count: string; days: string };
type GiftThreshold = { kind: "gift"; operator: string; count: string; scope: string };
type BoardThreshold = { kind: "board"; operator: string; multiplier: string; baseline: string };
type K2Threshold = TrialThreshold | GiftThreshold | BoardThreshold;

const K2_PARAM_HELP: Record<string, string> = {
  trialCycleThreshold: "同一人或组织的关联账户在统计期间反复开试用的次数阈值。",
  welcomeGiftAnomalyThreshold: "同一人、同一账户组、同一手机号或同一设备重复领取新人礼的笔数阈值。",
  leaderboardVelocityMultiplier: "排行榜、邀请或佣金增长速度相对基线的倍数阈值。",
};

const K2_DISPOSITION_LABELS: Record<string, string> = {
  account_flagged: "已标记套利",
  gift_blocked: "新人礼已拦截",
  leaderboard_flagged: "已标记刷榜",
  cluster_frozen: "已冻结关联账户",
};

type ExtraParamDef = { key: string; label: string; unit: string; min?: number; max?: number; step?: number; options?: string[] };

const OTP_GATE_PARAMS: ExtraParamDef[] = [
  { key: "otpGate.resendSeconds", label: "验证码重发冷却", unit: "秒", min: 30, max: 300, step: 1 },
  { key: "otpGate.dayLimit", label: "验证码 24h 发送上限", unit: "次/24h", min: 5, max: 50, step: 1 },
  { key: "otpGate.otpTtlSeconds", label: "验证码有效期", unit: "秒", min: 60, max: 900, step: 60 },
  { key: "otpGate.maxVerifyAttempts", label: "最多输错次数", unit: "次", min: 1, max: 10, step: 1 },
  {
    key: "captchaGate.alwaysScenes",
    label: "每次都要求滑块的场景",
    unit: "场景",
    options: ["register", "login", "reset", "register,login", "register,reset", "login,reset", "register,login,reset"],
  },
  { key: "captchaGate.afterSends", label: "累计发送后要求滑块", unit: "次/24h", min: 0, max: 50, step: 1 },
];

function parseK2Threshold(key: string, value: string): K2Threshold | null {
  const text = value.trim().replace(/X/g, "x");
  if (key === "trialCycleThreshold") {
    const match = text.match(/^(>=|>)\s*(\d+)\s*次\s*\/\s*(\d+)\s*天$/);
    return match ? { kind: "trial", operator: match[1], count: match[2], days: match[3] } : null;
  }
  if (key === "welcomeGiftAnomalyThreshold") {
    const match = text.match(/^(>=|>)\s*(\d+)\s*笔\s*\/\s*(实体|账户簇|手机号|设备)$/);
    return match ? { kind: "gift", operator: match[1], count: match[2], scope: match[3] } : null;
  }
  if (key === "leaderboardVelocityMultiplier") {
    const match = text.match(/^(>=|>)\s*(\d+)x\s*(基线|上周期|7日均值|同层级均值)$/);
    return match ? { kind: "board", operator: match[1], multiplier: match[2], baseline: match[3] } : null;
  }
  return null;
}

function defaultK2Threshold(key: string): K2Threshold | null {
  if (key === "trialCycleThreshold") return { kind: "trial", operator: ">=", count: "3", days: "30" };
  if (key === "welcomeGiftAnomalyThreshold") return { kind: "gift", operator: ">=", count: "2", scope: "实体" };
  if (key === "leaderboardVelocityMultiplier") return { kind: "board", operator: ">", multiplier: "5", baseline: "基线" };
  return null;
}

function k2ParamBusinessForm(p: KRiskParam): BusinessFormSpec | null {
  const current = parseK2Threshold(p.key, p.value) ?? defaultK2Threshold(p.key);
  if (!current) return null;
  if (current.kind === "trial") {
    return {
      kind: "multi-field",
      title: "反复试用阈值",
      hint: "次数可填 2–10，统计周期可选 7–60 天。",
      fields: [
        { key: "operator", label: "比较符", current: current.operator, inputKind: "select", options: [">=", ">"] },
        { key: "count", label: "循环次数", current: current.count, inputKind: "number", min: 2, max: 10, step: 1 },
        { key: "days", label: "统计周期(天)", current: current.days, inputKind: "select", options: ["7", "14", "30", "60"] },
      ],
    };
  }
  if (current.kind === "gift") {
    return {
      kind: "multi-field",
      title: "新人礼重复领取阈值",
      hint: "笔数可填 1–5，按什么统计从下拉选择。",
      fields: [
        { key: "operator", label: "比较符", current: current.operator, inputKind: "select", options: [">=", ">"] },
        { key: "count", label: "异常笔数", current: current.count, inputKind: "number", min: 1, max: 5, step: 1 },
        { key: "scope", label: "按什么统计", current: current.scope, inputKind: "select", options: ["实体", "账户簇", "手机号", "设备"], optionLabels: { "实体": "同一人或组织", "账户簇": "关联账户组", "手机号": "手机号", "设备": "设备" } },
      ],
    };
  }
  return {
    kind: "multi-field",
    title: "刷榜增速阈值",
    hint: "倍数可填 2–20，对比基准从下拉选择。",
    fields: [
      { key: "operator", label: "比较符", current: current.operator, inputKind: "select", options: [">", ">="] },
      { key: "multiplier", label: "增速倍数", current: current.multiplier, inputKind: "number", min: 2, max: 20, step: 1 },
      { key: "baseline", label: "和什么比", current: current.baseline, inputKind: "select", options: ["基线", "上周期", "7日均值", "同层级均值"] },
    ],
  };
}

function intValue(value: string | undefined, min: number, max: number): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function buildK2ThresholdValue(key: string, value?: BusinessFormValue): string | null {
  if (!value) return null;
  const operator = value.operator === ">" ? ">" : ">=";
  if (key === "trialCycleThreshold") {
    const count = intValue(value.count, 2, 10);
    const days = intValue(value.days, 7, 60);
    return count && days ? `${operator} ${count} 次 / ${days} 天` : null;
  }
  if (key === "welcomeGiftAnomalyThreshold") {
    const count = intValue(value.count, 1, 5);
    const scope = ["实体", "账户簇", "手机号", "设备"].includes(value.scope ?? "") ? value.scope : null;
    return count && scope ? `${operator} ${count} 笔 / ${scope}` : null;
  }
  if (key === "leaderboardVelocityMultiplier") {
    const multiplier = intValue(value.multiplier, 2, 20);
    const baseline = ["基线", "上周期", "7日均值", "同层级均值"].includes(value.baseline ?? "") ? value.baseline : null;
    return multiplier && baseline ? `${operator} ${multiplier}x ${baseline}` : null;
  }
  return null;
}

function K2ParamValue({ param }: { param: KRiskParam }) {
  const parts = parseK2Threshold(param.key, param.value);
  if (!parts) return <>{param.value}</>;
  if (parts.kind === "trial") {
    return (
      <span className="threshold-parts">
        <span className="seg op">{parts.operator}</span>
        <span className="seg num">{parts.count}</span>
        <span className="seg">次</span>
        <span className="sep">/</span>
        <span className="seg num">{parts.days}</span>
        <span className="seg">天</span>
      </span>
    );
  }
  if (parts.kind === "gift") {
    return (
      <span className="threshold-parts">
        <span className="seg op">{parts.operator}</span>
        <span className="seg num">{parts.count}</span>
        <span className="seg">笔</span>
        <span className="sep">/</span>
        <span className="seg scope">{parts.scope}</span>
      </span>
    );
  }
  return (
    <span className="threshold-parts">
      <span className="seg op">{parts.operator}</span>
      <span className="seg num">{parts.multiplier}x</span>
      <span className="seg scope">{parts.baseline}</span>
    </span>
  );
}

export function K2Arbitrage({ ctx }: { ctx: KCtx }) {
  const propose = usePropose();
  const authorities = useAdminAuth((state) => state.session?.authorities ?? []);
  const hasAuthority = (authority: string) => authorities.includes(authority);
  const canWrite = hasAuthority("risk_k2_write");
  const canFlag = hasAuthority("risk_k2_row_flag");
  const canFreeze = hasAuthority("risk_k2_row_freeze");
  const canBlockGift = hasAuthority("risk_k2_row_blockgift");
  const canBoardFlag = hasAuthority("risk_k2_row_boardflag");
  const overview = ctx.risk.arbitrage;
  const views = overview?.views ?? [];
  const [viewKey, setViewKey] = useState("trial");
  const current = views.find((item) => item.key === viewKey) ?? views[0];
  const allParams = overview?.params ?? [];
  const detectionParams = allParams.filter((param) => K2_PARAM_HELP[param.key]);
  const [ladderTopCredit, setLadderTopCredit] = useState<string>("");
  useEffect(() => {
    let active = true;
    void fetchE3Snapshot()
      .then((snapshot) => { if (active) setLadderTopCredit(snapshot.params["E.tradein.ladder.credit1"] ?? ""); })
      .catch(() => { if (active) setLadderTopCredit(""); });
    return () => { active = false; };
  }, []);

  const runAction = async (scope: string, work: (commandKey: string) => Promise<void>, ok: string) => {
    const commandKey = commandAttempt.get(scope) ?? newK1CommandKey();
    commandAttempt.remember(scope, commandKey);
    try {
      await work(commandKey);
      commandAttempt.forget(scope);
    } catch (error) {
      if (error instanceof K1OutcomeUncertainError) {
        ctx.toast(`结果暂未确认 · 请保留弹窗直接重试 · 命令号 ${error.commandKey}`);
      } else {
        commandAttempt.forget(scope);
        ctx.toast(`操作失败，没有生效，已填写的内容还在 · ${errorText(error)}`);
      }
      throw error;
    }
    try {
      await ctx.reloadKRisk();
      ctx.toast(ok);
    } catch {
      ctx.toast(`${ok}，但页面刷新失败；请点「重新加载」核对`);
    }
  };

  const proposeK2Freeze = async (r: K2Row, reason: string) => {
    const scope = `k2-freeze:${r.rowId}:${r.version}:${r.clusterVersion ?? -1}`;
    const commandKey = commandAttempt.get(scope) ?? newK1CommandKey();
    commandAttempt.remember(scope, commandKey);
    const def = findHighOp("k2_row_freeze")!;
    try {
      const result = await propose(ctx.toast, {
        action: `冻结关联账户 · ${r.cells[0]}`,
        obj: r.rowId,
        before: "已标记可疑",
        after: "冻结关联账户",
        type: "acct",
        amplifies: false,
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "K2",
        commandKey,
        command: def.buildCommand({
          rowId: r.rowId,
          expectedVersion: r.version,
          clusterExpectedVersion: r.clusterVersion,
        }),
        target: def.buildTarget({ rowId: r.rowId }),
      });
      commandAttempt.forget(scope);
      return result;
    } catch (error) {
      if (!isA2OutcomeUncertainError(error)) commandAttempt.forget(scope);
      throw error;
    }
  };

  const markArb = (r: K2Row) =>
    ctx.openConfirm({
      action: `标记套利账户 · ${r.cells[0]}`,
      detail: "标记为套利并附上证据，不冻结、不动钱。标记会计入风险分和风险提醒。",
      chips: [["只标记，附证据", "done"], ["记入操作记录", "ready"]],
      reason: true,
      okLabel: "确认标记",
      run: (reason) => runAction(
        `k2-flag:${r.rowId}:${r.version}`,
        (commandKey) => ctx.actions.executeK2Action(r.rowId, "flag", r.version, undefined, reason, commandKey),
        `${r.cells[0]} 已标记套利`,
      ),
    });

  const blockGift = (r: K2Row) =>
    ctx.openConfirm({
      action: `拦截新人礼 · ${r.cells[0]}`,
      detail: "以后不再给这个账户发新人礼，已到账的不动。",
      chips: [["提前拦截", "done"], ["记入操作记录", "ready"]],
      reason: true,
      okLabel: "确认拦截",
      run: (reason) => runAction(
        `k2-blockgift:${r.rowId}:${r.version}`,
        (commandKey) => ctx.actions.executeK2Action(r.rowId, "blockgift", r.version, undefined, reason, commandKey),
        `${r.cells[0]} 的后续新人礼已拦截`,
      ),
    });

  const boardFlag = (r: K2Row) =>
    ctx.openConfirm({
      action: `标记刷榜账户 · ${r.cells[0]}`,
      detail: "标记为刷榜，会通知排行榜和风险提醒；取消排行榜资格要去「奖励池、名额与排行榜」操作。",
      chips: [["只标记", "done"], ["记入操作记录", "ready"]],
      reason: true,
      okLabel: "确认标记",
      run: (reason) => runAction(
        `k2-boardflag:${r.rowId}:${r.version}`,
        (commandKey) => ctx.actions.executeK2Action(r.rowId, "boardflag", r.version, undefined, reason, commandKey),
        `${r.cells[0]} 已标记刷榜`,
      ),
    });

  const linkFreeze = (r: K2Row) =>
    ctx.openActionConfirm({
      action: `冻结关联账户 · ${r.cells[0]}`,
      detail: `冻结 ${r.cluster || r.rowId} 这组关联账户，套利证据会一起记入操作记录。`,
      reasonMax: 200,
      run: (reason) => proposeK2Freeze(r, reason),
    });

  const adjParam = (p: KRiskParam) => {
    const businessForm = k2ParamBusinessForm(p);
    if (!businessForm) {
      ctx.toast(`${p.name} 暂时不能在这里修改`);
      return;
    }
    ctx.openActionConfirm({
      action: `调整检测阈值 · ${p.name}`,
      detail: `${p.name} · 当前 ${p.value}。${K2_PARAM_HELP[p.key] ?? p.note}`,
      amplifies: true,
      businessForm,
      reasonMax: 200,
      run: (reason, _newVal, businessValue) => {
        const nextValue = buildK2ThresholdValue(p.key, businessValue);
        if (!nextValue) {
          ctx.toast(`${p.name} 参数不完整或超出范围`);
          return;
        }
        return runAction(
          `k2-param:${p.key}:${p.version}:${p.value}`,
          (commandKey) => ctx.actions.updateK2Param(p.key, nextValue, p.version, reason, commandKey),
          `${p.name} 已更新为 ${nextValue}`,
        );
      },
    });
  };

  const adjExtraParam = (definition: ExtraParamDef) => {
    const param = allParams.find((item) => item.key === definition.key);
    if (!param) {
      ctx.toast(`${definition.label} 加载失败，请刷新后重试`);
      return;
    }
    ctx.openActionConfirm({
      action: `调整验证码设置 · ${definition.label}`,
      detail: `${definition.label} · 当前 ${param.value} ${definition.unit}。${param.sub}。只影响之后的判断。`,
      amplifies: false,
      edit: definition.options
        ? { kind: "select", current: param.value, options: definition.options }
        : { kind: "number", current: param.value, unit: definition.unit, min: definition.min, max: definition.max, step: definition.step },
      reasonMax: 200,
      run: (reason, value) => {
        if (value == null || value === "") return;
        const backendValue = value;
        return runAction(
          `k2-param:${definition.key}:${param.version}:${param.value}`,
          (commandKey) => ctx.actions.updateK2Param(definition.key, backendValue, param.version, reason, commandKey),
          `${definition.label} 已更新为 ${value} ${definition.unit}`,
        );
      },
    });
  };

  if (ctx.contentLoading) {
    return <section className="l-card"><div className="l-h"><span className="ttl">套利与刷量数据加载中</span><span className="sub">· 请稍候</span></div></section>;
  }

  if (ctx.contentError) {
    return (
      <section className="l-card" data-module-health-state="error">
        <div className="l-h">
          <span className="ttl">套利与刷量数据加载失败</span>
          <span className="sub">· {errorText(ctx.contentError)} · 为避免误操作，已隐藏数据和操作按钮</span>
          <div className="r"><button className="l-btn" onClick={() => void ctx.reloadKRisk().catch(() => undefined)}>重新加载</button></div>
        </div>
      </section>
    );
  }

  if (!overview) {
    return <section className="l-card"><div className="l-h"><span className="ttl">暂无套利与刷量数据</span></div></section>;
  }

  return (
    <div>
      <div className="f-stats">
        {(overview?.stats ?? []).map((s) => (
          <div className={`f-stat ${s.tone}`} key={s.key}>
            <div className="k">{s.name}</div>
            <div className="v">{s.value}</div>
            <div className="sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">怎么判断套利</span>
          <span className="sub">· 看一连串行为，不看单个动作</span>
          <div className="r"><span className="kcode electric">多步叠加判断</span></div>
        </div>
        <div className="l-b">
          <div className="loop-strip" style={{ marginBottom: 14 }}>
            <span className="st">注册小号</span><span className="ar">→</span>
            <span className="st">绑上级</span><span className="ar">→</span>
            <span className="st hit">领新人礼</span><span className="ar">→</span>
            <span className="st hit">开免费试用</span><span className="ar">→</span>
            <span className="st">取消</span><span className="ar">→</span>
            <span className="st hit">清缓存 · 再来一轮</span>
            <span className="tail">每一步单看都正常，连起来才是套利</span>
          </div>
          <div className="grade-row">
            <div className="ktint warn"><b>命中 2 步</b> → 预警，转人工核查</div>
            <div className="ktint bad"><b>3 步全中</b> → 判定为套利，可冻结关联账户</div>
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">检测阈值</span>
          <span className="sub">· 以旧换新的抵扣比例在「设备使用与以旧换新」设置</span>
          <div className="r">
            <Link className="kcode lock" href="/devices/trade-in" title="以旧换新抵扣比例在「设备使用与以旧换新」设置">🔒 以旧换新首档抵扣 {ladderTopCredit ? `${ladderTopCredit}%` : "加载中"}</Link>
            <Link className="kcode lock" href="/growth/referral-rewards" title="新人礼与邀请奖励在「新人礼与邀请奖励」设置">🔒 新人礼 / 邀请奖励设置</Link>
          </div>
        </div>
        <div className="l-b">
          <div className="param-grid">
            {detectionParams.map((p) => (
              <div className="p" key={p.key}>
                <div className="k">{p.name}</div>
                <div className="v">
                  <K2ParamValue param={p} />
                  {p.unit ? <span className="vu">{p.unit}</span> : null}
                  {canWrite && <button className="l-btn sm mc" aria-label={`调整${p.name}`} onClick={() => adjParam(p)}>调整</button>}
                </div>
                <div className="s">{p.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {[
        { title: "短信验证码设置", sub: "· 只影响之后发送的验证码，已发出的不变。", params: OTP_GATE_PARAMS, proof: "k2-otp-gate-params" },
      ].map((group) => (
        <section className="l-card" key={group.title}>
          <div className="l-h">
            <span className="ttl">{group.title}</span>
            <span className="sub">{group.sub}</span>
            <div className="r"><span className="kcode electric">修改后马上生效</span></div>
          </div>
          <div className="l-b">
            <div className="param-grid" data-proof={group.proof}>
              {group.params.map((definition) => {
                const param = allParams.find((item) => item.key === definition.key);
                return (
                  <div className="p" key={definition.key}>
                    <div className="k">{definition.label}</div>
                    <div className="v">
                      {definition.key === "captchaGate.alwaysScenes" && param ? (param?.value ?? "").split(",").map(value => ({register:"注册",login:"登录",reset:"找回密码"} as Record<string,string>)[value.trim()] ?? value.trim()).join("、") || "无" : param?.value ?? "—"} <span className="vu">{definition.unit}</span>
                      {canWrite && <button className="l-btn sm mc" aria-label={`调整${definition.label}`} disabled={!param} onClick={() => adjExtraParam(definition)}>调整</button>}
                    </div>
                    <div className="s">{param?.sub ?? "加载中"}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ))}

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">检测命中</span>
          <span className="sub">{current?.sub ?? "暂无数据"}</span>
          <div className="r">
            <TabGroup
              className="chips"
              label="套利检测命中视图"
              value={current?.key ?? viewKey}
              items={views.map((view) => view.key)}
              onSelect={setViewKey}
              itemClassName={(_key, selected) => `chip${selected ? " sel" : ""}`}
            >{(key) => views.find((view) => view.key === key)?.label ?? key}</TabGroup>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1020 }}>
            <thead>
              <tr>
                {(current?.head ?? []).map((h) => <th key={h}>{h}</th>)}
                {current?.key !== "board" && <th>命中步数</th>}
                {(current?.key === "trial" || current?.key === "board") && <th>判定</th>}
                <th style={{ textAlign: "right" }}>动作</th>
              </tr>
            </thead>
            <tbody>
              {(current?.rows ?? []).map((r) => {
                const disposed = r.disposition;
                return (
                  <tr key={r.rowId} style={disposed ? { opacity: 0.62 } : undefined}>
                    {r.cells.map((cell, index) => (
                      <td key={`${r.rowId}-${index}`} className={index === 0 ? "mono" : undefined} style={index === 0 ? { color: "var(--ink)", fontWeight: 600 } : { fontSize: 12.5 }}>{cell}</td>
                    ))}
                    {current?.key !== "board" && <td>{lvlBadge(r.level)}</td>}
                    {(current?.key === "trial" || current?.key === "board") && (() => { const [label, tone] = judge(r.level); return <td><span className={`bdg ${tone}`}>{label}</span></td>; })()}
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {disposed ? (
                        <span className="bdg dim">{K2_DISPOSITION_LABELS[disposed] ?? "已处置"}</span>
                      ) : (
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          {r.actions.map((action) => {
                            if (action === "flag") return canFlag ? <button key={action} className="l-btn sm" onClick={() => markArb(r)}>标记套利</button> : null;
                            if (action === "blockgift") return canBlockGift ? <button key={action} className="l-btn sm" onClick={() => blockGift(r)}>拦截新人礼</button> : null;
                            if (action === "boardflag") return canBoardFlag ? <button key={action} className="l-btn sm" onClick={() => boardFlag(r)}>标记刷榜</button> : null;
                            if (action === "freeze") {
                              if (!canFreeze) return null;
                              const ready = r.clusterStatus === "flagged" && r.clusterVersion !== undefined;
                              return <button key={action} className="l-btn sm mc" disabled={!ready} title={ready ? "提交审批" : "需要先在「多账户风险排查」把这组账户标记为可疑"} onClick={() => linkFreeze(r)}>{ready ? "冻结关联账户" : "先去标记为可疑"}</button>;
                            }
                            return <span key={action} className="bdg warn" title="出现了无法识别的操作，已暂停">未知动作</span>;
                          })}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!current?.rows?.length && <tr><td colSpan={(current?.head?.length ?? 0) + (current?.key === "trial" ? 3 : 2)} style={{ textAlign: "center", color: "var(--ink-4)", padding: 24 }}>暂无命中记录</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 12 }}>
          <div className="ktint" style={{ fontSize: 12 }}><b>读法</b> · {current?.note ?? "命中结果由系统自动判断。"}</div>
        </div>
      </section>

      <PaginationExemptionList
        items={[{ label: "检测命中", maxRows: Math.max(current?.rows.length ?? 0, 1), reason: "按类型切换查看" }]}
      />
    </div>
  );
}
