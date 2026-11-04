/**
 * 颜色语义的唯一入口（06 第一、二节）。组件只收 tone，不收色值。
 * - 状态色：这件事现在怎么样。一个数字先问状态，有状态就用它（VS-11）。
 * - 角色色：页内的不同角色。四个槽位固定含义，见 VS-12。不表达好坏。
 * - 域色：这是哪个业务域。只在侧栏、表头小图标这些位置出现，不进内容区（VS-15）。
 */
export type StateTone = "ok" | "warn" | "danger" | "progress" | "done";
export type RoleTone = "role-1" | "role-2" | "role-3" | "role-4" | "role-other";
export type DomainTone = "money" | "users" | "devices" | "risk" | "system";
export type Tone = StateTone | RoleTone | DomainTone;

/** 侧栏的业务归属。指挥台、运营总览、内容、数据、平台基础归系统灰。 */
export const DOMAIN_TONE: Record<string, DomainTone> = {
  A: "system",
  B: "system",
  C: "users",
  D: "money",
  E: "devices",
  F: "users",
  G: "money",
  H: "users",
  I: "system",
  J: "risk",
  K: "risk",
  L: "system",
  M: "users",
};
