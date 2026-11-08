"use client";

/**
 * 用户详情（PG-50，详情页样板）。/users/search/{用户编码} 和客服的 /service/customers/{id} 共用这一页，
 * 读取范围分开：客服走 support-workbench，隐藏处理入口和写动作，支付安全解除是唯一例外（W05）。
 * 页面只消费后端聚合的 360 画像和操作接口，缺的区块不显示，权限裁剪不靠前端补造（C1-P10）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Cpu, FileClock, Lock, Network, RefreshCcw, ShieldAlert, ShieldCheck, Snowflake, UserCog, UsersRound, Wallet, type LucideIcon } from "lucide-react";
import {
  fetchUser360,
  fetchSupportCustomerFullProfile,
  fetchUserPaymentMethods,
  executeUserDeviceTradein,
  notifyUserPaymentMethodRebind,
  resetUserNickname,
  unbindUserPaymentMethod,
  UsersOutcomeUnknownError,
  UsersRequestError,
  type JsonRecord,
  type UserPaymentMethod,
  type UserPaymentMethodPage,
  type User360Detail,
  type User360Profile,
  type User360Section,
  type User360Summary,
} from "@/lib/admin/user360-client";
import { fetchD1TopupFlows } from "@/lib/admin/d-client";
import { withdrawalRecordLabel } from "@/lib/admin/withdrawal-status";
import { OperationConfirmModal, type OperatorBriefKind } from "@/app/components/domain-views/design-kit";
import {
  BlockState, Button, Cell, Change, Check, Conclusion, Decision, Drawer, Explain, Fact, Facts, Fold, IrreversibleTag, Notice, PageHeader, Pager, Panel,
  RdPage, ReleaseModal, SectionNav, Segments, Stat, StatBand, StatusTag, Table, Td, Th, Timeline, Tr, useSectionNav, type SectionNavItem, type StateTone, type TimelineEntry,
} from "@/app/components/rd";
import { useReach } from "@/lib/nav/use-reach";
import { formatD4Subtype } from "@/lib/admin/d4-ledger-display";
import { businessClock, businessZone, formatBusinessTimeCompact, formatBusinessTimeFull, parseBusinessTime } from "@/lib/admin/business-time";
import { platformSessionDeviceText, userNicknameText, nexGridBrandText, operatorNicknameText, datacenterNameText } from "@/lib/admin/brand-copy";
import { fmtNum } from "@/lib/format";
import { toast } from "@/lib/store/ui";
import { createPendingMutationStore, type PendingMutationExtra, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { roleLabel, type AdminRole } from "@/lib/nav/console-nav";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError } from "@/lib/admin/error-messages";
import { isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { paymentSecurityPorts } from "@/lib/admin/payment-password-client";
import {
  formatC1DeviceStatus,
  formatC1DeviceTier,
  formatC1NotificationType,
  formatC1PushStatus,
  formatC1ReadFlag,
  formatC1RuntimeStatus,
  formatC1SessionStatus,
} from "@/lib/admin/c1-detail-display";
import { NotificationTimeEvidenceDrawer, pendingCorrections, type PendingCorrection } from "./notification-time-evidence";
import { PaymentSecurityBlock, type PaymentSecurityState } from "@/app/components/payment-security/payment-security-block";

/**
 * C1 用户详情的写动作（昵称重置、支付方式解绑、换绑通知、回收并记录置换和回收）共用一张表，槽位分命名空间。
 * 槽位带用户 ID 和目标 ID：命令号跨刷新存活，不带目标就会在切到下一个用户时复用上一个目标的号。
 * 原操作内容一起存，结果未知时只能原样重试（OP-94）。
 */
type C1CommandKind = "nickname" | "unbind" | "rebind" | "replace" | "recycle";
type C1Command = PendingMutationRecord & {
  kind: C1CommandKind;
  label: string;
  adminKey: string;
  userId: string;
  reason: string;
  operator: string;
  nickname?: string;
  methodId?: number;
  version?: number;
  deviceId?: number;
  deviceStatus?: string;
  /** 重试被后端明确拒绝过，只有这时才给「解除待确认」（OP-93 第 8 条）。存在记录里，刷新和过期后还在。 */
  retryRejected?: boolean;
  /** 改版前留下的记录：只有命令号和目标，没存理由，不能原样重试（OP-94），但原操作可能已经生效，要留着核对。 */
  legacy?: boolean;
  inputFingerprint?: string;
};
type C1CommandInput = PendingMutationExtra<C1Command>;
const LEGACY_SLOT = /^(nickname-reset|payment-unbind|payment-rebind|device-replace|device-recycle)\|([^|]+)(?:\|(\d+))?$/;
const LEGACY_COMMAND: Record<string, readonly [C1CommandKind, string]> = {
  "nickname-reset": ["nickname", "重置昵称"],
  "payment-unbind": ["unbind", "解绑支付方式"],
  "payment-rebind": ["rebind", "发送换绑通知"],
  "device-replace": ["replace", "回收并记录置换"],
  "device-recycle": ["recycle", "设备回收"],
};
const c1UserCommands = createPendingMutationStore<C1Command>({
  storageKey: "nexion-admin-c1-user-detail-commands-v1",
  // 过期不能重试，记录也不删（OP-96）：到期不等于原操作没生效，对象继续锁着。
  retainExpiredRecords: true,
  isValidRecord: (record) => typeof record.kind === "string" && typeof record.userId === "string" && typeof record.reason === "string" && record.reason.length > 0
    || typeof record.inputFingerprint === "string" && LEGACY_SLOT.test(record.fingerprint),
});
/** 旧记录读出来补上目标，缺的理由不补（C1-H04）。 */
const c1Command = (record: C1Command): C1Command => {
  if (record.kind) return record;
  const [, action, userId, target] = LEGACY_SLOT.exec(record.fingerprint) ?? [];
  const [kind, name] = LEGACY_COMMAND[action];
  const targetId = Number(target);
  return { ...record, kind, legacy: true, userId, adminKey: "", reason: "", operator: "",
    label: kind === "nickname" ? name : `${name} · 编号 ${target}`,
    methodId: kind === "unbind" || kind === "rebind" ? targetId : undefined,
    deviceId: kind === "replace" || kind === "recycle" ? targetId : undefined };
};
const nicknameSlot = (userId: string | number) => `nickname-reset|${userId}`;
const paymentSlot = (action: "unbind" | "rebind", userId: string | number, methodId: number) =>
  `payment-${action}|${userId}|${methodId}`;
const deviceSlot = (action: "replace" | "recycle", userId: string | number, deviceId: number) =>
  `device-${action}|${userId}|${deviceId}`;
const commandSlot = (command: C1CommandInput) => command.kind === "nickname"
  ? nicknameSlot(command.userId)
  : command.kind === "unbind" || command.kind === "rebind"
    ? paymentSlot(command.kind, command.userId, command.methodId ?? 0)
    : deviceSlot(command.kind, command.userId, command.deviceId ?? 0);
const COMMAND_PREFIX: Record<C1CommandKind, string> = {
  nickname: "c1-nickname-reset",
  unbind: "c1-payment-unbind",
  rebind: "c1-payment-rebind",
  replace: "c2-device",
  recycle: "c2-device",
};
const COMMAND_FAILURE: Record<C1CommandKind, string> = {
  nickname: "昵称重置失败",
  unbind: "支付方式解绑失败",
  rebind: "换绑通知失败",
  replace: "设备操作失败",
  recycle: "设备操作失败",
};
const outcomeUnknown = (cause: unknown) => cause instanceof UsersOutcomeUnknownError || cause instanceof UsersRequestError && cause.code === "IDEMPOTENCY_RESULT_UNKNOWN";

/** C1 画像「登录安全」默认每页条数：后端下发最近最多 50 条会话，首屏只渲染最近一页。 */
const C1_SESSION_PAGE_SIZE = 5;
type SessionStatusFilter = "ALL" | "ACTIVE" | "REVOKED" | "EXPIRED";
const C1_SESSION_STATUS_FILTERS: ReadonlyArray<readonly [SessionStatusFilter, string]> = [
  ["ALL", "全部"],
  ["ACTIVE", "活跃"],
  ["REVOKED", "已撤销"],
  ["EXPIRED", "已过期"],
];
const FINAL_DEVICE_STATUS = ["RECYCLED", "DEACTIVATED", "INACTIVE", "RETIRED"];

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "正常",
  FROZEN: "冻结",
  BANNED: "封禁",
  RESTRICTED: "受限",
};

/** 冻结和受限不是等待，默认的钟读起来像处理中。 */
const STATUS_ICON: Record<string, LucideIcon> = { FROZEN: Snowflake, RESTRICTED: Lock };

/** 提现状态的叫法和提现审核页同一份（withdrawalRecordLabel）。颜色按这页的用途：等人处理的橙黄，计入结论的「等待处理」；失败和异常红。旧码跟后端对应的新码同色。 */
const WITHDRAWAL_TONE: Record<string, "ok" | "warn" | "danger" | "progress" | "done"> = {
  SUBMITTED: "progress", PENDING: "progress", REVIEW_PENDING: "warn", REVIEWING: "warn", EXTENDED_HOLD: "warn", DELAYED: "warn", FROZEN: "warn",
  REVIEW_PASSED: "progress", PENDING_CHAIN: "progress", PROCESSING: "progress", SENT: "progress", CHAIN_SUBMITTED: "progress", CONFIRMED: "ok", SUCCESS: "ok",
  REVIEW_REJECTED: "danger", REJECTED: "danger", ADDRESS_INVALID: "danger", TX_FAILED: "danger", FAILED: "danger", TX_ORPHANED: "danger", DEAD: "danger", REFUNDED: "done",
};
const ORDER_STATE: Record<string, readonly [string, "ok" | "warn" | "danger" | "progress" | "done"]> = {
  placed: ["待付款", "warn"], paid: ["已付款", "progress"], provisioning: ["设备开通中", "progress"], activated: ["已开通", "ok"], payment_failed: ["付款失败", "danger"],
  expired: ["已过期", "done"], provisioning_failed: ["开通失败", "danger"], cancelled: ["已取消", "done"], refunded: ["已退款", "done"], chargeback: ["已拒付", "danger"],
};
/** 充值状态码按后端充值流水的三组上色（OpsFinanceService TOPUP_FLOW_STATUSES）：待确认是处理中，异常组是要核对的；已入账和不认识的码不上色。文字用后端的 statusLabel。 */
const DEPOSIT_TONE: Record<string, "progress" | "danger"> = Object.fromEntries([
  ...["CREATED", "PENDING", "CONFIRMING", "WAITING_CONFIRMATION"].map((code) => [code, "progress"] as const),
  ...["FAILED", "DECLINED", "EXPIRED", "REJECTED", "ABNORMAL", "CHARGEBACK", "DISPUTED", "CHARGEBACK_REVIEW", "CHARGEBACK_REFUNDED", "CHARGEBACK_RECOVERED", "CHARGEBACK_PARTIAL"].map((code) => [code, "danger"] as const),
]);
const DIRECTION: Record<string, string> = { IN: "收入", OUT: "支出" };
const EXPIRED_TEXT = "已超过 24 小时，不能再重试，请到操作记录与审批核对";
const withdrawalTone = (row: JsonRecord) => WITHDRAWAL_TONE[asText(row.status, "").toUpperCase()];
const withdrawalLabel = (row: JsonRecord) => withdrawalRecordLabel({ status: asText(row.status, ""), chain: asText(row.chain, "") });
const depositTone = (row: JsonRecord) => DEPOSIT_TONE[asText(row.status, "").toUpperCase()];
const orderTone = (row: JsonRecord) => ORDER_STATE[asText(row.state, "").toLowerCase()]?.[1];
const deviceAbnormal = (row: JsonRecord) => asText(row.status, "").toUpperCase() === "FAULT" || asText(row.runtimeStatus, "").toUpperCase() === "ERROR";

function asText(value: unknown, fallback = "—") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  return fallback;
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function asArray<T extends JsonRecord = JsonRecord>(value: unknown): T[] {
  return Array.isArray(value)
    ? value.filter((row): row is T => !!row && typeof row === "object" && !Array.isArray(row))
    : [];
}

function numberLabel(value: unknown) {
  const number = asNumber(value, NaN);
  return Number.isFinite(number) ? fmtNum(number) : "—";
}

/** 金额按接口原值显示，至少两位小数，不舍入，非零不会变成 0（TX-20）。读不到写「—」，不当成 0。 */
function amountValue(value: unknown) {
  const raw = typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 })
    : typeof value === "string" ? value.trim() : "";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return raw || "—";
  return `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(match[3] ?? "").padEnd(2, "0")}`;
}

function assetText(value: unknown) {
  const asset = nexGridBrandText(asText(value, ""));
  return asset === "NEX" ? "UVT" : asset;
}

function amountText(value: unknown, asset: unknown = "USDT") {
  const amount = amountValue(value);
  const unit = assetText(asset);
  return amount === "—" || !unit ? amount : `${amount} ${unit}`;
}

function statusLabel(value: unknown) {
  const key = asText(value).toUpperCase();
  return STATUS_LABEL[key] ?? "状态未知";
}

function statusTone(value: unknown) {
  const key = asText(value).toUpperCase();
  if (key === "ACTIVE") return "ok" as const;
  if (key === "FROZEN" || key === "RESTRICTED") return "warn" as const;
  if (key === "BANNED") return "danger" as const;
  return "done" as const;
}

const shortTime = (value: unknown) => formatBusinessTimeCompact(value, "—");
const fullTime = (value: unknown) => formatBusinessTimeFull(value, "—");
const yesNo = (value: unknown, on = "是", off = "否") => value == null ? "—" : value ? on : off;

function sectionFailed(section: User360Section | null | undefined) {
  return ["ERROR", "UNKNOWN", "UNAVAILABLE"].includes(asText(section?.sourceStatus, "READY").toUpperCase());
}

function auditDetail(row: JsonRecord) {
  const detail = row.detailJson;
  if (typeof detail === "string" && detail.trim()) {
    try {
      const parsed = JSON.parse(detail) as Record<string, unknown>;
      const reason = asText(parsed.reason, "");
      const fromStatus = asText(parsed.fromStatus, "");
      const toStatus = asText(parsed.toStatus, "");
      const accountStatus = ["C2_USER_STATUS_CHANGED", "C2_USER_STATUS_CHANGED_BY_K1", "C2_USER_STATUS_RESTORED_BY_K1"].includes(asText(row.action, "").toUpperCase().replace(/^ADMIN\./, ""));
      if (reason && fromStatus && toStatus && accountStatus) return `${statusLabel(fromStatus)} → ${statusLabel(toStatus)} · ${reason}`;
      if (reason) return reason;
    } catch {
      return detail;
    }
  }
  return asText(row.result, "");
}

function auditRole(row: JsonRecord): AdminRole | undefined {
  const raw = asText(row.operatorRole ?? row.actorRole ?? row.role ?? row.roleGate, "").toLowerCase();
  if (!raw) return undefined;
  if (raw.includes("superadmin") || raw.includes("超管") || raw.includes("总管理员")) return "superadmin";
  if (raw.includes("finance") || raw.includes("财务")) return "finance";
  if (raw.includes("config") || raw.includes("配置")) return "config";
  if (raw.includes("risk") || raw.includes("风控")) return "risk";
  if (raw.includes("content") || raw.includes("内容")) return "content";
  if (raw.includes("growth") || raw.includes("增长")) return "growth";
  if (raw.includes("support") || raw.includes("客服")) return "support";
  if (raw.includes("auditor") || raw.includes("audit") || raw.includes("审计")) return "auditor";
  return undefined;
}

