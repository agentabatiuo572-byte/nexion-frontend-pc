interface SessionApiResult<T> {
  code?: number;
  data?: T | null;
}

/**
 * Interpret the cookie-backed session response without collapsing transport or
 * contract failures into an anonymous session. Only an explicit HTTP 401 means
 * that the server has rejected the current browser session.
 */
export function authoritativeAdminSessionPayload<T extends { session?: unknown }>(
  status: number,
  ok: boolean,
  result: SessionApiResult<T> | null,
): T | null {
  if (status === 401) return null;
  if (!ok || result?.code !== 0 || !result.data?.session) {
    throw new Error("ADMIN_SESSION_INVALID");
  }
  return result.data;
}
