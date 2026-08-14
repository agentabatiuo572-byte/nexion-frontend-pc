import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (relative) => readFileSync(join(ROOT, relative), "utf8");

test("M17 uses one atomic batch command and reloads authoritative state on an unknown result", () => {
  const client = read("lib/admin/m-client.ts");
  const view = read("app/components/domain-views/m-view.tsx");

  const batchMethod = client.match(/async assignAdvisorUsers[\s\S]*?\n  },/)?.[0] ?? "";
  assert.match(batchMethod, /\/assignments\/batch/);
  assert.doesNotMatch(batchMethod, /for \(const userId/);
  assert.match(view, /catch \(error\)[\s\S]{0,500}await reloadMContent\(\)/);
});

test("M19 sends expected versions, avoids M1 stale profile fields, and relies on server CAS", () => {
  const m1 = read("app/components/domain-views/m-tabs/m1-overview.tsx");
  const m5 = read("app/components/domain-views/m-tabs/m5-scripts.tsx");
  const client = read("lib/admin/m-client.ts");

  const seatPayload = m1.match(/I\.support\.seatAssignment\.__update[\s\S]{0,500}/)?.[0] ?? "";
  assert.match(seatPayload, /expectedVersion:\s*selected\.version/);
  assert.doesNotMatch(seatPayload, /serviceTypes:\s*selected\.serviceTypes/);
  assert.doesNotMatch(seatPayload, /tags:\s*selected\.tags/);
  assert.match(m5, /expectedVersion:\s*agent\.version/);
  assert.match(client, /updateSupportAgentProfile[\s\S]{0,500}expectedVersion/);
  assert.match(client, /assignSupportSeat[\s\S]{0,500}expectedVersion/);
});

test("M20 loads M3 transfer targets and runtime context without requiring M1", () => {
  const client = read("lib/admin/m-client.ts");
  const m3 = read("app/components/domain-views/m-tabs/m3-sessions.tsx");

  assert.match(client, /\/conversations\/transfer-targets/);
  assert.match(client, /\/session-templates\/runtime/);
  assert.match(m3, /transferTargets[\s\S]{0,1000}initiateIdentities/);
  assert.doesNotMatch(m3, /const transferAgents = useMemo\([\s\S]{0,300}supportAgents\.filter/);
});

test("M21 awaits escalation and leaves the modal open when the command fails", () => {
  const m2 = read("app/components/domain-views/m-tabs/m2-tickets.tsx");
  const escalation = m2.match(/const escalateToConversation[\s\S]*?\n  };/)?.[0] ?? "";

  assert.match(escalation, /run:\s*async \(reason: string\)/);
  assert.match(escalation, /const succeeded = await commitTicketWrite/);
  assert.match(escalation, /return succeeded/);
  assert.doesNotMatch(escalation, /void commitTicketWrite/);
});

test("M22 selects the authoritative conversation number returned by the backend", () => {
  const view = read("app/components/domain-views/m-view.tsx");
  const m3 = read("app/components/domain-views/m-tabs/m3-sessions.tsx");

  assert.match(view, /const backendResult = await applyMBackendWrite/);
  assert.match(view, /meta\?\.onBackendResult\?\.\(backendResult\)/);
  assert.match(m3, /onBackendResult/);
  assert.match(m3, /conversationNo/);
  assert.doesNotMatch(m3, /if \(succeeded\) \{\s*setShowInitiate\(false\);\s*selectConvo\(cid\)/);
});

test("M23 preserves FAQ body edits when status changes in the same save", () => {
  const view = read("app/components/domain-views/m-view.tsx");
  const faqWriter = view.match(/async function writeFaqRows[\s\S]*?\n}/)?.[0] ?? "";

  assert.match(faqWriter, /contentChanged/);
  assert.match(faqWriter, /row\.status !== before\.status && !contentChanged/);
  assert.match(faqWriter, /updateFaq\(row, before/);
});

test("M24 gates cross-leaf reads and SSE and renders unavailable KPIs differently from zero", () => {
  const client = read("lib/admin/m-client.ts");
  const view = read("app/components/domain-views/m-view.tsx");
  const m1 = read("app/components/domain-views/m-tabs/m1-overview.tsx");
  const m5 = read("app/components/domain-views/m-tabs/m5-scripts.tsx");

  assert.match(client, /if \(!authorities\.includes\("service_m2_read"\)\)/);
  assert.match(client, /if \(!authorities\.includes\("service_m3_read"\)\)/);
  assert.match(client, /if \(!authorities\.includes\("service_m4_read"\)\)/);
  assert.match(client, /if \(!authorities\.includes\("service_m5_read"\)\)/);
  assert.match(view, /useConversationStream\(\{[\s\S]{0,160}enabled:/);
  assert.match(m1, /ticketsAvailable[\s\S]{0,1500}不可用/);
  assert.match(m1, /conversationsAvailable[\s\S]{0,1500}不可用/);
  assert.match(m5, /hasM1ReadAuthority[\s\S]{0,2500}fetchMSupportAgentsPage/);
});
