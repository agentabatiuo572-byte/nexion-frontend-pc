import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  assertLocalFCandidate,
  currentFRunId,
  loadFMaker,
  loginFActor,
} from "./helpers/f-acceptance-harness";

const RUN_ID = currentFRunId();
const F_MAKER = loadFMaker(RUN_ID);
const EVIDENCE_DIR =
  process.env.F_ACCEPTANCE_EVIDENCE_DIR ||
  `D:/workspace/bug-pic/.restricted/${RUN_ID}/F/owner`;

type ModuleCase = {
  id: "F1" | "F2" | "F3" | "F4" | "F5";
  path: string;
  endpoint: string;
  marker: string;
};

const MODULES: ModuleCase[] = [
  { id: "F1", path: "/network/v-rank", endpoint: "/api/admin/teams/ranks", marker: "V-Rank 13 阶阶梯" },
  { id: "F2", path: "/network/royalty", endpoint: "/api/admin/teams/rates", marker: "F2 网络版税费率" },
  { id: "F3", path: "/network/binary", endpoint: "/api/admin/teams/binary", marker: "平衡匹配公式" },
  { id: "F4", path: "/network/leadership-pool", endpoint: "/api/admin/teams/leadership-pool", marker: "V 级票数权重 · 领导池分配依据" },
  { id: "F5", path: "/network/commissions", endpoint: "/api/admin/teams/commissions", marker: "F5 佣金事件审计" },
];

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  assertLocalFCandidate();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("F1-F5 从登录页和可见侧栏逐模块走查，读取服务端权威数据", async ({ page }) => {
  await login(page);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const unexpected5xx: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (/\/api\/admin\//.test(response.url()) && response.status() >= 500) {
      unexpected5xx.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  await expandNetworkGroup(page);
  const snapshots: Record<string, unknown> = {};
  for (const item of MODULES) {
    const entry = page.locator(`aside a[href="${item.path}"]`);
    await expect(entry, `${item.id} 必须从授权后的可见侧栏进入`).toBeVisible();
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(item.endpoint) &&
        response.request().method() === "GET" &&
        response.status() === 200,
    );
    await entry.click();
    await responsePromise;
    await expect(page).toHaveURL(new RegExp(`${item.path.replaceAll("/", "\\/")}$`));
    await expect(page.getByText(item.marker, { exact: false }).first()).toBeVisible();

    const apiResponse = await page.request.get(item.endpoint);
    expect(apiResponse.status(), `${item.id} 真实读接口`).toBe(200);
    const body = await apiResponse.json();
    expect(body.code).toBe(0);
    expect(body.data.domain).toBe(item.id);
    snapshots[item.id] = body.data;
    await page.screenshot({ path: `${EVIDENCE_DIR}/01-${item.id.toLowerCase()}-visible-entry.png`, fullPage: true });
  }

  expect((snapshots.F1 as { vrankRows: unknown[] }).vrankRows).toHaveLength(13);
  expect((snapshots.F2 as { unilevelRates: unknown[] }).unilevelRates).toHaveLength(7);
  expect(Array.isArray((snapshots.F3 as { settlements: unknown[] }).settlements)).toBe(true);
  expect((snapshots.F4 as { voteWeights: unknown[] }).voteWeights.length).toBeGreaterThan(0);
  expect((snapshots.F5 as { commissionKinds: unknown[] }).commissionKinds).toHaveLength(6);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(unexpected5xx).toEqual([]);
  writeFileSync(
    `${EVIDENCE_DIR}/01-server-snapshots.json`,
    JSON.stringify({ snapshots, pageErrors, consoleErrors, unexpected5xx }, null, 2),
    "utf8",
  );
});

