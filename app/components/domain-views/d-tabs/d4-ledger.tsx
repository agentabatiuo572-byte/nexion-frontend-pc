"use client";

import { useEffect, useMemo, useState } from "react";
import { createD4Adjustment, fetchD4Bills, fetchD4UserLedger, type D4Bill, type D4UserLedger, type PageResult } from "@/lib/admin/d-client";
import type { DCtx } from "./types";

const OPERATOR = "superadmin";
const BILL_TYPES = [
  ["", "全部"],
  ["DEPOSIT", "充值"],
  ["WITHDRAWAL", "提现"],
  ["COMMISSION", "佣金"],
  ["ADJUSTMENT", "调账"],
  ["CHARGEBACK", "拒付"],
] as const;

function money(value: number) {
  return `$${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 2 })}`;
}

function signed(row: D4Bill) {
  return `${row.direction === "IN" || row.direction === "CREDIT" ? "+" : "-"}${money(row.amount)} ${row.asset}`;
}

function timeText(value?: string) {
  if (!value) return "—";
  return value.replace("T", " ").slice(0, 19);
}

function tone(row: D4Bill) {
  if (row.status.toUpperCase().includes("SUCCESS") || row.status.toUpperCase().includes("POSTED")) return "ok";
  if (row.status.toUpperCase().includes("FAILED") || row.status.toUpperCase().includes("REJECT")) return "bad";
  return "warn";
}

