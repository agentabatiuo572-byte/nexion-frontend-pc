"use client";
import { useState, type ComponentProps, type ReactNode } from "react";
import { OperationConfirmModal } from "../design-kit";
import { Notice } from "@/app/components/rd";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { useE6Mutations, type E6WriteReceipt } from "./e6-mutations";

/** E6 owns its funding explanation and persisted-command recovery feedback. */
export function E6ConfirmModal({ scope, amplificationBasis, onRecovered, ...props }: ComponentProps<typeof OperationConfirmModal> & {
  scope: string;
  amplificationBasis?: ReactNode | ((value?: string) => ReactNode);
  onRecovered?: (result?: E6WriteReceipt) => void | Promise<void>;
}) {
  const m = useE6Mutations();
  const [unknown, setUnknown] = useState(false);
  const record = m.pending.find(r => r.scope === scope);
  const rejected = !!record && m.rejected.includes(record.commandKey);
  const blockedReason = props.blockedReason ?? (rejected ? "按原请求重试被明确拒绝，请关闭窗口，核对后解除这条记录。" : undefined);
  const facts = (value?: string) => {
    const direction = props.edit?.amplifiesWhen;
    const amplifies = typeof direction === "function" ? !!value && direction(value)
      : typeof direction === "object" ? props.edit?.current === direction.from && value === direction.to
      : direction ? !!value && Number.isFinite(Number(value)) && (direction === "decrease" ? Number(value) < Number(props.edit?.current) : Number(value) > Number(props.edit?.current))
      : !!props.amplifies;
    return <div className="e6-confirm-facts">
      {typeof props.facts === "function" ? props.facts(value) : props.facts}
      {amplifies && <Notice tone="warn" title="这项操作会让平台多付钱">
        <div className="e6-fold-content">{typeof amplificationBasis === "function" ? amplificationBasis(value) : amplificationBasis}</div>
        <p>{props.coverageCheck ?? "批准时检查兑付覆盖率。"}</p>
      </Notice>}
      {unknown && !blockedReason && <Notice tone="warn" title="结果未知">原内容和理由已保存。可以关掉窗口查询原结果，也可以按原请求重试；重试发的是同一份原请求。</Notice>}
    </div>;
  };
  return <OperationConfirmModal {...props} facts={facts} amplifies={false}
    edit={props.edit ? { ...props.edit, amplifiesWhen: undefined } : undefined}
    getPendingReason={props.getPendingReason ?? (() => m.pendingReason(scope))}
    blockedReason={blockedReason} confirmLabel={unknown ? "按原请求重试" : props.confirmLabel}
    onConfirm={async (...args) => {
      setUnknown(false);
      try {
        if (unknown && record && onRecovered) {
          const result = await m.send(record, true);
          await onRecovered(result);
        } else await props.onConfirm(...args);
      }
      catch (failure) {
        // A durable original command is the recovery boundary. Permission failures
        // and authoritative rejections still use the shared error handling.
        if (!isExplicitRejection(failure) && !isPermissionDenied(failure) && m.pendingReason(scope) !== undefined) {
          setUnknown(true);
          return;
        }
        throw failure;
      }
    }}/>;
}
