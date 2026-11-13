"use client";

/**
 * F1 门槛和奖励模板的修改框（A01–A08）。
 * 提交、恢复、审批分支都在 lib/admin/f1-policy-change（submitF1Policy）里，和改版前一样；这里只管框里的样子：
 * 标题写动作和对象，标签写哪个方向要批准，事实写现在的值和相邻等级，填写项用 rd 的控件。
 */
import { useState } from "react";
import { CircleHelp, LockOpen, ShieldCheck, Zap } from "lucide-react";
import { Button, Change, DiffField, Fact, Facts, Field, Input, Notice, Select, StatusTag } from "@/app/components/rd";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { businessStamp } from "@/lib/admin/business-time";
import { OperationConfirmModal, type BusinessFormSpec, type BusinessFormValue } from "../design-kit";
import {
  f1ConditionLabels, f1PolicyInitialForm, f1PolicyInputError, f1PolicyNeedsApproval,
  formatF1ExactAmount, isF1FundReward, pendingF1Policy, pendingF1Removals, submitF1Policy, type F1PolicyEditor,
} from "@/lib/admin/f1-policy-change";
import type { OpsVRankRewardItem } from "@/lib/admin/platform-types";
import type { FViewCtx } from "./types";
import { SUPER_APPROVER, safeCustomLabel } from "./f1-shared";

const typeLabels = { usdt: "USDT（资金）", uvt: "UVT（资金）", voucher: "券", sku: "商品", custom: "自定义奖品" };
const valueLabel = (value: string) => value === "NONE" ? "未设置" : formatF1ExactAmount(value);
const UNIT: Record<string, string> = { selfBuy: "点", teamGv: "点", directRefs: "人", legCount: "个" };
const RANGE: Record<string, string> = { selfBuy: "0–9007199254740991 的整数", teamGv: "0–9007199254740991 的整数", directRefs: "0–2147483647 的整数", legCount: "0–2147483647 的整数" };

export function f1RewardPolicyLabel(item: OpsVRankRewardItem, ctx: Pick<FViewCtx, "voucherLabels" | "skuLabels">): string {
  if (isF1FundReward(item.type)) return item.amountText ? `${formatF1ExactAmount(item.amountText)} ${item.type.toUpperCase()}` : `${item.type.toUpperCase()} 金额暂不可用`;
  if (item.type === "voucher") return `券 · ${ctx.voucherLabels[item.voucherId ?? ""] ?? item.voucherId ?? "未设置"}`;
  if (item.type === "sku") return `商品 · ${ctx.skuLabels[item.skuId ?? ""] ?? item.skuId ?? "未设置"}`;
  return safeCustomLabel(item.custom);
}

/** Only the current actor's unresolved remove commands for this rank appear here. */
export function F1RemovalRecovery({ rank, onRecover }: { rank: string; onRecover: (editor: F1PolicyEditor) => void }) {
  const owner = useAdminAuth((state) => state.session?.adminId);
  if (owner === undefined) return null;
  let removals: ReturnType<typeof pendingF1Removals>;
  try { removals = pendingF1Removals(owner, rank); }
  catch { return <Notice tone="warn" title="原移除操作内容不完整">请到「操作记录与审批」核对。</Notice>; }
  const label = (reward: OpsVRankRewardItem | undefined) => !reward ? "奖励"
    : isF1FundReward(reward.type) ? `${formatF1ExactAmount(reward.amountText ?? "")} ${reward.type.toUpperCase()}`
      : reward.type === "voucher" ? `券 ${reward.voucherId ?? ""}` : reward.type === "sku" ? `商品 ${reward.skuId ?? ""}` : safeCustomLabel(reward.custom);
  return <>{removals.map(({ commandKey, createdAt, original }) => <Notice key={commandKey} tone="warn" title="移除奖励的结果未知"
    action={<Button size="sm" aria-label={`${rank} · 核对原操作`} onClick={() => {
      if (useAdminAuth.getState().session?.adminId !== owner) return;
      const current = pendingF1Policy(owner, original.editor);
      if (current?.commandKey === commandKey) onRecover({ ...original.editor, recoveryCommandKey: commandKey });
    }}>核对原操作</Button>}>
    移除「{label(original.editor.reward)}」，{businessStamp(createdAt)} 提交。这项奖励可能已经不在列表里了。
  </Notice>)}</>;
}

