import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveNexionAppRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const appRoot = resolveNexionAppRoot({ adminRoot: path.resolve(import.meta.dirname, "..") });
const readApp = (relative) => readFileSync(path.join(appRoot, relative), "utf8");

test("H3 PC uses stable business codes, CAS and directional reward controls", () => {
  const view = read("app/components/domain-views/h-tabs/h3-quest-events.tsx");
  const client = read("lib/admin/h-client.ts");
  assert.match(view, /mission\.\$\{text\(task\.completionEvent\)\}\.reward/);
  assert.match(view, /monthly\.\$\{text\(mission\.id\)\}\.reward/);
  assert.match(view, /expectedValue/);
  assert.match(view, /amplifiesWhen:\s*"increase"/);
  assert.match(view, /重试加载/);
  assert.match(client, /expectedValue/);
});

test("H3 backend mutation closes transaction, mutex, stale-write and promo contracts", () => {
  const service = read("../nexion-backend/src/main/java/ffdd/opsconsole/growth/application/OpsGrowthService.java");
  const mapper = read("../nexion-backend/src/main/java/ffdd/opsconsole/growth/mapper/GrowthQuestEventMapper.java");
  assert.match(service, /@Transactional\(rollbackFor = Exception\.class\)\s+public ApiResult<Map<String, Object>> updateQuestConfig/);
  assert.match(service, /lockH3ConfigMutex/);
  assert.match(service, /QUEST_CONFIG_STALE/);
  assert.match(service, /QUEST_CONFIG_NO_CHANGE/);
  assert.match(service, /updatePromoBannerConfig/);
  assert.match(mapper, /WHERE mission_code = #\{missionCode\}/);
  assert.match(mapper, /WHERE challenge_code = #\{challengeCode\}/);
  assert.match(mapper, /lockPromoBanner/);
  assert.match(mapper, /FOR UPDATE/);
});

test("H3 App consumes authenticated server state and atomic claim; remote mode does not complete locally", () => {
  const api = readApp("src/api/quest-api.ts");
  const store = readApp("src/store/quest.ts");
  const missions = readApp("src/pages/missions/missions.vue");
  assert.match(api, /path: `\/api\/quests\/state\?locale=\$\{encodeURIComponent\(/);
  assert.match(api, /\["en", "zh", "vi"\]\.includes\(locale\) \? locale : "en"/);
  assert.match(api, /\/api\/quests\/\$\{encodeURIComponent/);
  assert.match(store, /if \(remoteApiEnabled\) \{[\s\S]*?void refreshRemote\(\);[\s\S]*?return \{ firstTime: false, rewardNex: 0, rewardUsdt: 0 \}/);
  assert.match(store, /async function claimRemote/);
  assert.match(store, /claimSequence/);
  assert.match(store, /isCurrentRequest\(\)/);
  assert.match(missions, /<WeeklyQuestHero \/>/);
  assert.match(missions, /<WeeklyQuestList \/>/);
});

test("H3 identifies the real weekly-card display fields consumed by the App", () => {
  const view = read("app/components/domain-views/h-tabs/h3-quest-events.tsx");
  const backendMapper = read("../nexion-backend/src/main/java/ffdd/opsconsole/growth/mapper/AppGrowthEngagementMapper.java");
  const appPresenter = readApp("src/lib/home-task-carousel.ts");

  assert.match(view, /本周任务卡展示参数/);
  for (const key of ["countdownDays", "countdownHours", "targetDevice", "targetDaily"]) {
    assert.match(view, new RegExp(`promoBanner\\.${key}`));
    assert.match(backendMapper, new RegExp(key));
    assert.match(appPresenter, new RegExp(key));
  }
  assert.match(view, /周任务名称和奖励来自活动任务/);
  assert.match(view, /启用首页促销兜底/);
  assert.match(view, /没有未领取周任务时跳商店/);
  assert.doesNotMatch(view, /上架本周转化卡|下架本周转化卡|转化卡上下架/);
});
