"use client";

import { nexGridBrandText } from "@/lib/admin/brand-copy";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ChevronDown, Home, Users, MessageSquareMore, ChartNoAxesColumn, LayoutGrid, FileText, MapPin } from "lucide-react";
import "./support-leaderboard.css";

export type SupportBoardKey = "netContribution" | "firstPayment" | "customers";
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
  selfUnavailableReason?: string;
  /** Published global summary, independent of keyword and paginated rows; total includes omitted ties. */
  podium?: { rows: SupportBoardRow[]; total: number };
  onViewAllRankings?: () => void;
  /** Includes business timezone; reference month is explicit and independent of a hidden historical query. */
  currentMonth: string; periodLabel: string; updatedAt: string; disclosure: string;
  status: "ready" | "loading" | "empty" | "error"; statusMessage?: string; candidateReason?: string;
  onRetry: () => void; onLocateSelf: () => void; onViewPerformance: (id: string) => void;
  onViewCustomers?: (id: string) => void;
  page?: { current: number; total: number; onChange: (page: number) => void; totalEntries?: number; pageSize?: number; onPageSizeChange?: (size: number) => void };
  navigation?: ReactNode;
  search?: ReactNode;
  notice?: ReactNode;
};
/** Display only. Integer arithmetic preserves the source decimal; ranks never use this output. */
export function compactSupportBoardValue(value: unknown, kind: "amount" | "count" = "amount"): string {
  if (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) return "-";
  let decimal = String(value);
  if (typeof value === "number" && decimal.includes("e")) {
    const [coefficient, exponent] = decimal.split("e"), negative = coefficient.startsWith("-");
    const digits = coefficient.replace(/[-.]/g, ""), point = coefficient.replace("-", "").split(".")[0].length + Number(exponent);
    decimal = (negative ? "-" : "") + (point <= 0 ? "0." + "0".repeat(-point) + digits : point >= digits.length ? digits + "0".repeat(point - digits.length) : digits.slice(0, point) + "." + digits.slice(point));
  }
  const parts = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (!parts || (kind === "count" && (parts[1] === "-" || /[1-9]/.test(parts[3] || "")))) return "-";
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
  { key: "netContribution", label: "净贡献额" }, { key: "firstPayment", label: "首充人数" },
  { key: "customers", label: "客户规模" },
];
function BoardSelect({ label, value, options, onChange }: { label: string; value: string; options: SupportBoardOption[]; onChange: (value: string) => void }) {
  const selected = options.find(option => option.value === value)?.label;
  return <label className="sl-select"><span className="sl-sr-only">{label}</span><select aria-label={label} title={selected || "暂无可用筛选项"} disabled={options.length === 0} value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></label>;
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
    : row.amount.coverage === "partial" ? "暂定"
    : row.amount.coverage === "unavailable" || row.amount.value === null ? "金额未同步" : undefined;
  const currencyNote = currencyValid ? undefined : !expectedCurrency ? "请选择统计币种" : !row.amount.currency ? "币种未同步" : "币种不一致";
  const note = [periodNote, currencyNote].filter(Boolean).join(" · ") || undefined;
  return { periodValid, currencyValid, value, note };
}
function confirmed(row: SupportBoardRow, props: SupportLeaderboardProps) {
  const metric = mainMetric(row, props.query.board);
  const validMainPeriod = props.query.board === "customers" || Boolean(normalMonth(props.periodLabel));
  const amount = props.query.board === "netContribution" ? amountState(row, props.periodLabel, props.query.currency) : undefined;
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
  const movement: SupportBoardMovement = comparable ? row.movement : { kind: "unavailable", explanation: row.unavailableReason || "当前名次暂不可比" };
  const text = movement.kind === "up" || movement.kind === "down" ? `${movement.kind === "up" ? "↑" : "↓"}${movement.places}` : movement.kind === "same" ? "—" : movement.kind === "new" ? "新" : "-";
  const label = movement.kind === "up" || movement.kind === "down" ? `${movement.kind === "up" ? "上升" : "下降"}${movement.places}位` : movement.kind === "same" ? "持平" : movement.kind === "new" ? "新入榜" : "暂不可比";
  return <Explanation className={`sl-movement sl-movement-${movement.kind}`} label={`${row.name}，${label}，查看名次变化依据`} summary={text} explanation={movement.explanation} />;
}
export function NumberValue({ value, kind, label, unit }: { value: string | null; kind: "amount" | "count"; label: string; unit: string }) {
  const display = compactSupportBoardValue(value, kind);
  if (display === "-") return <strong>-</strong>;
  const explanation = `${label}：${value} ${unit}`;
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
  return <div className="sl-count" data-wide-value={display !== "-" && display.length > 2 || undefined} title={metric.reason}>{onView && display !== "-" ? <strong><button type="button" className="sl-customer-link" aria-label={`${detailLabel || label}，精确人数${value} 人`} title={`${value}人`} onClick={onView}>{display}</button></strong> : <NumberValue value={value} kind="count" label={label} unit="人" />}{metric.coverage === "partial" && display !== "-" && <small>暂定</small>}</div>;
}
function AmountException({ row, note }: { row: SupportBoardRow; note: string }) {
  const explanation = `${note}${row.amount.reason ? "。" + row.amount.reason : ""}。请重新加载榜单。`;
  return <Explanation className="sl-amount-note" label={`${row.name}，${note}，查看金额依据`} summary={<small>{note}</small>} explanation={explanation} />;
}
function Amount({ row, expectedPeriod, expectedCurrency }: { row: SupportBoardRow; expectedPeriod: string; expectedCurrency?: string }) {
  const state = amountState(row, expectedPeriod, expectedCurrency);
  return <div className="sl-amount" title={state.note || row.amount.reason} data-period={row.amount.periodLabel} data-source={row.amount.sourceVersion} data-currency={row.amount.currency} data-coverage={state.periodValid && state.currencyValid ? row.amount.coverage : "unavailable"}><NumberValue value={state.value} kind="amount" label={`${row.name} · ${row.amount.periodLabel}业绩额`} unit={nexGridBrandText(row.amount.currency)} />{state.note && state.note !== "金额未同步" && <AmountException row={row} note={state.note} />}</div>;
}
/** Optional isolated preview navigation. Production supplies its authorised shell and identity. */
export function SupportLeaderboardNavigation({ brand, identity, avatarUrl, roleLabel, items, demoLabel, onSettings }: { brand: string; identity: string; avatarUrl?: string; roleLabel: string; items: { label: string; active?: boolean; onClick: () => void }[]; demoLabel?: string; onSettings: () => void }) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => { setAvatarFailed(false); }, [avatarUrl, identity]);
  const icons = [Home, Users, MessageSquareMore, ChartNoAxesColumn, LayoutGrid, FileText];
  return <header className="sl-navigation"><div className="sl-brand"><span>{brand}</span><small>客户服务工作台</small></div><nav aria-label="客服中心">{items.map((item, index) => { const Icon = icons[index] || LayoutGrid; return <button key={item.label} type="button" aria-current={item.active ? "page" : undefined} onClick={item.onClick}><Icon size={24} aria-hidden="true" />{item.label}</button>; })}</nav><div className="sl-account"><button type="button" onClick={onSettings}><span className="sl-account-avatar" role="img" aria-label={`${identity}头像`}>{avatarUrl && !avatarFailed ? <img src={avatarUrl} alt="" onError={() => setAvatarFailed(true)} /> : identity.slice(0, 1)}</span><span>{identity}</span><small>{roleLabel}</small></button>{demoLabel && <span className="sl-demo">{demoLabel}</span>}</div></header>;
}
export function SupportLeaderboard(props: SupportLeaderboardProps) {
  const tableRef = useRef<HTMLDivElement>(null), heroRef = useRef<HTMLElement>(null);
  const [motionVisible, setMotionVisible] = useState(false);
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    let inView = false;
    const update = () => setMotionVisible(inView && document.visibilityState === "visible");
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; update(); });
    observer.observe(hero);
    document.addEventListener("visibilitychange", update);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, []);
  const { query, status } = props, self = props.self, ready = status === "ready";
  const disabledReason = status === "loading" ? "请加载完成后切换榜单。" : status === "error" ? "请重试后切换榜单。" : "当前没有可用榜单，暂不能切换。";
  const reference = query.board === "customers", moneyBoard = query.board === "netContribution";
  const statisticsPeriod = reference ? props.currentMonth : props.periodLabel;
  const commonPeriodLabel = `${normalMonth(statisticsPeriod)?.replace("-", ".") || "统计期未确定"}${reference ? " · 参考" : ""}`;
  const changeBoard = (board: SupportBoardKey) => props.onQueryChange({ ...query, board });
  const selfConfirmed = self ? confirmed(self.row, props) : false;
  const selfMetric = self ? mainMetric(self.row, query.board) : undefined;
  const selfUnit = moneyBoard ? nexGridBrandText(query.currency || "币种未同步") : "人";
  const selfAmount = self && moneyBoard ? amountState(self.row, statisticsPeriod, query.currency) : undefined;
  const selfValue = moneyBoard ? selfAmount?.value ?? null : availableCountValue(selfMetric);
  // Only the published global summary can grant a podium; page rows never fill missing slots.
  const podiumRows = ready ? (props.podium?.rows || []).filter(row => confirmed(row, props) && row.rank !== null && row.rank >= 1 && row.rank <= 3).slice(0, 4) : [];
  const remainingPodium = podiumRows.length ? Math.max(0, (props.podium?.total || 0) - podiumRows.length) : 0;
  const viewAllRankings = () => { if (props.onViewAllRankings) props.onViewAllRankings(); else props.page?.onChange(1); tableRef.current?.scrollIntoView({ block: "start", behavior: "auto" }); tableRef.current?.focus({ preventScroll: true }); };
  const pageSize = props.page?.pageSize || 5, totalEntries = props.page?.totalEntries;
  const start = (props.page?.current ? props.page.current - 1 : 0) * pageSize + 1;
  return <div className="support-leaderboard" data-board={query.board} data-preview={Boolean(props.navigation) || undefined}>
    {props.navigation}
    <main className="sl-content" aria-busy={status === "loading"}>
      <header className="sl-heading"><h1>业绩榜</h1><div className="sl-filters"><BoardSelect label="币种" value={query.currency ?? ""} options={props.currencyOptions} onChange={currency => props.onQueryChange({ ...query, currency })} />{!reference && <BoardSelect label="月份" value={query.month} options={props.monthOptions} onChange={month => props.onQueryChange({ ...query, month })} />}<BoardSelect label="榜单范围" value={query.scope} options={props.scopeOptions} onChange={scope => props.onQueryChange({ ...query, scope })} /></div>{props.search}</header>
      <div className="sl-tabs" role="tablist" aria-label="榜单类型">{boards.map((board, index) => <button key={board.key} type="button" role="tab" aria-selected={query.board === board.key} disabled={!ready} title={ready ? undefined : disabledReason} tabIndex={query.board === board.key ? 0 : -1} onClick={() => changeBoard(board.key)} onKeyDown={event => {
        const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (offset || event.key === "Home" || event.key === "End") { event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? boards.length - 1 : (index + offset + boards.length) % boards.length; changeBoard(boards[next].key); (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus(); }
      }}>{board.label}</button>)}</div>
      {props.notice}
      <section className={`sl-hero sl-hero-compact${!ready || self ? "" : " no-self"}`} ref={heroRef} data-motion={motionVisible ? "running" : "paused"} aria-label="前三名与我的进度">
        
        <div className="sl-podium"><div className="sl-podium-heading"><h2>前三名</h2><p>{commonPeriodLabel} · {nexGridBrandText(query.currency || "币种未同步")} · 人数单位：人 · 绑定客户数截至现在</p></div>
          {podiumRows.length > 0 ? <ol className="sl-podium-strip">{podiumRows.map(row => <li key={row.id} className="sl-podium-chip" data-rank={row.rank} aria-label={`${row.name}，${row.isTied ? "并列第" : "第"}${row.rank}名`}>
            <span className="sl-podium-chip-rank">{row.isTied ? "并列" : ""}{row.rank}</span>
            <button type="button" className="sl-podium-chip-person" onClick={() => props.onViewPerformance(row.id)}><Avatar row={row} award={row.rank!} /><span><strong>{row.name}</strong><small>{row.groupName || "未分组"}</small></span></button>
            <div className="sl-podium-chip-metrics"><div><Amount row={row} expectedPeriod={statisticsPeriod} expectedCurrency={query.currency} /><small>业绩额</small></div><div><Count metric={row.firstPayment} label={`${row.name} · ${statisticsPeriod}首充人数`} /><small>首充</small></div><div><Count metric={row.customers} label={`${row.name} · 绑定客户`} /><small>绑定客户</small></div></div>
          </li>)}</ol> : <div className="sl-podium-status" role="status">{status === "loading" ? "正在加载全局前三名…" : !ready ? "当前暂无可用前三名" : props.candidateReason ? "前三名暂未确认" : props.podium ? "当前没有已确认的前三名" : "前三名暂不可用，请重试"}</div>}
          {remainingPodium > 0 && <button type="button" className="sl-more-ties" onClick={viewAllRankings}>还有{remainingPodium}位并列，查看全部排名<ArrowRight size={14} aria-hidden="true" /></button>}
        </div>
        {(!ready || self) && <aside className="sl-self" aria-label="我的进度"><h2>我的进度</h2>{ready && self ? <><Avatar row={self.row} award={selfConfirmed ? self.row.rank || undefined : undefined} /><strong className="sl-self-name" title={self.row.name}>{self.row.name}</strong><small>专属客服</small><div className="sl-self-standing"><span className="sl-self-rank">{selfConfirmed ? <>{self.row.isTied ? "并列第" : "第"} <b>{self.row.rank}</b></> : "-"}</span><Movement row={self.row} comparable={selfConfirmed} /></div><div className="sl-self-score"><span>{boards.find(board => board.key === query.board)?.label}（{selfUnit} · {reference ? "截至现在" : commonPeriodLabel}）</span><div><NumberValue value={selfValue} kind={moneyBoard ? "amount" : "count"} label={`${self.row.name} · ${moneyBoard ? self.row.amount.periodLabel : reference ? "截至现在" : statisticsPeriod}本人成绩`} unit={selfUnit} /></div>{selfAmount?.note && <AmountException row={self.row} note={selfAmount.note} />}{!moneyBoard && selfMetric?.coverage === "partial" && selfValue !== null && <Explanation className="sl-amount-note" label={`${self.row.name}，人数暂定，查看依据`} summary={<small>暂定</small>} explanation={selfMetric.reason || "人数暂定，请稍后重新加载"} />}</div><button type="button" className="sl-locate" onClick={() => { props.onLocateSelf(); tableRef.current?.focus({ preventScroll: true }); }}><MapPin size={20} aria-hidden="true" />定位我</button></> : <p>{ready ? props.selfUnavailableReason || "本人成绩暂不可用" : status === "loading" ? "正在加载成绩…" : "暂无可用成绩"}</p>}</aside>}
        {/* M-45: without a personal row the full panel is dropped, but the reason still has to be visible. */}
        {ready && !self && <div className="sl-self-note"><p>{props.selfUnavailableReason || "本人成绩暂不可用"}</p></div>}
      </section>
      {props.candidateReason && <p className="sl-provisional">暂定：{props.candidateReason}</p>}
      {ready && query.board === "netContribution" && props.rows.some(row => row.amount.coverage === "unavailable" || row.amount.value === null) && <p className="sl-provisional">部分客服的业绩额缺少资金数据（客户充值、提现记录未同步），这些单元格留空；其余指标照常排名。</p>}
      <section className="sl-rankings" aria-label="全部排名"><h2>全部排名</h2>
      {ready ? <div className="sl-table-wrap" ref={tableRef} tabIndex={-1}><table className="sl-table"><colgroup><col className="sl-col-rank" /><col className="sl-col-person" /><col className="sl-col-amount" /><col className="sl-col-count" /><col className="sl-col-bindings" /><col className="sl-col-action" /></colgroup><thead><tr><th>排名</th><th>姓名、组名 / 排名变化</th><th data-primary={moneyBoard || undefined}>业绩额<small>{nexGridBrandText(query.currency || "币种未同步")} · {commonPeriodLabel}</small></th><th data-primary={query.board === "firstPayment" || undefined}>首充人数<small>人 · {commonPeriodLabel}</small></th><th data-primary={query.board === "customers" || undefined}>绑定客户数<small>人 · 截至现在</small></th><th>操作</th></tr></thead><tbody>{props.rows.map((row, index) => {
        const comparable = confirmed(row, props), award = comparable && row.rank !== null ? row.rank : undefined;
        return <tr key={row.id} data-rank={award} data-self={row.id === self?.row.id || undefined} data-index={index}>
          <td className="sl-rank-cell"><span className="sl-rank-text">{comparable ? <>{row.isTied && <small>并列 </small>}{String(row.rank).padStart(2, "0")}</> : "-"}</span><span className="sl-sr-only">{comparable ? `第${row.rank}名` : row.unavailableReason}</span></td>
          <td className="sl-person-cell"><div className="sl-person"><button type="button" className="sl-avatar-button" aria-label={`查看${row.name}成绩`} onClick={() => props.onViewPerformance(row.id)}><Avatar row={row} award={row.id === self?.row.id ? award : undefined} /></button><div className="sl-person-text"><div className="sl-person-name"><button type="button" title={`${row.name} · ${row.groupName || "待分组"}`} onClick={() => props.onViewPerformance(row.id)}>{row.name}</button>{row.id === self?.row.id && <span className="sl-me">我</span>}<Movement row={row} comparable={comparable} /></div><small className="sl-group" title={row.groupName || "待分组"}>{row.groupName || "待分组"}</small></div></div></td>
          <td data-metric="amount"><Amount row={row} expectedPeriod={statisticsPeriod} expectedCurrency={query.currency} /></td><td data-metric="firstPayment"><Count metric={row.firstPayment} label={`${row.name} · ${statisticsPeriod}首充人数`} /></td><td data-metric="customers"><Count metric={row.customers} onView={row.canViewCustomers && props.onViewCustomers ? () => props.onViewCustomers?.(row.id) : undefined} label={`${row.name}当前绑定客户数`} detailLabel={`查看${row.name}的当前绑定客户明细`} /></td><td><button type="button" className="sl-view" onClick={() => props.onViewPerformance(row.id)}>查看成绩<ArrowRight size={18} aria-hidden="true" /><span className="sl-sr-only">：{row.name}</span></button></td>
        </tr>;
      })}</tbody></table></div> : <div className="sl-status" role={status === "error" ? "alert" : "status"}><p>{props.statusMessage || (status === "loading" ? "正在加载榜单…" : status === "empty" ? "暂无符合参榜资格的客服" : "榜单加载失败")} {disabledReason}</p>{status === "error" && <button type="button" onClick={props.onRetry}>重试</button>}</div>}
      {ready && props.page && <nav className="sl-pagination" aria-label="榜单分页"><span className="sl-page-summary">{props.rows.length > 0 ? `显示 ${start}–${start + props.rows.length - 1}` : "暂无记录"}{totalEntries !== undefined ? `，共 ${totalEntries} 人` : ` · 第 ${props.page.current} / ${props.page.total} 页`}</span>{props.page.onPageSizeChange && <BoardSelect label="每页条数" value={String(pageSize)} options={[5, 10, 20].map(size => ({ value: String(size), label: `每页 ${size} 条` }))} onChange={value => props.page?.onPageSizeChange?.(Number(value))} />}<div className="sl-page-buttons"><button type="button" disabled={props.page.current <= 1} onClick={() => props.page?.onChange(props.page.current - 1)}>上一页</button>{[props.page.current - 1, props.page.current, props.page.current + 1].filter(page => page >= 1 && page <= props.page!.total).map(page => <button key={page} type="button" className="sl-page-number" aria-current={page === props.page?.current ? "page" : undefined} onClick={() => props.page?.onChange(page)}>{page}</button>)}<button type="button" disabled={props.page.current >= props.page.total} onClick={() => props.page?.onChange(props.page.current + 1)}>下一页<ArrowRight size={14} aria-hidden="true" /></button></div></nav>}
      </section>
      <footer className="sl-footer"><span>{props.disclosure}</span><span className="sl-footer-meta"><time>数据截至 {props.updatedAt}</time>{props.navigation && <span>演示数据</span>}</span></footer>
    </main>
  </div>;
}
