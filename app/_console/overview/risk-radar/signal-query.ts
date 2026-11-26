import { B5_HANDLING_STATUSES, type B5HandlingStatus } from "@/lib/admin/b5-radar-contract";
import { B5_PATH, isOffsetDateTime, isSignalCategory, type SignalCategory } from "@/lib/admin/risk-feed";

export const SIGNAL_PAGE_SIZES = [10, 20, 50] as const;
const DEFAULT_PAGE_SIZE = 20;

export function readSignalQuery(params: Pick<URLSearchParams, "get" | "getAll">) {
  const category = [...new Set(params.getAll("category").flatMap(value => value.split(",")).filter(isSignalCategory))];
  const status = params.get("handlingStatus") as B5HandlingStatus | null;
  const startAt = params.get("startAt");
  const endAt = params.get("endAt");
  const hasWindow = isOffsetDateTime(startAt) && isOffsetDateTime(endAt) && Date.parse(startAt) < Date.parse(endAt);
  const page = Number(params.get("page"));
  const pageSize = Number(params.get("pageSize")) as typeof SIGNAL_PAGE_SIZES[number];
  return {
    tab: params.get("tab") === "inbox" ? "inbox" as const : "signals" as const,
    category,
    handlingStatus: status && B5_HANDLING_STATUSES.includes(status) ? status : null,
    startAt: hasWindow ? startAt : null,
    endAt: hasWindow ? endAt : null,
    page: Number.isInteger(page) && page >= 1 && page <= 2_147_483_647 ? page : 1,
    pageSize: SIGNAL_PAGE_SIZES.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
  };
}

export type SignalQuery = ReturnType<typeof readSignalQuery>;

export function signalRequestQuery(query: SignalQuery) {
  const params = new URLSearchParams({ pageNum: String(query.page), pageSize: String(query.pageSize) });
  query.category.forEach(category => params.append("category", category));
  if (query.handlingStatus) params.set("handlingStatus", query.handlingStatus);
  if (query.startAt && query.endAt) {
    params.set("startAt", query.startAt);
    params.set("endAt", query.endAt);
  }
  return params;
}

export function signalReturnTo(query: SignalQuery, fromHome: boolean) {
  const params = signalRequestQuery(query);
  params.delete("pageNum");
  params.set("tab", query.tab);
  params.set("page", String(query.page));
  if (fromHome) params.set("from", "home");
  return `${B5_PATH}?${params}#risk-signal-tabs`;
}

type QueryUpdate = {
  tab?: SignalQuery["tab"];
  category?: SignalCategory | null;
  handlingStatus?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  page?: number;
  pageSize?: number;
};

export function replaceSignalQuery(update: QueryUpdate) {
  const url = new URL(window.location.href);
  for (const [name, value] of Object.entries(update)) {
    if (value == null || value === "") url.searchParams.delete(name);
    else url.searchParams.set(name, String(value));
  }
  window.history.replaceState(null, "", url);
}
