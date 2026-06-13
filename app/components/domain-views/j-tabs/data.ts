/**
 * J 域(紧急与合规控制)专属 mock 数据 — design_handoff_j_domain 逐字 port。
 * 仅 j-tabs/* 消费;结构 backend-replaceable(对应 GET /api/admin/killswitch|tamper|emergency/*)。
 * 资金口径单一源:recoverGate / 覆盖率 / 红线 全部从 LEDGER 派生,不另立数值。
 */
import { LEDGER } from "@/lib/mock/admin/ledger";

/* ===== J1 · 应急快速通道 SLA 参数(J.emergency.*;默认值对齐 PRD §15.1/J1③:15min / 60min / 4 轮) ===== */
export const EMER_SLA = [
  { id: "confirmSlaMins", k: "执行门槛响应时限", d: "超过这个时间未处理,系统自动逐级往上呼叫", v: "15", unit: "分钟", kind: "number" as const },
  { id: "escalateMaxMins", k: "升级呼叫总时限", d: "超过仍无人处理就关闭这张工单 · 避免无限挂起", v: "60", unit: "分钟", kind: "number" as const },
  { id: "escalateMaxRounds", k: "最多往上呼叫几轮", d: "逐级升级呼叫的最大轮次", v: "4", unit: "轮", kind: "number" as const },
  { id: "recoverGate", k: "恢复业务的备付金门槛", d: "备付金覆盖率达到这条线,才允许恢复「会往外付钱」的业务", v: String(LEDGER.redlinePct), unit: "%", kind: "number" as const },
];

/* ===== J1 · 自动触发规则(对齐 PRD §15 J1④ R1–R4 权威表:R1/R2 真自动熔断+30min 补填理由、
 * R3 仅自动告警转人工(J3 不持处置权,阈值同源 J3 告警阈值)、R4 恒人工应急快速通道。
 * R1 阈值 = B5 挤兑红线 bankrunRed(默认 40%,J1 引用不另持;与 B5 出金压力比 e(t) 0.7 警戒线两层防线,
 * e(t) 破线人工研判、挤兑比率破 bankrunRed 才机器自动止血)。 ===== */
export const AUTO_RULES = [
  { id: "withdrawSurge", nm: "提现激增 / 挤兑", tag: "资金安全 · R1", icon: "surge", cond: ["24h 提现申请额 ÷ 真实储备 > ", "40%", "(B5 挤兑红线)→ 自动熔断 ", "提现(+可选 兑换)", " · 30min 内值班补填理由"], thrK: "触发阈值", thr: "40%", adjustable: false, refNote: "同 B5 挤兑红线", refTitle: "阈值权威归 B5(bankrunRed,默认 40%,B5 操作确认可调),J1 引用不另持;分子 = 24h 提现申请额(withdraw.submitted)/ 分母 = B1/D3 真实储备。与 B5 出金压力比 e(t)(红线 0.7,早期警戒·人工研判)两层防线,破本线才机器自动止血" },
  { id: "maturityGap", nm: "对账缺口", tag: "资金安全 · R2", icon: "gap", cond: ["充值对账 / 账本借贷不平缺口 > ", "$50K", " → 自动熔断 ", "兑换", "(停 NEX↔USDT 流出 · 待对账平)· 30min 补填理由"], thrK: "触发阈值", thr: "$50K", adjustable: true },
  { id: "tamperCluster", nm: "篡改告警激增", tag: "风控 · R3", icon: "shield", cond: ["单账户超 ", "告警阈值", " 或全域环比突增 → ", "仅自动告警 · 人工研判后手动熔断", "(J3 不持处置权)"], thrK: "触发阈值", thr: "", adjustable: false, refNote: "同 J3 告警阈值", refTitle: "阈值与 J3「告警阈值配置」同源,调整在 J3 页头完成;J1 仅引用不另持" },
  { id: "regulatoryDirective", nm: "监管指令", tag: "合规 · R4", icon: "clock", cond: ["监管点名 / 法务事件(事由必填)→ ", "人工经应急快速通道发起", "(机器不替监管判定)", "", ""], thrK: "触发方式", thr: "人工 · 应急快速通道", adjustable: false },
];

