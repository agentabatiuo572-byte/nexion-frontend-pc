"use client";

/**
 * F4 派奖、取消资格确认框里的「这一次的实际结果」：只读预览，打开确认框时读一次。
 * 读不到时显示读取失败，批准时由系统重新核验。
 */
import { useEffect, useState } from "react";
import { BlockState, Cell, Explain, Fact, Facts, Fold, Notice, StatusTag, Table, Td, Th, Tr } from "@/app/components/rd";
import { displayAdminReadError } from "@/lib/admin/error-messages";
import { businessClock, businessZone } from "@/lib/admin/business-time";
import { fetchF4LeaderboardDisqualificationReadiness, fetchF4LeaderboardPayoutPreview, fetchF4LeadershipPoolOverview, fetchF4VoteProjection, type F4LeaderboardDisqualificationReadiness, type F4LeaderboardPayoutPreview } from "@/lib/admin/f1-client";
import { f4CurrentWeekSettled } from "@/lib/admin/f4-vote-projection";
import { f4CurrentWeekPool } from "@/lib/admin/f4-money";
import { count, decimalText, usdt, moneyText } from "./f4-shared";

type Read<T> = { state: "loading" } | { state: "failed"; error: string } | { state: "ok"; data: T; at: number };
export type F4PayoutReadState = { state: "loading" | "failed" } | { state: "ok"; settled: boolean; paused?: boolean; configOnHold?: boolean };

function useRead<T>(read: () => Promise<T | null>) {
  const [result, setResult] = useState<Read<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    read().then(
      data => { if (alive) setResult(data === null ? { state: "failed", error: "这次没有读到预览结果。" } : { state: "ok", data, at: Date.now() }); },
      error => { if (alive) setResult({ state: "failed", error: displayAdminReadError(error) }); },
    );
    return () => { alive = false; };
    // Each mounted preview reads independently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  return { ...result, retry: () => { setResult({ state: "loading" }); setAttempt(previous => previous + 1); } };
}

const WARNING_LABEL = { top1MaxPct: "第 1 名占比", top5MaxPct: "前 5 名合计占比" } as const;

/** 预览说这次不会发时的原因：只写不会发和为什么，批准时以当时的总榜为准（OP-90）。 */
const NOT_PAYING: Record<string, string> = {
  F4_LEADERBOARD_PAUSED: "排行榜已暂停",
  F4_LEADERBOARD_ALREADY_SETTLED: "总榜已经派过",
  F4_LEADERBOARD_NO_CANDIDATES: "现在没有人上榜",
  F4_LEADERBOARD_NOTHING_PAYABLE: "按名次算出的金额都是 0",
};

/** 预览里的百分比是十进制文本，写成「25」「60.5」，不舍入。 */
const percentText = (value: string) => value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;

/**
 * 总榜派奖确认框：配置的奖池之后，放这一次的人数、合计和名单。
 * 发起框用页面奖池作占位，读到预览后两个框的奖池都取这次读数。rules 在名单后面接「怎么分」。
 * 能发时写估算和读取时间；不会发时只写不会发和原因，按名次测算的名单收进折叠、标明这次不发。
 * 金额批准时才算出来，奖池是配置不是这次动的钱：框里不放关键数字（VS-102）。
 */
