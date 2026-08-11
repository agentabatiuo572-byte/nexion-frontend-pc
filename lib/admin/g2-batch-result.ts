export type G2BatchOutcome = "COMPLETED" | "PARTIAL" | "SKIPPED" | "FAILED" | "EMPTY" | "BUSY";
export type G2BatchOrderStatus = "COMPLETED" | "CANCELLED" | "QUEUED";

export interface G2BatchItemResult {
  exchangeNo: string;
  status: string;
  orderStatus: G2BatchOrderStatus;
  reasonCode: string;
  reason: string;
}

export interface G2BatchResult {
  requestedLimit: number;
  selectedCount: number;
  completedCount: number;
  completed: G2BatchItemResult[];
  skippedCount: number;
  skipped: G2BatchItemResult[];
  failedCount: number;
  failed: G2BatchItemResult[];
  remainingQueuedCount: number;
  outcome: G2BatchOutcome;
}

function invalid(): never {
  throw new Error("G2_BATCH_RESPONSE_INVALID");
}

function exactCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
}

function text(value: unknown, required = true) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return required ? invalid() : "";
}

function item(value: unknown, kind: "completed" | "skipped" | "failed"): G2BatchItemResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const row = value as Record<string, unknown>;
  const expectedStatus = kind.toUpperCase();
  const status = text(row.status);
  const orderStatus = text(row.orderStatus) as G2BatchOrderStatus;
  if (status !== expectedStatus || !["COMPLETED", "CANCELLED", "QUEUED"].includes(orderStatus)) invalid();
  if (kind === "completed" && orderStatus !== "COMPLETED") invalid();
  if (kind !== "completed" && orderStatus === "COMPLETED") invalid();
  return {
    exchangeNo: text(row.exchangeNo),
    status,
    orderStatus,
    reasonCode: text(row.reasonCode, kind !== "completed"),
    reason: text(row.reason, kind !== "completed"),
  };
}

function list(value: unknown, kind: "completed" | "skipped" | "failed") {
  if (!Array.isArray(value)) invalid();
  return value.map((row) => item(row, kind));
}

function expectedOutcome(completed: number, skipped: number, failed: number, remainingQueued: number): G2BatchOutcome {
  if (completed === 0 && skipped === 0 && failed === 0) return remainingQueued > 0 ? "BUSY" : "EMPTY";
  if (completed > 0 && (skipped > 0 || failed > 0)) return "PARTIAL";
  if (failed > 0) return "FAILED";
  if (skipped > 0) return "SKIPPED";
  return "COMPLETED";
}

export function normalizeG2BatchResult(value: unknown): G2BatchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const raw = value as Record<string, unknown>;
  const completed = list(raw.completed, "completed");
  const skipped = list(raw.skipped, "skipped");
  const failed = list(raw.failed, "failed");
  const completedCount = exactCount(raw.completedCount);
  const skippedCount = exactCount(raw.skippedCount);
  const failedCount = exactCount(raw.failedCount);
  const requestedLimit = exactCount(raw.requestedLimit);
  const selectedCount = exactCount(raw.selectedCount);
  const remainingQueuedCount = exactCount(raw.remainingQueuedCount);
  if (completedCount !== completed.length || skippedCount !== skipped.length || failedCount !== failed.length) invalid();
  if (requestedLimit < selectedCount || selectedCount !== completedCount + skippedCount + failedCount) invalid();
  const outcome = text(raw.outcome) as G2BatchOutcome;
  if (outcome !== expectedOutcome(completedCount, skippedCount, failedCount, remainingQueuedCount)) invalid();
  return { requestedLimit, selectedCount, completedCount, completed, skippedCount, skipped, failedCount, failed, remainingQueuedCount, outcome };
}

export function summarizeG2BatchResult(result: G2BatchResult) {
  const label: Record<G2BatchOutcome, string> = {
    COMPLETED: "全部完成",
    PARTIAL: "部分完成",
    SKIPPED: "全部跳过",
    FAILED: "处理失败",
    EMPTY: "没有可处理订单",
    BUSY: "队列正由其他操作处理，请稍后重试",
  };
  return `${label[result.outcome]} · 完成 ${result.completedCount} 单 · 跳过 ${result.skippedCount} 单 · 失败 ${result.failedCount} 单`;
}