test("F1-F5 主流程、空态、确认取消与跨域入口均可操作且不产生写入", async ({ page }) => {
  await login(page);

  await enterFromSidebar(page, MODULES[0]);
  await expect(page.locator(".lrow")).toHaveCount(13);
  await expect(page.locator('section[aria-label="晋升流水"]')).toBeVisible();
  await expect(page.locator('section[aria-label="奖励派发流水"]')).toBeVisible();
  await page.getByLabel("晋升用户ID").fill("999999999");
  const promotionResponse = page.waitForResponse(
    (response) => response.url().includes("/api/admin/teams/promotion-log") && response.status() === 200,
  );
  await page.locator('section[aria-label="晋升流水"]').getByRole("button", { name: "查询" }).click();
  await promotionResponse;
  await expect(page.locator('section[aria-label="晋升流水"]')).toContainText(/暂无|无晋升流水/);

  await enterFromSidebar(page, MODULES[1]);
  await expect(page.locator(".casc-row")).toHaveCount(7);
  await expect(page.getByText("Partner Status", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "调整权益门槛" }).click();
  await expect(page.getByRole("dialog")).toContainText(/Partner Status|权益门槛/);
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();

  await enterFromSidebar(page, MODULES[2]);
  await expect(page.getByText(/H1 派发 · 只读/)).toBeVisible();
  await expect(page.getByRole("link", { name: /前往 F5 补发.*冲正/ })).toHaveAttribute(
    "href",
    "/network/commissions",
  );
  await page.getByRole("button", { name: "调整周期 & 策略" }).click();
  await expect(page.getByRole("dialog")).toContainText(/每日/);
  await expect(page.getByRole("dialog")).toContainText(/转结/);
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
  await page.getByRole("button", { name: /暂停引擎|恢复引擎/ }).click();
  await expect(page.getByRole("dialog")).toContainText(/全平台|A2/);
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();

  await enterFromSidebar(page, MODULES[3]);
  const f4Text = await page.locator("main").innerText();
  expect(f4Text).toMatch(/领导奖池/);
  expect(f4Text).toMatch(/硬件配额/);
  expect(f4Text).toMatch(/区域大使确认/);
  expect(f4Text).toMatch(/排行榜 · 反欺诈/);
  await page.getByRole("button", { name: "结算周期" }).click();
  await expect(page.getByRole("dialog")).toContainText(/cron|下一周期/);
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();

  await enterFromSidebar(page, MODULES[4]);
  await page.getByLabel("用户 ID").fill("999999999");
  const commissionResponse = page.waitForResponse(
    (response) => response.url().includes("/api/admin/teams/commissions?") && response.status() === 200,
  );
  await page.getByRole("button", { name: "服务端筛选" }).click();
  await commissionResponse;
  await expect(page.getByText("当前筛选无佣金事件；筛选器和处置入口仍可用")).toBeVisible();
  for (const link of ["D4 账本", "B1 覆盖率", "L4 运营分析", "A2 审批审计", "A4 事件中心"]) {
    await expect(page.getByRole("link", { name: link })).toBeVisible();
  }
  await page.screenshot({ path: `${EVIDENCE_DIR}/02-main-empty-cancel-cross-domain.png`, fullPage: true });
});

test("F1-F5 刷新、返回、退出重登后仍从同一服务端恢复", async ({ page }) => {
  await login(page);
  for (const item of MODULES) {
    await enterFromSidebar(page, item);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(item.marker, { exact: false }).first()).toBeVisible();
  }

  await page.request.post("/api/admin/auth/logout");
  await page.goto("/network/commissions", { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
  await login(page);
  await enterFromSidebar(page, MODULES[4]);
  await expect(
    page.locator("main").getByText("F5 佣金事件审计", { exact: true }).first(),
  ).toBeVisible();
  await page.goBack({ waitUntil: "domcontentloaded" });
  await expect(page.locator("aside")).toBeVisible();
  await page.goForward({ waitUntil: "domcontentloaded" });
  await expect(
    page.locator("main").getByText("F5 佣金事件审计", { exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/03-refresh-relogin-history.png`, fullPage: true });
});

test("F1-F5 匿名读写全部失败关闭", async () => {
  const anonymous = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:3002" });
  const reads = await Promise.all(MODULES.map((item) => anonymous.get(item.endpoint)));
  expect(reads.map((response) => response.status())).toEqual([401, 401, 401, 401, 401]);

  const writes = await Promise.all([
    anonymous.patch("/api/admin/teams/ranks/V1/thresholds/selfBuy", {
      headers: { "Idempotency-Key": "f-anon-f1" },
      data: { value: "$299", reason: "F1 anonymous must fail closed" },
    }),
    anonymous.patch("/api/admin/teams/commissions/config/F.unilevel.L1", {
      headers: { "Idempotency-Key": "f-anon-f2" },
      data: { value: "10%", reason: "F2 anonymous must fail closed" },
    }),
    anonymous.post("/api/admin/teams/binary/settlements", {
      headers: { "Idempotency-Key": "f-anon-f3" },
      data: { ownerUserId: 1, settlementDate: "2026-07-28", reason: "F3 anonymous must fail closed" },
    }),
    anonymous.post("/api/admin/teams/leadership-pool/settle", {
      headers: { "Idempotency-Key": "f-anon-f4" },
      data: { reason: "F4 anonymous must fail closed" },
    }),
    anonymous.post("/api/admin/teams/commissions/reissue", {
      headers: { "Idempotency-Key": "f-anon-f5" },
      data: { commissionIds: ["CM-DOES-NOT-EXIST"], reason: "F5 anonymous must fail closed" },
    }),
  ]);
  expect(writes.map((response) => response.status())).toEqual([401, 401, 401, 401, 401]);
  await anonymous.dispose();
});

async function login(page: Page) {
  await loginFActor(page, F_MAKER, "f-owner-maker");
}

async function expandNetworkGroup(page: Page) {
  const group = page.getByRole("button", { name: /分销与团队/ });
  await expect(group).toBeVisible();
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
}

async function enterFromSidebar(page: Page, item: ModuleCase) {
  await expandNetworkGroup(page);
  const entry = page.locator(`aside a[href="${item.path}"]`);
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(new RegExp(`${item.path.replaceAll("/", "\\/")}$`));
  await expect(page.getByText(item.marker, { exact: false }).first()).toBeVisible();
}
