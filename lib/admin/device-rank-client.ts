import { currentAdminOperator } from "@/lib/admin/current-operator";
import { growthRequest } from "@/lib/admin/h-client";
import { createH9Command, sendH9Command, type H9Command, type H9CommandDisplay } from "@/lib/admin/h9-command";
import { deviceRankConfigError, parseDeviceRankConfig, type DeviceRankConfig } from "@/lib/admin/device-rank-config";
import { OutcomeUnknownError } from "@/lib/admin/outcome-classification";

export async function fetchDeviceRankConfig(): Promise<DeviceRankConfig> {
  return parseDeviceRankConfig(await growthRequest<unknown>("/device-rank-config"));
}

export function prepareDeviceRankConfig(config: DeviceRankConfig, reason: string, display: H9CommandDisplay): H9Command {
  const error = deviceRankConfigError(config.enabled, config.tiers);
  if (error) throw new Error(error);
  if (reason.trim().length < 8 || reason.trim().length > 200) throw new Error("修改理由须为 8–200 个字符。");
  const body = { expectedVersion: config.version, enabled: config.enabled, tiers: config.tiers, reason: reason.trim(), operator: currentAdminOperator() };
  return createH9Command("rank", JSON.stringify(body), display);
}

export function updateDeviceRankConfig(command: H9Command, recovering = false): Promise<DeviceRankConfig> {
  return sendH9Command("rank", command, raw => {
    const saved = parseDeviceRankConfig(raw);
    const expected = command.original!.expectedVersion;
    // DeviceRankConfigService.update returns the old version for a no-op, otherwise +1.
    if (saved.version !== expected && saved.version !== expected + 1) throw new OutcomeUnknownError("H9_SAVE_RECEIPT_INVALID");
    return saved;
  }, recovering);
}
