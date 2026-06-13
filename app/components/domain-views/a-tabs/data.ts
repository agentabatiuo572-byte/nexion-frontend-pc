/**
 * A 域(平台基座)页面级数据 —— design_handoff_a_domain port。
 * 单源纪律(权威数值零复制,全部 join 或同源派生):
 *  - 账号 = OPERATORS(13 行,设计稿 a-view 旧 ACCOUNTS 6 行扩展,沿用 OpsAccount 结构);
 *    超管子集 = OPERATORS.filter(role==="super" && status==="enabled") → 三铁律「有效超管 ≥2」实时派生;
 *  - 角色定义 7 行 = ROLE_DEFS(与 design-data.ROLES 同源,设计稿配色 hex 全换 token);
 *  - 矩阵 = RBAC_MATRIX 16 动作 × 7 角色(设计稿 a1 MX 原样移植 + 域分组);
 *  - 安全基线 = SECURITY_BASELINES 5 行(3 锁死 + 2 可调);
 *  - 高敏动作 = OPERATION_QUEUE 14 行(扩展 design-data.SENSITIVE_OPERATIONS,id 接续 WO-8852..WO-8838,
 *    类型 fund/param/acct/sos,标记 amplifies/sos,operator 字段含角色);
 *  - 审计日志 = AUDIT_LOGS 8 行(沿用 design-data.AUDIT 真值,域筛维度 D/C/H/I/A);
 *  - 执行历史 = OPERATION_HISTORY 4 行(confirmed/rejected/canceled/expired 四终态);
 *  - 机制参数 = MECHANISM_PARAMS 5 行(reason-required / 理由长度 / 保留 13 月 / 9 大类清单 / schema);
 *  - feature flag = FEATURE_FLAGS 5 行(设计稿原 FLAGS,resourceOwner 注明发起资格);
 *  - 7 闸只读 = killSwitchReadonly 派生 design-data.KILLSWITCH(操作面在 J1/J2);
 *  - NTP / 系统健康 = NTP_SOURCE / SYSTEM_HEALTH 5 项;
 *  - 6 family = EVENT_FAMILIES + family 内事件清单(设计稿 FAMS 原样);
 *  - domain 枚举 22 已注册 + 9 待扩展;
 *  - 通用字段 6 行(简化 10 → 6,设计稿 a4-vrow 同款);口径参数 4 行;KPI 算式 8 行(权威 §2.4.6);
 *  - 扩展批次 = DOMAIN_EXTENSIONS 4 批(V3 已落 / V4 内容 / J 域 schema / V4 收口)。
 * 真写键 22 类(A.*):
 *  A.acct.<id>.{status,role,tier,tfaResetAt}(账号 CRUD)/ A.session.<sid>.killedAt(强制登出)/
 *  A.rbac.<role>.<actionId>(矩阵授权)/ A.rbac.action.<id>(新动作行)/
 *  A.sec.{sessionIdle,sessionAbs,lockShortCnt,lockShortMin}(安全基线 2 可调项)/
 *  A.appr.<id>.status(动作裁决)/ A.confirm.reasonMin / A.appr.{ret,schemaVer}(机制参数)/
 *  A.sys.{ntpSource,idempotencyWindow}(系统配置)/ A.flag.<key>.status(feature flag)/
 *  A.event.{<name>.rollout,kpi.<key>,schemaVer}(事件中台)/ A.batch.<id>.status(扩展批次)。
 * **A 域三铁律 server-canonical 承诺**(三个不变量,UI 拒写 + toast):
 *  ① 全员强制 2FA(不可关)→ toggle 2FA 必拒;
 *  ② 新账号默认零写权 → RBAC 矩阵起点全 "—";
 *  ③ 有效超管 ≥2 → 禁用最后一个超管 / 降级最后一个超管 / 删除矩阵超管授权 → UI 拒写。
 */
import { ROLES, SENSITIVE_OPERATIONS, AUDIT, KILLSWITCH } from "@/lib/mock/admin/design-data";

/* ============ A1 账号 & RBAC ============ */
export const A1_STATS = {
  totalAccounts: 13,
  activeAccounts: 12,
  disabledAccounts: 1,
  activeSessions: 14,
  effectiveSupers: 3,
  pendingAcctTickets: 2,
};

