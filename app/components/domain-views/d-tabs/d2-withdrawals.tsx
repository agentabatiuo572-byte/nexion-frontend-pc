"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchD2Withdrawals,
  fetchD5WithdrawalParams,
  reviewD2Withdrawal,
  type D2Withdrawal,
  type D5Params as D5ParamData,
  type PageResult,
} from "@/lib/admin/d-client";
import type { DCtx } from "./types";

const OPERATOR = "superadmin";
const STATUS_TABS = [
  ["", "全部"],
  ["REVIEWING", "待审核"],
  ["DELAYED", "延迟"],
  ["FROZEN", "冻结"],
  ["PENDING_CHAIN", "待链上"],
  ["SUCCESS", "成功"],
  ["REJECTED", "驳回"],
] as const;

function money(value: number) {
  return `$${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function timeText(value?: string) {
  if (!value) return "—";
  return value.replace("T", " ").slice(0, 19);
}

function statusTone(status: string) {
  const s = status.toUpperCase();
  if (["SUCCESS", "CHAIN_SUBMITTED"].includes(s)) return "ok";
  if (["REJECTED", "FAILED", "DEAD"].includes(s)) return "bad";
  if (["FROZEN", "DELAYED"].includes(s)) return "warn";
  return "dim";
}

function statusLabel(status: string) {
  return ({
    REVIEWING: "待审核",
    DELAYED: "延迟",
    FROZEN: "冻结",
    PENDING_CHAIN: "待链上",
    CHAIN_SUBMITTED: "链上已提交",
    SUCCESS: "成功",
    REJECTED: "驳回",
    FAILED: "失败",
    DEAD: "死亡信件",
  } as Record<string, string>)[status.toUpperCase()] ?? status;
}

function actionLabel(action: string) {
  return ({
    APPROVE: "放行",
    DELAY: "延迟",
    FREEZE: "冻结",
    UNFREEZE: "解冻",
    REJECT: "驳回",
  } as Record<string, string>)[action] ?? action;
}

function isDailyLimitExceeded(row: D2Withdrawal, dailyLimitCount: number) {
  return Number(row.withdrawalCount24h || 0) > dailyLimitCount;
}

function isKycApproved(row: D2Withdrawal) {
  const status = row.kycStatus.toUpperCase();
  return status === "VERIFIED" || status === "APPROVED";
}

function isUserActive(row: D2Withdrawal) {
  return row.userStatus.toUpperCase() === "ACTIVE";
}

function hasBlockingRisk(row: D2Withdrawal) {
  const hitRules = row.hitRules.trim().toUpperCase();
  return row.riskScore >= 70 || (hitRules !== "" && !["[]", "{}", "NULL", "NONE", "-", "—"].includes(hitRules));
}

function approveBlockReason(row: D2Withdrawal, dailyLimitCount: number) {
  if (isDailyLimitExceeded(row, dailyLimitCount)) return "超日限";
  if (!isKycApproved(row)) return "KYC未通过";
  if (!isUserActive(row)) return "账户受限";
  if (hasBlockingRisk(row)) return "风险待处理";
  return "";
}

function errorText(err: unknown) {
  const message = err instanceof Error ? err.message : "D2 审核失败";
  if (message === "WITHDRAWAL_DAILY_LIMIT_EXCEEDED") {
    return "已超过 D5 每日提现次数，请先调整 D5 日限或延迟处理";
  }
  if (message === "WITHDRAWAL_KYC_NOT_APPROVED") {
    return "KYC 未通过，不能直接放行提现";
  }
  if (message === "WITHDRAWAL_USER_STATUS_BLOCKED") {
    return "用户账户不是 ACTIVE 状态，不能直接放行提现";
  }
  if (message === "WITHDRAWAL_RISK_HIT_BLOCKED") {
    return "提现命中高风险或风险规则，不能直接放行提现";
  }
  return message;
}

function availableActions(row: D2Withdrawal): Array<"APPROVE" | "DELAY" | "FREEZE" | "UNFREEZE" | "REJECT"> {
  const status = row.status.toUpperCase();
  const actions: Array<"APPROVE" | "DELAY" | "FREEZE" | "UNFREEZE" | "REJECT"> = [];
  if (["REVIEWING", "DELAYED"].includes(status)) actions.push("APPROVE", "DELAY");
  if (!["SUCCESS", "FAILED", "REJECTED"].includes(status)) actions.push("FREEZE");
  if (status === "FROZEN") actions.push("UNFREEZE");
  if (["REVIEWING", "DELAYED", "FROZEN", "PENDING_CHAIN", "CHAIN_SUBMITTED", "DEAD"].includes(status)) actions.push("REJECT");
  return Array.from(new Set(actions));
}

export function D2Withdrawals({ ctx }: { ctx: DCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const [rows, setRows] = useState<PageResult<D2Withdrawal>>({ total: 0, pageNum: 1, pageSize: 10, records: [] });
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [d5Params, setD5Params] = useState<D5ParamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async (nextPage = page) => {
    setLoading(true);
    setError("");
    try {
      const [next, nextD5Params] = await Promise.all([
        fetchD2Withdrawals({
          status,
          keyword,
          pageNum: nextPage,
          pageSize,
        }),
        fetchD5WithdrawalParams().catch(() => null),
      ]);
      setRows(next);
      if (nextD5Params) {
        setD5Params(nextD5Params);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page, pageSize]);

  const dailyLimitCount = Math.max(1, Math.min(10, Math.trunc(d5Params?.dailyLimitCount ?? 1)));
  const stats = useMemo(() => {
    const totalAmount = rows.records.reduce((sum, row) => sum + row.amount, 0);
    const highRisk = rows.records.filter((row) => row.riskScore >= 70).length;
    const overDailyLimit = rows.records.filter((row) => isDailyLimitExceeded(row, dailyLimitCount)).length;
    return { totalAmount, highRisk, overDailyLimit };
  }, [dailyLimitCount, rows.records]);
  const pages = Math.max(1, Math.ceil(rows.total / rows.pageSize));

  const runFilterQuery = () => {
    if (page === 1) {
      void load(1);
      return;
    }
    setPage(1);
  };

  const runReview = async (row: D2Withdrawal, action: "APPROVE" | "DELAY" | "FREEZE" | "UNFREEZE" | "REJECT", reason: string) => {
    try {
      const updated = await reviewD2Withdrawal(row.withdrawalNo, action, reason, OPERATOR);
      toast(`${row.withdrawalNo} 已${actionLabel(action)} · 当前 ${statusLabel(updated.status)}`);
      await load();
    } catch (err) {
      const message = errorText(err);
      setError(message);
      toast(message);
    }
  };

  const confirmReview = (row: D2Withdrawal, action: "APPROVE" | "DELAY" | "FREEZE" | "UNFREEZE" | "REJECT") => {
    const label = actionLabel(action);
    if (action === "APPROVE" || action === "UNFREEZE") {
      const limitHint = `24h 次数 ${row.withdrawalCount24h}/${dailyLimitCount}`;
      const blockedHint = action === "APPROVE" ? approveBlockReason(row, dailyLimitCount) : "";
      openActionConfirm({
        action: `${label}提现 · ${row.withdrawalNo}`,
        detail: `${row.userNo} / ${money(row.amount)} ${row.asset}，${limitHint}${blockedHint ? `；当前阻断：${blockedHint}` : ""}；放大资金流出方向会走覆盖率预检。`,
        amplifies: true,
        coverage: d5Params ? { coverageRatio: d5Params.coverageRatio, redlinePct: d5Params.redlinePct } : undefined,
        run: (reason) => void runReview(row, action, reason),
      });
      return;
    }
    openConfirm({
      action: `${label}提现 · ${row.withdrawalNo}`,
      detail: `${row.userNo} / ${money(row.amount)} ${row.asset}，保存后重新查询提现队列。`,
      reason: true,
      okLabel: label,
      run: (reason) => void runReview(row, action, reason),
    });
  };

  if (loading && rows.records.length === 0) {
    return <section className="l-card"><div className="l-b">D2 数据加载中...</div></section>;
  }

  return (
    <>
      {error && <div className="dtint warn" style={{ marginBottom: 12 }}>D2 数据加载失败 · {error}</div>}

      <div className="f-stats">
        <div className="f-stat"><div className="k">当前筛选</div><div className="v">{rows.total}</div><div className="sub">分页返回总数</div></div>
        <div className="f-stat cyan"><div className="k">本页金额</div><div className="v">{money(stats.totalAmount)}</div><div className="sub">当前页 {rows.records.length} 笔提现</div></div>
        <div className="f-stat warn"><div className="k">高风险</div><div className="v">{stats.highRisk}</div><div className="sub">风险分 ≥ 70</div></div>
        <div className="f-stat danger"><div className="k">超出日限</div><div className="v">{stats.overDailyLimit}</div><div className="sub">当前日限 {dailyLimitCount} 次</div></div>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">提现审核队列</span>
          <span className="sub">· 分页查询 · 状态实时推进</span>
        </div>
        <div className="l-b" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div className="d2-filter-grid">
            <label className="d2-filter-field d2-keyword-field">
              <span>提现单号查询</span>
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="提现单号 / 用户编码" />
            </label>
            <label className="d2-filter-field">
              <span>状态</span>
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                {STATUS_TABS.map(([key, label]) => (
                  <option key={key || "all"} value={key}>{label}</option>
                ))}
              </select>
            </label>
            <button className="l-btn primary" onClick={runFilterQuery}>查询</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1260 }}>
            <thead>
              <tr>
                <th>提现单</th><th>用户编码</th><th>用户</th><th>资产/链</th><th className="num">金额</th><th className="num">手续费</th><th>风险</th><th>24h次数</th><th>状态</th><th>地址</th><th>创建时间</th><th style={{ textAlign: "right" }}>动作</th>
              </tr>
            </thead>
            <tbody>
              {rows.records.length === 0 ? (
                <tr><td colSpan={12} style={{ textAlign: "center", color: "var(--ink-4)", padding: "30px 12px" }}>暂无提现记录</td></tr>
              ) : rows.records.map((row) => {
                const dailyBlocked = isDailyLimitExceeded(row, dailyLimitCount);
                return (
                  <tr key={row.withdrawalNo}>
                    <td className="mono" style={{ color: "var(--ink)" }}>{row.withdrawalNo}</td>
                    <td className="mono">{row.userNo}</td>
                    <td>{row.nickname}<div className="mono" style={{ color: "var(--ink-4)", fontSize: 11 }}>{row.userStatus} · KYC {row.kycStatus}</div></td>
                    <td>{row.asset} / {row.chain}</td>
                    <td className="num mono" style={{ color: "var(--ink)", fontWeight: 700 }}>{money(row.amount)}</td>
                    <td className="num mono">{money(row.fee)}</td>
                    <td><span className={`bdg ${row.riskScore >= 70 ? "bad" : row.riskScore >= 45 ? "warn" : "ok"}`}>{row.riskScore}</span><div className="mono" style={{ color: "var(--ink-4)", fontSize: 11 }}>{row.hitRules || "—"}</div></td>
                    <td><span className={`bdg ${dailyBlocked ? "bad" : row.withdrawalCount24h >= dailyLimitCount ? "warn" : "ok"}`}>{row.withdrawalCount24h}/{dailyLimitCount}</span></td>
                    <td><span className={`bdg ${statusTone(row.status)}`}>{statusLabel(row.status)}</span></td>
                    <td className="mono" style={{ maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis" }}>{row.targetAddress}</td>
                    <td className="mono" style={{ color: "var(--ink-4)" }}>{timeText(row.createdAt)}</td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {availableActions(row).map((action) => {
                          const approveReason = action === "APPROVE" ? approveBlockReason(row, dailyLimitCount) : "";
                          const disabled = action === "APPROVE" && approveReason !== "";
                          return (
                            <button
                              key={action}
                              className={`l-btn sm ${action === "APPROVE" || action === "UNFREEZE" ? "mc" : ""}`}
                              disabled={disabled}
                              title={disabled ? approveReason : undefined}
                              onClick={() => confirmReview(row, action)}>
                              {disabled ? approveReason : actionLabel(action)}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span className="sub">共 {rows.total} 条 · 第 {rows.pageNum}/{pages} 页</span>
          <div className="chips">
            {[10, 20, 50].map((size) => <button key={size} className={`chip${pageSize === size ? " sel" : ""}`} onClick={() => { setPageSize(size); setPage(1); }}>{size}/页</button>)}
            <button className="chip" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</button>
            <button className="chip" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>下一页</button>
          </div>
        </div>
      </section>
    </>
  );
}