export function D4Ledger({ ctx }: { ctx: DCtx }) {
  const { toast, openConfirm } = ctx;
  const [bills, setBills] = useState<PageResult<D4Bill>>({ total: 0, pageNum: 1, pageSize: 10, records: [] });
  const [type, setType] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [userLedger, setUserLedger] = useState<D4UserLedger | null>(null);
  const [asset, setAsset] = useState("USDT");
  const [direction, setDirection] = useState("CREDIT");
  const [amount, setAmount] = useState("");
  const [relatedBizNo, setRelatedBizNo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadBills = async () => {
    setLoading(true);
    setError("");
    try {
      const next = await fetchD4Bills({ type, keyword, pageNum: page, pageSize });
      setBills(next);
      if (!selectedUserId && next.records[0]?.userId) {
        setSelectedUserId(next.records[0].userId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "D4 账单加载失败");
    } finally {
      setLoading(false);
    }
  };

  const loadUserLedger = async (userId: number) => {
    try {
      const next = await fetchD4UserLedger(userId);
      setUserLedger(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "D4 单用户账本加载失败");
    }
  };

  useEffect(() => {
    void loadBills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, page, pageSize]);

  useEffect(() => {
    if (selectedUserId) void loadUserLedger(selectedUserId);
  }, [selectedUserId]);

  const pages = Math.max(1, Math.ceil(bills.total / bills.pageSize));
  const users = useMemo(() => {
    const map = new Map<number, string>();
    bills.records.forEach((row) => map.set(row.userId, `账户 ${row.userId}`));
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [bills.records]);
  const stats = useMemo(() => {
    const inflow = bills.records.filter((row) => row.direction === "IN" || row.direction === "CREDIT").reduce((sum, row) => sum + row.amount, 0);
    const outflow = bills.records.filter((row) => row.direction !== "IN" && row.direction !== "CREDIT").reduce((sum, row) => sum + row.amount, 0);
    const pending = bills.records.filter((row) => !["SUCCESS", "POSTED"].some((key) => row.status.toUpperCase().includes(key))).length;
    return { inflow, outflow, pending };
  }, [bills.records]);

  const submitAdjustment = () => {
    if (!selectedUserId) {
      toast("请先从下拉框选择账户");
      return;
    }
    if (!amount.trim() || Number(amount) <= 0) {
      toast("请输入有效调账金额");
      return;
    }
    openConfirm({
      action: `手动调账 · 账户 ${selectedUserId}`,
      detail: `${direction === "CREDIT" ? "增加" : "扣减"} ${amount} ${asset}，关联凭证 ${relatedBizNo.trim() || "未填写"}`,
      reason: true,
      okLabel: "提交调账",
      run: (reason) => {
        void createD4Adjustment({
          userId: selectedUserId,
          asset,
          direction,
          amount,
          relatedBizNo: relatedBizNo.trim(),
          reason,
          operator: OPERATOR,
        })
          .then(() => {
            toast("调账申请已写入后端");
            setAmount("");
            setRelatedBizNo("");
            void loadBills();
            void loadUserLedger(selectedUserId);
          })
          .catch((err) => setError(err instanceof Error ? err.message : "调账失败"));
      },
    });
  };

  if (loading && bills.records.length === 0) {
    return <section className="l-card"><div className="l-b">D4 数据加载中...</div></section>;
  }

  return (
    <>
      {error && <div className="dtint warn" style={{ marginBottom: 12 }}>D4 数据加载失败 · {error}</div>}

      <div className="f-stats">
        <div className="f-stat"><div className="k">账单总数</div><div className="v">{bills.total}</div><div className="sub">后端分页返回</div></div>
        <div className="f-stat ok"><div className="k">本页入账</div><div className="v">{money(stats.inflow)}</div><div className="sub">IN / CREDIT</div></div>
        <div className="f-stat danger"><div className="k">本页出账</div><div className="v">{money(stats.outflow)}</div><div className="sub">OUT / DEBIT</div></div>
        <div className="f-stat warn"><div className="k">非终态</div><div className="v">{stats.pending}</div><div className="sub">需继续核对</div></div>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">全平台账单流水</span>
          <span className="sub">· 真实账本分页查询</span>
          <div className="r">
            <div className="chips">
              {BILL_TYPES.map(([key, label]) => (
                <button key={key || "all"} className={`chip${type === key ? " sel" : ""}`} onClick={() => { setType(key); setPage(1); }}>{label}</button>
              ))}
            </div>
            <div className="lookup">
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="账单号 / 业务号 / 备注" />
              <button className="l-btn primary" onClick={() => { setPage(1); void loadBills(); }}>查询</button>
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1050 }}>
            <thead><tr><th>账单</th><th>账户</th><th>类型</th><th className="num">金额</th><th className="num">滚动余额</th><th>状态</th><th>备注</th><th>时间</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {bills.records.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--ink-4)", padding: "28px 12px" }}>暂无账单流水</td></tr>
              ) : bills.records.map((row) => (
                <tr key={row.id}>
                  <td className="mono" style={{ color: "var(--ink)" }}>{row.bizNo}</td>
                  <td className="mono">账户 {row.userId}</td>
                  <td><span className="bdg dim">{row.bizType}</span></td>
                  <td className="num mono" style={{ color: row.direction === "IN" || row.direction === "CREDIT" ? "var(--success)" : "var(--negative)", fontWeight: 700 }}>{signed(row)}</td>
                  <td className="num mono">{money(row.balanceAfter)} {row.asset}</td>
                  <td><span className={`bdg ${tone(row)}`}>{row.status}</span></td>
                  <td style={{ color: "var(--ink-4)" }}>{row.remark}</td>
                  <td className="mono" style={{ color: "var(--ink-4)" }}>{timeText(row.createdAt)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="l-btn sm" onClick={() => setSelectedUserId(row.userId)}>查看账户</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span className="sub">共 {bills.total} 条 · 第 {bills.pageNum}/{pages} 页</span>
          <div className="chips">
            {[10, 20, 50].map((size) => <button key={size} className={`chip${pageSize === size ? " sel" : ""}`} onClick={() => { setPageSize(size); setPage(1); }}>{size}/页</button>)}
            <button className="chip" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</button>
            <button className="chip" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>下一页</button>
          </div>
        </div>
      </section>

      <div className="two-col r11">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">单账户账本</span>
            <span className="sub">· 从当前查询结果下拉选择账户</span>
            <div className="r">
              <select value={selectedUserId ?? ""} onChange={(e) => setSelectedUserId(Number(e.target.value) || null)} style={{ background: "var(--surface-2)", color: "var(--ink)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "7px 10px" }}>
                {users.length === 0 && <option value="">暂无账户</option>}
                {users.map((user) => <option key={user.id} value={user.id}>{user.label}</option>)}
              </select>
            </div>
          </div>
          <div className="l-b">
            <div className="sum-grid">
              <div className="s"><div className="k">USDT 当前余额</div><div className="v">{money(userLedger?.balance.USDT ?? 0)}</div></div>
              <div className="s"><div className="k">NEX 当前余额</div><div className="v">{money(userLedger?.balance.NEX ?? 0)}</div></div>
              <div className="s"><div className="k">USDT 累计</div><div className="v">{money(userLedger?.totals.USDT ?? 0)}</div></div>
              <div className="s"><div className="k">NEX 累计</div><div className="v">{money(userLedger?.totals.NEX ?? 0)}</div></div>
            </div>
            {(userLedger?.rows ?? []).map((row) => (
              <div className="rb-row" key={row.id}>
                <span className="mono" style={{ color: "var(--ink-4)" }}>{timeText(row.createdAt)}</span>
                <span>{row.bizType} · {row.bizNo}</span>
                <span className="mono" style={{ fontWeight: 700, color: row.direction === "IN" || row.direction === "CREDIT" ? "var(--success)" : "var(--negative)" }}>{signed(row)}</span>
                <span className="mono">余 {money(row.balanceAfter)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">手动调账</span>
            <span className="sub">· 账户从下拉框选择，提交写后端</span>
          </div>
          <div className="l-b">
            <div className="lookup" style={{ marginBottom: 10 }}>
              <select value={selectedUserId ?? ""} onChange={(e) => setSelectedUserId(Number(e.target.value) || null)} style={{ background: "var(--surface-2)", color: "var(--ink)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "7px 10px" }}>
                {users.length === 0 && <option value="">暂无账户</option>}
                {users.map((user) => <option key={user.id} value={user.id}>{user.label}</option>)}
              </select>
              <select value={asset} onChange={(e) => setAsset(e.target.value)} style={{ background: "var(--surface-2)", color: "var(--ink)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "7px 10px" }}>
                <option value="USDT">USDT</option>
                <option value="NEX">NEX</option>
              </select>
              <select value={direction} onChange={(e) => setDirection(e.target.value)} style={{ background: "var(--surface-2)", color: "var(--ink)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "7px 10px" }}>
                <option value="CREDIT">增加</option>
                <option value="DEBIT">扣减</option>
              </select>
            </div>
            <div className="lookup">
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="金额" />
              <input value={relatedBizNo} onChange={(e) => setRelatedBizNo(e.target.value)} placeholder="关联业务单号" />
              <button className="l-btn primary" onClick={submitAdjustment}>提交调账</button>
            </div>
            <div className="dtint" style={{ marginTop: 12 }}>提交后生成调账单，后端返回 PENDING_REVIEW，账本变更仍由后端流程裁决。</div>
          </div>
        </section>
      </div>
    </>
  );
}
