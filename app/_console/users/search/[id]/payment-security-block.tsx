"use client";

/**
 * 用户详情里的支付安全。数据和详情弹窗沿用 PaymentSecurityDetail，这里只换成改版外观，
 * 把「有没有异常」交给页面，首屏的结论句和折叠组的摘要都要用（DP-03、PG-53）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard } from "lucide-react";
import { BlockState, Button, Fact, Facts, Notice, Panel, StatusTag } from "@/app/components/rd";
import { PaymentSecurityDetail, paymentSecurityStateText } from "@/app/components/payment-security/payment-security-card";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { pendingPaymentRelease, type PaymentSecurityPort } from "@/lib/admin/payment-password-client";
import type { PaymentSecurityRecord, PaymentSecuritySummary } from "@/lib/admin/payment-password-contract";
import { useAdminAuth } from "@/lib/store/admin-auth";

export type PaymentSecurityState = "loading" | "failed" | "clear" | "exception";

const message = (failure: unknown) => failure instanceof Error ? failure.message : "支付安全信息未确认，请重新加载。";
const actionText = (record: PaymentSecurityRecord) => record.type === "PAYMENT_PASSWORD_EXCEPTION" ? "解除异常标记" : "解除锁定";

function stateTag(record: PaymentSecurityRecord) {
  if (record.type === "UNSUPPORTED") return <StatusTag tone="done">异常类型未确认</StatusTag>;
  if (record.state === "ACTIVE") return <StatusTag tone="warn">{record.type === "PAYMENT_PASSWORD_EXCEPTION" ? "待核查" : paymentSecurityStateText.ACTIVE}</StatusTag>;
  return <StatusTag tone={record.state === "RELEASED" ? "ok" : "done"}>{paymentSecurityStateText[record.state]}</StatusTag>;
}

export function PaymentSecurityBlock({ port, userLabel, reloadKey, canRelease, onState }: {
  port: PaymentSecurityPort;
  userLabel: string;
  /** 页面刷新时变，这一块跟着重读。 */
  reloadKey: number;
  /** 有独立解除权限才给入口（OP-124）。能不能解除这一条还看后端 capability。 */
  canRelease: boolean;
  onState: (state: PaymentSecurityState, pending: boolean) => void;
}) {
  const session = useAdminAuth((state) => state.session), epoch = useAdminAuth((state) => state.authEpoch);
  const [summary, setSummary] = useState<PaymentSecuritySummary | null>(null);
  const [error, setError] = useState("");
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
      if (id === generation.current) setSummary(next);
    } catch (failure) {
      if (id === generation.current) setError(message(failure));
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
  const state: PaymentSecurityState = loading ? "loading" : error || record?.state === "UNKNOWN" ? "failed" : record?.state === "ACTIVE" ? "exception" : "clear";
  useEffect(() => { onState(state, pending); }, [onState, state, pending]);
  if (!session) return null;
  return (
    <Panel plain headingLevel={3} aria-label="支付安全" title="支付安全" icon={CreditCard} tone="role-3"
      sub={summary ? `查询时间 ${formatBusinessTimeCompact(summary.observedAt, "暂无记录")}` : "信息尚未确认"}
      explain={<><p>支付密码仅用于钱包余额付款。HDPay 银行直付和 USDT-BSC / ERC20 链上直付无需支付密码，不受此锁定影响。</p>{record && <p>解除只处理本条支付密码异常，登录状态不受影响。</p>}</>}
      actions={!error && <Button size="sm" loading={loading} loadingText="读取中…" onClick={() => void load()}>重新加载</Button>}>
      <div className="rd-detail-block">
        {loading && <BlockState state="loading" compact title="正在读取支付安全信息…" />}
        {error && <BlockState state="error" compact title={error} retryLabel="重试查询" onRetry={() => void load()} />}
        {record && <>
          <Facts>
            <Fact k="当前状态">{stateTag(record)}</Fact>
            <Fact k="异常原因">{record.reason}</Fact>
            <Fact k="原锁定至">{formatBusinessTimeCompact(record.lockedUntil, "暂无记录")}</Fact>
          </Facts>
          <div className="rd-toolbar">
            <Button size="sm" onClick={() => setSelected({ id: record.id, release: false })}>查看详情</Button>
            {record.state === "ACTIVE" && canRelease && <Button size="sm" variant="primary"
              disabledReason={pending ? "有一笔解除结果等待确认，先查询原操作" : record.capabilities.releaseAllowed ? undefined : record.capabilities.disabledReason || "现在不能解除"}
              onClick={() => setSelected({ id: record.id, release: true })}>{actionText(record)}</Button>}
            {record.state === "ACTIVE" && canRelease && !pending && !record.capabilities.releaseAllowed && <span className="rd-toolbar-note">{record.capabilities.disabledReason || "现在不能解除"}</span>}
          </div>
        </>}
        {summary && !record && <p className="rd-detail-empty">当前没有支付密码异常。历史处置记录仍保留。</p>}
        {pending && <Notice tone="warn" title="有一笔解除结果等待确认。"
          action={<Button size="sm" onClick={() => { const row = pendingPaymentRelease(owner, port.userId); if (row) setSelected({ id: row.recordId, release: false }); }}>查询原操作</Button>} />}
      </div>
      {selected && <PaymentSecurityDetail key={`${port.key}:${owner}:${epoch}:${selected.id}`} port={port} recordId={selected.id} userLabel={userLabel} initialAction={selected.release} onClose={() => { setSelected(null); setPending(!!pendingPaymentRelease(owner, port.userId)); }} />}
    </Panel>
  );
}
