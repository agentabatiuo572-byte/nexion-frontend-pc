import type { A2OperationRow, A2RoleGrantsReview } from "./a2-client";
import { isFirstA2DisclosurePublish } from "./disclosure-publication-diagnostic";
import { nexGridBrandText } from "./brand-copy";
import { k1EarningSourceName } from "./k1-earning-sources";
import { parseK1ReleaseTicketBefore } from "./k1-release-ticket";
import { operatorDeviceStatus } from "./e-operator-display";
import { skuSeriesText } from "./device-monthly-target";
import { isSkuTaglineTranslations, SKU_TAGLINE_LABELS, skuBadgeReviewText, type SkuTaglineTranslations } from "./e1-product-copy";
import { AUDIT_ACTION_NAMES as A2_ACTION_NAMES, K1_APPROVAL_PARAM_NAMES, k1ApprovalSummaryText } from "./audit-action-names";
import { TASK_ACTION_ROUTE_LABELS, TASK_CATEGORY_LABELS, legacyAssetText } from "./config-help/h3-task";
import { a2ActionText, a2ObjectText, DIV_BASE_FORMULA, DIV_BASE_TEXT } from "./operator-copy";
import { ambassadorBucketLabel, ambassadorMaterialStateLabel } from "./f4-ambassador-display";
import { F5_KIND_LABELS } from "./f-overview-contract";
import { F1_VOUCHER_REISSUE, F1_VOUCHER_REISSUE_UNAVAILABLE, F1_VOUCHER_REVERSE_CLAWBACK, F1_VOUCHER_REVERSE_KEEP } from "./config-help/f1-voucher";
import { f4Decimal, f4MonthlyCap } from "./f4-money";
import { fConfigSpec, fConfigValue, type FConfigSpec } from "./a2-f-config";
import { D5_APPROVAL_OP } from "./trc20-closed";
import { withdrawalProposalChanges, type WithdrawalProposalChanges } from "./withdrawal-proposal-changes";
import { f2BootstrapUsesRank, f2PctSum, parseF2BootstrapAfter } from "./f2-bootstrap-summary";
import { e1GateText, e1Value } from "./e1-product-review";
import { ORDER_STATES, stateLabel } from "./e4-order-display";
import { containsHan } from "./content-language-rules";
import { findHighOp } from "./high-ops-registry";
import { h3WeeklyZoneLabel } from "./h3-weekly-zone-labels";
import { normalizeSessionRole } from "./session-role";
import { TASK_CLASS_LABELS } from "./task-classes";
import { D5_MENU_NAME, D6_MENU_NAME, D7_MENU_NAME, roleLabel } from "@/lib/nav/console-nav-labels";
import { amountDisplay } from "@/lib/format";

const SEE_APPROVAL_DETAIL = "请在审批详情核对";
const ACCOUNT_STATUS: Record<string, string> = { enabled: "启用", disabled: "停用" };
export const a2AccountStatusText = (value: string) => Object.hasOwn(ACCOUNT_STATUS, value) ? ACCOUNT_STATUS[value] : undefined;
function a1ApprovalStatusText(value: string) {
  const text = value.trim().toLowerCase();
  if (text === "已启用" || text === "已停用") return text;
  const status = a2AccountStatusText(text) ?? (text === "启用" || text === "停用" ? text : undefined);
  return status ? `已${status}` : undefined;
}

/**
 * Backend 111e00cd returns the persisted command op for tickets and history.
 * Retain action-name fallbacks for old records without a command (and E4 refunds without an order number).
 */
const REVIEW_OPERATION_BY_ACTION: Record<string, string> = {
  提高旧活动奖励: "h4_legacy_event_reward_update", 新增转盘奖项: "h4_wheel_tier_create", 放宽转盘奖项配置: "h4_wheel_tier_update",
  删除转盘奖项并提高安慰奖: "h4_wheel_tier_delete", 提高转盘奖项概率: "h4_wheel_probabilities_update",
  首次发布奖励课程: "i7_course_first_publish", 发布奖励课程版本: "i7_course_version_publish", 回滚至有奖励的课程版本: "i7_course_version_rollback",
};

/** J1 恢复单后端存的对象是开关代号（「恢复业务开关 · withdraw」）；显示成紧急停用开关页卡片上的名字（OpsKillSwitchService 的 GATE_SEEDS）。 */
const J1_GATE_NAMES: Record<string, string> = { withdraw: "提现开关", staking: "质押开关", genesis: "创世节点开关", exchange: "兑换开关", trial: "试用开关" };
export const j1GateName = (key: string) => J1_GATE_NAMES[key] ?? key;

/** F1 写入的动作后缀区分晋升和降级（可以选「降级」和 V8），只有晋升才免覆盖率、按发起权限撤回。 */
export function isV8PromotionAction(operationCode: string | null | undefined, action: string) {
  return operationCode === "f_vrank_override" && action.endsWith(" · 晋升至 V8");
}

export function isV8PromotionTicket(w: A2OperationRow) {
  return isV8PromotionAction(w.operationCode, w.action) && w.after.trim() === "V8";
}

/** G3 价格计划单：后端写死的对象和动作名（G3MarketApproval 的描述）。 */
export function isG3Policy(w: Pick<A2OperationRow, "action" | "obj">) {
  return w.obj === "weekly" && /^提高周价格计划·D[1-7]·(?:目标价（USDT\/UVT）|上涨概率)$/.test(w.action)
    || w.obj === "currentPrice" && w.action === "提高当前UVT价格"
    || w.obj === "schedule" && w.action === "首次配置UVT自动推进";
}

export function g3PolicyExecutionTiming(w: A2OperationRow, includeHistoricalReminder = false) {
  // G3MarketApproval binds weekly/schedule to planned price changes and currentPrice to immediate publication.
  if (w.obj !== "weekly" && w.obj !== "schedule") return undefined;
  if (w.operationCode ? w.operationCode !== "g3_market_policy_change" : !isG3Policy(w)) return undefined;
  const review = parseReview(w.after);
  const timing = review?.kind === "object" ? review.value["生效时间"] : undefined;
  if (typeof timing === "string" && timing.trim()) return timing;
  if (includeHistoricalReminder) return "批准后按完整变更内容注明的时点生效，请先核对";
}

/**
 * F4 派奖、F4 本周结算、F5 奖励状态变更：后端存的对象是榜单代号和配置键（「排行榜 allTime」「F.commission.CM-1040.status」）、
 * 状态是英文代码。批准人看到的写运营的话；单号 CM-… 是运营要对照的，照原样等宽写在后面。
 */
const F4_PERIOD_NAME: Record<string, string> = { allTime: "总榜", week: "周榜", month: "月榜", today: "日榜" };
/** 和「奖励记录核对」页的状态叫法一致（f5-shared STATUS_META）。 */
export const F5_STATE_NAME: Record<string, string> = { cooling: "冷却中", unlocked: "已解锁", frozen: "已冻结", rejected: "已拒绝", settled: "已结算", paid: "已提现", reversed: "已冲正" };
/** 改成这个状态之前只能是哪一种（OpsTeamService 状态转换表）；能从几种状态改过来的不写。 */
export const F5_STATE_FROM: Record<string, string> = { cooling: "已冻结", unlocked: "冷却中", frozen: "冷却中" };

export type FundTicket = { kind: "f4Payout"; period?: string } | { kind: "f4Settle" } | { kind: "f5Status"; eventId?: string; state: string }
  | { kind: "fConfig"; key: string; spec?: FConfigSpec }
  | { kind: "f5Suspension"; userId?: string; kinds: string[]; suspended: boolean }
  | { kind: "f5Reissue"; ids: string[]; count?: number }
  | { kind: "f5Reverse"; eventId?: string };
export const F_CONFIG_CODES = ["f_config", "f_ui_config", "f_unilevel_rule"];
/**
 * F 域配置、F5 暂停／恢复、补发、冲正：后端的描述器写「F 域配置调整 · 键」「暂停用户奖励 123」+ 对象「123:binary,network」、
 * 「批量补发奖励 · N 笔」+ 逗号连起来的记录号、「撤销奖励记录 CM-1」（delegatedFDescriptor）。审批结果里没有对象，从动作名里认。
 */
export function fundTicket(w: { operationCode?: string | null; obj?: string; after?: string; action?: string }): FundTicket | undefined {
  const action = w.action ?? "";
  if (w.operationCode === "f4_leaderboard_period_payout") return { kind: "f4Payout", period: F4_PERIOD_NAME[/^排行榜 (\S+)$/.exec(w.obj ?? "")?.[1] ?? ""] };
  if (w.operationCode === "f4_pool_settle") return { kind: "f4Settle" };
  if (w.operationCode === "f_commission_status") return { kind: "f5Status", eventId: /^F\.commission\.(CM-\d+)\.status$/.exec(w.obj ?? "")?.[1], state: (w.after ?? "").trim().toLowerCase() };
  const configKey = /^F 域配置调整 · (.+)$/.exec(action)?.[1];
  // 同一个 f_ui_config 也承载大使申请（动作名是「批准区域大使申请」），那种不在这里。
  if (configKey && (!w.operationCode || F_CONFIG_CODES.includes(w.operationCode))) return { kind: "fConfig", key: configKey, spec: fConfigSpec(configKey, w.after) };
  if (w.operationCode === "f5_commission_suspension") {
    const [user, kinds] = (w.obj ?? "").split(":");
    return { kind: "f5Suspension", userId: /^\d+$/.test(user ?? "") ? user : /^(?:暂停|恢复)用户奖励 (\d+)$/.exec(action)?.[1],
      kinds: kinds ? kinds.split(",").filter(Boolean) : [], suspended: w.after ? w.after === "SUSPENDED" : action.startsWith("暂停") };
  }
  if (w.operationCode === "f5_commission_reissue") {
    const ids = (w.obj ?? "").split(",").map((id) => id.trim()).filter((id) => /^CM-\d+$/.test(id));
    return { kind: "f5Reissue", ids, count: ids.length || Number(/^批量补发奖励 · (\d+) 笔$/.exec(action)?.[1]) || undefined };
  }
  if (w.operationCode === "f5_commission_reverse") return { kind: "f5Reverse", eventId: /^CM-\d+$/.test(w.obj ?? "") ? w.obj : /^撤销奖励记录 (CM-\d+)$/.exec(action)?.[1] };
  return undefined;
}

