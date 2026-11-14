import { A2OutcomeUncertainError, createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError, type A2OperationRow } from "./a2-client";
import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";
import { fetchF1VRankOverview, writeF1VRankPolicy, type F1VRankRow } from "./f1-client";
import { isF1OutcomeUncertainError } from "./f1-stable-write";
import { isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection } from "./outcome-classification";
import { findHighOp } from "./high-ops-registry";
import { roleLabel } from "@/lib/nav/console-nav";
import { useAdminAuth, type AdminSession } from "@/lib/store/admin-auth";
import type { OpsVRankRewardItem, VRankRewardType } from "./platform-types";

export type F1ConditionField = "selfBuy" | "teamGv" | "directRefs" | "legCount" | "legRank";
export type F1PolicyAction = "threshold" | "reward_add" | "reward_update" | "reward_remove";
export type F1PolicyForm = Record<string, string>;
export type F1PolicyReward = { type: VRankRewardType; amount?: string; voucherId?: string; skuId?: string; custom?: string };
export type F1PolicyValues = {
  rank: string; expectedRevision: string; action: F1PolicyAction;
  field?: F1ConditionField; value?: string; rewardId?: string; reward?: F1PolicyReward;
};
export type F1PolicyEditor = {
  row: F1VRankRow; action: F1PolicyAction; field?: F1ConditionField;
  reward?: OpsVRankRewardItem; valuation: string | null;
  recoveryCommandKey?: string;
  approvalRequired?: boolean;
};
type OriginalCommand = {
  editor: F1PolicyEditor; form: F1PolicyForm; values: F1PolicyValues; reason: string; operator: string;
  approval: boolean; proposal?: Parameters<typeof createA2OperationProposal>[0];
};