export function F1PolicyConfirm({ editor: requested, ctx, onClose, pendingApproval = false }: { editor: F1PolicyEditor; ctx: FViewCtx; onClose: () => void; pendingApproval?: boolean }) {
  const session = useAdminAuth((state) => state.session);
  const [owner] = useState(session?.adminId);
  const [opening] = useState(() => {
    try {
      const pending = owner === undefined ? undefined : pendingF1Policy(owner, requested);
      return { pending, error: requested.recoveryCommandKey && pending?.commandKey !== requested.recoveryCommandKey ? "原移除操作已处理，请关闭弹窗后核对当前奖励。" : undefined };
    }
    catch { return { pending: undefined, error: "原操作内容不完整，请到操作记录核对后处理。" }; }
  });
  const editor = opening.pending?.original.editor ?? requested;
  const form = opening.pending?.original.form ?? f1PolicyInitialForm(editor);
  const isCondition = editor.action === "threshold", remove = editor.action === "reward_remove";
  const fieldLabel = isCondition ? f1ConditionLabels[editor.field!] : "奖励";
  const currentLabel = isCondition ? valueLabel(editor.row[editor.field!] ?? "")
    : editor.reward ? f1RewardPolicyLabel(editor.reward, ctx) : "尚未配置";
  // 记进操作记录的名字，和改版前一样。
  const action = remove && opening.pending ? `${editor.row.v} · 核对原移除操作` : isCondition ? `调整 ${editor.row.v} 晋升条件 · ${fieldLabel}`
    : `${editor.row.v} · ${remove ? "移除奖励" : editor.action === "reward_add" ? "新增奖励" : "编辑奖励"}`;
  const title = opening.pending ? `${editor.row.v} 的原操作` : isCondition ? `调整 ${editor.row.v} 的${fieldLabel}`
    : remove ? `移除 ${editor.row.v} 的奖励` : editor.action === "reward_add" ? `给 ${editor.row.v} 添加奖励` : `编辑 ${editor.row.v} 的奖励`;
  const disabledReason = opening.error ?? (session?.adminId !== owner || !session?.authorities.includes("network_f1_write")
    ? "当前账号没有这项操作的权限，请关闭弹窗后重新核对。"
    : opening.pending && !opening.pending.original.approval && opening.pending.expiresAt <= Date.now()
      ? "原操作已过期，请到操作记录核对，勿重复提交。" : undefined);
  const pending = () => opening.error || owner === undefined ? undefined : pendingF1Policy(owner, editor);
  const requireSession = () => {
    const current = useAdminAuth.getState().session;
    if (!current || current.adminId !== owner || !current.authorities.includes("network_f1_write")) throw new Error("当前账号没有这项操作的权限，请关闭弹窗后重新核对。");
    return current;
  };
  const submit = async (reason: string, values: BusinessFormValue, mode: "submit" | "lookup" | "retry-original") => {
    const current = requireSession();
    if (requested.recoveryCommandKey && pending()?.commandKey !== requested.recoveryCommandKey) throw new Error("原移除操作已处理，请关闭弹窗后核对当前奖励。");
    if (mode === "submit") {
      const error = f1PolicyInputError(editor, values, ctx.voucherOptions, ctx.skuOptions);
      if (error) throw new Error(error);
    }
    const result = await submitF1Policy(current, editor, values, reason, mode);
    if (!result) return false;
    requireSession();
    ctx.acceptF1PolicyOverview(result.active);
    ctx.toast(result.acknowledgement);
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
    amplifies: (values) => f1PolicyNeedsApproval(editor, values),
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
  const effect = opening.pending
    ? <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，可能已经生效或已建审批单。可以查询原结果；24 小时内也可以按原内容重试，后端认得出是同一次提交。">结果未知</StatusTag>
    : remove ? <StatusTag tone="progress" filled icon={Zap}>立即生效</StatusTag>
      : <StatusTag tone="neutral" icon={LockOpen} explain={isCondition
        ? `调低是放宽：提交审批，${SUPER_APPROVER}（需有审批批准权限）批准后才生效，你自己不能批。调高或不变是收紧：确认后立即生效。`
        : `增加资金奖励（加金额、改成资金、按 UVT 现价折算后变多）要提交审批，${SUPER_APPROVER}（需有审批批准权限）批准后才生效。其余改动确认后立即生效。`}>
        {isCondition ? "调低要批准 · 调高立即生效" : "增加资金要批准 · 其余立即生效"}</StatusTag>;
  const facts = <Facts>
    {!isCondition && <Fact k={remove ? "要移除的奖励" : editor.reward ? "现在的奖励" : "等级"}>{editor.reward ? currentLabel : `${editor.row.v} · 现在 ${(ctx.rewards[editor.row.v] ?? []).length} 项奖励`}</Fact>}
    {isCondition && (prev || next) && <Fact k="相邻等级">{[prev, next].filter(Boolean).join(" · ")}</Fact>}
    {opening.pending && <Fact k="原操作提交于">{businessStamp(opening.pending.createdAt)}</Fact>}
    {pendingApproval && !opening.pending && <Fact k="待审批的申请" tone="warn">这一级有一张门槛或奖励的申请还没批；现在直接修改，那张申请批准时会因版本对不上失败</Fact>}
  </Facts>;
  const statedBrief = isCondition
    ? { impact: "保存后，之后每次评估用户时按新值算；不重算已有等级，不补发、不收回历史奖励。", check: "核对新值和相邻等级；理由写清依据或工单号。" }
    : remove ? { impact: "移除后，升到这一级不再发这一项；已经发出的不收回，发放记录保留。", check: "核对要移除的是哪一项；理由写清依据或工单号。" }
      : { impact: "改的是升级时发什么，只影响以后的发放；已经发出的奖励和账本不变。", check: "核对奖励类型和金额或名字；理由写清依据或工单号。" };

  return <OperationConfirmModal
    briefKind="config"
    action={action}
    title={title}
    effect={effect}
    facts={facts}
    statedBrief={statedBrief}
    confirmLabel={remove ? "确认移除" : "确认修改"}
    detail={isCondition ? `当前${fieldLabel}为 ${currentLabel}。修改只影响后续晋升评估，已晋升的记录保留。`
      : remove ? `移除奖励「${currentLabel}」后停止后续发放，已发奖励与账本记录保留。`
      : `当前奖励：${currentLabel}。修改奖励模板，后续发放使用新值；已发奖励与账本记录保留。`}
    coverage={ctx.f1Coverage}
    coverageLead={isCondition ? "放宽门槛会让更多人升级、拿到升级奖励" : "增加资金奖励会让平台多付钱"}
    businessForm={businessForm}
    getPendingReason={() => pending()?.original.reason}
    getPendingBusinessValue={() => pending()?.original.form}
    inlineApproval={{
      dialogClassName: "f1-policy-confirm",
      pending: opening.pending?.original.approval,
      expired: !!opening.pending && opening.pending.expiresAt <= Date.now(),
      disabledReason,
      resolve: (values) => f1PolicyNeedsApproval(editor, values) ? {
        heading: isCondition ? "放宽晋升条件 · 批准后生效" : "增加资金奖励 · 批准后生效",
        disabledReason: ctx.f1Coverage && ctx.f1Coverage.coverageRatio < ctx.f1Coverage.redlinePct ? "当前兑付覆盖率低于红线，暂时无法提交审批。" : undefined,
        completionCopy: isCondition
          ? `${SUPER_APPROVER}（需有审批批准权限）批准前继续使用当前条件。提交和批准时检查兑付覆盖率，批准后从之后的评估使用新值。`
          : `${SUPER_APPROVER}（需有审批批准权限）批准前继续使用当前奖励模板。提交和批准时检查兑付覆盖率，批准后之后的发放使用新值。`,
        comparison: isCondition ? undefined : <div className="f1-policy-comparison">
          <Facts><Fact k={fieldLabel}><Change from={currentLabel} to={isF1FundReward(values.rtype) && !(values.amount ?? "").trim() ? `${values.rtype.toUpperCase()} · 金额还没填` : afterRewardLabel(values)} /></Fact></Facts>
          {!isCondition && isF1FundReward(editor.reward?.type) && isF1FundReward(values.rtype) && editor.reward!.type !== values.rtype
            && <p className="f1-policy-note">换币种按 B1 现在的 UVT 价格精确折算，提交和批准时各重新判断一次是否变多。</p>}
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
          const state = changed && !inputError ? loosen
            ? <StatusTag tone="warn" icon={LockOpen}>放宽，要批准</StatusTag>
            : <StatusTag tone="neutral" icon={ShieldCheck}>收紧或不变，立即生效</StatusTag> : undefined;
          return <>
            <DiffField before={currentLabel} unit={UNIT[editor.field!]} hint={editor.field === "legRank" ? "选比这一级低的等级，或者「未设置」" : RANGE[editor.field!]}
              state={state} error={(values.value ?? "").trim() !== "" ? inputError : undefined}
              note={editor.field === "legCount" || editor.field === "legRank" ? "达标分支数为 0 时不看分支；大于 0 时要同时设好比这一级低的分支最低等级，否则这一项一律判不满足。" : undefined}>
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
          {isF1FundReward(values.rtype) && <Field label={values.rtype === "usdt" ? "金额" : "数量"} required hint={`${values.rtype === "usdt" ? "USDT" : "UVT"} · 大于 0，最多 6 位小数`}
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
    onConfirm={async (reason, _edit, values) => { await submit(reason, values ?? {}, requested.recoveryCommandKey || pending() ? "retry-original" : "submit"); }}
  />;
}
