/**
 * E6 算力与设备配置 — 平台开关 / 在线系数 / 电脑显卡映射 / 下载内容(mock,backend-replaceable)。
 *
 * 三端改造 SPEC-0「前后端一致脊柱」:本寄存器与 uniapp 端结构对齐 ——
 *   - uniapp:`src/store/config-types.ts`(FeatureFlagKey / FeatureFlags)+ `src/store/config.ts`(useConfig.isEnabled)
 *     + `src/mock/platform-config.ts`(DEFAULT_PLATFORM_CONFIG.featureFlags)。
 *   - admin:后台改 flag → setParam(`E.compute.<key>`, "on"|"off") + A2 审计;读 flag 走 pget 派生。
 * DR-7:本期 admin 改 flag 与 uniapp 读 flag 各自 mock,结构一致即可,不真打通后端。
 *
 * PROD(真后端替换点,结构 1:1 映射):
 *   - 读:GET  /api/admin/config/feature-flags        → { key: ComputeFlagKey; enabled: boolean }[]
 *   - 改:PATCH /api/admin/config/feature-flags/:key   body { enabled: boolean; reason: string }(Idempotency-Key 幂等)
 */

// 平台 feature flag 唯一 id —— 与 uniapp `FeatureFlagKey` 同名,跨端一致(单一标识)。
export type ComputeFlagKey = "computeShareEnabled";

export interface ComputeFlagDef {
  key: ComputeFlagKey;      // 跨端一致的 flag 唯一 id
  label: string;            // 运营可读中文名(运营面主标)
  desc: string;             // 用途说明(运营面)
  defaultOn: boolean;       // 默认态 —— 须与 uniapp DEFAULT_PLATFORM_CONFIG.featureFlags 对齐
  frontendEffect: string;   // 开启对用户端的影响(确认弹窗 + 脚注引用)
}

// flag 寄存器:SPEC-0 仅 1 个示范 flag;后续 SPEC 按需在此追加(单一来源,视图派生不另列)。
export const COMPUTE_FLAGS: ComputeFlagDef[] = [
  {
    key: "computeShareEnabled",
    label: "电脑共享算力入口",
    // 对齐 uniapp DEFAULT_PLATFORM_CONFIG.featureFlags.computeShareEnabled = false(DR-1 默认 OFF)。
    defaultOn: false,
    desc: "控制客户端『电脑共享算力』PC 弱入口与下载页的显隐。",
    frontendEffect: "开启后客户端显现电脑算力 PC 入口与下载页;关闭则隐藏。",
  },
];

// admin params 存储键前缀(E 域 feature-flag 命名空间;与 E.gen.* / E.device.* / E.tradein.* 不冲突)。
export const COMPUTE_PARAM_PREFIX = "E.compute.";
export const computeFlagParamKey = (key: ComputeFlagKey): string => `${COMPUTE_PARAM_PREFIX}${key}`;

// ── SPEC-1 在线加成系数(载体在线分层 · 数值参数)──────────────────────────
// 运营在 E6 调的数值系数(非布尔开关)。与 uniapp PlatformConfig.onlineBonus 同 key
// (h5BaseFactor / continuityFullHours),共用 E.compute.* 前缀。DR-7:各端各自 mock,
// 结构/键一致即可,PROD 服务端下发;改值走 setParam → A2 审计。
export interface ComputeCoefficientDef {
  key: "h5BaseFactor" | "continuityFullHours";
  label: string; // 运营可读中文
  defaultVal: number; // 对齐 uniapp DEFAULT_PLATFORM_CONFIG.onlineBonus
  unit: string; // 单位 / 取值范围
  placeholder: string; // 输入示例
  desc: string; // 用途
  frontendEffect: string; // 改后用户端效果
}