/** 角色 key 映射 design-data.ROLES 单源;角色描述与配色 = ROLE_DEFS。 */
export type RoleKey = "super" | "finance" | "risk" | "growth" | "content" | "support" | "audit";
export const ROLE_DEFS: { key: RoleKey; name: string; av: string; color: string; desc: string; scope: string }[] = [
  { key: "super", name: "超管", av: "超", color: "var(--ink-2)", desc: "全域读写 + 全域执行;账号治理与系统参数的唯一操作 / 留痕角色", scope: "全部 12 域" },
  { key: "finance", name: "财务", av: "财", color: "var(--success)", desc: "储备与应付对账、提现放行、覆盖率监控;资金类动作执行门槛为 lead/超管", scope: "B · D · L,资金类执行" },
  { key: "risk", name: "风控", av: "风", color: "var(--danger)", desc: "反作弊、KYC 复审、风险披露、应急止血;合规审查 V1 由风控代行", scope: "K · J · C4/C6 · I5" },
  { key: "growth", name: "增长", av: "增", color: "var(--warning)", desc: "节奏 dial、试用、任务活动、增长类实验;不碰资金放行与安全配置", scope: "H · B4,增长类 flag/实验" },
  { key: "content", name: "内容", av: "内", color: "var(--admin-cat-5, #9B89E0)", desc: "全站文案、推送、通知、信任内容、课程;高敏合规内容只能草拟", scope: "I 域全部" },
  { key: "support", name: "客服", av: "客", color: "var(--a-ac)", desc: "单用户范围受限操作:小额调整发起、协助 KYC 标记;确认必须主管层", scope: "C 域单用户视图" },
  { key: "audit", name: "只读审计", av: "审", color: "var(--ink-3)", desc: "零写权;全量查询与脱敏导出,取证专用", scope: "全域只读" },
];

/** 13 账号(设计稿 a1 ACC 原样移植,id 命名 op-XXX;role 用 RoleKey)。 */
export type Operator = {
  id: string; name: string; role: RoleKey; tier: "lead" | "member" | null;
  tfa: boolean; status: "enabled" | "disabled"; lastLogin: string; sessions: number;
};
export const OPERATORS: Operator[] = [
  { id: "op-001", name: "陈锐", role: "super", tier: null, tfa: true, status: "enabled", lastLogin: "今天 09:12", sessions: 2 },
  { id: "op-002", name: "赵敏", role: "super", tier: null, tfa: true, status: "enabled", lastLogin: "今天 08:40", sessions: 1 },
  { id: "op-007", name: "林一帆", role: "super", tier: null, tfa: true, status: "enabled", lastLogin: "昨天 22:03", sessions: 0 },
  { id: "op-011", name: "王磊", role: "risk", tier: "lead", tfa: true, status: "enabled", lastLogin: "今天 10:01", sessions: 2 },
  { id: "op-012", name: "许晴", role: "risk", tier: null, tfa: true, status: "enabled", lastLogin: "今天 09:55", sessions: 1 },
  { id: "op-021", name: "李文", role: "content", tier: "lead", tfa: true, status: "enabled", lastLogin: "今天 09:30", sessions: 2 },
  { id: "op-024", name: "周倩", role: "content", tier: null, tfa: true, status: "enabled", lastLogin: "06-10 17:20", sessions: 0 },
  { id: "op-031", name: "吴桐", role: "finance", tier: "lead", tfa: true, status: "enabled", lastLogin: "今天 08:15", sessions: 1 },
  { id: "op-032", name: "郑爽", role: "finance", tier: null, tfa: true, status: "enabled", lastLogin: "今天 09:48", sessions: 1 },
  { id: "op-041", name: "高翔", role: "growth", tier: null, tfa: true, status: "enabled", lastLogin: "06-10 20:11", sessions: 0 },
  { id: "op-051", name: "刘佳", role: "support", tier: null, tfa: true, status: "enabled", lastLogin: "今天 10:05", sessions: 3 },
  { id: "op-061", name: "审计专户", role: "audit", tier: null, tfa: true, status: "enabled", lastLogin: "06-09 14:00", sessions: 1 },
  { id: "op-018", name: "何斌(已离职)", role: "risk", tier: null, tfa: true, status: "disabled", lastLogin: "05-20 11:32", sessions: 0 },
];

