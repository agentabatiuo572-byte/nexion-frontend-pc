import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { parseTaskPool, taskPoolTaskPath, validTaskEditFields, validTaskWeight, type DisableImpact, type PoolTask, type TaskPool, type TaskPoolCommand } from "@/lib/admin/task-pool-client";
import { TASK_CLASSES } from "@/lib/admin/task-classes";
import { discoverECommand, investigateECommand, eCommandSettled, type ECommandEvidence } from "@/lib/admin/e-command-investigation";

export type E2Pending = PendingMutationRecord & {
  actorId: string;
  actorName: string;
  pool: TaskPool;
  request: TaskPoolCommand;
  tasks: PoolTask[];
  impact: DisableImpact | null;
  impactAt: number | null;
};

/** The only untrusted persistence boundary. A partial envelope must never authorize a replay. */
export const e2Commands = createPendingMutationStore<E2Pending>({
  storageKey: "nexion-admin-e2-pool-commands-v1",
  retainExpiredRecords: true,
  isValidRecord: (value) => {
    try {
      const pool = parseTaskPool(value.pool), command = value.request;
      if (pool.kind !== "DEVICE" || !value.actorId || typeof value.actorId !== "string" || typeof value.actorName !== "string"
        || value.fingerprint !== `pool|${pool.code}` || !command || command.method !== "POST"
        || command.body.idempotencyKey !== value.commandKey || typeof command.body.reason !== "string"
        || command.body.reason !== command.body.reason.trim() || Array.from(command.body.reason).length > 200
        || Array.from(command.body.reason).length < 8 || !Array.isArray(value.tasks)) return false;
      if (command.kind === "create" || command.kind === "update") {
        if (value.impact !== null || value.impactAt !== null || !validTaskEditFields(command.body)
          || value.commandKey !== value.commandKey.trim() || value.commandKey.length > 128
          || Object.keys(command.body).sort().join(",") !== (command.kind === "create"
            ? "baseReward,durationMinutes,enabled,idempotencyKey,name,reason,taskClass"
            : "baseReward,durationMinutes,expectedVersion,idempotencyKey,name,reason,taskClass")) return false;
        if (command.kind === "create") return value.tasks.length === 0 && command.path === taskPoolTaskPath(pool.code)
          && typeof command.body.enabled === "boolean";
        const [task] = value.tasks;
        return value.tasks.length === 1 && typeof task.taskTypeId === "string" && !!task.taskTypeId && task.taskTypeId !== "status"
          && command.path === taskPoolTaskPath(pool.code, task.taskTypeId)
          && Number.isSafeInteger(task.version) && task.version > 0 && command.body.expectedVersion === task.version
          && typeof task.enabled === "boolean" && command.previousEnabled === task.enabled
          && typeof task.name === "string" && !!task.name && TASK_CLASSES.includes(task.taskClass)
          && Number.isInteger(task.durationMinutes) && task.durationMinutes > 0 && task.durationMinutes <= 120
          && typeof task.effectiveAt === "string" && validTaskWeight(task.baseReward) && /\.\d{6}$/.test(task.baseReward) && task.asset === "USDT";
      }
      if (command.kind !== "random" && command.kind !== "status"
        || command.path !== `/task-pools/${pool.code}/${command.kind === "random" ? "random-tasks" : "tasks/status"}`) return false;
      if (command.kind === "random") return Number.isInteger(command.body.count) && command.body.count >= 1 && command.body.count <= 50
        && (command.body.taskClasses === undefined || Array.isArray(command.body.taskClasses)
          && command.body.taskClasses.length > 0 && command.body.taskClasses.every(item => TASK_CLASSES.includes(item))
          && new Set(command.body.taskClasses).size === command.body.taskClasses.length)
        && value.tasks.length === 0 && value.impact === null && value.impactAt === null;
      const ids = command.body.taskTypeIds;
      if (typeof command.body.enabled !== "boolean" || !Array.isArray(ids) || ids.length < 1 || ids.length > 50
        || new Set(ids).size !== ids.length || value.tasks.length !== ids.length
        || value.tasks.some((task, index) => !task || task.taskTypeId !== ids[index] || typeof task.name !== "string" || !task.name
          || !Number.isInteger(task.version) || task.version < 1 || typeof task.effectiveAt !== "string"
          || !TASK_CLASSES.includes(task.taskClass) || typeof task.enabled !== "boolean"
          || !Number.isInteger(task.durationMinutes) || task.durationMinutes <= 0 || task.durationMinutes > 120)) return false;
      if (command.body.enabled) return value.impact === null && value.impactAt === null;
      return !!value.impact && Number.isSafeInteger(value.impactAt) && Array.isArray(value.impact.productsLosingAllTasks)
        && Number.isSafeInteger(value.impact.devicesAffected) && value.impact.devicesAffected >= 0
        && value.impact.productsLosingAllTasks.every(item => typeof item.productKey === "string" && !!item.productKey
          && typeof item.productName === "string" && !!item.productName);
    } catch { return false; }
  },
});

export function e2CommandLabel(record: E2Pending) {
  const request = record.request;
  if (request.kind === "create" || request.kind === "update") return `${request.kind === "create" ? "新增" : "修改"}任务「${request.body.name}」`;
  return request.kind === "random" ? `随机添加 ${request.body.count} 个任务`
    : `${request.body.enabled ? "批量启用" : "批量停用"} ${request.body.taskTypeIds.length} 个任务`;
}

export async function checkE2Command(record: E2Pending, evidence?: ECommandEvidence) {
  const locator = { commandKey: record.commandKey, originalMethod: record.request.method,
    originalPath: `/api/admin/devices${record.request.path}`, originalAdminId: record.actorId };
  const receipt = evidence ? await investigateECommand(record, locator, evidence) : await discoverECommand(locator);
  if (eCommandSettled(receipt)) e2Commands.forget(record.fingerprint, record.commandKey);
  return receipt;
}
