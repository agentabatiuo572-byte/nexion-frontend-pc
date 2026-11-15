/** Validation at the session-storage boundary; the forms and transport consume typed payloads. */
export function isM5ManagementPayload(kind: "rules" | "welcome" | "policy", value: unknown, before = false): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const positive = (number: unknown) => Number.isSafeInteger(number) && Number(number) > 0;
  if (!positive(row[before ? "version" : "expectedVersion"]) || !before && typeof row.reason !== "string") return false;
  if (kind === "rules") {
    if (!["UNCONFIGURED", "LIMITED", "UNLIMITED"].includes(String(row.inheritanceMode))
      || row.unboundAssignmentMode !== undefined && !["SUPERVISOR", "AUTO_RANDOM"].includes(String(row.unboundAssignmentMode))
      || ![row.dormantDays, row.maintenanceDays, row.activityWindowDays].every(day => day === null || positive(day))) return false;
    return row.inheritanceMode === "LIMITED" ? Number.isSafeInteger(row.maxInheritanceDepth) && Number(row.maxInheritanceDepth) >= 0 : row.maxInheritanceDepth === null;
  }
  if (kind === "welcome") {
    if (!row.texts || typeof row.texts !== "object" || Array.isArray(row.texts)) return false;
    const texts = row.texts as Record<string, unknown>;
    return [texts.zh, texts.en, texts.vi].every(text => typeof text === "string" && text.trim().length > 0);
  }
  return positive(row.alertMinutes) && positive(row.fallbackMinutes) && (row.defaultGroupId === null || positive(row.defaultGroupId));
}
