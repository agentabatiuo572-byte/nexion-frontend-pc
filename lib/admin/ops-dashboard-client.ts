"use client";

import { useEffect, useState } from "react";
import { formatAdminApiError } from "@/lib/admin/error-messages";

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
};

const J1_ALERT_GATE_KEYS = ["withdraw", "staking", "genesis", "exchange", "trial"] as const;

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`OPS_DASHBOARD_FIELD_REQUIRED:${field}`);
  }
  return value.trim();
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
  return {
    id: requiredText(row.id, `alerts.${index}.id`),
    domain: requiredText(row.domain, `alerts.${index}.domain`),
    level,
    title: requiredText(row.title, `alerts.${index}.title`),
    hint: requiredText(row.hint, `alerts.${index}.hint`),
  };
}

export async function fetchOpsDashboardAlerts(): Promise<OpsDashboardAlert[]> {
  // 所有已登录运营账号读取最小化告警快照；不暴露 J1 配置与控制权限。
  const response = await fetch("/api/admin/emergency/kill-switches/alerts", { cache: "no-store" });
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
  const alerts: OpsDashboardAlert[] = [];
  const disabled = gates.filter((gate) => !gate.enabled);
  if (disabled.length > 0) {
    const emergencyCount = disabled.filter((gate) => gate.emergency).length;
    alerts.push(normalizeAlert({
      id: "J1-KILL-STATE",
      domain: "J",
      level: emergencyCount > 0 ? "high" : "mid",
      title: `J1 已关停业务闸 ${disabled.length}`,
      hint: disabled.map((gate) => gate.name).join("、"),
    }, alerts.length));
  }
  const overdue = pending.filter((row) => row.overdue === true).length;
  if (pending.length > 0) {
    alerts.push(normalizeAlert({
      id: "J1-AUTO-CONFIRM",
      domain: "J",
      level: overdue > 0 ? "high" : "mid",
      title: `J1 自动关停待补录 ${pending.length}`,
      hint: overdue > 0
        ? `已有 ${overdue} 项逾期,请立即前往 J1 补录`
        : "请在截止时间前前往 J1 补录处置结论",
    }, alerts.length));
  }
  return alerts;
}

export async function fetchJ2GeoAlerts(): Promise<OpsDashboardAlert[]> {
  const response = await fetch("/api/admin/emergency/geo-block/alerts", { cache: "no-store" });
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
  const response = await fetch("/api/admin/emergency/tamper/config-alerts", { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as ApiResult<Record<string, unknown>> | null;
  if (!response.ok || !payload || (payload.code !== undefined && payload.code !== 0) || !payload.data) {
    throw new Error(formatAdminApiError(payload?.message, `J3_ALERTS_${response.status}`));
  }
  if (!Array.isArray(payload.data.alerts)) {
    throw new Error("服务器返回的 J3 告警数据缺少告警列表，请稍后重试。");
  }
  return payload.data.alerts.map((value, index) => normalizeAlert(value, index));
}

type J1DutyAlertSnapshot = {
  alerts: OpsDashboardAlert[];
  error: string | null;
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

async function refreshJ1DutyAlerts() {
  const requestSequence = ++j1DutyAlertRequestSequence;
  try {
    const alerts = await fetchOpsDashboardAlerts();
    if (requestSequence !== j1DutyAlertRequestSequence) return;
    publishJ1DutyAlertSnapshot({ alerts, error: null });
  } catch (error: unknown) {
    if (requestSequence !== j1DutyAlertRequestSequence) return;
    publishJ1DutyAlertSnapshot({
      alerts: [],
      error: "J1 值班告警暂时无法读取，请稍后重试",
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
      } catch {
        if (alive) setSnapshot({ alerts: [], error: "J2 超管告警暂时无法读取，请稍后重试" });
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
      } catch {
        if (alive) setSnapshot({ alerts: [], error: "J3 超管告警暂时无法读取，请稍后重试" });
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

export function opsAlertHref(alert: Pick<OpsDashboardAlert, "id" | "domain">) {
  if (alert.domain === "J2" || alert.id.startsWith("J2-")) return "/emergency/geo-block";
  if (alert.domain === "J3" || alert.id.startsWith("J3-")) return "/emergency/tamper";
  if (alert.domain === "J") return "/emergency/kill-switch";
  if (alert.domain === "D") return "/finance/withdrawals";
  if (alert.domain === "K") return "/risk/multi-account";
  return "/overview/dual-ledger";
}
