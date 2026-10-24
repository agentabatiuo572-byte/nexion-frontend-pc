import { growthRequest } from "./h-client";
import { currentAdminOperator } from "./current-operator";
import { createSlotAttemptStore } from "./pending-mutation-store";

export interface EventRuleView {
  eventCode: string;
  kind: string;
  revision: number;
  enabled: boolean;
  rulesLocked: boolean;
  startsAt: string | null;
  endsAt: string | null;
  rules: Record<string, unknown>;
  readiness: { ready: boolean; missing: string[] };
}
export type EventRuleChange = Pick<EventRuleView, "enabled" | "startsAt" | "endsAt" | "rules">;
const attempts = createSlotAttemptStore({ storageKey: "uvel-admin-event-rule-attempts-v1" });
export function parseEventRule(value: unknown): EventRuleView {
  const row = value as EventRuleView | null;
  if (!row || typeof row.eventCode !== "string" || !row.eventCode || typeof row.kind !== "string"
    || !Number.isSafeInteger(row.revision) || row.revision < 0 || typeof row.enabled !== "boolean" || typeof row.rulesLocked !== "boolean"
    || !row.rules || typeof row.rules !== "object" || Array.isArray(row.rules)
    || typeof row.readiness?.ready !== "boolean" || !Array.isArray(row.readiness.missing) || row.readiness.missing.some(item => typeof item !== "string")
    || [row.startsAt, row.endsAt].some(value => value !== null && (typeof value !== "string" || !Number.isFinite(Date.parse(value))))) throw new Error("活动规则读取失败，请刷新后重试。");
  return row;
}
export async function fetchEventRules(): Promise<EventRuleView[]> {
  const result = await growthRequest<{ rules: unknown[] }>("/event-rules");
  if (!Array.isArray(result?.rules)) throw new Error("活动规则读取失败，请刷新后重试。");
  return result.rules.map(parseEventRule);
}
export async function updateEventRule(eventCode: string, change: EventRuleChange, expectedRevision: number, reason: string): Promise<EventRuleView> {
  const body = JSON.stringify({ ...change, expectedRevision, reason });
  const slot = `${currentAdminOperator()}:${eventCode}`;
  const key = attempts.resolve(slot, body, () => `h4-rules-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const result = parseEventRule(await growthRequest<unknown>(`/event-rules/${encodeURIComponent(eventCode)}`, {
    method: "PATCH", body, headers: { "Idempotency-Key": key },
  }));
  if (result.eventCode !== eventCode) throw new Error("活动保存结果不匹配，请刷新后核对。");
  attempts.forget(slot);
  return result;
}
