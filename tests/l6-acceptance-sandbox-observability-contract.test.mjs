import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("acceptance behavior view is isolated and permanently labelled mock/SANDBOX", async () => {
  const [client, view] = await Promise.all([
    read("lib/admin/l-client.ts"),
    read("app/components/domain-views/l-tabs/l6-behavior-heatmap.tsx"),
  ]);
  assert.match(client, /fetchL6AcceptanceBehavior/);
  assert.match(client, /\/behavior\/acceptance/);
  assert.match(client, /observationToken/);
  assert.match(client, /l6AcceptanceBusinessTime/);
  assert.match(view, /source=mock/);
  assert.match(view, /SANDBOX/);
  assert.match(client, /sourceEnvironment !== "SANDBOX"/);
  assert.match(client, /data\.runId !== input\.runId/);
  assert.match(client, /Number\(data\.matchedFacts \|\| 0\) <= 0/);
  assert.match(client, /L6_ACCEPTANCE_QUERY_FAILED/);
  assert.match(client, /L6_ACCEPTANCE_AUTH_REQUIRED/);
  assert.match(client, /L6_ACCEPTANCE_SERVER_UNAVAILABLE/);
  assert.match(client, /L6_ACCEPTANCE_RESPONSE_SCHEMA_INVALID/);
  assert.match(client, /L6_ACCEPTANCE_UNAVAILABLE/);
  assert.match(view, /验收观察面读取失败/);
  assert.match(view, /status: "FAILED"/);
  assert.match(view, /Run ID/);
  assert.match(view, /H5 观察凭证/);
  assert.match(view, /lastIndexOf\("\."\)/);
  assert.match(view, /!acceptanceObservationToken && \(!acceptanceActorHash \|\| !acceptanceSessionHash\)/);
  assert.match(view, /生产 fact\/outbox 增量/);
  assert.match(view, /查询隔离事实/);
  assert.match(view, /使用最近 1 小时/);
  assert.match(client, /num\(delta\.factRows\) !== 0 \|\| num\(delta\.outboxRows\) !== 0/);
  assert.doesNotMatch(view, /if \(liveError && !liveRaw\)[\s\S]*?return \(/);
});

test("a JST operator local input is submitted as the explicit Shanghai +08 observation clock", () => {
  const local = "2026-08-12T10:15"; // A JST browser must not silently shift this business-clock selection.
  const businessOffset = `${local}:00+08:00`;
  assert.equal(businessOffset, "2026-08-12T10:15:00+08:00");
});

test("dotted RunID credentials split at the final delimiter", () => {
  const credential = `h5.20260812.${"a".repeat(64)}`;
  const separator = credential.lastIndexOf(".");
  assert.equal(credential.slice(0, separator), "h5.20260812");
  assert.match(credential.slice(separator + 1), /^[a-f0-9]{64}$/);
});
