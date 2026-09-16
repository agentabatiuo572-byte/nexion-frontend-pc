import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveNexionBackendRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const client = readFileSync(new URL("../lib/admin/m-client.ts", import.meta.url), "utf8");
const m3 = readFileSync(new URL("../app/components/domain-views/m-tabs/m3-sessions.tsx", import.meta.url), "utf8");

test("M-FINAL13-001: authoritative transferable seats publish before an unrelated load-config request settles", () => {
  const agentPublish = client.indexOf("// M_FINAL13_TRANSFER_CANDIDATES_PROGRESS: publish validated seats immediately.");
  const loadConfigAwait = client.indexOf("// M_FINAL13_TRANSFER_CANDIDATES_PROGRESS: load-config is independent.");
  assert.ok(agentPublish >= 0, "support-agent success must have an explicit progressive publish boundary");
  assert.ok(loadConfigAwait >= 0, "load-config must remain an independent later task");
  assert.ok(agentPublish < loadConfigAwait, "transferable seats must not wait for tickets/load-config");
  assert.doesNotMatch(client, /Promise\.allSettled\(\[\s*apiRequest<Record<string, unknown>>\("\/tickets\/load-config"\),\s*fetchSharedM1SupportAgentOverview\(\),\s*\]\)/s);
});

test("M-FINAL13-001: M3 retains backend authority, excludes self and keeps stable seat ids", () => {
  const backendRoot = resolveNexionBackendRoot({ adminRoot: fileURLToPath(new URL("..", import.meta.url)) });
  const service = readFileSync(`${backendRoot}/src/main/java/ffdd/opsconsole/content/application/OpsSupportAgentService.java`, "utf8");
  const targets = service.slice(service.indexOf("private List<Map<String, Object>> transferTargets("), service.indexOf("private Map<String, Object> target("));
  assert.match(targets, /Boolean\.TRUE\.equals\(agent\.enabled\(\)\)/);
  assert.match(targets, /Boolean\.TRUE\.equals\(agent\.transferable\(\)\)/);
  assert.match(targets, /!Boolean\.TRUE\.equals\(agent\.busy\(\)\)/);
  assert.match(m3, /const transferAgents = useMemo\([\s\S]*?\(\) => transferTargets/);
  assert.match(m3, /id: textOf\(target\.targetId\)/);
  assert.match(m3, /<TransferModal currentOwnerId=\{selected\.ownerAgentId\}/);
  const modal = readFileSync(new URL("../app/components/domain-views/m-tabs/m3-modals.tsx", import.meta.url), "utf8");
  assert.match(modal, /a\.id !== currentOwnerId/);
  assert.match(modal, /坐席ID \{a\.id\}/);
});
