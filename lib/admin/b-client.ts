"use client";

import { useCallback, useEffect, useState } from "react";
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError } from "@/lib/admin/error-messages";

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
  coverageRatio: number;
  redlinePct: number;
  healthyPct: number;
  runRiskPct: number;
  pressureRatio: number;
  netFlow24hUsd: number;
  queueBacklogCount: number;
  queueBacklogUsd: number;
  avgRiskScore: number;
  coverageSeries: number[];
  accounts: BLedgerAccount[];
  prev: {
    reserveUsd: number;
    netFlow24hUsd: number;
    queueBacklogCount: number;
    avgRiskScore: number;
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
  gates: Array<{ nm: string; dom: string; on: boolean; state?: "on" | "off" | "missing"; configKey?: string }>;
  trippedGateCount: number;
  feed: Array<{ sev: "p0" | "p1" | "p2" | "p3"; t: string; m: string; href: string }>;
  pressureSeries: number[];
  pressureTightPct: number;
  currentPressurePct: number;
  rules: Array<{ nm: string; ct: number; sev?: string; dom?: string }>;
  flaggedAccounts: number;
  severity: Array<{ nm: string; count: number; c: string }>;
  volume: Array<{ label: string; count: number }>;
  bankRunRatio: number;
}

export interface BDomainDashboard {
  generatedAt?: string;
  sources: string[];
  warnings: Array<{ key: string; code: string; message: string }>;
  alerts: { coverageRedlineAcked: boolean; sources: string[] };
  ledger: BLedger;
  liquidity: BLiquidity;
  funnel: BFunnel;
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
  coverageRatio: 0,
  redlinePct: 0,
  healthyPct: 0,
  runRiskPct: 0,
  pressureRatio: 0,
  netFlow24hUsd: 0,
  queueBacklogCount: 0,
  queueBacklogUsd: 0,
  avgRiskScore: 0,
  coverageSeries: [],
  accounts: [],
  prev: {
    reserveUsd: 0,
    netFlow24hUsd: 0,
    queueBacklogCount: 0,
    avgRiskScore: 0,
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
  funnel: {
    stages: [],
    transitions: [],
    cohort: [],
    channels: [],
    daily: [],
    dailyTarget: 0,
    overallConversionPct: 0,
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
  },
};

function num(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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

function arr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function row(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
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
  const snapshot = row(raw.snapshot);
  const reserveUsd = num(snapshot.reserveUsd);
  const liabilitiesUsd = num(snapshot.liabilitiesUsd);
  const queueBacklogUsd = num(snapshot.queueBacklogUsd);
  const accounts = arr<Record<string, unknown>>(raw.accounts).map((item, index) => {
    const amount = num(item.amount);
    return {
      key: text(item.key, `liability-${index + 1}`),
      label: text(item.label, `科目 ${index + 1}`),
      amount,
      source: text(item.source),
      pc: liabilitiesUsd > 0 ? Math.round((amount / liabilitiesUsd) * 1000) / 10 : 0,
      cat: CAT_VARS[index % CAT_VARS.length],
    };
  });
  const prev = row(raw.prev);
  const coverageSeries = arr<unknown>(snapshot.coverageSeries).map((item) => num(item));
  return {
    reserveUsd,
    liabilitiesUsd,
    coverageRatio: num(snapshot.coverageRatio),
    redlinePct: num(snapshot.redlinePct),
    healthyPct: num(snapshot.healthyPct),
    runRiskPct: num(snapshot.runRiskPct),
    pressureRatio: reserveUsd > 0 ? queueBacklogUsd / reserveUsd : 0,
    netFlow24hUsd: num(snapshot.netFlow24hUsd),
    queueBacklogCount: num(snapshot.queueBacklogCount),
    queueBacklogUsd,
    avgRiskScore: num(snapshot.avgRiskScore),
    coverageSeries,
    accounts,
    prev: {
      reserveUsd: num(prev.reserveUsd, reserveUsd),
      netFlow24hUsd: num(prev.netFlow24hUsd),
      queueBacklogCount: num(prev.queueBacklogCount),
      avgRiskScore: num(prev.avgRiskScore),
    },
  };
}

function normalizeLiquidity(raw: Record<string, unknown>, ledger: BLedger): BLiquidity {
  const liabilities = arr<Record<string, unknown>>(raw.liabilities).map((item, index) => ({
    nm: text(item.nm, text(item.label, `科目 ${index + 1}`)),
    pc: num(item.pc),
    amount: num(item.amount),
    cat: catVar(item.cat, index),
    source: text(item.source),
  }));
  return {
    coverage: row(raw.coverage),
    liabilities: liabilities.length
      ? liabilities
      : ledger.accounts.map((item) => ({ nm: item.label, pc: item.pc, amount: item.amount, cat: item.cat, source: item.source })),
    runway: arr<Record<string, unknown>>(raw.runway).map((item, index) => ({
      day: text(item.day, `D+${index + 1}`),
      valueWan: num(item.valueWan),
    })),
    runwayTotalWan: num(raw.runwayTotalWan),
    flow: arr<Record<string, unknown>>(raw.flow).map((item, index) => ({
      label: text(item.label, `W${index + 1}`),
      valueWan: num(item.valueWan),
    })),
  };
}

function normalizeFunnel(raw: Record<string, unknown>): BFunnel {
  return {
    stages: arr<Record<string, unknown>>(raw.stages).map((item, index) => {
      const nm = text(item.nm, `阶段 ${index + 1}`);
      const ct = num(item.ct);
      return {
        key: text(item.key, `stage-${index + 1}`),
        nm,
        ct,
        lc: text(item.lc),
        conv: text(item.conv, "") || null,
        bad: bool(item.bad),
        color: text(item.color, "var(--brand)"),
        label: nm,
        count: ct,
        prevCount: num(item.prevCount, ct),
      };
    }),
    transitions: arr<Record<string, unknown>>(raw.transitions).map((item) => ({
      nm: text(item.nm, text(item.a, "阶段转化")),
      from: text(item.from),
      to: text(item.to),
      v: text(item.v, "0%"),
      vColor: text(item.vColor, ""),
      flow: text(item.flow),
      note: text(item.note),
      noteKind: (["muted", "up", "dn"].includes(text(item.noteKind)) ? text(item.noteKind) : "muted") as "muted" | "up" | "dn",
      bad: bool(item.bad),
    })),
    cohort: arr<unknown>(raw.cohort).map((item) => num(item)),
    channels: arr<Record<string, unknown>>(raw.channels).map((item, index) => ({
      nm: text(item.nm, `渠道 ${index + 1}`),
      pc: num(item.pc, num(item.v)),
      catVar: catVar(item.catVar ?? item.c, index),
      q: text(item.q, ""),
    })),
    daily: arr<unknown>(raw.daily).map((item) => num(item)),
    dailyTarget: num(raw.dailyTarget),
    overallConversionPct: num(raw.overallConversionPct),
  };
}

function normalizeRhythm(raw: Record<string, unknown>): BRhythm {
  const h1 = row(raw.h1);
  return {
    h1: {
      currentPhase: text(h1.currentPhase),
      currentPhaseName: text(h1.currentPhaseName),
      currentMonth: num(h1.currentMonth),
      totalMonths: num(h1.totalMonths),
      phaseProgressPct: num(h1.phaseProgressPct),
    },
    phaseNodes: arr<Record<string, unknown>>(raw.phaseNodes).map((item, index) => ({
      code: text(item.code, `P${index + 1}`),
      name: text(item.name, `阶段 ${index + 1}`),
      intensity: num(item.intensity),
    })),
    inflowWan: arr<unknown>(raw.inflowWan).map((item) => num(item)),
    budget: arr<Record<string, unknown>>(raw.budget).map((item, index) => ({
      nm: text(item.nm, `预算 ${index + 1}`),
      pc: num(item.pc, num(item.v)),
      varName: catVar(item.varName ?? item.c, index),
    })),
    ratio: arr<unknown>(raw.ratio).map((item) => num(item)),
    healthyRatio: num(raw.healthyRatio),
    currentRatio: num(raw.currentRatio),
    suggestion: text(raw.suggestion),
  };
}

function normalizeRisk(raw: Record<string, unknown>): BRiskRadar {
  return {
    gates: arr<Record<string, unknown>>(raw.gates).map((item) => {
      const rawState = text(item.state);
      const state = (["on", "off", "missing"].includes(rawState) ? rawState : bool(item.on, true) ? "on" : "off") as "on" | "off" | "missing";
      return {
        nm: text(item.nm),
        dom: text(item.dom),
        on: state === "missing" ? true : state === "on",
        state,
        configKey: text(item.configKey, ""),
      };
    }),
    trippedGateCount: num(raw.trippedGateCount),
    feed: arr<Record<string, unknown>>(raw.feed).map((item) => ({
      sev: (["p0", "p1", "p2", "p3"].includes(text(item.sev)) ? text(item.sev) : "p2") as "p0" | "p1" | "p2" | "p3",
      t: text(item.t),
      m: text(item.m),
      href: text(item.href, "/overview/risk-radar"),
    })),
    pressureSeries: arr<unknown>(raw.pressureSeries).map((item) => num(item)),
    pressureTightPct: num(raw.pressureTightPct),
    currentPressurePct: num(raw.currentPressurePct),
    rules: arr<Record<string, unknown>>(raw.rules).map((item) => ({
      nm: text(item.nm),
      ct: num(item.ct),
      sev: text(item.sev, ""),
      dom: text(item.dom, ""),
    })),
    flaggedAccounts: num(raw.flaggedAccounts),
    severity: arr<Record<string, unknown>>(raw.severity).map((item, index) => ({
      nm: text(item.nm, `P${index}`),
      count: num(item.count, num(item.v)),
      c: text(item.c, CAT_VARS[index % CAT_VARS.length]),
    })),
    volume: arr<Record<string, unknown>>(raw.volume).map((item, index) => ({
      label: text(item.label, index === 6 ? "今日" : `D-${6 - index}`),
      count: num(item.count, num(item.v)),
    })),
    bankRunRatio: num(raw.bankRunRatio),
  };
}

export function normalizeBDomainDashboard(raw: Record<string, unknown> | null | undefined): BDomainDashboard {
  const dualLedger = row(raw?.dualLedger);
  const ledger = normalizeLedger(dualLedger);
  return {
    generatedAt: text(raw?.generatedAt, ""),
    sources: arr<string>(raw?.sources),
    warnings: arr<Record<string, unknown>>(raw?.warnings).map((item) => ({
      key: text(item.key),
      code: text(item.code, "B_CONFIG_WARNING"),
      message: text(item.message, text(item.code, "B_CONFIG_WARNING")),
    })),
    alerts: {
      coverageRedlineAcked: bool(row(raw?.alerts).coverageRedlineAcked),
      sources: arr<string>(row(raw?.alerts).sources),
    },
    ledger,
    liquidity: normalizeLiquidity(row(raw?.liquidity), ledger),
    funnel: normalizeFunnel(row(raw?.funnel)),
    rhythm: normalizeRhythm(row(raw?.rhythm)),
    riskRadar: normalizeRisk(row(raw?.riskRadar)),
  };
}

let cachedDashboard: BDomainDashboard | null = null;
let inflightDashboard: Promise<BDomainDashboard> | null = null;
const dashboardSubscribers = new Set<(dashboard: BDomainDashboard) => void>();

function publishDashboard(dashboard: BDomainDashboard) {
  cachedDashboard = dashboard;
  dashboardSubscribers.forEach((subscriber) => subscriber(dashboard));
}

export async function fetchBDomainDashboard() {
  const response = await fetch("/api/admin/treasury/b-domain", { cache: "no-store" });
  const result = (await response.json().catch(() => null)) as ApiResult<Record<string, unknown>> | null;
  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) {
      resetAdminSession();
    }
    throw new Error(formatAdminApiError(result?.message, `B_DOMAIN_${response.status}`));
  }
  if (!result.data) {
    throw new Error("B_DOMAIN_EMPTY_RESPONSE");
  }
  const dashboard = normalizeBDomainDashboard(result.data);
  publishDashboard(dashboard);
  return dashboard;
}

