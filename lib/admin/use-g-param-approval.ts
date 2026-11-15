"use client";

import { useReducer } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { roleLabel } from "@/lib/nav/console-nav";
import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, type A2OperationRow } from "./a2-client";
import { isExplicitRejection } from "./explicit-rejection";
import { findHighOp } from "./high-ops-registry";
import { createPendingMutationStore, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "./pending-mutation-store";
import { displayAdminError } from "./error-messages";

type Page = "G2" | "G4" | "G7";
type Proposal = Parameters<typeof createA2OperationProposal>[0];
type Change = { key: string; current: string; value: string; reason: string; decisionRef?: string;
  expectedRevision?: string; batchNo?: string; approvalRequired?: boolean };
export interface PendingGParam extends PendingMutationRecord {
  adminId: number;
  page: Page;
  request: Proposal;
  ticket?: A2OperationRow;
}

export interface GParamRecovery extends PendingGParam {
  status: "unknown" | A2OperationRow["status"];
  retryExpired: boolean;
  canQuery: boolean;
  canRetry: boolean;
  canRelease: boolean;
}

const ops = { G2: "g2_exchange_param", G4: "g4_genesis_param", G7: "g7_repurchase_param" } as const;
const pending = createPendingMutationStore<PendingGParam>({
  storageKey: "nexion-admin-g-param-proposals-v1",
  retainExpiredRecords: true,
  isValidRecord: (r) => Number.isSafeInteger(r.adminId) && r.adminId > 0 && r.page in ops
    && !!r.request && typeof r.request.reason === "string" && typeof r.request.obj === "string"
    && r.request.sourceDomain === r.page && r.request.command?.domain === "G"
    && (r.page === "G4" && r.request.command.op === "g4_genesis_rerun_dividend"
      ? r.request.command.params?.batchNo === r.request.obj
        && typeof r.request.command.params.decisionRef === "string"
        && typeof r.request.command.params.expectedRevision === "string"
        && /^[0-9a-f]{64}$/.test(r.request.command.params.expectedRevision)
      : r.request.command.op === ops[r.page] && r.request.command.params?.paramKey === r.request.obj
        && typeof r.request.command.params.value === "string"
        && (r.page === "G4" && r.request.obj === "dividend"
          ? typeof r.request.command.params.decisionRef === "string"
            && typeof r.request.command.params.expectedRevision === "string"
            && /^[0-9a-f]{64}$/.test(r.request.command.params.expectedRevision)
          : typeof r.request.command.params.expectedValue === "string"))
    && r.request.target?.domain === "G" && r.request.target.id === r.request.obj
    && r.fingerprint === `${r.adminId}|${r.page}|${r.request.obj}`,
});

export function gParamAuthority(page: Page, key: string) {
  if (page === "G2") return key === "userDailyCap" ? "finprod_g2_cap_user_write"
    : key === "platformDailyCap" ? "finprod_g2_cap_platform_write"
      : key === "fee" || key === "feeMin" ? "finprod_g2_fee_rate_write" : "finprod_g2_write";
  if (page === "G7") return key === "apy" || key === "lockDays" ? "finprod_g7_apy_write"
    : key === "nurture" ? "finprod_g7_nurture_write" : "finprod_g7_write";
  return key === "price" ? "finprod_g4_price_write" : key === "dividend" ? "finprod_g4_dividend_rate_write"
    : key === "royalty" ? "finprod_g4_royalty_write" : key === "airdropPct" ? "finprod_g4_airdrop_pct_write"
      : key === "emissionCurve" ? "finprod_g4_emission_curve_write"
        : key === "airdropLockDays" ? "finprod_g4_airdrop_lock_days_write" : "finprod_g4_write";
}

// Mirror HALF_UP without binary floating point. Unrecognized values go to the official
// direct endpoint; its APPROVAL_REQUIRED response is authoritative and routes to A2.
function rounded(value: string, scale: number) {
  const match = /^\+?(\d+)(?:\.(\d*))?$/.exec(value.trim().replace(/[,%\s]/g, ""));
  if (!match) return undefined;
  const fraction = match[2] ?? "";
  return BigInt(match[1] + fraction.slice(0, scale).padEnd(scale, "0"))
    + (Number(fraction[scale] ?? "0") >= 5 ? BigInt(1) : BigInt(0));
}

function amplifies(page: Page, change: Change) {
  const { key, current, value } = change;
  if (page === "G2" && key === "queueMode") return current.trim().toUpperCase() === "REJECT" && value === "QUEUE";
  if (page === "G4" && change.batchNo) return change.approvalRequired === true;
  if (page === "G4" && ["divBase", "emissionCurve"].includes(key)) return current.trim() !== value.trim();
  if (page === "G4" && ["airdropPct", "airdropLockDays"].includes(key)) {
    const scale = key === "airdropPct" ? 6 : 0;
    const normalized = rounded(value, scale);
    if (normalized === undefined) return false;
    const digits = normalized.toString().padStart(scale + 1, "0");
    const candidate = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, "") : digits;
    return current.trim() !== candidate;
  }
  const scale = page === "G4" && key === "supply" ? 0 : page === "G4" && ["price", "royalty"].includes(key) ? 2 : 6;
  const before = rounded(current, scale);
  const candidateMicros = rounded(value, 6);
  // Royalty first normalizes to six decimals, then rounds the effective basis points.
  const newValue = page === "G4" && key === "royalty" && candidateMicros !== undefined
    ? (candidateMicros + BigInt(5000)) / BigInt(10000) : rounded(value, scale);
  if (before === undefined || newValue === undefined) return false;
  if (page === "G2") return ["userDailyCap", "platformDailyCap"].includes(key) ? newValue > before
    : ["fee", "feeMin"].includes(key) && newValue < before;
  if (page === "G7") return ["apy", "nurture"].includes(key) ? newValue > before : key === "penalty" && newValue < before;
  return ["supply", "price", "dividend"].includes(key) ? newValue > before : key === "royalty" && newValue < before;
}

