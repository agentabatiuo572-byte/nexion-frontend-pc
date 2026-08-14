"use client";

import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { useCallback, useEffect, useState } from "react";
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { displayAdminError, formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { normalizeB5Radar, PRESSURE_RED_LINE, type B5Radar } from "@/lib/admin/b5-radar-contract";
import { parseStrictFiniteNumber } from "@/lib/admin/strict-number";

export { normalizeB5Radar, PRESSURE_RED_LINE, type B5Radar };
const B5_RADAR_ENDPOINT = "/api/admin/risk/radar";
const B5_THRESHOLD_PREVIEW_ENDPOINT = "/api/admin/risk/bankrun-thresholds/preview";
const B5_THRESHOLD_ENDPOINT = "/api/admin/risk/bankrun-thresholds";
const B5_SUBSCRIPTION_ENDPOINT = "/api/admin/risk/alert-subscription";
const B5_TRIAGE_ENDPOINT = "/api/admin/risk/radar/triage";
const B5_INBOX_ENDPOINT = "/api/admin/risk/radar/inbox";

type ApiResult<T> = { code: number; message?: string; data?: T };
type Light = "green" | "yellow" | "red";

export type B5Subscription = {
  inApp: boolean;
  email: boolean;
  webhook: boolean;
  webhookUrl: string;
  version: number;
  sharedWith: string;
  emailMode: string;
  webhookMode: string;
};

export type B5InboxItem = {
  id: number;
  signalNo: string;
  deliveryStatus: string;
  receiptSource: string;
  deliveredAt: string;
  readAt: string | null;
  acknowledgedAt: string | null;
};

export class B5OutcomeUnknownError extends Error {
  constructor(public readonly commandKey: string) {
    super(`本次操作结果未知，可能已经生效。请先刷新核对；如需重试，请保持输入不变并使用当前操作重试。请求号：${commandKey}`);
    this.name = "B5OutcomeUnknownError";
  }
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

function invalid(field: string): never {
  throw new Error(`B5_RESPONSE_INVALID:${field}`);
}

function normalizeSubscription(value: unknown): B5Subscription {
  const subscription = row(value, "subscription");
  return {
    inApp: bool(subscription.inApp, "subscription.inApp"),
    email: bool(subscription.email, "subscription.email"),
    webhook: bool(subscription.webhook, "subscription.webhook"),
    webhookUrl: typeof subscription.webhookUrl === "string" ? subscription.webhookUrl : invalid("subscription.webhookUrl"),
    version: num(subscription.version, "subscription.version"),
    sharedWith: text(subscription.sharedWith, "subscription.sharedWith"),
    emailMode: text(subscription.emailMode, "subscription.emailMode"),
    webhookMode: text(subscription.webhookMode, "subscription.webhookMode"),
  };
}

function optionalText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return text(value, field);
}

function normalizeInbox(value: unknown): B5InboxItem[] {
  return arr(value, "inbox").map((item, index) => {
    const delivery = row(item, `inbox.${index}`);
    const id = num(delivery.id, `inbox.${index}.id`);
    if (!Number.isInteger(id) || id <= 0) invalid(`inbox.${index}.id`);
    return {
      id,
      signalNo: text(delivery.signalNo, `inbox.${index}.signalNo`),
      deliveryStatus: text(delivery.deliveryStatus, `inbox.${index}.deliveryStatus`),
      receiptSource: text(delivery.receiptSource, `inbox.${index}.receiptSource`),
      deliveredAt: text(delivery.deliveredAt, `inbox.${index}.deliveredAt`),
      readAt: optionalText(delivery.readAt, `inbox.${index}.readAt`),
      acknowledgedAt: optionalText(delivery.acknowledgedAt, `inbox.${index}.acknowledgedAt`),
    };
  });
}

function idempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function request<T>(endpoint: string, init?: RequestInit): Promise<T> {
  // 传输层失败归「结果未知」(原来无 try/catch,裸 TypeError 到页面就被当确定失败弃号)。
  let response: Response;
  try {
    response = await guardedFetch(endpoint, { ...init, cache: "no-store" });
  } catch (error) {
    const commandKey = new Headers(init?.headers).get("Idempotency-Key");
    if (commandKey) throw new B5OutcomeUnknownError(commandKey);
    throw error;
  }
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !result || result.code !== 0 || result.data === undefined) {
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    const commandKey = new Headers(init?.headers).get("Idempotency-Key");
    // unknown 头只是增强信号,不再是唯一保险丝:5xx / 响应不可读同样归结果未知。
    if (commandKey && (response.headers.get("X-Nexion-Upstream-Outcome")?.toLowerCase() === "unknown"
      || outcomeStaysUnknown(response.status, result?.code))) {
      throw new B5OutcomeUnknownError(commandKey);
    }
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

export async function fetchB5Inbox() {
  return normalizeInbox(await request<unknown>(B5_INBOX_ENDPOINT));
}

export async function acknowledgeB5Inbox(deliveryId: number, commandKey = idempotencyKey("b5-inbox-ack")) {
  return request<{ deliveryId: number; acknowledged: boolean }>(
    `${B5_INBOX_ENDPOINT}/${deliveryId}/acknowledge`, {
      method: "POST",
      headers: { "Idempotency-Key": commandKey },
    });
}

export async function previewB5Thresholds(yellowPct: number, redPct: number, expectedVersion: number) {
  return request<{ ratio24h: number | null; ratioCalculable: boolean; light: Light | "unavailable"; expectedVersion: number }>(B5_THRESHOLD_PREVIEW_ENDPOINT, {
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
  commandKey = idempotencyKey("b5-threshold"),
) {
  return normalizeB5Radar(await request<unknown>(B5_THRESHOLD_ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Idempotency-Key": commandKey },
    body: JSON.stringify({ yellowPct, redPct, expectedVersion, reason, operator }),
  }));
}

export async function updateB5Subscription(
  value: { inApp: boolean; email: boolean; webhook: boolean; webhookUrl: string },
  expectedVersion: number,
  operator: string,
  commandKey = idempotencyKey("b5-subscription"),
) {
  return normalizeSubscription(await request<unknown>(B5_SUBSCRIPTION_ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Idempotency-Key": commandKey },
    body: JSON.stringify({ ...value, expectedVersion, operator }),
  }));
}

export async function recordB5Triage(
  dimension: string,
  target: string,
  operator: string,
  commandKey = idempotencyKey("b5-triage"),
) {
  return request<{ dimension: string; target: string }>(B5_TRIAGE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": commandKey },
    body: JSON.stringify({ dimension, target, operator }),
  });
}

export async function updateB5SignalStatus(
  signalNo: string,
  targetStatus: "handled" | "resolved",
  expectedStatus: "open" | "handled",
  expectedVersion: number,
  reason: string,
  operator: string,
  commandKey = idempotencyKey("b5-signal-status"),
) {
  return request<{ signalNo: string; status: string; version: number }>(
    `/api/admin/risk/radar/signals/${encodeURIComponent(signalNo)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": commandKey },
      body: JSON.stringify({ targetStatus, expectedStatus, expectedVersion, reason, operator }),
    });
}

export function useB5Radar() {
  const [data, setData] = useState<B5Radar | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamWarning, setStreamWarning] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchB5Radar());
    } catch (cause) {
      setData(null);
      setError(displayAdminError(cause));
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
        setStreamWarning(null);
        setLoading(false);
      } catch (cause) {
        setData(null);
        setError(displayAdminError(cause));
      }
    };
    stream.addEventListener("radar", onRadar);
    stream.onerror = () => {
      setStreamWarning("实时通道正在重连；页面保留最近一次已确认数据，并继续每 30 秒从服务端核对。");
    };
    const timer = window.setInterval(() => void reload(), 30_000);
    return () => {
      window.clearInterval(timer);
      stream.removeEventListener("radar", onRadar);
      stream.close();
    };
  }, [reload]);

  return { data, loading, error, streamWarning, reload, setData };
}
