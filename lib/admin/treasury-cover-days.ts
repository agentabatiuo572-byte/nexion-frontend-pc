export const NO_DUE_COVERAGE_COPY = "当前窗口无到期兑付，不计算覆盖天数";

/** 够付一年以上时天数没有判断价值，写「1 年以上」；精确值放在口径说明里。 */
export function coverDaysText(reserveCoverDays: number) {
  return reserveCoverDays >= 365 ? "1 年以上" : `${Math.floor(reserveCoverDays).toLocaleString("en-US")} 天`;
}

export function formatReserveCoverDays(cumulativeDueUsdt: number, reserveCoverDays: number) {
  return cumulativeDueUsdt === 0
    ? NO_DUE_COVERAGE_COPY
    : `可覆盖 ${coverDaysText(reserveCoverDays)}`;
}
