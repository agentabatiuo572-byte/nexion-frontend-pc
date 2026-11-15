import { currentAdminOperator } from "./current-operator";
import { K4_DIMENSION_KEYS, normalizeK4, normalizeK4User, type K4CommandRequest, type K4Model, type K4ModelDraftInput, type K4User, type ScoringOverview } from "./k-client";
import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";

export type K4Snapshot = ScoringOverview & { model: K4Model };
export type K4Operation = { overview: K4Snapshot } & (
  { kind: "draft"; input: K4ModelDraftInput }
  | { kind: "publish" }
  | { kind: "restore"; model: K4Model }
  | { kind: "batch" }
  | { kind: "override" | "recompute"; user: K4User }
);
export type K4SavedOperation = K4Operation & { request: K4CommandRequest; reason: string; successText: string };
export type K4PendingCommand = PendingMutationRecord & { operation?: K4SavedOperation; inputFingerprint?: string; alertId?: string; alertRequest?: { method: "POST"; path: string; body: null } };
export type K4Attempt = { retained?: K4PendingCommand };

export const k4Commands = createPendingMutationStore<K4PendingCommand>({
  storageKey: "nexion-admin-k4-scoring-commands-v1",
  retainExpiredRecords: true,
  isValidRecord(record) {
    // Old key/fingerprint records remain query-only; do not invent the missing original request.
    if (record.operation === undefined) return true;
    const op = record.operation;
    try {
      if (!op || !["draft", "publish", "restore", "batch", "override", "recompute"].includes(op.kind)
          || typeof op.reason !== "string" || typeof op.successText !== "string"
          || !op.request || !["POST", "PUT"].includes(op.request.method) || typeof op.request.body !== "string") return false;
      const overview = normalizeK4(op.overview);
      if (!overview.model) return false;
      if ((op.kind === "override" || op.kind === "recompute") && normalizeK4User(op.user).userNo !== op.user.userNo) return false;
      const input = JSON.parse(op.request.body);
      const expectedPath = op.kind === "draft" ? "/scoring/model/draft"
        : op.kind === "publish" ? "/scoring/model/publish"
        : op.kind === "restore" ? "/scoring/model/restore-draft"
        : op.kind === "batch" ? "/scoring/users/recompute"
        : `/scoring/users/${encodeURIComponent(op.user.userNo)}/${op.kind}`;
      return op.request.path === expectedPath && op.request.method === (op.kind === "draft" ? "PUT" : "POST")
        && input.reason === op.reason && typeof input.operator === "string";
    } catch { return false; }
  },
});

export function k4Slot(operation: K4Operation): string {
  return operation.kind === "draft" ? "model-draft"
    : operation.kind === "publish" ? "model-publish"
    : operation.kind === "restore" ? `model-restore-${operation.model.version}`
    : operation.kind === "batch" ? "batch-recompute"
    : `${operation.kind}:${operation.user.userNo}`;
}

export function k4Target(record: Pick<K4PendingCommand, "fingerprint">): string {
  const slot = record.fingerprint;
  if (slot.startsWith("alert-read:")) return slot;
  if (slot.startsWith("model-")) return "score-model";
  if (slot === "batch-recompute") return "score-users";
  return `score-user:${slot.slice(slot.indexOf(":") + 1)}`;
}

export function saveK4Operation(operation: K4Operation, reason: string, value?: string): K4SavedOperation {
  const overview = operation.overview;
  let body: Record<string, unknown>;
  let successText: string;
  if (operation.kind === "draft") {
    body = { ...operation.input, weights: Object.fromEntries(K4_DIMENSION_KEYS.map(key => [key, operation.input.weights[key] / 100])) };
    successText = "评分规则草稿已保存，线上评分不变";
  } else if (operation.kind === "publish") {
    body = { expectedVersion: overview.draft!.rowVersion };
    successText = `评分规则 v${overview.draft!.version} 已发布，旧版本已归档`;
  } else if (operation.kind === "restore") {
    body = { modelVersion: operation.model.version, expectedVersion: (overview.draft ?? overview.model).rowVersion };
    successText = `历史模型 v${operation.model.version} 已恢复为草稿`;
  } else if (operation.kind === "batch") {
    body = { userNos: [], expectedModelVersion: overview.model.version };
    successText = "所有用户的风险分已重新计算";
  } else {
    body = operation.kind === "override" ? { score: Number(value), expectedVersion: operation.user.rowVersion } : { expectedVersion: operation.user.rowVersion };
    successText = operation.kind === "override" ? `用户 ${operation.user.userNo} 的风险分已修改` : `用户 ${operation.user.userNo} 已恢复系统评分`;
  }
  const path = operation.kind === "draft" ? "/scoring/model/draft"
    : operation.kind === "publish" ? "/scoring/model/publish"
    : operation.kind === "restore" ? "/scoring/model/restore-draft"
    : operation.kind === "batch" ? "/scoring/users/recompute"
    : `/scoring/users/${encodeURIComponent(operation.user.userNo)}/${operation.kind}`;
  return { ...operation, reason, successText, request: { method: operation.kind === "draft" ? "PUT" : "POST", path,
    body: JSON.stringify({ ...body, operator: currentAdminOperator(), reason }) } };
}
