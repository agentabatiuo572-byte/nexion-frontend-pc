import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const evidenceDir = "D:/workspace/bug-pic/c4-acceptance-20260719/first-user";
const exportReason = "C4 独立首次用户验收：验证脱敏导出任务、审计与刷新闭环";
const exportJobFile = path.join(evidenceDir, "raw", "created-export-job.json");

type Logs = { pageErrors: string[]; consoleErrors: string[]; allConsole: string[]; network: string[]; httpErrors: string[]; businessMutations: string[] };

function installLogs(page: import("@playwright/test").Page): Logs {
  const logs: Logs = { pageErrors: [], consoleErrors: [], allConsole: [], network: [], httpErrors: [], businessMutations: [] };
  page.on("pageerror", (error) => logs.pageErrors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    logs.allConsole.push(`${message.type().toUpperCase()} ${message.text()}`);
    if (message.type() === "error") logs.consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    const line = `${response.status()} ${response.request().method()} ${response.url()}`;
    logs.network.push(line);
    if (response.status() >= 400) logs.httpErrors.push(line);
  });
  page.on("request", (request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && !request.url().includes("/api/admin/auth/")) logs.businessMutations.push(`${request.method()} ${request.url()}`);
  });
  return logs;
}

function resetBusinessLogs(logs: Logs) {
  logs.pageErrors.length = 0;
  logs.consoleErrors.length = 0;
  logs.network.length = 0;
  logs.httpErrors.length = 0;
  logs.businessMutations.length = 0;
}

function saveLogs(prefix: string, logs: Logs) {
  fs.writeFileSync(path.join(evidenceDir, "raw", `${prefix}-page-errors.txt`), logs.pageErrors.join("\n"), "utf8");
  fs.writeFileSync(path.join(evidenceDir, "raw", `${prefix}-console-errors.txt`), logs.consoleErrors.join("\n"), "utf8");
  fs.writeFileSync(path.join(evidenceDir, "raw", `${prefix}-all-console.txt`), logs.allConsole.join("\n"), "utf8");
  fs.writeFileSync(path.join(evidenceDir, "raw", `${prefix}-network.txt`), logs.network.join("\n"), "utf8");
  fs.writeFileSync(path.join(evidenceDir, "raw", `${prefix}-http-errors.txt`), logs.httpErrors.join("\n"), "utf8");
  fs.writeFileSync(path.join(evidenceDir, "raw", `${prefix}-business-mutations.txt`), logs.businessMutations.join("\n"), "utf8");
}

async function loginAndOpenC4(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /登录|Nexion/i })).toBeVisible();
  await page.getByLabel(/用户名|账号/).fill("superadmin");
  await page.getByLabel(/密码/).fill("Admin@123456");
  await page.getByRole("button", { name: /继续/ }).click();
  await expect(page.getByRole("heading", { name: "运营总览" })).toBeVisible();
  await page.getByRole("button", { name: /用户与账户/ }).click();
  await expect(page.getByText("KYC 合规台账", { exact: true })).toBeVisible();
  await page.getByText("KYC 合规台账", { exact: true }).click();
  await expect(page.getByRole("heading", { name: /KYC.*合规台账/ })).toBeVisible();
}

test("C4 首次用户安全探索", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleLines: string[] = [];
  const network: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  page.on("console", (message) => consoleLines.push(`${message.type().toUpperCase()} ${message.text()}`));
  page.on("response", (response) => network.push(`${response.status()} ${response.request().method()} ${response.url()}`));
  await loginAndOpenC4(page);
  await page.screenshot({ path: path.join(evidenceDir, "screenshots", "00-c4-exploration-entry.png"), fullPage: true });
  fs.writeFileSync(path.join(evidenceDir, "raw", "exploration-visible-text.txt"), await page.locator("body").innerText(), "utf8");
  const controls = await page.locator("main input, main textarea, main select, main button, main a").evaluateAll((nodes) => nodes.map((node) => ({
    tag: node.tagName,
    role: node.getAttribute("role"),
    ariaLabel: node.getAttribute("aria-label"),
    placeholder: node.getAttribute("placeholder"),
    text: node.textContent?.trim(),
    value: (node as HTMLInputElement).value,
    disabled: (node as HTMLInputElement).disabled,
    href: node.getAttribute("href"),
  })));
  fs.writeFileSync(path.join(evidenceDir, "raw", "exploration-controls.json"), JSON.stringify(controls, null, 2), "utf8");
  fs.writeFileSync(path.join(evidenceDir, "raw", "exploration-page-errors.txt"), pageErrors.join("\n"), "utf8");
  fs.writeFileSync(path.join(evidenceDir, "raw", "exploration-console.txt"), consoleLines.join("\n"), "utf8");
  fs.writeFileSync(path.join(evidenceDir, "raw", "exploration-network.txt"), network.join("\n"), "utf8");
});

