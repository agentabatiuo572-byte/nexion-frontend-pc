"use client";

import { useCallback, useEffect, useState } from "react";
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError } from "@/lib/admin/error-messages";

export const PRESSURE_RED_LINE = 0.7;
const B5_RADAR_ENDPOINT = "/api/admin/risk/radar";
const B5_THRESHOLD_PREVIEW_ENDPOINT = "/api/admin/risk/bankrun-thresholds/preview";
const B5_THRESHOLD_ENDPOINT = "/api/admin/risk/bankrun-thresholds";
const B5_SUBSCRIPTION_ENDPOINT = "/api/admin/risk/alert-subscription";
const B5_TRIAGE_ENDPOINT = "/api/admin/risk/radar/triage";
const GATE_KEYS = ["withdraw", "staking", "genesis", "exchange", "trial"] as const;
const BACKLOG_STATES = ["submitted", "review-passed", "processing"] as const;

type ApiResult<T> = { code: number; message?: string; data?: T };
type Light = "green" | "yellow" | "red";

export type B5Radar = {
  generatedAt: string;
  bankrun: {
    ratio24h: number;
    light: Light;
    withdraw24hUsdt: number;
    reserveUsdt: number;
    pressureRatio: number;
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
  coverage: { ratio: number; light: Light; redlinePct: number; reserveUsdt: number; liabilitiesUsdt: number };
  sources: string[];
};

export type B5Subscription = {
  inApp: boolean;
  email: boolean;
  webhook: boolean;
  webhookUrl: string;
  sharedWith: string;
};

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
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) invalid(field);
  return parsed;
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

function invalid(field: string): never {
  throw new Error(`B5_RESPONSE_INVALID:${field}`);
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
    throw new Error("B5_RESPONSE_INVALID:killSwitches");
  }

  const byState = arr(backlog.byState, "withdrawBacklog.byState").map((value, index) => {
    const item = row(value, `withdrawBacklog.byState.${index}`);
    return {
      state: text(item.state, `withdrawBacklog.byState.${index}.state`) as typeof BACKLOG_STATES[number],
      count: num(item.count, `withdrawBacklog.byState.${index}.count`),
      amountUsdt: num(item.amountUsdt, `withdrawBacklog.byState.${index}.amountUsdt`),
      overSlaCount: num(item.overSlaCount, `withdrawBacklog.byState.${index}.overSlaCount`),
      slaHours: num(item.slaHours, `withdrawBacklog.byState.${index}.slaHours`),
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
      count: num(item.count, `abnormalAccounts.byCategory.${index}.count`),
    };
  });
  if (!byCategory.length) invalid("abnormalAccounts.byCategory");

  const pressureRedLine = num(bankrun.pressureRedLine, "bankrun.pressureRedLine");
  const yellowPct = num(bankrun.yellowPct, "bankrun.yellowPct");
  const redPct = num(bankrun.redPct, "bankrun.redPct");
  if (pressureRedLine !== PRESSURE_RED_LINE || yellowPct < 5 || yellowPct > 50
      || redPct < 10 || redPct > 80 || redPct <= yellowPct) {
    invalid("bankrun.thresholds");
  }

  return {
    generatedAt: text(source.generatedAt, "generatedAt"),
    bankrun: {
      ratio24h: num(bankrun.ratio24h, "bankrun.ratio24h"),
      light: light(bankrun.light, "bankrun.light"),
      withdraw24hUsdt: num(bankrun.withdraw24hUsdt, "bankrun.withdraw24hUsdt"),
      reserveUsdt: num(bankrun.reserveUsdt, "bankrun.reserveUsdt"),
      pressureRatio: num(bankrun.pressureRatio, "bankrun.pressureRatio"),
      pressureRedLine,
      pressureLight: light(bankrun.pressureLight, "bankrun.pressureLight"),
      yellowPct,
      redPct,
      version: num(bankrun.version, "bankrun.version"),
    },
    abnormalAccounts: { count: num(abnormal.count, "abnormalAccounts.count"), byCategory },
    withdrawBacklog: {
      byState,
      totalCount: num(backlog.totalCount, "withdrawBacklog.totalCount"),
      totalAmountUsdt: num(backlog.totalAmountUsdt, "withdrawBacklog.totalAmountUsdt"),
      slaHours: num(backlog.slaHours, "withdrawBacklog.slaHours"),
      overSlaCount: num(backlog.overSlaCount, "withdrawBacklog.overSlaCount"),
      light: light(backlog.light, "withdrawBacklog.light"),
    },
    killSwitches: gates,
    coverage: {
      ratio: num(coverage.ratio, "coverage.ratio"),
      light: light(coverage.light, "coverage.light"),
      redlinePct: num(coverage.redlinePct, "coverage.redlinePct"),
      reserveUsdt: num(coverage.reserveUsdt, "coverage.reserveUsdt"),
      liabilitiesUsdt: num(coverage.liabilitiesUsdt, "coverage.liabilitiesUsdt"),
    },
    sources: arr(source.sources, "sources").map((value, index) => text(value, `sources.${index}`)),
  };
}

