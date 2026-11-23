"use client";

/**
 * 改版页面里的支付安全，用户详情和专属会话共用。数据和详情弹窗沿用 PaymentSecurityDetail，这里只换外观：
 * 没事时收成一行，有异常、读取失败、有待确认的解除时展开并上色（DP-05、DP-04）。
 * 「有没有异常」交给页面，首屏的结论句和折叠组的摘要都要用（DP-03、PG-53）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { BlockState, Button, Fact, Facts, Fold, Notice, StatusTag } from "@/app/components/rd";
import { PaymentSecurityDetail, paymentSecurityStateText } from "./payment-security-card";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { PaymentPasswordApiError, pendingPaymentRelease, type PaymentSecurityPort } from "@/lib/admin/payment-password-client";
import type { PaymentSecurityRecord, PaymentSecuritySummary } from "@/lib/admin/payment-password-contract";
import { useAdminAuth } from "@/lib/store/admin-auth";

export type PaymentSecurityState = "loading" | "failed" | "denied" | "clear" | "exception";

const message = (failure: unknown) => failure instanceof Error ? failure.message : "支付安全信息未确认，请重新加载。";
const actionText = (record: PaymentSecurityRecord) => record.type === "PAYMENT_PASSWORD_EXCEPTION" ? "解除异常标记" : "解除锁定";
const stateText = (record: PaymentSecurityRecord) => record.type === "UNSUPPORTED" ? "异常类型未确认"
  : record.state === "ACTIVE" && record.type === "PAYMENT_PASSWORD_EXCEPTION" ? "待核查" : paymentSecurityStateText[record.state];

function stateTag(record: PaymentSecurityRecord) {
  if (record.type === "UNSUPPORTED") return <StatusTag tone="done">{stateText(record)}</StatusTag>;
  if (record.state === "ACTIVE") return <StatusTag tone="warn">{stateText(record)}</StatusTag>;
  return <StatusTag tone={record.state === "RELEASED" ? "ok" : "done"}>{stateText(record)}</StatusTag>;
}

export function PaymentSecurityBlock({ port, userLabel, reloadKey = 0, canRelease, retryMissingRelease, onState }: {
  port: PaymentSecurityPort;
  userLabel: string;
  /** 页面刷新时变，这一块跟着重读。 */
  reloadKey?: number | string;
  /** 有独立解除权限才给入口（OP-124）。能不能解除这一条还看后端 capability。 */
  canRelease: boolean;
  retryMissingRelease?: boolean;
  onState?: (state: PaymentSecurityState, pending: boolean) => void;
}) {
  const session = useAdminAuth((state) => state.session), epoch = useAdminAuth((state) => state.authEpoch);
  const [summary, setSummary] = useState<PaymentSecuritySummary | null>(null);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<{ id: string; release: boolean } | null>(null);
  const generation = useRef(0);
  const owner = session?.adminId ?? 0;
  const load = useCallback(async () => {
    const id = ++generation.current;
    setSummary(null); setError(""); setLoading(true); setPending(!!pendingPaymentRelease(owner, port.userId));
    try {
      const next = await port.summary();
      if (id === generation.current) { setSummary(next); setDenied(false); }
    } catch (failure) {
      if (id === generation.current) {
        if (failure instanceof PaymentPasswordApiError && failure.status === 403) {
          setSelected(null);
          setDenied(true);
        } else setError(message(failure));
      }
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, [port, owner, epoch]);
  useEffect(() => {
    if (owner) void load();
    const refresh = () => { void load(); };
    window.addEventListener("nexion-payment-security-updated", refresh);
    return () => { generation.current++; window.removeEventListener("nexion-payment-security-updated", refresh); };
  }, [load, owner, reloadKey]);
  const record = summary?.record;
  // 状态未确认的记录不算没事。
  const state: PaymentSecurityState = error ? "failed" : denied ? "denied" : loading ? "loading" : record?.state === "UNKNOWN" ? "failed" : record?.state === "ACTIVE" ? "exception" : "clear";
  const showPending = pending && !denied;
  useEffect(() => { onState?.(state, showPending); }, [onState, state, showPending]);
  if (!session) return null;
  const line = error ? "加载失败" : denied ? "· 无权限" : loading ? "正在读取…" : record ? stateText(record) : "支付密码无异常";
  return (
    <>
      <Fold inset title="支付安全" alert={state === "exception" || state === "failed" || showPending} alertTone={error ? "danger" : "warn"} summary={line}
        explain={<><p>支付密码仅用于钱包余额付款。HDPay 银行直付和 USDT-BSC / ERC20 链上直付无需支付密码，不受此锁定影响。</p>{record && <p>解除只处理本条支付密码异常，登录状态不受影响。</p>}</>}
        actions={!denied && !error && <Button size="sm" aria-label="刷新支付安全" icon={<RefreshCcw size={13} aria-hidden />} loading={loading} onClick={() => void load()}>刷新</Button>}>
        <div className="rd-detail-block">
          {error ? <BlockState state="error" compact title={error} onRetry={() => void load()} /> : denied && <BlockState state="denied" compact title="无权限" />}
          {record && <>
            <Facts>
              <Fact k="当前状态">{stateTag(record)}</Fact>
              <Fact k="异常原因">{record.reason}</Fact>
              {record.lockedUntil && <Fact k="原锁定至">{formatBusinessTimeCompact(record.lockedUntil, "暂无记录")}</Fact>}
            </Facts>
            <div className="rd-toolbar">
              <Button size="sm" onClick={() => setSelected({ id: record.id, release: false })}>查看详情</Button>
              {record.state === "ACTIVE" && canRelease && <Button size="sm" variant="primary"
                disabledReason={pending ? "有一笔解除结果未知，先查询原结果" : record.capabilities.releaseAllowed ? undefined : record.capabilities.disabledReason || "现在不能解除"}
                onClick={() => setSelected({ id: record.id, release: true })}>{actionText(record)}</Button>}
            </div>
            {record.state === "ACTIVE" && canRelease && !pending && !record.capabilities.releaseAllowed && <p className="rd-toolbar-note">{record.capabilities.disabledReason || "现在不能解除"}</p>}
          </>}
          {summary && !record && <p className="rd-detail-empty">历史处置记录仍保留。</p>}
          {summary && <p className="rd-toolbar-note">查询时间 {formatBusinessTimeCompact(summary.observedAt, "暂无记录")}</p>}
          {showPending && <Notice tone="warn" title="有一笔解除结果未知。"
            action={<Button size="sm" onClick={() => { const row = pendingPaymentRelease(owner, port.userId); if (row) setSelected({ id: row.recordId, release: false }); }}>查询原结果</Button>} />}
        </div>
      </Fold>
      {selected && <PaymentSecurityDetail key={`${port.key}:${owner}:${epoch}:${selected.id}`} port={port} recordId={selected.id} userLabel={userLabel} initialAction={selected.release} retryMissingRelease={retryMissingRelease} onClose={() => { setSelected(null); setPending(!!pendingPaymentRelease(owner, port.userId)); }} />}
    </>
  );
}
