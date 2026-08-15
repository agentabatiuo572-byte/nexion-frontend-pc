"use client";

import { useCallback, useEffect, useState } from "react";
import { Drawer } from "../design-kit";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  ACCOUNT_DELETION_STATUSES,
  fetchAccountDeletion,
  fetchAccountDeletions,
  updateAccountDeletion,
  type AccountDeletionRequest,
  type AccountDeletionStatus,
} from "@/lib/admin/account-deletion-client";

const LABELS: Record<string, string> = {
  REQUESTED: "待审核",
  IN_REVIEW: "审核中",
  BLOCKED: "已阻断",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

const ACTION_LABELS = { review: "开始审核", block: "阻断申请", complete: "完成注销", cancel: "取消申请" } as const;

function tone(status: string) {
  if (status === "COMPLETED") return "ok";
  if (status === "BLOCKED") return "bad";
  if (status === "CANCELLED") return "dim";
  return "warn";
}

function date(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN", { hour12: false });
}

function availableActions(status: string): Array<keyof typeof ACTION_LABELS> {
  if (status === "REQUESTED") return ["review", "block", "cancel"];
  if (status === "IN_REVIEW") return ["block", "complete", "cancel"];
  return [];
}

export function AccountDeletionQueue({ toast }: { toast: (message: string) => void }) {
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const canRead = session?.role === "superadmin" || authorities.includes("user_c1_read");
  const canWrite = session?.role === "superadmin" || authorities.includes("user_c1_write");
  const [status, setStatus] = useState<AccountDeletionStatus | "">("");
  const [rows, setRows] = useState<AccountDeletionRequest[]>([]);
  const [selected, setSelected] = useState<AccountDeletionRequest | null>(null);
  const [reason, setReason] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!canRead) return;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const result = await fetchAccountDeletions(status, page, 20);
      setRows(result.records);
      setTotal(result.total);
      if (selected) {
        const current = result.records.find((item) => item.requestNo === selected.requestNo);
        if (current) setSelected(current);
      }
    } catch (cause) {
      setError(displayAdminError(cause));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [canRead, page, selected, status]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openDetail = async (row: AccountDeletionRequest) => {
    setSelected(row);
    setReason("");
    try { setSelected(await fetchAccountDeletion(row.requestNo)); }
    catch (cause) { toast(`读取注销申请失败：${displayAdminError(cause)}`); }
  };

  const act = async (action: keyof typeof ACTION_LABELS) => {
    if (!selected || !canWrite) return;
    const normalized = reason.trim();
    if (normalized.length < 1) { toast("请填写本次审核理由。"); return; }
    setBusy(true);
    try {
      const expectedVersion = selected.version;
      const next = await updateAccountDeletion(selected.requestNo, action, expectedVersion, normalized);
      setSelected(next);
      setReason("");
      toast(`${ACTION_LABELS[action]}成功，审计反馈已写入；当前版本 ${next.version}。`);
      await refresh(true);
    } catch (cause) {
      toast(`操作失败：${displayAdminError(cause)}；请刷新后核对版本，禁止盲目重提。`);
    } finally { setBusy(false); }
  };

  if (!canRead) return null;

  return (
    <section className="l-card" data-testid="account-deletion-queue">
      <div className="l-h">
        <div><div className="ttl">账号注销申请</div><div className="sub">服务端权威状态 · user_c1_read / user_c1_write · 每次写入均要求理由与 CAS</div></div>
        <div className="r">
          <select aria-label="注销申请状态筛选" value={status} onChange={(event) => { setStatus(event.target.value as AccountDeletionStatus | ""); setPage(1); }}>
            <option value="">全部状态</option>
            {ACCOUNT_DELETION_STATUSES.map((value) => <option key={value} value={value}>{LABELS[value]}</option>)}
          </select>
          <button className="l-btn sm" onClick={() => void refresh()} disabled={loading}>刷新</button>
        </div>
      </div>
      <div className="l-b">
        {error && <div className="ctint warn" style={{ marginBottom: 10 }}>{error}</div>}
        {loading ? <div className="tiny">读取中…</div> : rows.length === 0 ? <div className="tiny">当前筛选没有申请。</div> : (
          <table className="l-tbl"><thead><tr><th>申请号</th><th>用户</th><th>状态</th><th>版本</th><th>申请时间</th><th>理由</th></tr></thead><tbody>
            {rows.map((row) => <tr key={row.requestNo} className="click" onClick={() => void openDetail(row)}>
              <td className="mono">{row.requestNo}</td><td className="mono">{row.userId}</td>
              <td><span className={`bdg ${tone(row.status)}`}>{LABELS[row.status] ?? row.status}</span></td>
              <td className="mono">{row.version}</td><td>{date(row.requestedAt)}</td><td>{row.reason || "—"}</td>
            </tr>)}
          </tbody></table>
        )}
        <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}><span className="tiny">共 {total} 条 · 第 {page} 页</span><span className="row"><button className="l-btn sm" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button><button className="l-btn sm" disabled={rows.length < 20 || loading} onClick={() => setPage((value) => value + 1)}>下一页</button></span></div>
      </div>
      {selected && <Drawer title={`注销申请详情 · ${selected.requestNo}`} onClose={() => setSelected(null)}>
        <div className="kv"><span className="k">用户 ID</span><span className="v">{selected.userId}</span></div>
        <div className="kv"><span className="k">状态</span><span className="v">{LABELS[selected.status] ?? selected.status}</span></div>
        <div className="kv"><span className="k">CAS 版本</span><span className="v mono">{selected.version}</span></div>
        <div className="kv"><span className="k">申请时间</span><span className="v">{date(selected.requestedAt)}</span></div>
        <div className="kv"><span className="k">审核时间</span><span className="v">{date(selected.reviewedAt)}</span></div>
        <div className="kv"><span className="k">完成时间</span><span className="v">{date(selected.completedAt)}</span></div>
        <div className="kv"><span className="k">服务端理由</span><span className="v">{selected.reason || "—"}</span></div>
        <div className="ctint" style={{ marginTop: 12 }}>完成注销会执行服务端账户禁用、匿名化与会话撤销；前端不把申请状态误报为即时删除。</div>
        {canWrite && availableActions(selected.status).length > 0 && <>
          <label style={{ display: "block", marginTop: 14, fontSize: 12 }}>本次审核理由（必填）</label>
          <textarea aria-label="注销审核理由" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={255} rows={3} style={{ width: "100%", marginTop: 6 }} placeholder="说明审核、阻断、完成或取消依据" />
          <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>{availableActions(selected.status).map((action) => <button key={action} className={`l-btn sm ${action === "complete" ? "mc" : ""}`} disabled={busy || !reason.trim()} onClick={() => void act(action)}>{ACTION_LABELS[action]}</button>)}</div>
        </>}
      </Drawer>}
    </section>
  );
}