test("C4 高风险动作弹窗安全探索", async ({ page }) => {
  await loginAndOpenC4(page);
  const actions = ["监管导出(脱敏)", "撤销实名", "触发复审", "TRC20 · 启用"];
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    await page.getByRole("button", { name: action, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    fs.writeFileSync(path.join(evidenceDir, "raw", `exploration-dialog-${index + 1}.txt`), await dialog.innerText(), "utf8");
    const controls = await dialog.locator("input,textarea,select,button").evaluateAll((nodes) => nodes.map((node) => ({
      tag: node.tagName,
      ariaLabel: node.getAttribute("aria-label"),
      placeholder: node.getAttribute("placeholder"),
      text: node.textContent?.trim(),
      value: (node as HTMLInputElement).value,
      disabled: (node as HTMLInputElement).disabled,
    })));
    fs.writeFileSync(path.join(evidenceDir, "raw", `exploration-dialog-${index + 1}-controls.json`), JSON.stringify(controls, null, 2), "utf8");
    await page.screenshot({ path: path.join(evidenceDir, "screenshots", `00-dialog-${index + 1}.png`), fullPage: true });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
});

test("C4 筛选与逐行选择安全探索", async ({ page }) => {
  await loginAndOpenC4(page);
  await page.getByRole("button", { name: "未验证", exact: true }).click();
  fs.writeFileSync(path.join(evidenceDir, "raw", "exploration-unverified-filter.txt"), await page.locator("body").innerText(), "utf8");
  await page.screenshot({ path: path.join(evidenceDir, "screenshots", "00-unverified-empty.png"), fullPage: true });
  await page.getByRole("button", { name: "已验证", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "U00000052" });
  await expect(row).toBeVisible();
  await row.click();
  fs.writeFileSync(path.join(evidenceDir, "raw", "exploration-selected-row.txt"), await page.locator("body").innerText(), "utf8");
});

test("C4 初审：完整首次用户流程与唯一脱敏导出", async ({ page }) => {
  const logs = installLogs(page);
  try {
    await loginAndOpenC4(page);
    resetBusinessLogs(logs);
    await expect(page.getByText(/提现门槛\(D2\).*兑换门槛\(G2\).*大额复审\(K5\)/)).toBeVisible();
    await expect(page.getByText("监管导出(脱敏)", { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, "screenshots", "01-c4-entry-and-stats.png"), fullPage: true });

    await page.getByRole("button", { name: "未验证", exact: true }).click();
    await expect(page.getByText("该状态下暂无台账行", { exact: true })).toBeVisible();
    await expect(page.getByText("请选择一条 KYC 台账行", { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, "screenshots", "02-empty-filter-state.png"), fullPage: true });

    await page.getByRole("button", { name: "已验证", exact: true }).click();
    const row = page.getByRole("row").filter({ hasText: "U00000052" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("155****9999");
    await expect(row).toContainText("0x11****99");
    await row.click();
    await expect(page.getByText("详情 · U00000052", { exact: true })).toBeVisible();
    await expect(page.getByText("状态变更历史", { exact: true })).toBeVisible();
    await expect(page.getByText("0x11****99", { exact: true }).last()).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, "screenshots", "03-row-detail-and-masking.png"), fullPage: true });
    fs.writeFileSync(path.join(evidenceDir, "raw", "initial-selected-detail-visible-text.txt"), await page.locator("body").innerText(), "utf8");

    const pageSize = page.getByLabel("C4 KYC 台账 每页条数");
    await pageSize.selectOption("5");
    await expect(pageSize).toHaveValue("5");
    await pageSize.selectOption("10");
    await expect(page.getByLabel("C4 KYC 台账 上一页")).toBeDisabled();
    await expect(page.getByLabel("C4 KYC 台账 下一页")).toBeDisabled();

    const riskyActions = [
      { name: "撤销实名", confirm: "确认提交" },
      { name: "触发复审", confirm: "确认触发" },
      { name: "TRC20 · 启用", confirm: "确认提交" },
    ];
    for (let index = 0; index < riskyActions.length; index += 1) {
      const action = riskyActions[index];
      await page.getByRole("button", { name: action.name, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const confirmButton = dialog.getByRole("button", { name: action.confirm, exact: true });
      await expect(confirmButton).toBeDisabled();
      const reason = dialog.locator("textarea");
      await reason.fill("不足七字");
      await expect(confirmButton).toBeDisabled();
      await reason.fill(`C4 高风险动作仅验弹窗与取消，不执行写入-${index + 1}`);
      await expect(confirmButton).toBeEnabled();
      await page.screenshot({ path: path.join(evidenceDir, "screenshots", `04-risk-dialog-${index + 1}-cancel.png`), fullPage: true });
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
    expect(logs.businessMutations).toEqual([]);

    await page.getByRole("button", { name: "监管导出(脱敏)", exact: true }).click();
    const exportDialog = page.getByRole("dialog");
    await expect(exportDialog).toBeVisible();
    const confirmExport = exportDialog.getByRole("button", { name: "确认导出", exact: true });
    await expect(confirmExport).toBeDisabled();
    await exportDialog.locator("textarea").fill("短理由");
    await expect(confirmExport).toBeDisabled();
    await exportDialog.locator("textarea").fill(exportReason);
    await expect(confirmExport).toBeEnabled();
    await exportDialog.getByText(/查看详情/).click();
    await page.screenshot({ path: path.join(evidenceDir, "screenshots", "05-export-confirmation.png"), fullPage: true });
    fs.writeFileSync(path.join(evidenceDir, "raw", "export-confirmation-visible-text.txt"), await exportDialog.innerText(), "utf8");

    const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && !response.url().includes("/auth/"));
    await confirmExport.click();
    const response = await responsePromise;
    const responseText = await response.text();
    fs.writeFileSync(path.join(evidenceDir, "raw", "export-create-response.json"), JSON.stringify({ status: response.status(), url: response.url(), body: responseText }, null, 2), "utf8");
    expect(response.ok()).toBeTruthy();
    const payload = JSON.parse(responseText);
    const data = payload?.data ?? payload;
    const jobNo = String(data?.jobNo ?? data?.exportJobNo ?? data?.taskNo ?? "");
    expect(jobNo).not.toBe("");
    fs.writeFileSync(exportJobFile, JSON.stringify({ jobNo, reason: exportReason, response: data }, null, 2), "utf8");
    await expect(page.getByText(new RegExp(jobNo))).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, "screenshots", "06-export-success-jobno.png"), fullPage: true });
    fs.writeFileSync(path.join(evidenceDir, "raw", "export-success-visible-text.txt"), await page.locator("body").innerText(), "utf8");

    expect(logs.pageErrors).toEqual([]);
    expect(logs.consoleErrors).toEqual([]);
    expect(logs.businessMutations).toHaveLength(1);
  } finally {
    saveLogs("initial", logs);
  }
});

