import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { setBusinessZone } from "@/lib/admin/business-time";

/** R-1: A3 业务时区. GET is open to every signed-in console; changes are super-admin only. */
export type BusinessZoneOption = { countryCode: string | null; countryName: string; zoneId: string; label: string };
export type BusinessCalendarVersion = {
  id: number; track: "LEGACY" | "GROWTH_TEAM" | "GLOBAL"; zoneId: string; countryCode: string | null; offset: string;
  effectiveDate: string; effectiveStorageAt: string; operator: string; reason: string; createdAt: string; pending: boolean;
};
export type BusinessCalendarView = {
  currentZoneId: string; currentZoneLabel: string; currentOffset: string; unified: boolean;
  trackZones: Record<string, string>; pending: BusinessCalendarVersion | null; history: BusinessCalendarVersion[];
  options: BusinessZoneOption[]; earliestEffectiveDate: string;
};
type ApiResult<T> = { code: number; message?: string; data?: T };
const BASE = "/api/admin/platform/business-calendar";

async function request(path: string, init?: RequestInit): Promise<BusinessCalendarView> {
  const response = await guardedFetch(`${BASE}${path}`, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => null) as ApiResult<BusinessCalendarView> | null;
  if (!response.ok || !body || body.code !== 0 || !body.data) throw new Error(formatAdminApiError(body?.message, `BUSINESS_CALENDAR_REQUEST_FAILED_${response.status}`));
  return body.data;
}

/** Reads the calendar and publishes the current zone to every time label in the console. */
export async function fetchBusinessCalendar(): Promise<BusinessCalendarView> {
  const view = await request("");
  setBusinessZone({ zoneId: view.currentZoneId, label: view.currentZoneLabel, offset: view.currentOffset });
  return view;
}

export function zoneOptionLabel(option: BusinessZoneOption, offset?: string) {
  return `${option.label}${offset ? ` · ${offset}` : ""}（${option.zoneId}）`;
}

export async function scheduleBusinessZone(input: { countryCode: string | null; zoneId: string; effectiveDate: string; reason: string }, idempotencyKey: string) {
  return request("", { method: "PUT", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ ...input, reason: input.reason.trim() }) });
}

export async function cancelBusinessZone(versionId: number, reason: string, idempotencyKey: string) {
  return request("/cancel", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ versionId, reason: reason.trim() }) });
}
