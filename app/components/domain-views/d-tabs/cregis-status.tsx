"use client";

import { useCallback, useEffect, useState } from "react";
import { financeAdminRequest } from "@/lib/admin/d-client";
import type { DCtx } from "./types";

type ExceptionRow = Record<string, unknown>;
type CregisExceptions = {
  mode: string;
  depositEnabled: boolean;
  depositCreditEnabled: boolean;
  provisionGate: { state: string; updatedAt?: string; version?: number;
    assignEnabled?: boolean | number; creditEnabled?: boolean | number; payoutEnabled?: boolean | number };
  unresolvedExposureUsdt?: number | string;
  openRiskAlertCount?: number;
  pendingAcceptedDeliveries?: number;
  pendingDeliveries: ExceptionRow[];
  riskAlerts?: ExceptionRow[];
  reconcileRuns?: ExceptionRow[];
  reviewCases?: ExceptionRow[];
  openReviewCaseCount?: number;
  switchCases?: ExceptionRow[];
  uncertainAddresses: ExceptionRow[];
  heldDeposits: ExceptionRow[];
  failedDeliveries: ExceptionRow[];
  unattributed: ExceptionRow[];
  providerMissing: ExceptionRow[];
};

const QUEUES: Array<[keyof Pick<CregisExceptions,
  "uncertainAddresses" | "heldDeposits" | "failedDeliveries" | "pendingDeliveries" | "unattributed" | "providerMissing">, string]> = [
  ["uncertainAddresses", "建址待核验 / 未知"],
  ["heldDeposits", "入金待人工处理"],
  ["failedDeliveries", "回调处理失败"],
  ["pendingDeliveries", "已验签待处理回调"],
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
    row.ageSeconds == null ? null : `等待 ${row.ageSeconds} 秒`,
    row.lastError ?? row.last_error].filter((part) => part != null && part !== "").join(" · ");
}

