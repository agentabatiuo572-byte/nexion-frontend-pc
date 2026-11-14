"use client";

/**
 * F4 奖励池、名额与排行榜（改版）。数据源为后端 /api/admin/teams/leadership-pool 和 ambassador-policy，由 f-view 读取。
 * 这页管三件事：团队激励池、购机名额与大使申请、排行榜。首屏三张卡回答「现在有什么在等我」，也是三块内容的页签。
 * 只排版：读取、提交、权限判断、结果未知的保存和恢复都沿用 f-view 和原组件的写法。
 */
import { useState, type KeyboardEvent } from "react";
import { AlertTriangle, ArrowRight, ListChecks, RefreshCw } from "lucide-react";
import { BlockState, Button, Conclusion, PageHeader, RatioBar, Stat, StatBand, StatusTag, useTabIds } from "@/app/components/rd";
import { nextTabValue } from "@/app/components/kit/tab-group-keyboard";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { F4AmbassadorApplication } from "@/lib/admin/f1-client";
import { validateF4SettlementConfig } from "@/lib/admin/f4-settlement-config";
import { F4AmbassadorMaterials, materialReviewAttempts } from "./f4-ambassador-materials";
import { applicationStage } from "./f4-quota";
import { F4Pool } from "./f4-pool";
import { F4Quota } from "./f4-quota";
import { F4Leaderboard, leaderboardState } from "./f4-leaderboard";
import { F4RecoveryNotice, count, unknownTag, usdt, stamp, type F4RecoveryRow } from "./f4-shared";
import type { FViewCtx } from "./types";

type Section = "pool" | "quota" | "board";
const SECTIONS: readonly Section[] = ["pool", "quota", "board"];

