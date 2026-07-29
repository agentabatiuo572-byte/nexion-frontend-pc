import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const b2Client = read("lib/admin/b2-client.ts");
const b2Page = read("app/_console/overview/liquidity/page.tsx");
const b3Client = read("lib/admin/b3-client.ts");
const b3Page = read("app/_console/overview/funnel/page.tsx");
const b3Proxy = read("app/api/admin/funnel/[[...path]]/route.ts");

test("B2 preserves one forecast-config command key while the upstream outcome is unknown", () => {
  assert.match(b2Client, /export class B2OutcomeUnknownError extends Error/);
  assert.match(b2Client, /X-Nexion-Upstream-Outcome/);
  assert.match(b2Client, /commandKey = idempotencyKey\("b2-forecast-config"\)/);
  assert.match(b2Page, /forecastConfigCommandKey = useRef<string \| null>\(null\)/);
  assert.match(b2Page, /updateB2ForecastConfig\([\s\S]*commandKey/);
  assert.match(b2Page, /if \(!\(caught instanceof B2OutcomeUnknownError\)\) \{[\s\S]*forecastConfigCommandKey\.current = null/);
});

test("B3 proxy marks an interrupted keyed write as result unknown", () => {
  assert.match(b3Proxy, /AbortSignal\.timeout\(20_000\)/);
  assert.match(b3Proxy, /X-Nexion-Upstream-Outcome/);
  assert.match(b3Proxy, /hasBody && idempotencyKey/);
  assert.match(b3Proxy, /response\.headers\.set\(UNKNOWN_OUTCOME_HEADER, "unknown"\)/);
});

test("B3 preserves one saved-view command key while the upstream outcome is unknown", () => {
  assert.match(b3Client, /export class B3OutcomeUnknownError extends Error/);
  assert.match(b3Client, /X-Nexion-Upstream-Outcome/);
  assert.match(b3Client, /commandKey = idempotencyKey\("b3-view"\)/);
  assert.match(b3Page, /viewCommandKey = useRef<string \| null>\(null\)/);
  assert.match(b3Page, /saveB3View\(viewName, filters, "WEEK", "PREVIOUS", commandKey\)/);
  assert.match(b3Page, /if \(!\(value instanceof B3OutcomeUnknownError\)\) \{[\s\S]*viewCommandKey\.current = null/);
});
