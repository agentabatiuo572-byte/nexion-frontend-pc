import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const panel = read("app/components/domain-views/e-tabs/e4-orders.tsx");
const client = read("lib/admin/commerce-acceptance-sandbox.ts");
const route = read("app/api/admin/commerce/[...path]/route.ts");

assert.match(panel, /Acceptance Sandbox 商城回调/);
assert.match(panel, /source=mock · SANDBOX/);
assert.match(panel, /PAYMENT_SUCCEEDED[\s\S]*REFUNDED/);
assert.match(panel, /eventId = `pc-commerce:\$\{order\.orderNo\}:\$\{status\}:\$\{order\.version\}`/);
assert.match(client, /fetchCommerceAcceptanceSandboxOrders/);
assert.match(route, /export async function GET/);
console.log("commerce acceptance panel contract: PASS");
