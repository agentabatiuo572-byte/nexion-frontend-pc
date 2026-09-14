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
  if (sourceState === "loading") return "正在读取 KPI 数据，请稍候";
  if (sourceState === "error") return "KPI 数据读取失败，请重试";
  if (resolveL1ExportMode(raw, false)) return undefined;
  if (record(raw).available === false) return "KPI 数据暂不可用，请重新读取后再试";
  if (hasDetailedL1Attempt(raw)) {
    try {
      validateL1Dashboard(raw);
      return "当前时间窗没有可用 KPI，暂不能导出";
    } catch {
      return "KPI 数据格式异常，请重新读取后再试";
    }
  }
  return "尚未读取到可导出的 KPI 数据";
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
