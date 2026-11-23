"use client";

/**
 * F4 · 购机名额与大使申请（改版）。名额总量、已用、剩余和每个商品的额度；已用记录和回收；大使申请走到哪一步；申请规则。
 * 写入口和请求沿用旧页面：额度、回收走 shell 的 param/dispose 提交（A2 审批），申请规则走 ctx.updateF4AmbassadorPolicy 或 ctx.submitTeamApproval。
 */
import { useState } from "react";
import { AlertCircle, Ban, FileText, Package, PauseCircle, Plus, Users } from "lucide-react";
import { BlockState, Button, Cell, Explain, Fold, InlineRetry, KeyValues, Panel, RatioBar, StatusDistributionBar, StatusTag, Table, TableMessage, Td, Th, Tr } from "@/app/components/rd";
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { ambassadorBucketLabel, ambassadorMaterialStateLabel, formatF4AmbassadorBucketRule, formatF4AmbassadorBucketTitle } from "@/lib/admin/f4-ambassador-display";
import type { F4AmbassadorApplication, F4LeadershipPoolOverview } from "@/lib/admin/f1-client";
import { count, decimalText, stamp, zoneNote, moneyText } from "./f4-shared";
import type { FViewCtx } from "./types";
import { f4Confirmation } from "./f4-confirmations";
import { F4QuotaCreate } from "./f4-quota-create";

type StageKey = "materials" | "business" | "finance" | "approve" | "approved" | "rejected" | "legacy";

/** 一份申请走到哪一步、卡在谁那里。只读接口给的状态，不另算。 */
export function applicationStage(application: F4AmbassadorApplication): { key: StageKey; text: string; done: number; tone: "warn" | "neutral" | "progress" | "done" | "ok" } {
  const status = application.status.toUpperCase();
  if (application.legacyApproved) return { key: "legacy", text: "历史已批准（无材料）", done: 4, tone: "done" };
  if (status === "APPROVED") return { key: "approved", text: "已批准，已开通额度", done: 4, tone: "done" };
  if (status === "REJECTED") return { key: "rejected", text: "已驳回", done: 0, tone: "done" };
  if (!application.materialRevision || application.materialState === "NOT_SUBMITTED") return { key: "materials", text: "等申请人提交材料", done: 0, tone: "neutral" };
  if (application.materialState === "NEEDS_MORE") return { key: "materials", text: "等申请人补材料", done: 0, tone: "warn" };
  if (application.businessReview?.status !== "PASSED") return { key: "business", text: "等业务核验", done: 1, tone: "neutral" };
  if (application.financeReview?.status !== "PASSED") return { key: "finance", text: "等财务核验", done: 2, tone: "neutral" };
  return { key: "approve", text: "两项核验已通过", done: 3, tone: "progress" };
}

const STAGE_FILTERS: { key: StageKey; label: string; tone: "warn" | "neutral" | "progress" | "role-other" | "done" }[] = [
  { key: "materials", label: "等申请人交材料", tone: "warn" },
  { key: "business", label: "等业务核验", tone: "role-other" },
  { key: "finance", label: "等财务核验", tone: "neutral" },
  { key: "approve", label: "核验已通过", tone: "progress" },
];

function presentText(value: string, fallback = "未配置") {
  return value.trim() ? value : fallback;
}

