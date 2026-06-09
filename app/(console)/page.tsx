"use client";

/**
 * 运营指挥台(首页 /)。按 Claude Design「Nexion 运营控制后台」稿优点重构:
 * ① 页头(口径副标 + 对账导出)→ 破线条件 alertbar(仅建议)
 * ② 资金兑付安全 B1·B2·B5:CoverageHero(横向分区条 + 三账本)+ RiskRadar;FundPool 堆叠条 + 覆盖率趋势
 * ③ 实时运营脉搏 → ④ 待处理(Maker-Checker)→ ⑤ 转化漏斗 → ⑥ 八项 KPI → ⑦ 域速览
 * 数字取 canonical LEDGER + 实时提现队列;其余 command-center mock。按角色过滤。侧栏沿用原风格。
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, Download } from "lucide-react";
import type { NavDomain, AdminRole } from "@/lib/nav/console-nav";
import { CONSOLE_NAV, visibleDomains, canSee, L2_COUNT } from "@/lib/nav/console-nav";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useWithdrawalQueue } from "@/lib/store/withdrawal-queue";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { KILLSWITCH } from "@/lib/mock/admin/design-data";
import {
  FUNNEL,
  KPIS,
  CURRENT_PHASE,
  PENDING_APPROVALS,
  DOMAIN_PULSE,
  type AlertItem,
} from "@/lib/mock/admin/command-center";
import { fmtPct, fmtUsdCompact, fmtNum } from "@/lib/format";
import { KpiStatCard } from "@/app/components/kit/kpi-stat-card";
import { AutoGloss } from "@/app/components/kit/gloss";
import { StatusPill } from "@/app/components/kit/status-pill";
import { SecLabel } from "@/app/components/kit/sec-label";
import { CoverageHero } from "@/app/components/dashboard/coverage-hero";
import { ExposureCard } from "@/app/components/dashboard/exposure-card";
import { FundPool } from "@/app/components/dashboard/fund-pool";
import { RiskRadar, type KillGate } from "@/app/components/dashboard/risk-radar";
import { ApprovalInbox, type ApprovalInboxItem } from "@/app/components/dashboard/approval-inbox";
import { FunnelBars } from "@/app/components/dashboard/funnel-bars";
import { PhaseCard } from "@/app/components/dashboard/phase-card";
import { KpiWall } from "@/app/components/dashboard/kpi-wall";

const round2 = (n: number) => Math.round(n * 100) / 100;

const FLAGGED_ACCOUNTS = 14; // K 域当前风险命中(对齐 DOMAIN_PULSE.K)

function DomainTile({ domain, pulse }: { domain: NavDomain; pulse: string }) {
  const Icon = domain.icon;
  const accent = `var(${domain.accentVar})`;
  const flagship = domain.l2.find((l) => l.status === "flagship");
  const target = flagship ?? domain.l2[0];
  return (
    <Link
      href={target.path}
      prefetch={false}
      className="group flex flex-col rounded-[12px] border p-3 transition-all duration-200 hover:-translate-y-0.5 border-[var(--v5-border)] bg-[var(--v5-surface)] hover:border-[var(--v5-border-strong)]"
    >
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-[9px]"
          style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)` }}
        >
          <Icon size={16} style={{ color: accent }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px]" style={{ color: "var(--v5-ink)" }}>{domain.name}</p>
          <p className="font-mono-tabular text-[10px]" style={{ color: "var(--v5-ink-4)" }}>域 {domain.code} · {domain.l2.length} 模块</p>
        </div>
        {flagship ? (
          <StatusPill label="已上线" tone="brand" size="sm" />
        ) : (
          <StatusPill label="规格就绪" tone="info" size="sm" dot={false} />
        )}
      </div>
      <p className="mt-2 text-[11.5px]" style={{ color: "var(--v5-ink-3)" }}><AutoGloss>{pulse}</AutoGloss></p>
    </Link>
  );
}

export default function CommandCenter() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const role = useAdminAuth((s) => (mounted ? s.role : "superadmin"));
  const operator = useAdminAuth((s) => (mounted ? s.operator : "总管理员"));
  const requests = useWithdrawalQueue((s) => s.requests);

  // Kill 闸状态 — 单一源:store(J.killswitch.<key>)为准、缺省回落 KILLSWITCH.on(与 J1 / B5 恒一致,7 闸)。
  const killParams = usePlatformConfig((s) => s.params);
  const opsHydrated = useOpsHydrated();
  const KILL_GATES: KillGate[] = KILLSWITCH.map((k) => {
    const ov = opsHydrated ? (killParams?.[`J.killswitch.${k.key}`] as string | undefined) : undefined;
    return { key: k.key, on: ov ? ov === "on" : k.on };
  });

  const domains = mounted ? visibleDomains(role) : CONSOLE_NAV;

  // ── 生命体征 / 实时派生 ──
  const cov = LEDGER.coverageRatio;
  const zoneLabel = cov < LEDGER.redlinePct ? "跌破红线" : cov < LEDGER.healthyPct ? "警戒" : "健康";
  const open = requests.filter((r) => r.state === "pending" || r.state === "in_review");
  const inReview = requests.filter((r) => r.state === "in_review").length;
  const backlogUsd = open.reduce((s, r) => s + r.amountUsd, 0);
  const bankRunRatio = round2((LEDGER.queueBacklogUsd / LEDGER.reserveUsd) * 100); // 挤兑比率口径=待提现负债/储备,对齐 FundPool 的 $430K
  const outflowChg = Math.round(((Math.abs(LEDGER.netFlow24hUsd) - Math.abs(LEDGER.prev.netFlow24hUsd)) / Math.abs(LEDGER.prev.netFlow24hUsd)) * 100);
  const riskChg = LEDGER.avgRiskScore - LEDGER.prev.avgRiskScore;

  // ── 待我处理(按角色过滤)──
  const approvalItems: ApprovalInboxItem[] = [
    { id: "pa-wd", label: "提现复核队列", detail: `${inReview} 单在审 · 积压 ${fmtUsdCompact(backlogUsd)}`, href: "/finance/withdrawals", role: "finance" as AdminRole },
    ...PENDING_APPROVALS.map((p) => ({ id: p.id, label: p.label, detail: p.detail, href: p.href, role: p.requiredRole })),
  ].filter((it) => canSee(role, [it.role]));

  // ── 实时告警(喂给 RiskRadar)──
  const newAccountBig = open.filter((r) => r.kyc !== "已认证" && r.amountUsd >= 5000).length;
  const covLevel: AlertItem["level"] = cov < LEDGER.healthyPct ? "high" : "low";
  const covText =
    cov < LEDGER.redlinePct
      ? `兑付覆盖率 ${fmtPct(cov)} 已跌破红线 ${fmtPct(LEDGER.redlinePct, 0)} · 立即冻结放大流出`
      : cov < LEDGER.healthyPct
        ? `兑付覆盖率 ${fmtPct(cov)} 逼近红线 ${fmtPct(LEDGER.redlinePct, 0)}`
        : `兑付覆盖率 ${fmtPct(cov)} 健康`;
  // Kill 闸告警文案派生自 KILL_GATES(单源,与 J1/B5 一致;非硬编码,operator 熔断后即时反映)。
  const killTripped = KILL_GATES.filter((g) => !g.on).length;
  const killOnline = KILL_GATES.length - killTripped;
  const killText =
    killTripped === 0
      ? `Kill-Switch ${killOnline}/${KILL_GATES.length} 在线 · 功能闸全部正常`
      : `Kill-Switch ${killOnline}/${KILL_GATES.length} 在线 · ${killTripped} 熔断待复核`;
  const liveAlerts: AlertItem[] = [
    { id: "al-cov", level: covLevel, text: covText, href: "/overview/dual-ledger" },
    { id: "al-multi", level: "high", text: "WD-2606-0148 命中多账户关联 · 待合规核查", href: "/finance/withdrawals" },
    ...(newAccountBig > 0 ? [{ id: "al-newbig", level: "mid" as AlertItem["level"], text: `新账户大额提现 ×${newAccountBig} 待复核`, href: "/finance/withdrawals" }] : []),
    { id: "al-kill", level: killTripped === 0 ? "low" : "mid", text: killText, href: "/emergency/kill-switch" },
  ];

  const passedKpi = KPIS.filter((k) => k.pass).length;
  function pulseFor(code: string): string {
    if (code === "B") return `覆盖率 ${fmtPct(cov)} · ${zoneLabel}`;
    if (code === "D") return `待审提现 ${open.length} · 积压 ${fmtUsdCompact(backlogUsd)}`;
    if (code === "J") return `Kill ${killOnline}/${KILL_GATES.length} 在线${killTripped ? ` · ${killTripped} 熔断` : ""} · Geo 屏蔽 3 国`;
    if (code === "L") return `8 KPI · 达标 ${passedKpi} / 未达 ${KPIS.length - passedKpi}`;
    return DOMAIN_PULSE[code] ?? "";
  }

  // 对账导出 — 客户端导出当前账本快照(真实功能,无需后端)
  function exportSnapshot() {
    const snap = {
      generatedAt: new Date().toISOString(),
      coverageRatio: round2(LEDGER.coverageRatio),
      redlinePct: LEDGER.redlinePct,
      healthyPct: LEDGER.healthyPct,
      reserveUsd: LEDGER.reserveUsd,
      liabilitiesUsd: LEDGER.liabilitiesUsd,
      netExposureUsd: LEDGER.reserveUsd - LEDGER.liabilitiesUsd,
      accounts: LEDGER.accounts.map((a) => ({ key: a.key, label: a.label, amount: a.amount })),
    };
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nexion-reconciliation-${snap.generatedAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="w-full">
      {/* 页头 */}
      <header className="mb-5 flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-mono-tabular text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--v5-ink-3)" }}>
            Nexion Ops Console · 指挥台
          </p>
          <h1 className="font-display mt-1.5 text-[26px]" style={{ color: "var(--v5-ink)" }}>运营总览</h1>
          <p className="mt-1.5 text-[13.5px]" style={{ color: "var(--v5-ink-2)" }}>
            欢迎,{operator}<AutoGloss> · 资金兑付安全与转化健康一屏汇聚 · 数据派生自 A4 事件流,以服务端为准(server-canonical)。</AutoGloss>
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <span
            className="inline-flex items-center gap-2 rounded-[9px] px-3 py-2 text-[12.5px]"
            style={{ background: "var(--v5-brand-soft)", border: "1px solid var(--v5-brand-border)", color: "var(--v5-brand)" }}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--v5-brand)" }} />
            {CURRENT_PHASE.code} · {CURRENT_PHASE.name} · 第 {CURRENT_PHASE.month}/{CURRENT_PHASE.total} 月
          </span>
          <button
            type="button"
            onClick={exportSnapshot}
            className="inline-flex items-center gap-2 rounded-[9px] px-3.5 py-2 text-[13px] font-medium transition-colors hover:bg-[var(--v5-surface-2)]"
            style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border-strong)", color: "var(--v5-ink)" }}
          >
            <Download size={15} aria-hidden /> <AutoGloss>对账导出</AutoGloss>
          </button>
        </div>
      </header>

      {/* 破线告警条(覆盖率低于健康线 · 仅建议,不自动执行)*/}
      {cov < LEDGER.healthyPct && (
        <Link
          href="/overview/dual-ledger"
          prefetch={false}
          className="mb-4 flex items-center gap-3 rounded-[11px] p-3 transition-colors"
          style={{ background: "var(--v5-warning-soft)", border: "1px solid color-mix(in srgb, var(--v5-warning) 40%, transparent)" }}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]" style={{ background: "color-mix(in srgb, var(--v5-warning) 18%, transparent)" }}>
            <AlertTriangle size={16} style={{ color: "var(--v5-warning)" }} aria-hidden />
          </span>
          <span className="text-[13px]" style={{ color: "var(--v5-ink-2)" }}>
            <AutoGloss>{covText}</AutoGloss><AutoGloss> · 建议收紧放大流出 dial（仅建议,不自动执行）</AutoGloss>
          </span>
        </Link>
      )}

      {/* ② 资金兑付安全 */}
      <SecLabel title="资金兑付安全" modules="B1 · B2 · B5" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CoverageHero />
        </div>
        <ExposureCard />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <FundPool />
        </div>
        <RiskRadar alerts={liveAlerts} bankRunRatio={bankRunRatio} flaggedAccounts={FLAGGED_ACCOUNTS} killGates={KILL_GATES} />
      </div>

      {/* ③ 实时运营脉搏 */}
      <SecLabel title="实时运营脉搏" modules="D · K · 较上窗口" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/overview/liquidity" prefetch={false} className="block transition-transform hover:-translate-y-0.5">
          <KpiStatCard label="24h 净流入" value={fmtUsdCompact(LEDGER.netFlow24hUsd)} accent="var(--v5-success)" sublabel="较上窗口" hint="近 24 小时资金净流入额(扩张期毛流入 ≫ payout,储备累积)。" delta={{ dir: "up", text: `流入 +${outflowChg}%`, good: true }} />
        </Link>
        <Link href="/finance/withdrawals" prefetch={false} className="block transition-transform hover:-translate-y-0.5">
          <KpiStatCard label="提现积压" value={`${fmtNum(open.length)} 单`} accent="var(--admin-domain-k)" sublabel={fmtUsdCompact(backlogUsd)} hint="进入复核、尚未放行的提现单数与金额。" />
        </Link>
        <Link href="/risk/scoring" prefetch={false} className="block transition-transform hover:-translate-y-0.5">
          <KpiStatCard label="风险评分均值" value={`${LEDGER.avgRiskScore}`} accent="var(--admin-domain-k)" sublabel="/ 100 · ≥70 高危" hint="在审提现的风险评分均值。" delta={{ dir: riskChg > 0 ? "up" : "down", text: `${riskChg > 0 ? "+" : ""}${riskChg}`, good: riskChg <= 0 }} />
        </Link>
      </div>

      {/* ④ 待处理 · Maker-Checker */}
      <SecLabel title="待处理 · Maker-Checker" modules="跨域审批 · 按角色" />
      <ApprovalInbox items={approvalItems} />

      {/* ⑤ 转化与运营节奏 */}
      <SecLabel title="转化与运营节奏" modules="B3 · B4 · A4 派生" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <FunnelBars stages={FUNNEL} />
        </div>
        <PhaseCard />
      </div>

      {/* ⑥ 八项 KPI 验收墙 */}
      <div className="mt-7">
        <KpiWall kpis={KPIS} />
      </div>

      {/* ⑦ 域速览 */}
      <div className="mt-7">
        <div className="mb-2.5 flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--v5-ink-4)" }}>域速览</p>
          <span className="text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}>{domains.length} 域 · 全平台 {L2_COUNT} 模块</span>
        </div>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(248px,1fr))]">
          {domains.map((d) => (
            <DomainTile key={d.code} domain={d} pulse={pulseFor(d.code)} />
          ))}
        </div>
      </div>
    </div>
  );
}
