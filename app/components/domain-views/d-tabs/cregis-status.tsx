"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { financeAdminRequest } from "@/lib/admin/d-client";
import type { DCtx } from "./types";
import { CregisExceptionOperations } from "./cregis-exceptions";
import { CregisFundsPreparation } from "./cregis-funds-preparation";
import { CregisAutoForward } from "./cregis-auto-forward";
import { CregisPoolPolicy } from "./cregis-pool-policy";
import { CregisDepositPolicy } from "./cregis-deposit-policy";

type ExceptionRow = Record<string, unknown>;
type CregisExceptions = {
  mode: string;
  depositEnabled: boolean;
  depositCreditEnabled: boolean;
  addressPool?: { available: boolean; total: number; unassigned: number; assigned: number; verifying: number; unknown: number; limit: number; reserveTarget?: number; automatic?: boolean; queued?: number; lastError?: string | null; retryAfter?: number | null };
  providerPayout?: { configured: boolean; enabled: boolean; disabledReason: string | null };
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
  ["uncertainAddresses", "新地址待核验"],
  ["heldDeposits", "入金待人工处理"],
  ["failedDeliveries", "回调处理失败"],
  ["pendingDeliveries", "待处理的回调"],
  ["unattributed", "未归属链上入金"],
  ["providerMissing", "Cregis 缺单 / 链上待核对"],
];

function parseExceptions(value: unknown): CregisExceptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Cregis 状态响应无效");
  const row = value as Record<string, unknown>;
  const gate = row.provisionGate as Record<string, unknown> | undefined;
  if (typeof row.mode !== "string" || typeof row.depositEnabled !== "boolean"
      || typeof row.depositCreditEnabled !== "boolean" || !gate || typeof gate.state !== "string"
      || QUEUES.some(([key]) => !Array.isArray(row[key]))) throw new Error("Cregis 状态响应无效");
  const flags = [gate.assignEnabled, gate.creditEnabled, gate.payoutEnabled];
  const unavailableGate = ["DISABLED", "MISSING"].includes(gate.state as string)
    && flags.every((flag) => flag === undefined);
  if (!unavailableGate && !flags
      .every((flag) => flag === true || flag === false || flag === 0 || flag === 1)) {
    throw new Error("Cregis 资金开关状态无效");
  }
  if (row.providerPayout !== undefined) {
    const payout = row.providerPayout as Record<string, unknown> | null;
    if (!payout || typeof payout !== "object" || Array.isArray(payout)
        || typeof payout.configured !== "boolean" || typeof payout.enabled !== "boolean"
        || !(payout.disabledReason === null || (typeof payout.disabledReason === "string" && payout.disabledReason.length > 0))
        || (payout.enabled && (!payout.configured || payout.disabledReason !== null || !gate.payoutEnabled))) {
      throw new Error("Cregis 链上出款能力响应无效");
    }
  }
  if (row.addressPool !== undefined) {
    const pool = row.addressPool as CregisExceptions["addressPool"];
    if (!pool || typeof pool.available !== "boolean" || [pool.total, pool.unassigned, pool.assigned, pool.verifying, pool.unknown, pool.limit]
      .some((count) => !Number.isSafeInteger(count) || count < 0)
      || (pool.limit > 0 && pool.total > pool.limit)
      || pool.unassigned + pool.assigned + pool.verifying + pool.unknown > pool.total) {
      throw new Error("Cregis 地址池状态无效");
    }
  }
  return value as CregisExceptions;
}

function canProvisionAddress(data: CregisExceptions): boolean {
  return data.mode === "PROVIDER" && data.provisionGate.state === "IDLE"
    && Boolean(data.provisionGate.assignEnabled) && data.addressPool?.available === true
    && (data.addressPool.limit === 0 || data.addressPool.total < data.addressPool.limit) && data.addressPool.verifying === 0
    && data.addressPool.unknown === 0;
}

