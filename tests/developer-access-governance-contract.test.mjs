import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canReviewDeveloperAccess,
  developerAccessResourceGuard,
} from "../lib/admin/developer-access-policy.ts";

test("review guard only enables actions for the matching server state", () => {
  assert.deepEqual(developerAccessResourceGuard("PENDING"), {
    canApprove: true, canReject: true, canRevoke: false,
  });
  assert.deepEqual(developerAccessResourceGuard("APPROVED"), {
    canApprove: false, canReject: false, canRevoke: true,
  });
  assert.deepEqual(developerAccessResourceGuard("REVOKED"), {
    canApprove: false, canReject: false, canRevoke: false,
  });
  assert.deepEqual(developerAccessResourceGuard("EXPIRED"), {
    canApprove: false, canReject: false, canRevoke: false,
  });
});

test("unknown or stale state fails closed instead of enabling a guessed action", () => {
  assert.equal(canReviewDeveloperAccess("PENDING", "revoke"), false);
  assert.equal(canReviewDeveloperAccess("APPROVED", "approve"), false);
  assert.equal(canReviewDeveloperAccess("EXPIRED", "approve"), false);
  assert.equal(canReviewDeveloperAccess("UNKNOWN", "reject"), false);
});

test("A9 is registered in navigation, the port registry and the real Next proxy", () => {
  const root = join(import.meta.dirname, "..");
  const nav = readFileSync(join(root, "lib/nav/console-nav.ts"), "utf8");
  const view = readFileSync(join(root, "app/components/domain-views/a-view.tsx"), "utf8");
  const ported = readFileSync(join(root, "app/components/domain-views/ported.ts"), "utf8");
  const proxy = readFileSync(join(root, "app/api/admin/developer/[...path]/route.ts"), "utf8");
  assert.match(nav, /id: "A9"/);
  assert.match(view, /A9DeveloperAccess/);
  assert.match(ported, /A9/);
  assert.match(proxy, /Idempotency-Key/);
  assert.match(proxy, /nexion_admin_token/);
});

test("PC review retries keep a stable key per request/action across refresh", () => {
  const source = readFileSync(join(import.meta.dirname, "../app/components/domain-views/a-tabs/a9-developer-access.tsx"), "utf8");
  assert.match(source, /createSlotAttemptStore/);
  assert.match(source, /developerAccessAttempts\.resolve/);
  assert.match(source, /developerAccessAttempts\.forget/);
  assert.doesNotMatch(source, /useRef\s*\(\s*new\s+Map/);
  assert.doesNotMatch(source, /Date\.now\(\)/);
});
