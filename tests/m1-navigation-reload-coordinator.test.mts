import test from "node:test";
import assert from "node:assert/strict";

import { MDomainLoadCoordinator } from "../lib/admin/m-content-load-coordinator.ts";
import { failClosedSupportAgentsAfterReload } from "../lib/admin/m-progressive-support-state.ts";

type Deferred = { promise: Promise<void>; resolve: () => void };

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("an SSE snapshot completing during browser-back reload cannot cancel the M1 authority result", async () => {
  const coordinator = new MDomainLoadCoordinator();
  const fullLoad = coordinator.beginFullLoad();
  const m1Response = deferred();
  let rosterState: "pending" | "available" | "fail-closed" = "pending";

  const applyM1 = m1Response.promise.then(() => {
    if (coordinator.isFullLoadCurrent(fullLoad)) rosterState = "available";
  });
  const snapshot = coordinator.beginConversationSnapshot();
  await Promise.resolve();

  assert.equal(coordinator.isFullLoadCurrent(fullLoad), true, "SSE generation must not supersede the full M reload");
  assert.equal(coordinator.isConversationSnapshotCurrent(snapshot), true);
  m1Response.resolve();
  await applyM1;
  assert.equal(rosterState, "available");
});

test("a newer full reload invalidates an old conversation snapshot and converges failures fail-closed", async () => {
  const coordinator = new MDomainLoadCoordinator();
  coordinator.beginFullLoad();
  const oldStreamSignal = coordinator.conversationStreamSignal;
  const oldSnapshot = coordinator.beginConversationSnapshot();
  const currentFullLoad = coordinator.beginFullLoad();

  assert.equal(oldStreamSignal.aborted, true, "a full reload must synchronously abort the prior SSE recovery snapshot");
  assert.equal(coordinator.conversationStreamSignal.aborted, false, "the next connection receives a fresh lifecycle signal");
  assert.equal(coordinator.isConversationSnapshotCurrent(oldSnapshot), false);
  assert.equal(coordinator.isFullLoadCurrent(currentFullLoad), true);

  const failed = failClosedSupportAgentsAfterReload({
    supportAgents: [{ id: "stale" }],
    supportAgentsAvailable: false,
    supportAgentsError: "none",
    advisorAssignments: [{ id: "stale" }],
    transferTargets: [{ id: "stale" }],
  });
  assert.deepEqual(failed, {
    supportAgents: [],
    supportAgentsAvailable: false,
    supportAgentsError: "unavailable",
    advisorAssignments: [],
    transferTargets: [],
  });
});

test("late progress and final results from an older full load cannot overwrite the current generation", async () => {
  const coordinator = new MDomainLoadCoordinator();
  const oldFullLoad = coordinator.beginFullLoad();
  const oldProgress = deferred();
  const oldFinal = deferred();
  const applied: string[] = [];

  const publishOldProgress = oldProgress.promise.then(() => {
    if (coordinator.isFullLoadCurrent(oldFullLoad)) applied.push("old-progress");
  });
  const publishOldFinal = oldFinal.promise.then(() => {
    if (coordinator.isFullLoadCurrent(oldFullLoad)) applied.push("old-final");
  });

  const currentFullLoad = coordinator.beginFullLoad();
  if (coordinator.isFullLoadCurrent(currentFullLoad)) applied.push("current");
  oldProgress.resolve();
  oldFinal.resolve();
  await Promise.all([publishOldProgress, publishOldFinal]);

  assert.deepEqual(applied, ["current"]);
});
