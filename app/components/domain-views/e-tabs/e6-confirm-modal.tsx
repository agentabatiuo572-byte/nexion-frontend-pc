"use client";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { compareEditDecimals, OperationConfirmModal } from "../design-kit";
import { RotateCcw } from "lucide-react";
import { Button, Notice } from "@/app/components/rd";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isPermissionDenied, operationConfirmErrorMessage } from "@/lib/admin/operation-confirm-error";
import { isE6VerifiedDraft } from "@/lib/admin/e6-command";
import { useE6Mutations, type E6WriteReceipt } from "./e6-mutations";

/** E6 owns its funding explanation and persisted-command recovery feedback. */
export function E6ConfirmModal({ scope, amplificationBasis, onRecovered, onBack, refusal, ...props }: ComponentProps<typeof OperationConfirmModal> & {
  scope: string;
  /** 首次提交被明确拒绝后点「返回修改」：有上一步的框回到上一步；不传就留在这个框里改。 */
  onBack?: () => void;
  refusal?: { message: string; retryRead?: () => void; reading?: boolean };
  amplificationBasis?: ReactNode | ((value?: string) => ReactNode);
  onRecovered?: (result?: E6WriteReceipt) => void | Promise<void>;
}) {
  const m = useE6Mutations();
  const [unknown, setUnknown] = useState(false);
  // 首次提交被明确拒绝、没留原记录：同一份输入再点也会被拒，按钮停住，给「返回修改」。
  const [refused, setRefused] = useState<string>();
  const record = m.pending.find(r => r.scope === scope);
  const originalKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    const key = originalKey.current;
    const settlement = key && m.settledByKey[key];
    if (settlement) {
      originalKey.current = undefined;
      if (settlement.result && onRecovered) void onRecovered(settlement.result);
      else props.onClose();
    } else if (key && m.records.some(item => item.commandKey === key && isE6VerifiedDraft(item))) {
      originalKey.current = undefined;
      props.onClose();
    } else if (record && !key) {
      originalKey.current = record.commandKey;
    }
  }, [record, m.records, m.settledByKey, props.onClose, onRecovered]);
  const rejected = !!record && m.rejected.includes(record.commandKey);
  const refusalMessage = refusal?.message ?? refused;
  const blockedReason = props.blockedReason ?? (rejected ? "按原操作重试被明确拒绝，请关闭窗口，核对后解除这条记录。"
    : refusalMessage ? <span className="rd-toolbar"><span>{refusalMessage}</span><Button size="sm" icon={<RotateCcw size={14} aria-hidden />} loading={refusal?.reading} onClick={refusal?.retryRead ?? (() => { setRefused(undefined); onBack?.(); })}>{refusal?.retryRead ? "重新读取" : "返回修改"}</Button></span> : undefined);
  const facts = (value?: string) => {
    const direction = props.edit?.amplifiesWhen;
    const decimalDirection = compareEditDecimals(value ?? "", props.edit?.current ?? "");
    const amplifies = typeof direction === "function" ? !!value && direction(value)
      : typeof direction === "object" ? props.edit?.current === direction.from && value === direction.to
      : direction ? decimalDirection !== undefined && (direction === "decrease" ? decimalDirection < 0 : decimalDirection > 0)
      : !!props.amplifies;
    return <div className="e6-confirm-facts">
      {typeof props.facts === "function" ? props.facts(value) : props.facts}
      {amplifies && <Notice tone="warn" title="这项操作会让平台多付钱">
        <div className="e6-fold-content">{typeof amplificationBasis === "function" ? amplificationBasis(value) : amplificationBasis}</div>
        <p>{props.coverageCheck ?? "批准时检查兑付覆盖率。"}</p>
      </Notice>}
      {unknown && !blockedReason && <Notice tone="warn" title="结果未知">原内容和理由已保存。可以关掉窗口查询原操作，也可以按原操作重试；重试发的是同一份原请求。</Notice>}
    </div>;
  };
  return <OperationConfirmModal {...props} facts={facts} amplifies={false}
    edit={props.edit ? { ...props.edit, amplifiesWhen: undefined } : undefined}
    getPendingRecovery={() => {
      if (!record) return;
      const state = m.recovery.state(record);
      return { state, expiresAt: state.expiresAt, subscribe: m.recovery.subscribe, getRevision: m.recovery.getRevision,
        query: async () => { if (record.payload.kind === "proposal") await m.check(record.commandKey); else await m.checkDirect(record); } };
    }}
    getPendingReason={props.getPendingReason ?? (() => m.pendingReason(scope))}
    blockedReason={blockedReason} confirmLabel={unknown ? "按原操作重试" : props.confirmLabel}
    onConfirm={async (...args) => {
      if (originalKey.current && m.settledByKey[originalKey.current]) return;
      setUnknown(false);
      try {
        if (unknown && record && onRecovered) {
          originalKey.current = record.commandKey;
          const result = await m.send(record, true);
          if (originalKey.current === record.commandKey) {
            originalKey.current = undefined;
            await onRecovered(result);
          }
        } else await props.onConfirm(...args);
      }
      catch (failure) {
        // A durable original command is the recovery boundary. Permission failures
        // and authoritative rejections still use the shared error handling.
        if (!isExplicitRejection(failure) && !isPermissionDenied(failure) && m.pendingReason(scope) !== undefined) {
          setUnknown(true);
          return;
        }
        if (isExplicitRejection(failure) && m.pendingReason(scope) === undefined) setRefused(operationConfirmErrorMessage(failure));
        throw failure;
      }
    }}/>;
}