/** RBAC 矩阵 16 动作 × 7 角色;cell 类型:M(可发起)/ C(lead 执行门槛)/ R(只读)/ -(无权)。 */
export type GrantCell = "M" | "C" | "R" | "-";
export type MatrixAction = {
  id: string; action: string;
  domainGroup: "资金" | "用户/风控" | "增长/内容" | "基座/应急";
  grants: [super_: GrantCell, finance: GrantCell, risk: GrantCell, growth: GrantCell, content: GrantCell, support: GrantCell, audit: GrantCell];
};
export const RBAC_MATRIX: MatrixAction[] = [
  { id: "balance_adjust", action: "余额/资产调整(C3)", domainGroup: "用户/风控", grants: ["C", "C", "-", "-", "-", "M", "R"] },
  { id: "user_freeze", action: "账户冻结/解冻(C2)", domainGroup: "用户/风控", grants: ["C", "-", "M", "-", "-", "-", "R"] },
  { id: "withdraw_approve", action: "提现放行/冻结(D2)", domainGroup: "资金", grants: ["C", "M", "M", "-", "-", "-", "R"] },
  { id: "bill_adjust", action: "账单手工调整(D4)", domainGroup: "资金", grants: ["C", "M", "-", "-", "-", "-", "R"] },
  { id: "coverage_line", action: "覆盖率红黄线(B1)", domainGroup: "资金", grants: ["C", "M", "-", "-", "-", "-", "R"] },
  { id: "withdraw_param", action: "提现参数(D5)", domainGroup: "资金", grants: ["C", "M", "M", "-", "-", "-", "R"] },
  { id: "risk_model", action: "风险模型权重(K4)", domainGroup: "用户/风控", grants: ["C", "-", "M", "-", "-", "-", "R"] },
  { id: "kyc_decide", action: "大额 KYC 裁决(K5)", domainGroup: "用户/风控", grants: ["C", "-", "M", "-", "-", "-", "R"] },
  { id: "phase_dial", action: "Phase dial(H1)", domainGroup: "增长/内容", grants: ["C", "-", "C", "M", "-", "-", "R"] },
  { id: "content_publish", action: "文案/课程发布(I)", domainGroup: "增长/内容", grants: ["C", "-", "-", "-", "M", "-", "R"] },
  { id: "disclosure_publish", action: "风险披露发布(I5)", domainGroup: "增长/内容", grants: ["C", "-", "M", "-", "-", "-", "R"] },
  { id: "killswitch_toggle", action: "功能闸熔断(J1)", domainGroup: "基座/应急", grants: ["C", "M", "M", "-", "-", "-", "R"] },
  { id: "geo_block", action: "地区屏蔽(J2)", domainGroup: "基座/应急", grants: ["C", "-", "M", "-", "-", "-", "R"] },
  { id: "feature_flag", action: "feature flag(A3)", domainGroup: "基座/应急", grants: ["C", "-", "-", "M", "-", "-", "R"] },
  { id: "operator_governance", action: "运营账号治理(A1)", domainGroup: "基座/应急", grants: ["M", "-", "-", "-", "-", "-", "R"] },
  { id: "audit_export", action: "审计全量导出(A2)", domainGroup: "基座/应急", grants: ["M", "-", "-", "-", "-", "-", "M"] },
];

/** A1 安全基线 5 行:3 锁死(强制 2FA / 最小权限 / ≥2 超管)+ 2 可调(session / 双档锁)。 */
export const SECURITY_BASELINES = [
  { key: "tfa_required", name: "强制双因子(全角色)", sub: "没绑双因子完不成登录——安全基线,不开口子", value: "🔒 强制开启", locked: true },
  { key: "least_priv", name: "最小权限默认", sub: "新账号默认无任何写权,角色要显式分配", value: "🔒 默认拒绝", locked: true },
  { key: "min_supers", name: "最少有效超管", sub: "少于 2 个时账号治理类操作全部被服务器拒绝(防权限死锁)", value: "🔒 ≥ 2 个", locked: true },
  { key: "session", name: "session 时限", sub: "无操作滑动过期 / 登录后绝对上限;比用户侧明显更短(操盘台高敏)", value: "30min / 8h", locked: false },
  { key: "lock", name: "登录失败双档锁", sub: "短锁:连错即锁;长锁:24h 锁定 + 双因子重认证(阈值高于用户侧,独立设定)", value: "5 次/15min · 15 次/24h", locked: false },
];

/* ============ A2 审计 & 操作确认中心 ============ */
export const A2_STATS = {
  pendingTickets: 14,
  fundTickets: 5,
  sosTickets: 1,
  todayAuditEvents: 3_482,
  weeklyApproved: 86,
  weeklyRejected: 9,
  weeklyExpired: 3,
  weeklyWithdrawn: 2,
};

