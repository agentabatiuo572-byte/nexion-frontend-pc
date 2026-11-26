"use client";

/**
 * 「最近风险信号」页签的名单（design-plan 板 2）：筛选一行（类型、处理进度、时间范围，右端写涉及几个账户）、表格、分页。
 * 名单和类型列表、雷达各读各的：读取中、首次失败、同条件后续失败（保留上次成功的值并标时间）都在这一块里，不影响别的块（ST-27、ST-40）。
 */
import { BlockState, Button, FilterBar, FilterField, Panel, Pager, Select, type SelectOption } from "@/app/components/rd";
import { StaleNotice, type StaleRead } from "./categories";
import { SIGNAL_CATEGORIES, SIGNAL_LIST_ANCHOR, TAMPER_SIGNAL_TYPE } from "@/lib/admin/risk-feed";
import { SignalsTable, type SignalRow } from "./insights";

export interface SignalListFilters {
  /** 后端 category，空串是全部类型。 */
  category: string;
  categoryLabel?: string;
  /** open、handled、resolved，空串是全部进度。 */
  status: string;
  /** 时间范围下拉：默认「近 7 天」；从类型列表点进来时多一项，写那一行的起止时间原值。 */
  window: string;
  windowOptions: readonly SelectOption[];
  onCategory: (value: string) => void;
  onStatus: (value: string) => void;
  onWindow: (value: string) => void;
  onClear: () => void;
  canClear: boolean;
  /** 服务端给的去重账户数；没读到时传 null。名单读取失败或加载中不显示，不当 0（ST-34）。 */
  accountCount: number | null;
}

export interface SignalListPage {
  total: number;
  pageNum: number;
  pageSize: number;
  sizes: readonly number[];
  loading: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}

export type SignalListState =
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "ready"; rows: readonly SignalRow[]; stale?: StaleRead };

type TableProps = Omit<Parameters<typeof SignalsTable>[0], "alerts" | "showBlocked" | "empty">;

const STATUS_OPTIONS: SelectOption[] = [
  { value: "", label: "全部进度" }, { value: "open", label: "待处理" }, { value: "handled", label: "已处理" }, { value: "resolved", label: "已解决" },
];
const CATEGORY_OPTIONS: SelectOption[] = [{ value: "", label: "全部类型" }, ...SIGNAL_CATEGORIES];

export function SignalList({ data, filters, page, onRetry, table }: {
  data: SignalListState;
  filters: SignalListFilters;
  page?: SignalListPage;
  onRetry: () => void;
  table: TableProps;
}) {
  const empty = filters.canClear
    ? <span className="b5-empty">没有符合条件的风险信号<Button size="sm" variant="ghost" onClick={filters.onClear}>清除筛选</Button></span>
    : "近 7×24 小时没有风险信号。新的风险信号记下后会出现在这里。";
  return (
    <Panel flush data-testid="b5-recent-alert-feed" data-capability="b5-signal-disposition" className="b5-list-panel">
      <div id={SIGNAL_LIST_ANCHOR} className="b5-list-filter">
        <FilterBar onClear={filters.onClear} canClear={filters.canClear}
          end={data.state !== "ready" || filters.accountCount === null ? undefined : `涉及 ${filters.accountCount} 个账户`}>
          <FilterField><Select aria-label="风险类型" value={filters.category} onChange={filters.onCategory} options={filters.categoryLabel ? [...CATEGORY_OPTIONS, { value: filters.category, label: filters.categoryLabel }] : CATEGORY_OPTIONS} /></FilterField>
          <FilterField><Select aria-label="处理进度" value={filters.status} onChange={filters.onStatus} options={STATUS_OPTIONS} /></FilterField>
          <FilterField><Select aria-label="时间范围" value={filters.window} onChange={filters.onWindow} options={[...filters.windowOptions]} /></FilterField>
        </FilterBar>
      </div>
      {data.state === "loading" && <BlockState state="loading" title="正在加载风险信号…" />}
      {data.state === "error" && <BlockState state="error" title="风险信号加载失败" detail={data.error} onRetry={onRetry} />}
      {data.state === "ready" && (
        <>
          {data.stale && <div className="b5-list-stale"><StaleNotice stale={data.stale} onRetry={onRetry} /></div>}
          <SignalsTable {...table} alerts={data.rows} showBlocked={filters.category === "TAMPER" || filters.category === TAMPER_SIGNAL_TYPE} empty={empty} />
          {page && <Pager label="风险信号" total={page.total} page={page.pageNum} pageSize={page.pageSize} sizes={page.sizes} loading={page.loading} onPage={page.onPage} onPageSize={page.onPageSize} />}
        </>
      )}
    </Panel>
  );
}
