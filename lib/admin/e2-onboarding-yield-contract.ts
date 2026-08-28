export interface E2PhoneTier {
  tier: number;
  name: string;
  note: string;
  dailyUsdt: number;
  dailyNex: number;
  status: string;
  revision: number;
}

export interface E2YieldComparison {
  configKey: string;
  label: string;
  dailyUsdt: number;
  dailyNex: number;
  sortOrder: number;
  revision: number;
  updatedAt?: string;
}

export interface E2OnboardingYieldConfig {
  tiers: E2PhoneTier[];
  comparisons: E2YieldComparison[];
  configRevision: number;
}

type JsonRecord = Record<string, unknown>;

function invalid(): never {
  throw new Error("E2_ONBOARDING_YIELD_PROTOCOL_INVALID");
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as JsonRecord;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function number(value: unknown, fallback = Number.NaN): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function positiveDecimal18x6(value: unknown): number {
  const normalized = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(normalized)) invalid();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 999_999_999_999.999999) invalid();
  return parsed;
}

function phoneTier(value: unknown): E2PhoneTier {
  const row = record(value);
  const tier = number(row.tier);
  const revision = number(row.revision);
  const name = text(row.name);
  if (!Number.isSafeInteger(tier) || tier < 1 || tier > 5
    || !Number.isSafeInteger(revision) || revision < 1 || !name) invalid();
  return {
    tier,
    name,
    note: text(row.note),
    // Java's canonical phone-tier projection deliberately names these fields
    // baseRate*. The PC view calls the same values daily* for operator copy.
    dailyUsdt: positiveDecimal18x6(row.baseRateUsdt),
    dailyNex: positiveDecimal18x6(row.baseRateNex),
    status: text(row.status, "active"),
    revision,
  };
}

function yieldComparison(value: unknown): E2YieldComparison {
  const row = record(value);
  const configKey = text(row.configKey);
  const label = text(row.label);
  const revision = number(row.revision);
  const sortOrder = number(row.sortOrder, 0);
  if (!configKey || !label || !Number.isSafeInteger(revision) || revision < 1
    || !Number.isSafeInteger(sortOrder) || sortOrder < 0) invalid();
  const updatedAt = text(row.updatedAt);
  return {
    configKey,
    label,
    dailyUsdt: positiveDecimal18x6(row.dailyUsdt),
    dailyNex: positiveDecimal18x6(row.dailyNex),
    sortOrder,
    revision,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

export function parseE2OnboardingYieldConfig(value: unknown): E2OnboardingYieldConfig {
  const source = record(value);
  if (!Array.isArray(source.tiers) || !Array.isArray(source.comparisons)) invalid();
  const tiers = source.tiers.map(phoneTier).sort((left, right) => left.tier - right.tier);
  const comparisons = source.comparisons.map(yieldComparison)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  if (tiers.length !== 5 || new Set(tiers.map((row) => row.tier)).size !== 5
    || tiers.some((row, index) => row.tier !== index + 1)
    || comparisons.length === 0
    || new Set(comparisons.map((row) => row.configKey)).size !== comparisons.length) invalid();
  const configRevision = number(source.configRevision, 0);
  if (!Number.isSafeInteger(configRevision) || configRevision < 0) invalid();
  return { tiers, comparisons, configRevision };
}