/** 高敏动作类型(设计稿 fund/param/acct/sos)+ 标记(amplifies/sos)+ 执行门槛。 */
export type OperationType = "fund" | "param" | "acct" | "sos";
export type OperationRow = {
  id: string; action: string; obj: string;
  before: string; after: string;
  operator: string; operatorRole: RoleKey;
  type: OperationType; amplifies: boolean; sos: boolean;
  ts: string; mine: boolean;
  /** 执行门槛(SPEC §4 + README 速查;UI 在 操作确认 modal detail 内呈现)。 */
  roleGate: string;
  /** 提案原因(发起人填,详情 drawer 用)。 */
  reason: string;
};
export const OPERATION_QUEUE: OperationRow[] = [
  { id: "WO-8852", action: "提现放行(大额操作确认)", obj: "usr-7F21 · $8,200", before: "review", after: "approved", operator: "郑爽(财务)", operatorRole: "finance", type: "fund", amplifies: true, sos: false, ts: "2m", mine: false, roleGate: "财务 lead / 超管", reason: "用户工单 #4471 核实补偿;依据已附" },
  { id: "WO-8851", action: "账单手工调整", obj: "bill-2K8842 · 误扣冲正", before: "—", after: "+$214.00", operator: "吴桐(财务 lead)", operatorRole: "finance", type: "fund", amplifies: true, sos: false, ts: "18m", mine: false, roleGate: "财务 lead / 超管", reason: "客服工单 #4488 误扣证据齐全" },
  { id: "WO-8850", action: "J1 熔断恢复 · exchange 闸", obj: "J 域 · 兑换能力", before: "disabled", after: "enabled", operator: "王磊(风控 lead)", operatorRole: "risk", type: "sos", amplifies: false, sos: true, ts: "42m", mine: false, roleGate: "超管(应急轨)", reason: "风险事件已闭环,SLA 内恢复" },
  { id: "WO-8849", action: "课程奖励上调(I7)", obj: "genesis-nodes · +40→+45 NEX", before: "+40", after: "+45", operator: "李文(内容 lead)", operatorRole: "content", type: "fund", amplifies: true, sos: false, ts: "36m", mine: false, roleGate: "内容 lead / 超管", reason: "P3 阶段教育引流提升,B1 覆盖率核验通过" },
  { id: "WO-8848", action: "余额调整(客服小额)", obj: "usr-9C03 · 补偿", before: "$0", after: "+$36.00", operator: "刘佳(客服)", operatorRole: "support", type: "fund", amplifies: true, sos: false, ts: "34m", mine: false, roleGate: "财务 lead / 超管", reason: "客诉 ticket #5512 已核实" },
  { id: "WO-8847", action: "Phase dial · 周任务倍率", obj: "H1 · P3 月档", before: "1.25×", after: "1.30×", operator: "高翔(增长)", operatorRole: "growth", type: "param", amplifies: true, sos: false, ts: "1h", mine: false, roleGate: "对应域 lead / 超管(dial 放大方向加风控 lead)", reason: "本周 KPI 节奏校准,7 日窗口实验" },
  { id: "WO-8846", action: "OTP 发送频次(C6)", obj: "注册风控", before: "3 次/小时", after: "5 次/小时", operator: "许晴(风控)", operatorRole: "risk", type: "param", amplifies: false, sos: false, ts: "2h", mine: false, roleGate: "风控 lead / 超管", reason: "正常用户重发投诉激增,放宽频控" },
  { id: "WO-8845", action: "风险模型权重(K4)", obj: "多账户信号权重", before: "0.32", after: "0.40", operator: "王磊(风控 lead)", operatorRole: "risk", type: "param", amplifies: false, sos: false, ts: "3h", mine: false, roleGate: "超管 / 风控 lead", reason: "K1 簇击中样本回归,权重需上调" },
  { id: "WO-8844", action: "账户冻结(C2)", obj: "usr-1A77 · 套利簇关联", before: "active", after: "frozen", operator: "许晴(风控)", operatorRole: "risk", type: "acct", amplifies: false, sos: false, ts: "4h", mine: false, roleGate: "风控 lead / 超管", reason: "K1 多账户簇命中,套利路径已闭合证据" },
  { id: "WO-8843", action: "披露新版发布(I5)", obj: "SFC · v12→v13", before: "v12", after: "v13", operator: "王磊(风控 lead)", operatorRole: "risk", type: "acct", amplifies: false, sos: false, ts: "5h", mine: false, roleGate: "风控 lead / 超管", reason: "监管发函要求条款更新,7 日内全量重确认" },
  // SPEC §4「创建运营账号」仅超管可执行,本行作为账号治理类高敏动作演示。
  { id: "WO-8842", action: "运营账号创建(A1)", obj: "新风控成员", before: "—", after: "op-072", operator: "赵敏(超管)", operatorRole: "super", type: "acct", amplifies: false, sos: false, ts: "6h", mine: false, roleGate: "超管", reason: "新员工入职,风控成员岗 op-072" },
  { id: "WO-8840", action: "feature flag · 灰度 20%", obj: "新提现页灰度", before: "off", after: "20%", operator: "高翔(增长)", operatorRole: "growth", type: "param", amplifies: false, sos: false, ts: "8h", mine: false, roleGate: "超管", reason: "新提现 UX A/B,灰度 20% 7 日观察" },
  { id: "WO-8839", action: "储备注入登记(B1/D3)", obj: "+$500K 入储备池", before: "—", after: "+$500K", operator: "吴桐(财务 lead)", operatorRole: "finance", type: "fund", amplifies: false, sos: false, ts: "12h", mine: false, roleGate: "财务 lead / 超管", reason: "财务季度调拨,提升 B1 覆盖率 +5pp" },
  { id: "WO-8838", action: "提现参数 · 冷却时长(D5)", obj: "非 Phase 参数", before: "48h", after: "36h", operator: "吴桐(财务 lead)", operatorRole: "finance", type: "param", amplifies: true, sos: false, ts: "14h", mine: true, roleGate: "财务 lead / 超管", reason: "缩短冷却提升用户体验,逐步降低摩擦" },
];

