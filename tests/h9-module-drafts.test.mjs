import assert from "node:assert/strict";
import test from "node:test";
import { reconcileH9Editor } from "../lib/admin/h9-module-drafts.ts";
import { parseGlobeDisplay } from "../lib/admin/globe-display-config.ts";
const keys = ["homeOnlineCurrent", "registeredUsersBase", "fleetDevices"];
const original = { homeOnlineCurrent: 100, registeredUsersBase: 200, fleetDevices: 300,
  hashratePercentileTable: [{ tops: 1, cumPct: 20 }, { tops: 2, cumPct: 100 }] };
test("saving one module preserves other drafts while pristine fields follow latest server", () => {
  const editor = reconcileH9Editor(null, original, keys);
  editor.drafts.registeredUsersBase = "222";
  editor.drafts.homeOnlineCurrent = "110";
  const saved = { ...original, homeOnlineCurrent: 110, fleetDevices: 999 };
  const next = reconcileH9Editor(editor, saved, keys, ["homeOnlineCurrent"]);
  assert.equal(next.drafts.homeOnlineCurrent, "110");
  assert.equal(next.drafts.registeredUsersBase, "222");
  assert.equal(next.baseline.registeredUsersBase, 200);
  assert.equal(next.drafts.fleetDevices, "999");
});
test("remote changes preserve edited values and old baseline so save can detect conflict", () => {
  const editor = reconcileH9Editor(null, original, keys);
  editor.drafts.registeredUsersBase = "222";
  editor.bands[0].cumPct = "40";
  const remote = { ...original, registeredUsersBase: 250, hashratePercentileTable: [{ tops: 1, cumPct: 50 }, { tops: 2, cumPct: 100 }] };
  const next = reconcileH9Editor(editor, remote, keys);
  assert.equal(next.drafts.registeredUsersBase, "222");
  assert.notEqual(next.baseline.registeredUsersBase, remote.registeredUsersBase);
  assert.equal(next.bands[0].cumPct, "40");
  assert.equal(next.baseline.hashratePercentileTable[0].cumPct, 20);
  const refreshed = reconcileH9Editor(next, remote, keys, ["registeredUsersBase"], true);
  assert.equal(refreshed.drafts.registeredUsersBase, "250");
  assert.equal(refreshed.bands[0].cumPct, "50");
});
test("global network parser enforces exact center set, precision and bounded values", () => {
  const config = { intervalMs: 1001, nodeJitterPct: .000001, activeJobsMinPct: 0, activeJobsMaxPct: 100,
    throughputMin: 0, throughputMax: 10000, latencyJitterMs: 60000,
    centers: ["sg","jp","vn","uk","fr","de","us-ny","us-sj"].map(id => ({id,nodes:0,latencyMs:0})) };
  assert.deepEqual(parseGlobeDisplay(config),config);
  assert.equal(parseGlobeDisplay({...config,nodeJitterPct:.0000001}),undefined);
  assert.equal(parseGlobeDisplay({...config,intervalMs:1000.1}),undefined);
  assert.equal(parseGlobeDisplay({...config,centers:config.centers.slice(1)}),undefined);
});
