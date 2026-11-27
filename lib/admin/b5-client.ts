"use client";

import { useEffect, useState } from "react";
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { displayAdminError, displayAdminReadError, formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { normalizeB5Radar, normalizeB5Signal, normalizeB5SignalPage, PRESSURE_RED_LINE, type B5Radar } from "@/lib/admin/b5-radar-contract";
import { parseStrictFiniteNumber } from "@/lib/admin/strict-number";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { parseB5MoneyJson } from "@/lib/admin/b5-money";
import { B5_PATH } from "@/lib/admin/risk-feed";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useB5Read } from "./use-b5-read";

export { normalizeB5Radar, PRESSURE_RED_LINE, type B5Radar };
const B5_RADAR_ENDPOINT = "/api/admin/risk/radar";
const B5_THRESHOLD_PREVIEW_ENDPOINT = "/api/admin/risk/bankrun-thresholds/preview";
const B5_THRESHOLD_ENDPOINT = "/api/admin/risk/bankrun-thresholds";
const B5_SUBSCRIPTION_ENDPOINT = "/api/admin/risk/alert-subscription";
const B5_TRIAGE_ENDPOINT = "/api/admin/risk/radar/triage";
const B5_INBOX_ENDPOINT = "/api/admin/risk/radar/inbox";
const B5_SIGNALS_ENDPOINT = "/api/admin/risk/radar/signals";

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
  subscriber: string;
  subscriberDisplayName?: string | null;
};

export type B5InboxItem = {
  id: number;
  signalNo: string;
  deliveryStatus: string;
  receiptSource: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  acknowledgedAt: string | null;
};

export class B5OutcomeUnknownError extends Error {
  readonly unknownOutcome = true;
  constructor(public readonly commandKey: string, detail?: string) {
    // 传输层的说明（服务不可用、网关异常）已经写了「结果未知」，不再重复一遍。
    super(`${detail && !detail.includes("结果未知") ? `${detail} ` : ""}结果未知，可能已经生效。不要重复操作，到页面上方查询原操作，或按原操作重试。`);
    this.name = "B5OutcomeUnknownError";
  }
}

export class B5RequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: number, readonly backendMessage?: string) {
    super(message);
    this.name = "B5RequestError";
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

export function normalizeB5Subscription(value: unknown): B5Subscription {
  const subscription = row(value, "subscription");
  const version = num(subscription.version, "subscription.version");
  if (!Number.isSafeInteger(version)) invalid("subscription.version");
  return {
    inApp: bool(subscription.inApp, "subscription.inApp"),
    email: bool(subscription.email, "subscription.email"),
    webhook: bool(subscription.webhook, "subscription.webhook"),
    webhookUrl: typeof subscription.webhookUrl === "string" ? subscription.webhookUrl : invalid("subscription.webhookUrl"),
    version,
    sharedWith: text(subscription.sharedWith, "subscription.sharedWith"),
    emailMode: text(subscription.emailMode, "subscription.emailMode"),
    webhookMode: text(subscription.webhookMode, "subscription.webhookMode"),
    subscriber: text(subscription.subscriber, "subscription.subscriber"),
    subscriberDisplayName: optionalText(subscription.subscriberDisplayName, "subscription.subscriberDisplayName"),
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
      receiptSource: optionalText(delivery.receiptSource, `inbox.${index}.receiptSource`),
      deliveredAt: optionalText(delivery.deliveredAt, `inbox.${index}.deliveredAt`),
      readAt: optionalText(delivery.readAt, `inbox.${index}.readAt`),
      acknowledgedAt: optionalText(delivery.acknowledgedAt, `inbox.${index}.acknowledgedAt`),
    };
  });
}

function idempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function request<T>(endpoint: string, init?: RequestInit, preserveRejections = false): Promise<T> {
  // 传输层失败归「结果未知」(原来无 try/catch,裸 TypeError 到页面就被当确定失败弃号)。
  const commandKey = new Headers(init?.headers).get("Idempotency-Key");
  const authEpoch = useAdminAuth.getState().authEpoch;
  let response: Response;
  try {
    response = await guardedFetch(endpoint, { ...init, cache: "no-store" });
  } catch (error) {
    if (commandKey) throw new B5OutcomeUnknownError(commandKey);
    throw error;
  }
  const result = await response.text().then(parseB5MoneyJson).catch(() => null) as ApiResult<T> | null;
  const message = typeof result?.message === "string" ? result.message : undefined;
  if (isAdminAuthFailure(response.status, message) || result && isAdminAuthFailure(result.code, message)) resetAdminSession();
  if (commandKey && (response.headers.get("X-Nexion-Upstream-Outcome")?.toLowerCase() === "unknown"
    || !result || typeof result.code !== "number")) throw new B5OutcomeUnknownError(commandKey);
  if (!response.ok || !result || result.code !== 0 || result.data == null) {
    const error = new B5RequestError(formatAdminApiError(message, `B5_REQUEST_FAILED_${response.status}`, commandKey ? "write" : "read"),
      response.ok && typeof result?.code === "number" ? result.code : response.status, result?.code ?? response.status, message);
    // All B5 GETs use the page's read permission. Preview uses the separate threshold write permission.
    if (!init?.method && isPermissionDenied(error) && useAdminAuth.getState().authEpoch === authEpoch
      && window.location.pathname === B5_PATH) {
      announcePermissionDenied(B5_PATH);
    }
    if (commandKey && !preserveRejections && !isExplicitRejection(error)) throw new B5OutcomeUnknownError(commandKey, error.message);
    throw error;
  }
  return result.data;
}

