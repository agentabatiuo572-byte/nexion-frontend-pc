"use client";

import { useCallback, useEffect, useState } from "react";
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { displayAdminError, formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import { f4Decimal } from "@/lib/admin/f4-money";
import { isOffsetDateTime, isSignalCategory, RISK_SEVERITIES, SCORE_BANDS, type RiskFeedItem, type RiskSev, type ScoreBand } from "./risk-feed";
import { useAdminAuth } from "@/lib/store/admin-auth";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

export interface BLedgerAccount {
  key: string;
  label: string;
  amount: number;
  source: string;
  pc: number;
  cat: string;
}

export interface BLedger {
  reserveUsd: number;
  liabilitiesUsd: number;
  valuationReliable: boolean;
  redlineBreached: boolean;
  coverageRatio: number;
  redlinePct: number;
  healthyPct: number;
  thresholdVersion: number | null;
  runRiskPct: number;
  pressureRatio: number;
  netFlow24hUsd: number;
  queueBacklogCount: number;
  queueBacklogUsd: number;
  avgRiskScore: number;
  coverageSeries: number[];
  coverageSeriesPoints?: Array<{ at: string; coverageRatio: string; backcast: boolean }>;
  coverageSeriesIntervalHours: number | null;
  accounts: BLedgerAccount[];
  prev: {
    reserveUsd: number;
    netFlow24hUsd: number;
    queueBacklogCount: number | null;
    avgRiskScore: number | null;
  };
}

export interface BLiquidity {
  coverage: Record<string, unknown>;
  liabilities: Array<{ nm: string; pc: number; amount: number; cat: string; source: string }>;
  runway: Array<{ day: string; valueWan: number }>;
  runwayTotalWan: number;
  flow: Array<{ label: string; valueWan: number }>;
}

export interface BFunnel {
  stages: Array<{
    key: string;
    nm: string;
    ct: number;
    lc: string;
    conv: string | null;
    bad?: boolean;
    color: string;
    label: string;
    count: number;
    prevCount: number;
  }>;
  transitions: Array<{ nm: string; from: string; to: string; v: string; vColor?: string; flow: string; note: string; noteKind: "muted" | "up" | "dn"; bad?: boolean }>;
  cohort: number[];
  channels: Array<{ nm: string; pc: number; catVar: string; q?: string }>;
  daily: number[];
  dailyTarget: number;
  overallConversionPct: number;
}

export interface BRhythm {
  h1: {
    currentPhase: string;
    currentPhaseName: string;
    currentMonth: number;
    totalMonths: number;
    phaseProgressPct: number;
  };
  phaseNodes: Array<{ code: string; name: string; intensity: number }>;
  inflowWan: number[];
  budget: Array<{ nm: string; pc: number; varName: string }>;
  ratio: number[];
  healthyRatio: number;
  currentRatio: number;
  suggestion: string;
}

export interface BRiskRadar {
  gates: Array<{ nm: string; dom: string; on: boolean; state?: "on" | "off" | "missing"; configKey?: string; unset?: boolean }>;
  trippedGateCount: number;
  feed: RiskFeedItem[];
  pressureSeries: number[];
  pressureTightPct: number;
  currentPressurePct: number;
  rules: Array<{ nm: string; ct: number; sev?: string; dom?: string }>;
  flaggedAccounts: number;
  severity: Array<{ nm: string; count: number; c: string }>;
  volume: Array<{ label: string; count: number }>;
  bankRunRatio: number;
  bankRunYellowPct: number;
  bankRunRedlinePct: number;
}

export interface BDomainDashboard {
  generatedAt?: string;
  sources: string[];
  warnings: Array<{ key: string; code: string; message: string }>;
  alerts: { coverageRedlineAcked: boolean; sources: string[] };
  ledger: BLedger;
  liquidity: BLiquidity;
  rhythm: BRhythm;
  riskRadar: BRiskRadar;
}

const CAT_VARS = [
  "--admin-cat-1",
  "--admin-cat-2",
  "--admin-cat-3",
  "--admin-cat-4",
  "--admin-cat-5",
  "--admin-cat-6",
  "--admin-cat-7",
  "--admin-cat-8",
];

const EMPTY_LEDGER: BLedger = {
  reserveUsd: 0,
  liabilitiesUsd: 0,
  valuationReliable: false,
  redlineBreached: false,
  coverageRatio: 0,
  redlinePct: 0,
  thresholdVersion: null,
  healthyPct: 0,
  runRiskPct: 0,
  pressureRatio: 0,
  netFlow24hUsd: 0,
  queueBacklogCount: 0,
  queueBacklogUsd: 0,
  avgRiskScore: 0,
  coverageSeries: [],
  coverageSeriesIntervalHours: null,
  accounts: [],
  prev: {
    reserveUsd: 0,
    netFlow24hUsd: 0,
    queueBacklogCount: null,
    avgRiskScore: null,
  },
};

export const EMPTY_B_DOMAIN: BDomainDashboard = {
  sources: [],
  warnings: [],
  alerts: { coverageRedlineAcked: false, sources: [] },
  ledger: EMPTY_LEDGER,
  liquidity: {
    coverage: {},
    liabilities: [],
    runway: [],
    runwayTotalWan: 0,
    flow: [],
  },
  rhythm: {
    h1: {
      currentPhase: "",
      currentPhaseName: "",
      currentMonth: 0,
      totalMonths: 0,
      phaseProgressPct: 0,
    },
    phaseNodes: [],
    inflowWan: [],
    budget: [],
    ratio: [],
    healthyRatio: 0,
    currentRatio: 0,
    suggestion: "",
  },
  riskRadar: {
    gates: [],
    trippedGateCount: 0,
    feed: [],
    pressureSeries: [],
    pressureTightPct: 0,
    currentPressurePct: 0,
    rules: [],
    flaggedAccounts: 0,
    severity: [],
    volume: [],
    bankRunRatio: 0,
    bankRunYellowPct: 20,
    bankRunRedlinePct: 40,
  },
};

function num(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function requiredNum(value: unknown, field: string) {
  const n = typeof value === "number"
    ? value
    : typeof value === "string" && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isFinite(n)) {
    throw new Error(`B_DOMAIN_FIELD_REQUIRED:${field}`);
  }
  return n;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function requiredText(value: unknown, field: string) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new Error(`B_DOMAIN_FIELD_REQUIRED:${field}`);
}

function bool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "on", "enabled", "enable"].includes(normalized)) return true;
    if (["false", "0", "off", "disabled", "disable"].includes(normalized)) return false;
  }
  return fallback;
}

