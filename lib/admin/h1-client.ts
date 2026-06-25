interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

interface BackendRhythmOverview {
  totalMonths?: number | string | null;
  currentMonth?: number | string | null;
  currentPhase?: string | null;
  phaseProgressPct?: number | string | null;
  options?: Array<number | string> | null;
  sources?: string[] | null;
}

export interface H1RhythmOverview {
  totalMonths: number;
  currentMonth: number;
  currentPhase: string;
  phaseProgressPct: number;
  options: number[];
  sources: string[];
}

export type H1RhythmParamKey = "totalMonths" | "currentMonth" | "phaseProgressPct";

let requestSeq = 0;

function nextIdempotencyKey(prefix: string) {
  requestSeq += 1;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

function numberValue(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeRhythm(raw?: BackendRhythmOverview | null): H1RhythmOverview {
  const options = Array.isArray(raw?.options)
    ? raw.options.map((item) => Number(item)).filter((item) => Number.isFinite(item))
    : [9, 12, 15, 18, 24];
  const totalMonths = options.includes(numberValue(raw?.totalMonths, 12))
    ? numberValue(raw?.totalMonths, 12)
    : 12;
  return {
    totalMonths,
    currentMonth: clampInt(numberValue(raw?.currentMonth, 7), 1, totalMonths),
    currentPhase: raw?.currentPhase || "P3",
    phaseProgressPct: clampInt(numberValue(raw?.phaseProgressPct, 58), 0, 100),
    options,
    sources: Array.isArray(raw?.sources) ? raw.sources : [],
  };
}

async function h1Request<T>(path: string, init?: RequestInit, idempotencyPrefix?: string): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (idempotencyPrefix && !headers.has("Idempotency-Key")) {
    headers.set("Idempotency-Key", nextIdempotencyKey(idempotencyPrefix));
  }

  const response = await fetch(`/api/admin/growth${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json()) as ApiResult<T>;
  if (!response.ok || result.code !== 0) {
    throw new Error(result.message || `H1_REQUEST_FAILED_${response.status}`);
  }
  return result.data as T;
}

export async function fetchH1Rhythm(): Promise<H1RhythmOverview> {
  return normalizeRhythm(await h1Request<BackendRhythmOverview>("/rhythm"));
}

export async function updateH1RhythmParam(
  key: H1RhythmParamKey,
  value: string | number,
  reason: string,
  operator = "superadmin",
): Promise<H1RhythmOverview> {
  return normalizeRhythm(
    await h1Request<BackendRhythmOverview>(
      `/rhythm/${key}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          key,
          value: String(value),
          reason,
          operator,
        }),
      },
      "h1-rhythm",
    ),
  );
}
