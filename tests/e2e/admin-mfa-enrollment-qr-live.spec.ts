import { expect, test } from "@playwright/test";

const baseURL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const username = process.env.ADMIN_E2E_USERNAME ?? "";
const password = process.env.ADMIN_E2E_PASSWORD ?? "";

test.use({ trace: "off", video: "off", screenshot: "off" });

test("a reset admin account receives a locally rendered Google Authenticator QR", async ({ page }) => {
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(baseURL).hostname);
  expect(username).not.toBe("");
  expect(password).not.toBe("");

  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);

  const loginResponsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/login"
  ));
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const loginResponse = await loginResponsePromise;
  const payload = await loginResponse.json() as {
    code?: number;
    data?: { mfa?: { mode?: string; provisioningUri?: string; manualKey?: string } };
  };

  expect(loginResponse.status()).toBe(200);
  expect(payload.code).toBe(0);
  expect(payload.data?.mfa?.mode).toBe("ENROLL");
  expect(Boolean(payload.data?.mfa?.provisioningUri)).toBe(true);
  expect(Boolean(payload.data?.mfa?.manualKey)).toBe(true);

  await expect(page.getByRole("heading", { name: "双因素身份验证" })).toBeVisible();
  await page.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>('img[alt="Google Authenticator 绑定二维码"]');
    return Boolean(image?.complete && image.naturalWidth > 0);
  });

  const safeUiState = await page.evaluate(() => {
    const image = document.querySelector<HTMLImageElement>('img[alt="Google Authenticator 绑定二维码"]');
    return {
      qrPresent: Boolean(image),
      qrIsLocalDataUrl: image?.src.startsWith("data:image/gif;base64,") ?? false,
      qrWidth: image?.naturalWidth ?? 0,
      manualFallbackPresent: Boolean(document.querySelector("code")),
      otpPresent: Boolean(document.querySelector('input[autocomplete="one-time-code"]')),
    };
  });
  expect(safeUiState).toEqual({
    qrPresent: true,
    qrIsLocalDataUrl: true,
    qrWidth: expect.any(Number),
    manualFallbackPresent: true,
    otpPresent: true,
  });
  expect(safeUiState.qrWidth).toBeGreaterThan(0);
});
