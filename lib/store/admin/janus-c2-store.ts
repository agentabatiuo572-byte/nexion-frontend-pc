import { create } from "zustand";
import {
  K6OutcomeUncertainError,
  changeK6StrategyStatus,
  deleteK6Strategy,
  fetchAllK6Devices,
  fetchK6Audit,
  fetchK6Dashboard,
  fetchK6Strategies,
  rollbackK6Strategy,
  runK6DryRun,
  saveK6Strategy,
  updateK6DeviceStatus,
  type DryRun,
} from "@/lib/admin/k6-client";
import { deepClone } from "@/lib/admin/janus-c2/strategies";
import type {
  AuditLog,
  ConfirmationMode,
  Device,
  EffectiveTiming,
  K6DashboardSnapshot,
  Strategy,
  StrategyStatus,
} from "@/lib/admin/janus-c2/types";
import type { Transition } from "@/lib/admin/janus-c2/transitions";

export interface OverrideForm {
  reasonCategory: string;
  reasonText: string;
  effectiveTiming: EffectiveTiming;
  expireAt?: number;
  remoteUrlKey?: string;
  remoteTargetVersion?: number;
  remoteTargetCatalogVersion?: number;
  confirmationMode: ConfirmationMode;
}

export type K6LoadStatus = "idle" | "loading" | "ready" | "error";

interface JanusC2State {
  overrides: Device[];
  audit: AuditLog[];
  strategies: Strategy[];
  dashboard: K6DashboardSnapshot | null;
  dashboardStatus: K6LoadStatus;
  devicesStatus: K6LoadStatus;
  strategiesStatus: K6LoadStatus;
  auditStatus: K6LoadStatus;
  dashboardError: string | null;
  devicesError: string | null;
  strategiesError: string | null;
  auditError: string | null;
  loadDashboard: () => Promise<void>;
  loadDevices: () => Promise<void>;
  loadStrategies: () => Promise<void>;
  loadAudit: () => Promise<void>;
  applyOverride: (device: Device, transition: Transition, form: OverrideForm, operatorId: string) => Promise<Device>;
  saveStrategy: (strategy: Strategy, operatorId: string, isNew: boolean) => Promise<void>;
  setStrategyStatus: (id: string, status: StrategyStatus, operatorId: string, note?: string, dryRun?: DryRun) => Promise<void>;
  deleteStrategy: (id: string, operatorId: string) => Promise<void>;
  duplicateStrategy: (id: string, operatorId: string) => Promise<void>;
  rollbackStrategy: (id: string, version: number, operatorId: string, reason: string) => Promise<void>;
  resetAll: () => void;
}