/** 事件是给人读的主文字，原始代码只留在问号里（VS-109）。不在表里的写「后台操作」，不把代码拼上屏。 */
const AUDIT_EVENT: Record<string, string> = {
  USER_PROFILE_VIEWED: "查看了用户资料", USER_PROFILE_SEARCHED: "搜索了用户", USER_LIST_EXPORTED: "导出了用户列表", USER_PAYMENT_METHOD_LIST: "查看了支付方式",
  USER_PAYMENT_METHOD_UNBIND: "解绑支付方式", USER_PAYMENT_METHOD_REBIND_NOTICE: "发送换绑通知", USER_NICKNAME_RESET: "重置昵称", USER_NOTIFICATION_TIME_CORRECTED: "校正通知时间",
  PAYMENT_METHOD_PROVIDER_REVOKE_FAILED: "支付商撤销失败",
  C2_USER_STATUS_CHANGED: "修改账户状态", C2_USER_STATUS_CHANGED_BY_K1: "风控修改账户状态", C2_USER_STATUS_RESTORED_BY_K1: "风控恢复账户状态", C2_USER_SESSIONS_REVOKED: "强制登出全部设备",
  C2_USER_IMPERSONATION_STARTED: "打开用户数据只读视图", C2_USER_IMPERSONATION_TERMINATED: "结束用户数据只读视图", C2_ACCOUNT_LIST_UPSERTED: "更新账户名单", C2_ACCOUNT_LIST_REMOVED: "移出账户名单",
  C3_ASSET_ADJUSTMENT_CREATED: "创建余额调整", C3_ASSET_ADJUSTMENT_EXECUTED: "执行余额调整", C3_ASSET_ADJUSTMENT_REVERSED: "冲正余额调整", C3_ASSET_ADJUSTMENT_WITHDRAWN: "撤回余额调整", C3_LARGE_ADJUSTMENT_REQUESTED: "申请大额余额调整",
  C5_TWO_FACTOR_DISABLED: "关闭两步验证", C5_PASSWORD_RESET_REQUESTED: "发起重置密码", C5_USER_UNLOCKED: "解锁账号", C5_SESSION_REVOKED: "撤销一条登录", C5_ALL_SESSIONS_REVOKED: "撤销全部登录",
};
const auditEvent = (row: JsonRecord) => AUDIT_EVENT[asText(row.action, "").toUpperCase().replace(/^ADMIN\./, "")] ?? "后台操作";

function toAuditEntries(rowsValue: unknown): TimelineEntry[] {
  return asArray(rowsValue).map((row, index) => {
    const role = auditRole(row);
    const failed = asText(row.result, "").toUpperCase() === "FAILED";
    const note = auditDetail(row);
    return {
      id: asText(row.id, `${index}`),
      actor: asText(row.actorUsername, "系统"),
      role: role ? roleLabel(role) : undefined,
      action: <>{auditEvent(row)}{failed ? " · 失败" : ""} <Explain label="原始操作内容" content={<><p className="rd-pre">{asText(row.action, "UNKNOWN")}</p><p className="rd-pre">{asText(row.detailJson, asText(row.result))}</p><p>结果：{asText(row.result)}</p></>} /></>,
      // 成功是常态不写，只留理由和前后状态，一条两行（VS-109）。
      detail: /^success$/i.test(note) ? undefined : note || undefined,
      at: asText(row.createdAt, ""),
      ip: asText(row.clientIp, "—"),
      tone: failed ? "danger" : undefined,
    };
  });
}

/** 风险标记后端给的是码。账户状态在身份行、案件数在风险案件，这里不重复，有别的标记才写。 */
function riskFlags(flags: unknown, showsCases: boolean) {
  return (Array.isArray(flags) ? flags : []).map((flag) => {
    const text = asText(flag, "");
    const cases = /^OPEN_RISK_CASES:(\d+)$/.exec(text);
    if (cases) return showsCases ? "" : `${cases[1]} 个风险案件未关闭`;
    return text in STATUS_LABEL ? "" : text;
  }).filter(Boolean).join(" · ") || "无";
}

const revokeUnfinished = (method: UserPaymentMethod) => method.status !== "BOUND" && !!method.pspRevokeStatus && !/^(revoked|confirmed|success|succeeded|done|completed)$/i.test(method.pspRevokeStatus);

interface Column { label: string; align?: "right"; end?: boolean; cell: (row: JsonRecord) => ReactNode }

const statusCell = (table: Record<string, readonly [string, "ok" | "warn" | "danger" | "progress" | "done"]>, value: string, unknown: string) => {
  const hit = table[value];
  return hit ? <StatusTag tone={hit[1]}>{hit[0]}</StatusTag> : unknown;
};
const withdrawalStatus = (row: JsonRecord) => {
  const tone = withdrawalTone(row);
  return tone ? <StatusTag tone={tone}>{withdrawalLabel(row)}</StatusTag> : withdrawalLabel(row);
};
/** 已入账照旧写字，待确认和异常才用标签。 */
const depositStatus = (row: JsonRecord) => {
  const tone = depositTone(row);
  return tone ? <StatusTag tone={tone}>{asText(row.statusLabel)}</StatusTag> : asText(row.statusLabel);
};
const orderStatus = (row: JsonRecord) => statusCell(ORDER_STATE, asText(row.state, "").toLowerCase(), "订单状态待核实");
const deviceTag = (row: JsonRecord) => {
  const status = asText(row.status, "").toUpperCase();
  const tone = deviceAbnormal(row) ? "danger" : FINAL_DEVICE_STATUS.includes(status) ? "done" : ["ONLINE", "RUNNING", "ACTIVE"].includes(status) ? "ok" : "neutral";
  return <StatusTag tone={tone}>{formatC1DeviceStatus(status)}</StatusTag>;
};
const sessionTag = (row: JsonRecord) => <StatusTag tone={asText(row.status, "").toUpperCase() === "ACTIVE" ? "ok" : "done"}>{formatC1SessionStatus(row.status)}</StatusTag>;
const paymentTag = (row: JsonRecord) => <StatusTag tone={row.status === "BOUND" ? "ok" : "done"}>{row.status === "BOUND" ? (row.isDefault ? "已绑定 · 默认" : "已绑定") : "已解绑"}</StatusTag>;
const pushText = (row: JsonRecord) => asText(row.pushStatus, "").toUpperCase() === "FAILED"
  ? <StatusTag tone="danger">{formatC1PushStatus(row.pushStatus)}</StatusTag>
  : formatC1PushStatus(row.pushStatus);

const SESSION_COLUMNS: Column[] = [
  { label: "设备", cell: (row) => <Cell main={platformSessionDeviceText(asText(row.deviceName))} /> },
  { label: "IP", cell: (row) => <Cell mono main={asText(row.clientIpMasked)} /> },
  { label: "状态", cell: sessionTag },
  { label: "登录时间", cell: (row) => <Cell num main={shortTime(row.issuedAt)} /> },
  { label: "过期时间", cell: (row) => <Cell num main={shortTime(row.expiresAt)} /> },
];
const DEPOSIT_COLUMNS: Column[] = [
  { label: "充值单号", cell: (row) => <Cell mono full main={asText(row.depositNo)} /> },
  { label: "金额 · 渠道", align: "right", cell: (row) => <Cell num main={amountText(row.amount, row.asset)} sub={asText(row.channel)} /> },
  { label: "状态", cell: (row) => <Cell main={asText(row.statusLabel)} /> },
  { label: "确认时间", cell: (row) => <Cell num main={shortTime(row.confirmedAt)} /> },
];
const WITHDRAWAL_COLUMNS: Column[] = [
  { label: "提现单号", cell: (row) => <Cell mono full main={asText(row.withdrawalNo)} /> },
  { label: "金额 · 链", align: "right", cell: (row) => <Cell num main={amountText(row.amount, row.asset)} sub={asText(row.chain)} /> },
  { label: "状态 · 风险分", cell: (row) => <Cell main={withdrawalStatus(row)} sub={`风险分 ${asText(row.riskScore)}`} /> },
  { label: "创建时间", cell: (row) => <Cell num main={shortTime(row.createdAt)} /> },
];
const EARNING_COLUMNS: Column[] = [
  { label: "业务单号", cell: (row) => <Cell mono full main={asText(row.bizNo)} /> },
  { label: "类型 · 方向", cell: (row) => <Cell main={formatD4Subtype(row.bizType)} sub={DIRECTION[asText(row.direction, "").toUpperCase()] ?? "—"} /> },
  { label: "金额 · 余额", align: "right", cell: (row) => <Cell num main={amountText(row.amount, row.asset)} sub={amountText(row.balanceAfter, row.asset)} /> },
  { label: "时间", cell: (row) => <Cell num main={shortTime(row.createdAt)} /> },
];
const MEMBER_COLUMNS: Column[] = [
  { label: "成员编码", cell: (row) => <Cell mono main={asText(row.memberNo)} /> },
  { label: "昵称", cell: (row) => <Cell main={operatorNicknameText(asText(row.nickname))} /> },
  { label: "团队等级", cell: (row) => asText(row.vRank) },
  { label: "相隔邀请次数", align: "right", cell: (row) => <Cell num main={asText(row.level)} /> },
  { label: "贡献额", align: "right", cell: (row) => <Cell num main={amountText(row.volume)} /> },
  { label: "加入时间", cell: (row) => <Cell num main={shortTime(row.createdAt)} /> },
];
const ENGAGEMENT_COLUMNS: Column[] = [
  { label: "项目", cell: (row) => <Cell main={asText(row.name)} /> },
  { label: "状态", cell: (row) => asText(row.status) },
  { label: "进度", cell: (row) => asText(row.progress) },
  { label: "更新时间", cell: (row) => <Cell num main={shortTime(row.updatedAt)} /> },
];
const EXCHANGE_COLUMNS: Column[] = [
  { label: "业务单号", cell: (row) => <Cell mono full main={asText(row.bizNo)} /> },
  { label: "类型 · 方向", cell: (row) => <Cell main={formatD4Subtype(row.bizType)} sub={DIRECTION[asText(row.direction, "").toUpperCase()] ?? "—"} /> },
  { label: "金额", align: "right", cell: (row) => <Cell num main={amountText(row.amount, row.asset)} /> },
  { label: "时间", cell: (row) => <Cell num main={shortTime(row.createdAt)} /> },
];
const ORDER_COLUMNS: Column[] = [
  { label: "订单号", cell: (row) => <Cell mono full main={asText(row.orderNo)} /> },
  { label: "商品 · 机房", cell: (row) => <Cell main={asText(row.skuName)} sub={datacenterNameText(asText(row.dcLocation))} /> },
  { label: "金额", align: "right", cell: (row) => <Cell num main={amountText(row.amount)} /> },
  { label: "状态", cell: orderStatus },
  { label: "下单时间", cell: (row) => <Cell num main={shortTime(row.orderedAt)} /> },
];

/** 后端把审核表单拼在说明后面，这里只取中文说明，原因码留给提现审核。 */
const withdrawalReason = (row: JsonRecord) => {
  const note = asText(row.failureReason, "").split(" | ")[0].trim();
  return /[\u4e00-\u9fa5]/.test(note) ? note : "";
};

/** 单条记录抽屉：表格放不下或要查证的字段都在这里（PG-50）。对象写在副标题，这里不再写一遍；决定要用的金额和状态排最前（DP-16）。 */
type RecordKind = "session" | "payment" | "deposit" | "topup" | "withdrawal" | "device" | "earning" | "member" | "engagement" | "exchange" | "notification" | "order";
const mono = (value: unknown) => <span data-mono>{asText(value)}</span>;
/** 充值记录和不在列表里的那笔最近充值（待确认、失败的）共用一个抽屉。 */
const DEPOSIT_RECORD = { title: "充值记录", sub: (row: JsonRecord) => mono(row.depositNo), facts: (row: JsonRecord) => [
  ["金额", amountText(row.amount, row.asset)], ["状态", depositStatus(row)], ["渠道", asText(row.channel)], ["币种", assetText(row.asset) || "—"],
  ["发起时间", fullTime(row.createdAt)], ["确认时间", fullTime(row.confirmedAt)],
] as const };
const RECORD: Record<RecordKind, { title: string; sub: (row: JsonRecord) => ReactNode; facts: (row: JsonRecord) => readonly (readonly [string, ReactNode])[] }> = {
  session: { title: "登录记录", sub: (row) => platformSessionDeviceText(asText(row.deviceName)), facts: (row) => [
    ["状态", sessionTag(row)], ["IP", asText(row.clientIpMasked)], ["登录时间", fullTime(row.issuedAt)], ["过期时间", fullTime(row.expiresAt)],
  ] },
  payment: { title: "支付方式", sub: (row) => `${asText(row.brand)} ···· ${asText(row.last4)}`, facts: (row) => [
    ["状态", paymentTag(row)], ["提供商", asText(row.provider)], ["有效期", asText(row.expiryLabel, "无到期信息")],
    ["历史试用关联", row.trialGuard ? `历史试用记录 · ${asText(row.trialRefId, "关联试用")}` : "否"],
    ["解绑时间", shortTime(row.unboundAt)], ["支付商撤销状态", asText(row.pspRevokeStatus)], ["撤销命令号", asText(row.revokeCommandNo)],
    ["重试次数", asText(row.revokeAttempts)], ["撤销时限", shortTime(row.revokeDeadlineAt)], ["最近错误", asText(row.revokeLastError)],
  ] },
  deposit: DEPOSIT_RECORD,
  topup: DEPOSIT_RECORD,
  withdrawal: { title: "提现记录", sub: (row) => mono(row.withdrawalNo), facts: (row) => [
    ["金额", amountText(row.amount, row.asset)], ["状态", withdrawalStatus(row)], ...(withdrawalReason(row) ? [["原因", withdrawalReason(row)] as const] : []),
    ["风险分", asText(row.riskScore)], ["币种", assetText(row.asset) || "—"], ["链", asText(row.chain)], ["创建时间", fullTime(row.createdAt)],
  ] },
  device: { title: "设备明细", sub: (row) => mono(row.instanceNo), facts: (row) => [
    ["状态", deviceTag(row)], ["运行状态", formatC1RuntimeStatus(row.runtimeStatus)], ["名称", asText(row.name)], ["规格", formatC1DeviceTier(row.productTier)],
    ["设定日收益 USDT", amountText(row.dailyUsdt)], ["设定日收益 UVT", amountText(row.dailyNex, "UVT")],
  ] },
  earning: { title: "收益明细", sub: (row) => mono(row.bizNo), facts: (row) => [
    ["金额", amountText(row.amount, row.asset)], ["余额", amountText(row.balanceAfter, row.asset)], ["类型", formatD4Subtype(row.bizType)],
    ["方向", DIRECTION[asText(row.direction, "").toUpperCase()] ?? "—"], ["币种", assetText(row.asset) || "—"], ["时间", fullTime(row.createdAt)],
  ] },
  member: { title: "推荐团队成员", sub: (row) => mono(row.memberNo), facts: (row) => [
    ["昵称", operatorNicknameText(asText(row.nickname))], ["团队等级", asText(row.vRank)], ["相隔邀请次数", asText(row.level)], ["贡献额", amountText(row.volume)], ["加入时间", fullTime(row.createdAt)],
  ] },
  engagement: { title: "互动与参与", sub: (row) => asText(row.name), facts: (row) => [
    ["状态", asText(row.status)], ["进度", asText(row.progress)], ["更新时间", fullTime(row.updatedAt)],
  ] },
  exchange: { title: "兑换记录", sub: (row) => mono(row.bizNo), facts: (row) => [
    ["金额", amountText(row.amount, row.asset)], ["类型", formatD4Subtype(row.bizType)], ["方向", DIRECTION[asText(row.direction, "").toUpperCase()] ?? "—"], ["币种", assetText(row.asset) || "—"], ["时间", fullTime(row.createdAt)],
  ] },
  notification: { title: "通知", sub: (row) => asText(row.notificationId), facts: (row) => [
    ["标题", nexGridBrandText(asText(row.title))], ["类型", formatC1NotificationType(row.type)], ["推送", pushText(row)], ["已读", formatC1ReadFlag(row.readFlag)], ["创建时间", fullTime(row.createdAt)],
  ] },
  order: { title: "商城订单", sub: (row) => mono(row.orderNo), facts: (row) => [
    ["金额", amountText(row.amount)], ["状态", orderStatus(row)], ["商品", asText(row.skuName)], ["机房", datacenterNameText(asText(row.dcLocation))], ["下单时间", fullTime(row.orderedAt)],
  ] },
};

