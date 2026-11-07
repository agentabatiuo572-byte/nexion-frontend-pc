"use client";
import { operatorNicknameText } from "@/lib/admin/brand-copy";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { ADMIN_ERROR_MESSAGES, displayAdminError } from "@/lib/admin/error-messages";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ClipboardList, Coins, Copy, FileText, Flag, Gauge, History, Inbox, Landmark, Link2, Lock, Receipt, RefreshCw, Route, Shield, ShieldAlert, User, Wallet, type LucideIcon } from "lucide-react";
import { AutoGloss } from "@/app/components/kit/gloss";
import {
  BatchBar, Button, Cell, Checkbox, ColumnPicker, Decision, Drawer, Explain, Fact, Facts, FilterBar, FilterField, Fold, IconButton, Input, IrreversibleTag,
  JudgmentPoints, Modal, MoreMenu, Notice, PageHeader, Pager, Panel, RecordList, ReleaseModal, Segments, Select, Stat, StatBand, StatusTag, Table, Timeline,
  TableLoading, TableMessage, Td, Th, Tr, useTableColumns, type JudgmentRow, type RecordListEntry, type SegmentItem, type StateTone, type TableColumn, type TimelineEntry,
} from "@/app/components/rd";
import { businessClock, businessZone, formatBusinessTimeCompact, formatBusinessTimeFull, parseBusinessTime } from "@/lib/admin/business-time";
import { fmtPct } from "@/lib/format";
import { fetchWithdrawalGateOpen } from "@/lib/admin/ops-dashboard-client";
import { createPendingMutationStore, type PendingMutationExtra, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { useReach } from "@/lib/nav/use-reach";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { bankEvidenceLabels, bankEvidenceTime } from "@/lib/admin/bank-payout-evidence";
import { formatC1DeviceStatus } from "@/lib/admin/c1-detail-display";
import {
  fetchD2WithdrawalDetail,
  fetchD2BankPayout,
  requeryD2BankPayout,
  type D2BankPayout,
  fetchD2CregisPayout,
  recoverD2CregisPayout,
  type D2CregisPayout,
  fetchD2Withdrawals,
  fetchD2DevelopmentCapabilities,
  fetchD5WithdrawalParams,
  reviewD2Withdrawal,
  reviewD2WithdrawalsBatch,
  simulateD2CooldownExpiry,
  type D2BatchResult,
  type D2DevelopmentCapabilities,
  type D2ReviewAction,
  type D2ReviewInput,
  type D2Withdrawal,
  type D5Params,
  type PageResult,
  isDOutcomeUnknownError,
  DRequestError,
} from "@/lib/admin/d-client";
import type { BusinessFormSpec, BusinessFormValue } from "../design-kit";
import type { ActionConfirmReq, DCtx } from "./types";
const OPERATOR = currentAdminOperator;
const STATUS_TABS = [
  ["", "全部"], ["SUBMITTED", "已提交"], ["REVIEW_PENDING", "待审核"], ["EXTENDED_HOLD", "冷却中，等待复查"], ["FROZEN", "冻结"],
  ["REVIEW_PASSED", "已放行"], ["PROCESSING", "处理中"], ["SENT", "银行处理中 / 已发出"], ["CONFIRMED", "已确认"],
  ["REVIEW_REJECTED", "审核拒绝"], ["ADDRESS_INVALID", "地址无效"], ["TX_FAILED", "打款失败"], ["TX_ORPHANED", "打款异常，需人工核对"], ["REFUNDED", "已退款"],
] as const;

const ACTION_AUTHORITY: Record<D2ReviewAction, string> = {
  APPROVE: "finance_d2_withdrawal_approve",
  DELAY: "finance_d2_withdrawal_delay",
  FREEZE: "finance_d2_withdrawal_freeze",
  UNFREEZE: "finance_d2_withdrawal_unfreeze",
  REJECT: "finance_d2_withdrawal_reject",
  REFUND: "finance_d2_withdrawal_refund",
};

/** 批量操作面支持的动作(与 reviewD2WithdrawalsBatch 服务端签名同集合)。"" = 运营尚未显式选择。 */
const BATCH_ACTIONS = ["APPROVE", "REJECT", "DELAY", "FREEZE"] as const;
type D2BatchAction = (typeof BATCH_ACTIONS)[number];
const MOVED_STATE_CODES = ["INVALID_STATE_TRANSITION", "WITHDRAWAL_STATE_CONFLICT", "CREGIS_PAYOUT_ALREADY_DISPATCHED",
  "BANK_PAYOUT_ALREADY_DISPATCHED", "BANK_PAYOUT_RECOVERY_STALE"];

/** 明细按接口精度显示，至少 2 位（TX-20）。币种写在列头时只用这个。 */
function amountText(value: number) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 8, minimumFractionDigits: 2 });
}

function money(value: number) {
  return `${amountText(value)} USDT`;
}
/** 后端给的是没有时区的存储时间，统一按业务时区显示（TX-25、TX-26）。 */
function timeText(value?: string) {
  if (!value) return "—";
  return /[T ]\d{2}:\d{2}$/.test(value) ? formatBusinessTimeCompact(`${value}:00`, "时间待核验") : formatBusinessTimeFull(value, "时间待核验");
}

function listTime(value?: string) {
  return timeText(value).slice(0, 16);
}

/** 复查字段按后端存储时钟（北京时间 UTC+8）显示和提交；期限校验仍按 A3 业务日界。 */
function reviewAtAfter(days: number) {
  const shanghaiOffsetMs = 8 * 3_600_000;
  return new Date(Date.now() + days * 86_400_000 + shanghaiOffsetMs).toISOString().slice(0, 16);
}

function statusLabel(status: string) {
  return ({
    SUBMITTED: "已提交", PENDING: "已提交",
    REVIEW_PENDING: "待审核", REVIEWING: "待审核",
    EXTENDED_HOLD: "冷却中，等待复查", DELAYED: "延迟复查", FROZEN: "冻结",
    REVIEW_PASSED: "已放行", PENDING_CHAIN: "已放行", PROCESSING: "处理中",
    SENT: "已发出", CHAIN_SUBMITTED: "已发出", CONFIRMED: "已到账", SUCCESS: "已到账",
    REVIEW_REJECTED: "审核拒绝", REJECTED: "审核拒绝", ADDRESS_INVALID: "地址无效",
    TX_FAILED: "打款失败", FAILED: "打款失败", TX_ORPHANED: "打款异常，需人工核对", DEAD: "打款异常，需人工核对",
    REFUNDED: "已退款",
  } as Record<string, string>)[status.toUpperCase()] ?? "未知状态";
}

function bankStatusLabel(row: D2Withdrawal) {
  if (erc20ConfirmationLost(row)) return "冻结 · 仍占提现额度";
  if (row.chain !== "BANK-VND") return statusLabel(row.status);
  if (row.status === "SENT") return "银行处理中";
  if (row.status === "TX_ORPHANED") return "人工核对 · 未解冻";
  if (["FAILED", "TX_FAILED"].includes(row.status)) return "打款失败 · 已退回";
  return statusLabel(row.status);
}

function cregisStatusLabel(state: string) {
  return ({ PROCESSING: "已提交给 Cregis，处理中", SENT: "已发出，等待链上确认",
    TX_ORPHANED: "Cregis 处理结果待核对", FAILED: "打款失败", TX_FAILED: "打款失败",
    CONFIRMED: "已到账" } as Record<string, string>)[state] ?? statusLabel(state);
}

function historyStatusLabel(status: string, chain?: string) {
  if (chain === "USDT-ERC20" && ["TX_ORPHANED", "DEAD"].includes(status)) return "冻结 · 仍占提现额度";
  if (chain === "BANK-VND") {
    if (["SENT", "CHAIN_SUBMITTED"].includes(status)) return "银行处理中";
    if (["TX_ORPHANED", "DEAD"].includes(status)) return "人工核对";
    if (["FAILED", "TX_FAILED"].includes(status)) return "打款失败";
  }
  // Older responses have no per-order channel; do not infer it from the open order.
  if (!chain && ["SENT", "CHAIN_SUBMITTED"].includes(status)) return "已发出";
  if (!chain && ["FAILED", "TX_FAILED"].includes(status)) return "处理失败";
  if (!chain && ["TX_ORPHANED", "DEAD"].includes(status)) return "处理异常";
  return statusLabel(status);
}

/** 状态历史只有时间点，事件名写成发生了什么。没有操作人就不写（VS-109）。 */
function statusHistoryEntries(value: string | undefined, chain: string): TimelineEntry[] {
  if (!value?.trim()) return [];
  const labels: Record<string, string> = {
    created: "用户提交提现", chain: chain === "BANK-VND" ? "发给银行打款" : "发到链上", payout: "发给银行打款",
    completed: "打款完成", failed: "打款失败", updated: "状态有更新",
  };
  const entries = value.split("; ").filter(Boolean).flatMap((entry, index) => {
    const separator = entry.indexOf(":");
    const key = entry.slice(0, separator), fact = entry.slice(separator + 1);
    // status 是当前快照，不把它冒充发生于 updated 的状态变更。
    if (key === "status") return [];
    return [{ key, id: `${key}-${index}`, action: labels[key] ?? key, actor: "",
      at: labels[key] ? (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(fact) ? `${fact}:00` : fact) : "",
      detail: labels[key] ? undefined : entry, tone: key === "failed" ? "danger" as const : undefined }];
  });
  // updated 只是这行最后写入的时间，和别的节点同一分钟时不算一件事。同一分钟的后发生的排上面（最新在上）。
  return entries.filter((entry) => entry.key !== "updated" || !entries.some((other) => other !== entry && other.at === entry.at)).reverse();
}

const FAILURE_REASON_LABELS: Record<string, string> = {
  H1_COOLDOWN_FAST_TRACK: "低风险提现冷却中，到期后系统自动复查",
  H1_COOLDOWN_FAST_TRACK_APPROVED: "冷却期已结束，系统已自动放行",
  A3_STRONG_REVIEW_THRESHOLD: "达到大额门槛，需人工复核",
  WITHDRAWAL_KILL_SWITCH_DISABLED: "提现已关停，到期没有自动放行，转人工审核",
  K3_RULE_DELAY: "触发提现风险规则（延迟），等到期复查",
  K3_RULE_FREEZE: "触发提现风险规则（冻结），需人工核实",
  K3_ROUTE_UNAVAILABLE: "提现风险规则暂时无法判断，已转人工复核",
  K4_RISK_SCORE_UNAVAILABLE: "风险分暂时算不出来，已转人工复核",
  WITHDRAWAL_PAYOUT_SUBMISSION_UNKNOWN: "打款结果待确认，请勿重复放行",
  WITHDRAWAL_PAYOUT_PROVIDER_FAILED: "打款服务返回失败，等待人工处理",
};

const OPERATION_TEXT_LABELS: Record<string, string> = {
  REVIEW_REJECTED: "审核拒绝",
  ADDRESS_INVALID: "地址无效",
  EXTENDED_HOLD: "冷却中，等待复查",
  REVIEW_PENDING: "待审核",
  REVIEW_PASSED: "已放行",
  TX_ORPHANED: "打款异常，需人工核对",
  TX_FAILED: "打款失败",
  PROCESSING: "处理中",
  CONFIRMED: "已到账",
  REFUNDED: "已退款",
  SUBMITTED: "已提交",
  FROZEN: "冻结",
  SENT: "已发出",
  APPROVE: "放行",
  REJECT: "拒绝",
  DELAY: "延迟复查",
  UNFREEZE: "解冻",
  FREEZE: "冻结",
  REFUND: "退款",
  "K3_ROUTE:pass": "风险规则：通过",
  "K3_ROUTE:delay": "风险规则：延迟复查",
  "K3_ROUTE:manual": "风险规则：人工复核",
  "K3_ROUTE:freeze": "风险规则：冻结核实",
  "withdraw.submitted": "提现已提交",
  "withdraw.review_due": "到期转人工复核",
  "withdraw.approved": "提现已放行",
  "withdraw.rejected": "提现已拒绝",
  "withdraw.delayed": "提现已延迟复查",
  "withdraw.frozen": "提现已冻结",
  "withdraw.sent": "提现已发出",
  "withdraw.confirmed": "提现已确认到账",
};

function operationalText(value?: string) {
  const raw = value?.trim();
  if (!raw) return "—";
  if (FAILURE_REASON_LABELS[raw]) return FAILURE_REASON_LABELS[raw];
  if (ADMIN_ERROR_MESSAGES[raw]) return ADMIN_ERROR_MESSAGES[raw];
  let result = raw.replace(/(^|;)(K4_MANUAL|K4_HIGH_PRIORITY|K4_ESCALATED):(\d+)(?=;|$)/g,
    (_, separator: string, code: string, score: string) => `${separator}${({
      K4_MANUAL: "风险分需要人工审核",
      K4_HIGH_PRIORITY: "风险分偏高，需优先人工审核",
      K4_ESCALATED: "风险分很高，需加强人工审核",
    } as Record<string, string>)[code]}（评分 ${score}）`);
  for (const [code, label] of Object.entries(OPERATION_TEXT_LABELS).sort(([left], [right]) => right.length - left.length)) {
    result = result.replaceAll(code, label);
  }
  for (const [code, label] of Object.entries(FAILURE_REASON_LABELS).sort(([left], [right]) => right.length - left.length)) {
    result = result.replaceAll(code, label);
  }
  if (result === raw && /^[A-Z0-9_.:-]+$/i.test(raw)) {
    return "原因未知，请联系值班人员";
  }
  if (!/[\u3400-\u9fff]/.test(result) && /[A-Z_]/i.test(result)) {
    return "说明未知，请联系值班人员";
  }
  return result;
}

function ruleSummary(value?: string) {
  const localized = operationalText(value);
  return localized === "—" ? "无" : localized;
}

/** 风险原因是后端拼的一串，「 | 」「;」都分隔过，一条规则一条。 */
function riskReasons(row: D2Withdrawal) {
  return (row.riskReason ?? "").split(/\s*[|;]\s*/).filter(Boolean).map(operationalText);
}

/** 命中规则的白话：优先用风险原因，规则码翻不出来时才退回码本身的翻译。 */
function hitRulesText(row: D2Withdrawal) {
  const reasons = riskReasons(row);
  return !reasons.length || reasons.some((reason) => reason.includes("未知")) ? ruleSummary(row.hitRules) : reasons.join("、");
}

const REJECT_REASON_LABELS: Record<string, string> = { RISK_HIT: "触发风控规则", ADDRESS_RISK: "地址风险", DATA_MISMATCH: "资料不符", USER_CANCELLED: "用户申诉撤回", OTHER: "其他" };

/** 后端把审核表单拼在说明后面：{说明} | code=… | period=… | owner=…。运营看白话，原始串放第三层。 */
function reviewNoteText(value?: string) {
  const [note, ...fields] = (value ?? "").split(" | ");
  const facts = fields.flatMap((field) => {
    const separator = field.indexOf("=");
    const key = field.slice(0, separator), fact = field.slice(separator + 1);
    if (key === "code") return [`拒绝原因：${REJECT_REASON_LABELS[fact] ?? "未知"}`];
    if (key === "holdDays") return [`等待 ${fact} 天`];
    if (key === "period") return [`冻结期限：${freezePeriodLabel(fact)}`];
    if (key === "owner") return [`责任人：${fact}`];
    return [];
  });
  return [note, ...facts].join("；");
}

function lifecycleSummary(row: D2Withdrawal) {
  if (erc20ConfirmationLost(row)) return "链上确认已丢失，资金保持冻结并继续占用提现额度，禁止退款，需核对链上结果。";
  const reason = operationalText(reviewNoteText(row.failureReason));
  if (reason !== "—") return reason;
  if (["EXTENDED_HOLD", "DELAYED"].includes(row.status.toUpperCase())) return "等待复查时间，到期后系统自动处理";
  if (row.status.toUpperCase() === "FROZEN") return "资金已冻结，解冻或到复查时间后回到待审核";
  // 旧单解冻时后端清空过原因（BUG-292），门槛由后端判定，按这条写回来。
  if (["REVIEW_PENDING", "REVIEWING"].includes(row.status.toUpperCase()) && row.addressVerificationRequired) return FAILURE_REASON_LABELS.A3_STRONG_REVIEW_THRESHOLD;
  return STATUS_EXPLAIN[row.status.toUpperCase()]?.split("。")[0] ?? "正常处理中";
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  D2_WITHDRAWAL_SUBMITTED: "提现已提交",
  D2_WITHDRAWAL_REVIEW_APPROVE: "放行", D2_WITHDRAWAL_REVIEW_REJECT: "拒绝", D2_WITHDRAWAL_REVIEW_REJECTED: "拒绝并退回",
  D2_WITHDRAWAL_REVIEW_DELAY: "延迟", D2_WITHDRAWAL_REVIEW_FREEZE: "冻结", D2_WITHDRAWAL_REVIEW_UNFREEZE: "解冻", D2_WITHDRAWAL_REVIEW_REFUND: "手动退款",
  D2_WITHDRAWAL_REVIEW_DUE: "到期转人工复核", D2_WITHDRAWAL_REVIEW_BLOCKED: "放行被系统拦下",
  D2_WITHDRAWAL_BATCH_APPROVE: "批量放行", D2_WITHDRAWAL_BATCH_REJECT: "批量拒绝", D2_WITHDRAWAL_BATCH_DELAY: "批量延迟", D2_WITHDRAWAL_BATCH_FREEZE: "批量冻结",
  D2_WITHDRAWAL_COOLDOWN_AUTO_APPROVED: "冷却到期，系统自动放行", D2_WITHDRAWAL_COOLDOWN_DELAYED: "冷却到期，转延迟复查", D2_WITHDRAWAL_COOLDOWN_FROZEN: "冷却到期，转冻结核实",
  D2_WITHDRAWAL_CHAIN_CONFIRMED: "链上已确认",
};

/** 记录里的时间只有月日时分。事件都发生在提交之后，年份从这笔的提交时间往后算，不用当前年份。 */
function auditTime(monthDayTime: string, createdAt: string) {
  const year = Number(createdAt.slice(0, 4));
  return `${monthDayTime.slice(0, 5) >= createdAt.slice(5, 10) ? year : year + 1}-${monthDayTime}:00`;
}

