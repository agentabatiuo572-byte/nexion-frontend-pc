import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const uiPath = new URL("../app/components/domain-views/g-tabs/g7-repurchase.tsx", import.meta.url);
const clientPath = new URL("../lib/admin/g7-client.ts", import.meta.url);
const bffPath = new URL("../app/api/admin/market/[...path]/route.ts", import.meta.url);

test("G7 PC executes the current PRD direct command instead of creating an A2 proposal", async () => {
  const [ui, client, bff] = await Promise.all([
    readFile(uiPath, "utf8"), readFile(clientPath, "utf8"), readFile(bffPath, "utf8"),
  ]);
  assert.doesNotMatch(ui, /usePropose|findHighOp/);
  assert.match(ui, /await mutate\(/);
  assert.match(client, /method: "PUT"/);
  assert.match(bff, /\/api\/admin\/repurchase\/config/);
});

test("G7 exposes typed lock-days, correct RBAC split, G4 evidence and honest rate semantics", async () => {
  const [ui, client] = await Promise.all([readFile(uiPath, "utf8"), readFile(clientPath, "utf8")]);
  assert.match(ui, /lockDays/);
  assert.match(ui, /kind: "number"/);
  assert.match(ui, /finprod_g7_apy_write/);
  assert.match(ui, /finprod_g7_nurture_write/);
  assert.match(ui, /finprod_g7_write/);
  assert.match(ui, /g4Ref/);
  assert.match(ui, /reinvestRateAvailable/);
  assert.match(ui, /缺少漏斗分母/);
  assert.match(ui, /MATURE_UNCLAIMED: "到期未领取"/);
  assert.match(client, /pendingMutationKeys\.get\(scope\)/);
  assert.match(client, /pendingMutationKeys\.delete\(scope\)/);
});

test("G7 edit form rejects no-op changes while preserving valid zero-valued controls", async () => {
  const ui = await readFile(uiPath, "utf8");
  assert.match(ui, /disallowCurrent:\s*true/);
  assert.match(ui, /value === undefined \|\| value === null \|\| String\(value\)\.trim\(\) === ""/);
  assert.match(ui, /param\.key === "penalty" \? "decrease"/);
  assert.match(ui, /param\.key === "apy" \|\| param\.key === "nurture" \|\| param\.key === "lottery" \? "increase"/);
});