export const COMPUTE_COEFFICIENTS: ComputeCoefficientDef[] = [
  {
    key: "h5BaseFactor",
    label: "H5 基础托管系数",
    defaultVal: 0.6,
    unit: "× 基线 · 取值 0–1",
    placeholder: "0.6",
    desc: "H5(网页非常驻载体)按基准产出 × 此系数计算基础托管产出,不叠加充电 / 散热 / 连续在线在线加成。",
    frontendEffect: "调高=H5 基础托管产出更高(与 App 差距缩小);调低=放大 App 在线加成优势,强化「升级 App」转化。",
  },
  {
    key: "continuityFullHours",
    label: "连续在线满额时长",
    defaultVal: 2,
    unit: "小时",
    placeholder: "2",
    desc: "App 载体连续在线达此时长后,稳定性加成因子升至满额 1.0(此前自 0.85 线性爬升)。",
    frontendEffect: "调短=用户更快拿到满额在线加成;调长=需更久连续在线才满额,强化持续在线激励。",
  },
];

export type ComputeCoefficientKey = ComputeCoefficientDef["key"];
export const computeCoeffParamKey = (key: ComputeCoefficientKey): string => `${COMPUTE_PARAM_PREFIX}${key}`;

// ── E6 收益估算系数(mock seed,backend-replaceable)────────────────────────
// PROD 替换点:
//   - 读:GET  /api/admin/config/compute-share/yield-estimate
//   - 改:PATCH /api/admin/config/compute-share/yield-estimate/:key body { value: number; reason: string }
export interface ComputeYieldEstimateDef {
  key: "topsBaseline" | "dailyUsdtPerBaseline" | "nexPerUsdt";
  label: string;
  defaultVal: number;
  unit: string;
}

export const COMPUTE_YIELD_ESTIMATE: ComputeYieldEstimateDef[] = [
  { key: "topsBaseline", label: "收益估算基准算力", defaultVal: 28, unit: "TOPS" },
  { key: "dailyUsdtPerBaseline", label: "基准日产 USDT", defaultVal: 0.06, unit: "USDT / 日" },
  { key: "nexPerUsdt", label: "NEX 折算系数", defaultVal: 166.67, unit: "NEX / USDT" },
];

export type ComputeYieldEstimateKey = ComputeYieldEstimateDef["key"];
export const computeYieldEstimateParamKey = (key: ComputeYieldEstimateKey): string =>
  `${COMPUTE_PARAM_PREFIX}yieldEstimate.${key}`;

// ── SPEC-7 风险簇收益释放参数(mock seed,backend-replaceable)──────────────
// K1 是风险簇权威;这里先提供 admin mock 参数寄存器,后续 P5 接入 K1/E6 UI。
// PROD 替换点:
//   - 读:GET  /api/admin/risk-cluster/config
//   - 改:PATCH /api/admin/risk-cluster/config/:key body { value: number; reason: string }
// 参数控件类型: number=数值输入;boolean=开关;enum=可选值(options 提供)。
export type RiskParamKind = "number" | "boolean" | "enum";

export interface RiskClusterParamDef {
  key:
    | "freePhoneSlotsPerCluster"
    | "duplicateAccountPendingFrom"
    | "duplicateAccountFreezeFrom"
    | "pendingReleaseHours"
    | "appAttestationReleaseHours"
    | "maxSignupPerIp24h"
    | "maxAccountsPerDevice"
    | "maxAccountsPerPaymentInstrument"
    | "clusterFreezeSuggestThreshold"
    | "releaseMode"
    | "freeSlotRequiresBinding";
  label: string;
  kind: RiskParamKind;
  defaultVal: number | string | boolean;
  options?: string[];
  unit: string;
  desc: string;
  frontendEffect: string;
}

export const RISK_CLUSTER_PARAM_PREFIX = "K.riskCluster.";