/** 操作记录是 {内部码}@{时间} | …，内部码不给运营看（DP-30）。没有操作人就不写（VS-109）。 */
function auditTrailEntries(value: string | undefined, createdAt: string): TimelineEntry[] {
  if (!value?.trim()) return [];
  return value.split(" | ").filter(Boolean).map((entry, index) => {
    const separator = entry.lastIndexOf("@");
    const code = separator < 0 ? entry : entry.slice(0, separator);
    const rawTime = separator < 0 ? "" : entry.slice(separator + 1);
    const fullTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(rawTime);
    const at = fullTime ? (/^.{10} \d{2}:\d{2}$/.test(rawTime) ? `${rawTime}:00` : rawTime) : /^\d{2}-\d{2} \d{2}:\d{2}$/.test(rawTime) ? auditTime(rawTime, createdAt) : "";
    return { id: `${code}-${index}`, action: AUDIT_ACTION_LABELS[code] ?? "其他操作", actor: "", at,
      tone: /REJECT|BLOCKED|FAILED/.test(code) ? "danger" : /UNKNOWN/.test(code) ? "warn" : undefined };
  });
}

/** 兼容含渠道的四段记录和旧三段记录；不从当前提现推测历史渠道。 */
function withdrawalHistoryRecords(value: string | undefined, currentNo: string | undefined): RecordListEntry[] {
  if (!value?.trim()) return [];
  return value.split(" | ").filter(Boolean).map((entry, index) => {
    const parts = entry.split("/");
    const [order, chain, status, facts] = parts.length === 4 ? parts : [parts[0], "", parts[1], parts[2]];
    const amount = /^([\d.]+) (\S+)@(.+)$/.exec(facts ?? "");
    if ((parts.length !== 3 && parts.length !== 4) || !amount) return { id: String(index), value: entry };
    return { id: `${order}-${index}`, value: amountText(Number(amount[1])), unit: amount[2],
      at: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(amount[3]) ? `${amount[3]}:00` : amount[3],
      object: chain ? chain === "BANK-VND" ? "越南银行卡 · HDPay" : chain.replace(/^USDT-/, "") : "渠道未提供",
      status: <>{order === currentNo && <><StatusTag tone="done">当前这笔</StatusTag>{" "}</>}<StatusTag tone={statusTone(status)}>{historyStatusLabel(status, chain || undefined)}</StatusTag></>, reference: order };
  });
}

function routeLabel(value?: string) {
  return ({ pass: "通过", delay: "延迟复查", manual: "人工复核", freeze: "冻结核实", "fast-pass": "小额免审" } as Record<string, string>)[value?.toLowerCase() ?? ""] ?? (value ? "未知" : "—");
}

function userStatusLabel(value?: string) {
  return ({ active: "正常", enabled: "正常", frozen: "冻结", disabled: "停用", locked: "锁定" } as Record<string, string>)[value?.toLowerCase() ?? ""] ?? (value ? "未知" : "—");
}

/** 后端在提交时记下当时的运营阶段：H1:M{第几月}:{P1–P6}（AppWithdrawalService）。 */
const H1_RHYTHM = /^H1:M([1-9]\d*):(P[1-6])$/;

function freezePeriodLabel(value?: string) {
  const rhythm = H1_RHYTHM.exec(value ?? "");
  if (rhythm) return `按申请时的运营阶段（第 ${rhythm[1]} 月 · ${rhythm[2]}）`;
  return ({ "7D": "7 天", "14D": "14 天", "30D": "30 天", "45D": "45 天", LONG_TERM: "自定复查（到期回待审核）", SEVEN_DAYS: "7 天", K3_DELAY_ONCE: "到期复核后再延迟一次（以复查时间为准）" } as Record<string, string>)[value?.toUpperCase() ?? ""] ?? (value ? "未知" : "—");
}

/** 待审核是「要处理」列表的默认状态，灰字加时钟；颜色留给冻结、失败、异常这些例外（VS-21）。 */
function statusTone(status: string): StateTone {
  const value = status.toUpperCase();
  if (["CONFIRMED", "SUCCESS"].includes(value)) return "ok";
  if (value === "REFUNDED") return "done";
  if (["REVIEW_REJECTED", "REJECTED", "ADDRESS_INVALID", "TX_FAILED", "FAILED", "TX_ORPHANED", "DEAD"].includes(value)) return "danger";
  if (["REVIEW_PENDING", "REVIEWING"].includes(value)) return "neutral";
  if (value === "FROZEN") return "warn";
  return "progress";
}

/** 待审核行的第二行是套话，只给例外状态写说明。 */
function isReviewPending(status: string) {
  return ["REVIEW_PENDING", "REVIEWING"].includes(status.toUpperCase());
}

const STATUS_ICON: Record<string, LucideIcon> = { FROZEN: Lock, TX_ORPHANED: AlertTriangle, DEAD: AlertTriangle };

/** 状态的白话解释：这个状态意味着什么、下一步谁来做（DP-35）。内容来自下面的流转表和 actionCandidates。 */
const STATUS_EXPLAIN: Record<string, string> = {
  SUBMITTED: "用户刚提交，系统处理后转入待审核，不用操作。",
  REVIEW_PENDING: "等人工审核。有权限的人可以放行、延迟、冻结或拒绝。",
  EXTENDED_HOLD: "等待复查时间，到期后系统自动处理，不用操作。人工延迟的回到待审核；系统冷却的重新检查，通过就放行，否则转待审核、冻结或再延迟一次。",
  FROZEN: "资金已冻结。财务主管或风控主管解冻，或到复查时间，都回到待审核，不会直接打款。",
  REVIEW_PASSED: "审核已放行，等系统打款。打款前还能冻结。",
  PROCESSING: "系统正在打款，打款方未接手前还能冻结。",
  SENT: "已发给银行或链上，等返回结果。银行提现以支付商付款成功为完成。",
  CONFIRMED: "钱已到账，这笔已结束。",
  REVIEW_REJECTED: "审核已拒绝。确认钱没有打出去后手动退款。",
  ADDRESS_INVALID: "收款地址无效。确认钱没有打出去后手动退款。",
  TX_FAILED: "打款失败。银行单系统已退回；其他单确认钱没有打出去后手动退款。",
  TX_ORPHANED: "打款结果不明，要人工核对。不要重新放行。",
  REFUNDED: "钱已退回用户余额，这笔已结束。",
};
function actionLabel(action: D2ReviewAction) {
  return ({ APPROVE: "放行", DELAY: "延迟", FREEZE: "冻结", UNFREEZE: "解冻", REJECT: "拒绝并退款", REFUND: "手动退款" } as const)[action];
}

function actionCandidates(row: D2Withdrawal, cregis?: D2CregisPayout | null): D2ReviewAction[] {
  const status = row.status.toUpperCase();
  if (erc20ConfirmationLost(row)) return [];
  if (["USDT-BEP20", "BEP20"].includes(row.chain)) {
    if (cregis?.withdrawalNo === row.withdrawalNo && cregis.source === "provider") return [];
    if (["PROCESSING", "SENT", "CHAIN_SUBMITTED", "FAILED", "TX_FAILED", "TX_ORPHANED", "DEAD", "REVIEW_REJECTED", "REJECTED", "ADDRESS_INVALID"].includes(status)
        && (!cregis || cregis.withdrawalNo !== row.withdrawalNo)) return [];
  }
  if (row.chain === "BANK-VND" && ["PROCESSING", "FAILED", "TX_FAILED", "TX_ORPHANED", "REVIEW_REJECTED", "ADDRESS_INVALID", "DEAD"].includes(status)) return [];
  if (["REVIEW_PENDING", "REVIEWING"].includes(status)) return ["APPROVE", "DELAY", "FREEZE", "REJECT"];
  if (["EXTENDED_HOLD", "DELAYED"].includes(status)) return [];
  if (["REVIEW_PASSED", "PENDING_CHAIN", "PROCESSING"].includes(status)) return ["FREEZE"];
  if (status === "FROZEN") return ["UNFREEZE"];
  if (["REVIEW_REJECTED", "REJECTED", "ADDRESS_INVALID", "TX_FAILED", "FAILED", "TX_ORPHANED", "DEAD"].includes(status)) return ["REFUND"];
  return [];
}

function erc20ConfirmationLost(row: D2Withdrawal) {
  return ["USDT-ERC20", "ERC20"].includes(row.chain) && ["TX_ORPHANED", "DEAD"].includes(row.status.toUpperCase());
}

/** 状态流转图。节点名取 STATUS_TABS,分支与 actionCandidates 同一套判断。 */
const STATUS_CN: Record<string, string> = Object.fromEntries(STATUS_TABS.filter(([code]) => code).map(([code, label]) => [code, label]));
const D2_HAPPY_PATH = ["SUBMITTED", "REVIEW_PENDING", "REVIEW_PASSED", "PROCESSING", "SENT", "CONFIRMED"];
/** 终态:走到这里就结束,没有出边是对的,不该被下面的死结自检报出来。 */
const D2_TERMINAL = new Set(["CONFIRMED", "REFUNDED"]);
const D2_BRANCHES: { from: string[]; trigger: string; to: string[]; note: string }[] = [
  { from: ["REVIEW_PENDING"], trigger: "点「延迟」", to: ["EXTENDED_HOLD"], note: "操作时要填复查时间" },
  { from: ["EXTENDED_HOLD"], trigger: "等到复查时间", to: ["REVIEW_PENDING", "REVIEW_PASSED", "FROZEN"], note: "人工延迟的回到待审核。系统冷却的重新检查，通过就放行，否则转待审核、冻结或再延迟一次。不用操作" },
  { from: ["REVIEW_PENDING", "REVIEW_PASSED", "PROCESSING"], trigger: "点「冻结」", to: ["FROZEN"], note: "打款前都可以冻结" },
  { from: ["FROZEN"], trigger: "点「解冻」", to: ["REVIEW_PENDING"], note: "回到待审核重新决定" },
  { from: ["FROZEN"], trigger: "等到复查时间", to: ["REVIEW_PENDING"], note: "到时间系统自动送回待审核，不用操作" },
  { from: ["REVIEW_PENDING"], trigger: "点「拒绝并退款」", to: ["REFUNDED"], note: "要选拒绝原因分类，申请金额全额退回用户余额" },
  { from: ["SENT"], trigger: "打款结果返回", to: ["ADDRESS_INVALID", "TX_FAILED", "TX_ORPHANED"], note: "按银行或链上返回的结果处理，结果不明时继续核对" },
  { from: ["REVIEW_REJECTED"], trigger: "手动退款", to: ["REFUNDED"], note: "仅历史遗留记录；提交前先确认钱没有打出去" },
  { from: ["ADDRESS_INVALID", "TX_FAILED", "TX_ORPHANED"], trigger: "手动退款", to: ["REFUNDED"], note: "ERC20 丢失链上确认时冻结并继续占额度，禁止退款；其他单提交前先确认钱没有打出去" },
];

function StatusFlowChip({ code }: { code: string }) {
  return <StatusTag tone={statusTone(code)}>{STATUS_CN[code] ?? code}</StatusTag>;
}

function D2StatusFlow() {
  const drawn = new Set([...D2_HAPPY_PATH, ...D2_BRANCHES.flatMap((b) => [...b.from, ...b.to])]);
  const undrawn = Object.keys(STATUS_CN).filter((code) => !drawn.has(code));
  // 「画上了」不等于「说清楚了」:只查节点在不在,查不出「有入边没出边」的死结 ——
  // 而死结恰恰是最误导的形态(图看着完整,读的人却找不到这个状态之后会怎样)。
  const hasOutEdge = new Set([
    ...D2_HAPPY_PATH.slice(0, -1),
    ...D2_BRANCHES.flatMap((b) => b.from),
  ]);
  const deadEnds = [...drawn].filter((code) => !D2_TERMINAL.has(code) && !hasOutEdge.has(code));
  return (
    <Fold title="提现状态怎么流转" summary={`共 ${Object.keys(STATUS_CN).length} 个状态，和上方筛选项一致`} icon={Route}>
      <div className="rd-flow">
        <span>正常流程：</span>
        {D2_HAPPY_PATH.map((code, index) => (
          <span key={code} className="rd-flow-step">
            {index > 0 && <span aria-hidden>→</span>}
            <StatusFlowChip code={code} />
          </span>
        ))}
      </div>
      <Table label="提现状态流转">
        <thead><tr><Th>从哪个状态</Th><Th>发生什么</Th><Th>去哪个状态</Th></tr></thead>
        <tbody>
          {D2_BRANCHES.map((branch) => (
            <Tr key={`${branch.from.join("+")}-${branch.trigger}`}>
              <Td><span className="rd-flow">{branch.from.map((code) => <StatusFlowChip key={code} code={code} />)}</span></Td>
              <Td>{branch.trigger}<p className="rd-note">{branch.note}</p></Td>
              <Td><span className="rd-flow">{branch.to.map((code) => <StatusFlowChip key={code} code={code} />)}</span></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {undrawn.length > 0 && <Notice tone="warn">以下状态还没画进图里：{undrawn.map((code) => STATUS_CN[code]).join("、")}。</Notice>}
      {deadEnds.length > 0 && <Notice tone="warn">以下状态没写之后会怎样：{deadEnds.map((code) => STATUS_CN[code] ?? code).join("、")}。</Notice>}
    </Fold>
  );
}
function k4RiskText(row: D2Withdrawal) {
  return row.riskScore === null ? "风险分 —" : `风险分 ${row.riskScore}`;
}

function routingPriority(row: D2Withdrawal) {
  return row.routingPriority || "UNAVAILABLE";
}

function routingPriorityLabel(row: D2Withdrawal) {
  return ({
    ESCALATED: "加强审核", HIGH: "高优先", NORMAL: "常规", LOW: "低优先", UNAVAILABLE: "暂无法判断",
  } as const)[routingPriority(row)] ?? "暂无法判断";
}

/** 风险等级是状态：加强审核红，高优先和算不出分橙黄，常规不上色（VS-20）。 */
function routingPriorityTone(row: D2Withdrawal): StateTone | undefined {
  const priority = routingPriority(row);
  if (priority === "ESCALATED") return "danger";
  if (priority === "HIGH" || priority === "UNAVAILABLE") return "warn";
  return undefined;
}
function routingUnavailable(row: D2Withdrawal) {
  return row.riskScore === null || routingPriority(row) === "UNAVAILABLE";
}

/**
 * 批量可执行判定 —— 勾选框禁用态与真正提交的 ids 共用这一处判定(两套判定必然漂移)。
 * 未选择动作时允许先勾选具备任一可用批量动作的行；真正提交时仍按已选动作再次收窄。
 */
function batchSelectable(row: D2Withdrawal, action: D2BatchAction | "", allowedActions: readonly D2BatchAction[], approveBlock: (row: D2Withdrawal) => string | undefined) {
  const candidates = action ? [action] : allowedActions;
  return candidates.some((candidate) => allowedActions.includes(candidate)
    && actionCandidates(row).includes(candidate)
    && !(candidate === "APPROVE" && (row.chain === "BANK-VND" || approveBlock(row))));
}

/**
 * 批量提交面 = 当前筛选后可见 ∩ 已勾选 ∩ 对当前动作可执行。
 * 「已选 N 笔」、批量按钮禁用态、确认弹窗笔数、真正提交的 ids 全部由这一处派生 ——
 * 否则前端筛选把行藏起来后,selected 里的隐藏行仍会被提交(运营看到 3 笔、实际提交 10 笔)。
 */
function batchTargets(visible: D2Withdrawal[], selectedIds: Set<string>, action: D2BatchAction | "", allowedActions: readonly D2BatchAction[], approveBlock: (row: D2Withdrawal) => string | undefined) {
  return visible.filter((row) => selectedIds.has(row.withdrawalNo) && batchSelectable(row, action, allowedActions, approveBlock));
}

/** 确认框短标题：动作加对象，按钮名不能直接拼（VS-101）。 */
const REVIEW_TITLE: Record<D2ReviewAction, string> = { APPROVE: "放行提现", DELAY: "延迟提现", FREEZE: "冻结提现", UNFREEZE: "解冻提现", REJECT: "拒绝提现并退款", REFUND: "手动退款" };

/** 确认框的影响和提交前检查，写这个操作的真实影响（OP-51、OP-53）。 */
const REVIEW_BRIEF: Record<D2ReviewAction, { impact: string; check: string }> = {
  APPROVE: { impact: "审核通过，交给系统打款；打款成功才算完成。", check: "核对用户、金额、收款地址和命中的风险规则，理由写清依据或工单号。" },
  DELAY: { impact: "暂停审核，到复查时间自动回到待审核。", check: "复查时间跟着等待天数走，手动改过要核对，理由写清依据或工单号。" },
  FREEZE: { impact: "冻结资金、不会打款，到复查时间回到待审核。", check: "核对冻结期限、责任人和复查时间，理由写清依据或工单号。" },
  UNFREEZE: { impact: "这笔回到待审核重新决定，不会直接打款。", check: "确认冻结的原因已经核实，理由写清依据或工单号。" },
  REJECT: { impact: "申请金额全额退回用户余额，手续费不扣。", check: "核对用户和拒绝原因，理由写清依据或工单号。" },
  REFUND: { impact: "申请金额全额退回用户余额，手续费不扣。", check: "先到打款方和账单确认钱没有打出去，理由写清依据或工单号。" },
};

/** 确认框常显的「能否撤销」（OP-47）。拒绝和退款收不回来，写成标题下的「不能撤销」标签，不写这一行（VS-106）。 */
const REVIEW_UNDO: Partial<Record<D2ReviewAction, string>> = {
  APPROVE: "打款前可以冻结，打款后不能撤销",
  DELAY: "到复查时间前不能改",
  FREEZE: "可以解冻",
  UNFREEZE: "回到待审核后可以重新决定",
};

/** 「能否撤销」这一行的颜色（VS-106）：打款后才收不回来用橙黄，能改回来的不上色。 */
const REVIEW_UNDO_TONE: Partial<Record<D2ReviewAction, StateTone>> = { APPROVE: "warn" };

/** 生效方式写在标题下面，收不回来的再加「不能撤销」（VS-106）。 */
function reviewEffect(action: D2ReviewAction) {
  return <><StatusTag tone="progress" filled>立即生效</StatusTag>{(action === "REJECT" || action === "REFUND") && <IrreversibleTag />}</>;
}

/** 复查时间怎么定，收进字段名旁的提示图标（DP-06）。 */
const REVIEW_TIME_EXPLAIN: Partial<Record<D2ReviewAction, string>> = {
  DELAY: "复查时间跟着等待天数走。手动改过就保留，和等待天数最多差一天。",
  FREEZE: "复查时间跟着冻结期限走。手动改过就保留，和期限最多差一天。自定复查时间须在未来 1–365 天内，默认 7 天后。",
};

/** 谁能处理：按角色权限种子和后端的角色校验写（B9）。 */
const ACTION_ROLE: Record<D2ReviewAction, string> = {
  APPROVE: "财务或财务主管",
  DELAY: "财务、财务主管、风控或风控主管",
  REJECT: "财务、财务主管、风控或风控主管",
  FREEZE: "财务主管或风控主管",
  UNFREEZE: "财务主管或风控主管",
  REFUND: "财务主管或风控主管",
};

const HOLD_DAYS = /^([1-9]|[1-3][0-9]|4[0-5])$/;
const HOLD_DAYS_ISSUE = "等待天数要是 1–45 的整数";

/** 延迟、冻结的时间校验，不过就不能提交。后端按同一规则拒绝（WITHDRAWAL_DELAY_LIFECYCLE_REQUIRED）。 */
function reviewTimeIssue(action: D2ReviewAction, value: BusinessFormValue) {
  // 等待天数自己的错写在字段下面，这里不重复。
  if (!value.reviewAt || (action === "DELAY" && !HOLD_DAYS.test(value.holdDays ?? ""))) return undefined;
  const holdDays = Number(value.holdDays);
  const reviewAt = parseBusinessTime(value.reviewAt.length === 16 ? `${value.reviewAt}:00` : value.reviewAt);
  if (!Number.isFinite(reviewAt) || reviewAt <= Date.now()) return "复查时间须在未来，请调整。";
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: businessZone().zoneId, year: "numeric", month: "2-digit", day: "2-digit" });
  const days = (Date.parse(date.format(reviewAt)) - Date.parse(date.format(Date.now()))) / 86_400_000;
  if (value.period === "LONG_TERM") return days >= 1 && days <= 365 ? undefined : "自定复查时间须在未来 1–365 天内，请调整复查时间。";
  const expectedDays = action === "DELAY" ? holdDays : Number.parseInt(value.period, 10);
  return Math.abs(days - expectedDays) > 1 ? "复查时间和所选期限相差超过一天，请调整。" : undefined;
}

function actionBusinessForm(action: D2ReviewAction, addressVerificationRequired = false): BusinessFormSpec | undefined {
  if (action === "REJECT") return {
    kind: "multi-field", title: "", fields: [
      { key: "reasonCode", label: "拒绝原因分类", inputKind: "select", required: true, options: ["RISK_HIT", "ADDRESS_RISK", "DATA_MISMATCH", "USER_CANCELLED", "OTHER"], mustChoose: true, optionLabels: REJECT_REASON_LABELS },
    ],
  };
  if (action === "DELAY" || action === "FREEZE") {
    let reviewAtEdited = false;
    return {
      kind: "multi-field", title: "",
      feedback: (value) => {
        const message = reviewTimeIssue(action, value) ?? "";
        return { message, invalid: Boolean(message) };
      },
      onFieldChange: (key, next) => {
        if (key === "reviewAt") reviewAtEdited = true;
        if (!reviewAtEdited && (key === "holdDays" || key === "period")) {
          const days = action === "DELAY" ? Number(next.holdDays) : next.period === "LONG_TERM" ? 7 : Number.parseInt(next.period, 10);
          if (Number.isInteger(days) && days >= 1 && days <= 45) return { ...next, reviewAt: reviewAtAfter(days) };
        }
        return next;
      },
      fields: [
        ...(action === "DELAY"
          ? [{ key: "holdDays", label: "等待天数", inputKind: "number" as const, required: true, wide: true, current: "7", pattern: HOLD_DAYS.source, patternMessage: HOLD_DAYS_ISSUE, help: "1–45 天" }]
          : [{ key: "period", label: "冻结期限", inputKind: "select" as const, required: true, wide: true, options: ["7d", "14d", "30d", "45d", "LONG_TERM"], optionLabels: { "7d": "7 天", "14d": "14 天", "30d": "30 天", "45d": "45 天", LONG_TERM: "自定复查（到期回待审核）" } }]),
        { key: "owner", label: "责任人", required: true, current: OPERATOR() },
        { key: "reviewAt", label: "复查时间", inputKind: "datetime-local", required: true, current: reviewAtAfter(7), help: "北京时间 UTC+8", explain: REVIEW_TIME_EXPLAIN[action] },
      ],
    };
  }
  if (action === "REFUND") return {
    kind: "multi-field", title: "退款前核实", fields: [
      { key: "fundsVerified", label: "我已核实钱没有打出去", inputKind: "checkbox", required: true, wide: true, current: "" },
    ],
  };
  if (action === "APPROVE" && addressVerificationRequired) return {
    kind: "multi-field", title: "大额放行核实", fields: [
      { key: "addressVerified", label: "我已核对地址与风险信息", inputKind: "checkbox", required: true, wide: true, current: "" },
    ],
  };
  return undefined;
}

function businessInput(value?: BusinessFormValue): D2ReviewInput {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    reason: "",
    reasonCode: typeof raw.reasonCode === "string" ? raw.reasonCode : undefined,
    holdDays: raw.holdDays === undefined ? undefined : Number(raw.holdDays),
    period: typeof raw.period === "string" ? raw.period : undefined,
    owner: typeof raw.owner === "string" ? raw.owner : undefined,
    reviewAt: typeof raw.reviewAt === "string" && raw.reviewAt ? raw.reviewAt : undefined,
    fundsVerified: raw.fundsVerified === true || raw.fundsVerified === "true",
    addressVerified: raw.addressVerified === true || raw.addressVerified === "true",
  };
}

