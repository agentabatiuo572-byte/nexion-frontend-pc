"use client";

/**
 * K4「账户名单」页签：按档列账户（B115、B120）。只画收到的数据，不发请求、不判权限。
 * 名单的读取、网址里的视图／档位／页码、点人后的来源都由 k4-scoring.tsx 传进来。
 */
import { Hourglass, List, PenLine } from "lucide-react";
import { BlockState, Button, Cell, Explain, Pager, Panel, Segments, StatusTag, Table, TableMessage, Td, Th, Tr } from "@/app/components/rd";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { K4_ACCOUNT_BANDS, type K4AccountBand, type K4AccountPage } from "@/lib/admin/k-client";

/** 名单区自己的状态，包含只重试名单的读取失败。 */
export type K4AccountListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; page: K4AccountPage };

type Lines = { bandLowMax: number; bandHighMin: number; autoEscalateScore: number };

export const K4_BAND_NAME: Record<K4AccountBand, string> = {
  AUTO_REPORT: "达到自动升级线",
  HIGH_BELOW_AUTO: "高风险（未到自动升级线）",
  MEDIUM: "中风险",
  STALE: "等待重新评分",
};
const ORDER_TEXT = "按有效分从高到低，同分按用户编号";

const panelTitle = (band: K4AccountBand) => band === "STALE" ? "等待重新评分的账户" : band === "MEDIUM" ? "中风险账户" : band === "AUTO_REPORT" ? "达到自动升级线的账户" : "高风险（未到自动升级线）账户";
const rangeText = (band: K4AccountBand, lines: Lines) => band === "AUTO_REPORT" ? `有效分 ≥ ${lines.autoEscalateScore}`
  : band === "HIGH_BELOW_AUTO" ? `有效分 ${lines.bandHighMin}–${lines.autoEscalateScore - 1}`
    : band === "MEDIUM" ? `有效分 ${lines.bandLowMax}–${lines.bandHighMin - 1}` : null;

function bandExplain(band: K4AccountBand, lines: Lines, version: string) {
  if (band === "STALE") return `还没评分、用的不是规则 ${version}，或评分时间已超过 1 天的账户，不算进各风险档。和上方「排队重算」统计口径不同，人数可能不一样。`;
  if (band === "AUTO_REPORT") return `有效分达到自动升级线 ${lines.autoEscalateScore} 分的账户。新提现会发升级告警，没被「提现风险规则」冻结或延迟的转人工审核。`;
  if (band === "HIGH_BELOW_AUTO") return `有效分 ${lines.bandHighMin}–${lines.autoEscalateScore - 1} 分的账户，不含达到自动升级线的（那一档单独列）。`;
  return `有效分 ${lines.bandLowMax}–${lines.bandHighMin - 1} 分的账户。`;
}

function emptyText(band: K4AccountBand, lines: Lines, version: string) {
  if (band === "STALE") return { title: "现在没有等待重新评分的账户", detail: `账户都已在 1 天内按规则 ${version} 评过分。` };
  if (band === "AUTO_REPORT") return { title: "现在没有达到自动升级线的账户", detail: `有账户达到 ${lines.autoEscalateScore} 分时会列在这里。` };
  const range = band === "HIGH_BELOW_AUTO" ? `${lines.bandHighMin}–${lines.autoEscalateScore - 1}` : `${lines.bandLowMax}–${lines.bandHighMin - 1}`;
  return { title: `现在没有${K4_BAND_NAME[band]}的账户`, detail: `有账户的有效分在 ${range} 分时会列在这里。` };
}

/** 规则版本只有一种写法：「v3」。 */
const versionText = (value: string | null) => value === null || value === "" ? "—" : `v${value.replace(/^k4-v/i, "").replace(/^v/i, "")}`;

/**
 * 按档的账户名单（3-prop-1、3-tgt-1、3-tgt-2b、3-tgt-4、3-tgt-5）。
 * - 档位分段只筛这一张表（PG-32）；顺序由服务端定，这里不重排。
 * - lines 用概览里生效规则的分档线；名单读到后用名单回包自己的（同一次读数）。
 * - highlight 是从单人评分返回时刚看的账户，这一页有他才高亮（不进网址）。
 */