/* ===== J2 · per-endpoint geo_block 派生表(J.geo.endpoint.*) ===== */
export const GEO_ENDPOINTS = [
  { ep: "/genesis/*", domain: "G4", geo: ["KP", "IR", "SY", "CN", "US"], src: "explicit", srcDesc: "前端显式声明 geo_block", hits: 104 },
  { ep: "/exchange/swap", domain: "G2", geo: ["KP", "IR", "SY", "RU"], src: "derived", srcDesc: "OFAC/FATF 链路派生", hits: 62 },
  // 设计稿标 E5;工程导航收编后 Trade-in 归 E3(生命周期 & Trade-in),按原型现状取 E3。
  { ep: "/tradein/*", domain: "E3", geo: [] as string[], src: "pending", srcDesc: "V4 待补 (Ch17 收口)", hits: 0 },
  { ep: "/withdraw/*", domain: "D2", geo: ["KP", "IR", "SY"], src: "derived", srcDesc: "承袭全局 activeCountries", hits: 24 },
  { ep: "/staking/pool/*", domain: "G1", geo: ["KP", "IR", "SY"], src: "derived", srcDesc: "承袭全局 activeCountries", hits: 11 },
  { ep: "/auth/register", domain: "C1", geo: ["KP", "IR", "SY"], src: "derived", srcDesc: "承袭全局 activeCountries", hits: 8 },
  { ep: "/me/wallet/exchange", domain: "G2", geo: ["KP", "IR", "SY", "RU"], src: "derived", srcDesc: "承袭 + OFAC/FATF", hits: 3 },
];
export const GEO_SRC_LABEL: Record<string, string> = { explicit: "单独设定", derived: "继承全局", pending: "待设置" };

/* ===== J2 · Top 拦截命中(今日) ===== */
export const GEO_HITS = [
  { cc: "KP", nm: "North Korea", ct: 78 },
  { cc: "IR", nm: "Iran", ct: 54 },
  { cc: "RU", nm: "Russia", ct: 42 },
  { cc: "SY", nm: "Syria", ct: 21 },
  { cc: "CU", nm: "Cuba", ct: 11 },
  { cc: "MM", nm: "Myanmar", ct: 6 },
];

/* ===== J2 · 边缘 IP 判定健康 ===== */
export const GEO_EDGE = [
  { k: "判定延迟 P95", v: "142 ms", tone: "ok" },
  { k: "判定健康度", v: "99.8%", tone: "ok" },
  { k: "IP 解析失败率", v: "0.04%", tone: "ok" },
  { k: "VPN / 代理处置", v: "从严拦截", tone: "warn" },
  { k: "误判申诉", v: "人工确认 · 7d SLA", tone: "" },
  { k: "最近源切换", v: "21d 前 · ops@nexion", tone: "" },
];

/* ===== J3 · 篡改拦截趋势(24h/7d/30d)。24h 逐时序列合计 = 147(与「今日拦截」/路径分布总计同口径)。 ===== */
export const TAMPER_TREND: Record<string, { pts: number[]; max: number; labels: string[] }> = {
  "24h": { pts: [7, 5, 4, 4, 3, 2, 2, 1, 2, 3, 4, 6, 8, 9, 10, 11, 12, 12, 10, 9, 8, 7, 5, 3], max: 15, labels: ["0", "3", "6", "9", "12", "15", "18", "21"] },
  "7d": { pts: [156, 188, 174, 142, 195, 168, 161], max: 240, labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] },
  "30d": { pts: [142, 156, 138, 175, 168, 144, 152, 188, 195, 174, 162, 158, 172, 184, 169, 155, 148, 162, 178, 192, 184, 167, 159, 168, 175, 162, 158, 169, 184, 173], max: 240, labels: ["m30", "m25", "m20", "m15", "m10", "m5", "now"] },
};

/* ===== J3 · 篡改路径分布(§9.11d.2 10 类 + §9.11d.3 chargeFailRate 合并看板)
 * 段色为图表序列 ramp(danger 橙→warning 黄→紫系 #9B89E0 插值),数据可视化系列色允许精确 hex(B1 漏斗先例)。 */
