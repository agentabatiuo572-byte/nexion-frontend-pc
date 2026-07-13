import { create } from "zustand";
import {
  changeK6StrategyStatus,
  deleteK6Strategy,
  fetchAllK6Devices,
  fetchK6Audit,
  fetchK6Health,
  fetchK6Strategies,
  rollbackK6Strategy,
  runK6DryRun,
  saveK6Strategy,
  updateK6DeviceStatus,
  type DryRun,
} from "@/lib/admin/k6-client";
import { REMOTE_URL_LABEL } from "@/lib/admin/janus-c2/labels";
import { deepClone } from "@/lib/admin/janus-c2/strategies";
import type {
  AuditLog,
  ConfirmationMode,
  Device,
  HealthReport,
  EffectiveTiming,
  Strategy,
  StrategyStatus,
} from "@/lib/admin/janus-c2/types";
import type { Transition } from "@/lib/admin/janus-c2/transitions";

export const REMOTE_URL_KEYS = [
  { key: "default", label: REMOTE_URL_LABEL.default },
  { key: "backup", label: REMOTE_URL_LABEL.backup },
  { key: "promo", label: REMOTE_URL_LABEL.promo },
];

export interface OverrideForm {
  reasonCategory: string;
  reasonText: string;
  effectiveTiming: EffectiveTiming;
  expireAt?: number;
  remoteUrlKey?: string;
  confirmationMode: ConfirmationMode;
}

interface JanusC2State {
  /** 名称为兼容高保真组件;内容是后端 nx_janus_device 的当前页,不是浏览器覆盖。 */
  overrides: Device[];
  audit: AuditLog[];
  strategies: Strategy[];
  health: HealthReport | null;
  loading: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  applyOverride: (device: Device, transition: Transition, form: OverrideForm, operatorId: string) => Promise<void>;
  applyBatch: (devices: Device[], transition: Transition, form: OverrideForm, operatorId: string) => Promise<void>;
  saveStrategy: (strategy: Strategy, operatorId: string, isNew: boolean) => Promise<void>;
  setStrategyStatus: (id: string, status: StrategyStatus, operatorId: string, note?: string, dryRun?: DryRun) => Promise<void>;
  deleteStrategy: (id: string, operatorId: string) => Promise<void>;
  duplicateStrategy: (id: string, operatorId: string) => Promise<void>;
  rollbackStrategy: (id: string, version: number, operatorId: string, reason: string) => Promise<void>;
  resetAll: () => void;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "JANUS_REQUEST_FAILED";
}

export const useJanusC2Store = create<JanusC2State>((set, get) => ({
  overrides: [],
  audit: [],
  strategies: [],
  health: null,
  loading: false,
  error: null,
  hydrate: async () => {
    set({ loading: true, error: null });
    try {
      const [devices, strategies, audit, health] = await Promise.all([
        fetchAllK6Devices(),
        fetchK6Strategies(),
        fetchK6Audit(200),
        fetchK6Health(),
      ]);
      set({ overrides: devices, strategies, audit, health, loading: false });
    } catch (error) {
      set({ error: errorText(error), loading: false });
    }
  },
  applyOverride: async (device, transition, form) => {
    try {
      await updateK6DeviceStatus(device.sid, {
          targetStatus: transition.to,
          reasonCategory: form.reasonCategory,
          reasonText: form.reasonText,
          effectiveTiming: form.effectiveTiming,
          expireAt: form.expireAt,
          remoteUrlKey: form.remoteUrlKey,
          confirmationMode: form.confirmationMode,
          expectedDeviceVersion: device.version ?? 0,
      });
      await get().hydrate();
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },
  applyBatch: async (devices, transition, form) => {
    if (transition.noBatch) return;
    try {
      await Promise.all(devices.map((device) => updateK6DeviceStatus(device.sid, {
          targetStatus: transition.to,
          reasonCategory: form.reasonCategory,
          reasonText: form.reasonText,
          effectiveTiming: form.effectiveTiming,
          expireAt: form.expireAt,
          remoteUrlKey: form.remoteUrlKey,
          confirmationMode: form.confirmationMode,
          expectedDeviceVersion: device.version ?? 0,
      })));
      await get().hydrate();
    } catch (error) {
      set({ error: errorText(error) });
      await get().hydrate();
      throw error;
    }
  },
  saveStrategy: async (strategy, _operatorId, isNew) => {
    try {
      await saveK6Strategy(strategy, `${isNew ? "新建" : "编辑"}策略 ${strategy.name}`, isNew);
      await get().hydrate();
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },
  setStrategyStatus: async (id, status, _operatorId, note, preparedDryRun) => {
    const strategy = get().strategies.find((item) => item.strategyId === id);
    if (!strategy) throw new Error("策略不存在或已刷新");
    const reason = note?.trim() || `${status === "active" ? "发布" : status === "paused" ? "暂停" : "归档"}策略 ${strategy.name}`;
    try {
      if (status === "active") {
          const dryRun = preparedDryRun ?? await runK6DryRun(id, strategy.lockVersion ?? 0, reason);
          await changeK6StrategyStatus(id, "publish", {
            expectedVersion: strategy.lockVersion ?? 0,
            reason,
            note: reason,
            dryRunId: dryRun.dryRunId,
            configHash: dryRun.configHash,
          });
      } else if (status === "paused" || status === "archived") {
          await changeK6StrategyStatus(id, status === "paused" ? "pause" : "archive", {
            expectedVersion: strategy.lockVersion ?? 0,
            reason,
            note: reason,
          });
      }
      await get().hydrate();
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },
  deleteStrategy: async (id) => {
    const strategy = get().strategies.find((item) => item.strategyId === id);
    if (!strategy) throw new Error("策略不存在或已刷新");
    try {
      await deleteK6Strategy(id, strategy.lockVersion ?? 0, `删除策略 ${strategy.name}`);
      await get().hydrate();
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
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
    await get().saveStrategy(copy, operatorId, true);
  },
  rollbackStrategy: async (id, version, _operatorId, reason) => {
    const strategy = get().strategies.find((item) => item.strategyId === id);
    if (!strategy) throw new Error("策略不存在或已刷新");
    try {
      await rollbackK6Strategy(id, {
          expectedVersion: strategy.lockVersion ?? 0,
          targetVersion: version,
          reason,
          note: reason,
      });
      await get().hydrate();
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },
  resetAll: () => {
    void get().hydrate();
  },
}));

/** 后端设备行直接作为有效设备;不叠加浏览器持久态或演示种子。 */
export function effectiveDevices(rows: Device[]): Device[] {
  return rows;
}
