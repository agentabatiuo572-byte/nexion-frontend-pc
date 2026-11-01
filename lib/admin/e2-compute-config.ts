export const TASK_DURATION_DEFAULTS: Record<string, number> = { IG: 18, VG: 900, LL: 12, FT: 1800, EM: 5, SP: 30 };

export interface ComputeTaskConfig {
  selectionWeight?: number;
  expectedDurationMinSec?: number;
  expectedDurationMaxSec?: number;
  executionTimeoutSec?: number;
  runtimeKey?: string;
  validatorKey?: string;
  workloadConfigJson?: string;
}

/** Shared by the editor and direct API path; the server repeats these checks. */
export function validateComputeTaskConfig(config: ComputeTaskConfig): string | null {
  for (const [field, max] of [["selectionWeight", 1_000_000], ["expectedDurationMinSec", 86_400], ["expectedDurationMaxSec", 86_400], ["executionTimeoutSec", 172_800]] as const) {
    const value = config[field];
    const label = { selectionWeight: "抽选权重", expectedDurationMinSec: "预计最短时长", expectedDurationMaxSec: "预计最长时长", executionTimeoutSec: "执行超时" }[field];
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > max)) return `${label}须为 1–${max} 的整数`;
  }
  if (config.expectedDurationMinSec !== undefined && config.expectedDurationMaxSec !== undefined
    && config.expectedDurationMinSec > config.expectedDurationMaxSec) return "预计最短时长不能超过最长时长";
  if (config.executionTimeoutSec !== undefined && config.expectedDurationMaxSec !== undefined
    && config.executionTimeoutSec < config.expectedDurationMaxSec) return "执行超时不能小于预计最长时长";
  for (const key of [config.runtimeKey, config.validatorKey]) if (key !== undefined && key !== "" && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(key)) return "执行器和校验器标识须为最多 96 位字母、数字、点、冒号、下划线或连字符";
  if (config.workloadConfigJson !== undefined) {
    if (new TextEncoder().encode(config.workloadConfigJson).length > 16_384) return "任务输入配置最多 16KB";
    try {
      const value = JSON.parse(config.workloadConfigJson);
      if (!value || typeof value !== "object" || Array.isArray(value)) return "任务输入配置须为 JSON 对象";
    } catch { return "任务输入配置须为有效 JSON 对象"; }
  }
  return null;
}
