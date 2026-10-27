/**
 * R-1: the business time zone comes from the backend (A3 业务时区). Until it loads, and whenever it cannot be
 * read, the console keeps the historical Beijing time. Storage timestamps stay Asia/Shanghai local time.
 */
export type BusinessZone = { zoneId: string; label: string; offset: string };
const DEFAULT_ZONE: BusinessZone = { zoneId: "Asia/Shanghai", label: "北京时间", offset: "UTC+8" };
let current = DEFAULT_ZONE;
const listeners = new Set<() => void>();

export function businessZone(): BusinessZone { return current; }

export function setBusinessZone(next: BusinessZone | null) {
  const value = next && next.zoneId ? next : DEFAULT_ZONE;
  if (value.zoneId === current.zoneId && value.label === current.label && value.offset === current.offset) return;
  current = value;
  listeners.forEach((listener) => listener());
}

/** Notifies when the super admin's zone change is picked up; returns the unsubscribe function. Kept framework-free. */
export function subscribeBusinessZone(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** "越南时间（UTC+7）" for captions that state the zone once. */
export function businessZoneText(zone: BusinessZone = current): string { return `${zone.label}（${zone.offset}）`; }

/** Fixed offset of the business zone in minutes (only zones without daylight saving are offered). */
export function businessOffsetMinutes(zone: BusinessZone = current): number {
  const match = /^UTC([+-])(\d{1,2})(?::(\d{2}))?$/.exec(zone.offset);
  if (!match) return 480;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

/** Backend LocalDateTime has no offset and uses the Asia/Shanghai storage clock. */
export function parseBusinessTime(value: string): number {
  const unzoned = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?)$/.exec(value);
  return Date.parse(unzoned ? `${unzoned[1]}T${unzoned[2]}+08:00` : value);
}

/** Display business-local and offset timestamps consistently, independently of the browser zone. */
export function formatBusinessTime(value: unknown, options: Intl.DateTimeFormatOptions, fallback = "-"): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const timestamp = parseBusinessTime(value.trim());
  if (!Number.isFinite(timestamp)) return fallback;
  return `${new Intl.DateTimeFormat("zh-CN", { ...options, timeZone: current.zoneId, hourCycle: "h23" }).format(timestamp)}（${current.label}）`;
}

/** Compact business-local stamp ("2026-10-19 19:18") for dense side panels; the zone is stated once by the caller (M-12). */
export function formatBusinessTimeCompact(value: unknown, fallback = "-"): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const timestamp = parseBusinessTime(value.trim());
  if (!Number.isFinite(timestamp)) return fallback;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: current.zoneId, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(timestamp).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
