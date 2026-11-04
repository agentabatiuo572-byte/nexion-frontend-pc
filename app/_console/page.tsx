"use client";

/**
 * 指挥台（首页 /）。先说现状，再给要处理的事和今日经营，其余收进 5 行带结论的折叠摘要。
 * 所有运营角色都能进，每块看自己的读权限，没有权限的块不出现、不发请求（重构说明 5.7）。
 * 每块各自加载、各自报错，一块失败不挡别的块（5.6）。这页不提交任何东西，要处理就跳业务页。
 * 导出资金数据等 BE-21（权限、理由、记录）一起上，不继续无记录下载（决定 7）。
 */
import "./command-center/command-center.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ListChecks, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button, Conclusion, InlineRetry, PageHeader, RdPage } from "@/app/components/rd";
import { BDomainWarnings } from "@/app/components/dashboard/b-domain-state";
import { fetchA2Overview, type A2OperationRow } from "@/lib/admin/a2-client";
import { a2ActionText } from "@/lib/admin/operator-copy";
import { b0Blocks } from "@/lib/admin/b0-access";
import { fetchB0Devices, fetchB0NewUsers, fetchB0Sales } from "@/lib/admin/b0-client";
import { useBDomainDashboard } from "@/lib/admin/b-client";
import { fetchB2LiquidityHistory } from "@/lib/admin/b-restoration-client";
import { fetchB2Reserve } from "@/lib/admin/b2-client";
import { businessClock } from "@/lib/admin/business-time";
import { requiredReadAuthority } from "@/lib/admin/cross-domain-authority";
import { fetchD2Withdrawals } from "@/lib/admin/d-client";
import { supportClient } from "@/lib/admin/m-support-client";
import { opsAlertHref, refreshJ1DutyAlerts, useJ1DutyAlerts } from "@/lib/admin/ops-dashboard-client";
import { fmtNum } from "@/lib/format";
import { canAccessResolvedPath, resolveVisibleDomains } from "@/lib/nav/console-nav";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { FlowFold, FundFold, FunnelFold, KpiFold, pressureLevel, RiskFold, useFoldChoices } from "./command-center/folds";
import { PendingPanel, type PendingFailure, type PendingRow } from "./command-center/pending";
import { fundLevel, statusSentence } from "./command-center/status";
import { TodayPanel } from "./command-center/today";
import { useBlock, type Block } from "./command-center/use-block";

const RESERVE_PAGE = "/overview/dual-ledger";

const countReviewPending = async () => (await fetchD2Withdrawals({ status: "REVIEW_PENDING", pageNum: 1, pageSize: 1 })).total;
const countOrphaned = async () => (await fetchD2Withdrawals({ status: "TX_ORPHANED", pageNum: 1, pageSize: 1 })).total;
const countSupportTodo = async () => (await supportClient.customers({ pageNum: 1, pageSize: 1, filter: "TODO" })).total;

/** 接口给的角色，认不出写「其他」，不丢这一条（B0-H06）。 */
function approvalOwner(row: A2OperationRow): PendingRow["owner"] {
  const gate = `${row.roleGate} ${row.operatorRole}`.toLowerCase();
  if (gate.includes("财务") || gate.includes("finance")) return "财务";
  if (gate.includes("风控") || gate.includes("risk")) return "风控";
  if (gate.includes("内容") || gate.includes("content")) return "内容";
  if (gate.includes("增长") || gate.includes("growth")) return "增长";
  if (gate.includes("客服") || gate.includes("support")) return "客服";
  if (gate.includes("审计") || gate.includes("auditor")) return "审计";
  if (row.type === "fund") return "财务";
  if (row.type === "sos") return "风控";
  return "其他";
}

function approvalDetail(row: A2OperationRow) {
  const change = row.before !== "—" || row.after !== "—" ? `${row.before} → ${row.after}` : row.reason;
  return [a2ActionText(row.action), row.obj, change].filter((part) => part && part !== "—").join(" · ");
}

