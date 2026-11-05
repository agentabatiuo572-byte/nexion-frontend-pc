"use client";

/** 资金储备与应付款四个页签的内容。这里只管显示，读取、权限和写操作都在 d3-treasury.tsx。 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { AlarmClock, ArrowDownUp, CalendarClock, Coins, Gauge, Landmark, PieChart, ReceiptText, Scale, ShieldCheck, Wallet } from "lucide-react";
import { BlockState, Button, Check, CheckGroup, Cell, ColumnChart, Conclusion, Donut, Explain, Field, Figure, Fold, JudgmentPoints, KeyValues, LevelList, Notice, Panel, Segments, Select, Stat, StatBand, StatusTag, Table, Td, Th, TierBand, Tr, TrendLine, Drawer, type ChartSlot } from "@/app/components/rd";
import { businessOffsetMinutes, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import type { D3ForecastConfig, D3Main, D3MaturityForecast, D3NetExposure, D3WaterLevel } from "@/lib/admin/d-client";
import { LIABILITY_EXPLANATIONS, liabilityDisplayName } from "@/lib/admin/liability-labels";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { coverDaysText, formatReserveCoverDays } from "@/lib/admin/treasury-cover-days";

/** 90 天不再提供。已有的 90 天草稿还看得到，但不能连别的改动一起保存（PCN-38）。 */
export const FORECAST_90D_BLOCK = "90 天不再提供，改成 7 天或 30 天才能保存。";

export type ForecastValues = Pick<D3ForecastConfig, "reserveCategories" | "liabilityCategories" | "forecastWindow" | "genesisIncluded" | "includeFarLiabilities" | "stakingInterestMode" | "trialStressEnabled">;
export interface Loadable<T> { data: T | null; loading: boolean; error: string }
export interface CrossLink { href: string; label: string; reachable: boolean }

export const categoryText = (key: string) => liabilityDisplayName(key, ({ usdt: "USDT 储备", otherLiquid: "其他可用资产" } as Record<string, string>)[key] ?? "其他科目");
export const amountText = (value: number) => Number(value).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
export const money = (value: number) => `${amountText(value)} USDT`;
const compact = (value: number) => {
  const size = Math.abs(value);
  return size >= 1_000_000 ? `${Number((value / 1_000_000).toFixed(2))}M` : size >= 1_000 ? `${Number((value / 1_000).toFixed(1))}K` : String(Number(value.toFixed(2)));
};
const windowDays = (window: string) => window.replace("d", " 天");
const interestModeText = (mode: D3ForecastConfig["stakingInterestMode"]) => (mode === "LINEAR" ? "按日线性" : "到期确认");
const includedText = (on: boolean) => (on ? "计入" : "不计入");
/** 这页只看钱够不够。后端的「正常运营」容易读成业务都正常，这里换成只说资金；有的建议自带「建议」二字，不重复写。 */
const adviceText = (water: D3WaterLevel) => (water.tier === "NORMAL" ? "资金够付，这页无需处理" : water.suggestedAction.startsWith("建议") ? water.suggestedAction : `建议：${water.suggestedAction}`);
/** 全页时间一种写法：2026-11-05 14:30（北京时间），时区跟配置走（TX-25、TX-26）。 */
export const timeText = (value: string | undefined) => `${formatBusinessTimeCompact(value, "—")}（${businessZone().label}）`;

const WATER_LABEL: Record<D3WaterLevel["tier"], string> = { NORMAL: "正常", WATCH: "关注", WARNING: "预警", DANGER: "危险" };
const WATER_TONE = { NORMAL: "ok", WATCH: "warn", WARNING: "warn", DANGER: "danger" } as const;
/** 档位带最后一档的显示上限：够付一年以上天数就没有判断价值（coverDaysText 同一口径）。 */
const COVER_CAP_DAYS = 365;

/** 后端给的是 >=30d、15-30d、<7d 这种写法，这里换成运营能读的话。 */
function thresholdText(condition: string) {
  const atLeast = /^>=(\d+)d$/.exec(condition);
  if (atLeast) return `${atLeast[1]} 天及以上`;
  const below = /^<(\d+)d$/.exec(condition);
  if (below) return `不足 ${below[1]} 天`;
  const range = /^(\d+)-(\d+)d$/.exec(condition);
  return range ? `${range[1]}–${range[2]} 天` : condition;
}

/** 同一种写法换成档位带要的上下界；认不出的写法返回 null，页面退回等级表。 */
function thresholdBounds(condition: string): { from: number; to: number } | null {
  const atLeast = /^>=(\d+)d$/.exec(condition);
  if (atLeast) return { from: Number(atLeast[1]), to: COVER_CAP_DAYS };
  const below = /^<(\d+)d$/.exec(condition);
  if (below) return { from: 0, to: Number(below[1]) };
  const range = /^(\d+)-(\d+)d$/.exec(condition);
  return range ? { from: Number(range[1]), to: Number(range[2]) } : null;
}

/** 次日 UTC 00:00 是真实的切换时点，这里补上业务时区里是几点（T08 第 4 条）。 */
export function effectiveText() {
  const minutes = ((businessOffsetMinutes() % 1440) + 1440) % 1440;
  const clock = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return `次日 UTC 00:00（${businessZone().label} ${clock}）起生效`;
}

