"use client";

/**
 * F4 奖励池、名额与排行榜（改版）。数据源为后端 /api/admin/teams/leadership-pool 和 ambassador-policy，由 f-view 读取。
 * 这页管三件事：团队激励池、购机名额与大使申请、排行榜。首屏三张卡回答「现在有什么在等我」，也是三块内容的页签。
 * 读取、提交和原请求恢复由 f-view 接线；保留已搭建的界面和确认内容。
 */
import { F4QuotaCreate } from "./f4-quota-create";
import { FReleaseButton } from "./f-release";
import { canRetryF4Proposal, f4ProposalAuthority } from "@/lib/admin/f4-approval";
import { canRetryF4Policy } from "@/lib/admin/f4-policy-write";
import { rebaseFValues, useFReconfirmations } from "@/lib/admin/f-reconfirmation";
import { compareDecimal } from "@/lib/admin/f1-rank-benefit";
import type { FDomainAttempt } from "@/lib/admin/f2-approval";
import { useEffect, useState, type KeyboardEvent } from "react";
import { AlertTriangle, ArrowRight, CircleHelp, Clock3, Hourglass, ListChecks, RefreshCw } from "lucide-react";
import { BlockState, Button, Conclusion, PageHeader, RatioBar, Stat, StatBand, StatusTag, useTabIds } from "@/app/components/rd";
import { nextTabValue } from "@/app/components/kit/tab-group-keyboard";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { businessClock, businessZone } from "@/lib/admin/business-time";
import { fetchF4AmbassadorMaterials, type F4AmbassadorApplication } from "@/lib/admin/f1-client";
import { validateF4SettlementConfig } from "@/lib/admin/f4-settlement-config";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { f4Confirmation } from "./f4-confirmations";
import { F4AmbassadorMaterials, materialReviewAttempts } from "./f4-ambassador-materials";
import { applicationStage } from "./f4-quota";
import { F4Pool } from "./f4-pool";
import { F4Quota } from "./f4-quota";
import { F4Leaderboard, leaderboardState } from "./f4-leaderboard";
import { F4RecoveryNotice, count, decimalText, settleCadenceNote, unknownTag, usdt, stamp, type F4RecoveryRow, moneyText } from "./f4-shared";
import type { FViewCtx } from "./types";
import type { ProposeSpec } from "@/lib/admin/propose-or-execute";

type Section = "pool" | "quota" | "board";
const SECTIONS: readonly Section[] = ["pool", "quota", "board"];

/** 改动列的值补上单位（比例 %、金额 USDT），只给纯数字补，读到的已带单位或「未配置」原样写。 */
function withUnit(key: string | undefined, value: string) {
  const unit = key === "F.pool.ratio" ? "%" : key === "F.pool.monthlyCap" || key === "F.leaderboard.poolUsd" ? " USDT" : "";
  return unit && /^-?\d+(?:\.\d+)?$/.test(value.trim()) ? `${unit === "%" ? value.trim() : moneyText(value)}${unit}` : value;
}

/**
 * 没有确认快照的旧申请：原记录存的是「动作 · 配置键」和「键=值」。显示时换成本页确认框里这一项的名字（nameOf），
 * 配置键不上屏；记录里存的值不改。整批改动按「名字 原值 → 新值」逐项写。
 */
function legacyF4(spec: ProposeSpec, nameOf: (key: string) => string | undefined) {
  const keys = spec.obj.split(",");
  const names = keys.map(nameOf);
  if (keys.length === 1) return { name: names[0] ?? spec.action.replace(/ · F\.[\w.]+$/, ""), change: `${withUnit(keys[0], spec.before)} → ${withUnit(keys[0], spec.after)}` };
  const items = names.map((name) => name?.replace(/^调整/, ""));
  const pairs = (text: string) => new Map(text.split(" / ").flatMap((part) => { const m = /^(F\.[\w.]+)=(.*)$/.exec(part.trim()); return m ? [[m[1], m[2]] as const] : []; }));
  const before = pairs(spec.before), after = pairs(spec.after);
  return {
    name: items.every(Boolean) ? `调整${items.join("、")}` : `调整 ${keys.length} 项设置`,
    change: keys.map((key, index) => `${items[index] ?? "其他设置"} ${withUnit(key, before.get(key) ?? "—")} → ${withUnit(key, after.get(key) ?? "—")}`).join("；"),
  };
}

