import type { L1Granularity } from "@/lib/admin/l-client";
import { L1_KPI_IDS } from "./l1-kpi-contract.ts";

export const L1_LOCAL_VIEW_STORAGE_KEY = "nexion:l1:local-view:v3";
const LEGACY_STORAGE_KEYS = ["nexion:l1:local-view:v2", "nexion:l1:local-view:v1"];
const LEGACY_KPI_IDS = [1, 2, 3, 4, 5, 6, 7, 8];
export const L1_DEFAULT_OVERLAY_IDS = [2, 3, 4];
export const L1_LOCAL_VIEW_MAX_BYTES = 2_048;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type L1Window = "1d" | "7d" | "30d" | "custom";

export type L1LocalView = {
  window: L1Window;
  customFrom: string;
  customTo: string;
  granularity: L1Granularity;
  phaseOn: boolean;
  ylOffset: number;
  ovlKpiIds: number[];
  cohortFilter: string;
  phaseFilter: string;
  localeFilter: string;
  refFilter: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FILTER = /^[\p{L}\p{N} ._:/-]*$/u;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function safeFilter(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length <= maxLength && FILTER.test(normalized) ? normalized : null;
}

function safeOverlaySelection(value: unknown, legacy: boolean): number[] | null {
  const allowed: readonly number[] = legacy ? LEGACY_KPI_IDS : L1_KPI_IDS;
  if (!Array.isArray(value) || value.length < 1 || value.length > allowed.length
      || new Set(value).size !== value.length) return null;
  if (!legacy) return value.every(id => allowed.includes(id)) ? value : null;

  // v1/v2 stored zero-based positions in the original eight-metric array.
  if (!value.every(index => Number.isInteger(index) && index >= 0 && index < allowed.length)) return null;
  const migrated = value.map(index => LEGACY_KPI_IDS[index]).filter(id => id !== 6);
  return migrated.length ? migrated : [...L1_DEFAULT_OVERLAY_IDS];
}

export function sanitizeL1LocalView(value: unknown, legacy = false): L1LocalView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const window = raw.window;
  const granularity = raw.granularity ?? (raw.gran === "week" ? "registration_week" : raw.gran === "month" ? "registration_month" : undefined);
  const phaseOn = raw.phaseOn;
  const ylOffset = raw.ylOffset;
  if (window !== "1d" && window !== "7d" && window !== "30d" && window !== "custom") return null;
  if (granularity !== "registration_week" && granularity !== "registration_month") return null;
  if (typeof phaseOn !== "boolean" || typeof ylOffset !== "number" || !Number.isInteger(ylOffset) || ylOffset < 5 || ylOffset > 20) return null;
  const ovlKpiIds = safeOverlaySelection(legacy ? raw.ovlSel : raw.ovlKpiIds, legacy);
  if (!ovlKpiIds) return null;
  const rawCustomFrom = typeof raw.customFrom === "string" ? raw.customFrom : "";
  const rawCustomTo = typeof raw.customTo === "string" ? raw.customTo : "";
  if (rawCustomFrom.length > 10 || rawCustomTo.length > 10) return null;
  const customFrom = window === "custom" ? rawCustomFrom : "";
  const customTo = window === "custom" ? rawCustomTo : "";
  if (window === "custom" && (!DATE.test(customFrom) || !DATE.test(customTo) || customFrom > customTo)) return null;
  const cohortFilter = safeFilter(raw.cohortFilter, 64);
  const phaseFilter = safeFilter(raw.phaseFilter, 32);
  const localeFilter = safeFilter(raw.localeFilter, 32);
  const refFilter = safeFilter(raw.refFilter, 96);
  if (cohortFilter === null || phaseFilter === null || localeFilter === null || refFilter === null) return null;
  return { window, customFrom, customTo, granularity, phaseOn, ylOffset, ovlKpiIds,
    cohortFilter, phaseFilter, localeFilter, refFilter };
}

export function loadL1LocalView(storage: Pick<StorageLike, "getItem" | "removeItem">): L1LocalView | null {
  let key = L1_LOCAL_VIEW_STORAGE_KEY;
  try {
    let raw = storage.getItem(key);
    for (const legacyKey of LEGACY_STORAGE_KEYS) {
      if (raw) break;
      key = legacyKey;
      raw = storage.getItem(key);
    }
    if (!raw) return null;
    if (utf8ByteLength(raw) > L1_LOCAL_VIEW_MAX_BYTES) {
      storage.removeItem(key);
      return null;
    }
    const saved = sanitizeL1LocalView(JSON.parse(raw), key !== L1_LOCAL_VIEW_STORAGE_KEY);
    if (!saved) storage.removeItem(key);
    return saved;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // A blocked browser storage area is non-fatal and leaves no restored view.
    }
    return null;
  }
}

export function saveL1LocalView(storage: StorageLike, value: unknown): L1LocalView | null {
  const saved = sanitizeL1LocalView(value);
  if (!saved) return null;
  try {
    storage.setItem(L1_LOCAL_VIEW_STORAGE_KEY, JSON.stringify(saved));
    return saved;
  } catch {
    return null;
  }
}
