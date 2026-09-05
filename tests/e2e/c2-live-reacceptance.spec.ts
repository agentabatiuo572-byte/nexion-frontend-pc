import { mkdir } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })());
const EVIDENCE_DIR = process.env.C2_EVIDENCE_DIR || "D:/workspace/bug-pic/c2-reacceptance-20260718/main";

type Envelope<T> = { code: number; message?: string; data: T };
type Account = { id: number; userNo: string; status: string };
type Overview = { accounts: Account[]; totalAccounts: number; totalAccountLists: number; totalSessions: number; totalImpersonations: number };

test("C2 real first-user flow closes account, list and read-only impersonation loops", async ({ page }) => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const anonymous = await page.request.get("/api/admin/users/account-actions/overview");
  expect(anonymous.status()).toBe(401);

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await loginThroughUi(page);

  const overviewResponse = await page.request.get("/api/admin/users/account-actions/overview");
  expect(overviewResponse.ok()).toBeTruthy();
  const overview = await envelope<Overview>(overviewResponse);
  const account = overview.accounts.find((row) => row.status === "ACTIVE");
  expect(account?.userNo).toBeTruthy();
  expect(overview.totalAccounts).toBeGreaterThanOrEqual(overview.accounts.length);
  expect(overview.totalAccountLists).toBeGreaterThanOrEqual(0);
  expect(overview.totalSessions).toBeGreaterThanOrEqual(0);
  expect(overview.totalImpersonations).toBeGreaterThanOrEqual(0);
  const userNo = account!.userNo;

  await page.goto(`/users/actions?userCode=${encodeURIComponent(userNo)}`);
  await expect(page.getByText("账户处置", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/所有动作均要求 8-200 字理由、24 小时幂等、必达审计与事件/)).toBeVisible();
  await expect(page.getByText(/已按服务器查询结果打开该用户的 C2 处置上下文/)).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/01-c2-overview.png`, fullPage: true });
  const accountDetail = page.getByRole("dialog").filter({ hasText: `账户明细 · ${userNo}` });
  await expect(accountDetail).toBeVisible();
  await accountDetail.getByRole("button", { name: "关闭", exact: true }).click();

  const accountRow = page.locator("tbody tr").filter({ hasText: userNo }).first();
  await expect(accountRow).toBeVisible();
  await accountRow.getByRole("button", { name: "冻结", exact: true }).click();
  const freezeDialog = page.getByRole("dialog");
  await expect(freezeDialog).toContainText("确认后立即落库，并写必达审计与事件。");
  await expect(freezeDialog.getByRole("button", { name: "确认提交" })).toBeDisabled();
  await freezeDialog.getByLabel(/操作理由/).fill("C2浏览器验收冻结闭环");
  await freezeDialog.getByRole("button", { name: "确认提交" }).click();
  await expect(accountRow.getByRole("button", { name: "恢复", exact: true })).toBeVisible();

  await accountRow.getByRole("button", { name: "恢复", exact: true }).click();
  await confirmDialog(page.getByRole("dialog"), "C2浏览器验收恢复闭环");
  await expect(accountRow.getByRole("button", { name: "冻结", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "发起模拟登录", exact: true }).click();
  const impersonationDialog = page.getByRole("dialog");
  await impersonationDialog.getByLabel("用户编码或后端ID").fill(userNo);
  await impersonationDialog.getByLabel("有效期").selectOption("15");
  await impersonationDialog.getByLabel("授权分类").selectOption("USER_ISSUE_REPRO");
  await confirmDialog(impersonationDialog, "C2浏览器验收只读镜像");

  const mirror = page.getByRole("dialog").filter({ hasText: "用户 H5 只读镜像" });
  await expect(mirror).toBeVisible();
  await expect(mirror.getByText(/claim=impersonate_readonly/)).toBeVisible();
  await expect(mirror.getByText(/写策略=DENY/)).toBeVisible();
  await expect(mirror.getByTestId("impersonation-countdown")).toHaveText(/^\d+:\d{2}$/);
  await expect(mirror.getByText("当前页签：HOME", { exact: false })).toBeVisible();
  await expect(mirror.getByTestId("impersonation-home-screen")).toContainText("用户视角首页");
  await mirror.getByRole("button", { name: "钱包", exact: true }).click();
  await expect(mirror.getByText("当前页签：WALLET", { exact: false })).toBeVisible();
  await expect(mirror.getByTestId("impersonation-wallet-screen")).toContainText("用户视角钱包");
  await mirror.getByRole("button", { name: "设备", exact: true }).click();
  await expect(mirror.getByText("当前页签：DEVICES", { exact: false })).toBeVisible();
  await expect(mirror.getByTestId("impersonation-devices-screen")).toContainText("用户视角设备");
  await mirror.getByRole("button", { name: "我的", exact: true }).click();
  await expect(mirror.getByText("当前页签：PROFILE", { exact: false })).toBeVisible();
  await expect(mirror.getByTestId("impersonation-profile-screen")).toContainText("用户视角我的");
  await expect(mirror.getByRole("button", { name: /保存|提交|购买|提现|转账/ })).toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE_DIR}/02-readonly-mirror.png`, fullPage: true });
  await mirror.getByRole("button", { name: "退出并终止模拟会话", exact: true }).click();
  await confirmDialog(page.getByRole("dialog"), "C2浏览器验收终止镜像");
  await expect(mirror).toHaveCount(0);
  const terminatedImpersonation = page.locator(".imp-row").filter({ hasText: userNo }).filter({ hasText: "已终止" }).first();
  await expect(terminatedImpersonation).toBeVisible();

  await page.getByRole("button", { name: "+ 加入禁入名单", exact: true }).click();
  const addListDialog = page.getByRole("dialog");
  await addListDialog.getByLabel("用户编码或后端ID").fill(userNo);
  await addListDialog.getByLabel("有效期").selectOption("PERMANENT");
  await confirmDialog(addListDialog, "C2浏览器验收名单加入");
  const listRow = page.locator("tbody tr").filter({ hasText: userNo }).filter({ hasText: "C2浏览器验收名单加入" }).first();
  await expect(listRow.getByText("生效中", { exact: true })).toBeVisible();
  await listRow.getByRole("button", { name: "移出名单", exact: true }).click();
  await confirmDialog(page.getByRole("dialog"), "C2浏览器验收名单移除");
  await expect(listRow.getByText("已移出", { exact: true })).toBeVisible();

  const exactLookup = await page.request.get(`/api/admin/users/account-actions/accounts/${encodeURIComponent(userNo)}`);
  expect(exactLookup.ok()).toBeTruthy();
  expect((await envelope<Account>(exactLookup)).status).toBe("ACTIVE");
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: `${EVIDENCE_DIR}/03-c2-clean-final-state.png`, fullPage: true });
});

async function loginThroughUi(page: Page) {
  await page.goto("/users/actions");
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await username.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /登录|继续/ }).click();
  }
  await expect(page.getByText("账户处置", { exact: true }).first()).toBeVisible();
}

async function confirmDialog(dialog: Locator, reason: string) {
  await dialog.getByLabel(/操作理由/).fill(reason);
  await expect(dialog.getByRole("button", { name: "确认提交" })).toBeEnabled();
  await dialog.getByRole("button", { name: "确认提交" }).click();
}

async function envelope<T>(response: { json(): Promise<unknown> }) {
  const body = await response.json() as Envelope<T>;
  expect(body.code).toBe(0);
  return body.data;
}
