/**
 * K 域(风控与反作弊)视图数据 — design_handoff_k_domain port,全 join 模式:
 *  - 簇统计 / 礼金拦截 / K4 分布 / K5 队列基数 = design-data K_RISK + REGISTERED_USERS 单源;
 *  - K4 单用户分 / K5 工单引用分 = USERS / WITHDRAWALS 同分派生(K4 全平台唯一评分源,谁都不另算);
 *  - minHoldingMonths 权威归 E3(/devices/trade-in,key E.tradein.minHoldingMonths),K2 只读 pget 同源;
 *  - 参数默认值全部对齐 PRD V1 Ch8 K1-K5 ③ 表(12 月周期权威)。
 */
import { USERS, WITHDRAWALS, K_RISK, REGISTERED_USERS } from "@/lib/mock/admin/design-data";

/* ============================ K1 反多账户引擎 ============================ */

// PRD K1③ 五参数(全 操作确认,改后下一次校验生效)。key 落 K.k1.<param>。
export const K1_PARAMS: { key: string; name: string; sub: string; val: string; note: string }[] = [
  { key: "maxSignupPerIp24h", name: "同一 IP,24 小时内最多注册", sub: "超过就拒绝注册", val: "3 个号", note: "范围 1–10 · 超限直接拒绝注册(§9.11e.1)" },
  { key: "maxAccountsPerDevice", name: "同一台设备最多绑定", sub: "按设备指纹识别", val: "2 个号", note: "范围 1–5 · 超限拒绝注册/绑上级(§9.11d.2 server enforce)" },
  { key: "maxAccountsPerPaymentInstrument", name: "同一支付工具最多绑定", sub: "同卡/同钱包算同一人", val: "2 个号", note: "范围 1–5 · 超限标记并停发新人礼" },
  { key: "linkWeight", name: "关联强度怎么算(权重)", sub: "IP 权重最低,防合租网络误判", val: "设备 0.5 · 支付 0.4 · IP 0.1", note: "故意把 IP 权重压得很低 —— 合租网络、校园网容易误伤;只对之后的新判定生效,不追溯老簇" },
  { key: "clusterFreezeSuggestThreshold", name: "标红建议冻结线", sub: "只提醒,不自动冻结", val: "0.7", note: "范围 0–1 · 只是列表标红提醒,冻结本身仍要理由必填确认" },
];

export type ClusterStatus = "detected" | "flagged" | "frozen" | "released" | "cleared";
export type K1Cluster = {
  id: string;
  key: string;
  layer: "ip" | "device" | "payment";
  layerLabel: string;
  n: number;
  strength: number;
  span: string;
  status: ClusterStatus; // 种子态;实时态 = pget(`K.cluster.<id>.st`) ?? status
  note: string;
  gifts: [id: string, desc: string, st: string][];
  nodes: [uid: string, joined: string, sponsor: string, gotGift: "是" | "否", deposit: string, st: ClusterStatus][];
};

