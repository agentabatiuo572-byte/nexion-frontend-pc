import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const RUN_ID = "pc-full-acceptance-20260729-114336";
const EVIDENCE_DIR = process.env.J_ENV_007_EVIDENCE_DIR
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/J/env-007`;
const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })());
const REASON = `${RUN_ID} ENV-007 历史自动关停补录清理；仅补录结论，不伪称恢复`;

type Gate = { key: string; name: string; enabled: boolean };
type Confirmation = { key: string; incidentId: string; name: string };
type Matrix = { activeGates: Gate[]; autoConfirmations: Confirmation[] };

test("ENV-007：从可见 J1 完成历史补录并恢复干净五闸基线", async ({ page }) => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await loginAndOpenJ1(page);
  const before = await matrix(page);
  await writeJson("before-matrix.json", before);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-before-env-007.png"), fullPage: true });

  for (const pending of before.autoConfirmations) {
    const response = page.waitForResponse((candidate) =>
      candidate.request().method() === "POST"
      && candidate.url().endsWith(`/api/admin/emergency/kill-switches/auto-confirmations/${pending.key}`),
    );
    await page.getByRole("button", { name: "补录结论", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("复核结论").selectOption("keep_disabled");
    await dialog.getByLabel(/操作理由/).fill(REASON);
    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    expect((await response).status(), `ENV-007 ${pending.key} 补录`).toBe(200);
    await expect(dialog).toHaveCount(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("功能开关总表 · 5 个业务闸", { exact: true })).toBeVisible();
  }

  const afterConfirmation = await matrix(page);
  expect(afterConfirmation.autoConfirmations, "补录后不得保留 pending").toHaveLength(0);
  const withdraw = afterConfirmation.activeGates.find((gate) => gate.key === "withdraw");
  if (!withdraw) throw new Error("ENV_007_WITHDRAW_GATE_MISSING");
  if (!withdraw.enabled) {
    const row = page.locator(".matrix-tbl .rw").filter({ hasText: withdraw.name }).first();
    await expect(row.getByRole("button", { name: "恢复", exact: true }), "withdraw 必须在补录后可从可见 UI 恢复").toBeEnabled();
    const response = page.waitForResponse((candidate) =>
      candidate.request().method() === "PUT"
      && candidate.url().endsWith("/api/admin/emergency/kill-switches/withdraw"),
    );
    await row.getByRole("button", { name: "恢复", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/操作理由/).fill(`${RUN_ID} ENV-007 历史 withdraw 基线恢复；补录已完成`);
    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    expect((await response).status(), "withdraw 恢复").toBe(200);
    await page.reload({ waitUntil: "domcontentloaded" });
  }

  const final = await matrix(page);
  expect(final.autoConfirmations, "后续 K3 基线不得有 pending").toHaveLength(0);
  expect(final.activeGates, "后续 K3 基线必须五闸 enabled").toHaveLength(5);
  expect(final.activeGates.every((gate) => gate.enabled), "五闸必须全部 enabled").toBe(true);
  await writeJson("final-matrix.json", final);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-final-five-enabled-no-pending.png"), fullPage: true });
});

test("ENV-007：只读记录补录后的五闸与 B1 权威覆盖率来源", async ({ page }) => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await loginAndOpenJ1(page);
  const current = await matrix(page);
  const coverageResponse = await page.request.get("/api/admin/treasury/coverage");
  expect(coverageResponse.status()).toBe(200);
  const coverage = await coverageResponse.json();
  await writeJson("after-confirmation-matrix.json", current);
  await writeJson("b1-coverage-source.json", coverage);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-post-confirmation-read-only.png"), fullPage: true });
  expect(current.autoConfirmations, "历史 pending 必须已清理").toHaveLength(0);
});

async function loginAndOpenJ1(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await username.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /继续|登录/ }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
  const group = page.getByRole("button", { name: /紧急与合规控制\s*J|J\s*紧急与合规控制/ }).first();
  if (await group.getAttribute("aria-expanded") !== "true") await group.click();
  const entry = page.locator('a[href="/emergency/kill-switch"]').first();
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/emergency\/kill-switch(?:\?.*)?$/);
  await expect(page.getByText("功能开关总表 · 5 个业务闸", { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function matrix(page: Page): Promise<Matrix> {
  const response = await page.request.get("/api/admin/emergency/kill-switches");
  expect(response.status()).toBe(200);
  const payload = await response.json() as { data?: Matrix };
  if (!payload.data) throw new Error("ENV_007_MATRIX_DATA_MISSING");
  return payload.data;
}

async function writeJson(name: string, value: unknown) {
  await writeFile(path.join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