export function F4Ops({ ctx, onOpenCommissions }: { ctx: FViewCtx; onOpenCommissions: () => void }) {
  const [section, setSection] = useState<Section>("pool");
  const [quotaOriginal, setQuotaOriginal] = useState<FDomainAttempt>();
  const [quotaDraft, setQuotaDraft] = useState<FDomainAttempt>();
  const proposalDrafts = useFReconfirmations("F4");
  const policyDrafts = useFReconfirmations("f4-policy");
  const materialDrafts = useFReconfirmations("f4-material");
  const [materialApplication, setMaterialApplication] = useState<F4AmbassadorApplication | null>(null);
  const actorId = useAdminAuth((state) => state.session?.adminId);
  const ids = useTabIds();
  const data = ctx.f4Overview;
  // 页头写这份数据是几点读到的：每读到一份新的概览记一次时间，页面不会自己刷新。
  const [readAt, setReadAt] = useState<number | null>(null);
  useEffect(() => { if (data) setReadAt(Date.now()); }, [data]);
  const canWrite = ctx.can("network_f4_write");
  const canFund = ctx.can("network_f4_pool_fund");
  const canControl = ctx.can("network_f4_leaderboard_control");
  const canApprove = ctx.can("network_f4_ambassador_approve");
  const canReview = ctx.can("network_f4_ambassador_material_review") || ctx.can("network_f4_ambassador_finance_review");
  const readOnly = !canWrite && !canFund && !canControl && !canApprove && !canReview && !ctx.canSubmitTeamApproval("F4");
  // 旧申请的名字取本页确认框的标题（页面打开调整框时也这样取）；本页没有这一项的确认框时不猜。
  const legacyName = (key: string) => {
    if (!data) return undefined;
    try { return f4Confirmation(ctx, { action: key, overview: data, policy: ctx.f4AmbassadorPolicy }).name; } catch { return undefined; }
  };
  const recoveries: NonNullable<Parameters<typeof ctx.openActionConfirm>[0]["f4Recovery"]>[] = [
    ...ctx.f4Proposals.map(original => ({ kind: "proposal" as const, original })),
    ...ctx.f4PolicyWrites.map(original => ({ kind: "policy" as const, original })),
  ];
  const recoveryRows: F4RecoveryRow[] = recoveries.map(record => {
    const original = record.original;
    const spec = record.kind === "proposal" ? record.original.spec : undefined;
    const quota = spec?.command.op === "f4_quota_tier_create";
    const confirm = original.f4Snapshot && !quota ? f4Confirmation(ctx, original.f4Snapshot) : undefined;
    const retryable = record.kind === "proposal" ? canRetryF4Proposal(record.original) : canRetryF4Policy(record.original);
    const legacy = spec && legacyF4(spec, legacyName);
    const snapshot = original.f4Snapshot;
    const form = confirm?.businessForm;
    const amount = (key: string, value: string) => snapshot?.action === "F.pool.periodPrize" || key === "defaultBudgetUsdt" || /\.(min|max)$/.test(key) ? `${moneyText(value)} USDT` : value;
    const change = form?.kind === "multi-field" && snapshot?.businessValue
      ? form.fields.filter(field => snapshot.businessValue![field.key] !== field.current).map(field => `${field.label} ${amount(field.key, field.current ?? "")} → ${amount(field.key, snapshot.businessValue![field.key])}`).join("；")
      : confirm?.edit ? `${withUnit(confirm.paramKey, confirm.edit.current ?? "—")} → ${withUnit(confirm.paramKey, snapshot?.value ?? spec?.after ?? "—")}`
        : confirm?.statedBrief?.impact ?? legacy?.change ?? "—";
    return {
      key: original.commandKey,
      // 过期的原记录把原因常显在这一行（OP-126，和 I3 的恢复行一样），对应入口按禁用写同一句。
      // 查询结果和过期原因都常显：查询报错时不盖掉过期原因，同一句不重复（OP-126）。
      line: (() => {
        const note = ctx.f4QueryNotes[original.commandKey];
        const expired = isRetryExpired(original) ? { tone: "warn" as const, text: RETRY_EXPIRED_TEXT } : undefined;
        return note && expired && !note.text.includes(expired.text) ? { tone: note.tone, text: `${note.text} ${expired.text}` } : note ?? expired;
      })(),
      name: quota ? "新建购机名额档位" : confirm?.name ?? legacy?.name ?? "调整区域大使申请规则",
      change,
      submittedAt: original.createdAt,
      pending: record.kind === "proposal" && record.original.ticket?.status === "pending",
      expired: isRetryExpired(original),
      tag: record.kind === "proposal" && record.original.ticket?.status === "pending" ? <StatusTag tone="warn" icon={Clock3} explain="在「操作记录与审批」等批准；批准前不生效。">待审批</StatusTag>
        : record.kind === "proposal" && record.original.received ? <StatusTag tone="warn" icon={CircleHelp} explain="原申请建过单，批没批准还没查到。继续查询原结果，不要重新提交。">已建单，未查到</StatusTag>
          : isRetryExpired(original) ? <StatusTag tone="neutral" icon={Hourglass}>已过期</StatusTag>
            : unknownTag(record.kind === "proposal" ? "approval" : "direct"),
      actions: <>
        <Button size="sm" onClick={() => {
          if (quota && record.kind === "proposal" && record.original.request) setQuotaOriginal(record.original);
          else if (confirm && original.f4Snapshot) {
            ctx.openActionConfirm({ ...confirm, edit: confirm.edit ? { ...confirm.edit, initialValue: original.f4Snapshot.value } : undefined, f4Recovery: record });
          } else void ctx.recoverF4(record, "query").catch(() => undefined); // 查询失败的原因已写在这一行
        }}>查询原结果</Button>
        {retryable && (quota || confirm) && <Button size="sm" onClick={() => {
          if (quota && record.kind === "proposal") setQuotaOriginal(record.original);
          else if (confirm && original.f4Snapshot) ctx.openActionConfirm({ ...confirm,
            edit: confirm.edit ? { ...confirm.edit, initialValue: original.f4Snapshot.value } : undefined, f4Recovery: record });
        }}>按原请求重试</Button>}
        {original.replayRejection && <FReleaseButton label={confirm?.name ?? legacy?.name ?? "原操作"} toast={ctx.toast} onRelease={() => ctx.recoverF4(record, "release")} />}
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
      expired: isRetryExpired(record),
      line: isRetryExpired(record) ? { tone: "warn" as const, text: RETRY_EXPIRED_TEXT } : undefined,
      tag: isRetryExpired(record) ? <StatusTag tone="neutral" icon={Hourglass}>已过期</StatusTag> : unknownTag("direct"),
      actions: application
        ? <Button size="sm" onClick={() => { setSection("quota"); setMaterialApplication(application); }}>打开申请</Button>
        : <span className="f4-muted">申请不在最近 30 份里</span>,
    };
  }));
  for (const { original } of [...proposalDrafts, ...policyDrafts]) {
    const snapshot = original.f4Snapshot;
    const proposal = "spec" in original ? original.spec : undefined;
    const quota = proposal?.command.op === "f4_quota_tier_create";
    const materialAction = snapshot?.action === "approve" || snapshot?.action === "reject";
    const application = snapshot?.application && data?.ambassadorApplications.find(row => row.id === snapshot.application!.id);
    const authority = proposal ? f4ProposalAuthority(proposal) : "network_f4_pool_fund";
    const allowed = ctx.can(authority) && (!proposal || quota || proposal.command.op === "f4_ambassador_policy_change"
      || ctx.can("platform_a2_proposal_create") || ctx.can("platform_a2_write"));
    const getSpec = () => {
      if (!snapshot || !data || ctx.f4Loading || ctx.f4Error || !allowed
        || snapshot.action === "policy" && (ctx.f4PolicyLoading || !ctx.f4AmbassadorPolicy)
        || materialAction && application?.status.toUpperCase() !== "PENDING") return;
      const value = snapshot.action === "F.leaderboard.paused" ? proposal?.command.params.value : undefined;
      if (snapshot.action === "F.leaderboard.paused" && value !== "on" && value !== "off") return;
      const latest = { ...snapshot, overview: data, policy: ctx.f4AmbassadorPolicy, application, material: snapshot.material,
        businessValue: undefined, value: typeof value === "string" ? value : undefined };
      try { return f4Confirmation(ctx, latest); } catch { return undefined; }
    };
    const current = quota ? undefined : getSpec();
    const quotaReady = quota && allowed && !!data && !ctx.f4Loading && !ctx.f4Error;
    recoveryRows.push({
      key: original.commandKey,
      name: quota ? "新建购机名额档位" : current?.name ?? proposal?.action ?? "调整区域大使申请规则",
      change: proposal ? `${proposal.before} → ${proposal.after}` : "大使申请规则",
      submittedAt: original.createdAt,
      settled: true,
      tag: <StatusTag tone="neutral">原操作未执行</StatusTag>,
      actions: quotaReady || current ? <Button size="sm" onClick={async () => {
        if (quotaReady) { setQuotaDraft(original as FDomainAttempt); return; }
        if (!current || !snapshot || !current.f4Snapshot) return;
        const fresh = current.f4Snapshot;
        if (materialAction && application) {
          try { fresh.material = await fetchF4AmbassadorMaterials(application.id); }
          catch { ctx.toast("材料加载失败，请重新读取。"); return; }
          if (snapshot.action === "approve" && (fresh.material.materialRevision !== snapshot.material?.materialRevision || !fresh.material.canProposeApproval)) {
            ctx.toast("材料版本已变化，请打开申请核对。"); return;
          }
        }
        const spec = materialAction ? f4Confirmation(ctx, fresh) : current;
        const frozen = f4Confirmation(ctx, snapshot);
        const fields = (form: typeof spec.businessForm) => form?.kind === "multi-field"
          ? Object.fromEntries(form.fields.map(field => [field.key, field.current ?? ""])) : undefined;
        const before = fields(frozen.businessForm), latest = fields(spec.businessForm);
        if (before && latest && snapshot.businessValue) {
          fresh.businessValue = rebaseFValues(before, snapshot.businessValue, latest, (a, b, key) =>
            a.trim() === b.trim() || (key === "defaultBudgetUsdt" || /\.(min|max)$/.test(key) || snapshot.action === "F.pool.periodPrize")
              && compareDecimal(a, b) === 0);
        }
        const frozenCurrent = frozen.edit?.current;
        const intended = snapshot.value;
        const unchanged = intended !== undefined && frozenCurrent !== undefined && (intended === frozenCurrent
          || !!spec.edit?.unit && compareDecimal(intended.replace(/%$/, ""), frozenCurrent.replace(/%$/, "")) === 0);
        const edit = spec.edit && { ...spec.edit, initialValue: unchanged ? spec.edit.current : intended };
        ctx.openActionConfirm({ ...spec, edit, f4Snapshot: fresh, draft: original });
      }}>继续修改</Button> : <span className="f4-muted">请核对当前对象和操作权限</span>,
    });
  }
  for (const { original } of materialDrafts) {
    const application = data?.ambassadorApplications.find(item => item.id === original.applicationId) ?? original.application;
    recoveryRows.push({
      key: original.commandKey,
      name: `${original.input.stage === "BUSINESS" ? "业务" : "财务"}核验 · 申请 #${original.applicationId}`,
      change: `材料第 ${original.input.expectedMaterialRevision} 版 · ${original.input.decision === "PASSED" ? "通过" : "需补材料"}`,
      submittedAt: original.createdAt,
      settled: true,
      tag: <StatusTag tone="neutral">原操作未执行</StatusTag>,
      actions: application && <Button size="sm" onClick={() => { setSection("quota"); setMaterialApplication(application); }}>打开申请</Button>,
    });
  }
  const recoveryNotice = <F4RecoveryNotice rows={recoveryRows} />;
  const activeQuota = quotaOriginal ?? quotaDraft;
  const quotaModal = activeQuota && <F4QuotaCreate key={activeQuota.commandKey} data={data ?? undefined} ctx={ctx}
    original={quotaOriginal} draft={quotaDraft} onClose={() => { setQuotaOriginal(undefined); setQuotaDraft(undefined); }} />;
  const materialDrawer = materialApplication && <F4AmbassadorMaterials application={materialApplication} ctx={ctx} onClose={() => setMaterialApplication(null)} />;

  const header = (
    <PageHeader pageId="F4" title="奖励池、名额与排行榜" summary="看团队激励池怎么分、购机名额和大使申请、排行榜。"
      readOnly={readOnly ? "当前账号只能查看这页" : undefined}
      meta={readAt ? <span className="rd-toolbar">
        <span>{`${businessClock(readAt)} 读取（${businessZone().label}）`}</span>
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={ctx.f4Loading} loadingText="读取中…" onClick={() => void ctx.refreshF4()}>刷新</Button>
      </span> : undefined}
      actions={<>
        {!readAt && <Button icon={<RefreshCw size={14} aria-hidden />} loading={ctx.f4Loading} loadingText="读取中…" onClick={() => void ctx.refreshF4()}>刷新</Button>}
        <Button icon={<ArrowRight size={14} aria-hidden />} onClick={onOpenCommissions}>奖励记录核对</Button>
      </>} />
  );

  if (!data) {
    return <div className="f4-page">
      {header}
      {ctx.f4Loading ? <>
        <Conclusion state="unknown">正在加载奖励池、名额与排行榜…</Conclusion>
        {recoveryNotice}
        <BlockState state="loading" title="正在加载…" />
      </> : ctx.f4Error ? <>
        <Conclusion state="unknown" hint="点「重试」；加载成功前不显示旧数字，也不能发起新修改。">这页的数据没加载出来，暂时无法判断</Conclusion>
        {recoveryNotice}
        <BlockState state="error" title="奖励池、名额与排行榜加载失败" detail={ctx.f4Error} onRetry={() => void ctx.refreshF4()} />
      </> : <>
        <Conclusion state="unknown">还没有读到数据</Conclusion>
        {recoveryNotice}
        <BlockState state="empty" title="暂无团队激励池数据" />
      </>}
      {materialDrawer}{quotaModal}
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
  const week = data.leaderboardComputePointPeriods?.week;
  // 额度没读到的商品不算「快用完」：额度都不知道，就说不了用到多少。
  const tightQuota = data.quotaRows.filter((row) => row.tight && row.monthlyQuota !== null).length;

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
  const quotaUnread = data.quotaRows.some((row) => row.status !== 0 && row.monthlyQuota === null);

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
          {quotaUnread
            ? <span className="f4-card-line">名额剩余 —</span>
            : quotaTotal > 0
            ? <span className="f4-card-meter">
              <RatioBar label="本月购机名额已用" value={Math.min(quotaUsed, quotaTotal)} total={quotaTotal} valueText={`已用 ${count(quotaUsed)} 台，总量 ${count(quotaTotal)} 台`} tone="role-2" quiet />
              <span className="f4-card-line">名额剩余 {count(data.quotaMonthlyStockRemaining)} 台 · 总量 {count(quotaTotal)} 台</span>
            </span>
            : <span className="f4-card-line">本月购机名额总数为 0</span>}
        </Stat>
        <Stat {...tabProps("board")} openLabel="排行榜"
          head={<span className="f4-card-head">排行榜</span>}
          surface={board.paused ? "warn" : undefined}
          label={board.paused ? "本周奖池（暂停时）" : "本周奖池"}
          value={board.available && week ? usdt(week.poolUsdText ?? week.poolUsd) : "—"} unit={board.available && week ? "USDT" : undefined} tone="role-1">
          <span className="f4-card-line">
            {board.paused ? <StatusTag tone="warn">已暂停</StatusTag> : <StatusTag tone="ok">运行中</StatusTag>}
            {board.available && week?.podium[0] ? <span>第 1 名 {week.podium[0].userId}</span> : <span className="f4-muted">{board.available && week ? "本周还没有上榜的人" : "名次读不出来"}</span>}
          </span>
        </Stat>
      </StatBand>
      </div>

      <div {...ids.panel(section)} className="f4-section">
        {section === "pool" && <F4Pool ctx={ctx} data={data} settlement={settlement} />}
        {section === "quota" && <F4Quota ctx={ctx} data={data} onOpenMaterials={setMaterialApplication} />}
        {section === "board" && <F4Leaderboard ctx={ctx} data={data} />}
      </div>
      {materialDrawer}{quotaModal}
    </div>
  );
}
