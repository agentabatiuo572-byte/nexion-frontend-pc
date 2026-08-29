import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const marketRoute = read("app/api/admin/market/[...path]/route.ts");
const financeRoute = read("app/api/admin/finance/[...path]/route.ts");
const contentRoute = read("app/api/admin/content/[...path]/route.ts");
const commerceRoute = read("app/api/admin/commerce/[...path]/route.ts");
const growthRoute = read("app/api/admin/growth/[...path]/route.ts");

assert.doesNotMatch(marketRoute, /market\/exchange\/acceptance|parts\[1\] === "acceptance"/);
assert.doesNotMatch(financeRoute, /payout-vnd\/sandbox|parts\[1\] === "sandbox"/);
assert.doesNotMatch(contentRoute, /learning-acceptance|isAcceptanceSupport/);
assert.match(contentRoute, /acceptance[\s\S]*SANDBOX_RETIRED/);
assert.match(contentRoute, /part\.toLowerCase\(\)\.includes\("acceptance"\)/);
assert.match(commerceRoute, /SANDBOX_RUNTIME_RETIRED/);
assert.doesNotMatch(commerceRoute, /BACKEND_BASE_URL|fetch\(/);
assert.match(growthRoute, /referral-rewards[\s\S]*acceptance[\s\S]*SANDBOX_RUNTIME_RETIRED/);

for (const [path, forbidden] of [
  ["app/components/domain-views/e-tabs/e4-orders.tsx", /commerce-acceptance-sandbox|Acceptance Sandbox/],
  ["app/components/domain-views/g-tabs/g2-exchange.tsx", /g2-acceptance-sandbox|Acceptance Sandbox/],
  ["app/components/domain-views/d-tabs/d7-payout-vnd.tsx", /createPayoutVndSandboxOrder|Sandbox 未启用/],
  ["app/components/domain-views/l-tabs/l6-behavior-heatmap.tsx", /fetchL6AcceptanceBehavior|acceptancePanel|SANDBOX_ONLY|Sandbox 独立观察/],
  ["app/components/domain-views/m-tabs/m3-sessions.tsx", /m-support-acceptance-sandbox|acceptanceMode/],
  ["app/components/domain-views/m-view.tsx", /m-support-acceptance-sandbox|acceptanceMode/],
]) {
  assert.doesNotMatch(read(path), forbidden, path);
}

assert.equal(existsSync(new URL("../../app/acceptance/learning/page.tsx", import.meta.url)), false);
assert.equal(existsSync(new URL("../../app/_console/overview/learning-acceptance/page.tsx", import.meta.url)), false);
const hClient = read("lib/admin/h-client.ts");
assert.doesNotMatch(hClient, /NEXT_PUBLIC_NEXION_ACCEPTANCE_RUN_ID/);
assert.doesNotMatch(hClient, /return fetchH8AcceptanceSandboxOverview\(runId\)/);
assert.doesNotMatch(read("lib/admin/payout-vnd-client.ts"), /PayoutVndSandboxOrder|\/payout-vnd\/sandbox/);
assert.doesNotMatch(read("lib/admin/l-client.ts"), /fetchL6AcceptanceBehavior|\/behavior\/acceptance|L6_ACCEPTANCE_/);
assert.doesNotMatch(read("docs/ops-actions.manifest.json"), /createPayoutVndSandboxOrder|completePayoutVndSandboxOrder/);
assert.doesNotMatch(read("app/_console/overview/risk-radar/page.tsx"), /emailMode === "sandbox"|sandbox 邮件回执/);
assert.doesNotMatch(read("app/components/domain-views/design-kit.tsx"), /sandboxOverrideEnabled|本地 Sandbox 验收覆盖/);
assert.doesNotMatch(read("lib/admin/error-messages.ts"), /ACCEPTANCE_RUN_ID|LEARNING_ACCEPTANCE|M_SUPPORT_ACCEPTANCE|L6_ACCEPTANCE/);

console.log("SANDBOX_RETIREMENT_CONTRACT: PASS");