test("C4 初审闭环：刷新返回与重登后的导出可追溯性", async ({ page }) => {
  const created = JSON.parse(fs.readFileSync(exportJobFile, "utf8"));
  const jobNo = String(created.jobNo);
  const logs = installLogs(page);
  try {
    await loginAndOpenC4(page);
    resetBusinessLogs(logs);
    await expect(page.getByText(jobNo, { exact: false })).toHaveCount(0);
    await page.screenshot({ path: path.join(evidenceDir, "screenshots", "07-new-session-export-job-not-visible.png"), fullPage: true });
    fs.writeFileSync(path.join(evidenceDir, "raw", "new-session-visible-text.txt"), await page.locator("body").innerText(), "utf8");
    await page.reload();
    await expect(page.getByRole("heading", { name: /KYC.*合规台账/ })).toBeVisible();
    await expect(page.getByText(jobNo, { exact: false })).toHaveCount(0);
    await page.goBack();
    await expect(page.getByRole("heading", { name: "运营总览" })).toBeVisible();
    await page.getByRole("button", { name: /用户与账户/ }).click();
    await page.getByText("KYC 合规台账", { exact: true }).click();
    await expect(page.getByRole("heading", { name: /KYC.*合规台账/ })).toBeVisible();
    await expect(page.getByText(jobNo, { exact: false })).toHaveCount(0);
    await page.getByRole("button", { name: /Super Admin/ }).click();
    await page.getByText(/退出登录/).click();
    await expect(page.getByRole("heading", { name: /登录|Nexion/i })).toBeVisible();
    await loginAndOpenC4(page);
    await expect(page.getByText(jobNo, { exact: false })).toHaveCount(0);
    await page.screenshot({ path: path.join(evidenceDir, "screenshots", "08-relogin-export-job-not-visible.png"), fullPage: true });
    expect(logs.pageErrors).toEqual([]);
    const unexpectedConsole = logs.consoleErrors.filter((line) => !line.includes("401"));
    fs.writeFileSync(path.join(evidenceDir, "raw", "closure-unexpected-console-errors.txt"), unexpectedConsole.join("\n"), "utf8");
    expect(unexpectedConsole).toEqual([]);
    expect(logs.businessMutations).toEqual([]);
  } finally {
    saveLogs("closure", logs);
  }
});

