import { expect, test } from "@playwright/test";

test("PC 登录密码框按 Enter 只提交一次", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/admin/auth/login", async (route) => {
    attempts += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ code: "INVALID_CREDENTIALS", message: "invalid test credentials" }),
    });
  });

  await page.goto("/");
  await page.getByLabel("账号").fill("keyboard-enter-test");
  const password = page.getByLabel("密码");
  await password.fill("invalid-test-password");

  const request = page.waitForRequest((candidate) =>
    candidate.method() === "POST" && candidate.url().includes("/api/admin/auth/login"),
  );
  await password.press("Enter");
  await password.press("Enter");
  await request;
  await expect.poll(() => attempts).toBe(1);
});
