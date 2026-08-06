type LogoutFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type LogoutRequestOptions = {
  fetchImpl?: LogoutFetch;
  timeoutMs?: number;
  signal?: AbortSignal;
};

type LogoutEnvelope = {
  code?: unknown;
  message?: unknown;
  data?: unknown;
};

const DEFAULT_LOGOUT_TIMEOUT_MS = 15_000;
let pendingLogout: Promise<void> | null = null;

export class AdminLogoutConfirmationError extends Error {
  constructor() {
    super("ADMIN_LOGOUT_CONFIRMATION_FAILED");
    this.name = "AdminLogoutConfirmationError";
  }
}

function isConfirmedLogoutEnvelope(value: unknown): value is LogoutEnvelope {
  return typeof value === "object" && value !== null && (value as LogoutEnvelope).code === 0;
}

async function performAdminLogout({
  fetchImpl = fetch,
  timeoutMs = DEFAULT_LOGOUT_TIMEOUT_MS,
  signal,
}: LogoutRequestOptions): Promise<void> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signals = signal ? [signal, timeoutController.signal] : [timeoutController.signal];

  try {
    const response = await fetchImpl("/api/admin/auth/logout", {
      method: "POST",
      cache: "no-store",
      signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals),
    });
    const envelope = await response.json().catch(() => null) as LogoutEnvelope | null;
    if (!response.ok || !isConfirmedLogoutEnvelope(envelope)) {
      throw new AdminLogoutConfirmationError();
    }
  } catch (error) {
    if (error instanceof AdminLogoutConfirmationError) throw error;
    throw new AdminLogoutConfirmationError();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Confirms the entire logout response envelope before the caller tears down the
 * local auth generation. Concurrent clicks share the same server command.
 */
export function requestAdminLogout(options: LogoutRequestOptions = {}): Promise<void> {
  if (pendingLogout) return pendingLogout;
  const request = performAdminLogout(options);
  pendingLogout = request;
  const clear = () => {
    if (pendingLogout === request) pendingLogout = null;
  };
  void request.then(clear, clear);
  return request;
}
