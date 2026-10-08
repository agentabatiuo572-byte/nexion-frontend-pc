import { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { SupportLeaderboard, SupportLeaderboardNavigation, compactSupportBoardValue, type SupportBoardQuery, type SupportBoardRow } from "../../../app/components/domain-views/m-tabs/support-leaderboard";

declare global { interface Window { fixtureAvatars: Record<string, string>; fixtureMode: string; fixtureEvents: string[]; renderLeaderboardFixture: (mode: string) => void; fixtureTransform?: (rows: SupportBoardRow[]) => SupportBoardRow[]; compactSupportBoardValue: typeof compactSupportBoardValue; } }
const people = [
  ["zhou", "周芷宁", "海岚组", 1, 20], ["yang", "杨帆", "海岚组", 2, 18], ["zhang", "张晓雨", "星河组", 3, 12],
  ["mia", "Mia", "星河组", 3, 12], ["wang", "王浩然", "晨光组", 5, 9], ["li", "李思琪", "晨光组", 6, 7], ["chen", "陈子航", "晨光组", 6, 7],
] as const;
const baseRows: SupportBoardRow[] = people.map(([id, name, groupName, rank, score]) => ({
  id, name, groupName, rank, isTied: rank === 3 || rank === 6, rankStatus: "confirmed", canViewCustomers: id === "mia",
  amount: { value: String(score * 1000), currency: "USDT", periodLabel: "2026.10", coverage: "complete", sourceVersion: "fixture-deposit-20261007" },
  firstPayment: { value: String(score), coverage: "complete" }, customers: { value: String(score * 2), coverage: "complete" },
  movement: id === "zhou" ? { kind: "up", places: 1, explanation: "昨日第2名，当前第1名；基线10-06 23:50，均为已完整发布" } : id === "mia" ? { kind: "up", places: 2, explanation: "昨日第5名，当前并列第3名；同分占位按真实竞争名次" } : id === "yang" || id === "wang" ? { kind: "down", places: 1, explanation: "较昨日末下降1位；以该指标完整昨日基线比较" } : id === "li" ? { kind: "new", explanation: "上一完整发布后取得参榜资格，不虚构此前名次" } : id === "chen" ? { kind: "unavailable", explanation: "缺少完整昨日末比较基线，请等待下一次完整发布" } : { kind: "same", explanation: "与昨日完整发布的竞争名次一致" },
}));
function Fixture({ mode }: { mode: string }) {
  const moneyMode = mode === "long" || mode.startsWith("money-") || mode === "big-gap" || mode === "compact-ranking" || mode === "tiny-amount";
  const [query, setQuery] = useState<SupportBoardQuery>({ board: moneyMode ? "deposit" : "firstPayment", month: "2026-10", scope: "all", currency: mode === "currency-query-missing" ? undefined : "USDT" });
  const amountMonth = query.board === "customers" ? "2026.10" : query.month === "2026-09" ? "2026.09" : "2026.10";
  let rows: SupportBoardRow[] = baseRows.map(row => ({ ...row, avatarUrl: window.fixtureAvatars[row.id], amount: { ...row.amount, currency: query.currency || "USDT", periodLabel: amountMonth } }));
  if (mode.startsWith("currency-")) rows = rows.map(row => ({ ...row, amount: { ...row.amount, currency: mode === "currency-row-missing" ? "" : mode === "currency-wrong" || mode === "currency-self-wrong" && row.id === "mia" ? query.currency === "NEX" ? "USDT" : "NEX" : row.amount.currency } }));
  if (mode.startsWith("period-")) rows = rows.map(row => ({ ...row, amount: { ...row.amount,
    periodLabel: mode === "period-same-dash" ? amountMonth.replace(".", "-") : mode === "period-different" ? amountMonth === "2026.10" ? "2026.09" : "2026.10" : mode === "period-missing" ? "" : mode === "period-invalid" ? "2026.99" : row.amount.periodLabel,
    coverage: mode === "period-partial" ? "partial" : mode === "period-unavailable" ? "unavailable" : row.amount.coverage,
    value: mode === "period-null" ? null : row.amount.value,
  } }));
  if (mode === "long") rows = rows.map((row, i) => ({ ...row, name: row.name + " · Alexander-William-Montgomery", groupName: row.groupName + " · 客户运营与维护团队的长名称", amount: { ...row.amount, value: ["987654321012345.99", "987654321010000.01", "987654321000000.01", "987654321000000.01", "987654320000000.01", "987650000000000.01", "987650000000000.01"][i] } }));
  if (mode.startsWith("money-")) rows = rows.map((row, index) => ({ ...row, amount: { ...row.amount, value: mode === "money-decimal" ? String(Number(row.firstPayment.value)).concat(".00") : String(Number(row.firstPayment.value) * 10 ** (Number(mode.slice(6)) - 2)) } }));
  if (mode === "compact-ranking") rows = rows.map((row, i) => ({ ...row, amount: { ...row.amount, value: ["1240", "1239.99", "1230", "1230", "1000", "999.99", "999.99"][i] } }));
  if (mode === "tiny-amount") rows = rows.map((row, i) => ({ ...row, amount: { ...row.amount, value: ["0.009", "0.008", "0.007", "0.007", "0.006", "0", "0"][i] } }));
  if (mode === "ties") rows = [{ ...rows[0], isTied: true }, ...Array.from({ length: 8 }, (_, i) => ({ ...rows[0], id: `tie-${i}`, name: `并列客服${i + 1}`, isTied: true })), ...rows.slice(1).map(row => ({ ...row, rank: ({ 2: 10, 3: 11, 5: 13, 6: 14 } as Record<number, number>)[row.rank!] }))];
  let offPageSelf: SupportBoardRow | undefined;
  if (mode === "self-offpage") { offPageSelf = rows.find(row => row.id === "mia"); rows = rows.filter(row => row.id !== "mia"); }
  if (mode === "few") rows = rows.slice(0, 1);
  if (mode === "bindings-unknown") rows = rows.map(row => ({ ...row, customers: { value: null, coverage: "unavailable", reason: "当前绑定来源暂无覆盖" } }));
  if (mode === "counts-unavailable-stale" || mode === "counts-partial") rows = rows.map(row => ({ ...row,
    firstPayment: { ...row.firstPayment, coverage: mode === "counts-partial" ? "partial" : "unavailable", reason: "首充来源覆盖待核对" },
    customers: { ...row.customers, coverage: mode === "counts-partial" ? "partial" : "unavailable", reason: "绑定来源覆盖待核对" },
  }));
  if (mode === "bindings-long") rows = rows.map(row => ({ ...row, customers: { value: "987654321012345", coverage: "complete" } }));
  if (mode === "permission-all") rows = rows.map(row => ({ ...row, canViewCustomers: true }));
  if (mode === "permission-none") rows = rows.map(row => ({ ...row, canViewCustomers: false }));
  if (mode === "cross-page-tie") rows = rows.filter(row => row.id !== "chen");
  if (mode === "big-gap") rows = rows.map(row => ({ ...row, amount: { ...row.amount, value: row.id === "zhou" ? "2000000000000000" : row.id === "yang" ? "987654321012357.99" : row.amount.value } }));
  if (mode === "zero") rows = rows.map(row => ({ ...row, rank: 1, isTied: true, amount: { ...row.amount, value: "0" }, firstPayment: { ...row.firstPayment, value: "0" }, customers: { ...row.customers, value: "0" }, movement: { kind: "same", explanation: "全部真实0，同档并列第1，不发布虚假升降" } }));
  if (mode === "avatar-failed") rows = rows.map(row => ({ ...row, avatarUrl: "data:image/png;base64,INVALID" }));
  if (mode === "avatar-none") rows = rows.map(row => ({ ...row, avatarUrl: undefined }));
  if (mode === "identity-change") rows = rows.map(row => ({ ...row, name: "替换身份" + row.id, groupName: "", avatarUrl: undefined }));
  if (mode === "reference-unknown") rows = rows.map(row => ({ ...row, amount: { ...row.amount, value: null, coverage: "unavailable", reason: "参考退款源暂无覆盖" } }));
  if (mode === "unknown") rows = rows.map(row => ({ ...row, rank: null, rankStatus: "unavailable", firstPayment: { value: null, coverage: "unavailable", reason: "主指标源暂无覆盖" }, amount: { ...row.amount, value: null, coverage: "unavailable" }, unavailableReason: "主指标源暂无覆盖" }));
  if (query.month === "2026-09" && query.board !== "customers") rows = rows.map(row => ({ ...row, movement: { kind: "unavailable", explanation: "历史月份不发布相对昨日的升降" } }));
  if (window.fixtureTransform) rows = window.fixtureTransform(rows);
  const onEvent = (event: string) => window.fixtureEvents.push(event);
  const self = offPageSelf || rows.find(row => row.id === (mode === "cross-page-tie" ? "li" : "mia"));
  return <SupportLeaderboard query={query} onQueryChange={next => { setQuery(next); onEvent(`query:${JSON.stringify(next)}`); }}
    monthOptions={[{ value: "2026-10", label: "本月" }, { value: "2026-09", label: "上月" }, { value: "disabled", label: "未覆盖月份", disabled: true }, { value: "long", label: "2026年10月 · 完整发布后的历史月份长选项" }]}
    scopeOptions={[{ value: "all", label: "全员" }, { value: "mine", label: "本人所在组" }, { value: "long", label: "负责组 · 星河客户运营与维护团队长名称" }]}
    currencyOptions={[{ value: "USDT", label: "USDT" }, { value: "NEX", label: "NEX" }]}
    rows={rows} self={self ? { row: self, gap: mode === "big-gap" ? "987654321012345.99" : "6" } : undefined}
    currentMonth={mode === "period-header-missing" ? "" : "2026.10"} periodLabel={mode === "period-header-missing" ? "" : query.board === "customers" ? "截至现在" : amountMonth} updatedAt="10-07 13:00（模拟）" disclosure="排名公开，客户明细仍按权限查看"
    status={mode === "empty" ? "empty" : mode === "loading" ? "loading" : mode === "error" ? "error" : "ready"}
    candidateReason={mode === "unknown" ? "主指标覆盖不足" : undefined}
    onRetry={() => onEvent("retry")} onLocateSelf={() => onEvent(`locate:${self?.id}`)} onViewPerformance={id => onEvent(`view:${id}`)} onViewCustomers={id => onEvent(`customers:${id}`)}
    page={mode === "page" ? { current: 2, total: 3, onChange: page => onEvent(`page:${page}`) } : undefined}
    navigation={<SupportLeaderboardNavigation brand={mode === "brand-other" ? "Other Brand" : "UVEL"} identity={mode === "identity-change" ? "专属客服：替换身份mia" : "专属客服：Mia"} roleLabel="角色" demoLabel="设计演示 · 无真实数据" items={["工作台", "客户列表", "即时会话", "业绩榜", "分组看板", "服务规则"].map(label => ({ label, active: label === "业绩榜", onClick: () => onEvent(`nav:${label}`) }))} onSettings={() => onEvent("settings")} />}
  />;
}
const root = createRoot(document.getElementById("root")!);
let serial = 0;
window.renderLeaderboardFixture = mode => { window.fixtureMode = mode; flushSync(() => root.render(<Fixture key={++serial} mode={mode} />)); };
window.fixtureEvents = [];
window.compactSupportBoardValue = compactSupportBoardValue;
window.renderLeaderboardFixture("baseline");