export const K1_CLUSTERS: K1Cluster[] = [
  {
    id: "CL-318", key: "fp_8a3f…c2", layer: "device", layerLabel: "设备指纹", n: 12, strength: 0.88, span: "5/02 – 5/19(17 天)", status: "flagged",
    note: "12 个账户共用 2 台设备 + 3 张卡,注册集中在 17 天内,9 个号领过新人礼 —— 典型批量养号。建议批量冻结。",
    gifts: [["G-2241", "已发 9 笔 · $45 + 1,800 NEX", "异常 · 已停发后续"], ["G-2238", "拦截 3 笔", "已拦截"]],
    nodes: [
      ["usr_55B1", "5/19", "NX-5512", "是", "$1,240", "frozen"], // 上级码与 USERS.ref 单源对齐(同簇靠设备共享入簇,上级不必同主号)
      ["usr_8812", "5/17", "NX-8821", "是", "$200", "flagged"],
      ["usr_8810", "5/16", "NX-8821", "是", "$180", "flagged"],
      ["usr_8807", "5/12", "NX-8821", "是", "$99", "flagged"],
      ["usr_8801", "5/02", "—(主号)", "否", "$3,400", "flagged"],
    ],
  },
  {
    id: "CL-322", key: "card_…7741", layer: "payment", layerLabel: "支付工具", n: 5, strength: 0.74, span: "4/28 – 5/30(32 天)", status: "detected",
    note: "5 个账户共用同一张卡充值,设备各不相同 —— 可能是家庭共用,也可能是分散养号。建议先人工复审。",
    gifts: [["G-2255", "已发 4 笔 · $20 + 800 NEX", "待判定"]],
    nodes: [
      ["usr_77D4", "5/30", "NX-7741", "是", "$310", "detected"],
      ["usr_7702", "5/21", "NX-7741", "是", "$150", "detected"],
      ["usr_7698", "5/12", "NX-7741", "是", "$95", "detected"],
      ["usr_7691", "4/28", "—(主号)", "否", "$890", "detected"],
    ],
  },
  {
    id: "CL-309", key: "ip_103.86.…", layer: "ip", layerLabel: "IP", n: 8, strength: 0.31, span: "3/12 – 5/28(77 天)", status: "cleared",
    note: "8 个账户同一出口 IP,但设备、支付全不重合 —— 命中校园网白名单,系统已自动判定正常。",
    gifts: [],
    nodes: [
      ["usr_4410", "5/28", "NX-1190", "是", "$520", "cleared"],
      ["usr_4321", "4/02", "NX-0029", "是", "$1,100", "cleared"],
      ["usr_4015", "3/12", "—", "否", "$2,300", "cleared"],
    ],
  },
  {
    id: "CL-301", key: "fp_77be…9d", layer: "device", layerLabel: "设备指纹", n: 6, strength: 0.81, span: "4/11 – 4/15(4 天)", status: "frozen",
    note: "6 个账户同一台设备 4 天内连开,已于 4/16 操作确认批量冻结。",
    gifts: [["G-2102", "已发 5 笔 · 已转余额追回流程(C3)", "已处置"]],
    nodes: [
      ["usr_6201", "4/15", "NX-5512", "是", "$80", "frozen"],
      ["usr_6195", "4/13", "NX-5512", "是", "$75", "frozen"],
      ["usr_6188", "4/11", "—(主号)", "否", "$1,600", "frozen"],
    ],
  },
  {
    id: "CL-296", key: "ip_45.77.…", layer: "ip", layerLabel: "IP", n: 4, strength: 0.42, span: "5/01 – 5/22(21 天)", status: "released",
    note: "曾因同 IP + 同支付误判冻结,核实为夫妻共用卡,5/24 操作确认解除。",
    gifts: [],
    nodes: [
      ["usr_5102", "5/22", "NX-3188", "是", "$430", "released"],
      ["usr_5099", "5/01", "—", "否", "$960", "released"],
    ],
  },
];

export const CLUSTER_ST: Record<ClusterStatus, [label: string, tone: string]> = {
  detected: ["命中待判", "dim"],
  flagged: ["已标可疑", "warn"],
  frozen: ["已冻结", "bad"],
  released: ["已解除误判", "ok"],
  cleared: ["判定正常", "ok"],
};

// IP 白名单种子(共享办公 / 校园网;权威归 K1 IP 维度,账户级名单归 C2)。
export const K1_WHITELIST: [cidr: string, note: string, by: string, expire: string][] = [
  ["103.86.44.0/24", "新加坡某联合办公空间", "risklead_h", "2026-12-31"],
  ["202.120.0.0/16", "上海某高校校园网", "risklead_h", "长期"],
];

export const strengthColor = (s: number) => (s >= 0.7 ? "var(--danger)" : s >= 0.4 ? "var(--warning)" : "var(--success)");

/* ============================ K2 套利与刷量检测 ============================ */

