import test from "node:test";
import assert from "node:assert/strict";
import {
  E5OutcomeUncertainError,
  e5StableDeviceCommand,
} from "../lib/admin/e5-stable-device-command.ts";

test("E5 ambiguous device action reuses the same durable command key until it converges", async () => {
  const slot = `device:${Date.now()}:activate`;
  const fingerprint = JSON.stringify({ reason: "approved activation", operator: "qa" });
  let firstKey = "";

  await assert.rejects(
    e5StableDeviceCommand(slot, fingerprint, async (key) => {
      firstKey = key;
      throw new E5OutcomeUncertainError("E5_DEVICE_ACTION_OUTCOME_UNCERTAIN", key);
    }),
    E5OutcomeUncertainError,
  );

  let replayKey = "";
  await e5StableDeviceCommand(slot, fingerprint, async (key) => {
    replayKey = key;
    return "converged";
  });
  assert.equal(replayKey, firstKey);

  let nextIntentKey = "";
  await e5StableDeviceCommand(slot, fingerprint, async (key) => {
    nextIntentKey = key;
    return "new intent";
  });
  assert.notEqual(nextIntentKey, firstKey);
});

test("E5 deterministic rejection retires the command key", async () => {
  const slot = `device:${Date.now()}:deactivate`;
  const fingerprint = JSON.stringify({ reason: "approved deactivation", operator: "qa" });
  let rejectedKey = "";
  await assert.rejects(e5StableDeviceCommand(slot, fingerprint, async (key) => {
    rejectedKey = key;
    throw new Error("DEVICE_STATE_INVALID");
  }));

  let retriedKey = "";
  await e5StableDeviceCommand(slot, fingerprint, async (key) => {
    retriedKey = key;
    return "ok";
  });
  assert.notEqual(retriedKey, rejectedKey);
});

test("E5 does not discard a reused uncertain command after a later rejection", async () => {
  const slot = `device:${Date.now()}:force-activate`;
  const fingerprint = JSON.stringify({ reason: "approved force activation", operator: "qa" });
  let uncertainKey = "";
  await assert.rejects(e5StableDeviceCommand(slot, fingerprint, async (key) => {
    uncertainKey = key;
    throw new E5OutcomeUncertainError("E5_DEVICE_ACTION_OUTCOME_UNCERTAIN", key);
  }));

  let rejectedReplayKey = "";
  await assert.rejects(e5StableDeviceCommand(slot, fingerprint, async (key) => {
    rejectedReplayKey = key;
    throw new Error("DEVICE_STATE_INVALID");
  }));
  assert.equal(rejectedReplayKey, uncertainKey);

  let finalReplayKey = "";
  await e5StableDeviceCommand(slot, fingerprint, async (key) => {
    finalReplayKey = key;
    return "converged";
  });
  assert.equal(finalReplayKey, uncertainKey);
});
