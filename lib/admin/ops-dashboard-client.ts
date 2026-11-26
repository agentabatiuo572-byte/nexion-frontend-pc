"use client";

import { useEffect, useState } from "react";
import { displayAdminReadError, formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { UNAVAILABLE_GATES } from "@/lib/admin/j-client";

type ApiResult<T> = {
  code?: number;
  message?: string;
  data?: T;
};

export type OpsDashboardAlert = {
  id: string;
  domain: string;
  level: "high" | "mid" | "low";
  title: string;
  hint: string;
  userCode?: string;
  occurredAt?: string;
  /** 待补录的项数，只有 J1-AUTO-CONFIRM 带。 */
  count?: number;
  /** 没有开启的业务键，只有 J1-KILL-STATE 带。 */
  closedKeys?: string[];
};

const J1_ALERT_GATE_KEYS = ["withdraw", "staking", "genesis", "exchange", "trial"] as const;

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`OPS_DASHBOARD_FIELD_REQUIRED:${field}`);
  }
  return value.trim();
}

const ACCOUNT_ALERT_TITLES = new Map([
  ["admin.user_frozen", "冻结账户"],
  ["admin.user_unfrozen", "恢复账户"],
  ["admin.user_impersonation_started", "开始查看用户数据"],
  ["admin.user_impersonation_ended", "结束只读视图"],
  ["admin.account_list_upserted", "加入账户名单"],
  ["admin.account_list_removed", "移出名单"],
  ["admin.2fa_disabled", "关闭两步验证"],
  ["admin.password_reset_requested", "要求重置登录密码"],
  ["admin.user_unlocked", "解除登录锁定"],
  ["admin.session_revoked", "撤销登录"],
  ["auth.login_locked", "登录失败过多，账户已锁定"],
  ["auth.refresh_token_reuse_detected", "登录凭证被重复使用，已全部下线"],
]);

const COUNTRY_CODE = /^[A-Z]{2}$/;

function geoAlertScope(scope: unknown, target: unknown) {
  switch (scope) {
    case "country": return typeof target === "string" && COUNTRY_CODE.test(target) ? `地区 ${target}` : "地区";
    case "country-list":
      if (target === "blocked") return "封锁名单";
      if (target === "limited") return "受限名单";
      return "地区名单";
    case "endpoint": return "功能入口规则";
    case "edge-source": return "地区识别源";
    case "country-batch": {
      const countries = typeof target === "string" ? target.split(",") : [];
      return countries.length > 0 && countries.every((country) => COUNTRY_CODE.test(country))
        ? `应急批量封锁 ${countries.join("、")}`
        : "应急批量封锁";
    }
    default: return undefined;
  }
}

function alertOperator(value: unknown) {
  if (typeof value !== "string" || !value.trim() || /^system$/i.test(value.trim())) return "系统";
  if (/^(?:admin:)?\d+$/i.test(value.trim())) return "管理员";
  return value;
}

function alertReason(value: unknown) {
  return typeof value === "string" && value.trim() ? value : "未填写原因";
}

function geoAlertHint(row: Record<string, unknown>, hint: string) {
  let { scope, target, operator, reason } = row;
  const fallback = hint.replace(/\bK4\b/g, "风险评分");
  if (typeof scope !== "string" || !scope.trim()) {
    const prefix = "J2 地域策略已变更 · ";
    const parts = /^(.*?) · (.*?) · ([\s\S]*)$/.exec(hint);
    if (typeof row.title !== "string" || !row.title.startsWith(prefix) || !parts) {
      return fallback;
    }
    scope = row.title.slice(prefix.length);
    [, target, operator, reason] = parts;
  }
  const range = geoAlertScope(scope, target);
  return range ? [range, alertOperator(operator), alertReason(reason)].join(" · ") : fallback;
}

function tamperAlertConfig(value: unknown) {
  if (!value || typeof value !== "object") return {};
  const config = value as Record<string, unknown>;
  return {
    threshold: typeof config.threshold === "number" && Number.isInteger(config.threshold) ? config.threshold : undefined,
    feedK4: typeof config.feedK4 === "boolean" ? config.feedK4 : undefined,
  };
}

