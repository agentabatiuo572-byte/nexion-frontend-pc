"use client";

/**
 * H 增长与运营节奏 — 设计稿 Growth 内容视图(从 page-breadth.jsx 移植)。
 * 标签:H1 节奏调度器(默认)/ H2 免费试用 / H3 Quest 引擎 / H4 活动中心 CMS / H5 签到 & 积分 / H6 里程碑庆祝。
 * 路由 l2.id 与设计稿 tab 一一对应(H1–H6)。
 *
 * 真写落点:所有调参 / 启停 / 活动处置统一进 platform-config-store(setParam keyed 状态 + append-only 审计),
 * persist + 水合门(刷新保留)。派生值 `pget(key) ?? mock原值`。无「只改本地 useState / 仅 toast」的死控件。
 */
import { useState } from "react";
import { Icon, Card, CardH, CodeTag, Badge, Btn, Drawer, MakerCheckerModal, useToast, type EditSpec } from "./design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { PHASE } from "@/lib/mock/admin/design-data";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";

type Dial = (typeof PHASE.dials)[number];
// 统一复核动作描述:op=param → 真写参数(模态出「目标新值」输入);op=status → 处置类固定值;op=event-new → 新增活动(待上线)。
type Mc = {
  name: string;
  detail?: string;
  amplifies?: boolean;
  op: "param" | "status" | "event-new";
  paramKey: string;
  current?: string;        // 当前值(param 类回填到模态 spec.current)
  unit?: string;           // 目标新值单位(可选)
  options?: string[];      // param 类:给定可选目标值(模态以 chip 选,如锁定档枚举)
  fixedVal?: string;       // status 类固定写入值(live/off/paused/enabled/disabled/armed)
  toast: string;           // 写入后 toast 文案
} | null;

const FOLD: Record<string, string> = { H1: "H1", H2: "H2", H3: "H3", H4: "H4", H5: "H5", H6: "H6" };