export function F4PayoutPreviewFacts({ pool, rules = false, onReadStateChange }: {
  pool?: string; rules?: boolean; onReadStateChange?: (read: F4PayoutReadState) => void;
}) {
  const read = useRead<F4LeaderboardPayoutPreview>(() => fetchF4LeaderboardPayoutPreview("allTime"));
  const preview = read.state === "ok" ? read.data : undefined;
  useEffect(() => {
    onReadStateChange?.(read.state === "ok" ? { state: "ok", settled: read.data.alreadySettled, paused: read.data.paused } : { state: read.state });
  }, [read, onReadStateChange]);
  const payable = preview?.available === true;
  const calculation = payable ? preview.payout : preview?.ranking;
  const unconfigured = preview?.reason === "F4_LEADERBOARD_POOL_NOT_CONFIGURED";
  const poolShown = preview ? unconfigured ? "没有可发放的奖池" : moneyText(preview.prizePoolUsdt)
    : pool ?? (read.state === "loading" ? "正在加载…" : undefined);
  const notPaying = !preview || payable ? undefined
    : unconfigured ? "没有可发放的奖池" : NOT_PAYING[preview.reason];
  const warnings = !!preview?.concentrationWarnings.length && <Notice tone="warn">{preview.concentrationWarnings.map(key => `${WARNING_LABEL[key]}超过 ${percentText(preview[key])}%`).join("；")}。奖金按名次权重计算。</Notice>;
  const list = calculation && calculation.rows.length > 0 && (
    <div className="f4-payout-list" data-long={calculation.rows.length > 6 ? "" : undefined}>
      <Table label={payable ? "这次派奖名单（估算）" : "按名次测算的名单，这次不发"} className="f4-payout-table">
        <thead><tr><Th>名次</Th><Th>用户</Th><Th align="right">算力点</Th><Th align="right">{payable ? "估算发放（USDT）" : "测算（USDT）"}</Th></tr></thead>
        <tbody>
          {calculation.rows.map((row) => (
            <Tr key={row.userId}>
              <Td><Cell main={`第 ${row.rank} 名`} /></Td>
              <Td><Cell mono main={row.userNo} /></Td>
              <Td align="right"><Cell num main={decimalText(row.computePoints).replace(/\.00$/, "")} /></Td>
              <Td align="right"><Cell num main={moneyText(row.amount)} /></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
  return (
    <div className="f4-payout">
      {(poolShown !== undefined || payable || read.state === "loading") && <Facts>
        {poolShown !== undefined && <Fact k="总榜奖池" unit={/\d/.test(poolShown) ? "USDT" : undefined}>{poolShown}</Fact>}
        {(payable || read.state === "loading") && <Fact k="这次发放（估算）">{calculation
          ? <><span className="f4-payout-num">{moneyText(calculation.totalAmount)}</span> USDT</> : "正在加载…"}</Fact>}
        {payable && calculation && <Fact k="人数">{`发放 ${count(calculation.positiveAmountCount)} 人，上榜 ${count(calculation.rankedCount)} 人`}</Fact>}
      </Facts>}
      {preview && !payable && <Notice tone="warn">{notPaying ? `不会发钱：${notPaying}。` : "不会发钱。"}</Notice>}
      {payable && warnings}
      {read.state === "failed" && <BlockState state="error" title="派奖预览加载失败" detail={read.error} onRetry={read.retry} />}
      {payable ? list : list && <Fold inset title="按名次测算，这次不发" summary={`上榜 ${count(calculation.rankedCount)} 人，测算合计 ${moneyText(calculation.totalAmount)} USDT`}>
        <div className="rd-stack">{warnings}{list}</div>
      </Fold>}
      {/* 分两段不断开：窄框里只在逗号后换行，不留两三个字的孤行。 */}
      {read.state === "ok" && <p className="f4-payout-note"><span className="rd-keep">{`${businessClock(read.at)}（${businessZone().label}）${payable ? "读到的估算，" : "读到，"}`}</span><span className="rd-keep">{payable ? "批准时重新算，金额可能不同。" : "批准时以当时的总榜为准。"}</span></p>}
      {rules && preview && <F4PayoutRules top1MaxPct={percentText(preview.top1MaxPct)} top5MaxPct={percentText(preview.top5MaxPct)} />}
    </div>
  );
}

/** 占比告警、分份方法：规则放在结果后面，收起。 */
export function F4PayoutRules({ top1MaxPct, top5MaxPct }: { top1MaxPct: string; top5MaxPct: string }) {
  return (
    <Fold inset title="怎么分" summary={`占比告警：第 1 名 ${top1MaxPct}%，前 5 名合计 ${top5MaxPct}%`}>
      <Facts>
        <Fact k="每个名次发多少">按名次分份数：第 1 名 N 份，往后每名少 1 份，最后一名 1 份；N 是上榜人数</Fact>
        <Fact k="占比告警"><span className="rd-keep">第 1 名超过 {top1MaxPct}%，</span><span className="rd-keep">前 5 名合计超过 {top5MaxPct}%，</span><span className="rd-keep">超过阈值时记录告警</span></Fact>
      </Facts>
    </Fold>
  );
}

/** 取消资格确认框的「依据」一行：后端提交和执行时核的是同一份依据。 */
export function F4DisqualifyEvidenceFact({ memberUserId }: { memberUserId: number }) {
  const read = useRead<F4LeaderboardDisqualificationReadiness>(() => fetchF4LeaderboardDisqualificationReadiness(50));
  if (read.state !== "ok") return <Fact k="依据" tone={read.state === "failed" ? "warn" : undefined}>{read.state === "loading" ? "正在加载…" : "读不到，提交后由系统核对"}</Fact>;
  const row = read.data.rows.find((item) => item.memberUserId === memberUserId);
  // 这项读取最多给本周前 50 名，也不能按人查：没读到不等于没有依据。
  if (!row) return <Fact k="依据" tone="warn">读不到，提交后由系统核对<Explain label="为什么读不到" content="这里只核对本周排名前 50 的人；排在后面或名次刚变动的人读不到。提交和批准时系统都会按这个人核对依据。" /></Fact>;
  if (!row.disqualificationAvailable) return <Fact k="依据" tone="warn">没有找到，提交会被拒绝<Explain label="要什么依据" content="本周的风险记录，或这个人在生效中的关联账户簇里。提交和批准时系统都会核对。" /></Fact>;
  const k2 = row.riskEvidenceRef.startsWith("K2-");
  return <Fact k="依据"><StatusTag tone="warn">{k2 ? "本周风险记录" : "关联账户簇"}</StatusTag> <span data-mono className="f4-payout-ref">{row.riskEvidenceRef}</span></Fact>;
}

/** 本周已结算：F4 发起框和「操作记录与审批」批准框同一句（OP-69）；结算哪一周以批准时为准，跨到下一周再批就按下一周算。 */
export function F4SettledWeekNotice() {
  return <Notice tone="warn" title="本周已结算：本周内批准不会再发，也不补差额"><span className="rd-keep">结算哪一周以批准时为准：</span><span className="rd-keep">到下一周才批准的，按下一周结算，</span><span className="rd-keep">并先查兑付覆盖率。</span></Notice>;
}

export function F4PoolReadTime({ at, estimated }: { at: number; estimated: boolean }) {
  const time = `${businessClock(at)}（${businessZone().label}）`;
  return <p className="f4-payout-note">{estimated
    ? <><span className="rd-keep">{`${time}读到的估算，`}</span><span className="rd-keep">批准时重新算，金额可能不同。</span></>
    : `${time}读到。`}</p>;
}

/**
 * 「操作记录与审批」里批准本周结算时的现状：和 F4 结算确认框同一份读数（本周池、有资格分的人），打开时读一次。
 * 概览读取成功后再按结算状态和覆盖率判断能否批准。
 * 读完前这里写「正在加载…」，确认按钮的原因只在按钮上（ST-30、ST-31）；读失败时错误卡顶替整块读数（ST-34）。读取时间紧跟读数，已结算提示在后，和 F4 发起框同一个顺序。
 */
export function F4SettleFacts({ onReadStateChange }: { onReadStateChange?: (read: F4PayoutReadState) => void }) {
  const read = useRead(fetchF4LeadershipPoolOverview);
  const projection = useRead(fetchF4VoteProjection);
  const data = read.state === "ok" ? read.data : undefined;
  const settled = data && (data.currentWeekSettled ?? f4CurrentWeekSettled(projection.state === "ok" ? projection.data : undefined));
  const configOnHold = data?.settlementConfigStatus === "HOLD" && settled !== true;
  const waitingForLegacyProjection = !!data && data.currentWeekSettled === undefined && projection.state === "loading";
  useEffect(() => {
    onReadStateChange?.(read.state !== "ok" ? { state: read.state }
      : waitingForLegacyProjection ? { state: "loading" } : { state: "ok", settled: settled === true, configOnHold });
  }, [read.state, settled, configOnHold, waitingForLegacyProjection, onReadStateChange]);
  const { amount: pool, actual, estimated } = data ? f4CurrentWeekPool(data) : { amount: null, actual: false, estimated: false };
  return (
    <div className="f4-payout">
      {read.state === "failed" ? <BlockState state="error" title="本周奖池加载失败" detail={read.error} onRetry={read.retry} /> : <Facts>
        {/* 估算批准时才算出来，已发的数这次不动：都不做关键数字（VS-102）。 */}
        <Fact k={actual ? "本周已结算（实发）" : estimated ? "本周池（估算）" : "本周池"} unit={pool !== null ? "USDT" : undefined}>{data ? usdt(pool) : "正在加载…"}</Fact>
        <Fact k="有资格分的人">{data ? `${count(data.participantCount)} 人` : "正在加载…"}</Fact>
      </Facts>}
      {read.state === "ok" && <F4PoolReadTime at={read.at} estimated={estimated} />}
      {settled && <F4SettledWeekNotice />}
    </div>
  );
}
