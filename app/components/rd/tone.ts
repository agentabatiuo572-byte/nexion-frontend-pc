/**
 * 颜色语义的唯一入口（06 第一、二节）。组件只收 tone，不收色值。
 * - 状态色：这件事现在怎么样。一个数字先问状态，有状态就用它（VS-11）。
 * - 角色色：页内的不同角色。四个槽位固定含义，见 VS-12。不表达好坏。
 * - 域色：这是哪个业务域。只在侧栏、表头小图标这些位置出现，不进内容区（VS-15）。
 */
/** neutral 是列表里的默认状态（要处理列表里的待审核）：灰字加图标，颜色留给例外行（VS-21）。 */
export type StateTone = "ok" | "warn" | "danger" | "progress" | "done" | "neutral";
export type RoleTone = "role-1" | "role-2" | "role-3" | "role-4" | "role-other";
export type DomainTone = "money" | "users" | "devices" | "risk" | "system";
export type Tone = StateTone | RoleTone | DomainTone;
/**
 * 等级色阶：同一金色相由浅到深的几档，只表示「第几级」（商城任务等级 L1–L4、手机档位 T1–T5），不表示好坏，也不表示收益高低。
 * 四档用 level-1…level-4；五档用 level-1…level-5，外层要挂 data-levels="5" 才换成五档那套取值，LevelStrip、StepBar、ScaleBar 自己会挂。
 * 等级名和图里的数字仍是文字色，等级色只给小图形（格、柱、段）。不是 Tone：图标底、状态标签不收它。
 */
export type LevelTone = "level-1" | "level-2" | "level-3" | "level-4" | "level-5";
/** 第几个（从 0 数）取哪一档。 */
export const levelTone = (index: number) => `level-${Math.min(5, Math.max(1, index + 1))}` as LevelTone;

/** 侧栏的业务归属。今日概览、运营总览、内容、数据、平台基础归系统灰。 */
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