/**
 * F 域整批申请（f_config_batch）：动作名「网络参数整批原子调整 · N 项」；对象是各项配置键用逗号连起来，太长时只存「F.batch:」加摘要（24fa2815）。
 * 各项的修改前后按「键=值 / 键=值」存在单子上（delegatedFDescriptor），从这里逐项列出，不从摘要猜。两边的键对不上就不拆，照原文显示。
 */
const F_BATCH_ACTION = /^网络参数整批原子调整 · (\d+) 项$/;
export const F_BATCH_DIGEST = /^F\.batch:[0-9a-f]{64}$/;
export type FBatchItem = { key: string; spec?: FConfigSpec; before: string; after: string };
function fBatchPairs(text: string): Array<[string, string]> | undefined {
  const pairs: Array<[string, string]> = [];
  for (const part of text.split(" / ")) {
    const m = /^(F\d?\.[^=\s]+)=([\s\S]*)$/.exec(part);
    if (m) pairs.push([m[1], m[2]]);
    else if (pairs.length) pairs[pairs.length - 1][1] += ` / ${part}`;
    else return undefined;
  }
  return pairs;
}
/** 两边逐项的键一一对应（数量也对得上）才拆成各项，否则返回 undefined。 */
function fBatchItems(beforeText: string, afterText: string, count?: number): FBatchItem[] | undefined {
  const after = fBatchPairs(afterText);
  const before = fBatchPairs(beforeText);
  if (!after || !before || after.length !== before.length || count !== undefined && after.length !== count || after.some(([key], i) => before[i][0] !== key)) return undefined;
  return after.map(([key, value], i) => {
    const spec = fConfigSpec(key, value);
    return { key, spec, before: fConfigValue(spec, before[i][1]), after: fConfigValue(spec, value) };
  });
}
export function fBatchTicket(w: { action?: string; obj?: string; before?: string; after?: string }): { count: number; digest: boolean; items?: FBatchItem[] } | undefined {
  const count = Number(F_BATCH_ACTION.exec(w.action ?? "")?.[1]);
  if (!count) return undefined;
  return { count, digest: F_BATCH_DIGEST.test(w.obj ?? ""), items: fBatchItems(w.before ?? "", w.after ?? "", count) };
}
/**
 * 操作记录里的整批申请：对象是摘要，或正好是各项键用逗号连起来；前后值是单上的原文，后端写成「前 -> 后」（decisionDetail），页面自己拼的是「前 → 后」。
 */
export function fBatchLogItems(log: { obj: string; delta: string }): FBatchItem[] | undefined {
  const sides = log.delta.split(/ -> | → /);
  if (sides.length !== 2) return undefined;
  const items = fBatchItems(sides[0], sides[1]);
  return items && (F_BATCH_DIGEST.test(log.obj) || log.obj === items.map((item) => item.key).join(",")) ? items : undefined;
}
/** 队列「变更」一格：第一项改后做第一行，原值做第二行。 */
const fBatchCell = (items: readonly FBatchItem[], count: number) => { const [before, after] = a2Pair(items[0].key, items[0].before, items[0].after); return { main: `${fBatchLabel(items[0], fBatchPages(items))} ${after}${count > 1 ? ` 等 ${count} 项` : ""}`, sub: `原 ${before}` }; };
/** 涉及的页面名；认不出的项写「团队参数」。 */
export const fBatchPages = (items: readonly FBatchItem[] | undefined) => [...new Set((items ?? []).map((item) => item.spec?.page ?? "团队参数"))];
export const fBatchLabel = (item: FBatchItem, pages: readonly string[]) => item.spec ? (pages.length > 1 ? `${item.spec.page} · ${item.spec.item}` : item.spec.item) : "未识别的配置项";
export const kindNames = (kinds: readonly string[]) => kinds.map((kind) => F5_KIND_LABELS[kind] ?? "未知奖励类型").join("、");
export const userCode = (id: string) => `U${id.padStart(8, "0")}`;

export function actionName(ticket: string | { action: string; obj?: string; after?: string; operationCode?: string | null; ruleTaskAction?: A2OperationRow["ruleTaskAction"] | null }) {
  if (typeof ticket !== "string" && (ticket.operationCode === "k1_release_param" || ticket.operationCode === "k1_earnings_release")) return A2_ACTION_NAMES[ticket.operationCode];
  if (typeof ticket !== "string" && ticket.operationCode === "j1_gate_resume" && ticket.obj) return `恢复业务开关 · ${j1GateName(ticket.obj)}`;
  // H3：和 H3 页改值框、新建抽屉的标题同名。审批结果里没有对象，照原动作名。
  if (typeof ticket !== "string" && ticket.operationCode === "h3_quest_config" && ticket.obj && h3ConfigName(ticket.obj)) return `改${/^P\d/.test(h3ConfigName(ticket.obj)!) ? " " : ""}${h3ConfigName(ticket.obj)}`;
  if (typeof ticket !== "string" && ticket.operationCode === "h3_mission_create" && ticket.after) {
    const mission = h3MissionView({ operationCode: ticket.operationCode, after: ticket.after });
    if (mission) return `新建${mission.type}`;
  }
  if (typeof ticket !== "string" && ticket.ruleTaskAction) {
    return ({ CREATE: "新增手机任务", UPDATE: "编辑手机任务", ENABLE: "启用手机任务", DISABLE: "停用手机任务" })[ticket.ruleTaskAction];
  }
  // 和 F4 页确认框的标题同名；审批结果里没有对象，认不出是哪个榜时只写「排行榜」。
  const fund = typeof ticket === "string" ? undefined : fundTicket(ticket);
  if (fund?.kind === "f4Payout") return fund.period === "总榜" ? "发放总榜奖励" : fund.period ? `发放${fund.period}奖励` : "发放排行榜奖励";
  if (fund?.kind === "f4Settle") return "提前结算本周团队激励池";
  if (fund?.kind === "fConfig") return fund.spec?.action ?? "调整未识别的配置项";
  if (fund?.kind === "f5Suspension") return `${fund.suspended ? "暂停" : "恢复"}用户奖励${fund.userId ? ` · ${userCode(fund.userId)}` : ""}`;
  if (fund?.kind === "f5Reissue") return fund.count ? `批量补发 ${fund.count} 笔奖励` : "批量补发奖励";
  if (fund?.kind === "f5Reverse") return `冲正奖励记录${fund.eventId ? ` ${fund.eventId}` : ""}`;
  const batchCount = F_BATCH_ACTION.exec(typeof ticket === "string" ? ticket : ticket.action)?.[1];
  if (batchCount) return `整批调整团队参数 · ${batchCount} 项`;
  const action = typeof ticket === "string" ? ticket : ticket.operationCode === "h5_streak_milestone" ? "放宽连签里程碑奖励" : ticket.action;
  const gParam = G_PARAM_ACTION.exec(action);
  if (gParam) return `${gParam[1] === "回购参数调整" ? "锁定计划参数调整" : gParam[1]} · ${G_PARAM_NAMES[gParam[2]] ?? gParam[2]}`;
  return a2ActionText(nexGridBrandText(action));
}

export function approvalActionName(ticket: A2OperationRow) {
  const name = actionName(ticket);
  if (containsHan(name)) return name;
  if (!ticket.operationCode) return ticket.action;
  const registered = findHighOp(ticket.operationCode)?.action;
  return registered && containsHan(registered) ? registered : name;
}

export function approvalTitleParts(ticket: A2OperationRow) {
  const action = approvalActionName(ticket);
  const object = objectText(ticket);
  // A1's title has a fixed verb followed by the entire account name, which can itself contain 「 · 」.
  const accountName = /^(?:启用账号|停用账号|编辑资料|撤销全部登录|新建运营账号|删除账号|重置密码|重置两步验证) · (.+)$/.exec(action)?.[1];
  const a1ObjectInAction = isA1AccountTicket(ticket) && object !== "—"
    && (accountName === object || ticket.operationCode === "a1_account_change_role" && action.startsWith(`改角色 · ${object} → `));
  // The delegated C2 and K1 descriptors append their target identifier after the verb.
  const delegatedTarget = /^(?:冻结账户|恢复账户|批量冻结关联账户|解除误判|判定为正常|标记可疑账户簇) · (.+)$/.exec(action)?.[1];
  const delegatedObjectInAction = (ticket.operationCode === "c2_account_freeze" || ticket.operationCode === "c2_account_unfreeze"
    || ticket.operationCode?.startsWith("k1_cluster_") === true) && object === ticket.obj && delegatedTarget === ticket.obj;
  const parameterKey = G_PARAM_ACTION.exec(ticket.action)?.[2];
  const parameterInAction = isGParamTicket(ticket) && (action === `调整创世参数 · ${object}`
    || parameterKey === ticket.obj && G_PARAM_NAMES[ticket.obj] === object);
  return { action, object, objectInAction: a1ObjectInAction || delegatedObjectInAction || parameterInAction };
}

/* ────────────────── 完整变更内容 ────────────────── */

