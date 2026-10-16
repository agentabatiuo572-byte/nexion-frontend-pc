/** Backend LocalDateTime has no offset and uses the Asia/Shanghai business clock. */
export function parseBusinessTime(value: string): number {
  const unzoned = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?)$/.exec(value);
  return Date.parse(unzoned ? `${unzoned[1]}T${unzoned[2]}+08:00` : value);
}

/** Display business-local and offset timestamps consistently, independently of the browser zone. */
export function formatBusinessTime(value: unknown, options: Intl.DateTimeFormatOptions, fallback = "-"): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const timestamp = parseBusinessTime(value.trim());
  if (!Number.isFinite(timestamp)) return fallback;
  return `${new Intl.DateTimeFormat("zh-CN", { ...options, timeZone: "Asia/Shanghai", hourCycle: "h23" }).format(timestamp)}（北京时间）`;
}