const TRIAL_KPIS: [string, string][] = [
  ["绑卡转化率", "78%"], ["试用→购买率", "12%"], ["失败率", "9%"],
];
// TrialConfig 可调参数(server-canonical) — key 对应 PRD H2 TrialConfig 字段
type TrialCfgRow = [string, string, string, string];
// 镜像前端 TrialConfig(Nexion-prototype/lib/store/trial-config.ts DEFAULT_TRIAL_CONFIG)全字段。
// 默认值逐项对齐前端真值(原后台抵扣 $120→$50、时长 14→3 矛盾已修)。key = 前端 TrialConfig 字段名。
const TRIAL_CONFIG: TrialCfgRow[] = [
  ["trialDays", "试用时长(天)", "3", "免费试用有效周期 · 影子收益累计窗口"],
  ["graceDays", "宽限期(天)", "7", "试用结束后宽限窗 · 影子冻结,转化推送继续"],
  ["extensionDays", "延长天数", "3", "宽限到期对优质用户授予的延长"],
  ["discountRate", "购机折扣率", "15%", "试用/宽限/延长期主动购机的折扣率"],
  ["discountCapUSD", "折扣上限(USD)", "$20", "主动购机折扣封顶额度"],
  ["trialOffsetCapUSD", "抵扣上限(USD)", "$50", "试用收益可抵购机款封顶(Model A · 购买前仅抵扣不可提)"],
  ["autoChargeAtEnd", "到期自动扣全款", "开", "宽限+延长到期自动按全价扣款"],
  ["highQualityThresholdUSD", "优质用户阈值(USD)", "$100", "影子收益累计达标 → 享延长"],
  ["chargeFailRate", "扣款失败率", "1%", "mock 扣款失败率(生产 server-side)"],
  ["trialPriceUSD", "试用机价(USD)", "$1,299", "自动扣款目标(S1)"],
  ["shadowDailyUSD", "影子日收益 USDT", "$38.52", "试用期日影子收益(S1 baseline)"],
  ["shadowDailyNEX", "影子日收益 NEX", "65", "试用期日影子 NEX 收益"],
  ["cooldownDays", "再试冷却(天)", "30", "每账户两次试用间冷却期"],
  ["autoPushEnabled", "Auto-push 开关", "开", "claim sheet 自动弹出策略总开关"],
  ["autoPushDelayMs", "Auto-push 延迟(ms)", "1500", "进 home 后多久触发 auto-push"],
  ["autoPushCooldownHours", "Auto-push 冷却(h)", "24", "关闭后多少小时内不再 auto-push 同设备"],
  ["autoPushMaxPerSession", "Auto-push 单会话上限", "1", "单会话最多 auto-push 次数"],
];
// 镜像前端 weekly-quests.ts:Tier1 转化 quest(9)+ Tier2 互动 quest(8)= 17 个入金动作,逐项可配奖励 + 启停。
// 节奏乘数 1.0→1.5×(P1→P6,前端 getPhaseRewardMultiplier)。原后台 3 聚合行无法逐 quest 运营。
const QUEST_ROWS: [string, string, string, string][] = [
  ["D1-1", "Day-One · 连接钱包(KYC)", "50 NEX", "1.0–1.5×"],
  ["D1-2", "Day-One · 访问 Earn 页", "30 NEX", "1.0–1.5×"],
  ["D1-3", "Day-One · 访问商城", "50 NEX", "1.0–1.5×"],
  ["D1-4", "Day-One · 查看产品 ROI", "100 NEX", "1.0–1.5×"],
  ["D1-5", "Day-One · 完善资料", "80 NEX", "1.0–1.5×"],
  ["D1-6", "Day-One · 邀请好友", "200 NEX + $1", "1.0–1.5×"],
  ["D1-bonus", "Day-One · 全部完成 Bonus(0-24h;宽限 24-72h 降至 200)", "500 NEX", "—"],
  ["T1-1", "T1 · 锁定 NEX v2 Vault", "3,000 NEX", "1.0–1.5×"],
  ["T1-2", "T1 · 购买 Genesis 节点", "2,500 NEX", "1.0–1.5×"],
  ["T1-3", "T1 · 加购设备", "2,000 NEX", "1.0–1.5×"],
  ["T1-4", "T1 · 以旧换新升级", "1,800 NEX", "1.0–1.5×"],
  ["T1-5", "T1 · S1 升级 Pro v2", "1,500 NEX", "1.0–1.5×"],
  ["T1-6", "T1 · 购买首台设备", "1,000 NEX + $10", "1.0–1.5×"],
  ["T1-7", "T1 · 订阅 Premium", "800 NEX", "1.0–1.5×"],
  ["T1-8", "T1 · 质押(兜底)", "250 NEX", "1.0–1.5×"],
  ["T1-9", "T1 · 充值余额", "100 NEX", "1.0–1.5×"],
  ["T2-1", "T2 · 邀请好友", "200 NEX + $2", "1.0–1.5×"],
  ["T2-2", "T2 · 小额质押", "150 NEX", "1.0–1.5×"],
  ["T2-3", "T2 · 复投", "120 NEX", "1.0–1.5×"],
  ["T2-4", "T2 · 小额充值", "100 NEX", "1.0–1.5×"],
  ["T2-5", "T2 · NEX 兑换", "80 NEX", "1.0–1.5×"],
  ["T2-6", "T2 · 完成 50 AI 任务", "80 NEX", "1.0–1.5×"],
  ["T2-7", "T2 · 浏览 Genesis 市场", "60 NEX", "1.0–1.5×"],
  ["T2-8", "T2 · 浏览商城", "50 NEX", "1.0–1.5×"],
  ["M-1", "Monthly · 基石建造者(月 1-2)", "1,500 NEX", "1.0–1.5×"],
  ["M-2", "Monthly · 网络架构师(月 3-4)", "2,500 NEX", "1.0–1.5×"],
  ["M-3", "Monthly · 高阶进阶(月 5-6)", "4,000 NEX", "1.0–1.5×"],
  ["M-4", "Monthly · 钻石层级(月 7-9)", "6,000 NEX", "1.0–1.5×"],
  ["M-5", "Monthly · 创世任务(月 9+)", "10,000 NEX + 勋章", "1.0–1.5×"],
];
const DAILY_KPIS: [string, string][] = [
  ["日签到积分", "10–50 pts"], ["Lucky 倍率", "最高 3×"], ["月活跃签到", "64%"],
];
// 签到 & 积分可调规则(server-canonical) — key 对应 PRD H5
type DailyCfgRow = [string, string, string, string, boolean];
const DAILY_CONFIG: DailyCfgRow[] = [
  ["checkinPointsRange", "日签到积分", "10–50 pts", "每日签到发放的积分区间", false],
  ["luckyMultiplierMax", "Lucky 倍率上限", "3×", "幸运倍率可触达的封顶值", false],
  ["pointsRedeemRate", "积分兑换比率", "100 pts = $1", "积分兑换 NEX / 权益的换算比率", true],
];
type EventRow = [string, string, string, string, string, boolean];
const EVENT_ROWS: EventRow[] = [
  ["discount", "Flash Sale", "NexionBox Pro $500 OFF 7d", "decorative", "ongoing", true],
  ["referral", "Refer & Earn", "Refer 5 · Win a Pro", "trackable", "ongoing", false],
  ["wheel", "Lucky Wheel", "Spring Daily Spin", "trackable", "ongoing", false],
  ["regional", "Regional PK", "LatAm vs SEA vs EU $20K", "decorative", "ongoing", false],
  ["boost", "Bonus Boost", "Weekend Double Points", "decorative", "ongoing", false],
  ["seasonal", "Seasonal", "Black Friday 20% OFF", "decorative", "upcoming", false],
  ["holding", "Holders Reward", "Hold ≥1,000 NEX → share $5K", "trackable", "ongoing", false],
  ["onboarding", "New Pilot", "First-Week +200 NEX", "trackable", "ended", false],
];
type MilestoneRow = [string, string, string, string];
const MILESTONE_ROWS: MilestoneRow[] = [
  ["earn-100", "$100", "+100 NEX", "First $100 earned — phone paid back activation overhead"],
  ["earn-500", "$500", "+250 NEX", "Half-grand reached. Hardware tier ROI unlocks"],
  ["earn-1000", "$1,000", "+500 NEX", "Four-figure earner · outpacing 88% of solo-phone accounts"],
  ["earn-5000", "$5,000", "+1,500 NEX", "Mid five-figure operator · most own a NexionBox Pro"],
  ["earn-10000", "$10,000", "+3,000 NEX", "Top 2% of Nexion earners · Founders Tier at $25K"],
];

