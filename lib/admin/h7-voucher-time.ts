/** H7 dates are calendar days in Beijing, independently of the operator's zone. */
export const H7_TIME_ZONE = { zoneId: "Asia/Shanghai", label: "北京时间" } as const;

export function isH7VoucherExpired(endAt: number, now: number): boolean {
  return endAt > 0 && endAt < now;
}

export function h7DateInput(ms: number): string {
  return ms ? new Date(ms + 8 * 3_600_000).toISOString().slice(0, 10) : "";
}

export function h7DateMs(date: string, end = false): number {
  if (!date) return 0;
  const ms = Date.parse(`${date}T${end ? "23:59:59.999" : "00:00:00.000"}+08:00`);
  if (!Number.isFinite(ms)) throw new Error("VOUCHER_TIME_RANGE_INVALID");
  return ms;
}

export function h7Stamp(ms: number): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: H7_TIME_ZONE.zoneId, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(ms).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** An unchanged calendar field must not migrate a stored timestamp. */
export function h7EditedDateMs(date: string, originalMs: number | undefined, end = false): number {
  return originalMs !== undefined && date === h7DateInput(originalMs) ? originalMs : h7DateMs(date, end);
}

/** Exact facts for the visual worker's legacy-time presentation. Zero is the API's open boundary. */
export function h7DateFacts(ms: number, end = false) {
  return { milliseconds: ms, beijingTime: ms === 0 ? null : new Date(ms + 8 * 3_600_000).toISOString().replace("Z", "+08:00"),
    calendarDate: h7DateInput(ms), wholeDayBoundary: ms === 0 || ms === h7DateMs(h7DateInput(ms), end) };
}
