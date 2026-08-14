import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("commerce callback client is admin-only and carries durable event plus CAS version", () => {
  const client = read("lib/admin/commerce-acceptance-sandbox.ts");
  assert.match(client, /\/api\/admin\/commerce\/acceptance\/sandbox-orders/);
  assert.match(client, /eventId/);
  assert.match(client, /expectedVersion/);
  assert.match(client, /reason: string/);
  assert.match(client, /method: "POST"/);
});

test("commerce BFF only proxies the exact acceptance list and callback routes", () => {
  const route = read("app/api/admin/commerce/[...path]/route.ts");
  assert.match(route, /path\.length === 4/);
  assert.match(route, /path\[0\] === "acceptance"/);
  assert.match(route, /path\[3\] === "callbacks"/);
  assert.match(route, /export async function GET/);
  assert.match(route, /path\.length === 2 && path\[0\] === "acceptance" && path\[1\] === "sandbox-orders"/);
  assert.match(route, /COMMERCE_ACCEPTANCE_ROUTE_NOT_FOUND/);
});
