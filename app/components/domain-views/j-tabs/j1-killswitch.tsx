"use client";

/**
 * J1 · Kill-Switch 矩阵 — 5 闸 status grid + 矩阵主表 + 应急快速通道 + B1 备付金前置核验 + 自动触发规则。
 * 闸集 = 前端 §9.11d.1 的 4 闸 + 后台应急新增 withdraw(5 闸,与 B5 雷达 / 首页单源;Premium/NEX v2 已下线)。
 * B1 数值全部从后端 coverage facade 单源派生;recoverGate = B1.redLine,不另立数值。
 */
import { useState } from "react";
import { CodeTag } from "../design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { JCtx } from "./types";
import { createJEmergencyCommandKey } from "@/lib/admin/j-client";
import type { AutoConfirmationRow, AutoRuleRow, EmergencySlaRow, JGate } from "@/lib/admin/j-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError } from "@/lib/admin/error-messages";

type Gate = JGate;
const IMPACT_LABEL: Record<string, string> = { immediate: "即时资金流出", delayed: "未来负债增加", none: "不直接影响兑付" };
const TRIGGER_BASES = ["", "监管点名", "挤兑风险", "安全事件", "其他"];
const TRIGGER_LABELS = { "": "请选择触发依据" };
const AUTO_CONFIRM_DECISIONS = ["", "keep_disabled", "recommend_restore"];
const AUTO_CONFIRM_DECISION_LABELS = {
  "": "请选择复核结论",
  keep_disabled: "维持关停",
  recommend_restore: "建议超管评估恢复",
};