/** 8 行审计日志(沿用 design-data.AUDIT 真值 + 域分类)。域映射 D/C/H/I/A。 */
export type AuditDomain = "D" | "C" | "H" | "I" | "A" | "K" | "B";
export const AUDIT_LOGS: { ts: string; actor: string; role: string; action: string; obj: string; delta: string; domain: AuditDomain; ip: string }[] = [
  { ts: "今天 10:12", actor: "王磊", role: "风控 lead", action: "killswitch_toggled", obj: "J1 · exchange 闸", delta: "enabled → disabled", domain: "A", ip: "10.2.3.21" },
  { ts: "今天 09:21", actor: "吴桐", role: "财务 lead", action: "withdraw_approved", obj: "D2 · usr-7F21 $12,400", delta: "review → sent", domain: "D", ip: "10.2.3.31" },
  { ts: "今天 09:02", actor: "李文", role: "内容 lead", action: "content_published", obj: "I1 · home.conversionBanner", delta: "v7 → v8", domain: "I", ip: "10.2.3.41" },
  { ts: "今天 08:55", actor: "陈锐", role: "超管", action: "operator_role_changed", obj: "A1 · op-041", delta: "增长 → 增长(lead)", domain: "A", ip: "10.2.3.11" },
  { ts: "今天 08:40", actor: "吴桐", role: "财务 lead", action: "operation_rejected", obj: "H5 · 幸运 2× 概率", delta: "5% → 8%(驳回)", domain: "H", ip: "10.2.3.31" },
  { ts: "昨天 21:18", actor: "许晴", role: "风控", action: "user_frozen", obj: "C2 · usr-1A77", delta: "active → frozen", domain: "C", ip: "10.2.3.22" },
  { ts: "昨天 18:02", actor: "刘佳", role: "客服", action: "operation_withdrawn", obj: "C3 · usr-9C03 余额", delta: "+$36(撤回)", domain: "C", ip: "10.2.3.51" },
  { ts: "昨天 15:44", actor: "高翔", role: "增长", action: "phase_dial_changed", obj: "H1 · 周任务倍率", delta: "1.20× → 1.25×", domain: "H", ip: "10.2.3.41" },
];

/** 4 行执行历史(approved/rejected/withdrawn/expired 四终态)。 */
export const OPERATION_HISTORY = [
  { id: "WO-8841", action: "提现放行 $12,400", st: "approved", chain: "吴桐(财务 lead) · reason + admin.operation_confirmed", t: "今天 09:21", note: "原因:大额操作确认线上人工核验,KYC 与风险分均过" },
  { id: "WO-8836", action: "幸运 2× 概率 5%→8%", st: "rejected", chain: "吴桐(财务 lead) · reason + admin.operation_rejected", t: "今天 08:40", note: "取消原因:本周代币流出已超预算 12%,下周再议" },
  { id: "WO-8830", action: "余额调整 +$50", st: "withdrawn", chain: "刘佳(客服) · reason + admin.operation_cancelled", t: "昨天 18:02", note: "取消原因:用户工单重复,已有在途补偿" },
  { id: "WO-8798", action: "OTP 频次参数", st: "expired", chain: "许晴(风控) · reason 校验未通过", t: "06-08 00:00", note: "作废事件落审计(admin.operation_expired)" },
] as const;

/** 机制参数 5 行:reason-required + reasonMin + 保留期 + 9 大类清单 + schema。 */
export const MECHANISM_PARAMS = [
  { key: "reason_required", name: "理由必填", sub: "所有高敏动作的确认弹窗都校验 reason,为空或过短不写 store", value: "🔒 强制", locked: true },
  { key: "ttl", name: "理由最短长度", sub: "默认 8 字;用于确认弹窗提交前校验,历史审计原文保留", value: "8 字", locked: false },
  { key: "retention", name: "日志保留期", sub: "覆盖整个 12 月运营周期 + 1 个月缓冲,合规取证底线(下限锁 13 个月)", value: "13 个月", locked: false },
  { key: "confirm_list", name: "操作确认适用动作清单", sub: "哪些动作必须打开独立确认弹窗——汇总自各域,随新增高敏动作同步更新", value: "9 大类", locked: false },
  { key: "schema", name: "审计字段结构", sub: "全后台统一一套字段;加事件/加属性走注册流程", value: "统一 schema", locked: false },
] as const;

/** 9 大类操作确认清单(drawer 详情)。 */
export const CONFIRM_CATEGORIES = [
  { cat: "资金/资产调整", examples: "余额增减(C3)· 手工账单(D4)· 储备注入(B1/D3)· 对账核销(D1)", roleGate: "财务 lead / 超管" },
  { cat: "大额资金放行", examples: "提现放行/冻结/退款(D2)· 渠道退款(D1)", roleGate: "财务 lead / 超管" },
  { cat: "参数批改", examples: "红黄线(B1)· 提现参数(D5)· OTP/锁定(C6)· Phase dial(H1)· 试用敏感参数(H2)", roleGate: "对应域 lead / 超管(dial 放大方向加风控 lead)" },
  { cat: "风险模型/KYC 裁决", examples: "K4 权重分档(执行门槛升超管)· K5 大额复审", roleGate: "超管 / 风控 lead" },
  { cat: "熔断闸", examples: "6 功能闸 + 地区屏蔽(J1/J2 管理面)", roleGate: "超管" },
  { cat: "账户高敏处置", examples: "冻结/解冻 · impersonate(C2)· KYC 人工标记(C4)· 2FA/密码(C5)", roleGate: "风控 lead / 超管" },
  { cat: "批量簇冻结", examples: "关联账户簇批量冻结(K1)", roleGate: "风控 lead / 超管" },
  { cat: "后台账号治理", examples: "建/停/启/改角色/重置双因子(A1)", roleGate: "超管" },
  { cat: "平台配置", examples: "feature flag · 系统参数(A3)· 内容发布(I 域)", roleGate: "超管 / 内容 lead" },
];

