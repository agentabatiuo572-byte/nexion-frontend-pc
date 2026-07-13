/**
 * Janus C2 控制台(K6)— 手动状态流转矩阵(PRD §9.3 允许 / §9.4 禁止 / §15 权限)。
 * 矩阵只列「允许」流转;未列即禁止(§9.4 列举的高危禁止由此自然覆盖 + 注释标注)。
 * 每条流转带:目标态、最低角色、是否单人强确认、是否需远程地址、是否需过期时间、是否高风险、规则说明。
 * backend-replaceable:真后台据此做服务端校验,前端只是预呈现。
 */
import type { DeviceStatus, Role } from "./types";

export const ROLE_ORDER: Record<Role, number> = { viewer: 0, operator: 1, senior_operator: 2, admin: 3 };

export interface Transition {
  to: DeviceStatus;
  /** 最低执行角色。 */
  role: Role;
  /** 单人强确认(高风险动作,PRD §9.1.3 / §15)。 */
  strong?: boolean;
  /** 下发 / 激活类:必须选远程地址(PRD §9.2 remoteUrlKey)。 */
  needsRemoteUrl?: boolean;
  /** 挂起类:必须设过期时间(PRD §9.2 expireAt)。 */
  needsExpire?: boolean;
  /** 高风险(PRD §15 高风险动作清单)。约定:highRisk 必同时 strong。 */
  highRisk?: boolean;
  /** 不允许批量(PRD §9.3 BLOCKED→MANUAL_FORCED / §9.4 ENV_FILTERED 批量直转禁令)。 */
  noBatch?: boolean;
  /** 规则说明(运营可读,展示在弹窗操作简述)。 */
  note: string;
}

/** §9.3 允许切换矩阵。 */
export const TRANSITIONS: Record<DeviceStatus, Transition[]> = {
  NEW: [
    { to: "OBSERVING", role: "operator", note: "人工确认设备进入观察。" },
    { to: "ENV_FILTERED", role: "operator", note: "需选择环境过滤原因。" },
    { to: "MANUAL_HOLD", role: "operator", needsExpire: true, note: "挂起须设置过期时间,到期回到策略评估。" },
    { to: "MANUAL_FORCED", role: "senior_operator", strong: true, needsRemoteUrl: true, highRisk: true, note: "绕过策略强制下发,需单人强确认并填远程地址。" },
  ],
  OBSERVING: [
    { to: "RECOMMENDED", role: "operator", note: "仅产生建议,不直接下发。" },
    { to: "ENV_FILTERED", role: "operator", note: "需选择过滤原因。" },
    { to: "MANUAL_FORCED", role: "senior_operator", strong: true, needsRemoteUrl: true, highRisk: true, note: "强制下发,需单人强确认。" },
    { to: "BLOCKED", role: "senior_operator", note: "禁止下发,须填写禁止原因。" },
  ],
  RECOMMENDED: [
    { to: "MANUAL_FORCED", role: "operator", needsRemoteUrl: true, note: "常规确认下发动作。" },
    { to: "HIT", role: "operator", note: "接受策略命中,按策略时机生效。" },
    { to: "ENV_FILTERED", role: "operator", note: "需说明为何推翻建议。" },
    { to: "MANUAL_HOLD", role: "operator", needsExpire: true, note: "挂起等待更多数据。" },
    { to: "BLOCKED", role: "senior_operator", note: "需高风险原因。" },
  ],
  HIT: [
    { to: "ACTIVATED", role: "operator", needsRemoteUrl: true, note: "必须有远程地址方可激活。" },
    { to: "ENV_FILTERED", role: "operator", note: "尚未激活可直接改;已下发需走回退。" },
    { to: "MANUAL_HOLD", role: "operator", needsExpire: true, note: "暂停后续激活。" },
    { to: "RESET", role: "senior_operator", note: "清除命中结果并重新评估。" },
  ],
  ACTIVATED: [
    { to: "RESET", role: "senior_operator", strong: true, highRisk: true, note: "清除激活标记,需单人强确认。" },
    { to: "ENV_FILTERED", role: "admin", strong: true, highRisk: true, note: "须先重置再标记过滤,保留原因。" },
    { to: "BLOCKED", role: "admin", strong: true, highRisk: true, note: "需高风险确认与完整备注。" },
  ],
  ENV_FILTERED: [
    { to: "OBSERVING", role: "operator", note: "复核后解除过滤。" },
    { to: "RECOMMENDED", role: "senior_operator", note: "只建议,不直接下发。" },
    { to: "MANUAL_FORCED", role: "senior_operator", strong: true, needsRemoteUrl: true, highRisk: true, noBatch: true, note: "覆盖环境过滤强制下发,需单人强确认并记录,不允许批量。" },
    { to: "BLOCKED", role: "operator", note: "环境风险升级为禁止。" },
  ],
  MANUAL_HOLD: [
    { to: "OBSERVING", role: "operator", note: "释放挂起并重新评估。" },
    { to: "RECOMMENDED", role: "operator", note: "释放后进入建议。" },
    { to: "MANUAL_FORCED", role: "senior_operator", strong: true, needsRemoteUrl: true, highRisk: true, note: "强制下发,需单人强确认。" },
  ],
  MANUAL_FORCED: [
    { to: "RESET", role: "senior_operator", strong: true, highRisk: true, note: "清除手动下发标记,回到策略评估,需单人强确认。" },
    { to: "BLOCKED", role: "senior_operator", note: "升级为禁止下发。" },
  ],
  BLOCKED: [
    { to: "OBSERVING", role: "admin", note: "解除禁止,需原因。" },
    { to: "MANUAL_FORCED", role: "admin", strong: true, needsRemoteUrl: true, highRisk: true, noBatch: true, note: "需 Admin 单人强确认,不允许批量。" },
  ],
  STALE: [
    // STALE→OBSERVING 为系统自动(收到新鲜上报后恢复),不在人工矩阵;人工仅高级运营强制下发。
    { to: "MANUAL_FORCED", role: "senior_operator", strong: true, needsRemoteUrl: true, highRisk: true, note: "设备未新鲜上报,强制下发需单人强确认。" },
  ],
  RESET: [
    { to: "OBSERVING", role: "operator", note: "回到策略评估。" },
  ],
  ERROR: [
    { to: "OBSERVING", role: "admin", note: "修复异常后恢复观察。" },
  ],
};

/** §9.4 禁止切换(显式高危禁止,展示用;矩阵未列即默认禁止)。 */
export const FORBIDDEN_NOTES: string[] = [
  "禁止下发(BLOCKED)不得被普通自动策略改为已命中。",
  "人工挂起未过期前不得被自动策略改为已激活。",
  "已激活不得直接改为新设备(会丢历史,违反审计)。",
  "环境过滤不得无差别批量直接改为手动下发。",
  "状态异常不得自动改为已激活,须先修复。",
];

/** 当前角色对某状态的可执行流转(按权限过滤)。 */
export function allowedTransitions(from: DeviceStatus, role: Role): Transition[] {
  return TRANSITIONS[from].filter((t) => ROLE_ORDER[role] >= ROLE_ORDER[t.role]);
}

/** 某状态下被权限挡住的流转(展示「需更高权限」用)。 */
export function gatedTransitions(from: DeviceStatus, role: Role): Transition[] {
  return TRANSITIONS[from].filter((t) => ROLE_ORDER[role] < ROLE_ORDER[t.role]);
}
