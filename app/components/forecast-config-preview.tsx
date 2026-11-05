import { Cell, Explain, Notice, Table, Td, Th } from "@/app/components/rd";
import type { ForecastConfigPreview } from "@/lib/admin/b2-client";

/**
 * 保存预测设置前的影响：改前、改后、差额。确认框里放在关键信息下面（VS-103）；
 * 改后无法估值时不开确认框，传 surface 放在页面按钮旁。
 */
export function ForecastConfigImpact({ preview, categoryLabel, surface = false }: {
  preview: ForecastConfigPreview;
  categoryLabel: (key: string) => string;
  surface?: boolean;
}) {
  const d = preview.forecastDeltaPreview;
  const amount = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const coverage = (status: typeof d.beforeCoverageStatus, value: number | null) =>
    status === "NO_LIABILITIES" ? "无应付款" : status === "VALUATION_UNAVAILABLE" ? "暂时无法估值" : `${value?.toFixed(1)}%`;
  const rows: Array<[string, number, number, number]> = [
    ["7 天到期预测", d.before7dUsdt, d.after7dUsdt, d.delta7dUsdt],
    ["30 天到期预测", d.before30dUsdt, d.after30dUsdt, d.delta30dUsdt],
    ["配置储备", d.beforeReserveUsdt, d.afterReserveUsdt, d.reserveDeltaUsdt],
    ["配置应付款", d.beforeLiabilitiesUsdt, d.afterLiabilitiesUsdt, d.liabilitiesDeltaUsdt],
    ["净差额", d.beforeNetExposureUsdt, d.afterNetExposureUsdt, d.netExposureDeltaUsdt],
  ];
  if (d.beforeDailyGenesisUsdt !== d.afterDailyGenesisUsdt) rows.push(["每日创世", d.beforeDailyGenesisUsdt, d.afterDailyGenesisUsdt, d.dailyDeltaUsdt]);
  return (
    <section className="rd-impact" data-surface={surface ? "" : undefined} aria-label="配置影响预览">
      <h4 className="rd-impact-title">配置影响预览 · v{preview.version}<Explain label="配置口径怎么算" content="配置口径：配置储备 ÷ 配置全额应付款。此预览不代表兑付覆盖率，也不是储备除以 7 / 30 天到期预测；保存时系统会重新计算。" /></h4>
      <Table label="配置影响预览">
        <thead><tr><Th>项目（USDT）</Th><Th align="right">改前</Th><Th align="right">改后</Th><Th align="right">差额</Th></tr></thead>
        <tbody>
          {rows.map(([label, before, after, delta]) => (
            <tr key={label}>
              <Td>{label}</Td>
              <Td align="right"><Cell num main={amount(before)} /></Td>
              <Td align="right"><Cell num main={<span className={delta === 0 ? undefined : "rd-diff-after"}>{amount(after)}</span>} /></Td>
              <Td align="right"><Cell num main={`${delta > 0 ? "+" : ""}${amount(delta)}`} /></Td>
            </tr>
          ))}
          <tr>
            <Td>配置覆盖率（配置口径）</Td>
            <Td align="right"><Cell num main={coverage(d.beforeCoverageStatus, d.beforeCoveragePct)} /></Td>
            <Td align="right"><Cell num main={<span className={d.coverageDeltaPct ? "rd-diff-after" : undefined}>{coverage(d.afterCoverageStatus, d.afterCoveragePct)}</span>} /></Td>
            <Td align="right"><Cell num main={d.coverageDeltaPct === null ? "—" : `${d.coverageDeltaPct > 0 ? "+" : ""}${d.coverageDeltaPct.toFixed(1)} 个百分点`} /></Td>
          </tr>
        </tbody>
      </Table>
      <p className="rd-note">生效时间：{new Date(preview.effectiveAt).toISOString().slice(0, 16).replace("T", " ")} UTC，不影响历史数据。</p>
      {d.removedLiabilityCategories.length > 0 && <Notice tone="warn">以下科目将退出配置覆盖率分母：{d.removedLiabilityCategories.map(categoryLabel).join("、")}。</Notice>}
      {d.afterCoverageStatus === "VALUATION_UNAVAILABLE" && <Notice tone="warn">改后暂时无法估值，无法确认完整影响，不能提交。请返回修改草稿，或在估值恢复后重试预览。</Notice>}
    </section>
  );
}