// PRD K2③ 三参数(操作确认)。trialCycleThreshold 归属 K2/H2 待定(V4 收口),暂按 K2 持有、H2 读取。
export const K2_PARAMS: { key: string; name: string; val: string; unit?: string; sub: string; note: string }[] = [
  { key: "trialCycleThreshold", name: "试用循环异常线", val: "≥ 3 次 / 30 天", sub: "同一实体反复开试用超过这条线就报循环信号", note: "范围 2–10 次。归属还在 K2 / 试用引擎(H2)之间二选一,定稿前按 K2 持有、H2 读取处理(产消方向已定:K2 产 / H2 消)" },
  { key: "welcomeGiftAnomalyThreshold", name: "新人礼异常发放线", val: "≥ 2 笔 / 实体", sub: "同一实体超 1 笔即异常,拦后面的", note: "范围 1–5 笔。和 K1 同设备 ≤2 个号对齐:同一实体领第 2 笔就算异常,停发后续" },
  { key: "leaderboardVelocityMultiplier", name: "刷榜增速异常倍数", val: "> 5× 基线", sub: "超倍数 → 标记 + 转人工 · 取消资格的执行归 F8", note: "范围 2×–20×,下一个快照周期生效。基线 = 本期活跃参榜账户佣金增量中位数,先排除已标记账户,防止被刷的人把基线抬高" },
];

export type K2View = "trial" | "tradein" | "gift" | "board";
export type K2Act = "flag" | "freeze" | "blockgift" | "boardflag";
export type K2Row = { rid: string; cluster?: string; cells: string[]; lvl: number; acts: K2Act[] };

// 判定标签从层数单源派生(3 层=闭环套利 / 2 层=预警转人工 / 1 层=观察中);trial 双列、board 仅判定列。
export const K2_JUDGE = (lvl: number): [label: string, tone: string] =>
  lvl >= 3 ? ["闭环套利", "bad"] : lvl === 2 ? ["预警 · 转人工", "warn"] : ["观察中", "dim"];

