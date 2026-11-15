"use client";

/**
 * F4 奖励池、名额与排行榜（改版）。数据源为后端 /api/admin/teams/leadership-pool 和 ambassador-policy，由 f-view 读取。
 * 这页管三件事：团队激励池、购机名额与大使申请、排行榜。首屏三张卡回答「现在有什么在等我」，也是三块内容的页签。
 * 读取、提交和原请求恢复由 f-view 接线；保留已搭建的界面和确认内容。
 */
import { useState, type KeyboardEvent } from "react";
import { AlertTriangle, ArrowRight, CircleHelp, Clock3, Hourglass, ListChecks, RefreshCw } from "lucide-react";
import { BlockState, Button, Conclusion, PageHeader, RatioBar, Stat, StatBand, StatusTag, useTabIds } from "@/app/components/rd";
import { nextTabValue } from "@/app/components/kit/tab-group-keyboard";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { F4AmbassadorApplication } from "@/lib/admin/f1-client";
import { validateF4SettlementConfig } from "@/lib/admin/f4-settlement-config";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { displayAdminError } from "@/lib/admin/error-messages";
import { f4Confirmation } from "./f4-confirmations";
import { F4AmbassadorMaterials, materialReviewAttempts } from "./f4-ambassador-materials";
import { applicationStage } from "./f4-quota";
import { F4Pool } from "./f4-pool";
import { F4Quota } from "./f4-quota";
import { F4Leaderboard, leaderboardState } from "./f4-leaderboard";
import { FReleaseButton } from "./f-release";
import { F4RecoveryNotice, count, decimalText, settleCadenceNote, unknownTag, usdt, stamp, type F4RecoveryRow } from "./f4-shared";
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
  const recoveries: NonNullable<Parameters<typeof ctx.openActionConfirm>[0]["f4Recovery"]>[] = [
    ...ctx.f4Proposals.map(original => ({ kind: "proposal" as const, original })),
    ...ctx.f4PolicyWrites.map(original => ({ kind: "policy" as const, original })),
  ];
  const recoveryRows: F4RecoveryRow[] = recoveries.map(record => {
    const original = record.original;
    const spec = record.kind === "proposal" ? record.original.spec : undefined;
    const confirm = original.f4Snapshot ? f4Confirmation(ctx, original.f4Snapshot) : undefined;
    const snapshot = original.f4Snapshot;
    const form = confirm?.businessForm;
    const amount = (key: string, value: string) => snapshot?.action === "F.pool.periodPrize" || key === "defaultBudgetUsdt" || /\.(min|max)$/.test(key) ? `${decimalText(value)} USDT` : value;
    const change = form?.kind === "multi-field" && snapshot?.businessValue
      ? form.fields.filter(field => snapshot.businessValue![field.key] !== field.current).map(field => `${field.label} ${amount(field.key, field.current ?? "")} → ${amount(field.key, snapshot.businessValue![field.key])}`).join("；")
      : confirm?.edit ? `${confirm.edit.current ?? "—"} → ${snapshot?.value ?? spec?.after ?? "—"}`
        : confirm?.statedBrief?.impact ?? (spec ? `${spec.before} → ${spec.after}` : "—");
    return {
      key: original.commandKey,
      name: confirm?.name ?? spec?.action ?? "调整区域大使申请规则",
      change,
      submittedAt: original.createdAt,
      pending: record.kind === "proposal" && record.original.ticket?.status === "pending",
      tag: record.kind === "proposal" && record.original.ticket?.status === "pending" ? <StatusTag tone="warn" icon={Clock3} explain="在「操作记录与审批」等批准；批准前不生效。">待审批</StatusTag>
        : record.kind === "proposal" && record.original.received ? <StatusTag tone="warn" icon={CircleHelp} explain="原申请建过单，批没批准还没查到。继续查询原结果，不要重新提交。">已建单，未查到</StatusTag>
          : isRetryExpired(original) ? <StatusTag tone="neutral" icon={Hourglass} explain={record.kind === "proposal"
            ? "原请求超过 24 小时，不能再重试，只能查询原审批单。查询明确没有这张单时，可以解除待确认。"
            : "原请求超过 24 小时，不能再重试。查询只读回现在的规则，证明不了原操作有没有执行。"}>已过期</StatusTag>
            : unknownTag(record.kind === "proposal" ? "approval" : "direct"),
      actions: <>
        <Button size="sm" onClick={() => {
          if (confirm && original.f4Snapshot) {
            ctx.openActionConfirm({ ...confirm, edit: confirm.edit ? { ...confirm.edit, initialValue: original.f4Snapshot.value } : undefined, f4Recovery: record });
          } else void ctx.recoverF4(record, "query").catch(error => ctx.toast(displayAdminError(error)));
        }}>查询原结果</Button>
        {record.kind === "proposal" && isRetryExpired(record.original) && record.original.absent && !record.original.ticket && !record.original.received
          && <FReleaseButton label={confirm?.name ?? spec?.action ?? "原申请"} toast={ctx.toast} onRelease={() => ctx.recoverF4(record, "release")} />}
      </>,
    };
  });
  if (actorId !== undefined) recoveryRows.push(...materialReviewAttempts(actorId).map((record) => {
    const application = record.application ?? data?.ambassadorApplications.find((item) => item.id === record.applicationId);
    return {
      key: record.commandKey,
      name: `${record.input.stage === "BUSINESS" ? "业务" : "财务"}核验 · 申请 #${record.applicationId}`,
      change: `材料第 ${record.input.expectedMaterialRevision} 版 · ${record.input.decision === "PASSED" ? "通过" : "需补材料"}`,
      submittedAt: record.createdAt,
      tag: isRetryExpired(record) ? <StatusTag tone="neutral" icon={Hourglass} explain="原请求超过 24 小时，只能查询，不能再重试。">已过期</StatusTag> : unknownTag("direct"),
      actions: application
        ? <Button size="sm" onClick={() => { setSection("quota"); setMaterialApplication(application); }}>打开申请</Button>
        : <span className="f4-muted">申请不在最近 30 份里</span>,
    };
  }));
  const recoveryNotice = <F4RecoveryNotice rows={recoveryRows} />;
  const materialDrawer = materialApplication && <F4AmbassadorMaterials application={materialApplication} ctx={ctx} onClose={() => setMaterialApplication(null)} />;

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
        {recoveryNotice}
        <BlockState state="loading" title="正在读取团队激励池、名额、大使申请和排行榜…" />
      </> : ctx.f4Error ? <>
        <Conclusion state="unknown" hint="点「重新读取」再试；读到之前不显示旧数字，也不能发起新修改。">读不到这页的数据，暂时无法判断</Conclusion>
        {recoveryNotice}
        <BlockState state="error" title="团队激励池、名额和排行榜读取失败" detail={ctx.f4Error} onRetry={() => void ctx.refreshF4()} retryLabel="重新读取" />
      </> : <>
        <Conclusion state="unknown">还没有读到数据</Conclusion>
        {recoveryNotice}
        <BlockState state="empty" title="暂无团队激励池数据" />
      </>}
      {materialDrawer}
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

  const cadence = settlement.ready ? settleCadenceNote(data.configValues["F.pool.settleCron"] ?? "") : null;
  const cadenceWarn = cadence?.tone === "warn" ? cadence : null;
  const todos = [
    !settlement.ready && "团队激励池设置不完整，提前结算已暂停",
    cadenceWarn?.short,
    data.ambassadorPendingCount > 0 && `${count(data.ambassadorPendingCount)} 份大使申请待处理`,
    board.paused && "排行榜已暂停",
    tightQuota > 0 && `${tightQuota} 个商品本月名额已用到 85% 以上`,
  ].filter((item): item is string => typeof item === "string");

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
        ? <Conclusion state="ok" hint={cadence ? `${cadence.short}。` : undefined}>这页没有发现要处理的事</Conclusion>
        : <Conclusion state={settlement.ready && !cadenceWarn ? "neutral" : "warn"} icon={settlement.ready && !cadenceWarn ? ListChecks : AlertTriangle}
            hint={todos.length > 2 ? `另外：${todos.slice(2).join("；")}。` : "点下面的卡片进入对应的一块处理。"}>
            {todos.slice(0, 2).join("，")}
          </Conclusion>}
      {recoveryNotice}

      {/* 外面包 .rd-tabs：三张卡就是页签，版面量尺按 .rd-tabs 里的页签逐个切换去量。 */}
      <div className="rd-tabs f4-section-cards">
      <StatBand cards role="tablist" label="这页的三块内容">
        <Stat {...tabProps("pool")} openLabel="团队激励池"
          head={<span className="f4-card-head">团队激励池</span>}
          surface={settlement.ready ? undefined : "warn"}
          label={settled ? "本周已结算（实发）" : "本周池（估算）"}
          value={data.currentWeekPoolUsd === null ? "—" : usdt(data.currentWeekPoolAmount ?? data.currentWeekPoolUsd)} unit={data.currentWeekPoolUsd === null ? undefined : "USDT"}
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
          sub={data.ambassadorPendingCount > 0 ? [waitBusiness && `业务核验 ${waitBusiness}`, waitFinance && `财务核验 ${waitFinance}`, waitApproval && `核验已通过 ${waitApproval}`].filter(Boolean).join(" · ") || undefined : undefined}>
          {quotaTotal > 0
            ? <span className="f4-card-meter">
              <RatioBar label="本月购机名额已用" value={Math.min(quotaUsed, quotaTotal)} total={quotaTotal} valueText={`已用 ${count(quotaUsed)} 台，共 ${count(quotaTotal)} 台`} tone="role-2" quiet />
              <span className="f4-card-line">名额剩余 {count(data.quotaMonthlyStockRemaining)} 台 · 共 {count(quotaTotal)} 台</span>
            </span>
            : <span className="f4-card-line">本月购机名额总数为 0</span>}
        </Stat>
        <Stat {...tabProps("board")} openLabel="排行榜"
          head={<span className="f4-card-head">排行榜</span>}
          surface={board.paused ? "warn" : undefined}
          label={board.paused ? "本周奖池（暂停时）" : "本周奖池"}
          value={board.available && week ? usdt(week.poolUsdText ?? week.poolUsd) : "—"} unit={board.available && week ? "USDT" : undefined} tone="role-1">
          <span className="f4-card-line">
            {board.paused ? <StatusTag tone="warn">已暂停</StatusTag> : <StatusTag tone="ok">实时更新</StatusTag>}
            {board.available && week?.podium[0] ? <span>第 1 名 {week.podium[0].userId}</span> : <span className="f4-muted">{board.available ? "本周还没有上榜的人" : "名次暂不显示"}</span>}
          </span>
        </Stat>
      </StatBand>
      </div>

      <div {...ids.panel(section)} className="f4-section">
        {section === "pool" && <F4Pool ctx={ctx} data={data} settlement={settlement} />}
        {section === "quota" && <F4Quota ctx={ctx} data={data} onOpenMaterials={setMaterialApplication} />}
        {section === "board" && <F4Leaderboard ctx={ctx} data={data} />}
      </div>
      {materialDrawer}
    </div>
  );
}
