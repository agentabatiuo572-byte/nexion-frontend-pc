"use client";

/**
 * F3 本期 / 上期全平台封顶总览。只读，数据来自 useF3CurrentPeriod，页面不算封顶、不算估算、不算缩减比例。
 * 本期还在累积：付款额截至现在，封顶只写后端给的估算（没给写原因或结算时定稿），已发写还没结算。
 * 上期：付款额、比例、封顶在这一期第一笔结算时定下；已发（自动、手动）是截至现在已记账的，还会变，剩余跟着已发变。
 * 整页刷新（ctx.f3Loading 由否变是）时跟着重读。
 */
import { useEffect, useState, type ReactNode } from "react";
import { Gauge, Lock } from "lucide-react";
import { BlockState, Cell, Explain, InlineRetry, Panel, StatusTag, Table, Td, Th, Tr } from "@/app/components/rd";
import { useF3CurrentPeriod, type F3CurrentPeriodView, type F3LatestFrozenPeriodView } from "@/lib/admin/f3-current-period";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { FViewCtx } from "./types";

/** 原因码到运营文字。没列出的原因码统一写「读不到」，不把原因码给运营看。 */
const REASON_TEXT: Record<string, string> = {
  F3_SETTLE_PERIOD_MISSING: "结算周期没设，本期算不出",
  F3_SETTLE_PERIOD_INVALID: "结算周期设置无效，本期算不出",
  F3_BUSINESS_PERIOD_UNAVAILABLE: "日期读不到，这一期算不出",
  F3_PLATFORM_PERIOD_UNAVAILABLE: "结算数据读不到",
  F3_PLATFORM_CAP_PCT_INVALID: "全平台封顶比例无效",
  F3_PLATFORM_CAP_PCT_UNAVAILABLE: "读不到",
  F3_PAID_SALES_UNAVAILABLE: "读不到",
};
/** 只影响一格的原因，不让整行停下。 */
const CELL_ONLY = new Set(["F3_PLATFORM_CAP_PCT_INVALID", "F3_PLATFORM_CAP_PCT_UNAVAILABLE", "F3_PAID_SALES_UNAVAILABLE"]);
/** 要运营去改设置的原因，标成注意色；其余是读取问题，只写字。 */
const NEEDS_SETTING = new Set(["F3_SETTLE_PERIOD_MISSING", "F3_SETTLE_PERIOD_INVALID"]);
const COLUMNS = 6;
const CAP_FINAL = "结算时按本期全部付款额和当时的比例定稿，期间有退款会变小";
const LATEST_EXPLAIN = "这一期第一笔结算时，付款额、全平台封顶比例和全平台封顶就定下了；已发是截至现在已记账的，还有人没结算时会变，剩余跟着已发变。";

/** 和本页其它逐笔金额同一写法：千分位，去掉末尾 0，至少两位小数，不舍入。 */
const money = (raw: string) => {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  return match ? `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(match[3] ?? "").replace(/0+$/, "").padEnd(2, "0")}` : raw;
};
/** 百分数去掉末尾 0：5.0000 写 5%。 */
const percent = (raw: string) => `${raw.includes(".") ? raw.replace(/0+$/, "").replace(/\.$/, "") : raw}%`;
const range = (start: string | null, end: string | null) => start && end ? `${start} 至 ${end}` : null;

function Blocked({ label, reasons, onRetry }: { label: string; reasons: readonly string[]; onRetry?: () => void }) {
  const code = reasons.find((reason) => REASON_TEXT[reason] && !CELL_ONLY.has(reason));
  const text = code ? REASON_TEXT[code] : "这一期的数据读不到";
  return (
    <Tr>
      <Td colSpan={COLUMNS}>
        {label}{" "}
        {code && NEEDS_SETTING.has(code)
          ? <StatusTag tone="warn" explain="在下面「结算设置」里设好结算周期，本期的日期和付款额才算得出。">{text}</StatusTag>
          : <>{text}{onRetry && <> <InlineRetry onRetry={onRetry} /></>}</>}
      </Td>
    </Tr>
  );
}

function ratio(period: F3CurrentPeriodView | F3LatestFrozenPeriodView): ReactNode {
  if (period.platformCapPct !== null) return percent(period.platformCapPct);
  if (period.unavailableReasons.includes("F3_PLATFORM_CAP_PCT_INVALID")) {
    return <StatusTag tone="warn" explain="全平台封顶比例的设置值认不出，结算前要改成有效的比例。">{REASON_TEXT.F3_PLATFORM_CAP_PCT_INVALID}</StatusTag>;
  }
  return period.unavailableReasons.includes("F3_PLATFORM_CAP_PCT_UNAVAILABLE") ? REASON_TEXT.F3_PLATFORM_CAP_PCT_UNAVAILABLE : "—";
}

