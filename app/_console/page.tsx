"use client";

/**
 * 运营指挥台(首页 /)。按 Claude Design「Nexion 运营控制后台」稿优点重构:
 * ① 页头(口径副标 + 对账导出)→ 破线条件 alertbar(仅建议)
 * ② 资金兑付安全 B1·B2·B5:CoverageHero(横向分区条 + 三账本)+ RiskRadar;FundPool 堆叠条 + 覆盖率趋势
 * ③ 实时运营脉搏 → ④ 待处理(操作确认)→ ⑤ 转化漏斗 → ⑥ 八项 KPI → ⑦ 域速览
 * B 域资金/漏斗/节奏/风险和提现积压取后端聚合接口。按角色过滤。
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import type { NavDomain, AdminRole } from "@/lib/nav/console-nav";
import { canAccessResolvedPath, CONSOLE_NAV, resolveVisibleDomains } from "@/lib/nav/console-nav";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useBDomainDashboard } from "@/lib/admin/b-client";
import { fetchA2Overview, type A2OperationRow, type A2Overview } from "@/lib/admin/a2-client";
import { fetchLBiOverviews, type LBiData } from "@/lib/admin/l-client";
import { fmtPct, fmtUsdCompact, fmtNum } from "@/lib/format";
import { KpiStatCard } from "@/app/components/kit/kpi-stat-card";
import { AutoGloss } from "@/app/components/kit/gloss";
import { StatusPill } from "@/app/components/kit/status-pill";
import { SecLabel } from "@/app/components/kit/sec-label";
import { CoverageHero } from "@/app/components/dashboard/coverage-hero";
import { ExposureCard } from "@/app/components/dashboard/exposure-card";
import { FundPool } from "@/app/components/dashboard/fund-pool";
import { BDomainDataState, BDomainWarnings } from "@/app/components/dashboard/b-domain-state";
import { RiskRadar, type AlertItem, type KillGate } from "@/app/components/dashboard/risk-radar";
import { SensitiveOperationFeed, type SensitiveOperationItem } from "@/app/components/dashboard/sensitive-operation-feed";
import { FunnelBars } from "@/app/components/dashboard/funnel-bars";
import { KpiWall, type DashboardKpi } from "@/app/components/dashboard/kpi-wall";

const round2 = (n: number) => Math.round(n * 100) / 100;

function rawRec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function rawRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object").map((item) => item as Record<string, unknown>) : [];
}

function rawText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function rawNum(value: unknown, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function finiteRawNum(value: unknown) {
  const parsed = rawNum(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function rawNumRows(value: unknown): number[] {
  return Array.isArray(value) ? value.map((item) => rawNum(item, Number.NaN)).filter(Number.isFinite) : [];
}

function kpiTargetLabel(kpi: Record<string, unknown>) {
  const unit = rawText(kpi.unit);
  if (rawText(kpi.dir) === "band") {
    const [low, high] = rawNumRows(kpi.band);
    if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
    return `${low}-${high}${unit}`;
  }
  const dir = rawText(kpi.dir);
  if (dir !== "lte" && dir !== "gte") return null;
  const target = finiteRawNum(kpi.target);
  if (target == null) return null;
  const sign = dir === "lte" ? "<=" : ">=";
  return `${sign}${target}${unit}`;
}

function kpiPass(kpi: Record<string, unknown>) {
  const value = finiteRawNum(kpi.value);
  if (value == null) return null;
  const dir = rawText(kpi.dir);
  if (dir === "band") {
    const [low, high] = rawNumRows(kpi.band);
    if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
    return value >= low && value <= high;
  }
  if (dir !== "lte" && dir !== "gte") return null;
  const target = finiteRawNum(kpi.target);
  if (target == null) return null;
  return dir === "lte" ? value <= target : value >= target;
}

function normalizeDashboardKpis(data: LBiData | null): DashboardKpi[] {
  const l1 = rawRec(data?.l1);
  const kpiPlain = rawRec(l1.kpiPlain);
  const kpiExt = rawRec(l1.kpiExt);
  return rawRows(l1.kpis).flatMap((row, index) => {
    const n = finiteRawNum(row.n) ?? index + 1;
    const ext = rawRec(kpiExt[String(n)]);
    const spark = rawNumRows(row.spark);
    const unit = rawText(row.unit);
    const label = rawText(row.name).trim();
    const value = finiteRawNum(row.value);
    const target = kpiTargetLabel(row);
    const pass = kpiPass(row);
    if (!label || value == null || target == null || pass == null) return [];
    return [{
      key: `l1-${n}`,
      label,
      value: `${value}${unit}`,
      target,
      pass,
      series: spark,
      hint: rawText(kpiPlain[String(n)] ?? ext.note ?? row.vis, "L1 后端 BI 口径"),
    }];
  });
}

function roleForA2Operation(row: A2OperationRow): AdminRole | null {
  const gate = `${row.roleGate} ${row.operatorRole}`.toLowerCase();
  if (gate.includes("财务") || gate.includes("finance")) return "finance";
  if (gate.includes("风控") || gate.includes("risk")) return "risk";
  if (gate.includes("内容") || gate.includes("content")) return "content";
  if (gate.includes("增长") || gate.includes("growth")) return "growth";
  if (gate.includes("客服") || gate.includes("support")) return "support";
  if (gate.includes("审计") || gate.includes("auditor")) return "auditor";
  if (row.type === "fund") return "finance";
  if (row.type === "sos") return "risk";
  return null;
}

function operationDetail(row: A2OperationRow) {
  const delta = row.before !== "—" || row.after !== "—" ? `${row.before} → ${row.after}` : row.reason;
  return `${row.obj} · ${delta}`;
}

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

function DashboardDataState({ title, loading, error }: { title: string; loading?: boolean; error?: string | null }) {
  const isLoading = loading && !error;
  return (
    <section
      className="rounded-[12px] p-5"
      style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px]"
          style={{
            background: isLoading
              ? "color-mix(in srgb, var(--v5-brand) 14%, transparent)"
              : "color-mix(in srgb, var(--v5-warning) 16%, transparent)",
            color: isLoading ? "var(--v5-brand)" : "var(--v5-warning)",
          }}
        >
          {isLoading ? <Loader2 size={17} className="animate-spin" /> : <AlertTriangle size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium" style={{ color: "var(--v5-ink)" }}>
            {isLoading ? `${title}同步中` : `${title}暂无可用数据`}
          </div>
          <div className="mt-1 text-[12.5px]" style={{ color: "var(--v5-ink-3)" }}>
            {isLoading ? "正在读取服务端接口。" : error || "接口返回为空,页面保持空态。"}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function CommandCenter() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const sessionRole = useAdminAuth((s) => s.role);
  const sessionOperator = useAdminAuth((s) => s.operator);
  const session = useAdminAuth((s) => s.session);
  const [a2Overview, setA2Overview] = useState<A2Overview | null>(null);
  const [a2Error, setA2Error] = useState<string | null>(null);
  const [lBiData, setLBiData] = useState<LBiData | null>(null);
  const [lBiError, setLBiError] = useState<string | null>(null);
  const [lBiLoading, setLBiLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetchA2Overview()
      .then((overview) => {
        if (!alive) return;
        setA2Overview(overview);
        setA2Error(null);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setA2Error(error instanceof Error ? error.message : "A2_OVERVIEW_LOAD_FAILED");
      });
    fetchLBiOverviews()
      .then((data) => {
        if (!alive) return;
        setLBiData(data);
        setLBiError(null);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setLBiError(error instanceof Error ? error.message : "L_BI_OVERVIEW_LOAD_FAILED");
      })
      .finally(() => {
        if (alive) setLBiLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  const role = mounted ? sessionRole : null;
  const operator = mounted ? sessionOperator : "";
  const bDomain = useBDomainDashboard();
  const { ledger: LEDGER, funnel, rhythm, riskRadar } = bDomain;
  const renderBDomainState = (error: string | null, loading = false) => (
    <div className="w-full">
      <header className="mb-5 flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-mono-tabular text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--v5-ink-3)" }}>
            Nexion Ops Console · 指挥台
          </p>
          <h1 className="font-display mt-1.5 text-[26px]" style={{ color: "var(--v5-ink)" }}>运营总览</h1>
          <p className="mt-1.5 text-[13.5px]" style={{ color: "var(--v5-ink-2)" }}>
            欢迎,{operator || "当前操作者"}<AutoGloss> · 正在读取服务端 B 域资金、漏斗、节奏和风险聚合数据。</AutoGloss>
          </p>
        </div>
      </header>
      <BDomainWarnings warnings={bDomain.warnings} />
      <BDomainDataState title="B 域指挥台" loading={loading} error={error} onRetry={bDomain.reload} />
    </div>
  );

  if ((bDomain.loading && !bDomain.hasData) || bDomain.error || !bDomain.hasData) {
    return renderBDomainState(bDomain.error, bDomain.loading && !bDomain.error);
  }

  const homeDataError =
    LEDGER.coverageSeries.length < 2
      ? "B1_COVERAGE_SERIES_EMPTY"
      : !funnel.stages.length || !funnel.transitions.length || funnel.cohort.length < 2 || !funnel.channels.length || funnel.daily.length < 2
        ? "B3_REQUIRED_DATA_EMPTY"
        : "";
  if (homeDataError) {
    return renderBDomainState(homeDataError);
  }

  const KILL_GATES: KillGate[] = riskRadar.gates.map((gate) => ({ key: gate.dom, on: gate.on, state: gate.state }));
  const flaggedAccounts = riskRadar.flaggedAccounts || riskRadar.rules.reduce((sum, rule) => sum + rule.ct, 0);

  const domains = role ? resolveVisibleDomains({
    role,
    menuCodes: session?.menuCodes,
    authorities: session?.authorities ?? [],
  }) : [];
  const visibleModuleCount = domains.reduce((sum, domain) => sum + domain.l2.length, 0);

  // ── 生命体征 / 实时派生 ──
  const cov = LEDGER.coverageRatio;
  const zoneLabel = cov < LEDGER.redlinePct ? "跌破红线" : cov < LEDGER.healthyPct ? "警戒" : "健康";
  const inReview = LEDGER.queueBacklogCount;
  const backlogUsd = LEDGER.queueBacklogUsd;
  // 队列积压比率 = 待提现负债存量 ÷ 储备(B5 雷达「挤兑比率」为 24h 申请流量口径 7.9%,两者口径不同,RiskRadar 内已分别标注)
  const bankRunRatio = riskRadar.bankRunRatio || round2((LEDGER.queueBacklogUsd / Math.max(LEDGER.reserveUsd, 1)) * 100);
  const prevFlowAbs = Math.max(Math.abs(LEDGER.prev.netFlow24hUsd), 1);
  const outflowChg = Math.round(((Math.abs(LEDGER.netFlow24hUsd) - prevFlowAbs) / prevFlowAbs) * 100);
  const netFlowPositive = LEDGER.netFlow24hUsd >= 0;
  const netFlowDeltaText = `${netFlowPositive ? "流入" : "流出"} ${outflowChg >= 0 ? "+" : ""}${outflowChg}%`;
  const riskChg = LEDGER.avgRiskScore - LEDGER.prev.avgRiskScore;
  const dashboardKpis = normalizeDashboardKpis(lBiData);
  const pendingA2Operations = (a2Overview?.operationQueue ?? []).filter((item) => item.status === "pending");

  // ── 高敏操作动态(按角色过滤)──
  const sensitiveOperationItems: SensitiveOperationItem[] = [
    { id: "pa-wd", label: "提现确认队列", detail: `${inReview} 单在审 · 积压 ${fmtUsdCompact(backlogUsd)}`, href: "/finance/withdrawals", role: "finance" as AdminRole },
    ...pendingA2Operations.flatMap((row) => {
      const operationRole = roleForA2Operation(row);
      if (!operationRole) return [];
      return [{
        id: `a2-${row.id}`,
        label: row.action,
        detail: operationDetail(row),
        href: "/platform/audit",
        role: operationRole,
      }];
    }),
  ].filter((it) => role && canAccessResolvedPath(domains, it.href));

  // ── 实时告警(喂给 RiskRadar)──
  const k5HoldCnt = riskRadar.rules.find((rule) => rule.dom === "K5" || rule.nm.includes("KYC"))?.ct ?? 0;
  const sevLevel = (sev: string): AlertItem["level"] => (sev === "p0" || sev === "p1" ? "high" : sev === "p2" ? "mid" : "low");
  const covLevel: AlertItem["level"] = cov < LEDGER.redlinePct ? "high" : cov < LEDGER.healthyPct ? "mid" : "low";
  const covText =
    cov < LEDGER.redlinePct
      ? `兑付覆盖率 ${fmtPct(cov)} 已跌破红线 ${fmtPct(LEDGER.redlinePct, 0)} · 立即冻结放大流出`
      : cov < LEDGER.healthyPct
        ? `兑付覆盖率 ${fmtPct(cov)} 逼近红线 ${fmtPct(LEDGER.redlinePct, 0)}`
        : `兑付覆盖率 ${fmtPct(cov)} 健康`;
  // Kill 闸告警文案派生自 KILL_GATES(单源,与 J1/B5 一致;非硬编码,operator 熔断后即时反映)。
  const killTripped = KILL_GATES.filter((g) => (g.state ? g.state === "off" : !g.on)).length;
  const killMissing = KILL_GATES.filter((g) => g.state === "missing").length;
  const killOnline = KILL_GATES.filter((g) => (g.state ? g.state === "on" : g.on)).length;
  const killText =
    KILL_GATES.length === 0
      ? "Kill-Switch 状态同步中"
      : killTripped === 0
      ? `Kill-Switch ${killOnline}/${KILL_GATES.length} 在线${killMissing ? ` · ${killMissing} 未配置` : " · 功能闸全部正常"}`
      : `Kill-Switch ${killOnline}/${KILL_GATES.length} 在线 · ${killTripped} 熔断待确认`;
  const liveAlerts: AlertItem[] = [
    { id: "al-cov", level: covLevel, text: covText, href: "/overview/dual-ledger" },
    ...riskRadar.feed.slice(0, 4).map((item, index) => ({ id: `al-feed-${index}-${item.sev}`, level: sevLevel(item.sev), text: item.t, href: item.href })),
    ...(k5HoldCnt > 0 ? [{ id: "al-k5hold", level: "mid" as AlertItem["level"], text: `K5 复审 hold 提现单 ×${k5HoldCnt} · 复审未过不可放行`, href: "/finance/withdrawals" }] : []),
    { id: "al-kill", level: killTripped === 0 ? "low" : "mid", text: killText, href: "/emergency/kill-switch" },
  ];

  const passedKpi = dashboardKpis.filter((k) => k.pass).length;
  function pulseFor(code: string): string {
    if (code === "B") return `覆盖率 ${fmtPct(cov)} · ${zoneLabel}`;
    if (code === "A") {
      return a2Overview
        ? `A2 待确认 ${pendingA2Operations.length} · 今日审计 ${a2Overview.stats.todayAuditEvents}`
        : a2Error
          ? "A2 审计同步失败"
          : "A2 审计同步中";
    }
    if (code === "D") return `待确认提现 ${inReview} · 积压 ${fmtUsdCompact(backlogUsd)}`;
    if (code === "J") return KILL_GATES.length > 0 ? `Kill ${killOnline}/${KILL_GATES.length} 在线${killTripped ? ` · ${killTripped} 熔断` : ""}${killMissing ? ` · ${killMissing} 未配置` : ""} · Geo 策略待读取` : "Kill 状态同步中 · Geo 策略待读取";
    if (code === "K") return `风险命中 ${fmtNum(flaggedAccounts)} · 规则 ${riskRadar.rules.length}`;
    if (code === "L") {
      if (dashboardKpis.length) return `${dashboardKpis.length} KPI · 达标 ${passedKpi} / 未达 ${dashboardKpis.length - passedKpi}`;
      return lBiError ? "L1 KPI 同步失败" : "L1 KPI 同步中";
    }
    if (code === "H") {
      // H 域脉搏 = 节奏单源(运营在 H1 可配),与 B4/H1/L1/L4 同源。
      const rs = rhythm.h1;
      return `${rs.currentPhase} ${rs.currentPhaseName}期 · 第 ${rs.currentMonth}/${rs.totalMonths} 月`;
    }
    const domain = CONSOLE_NAV.find((item) => item.code === code);
    const flagship = domain?.l2.find((item) => item.status === "flagship") ?? domain?.l2[0];
    return flagship ? `${flagship.id} ${flagship.name} · ${domain?.l2.length ?? 0} 模块` : "后端接口以各域页面为准";
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
            欢迎,{operator || "当前操作者"}<AutoGloss> · 资金兑付安全和转化健康一屏看全 · 以服务端数据为准。</AutoGloss>
          </p>
        </div>
        <div className="flex items-center gap-2.5">
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
      <BDomainWarnings warnings={bDomain.warnings} />

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
        <RiskRadar alerts={liveAlerts} bankRunRatio={bankRunRatio} flaggedAccounts={flaggedAccounts} killGates={KILL_GATES} />
      </div>

      {/* ③ 实时运营脉搏 */}
      <SecLabel title="实时运营脉搏" modules="D · K · 较上窗口" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/overview/liquidity" prefetch={false} className="block transition-transform hover:-translate-y-0.5">
          <KpiStatCard
            label="24h 净流"
            value={`${netFlowPositive ? "+" : "−"}${fmtUsdCompact(Math.abs(LEDGER.netFlow24hUsd))}`}
            accent={netFlowPositive ? "var(--v5-success)" : "var(--v5-warning)"}
            sublabel="较上窗口"
            hint="近 24 小时资金净流,按流入减流出口径。"
            delta={{ dir: netFlowPositive ? "up" : "down", text: netFlowDeltaText, good: netFlowPositive }}
          />
        </Link>
        <Link href="/finance/withdrawals" prefetch={false} className="block transition-transform hover:-translate-y-0.5">
          <KpiStatCard label="提现积压" value={`${fmtNum(inReview)} 单`} accent="var(--admin-domain-k)" sublabel={fmtUsdCompact(backlogUsd)} hint="进入确认、尚未放行的提现单数与金额(存量 + 观测窗实时)。" />
        </Link>
        <Link href="/risk/scoring" prefetch={false} className="block transition-transform hover:-translate-y-0.5">
          <KpiStatCard label="风险评分均值" value={`${LEDGER.avgRiskScore}`} accent="var(--admin-domain-k)" sublabel="/ 100 · ≥70 高危" hint="在审提现的风险评分均值。" delta={{ dir: riskChg > 0 ? "up" : "down", text: `${riskChg > 0 ? "+" : ""}${riskChg}`, good: riskChg <= 0 }} />
        </Link>
      </div>

      {/* ④ 待处理 · 操作确认 */}
      <SecLabel title="待处理 · 操作确认" modules="跨域确认 · 按角色" />
      <SensitiveOperationFeed items={sensitiveOperationItems} />

      {/* ⑤ 转化漏斗 */}
      <SecLabel title="转化漏斗" modules="B3 · A4 派生" />
      <FunnelBars stages={funnel.stages} />

      {/* ⑥ 八项 KPI 验收墙 */}
      <div className="mt-7">
        {dashboardKpis.length ? (
          <KpiWall kpis={dashboardKpis} />
        ) : (
          <DashboardDataState title="L1 KPI 验收墙" loading={lBiLoading} error={lBiError} />
        )}
      </div>

      {/* ⑦ 域速览 */}
      <div className="mt-7">
        <div className="mb-2.5 flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--v5-ink-4)" }}>域速览</p>
          <span className="text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}>{domains.length} 域 · 可见 {visibleModuleCount} 模块</span>
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