export const RISK_CLUSTER_PARAMS: RiskClusterParamDef[] = [
  {
    key: "freePhoneSlotsPerCluster",
    label: "同簇正常释放手机槽",
    kind: "number",
    defaultVal: 1,
    unit: "个",
    desc: "每个风险簇默认可正常释放收益的 H5 手机槽位数;也是同簇释放窗口内的熔断上限。",
    frontendEffect: "超过该槽位的账号收益进入审核中或锁定奖励;窗口内释放账户数达线后,后续待审收益升为锁定。",
  },
  {
    key: "duplicateAccountPendingFrom",
    label: "重复账号待审起点",
    kind: "number",
    defaultVal: 2,
    unit: "第 N 个账号",
    desc: "同簇第 N 个账号起,托管收益进入审核中。",
    frontendEffect: "调低=更早进入待审;调高=放宽多号释放。",
  },
  {
    key: "duplicateAccountFreezeFrom",
    label: "重复账号冻结建议线",
    kind: "number",
    defaultVal: 4,
    unit: "第 N 个账号",
    desc: "同簇第 N 个账号起,建议 K1 标记或冻结。",
    frontendEffect: "影响注册后收益释放和提现路由。",
  },
  {
    key: "pendingReleaseHours",
    label: "待审收益观察窗口",
    kind: "number",
    defaultVal: 72,
    unit: "小时",
    desc: "待审收益的观察与熔断统计窗口。窗口到达不会自动放行——释放只认 App 在线证明达标或人工放行。",
    frontendEffect: "只影响同簇熔断统计与运营口径,不是自动放行倒计时。",
  },
  {
    key: "appAttestationReleaseHours",
    label: "App 在线证明时长",
    kind: "number",
    defaultVal: 2,
    unit: "小时",
    desc: "账号 App 连续在线累计达该时长后,具备释放待审/锁定收益的资格。",
    frontendEffect: "释放的两个来源之一(另一为人工放行);也强化 H5 升级 App 的转化钩子。",
  },
  {
    key: "maxSignupPerIp24h",
    label: "同 IP 24h 注册上限",
    kind: "number",
    defaultVal: 3,
    unit: "个号",
    desc: "同一 IP 桶 24 小时内可注册账号数。",
    frontendEffect: "超过后注册进入人工或拒绝路线,不创建账号。",
  },
  {
    key: "maxAccountsPerDevice",
    label: "同设备账号上限",
    kind: "number",
    defaultVal: 2,
    unit: "个号",
    desc: "同一服务端设备标识允许绑定的账号数。",
    frontendEffect: "超过后新人礼和托管收益进入待审/锁定。",
  },
  {
    key: "maxAccountsPerPaymentInstrument",
    label: "同收款工具账号上限",
    kind: "number",
    defaultVal: 1,
    unit: "个号",
    desc: "同一提现地址或支付工具允许关联的账号数。",
    frontendEffect: "超过后提现进入人工或冻结路由。",
  },
  {
    key: "clusterFreezeSuggestThreshold",
    label: "风险簇冻结建议强度",
    kind: "number",
    defaultVal: 0.82,
    unit: "0-1",
    desc: "K1 聚簇加权分达到该值后建议冻结;提现侧达线即升人工分诊。",
    frontendEffect: "影响 K1 标记建议和 K3 提现路由。",
  },
  {
    key: "releaseMode",
    label: "待审收益释放模式",
    kind: "enum",
    defaultVal: "attest_or_manual",
    options: ["attest_or_manual", "manual_only"],
    unit: "模式",
    desc: "待审收益的放行来源。没有「到时自动放行」选项:要么 App 在线证明达标,要么人工放行;manual_only 时仅人工。",
    frontendEffect: "决定前端待审收益能否由在线证明解锁。",
  },
  {
    key: "freeSlotRequiresBinding",
    label: "首号免费槽需绑定",
    kind: "boolean",
    defaultVal: true,
    unit: "开关",
    desc: "开启后,纯裸号(无支付工具/无推荐关系/无 App 在线证明)的首号收益也先进审核中,完成任一有效绑定后才正常释放。",
    frontendEffect: "堵「批量裸号吃首槽」;关闭则首号收益直接可提。",
  },
];

export type RiskClusterParamKey = RiskClusterParamDef["key"];
export const riskClusterParamKey = (key: RiskClusterParamKey): string =>
  `${RISK_CLUSTER_PARAM_PREFIX}${key}`;

// ── SPEC-7 提现前置风控参数(mock seed,backend-replaceable)──────────────
// K3 是提现路由权威;这里先提供 admin mock 参数寄存器,后续 P5 接入 K3/D2 UI。
// PROD 替换点:
//   - 读:GET  /api/admin/withdraw-rules/config
//   - 改:PATCH /api/admin/withdraw-rules/config/:key body { value: number|string; reason: string }
export type WithdrawRouteSeed = "pass" | "delay" | "manual" | "freeze" | "reject";

export interface WithdrawRuleParamDef {
  key: "minWithdrawableUsdt" | "sameAddressRoute" | "firstWithdrawalManual" | "newAddressHoldHours";
  label: string;
  kind: RiskParamKind;
  defaultVal: number | boolean | WithdrawRouteSeed;
  options?: string[];
  unit: string;
  desc: string;
  frontendEffect: string;
}

