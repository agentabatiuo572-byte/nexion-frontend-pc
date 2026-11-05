import type { ForecastConfigPreview } from "@/lib/admin/b2-client";

export function ForecastConfigImpact({ preview, categoryLabel }: {
  preview: ForecastConfigPreview;
  categoryLabel: (key: string) => string;
}) {
  const d = preview.forecastDeltaPreview;
  const amount = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const coverage = (status: typeof d.beforeCoverageStatus, value: number | null) =>
    status === "NO_LIABILITIES" ? "无应付款" : status === "VALUATION_UNAVAILABLE" ? "暂时无法估值" : `${value}%`;
  const rows: Array<[string, number, number, number]> = [
    ["7 天到期预测", d.before7dUsdt, d.after7dUsdt, d.delta7dUsdt],
    ["30 天到期预测", d.before30dUsdt, d.after30dUsdt, d.delta30dUsdt],
    ["配置储备", d.beforeReserveUsdt, d.afterReserveUsdt, d.reserveDeltaUsdt],
    ["配置应付款", d.beforeLiabilitiesUsdt, d.afterLiabilitiesUsdt, d.liabilitiesDeltaUsdt],
    ["净差额", d.beforeNetExposureUsdt, d.afterNetExposureUsdt, d.netExposureDeltaUsdt],
  ];
  if (d.beforeDailyGenesisUsdt !== d.afterDailyGenesisUsdt) rows.push(["每日创世", d.beforeDailyGenesisUsdt, d.afterDailyGenesisUsdt, d.dailyDeltaUsdt]);
  return <section aria-label="配置影响预览" style={{ margin: "16px 0" }}>
    <b>配置影响预览 · v{preview.version}</b>
    <p>生效时间：{new Date(preview.effectiveAt).toISOString().slice(0, 16).replace("T", " ")} UTC，不影响历史数据。</p>
    <div style={{ overflowX: "auto" }}><table style={{ width: "100%", textAlign: "right", borderSpacing: "8px 4px", fontSize: 12 }}>
      <thead><tr><th style={{ textAlign: "left" }}>项目（USDT）</th><th>改前</th><th>改后</th><th>差额</th></tr></thead>
      <tbody>{rows.map(([label, before, after, delta]) => <tr key={label}>
        <th style={{ textAlign: "left" }}>{label}</th><td>{amount(before)}</td><td>{amount(after)}</td><td>{delta > 0 ? "+" : ""}{amount(delta)}</td>
      </tr>)}<tr><th style={{ textAlign: "left" }}>配置覆盖率（配置口径）</th>
        <td>{coverage(d.beforeCoverageStatus, d.beforeCoveragePct)}</td><td>{coverage(d.afterCoverageStatus, d.afterCoveragePct)}</td>
        <td>{d.coverageDeltaPct === null ? "—" : `${d.coverageDeltaPct > 0 ? "+" : ""}${d.coverageDeltaPct} 个百分点`}</td>
      </tr></tbody>
    </table></div>
    <p>配置口径：配置储备 ÷ 配置全额应付款。此预览不代表兑付覆盖率，也不是储备除以 7 / 30 天到期预测；保存时系统会重新计算。</p>
    {d.removedLiabilityCategories.length > 0 && <p role="alert" style={{ color: "var(--warning, #ad6500)" }}>以下科目将退出配置覆盖率分母：{d.removedLiabilityCategories.map(categoryLabel).join("、")}。</p>}
    {d.afterCoverageStatus === "VALUATION_UNAVAILABLE" && <p role="alert">改后暂时无法估值，无法确认完整影响，不能提交。请返回修改草稿，或在估值恢复后重试预览。</p>}
  </section>;
}
