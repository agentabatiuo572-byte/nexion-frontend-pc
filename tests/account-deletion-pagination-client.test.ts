import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

function clientFor(data: unknown) {
  const source = readFileSync(new URL("../lib/admin/account-deletion-client.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const fetch = vi.fn(async (_path: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ code: 0, data }) }));
  const exports: Record<string, any> = {};
  new Function("require", "exports", compiled)((name: string) => {
    if (name.endsWith("error-messages")) return { guardedFetch: fetch, formatAdminApiError: (s: string) => s };
    if (name.endsWith("pending-mutation-store")) return { createSlotAttemptStore: () => ({}) };
    if (name.endsWith("outcome-classification")) return {};
    throw new Error(`Unexpected import ${name}`);
  }, exports);
  return { api: exports, fetch };
}
const row = { requestNo: "DEL-READ-TEST", userId: 1, version: 1, status: "REQUESTED" };

describe("account deletion page metadata", () => {
  it("retains the server total independently of page length and sends the selected filter", async () => {
    const { api, fetch } = clientFor({ records: [row], total: 41, page: 3, limit: 20 });
    const result = await api.fetchAccountDeletions("REQUESTED", 3, 20);
    expect(result).toMatchObject({ total: 41, page: 3, limit: 20 });
    expect(result.records).toHaveLength(1);
    expect(fetch.mock.calls[0][0]).toBe("/api/admin/users/account-deletions?page=3&limit=20&status=REQUESTED");
  });
  it("does not fabricate total from a legacy array, absent total or invalid metadata", async () => {
    for (const data of [[row], { records: [row] }, { records: [row], total: null },
      { records: [row], total: -1 }, { records: [row], total: 1.5 }]) {
      expect((await clientFor(data).api.fetchAccountDeletions("", 2, 20)).total).toBeNull();
    }
    expect((await clientFor({ records: [], total: 0 }).api.fetchAccountDeletions("")).total).toBe(0);
  });
});
