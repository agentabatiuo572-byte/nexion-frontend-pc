"use client";

import { useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { Icon, OperationConfirmModal, type BusinessFormSpec, type BusinessFormValue } from "../design-kit";
import {
  f1ConditionLabels, f1PolicyInitialForm, f1PolicyInputError, f1PolicyNeedsApproval,
  formatF1ExactAmount, isF1FundReward, pendingF1Policy, pendingF1Removals, submitF1Policy, type F1PolicyEditor,
} from "@/lib/admin/f1-policy-change";
import type { OpsVRankRewardItem } from "@/lib/admin/platform-types";
import type { FViewCtx } from "./types";

const typeLabels = { usdt: "USDT 现金", uvt: "UVT 代币", voucher: "代金券", sku: "商品", custom: "自定义" };
const valueLabel = (value: string) => value === "NONE" ? "未设置" : formatF1ExactAmount(value);

export function f1RewardPolicyLabel(item: OpsVRankRewardItem, ctx: Pick<FViewCtx, "voucherLabels" | "skuLabels">): string {
  if (isF1FundReward(item.type)) return item.amountText ? `${formatF1ExactAmount(item.amountText)} ${item.type.toUpperCase()}` : `${item.type.toUpperCase()} 金额暂不可用`;
  if (item.type === "voucher") return `代金券 · ${ctx.voucherLabels[item.voucherId ?? ""] ?? item.voucherId ?? "未设置"}`;
  if (item.type === "sku") return `商品 · ${ctx.skuLabels[item.skuId ?? ""] ?? item.skuId ?? "未设置"}`;
  return item.custom ?? "自定义";
}

/** Only the current actor's unresolved remove commands for this rank appear here. */
export function F1RemovalRecovery({ rank, onRecover }: { rank: string; onRecover: (editor: F1PolicyEditor) => void }) {
  const owner = useAdminAuth((state) => state.session?.adminId);
  if (owner === undefined) return null;
  let removals: ReturnType<typeof pendingF1Removals>;
  try { removals = pendingF1Removals(owner, rank); }
  catch { return <p className="f1-policy-note" role="alert">原移除操作内容不完整，请到操作记录核对。</p>; }
  return <>{removals.map(({ commandKey, original }) => <div key={commandKey} className="alertbar warn f1-removal-recovery" role="status">
    <Icon name="alert" size={17} /><span>移除奖励结果待核对</span>
    <button type="button" className="fbtn" aria-label={`${rank} · 核对原操作`} onClick={() => {
      if (useAdminAuth.getState().session?.adminId !== owner) return;
      const current = pendingF1Policy(owner, original.editor);
      if (current?.commandKey === commandKey) onRecover({ ...original.editor, recoveryCommandKey: commandKey });
    }}>核对原操作</button>
  </div>)}</>;
}

export function F1PolicyConfirm({ editor: requested, ctx, onClose }: { editor: F1PolicyEditor; ctx: FViewCtx; onClose: () => void }) {
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
  const title = remove && opening.pending ? `${editor.row.v} · 核对原移除操作` : isCondition ? `调整 ${editor.row.v} 晋升条件 · ${fieldLabel}`
    : `${editor.row.v} · ${remove ? "移除奖励" : editor.action === "reward_add" ? "新增奖励" : "编辑奖励"}`;
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
      { key: "voucherId", label: "代金券", current: form.voucherId, required: false },
      { key: "skuId", label: "商品", current: form.skuId, required: false },
      { key: "custom", label: "自定义奖励内容", current: form.custom, required: false },
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
  return <OperationConfirmModal
    briefKind="config"
    action={title}
    detail={isCondition ? `当前${fieldLabel}为 ${currentLabel}。修改只影响后续晋升评估，已晋升的记录保留。`
      : remove ? `移除奖励「${currentLabel}」后停止后续发放，已发奖励与账本记录保留。`
      : `当前奖励：${currentLabel}。修改奖励模板，后续发放使用新值；已发奖励与账本记录保留。`}
    coverage={ctx.f1Coverage}
    businessForm={businessForm}
    getPendingReason={() => pending()?.original.reason}
    getPendingBusinessValue={() => pending()?.original.form}
    completionCopy={isCondition ? "填写理由后保存，下一轮评估使用新值；放宽条件须经另一位超管批准。" : remove ? "填写理由后移除模板，历史发放记录保留。" : "收紧、等值或非资金修改填写理由后即时保存；增加资金奖励须经另一位超管批准。"}
    inlineApproval={{
      dialogClassName: "team-fund-confirm f1-policy-confirm",
      pending: opening.pending?.original.approval,
      expired: !!opening.pending && opening.pending.expiresAt <= Date.now(),
      disabledReason,
      resolve: (values) => f1PolicyNeedsApproval(editor, values) ? {
        heading: isCondition ? "放宽晋升条件 · 批准后生效" : "增加资金奖励 · 批准后生效",
        disabledReason: ctx.f1Coverage && ctx.f1Coverage.coverageRatio < ctx.f1Coverage.redlinePct ? "当前兑付覆盖率低于红线，暂时无法提交审批。" : undefined,
        completionCopy: isCondition
          ? "另一位有审批权的超管批准前继续使用当前条件。提交和批准时检查兑付覆盖率，批准后从后续评估使用新值。"
          : "另一位有审批权的超管批准前继续使用当前奖励模板。提交和批准时检查兑付覆盖率，批准后后续发放使用新值。",
        comparison: <div className="f1-policy-comparison">
          <table className="tbl" aria-label={isCondition ? "晋升条件变更对比" : "奖励模板变更对比"}>
            <thead><tr><th scope="col">{isCondition ? "条件" : "奖励"}</th><th scope="col">当前</th><th scope="col">拟调整</th></tr></thead>
            <tbody><tr><th scope="row">{fieldLabel}</th><td>{currentLabel}</td><td>{isCondition ? valueLabel(values.value ?? "") : afterRewardLabel(values)}</td></tr></tbody>
          </table>
          {!isCondition && isF1FundReward(editor.reward?.type) && isF1FundReward(values.rtype) && editor.reward!.type !== values.rtype && <p className="tiny">币种切换按 B1 当前 UVT 价格精确估值，提交和批准时重新判断资金方向。</p>}
        </div>,
      } : undefined,
      recover: (reason, values) => submit(reason, values, "lookup"),
      retry: async () => { await submit("", {}, "retry-original"); },
      renderForm: (values, change, locked) => {
        if (remove && opening.pending) return <>
          <div className="alertbar warn f1-removal-confirm-note" role="status"><Icon name="alert" size={17} /><span>原请求结果待确认。参数与理由已锁定，只能按原命令重试。</span></div>
          <div className="field"><label htmlFor="f1-removal-original-reward">原奖励</label><input className="fld" id="f1-removal-original-reward" readOnly value={`${currentLabel} → 移除`} /></div>
          <div className="field"><label htmlFor="f1-removal-original-command">原请求编号</label><input className="fld" id="f1-removal-original-command" readOnly value={opening.pending.commandKey} /></div>
        </>;
        const changeField = (key: string, value: string) => change({ ...values, [key]: value });
        const inputError = f1PolicyInputError(editor, values, ctx.voucherOptions, ctx.skuOptions);
        const select = (key: string, label: string, options: string[], labels: Record<string, string>) => <div className="field">
          <label htmlFor={`f1-policy-${key}`}>{label}</label>
          <select className="fld" id={`f1-policy-${key}`} value={values[key] ?? ""} disabled={locked} onChange={(event) => changeField(key, event.target.value)}>
            <option value="" disabled>请选择</option>
            {values[key] && !options.includes(values[key]) && <option value={values[key]} disabled>当前选项不可用，请重新选择</option>}
            {options.map((option) => <option key={option} value={option}>{labels[option] ?? option}</option>)}
          </select>
        </div>;
        const input = (key: string, label: string) => <div className="field">
          <label htmlFor={`f1-policy-${key}`}>{label}</label>
          <input className="fld" id={`f1-policy-${key}`} inputMode={key === "amount" ? "decimal" : "numeric"}
            value={values[key] ?? ""} disabled={locked} onChange={(event) => changeField(key, event.target.value)} />
        </div>;
        return <>
          {isCondition ? editor.field === "legRank"
            ? select("value", fieldLabel, ["NONE", ...ctx.vrankRows.filter((row) => Number(row.v.slice(1)) < Number(editor.row.v.slice(1))).map((row) => row.v)], { NONE: "未设置" })
            : input("value", fieldLabel)
            : !remove && <>
              {select("rtype", "奖励类型", Object.keys(typeLabels), typeLabels)}
              {isF1FundReward(values.rtype) && input("amount", values.rtype === "usdt" ? "金额(USDT)" : "数量(UVT)")}
              {values.rtype === "voucher" && select("voucherId", "选择代金券", ctx.voucherOptions, ctx.voucherLabels)}
              {values.rtype === "sku" && select("skuId", "选择商品", ctx.skuOptions, ctx.skuLabels)}
              {values.rtype === "custom" && <div className="field"><label htmlFor="f1-policy-custom">自定义奖励内容</label><input className="fld" id="f1-policy-custom" disabled={locked} value={values.custom ?? ""} onChange={(event) => changeField("custom", event.target.value)} /></div>}
            </>}
          {isCondition && (editor.field === "legCount" || editor.field === "legRank") && <p className="f1-policy-note">分支数为 0 时不启用分支条件；大于 0 时须同时设置低于当前等级的分支最低等级。</p>}
          {inputError && <p className="f1-policy-note" role="alert">{inputError}</p>}
        </>;
      },
    }}
    onClose={onClose}
    onConfirm={async (reason, _edit, values) => { await submit(reason, values ?? {}, requested.recoveryCommandKey || pending() ? "retry-original" : "submit"); }}
  />;
}
