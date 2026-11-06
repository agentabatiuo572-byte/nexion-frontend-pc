"use client";

import { useState } from "react";
import Link from "next/link";
import {
  A2OutcomeUncertainError, createA2CommandKey, createA2OperationProposal,
  fetchA2ProposalByKey, isA2OutcomeUncertainError,
} from "@/lib/admin/a2-client";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { roleLabel } from "@/lib/nav/console-nav";
import { useAdminAuth, type AdminSession } from "@/lib/store/admin-auth";
import type { G4Overview } from "@/lib/admin/g4-client";
import { Modal, OperationConfirmModal, type BusinessFormValue } from "../design-kit";

export type G4TierChange = {
  tierId?: string;
  from: number;
  currentTo: number;
  currentPrice?: number;
  totalSupply: number;
  sold: number;
  seriesSetupRequired: boolean;
  expectedTiersVersion: number;
};
type Proposal = Parameters<typeof createA2OperationProposal>[0];
type Original = { change: G4TierChange; form: BusinessFormValue; reason: string; proposal: Proposal };
const attempts = createPendingMutationStore<PendingMutationRecord & { input: string }>({
  storageKey: "nexion-admin-g4-catalog-proposals-v1",
  retainExpiredRecords: true,
  isValidRecord: record => typeof record.input === "string",
});
const slot = (adminId: number) => `${adminId}:G4:genesis_catalog:tiers`;
const pendingRecord = (adminId: number) => attempts.list().find(record => record.fingerprint === slot(adminId));
export const hasPendingG4TierApproval = (adminId: number) => !!pendingRecord(adminId);

function pendingApproval(adminId: number) {
  const record = pendingRecord(adminId);
  if (!record) return undefined;
  const original = JSON.parse(record.input) as Original;
  const { change, form, reason, proposal } = original;
  const params = proposal?.command?.params;
  if (!change || !Number.isInteger(change.from) || !Number.isInteger(change.currentTo)
      || !Number.isInteger(change.totalSupply) || !Number.isInteger(change.sold)
      || !Number.isSafeInteger(change.expectedTiersVersion) || typeof change.seriesSetupRequired !== "boolean"
      || change.tierId !== undefined && typeof change.tierId !== "string"
      || typeof form?.to !== "string" || typeof form.priceUSDT !== "string" || typeof reason !== "string"
      || proposal?.sourceDomain !== "G4" || proposal.obj !== "tiers" || proposal.reason !== reason
      || proposal.command?.domain !== "G" || proposal.command.op !== "g4_genesis_tier_change"
      || proposal.target?.domain !== "G" || proposal.target.type !== "genesis_catalog" || proposal.target.id !== "tiers"
      || params?.tierId !== change.tierId || params?.to !== Number(form.to)
      || params?.priceUSDT !== Number(form.priceUSDT) || params?.expectedTiersVersion !== change.expectedTiersVersion) {
    throw new Error("原档位提案内容不完整，请到操作记录核对，勿重复提交。");
  }
  return { ...record, ...original };
}

