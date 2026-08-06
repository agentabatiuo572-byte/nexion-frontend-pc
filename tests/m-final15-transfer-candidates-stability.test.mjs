import assert from "node:assert/strict";
import test from "node:test";

import { preserveVerifiedSupportAgentsDuringReload } from "../lib/admin/m-progressive-support-state.ts";

const owner = {
  id: "99968",
  adminId: 99968,
  name: "Final14 owner support",
  enabled: true,
  transferable: true,
  busy: false,
};
const receiver = {
  id: "99969",
  adminId: 99969,
  name: "Final14 receiver support",
  enabled: true,
  transferable: true,
  busy: false,
};

function snapshot(overrides = {}) {
  return {
    supportAgents: [],
    supportAgentsAvailable: false,
    supportAgentsError: "none",
    advisorAssignments: [],
    transferTargets: [],
    marker: "pending",
    ...overrides,
  };
}

test("M-FINAL15-001: a verified M1 seat read survives unrelated progress and a hanging second reload", () => {
  const verified = snapshot({
    supportAgents: [owner, receiver],
    supportAgentsAvailable: true,
    advisorAssignments: [{ id: 1, agentAdminId: receiver.adminId }],
    transferTargets: [{ targetType: "agent", targetId: receiver.id, targetName: receiver.name }],
    marker: "verified-support-agents",
  });
  const unrelatedProgress = snapshot({ marker: "tickets-completed-while-m1-read-is-pending" });

  const afterFirstProgress = preserveVerifiedSupportAgentsDuringReload(verified, unrelatedProgress);
  const afterHangingSecondReload = preserveVerifiedSupportAgentsDuringReload(afterFirstProgress, snapshot({ marker: "templates-completed-while-m1-read-is-still-pending" }));
  const candidates = afterHangingSecondReload.supportAgents
    .filter((agent) => agent.enabled && agent.transferable && !agent.busy && agent.id !== owner.id);

  assert.equal(afterHangingSecondReload.marker, "templates-completed-while-m1-read-is-still-pending");
  assert.deepEqual(candidates.map((agent) => agent.id), [receiver.id]);
  assert.equal(afterHangingSecondReload.transferTargets[0].targetId, receiver.id);
});

test("M-FINAL15-001: a resolved M1 denial clears cached seats instead of keeping stale transfer authority", () => {
  const verified = snapshot({ supportAgents: [owner, receiver], supportAgentsAvailable: true });
  const denied = preserveVerifiedSupportAgentsDuringReload(
    verified,
    snapshot({ supportAgentsError: "permission", marker: "m1-explicitly-denied" }),
  );

  assert.equal(denied.supportAgentsAvailable, false);
  assert.equal(denied.supportAgentsError, "permission");
  assert.deepEqual(denied.supportAgents, []);
});
