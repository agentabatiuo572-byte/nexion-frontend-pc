export interface E5Observability {
  activity: Array<{ eventType: string; aggregateType: string; aggregateId: string; occurredAt: string }>;
}
export function parseE5Observability(value: unknown): E5Observability {
  if (!value || typeof value !== "object" || !("activity" in value) || !Array.isArray(value.activity)) throw new Error("设备操作记录格式不完整，请刷新重试。");
  return { activity: value.activity.map(entry => {
    if (!entry || typeof entry !== "object") throw new Error("设备操作记录格式不完整，请刷新重试。");
    for (const key of ["eventType", "aggregateType", "aggregateId", "occurredAt"]) {
      if (typeof entry[key] !== "string" || !entry[key].trim()) throw new Error("设备操作记录格式不完整，请刷新重试。");
    }
    return { eventType: entry.eventType, aggregateType: entry.aggregateType, aggregateId: entry.aggregateId, occurredAt: entry.occurredAt };
  }) };
}