function requiredBool(value: unknown, field: string) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "on", "enabled", "enable"].includes(normalized)) return true;
    if (["false", "0", "off", "disabled", "disable"].includes(normalized)) return false;
  }
  throw new Error(`B_DOMAIN_FIELD_REQUIRED:${field}`);
}

function arr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function requiredArr<T>(value: unknown, field: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`B_DOMAIN_FIELD_REQUIRED:${field}`);
  }
  return value as T[];
}

function row(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function requiredRow(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`B_DOMAIN_FIELD_REQUIRED:${field}`);
  }
  return value as Record<string, unknown>;
}

function catVar(value: unknown, index: number) {
  const raw = text(value);
  if (raw.startsWith("--admin-cat-")) return raw;
  const matched = raw.match(/var\((--admin-cat-\d+)\)/);
  return matched?.[1] ?? CAT_VARS[index % CAT_VARS.length];
}

let requestSeq = 0;

function nextId(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

function normalizeLedger(raw: Record<string, unknown>): BLedger {
  const snapshot = requiredRow(raw.snapshot, "dualLedger.snapshot");
  const thresholdVersion = snapshot.thresholdVersion == null
    ? null
    : requiredNum(snapshot.thresholdVersion, "dualLedger.snapshot.thresholdVersion");
  if (thresholdVersion !== null && (!Number.isSafeInteger(thresholdVersion) || thresholdVersion < 0)) {
    throw new Error("B_DOMAIN_FIELD_REQUIRED:dualLedger.snapshot.thresholdVersion");
  }
  const reserveUsd = requiredNum(snapshot.reserveUsd, "dualLedger.snapshot.reserveUsd");
  const liabilitiesUsd = requiredNum(snapshot.liabilitiesUsd, "dualLedger.snapshot.liabilitiesUsd");
  const queueBacklogUsd = requiredNum(snapshot.queueBacklogUsd, "dualLedger.snapshot.queueBacklogUsd");
  const accounts = requiredArr<Record<string, unknown>>(raw.accounts, "dualLedger.accounts").map((item, index) => {
    const amount = requiredNum(item.amount, `dualLedger.accounts.${index}.amount`);
    return {
      key: requiredText(item.key, `dualLedger.accounts.${index}.key`),
      label: requiredText(item.label, `dualLedger.accounts.${index}.label`),
      amount,
      source: requiredText(item.source, `dualLedger.accounts.${index}.source`),
      pc: liabilitiesUsd > 0 ? Math.round((amount / liabilitiesUsd) * 1000) / 10 : 0,
      cat: CAT_VARS[index % CAT_VARS.length],
    };
  });
  const prev = requiredRow(raw.prev, "dualLedger.prev");
  const coverageSeries = requiredArr<unknown>(snapshot.coverageSeries, "dualLedger.snapshot.coverageSeries")
    .map((item, index) => requiredNum(item, `dualLedger.snapshot.coverageSeries.${index}`));
  const coverageSeriesPoints = snapshot.coverageSeriesPoints === undefined ? undefined
    : requiredArr<unknown>(snapshot.coverageSeriesPoints, "dualLedger.snapshot.coverageSeriesPoints").map((item, index) => {
      const field = `dualLedger.snapshot.coverageSeriesPoints.${index}`;
      const point = requiredRow(item, field);
      const coverageRatio = requiredText(point.coverageRatio, `${field}.coverageRatio`);
      if (typeof point.at !== "string" || !point.at.trim() || typeof point.backcast !== "boolean"
        || !/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(coverageRatio)) throw new Error(`B_DOMAIN_FIELD_REQUIRED:${field}`);
      return { at: point.at, coverageRatio, backcast: point.backcast };
    });
  const intervalHours = snapshot.coverageSeriesIntervalHours;
  return {
    reserveUsd,
    liabilitiesUsd,
    valuationReliable: requiredBool(snapshot.valuationReliable, "dualLedger.snapshot.valuationReliable"),
    redlineBreached: requiredBool(snapshot.redlineBreached, "dualLedger.snapshot.redlineBreached"),
    coverageRatio: requiredNum(snapshot.coverageRatio, "dualLedger.snapshot.coverageRatio"),
    redlinePct: requiredNum(snapshot.redlinePct, "dualLedger.snapshot.redlinePct"),
    healthyPct: requiredNum(snapshot.healthyPct, "dualLedger.snapshot.healthyPct"),
    thresholdVersion,
    runRiskPct: requiredNum(snapshot.runRiskPct, "dualLedger.snapshot.runRiskPct"),
    pressureRatio: reserveUsd > 0 ? queueBacklogUsd / reserveUsd : 0,
    netFlow24hUsd: requiredNum(snapshot.netFlow24hUsd, "dualLedger.snapshot.netFlow24hUsd"),
    queueBacklogCount: requiredNum(snapshot.queueBacklogCount, "dualLedger.snapshot.queueBacklogCount"),
    queueBacklogUsd,
    avgRiskScore: requiredNum(snapshot.avgRiskScore, "dualLedger.snapshot.avgRiskScore"),
    coverageSeries,
    coverageSeriesPoints,
    coverageSeriesIntervalHours: typeof intervalHours === "number" && Number.isSafeInteger(intervalHours) && intervalHours > 0
      ? intervalHours : null,
    accounts,
    prev: {
      reserveUsd: requiredNum(prev.reserveUsd, "dualLedger.prev.reserveUsd"),
      netFlow24hUsd: requiredNum(prev.netFlow24hUsd, "dualLedger.prev.netFlow24hUsd"),
      queueBacklogCount: prev.queueBacklogCount == null ? null : requiredNum(prev.queueBacklogCount, "dualLedger.prev.queueBacklogCount"),
      avgRiskScore: prev.avgRiskScore == null ? null : requiredNum(prev.avgRiskScore, "dualLedger.prev.avgRiskScore"),
    },
  };
}

function normalizeLiquidity(raw: Record<string, unknown>, _ledger: BLedger): BLiquidity {
  const liabilities = requiredArr<Record<string, unknown>>(raw.liabilities, "liquidity.liabilities").map((item, index) => ({
    nm: requiredText(item.nm ?? item.label, `liquidity.liabilities.${index}.nm`),
    pc: requiredNum(item.pc, `liquidity.liabilities.${index}.pc`),
    amount: requiredNum(item.amount, `liquidity.liabilities.${index}.amount`),
    cat: catVar(item.cat, index),
    source: requiredText(item.source, `liquidity.liabilities.${index}.source`),
  }));
  return {
    coverage: requiredRow(raw.coverage, "liquidity.coverage"),
    liabilities,
    runway: requiredArr<Record<string, unknown>>(raw.runway, "liquidity.runway").map((item, index) => ({
      day: requiredText(item.day, `liquidity.runway.${index}.day`),
      valueWan: requiredNum(item.valueWan, `liquidity.runway.${index}.valueWan`),
    })),
    runwayTotalWan: requiredNum(raw.runwayTotalWan, "liquidity.runwayTotalWan"),
    flow: requiredArr<Record<string, unknown>>(raw.flow, "liquidity.flow").map((item, index) => ({
      label: requiredText(item.label, `liquidity.flow.${index}.label`),
      valueWan: requiredNum(item.valueWan, `liquidity.flow.${index}.valueWan`),
    })),
  };
}

function normalizeFunnel(raw: Record<string, unknown>): BFunnel {
  return {
    stages: requiredArr<Record<string, unknown>>(raw.stages, "funnel.stages").map((item, index) => {
      const nm = requiredText(item.nm, `funnel.stages.${index}.nm`);
      const ct = requiredNum(item.ct, `funnel.stages.${index}.ct`);
      return {
        key: requiredText(item.key, `funnel.stages.${index}.key`),
        nm,
        ct,
        lc: requiredText(item.lc, `funnel.stages.${index}.lc`),
        conv: text(item.conv, "") || null,
        bad: bool(item.bad),
        color: requiredText(item.color, `funnel.stages.${index}.color`),
        label: nm,
        count: ct,
        prevCount: requiredNum(item.prevCount, `funnel.stages.${index}.prevCount`),
      };
    }),
    transitions: requiredArr<Record<string, unknown>>(raw.transitions, "funnel.transitions").map((item, index) => ({
      nm: requiredText(item.nm ?? item.a, `funnel.transitions.${index}.nm`),
      from: requiredText(item.from, `funnel.transitions.${index}.from`),
      to: requiredText(item.to, `funnel.transitions.${index}.to`),
      v: requiredText(item.v, `funnel.transitions.${index}.v`),
      vColor: text(item.vColor, ""),
      flow: requiredText(item.flow, `funnel.transitions.${index}.flow`),
      note: text(item.note),
      noteKind: (["muted", "up", "dn"].includes(text(item.noteKind)) ? text(item.noteKind) : "muted") as "muted" | "up" | "dn",
      bad: bool(item.bad),
    })),
    cohort: requiredArr<unknown>(raw.cohort, "funnel.cohort").map((item, index) => requiredNum(item, `funnel.cohort.${index}`)),
    channels: requiredArr<Record<string, unknown>>(raw.channels, "funnel.channels").map((item, index) => ({
      nm: requiredText(item.nm, `funnel.channels.${index}.nm`),
      pc: requiredNum(item.pc ?? item.v, `funnel.channels.${index}.pc`),
      catVar: catVar(item.catVar ?? item.c, index),
      q: text(item.q, ""),
    })),
    daily: requiredArr<unknown>(raw.daily, "funnel.daily").map((item, index) => requiredNum(item, `funnel.daily.${index}`)),
    dailyTarget: requiredNum(raw.dailyTarget, "funnel.dailyTarget"),
    overallConversionPct: requiredNum(raw.overallConversionPct, "funnel.overallConversionPct"),
  };
}

function normalizeRhythm(raw: Record<string, unknown>): BRhythm {
  const h1 = requiredRow(raw.h1, "rhythm.h1");
  return {
    h1: {
      // B-1: an unconfigured H1 rhythm reports "" with phase name 未配置; show that instead of failing the board.
      currentPhase: h1.currentPhase === "" ? "" : requiredText(h1.currentPhase, "rhythm.h1.currentPhase"),
      currentPhaseName: requiredText(h1.currentPhaseName, "rhythm.h1.currentPhaseName"),
      currentMonth: requiredNum(h1.currentMonth, "rhythm.h1.currentMonth"),
      totalMonths: requiredNum(h1.totalMonths, "rhythm.h1.totalMonths"),
      phaseProgressPct: requiredNum(h1.phaseProgressPct, "rhythm.h1.phaseProgressPct"),
    },
    phaseNodes: requiredArr<Record<string, unknown>>(raw.phaseNodes, "rhythm.phaseNodes").map((item, index) => ({
      code: requiredText(item.code, `rhythm.phaseNodes.${index}.code`),
      name: requiredText(item.name, `rhythm.phaseNodes.${index}.name`),
      intensity: requiredNum(item.intensity, `rhythm.phaseNodes.${index}.intensity`),
    })),
    inflowWan: requiredArr<unknown>(raw.inflowWan, "rhythm.inflowWan").map((item, index) => requiredNum(item, `rhythm.inflowWan.${index}`)),
    budget: requiredArr<Record<string, unknown>>(raw.budget, "rhythm.budget").map((item, index) => ({
      nm: requiredText(item.nm, `rhythm.budget.${index}.nm`),
      pc: requiredNum(item.pc ?? item.v, `rhythm.budget.${index}.pc`),
      varName: catVar(item.varName ?? item.c, index),
    })),
    ratio: requiredArr<unknown>(raw.ratio, "rhythm.ratio").map((item, index) => requiredNum(item, `rhythm.ratio.${index}`)),
    healthyRatio: requiredNum(raw.healthyRatio, "rhythm.healthyRatio"),
    currentRatio: requiredNum(raw.currentRatio, "rhythm.currentRatio"),
    suggestion: requiredText(raw.suggestion, "rhythm.suggestion"),
  };
}

function normalizeRiskFeed(raw: unknown, index: number): RiskFeedItem {
  const field = `riskRadar.feed.${index}`;
  const item = requiredRow(raw, field);
  const sev = item.sev as RiskSev;
  const invalid = () => { throw new Error(`B_DOMAIN_FIELD_REQUIRED:${field}`); };
  if (!RISK_SEVERITIES.includes(sev)) invalid();
  const base = {
    sev,
    t: requiredText(item.t, `${field}.t`),
    m: requiredText(item.m, `${field}.m`),
    href: requiredText(item.href, `${field}.href`),
  };
  const count = (key: string) => {
    const value = requiredNum(item[key], `${field}.${key}`);
    if (!Number.isSafeInteger(value) || value < 0) invalid();
    return value;
  };
  const time = (key: string) => {
    const value = item[key];
    if (!isOffsetDateTime(value)) throw new Error(`B_DOMAIN_FIELD_REQUIRED:${field}.${key}`);
    return value;
  };
  if (item.category !== undefined) {
    if (!isSignalCategory(item.category) || item.handlingStatus !== "open" || item.band !== undefined) {
      throw new Error(`B_DOMAIN_FIELD_REQUIRED:${field}.category`);
    }
    return { ...base, category: item.category, categoryName: requiredText(item.categoryName, `${field}.categoryName`),
      count: count("count"), accountCount: count("accountCount"), latestAt: time("latestAt"),
      startAt: time("startAt"), endAt: time("endAt"), handlingStatus: item.handlingStatus };
  }
  if (item.band !== undefined) {
    const band = item.band as ScoreBand | "HIGH";
    if (band !== "HIGH" && !SCORE_BANDS.includes(band)) invalid();
    return { ...base, band, count: count("count") };
  }
  return { ...base,
    ...(item.count === undefined ? {} : { count: count("count") }),
    ...(item.accountCount === undefined ? {} : { accountCount: count("accountCount") }),
    ...(item.latestAt === undefined ? {} : { latestAt: time("latestAt") }),
    ...(item.startAt === undefined ? {} : { startAt: time("startAt") }),
    ...(item.endAt === undefined ? {} : { endAt: time("endAt") }) };
}

function normalizeRisk(raw: Record<string, unknown>): BRiskRadar {
  const risk = {
    gates: requiredArr<Record<string, unknown>>(raw.gates, "riskRadar.gates").map((item, index) => {
      const rawState = text(item.state);
      const state = (["on", "off", "missing"].includes(rawState)
        ? rawState
        : requiredBool(item.on, `riskRadar.gates.${index}.on`) ? "on" : "off") as "on" | "off" | "missing";
      return {
        nm: requiredText(item.nm, `riskRadar.gates.${index}.nm`),
        dom: requiredText(item.dom, `riskRadar.gates.${index}.dom`),
        on: state === "missing" ? true : state === "on",
        state,
        configKey: text(item.configKey, ""),
        // 没有配置行时后端发 default_off，业务按关闭处理（KillSwitchState 失败关闭），页面写「已关停」，原因放问号。
        unset: rawState === "default_off",
      };
    }),
    trippedGateCount: requiredNum(raw.trippedGateCount, "riskRadar.trippedGateCount"),
    feed: requiredArr<unknown>(raw.feed, "riskRadar.feed").map(normalizeRiskFeed),
    pressureSeries: requiredArr<unknown>(raw.pressureSeries, "riskRadar.pressureSeries").map((item, index) => requiredNum(item, `riskRadar.pressureSeries.${index}`)),
    pressureTightPct: requiredNum(raw.pressureTightPct, "riskRadar.pressureTightPct"),
    currentPressurePct: requiredNum(raw.currentPressurePct, "riskRadar.currentPressurePct"),
    rules: requiredArr<Record<string, unknown>>(raw.rules, "riskRadar.rules").map((item, index) => ({
      nm: requiredText(item.nm, `riskRadar.rules.${index}.nm`),
      ct: requiredNum(item.ct, `riskRadar.rules.${index}.ct`),
      sev: text(item.sev, ""),
      dom: text(item.dom, ""),
    })),
    flaggedAccounts: requiredNum(raw.flaggedAccounts, "riskRadar.flaggedAccounts"),
    severity: requiredArr<Record<string, unknown>>(raw.severity, "riskRadar.severity").map((item, index) => ({
      nm: requiredText(item.nm, `riskRadar.severity.${index}.nm`),
      count: requiredNum(item.count ?? item.v, `riskRadar.severity.${index}.count`),
      c: requiredText(item.c, `riskRadar.severity.${index}.c`),
    })),
    volume: requiredArr<Record<string, unknown>>(raw.volume, "riskRadar.volume").map((item, index) => ({
      label: requiredText(item.label, `riskRadar.volume.${index}.label`),
      count: requiredNum(item.count ?? item.v, `riskRadar.volume.${index}.count`),
    })),
    bankRunRatio: requiredNum(raw.bankRunRatio, "riskRadar.bankRunRatio"),
    bankRunYellowPct: requiredNum(raw.bankRunYellowPct, "riskRadar.bankRunYellowPct"),
    bankRunRedlinePct: requiredNum(raw.bankRunRedlinePct, "riskRadar.bankRunRedlinePct"),
  };
  const expectedGateKeys = ["withdraw", "staking", "genesis", "exchange", "trial"];
  const actualGateKeys = risk.gates.map((gate) => gate.dom);
  if (actualGateKeys.length !== expectedGateKeys.length
      || new Set(actualGateKeys).size !== expectedGateKeys.length
      || expectedGateKeys.some((key) => !actualGateKeys.includes(key))) {
    throw new Error("B_DOMAIN_FIELD_INVALID:riskRadar.gates");
  }
  const trippedGateCount = risk.gates.filter((gate) => !gate.on).length;
  if (!Number.isInteger(risk.trippedGateCount) || risk.trippedGateCount !== trippedGateCount) {
    throw new Error("B_DOMAIN_FIELD_INVALID:riskRadar.trippedGateCount");
  }
  if (risk.bankRunRatio < 0
      || risk.bankRunYellowPct < 5
      || risk.bankRunYellowPct > 50
      || risk.bankRunRedlinePct < 10
      || risk.bankRunRedlinePct > 80
      || risk.bankRunRedlinePct <= risk.bankRunYellowPct) {
    throw new Error("B_DOMAIN_FIELD_INVALID:riskRadar.bankRunThresholds");
  }
  return risk;
}

export function normalizeBDomainDashboard(raw: Record<string, unknown> | null | undefined): BDomainDashboard {
  const source = requiredRow(raw, "data");
  const dualLedger = requiredRow(source.dualLedger, "dualLedger");
  const ledger = normalizeLedger(dualLedger);
  return {
    generatedAt: requiredText(source.generatedAt, "generatedAt"),
    sources: requiredArr<string>(source.sources, "sources"),
    warnings: requiredArr<Record<string, unknown>>(source.warnings, "warnings").map((item, index) => ({
      key: requiredText(item.key, `warnings.${index}.key`),
      code: requiredText(item.code, `warnings.${index}.code`),
      message: requiredText(item.message, `warnings.${index}.message`),
    })),
    alerts: {
      coverageRedlineAcked: requiredBool(requiredRow(source.alerts, "alerts").coverageRedlineAcked, "alerts.coverageRedlineAcked"),
      sources: requiredArr<string>(requiredRow(source.alerts, "alerts").sources, "alerts.sources"),
    },
    ledger,
    liquidity: normalizeLiquidity(requiredRow(source.liquidity, "liquidity"), ledger),
    rhythm: normalizeRhythm(requiredRow(source.rhythm, "rhythm")),
    riskRadar: normalizeRisk(requiredRow(source.riskRadar, "riskRadar")),
  };
}

type RiskFeedMode = "default" | "OPEN_BY_CATEGORY";
type DashboardRead = { data: BDomainDashboard; at: string };

const cachedDashboards = new Map<string, DashboardRead>();
type InflightDashboard = { task: Promise<DashboardRead>; replacedBy?: Promise<DashboardRead> };
const inflightDashboards = new Map<string, InflightDashboard>();
const dashboardSubscribers = new Map<string, Set<(read: DashboardRead) => void>>();

// The retained snapshots must not survive logout/relogin.
useAdminAuth.subscribe((state, previous) => {
  if (state.authEpoch === previous.authEpoch) return;
  cachedDashboards.clear();
  inflightDashboards.clear();
});

function currentSessionKey() {
  const state = useAdminAuth.getState();
  return adminShellSessionKey(state.session, state.authEpoch);
}

function dashboardKey(sessionKey: string, mode: RiskFeedMode) {
  return `${sessionKey}:${mode}`;
}

function publishDashboard(sessionKey: string, dashboard: BDomainDashboard, mode: RiskFeedMode = "default") {
  const read = { data: dashboard, at: new Date().toISOString() };
  if (sessionKey === currentSessionKey()) {
    const key = dashboardKey(sessionKey, mode);
    cachedDashboards.set(key, read);
    dashboardSubscribers.get(key)?.forEach((subscriber) => subscriber(read));
  }
  return read;
}

function readBDomainResponse(response: Response) {
  return response.text().then(raw => JSON.parse(raw.replace(/("coverageRatio"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g,
    (_match, key: string, value: string) => `${key}${JSON.stringify(f4Decimal(value) ?? value)}`))).catch(() => null) as Promise<ApiResult<Record<string, unknown>> | null>;
}

async function readBDomainDashboard(mode: RiskFeedMode) {
  const query = mode === "default" ? "" : `?riskFeed=${mode}`;
  const response = await guardedFetch(`/api/admin/treasury/b-domain${query}`, { cache: "no-store" });
  const result = await readBDomainResponse(response);
  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    throw new Error(formatAdminApiError(result?.message, `B_DOMAIN_${response.status}`, "read"));
  }
  if (!result.data) throw new Error("B_DOMAIN_EMPTY_RESPONSE");
  return normalizeBDomainDashboard(result.data);
}

function loadBDomainDashboard(sessionKey: string, mode: RiskFeedMode, force = false) {
  const key = dashboardKey(sessionKey, mode);
  const existing = inflightDashboards.get(key);
  if (existing && !force) return existing.task;
  const pending: InflightDashboard = { task: readBDomainDashboard(mode)
    .then(data => pending.replacedBy ?? publishDashboard(sessionKey, data, mode), cause => {
      if (pending.replacedBy) return pending.replacedBy;
      throw cause;
    })
    .finally(() => {
      if (inflightDashboards.get(key) === pending) inflightDashboards.delete(key);
    }) };
  if (existing) existing.replacedBy = pending.task;
  inflightDashboards.set(key, pending);
  return pending.task;
}

export async function fetchBDomainDashboard(sessionKey = currentSessionKey(), mode: RiskFeedMode = "default", force = false) {
  return (await loadBDomainDashboard(sessionKey, mode, force)).data;
}

export async function acknowledgeBDomainAlert(
  alertId: string,
  reason: string,
  operator: string,
  idempotencyKey?: string,
) {
  const sessionKey = currentSessionKey();
  const response = await guardedFetch(`/api/admin/treasury/b-domain/alerts/${encodeURIComponent(alertId)}/ack`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey || nextId("b-alert-ack"),
    },
    body: JSON.stringify({ reason, operator }),
    cache: "no-store",
  });
  const result = await readBDomainResponse(response);
  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) {
      resetAdminSession();
    }
    throw new Error(formatAdminApiError(result?.message, `B_ALERT_ACK_${response.status}`));
  }
  if (!result.data) {
    throw new Error("B_ALERT_ACK_EMPTY_RESPONSE");
  }
  const dashboard = normalizeBDomainDashboard(result.data);
  publishDashboard(sessionKey, dashboard);
  return dashboard;
}

