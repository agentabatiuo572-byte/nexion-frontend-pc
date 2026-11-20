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

export function parseBusinessCalendar(raw: unknown): BusinessCalendarView {
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  const date = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const stamp = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value);
  const strings = (value: Record<string, unknown>, keys: string[]) => keys.every(key => typeof value[key] === "string");
  const version = (value: unknown): boolean => object(value) && Number.isSafeInteger(value.id)
    && ["LEGACY", "GROWTH_TEAM", "GLOBAL"].includes(String(value.track))
    && strings(value, ["zoneId", "offset", "operator", "reason"]) && (value.countryCode === null || typeof value.countryCode === "string")
    && date(value.effectiveDate) && stamp(value.effectiveStorageAt) && stamp(value.createdAt) && typeof value.pending === "boolean";
  if (!object(raw) || !strings(raw, ["currentZoneId", "currentZoneLabel", "currentOffset"])
    || typeof raw.unified !== "boolean" || !object(raw.trackZones) || !strings(raw.trackZones, ["LEGACY", "GROWTH_TEAM"])
    || !date(raw.earliestEffectiveDate) || !Array.isArray(raw.history) || !raw.history.every(version)
    || !(raw.pending === null || version(raw.pending)) || !Array.isArray(raw.options)
    || !raw.options.every(option => object(option) && strings(option, ["countryName", "zoneId", "label"])
      && (option.countryCode === null || typeof option.countryCode === "string"))) throw new Error("BUSINESS_CALENDAR_RESPONSE_INVALID");
  return raw as BusinessCalendarView;
}

async function request(path: string, init?: RequestInit): Promise<BusinessCalendarView> {
  const response = await guardedFetch(`${BASE}${path}`, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => null) as ApiResult<BusinessCalendarView> | null;
  if (!response.ok || !body || body.code !== 0 || !body.data) throw new Error(formatAdminApiError(body?.message, `BUSINESS_CALENDAR_REQUEST_FAILED_${response.status}`));
  return parseBusinessCalendar(body.data);
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
