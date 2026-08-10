import assert from "node:assert/strict";
import test from "node:test";

import { createL1ReadController } from "../app/components/domain-views/l-tabs/l1-request-generation.ts";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("L1 restore late response cannot commit after manual refresh commits", async () => {
  const controller = createL1ReadController();
  const restore = deferred();
  const manual = deferred();
  const visible = [];
  controller.run(() => restore.promise, (value) => visible.push(value));
  controller.run(() => manual.promise, (value) => visible.push(value));

  manual.resolve("manual");
  await flush();
  restore.resolve("restore");
  await flush();

  assert.deepEqual(visible, ["manual"]);
});

test("L1 parent change prevents an already-started read from committing", async () => {
  const controller = createL1ReadController();
  const parentStale = deferred();
  const visible = [];
  controller.run(() => parentStale.promise, (value) => visible.push(value));
  controller.invalidate();
  parentStale.resolve("stale-parent");
  await flush();
  assert.deepEqual(visible, []);
});

test("L1 unmount invalidation prevents its late response from committing", async () => {
  const controller = createL1ReadController();
  const unmounted = deferred();
  const visible = [];
  controller.run(() => unmounted.promise, (value) => visible.push(value));
  controller.invalidate();
  unmounted.resolve("late-after-unmount");
  await flush();
  assert.deepEqual(visible, []);
});
