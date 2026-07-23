import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canExportBiReports,
  readL1LiveTotals,
  readL2LiveStages,
} from "../app/components/domain-views/l-tabs/l1-l2-live-data.ts";

test("L1 maps the real backend totals without inventing unavailable KPI series", () => {
  const result = readL1LiveTotals({
    module: "L1",
    totals: {
      users: 1,
      orders: 2,
      withdrawals: 0,
      exchanges: 0,
      stakingPositions: 0,
      walletLedgerRows: 1,
      supportTickets: 0,
      auditLogs: 2367,
    },
  });

  assert.equal(result.length, 8);
  assert.deepEqual(
    result.map(({ key, value }) => [key, value]),
    [
      ["users", 1],
      ["orders", 2],
      ["withdrawals", 0],
      ["exchanges", 0],
      ["stakingPositions", 0],
      ["walletLedgerRows", 1],
      ["supportTickets", 0],
      ["auditLogs", 2367],
    ],
  );
  assert.ok(result.every((row) => row.source.startsWith("nx_")));
  assert.ok(result.every((row) => row.sourceLabel.length > 0 && !row.sourceLabel.includes("nx_")));
});

test("L1 does not turn a missing total into a synthetic zero", () => {
  const result = readL1LiveTotals({ totals: { users: 3 } });

  assert.deepEqual(result.map(({ key, value }) => [key, value]), [["users", 3]]);
  assert.deepEqual(readL1LiveTotals({ module: "L1" }), []);
});

test("L2 preserves independent lifecycle facts, including real zero counts", () => {
  const result = readL2LiveStages({
    module: "L2",
    stages: [
      { key: "registered", count: 1, source: "nx_user" },
      { key: "profileCompleted", count: 1, source: "nx_user_profile" },
      { key: "kycSubmitted", count: 0, source: "nx_kyc_profile" },
      { key: "kycApproved", count: 0, source: "nx_kyc_profile" },
      { key: "ordered", count: 2, source: "nx_order/nx_admin_device_order" },
      { key: "walletActivity", count: 1, source: "nx_wallet_ledger/nx_wallet_bill" },
    ],
  });

  assert.equal(result.length, 6);
  assert.equal(result.find((row) => row.key === "kycSubmitted")?.count, 0);
  assert.equal(result.find((row) => row.key === "ordered")?.count, 2);
  assert.ok(result.every((row) => row.label.length > 0 && row.source.length > 0));
  assert.ok(result.every((row) => row.sourceLabel.length > 0 && !row.sourceLabel.includes("nx_")));
});

test("L2 rejects incomplete rows rather than fabricating a funnel stage", () => {
  const result = readL2LiveStages({
    stages: [
      { key: "registered", count: "4", source: "nx_user" },
      { key: "missingCount", source: "nx_unknown" },
      null,
    ],
  });

  assert.deepEqual(result.map(({ key, count }) => [key, count]), [["registered", 4]]);
});

test("L1-L5 aggregate export requires the matching source-domain write authority", () => {
  assert.equal(canExportBiReports("auditor", ["bi_l1_read", "bi_l2_read"], "L1"), false);
  assert.equal(canExportBiReports("operator", ["bi_l1_read", "bi_l5_write"], "L1"), false);
  assert.equal(canExportBiReports("operator", ["bi_l1_read", "bi_l1_write"], "L1"), true);
  assert.equal(canExportBiReports("operator", ["bi_l3_write"], "L3"), true);
  assert.equal(canExportBiReports("risk", ["bi_l5_read"], "L5"), false);
  assert.equal(canExportBiReports("finance", ["bi_l3_write", "bi_l5_read"], "L5"), true);
  assert.equal(canExportBiReports("operator", ["bi_l5_write"], "L5"), false);
  assert.equal(canExportBiReports("superadmin", [], "L3"), true);
});

test("L5 downstream context uses the authoritative report total and business-facing wording", async () => {
  const source = await readFile(
    new URL("../app/components/domain-views/l-tabs/l5-export.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const summaryRaw = rec\(data\.summary\)[\s\S]*total: num\(summaryRaw\.totalReports/);
  assert.doesNotMatch(
    source,
    />[^<]*(?:admin\.|L\.report\.|masking_policy|pending_confirm|pending_split_confirm|generating|ready\(|expired|failed\(|\bPII\b)[^<]*</,
  );
});

test("L1/L2 and their export handoff do not expose PRD section numbers in hover text", async () => {
  const paths = [
    "../app/components/domain-views/l-tabs/l1-kpi.tsx",
    "../app/components/domain-views/l-tabs/l2-funnel.tsx",
    "../app/components/domain-views/l-tabs/l5-export.tsx",
  ];
  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /title="[^"]*§/);
  }
});
