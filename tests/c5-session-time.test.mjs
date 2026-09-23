import assert from "node:assert/strict";
import test from "node:test";
import { sessionTimeAnomaly } from "../lib/admin/session-time.ts";

test("C5 flags an eight-hour source offset but accepts ordered sessions", () => {
  const issuedAt = "2026-09-23 18:33:00";
  const revokedAt = "2026-09-23 18:33:10";
  assert.equal(sessionTimeAnomaly({ issuedAt, lastActiveAt: "2026-09-23 10:33:00", revokedAt }), true);
  assert.equal(sessionTimeAnomaly({ issuedAt, lastActiveAt: "2026-09-23 18:33:05", revokedAt }), false);
  assert.equal(sessionTimeAnomaly({ issuedAt, lastActiveAt: "2026-09-23 18:34:00", revokedAt }), true);
  assert.equal(sessionTimeAnomaly({ issuedAt, revokedAt: "2026-09-23 18:32:00" }), true);
});
