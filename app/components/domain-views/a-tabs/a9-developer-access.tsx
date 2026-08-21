"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Btn, Card, CardH, DataListPager } from "../design-kit";
import {
  approveDeveloperAccess,
  fetchDeveloperAccessRequests,
  rejectDeveloperAccess,
  revokeDeveloperAccess,
  isDeveloperAccessOutcomeUnknownError,
  type DeveloperAccessPage,
  type DeveloperAccessRequest,
} from "@/lib/admin/developer-access-client";
import { canReviewDeveloperAccess, developerAccessResourceGuard } from "@/lib/admin/developer-access-policy";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";

const developerAccessAttempts = createSlotAttemptStore({
  storageKey: "nexion-admin-a9-developer-access-attempts-v1",
});

/** Real server-backed developer access governance. Navigation ownership remains with the A-domain integrator. */
export function A9DeveloperAccess() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState<"" | DeveloperAccessRequest["status"]>("PENDING");
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [data, setData] = useState<DeveloperAccessPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => { setKeyword(keywordInput.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [keywordInput]);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchDeveloperAccessRequests({ pageNum: page, pageSize, status: status || undefined, keyword })
      .then((result) => { if (!cancelled) setData(result); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "开发者访问申请加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, pageSize, status, keyword, reloadKey]);

  useEffect(() => load(), [load]);

  const review = async (row: DeveloperAccessRequest, action: "approve" | "reject" | "revoke") => {
    if (!canReviewDeveloperAccess(row.status, action)) return;
    const reason = window.prompt("请输入审批备注（至少 8 个字符）", "")?.trim() ?? "";
    if (reason.length < 8) {
      setError("审批备注至少 8 个字符，未执行操作");
      return;
    }
    const identity = `${action}:${row.requestNo}`;
    const key = developerAccessAttempts.resolve(
      identity,
      `${identity}:${row.status}`,
      () => globalThis.crypto?.randomUUID?.() ?? `developer-access-${action}-${row.requestNo}`,
    );
    try {
      if (action === "approve") await approveDeveloperAccess(row, reason, key);
      if (action === "reject") await rejectDeveloperAccess(row, reason, key);
      if (action === "revoke") await revokeDeveloperAccess(row, reason, key);
      developerAccessAttempts.forget(identity);
      setReloadKey((value) => value + 1);
    } catch (cause) {
      if (!isDeveloperAccessOutcomeUnknownError(cause)) developerAccessAttempts.forget(identity);
      setError(cause instanceof Error ? cause.message : "审批操作失败；服务器状态未确认，请刷新");
    }
  };

  return (
    <div className="dkpage adom">
      <Card>
        <CardH title="开发者访问审批" right={<span className="mono" style={{ color: "var(--ink-3)", fontSize: 12 }}>{loading ? "同步中…" : `共 ${data?.total ?? 0} 条`}</span>} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <input aria-label="开发者访问申请搜索" placeholder="申请编号 / 公司 / 邮箱" value={keywordInput} onChange={(event) => setKeywordInput(event.target.value)} style={{ flex: "1 1 220px", padding: "8px 12px" }} />
          {(["", "PENDING", "APPROVED", "REJECTED", "REVOKED", "EXPIRED"] as const).map((value) => (
            <Btn key={value || "ALL"} sm onClick={() => { setStatus(value); setPage(1); }}>{value || "全部"}</Btn>
          ))}
        </div>
        {error && <div className="alertbar warn" role="alert" style={{ margin: 12 }}>{error} <Btn sm onClick={() => setReloadKey((value) => value + 1)}>重试</Btn></div>}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "var(--surface-2)", textAlign: "left" }}>
              <th style={{ padding: 10 }}>申请</th><th style={{ padding: 10 }}>用户 / 公司</th><th style={{ padding: 10 }}>环境</th><th style={{ padding: 10 }}>状态</th><th style={{ padding: 10 }}>备注</th><th style={{ padding: 10 }}>操作</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6} style={{ padding: 24, textAlign: "center" }}>加载中…</td></tr> : (data?.records ?? []).map((row) => {
                const guard = developerAccessResourceGuard(row.status);
                return <tr key={row.requestNo} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: 10 }}><div className="mono">{row.requestNo}</div><div style={{ color: "var(--ink-3)", fontSize: 11 }}>{row.createdAt}</div></td>
                  <td style={{ padding: 10 }}><div>#{row.userId} · {row.company}</div><div style={{ color: "var(--ink-3)" }}>{row.email}</div></td>
                  <td style={{ padding: 10 }}><Badge tone={row.sourceEnvironment === "SANDBOX" ? "info" : "neutral"}>{row.sourceEnvironment}</Badge><div className="mono" style={{ fontSize: 11 }}>{row.runId || "—"}</div></td>
                  <td style={{ padding: 10 }}><Badge tone={row.status === "APPROVED" ? "ok" : row.status === "PENDING" ? "warn" : row.status === "EXPIRED" ? "err" : "neutral"}>{row.status}</Badge></td>
                  <td style={{ padding: 10, maxWidth: 240 }}>{row.reviewReason || "—"}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                    {guard.canApprove && <Btn sm onClick={() => void review(row, "approve")}>批准</Btn>}
                    {guard.canReject && <Btn sm onClick={() => void review(row, "reject")}>驳回</Btn>}
                    {guard.canRevoke && <Btn sm onClick={() => void review(row, "revoke")}>撤销</Btn>}
                    {!guard.canApprove && !guard.canReject && !guard.canRevoke && <span style={{ color: "var(--ink-4)" }}>无可用操作</span>}
                  </td>
                </tr>;
              })}
              {!loading && (data?.records ?? []).length === 0 && <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--ink-3)" }}>暂无申请</td></tr>}
            </tbody>
          </table>
        </div>
        {!error && <DataListPager label="开发者访问申请" page={page} pageSize={pageSize} total={data?.total ?? 0} onPageChange={setPage} onPageSizeChange={(size: number) => { setPageSize(size); setPage(1); }} />}
      </Card>
    </div>
  );
}
