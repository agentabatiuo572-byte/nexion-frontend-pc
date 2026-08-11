import { parseStrictFiniteNumber } from "./strict-number.ts";

const ASSETS = ["USDT", "NEX"] as const;
const DIRECTIONS = ["CREDIT", "DEBIT"] as const;
const STATUSES = ["PENDING", "PENDING_REVIEW", "APPROVED", "REJECTED", "WITHDRAWN", "SUSPENDED"] as const;

type C3AdjustmentRecord = Record<string, unknown> & {
  adjustmentNo: string;
  userId: number | string;
  asset: typeof ASSETS[number];
  direction: typeof DIRECTIONS[number];
  amount: number | string;
  status: typeof STATUSES[number];
};

function invalid(field: string): never {
  throw new Error(`C3_RESPONSE_INVALID:${field}`);
}

export function normalizeC3Adjustment(value: unknown, expectedStatus?: string): C3AdjustmentRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("record");
  const item = value as Record<string, unknown>;
  const adjustmentNo = typeof item.adjustmentNo === "string" ? item.adjustmentNo.trim() : "";
  const userId = parseStrictFiniteNumber(item.userId);
  const amount = parseStrictFiniteNumber(item.amount);
  const asset = typeof item.asset === "string" ? item.asset.trim().toUpperCase() : "";
  const direction = typeof item.direction === "string" ? item.direction.trim().toUpperCase() : "";
  const status = typeof item.status === "string" ? item.status.trim().toUpperCase() : "";
  if (!adjustmentNo) invalid("adjustmentNo");
  if (userId === null || !Number.isInteger(userId) || userId < 1) invalid("userId");
  if (amount === null || amount <= 0) invalid("amount");
  if (!ASSETS.includes(asset as typeof ASSETS[number])) invalid("asset");
  if (!DIRECTIONS.includes(direction as typeof DIRECTIONS[number])) invalid("direction");
  if (!STATUSES.includes(status as typeof STATUSES[number])) invalid("status");
  if (expectedStatus && status !== expectedStatus.trim().toUpperCase()) invalid("statusFilter");
  if (item.credit !== undefined && item.credit !== null) {
    if (typeof item.credit !== "boolean" || item.credit !== (direction === "CREDIT")) invalid("credit");
  }
  return item as C3AdjustmentRecord;
}
