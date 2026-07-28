import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("H5 PC mutations carry the visible server value as CAS evidence", () => {
  const client = read("lib/admin/h-client.ts");
  const page = read("app/components/domain-views/h-tabs/h5-daily-milestones.tsx");
  assert.match(client, /updateH5CheckInRule\([^)]*expectedValue/);
  assert.match(client, /updateH5StreakMilestone\([^)]*expectedValue/);
  assert.match(client, /updateH5PowerUp\([^)]*expectedDay/);
  assert.match(page, /updateH5StreakMilestone\(milestone\.id,\s*value,\s*milestone\.reward,\s*reason\)/s);
  assert.match(client, /\/check-in\/power-ups\/\$\{id\}\/config/);
  assert.match(page, /updateH5PowerUp\(\s*powerUp\.id,\s*form\.day,[\s\S]*powerUp\.day/s);
});

test("H5 backend uses stable database identifiers and atomic compare-and-set SQL", () => {
  const mapper = read("../nexion-backend/src/main/java/ffdd/opsconsole/growth/mapper/GrowthQuestEventMapper.java");
  const service = read("../nexion-backend/src/main/java/ffdd/opsconsole/growth/application/OpsGrowthService.java");
  assert.doesNotMatch(mapper, /SELECT id - 1 AS id,\s+CONCAT\(milestone_day/);
  assert.doesNotMatch(mapper, /SELECT id - 1 AS id,\s+unlock_streak_days/);
  assert.doesNotMatch(mapper, /WHERE id = #\{(?:milestoneId|powerUpId)\} \+ 1/);
  assert.match(mapper, /reward_name\s*=\s*#\{expectedReward\}/);
  assert.match(mapper, /unlock_streak_days\s*=\s*#\{expectedDay\}/);
  assert.match(service, /H5_CONFIG_STALE/);
  const migration = read("../nexion-backend/scripts/migrations/20260727_h5_daily_nex_canonical_closure.sql");
  assert.match(migration, /reward_type='NEX'/);
  assert.match(migration, /daily\.streak_restored/);
  assert.doesNotMatch(migration, /base_points/);
});

test("H5 App remote mode has canonical endpoints and cannot mint local rewards", () => {
  const api = read("../NX1.0/src/api/points-api.ts");
  const store = read("../NX1.0/src/store/nex-faucet.ts");
  const page = read("../NX1.0/src/pages/daily/daily.vue");
  assert.match(api, /\/api\/points\/sign-in/);
  assert.match(api, /\/api\/points\/streak-saver\/use/);
  assert.match(store, /if \(remoteApiEnabled\) \{\s*return \{ ok: false/s);
  assert.match(store, /signInCanonical/);
  assert.match(page, /if \(remoteApiEnabled\)[\s\S]*signInCanonical/);
});