export function K4AccountList({ band, state, lines, version, highlight, pageSizes, onBand, onPage, onPageSize, onRetry, onOpenUser }: {
  band: K4AccountBand;
  state: K4AccountListState;
  lines: Lines;
  /** 生效规则版本，写在等待档的说明里，比如「v3」。 */
  version: string;
  highlight: string | null;
  pageSizes: readonly number[];
  onBand: (band: K4AccountBand) => void;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  onRetry: () => void;
  onOpenUser: (userNo: string) => void;
}) {
  const shown = state.kind === "ready" ? state.page : null;
  const now = shown ?? lines;
  const range = rangeText(band, now);
  // 副标题只放数据：范围；有行时再写固定顺序，有评分时间时标一次时区（ST-07、TX-25）。读取失败、空时只留范围。
  const sub = !shown || shown.total === 0 ? range ?? undefined
    : [range, ORDER_TEXT, shown.records.some((row) => row.asOf) ? businessZone().label : null].filter(Boolean).join(" · ");
  const empty = emptyText(band, now, version);
  return (
    <Panel id="k4-accounts" className="k4-accounts" title={panelTitle(band)} icon={band === "STALE" ? Hourglass : List} tone={band === "STALE" ? "progress" : "role-3"}
      explain={bandExplain(band, now, version)} sub={sub} flush>
      <div className="k4-accounts-bands">
        <Segments label="风险档" value={band} onChange={onBand} items={K4_ACCOUNT_BANDS.map((value) => ({ value, label: K4_BAND_NAME[value] }))} />
      </div>
      {state.kind === "loading" ? <BlockState state="loading" title="正在加载…" />
        : state.kind === "error" ? <BlockState state="error" title="账户名单加载失败" detail={state.message} onRetry={onRetry} retryKey="k4-accounts" />
          : state.page.records.length === 0 && state.page.total === 0 ? <BlockState state="empty" title={empty.title} detail={empty.detail} />
            : (
              <>
                <Table label={`${K4_BAND_NAME[band]}账户`} className="k4-account-table">
                  <thead><tr>
                    <Th>账户</Th>
                    <Th align="right">有效分</Th>
                    <Th align="right"><span className="k4-th">系统评分<Explain label="系统评分的说明" content="人工改过分的账户写系统算的分；没改过时有效分就是系统评分，这里写「—」。" /></span></Th>
                    <Th>规则版本</Th>
                    <Th>评分时间</Th>
                    <Th align="right">操作</Th>
                  </tr></thead>
                  <tbody>
                    {state.page.records.length === 0 && <TableMessage columns={6}>这一页没有账户，名单可能刚有变化，请回到第 1 页。</TableMessage>}
                    {state.page.records.map((row) => (
                      <Tr key={row.userNo} selected={row.userNo === highlight} onOpen={() => onOpenUser(row.userNo)}>
                        <Td><Cell mono main={row.userNo} /></Td>
                        <Td align="right">{row.effectiveScore === null
                          ? <span className="k4-unscored">还没有评分</span>
                          : <Cell num main={`${row.effectiveScore} 分`} sub={row.overridden ? <StatusTag tone="warn" icon={PenLine}>人工改分</StatusTag> : undefined} />}</Td>
                        <Td align="right">{!row.scored && row.overridden
                          ? <span className="k4-unscored">还没有评分</span>
                          : <Cell num main={row.overridden && row.modelScore !== null ? `${row.modelScore} 分` : "—"} />}</Td>
                        <Td>{row.scored && row.modelVersion ? <span className="k4-account-version">{versionText(row.modelVersion)}</span> : "—"}</Td>
                        <Td><Cell num main={row.scored && row.asOf ? formatBusinessTimeCompact(row.asOf, "—") : "—"} /></Td>
                        <Td align="right" data-fit=""><Button size="sm" onClick={() => onOpenUser(row.userNo)}>查看评分</Button></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <Pager label={`${K4_BAND_NAME[band]}账户`} total={state.page.total} page={state.page.pageNum} pageSize={state.page.pageSize} sizes={pageSizes}
                  onPage={onPage} onPageSize={onPageSize} />
              </>
            )}
    </Panel>
  );
}
