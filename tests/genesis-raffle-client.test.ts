import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseAdminRaffle, raffleDraftError, saveAdminRaffle, type RaffleDraft } from "../lib/admin/genesis-raffle-client";
const remote = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../lib/admin/h-client", () => ({ growthRequest: remote.request }));
vi.mock("../lib/admin/current-operator", () => ({ currentAdminOperator: () => "admin-a" }));
const draft = (): RaffleDraft => ({ id: "draw-1", titleZh: "抽奖", titleEn: "Raffle", titleVi: "Quay thưởng", startsAt: "2030-01-01T00:00:00Z", drawAt: "2030-01-02T00:00:00Z", prizes: [{ id: "p1", nameZh: "奖品", nameEn: "Prize", nameVi: "Giải thưởng", rewardType: "NEX", amount: "10", quantity: 2 }] });
beforeEach(() => {
  remote.request.mockReset(); const storage = new Map<string, string>();
  vi.stubGlobal("window", { sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
});
afterEach(() => vi.unstubAllGlobals());
it("requires real prize amounts, device products, a valid window and at most 100 places", () => {
  expect(raffleDraftError(draft())).toBe("");
  expect(raffleDraftError({ ...draft(), drawAt: draft().startsAt })).not.toBe("");
  expect(raffleDraftError({ ...draft(), titleVi: "" })).not.toBe("");
  expect(raffleDraftError({ ...draft(), prizes: [{ ...draft().prizes[0], quantity: 101 }] })).not.toBe("");
  expect(raffleDraftError({ ...draft(), prizes: [{ ...draft().prizes[0], rewardType: "DEVICE", amount: 1 }] })).not.toBe("");
  expect(raffleDraftError({ ...draft(), prizes: [{ ...draft().prizes[0], rewardType: "DEVICE", amount: 1, productNo: "sku-pro" }] })).toBe("");
});
it("creates a closed draft and keeps one command through uncertain response and readback", async () => {
  const value = draft(), saved = { ...value, status: "DRAFT", revision: 1, totalEntries: 0 };
  remote.request.mockRejectedValueOnce(new Error("timeout"));
  await expect(saveAdminRaffle(value, null, false, "新增抽奖草稿")).rejects.toThrow("timeout");
  remote.request.mockResolvedValueOnce(saved).mockResolvedValueOnce({ draws: [saved] });
  expect(await saveAdminRaffle(value, null, false, "新增抽奖草稿")).toEqual(saved);
  const first = remote.request.mock.calls[0][1], retry = remote.request.mock.calls[1][1];
  expect(first.method).toBe("POST"); expect(first.headers["Idempotency-Key"]).toBe(retry.headers["Idempotency-Key"]);
  expect(JSON.parse(first.body).enabled).toBeUndefined();
  expect(remote.request.mock.calls[2][0]).toBe("/genesis-raffle");
});

it("reads processing draws as locked delivery rounds", () => {
  expect(parseAdminRaffle({ ...draft(), status: "PROCESSING", revision: 2, totalEntries: 3 }).status).toBe("PROCESSING");
});
