"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Btn, Card, CardH, DataListPager, Modal } from "../design-kit";
import { TabGroup } from "@/app/components/kit/tab-group";
import { useAdminAuth } from "@/lib/store/admin-auth";
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
import { createPendingMutationStore, type SlotAttemptRecord } from "@/lib/admin/pending-mutation-store";

type ReviewAction = "approve" | "reject" | "revoke";
type DeveloperAccessAttempt = SlotAttemptRecord & { adminId?: number; reason?: string };
const reviewActionLabel: Record<ReviewAction, string> = { approve: "批准", reject: "驳回", revoke: "撤销" };

const developerAccessAttempts = createPendingMutationStore<DeveloperAccessAttempt>({
  storageKey: "nexion-admin-a9-developer-access-attempts-v1",
  isValidRecord: (record) => typeof record.inputFingerprint === "string"
    && (record.reason === undefined || (typeof record.reason === "string" && Number.isSafeInteger(record.adminId))),
});

/** Real server-backed developer access governance. Navigation ownership remains with the A-domain integrator. */
const developerStatusText = (value: string) => ({ PENDING: "待审批", APPROVED: "已批准", REJECTED: "已驳回", REVOKED: "已撤销", EXPIRED: "已过期" } as Record<string,string>)[value] ?? "未知状态";

