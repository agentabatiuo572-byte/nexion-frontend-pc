import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveNexionAppRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const root = new URL("../", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, root), "utf8");
const appRoot = resolveNexionAppRoot({ adminRoot: path.resolve(import.meta.dirname, "..") });
const readApp = (relative) => readFileSync(path.join(appRoot, relative), "utf8");

test("H3 owns task category and direct completion route for day-one and weekly missions", () => {
  const view = read("app/components/domain-views/h-tabs/h3-quest-events.tsx");
  const client = read("lib/admin/h-client.ts");
  const schema = read("../nexion-backend/scripts/schema.sql");
  const mapper = read("../nexion-backend/src/main/java/ffdd/opsconsole/growth/mapper/GrowthQuestEventMapper.java");
  const appMapper = read("../nexion-backend/src/main/java/ffdd/opsconsole/growth/mapper/AppGrowthEngagementMapper.java");
  const appApi = readApp("src/api/quest-api.ts");
  const appCard = readApp("src/components/home/day-one-quest-card.vue");
  const weeklyHero = readApp("src/components/home/weekly-quest-hero.vue");
  const weeklyList = readApp("src/components/home/weekly-quest-list.vue");
  const weeklyBanner = readApp("src/components/home/conversion-banner.vue");

  assert.match(schema, /mission_category VARCHAR\(32\)/);
  assert.match(schema, /action_route VARCHAR\(255\)/);
  assert.match(mapper, /mission_category AS category/i);
  assert.match(mapper, /action_route AS href/i);
  assert.match(appMapper, /mission_category\) category/i);
  assert.match(appMapper, /action_route actionRoute/i);

  assert.match(view, /updateH3MissionPresentation/);
  assert.match(view, /key: "category"/);
  assert.match(view, /key: "actionRoute"/);
  assert.match(view, /类别/);
  assert.match(view, /去完成路径/);
  assert.match(client, /\/quest-events\/tasks\/\$\{encodeURIComponent\(taskCode\)\}\/presentation/);

  assert.match(appApi, /category: QuestTaskCategory/);
  assert.match(appApi, /actionRoute: string/);
  assert.match(appCard, /row\.category/);
  assert.match(appCard, /row\.actionRoute/);
  assert.doesNotMatch(appCard, /dayOneTaskCategory|dayOneTaskRoute/);
  assert.match(weeklyHero, /navTo\(q\.actionRoute\)/);
  assert.match(weeklyHero, /quest\.value\.category/);
  assert.match(weeklyList, /navTo\(q\.actionRoute\)/);
  assert.match(weeklyList, /q\.category/);
  assert.match(weeklyBanner, /navTo\(weeklyCard\.value\.actionRoute\)/);
  assert.match(weeklyBanner, /weeklyCard\.value\.category/);
  assert.doesNotMatch(weeklyBanner, /navTo\("\/pages\/missions\/missions"\)/);
});