export const WITHDRAW_RULE_PARAM_PREFIX = "K.withdrawRules.";

export const WITHDRAW_RULE_PARAMS: WithdrawRuleParamDef[] = [
  {
    key: "minWithdrawableUsdt",
    label: "最低可提现金额",
    kind: "number",
    defaultVal: 20,
    unit: "USDT",
    desc: "提现页允许提交的最小可提现金额。",
    frontendEffect: "低于该值时提现按钮不可提交,Use Max 仍只填可提现余额。",
  },
  {
    key: "sameAddressRoute",
    label: "同地址多账号路由",
    kind: "enum",
    defaultVal: "manual",
    options: ["pass", "delay", "manual", "freeze", "reject"],
    unit: "路由",
    desc: "同一收款地址被多个账号使用时,K3 返回的提现前置路由。",
    frontendEffect: "命中后提现进入人工/延迟/冻结/拒绝,不会由客户端自动推进为已打款。",
  },
  {
    key: "firstWithdrawalManual",
    label: "新号首提必人工",
    kind: "boolean",
    defaultVal: true,
    unit: "开关",
    desc: "账户首次提现无条件进入人工审核队列,无论其它风控信号如何(冷启动保守,兜「每号换设备+换地址」的分散薅)。",
    frontendEffect: "首笔提现固定进入审核中,不能直达打款。",
  },
  {
    key: "newAddressHoldHours",
    label: "新提现地址延迟时长",
    kind: "number",
    defaultVal: 24,
    unit: "小时",
    desc: "提现地址首次绑定后 N 小时内的提现走延迟/人工路由(防临提现才换全新地址)。",
    frontendEffect: "新绑地址的提现进入延迟处理,不即时放行。",
  },
];

export type WithdrawRuleParamKey = WithdrawRuleParamDef["key"];
export const withdrawRuleParamKey = (key: WithdrawRuleParamKey): string =>
  `${WITHDRAW_RULE_PARAM_PREFIX}${key}`;

// ── SPEC-7 新人礼发放配置(mock seed,backend-replaceable)────────────────
// K2/营销配置权威;uniapp config-types.ts RewardsConfig 同构(lockMode/usdtAmount/nexAmount)。
// PROD 替换点: PATCH /api/admin/rewards/welcome-gift/config { lockMode, usdtAmount, nexAmount, reason }
export interface RewardRiskParamDef {
  key: "lockMode" | "usdtAmount" | "nexAmount";
  label: string;
  kind: RiskParamKind;
  defaultVal: string | number;
  options?: string[];
  unit: string;
  desc: string;
  frontendEffect: string;
}

export const REWARD_RISK_PARAM_PREFIX = "K.rewards.welcomeGift.";

export const REWARD_RISK_PARAMS: RewardRiskParamDef[] = [
  {
    key: "lockMode",
    label: "新人礼发放模式",
    kind: "enum",
    defaultVal: "risk_bucket",
    options: ["risk_bucket", "direct"],
    unit: "模式",
    desc: "risk_bucket = 新人礼按账户当前风险桶发放(同簇多号进待审/锁定);direct = 直接入可提余额(演示/活动期开闸)。",
    frontendEffect: "决定注册赠金能否直达可提余额。",
  },
  {
    key: "usdtAmount",
    label: "新人礼 USDT 金额",
    kind: "number",
    defaultVal: 5,
    unit: "USDT",
    desc: "注册礼包的 USDT 部分,邀请落地页/注册页展示与实际入账同源。",
    frontendEffect: "调高 = 放大获客成本流出,先核 B1 覆盖率。",
  },
  {
    key: "nexAmount",
    label: "新人礼 NEX 数量",
    kind: "number",
    defaultVal: 20,
    unit: "NEX",
    desc: "注册礼包的 NEX 部分(原 200 ≈ 免费 $2000 提现抵扣额度,过松,已收紧为 20)。",
    frontendEffect: "随发放模式进桶;调高同样先核 B1 覆盖率。",
  },
];

export const rewardRiskParamKey = (key: RewardRiskParamDef["key"]): string =>
  `${REWARD_RISK_PARAM_PREFIX}${key}`;

