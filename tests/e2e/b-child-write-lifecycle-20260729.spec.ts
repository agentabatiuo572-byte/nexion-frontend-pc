import { execFileSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIResponse, type Browser, type Page, type Route } from "@playwright/test";

/**
 * B1-B5 isolated-child write lifecycle carrier.
 *
 * This spec is deliberately inert unless the main controller issues the exact
 * B_WRITE_TOKEN after the shared B1_COVERAGE_LOCK is transferred to B.
 * It must never point at the main acceptance database.
 *
 * Required at execution time:
 *   B_WRITE_TOKEN=pc-full-acceptance-20260729-114336-b-child-final
 *   B_CHILD_DATABASE=nexion_acceptance_20260729_114336_d
 *   B_MYSQL_PASSWORD=<restricted secret>
 *   B_FIXTURE_PATH=<restricted B.json>
 *   B_EVIDENCE_DIR=<restricted B evidence directory>
 *
 * Run with workers=1 and trace=on. `--list` is safe without any secret/token.
 */

const RUN_ID = "pc-full-acceptance-20260729-114336";
const EXPECTED_WRITE_TOKEN = "CONSUMED-B-WRITE-TOKEN-20260729-R7";
const OWNER_ATTEMPT = "R7";
const R7_FIXTURE_TOKEN = `${RUN_ID}-b-second-writer-fixture-r7`;
const IDEMPOTENCY_NAMESPACE = `${OWNER_ATTEMPT}-${R7_FIXTURE_TOKEN}`;
const EXPECTED_CHILD_DATABASE = "nexion_acceptance_20260729_114336_d";
const CONFIG_PREFIX = "treasury.d3.forecast-config";
const B3_VIEW_PREFIX = `B3-${OWNER_ATTEMPT}-${RUN_ID}-`;
const EXPECTED_FIXTURE_PATH = path.resolve(
  `D:\\workspace\\bug-pic\\.restricted\\${RUN_ID}\\A\\domain-permission-fixtures\\B.json`,
);
const EXPECTED_EVIDENCE_ROOT = path.resolve(
  `D:\\workspace\\bug-pic\\.restricted\\${RUN_ID}\\B`,
);
const DATASOURCE_SENTINEL_KEY = "feature.ops.maintenanceBanner";
const MYSQL_EXE = process.env.B_MYSQL_EXE
  ?? "D:\\software\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe";

type Account = {
  accountId?: string | number;
  id?: string | number;
  username: string;
  password: string;
  totpSecret?: string;
};

type Fixture = {
  runId?: string;
  checker?: Account;
  accounts?: {
    maker?: Account;
    readonly?: Account;
    nowrite?: Account;
    nomenu?: Account;
    secondWriter?: Account;
  };
};

type ApiEvidence = {
  status: number;
  headers: Record<string, string>;
  body: any;
};

type AbandonedResponseEvidence = {
  serverResponse: ApiEvidence;
  clientObservation: {
    kind: "error";
    name: string;
    message: string;
  };
};

type ConfigRow = {
  id: number;
  configKey: string;
  configValue: string | null;
  valueType: string | null;
  configGroup: string | null;
  visibility: string | null;
  remark: string | null;
  status: number;
  createdAt: string;
  updatedAt: string;
  isDeleted: number;
};

test.describe.configure({ mode: "serial" });

test("B carrier 静态合同：所有 B2/B3 可写请求使用 R7 + fixture token + case 幂等命名空间", async () => {
  const cases = [
    acceptanceKey("b2", "writer-1"),
    acceptanceKey("b2", "writer-2"),
    acceptanceKey("b2", "unknown"),
    acceptanceKey("b2", "readonly-deny"),
    acceptanceKey("b2", "nowrite-deny"),
    acceptanceKey("b2", "nomenu-deny"),
    acceptanceKey("b2", "nomenu-relogin-deny"),
    acceptanceKey("b3", "stable"),
    acceptanceKey("b3", "name-conflict"),
    acceptanceKey("b3", "unknown"),
    acceptanceKey("b3", "readonly-deny"),
    acceptanceKey("b3", "nowrite-deny"),
    acceptanceKey("b3", "nomenu-deny"),
    acceptanceKey("b3", "nomenu-relogin-deny"),
  ];
  expect(new Set(cases).size).toBe(cases.length);
  for (const key of cases) {
    expect(key).toContain(`${OWNER_ATTEMPT}-${R7_FIXTURE_TOKEN}-`);
    expect(Buffer.byteLength(key, "utf8"), "nx_admin_idempotency_record.idempotency_key VARCHAR(128)")
      .toBeLessThanOrEqual(128);
    expect(key).toMatch(
      /-(?:writer-[12]|unknown|stable|name-conflict|(?:readonly|nowrite|nomenu|nomenu-relogin)-deny)$/,
    );
  }

  const source = await readFile(__filename, "utf8");
  for (const scope of ["b2", "b3"]) {
    const forbiddenLegacyPrefix = `${scope}-` + "$" + "{RUN_ID}-";
    expect(
      source.includes(forbiddenLegacyPrefix),
      `legacy ${scope} key must not use only RUN_ID`,
    ).toBe(false);
  }
});

