import { parseStrictFiniteNumber } from "./strict-number.ts";
import { isConsecutiveDayLabels } from "./time-series-contract.ts";
import { requiredReadAuthority } from "./cross-domain-authority.ts";

export const PRESSURE_RED_LINE = 0.7;
const GATE_KEYS = ["withdraw", "staking", "genesis", "exchange", "trial"] as const;
const BACKLOG_STATES = ["submitted", "review-passed", "processing"] as const;
const ABNORMAL_CATEGORIES = ["multi-account", "arbitrage", "trial-cycle", "withdraw-held"] as const;

type Light = "green" | "yellow" | "red";

export type B5Radar = {
  generatedAt: string;
  bankrun: {
    ratio24h: number | null;
    ratioCalculable: boolean;
    light: Light | "unavailable";
    withdraw24hUsdt: number;
    reserveUsdt: number;
    ratioWithdraw24hUsdt: number;
    ratioReserveUsdt: number;
    pressureRatio: number | null;
    pressureCalculable: boolean;
    pressureRedLine: number;
    pressureLight: Light;
    yellowPct: number;
    redPct: number;
    version: number;
  };
  abnormalAccounts: {
    count: number;
    byCategory: Array<{ category: string; label: string; count: number }>;
  };
  withdrawBacklog: {
    byState: Array<{ state: typeof BACKLOG_STATES[number]; count: number; amountUsdt: number; overSlaCount: number; slaHours: number }>;
    totalCount: number;
    totalAmountUsdt: number;
    slaHours: number;
    overSlaCount: number;
    light: Light;
  };
  killSwitches: Array<{ key: typeof GATE_KEYS[number]; enabled: boolean; light: Light }>;
  coverage: {
    ratio: number | null;
    light: Light | "unavailable";
    redlinePct: number;
    reserveUsdt: number;
    liabilitiesUsdt: number;
    ratioReserveUsdt: number;
    ratioLiabilitiesUsdt: number;
  };
  pressureHistory: Array<{ label: string; ratio: number | null }>;
  alertSeverity: Array<{ level: "P0" | "P1" | "P2" | "P3"; count: number }>;
  alertVolume: Array<{ label: string; count: number }>;
  recentAlerts: Array<{ signalNo: string; level: "P0" | "P1" | "P2" | "P3"; message: string; userId: number; createdAt: string; target: string; handlingStatusAvailable: false }>;
  sources: string[];
};

function invalid(field: string): never {
  throw new Error(`B5_RESPONSE_INVALID:${field}`);
}

function row(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}

function arr(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) invalid(field);
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(field);
  return value.trim();
}

function num(value: unknown, field: string): number {
  const parsed = parseStrictFiniteNumber(value);
  if (parsed === null || parsed < 0) invalid(field);
  return parsed;
}

function whole(value: unknown, field: string): number {
  const parsed = num(value, field);
  if (!Number.isInteger(parsed)) invalid(field);
  return parsed;
}