// 四类检测视图;rid 稳定 ASCII 作落键;cluster = 联动 K1 冻结的目标簇(共用 K.cluster.<id>.st 真写键)。
export const K2_VIEWS: Record<K2View, { label: string; sub: string; head: string[]; note: string; rows: K2Row[] }> = {
  trial: {
    label: "试用循环",
    sub: "· 试用循环养号 · 服务器端复活计数,不信客户端状态",
    head: ["实体 / 簇", "30 天循环次数", "关联账户", "累计套取试用收益", "层数命中", "判定", "动作"],
    note: "「循环次数」是服务器记的「开试用 → 取消 → 再开」轮数,清缓存、卸载重装都不会清零。层数命中 = 多账户 / 绑上级 / 试用循环三层里中了几层。",
    rows: [
      { rid: "T-318", cluster: "CL-318", cells: ["CL-318 · fp_8a3f…", "7 次", "9", "$310(影子收益,未入余额)"], lvl: 3, acts: ["freeze", "flag"] },
      { rid: "T-322", cluster: "CL-322", cells: ["CL-322 · card_…7741", "4 次", "4", "$95"], lvl: 2, acts: ["flag"] },
      { rid: "T-9921", cells: ["usr_9921(独号)", "3 次", "1", "$28"], lvl: 1, acts: ["flag"] },
    ],
  },
  tradein: {
    label: "换新套利",
    sub: "· 以旧换新套利 · 没满最短持有月就想换新,残值已被服务器算成 $0 拦下",
    head: ["账户", "设备", "购入时间", "持有月数 / 门槛", "残值拦截", "层数命中", "动作"],
    note: "最短持有月数由商品域 E3 配置,这里只读。服务器守卫:不满门槛残值一律 $0,所以这里只是把反复尝试的人标出来观察,不需要再拦一次。",
    rows: [
      { rid: "D-3315", cells: ["usr_3315", "Nexion One #88412", "2026-04-30", "1.3 / 6 个月", "已拦 · $0"], lvl: 2, acts: ["flag"] },
      { rid: "D-8807", cluster: "CL-318", cells: ["usr_8807(CL-318)", "Nexion One #91230", "2026-05-12", "0.9 / 6 个月", "已拦 · $0"], lvl: 3, acts: ["freeze", "flag"] },
      { rid: "D-2208", cells: ["usr_2208", "Pro Gen-1 #71022", "2026-03-18", "2.8 / 6 个月", "已拦 · $0"], lvl: 1, acts: ["flag"] },
    ],
  },
  gift: {
    label: "新人礼刷取",
    sub: "· 新人礼刷取 · 和 K1 重复发放互通,这里看的是「领完礼就走」的闭环行为",
    head: ["簇", "实体", "已发 / 已拦", "涉及金额", "闭环特征", "层数命中", "动作"],
    note: "K1 看「同一实体重复领」,这里加看行为:领完礼 24h 内无任何使用、直接转走或沉默,才算刷取闭环。拦截只停发后面的,不动已入账的钱。",
    rows: [
      { rid: "G-318", cluster: "CL-318", cells: ["CL-318", "fp_8a3f…", "9 发 / 3 拦", "$45 + 1,800 NEX", "领礼后 24h 零活跃 · 直奔试用"], lvl: 3, acts: ["blockgift", "freeze"] },
      { rid: "G-322", cluster: "CL-322", cells: ["CL-322", "card_…7741", "4 发 / 0 拦", "$20 + 800 NEX", "部分账户有真实充值,待人工"], lvl: 2, acts: ["blockgift", "flag"] },
    ],
  },
  board: {
    label: "排行榜刷榜",
    sub: "· 排行榜刷榜 · 邀请/佣金增速异常的冲榜账户 · 每 5 分钟快照对比基线",
    head: ["账户", "本期累计佣金", "增速(对基线)", "直推增长", "关联簇", "判定", "动作"],
    note: "基线是全体活跃参榜者的佣金增量中位数(已排除被标记账户)。这里只标记 + 发信号给 F8 和风险雷达;取消参榜资格、从奖池剔除由 F8 执行,急停可临时借 K1 冻结。",
    rows: [
      { rid: "B-6611", cluster: "CL-330", cells: ["usr_6611", "$4,820", "8.4×", "+41 人 / 24h", "CL-330(新)"], lvl: 3, acts: ["boardflag", "freeze"] },
      { rid: "B-5102", cells: ["usr_5102", "$2,150", "5.6×", "+18 人 / 24h", "—"], lvl: 2, acts: ["boardflag"] },
      { rid: "B-1190", cells: ["usr_1190", "$1,960", "5.1×", "+12 人 / 24h", "—"], lvl: 1, acts: ["boardflag"] },
    ],
  },
};

/* ============================ K3 提现风控规则引擎 ============================ */

// PRD K3③ 四维规则卡(条件 / 命中动作 / 调参 key);key 落 K.rule.<ruleKey>(沿用既有真写键,text edit 存整条规则文案)。
// cond 内 **粗体** 标记 = 关键阈值橙色强调(k3 渲染器拆段,对应设计稿 .cond b)。
export const K3_DIMS: { ruleKey: string; name: string; cond: string; condDefault: string; why: string; act: "delay" | "manual" | "freeze"; note: string; icon: "card" | "wave" | "user" | "shield" }[] = [
  { ruleKey: "largeAmountUsdt", name: "金额", cond: "单笔 ≥ **$1,000** → 转人工", condDefault: "单笔 ≥ $1,000 → 转人工", why: "和提现队列(D2)自己的大额操作确认线、大额 KYC 复审线(K5)是三个独立参数,现在碰巧都是 $1,000,可以分别调", act: "manual", note: "范围 $100–$50,000 · 锚定「超过 $1,000 进增强审核」的合规口径(§9.3.5)", icon: "card" },
  { ruleKey: "velocity24h", name: "速度", cond: "24h 内 > **3 笔** 或累计 > **$5,000** → 延迟", condDefault: "24h > 3 笔 或 > $5,000 → 延迟", why: "防「化整为零」快速搬钱;笔数和提现队列里「24h 第几笔」字段对齐", act: "delay", note: "笔数 1–20 · 金额 $500–$50,000", icon: "wave" },
  { ruleKey: "newAccountProtectDays", name: "新账户", cond: "注册不满 **7 天**就提现 → 延迟", condDefault: "注册 < 7 天 → 延迟", why: "新号秒提是套现的典型动作;和 K1 注册侧信号联动", act: "delay", note: "范围 0–30 天", icon: "user" },
  { ruleKey: "addressReputationSource", name: "地址信誉", cond: "收款地址命中黑名单 / 低信誉 → **冻结**", condDefault: "内部黑名单 + 链上信誉", why: "信誉源 = 内部黑名单 + 链上信誉服务;换源只对新地址生效", act: "freeze", note: "可选内部 / 第三方 / 组合", icon: "shield" },
];

