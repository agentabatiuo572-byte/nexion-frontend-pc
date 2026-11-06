import { createPendingMutationStore, type PendingMutationExtra, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";

export type TreasuryExportKind = "reconciliation" | "liabilities";
export type TreasuryPendingRecord = PendingMutationRecord & { amount?: string; voucherNo?: string; reason?: string; operator?: string; exportKind?: TreasuryExportKind };

/** 储备注入和导出的命令号跨刷新存活:注资是真金白银入账,重铸命令号 = 后端无法去重 = 重复入账。
 *  fingerprint 已编码动作类型(injection)与目标对象(凭证号,后端唯一去重位)+ 金额。
 *  结果未知时要能原样重试(OP-94),所以连内容、理由和操作人一起存。
 *  资金储备和旧「可用资金与应付款」共用这张表，只建这一份：内存副本是实例级的，两份会互相把删掉的记录写回来。 */
export const treasuryCommands = createPendingMutationStore<TreasuryPendingRecord>({
  storageKey: "nexion-admin-d3-treasury-commands-v1",
  // 过期后不能再用原号重试，记录和锁都留着（OP-96）。
  retainExpiredRecords: true,
});

export const exportScope = (kind: TreasuryExportKind) => `sensitive-export|${kind}`;

export function treasuryCommandKey(scope: string, extra: PendingMutationExtra<TreasuryPendingRecord>) {
  const existing = treasuryCommands.get(scope);
  if (existing) return existing;
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const key = `d3-${scope.replace(/[^A-Za-z0-9_-]/g, "-")}-${uuid.replaceAll("-", "").replace(".", "").slice(0, 18)}`;
  treasuryCommands.remember(scope, key, extra);
  return key;
}
