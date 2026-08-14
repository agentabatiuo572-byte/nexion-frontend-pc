import assert from "node:assert/strict";
import test from "node:test";

import {
  MContentReadError,
  classifySupportAgentFailure,
  loadWithBoundedAbortRetry,
  parseMContentApiEnvelope,
  parseM1SupportAgentOverview,
  parseTicketAssigneeCandidates,
} from "../lib/admin/m-support-read-contract.ts";

const validM1Overview = {
  agents: [{
    id: "7",
    adminId: 7,
    name: "Tomas R.",
    email: "tomas@example.test",
    adminRole: "support",
    status: "enabled",
    seatType: "GENERAL",
    position: "通用客服",
    serviceTypes: ["support"],
    tags: ["账户"],
    maxConcurrent: 12,
    enabled: true,
    transferable: true,
    busy: false,
    assignedUserCount: 0,
    version: 1,
    updatedAt: "2026-08-01T12:00:00",
  }],
  advisorAssignments: [],
  transferTargets: [{
    targetType: "agent",
    targetId: "7",
    targetName: "Tomas R.",
    position: "通用客服",
    serviceTypes: ["support"],
  }],
};

test("normal M2 candidates accept only the two-field projection", () => {
  assert.deepEqual(
    parseTicketAssigneeCandidates([{ adminId: 7, name: " Tomas R. " }]),
    [{ adminId: 7, name: "Tomas R." }],
  );
});

test("M2 candidates allow duplicate display names when stable admin IDs differ", () => {
  assert.deepEqual(
    parseTicketAssigneeCandidates([
      { adminId: 7, name: "Tomas R." },
      { adminId: 8, name: "Tomas R." },
    ]),
    [
      { adminId: 7, name: "Tomas R." },
      { adminId: 8, name: "Tomas R." },
    ],
  );
});

test("malformed 200 candidate bodies and over-broad rows fail closed", () => {
  for (const value of [
    null,
    {},
    [{ adminId: 7 }],
    [{ adminId: 0, name: "Nobody" }],
    [{ adminId: 7, name: "" }],
    [{ adminId: 7, name: "Tomas R.", email: "private@example.test" }],
    [{ adminId: 7, name: "Tomas R." }, { adminId: 7, name: "Duplicate" }],
  ]) {
    assert.throws(() => parseTicketAssigneeCandidates(value), /M2_TICKET_ASSIGNEE_CANDIDATES_MALFORMED/);
  }
});

test("M1 overview validates every authority-bearing roster row and relation", () => {
  assert.deepEqual(parseM1SupportAgentOverview(validM1Overview), validM1Overview);
  for (const value of [
    { ...validM1Overview, agents: [{}] },
    { ...validM1Overview, agents: [{ ...validM1Overview.agents[0], adminId: 0 }] },
    { ...validM1Overview, agents: [{ ...validM1Overview.agents[0], enabled: "true" }] },
    { ...validM1Overview, agents: [{ ...validM1Overview.agents[0], serviceTypes: ["root"] }] },
    { ...validM1Overview, advisorAssignments: [{ id: 1, agentAdminId: 999, userId: 2, status: "ACTIVE" }] },
    { ...validM1Overview, transferTargets: [{ ...validM1Overview.transferTargets[0], targetId: "999" }] },
  ]) {
    assert.throws(() => parseM1SupportAgentOverview(value), /M1_SUPPORT_AGENT_OVERVIEW_MALFORMED/);
  }
});

test("M1 roster identity is adminId, so legal duplicate display names remain readable", () => {
  const secondAgent = {
    ...validM1Overview.agents[0],
    id: "8",
    adminId: 8,
  };
  const duplicateNameOverview = {
    ...validM1Overview,
    agents: [...validM1Overview.agents, secondAgent],
    transferTargets: [
      ...validM1Overview.transferTargets,
      { ...validM1Overview.transferTargets[0], targetId: "8" },
    ],
  };
  assert.deepEqual(parseM1SupportAgentOverview(duplicateNameOverview), duplicateNameOverview);
});

test("non-JSON HTTP failures preserve 401/403/500 classification before envelope parsing", () => {
  for (const status of [401, 403, 500]) {
    assert.throws(
      () => parseMContentApiEnvelope(status, "<html>upstream failure</html>", true),
      (error) => error instanceof MContentReadError
        && error.status === status
        && classifySupportAgentFailure(error) === (status === 401 ? "auth" : status === 403 ? "permission" : "unavailable"),
    );
  }
  assert.deepEqual(
    parseMContentApiEnvelope(200, JSON.stringify({ code: 0, message: "OK", data: { ok: true } }), true),
    { ok: true },
  );
});

test("401, 403, 500 and malformed M1 results remain distinguishable", () => {
  assert.equal(classifySupportAgentFailure(new MContentReadError(401, 401, "AUTH_REQUIRED", "expired")), "auth");
  assert.equal(classifySupportAgentFailure(new MContentReadError(403, 403, "ADMIN_PERMISSION_DENIED", "denied")), "permission");
  assert.equal(classifySupportAgentFailure(new MContentReadError(500, 500, "FAILED", "failed")), "unavailable");
  assert.equal(classifySupportAgentFailure(new Error("CONTENT_API_MALFORMED_RESPONSE")), "malformed");
});

test("an aborted M1 read retries once and shares the successful bounded result", async () => {
  let attempts = 0;
  const result = await loadWithBoundedAbortRetry(async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("browser navigation aborted");
      error.name = "AbortError";
      throw error;
    }
    return "ok";
  }, 2);

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
});

test("401, 403 and 500 are never retried and repeated abort stops at the bound", async () => {
  for (const status of [401, 403, 500]) {
    let attempts = 0;
    await assert.rejects(
      loadWithBoundedAbortRetry(async () => {
        attempts += 1;
        throw new MContentReadError(status, status, "FAILED", "failed");
      }, 2),
      MContentReadError,
    );
    assert.equal(attempts, 1);
  }

  let aborts = 0;
  await assert.rejects(loadWithBoundedAbortRetry(async () => {
    aborts += 1;
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  }, 2), /aborted/);
  assert.equal(aborts, 2);

  let authEpochChanges = 0;
  await assert.rejects(loadWithBoundedAbortRetry(async () => {
    authEpochChanges += 1;
    const error = new Error("ADMIN_AUTH_EPOCH_CHANGED");
    error.name = "AdminAuthEpochChangedError";
    throw error;
  }, 2), /ADMIN_AUTH_EPOCH_CHANGED/);
  assert.equal(authEpochChanges, 1);
});
