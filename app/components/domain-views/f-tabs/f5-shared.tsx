"use client";

/**
 * F5 奖励记录核对的共用小件：状态和类型的名字、金额和时间的写法、确认框外壳、原操作提醒。
 * 只管怎么显示；提交调用 ctx 上和旧页面相同的函数、相同的参数。
 */
import type { ReactNode } from "react";
import { CircleCheck, CircleHelp, CircleSlash, Clock3, Hourglass, Snowflake, TriangleAlert, Undo2, Wallet, type LucideIcon } from "lucide-react";
import { Explain, Notice, StatusTag, type StateTone } from "@/app/components/rd";
import { OperationConfirmModal, type BusinessFormSpec, type BusinessFormValue, type OperatorBriefKind } from "../design-kit";
import { displayAdminError } from "@/lib/admin/error-messages";
import { businessStamp, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { F5_KIND_LABELS } from "@/lib/admin/f-overview-contract";
import { f4Decimal } from "@/lib/admin/f4-money";
import { canRetryF5Proposal, type F5ConfirmationSnapshot } from "@/lib/admin/f5-approval";
import { canRetryF5Anomaly } from "@/lib/admin/f5-anomaly-write";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { F5CommissionEvent } from "@/lib/admin/f1-client";
import type { F5Recovery, FViewCtx } from "./types";

export const KIND_LABELS = F5_KIND_LABELS;

/** 服务端七个状态标题到状态码的精确对应（协议，不改）。 */
export const STATUS_BY_LABEL: Record<string, string> = {
  已解锁可提: "unlocked",
  冷却计提中: "cooling",
  已提现: "withdrawn",
  已撤销: "reversed",
  已冻结: "frozen",
  已拒绝: "rejected",
  待追回: "recovery_pending",
};

/** 七个状态在页面上的名字、色调和一句话。自动过程用进行色，结束用灰，要人处理的才用警示和危险色。 */
export const STATUS_META: Record<string, { name: string; tone: StateTone; icon: LucideIcon; text: string }> = {
  cooling: { name: "冷却中", tone: "progress", icon: Hourglass, text: "奖励已经算出，还在冷却期，不能提现；有到期时间的到期后系统解锁。" },
  unlocked: { name: "已解锁", tone: "ok", icon: CircleCheck, text: "这笔不再冷却；用户实际能提多少以钱包为准。" },
  withdrawn: { name: "已提现", tone: "done", icon: Wallet, text: "已提现或已结清，记录到此结束；这页不核出款。" },
  frozen: { name: "已冻结", tone: "warn", icon: Snowflake, text: "被按住了，到期也不会解锁；可以解冻回冷却中，或冲正收回。" },
  reversed: { name: "已冲正", tone: "done", icon: Undo2, text: "奖励已收回，记录到此结束；不是好友奖励的可以申请补发一笔新的。" },
  rejected: { name: "已拒绝", tone: "done", icon: CircleSlash, text: "这条记录当时被拒绝发放。" },
  recovery_pending: { name: "待追回", tone: "danger", icon: TriangleAlert, text: "冲正时用户余额不够，没收回的部分记在这里，是待追回的欠款。" },
};

export const statusName = (status: string) => STATUS_META[status]?.name ?? "状态未知";

export function StatusBadge({ status, explain = true }: { status: string; explain?: boolean }) {
  const meta = STATUS_META[status];
  if (!meta) return <StatusTag tone="warn" icon={CircleHelp}>状态未知</StatusTag>;
  return <StatusTag tone={meta.tone} icon={meta.icon} explain={explain ? meta.text : undefined}>{meta.name}</StatusTag>;
}

export const isFriend = (row: Pick<F5CommissionEvent, "kind">) => row.kind === "direct_purchase" || row.kind === "direct_device_earning";
export const isGrouped = (row: Pick<F5CommissionEvent, "settlementNo" | "kind">) => isFriend(row) || !!row.settlementNo;

/** 用户编码：U 加 8 位数字，和后端给的 user 一个写法。编号不加千分位。 */
export const userCode = (id: number | string | undefined | null) => {
  if (id === undefined || id === null || id === "") return "—";
  const digits = String(id).replace(/\D/g, "");
  return digits ? `U${digits.padStart(8, "0")}` : String(id);
};

/** 整数部分加千分位，小数原样。 */
export const groupDigits = (text: string) => {
  const [int, frac] = text.split(".");
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac !== undefined ? `.${frac}` : "");
};

