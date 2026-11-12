"use client";
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";


import { ADMIN_ERROR_MESSAGES, displayAdminReadError } from "@/lib/admin/error-messages";
/**
 * G1 质押产品配置（改版）— 退役产品的原档位与历史仓位只读查询，数据来自后端业务表。
 * 唯一的业务请求是 GET /api/admin/market/staking（挂载读一次、「刷新」「重新读取」重读），本页没有写操作。
 * 版面：结论（还有没有没结清的历史仓位）→ 四个数 → 四档历史产品卡 → 历史仓位（三段状态带选一种状态 + 一张表，点行看仓位详情）。没有任何要处理的事时收短：不出四个 0，空块一行写完。
 */
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { AlarmClock, Ban, CalendarClock, CheckCheck, CircleCheck, CircleDashed, CircleSlash, Clock3, Coins, Hourglass, Layers, LogOut, PauseCircle, RefreshCw, Undo2, Wallet, type LucideIcon } from "lucide-react";
import {
  BlockState, Button, Cell, Conclusion, Decision, Drawer, Explain, Fact, Facts, FilterBar, FilterField, Input, JudgmentPoints, Notice,
  PageHeader, Panel, RatioBar, RdPage, Stat, StatBand, StatusTag, Table, TableMessage, Td, Th, Tr, type StateTone,
} from "@/app/components/rd";
import { nextTabValue } from "@/app/components/kit/tab-group-keyboard";
import { businessClock, parseBusinessTime } from "@/lib/admin/business-time";
import { useReach } from "@/lib/nav/use-reach";
import { PaginationExemption } from "../design-kit";
import {
  fetchG1StakingOverview,
  type G1Overview,
  type G1Pool,
  type G1PositionGroup,
  type G1PositionRow,
} from "@/lib/admin/g1-client";

const CANONICAL_USDT_TIERS = ["usdt30d", "usdt90d", "usdt180d", "usdt365d"] as const;
const CANONICAL_USDT_TIER_SET = new Set<string>(CANONICAL_USDT_TIERS);

/** 金额按接口原值写，不舍入、不用 $：千分位，小数去掉补的 0、最少 2 位。 */
function usdtText(value: number) {
  const [int, frac = ""] = String(Math.abs(value)).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${value < 0 ? "-" : ""}${grouped}.${frac.padEnd(2, "0")}`;
}

/** 后端明细金额是「$1234.5」这种文本：去掉 $，补千分位和两位小数；认不出的原样显示。 */
function rowAmount(value: string) {
  const match = /^\$?(-?)([\d,]+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return operatorCopyText(value);
  const int = match[2].replace(/,/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${match[1]}${int}.${(match[3] ?? "").padEnd(2, "0")}`;
}

function fmtCount(value: number) {
  return value.toLocaleString("en-US");
}

function displayTerm(pool: G1Pool) {
  const match = /^(\d+)d$/i.exec(pool.term);
  return match ? `${match[1]} 天` : pool.term;
}

/** 接口时间是存储时钟的文本，只把「T」换成空格，不换时区。 */
function timeText(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/.exec(value);
  return match ? `${match[1]} ${match[2]}` : value;
}

/** 表格里只写日期，完整时间在悬停和仓位详情里。 */
function dateText(value: string) {
  return /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? value;
}

/** 备注是后端英文模板，operatorCopyText 译成中文；再把 $ 金额写成 USDT，「累计奖励」其实是整期估计，改成真实口径。 */
function noteText(value: string) {
  return operatorCopyText(value)
    .replace(/^D(\d+)\s*\/\s*(\d+)/, "已锁 $1 / $2 天")
    .replace(/累计奖励\s*/, "整期奖励估计 ")
    .replace(/\$(-?[\d,]+(?:\.\d+)?)/g, (_, amount: string) => `${rowAmount(amount)} USDT`);
}

/** 最低额是「1000 USDT」这种文本：数字按金额写法补千分位和两位小数，认不出的原样显示。 */
function minText(value: string) {
  const match = /^(-?[\d,]+(?:\.\d+)?)\s+(\S+)$/.exec(value.trim());
  return match ? `${rowAmount(match[1])} ${match[2]}` : value;
}

