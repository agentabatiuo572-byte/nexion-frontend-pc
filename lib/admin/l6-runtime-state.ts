export type L6UnavailableState = {
  available: false;
  status: "RETIRED_ENVIRONMENT";
  message: string;
};

const RETIRED_ENVIRONMENT_MESSAGE =
  "服务端返回了已退役的运行环境，开发环境已拒绝展示该数据；请检查服务配置后重试。";

export function l6UnavailableStateFromError(error: unknown): L6UnavailableState | null {
  const code = error instanceof Error && "code" in error
    ? (error as Error & { code?: unknown }).code
    : undefined;
  if (code !== "L6_PRODUCTION_SURFACE_FORBIDDEN") return null;
  return {
    available: false,
    status: "RETIRED_ENVIRONMENT",
    message: RETIRED_ENVIRONMENT_MESSAGE,
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