test("C4 墨菲复审：空筛选、重复点击与高风险承诺", async ({ page }) => {
  const created = JSON.parse(fs.readFileSync(exportJobFile, "utf8"));
  const jobNo = String(created.jobNo);
  const logs = installLogs(page);
  try {
    await loginAndOpenC4(page);
    resetBusinessLogs(logs);

    const emptyFilterResults: Array<{ filter: string; emptyTable: boolean; emptyDetail: boolean }> = [];
    for (const filter of ["未验证", "复审中", "已拒绝"]) {
      await page.getByRole("button", { name: filter, exact: true }).click();
      await expect(page.getByText("该状态下暂无台账行", { exact: true })).toBeVisible();
      await expect(page.getByText("请选择一条 KYC 台账行", { exact: true })).toBeVisible();
      emptyFilterResults.push({ filter, emptyTable: true, emptyDetail: true });
    }

    await page.getByRole("button", { name: "已验证", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: "U00000052" })).toBeVisible();

    const exportButton = page.getByRole("button", { name: "监管导出(脱敏)", exact: true });
    await exportButton.click({ clickCount: 2 });
    await expect(page.getByRole("dialog")).toHaveCount(1);
    const exportDialog = page.getByRole("dialog");
    const exportConfirm = exportDialog.getByRole("button", { name: "确认导出", exact: true });
    await expect(exportConfirm).toBeDisabled();
    await page.screenshot({ path: path.join(evidenceDir, "screenshots", "09-repeat-click-single-export-dialog.png"), fullPage: true });
    await exportDialog.getByRole("button", { name: "取消", exact: true }).click();

    await page.getByRole("row").filter({ hasText: "U00000052" }).click();
    await page.getByRole("button", { name: "触发复审", exact: true }).click();
    const reviewDialog = page.getByRole("dialog");
    const reviewCopy = await reviewDialog.innerText();
    const reviewCopyAssessment = {
      text: reviewCopy,
      saysWriteBackendState: reviewCopy.includes("写后端状态"),
      explicitlySaysNoImmediateKycChange: /不会立即.*(KYC|实名|状态)|不直接.*(KYC|实名|状态)/.test(reviewCopy),
      showsK5TicketPreview: /K5.*(工单号|任务号|预览|编号)/.test(reviewCopy),
    };
    fs.writeFileSync(path.join(evidenceDir, "raw", "murphy-review-copy-assessment.json"), JSON.stringify(reviewCopyAssessment, null, 2), "utf8");
    await page.screenshot({ path: path.join(evidenceDir, "screenshots", "10-trigger-review-promise-ambiguity.png"), fullPage: true });
    await reviewDialog.getByRole("button", { name: "取消", exact: true }).click();

    expect(logs.businessMutations).toEqual([]);
    await page.reload();
    await expect(page.getByText(jobNo, { exact: false })).toHaveCount(0);
    fs.writeFileSync(path.join(evidenceDir, "raw", "murphy-empty-filter-results.json"), JSON.stringify(emptyFilterResults, null, 2), "utf8");
    expect(logs.pageErrors).toEqual([]);
    expect(logs.businessMutations).toEqual([]);
  } finally {
    saveLogs("murphy", logs);
  }
});

