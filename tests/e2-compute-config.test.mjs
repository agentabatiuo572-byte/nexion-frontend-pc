import test from "node:test";
import assert from "node:assert/strict";
import { TASK_DURATION_DEFAULTS, validateComputeTaskConfig } from "../lib/admin/e2-compute-config.ts";
import { findHighOp } from "../lib/admin/high-ops-registry.ts";
import { readFileSync } from "node:fs";
import ts from "typescript";

test("six legacy estimates and Compute V2 boundaries", () => {
  assert.deepEqual(TASK_DURATION_DEFAULTS, { IG: 18, VG: 900, LL: 12, FT: 1800, EM: 5, SP: 30 });
  const valid = { selectionWeight: 1, expectedDurationMinSec: 5, expectedDurationMaxSec: 5, executionTimeoutSec: 5, runtimeKey: "bge-m3", validatorKey: "bge-recompute", workloadConfigJson: '{"input":"test"}' };
  assert.equal(validateComputeTaskConfig(valid), null);
  for (const patch of [{ selectionWeight: 0 }, { selectionWeight: 1.5 }, { selectionWeight: 1000001 }, { expectedDurationMinSec: 6 }, { expectedDurationMaxSec: 86401 }, { executionTimeoutSec: 4 }, { runtimeKey: "x".repeat(97) }, { workloadConfigJson: "[]" }, { workloadConfigJson: "null" }, { workloadConfigJson: "{" }, { workloadConfigJson: JSON.stringify({ text: "中".repeat(6000) }) }]) {
    assert.ok(validateComputeTaskConfig({ ...valid, ...patch }), JSON.stringify(patch).slice(0, 100));
  }
  assert.equal(validateComputeTaskConfig({}), null, "omitted legacy fields preserve server configuration");
});

test("A2 create and update retain every frozen-execution configuration field", () => {
  const config = { selectionWeight: 2, expectedDurationMinSec: 5, expectedDurationMaxSec: 8, executionTimeoutSec: 30, runtimeKey: "bge-m3", validatorKey: "bge-recompute", workloadConfigJson: '{"input":"test"}' };
  for (const op of ["e2_task_create", "e2_task_update"]) {
    const command = findHighOp(op).buildCommand({ taskId: "EM-1", name: "Embedding", status: "paused", ...config });
    for (const [key, value] of Object.entries(config)) assert.equal(command.params[key], value);
    assert.equal(command.params.status, "paused");
  }
});

test("direct task reads and writes round-trip V2 config, while legacy reads retain class defaults", async () => {
  const config = { selectionWeight: 3, expectedDurationMinSec: 5, expectedDurationMaxSec: 8, executionTimeoutSec: 30, runtimeKey: "bge-m3", validatorKey: "bge-recompute", workloadConfigJson: '{"input":"test"}' };
  const row = { taskId: "EM-1", name: "Embedding", status: "paused", taskClass: "EM", ...config };
  const requests = [];
  let result = { records: [row, { ...row, taskId: "IG-1", taskClass: "IG", selectionWeight: undefined, expectedDurationMinSec: undefined, expectedDurationMaxSec: undefined }], total: 2 };
  const source = readFileSync(new URL("../lib/admin/e2-client.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("require", "exports", compiled)(name => {
    if (name.endsWith("e2-compute-config")) return { TASK_DURATION_DEFAULTS, validateComputeTaskConfig };
    if (name.endsWith("error-messages")) return { formatAdminApiError: String, guardedFetch: async (path, init) => { requests.push({ path, body: init?.body ? JSON.parse(init.body) : null }); return { ok: true, json: async () => ({ code: 0, data: result }) }; } };
    if (name.endsWith("e2-onboarding-yield-contract")) return {};
    assert.fail(`Unexpected import ${name}`);
  }, module.exports);
  const rows = await module.exports.fetchE2Tasks();
  for (const [key, value] of Object.entries(config)) assert.equal(rows[0][key], value);
  assert.equal(rows[1].selectionWeight, 1); assert.equal(rows[1].expectedDurationMinSec, 18); assert.equal(rows[1].expectedDurationMaxSec, 18);
  result = row;
  for (const write of [module.exports.createE2Task, module.exports.updateE2Task]) {
    const saved = await write(rows[0], "test reason", "operator");
    for (const [key, value] of Object.entries(config)) { assert.equal(requests.at(-1).body[key], value); assert.equal(saved[key], value); }
    assert.equal(requests.at(-1).body.status, "paused");
  }
  const count = requests.length;
  await assert.rejects(module.exports.updateE2Task({ ...rows[0], selectionWeight: 0 }, "test reason", "operator"));
  assert.equal(requests.length, count, "invalid config is rejected before a request");
});
