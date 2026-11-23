/**
 * USDT 提现参数的配置项说明（CP-87、CP-88，TX-36）。按字段取，内容来自后端和 App 代码，
 * 出处登记在 D5 重构说明的「后端事实」「App 事实」；写不准的不写（DP-33）。
 * App 和 H5 Lite 的提现页是同一份，这里写「App」的两边一样。
 */

export interface D5ParamHelp {
  label: string;
  /** 这是什么，不超过 25 字。 */
  what: string;
  /** 什么时候生效，写实际路径。 */
  when: string;
  /** 怎么填：单位和范围，写在抽屉的字段下面。 */
  how?: string;
  /** 改了会怎样，静态的一句，放提示图标。 */
  effect?: string;
  /** 显示位置，只写核对过的。 */
  where?: string;
  /** 别的要说明的事，比如这项的限制。 */
  note?: string;
}

const NEW_ONLY = "调低立即生效，调高批准后生效；只影响新提现";
const PHASE = "跟随「运营阶段设置」";

export const D5_PARAM_HELP = {
  dailyLimitCount: {
    label: "每日提现次数",
    what: "一个用户一天最多发起几笔提现",
    when: "调低立即生效，调高批准后生效；下一笔提现起按新值",
    how: "整数，1–10 次",
    effect: "改成 3：用户当天第 4 笔被拦下。USDT 和越南盾合算，越南时间 0 点重算。调低后，当天超出新次数、还没放行的单放行时也被拦",
    where: "App 提现页「今日已用 N 笔，剩余 N 笔（每日 N 笔）」；越南盾提现页「今日剩余 N 次 / 每日 N 次」",
  },
  maxBalanceRatio: {
    label: "余额可提上限",
    what: "一笔最多提可提余额的多少",
    when: "调低立即生效，调高批准后生效；下一笔提现起按新值",
    how: "50%–100%",
    effect: "改成 90%：可提余额 1,000 USDT 时，一笔最多提 900 USDT。越南盾提现同样受限",
    where: "App 提现页「可提现」金额；低于 100% 时多一行「余额中 N 暂不可提」",
  },
  smallAmountThresholdUsd: {
    label: "小额免审线",
    what: "不超过这条线的低风险 USDT 提现可以自动过审",
    when: NEW_ONLY,
    how: "0–500 USDT，0 表示关闭",
    effect: "改成 100：100 USDT 及以下、风险低、风控通过、没到提现强审门槛的 USDT 提现自动过审，超过的进人工审核。设成 0 关闭",
    note: "加强合规审查开着时不走这条线。越南盾提现只在到账审查窗口是 0 天时用这条线",
    where: "用户看不到，只影响新提现走不走人工审核",
  },
  payoutSlaHours: {
    label: "到账时效",
    what: "审查窗口结束后，打款排队用的时限",
    when: "调长立即生效，缩短批准后生效；只影响新提现",
    how: "整数，1–168 小时",
    effect: "改成 12：新提现的截止时间是审查窗口结束后 12 小时，打款按截止时间排先后。没有超时提醒",
    where: "App 提现进度页的「预计处理时刻」就是这个截止时间（审查窗口结束时间加这个时效）",
  },
  networkEnabled: {
    label: "提现网络",
    what: "这个网络能不能发起 USDT 提现",
    when: "关闭立即生效，开启批准后生效",
    effect: "关掉后用户不能再用这个网络提现。接打款服务时，这个网络上还没交给打款服务的提现暂停打款，已交给的继续跟进",
    where: "App「选择提现网络」页的网络卡片；全部关闭时写「提现通道暂不可用，请稍后再试。」",
    note: "开启只是配置，用户能不能用看这一行写的实际状态，和 App 提现同一个判断",
  },
  networkConfirmFeeUsd: {
    label: "网络确认费",
    what: "每笔提现按网络收的固定费用",
    when: "调高立即生效，调低批准后生效；只影响新提现",
    how: "0–25 USDT，每档 0.5，三个网络一起保存",
    effect: "改成 BEP20 2 USDT：之后走 BEP20 的提现每笔收 2 USDT。设为 0 不收费。任一网络调低，三个一起走审批。TRC20 通道暂未开放，不能改",
    where: "App「选择提现网络」页每个网络卡片上的网络费；提现页「网络确认费」这一行",
  },
  nexFeeOffsetRate: {
    label: "UVT 抵扣率",
    what: "1 UVT 能抵多少 USDT 手续费",
    when: "调低立即生效，调高批准后生效；只影响新提现",
    how: "最小 0.000001",
    effect: "改成 0.5：1 USDT 手续费要 2 UVT 抵满",
    where: "App 提现页「用 UVT 抵扣」开关下的消耗数量",
  },
  currentPhase: {
    label: "当前运营阶段",
    what: "现在处在哪个运营阶段",
    when: PHASE,
  },
  cooldownDays: {
    label: "到账审查窗口",
    what: "提现从提交起要等多少天才能放行",
    when: `${PHASE}，新提现提交和放行前按规则核对`,
    where: "App 提现进度页的「预计处理时刻」从窗口结束时间起算",
    note: "越南盾提现每笔都等；USDT 只在加强合规审查开着、超过合规大额线时等；风控延迟、冻结的也按它算。0 天不等",
  },
  complianceHoldEnabled: {
    label: "加强合规审查",
    what: "开着时三个网络的 USDT 提现都进人工审核",
    when: PHASE,
    where: "App 提现页「提现合规复核」提示",
    note: "开着时三个网络都不走小额自动过审，超过合规大额线的还要等到账审查窗口结束；关着时按小额免审线和风控判断",
  },
  complianceReviewThresholdUsdt: {
    label: "合规大额线",
    what: "加强合规审查开着时，超过这条线的要多等",
    when: "系统固定的合规规则，这页和运营阶段设置都改不了",
    note: "单笔超过这个金额才算大额，正好等于不算",
  },
  networkRules: {
    label: "现在怎么审",
    what: "按现在的阶段设置，新提现怎么审",
    when: PHASE,
    note: "还没打款的提现也按现在的规则重新核对。到期或批准不等于到账：要人工复核的仍要有人放行，链上确认后才算到账",
  },
} satisfies Record<string, D5ParamHelp>;

