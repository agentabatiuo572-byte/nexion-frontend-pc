"use client";

/**
 * 今日概览自己的读取。只读现有接口，字段都在这里校验一次，页面拿到的是类型化的值。
 * 其余数据用各自的 client：b-domain、reserve、flowWindows、A2、提现、客服待办、J1、转化。
 */
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { finiteDashboardNumber } from "@/lib/admin/dashboard-number";
import type { KpiTrendPoint } from "@/lib/admin/kpi-trend";
import { fetchUserProfilesPage } from "@/lib/admin/user360-client";
import { businessDay } from "@/lib/admin/business-time";

type ApiResult<T> = { code: number; message?: string; data?: T };
type Row = Record<string, unknown>;

async function read(endpoint: string): Promise<Row> {
  const response = await guardedFetch(endpoint, { cache: "no-store" });
  const result = (await response.json().catch(() => null)) as ApiResult<Row> | null;
  if (!response.ok || !result || result.code !== 0 || !result.data) {
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    throw new Error(formatAdminApiError(result?.message, `B0_LOAD_FAILED_${response.status}`));
  }
  return result.data;
}

function invalid(field: string): never {
  throw new Error(`B0_RESPONSE_INVALID:${field}`);
}

function amount(value: unknown, field: string): number {
  return finiteDashboardNumber(value) ?? invalid(field);
}

/** 今天和昨天全天的设备销售额。totalUsdt 把团队奖励这种支出也算了，不用（B0 4.2）。 */
export async function fetchB0Sales() {
  const data = await read("/api/admin/bi/finance/revenue?period=day");
  if (!Array.isArray(data.streams)) invalid("streams");
  const sales = (data.streams as Row[]).find((row) => row.stream === "device_sales") ?? invalid("streams.device_sales");
  return { today: amount(sales.amountUsdt, "amountUsdt"), yesterday: amount(sales.previousAmountUsdt, "previousAmountUsdt") };
}

/** 今天的提现提交、完成、拒绝笔数和平均到账小时数。 */
export async function fetchB0Redemption() {
  const data = await read("/api/admin/bi/finance/redemption?period=day");
  return {
    submitted: amount(data.submitted, "submitted"),
    confirmed: amount(data.confirmed, "confirmed"),
    rejected: amount(data.rejected, "rejected"),
    averageLatencyHours: finiteDashboardNumber(data.averageLatencyHours),
  };
}

/** 今天和昨天全天的新增用户，按业务日历取日期（B0 5.6）。接口每页至少 20 条，传小了分页校验不过，只用 total。 */
export async function fetchB0NewUsers() {
  const count = async (day: string) => (await fetchUserProfilesPage({ joinedFrom: day, joinedTo: day, pageNum: 1, pageSize: 20 })).total;
  const [today, yesterday] = await Promise.all([count(businessDay()), count(businessDay(-1))]);
  return { today, yesterday };
}

export async function fetchB0Devices() {
  const data = await read("/api/admin/devices/overview");
  return { online: amount(data.onlineDevices, "onlineDevices"), abnormal: amount(data.abnormalDevices, "abnormalDevices") };
}

export type B0Kpi = {
  n: number;
  label: string;
  value: string;
  target: string;
  pass: boolean | null;
  /** 分母不足 5，不算比例（决定 8）。 */
  smallSample: boolean;
  series: KpiTrendPoint[];
  trendLabels: string[];
  trendSuppressed: boolean;
  hint: string;
};

function kpiTarget(row: Row): string | null {
  const unit = typeof row.unit === "string" ? row.unit : "";
  if (row.dir === "band") {
    const [low, high] = Array.isArray(row.band) ? row.band.map(finiteDashboardNumber) : [];
    return low == null || high == null ? null : `${low}-${high}${unit}`;
  }
  const target = finiteDashboardNumber(row.target);
  if (target == null || (row.dir !== "lte" && row.dir !== "gte")) return null;
  return `${row.dir === "lte" ? "<" : ">"}${target}${unit}`;
}

/** 区间是闭区间，lte、gte 严格比较，等于目标不算达标；值缺失是暂无法计算，不是未达标（B0-C02）。 */
function kpiPass(row: Row): boolean | null {
  const value = finiteDashboardNumber(row.value);
  if (value == null) return null;
  if (row.dir === "band") {
    const [low, high] = Array.isArray(row.band) ? row.band.map(finiteDashboardNumber) : [];
    return low == null || high == null ? null : value >= low && value <= high;
  }
  const target = finiteDashboardNumber(row.target);
  if (target == null) return null;
  return row.dir === "lte" ? value < target : row.dir === "gte" ? value > target : null;
}

/** 关键指标。名称或目标不合法的行丢掉，数量不强凑 8 项（B0-V14）。 */
export async function fetchB0Kpis(): Promise<B0Kpi[]> {
  const data = await read("/api/admin/bi/kpi/overview");
  if (!Array.isArray(data.kpis)) invalid("kpis");
  const plain = (data.kpiPlain ?? {}) as Row;
  const ext = (data.kpiExt ?? {}) as Record<string, Row>;
  return (data.kpis as Row[]).flatMap((row, index) => {
    const n = finiteDashboardNumber(row.n) ?? index + 1;
    const label = typeof row.name === "string" ? row.name.trim() : "";
    const target = kpiTarget(row);
    if (!label || target == null) return [];
    const value = finiteDashboardNumber(row.value);
    const denominator = finiteDashboardNumber(row.denominator);
    const smallSample = row.suppressed === true || (denominator != null && denominator < 5);
    const hint = plain[String(n)] ?? ext[String(n)]?.note ?? row.vis;
    return [{
      n,
      label,
      value: smallSample ? "样本过小" : value == null ? "—" : `${value}${typeof row.unit === "string" ? row.unit : ""}`,
      target,
      pass: smallSample ? null : kpiPass(row),
      smallSample,
      series: !smallSample && Array.isArray(row.spark) ? row.spark.map(finiteDashboardNumber) : [],
      trendLabels: Array.isArray(data.weeks) ? data.weeks.map(String) : [],
      trendSuppressed: Array.isArray(row.sparkSuppressed) && row.sparkSuppressed.includes(true),
      hint: typeof hint === "string" ? hint : "",
    }];
  });
}