function operationKey(scope: string) {
  const compactScope = scope.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 12);
  const uuid = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `d2-${compactScope}-${uuid.replaceAll("-", "").slice(0, 16)}`;
}


type D2PendingCommand = PendingMutationRecord & {
  kind: "review" | "batch" | "cregis" | "bank" | "simulate";
  /** 待确认条上写的「做了什么」。 */
  label: string;
  /** 这次操作涉及的提现单，结果确认前这些单不能再操作（OP-93）。 */
  nos: string[];
  reason: string;
  operator: string;
  action?: D2ReviewAction;
  form?: BusinessFormValue;
  /** 单笔操作发出时的状态，读回时状态变了就说明已经处理过。 */
  fromStatus?: string;
  providerCid?: string;
  version?: number;
};
type D2PendingExtra = PendingMutationExtra<D2PendingCommand>;

/** 逐笔审核与批量审核共用一张表,靠 fingerprint 前缀分命名空间;刷新后仍能用同一命令号重试,
 *  避免运营在「结果未知」后重铸命令号导致重复放行 / 重复退款。原操作内容一起存，重试只能原样（OP-94）。 */
const pendingKeys = createPendingMutationStore<D2PendingCommand>({
  storageKey: "nexion-admin-d2-withdrawal-commands-v1",
  // 过期后不能再用原号重试，记录和对象锁都留着（OP-96）。
  retainExpiredRecords: true,
  // 批量重试直接用记录里的单号和内容，坏记录不能当原操作重发。
  isValidRecord: (record) => {
    if (record.kind !== "batch") return true;
    const action = record.action as D2BatchAction;
    return BATCH_ACTIONS.includes(action)
      && Array.isArray(record.nos) && record.nos.length > 0
      && record.nos.every((id) => typeof id === "string" && id.length > 0)
      && typeof record.reason === "string"
      && (record.form === undefined || !!record.form && typeof record.form === "object"
        && !Array.isArray(record.form) && Object.values(record.form).every((value) => typeof value === "string"))
      && record.fingerprint === batchScope(action, record.nos);
  },
});
/** 目标对象 id = 提现单号;动作类型 = APPROVE/REJECT/… —— 两者都进指纹,不同单不同动作不撞 key。 */
const reviewScope = (withdrawalNo: string, action: D2ReviewAction) => `review|${withdrawalNo}|${action}`;
/** 批量的目标对象 = 本次提交的提现单号集合(排序后),动作类型同上。 */
const batchScope = (action: D2BatchAction, ids: string[]) => `batch|${action}|${[...ids].sort().join(",")}`;
const developmentSimulationScope = (withdrawalNo: string) => `simulate-due|${withdrawalNo}`;

/** 批量里没执行的单，按原因分组写清楚。 */
function batchConflictText(result: D2BatchResult) {
  const groups = new Map<string, string[]>();
  for (const conflict of result.conflicts) groups.set(conflict.reason, [...(groups.get(conflict.reason) ?? []), conflict.withdrawalId]);
  return [...groups].map(([reason, ids]) => `${ids.length} 笔（${ids.join("、")}）：${MOVED_STATE_CODES.includes(reason) ? "状态已变化 · " : ""}${displayAdminError(new Error(reason))}`).join("；");
}

function developmentSimulationEligible(row: D2Withdrawal) {
  return row.status.toUpperCase() === "EXTENDED_HOLD"
    && row.lifecycleOwner === "H1_PHASE_COOLDOWN"
    && row.previousStatus.toUpperCase() === "REVIEW_PASSED"
    && !!row.holdUntil;
}

/** 状态分组只是把 13 个状态排好，不改枚举（ST-68）。默认看「要处理」，待处理的状态都在这一组（DP-03）。 */
type D2Group = "todo" | "system" | "done" | "all";
const STATUS_GROUPS: readonly { value: Exclude<D2Group, "all">; label: string; allLabel: string; tone: StateTone; statuses: readonly string[] }[] = [
  { value: "todo", label: "要处理", allLabel: "全部要处理状态", tone: "warn", statuses: ["REVIEW_PENDING", "FROZEN", "REVIEW_REJECTED", "ADDRESS_INVALID", "TX_FAILED", "TX_ORPHANED"] },
  { value: "system", label: "系统处理中", allLabel: "全部系统处理中状态", tone: "progress", statuses: ["SUBMITTED", "EXTENDED_HOLD", "REVIEW_PASSED", "PROCESSING", "SENT"] },
  { value: "done", label: "已结束", allLabel: "全部已结束状态", tone: "done", statuses: ["CONFIRMED", "REFUNDED"] },
];
const ALL_STATUSES = STATUS_GROUPS.flatMap((group) => group.statuses);
const groupStatuses = (group: D2Group) => STATUS_GROUPS.find((item) => item.value === group)?.statuses ?? ALL_STATUSES;

interface D2Filters {
  keyword: string; minAmount: string; maxAmount: string; minRiskScore: string; ipSegment: string; sortBy: string; sortDirection: string;
}
interface D2Query extends D2Filters { group: D2Group; status: string; page: number; pageSize: number }

const DEFAULT_FILTERS: D2Filters = { keyword: "", minAmount: "", maxAmount: "", minRiskScore: "", ipSegment: "", sortBy: "createdAt", sortDirection: "desc" };
const DEFAULT_QUERY: D2Query = { ...DEFAULT_FILTERS, group: "todo", status: "", page: 1, pageSize: 10 };
const PAGE_SIZES = [10, 20, 50] as const;
const SORT_FIELDS = ["createdAt", "amount", "riskScore", "status"];
const AMOUNT_PATTERN = /^\d+(\.\d+)?$/;
const riskScoreIsValid = (value: string) => value === "" || /^\d{1,3}$/.test(value) && Number(value) <= 100;

function filtersOf(query: D2Query): D2Filters {
  const { keyword, minAmount, maxAmount, minRiskScore, ipSegment, sortBy, sortDirection } = query;
  return { keyword, minAmount, maxAmount, minRiskScore, ipSegment, sortBy, sortDirection };
}

/** 网址参数不合法时回默认值，不筛空页面（ST-26）。 */
function queryFromUrl(params: { get: (name: string) => string | null } | null): D2Query {
  const read = (name: string) => params?.get(name)?.trim() ?? "";
  const groupParam = read("group");
  const group: D2Group = groupParam === "all" || STATUS_GROUPS.some((item) => item.value === groupParam) ? groupParam as D2Group : DEFAULT_QUERY.group;
  const page = Number(read("page"));
  const pageSize = Number(read("pageSize"));
  const amount = (name: string) => AMOUNT_PATTERN.test(read(name)) ? read(name) : "";
  return {
    group,
    status: groupStatuses(group).includes(read("status")) ? read("status") : "",
    keyword: read("q"),
    minAmount: amount("minAmount"),
    maxAmount: amount("maxAmount"),
    minRiskScore: riskScoreIsValid(read("minRiskScore")) ? read("minRiskScore") : "",
    ipSegment: read("ipSegment"),
    sortBy: SORT_FIELDS.includes(read("sort")) ? read("sort") : DEFAULT_QUERY.sortBy,
    sortDirection: read("dir") === "asc" ? "asc" : DEFAULT_QUERY.sortDirection,
    page: Number.isSafeInteger(page) && page > 0 ? page : DEFAULT_QUERY.page,
    pageSize: PAGE_SIZES.some((size) => size === pageSize) ? pageSize : DEFAULT_QUERY.pageSize,
  };
}

/** 查询状态写网址，替换方式，不加浏览器历史（ST-23）。只动这页的参数，默认值不写。 */
function writeQueryToUrl(query: D2Query, rule: string) {
  const params = new URLSearchParams(window.location.search);
  const entries: [string, string | number, string | number][] = [
    ["group", query.group, DEFAULT_QUERY.group], ["status", query.status, ""], ["q", query.keyword, ""],
    ["minAmount", query.minAmount, ""], ["maxAmount", query.maxAmount, ""], ["minRiskScore", query.minRiskScore, ""],
    ["ipSegment", query.ipSegment, ""], ["rule", rule, ""], ["sort", query.sortBy, DEFAULT_QUERY.sortBy],
    ["dir", query.sortDirection, DEFAULT_QUERY.sortDirection], ["page", query.page, 1], ["pageSize", query.pageSize, DEFAULT_QUERY.pageSize],
  ];
  for (const [name, value, fallback] of entries) {
    if (value === fallback) params.delete(name);
    else params.set(name, String(value));
  }
  const search = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
}

/** 后端 ORDER BY 的本地版：按提交时间排时先按风险档，紧急的在前。 */
function riskRank(row: D2Withdrawal) {
  if (row.riskScore === null) return 4;
  if (row.k4AutoEscalateScore !== null && row.riskScore >= row.k4AutoEscalateScore) return 0;
  if (row.k4BandHighMin !== null && row.riskScore >= row.k4BandHighMin) return 1;
  if (row.k4BandLowMax !== null && row.riskScore >= row.k4BandLowMax) return 2;
  return 3;
}

function compareRows(left: D2Withdrawal, right: D2Withdrawal, sortBy: string, sortDirection: string) {
  if (sortBy === "createdAt" && riskRank(left) !== riskRank(right)) return riskRank(left) - riskRank(right);
  const value = (row: D2Withdrawal) => sortBy === "amount" ? row.amount : sortBy === "riskScore" ? row.riskScore ?? -1 : sortBy === "status" ? row.status : row.createdAt;
  const [a, b] = [value(left), value(right)];
  if (a !== b) return (a < b ? -1 : 1) * (sortDirection === "asc" ? 1 : -1);
  return right.id - left.id;
}

/** 接口的 status 只收一个值。看整组时按状态分别取到当前页为止，合并排序后切出这一页，总数相加。 */
async function fetchQueue(query: D2Query): Promise<PageResult<D2Withdrawal>> {
  const filters = filtersOf(query);
  const statuses = query.status ? [query.status] : query.group === "all" ? [] : groupStatuses(query.group);
  if (statuses.length <= 1) {
    return fetchD2Withdrawals({ ...filters, status: statuses[0] ?? "", pageNum: query.page, pageSize: query.pageSize });
  }
  const needed = query.page * query.pageSize;
  const chunk = Math.min(needed, 100);
  const parts = await Promise.all(statuses.map(async (status) => {
    const records: D2Withdrawal[] = [];
    for (let pageNum = 1; ; pageNum += 1) {
      const result = await fetchD2Withdrawals({ ...filters, status, pageNum, pageSize: chunk });
      records.push(...result.records);
      if (result.records.length === 0 || records.length >= Math.min(needed, result.total)) return { total: result.total, records };
    }
  }));
  const merged = parts.flatMap((part) => part.records).sort((left, right) => compareRows(left, right, query.sortBy, query.sortDirection));
  return {
    total: parts.reduce((sum, part) => sum + part.total, 0),
    pageNum: query.page,
    pageSize: query.pageSize,
    records: merged.slice(needed - query.pageSize, needed),
  };
}

const QUEUE_COLUMNS: readonly TableColumn[] = [
  { key: "no", label: "提现单 · 时间", locked: "第一列不能关" },
  { key: "user", label: "用户" },
  { key: "amount", label: "金额" },
  { key: "risk", label: "风险", locked: "风险要一直看得到" },
  { key: "status", label: "状态", locked: "状态要一直看得到" },
  { key: "asset", label: "资产 / 链", extra: true },
  { key: "fee", label: "手续费", extra: true },
  { key: "account", label: "账户状态", extra: true },
  { key: "lifecycle", label: "生命周期 / 异常", extra: true },
  { key: "action", label: "操作", locked: "操作列不能关" },
];

const RETRY_EXPIRED = "已超过 24 小时，不能再重试，请到操作记录与审批核对";
const RETRY_NO_PERMISSION = "这个账号现在没有这项操作的权限，不能重试，请到操作记录与审批核对";

const RECOVERY_HINT: Record<string, string> = {
  review: "读回只看这笔现在的状态，说明不了这次操作的结果。可以按原操作重试，不会重复执行。",
  batch: "请不要改变勾选直接重试，否则已放行的部分可能被重复放行",
  cregis: "按原操作重试不会重新打款。",
  bank: "按原操作重试只查询原单，不会重新打款。",
  simulate: "只在本地开发环境出现。",
};

/** 风险分明细是后端拼的「键=值」，键名换成白话，和抽屉里别的键值一个写法。 */
function riskBreakdownFacts(value?: string) {
  const labels: Record<string, string> = { 提交快照: "提交时风险分", 当前模型: "现在的风险分", 人工覆盖: "人工调整", 决策: "风控决定", 规则: "命中规则" };
  return factRows(value, "风险分明细").map((row) => <Fact key={row.key} k={labels[row.label] ?? row.label}>
    {row.value}{/^\d+(\.\d+)?$/.test(row.value) && ["提交快照", "当前模型", "人工覆盖"].includes(row.label) ? " 分" : ""}
  </Fact>);
}

/** 风险等级和分数，确认框常显（DP-03）。命中规则另起一行，一个值一条事实（VS-109）。 */
function riskFact(row: D2Withdrawal) {
  const tone = routingPriorityTone(row);
  const level = `${routingPriorityLabel(row)}，${k4RiskText(row)}`;
  return tone ? <StatusTag tone={tone} icon={tone === "danger" ? ShieldAlert : Flag}>{level}</StatusTag> : level;
}