const plain = (value: number | string) => f4Decimal(value)!.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

export const decimals = (value: number | string) => (plain(value).split(".")[1] ?? "").length;

/** 金额不舍入：原值有几位小数就写几位，不够 digits 位的补零对齐（同一列取这一列最多的位数，最少 2 位）。 */
export const amountText = (value: number | string, digits = 2) => {
  const [int, frac = ""] = plain(value).split(".");
  const width = Math.max(digits, frac.length);
  return groupDigits(width ? `${int}.${frac.padEnd(width, "0")}` : int);
};

/** 逐笔金额：每格写自己的位数（最少 2 位、不舍入），数字等宽右对齐，币种单独占固定宽度；悬停看后端原值。 */
export function Money({ value, currency }: { value: number | string; currency: string }) {
  return (
    <span className="f5-money" title={`原始值 ${value} ${currency}`}>
      <span className="f5-money-num">{amountText(value)}</span>
      <span className="f5-money-cur">{currency}</span>
    </span>
  );
}

/** 后端汇总标签拆成两种币；保留其金额文本与原精度，只加千分位。 */
export function splitMoneyLabel(label: string | undefined): { usdt: string; uvt: string } | null {
  const match = /^USDT (\d+(?:\.\d+)?) · UVT (\d+(?:\.\d+)?)$/.exec((label ?? "").trim());
  return match ? { usdt: groupDigits(match[1]), uvt: groupDigits(match[2]) } : null;
}

/** 时间写到分钟，按业务时区；后端给毫秒数或本地时间字符串都认，0 和空写「—」，不写成 1970 年。时区由区块标一次。 */
export function timeText(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? businessStamp(value) : "—";
  if (typeof value === "string" && value.trim()) {
    const text = value.trim();
    if (text === "0") return "—";
    if (/^\d{10,}$/.test(text)) return Number(text) > 0 ? businessStamp(Number(text)) : "—";
    return formatBusinessTimeCompact(text, "—");
  }
  return "—";
}

export const zoneNote = () => businessZone().label;

/** 处置历史的动作名。自动解锁有自己的名字（D07）；其余不认识的写「奖励处理」。 */
export const OPERATION_LABELS: Record<string, string> = {
  REVERSE: "冲正",
  REISSUE: "补发",
  SUSPEND: "暂停",
  RESUME: "恢复",
  AUTO_UNLOCK: "到期自动解锁",
  ANOMALY_CONFIG: "调整异常标准",
};
export const operationLabel = (type: string) => OPERATION_LABELS[type] ?? "奖励处理";
export const kindNames = (value: string) => value.split(",").map((kind) => KIND_LABELS[kind.trim()] ?? "未知奖励类型").join("、");

/** 审批人叫法照「全站-审批人叫法」：F5 七个处置要另一位有审批批准权限和对应处置权限的管理员，不要求超级管理员。 */
export const APPROVER = "另一位管理员";
export const approverText = (permission: string) => `${APPROVER}，需有审批批准权限和${permission}`;

export function approvalTag(note = "批准前这笔奖励不变。") {
  return <StatusTag tone="progress" filled explain={`${APPROVER}在「操作记录与审批」批准后才执行。${note}发起人不能批准自己提交的单。`}>批准后生效</StatusTag>;
}

/**
 * 后端批准时会拒的组合（F5-PD02、B02、B03）。组读取的 unlockAt 是 release_at；
 * 只预判同源组门槛，不从日数重建 network 事件的新截止。其余拒绝由后端裁决。
 */
export const REJECTION_TEXT = {
  reverseFrozenLegacy: "没有结算组的旧奖励在已冻结时冲正，批准时会被拒。先解冻回冷却中，再冲正。",
  releaseGroupCooling: "这笔属于结算组，冷却还没真正到期，批准时会被拒。到期后系统按条件解锁。",
} as const;
export function knownRejection(row: F5CommissionEvent, action: "release" | "reverse", suspensions?: readonly { userId: string; kind: string }[]): string | undefined {
  const available = action === "release" ? row.canUnlock : row.canReverse;
  if (available !== undefined) return available ? undefined : displayAdminError(new Error((action === "release" ? row.unlockBlockedReason : row.reverseBlockedReason) ?? "F5_COMMISSION_STATE_UNAVAILABLE"));
  if (action === "reverse" && row.status === "frozen" && !isGrouped(row)) return REJECTION_TEXT.reverseFrozenLegacy;
  if (action === "release" && isGrouped(row) && row.unlockAt !== undefined && row.unlockAt > Date.now()) return REJECTION_TEXT.releaseGroupCooling;
  // The capped list proves a matching suspension, never the absence of one.
  if (action === "release" && !isGrouped(row) && suspensions?.some(item => item.userId === String(row.userId) && item.kind === row.kind)) return displayAdminError(new Error("DIRECT_REFERRAL_SPONSOR_FROZEN"));
  return undefined;
}