export type RuleState = "draft" | "active" | "paused" | "archived";
export type K3Rule = { id: string; dim: string; cond: string; act: "pass" | "delay" | "freeze" | "manual"; state: RuleState };

export const K3_RULES: K3Rule[] = [
  { id: "WR-01", dim: "金额", cond: "单笔 ≥ $1,000", act: "manual", state: "active" },
  { id: "WR-02", dim: "速度", cond: "24h > 3 笔 或 > $5,000", act: "delay", state: "active" },
  { id: "WR-03", dim: "新账户", cond: "注册 < 7 天", act: "delay", state: "active" },
  { id: "WR-04", dim: "地址信誉", cond: "黑名单 / 低信誉地址", act: "freeze", state: "active" },
  { id: "WR-05", dim: "速度", cond: "24h > 8 笔(旧版收紧规则)", act: "manual", state: "paused" },
  { id: "WR-06", dim: "金额", cond: "单笔 ≥ $500(P1 期旧线)", act: "manual", state: "archived" },
];

export const RULE_ACT: Record<string, [label: string, tone: string]> = {
  pass: ["放行", "ok"], delay: ["延迟", "warn"], freeze: ["冻结", "bad"], manual: ["转人工", "cyan"],
};
export const RULE_ST: Record<RuleState, [label: string, tone: string]> = {
  draft: ["草拟", "dim"], active: ["生效中", "ok"], paused: ["已停用", "warn"], archived: ["已归档", "dim"],
};

// 路由结果分布(7 天):笔数为单一源,占比派生(86.2 / 9.4 / 3.9 / 0.5)。
export const K3_ROUTE_COUNTS = [
  { key: "pass", label: "放行", n: 11_067, color: "var(--success)" },
  { key: "delay", label: "延迟", n: 1_208, color: "var(--warning)" },
  { key: "manual", label: "转人工", n: 501, color: "var(--cyan)" },
  { key: "freeze", label: "冻结", n: 64, color: "var(--danger)" },
];
export const K3_ROUTE_TOTAL = K3_ROUTE_COUNTS.reduce((a, r) => a + r.n, 0); // 12,840

// t 含日期前缀(WD-90412 命中时刻须与 K5 工单 KR-7741 触发时刻同一,跨视图同一事件单一时间线)。
export const K3_HITS: [wd: string, uid: string, amt: string, rule: string, dim: string, act: "delay" | "freeze" | "manual", t: string][] = [
  ["WD-90412", "usr_31E8", "$8,200", "WR-01", "金额", "manual", "昨天 14:22"],
  ["WD-90408", "usr_8807", "$240", "WR-02", "速度", "delay", "今天 14:05"],
  ["WD-90402", "usr_9F31", "$310", "WR-03", "新账户", "delay", "今天 13:48"], // 注册 6/05(5 天 < 7 天保护期);曾误用 usr_77D4(已注册 11 天,不命中 WR-03)
  ["WD-90396", "usr_2231", "$1,950", "WR-04", "地址信誉", "freeze", "5/20 13:10"], // 与 KR-7702 触发同刻
  ["WD-90391", "usr_84F2", "$1,120", "WR-01", "金额", "manual", "今天 12:51"],
  ["WD-90391", "usr_84F2", "$1,120", "WR-02", "速度", "delay", "今天 12:51"], // 同单双命中逐规则记录;最严合成 = WR-01 转人工(D2 行「WR-01 + WR-02」同源)
  ["WD-90388", "usr_8812", "$95", "WR-02", "速度", "delay", "今天 12:33"], // usr_8812 注册 5/17 已 24 天,不再叠 WR-03
];