/** 收款渠道，判断要点、确认框、抽屉一个写法。 */
function payoutChannel(row: D2Withdrawal) {
  return row.chain === "BANK-VND" ? "越南银行卡 · HDPay" : chainText(row);
}

/** 后端原文是第三层（DP-01）：查证时才点开，样子是文字链，不是术语提示。 */
function RawRecord({ label, content }: { label: string; content: ReactNode }) {
  return <span className="d2-raw"><Explain label={label} content={content}>查看原始记录</Explain></span>;
}

/** 确认框常显的对象、金额、风险和能否撤销，执行摘要收起后不能只写在摘要里（OP-48）。放行再加收款信息和覆盖率（F01、OP-42）：要人逐字核对的收款地址紧跟金额。 */
function reviewFacts(row: D2Withdrawal, action: D2ReviewAction, bank: D2BankPayout | null, coverage: ReactNode) {
  const bankRow = row.chain === "BANK-VND";
  return (
    <Facts>
      {/* 金额是这个框的关键数字，放第一行（VS-102）。 */}
      <Fact k="金额" lead tone="role-1" unit={row.asset}>{amountText(row.amount)}</Fact>
      {action === "APPROVE" && bankRow && <Fact k="收款账号"><span data-mono>{bank ? `${bank.bankName} ${bank.maskedAccount}` : "读取中，请在详情里核对"}</span></Fact>}
      {action === "APPROVE" && !bankRow && <Fact k="收款地址"><span data-mono>{row.targetAddress}</span></Fact>}
      {action === "APPROVE" && <Fact k="收款网络">{payoutChannel(row)}</Fact>}
      <Fact k="用户">{operatorNicknameText(row.nickname)} {row.userNo}</Fact>
      <Fact k="提现单"><span data-mono>{row.withdrawalNo}</span></Fact>
      {action !== "REFUND" && <Fact k="风险">{riskFact(row)}</Fact>}
      {action !== "REFUND" && <Fact k="命中规则">{hitRulesText(row)}</Fact>}
      {/* 手动退款要勾「我已核实钱没有打出去」，核实要看的东西放在框里（DT-10）。 */}
      {action === "REFUND" && <Fact k="打款结果">{lifecycleSummary(row)}</Fact>}
      {action === "REFUND" && <Fact k="交易哈希">{row.chainTxHash ? <span data-mono>{row.chainTxHash}</span> : "没有记录"}</Fact>}
      {action === "APPROVE" && coverage}
      {REVIEW_UNDO[action] && <Fact k="能否撤销" tone={REVIEW_UNDO_TONE[action]}>{REVIEW_UNDO[action]}</Fact>}
    </Facts>
  );
}

/** 待审核单的 holdUntil 等于提交时间，只有冷却和冻结的复查时间有意义（实测）。 */
function holdsForReview(row: D2Withdrawal) {
  return Boolean(row.holdUntil) && ["EXTENDED_HOLD", "DELAYED", "FROZEN"].includes(row.status.toUpperCase());
}

/** 后端的「键=值; 键=值」摘要写成白话的分隔。 */
function factRows(value: string | undefined, label: string) {
  if (!value?.trim()) return [];
  return value.split("; ").filter(Boolean).map((entry, index) => {
    const localized = operationalText(entry);
    const separator = localized.indexOf("=");
    return { key: `${label}-${index}`, label: separator < 0 ? label : localized.slice(0, separator),
      value: separator < 0 ? localized : localized.slice(separator + 1) };
  });
}

function chainText(row: D2Withdrawal) {
  return `${row.asset} / ${row.chain.replace(/^USDT-/, "")}`;
}

/** 设备摘要是「总设备=3; 活跃=2; 最近=名称/状态/地域」，键名和状态码都换成白话（DP-30）。 */
function deviceFacts(value?: string) {
  const labels: Record<string, string> = { 总设备: "设备总数", 活跃: "运行中的设备", 最近: "最近活动的设备" };
  return factRows(value, "设备").map((row) => {
    const [name, status, place] = row.value.split("/");
    return <Fact key={row.key} k={labels[row.label] ?? row.label}>{row.label === "最近" && place ? `${name}，${formatC1DeviceStatus(status)}，${place}` : row.value}</Fact>;
  });
}

/** 只转换后端已确认的系统值；人工填写的责任人保留原文（DP-30）。 */
function lifecycleOwnerText(owner?: string) {
  return !owner || ["H1_PHASE_COOLDOWN", "H1_ZERO_DAY_AUTO_REVIEW", "K3_EXPIRY_DELAY", "K3_RULE_FREEZE", "K3_RULE_DELAY"].includes(owner) ? "系统自动" : owner;
}

/** 这两种状态放行一定不生效，入口禁用，不开框（DP-42）。提现开关读不到时照旧开框，后端再查。 */
function approveGateText(gate: "open" | "closed" | "unknown" | null, d5: D5Params | null) {
  if (gate === "closed") return "提现已关停，现在放行不会生效。到「紧急停用开关」恢复提现后再放行。";
  if (d5 && d5.coverageRatio < d5.redlinePct) return `兑付覆盖率 ${fmtPct(d5.coverageRatio)}，低于红线 ${d5.redlinePct}%，现在不能放行。到「资金储备与应付款」补足储备后再放行。`;
  return undefined;
}

/** 列表里看不出全部原因时写在这里：批量勾选框的提示要说真话，要人处理的不能写成不用处理。 */
function noBatchHint(row: D2Withdrawal) {
  const status = row.status.toUpperCase();
  const needsPerson = actionCandidates(row).length > 0 || (["TX_ORPHANED", "DEAD"].includes(status)
    || (row.chain !== "BANK-VND" && [...STATUS_GROUPS[0].statuses, "REJECTED", "FAILED"].includes(status)));
  return needsPerson ? "这个状态不能批量处理，打开详情单独处理" : "这个状态不用人工处理";
}

const BANK_BLOCK = "收款账户暂不能审核放行，原因见详情里的「HDPay 银行打款」。";
const LARGE_BLOCK = "这笔达到大额门槛，要财务主管放行";

