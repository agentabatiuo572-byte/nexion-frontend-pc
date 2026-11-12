"use client";

/**
 * G4 原申请：参数修改、日分红调高、补发收益的原申请（待审批、结果未知、过期、已有结论待读回）逐条列出。
 * 只看本机保存的原记录，不依赖概览读取；按钮只查原审批单或按原请求重试，调用照临时组件 g-param-recovery 的写法。
 * 价格档位和首次日分红各有自己的原记录，页面把它们作为 extra 行传进来，按钮仍走各自原来的入口。
 */
import { useState, type ReactNode } from "react";
import { Button, Change } from "@/app/components/rd";
import { expiredTag, GRecoveryNotice, pendingTag, resolvedTag, unknownTag, type GRecoveryRow } from "./g-recovery";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { GParamRecovery, useGParamApproval } from "@/lib/admin/use-g-param-approval";

/** 九个参数在这页的固定叫法（和参数行、确认框标题一致）。 */
export const G4_PARAM_NAME: Record<string, string> = {
  supply: "节点总量",
  price: "单价",
  dividend: "每日收益比例",
  royalty: "转让手续费",
  airdropPct: "空投占比",
  emissionCurve: "收益发放曲线",
  airdropLockDays: "早期持有人奖励锁仓期",
  divBase: "收益计算基数",
  showcaseEnabled: "App 商城入口",
};

/** 去掉补的 0，至少两位小数，带千分位；不舍入。 */
export function g4Amount(value: number | string) {
  const text = typeof value === "number" ? (Number.isFinite(value) ? value.toFixed(6) : "") : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return typeof value === "number" ? "—" : value || "—";
  const fraction = (match[3] ?? "").replace(/0+$/, "").padEnd(2, "0");
  return `${match[1]}${BigInt(match[2]).toLocaleString("en-US")}.${fraction}`;
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
  return value.replace("TGE 10% · halve every 6 months", "初始发放 10%，每 6 个月减半");
}

export function g4RecoveryTag(record: Pick<GParamRecovery, "status">, batch = false) {
  if (record.status === "unknown") return unknownTag("approval");
  if (record.status === "pending") return pendingTag(batch ? "批准前不付款；批准时后端按原批次的待付明细发放。" : "批准前参数不变。");
  if (record.status === "expired") return expiredTag("approval");
  return resolvedTag(record.status);
}

export type G4ExtraRecovery = { key: string; name: string; change: ReactNode; tag: ReactNode; action: ReactNode; submittedAt?: number };

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
      toast(displayAdminError(error));
    } finally {
      setBusy(false);
    }
  };
  const total = records.length + extra.length;
  const waiting = extra.length === 0 && records.every((record) => record.status === "pending");
  const rows: GRecoveryRow[] = [
    ...records.map((record) => {
      const obj = record.request.obj;
      const batch = record.request.command.op === "g4_genesis_rerun_dividend";
      const params = record.request.command.params as { value?: unknown; expectedValue?: unknown };
      const name = batch ? "补发收益" : G4_PARAM_NAME[obj] ?? obj;
      const to = typeof params.value === "string" ? g4ParamValueText(obj, params.value) : "—";
      const from = typeof params.expectedValue === "string" ? g4ParamValueText(obj, params.expectedValue) : undefined;
      return {
        key: record.commandKey, name, submittedAt: record.createdAt, tag: g4RecoveryTag(record, batch), ticket: record.ticket?.id,
        change: batch ? <>批次 <span data-mono>{obj}</span></> : from ? <Change from={from} to={to} /> : <>申请改成 {to}</>,
        actions: <>
          <Button size="sm" disabled={busy} aria-label={`查询${name}${batch ? ` ${obj}` : ""}的原结果`} onClick={() => void recover(obj, false)}>查询原结果</Button>
          {record.canRetry && <Button size="sm" disabled={busy} aria-label={`按原请求重试${name}${batch ? ` ${obj}` : ""}`} onClick={() => void recover(obj, true)}>按原请求重试</Button>}
        </>,
      };
    }),
    ...extra.map((row) => ({ key: row.key, name: row.name, change: row.change, tag: row.tag, actions: row.action, submittedAt: row.submittedAt })),
  ];
  return <GRecoveryNotice label="原操作" rows={rows}
    title={`${waiting ? "在等审批的原申请" : "还没有结论的原操作"} · ${total} 项`}
    lead={waiting ? "批准前这几项不变；这一项被审批锁住，其他参数照常可改。" : "这些操作先只能查询原结果或按原请求重试，不能改成别的值；其他照常可改。"}
    explain={<>
      <p>这里列你在这台电脑上提交过、还没处理完的原操作：参数修改、每日收益比例、补发收益、价格档位，以及直接生效但没收到结果的修改。原操作只能查询，或在 24 小时内按原内容重试，不能改值。</p>
      <p>补发收益按原批次号恢复，不会换成今天的批次。要改成别的值，等原操作有结论后再发起新修改。</p>
    </>} />;
}
