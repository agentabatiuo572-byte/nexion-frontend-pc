import type { LReportCreateInput } from "@/lib/admin/l-client";
import { validateL1Dashboard } from "./l1-kpi-contract.ts";
import { readL1LiveTotals } from "./l1-l2-live-data.ts";

export type L1ExportMode = "series" | "snapshot" | "totals";

type CreateReport = (input: LReportCreateInput, reason: string) => Promise<void>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasDetailedL1Attempt(raw: unknown): boolean {
  const data = record(raw);
  return ["kpis", "weeks", "kpiPlain", "kpiExt"]
    .some((key) => Object.prototype.hasOwnProperty.call(data, key));
}

export function resolveL1ExportMode(raw: unknown, sourceUnavailable: boolean): L1ExportMode | null {
  if (sourceUnavailable) return null;
  if (record(raw).available === false) return null;
  if (hasDetailedL1Attempt(raw)) {
    try {
      validateL1Dashboard(raw);
      const kpis = record(raw).kpis as Array<Record<string, unknown>>;
      if (!kpis.some((row) => row.available === true)) return null;
      return kpis.every((row) => Array.isArray(row.spark) && row.spark.length === 6)
        ? "series"
        : "snapshot";
    } catch {
      return null;
    }
  }
  return readL1LiveTotals(raw).length > 0 ? "totals" : null;
}

export async function submitL1Export(
  raw: unknown,
  sourceUnavailable: boolean,
  createReport: CreateReport | undefined,
): Promise<L1ExportMode | null> {
  const mode = resolveL1ExportMode(raw, sourceUnavailable);
  if (!mode || !createReport) return null;
  const complete = mode === "series";
  const detailedSnapshot = mode === "snapshot";
  await createReport({
    exportType: complete ? "KPI 序列" : "KPI 当前汇总",
    timeRange: complete ? "当前时间窗" : "当前快照",
    fields: complete
      ? "8 KPI 当前值/目标/环比序列"
      : detailedSnapshot
        ? "8 KPI 当前值/目标/可用性"
        : "用户/订单/提现/兑换/质押/钱包流水/工单/审计聚合计数",
    piiLevel: "NONE",
    maskPolicy: "NONE",
    recipient: "BI 管理员",
    ticket: "L1-KPI",
  }, complete
    ? "导出 KPI 聚合序列用于经营复盘"
    : detailedSnapshot
      ? "趋势数据不足时导出可用 KPI 当前快照用于经营核对"
      : "导出 L1 当前累计事实用于经营核对");
  return mode;
}
