/**
 * F2 网络版税深度门枚举。
 *
 * `F.unilevel.depthGate` 是**离散层号**(后端 `UnilevelCommissionService.resolveDepthGateLayer`
 * 与 `CommissionGuideRuleService.DEPTH_GATE_LAYER` 都只接受 `L1`–`L7`),`F.unilevel.depthGateRank`
 * 是**离散阶位**(`V0`–`V12`)。历史库存在 `0.4` 这类小数遗留值:它既不是层也不是阶位,
 * 结算侧 `resolveDepthGateLayer` 会显式阻断(非法值不得进入生效态),但管理读面仍会把它原样
 * 暴露出来供运营修正(`OpsTeamServiceTest.ratesExposeInvalidLegacyDecimalDepthGateForOperatorCorrection`)。
 * 因此管理页必须:合法值按 `L1–L7` / `V0–V12` 展示,非法值明确告警,且编辑器只允许提交合法枚举,
 * 让非法值无法被「保存成另一个非法值」而绕过结算侧校验。
 */

export const F2_DEPTH_GATE_LAYERS = ["L1", "L2", "L3", "L4", "L5", "L6", "L7"] as const;
export const F2_DEPTH_GATE_RANKS = [
  "V0", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10", "V11", "V12",
] as const;

export interface F2EnumGateValue {
  /** 后端返回的原始值(用于告警与审计回显)。 */
  raw: string;
  /** 合法时的规范化枚举值(L4 / V2);非法时为 null。 */
  normalized: string | null;
  legal: boolean;
}

function parseEnumGateValue(raw: string | null | undefined, options: readonly string[]): F2EnumGateValue {
  const trimmed = (raw ?? "").trim();
  const normalized = trimmed.toUpperCase();
  return options.includes(normalized)
    ? { raw: trimmed, normalized, legal: true }
    : { raw: trimmed, normalized: null, legal: false };
}

export const parseF2DepthGateLayer = (raw: string | null | undefined): F2EnumGateValue =>
  parseEnumGateValue(raw, F2_DEPTH_GATE_LAYERS);

export const parseF2DepthGateRank = (raw: string | null | undefined): F2EnumGateValue =>
  parseEnumGateValue(raw, F2_DEPTH_GATE_RANKS);

export interface F2EnumGateSpec {
  options: string[];
  unit: string;
  /** 非法值告警:说明该值为何不能生效、正确取值域是什么。 */
  illegalCopy: string;
}

/**
 * 深度门两个键的编辑器规格。命中才返回 —— 其余 F2 参数仍走原来的自由值编辑,不新增第二套写法。
 * 返回非 null 表示该键是枚举门:编辑器必须是离散 select,不能是 text/number。
 */
export function f2EnumGateSpec(key: string): F2EnumGateSpec | null {
  if (key === "F.unilevel.depthGate") {
    return {
      options: [...F2_DEPTH_GATE_LAYERS],
      unit: "层",
      illegalCopy: "当前值不是 L1–L7 中的层号。层级是离散整数,结算侧会阻断非法值;请选择合法层后提交。",
    };
  }
  if (key === "F.unilevel.depthGateRank") {
    return {
      options: [...F2_DEPTH_GATE_RANKS],
      unit: "阶位",
      illegalCopy: "当前值不是 V0–V12 中的阶位。阶位是离散枚举,结算侧会阻断非法值;请选择合法阶位后提交。",
    };
  }
  return null;
}
