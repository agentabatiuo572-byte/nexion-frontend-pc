"use client";

/**
 * 今日概览自己的读取。只读现有接口，字段都在这里校验一次，页面拿到的是类型化的值。
 * 其余数据用各自的 client：b-domain、reserve、flowWindows、A2、提现、客服待办、J1、转化。
 */
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { finiteDashboardNumber } from "@/lib/admin/dashboard-number";
import type { KpiTrendPoint } from "@/lib/admin/kpi-trend";
import { fetchC1Overview, fetchUserProfilesPage } from "@/lib/admin/user360-client";
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

/** 经营数据的三个时段，切换时不重读：三段数据都在第一次读齐（B0 5.6）。 */
export type B0Period = "today" | "week" | "month";

/** 某个业务日的昨天、周一、上周一、上周日、1 日。只做日期串运算，不碰浏览器时区。 */
export function b0PeriodDays(today: string) {
  const [year, month, day] = today.split("-").map(Number);
  const shifted = (offset: number) => new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
  const sinceMonday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  return { yesterday: shifted(-1), monday: shifted(-sinceMonday), lastMonday: shifted(-sinceMonday - 7), lastSunday: shifted(-sinceMonday - 1), monthStart: `${today.slice(0, 8)}01` };
}

/** 设备销售额和订单数，带上一期全期的金额。totalUsdt 把团队奖励这种支出也算了，不用（B0 4.2）。 */
export async function fetchB0Sales() {
  const period = async (name: "day" | "week" | "month") => {
    const data = await read(`/api/admin/bi/finance/revenue?period=${name}`);
    if (!Array.isArray(data.streams)) invalid("streams");
    const sales = (data.streams as Row[]).find((row) => row.stream === "device_sales") ?? invalid("streams.device_sales");
    return { amount: amount(sales.amountUsdt, "amountUsdt"), orders: amount(sales.orderCount, "orderCount"), previous: amount(sales.previousAmountUsdt, "previousAmountUsdt") };
  };
  const [today, week, month] = await Promise.all([period("day"), period("week"), period("month")]);
  return { today, week, month };
}

/** 用户入金和已完成提现。按天的接口最多 31 天，够算本月和上周，不够算上月，所以本月没有对比。今天取接口最后一天，和后端切日一致。 */
export async function fetchB0MoneyFlows() {
  const data = await read("/api/admin/bi/finance/daily-flows?days=31");
  if (!Array.isArray(data.days) || data.days.length === 0) invalid("days");
  const days = (data.days as Row[]).map((row) => ({
    date: typeof row.date === "string" ? row.date : invalid("date"),
    topup: amount(row.userTopupUsdt, "userTopupUsdt"),
    topupCount: amount(row.userTopupCount, "userTopupCount"),
    withdrawal: amount(row.withdrawalUsdt, "withdrawalUsdt"),
    withdrawalCount: amount(row.withdrawalCount, "withdrawalCount"),
  }));
  const today = days[days.length - 1].date;
  const { yesterday, monday, lastMonday, lastSunday, monthStart } = b0PeriodDays(today);
  // 金额是两位小数，相加相减后回到分，净入金才不会出现 +0.00。
  const cents = (value: number) => Math.round(value * 100) / 100;
  const between = (from: string, to: string) => {
    const rows = days.filter((row) => row.date >= from && row.date <= to);
    const total = (pick: (row: (typeof days)[number]) => number) => cents(rows.reduce((sum, row) => sum + pick(row), 0));
    const topup = total((row) => row.topup);
    const withdrawal = total((row) => row.withdrawal);
    return { topup, topupCount: total((row) => row.topupCount), withdrawal, withdrawalCount: total((row) => row.withdrawalCount), net: cents(topup - withdrawal) };
  };
  return {
    today: { current: between(today, today), previous: between(yesterday, yesterday) },
    week: { current: between(monday, today), previous: between(lastMonday, lastSunday) },
    month: { current: between(monthStart, today), previous: null },
  };
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

/** 累计注册和今日、本周、本月新增，按业务日历取日期（B0 5.6）。接口每页至少 20 条，传小了分页校验不过，只用 total。 */
export async function fetchB0Registrations() {
  const today = businessDay();
  const { monday, monthStart } = b0PeriodDays(today);
  const joined = async (from: string) => (await fetchUserProfilesPage({ joinedFrom: from, joinedTo: today, pageNum: 1, pageSize: 20 })).total;
  const [overview, todayNew, weekNew, monthNew] = await Promise.all([fetchC1Overview(), joined(today), joined(monday), joined(monthStart)]);
  return { total: overview.totalUsers, today: todayNew, week: weekNew, month: monthNew };
}

/** 今日和昨日活跃人数。当天没有记录时接口给 null，不当 0。 */
export async function fetchB0ActiveUsers() {
  const data = await read("/api/admin/users/active-summary");
  const count = (day: unknown, field: string) => {
    if (!day || typeof day !== "object") invalid(field);
    return finiteDashboardNumber((day as Row).activeUsers);
  };
  return { today: count(data.today, "today"), yesterday: count(data.yesterday, "yesterday") };
}

export async function fetchB0Devices() {
  const data = await read("/api/admin/devices/overview");
  return {
    total: amount(data.total, "total"),
    running: amount(data.running, "running"),
    waitingActivation: amount(data.waitingActivation, "waitingActivation"),
    stopped: amount(data.stopped, "stopped"),
  };
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
