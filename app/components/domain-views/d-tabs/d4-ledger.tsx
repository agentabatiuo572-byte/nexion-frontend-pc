"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  downloadD4BillsCsv,
  fetchD4Bills,
  fetchD4RunningBalance,
  fetchD4UserLedger,
  type D4Bill,
  type D4BillQuery,
  type D4BillType,
  type D4RunningBalance,
  type D4UserLedger,
  type PageResult,
} from "@/lib/admin/d-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { DCtx } from "./types";

const BILL_TYPES: ReadonlyArray<readonly [D4BillType | "", string]> = [
  ["", "全部"],
  ["swap", "兑换"],
  ["topup", "充值"],
  ["withdraw", "提现"],
  ["earning", "收益"],
  ["commission", "佣金"],
  ["refund", "退款"],
  ["bonus", "奖励"],
];

const BILL_TYPE_LABELS: Record<D4BillType, string> = Object.fromEntries(BILL_TYPES.slice(1)) as Record<D4BillType, string>;
const BILL_STATUS_LABELS: Record<string, string> = {
  SUCCESS: "已入账", POSTED: "已入账", COMPLETED: "已完成", PENDING: "处理中",
  PROCESSING: "处理中", FAILED: "失败", REJECTED: "已拒绝",
};
const EMPTY_PAGE: PageResult<D4Bill> = { total: 0, pageNum: 1, pageSize: 10, records: [] };

function assetAmount(value: number, asset: string) {
  const digits = asset === "USDT" ? 6 : 8;
  const formatted = Number(value).toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: asset === "USDT" ? 2 : 0,
  });
  return asset === "USDT" ? `$${formatted}` : formatted;
}

function signed(row: D4Bill) {
  return `${row.direction === "IN" || row.direction === "CREDIT" ? "+" : "-"}${assetAmount(row.amount, row.asset)} ${row.asset}`;
}

function timeText(value?: string) {
  return value ? value.replace("T", " ").slice(0, 19) : "—";
}

function tone(row: D4Bill) {
  if (["SUCCESS", "POSTED", "COMPLETED"].includes(row.status.toUpperCase())) return "ok";
  if (["FAILED", "REJECTED"].includes(row.status.toUpperCase())) return "bad";
  return "warn";
}

function userLabel(row: Pick<D4Bill, "userNo" | "nickname"> | Pick<D4UserLedger, "userNo" | "nickname"> | null | undefined) {
  return row ? [row.userNo, row.nickname].filter(Boolean).join(" · ") || "—" : "—";
}