export function A9DeveloperAccess() {
  const adminId = useAdminAuth((s) => s.session?.adminId);
  const authorities = useAdminAuth((s) => s.session?.authorities ?? []);
  const isSuper = authorities.includes("ROLE_SUPER_ADMIN");
  const reviewPermissions = {
    approve: isSuper || authorities.includes("developer_access_approve"),
    reject: isSuper || authorities.includes("developer_access_reject"),
    revoke: isSuper || authorities.includes("developer_access_revoke"),
  };
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState<"" | DeveloperAccessRequest["status"]>("PENDING");
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [data, setData] = useState<DeveloperAccessPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [recovery, setRecovery] = useState<{
    row: DeveloperAccessRequest;
    action: ReviewAction;
    attempt: DeveloperAccessAttempt;
    reason: string;
  } | null>(null);

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

  const submitReview = async (row: DeveloperAccessRequest, action: ReviewAction, reason: string,
    previous?: DeveloperAccessAttempt) => {
    if (!adminId || useAdminAuth.getState().session?.adminId !== adminId
      || !reviewPermissions[action] || !canReviewDeveloperAccess(row.status, action)) return;
    const identity = `${action}:${row.requestNo}`;
    const key = previous?.commandKey ?? globalThis.crypto?.randomUUID?.() ?? `developer-access-${action}-${row.requestNo}`;
    if (!previous) developerAccessAttempts.forget(identity);
    if (!previous) {
      developerAccessAttempts.remember(identity, key, { inputFingerprint: `${identity}:${row.status}`, adminId, reason });
    }
    try {
      if (action === "approve") await approveDeveloperAccess(row, reason, key);
      if (action === "reject") await rejectDeveloperAccess(row, reason, key);
      if (action === "revoke") await revokeDeveloperAccess(row, reason, key);
      developerAccessAttempts.forget(identity, key);
      setError(null);
      setReloadKey((value) => value + 1);
    } catch (cause) {
      if (!isDeveloperAccessOutcomeUnknownError(cause) && (!previous || previous.reason !== undefined)) {
        developerAccessAttempts.forget(identity, key);
      }
      setError(cause instanceof Error ? cause.message : "操作失败，结果未确认，请刷新后查看");
    }
  };

  const review = (row: DeveloperAccessRequest, action: ReviewAction) => {
    if (!adminId || !reviewPermissions[action] || !canReviewDeveloperAccess(row.status, action)) return;
    const identity = `${action}:${row.requestNo}`;
    const previous = developerAccessAttempts.list().find((record) => record.fingerprint === identity
      && record.inputFingerprint === `${identity}:${row.status}` && (record.adminId === undefined || record.adminId === adminId));
    if (previous?.reason !== undefined) {
      setRecovery({ row, action, attempt: previous, reason: previous.reason });
      return;
    }
    // Legacy attempts retain the key but need the original remark from the operator.
    const reason = window.prompt(previous ? "请填写上次提交的原备注（至少 8 个字）" : "请填写备注（至少 8 个字）", "")?.trim() ?? "";
    if (reason.length < 8) {
      setError("备注至少 8 个字，操作未执行");
      return;
    }
    void submitReview(row, action, reason, previous);
  };

  return (
    <div className="dkpage adom">
      <Card>
        <CardH title="开发者访问审批" right={<span className="mono" style={{ color: "var(--ink-3)", fontSize: 12 }}>{loading ? "加载中…" : `共 ${data?.total ?? 0} 条`}</span>} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <input className="ui-search-input" aria-label="开发者访问申请搜索" placeholder="申请编号 / 公司 / 邮箱" value={keywordInput} onChange={(event) => setKeywordInput(event.target.value)} style={{ flex: "1 1 220px", padding: "8px 12px" }} />
          <TabGroup
            label="开发者访问申请状态筛选"
            value={status}
            items={["", "PENDING", "APPROVED", "REJECTED", "REVOKED", "EXPIRED"] as const}
            onSelect={(value) => { setStatus(value); setPage(1); }}
            style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
            itemClassName={() => "btn sm"}
          >{(value) => value ? developerStatusText(value) : "全部"}</TabGroup>
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
                const canApprove = guard.canApprove && reviewPermissions.approve;
                const canReject = guard.canReject && reviewPermissions.reject;
                const canRevoke = guard.canRevoke && reviewPermissions.revoke;
                return <tr key={row.requestNo} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: 10 }}><div className="mono">{row.requestNo}</div><div style={{ color: "var(--ink-3)", fontSize: 11 }}>{row.createdAt}</div></td>
                  <td style={{ padding: 10 }}><div>#{row.userId} · {row.company}</div><div style={{ color: "var(--ink-3)" }}>{row.email}</div></td>
                  <td style={{ padding: 10 }}><Badge tone={row.sourceEnvironment === "SANDBOX" ? "info" : "neutral"}>{row.sourceEnvironment === "SANDBOX" ? "测试环境" : "正式环境"}</Badge><div className="mono" style={{ fontSize: 11 }}>{row.runId || "—"}</div></td>
                  <td style={{ padding: 10 }}><Badge tone={row.status === "APPROVED" ? "ok" : row.status === "PENDING" ? "warn" : row.status === "EXPIRED" ? "err" : "neutral"}>{developerStatusText(row.status)}</Badge></td>
                  <td style={{ padding: 10, maxWidth: 240 }}>{row.reviewReason || "—"}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                    {canApprove && <Btn sm onClick={() => void review(row, "approve")}>批准</Btn>}
                    {canReject && <Btn sm onClick={() => void review(row, "reject")}>驳回</Btn>}
                    {canRevoke && <Btn sm onClick={() => void review(row, "revoke")}>撤销</Btn>}
                    {!canApprove && !canReject && !canRevoke && <span style={{ color: "var(--ink-4)" }}>无可用操作</span>}
                  </td>
                </tr>;
              })}
              {!loading && (data?.records ?? []).length === 0 && <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--ink-3)" }}>暂无申请</td></tr>}
            </tbody>
          </table>
        </div>
        {!error && <DataListPager label="开发者访问申请" page={page} pageSize={pageSize} total={data?.total ?? 0} onPageChange={setPage} onPageSizeChange={(size: number) => { setPageSize(size); setPage(1); }} />}
      </Card>
      {recovery && recovery.attempt.adminId === adminId && reviewPermissions[recovery.action] && (
        <Modal title="核对原审批" onClose={() => setRecovery(null)} footer={<>
          <Btn onClick={() => setRecovery(null)}>取消</Btn>
          <Btn variant="primary" onClick={() => {
            setRecovery(null);
            void submitReview(recovery.row, recovery.action, recovery.reason, recovery.attempt);
          }}>确认核对</Btn>
        </>}>
          <p>原操作 · {reviewActionLabel[recovery.action]} {recovery.row.requestNo}</p>
          <div className="kv"><span className="k">原备注</span><span className="v" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{recovery.reason}</span></div>
        </Modal>
      )}
    </div>
  );
}
