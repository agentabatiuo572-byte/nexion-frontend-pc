import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordAdminActivity, loginAdmin, AdminActivityIdentityChangedError } from "../lib/admin/auth-client";
import { requestAdminLogout } from "../lib/admin/logout-request";
import { renewAdminAuthLifecycle, completeAdminLogout, AdminAuthEpochChangedError } from "../lib/admin/auth-lifecycle";

const payload = { code: 0, data: { tokenType: "Bearer", session: {
  adminId: 11, username: "fixture-admin", operator: "Fixture", role: "auditor", authorities: [],
} } };
const tick = () => new Promise((resolve) => setImmediate(resolve));
beforeEach(() => renewAdminAuthLifecycle());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("admin activity browser auth boundary", () => {
  it("keeps ordinary 401 anonymous and treats identity conflict as a separate recovery condition", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: 401, data: null }, { status: 401 })));
    await expect(recordAdminActivity(11)).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: 409, message: "ADMIN_ACTIVITY_IDENTITY_MISMATCH", data: null }, { status: 409 })));
    await expect(recordAdminActivity(11)).rejects.toBeInstanceOf(AdminActivityIdentityChangedError);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload)));
    await expect(recordAdminActivity(12)).rejects.toBeInstanceOf(AdminActivityIdentityChangedError);
  });

  it("logout stops new activity admission and waits for old HTTP/body before sending revocation", async () => {
    let releaseBody!: (value: unknown) => void;
    const body = new Promise((resolve) => { releaseBody = resolve; });
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return String(url).endsWith("/activity")
        ? { ok: true, status: 200, json: () => body }
        : Response.json({ code: 0, data: null });
    }));
    const activity = recordAdminActivity(11);
    const activityFailure = expect(activity).rejects.toBeInstanceOf(AdminAuthEpochChangedError);
    await tick();
    const logout = requestAdminLogout();
    const blocked = expect(recordAdminActivity(11)).rejects.toBeInstanceOf(AdminAuthEpochChangedError);
    await tick();
    expect(calls).toEqual(["/api/admin/auth/activity"]);
    releaseBody(payload);
    await Promise.all([activityFailure, blocked, logout]);
    expect(calls).toEqual(["/api/admin/auth/activity", "/api/admin/auth/logout"]);
  });

  it("late 401 from an old auth epoch cannot become a new identity's anonymous state", async () => {
    let release!: (value: unknown) => void;
    const body = new Promise((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: () => body })));
    const request = recordAdminActivity(11);
    const rejection = expect(request).rejects.toBeInstanceOf(AdminAuthEpochChangedError);
    await tick();
    completeAdminLogout(); renewAdminAuthLifecycle();
    release({ code: 401, data: null });
    await rejection;
  });

  it("an activity UI deadline does not release an abort-ignoring native Cookie write ahead of a login", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let releaseBody!: (value: unknown) => void;
    const body = new Promise((resolve) => { releaseBody = resolve; });
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return String(url).endsWith("/activity")
        ? { ok: true, status: 200, json: () => body }
        : Response.json(payload);
    }));
    const failed = expect(recordAdminActivity(11)).rejects.toThrow(/网络连接失败或后台服务不可达/);
    await vi.advanceTimersByTimeAsync(15_000);
    await failed;
    const login = loginAdmin("fixture-admin", "fixture-password");
    await tick();
    expect(calls).toEqual(["/api/admin/auth/activity"]);
    releaseBody(payload);
    await expect(login).resolves.toHaveProperty("loginResult.session.adminId", 11);
    expect(calls).toEqual(["/api/admin/auth/activity", "/api/admin/auth/login"]);
  });
});