export const CHANGE_LABELS: Record<string, string> = {
  skuId: "商品编号", id: "商品编号", name: "商品名称", tier: "商品档位", tagline: "卖点", badge: "角标",
  gpu: "GPU", vram: "显存", hashRate: "算力", power: "功耗", datacenter: "托管机房", allowedPoolCodes: "任务等级", uptime: "在线率",
  warranty: "保修", phoneDailyEarn: "手机日产收益", phoneDailyEarnNex: "手机日产 UVT", price: "价格", computePoints: "每件算力点",
  dailyEarn: "日产收益", dailyEarnNex: "日产 UVT", shareYieldMin: "份额收益下限", shareYieldMax: "份额收益上限",
  monthlyTargetUsdt: "月收益目标", monthlyTargetBandPct: "允许波动", clearMonthlyTarget: "关闭月收益目标",
  baseRate: "收益说明", sold: "累计销量", displaySoldBase: "展示基础销量", liveActivityVisible: "显示购买动态", stock: "库存", rating: "评分", reviews: "评价数",
  aiImageGenPerMin: "图像生成性能", aiLlmTokensPerSec: "大模型推理性能", aiVideoMinPerHour: "视频渲染性能",
  aiFineTuneMins: "LoRA 微调性能", aiUnlocks: "解锁算力池", features: "产品特性", generation: "产品代际",
  lifecycle: "生命周期", supersededBy: "后继商品", tradeinDiscount: "换新折扣", unlockPhase: "解锁阶段",
  purchaseGate: "购买限制", imageAssetId: "产品图编号", imageObjectKey: "产品图存储位置", imagePreviewUrl: "产品图预览",
  tag: "商品标签", status: "商城状态", inventoryMode: "库存模式", expectedUpdatedAt: "修改前的更新时间",
  updatedAt: "更新时间", trialEligible: "允许试用", productType: "商品类型", reason: "操作理由", operator: "操作人",
  rankMin: "最低 V 等级", directsMin: "最低有效直接邀请", teamUsdtMin: "最低团队订单额", mode: "条件组合",
  activeDirectMin: "最低有效直接邀请", teamComputePointsMin: "最低团队算力点",
  enforce: "启用限制", quotaCap: "总配额", quotaSold: "已用配额", quotaPeriod: "配额周期",
  ranks: "会员等级", rankCode: "等级", titleCn: "中文头衔", titleEn: "英文头衔",
  selfComputePoints: "自购算力点", directRefs: "一二级已购人数", teamComputePoints: "团队算力点",
  requiredDownlineRank: "下级领导者最低等级", requiredDownlineCount: "下级领导者人数", unilevelDepth: "团队购买奖励范围",
  purchaseL1Rate: "一级好友购买奖励比例", purchaseL2Rate: "二级好友购买奖励比例", monthlySalaryUsdt: "月薪（USDT）",
  peerBonusRate: "同级奖比例", leadershipVotes: "团队激励池票数", rewards: "晋升奖励",
};
// Only these three reward contracts override the shared product-field vocabulary.
const HI_CHANGE_LABELS: Record<string, string> = {
  ...CHANGE_LABELS,
  eventCode: "活动编号", rewardName: "奖励名称", rewardType: "奖励资产", rewardAmount: "发放数量",
  value: "目标值", expectedValue: "原值", tierName: "奖项编号", rewardKind: "奖励类型",
  probabilityPct: "概率（%）", realOutflow: "实际资金流出", dailyStock: "每日库存（0 为不限）",
  expectedSignature: "提交时的奖池核对码", wheelSignature: "奖池核对码", tiers: "奖池档位",
  wheelEvidence: "核对证据", wheelSnapshot: "原奖池内容",
  courseId: "课程编号", version: "课程版本", revision: "修改序号", rewardNex: "奖励（UVT）",
  sourceStatus: "目标版本原状态", expectedRevision: "目标版本的修改序号", expectedCurrentVersion: "当前课程版本",
  expectedCurrentRevision: "当前课程的修改序号", expectedCurrentStatus: "当前课程状态",
  tier: "奖项编号", status: "状态", reward: "奖励名称", prob: "概率（%）", kind: "奖励类型", amount: "发放数量", real: "实际资金流出",
  voucherId: "代金券编号", category: "课程分类", format: "课程形式", level: "难度", duration: "时长",
  titleZh: "中文标题", titleEn: "英文标题", titleVi: "越南语标题", bodyZh: "中文正文", bodyEn: "英文正文", bodyVi: "越南语正文",
  quizQuestions: "测验题", passScore: "及格题数", retryLimit: "可重试次数", completionCondition: "完成条件", rewardEvent: "奖励事件",
  courseTarget: "目标版本的其他内容", field: "内容", content: "目标版本",
};
const WHEEL_REVIEW_OPERATIONS = ["h4_wheel_tier_create", "h4_wheel_tier_update", "h4_wheel_tier_delete", "h4_wheel_probabilities_update"];
const COURSE_REVIEW_OPERATIONS = ["i7_course_first_publish", "i7_course_version_publish", "i7_course_version_rollback"];
const hiReviewLabels = (operationCode?: string) => ["h4_legacy_event_reward_update", ...COURSE_REVIEW_OPERATIONS, ...WHEEL_REVIEW_OPERATIONS].includes(operationCode ?? "") ? HI_CHANGE_LABELS : CHANGE_LABELS;
export const G_PARAM_ACTION = /^(兑换参数调整|回购参数调整|调整创世参数) · ([A-Za-z]+)$/;
/** G2、G4、G7 的参数审批单：对象是参数键，给运营看参数名，键收进技术信息。 */
export const isGParamTicket = (w: { operationCode?: string | null; action: string }) =>
  ["g2_exchange_param", "g7_repurchase_param", "g4_genesis_param"].includes(w.operationCode ?? "") || G_PARAM_ACTION.test(w.action);
export const reviewOperation = (w: { operationCode?: string; action: string }) =>
  ["g2_exchange_param", "g7_repurchase_param", "g4_genesis_param"].includes(w.operationCode ?? "") || !w.operationCode && G_PARAM_ACTION.test(w.action)
    ? "g_param" : w.operationCode ?? REVIEW_OPERATION_BY_ACTION[w.action];
/** G2、G4、G7 参数的页面名字，和三页参数行一致（G4 取后端 GenesisParamDef 的名字）。 */
const G_PARAM_NAMES: Record<string, string> = {
  userDailyCap: "单用户日额度", platformDailyCap: "平台日额度", fee: "兑换手续费率", feeMin: "最低手续费", queueMode: "超额度处置策略",
  apy: "参考年奖励率", lockDays: "锁仓期限", nurture: "好友升级奖励倍率", lottery: "创世节点抽奖券", penalty: "提前解锁扣款", presets: "锁定金额快捷选项",
  supply: "节点总量", price: "系列当前价（分红计价）", dividend: "每日收益比例", royalty: "内部转售手续费", divBase: "收益计算基数",
  airdropPct: "空投占比", emissionCurve: "收益发放曲线", airdropLockDays: "早期持有人奖励锁仓期",
};
// 空值（比如 divBase 合法为空）读进来时末尾的空格已被去掉，等号后面直接结束，写成「= 空」；新单的参数名已是中文，同样补「空」。
// 新增应付后端写「确定新增应付 Δ 12 USDT」，写成「新增应付 12 USDT」。
export const gParamText = (text: string) => text.replace(/(^|· )([A-Za-z]+) =( |$)/g, (whole, lead: string, key: string, tail: string) => G_PARAM_NAMES[key] ? `${lead}${G_PARAM_NAMES[key]} =${tail || " 空"}` : whole)
  .replace(/ =$/, " = 空").replace(/确定新增应付 Δ /g, "新增应付 ").replace(DIV_BASE_FORMULA, DIV_BASE_TEXT);
/** H3 审批单对象的配置键写 H3 页上这一项的叫法（H3 页的设置名和改值框标题）。 */
export function h3ConfigName(key: string): string | undefined {
  if (key === "dayOne.triReward") return "新手任务奖励";
  const m = /^weekly\.mult\.(P[1-6])$/.exec(key) ?? /^(mission|monthly)\.([A-Za-z0-9_-]{2,64})\.reward$/.exec(key);
  if (!m) return undefined;
  return m.length === 2 ? `${m[1]} 每周阶段倍率` : `${m[1] === "mission" ? "每周任务奖励" : "月度挑战奖励"} · ${m[2]}`;
}
/** H3 新建任务的类型，和 H3 新建抽屉的标题同名（h3-mission-form SUBJECT_TEXT）。 */
const H3_MISSION_TYPE: Record<string, string> = { DAY_ONE: "新手任务", WEEKLY_T1: "每周一档任务", WEEKLY_T2: "每周二档任务" };
/** H3 新建任务单的变更后是后端建单时拼的一句（OpsGrowthService.createMission）：编号；名称；类型；奖励 N UVT；类别；去完成页面；paused。 */
export function h3MissionView(w: { operationCode?: string | null; after: string }) {
  if (w.operationCode !== "h3_mission_create") return undefined;
  const m = /^([A-Za-z0-9_-]{2,64})；(.+)；(DAY_ONE|WEEKLY_T1|WEEKLY_T2)；奖励 (\d+) UVT；([A-Z]+)；(\/pages\/\S+)；paused$/.exec(w.after.trim());
  return m ? { code: m[1], name: m[2], type: H3_MISSION_TYPE[m[3]], reward: `${grouped(m[4])} UVT`,
    category: TASK_CATEGORY_LABELS[m[5].toLowerCase()] ?? m[5], route: TASK_ACTION_ROUTE_LABELS[m[6]] ?? m[6] } : undefined;
}
/** 新手任务奖励的原值可能带旧名称 NEX：照 H3 页写成 UVT 并标出旧名称。 */
function h3ConfigValue(key: string | undefined, value: string) {
  if (key !== "dayOne.triReward") return value;
  const reward = legacyAssetText(value);
  return reward.legacy ? `${reward.text}（旧名称 NEX）` : value;
}

const isA1AccountTicket = (ticket: { operationCode?: string | null }) => ticket.operationCode?.startsWith("a1_account_") === true;
const WITHDRAWAL_OBJECT_NAMES = { D5: D5_MENU_NAME, D6: D6_MENU_NAME, D7: D7_MENU_NAME };