function normalizeSubscription(value: unknown): B5Subscription {
  const subscription = row(value, "subscription");
  return {
    inApp: bool(subscription.inApp, "subscription.inApp"),
    email: bool(subscription.email, "subscription.email"),
    webhook: bool(subscription.webhook, "subscription.webhook"),
    webhookUrl: typeof subscription.webhookUrl === "string" ? subscription.webhookUrl : invalid("subscription.webhookUrl"),
    sharedWith: text(subscription.sharedWith, "subscription.sharedWith"),
  };
}

function idempotencyKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function request<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const response = await fetch(endpoint, { ...init, cache: "no-store" });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !result || result.code !== 0 || result.data === undefined) {
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    throw new Error(formatAdminApiError(result?.message, `B5_REQUEST_FAILED_${response.status}`));
  }
  return result.data;
}

export async function fetchB5Radar() {
  return normalizeB5Radar(await request<unknown>(B5_RADAR_ENDPOINT));
}

export async function fetchB5Subscription() {
  return normalizeSubscription(await request<unknown>(B5_SUBSCRIPTION_ENDPOINT));
}

export async function previewB5Thresholds(yellowPct: number, redPct: number, expectedVersion: number) {
  return request<{ ratio24h: number; light: Light; expectedVersion: number }>(B5_THRESHOLD_PREVIEW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ yellowPct, redPct, expectedVersion }),
  });
}

export async function updateB5Thresholds(
  yellowPct: number,
  redPct: number,
  expectedVersion: number,
  reason: string,
  operator: string,
) {
  return normalizeB5Radar(await request<unknown>(B5_THRESHOLD_ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("b5-threshold") },
    body: JSON.stringify({ yellowPct, redPct, expectedVersion, reason, operator }),
  }));
}

export async function updateB5Subscription(
  value: { inApp: boolean; email: boolean; webhook: boolean; webhookUrl: string },
  operator: string,
) {
  return normalizeSubscription(await request<unknown>(B5_SUBSCRIPTION_ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("b5-subscription") },
    body: JSON.stringify({ ...value, operator }),
  }));
}

export async function recordB5Triage(dimension: string, target: string, operator: string) {
  return request<{ dimension: string; target: string }>(B5_TRIAGE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("b5-triage") },
    body: JSON.stringify({ dimension, target, operator }),
  });
}

export function useB5Radar() {
  const [data, setData] = useState<B5Radar | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchB5Radar());
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "B5_REQUEST_FAILED");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const stream = new EventSource(`${B5_RADAR_ENDPOINT}/stream`);
    const onRadar = (event: Event) => {
      try {
        const next = normalizeB5Radar(JSON.parse((event as MessageEvent<string>).data));
        setData(next);
        setError(null);
        setLoading(false);
      } catch (cause) {
        setData(null);
        setError(cause instanceof Error ? cause.message : "B5_RESPONSE_INVALID:stream");
      }
    };
    stream.addEventListener("radar", onRadar);
    stream.onerror = () => {
      setData(null);
      setError("B5_STREAM_DISCONNECTED");
    };
    const timer = window.setInterval(() => void reload(), 30_000);
    return () => {
      window.clearInterval(timer);
      stream.removeEventListener("radar", onRadar);
      stream.close();
    };
  }, [reload]);

  return { data, loading, error, reload, setData };
}