const errorText = (error: unknown) => displayAdminReadError(error);
const DENIED = new Set<string>([ADMIN_ERROR_MESSAGES.ADMIN_PERMISSION_DENIED, ADMIN_ERROR_MESSAGES.ACCESS_DENIED]);

type StateKey = "pending_lock" | "active" | "mature_unclaimed" | "claimed" | "early_withdrawn" | "slashed" | "refunded";

/** 七种仓位状态：名字、色调、图标和它是什么意思（按后端现行行为写，见重构说明「后端事实」）。 */
const POSITION_STATES: Record<StateKey, { label: string; tone: StateTone; icon: LucideIcon; meaning: string }> = {
  pending_lock: { label: "待确认", tone: "neutral", icon: Clock3, meaning: "历史记录里还在等锁仓确认的仓位，本金已计入锁定金额。" },
  active: { label: "计算奖励中", tone: "progress", icon: CircleDashed, meaning: "锁仓中，按下单时的奖励率算奖励。过了到期时间的也可能还在这里：状态要等用户在 App 里读到仓位才转为到期未领。" },
  mature_unclaimed: { label: "到期未领", tone: "warn", icon: Hourglass, meaning: "已到期，锁定金额和奖励等用户自己领取；系统不会自动发放，后台也不能代领。" },
  claimed: { label: "已领取", tone: "done", icon: CheckCheck, meaning: "用户已领取锁定金额和奖励。" },
  early_withdrawn: { label: "提前解锁", tone: "done", icon: LogOut, meaning: "到期前退出：按下单时的比例扣锁定金额，质押奖励不发放。" },
  slashed: { label: "已罚没", tone: "done", icon: Ban, meaning: "历史上被单档紧急暂停处理掉的仓位；现在已不能再罚没。" },
  refunded: { label: "已退款", tone: "done", icon: Undo2, meaning: "历史记录里状态为「已退款」的仓位。这页只读到状态，看不到钱有没有退回。" },
};
const positionStateLabel = (state: string): string => POSITION_STATES[state as StateKey]?.label ?? "状态未知";
const rowState = (status: string) => POSITION_STATES[status.toLowerCase() as StateKey];
/** 「计算奖励中」但已过到期时间的仓位：后端只在用户读仓位时转为到期未领，这页按读取时间和到期时间比出来，不改状态。 */
const OVERDUE = { label: "已过到期时间", tone: "warn" as StateTone, icon: AlarmClock, meaning: "过了到期时间，但状态还是计算奖励中。状态要等用户在 App 里读到仓位才转为到期未领，后台读这页不会改状态。和到期未领一样等用户自己领取，系统不会自动发放。" };

const STAGES: readonly { key: string; title: string; explain: string; states: readonly StateKey[] }[] = [
  { key: "locked", title: "还在锁定", explain: "待确认和计算奖励中的仓位，本金还没回到用户手里。状态要等用户在 App 里读到仓位才转为到期未领，所以过了到期时间的也会留在这里，单独标出。", states: ["pending_lock", "active"] },
  { key: "due", title: "到期待领取", explain: "到期后由用户自己领取，系统不会自动发放；没领之前一直停在这里。", states: ["mature_unclaimed"] },
  { key: "ended", title: "已结束", explain: "领取、提前解锁、罚没或退款后就结束了。提前解锁只算本月（按业务日历的月份），其余不限时间。", states: ["claimed", "early_withdrawn", "slashed", "refunded"] },
];
const STATE_ORDER: readonly StateKey[] = STAGES.flatMap((stage) => stage.states);