function canEnableProviderPayout(data: CregisExceptions): boolean {
  const capability = data.providerPayout;
  return data.mode === "PROVIDER" && capability?.configured === true
    && (capability.enabled || capability.disabledReason === "SWITCH_OFF");
}

function payoutCapabilityText(data: CregisExceptions): string {
  const capability = data.providerPayout;
  if (!capability) return "链上出款能力尚未确认，请刷新核对；当前不能开启。";
  if (capability.enabled) return "链上出款能力已启用，提现仍须通过原有资格、审核与链上确认。";
  switch (capability.disabledReason) {
    case "NOT_CONFIGURED": return "链上出款接入尚未就绪，当前不能开启。";
    case "SWITCH_OFF": return "链上出款开关已关闭；开启须由另一管理员复核。";
    case "RISK_HOLD": return "链上出款因风险处置暂停，请先核对异常与告警。";
    case "RECONCILIATION_REQUIRED": return "链上出款需要先完成资金对账，请核对对账结果。";
    default: return "链上出款能力待核实，请刷新后再试；当前不能开启。";
  }
}

function payoutSwitchText(row: ExceptionRow, unknownText = "保持现值"): string {
  return row.payoutEnabled === true || row.payoutEnabled === 1 ? "开"
    : row.payoutEnabled === false || row.payoutEnabled === 0 ? "关" : unknownText;
}

const cregisStateText = (value: unknown) => ({ IDLE: "地址创建空闲", BUSY: "正在创建地址", BLOCKED: "风险暂停", DISABLED: "未启用支付商收款", MISSING: "控制配置缺失", UNKNOWN: "创建结果待核实", PROVISIONING: "地址创建中", VERIFYING: "地址核验中", UNATTRIBUTED_HOLD: "未归属充值待处理", RETIRED_HOLD: "停用地址充值待处理", DUST_HOLD: "低额充值待处理", REVIEW_HOLD: "大额充值待审核", REORG_INVESTIGATING: "链重组调查中", PROVIDER_CONFLICT_HOLD: "支付商与链上记录冲突待处理", PROVIDER_MISSING: "支付商缺单待核对", CHAIN_MISMATCH_HOLD: "链上记录不符待核对", RUNNING: "对账中", COMPLETE: "完整对账完成", INCOMPLETE: "对账未完成", MAKER_DONE: "待另一管理员复核", RESOLVED: "复核处理完成", REJECTED: "已驳回" } as Record<string,string>)[String(value)] ?? "状态待核实";
function rowSummary(row: ExceptionRow) {
  return [row.id == null ? null : `#${row.id}`, row.state == null && row.status == null ? null : cregisStateText(row.state ?? row.status),
    row.address, row.cid == null ? null : `CID ${row.cid}`, row.txid,
    row.ageSeconds == null ? null : `等待 ${row.ageSeconds} 秒`,
    row.lastError ?? row.last_error].filter((part) => part != null && part !== "").join(" · ");
}

type DepositRow = {
  id: string; cid: string; userId: string; txid: string; logIndex: number; address: string;
  grossAmount: string; feeAmount: string; netAmount: string;
  confirmations: number; status: string; depositNo?: string | null;
  createdAt: string; creditedAt?: string | null;
};
type DepositPage = { available: boolean; items: DepositRow[]; hasMore: boolean; nextBeforeId: string };

function parseDepositPage(value: unknown): DepositPage {
  if (!value || typeof value !== "object") throw new Error("Cregis 入金记录响应无效");
  const page = value as Record<string, unknown>;
  if (typeof page.available !== "boolean" || !Array.isArray(page.items) || typeof page.hasMore !== "boolean"
      || typeof page.nextBeforeId !== "string" || !/^(0|[1-9]\d*)$/.test(page.nextBeforeId)
      || page.items.some((item) => !item || typeof item !== "object"
        || typeof item.id !== "string" || !/^[1-9]\d*$/.test(item.id)
        || typeof item.cid !== "string" || !/^[1-9]\d*$/.test(item.cid)
        || typeof item.userId !== "string" || !/^[1-9]\d*$/.test(item.userId)
        || typeof item.txid !== "string"
        || typeof item.status !== "string" || typeof item.address !== "string"
        || !Number.isSafeInteger(item.logIndex) || !Number.isSafeInteger(item.confirmations)
        || typeof item.grossAmount !== "string" || !/^\d+\.\d{6}$/.test(item.grossAmount)
        || typeof item.feeAmount !== "string" || !/^\d+\.\d{6}$/.test(item.feeAmount)
        || typeof item.netAmount !== "string" || !/^\d+\.\d{6}$/.test(item.netAmount)
        || typeof item.createdAt !== "string")) {
    throw new Error("Cregis 入金记录响应无效");
  }
  return value as DepositPage;
}