/** 只使用这条记录已有的状态给出下一步，不推断未知字段。颜色跟这句话说的事走（VS-107）。 */
function recordConclusion(kind: RecordKind, row: JsonRecord): { tone: StateTone; text: string } | undefined {
  if (kind === "payment") return row.status !== "BOUND" && row.pspRevokeStatus && !/^(revoked|confirmed|success|succeeded|done|completed)$/i.test(String(row.pspRevokeStatus))
    ? { tone: "warn", text: "账户已解绑，支付商撤销尚未完成，仍需核对扣款风险。" }
    : row.trialGuard ? { tone: "neutral", text: "这张卡有历史试用关联记录，暂时不能解绑。" }
    : row.status === "BOUND" ? { tone: "neutral", text: "这张卡仍绑定在账户上，可在支付方式列表办理解绑。" } : { tone: "neutral", text: "账户已解绑；支付商的撤销结果请看下方。" };
  if (kind === "withdrawal") return withdrawalTone(row) === "danger" ? { tone: "danger", text: "这笔提现被拒绝或有异常，请到提现审核核对原因。" }
    : withdrawalTone(row) === "warn" ? { tone: "warn", text: "这笔提现等待审核或复查，请到提现审核处理。" }
    : withdrawalTone(row) === "ok" ? { tone: "ok", text: "这笔提现已到账，无需重复放行。" }
    : withdrawalTone(row) === "progress" ? { tone: "progress", text: "这笔提现正在处理中，请到提现审核跟进原单。" } : undefined;
  if (kind === "device") return deviceAbnormal(row) ? { tone: "danger", text: "这台设备有异常，请到设备运行管理核对。" }
    : FINAL_DEVICE_STATUS.includes(String(row.status).toUpperCase()) ? { tone: "neutral", text: "这台设备已回收或停用，不能再回收或记录置换。" } : undefined;
  if (kind === "order") return orderTone(row) === "danger" ? { tone: "danger", text: "这笔订单付款、开通或拒付有异常，请到订单进度核对。" }
    : orderTone(row) === "ok" ? { tone: "ok", text: "这笔订单已开通，无需重复开通。" } : undefined;
  if (kind === "deposit" || kind === "topup") return depositTone(row) === "danger" ? { tone: "danger", text: "这笔充值没有到账或有异常，请到充值与收款对账核对。" }
    : depositTone(row) === "progress" ? { tone: "progress", text: "这笔充值还在等待确认，还没有到账。" }
    : row.confirmedAt ? { tone: "ok", text: "这笔充值已有确认记录；需要查账时按充值单号核对。" } : undefined;
  if (kind === "session") return row.status === "REVOKED" || row.status === "EXPIRED" ? { tone: "neutral", text: "这次登录已失效，无需再次撤销。" } : undefined;
  if (kind === "notification") return row.readFlag === true || row.readFlag === 1 ? { tone: "neutral", text: "这条通知已读；时间有疑问时可查看时间证据。" } : row.readFlag === false || row.readFlag === 0 ? { tone: "neutral", text: "这条通知尚未读，不能据此判断推送失败。" } : undefined;
}