/* ============ A3 系统配置 ============ */
export const A3_STATS = {
  clockDrift: "+4 ms",
  driftThreshold: "±100ms",
  idempBlocked24h: 312,
  flagCount: 5,
  flagGrayCount: 2,
  killGates: 7,
  killGatesUp: 7,
};

export const NTP_SOURCE = { current: "pool.ntp.org ×3", note: "三源仲裁,稳定性优先;切换走超管操作确认" };

/** 5 feature flag(横切类,业务主参数不入)。resourceOwner = 发起资格(SPEC §4)。 */
export const FEATURE_FLAGS = [
  { key: "ab.newWithdrawFlow", st: "灰度 20%", scope: "全量随机", lastChange: "06-09 · 高翔/陈锐", resourceOwner: "增长可发起", growthClass: true },
  { key: "ab.homeBannerExp", st: "on", scope: "注册周 ≥W20", lastChange: "06-05 · 高翔/陈锐", resourceOwner: "增长可发起", growthClass: true },
  { key: "exp.questBoostAB", st: "on", scope: "P3 阶段用户", lastChange: "06-02 · 高翔/陈锐", resourceOwner: "增长可发起", growthClass: true },
  { key: "core.sse_v2", st: "灰度 50%", scope: "全量随机", lastChange: "05-28 · 陈锐/赵敏", resourceOwner: "超管(平台能力)", growthClass: false },
  { key: "ops.maintenanceBanner", st: "off", scope: "全量", lastChange: "05-15 · 陈锐/赵敏", resourceOwner: "风控/超管(运维)", growthClass: false },
];

/** 7 闸只读兼容(操作面在 J1/J2)。状态由 design-data.KILLSWITCH 派生 + geo-block 行(列表非空才算生效)。 */
export const killSwitchReadonly = (): { key: string; st: string; lastChange: string; chain: string }[] => {
  const fns = KILLSWITCH.map((k) => ({
    key: k.key,
    st: k.on ? "enabled" : "disabled",
    lastChange: k.lastChange,
    chain: k.lastChange.includes("/") ? k.lastChange.split(" · ")[1] ?? "— / —" : "— / —",
  }));
  return [
    ...fns,
    { key: "geo-block", st: "空列表 · 无封锁", lastChange: "—", chain: "— / —" },
  ];
};

export const SYSTEM_HEALTH = [
  { name: "事件管道(采集 → 去重 → 事件库)", tone: "ok" as const, metric: "正常 · 延迟 1.2s" },
  { name: "账本写入(资金事务)", tone: "ok" as const, metric: "正常 · p99 84ms" },
  { name: "后台接口可用性(24h)", tone: "ok" as const, metric: "99.98%" },
  { name: "NTP 同步", tone: "ok" as const, metric: "正常 · +4ms" },
  { name: "SSE 推送通道(配置失效广播)", tone: "warn" as const, metric: "轻度抖动 · 重连率 2.1%" },
];

/* ============ A4 事件中台 ============ */
export const A4_STATS = {
  todayEvents: "4.2M",
  registeredDomains: 22,
  pendingDomains: 9,
  batchDone: 2,
  batchTotal: 4,
  schemaVersion: "v3",
};

