/**
 * C 域(用户与账户)页面级数据 —— design_handoff_c_domain port。
 * 单源纪律(权威数值零复制,全部 join):
 *  - 用户行/风险分/冻结种子 = design-data.USERS(K4 同分单源;设计稿的中文名单为发明,弃);
 *  - 高风险档 = K_RISK.scoreHigh;K1 批量冻结 86 = K_RISK.frozenAccountsBase(80)+ CL-301 6 账户;
 *  - 簇引用 = k-tabs K1_CLUSTERS 口径(CL-318 flagged / CL-301 frozen / CL-322 detected);
 *  - K5 工单引用 = k-tabs K5_TICKETS(KR-7741=31E8 / KR-7738=77D4 / KR-7702=2231 超时 / KR-7729=84F2);
 *    设计稿把 KR-7738 写给 55B1 为撞号,按 K 域权威改 77D4;
 *  - 配对地址 = WITHDRAWALS 同链同址(31E8 TR7N…f2 / 77D4 TBn8…1p / 2231 bc1q…7e),弃设计稿发明地址;
 *  - 覆盖率/红线 = lib/mock/admin/ledger LEDGER(C3 加钱红线核验展示用,不重算);
 *  - C4 三段人数闭合 REGISTERED_USERS(已验证 = 总数 − 未验证 − 复审中);
 *  - C5/C6 锁定数同源 SEC(短锁 198 + 长锁 16 = 214,两页引同一常量)。
 * 真写键沿用旧 c-view 体系:C.adjust.<id>.status / C.user.<id>.pwReset / C.impersonate.<id>.ended;
 * 会话键空间两级:C.session.<ssid>.forcedOut(单会话,C5)+ C.session.user.<uid>.allOut(整链,
 * C2 强制登出 / 冻结联动 / C5 全部踢线同键);新增 C.kyc.<id>.st(三态 verified/none/review,
 * K5 累计过线裁决回写同键)。弃键(无读取方,persist 孤儿无害):C.user.<id>.restricted(无 PRD
 * C2 依据,被账户级名单取代)/ C.kyc.<id>.result / 旧 C.regrisk 七键(otpTtlSec 等,键名全换)。
 */
import { REGISTERED_USERS, K_RISK, USERS } from "@/lib/mock/admin/design-data";

/* ============ C1 检索画像 ============ */
// 设备持有者(L4+)与本周新增:C 域口径(占比与 REGISTERED_USERS 自洽:41,208 / 128,400 = 32.1%)。
export const C1_STATS = {
  weeklyNew: 28_940,
  deviceHolders: 41_208,
  holderPct: ((41_208 / REGISTERED_USERS) * 100).toFixed(1), // 32.1
};

/* ============ 冻结台账派生(C1 / C2 同一派生,严禁两页各写一份) ============ */
// 98 = K1 批量 86(K_RISK.frozenAccountsBase 80 + CL-301 6 账户,与 K1 口径同源)
//    + 人工冻结存量 11 + 台账实时人工冻结数(种子 1:usr_55B1,USERS.frozen=true)。
export const K1_FROZEN_ACCOUNTS = K_RISK.frozenAccountsBase + 6; // 86
export const MANUAL_FROZEN_BASE = 11;
export const frozenTotal = (liveManualFrozen: number) =>
  K1_FROZEN_ACCOUNTS + MANUAL_FROZEN_BASE + liveManualFrozen;

