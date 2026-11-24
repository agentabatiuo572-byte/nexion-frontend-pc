"use client";

/**
 * F1 门槛和奖励模板的修改框（A01–A08）。
 * 提交、恢复、审批分支都在 lib/admin/f1-policy-change（submitF1Policy）里，和改版前一样；这里只管框里的样子：
 * 标题写动作和对象，标签写哪个方向要批准，事实写现在的值和相邻等级，填写项用 rd 的控件。
 */
import { useState } from "react";
import { CircleHelp, Clock3, LockOpen, Zap, Lock } from "lucide-react";
import { Change, DiffField, Fact, Facts, Field, Input, KeepText, Notice, Select, StatusTag } from "@/app/components/rd";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { A2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { fetchF1VRankOverview } from "@/lib/admin/f1-client";
import { isDeterministicRejection } from "@/lib/admin/outcome-classification";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import { OperationConfirmModal, type BusinessFormSpec, type BusinessFormValue } from "../design-kit";
import {
  f1ConditionLabels, f1PolicyInitialForm, f1PolicyInputError, f1PolicyNeedsApproval,
  formatF1ExactAmount, isF1FundReward, pendingF1Policy, submitF1Policy, type F1PolicyEditor, type F1ConditionField,
} from "@/lib/admin/f1-policy-change";
import type { OpsVRankRewardItem } from "@/lib/admin/platform-types";
import type { FViewCtx } from "./types";
import { SUPER_APPROVER, safeCustomLabel } from "./f1-shared";
import { amountDisplay } from "@/lib/format";

const typeLabels = { usdt: "USDT（资金）", uvt: "UVT（资金）", voucher: "券", sku: "商品", custom: "自定义奖品" };
const REBASED = "没有保存：已按刚读到的值重算，核对后再提交。";
// 后端这两句共用、不带对象；在 F1 里说清是这一级被占着，以及什么时候能改。
const LOCKED = "没有保存：这一级有申请在等审批，批准、驳回或撤回后再改。";
// 框里已经重读过、填的值保留：不再叫运营去重新读取。
const REREAD: Record<string, string> = {
  VRANK_POLICY_VERSION_CONFLICT: "没有保存：别人刚改过这一级，页面已重读；核对后再确认。",
  VRANK_POLICY_REVISION_REQUIRED: "没有保存：页面已重读这一级的设置；核对后再确认。",
};
const valueLabel = (value: string) => value === "NONE" ? "未设置" : formatF1ExactAmount(value);
const UNIT: Record<string, string> = { selfBuy: "点", teamGv: "点", directRefs: "人", legCount: "个" };
/** 框上写的名字（新口径，画板 B3）；记进操作记录的名字仍用 f1ConditionLabels，请求不变。 */
const DISPLAY: Record<string, string> = { selfBuy: "自购算力点", teamGv: "团队算力点", directRefs: "一二级已购人数", legCount: "下级领导者人数", legRank: "下级领导者最低等级" };
const RANGE: Record<string, string> = { selfBuy: "填不小于 0 的整数", teamGv: "填不小于 0 的整数", directRefs: "填不小于 0 的整数", legCount: "填不小于 0 的整数" };

export function f1RewardPolicyLabel(item: OpsVRankRewardItem, ctx: Pick<FViewCtx, "voucherLabels" | "skuLabels">): string {
  if (isF1FundReward(item.type)) return item.amountText ? `${amountDisplay(item.amountText)} ${item.type.toUpperCase()}` : `${item.type.toUpperCase()} 金额暂不可用`;
  if (item.type === "voucher") return `券 · ${ctx.voucherLabels[item.voucherId ?? ""] ?? item.voucherId ?? "未设置"}`;
  if (item.type === "sku") return `商品 · ${ctx.skuLabels[item.skuId ?? ""] ?? item.skuId ?? "未设置"}`;
  return safeCustomLabel(item.custom);
}

export function F1PolicyConfirm({ editor: requested, ctx, onClose, onPendingChange, pendingApproval = false }: { editor: F1PolicyEditor; ctx: FViewCtx; onClose: () => void; onPendingChange: () => void; pendingApproval?: boolean }) {
  const session = useAdminAuth((state) => state.session);
  const [owner] = useState(session?.adminId);
  const [opening, setOpening] = useState(() => {
    try {
      const pending = owner === undefined ? undefined : pendingF1Policy(owner, requested);
      return { pending, error: requested.recoveryCommandKey && pending?.commandKey !== requested.recoveryCommandKey ? "原移除操作已处理，请关闭弹窗后核对当前奖励。" : undefined };
    }
    catch { return { pending: undefined, error: "原操作内容不完整，请到操作记录核对后处理。" }; }
  });
  const [baseline, setBaseline] = useState(requested);
  const [baselineReady, setBaselineReady] = useState(true);
  const [baselineRevision, setBaselineRevision] = useState(0);
  const editor = opening.pending?.original.editor ?? baseline;
  const form = opening.pending?.original.form ?? f1PolicyInitialForm(editor);
  const isCondition = editor.action === "threshold", remove = editor.action === "reward_remove";
  const condition = editor.field as F1ConditionField;
  const fieldLabel = isCondition ? f1ConditionLabels[condition] : "奖励";
  const currentLabel = !baselineReady ? "—" : isCondition ? valueLabel(editor.row[editor.field!] ?? "")
    : editor.reward ? f1RewardPolicyLabel(editor.reward, ctx) : "尚未配置";
  // 记进操作记录的名字，和改版前一样。
  const action = remove && opening.pending ? `${editor.row.v} · 核对原移除操作` : isCondition ? `调整 ${editor.row.v} 晋升条件 · ${fieldLabel}`
    : `${editor.row.v} · ${remove ? "移除奖励" : editor.action === "reward_add" ? "新增奖励" : "编辑奖励"}`;
  const title = opening.pending ? `${editor.row.v} 的原操作` : isCondition ? `调整 ${editor.row.v} 的${DISPLAY[condition] ?? fieldLabel}`
    : remove ? `移除 ${editor.row.v} 的奖励` : editor.action === "reward_add" ? `给 ${editor.row.v} 添加奖励` : `编辑 ${editor.row.v} 的奖励`;
  const disabledReason = opening.error ?? (!opening.pending && (!baselineReady || ctx.f1Loading || ctx.f1Error || ctx.vrankRows.length === 0) ? "请先成功重新读取会员等级。" : undefined) ?? (session?.adminId !== owner || !session?.authorities.includes("network_f1_write")
    ? "当前账号没有这项操作的权限，请关闭弹窗后重新核对。"
    : opening.pending && !opening.pending.original.approval && opening.pending.expiresAt <= Date.now()
      ? "原操作已过期，请到操作记录核对，勿重复提交。" : undefined);
  const pending = () => opening.error || owner === undefined ? undefined : pendingF1Policy(owner, editor);
  const requireSession = (write = true) => {
    const current = useAdminAuth.getState().session;
    if (!current || current.adminId !== owner || write && !current.authorities.includes("network_f1_write")) throw new Error("当前账号没有这项操作的权限，请关闭弹窗后重新核对。");
    return current;
  };
  const submit = async (reason: string, values: BusinessFormValue, mode: "submit" | "lookup" | "retry-original") => {
    const current = requireSession(mode !== "lookup");
    if (requested.recoveryCommandKey && pending()?.commandKey !== requested.recoveryCommandKey) throw new Error("原移除操作已处理，请关闭弹窗后核对当前奖励。");
    if (mode === "submit") {
      if (!baselineReady) throw new Error("请先成功重新读取会员等级。");
      const error = f1PolicyInputError(editor, values, ctx.voucherOptions, ctx.skuOptions);
      if (error) throw new Error(error);
    }
    const previous = pending();
    if (mode !== "submit") ctx.invalidateF1();
    let result;
    try { result = await submitF1Policy(current, editor, values, reason, mode); }
    catch (error) {
      const failure = error as { httpStatus?: number; apiCode?: number; backendMessage?: string };
      const locked = failure.backendMessage === "OBJECT_LOCKED_BY_A2" || failure.backendMessage === "OBJECT_ALREADY_PENDING";
      if (previous && !pending()) {
        onClose();
        await ctx.refreshF1();
      } else if (pending()) {
        setOpening({ pending: pending(), error: undefined });
      } else if (!previous && isDeterministicRejection(failure.httpStatus ?? 0, failure.apiCode)) {
        // A first rejected write has no retained command. Rebase the open dialog,
        // including reward valuation and the revision used by a later proposal.
        setBaselineReady(false);
        setBaselineRevision(value => value + 1);
        ctx.invalidateF1();
        const active = await fetchF1VRankOverview().catch(() => null);
        requireSession(false);
        const row = active?.rows.find(item => item.v === editor.row.v);
        const reward = editor.reward && active?.rewards[editor.row.v]?.find(item => item.id === editor.reward!.id);
        if (active && row && (!editor.reward || reward)) {
          setBaseline({ ...editor, row, reward, valuation: active.rewardValuationUsdtPerUvt, approvalRequired: false });
          ctx.acceptF1PolicyOverview(active);
          setBaselineReady(true);
          // 读回的值或估值变了：后端那句拒绝是按旧值说的，换成现状（数字在「刚被改过」那一行）。没变就照旧给后端的原因。
          const rewardKey = (item?: typeof reward) => item ? JSON.stringify([item.type, item.amountText, item.voucherId, item.skuId, item.custom]) : "";
          const moved = isCondition ? (editor.row[editor.field!] ?? "") !== (row[editor.field!] ?? "")
            : rewardKey(editor.reward) !== rewardKey(reward || undefined) || editor.valuation !== active.rewardValuationUsdtPerUvt;
          if (moved && !locked) throw new Error(REBASED);
          const reread = REREAD[failure.backendMessage ?? ""];
          if (reread) throw Object.assign(new Error(reread), { httpStatus: failure.httpStatus, apiCode: failure.apiCode });
        } else {
          // Keep the existing read-failure lock; neither direction nor submission
          // may use the rejected snapshot if its replacement could not be read.
          ctx.invalidateF1("请先成功重新读取会员等级。");
        }
      }
      if (locked) throw Object.assign(new Error(LOCKED), { httpStatus: failure.httpStatus, apiCode: failure.apiCode });
      throw error;
    } finally { onPendingChange(); }
    if (!result) return false;
    requireSession(false);
    if (result.active) ctx.acceptF1PolicyOverview(result.active);
    else ctx.invalidateF1(`${result.acknowledgement}；当前配置暂时读不到，重新读取后再发起新修改。`);
    ctx.toast(result.acknowledgement);
    if (!result.resolved) throw new A2OutcomeUncertainError(result.acknowledgement, previous!.commandKey);
    onClose();
    return true;
  };
  const fields: Extract<BusinessFormSpec, { kind: "multi-field" }>["fields"] = isCondition
    ? [{ key: "value", label: fieldLabel, current: form.value, inputKind: "text" }]
    : remove ? [] : [
      { key: "rtype", label: "奖励类型", current: form.rtype, inputKind: "select", options: Object.keys(typeLabels) },
      { key: "amount", label: "奖励金额", current: form.amount, required: false },
      { key: "voucherId", label: "券", current: form.voucherId, required: false },
      { key: "skuId", label: "商品", current: form.skuId, required: false },
      { key: "custom", label: "自定义奖品", current: form.custom, required: false },
    ];
  const businessForm: BusinessFormSpec = {
    kind: "multi-field", fields,
    amplifies: (values) => baselineReady && f1PolicyNeedsApproval(editor, values),
    feedback: (values) => {
      const error = f1PolicyInputError(editor, values, ctx.voucherOptions, ctx.skuOptions);
      return { message: error ?? "", invalid: !!error };
    },
  };
  const afterRewardLabel = (values: BusinessFormValue) => f1RewardPolicyLabel({
    id: "", type: values.rtype as OpsVRankRewardItem["type"], amountText: values.amount,
    voucherId: values.voucherId, skuId: values.skuId, custom: values.custom,
  }, ctx);

  // 相邻等级的同一项：保序（directRefs 除外）在相邻有效值之间，写给运营对着看。
  const rows = ctx.vrankRows;
  const index = rows.findIndex((row) => row.v === editor.row.v);
  const neighbor = (offset: number) => {
    const row = rows[index + offset];
    if (!row || !isCondition) return undefined;
    const raw = row[editor.field!];
    return raw === undefined ? undefined : `${row.v} ${valueLabel(raw)}`;
  };
  const prev = neighbor(-1), next = neighbor(1);
  // 门槛：填了改动后，生效标签跟方向变（VS-106）：放宽要批准，收紧立即生效。只改显示，判断用 f1PolicyNeedsApproval，提交路径不变。
  const conditionEffect = (values: BusinessFormValue) => {
    const text = (values.value ?? "").trim();
    if (!baselineReady || !text || text === (editor.row[editor.field!] ?? "") || f1PolicyInputError(editor, values, ctx.voucherOptions, ctx.skuOptions)) return effect;
    return f1PolicyNeedsApproval(editor, values)
      ? <StatusTag tone="progress" filled icon={Clock3}>批准后生效</StatusTag>
      : <StatusTag tone="progress" filled icon={Zap}>立即生效</StatusTag>;
  };
  const effect = opening.pending
    ? <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，可能已经生效或已建审批单。可以查询原结果；24 小时内也可以按原请求重试，不会重复执行。">结果未知</StatusTag>
    : remove ? <StatusTag tone="progress" filled icon={Zap}>立即生效</StatusTag>
      : <StatusTag tone="neutral" icon={LockOpen} explain={isCondition
        ? `调低是放宽：提交审批，${SUPER_APPROVER}（需有审批批准权限）批准后才生效，你自己不能批。调高或不变是收紧：确认后立即生效。`
        : `增加资金奖励（加金额、改成资金、按 UVT 现价折算后变多）要提交审批，${SUPER_APPROVER}（需有审批批准权限）批准后才生效。其余改动确认后立即生效。`}>
        {isCondition ? "调低要批准 · 调高立即生效" : "增加资金要批准 · 其余立即生效"}</StatusTag>;
  // 第一次被拒后已按重读的当前值重算：值或估值变了时说一句，免得运营以为还是打开时的值（红色那句是按旧值判断的）。
  const withUnit = (raw: string) => `${valueLabel(raw)}${UNIT[condition] ? ` ${UNIT[condition]}` : ""}`;
  const changes = !opening.pending && baselineReady && baselineRevision > 0 ? isCondition
    ? [(requested.row[editor.field!] ?? "") !== (editor.row[editor.field!] ?? "") && `打开时 ${withUnit(requested.row[editor.field!] ?? "")}，现在 ${withUnit(editor.row[editor.field!] ?? "")}`]
    : [requested.reward && editor.reward && f1RewardPolicyLabel(requested.reward, ctx) !== currentLabel && `打开时 ${f1RewardPolicyLabel(requested.reward, ctx)}，现在 ${currentLabel}`,
      requested.valuation !== editor.valuation && `UVT 估值 ${requested.valuation ?? "—"} → ${editor.valuation ?? "—"} USDT`] : [];
  const rebased = changes.filter(Boolean).join("；");
  const facts = <Facts>
    {rebased && <Fact k="刚被改过" tone="warn"><KeepText text={rebased} /></Fact>}
    {!isCondition && <Fact k={remove ? "要移除的奖励" : editor.reward ? "现在的奖励" : "等级"}>{editor.reward ? currentLabel : `${editor.row.v} · 现在 ${(ctx.rewards[editor.row.v] ?? []).length} 项奖励`}</Fact>}
    {isCondition && (prev || next) && <Fact k="相邻等级">{[prev, next].filter(Boolean).join(" · ")}</Fact>}
    {opening.pending && <Fact k="原操作提交于">{businessStamp(opening.pending.createdAt)}（{businessZone().label}）</Fact>}
    {pendingApproval && !opening.pending && <Fact k="待审批的申请" tone="warn">这一级有申请在等审批，现在保存或提交审批都会被拒；等它批准、驳回或撤回后再改</Fact>}
  </Facts>;
  const statedBrief = isCondition
    ? (values: BusinessFormValue) => ({ impact: `${baselineReady && f1PolicyNeedsApproval(editor, values) ? `${SUPER_APPROVER}批准后` : "确认后"}，之后的评估按新值算；不重算已有等级，不补发、不收回历史奖励。`, check: "核对新值和相邻等级；理由写清依据或工单号。" })
    : remove ? { impact: "移除后，升到这一级不再发这一项；已经发出的不收回，发放记录保留。", check: "核对要移除的是哪一项；理由写清依据或工单号。" }
      : { impact: "改的是升级时发什么，只影响以后的发放；已经发出的奖励和账本不变。", check: "核对奖励类型和金额或名字；理由写清依据或工单号。" };

  return <OperationConfirmModal
    briefKind="config"
    icon={isCondition ? "sliders" : undefined}
    action={action}
    title={title}
    effect={isCondition && !opening.pending ? conditionEffect : effect}
    facts={facts}
    statedBrief={statedBrief}
    confirmLabel={remove ? "确认移除" : "确认修改"}
    confirmLabelForValue={isCondition ? (_value, values) => values && baselineReady && f1PolicyNeedsApproval(editor, values) ? "提交审批" : "确认修改" : undefined}
    detail={isCondition ? `当前${fieldLabel}为 ${currentLabel}。修改只影响后续晋升评估，已晋升的记录保留。`
      : remove ? `移除奖励「${currentLabel}」后停止后续发放，已发奖励与账本记录保留。`
      : `当前奖励：${currentLabel}。修改奖励模板，后续发放使用新值；已发奖励与账本记录保留。`}
    coverage={ctx.f1Coverage}
    coverageLead={isCondition ? "放宽晋升条件会让更多人升级、拿到晋级奖励" : "增加资金奖励会让平台多付钱"}
    businessForm={businessForm}
    businessFormRevision={baselineRevision}
    getPendingReason={() => pending()?.original.reason}
    getPendingBusinessValue={() => pending()?.original.form}
    inlineApproval={{
      dialogClassName: "f1-policy-confirm",
      pending: !!opening.pending,
      initialRecovery: "retry",
      expired: !!opening.pending && opening.pending.expiresAt <= Date.now(),
      expiredRequestRecovery: opening.pending && opening.pending.expiresAt <= Date.now() ? "query" : undefined,
      disabledReason,
      resolve: (values) => !isCondition && baselineReady && f1PolicyNeedsApproval(editor, values) ? {
        heading: isCondition ? "放宽晋升条件 · 批准后生效" : "增加资金奖励 · 批准后生效",
        disabledReason: ctx.f1Coverage && ctx.f1Coverage.coverageRatio < ctx.f1Coverage.redlinePct ? "当前兑付覆盖率低于红线，暂时无法提交审批。" : undefined,
        completionCopy: isCondition
          ? `${SUPER_APPROVER}（需有审批批准权限）批准前继续使用当前条件。提交和批准时检查兑付覆盖率，批准后从之后的评估使用新值。`
          : `${SUPER_APPROVER}（需有审批批准权限）批准前继续使用当前奖励模板。提交和批准时检查兑付覆盖率，批准后之后的发放使用新值。`,
        comparison: isCondition ? undefined : <div className="f1-policy-comparison">
          <Facts><Fact k={fieldLabel}><Change from={currentLabel} to={isF1FundReward(values.rtype) && !(values.amount ?? "").trim() ? `${values.rtype.toUpperCase()} · 金额还没填` : afterRewardLabel(values)} /></Fact></Facts>
          {!isCondition && isF1FundReward(editor.reward?.type) && isF1FundReward(values.rtype) && editor.reward!.type !== values.rtype
            && <p className="f1-policy-note">换币种按现在的 UVT 价格精确折算，提交和批准时各重新判断一次是否变多。</p>}
        </div>,
      } : undefined,
      recover: (reason, values) => submit(reason, values, "lookup"),
      retry: async () => { await submit("", {}, "retry-original"); },
      renderForm: (values, change, locked) => {
        if (remove && opening.pending) return <Notice tone="warn" title="原请求结果未知">内容和理由已锁定，只能查询原结果或按原内容重试。</Notice>;
        const changeField = (key: string, value: string) => change({ ...values, [key]: value });
        const inputError = f1PolicyInputError(editor, values, ctx.voucherOptions, ctx.skuOptions);
        const loosen = f1PolicyNeedsApproval(editor, values);
        const option = (key: string, label: string, options: string[], labels: Record<string, string>) => <Field label={label} required>
          {(control) => <Select {...control} aria-label={label} value={values[key] ?? ""} disabled={locked} placeholder="请选择" onChange={(value) => changeField(key, value)}
            options={[
              ...(values[key] && !options.includes(values[key]) ? [{ value: values[key], label: "当前选项不可用，请重新选择", disabled: true }] : []),
              ...options.map((item) => ({ value: item, label: labels[item] ?? item })),
            ]} />}
        </Field>;
        if (isCondition) {
          const changed = (values.value ?? "").trim() !== "" && (values.value ?? "").trim() !== (editor.row[editor.field!] ?? "");
          const state = baselineReady && changed && !inputError ? loosen
            ? <StatusTag tone="warn" icon={LockOpen}>放宽</StatusTag>
            : <StatusTag tone="neutral" icon={Lock}>收紧</StatusTag> : undefined;
          return <>
            <DiffField before={currentLabel} unit={baselineReady ? UNIT[condition] : undefined} hint={editor.field === "legRank" ? "选比这一级低的等级，或者「未设置」" : RANGE[editor.field!]}
              state={state} error={(values.value ?? "").trim() !== "" ? inputError : undefined}
              note={editor.field === "legCount" || editor.field === "legRank" ? "人数为 0 时不看这一项；大于 0 时还要设好最低等级，否则判不满足。" : undefined}>
              {(control) => editor.field === "legRank"
                ? <Select {...control} aria-label={fieldLabel} value={values.value ?? ""} disabled={locked} onChange={(value) => changeField("value", value)}
                  options={["NONE", ...ctx.vrankRows.filter((row) => Number(row.v.slice(1)) < Number(editor.row.v.slice(1))).map((row) => row.v)].map((item) => ({ value: item, label: item === "NONE" ? "未设置" : item }))} />
                : <Input {...control} inputMode="numeric" value={values.value ?? ""} disabled={locked} onChange={(event) => changeField("value", event.target.value)} />}
            </DiffField>
          </>;
        }
        if (remove) return null;
        return <div className="rd-form-grid" data-cols="2" data-dense="">
          {option("rtype", "奖励类型", Object.keys(typeLabels), typeLabels)}
          {isF1FundReward(values.rtype) && <Field label={values.rtype === "usdt" ? "金额" : "数量"} required help={`${values.rtype === "usdt" ? "USDT" : "UVT"}，大于 0，最多 6 位小数`}
            error={(values.amount ?? "").trim() !== "" ? inputError : undefined}>
            <Input inputMode="decimal" value={values.amount ?? ""} disabled={locked} onChange={(event) => changeField("amount", event.target.value)} />
          </Field>}
          {values.rtype === "voucher" && option("voucherId", "券", ctx.voucherOptions, ctx.voucherLabels)}
          {values.rtype === "sku" && option("skuId", "商品", ctx.skuOptions, ctx.skuLabels)}
          {values.rtype === "custom" && <Field label="自定义奖品" required hint="写奖品名">
            <Input disabled={locked} value={values.custom ?? ""} onChange={(event) => changeField("custom", event.target.value)} />
          </Field>}
          {inputError && JSON.stringify(values) !== JSON.stringify(form) && <p className="rd-form-error f1-form-wide" role="alert">{inputError}</p>}
        </div>;
      },
    }}
    onClose={onClose}
    onConfirm={async (reason, _edit, values) => { await submit(reason, values ?? {}, requested.recoveryCommandKey || opening.pending || pending() ? "retry-original" : "submit"); }}
  />;
}
