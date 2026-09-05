import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createSlotAttemptStore } from "../lib/admin/pending-mutation-store.ts";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

function installStorage() {
  const cells = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => (cells.has(key) ? cells.get(key) : null),
      setItem: (key, value) => { cells.set(key, String(value)); },
      removeItem: (key) => { cells.delete(key); },
    },
  };
}

test("J emergency write gateway persists one command key across a refresh", () => {
  const source = read("lib/admin/j-client.ts");

  assert.match(source, /createSlotAttemptStore/);
  assert.match(source, /storageKey:\s*"nexion-admin-j-emergency-commands-v1"/);
  assert.match(source, /emergencyAttempts\.resolve\(\s*writeSlot,\s*inputFingerprint,/);
  assert.match(source, /emergencyAttempts\.forget\(writeSlot\)/);
  assert.doesNotMatch(source, /j\s*域\*\*目前还没有 pending store/);

  installStorage();
  let sequence = 0;
  const mint = () => `j-command-${++sequence}`;
  const slot = "PUT /kill-switches/withdraw";
  const intent = JSON.stringify({ enabled: "disabled" });

  const firstPage = createSlotAttemptStore({ storageKey: "nexion-admin-j-emergency-commands-v1" });
  const first = firstPage.resolve(slot, intent, mint);
  const reloadedPage = createSlotAttemptStore({ storageKey: "nexion-admin-j-emergency-commands-v1" });

  assert.equal(reloadedPage.resolve(slot, intent, mint), first,
    "an outcome-unknown retry after refresh must reuse the original Idempotency-Key");
  reloadedPage.forget(slot);
  assert.notEqual(reloadedPage.resolve(slot, intent, mint), first,
    "a converged command must release its slot for the next real operation");
});

test("J gateway fingerprints business intent without audit reason or operator", () => {
  const source = read("lib/admin/j-client.ts");
  assert.match(source, /function emergencyInputFingerprint/);
  assert.match(source, /delete canonical\.reason/);
  assert.match(source, /delete canonical\.operator/);
  assert.match(source, /emergencyInputFingerprint\(init\?\.body\)/);
});

test("J emergency writes fail closed when the command key cannot survive refresh", () => {
  const source = read("lib/admin/j-client.ts");
  assert.match(source, /emergencyAttempts\.isDurablyStored\(\s*writeSlot,\s*inputFingerprint,\s*commandKey\s*\)/);
  assert.match(source, /EMERGENCY_IDEMPOTENCY_STORE_UNAVAILABLE/);

  globalThis.window = {
    sessionStorage: {
      getItem: () => { throw new Error("storage disabled"); },
      setItem: () => { throw new Error("storage disabled"); },
      removeItem: () => { throw new Error("storage disabled"); },
    },
  };
  const store = createSlotAttemptStore({ storageKey: "j-disabled-storage" });
  const slot = "PUT /kill-switches/withdraw";
  const intent = JSON.stringify({ enabled: "disabled" });
  const commandKey = store.resolve(slot, intent, () => "j-command-disabled");

  assert.equal(store.isDurablyStored(slot, intent, commandKey), false,
    "an in-memory fallback must not be advertised as refresh-safe persistence");
});

test("J write gateway keeps the command pending unless success is explicit", () => {
  const source = read("lib/admin/j-client.ts");
  assert.match(source, /isWrite\s*&&\s*\(res\.headers\.get\("X-Nexion-Upstream-Outcome"\)\s*===\s*"unknown"[\s\S]*?outcomeStaysUnknown\(res\.status,\s*payload\.code\)\)/);
  assert.match(source, /isWrite\s*\?\s*payload\.code\s*!==\s*0/,
    "a 2xx empty body or missing code must not clear the emergency command key");
});

test("J emergency BFF preserves the upstream outcome header", () => {
  const route = read("app/api/admin/emergency/[...path]/route.ts");
  assert.match(route, /upstream\.headers\.get\("X-Nexion-Upstream-Outcome"\)/);
  assert.match(route, /responseHeaders\.set\("X-Nexion-Upstream-Outcome",\s*upstreamOutcome\)/);
});

test("J client is protected by the repository idempotency migration sentinel", () => {
  const sentinel = read("scripts/pending-idempotency-key-sentinel.mjs");
  assert.match(sentinel, /"lib\/admin\/j-client\.ts",/);
});

test("J emergency persistence regression runs in the repository verification gate", () => {
  assert.match(read("scripts/verify.mjs"), /tests\/j-emergency-pending-store-contract\.test\.mjs/);
});