/* ============================ K4 风险评分模型 ============================ */

// PRD K4③ 六维权重(默认合计 = 1.00,前端禁提 + server 400 双校验)。key 沿用既有 K.score.weight.<dimKey>。
export const K4_DIMS: { dimKey: string; name: string; src: string; w: number }[] = [
  { dimKey: "multiAccount", name: "多账户命中", src: "来自 K1", w: 0.25 },
  { dimKey: "arbitrage", name: "套利信号", src: "来自 K2", w: 0.2 },
  { dimKey: "kycState", name: "实名状态", src: "来自 C4", w: 0.2 },
  { dimKey: "withdrawSpeed", name: "提现速度", src: "资金事件", w: 0.15 },
  { dimKey: "accountAge", name: "账户年龄", src: "注册时间", w: 0.1 },
  { dimKey: "anomaly", name: "异常行为", src: "行为事件", w: 0.1 },
];

// K4 分布(单源:K_RISK + REGISTERED_USERS 闭合求和;占比派生)。
export const K4_DIST = (() => {
  const high = K_RISK.scoreHigh, mid = K_RISK.scoreMid, low = REGISTERED_USERS - mid - high;
  const pct = (n: number) => Math.round((n / REGISTERED_USERS) * 1000) / 10;
  return [
    { band: "低风险", range: "< 40", n: low, pct: pct(low), color: "var(--success)" },
    { band: "中风险", range: "40–69", n: mid, pct: pct(mid), color: "var(--warning)" },
    { band: "高风险", range: "≥ 70", n: high, pct: pct(high), color: "var(--danger)" },
  ];
})();

const userRisk = (uid: string): number | undefined =>
  USERS.find((u) => u.id === uid)?.risk ?? WITHDRAWALS.find((w) => w.user === uid)?.risk;

// 单用户可解释样例 —— 分数从 USERS/WITHDRAWALS 同分派生(K4 唯一评分源),维度贡献闭合求和 = 分数。
export type K4Lookup = { score: number; dims: [name: string, evidence: string, pt: number][] };
export const K4_LOOKUP: Record<string, K4Lookup> = {
  usr_55B1: {
    score: userRisk("usr_55B1") ?? 91, // 91
    dims: [["多账户命中", "是 · 簇 CL-318", 38], ["套利信号", "是 · 试用循环 ×7", 24], ["实名状态", "待复审", 12], ["提现速度", "24h 3 笔", 9], ["账户年龄", "22 天(新)", 5], ["异常行为", "深夜批量操作", 3]],
  },
  usr_84F2: {
    score: userRisk("usr_84F2") ?? 72, // 72(D2 提现队列同分)
    dims: [["多账户命中", "否", 0], ["套利信号", "否", 0], ["实名状态", "已通过", 0], ["提现速度", "24h 5 笔 · $9,400", 34], ["账户年龄", "89 天", 6], ["异常行为", "大额夜间提现", 32]],
  },
  usr_19C7: {
    score: userRisk("usr_19C7") ?? 18, // 18
    dims: [["多账户命中", "否", 0], ["套利信号", "否", 0], ["实名状态", "已通过", 0], ["提现速度", "正常", 6], ["账户年龄", "134 天", 2], ["异常行为", "无", 10]],
  },
};

