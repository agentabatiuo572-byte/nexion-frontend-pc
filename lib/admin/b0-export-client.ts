"use client";

import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";

interface B0ExportAttempt extends PendingMutationRecord {
  adminId: number;
  reason: string;
  snapshotJson: string;
}

const attempts = createPendingMutationStore<B0ExportAttempt>({
  storageKey: "nexion-admin-b0-export-commands-v1",
  retainExpiredRecords: true,
  isValidRecord: row => Number.isSafeInteger(row.adminId) && row.adminId > 0
    && typeof row.reason === "string" && row.reason.trim().length > 0
    && typeof row.snapshotJson === "string" && row.snapshotJson.length > 0,
});

export function pendingB0Export(adminId: number) {
  return attempts.list().find(row => row.adminId === adminId && row.fingerprint === `b0-export:${adminId}`);
}

/** The backend records download intent only; the original JSON stays in this tab. */
export async function downloadB0Snapshot(adminId: number, snapshotJson: string, reason: string) {
  const auth = useAdminAuth.getState();
  if (auth.session?.adminId !== adminId || auth.session.role !== "superadmin"
      || !auth.session.authorities.includes("overview_b0_export") || auth.logoutPending) {
    throw new Error("当前登录账号没有导出权限，请重新登录后核对。");
  }
  const previous = pendingB0Export(adminId);
  if (previous && previous.expiresAt <= Date.now()) {
    throw new Error("原导出已超过 24 小时，不能再重试；原数据和理由仍保留，请联系值班人员核对操作记录。");
  }
  const fingerprint = `b0-export:${adminId}`;
  const commandKey = previous?.commandKey ?? `b0-export-${crypto.randomUUID()}`;
  if (!previous) attempts.remember(fingerprint, commandKey, { adminId, snapshotJson, reason: reason.trim() });
  if (!attempts.isDurablyStored(fingerprint, commandKey)) {
    if (!previous) attempts.forget(fingerprint, commandKey);
    throw new Error("浏览器存不下这次导出的记录，还没有提交登记；请允许浏览器保存网站数据后重试。");
  }
  const attempt = pendingB0Export(adminId)!;
  const unknown = () => new Error("导出登记结果未知，原数据和理由已保留；按原请求重试不会重复登记。");
  let response: Response;
  try {
    response = await guardedFetch("/api/admin/ops-dashboard/exports", {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", "Idempotency-Key": commandKey },
      body: JSON.stringify({ reason: attempt.reason }),
    });
  } catch { throw unknown(); }
  const payload: unknown = await response.json().catch(() => null);
  if (response.status >= 500 || response.headers.get("X-Nexion-Upstream-Outcome")?.toLowerCase() === "unknown"
      || !payload || typeof payload !== "object" || Array.isArray(payload)
      || !("code" in payload) || !Number.isInteger(payload.code)
      || ("message" in payload && payload.message != null && typeof payload.message !== "string")) throw unknown();
  const result = payload as { code: number; message?: string; data?: unknown };
  // The backend can wrap an internal failure in HTTP 200; keep the original attempt.
  if (result.code >= 500 || result.message === "IDEMPOTENCY_REQUEST_IN_PROGRESS") throw unknown();
  if (!response.ok || result.code !== 0) {
    // A later auth/policy rejection cannot settle an earlier lost success response.
    if (!previous) attempts.forget(fingerprint, commandKey);
    throw new Error(formatAdminApiError(result.message, `B0_EXPORT_${response.status}`));
  }
  const receipt = result.data as { exportNo?: unknown; recordedAt?: unknown; format?: unknown; fileName?: unknown } | undefined;
  if (!receipt || typeof receipt.exportNo !== "string" || !/^B0-EXP-[A-F0-9]{32}$/.test(receipt.exportNo)
      || receipt.format !== "JSON" || receipt.fileName !== `uvel-overview-${receipt.exportNo}.json`
      || typeof receipt.recordedAt !== "string" || !Number.isFinite(Date.parse(receipt.recordedAt))) throw unknown();
  const current = useAdminAuth.getState();
  if (current.authEpoch !== auth.authEpoch || current.session?.adminId !== adminId || current.logoutPending) {
    throw new Error("登录账号或权限变了，这次没有下载；请用原账号重新打开导出。");
  }
  const url = URL.createObjectURL(new Blob([attempt.snapshotJson], { type: "application/json" }));
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = receipt.fileName;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
  attempts.forget(fingerprint, commandKey);
  return { exportNo: receipt.exportNo, fileName: receipt.fileName, recordedAt: receipt.recordedAt, format: receipt.format };
}