test("C4 墨菲复审故障注入：500 与畸形响应", async ({ browser }) => {
  type FaultResult = {
    scenario: string;
    injected: boolean;
    url: string;
    feedbackDetected: boolean;
    feedbackSnippet: string;
    staleRowVisible: boolean;
    loginVisible: boolean;
    pageErrors: string[];
    consoleErrors: string[];
    httpErrors: string[];
    businessMutations: string[];
  };
  const results: FaultResult[] = [];
  const scenarios: Array<{ name: string; action: "500" | "malformed" }> = [
    { name: "http-500", action: "500" },
    { name: "malformed-200", action: "malformed" },
  ];

  for (const scenario of scenarios) {
    const context = await browser.newContext({ baseURL: "http://127.0.0.1:3002" });
    const page = await context.newPage();
    const logs = installLogs(page);
    let injected = false;
    let injectedUrl = "";
    try {
      await loginAndOpenC4(page);
      resetBusinessLogs(logs);
      await page.route("**/api/admin/users/kyc/overview*", async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        injected = true;
        injectedUrl = route.request().url();
        if (scenario.action === "malformed") {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 200, data: { unexpectedShape: true } }) });
        }
        const status = Number(scenario.action);
        return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ code: status, message: `C4 injected ${status}` }) });
      });
      await page.reload();
      await page.waitForTimeout(500);
      const bodyText = await page.locator("body").innerText();
      const feedbackMatches = bodyText.match(/[^\n]*(?:失败|错误|异常|无法|重试|网络|登录|暂无)[^\n]*/g) ?? [];
      const staleRowVisible = await page.getByText("U00000052", { exact: false }).first().isVisible().catch(() => false);
      const loginVisible = await page.getByRole("heading", { name: /登录|Nexion/i }).isVisible().catch(() => false);
      await page.screenshot({ path: path.join(evidenceDir, "screenshots", `11-fault-${scenario.name}.png`), fullPage: true });
      fs.writeFileSync(path.join(evidenceDir, "raw", `fault-${scenario.name}-visible-text.txt`), bodyText, "utf8");
      saveLogs(`fault-${scenario.name}`, logs);
      results.push({
        scenario: scenario.name,
        injected,
        url: injectedUrl,
        feedbackDetected: feedbackMatches.length > 0 || loginVisible,
        feedbackSnippet: feedbackMatches.slice(0, 5).join(" | "),
        staleRowVisible,
        loginVisible,
        pageErrors: [...logs.pageErrors],
        consoleErrors: [...logs.consoleErrors],
        httpErrors: [...logs.httpErrors],
        businessMutations: [...logs.businessMutations],
      });
      expect(injected).toBeTruthy();
      expect(logs.businessMutations).toEqual([]);
    } finally {
      await context.close();
    }
  }

  fs.writeFileSync(path.join(evidenceDir, "raw", "murphy-fault-results.json"), JSON.stringify(results, null, 2), "utf8");
});
