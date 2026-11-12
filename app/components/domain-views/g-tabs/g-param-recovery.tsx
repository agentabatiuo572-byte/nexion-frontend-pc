"use client";

import { useState } from "react";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { useGParamApproval } from "@/lib/admin/use-g-param-approval";

/** Original-operation controls depend only on saved records, including old batches. */
export function GParamRecovery({ approval, toast }: {
  approval: ReturnType<typeof useGParamApproval>;
  toast: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const records = approval.list();
  const labels = { unknown: "结果未知", pending: "待审批", expired: "已过期", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回" };
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
  return <>{records.map(record => <div className="gtint" key={record.commandKey}>
    <span>原操作 · {record.request.action} · {record.request.obj} · {labels[record.status]}</span>{" "}
    <button type="button" className="l-btn sm" disabled={busy} onClick={() => void recover(record.request.obj, false)}>查询原操作 {record.request.obj}</button>{" "}
    {record.canRetry && <button type="button" className="l-btn sm" disabled={busy} onClick={() => void recover(record.request.obj, true)}>重试原操作 {record.request.obj}</button>}
  </div>)}</>;
}
