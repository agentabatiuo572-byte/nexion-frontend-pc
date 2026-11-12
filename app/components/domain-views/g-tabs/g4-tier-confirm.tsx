"use client";

import { useState } from "react";
import Link from "next/link";
import {
  A2OutcomeUncertainError, createA2CommandKey, createA2OperationProposal,
  fetchA2ProposalByKey, type A2OperationRow,
} from "@/lib/admin/a2-client";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { g4DirectObject, listG4DirectCommands } from "@/lib/admin/g4-direct-command";
import { roleLabel } from "@/lib/nav/console-nav";
import { useAdminAuth, type AdminSession } from "@/lib/store/admin-auth";
import { G4CatalogApprovalRequiredError, type G4Overview } from "@/lib/admin/g4-client";
import { ArrowLeftRight } from "lucide-react";
import { Fact, Facts, Notice as RdNotice, StatusTag as RdStatusTag } from "@/app/components/rd";
import { Modal, OperationConfirmModal, type BusinessFormValue } from "../design-kit";

export type G4TierChange = {
  tierId?: string;
  operation?: "delete";
  nextTierId?: string;
  previousTierId?: string;
  from: number;
  currentTo: number;
  currentPrice?: number;
  totalSupply: number;
  sold: number;
  seriesSetupRequired: boolean;
  expectedTiersVersion: number;
};
type Proposal = Parameters<typeof createA2OperationProposal>[0];
type Original = { change: G4TierChange; form: BusinessFormValue; reason: string; proposal: Proposal; ticket?: A2OperationRow };
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
      || change.operation !== undefined && change.operation !== "delete"
      || change.nextTierId !== undefined && typeof change.nextTierId !== "string"
      || change.previousTierId !== undefined && typeof change.previousTierId !== "string"
      || typeof reason !== "string"
      || proposal?.sourceDomain !== "G4" || proposal.obj !== "tiers" || proposal.reason !== reason
      || proposal.command?.domain !== "G" || proposal.command.op !== "g4_genesis_tier_change"
      || proposal.target?.domain !== "G" || proposal.target.type !== "genesis_catalog" || proposal.target.id !== "tiers"
      || params?.tierId !== change.tierId || params?.expectedTiersVersion !== change.expectedTiersVersion
      || (change.operation === "delete"
        ? !change.tierId || params?.action !== "delete" || params.to !== undefined || params.priceUSDT !== undefined
        : typeof form?.to !== "string" || typeof form.priceUSDT !== "string" || params?.action !== undefined
          || params?.to !== Number(form.to) || params?.priceUSDT !== Number(form.priceUSDT))) {
    throw new Error("原档位提案内容不完整，请到操作记录核对，勿重复提交。");
  }
  return { ...record, ...original };
}

