import { createA2CommandKey } from "./a2-client";
import { explicitRejectionCode } from "./explicit-rejection";
import { downloadF5RedactedCsv, type F5CommissionQuery } from "./f1-client";
import { fDirectCommands } from "./f1-stable-write";
import { activeRecoveryActor } from "./f-proposal-recovery";
import { createPendingRecovery } from "./pending-mutation-store";

const slot = "f5-export";
const canExport = (adminId: number | undefined) => activeRecoveryActor(adminId, "network_f5_read")?.authorities.includes("network_f5_export");
export const pendingF5Export = () => fDirectCommands.list().find(row => row.fingerprint === slot);
export const f5ExportRecovery = createPendingRecovery(fDirectCommands, {
  capability: record => record.f5ExportRequest ? "replay" : "readback",
  canReplay: record => !!record.f5ExportRequest && !!canExport(record.commandOwnerId),
  explicitRejectionCode,
});

export function f5ExportFilters(query: F5CommissionQuery): F5CommissionQuery {
  return {
    kind: query.kind?.trim() || undefined,
    currency: query.currency?.trim() || undefined,
    userId: query.userId?.trim() || undefined,
    cohort: query.cohort?.trim() || undefined,
    status: query.status?.trim() || undefined,
  };
}

export function f5ExportReadBlock(filters: F5CommissionQuery, read: { query?: F5CommissionQuery; total?: number; loading?: boolean }) {
  if (read.loading) return "奖励记录正在更新，暂不能导出";
  if (!read.query || read.total === undefined) return "奖励记录未成功读取，重试后才能导出";
  if (JSON.stringify(f5ExportFilters(filters)) !== JSON.stringify(f5ExportFilters(read.query))) return "请先重新读取原筛选条件的奖励记录";
  return read.total === 0 ? "当前结果没有可导出的奖励记录" : undefined;
}

export async function submitF5Export(adminId: number | undefined, query: F5CommissionQuery, reason: string,
  blocked: (filters: F5CommissionQuery) => string | undefined, originalKey?: string, onRemember?: (key: string | undefined) => void) {
  if (!canExport(adminId)) throw new Error("ADMIN_PERMISSION_DENIED");
  const original = pendingF5Export();
  if (original) {
    if (originalKey !== original.commandKey) throw new Error("PENDING_REPLAY_BLOCKED");
    const result = await f5ExportRecovery.replay(original, record => {
      const request = record.f5ExportRequest!;
      const issue = blocked(request.filters);
      if (issue) throw new Error(issue);
      return downloadF5RedactedCsv(request.filters, request.reason, record.commandKey);
    });
    f5ExportRecovery.settleAcknowledged(original);
    return result;
  }
  if (originalKey) throw new Error("PENDING_REPLAY_BLOCKED");
  const filters = f5ExportFilters(query);
  const issue = blocked(filters);
  if (issue) throw new Error(issue);
  const key = createA2CommandKey(slot);
  fDirectCommands.remember(slot, key, { inputFingerprint: JSON.stringify([filters]), f5ExportRequest: { filters, reason } });
  const saved = pendingF5Export();
  if (!saved || saved.commandKey !== key || !fDirectCommands.isDurablyStored(slot, key)) {
    fDirectCommands.forget(slot, key);
    throw new Error("F5_OPERATION_STORAGE_UNAVAILABLE");
  }
  onRemember?.(key);
  try {
    const result = await downloadF5RedactedCsv(filters, reason, key);
    f5ExportRecovery.settleAcknowledged(saved);
    return result;
  } catch (error) {
    if (explicitRejectionCode(error)) {
      fDirectCommands.forget(slot, key);
      onRemember?.(undefined);
    }
    throw error;
  }
}