/** 对象写运营看得懂的名字。业务编号保留，已知锁号和 A1 账号库内编号留在原单。 */
export function objectText(w: { action: string; obj: string; after?: string; objDisplayName?: string; operationCode?: string | null; disclosureReview?: A2OperationRow["disclosureReview"] }) {
  const withdrawal = w.obj === "current" ? withdrawalApprovalDomain(w) : undefined;
  if (withdrawal) return WITHDRAWAL_OBJECT_NAMES[withdrawal];
  if (w.obj === "currentPrice" && (w.operationCode ? w.operationCode === "g3_market_policy_change" : isG3Policy(w))) return "当前全站价格";
  if (isA1AccountTicket(w) && /^\d+$/.test(w.obj)) return w.objDisplayName && w.objDisplayName !== w.obj ? w.objDisplayName : "—";
  if (w.operationCode === "h3_weekly_region_policy" && w.obj === "growth.h3.weekly-region-policy") return "区号规则";
  if (w.disclosureReview) return w.disclosureReview.jurisdiction;
  if (w.objDisplayName && isGParamTicket(w)) return w.objDisplayName;
  if (w.objDisplayName) return a2ObjectText(w);
  if (w.operationCode === "k1_release_param") return K1_APPROVAL_PARAM_NAMES[w.obj] ?? w.obj;
  if (w.operationCode === "k1_earnings_release") return `收益记录 ${w.obj}`;
  if (w.operationCode === "j1_gate_resume") return j1GateName(w.obj);
  if (w.operationCode === "f_unilevel_bootstrap") return "团队购买奖励 · L1–L7";
  if (w.operationCode === "h3_mission_create") return `任务 ${w.obj}`;
  if (w.operationCode === "h3_quest_config") return h3ConfigName(w.obj) ?? w.obj;
  const fund = fundTicket(w);
  if (fund?.kind === "f4Payout" && fund.period) return fund.period;
  if (fund?.kind === "f5Status" && fund.eventId) return `奖励记录 ${fund.eventId}`;
  if (fund?.kind === "fConfig") return fund.spec ? `${fund.spec.page} · ${fund.spec.item}` : "未识别的配置项";
  if (fund?.kind === "f5Suspension") return `用户 ${fund.userId ? userCode(fund.userId) : "—"} · ${fund.kinds.length ? kindNames(fund.kinds) : "所选奖励"}`;
  if (fund?.kind === "f5Reissue") return fund.ids.length ? `${fund.ids.length} 笔奖励记录` : w.obj;
  if (fund?.kind === "f5Reverse" && fund.eventId) return `奖励记录 ${fund.eventId}`;
  const batch = fBatchTicket(w);
  if (batch) return `${fBatchPages(batch.items).join("、") || "团队参数"} · ${batch.count} 项`;
  if (G_PARAM_ACTION.test(w.action)) return G_PARAM_NAMES[w.obj] ?? w.obj;
  if (w.obj === "ACTIVE_POOL" && REVIEW_OPERATION_BY_ACTION[w.action]?.startsWith("h4_wheel")) return "抽奖转盘奖池";
  const ambassador = /^F\.ambassador\.(\d+)\.status$/.exec(w.obj);
  if (ambassador) return `区域大使申请 #${ambassador[1]}`;
  return w.obj;
}
/**
 * K1 两类资金审批的前后摘要是后端建单时自己记的（RiskReleaseParamsService、EarningsReleaseService 的 previewApproval）：
 * 拆成批准人要核对的几项，参数键和版本只进技术信息。格式对不上时返回 undefined，照原来的写法显示原文。
 */
export type K1TicketView = { kind: "param"; key: string; name: string; from: string; to: string; versionFrom: string; versionTo: string }
  | { kind: "release"; entryNo: string; userId: string; asset: string; net: string; source: string; sourceRef: string; bucket: string; coverage: string; redline: string };
const K1_PARAM_SUMMARY = /^(duplicateAccountPendingFrom|duplicateAccountFreezeFrom) = (\d+)；版本 (\d+)$/;
export function k1TicketView(w: { operationCode?: string | null; before: string; after: string }): K1TicketView | undefined {
  if (w.operationCode === "k1_release_param") {
    const b = K1_PARAM_SUMMARY.exec(w.before.trim()), a = K1_PARAM_SUMMARY.exec(w.after.trim());
    return b && a && b[1] === a[1] ? { kind: "param", key: b[1], name: K1_APPROVAL_PARAM_NAMES[b[1]], from: b[2], to: a[2], versionFrom: b[3], versionTo: a[3] } : undefined;
  }
  if (w.operationCode !== "k1_earnings_release") return undefined;
  const release = parseK1ReleaseTicketBefore(w.before);
  return release ? { kind: "release", ...release } : undefined;
}
/** 后端写的净额按全站金额写法（amountDisplay）：千分位，有几位写几位，整数不写小数点，不舍入。 */
export const k1Amount = (text: string) => amountDisplay(text);
export const k1Source = k1EarningSourceName;
/** 列表「变更」一格。 */
function k1ChangeCell(v: K1TicketView) {
  return v.kind === "param" ? { main: `${v.from} → ${v.to} 个账户`, sub: v.name }
    : { main: `${k1Amount(v.net)} ${nexGridBrandText(v.asset)}`, sub: `${k1Source(v.source)} · 用户 ${userCode(v.userId)}` };
}
const COURSE_VALUE_TEXT: Record<string, Record<string, string>> = {
  status: { published: "已发布", draft: "草稿", archived: "已下架", PUBLISHED: "已发布", DRAFT: "草稿", SUPERSEDED: "历史版本" },
  sourceStatus: { DRAFT: "草稿", PUBLISHED: "已发布", SUPERSEDED: "历史版本", LEGACY_DRAFT: "旧草稿（无独立版本）" },
  category: { Basics: "基础", Earn: "赚取", Team: "团队", Wealth: "财富", Security: "安全" },
  format: { Article: "图文", Video: "视频", "Hands-on": "实操" },
  level: { Beginner: "入门", Intermediate: "进阶", Advanced: "高级" },
};
/** 成组记录的量词：「查看全部 9 个等级」。 */
export const ROW_UNIT: Record<string, string> = { ranks: "个等级", rewards: "项奖励" };

export const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export const isRowList = (value: unknown): value is Record<string, unknown>[] => Array.isArray(value) && value.length > 0 && value.every(isRecord);
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 纯数字加千分位，只排版，不舍入（必须改 5）。后端的值不带单位，页面不猜单位。 */
function grouped(text: string) {
  return /^-?\d{4,}(\.\d+)?$/.test(text) ? text.replace(/^-?\d+/, (whole) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")) : text;
}

export function valueText(key: string | undefined, value: unknown, labels = CHANGE_LABELS): string {
  if (value === null || value === undefined) {
    if (key === "clearMonthlyTarget" || key === "trialEligible") return "否";
    return "未设置";
  }
  if (key === "tagline" || key?.startsWith("taglineTranslations.")) return String(value);
  // 「显示购买动态」和商品页确认框一样写开／关；其他布尔项照旧写是／否。
  if (key === "liveActivityVisible" && typeof value === "boolean") return value ? "开" : "关";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (key === "monthlyTargetUsdt") return `${grouped(String(value))} USDT`;
  if (key === "monthlyTargetBandPct") return `±${grouped(String(value))}%`;
  if (key === "dailyEarn") return `${grouped(String(value))} USDT/日`;
  if (key === "shareYieldMin" || key === "shareYieldMax") return `${grouped(String(value))}%`;
  if (key === "peerBonusRate" && typeof value === "number") return `${(value * 100).toFixed(2)}%`;
  if (key === "baseRate" && isDerivedBaseRate(value)) return `${value.derivedDaily} USDT/日${DERIVED_BASE_RATE}`;
  if (key === "baseRate" && typeof value === "string") return value.trim() ? value : "未设置";
  if (key === "allowedPoolCodes" && Array.isArray(value)) return value.length ? value.map(code => ({L1:"L1 初级",L2:"L2 中级",L3:"L3 高级",L4:"L4 旗舰",PHONE:"手机任务池"}[String(code)] ?? String(code))).join("、") : "未选择";
  if (Array.isArray(value)) return value.length ? value.map((item) => valueText(undefined, item, labels)).join("、") : "无";
  if (isRecord(value)) return Object.entries(value).map(([name, item]) => `${labels[name] ?? name} ${valueText(name, item, labels)}`).join("；") || "无";
  return grouped(String(value));
}

/** 「收益说明」是按月收益目标折算的金额（reviewPair 换成的 { derivedDaily }）。 */
const isDerivedBaseRate = (value: unknown): value is { derivedDaily: string } => isRecord(value) && typeof value.derivedDaily === "string";
const DERIVED_BASE_RATE = "（系统按月收益目标折算）";
/** 改前改后都是折算的金额（或新建、改后是折算的）时，说明挪进名称，值只写「1.3 USDT/日」，前后两列不各写一遍（VS-105、DT-12）。
 *  一边折算、一边是文案（设了或关了月收益目标）时，名称不把文案也说成折算的：说明只跟在折算的那一边，写短，两列不折行；
 *  改短后两边一样时照原样写，不把改动藏掉。有没有改照旧按带说明的原文判断（a2Pair、same），这里只改显示。 */
export const derivedBaseRateShown = (key: string, label: string, was: unknown, now: unknown, created: boolean, before: string | undefined, after: string | undefined) => {
  const wasDerived = isDerivedBaseRate(was), nowDerived = isDerivedBaseRate(now);
  if (key !== "baseRate" || !wasDerived && !nowDerived) return { label, before, after };
  if (nowDerived && (created || wasDerived)) return { label: `${label}（按月收益目标折算）`, before: before?.replace(DERIVED_BASE_RATE, ""), after: after?.replace(DERIVED_BASE_RATE, "") };
  const short = (text: string | undefined) => text?.replace(DERIVED_BASE_RATE, "（按月折算）");
  const shown = { label, before: wasDerived ? short(before) : before, after: nowDerived ? short(after) : after };
  return shown.before === shown.after ? { label, before, after } : shown;
};

type Review = { kind: "text"; text: string } | { kind: "object"; value: Record<string, unknown> } | { kind: "rows"; rows: Record<string, unknown>[] };

/** 「收益说明」是系统按月收益目标折算的日收益（后端 MonthlyTargetProjection.daily，六位小数）时返回后端存的原值，否则 undefined。比较用这个原值，说明和去尾零在显示时加（R3F02）。 */
function e1MonthlyBaseRate(value: unknown, monthlyTarget: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d+(\.\d{1,6})?$/.test(value)) return;
  if (typeof monthlyTarget !== "number" && typeof monthlyTarget !== "string") return;
  const target = Number(monthlyTarget);
  if (!Number.isFinite(target) || target <= 0) return;
  // OpsDeviceService.monthlyTargetRequest → DeviceSkuUpsertRequest.withMonthlyTarget → MonthlyTargetProjection.daily (six places).
  const daily = Number((target / 30).toFixed(6));
  if (Number(value) !== daily) return;
  return value;
}