const TREASURY_SOURCE_LABELS: Record<string, string> = {
  "nx_treasury_reserve_ledger": "储备资金账本",
  "nx_staking_position.amount_usdt": "生效中的质押锁定金额",
  "nx_user_wallet": "用户钱包余额",
  "nx_user_wallet.usdt_available": "用户可提余额",
  "nx_staking_position": "质押锁定金额与奖励",
  "nx_staking_position.estimated_interest_usdt": "待付质押奖励",
  "nx_genesis_holding": "创世节点持仓",
  "nx_genesis_holding × nx_genesis_series.daily_dividend_rate_pct": "创世节点持仓与每日收益",
  "nx_nex_lock_order": "UVT 锁仓订单",
  "nx_nex_lock_order active maturity": "生效中的 UVT 锁仓到期额",
  "nx_withdrawal_order": "提现订单",
  "nx_withdrawal_order active queue": "待处理提现订单",
  "nx_wallet_ledger": "钱包资金流水",
  "nx_wallet_ledger pending commission": "待解锁奖励流水",
  "nx_treasury_legacy_lock_liability": "存量锁定金额及奖励",
  "nx_treasury_legacy_lock_liability active principal + accrued interest": "生效中的存量锁定金额及奖励",
  "nx_vietqr_reconciliation": "VietQR 银行回单",
  "nx_vietqr_reconciliation open suspense rows": "待处置 VietQR 银行回单",
};

function treasurySourceLabel(source: string) {
  const value = source.trim();
  return TREASURY_SOURCE_LABELS[value] ?? (value.startsWith("nx_") ? "系统账目" : value || "系统账目");
}

function RelatedLinks({ links }: { links: readonly CrossLink[] }) {
  return (
    <nav className="rd-links" aria-label="相关页面">
      <span>相关页面</span>
      {links.map((link) => link.reachable
        ? <Link key={link.href} className="rd-link" href={link.href}>{link.label}</Link>
        : <span key={link.href} aria-disabled="true">{link.label} · 无权限</span>)}
    </nav>
  );
}

/** 一句话结论。预警和危险时页面把它放在页签外面，切到哪个页签都看得到；其他情况放在资金概况里。 */
export function FundConclusion({ main, emergencyLink, withdrawalsLink }: { main: D3Main; emergencyLink: CrossLink; withdrawalsLink: CrossLink }) {
  const water = main.reserve.waterLevel;
  const tone = WATER_TONE[water.tier];
  const days = coverDaysText(water.reserveCoverDays);
  const next = water.tier === "DANGER" ? emergencyLink : water.tier === "WARNING" ? withdrawalsLink : null;
  return (
    <Conclusion
      state={tone}
      icon={ShieldCheck}
      lead
      strong={water.tier === "DANGER"}
      hint={<>{adviceText(water)}。{water.tier !== "NORMAL" && <> 通知方式：{water.notification}。平均每天到期 {money(water.dailyAverageDueUsdt)}。</>}</>}
      action={next?.reachable ? <Link className="rd-btn" data-variant={water.tier === "DANGER" ? "danger" : "secondary"} data-size="md" href={next.href}><span className="rd-btn-face">{next.label}</span></Link> : undefined}
    >
      资金安全：{WATER_LABEL[water.tier]}，{main.maturity7.cumulativeUsdt === 0 ? "未来 7 天没有到期" : <>可覆盖 <b>{days.split(" ")[0]}</b> {days.split(" ")[1]}</>}
    </Conclusion>
  );
}

