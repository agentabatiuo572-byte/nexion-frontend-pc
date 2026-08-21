import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  auditRepositoryReverseCoverage,
  collectActiveNavLeaves,
  collectClientWriteSymbols,
  validateRuntimeConsumerContracts,
  validateRuntimeEvidence,
  validateServiceDelegations,
} from "../scripts/lib/ops-actions-reverse-coverage.mjs";

const ROOT = process.cwd();
const BACKEND_ROOT = process.env.NEXION_BACKEND_ROOT?.trim() || join(ROOT, "..", "nexion-backend");
const UNIAPP_ROOT = process.env.NEXION_APP_ROOT?.trim() || join(ROOT, "..", "NX1.0-UniApp");
const JANUS_ROOT = process.env.NEXION_JANUS_ROOT?.trim() || join(ROOT, "..", "NX1.0-Janus");
const read = (relative) => readFileSync(join(ROOT, relative), "utf8");
const readBackend = (relative) => readFileSync(join(BACKEND_ROOT, relative), "utf8");
const manifest = JSON.parse(read("docs/ops-actions.manifest.json"));
const row = (id) => manifest.rows.find((item) => item.id === id);

const SEMANTIC_PENDING_IDS = [
  "OPS-K-17",
];

const FINAL_ACCEPTED_IDS = [
  "OPS-A-15", "OPS-A-20", "OPS-L-10", "OPS-E-16", "OPS-F-15", "OPS-F-19", "OPS-E-20",
  "OPS-A-28", "OPS-A-29", "OPS-A-30", "OPS-A-31", "OPS-H-19", "OPS-H-20", "OPS-H-21",
  "OPS-M-26", "OPS-M-27", "OPS-M-28", "OPS-D-26", "OPS-D-27", "OPS-D-28",
];

function readSourceTree(root, excludedSuffix = "") {
  const chunks = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) {
      chunks.push(readSourceTree(absolute, excludedSuffix));
    } else if (/\.(?:ts|tsx|vue)$/.test(entry.name)
      && (!excludedSuffix || !absolute.replaceAll("\\", "/").endsWith(excludedSuffix))) {
      chunks.push(readFileSync(absolute, "utf8"));
    }
  }
  return chunks.join("\n");
}

test("semantic debts stay pending until producer, runtime consumer and behavior evidence all exist", () => {
  assert.equal(SEMANTIC_PENDING_IDS.length, 1);
  for (const id of SEMANTIC_PENDING_IDS) {
    assert.equal(row(id)?.status, "pending", `${id} must remain pending until its runtime consumer contract is proven`);
    assert.ok(row(id)?.runtimeConsumerContract, `${id} must describe its pending runtime consumer contract`);
  }
  assert.deepEqual(
    {
      status: row("OPS-M-25")?.status,
      restAction: row("OPS-M-25")?.restAction,
      restActions: row("OPS-M-25")?.restActions,
      runtimeConsumerContract: row("OPS-M-25")?.runtimeConsumerContract,
    },
    { status: "readonly", restAction: undefined, restActions: undefined, runtimeConsumerContract: undefined },
    "M25 is scheduler-only observation after the product security decision removed the manual fallback POST",
  );
  assert.match(row("OPS-M-25")?.action ?? "", /scheduler.*30\s*分钟.*状态\/CAS/i);
  assert.match(row("OPS-M-25")?.reason ?? "", /移除[\s\S]*人工 fallback 入口/);
  assert.deepEqual(
    row("OPS-A-15")?.restActions,
    ["updateA2MechanismParam", "runA2RetentionNow"],
    "A2 retention is a real pending write and must be claimed exactly once by OPS-A-15",
  );
  assert.deepEqual(
    row("OPS-A-20")?.restActions,
    ["updateA4DimensionParam", "runA4RetentionNow"],
    "A4 retention is a real pending write and must be claimed exactly once by OPS-A-20",
  );
  assert.deepEqual(validateRuntimeConsumerContracts(manifest, () => undefined), []);

  const falseGreen = structuredClone(manifest);
  const debt = falseGreen.rows.find((item) => item.id === "OPS-K-17");
  debt.status = "built";
  debt.runtimeEvidence = [{
    type: "backend-runtime",
    file: "symbol-only.java",
    positivePatterns: ["reasonMin"],
    negativePatterns: ["TODO"],
  }];
  assert.match(
    validateRuntimeConsumerContracts(falseGreen, () => "reasonMin").join("\n"),
    /OPS-K-17: built runtime consumer contract requires evidence/,
  );

  debt.runtimeConsumerEvidence = [{
    profile: "production",
    producer: { type: "backend-runtime", file: "same.java", positivePatterns: [debt.runtimeConsumerContract.successOutcome] },
    consumer: { type: "backend-runtime", file: "same.java", positivePatterns: [debt.runtimeConsumerContract.successOutcome] },
    behaviorTest: {
      type: "backend-runtime",
      file: "same.java",
      positivePatterns: [debt.runtimeConsumerContract.successOutcome, debt.runtimeConsumerContract.failureOutcome],
    },
  }];
  assert.match(
    validateRuntimeConsumerContracts(falseGreen, () => [
      debt.runtimeConsumerContract.successOutcome,
      debt.runtimeConsumerContract.failureOutcome,
    ].join("\n")).join("\n"),
    /behaviorTest must use a test evidence type|producer, consumer and behaviorTest must resolve to distinct physical files/,
    "one source file with copied outcome strings must not forge runtime-consumer evidence",
  );

  debt.runtimeConsumerEvidence = [{
    profile: "production",
    producer: { type: "pc-runtime", file: "producer.ts", positivePatterns: [debt.runtimeConsumerContract.successOutcome] },
    consumer: { type: "backend-runtime", file: "consumer.java", positivePatterns: [debt.runtimeConsumerContract.failureOutcome] },
    behaviorTest: {
      type: "test-runtime",
      file: "tests/forged.test.mjs",
      positivePatterns: [debt.runtimeConsumerContract.successOutcome, debt.runtimeConsumerContract.failureOutcome],
    },
  }];
  const copiedText = [
    `// ${debt.runtimeConsumerContract.successOutcome}`,
    `// ${debt.runtimeConsumerContract.failureOutcome}`,
    "assert.ok(true);",
  ].join("\n");
  assert.match(
    validateRuntimeConsumerContracts(
      falseGreen,
      () => copiedText,
      (type, file) => `D:/evidence/${type}/${file}`,
    ).join("\n"),
    /successOutcome must occur inside an assertion expression|failureOutcome must occur inside an assertion expression/,
    "three distinct files with copied outcome comments and an unrelated assertion must not pass",
  );

  debt.runtimeConsumerEvidence[0].producer.type = "invented-runtime";
  assert.match(
    validateRuntimeConsumerContracts(falseGreen, () => copiedText).join("\n"),
    /producer type invented-runtime is not an allowed runtime type/,
  );
});