/** 后端存的前后值：JSON 对象、成组记录或一段文字。空和「—」是首次配置，返回 null。 */
export function parseReview(value: string): Review | null {
  const raw = value.trim();
  if (!raw || raw === "—") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRowList(parsed)) return { kind: "rows", rows: parsed };
    if (isRecord(parsed)) return Object.keys(parsed).length ? { kind: "object", value: parsed } : null;
    return { kind: "text", text: valueText(undefined, parsed) };
  } catch {
    return { kind: "text", text: grouped(raw) };
  }
}

/** H4 stores a pool snapshot before and command values after, not two replacement configs. */
const isSkuReview = (operationCode?: string) => operationCode === "e1_sku_create" || operationCode === "e1_sku_update";
const SKU_MEDIA_EVIDENCE = ["imageAssetId", "imageObjectKey", "imagePreviewUrl"];

export function reviewPair(before: string, after: string, operationCode?: string) {
  const b = parseReview(operationCode === "g_param" ? gParamText(before) : k1ApprovalSummaryText(before, operationCode));
  const a = parseReview(operationCode === "g_param" ? gParamText(after) : k1ApprovalSummaryText(after, operationCode));
  const labels = hiReviewLabels(operationCode);
  const original = { b, a, labels, evidenceKeys: [] as string[] };
  // E1 商品：后端冻结的是代码值（系列、档位、商城状态、生命周期、库存模式），这里换成和商品页一样的名称，价格带币种。新建没有前值；旧票没有这一项时不补。
  if (isSkuReview(operationCode)) {
    const creating = operationCode === "e1_sku_create";
    // 新建的结构化前值是默认设置。更早的文字摘要沿用原显示。
    const skuBefore = creating && b?.kind === "object" ? null : b;
    const previous = skuBefore?.kind === "object" && isSkuTaglineTranslations(skuBefore.value.taglineTranslations) ? skuBefore.value.taglineTranslations : undefined;
    const next = a?.kind === "object" && isSkuTaglineTranslations(a.value.taglineTranslations) ? a.value.taglineTranslations : previous;
    // 语言按中文、越南语、其他语言的固定顺序列（TX-35），不随服务器快照里键的先后变。
    const languages = (Object.keys(SKU_TAGLINE_LABELS) as (keyof SkuTaglineTranslations)[]).filter(language => language in { ...previous, ...next });
    const translationLabels = Object.fromEntries(languages.map(language => [`taglineTranslations.${language}`, SKU_TAGLINE_LABELS[language]]));
    const named = (review: Review | null, translations?: SkuTaglineTranslations): Review | null => {
      if (review?.kind !== "object") return review;
      const value = { ...review.value };
      if ("badge" in value && (typeof value.badge === "string" || value.badge == null)) value.badge = skuBadgeReviewText(value.badge) ?? null;
      // 提交时空标签写成 ""，快照里没有标签是 null，两者都是「未设置」，不当成一项改动列出来。
      if (value.tag === "") value.tag = null;
      // The server snapshot uses null for a missing command field and {} for an explicit clear.
      delete value.taglineTranslations;
      for (const language of languages) value[`taglineTranslations.${language}`] = translations?.[language] ?? null;
      if ("seriesCode" in value) value.seriesCode = skuSeriesText(value.seriesCode);
      if (creating && typeof value.liveActivityVisible === "boolean") value.liveActivityVisible = e1Value(value.liveActivityVisible);
      for (const key of ["tier", "status", "lifecycle", "inventoryMode"]) if (typeof value[key] === "string") value[key] = e1Value(value[key]);
      if (typeof value.price === "number" || typeof value.price === "string" && value.price.trim()) value.price = `${String(value.price).trim()} USD`;
      const derivedDaily = "baseRate" in value ? e1MonthlyBaseRate(value.baseRate, value.monthlyTargetUsdt) : undefined;
      if (derivedDaily !== undefined) value.baseRate = { derivedDaily };
      // 购买条件写成人话；读不到阶段名时写「第 N 阶段」，不只写数字。
      if (isRecord(value.purchaseGate)) value.purchaseGate = e1GateText(value.purchaseGate);
      if ((typeof value.unlockPhase === "string" || typeof value.unlockPhase === "number") && /^\d+$/.test(String(value.unlockPhase).trim())) value.unlockPhase = `第 ${String(value.unlockPhase).trim()} 阶段`;
      return { kind: "object", value };
    };
    // 新建只列填了的项，没填的不逐行写「未设置」（和商品页确认框一致）。
    const filled = (review: Review | null): Review | null => skuBefore || review?.kind !== "object" ? review
      : { kind: "object", value: Object.fromEntries(Object.entries(review.value).filter(([, item]) => item !== null && item !== "" && !(Array.isArray(item) && !item.length))) };
    return { b: named(skuBefore, previous), a: filled(named(a, next)), labels: { ...labels, ...translationLabels, tagline: "英文标语", badge: "营销角标", seriesCode: "所属系列", specDocumentTitle: "资料名称", specDocumentUrl: "资料链接" }, evidenceKeys: SKU_MEDIA_EVIDENCE };
  }
  // 旧活动：前值是锁定时整行活动快照（OpsGrowthService.lockH4LegacyEventState），后值是提案 values，只比奖励。
  if (operationCode === "h4_legacy_event_reward_update" && b?.kind === "object" && a?.kind === "object" && "eventCode" in b.value) {
    const status = b.value.status === "1" ? "启用" : b.value.status === "0" ? "停用" : b.value.status;
    return {
      b: { kind: "object" as const, value: { eventCode: b.value.eventCode, rewardName: b.value.rewardName } },
      a: { kind: "object" as const, value: { eventCode: a.value.eventCode, rewardName: a.value.value,
        legacyEvent: [{ eventStatus: status, startsAt: b.value.startsAt, endsAt: b.value.endsAt }] } },
      labels: { ...labels, legacyEvent: "提交时的活动状态", eventStatus: "活动状态", startsAt: "开始时间", endsAt: "结束时间" },
      evidenceKeys: ["legacyEvent"],
    };
  }
  // 课程：前值只有当前版本五项（currentReview），后值是目标版本内容（targetReview）。两边都有的才比，其余作目标版本内容列出。
  if (COURSE_REVIEW_OPERATIONS.includes(operationCode ?? "") && b?.kind === "object" && a?.kind === "object") {
    const show = (key: string, value: unknown) => typeof value === "string" ? COURSE_VALUE_TEXT[key]?.[value] ?? value : value;
    const was: Record<string, unknown> = {};
    const next: Record<string, unknown> = {};
    const extra: Record<string, unknown>[] = [];
    for (const key of Object.keys(a.value)) {
      if (key in b.value) { was[key] = show(key, b.value[key]); next[key] = show(key, a.value[key]); }
      else extra.push({ field: labels[key] ?? key, content: valueText(key, show(key, a.value[key]), labels) });
    }
    for (const key of Object.keys(b.value)) if (!(key in a.value)) was[key] = show(key, b.value[key]);
    if (extra.length) next.courseTarget = extra;
    return { b: { kind: "object" as const, value: was }, a: { kind: "object" as const, value: next }, labels, evidenceKeys: ["courseTarget"] };
  }
  if (!WHEEL_REVIEW_OPERATIONS.includes(operationCode ?? "") || b?.kind !== "object" || a?.kind !== "object"
    || typeof b.value.tiers !== "string") return original;
  let snapshot: unknown;
  try { snapshot = JSON.parse(b.value.tiers); }
  catch { return original; }
  if (!Array.isArray(snapshot) || !snapshot.every(isRecord)) return original;

  // Decimal strings and JSON numbers compare without rounding or false scale-only changes.
  const decimal = (value: unknown) => String(value).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  // 奖型和 H4 页面同一套叫法；旧名 nex、points 照实写出来，不当成合法奖型。
  const kindText = (kind: unknown) => ({ uvt: "UVT", usdt: "USDT", coupon: "代金券", voucher: "代金券", nex: "旧奖型 nex", points: "积分奖型" } as Record<string, string>)[String(kind).toLowerCase()] ?? kind;
  const tiers = snapshot.map(tier => ({
    tierName: tier.tier, rewardName: tier.reward, probabilityPct: decimal(tier.prob),
    realOutflow: tier.real === true || tier.real === 1, rewardKind: kindText(tier.kind),
    rewardAmount: decimal(tier.amount), voucherId: tier.voucherId || "无", dailyStock: tier.dailyStock,
  }));
  const values = a.value;
  const target = tiers.find(tier => tier.tierName === values.tierName);
  let was: Record<string, unknown> | null;
  let next: Record<string, unknown>;
  const wheelLabels = { ...labels };
  if (operationCode === "h4_wheel_probabilities_update") {
    if (!isRecord(values.probabilities)) return original;
    was = {};
    next = {};
    for (const tier of tiers) {
      const key = `probability:${tier.tierName}`;
      wheelLabels[key] = `${tier.tierName} · 概率（%）`;
      was[key] = tier.probabilityPct;
      next[key] = decimal(values.probabilities[String(tier.tierName)]);
    }
  } else if (operationCode === "h4_wheel_tier_delete") {
    if (!target) return original;
    was = { ...target, status: "已启用" };
    next = { ...target, status: "已删除" };
  } else {
    const created = operationCode === "h4_wheel_tier_create";
    if (!created && !target) return original;
    was = created ? null : { ...target };
    // Match OpsGrowthService's defaults for omitted optional command fields.
    next = {
      tierName: values.tierName, rewardName: values.rewardName,
      probabilityPct: decimal(values.probabilityPct ?? target?.probabilityPct ?? 0),
      realOutflow: values.realOutflow == null ? target?.realOutflow ?? false : values.realOutflow === 1,
      rewardKind: values.rewardKind == null ? target?.rewardKind ?? kindText("uvt") : kindText(values.rewardKind),
      rewardAmount: decimal(values.rewardAmount ?? target?.rewardAmount ?? 0),
      voucherId: values.voucherId == null ? target?.voucherId ?? "无" : String(values.voucherId).trim() || "无",
      dailyStock: values.dailyStock ?? target?.dailyStock ?? 0,
    };
  }
  // 改一档、删一档时，每一行都带上是哪一档（和改概率的写法一样），不然差异里只看得到「发放数量 1 → 2」。
  if (operationCode === "h4_wheel_tier_update" || operationCode === "h4_wheel_tier_delete") {
    const named = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
      if (key === "tierName" || !labels[key]) return [key, value];
      wheelLabels[`tier:${key}`] = `${String(values.tierName)} · ${labels[key]}`;
      return [`tier:${key}`, value];
    }));
    if (was) was = named(was);
    next = named(next);
  }
  // Existing row groups keep verification evidence out of the business-field diff.
  next.wheelEvidence = [{ wheelSignature: b.value.wheelSignature, expectedSignature: values.expectedSignature }];
  next.wheelSnapshot = tiers;
  return {
    b: was ? { kind: "object" as const, value: was } : null,
    a: { kind: "object" as const, value: next }, labels: wheelLabels,
    evidenceKeys: ["wheelEvidence", "wheelSnapshot"],
  };
}

