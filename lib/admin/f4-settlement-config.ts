export interface F4SettlementConfigInput {
  status?: string | null;
  unavailableKey?: string | null;
  configVersion?: string | null;
  ratio?: string | null;
  monthlyCap?: string | null;
  unlockVRank?: string | null;
  settleCron?: string | null;
}

export interface F4SettlementConfigIssue {
  key: "configVersion" | "ratio" | "monthlyCap" | "unlockVRank" | "settleCron" | "unknown";
  label: string;
}

const REQUIRED = [
  ["configVersion", "配置版本"],
  ["ratio", "奖池比例"],
  ["monthlyCap", "月度 cap"],
  ["unlockVRank", "解锁等级"],
  ["settleCron", "结算周期"],
] as const;

const BACKEND_KEY_TO_INPUT: Record<string, F4SettlementConfigIssue> = {
  "F.pool.configVersion": { key: "configVersion", label: "配置版本" },
  "F.pool.ratio": { key: "ratio", label: "奖池比例" },
  "F.pool.monthlyCap": { key: "monthlyCap", label: "月度 cap" },
  "F.pool.unlockVRank": { key: "unlockVRank", label: "解锁等级" },
  "F.pool.settleCron": { key: "settleCron", label: "结算周期" },
};

/**
 * Settlement readiness is server-authoritative. The browser deliberately does not reimplement
 * Spring CronExpression or the Java money/rate parsers; it only explains missing values while
 * LeadershipPoolConfigGuard remains the single executable-validity boundary.
 */
export function validateF4SettlementConfig(input: F4SettlementConfigInput): {
  ready: boolean;
  issues: F4SettlementConfigIssue[];
} {
  if (input.status === "READY") return { ready: true, issues: [] };

  const issues: F4SettlementConfigIssue[] = REQUIRED
    .filter(([key]) => !String(input[key] ?? "").trim())
    .map(([key, label]) => ({ key, label }));
  const authoritativeIssue = BACKEND_KEY_TO_INPUT[String(input.unavailableKey ?? "").trim()];
  if (authoritativeIssue && !issues.some((issue) => issue.key === authoritativeIssue.key)) {
    issues.push(authoritativeIssue);
  }
  if (!issues.length) issues.push({ key: "unknown", label: "权威配置" });
  return { ready: false, issues };
}