/**
 * 网络开着、用户却用不了的原因（后端 networkStatus.disabledReason）。
 * 来源：WithdrawalNetworkPolicy.statuses 和 CregisPayoutControl.capability，App 提现用同一个判断。
 * global：出款服务整体的原因，开着的网络会一起用不了，合成一句话说。
 */
export const D5_NETWORK_BLOCK_REASON: Record<string, { text: string; global?: true }> = {
  NOT_CONFIGURED: { text: "出款服务没有接通，请技术值班核对", global: true },
  SWITCH_OFF: { text: "「充值与收款对账」里的全局出款总闸关着", global: true },
  RISK_HOLD: { text: "有资金风险没处理完，出款暂停", global: true },
  RECONCILIATION_REQUIRED: { text: "最近没有完成一次完整对账" },
  NETWORK_UNSUPPORTED: { text: "打款服务不支持这个网络" },
  PAYOUT_ASSET_UNAVAILABLE: { text: "打款服务没开通这个网络的出款" },
  PROVIDER_CAPABILITY_UNAVAILABLE: { text: "暂时查不到打款服务开通了哪些网络" },
  NETWORK_STATUS_UNAVAILABLE: { text: "网络实际状态暂时读不到" },
  WITHDRAWAL_KILL_SWITCH_UNAVAILABLE: { text: "「紧急停用开关」的提现开关状态暂时读不到" },
  WITHDRAWAL_KILL_SWITCH_DISABLED: { text: "「紧急停用开关」的提现开关关着", global: true },
  CHAIN_PROOF_UNAVAILABLE: { text: "TRON 节点读不到，链上确认核不了" },
};
export const D5_NETWORK_BLOCK_UNKNOWN = "原因暂时读不到，到「充值与收款对账」核对";
/** 「紧急停用开关」的提现开关关着：App 一个网络都不显示（AppWithdrawalService.withdrawGateEnabled）。 */
export const D5_WITHDRAW_SWITCH_OFF = "「紧急停用开关」的提现开关关着";
