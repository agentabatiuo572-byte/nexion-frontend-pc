/** Only whole durations have a numeric month value. Preserve other warranty terms verbatim. */
export function warrantyMonths(value?: string | null): string | undefined {
  const duration = /^(\d+)\s*(个月|個月|月|months?|年|years?)?$/i.exec(value?.trim() ?? "");
  if (!duration) return undefined;
  const amount = duration[1].replace(/^0+(?=\d)/, "");
  if (!/^(?:年|years?)$/i.test(duration[2] ?? "")) return amount;
  const months = Number(amount) * 12;
  return Number.isSafeInteger(months) ? String(months) : undefined;
}
