"use client";

/**
 * F4 · 购机名额与大使申请（改版）。名额总量、已用、剩余和每个商品的额度；已用记录和回收；大使申请走到哪一步；申请规则。
 * 写入口和请求沿用旧页面：额度、回收走 shell 的 param/dispose 提交（A2 审批），申请规则走 ctx.updateF4AmbassadorPolicy 或 ctx.submitTeamApproval。
 */
import { useState } from "react";
import { AlertCircle, BadgeCheck, FileText, Package, Users } from "lucide-react";
import { BlockState, Button, Cell, Explain, Field, Fold, Input, KeyValues, Panel, RatioBar, StatusDistributionBar, StatusTag, Table, TableMessage, Td, Th, Tr } from "@/app/components/rd";
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { ambassadorBucketLabel, ambassadorMaterialStateLabel, formatF4AmbassadorBucketRule, formatF4AmbassadorBucketTitle } from "@/lib/admin/f4-ambassador-display";
import type { F4AmbassadorApplication, F4AmbassadorPolicy, F4AmbassadorPolicyUpdate, F4LeadershipPoolOverview } from "@/lib/admin/f1-client";
import type { BusinessFormSpec, BusinessFormValue } from "../design-kit";
import { approvalCopy, approvalTag } from "./f4-pool";
import { count, decimalText, stamp, zoneNote } from "./f4-shared";
import type { FViewCtx } from "./types";

type StageKey = "materials" | "business" | "finance" | "approve" | "approved" | "rejected" | "legacy";

/** 一份申请走到哪一步、卡在谁那里。只读接口给的状态，不另算。 */
export function applicationStage(application: F4AmbassadorApplication): { key: StageKey; text: string; done: number; tone: "warn" | "neutral" | "progress" | "done" | "ok" } {
  const status = application.status.toUpperCase();
  if (application.legacyApproved) return { key: "legacy", text: "历史已批准（无材料）", done: 4, tone: "done" };
  if (status === "APPROVED") return { key: "approved", text: "已批准，已开通所选类别额度", done: 4, tone: "done" };
  if (status === "REJECTED") return { key: "rejected", text: "已驳回", done: 0, tone: "done" };
  if (!application.materialRevision || application.materialState === "NOT_SUBMITTED") return { key: "materials", text: "等申请人提交材料", done: 0, tone: "neutral" };
  if (application.materialState === "NEEDS_MORE") return { key: "materials", text: "等申请人补材料", done: 0, tone: "warn" };
  if (application.businessReview?.status !== "PASSED") return { key: "business", text: "等业务核验", done: 1, tone: "neutral" };
  if (application.financeReview?.status !== "PASSED") return { key: "finance", text: "等财务核验", done: 2, tone: "neutral" };
  return { key: "approve", text: "可以发起最终批准", done: 3, tone: "progress" };
}