// ── FEAT-AUTH01 短信验证码闸门参数(mock seed,backend-replaceable)────────
// K2 风控配置权威;uniapp config-types.ts OtpGateConfig 同构(五键同名)。
// PROD 替换点: PATCH /api/admin/otp-gate/config { <key>: value, reason }
export interface OtpGateParamDef {
  key: "resendSeconds" | "captchaAfterSends" | "otpTtlSeconds" | "maxVerifyAttempts" | "captchaTicketTtlSeconds";
  label: string;
  kind: "number";
  defaultVal: number;
  unit: string;
  min: number;
  desc: string;
  frontendEffect: string;
}

export const OTP_GATE_PARAM_PREFIX = "K.otpGate.";

export const OTP_GATE_PARAMS: OtpGateParamDef[] = [
  {
    key: "resendSeconds",
    label: "验证码重发冷却",
    kind: "number",
    defaultVal: 60,
    unit: "秒",
    min: 0,
    desc: "同一手机号两次发送的最小间隔;客户端倒计时与服务端限频同源,冷却内的请求直接拒绝且不生成新码。",
    frontendEffect: "调短 = 放宽发送频率,短信轰炸面变大。",
  },
  {
    key: "captchaAfterSends",
    label: "滑块验证触发次数",
    kind: "number",
    defaultVal: 2,
    unit: "次/24h",
    min: 0,
    desc: "24h 滑动窗内成功发送达此值后,下一次发送需先通过滑块人机验证(默认 2 = 第 3 次起拦)。",
    frontendEffect: "调 0 = 每次发送都要滑块;调高 = 机器批量收码窗口变大。",
  },
  {
    key: "otpTtlSeconds",
    label: "验证码有效期",
    kind: "number",
    defaultVal: 300,
    unit: "秒",
    min: 60,
    desc: "验证码签发后的服务端有效时长,过期须重新获取;同一手机号同时仅一个有效码,新发自动作废旧码。",
    frontendEffect: "过长增加被截获重放的窗口,过短误伤慢网络用户。",
  },
  {
    key: "maxVerifyAttempts",
    label: "验证码输错上限",
    kind: "number",
    defaultVal: 5,
    unit: "次",
    min: 1,
    desc: "单个验证码允许的连续输错次数,用尽即作废,须重新获取。",
    frontendEffect: "调低 = 防爆破更严;调高 = 对手滑用户更宽容。",
  },
  {
    key: "captchaTicketTtlSeconds",
    label: "滑块通过票据有效期",
    kind: "number",
    defaultVal: 120,
    unit: "秒",
    min: 30,
    desc: "滑块验证通过后签发的一次性放行票据有效窗;必须显式随发送提交,用一次即失效,禁止复用。",
    frontendEffect: "过长 = 滞留票据风险变大;过短 = 用户须频繁重验。",
  },
];

export const otpGateParamKey = (key: OtpGateParamDef["key"]): string =>
  `${OTP_GATE_PARAM_PREFIX}${key}`;

// ── SPEC-7 §5b K1 聚簇维度权重(K4 评分权威可配)──────────────────────────
// uniapp config-types.ts RiskScoreConfig.dimensionWeights 同构;mock K4 分 =
// 命中维度权重和(cap 1)。强维任一命中即入簇(OR),中弱维权重和达
// weakSignalClusterThreshold 才入簇;空维度不计分(空值降权)。P5 接 K4 UI。
// PROD 替换点: PATCH /api/admin/risk-score/weights/:dimension { value, reason }
export interface RiskScoreWeightDef {
  key:
    | "serverDeviceId"
    | "ipBucket"
    | "withdrawAddress"
    | "paymentInstrument"
    | "sponsor"
    | "uaFingerprint"
    | "signupTiming"
    | "weakSignalClusterThreshold";
  label: string;
  kind: RiskParamKind;
  defaultVal: number;
  /** 强=任一命中即入簇;中/弱=权重叠加达阈入簇;阈值行本身无强弱。 */
  tier: "strong" | "medium" | "weak" | "threshold";
  unit: string;
  desc: string;
}

export const RISK_SCORE_PARAM_PREFIX = "K.riskScore.";

