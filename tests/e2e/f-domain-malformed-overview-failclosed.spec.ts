import { expect, test, type Page } from "@playwright/test";
import {
  assertLocalFCandidate,
  currentFRunId,
  loadFMaker,
  loginFActor,
} from "./helpers/f-acceptance-harness";

const RUN_ID = currentFRunId();
const F_MAKER = loadFMaker(RUN_ID);

test.beforeAll(() => {
  assertLocalFCandidate();
});

const MODULES = [
  {
    id: "F1",
    path: "/network/v-rank",
    api: "/api/admin/teams/ranks",
    error: /F1 数据加载失败/,
  },
  {
    id: "F2",
    path: "/network/royalty",
    api: "/api/admin/teams/rates",
    error: /F2 数据加载失败/,
  },
  {
    id: "F3",
    path: "/network/binary",
    api: "/api/admin/teams/binary",
    error: /F3 数据加载失败/,
  },
  {
    id: "F4",
    path: "/network/leadership-pool",
    api: "/api/admin/teams/leadership-pool",
    error: /F4 数据加载失败/,
  },
  {
    id: "F5",
    path: "/network/commissions",
    api: "/api/admin/teams/commissions",
    error: /加载失败.*F5_OVERVIEW_RESPONSE_INVALID/,
  },
] as const;

test.describe("F1-F5 malformed 200 fail closed", () => {
  for (const module of MODULES) {
    test(`${module.id} rejects an incomplete successful envelope`, async ({ page }) => {
      await login(page);
      await page.route(`**${module.api}**`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ code: 0, message: "OK", data: {} }),
        });
      });

      const group = page.getByRole("button", { name: /分销与团队/ }).first();
      if (await group.isVisible().catch(() => false)
        && (await group.getAttribute("aria-expanded")) !== "true") {
        await group.click();
      }
      const entry = page.locator(`aside a[href="${module.path}"]`).first();
      await expect(entry).toBeVisible();
      await entry.click();
      await expect(page).toHaveURL(new RegExp(`${module.path.replaceAll("/", "\\/")}$`));
      await expect(page.getByText(module.error).first()).toBeVisible();
      if (module.id === "F5") {
        await expect(page.getByRole("button", { name: /批量补发/ })).toHaveCount(0);
        await expect(page.getByText(/佣金权威快照不可用，批量补发已暂停。/)).toBeVisible();
        await page.unroute(`**${module.api}**`);
        const restored = page.waitForResponse((candidate) =>
          candidate.request().method() === "GET"
          && new URL(candidate.url()).pathname === module.api
          && candidate.status() === 200,
        );
        await page.getByRole("button", { name: "重试", exact: true }).click();
        await restored;
        await expect(page.getByText(module.error)).toHaveCount(0);
        await expect(page.getByRole("button", { name: /批量补发/ })).toHaveCount(1);
      }
    });
  }
});

async function login(page: Page) {
  await loginFActor(page, F_MAKER, "f-malformed-maker");
}