export function J1KillSwitch({ ctx }: { ctx: JCtx }) {
  const { toast, openActionConfirm, actions, emergency, contentLoading } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = new Set(session?.authorities ?? []);
  const canKill = authorities.has("emergency_j1_gate_kill");
  const canResume = authorities.has("emergency_j1_gate_resume");
  const canBatchKill = authorities.has("emergency_j1_batch_kill");
  const canWrite = authorities.has("emergency_j1_write");
  const data = emergency.killSwitch;
  const gates = data?.activeGates ?? [];
  const EMER_SLA = data?.emergencySla ?? [];
  const AUTO_RULES = data?.autoRules ?? [];
  const AUTO_CONFIRMATIONS = data?.autoConfirmations ?? [];
  const coverage = data?.coverage;
  const COV = Number.isFinite(coverage?.coverageRatio) ? coverage!.coverageRatio : Number.NaN;
  const RED = Number.isFinite(coverage?.redlinePct) ? coverage!.redlinePct : Number.NaN;
  const YELLOW = Number.isFinite(coverage?.yellowLinePct) ? coverage!.yellowLinePct : Number.NaN;
  const coverageReady = Number.isFinite(COV) && Number.isFinite(RED) && Number.isFinite(YELLOW);
  const RANGE = coverageReady ? RED + 40 : 100;
  const pct = (v: number) => Number.isFinite(v) ? Math.min(100, Math.max(0, (v / RANGE) * 100)) : 0;
  const coverageText = (v: number) => Number.isFinite(v) ? `${v}%` : "缺数据";
  const coverageGapText = coverageReady
    ? `${COV >= RED ? "高于" : "低于"}红线 ${Math.abs(COV - RED).toFixed(0)} 个百分点`
    : "最新覆盖率暂不可用";
  // #28 批量关停选择集:运营勾选要熔断的闸(替代旧的固定「立即出钱」闸硬编码)。
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const toggleSel = (key: string) => setSel((s) => ({ ...s, [key]: !s[key] }));

  if (contentLoading && !data) {
    return <section className="matrix-card"><div className="matrix-h"><span className="ttl">J1 状态同步中</span><span className="sub">· 正在确认各业务闸的最新状态</span></div></section>;
  }
  if (!data) {
    return <section className="matrix-card"><div className="matrix-h"><span className="ttl">当前无法确认业务闸状态</span><span className="sub">· 为避免误操作，控制项已隐藏，请刷新后重试</span></div></section>;
  }

  const runBackend = async (task: Promise<void>, ok: string) => {
    try {
      await task;
    } catch (error) {
      toast(`操作未完成 · ${error instanceof Error ? displayAdminError(error) : "请稍后重试"}`);
      throw error;
    }
    try {
      await actions.reloadJEmergency();
      toast(ok);
    } catch {
      toast(`${ok}，但最新状态暂时无法读取，请刷新确认`);
    }
  };

  const effOn = (g: Gate): boolean => g.enabled;
  const effEmer = (g: Gate): boolean => g.emergency;
  const effChange = (g: Gate): string => g.lastChange;
  // R3 阈值由 J1 矩阵响应直接返回 J3 的权威配置值；J1 不再跨标签取数或持有默认副本。
  const effThr = (r: AutoRuleRow) => r.thr;
  const autoRuleDisplayName = (ruleId: string) => AUTO_RULES.find((rule) => rule.id === ruleId)?.nm ?? "未知自动规则";
  // recoverGate 跟随 B1 红线单源(LEDGER),J 域只读引用不持有;其余应急参数 store 可调。
  const effSla = (row: EmergencySlaRow) => row.v;

  const live = gates.filter(effOn).length;
  const killed = gates.length - live;
  const covPass = coverageReady && COV >= RED;
  const emergencyGateCount = data.stats.emergencyGateCount;
  const coverageBlockedCount = data.stats.coverageBlockedCount;
  const pendingAutoConfirmationKeys = new Set(AUTO_CONFIRMATIONS.map((row) => row.key));

  const killGate = (g: Gate) => {
    const commandKey = createJEmergencyCommandKey();
    openActionConfirm({
    action: `关停业务闸 · ${g.name}`,
    detail: (
      <><b>{g.name}</b>控制{g.cap}。确认后服务器立即拒绝对应业务请求，并记录操作人、理由、变更前后状态和时间。关停不会增加资金流出，不需要先检查备付金。</>
    ),
    businessForm: {
      kind: "multi-field",
      title: "关停依据与后续处置",
      fields: [
        { key: "triggerBasis", label: "触发依据", current: "", inputKind: "select", options: TRIGGER_BASES, optionLabels: TRIGGER_LABELS },
        ...(["staking", "genesis"].includes(g.key)
          ? [{ key: "dispositionPlan", label: "存量权益处置方案", current: "", inputKind: "text" as const, wide: true, placeholder: "说明在锁仓位、排放或存量权益如何处置" }]
          : []),
      ],
    },
    run: (reason, _newValue, businessValue) => {
      return runBackend(actions.toggleJ1KillSwitch(g.key, false, reason, {
        triggerBasis: businessValue?.triggerBasis,
        dispositionPlan: businessValue?.dispositionPlan,
      }, commandKey), `${g.name}已立即关停`);
    },
    });
  };

  const resumeGate = (g: Gate) => {
    const commandKey = createJEmergencyCommandKey();
    openActionConfirm({
    action: `恢复业务闸 · ${g.name}`,
    amplifies: g.amplifies,
    coverage: g.coveragePrecheckRequired && coverageReady
      ? { coverageRatio: COV, redlinePct: RED, healthyPct: YELLOW }
      : undefined,
    detail: (
      <><b>{g.name}</b>将从已关停恢复为在线，重新开放{g.cap}。{g.coveragePrecheckRequired
        ? <><b>恢复前检查备付金</b>：当前覆盖率 <b>{coverageText(COV)}</b>，恢复红线 <b>{coverageText(RED)}</b>；{covPass ? <>检查通过，{coverageGapText}</> : <>检查不通过，暂不能恢复</>}。</>
        : <>该业务不会直接增加资金流出，可在填写理由后立即恢复。</>}确认后由服务器立即执行并记录审计。</>
    ),
    run: (reason) => {
      return runBackend(actions.toggleJ1KillSwitch(g.key, true, reason, undefined, commandKey), `${g.name}已立即恢复`);
    },
    });
  };

  const launchBatch = () => {
    // #28:用运营勾选的在线闸作为批量关停目标(替代旧固定「立即出钱」闸);未选任何闸禁止确认。
    const targets = gates.filter((g) => sel[g.key] && effOn(g));
    if (!targets.length) { toast("请先在上方闸卡勾选要批量关停的在线功能闸(至少一个)"); return; }
    const commandKey = createJEmergencyCommandKey();
    openActionConfirm({
      action: "应急批量熔断 · 监管点名场景",
      detail: (
        <>一次性立即关停<b>已选 {targets.length} 闸</b>，用于监管点名、法务事件等重大场景。确认后服务器同步关停并逐闸记录应急审计。<b>已选业务闸：{targets.map((g) => g.name).join(" / ")}</b>。</>
      ),
      businessForm: {
        kind: "multi-field",
        title: "批量应急依据与处置",
        hint: "所有字段都会随本次操作写入审计记录。",
        fields: [
          { key: "triggerBasis", label: "触发依据", current: "", inputKind: "select", options: TRIGGER_BASES, optionLabels: TRIGGER_LABELS },
          { key: "regulatoryContext", label: "监管事由或文号", current: "", inputKind: "text", wide: true, placeholder: "例如监管通知编号、法务事件编号" },
          ...(targets.some((g) => ["staking", "genesis"].includes(g.key))
            ? [{ key: "dispositionPlan", label: "存量权益处置方案", current: "", inputKind: "text" as const, wide: true, placeholder: "说明在锁仓位、排放或存量权益如何处置" }]
            : []),
        ],
      },
      run: (reason, _newValue, businessValue) => {
        const keys = targets.map((g) => g.key);
        return runBackend(actions.emergencyDisableJ1(keys, reason, undefined, {
          triggerBasis: businessValue?.triggerBasis ?? "",
          regulatoryContext: businessValue?.regulatoryContext ?? "",
          dispositionPlan: businessValue?.dispositionPlan,
        }, commandKey), `已立即关停 ${targets.length} 个业务闸`)
          .then(() => setSel({}));
      },
    });
  };
  const selOnCount = gates.filter((g) => sel[g.key] && effOn(g)).length;

  const adjEmer = (row: EmergencySlaRow) => {
    const cur = effSla(row);
    const commandKey = createJEmergencyCommandKey();
    openActionConfirm({
      action: `应急参数调整 · ${row.k}`,
      detail: <><b>{row.k}</b> · {row.d}。自动关停即时生效，补录只补全审计信息，不会自动恢复业务闸。</>,
      edit: { kind: row.kind, current: cur, unit: row.unit, min: row.id === "autoConfirmMins" ? 10 : undefined, max: row.id === "autoConfirmMins" ? 120 : undefined, step: 1, disallowCurrent: true },
      run: (reason, newValue) => {
        return runBackend(actions.updateJ1Sla(row.id, newValue ?? cur, cur, reason, commandKey), `${row.k} 已调整`);
      },
    });
  };

  const adjRule = (r: AutoRuleRow) => {
    const cur = effThr(r);
    const commandKey = createJEmergencyCommandKey();
    openActionConfirm({
      action: `自动触发规则调整 · ${r.nm}`,
      detail: <><b>{r.nm}</b>当前阈值为 {cur} {r.unit}。保存后服务器定时读取真实业务指标；超过阈值时自动关停对应业务闸并写入审计记录。</>,
      edit: { kind: "number", current: cur, unit: r.unit, min: 1, max: 1_000_000_000, step: 1, disallowCurrent: true },
      run: (reason, newValue) => {
        return runBackend(actions.updateJ1AutoRule(r.id, newValue ?? cur, cur, reason, commandKey), `${r.nm} 已确认生效`);
      },
    });
  };

  const confirmAutoTrigger = (row: AutoConfirmationRow) => {
    const commandKey = createJEmergencyCommandKey();
    openActionConfirm({
    action: `补录自动关停结论 · ${row.name}`,
    detail: <><b>{row.name}</b>由 {autoRuleDisplayName(row.ruleId)} 自动关停，触发值 {row.signalValue}，阈值 {row.threshold}。本操作只补全处置结论，不会自动恢复业务；如建议恢复，仍需超管单独发起恢复并通过备付金检查。</>,
    businessForm: {
      kind: "multi-field",
      title: "自动关停复核",
      fields: [{
        key: "decision",
        label: "复核结论",
        current: "",
        inputKind: "select",
        options: AUTO_CONFIRM_DECISIONS,
        optionLabels: AUTO_CONFIRM_DECISION_LABELS,
      }],
    },
    run: (reason, _newValue, businessValue) => runBackend(
      actions.confirmJ1AutoTrigger(
        row.key,
        row.incidentId,
        businessValue?.decision as "keep_disabled" | "recommend_restore",
        reason,
        commandKey,
      ),
      `${row.name}自动关停结论已补录`,
    ),
    });
  };

  // 🔴 补录逾期升级(2026-08-06 主人裁决方案 C):自动关停即时止血,但「为什么关」必须有人签字。
  //   原型那套「响应时限 / 升级总时限 / 最大轮数」是为「先确认才执行」模型设计的 —— main 改成
  //   「先斩后补录」后闸早已关上,那三个参数没有对应的现实事件可计时,搬回来只会造出运营看不懂的旋钮。
  //   真正没被消灭的风险是另一半:**关停无人解释**,补录可以无限期拖着,事后审计查不到责任人。
  //   故只给补录加升级:逾期项置顶 + 页顶常驻红条(不可忽略),红条不随滚动消失、补完即自动消失。
  const overdueBackfills = AUTO_CONFIRMATIONS.filter((row) => row.overdue);
  const pendingBackfills = AUTO_CONFIRMATIONS.filter((row) => !row.overdue);
  const orderedBackfills = [...overdueBackfills, ...pendingBackfills];

  return (
    <div>
      {overdueBackfills.length > 0 && (
        <div
          className="dtint warn"
          role="alert"
          style={{ marginBottom: 12, borderLeft: "3px solid var(--danger)" }}
          data-proof="j1-backfill-overdue-banner"
        >
          <b>{overdueBackfills.length} 项自动关停结论已逾期未补录</b> ——
          闸已止血,但处置理由仍空缺;逾期事项不会自行消失,请值班人员立即补录,或上报值班主管接手。
          {overdueBackfills.slice(0, 3).map((row) => (
            <span key={row.incidentId} style={{ marginLeft: 8 }}>
              · {row.name}(截止 {row.dueAt.replace("T", " ").slice(0, 16)})
            </span>
          ))}
          {overdueBackfills.length > 3 && <span style={{ marginLeft: 8 }}>· 另有 {overdueBackfills.length - 3} 项</span>}
        </div>
      )}

      {/* stat strip */}
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">在线功能闸</div><div className="v">{live} / {gates.length}</div><div className="sub">{killed === 0 ? "全闸正常营业" : "部分业务已关停"}</div></div>
        <div className="f-stat warn"><div className="k">应急关停闸</div><div className="v">{emergencyGateCount}</div><div className="sub">自动或批量应急关停</div></div>
        <div className="f-stat danger"><div className="k">已关停闸</div><div className="v">{killed}</div><div className="sub">备付金已阻断恢复 {coverageBlockedCount} 次</div></div>
        <div className="f-stat cyan"><div className="k">备付金覆盖率</div><div className="v">{coverageText(COV)}</div><div className="sub">红线 {coverageText(RED)} · {coverageGapText}</div></div>
      </div>

      {/* 5 闸 status cards */}
      <div className="gates-strip">
        {gates.map((g) => { const on = effOn(g); return (
          <div key={g.key} className={"gate-card" + (on ? "" : " killed")}>
            <div className="top">
              {on && canBatchKill && <input type="checkbox" data-proof="j1-gate-select" checked={!!sel[g.key]} onChange={() => toggleSel(g.key)} aria-label={`勾选${g.name}纳入批量关停`} title={`勾选${g.name}纳入批量关停`} style={{ marginRight: 6, cursor: "pointer" }} />}
              <span className="key">{g.name}</span><span className="led" />
            </div>
            <div className="cap"><b>{g.cap}</b></div>
            <div className="ft">
              <span className={"impact " + g.coverageImpactCategory}><AutoGloss>{IMPACT_LABEL[g.coverageImpactCategory]}</AutoGloss></span>
              <span className="ts" title={effChange(g)}>{effChange(g).split(" · ")[0]}</span>
            </div>
          </div>
        ); })}
      </div>

      {/* 矩阵主表 */}
      <section className="matrix-card">
        <div className="matrix-h">
          <span className="ttl"><AutoGloss>{`功能开关总表 · ${gates.length} 个业务闸`}</AutoGloss></span>
          <span className="sub">· 状态以服务器为准</span>
          <div className="r"><CodeTag tone="electric">审计留痕</CodeTag><CodeTag>每次切换都记录</CodeTag></div>
        </div>
        <div className="matrix-tblwrap"><div className="matrix-tbl">
          <div className="hd">
            <div className="c">业务闸</div><div className="c">控制的能力</div><div className="c">状态</div><div className="c">资金影响</div>
            <div className="c"><AutoGloss>恢复需备付金</AutoGloss></div><div className="c">执行方式</div><div className="c">最近变更</div><div className="c">应急</div>
            <div className="c" style={{ justifyContent: "flex-end" }}>动作</div>
          </div>
          {gates.map((g) => { const on = effOn(g); return (
            <div className="rw" key={g.key}>
              <div className="c"><div style={{ fontWeight: 600, color: "var(--ink)" }}>{g.name}</div></div>
              <div className="c cap"><span className="nm">{g.cap}</span><span className="desc"><AutoGloss>{g.desc}</AutoGloss></span></div>
              <div className="c">{on ? <span className="badge-st live">在线</span> : <span className="badge-st killed">已关停</span>}</div>
              <div className="c"><span className={"badge-impact " + g.coverageImpactCategory}>{IMPACT_LABEL[g.coverageImpactCategory]}</span></div>
              <div className="c">{g.coveragePrecheckRequired ? <span className="badge-impact immediate"><AutoGloss>需核备付金</AutoGloss></span> : <span className="badge-impact none">不需</span>}</div>
              <div className="c"><span className="badge-proposal approved">确认后立即执行</span></div>
              <div className="c mono ink" title={effChange(g)}>{effChange(g)}</div>
              <div className="c">{effEmer(g) ? <span className="badge-emergency">应急</span> : <span className="mono" style={{ color: "var(--ink-4)" }}>—</span>}</div>
              <div className="c acts">
                {on ? (
                  canKill ? <button className="kill" title="立即关停" onClick={() => killGate(g)}>关停</button> : null
                ) : (
                  pendingAutoConfirmationKeys.has(g.key)
                    ? <span className="badge-emergency">待补录</span>
                    : canResume
                      ? g.coveragePrecheckRequired && !covPass
                        ? <button className="resume" disabled title="当前备付金覆盖率低于红线或缺少数据，暂不能恢复">恢复受阻</button>
                        : <button className="resume" title="立即恢复" onClick={() => resumeGate(g)}>恢复</button>
                      : null
                )}
              </div>
            </div>
          ); })}
        </div></div>
      </section>

      {/* 应急快速通道 + B1 备付金检查 */}
      <div className="j1-side">
        <section className="side-card">
          <div className="h">
            <span className="ic emer"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4.09 12.97A1 1 0 0 0 5 14h6l-1 8 8.91-10.97A1 1 0 0 0 18 10h-6l1-8z" /></svg></span>
            <div><div className="t">应急处置参数</div><div className="s"><AutoGloss>自动关停即时止血，值班人员限时补录处置理由；恢复门槛始终跟随备付金红线</AutoGloss></div></div>
            <span className="tag">应急规则</span>
          </div>
          {EMER_SLA.map((row) => (
            <div className="emer-row" key={row.id}>
              <div className="l"><div className="k"><AutoGloss>{row.k}</AutoGloss></div><div className="d"><AutoGloss>{row.d}</AutoGloss></div></div>
              <div className="v">{effSla(row)}<span className="u">{row.unit}</span></div>
              {row.id === "recoverGate"
                ? <span className="gate-ref" title="恢复门槛跟随备付金红线，如需调整请前往备付金页面">跟随备付金红线</span>
                : canWrite ? <button className="adj" title="调整参数" onClick={() => adjEmer(row)}>调整</button> : null}
            </div>
          ))}
          <div className="emer-launch">
            <div className="txt"><b>一键批量关停</b> · <AutoGloss>遇监管点名 / 法务事件时,在上方闸卡勾选多个业务一次性全部关停 · 全程留下高亮记录备查</AutoGloss> · <b data-proof="j1-batch-count">已选 {selOnCount} 闸</b></div>
            {canBatchKill && <button onClick={launchBatch} disabled={selOnCount === 0} style={selOnCount === 0 ? { opacity: 0.5, cursor: "not-allowed" } : undefined}>立即应急关停</button>}
          </div>
        </section>

        <section className="side-card">
          <div className="h">
            <span className="ic b1"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-7 4 14 3-7h4" /></svg></span>
            <div><div className="t"><AutoGloss>恢复业务前 · 备付金检查</AutoGloss></div><div className="s"><AutoGloss>恢复会增加资金流出或未来负债的业务（提现、兑换、Genesis、质押）前，先检查平台备付金</AutoGloss></div></div>
            <span className="tag">备付金</span>
          </div>
          <div className="b1cov-hero">
            <div className={"item " + (covPass ? "ok" : "warn")}>
              <div className="k">当前备付金覆盖率</div>
              <div className="v">{coverageText(COV)}</div>
              <div className="sub">{!coverageReady ? "最新覆盖率暂不可用" : COV >= YELLOW ? "能覆盖全部应付 · 还有富余" : covPass ? "高于红线 · 审慎区间" : "低于红线 · 禁止恢复"}</div>
            </div>
            <div className="item warn">
              <div className="k">恢复门槛(红线)</div>
              <div className="v">{coverageText(RED)}</div>
              <div className="sub">低于此线不允许恢复</div>
            </div>
          </div>
          <div className="b1cov-bar" style={{ background: `linear-gradient(90deg, color-mix(in srgb, var(--danger) 50%, transparent) 0%, color-mix(in srgb, var(--danger) 50%, transparent) ${pct(RED)}%, color-mix(in srgb, var(--warning) 50%, transparent) ${pct(RED)}%, color-mix(in srgb, var(--warning) 50%, transparent) ${pct(YELLOW)}%, color-mix(in srgb, var(--success) 50%, transparent) ${pct(YELLOW)}%, color-mix(in srgb, var(--success) 50%, transparent) 100%)` }}>
            <div className="bnd" style={{ left: `${pct(RED)}%` }} />
            <div className="bnd" style={{ left: `${pct(YELLOW)}%` }} />
            <div className="needle" style={{ left: `${pct(COV)}%` }}><span className="nlb">当前 {coverageText(COV)}</span></div>
          </div>
          <div className="b1cov-legend">
            <span className="it"><span className="d red" />危险 &lt;{coverageText(RED)}</span>
            <span className="it"><span className="d yellow" />审慎 {coverageText(RED)}–{coverageText(YELLOW)}</span>
            <span className="it"><span className="d green" />健康 ≥{coverageText(YELLOW)}</span>
            <span className="it" style={{ marginLeft: "auto", color: covPass ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>当前 {coverageText(COV)} · {covPass ? "通过" : "不通过"}</span>
          </div>
          <div className="b1cov-detail">
            <span className="ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg></span>
            <div><b>{covPass ? "需要备付金检查的业务可以恢复" : "低于红线或缺少覆盖率，相关业务禁止恢复"}</b> · <AutoGloss>{coverageReady ? `备付金覆盖率 ${COV}%，${covPass ? `高于 ${RED}% 红线，还有 ${(COV - RED).toFixed(0)} 个百分点的缓冲` : `低于 ${RED}% 红线`}。恢复提现、兑换、Genesis 或质押时，系统都会记录当时的备付金水位。` : "最新备付金覆盖率暂不可用，系统不会使用默认值放行恢复操作。"}</AutoGloss></div>
          </div>
        </section>
      </div>

      <section className="side-card" style={{ marginBottom: 14 }}>
          <div className="h">
            <div><div className="t">自动关停待补录</div><div className="s">复核触发信号并补全处置结论；补录不会自行恢复业务</div></div>
            <span className={overdueBackfills.length > 0 ? "badge-emergency" : "tag"}>
              {overdueBackfills.length > 0 ? `${overdueBackfills.length} 项逾期 / 共 ${AUTO_CONFIRMATIONS.length} 项` : `${AUTO_CONFIRMATIONS.length} 项待处理`}
            </span>
          </div>
          {AUTO_CONFIRMATIONS.length === 0
            ? <div className="emer-row"><div className="l"><div className="k">当前没有待补录事项</div><div className="d">自动关停事件完成补录后会从这里移除。</div></div><span className="gate-ref">无需处理</span></div>
            : orderedBackfills.map((row) => (
            <div className="emer-row" key={row.incidentId}>
              <div className="l">
                <div className="k">{row.name} · {autoRuleDisplayName(row.ruleId)}</div>
                <div className="d">触发值 {row.signalValue} / 阈值 {row.threshold} · 截止 {row.dueAt.replace("T", " ").slice(0, 16)}</div>
              </div>
              <span className={row.overdue ? "badge-emergency" : "gate-ref"}>{row.overdue ? "已逾期" : "待补录"}</span>
              {canKill ? <button className="adj" onClick={() => confirmAutoTrigger(row)}>补录结论</button> : null}
            </div>
            ))}
        </section>

      {/* 自动触发规则 */}
      <section className="rules-card">
        <div className="rules-h">
          <span className="ttl"><AutoGloss>应急判定与自动关停规则</AutoGloss></span>
          <span className="sub">· R1、R2 由服务器读取真实指标自动关停；R3 仅告警；R4 人工发起</span>
          <div className="r"><CodeTag tone="electric">审计留痕</CodeTag></div>
        </div>
        <div className="rules-grid">
          {AUTO_RULES.map((r) => (
            <div className="rule" key={r.id}>
              <div className="top">
                <span className="ic">
                  {r.icon === "surge" && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>}
                  {r.icon === "gap" && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6l3 12 6-3 6 3 3-12" /><path d="M12 2v4" /></svg>}
                  {r.icon === "shield" && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>}
                  {r.icon === "clock" && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>}
                </span>
                <div className="t"><div className="nm">{r.nm}</div><div className="key">{r.tag}</div></div>
              </div>
              <div className="cond">{r.cond.map((part, i) => {
                if (!part) return null;
                const text = r.id === "tamperCluster" && i === 1 ? `${effThr(r)} ${r.unit}` : part;
                return i % 2 ? <b key={i}>{text}</b> : <AutoGloss key={i}>{text}</AutoGloss>;
              })}</div>
              <div className="row">
                <span className="key">{r.thrK}</span><span className="val">{effThr(r)}</span>
                {r.adjustable && canWrite
                  ? <button title="调整阈值" onClick={() => adjRule(r)}>调整</button>
                  : r.refNote
                    ? <span className="gate-ref" title={r.refTitle}>{r.refNote}</span>
                    : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <p className="f-foot"><b>关停后立即全站生效，客户端无法绕过</b>：<AutoGloss>开关状态以服务器为准。关停或恢复必须填写理由，服务器执行后立即写入审计。恢复提现、兑换、Genesis 或质押前，还会检查备付金是否高于红线。</AutoGloss></p>
    </div>
  );
}
