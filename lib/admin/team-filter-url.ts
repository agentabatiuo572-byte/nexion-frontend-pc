import type { F5CommissionQuery } from "./f1-client";
import { F5_KINDS, F5_STATUSES, teamUserId } from "./f-overview-contract";

const F5_TABS = ["records", "pending", "anomalies", "suspensions", "history"] as const;
export type F5Tab = (typeof F5_TABS)[number];

export function readF5Tab(params: URLSearchParams): F5Tab {
  const tab = params.get("tab");
  return F5_TABS.find(item => item === tab) ?? "records";
}

export function readF5Filters(params: URLSearchParams): F5CommissionQuery {
  const kind = params.get("kind") ?? "", currency = params.get("currency"), cohort = params.get("cohort") ?? "", status = params.get("status") ?? "";
  return {
    kind: F5_KINDS.includes(kind) ? kind : undefined,
    currency: currency === "USDT" || currency === "UVT" ? currency : undefined,
    userId: teamUserId(params.get("userId") ?? "") ?? undefined,
    cohort: /^\d{4}-(?:0[1-9]|1[0-2])$/.test(cohort) ? cohort : undefined,
    status: F5_STATUSES.includes(status) ? status : undefined,
  };
}

export function replaceTeamFilterParams(params: Record<string, string | undefined>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
}