/** 队列「变更」列：和详情同一套格式。第一项做第一行，原值做第二行，多项时写「等 N 项」（必须改 5）。 */
export const CHANGE_UNAVAILABLE = "未能读取变更明细";

type ApprovalChangeValues = Pick<A2OperationRow, "operationCode" | "action" | "before" | "after" | "withdrawalChanges">;

function withdrawalApprovalDomain({ operationCode, action }: { operationCode?: string | null; action: string }) {
  if (operationCode === D5_APPROVAL_OP || !operationCode && action === "放宽提现参数") return "D5";
  if (operationCode === "d6_fx_quote" || !operationCode && ["调整汇率", "调整敏感汇率"].includes(action)) return "D6";
  if (operationCode === "d7_payout_vnd_config" || !operationCode && action === "放宽越南盾提现参数") return "D7";
}

const FX_APPROVAL_FIELDS = [
  ["baseRateVndPerUsdt", "基准价", " ₫/USDT"],
  ["buySpreadPct", "买入点差", "%"],
  ["lockWindowMinutes", "报价有效期", " 分钟"],
] as const;

function fxApprovalValues(text: string) {
  const legacy = /^\{([A-Za-z]+=[\d.eE+-]+(?:, [A-Za-z]+=[\d.eE+-]+)*)\}$/.exec(text);
  if (legacy) return Object.fromEntries(legacy[1].split(", ").map((part) => part.split("=")));
  const parsed = parseReview(text);
  return parsed?.kind === "object" ? parsed.value : {};
}

function fxApprovalNumber(value: unknown) {
  const text = String(value ?? "");
  if (!/^\d+(?:\.\d+)?(?:e[+-]?\d{1,2})?$/i.test(text)) return null;
  return f4Decimal(text)?.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") ?? null;
}

export function approvalDisplayChanges(ticket: ApprovalChangeValues, accountStatusText = a1ApprovalStatusText): WithdrawalProposalChanges | null | undefined {
  const { before, after, operationCode } = ticket;
  if (operationCode === "a1_account_status_update") {
    const from = accountStatusText(before), to = accountStatusText(after);
    return from && to ? { facts: [{ key: "accountStatus", label: "账号状态", before: from, after: to }], forced: false } : null;
  }
  const withdrawal = withdrawalApprovalDomain(ticket);
  if (withdrawal === "D6") {
    const previous = fxApprovalValues(before), next = fxApprovalValues(after);
    const facts: WithdrawalProposalChanges["facts"] = [];
    for (const [key, label, unit] of FX_APPROVAL_FIELDS) {
      const from = fxApprovalNumber(previous[key]), to = fxApprovalNumber(next[key]);
      if (from === null || to === null) return null;
      if (from !== to) facts.push({ key, label, before: `${grouped(from)}${unit}`, after: `${grouped(to)}${unit}` });
    }
    return facts.length ? { facts, forced: false } : null;
  }
  if (withdrawal) return withdrawalProposalChanges(withdrawal, ticket);
}

/** amountKey：整张单是哪个字段（a2TicketKey），文字型前后值按它判断是不是金额。 */
export function changeSummary(before: string, after: string, omit: readonly string[] = [], operationCode?: string, amountKey?: string, withdrawalChanges?: WithdrawalProposalChanges | null, summaryLabels?: Record<string, string>) {
  if (withdrawalChanges === null) return { main: CHANGE_UNAVAILABLE };
  if (withdrawalChanges) {
    const { facts } = withdrawalChanges;
    const first = facts[0];
    return {
      main: `${first.label} ${first.after}${facts.length > 1 ? ` 等 ${facts.length} 项` : ""}${withdrawalChanges.forced ? " · 强制保存倒挂价" : ""}`,
      sub: `原 ${first.before}`,
      title: [...facts.map(({ label, before, after }) => `${label} ${before} → ${after}`), ...(withdrawalChanges.forced ? ["强制保存倒挂价"] : [])].join("\n"),
    };
  }
  const { b, a, labels: reviewLabels, evidenceKeys } = reviewPair(before, after, operationCode);
  const labels = summaryLabels ? { ...reviewLabels, ...summaryLabels } : reviewLabels;
  if (!a) return { main: "—", sub: b ? `原 ${b.kind === "text" ? a2Shown(amountKey, b.text) : "见详情"}` : undefined };
  if (a.kind === "text") {
    const [was, now] = a2Pair(amountKey, b?.kind === "text" ? b.text : undefined, a.text);
    return { main: now!, sub: b ? `原 ${b.kind === "text" ? was : "见详情"}` : "新建" };
  }
  if (a.kind === "rows") return { main: `共 ${a.rows.length} 行`, sub: b ? "原 见详情" : "新建" };
  if (a.value.clearMonthlyTarget === true) return {
    main: "关闭月收益目标",
    sub: a.value.shareYieldMin != null && a.value.shareYieldMax != null
      ? `年奖励率 ${valueText("shareYieldMin", a.value.shareYieldMin, labels)}–${valueText("shareYieldMax", a.value.shareYieldMax, labels)}`
      : `日产收益 ${a2Shown("dailyEarn", valueText("dailyEarn", a.value.dailyEarn, labels))}`,
  };
  const keys = Object.keys(a.value).filter((key) => !omit.includes(key) && !evidenceKeys.includes(key));
  const changed = b?.kind === "object" ? keys.filter((key) => !same(b.value[key], a.value[key])) : keys;
  const first = changed[0] ?? (isSkuReview(operationCode) ? undefined : keys[0]);
  if (!first) return { main: "—" };
  const now = a.value[first];
  const was = b?.kind === "object" ? b.value[first] : undefined;
  const pair = a2Pair(amountKey ?? first, valueText(first, was, labels), valueText(first, now, labels), [was, now]);
  const { label, before: wasShown, after: nowShown } = derivedBaseRateShown(first, labels[first] ?? first, was, now, !b, pair[0], pair[1]);
  const main = `${label} ${isRowList(now) ? `${now.length} ${ROW_UNIT[first] ?? "行"}` : nowShown}${changed.length > 1 ? ` 等 ${changed.length} 项` : ""}`;
  const sub = !b ? "新建" : b.kind === "object" && (first in b.value || typeof now === "boolean") && !isRowList(was) ? `原 ${wasShown}` : "原 见详情";
  const preserveText = ["name", "displayName", "reason", "remark", "description", "名称", "任务名称", "原因", "理由", "备注", "说明"].includes(first)
    || isSkuReview(operationCode) && (["skuId", "tagline", "badge", "specDocumentTitle"].includes(first) || first.startsWith("taglineTranslations."));
  if (summaryLabels && !preserveText && [wasShown, nowShown].some(value => value && !readableQueueChange(value))) return { main: SEE_APPROVAL_DETAIL };
  // E1's SKU identifier is the object itself when it is the field shown on the main line.
  const objectId = isSkuReview(operationCode) && first === "skuId" && typeof now === "string" ? now : undefined;
  return { main, sub, preserveText, objectId };
}

/** 设备审批只翻译后端给出的状态码；占位的原状态不能用设备当前状态补写。 */
function deviceApprovalValue(value: string, operationCode?: string) {
  if (!["e5_device_activate", "e5_device_force_activate", "e5_device_deactivate", "e5_device_unbind"].includes(operationCode ?? "")) return value;
  const states: Record<string, string> = { ACTIVATED: "ACTIVE", ACTIVE: "ACTIVE", ONLINE: "ONLINE", BUSY: "BUSY", RUNNING: "RUNNING", OFFLINE: "OFFLINE", INVENTORY: "INVENTORY", RECYCLED: "RECYCLED", DEACTIVATED: "DEACTIVATED", UNBOUND: "UNBOUND" };
  // 和设备管理页同一个叫法：INACTIVE 在「待激活」，SUSPENDED 是「已暂停」，RETIRED 是「已停用」下的「已退役」。
  if (value === "INACTIVE") return "待激活";
  if (value === "SUSPENDED") return "已暂停";
  if (value === "RETIRED") return "已停用（已退役）";
  const state = states[value];
  return state ? operatorDeviceStatus(state) : value;
}

/**
 * 大使申请单的变更前是后端拼的一句（类别代码、材料状态代码），只把两个代码换成页面上的叫法。
 * F5 奖励状态单的变更前是「以服务器执行时状态与版本为准」、变更后是英文状态：写成「冷却中 → 已解锁」；改之前能是几种状态的写「批准时的状态」。
 */
function i5MatrixVersionText(version: string, countries?: string[] | null) {
  return `${version || "未配置"} · ${countries?.join("、") || (countries ? "未配置" : "未提供")}`;
}

/**
 * A2 按金额写法显示的字段（白名单）。逐个提案来源核对过，清单和出处见 P1-a 报告；只有这些字段的值按金额写法显示：
 * - E1 商品快照（审批单冻结的商品前后值）：售价、月收益目标、日产收益；「收益说明」只在是系统按月收益目标折算的日收益时算（isA2Amount）。
 * - F 配置单的配置键：每组订单额门槛、各榜奖池、本周榜单奖池、上榜最低奖励（a2-f-config 里单位是 USDT 的项），团队激励池每月上限（校验和审批都按 USDT）。
 *   本周榜单奖池和每月上限可以写成 1.30K、2M：按 f4MonthlyCap 精确展开成完整金额再写「… USDT」，认不出的照原文。
 * - D1 共同充值规则这张单：后端描述器写「最低 20，手续费 0.600000，确认数 25」（不带币种，AuditReplayBusinessPermissionGuard），
 *   旧单是页面写的「最低 … USDT；手续费 … USDT；确认数 …；版本 …」。只认「最低」「手续费」两个值，按金额写法写并标 USDT；确认数、版本不动。
 * K1 人工放行的净额另由 k1Amount 按字段显示。其余字段、不认识的键、没有字段键的文字（文本型前后值、摘要句、标语、角标、话术、通知文案）一律照原文。
 */
