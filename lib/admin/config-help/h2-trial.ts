/**
 * 免费试用设置的配置项说明（CP-87、CP-88，TX-36）。按参数键取，内容来自 PRD 和后端、App 代码，
 * 写不准的不写，列在重构说明的「待确认」里（DP-33）。后端多返回的键没有这里的说明时，页面用接口的名字和说明兜底。
 */

export interface TrialParamHelp {
  /** 页面上的名字，不写时用接口的名字。 */
  label?: string;
  /** 这是什么，不超过 25 字。 */
  what: string;
  /** 什么时候生效。 */
  when: string;
  /** 怎么填，放修改框。 */
  how?: string;
  /** 显示位置，只写核对过的。 */
  where?: string;
  /** 修改框的输入类型和范围，范围和后端一致。 */
  input?: { unit: string; min: number; max: number; step?: number };
  /** 改了会怎样，随输入变化。 */
  whatIf?: (value: string) => string;
}

const NEW_TRIAL = "立即生效，只影响新开始的试用";
const AT_PURCHASE = "立即生效，用户购买时按最新设置算";
const USD_RANGE = { unit: "USD", min: 0, max: 1_000_000 };

export const TRIAL_PARAM_HELP: Record<string, TrialParamHelp> = {
  trialProductId: {
    what: "用户免费试用的是哪台设备",
    when: NEW_TRIAL,
    how: "只能选「商品管理与上架条件」里开启了「允许试用」的在售实物商品；试用价格就是该商品的当前售价。",
    where: "App 首页「我的福利」的试用卡、领取弹窗「试用设备」",
  },
  trialDays: {
    what: "一次免费试用持续几天",
    when: NEW_TRIAL,
    how: "整数，1–90 天。",
    where: "App 领取弹窗「试用时长」",
    input: { unit: "天", min: 1, max: 90, step: 1 },
    whatIf: (value) => `改成 ${value}：之后开始的试用持续 ${value} 天，进行中的不变。`,
  },
  seatsLeftToday: {
    what: "每天最多多少人能开始试用",
    when: "立即生效，今天已领的算在内",
    how: "整数，0–1,000,000 张。这是上限，不是实际剩余；实际剩余看页面上方。",
    where: "App 首页「我的福利」的试用卡，名额用完就不显示",
    input: { unit: "张", min: 0, max: 1_000_000, step: 1 },
    whatIf: (value) => (value === "0" ? "改成 0：今天不再有人能开始试用，App 的试用卡不显示。" : `改成 ${value}：今天最多 ${value} 人开始试用，已领的算在内。`),
  },
  discountRate: {
    what: "试用转购买时，售价减掉的比例",
    when: AT_PURCHASE,
    how: "填百分比，0–100，15 就是减 15%。实际减的钱不超过「购买折扣上限」。",
    where: "App 结算页「试用折扣」这一行",
    input: { unit: "%", min: 0, max: 100 },
    whatIf: (value) => `改成 ${value}：用户购买时售价减 ${value}%，不超过购买折扣上限。`,
  },
  discountCapUSD: {
    label: "购买折扣上限",
    what: "购买折扣最多减多少钱",
    when: AT_PURCHASE,
    how: "0–1,000,000 USD。",
    where: "App 试用结束前 24 小时的提示「转购最高优惠」",
    input: USD_RANGE,
    whatIf: (value) => `改成 ${value}：购买折扣最多减 ${value} USD。`,
  },
  trialOffsetCapUSD: {
    what: "试用收益最多能抵多少购机款",
    when: "立即生效，按用户领取时的设置算",
    how: "0–1,000,000 USD。留空即不设上限；0 表示上限为 0。",
    where: "App 领取弹窗「最高」金额、我的 › 试用页规则",
    input: USD_RANGE,
    whatIf: (value) => (value.trim() === "" ? "留空：之后领取的试用不设抵扣上限。" : `改成 ${value}：之后领取的试用，试用收益最多抵 ${value} USD。`),
  },
  graceDays: {
    what: "试用到期后还能用抵扣金购买的天数",
    when: "立即生效，进行中的试用也按新天数算",
    how: "整数，0–30 天。",
    where: "App 我的 › 试用页「抵扣剩余时间」",
    input: { unit: "天", min: 0, max: 30, step: 1 },
    whatIf: (value) => `改成 ${value}：试用到期后 ${value} 天内还能用抵扣金购买。`,
  },
  extensionDays: {
    what: "用户接受延长时多给的天数",
    when: "立即生效，之后接受延长的用新天数",
    how: "整数，0–30 天。填 0 时系统按 1 天算。",
    input: { unit: "天", min: 0, max: 30, step: 1 },
    whatIf: (value) => `改成 ${value}：之后接受延长的试用多给 ${value === "0" ? "1" : value} 天。`,
  },
  highQualityThresholdUSD: {
    what: "试用收益达到这个数才能延长",
    when: "立即生效，用户申请延长时按最新设置判断",
    how: "0–1,000,000 USD。",
    where: "用户看不到，只影响能不能延长",
    input: USD_RANGE,
    whatIf: (value) => `改成 ${value}：宽限期内试用收益达到 ${value} USD 才能延长。`,
  },
  cooldownDays: {
    what: "取消试用后多少天内不能再试用",
    when: "立即生效，只影响之后新取消的试用",
    how: "整数，0–365 天。填 0 时系统按 1 天算。",
    where: "App 我的 › 试用页「再次领取的等待期尚未结束」",
    input: { unit: "天", min: 0, max: 365, step: 1 },
    whatIf: (value) => `改成 ${value}：之后取消的试用要等 ${value === "0" ? "1" : value} 天才能再领。`,
  },
  earlyPurchaseDiscountUSD: {
    what: "试用期内购买再减的固定金额",
    when: AT_PURCHASE,
    how: "0–100 USD，最多两位小数，填 0 表示关闭。在试用抵扣之外再减，不超过应付金额。",
    where: "App 我的 › 试用页「现在购买再减」",
    input: { unit: "USD", min: 0, max: 100, step: 0.01 },
    whatIf: (value) => (Number(value) === 0 ? "改成 0：关闭提前购买立减。" : `改成 ${value}：试用期内购买再减 ${value} USD。`),
  },
  shadowDailyUSD: {
    what: "商品没配日收益时，试用每天按这个算",
    when: NEW_TRIAL,
    how: "0–1,000,000 USD。商品配了日收益时用商品的，这项不起作用。",
    where: "App 领取弹窗「按每日」金额",
    input: USD_RANGE,
    whatIf: (value) => `改成 ${value}：商品没配日收益时，之后开始的试用每天按 ${value} USD 累积。`,
  },
  shadowDailyNEX: {
    what: "商品没配日收益时，试用每天的 UVT",
    when: NEW_TRIAL,
    how: "0–1,000,000 UVT。商品配了日收益时用商品的，这项不起作用。",
    input: { unit: "UVT", min: 0, max: 1_000_000 },
    whatIf: (value) => `改成 ${value}：商品没配日收益时，之后开始的试用每天按 ${value} UVT 累积。`,
  },
  autoPushEnabled: { what: "要不要自动弹出试用邀请", when: "立即生效" },
  autoPushDelayMs: {
    what: "满足条件后等多久弹出",
    when: "立即生效",
    how: "整数，0–86,400,000 毫秒，1500 就是 1.5 秒。",
    input: { unit: "毫秒", min: 0, max: 86_400_000, step: 1 },
  },
  autoPushCooldownHours: {
    what: "用户关掉弹窗后多久才再弹",
    when: "立即生效",
    how: "整数，0–86,400,000 小时。",
    input: { unit: "小时", min: 0, max: 86_400_000, step: 1 },
  },
  autoPushMaxPerSession: {
    what: "一次打开最多弹几次",
    when: "立即生效",
    how: "整数，0–86,400,000 次。",
    input: { unit: "次", min: 0, max: 86_400_000, step: 1 },
  },
  phaseOpen: { what: "这个运营阶段开不开放试用", when: "跟随「运营阶段设置」" },
  trialPriceUSD: { what: "试用设备的购买价", when: "跟随所选商品的售价" },
  chargeFailRate: { what: "系统内部参数，页面不显示真实值", when: "只由系统判定，这里不能修改" },
};