export function G4TierConfirm({ session, epoch, requested, readActive, canStartNew, onDirect, onError, onClose, onDone }: {
  session: AdminSession; epoch: number; requested?: G4TierChange;
  readActive: () => Promise<G4Overview>;
  canStartNew: (version: number) => boolean;
  onError: (error: unknown) => void;
  onDirect: (change: G4TierChange, reason: string, to: number, priceUSDT: number) => Promise<void>;
  onClose: () => void; onDone: (active: G4Overview, acknowledgement: string) => void;
}) {
  const [opening] = useState(() => {
    try { return { pending: pendingApproval(session.adminId), error: "" }; }
    catch { return { pending: undefined, error: "原档位提案内容不完整，请到操作记录核对，勿重复提交。" }; }
  });
  const [approvalRequiredFor, setApprovalRequiredFor] = useState<string>();
  const change = opening.pending?.change ?? requested;
  if (!change) return <Modal title="查询原档位提交结果" onClose={onClose}>
    <div role="alert">{opening.error || "原操作已处理，请关闭后重新读取页面。"}</div>
  </Modal>;
  const basis = change;
  const deleting = basis.operation === "delete";
  const number = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const inputKey = (value: BusinessFormValue) => deleting ? "delete" : JSON.stringify([value.to, value.priceUSDT]);
  const changesSupply = (value: BusinessFormValue) => !deleting && !basis.nextTierId
    && !basis.seriesSetupRequired && Number(value.to) !== basis.totalSupply;
  const requiresApproval = (value: BusinessFormValue) => !!pendingRecord(session.adminId)
    || approvalRequiredFor === inputKey(value)
    || changesSupply(value) && Number(value.to) > basis.totalSupply;
  const directOriginal = () => listG4DirectCommands(session.adminId).find(row => g4DirectObject(row) === "tiers");
  const form = opening.pending?.form ?? (deleting ? {} : {
    to: basis.tierId ? String(basis.currentTo) : "",
    priceUSDT: basis.currentPrice === undefined ? "" : String(basis.currentPrice),
  });
  const approvalPermissionError = (value: BusinessFormValue) => !session.authorities.includes("finprod_g4_price_write")
    ? "当前账号缺少价格档位修改权限，不能发起或查询该审批。"
    : changesSupply(value) && !session.authorities.includes("finprod_g4_write") ? "调整系列总供应量还需要节点参数修改权限。" : undefined;

  function ensureOwner(approval: boolean, value: BusinessFormValue = form) {
    const auth = useAdminAuth.getState();
    if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== session.adminId || auth.authEpoch !== epoch) {
      throw new Error("登录身份或权限已变化，请关闭弹窗后重新操作。");
    }
    if (approval && (!auth.session.authorities.includes("finprod_g4_price_write")
        || changesSupply(value) && !auth.session.authorities.includes("finprod_g4_write"))) {
      throw new Error(changesSupply(value) ? "发起或查询总量审批需要价格档位和节点参数修改权限。" : "发起或查询档位审批需要价格档位修改权限。");
    }
  }
  async function execute(mode: "submit" | "lookup" | "retry", reason = "", value: BusinessFormValue = {}) {
    ensureOwner(false);
    let command = pendingApproval(session.adminId);
    const hadPending = !!command;
    if (opening.pending && command?.commandKey !== opening.pending.commandKey) {
      throw new Error("原档位操作已处理，请关闭后重新读取页面。");
    }
    if (mode !== "submit" && !command) throw new Error("原档位操作已处理，请关闭后重新读取页面。");
    if (!command && mode === "submit") {
      if (!canStartNew(basis.expectedTiersVersion)) {
        onClose();
        throw new Error("价格档位已变化或页面尚未就绪，请重新读取后操作。");
      }
      const to = deleting ? basis.currentTo : Number(value.to), priceUSDT = deleting ? basis.currentPrice! : Number(value.priceUSDT);
      if (!deleting && (!value.to?.trim() || !value.priceUSDT?.trim() || !Number.isInteger(to) || !Number.isInteger(priceUSDT))) {
        throw new Error("截止数量和单价要填整数");
      }
      if (!requiresApproval(value)) {
        try { await onDirect(basis, reason, to, priceUSDT); }
        catch (failure) {
          ensureOwner(false);
          if (!(failure instanceof G4CatalogApprovalRequiredError)) throw failure;
          setApprovalRequiredFor(inputKey(value));
          return false;
        }
        ensureOwner(false);
        onClose();
        return true;
      }
      ensureOwner(true, value);
      const original: Original = {
        change: basis, form: deleting ? {} : { to: value.to, priceUSDT: value.priceUSDT }, reason,
        proposal: {
          action: deleting ? `删除创世节点价格档位 · ${basis.tierId}` : basis.tierId ? `调整创世节点价格档位 · ${basis.tierId}` : "新增创世节点价格档位",
          obj: "tiers", beforeValue: "—", afterValue: "—",
          operator: session.operator || session.username, operatorRole: roleLabel(session.role),
          type: "fund", amplifies: true, sos: false, roleGate: "另一位有权超管", reason, sourceDomain: "G4",
          target: { domain: "G", type: "genesis_catalog", id: "tiers" },
          command: { domain: "G", op: "g4_genesis_tier_change", params: {
            ...(basis.tierId ? { tierId: basis.tierId } : {}),
            ...(deleting ? { action: "delete" } : { to, priceUSDT }),
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
    const original = command!;
    ensureOwner(mode !== "lookup", original.form);
    let ticket;
    // Every recovery checks the exact original key, including already decided tickets.
    if (hadPending) {
      try { ticket = await fetchA2ProposalByKey(original.commandKey, true); }
      catch { throw new A2OutcomeUncertainError("暂时无法查询原档位审批，请稍后再查。", original.commandKey); }
      ensureOwner(false, original.form);
      if (!ticket && mode === "lookup") return false;
    }
    if (!ticket) {
      if (Date.now() < original.createdAt || Date.now() >= original.expiresAt) {
        throw new A2OutcomeUncertainError("原提案已过期或本机时间异常，只能继续查询，不能重试或另建编号。", original.commandKey);
      }
      try { ticket = await createA2OperationProposal(original.proposal, original.commandKey, true); }
      catch (failure) {
        if (original.ticket || !isExplicitRejection(failure)) {
          throw new A2OutcomeUncertainError("原档位提案结果待确认，请查询原操作，或按原输入和原键重试。", original.commandKey);
        }
        attempts.forget(slot(session.adminId), original.commandKey);
        if (hadPending) { onError(failure); onClose(); }
        throw failure;
      }
    }
    ensureOwner(false, original.form);
    if (ticket.mine !== true || ticket.obj !== "tiers" || ticket.action !== "调整创世节点价格档位") {
      throw new A2OutcomeUncertainError("回执与本人的原档位审批不匹配，请继续核对原操作。", original.commandKey);
    }
    attempts.remember(slot(session.adminId), original.commandKey, { input: JSON.stringify({ change: original.change, form: original.form, reason: original.reason, proposal: original.proposal, ticket }) });
    let active;
    try { active = await readActive(); }
    catch { throw new A2OutcomeUncertainError(`审批单 ${ticket.id} 已登记，当前配置回读失败，请查询原操作。`, original.commandKey); }
    ensureOwner(false, original.form);
    if (ticket.status !== "pending") attempts.forget(slot(session.adminId), original.commandKey);
    const status = { pending: "查询时待审，须另一位有权超管批准后生效", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" }[ticket.status];
    onDone(active, `原审批单 ${ticket.id} · ${status}；当前配置已重新读取`);
    return true;
  }

  // ——以下只用于显示——
  const tierFacts = (value?: string) => {
    void value;
    return <Facts>
      <Fact k="改的是">{deleting ? `删除档位 ${basis.tierId}` : basis.tierId ? `档位 ${basis.tierId}` : "在最后一档后面新增一档"}</Fact>
      <Fact k="区间">{deleting ? `${number(basis.from)}–${number(basis.currentTo)} 张` : `起点 ${number(basis.from)}，截止填大于起点的整数`}</Fact>
      {deleting && <Fact k="空出来的区间">{basis.previousTierId ? <>上一档 {basis.previousTierId} 的截止延长到 {number(basis.currentTo)}</> : <>下一档 {basis.nextTierId} 的起点提前到 {number(basis.from)}</>}；系列总量不变，至少保留一档</Fact>}
      {!deleting && basis.nextTierId && <Fact k="下一档">改截止时下一档 {basis.nextTierId} 的起点跟着改，系列总量不变</Fact>}
      {!deleting && !basis.nextTierId && <Fact k="系列总量">{basis.seriesSetupRequired ? "还没发布系列；发布时按最后一档的截止定总量" : `最后一档的截止就是系列总量，现在 ${number(basis.totalSupply)} 张，不能少于已售 ${number(basis.sold)} 张`}</Fact>}
      <Fact k="什么时候生效">扩大已有系列的总量，或让还没卖出的节点涨价（删除也可能抬价）：提交审批，另一位有价格档位权限的在职超级管理员批准后才生效，批准前沿用原档位和原总量。其余修改确认后立即生效</Fact>
      <Fact k="付不付钱">不付钱；只影响以后的销售，已下单的按下单时价格。目录审批不查兑付覆盖率</Fact>
    </Facts>;
  };
  return <OperationConfirmModal
    action={deleting ? `删除价格档位 · ${basis.tierId}` : basis.tierId ? `修改价格档位 · ${basis.tierId}` : "新增价格档位"}
    title={opening.pending ? "价格档位的原申请" : deleting ? `删除价格档位 ${basis.tierId}` : basis.tierId ? `修改价格档位 ${basis.tierId}` : "新增价格档位"}
    effect={<RdStatusTag tone="neutral" icon={ArrowLeftRight} explain="后端在提交时判断方向：扩容或未售涨价要另一位有权超管批准；其余修改确认后立即生效。直接保存时后端答复要审批的，框不关，输入留着，再点一次确认才提交审批。">扩容或未售涨价要批准 · 其余立即生效</RdStatusTag>}
    facts={tierFacts}
    statedBrief={{ impact: "改的是以后销售的档位和价格，已下单的订单不变。", check: "截止和单价都填整数；理由写清依据或工单号。" }}
    confirmTone={deleting ? "danger" : undefined}
    confirmLabel={deleting ? "确认删除" : undefined}
    detail={<>{deleting
      ? <>删除 <b>{basis.tierId}</b> 档（{number(basis.from)}–{number(basis.currentTo)}）。空出来的区间会自动补上（{basis.previousTierId ? <>上一档 <b>{basis.previousTierId}</b> 的截止延长到 {number(basis.currentTo)}</> : <>下一档 <b>{basis.nextTierId}</b> 的起点提前到 {number(basis.from)}</>}），至少保留一档。</>
      : <>起点 {number(basis.from)}，截止和单价都填整数。{basis.nextTierId && <>改截止时下一档 <b>{basis.nextTierId}</b> 的起点会跟着调整，系列总量不变。</>}尚未发布系列时仍需单独发布，不会自动开放销售。</>}
      增加已有系列总供应量或服务端判定提高未售价格时，须另一位有权超管批准；待审期间沿用原档位和原总量。只影响以后的销售，已下单的按下单时价格结算。</>}
    content={<>
      {opening.pending && <RdNotice tone="warn" title="这是原档位申请"><p>档位版本 {basis.expectedTiersVersion} · 命令号 <span data-mono>{opening.pending.commandKey}</span>。查询原单不会把旧方案重新提交为当前配置。</p></RdNotice>}
      {session.authorities.includes("platform_a2_read") && <Link className="rd-link" href="/platform/audit?domain=G">到「操作记录与审批」查看</Link>}
    </>}
    briefKind="config" reasonMin={8} reasonMax={200} amplifies={false}
    businessForm={deleting ? undefined : { kind: "multi-field", title: basis.tierId ? `档位 ${basis.tierId}` : "新价格档位", hint: `起点固定为 ${number(basis.from)}。截止和单价都填整数。`, fields: [
      { key: "to", label: "截止（卖到第几张）", current: form.to, inputKind: "number", min: basis.from + 1, step: 1, required: true },
      { key: "priceUSDT", label: "单价（USDT）", current: form.priceUSDT, inputKind: "number", min: 1, step: 1, required: true },
    ], feedback: basis.nextTierId ? undefined : value => {
      const to = Number(value.to);
      const target = value.to?.trim() && Number.isInteger(to) && to > basis.from && to >= basis.sold
        ? `${number(to)} 张` : "待填写有效截止数量";
      const supply = basis.seriesSetupRequired ? "系列总供应量：尚未发布 → 尚未发布；发布系列时以末档截止数量确定总量。"
        : `系列总供应量：${number(basis.totalSupply)} 张 → ${target}。`;
      return { message: `末档截止数量：${number(basis.currentTo)} 张 → ${target}；${supply}末档截止数量和系列总供应量均不能少于已售的 ${number(basis.sold)} 张。`, invalid: false };
    } }}
    getPendingReason={() => opening.error ? undefined : pendingApproval(session.adminId)?.reason ?? (directOriginal() ? JSON.parse(directOriginal()!.body).reason : undefined)}
    getPendingBusinessValue={() => opening.error ? undefined : pendingApproval(session.adminId)?.form ?? (directOriginal() ? Object.fromEntries(Object.entries(JSON.parse(directOriginal()!.body)).map(([key, value]) => [key, String(value)])) : undefined)}
    inlineApproval={{
      pending: !!opening.pending,
      expired: !!opening.pending && (Date.now() < opening.pending.createdAt || Date.now() >= opening.pending.expiresAt),
      disabledReason: opening.error || undefined,
      resolve: value => requiresApproval(value) ? {
        heading: "需另一位有权超管批准后生效",
        disabledReason: approvalPermissionError(value),
        completionCopy: "待审期间档位和系列总量保持原值，批准后同步生效。提交和批准时后端核对档位版本和快照；目录审批不查兑付覆盖率。",
      } : undefined,
      recover: () => execute("lookup"),
      retry: () => execute("retry").then(() => undefined),
    }}
    onClose={onClose}
    onConfirm={(reason, _edit, value) => execute("submit", reason, value).then(() => undefined)}
  />;
}