const STAGE_FILTERS: { key: StageKey; label: string; tone: "warn" | "neutral" | "progress" | "role-other" | "done" }[] = [
  { key: "materials", label: "等申请人交材料", tone: "warn" },
  { key: "business", label: "等业务核验", tone: "role-other" },
  { key: "finance", label: "等财务核验", tone: "neutral" },
  { key: "approve", label: "可发起批准", tone: "progress" },
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

function openAmbassadorPolicy(ctx: FViewCtx, policy: F4AmbassadorPolicy) {
  type Field = Extract<BusinessFormSpec, { kind: "multi-field" }>["fields"][number];
  const budget = { inputKind: "number", min: 100, max: 10_000, pattern: "^[0-9]+(?:\\.[0-9]+)?$", patternMessage: "预算须填写十进制金额" } as const;
  const mainFields: Field[] = [
    { key: "policyVersion", label: "规则版本", current: policy.policyVersion, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$" },
    { key: "defaultBudgetUsdt", label: "默认预算(USDT)", current: String(policy.defaultBudgetUsdt), ...budget },
  ];
  const bucketRows = policy.buckets.map((bucket) => {
    const name = formatF4AmbassadorBucketTitle(bucket.id, bucket.title);
    const fields: Field[] = [
      { key: `${bucket.id}.title`, label: `${name} 名称`, current: bucket.title, maxLength: 80 },
      { key: `${bucket.id}.rule`, label: `${name} 申请条件`, current: bucket.rule, maxLength: 500 },
      { key: `${bucket.id}.range`, label: `${name} 显示的金额范围`, current: bucket.range, maxLength: 80 },
      { key: `${bucket.id}.min`, label: `${name} 最低预算`, current: String(bucket.minBudgetUsdt), ...budget },
      { key: `${bucket.id}.max`, label: `${name} 最高预算`, current: String(bucket.maxBudgetUsdt), ...budget },
    ];
    return { bucket, name, fields };
  });
  const limits = [
    { key: "defaultBudgetUsdt", label: "默认预算", before: policy.defaultBudgetUsdt },
    ...bucketRows.map(({ bucket, name }) => ({ key: `${bucket.id}.max`, label: `${name} · 最高预算`, before: bucket.maxBudgetUsdt })),
  ];
  const changedLimits = (values: BusinessFormValue) => limits.flatMap((limit) => {
    const after = values[limit.key]?.trim();
    return after && Number.isFinite(Number(after)) && Number(after) !== limit.before ? [{ ...limit, after }] : [];
  });
  const requiresApproval = (changes: ReturnType<typeof changedLimits>) => changes.some(({ before, after }) => Number(after) > before);
  const formatAmount = (value: string | number) => `${decimalText(value)} USDT`;

  ctx.openActionConfirm({ briefKind: "config",
    name: "调整区域大使申请规则",
    title: "调整大使申请规则",
    businessForm: { kind: "multi-field", fields: [...mainFields, ...bucketRows.flatMap(({ fields }) => fields)] },
    statedBrief: {
      impact: "保存后 App 的大使申请页下次打开或刷新就用新规则；已经提交的申请不按新规则改金额。",
      check: "只改文字、调低预算或调高最低预算时直接保存；调高默认预算或任一类的最高预算要另一位超级管理员批准。",
    },
    detail: "四类的编号固定不能改。已知的四类在 PC 和 App 上显示内置的中文名称和条件，自定义的名称和条件文字不一定显示给用户。",
    completionCopy: "填写理由后即时保存，不经审批。",
    teamApproval: {
      source: "F4",
      resolve: (values) => {
        const changes = changedLimits(values);
        if (!requiresApproval(changes)) return undefined;
        return {
          heading: "提高预算 · 另一位超级管理员批准后生效",
          completionCopy: "批准前 App 继续用现在的规则。提交和批准时都会检查兑付覆盖率，批准人需有大使规则资金权限和审批权限，不能是你自己。",
          comparison: <div className="f4-policy-diff">
            <Table label="预算变更对比">
              <thead><tr><Th>预算</Th><Th align="right">现在</Th><Th align="right">改后</Th></tr></thead>
              <tbody>{changes.map(({ key, label, before, after }) => <Tr key={key}>
                <Td>{label}</Td><Td align="right"><Cell num main={formatAmount(before)} /></Td><Td align="right"><Cell num main={formatAmount(after)} /></Td>
              </Tr>)}</tbody>
            </Table>
          </div>,
        };
      },
      renderForm: (values, change, locked) => {
        const input = (field: Field) => <Input id={`f4-policy-${field.key}`} name={field.key}
          aria-label={field.label} type={field.inputKind ?? "text"} min={field.min} max={field.max}
          step={field.inputKind === "number" ? "any" : undefined} maxLength={field.maxLength}
          title={field.inputKind !== "number" ? values[field.key] : undefined}
          value={values[field.key] ?? ""} disabled={locked} required
          onChange={(event) => change({ ...values, [field.key]: event.target.value })} />;
        return <div className="f4-policy-form">
          <div className="f4-policy-main">
            <Field id={`f4-policy-${mainFields[0].key}`} label="规则版本" hint="3–64 位，字母数字点横线">{input(mainFields[0])}</Field>
            <Field id={`f4-policy-${mainFields[1].key}`} label="默认预算" hint="100–10,000 USDT，要落在某一类的范围里">{input(mainFields[1])}</Field>
          </div>
          {bucketRows.map(({ bucket, name, fields }) => <fieldset key={bucket.id} className="f4-policy-bucket">
            <legend>{name}<span data-mono>{bucket.id}</span></legend>
            <Field id={`f4-policy-${fields[0].key}`} label="名称" hint="≤ 80 字">{input(fields[0])}</Field>
            <Field id={`f4-policy-${fields[2].key}`} label="显示范围" hint="≤ 80 字">{input(fields[2])}</Field>
            <Field id={`f4-policy-${fields[3].key}`} label="最低预算" hint="USDT">{input(fields[3])}</Field>
            <Field id={`f4-policy-${fields[4].key}`} label="最高预算" hint="USDT">{input(fields[4])}</Field>
            <div className="f4-policy-rule"><Field id={`f4-policy-${fields[1].key}`} label="申请条件" hint="≤ 500 字">{input(fields[1])}</Field></div>
          </fieldset>)}
        </div>;
      },
    },
    run: async (reason, values) => {
      if (!values) throw new Error("请填写完整");
      const payload: F4AmbassadorPolicyUpdate = {
        policyVersion: values.policyVersion.trim(),
        expectedRevision: policy.revision,
        defaultBudgetUsdt: values.defaultBudgetUsdt.trim(),
        buckets: policy.buckets.map(({ id }) => ({
          id,
          title: values[`${id}.title`].trim(),
          rule: values[`${id}.rule`].trim(),
          range: values[`${id}.range`].trim(),
          minBudgetUsdt: values[`${id}.min`].trim(),
          maxBudgetUsdt: values[`${id}.max`].trim(),
        })),
      };
      const requestedDefault = Number(payload.defaultBudgetUsdt);
      if (payload.buckets.some(({ minBudgetUsdt, maxBudgetUsdt }) => Number(minBudgetUsdt) > Number(maxBudgetUsdt))) {
        throw new Error("最低预算不能高于最高预算");
      }
      if (!payload.buckets.some(({ minBudgetUsdt, maxBudgetUsdt }) => requestedDefault >= Number(minBudgetUsdt) && requestedDefault <= Number(maxBudgetUsdt))) {
        throw new Error("默认预算须落在至少一个分类的预算范围内");
      }
      if (requiresApproval(changedLimits(values))) {
        await ctx.submitTeamApproval("F4", payload, reason);
      } else {
        await ctx.updateF4AmbassadorPolicy(payload, reason);
        ctx.toast("区域大使申请规则已更新");
      }
    },
  });
}

export function F4Quota({ ctx, data, onOpenMaterials }: { ctx: FViewCtx; data: F4LeadershipPoolOverview; onOpenMaterials: (application: F4AmbassadorApplication) => void }) {
  const [stageFilter, setStageFilter] = useState<StageKey | null>(null);
  const canWrite = ctx.can("network_f4_write");
  const policy = ctx.f4AmbassadorPolicy;
  const total = data.quotaMonthlyStockTotal;
  const used = data.quotaMonthlyStockUsed;
  const remaining = data.quotaMonthlyStockRemaining;
  const stages = data.ambassadorApplications.map((application) => ({ application, stage: applicationStage(application) }));
  const shown = stageFilter ? stages.filter(({ stage }) => stage.key === stageFilter) : stages;

  const openQuota = (quota: F4LeadershipPoolOverview["quotaRows"][number]) => ctx.openActionConfirm({ briefKind: "config",
    name: `${quota.name} 月额度调整`, op: "param",
    paramKey: `F.quota.tier.${quota.quotaCode || quota.id}.monthlyQuota`,
    expectedVersion: quota.cap,
    edit: { kind: "number", current: String(quota.cap), unit: "台" },
    title: `调整 ${quota.name} 的月额度`, effect: approvalTag(), confirmLabel: "提交审批",
    statedBrief: {
      impact: "批准后限制这个商品之后的购买；已用的记录不删，也不退单。新额度不能低于本月已用。",
      check: "后端只接受 0–1,000,000 的整数；批准时额度已被别人改过，或新额度低于本月已用，会被拒绝并给出最新值。",
    },
    completionCopy: approvalCopy("F4 写权限"),
    facts: <KeyValues rows={[
      { key: "used", label: "本月已用", value: `${count(quota.current)} 台` },
      { key: "code", label: "额度编号", value: <span data-mono>{quota.quotaCode || quota.id}</span> },
    ]} />,
    detail: `${quota.quotaCode || quota.id} · 已用 ${quota.current} / ${quota.cap}。如果别人刚改过，会提示你刷新后再改。`,
  });

  const openRecycle = (usage: F4LeadershipPoolOverview["quotaUsages"][number]) => ctx.openActionConfirm({ briefKind: "record",
    name: `回收配额 #${usage.id}`, op: "dispose",
    paramKey: `F.quota.usage.${usage.id}.status`, fixedVal: "recycled",
    title: `回收名额 #${usage.id}`, effect: approvalTag(), confirmTone: "danger", confirmLabel: "提交回收",
    statedBrief: {
      impact: "批准后这条记录改为已回收，这几台的名额回到本月剩余里；不退款、不删订单，用户已买的设备不受影响。",
      check: "只有还在占用的记录能回收；已回收或不存在的会被拒绝。",
    },
    completionCopy: approvalCopy("F4 写权限"),
    facts: <KeyValues rows={[
      { key: "user", label: "谁的", value: `用户 ${usage.userId}` },
      { key: "item", label: "哪一类", value: `${usage.productNo || usage.quotaCode} · ${count(usage.quantity)} 台` },
      { key: "order", label: "订单号", value: usage.orderNo ? <span data-mono>{usage.orderNo}</span> : "无订单号" },
    ]} />,
    detail: "只能回收已使用的配额，回收后这个月的名额马上释放。",
  });

  return (
    <div className="f4-stack">
      <Panel title="购机名额" icon={Package} tone="role-2" sub="本月 · 台"
        explain="每个商品每月最多卖多少台。已用按本月还在占用的记录合计；剩余 = 总量 − 已用，不会小于 0。门槛是买这个商品要满足的条件，不是订单金额。">
        <div className="f4-quota-sum">
          <div className="f4-quota-figure">
            <span className="f4-pool-label">本月剩余</span>
            <span className="f4-pool-value" data-zero={remaining === 0 ? "" : undefined}>{count(remaining)}<small>台</small></span>
          </div>
          <div className="f4-quota-bar">
            <RatioBar label="本月购机名额已用" value={Math.min(used, total)} total={total} tone="role-2"
              state={total > 0 ? "ready" : "empty"} emptyText="本月还没有设置名额"
              valueText={`已用 ${count(used)} 台，共 ${count(total)} 台`} />
            <span className="f4-muted">已用 {count(used)} 台 · 共 {count(total)} 台</span>
          </div>
        </div>
        <Table label="各商品本月名额" className="f4-quota-table">
          <thead><tr><Th>商品</Th><Th>购买条件</Th><Th>本月已用</Th><Th data-fit=""><span className="rd-sr-only">操作</span></Th></tr></thead>
          <tbody>
            {data.quotaRows.length ? data.quotaRows.map((quota) => <Tr key={quota.id}>
              <Td><Cell main={quota.name} sub={<span data-mono>{quota.productNo || quota.quotaCode}</span>} /></Td>
              <Td><Cell main={quotaPrerequisites(quota)} /></Td>
              <Td>
                <span className="f4-quota-use">
                  <RatioBar compact label={`${quota.name} 本月已用`} value={Math.min(quota.current, quota.cap)} total={quota.cap} tone={quota.tight ? "warn" : "role-2"}
                    state={quota.cap > 0 ? "ready" : "empty"} emptyText="额度为 0" valueText={`已用 ${quota.current} 台，共 ${quota.cap} 台`} quiet />
                  <span className="f4-num">{count(quota.current)} / {count(quota.cap)} 台</span>
                  {quota.tight && <StatusTag tone="warn" icon={AlertCircle}>快用完</StatusTag>}
                </span>
              </Td>
              <Td data-fit="">{canWrite && <Button size="sm" onClick={() => openQuota(quota)}>调额度</Button>}</Td>
            </Tr>) : <TableMessage columns={4}>还没有设置购机名额</TableMessage>}
          </tbody>
        </Table>
        <KeyValues rows={[
          { key: "pro", label: "专业设备购买门槛", value: presentText(data.proUnlock) },
          { key: "rack", label: "机柜设备购买门槛", value: presentText(data.rackUnlock) },
          { key: "stock", label: "月库存上限", value: /^\d+$/.test(data.quotaMonthlyStockLabel.trim()) ? `${count(Number(data.quotaMonthlyStockLabel))} 台` : presentText(data.quotaMonthlyStockLabel) },
        ]} />
        <Fold title="已用记录" summary={data.quotaUsages.length ? `最近 ${data.quotaUsages.length} 条 · 可回收` : "还没有已用记录"}
          explain={`按发生时间从新到旧，最多 30 条；时间为${zoneNote()}。回收要另一位管理员批准。`}>
          <Table label="购机名额已用记录" className="f4-usage-table">
            <thead><tr><Th>记录</Th><Th>用户</Th><Th>商品</Th><Th align="right">数量</Th><Th>订单号</Th><Th>时间</Th><Th>状态</Th><Th data-fit=""><span className="rd-sr-only">操作</span></Th></tr></thead>
            <tbody>
              {data.quotaUsages.length ? data.quotaUsages.map((usage) => <Tr key={usage.id}>
                <Td><span data-mono>#{usage.id}</span></Td>
                <Td><span data-mono>{usage.userId}</span></Td>
                <Td><Cell main={<span data-mono>{usage.productNo || usage.quotaCode}</span>} /></Td>
                <Td align="right"><Cell num main={`${count(usage.quantity)} 台`} /></Td>
                <Td>{usage.orderNo ? <Cell mono main={usage.orderNo} /> : <span className="f4-muted">无订单号</span>}</Td>
                <Td><Cell num main={stamp(usage.occurredAt)} /></Td>
                <Td>{usage.status.toUpperCase() === "ACTIVE" ? <StatusTag tone="ok">占用中</StatusTag> : usage.status.toUpperCase() === "RECYCLED" ? <StatusTag tone="done">已回收</StatusTag> : <StatusTag tone="neutral">{usage.status || "状态未知"}</StatusTag>}</Td>
                <Td data-fit="">{canWrite && <Button size="sm" variant="danger-outline" onClick={() => openRecycle(usage)}>回收</Button>}</Td>
              </Tr>) : <TableMessage columns={8}>还没有已用记录</TableMessage>}
            </tbody>
          </Table>
        </Fold>
      </Panel>

      <Panel title="大使申请" icon={Users} tone="role-3" sub={`最近 ${data.ambassadorApplications.length} 份 · 待处理 ${count(data.ambassadorPendingCount)} 份`}
        explain={<>
          <p>一份申请的流程：申请人提交材料 → 业务核验 → 财务核验 → 最终批准。批准只开通申请人所选那一类的额度，不是付款。</p>
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
          explain="这几个数是后端汇总所有申请（不分月份）得到的，不是本月数，也不是预算上限；名称已按真实口径写。">
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
        actions={policy && ctx.canSubmitTeamApproval("F4") ? <Button onClick={() => openAmbassadorPolicy(ctx, policy)}>调整申请规则</Button> : undefined}>
        {!policy ? <BlockState state="error" title="申请规则读取失败" detail="这不是没有规则：规则暂时读不到，调整入口也先收起。" onRetry={() => void ctx.refreshF4()} retryLabel="重新读取" />
          : <>
            <KeyValues rows={[{ key: "default", label: "默认申请预算", value: `${decimalText(policy.defaultBudgetUsdt)} USDT`, explain: "申请人没改金额时用的预算，要落在某一类的范围里。" }]} />
            <ul className="f4-buckets" aria-label="四类申请">
              {policy.buckets.map((bucket) => <li key={bucket.id}>
                <span className="f4-bucket-head"><BadgeCheck size={14} aria-hidden />{formatF4AmbassadorBucketTitle(bucket.id, bucket.title)}<span data-mono>{bucket.id}</span></span>
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