function errorText(error: unknown, fallback: string) {
  if (error instanceof K6OutcomeUncertainError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

function replaceDevice(rows: Device[], updated: Device) {
  const next = rows.map((row) => row.sid === updated.sid ? updated : row);
  return next.some((row) => row.sid === updated.sid) ? next : [updated, ...next];
}

function replaceStrategy(rows: Strategy[], updated: Strategy) {
  const next = rows.map((row) => row.strategyId === updated.strategyId ? updated : row);
  return next.some((row) => row.strategyId === updated.strategyId) ? next : [updated, ...next];
}

export const useJanusC2Store = create<JanusC2State>((set, get) => ({
  overrides: [],
  audit: [],
  strategies: [],
  dashboard: null,
  dashboardStatus: "idle",
  devicesStatus: "idle",
  strategiesStatus: "idle",
  auditStatus: "idle",
  dashboardError: null,
  devicesError: null,
  strategiesError: null,
  auditError: null,

  loadDashboard: async () => {
    set({ dashboardStatus: "loading", dashboardError: null, dashboard: null });
    try {
      set({ dashboard: await fetchK6Dashboard(), dashboardStatus: "ready" });
    } catch (error) {
      set({ dashboard: null, dashboardStatus: "error", dashboardError: errorText(error, "看板读取失败，数据未更新") });
    }
  },
  loadDevices: async () => {
    set({ devicesStatus: "loading", devicesError: null, overrides: [] });
    try {
      set({ overrides: await fetchAllK6Devices(), devicesStatus: "ready" });
    } catch (error) {
      set({ overrides: [], devicesStatus: "error", devicesError: errorText(error, "设备队列读取失败，数据未更新") });
    }
  },
  loadStrategies: async () => {
    set({ strategiesStatus: "loading", strategiesError: null, strategies: [] });
    try {
      set({ strategies: await fetchK6Strategies(), strategiesStatus: "ready" });
    } catch (error) {
      set({ strategies: [], strategiesStatus: "error", strategiesError: errorText(error, "策略读取失败，数据未更新") });
    }
  },
  loadAudit: async () => {
    set({ auditStatus: "loading", auditError: null, audit: [] });
    try {
      set({ audit: await fetchK6Audit(200), auditStatus: "ready" });
    } catch (error) {
      set({ audit: [], auditStatus: "error", auditError: errorText(error, "审计读取失败，数据未更新") });
    }
  },

  applyOverride: async (device, transition, form) => {
    const updated = await updateK6DeviceStatus(device.sid, {
      targetStatus: transition.to,
      reasonCategory: form.reasonCategory,
      reasonText: form.reasonText,
      effectiveTiming: form.effectiveTiming,
      expireAt: form.expireAt,
      remoteUrlKey: form.remoteUrlKey,
      remoteTargetVersion: form.remoteTargetVersion,
      remoteTargetCatalogVersion: form.remoteTargetCatalogVersion,
      confirmationMode: form.confirmationMode,
      expectedDeviceVersion: device.version ?? 0,
    });
    set((state) => ({ overrides: replaceDevice(state.overrides, updated) }));
    return updated;
  },
  saveStrategy: async (strategy, _operatorId, isNew) => {
    const updated = await saveK6Strategy(strategy, `${isNew ? "新建" : "编辑"}策略 ${strategy.name}`, isNew);
    set((state) => ({ strategies: replaceStrategy(state.strategies, updated) }));
  },
  setStrategyStatus: async (id, status, _operatorId, note, preparedDryRun) => {
    const strategy = get().strategies.find((item) => item.strategyId === id);
    if (!strategy) throw new Error("策略不存在或已刷新");
    const reason = note?.trim() || `${status === "active" ? "发布" : status === "paused" ? "暂停" : "归档"}策略 ${strategy.name}`;
    let updated: Strategy;
    if (status === "active") {
      const dryRun = preparedDryRun ?? await runK6DryRun(id, strategy.lockVersion ?? 0, reason);
      updated = await changeK6StrategyStatus(id, "publish", {
        expectedVersion: strategy.lockVersion ?? 0,
        reason,
        note: reason,
        dryRunId: dryRun.dryRunId,
        configHash: dryRun.configHash,
      });
    } else if (status === "paused" || status === "archived") {
      updated = await changeK6StrategyStatus(id, status === "paused" ? "pause" : "archive", {
        expectedVersion: strategy.lockVersion ?? 0,
        reason,
        note: reason,
      });
    } else {
      throw new Error("不支持的策略状态变更");
    }
    set((state) => ({ strategies: replaceStrategy(state.strategies, updated) }));
  },
  deleteStrategy: async (id) => {
    const strategy = get().strategies.find((item) => item.strategyId === id);
    if (!strategy) throw new Error("策略不存在或已刷新");
    await deleteK6Strategy(id, strategy.lockVersion ?? 0, `删除策略 ${strategy.name}`);
    set((state) => ({ strategies: state.strategies.filter((item) => item.strategyId !== id) }));
  },
  duplicateStrategy: async (id, operatorId) => {
    const source = get().strategies.find((item) => item.strategyId === id);
    if (!source) throw new Error("策略不存在或已刷新");
    const copy: Strategy = {
      ...source,
      strategyId: `draft_${Date.now()}`,
      name: `${source.name}(副本)`,
      status: "draft",
      version: 1,
      lockVersion: 0,
      owner: operatorId,
      ruleTree: deepClone(source.ruleTree),
      action: deepClone(source.action),
      scope: deepClone(source.scope),
      safeguards: deepClone(source.safeguards),
      versions: [],
      createdAt: Date.now(),
      publishedAt: undefined,
    };
    const updated = await saveK6Strategy(copy, `复制策略 ${source.name}`, true);
    set((state) => ({ strategies: replaceStrategy(state.strategies, updated) }));
  },
  rollbackStrategy: async (id, version, _operatorId, reason) => {
    const strategy = get().strategies.find((item) => item.strategyId === id);
    if (!strategy) throw new Error("策略不存在或已刷新");
    const updated = await rollbackK6Strategy(id, {
      expectedVersion: strategy.lockVersion ?? 0,
      targetVersion: version,
      reason,
      note: reason,
    });
    set((state) => ({ strategies: replaceStrategy(state.strategies, updated) }));
  },
  resetAll: () => {
    void Promise.allSettled([get().loadDashboard(), get().loadDevices(), get().loadStrategies(), get().loadAudit()]);
  },
}));

export function effectiveDevices(rows: Device[]): Device[] {
  return rows;
}
