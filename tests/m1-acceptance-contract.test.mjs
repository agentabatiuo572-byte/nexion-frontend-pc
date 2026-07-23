import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("M1 explains its read and write boundary and deep-links KPI cards to matching queues", () => {
  const overview = read("app/components/domain-views/m-tabs/m1-overview.tsx");
  const view = read("app/components/domain-views/m-view.tsx");
  const registry = read("lib/admin/registry/m.ts");

  assert.doesNotMatch(overview, /只看不改/);
  assert.doesNotMatch(registry, /只看不改/);
  assert.match(view, /指标只读 · 授权主管可维护坐席与负载/);
  assert.match(overview, /\/service\/tickets\?scope=active&status=pending_user/);
  assert.match(overview, /\/service\/sessions\?seg=unread/);
  assert.match(overview, /只有总管理员或客服主管能调整坐席与负载策略/);
});

test("M1 SLA health is time based and unmatched work remains visible", () => {
  const overview = read("app/components/domain-views/m-tabs/m1-overview.tsx");

  assert.match(overview, /firstResponseMins/);
  assert.match(overview, /resolutionHours/);
  assert.match(overview, /unassignedLoadCount/);
  assert.doesNotMatch(overview, /priority === "urgent"[\s\S]{0,120}105/);
});

test("M1 mutations require the dedicated authority and load config preserves backend agent state", () => {
  const overview = read("app/components/domain-views/m-tabs/m1-overview.tsx");
  const client = read("lib/admin/m-client.ts");

  assert.match(overview, /service_m1_write/);
  assert.match(client, /raw\.agentState/);
});

test("M1 keeps usable sections visible when a sibling M endpoint fails", () => {
  const overview = read("app/components/domain-views/m-tabs/m1-overview.tsx");
  const client = read("lib/admin/m-client.ts");

  assert.match(client, /Promise\.allSettled/);
  assert.match(client, /loadWarnings/);
  assert.match(overview, /部分信息暂未同步/);
});

test("M1 writes await the real result and reuse the same idempotency key after an unknown outcome", () => {
  const overview = read("app/components/domain-views/m-tabs/m1-overview.tsx");
  const view = read("app/components/domain-views/m-view.tsx");
  const client = read("lib/admin/m-client.ts");

  assert.match(overview, /const ok = await ctx\.setParam\("I\.support\.load\.__bulk"/);
  assert.match(overview, /const ok = await ctx\.setParam\("I\.support\.seatAssignment\.__update"/);
  assert.match(overview, /const ok = await ctx\.setParam\("I\.support\.advisorAssignment\.__create"/);
  assert.match(overview, /const ok = await ctx\.setParam\("I\.support\.advisorAssignment\.__delete"/);
  assert.match(overview, /if \(!ok\)[\s\S]{0,240}return;/);
  assert.match(overview, /结果未知[\s\S]{0,240}保留/);
  assert.match(view, /updateLoadConfig\(payload, reason, idempotencyKey\)/);
  assert.match(view, /rebalanceLoad\([^;]+reason, idempotencyKey\)/);
  assert.match(view, /assignSupportSeat\([^;]+reason, idempotencyKey\)/);
  assert.match(view, /assignAdvisorUsers\([^;]+reason, idempotencyKey\)/);
  assert.match(view, /deactivateAdvisorAssignment\([^;]+reason, idempotencyKey\)/);
  assert.match(client, /updateLoadConfig\(payload: MLoadConfigWrite, reason: string, idempotencyKey\?: string\)/);
  assert.match(client, /rebalanceLoad\(agents: Array<Record<string, unknown>>, reason: string, idempotencyKey\?: string\)/);
  assert.match(client, /headers: idempotencyKey \? \{ "Idempotency-Key": idempotencyKey \} : undefined/);
});
