import type { L1KpiQuery, LReportCreateInput } from "@/lib/admin/l-client";
import { validateL1Dashboard } from "./l1-kpi-contract.ts";
import { readL1LiveTotals } from "./l1-l2-live-data.ts";

export type L1ExportMode = "series" | "snapshot" | "totals";

export type L1ExportSource = {
  parentData: unknown;
  data: unknown;
  query: L1KpiQuery;
  status: "ready" | "loading" | "error";
};

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

export function resolveL1ExportUnavailableReason(
  raw: unknown,
  sourceState: "ready" | "loading" | "error" = "ready",
): string | undefined {
  if (sourceState === "loading") return "关键指标加载中，请稍候";
  if (sourceState === "error") return "关键指标加载失败，请重试";
  if (resolveL1ExportMode(raw, false)) return undefined;
  if (record(raw).available === false) return "关键指标暂时不能用，请刷新后再试";
  if (hasDetailedL1Attempt(raw)) {
    try {
      validateL1Dashboard(raw);
      return "当前时间范围没有可用的关键指标，暂时不能导出";
    } catch {
      return "关键指标数据有误，请刷新后再试";
    }
  }
  return "暂无可导出的关键指标";
}

export async function submitL1Export(
  raw: unknown,
  sourceUnavailable: boolean,
  createReport: CreateReport | undefined,
  query: L1KpiQuery = { window: "7d" },
): Promise<L1ExportMode | null> {
  const mode = resolveL1ExportMode(raw, sourceUnavailable);
  if (!mode || !createReport) return null;
  const complete = mode === "series";
  const detailedSnapshot = mode === "snapshot";
  await createReport({
    window: query.window ?? "7d",
    from: query.from,
    to: query.to,
    cohort: query.cohort,
    phase: query.phase,
    locale: query.locale,
    ref: query.ref,
    exportType: complete ? "KPI 序列" : "KPI 当前汇总",
    timeRange: complete ? "当前时间范围" : "当前数据",
    fields: complete
      ? "8关键指标当前值/目标/环比序列"
      : detailedSnapshot
        ? "8关键指标当前值/目标/可用性"
        : "用户/订单/提现/兑换/质押/钱包流水/工单/审计聚合计数",
    piiLevel: "NONE",
    maskPolicy: "NONE",
    recipient: "BI 管理员",
    ticket: "L1-KPI",
  }, complete
    ? "导出关键指标聚合序列用于经营复盘"
    : detailedSnapshot
      ? "趋势数据不足，导出当前关键指标用于经营核对"
      : "导出当前累计数用于经营核对");
  return mode;
}