export function G4TierConfirm({ session, epoch, requested, readActive, onDirect, onClose, onDone }: {
  session: AdminSession; epoch: number; requested?: G4TierChange;
  readActive: () => Promise<G4Overview>;
  onDirect: (change: G4TierChange, reason: string, to: number, priceUSDT: number) => Promise<void>;
  onClose: () => void; onDone: (active: G4Overview, acknowledgement: string) => void;
}) {
  const [opening] = useState(() => {
    try { return { pending: pendingApproval(session.adminId), error: "" }; }
    catch { return { pending: undefined, error: "原档位提案内容不完整，请到操作记录核对，勿重复提交。" }; }
  });
  const [endedError, setEndedError] = useState("");
  const change = opening.pending?.change ?? requested;
  if (!change) return <Modal title="查询原档位提交结果" onClose={onClose}>
    <div role="alert">{opening.error || "原操作已处理，请关闭后重新读取页面。"}</div>
  </Modal>;
  const basis = change;
  const number = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const requiresApproval = (value: BusinessFormValue) => !!pendingRecord(session.adminId)
    || !basis.seriesSetupRequired && Number(value.to) > basis.totalSupply;
  const form = opening.pending?.form ?? {
    to: basis.tierId ? String(basis.currentTo) : "",
    priceUSDT: basis.currentPrice === undefined ? "" : String(basis.currentPrice),
  };
  const approvalPermissionError = !session.authorities.includes("finprod_g4_price_write")
    ? "当前账号缺少价格档位修改权限，不能发起或查询该审批。"
    : !session.authorities.includes("finprod_g4_write") ? "调整系列总供应量还需要节点参数修改权限。" : undefined;

  function ensureOwner(approval: boolean) {
    const auth = useAdminAuth.getState();
    if (!auth.isAuthenticated || auth.session?.adminId !== session.adminId || auth.authEpoch !== epoch) {
      throw new Error("登录身份或权限已变化，请关闭弹窗后重新操作。");
    }
    if (approval && (!auth.session.authorities.includes("finprod_g4_price_write")
        || !auth.session.authorities.includes("finprod_g4_write"))) {
      throw new Error("发起或查询总量审批需要价格档位和节点参数修改权限。");
    }
  }
  async function execute(mode: "submit" | "lookup" | "retry", reason = "", value: BusinessFormValue = {}) {
    ensureOwner(false);
    let command = pendingApproval(session.adminId);
    if (opening.pending && command?.commandKey !== opening.pending.commandKey) {
      throw new Error("原档位操作已处理，请关闭后重新读取页面。");
    }
    if (mode !== "submit" && !command) throw new Error("原档位操作已处理，请关闭后重新读取页面。");
    if (!command && mode === "submit") {
      const to = Number(value.to), priceUSDT = Number(value.priceUSDT);
      if (!value.to?.trim() || !value.priceUSDT?.trim() || !Number.isInteger(to) || !Number.isInteger(priceUSDT)) {
        throw new Error("截止数量和单价要填整数");
      }
      if (!requiresApproval(value)) {
        await onDirect(basis, reason, to, priceUSDT);
        ensureOwner(false);
        onClose();
        return true;
      }
      ensureOwner(true);
      const original: Original = {
        change: basis, form: { to: value.to, priceUSDT: value.priceUSDT }, reason,
        proposal: {
          action: basis.tierId ? `增加创世节点总量 · ${basis.tierId}` : "新增创世节点价格档位",
          obj: "tiers", beforeValue: "—", afterValue: "—",
          operator: session.operator || session.username, operatorRole: roleLabel(session.role),
          type: "fund", amplifies: true, sos: false, roleGate: "另一位有权超管", reason, sourceDomain: "G4",
          target: { domain: "G", type: "genesis_catalog", id: "tiers" },
          command: { domain: "G", op: "g4_genesis_tier_change", params: {
            ...(basis.tierId ? { tierId: basis.tierId } : {}), to, priceUSDT,
            expectedTiersVersion: basis.expectedTiersVersion,
          } },
        },
      };
      const key = createA2CommandKey("g4-catalog");
      attempts.remember(slot(session.adminId), key, { input: JSON.stringify(original) });
      if (!attempts.isDurablyStored(slot(session.adminId), key)) {
        attempts.forget(slot(session.adminId), key);
        throw new Error("浏览器无法保存原档位提案，请允许会话存储后重试。");
      }
      command = pendingApproval(session.adminId)!;
    }
    ensureOwner(true);
    const original = command!;
    let ticket;
    // Every recovery checks the exact original key, including already decided tickets.
    if (mode !== "submit" || opening.pending) {
      try { ticket = await fetchA2ProposalByKey(original.commandKey); }
      catch { throw new A2OutcomeUncertainError("暂时无法查询原档位审批，请稍后再查。", original.commandKey); }
      ensureOwner(true);
      if (!ticket && mode === "lookup") return false;
    }
    if (!ticket) {
      if (Date.now() < original.createdAt || Date.now() >= original.expiresAt) {
        throw new A2OutcomeUncertainError("原提案已过期或本机时间异常，只能继续查询，不能重试或另建编号。", original.commandKey);
      }
      try { ticket = await createA2OperationProposal(original.proposal, original.commandKey, true); }
      catch (failure) {
        const code = failure && typeof failure === "object" && "backendMessage" in failure ? String(failure.backendMessage) : "";
        const rejected = failure && typeof failure === "object" && "backendMessage" in failure && "status" in failure && typeof failure.status === "number";
        if (isA2OutcomeUncertainError(failure)
            || !rejected || ["IDEMPOTENCY_REQUEST_IN_PROGRESS", "IDEMPOTENCY_RESULT_UNKNOWN", "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH"].includes(code)) {
          throw new A2OutcomeUncertainError("原档位提案结果待确认，请查询原操作，或按原输入和原键重试。", original.commandKey);
        }
        attempts.forget(slot(session.adminId), original.commandKey);
        if (opening.pending) setEndedError("原提案已明确拒绝，请关闭后重新读取当前配置。");
        throw failure;
      }
    }
    ensureOwner(true);
    let active;
    try { active = await readActive(); }
    catch { throw new A2OutcomeUncertainError(`审批单 ${ticket.id} 已登记，当前配置回读失败，请查询原操作。`, original.commandKey); }
    ensureOwner(true);
    if (ticket.status !== "pending") attempts.forget(slot(session.adminId), original.commandKey);
    const status = { pending: "查询时待审，须另一位有权超管批准后生效", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" }[ticket.status];
    onDone(active, `原审批单 ${ticket.id} · ${status}；当前配置已重新读取`);
    return true;
  }

  return <OperationConfirmModal
    action={basis.tierId ? `修改价格档位 · ${basis.tierId}` : "新增价格档位"}
    detail={<>起点 {number(basis.from)}，截止和单价都填整数。增加已有系列总供应量须另一位有权超管批准；待审期间沿用原档位和原总量。尚未发布系列时仍需单独发布，不会自动开放销售。只影响以后的销售，已下单的按下单时价格结算。</>}
    content={<>
      {opening.pending && <p className="tiny" role="status">核对原提案 · 档位版本 {basis.expectedTiersVersion} · 命令号 {opening.pending.commandKey}。查询原单不会把旧方案重新提交为当前配置。</p>}
      {session.authorities.includes("platform_a2_read") && <Link className="l-btn sm" href="/platform/audit?domain=G">到操作记录查看审批</Link>}
    </>}
    briefKind="config" reasonMin={8} reasonMax={200} amplifies={false}
    businessForm={{ kind: "multi-field", title: basis.tierId ? `档位 ${basis.tierId}` : "新价格档位", hint: `起点固定为 ${number(basis.from)}。截止和单价都填整数。`, fields: [
      { key: "to", label: "截止（卖到第几张）", current: form.to, inputKind: "number", min: basis.from + 1, step: 1, required: true },
      { key: "priceUSDT", label: "单价（USDT）", current: form.priceUSDT, inputKind: "number", min: 1, step: 1, required: true },
    ], feedback: value => {
      const to = Number(value.to);
      const target = value.to?.trim() && Number.isInteger(to) && to > basis.from && to >= basis.sold
        ? `${number(to)} 张` : "待填写有效截止数量";
      const supply = basis.seriesSetupRequired ? "系列总供应量：尚未发布 → 尚未发布；发布系列时以末档截止数量确定总量。"
        : `系列总供应量：${number(basis.totalSupply)} 张 → ${target}。`;
      return { message: `末档截止数量：${number(basis.currentTo)} 张 → ${target}；${supply}末档截止数量和系列总供应量均不能少于已售的 ${number(basis.sold)} 张。`, invalid: false };
    } }}
    getPendingReason={() => opening.error ? undefined : pendingApproval(session.adminId)?.reason}
    getPendingBusinessValue={() => opening.error ? undefined : pendingApproval(session.adminId)?.form}
    inlineApproval={{
      pending: !!opening.pending,
      expired: !!opening.pending && (Date.now() < opening.pending.createdAt || Date.now() >= opening.pending.expiresAt),
      disabledReason: opening.error || endedError || undefined,
      resolve: value => requiresApproval(value) ? {
        heading: "需另一位有权超管批准后生效",
        disabledReason: approvalPermissionError,
        completionCopy: "待审期间档位和系列总量保持原值，批准后同步生效。提交与批准均按服务端版本及覆盖率规则检查。",
      } : undefined,
      recover: () => execute("lookup"),
      retry: () => execute("retry").then(() => undefined),
    }}
    onClose={onClose}
    onConfirm={(reason, _edit, value) => execute("submit", reason, value).then(() => undefined)}
  />;
}