// dial 中改后放大资金流出、须先核验 B1 覆盖率的高敏项(同 D 域口径)。
const AMPLIFY_DIALS = ["withdrawDailyCapUSD", "stakingApyBoost", "genesisDividendRate", "questRewardMult"];

const eventStatusTone: Record<string, string> = { ongoing: "ok", upcoming: "info", paused: "warn", ended: "neutral" };

export function HDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const [tab] = useState(FOLD[meta.l2Id] ?? "H1");
  const [dials] = useState<readonly Dial[]>(PHASE.dials);
  const [mc, setMc] = useState<Mc>(null);
  const [addEvent, setAddEvent] = useState(false);
  const [evForm, setEvForm] = useState({ kind: "discount", title: "", desc: "", track: "decorative" });

  // 真写落点:节奏参数 / 试用 / Quest / 活动处置统一进 platform-config-store(setParam + 审计),persist + 水合门。
  const setParam = usePlatformConfig((s) => s.setParam);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const pget = (k: string): string | undefined => (hydrated ? (params?.[k] as string | undefined) : undefined);

  const currentIdx = PHASE.timeline.indexOf(PHASE.current);

  // 派生 helper:活动状态 / Quest 启停 / 里程碑启停 均以持久值优先,回落 mock 原值。
  // H-02 节奏锁定 / cohort 覆盖派生:pin 为空 → 跟随调度(自动);非空 → 锁定到该档。
  const phasePin = pget("H.phase.pin");                       // "" / "P1".."P6"
  const phasePinned = !!phasePin && phasePin !== "自动跟随";
  const effectivePhase = phasePinned ? phasePin! : PHASE.current;
  const cohortOverride = pget("H.phase.cohortOverride");      // 自定义 cohort 节奏覆盖描述
  const eventStatus = (id: string, base: string): string => pget(`H.event.${id}.status`) ?? base;
  const questEnabled = (id: string): boolean => (pget(`H.quest.${id}.enabled`) ?? "true") === "true";
  const milestoneEnabled = (id: string): boolean => (pget(`H.milestone.${id}.enabled`) ?? "true") === "true";

  return (
    <div className="dkpage">
      <DomainHeader {...meta} />

      {tab === "H1" && <>
        <Card style={{ marginBottom: 16 }}>
          <CardH title="节奏时间线 · P1–P6" sub={PHASE.label} right={<CodeTag tone="electric" title="节奏引擎权威">节奏权威</CodeTag>} />
          <div className="dotline">{PHASE.timeline.map((ph, i) => (
            <div key={ph} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ height: 10, borderRadius: 5, background: ph === PHASE.current ? "var(--brand)" : i < currentIdx ? "var(--brand-soft)" : "var(--surface-3)" }} />
              <div className="mono" style={{ marginTop: 6, fontSize: 12, color: ph === PHASE.current ? "var(--brand)" : "var(--ink-4)", fontWeight: ph === PHASE.current ? 600 : 400 }}>{ph}</div>
              <div className="muted tiny">月 {i * 2 + 1}-{i * 2 + 2}</div>
            </div>
          ))}</div>
        </Card>
        <Card className="pad-0">
          <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">10 个节奏 dial(月粒度 / cohort override)</span><CodeTag>节奏参数</CodeTag></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>名称</th><th>当前值</th><th>趋势</th><th /></tr></thead>
            <tbody>{dials.map((d) => { const eff = pget(`H.phase.dial.${d.key}`) ?? String(d.val); return (
              <tr key={d.key}><td>{d.name}</td><td className="t-strong tnum">{eff}</td>
                <td>{d.trend !== "—" ? <CodeTag tone={d.trend === "↑" ? "orange" : ""}>{d.trend}</CodeTag> : <span className="muted">—</span>}</td>
                <td><Btn sm onClick={() => setMc({ op: "param", paramKey: `H.phase.dial.${d.key}`, current: eff, name: `节奏 dial 调整:${d.name}`, detail: `${d.name}当前 ${eff} · 月粒度节奏参数,改动改变全体用户体验`, amplifies: AMPLIFY_DIALS.includes(d.key), toast: `节奏 dial ${d.name} 已提交复核` })}>调整</Btn></td></tr>
            ); })}</tbody>
          </table></div>
        </Card>

        <Card style={{ marginTop: 16 }}>
          <CardH title="手动锁定节奏档 · cohort 覆盖" sub="覆盖自动调度 · 锁定后全体或指定 cohort 停留在选定档"
            right={<CodeTag tone="electric" title="手动 pin / cohort override">手动覆盖</CodeTag>} />
          <div className="grid g-2" style={{ gap: 12 }}>
            <div className="tint" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <div className="muted tiny">当前生效节奏档</div>
                <div className="row" style={{ gap: 8, alignItems: "center", marginTop: 4 }}>
                  <span className="t-strong tnum" style={{ fontSize: 20, color: phasePinned ? "var(--brand)" : "var(--ink)" }}>{effectivePhase}</span>
                  <Badge tone={phasePinned ? "warn" : "neutral"}>{phasePinned ? "已手动锁定" : "自动跟随调度"}</Badge>
                </div>
                <div className="muted tiny" style={{ marginTop: 4 }}>调度建议档 <span className="mono">{PHASE.current}</span>{phasePinned ? ` · 已被锁定为 ${phasePin}` : " · 当前未锁定"}</div>
              </div>
              <Btn sm onClick={() => setMc({ op: "param", paramKey: "H.phase.pin", current: phasePinned ? phasePin : "自动跟随", options: [...PHASE.timeline, "自动跟随"], name: "手动锁定节奏档", detail: `当前生效 ${effectivePhase}(调度建议 ${PHASE.current})· 锁定后全体用户停留在选定档直到解除;选「自动跟随」恢复调度`, toast: "节奏档锁定已提交复核" })}>{phasePinned ? "改锁定档 / 解除" : "锁定当前节奏档"}</Btn>
            </div>
            <div className="tint" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <div className="muted tiny"><AutoGloss>cohort 节奏覆盖</AutoGloss></div>
                <div className="t-strong" style={{ marginTop: 4, fontSize: 14, color: cohortOverride ? "var(--ink)" : "var(--ink-4)" }}>{cohortOverride || "未设置 · 全体随主调度"}</div>
                <div className="muted tiny" style={{ marginTop: 4 }}><AutoGloss>对指定 cohort(如新注册 / 某区域)单独指派节奏档,与主调度并行</AutoGloss></div>
              </div>
              <Btn sm onClick={() => setMc({ op: "param", paramKey: "H.phase.cohortOverride", current: cohortOverride || "未设置", name: "cohort 节奏覆盖", detail: `为指定 cohort 单独指派节奏档(如「新注册用户→P2」「LatAm→P4」)· 留空提交则清除覆盖,该 cohort 回归主调度`, toast: "cohort 节奏覆盖已提交复核" })}>编辑 cohort 覆盖</Btn>
            </div>
          </div>
        </Card>
      </>}

      {tab === "H2" && <>
        <Card className="pad-0" style={{ marginBottom: 16 }}>
          <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">试用引擎 · 试用参数</span><CodeTag title="试用配置参数">免费试用</CodeTag><div className="spacer" /><span className="muted tiny"><AutoGloss>server-canonical · 改后对新发起的试用生效</AutoGloss></span></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>名称</th><th>当前值</th><th>说明</th><th /></tr></thead>
            <tbody>{TRIAL_CONFIG.map(([key, name, val, desc]) => { const eff = pget(`H.trial.${key}`) ?? val; return (
              <tr key={key}><td>{name}</td><td className="t-strong tnum">{eff}</td><td className="tiny t-mut">{desc}</td>
                <td><Btn sm onClick={() => setMc({ op: "param", paramKey: `H.trial.${key}`, current: eff, name: `试用参数调整:${name}`, detail: `${name} 当前 ${eff} · server-canonical,仅对调整后新发起的试用生效`, amplifies: key === "trialOffsetCapUSD", toast: `试用参数 ${name} 已提交复核` })}>调整</Btn></td></tr>
            ); })}</tbody>
          </table></div>
        </Card>
        <Card style={{ marginBottom: 16 }}>
          <CardH title="强制取消试用 · 运营干预" sub="批量终止符合条件的进行中试用 · 高敏处置"
            right={<CodeTag tone="orange" title="试用引擎运营动作">强制处置</CodeTag>} />
          <div className="tint warn tiny" style={{ marginBottom: 12 }}>
            <AutoGloss>高敏操作 · 执行后服务端将批量取消符合条件的进行中试用(如风控命中 / 规则违规 cohort),取消后席位回收、已结算抵扣不冲正。须双人复核。</AutoGloss>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Btn variant="primary" sm onClick={() => setMc({ op: "status", paramKey: "H.trial.forceCancel", fixedVal: "armed", amplifies: true, name: "强制取消试用(运营干预)", detail: "服务端批量取消符合条件的进行中试用 · 席位回收、抵扣不冲正、用户收到通知 · 不可逆", toast: "强制取消试用已提交复核 · 复核放行后服务端批量执行" })}><Icon name="alert" size={14} /> 发起强制取消</Btn>
          </div>
        </Card>
        <Card><CardH title="试用转化监控" sub="绑卡 / 转化 / 失败 KPI" right={<CodeTag>试用 KPI</CodeTag>} />
          <div className="grid g-3" style={{ gap: 12 }}>
            {TRIAL_KPIS.map(([n, v]) => (
              <div key={n} className="tint"><div className="muted tiny">{n}</div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--ink)" }} className="tnum">{v}</div></div>
            ))}
          </div>
        </Card>
      </>}

      {tab === "H3" && <Card className="pad-0">
        <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">Quest 任务引擎 · 首日 / 每周 / 每月</span><CodeTag>任务引擎</CodeTag><div className="spacer" /><span className="muted tiny"><AutoGloss>NEX 奖励 server-canonical · 调整奖励放大流出</AutoGloss></span></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>层</th><th>任务</th><th>NEX 奖励</th><th>节奏乘数</th><th>状态</th><th /></tr></thead>
          <tbody>{QUEST_ROWS.map(([l, t, r, m]) => { const on = questEnabled(l); const eff = pget(`H.quest.${l}.reward`) ?? r; return (
            <tr key={l}><td><CodeTag tone="electric">{l}</CodeTag></td><td>{t}</td><td className="mono">{eff}</td><td className="mono">{m}</td>
              <td><Badge tone={on ? "ok" : "neutral"}>{on ? "运行中" : "已停用"}</Badge></td>
              <td><div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                <Btn sm onClick={() => setMc({ op: "param", paramKey: `H.quest.${l}.reward`, current: eff, name: `Quest 调整奖励:${l}`, detail: `${l} 当前奖励 ${eff}(乘数 ${m})· NEX 派发为资金流出,调整须核验 B1 覆盖率`, amplifies: true, toast: `Quest ${l} 奖励已提交复核` })}>调整奖励</Btn>
                <Btn sm onClick={() => setMc({ op: "status", paramKey: `H.quest.${l}.enabled`, fixedVal: on ? "false" : "true", name: `${on ? "停用" : "启用"}任务:${l}`, detail: `${l}「${t}」· ${on ? "停用后停止派发,已发放不冲正" : "启用后恢复 NEX 奖励发放"}`, amplifies: !on, toast: `任务 ${l} 已${on ? "停用" : "启用"}` })}>{on ? "停用" : "启用"}</Btn>
              </div></td></tr>
          ); })}</tbody>
        </table></div>
      </Card>}

      {tab === "H4" && <>
        <Card className="pad-0" style={{ marginBottom: 16 }}>
        <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">活动中心 CMS · 8 EventKind</span><CodeTag>活动中心</CodeTag><div className="spacer" /><Btn variant="primary" sm onClick={() => { setEvForm({ kind: "discount", title: "", desc: "", track: "decorative" }); setAddEvent(true); }}><Icon name="plus" size={14} /> 新增活动</Btn></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>活动类型</th><th>标签</th><th>典型活动</th><th>追踪</th><th>状态</th><th>奖励</th><th>推荐位</th><th /></tr></thead>
          <tbody>{EVENT_ROWS.map((r) => { const st = eventStatus(r[0], r[4]); const reward = pget(`H.event.${r[0]}.reward`) ?? r[2]; return (
            <tr key={r[0]}><td className="mono t-strong">{r[0]}</td><td>{r[1]}</td><td className="tiny t-mut">{reward}</td>
              <td><CodeTag tone={r[3] === "trackable" ? "cyan" : ""}>{r[3]}</CodeTag></td>
              <td><Badge tone={eventStatusTone[st] ?? "neutral"}>{st}</Badge></td>
              <td><Btn sm onClick={() => setMc({ op: "param", paramKey: `H.event.${r[0]}.reward`, current: reward, name: `活动改奖励:${r[1]}`, detail: `${r[1]}「${reward}」· 调整活动奖励/力度${r[3] === "trackable" ? ",NEX 派发放大流出须核验 B1 覆盖率" : ",仅展示折扣力度"}`, amplifies: r[3] === "trackable", toast: `活动 ${r[1]} 奖励已提交复核` })}>改奖励</Btn></td>
              <td>{r[5] ? <Badge tone="orange">FEATURED</Badge> : "—"}</td>
              <td><div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                {st !== "ongoing"
                  ? <Btn sm onClick={() => setMc({ op: "status", paramKey: `H.event.${r[0]}.status`, fixedVal: "live", name: `上线活动:${r[1]}`, detail: `${r[1]}「${reward}」· 上线后对用户可见${r[3] === "trackable" ? ",trackable 进度接 A4 服务端权威" : ""}`, amplifies: r[3] === "trackable", toast: `活动 ${r[1]} 已上线` })}>上线</Btn>
                  : <Btn sm onClick={() => setMc({ op: "status", paramKey: `H.event.${r[0]}.status`, fixedVal: "off", name: `下线活动:${r[1]}`, detail: `${r[1]}「${reward}」· 下线后从 /events 移除,已派发奖励不冲正`, toast: `活动 ${r[1]} 已下线` })}>下线</Btn>}
                {st === "ongoing" && <Btn sm onClick={() => setMc({ op: "status", paramKey: `H.event.${r[0]}.status`, fixedVal: "paused", name: `暂停活动:${r[1]}`, detail: `${r[1]}「${reward}」· 暂停后保留入口但停止结算,可随时恢复上线`, toast: `活动 ${r[1]} 已暂停` })}>暂停</Btn>}
              </div></td></tr>
          ); })}</tbody>
        </table></div>
        <div style={{ padding: "0 18px 16px" }}><div className="tint cyan tiny"><AutoGloss>Trackable 活动接 A4 真任务化引擎(progress server 权威);Decorative 仅展示。奖励到期自动入 USDT/NEX。</AutoGloss></div></div>
        </Card>

        <Card>
          <CardH title="Lucky Spin 转盘奖池" sub="幸运转盘奖项与中奖权重配置 · 调整放大 NEX 流出"
            right={<CodeTag tone="orange" title="Lucky Wheel 奖池">转盘奖池</CodeTag>} />
          {(() => {
            const pool = pget("H.luckyspin.pool") ?? "5 NEX×38% · 50 积分×24% · 30 NEX×18% · 150 NEX×11% · $1×5% · $50 券×3% · $20×0.9% · $500×0.1%";
            return <>
              <div className="tint" style={{ marginBottom: 12 }}>
                <div className="muted tiny">当前奖池配置</div>
                <div className="t-strong mono" style={{ marginTop: 4, fontSize: 14, color: "var(--ink)", lineHeight: 1.5 }}>{pool}</div>
                <div className="muted tiny" style={{ marginTop: 6 }}><AutoGloss>格式:奖项×中奖权重 · 各权重之和应为 100% · NEX 派发为资金流出</AutoGloss></div>
              </div>
              <div className="tint warn tiny" style={{ marginBottom: 12 }}><AutoGloss>调高大额奖项权重将放大 NEX 流出,须核验 B1 兑付覆盖率约束。</AutoGloss></div>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <Btn sm onClick={() => setMc({ op: "param", paramKey: "H.luckyspin.pool", current: pool, amplifies: true, name: "调整转盘奖池配置", detail: `Lucky Spin 奖池当前「${pool}」· 按「奖项×权重」格式填写,权重和应为 100% · NEX 派发放大流出,须核验 B1 覆盖率`, toast: "转盘奖池配置已提交复核" })}>编辑转盘奖池</Btn>
              </div>
            </>;
          })()}
        </Card>

        <Card>
          <CardH title="邀请榜奖池(季度)" sub="邀请排行榜分档奖池 · NEX 计价(零现金成本)· 调整放大 NEX 流出"
            right={<CodeTag tone="orange" title="Invite Leaderboard Pool">邀请榜奖池</CodeTag>} />
          {(() => {
            const pool = pget("H.invitePool.tiers") ?? "冠军 100 万 NEX · 第 2-3 名 25 万 NEX · 第 4-10 名 5 万 NEX · 第 11-50 名 5,000 NEX";
            return <>
              <div className="tint" style={{ marginBottom: 12 }}>
                <div className="muted tiny">当前奖池分档(越南基准)</div>
                <div className="t-strong mono" style={{ marginTop: 4, fontSize: 14, color: "var(--ink)", lineHeight: 1.5 }}>{pool}</div>
                <div className="muted tiny" style={{ marginTop: 6 }}><AutoGloss>格式:名次档×奖励 · NEX 计价零成本(撑「邀请就发钱」裂变错觉)· 越南 Zalo/FB 群裂变主力</AutoGloss></div>
              </div>
              <div className="tint warn tiny" style={{ marginBottom: 12 }}><AutoGloss>奖池档位改 USDT 计价将放大现金流出,须核验 B1 兑付覆盖率;NEX 计价零成本可大方加码。套利重灾区,接 K2 反刷量。</AutoGloss></div>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <Btn sm onClick={() => setMc({ op: "param", paramKey: "H.invitePool.tiers", current: pool, amplifies: true, name: "调整邀请榜奖池分档", detail: `邀请榜奖池当前「${pool}」· 按「名次档×奖励」格式填写 · NEX 计价零成本,改 USDT 计价须核验 B1 覆盖率`, toast: "邀请榜奖池配置已提交复核" })}>编辑邀请榜奖池</Btn>
              </div>
            </>;
          })()}
        </Card>
      </>}

      {tab === "H5" && <>
        <Card className="pad-0" style={{ marginBottom: 16 }}>
          <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">签到 & 积分规则</span><CodeTag>签到积分</CodeTag><div className="spacer" /><span className="muted tiny"><AutoGloss>server-canonical · 兑换比率改动放大流出</AutoGloss></span></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>名称</th><th>当前值</th><th>说明</th><th /></tr></thead>
            <tbody>{DAILY_CONFIG.map(([key, name, val, desc, amp]) => { const eff = pget(`H.checkin.${key}`) ?? val; return (
              <tr key={key}><td>{name}</td><td className="t-strong tnum">{eff}</td><td className="tiny t-mut">{desc}</td>
                <td><Btn sm onClick={() => setMc({ op: "param", paramKey: `H.checkin.${key}`, current: eff, name: `签到规则调整:${name}`, detail: `${name} 当前 ${eff} · server-canonical,${amp ? "积分兑换为资金流出,调整须核验 B1 覆盖率" : "改后对后续签到生效"}`, amplifies: amp, toast: `签到规则 ${name} 已提交复核` })}>调整</Btn></td></tr>
            ); })}</tbody>
          </table></div>
        </Card>
        <Card><CardH title="签到活跃监控" sub="Lucky 倍率 · streak · 月活跃" right={<CodeTag>签到 KPI</CodeTag>} />
          <div className="grid g-3" style={{ gap: 12 }}>
            {DAILY_KPIS.map(([n, v]) => (
              <div key={n} className="tint"><div className="muted tiny">{n}</div><div style={{ fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>{v}</div></div>
            ))}
          </div>
        </Card>
      </>}

      {tab === "H6" && <Card className="pad-0">
        <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">里程碑庆祝 · 5 档阈值</span><CodeTag>里程碑</CodeTag><div className="spacer" /><span className="muted tiny"><AutoGloss>被动触发 · 放大 NEX 流出受 B1 约束</AutoGloss></span></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th className="num">阈值(lifetime USD)</th><th className="num">NEX 奖励</th><th>业务文案钩子</th><th>状态</th><th /></tr></thead>
          <tbody>{MILESTONE_ROWS.map((r) => { const on = milestoneEnabled(r[0]); const eff = pget(`H.milestone.${r[0]}.reward`) ?? r[2]; return (
            <tr key={r[0]}><td className="num t-strong tnum">{r[1]}</td><td className="num mono" style={{ color: "var(--brand)" }}>{eff}</td><td className="tiny t-mut">{r[3]}</td>
              <td><Badge tone={on ? "ok" : "neutral"}>{on ? "启用中" : "已停用"}</Badge></td>
              <td><div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                <Btn sm onClick={() => setMc({ op: "param", paramKey: `H.milestone.${r[0]}.reward`, current: eff, name: `里程碑调整:${r[1]}`, detail: `阈值 ${r[1]} → NEX 奖励 ${eff} · NEX 派发放大流出,调整奖励须核验 B1 覆盖率`, amplifies: true, toast: `里程碑 ${r[1]} 奖励已提交复核` })}>调整</Btn>
                <Btn sm onClick={() => setMc({ op: "status", paramKey: `H.milestone.${r[0]}.enabled`, fixedVal: on ? "false" : "true", name: `${on ? "停用" : "启用"}里程碑:${r[1]}`, detail: `阈值 ${r[1]}(奖励 ${eff})· ${on ? "停用后不再触发庆祝与派发" : "启用后达标用户派发 NEX 奖励"}`, amplifies: !on, toast: `里程碑 ${r[1]} 已${on ? "停用" : "启用"}` })}>{on ? "停用" : "启用"}</Btn>
              </div></td></tr>
          ); })}</tbody>
        </table></div>
        <div style={{ padding: "0 18px 16px" }}><div className="tint warn tiny"><AutoGloss>越多档走 cascade(每 4s 触发一个)· NEX 奖励派发放大流出,调整阈值/奖励须核验 B1 覆盖率</AutoGloss></div></div>
      </Card>}

      {addEvent && <Drawer title="新增活动" sub={<AutoGloss>填写活动结构 · 提交后走双人复核</AutoGloss>} onClose={() => setAddEvent(false)}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => setAddEvent(false)}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!evForm.title} onClick={() => { setMc({ op: "event-new", paramKey: `H.event.new.${evForm.kind}.${evForm.title.trim() || "untitled"}`, fixedVal: "pending", name: `新增活动:${evForm.title || "未命名"}`, detail: `EventKind ${evForm.kind} · ${evForm.track}${evForm.track === "trackable" ? " · 进度接 A4 服务端权威" : " · 仅展示"}${evForm.desc ? ` · ${evForm.desc}` : ""} · 创建后入待上线队列,复核通过才对用户可见`, amplifies: evForm.track === "trackable", toast: `活动「${evForm.title || "未命名"}」已创建 · 待上线复核` }); setAddEvent(false); }}>提交复核</Btn></>}>
        <div className="col" style={{ gap: 12 }}>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">EventKind</span><select className="fld" value={evForm.kind} onChange={(e) => setEvForm({ ...evForm, kind: e.target.value })}>{EVENT_ROWS.map((r) => <option key={r[0]} value={r[0]}>{r[0]} · {r[1]}</option>)}</select></label>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">活动标题</span><input className="fld" value={evForm.title} onChange={(e) => setEvForm({ ...evForm, title: e.target.value })} placeholder="如 Spring Daily Spin" /></label>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">活动描述</span><input className="fld" value={evForm.desc} onChange={(e) => setEvForm({ ...evForm, desc: e.target.value })} placeholder="如 每日登录抽奖 · 7 天" /></label>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">追踪类型</span><select className="fld" value={evForm.track} onChange={(e) => setEvForm({ ...evForm, track: e.target.value })}><option value="decorative">decorative(仅展示)</option><option value="trackable">trackable(进度接 A4)</option></select></label>
          <div className="tint warn tiny"><AutoGloss>活动结构为高敏字段 · 新增活动需双人复核后才上线</AutoGloss></div>
        </div>
      </Drawer>}

      {mc && <MakerCheckerModal
        action={mc.name}
        detail={mc.detail ?? `${mc.paramKey} · server-canonical,改后对用户生效`}
        amplifies={!!mc.amplifies}
        edit={mc.op === "param" ? ({ current: mc.current, unit: mc.unit, ...(mc.options ? { kind: "select", options: mc.options } : {}) } as EditSpec) : undefined}
        onClose={() => setMc(null)}
        onConfirm={(reason, newVal) => {
          if (mc.op === "param") {
            // 真写:目标新值入 platform-config-store(persist + 审计),派生即时反映,刷新保留。
            setParam(mc.paramKey, (newVal ?? "").trim(), { action: mc.name, reason });
          } else {
            // 处置 / 新增:固定值写入(live/off/paused/enabled/disabled/pending)。
            setParam(mc.paramKey, mc.fixedVal ?? "", { action: mc.name, reason });
          }
          setToast(mc.toast);
          setMc(null);
        }} />}
      {toastNode}
    </div>
  );
}