export type F5Confirm = {
  snapshot?: F5ConfirmationSnapshot;
  recovery?: F5Recovery;
  /** 记进操作记录的名字，和旧页面一样。 */
  action: string;
  title: ReactNode;
  briefKind: OperatorBriefKind | ((value: BusinessFormValue) => OperatorBriefKind);
  detail: ReactNode;
  effect?: ReactNode;
  facts?: ReactNode;
  content?: ReactNode;
  statedBrief?: { impact: string; check: string };
  completionCopy?: string;
  amplify?: boolean;
  coverageLead?: ReactNode;
  coverageCheck?: string;
  confirmTone?: "primary" | "danger";
  confirmLabel?: string;
  blockedReason?: ReactNode;
  reasonPlaceholder?: string;
  businessForm?: BusinessFormSpec;
  submit: (reason: string, businessValue?: BusinessFormValue) => Promise<void>;
};

/** F5 自己开的确认框：样子由页面给，提交走 ctx 上和旧页面相同的函数；成功、失败、结果未知的提示照 F 域外壳的写法。 */
export function F5ConfirmHost({ confirm, ctx, onClose }: { confirm: F5Confirm; ctx: FViewCtx; onClose: () => void }) {
  const getOriginal = () => confirm.snapshot ? ctx.getF5Operation(confirm.snapshot) : undefined;
  const original = getOriginal();
  const savedValue = (): BusinessFormValue | undefined => {
    const saved = getOriginal();
    if (!saved) return undefined;
    if (saved.kind === "anomaly") return saved.original.f5Request ? {
      sigma: String(saved.original.f5Request.commissionAnomalySigma), ratio: String(saved.original.f5Request.layerRatioAnomalyPct),
    } : undefined;
    const params = saved.original.request?.command.params;
    if (!params) return undefined;
    return typeof params.refundRef === "string" ? { refundRef: params.refundRef }
      : Array.isArray(params.kinds) ? { kinds: params.kinds.join(",") } : undefined;
  };
  const recover = async (mode: "query" | "retry") => {
    const saved = getOriginal();
    if (!saved) { onClose(); return true; }
    try {
      const resolved = await ctx.recoverF5(saved, mode);
      if (resolved) onClose();
      return resolved;
    } finally { if (!getOriginal()) onClose(); }
  };
  const retryable = original && (original.kind === "proposal" ? canRetryF5Proposal(original.original) : canRetryF5Anomaly(original.original));
  const canReadCoverage = useAdminAuth(({ session }) => session?.authorities.some(authority => ["overview_b1_read", "finance_d3_read", "bi_l3_read"].includes(authority)) ?? false);
  const needsReliableCoverage = confirm.snapshot?.action === "reissue"
    || confirm.snapshot?.action === "unlock" && !!confirm.snapshot.row && !isGrouped(confirm.snapshot.row);
  const coverage = canReadCoverage ? confirm.snapshot?.coverage ?? ctx.f5Overview?.coverage : undefined;
  return (
    <OperationConfirmModal
      briefKind={confirm.briefKind}
      action={confirm.action}
      title={confirm.title}
      detail={confirm.detail}
      effect={confirm.effect}
      facts={confirm.facts}
      content={confirm.content}
      statedBrief={confirm.statedBrief}
      completionCopy={confirm.completionCopy}
      amplifies={!!confirm.amplify}
      coverage={coverage}
      coverageReliable={canReadCoverage ? needsReliableCoverage ? !!coverage && coverage.reliable !== false : coverage?.reliable : undefined}
      coverageUnavailableBlocks={canReadCoverage && needsReliableCoverage}
      coverageLead={confirm.coverageLead}
      coverageCheck={confirm.coverageCheck}
      confirmTone={confirm.confirmTone}
      confirmLabel={confirm.confirmLabel ?? "提交审批"}
      blockedReason={original ? undefined : confirm.blockedReason}
      reasonPlaceholder={confirm.reasonPlaceholder ?? "例如：工单号、核对依据"}
      businessForm={confirm.businessForm}
      getPendingReason={() => {
        const saved = getOriginal();
        return saved?.kind === "proposal" ? saved.original.request?.reason : saved?.original.f5Request?.reason;
      }}
      getPendingBusinessValue={savedValue}
      inlineApproval={confirm.snapshot ? {
        resolve: () => undefined,
        pending: !!original,
        initialRecovery: original?.kind === "proposal" && (original.original.ticket || original.original.received) ? "lookup" : "retry",
        expired: original ? isRetryExpired(original.original) : false,
        disabledReason: original && !retryable ? "原操作当前只能查询原结果。" : undefined,
        recover: () => recover("query"),
        retry: async () => { await recover("retry"); },
      } : undefined}
      onClose={onClose}
      onConfirm={async (reason, _newValue, businessValue) => {
        try {
          if (getOriginal()) { await recover("retry"); return; }
          ctx.prepareF5Confirmation(confirm.snapshot ? { ...confirm.snapshot, name: confirm.action } : undefined);
          await confirm.submit(reason, businessValue);
          onClose();
        } catch (error) {
          // 错误交回确认框，由框里显示（没权限时框关掉、外壳提示），不再另弹轻提示，免得同一句同屏两次。
          throw error;
        }
      }}
    />
  );
}