// 人工覆盖记录(单人 + 强制原因;可一键回模型分)。
export const K4_OVERRIDES: [uid: string, model: number, ov: number, reason: string, op: string, ts: string][] = [
  ["usr_2231", 88, 35, "线下核实为代理商集中收款,非套现", "risklead_h", "5/28"],
  ["usr_9921", 42, 75, "客服举报线索:疑似收购账户,临时压高待查", "risklead_h", "5/22"],
  ["usr_5102", 61, 20, "误判已解除(CL-296 夫妻共用卡)", "risklead_h", "5/24"],
];

export const scoreColor = (s: number) => (s >= 70 ? "var(--danger)" : s >= 40 ? "var(--warning)" : "var(--success)");

/* ============================ K5 大额 KYC 复审 ============================ */

// PRD K5③ 四参数(操作确认;设计稿漏第 4 项 reviewTriggerScore,按 PRD 补齐)。key 落 K.k5.<param>。
export const K5_PARAMS: { key: string; name: string; val: string; unit?: string; sub: string; note: string }[] = [
  { key: "largeWithdrawReviewUsdt", name: "大额提现复审线", val: "≥ $1,000", sub: "命中 → 生成复审工单 + 提现单冻结", note: "范围 $100–$50,000。锚定「超过 $1,000 进增强审核」的合规口径;这条线和提现风控路由线(K3)、提现队列操作确认线(D2)是三个独立参数,目前碰巧同值" },
  { key: "cumulativeKycThresholdUsdt", name: "累计金额触发线", val: "$100", unit: "终身累计", sub: "累计兑换过线 → 实名升级复审", note: "范围 $50–$1,000 · 终身累计兑换过线即触发实名升级复审(§4.4.1 / §9.4.2)" },
  { key: "reviewSlaDays", name: "复审时限", val: "7", unit: "个工作日", sub: "超时自动告警 · 大额可延至 15 天", note: "范围 1–15 天;大额复杂件可延至 15 天。超时自动告警 + 升级" },
  { key: "reviewTriggerScore", name: "风险分触发线", val: "≥ 85", unit: "分", sub: "K4 风险分过线 → 自动建复审工单", note: "范围 70–100 · 对接 K4 自动升级线(autoEscalateScore),承接「≥85 建议触发 K5」落点" },
];

export type TicketSt = "triggered" | "in-review" | "overdue" | "passed" | "rejected";
export type K5Ticket = {
  id: string;
  type: "大额提现" | "大额兑换" | "累计过线" | "手动触发";
  user: string;
  amt: string;
  cum: string;
  kyc: string;
  st: TicketSt; // 种子态;裁决实时态 = pget(`K.kyc.<id>.decision`)
  slaPct: number;
  slaTxt: string;
  info: [k: string, v: string][];
  hist: [ts: string, ev: string, tone: "" | "warn" | "bad"][];
};

// K4 引用分全部同分派生:usr_31E8=68 / usr_77D4=11(USERS 权威;触发是规则线不是分数线,低分照样触发)/ usr_84F2=72。
const r31E8 = userRisk("usr_31E8") ?? 68;
const r77D4 = userRisk("usr_77D4") ?? 11;
const r84F2 = userRisk("usr_84F2") ?? 72;

