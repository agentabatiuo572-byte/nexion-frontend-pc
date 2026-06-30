/**
 * Janus C2 控制台(K6)— 策略健康度分级(PRD §12)。
 * 从有效设备 + 生效策略 + 审计派生多维健康指标,分级 HEALTHY/WARNING/RISK/CRITICAL,
 * 给异常下钻原因(§12.3)+ 建议处理动作(§12.4)。纯函数,backend-replaceable(真后台同口径)。
 * 覆盖 §12 的 10 个指标;「干跑偏差」(预估命中 vs 真实命中)需历史干跑快照对比,mock 单快照无基线,本轮裁剪待 SPEC 后续补。
 */
import { summarize } from "./scoring";
import { decisionTrace } from "./evaluate";
import type { AuditLog, Device, HealthIndicator, HealthLevel, HealthReport, Strategy } from "./types";

const LEVEL_ORDER: Record<HealthLevel, number> = { HEALTHY: 0, WARNING: 1, RISK: 2, CRITICAL: 3 };

/** 越低越健康(过滤率 / 人工率 / 冲突…):≥crit→CRITICAL,依次降级。 */
function gradeLow(v: number, warn: number, risk: number, crit: number): HealthLevel {
  return v >= crit ? "CRITICAL" : v >= risk ? "RISK" : v >= warn ? "WARNING" : "HEALTHY";
}
/** 越高越健康(命中率 / 覆盖率…):≤crit→CRITICAL,依次降级。 */
function gradeHigh(v: number, warn: number, risk: number, crit: number): HealthLevel {
  return v <= crit ? "CRITICAL" : v <= risk ? "RISK" : v <= warn ? "WARNING" : "HEALTHY";
}

const pct = (n: number, total: number): number => (total ? Math.round((n / total) * 100) : 0);

export function computeHealth(devices: Device[], strategies: Strategy[], audit: AuditLog[]): HealthReport {
  const total = devices.length || 1;
  const sum = summarize(devices);
  const active = strategies.filter((s) => s.status === "active");

  // 派生计数
  const covered = devices.filter((d) => decisionTrace(d, active) !== undefined).length;
  const stale = devices.filter((d) => d.status === "STALE").length;
  const blocked = devices.filter((d) => d.status === "BLOCKED").length;
  const conflicts = devices.filter((d) => (decisionTrace(d, active)?.conflicts?.length ?? 0) > 0).length;
  const strategyChanges = audit.filter((a) => a.targetType === "strategy").length;
  const rollbacks = audit.filter((a) => a.action.includes("回滚")).length;

  const coverageRate = pct(covered, total);
  const filterRate = pct(sum.envFiltered, total);
  const manualRate = pct(sum.manualOverrides, total);
  const staleRate = pct(stale, total);
  const activationRate = pct(sum.activated, total);
  const recommendRate = pct(sum.recommended, total);
  const rollbackRate = strategyChanges ? pct(rollbacks, strategyChanges) : 0;

  const ind = (key: string, label: string, value: string, level: HealthLevel, note: string): HealthIndicator => ({ key, label, value, level, note });

  const indicators: HealthIndicator[] = [
    ind("coverage", "策略覆盖率", `${coverageRate}%`, gradeHigh(coverageRate, 60, 40, 20),
      coverageRate < 60 ? "较多设备未被任何生效策略覆盖,确认是否需新建或放量策略。" : "多数设备已被生效策略覆盖。"),
    ind("hitRate", "命中率", `${sum.hitRate}%`, gradeHigh(sum.hitRate, 35, 20, 8),
      sum.hitRate < 35 ? "命中转化偏低,检查规则是否过严或成熟度门槛过高。" : "命中转化处于健康区间。"),
    ind("activation", "激活率", `${activationRate}%`, gradeHigh(activationRate, 25, 12, 4),
      activationRate < 25 ? "激活占比偏低,关注建议下发后是否顺利接管。" : "激活占比正常。"),
    ind("recommend", "建议率", `${recommendRate}%`, gradeLow(recommendRate, 50, 70, 90),
      recommendRate >= 50 ? "建议下发占比偏高,关注待确认队列是否积压。" : "建议下发占比正常。"),
    ind("filter", "环境过滤率", `${filterRate}%`, gradeLow(filterRate, 30, 45, 60),
      filterRate >= 30 ? "环境过滤占比偏高,警惕误伤真实设备,核对指纹/风险阈值。" : "环境过滤占比正常。"),
    ind("manual", "人工干预率", `${manualRate}%`, gradeLow(manualRate, 15, 30, 45),
      manualRate >= 15 ? "人工覆盖较多,说明自动策略与运营预期偏离,建议复盘策略规则。" : "人工干预较少,自动策略稳定。"),
    ind("conflict", "策略冲突", `${conflicts} 台`, gradeLow(conflicts, 1, 4, 8),
      conflicts > 0 ? "存在设备同时命中多条生效策略,核对优先级与适用范围避免互相覆盖。" : "无策略冲突。"),
    ind("rollback", "回滚率", `${rollbackRate}%`, gradeLow(rollbackRate, 15, 30, 50),
      rollbackRate >= 15 ? "策略回滚频繁,发布前加强干跑预估与灰度放量。" : "策略发布稳定,回滚较少。"),
    ind("stale", "过期会话占比", `${staleRate}%`, gradeLow(staleRate, 12, 25, 40),
      staleRate >= 12 ? "过期会话偏多,及时清理或重新评估长期未上报设备。" : "过期会话占比正常。"),
    ind("blocked", "阻断命中", `${blocked} 台`, gradeLow(blocked, 3, 7, 14),
      blocked >= 3 ? "被禁止设备较多,确认是否风控误判或存在批量作弊。" : "阻断命中较少。"),
  ];

  const level = indicators.reduce<HealthLevel>((acc, i) => (LEVEL_ORDER[i.level] > LEVEL_ORDER[acc] ? i.level : acc), "HEALTHY");
  const abnormal = indicators.filter((i) => i.level !== "HEALTHY").sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level]);
  const reasons = abnormal.map((i) => `${i.label}(${i.value}):${i.note}`);

  const suggestions: string[] = [];
  if (abnormal.some((i) => i.key === "filter")) suggestions.push("下调环境过滤强度或复核指纹黑名单,优先恢复疑似误伤设备。");
  if (abnormal.some((i) => i.key === "manual")) suggestions.push("复盘高频人工覆盖原因,把稳定的人工判断沉淀为策略规则。");
  if (abnormal.some((i) => i.key === "conflict")) suggestions.push("调整冲突策略的优先级或适用范围,确保单设备命中唯一主策略。");
  if (abnormal.some((i) => i.key === "rollback")) suggestions.push("发布前必跑干跑预估,先小比例灰度再全量放量。");
  if (abnormal.some((i) => i.key === "coverage" || i.key === "hitRate" || i.key === "activation")) suggestions.push("检查规则门槛是否过严,适度放宽成熟度/环境条件提升覆盖与转化。");
  if (!suggestions.length) suggestions.push("各项指标正常,保持当前策略,持续观察设备成熟度信号。");

  return { level, indicators, reasons, suggestions };
}
