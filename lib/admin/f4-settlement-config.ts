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
  ["configVersion", "设置版本"],
  ["ratio", "奖池比例"],
  ["monthlyCap", "每月上限"],
  ["unlockVRank", "参与等级"],
  ["settleCron", "结算时间"],
] as const;

const BACKEND_KEY_TO_INPUT: Record<string, F4SettlementConfigIssue> = {
  "F.pool.configVersion": { key: "configVersion", label: "设置版本" },
  "F.pool.ratio": { key: "ratio", label: "奖池比例" },
  "F.pool.monthlyCap": { key: "monthlyCap", label: "每月上限" },
  "F.pool.unlockVRank": { key: "unlockVRank", label: "参与等级" },
  "F.pool.settleCron": { key: "settleCron", label: "结算时间" },
};

/** 920c2c19 restricts new saves; existing schedule reads retain their original semantics. */
export function f4WeeklyCronIssue(configured: string): string | undefined {
  const fields = configured.trim().split(/\s+/);
  if (fields.length === 5) fields.unshift("0");
  if (fields.length !== 6) return "F4_SETTLE_CRON_INVALID";
  const weekly = fields.slice(0, 3).every(value => /^\d+$/.test(value))
    && ["*", "?"].includes(fields[3]) && fields[4] === "*"
    && /^(?:[0-7]|MON|TUE|WED|THU|FRI|SAT|SUN)$/i.test(fields[5]);
  if (!weekly) return "F4_SETTLE_CRON_WEEKLY_REQUIRED";
  if (Number(fields[0]) > 59 || Number(fields[1]) > 59 || Number(fields[2]) > 23) return "F4_SETTLE_CRON_INVALID";
}

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
  if (!issues.length) issues.push({ key: "unknown", label: "其他设置" });
  return { ready: false, issues };
}
