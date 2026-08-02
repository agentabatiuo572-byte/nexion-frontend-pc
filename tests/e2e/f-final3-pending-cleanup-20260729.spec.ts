import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse } from "@playwright/test";
import {
  assertDedicatedLeafMenuContract,
  assertLocalFCandidate,
  currentFRunId,
  loadFDedicatedActors,
  loginFActor,
} from "./helpers/f-acceptance-harness";

type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
type Ticket = { id?: string; status?: string; st?: string };
type Overview = {
  operationQueue?: Ticket[];
  operationHistory?: Ticket[];
};
type Session = {
  roleCode?: string;
  authorities?: string[];
  effectiveMenus?: Array<string | { code?: string }>;
};
type F1Overview = { configValues?: Record<string, string> };

const RUN_ID = currentFRunId();
const OPERATION_ID = process.env.F_FINAL3_CLEANUP_OPERATION_ID?.trim() ?? "";
const EXPECTED_VALUE = process.env.F_FINAL3_EXPECTED_PRIZE_NAME ?? "Nexion V-Rank";
const EVIDENCE_DIR = process.env.F_FINAL3_CLEANUP_EVIDENCE_DIR
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/F/final3-pending-cleanup`;
const ACTORS = loadFDedicatedActors(RUN_ID);

test.beforeAll(() => {
  expect(process.env.F_WRITE_BYPASS).toBe("false");
  expect(process.env.F_WRITE_TOKEN).toBe("1");
  expect(OPERATION_ID).toMatch(/^(?:WO|OP)-/);
  assertLocalFCandidate();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("final3 restricted F1 checker rejects the orphan pending ticket and preserves the exact value", async ({ page }) => {
  await loginFActor(page, ACTORS.fChecker, "f-final3-cleanup-checker");
  const session = await ok<{ session?: Session }>(
    await page.request.get("/api/admin/auth/session"),
    "F1 checker session",
  );
  expect(session.session?.roleCode).toBe(ACTORS.fCheckerRoleCode);
  expect(session.session?.authorities ?? []).toEqual(expect.arrayContaining([
    "platform_a2_read",
    "platform_a2_operation_approve",
    "network_f1_read",
    "network_f1_write",
  ]));
  await assertDedicatedLeafMenuContract(
    page,
    session.session?.effectiveMenus ?? [],
    "f1-checker",
  );

  const response = await page.request.post(
    `/api/admin/platform/audit/operations/${encodeURIComponent(OPERATION_ID)}/reject`,
    {
      headers: {
        "Idempotency-Key": `${RUN_ID}-f-final3-orphan-cleanup-${OPERATION_ID}`,
      },
      data: { reason: `${RUN_ID} final3 探针异常中断后的受限 checker 精确清理` },
    },
  );
  const body = await response.json() as Envelope;
  expect(
    body.code === 0 || body.code === 409,
    `cleanup response: HTTP ${response.status()} ${JSON.stringify(body)}`,
  ).toBe(true);

  const overview = await ok<Overview>(
    await page.request.get("/api/admin/platform/audit/overview?object=F.prize.name"),
    "A2 overview after cleanup",
  );
  const rows = [...(overview.operationQueue ?? []), ...(overview.operationHistory ?? [])];
  const target = rows.find((row) => row.id === OPERATION_ID);
  expect(target, "cleanup ticket remains visible to its dedicated checker").toBeTruthy();
  expect(target?.status ?? target?.st).toMatch(/rejected/i);

  const f1 = await ok<F1Overview>(
    await page.request.get("/api/admin/teams/ranks"),
    "F1 exact value after cleanup",
  );
  expect(f1.configValues?.["F.prize.name"]).toBe(EXPECTED_VALUE);

  const platformGroup = page.getByRole("button", { name: /平台基础\s+A|A\s+平台基础/ }).first();
  const a2Link = page.locator('a[href="/platform/audit"]').first();
  if (!(await a2Link.isVisible().catch(() => false))) await platformGroup.click();
  await a2Link.click();
  await expect(page).toHaveURL(/\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("tbody tr").filter({ hasText: OPERATION_ID })).toBeVisible();
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, "orphan-rejected.png"),
    fullPage: true,
  });
});

async function ok<T>(response: APIResponse, label: string) {
  const body = await response.json() as Envelope<T>;
  expect(response.status(), `${label}: ${JSON.stringify(body)}`).toBe(200);
  expect(body.code, `${label}: ${JSON.stringify(body)}`).toBe(0);
  return body.data as T;
}