export type F5RecoveryRow = {
  key: string;
  /** 做的是什么：「冻结 CM-1024」「暂停 U00000012 的团队购买奖励」。 */
  name: string;
  /** 从什么到什么，写人话。 */
  change: ReactNode;
  /** 本机保存原请求的时间（毫秒）。 */
  submittedAt?: number;
  state: "unknown" | "pending" | "expired";
  /** 直接保存（异常预警标准）：没有审批单，提示不能说审批单。 */
  direct?: boolean;
  actions?: ReactNode;
};

/** 结果未知和待审批的原操作：逐条列出，按钮「查询原结果」「按原请求重试」由页面传。没有记录时不渲染。 */
export function F5RecoveryNotice({ rows }: { rows: readonly F5RecoveryRow[] }) {
  if (!rows.length) return null;
  const timed = rows.some((row) => row.submittedAt !== undefined);
  const tag = (state: F5RecoveryRow["state"], direct: boolean) => state === "unknown"
    ? <StatusTag tone="warn" icon={CircleHelp} explain={direct
      ? "提交时没收到结果，可能已经保存。查询只拿现在的标准作对照；24 小时内也可以按原请求重试，系统认得出是同一次提交。"
      : "提交时没收到结果，可能已经建了审批单。先查询原结果；24 小时内也可以按原请求重试，系统认得出是同一次提交，不会建第二张。"}>结果未知</StatusTag>
    : state === "pending"
      ? <StatusTag tone="warn" icon={Clock3} explain={`等${APPROVER}在「操作记录与审批」批准。批准前这笔奖励不变，同一对象不能再提交别的处置。`}>待审批</StatusTag>
      : <StatusTag tone="neutral" icon={Hourglass} explain={direct
        ? "原请求超过 24 小时，不能再重试。查询只看现在的标准，证明不了原操作有没有执行。"
        : "原请求超过 24 小时，不能再重试，只能查询原审批单。查询明确没有这张单时，可以解除待确认。"}>已过期</StatusTag>;
  return (
    <Notice tone="warn" title={<>{rows.every((row) => row.state === "pending") ? `${rows.length} 个处置在等批准` : `有 ${rows.length} 个处置还没有结论`}<Explain label="原操作怎么处理" content="这些处置提交时没收到确定结果，或还在等批准。有结论前不要换个办法重做同一件事。" /></>}>
      <ul className="f5-recovery" aria-label="还没有结论的处置">
        {rows.map((row) => (
          <li key={row.key} data-recovery-state={row.state}>
            <span className="f5-recovery-name">{row.name}</span>
            <span className="f5-recovery-change">{row.change}</span>
            <span className="f5-recovery-time">{row.submittedAt === undefined ? "" : `${businessStamp(row.submittedAt)} 提交`}</span>
            <span>{tag(row.state, !!row.direct)}</span>
            <span className="f5-recovery-actions">{row.actions}</span>
          </li>
        ))}
      </ul>
      {timed && <p className="f5-recovery-zone">提交时间为{businessZone().label}</p>}
    </Notice>
  );
}