function reasonCode(error: unknown) {
  return (error as { backendMessage?: string } | null)?.backendMessage;
}

/** Logic only: the existing parameter buttons and confirmation modal own presentation. */
export function useGParamApproval(page: Page, toast: (message: string) => void, showError: (message: string) => void, refresh: () => Promise<void>, onRecoveryStart?: () => void) {
  const session = useAdminAuth((s) => s.session);
  const adminId = session?.adminId;
  const [, changed] = useReducer((value: number) => value + 1, 0);
  const record = (key: string) => pending.list().find(r => r.adminId === adminId && r.page === page && r.request.obj === key);
  const requireActor = (key: string, proposing: boolean) => {
    const auth = useAdminAuth.getState();
    if (!auth.isAuthenticated || auth.logoutPending || !auth.session || auth.session.adminId !== adminId || !adminId
      || !auth.session.authorities.includes(gParamAuthority(page, key))) throw new Error("当前账号没有此参数的修改权限，请核对授权。");
    if (proposing && !auth.session.authorities.some(a => a === "platform_a2_proposal_create" || a === "platform_a2_write")) {
      throw new Error("当前账号没有发起审批的权限，请由有提案权和此参数修改权限的同事发起。");
    }
    return auth.session;
  };
  const checkTicket = (original: PendingGParam, ticket: A2OperationRow) => {
    const action = page === "G2" ? "兑换参数调整" : page === "G4" ? "调整创世参数" : "回购参数调整";
    const dividend = page === "G4" && (original.request.obj === "dividend" || original.request.command.op === "g4_genesis_rerun_dividend");
    if (!ticket.mine || ticket.obj !== original.request.obj || ticket.action !== (dividend ? "批准创世分红操作" : `${action} · ${ticket.obj}`)
      || ticket.operationCode && ticket.operationCode !== original.request.command.op) {
      throw new Error("返回的审批单与原参数操作不符，原请求和命令号继续保留，请核对原审批单。");
    }
  };
  const showTicket = (ticket: A2OperationRow) => {
    const status = { pending: "待审批", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" }[ticket.status];
    toast(ticket.status === "pending"
      ? `审批单已提交，等待审批：${ticket.before} → ${ticket.after}。批准前当前值不变。`
      : `审批单${status}：${ticket.before} → ${ticket.after}`);
  };
  const acceptTicket = async (original: PendingGParam, ticket: A2OperationRow, reread = false) => {
    checkTicket(original, ticket);
    showTicket(ticket);
    pending.remember(original.fingerprint, original.commandKey, { ...original, ticket });
    changed();
    if (reread || ticket.status !== "pending") await refresh();
    if (ticket.status !== "pending") {
      pending.forget(original.fingerprint, original.commandKey);
      changed();
      showError("");
    }
    return ticket;
  };
  const query = async (original: PendingGParam, reread = page === "G4") => {
    onRecoveryStart?.();
    const ticket = await fetchA2ProposalByKey(original.commandKey, true);
    return ticket ? acceptTicket(original, ticket, reread) : undefined;
  };
  const send = async (original: PendingGParam, recovering = true) => {
    // POST idempotency receipts can retain their historical pending status on all
    // three pages. Recovery uses the current ticket, then the current overview.
    if (recovering) {
      const ticket = await query(original, true);
      if (ticket) return ticket;
      if (original.ticket || isRetryExpired(original)) {
        throw new Error(original.ticket
          ? "暂时查不到已收录的原审批单，原记录继续保留，不能重新提案。" : RETRY_EXPIRED_TEXT);
      }
    }
    requireActor(original.request.obj, true);
    if (!pending.isDurablyStored(original.fingerprint, original.commandKey)) {
      throw new Error("浏览器存不下完整原请求，本次没有发送。请保留原记录并查询原审批单。");
    }
    let result: A2OperationRow;
    try {
      result = await createA2OperationProposal(original.request, original.commandKey, true);
    } catch (error) {
      if (!original.ticket && isExplicitRejection(error)) {
        pending.forget(original.fingerprint, original.commandKey);
        changed();
        if (recovering && page === "G4") await Promise.allSettled([refresh()]);
      }
      throw error;
    }
    if (recovering) {
      checkTicket(original, result);
      const ticket = await query(original, true);
      if (!ticket) throw new Error("暂时查不到已收录的原审批单，原记录继续保留，不能重新提案。");
      return ticket;
    }
    return acceptTicket(original, result);
  };
  return {
    record,
    list: (): GParamRecovery[] => pending.list().filter(r => r.adminId === adminId && r.page === page).map(r => {
      const retryExpired = isRetryExpired(r);
      const terminal = !!r.ticket && r.ticket.status !== "pending";
      const auth = useAdminAuth.getState();
      return { ...r, status: terminal ? r.ticket!.status : retryExpired ? "expired" : r.ticket ? "pending" : "unknown",
        retryExpired, canQuery: true, canRelease: terminal,
        canRetry: !terminal && !retryExpired && auth.isAuthenticated && !auth.logoutPending && !!auth.session && auth.session.adminId === adminId
          && auth.session.authorities.includes(gParamAuthority(page, r.request.obj))
          && auth.session.authorities.some(a => a === "platform_a2_proposal_create" || a === "platform_a2_write") };
    }),
    query: (key: string) => {
      const original = record(key);
      return original ? query(original) : Promise.resolve(undefined);
    },
    retry: (key: string) => {
      const original = record(key);
      if (!original) throw new Error("原审批命令已处理，请刷新页面后重新操作。");
      return send(original);
    },
    // Release only after a matching terminal receipt and a successful current read.
    async release(key: string) {
      const original = record(key);
      if (!original) return true;
      const ticket = await query(original);
      return !!ticket && ticket.status !== "pending" && !record(key);
    },
    recheck: refresh,
    // Recovery remains independent of whether the page permits a new edit.
    async open(key: string) {
      const original = record(key);
      if (!original) return undefined;
      try {
        const ticket = await query(original);
        if (ticket && ticket.status !== "pending") return false as const;
      } catch (error) {
        showError(displayAdminError(error));
      }
      // Expired commands and confirmed terminal receipts cannot be submitted again,
      // even when the current read or the original-ticket lookup is unavailable.
      const current = record(key);
      if (isRetryExpired(original)) {
        showError(RETRY_EXPIRED_TEXT);
        return false as const;
      }
      if (current?.ticket && current.ticket.status !== "pending") return false as const;
      return current;
    },
    getPendingReason: (key: string) => record(key)?.request.reason,
    getPendingBusinessValue: (key: string) => {
      const original = record(key);
      return original ? { decisionRef: String(original.request.command.params.decisionRef ?? "") } : undefined;
    },
    async tightenDividend<T>(current: string, value: string, direct: () => Promise<T>): Promise<T> {
      // G4DividendPolicy explicitly permits non-amplifying direct writes while a
      // known dividend proposal is pending. Unknown originals keep their lock.
      if (page !== "G4" || record("dividend")?.ticket?.status !== "pending") {
        throw new Error("请先查询原日分红审批，再按当前状态操作。");
      }
      requireActor("dividend", false);
      const before = rounded(current, 6);
      const candidate = rounded(value, 6);
      if (before === undefined || before <= BigInt(0) || candidate === undefined || candidate > before) {
        throw new Error("已有待审批的日分红提高申请，本次只能收紧当前非零比例；提高请先处理原审批单。");
      }
      return direct();
    },
    async run<T>(change: Change, direct: () => Promise<T>): Promise<{ direct: T } | { proposal: A2OperationRow }> {
      const original = record(change.key);
      if (original) return { proposal: await send(original) };
      requireActor(change.key, false);
      if (!amplifies(page, change)) {
        try { return { direct: await direct() }; }
        catch (error) {
          const required = page === "G4" && change.batchNo ? "G4_EMISSION_APPROVAL_REQUIRED"
            : page === "G4" && change.key === "dividend" ? "G4_DIVIDEND_APPROVAL_REQUIRED"
              : `${page === "G2" ? "G2_EXCHANGE" : page === "G4" ? "G4_GENESIS" : "G7_REPURCHASE"}_PARAM_APPROVAL_REQUIRED`;
          if (reasonCode(error) !== required) throw error;
        }
      }
      const actor = requireActor(change.key, true);
      const op = findHighOp(change.batchNo ? "g4_genesis_rerun_dividend" : ops[page])!;
      const context = { paramKey: change.key, value: change.value,
        ...(page === "G4" && change.key === "dividend" ? {} : { expectedValue: change.current }),
        decisionRef: change.decisionRef, expectedRevision: change.expectedRevision, batchNo: change.batchNo };
      const request: Proposal = {
        action: op.action, obj: change.key, beforeValue: "", afterValue: "",
        operator: actor.operator || actor.username, operatorRole: roleLabel(actor.role),
        type: "fund", amplifies: true, sos: false, roleGate: "超管", reason: change.reason,
        sourceDomain: page, command: op.buildCommand(context), target: op.buildTarget(context),
      };
      const fingerprint = `${actor.adminId}|${page}|${change.key}`;
      const commandKey = createA2CommandKey(`${page.toLowerCase()}-param-proposal`);
      pending.remember(fingerprint, commandKey, { adminId: actor.adminId, page, request });
      changed();
      if (!pending.isDurablyStored(fingerprint, commandKey)) {
        pending.forget(fingerprint, commandKey);
        throw new Error("浏览器存不下完整原请求，本次没有提交审批。");
      }
      return { proposal: await send(record(change.key)!, false) };
    },
  };
}
