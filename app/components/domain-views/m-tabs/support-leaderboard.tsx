"use client";

import { useRef, useState, type ReactNode } from "react";
import { ArrowRight, ChevronDown, Info, MapPin } from "lucide-react";
import "./support-leaderboard.css";

export type SupportBoardKey = "firstPayment" | "deposit" | "purchase" | "customers";
export type SupportBoardCoverage = "complete" | "partial" | "unavailable";
export type SupportBoardMovement = { kind: "up" | "down"; places: number; explanation: string } | { kind: "same" | "new" | "unavailable"; explanation: string; label?: string };
export type SupportBoardCount = { value: string | null; coverage: SupportBoardCoverage; reason?: string };
export type SupportBoardAmount = SupportBoardCount & { currency: string; periodLabel: string; sourceVersion: string };
export type SupportBoardRow = {
  id: string; name: string; groupName: string; avatarUrl?: string;
  /** Server-authoritative rank and tie state; never inferred from a page or reference amount. */
  rank: number | null; isTied: boolean; rankStatus: "confirmed" | "provisional" | "unavailable";
  amount: SupportBoardAmount; firstPayment: SupportBoardCount; customers: SupportBoardCount;
  movement: SupportBoardMovement; unavailableReason?: string;
  /** Detail access is explicit; publicly readable aggregate counts grant no access. */
  canViewCustomers: boolean;
};
export type SupportBoardQuery = { board: SupportBoardKey; month: string; scope: string; currency?: string };
export type SupportBoardOption = { value: string; label: string; disabled?: boolean };
export type SupportLeaderboardProps = {
  query: SupportBoardQuery; onQueryChange: (query: SupportBoardQuery) => void;
  monthOptions: SupportBoardOption[]; scopeOptions: SupportBoardOption[]; currencyOptions: SupportBoardOption[];
  rows: SupportBoardRow[]; self?: { row: SupportBoardRow; gap: string | null; reason?: string };
  /** Includes business timezone; reference month is explicit and independent of a hidden historical query. */
  currentMonth: string; periodLabel: string; updatedAt: string; disclosure: string;
  status: "ready" | "loading" | "empty" | "error"; statusMessage?: string; candidateReason?: string;
  onRetry: () => void; onLocateSelf: () => void; onViewPerformance: (id: string) => void;
  onViewCustomers?: (id: string) => void;
  page?: { current: number; total: number; onChange: (page: number) => void };
  navigation?: ReactNode;
};
/** Display only. Integer arithmetic preserves the source decimal; ranks never use this output. */
export function compactSupportBoardValue(value: string | null, kind: "amount" | "count" = "amount"): string {
  if (value === null) return "待核实";
  const parts = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!parts || (kind === "count" && (parts[1] === "-" || /[1-9]/.test(parts[3] || "")))) return "待核实";
  const zero = BigInt(0), ten = BigInt(10), hundred = BigInt(100);
  const whole = BigInt(parts[2]), fraction = parts[3] || "", negative = parts[1] === "-";
  const nonzero = whole !== zero || /[1-9]/.test(fraction);
  if (!nonzero) return "0";
  const sign = negative ? "-" : "";
  if (whole < BigInt(1000)) {
    if (kind === "count") return whole.toString();
    const cents = whole * hundred + BigInt(fraction.slice(0, 2).padEnd(2, "0"));
    if (cents === zero) return negative ? ">-0.01" : "<0.01";
    const rounded = cents + (fraction[2] && fraction[2] >= "5" ? BigInt(1) : zero);
    if (rounded >= BigInt(100000)) return sign + "1K";
    const decimal = (rounded % hundred).toString().padStart(2, "0").replace(/0+$/, "");
    return sign + (rounded / hundred).toString() + (decimal ? "." + decimal : "");
  }
  const units = ["K", "M", "B", "T"], bases = ["1000", "1000000", "1000000000", "1000000000000"].map(BigInt);
  let index = 0;
  while (index < bases.length - 1 && whole >= bases[index + 1]) index++;
  let tenths = (whole * ten + bases[index] / BigInt(2)) / bases[index];
  if (tenths >= BigInt(10000) && index < bases.length - 1) {
    index++;
    tenths = (whole * ten + bases[index] / BigInt(2)) / bases[index];
  }
  return sign + (tenths / ten).toString() + (tenths % ten !== zero ? "." + (tenths % ten).toString() : "") + units[index];
}

