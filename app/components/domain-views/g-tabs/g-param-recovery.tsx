"use client";

import { useState } from "react";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { useGParamApproval } from "@/lib/admin/use-g-param-approval";

/** Original-operation controls depend only on saved records, including old batches. */
export function GParamRecovery({ approval, toast, labelOf }: {
  approval: ReturnType<typeof useGParamApproval>;
  toast: (message: string) => void;
  /** 参数键换成页面上的参数名；没给或找不到时写「这项参数」，不显示内部键名。 */
  labelOf?: (key: string) => string | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const records = approval.list();
  const states = {
    unknown: ["结果未确认", "warn", "没收到系统回复，不知道审批单建没建成。先查询；查不到再按原请求重试，不会重复建单。"],
    pending: ["待审批", "warn", "另一位有审批批准权限的超级管理员批准前，当前值不变。"],
    expired: ["已超过 24 小时", "dim", "不能再按原请求重发，只能查询原审批单的结果。"],
    approved: ["已批准", "ok", "查询一次即可读回当前值并收起这一条。"],
    rejected: ["已驳回", "dim", "当前值没有改。查询一次即可收起这一条。"],
    withdrawn: ["已撤回", "dim", "当前值没有改。查询一次即可收起这一条。"],
  } as const;
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
  return <>{records.map(record => {
    const params = record.request.command.params as Record<string, unknown>;
    const batch = typeof params.batchNo === "string" ? params.batchNo : undefined;
    const name = batch ? `补发收益 · 批次 ${batch}` : labelOf?.(record.request.obj) ?? "这项参数";
    const [label, tone, hint] = states[record.status];
    return <div className="gtint" role="status" key={record.commandKey}
      style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
      <span style={{ flex: "1 1 320px", minWidth: 0 }}>
        <b>审批中的修改</b> · {name}
        {!batch && params.value !== undefined && <> · 申请改成 <b>{String(params.value)}</b>{params.expectedValue !== undefined && <>（提交时为 {String(params.expectedValue)}）</>}</>}
        {" "}<span className={`bdg ${tone}`}>{label}</span>
        <br /><span style={{ color: "var(--ink-3)" }}>{hint}</span>
      </span>
      <span style={{ display: "flex", gap: 6 }}>
        <button type="button" className="l-btn sm" disabled={busy} aria-label={`查询审批结果 · ${name}`} onClick={() => void recover(record.request.obj, false)}>查询审批结果</button>
        {record.canRetry && <button type="button" className="l-btn sm" disabled={busy} aria-label={`按原请求重试 · ${name}`} onClick={() => void recover(record.request.obj, true)}>按原请求重试</button>}
      </span>
    </div>;
  })}</>;
}