/** 6 family + 内嵌事件清单(设计稿 FAMS 原样移植)。 */
export type EventFamily = {
  key: string; title: string; sub: string; sample: string;
  serverAuth: string; todayCount: string;
  events: [name: string, desc: string][];
};
export const EVENT_FAMILIES: EventFamily[] = [
  {
    key: "acquisition", title: "① 获客漏斗", sub: "注册→绑卡的获客链路 + Day0 接入",
    sample: "app.session_started · auth.register_completed · kyc.express_verified · device.first_yield_received",
    serverAuth: "部分(注册/验证类服务器发)", todayCount: "1.4M",
    events: [
      ["app.session_started", "会话开始(端上)"],
      ["onboarding.intro_viewed", "引导页曝光(端上)"],
      ["auth.register_started / otp_sent / otp_verified / register_completed", "注册四步(服务器)"],
      ["referral.link_opened / referral.bound", "推荐链路与绑定"],
      ["kyc.express_started / express_paid / express_verified", "绑卡 $1 验证三步"],
      ["device.first_yield_received", "首笔收益到账(带延迟秒数,KPI #1)"],
    ],
  },
  {
    key: "conversion", title: "② 转化", sub: "逛店→下单→试用→邀请",
    sample: "store.viewed · checkout.completed · trial.started · referral.invite_sent",
    serverAuth: "下单/试用服务器发", todayCount: "620K",
    events: [
      ["store.viewed / product.detail_viewed", "逛商城(KPI #3)"],
      ["checkout.started / completed", "下单两步(KPI #4)"],
      ["trial.claim_sheet_shown / started / redeemed", "试用三步"],
      ["upsell.chip_clicked", "加购点击"],
      ["referral.invite_sent", "发出邀请(KPI #5)"],
    ],
  },
  {
    key: "money", title: "③ 资金流", sub: "钱进钱出全链路(对账与水位的源头)",
    sample: "wallet.topup_confirmed · withdraw.sent · earnings.credited · staking.opened",
    serverAuth: "全部服务器发", todayCount: "480K",
    events: [
      ["wallet.topup_initiated / confirmed", "充值两步"],
      ["withdraw.submitted / approved / rejected / delayed / frozen / sent / confirmed", "提现全状态机"],
      ["earnings.credited", "收益入账"],
      ["commission.paid", "佣金发放(KPI #7)"],
      ["staking.opened / claimed · exchange.swapped · genesis.purchased", "金融产品资金事件(KPI #8)"],
    ],
  },
  {
    key: "retention", title: "④ 留存", sub: "回访与日常参与",
    sample: "app.dau · daily.checkin · quest.completed · nova.push_clicked",
    serverAuth: "推送送达服务器发", todayCount: "1.6M",
    events: [
      ["app.dau", "日活跃(KPI #2 口径)"],
      ["daily.checkin", "每日签到"],
      ["quest.completed", "任务完成"],
      ["nova.push_sent / push_clicked", "推送送达与点击(KPI #6)"],
    ],
  },
  {
    key: "risk", title: "⑤ 风控", sub: "风险信号(服务器检测产出)",
    sample: "risk.multi_account_flagged · risk.score_updated · auth.login_locked",
    serverAuth: "全部服务器发", todayCount: "88K",
    events: [
      ["risk.multi_account_flagged", "多账户关联命中"],
      ["risk.arbitrage_suspected", "套利嫌疑"],
      ["risk.trial_cycle_detected", "循环养号"],
      ["risk.withdraw_held", "提现拦截"],
      ["risk.score_updated", "风险分更新"],
      ["risk.kyc_review_triggered", "大额复审触发"],
      ["auth.login_locked", "登录锁定"],
    ],
  },
  {
    key: "phase_admin", title: "⑥ 节奏 / admin", sub: "阶段切换 + 全部后台治理审计",
    sample: "phase.transitioned · phase.dial_changed · admin.*",
    serverAuth: "全部服务器发", todayCount: "12K",
    events: [
      ["phase.transitioned", "阶段切换"],
      ["phase.dial_changed", "dial 改动(同时落 A2 审计)"],
      ["admin.*(全后台治理事件)", "各域高敏动作审计——命名在这注册,落库在 A2"],
    ],
  },
];

/** 22 已注册 domain + 9 待扩展。 */
export const REGISTERED_DOMAINS = [
  "app", "auth", "referral", "kyc", "onboarding", "store", "checkout", "device",
  "earnings", "wallet", "withdraw", "commission", "staking", "exchange", "genesis",
  "trial", "quest", "daily", "nova", "phase", "risk", "admin",
];
export const PENDING_DOMAINS = ["event", "milestone", "nex", "premium", "repurchase", "content", "notification", "disclosure", "learn"];

/** 通用字段 6 行(设计稿 a4-vrow 简化:10 字段合并 4 行 + 2 行)。 */
export const COMMON_FIELDS = [
  { key: "event_id", name: "event_id", sub: "服务器生成唯一号,去重用", value: "必带" },
  { key: "ts", name: "ts", sub: "服务器收到时间(毫秒)——客户端时钟不算数,防改表", value: "服务器权威" },
  { key: "phase_age", name: "phase + 账户月龄", sub: "事发时用户处于 P 几——阶段效果归因的关键字段", value: "必带" },
  { key: "cohort", name: "cohort", sub: "注册周(按周分群)", value: "必带" },
  { key: "is_server_authoritative", name: "is_server_authoritative", sub: "资金/状态事件 = true(服务器发);界面交互 = false", value: "必带" },
  { key: "misc", name: "其余:身份三件套 / 归因来源 ref / 端信息", sub: "locale · 平台 · 版本号", value: "必带" },
];

/** 4 行口径参数(锚定 12 月运营周期)。 */
export const KPI_DIMENSION_PARAMS = [
  { key: "day0", name: "Day0 接入窗口", sub: "注册到首笔收益到账的达标时限(KPI #1 口径)", value: "90 秒", locked: false },
  { key: "retention", name: "留存口径", sub: "Day1 / Day7 / Day30 三窗", value: "D1·D7·D30", locked: true },
  { key: "event_retention", name: "事件留存期", sub: "完整 12 月周期 + 1 月缓冲;审计日志同口径", value: "13 个月", locked: false },
  { key: "sampling", name: "采样率", sub: "浏览/会话类抽样省成本;资金/风控/转化类永远全量", value: "浏览 10% · 资金 100%", locked: false },
];

