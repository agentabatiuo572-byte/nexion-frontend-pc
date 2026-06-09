/**
 * A5 平台参数寄存器(Platform Parameter Registry · 旗舰)。
 * 把全平台业务常量(回源前端真值)按 12 域归集成单一字段级目录:
 * 每个参数 = 真值 + 控制类型 + 运营杠杆 + Maker-Checker + 端点 + 前端出处 + 跳转该域 config 模块编辑。
 * 数据 = 直接读 docs/cgm/cgm.manifest.json 的 platform 行(CGM 单一真源,永同步)。
 * 这是「平台版 360 HUB」:平台运营面的最细颗粒度控制索引。server component · 只读 + 跳转。
 */
import Link from "next/link";
import { ArrowUpRight, ShieldCheck, Database, SlidersHorizontal, Zap } from "lucide-react";
import manifestJson from "@/docs/cgm/cgm.manifest.json";

interface CgmRow {
  id: string;
  domain: string;
  scope: string;
  controlType?: string;
  frontendField: string;
  frontendSource?: string;
  frontendAnchor?: string;
  opsPurpose?: string | string[];
  querySurface?: string;
  crudActions?: string;
  makerChecker?: boolean;
  serverCanonical?: string;
  endpoint?: string;
  adminTarget?: string;
  coverage?: string;
  batch?: string;
}
const rows = (manifestJson as unknown as { rows: CgmRow[] }).rows.filter((r) => r.scope === "platform");

const DOMAIN_META: Record<string, { label: string; accent: string }> = {
  A: { label: "平台基础", accent: "var(--admin-domain-a)" },
  B: { label: "总览驾驶舱", accent: "var(--admin-domain-b)" },
  C: { label: "用户与账户", accent: "var(--admin-domain-c)" },
  D: { label: "资金与财务", accent: "var(--admin-domain-d)" },
  E: { label: "设备与商城", accent: "var(--admin-domain-e)" },
  F: { label: "分销与团队", accent: "var(--admin-domain-f)" },
  G: { label: "金融产品", accent: "var(--admin-domain-g)" },
  H: { label: "增长节奏", accent: "var(--admin-domain-h)" },
  I: { label: "内容合规", accent: "var(--admin-domain-i)" },
  J: { label: "紧急合规", accent: "var(--admin-domain-j)" },
  K: { label: "风控反作弊", accent: "var(--admin-domain-k)" },
  L: { label: "数据 BI", accent: "var(--admin-domain-l)" },
};

const OPS_LABEL: Record<string, string> = {
  fund_safety: "资金安全",
  payout_pacing: "兑付节奏",
  conversion: "转化",
  risk: "风控",
  network_growth: "网络增长",
  phase_12mo: "12月节奏",
  content_compliance: "内容合规",
  platform_integrity: "平台完整",
};

const CTRL_META: Record<string, { label: string; icon: typeof Database }> = {
  "data-CRUD": { label: "数据增删改查", icon: Database },
  "param-config": { label: "参数配置", icon: SlidersHorizontal },
  "function-action": { label: "功能动作", icon: Zap },
};