const DEPOSIT_STATUS: Record<string, string> = {
  CREDITED: "已入账", REVIEW_HOLD: "待人工复核", DUST_HOLD: "低额冻结",
  REORG_INVESTIGATING: "链重组调查", PROVIDER_CONFLICT_HOLD: "供应商冲突冻结",
};

function CregisDepositHistory() {
  const [page, setPage] = useState<DepositPage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  const load = useCallback(async (beforeId = "0") => {
    const current = ++requestId.current;
    setLoading(true);
    setError("");
    if (beforeId === "0") setPage(null);
    try {
      const next = parseDepositPage(await financeAdminRequest<unknown>(`/cregis/deposits?beforeId=${encodeURIComponent(beforeId)}&limit=20`));
      if (current === requestId.current) setPage((previous) => beforeId !== "0" && previous
        ? { ...next, items: [...previous.items, ...next.items] } : next);
    } catch (failure) {
      if (current === requestId.current) setError(failure instanceof Error ? failure.message : "读取入金记录失败");
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); return () => { requestId.current++; }; }, [load]);

  return <div className="cregis-history">
    <div className="cregis-section-title">USDT 入金记录 / 充值单
      <button className="l-btn sm" disabled={loading} onClick={() => void load()}>刷新列表</button>
    </div>
    <div className="sub">链上转账经 Cregis 和链上核实后生成入金记录，入账时生成充值单。未入账的净额只供核对。</div>
    {error && <div className="dtint warn">入金记录加载失败：{error}</div>}
    {loading && !page && <div className="dtint">正在加载…</div>}
    {page && !page.available && <div className="dtint warn">Cregis 收款已停用，历史记录暂时查不了（不代表没有入金）。</div>}
    {page?.available && <>
      <div className="cregis-history-scroll"><table className="l-tbl">
        <thead><tr><th>记录 / 充值单</th><th>用户</th><th>链上交易 / 地址</th><th className="num">毛额 USDT</th><th className="num">手续费</th><th className="num">净额 USDT</th><th>确认数</th><th>状态</th><th>发现 / 入账时间</th></tr></thead>
        <tbody>{page.items.length === 0 ? <tr><td colSpan={9} className="cregis-history-empty">暂无已核实的链上入金。待处理的回调和缺单可在“异常处理”查看。</td></tr>
          : page.items.map((row) => <tr key={row.id}>
            <td className="mono">CID {row.cid}<div className="sub">{row.depositNo || (row.status === "CREDITED" ? "充值单缺失，请核对" : "尚未生成充值单")}</div></td>
            <td className="mono">{row.userId}</td>
            <td className="cregis-chain-cell mono">{row.txid} <span>日志 {row.logIndex} · {row.address}</span></td>
            <td className="num mono">{String(row.grossAmount)}</td>
            <td className="num mono">{String(row.feeAmount)}</td>
            <td className="num mono">{String(row.netAmount)}</td>
            <td className="mono">{row.confirmations}</td>
            <td><span className={`bdg ${row.status === "CREDITED" && row.depositNo ? "ok" : row.status.endsWith("HOLD") || row.status === "REORG_INVESTIGATING" ? "bad" : "warn"}`}>{row.status === "CREDITED" && !row.depositNo ? "入账记录异常" : DEPOSIT_STATUS[row.status] ?? "充值状态待核实"}</span></td>
            <td className="mono">{String(row.createdAt).replace("T", " ")}<div className="sub">{row.creditedAt ? `入账 ${String(row.creditedAt).replace("T", " ")}` : "尚未入账"}</div></td>
          </tr>)}</tbody>
      </table></div>
      {page.hasMore && <button className="l-btn sm" disabled={loading} onClick={() => void load(page.nextBeforeId)}>加载更早记录</button>}
    </>}
  </div>;
}