export type F1PolicyRecord = PendingMutationRecord & { input: string; ticket?: A2OperationRow; received?: boolean; absent?: boolean };
const attempts = createPendingMutationStore<F1PolicyRecord>({
  storageKey: "nexion-admin-f1-policy-commands-v1", retainExpiredRecords: true,
  isValidRecord: (record) => typeof record.input === "string",
});
const MONEY = /^(0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
const DECIMAL = /^(0|[1-9]\d*)(?:\.\d+)?$/;
const ZERO = BigInt(0);
const SCALE = BigInt(1000000);

function amountUnits(value: string): bigint | null {
  if (!MONEY.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
}
export const formatF1ExactAmount = (value: string) => value.replace(/^\d+/, (whole) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
export const isF1FundReward = (type: string | undefined) => type === "usdt" || type === "uvt";
export const f1ConditionLabels: Record<F1ConditionField, string> = {
  selfBuy: "自购算力点", teamGv: "团队算力点", directRefs: "直接邀请人数", legCount: "达标分支数", legRank: "分支最低等级",
};

export function f1PolicyInitialForm(editor: F1PolicyEditor): F1PolicyForm {
  if (editor.action === "threshold") return { value: editor.row[editor.field!] ?? "" };
  const reward = editor.reward;
  return { rtype: reward?.type ?? "uvt", amount: reward?.amountText ?? "", voucherId: reward?.voucherId ?? "", skuId: reward?.skuId ?? "", custom: reward?.custom ?? "" };
}

export function f1PolicyInputError(editor: F1PolicyEditor, form: F1PolicyForm, voucherOptions: string[], skuOptions: string[]): string | undefined {
  if (!editor.row.policyRevision || !/^[0-9a-f]{64}$/.test(editor.row.policyRevision)) return "当前等级版本不可用，请关闭弹窗并重新加载。";
  if (editor.action === "reward_remove") return undefined;
  if (editor.action === "threshold") {
    const value = form.value?.trim() ?? "";
    if (editor.field === "legRank") {
      if (value !== "NONE" && (!/^V[0-8]$/.test(value) || Number(value.slice(1)) >= Number(editor.row.v.slice(1)))) return "分支等级须低于当前等级。";
    } else {
      const max = editor.field === "selfBuy" || editor.field === "teamGv" ? BigInt("9007199254740991") : BigInt("2147483647");
      if (!/^(0|[1-9]\d*)$/.test(value) || BigInt(value) > max) return `请输入 0–${max} 的整数。`;
    }
    return undefined;
  }
  if (!["usdt", "uvt", "voucher", "sku", "custom"].includes(form.rtype)) return "请选择奖励类型。";
  if (isF1FundReward(form.rtype)) {
    const amount = amountUnits(form.amount?.trim() ?? "");
    if (amount === null || amount <= ZERO) return "金额须大于 0，整数最多 12 位，小数最多 6 位。";
    if (isF1FundReward(editor.reward?.type) && amountUnits(editor.reward?.amountText ?? "") === null) return "当前奖励精确金额不可用，请重新加载。";
    if (isF1FundReward(editor.reward?.type) && (amountUnits(editor.reward?.amountText ?? "") ?? ZERO) > ZERO && editor.reward!.type !== form.rtype
      && (!editor.valuation || !DECIMAL.test(editor.valuation) || !/[1-9]/.test(editor.valuation))) return "UVT 估值价格暂不可用，无法切换资金币种。请重新加载后再试。";
  }
  if (form.rtype === "voucher" && !voucherOptions.includes(form.voucherId)) return "当前代金券不可用，请重新选择。";
  if (form.rtype === "sku" && !skuOptions.includes(form.skuId)) return "当前商品不可用，请重新选择。";
  if (form.rtype === "custom" && !form.custom?.trim()) return "请填写自定义奖励内容。";
  return undefined;
}

/** Mirrors the server's direction only; proposal and checker both re-evaluate authoritative B1 facts. */
export function f1PolicyNeedsApproval(editor: F1PolicyEditor, form: F1PolicyForm): boolean {
  if (editor.action === "reward_remove") return false;
  if (editor.approvalRequired) return true;
  if (editor.action === "threshold") {
    const field = editor.field!, oldValue = editor.row[field] ?? "", proposed = form.value?.trim() ?? "";
    if (field !== "legCount" && field !== "legRank") {
      return /^\d+$/.test(proposed) && /^\d+$/.test(oldValue) && BigInt(proposed) < BigInt(oldValue);
    }
    const oldCount = BigInt(editor.row.legCount ?? "0");
    const newCount = field === "legCount" && /^\d+$/.test(proposed) ? BigInt(proposed) : oldCount;
    if (oldCount === ZERO) return false;
    if (newCount === ZERO) return true;
    const oldRank = editor.row.legRank ?? "NONE", newRank = field === "legRank" ? proposed : oldRank;
    if (!/^V[0-8]$/.test(newRank)) return false;
    return !/^V[0-8]$/.test(oldRank) || newCount < oldCount || Number(newRank.slice(1)) < Number(oldRank.slice(1));
  }
  if (!isF1FundReward(form.rtype)) return false;
  if (!isF1FundReward(editor.reward?.type)) return true;
  const before = amountUnits(editor.reward?.amountText ?? ""), after = amountUnits(form.amount?.trim() ?? "");
  if (before === null || after === null) return false;
  if (before === ZERO) return true;
  if (editor.reward!.type === form.rtype) return after > before;
  const price = editor.valuation;
  if (!price || !DECIMAL.test(price)) return false;
  const [whole, fraction = ""] = price.split(".");
  const coefficient = BigInt(whole + fraction), rateScale = BigInt(10) ** BigInt(fraction.length);
  const oldUsdt = before * (editor.reward!.type === "uvt" ? coefficient : rateScale);
  const newUsdt = after * (form.rtype === "uvt" ? coefficient : rateScale);
  return newUsdt > oldUsdt;
}

function slot(owner: number, editor: F1PolicyEditor) {
  return `${owner}:F1:${editor.row.v}:${editor.action}:${editor.field ?? editor.reward?.id ?? "new"}`;
}
function originalF1Policy(owner: number, record: F1PolicyRecord) {
  const original = JSON.parse(record.input) as OriginalCommand;
  if (!original.editor || slot(owner, original.editor) !== record.fingerprint || typeof original.reason !== "string"
    || !original.form || !original.values || typeof original.approval !== "boolean" || typeof original.operator !== "string"
    || original.values.rank !== original.editor.row.v || original.values.action !== original.editor.action
    || original.values.field !== original.editor.field || original.values.rewardId !== original.editor.reward?.id
    || original.approval && !original.proposal) throw new Error("原操作内容不完整，请到操作记录核对后处理。");
  return { ...record, original };
}
export function listF1PolicyOperations(owner: number) {
  return attempts.list().filter(record => record.fingerprint.startsWith(`${owner}:F1:`)).map(record => originalF1Policy(owner, record));
}
export function pendingF1Policy(owner: number, editor: F1PolicyEditor) {
  const record = attempts.list().find((item) => !item.ticket && item.fingerprint === slot(owner, editor));
  return record ? originalF1Policy(owner, record) : undefined;
}
export function pendingF1Removals(owner: number, rank: string) {
  return attempts.list().filter((record) => record.fingerprint.startsWith(`${owner}:F1:${rank}:reward_remove:`))
    .map((record) => {
      const original = originalF1Policy(owner, record);
      if (!original.original.values.rewardId || original.original.approval) throw new Error("原移除操作内容不完整，请到操作记录核对。");
      return original;
    });
}
export async function submitF1Policy(
  session: AdminSession, editor: F1PolicyEditor, form: F1PolicyForm, reason: string,
  mode: "submit" | "lookup" | "retry-original" = "submit",
) {
  const fingerprint = slot(session.adminId, editor);
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== session.adminId) throw new Error("ADMIN_PERMISSION_DENIED");
  if (mode !== "lookup" && !auth.session.authorities.includes("network_f1_write")) throw new Error("ADMIN_PERMISSION_DENIED");
  const records = listF1PolicyOperations(session.adminId).filter(item => item.fingerprint === fingerprint);
  let previous = editor.recoveryCommandKey ? records.find(item => item.commandKey === editor.recoveryCommandKey) : records.find(item => !item.ticket) ?? records[0];
  if (mode !== "submit" && !previous) throw new Error("原操作已处理，请关闭弹窗并刷新后再操作。");
  const unresolved = listF1PolicyOperations(session.adminId).find(item => !item.ticket && item.original.values.rank === editor.row.v);
  if (mode === "submit" && unresolved) throw new A2OutcomeUncertainError("这一级有结果未知的原操作，请先查询原结果。", unresolved.commandKey);
  if (previous?.ticket && mode === "submit" && f1PolicyNeedsApproval(editor, form)) throw new A2OutcomeUncertainError("这一级已有待审批申请，请先核对原申请。", previous.commandKey);
  if (previous && !previous.ticket && mode === "submit") throw new A2OutcomeUncertainError("原操作尚未确认，请按原内容核对。", previous.commandKey);
  if (mode === "submit" && previous?.ticket) previous = undefined;
  let original = previous?.original;
  const key = previous?.commandKey ?? createA2CommandKey("f1-rank-policy");
  if (!original) {
    const reward: F1PolicyReward = {
      type: form.rtype as VRankRewardType,
      ...(isF1FundReward(form.rtype) ? { amount: form.amount.trim() } : {}),
      ...(form.rtype === "voucher" ? { voucherId: form.voucherId } : {}),
      ...(form.rtype === "sku" ? { skuId: form.skuId } : {}),
      ...(form.rtype === "custom" ? { custom: form.custom.trim() } : {}),
    };
    const values: F1PolicyValues = {
      rank: editor.row.v, expectedRevision: editor.row.policyRevision!, action: editor.action,
      ...(editor.action === "threshold" ? { field: editor.field, value: form.value.trim() } : {}),
      ...(editor.reward ? { rewardId: editor.reward.id } : {}),
      ...(editor.action === "reward_add" || editor.action === "reward_update" ? { reward } : {}),
    };
    const approval = f1PolicyNeedsApproval(editor, form), operator = session.operator || session.username;
    original = { editor, form, values, reason, operator, approval };
    if (approval) {
      const definition = findHighOp("f1_rank_policy_change")!;
      original.proposal = {
        action: definition.action, obj: values.rank, beforeValue: "—", afterValue: "—", operator,
        operatorRole: roleLabel(session.role), type: "fund", amplifies: true, sos: false,
        roleGate: "超管", reason, sourceDomain: "F1", command: definition.buildCommand({ values }),
        target: definition.buildTarget({ rank: values.rank }),
      };
    }
    attempts.remember(fingerprint, key, { input: JSON.stringify(original) });
    if (!attempts.isDurablyStored(fingerprint, key)) {
      attempts.forget(fingerprint, key);
      throw new Error("浏览器无法保存原操作，请允许会话存储后重试。");
    }
  }
  const record = () => attempts.list().find(item => item.commandKey === key)!;
  let posting = false;
  let acknowledgement: string;
  try {
    if (original.approval) {
      let ticket;
      if (previous || mode === "lookup") {
        // Clear stale observations before a fresh authoritative query.
        attempts.remember(fingerprint, key, { ...record(), ticket: undefined, absent: false });
        ticket = await fetchA2ProposalByKey(key, true, true);
        if (!ticket) attempts.remember(fingerprint, key, { ...record(), ticket: undefined, absent: true });
      }
      if (mode === "lookup" && !ticket) return null;
      if (!ticket && previous?.received) throw new A2OutcomeUncertainError("原申请建过单，批没批准还没查到，请继续查询。", key);
      if (!ticket && previous && previous.expiresAt <= Date.now()) throw new A2OutcomeUncertainError("原操作已过期且暂未查到结果，请到操作记录核对，勿重复提交。", key);
      if (!ticket) {
        posting = true;
        ticket = await createA2OperationProposal(original.proposal!, key, "proposal");
        posting = false;
        attempts.remember(fingerprint, key, { ...record(), received: true });
        // The receipt is historical on replay; always query its current status.
        ticket = await fetchA2ProposalByKey(key, true, true);
        if (!ticket) throw new A2OutcomeUncertainError("原申请建过单，批没批准还没查到，请继续查询。", key);
      }
      if (!ticket.mine || ticket.obj !== original.values.rank || ticket.operationCode !== "f1_rank_policy_change") {
        throw new A2OutcomeUncertainError("原审批单对象或操作不符，请到操作记录核对。", key);
      }
      if (ticket.status === "pending") attempts.remember(fingerprint, key, { ...record(), ticket, received: true, absent: false });
      else attempts.forget(fingerprint, key);
      const status = { pending: " · 等待另一位有审批权的超管批准，当前配置未变", approved: " · 已批准", rejected: " · 已驳回", withdrawn: " · 已撤回", expired: " · 已过期" };
      acknowledgement = `审批单 ${ticket.id}${status[ticket.status]}`;
    } else {
      if (!previous?.received) {
        // Reading current configuration cannot establish an unknown command's outcome.
        if (mode === "lookup") return { active: await fetchF1VRankOverview(), resolved: false, acknowledgement: "已读取当前配置；这不是原请求的执行回执，请保留原操作继续核对。" };
        if (previous && previous.expiresAt <= Date.now()) throw new A2OutcomeUncertainError("原操作已过期，请到操作记录核对，勿重复提交。", key);
        if (!attempts.isDurablyStored(fingerprint, key)) throw new A2OutcomeUncertainError("原操作未能持久保存，当前不能重发。", key);
        posting = true;
        await writeF1VRankPolicy(original.values, original.reason, original.operator, key);
        posting = false;
        attempts.remember(fingerprint, key, { ...record(), received: true });
      }
      // A saved successful receipt settles the command even after its retry window.
      attempts.forget(fingerprint, key);
      acknowledgement = original.editor.action === "threshold" ? "晋升条件已更新，下一轮评估使用新值" : original.editor.action === "reward_remove" ? "奖励已移除，历史发放记录保留" : "奖励模板已更新，后续发放使用新值";
    }
  } catch (error) {
    const saved = record();
    const failure = error as { status?: number; httpStatus?: number; apiCode?: number; backendMessage?: string };
    const rejected = posting && (previous ? isExplicitRejection(error) : !isA2OutcomeUncertainError(error) && !isF1OutcomeUncertainError(error)
      && !failure.backendMessage?.startsWith("IDEMPOTENCY_")
      && isDeterministicRejection(failure.httpStatus ?? failure.status ?? 0, failure.apiCode));
    if (rejected) attempts.forget(fingerprint, key);
    else if (saved && !isA2OutcomeUncertainError(error)) throw new A2OutcomeUncertainError(error instanceof Error ? error.message : "原操作结果未知，请查询原结果。", key);
    throw error;
  }
  // The command's known result is independent of this subsequent read.
  const active = await fetchF1VRankOverview().catch(() => null);
  return { active, resolved: true, acknowledgement };
}

/** Refresh saved pending approvals without treating a failed read as a pending verdict. */
export async function queryF1PolicyOperation(owner: number, commandKey: string) {
  const saved = listF1PolicyOperations(owner).find(item => item.commandKey === commandKey);
  if (!saved) return null;
  const current = useAdminAuth.getState().session;
  if (current?.adminId !== owner) throw new Error("ADMIN_PERMISSION_DENIED");
  return submitF1Policy(current, { ...saved.original.editor, recoveryCommandKey: commandKey }, {}, "", "lookup");
}

/** Exposed for the visual worker's explicit expired-proposal confirmation. */
export async function releaseF1PolicyProposal(owner: number, commandKey: string) {
  const saved = listF1PolicyOperations(owner).find(item => item.commandKey === commandKey);
  if (!saved || !saved.original.approval || saved.expiresAt > Date.now()) throw new Error("这条原操作不能解除，请先查询原结果。");
  if (useAdminAuth.getState().session?.adminId !== owner) throw new Error("ADMIN_PERMISSION_DENIED");
  const ticket = await fetchA2ProposalByKey(commandKey, true, true);
  if (ticket) throw new Error("已找到原审批单，请核对它现在的处理结果。");
  attempts.forget(saved.fingerprint, commandKey);
}
