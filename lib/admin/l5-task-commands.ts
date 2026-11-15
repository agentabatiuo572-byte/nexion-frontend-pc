import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";
import type { LExportTask, L5TaskActionRequest } from "./l-client";

export type PendingL5Task = PendingMutationRecord & {
  owner: string;
  action: "approve" | "rerun";
  request: L5TaskActionRequest;
  task: LExportTask;
  requester: string;
};

// The exact body and its original task facts belong to one store, including
// expired evidence. Reading a current task never settles an earlier command.
export const l5TaskCommands = createPendingMutationStore<PendingL5Task>({
  storageKey: "nexion-admin-l5-task-commands-v1",
  retainExpiredRecords: true,
  isValidRecord(record) {
    const { request, task } = record;
    return typeof record.owner === "string" && record.owner.length > 0
      && ["approve", "rerun"].includes(record.action)
      && !!request && typeof request === "object" && !Array.isArray(request)
      && typeof request.includeSensitive === "boolean" && request.includeDecrypted === false
      && typeof request.reason === "string" && request.reason.trim().length > 0
      && typeof request.operator === "string" && request.operator.trim().length > 0
      && !!task && typeof task === "object" && !Array.isArray(task)
      && [task.id, task.type, task.reportType, task.scope, task.fields, task.rows, task.st, task.chain]
        .every(value => typeof value === "string" && value.length > 0)
      && typeof task.pii === "boolean" && typeof task.supported === "boolean"
      && typeof task.snapshotAvailable === "boolean"
      && ["masked", "partial", "decrypted", "—"].includes(task.mask)
      && Array.isArray(task.acts) && task.acts.every(action => ["approve", "download", "retry"].includes(action))
      && typeof record.requester === "string" && record.requester.length > 0
      && record.fingerprint === JSON.stringify({ reportId: task.id, action: record.action, request });
  },
});
