/**
 * A5 平台参数寄存器(Platform Parameter Registry · 旗舰)。
 * 后端 A3 平台配置索引:只展示真实接口返回的配置项;接口为空或未登录时显示空态。
 * server component · 只读 + 跳转。
 */
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowUpRight, ShieldCheck, Database, SlidersHorizontal, Zap } from "lucide-react";

export const dynamic = "force-dynamic";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

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
  operationConfirm?: boolean;
  serverCanonical?: string;
  endpoint?: string;
  adminTarget?: string;
  coverage?: string;
  batch?: string;
}
interface PlatformConfigOverview {
  featureFlags?: Array<Record<string, unknown>> | null;
  killSwitches?: Array<Record<string, unknown>> | null;
  systemHealth?: Array<Record<string, unknown>> | null;
}

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
    [/repurchase|复投|lock_months/, "/finance-products/repurchase", "G7 复投激励"],
    [/device_price|device_specs|baserate|products\[|catalog|max_devices/, "/devices/pricing", "E1 商品定价"],
    [/degradation|salvage|decay|efficiency|lifecycle/, "/devices/trade-in", "E3 衰减/残值(并入生命周期)"],
    [/trade.?in|tradein|upgrade_ladder/, "/devices/trade-in", "E3 trade-in 配置"],
    [/trial|shadow|discount|autopush|autocharge/, "/growth/trial", "H2 Trial 引擎"],
    [/phase|10-dial|getphasereward|monthly_locked|inviteBonusMultiplier/, "/growth/phase", "H1 Phase 调度"],
    [/quest|tier[12]|streak|weekly_bonus|spin_prizes|lucky/, "/growth/quest", "H3 任务引擎"],
    [/milestone|achievement|earnings_milestone/, "/growth/daily", "H5 签到 & 里程碑"],
    [/stella|cadence|agent_pool|enterliveagent/, "/content/notifications", "I3 推送/Stella"],
    [/unilevel|binary|commission|sponsor|invite_reward|welcome_gift/, "/network/royalty", "F2 佣金规则"],
    [/v_rank|directbonus|peerbonus|cultivation|v_vote|vrankcond|prizename|v_distribution/, "/network/v-rank", "F1 V 级阶梯"],
    [/leadership|currentweekpool|领导池/, "/network/leadership-pool", "F4 领导池"],
    [/withdrawal|提现|min_withdrawal|fee|daily_cap|user_daily/, "/finance/params", "D5 提现参数"],
    [/billtype|账单/, "/finance/ledger", "D4 平台账本"],
    [/lesson|categor|learn|format_label/, "/content/i18n", "I6 i18n 文案与教程"],
    [/disclos|risk.?disclosure|compliance|kyc.?express|trust/, "/content/trust", "I4 信任中心与披露"],
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
    H: ["/growth/phase", "H1 Phase 调度"], I: ["/content/trust", "I4 信任中心与披露"],
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

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function backendRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object").map((item) => item as Record<string, unknown>)
    : [];
}

function configRow(row: Record<string, unknown>, kind: "flag" | "kill" | "health"): CgmRow {
  const key = text(row.key, text(row.name, "unknown"));
  const source = text(row.name, key);
  return {
    id: `a3-${kind}-${key}`,
    domain: "A",
    scope: "platform",
    controlType: kind === "kill" ? "function-action" : kind === "health" ? "data-CRUD" : "param-config",
    frontendField: key,
    frontendSource: source,
    opsPurpose: "platform_integrity",
    endpoint: "/api/admin/platform/config/overview",
    operationConfirm: kind !== "health",
    serverCanonical: "true",
  };
}

async function fetchPlatformRows(): Promise<CgmRow[]> {
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return [];
  try {
    const response = await fetch(`${BACKEND_BASE_URL}/api/admin/platform/config/overview`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const result = (await response.json().catch(() => null)) as ApiResult<PlatformConfigOverview> | null;
    if (!response.ok || result?.code !== 0 || !result.data) return [];
    return [
      ...backendRows(result.data.featureFlags).map((row) => configRow(row, "flag")),
      ...backendRows(result.data.killSwitches).map((row) => configRow(row, "kill")),
      ...backendRows(result.data.systemHealth).map((row) => configRow(row, "health")),
    ];
  } catch {
    return [];
  }
}

export default async function PlatformParamsRegistryPage() {
  const rows = await fetchPlatformRows();
  const domains = Object.keys(DOMAIN_META).filter((d) => rows.some((r) => r.domain === d));
  const mcCount = rows.filter((r) => r.operationConfirm).length;

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <header className="mb-4">
        <p className="font-mono-tabular text-[11px]" style={{ color: "var(--admin-domain-a)" }}>A5 · 平台基础</p>
        <h1 className="font-display mt-1 text-[24px]" style={{ color: "var(--v5-ink)" }}>平台参数寄存器</h1>
        <p className="mt-1.5 max-w-[760px] text-[12.5px] leading-relaxed" style={{ color: "var(--v5-ink-3)" }}>
          本页只读取后端平台配置接口返回的配置项,并标注控制类型、操作确认、服务端权威与编辑入口。
          接口无数据、未登录或后端不可用时不展示业务参数记录。
        </p>
        <div className="mt-3 flex flex-wrap gap-2.5">
          <Stat label="平台参数" value={`${rows.length}`} accent="var(--admin-domain-a)" />
          <Stat label="覆盖域" value={`${domains.length}`} />
          <Stat label="高敏(操作确认)" value={`${mcCount}`} accent="var(--v5-warning)" />
          <Stat label="server-canonical" value={rows.length ? "服务端权威" : "0"} sub={rows.length ? "客户端仅 UI cache" : "接口空态"} />
        </div>
      </header>

      {rows.length === 0 ? (
        <section className="rounded-[12px] p-5" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
          <p className="font-display text-[14px]" style={{ color: "var(--v5-ink)" }}>暂无后端平台参数记录</p>
          <p className="mt-1 text-[12px]" style={{ color: "var(--v5-ink-3)" }}>
            请先登录并确认 /api/admin/platform/config/overview 返回配置项;本页不会从文档或前端常量生成业务参数。
          </p>
        </section>
      ) : (
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
                            {r.operationConfirm && (
                              <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: "color-mix(in srgb, var(--v5-warning) 14%, transparent)", color: "var(--v5-warning)" }}>
                                <ShieldCheck size={10} /> 操作确认
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
      )}

      <p className="mt-4 text-[11px] leading-relaxed" style={{ color: "var(--v5-ink-4)" }}>
        资金 / 资产 / 收益 / 规则 / kill-switch 类参数变更一律 操作确认 + 操作理由必填 + server-canonical 服务端权威 + 审计留痕;
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