export function OverviewTab({ main, links }: { main: D3Main; links: readonly CrossLink[] }) {
  const { reserve, liabilities, maturity7 } = main;
  const water = reserve.waterLevel;
  const tone = WATER_TONE[water.tier];
  const quiet = water.tier === "NORMAL";
  const sources = Array.from(new Set([...reserve.sources, ...liabilities.sources].map(treasurySourceLabel)));
  const reserveParts = [
    { key: "usdt", name: "USDT 储备", sub: "基础可动用储备", value: reserve.usdtReserveUsdt, slot: 1 as ChartSlot },
    { key: "other", name: "其他高流动资产", sub: "已计入储备", value: reserve.otherLiquidUsdt, slot: "other" as ChartSlot },
  ];
  const liveParts = reserveParts.filter((part) => part.value > 0);
  const share = (value: number) => (reserve.reserveTotalUsdt > 0 ? `${(value / reserve.reserveTotalUsdt * 100).toFixed(1)}%` : "—");
  // 两类都有钱才画环，中间写总额，图例写每类的数；只有一类时一句话加数字（DP-62）。每类是什么、口径都在提示图标里（DP-06）。
  const composition = (
    <Panel title="储备组成" icon={PieChart} tone="role-1" explain="USDT 储备是基础可动用储备，其他高流动资产已计入储备。可用储备已扣除质押锁定金额。">
      <div className="rd-stack">
        {liveParts.length > 1
          ? <Donut label="储备组成" center={amountText(reserve.reserveTotalUsdt)} centerLabel="USDT" segments={reserveParts.map((part) => ({ key: part.key, label: part.name, value: part.value, slot: part.slot, text: money(part.value), share: share(part.value) }))} />
          : (
            <>
              <p className="rd-note">{liveParts.length ? `全部是 ${liveParts[0].name}` : "目前没有可用储备"}</p>
              <KeyValues rows={reserveParts.map((part) => ({ key: part.key, label: part.name, explain: part.sub, value: money(part.value), mono: true }))} />
            </>
          )}
        <KeyValues rows={[
          { key: "locked", label: "已扣除质押锁定金额", explain: "锁定中，不能动用", value: money(-reserve.lockedStakingPrincipalDeductedUsdt || 0), mono: true },
          { key: "injected", label: "累计注入", explain: "累计注入按登记的凭证汇总，不是当前余额。", value: money(reserve.injectedCumulativeUsdt), mono: true },
        ]} />
      </div>
    </Panel>
  );
  // 档位带：四档等宽、边界写在下面、标记落在当前档里；阈值写法认不出时退回等级表。没有到期时天数是占位值，只标当前档，不画标记。
  const bounds = water.thresholds.map((row) => ({ row, bound: thresholdBounds(row.condition) }));
  const tiers = bounds.every((item) => item.bound)
    ? bounds.map(({ row, bound }) => ({ key: row.tier, label: WATER_LABEL[row.tier], tone: WATER_TONE[row.tier], from: bound!.from, to: bound!.to })).sort((a, b) => a.from - b.from)
    : null;
  const noDue = maturity7.cumulativeUsdt === 0;
  const levels = (
    <Panel title="资金安全等级" icon={ShieldCheck} tone={quiet ? "role-other" : tone} explain="按未来 7 天到期的应付款判断，不随页面选的窗口变。">
      <div className="rd-stack">
        {tiers
          ? <TierBand label="资金安全等级" tiers={tiers} current={water.tier} value={noDue ? null : water.reserveCoverDays} valueText={formatReserveCoverDays(maturity7.cumulativeUsdt, water.reserveCoverDays)} boundText={(value) => (value === COVER_CAP_DAYS ? "1 年" : value === 0 ? "0" : `${value} 天`)} />
          : <LevelList label="资金安全等级" rows={water.thresholds.map((row) => ({ key: row.tier, label: WATER_LABEL[row.tier], note: thresholdText(row.condition), tone: WATER_TONE[row.tier], current: row.tier === water.tier }))} />}
        {quiet && <p className="rd-note">这一档的通知方式：{water.notification} · 平均每天到期 {money(water.dailyAverageDueUsdt)}</p>}
      </div>
    </Panel>
  );
  return (
    <>
      <StatBand label="资金概况">
        <Stat tone="role-1" icon={Wallet} label="可用储备" value={amountText(reserve.reserveTotalUsdt)} unit="USDT" explain="USDT 和其他可随时动用的资产，已扣除质押锁定金额。" />
        <Stat tone="role-2" icon={ReceiptText} label="应付款" value={amountText(liabilities.totalUsdt)} unit="USDT" explain="共 9 类，待核实的银行充值算在第 9 类。明细在「应付款与到期」。" />
        <Stat tone={water.tier === "DANGER" ? "danger" : water.tier === "WARNING" ? "warn" : "role-3"} icon={CalendarClock} label="7 天到期应付款" value={amountText(maturity7.cumulativeUsdt)} unit="USDT" explain={`提现 + 质押奖励 + 创世节点收益${maturity7.trialStressIncluded ? " + 试用业务（压力测试）" : ""}。固定看未来 7 天。`} />
      </StatBand>
      {/* 面板位置固定，危险态只换颜色和内容，眼睛靠位置找东西（06 审查 6）。 */}
      <div className="rd-split">
        {composition}{levels}
      </div>
      <Fold title="数据来源" summary={`${sources.length} 项，都来自系统账目`}>
        <p className="rd-note">{sources.join(" / ") || "资金储备记录"}。</p>
      </Fold>
      <RelatedLinks links={links} />
    </>
  );
}

