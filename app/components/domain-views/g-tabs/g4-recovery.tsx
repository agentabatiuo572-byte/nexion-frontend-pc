"use client";

/**
 * G4 原申请：参数修改、日分红调高、补发收益的原申请（待审批、结果未知、过期、已有结论待读回）逐条列出。
 * 只看本机保存的原记录，不依赖概览读取；按钮只查原审批单或按原操作重试，调用照临时组件 g-param-recovery 的写法。
 * 价格档位和首次日分红各有自己的原记录，页面把它们作为 extra 行传进来，按钮仍走各自原来的入口。
 */
import { useState, type ReactNode } from "react";
import { Button, Change } from "@/app/components/rd";
import { expiredTag, GRecoveryNotice, GRejectedRelease, GReplayRejectionNote, pendingTag, resolvedTag, unknownTag, type GRecoveryRow } from "./g-recovery";
import { recoveryTitle } from "../recovery-panel";
import { rejectedTag } from "../verified-release";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { A2OperationRow } from "@/lib/admin/a2-client";
import { divBaseFormulaText, G_PARAM_APPROVAL_RECOVERY, G_PARAM_RECOVERY } from "@/lib/admin/operator-copy";
import { gParamApprovalFeedback, type GParamRecovery, type useGParamApproval } from "@/lib/admin/use-g-param-approval";
import { amountDisplay } from "@/lib/format";

/** 九个参数在这页的固定叫法（和参数行、确认框标题一致）。 */
export const G4_PARAM_NAME: Record<string, string> = {
  supply: "节点总量",
  price: "系列当前价（分红计价）",
  dividend: "每日收益比例",
  royalty: "内部转售手续费",
  airdropPct: "空投占比",
  emissionCurve: "收益发放曲线",
  airdropLockDays: "早期持有人奖励锁仓期",
  divBase: "收益计算基数",
  showcaseEnabled: "App 商城展示",
};

/** 金额按全站写法（amountDisplay）：去掉末尾 0、整数不写小数点，带千分位；不舍入。数字保留原来的上限 6 位。 */
export function g4Amount(value: number | string) {
  if (typeof value === "number") return Number.isFinite(value) ? amountDisplay(value, 6, "fixed") : "—";
  const text = value.trim();
  return /^-?\d+(?:\.\d+)?$/.test(text) ? amountDisplay(text) : value || "—";
}

/** 百分数、比例：去掉补的 0，不补位。 */
export function g4Plain(value: string) {
  const text = value.trim();
  return /^-?\d+\.\d+$/.test(text) ? text.replace(/\.?0+$/, "") : text;
}

/** 参数值的写法：写单位，不用 $；空值写「未设置」。 */
export function g4ParamValueText(key: string, raw: string | undefined) {
  const value = (raw ?? "").trim();
  if (key === "showcaseEnabled") return value === "true" ? "展示中" : value === "false" ? "已隐藏" : value || "—";
  if (!value) return key === "divBase" || key === "emissionCurve" ? "未设置" : "—";
  if (key === "supply") return /^\d+$/.test(value) ? `${BigInt(value).toLocaleString("en-US")} 张` : value;
  if (key === "price") return `${g4Amount(value)} USDT`;
  if (key === "dividend") return `${g4Plain(value)}% / 日`;
  if (key === "royalty" || key === "airdropPct") return `${g4Plain(value)}%`;
  if (key === "airdropLockDays") return `${value} 天`;
  if (key === "divBase") return divBaseFormulaText(value);
  return value.replace("TGE 10% · halve every 6 months", "初始发放 10%，每 6 个月减半");
}

/** 每日收益比例的调高申请在等批准时，仍可直接调低（立即生效）；调低后原申请批准时后端按当前值已变拒绝。其他参数待审批时调高调低都改不了。 */
export const G4_DIVIDEND_PENDING_NOTE = "批准前仍是原比例；这期间仍可以把比例调低，调低立即生效，原调高申请批准时会因为比例变了被拒绝。";

export function g4RecoveryTag(record: Pick<GParamRecovery, "ticket" | "retryExpired" | "replayRejection">, batch = false, obj?: string) {
  if (record.replayRejection && !record.ticket) return rejectedTag();
  // 和 G2、G7 同一判断：读到审批单就按审批单，在等批是待审批，批准、驳回、撤回、过期都是已有结论；没有审批单才是结果未知，过了 24 小时只是不能再重试。
  if (record.ticket) return record.ticket.status === "pending" ? pendingTag(batch ? "批准前不付款；批准时按原批次的待付明细发放。"
    : obj === "dividend" ? G4_DIVIDEND_PENDING_NOTE : "批准前参数不变；这一项被审批锁住，调高调低都改不了。") : resolvedTag(record.ticket.status);
  return record.retryExpired ? expiredTag("approval") : unknownTag("approval", G_PARAM_APPROVAL_RECOVERY);
}

