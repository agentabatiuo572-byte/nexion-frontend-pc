import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const runId = process.env.J4_RUN_ID;
const fixtureCode = process.env.J4_PLAYBOOK_CODE;
const fixtureName = process.env.J4_PLAYBOOK_NAME;
const legacyFixtureCode = process.env.J4_LEGACY_PLAYBOOK_CODE;
const artifactRoot = `D:/workspace/j4-acceptance-artifacts/playwright-${runId}`;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("J4 V3 read-only evidence from visible navigation", async ({ context, page }) => {
  const password = process.env.J4_TEST_PASSWORD;
  expect(runId, "J4_RUN_ID must identify this evidence run").toBeTruthy();
  expect(fixtureCode, "J4_PLAYBOOK_CODE must identify this run's fixture").toBeTruthy();
  expect(fixtureName, "J4_PLAYBOOK_NAME must identify this run's fixture").toBeTruthy();
  expect(legacyFixtureCode, "J4_LEGACY_PLAYBOOK_CODE must identify the legacy fixture under review").toBeTruthy();
  expect(password, "J4_TEST_PASSWORD must be provided by the runner").toBeTruthy();

  const login = await context.request.post("/api/admin/auth/login", {
    data: { username: "superadmin", password },
  });
  expect(login.ok()).toBeTruthy();
  expect((await login.json()).code).toBe(0);

  await mkdir(artifactRoot, { recursive: true });
  const network: Array<{ method: string; url: string; status: number }> = [];
  const consoleIssues: Array<{ type: string; text: string }> = [];
  const pageErrors: string[] = [];
  const failedRequests: Array<{ method: string; url: string; failure: string | null }> = [];
  let selectedExecutionId: string | undefined;
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/api/admin/")) {
      network.push({ method: response.request().method(), url, status: response.status() });
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleIssues.push({ type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push({
    method: request.method(),
    url: request.url(),
    failure: request.failure()?.errorText ?? null,
  }));

  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "紧急与合规控制 J", exact: true }).click();
    await page.screenshot({ path: `${artifactRoot}/01-visible-j-menu.png`, fullPage: true });
    const overviewResponsePromise = page.waitForResponse((response) => response.request().method() === "GET" && response.url().includes("/api/admin/emergency/sop/playbooks"));
    await page.getByRole("link", { name: "监管点名应急 SOP J4", exact: true }).click();
    const overviewResponse = await overviewResponsePromise;
    expect(overviewResponse.status()).toBe(200);
    const overviewBody = await overviewResponse.json();
    expect(overviewBody.code).toBe(0);
    expect(overviewBody.data.contractVersion).toBe("J4_REAL_EXECUTION_V3");
    const actionOptions = overviewBody.data.actionOptions as Array<{ domain: string; ref: string }>;
    expect(actionOptions.map((item) => `${item.domain}:${item.ref}`)).toEqual([
      "J1:withdraw",
      "J1:genesis",
      "I3:campaign-notify",
    ]);
    await expect(page).toHaveURL(/\/emergency\/sop$/);

    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "监管点名应急 SOP", exact: true })).toBeVisible();
    await expect(main.getByText("当前可执行范围", { exact: true })).toBeVisible();
    await expect(main.getByText("提现 / Genesis 关停", { exact: true })).toBeVisible();
    await expect(main.getByText("已排期通知活动下发", { exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "+ 新增剧本", exact: true })).toBeVisible();
    await page.screenshot({ path: `${artifactRoot}/02-visible-menu-entry.png`, fullPage: true });
    await page.screenshot({ path: `${artifactRoot}/03-current-real-scope.png`, fullPage: true });

    for (const retiredDomain of ["J2", "I5", "C2", "K1", "D2"]) {
      await expect(main.getByRole("button", { name: new RegExp(`^${retiredDomain}\\s`) })).toHaveCount(0);
    }

    const card = main.getByTestId(`j4-playbook-${fixtureCode}`);
    await expect(card.getByText(fixtureName!, { exact: true })).toBeVisible();
    await expect(card.getByText("演练就绪", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "应急执行", exact: true })).toBeEnabled();

    const legacyCard = main.getByTestId(`j4-playbook-${legacyFixtureCode}`);
    await expect(legacyCard.getByText("历史剧本 · 需迁移", { exact: true })).toBeVisible();
    await expect(legacyCard.getByText(/1 个动作尚未接通，请编辑并替换/)).toBeVisible();
    await expect(legacyCard.getByText("核验备付金覆盖率", { exact: true })).toHaveCount(0);
    await expect(legacyCard.getByRole("button", { name: "演练", exact: true })).toBeDisabled();
    await expect(legacyCard.getByRole("button", { name: /^(应急执行|执行)$/ })).toBeDisabled();
    await page.screenshot({ path: `${artifactRoot}/04-legacy-playbook-quarantined.png`, fullPage: true });

    await card.getByRole("button", { name: "编辑", exact: true }).click();
    const editDialog = page.getByRole("dialog", { name: new RegExp(`编辑应急剧本 · ${escapeRegExp(fixtureCode!)}`) });
    const ownerOptions = await editDialog.getByRole("combobox", { name: "责任角色", exact: true }).locator("option").allTextContents();
    expect(ownerOptions).toEqual(["合规审计", "风控", "超管"]);
    expect(new Set(ownerOptions).size).toBe(ownerOptions.length);
    for (const retiredDomain of ["J2", "I5", "C2", "K1", "D2"]) {
      await expect(editDialog.getByRole("button", { name: new RegExp(`^${retiredDomain}\\s`) })).toHaveCount(0);
    }
    await page.screenshot({ path: `${artifactRoot}/05-edit-owner-options.png`, fullPage: true });
    await editDialog.getByRole("button", { name: "取消", exact: true }).click();

    const fixtureExecution = (overviewBody.data.executions as Array<{ code: string; executionId: string }>).find((item) => item.code === fixtureCode);
    expect(fixtureExecution, "fixture must have a drill execution").toBeTruthy();
    selectedExecutionId = fixtureExecution!.executionId;
    await main.getByTestId(`j4-execution-${fixtureExecution!.executionId}`).getByRole("button", { name: "查看追溯", exact: true }).click();
    const traceDialog = page.getByRole("dialog", { name: `执行追溯 · ${fixtureExecution!.executionId}` });
    await expect(traceDialog.getByText("逐步执行结果", { exact: true })).toBeVisible();
    await expect(traceDialog.getByText(/状态\s*VALIDATED/)).toBeVisible();
    await expect(traceDialog.getByText("通知与审计", { exact: true })).toBeVisible();
    await expect(traceDialog.getByText("回滚事实", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${artifactRoot}/06-drill-trace.png`, fullPage: true });
    await traceDialog.getByRole("button", { name: "关闭", exact: true }).click();

    await page.screenshot({ path: `${artifactRoot}/07-final-page.png`, fullPage: true });
    expect(network.some((entry) => entry.method === "GET" && entry.url.includes("/api/admin/emergency/sop/playbooks") && entry.status === 200)).toBeTruthy();
    expect(network.some((entry) => entry.method === "GET" && entry.url.includes("/api/admin/content/campaigns") && entry.status === 200)).toBeTruthy();
    expect(network.filter((entry) => !["GET", "HEAD", "OPTIONS"].includes(entry.method))).toEqual([]);
    expect(network.filter((entry) => entry.status >= 400)).toEqual([]);
    expect(consoleIssues).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  } finally {
    let archiveError: unknown;
    try {
      await context.tracing.stop({ path: `${artifactRoot}/j4-readonly-trace.zip` });
      await writeFile(`${artifactRoot}/network.json`, JSON.stringify(network, null, 2), "utf8");
      await writeFile(`${artifactRoot}/console.json`, JSON.stringify(consoleIssues, null, 2), "utf8");
      await writeFile(`${artifactRoot}/page-errors.json`, JSON.stringify(pageErrors, null, 2), "utf8");
      await writeFile(`${artifactRoot}/request-failed.json`, JSON.stringify(failedRequests, null, 2), "utf8");
      await writeFile(`${artifactRoot}/fixture.json`, JSON.stringify({
        runId,
        fixtureCode,
        fixtureName,
        legacyFixtureCode,
        selectedExecutionId,
        scope: "supplemental read-only evidence; not a substitute for U01 login or full J4 acceptance",
      }, null, 2), "utf8");
      const source = await readFile(resolve(process.cwd(), "tests/e2e/j4-readonly-evidence.spec.ts"));
      const config = await readFile(resolve(process.cwd(), "playwright.j4-evidence.config.ts"));
      await writeFile(`${artifactRoot}/script-config.sha256`, [
        `${createHash("sha256").update(source).digest("hex")}  j4-readonly-evidence.spec.ts`,
        `${createHash("sha256").update(config).digest("hex")}  playwright.j4-evidence.config.ts`,
        "",
      ].join("\n"), "utf8");
    } catch (error) {
      archiveError = error;
    }

    let logoutError: unknown;
    const logoutEvidence: { attempted: boolean; status?: number; code?: unknown; success: boolean; error?: string } = {
      attempted: true,
      success: false,
    };
    try {
      const logout = await context.request.post("/api/admin/auth/logout");
      logoutEvidence.status = logout.status();
      const logoutBody = await logout.json().catch(() => undefined);
      logoutEvidence.code = logoutBody?.code;
      logoutEvidence.success = logout.ok() && logoutBody?.code === 0;
      if (!logoutEvidence.success) {
        logoutError = new Error(`J4_EVIDENCE_LOGOUT_FAILED:${logout.status()}:${String(logoutBody?.code)}`);
      }
    } catch (error) {
      logoutEvidence.error = error instanceof Error ? error.message : String(error);
      logoutError = error;
    }
    try {
      await writeFile(`${artifactRoot}/logout.json`, JSON.stringify(logoutEvidence, null, 2), "utf8");
    } catch (error) {
      logoutError ??= error;
    }
    if (logoutError) throw logoutError;
    if (archiveError) throw archiveError;
  }
});
