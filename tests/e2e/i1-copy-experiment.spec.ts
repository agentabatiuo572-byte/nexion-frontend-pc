import { expect, test } from "@playwright/test";

test("I1 用同一文案版本创建实验，并经确认启动 scheduled 实验", async ({ page }) => {
  const writes: Array<{ pathname: string; body: Record<string, unknown> }> = [];
  let experimentCreated = false;
  await page.route("**/api/admin/auth/session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ code: 0, data: { tokenType: "Bearer", session: {
      adminId: 1, username: "superadmin", operator: "总管理员", role: "superadmin", roleCode: "superadmin",
      authorities: ["content_i1_read", "content_i1_write", "content_i1_experiment_manage"], effectiveMenus: ["I1"], passwordChangeRequired: false,
    } } }),
  }));

  await page.route("**/api/admin/content/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      writes.push({ pathname: url.pathname, body: request.postDataJSON() as Record<string, unknown> });
      if (url.pathname.endsWith("/copy-ab/experiments")) experimentCreated = true;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: 200, data: {} }) });
      return;
    }
    if (!url.pathname.endsWith("/copy-ab/overview")) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: 200, data: {} }) });
      return;
    }
    const audienceTarget = { tiers: ["P1", "P2", "P3"], locales: ["vi"], registrationDaysMin: 8, registrationDaysMax: null };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ code: 200, data: {
        stats: { managedCopies: 1, runningExps: 0, weeklyExposures: "0", topLift: "—" },
        copies: [{ key: "home.hero", desc: "首页主横幅", surface: "home", version: "v2", status: "published", i18nKey: "home.hero", expId: experimentCreated ? "EXP-SCHEDULED" : "", lastChange: "刚刚", copyPosition: "home.hero" }],
        versions: [
          { copyKey: "home.hero", version: "v1", status: "archived", chain: "创建 → 归档", ts: "昨天", zh: "欢迎", vi: "Chào mừng", en: "Welcome", copyPosition: "home.hero", surface: "home", audience: "P1-P3 · VI · 注册>7天", audienceTarget, estimatedAudience: 18420, trafficSplit: "50", versionNote: "基础版" },
          { copyKey: "home.hero", version: "v2", status: "published", chain: "创建 → 发布", ts: "今天", zh: "欢迎回来", vi: "Chào mừng trở lại", en: "Welcome back", copyPosition: "home.hero", surface: "home", audience: "P1-P3 · VI · 注册>7天", audienceTarget, estimatedAudience: 18420, trafficSplit: "50", versionNote: "优化版" },
          { copyKey: "home.hero", version: "v3", status: "draft", chain: "草稿", ts: "刚刚", zh: "草稿", vi: "Bản nháp", en: "Draft", copyPosition: "home.hero", surface: "home", audience: "P1-P3 · VI · 注册>7天", audienceTarget, estimatedAudience: 18420, trafficSplit: "50", versionNote: "草稿" },
        ],
        experiments: [
          ...(experimentCreated ? [{ id: "EXP-SCHEDULED", copyKey: "home.hero", variants: [{ name: "A · v1", split: 50, cvr: 0 }, { name: "B · v2", split: 50, cvr: 0 }], audience: "P1-P3 · VI · 注册>7天", estimatedAudience: 18420, impressions: "0", conversions: "0", state: "scheduled", note: "等待启动" }] : []),
          { id: "EXP-CONCLUDED", copyKey: "earn.offer", variants: [{ name: "A · v1", split: 50, cvr: 5.2 }, { name: "B · v2", split: 50, cvr: 5.9 }], audience: "P1-P3 · VI · 注册>7天", estimatedAudience: 18420, impressions: "18,000", conversions: "999", state: "concluded", note: "已结算" },
        ],
        frameworkParams: [], positions: [{ positionKey: "home.hero", name: "首页主横幅", surface: "home", status: "ACTIVE", sortOrder: 1 }],
        versionOptions: [{ versionKey: "v1", name: "基础版", status: "ACTIVE", sortOrder: 1, revision: 1 }, { versionKey: "v2", name: "优化版", status: "ACTIVE", sortOrder: 2, revision: 1 }, { versionKey: "v3", name: "草稿版", status: "ACTIVE", sortOrder: 3, revision: 1 }],
        surfaces: ["home", "store", "earn", "me"], audiences: [], trafficSplits: ["50"], tables: [],
      } }),
    });
  });

  await page.goto("/content/copy-ab", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load", { timeout: 60000 });
  const createButton = page.getByRole("button", { name: "+ 创建 A/B 实验" });
  await expect(createButton).toBeVisible();
  await createButton.click();
  const createForm = page.locator('[data-business-form="copy-experiment-create"]');
  await expect(createForm).toBeVisible();
  await expect(createForm.getByLabel("变体 A 内容版本").locator("option")).toHaveCount(2);
  await expect(createForm.getByText("P 阶段 P1-P3")).toBeVisible();
  await expect(createForm.getByText(/预计覆盖 18,420 人/)).toBeVisible();
  await createForm.getByLabel("变体 A 分流比例").fill("60");
  await createForm.getByLabel("变体 B 分流比例").fill("40");
  const createDialog = page.getByRole("dialog");
  await createDialog.getByPlaceholder("例: 工单号 / 业务依据 / 影响面 / 回滚预案").fill("验证首页主横幅转化提升");
  await createDialog.getByRole("button", { name: "确认执行" }).click();
  await expect.poll(() => writes.find((item) => item.pathname.endsWith("/copy-ab/experiments"))).toBeTruthy();
  const createWrite = writes.find((item) => item.pathname.endsWith("/copy-ab/experiments"));
  expect(createWrite?.body).toMatchObject({ copyKey: "home.hero", variants: [{ version: "v1", splitPct: 60 }, { version: "v2", splitPct: 40 }], reason: "验证首页主横幅转化提升" });

  await page.getByRole("button", { name: "启动实验" }).click();
  const startDialog = page.getByRole("dialog");
  const confirm = startDialog.getByRole("button", { name: "确认执行" });
  await expect(confirm).toBeDisabled();
  await startDialog.getByRole("checkbox").check();
  const reason = startDialog.getByPlaceholder("例: 工单号 / 业务依据 / 影响面 / 回滚预案");
  await expect(reason).toHaveAttribute("maxlength", "200");
  await reason.fill("版本与分流已由内容负责人复核");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect.poll(() => writes.find((item) => item.pathname.endsWith("/copy-ab/experiments/EXP-SCHEDULED/start"))).toBeTruthy();
  const startWrite = writes.find((item) => item.pathname.endsWith("/copy-ab/experiments/EXP-SCHEDULED/start"));
  expect(startWrite?.body).toMatchObject({ reason: "版本与分流已由内容负责人复核" });
  expect(startWrite?.body).not.toHaveProperty("confirmed");

  const concludedRow = page.locator("tbody tr").filter({ hasText: "EXP-CONCLUDED" });
  await concludedRow.getByRole("button", { name: "弃用实验" }).click();
  const discardDialog = page.getByRole("dialog");
  await expect(discardDialog).toContainText("弃用后不能再次启动或采纳");
  const discardReason = discardDialog.getByPlaceholder("例: 工单号 / 业务依据 / 影响面 / 回滚预案");
  await expect(discardReason).toHaveAttribute("maxlength", "200");
  await discardReason.fill("实验结论不具备业务采纳价值");
  await discardDialog.getByRole("button", { name: "确认执行" }).click();
  await expect.poll(() => writes.find((item) => item.pathname.endsWith("/copy-ab/experiments/EXP-CONCLUDED/discard"))).toBeTruthy();
  expect(writes.find((item) => item.pathname.endsWith("/copy-ab/experiments/EXP-CONCLUDED/discard"))?.body)
    .toMatchObject({ reason: "实验结论不具备业务采纳价值" });
});