export function CregisStatus({ canManage = false, openActionConfirm, embedded = false }: {
  canManage?: boolean; openActionConfirm: DCtx["openActionConfirm"]; embedded?: boolean;
}) {
  const [data, setData] = useState<CregisExceptions | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cid, setCid] = useState("");
  const [reviewEvidence, setReviewEvidence] = useState<ExceptionRow | null>(null);
  const [extraAlerts, setExtraAlerts] = useState<ExceptionRow[]>([]);
  const [extraReviewCases, setExtraReviewCases] = useState<ExceptionRow[]>([]);
  const [assign, setAssign] = useState(false);
  const [credit, setCredit] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    setExtraAlerts([]);
    setExtraReviewCases([]);
    try {
      const next = parseExceptions(await financeAdminRequest<unknown>("/cregis/exceptions"));
      setData(next);
      setAssign(Boolean(next.provisionGate.assignEnabled));
      setCredit(Boolean(next.provisionGate.creditEnabled));
      return true;
    } catch (failure) {
      setData(null);
      setError(failure instanceof Error ? failure.message : "读取失败");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const command = async (path: string, body?: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await financeAdminRequest<unknown>(path, {
        method: "POST", body: body ? JSON.stringify(body) : undefined,
        idempotencyPrefix: "cregis-ops",
      });
      if (!await refresh()) {
        setError("操作已被服务端受理，但状态回读失败；请勿重复提交，先刷新核对实际状态。");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "操作结果未知，请刷新核对后再试");
      throw failure;
    } finally { setBusy(false); }
  };

  const confirmCommand = (action: string, detail: string, path: string,
                          body?: Record<string, unknown>) => openActionConfirm({
    action, detail, reasonMin: 10, reasonMax: 255,
    completionCopy: path === "/cregis/switch-cases" ? "提交提案后等待另一管理员复核" : "提交后回读服务端状态",
    run: (reason) => command(path, { ...body, reason }),
  });

  const previewReview = async (targetCid: number) => {
    setBusy(true);
    setError("");
    setReviewEvidence(null);
    try {
      setReviewEvidence(await financeAdminRequest<ExceptionRow>(`/cregis/review-evidence/${targetCid}`));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "实时证据核验失败");
    } finally { setBusy(false); }
  };

  const loadMoreAlerts = async (beforeId: number) => {
    setBusy(true);
    setError("");
    try {
      const rows = await financeAdminRequest<ExceptionRow[]>(`/cregis/risk-alerts/${beforeId}`);
      setExtraAlerts((previous) => [...previous, ...rows]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "读取告警失败");
    } finally { setBusy(false); }
  };

  const loadMoreReviewCases = async (beforeId: number) => {
    setBusy(true);
    setError("");
    try {
      const rows = await financeAdminRequest<ExceptionRow[]>(`/cregis/review-cases/before/${beforeId}`);
      setExtraReviewCases((previous) => [...previous, ...rows]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "读取审核工单失败");
    } finally { setBusy(false); }
  };

  const count = data ? QUEUES.reduce((sum, [key]) => sum + data[key].length, 0) : 0;
  const alerts = [...(data?.riskAlerts ?? []), ...extraAlerts];
  const reviewCases = [...(data?.reviewCases ?? []), ...extraReviewCases];
  return <section className={embedded ? "cregis-status-embedded" : "l-card"} style={embedded ? undefined : { marginBottom: 12 }}>
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
            <div className="s">接入配置：App 收款入口{data.depositEnabled ? "已启用" : "已关闭"} · 自动入账能力{data.depositCreditEnabled ? "已配置" : "未配置"}；实际入账以资金开关为准</div>
            <div className="s">建址许可：{data.provisionGate.state} · {data.provisionGate.updatedAt ?? "更新时间未知"}</div></div>
          <span className={`bdg ${data.provisionGate.state === "IDLE" ? "ok" : "bad"}`}>
            {data.provisionGate.state === "IDLE" ? "可继续核验" : "停止新地址分配"}
          </span>
        </div>
        <div className="p-row"><div className="txt">
          <div className="k">资金开关与未决敞口</div>
          <div className="s">分配地址：{data.provisionGate.assignEnabled ? "开" : "关"} · 自动入账：{data.provisionGate.creditEnabled ? "开" : "关"} · 链上出款：{data.provisionGate.payoutEnabled ? "开" : "关"} · 版本 {data.provisionGate.version ?? "未知"}</div>
          <div className="s">未决资金：{String(data.unresolvedExposureUsdt ?? "未知")} USDT · 未解除 P0/P1 告警 {data.openRiskAlertCount ?? "未知"} · 已验签待处理回调 {data.pendingAcceptedDeliveries ?? "未知"}</div>
          <div className="s">最近完整对账：{data.reconcileRuns?.find((row) => row.status === "COMPLETE")?.completedAt?.toString() ?? "尚无"}</div>
          {data.reconcileRuns?.slice(0, 3).map((row, index) => <div className="s" key={`recon-${index}`}>
            对账 {String(row.status ?? "未知")} · {String(row.completedAt ?? row.startedAt ?? "时间未知")}
            {row.failureCode ? ` · ${String(row.failureCode)}` : ""}
          </div>)}
          <details><summary>查看未解除告警（已载入 {alerts.length} / {data.openRiskAlertCount ?? "未知"}）</summary>
            {alerts.map((row) => <div className="s" key={`risk-${row.id}`}>{rowSummary(row)} · {String(row.severity)} · {String(row.kind)} · {String(row.evidence)}</div>)}
            {alerts.length > 0 && alerts.length < (data.openRiskAlertCount ?? 0) && <button className="l-btn sm" disabled={busy} onClick={() => void loadMoreAlerts(Number(alerts[alerts.length - 1].id))}>加载更早告警</button>}
          </details>
        </div></div>
        {canManage && <div className="p-row"><div className="txt">
          <div className="k">对账与熔断操作</div>
          <button className="l-btn sm" disabled={busy || loading} onClick={() => confirmCommand(
            "立即运行 Cregis 完整对账", "读取供应商和 BSC 链上事实，生成新的对账批次与异常告警。",
            "/cregis/reconciliation/run",
          )}>立即完整对账</button>
          <div className="s" style={{ marginTop: 8 }}>双人开关审批：一人提交提案，另一名有权限的管理员审批。</div>
          <label className="s"><input type="checkbox" checked={assign} onChange={(event) => setAssign(event.target.checked)} /> 分配地址</label>{" "}
          <label className="s"><input type="checkbox" checked={credit} onChange={(event) => setCredit(event.target.checked)} /> 充值入账</label>
          <button className="l-btn sm mc" disabled={busy || data.provisionGate.version == null} onClick={() => confirmCommand(
            "提交 Cregis 收款开关提案", `分配地址：${assign ? "开" : "关"}；自动入账：${credit ? "开" : "关"}。另一管理员复核后才生效。`,
            "/cregis/switch-cases", { expectedVersion: data.provisionGate.version, assignEnabled: assign, creditEnabled: credit },
          )}>提交开关提案</button>{" "}
          <button className="l-btn sm mc" disabled={busy || data.provisionGate.version == null} onClick={() => confirmCommand(
            "紧急关闭 Cregis 资金开关", "立即关闭地址分配、自动入账与链上出款；请核对当前服务端版本。",
            "/cregis/switches/emergency-off", { expectedVersion: data.provisionGate.version },
          )}>紧急关闭三项开关</button>
          {data.switchCases?.filter((row) => row.status === "MAKER_DONE").map((row) => <div className="s" key={`switch-${row.id}`}>
            提案 #{String(row.id)} · 发起人 {String(row.makerId)} · 地址 {row.assignEnabled ? "开" : "关"} / 入账 {row.creditEnabled ? "开" : "关"} · {String(row.reason)}{" "}
            <button className="l-btn sm" disabled={busy} onClick={() => confirmCommand(
              `复核通过 Cregis 开关提案 #${row.id}`, `发起人 ${String(row.makerId)}；地址 ${row.assignEnabled ? "开" : "关"} / 入账 ${row.creditEnabled ? "开" : "关"}；发起理由 ${String(row.reason)}`,
              `/cregis/switch-cases/${row.id}/decision`, { decision: "APPROVE" },
            )}>复核通过</button>{" "}
            <button className="l-btn sm" disabled={busy} onClick={() => confirmCommand(
              `拒绝 Cregis 开关提案 #${row.id}`, `发起人 ${String(row.makerId)}；发起理由 ${String(row.reason)}`,
              `/cregis/switch-cases/${row.id}/decision`, { decision: "REJECT" },
            )}>拒绝</button>
          </div>)}
        </div></div>}
        {canManage && <div className="p-row"><div className="txt">
          <div className="k">大额入金双人处置</div>
          <div className="s">仅支持 REVIEW_HOLD；供应商缺单、孤儿资金和重组仍须保持冻结并核查。</div>
          <input aria-label="待审核 Cregis CID" placeholder="Cregis CID" value={cid} onChange={(event) => setCid(event.target.value)} />{" "}
          <button className="l-btn sm" disabled={busy || !/^\d+$/.test(cid) || !Number.isSafeInteger(Number(cid)) || Number(cid) <= 0} onClick={() => void previewReview(Number(cid))}>实时核验证据</button>{" "}
          <button className="l-btn sm mc" disabled={busy || String(reviewEvidence?.cid) !== cid} onClick={() => confirmCommand(
            "提交 Cregis 入金复核", `CID ${cid} · 证据 ${String(reviewEvidence?.evidenceHash)}。需另一管理员独立复核。`,
            "/cregis/review-cases", { cid: Number(cid), evidenceHash: reviewEvidence?.evidenceHash },
          )}>提交入金复核</button>
          {reviewEvidence && <div className="s">实时核验 {String(reviewEvidence.checkedAt)} · Cregis {reviewEvidence.providerMatched ? "匹配" : "未匹配"} / BSC {reviewEvidence.chainMatched ? "匹配" : "未匹配"} · CID {String(reviewEvidence.cid)} · 用户 {String(reviewEvidence.userId)} · 毛额 {String(reviewEvidence.grossAmount)} / 净入账 {String(reviewEvidence.proposedNetAmount)} USDT · Tx {String(reviewEvidence.txid)} · 地址 {String(reviewEvidence.address)} · 区块哈希 {String(reviewEvidence.blockHash)} · 确认 {String(reviewEvidence.confirmations)} · 证据摘要 {String(reviewEvidence.evidenceHash)}</div>}
          <div className="s">待审核工单：已载入 {reviewCases.length} / {data.openReviewCaseCount ?? "未知"}</div>
          {reviewCases.map((row) => <div className="s" key={`review-${row.id}`}>
            工单 #{String(row.id)} · CID {String(row.cid)} · 用户 {String(row.userId)} · 链上毛额 {String(row.grossAmount)} USDT / 手续费 1 USDT / 钱包净入账 {String(row.proposedNetAmount)} USDT · 地址 {String(row.address)} · Tx {String(row.txid)} · 区块 {String(row.blockNumber)} / 日志 {String(row.logIndex)} / 确认 {String(row.confirmations)} · 发起人 {String(row.makerId)} · 理由 {String(row.reason)} · 证据 {String(row.evidenceHash)}{" "}
            <button className="l-btn sm" disabled={busy} onClick={() => void previewReview(Number(row.cid))}>刷新证据</button>{" "}
            <button className="l-btn sm" disabled={busy || String(reviewEvidence?.cid) !== String(row.cid) || String(reviewEvidence?.evidenceHash) !== String(row.evidenceHash)} onClick={() => confirmCommand(
              `复核入账 CID ${String(row.cid)}`, `交易 ${String(row.txid)}，毛额 ${String(row.grossAmount)} USDT，净入账 ${String(row.proposedNetAmount)} USDT 给用户 ${String(row.userId)}。请独立核对地址 ${String(row.address)}、发起理由 ${String(row.reason)} 与证据 ${String(row.evidenceHash)}。`,
              `/cregis/review-cases/${row.id}/decision`, { expectedVersion: row.version, decision: "APPROVE" },
            )}>复核入账</button>{" "}
            <button className="l-btn sm" disabled={busy} onClick={() => confirmCommand(
              `拒绝 Cregis 入金复核 #${row.id}`, `CID ${String(row.cid)} · 证据 ${String(row.evidenceHash)}`,
              `/cregis/review-cases/${row.id}/decision`, { expectedVersion: row.version, decision: "REJECT" },
            )}>拒绝</button>
          </div>)}
          {reviewCases.length > 0 && reviewCases.length < (data.openReviewCaseCount ?? 0) && <button className="l-btn sm" disabled={busy} onClick={() => void loadMoreReviewCases(Number(reviewCases[reviewCases.length - 1].id))}>加载更早工单</button>}
        </div></div>}
        {(!data.depositEnabled || !data.depositCreditEnabled || !data.provisionGate.assignEnabled) && <div className="dtint warn">USDT 充值尚未开放；请勿向测试地址转账。</div>}
        {data.depositEnabled && data.depositCreditEnabled && data.provisionGate.assignEnabled && !data.provisionGate.creditEnabled && <div className="dtint warn">仅开放试点收款地址，到账后进入人工复核，暂不自动入账；请仅按测试安排转账。</div>}
        {count === 0 && (data.openRiskAlertCount ?? 0) === 0 && (data.pendingAcceptedDeliveries ?? 0) === 0 && <div className="dtint">当前异常队列为空。入账与 App 开放状态仍以服务端开关为准。</div>}
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