export function G1Staking() {
  const [overview, setOverview] = useState<G1Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readAt, setReadAt] = useState<number | null>(null);
  const [state, setState] = useState<StateKey | null>(null);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState<G1PositionRow | null>(null);
  const reach = useReach();

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      setOverview(await fetchG1StakingOverview());
      setReadAt(Date.now());
    } catch (err) {
      setOverview(null);
      setError(errorText(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const next = await fetchG1StakingOverview();
        if (!cancelled) {
          setOverview(next);
          setReadAt(Date.now());
        }
      } catch (err) {
        if (!cancelled) {
          setOverview(null);
          setError(errorText(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const groupByStatus = useMemo(() => {
    return new Map((overview?.positions ?? []).map((group) => [group.status, group]));
  }, [overview?.positions]);
  const canonicalPools = useMemo(() => {
    const byTier = new Map((overview?.pools ?? [])
      .filter((pool) => pool.product.toUpperCase() === "USDT")
      .filter((pool) => CANONICAL_USDT_TIER_SET.has(pool.tierKey))
      .map((pool) => [pool.tierKey, pool]));
    return CANONICAL_USDT_TIERS.flatMap((tierKey) => {
      const pool = byTier.get(tierKey);
      return pool ? [pool] : [];
    });
  }, [overview?.pools]);

  const header = (
    <PageHeader
      pageId="G1"
      title="质押产品配置"
      summary="查四档原配置和用户的历史仓位，只能查看。"
      meta={overview ? (
        <span className="rd-toolbar">
          <span>{readAt ? `${businessClock(readAt)} 读取，` : ""}不自动刷新</span>
          <Button variant="ghost" size="sm" loading={loading} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void reload()}>刷新</Button>
        </span>
      ) : undefined}
    />
  );

  if (loading && !overview) {
    return (
      <RdPage>
        {header}
        <Conclusion state="unknown">质押数据：正在读取</Conclusion>
        <BlockState state="loading" title="质押数据加载中…" />
      </RdPage>
    );
  }

  if (!overview) {
    const denied = DENIED.has(error);
    return (
      <RdPage>
        {header}
        {denied
          ? <BlockState state="denied" title="无权限访问" detail="这个账号没有质押数据的读取权限，需要时联系超级管理员。" />
          : (
            <>
              <Conclusion state="unknown">质押数据没读到，这页现在没有判断</Conclusion>
              <BlockState state="error" title="质押数据加载失败" detail={error || "没有收到数据，请重试；一直失败请联系值班同事。"} onRetry={() => void reload()} retryLabel="重新加载" />
            </>
          )}
      </RdPage>
    );
  }

  const { stats, gate } = overview;
  const pools = canonicalPools;
  // 前四种缺分组时回退到统计数（统计里有同一个数）；后三种没有统计数可回退，缺分组写「—」，不写 0。
  const fallback: Partial<Record<StateKey, number>> = { pending_lock: stats.pendingCount, active: stats.activeCount, mature_unclaimed: stats.matureCount, early_withdrawn: stats.earlyWithdrawnMonth };
  const countOf = (key: StateKey): number | null => groupByStatus.get(key)?.count ?? fallback[key] ?? null;
  const pending = countOf("pending_lock") ?? 0;
  const active = countOf("active") ?? 0;
  const mature = countOf("mature_unclaimed") ?? 0;
  const open = pending + active + mature;
  // 已过到期时间：按这次读取的时间和每笔的到期时间比（后端按 unlock_at <= now 转为到期未领）。只在读到的行里数，没读全时是下限。
  const pastDue = (row: G1PositionRow) => readAt !== null && parseBusinessTime(row.unlockAt) <= readAt;
  const isOverdue = (row: G1PositionRow) => row.status.toLowerCase() === "active" && pastDue(row);
  const pendingRows = groupByStatus.get("pending_lock")?.rows ?? [];
  const activeRows = groupByStatus.get("active")?.rows ?? [];
  const overdue = activeRows.filter(pastDue).length;
  const overdueCut = active > activeRows.length;
  const lockedCut = overdueCut || pending > pendingRows.length;
  const atLeast = overdueCut ? "至少" : "";

  const firstWithRows = STATE_ORDER.find((key) => (groupByStatus.get(key)?.count ?? 0) > 0);
  const shownState: StateKey = state ?? (["mature_unclaimed", "active", "pending_lock"] as const).find((key) => (groupByStatus.get(key)?.count ?? 0) > 0) ?? firstWithRows ?? "mature_unclaimed";
  const group: G1PositionGroup | undefined = groupByStatus.get(shownState);
  const needle = query.trim().toLowerCase();
  const loaded = STATE_ORDER.flatMap((key) => groupByStatus.get(key)?.rows ?? []);
  const rows = needle
    ? loaded.filter((row) => [row.userNo, row.nickname, row.positionNo].some((text) => text.toLowerCase().includes(needle)))
    : group?.rows ?? [];
  const index = current ? rows.findIndex((row) => row.positionNo === current.positionNo) : -1;

  // 七组都返回了而且都是 0：没有任何历史仓位，仓位块一行写完，不摆七个 0。
  const noPositions = STATE_ORDER.every((key) => groupByStatus.get(key)?.count === 0);
  // 四个数都是 0 时不摆一排 0，结论那句已经说了「没有要处理的事」。
  const quiet = open === 0 && stats.usdtPoolUsd === 0 && stats.interestUsd === 0;
  // 查找只在已读到的行里找：读到的行数少于总数的状态，可能还有更早的仓位没显示。
  const cut = STATE_ORDER.filter((key) => { const g = groupByStatus.get(key); return g !== undefined && g.count > g.rows.length; });

  const conclusion = mature + overdue > 0
    ? <Conclusion state="warn" explain={COUNT_EXPLAIN}
        hint={overdue > 0
          ? <>其中{atLeast} {fmtCount(overdue)} 笔已过到期时间，状态还是计算奖励中：要等用户在 App 里读到仓位才转为到期未领。到期后由用户自己领取，系统不会自动发放。</>
          : "到期后由用户自己领取，系统不会自动发放；这页只能查看。"}>
        质押已退役，还有 {fmtCount(open)} 笔历史仓位没结清，其中{atLeast} {fmtCount(mature + overdue)} 笔已到期、等用户领取
      </Conclusion>
    : open > 0
      ? <Conclusion state="neutral" explain={COUNT_EXPLAIN}
          hint={[...pendingRows, ...activeRows].some(pastDue)
            ? "到期后由用户自己领取。"
            : lockedCut
              ? "读到的仓位都还没到到期时间；每种状态只读到最近更新的 50 笔，没读到的看不到到期时间。到期后由用户自己领取。"
              : "这些仓位都还没到到期时间；到期后由用户自己领取。"}>
          质押已退役，还有 {fmtCount(open)} 笔历史仓位在锁定中
        </Conclusion>
      : noPositions
        ? <Conclusion state="ok" explain={COUNT_EXPLAIN}>质押已退役，没有历史仓位，没有要处理的事</Conclusion>
        : <Conclusion state="ok" hint="已结束的仓位可以在下面按状态或用户查。" explain={COUNT_EXPLAIN}>质押已退役，历史仓位都已结清，没有要处理的事</Conclusion>;

  const selectState = (key: StateKey) => {
    setState(key);
    setQuery("");
    setCurrent(null);
  };
  const selectable = STATE_ORDER.filter((key) => groupByStatus.has(key));
  const onLaneKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTabValue(selectable, shownState, event.key);
    if (next === null) return;
    event.preventDefault();
    selectState(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-state="${next}"]`)?.focus();
  };

  const userCell = (row: G1PositionRow) => {
    const nickname = operatorNicknameText(row.nickname);
    const canOpenUser = reach("/users/search", "user_c1hub_read");
    return <Cell main={nickname} title={nickname} sub={canOpenUser ? <Link className="rd-link" href={`/users/search/${encodeURIComponent(row.userNo)}`} prefetch={false}>{row.userNo}</Link> : row.userNo} />;
  };

  return (
    <RdPage>
      {header}
      {error && (
        // 刷新失败但还留着上一次的数（当前读法下不会出现：重读失败会清空，进上面的整页失败）。
        <BlockState state="error" title="质押数据刷新失败" detail={error} onRetry={() => void reload(true)} />
      )}
      {conclusion}

      {!quiet && <StatBand label="质押历史概况">
        <Stat lead tone="role-2" icon={Layers} label="没结清的仓位" value={fmtCount(open)} unit="笔"
          sub={`锁定中 ${fmtCount(pending + active)} · 到期未领 ${fmtCount(mature)}`}
          explain={COUNT_EXPLAIN} />
        <Stat tone="role-1" icon={Wallet} label="锁定中的本金" value={usdtText(stats.usdtPoolUsd)} unit="USDT"
          explain="待确认、计算奖励中、到期未领三种仓位的锁定金额合计，只算四档 USDT 历史质押。这页只查这四档，不含 UVT 质押。" />
        <Stat tone={mature + overdue > 0 ? "warn" : "role-3"} icon={CalendarClock} label="到期未领" value={fmtCount(mature)} unit="笔"
          sub={overdue > 0 ? `另有${atLeast} ${fmtCount(overdue)} 笔已过到期时间` : undefined}
          explain="已到期、等用户自己领取的仓位。系统不会自动发放，后台也不能代领。这个数只算状态已经是到期未领的；过了到期时间、状态还是计算奖励中的另写在下面一行。它按这次读取的时间和每笔的到期时间比，只在读到的仓位里数，计算奖励中没读全时写「至少」。" />
        <Stat tone="role-1" icon={Coins} label="奖励估计" value={usdtText(stats.interestUsd)} unit="USDT" sub="整期估计 · 含四档以外产品"
          explain="后端把所有「计算奖励中」「到期未领」仓位开仓时算好的整期奖励加起来：不按已锁天数折算，也算进了四档以外产品的仓位。它不是已产生或已发放的奖励，后端改成和仓位同一范围之前只作量级参考。" />
      </StatBand>}

      <Panel plain title="四档历史产品" icon={Coins} tone="role-1"
        sub={`USDT · 质押总开关${gate.enabled ? "开启" : "已关闭"} · 紧急暂停 ${fmtCount(stats.killedCount)} 档`}
        explain={<><p>质押已退役，这里是四档的原配置，只能查看：不能改奖励率、扣款、最低额，也不能开售、停售、暂停或恢复，App 显示入口同样不在这里。</p><p>原档位状态只说明当时的配置，不代表现在可以买。质押总开关是 J1 紧急停用开关里读到的当前值；紧急暂停数是被暂停的档位数，不是被罚没的仓位数。</p></>}>
        {pools.length === 0
          ? <BlockState compact state="empty" title="暂无历史质押档位" detail="退役后没有档位是正常状态。" />
          : (
            <StatBand cards label="四档历史产品">
              {pools.map((pool) => {
                const status = pool.killed ? { text: "已暂停", icon: PauseCircle } : pool.enabled ? { text: "原配置开启", icon: CircleCheck } : { text: "原配置关闭", icon: CircleSlash };
                return (
                  <Stat key={pool.tierKey}
                    head={<span className="g1-tier-head"><b>{displayTerm(pool)}</b><StatusTag tone="done" icon={status.icon}>{status.text}</StatusTag></span>}
                    label="锁定中的本金" value={usdtText(pool.lockedUsd)} unit="USDT" tone="role-1">
                    <RatioBar label="占全部锁定本金" value={pool.lockedUsd} total={stats.usdtPoolUsd} tone="role-1"
                      valueText={`${usdtText(pool.lockedUsd)} USDT，共 ${usdtText(stats.usdtPoolUsd)} USDT`}
                      state={stats.usdtPoolUsd > 0 ? "ready" : "empty"} emptyText="没有锁定中的本金"
                      invalidText="这一档的锁定金额比全部合计还大，数据对不上，联系值班同事" />
                    <dl className="rd-stat-rows">
                      <div className="rd-stat-row"><dt>参考年奖励率</dt><dd>{pool.apyDisplay}</dd></div>
                      <div className="rd-stat-row"><dt>提前解锁扣款</dt><dd>{pool.penalty}%</dd></div>
                      <div className="rd-stat-row"><dt>最低锁仓额<Explain label="最低锁仓额的口径" content="没有单独配置时，显示的是产品表里的默认值，后端先把它舍到两位小数；单独配置过的按原值显示。" /></dt><dd>{minText(pool.minDisplayValue)}</dd></div>
                    </dl>
                  </Stat>
                );
              })}
            </StatBand>
          )}
        <PaginationExemption label="USDT 历史质押 4 档设置" maxRows={4} reason="四档历史配置一屏对照，只能查看。" />
      </Panel>

      <Panel title="历史仓位" icon={Layers} tone="role-2" flush
        sub={`没结清 ${fmtCount(open)} 笔`}
        explain={<><p>选一种状态看它的仓位，点一行看仓位详情。每种状态最多列出最近更新的 50 笔，状态上的数字是全部笔数。</p><p>每笔仓位的条件以开仓时的记录为准，这里不能手动改仓位。</p></>}>
        {noPositions ? <div className="g1-tools"><BlockState compact state="empty" title="没有历史仓位" detail="七种状态都是 0 笔。" /></div> : <>
        <div className="g1-tools">
        <div className="g1-lane" role="radiogroup" aria-label="仓位状态" onKeyDown={onLaneKey}>
          {STAGES.map((stage) => (
            <section key={stage.key} className="g1-lane-stage" data-stage={stage.key} aria-label={stage.title}>
              <div className="g1-lane-title">{stage.title}<Explain label={`${stage.title}是什么意思`} content={stage.explain} side="top" align="start" /></div>
              <div className="g1-lane-items">
                {stage.states.map((key) => {
                  const meta = POSITION_STATES[key];
                  const Icon = meta.icon;
                  const present = groupByStatus.has(key);
                  const count = countOf(key);
                  const checked = !needle && key === shownState;
                  return (
                    <button key={key} type="button" role="radio" className="g1-lane-item" data-state={key} data-tone={meta.tone}
                      aria-checked={checked} tabIndex={key === shownState ? 0 : -1} disabled={!present}
                      data-zero={count ? undefined : ""} title={present ? undefined : "接口没有返回这一组，打不开清单"}
                      onClick={() => selectState(key)}>
                      <span className="g1-lane-name"><Icon size={14} strokeWidth={1.9} aria-hidden />{key === "early_withdrawn" ? `本月${meta.label}` : meta.label}</span>
                      <span className="g1-lane-count">{count === null ? <>—<small>没有返回</small></> : <>{fmtCount(count)}<small>笔</small></>}</span>
                      {key === "active" && overdue > 0 && <span className="g1-lane-flag">{atLeast && `${atLeast} `}{fmtCount(overdue)} 笔已过到期时间</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <FilterBar onClear={() => setQuery("")} canClear={Boolean(needle)} clearLabel="清除"
          sort={<span className="rd-filter-result" role="status">{needle
            ? `在已读到的 ${fmtCount(loaded.length)} 笔里找到 ${fmtCount(rows.length)} 笔`
            : group
              ? `${positionStateLabel(shownState)} · 共 ${fmtCount(group.count)} 笔${group.count > group.rows.length ? `，列出最近更新的 ${fmtCount(group.rows.length)} 笔` : ""}`
              : ""}</span>}>
          <FilterField grow>
            <Input type="search" aria-label="按用户或仓位编号找仓位" placeholder="输入用户编号、昵称或仓位编号，在七种状态里一起找" value={query} onChange={(event) => { setQuery(event.target.value); setCurrent(null); }} />
          </FilterField>
        </FilterBar>
        {needle && cut.length > 0 && (
          <Notice tone="warn">{cut.map((key) => `「${key === "early_withdrawn" ? "本月" : ""}${positionStateLabel(key)}」共 ${fmtCount(groupByStatus.get(key)?.count ?? 0)} 笔，只读到最近更新的 ${fmtCount(groupByStatus.get(key)?.rows.length ?? 0)} 笔`).join("；")}，可能还有更早的仓位没显示，这次查找不全。</Notice>
        )}
        </div>

        <Table data-tight="" label={needle ? "找到的仓位" : `仓位清单 · ${positionStateLabel(shownState)}`} className="g1-positions">
          <thead><tr>
            <Th>仓位编号</Th>
            <Th>用户</Th>
            <Th>档位 · 奖励率</Th>
            <Th align="right">锁定金额（USDT）</Th>
            <Th>到期 · 开始</Th>
            <Th>状态</Th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && (
              <TableMessage columns={6}>{needle
                ? `已读到的记录里没有「${query.trim()}」；每种状态只读到最近更新的 50 笔，更早的不在这里。`
                : "暂无这个状态的仓位"}</TableMessage>
            )}
            {rows.map((row) => {
              const meta = rowState(row.status);
              const late = isOverdue(row);
              return (
                <Tr key={row.positionNo} selected={row.positionNo === current?.positionNo} onOpen={() => setCurrent(row)}>
                  <Td><Cell mono full main={<span className="g1-no"><span className="g1-no-head">{row.positionNo.slice(0, -8)}</span><span className="g1-no-tail">{row.positionNo.slice(-8)}</span></span>} title={row.positionNo} /></Td>
                  <Td>{userCell(row)}</Td>
                  <Td><Cell main={operatorCopyText(row.tier)} sub={row.lockedApy} title={`${operatorCopyText(row.tier)}，下单时年奖励率 ${row.lockedApy}`} /></Td>
                  <Td align="right"><Cell num main={rowAmount(row.amount)} /></Td>
                  <Td><Cell num main={dateText(row.unlockAt)} sub={dateText(row.lockedAt)} title={`到期 ${timeText(row.unlockAt)}，开始 ${timeText(row.lockedAt)}`} /></Td>
                  <Td>{late
                    ? <Cell main={<StatusTag tone={OVERDUE.tone} icon={OVERDUE.icon}>{OVERDUE.label}</StatusTag>} sub="状态还是计算奖励中" title={`${OVERDUE.meaning}（${noteText(row.note)}）`} />
                    : <Cell main={meta ? <StatusTag tone={meta.tone} icon={meta.icon}>{meta.label}</StatusTag> : <StatusTag tone="neutral">{operatorCopyText(row.statusLabel)}</StatusTag>} sub={noteText(row.note)} title={noteText(row.note)} />}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
        </>}
      </Panel>

      {current && (() => {
        const meta = rowState(current.status);
        const late = isOverdue(current);
        const nickname = operatorNicknameText(current.nickname);
        return (
          <Drawer open onClose={() => setCurrent(null)} title="仓位详情" sub={current.positionNo} icon={Layers} tone="role-2"
            explain="下单时的奖励率、扣款和期限都以这笔仓位开仓时的记录为准，后来改档位配置不影响它。时间按后端记录原样显示。金额字段在库里为空时，后端目前会返回 0，看到 0 先别当成真实金额。"
            nav={{ onPrev: () => setCurrent(rows[index - 1]), onNext: () => setCurrent(rows[index + 1]), hasPrev: index > 0, hasNext: index >= 0 && index < rows.length - 1 }}
            footer={<Decision note="只能查看，这里不能手动改仓位。" primary={<Button onClick={() => setCurrent(null)}>关闭</Button>} />}>
            <JudgmentPoints rows={[
              late
                ? { label: "状态", value: <StatusTag tone={OVERDUE.tone} icon={OVERDUE.icon}>{OVERDUE.label}</StatusTag>, reason: OVERDUE.meaning }
                : { label: "状态", value: meta ? <StatusTag tone={meta.tone} icon={meta.icon}>{meta.label}</StatusTag> : operatorCopyText(current.statusLabel), reason: meta?.meaning },
              { label: "锁定金额", value: `${rowAmount(current.amount)} USDT` },
              { label: "到期", value: timeText(current.unlockAt) },
              { label: "用户", value: <>{nickname} · {reach("/users/search", "user_c1hub_read") ? <Link className="rd-link" href={`/users/search/${encodeURIComponent(current.userNo)}`} prefetch={false}>{current.userNo}</Link> : current.userNo}</> },
            ]} />
            <Facts>
              <Fact k="档位">{operatorCopyText(current.tier)}</Fact>
              <Fact k="下单时奖励率">{current.lockedApy}</Fact>
              <Fact k="提前解锁扣款">{current.earlyPenalty}</Fact>
              <Fact k="开始时间">{timeText(current.lockedAt)}</Fact>
              <Fact k="预计质押奖励" unit="USDT">{rowAmount(current.estimatedInterest)}</Fact>
              <Fact k="备注">{noteText(current.note)}</Fact>
            </Facts>
          </Drawer>
        );
      })()}
    </RdPage>
  );
}

const COUNT_EXPLAIN = "没结清 = 待确认 + 计算奖励中 + 到期未领，只算四档 USDT 历史质押，是仓位笔数，不是用户数。";