function paid(period: F3CurrentPeriodView | F3LatestFrozenPeriodView): ReactNode {
  if (period.paidSalesUsdt !== null) return money(period.paidSalesUsdt);
  return period.unavailableReasons.includes("F3_PAID_SALES_UNAVAILABLE") ? REASON_TEXT.F3_PAID_SALES_UNAVAILABLE : "—";
}

/** 本期没有估算时封顶这格写什么：有原因写清是哪样读不到；旧版本不给估算时写结算时定稿，不让人以为本期没有封顶。 */
const ESTIMATE_REASON_TEXT: Record<string, string> = {
  F3_PAID_SALES_UNAVAILABLE: "付款额读不到，估不出",
  F3_PLATFORM_CAP_PCT_UNAVAILABLE: "全平台封顶比例读不到，估不出",
  F3_PLATFORM_CAP_PCT_INVALID: "全平台封顶比例无效，估不出",
};
function estimateMissing(period: F3CurrentPeriodView, onRetry: () => void): ReactNode {
  if (period.estimateReason === null) {
    return <>结算时定稿<Explain label="本期全平台封顶的说明" content={`这一期有全平台封顶。${CAP_FINAL}；现在的系统版本还不给估算。`} side="top" /></>;
  }
  const text = ESTIMATE_REASON_TEXT[period.estimateReason] ?? "读不到，估不出";
  return period.estimateReason === "F3_PLATFORM_CAP_PCT_INVALID" ? text : <>{text} <InlineRetry onRetry={onRetry} /></>;
}

function CurrentRow({ period, onRetry }: { period: F3CurrentPeriodView; onRetry: () => void }) {
  if (!period.availability.dates) return <Blocked label="本期" reasons={period.unavailableReasons} onRetry={onRetry} />;
  const settled = period.frozen === true;
  return (
    <Tr>
      <Td>
        <Cell main={<>本期 <StatusTag tone={settled ? "done" : "progress"}>{settled ? "已结算" : "累积中"}</StatusTag></>}
          sub={[range(period.periodStart, period.periodEnd), period.cadence && `${period.cadence}结算`].filter(Boolean).join(" · ")} />
      </Td>
      <Td align="right"><Cell num main={paid(period)} /></Td>
      <Td align="right"><Cell num main={ratio(period)} /></Td>
      <Td align="right">
        {settled
          ? <Cell num main={period.platformCapUsdt === null ? "—" : money(period.platformCapUsdt)} />
          : period.platformCapEstimateUsdt !== null
            ? <Cell num main={<>约 {money(period.platformCapEstimateUsdt)}<Explain label="全平台封顶估算的说明" content={CAP_FINAL} side="top" /></>}
                sub={<StatusTag tone="neutral">估算</StatusTag>} />
            : <Cell main={estimateMissing(period, onRetry)} />}
      </Td>
      {settled
        ? <>
          <Td align="right"><Cell num main={period.settledPayoutUsdt === null ? "—" : money(period.settledPayoutUsdt)}
            sub={period.automaticSettledUsdt !== null && period.manualSettledUsdt !== null ? `自动 ${money(period.automaticSettledUsdt)} · 手动 ${money(period.manualSettledUsdt)}` : undefined} /></Td>
          <Td align="right"><Cell num main={period.platformRemainingUsdt === null ? "—" : money(period.platformRemainingUsdt)} /></Td>
        </>
        : <>
          <Td align="right"><Cell main="本期还没结算" /></Td>
          <Td align="right"><Cell num main="—" /></Td>
        </>}
    </Tr>
  );
}

