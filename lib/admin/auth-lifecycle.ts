type AdminFetch = typeof fetch;

type AdminAuthLifecycleState = {
  epoch: number;
  logoutPending: boolean;
  readsBlocked: boolean;
  nativeFetch: AdminFetch | null;
  installed: boolean;
};

type AdminAuthWindow = Window & typeof globalThis & {
  __nexionAdminAuthLifecycleV1?: AdminAuthLifecycleState;
};

const serverState: AdminAuthLifecycleState = {
  epoch: 0,
  logoutPending: false,
  readsBlocked: false,
  nativeFetch: null,
  installed: false,
};

export class AdminLogoutAbortError extends Error {
  constructor() {
    super("ADMIN_LOGOUT_IN_PROGRESS");
    this.name = "AdminLogoutAbortError";
  }
}

export class AdminAuthEpochChangedError extends Error {
  constructor() {
    super("ADMIN_AUTH_EPOCH_CHANGED");
    this.name = "AdminAuthEpochChangedError";
  }
}

function lifecycleState(): AdminAuthLifecycleState {
  if (typeof window === "undefined") return serverState;
  const target = window as AdminAuthWindow;
  target.__nexionAdminAuthLifecycleV1 ??= {
    epoch: 0,
    logoutPending: false,
    readsBlocked: false,
    nativeFetch: null,
    installed: false,
  };
  return target.__nexionAdminAuthLifecycleV1;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase();
  return input instanceof Request ? input.method.toUpperCase() : "GET";
}

function isAuthenticatedAdminRead(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof window === "undefined") return false;
  const method = requestMethod(input, init);
  if (method !== "GET" && method !== "HEAD") return false;
  const value = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
  const url = new URL(value, window.location.href);
  return url.origin === window.location.origin && url.pathname.startsWith("/api/admin/");
}

async function guardedAdminRead(
  nativeFetch: AdminFetch,
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const state = lifecycleState();
  if (state.logoutPending) throw new AdminLogoutAbortError();
  if (state.readsBlocked) throw new AdminAuthEpochChangedError();
  const requestEpoch = state.epoch;
  const signals: AbortSignal[] = [];
  if (input instanceof Request) signals.push(input.signal);
  if (init?.signal) signals.push(init.signal);
  const signal = signals.length === 0
    ? undefined
    : signals.length === 1
      ? signals[0]
      : AbortSignal.any(signals);

  const response = await nativeFetch(input, { ...init, signal });
  const current = lifecycleState();
  if (requestEpoch !== current.epoch) {
    // Let the browser transport consume and settle the real HTTP response.
    // The synthetic response is an explicit business-layer stale result: old
    // old success/auth-failure data cannot be parsed or published, while DevTools records
    // the underlying request as completed rather than ERR_ABORTED.
    await response.arrayBuffer();
    return new Response(JSON.stringify({
      code: 409,
      message: "ADMIN_AUTH_EPOCH_CHANGED",
      data: null,
    }), {
      status: 409,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-nexion-admin-auth-stale": "1",
      },
    });
  }
  return response;
}

/**
 * Installs one narrow generation guard for same-origin authenticated admin reads.
 * Login/logout mutations still use the native fetch path, so a failed server
 * revocation can be retried with the original credential. Logout never aborts
 * an already-issued network request; its late result loses authority by epoch.
 */
export function installAdminAuthFetchLifecycle() {
  if (typeof window === "undefined") return;
  const state = lifecycleState();
  if (state.installed) return;
  state.nativeFetch = window.fetch.bind(window);
  const nativeFetch = state.nativeFetch;
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!isAuthenticatedAdminRead(input, init)) return nativeFetch(input, init);
    return guardedAdminRead(nativeFetch, input, init);
  }) as AdminFetch;
  state.installed = true;
}

export function beginAdminLogout() {
  const state = lifecycleState();
  if (state.logoutPending) return;
  state.logoutPending = true;
  state.readsBlocked = true;
}

/** Snapshot used by full-envelope session readers, including body parsing. */
export function adminAuthLifecycleEpoch() {
  return lifecycleState().epoch;
}

export function cancelAdminLogout() {
  const state = lifecycleState();
  state.logoutPending = false;
  state.readsBlocked = false;
}

export function completeAdminLogout() {
  const state = lifecycleState();
  state.logoutPending = false;
  state.readsBlocked = true;
  state.epoch += 1;
}

export function renewAdminAuthLifecycle() {
  const state = lifecycleState();
  state.logoutPending = false;
  state.readsBlocked = false;
  state.epoch += 1;
}