export const RISK_SCORE_WEIGHT_PARAMS: RiskScoreWeightDef[] = [
  { key: "serverDeviceId", label: "设备标识权重", kind: "number", defaultVal: 0.9, tier: "strong", unit: "0-1", desc: "同服务端设备标识,任一命中即入簇。" },
  { key: "ipBucket", label: "IP 桶权重(24h 窗)", kind: "number", defaultVal: 0.8, tier: "strong", unit: "0-1", desc: "同 IP 桶且注册时间差 24h 内,任一命中即入簇。" },
  { key: "withdrawAddress", label: "提现地址权重", kind: "number", defaultVal: 0.9, tier: "strong", unit: "0-1", desc: "共用提现地址,任一命中即入簇;未提现前为空,提现时补判并回溯。" },
  { key: "paymentInstrument", label: "支付工具权重", kind: "number", defaultVal: 0.5, tier: "medium", unit: "0-1", desc: "共用支付/收款工具;未绑卡为空,降权不缺省判清白。" },
  { key: "sponsor", label: "推荐链权重", kind: "number", defaultVal: 0.4, tier: "medium", unit: "0-1", desc: "同推荐人;无邀请码为空,降权。" },
  { key: "uaFingerprint", label: "设备指纹权重", kind: "number", defaultVal: 0.2, tier: "weak", unit: "0-1", desc: "UA/机型粗指纹,叠加信号。" },
  { key: "signupTiming", label: "注册时序权重", kind: "number", defaultVal: 0.3, tier: "weak", unit: "0-1", desc: "同 IP 短时(1h)多号的时序聚类信号;裸号也据此入观察。" },
  { key: "weakSignalClusterThreshold", label: "弱信号入簇阈值", kind: "number", defaultVal: 0.6, tier: "threshold", unit: "0-1", desc: "中弱维权重和达到该值即入簇(强维不看此阈值)。" },
];

export const riskScoreParamKey = (key: RiskScoreWeightDef["key"]): string =>
  `${RISK_SCORE_PARAM_PREFIX}${key}`;

// ── SPEC-7 提现审核队列参数(mock seed,backend-replaceable)──────────────
// D2 是提现审核队列权威;该组参数只影响后台审核分流,不改 K3 风控路由结论。
// PROD 替换点:
//   - 读:GET  /api/admin/withdraw-review/config
//   - 改:PATCH /api/admin/withdraw-review/config/:key body { value: number; reason: string }
export interface WithdrawReviewParamDef {
  key: "largeConfirmUsdt";
  label: string;
  defaultVal: number;
  unit: string;
  desc: string;
  frontendEffect: string;
}

export const WITHDRAW_REVIEW_PARAM_PREFIX = "D.withdrawReview.";

export const WITHDRAW_REVIEW_PARAMS: WithdrawReviewParamDef[] = [
  {
    key: "largeConfirmUsdt",
    label: "大额操作确认线",
    defaultVal: 1000,
    unit: "USDT",
    desc: "提现单金额达到该线后,放行必须走财务 lead / 超管操作确认。",
    frontendEffect: "调低=更多提现单进入操作确认;调高=更多小额单可走快速放行。",
  },
];

export type WithdrawReviewParamKey = WithdrawReviewParamDef["key"];
export const withdrawReviewParamKey = (key: WithdrawReviewParamKey): string =>
  `${WITHDRAW_REVIEW_PARAM_PREFIX}${key}`;

// ── SPEC-2 电脑显卡映射表(G1-G6)────────────────────────────────────────
// 与 uniapp src/lib/gpu-tiers.ts 默认值保持同构。后台展示中文业务名;跨端下发时使用 id/tops/keywords。
// PROD 替换点:
//   - 读:GET  /api/admin/config/compute-share/gpu-tiers
//   - 改:PATCH /api/admin/config/compute-share/gpu-tiers/:id
//        body { label?: string; tops?: number; keywords?: string[]; reason: string }
export type ComputeGpuTierId = "G1" | "G2" | "G3" | "G4" | "G5" | "G6";
export type ComputeGpuTierField = "label" | "tops" | "keyword1" | "keyword2" | "keyword3" | "keyword4" | "keyword5" | "keyword6";