function tamperAlertHint(row: Record<string, unknown>, hint: string) {
  let before = tamperAlertConfig(row.before);
  let after = tamperAlertConfig(row.after);
  let { operator, reason } = row;
  if (row.before === undefined && row.after === undefined) {
    const parts = /^阈值 (\d+|\?)→(\d+|\?) 次\/24h · K4 (开启|关闭|未知)→(开启|关闭|未知) · (.*?) · ([\s\S]*)$/.exec(hint);
    if (!parts) return hint.replace(/\bK4\b/g, "风险评分");
    const [, oldThreshold, newThreshold, oldFeed, newFeed, legacyOperator, legacyReason] = parts;
    const legacyConfig = (threshold: string, feed: string) => ({
      threshold: threshold === "?" ? undefined : Number(threshold),
      feedK4: feed === "未知" ? undefined : feed === "开启",
    });
    before = legacyConfig(oldThreshold, oldFeed);
    after = legacyConfig(newThreshold, newFeed);
    operator = legacyOperator;
    reason = legacyReason;
  }

  const changes: string[] = [];
  if (after.threshold !== undefined && before.threshold !== after.threshold) {
    changes.push(before.threshold === undefined
      ? `告警阈值改为 ${after.threshold} 次 / 24 小时`
      : `告警阈值 ${before.threshold} → ${after.threshold} 次 / 24 小时`);
  }
  if (after.feedK4 !== undefined && before.feedK4 !== after.feedK4) {
    const next = after.feedK4 ? "开" : "关";
    changes.push(before.feedK4 === undefined
      ? `新事件计入风险评分改为${next}`
      : `新事件计入风险评分 ${before.feedK4 ? "开" : "关"} → ${next}`);
  }
  return [...changes, alertOperator(operator), alertReason(reason)].join(" · ");
}

function accountAlertUserCode(eventType: string, row: Record<string, unknown>) {
  // The delivery's target is a session number for read-only views, and a user ID for the other known producers.
  const targetIsUser = ACCOUNT_ALERT_TITLES.has(eventType)
    && eventType !== "admin.user_impersonation_started" && eventType !== "admin.user_impersonation_ended";
  const value = row.targetUserId ?? (targetIsUser ? row.target : undefined);
  const id = typeof value === "string" || typeof value === "number" && Number.isSafeInteger(value) ? String(value) : "";
  return /^[1-9]\d*$/.test(id) ? `U${id.padStart(8, "0")}` : undefined;
}

function normalizeAlert(value: unknown, index: number): OpsDashboardAlert {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`OPS_DASHBOARD_FIELD_REQUIRED:alerts.${index}`);
  }
  const row = value as Record<string, unknown>;
  const level = requiredText(row.level, `alerts.${index}.level`);
  if (level !== "high" && level !== "mid" && level !== "low") {
    throw new Error(`OPS_DASHBOARD_FIELD_INVALID:alerts.${index}.level`);
  }
  const alert = {
    id: requiredText(row.id, `alerts.${index}.id`),
    domain: requiredText(row.domain, `alerts.${index}.domain`),
    level,
  } satisfies Pick<OpsDashboardAlert, "id" | "domain" | "level">;
  const hint = typeof row.hint === "string" ? row.hint : "";
  const occurredAt = typeof row.occurredAt === "string" ? row.occurredAt.trim() || undefined : undefined;
  if (alert.domain === "J2") {
    return {
      ...alert,
      title: "地区策略已变更",
      hint: geoAlertHint(row, hint),
      occurredAt,
    };
  }
  if (alert.domain === "J3") {
    return {
      ...alert,
      title: "篡改告警设置已变更",
      hint: tamperAlertHint(row, hint),
      occurredAt,
    };
  }
  if (alert.domain === "C2" || alert.domain === "C5") {
    const eventType = typeof row.eventType === "string" ? row.eventType : "";
    const userCode = accountAlertUserCode(eventType, row);
    return {
      ...alert,
      title: ACCOUNT_ALERT_TITLES.get(eventType) ?? "账户安全操作",
      hint: userCode ?? "",
      userCode,
      // The legacy hint embeds delivery time. Only a separately supplied occurrence time belongs here.
      occurredAt,
    };
  }
  return {
    ...alert,
    title: requiredText(row.title, `alerts.${index}.title`),
    hint: requiredText(row.hint, `alerts.${index}.hint`),
  };
}