test("B child：B1/B4/B5只读，B2 CAS/幂等/unknown，B3保存/幂等/unknown，并精确恢复可变夹具", async ({
  baseURL,
  browser,
}) => {
  test.skip(
    process.env.B_WRITE_TOKEN?.trim() !== EXPECTED_WRITE_TOKEN,
    "Main-controller B_WRITE_TOKEN not issued; the carrier remains read/list-only.",
  );

  const database = requiredEnv("B_CHILD_DATABASE");
  const mysqlPassword = requiredEnv("B_MYSQL_PASSWORD");
  const fixturePath = requiredEnv("B_FIXTURE_PATH");
  const evidenceDir = requiredEnv("B_EVIDENCE_DIR");
  const expectedPcBuildId = requiredEnv("B_PC_BUILD_ID");
  const expectedPcPort = requiredEnv("B_PC_PORT");
  const pcBuildIdPath = requiredEnv("B_PC_BUILD_ID_PATH");
  const expectedJarHash = requiredEnv("B_BACKEND_JAR_SHA256").toUpperCase();
  const backendJarPath = requiredEnv("B_BACKEND_JAR_PATH");
  expect(database, "refuse any database except the named isolated child").toBe(EXPECTED_CHILD_DATABASE);
  expect(await currentDatabase(mysqlPassword, database)).toBe(EXPECTED_CHILD_DATABASE);
  expect(path.resolve(fixturePath), "only the run-scoped restricted B fixture is accepted")
    .toBe(EXPECTED_FIXTURE_PATH);
  expect(isPathInside(path.resolve(evidenceDir), EXPECTED_EVIDENCE_ROOT), "evidence must remain restricted")
    .toBe(true);
  expect((await readFile(pcBuildIdPath, "utf8")).trim(), "running PC candidate drift")
    .toBe(expectedPcBuildId);
  expect(await sha256File(backendJarPath), "backend candidate drift").toBe(expectedJarHash);

  const targetBaseUrl = new URL(baseURL ?? `http://127.0.0.1:${expectedPcPort}`);
  expect(["127.0.0.1", "localhost"], "B lifecycle is local-only").toContain(targetBaseUrl.hostname);
  expect(targetBaseUrl.port || "80", "B lifecycle must use the controller-issued child PC port")
    .toBe(expectedPcPort);
  let servedBuildManifest: Response | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    servedBuildManifest = await fetch(
      new URL(`/_next/static/${expectedPcBuildId}/_buildManifest.js`, targetBaseUrl.origin),
    );
    if (servedBuildManifest.status === 200) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  expect(
    servedBuildManifest?.status,
    "locked PC process must serve the controller-issued Build ID",
  ).toBe(200);

  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
  expect(fixture.runId, "fixture must belong to this run").toBe(RUN_ID);
  const writerOne = requiredAccount(fixture.accounts?.maker, "accounts.maker");
  const writerTwo = requiredAccount(
    fixture.accounts?.secondWriter ?? fixture.checker,
    "accounts.secondWriter or checker",
  );
  expect(writerTwo.username, "two independently authenticated operators are mandatory")
    .not.toBe(writerOne.username);
  const writerOneId = accountId(writerOne);
  const writerTwoId = accountId(writerTwo);

  await mkdir(evidenceDir, { recursive: true });
  const evidence: Record<string, unknown> = {
    runId: RUN_ID,
    database,
    baseUrl: targetBaseUrl.origin,
    candidate: {
      pcBuildId: expectedPcBuildId,
      servedBuildManifestStatus: servedBuildManifest?.status,
      backendJarPath,
      backendJarSha256: expectedJarHash,
    },
    actors: [
      { accountId: writerOneId, username: writerOne.username },
      { accountId: writerTwoId, username: writerTwo.username },
    ],
    guardrails: {
      noB1Ack: true,
      noB1ThresholdWrite: true,
      noReserveInjection: true,
      noB5ThresholdWrite: true,
      noB5SubscriptionWrite: true,
      noB5TriageWrite: true,
      b4ReadOnly: true,
    },
  };

  const contextOne = await browser.newContext();
  const contextTwo = await browser.newContext();
  const pageOne = await contextOne.newPage();
  const pageTwo = await contextTwo.newPage();

  let configBefore: ConfigRow[] = [];
  let configAfterRestore: ConfigRow[] = [];
  let configSnapshotTaken = false;
  let auditBaseline = 0;
  let outboxBaseline = 0;
  let a2TicketBaseline = 0;
  let mutableFailure: unknown;
  let cleanupFailure: unknown;
  const createdViewNames: string[] = [];

  try {
    await Promise.all([login(pageOne, writerOne), login(pageTwo, writerTwo)]);
    const [sessionOne, sessionTwo] = await Promise.all([
      assertWriterAuthorities(pageOne, writerOne.username),
      assertWriterAuthorities(pageTwo, writerTwo.username),
    ]);
    evidence.sessions = { writerOne: sessionOne, writerTwo: sessionTwo };

    evidence.datasourceProof = await assertBackendUsesChildDatabase(
      pageOne,
      mysqlPassword,
      database,
    );

    // Let a due pending forecast promote before taking the exact DB baseline.
    expect((await apiEvidence(await pageOne.request.get("/api/admin/treasury/forecast-config"))).status)
      .toBe(200);
    configBefore = await snapshotConfig(mysqlPassword, database);
    configSnapshotTaken = true;
    expect(
      await countRunViews(mysqlPassword, database),
      "run-prefixed B3 rows must be absent before the write chain",
    ).toBe(0);
    auditBaseline = await scalarNumber(
      mysqlPassword,
      database,
      "SELECT COALESCE(MAX(id),0) FROM nx_audit_log",
    );
    outboxBaseline = await scalarNumber(
      mysqlPassword,
      database,
      "SELECT COALESCE(MAX(id),0) FROM nx_event_outbox",
    );
    a2TicketBaseline = await scalarNumber(
      mysqlPassword,
      database,
      "SELECT COALESCE(MAX(id),0) FROM nx_audit_operation_ticket",
    );
    evidence.before = {
      configRows: configBefore,
      auditMaxId: auditBaseline,
      outboxMaxId: outboxBaseline,
      a2TicketMaxId: a2TicketBaseline,
    };

    // Negative write probes come after the DB snapshot so even a permission
    // regression that unexpectedly returns 200 is recoverable in `finally`.
    await assertNoWriteRolesFailClosed(fixture, browser, evidence);

    evidence.secondWriterReadBoundaryBefore = await assertSecondWriterReadBoundary(pageTwo);
    // The minimal second writer is intentionally scoped to B2/B3. Cross-domain
    // B1/B4/B5/J1 invariants belong to the full B Owner account, not the CAS peer.
    const readOnlyBefore = await bReadChain(pageOne);
    evidence.makerJ1DeniedBefore = await assertJ1Denied(pageOne, "maker before");
    const j1CanonicalBefore = await assertJ1CanonicalFromDatabase(
      mysqlPassword,
      database,
      readOnlyBefore.b5,
    );
    const immutableSafetyBefore = immutableSafetyProjection(readOnlyBefore);
    evidence.readOnlyCrossDomainBefore = readOnlyBefore;
    evidence.j1CanonicalBefore = j1CanonicalBefore;
    evidence.immutableSafetyBefore = immutableSafetyBefore;
    evidence.b2 = await executeB2Lifecycle(pageOne, pageTwo, writerOne, writerTwo);

    const b3OutboxBaseline = await scalarNumber(
      mysqlPassword,
      database,
      "SELECT COALESCE(MAX(id),0) FROM nx_event_outbox",
    );
    const b3Result = await executeB3Lifecycle(pageOne, writerOne);
    createdViewNames.push(...b3Result.createdViewNames);
    evidence.b3 = b3Result;

    evidence.databaseEvidenceBeforeRestore = await collectDatabaseEvidence(
      mysqlPassword,
      database,
      writerOneId,
      writerTwoId,
      auditBaseline,
      outboxBaseline,
      b3OutboxBaseline,
      a2TicketBaseline,
      createdViewNames,
    );
    const readOnlyAfter = await bReadChain(pageOne);
    evidence.makerJ1DeniedAfter = await assertJ1Denied(pageOne, "maker after");
    const j1CanonicalAfter = await assertJ1CanonicalFromDatabase(
      mysqlPassword,
      database,
      readOnlyAfter.b5,
    );
    expect(
      j1CanonicalAfter,
      "B2/B3 writes must not change canonical J1 gate state",
    ).toEqual(j1CanonicalBefore);
    evidence.secondWriterReadBoundaryAfter = await assertSecondWriterReadBoundary(pageTwo);
    const immutableSafetyAfter = immutableSafetyProjection(readOnlyAfter);
    expect(
      immutableSafetyAfter,
      "B2/B3 lifecycle must not acknowledge B1 alerts or change B1/B5/J1 safety state",
    ).toEqual(immutableSafetyBefore);
    evidence.readOnlyCrossDomainAfter = readOnlyAfter;
    evidence.j1CanonicalAfter = j1CanonicalAfter;
    evidence.immutableSafetyAfter = immutableSafetyAfter;
  } catch (error) {
    mutableFailure = error;
    evidence.executionFailure = serializeError(error);
  } finally {
    const cleanupErrors: unknown[] = [];
    if (configSnapshotTaken) {
      try {
        await restoreConfig(mysqlPassword, database, configBefore);
      } catch (error) {
        cleanupErrors.push(error);
        evidence.configRestoreFailure = serializeError(error);
      }
    }
    try {
      await deleteRunViews(mysqlPassword, database);
    } catch (error) {
      cleanupErrors.push(error);
      evidence.viewCleanupFailure = serializeError(error);
    }
    try {
      if (configSnapshotTaken) {
        configAfterRestore = await snapshotConfig(mysqlPassword, database);
        expect(configAfterRestore, "all forecast-config rows must match the exact pre-run snapshot")
          .toEqual(configBefore);
      }
    } catch (error) {
      cleanupErrors.push(error);
      evidence.configRestoreVerificationFailure = serializeError(error);
    }
    let remainingViews: number | null = null;
    try {
      remainingViews = await countRunViews(mysqlPassword, database);
      expect(remainingViews, "all run-prefixed mutable B3 rows must be removed").toBe(0);
    } catch (error) {
      cleanupErrors.push(error);
      evidence.viewCleanupVerificationFailure = serializeError(error);
    }
    try {
      evidence.cleanup = {
        configExact: configSnapshotTaken
          && JSON.stringify(configAfterRestore) === JSON.stringify(configBefore),
        remainingRunViews: remainingViews,
        retainedAudit: true,
        retainedOutbox: true,
        retainedIdempotency: true,
      };
    } catch (error) {
      cleanupErrors.push(error);
      evidence.cleanupEvidenceFailure = serializeError(error);
    }
    if (cleanupErrors.length > 0) {
      cleanupFailure = new AggregateError(cleanupErrors, "B_CHILD_CLEANUP_INCOMPLETE");
      evidence.cleanupFailure = serializeError(cleanupFailure);
    }

    await Promise.allSettled([contextOne.close(), contextTwo.close()]);
    await writeFile(
      path.join(evidenceDir, "b-child-write-lifecycle.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
  }

  if (cleanupFailure) throw cleanupFailure;
  if (mutableFailure) throw mutableFailure;

  // Refresh/relogin proof happens only after the mutable fixture is restored.
  const relogin = await browser.newContext();
  try {
    const page = await relogin.newPage();
    await login(page, writerOne);
    const finalReads = await bReadChain(page);
    await writeFile(
      path.join(evidenceDir, "b-refresh-relogin-final-read.json"),
      `${JSON.stringify(finalReads, null, 2)}\n`,
      "utf8",
    );
  } finally {
    await relogin.close();
  }
});

async function executeB2Lifecycle(
  writerOnePage: Page,
  writerTwoPage: Page,
  writerOne: Account,
  writerTwo: Account,
) {
  const initial = await apiEvidence(
    await writerOnePage.request.get("/api/admin/treasury/forecast-config"),
  );
  expect(initial.status).toBe(200);
  const initialVersion = finiteInteger(initial.body?.data?.version, "B2 initial version");
  const original = candidateConfig(initial.body?.data);
  const changed = { ...original, trialStressEnabled: !original.trialStressEnabled };
  const firstKey = acceptanceKey("b2", "writer-1");
  const secondKey = acceptanceKey("b2", "writer-2");
  const firstBody = {
    ...changed,
    expectedVersion: initialVersion,
    reason: `${RUN_ID} B2 concurrent writer one`,
    operator: writerOne.username,
  };
  const secondBody = {
    ...changed,
    expectedVersion: initialVersion,
    reason: `${RUN_ID} B2 concurrent writer two`,
    operator: writerTwo.username,
  };

  const [first, second] = await Promise.all([
    putForecast(writerOnePage, firstKey, firstBody),
    putForecast(writerTwoPage, secondKey, secondBody),
  ]);
  expect([first.status, second.status].sort()).toEqual([200, 409]);
  const winner = first.status === 200
    ? { page: writerOnePage, key: firstKey, body: firstBody, response: first }
    : { page: writerTwoPage, key: secondKey, body: secondBody, response: second };
  const loser = first.status === 409 ? first : second;
  expect(loser.body?.message).toBe("D3_FORECAST_CONFIG_VERSION_CONFLICT");

  const replay = await putForecast(winner.page, winner.key, winner.body);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(winner.response.body);
  const mismatch = await putForecast(winner.page, winner.key, {
    ...winner.body,
    reason: `${winner.body.reason} mismatch`,
  });
  expect(mismatch.status).toBe(409);
  expect(mismatch.body?.message).toBe("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");

  const refreshed = await apiEvidence(
    await writerOnePage.request.get("/api/admin/treasury/forecast-config"),
  );
  expect(refreshed.status).toBe(200);
  expect(finiteInteger(refreshed.body?.data?.version, "B2 version after CAS"))
    .toBe(initialVersion + 1);
  expect(candidateConfig(refreshed.body?.data)).toEqual(changed);

  const unknownKey = acceptanceKey("b2", "unknown");
  const unknownBody = {
    ...changed,
    genesisIncluded: !changed.genesisIncluded,
    expectedVersion: initialVersion + 1,
    reason: `${RUN_ID} B2 deliberately abandoned response`,
    operator: writerOne.username,
  };
  const abandoned = await commitThenAbandonResponse(
    writerOnePage,
    "/api/admin/treasury/forecast-config",
    unknownKey,
    unknownBody,
    "PUT",
  );
  expect(abandoned.serverResponse.status).toBe(200);
  const recovered = await retrySameKey(writerOnePage, unknownKey, unknownBody, "PUT");
  expect(recovered.status).toBe(200);
  expect(recovered.body).toEqual(abandoned.serverResponse.body);

  const afterUnknown = await apiEvidence(
    await writerTwoPage.request.get("/api/admin/treasury/forecast-config"),
  );
  expect(afterUnknown.status).toBe(200);
  expect(finiteInteger(afterUnknown.body?.data?.version, "B2 version after unknown recovery"))
    .toBe(initialVersion + 2);

  return {
    initial,
    initialVersion,
    original,
    changed,
    concurrent: { first, second },
    replay,
    mismatch,
    refreshed,
    unknown: {
      key: unknownKey,
      clientObservation: abandoned.clientObservation,
      serverResponse: abandoned.serverResponse,
      recovered,
      afterUnknown,
    },
  };
}

async function executeB3Lifecycle(page: Page, writer: Account) {
  const stableName = `${B3_VIEW_PREFIX}stable`;
  const unknownName = `${B3_VIEW_PREFIX}unknown`;
  const stableKey = acceptanceKey("b3", "stable");
  const stableBody = {
    name: stableName,
    cohort: "ALL",
    phase: "ALL",
    ref: "ALL",
    granularity: "WEEK",
    comparison: "PREVIOUS",
  };
  const first = await postView(page, stableKey, stableBody);
  expect(first.status).toBe(200);
  expect(first.body?.data?.replayed).toBe(false);
  const replay = await postView(page, stableKey, stableBody);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(first.body);
  const mismatch = await postView(page, stableKey, {
    ...stableBody,
    comparison: "YEAR_OVER_YEAR",
  });
  expect(mismatch.status).toBe(409);
  expect(mismatch.body?.message).toBe("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
  const nameConflict = await postView(page, acceptanceKey("b3", "name-conflict"), {
    ...stableBody,
    comparison: "YEAR_OVER_YEAR",
  });
  expect(nameConflict.status).toBe(409);
  expect(nameConflict.body?.message).toBe("B3_VIEW_NAME_CONFLICT");

  const unknownKey = acceptanceKey("b3", "unknown");
  const unknownBody = {
    ...stableBody,
    name: unknownName,
    granularity: "MONTH",
  };
  const abandoned = await commitThenAbandonResponse(
    page,
    "/api/admin/funnel/view",
    unknownKey,
    unknownBody,
    "POST",
  );
  expect(abandoned.serverResponse.status).toBe(200);
  const recovered = await retrySameKey(page, unknownKey, unknownBody, "POST");
  expect(recovered.status).toBe(200);
  expect(recovered.body).toEqual(abandoned.serverResponse.body);

  const list = await apiEvidence(await page.request.get("/api/admin/funnel"));
  expect(list.status).toBe(200);
  const savedNames = (list.body?.data?.savedViews ?? []).map((entry: any) => entry?.name);
  expect(savedNames).toEqual(expect.arrayContaining([stableName, unknownName]));

  return {
    actor: writer.username,
    createdViewNames: [stableName, unknownName],
    first,
    replay,
    mismatch,
    nameConflict,
    unknown: {
      key: unknownKey,
      clientObservation: abandoned.clientObservation,
      serverResponse: abandoned.serverResponse,
      recovered,
    },
    list,
  };
}

async function assertNoWriteRolesFailClosed(
  fixture: Fixture,
  browser: Browser,
  evidence: Record<string, unknown>,
) {
  const results: Record<string, unknown> = {};
  for (const [label, raw] of [
    ["readonly", fixture.accounts?.readonly],
    ["nowrite", fixture.accounts?.nowrite],
    ["nomenu", fixture.accounts?.nomenu],
  ] as const) {
    const account = requiredAccount(raw, `accounts.${label}`);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await login(page, account);
      const reads = await permissionReads(page);
      const { forecast, view } = await permissionWriteDenials(
        page,
        label,
        account.username,
      );
      expect(forecast.status, `${label} B2 write`).toBe(403);
      expect(view.status, `${label} B3 write`).toBe(403);
      if (label === "nomenu") {
        for (const [key, response] of Object.entries(reads)) {
          expect(response.status, `nomenu ${key} read`).toBe(403);
        }
        await assertNoBMenuOrDirectRoute(page);
        await visibleLogout(page);
        await login(page, account);
        await assertNoBMenuOrDirectRoute(page);
        const reloginReads = await permissionReads(page);
        for (const [key, response] of Object.entries(reloginReads)) {
          expect(response.status, `nomenu ${key} read after relogin`).toBe(403);
        }
        const reloginWrites = await permissionWriteDenials(
          page,
          `${label}-relogin`,
          account.username,
        );
        expect(reloginWrites.forecast.status, "nomenu B2 write after relogin").toBe(403);
        expect(reloginWrites.view.status, "nomenu B3 write after relogin").toBe(403);
        results[label] = {
          username: account.username,
          reads,
          forecast,
          view,
          visibleMenuCount: 0,
          directRouteDenied: true,
          refreshRelogin: { reads: reloginReads, writes: reloginWrites },
        };
      } else {
        for (const key of ["b1", "b2", "b3", "b4", "b5"] as const) {
          expect(reads[key].status, `${label} ${key} read`).toBe(200);
        }
        expect(
          reads.j1.status,
          `${label} J1 cross-domain read must remain denied by the B-only role`,
        ).toBe(403);
        results[label] = { username: account.username, reads, forecast, view };
      }
    } finally {
      await context.close();
    }
  }
  evidence.permissionDenials = results;
}

const PERMISSION_READ_ENDPOINTS = {
  b1: "/api/admin/treasury/b-domain",
  b2: "/api/admin/treasury/forecast-config",
  b3: "/api/admin/funnel",
  b4: "/api/admin/phase/overview?granularity=PHASE",
  b5: "/api/admin/risk/radar",
  j1: "/api/admin/emergency/kill-switches",
} as const;

async function permissionReads(page: Page) {
  return Object.fromEntries(await Promise.all(
    Object.entries(PERMISSION_READ_ENDPOINTS).map(async ([key, endpoint]) => [
      key,
      await apiEvidence(await page.request.get(endpoint)),
    ] as const),
  )) as Record<keyof typeof PERMISSION_READ_ENDPOINTS, ApiEvidence>;
}

async function permissionWriteDenials(page: Page, label: string, username: string) {
  const forecast = await apiEvidence(
    await page.request.put("/api/admin/treasury/forecast-config", {
      headers: keyed(acceptanceKey("b2", `${label}-deny`)),
      data: {
        reserveCategories: { usdt: true, otherLiquid: true },
        liabilityCategories: {
          withdrawable_balance: true,
          usdt_staking_principal: true,
          staking_interest: true,
          genesis_daily_emission: true,
          nex_v2_future: true,
          withdrawal_queue: true,
          commission_cooling: true,
          lock_other: true,
          unverified_deposit: true,
        },
        forecastWindow: "30d",
        genesisIncluded: true,
        includeFarLiabilities: true,
        stakingInterestMode: "LINEAR",
        trialStressEnabled: true,
        expectedVersion: 0,
        reason: `${RUN_ID} permission denial only`,
        operator: username,
      },
    }),
  );
  const view = await apiEvidence(
    await page.request.post("/api/admin/funnel/view", {
      headers: keyed(acceptanceKey("b3", `${label}-deny`)),
      data: {
        name: `${B3_VIEW_PREFIX}${label}-deny`,
        cohort: "ALL",
        phase: "ALL",
        ref: "ALL",
        granularity: "WEEK",
        comparison: "PREVIOUS",
      },
    }),
  );
  return { forecast, view };
}

async function assertNoBMenuOrDirectRoute(page: Page) {
  await expect(page.locator('aside a[href^="/overview/"]')).toHaveCount(0);
  await page.goto("/overview/dual-ledger", { waitUntil: "domcontentloaded" });
  await expect.poll(
    () => new URL(page.url()).pathname,
    { message: "nomenu direct B route must redirect", timeout: 15_000 },
  ).not.toBe("/overview/dual-ledger");
  await page.goto("/overview/dual-ledger", { waitUntil: "commit" });
  expect(
    new URL(page.url()).pathname,
    "refresh probe must begin on the original forbidden B route",
  ).toBe("/overview/dual-ledger");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(
    () => new URL(page.url()).pathname,
    { message: "nomenu original B route must remain denied after real refresh", timeout: 15_000 },
  ).not.toBe("/overview/dual-ledger");
  await expect(page.locator('aside a[href^="/overview/"]')).toHaveCount(0);
}

async function visibleLogout(page: Page) {
  await page.locator('header button[aria-haspopup="menu"]').last().click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

async function bReadChain(page: Page) {
  const endpoints = {
    b1: "/api/admin/treasury/b-domain",
    b2: "/api/admin/treasury/forecast-config",
    b3: "/api/admin/funnel",
    b4: "/api/admin/phase/overview?granularity=PHASE",
    b5: "/api/admin/risk/radar",
  };
  const entries = await Promise.all(
    Object.entries(endpoints).map(async ([key, endpoint]) => {
      const response = await apiEvidence(await page.request.get(endpoint));
      expect(response.status, endpoint).toBe(200);
      return [key, response] as const;
    }),
  );
  const result = Object.fromEntries(entries);
  return result;
}

async function assertJ1Denied(page: Page, label: string) {
  const response = await apiEvidence(
    await page.request.get("/api/admin/emergency/kill-switches"),
  );
  expect(response.status, `${label} J1 read must remain cross-domain denied`).toBe(403);
  return response;
}

async function assertJ1CanonicalFromDatabase(
  password: string,
  database: string,
  b5Evidence: ApiEvidence,
) {
  const rows = await queryJsonRows(password, database, `
    SELECT REPLACE(TO_BASE64(CAST(JSON_OBJECT(
      'settingKey', setting_key, 'settingValue', setting_value
    ) AS CHAR CHARACTER SET utf8mb4)), CHAR(10), '')
    FROM nx_emergency_control_setting
    WHERE is_deleted=0
      AND setting_key IN (
        'killswitch.withdraw','killswitch.exchange','killswitch.staking',
        'killswitch.genesis','killswitch.trial',
        'emergency.killswitch.withdraw','emergency.killswitch.exchange',
        'J.killswitch.staking','J.killswitch.genesis','emergency.killswitch.trial'
      )
    ORDER BY setting_key
  `) as Array<{ settingKey: string; settingValue: string }>;
  const values = new Map(rows.map((row) => [row.settingKey, row.settingValue]));
  const gates = b5Evidence.body?.data?.killSwitches ?? [];
  expect(gates, "B5 must expose all five canonical J1-backed gates").toHaveLength(5);
  const canonical = gates.map((gate: any) => {
    expect(typeof gate?.key, "raw /risk/radar gate.key contract").toBe("string");
    expect(typeof gate?.enabled, "raw /risk/radar gate.enabled contract").toBe("boolean");
    const key = String(gate.key);
    expect(["withdraw", "exchange", "staking", "genesis", "trial"]).toContain(key);
    const primaryKey = `killswitch.${key}`;
    const legacyKey = ["staking", "genesis"].includes(key)
      ? `J.killswitch.${key}`
      : `emergency.killswitch.${key}`;
    const raw = values.get(primaryKey) ?? values.get(legacyKey);
    const enabled = raw === undefined
      ? true
      : ["enabled", "enable", "on", "true", "1"].includes(raw.trim().toLowerCase());
    expect(gate.enabled, `B5 ${key} must match J1 canonical DB state`).toBe(enabled);
    return {
      key,
      enabled,
      sourceKey: values.has(primaryKey)
        ? primaryKey
        : values.has(legacyKey) ? legacyKey : primaryKey,
      sourceValue: raw ?? null,
    };
  }).sort((left: any, right: any) => left.key.localeCompare(right.key));
  return {
    sourceTable: "nx_emergency_control_setting",
    parserContract: "KillSwitchState.enabled(primary, legacy), missing defaults enabled",
    gates: canonical,
  };
}

async function assertSecondWriterReadBoundary(page: Page) {
  const allowed = {
    b2: "/api/admin/treasury/forecast-config",
    b3: "/api/admin/funnel",
  };
  const denied = {
    b1: "/api/admin/treasury/b-domain",
    b4: "/api/admin/phase/overview?granularity=PHASE",
    b5: "/api/admin/risk/radar",
    j1: "/api/admin/emergency/kill-switches",
  };
  const allowedEvidence: Record<string, ApiEvidence> = {};
  for (const [key, endpoint] of Object.entries(allowed)) {
    const response = await apiEvidence(await page.request.get(endpoint));
    expect(response.status, `minimal secondWriter ${key} read`).toBe(200);
    allowedEvidence[key] = response;
  }
  const deniedEvidence: Record<string, ApiEvidence> = {};
  for (const [key, endpoint] of Object.entries(denied)) {
    const response = await apiEvidence(await page.request.get(endpoint));
    expect(response.status, `minimal secondWriter ${key} cross-domain read`).toBe(403);
    deniedEvidence[key] = response;
  }
  return { allowed: allowedEvidence, denied: deniedEvidence };
}

function immutableSafetyProjection(reads: Record<string, ApiEvidence>) {
  const b1 = reads.b1.body?.data ?? {};
  const b1Snapshot = b1.dualLedger?.snapshot ?? {};
  const b5 = reads.b5.body?.data ?? {};
  const bankrun = b5.bankrun ?? {};
  const coverage = b5.coverage ?? {};
  const gates = (b5.killSwitches ?? [])
    .map((gate: any) => {
      expect(typeof gate?.key, "raw /risk/radar gate.key safety projection").toBe("string");
      expect(typeof gate?.enabled, "raw /risk/radar gate.enabled safety projection")
        .toBe("boolean");
      return { key: gate.key, enabled: gate.enabled };
    })
    .sort((left: any, right: any) => String(left.key).localeCompare(String(right.key)));
  return {
    b1: {
      coverageRedlineAcked: Boolean(b1.alerts?.coverageRedlineAcked),
      reserveUsd: b1Snapshot.reserveUsd,
      liabilitiesUsd: b1Snapshot.liabilitiesUsd,
      coverageRatio: b1Snapshot.coverageRatio,
      queueBacklogUsd: b1Snapshot.queueBacklogUsd,
      queueBacklogCount: b1Snapshot.queueBacklogCount,
      accounts: (b1.dualLedger?.accounts ?? [])
        .map((account: any) => ({
          key: account?.key,
          amount: account?.amount,
          source: account?.source,
        }))
        .sort((left: any, right: any) => String(left.key).localeCompare(String(right.key))),
      redlinePct: b1Snapshot.redlinePct,
      healthyPct: b1Snapshot.healthyPct,
      runRiskPct: b1Snapshot.runRiskPct,
    },
    b5: {
      yellowPct: bankrun.yellowPct,
      redPct: bankrun.redPct,
      thresholdVersion: bankrun.version,
      coverageRedlinePct: coverage.redlinePct,
    },
    j1Gates: gates,
  };
}

async function collectDatabaseEvidence(
  password: string,
  database: string,
  writerOneId: number,
  writerTwoId: number,
  auditBaseline: number,
  outboxBaseline: number,
  b3OutboxBaseline: number,
  a2TicketBaseline: number,
  viewNames: string[],
) {
  const keyPrefix = `%${sqlLikeLiteral(RUN_ID)}%`;
  const viewList = viewNames.map(sqlString).join(",");
  const audit = await queryJsonRows(password, database, `
    SELECT REPLACE(TO_BASE64(CAST(JSON_OBJECT(
      'id', id, 'action', action, 'resourceType', resource_type,
      'resourceId', resource_id, 'actorId', actor_id,
      'actorUsername', actor_username, 'detail', detail_json,
      'createdAt', DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s')
    ) AS CHAR CHARACTER SET utf8mb4)), CHAR(10), '')
    FROM nx_audit_log
    WHERE id>${auditBaseline}
      AND is_deleted=0
      AND (
        (action='D3_FORECAST_CONFIG_CHANGED' AND JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.reason')) LIKE ${sqlString(keyPrefix)})
        OR
        (action='ADMIN.FUNNEL_VIEW_SAVED' AND JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.name')) IN (${viewList}))
      )
    ORDER BY id
  `);
  const outbox = await queryJsonRows(password, database, `
    SELECT REPLACE(TO_BASE64(CAST(JSON_OBJECT(
      'id', id, 'eventId', event_id, 'aggregateType', aggregate_type,
      'aggregateId', aggregate_id, 'eventType', event_type,
      'status', status, 'payload', payload
    ) AS CHAR CHARACTER SET utf8mb4)), CHAR(10), '')
    FROM nx_event_outbox
    WHERE id>${outboxBaseline}
      AND is_deleted=0
      AND (
        event_type='admin.treasury_forecast_config_changed'
        OR (id>${b3OutboxBaseline} AND CAST(payload AS CHAR) LIKE ${sqlString(keyPrefix)})
      )
    ORDER BY id
  `);
  const idempotency = await queryJsonRows(password, database, `
    SELECT REPLACE(TO_BASE64(CAST(JSON_OBJECT(
      'id', id, 'scope', scope, 'key', idempotency_key,
      'requestHash', request_hash, 'status', status,
      'errorMessage', error_message
    ) AS CHAR CHARACTER SET utf8mb4)), CHAR(10), '')
    FROM nx_admin_idempotency_record
    WHERE is_deleted=0
      AND scope IN ('D3_FORECAST_CONFIG_UPDATE','B3_FUNNEL_VIEW')
      AND (
        idempotency_key LIKE ${sqlString(`b2-${IDEMPOTENCY_NAMESPACE}-%`)}
        OR idempotency_key LIKE ${sqlString(`b3-${IDEMPOTENCY_NAMESPACE}-%`)}
      )
    ORDER BY id
  `);
  const views = await queryJsonRows(password, database, `
    SELECT REPLACE(TO_BASE64(CAST(JSON_OBJECT(
      'id', id, 'adminId', admin_id, 'name', view_name,
      'cohort', cohort, 'phase', phase, 'ref', ref_code,
      'granularity', granularity, 'comparison', comparison,
      'isDeleted', is_deleted
    ) AS CHAR CHARACTER SET utf8mb4)), CHAR(10), '')
    FROM nx_admin_funnel_view
    WHERE admin_id IN (${writerOneId},${writerTwoId})
      AND view_name LIKE ${sqlString(`${B3_VIEW_PREFIX}%`)}
    ORDER BY id
  `);
  const a2Tickets = await queryJsonRows(password, database, `
    SELECT REPLACE(TO_BASE64(CAST(JSON_OBJECT(
      'id', id, 'operationId', operation_id, 'action', action,
      'status', status, 'reason', reason, 'sourceDomain', source_domain
    ) AS CHAR CHARACTER SET utf8mb4)), CHAR(10), '')
    FROM nx_audit_operation_ticket
    WHERE id>${a2TicketBaseline}
      AND is_deleted=0
      AND (
        reason LIKE ${sqlString(`%${RUN_ID}%`)}
        OR command_json LIKE ${sqlString(`%${RUN_ID}%`)}
      )
    ORDER BY id
  `);

  expect(audit.filter((row: any) => row.action === "D3_FORECAST_CONFIG_CHANGED").length)
    .toBe(2);
  expect(audit.filter((row: any) => row.action === "ADMIN.FUNNEL_VIEW_SAVED").length)
    .toBe(2);
  expect(outbox.filter((row: any) => row.eventType === "admin.treasury_forecast_config_changed").length)
    .toBe(2);
  expect(
    outbox.filter((row: any) => row.id > b3OutboxBaseline
      && JSON.stringify(row.payload ?? {}).includes(B3_VIEW_PREFIX)).length,
    "B3 save-view does not publish an outbox event",
  ).toBe(0);
  expect(idempotency.filter((row: any) => row.status === "SUCCEEDED").length)
    .toBe(4);
  expect(views).toHaveLength(2);
  expect(a2Tickets, "B2/B3 direct writes must not manufacture A2 proposal tickets").toHaveLength(0);
  return { audit, outbox, idempotency, views, a2Tickets };
}

async function assertWriterAuthorities(page: Page, username: string) {
  const response = await apiEvidence(await page.request.get("/api/admin/auth/session"));
  expect(response.status, `${username} session`).toBe(200);
  const session = response.body?.data?.session ?? response.body?.data ?? {};
  const authorities: string[] = session.authorities ?? [];
  expect(
    authorities.some((authority) => authority === "overview_b2_write" || authority === "finance_d3_write"),
    `${username} must have B2 forecast write`,
  ).toBe(true);
  expect(authorities, `${username} must have B3 personal-view write`)
    .toContain("overview_b3_view_write");
  return {
    adminId: session.adminId ?? session.id,
    username: session.username ?? username,
    authorities: authorities.filter((authority) => authority.startsWith("overview_b")),
  };
}

async function assertBackendUsesChildDatabase(
  page: Page,
  password: string,
  database: string,
) {
  const before = await snapshotConfigExactKey(password, database, DATASOURCE_SENTINEL_KEY);
  const sentinel = `child:${RUN_ID}:${Date.now()}`;
  let observed: ApiEvidence | null = null;
  let failure: unknown;
  try {
    await mysqlExec(password, database, `
      INSERT INTO nx_config_item(
        config_key,config_value,value_type,config_group,visibility,remark,status,
        created_at,updated_at,is_deleted
      ) VALUES (
        ${sqlString(DATASOURCE_SENTINEL_KEY)},${sqlString(sentinel)},'STRING',
        'admin_feature_flag','ADMIN','B child datasource sentinel',1,NOW(),NOW(),0
      )
      ON DUPLICATE KEY UPDATE
        config_value=VALUES(config_value),value_type=VALUES(value_type),
        config_group=VALUES(config_group),visibility=VALUES(visibility),
        remark=VALUES(remark),status=1,updated_at=NOW(),is_deleted=0
    `);
    observed = await apiEvidence(await page.request.get("/api/admin/platform/flags/runtime"));
    expect(observed.status, "BFF/backend datasource sentinel endpoint").toBe(200);
    expect(
      observed.body?.data?.value,
      "child PC -> child backend must read the same named child DB used by cleanup",
    ).toBe(sentinel);
  } catch (error) {
    failure = error;
  } finally {
    await restoreConfigExactKey(password, database, DATASOURCE_SENTINEL_KEY, before);
  }
  const restored = await snapshotConfigExactKey(password, database, DATASOURCE_SENTINEL_KEY);
  expect(restored, "datasource sentinel row must be restored exactly").toEqual(before);
  if (failure) throw failure;
  return {
    database,
    sentinelKey: DATASOURCE_SENTINEL_KEY,
    sentinelHash: createHash("sha256").update(sentinel).digest("hex"),
    observed,
    restoredExact: true,
  };
}

async function retrySameKey(
  page: Page,
  key: string,
  body: Record<string, unknown>,
  method: "PUT" | "POST",
) {
  let last: ApiEvidence | null = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = method === "PUT"
      ? await putForecast(page, key, body)
      : await postView(page, key, body);
    last = response;
    if (response.status === 200) return response;
    expect(response.status).toBe(409);
    expect(["IDEMPOTENCY_REQUEST_IN_PROGRESS", "IDEMPOTENCY_KEY_IN_PROGRESS"])
      .toContain(response.body?.message);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`same-key recovery did not converge: ${JSON.stringify(last)}`);
}

async function commitThenAbandonResponse(
  page: Page,
  endpoint: string,
  key: string,
  body: Record<string, unknown>,
  method: "PUT" | "POST",
): Promise<AbandonedResponseEvidence> {
  const routePattern = `**${endpoint}`;
  let resolveServerResponse!: (value: ApiEvidence) => void;
  let rejectServerResponse!: (reason: unknown) => void;
  let releaseHeldRoute!: () => void;
  let matchedRequests = 0;
  const serverResponsePromise = new Promise<ApiEvidence>((resolve, reject) => {
    resolveServerResponse = resolve;
    rejectServerResponse = reject;
  });
  const heldRoute = new Promise<void>((resolve) => {
    releaseHeldRoute = resolve;
  });
  const handler = async (route: Route) => {
    const request = route.request();
    const requestKey = await request.headerValue("Idempotency-Key");
    if (request.method() !== method || requestKey !== key) {
      await route.continue();
      return;
    }
    matchedRequests += 1;
    try {
      const upstream = await route.fetch();
      const serverResponse = await apiEvidence(upstream);
      resolveServerResponse(serverResponse);
      await heldRoute;
      await route.abort("aborted").catch(() => undefined);
    } catch (error) {
      rejectServerResponse(error);
      await route.abort("aborted").catch(() => undefined);
    }
  };

  await page.route(routePattern, handler);
  try {
    const clientPromise = page.evaluate(async ({ endpoint: target, key: requestKey, body: payload, method: verb }) => {
      const controller = new AbortController();
      const carrierWindow = window as Window & {
        __nexionBUnknownAbort?: AbortController;
      };
      carrierWindow.__nexionBUnknownAbort = controller;
      try {
        const response = await fetch(target, {
          method: verb,
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": requestKey,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        return {
          kind: "response" as const,
          status: response.status,
          name: "",
          message: "",
        };
      } catch (error) {
        return {
          kind: "error" as const,
          status: null,
          name: error instanceof Error ? error.name : "UnknownError",
          message: error instanceof Error ? error.message : String(error),
        };
      } finally {
        delete carrierWindow.__nexionBUnknownAbort;
      }
    }, { endpoint, key, body, method });

    let commitTimeout: ReturnType<typeof setTimeout> | undefined;
    const serverResponse = await Promise.race([
      serverResponsePromise,
      new Promise<never>((_, reject) => {
        commitTimeout = setTimeout(
          () => reject(new Error(`server did not commit ${method} ${endpoint}`)),
          30_000,
        );
      }),
    ]).finally(() => {
      if (commitTimeout) clearTimeout(commitTimeout);
    });
    expect(matchedRequests, "unknown-outcome carrier must send exactly one original request").toBe(1);
    expect(serverResponse.status, "server must commit before the client loses the response").toBe(200);

    await page.evaluate(() => {
      const carrierWindow = window as Window & {
        __nexionBUnknownAbort?: AbortController;
      };
      carrierWindow.__nexionBUnknownAbort?.abort();
    });
    const clientObservation = await clientPromise;
    expect(clientObservation.kind, "client must not receive the committed HTTP response").toBe("error");
    if (clientObservation.kind !== "error") {
      throw new Error(`client unexpectedly received HTTP ${clientObservation.status}`);
    }
    expect(clientObservation.status, "client must observe no HTTP status").toBeNull();
    expect(clientObservation.name, "client response loss must be a real AbortController failure")
      .toBe("AbortError");
    return {
      serverResponse,
      clientObservation: {
        kind: clientObservation.kind,
        name: clientObservation.name,
        message: clientObservation.message,
      },
    };
  } finally {
    releaseHeldRoute();
    await page.unroute(routePattern, handler);
  }
}

async function putForecast(page: Page, key: string, body: Record<string, unknown>) {
  return apiEvidence(await page.request.put("/api/admin/treasury/forecast-config", {
    headers: keyed(key),
    data: body,
  }));
}

async function postView(page: Page, key: string, body: Record<string, unknown>) {
  return apiEvidence(await page.request.post("/api/admin/funnel/view", {
    headers: keyed(key),
    data: body,
  }));
}

function candidateConfig(data: Record<string, any>) {
  const candidate = data?.pendingConfig ?? data;
  return {
    reserveCategories: candidate.reserveCategories,
    liabilityCategories: candidate.liabilityCategories,
    forecastWindow: candidate.forecastWindow,
    genesisIncluded: candidate.genesisIncluded,
    includeFarLiabilities: candidate.includeFarLiabilities,
    stakingInterestMode: candidate.stakingInterestMode,
    trialStressEnabled: candidate.trialStressEnabled,
  };
}

function acceptanceKey(scope: "b2" | "b3", caseName: string) {
  if (!/^[a-z0-9-]+$/.test(caseName)) {
    throw new Error(`INVALID_IDEMPOTENCY_CASE:${caseName}`);
  }
  return `${scope}-${IDEMPOTENCY_NAMESPACE}-${caseName}`;
}

function keyed(idempotencyKey: string) {
  return { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey };
}

async function apiEvidence(response: APIResponse): Promise<ApiEvidence> {
  const text = await response.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return {
    status: response.status(),
    headers: {
      contentType: response.headers()["content-type"] ?? "",
      upstreamOutcome: response.headers()["x-nexion-upstream-outcome"] ?? "",
    },
    body,
  };
}

async function login(page: Page, account: Account) {
  const initialSession = page.waitForResponse((candidate) => {
    const request = candidate.request();
    return new URL(candidate.url()).pathname === "/api/admin/auth/session"
      && request.method() === "GET";
  }, { timeout: 20_000 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const shell = page.locator("aside");
  const username = page.locator('input[autocomplete="username"]');
  await initialSession;
  await Promise.any([
    shell.waitFor({ state: "visible", timeout: 8_000 }),
    username.waitFor({ state: "visible", timeout: 8_000 }),
  ]).catch(() => undefined);
  if (await shell.isVisible()) return;

  await username.fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  const loginResponse = page.waitForResponse((candidate) => {
    const request = candidate.request();
    return new URL(candidate.url()).pathname === "/api/admin/auth/login"
      && request.method() === "POST";
  }, { timeout: 20_000 });
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await loginResponse).status(), `${account.username} credential login`).toBe(200);
  const otp = page.getByLabel("一次性验证码");
  await Promise.any([
    shell.waitFor({ state: "visible", timeout: 20_000 }),
    otp.waitFor({ state: "visible", timeout: 20_000 }),
  ]);
  if (await shell.isVisible()) return;
  if (!account.totpSecret) throw new Error(`${account.username} requires a restricted TOTP secret`);
  await otp.fill(await stableTotp(account.totpSecret));
  const mfaResponse = page.waitForResponse((candidate) => {
    const request = candidate.request();
    return new URL(candidate.url()).pathname === "/api/admin/auth/mfa/verify"
      && request.method() === "POST";
  }, { timeout: 20_000 });
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  expect((await mfaResponse).status(), `${account.username} MFA verify`).toBe(200);
  await expect(shell).toBeVisible({ timeout: 30_000 });
}

function currentTotp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

const lastTotpStepBySecret = new Map<string, number>();

async function stableTotp(secret: string) {
  for (;;) {
    const now = Date.now();
    const step = Math.floor(now / 30_000);
    const remaining = 30_000 - (now % 30_000);
    if (remaining >= 3_000 && lastTotpStepBySecret.get(secret) !== step) {
      lastTotpStepBySecret.set(secret, step);
      return currentTotp(secret);
    }
    await new Promise((resolve) => setTimeout(resolve, remaining + 250));
  }
}

async function snapshotConfig(password: string, database: string): Promise<ConfigRow[]> {
  return snapshotConfigWhere(
    password,
    database,
    `config_key LIKE ${sqlString(`${CONFIG_PREFIX}%`)}`,
  );
}

async function snapshotConfigExactKey(
  password: string,
  database: string,
  configKey: string,
): Promise<ConfigRow[]> {
  return snapshotConfigWhere(password, database, `config_key=${sqlString(configKey)}`);
}

async function snapshotConfigWhere(
  password: string,
  database: string,
  predicate: string,
): Promise<ConfigRow[]> {
  return queryJsonRows(password, database, `
    SELECT REPLACE(TO_BASE64(CAST(JSON_OBJECT(
      'id', id, 'configKey', config_key, 'configValue', config_value,
      'valueType', value_type, 'configGroup', config_group,
      'visibility', visibility, 'remark', remark, 'status', status,
      'createdAt', DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s'),
      'updatedAt', DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s'),
      'isDeleted', is_deleted
    ) AS CHAR CHARACTER SET utf8mb4)), CHAR(10), '')
    FROM nx_config_item
    WHERE ${predicate}
    ORDER BY id
  `) as Promise<ConfigRow[]>;
}

async function restoreConfig(password: string, database: string, rows: ConfigRow[]) {
  const inserts = configInsertSql(rows);
  await mysqlExec(password, database, `
    START TRANSACTION;
    DELETE FROM nx_config_item WHERE config_key LIKE ${sqlString(`${CONFIG_PREFIX}%`)};
    ${inserts}
    COMMIT;
  `);
}

async function restoreConfigExactKey(
  password: string,
  database: string,
  configKey: string,
  rows: ConfigRow[],
) {
  const inserts = configInsertSql(rows);
  await mysqlExec(password, database, `
    START TRANSACTION;
    DELETE FROM nx_config_item WHERE config_key=${sqlString(configKey)};
    ${inserts}
    COMMIT;
  `);
}

function configInsertSql(rows: ConfigRow[]) {
  return rows.map((row) => `
    INSERT INTO nx_config_item(
      id,config_key,config_value,value_type,config_group,visibility,remark,status,
      created_at,updated_at,is_deleted
    ) VALUES (
      ${row.id},${sqlString(row.configKey)},${sqlNullable(row.configValue)},
      ${sqlNullable(row.valueType)},${sqlNullable(row.configGroup)},
      ${sqlNullable(row.visibility)},${sqlNullable(row.remark)},${row.status},
      ${sqlString(row.createdAt)},${sqlString(row.updatedAt)},${row.isDeleted}
    );
  `).join("\n");
}

async function deleteRunViews(password: string, database: string) {
  await mysqlExec(password, database, `
    DELETE FROM nx_admin_funnel_view
    WHERE view_name LIKE ${sqlString(`${B3_VIEW_PREFIX}%`)};
  `);
}

async function countRunViews(password: string, database: string) {
  return scalarNumber(password, database, `
    SELECT COUNT(*) FROM nx_admin_funnel_view
    WHERE view_name LIKE ${sqlString(`${B3_VIEW_PREFIX}%`)}
  `);
}

async function currentDatabase(password: string, database: string) {
  return (await mysqlExec(password, database, "SELECT DATABASE()")).trim();
}

async function scalarNumber(password: string, database: string, sql: string) {
  const value = Number((await mysqlExec(password, database, sql)).trim());
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid scalar: ${value}`);
  return value;
}

async function queryJsonRows(password: string, database: string, sql: string) {
  const raw = await mysqlExec(password, database, sql);
  if (!raw.trim()) return [];
  return raw.trim().split(/\r?\n/).map((line) => (
    JSON.parse(Buffer.from(line.trim(), "base64").toString("utf8"))
  ));
}

async function mysqlExec(password: string, database: string, sql: string) {
  return execFileSync(
    MYSQL_EXE,
    [
      "--default-character-set=utf8mb4",
      "--batch",
      "--raw",
      "--skip-column-names",
      "-uroot",
      "-D",
      database,
      "-e",
      sql,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, MYSQL_PWD: password },
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredAccount(account: Account | undefined, label: string): Account {
  if (!account?.username || !account.password) {
    throw new Error(`restricted fixture is missing ${label}`);
  }
  return account;
}

function accountId(account: Account) {
  const value = Number(account.accountId ?? account.id);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`fixture account ${account.username} has no safe numeric account id`);
  }
  return value;
}

function finiteInteger(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} is invalid`);
  return number;
}

function sqlString(value: string) {
  return `CONVERT(UNHEX('${Buffer.from(value, "utf8").toString("hex")}') USING utf8mb4)`;
}

function sqlNullable(value: string | null) {
  return value == null ? "NULL" : sqlString(value);
}

function sqlLikeLiteral(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function serializeError(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { value: String(error) };
}

function isPathInside(candidate: string, parent: string) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function sha256File(filePath: string) {
  const value = await readFile(filePath);
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}