export const G4_FIRST_DIVIDEND_TICKET_STATUS = { pending: "待审批", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" } as const;

export type G4ExtraRecovery = { key: string; name: string; change: ReactNode; tag: ReactNode; action: ReactNode; submittedAt?: number; ticket?: A2OperationRow };

/**
 * 有原申请时在结论下面一条提醒；概览读取中、读取失败也显示。和参数行的「调整」是两条路：新修改被禁用时这里照样能用。
 * 排版是 G 域五页共用的原操作列表（g-recovery.tsx）。
 */
export function G4RecoveryNotice({ approval, toast, extra = [] }: {
  approval: ReturnType<typeof useGParamApproval>;
  toast: (message: string) => void;
  extra?: G4ExtraRecovery[];
}) {
  const [busy, setBusy] = useState(false);
  const records = approval.list();
  if (records.length === 0 && extra.length === 0) return null;
  const recover = async (obj: string, retry: boolean) => {
    setBusy(true);
    try {
      if (retry) await approval.retry(obj);
      else if (!await approval.query(obj)) toast("暂未查到原审批单，原记录继续保留。");
    } catch (error) {
      toast(gParamApprovalFeedback(error) ?? displayAdminError(error));
    } finally {
      setBusy(false);
    }
  };
  const total = records.length + extra.length;
  // 标题和每行的标签同一个判断（g4RecoveryTag）：读到审批单的按审批单算在等审批或已有结论，没有审批单的才算结果未知。
  const tickets = [...records.map((record) => record.ticket), ...extra.map((row) => row.ticket)];
  const waitingCount = tickets.filter((ticket) => ticket?.status === "pending").length;
  const endedCount = tickets.filter((ticket) => ticket && ticket.status !== "pending").length;
  const waiting = waitingCount === total;
  // 待审批的参数里，每日收益比例是例外：仍可直接调低。其余有待审批申请的参数调高调低都改不了。
  const dividendWaiting = records.some((record) => record.request.obj === "dividend" && record.ticket?.status === "pending");
  const lockedWaiting = records.some((record) => record.request.obj !== "dividend" && record.request.command.op !== "g4_genesis_rerun_dividend" && record.ticket?.status === "pending");
  const waitingLead = dividendWaiting && !lockedWaiting
    ? "批准前每日收益比例不变；这期间仍可以把比例调低（立即生效），调低后原调高申请批准时会被拒绝。其他参数照常可改。"
    : dividendWaiting
      ? "批准前这几项不变。有待审批申请的参数调高调低都改不了，只有每日收益比例仍可调低（立即生效，原调高申请批准时会被拒绝）；其他参数照常可改。"
      : "批准前这几项不变；有待审批申请的参数调高调低都改不了，其他参数照常可改。";
  const rows: GRecoveryRow[] = [
    ...records.map((record) => {
      const obj = record.request.obj;
      const batch = record.request.command.op === "g4_genesis_rerun_dividend";
      const params = record.request.command.params as { value?: unknown; expectedValue?: unknown };
      const name = batch ? "补发收益" : G4_PARAM_NAME[obj] ?? obj;
      const to = typeof params.value === "string" ? g4ParamValueText(obj, params.value) : "—";
      // A2 exposes the bound G4 snapshot as "series · parameter = value" or "series=…; dividend=value".
      const ticketBefore = obj === "dividend" ? record.ticket?.before.match(/^series=.+?; dividend=(.*)$/)?.[1]
        : record.ticket?.before.match(/^.+? · [^=]+ =\s*(.*)$/)?.[1];
      const before = ticketBefore ?? params.expectedValue;
      const from = typeof before === "string" ? g4ParamValueText(obj, before) : undefined;
      const change = batch ? <>批次 <span data-mono>{obj}</span></> : from ? <Change from={from} to={to} /> : <>申请改成 {to}</>;
      const rejected = record.replayRejection && !record.ticket;
      return {
        key: record.commandKey, name, submittedAt: record.createdAt, tag: g4RecoveryTag(record, batch, obj), ticket: record.ticket?.id,
        change: <>{change}{rejected && <GReplayRejectionNote record={record} />}</>,
        actions: <>
          <Button size="sm" disabled={busy} aria-label={`查询${name}${batch ? ` ${obj}` : ""}的原操作`} onClick={() => void recover(obj, false)}>查询原操作</Button>
          {record.canRetry && <Button size="sm" disabled={busy} aria-label={`按原操作重试${name}${batch ? ` ${obj}` : ""}`} onClick={() => void recover(obj, true)}>按原操作重试</Button>}
          {rejected && <GRejectedRelease record={record} name={name} target={change} disabled={busy} toast={toast}
            getSnapshot={() => approval.rejectedSnapshot(record)} release={() => approval.releaseRejected(record)} />}
        </>,
      };
    }),
    ...extra.map((row) => ({ key: row.key, name: row.name, change: row.change, tag: row.tag, actions: row.action, submittedAt: row.submittedAt, ticket: row.ticket?.id })),
  ];
  return <GRecoveryNotice label="原操作" rows={rows}
    title={recoveryTitle(total - waitingCount - endedCount, waitingCount, endedCount)}
    lead={waiting ? waitingLead : `走审批的先查询原操作，查无且符合条件才可重试。直接修改可读取当前配置核对。记录清掉之前不能改成别的值${dividendWaiting ? "（每日收益比例的调高申请在等批准时，仍可直接调低）" : ""}。其他参数照常可改。`}
    explain={<>
      <p>这里列你在这台电脑上提交过、还没处理完的参数修改、每日收益比例、补发收益和价格档位。{G_PARAM_RECOVERY}现在的配置值证明不了原直接修改是否生效。</p>
      <p>补发收益按原批次号恢复，不会换成今天的批次。要改成别的值，等原操作有结论、这条记录清掉后再发起新修改{dividendWaiting ? "（每日收益比例的调高申请在等批准时，仍可直接调低）" : ""}。</p>
    </>} />;
}