function quotaPrerequisites(row: { directRefs: number; monthComputePointsText: string | null; unlockMode: "ALL" | "EITHER"; criteriaKnown: boolean }) {
  if (!row.criteriaKnown || row.monthComputePointsText === null) return "资格条件暂时无法显示";
  const parts: string[] = [];
  if (row.directRefs > 0) parts.push(`有效直接邀请 ≥ ${row.directRefs}`);
  if (/[1-9]/.test(row.monthComputePointsText)) {
    const points = row.monthComputePointsText.split(".")[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    parts.push(`本月团队算力点 ≥ ${points}`);
  }
  if (!parts.length) return "无额外条件";
  return parts.join(row.unlockMode === "EITHER" ? " 或 " : " 且 ");
}

/** 月额度没读到时不能调：调额度要带上原额度，防止盖掉别人的修改。 */
const QUOTA_MISSING = "月额度没读到，暂时不能调；刷新后再试";

/** 后端的「月配额 1000」「1100」这类额度文字统一写成「1,000 台」；认不出的原样显示。 */
function monthQuota(label: string) {
  const n = /^(?:月配额\s*)?(\d+)$/.exec(label.trim())?.[1];
  return n ? `${count(Number(n))} 台` : presentText(label, "—");
}

export function F4Quota({ ctx, data, onOpenMaterials }: { ctx: FViewCtx; data: F4LeadershipPoolOverview; onOpenMaterials: (application: F4AmbassadorApplication) => void }) {
  const [stageFilter, setStageFilter] = useState<StageKey | null>(null);
  const [creating, setCreating] = useState(false);
  const canWrite = ctx.can("network_f4_write");
  const policy = ctx.f4AmbassadorPolicy;
  const total = data.quotaMonthlyStockTotal;
  const used = data.quotaMonthlyStockUsed;
  const remaining = data.quotaMonthlyStockRemaining;
  // 已用含待付款；后端不给（旧版本）或为 0 时不单列。已售只在后端给了时显示。
  const pending = data.quotaMonthlyStockPending ?? 0;
  const sold = data.quotaMonthlyStockSold;
  // 在卖的商品里有额度没读到时，总量和剩余都依赖它，不给确定的数（ST-40）；已用照常显示。
  const unreadCount = data.quotaRows.filter((row) => row.status !== 0 && row.monthlyQuota === null).length;
  const usedParts = [`已用 ${count(used)} 台`, pending > 0 && `含待付款 ${count(pending)} 台`, sold !== undefined && `已售 ${count(sold)} 台`].filter(Boolean).join(" · ");
  const stages = data.ambassadorApplications.map((application) => ({ application, stage: applicationStage(application) }));
  // 已用记录只给代码，商品名从名额卡里按同一个额度编号找；找不到的只写代码。
  const quotaName = (usage: F4LeadershipPoolOverview["quotaUsages"][number]) => data.quotaRows.find((row) => (usage.quotaCode && row.quotaCode === usage.quotaCode) || (usage.productNo && row.productNo === usage.productNo))?.name;
  const productName = (usage: F4LeadershipPoolOverview["quotaUsages"][number]) => quotaName(usage) ?? (usage.productNo || usage.quotaCode);
  const shown = stageFilter ? stages.filter(({ stage }) => stage.key === stageFilter) : stages;
  // Pro / Rack 月额度取在卖档位里名字带 Pro / Rack 的第一个；那一档额度没读到时，后端的数只按已用算，不当额度显示。
  const unlockValue = (code: string, label: string) => data.quotaRows.find((row) => row.status === 1 && row.name.toUpperCase().includes(code))?.monthlyQuota === null
    ? <>—<span className="f4-muted"> · 月额度没读到</span></> : monthQuota(label);

  const openQuota = (quota: F4LeadershipPoolOverview["quotaRows"][number]) => ctx.openActionConfirm(f4Confirmation(ctx, { action: `F.quota.tier.${quota.quotaCode || quota.id}.monthlyQuota`, overview: data, policy: ctx.f4AmbassadorPolicy }));

  const openRecycle = (usage: F4LeadershipPoolOverview["quotaUsages"][number]) => ctx.openActionConfirm(f4Confirmation(ctx, { action: `F.quota.usage.${usage.id}.status`, overview: data, policy: ctx.f4AmbassadorPolicy }));

  return (
    <div className="f4-stack">
      {creating && <F4QuotaCreate data={data} ctx={ctx} onClose={() => setCreating(false)} />}
      <Panel title="购机名额" icon={Package} tone="role-2" sub="本月 · 台"
        actions={canWrite && data.quotaRows.length > 0 ? <Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={() => setCreating(true)}>新建档位</Button> : undefined}
        explain={<>
          <p>每个商品每月最多卖多少台。门槛是买这个商品要满足的条件，不是订单金额。</p>
          <p>已用含待付款。部分未交付订单会先占用名额，交付后计入已售。符合释放条件才归还，人工核对期间可能继续占用。</p>
          <p>总量是各商品本月额度相加，用超的按已用算；已暂停的商品不算。</p>
        </>}>
        <div className="f4-quota-sum">
          <div className="f4-quota-figure">
            <span className="f4-pool-label">本月剩余</span>
            <span className="f4-pool-value" data-zero={remaining === 0 || unreadCount > 0 ? "" : undefined}>{unreadCount > 0 ? "—" : <>{count(remaining)}<small>台</small></>}</span>
          </div>
          <div className="f4-quota-bar">
            <RatioBar label="本月购机名额已用" value={Math.min(used, total)} total={total} tone="role-2"
              state={unreadCount > 0 ? "failed" : total > 0 ? "ready" : "empty"} emptyText="本月名额总数为 0"
              failedText={`${count(unreadCount)} 个商品的月额度没读到，剩余和总量先不显示`}
              valueText={`${usedParts}，总量 ${count(total)} 台`} />
            <span className="f4-muted">{unreadCount > 0 ? usedParts : `${usedParts} · 总量 ${count(total)} 台`}</span>
          </div>
        </div>
        {data.quotaRows.length ? <ul className="f4-quota-items" aria-label="各商品本月名额">
          {data.quotaRows.map((quota) => {
            const paused = quota.status === 0;
            // 旧后端不给 monthlyQuota，按 cap 算；给了 null 是额度没读到，不能拿它判断满没满。
            const limit = quota.monthlyQuota === undefined ? quota.cap : quota.monthlyQuota === null ? null : Number(quota.monthlyQuota);
            const held = quota.pendingThisMonth ?? 0;
            const soldOut = !paused && limit !== null && quota.current >= limit;
            // 只因待付款占满（已售 < 额度 ≤ 已售 + 待付款）才是橙色「名额已占满」：待付款放回后还能卖。其余占满都是「本月已停卖」。
            const heldFull = soldOut && limit !== null && held > 0 && quota.soldThisMonth !== undefined && quota.soldThisMonth < limit && limit <= quota.soldThisMonth + held;
            const tight = quota.tight && !paused && !soldOut && limit !== null;
            const over = limit !== null && quota.current > limit ? quota.current - limit : 0;
            // 后端给了已售就照实写，0 也写；旧后端不给时不写。
            const parts = [held > 0 && `含待付款 ${count(held)} 台`, quota.soldThisMonth !== undefined && `已售 ${count(quota.soldThisMonth)} 台`].filter(Boolean).join(" · ");
            // 剩余照后端给的（已用含待付款，最少 0）；旧后端不给、额度没读到或已暂停时不写。
            const left = !paused && limit !== null && quota.remaining !== undefined ? quota.remaining : null;
            return <li key={quota.id} data-tight={tight ? "" : undefined} data-paused={paused ? "" : undefined}>
            <span className="f4-quota-head">
              <span className="f4-quota-name"><b>{quota.name}</b><span data-mono>{quota.productNo || quota.quotaCode}</span></span>
              {canWrite && <Button size="sm" disabledReason={quota.monthlyQuota === null ? QUOTA_MISSING : undefined} onClick={() => openQuota(quota)}>调额度</Button>}
            </span>
            <span className="f4-quota-cond">{quotaPrerequisites(quota)}</span>
            <RatioBar label={`${quota.name} 本月已用`} value={quota.current} total={limit ?? 0} tone={paused ? "done" : soldOut ? heldFull ? "warn" : "danger" : tight ? "warn" : "role-2"}
              state={limit === null ? "failed" : over > 0 ? "empty" : limit > 0 ? "ready" : "empty"}
              failedText={<>这个商品的月额度没读到 · <InlineRetry onRetry={() => void ctx.refreshF4()} /></>}
              emptyText={over > 0 ? `已超出 ${count(over)} 台` : "额度为 0"}
              valueText={`已用 ${count(quota.current)} 台${parts ? `，${parts.replaceAll(" · ", "，")}` : ""}，共 ${limit === null ? "—" : count(limit)} 台${left === null ? "" : `，剩 ${count(left)} 台`}`} quiet />
            {/* 「含待付款 · 已售」放在下面一行：和标签挤在一行时卡片放不下。 */}
            <span className="f4-quota-use"><span className="f4-num">已用 {count(quota.current)} / {count(limit)} 台{left !== null && <> · 剩 {count(left)} 台</>}</span>{paused ? <StatusTag tone="neutral" icon={PauseCircle}>已暂停</StatusTag> : soldOut ? heldFull ? <StatusTag tone="warn" icon={AlertCircle}>名额已占满</StatusTag> : <StatusTag tone="danger" icon={Ban}>本月已停卖</StatusTag> : tight && <StatusTag tone="warn" icon={AlertCircle}>快用完</StatusTag>}</span>
            {parts && <span className="f4-muted">{parts}</span>}
            {paused && <span className="f4-quota-cond">用户买不了这个商品，不算进总量</span>}
          </li>; })}
        </ul> : <BlockState state="empty" title="还没有设置购机名额" detail={canWrite ? "新建一档后，要另一位超级管理员批准才生效。" : undefined}
          onRetry={canWrite ? () => setCreating(true) : undefined} retryLabel="新建档位" />}
        <KeyValues rows={[
          { key: "pro", label: "Pro 商品月额度", value: unlockValue("PRO", data.proUnlock), explain: "名字里带 Pro 的第一个在卖商品，取额度和已用里较大的一个。不是购买门槛。" },
          { key: "rack", label: "Rack 商品月额度", value: unlockValue("RACK", data.rackUnlock), explain: "名字里带 Rack 的第一个在卖商品，取额度和已用里较大的一个。不是购买门槛。" },
        ]} />
        <Fold title="已用记录" summary={data.quotaUsages.length ? `最近 ${data.quotaUsages.length} 条 · 可回收` : "还没有已用记录"}
          explain={`按发生时间从新到旧，最多 30 条，不含待付款；时间为${zoneNote()}。回收要另一位管理员批准。`}>
          <Table label="购机名额已用记录" className="f4-usage-table">
            <thead><tr><Th>记录</Th><Th>用户</Th><Th>商品</Th><Th align="right">数量</Th><Th>订单号</Th><Th>时间</Th><Th>状态</Th><Th data-fit=""><span className="rd-sr-only">操作</span></Th></tr></thead>
            <tbody>
              {data.quotaUsages.length ? data.quotaUsages.map((usage) => <Tr key={usage.id}>
                <Td><span data-mono>#{usage.id}</span></Td>
                <Td><span data-mono>{usage.userId}</span></Td>
                <Td>{quotaName(usage) ? <Cell main={quotaName(usage)} sub={<span data-mono>{usage.productNo || usage.quotaCode}</span>} /> : <Cell main={<span data-mono>{usage.productNo || usage.quotaCode}</span>} />}</Td>
                <Td align="right"><Cell num main={`${count(usage.quantity)} 台`} /></Td>
                <Td>{usage.orderNo ? <Cell mono main={usage.orderNo} /> : <span className="f4-muted">无订单号</span>}</Td>
                <Td><Cell num main={stamp(usage.occurredAt)} /></Td>
                <Td>{usage.status.toUpperCase() === "ACTIVE" ? <StatusTag tone="ok">占用中</StatusTag> : usage.status.toUpperCase() === "RECYCLED" ? <StatusTag tone="done">已回收</StatusTag> : <StatusTag tone="neutral">{usage.status || "状态未知"}</StatusTag>}</Td>
                <Td data-fit="">{canWrite && <Button size="sm" disabled={usage.status.toUpperCase() !== "ACTIVE"} variant={usage.status.toUpperCase() === "ACTIVE" ? "danger-outline" : "ghost"} onClick={() => openRecycle(usage)}>回收</Button>}</Td>
              </Tr>) : <TableMessage columns={8}>还没有已用记录</TableMessage>}
            </tbody>
          </Table>
        </Fold>
      </Panel>

      <Panel title="大使申请" icon={Users} tone="role-3" sub={`最近 ${data.ambassadorApplications.length} 份 · 待处理 ${count(data.ambassadorPendingCount)} 份`}
        explain={<>
          <p>一份申请的流程：申请人提交材料 → 业务核验和财务核验（先后不限）→ 最终批准。批准只开通申请人所选那一类的额度，不是付款。</p>
          <p>业务和财务核验在材料详情里直接记录；批准和驳回在材料详情里发起，由另一位管理员批准，核验过这一版材料的人不能做最终批准。</p>
        </>}>
        <ol className="f4-flow" aria-label="大使申请流程">
          {["提交材料", "业务核验", "财务核验", "最终批准"].map((step, index) => <li key={step}><span className="f4-flow-no">{index + 1}</span>{step}{index === 3 && <small>开通所选类别额度</small>}</li>)}
        </ol>
        <StatusDistributionBar label="待处理的申请卡在哪一步" selectedKey={stageFilter}
          state={stages.some(({ stage }) => STAGE_FILTERS.some((item) => item.key === stage.key)) ? "ready" : "empty"}
          emptyText="最近的申请里没有待处理的"
          segments={STAGE_FILTERS.map((item) => {
            const n = stages.filter(({ stage }) => stage.key === item.key).length;
            return { key: item.key, label: item.label, value: n, text: `${n} 份`, tone: item.tone, onSelect: () => setStageFilter(stageFilter === item.key ? null : item.key) };
          })} />
        {stageFilter && <p className="f4-filter-note">只看「{STAGE_FILTERS.find((item) => item.key === stageFilter)?.label}」 · <button type="button" className="rd-link" onClick={() => setStageFilter(null)}>看全部</button></p>}
        <Table label="大使申请" className="f4-amb-table">
          <thead><tr><Th>申请</Th><Th>地区和等级</Th><Th>类别和金额</Th><Th>走到哪一步</Th><Th data-fit=""><span className="rd-sr-only">操作</span></Th></tr></thead>
          <tbody>
            {shown.length ? shown.map(({ application, stage }) => <Tr key={application.id} onOpen={() => onOpenMaterials(application)}>
              <Td><Cell main={operatorNicknameText(application.applicantName)} sub={<span data-mono>#{application.id}</span>} /></Td>
              <Td><Cell main={`${application.region}${application.city ? ` / ${application.city}` : ""}`} sub={application.currentRank} /></Td>
              <Td><Cell main={ambassadorBucketLabel(application.bucket)} sub={`${decimalText(application.requestedBudgetUsd)} USDT`} /></Td>
              <Td>
                <span className="f4-stage">
                  <RatioBar compact steps label="申请进度" value={stage.done} total={4} tone={stage.tone === "done" ? "done" : "role-3"} valueText={`第 ${Math.min(stage.done + 1, 4)} 步，共 4 步`} quiet />
                  <span className="f4-stage-text" data-tone={stage.tone}>{stage.text}</span>
                </span>
                <span className="f4-stage-sub">{application.legacyApproved ? "历史已批准" : ambassadorMaterialStateLabel(application.materialState)}{application.materialRevision ? ` · 材料第 ${application.materialRevision} 版` : ""}</span>
              </Td>
              <Td data-fit=""><Button size="sm" onClick={() => onOpenMaterials(application)}>查看材料</Button></Td>
            </Tr>) : <TableMessage columns={5}>{stageFilter ? "这一步没有申请" : "还没有大使申请"}</TableMessage>}
          </tbody>
        </Table>
        <Fold title="申请汇总" summary="累计已批准、累计申请的预算和最早的待审活动"
          explain="这几个数是所有申请（不分月份）的汇总，不是本月数，也不是预算上限；名称已按真实口径写。">
          <KeyValues rows={[
            { key: "approved", label: "累计已批准预算", value: presentText(data.ambassadorBudgetApprovedLabel, "—"), explain: "所有已批准申请的金额合计，不分月份。" },
            { key: "requested", label: "累计申请预算", value: presentText(data.ambassadorBudgetCapLabel, "—"), explain: "所有申请（含未批、已驳回）的申请金额合计，不是预算上限。" },
            { key: "kol", label: "达人推广预算最高占比", value: `${data.ambassadorKolBudgetPct}%`, explain: "申请里达人推广预算占比的最大值，不是合计占比。" },
            { key: "next", label: "最早的待审活动日期", value: presentText(data.ambassadorNextQuotaReviewDate, "—"), explain: "待审申请里最早的活动日期，不是季度评估计划。" },
          ]} />
        </Fold>
      </Panel>

      <Panel title="大使申请规则" icon={FileText} tone="role-4"
        sub={policy ? `版本 ${policy.policyVersion} · 第 ${policy.revision} 次修改` : undefined}
        explain={<>
          <p>这就是 App 上申请时用的规则：默认预算和四类各自的预算范围。保存后 App 下次打开或刷新就用新规则，已提交的申请不变。</p>
          <p>已知的四类在 PC 和 App 上显示内置的中文名称和条件，自定义的名称和条件文字不一定显示给用户。</p>
        </>}
        actions={policy && ctx.canSubmitTeamApproval("F4") ? <Button onClick={() => ctx.openActionConfirm(f4Confirmation(ctx, { action: "policy", overview: data, policy }))}>调整申请规则</Button> : undefined}>
        {!policy ? <BlockState state="error" title="申请规则读取失败" detail="这不是没有规则：规则暂时读不到，调整入口也先收起。" onRetry={() => void ctx.refreshF4()} retryLabel="重新读取" />
          : <>
            <KeyValues rows={[{ key: "default", label: "默认申请预算", value: `${moneyText(policy.defaultBudgetUsdt)} USDT`, explain: "申请人没改金额时用的预算，要落在某一类的范围里。" }]} />
            <ul className="f4-buckets" aria-label="四类申请">
              {policy.buckets.map((bucket) => <li key={bucket.id}>
                <span className="f4-bucket-head">{formatF4AmbassadorBucketTitle(bucket.id, bucket.title)}<span data-mono>{bucket.id}</span></span>
                <span className="f4-bucket-range">{decimalText(bucket.minBudgetUsdt)}–{decimalText(bucket.maxBudgetUsdt)}<small>USDT</small></span>
                <span className="f4-bucket-rule">{formatF4AmbassadorBucketRule(bucket.id, bucket.rule)}<Explain label={`${formatF4AmbassadorBucketTitle(bucket.id, bucket.title)}的原文`} rows={[
                  { k: "显示的金额范围", v: bucket.range || "—" },
                  { k: "后台保存的名称", v: bucket.title || "—" },
                  { k: "后台保存的条件", v: bucket.rule || "—" },
                ]} /></span>
              </li>)}
            </ul>
          </>}
      </Panel>
    </div>
  );
}
