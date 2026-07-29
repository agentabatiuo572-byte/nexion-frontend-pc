import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertG1OverviewContract,
  assertG2OverviewContract,
  assertG4OverviewContract,
  assertG7OrderPageContract,
  assertG7OverviewContract,
} from "../lib/admin/g-overview-contract.ts";
import {
  createStableMutationExecutor,
  stableMutationHttpFailure,
} from "../lib/admin/stable-mutation.ts";

const coverage = {
  coverageRatio: 120,
  redlinePct: 100,
  redlineBreached: false,
  precheck: "B1",
};

const canonicalTail = {
  serverCanonical: true,
  sources: ["authoritative-table"],
};

const g1 = {
  domain: "G1",
  product: "staking",
  currentNexPrice: 1,
  stats: {
    lockedTotalUsd: 0,
    usdtPoolUsd: 0,
    nexPoolUsd: 0,
    interestUsd: 0,
    positionCount: 0,
    activeCount: 0,
    matureCount: 0,
    pendingCount: 0,
    earlyWithdrawnMonth: 0,
    killedCount: 0,
    stakingGateOn: true,
  },
  gate: { enabled: true, configKey: "J.killswitch.staking", linkedDomain: "J1" },
  coverage,
  pools: [],
  positions: [],
  stateMachine: ["pending_lock", "active", "mature_unclaimed", "claimed", "early_withdrawn", "slashed", "refunded"],
  ...canonicalTail,
};

const g2 = {
  domain: "G2",
  asset: "NEX",
  currency: "USDT",
  currentPrice: 1,
  stats: {
    todayUsd: 0,
    poolPct: 0,
    queueDepth: 0,
    gateKyc: 0,
    gateUser: 0,
    gatePlatform: 0,
    gateGeo: 0,
  },
  caps: [
    ["userDailyCap", 50],
    ["platformDailyCap", 20_000],
    ["fee", 0],
    ["feeMin", 0.5],
    ["kycThreshold", 100],
    ["queueMode", "QUEUE"],
  ].map(([key, value]) => ({
    key,
    name: String(key),
    sub: "canonical",
    value,
    displayValue: String(value),
    note: "canonical",
    loosen: false,
  })),
  queue: [],
  gateDetails: {
    kyc: { key: "kyc", title: "KYC", note: "-", count: 0, rows: [] },
    user: { key: "user", title: "User", note: "-", count: 0, rows: [] },
    platform: { key: "platform", title: "Platform", note: "-", count: 0, rows: [] },
    geo: { key: "geo", title: "Geo", note: "-", count: 0, rows: [] },
  },
  swap: { enabled: true, status: "enabled", configKey: "killswitch.exchange", linkedDomain: "J1" },
  geoBlocked: [],
  coverage,
  ...canonicalTail,
};

const g4 = {
  domain: "G4",
  product: "genesis",
  asset: "GENESIS_NODE",
  currentNexPrice: 1,
  stats: {
    totalSlots: 0,
    sold: 0,
    unitPrice: 1000,
    unsold: 0,
    soldPct: 0,
    genesisAccrualUsd: 0,
    marketOn: true,
    todayBatch: "",
    secondary: { floor: 0, vol24h: 0, listed: 0, owners: 0, royaltyPct: 0 },
  },
  params: [],
  dividend: {
    dailyVolumeBase: 0,
    dividendPct: 0,
    poolToday: 0,
    perSlotPerDay: 0,
    floorPerNodePerDay: 0,
    payoutToday: 0,
    batchNo: "",
    batchStatus: "ready",
  },
  emissionGate: { configKey: "growth.phase.genesis_emissions_open", open: true, owner: "H1" },
  market: { enabled: true, configKey: "J.killswitch.genesis", linkedDomain: "J1" },
  geoBlocked: [],
  nodes: [],
  nodePage: { page: 1, pageSize: 10, total: 0, totalPages: 1, hasPrev: false, hasNext: false },
  stateMachine: ["minted", "held", "listed", "sold"],
  coverage,
  ...canonicalTail,
};

const g7 = {
  domain: "G7",
  product: "repurchase",
  asset: "USDT",
  currentNexPrice: 1,
  stats: {
    ordersMonth: 0,
    principalUsd: 0,
    matureUsd: 0,
    ticketsMonth: 0,
    reinvestRate: 0,
    reinvestRateAvailable: true,
    lockDays: 90,
  },
  params: [],
  phaseGate: { key: "phase", label: "Phase", value: "OPEN", linkedDomain: "H1", readonly: true },
  stateMachine: ["pending_lock", "active", "mature_unclaimed", "claimed", "early_withdrawn"],
  statusBreakdown: [],
  amountDistribution: "-",
  coverage,
  g4Capacity: { monthlyCapacity: 0, ticketsIssuedThisMonth: 0, source: "G4" },
  ...canonicalTail,
};

test("G1/G2/G4/G7 canonical overview contracts accept complete authoritative empty states", () => {
  assert.equal(assertG1OverviewContract(g1), g1);
  assert.equal(assertG2OverviewContract(g2), g2);
  assert.equal(assertG4OverviewContract(g4), g4);
  assert.equal(assertG7OverviewContract(g7), g7);
});

