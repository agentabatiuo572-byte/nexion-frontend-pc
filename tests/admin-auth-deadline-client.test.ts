import { afterEach, describe, expect, it, vi } from "vitest";
import { currentAdminSession } from "../lib/admin/auth-client";
import { POST as postLogin } from "../app/api/admin/auth/login/route";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("admin auth client deadline", () => {
  it("preserves a caller abort reason through currentAdminSession", async () => {
    const caller = new AbortController();
    const reason = new DOMException("navigation cancelled session bootstrap", "AbortError");
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })));

    const pending = currentAdminSession({ signal: caller.signal });
    caller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it("turns a hung response body into Chinese recovery copy and permits a retry", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: () => new Promise(() => {}),
    })));

    const pending = currentAdminSession();
    const failure = expect(pending).rejects.toThrow(/网络连接失败或后台服务不可达/);
    await vi.advanceTimersByTimeAsync(15_000);
    await failure;

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ code: 401, data: null }),
    })));
    await expect(currentAdminSession()).resolves.toBeNull();
  });

  it("returns a cookie-free 503 when the login BFF upstream body times out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      text: () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
    })));

    const pending = postLogin(new Request("http://console.test/api/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test-admin", password: "test-password" }),
    }));
    await vi.advanceTimersByTimeAsync(12_000);
    const response = await pending;

    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toEqual({ code: 503, message: "ADMIN_AUTH_UNAVAILABLE", data: null });
  });
});
