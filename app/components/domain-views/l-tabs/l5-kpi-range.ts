export const L5_KPI_WINDOWS = { "1d": "最近 1 天", "7d": "最近 7 天", "30d": "最近 30 天", custom: "自选日期" } as const;
type Window = keyof typeof L5_KPI_WINDOWS;

export function isL5KpiExport(exportType: string): boolean {
  return /^KPI(?:\s|_|$)/i.test(exportType.trim());
}

export function l5BusinessToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function dateMillis(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const millis = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value ? millis : NaN;
}

/** The submitted scope and confirmation label come from the same validated selection. */
export function l5KpiRange(value: Record<string, string>, today = l5BusinessToday()): {
  window: Window; from?: string; to?: string; timeRange: string;
} {
  const window = value.window;
  if (!Object.hasOwn(L5_KPI_WINDOWS, window)) throw new Error("请选择 KPI 时间范围");
  if (window !== "custom") return { window: window as Window, timeRange: L5_KPI_WINDOWS[window as Window] };
  const from = value.from?.trim() ?? "", to = value.to?.trim() ?? "";
  const first = dateMillis(from), last = dateMillis(to);
  if (!Number.isFinite(first) || !Number.isFinite(last)) throw new Error("请填写有效的开始和结束日期");
  if (first > last) throw new Error("开始日期不能晚于结束日期");
  if (to > today) throw new Error("结束日期不能晚于今天（北京时间）");
  if ((last - first) / 86_400_000 > 400) throw new Error("日期跨度不能超过 400 天");
  return { window: "custom", from, to, timeRange: `${from} / ${to}` };
}
