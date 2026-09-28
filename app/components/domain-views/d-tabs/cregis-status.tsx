"use client";

import { useCallback, useEffect, useState } from "react";
import { financeAdminRequest } from "@/lib/admin/d-client";

type ExceptionRow = Record<string, unknown>;
type CregisExceptions = {
  mode: string;
  depositEnabled: boolean;
  depositCreditEnabled: boolean;
  provisionGate: { state: string; updatedAt?: string };
  uncertainAddresses: ExceptionRow[];
  heldDeposits: ExceptionRow[];
  failedDeliveries: ExceptionRow[];
  unattributed: ExceptionRow[];
  providerMissing: ExceptionRow[];
};

const QUEUES: Array<[keyof Pick<CregisExceptions,
  "uncertainAddresses" | "heldDeposits" | "failedDeliveries" | "unattributed" | "providerMissing">, string]> = [
  ["uncertainAddresses", "建址待核验 / 未知"],
  ["heldDeposits", "入金待人工处理"],
  ["failedDeliveries", "回调处理失败"],
  ["unattributed", "未归属链上入金"],
  ["providerMissing", "供应商缺单 / 链上待核对"],
];

function parseExceptions(value: unknown): CregisExceptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Cregis 状态响应无效");
  const row = value as Record<string, unknown>;
  const gate = row.provisionGate as Record<string, unknown> | undefined;
  if (typeof row.mode !== "string" || typeof row.depositEnabled !== "boolean"
      || typeof row.depositCreditEnabled !== "boolean" || !gate || typeof gate.state !== "string"
      || QUEUES.some(([key]) => !Array.isArray(row[key]))) throw new Error("Cregis 状态响应无效");
  return value as CregisExceptions;
}

function rowSummary(row: ExceptionRow) {
  return [row.id == null ? null : `#${row.id}`, row.state ?? row.status,
    row.address, row.cid == null ? null : `CID ${row.cid}`, row.txid,
    row.lastError ?? row.last_error].filter((part) => part != null && part !== "").join(" · ");
}

export function CregisStatus() {
  const [data, setData] = useState<CregisExceptions | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(parseExceptions(await financeAdminRequest<unknown>("/cregis/exceptions")));
    } catch (failure) {
      setData(null);
      setError(failure instanceof Error ? failure.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const count = data ? QUEUES.reduce((sum, [key]) => sum + data[key].length, 0) : 0;
  return <section className="l-card" style={{ marginBottom: 12 }}>
    <div className="l-h">
      <span className="ttl">Cregis · USDT-BEP20 收款观察</span>
      <span className="sub">· 供应商、链与回调异常</span>
      <div className="r"><button className="l-btn sm" disabled={loading} onClick={() => void refresh()}>刷新</button></div>
    </div>
    <div className="l-b">
      {loading && !data && <div className="dtint">正在读取 Cregis 状态…</div>}
      {error && <div className="dtint warn">Cregis 状态不可用：{error}</div>}
      {data && <>
        <div className="p-row">
          <div className="txt"><div className="k">供应商连接：{data.mode}</div>
            <div className="s">App 收款入口：{data.depositEnabled ? "启用" : "关闭"} · 自动入账：{data.depositCreditEnabled ? "启用" : "关闭"}</div>
            <div className="s">建址许可：{data.provisionGate.state} · {data.provisionGate.updatedAt ?? "更新时间未知"}</div></div>
          <span className={`bdg ${data.provisionGate.state === "IDLE" ? "ok" : "bad"}`}>
            {data.provisionGate.state === "IDLE" ? "可继续核验" : "停止新地址分配"}
          </span>
        </div>
        {(!data.depositEnabled || !data.depositCreditEnabled) && <div className="dtint warn">USDT 充值尚未开放；请勿向测试地址转账。</div>}
        {count === 0 && <div className="dtint">当前异常队列为空。入账与 App 开放状态仍以服务端开关为准。</div>}
        {QUEUES.map(([key, label]) => <div className="p-row" key={key}>
          <div className="txt"><div className="k">{label} · {data[key].length}</div>
            {data[key].slice(0, 5).map((item, index) => <div className="s" key={`${key}-${index}`}>{rowSummary(item)}</div>)}
            {data[key].length > 5 && <div className="s">仅显示前 5 项；请在后端异常接口查看完整记录。</div>}
          </div>
        </div>)}
      </>}
    </div>
  </section>;
}
