export const NO_DUE_COVERAGE_COPY = "当前窗口无到期兑付，不计算覆盖天数";

export function formatReserveCoverDays(cumulativeDueUsdt: number, reserveCoverDays: number) {
  return cumulativeDueUsdt === 0
    ? NO_DUE_COVERAGE_COPY
    : `可覆盖 ${reserveCoverDays} 天`;
}
