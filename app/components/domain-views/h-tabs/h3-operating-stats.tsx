"use client";

/**
 * H3 经营统计：任务 GET 附带的有来源统计（后端 50ca59b0 questTasksWithOperatingStats）。
 * 后端给几个量就给几个位置；读不到写「—」和原因，不当 0；金额按币种分开、按原值；本月人数没给时写明没有。
 * 旧后端没有这些字段时页面不用这里，保留原来的占位格。
 */
import { Coins } from "lucide-react";
import { Cell, Fold, Stat, Table, Td, Th, Tr } from "@/app/components/rd";
import type { H3Stats } from "@/lib/admin/h3-contract";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { amountText } from "./h3-quest-parts";

const count = (value: number) => value.toLocaleString("en-US");
/** 原值去掉末尾补的 0，最少两位小数，不舍入。 */
const money = (value: string) => {
  const [whole, frac = ""] = (amountText(value) ?? value).split(".");
  return `${whole}.${frac.replace(/0+$/, "").padEnd(2, "0")}`;
};
const WEEK_ZONE: Record<string, string> = { "Asia/Ho_Chi_Minh": "越南时间", "Asia/Shanghai": "北京时间" };

/** 新后端才有 operatingStatsAvailable；旧后端返回 undefined，页面保持原来的占位。 */
export const hasH3OperatingStats = (stats: H3Stats) => stats.operatingStatsAvailable !== undefined;

type Row = { key: string; name: string; value: string; basis: string; range: string };

function rowsOf(s: H3Stats): Row[] {
  const ok = s.operatingStatsAvailable === true;
  const claims = s.dayOneClaimCounts;
  const week = ok ? `本周 ${formatBusinessTimeCompact(s.weekFromStorage, "—")} 起` : "本周";
  const paid = s.weeklyPaidByAsset ?? [];
  return [
    { key: "full", name: "新手任务全额领取率", range: "累计，不限本周",
      value: ok && s.dayOneRate24h != null ? `${s.dayOneRate24h}%` : "—",
      basis: !ok ? "这次读不到" : claims && s.dayOneRate24hAvailable
        ? `期限已到的 ${count(claims.fullEligible)} 位新用户里，${count(claims.fullClaimed)} 位在注册 24 小时内领了`
        : "还没有完成期限已到的新用户，算不出" },
    { key: "grace", name: "宽限期领取率", range: "累计，不限本周",
      value: ok && s.dayOneRateGrace != null ? `${s.dayOneRateGrace}%` : "—",
      basis: !ok ? "这次读不到" : claims && s.dayOneRateGraceAvailable
        ? `有宽限期的 ${count(claims.graceEligible)} 位里，${count(claims.graceClaimed)} 位在宽限期内领了`
        : "没有带宽限期、且期限已到的用户，算不出" },
    { key: "weekly", name: "本周完成的每周任务", range: week,
      value: ok && s.weeklyDone != null ? `${count(s.weeklyDone)} 次` : "—",
      basis: !ok ? "这次读不到"
        : s.weeklyDone == null ? `${count(s.weeklyUndatedCount ?? 0)} 条完成记录没有完成时间，总数算不准；有时间的 ${count(s.weeklyKnownDone ?? 0)} 次`
          : s.t1Done != null && s.t2Done != null ? `一档 ${count(s.t1Done)} 次 · 二档 ${count(s.t2Done)} 次`
            : `${count(s.weeklyUnknownTierCount ?? 0)} 次找不到所属档位，分不出一档、二档` },
    { key: "paid", name: "本周发放的任务奖励", range: week,
      value: !ok ? "—" : paid.length ? paid.map((row) => `${money(row.amount)} ${row.asset}`).join("；") : `0.00 ${s.weeklyNexAsset ?? "UVT"}`,
      basis: !ok ? "这次读不到" : paid.length ? `已到账，按币种分开：${paid.map((row) => `${row.asset} ${count(row.ledgerCount)} 笔`).join("、")}` : "本周还没有到账的任务奖励" },
    { key: "monthly", name: "本月有任务记录的用户", range: "本月",
      value: ok && s.monthlyInflightAvailable && s.monthlyInflight != null ? `${count(s.monthlyInflight)} 人` : "—",
      basis: !ok ? "这次读不到" : s.monthlyInflightAvailable && s.monthlyInflight != null
        ? "本月完成新手或每周任务、或参加活动的用户，一人算一次" : "没有这项统计" },
  ];
}

/** 页头第四格：本周发放的 UVT 任务奖励；点开下面的「经营统计」。 */
export function H3OperatingStat({ stats, onOpen }: { stats: H3Stats; onOpen: () => void }) {
  const ok = stats.operatingStatsAvailable === true;
  const uvt = ok && stats.weeklyNex != null ? money(stats.weeklyNex) : "—";
  const others = (stats.weeklyPaidByAsset ?? []).filter((row) => row.asset !== "UVT");
  return <Stat tone="role-1" icon={Coins} label="本周发放的任务奖励" value={uvt} unit={uvt === "—" ? undefined : "UVT"}
    sub={!ok ? "这次读不到，不是 0" : others.length ? `另有 ${others.map((row) => `${money(row.amount)} ${row.asset}`).join("、")}`
      : stats.weeklyDone != null ? `本周完成 ${count(stats.weeklyDone)} 次每周任务` : "本周完成数算不准"}
    onOpen={onOpen} openLabel="打开经营统计"
    explain="本周（周一起）已到账的任务奖励，只算 UVT。领取率、完成次数在下面的「经营统计」。" />;
}

/** 首屏统计下的折叠：每个量一行，写数、算的是什么、时间范围。默认收起，不挤任务列表。 */
export function H3OperatingFold({ stats, open, onOpenChange }: { stats: H3Stats; open: boolean; onOpenChange: (open: boolean) => void }) {
  const ok = stats.operatingStatsAvailable === true;
  const rows = rowsOf(stats);
  const zone = businessZone().label;
  const weekZone = WEEK_ZONE[stats.weekTimeZone ?? ""];
  const summary = ok
    ? `全额领取 ${rows[0].value} · 宽限 ${rows[1].value} · 本周完成 ${rows[2].value}`
    : "这次读不到，不是 0";
  return (
    <div id="h3-operating-stats">
      <Fold title="经营统计" icon={Coins} tone="role-1" summary={summary} open={open} onOpenChange={onOpenChange}
        explain={<p>只算真实用户，不含测试账号。领取率按已到完成期限的新用户累计算；本周从周一 00:00{weekZone ? `（${weekZone}）` : ""}算起。</p>}>
        <Table label="经营统计">
          <thead><tr><Th>统计</Th><Th align="right">数</Th><Th>算的是什么</Th><Th>时间范围</Th></tr></thead>
          <tbody>
            {rows.map((row) => <Tr key={row.key}>
              <Td><Cell main={row.name} /></Td>
              <Td align="right"><Cell num main={row.value} /></Td>
              <Td grow><Cell main={row.basis} title={row.basis} /></Td>
              <Td><Cell main={row.range} /></Td>
            </Tr>)}
          </tbody>
        </Table>
        <p className="h3-empty-line">{ok ? `时间为${zone} · 截至 ${formatBusinessTimeCompact(stats.asOf, "—")}` : "统计暂时读不到；任务配置不受影响。"}</p>
      </Fold>
    </div>
  );
}
