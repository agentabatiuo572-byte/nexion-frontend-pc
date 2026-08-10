const DAY_MS = 86_400_000;

function fullDateDay(label: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.trunc(date.getTime() / DAY_MS);
}

function shortDateDays(labels: string[]): number[] | null {
  let year = 2000;
  let previousMonth = -1;
  const result: number[] = [];
  for (const label of labels) {
    const match = /^(\d{2})-(\d{2})$/.exec(label);
    if (!match) return null;
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (previousMonth === 12 && month === 1) year += 1;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    result.push(Math.trunc(date.getTime() / DAY_MS));
    previousMonth = month;
  }
  return result;
}

export function isConsecutiveDayLabels(labels: string[]): boolean {
  if (!labels.length) return false;
  const full = labels.every((label) => /^\d{4}-/.test(label));
  const days = full ? labels.map(fullDateDay) : shortDateDays(labels);
  if (!days || days.some((day) => day === null)) return false;
  return days.every((day, index) => index === 0 || day! === days[index - 1]! + 1);
}

export function isConsecutiveMonthLabels(labels: string[]): boolean {
  if (!labels.length) return false;
  const months = labels.map((label) => {
    const match = /^(\d{4})-(\d{2})$/.exec(label);
    if (!match) return null;
    const month = Number(match[2]);
    return month >= 1 && month <= 12 ? Number(match[1]) * 12 + month - 1 : null;
  });
  return months.every((month, index) => month !== null && (index === 0 || month === months[index - 1]! + 1));
}

function isoWeekStart(label: string): number | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(label);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4.getTime() - (jan4Day - 1) * DAY_MS + (week - 1) * 7 * DAY_MS);
  const thursday = new Date(monday.getTime() + 3 * DAY_MS);
  if (thursday.getUTCFullYear() !== year) return null;
  return Math.trunc(monday.getTime() / DAY_MS);
}

export function isIncreasingIsoWeekLabels(labels: string[]): boolean {
  if (!labels.length) return false;
  const weeks = labels.map(isoWeekStart);
  return weeks.every((week, index) => week !== null && (index === 0 || week > weeks[index - 1]!));
}