test("final accepted semantic closures are built while K17 production native-device handoff stays HOLD", () => {
  for (const id of FINAL_ACCEPTED_IDS) {
    assert.equal(row(id)?.status, "built", `${id} passed final acceptance and must be built`);
    assert.equal(row(id)?.batch, "done", `${id} must leave the pending batch`);
    assert.ok(row(id)?.runtimeEvidence?.length > 0, `${id} must retain precise runtime evidence`);
    assert.equal(row(id)?.runtimeConsumerContract, undefined, `${id} must replace the pending contract with verified evidence`);
  }

  const k17 = row("OPS-K-17");
  assert.equal(k17?.status, "pending");
  assert.equal(k17?.batch, "P1");
  assert.ok(k17?.runtimeEvidence?.some((item) => item.type === "janus-runtime"));
  assert.match(`${k17?.action ?? ""} ${k17?.note ?? ""}`, /源码[\s\S]*UTS[\s\S]*Sandbox[\s\S]*fail-closed[\s\S]*Production[\s\S]*(?:真机|原生)[\s\S]*HOLD/i);
});

test("unknown OPS_BATCH values fail closed", () => {
  const result = spawnSync(process.execPath, ["scripts/ops-actions-audit.mjs"], {
    cwd: ROOT,
    env: { ...process.env, OPS_BATCH: "INVALID" },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /未知 OPS_BATCH.*INVALID/);
});

test("runtime consumer evidence rechecks containment after resolving symlinks and junctions", () => {
  const audit = read("scripts/ops-actions-audit.mjs");
  assert.match(audit, /const physicalRoot = fs\.realpathSync\.native\(root\)/);
  assert.match(audit, /const physicalRelative = path\.relative\(physicalRoot, physicalFile\)/);
  assert.match(audit, /physicalRelative\.startsWith\(`\.\.\$\{path\.sep\}`\)/);
});

test("H1 month dial mutation is discovered and has exactly one leaf-scoped claim", () => {
  const symbols = collectClientWriteSymbols(read("lib/admin/h-client.ts"), "lib/admin/h-client.ts");
  assert.ok(symbols.has("updateH1MonthDial"), "transitive PATCH wrapper must be discovered as a client write");
  const claims = manifest.rows.filter((item) => [item.restAction, ...(item.restActions ?? [])].includes("updateH1MonthDial"));
  assert.deepEqual(claims.map((item) => item.id), ["OPS-H-01"]);
});

test("G17/G18 keep sandbox writes uniquely claimed while production mutex evidence stays profile-scoped", () => {
  for (const [action, expectedRow] of [
    ["processG2AcceptanceSandboxBatch", "OPS-G-17"],
    ["cleanupG2AcceptanceSandboxBatch", "OPS-G-18"],
  ]) {
    const claims = manifest.rows.filter((item) => [item.restAction, ...(item.restActions ?? [])].includes(action));
    assert.deepEqual(claims.map((item) => item.id), [expectedRow], `${action} must have one exact ${expectedRow} claim`);
  }

  const g17 = row("OPS-G-17");
  const g18 = row("OPS-G-18");
  assert.equal(g17?.status, "built");
  assert.equal(g18?.status, "built");
  assert.equal(g17?.restAction, "processG2AcceptanceSandboxBatch");
  assert.equal(g18?.restAction, "cleanupG2AcceptanceSandboxBatch");
  assert.match(`${g17?.action ?? ""} ${g17?.note ?? ""}`, /Acceptance Sandbox[\s\S]*Production|Production[\s\S]*Acceptance Sandbox/i);
  assert.match(`${g18?.action ?? ""} ${g18?.note ?? ""}`, /Production[\s\S]*MySQL[\s\S]*Acceptance Sandbox/i);

  const g17Files = g17?.runtimeEvidence?.map((item) => item.file) ?? [];
  assert.ok(g17Files.includes("app/components/domain-views/g-tabs/g2-exchange.tsx"));
  assert.ok(g17Files.includes("src/main/java/ffdd/opsconsole/market/application/G2AcceptanceSandboxRepository.java"));
  const g18Files = g18?.runtimeEvidence?.map((item) => item.file) ?? [];
  assert.ok(g18Files.includes("src/main/java/ffdd/opsconsole/market/mapper/AppExchangeMapper.java"));
  assert.ok(g18Files.includes("src/main/java/ffdd/opsconsole/market/application/AppExchangeService.java"));
  assert.ok(g18Files.includes("src/main/java/ffdd/opsconsole/market/application/G2ExchangeQueueBatchService.java"));
  assert.ok(g18Files.includes("src/main/java/ffdd/opsconsole/market/application/G2AcceptanceSandboxRepository.java"));
});

test("remaining-development ledger has unique claims and preserves semantic consumer debts", () => {
  const expectedBuiltClosures = [
    "OPS-A-07a",
    "OPS-A-07b",
    "OPS-A-09",
    "OPS-A-12",
    "OPS-A-27", "OPS-A-32",
    "OPS-B-13",
    "OPS-B-14",
    "OPS-C-21",
    "OPS-C-02a",
    "OPS-C-23",
    "OPS-C-34",
    "OPS-D-15",
    "OPS-D-19",
    "OPS-D-21",
    "OPS-D-22",
    "OPS-E-18",
    "OPS-E-19",
    "OPS-F-04",
    "OPS-F-07",
    "OPS-F-07a",
    "OPS-F-08",
    "OPS-F-09",
    "OPS-F-11",
    "OPS-F-12",
    "OPS-F-13",
    "OPS-F-14",
    "OPS-F-16",
    "OPS-F-17",
    "OPS-F-18",
    "OPS-F-26",
    "OPS-G-14",
    "OPS-G-17",
    "OPS-G-18",
    ...FINAL_ACCEPTED_IDS,
    "OPS-H-12",
    "OPS-I-14",
    "OPS-I-15",
    "OPS-I-16",
    "OPS-K-16",
    "OPS-L-08",
    "OPS-L-09",
    "OPS-M-17",
    "OPS-M-19",
    "OPS-M-20",
    "OPS-M-21",
    "OPS-M-22",
    "OPS-M-23",
    "OPS-M-24",
  ];
  const ids = manifest.rows.map((item) => item.id);
  const counts = Object.groupBy(manifest.rows, (item) => item.status);

  assert.equal(new Set(ids).size, ids.length, "action IDs must be unique");
  assert.equal(manifest.rows.length, 256);
  assert.deepEqual(
    { built: counts.built?.length, readonly: counts.readonly?.length, pending: counts.pending?.length ?? 0, missing: counts.missing?.length ?? 0 },
    { built: 232, readonly: 23, pending: 1, missing: 0 },
  );
  for (const id of expectedBuiltClosures) assert.equal(row(id)?.status, "built", id + " must stay built");

  const activeDomains = [...read("lib/nav/console-nav.ts").matchAll(/\bcode:\s*"([A-M])"/g)].map((match) => match[1]);
  const ledgerDomains = [...new Set(manifest.rows.map((item) => item.domain))];
  assert.deepEqual(ledgerDomains.toSorted(), activeDomains.toSorted(), "every active navigation domain must be represented in the action ledger");

  const activeLeaves = collectActiveNavLeaves(read("lib/nav/console-nav.ts")).map((leaf) => leaf.id);
  assert.equal(activeLeaves.length, 76, "navigation baseline changed; re-audit every active leaf");
  assert.deepEqual(Object.keys(manifest.activeLeafCoverage).toSorted(), activeLeaves.toSorted(), "every active flagship leaf needs an explicit capability claim");
  for (const [leaf, claims] of Object.entries(manifest.activeLeafCoverage)) {
    assert.ok(claims.length > 0, `${leaf} must reference at least one ledger row`);
    for (const claim of claims) assert.ok(row(claim), `${leaf} references missing ledger row ${claim}`);
  }

  const reverse = auditRepositoryReverseCoverage({ root: ROOT, manifest });
  assert.deepEqual(reverse.problems, [], reverse.problems.join("\n"));
  assert.deepEqual(
    validateServiceDelegations(manifest, (relative) => {
      const absolute = join(BACKEND_ROOT, relative);
      return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
    }),
    [],
  );
  assert.deepEqual(
    validateRuntimeEvidence(manifest, (type, relative) => {
      const base = type.startsWith("backend-") ? BACKEND_ROOT
        : type.startsWith("uniapp-") ? UNIAPP_ROOT
          : type.startsWith("janus-") ? JANUS_ROOT : ROOT;
      const absolute = join(base, relative);
      return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
    }),
    [],
  );
});

test("ledger scopes match implemented PC actions instead of compound or aspirational labels", () => {
  assert.deepEqual(
    { status: row("OPS-D-18")?.status, restAction: row("OPS-D-18")?.restAction },
    { status: "built", restAction: "updatePayoutVndConfig" },
  );
  assert.deepEqual(
    { status: row("OPS-C-22")?.status, restAction: row("OPS-C-22")?.restAction },
    { status: "built", restAction: "exportUserProfilesCsv" },
  );
  assert.equal(row("OPS-F-04")?.status, "built");
  assert.equal(row("OPS-F-07")?.action, "调额度");
  assert.equal(row("OPS-F-07a")?.status, "built");
  for (const duplicateId of [
    "OPS-A-11", "OPS-A-18", "OPS-A-19", "OPS-C-02", "OPS-C-04", "OPS-C-05", "OPS-C-14",
    "OPS-D-01", "OPS-D-02", "OPS-E-02", "OPS-E-05", "OPS-E-09", "OPS-F-06",
  ]) {
    assert.equal(row(duplicateId), undefined, `${duplicateId} was a duplicate capability row and must stay deleted`);
  }
  assert.equal(row("OPS-C-02a")?.status, "built");
  assert.equal(row("OPS-C-23")?.status, "built");
  assert.deepEqual(
    { status: row("OPS-C-24")?.status, restAction: row("OPS-C-24")?.restAction },
    { status: "built", restAction: "notifyUserPaymentMethodRebind" },
  );
  assert.deepEqual(
    { status: row("OPS-C-25")?.status, restAction: row("OPS-C-25")?.restAction },
    { status: "built", restAction: "resetUserNickname" },
  );
  assert.equal(row("OPS-F-11")?.status, "built");
  assert.equal(row("OPS-I-14")?.status, "built");
  assert.equal(row("OPS-D-17")?.restAction, "togglePayoutVndChannel");
  assert.ok(row("OPS-D-09")?.restActions?.includes("updateD3ForecastConfig"));
  assert.deepEqual(row("OPS-H-07")?.restActions, [
    "createH4WheelTier", "updateH4WheelProbabilities", "updateH4WheelTier",
    "deleteH4WheelTier", "createH4WheelGuard", "updateH4WheelGuard",
  ]);
  assert.match(row("OPS-L-05")?.action ?? "", /团队树/);
  assert.equal(row("OPS-L-12"), undefined);
  assert.equal(row("OPS-L-13"), undefined);
  assert.equal(row("OPS-M-01")?.status, "readonly");
  for (let index = 2; index <= 16; index += 1) {
    assert.equal(row(`OPS-M-${String(index).padStart(2, "0")}`)?.status, "built");
  }
  assert.equal(row("OPS-M-16")?.restAction, "updateMConversationTimeoutPolicy");
  assert.equal(row("OPS-M-17")?.status, "built");
  assert.doesNotMatch(`${row("OPS-G-08")?.action ?? ""} ${row("OPS-G-08")?.note ?? ""}`, /trial/i);
  assert.doesNotMatch(row("OPS-G-08")?.action ?? "", /恢复/);
  assert.match(row("OPS-J-01")?.action ?? "", /恢复/);
  for (const item of manifest.rows.filter((candidate) => candidate.status === "built")) {
    assert.doesNotMatch(
      item.note ?? "",
      /未渲染|只\s*toast|不入库|无入口待定|当前不可操作|尚未接入/,
      `${item.id} built note must not contradict its status`,
    );
  }
  for (const item of manifest.rows.filter((candidate) => candidate.status === "readonly")) {
    assert.doesNotMatch(
      item.reason ?? "",
      /static mock|toast 占位|改价\/上下架\/增删才是写动作欠账/,
      `${item.id} readonly reason must describe the current implementation`,
    );
  }
});

test("typed evidence validators reject source-only false greens while pending contracts stay explicit", () => {
  const k16Evidence = row("OPS-K-16")?.runtimeEvidence?.[0];
  assert.equal(k16Evidence?.type, "backend-runtime");
  assert.equal(k16Evidence?.file, "src/main/java/ffdd/opsconsole/finance/application/EarningsReleaseService.java");
  assert.ok(k16Evidence?.positivePatterns?.includes("\"JANUS_PRODUCTION_EXECUTOR\"\\.equals\\(proof\\.source\\(\\)\\)"));
  assert.ok(k16Evidence?.positivePatterns?.includes("String\\s+sourceEnvironment\\s*=\\s*\"PRODUCTION\""));
  assert.ok(k16Evidence?.positivePatterns?.includes("mapper\\.attestedSeconds\\(userId,\\s*sourceEnvironment\\)"));
  assert.ok(k16Evidence?.positivePatterns?.includes("mapper\\.protectedEntries\\(userId,\\s*sourceEnvironment\\)"));
  assert.ok(k16Evidence?.negativePatterns?.includes("JANUS_SANDBOX_EXECUTOR"));
  assert.ok(k16Evidence?.negativePatterns?.includes("sourceEnvironment\\s*=\\s*\"SANDBOX\""));

  assert.deepEqual(
    manifest.rows.filter((item) => item.status === "pending").map((item) => item.id).toSorted(),
    SEMANTIC_PENDING_IDS.toSorted(),
  );
  assert.deepEqual(
    validateRuntimeEvidence(manifest, (type, relative) => {
      const base = type.startsWith("backend-") ? BACKEND_ROOT
        : type.startsWith("uniapp-") ? UNIAPP_ROOT
          : type.startsWith("janus-") ? JANUS_ROOT : ROOT;
      const absolute = join(base, relative);
      return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
    }),
    [],
  );
  assert.deepEqual(validateRuntimeConsumerContracts(manifest, () => undefined), []);
});
test("built rows have real PC callers, including active L3/L4 and C1 detail actions", () => {
  assert.match(read("lib/admin/payout-vnd-client.ts"), /export async function updatePayoutVndConfig/);
  assert.match(read("app/components/domain-views/d-tabs/d7-payout-vnd.tsx"), /await updatePayoutVndConfig\(/);
  assert.match(read("lib/admin/user360-client.ts"), /export async function exportUserProfilesCsv/);
  assert.match(read("app/components/domain-views/c-tabs/c1-search.tsx"), /await exportUserProfilesCsv\(/);
  const userClient = read("lib/admin/user360-client.ts");
  assert.match(userClient, /export async function notifyUserPaymentMethodRebind/);
  assert.match(userClient, /export async function resetUserNickname/);
  const l3 = read("app/components/domain-views/l-tabs/l3-finance.tsx");
  const l4 = read("app/components/domain-views/l-tabs/l4-ops.tsx");
  const lClient = read("lib/admin/l-client.ts");
  assert.match(l3, /\["week", "周"\], \["month", "月"\], \["quarter", "季"\], \["custom", "自定义"\]/);
  assert.match(l4, /\["day", "日"\], \["week", "周"\], \["month", "月"\], \["custom", "自定义"\]/);
  assert.match(l4, /createNetworkTreeExport\(/);
  assert.match(lClient, /export async function fetchL4OperationsOverview/);
  assert.match(lClient, /createNetworkTreeExport:/);
  const l3Service = readBackend("src/main/java/ffdd/opsconsole/bi/application/L3FinanceReportService.java");
  const l4Service = readBackend("src/main/java/ffdd/opsconsole/bi/application/OpsBiService.java");
  assert.match(l3Service, /revenue\(/);
  assert.match(l3Service, /redemption\(/);
  assert.match(l4Service, /exportNetworkTree\(/);
  assert.match(l4Service, /operationsOverview\(/);

  const reverseCoverage = [
    ["OPS-C-01", "c2_account_unfreeze", "app/components/domain-views/c-tabs/c2-actions.tsx"],
    ["OPS-C-13", "createUserAssetAdjustment", "app/components/domain-views/c-tabs/c3-adjust.tsx"],
    ["OPS-C-03", "requestLargeUserAssetAdjustment", "app/components/domain-views/c-tabs/c3-adjust.tsx"],
    ["OPS-C-03", "reverseUserAssetAdjustment", "app/components/domain-views/c-tabs/c3-adjust.tsx"],
    ["OPS-C-12", "removeUserAccountList", "app/components/domain-views/c-tabs/c2-actions.tsx"],
    ["OPS-C-35", "unbindUserPaymentMethod", "app/_console/users/search/[id]/page.tsx"],
    ["OPS-B-15", "downloadB2LiabilitiesCsv", "app/_console/overview/liquidity/page.tsx"],
    ["OPS-B-16", "updateB5Subscription", "app/_console/overview/risk-radar/page.tsx"],
    ["OPS-D-23", "updateD1VietQrConfig", "app/components/domain-views/d-tabs/d1-recon.tsx"],
    ["OPS-D-23", "createD1VietQrAccount", "app/components/domain-views/d-tabs/d1-recon.tsx"],
    ["OPS-D-23", "updateD1VietQrAccount", "app/components/domain-views/d-tabs/d1-recon.tsx"],
    ["OPS-D-09", "updateD3ForecastConfig", "app/components/domain-views/d-tabs/d3-treasury.tsx"],
    ["OPS-D-25", "downloadD3Csv", "app/components/domain-views/d-tabs/d3-treasury.tsx"],
    ["OPS-D-17", "togglePayoutVndChannel", "app/components/domain-views/d-tabs/d7-payout-vnd.tsx"],
    ["OPS-F-20", "executeF3Settlement", "app/components/domain-views/f-tabs/f3-binary.tsx"],
    ["OPS-F-21", "updateF5AnomalyConfig", "app/components/domain-views/f-tabs/f5-audit.tsx"],
    ["OPS-F-22", "f_vrank_override", "app/components/domain-views/f-view.tsx"],
    ["OPS-F-23", "f_reward_payout_action", "app/components/domain-views/f-view.tsx"],
    ["OPS-F-24", "f4_pool_settle", "app/components/domain-views/f-view.tsx"],
    ["OPS-F-25", "f5_commission_reverse", "app/components/domain-views/f-view.tsx"],
    ["OPS-F-25", "f5_commission_reissue", "app/components/domain-views/f-view.tsx"],
    ["OPS-F-25", "f5_commission_suspension", "app/components/domain-views/f-view.tsx"],
    ["OPS-G-15", "updateG4AdminOperationConfig", "app/components/domain-views/g-tabs/g4-admin-operations.tsx"],
    ["OPS-G-15", "createG4AdminSimulation", "app/components/domain-views/g-tabs/g4-admin-operations.tsx"],
    ["OPS-G-15", "archiveG4AdminSimulation", "app/components/domain-views/g-tabs/g4-admin-operations.tsx"],
    ["OPS-H-14", "createH3Mission", "app/components/domain-views/h-tabs/h3-quest-events.tsx"],
    ["OPS-H-14", "createH3MonthlyMission", "app/components/domain-views/h-tabs/h3-quest-events.tsx"],
    ["OPS-H-15", "createH4QuestEvent", "app/components/domain-views/h-tabs/h3-quest-events.tsx"],
    ["OPS-H-15", "updateH4EventFeatured", "app/components/domain-views/h-tabs/h3-quest-events.tsx"],
    ["OPS-H-16", "deleteH7Voucher", "app/components/domain-views/h-tabs/h7-voucher-config.tsx"],
    ["OPS-E-21", "uploadAdminMedia", "app/components/domain-views/e-view.tsx"],
    ["OPS-E-17", "updateE2TaskPricing", "app/components/domain-views/e-tabs/e2-tasks.tsx"],
    ["OPS-D-08", "updateD1TopupChannelMin", "app/components/domain-views/d-tabs/d1-recon.tsx"],
    ["OPS-D-08", "updateD1TopupChannelMax", "app/components/domain-views/d-tabs/d1-recon.tsx"],
    ["OPS-D-11", "createD1BinLock", "app/components/domain-views/d-tabs/d1-recon.tsx"],
    ["OPS-K-15", "disableK6RemoteTarget", "app/components/domain-views/k-tabs/k6/remote-target-manager.tsx"],
    ["OPS-K-15", "createK6RemoteTargetVersion", "app/components/domain-views/k-tabs/k6/remote-target-manager.tsx"],
    ["OPS-K-15", "reconcileK6Takeover", "app/components/domain-views/k-tabs/k6/device-detail.tsx"],
    ["OPS-K-15", "revokeK6Takeover", "app/components/domain-views/k-tabs/k6/device-detail.tsx"],
    ["OPS-K-15", "resendK6TakeoverRevoke", "app/components/domain-views/k-tabs/k6/device-detail.tsx"],
    ["OPS-K-15", "retryK6Takeover", "app/components/domain-views/k-tabs/k6/device-detail.tsx"],
    ["OPS-K-15", "changeK6TakeoverTarget", "app/components/domain-views/k-tabs/k6/device-detail.tsx"],
    ["OPS-K-15", "updateK6DeviceStatus", "lib/store/admin/janus-c2-store.ts"],
    ["OPS-K-15", "saveK6Strategy", "lib/store/admin/janus-c2-store.ts"],
    ["OPS-K-15", "runK6DryRun", "lib/store/admin/janus-c2-store.ts"],
    ["OPS-K-15", "changeK6StrategyStatus", "lib/store/admin/janus-c2-store.ts"],
    ["OPS-K-15", "deleteK6Strategy", "lib/store/admin/janus-c2-store.ts"],
    ["OPS-K-15", "rollbackK6Strategy", "lib/store/admin/janus-c2-store.ts"],
    ["OPS-K-15", "recordK6Export", "app/components/domain-views/k-tabs/k6/audit-log.tsx"],
    ["OPS-D-24", "reconcileD1VietQr", "app/components/domain-views/d-tabs/d1-recon.tsx"],
    ["OPS-F-01", "addF1VRankReward", "app/components/domain-views/f-view.tsx"],
    ["OPS-F-01", "removeF1VRankReward", "app/components/domain-views/f-view.tsx"],
    ["OPS-G-04", "cancelG2ExchangeQueueOrder", "app/components/domain-views/g-tabs/g2-exchange.tsx"],
    ["OPS-G-04", "processG2ExchangeQueue", "app/components/domain-views/g-tabs/g2-exchange.tsx"],
    ["OPS-G-05", "updateG3Control", "app/components/domain-views/g-tabs/g3-market.tsx"],
    ["OPS-G-16", "issueG4InviteCodes", "app/components/domain-views/g-tabs/g4-invite-codes.tsx"],
    ["OPS-G-16", "voidG4InviteCode", "app/components/domain-views/g-tabs/g4-invite-codes.tsx"],
    ["OPS-G-07", "rerunG4GenesisDividendBatch", "app/components/domain-views/g-tabs/g4-genesis.tsx"],
    ["OPS-H-01", "updateH1RhythmParam", "app/components/domain-views/h-tabs/h1-phase.tsx"],
    ["OPS-H-17", "killH2AutoPush", "app/components/domain-views/h-tabs/h2-trial.tsx"],
    ["OPS-H-18", "h8_referral_settlement", "app/components/domain-views/h-tabs/h8-referral-rewards.tsx"],
    ["OPS-H-08", "updateH5StreakMilestone", "app/components/domain-views/h-tabs/h5-daily-milestones.tsx"],
    ["OPS-H-08", "updateH5PowerUp", "app/components/domain-views/h-tabs/h5-daily-milestones.tsx"],
    ["OPS-H-08", "updateH5EarnMilestone", "app/components/domain-views/h-tabs/h5-daily-milestones.tsx"],
    ["OPS-H-08", "updateH5EarnTickInterval", "app/components/domain-views/h-tabs/h5-daily-milestones.tsx"],
    ["OPS-I-01", "createI1Copy", "app/components/domain-views/i-tabs/i1-copy-ab.tsx"],
    ["OPS-I-01", "createI1CopyPosition", "app/components/domain-views/i-tabs/i1-copy-ab.tsx"],
    ["OPS-I-01", "deleteI1CopyPosition", "app/components/domain-views/i-tabs/i1-copy-ab.tsx"],
    ["OPS-I-01", "createI1CopyVersionOption", "app/components/domain-views/i-tabs/i1-copy-ab.tsx"],
    ["OPS-I-01", "updateI1CopyVersionOption", "app/components/domain-views/i-tabs/i1-copy-ab.tsx"],
    ["OPS-I-01", "deleteI1CopyVersionOption", "app/components/domain-views/i-tabs/i1-copy-ab.tsx"],
    ["OPS-I-01", "saveI1CopyDraft", "app/components/domain-views/i-tabs/i1-copy-ab.tsx"],
    ["OPS-I-01", "deleteI1CopyDraft", "app/components/domain-views/i-tabs/i1-copy-ab.tsx"],
    ["OPS-I-01", "rollbackI1CopyVersion", "app/components/domain-views/i-tabs/i1-copy-ab.tsx"],
    ["OPS-I-01", "archiveI1Copy", "app/components/domain-views/i-tabs/i1-copy-ab.tsx"],
    ["OPS-I-01", "createI1Experiment", "app/components/domain-views/i-tabs/i1-copy-ab.tsx"],
    ["OPS-I-01", "discardI1Experiment", "app/components/domain-views/i-tabs/i1-copy-ab.tsx"],
    ["OPS-I-17", "createI2Template", "app/components/domain-views/i-tabs/i2-nova.tsx"],
    ["OPS-I-17", "updateI2Template", "app/components/domain-views/i-tabs/i2-nova.tsx"],
    ["OPS-I-17", "updateI2TemplateStatus", "app/components/domain-views/i-tabs/i2-nova.tsx"],
    ["OPS-I-17", "deleteI2Template", "app/components/domain-views/i-tabs/i2-nova.tsx"],
    ["OPS-I-18", "updateI2Distribution", "app/components/domain-views/i-tabs/i2-nova.tsx"],
    ["OPS-I-18", "syncI2SocialEvents", "app/components/domain-views/i-tabs/i2-nova.tsx"],
    ["OPS-I-18", "updateI2SocialEventStatus", "app/components/domain-views/i-tabs/i2-nova.tsx"],
    ["OPS-I-18", "deleteI2SocialEvent", "app/components/domain-views/i-tabs/i2-nova.tsx"],
    ["OPS-I-03", "createI3Campaign", "app/components/domain-views/i-tabs/i3-campaign.tsx"],
    ["OPS-I-03", "updateI3CampaignDraft", "app/components/domain-views/i-tabs/i3-campaign.tsx"],
    ["OPS-I-03", "deleteI3Campaign", "app/components/domain-views/i-tabs/i3-campaign.tsx"],
    ["OPS-I-04", "createI4TrustSectionDraft", "app/components/domain-views/i-tabs/i4-trust.tsx"],
    ["OPS-I-04", "updateI4TrustSectionDraft", "app/components/domain-views/i-tabs/i4-trust.tsx"],
    ["OPS-I-04", "deleteI4TrustSectionDraft", "app/components/domain-views/i-tabs/i4-trust.tsx"],
    ["OPS-I-05", "createI5DisclosureVersion", "app/components/domain-views/i-tabs/i4-trust.tsx"],
    ["OPS-I-05", "updateI5DisclosureVersion", "app/components/domain-views/i-tabs/i4-trust.tsx"],
    ["OPS-I-05", "deleteI5DisclosureVersion", "app/components/domain-views/i-tabs/i4-trust.tsx"],
    ["OPS-I-19", "createI5Jurisdiction", "app/components/domain-views/i-tabs/i4-trust.tsx"],
    ["OPS-I-19", "updateI5Jurisdiction", "app/components/domain-views/i-tabs/i4-trust.tsx"],
    ["OPS-I-06", "rescanI6", "app/components/domain-views/i-tabs/i6-i18n.tsx"],
    ["OPS-I-06", "saveI6LocalizedDraft", "app/components/domain-views/i-tabs/i6-i18n.tsx"],
    ["OPS-I-06", "archiveI6LocalizedMessage", "app/components/domain-views/i-tabs/i6-i18n.tsx"],
    ["OPS-I-06", "rollbackI6LocalizedMessage", "app/components/domain-views/i-tabs/i6-i18n.tsx"],
    ["OPS-I-06", "fixI6Integrity", "app/components/domain-views/i-tabs/i6-i18n.tsx"],
    ["OPS-I-07", "createI6Course", "app/components/domain-views/i-tabs/i6-i18n.tsx"],
    ["OPS-I-07", "updateI7CourseDraft", "app/components/domain-views/i-tabs/i6-i18n.tsx"],
    ["OPS-I-07", "deleteI7CourseDraft", "app/components/domain-views/i-tabs/i6-i18n.tsx"],
    ["OPS-I-07", "createI7CourseVersion", "app/components/domain-views/i-tabs/i6-i18n.tsx"],
    ["OPS-I-07", "updateI7CourseVersion", "app/components/domain-views/i-tabs/i6-i18n.tsx"],
    ["OPS-I-07", "deleteI7CourseVersion", "app/components/domain-views/i-tabs/i6-i18n.tsx"],
    ["OPS-I-07", "publishI7CourseVersion", "app/components/domain-views/i-tabs/i6-i18n.tsx"],
    ["OPS-I-07", "rollbackI7CourseVersion", "app/components/domain-views/i-tabs/i6-i18n.tsx"],
    ["OPS-I-13", "updateI6FeaturedCourse", "app/components/domain-views/i-tabs/i6-i18n.tsx"],
    ["OPS-J-01", "emergencyDisableJ1", "app/components/domain-views/j-tabs/j1-killswitch.tsx"],
    ["OPS-J-01", "confirmJ1AutoTrigger", "app/components/domain-views/j-tabs/j1-killswitch.tsx"],
    ["OPS-J-04", "createJ4Playbook", "app/components/domain-views/j-tabs/j4-sop.tsx"],
    ["OPS-J-04", "drillJ4Playbook", "app/components/domain-views/j-tabs/j4-sop.tsx"],
    ["OPS-J-04", "rollbackJ4Playbook", "app/components/domain-views/j-tabs/j4-sop.tsx"],
    ["OPS-J-04", "cancelJ4Playbook", "app/components/domain-views/j-tabs/j4-sop.tsx"],
    ["OPS-J-04", "resumeJ4Playbook", "app/components/domain-views/j-tabs/j4-sop.tsx"],
    ["OPS-K-01", "updateK1ClusterReviewNote", "app/components/domain-views/k-tabs/k1-multiaccount.tsx"],
    ["OPS-K-01c", "disableK1Whitelist", "app/components/domain-views/k-tabs/k1-multiaccount.tsx"],
    ["OPS-K-18", "manualReleaseK1Entry", "app/components/domain-views/k-tabs/k1-multiaccount.tsx"],
    ["OPS-K-03", "dryRunK3", "app/components/domain-views/k-tabs/k3-rules.tsx"],
    ["OPS-K-19", "publishK4ModelDraft", "app/components/domain-views/k-tabs/k4-scoring.tsx"],
    ["OPS-K-19", "restoreK4ModelDraft", "app/components/domain-views/k-tabs/k4-scoring.tsx"],
    ["OPS-K-19", "recomputeK4Scores", "app/components/domain-views/k-tabs/k4-scoring.tsx"],
    ["OPS-K-20", "markK4WithdrawalAlertRead", "app/components/domain-views/k-tabs/k4-scoring.tsx"],
    ["OPS-L-02", "createRegulatoryReport", "app/components/domain-views/l-tabs/l5-export.tsx"],
    ["OPS-L-04", "downloadReport", "app/components/domain-views/l-tabs/l5-export.tsx"],
    ["OPS-L-11", "downloadL6Behavior", "app/components/domain-views/l-tabs/l6-behavior-heatmap.tsx"],
    ["OPS-E-14", "activateE5Device", "app/components/domain-views/e-view.tsx"],
    ["OPS-E-14", "deactivateE5Device", "app/components/domain-views/e-view.tsx"],
    ["OPS-E-14", "setE5UserDevicesPaused", "app/components/domain-views/e-view.tsx"],
    ["OPS-E-14", "e5_device_force_activate", "app/components/domain-views/e-view.tsx"],
    ["OPS-E-14", "e5_device_unbind", "app/components/domain-views/e-view.tsx"],
    ["OPS-E-14", "e5_device_batch_pause", "app/components/domain-views/e-view.tsx"],
    ["OPS-E-14", "e5_device_batch_resume", "app/components/domain-views/e-view.tsx"],
    ["OPS-E-14", "e5_datacenter_create", "app/components/domain-views/e-view.tsx"],
    ["OPS-E-14", "e5_datacenter_update", "app/components/domain-views/e-view.tsx"],
    ["OPS-E-14", "e5_datacenter_delete", "app/components/domain-views/e-view.tsx"],
    ["OPS-E-14", "e5_datacenter_pause", "app/components/domain-views/e-view.tsx"],
    ["OPS-E-14", "e5_datacenter_resume", "app/components/domain-views/e-view.tsx"],
    ["OPS-E-08", "e1_early_access_update", "app/components/domain-views/e-view.tsx"],
    ["OPS-E-08", "e1_phase_archive", "app/components/domain-views/e-view.tsx"],
    ["OPS-E-08", "e1_gate_archive", "app/components/domain-views/e-view.tsx"],
    ["OPS-E-08", "e1_gate_field", "app/components/domain-views/e-view.tsx"],
    ["OPS-E-10", "e2_phone_tier", "app/components/domain-views/e-view.tsx"],
    ["OPS-E-10", "e2_task_price", "app/components/domain-views/e-view.tsx"],
    ["OPS-E-13", "e4_order_cancel", "app/components/domain-views/e-view.tsx"],
  ];
  for (const [rowId, action, page] of reverseCoverage) {
    const claims = [row(rowId)?.restAction, ...(row(rowId)?.restActions ?? [])].filter(Boolean);
    assert.ok(claims.includes(action), `${rowId} must claim ${action}`);
    const callPattern = action.includes("_")
      ? new RegExp(`["']${action}["']`)
      : new RegExp(`\\b${action}\\(`);
    assert.match(read(page), callPattern, `${action} must remain called by ${page}`);
  }

  const manifestCommands = new Set(manifest.rows
    .flatMap((item) => [item.restAction, ...(item.restActions ?? [])])
    .filter(Boolean));
  const activeAppSource = readSourceTree(join(ROOT, "app"));
  const literalHighOps = [...activeAppSource.matchAll(/\bfindHighOp\(\s*["']([^"']+)["']\s*\)/g)]
    .map((match) => match[1]);
  assert.ok(literalHighOps.length > 0, "active App must retain literal high-op calls for reverse coverage");
  for (const action of new Set(literalHighOps)) {
    assert.ok(manifestCommands.has(action), `active literal findHighOp ${action} is missing from the action ledger`);
  }

  const fDispatcher = readBackend("src/main/java/ffdd/opsconsole/team/application/OpsTeamService.java");
  const hDispatcher = readBackend("src/main/java/ffdd/opsconsole/growth/application/OpsGrowthService.java");
  const endToEndWriteCoverage = [
    ["app/components/domain-views/f-tabs/f1-vrank.tsx", /ctx\.proposeVRankOverride\(/, fDispatcher, /case "f_vrank_override"/],
    ["app/components/domain-views/f-tabs/f1-vrank.tsx", /ctx\.proposePayoutAction\(/, fDispatcher, /case "f_reward_payout_action"/],
    ["app/components/domain-views/f-tabs/f4-ops.tsx", /ctx\.proposeF4Settlement\(/, fDispatcher, /case "f4_pool_settle"/],
    ["app/components/domain-views/f-tabs/f5-audit.tsx", /ctx\.reverseF5Commission\(/, fDispatcher, /case "f5_commission_reverse"/],
    ["app/components/domain-views/f-tabs/f5-audit.tsx", /ctx\.reissueF5Commissions\(/, fDispatcher, /case "f5_commission_reissue"/],
    ["app/components/domain-views/f-tabs/f5-audit.tsx", /ctx\.suspendF5UserCommissions\(/, fDispatcher, /case "f5_commission_suspension"/],
    ["app/components/domain-views/h-tabs/h8-referral-rewards.tsx", /findHighOp\("h8_referral_settlement"\)/, hDispatcher, /case "h8_referral_settlement"/],
  ];
  for (const [page, pagePattern, backendSource, backendPattern] of endToEndWriteCoverage) {
    assert.match(read(page), pagePattern, `${page} must retain its audited operator action`);
    assert.match(backendSource, backendPattern, `${page} must retain its audited backend dispatcher`);
  }

  const mView = read("app/components/domain-views/m-view.tsx");
  const mClient = read("lib/admin/m-client.ts");
  const mPages = ["m1-overview", "m2-tickets", "m3-sessions", "m4-kb-sla", "m5-scripts"]
    .map((name) => read(`app/components/domain-views/m-tabs/${name}.tsx`))
    .join("\n");
  for (const action of [
    "createTicket", "replyTicket", "updateTicketStatus", "assignTicket", "escalateTicket",
    "initiateConversation", "replyConversation", "transferConversation", "convertConversationToTicket",
    "createFaq", "updateSla", "assignSupportSeat", "createScript", "createReplyTemplate",
  ]) {
    assert.match(mClient, new RegExp(`\\b${action}\\(`), `${action} must have a real M client command`);
    assert.match(mView, new RegExp(`mContentActions\\.${action}\\(`), `${action} must be called by the active M surface`);
  }

  const manifestMCommands = new Set(manifest.rows
    .filter((item) => item.domain === "M")
    .flatMap((item) => [item.restAction, ...(item.restActions ?? [])])
    .filter(Boolean));
  const calledMContentActions = [...mView.matchAll(/mContentActions\.([A-Za-z0-9_]+)\(/g)].map((match) => match[1]);
  for (const action of calledMContentActions) {
    assert.ok(manifestMCommands.has(action), `${action} is called by active M but missing from the action ledger`);
  }
  const standaloneMWrites = [...mClient.matchAll(/^export (?:async )?function ((?:create|update|delete|archive|assign|deactivate|rebalance|convert|reply|initiate|transfer|accept|return|wait|fallback|escalate|add|remove)[A-Za-z0-9_]*)\s*\(/gm)]
    .map((match) => match[1])
    .filter((action) => new RegExp(`\\b${action}\\(`).test(mPages));
  for (const action of standaloneMWrites) {
    assert.ok(manifestMCommands.has(action), `${action} is called by an active M page but missing from the action ledger`);
  }
  assert.match(read("app/components/domain-views/m-tabs/m3-sessions.tsx"), /await updateMConversationTimeoutPolicy\(/);
  assert.match(readBackend("src/main/java/ffdd/opsconsole/content/application/ConversationTimeoutPolicyService.java"), /public ApiResult<ConversationTimeoutPolicy> update\(/);
  assert.match(readBackend("src/main/java/ffdd/opsconsole/content/application/ConversationIdleTimeoutScheduler.java"), /ConversationTimeoutPolicy policy = mapper\.selectPolicy\(\)/);

  const f5Commission = readBackend("src/main/java/ffdd/opsconsole/team/application/F5CommissionService.java");
  const idempotencyExecutor = readBackend("src/main/java/ffdd/opsconsole/shared/idempotency/AdminIdempotencyTransactionExecutor.java");
  assert.equal(row("OPS-F-26")?.status, "built");
  assert.match(f5Commission, /for \(Long eventId : eventIds\)/);
  assert.match(f5Commission, /throw new BizException\(409, "COMMISSION_REISSUE_(?:SOURCE_NOT_FOUND|STATE_CONFLICT|CAS_CONFLICT)/);
  assert.match(idempotencyExecutor, /T result = action\.get\(\);[\s\S]{0,160}markSucceeded\(recordId, writeJson\(result\)\)/);

  const backendRouteCoverage = [
    ["src/main/java/ffdd/opsconsole/content/web/OpsNovaController.java", /@PostMapping\("\/channels"\)/],
    ["src/main/java/ffdd/opsconsole/content/web/OpsTrustDisclosureController.java", /@PostMapping\("\/disclosures\/jurisdictions"\)/],
    ["src/main/java/ffdd/opsconsole/finance/web/OpsEarningsReleaseController.java", /@PostMapping\("\/\{entryNo\}\/manual"\)/],
    ["src/main/java/ffdd/opsconsole/risk/web/OpsRiskController.java", /@PostMapping\("\/withdraw-rules"\)/],
    ["src/main/java/ffdd/opsconsole/risk/web/K4WithdrawalAlertController.java", /@PostMapping\("\/\{eventId\}\/read"\)/],
    ["src/main/java/ffdd/opsconsole/bi/web/OpsBehaviorAnalyticsController.java", /@GetMapping\("\/export\/behavior"\)/],
    ["src/main/java/ffdd/opsconsole/media/web/OpsMediaController.java", /@PostMapping\(value = "\/uploads"/],
    ["src/main/java/ffdd/opsconsole/finance/web/OpsVietnamPaymentController.java", /@PostMapping\("\/vietqr\/reconciliations\/\{id\}\/actions\/\{action\}"\)/],
    ["src/main/java/ffdd/opsconsole/team/application/OpsTeamService.java", /case "f5_commission_reissue"/],
  ];
  for (const [relative, pattern] of backendRouteCoverage) {
    assert.match(readBackend(relative), pattern, `${relative} must retain the audited backend route or dispatcher`);
  }
});

test("historical audit receipt cannot override the live machine-readable pending ledger", () => {
  const relative = "docs/验收报告/PC管理后台遗留功能审计-20260810.md";
  assert.ok(existsSync(join(ROOT, relative)), "missing current remaining-development audit report");
  const report = read(relative);
  assert.match(report, /生产环境没有真实供应商时一律失败关闭/);
  assert.match(report, /没有执行真实资金\/供应商动作，没有提交、推送或部署/);
  assert.equal(manifest.rows.filter((item) => item.status === "pending").length, 1);
});

test("historical selected-evidence SHA256 receipt remains parseable without overriding the dirty candidate", () => {
  const ledger = read("docs/验收报告/PC管理后台遗留功能审计-20260810.files.sha256");
  const entries = ledger.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#"));
  assert.ok(entries.length >= 100, "selected evidence ledger unexpectedly shrank");
  for (const line of entries) {
    const match = line.match(/^([0-9a-f]{64}) \*(.+)$/);
    assert.ok(match, `invalid SHA256 ledger line: ${line}`);
    const [, expected, absolute] = match;
    assert.ok(existsSync(absolute), `SHA256 ledger file is missing: ${absolute}`);
    assert.match(expected, /^[0-9a-f]{64}$/);
  }
});