function nullableNum(value: unknown, field: string): number | null {
  if (value === null) return null;
  return num(value, field);
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function light(value: unknown, field: string): Light {
  const parsed = text(value, field);
  if (!["green", "yellow", "red"].includes(parsed)) invalid(field);
  return parsed as Light;
}

function close(actual: number, expected: number, tolerance: number, field: string) {
  if (Math.abs(actual - expected) > tolerance) invalid(field);
}

function roundedMoneyMatches(display: number, raw: number, field: string) {
  close(display, Math.round((raw + Number.EPSILON) * 100) / 100, 0.000001, field);
}

function authoritativeRatio(numerator: number, denominator: number): number {
  if (denominator === 0) return numerator === 0 ? 0 : 1;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function authoritativePercentage(numerator: number, denominator: number): number {
  if (denominator === 0) return numerator === 0 ? 0 : 100;
  return Math.round((numerator * 100 / denominator) * 100) / 100;
}

function isoLocalDateTime(value: unknown, field: string): string {
  const parsed = text(value, field);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?$/.exec(parsed);
  if (!match) invalid(field);
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
  if (date.getUTCFullYear() !== +year || date.getUTCMonth() !== +month - 1 || date.getUTCDate() !== +day
      || date.getUTCHours() !== +hour || date.getUTCMinutes() !== +minute || date.getUTCSeconds() !== +second) invalid(field);
  return parsed;
}

export function normalizeB5Radar(value: unknown): B5Radar {
  const source = row(value, "root");
  const bankrun = row(source.bankrun, "bankrun");
  const abnormal = row(source.abnormalAccounts, "abnormalAccounts");
  const backlog = row(source.withdrawBacklog, "withdrawBacklog");
  const coverage = row(source.coverage, "coverage");

  const gates = arr(source.killSwitches, "killSwitches").map((value, index) => {
    const item = row(value, `killSwitches.${index}`);
    return {
      key: text(item.key, `killSwitches.${index}.key`) as typeof GATE_KEYS[number],
      enabled: bool(item.enabled, `killSwitches.${index}.enabled`),
      light: light(item.light, `killSwitches.${index}.light`),
    };
  });
  const actualGateKeys = gates.map((gate) => gate.key);
  if (actualGateKeys.includes("geo-block" as typeof GATE_KEYS[number])
      || gates.length !== GATE_KEYS.length
      || new Set(actualGateKeys).size !== GATE_KEYS.length
      || GATE_KEYS.some((key) => !actualGateKeys.includes(key))) {
    invalid("killSwitches");
  }
  if (gates.some((gate) => gate.light !== (gate.enabled ? "green" : "red"))) invalid("killSwitches.light");

  const byState = arr(backlog.byState, "withdrawBacklog.byState").map((value, index) => {
    const item = row(value, `withdrawBacklog.byState.${index}`);
    return {
      state: text(item.state, `withdrawBacklog.byState.${index}.state`) as typeof BACKLOG_STATES[number],
      count: whole(item.count, `withdrawBacklog.byState.${index}.count`),
      amountUsdt: num(item.amountUsdt, `withdrawBacklog.byState.${index}.amountUsdt`),
      overSlaCount: whole(item.overSlaCount, `withdrawBacklog.byState.${index}.overSlaCount`),
      slaHours: whole(item.slaHours, `withdrawBacklog.byState.${index}.slaHours`),
    };
  });
  const actualStates = byState.map((item) => item.state);
  if (byState.length !== BACKLOG_STATES.length
      || new Set(actualStates).size !== BACKLOG_STATES.length
      || BACKLOG_STATES.some((state) => !actualStates.includes(state))) {
    invalid("withdrawBacklog.byState");
  }

  const byCategory = arr(abnormal.byCategory, "abnormalAccounts.byCategory").map((value, index) => {
    const item = row(value, `abnormalAccounts.byCategory.${index}`);
    return {
      category: text(item.category, `abnormalAccounts.byCategory.${index}.category`),
      label: text(item.label, `abnormalAccounts.byCategory.${index}.label`),
      count: whole(item.count, `abnormalAccounts.byCategory.${index}.count`),
    };
  });
  const actualCategories = byCategory.map((item) => item.category);
  if (byCategory.length !== ABNORMAL_CATEGORIES.length
      || new Set(actualCategories).size !== ABNORMAL_CATEGORIES.length
      || ABNORMAL_CATEGORIES.some((category) => !actualCategories.includes(category))) invalid("abnormalAccounts.byCategory");

  const pressureHistory = arr(source.pressureHistory, "pressureHistory").map((value, index) => {
    const item = row(value, `pressureHistory.${index}`);
    return { label: text(item.label, `pressureHistory.${index}.label`), ratio: nullableNum(item.ratio, `pressureHistory.${index}.ratio`) };
  });
  if (pressureHistory.length !== 8
      || new Set(pressureHistory.map((item) => item.label)).size !== 8
      || !isConsecutiveDayLabels(pressureHistory.map((item) => item.label))) invalid("pressureHistory");

  const alertSeverity = arr(source.alertSeverity, "alertSeverity").map((value, index) => {
    const item = row(value, `alertSeverity.${index}`);
    return { level: text(item.level, `alertSeverity.${index}.level`) as "P0" | "P1" | "P2" | "P3", count: whole(item.count, `alertSeverity.${index}.count`) };
  });
  const severityLevels = alertSeverity.map((item) => item.level);
  if (alertSeverity.length !== 4
      || new Set(severityLevels).size !== 4
      || ["P0", "P1", "P2", "P3"].some((level) => !severityLevels.includes(level as typeof alertSeverity[number]["level"]))) {
    invalid("alertSeverity");
  }

  const alertVolume = arr(source.alertVolume, "alertVolume").map((value, index) => {
    const item = row(value, `alertVolume.${index}`);
    return { label: text(item.label, `alertVolume.${index}.label`), count: whole(item.count, `alertVolume.${index}.count`) };
  });
  if (alertVolume.length !== 7
      || new Set(alertVolume.map((item) => item.label)).size !== 7
      || !isConsecutiveDayLabels(alertVolume.map((item) => item.label))) invalid("alertVolume");

  const recentAlerts = arr(source.recentAlerts, "recentAlerts").map((value, index) => {
    const item = row(value, `recentAlerts.${index}`);
    const level = text(item.level, `recentAlerts.${index}.level`);
    const target = text(item.target, `recentAlerts.${index}.target`);
    const handlingStatusAvailable = bool(item.handlingStatusAvailable, `recentAlerts.${index}.handlingStatusAvailable`);
    if (!["P0", "P1", "P2", "P3"].includes(level) || requiredReadAuthority(target) === null || handlingStatusAvailable) invalid(`recentAlerts.${index}`);
    return {
      signalNo: text(item.signalNo, `recentAlerts.${index}.signalNo`),
      level: level as "P0" | "P1" | "P2" | "P3",
      message: text(item.message, `recentAlerts.${index}.message`),
      userId: whole(item.userId, `recentAlerts.${index}.userId`),
      createdAt: isoLocalDateTime(item.createdAt, `recentAlerts.${index}.createdAt`),
      target,
      handlingStatusAvailable: false as const,
    };
  });
  if (recentAlerts.some((item) => item.userId <= 0)) invalid("recentAlerts.userId");
  if (recentAlerts.length > 20 || new Set(recentAlerts.map((item) => item.signalNo)).size !== recentAlerts.length) invalid("recentAlerts");

  const pressureRedLine = num(bankrun.pressureRedLine, "bankrun.pressureRedLine");
  const pressureCalculable = bool(bankrun.pressureCalculable, "bankrun.pressureCalculable");
  const pressureRatio = nullableNum(bankrun.pressureRatio, "bankrun.pressureRatio");
  const yellowPct = num(bankrun.yellowPct, "bankrun.yellowPct");
  const redPct = num(bankrun.redPct, "bankrun.redPct");
  const ratio24h = nullableNum(bankrun.ratio24h, "bankrun.ratio24h");
  const ratioCalculable = bool(bankrun.ratioCalculable, "bankrun.ratioCalculable");
  const withdraw24hUsdt = num(bankrun.withdraw24hUsdt, "bankrun.withdraw24hUsdt");
  const reserveUsdt = num(bankrun.reserveUsdt, "bankrun.reserveUsdt");
  const rawBankrunLight = text(bankrun.light, "bankrun.light");
  if (!["green", "yellow", "red", "unavailable"].includes(rawBankrunLight)) invalid("bankrun.light");
  const bankrunLight = rawBankrunLight as Light | "unavailable";
  const pressureLight = light(bankrun.pressureLight, "bankrun.pressureLight");
  if (pressureRedLine !== PRESSURE_RED_LINE || yellowPct < 5 || yellowPct > 50 || redPct < 10 || redPct > 80 || redPct <= yellowPct) invalid("bankrun.thresholds");
  if (pressureCalculable !== (pressureRatio !== null)) invalid("bankrun.pressureRatio");
  const ratioWithdraw24hUsdt = num(bankrun.ratioWithdraw24hUsdt, "bankrun.ratioWithdraw24hUsdt");
  const ratioReserveUsdt = num(bankrun.ratioReserveUsdt, "bankrun.ratioReserveUsdt");
  roundedMoneyMatches(withdraw24hUsdt, ratioWithdraw24hUsdt, "bankrun.withdraw24hUsdt");
  roundedMoneyMatches(reserveUsdt, ratioReserveUsdt, "bankrun.reserveUsdt");
  if (ratioReserveUsdt === 0) {
    if (ratioCalculable || ratio24h !== null) invalid("bankrun.ratio24h");
    const expectedBankrunLight = ratioWithdraw24hUsdt > 0 ? "red" : "unavailable";
    if (bankrunLight !== expectedBankrunLight) invalid("bankrun.light");
  } else {
    if (!ratioCalculable || ratio24h === null || bankrunLight === "unavailable") invalid("bankrun.ratio24h");
    close(ratio24h, authoritativeRatio(ratioWithdraw24hUsdt, ratioReserveUsdt), 0.00001, "bankrun.ratio24h");
    const expectedBankrunLight = ratio24h * 100 >= redPct ? "red" : ratio24h * 100 >= yellowPct ? "yellow" : "green";
    if (bankrunLight !== expectedBankrunLight) invalid("bankrun.light");
  }
  if (pressureCalculable) {
    const expectedPressureLight = pressureRatio! >= PRESSURE_RED_LINE ? "red" : "green";
    if (pressureLight !== expectedPressureLight) invalid("bankrun.pressureLight");
  } else if (pressureLight === "green") {
    invalid("bankrun.pressureLight");
  }

  const abnormalCount = whole(abnormal.count, "abnormalAccounts.count");
  const abnormalCategorySum = byCategory.reduce((sum, item) => sum + item.count, 0);
  const abnormalCategoryMax = Math.max(...byCategory.map((item) => item.count));
  if (abnormalCount < abnormalCategoryMax || abnormalCount > abnormalCategorySum) invalid("abnormalAccounts.count");

  const totalCount = whole(backlog.totalCount, "withdrawBacklog.totalCount");
  const totalAmountUsdt = num(backlog.totalAmountUsdt, "withdrawBacklog.totalAmountUsdt");
  const slaHours = whole(backlog.slaHours, "withdrawBacklog.slaHours");
  const overSlaCount = whole(backlog.overSlaCount, "withdrawBacklog.overSlaCount");
  const backlogLight = light(backlog.light, "withdrawBacklog.light");
  if (totalCount !== byState.reduce((sum, item) => sum + item.count, 0)) invalid("withdrawBacklog.totalCount");
  close(totalAmountUsdt, byState.reduce((sum, item) => sum + item.amountUsdt, 0), 0.01, "withdrawBacklog.totalAmountUsdt");
  if (overSlaCount !== byState.reduce((sum, item) => sum + item.overSlaCount, 0)) invalid("withdrawBacklog.overSlaCount");
  if (byState.some((item) => item.overSlaCount > item.count)) invalid("withdrawBacklog.byState.overSlaCount");
  if (byState.some((item) => item.slaHours !== slaHours)) invalid("withdrawBacklog.slaHours");
  if (backlogLight !== (overSlaCount > 0 ? "yellow" : "green")) invalid("withdrawBacklog.light");

  if (alertSeverity.reduce((sum, item) => sum + item.count, 0) !== alertVolume.reduce((sum, item) => sum + item.count, 0)) invalid("alertVolume.total");

  const coverageRatio = nullableNum(coverage.ratio, "coverage.ratio");
  const coverageRedlinePct = num(coverage.redlinePct, "coverage.redlinePct");
  const coverageReserveUsdt = num(coverage.reserveUsdt, "coverage.reserveUsdt");
  const coverageLiabilitiesUsdt = num(coverage.liabilitiesUsdt, "coverage.liabilitiesUsdt");
  const coverageRatioReserveUsdt = num(coverage.ratioReserveUsdt, "coverage.ratioReserveUsdt");
  const coverageRatioLiabilitiesUsdt = num(coverage.ratioLiabilitiesUsdt, "coverage.ratioLiabilitiesUsdt");
  const rawCoverageLight = text(coverage.light, "coverage.light");
  if (!["green", "yellow", "red", "unavailable"].includes(rawCoverageLight)) invalid("coverage.light");
  const coverageLight = rawCoverageLight as Light | "unavailable";
  roundedMoneyMatches(coverageReserveUsdt, coverageRatioReserveUsdt, "coverage.reserveUsdt");
  roundedMoneyMatches(coverageLiabilitiesUsdt, coverageRatioLiabilitiesUsdt, "coverage.liabilitiesUsdt");
  if (coverageRedlinePct > 100) invalid("coverage.redlinePct");
  if (coverageRatioLiabilitiesUsdt === 0) {
    if (coverageRatio !== null || coverageLight !== "unavailable") invalid("coverage.ratio");
  } else {
    if (coverageRatio === null || coverageLight === "unavailable") invalid("coverage.ratio");
    const expectedCoverageLight = coverageRatio < coverageRedlinePct
      ? "red"
      : coverageRatio < coverageRedlinePct + 10 ? "yellow" : "green";
    if (coverageLight !== expectedCoverageLight) invalid("coverage.light");
    close(
      coverageRatio,
      authoritativePercentage(coverageRatioReserveUsdt, coverageRatioLiabilitiesUsdt),
      0.011,
      "coverage.ratio",
    );
  }

  return {
    generatedAt: isoLocalDateTime(source.generatedAt, "generatedAt"),
    bankrun: { ratio24h, ratioCalculable, light: bankrunLight, withdraw24hUsdt, reserveUsdt, ratioWithdraw24hUsdt, ratioReserveUsdt, pressureRatio, pressureCalculable, pressureRedLine, pressureLight, yellowPct, redPct, version: whole(bankrun.version, "bankrun.version") },
    abnormalAccounts: { count: abnormalCount, byCategory },
    withdrawBacklog: { byState, totalCount, totalAmountUsdt, slaHours, overSlaCount, light: backlogLight },
    killSwitches: gates,
    coverage: {
      ratio: coverageRatio,
      light: coverageLight,
      redlinePct: coverageRedlinePct,
      reserveUsdt: coverageReserveUsdt,
      liabilitiesUsdt: coverageLiabilitiesUsdt,
      ratioReserveUsdt: coverageRatioReserveUsdt,
      ratioLiabilitiesUsdt: coverageRatioLiabilitiesUsdt,
    },
    pressureHistory,
    alertSeverity,
    alertVolume,
    recentAlerts,
    sources: arr(source.sources, "sources").map((value, index) => text(value, `sources.${index}`)),
  };
}
