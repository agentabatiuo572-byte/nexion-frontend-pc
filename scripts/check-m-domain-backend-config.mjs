import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assertContains(file, needle, why) {
  if (!read(file).includes(needle)) failures.push(`${file} missing ${needle} (${why})`);
}

function assertAbsent(file, needle, why) {
  if (read(file).includes(needle)) failures.push(`${file} still contains ${needle} (${why})`);
}

assertAbsent("app/components/domain-views/m-tabs/data.ts", "LOAD_CONFIG_DEFAULT", "M load config must come from backend");
assertAbsent("app/components/domain-views/m-tabs/data.ts", "TRANSFER_QUEUES", "M transfer queues must come from backend transferTargets");
assertAbsent("app/components/domain-views/m-tabs/m1-overview.tsx", "LOAD_CONFIG_DEFAULT", "M1 must not use local load-config defaults");
assertAbsent("app/components/domain-views/m-tabs/m3-sessions.tsx", "SUPPORT_SLA", "M3 transfer queues must not use static SLA fixtures");
assertAbsent("app/components/domain-views/m-tabs/m3-modals.tsx", "SUPPORT_SLA", "M3 transfer modal must not use static SLA fixtures");
assertAbsent("app/components/domain-views/m-view.tsx", "转人工备勤队列", "M writes must not synthesize overflowQueue");
assertAbsent("lib/admin/m-client.ts", "DEFAULT_LOAD_CONFIG", "M client must not synthesize load-config defaults");
assertAbsent("lib/admin/m-client.ts", "转人工备勤队列", "M client must only consume backend load-config values");

assertContains("lib/admin/m-client.ts", 'apiRequest<Record<string, unknown>>("/tickets/load-config")', "load config backend endpoint");
assertContains("lib/admin/m-client.ts", 'apiRequest<SupportAgentOverview>("/support-agents")', "transfer targets backend endpoint");
assertContains("lib/admin/m-client.ts", '"I.session.transferTargets": JSON.stringify(data.transferTargets)', "backend transfer targets materialized for M3");
assertContains("lib/admin/m-client.ts", "M_LOAD_CONFIG_FIELD_MISSING", "missing backend load-config fields fail closed");
assertContains("app/components/domain-views/m-tabs/m1-overview.tsx", "loadConfigFromBackendParams", "M1 derives load config from backend params");
assertContains("app/components/domain-views/m-tabs/m1-overview.tsx", "后端配置未返回", "M1 blocks editing when backend config is absent");
assertContains("app/components/domain-views/m-tabs/m3-sessions.tsx", 'const TRANSFER_TARGETS_KEY = "I.session.transferTargets"', "M3 reads backend transfer target list");
assertContains("app/components/domain-views/m-tabs/m3-sessions.tsx", "const transferQueues = useMemo(() => {", "M3 computes queue options locally from backend transferTargets");
assertContains("app/components/domain-views/m-tabs/m3-sessions.tsx", '.filter((target) => textOf(target.targetType).toLowerCase() === "queue")', "M3 queue options filter backend transferTargets by targetType");
assertContains("app/components/domain-views/m-view.tsx", "M_LOAD_CONFIG_BACKEND_SNAPSHOT_MISSING", "writes require backend snapshot");

if (failures.length > 0) {
  console.error("M domain backend config guard failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("M domain backend config guard passed.");