function shortAddress(value: string) {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

/** 真实单号有 36 位，列表里中间省略，全文在 title 和详情里；读屏仍读全号。 */
function shortNo(value: string) {
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
}

function countEntries(value: string | undefined, separator: string) {
  return value?.trim() ? value.split(separator).filter((item) => item.trim()).length : 0;
}

export function D2Withdrawals({ ctx }: { ctx: DCtx }) {
  const { toast } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const searchParams = useSearchParams();
  // query 是已应用的条件，列表、翻页、统计都只用它；draft 是输入框里的草稿，点「查询」才生效（ST-18）。
  const [query, setQuery] = useState<D2Query>(() => queryFromUrl(searchParams));
  const [draft, setDraft] = useState<D2Filters>(() => filtersOf(query));
  const [ruleFilter, setRuleFilter] = useState(() => searchParams?.get("rule")?.trim() ?? "");
  const [riskDropped, setRiskDropped] = useState("");
  const [amountRangeInvalid, setAmountRangeInvalid] = useState(false);
  const [rows, setRows] = useState<PageResult<D2Withdrawal>>({ total: 0, pageNum: 1, pageSize: 10, records: [] });
  const [d5, setD5] = useState<D5Params | null>(null);
  const [statusCounts, setStatusCounts] = useState<Record<string, number> | null>(null);
  const [countsFailed, setCountsFailed] = useState(false);
  /** 提现总开关。null 是还没读到；读不到写 unknown，放行时后端还会再查。 */
  const [withdrawGate, setWithdrawGate] = useState<"open" | "closed" | "unknown" | null>(null);
  const [developmentCapabilities, setDevelopmentCapabilities] = useState<D2DevelopmentCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [readAt, setReadAt] = useState("");
  const [error, setError] = useState("");
  const [writesEnabled, setWritesEnabled] = useState(false);
  const [submitting, setSubmitting] = useState("");
  const [pendingCommands, setPendingCommands] = useState<D2PendingCommand[]>([]);
  /** 待确认条上最近一次读回或重试的结果，只是当下的事实，不影响待确认本身。 */
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({});
  /** 最近一次重试被后端明确拒绝的命令号，只有它们才能人工解除。按命令号记，解除后重新处理的新命令不沿用。 */
  const [retryRejected, setRetryRejected] = useState<string[]>([]);
  const [releasing, setReleasing] = useState<D2PendingCommand | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 无默认动作：必须由运营显式选择后才可提交；但允许先勾选，再选动作。
  const [batchAction, setBatchAction] = useState<D2BatchAction | "">("");
  const [batchResult, setBatchResult] = useState<{ action: D2BatchAction; result: D2BatchResult } | null>(null);
  const [detail, setDetail] = useState<D2Withdrawal | null>(null);
  const [bankDetail, setBankDetail] = useState<D2BankPayout | null>(null);
  const [cregisDetail, setCregisDetail] = useState<D2CregisPayout | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  /** 单调递增请求号:并发 load 时只有最后一发的响应可以落地,旧响应不许覆盖新筛选结果。 */
  const requestSeq = useRef(0);
  const countSeq = useRef(0);
  /** 详情抽屉同样只接受最后一次请求；关闭抽屉会主动让在途响应失效。 */
  const detailRequestSeq = useRef(0);
  // 确认框的回调在打开时就定了，提交完要按当时最新的条件和抽屉刷新。
  const queryRef = useRef(query);
  queryRef.current = query;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const detailRef = useRef(detail);
  detailRef.current = detail;
  /** 关抽屉时内容还要跟着滑出去。 */
  const drawerRow = useRef(detail);
  if (detail) drawerRow.current = detail;
  const lastDetailIndex = useRef(0);
  // 提交失败时框已打开，它的回调是旧的；这三个在读到新数据时立刻更新，框里按这次刷新的结果判断（OP-127）。
  const d5Ref = useRef<D5Params | null>(null);
  const gateRef = useRef<typeof withdrawGate>(null);
  const writesRef = useRef(false);
  const reviewConfirmSeq = useRef(0);
  const openActionConfirm: DCtx["openActionConfirm"] = (request) => {
    reviewConfirmSeq.current += 1;
    ctx.openActionConfirm(request);
  };

  const hasAuthority = (authority: string) => authorities.includes(authority);
  /** 跨页入口按目标页可不可达显示（X03）。 */
  const reach = useReach();
  // Q-16：没有 D5 读权时列表照常，额度写无权限，用到额度的决定禁用。读取失败不算这种情况，仍然全部暂停。
  const canReadD5 = hasAuthority("finance_d5_read");
  const canReadUserDetail = reach("/users/search", "user_c1hub_read");
  // 达到大额门槛的放行，后端只认财务主管和超管（isD2RoleAllowed），其他账号提交必被拒，入口直接禁用。
  const canApproveLarge = ["FINANCE_LEAD", "superadmin"].includes(session?.role ?? "");
  // 冻结、解冻和手动退款另有角色门槛，动作权限仍按原权限码判断。
  const canManageRestricted = ["FINANCE_LEAD", "RISK_LEAD", "superadmin"].includes(session?.role ?? "");
  const roleBlock = (action?: D2ReviewAction) => !canManageRestricted && action && ["FREEZE", "UNFREEZE", "REFUND"].includes(action)
    ? "冻结、解冻和手动退款需财务主管、风控主管或超级管理员操作"
    : undefined;
  /** 只看这一笔的情况就知道放行必被拒的原因，行、抽屉、批量共用（DP-42）。全局的开关和覆盖率在 approveGateText。 */
  const approvalRole = (row: D2Withdrawal) => row.addressVerificationRequired === true ? "财务主管" : ACTION_ROLE.APPROVE;
  const approveBlock = (row: D2Withdrawal) => {
    if (routingUnavailable(row)) return "风险分暂时算不出来，暂不能放行";
    if (!canApproveLarge && row.addressVerificationRequired === true) return `这笔是大额提现，需${approvalRole(row)}放行`;
    if (row.userStatus.toUpperCase() !== "ACTIVE") return `账户状态是「${userStatusLabel(row.userStatus)}」，账户恢复正常后才能放行`;
    if (row.holdUntil && parseBusinessTime(row.holdUntil) > Date.now()) return `冷却到 ${timeText(row.holdUntil)}，到时间后才能放行`;
    return undefined;
  };
  const canBatch = hasAuthority("finance_d2_withdrawal_batch");
  const availableBatchActions = BATCH_ACTIONS.filter((action) => hasAuthority(ACTION_AUTHORITY[action]) && !roleBlock(action) && (action !== "APPROVE" || canReadD5));
  const showSelection = canBatch && (availableBatchActions.length > 0 || hasAuthority(ACTION_AUTHORITY.FREEZE));
  const canWriteAny = Object.values(ACTION_AUTHORITY).some(hasAuthority);
  const dailyLimit = d5?.dailyLimitCount ?? 0;
  const pendingNos = useMemo(() => new Set(pendingCommands.flatMap((record) => record.nos)), [pendingCommands]);
  const columns = useTableColumns("d2-queue", QUEUE_COLUMNS);

  const syncPending = () => setPendingCommands(pendingKeys.list().filter((record) => record.kind));

  const load = async (next = queryRef.current) => {
    const seq = ++requestSeq.current;
    // 翻页、切状态或操作后的刷新按上次生效的值查，输入框改回这个值，不再留着被拒绝的数。
    const rejected = draftRef.current.minRiskScore;
    const dropped = riskScoreIsValid(rejected) ? "" : rejected;
    if (dropped) setDraft((current) => ({ ...current, minRiskScore: next.minRiskScore }));
    setRiskDropped(dropped);
    setLoading(true);
    setError("");
    setWritesEnabled(false);
    try {
      const [nextRows, nextD5] = await Promise.all([
        fetchQueue(next),
        canReadD5 ? fetchD5WithdrawalParams() : null,
      ]);
      if (seq !== requestSeq.current) return;
      setRows(nextRows);
      setD5(nextD5);
      d5Ref.current = nextD5;
      writesRef.current = true;
      setSelected(new Set());
      setWritesEnabled(true);
      setReadAt(businessClock(Date.now()));
      // 数据变少时收回到最后一页，只在读取成功后收回（ST-13）。
      const lastPage = Math.max(1, Math.ceil(nextRows.total / next.pageSize));
      if (next.page > lastPage) setQuery((current) => ({ ...current, page: lastPage }));
    } catch (cause) {
      if (seq !== requestSeq.current) return;
      setRows({ total: 0, pageNum: 1, pageSize: next.pageSize, records: [] });
      setD5(null);
      d5Ref.current = null;
      writesRef.current = false;
      setError(cause instanceof Error ? displayAdminError(cause) : "加载失败，请重试");
    } finally {
      // 过期响应连 loading 都不许收:新请求仍在飞,收了会假装「加载完成」。
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  /** 三组的数量。接口没有按组计数，按 13 个状态各取总数，不跟筛选走，读不到写「—」，不挡列表和操作。 */
  const loadCounts = async () => {
    const seq = ++countSeq.current;
    try {
      const pages = await Promise.all(ALL_STATUSES.map((status) => fetchD2Withdrawals({ status, pageNum: 1, pageSize: 1 })));
      if (seq !== countSeq.current) return;
      setStatusCounts(Object.fromEntries(ALL_STATUSES.map((status, index) => [status, pages[index].total])));
      setCountsFailed(false);
    } catch {
      if (seq !== countSeq.current) return;
      setStatusCounts(null);
      setCountsFailed(true);
    }
  };

  const loadGate = async () => {
    let gate: "open" | "closed" | "unknown";
    try {
      gate = await fetchWithdrawalGateOpen() ? "open" : "closed";
    } catch {
      gate = "unknown";
    }
    gateRef.current = gate;
    setWithdrawGate(gate);
  };

  const refresh = () => Promise.all([load(), loadCounts(), loadGate()]);

  useEffect(() => { void load(query); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [query]);
  useEffect(() => { void loadCounts(); void loadGate(); syncPending(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { writeQueryToUrl(query, ruleFilter); }, [query, ruleFilter]);
  // 后端只在私有 dev 注册此能力；公网及生产构建不应探测不存在的接口。
  const developmentCapabilitiesProbed = useRef(false);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development"
        || !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)
        || !detail || developmentCapabilitiesProbed.current) return;
    developmentCapabilitiesProbed.current = true;
    let active = true;
    void fetchD2DevelopmentCapabilities()
      .then((capabilities) => { if (active) setDevelopmentCapabilities(capabilities); })
      .catch(() => { if (active) setDevelopmentCapabilities(null); });
    return () => { active = false; };
  }, [detail]);

  const visibleRows = useMemo(() => {
    const rule = ruleFilter.trim().toLowerCase();
    return rule ? rows.records.filter((row) => `${row.hitRules} ${row.riskReason}`.toLowerCase().includes(rule)) : rows.records;
  }, [rows.records, ruleFilter]);
  // 结果未确认的单不能再进批量，否则换集合重发可能重复放行（OP-107）。
  const batchableRows = useMemo(() => visibleRows.filter((row) => !pendingNos.has(row.withdrawalNo)), [visibleRows, pendingNos]);
  const selectedRows = useMemo(
    () => batchTargets(batchableRows, selected, "", availableBatchActions, approveBlock),
    // authorities only changes with the authenticated session; keeping the derived action list explicit avoids hidden defaults.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [batchableRows, selected, authorities],
  );
  const submittableRows = useMemo(
    () => batchTargets(batchableRows, selected, batchAction, availableBatchActions, approveBlock),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [batchableRows, selected, batchAction, authorities],
  );
  // 纯前端筛选变化时只剔除已不可见或完全没有批量权限的行。
  // 切换批量动作不静默取消勾选；不适用当前动作的行保留勾选，并在提交面明确显示“可执行 N 笔”。
  useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) return current;
      const kept = batchTargets(batchableRows, current, "", availableBatchActions, approveBlock).map((row) => row.withdrawalNo);
      return kept.length === current.size ? current : new Set(kept);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchableRows, authorities]);

  /**
   * 写操作共用一条路：先把原操作存好再发（OP-92）；确定失败丢号，留在确认框；结果未知保号，关框，
   * 转成页面上方的待确认条，这笔单在确认前不能再操作（OP-93）。
   * 🔴 新号被确定性拒绝必须丢号:4xx 被驳回后运营会改输入重提,若还留着旧号 = 同号不同载荷 → 这张单子这个动作 24h 内做不了。
   *    结果未知则必须保号 —— 丢了重试就是铸新号 = 重复出金。
   *    重试的是保留下来的原命令时，确定失败也证明不了原命令的结果，继续保留（CP-33）。只有成功才解除。
   */
  const sendCommand = async <T,>(scope: string, extra: D2PendingExtra, send: (key: string) => Promise<T>, done: (result: T) => Promise<unknown>) => {
    const retained = pendingKeys.get(scope);
    const key = retained ?? operationKey(scope);
    pendingKeys.remember(scope, key, extra);
    if (!pendingKeys.isDurablyStored(scope, key)) {
      if (!retained) pendingKeys.forget(scope, key);
      throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
    setSubmitting(scope);
    try {
      let result: T;
      try {
        result = await send(key);
      } catch (cause) {
        const unknown = isDOutcomeUnknownError(cause);
        const moved = cause instanceof DRequestError && (cause.status === 409 || cause.code === 409) && MOVED_STATE_CODES.includes(cause.reasonCode ?? "");
        if (!unknown && !retained) pendingKeys.forget(scope);
        syncPending();
        await refresh();
        const open = detailRef.current;
        if (open && extra.nos.includes(open.withdrawalNo)) await openDetail(open);
        // 状态被别人改了：单笔审核的框留着，刷新成最新状态（D2-C89）；其余操作关框，列表已是最新（BUG-291）。重试的原命令继续走待确认。
        // 框留着时原因写在框里，不再弹同一句盖住标题；框关了才提示。
        if (unknown || (moved && !retained && extra.kind !== "review")) {
          toast(unknown ? "结果未确认，不要重复操作。到页面上方读回核对或按原操作重试。" : "提现已被他人或系统处理，已刷新列表，请核对最新状态。", "warn");
          return;
        }
        throw cause;
      }
      pendingKeys.forget(scope);
      syncPending();
      await done(result);
    } finally {
      setSubmitting("");
    }
  };

  const runReview = (withdrawalNo: string, action: D2ReviewAction, reason: string, form: BusinessFormValue | undefined, fromStatus: string, operator = OPERATOR()) => sendCommand(
    reviewScope(withdrawalNo, action),
    { kind: "review", label: `${actionLabel(action)} · ${withdrawalNo}`, nos: [withdrawalNo], reason, operator, action, form, fromStatus },
    (key) => reviewD2Withdrawal(withdrawalNo, action, { ...businessInput(form), reason }, operator, key),
    async (updated) => {
      const state = statusLabel(updated.status);
      toast(`${shortNo(withdrawalNo)} 已${actionLabel(action)}${state.replace(/^已/, "") === actionLabel(action) ? "" : ` · ${state}`}`, "success");
      // 从列表发起的处理完留在列表（DP-50），只有抽屉开着这一笔时才刷新抽屉。
      await Promise.all([detailRef.current?.withdrawalNo === withdrawalNo ? openDetail(updated) : null, refresh()]);
    },
  );

  const confirmReview = async (row: D2Withdrawal, action: D2ReviewAction) => {
    const seq = ++reviewConfirmSeq.current;
    const blocked = blockedReason(row, action);
    if (blocked) { toast(blocked, "warn"); return; }
    // 银行单放行要看收款账户资格，列表里没有这项，先进详情（D2-C62）。
    // 资格不合格的单在上面的 blocked 里已经拦下。
    if (action === "APPROVE" && row.chain === "BANK-VND" && bankDetail?.withdrawalNo !== row.withdrawalNo) {
      void openDetail(row);
      toast("银行提现要先确认收款账户，请在详情里放行", "info");
      return;
    }
    let addressVerificationRequired = false;
    if (action === "APPROVE") {
      const listSeq = requestSeq.current;
      const detailSeq = detailRequestSeq.current;
      const latest = await fetchD2WithdrawalDetail(row.withdrawalNo).catch(() => null);
      if (seq !== reviewConfirmSeq.current || listSeq !== requestSeq.current || detailSeq !== detailRequestSeq.current) return;
      if (latest?.addressVerificationRequired == null) {
        toast("大额放行核实要求暂不可用，暂不能放行，请重试。", "warn");
        return;
      }
      addressVerificationRequired = latest.addressVerificationRequired;
      if (addressVerificationRequired && !canApproveLarge) { toast(LARGE_BLOCK, "warn"); return; }
    }
    openActionConfirm(reviewRequest(row, action, addressVerificationRequired));
  };

  /** 覆盖率和开关排在勾选项前面（OP-42）。低于红线、已关停时入口已禁用，到这里的都是能放行的。 */
  const coverageFacts = () => <>
    {d5Ref.current && <Fact k="覆盖率">{fmtPct(d5Ref.current.coverageRatio)}，红线 {d5Ref.current.redlinePct}%</Fact>}
    {gateRef.current === "unknown" && <Fact k="提现开关">读不到，提交时系统会再查，已关停时不会放行</Fact>}
  </>;

  /** 这次失败后刷新读到的阻断：框留着，理由留着，但不能按旧依据再点一次（OP-127、OP-128）。 */
  const staleBlock = (action: D2ReviewAction) => (!writesRef.current ? "列表读取失败，已暂停操作，请先重试" : action === "APPROVE" ? approveGateText(gateRef.current, d5Ref.current) : undefined);

  const reviewRequest = (row: D2Withdrawal, action: D2ReviewAction, addressVerificationRequired = false): ActionConfirmReq => {
    const label = actionLabel(action);
    const brief = REVIEW_BRIEF[action];
    return {
      briefKind: "funds",
      action: `${label}提现 · ${row.withdrawalNo}`,
      title: REVIEW_TITLE[action],
      detail: `当前 ${statusLabel(row.status)}；账户 ${userStatusLabel(row.userStatus)}。${action === "APPROVE" ? (row.chain === "BANK-VND" ? "确认后立即放行，由 HDPay 打款，打款成功才算完成。" : "确认后立即放行，钱从储备中扣除。提交时系统会再查一次覆盖率，低于红线不会放行。") : action === "REJECT" ? "确认后立即拒绝并退款。" : "确认后立即生效。"}`,
      businessForm: actionBusinessForm(action, addressVerificationRequired),
      facts: reviewFacts(row, action, bankDetail?.withdrawalNo === row.withdrawalNo ? bankDetail : null, coverageFacts()),
      reasonMin: 8,
      reasonMax: 200,
      completionCopy: brief.impact,
      statedBrief: brief,
      effect: reviewEffect(action),
      confirmLabel: `确认${label}`,
      confirmTone: action === "APPROVE" || action === "REJECT" || action === "REFUND" ? "danger" : undefined,
      run: async (reason, _newValue, businessValue) => {
        try {
          await runReview(row.withdrawalNo, action, reason, businessValue, row.status.toUpperCase());
        } catch (cause) {
          // 状态已被别人改了：框里刷新成最新状态，确认按钮禁用，写清现在是什么状态（S05 实测）。
          const latest = await fetchD2WithdrawalDetail(row.withdrawalNo).catch(() => null);
          const stale = staleBlock(action);
          if (latest && latest.status.toUpperCase() !== row.status.toUpperCase()) {
            openActionConfirm({ ...reviewRequest(latest, action, addressVerificationRequired), blockedReason: `这笔现在是「${statusLabel(latest.status)}」，这次${label}没有执行。关闭后按最新状态处理。` });
          } else if (stale) {
            openActionConfirm({ ...reviewRequest(latest ?? row, action, addressVerificationRequired), blockedReason: stale });
          }
          throw cause;
        }
      },
    };
  };

  const openDetail = async (row: D2Withdrawal) => {
    const seq = ++detailRequestSeq.current;
    setDetail(row);
    setBankDetail(null);
    setCregisDetail(null);
    setDetailLoading(true);
    setDetailError("");
    try {
      const latest = await fetchD2WithdrawalDetail(row.withdrawalNo);
      const bank = latest.chain === "BANK-VND" ? await fetchD2BankPayout(row.withdrawalNo) : null;
      const cregis = ["USDT-BEP20", "BEP20"].includes(latest.chain) ? await fetchD2CregisPayout(row.withdrawalNo) : null;
      if (seq === detailRequestSeq.current) { setDetail(latest); setBankDetail(bank); setCregisDetail(cregis); }
    } catch (cause) {
      if (seq !== detailRequestSeq.current) return;
      // 抽屉开着，失败只写在抽屉里，不再弹一条（VS-107）。
      setDetailError(cause instanceof Error ? displayAdminError(cause) : "单笔详情读取失败");
    } finally {
      if (seq === detailRequestSeq.current) setDetailLoading(false);
    }
  };

  const reopenDetail = async () => { if (detailRef.current) await openDetail(detailRef.current); };

  const runCregisRecovery = (row: Pick<D2Withdrawal, "withdrawalNo">, providerCid: string, reason: string, operator = OPERATOR()) => sendCommand(
    `cregis-recover|${row.withdrawalNo}`,
    { kind: "cregis", label: `核对 Cregis 打款单 · ${row.withdrawalNo}`, nos: [row.withdrawalNo], reason, operator, providerCid },
    (key) => recoverD2CregisPayout(row.withdrawalNo, providerCid, reason, key),
    async () => {
      toast("已核对，系统会继续跟进这笔提现，没有重新打款", "success");
      await Promise.all([refresh(), reopenDetail()]);
    },
  );

  const confirmCregisRecovery = (row: D2Withdrawal, cregis: D2CregisPayout) => {
    if (!cregis.canRecover || cregis.source !== "provider" || cregis.withdrawalNo !== row.withdrawalNo
        || !hasAuthority("finance_d2_read") || !hasAuthority("finance_d2_withdrawal_approve")) return;
    openActionConfirm({ briefKind: "record",
      action: `核对 Cregis 打款单 · ${row.withdrawalNo}`,
      title: "核对 Cregis 打款单",
      facts: <Facts><Fact k="提现单"><span data-mono>{row.withdrawalNo}</span></Fact><Fact k="金额">{amountText(row.amount)} {row.asset}</Fact></Facts>,
      detail: "到 Cregis 查到这笔提现的打款单号（CID）填在下面。系统会核对收款地址和金额，然后继续跟进这笔提现，不会重新打款。",
      businessForm: { kind: "multi-field", title: "",
        feedback: (value) => {
          const cid = (value.providerCid ?? "").trim();
          const outOfRange = /^[1-9][0-9]{18}$/.test(cid) && cid > "9223372036854775807";
          return { field: "providerCid", invalid: outOfRange, message: outOfRange ? "CID 超出有效号码范围，请到 Cregis 核对原单号。" : "" };
        },
        fields: [
        { key: "providerCid", label: "Cregis 打款单号（CID）", inputKind: "text", required: true,
          current: cregis.providerCid ?? "", minLength: 1, maxLength: 19, pattern: "^[1-9][0-9]{0,18}$",
          patternMessage: "CID 是不以 0 开头的数字", explain: "填这笔提现原来的打款单号，不要新建打款单。" },
      ] },
      reasonMin: 10, reasonMax: 200, completionCopy: "系统核对收款地址和金额后继续跟进这笔提现，不会重新打款。",
      statedBrief: { impact: "系统核对收款地址和金额后继续跟进这笔提现，不会重新打款。", check: "填这笔原来的打款单号，不要新建打款单，理由写清依据或工单号。" },
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: "确认核对",
      run: (reason, _newValue, form) => runCregisRecovery(row, String((form as Record<string, unknown> | undefined)?.providerCid ?? "").trim(), reason),
    });
  };

  const runBankRequery = (row: Pick<D2Withdrawal, "withdrawalNo">, bank: Pick<D2BankPayout, "version">, reason: string, operator = OPERATOR()) => sendCommand(
    `bank-requery:${row.withdrawalNo}:${bank.version}`,
    { kind: "bank", label: `查询银行打款结果 · ${row.withdrawalNo}`, nos: [row.withdrawalNo], reason, operator, version: bank.version },
    (key) => requeryD2BankPayout(row.withdrawalNo, bank.version, reason, key),
    async (state) => {
      toast(state === "MANUAL_REVIEW" ? "结果还不明确，继续人工核对；没有重复打款" : "已按 HDPay 的结果处理完成", state === "MANUAL_REVIEW" ? "warn" : "success");
      await Promise.all([refresh(), reopenDetail()]);
    },
  );

  const confirmBankRequery = (row: D2Withdrawal, bank: D2BankPayout) => {
    openActionConfirm({ briefKind: "record",
      action: `查询银行打款结果 · ${row.withdrawalNo}`,
      title: "查询银行打款结果",
      facts: <Facts><Fact k="提现单"><span data-mono>{row.withdrawalNo}</span></Fact><Fact k="金额">{amountText(row.amount)} {row.asset}</Fact></Facts>,
      detail: "向 HDPay 查询这笔打款的结果，不会重新打款。结果明确就自动完成或退回；有疑问的继续人工核对。原因里不要写完整银行卡号。",
      reasonMin: 10, reasonMax: 200, completionCopy: "向 HDPay 查询原单，不会重新打款。",
      statedBrief: { impact: "向 HDPay 查询原单，不会重新打款。", check: "理由写清依据或工单号，不要写完整银行卡号。" },
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: "确认查询",
      run: (reason) => runBankRequery(row, bank, reason),
    });
  };

  const runDevelopmentSimulation = (withdrawalNo: string, reason: string, operator = OPERATOR()) => sendCommand(
    developmentSimulationScope(withdrawalNo),
    { kind: "simulate", label: `模拟冷却到期 · ${withdrawalNo}`, nos: [withdrawalNo], reason, operator },
    (key) => simulateD2CooldownExpiry(withdrawalNo, reason, key),
    async (updated) => {
      toast(`${withdrawalNo} 已模拟冷却到期 · 结果：${statusLabel(updated.status)}`, "success");
      await Promise.all([openDetail(updated), refresh()]);
    },
  );

  const confirmDevelopmentSimulation = (row: D2Withdrawal) => {
    if (simulationBlockedReason(row)) return;
    openActionConfirm({ briefKind: "record",
      action: `模拟冷却到期 · ${row.withdrawalNo}`,
      title: "模拟冷却到期",
      facts: <Facts><Fact k="当前状态" lead>{statusLabel(row.status)}</Fact><Fact k="提现单"><span data-mono>{row.withdrawalNo}</span></Fact><Fact k="金额">{amountText(row.amount)} {row.asset}</Fact><Fact k="本次影响">提前触发到期复查，可能自动放行、转待审核、冻结或再次延迟。</Fact></Facts>,
      detail: "仅测试环境可用。把这笔测试提现的冷却时间提前到现在，然后按正常流程重新检查风险规则、风险分、覆盖率和提现开关。",
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      coverageCheck: "模拟到期后，系统重新检查；尝试自动放行时才检查兑付覆盖率，低于红线会转待审核。",
      coverage: d5 ? { coverageRatio: d5.coverageRatio, redlinePct: d5.redlinePct } : undefined,
      statedBrief: { impact: "把冷却时间提前到现在，再按正常到期流程处理，可能放行、转待审核、冻结或再次延迟。", check: "核对测试提现单和模拟依据。系统尝试自动放行时才检查兑付覆盖率，低于红线会转待审核。" },
      reasonMin: 8,
      reasonMax: 200,
      completionCopy: "提前触发到期复查，可能自动放行、转待审核、冻结或再次延迟。",
      run: (reason) => runDevelopmentSimulation(row.withdrawalNo, reason),
    });
  };

  const closeDetail = () => {
    detailRequestSeq.current += 1;
    setDetail(null);
    setBankDetail(null);
    setCregisDetail(null);
    setDetailLoading(false);
    setDetailError("");
  };

  const submitQuery = () => {
    if (!riskScoreIsValid(draft.minRiskScore)) return;
    const invalidRange = draft.minAmount !== "" && draft.maxAmount !== "" && Number(draft.minAmount) > Number(draft.maxAmount);
    setAmountRangeInvalid(invalidRange);
    if (!invalidRange) setQuery((current) => ({ ...current, ...draft, page: 1 }));
  };

  const applyFilters = (patch: Partial<D2Filters>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setAmountRangeInvalid(false);
    setQuery((current) => ({ ...current, ...patch, page: 1 }));
  };

  const resetAdvancedFilters = () => {
    setRuleFilter("");
    applyFilters({ minAmount: "", maxAmount: "", minRiskScore: "", ipSegment: "", sortBy: "createdAt", sortDirection: "desc" });
  };

  const clearAllFilters = () => {
    setRuleFilter("");
    setDraft(DEFAULT_FILTERS);
    setAmountRangeInvalid(false);
    setQuery((current) => ({ ...current, ...DEFAULT_FILTERS, status: "", page: 1 }));
  };

  const setPage = (page: number) => setQuery((current) => ({ ...current, page }));
  const setPageSize = (pageSize: number) => setQuery((current) => ({ ...current, pageSize, page: 1 }));
  const setGroup = (group: D2Group) => setQuery((current) => ({ ...current, group, status: "", page: 1 }));
  const setStatus = (status: string) => setQuery((current) => ({ ...current, status, page: 1 }));

  const selectableVisibleRows = batchableRows.filter((row) => batchSelectable(row, batchAction, availableBatchActions, approveBlock));
  const allVisibleSelected = selectableVisibleRows.length > 0
    && selectableVisibleRows.every((row) => selected.has(row.withdrawalNo));
  const toggleVisibleSelection = (checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of selectableVisibleRows) checked ? next.add(row.withdrawalNo) : next.delete(row.withdrawalNo);
      return next;
    });
  };

  const runBatch = (action: D2BatchAction, ids: string[], reason: string, form: BusinessFormValue | undefined, operator = OPERATOR(), retry = false) => sendCommand(
    batchScope(action, ids),
    { kind: "batch", label: `批量${actionLabel(action)} · ${ids.length} 笔`, nos: ids, reason, operator, action, form },
    (key) => reviewD2WithdrawalsBatch(action, ids, { ...businessInput(form), reason }, operator, key),
    async (result: D2BatchResult) => {
      const summary = `批次 ${result.batchId}：成功 ${result.accepted.length} 笔 / 大额转人工 ${result.rejected.length} 笔 / 未执行 ${result.conflicts.length} 笔${result.conflicts.length ? `；${batchConflictText(result)}` : ""}`;
      await refresh();
      // 一笔也没执行、又不是状态变了：留在确认框改了再提交，不当成功收尾（BUG-291）。重试没有确认框，看结果窗。
      if (!retry && result.accepted.length === 0 && result.rejected.length === 0 && result.conflicts.some((conflict) => !MOVED_STATE_CODES.includes(conflict.reason))) throw new Error(summary);
      setBatchResult({ action, result });
    },
  );

  const batchRequest = (action: D2BatchAction, targets: D2Withdrawal[], excluded: number): ActionConfirmReq => {
    const ids = targets.map((row) => row.withdrawalNo).sort();
    const approve = action === "APPROVE";
    // 门槛读不到时不写数字，后端照样把大额转人工。
    const threshold = targets[0].strongReviewThresholdUsdt;
    // 大额不会批量放行，关键数字只算这次真正动的钱（VS-102）。
    const manual = approve ? targets.filter((row) => row.addressVerificationRequired === true) : [];
    const sum = (rows: D2Withdrawal[]) => rows.reduce((total, row) => total + row.amount, 0);
    const manualText = !approve ? undefined : threshold === null ? "大额会转单笔人工审核，不会批量放行" : manual.length ? `${manual.length} 笔共 ${money(sum(manual))} 达到 ${amountText(threshold)} USDT，转单笔人工审核，不会批量放行` : undefined;
    const batchImpact = REVIEW_BRIEF[action].impact.replace("这笔提现", "这些提现").replace("这笔", "这些单");
    return { briefKind: "funds",
      action: `批量执行 · ${actionLabel(action)}`,
      title: `批量${REVIEW_TITLE[action]}`,
      detail: `将对 ${ids.length} 笔提现执行${actionLabel(action)}（不符合条件的已自动排除）。${action === "REJECT" ? "完成后为已退款。" : ""}提交后看批量结果。`,
      businessForm: actionBusinessForm(action),
      facts: <>
        <Facts>
          <Fact k={manual.length ? "这次放行金额" : "合计金额"} lead tone="role-1" unit="USDT">{amountText(sum(targets) - sum(manual))}</Fact>
          <Fact k="笔数">{ids.length} 笔{excluded > 0 ? `，另有 ${excluded} 笔不适用，不会提交` : ""}</Fact>
          {manualText && <Fact k="转人工">{manualText}</Fact>}
          {approve && coverageFacts()}
          {REVIEW_UNDO[action] && <Fact k="能否撤销" tone={REVIEW_UNDO_TONE[action]}>{REVIEW_UNDO[action]}</Fact>}
          <Fact k="处理方式">逐笔处理，可能部分成功</Fact>
        </Facts>
        <ul className="rd-recipients" tabIndex={0} aria-label="这次处理的提现单">
          {targets.map((row) => <li key={row.withdrawalNo} className="d2-batch-row">
            <span data-mono title={row.withdrawalNo}>{shortNo(row.withdrawalNo)}</span>
            <span>{amountText(row.amount)} {row.asset}</span>
            <span>{manual.includes(row) ? "转人工" : `${routingPriorityLabel(row)} · 风险分 ${row.riskScore ?? "—"}`}</span>
            {approve && <span className="d2-batch-pay">{chainText(row)} · <span data-mono>{row.targetAddress}</span></span>}
          </li>)}
        </ul>
      </>,
      reasonMin: 8,
      reasonMax: 200,
      completionCopy: batchImpact,
      statedBrief: { impact: batchImpact, check: REVIEW_BRIEF[action].check },
      effect: reviewEffect(action),
      confirmLabel: `确认批量${actionLabel(action)}`,
      confirmTone: action === "APPROVE" || action === "REJECT" ? "danger" : undefined,
      run: async (reason, _newValue, businessValue) => {
        try {
          await runBatch(action, ids, reason, businessValue);
        } catch (cause) {
          const stale = staleBlock(action);
          if (stale) openActionConfirm({ ...batchRequest(action, targets, excluded), blockedReason: stale });
          throw cause;
        }
      },
    };
  };

  const confirmBatch = () => {
    const action = batchAction;
    if (!action) { toast("请先选择批量操作，再勾选提现单", "warn"); return; }
    // 只提交「当前筛选结果里真正可执行」的行；弹窗里报的笔数与下面 run 提交的是同一个 ids。
    if (submittableRows.length === 0) { toast("当前没有可以执行这个操作的提现单", "warn"); return; }
    openActionConfirm(batchRequest(action, submittableRows, selectedRows.length - submittableRows.length));
  };

  const notePending = (record: D2PendingCommand, note: string) => setPendingNotes((current) => ({ ...current, [record.fingerprint]: `${businessClock(Date.now())} ${note}` }));

  /** 重试也是写操作，按这个账号现在的权限判断，和原入口一样（OP-124）。读回核对不受影响。 */
  const canRetry = (record: D2PendingCommand) => {
    if (record.kind === "cregis") return hasAuthority("finance_d2_read") && hasAuthority("finance_d2_withdrawal_approve");
    if (record.kind === "bank") return hasAuthority("finance_d2_withdrawal_approve") && hasAuthority("finance_d2_withdrawal_refund");
    if (record.kind === "simulate") return hasAuthority("finance_d2_withdrawal_approve");
    return Boolean(record.action) && hasAuthority(ACTION_AUTHORITY[record.action as D2ReviewAction]) && (record.kind !== "batch" || canBatch);
  };

  /** 按原操作重试：同命令号、同内容、同理由，不接受新输入（OP-94）。只有成功才解除待确认。 */
  const retryPending = async (record: D2PendingCommand) => {
    // 过期和查不到记录都不发送，也不解除：解除只在后端明确拒绝之后（OP-96、OP-153）。
    if (record.expiresAt <= Date.now()) { notePending(record, RETRY_EXPIRED); return; }
    if (!canRetry(record)) { notePending(record, RETRY_NO_PERMISSION); return; }
    if (!pendingKeys.isDurablyStored(record.fingerprint, record.commandKey)) {
      notePending(record, "浏览器里查不到这条记录，本次没有发送。待确认继续保留，请到操作记录与审批核对。");
      return;
    }
    if (record.kind === "review" && record.action === "REFUND") {
      const latest = await fetchD2WithdrawalDetail(record.nos[0]).catch(() => null);
      if (!latest) {
        notePending(record, "暂时无法核对这笔提现的渠道和状态，本次没有重试。原操作继续保留，请稍后读回核对。");
        return;
      }
      if (erc20ConfirmationLost(latest)) {
        notePending(record, "这笔 ERC20 提现已丢失链上确认，保持冻结并继续占提现额度，不能退款。原操作记录继续保留，请到操作记录核对。");
        return;
      }
    }
    setRetryRejected((current) => current.filter((key) => key !== record.commandKey));
    const [no] = record.nos;
    try {
      if (record.kind === "review" && record.action) await runReview(no, record.action, record.reason, record.form, record.fromStatus ?? "", record.operator);
      if (record.kind === "batch" && record.action) await runBatch(record.action as D2BatchAction, record.nos, record.reason, record.form, record.operator, true);
      if (record.kind === "cregis") await runCregisRecovery({ withdrawalNo: no }, record.providerCid ?? "", record.reason, record.operator);
      if (record.kind === "bank") await runBankRequery({ withdrawalNo: no }, { version: record.version ?? 0 }, record.reason, record.operator);
      if (record.kind === "simulate") await runDevelopmentSimulation(no, record.reason, record.operator);
    } catch (cause) {
      if (isPermissionDenied(cause)) announcePermissionDenied();
      notePending(record, `重试没有成功：${cause instanceof Error ? displayAdminError(cause) : "原因未知"} 这说明不了原操作的结果，原命令继续保留。`);
      setRetryRejected((current) => [...current, record.commandKey]);
    }
  };

  /** 重试被拒后，人核实过原操作的结果才解除。只放开这笔的本地锁，不发请求，后端仍按这笔现在的状态校验。 */
  const releasePending = (record: D2PendingCommand) => {
    pendingKeys.forget(record.fingerprint, record.commandKey);
    syncPending();
    setReleasing(null);
    toast("已解除待确认，这笔可以重新处理", "success");
  };

  /** 读回这笔单，只给现在的事实。状态变了可能是别人改的，不能当成原命令的回执，待确认和原命令都保留（OP-93、OP-95）。 */
  const verifyPending = async (record: D2PendingCommand) => {
    const [no] = record.nos;
    const latest = await fetchD2WithdrawalDetail(no).catch(() => null);
    if (!latest) { notePending(record, "读回失败，这笔暂时读不到。待确认继续保留。"); return; }
    const from = record.fromStatus ? `，发出时是「${statusLabel(record.fromStatus)}」` : "";
    notePending(record, `读回：这笔现在是「${statusLabel(latest.status)}」${from}。状态可能是别人改的，待确认继续保留。`);
    await Promise.all([openDetail(latest), refresh()]);
  };

  const resultsUnavailable = loading || !writesEnabled;
  const coverageBelow = d5 ? d5.coverageRatio < d5.redlinePct : false;
  const approveGateReason = approveGateText(withdrawGate, d5);

  const allowedActions = (row: D2Withdrawal, cregis?: D2CregisPayout | null) =>
    actionCandidates(row, cregis).filter((action) => hasAuthority(ACTION_AUTHORITY[action]));

  /** 现在不能做的原因，写给人看（OP-126）。没有权限的动作不走这里，直接隐藏（OP-124）。 */
  function blockedReason(row: D2Withdrawal, action?: D2ReviewAction) {
    if (action === "REFUND" && erc20ConfirmationLost(row)) return "这笔 ERC20 提现已丢失链上确认，保持冻结并继续占提现额度，不能退款；原操作记录继续保留，请核对链上结果";
    if (pendingNos.has(row.withdrawalNo)) return "这笔有结果未确认的操作，先到页面上方核对";
    if (loading) return "正在刷新列表";
    if (!writesEnabled) return "列表读取失败，已暂停操作，请先重试";
    if (roleBlock(action)) return roleBlock(action);
    if (action === "APPROVE" && !canReadD5) return "你没有「USDT 提现参数」的查看权限，读不到额度和覆盖率，不能放行";
    if (action === "APPROVE" && approveBlock(row)) return approveBlock(row);
    if (action === "APPROVE" && approveGateReason) return approveGateReason;
    if (action === "APPROVE" && bankDetail?.withdrawalNo === row.withdrawalNo && bankDetail.beneficiaryEligibility?.canWithdraw !== true) return BANK_BLOCK;
    return undefined;
  }

  function detailBlockedReason(row: D2Withdrawal, action?: D2ReviewAction) {
    if (detailLoading) return "正在读取详情";
    if (detailError) return "为避免按旧数据操作，已暂停处理";
    const blocked = blockedReason(row, action);
    if (blocked) return blocked;
    if (action === "APPROVE" && row.chain === "BANK-VND" && bankDetail?.beneficiaryEligibility?.canWithdraw !== true) return BANK_BLOCK;
    return undefined;
  }

  function simulationBlockedReason(row: D2Withdrawal) {
    const blocked = detailBlockedReason(row);
    if (blocked) return blocked;
    if (!developmentCapabilities?.simulateCooldownExpiry || !hasAuthority("finance_d2_withdrawal_approve")) return "当前账号或环境不能模拟冷却到期";
    if (!developmentSimulationEligible(row)) return "只有 H1 阶段冷却中的已放行提现可以模拟到期";
    if (parseBusinessTime(row.holdUntil) <= Date.now()) return "这笔已到复查时间，无需模拟；请刷新查看系统复查结果";
    return undefined;
  }

  const groupCount = (group: D2Group) => statusCounts ? groupStatuses(group).reduce((sum, status) => sum + (statusCounts[status] ?? 0), 0) : undefined;
  const todoCount = groupCount("todo");
  const segments: SegmentItem<D2Group>[] = [
    ...STATUS_GROUPS.map((group) => ({ value: group.value, label: group.label, tone: group.tone, count: groupCount(group.value) })),
    { value: "all", label: "全部", count: groupCount("all") },
  ];
  const statusOption = (status: string) => ({ value: status, label: `${STATUS_CN[status]}${statusCounts ? ` · ${statusCounts[status] ?? 0}` : ""}` });
  const currentGroup = STATUS_GROUPS.find((group) => group.value === query.group);

  const conditionChips = [
    { key: "q", label: query.keyword && `提现单 / 用户：${query.keyword}`, patch: { keyword: "" } },
    { key: "min", label: query.minAmount && `金额 ≥ ${query.minAmount}`, patch: { minAmount: "" } },
    { key: "max", label: query.maxAmount && `金额 ≤ ${query.maxAmount}`, patch: { maxAmount: "" } },
    { key: "risk", label: query.minRiskScore && `风险分 ≥ ${query.minRiskScore}`, patch: { minRiskScore: "" } },
    { key: "ip", label: query.ipSegment && `IP 段 ${query.ipSegment}`, patch: { ipSegment: "" } },
    { key: "sort", label: (query.sortBy !== DEFAULT_FILTERS.sortBy || query.sortDirection !== DEFAULT_FILTERS.sortDirection) && "已改排序", patch: { sortBy: DEFAULT_FILTERS.sortBy, sortDirection: DEFAULT_FILTERS.sortDirection } },
  ].filter((chip) => chip.label).map((chip) => ({ key: chip.key, label: chip.label as string, onRemove: () => applyFilters(chip.patch) }));
  const appliedChips = ruleFilter ? [...conditionChips, { key: "rule", label: `触发规则：${ruleFilter}（只筛当前页）`, onRemove: () => setRuleFilter("") }] : conditionChips;
  const moreCount = [query.minAmount, query.maxAmount, query.minRiskScore, query.ipSegment, ruleFilter].filter(Boolean).length
    + (query.sortBy !== DEFAULT_FILTERS.sortBy || query.sortDirection !== DEFAULT_FILTERS.sortDirection ? 1 : 0);
  const hasConditions = appliedChips.length > 0 || query.status !== "";
  const draftChanged = (Object.keys(DEFAULT_FILTERS) as (keyof D2Filters)[]).some((key) => draft[key] !== query[key]);

  const riskNotice = !riskScoreIsValid(draft.minRiskScore)
    ? `最低风险分须为 0–100 的整数。未查询${error ? "。" : `，列表${query.minRiskScore ? `仍按最低风险分 ${query.minRiskScore}` : "仍是不限风险分的结果"}。`}`
    : riskDropped && `「${riskDropped}」不是 0–100 的整数，没有生效。已改回${draft.minRiskScore ? `最低风险分 ${draft.minRiskScore}` : "不限风险分"}。`;
  const filterNotice = amountRangeInvalid ? "最低金额不能大于最高金额。这次没有查询。" : riskNotice || (query.status === "FROZEN" ? "ERC20 丢失链上确认的单也按冻结处理，要在「打款异常，需人工核对」里查看。" : undefined);

  const shown = drawerRow.current;
  const detailIndex = detail ? visibleRows.findIndex((row) => row.withdrawalNo === detail.withdrawalNo) : -1;
  if (detailIndex >= 0) lastDetailIndex.current = detailIndex;
  // 处理完这一条它可能离开当前分组，下一条就是补到这个位置的那条。
  const prevRow = detailIndex >= 0 ? visibleRows[detailIndex - 1] : visibleRows[lastDetailIndex.current - 1];
  const nextRow = detailIndex >= 0 ? visibleRows[detailIndex + 1] : visibleRows[Math.min(lastDetailIndex.current, visibleRows.length - 1)];

  // 抽屉里只有「放行」一个实心；拒绝和手动退款收不回来，是描边红，最终确认框里才是实心红（VS-25）。
  const decisionButton = (row: D2Withdrawal, action: D2ReviewAction) => (
    <Button key={action} variant={action === "REJECT" || action === "REFUND" ? "danger-outline" : action === "DELAY" || action === "FREEZE" ? "ghost" : "primary"}
      disabled={!!submitting} disabledReason={detailBlockedReason(row, action)} onClick={() => void confirmReview(row, action)}>{actionLabel(action)}</Button>
  );

  const detailActions = shown ? allowedActions(shown, cregisDetail) : [];
  const detailProvider = cregisDetail?.source === "provider";
  const bankRecovery = shown?.chain === "BANK-VND" && bankDetail?.state === "MANUAL_REVIEW"
    && hasAuthority("finance_d2_withdrawal_approve") && hasAuthority("finance_d2_withdrawal_refund");
  const cregisRecovery = cregisDetail?.canRecover && hasAuthority("finance_d2_read") && hasAuthority("finance_d2_withdrawal_approve");
  const simulation = shown && developmentCapabilities?.simulateCooldownExpiry
    && hasAuthority("finance_d2_withdrawal_approve") && developmentSimulationEligible(shown);
  const approveBlocked = shown && detailActions.includes("APPROVE") ? detailBlockedReason(shown, "APPROVE") : undefined;
  const gateClosedHere = detailActions.includes("APPROVE") && withdrawGate === "closed";
  const [needRole] = shown ? actionCandidates(shown, cregisDetail) : [];
  // 常显的只有现在能不能做、为什么不能；放行会怎样收进按钮旁的提示图标（DP-06）。
  const decisionNote = shown && (detailBlockedReason(shown) ?? approveBlocked ?? (simulation ? simulationBlockedReason(shown) : undefined) ?? (detailActions.length || bankRecovery || cregisRecovery ? undefined
    : needRole ? `${actionLabel(needRole)}这笔需要${needRole === "APPROVE" ? approvalRole(shown) : ACTION_ROLE[needRole]}，你只能查看。`
      : shown && ["TX_ORPHANED", "DEAD"].includes(shown.status.toUpperCase()) ? "这笔打款结果待核对，这里没有可用的操作。到打款方核对，不要重新放行或退款。" : "这笔现在没有人工操作。"));
  const decisionExplain = shown && detailActions.includes("APPROVE") && !approveBlocked
    ? shown.chain === "BANK-VND" ? "点「放行」并确认后立即生效，由 HDPay 打款，打款成功才算完成。" : "点「放行」并确认后立即生效，钱从储备中扣除。"
    : undefined;

  const riskTone = shown ? routingPriorityTone(shown) : undefined;
  // 这单为什么在这里、下一步要注意什么。打款结果不明时最要紧的就是不能重新放行，常显（DP-03）。
  const orphaned = shown ? ["TX_ORPHANED", "DEAD"].includes(shown.status.toUpperCase()) && !erc20ConfirmationLost(shown) && shown.chain !== "BANK-VND" : false;
  const lifecycleNote = shown ? lifecycleSummary(shown) : "";
  // 没有特别原因时只有状态名，和抽屉头重复，写全这个状态的下一步。
  const statusExplain = shown ? STATUS_EXPLAIN[shown.status.toUpperCase()] : undefined;
  const plainStatus = lifecycleNote === statusExplain?.split("。")[0];
  const stateNote = !shown ? "" : detailProvider ? "按 Cregis 的打款结果结算，不会重新打款。" : shown.chain === "BANK-VND" && ["SENT", "TX_ORPHANED"].includes(shown.status.toUpperCase()) ? "已派发后以 HDPay 查单结果结算；结果不明不重发、不手工退款。" : orphaned ? "打款结果不明，不要重新放行" : plainStatus ? statusExplain : lifecycleNote;
  // 待审核又没有特别原因时那句是套话，不占判断要点。
  const plainPending = shown ? isReviewPending(shown.status) && plainStatus : false;
  const judgment: JudgmentRow[] = shown ? [
    { label: "金额", icon: Coins, tone: "money", value: `${amountText(shown.amount)} ${shown.asset}`, reason: `${shown.chain === "BANK-VND" ? "兑换金额" : "到账"} ${amountText(shown.netReceive)} · 手续费 ${amountText(shown.actualFee)}` },
    { label: "对象", icon: User, tone: "users", value: `${operatorNicknameText(shown.nickname)} ${shown.userNo}`, state: ["active", "enabled"].includes(shown.userStatus.toLowerCase()) ? undefined : "warn", reason: `账户${userStatusLabel(shown.userStatus)} · 近 24h ${shown.withdrawalCount24h} 笔 · 每日上限 ${canReadD5 ? `${dailyLimit || "—"} 笔` : "无权限"}` },
    { label: "收款", value: payoutChannel(shown), reason: shown.chain === "BANK-VND" ? bankDetail?.maskedAccount ?? "账户信息见下方" : <span data-mono>{shown.targetAddress}</span> },
    { label: "风险", icon: Shield, tone: "risk", state: riskTone, value: `${routingPriorityLabel(shown)}，${k4RiskText(shown)}`, reason: [`风险规则：${routeLabel(shown.k3RiskRoute)}`, ...(hitRulesText(shown) === "无" ? [] : [hitRulesText(shown)])].join(" · ") },
    ...(plainPending ? [] : [{ label: "说明", state: orphaned ? "warn" as const : undefined, value: stateNote, reason: holdsForReview(shown) ? `复查时间：${timeText(shown.holdUntil)}` : orphaned && !plainStatus ? lifecycleNote : undefined }]),
    ...(detailActions.includes("APPROVE") ? [{ label: "覆盖率", state: !canReadD5 || !d5 ? "warn" as const : coverageBelow ? "danger" as const : undefined, value: !canReadD5 ? "无权限" : d5 ? `${fmtPct(d5.coverageRatio)}，红线 ${d5.redlinePct}%` : "读取失败" }] : []),
    ...(gateClosedHere ? [{ label: "提现开关", state: "warn" as const, value: "已关停" }] : []),
  ] : [];
  const ruleCount = shown ? countEntries(shown.hitRules, ",") : 0;
  const historyRecords = withdrawalHistoryRecords(shown?.withdrawalHistory, shown?.withdrawalNo);
  const statusEntries = shown ? statusHistoryEntries(shown.statusHistory, shown.chain) : [];
  const auditEntries = auditTrailEntries(shown?.auditTrail, shown?.createdAt ?? "");
  const riskHits = shown ? riskReasons(shown).map((reason, index): RecordListEntry => ({ id: `hit-${index}`, value: reason })) : [];

  const tableColumnCount = QUEUE_COLUMNS.filter((column) => columns.isVisible(column.key)).length + (showSelection ? 1 : 0);
  const copyNo = (value: string) => {
    void navigator.clipboard?.writeText(value).then(() => toast("已复制提现单号", "success"), () => toast("复制失败，请手动选择单号", "error"));
  };
  const pendingNotices = pendingCommands.map((record) => (
    <Notice key={record.fingerprint} tone="warn" title={`${record.label} · 结果未确认`}
      action={<>
        {record.kind !== "batch" && <Button size="sm" disabled={!!submitting} onClick={() => void verifyPending(record)}>读回核对</Button>}
        <Button size="sm" disabled={!!submitting} disabledReason={record.expiresAt <= Date.now() ? RETRY_EXPIRED : canRetry(record) ? undefined : RETRY_NO_PERMISSION} onClick={() => void retryPending(record)}>按原操作重试</Button>
        {retryRejected.includes(record.commandKey) && <Button size="sm" disabled={!!submitting} onClick={() => setReleasing(record)}>解除待确认</Button>}
      </>}>
      {timeText(new Date(record.createdAt).toISOString())}（{businessZone().label}）发出，可能已经生效。{record.expiresAt <= Date.now() ? `${RETRY_EXPIRED}。` : RECOVERY_HINT[record.kind]}
      {reach("/platform/audit", "platform_a2_read") && <> <Link className="rd-link" href={`/platform/audit?domain=D&object=${encodeURIComponent(record.nos[0])}`}>到操作记录核查</Link></>}
      <Explain label="技术信息" content={`命令号 ${record.commandKey} ｜ 操作人 ${record.operator} ｜ 理由 ${record.reason}`} />
      {pendingNotes[record.fingerprint] && <div>{pendingNotes[record.fingerprint]}</div>}
    </Notice>
  ));

  return <>
    <PageHeader pageId="D2" title="提现审核" summary={<AutoGloss>审核用户提现，先看风险和兑付覆盖率。</AutoGloss>}
      meta={<span className="rd-toolbar">
        <span>
          {readAt ? `${readAt} 读取（${businessZone().label}），` : ""}不自动刷新 ·{" "}
          <Explain label="到账时限怎么算" content="打开和操作后读取，不自动刷新。当前到账时限按「USDT 提现参数」的设置，已提交的提现按提交时的时限。">到账时限 {canReadD5 ? (resultsUnavailable || d5?.payoutSlaHours == null ? "—" : `${d5.payoutSlaHours} 小时`) : "无权限"}</Explain>
        </span>
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={loading} onClick={() => void refresh()}>刷新</Button>
      </span>}
      readOnly={canWriteAny ? undefined : "你只能查看；处理提现需要对应的审核权限"} />

    {withdrawGate === "closed" && <Notice tone="warn" title={<>提现已关停<Explain label="关停提现的范围" content="关停后暂停尚未提交通道的打款；已提交通道的继续核对和结算，不因关停退款。恢复后按原条件继续派发。" /></>}
      action={reach("/emergency/kill-switch", "emergency_j1_read") ? <Link className="rd-link" href="/emergency/kill-switch">去紧急停用开关</Link> : undefined}>
      用户现在不能提交新提现。现在放行不会生效：系统会拒绝，这笔留在待审核，钱不动。拒绝、延迟、冻结、解冻和退款照常可用。
    </Notice>}
    {withdrawGate === "unknown" && <Notice tone="warn">提现开关状态暂时读不到。放行时系统会再查，已关停时不会放行。</Notice>}
    {coverageBelow && d5 && hasAuthority(ACTION_AUTHORITY.APPROVE) && <Notice tone="danger" title="兑付覆盖率低于红线，放行已暂停"
      action={reach("/finance/pool", "finance_d3_read") ? <Link className="rd-link" href="/finance/pool">去资金储备</Link> : undefined}>
      现在 {fmtPct(d5.coverageRatio)}，红线 {d5.redlinePct}%。补足储备后再放行。拒绝、延迟、冻结、解冻和退款照常可用。
    </Notice>}
    {pendingNotices}

    <StatBand label="提现汇总">
      <Stat lead tone="role-2" icon={Inbox} label="要处理" value={todoCount ?? "—"} unit={todoCount === undefined ? undefined : "笔"} sub={countsFailed ? "数量暂时读不到" : undefined}
        explain="待审核、冻结、审核拒绝、地址无效、打款失败、打款异常的全部笔数，不随下方筛选变。" />
      <Stat icon={Flag} iconTone="warn" label="高优先队列" value={resultsUnavailable ? "—" : visibleRows.filter((row) => ["HIGH", "ESCALATED"].includes(routingPriority(row))).length} unit={resultsUnavailable ? undefined : "笔"}
        explain="只算当前页里风险列是「高优先」或「加强审核」的笔数，按风险分自动分配，和金额大小无关。" />
      <Stat tone="role-1" icon={Coins} label="本页金额" value={resultsUnavailable ? "—" : amountText(visibleRows.reduce((sum, row) => sum + row.amount, 0))} unit={resultsUnavailable ? undefined : "USDT"}
        explain="只算当前页显示的提现单，不是全部；页里有已退款的单也算在内。" />
      <Stat tone={canReadD5 ? "role-4" : undefined} icon={Gauge} label="每日提现次数上限" value={!canReadD5 ? "无权限" : resultsUnavailable ? "—" : dailyLimit || "—"} unit={canReadD5 && !resultsUnavailable ? "次" : undefined}
        sub={!canReadD5 ? "用到额度的放行已禁用" : undefined}
        explain={!canReadD5 ? undefined : reach("/finance/params", "finance_d5_read") ? <>在<Link className="rd-link" href="/finance/params">「USDT 提现参数」</Link>设置。</> : "在「USDT 提现参数」设置。"} />
    </StatBand>

    <FilterBar
      scope={<>
        <Segments label="提现状态分组" value={query.group} items={segments} onChange={setGroup} />
        <FilterField>
          {currentGroup
            ? <Select aria-label="状态" value={query.status} onChange={setStatus} options={[{ value: "", label: currentGroup.allLabel }, ...currentGroup.statuses.map(statusOption)]} />
            : <Select aria-label="状态" value={query.status} onChange={setStatus} options={[{ value: "", label: "全部状态" }]} groups={STATUS_GROUPS.map((group) => ({ label: group.label, options: group.statuses.map(statusOption) }))} />}
        </FilterField>
      </>}
      onSubmit={submitQuery}
      querying={loading}
      onClear={clearAllFilters}
      canClear={hasConditions}
      moreCount={moreCount}
      onClearMore={resetAdvancedFilters}
      more={<>
        <FilterField label="最低金额"><Input type="number" min="0" value={draft.minAmount} onChange={(event) => { setDraft({ ...draft, minAmount: event.target.value }); setAmountRangeInvalid(false); }} /></FilterField>
        <FilterField label="最高金额"><Input type="number" min="0" value={draft.maxAmount} onChange={(event) => { setDraft({ ...draft, maxAmount: event.target.value }); setAmountRangeInvalid(false); }} /></FilterField>
        <FilterField label="最低风险分"><Input inputMode="numeric" placeholder="0–100" aria-invalid={!riskScoreIsValid(draft.minRiskScore)} value={draft.minRiskScore} onChange={(event) => { setDraft({ ...draft, minRiskScore: event.target.value }); setRiskDropped(""); }} /></FilterField>
        <FilterField label="触发规则（只筛选当前页）"><Input value={ruleFilter} onChange={(event) => setRuleFilter(event.target.value)} /></FilterField>
        <FilterField label="IP 段"><Input placeholder="例如 192.168.1" value={draft.ipSegment} onChange={(event) => setDraft({ ...draft, ipSegment: event.target.value })} /></FilterField>
        <FilterField label="排序字段"><Select aria-label="排序字段" value={draft.sortBy} onChange={(sortBy) => setDraft({ ...draft, sortBy })} options={[{ value: "createdAt", label: "提交时间" }, { value: "amount", label: "金额" }, { value: "riskScore", label: "风险分" }, { value: "status", label: "状态" }]} /></FilterField>
        <FilterField label="排序方向"><Select aria-label="排序方向" value={draft.sortDirection} onChange={(sortDirection) => setDraft({ ...draft, sortDirection })} options={[{ value: "desc", label: "降序" }, { value: "asc", label: "升序" }]} /></FilterField>
      </>}
      applied={appliedChips}
      result={draftChanged ? "条件未应用" : hasConditions && !resultsUnavailable ? `当前筛选 ${rows.total} 笔` : undefined}
      notice={filterNotice}
    >
      <FilterField grow><Input aria-label="提现单 / 用户" placeholder="输入提现单号、用户编号或昵称" value={draft.keyword} onChange={(event) => setDraft({ ...draft, keyword: event.target.value })} /></FilterField>
    </FilterBar>

    <Panel flush icon={FileText} tone="role-1" title={currentGroup ? `${currentGroup.label}的提现` : "全部提现"} explain={canWriteAny && (query.group === "todo" || query.group === "all") ? "可单笔或批量处理" : undefined}
      actions={<>
        {showSelection && <Select aria-label="批量操作" value={batchAction} onChange={(value) => setBatchAction(value as D2BatchAction | "")} placeholder="选择批量操作"
          options={[{ value: "", label: "选择批量操作" }, ...BATCH_ACTIONS.filter((action) => hasAuthority(ACTION_AUTHORITY[action])).map((action) => ({ value: action, label: roleBlock(action) ? `${actionLabel(action)}（需财务主管、风控主管或超级管理员）` : action === "APPROVE" && !canReadD5 ? `${actionLabel(action)}（无额度权限）` : actionLabel(action), disabled: !availableBatchActions.includes(action) }))]} />}
        <ColumnPicker columns={columns} />
      </>}>
      {showSelection && (batchAction || selected.size > 0) && (
        <BatchBar summary={`已勾选 ${selectedRows.length} 笔${batchAction ? ` · 可执行 ${submittableRows.length} 笔` : ""}`} hint={!batchAction ? "先选操作，再勾选提现单" : "不符合这个操作的提现单不会被提交"}>
          <Button variant="primary" disabled={!writesEnabled || !batchAction || submittableRows.length === 0 || !!submitting} disabledReason={batchAction === "APPROVE" ? approveGateReason : undefined} onClick={confirmBatch}>批量执行</Button>
        </BatchBar>
      )}
      <Table label="提现单列表" className="d-num-gap" aria-busy={loading}>
        <thead><tr>
          {showSelection && <Th control><Checkbox aria-label="全选本页可批量处理的提现单" disabled={selectableVisibleRows.length === 0} checked={allVisibleSelected} indeterminate={!allVisibleSelected && selectedRows.length > 0} onChange={(event) => toggleVisibleSelection(event.target.checked)} /></Th>}
          <Th sticky="start">提现单 · 时间（{businessZone().label}）</Th>
          {columns.isVisible("user") && <Th icon={User} tone="users">用户</Th>}
          {columns.isVisible("asset") && <Th>资产 / 链</Th>}
          {columns.isVisible("amount") && <Th align="right" icon={Coins} tone="money">金额 USDT</Th>}
          {columns.isVisible("fee") && <Th align="right">手续费</Th>}
          <Th icon={Shield} tone="risk">风险</Th>
          {columns.isVisible("account") && <Th>账户状态</Th>}
          <Th>状态</Th>
          {columns.isVisible("lifecycle") && <Th>生命周期 / 异常</Th>}
          <Th sticky="end" align="right">操作</Th>
        </tr></thead>
        <tbody>
          {loading ? <TableLoading columns={tableColumnCount} rows={Math.min(query.pageSize, 10)} />
            : error ? <TableMessage columns={tableColumnCount} role="alert">加载失败，已暂停操作。{error} <Button size="sm" onClick={() => { setPage(1); void loadCounts(); void loadGate(); }}>重试</Button></TableMessage>
              : !writesEnabled ? <TableMessage columns={tableColumnCount} role="alert">提现数据暂不可用，请重试</TableMessage>
                : visibleRows.length === 0 ? <TableMessage columns={tableColumnCount} role="status">
                  {rows.records.length > 0 ? <>当前页没有匹配，其他页可能有。 <Button size="sm" onClick={() => setRuleFilter("")}>清除触发规则</Button></>
                    : hasConditions ? <>没有符合条件的提现单。 <Button size="sm" onClick={clearAllFilters}>清除筛选</Button></>
                      : query.group === "todo" ? <>现在没有要处理的提现。用户提交后，要人工审核的会出现在这里。 <Button size="sm" onClick={() => setGroup("all")}>看全部提现</Button></>
                        : query.group === "all" ? "暂无提现记录" : `暂无${currentGroup?.label}的提现`}
                </TableMessage>
                  : visibleRows.map((row) => {
                    const selectedNow = selected.has(row.withdrawalNo);
                    const pendingRow = pendingNos.has(row.withdrawalNo);
                    const anyBatchAction = !pendingRow && batchSelectable(row, "", availableBatchActions, approveBlock);
                    const selectable = !pendingRow && batchSelectable(row, batchAction, availableBatchActions, approveBlock);
                    const selectionHint = pendingRow
                      ? "这笔有结果未确认的操作，不能批量处理"
                      : !anyBatchAction
                        ? noBatchHint(row)
                        : batchAction === "APPROVE" && approveBlock(row)
                          ? approveBlock(row) as string
                          : batchAction && !selectable
                          ? `「${actionLabel(batchAction)}」不适用于这个状态`
                          : "选择这笔提现";
                    const selectionNote = pendingRow || selectable || !anyBatchAction ? "" : "当前动作不适用 · ";
                    const [mainAction, ...moreActions] = allowedActions(row);
                    const tone = routingPriorityTone(row);
                    const riskLabel = `${routingPriorityLabel(row)} · 风险分 ${row.riskScore ?? "—"}`;
                    const hitCount = countEntries(row.hitRules, ",");
                    const reviewBasis = `风险规则：${routeLabel(row.k3RiskRoute)} · ${hitCount ? `${hitCount} 条命中` : "无"}`;
                    return <Tr key={row.withdrawalNo} selected={row.withdrawalNo === detail?.withdrawalNo} onOpen={() => { if (!submitting) void openDetail(row); }}>
                      {showSelection && <Td><Checkbox aria-label={`${selectionHint}：${row.withdrawalNo}`} title={`${selectionNote}${selectionHint}`} disabled={!selectable && !selectedNow} checked={selectedNow} onChange={(event) => setSelected((current) => { const next = new Set(current); event.target.checked ? next.add(row.withdrawalNo) : next.delete(row.withdrawalNo); return next; })} /></Td>}
                      <Td sticky="start"><Cell mono full main={<button type="button" className="rd-cell-link" title={row.withdrawalNo} aria-label={`打开提现单 ${row.withdrawalNo} 的详情`} onClick={() => { if (!submitting) void openDetail(row); }}>{shortNo(row.withdrawalNo)}</button>} sub={listTime(row.createdAt)} /></Td>
                      {columns.isVisible("user") && <Td><Cell main={operatorNicknameText(row.nickname)} sub={canReadUserDetail ? <Link className="rd-link" href={`/users/search/${encodeURIComponent(row.userNo)}`}>{row.userNo}</Link> : row.userNo} /></Td>}
                      {columns.isVisible("asset") && <Td><Cell main={<span title={`${row.asset} / ${row.chain}`} aria-label={`资产与渠道：${row.asset} / ${row.chain}`}>{row.chain === "BANK-VND" ? "越南银行卡 · HDPay" : chainText(row)}</span>} sub={<span title={row.targetAddress}>{row.chain === "BANK-VND" ? "账户信息见详情" : shortAddress(row.targetAddress)}</span>} /></Td>}
                      {columns.isVisible("amount") && <Td align="right"><Cell num main={amountText(row.amount)} sub={`${row.chain === "BANK-VND" ? "兑换" : "到账"} ${amountText(row.netReceive)}`} /></Td>}
                      {columns.isVisible("fee") && <Td align="right"><Cell num main={amountText(row.actualFee)} sub={<button type="button" className="rd-link" onClick={() => void openDetail(row)}>详情中查看完整费用</button>} /></Td>}
                      <Td><Cell title={`低风险 ≤ ${row.k4BandLowMax ?? "—"}，高风险 ≥ ${row.k4BandHighMin ?? "—"}，加强审核 ≥ ${row.k4AutoEscalateScore ?? "—"}`} main={tone ? <StatusTag tone={tone} icon={tone === "danger" ? ShieldAlert : Flag}>{riskLabel}</StatusTag> : riskLabel} sub={hitCount ? reviewBasis : undefined} /></Td>
                      {columns.isVisible("account") && <Td><Cell main={`账户 ${userStatusLabel(row.userStatus)}`} sub={`近 24h ${row.withdrawalCount24h} 笔 · 每日上限 ${canReadD5 ? `${dailyLimit || "—"} 笔` : "无权限"}`} /></Td>}
                      <Td><Cell main={<StatusTag tone={statusTone(row.status)} icon={STATUS_ICON[row.status.toUpperCase()]}>{bankStatusLabel(row)}</StatusTag>} sub={pendingRow ? "有操作结果未确认" : isReviewPending(row.status) ? (mainAction === "APPROVE" ? approveBlock(row) : undefined) : lifecycleSummary(row)} title={(mainAction === "APPROVE" && approveBlock(row)) || lifecycleSummary(row)} /></Td>
                      {columns.isVisible("lifecycle") && <Td><Cell main={lifecycleSummary(row)} sub={holdsForReview(row) ? `复查时间：${timeText(row.holdUntil)}` : undefined} title={lifecycleSummary(row)} /></Td>}
                      <Td sticky="end" align="right"><span className="rd-row-actions">
                        {mainAction
                          ? <Button size="sm" disabled={!!submitting} disabledReason={blockedReason(row, mainAction)} onClick={() => void confirmReview(row, mainAction)}>{actionLabel(mainAction)}</Button>
                          : <Button size="sm" variant="ghost" onClick={() => void openDetail(row)}>单笔详情</Button>}
                        {moreActions.length > 0 && <MoreMenu disabled={!!submitting} items={moreActions.map((action) => ({ key: action, label: actionLabel(action), danger: action === "REJECT", disabledReason: blockedReason(row, action), onSelect: () => void confirmReview(row, action) }))} />}
                      </span></Td>
                    </Tr>;
                  })}
        </tbody>
      </Table>
      {/* 服务端分页总数：rows.total 由服务端分页返回，上一页、下一页在 Pager 里。 */}
      {!error && rows.total > 0 && <Pager label="提现单" sizeLabel="提现队列" total={rows.total} page={query.page} pageSize={query.pageSize} sizes={PAGE_SIZES} loading={loading} onPage={setPage} onPageSize={setPageSize} />}
    </Panel>

    <D2StatusFlow />

    <Drawer open={Boolean(detail)} onClose={closeDetail} title="单笔详情" icon={Wallet} tone="role-1" busy={!!submitting}
      sub={shown && <>{shown.withdrawalNo} <IconButton aria-label="复制提现单号" data-size="sm" onClick={() => copyNo(shown.withdrawalNo)}><Copy size={13} aria-hidden /></IconButton><StatusTag tone={statusTone(shown.status)} icon={STATUS_ICON[shown.status.toUpperCase()]} explain={STATUS_EXPLAIN[shown.status.toUpperCase()]}>{detailProvider ? cregisStatusLabel(cregisDetail?.state ?? shown.status) : bankStatusLabel(shown)}</StatusTag></>}
      nav={{ hasPrev: Boolean(prevRow), hasNext: Boolean(nextRow), onPrev: () => { if (prevRow) void openDetail(prevRow); }, onNext: () => { if (nextRow) void openDetail(nextRow); } }}
      footer={shown && <Decision note={decisionNote} explain={decisionExplain}
        danger={detailActions.includes("REJECT") ? decisionButton(shown, "REJECT") : detailActions.includes("REFUND") ? decisionButton(shown, "REFUND") : undefined}
        others={<>{(["DELAY", "FREEZE"] as const).filter((action) => detailActions.includes(action)).map((action) => decisionButton(shown, action))}</>}
        primary={<>
          {bankRecovery && bankDetail && <Button variant="primary" disabled={!!submitting} disabledReason={detailBlockedReason(shown)} onClick={() => confirmBankRequery(shown, bankDetail)}>查询银行打款结果</Button>}
          {cregisRecovery && cregisDetail && <Button variant="primary" disabled={!!submitting} disabledReason={detailBlockedReason(shown)} onClick={() => confirmCregisRecovery(shown, cregisDetail)}>核对 Cregis 打款单</Button>}
          {simulation && <Button variant="primary" disabled={!!submitting} disabledReason={simulationBlockedReason(shown)} onClick={() => confirmDevelopmentSimulation(shown)}>模拟冷却到期</Button>}
          {(["UNFREEZE", "APPROVE"] as const).filter((action) => detailActions.includes(action)).map((action) => decisionButton(shown, action))}
        </>} />}>
      {shown && <>
        {pendingCommands.some((record) => record.nos.includes(shown.withdrawalNo)) && <Notice tone="warn">这笔有结果未确认的操作，不要重复处理。状态变了也不算确认。到页面上方核对。</Notice>}
        {detailError && <Notice tone="danger" title="详情读取失败" action={<Button size="sm" onClick={() => void openDetail(shown)}>重试</Button>}>{detailError}</Notice>}
        <JudgmentPoints title={`判断要点 · 时间均为${businessZone().label}`} loading={detailLoading} rows={judgment} />
        <Fold inset title="风险规则" summary={ruleCount ? `${ruleCount} 条命中` : "没有命中"} alert={ruleCount > 0} icon={Shield} tone="risk">
          <div className="rd-stack">
            {riskHits.length > 0 && <RecordList label="触发的风险规则" records={riskHits} />}
            <Facts>{riskBreakdownFacts(shown.riskScoreBreakdown)}</Facts>
            <RawRecord label="查看风险原始记录" content={<div className="rd-stack"><p>{shown.riskReason || "—"}</p><p>{shown.riskScoreBreakdown || "—"}</p><p>{shown.hitRules || "—"}</p></div>} />
          </div>
        </Fold>
        {["USDT-BEP20", "BEP20"].includes(shown.chain) && <Fold inset title="Cregis 打款核对" icon={Link2} alert={!detailLoading && (!cregisDetail || cregisDetail.canRecover)} alertTone={cregisDetail?.canRecover ? "danger" : "warn"}
          summary={cregisDetail ? (detailProvider ? cregisStatusLabel(cregisDetail.state) : "未经 Cregis 打款") : "暂时无法获取"}>
          {cregisDetail ? <Facts>
            <Fact k="打款渠道">{detailProvider ? "Cregis" : "未经 Cregis 打款"}</Fact>
            <Fact k="打款单号（CID）">{cregisDetail.providerCid ?? (detailProvider ? "还没有，需到 Cregis 查询" : "—")}</Fact>
            <Fact k="处理状态">{detailProvider ? cregisStatusLabel(cregisDetail.state) : statusLabel(cregisDetail.state)}</Fact>
            {detailProvider && <>
              <Fact k="冻结的提现金额">{["PROCESSING", "SENT", "TX_ORPHANED"].includes(cregisDetail.state)
                ? "继续冻结，等待打款结果；不要重新打款或手动退款"
                : cregisDetail.state === "CONFIRMED" ? "已到账，已结算"
                  : "按正常提现流程结算，可在账单里核对"}</Fact>
              <Notice tone="progress">{cregisDetail.canRecover
                ? "查到打款单号后点「核对 Cregis 打款单」，不会重新打款。"
                : "系统会继续跟进打款结果；结果不明时请核对，不要重新放行或退款。"}</Notice>
            </>}
          </Facts> : <Notice tone="warn">打款信息正在加载或暂时无法获取，加载成功后再处理。</Notice>}
        </Fold>}
        {shown.chain === "BANK-VND" && <Fold inset title="HDPay 银行打款" icon={Landmark} alert={!detailLoading && (bankDetail?.beneficiaryEligibility?.canWithdraw !== true || bankDetail?.state === "MANUAL_REVIEW")}
          summary={bankDetail ? (bankDetail.beneficiaryEligibility?.canWithdraw === true ? "收款账户一致" : "暂不能审核放行") : "暂时无法获取"}>
          {bankDetail ? <><Facts>
            <Fact k="收款方式">按银行账号打款（银行未提前核验账号）</Fact><Fact k="收款账号">{bankDetail.maskedAccount}</Fact>
            <Fact k="锁定汇率">{`${bankDetail.rateVnd.toLocaleString("en-US")} ₫ / USDT`}</Fact>
            <Fact k="银行到账金额">{`${bankDetail.amountVnd.toLocaleString("en-US")} ₫`}</Fact>
            <Fact k="打款状态">{({READY:"准备出款",DISPATCHING:"派发中",PAID:"已到账",MANUAL_REVIEW:"待人工核查",CREATED:"待派发",PENDING:"待处理",PROCESSING:"银行处理中",SENT:"银行处理中",SUCCESS:"已到账",COMPLETED:"已到账",FAILED:"打款失败",REFUNDED:"已退款",CANCELLED:"已取消",UNKNOWN:"状态待核实"} as Record<string,string>)[bankDetail.state] ?? "状态待核实"}</Fact><Fact k="HDPay 单号">{bankDetail.providerOrderId || "尚未取得"}</Fact>
            <Fact k="收款账户">{bankDetail.beneficiaryEligibility?.canWithdraw === true ? "与订单收款账户一致" : "暂不能审核放行"}</Fact>
            {bankDetail.beneficiaryEligibility?.canWithdraw !== true && <Notice tone="warn">{bankDetail.beneficiaryEligibility?.reasonCode ? displayAdminError(new Error(bankDetail.beneficiaryEligibility.reasonCode)) : "收款账户状态加载失败，请刷新后重试。"}</Notice>}
            <Fact k="结算凭证">{bankDetail.settlementEvidence ? bankEvidenceLabels[bankDetail.settlementEvidence.status] : "暂无"}</Fact>
            {bankDetail.settlementEvidence?.evidenceRef && <>
              <Fact k="凭证编号">{bankDetail.settlementEvidence.evidenceRef}</Fact>
              <Fact k="确认时间">{bankEvidenceTime(bankDetail.settlementEvidence.checkedAt)}</Fact>
              {bankDetail.settlementEvidence.status === "refunded" && <Fact k="已退回余额">{`${bankDetail.settlementEvidence.amountUsdt?.toLocaleString("zh-CN", { maximumFractionDigits: 6 })} USDT`}</Fact>}
            </>}
          </Facts><p className="rd-note">核对提示：{bankDetail.lastError ? operationalText(bankDetail.lastError) : "按 HDPay 返回的结果自动结算；银行接单不代表已到账"}</p></> : <Notice tone="warn">收款账户信息正在加载或暂时无法获取，加载成功前不能放行。</Notice>}
        </Fold>}
        <Fold inset title="费用明细" summary={`手续费 ${money(shown.actualFee)}`} icon={Receipt}>
          {/* 先写到账怎么来的，手续费的构成再点开（DT-02）。 */}
          <div className="rd-stack">
            <Facts>
              <Fact k={shown.chain === "BANK-VND" ? "兑换金额（USDT）" : "实际到账"}>提现金额 {amountText(shown.amount)} − 手续费 {amountText(shown.actualFee)} = {money(shown.netReceive)}</Fact>
            </Facts>
            <Fold inset title="手续费构成" summary={`UVT 抵扣 ${shown.nexBurned} UVT，减免 ${money(shown.feeWaived)}`}>
              <Facts>
                {shown.chain === "BANK-VND" ? <Fact k="银行手续费">{money(shown.actualFee)}</Fact> : shown.feeModel === "confirm" ? <Fact k="网络确认费">{`${money(shown.networkConfirmUsd ?? 0)}（每笔固定）`}</Fact> : <>
                  <Fact k="网络费">{money(shown.networkFee ?? 0)}</Fact>
                  <Fact k="网络费率 / 区间">{shown.networkFeeMin === shown.networkFeeMax ? `固定 ${money(shown.networkFeeMin ?? 0)}` : `${shown.networkFeeRate ?? "—"}，${money(shown.networkFeeMin ?? 0)}–${money(shown.networkFeeMax ?? 0)}`}</Fact>
                  <Fact k="手续费合计">{money(shown.grossFee ?? 0)}</Fact>
                  <Fact k="手续费费率">{`${shown.penaltyFeeRate ?? "—"}%`}</Fact>
                </>}
                <Fact k="UVT 抵扣">{`${shown.nexBurned} UVT`}</Fact>
                <Fact k="费用减免">{money(shown.feeWaived)}</Fact>
                <Fact k="UVT 抵扣率">{`${shown.nexFeeOffsetRate} USDT/UVT`}</Fact>
              </Facts>
            </Fold>
          </div>
        </Fold>
        <Fold inset title="收款与用户信息" summary={`账户${userStatusLabel(shown.userStatus)}，24h 第 ${shown.withdrawalCount24h} 笔`} icon={User} tone="users">
          <Facts>
            <Fact k="用户编号">{canReadUserDetail ? <Link className="rd-link" href={`/users/search/${encodeURIComponent(shown.userNo)}`}>{shown.userNo}</Link> : shown.userNo}</Fact>
            <Fact k="昵称">{operatorNicknameText(shown.nickname)}</Fact>
            <Fact k="用户等级">{shown.userLevel || "—"}</Fact>
            <Fact k="手机号">{shown.phoneMasked || "未展示手机号"}</Fact>
            <Fact k="资产 / 网络">{payoutChannel(shown)}</Fact>
            <Fact k="目标地址"><span data-mono>{shown.targetAddress}</span></Fact>
            <Fact k="IP 段">{shown.ipSegment || "—"}</Fact>
            {deviceFacts(shown.deviceSummary)}
            {factRows(shown.referralPosition, "团队位置").map((row) => <Fact key={row.key} k={row.label}>{row.value}</Fact>)}
          </Facts>
        </Fold>
        <Fold inset title="提现历史" summary={historyRecords.length ? `共 ${historyRecords.length} 笔` : "没有记录"} icon={History}>
          <RecordList key={shown.withdrawalNo} label="提现历史" records={historyRecords} />
          {shown.withdrawalHistory && <RawRecord label="查看提现历史原文" content={shown.withdrawalHistory} />}
        </Fold>
        <Fold inset title="状态历史" summary={`${statusEntries.length} 个时间节点`} icon={Route}>
          {/* 现在是什么样、怎么走到这里，分两块（VS-109）。这单为什么在这里写在判断要点，不再写一遍。 */}
          <div className="d2-history">
            <section aria-label="现在">
              <p className="rd-note">现在</p>
              <Facts>
                <Fact k="当前状态"><StatusTag tone={statusTone(shown.status)}>{bankStatusLabel(shown)}</StatusTag></Fact>
                {shown.previousStatus && <Fact k="上一状态">{statusLabel(shown.previousStatus)}</Fact>}
                {holdsForReview(shown) && <Fact k="复查时间">{timeText(shown.holdUntil)}</Fact>}
                <Fact k="责任人">{lifecycleOwnerText(shown.lifecycleOwner)}</Fact>
                {shown.freezePeriod && <Fact k="持有 / 冻结期限">{freezePeriodLabel(shown.freezePeriod)}{H1_RHYTHM.test(shown.freezePeriod) && <Explain label="运营阶段怎么影响这笔" content="这笔提现申请时，运营阶段是这里写的第几月、P 几，冷却天数按那时「运营阶段设置」的值算。冷却中的单什么时候处理，看复查时间。" />}</Fact>}
              </Facts>
            </section>
            <section aria-label="经过">
              <p className="rd-note">经过</p>
              <Timeline label="状态历史" entries={statusEntries} />
            </section>
          </div>
          {(shown.failureReason || shown.statusHistory) && <RawRecord label="查看状态历史原文" content={<div className="rd-stack"><p>{shown.failureReason || "—"}</p><p>{shown.statusHistory || "—"}</p></div>} />}
        </Fold>
        <Fold inset title="操作记录" summary={`${auditEntries.length} 条操作`} icon={ClipboardList}
          explain="这里只有操作和时间，年份按提交时间推算，顺序和原记录一样。操作人和完整时间到操作记录与审批核对。">
          <Timeline label="操作记录" entries={auditEntries} />
          {shown.auditTrail && <RawRecord label="查看操作记录原文" content={shown.auditTrail} />}
        </Fold>
      </>}
    </Drawer>

    {releasing && <ReleaseModal label={releasing.label} onCancel={() => setReleasing(null)} onConfirm={() => releasePending(releasing)}
      explain="重试被拒说明不了原操作的结果，先到操作记录或打款方确认。解除后原操作不再重试，系统仍按这笔现在的状态校验。" />}

    {batchResult && <Modal title={`批量${actionLabel(batchResult.action)}结果`} icon={ClipboardList} onClose={() => setBatchResult(null)} footer={<Button variant="primary" onClick={() => setBatchResult(null)}>知道了</Button>}>
      <Facts>
        <Fact k="批次">{batchResult.result.batchId}</Fact>
      </Facts>
      <Fold inset title="成功" summary={`${batchResult.result.accepted.length} 笔`} defaultOpen={batchResult.result.accepted.length > 0 && batchResult.result.conflicts.length === 0}>
        <RecordList label="批量成功的提现" records={batchResult.result.accepted.map((id) => ({ id, value: "处理成功", reference: id, status: <StatusTag tone="ok">成功</StatusTag> }))} />
      </Fold>
      <Fold inset title="大额转人工" summary={`${batchResult.result.rejected.length} 笔`}>
        <RecordList label="大额转人工的提现" records={batchResult.result.rejected.map((id) => ({ id, value: "转单笔人工审核", reference: id, status: <StatusTag tone="warn">未批量放行</StatusTag> }))} />
      </Fold>
      <Fold inset title="未执行" summary={`${batchResult.result.conflicts.length} 笔`} alert={batchResult.result.conflicts.length > 0}>
        <RecordList label="批量未执行的提现" records={batchResult.result.conflicts.map((conflict) => ({ id: conflict.withdrawalId, reference: conflict.withdrawalId,
          value: displayAdminError(new Error(conflict.reason)), status: <StatusTag tone="warn">{MOVED_STATE_CODES.includes(conflict.reason) ? "状态已变化" : "未执行"}</StatusTag> }))} />
      </Fold>
    </Modal>}
  </>;
}
