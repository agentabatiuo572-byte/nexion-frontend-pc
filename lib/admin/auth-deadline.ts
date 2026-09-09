export const ADMIN_AUTH_REQUEST_TIMEOUT_MS = 15_000;
export const ADMIN_AUTH_UPSTREAM_TIMEOUT_MS = 12_000;

type AdminAuthDeadlineOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

type AdminAuthFetchOptions = AdminAuthDeadlineOptions & {
  fetchImpl?: typeof fetch;
};

function boundedTimeout(timeoutMs: number | undefined) {
  if (!Number.isFinite(timeoutMs) || !timeoutMs || timeoutMs <= 0) return ADMIN_AUTH_REQUEST_TIMEOUT_MS;
  return Math.floor(timeoutMs);
}

/**
 * Bounds an authentication request through response-body consumption. A caller
 * abort retains its own reason; a deadline creates a distinct TimeoutError.
 */
export function withAdminAuthDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  { signal: callerSignal, timeoutMs }: AdminAuthDeadlineOptions = {},
): Promise<T> {
  // Avoid beginning a request whose owner has already left the page. Apart
  // from saving work, this keeps the original AbortError observable by the
  // session bootstrap caller.
  if (callerSignal?.aborted) {
    return Promise.reject(callerSignal.reason);
  }

  const controller = new AbortController();
  const abortForCaller = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener("abort", abortForCaller, { once: true });
  const timer = setTimeout(() => {
    // Keep the reason as a stable machine code so the existing client error
    // throat renders Chinese copy without exposing transport implementation.
    controller.abort(new DOMException("NETWORK_FAILURE", "TimeoutError"));
  }, boundedTimeout(timeoutMs));

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abortForCaller);
      controller.signal.removeEventListener("abort", rejectForAbort);
    };
    const settle = (complete: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      complete();
    };
    const rejectForAbort = () => settle(() => reject(controller.signal.reason));
    controller.signal.addEventListener("abort", rejectForAbort, { once: true });

    let pending: Promise<T>;
    try {
      if (controller.signal.aborted) {
        rejectForAbort();
        return;
      }
      pending = operation(controller.signal);
    } catch (error) {
      settle(() => reject(error));
      return;
    }
    Promise.resolve(pending).then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    );
  });
}

/**
 * Keeps the deadline active until the supplied response reader has finished.
 * This prevents a response that sends headers but never completes its body from
 * keeping an authentication UI or BFF request locked forever.
 */
export async function fetchAdminAuthResponse<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  readBody: (response: Response) => Promise<T>,
  { fetchImpl = fetch, signal, timeoutMs }: AdminAuthFetchOptions = {},
): Promise<{ response: Response; value: T }> {
  return withAdminAuthDeadline(async (deadlineSignal) => {
    const response = await fetchImpl(input, { ...init, signal: deadlineSignal });
    return { response, value: await readBody(response) };
  }, { signal, timeoutMs });
}

export type AdminAuthBffResponse<T> =
  | { ok: true; response: Response; value: T }
  | { ok: false; response: Response };

/**
 * A BFF must turn an unavailable upstream into a bounded, cookie-free 503.
 * Cookie issuance remains below this return point in each success route.
 */
export async function fetchAdminAuthBffResponse<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  readBody: (response: Response) => Promise<T>,
  options: AdminAuthFetchOptions = {},
): Promise<AdminAuthBffResponse<T>> {
  try {
    const { response, value } = await fetchAdminAuthResponse(input, init, readBody, options);
    return { ok: true, response, value };
  } catch {
    return {
      ok: false,
      response: Response.json(
        { code: 503, message: "ADMIN_AUTH_UNAVAILABLE", data: null },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
}
