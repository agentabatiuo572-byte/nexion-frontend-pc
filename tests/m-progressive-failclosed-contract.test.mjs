import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../lib/admin/m-client.ts", import.meta.url), "utf8");
const readContract = readFileSync(new URL("../lib/admin/m-support-read-contract.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../app/components/domain-views/m-view.tsx", import.meta.url), "utf8");
const progressiveSupportState = readFileSync(new URL("../lib/admin/m-progressive-support-state.ts", import.meta.url), "utf8");

test("M sections publish their own fail-closed result without waiting for unrelated M requests", () => {
  assert.match(client, /export async function fetchMContentData\(onProgress\?/);
  assert.match(client, /const ticketsTask =/);
  assert.match(client, /const conversationsTask =/);
  assert.match(client, /const knowledgeTask =/);
  assert.match(client, /const templatesTask =/);
  assert.match(client, /publish\(\{ tickets: \[\], ticketsAvailable: false \}, warning\)/);
  assert.match(client, /await Promise\.all\(tasks\)/);
  assert.doesNotMatch(client, /await Promise\.allSettled\(\[\s*fetchAllSupportTickets\(\)/);
});

test("M reads have a bounded timeout and malformed 200 envelopes fail closed", () => {
  assert.match(client, /CONTENT_API_TIMEOUT_MS/);
  assert.match(client, /new AbortController\(\)/);
  assert.match(client, /setTimeout\([^]*CONTENT_API_TIMEOUT_MS/);
  assert.match(client, /CONTENT_API_TIMEOUT/);
  assert.match(readContract, /CONTENT_API_MALFORMED_RESPONSE/);
  assert.match(readContract, /Object\.prototype\.hasOwnProperty\.call\(rawPayload, "data"\)/);
  assert.match(client, /assertSupportTicketPage/);
  assert.match(client, /assertSupportTicketDetail/);
});

test("M accepts a successful envelope only when code is the safe integer zero", () => {
  assert.match(readContract, /Number\.isSafeInteger\(rawPayload\.code\)/);
  assert.match(readContract, /code !== 0/);
  assert.match(readContract, /CONTENT_API_MALFORMED_RESPONSE/);
});

test("M2 rejects overlapping, duplicated, over-reported and under-reported ticket pages", () => {
  const loader = client.match(/async function fetchAllSupportTickets[\s\S]*?async function fetchAllSupportConversations/)?.[0] ?? "";
  assert.match(loader, /records\.length !== total/);
  assert.match(loader, /new Set\(records\.map\(\(row\) => row\.ticketNo\)\)\.size !== records\.length/);
  assert.match(loader, /M2_TICKET_PAGE_INCOMPLETE/);
});

test("M reload clears cross-session authority, but retains only a verified same-session roster while M1 is pending", () => {
  assert.match(view, /const mDataAuthEpoch = useRef<number \| null>\(null\)/);
  assert.match(view, /if \(mDataAuthEpoch\.current !== authEpoch\) \{\s*mDataAuthEpoch\.current = authEpoch;\s*setMData\(null\);\s*\}/);
  assert.match(view, /setMError\(null\);\s*setMLoading\(true\)/);
  assert.match(view, /fetchMContentData\(\(partial\) =>/);
  assert.match(view, /setMData\(\(previous\) => preserveVerifiedSupportAgentsDuringReload\(previous, partial\)\)/);
  assert.match(view, /setMData\(\(previous\) => preserveVerifiedSupportAgentsDuringReload\(previous, next\)\)/);
  assert.match(progressiveSupportState, /const m1ReadIsPending = !next\.supportAgentsAvailable && next\.supportAgentsError === "none"/);
  assert.match(progressiveSupportState, /if \(!m1ReadIsPending \|\| !previous\?\.supportAgentsAvailable\) return next/);
  assert.match(progressiveSupportState, /supportAgentsAvailable: true/);
});

test("M1 permission, auth, malformed and unavailable results revoke cached transfer authority fail-closed", () => {
  assert.match(readContract, /export type MSupportAgentFailureKind = "none" \| "auth" \| "permission" \| "malformed" \| "unavailable"/);
  // The carry-over branch is deliberately limited to the sole non-failure
  // value. Every classified failure therefore returns the fresh, empty M1
  // snapshot instead of reusing another operator's old transfer authority.
  assert.match(progressiveSupportState, /next\.supportAgentsError === "none"/);
  assert.match(progressiveSupportState, /if \(!m1ReadIsPending \|\| !previous\?\.supportAgentsAvailable\) return next/);
  assert.match(view, /mError \? "客服中心暂时无法同步数据,请稍后重试。"/);
});
