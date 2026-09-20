/** Missing analytics are not numeric zero, especially for lower-is-better KPIs. */
export function finiteDashboardNumber(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 八项 KPI 的三态口径汇总。**所有入口必须共用本函数**(zentao #208)。
 *
 * `pass === null` 表示「没有分母、暂不可计算」,它不是「未达标」:把两者混成一类,
 * 会让运营总览的验收墙显示「达标 0 / 未达 4 / 暂不可计算 4」,而同一页的 L 域速览
 * 显示「达标 0 / 未达 8」—— 同一批指标在同一屏给出两个互相矛盾的结论。
 *
 * 之所以提成函数:此前两处各自手写算式,一处用 `length - passed`(把不可计算算进未达),
 * 另一处用 `pass === false`(正确),两边都不会因为对方改口径而变红。
 */
export function rollupKpiPassState(kpis: ReadonlyArray<{ pass: boolean | null }>): {
  total: number;
  passed: number;
  failed: number;
  unknown: number;
} {
  return {
    total: kpis.length,
    passed: kpis.filter((kpi) => kpi.pass === true).length,
    failed: kpis.filter((kpi) => kpi.pass === false).length,
    unknown: kpis.filter((kpi) => kpi.pass === null).length,
  };
}