/* ============ C2 账户操作 ============ */
// st 为种子态;实时态 = useUserOps frozen 覆盖(冻结/解冻真写共享 store,360 页同步)。
// k1Batch=true 的行已计入 K1_FROZEN_ACCOUNTS,不再进人工冻结计数(防双计)。
// wdInflight:冻结原子联动的在途提现单(D.withdraw.<id>.st 同键真写,D2 实时跟)。
export type C2Account = {
  id: string;
  st: "normal" | "flagged" | "frozen";
  why: string;
  ss: number;
  k1Batch?: boolean;
  cluster?: { id: string; note: string };
  wdInflight?: string;
  freezeHist: [t: string, what: string, who: string][];
  actions: [t: string, what: string, who: string][];
};
export const C2_ACCOUNTS: C2Account[] = [
  {
    id: "usr_8807", st: "flagged", why: "簇 CL-318 关联(K1 标记)", ss: 2,
    cluster: { id: "CL-318", note: "CL-318 · 已标可疑(K1 · 强度 0.88)" },
    wdInflight: "WD-90408",
    freezeHist: [["—", "本账户无冻结史", "—"]],
    actions: [["5/27", "K1 标记可疑(簇关联)", "risk@系统"], ["6/10", "提现 WD-90408 延迟观察(WR-02)", "D2"], ["5/12", "注册", "—"]],
  },
  {
    id: "usr_6201", st: "frozen", why: "K1 批量冻结 · CL-301", ss: 0, k1Batch: true,
    cluster: { id: "CL-301", note: "CL-301 · 已冻结(K1 批量 · 6 账户)" },
    freezeHist: [["4/16", "K1 批量冻结 · CL-301 簇 6 户", "risklead_h → super_w"]],
    actions: [["4/16", "批量冻结生效 · 联动 D2 提现冻结", "操作确认"], ["4/11", "注册", "—"]],
  },
  {
    id: "usr_2231", st: "normal", why: "—", ss: 3,
    freezeHist: [["—", "无", "—"]],
    actions: [["6/10", "模拟登录排障(cs_amy · 只读 · 工单 T-9002)", "cs_amy"], ["5/20", "提现 WD-90396 冻结(WR-04 地址信誉,K5 复审 KR-7702)", "D2"], ["3/02", "注册", "—"]],
  },
  {
    id: "usr_55B1", st: "frozen", why: "风控命中 · 5/22 操作确认", ss: 0,
    freezeHist: [["5/22", "风控命中冻结(K4 risk 91)", "risklead_h → super_w"]],
    actions: [["5/24", "客服举报线索 · 疑似收购账户", "growth_m"], ["5/22", "冻结生效", "操作确认"], ["5/19", "注册", "—"]],
  },
];
export const C2_ACCT_STATE: Record<C2Account["st"], [label: string, tone: string]> = {
  normal: ["正常", "ok"], flagged: ["已标可疑", "warn"], frozen: ["已冻结", "bad"],
};

// 实时人工冻结计数面 = C2 台账(!k1Batch)∪ USERS 检索页全量,按 id 去重(360 页冻结任一检索
// 用户都计入;种子下唯一 frozen = usr_55B1 → manualLive 1 → 总数 98)。C1/C2 必用同一列表派生。
export const manualFrozenSeeds: { id: string; seed: boolean }[] = (() => {
  const m = new Map<string, boolean>();
  for (const u of USERS) m.set(u.id, u.frozen);
  for (const a of C2_ACCOUNTS) {
    if (a.k1Batch) m.delete(a.id); // k1Batch 行已计入 K1_FROZEN_ACCOUNTS,从人工面剔除防双计
    else m.set(a.id, m.get(a.id) || a.st === "frozen");
  }
  return [...m.entries()].map(([id, seed]) => ({ id, seed }));
})();

// 名单(账户级 userId 维度;与 K1 IP 白名单正交)。实时新增 = params 扫 C.list.add.<uid> 派生。
export const C2_LISTS: { id: string; kind: "allow" | "block"; why: string; until: string; approver: string }[] = [
  { id: "usr_31E8", kind: "allow", why: "大客户 · 线下尽调通过", until: "2026-12-31", approver: "risklead_h ✓" },
  { id: "usr_4410", kind: "allow", why: "校园大使 · 合作账户", until: "长期", approver: "risklead_h ✓" },
  { id: "usr_0099", kind: "block", why: "司法协查 · 案号 BR-0512", until: "长期", approver: "super_w ✓" },
];
export const LIST_BASE = { allow: 40, block: 16 }; // 样本窗以外存量 → 42 / 17