/** 8 KPI 算式(权威 §2.4.6)。 */
export const KPI_FORMULAS = [
  { n: 1, kpi: "Day0 接入 >95%", formula: "90 秒内拿到首笔收益的人 ÷ 注册数" },
  { n: 2, kpi: "Day7 留存 >60%", formula: "第 8 字还活跃的人 ÷ 当周注册群" },
  { n: 3, kpi: "逛商城 >30%", formula: "看过商城的人 ÷ 注册数" },
  { n: 4, kpi: "下单 5–10%", formula: "完成支付的人 ÷ 看过商城的人" },
  { n: 5, kpi: "持有者推广 >40%", formula: "发过邀请的设备持有者 ÷ 持有者总数" },
  { n: 6, kpi: "Nova 点击率 >25%", formula: "推送点击 ÷ 推送送达(只认服务器送达)" },
  { n: 7, kpi: "佣金触发 >80%", formula: "直推首单产生佣金的人 ÷ 直推总数" },
  { n: 8, kpi: "Genesis 售罄 <14 天", formula: "累计售出达 1,000 张用的天数" },
];

/** 4 扩展批次(BI 上线前必办)。state: done / inprogress / pending / scheduled。 */
export type Batch = {
  id: string; title: string; state: "done" | "inprogress" | "pending" | "scheduled";
  proposer: string; impact: string;
  newDomains: { name: string; n: boolean }[];
  details: [item: string, desc: string][];
};
export const DOMAIN_EXTENSIONS: Batch[] = [
  {
    id: "v3-init", title: "V3 起始批", state: "done",
    proposer: "活动(H4)/ 里程碑(H6)/ 金融产品(G)",
    impact: "占位事件已迁回各自 domain",
    newDomains: ["event", "milestone", "nex", "premium", "repurchase"].map((d) => ({ name: d, n: true })),
    details: [
      ["event.*", "活动中心事件(H4)· 已迁回"],
      ["milestone.*", "收益里程碑(H6)· 已迁回"],
      ["nex.* / premium.* / repurchase.*", "金融产品三件套(G 域)· 已迁回"],
    ],
  },
  {
    id: "v4-content", title: "V4 内容批", state: "inprogress",
    proposer: "内容域(I1/I3/I5/I7)",
    impact: "四类事件暂记 admin 占位 + 临时编号",
    newDomains: ["content", "notification", "disclosure", "learn"].map((d) => ({ name: d, n: true })),
    details: [
      ["content.variant_exposed / converted", "文案 A/B 曝光与转化(I1/I6)· 占位中"],
      ["content.trust_section_viewed", "信任版块曝光(I4)· 占位中"],
      ["notification.delivered / read / swipe_action_taken", "通知三件套(I3)· 占位中"],
      ["disclosure.viewed / acked / reack_triggered / gated_action_blocked", "披露操作链(I5)· 占位中"],
      ["learn.course_started / quiz_passed / course_completed", "课程链(I7)· 占位中"],
    ],
  },
  {
    id: "j-schema", title: "J 域 schema 批", state: "pending",
    proposer: "应急域(J3/J4)",
    impact: "risk / admin 域内新事件,无需新 domain",
    newDomains: [
      { name: "risk.tamper_detected", n: false },
      { name: "admin.emergency_playbook_*", n: false },
    ],
    details: [
      ["risk.tamper_detected", "篡改防御命中(J3)"],
      ["admin.emergency_playbook_executed", "应急剧本执行(J4)"],
      ["admin.emergency_playbook_edited", "应急剧本编辑(J4)"],
    ],
  },
  {
    id: "v4-close", title: "V4 收口核对", state: "scheduled",
    proposer: "A4 自查",
    impact: "目标:无遗漏、无双源",
    newDomains: [],
    details: [
      ["核对范围", "12 域全部 admin.* 事件"],
      ["目标", "无遗漏 · 无双源 · 命名合规"],
      ["产出", "差异清单 → 逐条补注册或改名"],
    ],
  },
];

/** 跨域消费方 join:OPERATORS / SENSITIVE_OPERATIONS / AUDIT / KILLSWITCH 等单源(防本文件自存口径)。 */
export const _SOURCE_NOTES = {
  ROLES, // design-data.ROLES = 7 角色 token 配色单源
  SENSITIVE_OPERATIONS, // design-data.SENSITIVE_OPERATIONS = 首页高敏操作动态面板的 4 行子集,本表 14 行扩展
  AUDIT, // design-data.AUDIT = 8 行 + A2 域筛维度
  KILLSWITCH, // design-data.KILLSWITCH = 6 闸 + withdraw 后台应急新增;A3 只读派生 killSwitchReadonly
};
