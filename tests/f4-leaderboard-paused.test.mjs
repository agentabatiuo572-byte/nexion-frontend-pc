import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../lib/admin/f1-client.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../app/components/domain-views/f-tabs/f4-ops.tsx", import.meta.url), "utf8");
const conversion = client.match(/function toBoolean\(value: unknown, fallback = false\) \{([\s\S]*?)\n\}/)?.[1];
const field = client.match(/leaderboardPaused: (.*),/)?.[1];
const projection = new Function("data", `const toBoolean = (value, fallback = false) => {${conversion}}; return (${field});`);

test("pause remains independent of risk status and older responses retain the config projection", () => {
  for (const leaderboardPeriodStatus of ["active", "flagged", "disqualified"]) {
    assert.equal(projection({ leaderboardPaused: true, leaderboardPeriodStatus }), true);
    assert.equal(projection({ leaderboardPaused: false, configValues: { "F.leaderboard.paused": "on" }, leaderboardPeriodStatus }), false);
    assert.equal(projection({ configValues: { "F.leaderboard.paused": "on" }, leaderboardPeriodStatus }), true);
    assert.equal(projection({ configValues: { "F.leaderboard.paused": "off" }, leaderboardPeriodStatus }), false);
  }
});

test("F4 presents the paused operating state separately from the existing resume action", () => {
  assert.match(view, /lbPaused && <div[^>]+role="status"[^>]*><b>排行榜已暂停<\/b>/);
  assert.match(view, /data\.leaderboardPaused \?\?/);
  assert.match(view, /lbPaused \? "恢复榜单" : "暂停榜单"/);
});