export default function CommandCenter() {
  const session = useAdminAuth((state) => state.session);
  const blocks = useMemo(() => b0Blocks(session?.authorities ?? []), [session?.authorities]);
  const domains = useMemo(() => (session ? resolveVisibleDomains(session) : []), [session]);
  /** 目标页可达并有读权限才给入口（X03、ST-58）。 */
  const reach = useCallback((href: string) => {
    const path = href.split(/[?#]/, 1)[0];
    const read = requiredReadAuthority(path);
    return canAccessResolvedPath(domains, path) && (read === null || Boolean(session?.authorities.includes(read)));
  }, [domains, session?.authorities]);

  const [refreshKey, setRefreshKey] = useState(0);
  const bDomain = useBDomainDashboard(blocks.fund);
  const reserve = useBlock(fetchB2Reserve, blocks.coverDays, refreshKey);
  const flows = useBlock(fetchB2LiquidityHistory, blocks.netFlow, refreshKey);
  const sales = useBlock(fetchB0Sales, blocks.sales, refreshKey);
  const newUsers = useBlock(fetchB0NewUsers, blocks.newUsers, refreshKey);
  const devices = useBlock(fetchB0Devices, blocks.devices, refreshKey);
  const approvals = useBlock(fetchA2Overview, blocks.approvals && reach("/platform/audit"), refreshKey);
  const reviewPending = useBlock(countReviewPending, blocks.withdrawals && reach("/finance/withdrawals"), refreshKey);
  const orphaned = useBlock(countOrphaned, blocks.withdrawals && reach("/finance/withdrawals"), refreshKey);
  // 有 M 读权限但没有客服读取范围的账号，接口回 403，这一行不出现，不算读取失败。
  const canReadSupportTodo = blocks.support && Boolean(session?.supportReadModes?.length) && reach("/service/overview");
  const supportTodo = useBlock(countSupportTodo, canReadSupportTodo, refreshKey);
  const j1 = useJ1DutyAlerts(blocks.j1 && reach("/emergency/kill-switch"));

  // 客服待办和紧急开关告警每 30 秒更新（5.3）；紧急开关的轮询在 useJ1DutyAlerts 里。
  const reloadSupport = supportTodo.reload;
  useEffect(() => {
    if (!canReadSupportTodo) return undefined;
    const timer = window.setInterval(reloadSupport, 30_000);
    return () => window.clearInterval(timer);
  }, [canReadSupportTodo, reloadSupport]);

  const { ledger, liquidity, rhythm, riskRadar, warnings, alerts } = bDomain;
  // 刷新失败时不用旧的资金数据下结论（T05 第 4 条）。
  const fundReady = bDomain.hasData && !bDomain.error;
  const coverage = fundReady ? { ratio: ledger.coverageRatio, redline: ledger.redlinePct, healthy: ledger.healthyPct } : null;
  const water = reserve.data?.waterLevel ?? null;
  const level = fundLevel(coverage, water?.tier ?? null);
  const belowRedline = Boolean(coverage && coverage.ratio < coverage.redline);
  const belowHealthy = Boolean(coverage && coverage.ratio < coverage.healthy);
  const fundFailed = Boolean(bDomain.error) || Boolean(reserve.error);
  const withdrawGate = fundReady ? riskRadar.gates.find((gate) => gate.dom === "withdraw") : undefined;

  const rows: (PendingRow | PendingFailure)[] = [];
  if (fundReady && belowRedline && !alerts.coverageRedlineAcked && reach(RESERVE_PAGE)) {
    rows.push({ key: "coverage", title: "覆盖率告警待确认", sub: "跌破红线，还没人确认", owner: "财务", href: RESERVE_PAGE, tone: "danger" });
  }
  const backfill = j1.alerts.find((alert) => alert.id === "J1-AUTO-CONFIRM");
  if (j1.error) rows.push({ key: "j1", title: "紧急开关待补录读取失败", onRetry: () => void refreshJ1DutyAlerts() });
  else if (backfill) rows.push({ key: "j1", title: `紧急开关待补录 ${backfill.count ?? 0} 项`, sub: backfill.hint, owner: "风控", href: opsAlertHref(backfill), tone: backfill.level === "high" ? "danger" : undefined });
  const risks = fundReady ? riskRadar.feed.filter((item) => (item.sev === "p0" || item.sev === "p1") && reach(item.href)) : [];
  risks.forEach((item, index) => rows.push({ key: `risk-${index}`, title: item.t, sub: item.m, owner: "风控", href: item.href, tone: item.sev === "p0" ? "danger" : undefined }));
  if (orphaned.error) rows.push({ key: "orphaned", title: "打款异常读取失败", onRetry: orphaned.reload });
  else if (orphaned.data) rows.push({ key: "orphaned", title: `打款异常 ${orphaned.data} 单`, sub: "需要人工核对", owner: "财务", href: "/finance/withdrawals", tone: "warn" });
  if (approvals.error) rows.push({ key: "a2", title: "待审批操作读取失败", onRetry: approvals.reload });
  else if (approvals.data?.stats.pendingTickets) {
    const queue = approvals.data.operationQueue.filter((row) => row.status === "pending").sort((a, b) => a.ts.localeCompare(b.ts));
    rows.push({ key: "a2", title: `待审批操作 ${approvals.data.stats.pendingTickets} 条`, sub: queue[0] && approvalDetail(queue[0]), owner: queue[0] ? approvalOwner(queue[0]) : "其他", href: "/platform/audit" });
  }
  if (reviewPending.error) rows.push({ key: "review", title: "待审核提现读取失败", onRetry: reviewPending.reload });
  else if (reviewPending.data) rows.push({ key: "review", title: `待审核提现 ${reviewPending.data} 单`, owner: "财务", href: "/finance/withdrawals" });
  if (supportTodo.error) rows.push({ key: "support", title: "客服待跟进读取失败", onRetry: supportTodo.reload });
  else if (supportTodo.data) rows.push({ key: "support", title: `客服待跟进 ${supportTodo.data} 位`, owner: "客服", href: "/service/overview" });

  const pendingFailures = rows.filter((row) => "onRetry" in row).length;
  const pendingRows = rows.length - pendingFailures;
  const urgentRows = risks.filter((item) => item.sev === "p0").length + (!j1.error && backfill?.level === "high" ? 1 : 0);
  const firstLoad = (block: Block<unknown>) => block.loading && block.data === null;
  const pendingLoading = [approvals, reviewPending, orphaned, supportTodo].some(firstLoad);
  const hasPendingSource = blocks.fund || blocks.j1 || blocks.withdrawals || blocks.approvals || blocks.support;
  const showPending = hasPendingSource && (rows.length > 0 || pendingLoading);

  const firstScreenLoading = bDomain.loading || reserve.loading || flows.loading || sales.loading || newUsers.loading || devices.loading || pendingLoading;
  const statusLoading = (bDomain.loading && !bDomain.hasData) || pendingLoading || [reserve, flows, sales, newUsers, devices].some(firstLoad);
  const sentence = statusSentence({
    belowRedline,
    tier: water?.tier ?? null,
    urgentRows,
    fundFailed,
    withdrawClosed: Boolean(withdrawGate && !withdrawGate.on),
    withdrawUnset: Boolean(withdrawGate?.unset),
    belowHealthy,
    pendingRows,
    fundKnown: fundReady,
    failed: [
      ...(sales.error ? ["销售额"] : []),
      ...(newUsers.error ? ["新增用户"] : []),
      ...(flows.error ? ["资金净流入"] : []),
      ...(devices.error ? ["设备数据"] : []),
      ...(pendingFailures > 0 ? ["待处理"] : []),
    ],
    loading: statusLoading,
  });

  const [readAt, setReadAt] = useState<number | null>(null);
  useEffect(() => { if (!firstScreenLoading) setReadAt(Date.now()); }, [firstScreenLoading]);
  const clock = readAt === null ? null : businessClock(readAt);
  const refresh = () => {
    setRefreshKey((key) => key + 1);
    if (blocks.fund) void bDomain.reload();
    if (blocks.j1) void refreshJ1DutyAlerts();
  };

  const folds = useFoldChoices(session?.adminId);
  const pressure = pressureLevel(fundReady ? ledger : null, fundReady ? riskRadar : null);
  const riskAlert = (fundReady && riskRadar.gates.some((gate) => !gate.on)) || pressure.worst !== "ok" || Boolean(bDomain.error);
  const fundAlert = level !== "ok" || Boolean(bDomain.error);

  const foldsRef = useRef<HTMLDivElement>(null);
  const openFold = (fold: string, anchor: string) => {
    folds.setOpen(fold, true);
    window.setTimeout(() => foldsRef.current?.querySelector(`[data-fold="${anchor}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 0);
  };

  // 没有到期时后端给占位值 999，不能直接显示；有到期时天数可以比 999 大。
  const days = !water ? null : water.dailyAverageDueUsdt === 0 ? "未来 7 天没有到期" : `可覆盖 ${fmtNum(Math.floor(water.reserveCoverDays))} 天`;
  const fundWord = level === "danger" ? (belowRedline ? "跌破红线" : "危险") : level === "warn" ? "警戒" : "健康";
  const fundText = `资金安全：${fundWord}${days ? `，${days}` : ""}`;
  const advice = water && water.tier !== "NORMAL" && water.tier !== "WATCH" ? water.suggestedAction : "建议收紧提现和奖励等支出设置";
  const phase = rhythm.h1;
  const phaseText = phase.currentPhase ? `${phase.currentPhase} 阶段 · 第 ${phase.currentMonth}/${phase.totalMonths} 月` : "运营阶段未配置";

  const anyTodayBlock = blocks.sales || blocks.newUsers || blocks.netFlow || blocks.devices;
  const showFundLine = blocks.fund && !(fundReady && level !== "ok");

  return (
    <RdPage className="cc">
      <PageHeader
        pageId="B0"
        title="指挥台"
        summary="今天的状况和要处理的事"
        meta={(
          <span className="cc-meta">
            {fundReady && (reach("/overview/rhythm") ? <Link href="/overview/rhythm" prefetch={false}>{phaseText}</Link> : <span>{phaseText}</span>)}
            <span>{clock ? `${clock} 读取` : "正在读取…"}</span>
            <Button size="sm" variant="ghost" loading={firstScreenLoading} onClick={refresh}>刷新</Button>
          </span>
        )}
      />
      <BDomainWarnings warnings={warnings} />

      <Conclusion state={sentence.state} strong={sentence.strong} lead icon={sentence.state === "neutral" ? ListChecks : undefined} hint={sentence.hint}>{sentence.text}</Conclusion>

      {blocks.fund && fundReady && level !== "ok" && (
        <Conclusion
          state={level}
          icon={ShieldAlert}
          hint={advice}
          action={reach(RESERVE_PAGE) ? <Link className="rd-btn" data-variant="secondary" data-size="md" href={RESERVE_PAGE} prefetch={false}><span className="rd-btn-face">查看资金总览</span></Link> : undefined}
        >
          {fundText}
        </Conclusion>
      )}

      {(showPending || anyTodayBlock || showFundLine) && (
        <div className="cc-main" data-solo={showPending && (anyTodayBlock || showFundLine) ? undefined : ""}>
          {showPending && <PendingPanel rows={rows} failures={pendingFailures} loading={pendingLoading} />}
          {(anyTodayBlock || showFundLine) && (
            <div className="cc-side">
              {anyTodayBlock && (
                <TodayPanel
                  blocks={blocks}
                  sales={sales}
                  newUsers={newUsers}
                  flows={flows}
                  devices={devices}
                  clock={clock}
                  netFlow24h={fundReady ? ledger.netFlow24hUsd : null}
                  reach={reach}
                  onOpenFlows={() => openFold("flow", "flow")}
                />
              )}
              {showFundLine && (bDomain.error ? (
                <div className="cc-fundline" role="alert" data-tone="warn">
                  <ShieldAlert size={16} aria-hidden />
                  <span>资金数据读取失败 · <InlineRetry onRetry={() => void bDomain.reload()} /></span>
                </div>
              ) : reserve.error ? (
                <div className="cc-fundline" role="alert" data-tone="warn">
                  <ShieldAlert size={16} aria-hidden />
                  <span>{fundText} · 可覆盖天数读取失败 · <InlineRetry onRetry={reserve.reload} /></span>
                </div>
              ) : (
                <button type="button" className="cc-fundline" data-tone={fundReady ? "ok" : undefined} disabled={!fundReady} onClick={() => openFold("fund", "fund")}>
                  <ShieldCheck size={16} aria-hidden />
                  <span>{fundReady ? fundText : "正在读取资金安全…"}</span>
                  <ChevronRight className="cc-fundline-chevron" size={16} aria-hidden />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="cc-folds" ref={foldsRef}>
        {blocks.fund && (
          <div data-fold="fund">
            <FundFold
              ledger={fundReady ? ledger : null}
              liquidity={fundReady ? liquidity : null}
              error={bDomain.error}
              retrying={bDomain.loading}
              onRetry={() => void bDomain.reload()}
              alert={fundAlert}
              level={level}
              clock={clock}
              reach={reach}
              open={folds.isOpen("fund", fundAlert)}
              onOpenChange={(open) => folds.setOpen("fund", open)}
            />
          </div>
        )}
        {blocks.fund && (
          <div data-fold="risk">
            <RiskFold
              ledger={fundReady ? ledger : null}
              risk={fundReady ? riskRadar : null}
              error={bDomain.error}
              retrying={bDomain.loading}
              onRetry={() => void bDomain.reload()}
              alert={riskAlert}
              reach={reach}
              open={folds.isOpen("risk", riskAlert)}
              onOpenChange={(open) => folds.setOpen("risk", open)}
            />
          </div>
        )}
        {(blocks.netFlow || blocks.topup || blocks.redemption) && (
          <div data-fold="flow">
            <FlowFold
              blocks={blocks}
              history={flows.data}
              historyError={flows.error}
              historyRetrying={flows.loading}
              onRetryHistory={flows.reload}
              refreshKey={refreshKey}
              reach={reach}
              open={folds.isOpen("flow")}
              onOpenChange={(open) => folds.setOpen("flow", open)}
            />
          </div>
        )}
        {(blocks.funnel || blocks.totalUsers) && (
          <div data-fold="funnel">
            <FunnelFold blocks={blocks} refreshKey={refreshKey} reach={reach} open={folds.isOpen("funnel")} onOpenChange={(open) => folds.setOpen("funnel", open)} />
          </div>
        )}
        {blocks.kpi && (
          <div data-fold="kpi">
            <KpiFold refreshKey={refreshKey} reach={reach} open={folds.isOpen("kpi")} onOpenChange={(open) => folds.setOpen("kpi", open)} />
          </div>
        )}
      </div>
    </RdPage>
  );
}