const A2_AMOUNT_FIELDS = new Set(["price", "monthlyTargetUsdt", "dailyEarn", "F.binary.threshold", "F.pool.periodPrize", "F.leaderboard.poolUsd", "F.leaderboard.minUsd", "F.pool.monthlyCap", "d_cregis_deposit_policy"]);
const D1_POLICY_AMOUNT = /(^|[，；]\s*)(最低|手续费) ((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?: USDT)?(?=\s*(?:[，；]|$))/g;
const isA2Amount = (key: string | undefined, value?: unknown) => key !== undefined
  && (A2_AMOUNT_FIELDS.has(key) || key === "baseRate" && isRecord(value) && typeof value.derivedDaily === "string");
/**
 * 金额字段的值里完整的金额词元「数字 + 空格 + 币种」（USDT、UVT、USD、₫、VND；数字可带千分位、指数）按全站金额写法写，
 * 币种后面必须是词边界，也不能紧跟「/币种」（「1.00 USDT/UVT」「USD2」这类汇率、标识不算）。其余文字和不带币种的数字原样。
 */
const A2_AMOUNT = /(?<![\w.,])[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?(?=[ \u00a0](?:USDT|UVT|USD|VND|₫)(?![\w])(?!\/[A-Za-z₫]))/g;
/** 一个值给人看：是金额字段才按金额写法，否则照原文。原文照旧用于解析、匹配和有没有改的判断。 */
export const a2Shown = (key: string | undefined, text: string, value?: unknown) => {
  if (!isA2Amount(key, value)) return text;
  if (key === "d_cregis_deposit_policy") return text.replace(D1_POLICY_AMOUNT, (_, lead: string, label: string, amount: string) => `${lead}${label} ${amountDisplay(amount)} USDT`);
  if (key === "F.leaderboard.poolUsd" || key === "F.pool.monthlyCap") {
    const full = f4MonthlyCap(text.trim().replace(/\s*USDT$/i, ""));
    return full === null ? text : `${amountDisplay(full)} USDT`;
  }
  return text.replace(A2_AMOUNT, (amount) => amountDisplay(amount));
};
/**
 * 两张记录表（前、后）哪些格照原文写：同一行同一列原文不同、按字段写法显示后却一样（12.50 USDT 和 12.5 USDT）的格，两张都照原文写，别的格照常（RF01、BUG-638）。
 * 行数不同、对不上行时按整张表判断：原文不同、逐格显示后完全一样，两张整表照原文写。原文相同或只有一张表时都照常显示。
 */
export const rowsRawCells = (rows: unknown, other: unknown, labels: Record<string, string>): ((index: number, column: string) => boolean) | undefined => {
  if (!isRowList(rows) || !isRowList(other) || same(rows, other)) return undefined;
  const shown = (column: string, value: unknown) => a2Shown(column, valueText(column, value, labels), value);
  if (rows.length !== other.length) {
    const table = (list: Record<string, unknown>[]) => JSON.stringify(list.map((row) => Object.entries(row).map(([key, value]) => [key, shown(key, value)])));
    return table(rows) === table(other) ? () => true : undefined;
  }
  return (index, column) => !same(rows[index]?.[column], other[index]?.[column]) && shown(column, rows[index]?.[column]) === shown(column, other[index]?.[column]);
};
/** 一个字段的前后值一起显示：金额字段按金额写法；原文不同、写法改了以后一样时，两边都照原文写，不把真实的修改藏掉（OP-49/69）。raw 是两边的原值（判断「收益说明」是不是折算出的金额）。 */
export const a2Pair = (key: string | undefined, before: string | undefined, after: string | undefined, raw: [unknown, unknown] = [before, after]): [string | undefined, string | undefined] => {
  const shownBefore = before === undefined ? undefined : a2Shown(key, before, raw[0]), shownAfter = after === undefined ? undefined : a2Shown(key, after, raw[1]);
  return before !== after && shownBefore === shownAfter ? [before, after] : [shownBefore, shownAfter];
};
/** 整张单只改一个已知字段、前后值就是这个字段的文字时，这个字段的键：F 配置单是配置键，D1 共同充值规则是这张单的操作；其余没有。 */
export const a2TicketKey = (w: { operationCode?: string | null; obj?: string; after?: string; action?: string }) => {
  const fund = fundTicket(w);
  return fund?.kind === "fConfig" ? fund.key : w.operationCode === "d_cregis_deposit_policy" ? w.operationCode : undefined;
};

export const changeBefore = (row: { before: string; after?: string; obj?: string; action?: string; operationCode?: string; ambassadorMaterialProposal?: unknown; disclosureReview?: A2OperationRow["disclosureReview"] }) => {
  if (row.disclosureReview?.kind === "MATRIX") return i5MatrixVersionText(row.disclosureReview.expectedVersion, row.disclosureReview.originalCountryCodes);
  if (row.disclosureReview?.kind === "PUBLISH") return row.disclosureReview.previousVersion
    ?? (isFirstA2DisclosurePublish(row.disclosureReview) ? "无上一版" : "未提供");
  if (row.operationCode === "i5_disclosure_publish" || row.operationCode === "i4_disclosure_publish") return "未提供";
  const fund = fundTicket(row);
  if (fund?.kind === "f5Status") return F5_STATE_FROM[fund.state] ?? "批准时的状态";
  if (fund?.kind === "fConfig") return fConfigValue(fund.spec, row.before);
  if (fund?.kind === "f5Suspension") return fund.suspended ? "批准时的状态" : "暂停中";
  if (fund?.kind === "f5Reissue") return "";
  if (fund?.kind === "f5Reverse") return "批准时的状态";
  // 新建任务的变更前是「任务不存在：编号」：按新建显示，不画变更前。
  if (row.operationCode === "h3_mission_create" && row.after && h3MissionView({ operationCode: row.operationCode, after: row.after })) return "";
  if (row.operationCode === "h3_quest_config") return h3ConfigValue(row.obj, row.before);
  // 退款、取消、终止单发起时记的是订单状态码（activated）：写订单页同名的中文状态，前后同一种语言（TX-32，复审 V10）。
  if (["e4_order_refund", "e4_order_cancel", "e4_order_terminal"].includes(row.operationCode ?? "") && ORDER_STATES.includes(row.before)) return stateLabel(row.before);
  return deviceApprovalValue(changeBeforeText(row), row.operationCode);
};

/** F1 券冲正：申请时选的扣回或不扣回写在提案摘要开头；旧申请没写选择，后端按扣回执行。后果另起一行写在「批准后」。 */
export const f1VoucherReverse = (row: { after: string; action?: string; operationCode?: string; status?: A2OperationRow["status"] }) => {
  const prefix = "已冲正 · 券：";
  if (row.operationCode !== "f_reward_payout_action" || row.action !== "奖励发放 · 冲正 · 券" || !row.after.startsWith(prefix)) return undefined;
  const text = row.after.slice(prefix.length);
  const chosen = /^已用券(不)?扣回。/.exec(text);
  const submittedImpact = chosen ? text.slice(chosen[0].length) : text;
  return {
    choice: chosen ? chosen[1] ? "不扣回" : "扣回" : "按扣回执行（旧申请）",
    impact: row.status === "pending" ? (chosen?.[1] ? F1_VOUCHER_REVERSE_KEEP : F1_VOUCHER_REVERSE_CLAWBACK) : submittedImpact,
  };
};
export const changeAfter = (row: { after: string; obj?: string; action?: string; operationCode?: string; status?: A2OperationRow["status"]; disclosureReview?: A2OperationRow["disclosureReview"] }) => {
  if (row.disclosureReview?.kind === "MATRIX") return i5MatrixVersionText(row.disclosureReview.version, row.disclosureReview.targetCountryCodes);
  if (row.disclosureReview?.kind === "PUBLISH") return row.disclosureReview.version;
  const voucher = f1VoucherReverse(row);
  if (voucher) return `已冲正 · 已用券${voucher.choice}`;
  if (row.status === "pending" && row.operationCode === "f_reward_payout_action"
      && row.action === "奖励发放 · 重发 · 券" && row.after.startsWith("已重发 · 券：")) {
    return `已重发 · 券：${F1_VOUCHER_REISSUE}${F1_VOUCHER_REISSUE_UNAVAILABLE}`;
  }
  const fund = fundTicket(row);
  if (fund?.kind === "f5Status") return F5_STATE_NAME[fund.state] ?? row.after;
  if (fund?.kind === "fConfig") return fConfigValue(fund.spec, row.after);
  if (fund?.kind === "f5Suspension") return fund.suspended ? "暂停中" : "已恢复";
  if (fund?.kind === "f5Reissue") return `生成 ${fund.count ?? "—"} 条新记录`;
  const mission = h3MissionView({ operationCode: row.operationCode, after: row.after });
  if (mission) return JSON.stringify({ 任务名称: mission.name, 类型: mission.type, 奖励: mission.reward, 类别: mission.category, 去完成页面: mission.route, 建好后: "已停用，绑定完成条件后才能启用" });
  if (row.operationCode === "h3_quest_config") return h3ConfigValue(row.obj, row.after);
  return row.operationCode === "f5_commission_reverse" && row.after === "REVERSED" ? F5_STATE_NAME.reversed : deviceApprovalValue(row.after, row.operationCode);
};
const changeBeforeText = (row: { before: string; ambassadorMaterialProposal?: unknown }) => !row.ambassadorMaterialProposal ? row.before
  : row.before.replace(/^类别 ([a-z]+)；/, (_, code: string) => `类别 ${ambassadorBucketLabel(code)}；`)
    .replace(/；(NOT_SUBMITTED|PENDING|NEEDS_MORE|PASSED)$/, (_, state: string) => `；${ambassadorMaterialStateLabel(state)}`);

export const isRoleGrantsTicket = (w: { operationCode?: string }) => w.operationCode === "a6_role_grants_update";

/** 队列「变更」列：主行写增减了几项，副行写菜单或加上的前几项名称。 */
function roleGrantsSummary(review: A2RoleGrantsReview): { main: string; sub?: string; title: string } {
  const p = [review.permissionsAdded.length && `增加 ${review.permissionsAdded.length} 项权限`, review.permissionsRemoved.length && `去掉 ${review.permissionsRemoved.length} 项权限`].filter(Boolean) as string[];
  const m = [review.menusAdded.length && `增加 ${review.menusAdded.length} 个菜单`, review.menusRemoved.length && `去掉 ${review.menusRemoved.length} 个菜单`].filter(Boolean) as string[];
  if (!p.length && !m.length) return { main: "权限和菜单都没有增减", title: "权限和菜单都没有增减" };
  const added = review.permissionsAdded.map((item) => item.name ?? item.code);
  const names = added.length ? `加：${added.slice(0, 3).join("、")}${added.length > 3 ? " 等" : ""}` : undefined;
  const main = (p.length ? p : m).join("、");
  const sub = p.length && m.length ? m.join("、") : names;
  return { main, sub, title: [main, p.length && m.length ? m.join("、") : "", added.length ? `加：${added.join("、")}` : ""].filter(Boolean).join("\n") };
}

const ROLE_STATUS: Record<string, string> = { "1": "已启用", "0": "已停用", enabled: "已启用", disabled: "已停用" };
const ACCOUNT_STATE: Record<string, string> = { active: "正常", frozen: "冻结", restricted: "受限", banned: "封禁" };
const K1_CLUSTER_STATUS: Record<string, string> = { detected: "待判定", flagged: "可疑", frozen: "已冻结", released: "已解除", cleared: "正常" };
const TASK_STATUS: Record<string, string> = { ...ROLE_STATUS, active: "已启用", inactive: "已停用" };
const TASK_CHANGE_LABELS: Record<string, string> = {
  name: "任务名称", taskClass: "任务类型", selectionWeight: "权重", status: "状态",
  durationMinutes: "固定时长", baseReward: "每任务奖励", asset: "奖励资产", enabled: "状态",
};
const QUOTA_CHANGE_LABELS: Record<string, string> = {
  productNo: "商品", displayName: "名称", directRefs: "有效直接邀请（人）", monthComputePoints: "本月团队算力点",
  monthlyQuota: "每月名额（台）", unlockMode: "两项条件", status: "状态",
};
const QUOTA_UNLOCK_MODE: Record<string, string> = { ALL: "两项都要满足", EITHER: "满足一项就行" };
// 删除角色的 active 表示未删除，启停是另一项状态。
const ROLE_DELETE_STATUS: Record<string, string> = { active: "未删除", deleted: "已删除" };

const knownValue = (names: Record<string, string> | undefined, value: string) =>
  names && Object.hasOwn(names, value) ? names[value] : value;

function approvalChangeValue(ticket: A2OperationRow, text: string) {
  const operation = ticket.operationCode;
  if (operation === "a1_account_change_role" || operation === "a1_account_create") {
    const role = (code: string) => roleLabel(code === "super" ? "superadmin" : normalizeSessionRole(code));
    if (operation === "a1_account_change_role") return role(text);
    return text.replace(/(角色[：: ]\s*)([A-Za-z][\w-]*)/g, (_, label: string, code: string) => `${label}${role(code)}`);
  }
  const names = operation === "a6_role_status_update" || operation === "a6_role_disable" ? ROLE_STATUS
    : operation === "a6_role_delete" ? ROLE_DELETE_STATUS
    : operation === "c2_account_freeze" || operation === "c2_account_unfreeze" ? ACCOUNT_STATE
    : operation?.startsWith("k1_cluster_") ? K1_CLUSTER_STATUS
    : operation === "e2_task_status" ? TASK_STATUS : undefined;
  const shown = knownValue(names, text.toLowerCase());
  return names && shown !== text.toLowerCase() ? shown : text;
}

export function approvalReviewValues(ticket: A2OperationRow) {
  return {
    before: approvalChangeValue(ticket, changeBefore(ticket)),
    after: approvalChangeValue(ticket, changeAfter(ticket)),
    withdrawalChanges: approvalDisplayChanges(ticket),
  };
}

function structuredQueueValue(text: string, flattenSimulation: boolean, valueNames: Record<string, Record<string, string>>) {
  const parsed = parseReview(text);
  if (parsed?.kind !== "object") return text;
  const { simulation, ...fields } = parsed.value;
  if (flattenSimulation && isRecord(simulation)) Object.assign(fields, simulation);
  else if (simulation !== undefined) fields.simulation = simulation;
  return JSON.stringify(Object.fromEntries(Object.entries(fields).map(([key, value]) => {
    if (key === "enabled" && typeof value === "boolean") return [key, value ? "已启用" : "已停用"];
    const shown = knownValue(valueNames[key], String(value));
    return [key, shown === String(value) ? value : shown];
  })));
}

function weeklyRegionChange(ticket: A2OperationRow) {
  const read = (text: string) => {
    const parsed = parseReview(text);
    if (parsed?.kind !== "object" || !Array.isArray(parsed.value.mappings) || typeof parsed.value.defaultZoneId !== "string") return;
    if (!h3WeeklyZoneLabel(parsed.value.defaultZoneId)) return;
    const byCode = new Map<string, string>();
    for (const row of parsed.value.mappings) {
      if (!isRecord(row) || typeof row.callingCode !== "string" || !/^\+\d+$/.test(row.callingCode) || typeof row.zoneId !== "string") return;
      const zone = h3WeeklyZoneLabel(row.zoneId);
      if (!zone) return;
      byCode.set(row.callingCode, zone);
    }
    return byCode;
  };
  const before = read(ticket.before);
  const after = read(ticket.after);
  if (!before || !after) return;
  const changed = [...new Set([...after.keys(), ...before.keys()])].filter(code => before.get(code) !== after.get(code));
  const code = changed[0];
  if (!code) return;
  return {
    main: `区号 ${code} · ${after.get(code) ?? "未设置"}${changed.length > 1 ? ` 等 ${changed.length} 项` : ""}`,
    sub: `原 ${before.get(code) ?? "未设置"}`,
  };
}

type QueueChange = { main: string; sub?: string; title?: string; objectId?: string };

function queueChange(ticket: A2OperationRow): (QueueChange & { preserveText?: boolean }) | undefined {
  const mission = h3MissionView(ticket);
  if (mission) return { main: `${mission.name} · 奖励 ${mission.reward}`, sub: "新建", preserveText: true };
  if (ticket.operationCode === "h3_weekly_region_policy") return weeklyRegionChange(ticket);
  const boot = ticket.operationCode === "f_unilevel_bootstrap" ? parseF2BootstrapAfter(ticket.after) : undefined;
  if (boot) return { main: f2BootstrapUsesRank(boot[0].usdtPct, boot[1].usdtPct) ? "第 1、2 层按受益人等级" : `L1–L7 合计占订单 ${f2PctSum(boot.map(row => row.usdtPct))}%`, sub: "首次配置，原来没有规则" };
  const k1 = k1TicketView(ticket);
  if (k1) return k1ChangeCell(k1);
  const batch = fBatchTicket(ticket);
  if (batch?.items) return fBatchCell(batch.items, batch.count);
  if (isRoleGrantsTicket(ticket)) return ticket.roleGrantsReview ? roleGrantsSummary(ticket.roleGrantsReview) : undefined;

  const fund = fundTicket(ticket);
  if (isV8PromotionTicket(ticket) || fund?.kind === "f5Status" || fund?.kind === "f5Reissue" || fund?.kind === "f5Reverse") return;

  let { before, after, withdrawalChanges } = approvalReviewValues(ticket);
  let labels: Record<string, string> = {};
  const omit = g3PolicyExecutionTiming(ticket) ? ["生效时间"] : [];
  if (ticket.operationCode === "f4_quota_tier_create") {
    labels = QUOTA_CHANGE_LABELS;
    after = structuredQueueValue(after, false, { status: ROLE_STATUS, unlockMode: QUOTA_UNLOCK_MODE });
    omit.push("quotaCode", "sortOrder");
  } else if (["e2_task_create", "e2_task_update", "e2_task_status"].includes(ticket.operationCode ?? "")) {
    labels = TASK_CHANGE_LABELS;
    const values = { status: TASK_STATUS, taskClass: TASK_CLASS_LABELS };
    before = structuredQueueValue(before, true, values);
    after = structuredQueueValue(after, true, values);
    omit.push("expectedVersion");
  }
  return changeSummary(before, after, omit, reviewOperation(ticket), a2TicketKey(ticket), withdrawalChanges, labels);
}

const MACHINE_CHANGE = /^\s*[\[{]|\b[A-Za-z][\w.]*\s*=|\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b|\b[a-z][a-z\d]*[A-Z][A-Za-z\d]*\b/;
const BARE_ENUM = /^(?:enabled|disabled|active|inactive|deleted|true|false|null)$/i;

function readableQueueChange(text: string) {
  const value = text.replace(/^原 /, "").trim();
  return !MACHINE_CHANGE.test(value) && !value.split(/ · | → |[：；]/).some(part => BARE_ENUM.test(part.trim()));
}

export function approvalQueueChange(ticket: A2OperationRow): QueueChange {
  const change = queueChange(ticket);
  if (!change || change.main === "—" || change.main === CHANGE_UNAVAILABLE) {
    const reason = ticket.reason.trim();
    return { main: reason && reason !== "—" && !parseReview(ticket.before) && !parseReview(ticket.after) ? reason : SEE_APPROVAL_DETAIL };
  }
  const { main, sub, title, preserveText, objectId } = change;
  if (!preserveText && (!readableQueueChange(main) || sub && !readableQueueChange(sub))) return { main: SEE_APPROVAL_DETAIL };
  return { main, sub, objectId, title: preserveText || title?.split("\n").every(readableQueueChange) ? title : undefined };
}
