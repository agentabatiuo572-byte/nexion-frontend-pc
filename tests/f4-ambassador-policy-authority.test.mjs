import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("F4 reads and updates the exact ambassador policy consumed by the App", async () => {
  const [client, view, tab, route] = await Promise.all([
    read("lib/admin/f1-client.ts"),
    read("app/components/domain-views/f-view.tsx"),
    read("app/components/domain-views/f-tabs/f4-ops.tsx"),
    read("app/api/admin/teams/[...path]/route.ts"),
  ]);

  assert.match(client, /fetchF4AmbassadorPolicy/);
  assert.match(client, /updateF4AmbassadorPolicy/);
  assert.match(client, /expectedRevision:\s*policy\.revision/);
  assert.match(client, /row\.serverCanonical !== true/);
  assert.match(view, /Promise\.allSettled\(\[\s*fetchF4LeadershipPoolOverview\(\),\s*fetchF4AmbassadorPolicy\(\)/s);
  assert.match(view, /if \(overview\.status === "rejected"\) throw overview\.reason/);
  assert.match(view, /setF4AmbassadorPolicy\(ambassadorPolicy\.status === "fulfilled" \? ambassadorPolicy\.value : null\)/);
  assert.match(tab, /nx_team_ambassador_policy/);
  assert.match(tab, /调整申请政策/);
  assert.match(route, /\/api\/admin\/teams\/ambassador-policy/);
});
