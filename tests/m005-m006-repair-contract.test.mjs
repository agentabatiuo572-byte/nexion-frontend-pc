import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const readBackend = (path) => readFileSync(resolve(root, "..", "nexion-backend", path), "utf8");

test("M2 reads a dedicated least-privilege ticket assignee contract while M1 keeps its full roster", () => {
  const ticketController = readBackend("src/main/java/ffdd/opsconsole/content/web/OpsSupportTicketController.java");
  const agentController = readBackend("src/main/java/ffdd/opsconsole/content/web/OpsSupportAgentController.java");
  const candidate = readBackend("src/main/java/ffdd/opsconsole/content/domain/SupportTicketAssigneeCandidateView.java");
  const agentService = readBackend("src/main/java/ffdd/opsconsole/content/application/OpsSupportAgentService.java");
  const agentMapper = readBackend("src/main/java/ffdd/opsconsole/content/mapper/SupportAgentMapper.java");
  const client = read("lib/admin/m-client.ts");
  const tickets = read("app/components/domain-views/m-tabs/m2-tickets.tsx");
  const contentBff = read("app/api/admin/content/[...path]/route.ts");

  assert.match(ticketController, /@PreAuthorize\("hasAuthority\('service_m2_read'\)"\)[\s\S]*?@GetMapping\("\/assignee-candidates"\)/);
  assert.match(agentController, /@PreAuthorize\("hasAuthority\('service_m1_read'\)"\)[\s\S]*?@GetMapping\s*\n\s*public ApiResult<SupportAgentOverview> overview/);
  assert.match(candidate, /record SupportTicketAssigneeCandidateView\(\s*Long adminId,\s*String name\s*\)/);
  assert.doesNotMatch(candidate, /email|role|seatType|position|serviceTypes|tags|maxConcurrent|busy|assignedUserCount/i);
  const candidateMethod = agentService.match(/public ApiResult<List<SupportTicketAssigneeCandidateView>> ticketAssigneeCandidates\(\) \{[\s\S]*?\n    \}/)?.[0] ?? "";
  assert.match(candidateMethod, /repository\.listTicketAssigneeCandidates\(\)/);
  assert.doesNotMatch(candidateMethod, /accountService|overview\(|ensureSchema|ensureDefaultProfiles|profileViews|supportOperators/);
  const candidateSelect = agentMapper.match(/@Select\("""[\s\S]*?listTicketAssigneeCandidates\(\);/)?.[0] ?? "";
  assert.match(candidateSelect, /SELECT DISTINCT a\.id AS adminId/);
  assert.match(candidateSelect, /JOIN nx_support_agent_profile p/);
  assert.doesNotMatch(candidateSelect, /CREATE TABLE|ALTER TABLE|INSERT INTO|UPDATE nx_|DELETE FROM|FOR UPDATE/i);

  assert.match(client, /apiRequest<unknown>\("\/tickets\/assignee-candidates"\)/);
  assert.match(contentBff, /"tickets"/);
  assert.match(contentBff, /parts\.map\(\(part\) => encodeURIComponent\(part\)\)\.join\("\/"\)/);
  assert.match(client, /ticketAssigneeCandidatesAvailable: true/);
  assert.match(client, /apiRequest<unknown>\("\/support-agents"\)/);
  assert.match(tickets, /I\.support\.ticketAssigneeCandidates/);
  assert.match(tickets, /I\.support\.ticketAssigneeCandidatesAvailable/);
  assert.doesNotMatch(tickets, /agent\.enabled && agent\.transferable && agent\.serviceTypes/);
});

test("M2 candidate schema is exact and every failure mode stays fail-closed", () => {
  const client = read("lib/admin/m-client.ts");
  const readContract = read("lib/admin/m-support-read-contract.ts");
  const tickets = read("app/components/domain-views/m-tabs/m2-tickets.tsx");

  assert.match(readContract, /M2_TICKET_ASSIGNEE_CANDIDATES_MALFORMED/);
  assert.match(readContract, /Object\.keys\(row\)/);
  assert.match(readContract, /keys\.length !== 2/);
  assert.match(readContract, /key !== "adminId" && key !== "name"/);
  assert.match(client, /ticketAssigneeCandidates: \[\], ticketAssigneeCandidatesAvailable: false/);
  assert.match(readContract, /status === 401/);
  assert.match(readContract, /status === 403/);
  assert.match(readContract, /status >= 500/);
  assert.match(readContract, /CONTENT_API_MALFORMED_RESPONSE/);
  assert.match(client, /parseMContentApiEnvelope/);
  assert.match(client, /parseM1SupportAgentOverview/);
  assert.match(tickets, /坐席候选数据暂时无法同步/);
  assert.match(tickets, /ticketAssigneeCandidatesAvailable && ownerOptions\.length > 0/);
});

test("M1 shares one roster read generation, retries abort once, and the shell badge avoids the M1 bundle", () => {
  const client = read("lib/admin/m-client.ts");
  const readContract = read("lib/admin/m-support-read-contract.ts");
  const badges = read("app/components/shell/use-service-badges.ts");
  const overview = read("app/components/domain-views/m-tabs/m1-overview.tsx");

  assert.match(client, /M1_SUPPORT_AGENT_MAX_ATTEMPTS = 2/);
  assert.match(client, /m1SupportAgentGeneration/);
  assert.match(client, /adminShellSessionKey/);
  assert.match(client, /sessionKey === sessionKey/);
  assert.match(client, /m1SupportAgentTask/);
  assert.match(client, /authorities\.includes\("service_m1_read"\)/);
  assert.match(client, /authorities\.includes\("service_m2_read"\)/);
  assert.match(readContract, /isRetryableM1SupportAgentAbort/);
  assert.match(readContract, /attempt < maxAttempts/);
  assert.match(client, /supportAgentsAvailable = overview !== null/);
  assert.match(client, /supportAgentsAvailable: false/);
  assert.match(badges, /fetchMServicePendingConversations/);
  assert.doesNotMatch(badges, /fetchMContentData/);
  assert.match(overview, /坐席数据暂不可用/);
  assert.match(overview, /!supportAgentsAvailable/);
});
