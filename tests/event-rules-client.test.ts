import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchEventRules, parseEventRule, updateEventRule, type EventRuleView } from "../lib/admin/event-rules-client";

const remote = vi.hoisted(() => ({ request: vi.fn(), operator: "admin-a" }));
vi.mock("../lib/admin/h-client", () => ({ growthRequest: remote.request }));
vi.mock("../lib/admin/current-operator", () => ({ currentAdminOperator: () => remote.operator }));
const row = (): EventRuleView => ({ eventCode: "evt-referral", kind: "referral", revision: 2, enabled: false, rulesLocked: false, startsAt: null, endsAt: null, rules: { targetInvites: 5 }, readiness: { ready: false, missing: ["giftProductNo"] } });
beforeEach(() => {
  remote.request.mockReset(); remote.operator = "admin-a";
  const store = new Map<string, string>();
  vi.stubGlobal("window", { sessionStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) } });
});
afterEach(() => vi.unstubAllGlobals());
it("rejects an incomplete rule/readiness response without manufacturing an enabled state", async () => {
  expect(parseEventRule(row())).toEqual(row());
  expect(() => parseEventRule({ ...row(), readiness: null })).toThrow();
  expect(() => parseEventRule({ ...row(), enabled: 1 })).toThrow();
  remote.request.mockResolvedValue({ rules: [row()] }); expect(await fetchEventRules()).toEqual([row()]);
});
it("keeps the same command key for an unknown retry and sends the expected revision", async () => {
  const change = { enabled: false, startsAt: null, endsAt: null, rules: { targetInvites: 5 } };
  remote.request.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce({ ...row(), revision: 3 });
  await expect(updateEventRule("evt-referral", change, 2, "配置邀请奖励")).rejects.toThrow("timeout");
  await updateEventRule("evt-referral", change, 2, "配置邀请奖励");
  const first = remote.request.mock.calls[0], second = remote.request.mock.calls[1];
  expect(first[0]).toBe("/event-rules/evt-referral");
  expect(first[1].headers["Idempotency-Key"]).toBe(second[1].headers["Idempotency-Key"]);
  expect(JSON.parse(first[1].body)).toEqual({ ...change, expectedRevision: 2, reason: "配置邀请奖励" });
  remote.request.mockResolvedValueOnce({ ...row(), revision: 4 });
  await updateEventRule("evt-referral", change, 3, "再次保存");
  expect(remote.request.mock.calls[2][1].headers["Idempotency-Key"]).not.toBe(first[1].headers["Idempotency-Key"]);
});
it("does not accept another event's save result", async () => {
  remote.request.mockResolvedValue({ ...row(), eventCode: "other-event" });
  await expect(updateEventRule("evt-referral", { enabled: false, startsAt: null, endsAt: null, rules: {} }, 2, "配置")).rejects.toThrow("不匹配");
});