// 模拟登录会话(进行中 IMP-204 沿用旧真写键 C.impersonate.IMP-204.ended)。
export const IMPERSONATIONS = [
  {
    id: "IMP-204", op: "cs_amy", target: "usr_2231", live: true, leftMin: 14, pct: 47, ticket: "T-9002",
    trail: [
      ["进入模拟会话(只读凭证签发)", "14:08", "✓"],
      ["查看提现页 · 复现报错", "14:10", "✓"],
      ["查看资产页", "14:12", "✓"],
      ["尝试点「提现」→ 被服务器拒绝 403", "14:13", "⊘ 写拦截"],
    ] as [string, string, string][],
    kv: [["授权操作确认", "cs_amy 执行门槛:risklead_h "], ["只读拦截次数", "1 次(提现)"], ["起止", "14:08 起 · 进行中"], ["A2 审计", "IMPERSONATE-T9002"]] as [string, string][],
  },
  {
    id: "IMP-198", op: "cs_amy", target: "usr_90F0", live: false, dur: "22min", when: "昨天", ticket: "T-8841",
    trail: [
      ["进入模拟会话", "昨 16:40", "✓"],
      ["查看设备页 · 核实日产", "昨 16:44", "✓"],
      ["查看账单页", "昨 16:51", "✓"],
      ["会话到期自动断线", "昨 17:02", "✓"],
    ] as [string, string, string][],
    kv: [["授权操作确认", "cs_amy 执行门槛:risklead_h "], ["只读拦截次数", "0 次"], ["起止", "昨 16:40 → 17:02 止"], ["A2 审计", "IMPERSONATE-T8841"]] as [string, string][],
  },
];

/* ============ C3 余额资产调整 ============ */
// 待确认队列:沿用旧 ADJ id + C.adjust.<id>.status 真写键(已 persist 裁决继续生效)。
// ADJ-7741 +$1,200 > $500 → 超额升级演示位(执行门槛 = 财务主管/超管)。
export type AdjustRow = {
  id: string; userId: string; obj: "USDT" | "NEX" | "积分"; delta: number; kind: string;
  operator: string; reason: string; ts: string; escalated: boolean; credit: boolean;
};
export const ADJUST_QUEUE: AdjustRow[] = [
  // ADJ-7741 与首页待办 SENSITIVE_OPERATIONS 操作确认-2037 / AUDIT 13:40(admin.balance_adjusted 发起层留痕)同一事件:
  // support·张 发起 +$1,200 USDT 客诉补偿(工单 #88213),34m 前,超额待财务主管 —— 三表单一叙事。
  { id: "ADJ-7741", userId: "usr_84F2", obj: "USDT", delta: 1200, kind: "客诉补偿", operator: "support·张", reason: "客诉补偿(工单 #88213)", ts: "34m", escalated: true, credit: true },
  { id: "ADJ-3188", userId: "usr_31E8", obj: "USDT", delta: 480, kind: "活动补发", operator: "growth·王", reason: "里程碑奖励漏发补记", ts: "1h", escalated: false, credit: true },
  { id: "ADJ-0029", userId: "usr_02A9", obj: "USDT", delta: -260, kind: "系统纠错", operator: "finance·李", reason: "佣金误算红冲", ts: "3h", escalated: false, credit: false },
];

// 挂起状态机(SPEC C3:TTL 7 天 / 操作员取消仍需操作确认 / 重新执行确认再实时验红线)。
// 真写 C.adjust.ADJ-1182.status = approved(重新触发放行)/ cancelled(撤销)。
export const SUSPENDED_ADJ = {
  id: "ADJ-1182", userId: "usr_8807", delta: 380, obj: "USDT" as const,
  leftDays: 5, rejectedAt: "5/29", rejectedCov: "99.2",
};