export function F4Ops({ ctx, onOpenCommissions }: { ctx: FViewCtx; onOpenCommissions: () => void }) {
  const [section, setSection] = useState<Section>("pool");
  const [materialApplication, setMaterialApplication] = useState<F4AmbassadorApplication | null>(null);
  const actorId = useAdminAuth((state) => state.session?.adminId);
  const ids = useTabIds();
  const data = ctx.f4Overview;
  const canWrite = ctx.can("network_f4_write");
  const canFund = ctx.can("network_f4_pool_fund");
  const canControl = ctx.can("network_f4_leaderboard_control");
  const canApprove = ctx.can("network_f4_ambassador_approve");
  const canReview = ctx.can("network_f4_ambassador_material_review") || ctx.can("network_f4_ambassador_finance_review");
  const readOnly = !canWrite && !canFund && !canControl && !canApprove && !canReview && !ctx.canSubmitTeamApproval("F4");

  const header = (
    <PageHeader pageId="F4" title="奖励池、名额与排行榜" summary="看团队激励池怎么分、购机名额和大使申请、排行榜。"
      meta="打开时读取 · 不自动刷新"
      readOnly={readOnly ? "当前账号只能查看这页" : undefined}
      actions={<>
        <Button icon={<RefreshCw size={14} aria-hidden />} loading={ctx.f4Loading} loadingText="读取中…" onClick={() => void ctx.refreshF4()}>刷新</Button>
        <Button icon={<ArrowRight size={14} aria-hidden />} onClick={onOpenCommissions}>奖励记录核对</Button>
      </>} />
  );

  if (!data) {
    return <div className="f4-page">
      {header}
      {ctx.f4Loading ? <>
        <Conclusion state="unknown">正在读取奖励池、名额和排行榜…</Conclusion>
        <BlockState state="loading" title="正在读取团队激励池、名额、大使申请和排行榜…" />
      </> : ctx.f4Error ? <>
        <Conclusion state="unknown" hint="点「重新读取」再试；读到之前不显示旧数字，也不能操作。">读不到这页的数据，暂时无法判断</Conclusion>
        <BlockState state="error" title="团队激励池、名额和排行榜读取失败" detail={ctx.f4Error} onRetry={() => void ctx.refreshF4()} retryLabel="重新读取" />
      </> : <>
        <Conclusion state="unknown">还没有读到数据</Conclusion>
        <BlockState state="empty" title="暂无团队激励池数据" />
      </>}
    </div>;
  }

  // 首屏三张卡要回答的事：等结算的池、等核验或等批准的大使申请、暂停着的榜单。
  const settlement = validateF4SettlementConfig({
    status: data.settlementConfigStatus,
    unavailableKey: data.settlementConfigUnavailableKey,
    configVersion: data.configVersion,
    ratio: data.configValues["F.pool.ratio"],
    monthlyCap: data.configValues["F.pool.monthlyCap"],
    unlockVRank: data.configValues["F.pool.unlockVRank"],
    settleCron: data.configValues["F.pool.settleCron"],
  });
  const settled = data.weeklyInjectedUsd > 0;
  const stages = data.ambassadorApplications.map(applicationStage);
  const waitBusiness = stages.filter((stage) => stage.key === "business").length;
  const waitFinance = stages.filter((stage) => stage.key === "finance").length;
  const waitApproval = stages.filter((stage) => stage.key === "approve").length;
  const board = leaderboardState(data);
  const week = data.leaderboardPeriods?.week;
  const tightQuota = data.quotaRows.filter((row) => row.tight).length;

  const todos = [
    !settlement.ready && "团队激励池设置不完整，提前结算已暂停",
    data.ambassadorPendingCount > 0 && `${count(data.ambassadorPendingCount)} 份大使申请待处理`,
    board.paused && "排行榜已暂停",
    tightQuota > 0 && `${tightQuota} 个商品本月名额已用到 85% 以上`,
  ].filter((item): item is string => typeof item === "string");

  const recoveryRows: F4RecoveryRow[] = actorId === undefined ? [] : materialReviewAttempts(actorId).map((record) => {
    const application = data.ambassadorApplications.find((item) => item.id === record.applicationId);
    return {
      key: record.commandKey,
      name: `${record.input.stage === "BUSINESS" ? "业务" : "财务"}核验 · 申请 #${record.applicationId}`,
      change: `材料第 ${record.input.expectedMaterialRevision} 版 · ${record.input.decision === "PASSED" ? "通过" : "需补材料"}`,
      submittedAt: record.createdAt,
      tag: unknownTag("direct"),
      actions: application
        ? <Button size="sm" onClick={() => { setSection("quota"); setMaterialApplication(application); }}>打开申请</Button>
        : <span className="f4-muted">申请不在最近 30 份里</span>,
    };
  });

  const select = (next: Section) => setSection(next);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextTabValue(SECTIONS, section, event.key);
    if (next === null) return;
    event.preventDefault();
    select(next);
    document.getElementById(ids.tab(next))?.focus();
  };
  const tabProps = (value: Section) => ({
    id: ids.tab(value), role: "tab" as const, tabIndex: section === value ? 0 : -1, onKeyDown,
    "aria-selected": section === value, "aria-controls": ids.panelId(value),
    onOpen: () => select(value), selected: section === value, selectedText: "正在看",
  });

  const quotaTotal = data.quotaMonthlyStockTotal;
  const quotaUsed = data.quotaMonthlyStockUsed;

  return (
    <div className="f4-page">
      {header}
      {todos.length === 0
        ? <Conclusion state="ok">三块都在正常运行，没有等你处理的事</Conclusion>
        : <Conclusion state={settlement.ready ? "neutral" : "warn"} icon={settlement.ready ? ListChecks : AlertTriangle}
            hint={todos.length > 2 ? `另外：${todos.slice(2).join("；")}。` : "点下面的卡片进入对应的一块处理。"}>
            {todos.slice(0, 2).join("，")}
          </Conclusion>}
      <F4RecoveryNotice rows={recoveryRows} />

      <StatBand cards role="tablist" label="这页的三块内容">
        <Stat {...tabProps("pool")} openLabel="团队激励池"
          head={<span className="f4-card-head">团队激励池</span>}
          surface={settlement.ready ? undefined : "warn"}
          label={settled ? "本周已结算（实发）" : "本周池（估算）"}
          value={data.currentWeekPoolUsd === null ? "—" : usdt(data.currentWeekPoolUsd)} unit={data.currentWeekPoolUsd === null ? undefined : "USDT"}
          tone="role-1">
          <span className="f4-card-line">
            {settlement.ready
              ? <>下次自动结算 {stamp(data.nextSettlementAt)}</>
              : <StatusTag tone="warn">设置不完整，不能结算</StatusTag>}
          </span>
        </Stat>
        <Stat {...tabProps("quota")} openLabel="名额与大使"
          head={<span className="f4-card-head">名额与大使</span>}
          label="待处理的大使申请" value={count(data.ambassadorPendingCount)} unit="份" tone="role-3"
          sub={data.ambassadorPendingCount > 0 ? [waitBusiness && `业务核验 ${waitBusiness}`, waitFinance && `财务核验 ${waitFinance}`, waitApproval && `可发起批准 ${waitApproval}`].filter(Boolean).join(" · ") || undefined : undefined}>
          {quotaTotal > 0
            ? <span className="f4-card-meter">
              <RatioBar label="本月购机名额已用" value={Math.min(quotaUsed, quotaTotal)} total={quotaTotal} valueText={`已用 ${count(quotaUsed)} 台，共 ${count(quotaTotal)} 台`} tone="role-2" quiet />
              <span className="f4-card-line">名额剩余 {count(data.quotaMonthlyStockRemaining)} 台 · 共 {count(quotaTotal)} 台</span>
            </span>
            : <span className="f4-card-line">本月还没有设置购机名额</span>}
        </Stat>
        <Stat {...tabProps("board")} openLabel="排行榜"
          head={<span className="f4-card-head">排行榜</span>}
          surface={board.paused ? "warn" : undefined}
          label={board.paused ? "本周奖池（暂停时）" : "本周奖池"}
          value={board.available && week ? usdt(week.poolUsd) : "—"} unit={board.available && week ? "USDT" : undefined} tone="role-1">
          <span className="f4-card-line">
            {board.paused ? <StatusTag tone="warn">已暂停</StatusTag> : <StatusTag tone="ok">实时更新</StatusTag>}
            {board.available && week?.podium[0] ? <span>第 1 名 {week.podium[0].userId}</span> : <span className="f4-muted">{board.available ? "本周还没有上榜的人" : "名次暂不显示"}</span>}
          </span>
        </Stat>
      </StatBand>

      <div {...ids.panel(section)} className="f4-section">
        {section === "pool" && <F4Pool ctx={ctx} data={data} settlement={settlement} />}
        {section === "quota" && <F4Quota ctx={ctx} data={data} onOpenMaterials={setMaterialApplication} />}
        {section === "board" && <F4Leaderboard ctx={ctx} data={data} />}
      </div>
      {materialApplication && <F4AmbassadorMaterials application={materialApplication} ctx={ctx} onClose={() => setMaterialApplication(null)} />}
    </div>
  );
}