// 时间线自洽(「今天/昨天」相对今日 2026-06-11,SLA = 7 个工作日):触发日 + SLA 与「剩 N 天」一致;同一事件跨视图(K3 命中日志 / C4 台账 hist)同一时刻。
export const K5_TICKETS: K5Ticket[] = [
  {
    id: "KR-7741", type: "大额提现", user: "usr_31E8", amt: "$8,200", cum: "—", kyc: "已通过(待复审)", st: "in-review", slaPct: 0.18, slaTxt: "剩 6 天",
    info: [["触发原因", "单笔提现 $8,200 ≥ $1,000"], ["提现单", "WD-90412 · 复审 hold(D2 待人工 · 禁放)"], ["实名材料", "服务商档案 #SB-44102 · 2026-01 提交"], ["风险评分(K4)", `${r31E8} · ${r31E8 >= 70 ? "高" : r31E8 >= 40 ? "中" : "低"}`], ["账户年龄", "181 天"], ["历史提现", "41 笔 · 全部正常"]],
    hist: [["昨天 14:22", "触发 · 单笔大额(K3 命中同刻)", ""], ["昨天 14:22", "提现单 WD-90412 进入复审 hold(复审未过维持待确认 · 禁放)", "warn"], ["今天 10:05", "材料初核完成 · 等待裁决", ""]],
  },
  {
    id: "KR-7738", type: "累计过线", user: "usr_77D4", amt: "—", cum: "$112 / $100", kyc: "快速实名(待升级)", st: "in-review", slaPct: 0.68, slaTxt: "剩 2 天",
    info: [["触发原因", "终身累计兑换 $112 过 $100 线(规则线触发,与分数无关)"], ["关联簇", "CL-322(K1 · 待判)"], ["实名材料", "快速实名($1 验证)"], ["风险评分(K4)", `${r77D4} · ${r77D4 >= 70 ? "高" : r77D4 >= 40 ? "中" : "低"}`], ["账户年龄", "11 天"], ["历史提现", "1 笔"]],
    hist: [["6/03 16:40", "触发 · 累计过线", ""], ["6/05 11:20", "要求补充材料 · 已通知用户", "warn"]],
  },
  {
    id: "KR-7702", type: "大额提现", user: "usr_2231", amt: "$1,950", cum: "—", kyc: "已通过(待复审)", st: "overdue", slaPct: 1, slaTxt: "已超时",
    info: [["触发原因", "单笔 $1,950 + 地址信誉冻结(K3)"], ["提现单", "WD-90396 · 已冻结"], ["实名材料", "服务商档案 #SB-39871"], ["风险评分(K4)", "88 → 35(人工覆盖)"], ["账户年龄", "203 天"], ["备注", "评分覆盖原因:代理商集中收款"]],
    hist: [["5/20 13:10", "触发 · 大额 + 低信誉地址", ""], ["5/29 09:00", "超 SLA(7 个工作日)告警 · 升级风控主管", "bad"]],
  },
  {
    id: "KR-7729", type: "大额兑换", user: "usr_84F2", amt: "$2,400", cum: "—", kyc: "已通过(待复审)", st: "triggered", slaPct: 0.05, slaTxt: "剩 7 天",
    info: [["触发原因", "单日兑换 $2,400(兑换阈值由 G2 配置,这里只消费事件)"], ["风险评分(K4)", `${r84F2} · ${r84F2 >= 70 ? "高" : r84F2 >= 40 ? "中" : "低"}`], ["账户年龄", "89 天"], ["历史兑换", "12 笔"]],
    hist: [["今天 08:15", "触发 · 大额兑换", ""]],
  },
];

export const TICKET_ST: Record<TicketSt, [label: string, tone: string]> = {
  triggered: ["已触发", "dim"],
  "in-review": ["复审中", "warn"],
  overdue: ["已超时", "bad"],
  passed: ["已通过", "ok"],
  rejected: ["已驳回", "bad"],
};

// 异常告警(advisory 只通知不处置;批量集中窗口 = 1h,PRD largeWithdrawBurstAlert ≥5 笔大额 / 1h)。
export const K5_ALERTS: [tone: "bad" | "warn", title: string, body: string, ts: string][] = [
  ["bad", "复审超时", "KR-7702(usr_2231 · $1,950)超 7 个工作日未裁决,已自动升级给风控主管", "5/29 09:00"],
  ["warn", "批量大额集中", "过去 1 小时 5 笔 ≥ $1,000 提现来自同一推荐链(NX-8821),已联动 K1 查簇", "昨天 22:41"],
  ["warn", "累计过线高峰", "本周 38 人累计兑换过 $100 触发实名升级,环比 +52%(兑换活动期,预期内)", "5/27"],
];

export const slaColor = (p: number) => (p >= 1 ? "var(--danger)" : p >= 0.6 ? "var(--warning)" : "var(--success)");