// 调整历史(已落账;最新一笔 = 今天,与 D4 BILLS BL-99823 同号互链 —— adjustment 账单类双事件演示)。
export const ADJUST_HIST: {
  id: string; userId: string; obj: "USDT" | "NEX" | "积分"; deltaLabel: string; credit: boolean;
  reason: string; chain: string; escalated: boolean; sink: string; sinkBill: boolean; t: string;
}[] = [
  { id: "ADJ-1183", userId: "usr_2231", obj: "USDT", deltaLabel: "+$120", credit: true, reason: "客服补偿 · 工单 T-8812", chain: "cs_amy → fin_j ✓", escalated: false, sink: "账单 BL-99823", sinkBill: true, t: "今天 14:30" },
  { id: "ADJ-1179", userId: "usr_90F0", obj: "USDT", deltaLabel: "−$35", credit: false, reason: "系统纠错 · 重复入账冲回", chain: "fin_j → finlead_q ✓", escalated: false, sink: "账单 BL-99741", sinkBill: true, t: "5/26" },
  { id: "ADJ-1177", userId: "usr_77D4", obj: "积分", deltaLabel: "+200 分", credit: true, reason: "活动补发 · 签到漏记", chain: "growth_m → lead ✓", escalated: false, sink: "审计 #A-22841", sinkBill: false, t: "5/24" },
  { id: "ADJ-1175", userId: "usr_31E8", obj: "NEX", deltaLabel: "+1,200", credit: true, reason: "争议退回 · 兑换故障", chain: "cs_amy → finlead_q ✓", escalated: true, sink: "账单 BL-99702", sinkBill: true, t: "5/22" },
];

export const C3_STATS = {
  monthCnt: 47,
  monthSum: "$3,820 + 12,400 NEX + 2,100 分",
  capUsd: 500,     // 单笔超此值自动升级确认层
  capPoints: 1_000, // 积分单笔上限
};

/* ============ C4 KYC 合规台账 ============ */
// 三段闭合 REGISTERED_USERS;复审中 1,170 = 复审状态用户存量(含等待用户补件的长尾),
// 其中 K5 当前在审工单 = K_RISK.reviewOpenBase + 样本窗 4 = 14(c4 stat sub 引用,两口径并示)。
// 与 B3 漏斗「绑卡 $1 KYC」97,300 的 Δ80:漏斗计 kyc.express_verified 事件(日批 T-1 快照),
// 台账为实时状态(含人工标记/线下尽调通道,不产 express 事件)—— 两口径不强求相等。
export const C4_STATS = {
  unverified: 31_020,
  inReview: 1_170,
  k5OpenTickets: K_RISK.reviewOpenBase + 4, // 14 · 与 K5 队列同源
  verified: REGISTERED_USERS - 31_020 - 1_170, // 96,210
  feeUsd: 1,
};