/** 常改参数，一屏约 6 项（DP-15）；其余可写的进高级设置。 */
export const COMMON_TRIAL_PARAMS = ["trialProductId", "trialDays", "seatsLeftToday", "discountRate", "discountCapUSD", "trialOffsetCapUSD"] as const;

/** 高级设置里的三组。接口多给的键放「其他」。 */
export const ADVANCED_TRIAL_GROUPS = [
  { title: "试用周期", keys: ["graceDays", "extensionDays", "highQualityThresholdUSD", "cooldownDays"] },
  { title: "收益与立减", keys: ["earlyPurchaseDiscountUSD", "shadowDailyUSD", "shadowDailyNEX"] },
  { title: "邀请弹窗", keys: ["autoPushEnabled", "autoPushDelayMs", "autoPushCooldownHours", "autoPushMaxPerSession"] },
] as const;

/** 试用记录七种状态的白话解释（DP-35）。 */
export const TRIAL_STATE_HELP: Record<string, string> = {
  idle: "用户还没开始这次试用。",
  active: "试用进行中，收益在累积，用户可以提前购买或取消。",
  grace: "试用期已到，设备停止产出；宽限期内用户还能用抵扣金购买。",
  extended: "试用收益达到高质量延长阈值，用户接受了延长。",
  cancelled: "已结束，没有转成购买。再次试用要等冷却期过去。",
  redeemed: "已结束，用户买下了设备。",
  failed: "已结束，扣款没有成功，要到操作记录核对原因。",
};
