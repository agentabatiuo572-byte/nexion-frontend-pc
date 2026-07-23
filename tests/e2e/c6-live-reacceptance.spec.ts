import { expect, test, type APIResponse, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const evidenceDir = "D:/workspace/bug-pic/c6-remediation-20260719-2158";
const rawDir = path.join(evidenceDir, "raw");
const screenshotDir = path.join(evidenceDir, "screenshots");
const e2eUsername = process.env.NEXION_E2E_USERNAME ?? "superadmin";

function e2ePassword(): string {
  const password = process.env.NEXION_E2E_PASSWORD;
  if (!password) throw new Error("NEXION_E2E_PASSWORD is required for the live C6 acceptance test");
  return password;
}

type Envelope<T = Record<string, unknown>> = { code: number; message: string; data: T };

async function loginAndOpenC6(page: Page) {
  await page.goto("/");
  await page.getByLabel(/用户名|账号/).fill(e2eUsername);
  await page.getByLabel(/密码/).fill(e2ePassword());
  await page.getByRole("button", { name: /继续/ }).click();
  await expect(page.getByRole("heading", { name: "运营总览" })).toBeVisible();
  await page.goto("/users/reg-risk");
  await expect(page.getByText("验证码(OTP)", { exact: true })).toBeVisible();
  await expect(page.getByText("连错锁定", { exact: true })).toBeVisible();
}

async function overview(page: Page) {
  const response = await page.request.get("/api/admin/users/registration-risk/overview");
  expect(response.status()).toBe(200);
  const payload = await response.json() as Envelope<any>;
  expect(payload.code).toBe(0);
  return payload.data;
}

async function patchParam(page: Page, key: string, commandKey: string, data: Record<string, unknown>): Promise<APIResponse> {
  return page.request.patch(`/api/admin/users/registration-risk/params/${key}`, {
    headers: { "Idempotency-Key": commandKey },
    data,
  });
}

test.beforeAll(() => {
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(screenshotDir, { recursive: true });
});

test("C6 首次用户：事实统计、结构化锁定编辑和服务端回读闭环", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await loginAndOpenC6(page);
  pageErrors.length = 0;
  consoleErrors.length = 0;

  const body = await page.locator("body").innerText();
  expect(body).toContain("今日 OTP 发送");
  expect(body).toContain("今日登录锁定");
  expect(body).toContain("验证码挑战事实");
  expect(body).not.toMatch(/nx_[a-z_]+/i);
  expect(body).not.toContain("admin.auth_config_changed");

  const shortRow = page.locator(".p-row").filter({ hasText: "短锁" }).first();
  const original = (await shortRow.locator(".v").innerText()).trim();
  const numbers = original.match(/\d+/g)?.map(Number) ?? [];
  expect(numbers).toHaveLength(2);
  const nextDuration = numbers[1] >= 60 ? numbers[1] - 1 : numbers[1] + 1;

  await shortRow.getByRole("button", { name: "调整", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("触发次数", { exact: true })).toHaveAttribute("type", "number");
  await expect(dialog.getByLabel("锁定时长(分钟)", { exact: true })).toHaveAttribute("min", "5");
  await dialog.getByLabel("锁定时长(分钟)", { exact: true }).fill(String(nextDuration));
  await dialog.locator("textarea").fill("C6 浏览器复验结构化双字段原子写入并回读服务端真值");
  const writeResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().includes("/registration-risk/params/lockShort"));
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const writeResponse = await writeResponsePromise;
  expect(writeResponse.status()).toBe(200);
  const writePayload = await writeResponse.json() as Envelope<any>;
  expect(writePayload.code).toBe(0);
  await expect(shortRow.locator(".v")).toContainText(`${numbers[0]} 次 / ${nextDuration} 分钟`);

  const latest = await overview(page);
  const restoreResponse = await patchParam(page, "lockShort", `c6-e2e-restore-${Date.now()}`, {
    value: original,
    reason: "C6 浏览器复验完成后恢复短锁原始参数",
    operator: "forged-browser-operator",
    expectedVersion: latest.configVersion,
  });
  expect((await restoreResponse.json() as Envelope).code).toBe(0);
  await page.reload();
  await expect(shortRow.locator(".v")).toContainText(original);

  await page.screenshot({ path: path.join(screenshotDir, "01-c6-first-user-and-structured-lock.png"), fullPage: true });
  fs.writeFileSync(path.join(rawDir, "first-user-result.json"), JSON.stringify({
    original,
    temporary: `${numbers[0]} 次 / ${nextDuration} 分钟`,
    writeCode: writePayload.code,
    restored: true,
    pageErrors,
    consoleErrors,
  }, null, 2), "utf8");
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("C6 墨菲边界：并发版本冲突和同键重放不会产生双写", async ({ page }) => {
  await loginAndOpenC6(page);
  const before = await overview(page);
  const short = before.params.find((row: any) => row.key === "lockShort");
  expect(short).toBeTruthy();
  const body = {
    value: short.value,
    reason: "C6 并发复验相同配置只允许一个版本胜出",
    operator: "forged-browser-operator",
    expectedVersion: before.configVersion,
  };

  const pair = await Promise.all([
    patchParam(page, "lockShort", `c6-race-a-${Date.now()}`, body),
    patchParam(page, "lockShort", `c6-race-b-${Date.now()}`, body),
  ]);
  const pairPayloads = await Promise.all(pair.map((response) => response.json() as Promise<Envelope>));
  expect(pairPayloads.map((payload) => payload.code).sort((a, b) => a - b)).toEqual([0, 409]);
  const afterRace = await overview(page);
  expect(afterRace.configVersion).toBe(before.configVersion + 1);

  const replayKey = `c6-replay-${Date.now()}`;
  const replayBody = { ...body, expectedVersion: afterRace.configVersion, reason: "C6 同键重放复验不得重复增加配置版本" };
  const first = await patchParam(page, "lockShort", replayKey, replayBody);
  const second = await patchParam(page, "lockShort", replayKey, replayBody);
  const firstPayload = await first.json() as Envelope;
  const secondPayload = await second.json() as Envelope;
  expect(firstPayload.code).toBe(0);
  expect(secondPayload.code).toBe(0);
  const afterReplay = await overview(page);
  expect(afterReplay.configVersion).toBe(afterRace.configVersion + 1);

  fs.writeFileSync(path.join(rawDir, "concurrency-idempotency-result.json"), JSON.stringify({
    beforeVersion: before.configVersion,
    raceCodes: pairPayloads.map((payload) => payload.code),
    afterRaceVersion: afterRace.configVersion,
    replayCodes: [firstPayload.code, secondPayload.code],
    afterReplayVersion: afterReplay.configVersion,
  }, null, 2), "utf8");
});

test("C6 墨菲边界：CAPTCHA 只接受白名单时限并显示绝对恢复时刻", async ({ page }) => {
  await loginAndOpenC6(page);
  const current = await overview(page);
  const invalid = await patchParam(page, "captchaOff", `c6-invalid-window-${Date.now()}`, {
    value: "https://status.example.com",
    reason: "C6 复验拒绝任意文本和外部链接恢复时限",
    operator: "forged-browser-operator",
    expectedVersion: current.configVersion,
  });
  const invalidPayload = await invalid.json() as Envelope;
  expect(invalidPayload.code).toBe(422);
  expect(invalidPayload.message).toBe("CAPTCHA_RESTORE_WINDOW_REJECTED");

  await page.getByRole("button", { name: "紧急关闭", exact: true }).click();
  const disableDialog = page.getByRole("dialog");
  await disableDialog.getByRole("button", { name: "30 分钟后自动恢复", exact: true }).click();
  await disableDialog.locator("textarea").fill("C6 浏览器复验紧急关闭必须绑定服务端绝对恢复时刻");
  const disableResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().includes("/registration-risk/params/captchaOff"));
  await disableDialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const disablePayload = await (await disableResponsePromise).json() as Envelope<any>;
  expect(disablePayload.code).toBe(0);
  expect(String(disablePayload.data.value)).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  await expect(page.getByText(/服务端自动恢复：/)).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, "02-c6-captcha-absolute-deadline.png"), fullPage: true });

  await page.getByRole("button", { name: "立即恢复", exact: true }).click();
  const restoreDialog = page.getByRole("dialog");
  await restoreDialog.locator("textarea").fill("C6 浏览器复验完成后立即恢复人机验证安全闸");
  await restoreDialog.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(page.getByRole("button", { name: "紧急关闭", exact: true })).toBeVisible();
  const restored = await overview(page);
  expect(restored.stats.captchaTemporarilyDisabled).toBe(false);

  fs.writeFileSync(path.join(rawDir, "captcha-result.json"), JSON.stringify({
    invalidCode: invalidPayload.code,
    invalidMessage: invalidPayload.message,
    persistedDeadline: disablePayload.data.value,
    restored: !restored.stats.captchaTemporarilyDisabled,
  }, null, 2), "utf8");
});

test("C6 墨菲边界：畸形成功响应清空旧数据并停止写操作", async ({ page }) => {
  await page.route("**/api/admin/users/registration-risk/overview", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 0, message: "success", data: { unexpectedShape: true } }),
    });
  });
  await page.goto("/");
  await page.getByLabel(/用户名|账号/).fill(e2eUsername);
  await page.getByLabel(/密码/).fill(e2ePassword());
  await page.getByRole("button", { name: /继续/ }).click();
  await expect(page.getByRole("heading", { name: "运营总览" })).toBeVisible();
  await page.goto("/users/reg-risk");
  await expect(page.getByRole("alert").filter({ hasText: "C6 数据加载失败" })).toContainText("数据加载失败");
  await expect(page.getByRole("button", { name: "重新加载", exact: true })).toBeVisible();
  await expect(page.getByText("今日 OTP 发送", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "调整", exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(screenshotDir, "03-c6-malformed-response-fail-closed.png"), fullPage: true });
});