function positiveUserId(value: string) {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function D4Ledger({ ctx }: { ctx: DCtx }) {
  const searchParams = useSearchParams();
  const deepBizNo = searchParams.get("bizNo")?.trim() ?? "";
  const deepKeyword = searchParams.get("keyword")?.trim() ?? "";
  const deepStatus = searchParams.get("status")?.trim().toUpperCase() ?? "";
  const deepUserId = positiveUserId(searchParams.get("userId") ?? "");
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const isSuperAdmin = session?.role === "superadmin";
  const canGlobalRead = isSuperAdmin || authorities.includes("finance_d4_read");
  const canUserRead = canGlobalRead || authorities.includes("finance_d4_user_read");
  const canExport = isSuperAdmin || authorities.includes("finance_d4_export");

  const [bills, setBills] = useState<PageResult<D4Bill>>(EMPTY_PAGE);
  const [draft, setDraft] = useState({ userId: deepUserId ? String(deepUserId) : "", keyword: deepBizNo || deepKeyword, status: deepStatus, from: "", to: "" });
  const [applied, setApplied] = useState({ userId: deepUserId ?? undefined, keyword: deepBizNo || deepKeyword, status: deepStatus, from: "", to: "" });
  const [type, setType] = useState<D4BillType | "">("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(deepUserId);
  const [userInput, setUserInput] = useState(deepUserId ? String(deepUserId) : "");
  const [userLedger, setUserLedger] = useState<D4UserLedger | null>(null);
  const [runningBalance, setRunningBalance] = useState<D4RunningBalance | null>(null);
  const [loading, setLoading] = useState(canGlobalRead);
  const [userLoading, setUserLoading] = useState(false);
  const [error, setError] = useState("");
  const [userError, setUserError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const billsRequest = useRef(0);
  const userRequest = useRef(0);

  useEffect(() => {
    if (!canGlobalRead) {
      setBills(EMPTY_PAGE);
      setLoading(false);
      return;
    }
    const requestId = ++billsRequest.current;
    setLoading(true);
    setBills({ total: 0, pageNum: page, pageSize, records: [] });
    setError("");
    const query: D4BillQuery = {
      type,
      userId: applied.userId,
      bizNo: deepBizNo && applied.keyword === deepBizNo ? deepBizNo : undefined,
      keyword: deepBizNo && applied.keyword === deepBizNo ? undefined : applied.keyword,
      status: applied.status,
      from: applied.from,
      to: applied.to,
      pageNum: page,
      pageSize,
    };
    void fetchD4Bills(query).then((next) => {
      if (requestId !== billsRequest.current) return;
      setBills(next);
      if (next.records.length === 0) {
        setSelectedUserId(null);
        setUserInput("");
        setUserLedger(null);
        setRunningBalance(null);
      } else if (!selectedUserId && next.records[0]?.userId) {
        setSelectedUserId(next.records[0].userId);
        setUserInput(String(next.records[0].userId));
      }
    }).catch((reason) => {
      if (requestId !== billsRequest.current) return;
      setBills(EMPTY_PAGE);
      ++userRequest.current;
      setSelectedUserId(null);
      setUserInput("");
      setUserLedger(null);
      setRunningBalance(null);
      setError(reason instanceof Error ? reason.message : "资金账单加载失败");
    }).finally(() => {
      if (requestId === billsRequest.current) setLoading(false);
    });
  }, [applied, canGlobalRead, deepBizNo, page, pageSize, reloadKey, selectedUserId, type]);

  useEffect(() => {
    if (!selectedUserId || !canUserRead) {
      setUserLedger(null);
      setRunningBalance(null);
      return;
    }
    const requestId = ++userRequest.current;
    setUserLoading(true);
    setUserError("");
    void Promise.all([fetchD4UserLedger(selectedUserId), fetchD4RunningBalance(selectedUserId)]).then(([ledger, running]) => {
      if (requestId !== userRequest.current) return;
      setUserLedger(ledger);
      setRunningBalance(running);
    }).catch((reason) => {
      if (requestId !== userRequest.current) return;
      setUserLedger(null);
      setRunningBalance(null);
      setUserError(reason instanceof Error ? reason.message : "单用户对账加载失败");
    }).finally(() => {
      if (requestId === userRequest.current) setUserLoading(false);
    });
  }, [canUserRead, reloadKey, selectedUserId]);

  const pages = Math.max(1, Math.ceil(bills.total / bills.pageSize));
  const stats = useMemo(() => {
    const inflow = bills.records.filter((row) => row.direction === "IN" || row.direction === "CREDIT").length;
    const outflow = bills.records.length - inflow;
    const pending = bills.records.filter((row) => !["SUCCESS", "POSTED", "COMPLETED"].includes(row.status.toUpperCase())).length;
    return { inflow, outflow, pending };
  }, [bills.records]);

  const applyFilters = () => {
    const parsedUserId = draft.userId.trim() ? positiveUserId(draft.userId) : null;
    if (draft.userId.trim() && !parsedUserId) {
      setError("用户 ID 必须是正整数");
      return;
    }
    if (draft.from && draft.to && draft.from >= draft.to) {
      setError("开始时间必须早于结束时间");
      return;
    }
    setApplied({ userId: parsedUserId ?? undefined, keyword: draft.keyword.trim(), status: draft.status, from: draft.from, to: draft.to });
    setPage(1);
  };

  const openUser = (value = userInput) => {
    const userId = positiveUserId(value);
    if (!userId) {
      setUserError("请输入有效的正整数用户 ID");
      return;
    }
    setUserInput(String(userId));
    setSelectedUserId(userId);
  };

  const exportCsv = async (reason: string) => {
    if (error) return;
    try {
      setError("");
      await downloadD4BillsCsv(
        { type, ...applied, bizNo: deepBizNo && applied.keyword === deepBizNo ? deepBizNo : undefined },
        reason,
      );
      ctx.toast("脱敏账单 CSV 已下载并留痕");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "账单导出失败");
    }
  };
  const requestExport = () => ctx.openActionConfirm({
    action: "导出七类账单脱敏明细",
    detail: <>导出沿用当前七类账单、用户、时间和状态筛选；用户编码由服务端强制脱敏，最多 10 万行，理由与范围写入统一导出审计。</>,
    reasonMin: 8,
    reasonMax: 200,
    run: (reason) => exportCsv(reason),
  });

  return (
    <>
      {(error || userError) && (
        <div className="dtint warn" data-proof="d4-fail-closed" style={{ marginBottom: 12 }}>
          资金账本已停止展示旧数据 · {error || userError}　
          <button className="l-btn sm" onClick={() => setReloadKey((value) => value + 1)}>重试</button>
        </div>
      )}
      {deepBizNo && <div className="dtint cyan" data-proof="d4-deep-link" style={{ marginBottom: 12 }}>正在精确定位 C3 余额调整关联账单 · <b className="mono">{deepBizNo}</b>{!loading && bills.records.length === 0 ? " · 未找到匹配账单" : ""}</div>}

      <div className="f-stats">
        <div className="f-stat"><div className="k">账单总数</div><div className="v">{bills.total}</div><div className="sub">服务端当前筛选总数</div></div>
        <div className="f-stat ok"><div className="k">本页入账</div><div className="v">{stats.inflow}</div><div className="sub">增加余额笔数</div></div>
        <div className="f-stat danger"><div className="k">本页出账</div><div className="v">{stats.outflow}</div><div className="sub">扣减余额笔数</div></div>
        <div className="f-stat warn"><div className="k">本页非终态</div><div className="v">{stats.pending}</div><div className="sub">需继续核对</div></div>
      </div>

      <section className="l-card">
        <div className="l-h"><span className="ttl">全平台账单流水</span><span className="sub">· 服务端分页 · 精确七类</span></div>
        {!canGlobalRead ? <div className="l-b"><div className="dtint">当前角色仅可按用户核对，不可浏览全平台流水。</div></div> : (
          <>
            <div className="l-b" style={{ display: "grid", gap: 10 }}>
              <div className="chips">
                {BILL_TYPES.map(([key, label]) => <button key={key || "all"} className={`chip${type === key ? " sel" : ""}`} onClick={() => { setType(key); setPage(1); }}>{label}</button>)}
              </div>
              <div className="lookup" style={{ flexWrap: "wrap" }}>
                <input aria-label="精确用户 ID" value={draft.userId} onChange={(event) => setDraft((value) => ({ ...value, userId: event.target.value }))} placeholder="用户 ID" />
                <select aria-label="账单状态" value={draft.status} onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value }))}>
                  <option value="">全部状态</option><option value="POSTED">已入账</option><option value="SUCCESS">成功</option><option value="PENDING">处理中</option><option value="FAILED">失败</option><option value="REJECTED">已拒绝</option>
                </select>
                <input aria-label="开始时间" type="datetime-local" value={draft.from} onChange={(event) => setDraft((value) => ({ ...value, from: event.target.value }))} />
                <input aria-label="结束时间" type="datetime-local" value={draft.to} onChange={(event) => setDraft((value) => ({ ...value, to: event.target.value }))} />
                <input aria-label="账单关键词" value={draft.keyword} onChange={(event) => setDraft((value) => ({ ...value, keyword: event.target.value }))} placeholder="账单号 / 用户编码 / 昵称 / 备注" />
                <button className="l-btn primary" onClick={applyFilters}>查询</button>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="l-tbl" style={{ minWidth: 1120 }}>
                <thead><tr><th>账单</th><th>账户</th><th>七类科目</th><th>业务子类</th><th className="num">金额</th><th className="num">滚动余额</th><th>状态</th><th>备注</th><th>时间</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
                <tbody>
                  {loading ? <tr><td colSpan={10} style={{ textAlign: "center", padding: 28 }}>资金账本数据加载中...</td></tr> : bills.records.length === 0 ? <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--ink-4)", padding: 28 }}>暂无匹配账单流水；空数据不代表已经对平</td></tr> : bills.records.map((row) => (
                    <tr key={row.id} style={deepBizNo && row.bizNo === deepBizNo ? { background: "color-mix(in srgb, var(--c-ac) 12%, transparent)" } : undefined}>
                      <td className="mono" style={{ color: "var(--ink)" }}>{row.bizNo}</td>
                      <td><span className="mono">{row.userNo}</span>{row.nickname && <div style={{ color: "var(--ink-4)", fontSize: 11 }}>{row.nickname}</div>}</td>
                      <td><span className="bdg dim">{BILL_TYPE_LABELS[row.billType]}</span></td><td className="mono">{row.subtype}</td>
                      <td className="num mono" style={{ color: row.direction === "IN" || row.direction === "CREDIT" ? "var(--success)" : "var(--negative)", fontWeight: 700 }}>{signed(row)}</td>
                      <td className="num mono">{assetAmount(row.balanceAfter, row.asset)} {row.asset}</td>
                      <td><span className={`bdg ${tone(row)}`}>{BILL_STATUS_LABELS[row.status.toUpperCase()] ?? row.status}</span></td>
                      <td style={{ color: "var(--ink-4)" }}>{row.remark || "—"}</td><td className="mono" style={{ color: "var(--ink-4)" }}>{timeText(row.createdAt)}</td>
                      <td style={{ textAlign: "right" }}><button className="l-btn sm" onClick={() => { setUserInput(String(row.userId)); setSelectedUserId(row.userId); }}>查看账户</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="l-b" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <span className="sub">共 {bills.total} 条 · 第 {bills.pageNum}/{pages} 页</span>
              <div className="chips">{[10, 20, 50].map((size) => <button key={size} className={`chip${pageSize === size ? " sel" : ""}`} onClick={() => { setPageSize(size); setPage(1); }}>{size}/页</button>)}<button className="chip" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><button className="chip" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>下一页</button></div>
            </div>
          </>
        )}
      </section>

      <section className="l-card">
        <div className="l-h"><span className="ttl">单用户全部账本与分类汇总</span><span className="sub">· 独立输入，不受当前页限制</span><div className="r"><div className="lookup"><input aria-label="单用户账本用户 ID" value={userInput} onChange={(event) => setUserInput(event.target.value)} placeholder="输入用户 ID" /><button className="l-btn primary" disabled={!canUserRead} onClick={() => openUser()}>加载账户</button></div></div></div>
        <div className="l-b">
          {userLoading ? <div className="dtint">正在核对用户账本与钱包余额...</div> : userLedger ? <>
            <div className="dtint cyan">{userLabel(userLedger)} · 全量 {userLedger.total} 笔；当前余额独立读取用户钱包</div>
            <div className="sum-grid">
              <div className="s"><div className="k">USDT 当前余额</div><div className="v">{assetAmount(userLedger.balance.USDT, "USDT")}</div></div>
              <div className="s"><div className="k">NEX 当前余额</div><div className="v">{assetAmount(userLedger.balance.NEX, "NEX")}</div></div>
              {Object.entries(userLedger.categoryTotals).map(([key, value]) => { const [kind, asset] = key.split(":"); return <div className="s" key={key}><div className="k">{BILL_TYPE_LABELS[kind as D4BillType] ?? kind} · {asset}</div><div className="v">{assetAmount(value, asset)}</div></div>; })}
            </div>
            {userLedger.rows.length === 0 ? <div className="dtint">该用户暂无资金账单；当前余额仍以钱包记录为准。</div> : userLedger.rows.map((row) => <div className="rb-row" key={row.id}><span className="mono" style={{ color: "var(--ink-4)" }}>{timeText(row.createdAt)}</span><span>{BILL_TYPE_LABELS[row.billType]} · {row.bizNo}</span><span className="mono" style={{ fontWeight: 700 }}>{signed(row)}</span><span className="mono">余 {assetAmount(row.balanceAfter, row.asset)} {row.asset}</span></div>)}
          </> : <div className="dtint">输入用户 ID 后加载该用户全部账单、七类汇总与当前钱包余额。</div>}
        </div>
      </section>

      <section className="l-card">
        <div className="l-h"><span className="ttl">Running Balance 断点核对</span><span className="sub">· 每笔余额连续性 + 最新账本与钱包差额</span></div>
        <div className="l-b">
          {runningBalance ? <>
            <div className={`dtint ${runningBalance.balanced ? "cyan" : "warn"}`} data-proof="d4-running-balance">{runningBalance.balanced ? "账本连续，且最新余额与钱包一致" : `发现 ${runningBalance.breakCount} 个账实断点，请回到对应业务单核查；D4 不提供调账入口`}</div>
            <div className="sum-grid"><div className="s"><div className="k">USDT 钱包差额</div><div className="v">{runningBalance.reconciliation.USDT}</div></div><div className="s"><div className="k">NEX 钱包差额</div><div className="v">{runningBalance.reconciliation.NEX}</div></div></div>
            {runningBalance.rows.map((item) => <div className={`rb-row${item.breakDetected ? " warn" : ""}`} key={item.bill.id}><span className="mono">{timeText(item.bill.createdAt)}</span><span>{item.breakDetected ? "⚠ 断点" : "连续"} · {item.bill.bizNo}</span><span className="mono">期望 {item.expectedBalanceAfter}</span><span className="mono">实际 {item.bill.balanceAfter} · 差 {item.difference}</span></div>)}
          </> : <div className="dtint">先加载单用户账本，即可检查时间轴断点与钱包最终余额。</div>}
        </div>
      </section>

      <section className="l-card">
        <div className="l-h"><span className="ttl">脱敏对账导出</span><span className="sub">· 沿用当前七类 / 用户 / 时间 / 状态筛选</span><div className="r"><button className="l-btn primary" disabled={!canExport || loading || Boolean(error)} title={error ? "账单事实加载失败，恢复前禁止导出" : undefined} onClick={requestExport}>{canExport ? "导出脱敏 CSV" : "当前角色不可导出"}</button></div></div>
        <div className="l-b"><div className="dtint">固定隐藏昵称等个人信息，用户编码仅保留首尾；导出动作写审计。需要纠正余额时唯一入口为 C3。</div><div className="chips" style={{ marginTop: 10 }}><Link className="chip" href="/users/assets">C3 余额调整</Link><Link className="chip" href="/finance/recon">D1 充值对账</Link><Link className="chip" href="/finance/withdrawals">D2 提现审核</Link><Link className="chip" href="/finance/pool">D3 资金池</Link><Link className="chip" href="/platform/events">A4 资金事件</Link><Link className="chip" href="/analytics/export">L5 监管导出</Link></div></div>
      </section>
    </>
  );
}