export function CregisStatus({ canManage = false, openActionConfirm, embedded = false }: {
  canManage?: boolean; openActionConfirm: DCtx["openActionConfirm"]; embedded?: boolean;
}) {
  const [data, setData] = useState<CregisExceptions | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState("records");
  const [cid, setCid] = useState("");
  const [reviewEvidence, setReviewEvidence] = useState<ExceptionRow | null>(null);
  const [extraAlerts, setExtraAlerts] = useState<ExceptionRow[]>([]);
  const [extraReviewCases, setExtraReviewCases] = useState<ExceptionRow[]>([]);
  const [assign, setAssign] = useState(false);
  const [credit, setCredit] = useState(false);
  const [payout, setPayout] = useState(false);
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
      setPayout(Boolean(next.provisionGate.payoutEnabled));
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
        setError("操作已提交，但状态没刷新出来。请先刷新查看，不要重复提交。");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "操作结果未确认，请刷新查看后再试");
      throw failure;
    } finally { setBusy(false); }
  };

  const confirmCommand = (action: string, detail: string, path: string,
                          body?: Record<string, unknown>) => openActionConfirm({
    action, detail, reasonMin: 10, reasonMax: 255,
    completionCopy: path === "/cregis/switch-cases" ? "提交后需另一位管理员复核才生效。" : "提交后立即执行。",
    run: (reason) => command(path, { ...body, reason }),
  });

  const previewReview = async (targetCid: number) => {
    setBusy(true);
    setError("");
    setReviewEvidence(null);
    try {
      setReviewEvidence(await financeAdminRequest<ExceptionRow>(`/cregis/review-evidence/${targetCid}`));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "核验失败");
    } finally { setBusy(false); }
  };

  const loadMoreAlerts = async (beforeId: number) => {
    setBusy(true);
    setError("");
    try {
      const rows = await financeAdminRequest<ExceptionRow[]>(`/cregis/risk-alerts/${beforeId}`);
      setExtraAlerts((previous) => [...previous, ...rows]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "告警加载失败");
    } finally { setBusy(false); }
  };

  const loadMoreReviewCases = async (beforeId: number) => {
    setBusy(true);
    setError("");
    try {
      const rows = await financeAdminRequest<ExceptionRow[]>(`/cregis/review-cases/before/${beforeId}`);
      setExtraReviewCases((previous) => [...previous, ...rows]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "审核工单加载失败");
    } finally { setBusy(false); }
  };

  const count = data ? QUEUES.reduce((sum, [key]) => sum + data[key].length, 0) : 0;
  const alerts = [...(data?.riskAlerts ?? []), ...extraAlerts];
  const reviewCases = [...(data?.reviewCases ?? []), ...extraReviewCases];
  return <section className={embedded ? "l-card cregis-status-embedded cregis-workspace" : "l-card cregis-status cregis-workspace"} style={embedded ? undefined : { marginBottom: 12 }}>
    <div className="l-h">
      <span className="ttl">USDT-BEP20 资金状态</span>
      <span className="sub">Cregis · 地址、入账、出款与链上异常</span>
      <div className="r"><button className="l-btn sm" disabled={loading} onClick={() => void refresh()}>刷新</button></div>
    </div>
    <div className="l-b">
      {loading && !data && <div className="dtint">正在加载…</div>}
      {error && <div className="dtint warn">Cregis 状态加载失败：{error}</div>}
      {data && <>
        <div className="cregis-intro">
          <div><strong>接入模式：{({PROVIDER:"支付服务商模式",provider:"支付服务商模式",MOCK:"模拟模式",DISABLED:"未启用"} as Record<string,string>)[data.mode] ?? "未知"}</strong><span>App 收款入口{data.depositEnabled ? "已启用" : "已关闭"} · 自动入账能力{data.depositCreditEnabled ? "已配置" : "未配置"}</span></div>
          <span className={`bdg ${data.provisionGate.state === "IDLE" ? "ok" : "bad"}`}>{data.provisionGate.state === "IDLE" ? "建址流程空闲" : "停止新地址分配"}</span>
        </div>
        <div className="dtint">{payoutCapabilityText(data)}</div>
        <div className="cregis-recon">
          <span>专属收款地址池：{data.addressPool?.available
            ? `可分配 ${data.addressPool.unassigned} · 待创建 ${data.addressPool.queued ?? 0} · 已分配 ${data.addressPool.assigned} · 核验中 ${data.addressPool.verifying} · 待核查 ${data.addressPool.unknown} · 总计 ${data.addressPool.total}${data.addressPool.limit > 0 ? `/${data.addressPool.limit}` : " · 无总量上限"}${data.addressPool.automatic ? ` · 自动补充至 ${data.addressPool.reserveTarget ?? 5} 个备用地址` : ""}`
            : "暂不可用，请刷新核对"}</span>
          {canManage && <button className="l-btn sm" disabled={busy || loading || !canProvisionAddress(data)} onClick={() => confirmCommand(
            "补充一个专属收款地址", "向 Cregis 创建一个候选地址；系统核对归属、余额和链上历史后才可分配给用户。创建结果不明时请先核查，勿连续重试。",
            "/cregis/addresses/provision",
          )}>补充收款地址</button>}
        </div>
        <div className="f-stats cregis-overview">
          <div className="f-stat"><div className="k">地址分配</div><div className={`v ${data.provisionGate.assignEnabled ? "" : "cregis-off"}`}>{data.provisionGate.assignEnabled ? "已开启" : "已关闭"}</div><div className="sub">{cregisStateText(data.provisionGate.state)} · {data.provisionGate.updatedAt ?? "更新时间未知"}</div></div>
          <div className="f-stat"><div className="k">自动入账</div><div className={`v ${data.provisionGate.creditEnabled ? "" : "cregis-off"}`}>{data.provisionGate.creditEnabled ? "已开启" : "已关闭"}</div><div className="sub">以资金开关为准 · 版本 {data.provisionGate.version ?? "未知"}</div></div>
          <div className="f-stat"><div className="k">待处理资金</div><div className="v">{String(data.unresolvedExposureUsdt ?? "未知")} <small>USDT</small></div><div className="sub">待处理回调 {data.pendingAcceptedDeliveries ?? "未知"}</div></div>
          <div className={`f-stat ${(data.openRiskAlertCount ?? 0) > 0 ? "warn" : ""}`}><div className="k">未解除的紧急与严重告警</div><div className="v">{data.openRiskAlertCount ?? "未知"}</div><div className="sub">链上出款：{payoutSwitchText(data.provisionGate, "未知")}</div></div>
        </div>
        <div className="cregis-recon">
          <span>最近完整对账：<strong>{data.reconcileRuns?.find((row) => row.status === "COMPLETE")?.completedAt?.toString() ?? "尚无"}</strong></span>
          {canManage && <>
          <button className="l-btn sm" disabled={busy || loading} onClick={() => confirmCommand(
            "立即运行 Cregis 完整对账", "核对 Cregis 和 BSC 链上记录，发现异常会生成告警。",
            "/cregis/reconciliation/run",
          )}>立即完整对账</button>
          </>}
          <details><summary>查看最近对账与告警（{data.openRiskAlertCount ?? "未知"}）</summary>
            {data.reconcileRuns?.slice(0, 3).map((row, index) => <div className="s" key={`recon-${index}`}>对账 {cregisStateText(row.status)} · {String(row.completedAt ?? row.startedAt ?? "时间未知")}{row.failureCode ? ` · ${String(row.failureCode)}` : ""}</div>)}
            <div className="s">未解除告警：已载入 {alerts.length} / {data.openRiskAlertCount ?? "未知"}</div>
            {alerts.map((row) => <div className="s" key={`risk-${row.id}`}>{rowSummary(row)} · {({ P0: "紧急", P1: "严重", P2: "警告", P3: "提示" } as Record<string,string>)[String(row.severity)] ?? "未知"} · 告警类型编号：{String(row.kind)} · 证据：{String(row.evidence)}</div>)}
            {alerts.length > 0 && alerts.length < (data.openRiskAlertCount ?? 0) && <button className="l-btn sm" disabled={busy} onClick={() => void loadMoreAlerts(Number(alerts[alerts.length - 1].id))}>加载更早告警</button>}
          </details>
        </div>
        {(!data.depositEnabled || !data.depositCreditEnabled || !data.provisionGate.assignEnabled) && <div className="dtint warn">USDT 充值尚未开放；请勿向测试地址转账。</div>}
        {data.depositEnabled && data.depositCreditEnabled && data.provisionGate.assignEnabled && !data.provisionGate.creditEnabled && <div className="dtint warn">仅开放试点收款地址，到账后进入人工复核，暂不自动入账；请仅按测试安排转账。</div>}
      </>}
      <nav className="cregis-navigation" aria-label="USDT 操作分区">
        {[["records", "收款记录"], ["exceptions", `异常处理${count ? `（${count}）` : ""}`], ["settings", "充值与地址设置"], ["funds", "归集与付款"]].map(([key, title]) =>
          <button key={key} type="button" aria-pressed={section === key} aria-controls={`cregis-${key}`} onClick={() => setSection(key)}>{title}</button>)}
      </nav>
      <section id="cregis-records" hidden={section !== "records"} aria-label="收款记录" className="cregis-content">
        <CregisDepositHistory />
      </section>
      <section id="cregis-exceptions" hidden={section !== "exceptions"} aria-label="异常处理" className="cregis-content">
        <p className="sub">先查看异常来源，再核验证据并提交处置。资金仍按原有复核规则处理。</p>
        {data && <>
        <div className="cregis-exceptions">
          <div className="cregis-section-title">异常队列 <span>共 {count} 项</span></div>
          {count === 0 && (data.openRiskAlertCount ?? 0) === 0 && (data.pendingAcceptedDeliveries ?? 0) === 0 && <div className="dtint">暂无异常。</div>}
          <div className="cregis-queue-grid">{QUEUES.map(([key, label]) => <div className={`cregis-queue ${data[key].length ? "active" : ""}`} key={key}>
            <div className="cregis-queue-head"><span>{label}</span><strong>{data[key].length}</strong></div>
            {data[key].slice(0, 5).map((item, index) => <div className="s" key={`${key}-${index}`}>{rowSummary(item)}</div>)}
            {data[key].length > 5 && <div className="s">只显示前 5 项。</div>}
          </div>)}</div>
        </div>
        {data.addressPool?.lastError && <div className="dtint warn">{data.addressPool.lastError === "CREGIS_ADDRESS_QUOTA_EXCEEDED"
          ? "Cregis 地址额度不足，请扩容后恢复补充。" : data.addressPool.lastError === "CREGIS_ADDRESS_RATE_LIMITED"
          ? "Cregis 限制了请求频率，稍后会自动继续补充。" : "Cregis 暂未受理创建地址，请检查额度和接口状态后恢复。"}</div>}
        {canManage && <>
        <div className="cregis-panel">
          <div className="cregis-panel-title">大额入金复核</div>
          <p>只支持暂停审核；找不到对应订单的资金或链上交易重组时，须保持冻结并核查。</p>
          <div className="cregis-review-form">
          <input aria-label="待审核 Cregis CID" placeholder="Cregis CID" value={cid} onChange={(event) => setCid(event.target.value)} />{" "}
          <button className="l-btn sm" disabled={busy || !/^\d+$/.test(cid) || !Number.isSafeInteger(Number(cid)) || Number(cid) <= 0} onClick={() => void previewReview(Number(cid))}>实时核验证据</button>{" "}
          <button className="l-btn sm mc" disabled={busy || String(reviewEvidence?.cid) !== cid} onClick={() => confirmCommand(
            "提交 Cregis 入金复核", `CID ${cid} · 证据 ${String(reviewEvidence?.evidenceHash)}。需另一位管理员复核。`,
            "/cregis/review-cases", { cid: Number(cid), evidenceHash: reviewEvidence?.evidenceHash },
          )}>提交入金复核</button>
          </div>
          {reviewEvidence && <div className="cregis-case"><dl className="ui-facts-grid">
            {[["实时核验时间", reviewEvidence.checkedAt], ["支付商核验", reviewEvidence.providerMatched ? "匹配" : "未匹配"], ["链上核验", reviewEvidence.chainMatched ? "匹配" : "未匹配"], ["Cregis 订单编号", reviewEvidence.cid], ["用户", reviewEvidence.userId], ["毛额（USDT）", reviewEvidence.grossAmount], ["手续费（USDT）", reviewEvidence.feeAmount ?? "未提供"], ["净入账（USDT）", reviewEvidence.proposedNetAmount], ["交易哈希", reviewEvidence.txid], ["地址", reviewEvidence.address], ["区块哈希", reviewEvidence.blockHash], ["确认数", reviewEvidence.confirmations], ["证据摘要", reviewEvidence.evidenceHash]].map(([title, value]) => <div key={String(title)}><dt>{String(title)}</dt><dd>{String(value)}</dd></div>)}
          </dl></div>}
          <div className="cregis-case-count">待审核工单：已载入 {reviewCases.length} / {data.openReviewCaseCount ?? "未知"}</div>
          {reviewCases.map((row) => <div className="cregis-case" key={`review-${row.id}`}>
            <dl className="ui-facts-grid">{[["工单", row.id], ["Cregis 订单编号", row.cid], ["用户", row.userId], ["链上毛额（USDT）", row.grossAmount], ["手续费（USDT）", row.feeAmount ?? "未提供"], ["钱包净入账（USDT）", row.proposedNetAmount], ["地址", row.address], ["交易哈希", row.txid], ["区块", row.blockNumber], ["日志序号", row.logIndex], ["确认数", row.confirmations], ["发起人", row.makerId], ["理由", row.reason], ["证据摘要", row.evidenceHash]].map(([title, value]) => <div key={String(title)}><dt>{String(title)}</dt><dd>{String(value)}</dd></div>)}</dl>
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
        </div>
        </>}
        <CregisExceptionOperations canManage={canManage} openActionConfirm={openActionConfirm}
          sources={[
            ...data.heldDeposits.filter(row => row.status === "DUST_HOLD").map(row => ({ sourceType: "EVENT", sourceId: String(row.id), title: `低额入金 #${row.id} · ${row.grossAmount ?? "待核对"} USDT` })),
            ...data.unattributed.map(row => ({ sourceType: "OBSERVATION", sourceId: String(row.id), title: `未归属入金 #${row.id} · ${row.rawAmount ?? "待核对"} USDT` })),
          ]} />
        </>}
      </section>
      <section id="cregis-settings" hidden={section !== "settings"} aria-label="充值与地址设置" className="cregis-content">
        <CregisDepositPolicy canManage={canManage} openActionConfirm={openActionConfirm} />
        {data && <CregisPoolPolicy canManage={canManage} openActionConfirm={openActionConfirm} />}
        {data && canManage && <>
        <div className="cregis-panel">
          <div className="cregis-panel-title">收款与出款开关</div>
          <p>修改后提交提案，由另一管理员复核后生效；下方紧急停用立即执行。</p>

          <div className="cregis-switch-form">
          <label><input type="checkbox" checked={assign} onChange={(event) => setAssign(event.target.checked)} /> 分配地址</label>
          <label><input type="checkbox" checked={credit} onChange={(event) => setCredit(event.target.checked)} /> 充值入账</label>
          <button className="l-btn sm mc" disabled={busy || data.provisionGate.version == null} onClick={() => confirmCommand(
            "提交 Cregis 收款开关修改", `分配地址：${assign ? "开" : "关"}；自动入账：${credit ? "开" : "关"}。需另一位管理员复核后生效。`,
            "/cregis/switch-cases", { expectedVersion: data.provisionGate.version, assignEnabled: assign, creditEnabled: credit },
          )}>提交开关提案</button>{" "}

          </div>
          <div className="cregis-switch-form">
          <label><input type="checkbox" checked={payout}
            disabled={busy || loading || (!payout && !canEnableProviderPayout(data))}
            onChange={(event) => setPayout(event.target.checked)} /> 链上出款（独立开关）</label>
          <button className="l-btn sm mc"
            disabled={busy || loading || data.provisionGate.version == null
              || payout === Boolean(data.provisionGate.payoutEnabled)
              || (payout && !canEnableProviderPayout(data))}
            onClick={() => confirmCommand(
              "提交 Cregis 链上出款开关提案",
              `链上出款：${payout ? "开" : "关"}；地址分配和自动入账不变。需另一位管理员复核后生效，不会直接放行任何提现。`,
              "/cregis/switch-cases", { expectedVersion: data.provisionGate.version,
                assignEnabled: Boolean(data.provisionGate.assignEnabled),
                creditEnabled: Boolean(data.provisionGate.creditEnabled), payoutEnabled: payout },
            )}>提交出款开关提案</button>
          </div>
          {data.switchCases?.filter((row) => row.status === "MAKER_DONE").map((row) => <div className="cregis-case" key={`switch-${row.id}`}>
            提案 #{String(row.id)} · 发起人 {String(row.makerId)} · 地址 {row.assignEnabled ? "开" : "关"} / 入账 {row.creditEnabled ? "开" : "关"} / 出款 {payoutSwitchText(row)} · {String(row.reason)}{" "}
            <button className="l-btn sm" disabled={busy} onClick={() => confirmCommand(
              `复核通过 Cregis 开关提案 #${row.id}`, `发起人 ${String(row.makerId)}；地址 ${row.assignEnabled ? "开" : "关"} / 入账 ${row.creditEnabled ? "开" : "关"} / 出款 ${payoutSwitchText(row)}；发起理由 ${String(row.reason)}`,
              `/cregis/switch-cases/${row.id}/decision`, { decision: "APPROVE" },
            )}>复核通过</button>{" "}
            <button className="l-btn sm" disabled={busy} onClick={() => confirmCommand(
              `拒绝 Cregis 开关提案 #${row.id}`, `发起人 ${String(row.makerId)}；发起理由 ${String(row.reason)}`,
              `/cregis/switch-cases/${row.id}/decision`, { decision: "REJECT" },
            )}>拒绝</button>
          </div>)}
          <div className="cregis-danger-zone"><strong>紧急停用</strong><p>立即关闭地址分配、自动入账和链上出款。恢复须重新核对条件并提交审批。</p>          <button className="l-btn sm cregis-danger-button" disabled={busy || data.provisionGate.version == null} onClick={() => confirmCommand(
            "紧急关闭 Cregis 资金开关", "立即关闭地址分配、自动入账和链上出款。",
            "/cregis/switches/emergency-off", { expectedVersion: data.provisionGate.version },
          )}>紧急关闭三项开关</button></div>
        </div>
        </>}
      </section>
      <section id="cregis-funds" hidden={section !== "funds"} aria-label="归集与付款" className="cregis-content">
        <p className="sub">自动任务与人工准备单分别管理。查看各自的运行状态和执行条件后再操作。</p>
        {data && <>
          <CregisAutoForward canManage={canManage} openActionConfirm={openActionConfirm} />
          <CregisFundsPreparation canManage={canManage} openActionConfirm={openActionConfirm} />
        </>}
      </section>
    </div>
  </section>;
}