function LatestRow({ period, onRetry }: { period: F3LatestFrozenPeriodView; onRetry: () => void }) {
  if (period.frozen === false && period.unavailableReasons.includes("F3_PLATFORM_PERIOD_NOT_FROZEN")) {
    return <Tr><Td colSpan={COLUMNS}>上期 <StatusTag tone="neutral">还没有已结算的周期</StatusTag></Td></Tr>;
  }
  if (!period.availability.dates) return <Blocked label="上期" reasons={period.unavailableReasons} onRetry={onRetry} />;
  const auto = period.automaticSettledUsdt, manual = period.manualSettledUsdt;
  return (
    <Tr>
      <Td><Cell main={<>上期 <Explain label="封顶已定是什么意思" content={LATEST_EXPLAIN} side="top" align="start"><StatusTag tone="done" icon={Lock}>封顶已定</StatusTag></Explain></>} sub={range(period.periodStart, period.periodEnd) ?? undefined} /></Td>
      <Td align="right"><Cell num main={paid(period)} /></Td>
      <Td align="right"><Cell num main={ratio(period)} /></Td>
      <Td align="right">
        <Cell num main={period.platformCapUsdt === null ? "—" : money(period.platformCapUsdt)}
          sub={period.plannedRawExceedsCap ? <StatusTag tone="warn"
            explain={<><p>{`这一期按规则应发 ${money(period.plannedRawTotalUsdt ?? "")} USDT，超过全平台封顶。`}</p><p>第一笔结算时按同一个比例把全期应发压到封顶以内；之后每笔只会少发、不会多发，实际缩减比例可能更大，以下面结算记录里每笔为准。</p></>}>
            超出封顶，已按比例压缩</StatusTag> : undefined} />
      </Td>
      <Td align="right"><Cell num main={period.settledPayoutUsdt === null ? "—" : money(period.settledPayoutUsdt)}
        sub={auto !== null && manual !== null ? `自动 ${money(auto)} · 手动 ${money(manual)}` : undefined} /></Td>
      <Td align="right"><Cell num main={period.platformRemainingUsdt === null ? "—" : money(period.platformRemainingUsdt)} /></Td>
    </Tr>
  );
}

export function F3PeriodOverview({ ctx }: { ctx: FViewCtx }) {
  const [mounted, setMounted] = useState(false);
  const [refreshKey, setRefreshKey] = useState<number | null>(null);
  // Let the parent start its tab-entry read in the same effect pass before starting ours.
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!mounted) return;
    if (ctx.f3Loading) setRefreshKey(key => key === null ? null : key + 1);
    else setRefreshKey(key => key ?? 0);
  }, [mounted, ctx.f3Loading]);
  const state = useF3CurrentPeriod(refreshKey ?? 0, refreshKey !== null);
  const { reload } = state;

  const title = "本期和上期全平台封顶";
  const explain = "全平台一期团队平衡奖励最多发多少：全平台封顶 = 这一期已付款订单额 × 全平台封顶比例，结算时定稿。";
  if (state.status !== "success") {
    return (
      <Panel title={title} icon={Gauge} tone="role-4" explain={explain}>
        {state.status === "loading" && <BlockState state="loading" title="正在加载本期和上期全平台封顶…" />}
        {state.status === "error" && <BlockState state="error" title="本期和上期全平台封顶加载失败" detail={displayAdminError(state.error)} onRetry={reload} />}
        {state.status === "invalid-response" && <BlockState state="error" title="本期和上期全平台封顶加载失败" detail={displayAdminError(undefined)} onRetry={reload} />}
        {state.status === "forbidden" && <BlockState state="denied" title="没有查看权限" detail="这个账号不能查看团队平衡奖励的全平台封顶。" />}
        {state.status === "not-found" && <BlockState state="empty" title="系统版本还没有这项数据" detail="系统升级后，这里显示本期和上期的全平台封顶。" />}
      </Panel>
    );
  }
  const { currentPeriod, latestFrozenPeriod } = state.data;
  return (
    <Panel title={title} icon={Gauge} tone="role-4" explain={explain} flush>
      <Table label={title}>
        <thead><tr>
          <Th>周期</Th>
          <Th align="right">已付款订单额（USDT）<Explain label="已付款订单额的口径" content="本期是从开始到现在已付款的订单额，还在累积；上期是这一期第一笔结算时定下的全期付款额。退款、取消、失败的订单不算。" /></Th>
          <Th align="right">全平台封顶比例<Explain label="全平台封顶比例的口径" content="本期写现在的设置，结算时按当时的比例定；上期是这一期第一笔结算时定下的比例。" /></Th>
          <Th align="right">全平台封顶（USDT）</Th>
          <Th align="right">已发（USDT）<Explain label="已发的口径" content="这一期截至现在已经记账的团队平衡奖励，分自动结算和手动结算写；还有人没结算完时会继续变。" /></Th>
          <Th align="right">剩余（USDT）<Explain label="剩余的口径" content="全平台封顶减去已发，跟着已发变。" /></Th>
        </tr></thead>
        <tbody>
          <CurrentRow period={currentPeriod} onRetry={reload} />
          <LatestRow period={latestFrozenPeriod} onRetry={reload} />
        </tbody>
      </Table>
    </Panel>
  );
}
