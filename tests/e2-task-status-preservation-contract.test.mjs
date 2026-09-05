import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../lib/admin/e2-client.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../lib/admin/platform-types.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../app/components/domain-views/e-view.tsx", import.meta.url), "utf8");
const verify = readFileSync(new URL("../scripts/verify.mjs", import.meta.url), "utf8");

test("E2 task reads preserve the server lifecycle status", () => {
  assert.match(types, /status:\s*"active"\s*\|\s*"paused"\s*\|\s*"inactive"/);
  assert.match(client, /status:\s*parseTaskStatus\(task\.status\)/);
});

test("E2 direct updates send the status read from the server", () => {
  assert.match(client, /status:\s*task\.status/);
  assert.doesNotMatch(client, /function toTaskPayload[\s\S]*?status:\s*"active"/);
});

test("E2 A2 edit proposals preserve the current task status", () => {
  assert.match(view, /const currentTask = tasks\.find\(\(task\) => task\.id === editTaskId\)/);
  assert.match(view, /status:\s*currentTask\.status/);
  assert.doesNotMatch(view, /mc\.op === "task-save"[\s\S]*?status:\s*"active"[\s\S]*?e2_task_update/);
});

test("E2 status-preservation regression runs in the repository verification gate", () => {
  assert.match(verify, /tests\/e2-task-status-preservation-contract\.test\.mjs/);
});