test("all four overview contracts reject a successful envelope with empty data", () => {
  assert.throws(() => assertG1OverviewContract({}), /G1_RESPONSE_INVALID/);
  assert.throws(() => assertG2OverviewContract({}), /G2_RESPONSE_INVALID/);
  assert.throws(() => assertG4OverviewContract({}), /G4_RESPONSE_INVALID/);
  assert.throws(() => assertG7OverviewContract({}), /G7_RESPONSE_INVALID/);
});

test("canonical marker and nested authority fields cannot be defaulted", () => {
  assert.throws(() => assertG1OverviewContract({ ...g1, serverCanonical: false }), /G1_RESPONSE_INVALID/);
  assert.throws(() => assertG2OverviewContract({ ...g2, stats: { ...g2.stats, queueDepth: undefined } }), /G2_RESPONSE_INVALID/);
  assert.throws(() => assertG4OverviewContract({ ...g4, nodePage: { ...g4.nodePage, total: undefined } }), /G4_RESPONSE_INVALID/);
  assert.throws(() => assertG7OverviewContract({ ...g7, g4Capacity: null }), /G7_RESPONSE_INVALID/);
});

test("G7 order page rejects malformed success instead of turning it into an empty list", () => {
  const valid = { orders: [], nextCursor: null, hasMore: false, serverCanonical: true };
  assert.equal(assertG7OrderPageContract(valid), valid);
  assert.throws(() => assertG7OrderPageContract({}), /G7_ORDERS_RESPONSE_INVALID/);
  assert.throws(() => assertG7OrderPageContract({ ...valid, serverCanonical: false }), /G7_ORDERS_RESPONSE_INVALID/);
});

test("outcome-unknown retains the command key for the same payload", async () => {
  let sequence = 0;
  const execute = createStableMutationExecutor((prefix) => `${prefix}-${++sequence}`);
  const observed = [];
  const run = (value) => execute(
    "g-module-write",
    JSON.stringify({ value: "same", reason: "same" }),
    async (commandKey) => {
      observed.push(commandKey);
      return value;
    },
    (payload) => {
      if (payload?.serverCanonical !== true) throw new Error("G_RESPONSE_INVALID");
      return payload;
    },
  );

  await assert.rejects(run({}), /G_RESPONSE_INVALID/);
  await run({ serverCanonical: true });
  assert.deepEqual(observed, ["g-module-write-1", "g-module-write-1"]);
});

test("deterministic rejection releases the command key", async () => {
  let sequence = 0;
  const execute = createStableMutationExecutor((prefix) => `${prefix}-${++sequence}`);
  const observed = [];
  const run = (fail) => execute(
    "g-module-write",
    "same-payload",
    async (commandKey) => {
      observed.push(commandKey);
      if (fail) throw stableMutationHttpFailure("conflict", 409, 409);
      return { serverCanonical: true };
    },
    (payload) => payload,
  );

  await assert.rejects(run(true), /conflict/);
  await run(false);
  assert.deepEqual(observed, ["g-module-write-1", "g-module-write-2"]);
});

test("changed payload gets a new key while the unknown original intent keeps its key", async () => {
  let sequence = 0;
  const execute = createStableMutationExecutor((prefix) => `${prefix}-${++sequence}`);
  const observed = [];
  const run = (fingerprint, fail) => execute(
    "g-module-write",
    fingerprint,
    async (commandKey) => {
      observed.push([fingerprint, commandKey]);
      if (fail) throw new TypeError("network disconnected");
      return { serverCanonical: true };
    },
    (payload) => payload,
  );

  await assert.rejects(run("payload-a", true), /network disconnected/);
  await run("payload-b", false);
  await run("payload-a", false);
  assert.deepEqual(observed, [
    ["payload-a", "g-module-write-1"],
    ["payload-b", "g-module-write-2"],
    ["payload-a", "g-module-write-1"],
  ]);
});

test("accepted success releases the command key", async () => {
  let sequence = 0;
  const execute = createStableMutationExecutor((prefix) => `${prefix}-${++sequence}`);
  const observed = [];
  const run = () => execute(
    "g-module-write",
    "same-payload",
    async (commandKey) => {
      observed.push(commandKey);
      return { serverCanonical: true };
    },
    (payload) => payload,
  );

  await run();
  await run();
  assert.deepEqual(observed, ["g-module-write-1", "g-module-write-2"]);
});

test("HTTP classification is explicit and does not infer from message text", () => {
  assert.equal(stableMutationHttpFailure("anything", 422, 422).kind, "deterministic");
  assert.equal(stableMutationHttpFailure("anything", 200, 1001).kind, "deterministic");
  assert.equal(stableMutationHttpFailure("anything", 500, 500).kind, "outcome-unknown");
  assert.equal(stableMutationHttpFailure("anything", 200).kind, "outcome-unknown");
});

test("G1/G2/G3/G4/G7 clients complete command keys only through the shared acceptance ratchet", () => {
  for (const module of ["g1", "g2", "g3", "g4", "g7"]) {
    const source = readFileSync(new URL(`../lib/admin/${module}-client.ts`, import.meta.url), "utf8");
    assert.match(source, /createStableMutationExecutor/);
    assert.match(source, new RegExp(`execute${module.toUpperCase()}Mutation`));
    assert.doesNotMatch(source, /idempotencyPrefix/);
  }
  const g4 = readFileSync(new URL("../lib/admin/g4-client.ts", import.meta.url), "utf8");
  assert.match(g4, /g4AckMutation/);
  assert.match(g4, /G4_COMMAND_RESPONSE_INVALID/);
});