export async function acknowledgeBDomainAlert(alertId: string, reason: string, operator: string) {
  const response = await fetch(`/api/admin/treasury/b-domain/alerts/${encodeURIComponent(alertId)}/ack`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": nextId("b-alert-ack"),
    },
    body: JSON.stringify({ reason, operator }),
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<Record<string, unknown>> | null;
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
  publishDashboard(dashboard);
  return dashboard;
}

export function useBDomainDashboard() {
  const [data, setData] = useState<BDomainDashboard | null>(cachedDashboard);
  const [loading, setLoading] = useState(!cachedDashboard);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      inflightDashboard = fetchBDomainDashboard().finally(() => {
        inflightDashboard = null;
      });
      const next = await inflightDashboard;
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "B_DOMAIN_LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const subscriber = (next: BDomainDashboard) => {
      if (alive) {
        setData(next);
        setError(null);
        setLoading(false);
      }
    };
    dashboardSubscribers.add(subscriber);
    setLoading(!cachedDashboard);
    setError(null);
    const task =
      inflightDashboard ??
      (inflightDashboard = fetchBDomainDashboard().finally(() => {
        inflightDashboard = null;
      }));
    task
      .then((next) => {
        if (alive) setData(next);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "B_DOMAIN_LOAD_FAILED");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      dashboardSubscribers.delete(subscriber);
    };
  }, []);

  return { ...(data ?? EMPTY_B_DOMAIN), data, hasData: !!data, loading, error, reload };
}
