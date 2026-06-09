"use client";

/**
 * C1 用户详情(L3 · 画像全景)。L1 用户与账户 → L2 检索画像 → L3 本页。
 * 跨域聚合:资产(C3)/ 风险(K4)/ KYC(C4)/ 会话(C5)/ 账户操作(C2)/ 审计(A2)。数据 mock。
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Snowflake, LogOut, UserCog, ShieldAlert } from "lucide-react";
import { findUser, type UserKyc } from "@/lib/mock/admin/users";
import { fmtUsd, fmtNum } from "@/lib/format";
import { confirm, toast } from "@/lib/store/ui";
import { KpiStatCard } from "@/app/components/kit/kpi-stat-card";
import { StatusPill, type PillTone } from "@/app/components/kit/status-pill";
import { AuditTimeline } from "@/app/components/kit/audit-timeline";
import { DepositSection } from "@/app/components/hub/deposit-section";
import { WithdrawalSection } from "@/app/components/hub/withdrawal-section";
import { DevicesSection } from "@/app/components/hub/devices-section";
import { EarningsSection } from "@/app/components/hub/earnings-section";
import { ReferralSection } from "@/app/components/hub/referral-section";
import { VRankSection } from "@/app/components/hub/vrank-section";
import { FinancialSection } from "@/app/components/hub/financial-section";
import { EngagementSection } from "@/app/components/hub/engagement-section";
import { AccountSection } from "@/app/components/hub/account-section";
import { CommerceSection } from "@/app/components/hub/commerce-section";
import { NotificationSection } from "@/app/components/hub/notification-section";
import { useUserOps, useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import type { AuditEntry } from "@/app/components/kit/audit-timeline";

const KYC_TONE: Record<UserKyc, PillTone> = { 已认证: "success", 复审中: "warning", 待认证: "neutral" };
function riskColor(s: number): string {
  return s >= 70 ? "var(--v5-danger)" : s >= 40 ? "var(--v5-warning)" : "var(--v5-success)";
}

function Section({ title, tag, children }: { title: string; tag?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] p-4" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="font-display text-[14px]" style={{ color: "var(--v5-ink)" }}>{title}</span>
        {tag && <span className="font-mono-tabular text-[10px]" style={{ color: "var(--v5-ink-4)" }}>{tag}</span>}
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5" style={{ borderBottom: "1px solid var(--v5-border)" }}>
      <span className="text-[12px]" style={{ color: "var(--v5-ink-4)" }}>{label}</span>
      <span className="text-[12.5px]" style={{ color: "var(--v5-ink)" }}>{children}</span>
    </div>
  );
}

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const user = findUser(params.id);
  const hydrated = useOpsHydrated();
  const storeAudit = useUserOps((s) => s.users[params.id]?.audit);
  const storeFrozen = useUserOps((s) => s.users[params.id]?.frozen);
  const opsAudit = hydrated ? (storeAudit ?? []) : [];
  const frozen = hydrated ? (storeFrozen ?? false) : false;
  const setFrozen = useUserOps((s) => s.setFrozen);
  const opsLog = useUserOps((s) => s.log);

  if (!user) {
    return (
      <div className="w-full">
        <Link href="/users/search" prefetch={false} className="inline-flex items-center gap-1 text-[12.5px]" style={{ color: "var(--v5-ink-3)" }}>
          <ArrowLeft size={14} /> 返回检索
        </Link>
        <p className="mt-6 text-[14px]" style={{ color: "var(--v5-ink-3)" }}>用户 {params.id} 不存在。</p>
      </div>
    );
  }

  async function doFreeze() {
    const next = !frozen;
    const yes = await confirm({
      title: next ? "冻结账户?" : "解冻账户?",
      message: next ? `冻结 ${user!.nickname} 的提现与交易,转合规核查。需第二角色复核 + 审计留痕。` : `恢复 ${user!.nickname} 的提现与交易能力。`,
      confirmLabel: next ? "确认冻结" : "确认解冻",
      danger: next,
    });
    if (yes) {
      setFrozen(user!.id, next);
      toast.success(next ? "账户已冻结" : "账户已解冻", `${user!.id} · ${user!.nickname}`);
    }
  }
  async function act(title: string, message: string, ok: string, action: string, detail: string, tone: "danger" | "warning" | "success" | "neutral", danger?: boolean) {
    const yes = await confirm({ title, message, confirmLabel: ok, danger });
    if (yes) {
      opsLog(user!.id, action, detail, tone);
      toast.success(ok, `${user!.id} · ${user!.nickname}`);
    }
  }
  const mergedAudit: AuditEntry[] = [
    ...opsAudit.map((a) => ({ id: a.id, actor: a.actor, role: "superadmin" as const, action: a.action, detail: a.detail, at: a.tsLabel, ip: "—" })),
    ...user.audit,
  ];

  // KPI 卡点击 = 滚动到本页该用户对应的 360 卡(显示「该用户」明细),不跳全局看板。
  const kpis = [
    { label: "可提余额", value: fmtUsd(user.balanceUsd), accent: "var(--admin-domain-d)", anchor: "hub-deposit" },
    { label: "累计充值", value: fmtUsd(user.depositedUsd), accent: "var(--admin-domain-c)", anchor: "hub-deposit" },
    { label: "累计提现", value: fmtUsd(user.withdrawnUsd), accent: "var(--v5-warning)", anchor: "hub-withdrawal" },
    { label: "团队规模", value: `${fmtNum(user.teamSize)} 人`, accent: "var(--admin-domain-f)", anchor: "hub-referral" },
    { label: "设备数", value: `${fmtNum(user.deviceCount)} 台`, accent: "var(--admin-domain-e)", anchor: "hub-devices" },
  ];
  function scrollToHub(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="mx-auto w-full max-w-[1100px]">
      {/* 返回 + 头部 */}
      <Link href="/users/search" prefetch={false} className="inline-flex items-center gap-1 text-[12.5px] transition-colors hover:opacity-80" style={{ color: "var(--v5-ink-3)" }}>
        <ArrowLeft size={14} /> 返回检索
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-[24px]" style={{ color: "var(--v5-ink)" }}>{user.nickname}</h1>
            <span className="font-mono-tabular text-[12px]" style={{ color: "var(--v5-ink-4)" }}>{user.id}</span>
          </div>
          <p className="mt-1 text-[12.5px]" style={{ color: "var(--v5-ink-3)" }}>{user.email} · 注册 {user.registeredAt}({user.regPhase})</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill label={`KYC ${user.kyc}`} tone={KYC_TONE[user.kyc]} size="sm" dot={false} />
            <StatusPill label={`风险 ${user.riskScore}`} tone={user.riskScore >= 70 ? "danger" : user.riskScore >= 40 ? "warning" : "success"} size="sm" />
            <span className="font-mono-tabular rounded-full px-2 py-0.5 text-[10.5px]" style={{ background: "var(--v5-surface-2)", color: "var(--v5-ink-3)" }}>分层 {user.lifecycle} · {user.vRank}</span>
            {user.flags.map((f) => (
              <span key={f} className="rounded-full px-2 py-0.5 text-[10.5px]" style={{ background: "color-mix(in srgb, var(--v5-danger) 14%, transparent)", color: "var(--v5-danger)" }}>{f}</span>
            ))}
          </div>
        </div>
      </header>

      {frozen && (
        <div className="mt-3 flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12.5px]" style={{ background: "color-mix(in srgb, var(--v5-danger) 12%, transparent)", color: "var(--v5-danger)", border: "1px solid color-mix(in srgb, var(--v5-danger) 30%, transparent)" }}>
          <Snowflake size={14} /> 账户已冻结 — 提现与交易已停用,待第二角色复核解冻。
        </div>
      )}

      {/* KPI 行(跨域) */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map((k) => (
          <button key={k.label} type="button" onClick={() => scrollToHub(k.anchor)} title={`查看该用户 ${k.label} 明细`}
            className="block w-full text-left transition-transform hover:-translate-y-0.5">
            <KpiStatCard label={k.label} value={k.value} accent={k.accent} />
          </button>
        ))}
      </div>

      {/* 主体两栏 */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* 左:风险画像 + 资产 */}
        <div className="flex flex-col gap-4">
          <Section title="风险画像" tag="K4 风险评分 · C4 KYC">
            <div className="flex items-center gap-4">
              <div>
                <p className="font-mono-tabular text-[32px] leading-none" style={{ color: riskColor(user.riskScore) }}>{user.riskScore}</p>
                <p className="text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>/ 100 · ≥70 高危</p>
              </div>
              <div className="flex-1">
                <Row label="KYC 状态"><StatusPill label={user.kyc} tone={KYC_TONE[user.kyc]} size="sm" dot={false} /></Row>
                <Row label="风险标记">{user.flags.length ? user.flags.join(" · ") : "无"}</Row>
              </div>
            </div>
          </Section>

          <Section title="资产 & 账户" tag="C3 余额资产 · 双币 USDT/NEX">
            <Row label="可提余额 · USDT"><span className="font-mono-tabular">{fmtUsd(user.balanceUsd)}</span></Row>
            <Row label="NEX 余额"><span className="font-mono-tabular">{(user.nexBalance ?? Math.round(user.balanceUsd * 1.6 + user.depositedUsd * 0.4)).toLocaleString()} NEX</span></Row>
            <Row label="累计充值"><span className="font-mono-tabular">{fmtUsd(user.depositedUsd)}</span></Row>
            <Row label="累计提现"><span className="font-mono-tabular">{fmtUsd(user.withdrawnUsd)}</span></Row>
            <Row label="净沉淀"><span className="font-mono-tabular" style={{ color: user.depositedUsd - user.withdrawnUsd >= 0 ? "var(--v5-success)" : "var(--v5-danger)" }}>{fmtUsd(user.depositedUsd - user.withdrawnUsd)}</span></Row>
          </Section>
        </div>

        {/* 右:账户操作 + 会话 */}
        <div className="flex flex-col gap-4">
          <Section title="账户操作" tag="C2 · 需 Maker-Checker 双审批">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={doFreeze}
                className="inline-flex items-center gap-1.5 rounded-[9px] px-3 py-2 text-[12.5px] transition-colors hover:bg-[var(--v5-surface-2)]" style={{ border: "1px solid var(--v5-border)", color: frozen ? "var(--v5-success)" : "var(--v5-ink-2)" }}>
                <Snowflake size={14} style={{ color: frozen ? "var(--v5-success)" : "var(--v5-danger)" }} /> {frozen ? "解冻账户" : "冻结账户"}
              </button>
              <button type="button" onClick={() => act("强制登出?", `使 ${user.nickname} 的全部会话失效。`, "确认登出", "强制登出", "全部登录会话已失效", "warning")}
                className="inline-flex items-center gap-1.5 rounded-[9px] px-3 py-2 text-[12.5px] transition-colors hover:bg-[var(--v5-surface-2)]" style={{ border: "1px solid var(--v5-border)", color: "var(--v5-ink-2)" }}>
                <LogOut size={14} style={{ color: "var(--v5-warning)" }} /> 强制登出
              </button>
              <button type="button" onClick={() => act("以该用户身份登入?", `impersonate ${user.nickname} · 全程审计留痕。`, "确认登入", "impersonate", "以该用户身份登入(只读)· 审计留痕", "neutral")}
                className="inline-flex items-center gap-1.5 rounded-[9px] px-3 py-2 text-[12.5px] transition-colors hover:bg-[var(--v5-surface-2)]" style={{ border: "1px solid var(--v5-border)", color: "var(--v5-ink-2)" }}>
                <UserCog size={14} style={{ color: "var(--v5-tech-cyan)" }} /> impersonate
              </button>
            </div>
            <p className="mt-2.5 flex items-center gap-1 text-[11px]" style={{ color: "var(--v5-ink-4)" }}>
              <ShieldAlert size={12} /> 高敏动作均需第二角色复核,全程写入审计。
            </p>
          </Section>

          <Section title="安全 & 会话" tag="C5 安全会话">
            <ul className="flex flex-col gap-1.5">
              {user.sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded-[8px] p-2" style={{ background: "var(--v5-surface-2)" }}>
                  <div>
                    <p className="text-[12.5px]" style={{ color: "var(--v5-ink)" }}>{s.device}</p>
                    <p className="font-mono-tabular text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>{s.ip} · {s.lastActive}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>

      {/* 360 HUB · 字段级明细(C1·deepening)。KPI 卡锚点滚动至此(均为该用户数据)。 */}
      <div className="mt-4 flex flex-col gap-4">
        <div id="hub-deposit" style={{ scrollMarginTop: 76 }}><DepositSection user={user} /></div>
        <div id="hub-withdrawal" style={{ scrollMarginTop: 76 }}><WithdrawalSection user={user} /></div>
        <div id="hub-devices" style={{ scrollMarginTop: 76 }}><DevicesSection user={user} /></div>
        <EarningsSection user={user} />
        <div id="hub-referral" style={{ scrollMarginTop: 76 }}><ReferralSection user={user} /></div>
        <VRankSection user={user} />
        <FinancialSection user={user} />
        <EngagementSection user={user} />
        <CommerceSection user={user} />
        <AccountSection user={user} />
        <NotificationSection user={user} />
      </div>

      {/* 审计 */}
      <div className="mt-4">
        <Section title="审计时间线" tag="A2 全程留痕">
          <AuditTimeline entries={mergedAudit} />
        </Section>
      </div>
    </div>
  );
}
