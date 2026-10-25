import { currentAdminOperator } from "@/lib/admin/current-operator";
import { growthRequest } from "@/lib/admin/h-client";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import { deviceRankConfigError, parseDeviceRankConfig, type DeviceRankConfig } from "@/lib/admin/device-rank-config";

const attempts = createSlotAttemptStore({ storageKey: "nexion-admin-device-rank-attempt" });
const slot = "device-rank-config";

export async function fetchDeviceRankConfig(): Promise<DeviceRankConfig> {
  return parseDeviceRankConfig(await growthRequest<unknown>("/device-rank-config"));
}

export async function updateDeviceRankConfig(config: DeviceRankConfig, reason: string): Promise<DeviceRankConfig> {
  const error = deviceRankConfigError(config.enabled, config.tiers);
  if (error) throw new Error(error);
  if (reason.trim().length < 8 || reason.trim().length > 200) throw new Error("修改理由须为 8–200 个字符。");
  const body = { expectedVersion: config.version, enabled: config.enabled, tiers: config.tiers, reason: reason.trim(), operator: currentAdminOperator() };
  const key = attempts.resolve(slot, JSON.stringify(body), () => `device-rank-${crypto.randomUUID()}`);
  const saved = parseDeviceRankConfig(await growthRequest<unknown>("/device-rank-config", {
    method: "PATCH", body: JSON.stringify(body), headers: { "Idempotency-Key": key },
  }));
  attempts.forget(slot);
  return saved;
}