function RecordTable({ label, rows, columns, empty = "暂无记录", selected, onOpen }: {
  label: string;
  rows: JsonRecord[];
  columns: readonly Column[];
  empty?: string;
  selected?: number;
  onOpen: (index: number) => void;
}) {
  if (rows.length === 0) return <p className="rd-detail-empty">{empty}</p>;
  return (
    <Table label={label}>
      <thead><tr>{columns.map((column) => <Th key={column.label} align={column.align} sticky={column.end ? "end" : undefined}>{column.label}</Th>)}</tr></thead>
      <tbody>
        {rows.map((row, index) => (
          <Tr key={`${asText(row.id ?? row.bizNo ?? row.orderNo ?? row.depositNo ?? row.withdrawalNo ?? row.instanceNo, "row")}-${index}`} selected={selected === index} onOpen={() => onOpen(index)}>
            {columns.map((column) => <Td key={column.label} align={column.align} sticky={column.end ? "end" : undefined}>{column.cell(row)}</Td>)}
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

/** 折叠组里的一小块：缺的不显示，读取失败只替换这一块（C1-V02、C1-S04）。同组块头一个样子，都是收起的一行（重复）；里面有事时摘要写清是哪件事（DP-04）。 */
function Block({ id, title, sub, explain, section, actions, failure, issue, issueTone = "warn", summary, disclosure, children }: {
  id?: string;
  title: string;
  sub?: ReactNode;
  explain?: ReactNode;
  section: User360Section | null | undefined;
  actions?: ReactNode;
  /** 这块单独读取、读失败有自己的原因时传，不走整页刷新。 */
  failure?: ReactNode;
  /** 这块里有要处理的事：写进摘要并上色，不用点开才知道（DP-04）。 */
  issue?: string;
  issueTone?: StateTone;
  /** 不是列表的小块：摘要写结论，自己管开合。 */
  summary?: ReactNode;
  disclosure?: { open: boolean; onOpenChange: (open: boolean) => void; summary: ReactNode };
  children: ReactNode;
}) {
  if (!section) return null;
  const failed = !!failure || sectionFailed(section);
  const body = failure
    ? <BlockState state="error" compact title={failure} />
    : sectionFailed(section)
      ? <BlockState state="error" compact title={`${title}加载失败`} onRetry={() => window.location.reload()} />
      : <div className="rd-detail-block">{children}</div>;
  return (
    <div id={id} className="rd-detail-block">
      <Fold inset title={title} explain={explain} actions={actions} alert={failed || !!issue} alertTone={failed ? "danger" : issueTone} {...disclosure} summary={failed ? "加载失败" : issue ?? sub ?? disclosure?.summary ?? summary}>{body}</Fold>
    </div>
  );
}

/** 按时间取最新的一行，时间读不出的排最后。提现记录后端按风险档先排，第一行不一定是最新的。 */
function latestIndex(rows: readonly JsonRecord[], field: string) {
  let best = -1, bestAt = -Infinity;
  rows.forEach((row, index) => {
    const at = parseBusinessTime(asText(row[field], ""));
    if (best < 0 || at > bestAt) { best = index; bestAt = Number.isFinite(at) ? at : -Infinity; }
  });
  return best;
}

/**
 * 统计格第二行的最近一笔（成熟规范 StatisticCard 的 footer 额外指标）：名称和金额一行，时间和状态一行。
 * 金额点开这一笔的抽屉；没有记录写弱字，读不到写「—」，都不能点。状态都用标签：要人注意的上色，已结束的灰，不像警告。
 * 状态放不下时整个换到时间下面一行，不撑宽统计带（「打款异常，需人工核对」在 1024 会把第四格挤到下一行）。
 */
function Recent({ label, amount, time, status, tone, openLabel, onOpen, note }: {
  label: string;
  amount?: string;
  time?: string;
  status?: ReactNode;
  tone?: StateTone;
  openLabel?: string;
  onOpen?: () => void;
  /** 没有这一笔时整行写什么：「暂无提现」或「—」。 */
  note?: string;
}) {
  if (note !== undefined) return <span className="rd-detail-recent"><span>{label} {note}</span></span>;
  return (
    <span className="rd-detail-recent">
      <span>{label} <button type="button" className="rd-link" aria-label={openLabel} onClick={onOpen}>{amount}</button></span>
      <span><span data-num>{time}</span><StatusTag tone={tone && tone !== "ok" ? tone : "done"}>{status}</StatusTag></span>
    </span>
  );
}

/** 一块里成对的小汇总：名字和数字挨着，不拉到面板右端（VS-49）。 */
function Values({ rows }: { rows: readonly (readonly [ReactNode, ReactNode])[] }) {
  return <dl className="rd-detail-values">{rows.map(([label, value], index) => <div key={index}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export default function UserDetailPage() {
  const session = useAdminAuth((state) => state.session);
  const authEpoch = useAdminAuth((state) => state.authEpoch);
  const pathname = usePathname();
  const supportScope = pathname?.startsWith("/service/customers/") === true;
  const canReadNotificationEvidence = !supportScope && (session?.role === "superadmin"
    || (!!session?.authorities.includes("user_c1hub_read") && !!session?.authorities.includes("platform_a4_read")));
  const [notificationEvidence, setNotificationEvidence] = useState<{ userKey: string; authEpoch: number; id: number } | null>(null);
  const hasC1Write = session?.role === "superadmin" || !!session?.authorities.includes("user_c1hub_write");
  const hasC2Write = session?.role === "superadmin" || !!session?.authorities.includes("user_c2_write");
  const canWriteC1 = !supportScope && hasC1Write;
  const canCorrectNotificationTime = canReadNotificationEvidence && canWriteC1
    && (session?.role === "superadmin" || !!session?.authorities.includes("platform_a4_write"));
  const canWriteC2 = !supportScope && hasC2Write;
  const canReleasePayment = session?.role === "superadmin" || !!session?.authorities.includes("user_c5_payment_password_release");
  const reach = useReach();
  const canReadC2 = reach("/users/actions", "user_c2_read");
  const canReadC3 = reach("/users/assets", "user_c3_read");
  const canReadC5 = reach("/users/security", "user_c5_read");
  const canReadC6 = reach("/users/reg-risk", "user_c6_read");
  const canReadD2 = reach("/finance/withdrawals");
  const canReadD4 = reach("/finance/ledger", "finance_d4_read");
  const canReadK4 = reach("/risk/scoring");
  const canReadA2 = reach("/platform/audit", "platform_a2_read");
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const userKey = params?.id?.trim() ?? "";
  const requestedReturnTo = searchParams?.get("returnTo") ?? "";
  const conversationNo = searchParams?.get("conversationNo")?.trim() ?? "";
  const returnTo = supportScope ? conversationNo ? `/service/sessions?conversationNo=${encodeURIComponent(conversationNo)}` : "/service/overview" : requestedReturnTo.startsWith("/users/search") && !requestedReturnTo.startsWith("//")
    ? requestedReturnTo
    : "/users/search";
  const returnLabel = supportScope ? conversationNo ? "返回原会话" : "返回工作台" : "返回用户列表";
  const pageName = supportScope ? "完整客户档案" : "用户详情";
  // 去处理的页面从这里来，要回到这一页（SPM-03）：带上本页地址，本页的返回地址跟着。
  const selfHref = `${pathname ?? ""}?returnTo=${encodeURIComponent(returnTo)}`;
  const readKey = `${adminShellSessionKey(session, authEpoch)}|${supportScope}|${userKey}`;
  const currentReadKey = useRef(readKey), requestGeneration = useRef(0), loadedKey = useRef("");
  currentReadKey.current = readKey;
  const [detailKey, setDetailKey] = useState("");
  const [detail, setDetail] = useState<User360Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [writeResult, setWriteResult] = useState<{ key: string; text: string; tone: StateTone } | null>(null);
  const writeResultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (writeResult?.key !== readKey) return;
    // 等确认框把焦点还给入口后，再把结果带进视口。
    const timer = window.setTimeout(() => writeResultRef.current?.scrollIntoView({ block: "center" }), 0);
    return () => window.clearTimeout(timer);
  }, [writeResult, readKey]);
  const [denied, setDenied] = useState(false);
  const [readAt, setReadAt] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<UserPaymentMethodPage | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [includeUnbound, setIncludeUnbound] = useState(false);
  const [paymentPage, setPaymentPage] = useState(1);
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionStatusFilter, setSessionStatusFilter] = useState<SessionStatusFilter>("ALL");
  const [earningsPage, setEarningsPage] = useState(1);
  const [earningsPageSize, setEarningsPageSize] = useState(20);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  // 撤销告警按全部支付方式算（含已解绑、含别的页），不跟着列表的筛选和翻页走。
  const [revokeScan, setRevokeScan] = useState<UserPaymentMethod[] | null>(null);
  const [revokeScanFailed, setRevokeScanFailed] = useState(false);
  const [paymentSecurity, setPaymentSecurity] = useState<{ state: PaymentSecurityState; pending: boolean }>({ state: "loading", pending: false });
  // 最近一笔充值要含待确认和失败的，360 的充值记录只列已入账的，所以按用户号另读 D1 充值流水第一条（后端按发起时间倒序）。
  // 客服入口不读财务接口（读取范围分开），和没有 finance_d1_read 的账号一样，只看已入账的那些。
  const canReadTopups = !supportScope && (session?.role === "superadmin" || !!session?.authorities.includes("finance_d1_read"));
  const [latestTopup, setLatestTopup] = useState<{ key: string; row?: JsonRecord; failed?: boolean } | null>(null);
  const [openFolds, setOpenFolds] = useState<Record<string, boolean>>({});
  const [openRecordList, setOpenRecordList] = useState<RecordKind | "audit" | null>();
  const [record, setRecord] = useState<{ kind: RecordKind; index: number } | null>(null);
  const [pendingCommands, setPendingCommands] = useState<C1Command[]>([]);
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({});
  const [corrections, setCorrections] = useState<PendingCorrection[]>([]);
  const [releasing, setReleasing] = useState<C1Command | null>(null);
  const [actionConfirm, setActionConfirm] = useState<null | {
    briefKind: OperatorBriefKind;
    action: string;
    /** 框上的短标题，对象写在 facts 里；action 照旧记进操作记录（VS-101）。 */
    title: string;
    detail: string;
    amplifies?: boolean;
    facts: ReactNode;
    confirmLabel: string;
    confirmTone?: "danger";
    /** 提交后这里收不回来：标题下再加「不能撤销」（VS-106）。 */
    irreversible?: boolean;
    statedBrief: { impact: string; check: string };
    run: (reason: string) => Promise<void>;
  }>(null);

  const onPaymentSecurity = useCallback((state: PaymentSecurityState, pending: boolean) => setPaymentSecurity({ state, pending }), []);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (currentReadKey.current !== readKey) return;
    const generation = ++requestGeneration.current;
    const active = () => generation === requestGeneration.current && currentReadKey.current === readKey && !signal?.aborted;
    setLoading(true);
    setError(null);
    setDenied(false);
    setActionConfirm(null); setNotificationEvidence(null); setRecord(null);
    // 换用户、换账号时先清旧资料（C1-H02）。同一个用户刷新时旧资料留在屏幕上，写入口禁用，读失败再清。
    if (loadedKey.current !== readKey) { setDetail(null); setPaymentMethods(null); setRevokeScan(null); setRevokeScanFailed(false); setOpenFolds({}); setOpenRecordList(undefined); }
    setDetailKey(readKey);
    if (!userKey) {
      setDetail(null);
      setError("用户标识缺失，已停止加载");
      setLoading(false);
      return false;
    }
    try {
      const next = supportScope ? await fetchSupportCustomerFullProfile(userKey, signal) : await fetchUser360(userKey);
      if (active()) {
        loadedKey.current = readKey;
        setDetail(next);
        setReadAt(businessClock(Date.now()));
        setReloadTick((tick) => tick + 1);
        return true;
      }
    } catch (err) {
      if (active()) {
        loadedKey.current = "";
        setDetail(null);
        setPaymentMethods(null);
        setDenied(err instanceof UsersRequestError && err.status === 403);
        setError(displayAdminError(err));
      }
    } finally {
      if (active()) setLoading(false);
    }
    return false;
  }, [userKey, supportScope, readKey]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => { controller.abort(); requestGeneration.current++; };
  }, [load]);

  useEffect(() => {
    if (!supportScope) return;
    const revoke = (event: Event) => {
      const detail = (event as CustomEvent<{ customerId?: string; conversationNo?: string }>).detail ?? {};
      if (detail.customerId && detail.customerId !== userKey || !detail.customerId && detail.conversationNo && detail.conversationNo !== conversationNo) return;
      requestGeneration.current++; loadedKey.current = ""; setDetail(null); setPaymentMethods(null); setLoading(false);
      setError("客户资料加载失败，请重试或返回列表。");
    };
    window.addEventListener("support-scope-invalidated", revoke);
    return () => window.removeEventListener("support-scope-invalidated", revoke);
  }, [supportScope, userKey, conversationNo]);

  const profile: User360Profile | null = detail?.profile ?? null;
  const summary: User360Summary = detail?.summary ?? {};
  const userId = profile?.id ?? summary.userId;
  const c3UserId = typeof userId === "string" || (typeof userId === "number" && Number.isSafeInteger(userId)) ? String(userId) : "";
  const userNo = asText(profile?.userNo ?? summary.userNo);
  const nickname = asText(profile?.nickname, "用户详情");
  const displayNickname = userNicknameText(nickname, profile?.phoneMasked);
  const paymentSecurityPort = useMemo(() => {
    if (detailKey !== readKey || !detail || !c3UserId) return null;
    return supportScope ? paymentSecurityPorts.support(c3UserId) : paymentSecurityPorts.global(c3UserId);
  }, [detailKey, readKey, detail, c3UserId, supportScope]);
  const status = asText(profile?.status ?? summary.status, "UNKNOWN").toUpperCase();
  const riskAuthorityReady = detail?.risk?.sourceStatus === "READY";
  const rawRiskScore = riskAuthorityReady ? detail?.risk?.effectiveScore : null;
  const hasRiskScore = rawRiskScore !== null && rawRiskScore !== undefined && rawRiskScore !== "";
  const riskScore = asNumber(rawRiskScore);
  const riskBand = riskAuthorityReady
    ? asText(detail?.risk?.bandLabel, hasRiskScore ? (riskScore >= 70 ? "高风险" : riskScore >= 40 ? "中风险" : "低风险") : "暂无风险分")
    : "暂无风险分";
  // 风险档以后端的档为准，档位线可配置，前端不用分数重算。
  const riskTone = riskBand.includes("高") ? "danger" as const : riskBand.includes("中") ? "warn" as const : riskBand.includes("低") ? "ok" as const : "done" as const;
  const nonActive = status !== "ACTIVE" && status !== "UNKNOWN";
  const adminKey = String(session?.adminId ?? "");

  const syncPending = useCallback(() => {
    // 换人时这张表整张清掉（claimPendingCommandOwner），留下的旧记录就是当前账号的。
    const live = c3UserId ? c1UserCommands.list().map(c1Command).filter((command) => command.userId === c3UserId && (command.legacy || command.adminKey === adminKey)) : [];
    setPendingCommands(live);
    setCorrections(adminKey ? pendingCorrections(adminKey, [userKey, c3UserId, profile?.userNo ?? ""]) : []);
  }, [c3UserId, adminKey, userKey, profile?.userNo]);
  useEffect(() => { syncPending(); }, [syncPending]);

  const loadPaymentMethods = useCallback(async () => {
    if (supportScope || !userId) return;
    setPaymentLoading(true);
    const scan = async () => {
      const all: UserPaymentMethod[] = [];
      for (let page = 1; ; page += 1) {
        const next = await fetchUserPaymentMethods(userId, true, page, 50);
        all.push(...next.items);
        if (next.items.length === 0 || all.length >= next.total) return all;
      }
    };
    const [listed, scanned] = await Promise.allSettled([fetchUserPaymentMethods(userId, includeUnbound, paymentPage, 10), scan()]);
    if (listed.status === "fulfilled") { setPaymentMethods(listed.value); setPaymentError(null); } else setPaymentError(displayAdminError(listed.reason));
    setRevokeScan(scanned.status === "fulfilled" ? scanned.value : null);
    setRevokeScanFailed(scanned.status === "rejected");
    setPaymentLoading(false);
  }, [includeUnbound, paymentPage, userId, supportScope]);

  useEffect(() => { void loadPaymentMethods(); }, [loadPaymentMethods, reloadTick]);
  useEffect(() => { setPaymentPage(1); }, [userId]);
  const readsTopups = canReadTopups && !!detail?.deposits && /^[1-9]\d*$/.test(c3UserId);
  useEffect(() => {
    if (!readsTopups) return;
    let live = true;
    fetchD1TopupFlows({ userId: Number(c3UserId), pageNum: 1, pageSize: 1 }).then(
      (page) => { if (live) setLatestTopup({ key: readKey, row: page.records[0] && { ...page.records[0] } }); },
      () => { if (live) setLatestTopup({ key: readKey, failed: true }); },
    );
    return () => { live = false; };
  }, [readsTopups, c3UserId, readKey, reloadTick]);

  const sessions = useMemo(() => asArray(detail?.sessions), [detail?.sessions]);
  // 后端下发最近最多 50 条会话样本（含 REVOKED）。默认只渲染最近一页，筛选或换用户回第 1 页。
  const filteredSessions = useMemo(() => {
    if (sessionStatusFilter === "ALL") return sessions;
    return sessions.filter((row) => asText(row.status, "").toUpperCase() === sessionStatusFilter);
  }, [sessionStatusFilter, sessions]);
  const sessionPageCount = Math.max(1, Math.ceil(filteredSessions.length / C1_SESSION_PAGE_SIZE));
  const visibleSessions = useMemo(
    () => filteredSessions.slice((sessionPage - 1) * C1_SESSION_PAGE_SIZE, sessionPage * C1_SESSION_PAGE_SIZE),
    [filteredSessions, sessionPage],
  );
  useEffect(() => { setSessionPage(1); }, [sessionStatusFilter, userKey]);
  const earningsRecords = useMemo(() => asArray(detail?.earnings?.records), [detail?.earnings?.records]);
  const visibleEarnings = useMemo(() => earningsRecords.slice((earningsPage - 1) * earningsPageSize, earningsPage * earningsPageSize), [earningsRecords, earningsPage, earningsPageSize]);
  useEffect(() => { setEarningsPage(1); }, [userKey]);
  const auditEntries = useMemo(() => toAuditEntries(detail?.audit), [detail?.audit]);
  const methods = useMemo(() => paymentMethods?.items ?? [], [paymentMethods]);
  const unfinishedRevokes = useMemo(() => (revokeScan ?? []).filter(revokeUnfinished), [revokeScan]);
  const devices = useMemo(() => asArray(detail?.devices?.records), [detail?.devices?.records]);
  const deposits = useMemo(() => asArray(detail?.deposits?.records), [detail?.deposits?.records]);
  const withdrawals = useMemo(() => asArray(detail?.withdrawals?.records), [detail?.withdrawals?.records]);
  const members = useMemo(() => asArray(detail?.referral?.members), [detail?.referral?.members]);
  const engagement = useMemo(() => asArray(detail?.engagement?.records), [detail?.engagement?.records]);
  const exchanges = useMemo(() => asArray(detail?.financial?.exchangeRows), [detail?.financial?.exchangeRows]);
  const notifications = useMemo(() => asArray(detail?.notifications?.records), [detail?.notifications?.records]);
  const orders = useMemo(() => asArray(detail?.commerce?.orders), [detail?.commerce?.orders]);
  const topup = latestTopup?.key === readKey ? latestTopup : null;
  // 能读 D1 时用那一笔，各种状态都有；不能读时退回这页列出的已入账充值，按确认时间取最新的。
  const latestDeposit = readsTopups ? topup?.row : deposits[latestIndex(deposits, "confirmedAt")];
  const latestDepositListed = latestDeposit ? deposits.findIndex((row) => row.depositNo === latestDeposit.depositNo) : -1;
  const latestWithdrawal = latestIndex(withdrawals, "createdAt");
  const recordRows: Record<RecordKind, JsonRecord[]> = {
    session: visibleSessions, payment: methods, deposit: deposits, topup: latestDeposit && latestDepositListed < 0 ? [latestDeposit] : [], withdrawal: withdrawals, device: devices, earning: visibleEarnings,
    member: members, engagement, exchange: exchanges, notification: notifications, order: orders,
  };

  /** 结果未知时转成页面上方的待确认条，这个对象在确认前不能再操作（OP-93）。做法同提现审核的 sendCommand。 */
  const execute = async (command: C1CommandInput) => {
    const slot = commandSlot(command);
    const retained = c1UserCommands.get(slot);
    const commandKey = retained ?? `${COMMAND_PREFIX[command.kind]}-${crypto.randomUUID()}`;
    c1UserCommands.remember(slot, commandKey, { ...command, retryRejected: false });
    if (!c1UserCommands.isDurablyStored(slot, commandKey)) {
      if (!retained) c1UserCommands.forget(slot, commandKey);
      throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
    setActionPending(command.label);
    try {
      let nextNickname = "";
      try {
        if (command.kind === "nickname") nextNickname = (await resetUserNickname(command.userId, command.nickname ?? "", command.reason, command.operator, commandKey)).nickname;
        if (command.kind === "unbind") await unbindUserPaymentMethod(command.userId, command.methodId ?? 0, command.version ?? 0, command.reason, command.operator, commandKey);
        if (command.kind === "rebind") await notifyUserPaymentMethodRebind(command.userId, command.methodId ?? 0, command.version ?? 0, command.reason, command.operator, commandKey);
        if (command.kind === "replace" || command.kind === "recycle") await executeUserDeviceTradein(command.userId, command.deviceId ?? 0, command.kind, command.reason, command.operator, commandKey);
      } catch (cause) {
        const unknown = outcomeUnknown(cause);
        // 新号被明确拒绝才丢号。结果未知必须保号；重试的是原命令时，明确失败也证明不了原命令的结果，继续保留。
        if (!unknown && !retained) c1UserCommands.forget(slot);
        syncPending();
        if (unknown) {
          toast.warn("结果未确认，不要重复操作", "到页面上方读回核对或按原操作重试。");
          return;
        }
        if (isPermissionDenied(cause)) throw cause;
        throw new Error(`${COMMAND_FAILURE[command.kind]}：${displayAdminError(cause)}`);
      }
      c1UserCommands.forget(slot);
      syncPending();
      const text = command.kind === "nickname" ? `昵称已重置为 ${userNicknameText(nextNickname, profile?.phoneMasked)}`
        : command.kind === "unbind" ? "支付方式已从 UVEL 账户解绑"
        : command.kind === "rebind" ? "换绑通知已进入推送队列"
        : command.kind === "replace" ? "回收并记录置换已执行" : "设备回收已执行";
      setWriteResult({ key: readKey, text, tone: "ok" });
      if (command.kind === "unbind") {
        if (!includeUnbound) { setIncludeUnbound(true); setPaymentPage(1); } else await loadPaymentMethods();
      } else if (command.kind === "rebind") await loadPaymentMethods();
      else if (!await load() && currentReadKey.current === readKey) setWriteResult({ key: readKey, text: `${text}。资料刷新失败，请点「刷新」核对。`, tone: "warn" });
    } finally {
      setActionPending(null);
    }
  };

  /** 按原操作重试：同命令号、同内容、同理由，不接受新输入（OP-94）。只有成功才解除待确认。过期和查不到都不解除（OP-96、OP-153）。 */
  const retryPending = async (command: C1Command) => {
    if (command.expiresAt <= Date.now()) return;
    if (!c1UserCommands.isDurablyStored(command.fingerprint, command.commandKey)) {
      setPendingNotes((current) => ({ ...current, [command.fingerprint]: "本机存储里查不到原操作，这次没有发送。到操作记录与审批核对，待确认继续保留。" }));
      return;
    }
    try {
      await execute(command);
    } catch (cause) {
      setPendingNotes((current) => ({ ...current, [command.fingerprint]: `重试没有成功：${cause instanceof Error ? cause.message : "原因未知"} 这说明不了原操作的结果，原命令继续保留。` }));
      c1UserCommands.remember(command.fingerprint, command.commandKey, { ...command, retryRejected: true });
      syncPending();
    }
  };

  /** 重试被拒后，人核实过原操作的结果才解除。只放开这个对象的本地锁，不发请求，后端仍按现在的状态校验。 */
  const releasePending = (command: C1Command) => {
    c1UserCommands.forget(command.fingerprint, command.commandKey);
    syncPending();
    setReleasing(null);
    toast.success("已移除本地待确认记录，后端结果和锁定状态不变");
  };

  /** 读回只给现在的事实，变了也可能是别人改的，不能当成原命令的回执，待确认保留（OP-93、OP-95）。 */
  const verifyPending = async (command: C1Command) => {
    await load();
    setPendingNotes((current) => ({ ...current, [command.fingerprint]: "已重新读取这页，核对上面的内容。现在的状态可能是别人改的，待确认继续保留。" }));
  };

  const busyReason = loading ? "正在重新读取，读完再操作" : actionPending ? `正在执行：${actionPending}` : undefined;
  const nicknameBlock = pendingCommands.some((command) => command.kind === "nickname") ? "重置昵称的结果未确认，先到页面上方核对" : busyReason;
  const methodBlock = (method: UserPaymentMethod) => pendingCommands.some((command) => command.methodId === method.id)
    ? "这张卡有结果未确认的操作，先到页面上方核对"
    : paymentLoading ? "正在读取支付方式，读完再操作" : busyReason;
  const deviceBlock = (deviceId: number) => pendingCommands.some((command) => command.deviceId === deviceId) ? "这台设备有结果未确认的操作，先到页面上方核对" : busyReason;

  const openNicknameReset = () => setActionConfirm({ briefKind: "record",
    action: `重置昵称 · ${displayNickname}`,
    title: "重置昵称",
    detail: "系统会生成一个不含手机号等个人信息的新昵称，替换当前昵称。",
    amplifies: false,
    facts: <Facts><Fact k="操作对象">{displayNickname} · {userNo}</Fact><Fact k="昵称"><Change from={displayNickname} to="系统生成的新昵称，提交后才知道" /></Fact></Facts>,
    confirmLabel: "确认重置，立即生效",
    statedBrief: { impact: "立即替换这个用户的昵称，结果会记录在操作记录中。", check: "核对操作对象，理由写清依据或工单号。" },
    run: (reason) => execute({ kind: "nickname", label: `重置昵称 · ${displayNickname}`, adminKey, userId: c3UserId, reason, operator: currentAdminOperator(), nickname }),
  });
  const openUnbind = (method: UserPaymentMethod) => setActionConfirm({ briefKind: "record",
    action: `解绑支付方式 · 尾号 ${method.last4}`,
    title: "解绑支付方式",
    detail: "解绑后立即停止作为默认支付方式；若它是默认卡，服务器会选取其他已绑定方式作为默认。",
    amplifies: false,
    facts: <Facts><Fact k="操作对象">{displayNickname} · {userNo}</Fact><Fact k="支付方式">{method.brand} ···· {method.last4} · {method.provider}</Fact><Fact k="默认卡">{method.isDefault ? "是，服务器会选取其他已绑定方式作为默认" : "否"}</Fact></Facts>,
    confirmLabel: "确认解绑，立即生效",
    confirmTone: "danger",
    irreversible: true,
    statedBrief: { impact: "立即解绑，这张卡要用户自己重新绑定。支付商那边的撤销另外处理，完成前这张卡仍可能被扣款。", check: "核对卡的尾号和用户，理由写清依据或工单号。" },
    run: (reason) => execute({ kind: "unbind", label: `解绑支付方式 · 尾号 ${method.last4}`, adminKey, userId: c3UserId, reason, operator: currentAdminOperator(), methodId: method.id, version: method.version }),
  });
  const openDeviceAction = (device: JsonRecord, operation: "replace" | "recycle") => {
    const deviceId = asNumber(device.id);
    const instance = asText(device.instanceNo);
    setActionConfirm({ briefKind: "record",
      action: operation === "replace" ? `回收并记录置换 · ${asText(device.instanceNo)}` : `设备回收 · ${asText(device.instanceNo)}`,
      title: operation === "replace" ? "回收并记录置换" : "设备回收",
      detail: operation === "replace"
        ? "这台设备回收并离线，同时记一张已完成的置换单。不发新设备，不退钱，也不给用户发通知。"
        : "这台设备回收并离线，不留置换单。不退钱，也不给用户发通知。",
      amplifies: false,
      facts: <Facts>
        <Fact k="操作对象">{displayNickname} · {userNo}</Fact>
        <Fact k="设备">{instance} · {asText(device.name)}</Fact>
        <Fact k="状态"><Change from={formatC1DeviceStatus(device.status)} to="已回收，离线" /></Fact>
        {operation === "replace" && <Fact k="置换单">新增一张已完成的，只作记录</Fact>}
        <Fact k="收益">不再派新任务，已到账的收益不扣回</Fact>
        <Fact k="资金和新设备">不退款，不发新设备</Fact>
        <Fact k="用户通知">不发通知</Fact>
      </Facts>,
      confirmLabel: operation === "replace" ? "确认回收并记录置换，立即生效" : "确认回收，立即生效",
      confirmTone: "danger",
      irreversible: true,
      statedBrief: { impact: operation === "replace" ? "和设备回收的差别只有一点：多记一张已完成的置换单，留下这次置换的记录。设备有任务在跑时系统会拒绝。" : "和回收并记录置换的差别只有一点：不留置换单。设备有任务在跑时系统会拒绝。", check: "核对设备实例号和用户，理由写清依据或工单号。" },
      run: (reason) => execute({ kind: operation, label: `${operation === "replace" ? "回收并记录置换" : "设备回收"} · ${instance}`, adminKey, userId: c3UserId, reason, operator: currentAdminOperator(), deviceId, deviceStatus: asText(device.status) }),
    });
  };

  const showFold = (group: string) => setOpenFolds((current) => ({ ...current, [group]: true }));
  const locate = useCallback((group: string, anchor?: string) => {
    setOpenFolds((current) => ({ ...current, [group]: true }));
    const list = ({ "hub-payment-methods": "payment", "hub-deposit": "deposit", "hub-withdrawal": "withdrawal", "hub-devices": "device", "hub-referral": "member", "hub-engagement": "engagement", "hub-orders": "order" } as Partial<Record<string, RecordKind>>)[anchor ?? ""];
    if (list) setOpenRecordList(list);
    window.requestAnimationFrame(() => document.getElementById(anchor ?? `section-${group}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);

  // 从客服和工单带锚点进来时先展开所在的组，再定位（C1-L07）。等支付方式读完，不然上面的内容撑开会把目标顶走。
  const layoutReady = !!detail && (supportScope || !!paymentMethods || !!paymentError);
  const ledgerUnread = !!detail?.financial && !Array.isArray((detail.ledger as JsonRecord | null | undefined)?.rows);
  const withdrawalExceptions = withdrawals.filter((row) => withdrawalTone(row) === "danger").length;
  const withdrawalsWaiting = withdrawals.filter((row) => withdrawalTone(row) === "warn").length;
  const orderExceptions = orders.filter((row) => orderTone(row) === "danger").length;
  const deviceExceptions = devices.filter(deviceAbnormal).length;
  const hashDone = useRef("");
  useEffect(() => {
    if (!detail) return;
    const hash = window.location.hash.slice(1);
    const group = ({ "hub-payment-methods": "security", "hub-deposit": "funds", "hub-withdrawal": "funds", "hub-devices": "devices", "hub-referral": "team", "hub-engagement": "team" } as Record<string, string>)[hash];
    if (!group || !layoutReady || hashDone.current === `${readKey}#${hash}`) return;
    hashDone.current = `${readKey}#${hash}`;
    locate(group, hash);
  }, [detail, layoutReady, readKey, locate]);

  const securityPresent = !!detail?.sessions || !!paymentSecurityPort || !supportScope;
  const fundsPresent = !!(detail?.deposits || detail?.withdrawals || detail?.account || detail?.financial);
  const devicesPresent = !!(detail?.devices || detail?.earnings);
  const teamPresent = !!(detail?.referral || detail?.engagement || detail?.vrank);
  const recordsPresent = !!(detail?.notifications || detail?.commerce || detail?.audit);
  const failedSection = (...sections: (User360Section | null | undefined)[]) => sections.some(sectionFailed);
  // 能看登录安全的角色 sessions 总在，这时 security 是空就是这一项读失败了，后端把它写成 false，不能当没问题（DP-65）。
  const securityUnread = !!detail?.sessions && detail.security == null;
  const securityAlert = paymentSecurity.state === "exception" || paymentSecurity.pending || summary.locked === true || unfinishedRevokes.length > 0;
  const securityFailed = paymentSecurity.state === "failed" || !!paymentError || revokeScanFailed || securityUnread;
  const fundsFailed = failedSection(detail?.deposits, detail?.withdrawals, detail?.financial, detail?.account) || ledgerUnread;
  const fundsAlert = withdrawalExceptions + withdrawalsWaiting > 0;
  const devicesFailed = failedSection(detail?.devices, detail?.earnings) || ledgerUnread && !!detail?.earnings;
  const devicesAlert = deviceExceptions > 0;
  const teamFailed = failedSection(detail?.referral, detail?.engagement, detail?.vrank);
  const recordsFailed = failedSection(detail?.notifications, detail?.commerce);
  const failedPushCount = asNumber(detail?.notifications?.failedPushCount);
  const recordsAlert = failedPushCount > 0 || orderExceptions > 0 || corrections.length > 0;
  // 「有异常」只给真出事的：待审核写数量，加载失败写加载失败，都不是异常（DP-04）。异常的数量写在名字后面，读成「资金 2 笔 有异常」。
  const securityIssues = [summary.locked === true, paymentSecurity.state === "exception", unfinishedRevokes.length > 0].filter(Boolean).length;
  const navItem = (id: string, name: string, failed: boolean, count: string, waiting = ""): SectionNavItem => failed
    ? { id, label: `${name} · 加载失败` }
    : count ? { id, label: `${name} ${count}`, alert: true } : { id, label: waiting ? `${name} · ${waiting}` : name };
  const sections: SectionNavItem[] = [
    securityPresent && navItem("security", "安全", securityFailed, securityIssues > 0 ? `${securityIssues} 项` : "", paymentSecurity.pending ? "解除结果待确认" : ""),
    fundsPresent && navItem("funds", "资金", fundsFailed, withdrawalExceptions > 0 ? `${withdrawalExceptions} 笔` : "", withdrawalsWaiting > 0 ? `${withdrawalsWaiting} 笔待处理` : ""),
    devicesPresent && navItem("devices", "设备与收益", devicesFailed, deviceExceptions > 0 ? `${deviceExceptions} 台` : ""),
    teamPresent && navItem("team", "团队与互动", teamFailed, ""),
    recordsPresent && navItem("records", "记录", recordsFailed, failedPushCount + orderExceptions > 0 ? `${failedPushCount + orderExceptions} 条` : "", corrections.length > 0 ? "校正结果待确认" : ""),
  ].filter((item) => item !== false);
  const nav = useSectionNav(sections, { ready: layoutReady, onReveal: showFold });
  const foldProps = (group: string, alert: boolean) => ({
    alert,
    open: openFolds[group] ?? alert,
    onOpenChange: (next: boolean) => setOpenFolds((current) => ({ ...current, [group]: next })),
  });
  // 多个分区可以同时露出异常摘要，记录表只展开一张（DP-67）。
  const visibleRecordList = openRecordList === undefined
    ? unfinishedRevokes.length > 0 ? "payment" : fundsAlert ? "withdrawal" : devicesAlert ? "device" : orderExceptions > 0 ? "order" : failedPushCount > 0 ? "notification" : null
    : openRecordList;
  const listProps = (kind: RecordKind) => ({ disclosure: {
    open: visibleRecordList === kind,
    onOpenChange: (next: boolean) => setOpenRecordList((current) => next ? kind : current === kind || current === undefined ? null : current),
    summary: `${recordRows[kind].length} 条记录`,
  } });

  const writeResultNotice = writeResult?.key === readKey && <div ref={writeResultRef}><Notice tone={writeResult.tone}>{writeResult.text}</Notice></div>;
  if (detailKey !== readKey || loading && !detail) {
    return (
      <RdPage>
        <PageHeader title={pageName} back={<Link href={returnTo} prefetch={false}><ArrowLeft size={14} aria-hidden /> {returnLabel}</Link>} />
        <BlockState state="loading" title="正在加载…" />
        {writeResultNotice}
      </RdPage>
    );
  }

  if (error && !detail) {
    return (
      <RdPage>
        <PageHeader title={pageName} back={<Link href={returnTo} prefetch={false}><ArrowLeft size={14} aria-hidden /> {returnLabel}</Link>} />
        {writeResultNotice}
        {denied
          ? <BlockState state="denied" title="无权限访问" detail={error} />
          : <BlockState state="error" title={`${supportScope ? "客户资料" : "用户详情"}加载失败：${error}`} onRetry={() => void load()} />}
      </RdPage>
    );
  }

  if (!profile || !detail) {
    return (
      <RdPage>
        <PageHeader title={pageName} back={<Link href={returnTo} prefetch={false}><ArrowLeft size={14} aria-hidden /> {returnLabel}</Link>} />
        <BlockState state="error" title="客户资料加载失败，请重新加载。" onRetry={() => void load()} />
      </RdPage>
    );
  }

  /** 汇总是后端能核对到的小计，不保证覆盖全部历史（后端 fieldStatuses 写 PARTIAL）。第二行放最近一笔，「已核对小计」收进问号。 */
  const usdtTotals = asArray(detail.financial?.byCurrency).find((row) => row.currency === "USDT")?.fieldStatuses as JsonRecord | undefined;
  const subtotal = (field: string) => usdtTotals?.[field] === "PARTIAL" && <p>这次后端标明只核对到一部分，是已核对小计。</p>;
  // 最近一笔写在累计数第二行，一眼对上是哪个数的（产品 2026-11-07）。
  const depositRecent = <Recent label={readsTopups ? "最近一笔" : "最近一笔到账"} openLabel="查看最近一笔充值"
    note={readsTopups ? !topup ? "读取中…" : topup.failed ? "—" : latestDeposit ? undefined : "暂无链上充值" : sectionFailed(detail.deposits) ? "—" : latestDeposit ? undefined : "暂无到账的链上充值"}
    amount={amountText(latestDeposit?.amount, latestDeposit?.asset)} time={shortTime(readsTopups ? latestDeposit?.createdAt : latestDeposit?.confirmedAt)}
    status={asText(latestDeposit?.statusLabel)} tone={latestDeposit && depositTone(latestDeposit)}
    onOpen={() => setRecord(latestDepositListed >= 0 ? { kind: "deposit", index: latestDepositListed } : { kind: "topup", index: 0 })} />;
  const withdrawalRow = withdrawals[latestWithdrawal];
  const withdrawalsTotal = asNumber(detail.withdrawals?.total, withdrawals.length);
  const withdrawalRecent = <Recent label="最近一笔" openLabel="查看最近一笔提现" note={sectionFailed(detail.withdrawals) ? "—" : withdrawalRow ? undefined : "暂无提现"}
    amount={amountText(withdrawalRow?.amount, withdrawalRow?.asset)} time={shortTime(withdrawalRow?.createdAt)} status={withdrawalRow && withdrawalLabel(withdrawalRow)} tone={withdrawalRow && withdrawalTone(withdrawalRow)}
    onOpen={() => setRecord({ kind: "withdrawal", index: latestWithdrawal })} />;
  const kpis = [
    detail.financial && { label: "钱包可用余额", value: amountValue(summary.walletUsdt ?? profile.walletUsdt), unit: "USDT", tone: "role-1" as const, icon: Wallet, group: "funds", anchor: "hub-deposit" },
    detail.deposits && { label: "累计充值", value: amountValue(summary.depositedUsd), unit: "USDT", tone: "role-2" as const, icon: ArrowDownToLine, group: "funds", anchor: "hub-deposit", sub: depositRecent, explain: <>
      <p>能核对到的已确认充值小计，不保证覆盖这个用户的全部历史，也不是下面列出的那些相加。读不到时写「—」，不算 0。</p>{subtotal("creditedDepositTotal")}
      <p>{readsTopups ? "最近一笔：按发起时间取最新的一笔链上充值，待确认和失败的也算；停用前的国际卡充值也在内，银行卡充值不在内。" : "最近一笔到账：只算这页列出的已入账链上充值，按确认时间取最新的；待确认、失败的和银行卡充值都不在内。"}</p>
    </> },
    detail.withdrawals && { label: "累计提现", value: amountValue(summary.withdrawnUsd), unit: "USDT", tone: "role-4" as const, icon: ArrowUpFromLine, group: "funds", anchor: "hub-withdrawal", sub: withdrawalRecent, explain: <>
      <p>能核对到的成功提现本金小计，不保证覆盖这个用户的全部历史，也不是下面列出的那些相加。读不到时写「—」，不算 0。</p>{subtotal("successfulWithdrawalPrincipalTotal")}
      <p>最近一笔：按创建时间取下面提现记录里最新的一笔，各种状态都算。{withdrawalsTotal > withdrawals.length ? `共 ${numberLabel(withdrawalsTotal)} 笔，这里只列了 ${withdrawals.length} 笔，最新的一笔可能不在其中。` : ""}</p>
    </> },
    detail.devices && { label: "设备数", value: numberLabel(summary.deviceCount), unit: "台", tone: "role-2" as const, icon: Cpu, group: "devices", anchor: "hub-devices", explain: "这个用户的全部设备记录，含已回收和已停用的，最多读 200 台。现在还能运行的看下面的活跃数。" },
    detail.referral && { label: "团队规模", value: numberLabel(summary.teamSize), unit: "人", tone: "role-3" as const, icon: UsersRound, group: "team", anchor: "hub-referral" },
  ].filter((value) => !!value).slice(0, 4) as { label: string; value: string; unit: string; tone: "role-1" | "role-2" | "role-3" | "role-4"; icon: typeof Wallet; group: string; anchor: string; explain?: ReactNode; sub?: ReactNode }[];

  const inKpi = (label: string) => kpis.some((kpi) => kpi.label === label);
  const openCases = asNumber(detail.risk?.openCaseCount);
  // 风险档以后端的档为准：客服只拿到档、没有分数，也要算（R04）。
  const riskHigh = riskAuthorityReady && riskTone === "danger";
  // 数字在下面的区块里，这里只写有什么事，不重复（DP-61）。
  // 按钮写会落到哪一块，不写「首项」：排在最前的风险档没有入口时，按钮去的是后面那件（DT-19）。
  const issues: { key: string; text: string; danger?: boolean; go?: () => void; goLabel?: string }[] = [
    summary.locked === true && { key: "locked", text: "账号已锁定", go: () => locate("security"), goLabel: "查看安全信息" },
    paymentSecurity.state === "exception" && { key: "payment", text: "支付密码有异常", go: () => locate("security"), goLabel: "查看安全信息" },
    paymentSecurity.pending && { key: "release", text: "有一笔解除结果等待确认", go: () => locate("security"), goLabel: "查看安全信息" },
    unfinishedRevokes.length > 0 && { key: "revoke", text: "有已解绑的卡仍可能被扣款", danger: true, go: () => locate("security", "hub-payment-methods"), goLabel: "查看支付方式" },
    riskHigh && { key: "risk", text: "风险档是高风险", danger: true },
    openCases > 0 && { key: "cases", text: "有未关闭的风险案件" },
    withdrawalExceptions > 0 && { key: "withdrawal", text: "有提现异常", danger: true, go: () => locate("funds", "hub-withdrawal"), goLabel: "查看提现记录" },
    withdrawalsWaiting > 0 && { key: "waiting", text: "有提现等待处理", go: () => locate("funds", "hub-withdrawal"), goLabel: "查看提现记录" },
    deviceExceptions > 0 && { key: "device", text: "有设备异常", go: () => locate("devices", "hub-devices"), goLabel: "查看设备明细" },
    orderExceptions > 0 && { key: "order", text: "有订单异常", go: () => locate("records", "hub-orders"), goLabel: "查看商城订单" },
    failedPushCount > 0 && { key: "push", text: "有通知推送失败", go: () => locate("records"), goLabel: "查看通知记录" },
  ].filter((value) => !!value).sort((a, b) => Number(!!b.danger) - Number(!!a.danger));
  const unreadable = [
    securityUnread && "账号锁定和两步验证",
    paymentSecurity.state === "failed" && "支付安全",
    paymentError && "支付方式",
    !paymentError && revokeScanFailed && "支付方式的撤销状态",
    ledgerUnread && "账单流水",
    failedSection(detail.deposits, detail.withdrawals, detail.financial, detail.account) && "资金",
    failedSection(detail.devices, detail.earnings) && "设备与收益",
    teamFailed && "团队与互动",
    recordsFailed && "记录",
    detail.financial?.totalsStatus === "ERROR" && "累计金额",
    detail.risk && !riskAuthorityReady && !supportScope && "风险分",
  ].filter((value): value is string => !!value);
  const checked = [
    "账户状态",
    detail.risk && (detail.risk.cases !== undefined ? "风险档和最近 20 条风险案件" : "风险档"),
    detail.sessions && !securityUnread && "账号锁定",
    paymentSecurityPort && "支付安全",
    !supportScope && "全部支付方式的撤销状态",
    detail.withdrawals && "提现记录列出的最多 30 条（风险档高的排在前，同档新的在前，所以不一定是最近 30 条）",
    detail.devices && "设备状态",
    detail.commerce && "最近 50 单订单",
    detail.notifications && "通知推送失败",
  ].filter((value): value is string => !!value);
  const checking = paymentSecurity.state === "loading" || !supportScope && (!paymentMethods && !paymentError || !revokeScan && !revokeScanFailed);
  const firstIssue = issues.find((issue) => issue.go);
  const firstGo = firstIssue?.go;
  const c2Link = canReadC2 && !supportScope
    ? <Link className="rd-btn" data-variant="secondary" data-size="md" href={{ pathname: "/users/actions", query: { userCode: userNo, source: "C1", returnTo: selfHref } }} prefetch={false}><span className="rd-btn-face">去账户操作</span></Link>
    : undefined;
  const k4Link = canReadK4 && !supportScope
    ? <Link className="rd-btn" data-variant="secondary" data-size="md" href={{ pathname: "/risk/scoring", query: { userCode: userNo, returnTo: selfHref } }} prefetch={false}><span className="rd-btn-face">去风险评分规则</span></Link>
    : undefined;
  const unreadText = unreadable.length > 0 ? `${unreadable.join("、")}暂时无法确认` : "";
  const unreadCount = unreadable.length > 0 ? `${unreadable.length} 组资料加载失败` : "";
  // 最重要的两件写出来，其余写数量（DP-10）；危险的排在前面。
  const issueText = [issues.slice(0, 2).map((issue) => issue.text).join("，") + (issues.length > 2 ? `，还有 ${issues.length - 2} 件` : ""), unreadText].filter(Boolean).join("；");
  const scopeNote = `这个账号看不到的区块不在内${detail.risk?.cases !== undefined ? "，风险案件读取失败时后端也返回 0" : ""}`;
  const checkedExplain = <p>核对了：{checked.join("、")}。{scopeNote}。</p>;
  const pendingCount = pendingCommands.length + corrections.length;
  const conclusion = nonActive
    ? <Conclusion state={status === "BANNED" ? "danger" : "warn"} lead icon={ShieldAlert} hint={issueText || undefined} explain={checkedExplain} action={c2Link}>账户状态：{statusLabel(status)}，提现和交易可能受限。</Conclusion>
    : issues.length > 0
      ? <Conclusion state={issues.some((issue) => issue.danger) ? "danger" : "warn"} hint={issueText} explain={checkedExplain} action={firstGo ? <Button onClick={firstGo}>{firstIssue?.goLabel}</Button> :(riskHigh || openCases > 0) ? k4Link : undefined}>有 <b>{issues.length}</b> 件事要处理{unreadCount && `，${unreadCount}`}</Conclusion>
      : status === "UNKNOWN"
        ? <Conclusion state="unknown" hint={unreadText || undefined} explain={checkedExplain}>账户状态未确认，暂时无法判断</Conclusion>
        : unreadable.length > 0
          ? <Conclusion state="unknown" hint={`${unreadText}，这部分没有判断。`} explain={checkedExplain}>账户正常，{unreadCount}</Conclusion>
          : checking
            ? <Conclusion state="unknown">账户正常，正在核对其余项目…</Conclusion>
            // 结果未确认在下面的提示里写一次，这里不写「没发现问题」，也不再说一遍（VS-105）。
            : pendingCount > 0
              ? null
              : <Conclusion state="ok" icon={ShieldCheck} explain={<><p>核对了：{checked.join("、")}。</p><p>这只说明这些项目没发现问题，不代表全部没事：{scopeNote}。</p></>}>账户正常，已核对的项目没发现问题</Conclusion>;

  const hasEntries = !supportScope;
  const inPageWrites = [canWriteC1 && "重置昵称、处理支付方式", canWriteC2 && "回收设备", canReleasePayment && "解除支付密码异常"].filter(Boolean).join("，");
  const crossLinks = [
    canReadC6 && ["注册与登录风险", "/users/reg-risk"],
    canReadD2 && ["提现审核", "/finance/withdrawals"],
    canReadD4 && ["账本与账单核对", "/finance/ledger"],
    canReadK4 && ["风险评分规则", "/risk/scoring"],
    canReadA2 && ["操作记录与审批", "/platform/audit"],
  ].filter((item): item is [string, string] => Array.isArray(item));

  const auditLink = canReadA2 && <> <Link className="rd-link" href={{ pathname: "/platform/audit", query: { userCode: userNo, returnTo: selfHref } }} prefetch={false}>到操作记录与审批核对</Link></>;
  const pendingNotices = pendingCommands.map((command) => {
    const expired = command.expiresAt <= Date.now();
    // 重试和普通入口一样看现在的入口和权限（OP-123）。没权限只留核对，提示和记录都留着。
    const device = command.kind === "replace" || command.kind === "recycle";
    const writable = device ? canWriteC2 : canWriteC1;
    const hasWrite = device ? hasC2Write : hasC1Write;
    const nextStep = expired ? `${EXPIRED_TEXT}。` : command.legacy
      ? "这是升级前发出的操作，没有存下原理由，不能重试，先核对原操作有没有生效。"
      : !writable
        ? hasWrite ? "客服入口不能重试，到用户详情处理。" : "这个账号现在没有这项操作的权限，不能重试，请有权限的同事处理。"
        : "按原操作重试用同一个命令号，不会重复执行。";
    // 能重试时这句只是解释，进问号，提示留一行（DP-06）；不能重试的原因常显。
    const quietStep = !expired && !command.legacy && writable;
    return <Notice key={command.fingerprint} tone="warn" title={`${command.label} · 结果未确认`}
      action={<>
        <Button size="sm" disabled={!!busyReason} onClick={() => void verifyPending(command)}>读回核对</Button>
        {writable && !command.legacy && <Button size="sm" disabledReason={expired ? EXPIRED_TEXT : busyReason} onClick={() => void retryPending(command)}>按原操作重试</Button>}
        {writable && (command.retryRejected || command.legacy) && <Button size="sm" disabled={!!busyReason} onClick={() => setReleasing(command)}>解除待确认</Button>}
      </>}>
      {shortTime(new Date(command.createdAt).toISOString())}（{businessZone().label}）发出，可能已经生效，不要重复操作。{!quietStep && nextStep}
      {supportScope && hasWrite && <> <Link className="rd-link" href={`/users/search/${encodeURIComponent(userNo)}`} prefetch={false}>到用户详情</Link></>}
      {auditLink}
      <Explain label="技术信息" content={<>{quietStep && <p>{nextStep}</p>}<p>{command.legacy ? `命令号 ${command.commandKey} ｜ 升级前的记录，没有存操作人和理由` : `命令号 ${command.commandKey} ｜ 操作人 ${command.operator} ｜ 理由 ${command.reason}`}</p></>} />
      {pendingNotes[command.fingerprint] && <div>{pendingNotes[command.fingerprint]}</div>}
    </Notice>;
  });
  const correctionNotices = corrections.map((command) => {
    const expired = command.expiresAt <= Date.now();
    const id = command.preview.notificationId;
    return <Notice key={command.fingerprint} tone="warn" title={`校正通知 ${id} 的时间 · 结果未确认`}
      action={canReadNotificationEvidence && <Button size="sm" onClick={() => setNotificationEvidence({ userKey, authEpoch, id })}>打开时间证据</Button>}>
      {shortTime(new Date(command.createdAt).toISOString())}（{businessZone().label}）发出，可能已经生效，不要重复操作。{expired ? `${EXPIRED_TEXT}。` : "在时间证据里按原校正重试。"}
      {auditLink}
      <Explain label="技术信息" content={`请求号 ${command.commandKey} ｜ 理由 ${command.reason}`} />
    </Notice>;
  });

  const current = record && recordRows[record.kind][record.index];
  const currentDevice = record?.kind === "device" && current ? current : null;
  const currentDeviceWritable = !!currentDevice && canWriteC2 && asNumber(currentDevice.id) > 0 && !FINAL_DEVICE_STATUS.includes(asText(currentDevice.status, "").toUpperCase());
  const currentNotificationId = record?.kind === "notification" && current ? Number(current.notificationId) : 0;
  const conclusionOf = record && current ? recordConclusion(record.kind, current) : undefined;
  // 写了「请到…核对」就要走得到（DT-06、DT-23）：没有那页权限时只留这句话。
  const goTarget = record?.kind === "withdrawal" && current && canReadD2 && withdrawalTone(current) !== "ok" ? { label: "去提现审核", pathname: "/finance/withdrawals", query: { group: "all", q: asText(current.withdrawalNo, ""), returnTo: selfHref } }
    : record?.kind === "device" && current && deviceAbnormal(current) && reach("/devices/ops") ? { label: "去设备运行管理", pathname: "/devices/ops", query: { returnTo: selfHref } }
    : record?.kind === "order" && current && orderTone(current) === "danger" && reach("/devices/orders") ? { label: "去订单进度", pathname: "/devices/orders", query: { returnTo: selfHref } }
    : (record?.kind === "deposit" || record?.kind === "topup") && current && depositTone(current) === "danger" && reach("/finance/recon") ? { label: "去充值与收款对账", pathname: "/finance/recon", query: { returnTo: selfHref } }
    : undefined;
  const goLink = goTarget && <Link className="rd-btn" data-variant="secondary" data-size="md" href={{ pathname: goTarget.pathname, query: goTarget.query }} prefetch={false}><span className="rd-btn-face">{goTarget.label}</span></Link>;
  const recordProps = (kind: RecordKind) => ({ selected: record?.kind === kind ? record.index : undefined, onOpen: (index: number) => setRecord({ kind, index }) });
  const deviceColumns: Column[] = [
    // 规格并进第二行：操作列是「回收并记录置换」加「设备回收」，五列在 1024 放不下（DT-16）。
    { label: "实例 · 名称 · 规格", cell: (row) => <Cell mono main={asText(row.instanceNo)} sub={[asText(row.name, ""), formatC1DeviceTier(row.productTier)].filter((text) => text && text !== "—").join(" · ") || "—"} title={asText(row.instanceNo)} /> },
    { label: "状态", cell: (row) => <Cell main={deviceTag(row)} sub={formatC1RuntimeStatus(row.runtimeStatus)} /> },
    { label: "设定日收益", align: "right", cell: (row) => <Cell num main={amountText(row.dailyUsdt)} sub={amountText(row.dailyNex, "UVT")} /> },
    ...(canWriteC2 ? [{ label: "操作", align: "right" as const, end: true, cell: (row: JsonRecord) => {
      const deviceId = asNumber(row.id);
      if (!deviceId || FINAL_DEVICE_STATUS.includes(asText(row.status, "").toUpperCase())) return "—";
      return <Cell full main={<span className="rd-row-actions">
        <Button size="sm" disabledReason={deviceBlock(deviceId)} onClick={() => openDeviceAction(row, "replace")}>回收并记录置换</Button>
        <Button size="sm" variant="danger-outline" disabledReason={deviceBlock(deviceId)} onClick={() => openDeviceAction(row, "recycle")}>设备回收</Button>
      </span>} sub={deviceBlock(deviceId)} />;
    } }] : []),
  ];
  const notificationColumns: Column[] = [
    { label: "通知编号", cell: (row) => {
      const id = Number(row.notificationId);
      return canReadNotificationEvidence && Number.isSafeInteger(id) && id > 0
        ? <button type="button" className="rd-link rd-link-button" onClick={() => setNotificationEvidence({ userKey, authEpoch, id })}>查看详情 · {id}</button>
        : asText(row.notificationId);
    } },
    { label: "标题", cell: (row) => <Cell main={nexGridBrandText(asText(row.title))} title={asText(row.title)} /> },
    { label: "类型", cell: (row) => formatC1NotificationType(row.type) },
    { label: "推送 · 已读", cell: (row) => <Cell main={pushText(row)} sub={formatC1ReadFlag(row.readFlag)} /> },
    { label: "创建时间", cell: (row) => <Cell num main={shortTime(row.createdAt)} /> },
  ];
  const paymentColumns: Column[] = [
    { label: "支付方式", cell: (row) => <Cell main={`${asText(row.brand)} ···· ${asText(row.last4)}`} sub={`${asText(row.provider)} · ${asText(row.expiryLabel, "无到期信息")}`} /> },
    { label: "状态", cell: (row) => <Cell full
      main={paymentTag(row)}
      sub={row.trialGuard ? `历史试用记录 · ${asText(row.trialRefId, "关联试用")}` : row.status !== "BOUND" && row.unboundAt ? `解绑时间：${shortTime(row.unboundAt)}` : undefined} /> },
    ...(canWriteC1 ? [{ label: "操作", align: "right" as const, end: true, cell: (row: JsonRecord) => {
      const method = row as UserPaymentMethod;
      if (method.status !== "BOUND") return "—";
      return <Cell full sub={methodBlock(method)} main={<Button size="sm" disabledReason={methodBlock(method) ?? (method.trialGuard ? "这张卡有历史试用关联记录，暂时不能解绑。" : undefined)} onClick={() => openUnbind(method)}>解绑</Button>} />;
    } }] : []),
  ];

  const paymentCount = paymentError ? null : paymentMethods?.total ?? null;
  const joined = (items: unknown[]) => items.filter(Boolean).join(" · ");
  // 摘要只给收起时看，展开后下面有同样的数（DP-61）。有异常时只写异常。
  const foldSummary = (group: string, alert: boolean, text: string) => (openFolds[group] ?? alert) ? "" : text;
  const securityText = securityFailed
    ? joined([securityUnread && "账号锁定和两步验证暂时无法确认", paymentSecurity.state === "failed" && "支付安全暂时无法确认", paymentError && "支付方式加载失败", !paymentError && revokeScanFailed && "撤销状态加载失败"])
    : securityAlert
      ? joined([summary.locked === true && "账号已锁定", paymentSecurity.state === "exception" && "支付密码有异常", paymentSecurity.pending && "解除结果等待确认", unfinishedRevokes.length > 0 && `${unfinishedRevokes.length} 张卡仍可能被扣款`])
      : joined([
        detail.sessions && `在线登录设备 ${numberLabel(summary.activeSessionCount)}`,
        detail.sessions && `两步验证${summary.twoFactorEnabled ? "开启" : "关闭"}`,
        paymentSecurity.state === "clear" ? "支付密码无异常" : paymentSecurity.state === "loading" && "正在读取…",
        !supportScope && paymentCount !== null && `支付方式 ${paymentCount} 张`,
      ]);
  const fundsIssue = joined([withdrawalExceptions > 0 && `${withdrawalExceptions} 笔提现异常`, withdrawalsWaiting > 0 && `${withdrawalsWaiting} 笔提现等待处理`]);
  const fundsText = fundsFailed
    ? ledgerUnread ? "账单流水加载失败" : "有区块加载失败"
    : fundsAlert
      ? fundsIssue
      : joined([
        detail.deposits && `充值 ${numberLabel(detail.deposits.total)} 笔`,
        detail.withdrawals && `提现 ${numberLabel(detail.withdrawals.total)} 笔`,
        detail.financial && `兑换 ${numberLabel(exchanges.length)} 笔`,
        !detail.deposits && !detail.withdrawals && !detail.financial && `账户${statusLabel(status)}`,
      ]);
  const devicesText = devicesFailed
    ? ledgerUnread ? "账单流水加载失败，收益不可用" : "有区块加载失败"
    : devicesAlert
      ? `${deviceExceptions} 台设备异常`
      : joined([
        detail.devices && `在线 ${numberLabel(detail.devices.onlineCount)} / 活跃 ${numberLabel(detail.devices.activeCount)}`,
        detail.earnings && `收益合计 ${amountText(detail.earnings.totalUsdt)}`,
      ]);
  const teamText = teamFailed ? "有区块加载失败" : joined([
    detail.referral && !inKpi("团队规模") && `团队 ${numberLabel(detail.referral.teamSize)} 人`,
    detail.referral && `直接邀请 ${numberLabel(detail.referral.directCount)} 人`,
    detail.vrank && `等级 ${asText(detail.vrank.currentRank)}`,
  ]);
  const recordsText = recordsFailed
    ? "有区块加载失败"
    : recordsAlert
      ? joined([failedPushCount > 0 && `${failedPushCount} 条通知推送失败`, orderExceptions > 0 && `${orderExceptions} 单订单异常`, corrections.length > 0 && "通知校正结果未确认"])
      : joined([
        detail.notifications && `未读 ${numberLabel(detail.notifications.unreadCount)} 条`,
        detail.commerce && `订单 ${numberLabel(detail.commerce.total)} 单`,
        detail.audit && `操作记录 ${auditEntries.length} 条`,
      ]);
  const hiddenNote = [
    !detail.sessions && !supportScope && "登录安全",
    !fundsPresent && "资金",
    !devicesPresent && "设备与收益",
    !teamPresent && "团队与互动",
    !recordsPresent && "记录",
    !detail.risk && "风险",
  ].filter(Boolean).join("、");
  const wallet = detail.financial?.wallet as JsonRecord | undefined;
  const securityValue = (value: unknown, on = "是", off = "否") => securityUnread ? "暂时无法确认" : yesNo(value, on, off);

  return (
    <RdPage>
      <PageHeader pageId={supportScope ? "C1S" : "C1D"} title={displayNickname}
        summary={supportScope ? "这个客户的资料、资金、设备和记录。" : "这个用户的资料、资金、设备和记录。"}
        back={<Link href={returnTo} prefetch={false}><ArrowLeft size={14} aria-hidden /> {returnLabel}</Link>}
        actions={<Button icon={<RefreshCcw size={14} aria-hidden />} loading={loading} loadingText="读取中…" onClick={() => void load()}>刷新</Button>}
        identity={<>
          <span data-mono>用户编码 {userNo}</span>
          <StatusTag tone={statusTone(status)} icon={STATUS_ICON[status]} filled>{statusLabel(status)}</StatusTag>
          <span>分层 {asText(profile.userLevel)} · {asText(profile.vRank)}</span>
          <span>{asText(profile.phoneMasked)}</span>
        </>}
        meta={<>注册 {shortTime(profile.registeredAt)} · 最近登录 {shortTime(profile.lastLoginAt)} · {readAt} 读取（{businessZone().label}）<Explain label="什么时候读取" content="打开和点「刷新」时读取，不自动刷新。" /></>}
        readOnly={!supportScope && !canWriteC1 && !canWriteC2 && !canReleasePayment ? "当前账号在这页只能查看" : undefined}
        guideExtra={hiddenNote ? <p>这个账号看不到的区块不显示：{hiddenNote}。</p> : undefined} />

      {conclusion}
      {pendingNotices}
      {writeResultNotice}
      {correctionNotices}

      {kpis.length > 0 && <StatBand label="关键数字">
        {kpis.map((kpi, index) => (
          <Stat key={kpi.label} lead={index === 0} icon={kpi.icon} tone={kpi.tone} label={kpi.label} value={kpi.value} unit={kpi.value === "—" ? undefined : kpi.unit}
            sub={kpi.sub} explain={kpi.explain} openLabel={`查看${kpi.label}明细`} onOpen={() => locate(kpi.group, kpi.anchor)} />
        ))}
      </StatBand>}

      {hasEntries && <Panel title="处理入口" icon={UserCog} tone="role-3" explain={<><p>账户和资金操作到对应页面办，办完回到这页点「刷新」。</p><p>{inPageWrites ? `这个账号在这页能${inPageWrites}。` : "这个账号在这页不能改任何内容。"}</p></>} actions={<>
            {canReadC2 && <Link className="rd-btn" data-variant="secondary" data-size="sm" href={{ pathname: "/users/actions", query: { userCode: userNo, source: "C1", returnTo: selfHref } }} prefetch={false}><span className="rd-btn-face">冻结 / 解冻账户</span></Link>}
            {canReadC3 && /^[1-9]\d*$/.test(c3UserId) && <Link className="rd-btn" data-variant="secondary" data-size="sm" href={{ pathname: "/users/assets", query: { userCode: userNo, userId: c3UserId, returnTo: selfHref } }} prefetch={false}><span className="rd-btn-face">调整余额</span></Link>}
            {canReadC5 && <Link className="rd-btn" data-variant="secondary" data-size="sm" href={{ pathname: "/users/security", query: { userCode: userNo, returnTo: selfHref } }} prefetch={false}><span className="rd-btn-face">安全与登录设备</span></Link>}
            {canWriteC1 && <Button size="sm" disabledReason={!c3UserId ? "读不到用户号，刷新后再试" : nicknameBlock} onClick={openNicknameReset}>重置昵称</Button>}
      </>}>
        <div className="rd-detail-entries">
          {canWriteC1 && nicknameBlock && <p className="rd-toolbar-note">{nicknameBlock}</p>}
          {crossLinks.length > 0 && <div className="rd-links">
            <span>去查</span>
            {crossLinks.map(([label, target]) => <Link key={target} className="rd-link" href={{ pathname: target, query: { userCode: userNo, returnTo: selfHref } }} prefetch={false}>{label}</Link>)}
          </div>}
        </div>
      </Panel>}

      {(detail.risk || detail.financial) && <Panel title={detail.risk && detail.financial ? "风险与资产" : detail.risk ? "风险" : "资产"} icon={detail.risk ? ShieldAlert : Wallet} tone={detail.risk ? (hasRiskScore ? riskTone : "role-other") : "role-1"}
        explain={detail.risk && !supportScope ? "风险分来自风险评分规则，这页只显示，不重算。" : undefined}>
        <Values rows={[
          ...(detail.risk ? [[hasRiskScore || !riskAuthorityReady ? "风险分" : "风险档", hasRiskScore ? <StatusTag key="score" tone={riskTone}>{riskScore} · {riskBand}</StatusTag> : riskBand] as const] : []),
          ...(detail.risk?.flags !== undefined ? [["风险标记", riskFlags(detail.risk.flags, detail.risk.cases !== undefined)] as const] : []),
          ...(detail.risk?.cases !== undefined ? [[<>风险案件<Explain label="风险案件的口径" content="按最近 20 条案件算。案件读取失败时后端也返回 0，这个数不能证明没有案件。" /></>, `${numberLabel(detail.risk.openCaseCount)} 个未关闭`] as const] : []),
          ...(detail.financial ? [
            ["UVT 余额", amountText(summary.walletNex ?? profile.walletNex, "UVT")] as const,
            [<>提现申请额<Explain label="提现申请额的口径" content="能核对到的处理中提现本金小计，不是已到账的钱，也不保证覆盖全部历史。" /></>, amountText(summary.withdrawRequestedUsd)] as const,
          ] : []),
        ]} />
      </Panel>}

      {sections.length > 0 && <div className="rd-detail-nav"><SectionNav row label="本页分区" items={sections} nav={nav} /></div>}

      <div className="rd-detail-groups">
        {securityPresent && <div id={nav.anchor("security")}>
          <Fold title="安全" icon={ShieldCheck} tone="role-3" summary={foldSummary("security", securityAlert || securityFailed, securityText)} alertTone={securityFailed ? "danger" : "warn"} {...foldProps("security", securityAlert || securityFailed)}>
            {detail.sessions && <Block title="登录安全" {...listProps("session")} section={{ sourceStatus: "READY" }} issue={summary.locked === true ? "账号已锁定" : undefined} sub={filteredSessions.length > C1_SESSION_PAGE_SIZE ? "最近 50 条登录记录" : `最近 50 条登录记录 · 筛选后 ${filteredSessions.length} 条`} explain="这是最近最多 50 条样本，不是全部历史。登录记录读取失败时后端也返回空，写 0 或没有记录不能证明没登录过。">
              <Values rows={[
                ["在线登录设备", numberLabel(summary.activeSessionCount)],
                ["两步验证", securityValue(summary.twoFactorEnabled, "开启", "关闭")],
                ["锁定", summary.locked ? <StatusTag tone="warn">是</StatusTag> : securityValue(summary.locked)],
              ]} />
              {securityUnread && <Notice tone="warn">账号锁定、两步验证和需重置密码这次没读到，不是没有问题。点页面右上角「刷新」重读。</Notice>}
              <Segments<SessionStatusFilter> label="登录状态筛选" value={sessionStatusFilter} onChange={setSessionStatusFilter} items={C1_SESSION_STATUS_FILTERS.map(([value, label]) => ({ value, label }))} />
              <RecordTable label="登录记录" rows={visibleSessions} columns={SESSION_COLUMNS} empty={sessionStatusFilter === "ALL" ? "暂无登录记录" : "当前筛选下没有登录记录"} {...recordProps("session")} />
              {filteredSessions.length > C1_SESSION_PAGE_SIZE && <Pager label="登录记录" total={filteredSessions.length} page={sessionPage} pageSize={C1_SESSION_PAGE_SIZE} sizes={[C1_SESSION_PAGE_SIZE]} onPage={(page) => { setRecord(null); setSessionPage(Math.min(sessionPageCount, Math.max(1, page))); }} onPageSize={() => undefined} />}
            </Block>}
            {paymentSecurityPort && <div className="rd-detail-block">
              <PaymentSecurityBlock key={`${readKey}|${paymentSecurityPort.key}`} port={paymentSecurityPort} userLabel={`${displayNickname} · ${userNo}`} reloadKey={reloadTick} canRelease={canReleasePayment}
                onState={onPaymentSecurity} />
            </div>}
            {!supportScope && <Block id="hub-payment-methods" title="支付方式" {...listProps("payment")} section={{ sourceStatus: "READY" }} failure={paymentError && `支付方式加载失败：${paymentError}`}
              sub={paymentMethods && paymentMethods.total > 0 ? `${paymentMethods.total} 条` : undefined}
              issue={unfinishedRevokes.length > 0 ? `${unfinishedRevokes.length} 张卡仍可能被扣款` : undefined} issueTone="danger"
              actions={<Button size="sm" aria-label="刷新支付方式" icon={<RefreshCcw size={13} aria-hidden />} loading={paymentLoading} onClick={() => void loadPaymentMethods()}>刷新</Button>}>
              <Check label="显示已解绑" checked={includeUnbound} onChange={(event) => { setIncludeUnbound(event.target.checked); setPaymentPage(1); setRecord(null); }} />
              {revokeScanFailed && <Notice tone="warn">撤销状态读取失败：已解绑的卡有没有撤销完暂时无法确认，点这一行的「刷新」重读。</Notice>}
              {unfinishedRevokes.map((method) => (
                <Notice key={method.id} tone={method.revokeDeadlineAt && new Date(method.revokeDeadlineAt).getTime() < Date.now() ? "danger" : "warn"} title={`${method.brand} ···· ${method.last4}`}>
                  我们这边已解绑，但支付商那边{method.pspRevokeStatus === "FAILED" ? "撤销失败" : "还在处理"}，这张卡仍可能被扣款，还不算彻底解绑。
                  {method.revokeDeadlineAt && new Date(method.revokeDeadlineAt).getTime() < Date.now() ? " 已超时，请立即联系主管。" : ""}
                  <Explain label="撤销详情" content={[method.revokeCommandNo && `命令 ${method.revokeCommandNo}`, method.revokeAttempts && `已重试 ${method.revokeAttempts} 次`, method.revokeLastError].filter(Boolean).join(" · ") || "暂无更多信息"} />
                </Notice>
              ))}
              <RecordTable label="支付方式" rows={methods} columns={paymentColumns} empty={paymentLoading ? "正在读取支付方式…" : "该用户暂无支付方式"} {...recordProps("payment")} />
              {!!paymentMethods && paymentMethods.total > paymentMethods.pageSize && <Pager label="支付方式" total={paymentMethods.total} page={paymentMethods.page} pageSize={paymentMethods.pageSize} sizes={[paymentMethods.pageSize]} loading={paymentLoading} onPage={(page) => { setRecord(null); setPaymentPage(page); }} onPageSize={() => undefined} />}
            </Block>}
          </Fold>
        </div>}

        {fundsPresent && <div id={nav.anchor("funds")}>
          <Fold title="资金" icon={Wallet} tone="role-1" summary={foldSummary("funds", fundsFailed || fundsAlert, fundsText)} alertTone={fundsFailed || withdrawalExceptions > 0 ? "danger" : "warn"} {...foldProps("funds", fundsFailed || fundsAlert)}>
            <Block id="hub-deposit" title="充值记录" {...listProps("deposit")} section={detail.deposits} sub={`最多 30 条 · 共 ${numberLabel(detail.deposits?.total)} 笔`}
              explain={`这里只列已确认的链上充值和停用前的国际卡充值，最多 30 条，银行卡充值不在这里。确认总额 ${amountText(detail.deposits?.confirmedUsd)} 是能核对到的小计，含银行卡充值，不保证覆盖全部历史，也不是这些行相加。`}>
              <RecordTable label="充值记录" rows={deposits} columns={DEPOSIT_COLUMNS} {...recordProps("deposit")} />
            </Block>
            <Block id="hub-withdrawal" title="提现记录" {...listProps("withdrawal")} section={detail.withdrawals} sub={`最多 30 条 · 共 ${numberLabel(detail.withdrawals?.total)} 笔`}
              issue={fundsAlert ? fundsIssue : undefined} issueTone={withdrawalExceptions > 0 ? "danger" : "warn"}
              explain={<><p>这里最多列 30 条，不是近 30 天。</p><p>完成总额 {amountText(detail.withdrawals?.completedUsd)}：能核对到的成功提现本金小计。申请总额 {amountText(detail.withdrawals?.requestedUsd)}：能核对到的处理中提现本金小计。都不保证覆盖全部历史。</p></>}>
              <RecordTable label="提现记录" rows={withdrawals} columns={WITHDRAWAL_COLUMNS} {...recordProps("withdrawal")} />
            </Block>
            <Block title="账户状态" section={detail.account} summary={`两步验证${securityValue(summary.twoFactorEnabled, "开启", "关闭")} · 需重置密码：${securityValue(summary.passwordResetRequired)}`}>
              <Values rows={[
                ["两步验证", securityValue(summary.twoFactorEnabled, "开启", "关闭")],
                ["需重置密码", securityValue(summary.passwordResetRequired)],
              ]} />
            </Block>
            <Block title="兑换记录" {...listProps("exchange")} section={detail.financial} failure={ledgerUnread && "账单流水读不到，兑换记录暂时无法确认，不是没有记录。"} sub={Array.isArray(detail.financial?.stakingLedgerRows) ? `质押记录 ${numberLabel(detail.financial.stakingLedgerRows.length)} 条` : undefined}
              explain={`钱包 USDT ${amountText(wallet?.usdt)}，钱包 UVT ${amountText(wallet?.nex, "UVT")}。`}>
              <RecordTable label="兑换记录" rows={exchanges} columns={EXCHANGE_COLUMNS} empty="暂无兑换记录" {...recordProps("exchange")} />
            </Block>
          </Fold>
        </div>}

        {devicesPresent && <div id={nav.anchor("devices")}>
          <Fold title="设备与收益" icon={Cpu} tone="role-2" summary={foldSummary("devices", devicesFailed || devicesAlert, devicesText)} alertTone="danger" {...foldProps("devices", devicesFailed || devicesAlert)}>
            <Block id="hub-devices" title="设备明细" {...listProps("device")} section={detail.devices} sub={inKpi("设备数") ? "最多 200 台" : `最多 200 台 · 共 ${numberLabel(detail.devices?.total)} 台`}
              issue={deviceExceptions > 0 ? `${deviceExceptions} 台设备异常` : undefined} issueTone="danger"
              explain={<><p>这是设定值，不是今天实际到账的收益。合计含已停用设备。</p><p>在线、活跃和合计都按这里列出的设备算。</p></>}>
              <Values rows={[
                ["在线 / 活跃", `${numberLabel(detail.devices?.onlineCount)} / ${numberLabel(detail.devices?.activeCount)}`],
                ["设定日收益合计（含已停用设备）", `${amountText(detail.devices?.dailyUsdt)} · ${amountText(detail.devices?.dailyNex, "UVT")}`],
              ]} />
              <RecordTable label="设备明细" rows={devices} columns={deviceColumns} {...recordProps("device")} />
            </Block>
            <Block title="收益明细" {...listProps("earning")} section={detail.earnings ? { sourceStatus: asText(detail.earnings.sourceStatus, "READY") } : undefined} failure={ledgerUnread && "账单流水读不到，收益暂时无法确认，不是没有收益。"} sub={`共 ${numberLabel(detail.earnings?.total)} 条`}
              explain="收益合计按这次读到的账单流水算，不承诺是全部历史。">
              <Values rows={[
                ["收益合计", `${amountText(detail.earnings?.totalUsdt)} · ${amountText(detail.earnings?.totalNex, "UVT")}`],
                ...(detail.devices ? [] : [["设定日收益合计（含已停用设备）", `${amountText(detail.earnings?.deviceDailyUsdt)} · ${amountText(detail.earnings?.deviceDailyNex, "UVT")}`] as const]),
              ]} />
              <RecordTable label="收益明细" rows={visibleEarnings} columns={EARNING_COLUMNS} {...recordProps("earning")} />
              {earningsRecords.length > 10 && <Pager label="收益明细" total={earningsRecords.length} page={earningsPage} pageSize={earningsPageSize} sizes={[10, 20, 50]} onPage={(page) => { setRecord(null); setEarningsPage(page); }} onPageSize={(size) => { setRecord(null); setEarningsPageSize(size); setEarningsPage(1); }} />}
            </Block>
          </Fold>
        </div>}

        {teamPresent && <div id={nav.anchor("team")}>
          <Fold title="团队与互动" icon={Network} tone="role-3" summary={foldSummary("team", teamFailed, teamText)} alertTone="danger" {...foldProps("team", teamFailed)}>
            <Block id="hub-referral" title="推荐团队" {...listProps("member")} section={detail.referral ? { sourceStatus: asText(detail.referral.sourceStatus, "READY") } : undefined} sub="最多 20 条"
              explain="成员最多列 20 条，不是完整名单。团队规模、直接邀请和团队订单额是另外算的总数，不是这些行相加。">
              <Values rows={[
                ...(inKpi("团队规模") ? [] : [["团队规模", `${numberLabel(detail.referral?.teamSize)} 人`] as const]),
                ["直接邀请", `${numberLabel(detail.referral?.directCount)} 人`],
                ["团队订单额", amountText(detail.referral?.teamVolumeUsd)],
              ]} />
              <RecordTable label="推荐团队" rows={members} columns={MEMBER_COLUMNS} {...recordProps("member")} />
            </Block>
            <Block id="hub-engagement" title="互动与参与" {...listProps("engagement")} section={detail.engagement ? { sourceStatus: asText(detail.engagement.sourceStatus, "READY") } : undefined}>
              <RecordTable label="互动与参与" rows={engagement} columns={ENGAGEMENT_COLUMNS} {...recordProps("engagement")} />
            </Block>
            <Block title="团队等级" section={detail.vrank} summary={`等级 ${asText(detail.vrank?.currentRank)} · 级别 ${asText(detail.vrank?.userLevel)}`}>
              <Values rows={[
                ["当前等级", asText(detail.vrank?.currentRank)],
                ["用户级别", asText(detail.vrank?.userLevel)],
                ...(detail.referral ? [] : [
                  ["团队规模", `${numberLabel(detail.vrank?.teamSize)} 人`] as const,
                  ["直接邀请", `${numberLabel(detail.vrank?.directCount)} 人`] as const,
                  ["团队订单额", amountText(detail.vrank?.teamVolumeUsd)] as const,
                ]),
              ]} />
            </Block>
          </Fold>
        </div>}

        {recordsPresent && <div id={nav.anchor("records")}>
          <Fold title="记录" icon={FileClock} tone="role-other" summary={foldSummary("records", recordsAlert || recordsFailed, recordsText)} alertTone={recordsFailed || failedPushCount + orderExceptions > 0 ? "danger" : "warn"} {...foldProps("records", recordsAlert || recordsFailed)}>
            <Block title="参与与通知" {...listProps("notification")} section={detail.notifications} sub="最多 20 条" issue={failedPushCount > 0 ? `${failedPushCount} 条推送失败` : undefined} issueTone="danger" explain="未读、待推送和失败是另外算的总数，不是这些行相加。点通知编号看时间证据。">
              <Values rows={[
                ["未读", `${numberLabel(detail.notifications?.unreadCount)} 条`],
                ["待推送", `${numberLabel(detail.notifications?.pendingPushCount)} 条`],
                ["失败", failedPushCount > 0 ? <StatusTag key="failed" tone="danger">{numberLabel(failedPushCount)} 条</StatusTag> : `${numberLabel(detail.notifications?.failedPushCount)} 条`],
              ]} />
              <RecordTable label="参与与通知" rows={notifications} columns={notificationColumns} {...recordProps("notification")} />
            </Block>
            <Block id="hub-orders" title="商城订单" {...listProps("order")} section={detail.commerce ? { sourceStatus: asText(detail.commerce.sourceStatus, "READY") } : undefined} sub="最多 50 单" issue={orderExceptions > 0 ? `${orderExceptions} 单异常` : undefined} issueTone="danger" explain="订单总数和活跃订单按这里列出的订单算。">
              <Values rows={[
                ["订单总数", `${numberLabel(detail.commerce?.total)} 单`],
                ["活跃订单", `${numberLabel(detail.commerce?.activeOrderCount)} 单`],
              ]} />
              <RecordTable label="商城订单" rows={orders} columns={ORDER_COLUMNS} {...recordProps("order")} />
            </Block>
            {detail.audit && <div className="rd-detail-block">
              <Fold inset title="后台操作记录" open={visibleRecordList === "audit"} onOpenChange={next => setOpenRecordList(next ? "audit" : null)} summary={`最多 20 条 · 这里有 ${auditEntries.length} 条`}><Timeline entries={auditEntries} label="后台操作记录" /></Fold>
            </div>}
          </Fold>
        </div>}
      </div>

      <Drawer open={!!current && !!record} onClose={() => setRecord(null)} title={record ? RECORD[record.kind].title : ""} sub={record && current ? RECORD[record.kind].sub(current) : undefined}
        nav={record ? {
          hasPrev: record.index > 0,
          hasNext: record.index < recordRows[record.kind].length - 1,
          onPrev: () => setRecord({ ...record, index: record.index - 1 }),
          onNext: () => setRecord({ ...record, index: record.index + 1 }),
        } : undefined}
        footer={currentDevice && currentDeviceWritable
          ? <Decision note={deviceBlock(asNumber(currentDevice.id))}
              explain="两个操作都让设备回收并离线，不能撤销，不退钱，不发新设备。回收并记录置换多记一张已完成的置换单，设备回收不留单。"
              danger={<Button variant="danger-outline" disabledReason={deviceBlock(asNumber(currentDevice.id))} onClick={() => openDeviceAction(currentDevice, "recycle")}>设备回收</Button>}
              others={<>{goLink}<Button disabledReason={deviceBlock(asNumber(currentDevice.id))} onClick={() => openDeviceAction(currentDevice, "replace")}>回收并记录置换</Button></>} />
          : canReadNotificationEvidence && Number.isSafeInteger(currentNotificationId) && currentNotificationId > 0
            ? <Decision primary={<Button onClick={() => { setRecord(null); setNotificationEvidence({ userKey, authEpoch, id: currentNotificationId }); }}>查看时间证据</Button>} />
            : goLink ? <Decision primary={goLink} /> : undefined}>
        {record && current && conclusionOf && <Notice tone={conclusionOf.tone}>{conclusionOf.text}</Notice>}
        {record && current && <Facts>{RECORD[record.kind].facts(current).map(([label, value]) => <Fact key={label} k={label}>{value}</Fact>)}</Facts>}
      </Drawer>

      {actionConfirm && (
        <OperationConfirmModal briefKind={actionConfirm.briefKind}
          action={actionConfirm.action}
          title={actionConfirm.title}
          detail={actionConfirm.detail}
          amplifies={actionConfirm.amplifies ?? false}
          facts={actionConfirm.facts}
          effect={<><StatusTag tone="progress" filled>立即生效</StatusTag>{actionConfirm.irreversible && <IrreversibleTag />}</>}
          confirmLabel={actionConfirm.confirmLabel}
          confirmTone={actionConfirm.confirmTone}
          statedBrief={actionConfirm.statedBrief}
          reasonMax={200}
          onClose={() => setActionConfirm(null)}
          onConfirm={async (reason) => {
            await actionConfirm.run(reason);
            setActionConfirm(null);
          }}
        />
      )}
      {releasing && <ReleaseModal label={releasing.label} onCancel={() => setReleasing(null)} onConfirm={() => releasePending(releasing)}
        explain={`${releasing.legacy ? "这条记录是升级前留下的，不能重试" : "重试被拒说明不了原操作的结果"}，先到操作记录确认原操作有没有生效。解除只移除本地记录，不办理后端核查结案；后端仍可能锁住这个对象。`} />}
      {notificationEvidence && canReadNotificationEvidence
        && notificationEvidence.userKey === userKey && notificationEvidence.authEpoch === authEpoch && (
        <NotificationTimeEvidenceDrawer key={`${userKey}:${authEpoch}:${notificationEvidence.id}`}
          userKey={userKey} notificationId={notificationEvidence.id} actorKey={session?.adminId == null ? undefined : String(session.adminId)}
          canCorrect={canCorrectNotificationTime} onPendingChange={syncPending} onCorrected={() => {
            const text = `通知 ${notificationEvidence.id} 已按投递事实校正时间，已读状态保持不变。`;
            setWriteResult({ key: readKey, text, tone: "ok" });
            void load().then(refreshed => {
              if (!refreshed && currentReadKey.current === readKey) setWriteResult({ key: readKey, text: `${text}资料刷新失败，请点「刷新」核对。`, tone: "warn" });
            });
          }} onClose={() => { setNotificationEvidence(null); syncPending(); }} />
      )}
    </RdPage>
  );
}