const boards: { key: SupportBoardKey; label: string }[] = [
  { key: "firstPayment", label: "首充人数" }, { key: "deposit", label: "充值贡献" },
  { key: "purchase", label: "购机贡献" }, { key: "customers", label: "客户规模" },
];
function BoardSelect({ label, value, options, onChange }: { label: string; value: string; options: SupportBoardOption[]; onChange: (value: string) => void }) {
  const selected = options.find(option => option.value === value)?.label;
  return <label className="sl-select"><span className="sl-sr-only">{label}</span><select aria-label={label} title={selected || "暂无可用筛选项"} disabled={options.length === 0} value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select><span className="sl-selected-value" aria-hidden="true">{selected}</span><ChevronDown size={20} aria-hidden="true" /></label>;
}
function mainMetric(row: SupportBoardRow, board: SupportBoardKey): SupportBoardCount {
  return board === "firstPayment" ? row.firstPayment : board === "customers" ? row.customers : row.amount;
}
function normalMonth(value: string): string | undefined {
  const month = /^(\d{4})[-.](0[1-9]|1[0-2])$/.exec(value);
  return month ? `${month[1]}-${month[2]}` : undefined;
}
function amountState(row: SupportBoardRow, expectedPeriod: string, expectedCurrency?: string) {
  const month = normalMonth(row.amount.periodLabel), expected = normalMonth(expectedPeriod);
  const periodValid = Boolean(month && expected && month === expected);
  const currencyValid = Boolean(expectedCurrency && row.amount.currency && row.amount.currency === expectedCurrency);
  const value = periodValid && currencyValid && row.amount.coverage !== "unavailable" ? row.amount.value : null;
  const periodNote = !periodValid ? (!month ? "统计期缺失或无效" : "统计期不一致")
    : row.amount.coverage === "partial" ? "部分覆盖 · 暂定"
    : row.amount.coverage === "unavailable" || row.amount.value === null ? "金额待核实" : undefined;
  const currencyNote = currencyValid ? undefined : !expectedCurrency ? "统计币种未选择" : !row.amount.currency ? "行币种缺失" : "币种不一致";
  const note = [periodNote, currencyNote].filter(Boolean).join(" · ") || undefined;
  return { periodValid, currencyValid, value, note };
}
function confirmed(row: SupportBoardRow, props: SupportLeaderboardProps) {
  const metric = mainMetric(row, props.query.board);
  const validMainPeriod = props.query.board === "customers" || Boolean(normalMonth(props.periodLabel));
  const amount = props.query.board === "deposit" || props.query.board === "purchase" ? amountState(row, props.periodLabel, props.query.currency) : undefined;
  const validAmountPeriod = !amount || amount.periodValid && amount.currencyValid;
  return validMainPeriod && validAmountPeriod && row.rank !== null && row.rankStatus === "confirmed" && metric.coverage === "complete" && metric.value !== null && !props.candidateReason;
}
function Explanation({ label, summary, explanation, className, wideValue = false }: { label: string; summary: ReactNode; explanation: string; className: string; wideValue?: boolean }) {
  const popupRef = useRef<HTMLDivElement>(null);
  return <details className={className} data-wide-value={wideValue || undefined} onToggle={event => {
    const popup = popupRef.current;
    if (!popup) return;
    if (event.currentTarget.open) {
      popup.showPopover();
      const trigger = event.currentTarget.getBoundingClientRect(), box = popup.getBoundingClientRect();
      popup.style.left = `${Math.max(12, Math.min(trigger.left, window.innerWidth - box.width - 12))}px`;
      popup.style.top = `${trigger.bottom + box.height + 19 <= window.innerHeight ? trigger.bottom + 7 : Math.max(12, trigger.top - box.height - 7)}px`;
    } else if (popup.matches(":popover-open")) popup.hidePopover();
  }} onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
    <summary aria-label={label} title={explanation}>{summary}</summary>
    <div ref={popupRef} popover="manual" className="sl-movement-explanation">{explanation}</div>
  </details>;
}
function Movement({ row, comparable }: { row: SupportBoardRow; comparable: boolean }) {
  const movement: SupportBoardMovement = comparable ? row.movement : { kind: "unavailable", explanation: row.unavailableReason || "当前主指标暂无完整可比名次" };
  const text = movement.kind === "up" || movement.kind === "down" ? `${movement.kind === "up" ? "↑" : "↓"}${movement.places}` : movement.kind === "same" ? "—" : movement.kind === "new" ? "新" : "待比";
  const label = movement.kind === "up" || movement.kind === "down" ? `${movement.kind === "up" ? "上升" : "下降"}${movement.places}位` : movement.kind === "same" ? "持平" : movement.kind === "new" ? "新入榜" : "暂不可比";
  return <Explanation className={`sl-movement sl-movement-${movement.kind}`} label={`${row.name}，${label}，查看名次变化依据`} summary={text} explanation={movement.explanation} />;
}
function NumberValue({ value, kind, label, unit }: { value: string | null; kind: "amount" | "count"; label: string; unit: string }) {
  if (value === null) return <strong>待核实</strong>;
  const explanation = `${label}：${value} ${unit}`;
  const display = compactSupportBoardValue(value, kind);
  return <Explanation className="sl-number-detail" wideValue={display.length > 2} label={`${explanation}，查看完整精确值`} summary={<strong>{display}</strong>} explanation={explanation} />;
}
function Avatar({ row, award, large = false }: { row: SupportBoardRow; award?: number; large?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  return <span className={`sl-avatar${large ? " sl-avatar-large" : ""}`} data-award={award}>
    <span className="sl-avatar-photo">{row.avatarUrl && row.avatarUrl !== failedUrl ? <img src={row.avatarUrl} alt={`${row.name}头像`} onError={() => setFailedUrl(row.avatarUrl)} /> : <span aria-label={`${row.name}姓名占位`}>{Array.from(row.name.trim())[0] || "?"}</span>}</span>
    {award && award <= 3 && <span className="sl-avatar-frame" aria-hidden="true" />}
  </span>;
}
function availableCountValue(metric?: SupportBoardCount) {
  return metric?.coverage === "unavailable" ? null : metric?.value ?? null;
}
function Count({ metric, onView, label = "人数", detailLabel }: { metric: SupportBoardCount; onView?: () => void; label?: string; detailLabel?: string }) {
  const value = availableCountValue(metric);
  const display = compactSupportBoardValue(value, "count");
  return <div className="sl-count" data-wide-value={value !== null && display.length > 2 || undefined} title={metric.reason}>{onView && value !== null ? <strong><button type="button" className="sl-customer-link" aria-label={`${detailLabel || label}，精确人数${value} 人`} title={`${value}人`} onClick={onView}>{display}</button></strong> : <NumberValue value={value} kind="count" label={label} unit="人" />}{metric.coverage === "partial" && value !== null && <small>暂定</small>}</div>;
}
function AmountException({ row, note }: { row: SupportBoardRow; note: string }) {
  const explanation = `${note}。真实统计期：${row.amount.periodLabel || "缺失"}；原始业绩额：${row.amount.value ?? "待核实"} ${row.amount.currency || "币种缺失"}${row.amount.reason ? "；" + row.amount.reason : ""}`;
  return <Explanation className="sl-amount-note" label={`${row.name}，${note}，查看金额依据`} summary={<small>{note}</small>} explanation={explanation} />;
}
function Amount({ row, expectedPeriod, expectedCurrency }: { row: SupportBoardRow; expectedPeriod: string; expectedCurrency?: string }) {
  const state = amountState(row, expectedPeriod, expectedCurrency);
  return <div className="sl-amount" title={state.note || row.amount.reason} data-period={row.amount.periodLabel} data-source={row.amount.sourceVersion} data-currency={row.amount.currency} data-coverage={state.periodValid && state.currencyValid ? row.amount.coverage : "unavailable"}><NumberValue value={state.value} kind="amount" label={`${row.name} · ${row.amount.periodLabel}业绩额`} unit={row.amount.currency} />{state.note && <AmountException row={row} note={state.note} />}</div>;
}
/** Optional isolated preview navigation. Production supplies its authorised shell and identity. */
export function SupportLeaderboardNavigation({ brand, identity, roleLabel, items, demoLabel, onSettings }: { brand: string; identity: string; roleLabel: string; items: { label: string; active?: boolean; onClick: () => void }[]; demoLabel?: string; onSettings: () => void }) {
  return <header className="sl-navigation"><div className="sl-brand"><i aria-hidden="true" /><span data-artwork={brand === "UVEL" || undefined}><span className={brand === "UVEL" ? "sl-sr-only" : undefined}>{brand}</span><small className={brand === "UVEL" ? "sl-sr-only" : undefined}>客户服务工作台</small></span></div><nav aria-label="客服中心">{items.map(item => <button key={item.label} type="button" aria-current={item.active ? "page" : undefined} onClick={item.onClick}>{item.label}</button>)}</nav><div className="sl-account">{demoLabel && <span className="sl-demo">{demoLabel}</span>}<span className="sl-role">{roleLabel}</span><button type="button" onClick={onSettings}>{identity}<ChevronDown size={16} /></button></div></header>;
}
export function SupportLeaderboard(props: SupportLeaderboardProps) {
  const tableRef = useRef<HTMLDivElement>(null);
  const { query, status } = props;
  const self = props.self;
  const ready = status === "ready";
  const disabledReason = status === "loading" ? "请加载完成后切换榜单。" : status === "error" ? "请重试后切换榜单。" : "当前没有可用榜单，暂不能切换。";
  const reference = query.board === "customers";
  const moneyBoard = query.board === "deposit" || query.board === "purchase";
  const statisticsPeriod = reference ? props.currentMonth : props.periodLabel;
  const commonPeriodLabel = `${normalMonth(statisticsPeriod)?.replace("-", ".") || "统计期待核实"}${reference ? " · 参考" : ""}`;
  const changeBoard = (board: SupportBoardKey) => props.onQueryChange({ ...query, board });
  const selfConfirmed = self ? confirmed(self.row, props) : false;
  const selfMetric = self ? mainMetric(self.row, query.board) : undefined;
  const selfUnit = moneyBoard ? query.currency || "币种待核实" : "人";
  const selfAmount = self && moneyBoard ? amountState(self.row, statisticsPeriod, query.currency) : undefined;
  const selfValue = moneyBoard ? selfAmount?.value ?? null : availableCountValue(selfMetric);
  return <div className="support-leaderboard" data-board={query.board}>
    {props.navigation}
    <div className="sl-heading"><div className="sl-title"><h1><span className="sl-sr-only">业绩榜</span></h1><p>PERFORMANCE<br /><span>{props.periodLabel}</span></p></div>
      <div className="sl-tabs" role="tablist" aria-label="榜单类型">{boards.map((board, index) => <button key={board.key} type="button" role="tab" aria-selected={query.board === board.key} disabled={!ready} title={ready ? undefined : disabledReason} tabIndex={query.board === board.key ? 0 : -1} onClick={() => changeBoard(board.key)} onKeyDown={event => {
        const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (offset || event.key === "Home" || event.key === "End") { event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? boards.length - 1 : (index + offset + boards.length) % boards.length; changeBoard(boards[next].key); (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus(); }
      }}>{board.label}</button>)}</div>
      <div className="sl-filters"><BoardSelect label="币种" value={query.currency ?? ""} options={props.currencyOptions} onChange={currency => props.onQueryChange({ ...query, currency })} />{!reference && <BoardSelect label="月份" value={query.month} options={props.monthOptions} onChange={month => props.onQueryChange({ ...query, month })} />}<BoardSelect label="榜单范围" value={query.scope} options={props.scopeOptions} onChange={scope => props.onQueryChange({ ...query, scope })} /></div>
    </div>
    <main className="sl-content" aria-busy={status === "loading"}>
      <section className="sl-self" aria-label="我的进度"><h2>我的进度 <small>{selfUnit}</small></h2>{ready && self ? <><Avatar row={self.row} /><div className="sl-self-name"><strong title={`${self.row.name} · ${self.row.groupName || "待分组"}`}>{self.row.name}</strong><span className="sl-me">我</span><Movement row={self.row} comparable={selfConfirmed} /></div><span className="sl-self-rank">{selfConfirmed ? <>{self.row.isTied ? "并列第" : "第"} <b>{self.row.rank}</b></> : "待核实"}</span><div className="sl-self-score"><NumberValue value={selfValue} kind={moneyBoard ? "amount" : "count"} label={`${self.row.name} · ${moneyBoard ? self.row.amount.periodLabel : reference ? "截至现在" : statisticsPeriod}本人成绩`} unit={selfUnit || ""} />{selfAmount?.note && <AmountException row={self.row} note={selfAmount.note} />}{!moneyBoard && selfMetric?.coverage === "partial" && selfValue !== null && <Explanation className="sl-amount-note" label={`${self.row.name}，人数暂定，查看依据`} summary={<small>暂定</small>} explanation={selfMetric.reason || "人数来源尚未完整，当前结果暂定"} />}</div><button type="button" className="sl-locate" onClick={() => { props.onLocateSelf(); tableRef.current?.focus({ preventScroll: true }); }}><MapPin size={22} fill="currentColor" strokeWidth={0} aria-hidden="true" />定位我</button></> : <p>{ready ? "当前账号未参榜" : status === "loading" ? "正在加载成绩…" : "暂无可用成绩"}</p>}</section>
      {props.candidateReason && <p className="sl-provisional">暂定：{props.candidateReason}</p>}
      {ready ? <div className="sl-table-wrap" ref={tableRef} tabIndex={-1}><table className="sl-table"><colgroup><col className="sl-col-rank" /><col className="sl-col-person" /><col className="sl-col-amount" /><col className="sl-col-count" /><col className="sl-col-bindings" /><col className="sl-col-action" /></colgroup><thead><tr><th>排名</th><th>姓名 / 组名</th><th data-primary={query.board === "deposit" || query.board === "purchase" || undefined}>业绩额<small>{query.currency || "币种待核实"} · {commonPeriodLabel}</small></th><th data-primary={query.board === "firstPayment" || undefined}>首充人数<small>人 · {commonPeriodLabel}</small></th><th data-primary={query.board === "customers" || undefined}>绑定客户数<small>人 · 截至现在</small></th><th>操作</th></tr></thead><tbody>{props.rows.map((row, index) => {
        const comparable = confirmed(row, props), award = comparable && row.rank !== null ? row.rank : undefined;
        const champion = award === 1;
        const rankSprite = award === 1 || award === 2 || award === 3 || award === 5 || award === 6;
        return <tr key={row.id} data-rank={award} data-self={row.id === self?.row.id || undefined} data-index={index}>
          <td className="sl-rank-cell">{rankSprite && <span className="sl-rank-sprite" aria-hidden="true" />}<span className={rankSprite ? "sl-sr-only" : "sl-rank-text"}>{comparable ? `${row.isTied ? "并列第" : "第"}${row.rank}名` : "待核实"}</span></td>
          <td className="sl-person-cell"><div className="sl-person"><button type="button" className="sl-avatar-button" aria-label={`查看${row.name}成绩`} onClick={() => props.onViewPerformance(row.id)}><Avatar row={row} award={award} large={champion} /></button><div className="sl-person-text"><div className="sl-person-name"><button type="button" title={`${row.name} · ${row.groupName || "待分组"}`} onClick={() => props.onViewPerformance(row.id)}>{row.name}</button><Movement row={row} comparable={comparable} /></div><small className="sl-group" title={row.groupName || "待分组"}>{row.groupName || "待分组"}</small>{champion && <span className="sl-rank-badge">{row.isTied ? "并列第1" : "本榜第1"}</span>}</div></div></td>
          <td data-metric="amount" data-primary={query.board === "deposit" || query.board === "purchase" || undefined}><Amount row={row} expectedPeriod={statisticsPeriod} expectedCurrency={query.currency} /></td><td data-metric="firstPayment" data-primary={query.board === "firstPayment" || undefined}><Count metric={row.firstPayment} label={`${row.name} · ${statisticsPeriod}首充人数`} /></td><td data-metric="customers" data-primary={query.board === "customers" || undefined}><Count metric={row.customers} onView={row.canViewCustomers && props.onViewCustomers ? () => props.onViewCustomers?.(row.id) : undefined} label={`${row.name}当前绑定客户数`} detailLabel={`查看${row.name}的当前绑定客户明细`} /></td><td><button type="button" className="sl-view" onClick={() => props.onViewPerformance(row.id)}>查看成绩<ArrowRight size={18} aria-hidden="true" /><span className="sl-sr-only">：{row.name}</span></button></td>
        </tr>;
      })}</tbody></table></div> : <div className="sl-status" role={status === "error" ? "alert" : "status"}><p>{props.statusMessage || (status === "loading" ? "正在加载榜单…" : status === "empty" ? "暂无符合参榜资格的客服" : "榜单加载失败")} {disabledReason}</p>{status === "error" && <button type="button" onClick={props.onRetry}>重试</button>}</div>}
      {ready && props.page && props.page.total > 1 && <nav className="sl-pagination" aria-label="榜单分页"><button type="button" disabled={props.page.current === 1} onClick={() => props.page?.onChange(props.page.current - 1)}>上一页</button><span>第 {props.page.current} / {props.page.total} 页</span><button type="button" disabled={props.page.current === props.page.total} onClick={() => props.page?.onChange(props.page.current + 1)}>下一页</button></nav>}
      <footer className="sl-footer"><span><Info size={19} aria-hidden="true" />{props.disclosure}</span><time>数据截至 {props.updatedAt}</time></footer>
    </main>
  </div>;
}
