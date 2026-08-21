const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

/** Serialize the structured editor's local datetime to the backend's configured LocalDateTime format. */
export function normalizeLegalTermsDateTime(value: string): string {
  const match = DATE_TIME_PATTERN.exec(value?.trim() ?? "");
  if (!match) throw new Error("LEGAL_TERMS_EFFECTIVE_AT_INVALID");
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText ?? "00");
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day
      || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second) {
    throw new Error("LEGAL_TERMS_EFFECTIVE_AT_INVALID");
  }
  return `${yearText}-${monthText}-${dayText} ${hourText}:${minuteText}:${String(second).padStart(2, "0")}`;
}

export function currentLegalTermsDateTime(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return normalizeLegalTermsDateTime(
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
  );
}
