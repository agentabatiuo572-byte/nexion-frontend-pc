/** Geographic metadata only; every displayed metric and its variation comes from H9. */
export const GLOBE_CENTERS = [
  { id: "sg", nameKey: "centerSingapore", lat: 1.35, lon: 103.82 },
  { id: "jp", nameKey: "centerTokyo", lat: 35.68, lon: 139.69 },
  { id: "vn", nameKey: "centerHoChiMinh", lat: 10.82, lon: 106.63 },
  { id: "uk", nameKey: "centerLondon", lat: 51.51, lon: -0.13 },
  { id: "fr", nameKey: "centerParis", lat: 48.86, lon: 2.35 },
  { id: "de", nameKey: "centerFrankfurt", lat: 50.11, lon: 8.68 },
  { id: "us-ny", nameKey: "centerNewYork", lat: 40.71, lon: -74.01 },
  { id: "us-sj", nameKey: "centerSanJose", lat: 37.34, lon: -121.89 },
] as const;
export type GlobeDisplayConfig = {
  intervalMs: number; nodeJitterPct: number; activeJobsMinPct: number; activeJobsMaxPct: number;
  throughputMin: number; throughputMax: number; latencyJitterMs: number;
  centers: { id: string; nodes: number; latencyMs: number }[];
};

/** One boundary for the optional H9 projection. Invalid input leaves this module unavailable. */
export function parseGlobeDisplay(value: unknown): GlobeDisplayConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const limits = { intervalMs: [1000, 86400000], nodeJitterPct: [0, 100], activeJobsMinPct: [0, 100],
    activeJobsMaxPct: [0, 100], throughputMin: [0, 10000], throughputMax: [0, 10000], latencyJitterMs: [0, 60000] };
  for (const [key, [min, max]] of Object.entries(limits)) {
    const number = raw[key];
    if (typeof number !== "number" || !Number.isFinite(number) || number < min || number > max) return undefined;
    const [mantissa, exponent = '0'] = String(number).split('e');
    if ((mantissa.split('.')[1]?.length ?? 0) - Number(exponent) > 6) return undefined;
  }
  if (!Number.isInteger(raw.intervalMs) || !Number.isInteger(raw.latencyJitterMs)
      || (raw.activeJobsMinPct as number) > (raw.activeJobsMaxPct as number)
      || (raw.throughputMin as number) > (raw.throughputMax as number)
      || !Array.isArray(raw.centers) || raw.centers.length !== GLOBE_CENTERS.length) return undefined;
  const seen = new Set<string>();
  for (const row of raw.centers) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
    const center = row as Record<string, unknown>;
    if (typeof center.id !== "string" || !GLOBE_CENTERS.some(meta => meta.id === center.id) || seen.has(center.id)
        || typeof center.nodes !== "number" || !Number.isInteger(center.nodes) || center.nodes < 0 || center.nodes > 100000000
        || typeof center.latencyMs !== "number" || !Number.isInteger(center.latencyMs) || center.latencyMs < 0 || center.latencyMs > 60000) return undefined;
    seen.add(center.id);
  }
  return raw as GlobeDisplayConfig;
}
