import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../lib/admin/h-client.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/components/domain-views/h-tabs/h3-quest-events.tsx", import.meta.url), "utf8");

test("H3 existing tasks expose edit, status, archive and archived-only delete with server readback", () => {
  for (const fn of ["editH3Mission", "transitionH3Mission", "archiveH3Mission", "deleteH3Mission"]) {
    assert.match(client, new RegExp(`export (?:async )?function ${fn}\\b`));
  }
  assert.match(client, /\/quest-events\/tasks\/\$\{encodeURIComponent\(taskCode\)\}\/status/);
  assert.match(client, /\/quest-events\/tasks\/\$\{encodeURIComponent\(taskCode\)\}\/archive/);
  assert.match(page, />编辑</);
  assert.match(page, />归档</);
  assert.match(page, />删除</);
  assert.match(page, /status === "archived"/);
  assert.match(client, /const h3MissionCommands = createPendingMutationStore\(\{/);
  assert.match(client, /nexion-admin-h3-mission-commands-v1/);
  assert.match(client, /class H3MissionOutcomeUncertainError/);
  assert.match(client, /async function h3MissionCommand\(/);
  assert.match(client, /h3MissionCommands\.get\(fingerprint\)/);
  assert.match(client, /headers: \{ "Idempotency-Key": commandKey \}/);
  assert.match(client, /const readback = await fetchH3QuestEvents\("tasks"\)/);
  for (const fn of ["createH3Mission", "createH3MonthlyMission", "editH3Mission", "updateH3MissionPresentation", "transitionH3Mission", "archiveH3Mission", "deleteH3Mission"]) {
    assert.match(client, new RegExp(`export (?:async )?function ${fn}\\b[\\s\\S]*?h3MissionCommand\\(`));
  }
  assert.match(page, /isH3MissionOutcomeUncertainError/);
  assert.match(page, /const applyMissionMutation = async/);
  assert.doesNotMatch(page, /apply\(await (?:createH3Mission|createH3MonthlyMission|editH3Mission|updateH3MissionPresentation|transitionH3Mission|archiveH3Mission|deleteH3Mission)\(/);
});