// 台账行:C4 = 实名状态唯一真相源(C1 列表的 KYC 列也从这里 join,不读 USERS.kyc 自存);
// 77D4 = 基础态已验证(快速实名)+ K5 复审 overlay(KR-7738)→ 台账态 review,USERS.kyc 只表达基础态;
// 配对地址 = WITHDRAWALS 同链同址。
export type KycRow = {
  id: string; st: "verified" | "none" | "review"; addr: string; net: string; at: string; src: string;
  info: [string, string][]; hist: string[];
};
export const C4_LEDGER: KycRow[] = [
  {
    id: "usr_77D4", st: "review", addr: "TBn8****1p", net: "TRC20", at: "5/30", src: "累计兑换过线",
    info: [["当前状态", "复审中(K5 工单 KR-7738 · 剩 2 天)"], ["钱包已配对", "是"], ["配对地址", "TBn8****1p"], ["网络", "TRC20"], ["配对时间", "2026-05-30"], ["关联簇", "CL-322(K1 · 待判)"]],
    // 触发时刻与 K5_TICKETS KR-7738 单一时间线(6/03 16:40 触发 · 6/05 补件;SLA 剩 2 天自洽于 6/03 + 7 工作日)。
    hist: ["6/05 · K5 要求补充材料 · 已通知用户", "6/03 · 复审触发(终身累计兑换 $112 过 $100 线)→ 升复审中", "5/30 · $1 配对验证通过 · 快速实名", "5/30 · 注册"],
  },
  {
    id: "usr_31E8", st: "verified", addr: "TR7N****f2", net: "TRC20", at: "1/02", src: "首次提现",
    info: [["当前状态", "已验证(K5 复审中 KR-7741 · 大额 $8,200)"], ["钱包已配对", "是"], ["配对地址", "TR7N****f2"], ["网络", "TRC20"], ["配对时间", "2026-01-02"]],
    hist: ["6/10 · K5 大额复审触发(WD-90412 $8,200,复审期间该单 hold)", "1/02 · $1 配对验证通过(首次提现触发)", "2025-12-11 · 注册"],
  },
  {
    id: "usr_2231", st: "verified", addr: "bc1q****7e", net: "BTC", at: "2025-11", src: "主动验证",
    info: [["当前状态", "已验证(K5 复审超时升级中 KR-7702)"], ["钱包已配对", "是"], ["配对地址", "bc1q****7e"], ["网络", "BTC"], ["配对时间", "2025-11-20"]],
    hist: ["5/20 · K5 大额复审触发(WD-90396 单笔 $1,950 · 已超时升级风控主管)", "2025-11-20 · 主动验证通过"],
  },
  {
    id: "usr_55B1", st: "none", addr: "—", net: "—", at: "—", src: "—",
    info: [["当前状态", "未验证(账户已冻结 · C2)"], ["钱包已配对", "否"], ["提示", "该用户发起首次提现时将被要求实名"]],
    hist: ["5/22 · 账户冻结(风控命中,见 C2 台账)", "5/19 · 注册"],
  },
  {
    id: "usr_90F0", st: "verified", addr: "TQxm****9c", net: "TRC20", at: "5/22", src: "首次提现",
    info: [["当前状态", "已验证"], ["钱包已配对", "是"], ["配对地址", "TQxm****9c"], ["网络", "TRC20"], ["配对时间", "2026-05-22"]],
    hist: ["5/22 · $1 配对验证通过(首次提现触发)", "5/22 · 注册"],
  },
];
export const KYC_STATE: Record<KycRow["st"], [label: string, tone: string]> = {
  verified: ["已验证", "ok"], none: ["未验证", "dim"], review: ["复审中", "warn"],
};
export const KYC_NETWORKS = "TRC20 / ERC20 / BTC / ETH";

/* ============ C5 安全会话 ============ */
// 锁定数与 C6 同源(214 = 短 198 + 长 16);今日凭证异常回收 = refresh 重用检测整链踢线。
export const SEC = {
  activeSessions: 96_420,
  twofaRate: 38.2,
  lockedShort: 198,
  lockedLong: 16,
  tokenReuseToday: 3,
};

// usr_2231 会话(C2 账户明细「活跃会话 3 个」同源同行;ss id 单一定义,两页引用)。
export const SESSIONS_2231: { id: string; ip: string; dev: string; last: string; fp: string; geo: string; tok: string; trail: [string, string, string][] }[] = [
  { id: "ss_88a2", ip: "45.142.××", dev: "iOS · App", last: "2 小时前", fp: "a1b2c3 · iOS 17.4 · Safari", geo: "新加坡(与常用地一致)", tok: "短凭证 4h · 长凭证 30d", trail: [["首次登录 · 密码 + 短信", "3 周前", "✓"], ["本次活跃", "2 小时前", "✓"]] },
  { id: "ss_77f1", ip: "103.86.××", dev: "macOS · Web", last: "10 分钟前 · 当前", fp: "d4e5f6 · macOS 14 · Chrome", geo: "上海(静态 IP)", tok: "短凭证 4h · 长凭证 30d · 本次滑动续签", trail: [["登录 · 密码 + 2FA", "今天", "✓"], ["当前会话(本机)", "10 分钟前", "✓"]] },
  { id: "ss_61c0", ip: "185.220.××", dev: "Android · App", last: "29 天前 · 快过期", fp: "g7h8i9 · Android 14 · App", geo: "荷兰(疑代理 IP)", tok: "长凭证剩 1 天过期", trail: [["登录 · 密码", "29 天前", "✓"], ["长期无活动 · 即将过期", "—", "⚠"]] },
];