/** The caller persists these exact bytes before sending; malformed success is still unknown. */
export async function sendB5StoredWrite(endpoint: string, method: string, body: string, commandKey: string): Promise<unknown> {
  return request(endpoint, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), "Idempotency-Key": commandKey },
    ...(body ? { body } : {}) }, true);
}

export async function fetchB5Radar() {
  return normalizeB5Radar(await request<unknown>(B5_RADAR_ENDPOINT));
}

export async function fetchB5Signals(query: string) {
  return normalizeB5SignalPage(await request<unknown>(`${B5_SIGNALS_ENDPOINT}?${query}`));
}

export async function fetchB5Signal(signalNo: string) {
  const signal = normalizeB5Signal(await request<unknown>(`${B5_SIGNALS_ENDPOINT}/${encodeURIComponent(signalNo)}`));
  if (signal.signalNo !== signalNo) invalid("signal.signalNo");
  return signal;
}

export async function fetchB5Subscription() {
  return normalizeB5Subscription(await request<unknown>(B5_SUBSCRIPTION_ENDPOINT));
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
  const value = row(await request<unknown>(B5_THRESHOLD_PREVIEW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ yellowPct, redPct, expectedVersion }),
  }), "preview");
  const ratio24h = nullableNum(value.ratio24h, "preview.ratio24h");
  const ratioCalculable = bool(value.ratioCalculable, "preview.ratioCalculable");
  const state = text(value.light, "preview.light");
  const version = num(value.expectedVersion, "preview.expectedVersion");
  if (version !== expectedVersion || !["red", "yellow", "green", "unavailable"].includes(state)
    || ratioCalculable !== (ratio24h !== null) || ratioCalculable && state === "unavailable"
    || !ratioCalculable && state !== "red" && state !== "unavailable") invalid("preview");
  return { ratio24h, ratioCalculable, light: state as Light | "unavailable", expectedVersion: version };
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
  return normalizeB5Subscription(await request<unknown>(B5_SUBSCRIPTION_ENDPOINT, {
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
  const receipt = await request<{ dimension: string; target: string }>(B5_TRIAGE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": commandKey },
    body: JSON.stringify({ dimension, target, operator }),
  }, true);
  if (receipt.dimension !== dimension || receipt.target !== target) throw new B5OutcomeUnknownError(commandKey);
  return receipt;
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
  return request<{ signalNo: string; handlingStatus: string; handlingVersion: number }>(
    `/api/admin/risk/radar/signals/${encodeURIComponent(signalNo)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": commandKey },
      body: JSON.stringify({ targetStatus, expectedStatus, expectedVersion, reason, operator }),
    });
}

export function useB5Radar(key: string, enabled: boolean) {
  const radar = useB5Read(key, fetchB5Radar, enabled);
  const { reload, setData } = radar;
  const [streamStatus, setStreamStatus] = useState<{ warning: string; exhausted?: boolean } | null>(null);
  const [connection, setConnection] = useState(0);
  const canConnect = enabled;

  useEffect(() => {
    if (!canConnect) return;
    setStreamStatus(null);
    let stream: EventSource | null = null;
    let retryTimer: number | undefined;
    let stableTimer: number | undefined;
    let attempts = 0;
    const onRadar = (event: Event) => {
      try {
        const next = normalizeB5Radar(parseB5MoneyJson((event as MessageEvent<string>).data));
        setData(next);
        setStreamStatus(null);
      } catch (cause) {
        setStreamStatus({ warning: displayAdminReadError(cause) });
      }
    };
    const disconnect = () => {
      window.clearTimeout(retryTimer);
      window.clearTimeout(stableTimer);
      if (!stream) return;
      stream.removeEventListener("radar", onRadar);
      stream.onopen = null;
      stream.onerror = null;
      stream.close();
      stream = null;
    };
    const connect = () => {
      const next = new EventSource(`${B5_RADAR_ENDPOINT}/stream`);
      stream = next;
      next.addEventListener("radar", onRadar);
      next.onopen = () => {
        setStreamStatus(null);
        stableTimer = window.setTimeout(() => { attempts = 0; }, 30_000);
      };
      next.onerror = () => {
        const closed = next.readyState === EventSource.CLOSED;
        disconnect();
        // EventSource doesn't expose HTTP status. Check a closed stream through the guarded read.
        if (closed && attempts === 0) void reload("auto");
        if (attempts >= 6) {
          setStreamStatus({ warning: "连接已断开，自动重连没有成功；每 30 秒自动刷新。", exhausted: true });
          return;
        }
        setStreamStatus({ warning: "连接已断开，正在重连；下面是最近一次的数据，每 30 秒自动刷新。" });
        retryTimer = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempts));
        attempts += 1;
      };
    };
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      attempts = 0;
      setStreamStatus(null);
      connect();
    };
    connect();
    // Full document navigation may skip React cleanup and leave the HTTP connection occupied.
    window.addEventListener("pagehide", disconnect);
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("pagehide", disconnect);
      window.removeEventListener("pageshow", restore);
      disconnect();
    };
  }, [canConnect, connection, reload, setData]);

  return {
    ...radar,
    streamWarning: canConnect ? streamStatus?.warning : undefined,
    reconnect: canConnect && streamStatus?.exhausted ? () => setConnection(value => value + 1) : undefined,
  };
}
