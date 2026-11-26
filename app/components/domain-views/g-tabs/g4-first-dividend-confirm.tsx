"use client";

import { fetchG4GenesisOverview, type G4Overview } from "@/lib/admin/g4-client";
import { configApprovalOriginalInput, pendingConfigApproval, submitConfigApproval } from "@/lib/admin/withdrawal-config-approval";
import { replayRejectionText } from "@/lib/admin/retry-rejected";
import { useAdminAuth, type AdminSession } from "@/lib/store/admin-auth";
import { Fact, Facts, StatusTag } from "@/app/components/rd";
import { OperationConfirmModal } from "../design-kit";
import { G4_FIRST_DIVIDEND_TICKET_STATUS, g4ParamValueText } from "./g4-recovery";

export function G4FirstDividendConfirm({ session, epoch, expectedRevision, readbackRate, readActive, canStartNew, onRecoveryStart, onClose, onDone }: {
  session: AdminSession;
  epoch: number;
  expectedRevision: string;
  readbackRate?: string;
  readActive: typeof fetchG4GenesisOverview;
  canStartNew: () => boolean;
  onRecoveryStart: () => void;
  onClose: () => void;
  onDone: (active: G4Overview, acknowledgement: string) => void;
}) {
  const pending = pendingConfigApproval("G4", session.adminId);
  const original = pending ? configApprovalOriginalInput("G4", pending.input) : undefined;
  const ticket = pending?.g4Ticket;
  const currentRateText = !readbackRate?.trim() ? "暂未读到"
    : Number(readbackRate) === 0 ? "未配置" : g4ParamValueText("dividend", readbackRate);
  const readRejection = () => {
    const record = pendingConfigApproval("G4", session.adminId);
    return record && !record.g4Ticket ? replayRejectionText(record) : undefined;
  };

  function requireCurrentMaker(write: boolean) {
    const auth = useAdminAuth.getState();
    if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== session.adminId || auth.authEpoch !== epoch
      || write && !auth.session.authorities.includes("finprod_g4_dividend_rate_write")) {
      throw new Error("登录身份或权限已变化，请关闭弹窗后重新操作。");
    }
  }

  async function submit(mode: boolean | "retry-original", reason = "", value = "", decisionRef = "") {
    requireCurrentMaker(mode !== true);
    if (mode === false && !pendingConfigApproval("G4", session.adminId) && !canStartNew()) {
      onClose();
      throw new Error("当前创世参数暂不能修改，请重新读取当前状态后操作。");
    }
    const recovering = !!pendingConfigApproval("G4", session.adminId);
    if (recovering && mode !== true) onRecoveryStart();
    let readAttempted = false;
    let result;
    try {
      result = await submitConfigApproval("G4", session, mode === false ? {
        paramKey: "dividend", value: value.trim(), decisionRef: decisionRef.trim(), expectedRevision,
      } : null, reason, () => {
        readAttempted = true;
        return readActive();
      }, mode);
    } catch (error) {
      if (mode === "retry-original" && !readAttempted) await Promise.allSettled([readActive()]);
      const knownTicket = pendingConfigApproval("G4", session.adminId)?.g4Ticket;
      if (readAttempted && knownTicket) {
        throw new Error(`审批单 ${knownTicket.id} · ${G4_FIRST_DIVIDEND_TICKET_STATUS[knownTicket.status]}。当前比例读取失败，请查询原操作。`);
      }
      throw error;
    }
    if (!result && recovering) await Promise.allSettled([readActive()]);
    requireCurrentMaker(false);
    if (!result) return false;
    onDone(result.active, result.ticket.status === "pending"
      ? mode === true ? `审批单 ${result.ticket.id} · 等另一位超级管理员批准，尚未生效`
        : `${result.acknowledgement} · 由另一位超级管理员批准`
      : `审批单 ${result.ticket.id} · ${G4_FIRST_DIVIDEND_TICKET_STATUS[result.ticket.status]}。当前比例已重新读取。`);
    return true;
  }

  return <OperationConfirmModal
    action="首次配置每日收益比例"
    title={pending ? "每日收益比例首次配置的原申请" : "首次配置每日收益比例"}
    effect={<StatusTag tone="progress" filled explain="这张首次配置申请要另一位超级管理员批准才生效。">批准后生效</StatusTag>}
    facts={<Facts>
      <Fact k={pending ? "最近读回的比例" : "现在"}>{pending ? currentRateText : "未配置，不发分红；批准前不变"}</Fact>
      <Fact k="谁来批">另一位超级管理员（需有审批批准权限和每日收益比例的修改权限）；你自己不能批</Fact>
      <Fact k="批准后">再核对比例有没有被改过、兑付覆盖率够不够，通过后写入新比例；之后新建的分红批次按它算</Fact>
      <Fact k="付不付钱">批准本身不付钱；之后每天发分红时才付 USDT</Fact>
    </Facts>}
    detail={pending ? "提交原申请时，每日收益比例未配置。当前比例以最近读回为准。" : "当前每日收益比例未配置。"}
    briefKind="config"
    reasonMin={8}
    reasonMax={200}
    edit={{ kind: "number", label: "目标每日收益比例（%）", current: "0", currentLabel: pending ? "提交时的比例" : undefined,
      optionLabels: { "0": "未配置" }, unit: "%",
      min: 0.000001, max: 5, step: 0.000001, initialValue: original?.[0].value, submitEditValue: true, hint: "0.000001–5，单位 %/日" }}
    businessForm={{ kind: "multi-field", fields: [{
      key: "decisionRef", label: "产品或财务决策编号", inputKind: "text",
      current: original?.[0].decisionRef ?? "", minLength: 3, maxLength: 128, required: true, help: "3–128 字，写产品或财务决议的编号",
    }] }}
    getPendingReason={() => {
      const record = pendingConfigApproval("G4", session.adminId);
      return record ? configApprovalOriginalInput("G4", record.input)[1] : undefined;
    }}
    getPendingRecovery={() => {
      const record = pendingConfigApproval("G4", session.adminId);
      const rejection = readRejection();
      return record && rejection ? { expiresAt: record.expiresAt, queryOnly: true, statusText: rejection } : undefined;
    }}
    inlineApproval={{
      pending: !!pending,
      pendingNotice: ticket ? `审批单 ${ticket.id} · 最近一次核对为${G4_FIRST_DIVIDEND_TICKET_STATUS[ticket.status]}。点「查询原操作」更新状态。` : undefined,
      initialRecovery: "lookup",
      queryOnly: !!ticket || !!readRejection(),
      expired: !!pending && (Date.now() < pending.createdAt || Date.now() >= pending.expiresAt),
      expiredRequestRecovery: pending && Date.now() >= pending.expiresAt ? "query" : undefined,
      resolve: () => ({
        heading: "首次配置要另一位超级管理员批准",
        completionCopy: "待审期间这张申请不会改动比例。提交和批准时各核对一次比例有没有被改过、兑付覆盖率够不够。",
      }),
      recover: () => submit(true),
      retry: () => submit("retry-original").then(() => undefined),
    }}
    onClose={onClose}
    onConfirm={(reason, value, businessValue) => submit(false, reason, value, businessValue?.decisionRef).then(() => undefined)}
  />;
}