// 锁定台账(解锁两档:短锁仍需操作确认 二验即时 / 长锁 操作确认 + 二验;阈值在 C6 配,处置权在本页)。
export const LOCKS = [
  { id: "usr_8807", type: "15min" as const, why: "密码连错 5 次", left: "剩 8 分钟" },
  { id: "usr_3315", type: "24h" as const, why: "密码连错 10 次 · 已触发强制重置", left: "剩 16 小时" },
];

// 凭证参数(C.sess.<key> 真写;step-up 再验证线 V1 只读,可配化待开发确认)。
export const CRED_PARAMS = [
  { key: "accessTtl", name: "短凭证有效期", sub: "过期静默续签", cur: "4 小时", note: "范围 1–24h · 只对新签发" },
  { key: "refreshTtl", name: "长凭证有效期", sub: "每次续签重置(滑动窗口)+ 轮换", cur: "30 天", note: "范围 7–90 天 · 只对新签发" },
  { key: "sessionIdle", name: "会话不活跃过期", sub: "超过就失效,要重新登录", cur: "30 天", note: "范围 7–90 天 · 实时按新阈值判" },
];
export const STEPUP_RO = { name: "敏感操作再验证线", cur: "7 天", sub: "超过 N 天没活跃的会话,提现/改密/关 2FA 前要再验一次 · 目前写死 7 天,可配化等开发确认" };

/* ============ C6 注册登录风控 ============ */
export const C6_STATS = {
  otpToday: 31_240,
  captchaTrigToday: 412,
  locked: SEC.lockedShort + SEC.lockedLong, // 214 · 与 C5 单源
  stuffingClusters7d: 38,
};

// 参数行(C.regrisk.<key> 真写;每个 PRD 参数独立 key 独立写路径 —— 字段级门)。
export const C6_PARAMS: { group: "otp" | "lock" | "captcha"; key: string; name: string; sub: string; cur: string; note: string }[] = [
  { group: "otp", key: "otpTtl", name: "有效期", sub: "过期作废,客户端只做格式校验,真值在服务器", cur: "5 分钟", note: "范围 1–15 分钟 · 新发的按新值" },
  { group: "otp", key: "otpCooldown", name: "重发冷却", sub: "防短信轰炸的第一道闸", cur: "60 秒", note: "范围 30–300 秒 · 实时" },
  { group: "otp", key: "otpMax24h", name: "同号 24h 上限", sub: "超过就要先过人机验证才发", cur: "3 次", note: "范围 1–10 次 · 实时,联动人机验证触发" },
  { group: "lock", key: "lockShort", name: "短锁", sub: "密码或两步验证连错触发 · 锁定期间一切登录和验证码都拒", cur: "5 次 / 15 分钟", note: "次数 3–10 · 时长 5–60 分钟" },
  { group: "lock", key: "lockLong", name: "长锁", sub: "连错升级 · 触发后强制走密码重置", cur: "10 次 / 24 小时", note: "次数 5–20 · 时长 12–48 小时" },
  // 注:设计稿 CAPTCHA 卡的「触发阈值」与 OTP 卡「同号 24h 上限」是同一参数(SPEC §6 单一线:
  // 同号 24h 3 次 → 超线触发 CAPTCHA)。设计稿拆两行是自带双源,按「防参数配两套打架」铁律
  // 收敛:唯一写路径 = otpMax24h,CAPTCHA 卡该行改只读镜像(c6 组件渲染)。
];

// K1 三参数:本页提交一律 422 拒收(接口层强制单一入口;suggestedPath 仅导航建议非 redirect)。
// k1 键名 = k-tabs K1_PARAMS 权威键(K.k1.<param>),不发明别名。
export const K1_REJECT_CODE = "MULTI_ACCOUNT_PARAM_BELONGS_TO_K1";
export const K1_PARAMS = [
  { name: "同 IP 24h 注册上限", k1: "maxSignupPerIp24h" },
  { name: "同设备绑定账户上限", k1: "maxAccountsPerDevice" },
  { name: "同支付工具绑定上限", k1: "maxAccountsPerPaymentInstrument" },
];
export const K1_PATH = "/risk/multi-account";
