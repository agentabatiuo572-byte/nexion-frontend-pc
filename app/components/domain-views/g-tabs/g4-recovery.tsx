"use client";

/**
 * G4 原申请：参数修改、日分红调高、补发收益的原申请（待审批、结果未知、过期、已有结论待读回）逐条列出。
 * 只看本机保存的原记录，不依赖概览读取；按钮只查原审批单或按原请求重试，调用照临时组件 g-param-recovery 的写法。
 * 价格档位和首次日分红各有自己的原记录，页面把它们作为 extra 行传进来，按钮仍走各自原来的入口。
 */
import { useState, type ReactNode } from "react";
import { CircleHelp, Clock3, Hourglass } from "lucide-react";
import { Button, Change, Explain, Notice, StatusTag } from "@/app/components/rd";
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
  if (record.status === "unknown") return <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，可能已经建了审批单。先查询原审批单；24 小时内也可以按原请求重试，后端按原命令号去重，不会建第二张。">结果未知</StatusTag>;
  if (record.status === "pending") return <StatusTag tone="warn" icon={Clock3} explain={batch
    ? "等另一位在职超级管理员在「操作记录与审批」批准。批准前不付款；批准时后端按原批次的待付明细发放。"
    : "等另一位在职超级管理员在「操作记录与审批」批准。批准前参数不变。"}>待审批</StatusTag>;
  if (record.status === "expired") return <StatusTag tone="neutral" icon={Hourglass} explain="原请求超过 24 小时，不能再重试，只能查询原审批单。查不到也不能据此认定没提交。">已过期</StatusTag>;
  const label = { approved: "已批准", rejected: "已驳回", withdrawn: "已撤回" }[record.status];
  return <StatusTag tone="done" explain="原审批单已有结论。点「查询原审批单」读回当前值后，这条记录会清掉。">{label}</StatusTag>;
}

export type G4ExtraRecovery = { key: string; name: string; change: ReactNode; tag: ReactNode; action: ReactNode };

/**
 * 有原申请时在结论下面一条提醒；概览读取中、读取失败也显示。和参数行的「调整」是两条路：新修改被禁用时这里照样能用。
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
  const waiting = records.every((record) => record.status === "pending");
  return (
    <Notice tone="warn" title={<>{waiting && extra.length === 0 ? `${total} 项申请在等审批` : `${total} 项申请待确认`}
      <Explain label="原申请怎么处理" content={<>
        <p>这里列你在这台电脑上提交过、还没处理完的原申请：参数修改、每日收益比例、补发收益、价格档位。原申请只能查询原审批单，或在 24 小时内按原内容、原命令号重试，不能改值。</p>
        <p>补发收益按原批次号恢复，不会换成今天的批次。要改成别的值，等原申请有结论后再发起新修改。</p>
      </>} /></>}>
      <ul className="g4x-recover" aria-label="原申请">
        {records.map((record) => {
          const obj = record.request.obj;
          const batch = record.request.command.op === "g4_genesis_rerun_dividend";
          const params = record.request.command.params as { value?: unknown; expectedValue?: unknown };
          const name = batch ? "补发收益" : G4_PARAM_NAME[obj] ?? obj;
          const to = typeof params.value === "string" ? g4ParamValueText(obj, params.value) : "—";
          const from = typeof params.expectedValue === "string" ? g4ParamValueText(obj, params.expectedValue) : undefined;
          return (
            <li key={record.commandKey}>
              <span className="g4x-recover-name">{name}</span>
              <span className="g4x-recover-change">{batch
                ? <>批次 <span data-mono>{obj}</span></>
                : from ? <Change from={from} to={to} /> : <>申请改成 {to}</>}</span>
              <span className="g4x-recover-state">
                {g4RecoveryTag(record, batch)}
                {record.ticket && <span className="g4x-recover-ticket">审批单 <span data-mono>{record.ticket.id}</span></span>}
              </span>
              <span className="g4x-recover-actions">
                <Button size="sm" disabled={busy} aria-label={`查询${name}${batch ? ` ${obj}` : ""}的原审批单`} onClick={() => void recover(obj, false)}>查询原审批单</Button>
                {record.canRetry && <Button size="sm" disabled={busy} aria-label={`按原请求重试${name}${batch ? ` ${obj}` : ""}`} onClick={() => void recover(obj, true)}>按原请求重试</Button>}
              </span>
            </li>
          );
        })}
        {extra.map((row) => (
          <li key={row.key}>
            <span className="g4x-recover-name">{row.name}</span>
            <span className="g4x-recover-change">{row.change}</span>
            <span className="g4x-recover-state">{row.tag}</span>
            <span className="g4x-recover-actions">{row.action}</span>
          </li>
        ))}
      </ul>
    </Notice>
  );
}
