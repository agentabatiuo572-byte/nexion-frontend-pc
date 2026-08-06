import { createHash, createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

type Account = {
  username: string;
  password: string;
  totpSecret: string;
  authorities?: string[];
  effectiveMenus?: string[];
};

type OwnerFixture = {
  runId?: string;
  account?: Account;
  maker?: Account;
  accounts?: { maker?: Account };
};

type CheckerManifest = {
  runId?: string;
  account?: Account;
  checker?: Account;
  accounts?: { checker?: Account; m_checker?: Account };
  finalAccounts?: { m_checker?: Account };
};

type Envelope<T> = { code?: number; message?: string; data: T };
type Ticket = { ticketNo: string; status: string; priority: string; version: number; archived?: boolean; title?: string };
type TicketDetail = { ticket: Ticket; messages?: Array<{ content?: string }> };
type Conversation = { conversationNo: string; status: string; version: number; lastMessage?: string };
type ConversationDetail = {
  conversation: Conversation;
  messages?: Array<{ content?: string }>;
};
type Faq = {
  id: string;
  question: string;
  answer: string;
  category: string;
  surface: string;
  language: string;
  sortOrder: number;
  status: string;
  version: number;
};
type KnowledgeOverview = { faqs?: Faq[] };
type SessionEnvelope = {
  code?: number;
  data?: {
    session?: {
      username?: string;
      authorities?: string[];
      effectiveMenus?: string[];
    };
  };
};

const RUN_ID = process.env.M_FINAL2_RUN_ID ?? "pc-full-acceptance-20260729-114336";
const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const PC_BUILD_ID = process.env.M_FINAL2_EXPECTED_PC_BUILD_ID ?? "xNJR-cEeID2fPRwrRvOrb";
const BACKEND_JAR_SHA256 = (
  process.env.M_FINAL2_EXPECTED_BACKEND_JAR_SHA256
  ?? "B426C1ED9CFCE970F247D041A28DC7EDAFAC927C112AC0089755ACB70F954B3B"
).toUpperCase();
const OWNER_FIXTURE_PATH = restrictedEnvPath("M_FINAL2_OWNER_FIXTURE_PATH");
const CHECKER_MANIFEST_PATH = restrictedEnvPath("M_FINAL2_CHECKER_MANIFEST_PATH");
const EVIDENCE_DIR = restrictedEnvPath("M234_FINAL2_EVIDENCE_DIR");
const ownerFixture = JSON.parse(readFileSync(OWNER_FIXTURE_PATH, "utf8")) as OwnerFixture;
const checkerManifest = JSON.parse(readFileSync(CHECKER_MANIFEST_PATH, "utf8")) as CheckerManifest;
const maker = ownerFixture.account ?? ownerFixture.maker ?? ownerFixture.accounts?.maker;
const checker = checkerManifest.account
  ?? checkerManifest.checker
  ?? checkerManifest.accounts?.checker
  ?? checkerManifest.accounts?.m_checker
  ?? checkerManifest.finalAccounts?.m_checker;
const PREFIX = process.env.M234_FINAL2_PREFIX ?? `M-OWNER-final2-${Date.now()}`;
const RESULT_PATH = path.join(EVIDENCE_DIR, "m234-two-operator-result.restricted.json");

const M234_AUTHORITIES = [
  "service_m2_read",
  "service_m2_write",
  "service_m3_read",
  "service_m3_write",
  "service_m4_read",
  "service_m4_write",
];
const MAKER_EXACT_AUTHORITIES = [
  "platform_a2_read",
  ...M234_AUTHORITIES,
].sort();
const MAKER_EXACT_MENU_LEAVES = ["A2", "M2", "M3", "M4"].sort();
const CHECKER_EXACT_AUTHORITIES = [
  "platform_a2_read",
  "service_m1_read", "service_m1_write",
  "service_m2_read", "service_m2_write",
  "service_m3_read", "service_m3_write", "service_m3_timeout_manage",
  "service_m4_read", "service_m4_write",
  "service_m5_read", "service_m5_write",
].sort();
const CHECKER_EXACT_MENU_LEAVES = ["A2", "M1", "M2", "M3", "M4", "M5"].sort();

test.describe.configure({ mode: "serial", timeout: 420_000 });

test.beforeAll(() => {
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  expect(process.env.M_FINAL2_MFA_BYPASS, "final2 must use real MFA").toBe("false");
  const writeControlToken = process.env.M_WRITE_CONTROL_TOKEN?.trim();
  expect(writeControlToken, "M_WRITE_CONTROL_TOKEN is required").toBeTruthy();
  expect(process.env.M_WRITE_TOKEN?.trim()).toBe(writeControlToken);
  expect(process.env.M234_OBJECT_LOCK, "M2/M3/M4 object lock is required").toBe(`${RUN_ID}:M234`);
  expect(readFileSync(path.resolve(".next/BUILD_ID"), "utf8").trim()).toBe(PC_BUILD_ID);
  const jarPath = process.env.M_FINAL2_BACKEND_JAR_PATH?.trim();
  expect(jarPath, "M_FINAL2_BACKEND_JAR_PATH is required").toBeTruthy();
  expect(sha256File(path.resolve(jarPath!))).toBe(BACKEND_JAR_SHA256);
  expect(ownerFixture.runId).toBe(RUN_ID);
  expect(checkerManifest.runId).toBe(RUN_ID);
  expect(maker, "M-only maker is required").toBeTruthy();
  expect(checker, "M-only checker is required").toBeTruthy();
  expect(checker!.username).not.toBe(maker!.username);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("M2/M4: M-only maker/checker 双运营员 CAS、同键、结果未知及精确清理；M3 正向留给 SUPPORT 双坐席", async ({ browser }) => {
  let makerOperator: Awaited<ReturnType<typeof loginOperator>> | undefined;
  let checkerOperator: Awaited<ReturnType<typeof loginOperator>> | undefined;
  const evidence: Record<string, unknown> = {
    runId: RUN_ID,
    prefix: PREFIX,
    ownerFixtureSha256: sha256File(OWNER_FIXTURE_PATH),
    checkerManifestSha256: sha256File(CHECKER_MANIFEST_PATH),
    makerHash: sha256(maker!.username),
    checkerHash: sha256(checker!.username),
    startedAt: new Date().toISOString(),
    candidate: { pcBuildId: PC_BUILD_ID, backendJarSha256: BACKEND_JAR_SHA256 },
    mfaBypass: false,
  };
  const ids: { ticketNo?: string; conversationNo?: string; faqId?: string } = {};
  let cleanupErrors: string[] = [];

  try {
    makerOperator = await loginOperator(browser, maker!, "maker");
    checkerOperator = await loginOperator(browser, checker!, "checker");
    await assertVisibleModules(makerOperator.page);
    await assertVisibleModules(checkerOperator.page);

    evidence.m2 = await verifyM2(makerOperator.page, checkerOperator.page, ids);
    evidence.m3 = {
      skipped: true,
      reason: "backend supportOperators/currentAssignableSupportAgent require role=SUPPORT; custom M-only accounts are negative-RBAC actors only",
    };
    evidence.m4 = await verifyM4(makerOperator.page, checkerOperator.page, ids);

    await makerOperator.page.reload({ waitUntil: "domcontentloaded" });
    await checkerOperator.page.reload({ waitUntil: "domcontentloaded" });
    evidence.refreshStable = true;
  } finally {
    if (makerOperator) {
      const cleanup = await cleanupAll(makerOperator.page.request, ids);
      evidence.cleanup = cleanup;
      cleanupErrors = cleanup.errors;
    } else {
      evidence.cleanup = { errors: [], skipped: "maker login did not complete; no business object was created" };
    }
    if (makerOperator) await logout(makerOperator.page).catch(() => undefined);
    if (checkerOperator) await logout(checkerOperator.page).catch(() => undefined);
    if (makerOperator) await makerOperator.context.close().catch(() => undefined);
    if (checkerOperator) await checkerOperator.context.close().catch(() => undefined);
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(RESULT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }
  expect(cleanupErrors, "all M2/M3/M4 cleanup steps must complete").toEqual([]);
});

async function verifyM2(makerPage: Page, checkerPage: Page, ids: { ticketNo?: string }) {
  const title = `${PREFIX}-M2-unknown-create`;
  const createKey = `${PREFIX}-M2-UNKNOWN-CREATE`;
  const createBody = {
    userId: null,
    category: "account",
    priority: "NORMAL",
    title,
    body: `${PREFIX}-M2 双运营员验收工单`,
    assignedAdminId: null,
    assignedAdminName: null,
    operator: maker!.username,
    reason: `${PREFIX}-M2 结果未知创建与重试`,
  };
  const lost = await sendAndLoseResponse(makerPage, "POST", "/api/admin/content/tickets", createKey, createBody);
  const recovered = await makerPage.request.post("/api/admin/content/tickets", {
    headers: { "Idempotency-Key": createKey },
    data: createBody,
  });
  const created = await okEnvelope<TicketDetail>(recovered);
  ids.ticketNo = created.data.ticket.ticketNo;

  const replayMismatch = await checkerPage.request.post("/api/admin/content/tickets", {
    headers: { "Idempotency-Key": createKey },
    data: { ...createBody, title: `${title}-DIFFERENT` },
  });
  expect(await apiCode(replayMismatch)).toBe(409);

  const before = await ticketDetail(makerPage.request, ids.ticketNo);
  const makerPayload = {
    priority: "URGENT",
    expectedStatus: before.ticket.status,
    expectedVersion: before.ticket.version,
    reason: `${PREFIX}-M2 maker CAS 竞争`,
    operator: maker!.username,
  };
  const checkerPayload = {
    ...makerPayload,
    priority: "HIGH",
    reason: `${PREFIX}-M2 checker CAS 竞争`,
    operator: checker!.username,
  };
  const makerKey = `${PREFIX}-M2-CAS-MAKER`;
  const checkerKey = `${PREFIX}-M2-CAS-CHECKER`;
  const [makerRace, checkerRace] = await Promise.all([
    makerPage.request.patch(`/api/admin/content/tickets/${ids.ticketNo}/priority`, {
      headers: { "Idempotency-Key": makerKey },
      data: makerPayload,
    }),
    checkerPage.request.patch(`/api/admin/content/tickets/${ids.ticketNo}/priority`, {
      headers: { "Idempotency-Key": checkerKey },
      data: checkerPayload,
    }),
  ]);
  const raceCodes = [await apiCode(makerRace), await apiCode(checkerRace)];
  expect([...raceCodes].sort((left, right) => left - right)).toEqual([0, 409]);
  const winner = raceCodes[0] === 0
    ? { page: makerPage, key: makerKey, body: makerPayload }
    : { page: checkerPage, key: checkerKey, body: checkerPayload };
  const replay = await winner.page.request.patch(`/api/admin/content/tickets/${ids.ticketNo}/priority`, {
    headers: { "Idempotency-Key": winner.key },
    data: winner.body,
  });
  expect(await apiCode(replay)).toBe(0);
  const mismatch = await winner.page.request.patch(`/api/admin/content/tickets/${ids.ticketNo}/priority`, {
    headers: { "Idempotency-Key": winner.key },
    data: { ...winner.body, reason: `${winner.body.reason}-DIFFERENT` },
  });
  expect(await apiCode(mismatch)).toBe(409);
  const after = await ticketDetail(makerPage.request, ids.ticketNo);
  expect(after.ticket.version).toBe(before.ticket.version + 1);

  return {
    ticketNo: ids.ticketNo,
    lostResponse: lost,
    recoveredBySameKey: true,
    casBusinessCodes: raceCodes,
    versionBefore: before.ticket.version,
    versionAfter: after.ticket.version,
    sameKeyReplayCode: 0,
    sameKeyDifferentPayloadCode: 409,
  };
}

async function verifyM3(makerPage: Page, checkerPage: Page, ids: { conversationNo?: string }) {
  const openingText = `${PREFIX}-M3-unknown-initiate`;
  const createKey = `${PREFIX}-M3-UNKNOWN-CREATE`;
  const createBody = {
    conversationType: "support",
    userId: null,
    ownerAgentId: maker!.username,
    ownerAgentName: maker!.username,
    openingText,
    reason: `${PREFIX}-M3 结果未知创建与重试`,
    operator: maker!.username,
  };
  const lost = await sendAndLoseResponse(makerPage, "POST", "/api/admin/content/conversations", createKey, createBody);
  const recovered = await makerPage.request.post("/api/admin/content/conversations", {
    headers: { "Idempotency-Key": createKey },
    data: createBody,
  });
  const created = await okEnvelope<Conversation>(recovered);
  ids.conversationNo = created.data.conversationNo;

  const replayMismatch = await checkerPage.request.post("/api/admin/content/conversations", {
    headers: { "Idempotency-Key": createKey },
    data: { ...createBody, openingText: `${openingText}-DIFFERENT` },
  });
  expect(await apiCode(replayMismatch)).toBe(409);

  const before = await conversationDetail(makerPage.request, ids.conversationNo);
  const makerPayload = {
    body: `${PREFIX}-M3-maker-CAS-message`,
    expectedStatus: before.conversation.status,
    expectedVersion: before.conversation.version,
    reason: `${PREFIX}-M3 maker CAS 竞争`,
    operator: maker!.username,
  };
  const checkerPayload = {
    ...makerPayload,
    body: `${PREFIX}-M3-checker-CAS-message`,
    reason: `${PREFIX}-M3 checker CAS 竞争`,
    operator: checker!.username,
  };
  const makerKey = `${PREFIX}-M3-CAS-MAKER`;
  const checkerKey = `${PREFIX}-M3-CAS-CHECKER`;
  const [makerRace, checkerRace] = await Promise.all([
    makerPage.request.post(`/api/admin/content/conversations/${ids.conversationNo}/replies`, {
      headers: { "Idempotency-Key": makerKey },
      data: makerPayload,
    }),
    checkerPage.request.post(`/api/admin/content/conversations/${ids.conversationNo}/replies`, {
      headers: { "Idempotency-Key": checkerKey },
      data: checkerPayload,
    }),
  ]);
  const raceCodes = [await apiCode(makerRace), await apiCode(checkerRace)];
  expect([...raceCodes].sort((left, right) => left - right)).toEqual([0, 409]);
  const winner = raceCodes[0] === 0
    ? { page: makerPage, key: makerKey, body: makerPayload }
    : { page: checkerPage, key: checkerKey, body: checkerPayload };
  const replay = await winner.page.request.post(`/api/admin/content/conversations/${ids.conversationNo}/replies`, {
    headers: { "Idempotency-Key": winner.key },
    data: winner.body,
  });
  expect(await apiCode(replay)).toBe(0);
  const mismatch = await winner.page.request.post(`/api/admin/content/conversations/${ids.conversationNo}/replies`, {
    headers: { "Idempotency-Key": winner.key },
    data: { ...winner.body, body: `${winner.body.body}-DIFFERENT` },
  });
  expect(await apiCode(mismatch)).toBe(409);
  const after = await conversationDetail(makerPage.request, ids.conversationNo);
  expect(after.conversation.version).toBe(before.conversation.version + 1);
  expect(
    (after.messages ?? []).filter((message) =>
      message.content === makerPayload.body || message.content === checkerPayload.body),
  ).toHaveLength(1);

  return {
    conversationNo: ids.conversationNo,
    lostResponse: lost,
    recoveredBySameKey: true,
    casBusinessCodes: raceCodes,
    versionBefore: before.conversation.version,
    versionAfter: after.conversation.version,
    competingMessagesPersisted: 1,
    sameKeyReplayCode: 0,
    sameKeyDifferentPayloadCode: 409,
  };
}

async function verifyM4(makerPage: Page, checkerPage: Page, ids: { faqId?: string }) {
  const question = `${PREFIX}-M4-unknown-create`;
  const createKey = `${PREFIX}-M4-UNKNOWN-CREATE`;
  const createBody = {
    category: "general",
    surface: "Help Center",
    question,
    answer: `${PREFIX}-M4 双运营员验收回答`,
    status: "DRAFT",
    language: "zh-CN",
    sortOrder: 998,
    expectedStatus: null,
    expectedVersion: null,
    operator: maker!.username,
    reason: `${PREFIX}-M4 结果未知创建与重试`,
  };
  const lost = await sendAndLoseResponse(makerPage, "POST", "/api/admin/content/knowledge/faqs", createKey, createBody);
  const recovered = await makerPage.request.post("/api/admin/content/knowledge/faqs", {
    headers: { "Idempotency-Key": createKey },
    data: createBody,
  });
  const created = await okEnvelope<Faq>(recovered);
  ids.faqId = created.data.id;

  const replayMismatch = await checkerPage.request.post("/api/admin/content/knowledge/faqs", {
    headers: { "Idempotency-Key": createKey },
    data: { ...createBody, answer: `${createBody.answer}-DIFFERENT` },
  });
  expect(await apiCode(replayMismatch)).toBe(409);

  const before = await faqById(makerPage.request, ids.faqId);
  const makerPayload = {
    status: "PUBLISHED",
    expectedStatus: before.status,
    expectedVersion: before.version,
    operator: maker!.username,
    reason: `${PREFIX}-M4 maker CAS 竞争`,
  };
  const checkerPayload = {
    ...makerPayload,
    reason: `${PREFIX}-M4 checker CAS 竞争`,
    operator: checker!.username,
  };
  const makerKey = `${PREFIX}-M4-CAS-MAKER`;
  const checkerKey = `${PREFIX}-M4-CAS-CHECKER`;
  const [makerRace, checkerRace] = await Promise.all([
    makerPage.request.patch(`/api/admin/content/knowledge/faqs/${ids.faqId}/status`, {
      headers: { "Idempotency-Key": makerKey },
      data: makerPayload,
    }),
    checkerPage.request.patch(`/api/admin/content/knowledge/faqs/${ids.faqId}/status`, {
      headers: { "Idempotency-Key": checkerKey },
      data: checkerPayload,
    }),
  ]);
  const raceCodes = [await apiCode(makerRace), await apiCode(checkerRace)];
  expect([...raceCodes].sort((left, right) => left - right)).toEqual([0, 409]);
  const winner = raceCodes[0] === 0
    ? { page: makerPage, key: makerKey, body: makerPayload }
    : { page: checkerPage, key: checkerKey, body: checkerPayload };
  const replay = await winner.page.request.patch(`/api/admin/content/knowledge/faqs/${ids.faqId}/status`, {
    headers: { "Idempotency-Key": winner.key },
    data: winner.body,
  });
  expect(await apiCode(replay)).toBe(0);
  const mismatch = await winner.page.request.patch(`/api/admin/content/knowledge/faqs/${ids.faqId}/status`, {
    headers: { "Idempotency-Key": winner.key },
    data: { ...winner.body, reason: `${winner.body.reason}-DIFFERENT` },
  });
  expect(await apiCode(mismatch)).toBe(409);
  const after = await faqById(makerPage.request, ids.faqId);
  expect(after.status).toBe("PUBLISHED");
  expect(after.version).toBe(before.version + 1);

  return {
    faqId: ids.faqId,
    lostResponse: lost,
    recoveredBySameKey: true,
    casBusinessCodes: raceCodes,
    versionBefore: before.version,
    versionAfter: after.version,
    sameKeyReplayCode: 0,
    sameKeyDifferentPayloadCode: 409,
  };
}

async function cleanupAll(
  request: APIRequestContext,
  ids: { ticketNo?: string; conversationNo?: string; faqId?: string },
) {
  const result: Record<string, unknown> = {};
  const errors: string[] = [];
  const recovery = await recoverUnknownOutcomeIds(request, ids);
  result.recoveredUnknownOutcomeIds = recovery.recovered;
  errors.push(...recovery.errors);
  if (ids.conversationNo) {
    try {
      let detail = await conversationDetail(request, ids.conversationNo);
      if (detail.conversation.status !== "RESOLVED") {
        const response = await request.patch(`/api/admin/content/conversations/${ids.conversationNo}/status`, {
          headers: { "Idempotency-Key": `${PREFIX}-M3-CLEANUP-RESOLVE` },
          data: {
            status: "RESOLVED",
            expectedStatus: detail.conversation.status,
            expectedVersion: detail.conversation.version,
            reason: `${PREFIX}-M3 精确清理解决`,
            operator: maker!.username,
          },
        });
        await okEnvelope<Conversation>(response);
        detail = await conversationDetail(request, ids.conversationNo);
      }
      const archived = await request.patch(`/api/admin/content/conversations/${ids.conversationNo}/archive`, {
        headers: { "Idempotency-Key": `${PREFIX}-M3-CLEANUP-ARCHIVE` },
        data: {
          archived: true,
          expectedStatus: detail.conversation.status,
          expectedVersion: detail.conversation.version,
          reason: `${PREFIX}-M3 精确清理归档`,
          operator: maker!.username,
        },
      });
      const archivedView = (await okEnvelope<Conversation>(archived)).data;
      expect(archivedView.status).toBe("CLOSED");
      const terminalDetail = await conversationDetail(request, ids.conversationNo);
      expect(terminalDetail.conversation.status).toBe("CLOSED");
      result.conversation = { conversationNo: ids.conversationNo, terminal: "RESOLVED+ARCHIVED" };
    } catch (error) {
      errors.push(`M3:${ids.conversationNo}:${errorText(error)}`);
    }
  }
  if (ids.ticketNo) {
    try {
      let detail = await ticketDetail(request, ids.ticketNo);
      if (!["RESOLVED", "CLOSED"].includes(detail.ticket.status)) {
        const response = await request.patch(`/api/admin/content/tickets/${ids.ticketNo}/status`, {
          headers: { "Idempotency-Key": `${PREFIX}-M2-CLEANUP-RESOLVE` },
          data: {
            status: "RESOLVED",
            expectedStatus: detail.ticket.status,
            expectedVersion: detail.ticket.version,
            reason: `${PREFIX}-M2 精确清理解决`,
            operator: maker!.username,
          },
        });
        detail = (await okEnvelope<TicketDetail>(response)).data;
      }
      if (!detail.ticket.archived) {
        const response = await request.patch(`/api/admin/content/tickets/${ids.ticketNo}/archive`, {
          headers: { "Idempotency-Key": `${PREFIX}-M2-CLEANUP-ARCHIVE` },
          data: {
            archived: true,
            expectedStatus: detail.ticket.status,
            expectedVersion: detail.ticket.version,
            reason: `${PREFIX}-M2 精确清理归档`,
            operator: maker!.username,
          },
        });
        detail = (await okEnvelope<TicketDetail>(response)).data;
      }
      expect(detail.ticket.archived).toBe(true);
      result.ticket = { ticketNo: ids.ticketNo, terminal: `${detail.ticket.status}+ARCHIVED` };
    } catch (error) {
      errors.push(`M2:${ids.ticketNo}:${errorText(error)}`);
    }
  }
  if (ids.faqId) {
    try {
      let faq = await faqById(request, ids.faqId);
      if (faq.status !== "DRAFT") {
        const response = await request.patch(`/api/admin/content/knowledge/faqs/${ids.faqId}/status`, {
          headers: { "Idempotency-Key": `${PREFIX}-M4-CLEANUP-DRAFT` },
          data: {
            status: "DRAFT",
            expectedStatus: faq.status,
            expectedVersion: faq.version,
            operator: maker!.username,
            reason: `${PREFIX}-M4 精确清理下架`,
          },
        });
        faq = (await okEnvelope<Faq>(response)).data;
      }
      const removed = await request.delete(`/api/admin/content/knowledge/faqs/${ids.faqId}`, {
        headers: { "Idempotency-Key": `${PREFIX}-M4-CLEANUP-DELETE` },
        data: {
          expectedStatus: faq.status,
          expectedVersion: faq.version,
          operator: maker!.username,
          reason: `${PREFIX}-M4 精确清理删除`,
        },
      });
      await okEnvelope<unknown>(removed);
      await expectFaqMissing(request, ids.faqId);
      result.faq = { faqId: ids.faqId, terminal: "DELETED" };
    } catch (error) {
      errors.push(`M4:${ids.faqId}:${errorText(error)}`);
    }
  }
  return { ...result, errors };
}

async function recoverUnknownOutcomeIds(
  request: APIRequestContext,
  ids: { ticketNo?: string; conversationNo?: string; faqId?: string },
) {
  const recovered: string[] = [];
  const errors: string[] = [];
  if (!ids.ticketNo) {
    try {
      const response = await request.get(
        `/api/admin/content/tickets?pageNum=1&pageSize=100&keyword=${encodeURIComponent(`${PREFIX}-M2-unknown-create`)}`,
      );
      if (response.status() === 200) {
        const payload = await okEnvelope<{ records?: Ticket[] }>(response);
        const match = (payload.data.records ?? []).find((row) => row.title === `${PREFIX}-M2-unknown-create`);
        if (match) {
          ids.ticketNo = match.ticketNo;
          recovered.push(`M2:${match.ticketNo}`);
        }
      }
    } catch (error) {
      errors.push(`RECOVERY-M2:${errorText(error)}`);
    }
  }
  if (!ids.conversationNo) {
    try {
      const response = await request.get(
        `/api/admin/content/conversations?pageNum=1&pageSize=100&keyword=${encodeURIComponent(`${PREFIX}-M3-unknown-initiate`)}`,
      );
      if (response.status() === 200) {
        const payload = await okEnvelope<{ records?: Conversation[] }>(response);
        const match = (payload.data.records ?? []).find((row) => row.lastMessage === `${PREFIX}-M3-unknown-initiate`);
        if (match) {
          ids.conversationNo = match.conversationNo;
          recovered.push(`M3:${match.conversationNo}`);
        }
      }
    } catch (error) {
      errors.push(`RECOVERY-M3:${errorText(error)}`);
    }
  }
  if (!ids.faqId) {
    try {
      const response = await request.get("/api/admin/content/knowledge/overview");
      if (response.status() === 200) {
        const payload = await okEnvelope<KnowledgeOverview>(response);
        const match = (payload.data.faqs ?? []).find((row) => row.question === `${PREFIX}-M4-unknown-create`);
        if (match) {
          ids.faqId = match.id;
          recovered.push(`M4:${match.id}`);
        }
      }
    } catch (error) {
      errors.push(`RECOVERY-M4:${errorText(error)}`);
    }
  }
  return { recovered, errors };
}

async function loginOperator(browser: Browser, account: Account, profile: "maker" | "checker") {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
    await page.locator('input[autocomplete="username"]').fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    const loginResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/login");
    await page.getByRole("button", { name: /登录|继续/ }).click();
    expect((await loginResponse).status()).toBe(200);
    const otp = page.getByLabel("一次性验证码");
    await expect(otp, `${account.username} must use real MFA`).toBeVisible({ timeout: 20_000 });
    await otp.fill(generateTotp(account.totpSecret));
    const mfaResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    expect((await mfaResponse).status()).toBe(200);
    await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
    const sessionResponse = await page.request.get("/api/admin/auth/session");
    const session = (await okEnvelope<SessionEnvelope["data"]>(sessionResponse)).data?.session;
    expect(session?.username).toBe(account.username);
    for (const authority of M234_AUTHORITIES) {
      expect(session?.authorities ?? [], `${account.username} requires ${authority}`).toContain(authority);
    }
    const expectedAuthorities = profile === "maker" ? MAKER_EXACT_AUTHORITIES : CHECKER_EXACT_AUTHORITIES;
    const expectedMenus = profile === "maker" ? MAKER_EXACT_MENU_LEAVES : CHECKER_EXACT_MENU_LEAVES;
    expect([...(session?.authorities ?? [])].sort(), `${profile} authorities must be exact`).toEqual(
      expectedAuthorities,
    );
    expect([...(session?.effectiveMenus ?? [])].sort(), `${profile} effective menu leaves must be exact`).toEqual(
      expectedMenus,
    );
    if (profile === "checker") {
      expect((await page.request.get("/api/admin/platform/audit/logs?limit=1")).status()).toBe(200);
      expect((await page.request.get("/api/admin/platform/accounts/overview")).status()).toBe(403);
      expect((await page.request.get("/api/admin/devices/overview")).status()).toBe(403);
    } else {
      expect((await page.request.get("/api/admin/platform/audit/logs?limit=1")).status()).toBe(200);
      expect((await page.request.get("/api/admin/platform/accounts/overview")).status()).toBe(403);
      expect((await page.request.get("/api/admin/devices/overview")).status()).toBe(403);
      expect((await page.request.get("/api/admin/content/tickets/load-config")).status()).toBe(403);
      expect((await page.request.get("/api/admin/content/session-templates/overview")).status()).toBe(403);
    }
    return { context, page, session };
  } catch (error) {
    if (await page.locator("aside").isVisible().catch(() => false)) {
      await logout(page).catch(() => undefined);
    }
    await context.close().catch(() => undefined);
    throw error;
  }
}

async function assertVisibleModules(page: Page) {
  for (const href of ["/service/tickets", "/service/sessions", "/service/kb-sla"]) {
    const link = page.locator(`aside a[href="${href}"]`).first();
    if (!await link.isVisible().catch(() => false)) {
      const group = page.getByRole("button", { name: /客服中心.*M|M.*客服中心/ }).first();
      await expect(group).toBeVisible();
      await group.click();
    }
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL((url) => url.pathname === href);
  }
}

async function sendAndLoseResponse(
  page: Page,
  method: string,
  url: string,
  idempotencyKey: string,
  data: Record<string, unknown>,
) {
  let upstreamStatus = 0;
  let upstreamCode: number | undefined;
  const routePattern = `**${url}`;
  await page.route(routePattern, async (route) => {
    if (route.request().method() !== method) {
      await route.continue();
      return;
    }
    const upstream = await route.fetch();
    upstreamStatus = upstream.status();
    const upstreamPayload = await upstream.json().catch(() => undefined) as { code?: number } | undefined;
    upstreamCode = upstreamPayload?.code;
    await route.abort("failed");
  });
  try {
    const client = await page.evaluate(async ({ method: requestMethod, url: requestUrl, idempotencyKey: key, data: body }) => {
      try {
        const response = await fetch(requestUrl, {
          method: requestMethod,
          headers: { "Content-Type": "application/json", "Idempotency-Key": key },
          body: JSON.stringify(body),
        });
        return { rejected: false, status: response.status };
      } catch (error) {
        return { rejected: true, error: String(error) };
      }
    }, { method, url, idempotencyKey, data });
    expect(upstreamStatus, `${url} upstream write must succeed before response loss`).toBe(200);
    expect(upstreamCode, `${url} upstream body must confirm business success`).toBe(0);
    expect(client.rejected, `${url} client must observe an unknown result`).toBe(true);
    return { upstreamStatus, upstreamCode, clientRejected: client.rejected };
  } finally {
    await page.unroute(routePattern);
  }
}

async function ticketDetail(request: APIRequestContext, ticketNo: string) {
  return (await okEnvelope<TicketDetail>(
    await request.get(`/api/admin/content/tickets/${encodeURIComponent(ticketNo)}`),
  )).data;
}

async function conversationDetail(request: APIRequestContext, conversationNo: string) {
  return (await okEnvelope<ConversationDetail>(
    await request.get(`/api/admin/content/conversations/${encodeURIComponent(conversationNo)}`),
  )).data;
}

async function faqById(request: APIRequestContext, faqId: string) {
  const overview = (await okEnvelope<KnowledgeOverview>(
    await request.get("/api/admin/content/knowledge/overview"),
  )).data;
  const faq = (overview.faqs ?? []).find((row) => row.id === faqId);
  expect(faq, `FAQ ${faqId} must exist`).toBeTruthy();
  return faq!;
}

async function expectFaqMissing(request: APIRequestContext, faqId: string) {
  const overview = (await okEnvelope<KnowledgeOverview>(
    await request.get("/api/admin/content/knowledge/overview"),
  )).data;
  expect((overview.faqs ?? []).some((row) => row.id === faqId)).toBe(false);
}

async function okEnvelope<T>(response: APIResponse) {
  const text = await response.text();
  expect(response.status(), `${response.url()}: ${text}`).toBe(200);
  const payload = JSON.parse(text) as Envelope<T>;
  expect(payload.code ?? 0, text).toBe(0);
  return payload;
}

async function apiCode(response: APIResponse) {
  const text = await response.text();
  let payload: { code?: number } | undefined;
  try {
    payload = JSON.parse(text) as { code?: number };
  } catch {
    payload = undefined;
  }
  if (typeof payload?.code === "number") return payload.code;
  return response.status();
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await expect(account).toBeVisible();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

function generateTotp(secret: string) {
  expect(secret, "TOTP secret is required").not.toBe("");
  const normalized = secret.toUpperCase().replace(/[\s=-]/g, "");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of normalized) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error(`Invalid Base32 character: ${char}`);
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  const counter = Math.floor(Date.now() / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function restrictedEnvPath(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  const resolved = path.resolve(value);
  const restrictedRoot = path.resolve(
    "D:/workspace/bug-pic/.restricted",
    RUN_ID,
  );
  const relative = path.relative(restrictedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${name} must stay under ${restrictedRoot}`);
  }
  return resolved;
}

function sha256File(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex").toUpperCase();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