async function readKillSwitchAlerts() {
  // 所有已登录运营账号读取最小化告警快照；不暴露 J1 配置与控制权限。
  const response = await guardedFetch("/api/admin/emergency/kill-switches/alerts", { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as ApiResult<Record<string, unknown>> | null;
  if (!response.ok || !payload || (payload.code !== undefined && payload.code !== 0) || !payload.data) {
    throw new Error(formatAdminApiError(payload?.message, `J1_ALERTS_${response.status}`));
  }
  if (!Array.isArray(payload.data.autoConfirmations)) {
    throw new Error("J1_ALERTS_FIELD_REQUIRED:autoConfirmations");
  }
  if (!Array.isArray(payload.data.activeGates)) {
    throw new Error("J1_ALERTS_FIELD_REQUIRED:activeGates");
  }
  if (payload.data.activeGateCount !== J1_ALERT_GATE_KEYS.length) {
    throw new Error("J1_ALERTS_CONTRACT_INVALID:activeGateCount");
  }
  const gates = payload.data.activeGates.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`J1_ALERTS_FIELD_REQUIRED:activeGates.${index}`);
    }
    const row = value as Record<string, unknown>;
    if (typeof row.enabled !== "boolean" || typeof row.emergency !== "boolean") {
      throw new Error(`J1_ALERTS_FIELD_REQUIRED:activeGates.${index}.status`);
    }
    return {
      key: requiredText(row.key, `activeGates.${index}.key`),
      name: requiredText(row.name, `activeGates.${index}.name`),
      enabled: row.enabled,
      emergency: row.emergency,
    };
  });
  const gateKeys = new Set(gates.map((gate) => gate.key));
  if (gates.length !== J1_ALERT_GATE_KEYS.length
    || gateKeys.size !== J1_ALERT_GATE_KEYS.length
    || J1_ALERT_GATE_KEYS.some((key) => !gateKeys.has(key))) {
    throw new Error("J1_ALERTS_CONTRACT_INVALID:activeGates.keys");
  }
  const pending = payload.data.autoConfirmations.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`J1_ALERTS_FIELD_REQUIRED:autoConfirmations.${index}`);
    }
    const row = value as Record<string, unknown>;
    if (typeof row.overdue !== "boolean") {
      throw new Error(`J1_ALERTS_FIELD_REQUIRED:autoConfirmations.${index}.overdue`);
    }
    const key = requiredText(row.key, `autoConfirmations.${index}.key`);
    const name = requiredText(row.name, `autoConfirmations.${index}.name`);
    const gate = gates.find((candidate) => candidate.key === key);
    if (!gate || gate.enabled) {
      throw new Error(`J1_ALERTS_CONTRACT_INVALID:autoConfirmations.${index}.gateState`);
    }
    return { key, name, overdue: row.overdue };
  });
  if (new Set(pending.map((row) => row.key)).size !== pending.length) {
    throw new Error("J1_ALERTS_CONTRACT_INVALID:autoConfirmations.keys");
  }
  return { gates, pending };
}

/** 提现总开关现在开着吗。没设置也算关（后端失败关闭）。 */
export async function fetchWithdrawalGateOpen() {
  const { gates } = await readKillSwitchAlerts();
  return gates.find((gate) => gate.key === "withdraw")?.enabled === true;
}

export async function fetchOpsDashboardAlerts(): Promise<OpsDashboardAlert[]> {
  const { gates, pending } = await readKillSwitchAlerts();
  const alerts: OpsDashboardAlert[] = [];
  const disabled = gates.filter((gate) => !gate.enabled && !UNAVAILABLE_GATES[gate.key]);
  if (disabled.length > 0) {
    const emergencyCount = disabled.filter((gate) => gate.emergency).length;
    // 这个接口分不出「已关停」和「未设置」，两种业务都用不了，统一写没有开启，细分看风险与开关。
    alerts.push({
      ...normalizeAlert({
        id: "J1-KILL-STATE",
        domain: "J",
        level: emergencyCount > 0 ? "high" : "mid",
        title: `没有开启的业务 ${disabled.length} 个`,
        hint: disabled.map((gate) => gate.name).join("、"),
      }, alerts.length),
      closedKeys: disabled.map((gate) => gate.key),
    });
  }
  const overdue = pending.filter((row) => row.overdue === true).length;
  if (pending.length > 0) {
    alerts.push({
      ...normalizeAlert({
        id: "J1-AUTO-CONFIRM",
        domain: "J",
        level: overdue > 0 ? "high" : "mid",
        title: `自动关停待补录 ${pending.length} 项`,
        hint: overdue > 0
          ? `已有 ${overdue} 项逾期，请马上去「紧急停用开关」补录`
          : "请在截止时间前去「紧急停用开关」补录处理结论",
      }, alerts.length),
      count: pending.length,
    });
  }
  return alerts;
}

