export const L1_LOCAL_VIEW_STORAGE_KEY = "nexion:l1:local-view:v1";
export const L1_LOCAL_VIEW_MAX_BYTES = 2_048;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type L1Window = "1d" | "7d" | "30d" | "custom";
type L1Granularity = "week" | "month";

export type L1LocalView = {
  window: L1Window;
  customFrom: string;
  customTo: string;
  gran: L1Granularity;
  phaseOn: boolean;
  ylOffset: number;
  ovlSel: number[];
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

function safeOverlaySelection(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null;
  const selection: number[] = [];
  for (const index of value) {
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 7) return null;
    selection.push(index);
  }
  return new Set(selection).size === selection.length ? selection : null;
}

export function sanitizeL1LocalView(value: unknown): L1LocalView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const window = raw.window;
  const gran = raw.gran;
  const phaseOn = raw.phaseOn;
  const ylOffset = raw.ylOffset;
  if (window !== "1d" && window !== "7d" && window !== "30d" && window !== "custom") return null;
  if (gran !== "week" && gran !== "month") return null;
  if (typeof phaseOn !== "boolean" || typeof ylOffset !== "number" || !Number.isInteger(ylOffset) || ylOffset < 5 || ylOffset > 20) return null;
  const ovlSel = safeOverlaySelection(raw.ovlSel);
  if (!ovlSel) return null;
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
  return { window, customFrom, customTo, gran, phaseOn, ylOffset, ovlSel,
    cohortFilter, phaseFilter, localeFilter, refFilter };
}

export function loadL1LocalView(storage: Pick<StorageLike, "getItem" | "removeItem">): L1LocalView | null {
  try {
    const raw = storage.getItem(L1_LOCAL_VIEW_STORAGE_KEY);
    if (!raw) return null;
    if (utf8ByteLength(raw) > L1_LOCAL_VIEW_MAX_BYTES) {
      storage.removeItem(L1_LOCAL_VIEW_STORAGE_KEY);
      return null;
    }
    const saved = sanitizeL1LocalView(JSON.parse(raw));
    if (!saved) storage.removeItem(L1_LOCAL_VIEW_STORAGE_KEY);
    return saved;
  } catch {
    try {
      storage.removeItem(L1_LOCAL_VIEW_STORAGE_KEY);
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