/** 每行回源出处 → 该参数真正可编辑的域 config 模块(关键词优先,域兜底)。 */
function ownerFor(r: CgmRow): { path: string; label: string } {
  const f = r.frontendField.toLowerCase();
  const kw: [RegExp, string, string][] = [
    [/staking|stake/, "/finance-products/staking", "G1 Staking 配置"],
    [/exchange|兑换|nexprice|usdt.?per|jitterrate/, "/finance-products/exchange", "G2 兑换风控"],
    [/genesis|royalty|节点|slot/, "/finance-products/genesis", "G4 Genesis 配置"],
    [/market|klin|pump|nexpriceusdt|volume24/, "/finance-products/market", "G3 行情控制"],
    [/premium|nex.?v2|repurchase|复投|lock_months/, "/finance-products/repurchase", "G7 金融附加"],
    [/device_price|device_specs|baserate|products\[|catalog|max_devices/, "/devices/pricing", "E1 商品定价"],
    [/degradation|salvage|decay|efficiency|lifecycle/, "/devices/lifecycle", "E4 衰减/残值"],
    [/trade.?in|tradein|upgrade_ladder/, "/devices/trade-in", "E5 trade-in 配置"],
    [/trial|shadow|discount|autopush|autocharge/, "/growth/trial", "H2 Trial 引擎"],
    [/phase|10-dial|getphasereward|monthly_locked|inviteBonusMultiplier/, "/growth/phase", "H1 Phase 调度"],
    [/quest|tier[12]|streak|weekly_bonus|spin_prizes|lucky/, "/growth/quest", "H3 任务引擎"],
    [/milestone|achievement|earnings_milestone/, "/growth/milestones", "H6 里程碑"],
    [/stella|cadence|agent_pool|enterliveagent/, "/content/notifications", "I3 推送/Stella"],
    [/unilevel|binary|commission|sponsor|invite_reward|welcome_gift/, "/network/royalty", "F2 佣金规则"],
    [/v_rank|directbonus|peerbonus|cultivation|v_vote|vrankcond|prizename|v_distribution/, "/network/v-rank", "F1 V 级阶梯"],
    [/leadership|currentweekpool|领导池/, "/network/leadership-pool", "F4 领导池"],
    [/withdrawal|提现|min_withdrawal|fee|daily_cap|user_daily/, "/finance/params", "D5 提现参数"],
    [/billtype|账单/, "/finance/ledger", "D4 平台账本"],
    [/lesson|categor|learn|format_label/, "/content/learn", "I7 学习中心"],
    [/disclos|risk.?disclosure|compliance|kyc.?express|trust/, "/content/disclosure", "I5 披露合规"],
    [/banner|copy|文案/, "/content/copy-ab", "I1 文案 AB"],
    [/killswitch|kill.?switch|neterror|congestion|coveragedegraded|realprize/, "/emergency/kill-switch", "J1 Kill-Switch"],
    [/confirm|toast|useui/, "/platform/config", "A3 系统配置"],
    [/notification|usenotifications/, "/content/notifications", "I3 推送中心"],
    [/global\.|activedevices|nodes|countries|uptime|paidtoday/, "/analytics/operations", "L4 运营指标"],
  ];
  for (const [re, path, label] of kw) if (re.test(f)) return { path, label };
  const fallback: Record<string, [string, string]> = {
    A: ["/platform/config", "A3 系统配置"], C: ["/network/v-rank", "F1 V 级阶梯"],
    D: ["/finance/params", "D5 提现参数"], E: ["/devices/pricing", "E1 商品定价"],
    F: ["/network/royalty", "F2 佣金规则"], G: ["/finance-products/staking", "G1 Staking"],
    H: ["/growth/phase", "H1 Phase 调度"], I: ["/content/disclosure", "I5 披露合规"],
    J: ["/emergency/kill-switch", "J1 Kill-Switch"], K: ["/risk/withdrawal-rules", "K3 提现风控"],
    L: ["/analytics/operations", "L4 运营指标"], B: ["/overview/rhythm", "B3 节奏"],
  };
  const [path, label] = fallback[r.domain] || ["/platform/config", "A3 系统配置"];
  return { path, label };
}

function opsList(p: CgmRow["opsPurpose"]): string[] {
  if (!p) return [];
  return Array.isArray(p) ? p : [p];
}

export default function PlatformParamsRegistryPage() {
  const domains = Object.keys(DOMAIN_META).filter((d) => rows.some((r) => r.domain === d));
  const mcCount = rows.filter((r) => r.makerChecker).length;

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <header className="mb-4">
        <p className="font-mono-tabular text-[11px]" style={{ color: "var(--admin-domain-a)" }}>A5 · 平台基础</p>
        <h1 className="font-display mt-1 text-[24px]" style={{ color: "var(--v5-ink)" }}>平台参数寄存器</h1>
        <p className="mt-1.5 max-w-[760px] text-[12.5px] leading-relaxed" style={{ color: "var(--v5-ink-3)" }}>
          全平台业务常量字段级目录 —— 每个参数为<strong style={{ color: "var(--v5-ink-2)" }}>回源真值</strong>(取自前端代码常量,非示意值),
          标注控制类型 / 运营杠杆 / Maker-Checker / server-canonical / 端点 / 前端出处,并跳转该域 config 模块编辑。
          这是平台运营面的最细颗粒度控制索引(数据源:全平台参数单一真源,永同步)。
        </p>
        <div className="mt-3 flex flex-wrap gap-2.5">
          <Stat label="平台参数" value={`${rows.length}`} accent="var(--admin-domain-a)" />
          <Stat label="覆盖域" value={`${domains.length}`} />
          <Stat label="高敏(MC 双签)" value={`${mcCount}`} accent="var(--v5-warning)" />
          <Stat label="server-canonical" value="服务端权威" sub="客户端仅 UI cache" />
        </div>
      </header>

      <div className="flex flex-col gap-3.5">
        {domains.map((d) => {
          const meta = DOMAIN_META[d];
          const dr = rows.filter((r) => r.domain === d);
          return (
            <section key={d} className="rounded-[12px] p-4" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
              <div className="mb-3 flex items-center gap-2">
                <span className="font-mono-tabular rounded-[6px] px-1.5 py-0.5 text-[11px]" style={{ background: "color-mix(in srgb, " + meta.accent + " 16%, transparent)", color: meta.accent }}>{d}</span>
                <span className="font-display text-[14px]" style={{ color: "var(--v5-ink)" }}>{meta.label}</span>
                <span className="font-mono-tabular text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>{dr.length} 参数</span>
              </div>
              <div className="flex flex-col gap-2">
                {dr.map((r) => {
                  const ctrl = CTRL_META[r.controlType || "param-config"] || CTRL_META["param-config"];
                  const CtrlIcon = ctrl.icon;
                  const owner = ownerFor(r);
                  return (
                    <div key={r.id} className="rounded-[9px] p-2.5" style={{ background: "var(--v5-surface-2)" }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-mono-tabular text-[12px] leading-snug" style={{ color: "var(--v5-ink)", wordBreak: "break-word" }}>{r.frontendField}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: "var(--v5-surface)", color: "var(--v5-ink-3)" }}>
                              <CtrlIcon size={10} /> {ctrl.label}
                            </span>
                            {opsList(r.opsPurpose).map((o) => (
                              <span key={o} className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: "color-mix(in srgb, " + meta.accent + " 12%, transparent)", color: meta.accent }}>{OPS_LABEL[o] || o}</span>
                            ))}
                            {r.makerChecker && (
                              <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: "color-mix(in srgb, var(--v5-warning) 14%, transparent)", color: "var(--v5-warning)" }}>
                                <ShieldCheck size={10} /> MC 双签
                              </span>
                            )}
                          </div>
                          {r.endpoint && <p className="font-mono-tabular mt-1 text-[10px]" style={{ color: "var(--v5-ink-4)" }}>{r.endpoint}</p>}
                          {r.frontendSource && <p className="mt-0.5 text-[10px]" style={{ color: "var(--v5-ink-4)" }}>源 · {r.frontendSource}</p>}
                        </div>
                        <Link href={owner.path} prefetch={false} className="inline-flex shrink-0 items-center gap-1 rounded-[7px] px-2 py-1 text-[10.5px] transition-colors hover:bg-[var(--v5-surface)]"
                          style={{ border: "1px solid var(--v5-border)", color: meta.accent }}>
                          {owner.label}<ArrowUpRight size={11} />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed" style={{ color: "var(--v5-ink-4)" }}>
        资金 / 资产 / 收益 / 规则 / kill-switch 类参数变更一律 Maker-Checker 双签 + 发起人不可自审 + server-canonical 服务端权威 + 审计留痕;
        本页为只读索引,实际改值在各域 config 模块内执行。
      </p>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-[9px] px-3 py-2" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
      <p className="text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>{label}</p>
      <p className="font-mono-tabular text-[15px]" style={{ color: accent || "var(--v5-ink)" }}>{value}</p>
      {sub && <p className="text-[9.5px]" style={{ color: "var(--v5-ink-4)" }}>{sub}</p>}
    </div>
  );
}