export const TAMPER_PATHS = [
  { id: "local-balance", nm: "本地余额改写", desc: "localStorage 改 balance", ct: 42, acct: 18, color: "#FF6B35" },
  { id: "price-override", nm: "价格越权", desc: "NEX/USDT 价格篡改", ct: 28, acct: 14, color: "#FF8A5E" },
  { id: "replay", nm: "请求重放", desc: "时间戳漂移 · 重复扣款", ct: 21, acct: 9, color: "#FFA078" },
  { id: "yield-fake", nm: "产出伪造", desc: "lvl 加速 / 设备产出篡改", ct: 18, acct: 11, color: "#FFB390" },
  { id: "ownership", nm: "权属冒用", desc: "claim node 非持有人", ct: 12, acct: 7, color: "#FFBE3D" },
  { id: "ab-group", nm: "A/B 分组", desc: "实验分组篡改污染口径", ct: 9, acct: 6, color: "#FFC85F" },
  { id: "client-version", nm: "版本回退", desc: "client 版本推进拦截", ct: 7, acct: 4, color: "#FFD480" },
  { id: "disclosure-ack", nm: "I5 ack 绕过", desc: "风险披露 ack server 重校验", ct: 5, acct: 3, color: "#9B89E0" },
  { id: "bills-push", nm: "Bills 推送", desc: "账本二次入账校验拒绝 client push", ct: 3, acct: 2, color: "#8674D2" },
  { id: "id-mint", nm: "ID-mint", desc: "client mint ID 撞键", ct: 2, acct: 1, color: "#715FBE" },
];

/* ===== J3 · 高频篡改账户(≥5 起/24h · cluster 指向 K1 簇) ===== */
export const TAMPER_ACCTS = [
  { uid: "u-83271", cnt: 24, k4: "+42", last: "14:18:32", paths: ["local-balance", "price-override", "replay"], cluster: "CL-318" },
  { uid: "u-77310", cnt: 18, k4: "+36", last: "13:52:07", paths: ["yield-fake", "ab-group"], cluster: "CL-318" },
  { uid: "u-66104", cnt: 14, k4: "+28", last: "11:02:50", paths: ["local-balance", "replay"], cluster: "CL-318" },
  { uid: "u-90233", cnt: 11, k4: "+22", last: "11:58:33", paths: ["ownership", "disclosure-ack"], cluster: "" },
  { uid: "u-51288", cnt: 9, k4: "+18", last: "10:24:11", paths: ["yield-fake", "client-version"], cluster: "" },
  { uid: "u-44821", cnt: 8, k4: "+16", last: "09:47:28", paths: ["replay", "bills-push"], cluster: "" },
  { uid: "u-29104", cnt: 6, k4: "+12", last: "08:12:09", paths: ["price-override"], cluster: "CL-292" },
  { uid: "u-19833", cnt: 5, k4: "+10", last: "06:55:42", paths: ["ab-group", "id-mint"], cluster: "" },
];
export const TAMPER_ALERT_CONFIG = { threshold: "10 次 / 24h", feedK4: true };

/* ===== J4 · 应急剧本库(8 · PRD §15.4 schema:triggerScenario / actionSequence / emergencyTrackEnabled)
 * ax 内 **…** 为关键能力强调标记(渲染层解析,数据层保持可序列化)。 */
