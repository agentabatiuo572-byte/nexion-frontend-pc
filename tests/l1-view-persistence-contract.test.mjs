import assert from "node:assert/strict";
import test from "node:test";

import { L1_LOCAL_VIEW_MAX_BYTES, L1_LOCAL_VIEW_STORAGE_KEY, loadL1LocalView, saveL1LocalView } from "../app/components/domain-views/l-tabs/l1-local-view.ts";

function storage() {
  let raw = null;
  return {
    getItem: (key) => key === L1_LOCAL_VIEW_STORAGE_KEY ? raw : null,
    setItem: (key, value) => { if (key === L1_LOCAL_VIEW_STORAGE_KEY) raw = value; },
    removeItem: (key) => { if (key === L1_LOCAL_VIEW_STORAGE_KEY) raw = null; },
    setRaw: (value) => { raw = value; },
  };
}

test("L1 saved view persists only the local presentation whitelist and survives a reload", () => {
  const local = storage();
  const saved = saveL1LocalView(local, {
    window: "custom", customFrom: "2026-08-01", customTo: "2026-08-09", gran: "month", phaseOn: false,
    ylOffset: 15, ovlSel: [1, 4, 7], cohortFilter: "C-2026", phaseFilter: "P2", localeFilter: "zh-CN", refFilter: "campaign-7",
    mustNeverPersist: "report data or authority",
  });

  assert.deepEqual(saved, {
    window: "custom", customFrom: "2026-08-01", customTo: "2026-08-09", gran: "month", phaseOn: false,
    ylOffset: 15, ovlSel: [1, 4, 7], cohortFilter: "C-2026", phaseFilter: "P2", localeFilter: "zh-CN", refFilter: "campaign-7",
  });
  assert.deepEqual(loadL1LocalView(local), saved);
});

test("L1 rejects and clears an oversized localStorage payload before parsing", () => {
  const local = storage();
  local.setRaw("{".padEnd(L1_LOCAL_VIEW_MAX_BYTES + 1, "x"));
  assert.equal(loadL1LocalView(local), null);
  assert.equal(local.getItem(L1_LOCAL_VIEW_STORAGE_KEY), null);

});

test("L1 measures the storage budget in UTF-8 bytes before parsing multibyte text", () => {
  const local = storage();
  const raw = JSON.stringify({
    window: "7d", customFrom: "", customTo: "", gran: "week", phaseOn: true, ylOffset: 10,
    ovlSel: [1], cohortFilter: "", phaseFilter: "", localeFilter: "", refFilter: "", junk: "汉".repeat(1000),
  });
  assert.ok(raw.length < L1_LOCAL_VIEW_MAX_BYTES);
  assert.ok(new TextEncoder().encode(raw).byteLength > L1_LOCAL_VIEW_MAX_BYTES);
  local.setRaw(raw);
  assert.equal(loadL1LocalView(local), null);
  assert.equal(local.getItem(L1_LOCAL_VIEW_STORAGE_KEY), null);
});

test("L1 ignores corrupt or out-of-whitelist local views", () => {
  const local = storage();
  local.setRaw(JSON.stringify({ window: "forever", ylOffset: 999, phaseOn: "yes", ovlSel: [] }));
  assert.equal(loadL1LocalView(local), null);
  local.setRaw(JSON.stringify({ window: "custom", customFrom: "2026-08-10", customTo: "2026-08-09", gran: "week", phaseOn: true, ylOffset: 10, ovlSel: [1] }));
  assert.equal(loadL1LocalView(local), null);
});

test("L1 rejects null fields and non-numeric yellow-line offsets", () => {
  const local = storage();
  local.setRaw(JSON.stringify({
    window: "7d", customFrom: "", customTo: "", gran: "week", phaseOn: true,
    ylOffset: null, ovlSel: [1], cohortFilter: null, phaseFilter: "", localeFilter: "", refFilter: "",
  }));
  assert.equal(loadL1LocalView(local), null);

  local.setRaw(JSON.stringify({
    window: "7d", customFrom: "", customTo: "", gran: "week", phaseOn: true,
    ylOffset: "10", ovlSel: [1], cohortFilter: "", phaseFilter: "", localeFilter: "", refFilter: "",
  }));
  assert.equal(loadL1LocalView(local), null);
});

test("L1 refuses oversized individual view fields even when the payload is otherwise small", () => {
  const local = storage();
  local.setRaw(JSON.stringify({
    window: "7d", customFrom: "x".repeat(11), customTo: "", gran: "week", phaseOn: true,
    ylOffset: 10, ovlSel: [1], cohortFilter: "", phaseFilter: "", localeFilter: "", refFilter: "",
  }));
  assert.equal(loadL1LocalView(local), null);
});
