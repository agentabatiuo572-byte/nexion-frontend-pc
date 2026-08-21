export type L6UnavailableState = {
  available: false;
  status: "SANDBOX_ONLY";
  message: string;
};

const SANDBOX_ONLY_MESSAGE =
  "当前后端运行在验收 Sandbox；生产行为热力读取已按环境隔离策略关闭。请使用上方 Sandbox 独立观察面核对当前 Run 的行为事实。";

export function l6UnavailableStateFromError(error: unknown): L6UnavailableState | null {
  const code = error instanceof Error && "code" in error
    ? (error as Error & { code?: unknown }).code
    : undefined;
  if (code !== "L6_PRODUCTION_SURFACE_FORBIDDEN") return null;
  return {
    available: false,
    status: "SANDBOX_ONLY",
    message: SANDBOX_ONLY_MESSAGE,
  };
}

export function l6UnavailableStateFromFailures(
  failures: unknown[],
  expectedRequestCount: number,
): L6UnavailableState | null {
  if (expectedRequestCount <= 0 || failures.length !== expectedRequestCount) return null;
  const states = failures.map(l6UnavailableStateFromError);
  return states.every((state): state is L6UnavailableState => state !== null)
    ? states[0]
    : null;
}