export async function fetchJ2GeoAlerts(): Promise<OpsDashboardAlert[]> {
  const response = await guardedFetch("/api/admin/emergency/geo-block/alerts", { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as ApiResult<Record<string, unknown>> | null;
  if (!response.ok || !payload || (payload.code !== undefined && payload.code !== 0) || !payload.data) {
    throw new Error(formatAdminApiError(payload?.message, `J2_ALERTS_${response.status}`));
  }
  if (!Array.isArray(payload.data.alerts)) {
    throw new Error("J2_ALERTS_FIELD_REQUIRED:alerts");
  }
  return payload.data.alerts.map((value, index) => normalizeAlert(value, index));
}

export async function fetchJ3TamperConfigAlerts(): Promise<OpsDashboardAlert[]> {
  const response = await guardedFetch("/api/admin/emergency/tamper/config-alerts", { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as ApiResult<Record<string, unknown>> | null;
  if (!response.ok || !payload || (payload.code !== undefined && payload.code !== 0) || !payload.data) {
    throw Object.assign(new Error(formatAdminApiError(payload?.message, `J3_ALERTS_${response.status}`, "read")), { status: response.status });
  }
  if (!Array.isArray(payload.data.alerts)) {
    throw new Error("篡改告警数据不完整，请稍后重试。");
  }
  return payload.data.alerts.map((value, index) => normalizeAlert(value, index));
}

export async function fetchC2HighRiskAlerts(): Promise<OpsDashboardAlert[]> {
  const response = await guardedFetch("/api/admin/users/account-actions/alerts", { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as ApiResult<Record<string, unknown>> | null;
  if (!response.ok || !payload || (payload.code !== undefined && payload.code !== 0) || !payload.data) {
    throw Object.assign(new Error(formatAdminApiError(payload?.message, `C2_ALERTS_${response.status}`, "read")), { status: response.status });
  }
  if (!Array.isArray(payload.data.alerts)) {
    throw new Error("C2_ALERTS_FIELD_REQUIRED:alerts");
  }
  return payload.data.alerts.map((value, index) => normalizeAlert(value, index));
}

type J1DutyAlertSnapshot = {
  alerts: OpsDashboardAlert[];
  error: string | null;
  /** 第一次读取有结果了。还没读完时不能当成没有告警。 */
  settled?: boolean;
};

const EMPTY_J1_DUTY_ALERT_SNAPSHOT: J1DutyAlertSnapshot = { alerts: [], error: null };
let j1DutyAlertSnapshot: J1DutyAlertSnapshot = EMPTY_J1_DUTY_ALERT_SNAPSHOT;
let j1DutyAlertTimer: number | null = null;
let j1DutyAlertRequestSequence = 0;
const j1DutyAlertSubscribers = new Set<(snapshot: J1DutyAlertSnapshot) => void>();

function publishJ1DutyAlertSnapshot(snapshot: J1DutyAlertSnapshot) {
  j1DutyAlertSnapshot = snapshot;
  j1DutyAlertSubscribers.forEach((subscriber) => subscriber(snapshot));
}

export async function refreshJ1DutyAlerts() {
  const requestSequence = ++j1DutyAlertRequestSequence;
  try {
    const alerts = await fetchOpsDashboardAlerts();
    if (requestSequence !== j1DutyAlertRequestSequence) return;
    publishJ1DutyAlertSnapshot({ alerts, error: null, settled: true });
  } catch (error: unknown) {
    if (requestSequence !== j1DutyAlertRequestSequence) return;
    publishJ1DutyAlertSnapshot({
      alerts: [],
      error: displayAdminReadError(error),
      settled: true,
    });
  }
}

function stopJ1DutyAlertPolling() {
  j1DutyAlertRequestSequence += 1;
  if (j1DutyAlertTimer !== null) {
    window.clearInterval(j1DutyAlertTimer);
    j1DutyAlertTimer = null;
  }
  window.removeEventListener("focus", refreshJ1DutyAlerts);
  j1DutyAlertSnapshot = EMPTY_J1_DUTY_ALERT_SNAPSHOT;
}

function subscribeJ1DutyAlerts(subscriber: (snapshot: J1DutyAlertSnapshot) => void) {
  j1DutyAlertSubscribers.add(subscriber);
  subscriber(j1DutyAlertSnapshot);
  if (j1DutyAlertSubscribers.size === 1) {
    void refreshJ1DutyAlerts();
    j1DutyAlertTimer = window.setInterval(refreshJ1DutyAlerts, 30_000);
    window.addEventListener("focus", refreshJ1DutyAlerts);
  }
  return () => {
    j1DutyAlertSubscribers.delete(subscriber);
    if (j1DutyAlertSubscribers.size === 0) stopJ1DutyAlertPolling();
  };
}

export function useJ1DutyAlerts(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<J1DutyAlertSnapshot>(EMPTY_J1_DUTY_ALERT_SNAPSHOT);
  useEffect(() => {
    if (!enabled) {
      setSnapshot(EMPTY_J1_DUTY_ALERT_SNAPSHOT);
      return undefined;
    }
    return subscribeJ1DutyAlerts(setSnapshot);
  }, [enabled]);
  return snapshot;
}

export function useJ2GeoAlerts(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<J1DutyAlertSnapshot>(EMPTY_J1_DUTY_ALERT_SNAPSHOT);
  useEffect(() => {
    if (!enabled) {
      setSnapshot(EMPTY_J1_DUTY_ALERT_SNAPSHOT);
      return undefined;
    }
    let alive = true;
    const refresh = async () => {
      try {
        const alerts = await fetchJ2GeoAlerts();
        if (alive) setSnapshot({ alerts, error: null });
      } catch (error) {
        if (alive) setSnapshot({ alerts: [], error: displayAdminReadError(error) });
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [enabled]);
  return snapshot;
}

export function useJ3TamperConfigAlerts(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<J1DutyAlertSnapshot>(EMPTY_J1_DUTY_ALERT_SNAPSHOT);
  useEffect(() => {
    if (!enabled) {
      setSnapshot(EMPTY_J1_DUTY_ALERT_SNAPSHOT);
      return undefined;
    }
    let alive = true;
    const refresh = async () => {
      try {
        const alerts = await fetchJ3TamperConfigAlerts();
        if (alive) setSnapshot({ alerts, error: null });
      } catch (error) {
        if (alive) setSnapshot({ alerts: [], error: displayAdminReadError(error) });
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [enabled]);
  return snapshot;
}

export function useC2HighRiskAlerts(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<J1DutyAlertSnapshot>(EMPTY_J1_DUTY_ALERT_SNAPSHOT);
  useEffect(() => {
    if (!enabled) {
      setSnapshot(EMPTY_J1_DUTY_ALERT_SNAPSHOT);
      return undefined;
    }
    let alive = true;
    const refresh = async () => {
      try {
        const alerts = await fetchC2HighRiskAlerts();
        if (alive) setSnapshot({ alerts, error: null });
      } catch (error) {
        if (alive) setSnapshot({ alerts: [], error: displayAdminReadError(error) });
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [enabled]);
  return snapshot;
}

export function opsAlertHref(alert: Pick<OpsDashboardAlert, "id" | "domain" | "userCode">) {
  if (alert.domain === "C2" || alert.id.startsWith("C2-")) {
    return alert.userCode ? `/users/actions?userCode=${encodeURIComponent(alert.userCode)}` : "/users/actions";
  }
  if (alert.domain === "C5" || alert.id.startsWith("C5-")) {
    return alert.userCode ? `/users/security?tab=security&userCode=${encodeURIComponent(alert.userCode)}` : "/users/security";
  }
  if (alert.domain === "J2" || alert.id.startsWith("J2-")) return "/emergency/geo-block";
  if (alert.domain === "J3" || alert.id.startsWith("J3-")) return "/emergency/tamper";
  if (alert.domain === "J") return "/emergency/kill-switch";
  if (alert.domain === "D") return "/finance/withdrawals";
  if (alert.domain === "K") return "/risk/multi-account";
  return "/overview/dual-ledger";
}
