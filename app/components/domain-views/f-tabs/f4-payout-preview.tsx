"use client";

/**
 * F4 派奖、取消资格确认框里的「这一次的实际结果」：只读预览，打开确认框时读一次。
 * 只显示，不改提交内容；读不到写「读不到」，不写 0，也不挡提交。
 */
import { useEffect, useState } from "react";
import { BlockState, Cell, Explain, Fact, Facts, Fold, Notice, StatusTag, Table, Td, Th, Tr } from "@/app/components/rd";
import { displayAdminReadError } from "@/lib/admin/error-messages";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import { fetchF4LeaderboardDisqualificationReadiness, fetchF4LeaderboardPayoutPreview, fetchF4LeadershipPoolOverview, type F4LeaderboardDisqualificationReadiness, type F4LeaderboardPayoutPreview } from "@/lib/admin/f1-client";
import { count, decimalText, usdt, moneyText } from "./f4-shared";

type Read<T> = { state: "loading" } | { state: "failed"; error: string } | { state: "ok"; data: T; at: number };

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

const NOT_PAYING: Record<string, string> = {
  F4_LEADERBOARD_PAUSED: "排行榜在暂停中，这次不会发钱。",
  F4_LEADERBOARD_ALREADY_SETTLED: "总榜已经派过，这次批准不会再发。",
  F4_LEADERBOARD_NO_CANDIDATES: "现在没有人上榜，这次不会发钱。",
  F4_LEADERBOARD_NOTHING_PAYABLE: "按名次算出的金额都是 0，这次不会发钱。",
};

/** 预览里的百分比是十进制文本，写成「25」「60.5」，不舍入。 */
const percentText = (value: string) => value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;

/**
 * 总榜派奖确认框：配置的奖池之后，放这一次的人数、合计和名单。
 * 「操作记录与审批」的批准框不传 pool（奖池取预览读到的数），approving 换掉只对发起人成立的那句，rules 在名单后面接「怎么分」。
 */
export function F4PayoutPreviewFacts({ pool, approving = false, rules = false }: { pool?: string; approving?: boolean; rules?: boolean }) {
  const read = useRead<F4LeaderboardPayoutPreview>(() => fetchF4LeaderboardPayoutPreview("allTime"));
  const preview = read.state === "ok" ? read.data : undefined;
  const unconfigured = preview?.reason === "F4_LEADERBOARD_POOL_NOT_CONFIGURED";
  const poolShown = pool ?? (unconfigured ? "没有可发放的奖池" : preview ? moneyText(preview.prizePoolUsdt) : read.state === "loading" ? "正在加载…" : "读不到");
  const pending = read.state === "loading" ? "正在加载…" : read.state === "failed" ? "读不到" : undefined;
  const notPaying = unconfigured
    ? pool === "0" ? "总榜奖池为 0，这次不会发钱。" : "系统确认这次没有可发放的奖池。"
    : preview && !preview.available ? NOT_PAYING[preview.reason] ?? "这次不会发钱。" : undefined;
  return (
    <div className="f4-payout">
      <Facts>
        {/* 批准框里奖池也取自预览：读不到时只留「这次实发」一行，不连写三个「读不到」。 */}
        {poolShown !== "读不到" && <Fact k="总榜奖池" lead tone="role-1" unit={/\d/.test(poolShown) ? "USDT" : undefined}>{poolShown}</Fact>}
        <Fact k="这次实发" tone={pending === "读不到" ? "warn" : undefined}>{pending ?? (preview?.payableAmount !== undefined
          ? <><span className="f4-payout-num">{moneyText(preview.payableAmount)}</span> USDT</>
          : "—")}</Fact>
        {poolShown !== "读不到" && <Fact k="人数">{pending ?? (preview?.paidCount !== undefined && preview.rankedCount !== undefined
          ? `${count(preview.paidCount)} 人拿到钱，上榜 ${count(preview.rankedCount)} 人` : "—")}</Fact>}
      </Facts>
      {!!preview?.concentrationWarnings.length && <Notice tone="warn">{preview.concentrationWarnings.map(key => `${WARNING_LABEL[key]}超过 ${percentText(preview[key])}%`).join("；")}。奖金按名次权重计算。</Notice>}
      {notPaying && <Notice tone="warn">{notPaying}</Notice>}
      {read.state === "failed" && <BlockState state="error" title="派奖预览加载失败"
        detail={<>{read.error}{approving ? " 批准时按那一刻的总榜重新计算。" : " 批准时按当时的总榜重新计算。"}</>}
        onRetry={read.retry} />}
      {preview && preview.rows.length > 0 && (
        <div className="f4-payout-list" data-long={preview.rows.length > 6 ? "" : undefined}>
          <Table label="这次派奖名单" className="f4-payout-table">
            <thead><tr><Th>名次</Th><Th>用户</Th><Th align="right">算力点</Th><Th align="right">实发（USDT）</Th></tr></thead>
            <tbody>
              {preview.rows.map((row) => (
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
      )}
      {read.state === "ok" && <p className="f4-payout-note">{businessStamp(read.at)}（{businessZone().label}）读到的预览，不锁定：批准时重新算，金额可能不同，覆盖率也会再查。</p>}
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

/**
 * 「操作记录与审批」里批准本周结算时的现状：和 F4 结算确认框同一份读数（本周池、有资格分的人），打开时读一次。
 * 读不到写「读不到」，不写 0，也不挡批准。
 */
export function F4SettleFacts() {
  const read = useRead(() => fetchF4LeadershipPoolOverview());
  const data = read.state === "ok" ? read.data : undefined;
  const pending = read.state === "loading" ? "正在加载…" : read.state === "failed" ? "读不到" : undefined;
  const settled = !!data && data.weeklyInjectedUsd > 0;
  const pool = data ? data.currentWeekPoolAmount ?? data.currentWeekPoolUsd : null;
  return (
    <div className="f4-payout">
      <Facts>
        <Fact k={settled ? "本周已结算（实发）" : "本周池（估算）"} lead tone={pending === "读不到" ? "warn" : "role-1"} unit={data && pool !== null ? "USDT" : undefined}>{pending ?? usdt(pool)}</Fact>
        <Fact k="有资格分的人">{pending ?? `${count(data!.participantCount)} 人`}</Fact>
      </Facts>
      {read.state === "failed" && <p className="f4-payout-note">本周奖池读不到，不影响批准；批准时按那一刻重新计算。</p>}
      {read.state === "ok" && <p className="f4-payout-note">{businessStamp(read.at)}（{businessZone().label}）读到的估算：批准时按那一刻所在的周重新计算；本周已经结算过的会跳过，不补发差额。</p>}
    </div>
  );
}
