import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("A3 renders two authoritative parameters and sends CAS guarded mutations", () => {
  const page = read("app/components/domain-views/a-tabs/a3-config.tsx");
  const client = read("lib/admin/a3-client.ts");
  assert.match(page, /全球限流上限/);
  assert.match(page, /提现强审阈值/);
  assert.match(page, /updateA3Parameter/);
  assert.doesNotMatch(page, /服务端权威契约未完成/);
  assert.match(client, /expectedValue/);
  assert.match(client, /A3OutcomeUncertainError/);
  assert.match(page, /a3ParamCommands\.resolve/);
  assert.match(page, /复用同一命令号/);
});

test("A4 lifecycle and A2 maker withdrawal are visible real commands", () => {
  const a4 = read("app/components/domain-views/a-tabs/a4-events.tsx");
  const a4Client = read("lib/admin/a4-client.ts");
  const a2 = read("app/components/domain-views/a-tabs/a2-audit.tsx");
  const a2Client = read("lib/admin/a2-client.ts");
  const platformProxy = read("app/api/admin/platform/[...path]/route.ts");
  assert.match(a4, /transitionA4Lifecycle/);
  assert.match(a4Client, /schema-registrations.*lifecycle/s);
  assert.match(a2, /withdrawA2Operation/);
  assert.match(a2Client, /\/withdraw/);
  assert.match(platformProxy, /schema-registrations.*lifecycle/s);
  assert.match(platformProxy, /reject.*withdraw/s);
});

test("A1 registration and B5 delivery disposition are server backed and fail closed", () => {
  const a1 = read("app/components/domain-views/a-tabs/a1-accounts.tsx");
  const a1Client = read("lib/admin/a1-client.ts");
  const b5 = read("app/_console/overview/risk-radar/page.tsx");
  const b5Client = read("lib/admin/b5-client.ts");
  assert.match(a1, /registerA1Permission/);
  assert.match(a1Client, /\/permissions/);
  assert.match(b5, /updateB5SignalStatus/);
  assert.match(b5, /deliveryStatus/);
  assert.match(b5, /我的站内告警/);
  assert.match(b5, /acknowledgeB5Inbox/);
  assert.match(b5Client, /B5OutcomeUnknownError/);
  assert.match(b5Client, /signals.*status/s);
  assert.match(b5Client, /radar\/inbox/);
  assert.match(b5Client, /Idempotency-Key/);
});