function MaturityPanel({ maturity, loading, error, onRetry }: { maturity: D3MaturityForecast | null; loading: boolean; error: string; onRetry: () => void }) {
  if (!maturity) {
    return (
      <Panel title="哪天要付的钱最多" icon={CalendarClock} tone="role-3" data-testid="b2-maturity-chart">
        {loading ? <BlockState state="loading" title="正在读取到期预测…" /> : <BlockState state="error" title="到期预测读取失败，不显示旧数据" detail={error} onRetry={onRetry} />}
      </Panel>
    );
  }
  const days = maturity.daily.length;
  const noDue = maturity.cumulativeUsdt === 0;
  const trial = maturity.trialStressIncluded;
  const parts = (row: D3MaturityForecast["daily"][number]) => `提现 ${amountText(row.withdrawDueUsdt)} · 质押奖励 ${amountText(row.interestDueUsdt)} · 创世节点 ${amountText(row.genesisDividendUsdt)}${trial ? ` · 试用业务 ${amountText(row.trialShadowStressUsdt)}` : ""}`;
  return (
    <Panel title="哪天要付的钱最多" sub={`未来 ${days} 天 · USDT`} icon={CalendarClock} tone="role-3" data-testid="b2-maturity-chart"
      explain={maturity.farLiabilityExcluded ? "UVT 锁仓要 24 个月后才到期，不在这张图里，也不算眼下必须付的钱。" : operatorCopyText(maturity.farLiabilityNote)}>
      <div className="rd-stack">
        {noDue ? <BlockState state="empty" title={`未来 ${days} 天没有到期`} /> : (
          <div className="rd-split" data-even="" role="group" aria-label="每日预计兑付额柱状图与累计到期负债曲线">
            <div className="rd-stack">
              <p className="rd-note">每天到期</p>
              <ColumnChart label={`未来 ${days} 天每天到期`} format={money} axisFormat={compact} series={[{ label: "到期", slot: 3 }]}
                data={maturity.daily.map((row) => ({ key: row.date, tick: row.date.slice(5), values: [row.totalDueUsdt], detail: <span>{parts(row)}</span> }))} />
            </div>
            <div className="rd-stack">
              <p className="rd-note">累计到期</p>
              <TrendLine label={`未来 ${days} 天累计到期`} format={money} axisFormat={compact} slot={3}
                data={maturity.cumulative.map((row) => ({ key: row.date, tick: row.date.slice(5), value: row.amountUsdt }))} />
            </div>
          </div>
        )}
        <Fold title="每日明细" summary={noDue ? `${days} 天，全部为 0` : `${days} 天，每天的构成和累计`} inset>
          <Table label="每日到期明细">
            <thead><tr>
              <Th>日期</Th><Th align="right">提现</Th><Th align="right">质押奖励</Th><Th align="right">创世节点收益</Th>
              {trial && <Th align="right">试用业务压力测试</Th>}
              <Th align="right">当日合计</Th><Th align="right">累计</Th>
            </tr></thead>
            <tbody>
              {maturity.daily.map((row, index) => (
                <Tr key={row.date}>
                  <Td><Cell num main={row.date} /></Td>
                  <Td align="right"><Cell num main={amountText(row.withdrawDueUsdt)} /></Td>
                  <Td align="right"><Cell num main={amountText(row.interestDueUsdt)} /></Td>
                  <Td align="right"><Cell num main={amountText(row.genesisDividendUsdt)} /></Td>
                  {trial && <Td align="right"><Cell num main={amountText(row.trialShadowStressUsdt)} /></Td>}
                  <Td align="right"><Cell num main={amountText(row.totalDueUsdt)} /></Td>
                  <Td align="right"><Cell num main={amountText(maturity.cumulative[index].amountUsdt)} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Fold>
      </div>
    </Panel>
  );
}

/**
 * 应付款构成：环在左、九类表在右，表格第一列的色点就是图例，金额和占比只在表里写一遍（DP-61）。
 * 这个页签里紫已经是「到期」，环只画前两类加其他（金、青、灰），一屏一色一义（06 审查 7）。两类以下不画环，写一句话（DP-62）。
 */
function liabilityRing(rows: D3Main["liabilities"]["breakdown"], total: number) {
  const ranked = rows.filter((row) => row.amountUsdt > 0).sort((a, b) => b.amountUsdt - a.amountUsdt);
  const slots = new Map<string, ChartSlot>(ranked.map((row, index) => [row.category, index < 2 ? ((index + 1) as ChartSlot) : "other"]));
  if (ranked.length < 2) {
    const note = ranked.length ? <p className="rd-note">全部是 {categoryText(ranked[0].category)}。</p> : <BlockState state="empty" title="目前没有应付款。" />;
    return { ring: null, slots: new Map<string, ChartSlot>(), note };
  }
  const rest = ranked.slice(2);
  const restSum = rest.reduce((sum, row) => sum + row.amountUsdt, 0);
  const parts = [
    ...ranked.slice(0, 2).map((row, index) => ({ key: row.category, label: categoryText(row.category), value: row.amountUsdt, slot: (index + 1) as ChartSlot })),
    ...(restSum > 0 ? [{ key: "rest", label: `其他 ${rest.length} 类`, value: restSum, slot: "other" as ChartSlot }] : []),
  ];
  const ring = <Donut legend={false} label="应付款构成" center={amountText(total)} centerLabel="USDT" segments={parts.map((part) => ({ ...part, text: money(part.value), share: `${(part.value / total * 100).toFixed(1)}%` }))} />;
  return { ring, slots, note: null };
}

export function DueTab({ main, mainState, windowValue, onWindow, maturity, exposure, onExposureRetry, onMaturityRetry, canReadExposure, canExport, exportBlocked, onExport, selected, onSelect }: {
  main: D3Main | null;
  mainState: ReactNode;
  windowValue: "7d" | "30d";
  onWindow: (value: "7d" | "30d") => void;
  maturity: Loadable<D3MaturityForecast>;
  exposure: Loadable<D3NetExposure>;
  onExposureRetry: () => void;
  onMaturityRetry: () => void;
  canReadExposure: boolean;
  canExport: boolean;
  exportBlocked?: string;
  onExport: () => void;
  selected: string | null;
  onSelect: (category: string | null) => void;
}) {
  const breakdown = main?.liabilities.breakdown ?? [];
  // 为 0 的类折成一行，点开再看；抽屉的上一条下一条仍按九类走。
  const [showZero, setShowZero] = useState(false);
  const zeroRows = breakdown.filter((row) => row.amountUsdt === 0);
  const listed = showZero ? breakdown : breakdown.filter((row) => row.amountUsdt > 0);
  const current = breakdown.find((row) => row.category === selected) ?? null;
  const currentIndex = current ? breakdown.indexOf(current) : -1;
  const water = main?.reserve.waterLevel;
  const shown = maturity.data;
  const noDue = shown?.cumulativeUsdt === 0;
  const peak = shown?.daily.reduce((best, row) => (row.totalDueUsdt > best.totalDueUsdt ? row : best), shown.daily[0]);
  const coverage = main && main.liabilities.totalUsdt > 0 ? (main.reserve.reserveTotalUsdt / main.liabilities.totalUsdt) * 100 : null;
  const latest = exposure.data?.series.at(-1);
  const composition = liabilityRing(breakdown, main?.liabilities.totalUsdt ?? 0);
  const liabilityTable = (
    <Table label="九类应付款">
      <thead><tr><Th>类型</Th><Th align="right">金额（USDT）</Th><Th align="right">占比</Th><Th>数据来源</Th></tr></thead>
      <tbody>
        {listed.map((row) => {
          const slot = composition.slots.get(row.category);
          return (
            <Tr key={row.category} selected={row.category === selected} onOpen={() => onSelect(row.category)}>
              <Td><Cell main={<>{slot && <span className="rd-chart-swatch" data-slot={slot} aria-hidden />}{categoryText(row.category)}<Explain label={`${categoryText(row.category)}是什么`} content={LIABILITY_EXPLANATIONS[row.category]} /></>} /></Td>
              <Td align="right"><Cell num main={amountText(row.amountUsdt)} /></Td>
              <Td align="right"><Cell num main={`${(row.share * 100).toFixed(1)}%`} /></Td>
              <Td><Cell main={treasurySourceLabel(row.source)} /></Td>
            </Tr>
          );
        })}
        {zeroRows.length > 0 && !showZero && (
          <Tr>
            <Td colSpan={4}><button type="button" className="rd-link" onClick={() => setShowZero(true)}>另有 {zeroRows.length} 类现在是 0，展开看</button></Td>
          </Tr>
        )}
      </tbody>
    </Table>
  );
  return (
    <>
      {mainState}
      {main && water && (
        <>
          <div className="rd-toolbar">
            <Segments label="到期预测窗口" value={windowValue} onChange={onWindow} items={[{ value: "7d", label: "7 天" }, { value: "30d", label: "30 天" }]} />
            <Explain label="到期预测窗口的说明" content="窗口只影响这一页签的到期数字。资金安全等级固定按未来 7 天算。" />
          </div>
          <StatBand label="到期和覆盖">
            <Stat tone="role-3" icon={AlarmClock} label={`未来 ${windowDays(windowValue)}累计到期`} value={shown ? amountText(shown.cumulativeUsdt) : "—"} unit="USDT" explain={`提现 + 质押奖励 + 创世节点收益${shown?.trialStressIncluded ? " + 试用业务（压力测试）" : ""}。提现按冷却到期日排，窗口之外的不算在这里，所以可能比待处理提现少。`} />
            {/* 能付多久是状态，和资金概况那句话同一个颜色；覆盖率是和红线比的数，角色四（VS-12）。 */}
            <Stat tone={WATER_TONE[water.tier]} icon={Gauge} label="能付多久" value={formatReserveCoverDays(main.maturity7.cumulativeUsdt, water.reserveCoverDays)} explain={`按未来 7 天每天平均到期额算，储备够付多少天。精确值 ${Number(water.reserveCoverDays).toLocaleString("en-US")} 天。`} />
            <Stat tone="role-4" icon={Landmark} label="兑付覆盖率" value={coverage === null ? "无应付款" : `${coverage.toFixed(1)}%`} explain="可用储备 ÷ 应付款总额，看全部应付款够不够付。可覆盖天数看按最近到期速度能撑多久，两个都要看，哪个差就先处理哪个。" />
          </StatBand>
          {shown && <p className="rd-note">{noDue ? "这段时间没有到期款项，无需安排资金。" : `峰值日 ${peak?.date} 到期 ${money(peak?.totalDueUsdt ?? 0)}；${adviceText(water)}。`}</p>}
          <MaturityPanel maturity={shown} loading={maturity.loading} error={maturity.error} onRetry={onMaturityRetry} />
          <Panel
            flush
            title="应付款 · 9 类"
            sub={`${breakdown.filter((row) => row.amountUsdt > 0).length} 类有金额`}
            explain={`九类里统计了 ${main.liabilities.hardLiabilityCategoryCount} 类。试用业务只做压力测试，${main.liabilities.trialShadowIncluded ? "这里已显示" : "不算必须付的钱"}。`}
            icon={ReceiptText}
            tone="role-2"
            actions={canExport ? <Button size="sm" disabledReason={exportBlocked} onClick={onExport}>导出应付款 CSV</Button> : undefined}
          >
            <div className="rd-panel-inset" data-testid="b2-liability-distribution">
              {composition.ring
                ? <Figure graphic={composition.ring} width={200} stack="wide">{liabilityTable}</Figure>
                : <div className="rd-stack">{composition.note}{liabilityTable}</div>}
            </div>
          </Panel>
        </>
      )}
      {canReadExposure && (
        <Panel title="储备和应付款的差额" icon={Scale} tone="role-1" explain="按当前预测设置计入的储备和应付款算。过去每天的应付款没有记录，算不出真实的历史差额，所以这里不画走势。">
          {latest ? (
            <div className="rd-stack">
              <KeyValues rows={[{
                key: "net",
                label: "当前差额",
                explain: "储备 − 应付款",
                mono: true,
                value: <>{money(latest.netExposureUsdt)} {latest.netExposureUsdt > 0 ? <StatusTag tone="ok">有富余</StatusTag> : latest.netExposureUsdt === 0 ? <StatusTag tone="warn">刚好够</StatusTag> : <StatusTag tone="danger">不够付</StatusTag>}</>,
              }]} />
            </div>
          ) : exposure.loading ? <BlockState state="loading" title="正在读取差额…" />
            : <BlockState state="error" title="差额读取失败，不显示旧数据" detail={exposure.error} onRetry={onExposureRetry} />}
        </Panel>
      )}
      <Drawer
        open={Boolean(current)}
        onClose={() => onSelect(null)}
        title={current ? categoryText(current.category) : ""}
        sub={current ? operatorCopyText(current.label) : undefined}
        icon={ReceiptText}
        tone="role-2"
        nav={{ onPrev: () => onSelect(breakdown[currentIndex - 1].category), onNext: () => onSelect(breakdown[currentIndex + 1].category), hasPrev: currentIndex > 0, hasNext: currentIndex >= 0 && currentIndex < breakdown.length - 1 }}
      >
        {current && main && (
          <>
            <JudgmentPoints title="这类应付款" rows={[
              { label: "这是什么", value: LIABILITY_EXPLANATIONS[current.category] },
              { label: "金额", value: money(current.amountUsdt) },
              { label: "占比", value: `${(current.share * 100).toFixed(1)}%` },
              { label: "计入预测", value: main.config.liabilityCategories[current.category] ? "计入" : "不计入", reason: "按当前生效的预测设置" },
              { label: "数据来源", value: treasurySourceLabel(current.source), reason: <Explain label="技术信息" content={`类型编号 ${current.category}`} /> },
            ]} />
          </>
        )}
      </Drawer>
    </>
  );
}

export function FlowTab({ history }: { history: { data: { flowWindows: Array<{ label: string; inflowWan: number; outflowWan: number }>; monthlyNewDeposits: Array<{ label: string; amountWan: number }> } | null; loading: boolean; error: string | null; reload: () => void } }) {
  const wan = (value: number) => `${Number(value.toFixed(2))} 万 USDT`;
  const flows = history.data?.flowWindows ?? [];
  const months = history.data?.monthlyNewDeposits ?? [];
  const pending = !history.data && !history.error;
  const fixed = (value: number) => value.toFixed(2);
  const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
  // 图下面给同一份数的表，数值不只靠图和悬停（VS-47）。
  const moved = flows.some((row) => row.inflowWan > 0 || row.outflowWan > 0) || months.some((row) => row.amountWan > 0);
  const detail = history.data && moved && (
    <Panel flush title="明细" sub="万 USDT" explain="图里的数，单位万 USDT。" icon={ReceiptText} tone="role-2">
      <div className="rd-split" data-even="">
        <Table label="近 8 天资金流入和流出明细">
          <thead><tr><Th>日期</Th><Th align="right">流入</Th><Th align="right">流出</Th><Th align="right">净流入</Th></tr></thead>
          <tbody>
            {flows.map((row) => (
              <Tr key={row.label}>
                <Td><Cell num main={row.label} /></Td>
                <Td align="right"><Cell num main={fixed(row.inflowWan)} /></Td>
                <Td align="right"><Cell num main={fixed(row.outflowWan)} /></Td>
                <Td align="right"><Cell num main={signed(row.inflowWan - row.outflowWan)} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <Table label="近 8 个月新增入金明细">
          <thead><tr><Th>月份</Th><Th align="right">新增入金</Th></tr></thead>
          <tbody>
            {months.map((row) => (
              <Tr key={row.label}>
                <Td><Cell num main={row.label} /></Td>
                <Td align="right"><Cell num main={fixed(row.amountWan)} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Panel>
  );
  return (
    <>
    <div className="rd-split" data-even="">
      <Panel title="这几天钱是进多还是出多" sub={`近 ${flows.length || 8} 天 · 万 USDT`} explain="这里只算储备账的收支：流入是充值和财务注入，流出是提现出款和拒付退回。" icon={ArrowDownUp} tone="role-2" data-testid="b2-fund-flow-history">
        {pending ? <BlockState state="loading" title="正在读取资金流…" />
          : !history.data ? <BlockState state="error" title="资金流历史暂不可用" detail={history.error} onRetry={history.reload} />
          : flows.every((row) => row.inflowWan === 0 && row.outflowWan === 0) ? <BlockState state="empty" title={`近 ${flows.length} 天没有资金进出`} />
          : <ColumnChart label={`近 ${flows.length} 天资金流入和流出`} format={wan} axisFormat={(value) => String(Number(value.toFixed(1)))}
              series={[{ label: "流入", slot: 2 }, { label: "流出", slot: 4 }]}
              data={flows.map((row) => ({ key: row.label, tick: row.label, values: [row.inflowWan, row.outflowWan] }))} />}
      </Panel>
      <Panel title="每个月新增入金有多少" sub={`近 ${months.length || 8} 个月 · 万 USDT`} explain="只算用户成功充值，财务注入的储备不算。" icon={Coins} tone="role-2" data-testid="b2-monthly-inflow-history">
        {pending ? <BlockState state="loading" title="正在读取新增入金…" />
          : !history.data ? <BlockState state="error" title="月新增入金暂不可用" detail={history.error} onRetry={history.reload} />
          : months.every((row) => row.amountWan === 0) ? <BlockState state="empty" title={`近 ${months.length} 个月没有新增入金`} detail="这里只算用户成功充值，财务注入的储备不算。" />
          : <ColumnChart label={`近 ${months.length} 个月新增入金`} format={wan} axisFormat={(value) => String(Number(value.toFixed(1)))}
              series={[{ label: "新增入金", slot: 2 }]}
              data={months.map((row) => ({ key: row.label, tick: row.label.slice(5), values: [row.amountWan] }))} />}
      </Panel>
    </div>
    {detail}
    </>
  );
}

function enabledCount(record: Record<string, boolean>) {
  return `${Object.values(record).filter(Boolean).length}/${Object.keys(record).length}`;
}

export function SettingsTab({ main, draft, mainState, canConfig, dirty, lockedNote, busyReason, saving, note, impact, onChange, onDiscard, onSave }: {
  main: D3Main | null;
  draft: ForecastValues | null;
  mainState: ReactNode;
  canConfig: boolean;
  dirty: boolean;
  /** 结果未知核对完之前只读，设置和理由都不能再改（OP-93）。 */
  lockedNote?: string;
  busyReason?: string;
  /** 正在读保存前的影响。 */
  saving: boolean;
  /** 影响读取失败或被别人改了，写在按钮旁，再点保存重试。 */
  note: { tone: "warn" | "danger"; text: string } | null;
  /** 改后无法估值时不开确认框，影响放在按钮旁，可以直接改草稿。 */
  impact: ReactNode;
  onChange: (next: ForecastValues) => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  if (!main || !draft) return <>{mainState}</>;
  const { config } = main;
  const pending = config.pendingConfig;
  const windowOptions = [
    { value: "7d", label: "7 天" },
    { value: "30d", label: "30 天" },
    ...(draft.forecastWindow === "90d" ? [{ value: "90d", label: "90 天（旧配置，请选择 7 或 30 天）", disabled: true }] : []),
  ];
  return (
    <>
      {pending && (
        <Notice tone="progress" title={`待生效 v${config.pendingVersion}`}>
          窗口 {windowDays(pending.forecastWindow)}，储备科目 {enabledCount(pending.reserveCategories)}，负债科目 {enabledCount(pending.liabilityCategories)}，创世节点 {pending.genesisIncluded ? "纳入" : "不纳入"}，生效时间 {timeText(config.pendingEffectiveAt)}。
        </Notice>
      )}
      {!canConfig && <Notice tone="done">你只能查看；调整预测设置需财务主管。</Notice>}
      {canConfig && lockedNote && <Notice tone="warn">{lockedNote}</Notice>}
      <p className="rd-note">当前版本 v{config.version}（已生效 v{config.effectiveVersion}）· 储备 {enabledCount(draft.reserveCategories)} 开启 · 负债科目 {enabledCount(draft.liabilityCategories)} 开启<Explain label="预测设置什么时候生效" content={`${effectiveText()}，不影响历史。`} /></p>
      {canConfig && !lockedNote ? (
        <>
          <Panel title="预测窗口和算法" icon={CalendarClock} tone="role-3">
            <div className="rd-form-grid">
              <Field label="默认预测天数" explain="打开这页时先看几天的到期和差额。资金安全等级固定按 7 天算，不受这项影响。" error={draft.forecastWindow === "90d" ? FORECAST_90D_BLOCK : undefined}>
                <Select aria-label="默认预测天数" value={draft.forecastWindow} options={windowOptions} onChange={(value) => onChange({ ...draft, forecastWindow: value as ForecastValues["forecastWindow"] })} />
              </Field>
              <Field label="质押奖励预测" explain="按日线性：奖励按质押天数每天算一份，到期图比较平。到期确认：奖励全算在到期那天，那天会冒高。">
                <Select aria-label="质押奖励预测" value={draft.stakingInterestMode} options={[{ value: "LINEAR", label: "按日线性" }, { value: "AT_MATURITY", label: "到期确认" }]} onChange={(value) => onChange({ ...draft, stakingInterestMode: value as ForecastValues["stakingInterestMode"] })} />
              </Field>
            </div>
          </Panel>
          <Panel title="计入哪些金额" icon={ReceiptText} tone="role-2" explain="用户看不到这些设置。它们影响这页的到期、差额和资金安全等级，也影响今日概览的可覆盖天数。">
            <div className="rd-stack">
              <CheckGroup legend="其他口径">
                <Check label="计入创世节点收益" explain="到期金额里算创世节点每日收益。" checked={draft.genesisIncluded} onChange={(event) => onChange({ ...draft, genesisIncluded: event.target.checked })} />
                <Check label="计入远期应付款" explain="差额里算 UVT 锁仓到期应付。" checked={draft.includeFarLiabilities} onChange={(event) => onChange({ ...draft, includeFarLiabilities: event.target.checked })} />
                <Check label="试用业务压力测试" explain="每天多算一笔试用业务压力值。" checked={draft.trialStressEnabled} onChange={(event) => onChange({ ...draft, trialStressEnabled: event.target.checked })} />
              </CheckGroup>
              <CheckGroup legend="计入哪些储备" summary={`${enabledCount(draft.reserveCategories)} 开启`} explain="不计入 USDT 储备时，资金安全等级按储备 0 算。">
                {Object.entries(draft.reserveCategories).map(([key, enabled]) => <Check key={key} label={categoryText(key)} checked={enabled} onChange={(event) => onChange({ ...draft, reserveCategories: { ...draft.reserveCategories, [key]: event.target.checked } })} />)}
              </CheckGroup>
              <CheckGroup legend="计入哪些应付款" summary={`${enabledCount(draft.liabilityCategories)} 开启`} explain="不勾的类不进到期预测和差额，页面上的九类金额不变。">
                {Object.entries(draft.liabilityCategories).map(([key, enabled]) => <Check key={key} label={categoryText(key)} checked={enabled} onChange={(event) => onChange({ ...draft, liabilityCategories: { ...draft.liabilityCategories, [key]: event.target.checked } })} />)}
              </CheckGroup>
            </div>
          </Panel>
          {impact}
          {note && <Notice tone={note.tone}>{note.text}</Notice>}
          <div className="rd-toolbar" data-end="">
            {dirty && <span className="rd-toolbar-note">有未保存的修改</span>}
            <Explain label="保存预测设置的说明" content="有未保存的修改时，切页签和切窗口不会丢。改错了可以把选项改回去再保存，生效前再保存会覆盖待生效版本。" />
            {dirty && <Button variant="ghost" onClick={onDiscard}>放弃修改</Button>}
            <Button variant="primary" loading={saving} loadingText="正在加载配置影响预览…" disabledReason={busyReason} onClick={onSave}>保存预测设置</Button>
          </div>
        </>
      ) : (
        <Panel title="当前预测设置" icon={CalendarClock} tone="role-3">
          <KeyValues rows={[
            { key: "window", label: "默认预测天数", value: windowDays(config.forecastWindow) },
            { key: "mode", label: "质押奖励预测", value: interestModeText(config.stakingInterestMode) },
            { key: "genesis", label: "创世节点收益", value: includedText(config.genesisIncluded) },
            { key: "far", label: "远期应付款", value: includedText(config.includeFarLiabilities) },
            { key: "trial", label: "试用业务压力测试", value: config.trialStressEnabled ? "开启（不算必须付的钱）" : "关闭" },
            { key: "reserve", label: "计入的储备", value: Object.entries(config.reserveCategories).filter(([, on]) => on).map(([key]) => categoryText(key)).join("、") || "无" },
            { key: "liability", label: "计入的应付款", value: Object.entries(config.liabilityCategories).filter(([, on]) => on).map(([key]) => categoryText(key)).join("、") || "无" },
            { key: "rule", label: "生效方式", value: config.effectiveRule === "NEXT_UTC_DAY_00:00" ? effectiveText() : operatorCopyText(config.effectiveRule) },
          ]} />
        </Panel>
      )}
    </>
  );
}

export function forecastDiffRows(before: ForecastValues, after: ForecastValues) {
  return [
    { key: "window", label: "默认预测天数", before: windowDays(before.forecastWindow), after: windowDays(after.forecastWindow) },
    { key: "mode", label: "质押奖励预测", before: interestModeText(before.stakingInterestMode), after: interestModeText(after.stakingInterestMode) },
    { key: "genesis", label: "计入创世节点收益", before: includedText(before.genesisIncluded), after: includedText(after.genesisIncluded) },
    { key: "far", label: "计入远期应付款", before: includedText(before.includeFarLiabilities), after: includedText(after.includeFarLiabilities) },
    { key: "trial", label: "试用业务压力测试", before: before.trialStressEnabled ? "开启" : "关闭", after: after.trialStressEnabled ? "开启" : "关闭" },
    ...Object.keys(after.reserveCategories).map((key) => ({ key: `reserve-${key}`, label: `储备 · ${categoryText(key)}`, before: includedText(before.reserveCategories[key]), after: includedText(after.reserveCategories[key]) })),
    ...Object.keys(after.liabilityCategories).map((key) => ({ key: `liability-${key}`, label: `应付款 · ${categoryText(key)}`, before: includedText(before.liabilityCategories[key]), after: includedText(after.liabilityCategories[key]) })),
  ];
}
