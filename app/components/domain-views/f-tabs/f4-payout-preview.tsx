"use client";

/**
 * F4 派奖、取消资格确认框里的「这一次的实际结果」：只读预览，打开确认框时读一次。
 * 只显示，不改提交内容；读不到写「读不到」，不写 0，也不挡提交。
 */
import { useEffect, useState } from "react";
import { Cell, Explain, Fact, Facts, Fold, Notice, StatusTag, Table, Td, Th, Tr } from "@/app/components/rd";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import { fetchF4LeaderboardDisqualificationReadiness, fetchF4LeaderboardPayoutPreview, type F4LeaderboardDisqualificationReadiness, type F4LeaderboardPayoutPreview } from "@/lib/admin/f1-client";
import { f4Decimal } from "@/lib/admin/f4-money";
import { count, decimalText } from "./f4-shared";
import "./f4-payout-preview.css";

type Read<T> = { state: "loading" } | { state: "failed" } | { state: "ok"; data: T; at: number };

function useRead<T>(read: () => Promise<T | null>): Read<T> {
  const [result, setResult] = useState<Read<T>>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    read().then(
      (data) => { if (alive) setResult(data === null ? { state: "failed" } : { state: "ok", data, at: Date.now() }); },
      () => { if (alive) setResult({ state: "failed" }); },
    );
    return () => { alive = false; };
    // 打开确认框时读一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return result;
}

/** 同一处并排比较的几个金额，按最多的小数位对齐（不舍入）。 */
function alignedAmounts(values: readonly string[]): string[] {
  const shown = values.map((value) => decimalText(value));
  const places = Math.max(2, ...shown.map((value) => value.split(".")[1]?.length ?? 0));
  return shown.map((value) => {
    const [whole, fraction = ""] = value.split(".");
    return /^-?[\d,]+$/.test(whole) ? `${whole}.${fraction.padEnd(places, "0")}` : value;
  });
}

const CAP_LABEL = { top1MaxPct: "第 1 名上限", top5MaxPct: "前 5 名上限" } as const;

const NOT_PAYING: Record<string, string> = {
  F4_LEADERBOARD_POOL_NOT_CONFIGURED: "总榜奖池是 0，这次不会发钱。",
  F4_LEADERBOARD_PAUSED: "排行榜在暂停中，这次不会发钱。",
  F4_LEADERBOARD_ALREADY_SETTLED: "总榜已经派过，这次批准不会再发。",
  F4_LEADERBOARD_NO_CANDIDATES: "现在没有人上榜，这次不会发钱。",
  F4_LEADERBOARD_NOTHING_PAYABLE: "按头部上限算下来每个人都是 0，这次不会发钱。",
};

const isZero = (value: string) => /^-?0*(\.0*)?$/.test(f4Decimal(value) ?? "x");

/** 总榜派奖确认框：配置的奖池之后，放这一次的人数、合计和名单。 */
export function F4PayoutPreviewFacts({ pool }: { pool: string }) {
  const read = useRead<F4LeaderboardPayoutPreview>(() => fetchF4LeaderboardPayoutPreview("allTime"));
  const preview = read.state === "ok" ? read.data : undefined;
  const totals = preview?.payableAmount !== undefined && preview.amountBeforeCaps !== undefined && preview.reducedByCaps !== undefined
    ? alignedAmounts([preview.payableAmount, preview.amountBeforeCaps, preview.reducedByCaps]) : undefined;
  const pending = read.state === "loading" ? "正在读取…" : read.state === "failed" ? "读不到" : undefined;
  const notPaying = preview && !preview.available ? NOT_PAYING[preview.reason] ?? "这次不会发钱。" : undefined;
  return (
    <div className="f4-payout">
      <Facts>
        <Fact k="总榜奖池" lead tone="role-1" unit={pool === "—" ? undefined : "USDT"}>{pool}</Fact>
        <Fact k="这次实发" tone={pending === "读不到" ? "warn" : undefined}>{pending ?? (totals
          ? <><span className="f4-payout-num">{totals[0]}</span> USDT<span className="f4-payout-sub">{isZero(preview!.reducedByCaps!) ? "头部上限没有削减" : <>算出 <span className="f4-payout-num">{totals[1]}</span>，头部上限削掉 <span className="f4-payout-num">{totals[2]}</span></>}</span></>
          : "—")}</Fact>
        <Fact k="人数">{pending ?? (preview?.paidCount !== undefined && preview.rankedCount !== undefined
          ? `${count(preview.paidCount)} 人拿到钱，上榜 ${count(preview.rankedCount)} 人` : "—")}</Fact>
      </Facts>
      {notPaying && <Notice tone="warn">{notPaying}</Notice>}
      {read.state === "failed" && <p className="f4-payout-note">这次的名单和金额读不到，不影响提交；批准时按那时的总榜计算。</p>}
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
                  <Td align="right"><Cell num main={decimalText(row.amount)}
                    sub={row.limitedBy.length ? <>算出 {decimalText(row.amountBeforeCaps)} · {row.limitedBy.map((cap) => CAP_LABEL[cap]).join("、")}</> : undefined} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {read.state === "ok" && <p className="f4-payout-note">{businessStamp(read.at)}（{businessZone().label}）读到的预览，不锁定：批准时重新算，金额可能不同，覆盖率也会再查。</p>}
    </div>
  );
}

/** 头部上限、分份方法：规则放在结果后面，收起。 */
export function F4PayoutRules({ top1MaxPct, top5MaxPct }: { top1MaxPct: string; top5MaxPct: string }) {
  return (
    <Fold inset title="怎么分" summary={`第 1 名最多 ${top1MaxPct}%，前 5 名合计最多 ${top5MaxPct}%`}>
      <Facts>
        <Fact k="每个名次发多少">按名次分份数：第 1 名 N 份，往后每名少 1 份，最后一名 1 份；N 是上榜人数</Fact>
        <Fact k="头部上限"><span className="rd-keep">第 1 名最多 {top1MaxPct}%，</span><span className="rd-keep">前 5 名合计最多 {top5MaxPct}%，</span><span className="rd-keep">超出的不再分给别人</span></Fact>
      </Facts>
    </Fold>
  );
}

/** 取消资格确认框的「依据」一行：后端提交和执行时核的是同一份依据。 */
export function F4DisqualifyEvidenceFact({ memberUserId }: { memberUserId: number }) {
  const read = useRead<F4LeaderboardDisqualificationReadiness>(() => fetchF4LeaderboardDisqualificationReadiness(50));
  if (read.state !== "ok") return <Fact k="依据" tone={read.state === "failed" ? "warn" : undefined}>{read.state === "loading" ? "正在读取…" : "读不到，提交后由系统核对"}</Fact>;
  const row = read.data.rows.find((item) => item.memberUserId === memberUserId);
  if (!row) return <Fact k="依据" tone="warn">读不到：本周候选名单里没有这个人</Fact>;
  if (!row.disqualificationAvailable) return <Fact k="依据" tone="warn">没有找到，提交会被拒绝<Explain label="要什么依据" content="本周的风险记录，或这个人在生效中的关联账户簇里。提交和批准时系统都会核对。" /></Fact>;
  const k2 = row.riskEvidenceRef.startsWith("K2-");
  return <Fact k="依据"><StatusTag tone="warn">{k2 ? "本周风险记录" : "关联账户簇"}</StatusTag> <span data-mono className="f4-payout-ref">{row.riskEvidenceRef}</span></Fact>;
}