export type PlaybookStep = { dom: string; ax: string; approve: boolean; ref?: string };
export type Playbook = {
  code: string; name: string; scene: string; emer: boolean; sla: string;
  state: "active" | "todo"; owner: string; lastDrill: string; seq: PlaybookStep[];
};
export const PLAYBOOKS: Playbook[] = [
  {
    code: "SOP-01", name: "监管问询应答", scene: "监管点名", emer: true, sla: "≤ 2h", state: "active", owner: "合规主管", lastDrill: "12d",
    seq: [
      { dom: "J1", ax: "熔断 **exchange + genesis**", approve: true },
      { dom: "I5", ax: "切换 **风险披露** v2.4 → v2.5", approve: true, ref: "jurisdiction=any" },
      { dom: "C2", ax: "**冻结取证** 涉事账户", approve: true },
      { dom: "I3", ax: "通知 **法务对接** 模板", approve: false },
    ],
  },
  {
    code: "SOP-02", name: "资金对账缺口", scene: "资金异常", emer: true, sla: "≤ 1h", state: "active", owner: "财务主管", lastDrill: "8d",
    seq: [
      { dom: "J1", ax: "熔断 **withdraw** 提现", approve: true, ref: "D2" },
      { dom: "B1", ax: "核对 **双账本** coverageRatio", approve: false },
      { dom: "D2", ax: "定位敞口 → **分批放行**", approve: true },
      { dom: "I3", ax: "通知 **财务上报**", approve: false },
    ],
  },
  {
    code: "SOP-03", name: "提现挤兑", scene: "舆情挤兑", emer: true, sla: "≤ 30m", state: "active", owner: "风控主管", lastDrill: "5d",
    seq: [
      { dom: "D2", ax: "**限流** 提现 50% 降速", approve: true },
      { dom: "I3", ax: "**公告披露** critical 通知", approve: false },
      { dom: "D2", ax: "按 B1 容量 **分批放行**", approve: true },
      { dom: "I5", ax: "风险披露 v2.6 **临时附录**", approve: true },
    ],
  },
  {
    code: "SOP-04", name: "数据泄露响应", scene: "数据泄露", emer: false, sla: "≤ 1h", state: "todo", owner: "安全主管", lastDrill: "92d",
    seq: [
      { dom: "J1", ax: "**隔离** 受影响子系统", approve: true },
      { dom: "I3", ax: "**影响评估** 通知模板", approve: false },
      { dom: "I3", ax: "**用户通知** critical", approve: false },
      { dom: "J1", ax: "加固后 **恢复**", approve: true },
    ],
  },
  {
    code: "SOP-05", name: "篡改告警升级", scene: "资金异常", emer: true, sla: "≤ 45m", state: "active", owner: "风控主管", lastDrill: "14d",
    seq: [
      { dom: "C2", ax: "**定向冻结** 高频篡改账户", approve: true },
      { dom: "K1", ax: "批量簇 **建档调查**", approve: true },
      { dom: "I3", ax: "通知 **风控上报**", approve: false },
    ],
  },
  {
    code: "SOP-06", name: "Genesis 价格异常", scene: "资金异常", emer: true, sla: "≤ 30m", state: "active", owner: "风控主管", lastDrill: "18d",
    seq: [
      { dom: "J1", ax: "熔断 **genesis** 二级市场", approve: true },
      { dom: "I3", ax: "**快照定格** + 公告披露", approve: false },
      { dom: "J1", ax: "核因后 **恢复**(前置 B1)", approve: true, ref: "B1.coverage" },
    ],
  },
  {
    code: "SOP-07", name: "全站技术故障", scene: "技术故障", emer: false, sla: "≤ 20m", state: "active", owner: "技术值班", lastDrill: "3d",
    seq: [
      { dom: "J1", ax: "进入 **维护模式**", approve: true },
      { dom: "I3", ax: "**根因定位** + 通告", approve: false },
      { dom: "J1", ax: "**灰度恢复**", approve: true },
    ],
  },
  {
    code: "SOP-08", name: "地域合规收紧", scene: "监管点名", emer: false, sla: "≤ 4h", state: "todo", owner: "合规主管", lastDrill: "127d",
    seq: [
      { dom: "J2", ax: "**升级封禁** activeCountries", approve: true },
      { dom: "C2", ax: "存量账户转 **只读**", approve: true },
      { dom: "I3", ax: "**退出引导** 通知", approve: false },
      { dom: "I5", ax: "**留痕** jurisdiction 版本", approve: false },
    ],
  },
];
export const PB_SCENES = ["全部", "监管点名", "资金异常", "数据泄露", "舆情挤兑", "技术故障"];

/* ===== J4 · 执行追溯历史(每条记录每步最终态 · partial 终态不回写) ===== */
export const EXECS = [
  { ts: "2026-06-02 14:18", code: "SOP-06", name: "Genesis 价格异常", trig: "genesis pump 0.50 vs server 0.0312 · 6 起篡改告警 / 90s", mode: "emergency", steps: ["done", "done", "done"], operator: "risk@nexion", roleGate: "super@nexion" },
  { ts: "2026-05-28 09:42", code: "SOP-03", name: "提现挤兑", trig: "24h withdraw +480% · B1 yellowLine breach", mode: "emergency", steps: ["done", "done", "done", "skip"], operator: "risk@nexion", roleGate: "super@nexion" },
  { ts: "2026-05-22 11:08", code: "SOP-05", name: "篡改告警升级", trig: "K1 簇 CL-318 · 12 账户 · 短持有 → 置换", mode: "regular", steps: ["done", "done", "done"], operator: "risk@nexion", roleGate: "risk-lead@nexion" },
  { ts: "2026-05-15 16:32", code: "SOP-07", name: "全站技术故障(演练)", trig: "每月技术演练 · 维护窗口", mode: "regular", steps: ["done", "done", "done"], operator: "tech-on-call", roleGate: "super@nexion" },
  { ts: "2026-05-08 22:14", code: "SOP-02", name: "资金对账缺口", trig: "D 域夜间对账 $3.2M 缺口告警", mode: "emergency", steps: ["done", "done", "done", "done"], operator: "finance-lead", roleGate: "super@nexion" },
  { ts: "2026-05-01 10:00", code: "SOP-01", name: "监管问询应答(演练)", trig: "季度演练 · 模拟监管点名", mode: "regular", steps: ["done", "done", "done", "done"], operator: "compliance", roleGate: "super@nexion" },
];