export interface ComputeGpuTierDef {
  id: ComputeGpuTierId;
  label: string;
  desc: string;
  defaultModel: string;
  defaultTops: number;
  keywords: string[];
}

export const COMPUTE_GPU_KEYWORD_SLOTS: Extract<ComputeGpuTierField, `keyword${number}`>[] = [
  "keyword1",
  "keyword2",
  "keyword3",
  "keyword4",
  "keyword5",
  "keyword6",
];

export const COMPUTE_GPU_TIERS: ComputeGpuTierDef[] = [
  {
    id: "G1",
    label: "入门显卡",
    desc: "集显或旧独显,只放轻量任务。",
    defaultModel: "Intel Iris Xe",
    defaultTops: 40,
    keywords: ["gtx 1650", "gtx 1060", "gtx 1050", "integrated", "iris xe", "vega"],
  },
  {
    id: "G2",
    label: "标准显卡",
    desc: "主流入门独显,也是未知型号的保守兜底档。",
    defaultModel: "NVIDIA RTX 3060",
    defaultTops: 90,
    keywords: ["rtx 3060", "rtx 3050", "rtx 2060", "gtx 1080", "rx 6600"],
  },
  {
    id: "G3",
    label: "进阶显卡",
    desc: "中端独显,可承接更长的推理任务。",
    defaultModel: "NVIDIA RTX 4060",
    defaultTops: 160,
    keywords: ["rtx 4060 ti", "rtx 4060", "rtx 3070", "rx 7600", "rx 6700"],
  },
  {
    id: "G4",
    label: "高阶显卡",
    desc: "高性能个人显卡,默认演示型号落在此档。",
    defaultModel: "NVIDIA RTX 4070",
    defaultTops: 290,
    keywords: ["rtx 4070 ti", "rtx 4070", "rtx 3080", "rx 7800"],
  },
  {
    id: "G5",
    label: "超高阶显卡",
    desc: "高端工作站或旗舰上一代独显。",
    defaultModel: "NVIDIA RTX 4080",
    defaultTops: 460,
    keywords: ["rtx 5080", "rtx 4080", "rx 7900", "a5000"],
  },
  {
    id: "G6",
    label: "旗舰显卡",
    desc: "旗舰显卡或数据中心卡,仅承接高收益任务。",
    defaultModel: "NVIDIA RTX 4090",
    defaultTops: 660,
    keywords: ["rtx 5090", "rtx 4090", "h100", "a100", "l40"],
  },
];

export const computeGpuTierParamKey = (id: ComputeGpuTierId, field: ComputeGpuTierField): string =>
  `${COMPUTE_PARAM_PREFIX}gpuTier.${id}.${field}`;

// ── SPEC-2 客户端下载配置───────────────────────────────────────────────
// URL 单独编辑;双语展示文案用 multi-field 一次编辑,避免在 UI 单框里塞多值。
// PROD 替换点:
//   - 读:GET  /api/admin/config/compute-share/download-content
//   - 改:PATCH /api/admin/config/compute-share/download-content
export type ComputeDownloadField = "url" | "zhTitle" | "zhGuide" | "enTitle" | "enGuide";

export const COMPUTE_DOWNLOAD_CONTENT: Record<ComputeDownloadField, { label: string; defaultVal: string; placeholder: string }> = {
  url: {
    label: "客户端下载地址",
    defaultVal: "",
    placeholder: "https://download.example.com/nexion-pc/latest",
  },
  zhTitle: {
    label: "中文标题",
    defaultVal: "电脑显卡算力共享",
    placeholder: "电脑显卡算力共享",
  },
  zhGuide: {
    label: "中文说明",
    defaultVal: "下载桌面客户端,使用同一账号登录,连接后电脑会出现在设备仓库中。",
    placeholder: "说明下载、登录与连接后的展示位置",
  },
  enTitle: {
    label: "英文标题",
    defaultVal: "Computer GPU share",
    placeholder: "Computer GPU share",
  },
  enGuide: {
    label: "英文说明",
    defaultVal: "Download the desktop client, sign in with the same account, and the computer appears in device inventory after connection.",
    placeholder: "Explain download, sign-in, and inventory placement",
  },
};

export const computeDownloadParamKey = (field: ComputeDownloadField): string =>
  `${COMPUTE_PARAM_PREFIX}download.${field}`;