export async function updateB5BankRunThresholds(
  values: { yellowPct?: string; redlinePct?: string },
  reason: string,
  operator: string,
) {
  const sessionKey = currentSessionKey();
  const response = await guardedFetch("/api/admin/treasury/b-domain/bankrun-thresholds", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": nextId("b5-bankrun-threshold"),
    },
    body: JSON.stringify({ ...values, reason, operator }),
    cache: "no-store",
  });
  const result = await readBDomainResponse(response);
  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    throw new Error(formatAdminApiError(result?.message, `B5_BANKRUN_${response.status}`));
  }
  if (!result.data) throw new Error("B5_BANKRUN_EMPTY_RESPONSE");
  const dashboard = normalizeBDomainDashboard(result.data);
  publishDashboard(sessionKey, dashboard);
  return dashboard;
}

export function useBDomainDashboard(enabled = true, mode: RiskFeedMode = "default") {
  const session = useAdminAuth((state) => state.session);
  const authEpoch = useAdminAuth((state) => state.authEpoch);
  const sessionKey = adminShellSessionKey(session, authEpoch);
  const key = dashboardKey(sessionKey, mode);
  const [snapshot, setSnapshot] = useState<{
    key: string; read: DashboardRead | null; loading: boolean; error: string | null;
  }>();

  const reload = useCallback(async (force = false) => {
    if (!enabled) return;
    setSnapshot(current => ({
      key, read: cachedDashboards.get(key) ?? null, loading: true,
      error: mode === "OPEN_BY_CATEGORY" && current?.key === key ? current.error : null,
    }));
    try {
      return await fetchBDomainDashboard(sessionKey, mode, force);
    } catch (cause) {
      setSnapshot(current => current?.key === key && currentSessionKey() === sessionKey
        ? { ...current, loading: false, error: displayAdminError(cause) } : current);
    }
  }, [enabled, key, mode, sessionKey]);

  useEffect(() => {
    if (!enabled) return;
    const subscribers = dashboardSubscribers.get(key) ?? new Set();
    const subscriber = (read: DashboardRead) => setSnapshot({ key, read, error: null, loading: false });
    subscribers.add(subscriber);
    dashboardSubscribers.set(key, subscribers);
    void reload();
    return () => {
      subscribers.delete(subscriber);
      if (!subscribers.size) dashboardSubscribers.delete(key);
    };
  }, [enabled, key, reload]);

  const current = snapshot?.key === key ? snapshot : undefined;
  const read = enabled ? current?.read ?? cachedDashboards.get(key) ?? null : null;
  return {
    ...(read?.data ?? EMPTY_B_DOMAIN),
    data: read?.data ?? null,
    hasData: !!read,
    readAt: read?.at ?? null,
    loading: enabled && (current?.loading ?? !read),
    error: enabled ? current?.error ?? null : null,
    reload,
  };
}
