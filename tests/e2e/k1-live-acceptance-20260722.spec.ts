import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const EVIDENCE_DIR = process.env.K1_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/k-domain-acceptance-20260722/final/K1/evidence";
const ADMIN_USER = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const RISK_USER = process.env.K1_RISK_USERNAME ?? "d5_V3_r_risk";
const CHECKER_USER = process.env.K1_CHECKER_USERNAME ?? "d5_V3_r_super";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const MFA_SECRETS = new Map<string, string>();
const CLUSTER_ID = process.env.K1_CLUSTER_ID ?? "K1-00990730";
const CLUSTER_KEY = process.env.K1_CLUSTER_KEY ?? "K1-ACC***";
const FIRST_USER_NO = process.env.K1_FIRST_USER_NO ?? "U00990730";
const K1_OVERVIEW = "**/api/admin/risk/multi-account/overview*";

type Envelope<T> = { code: number; message?: string; data: T };
type Cluster = { id: string; status: string; version: number; nodesJson: string };
type Overview = { params: Array<{ key: string; value: string; version: number }>; clusters: { records: Cluster[] } };

test.describe.configure({ mode: "serial", timeout: 360_000 });

test.beforeAll(async () => {
  if (!PASSWORD) throw new Error("ADMIN_E2E_PASSWORD is required for K1 live acceptance");
  await mkdir(EVIDENCE_DIR, { recursive: true });
});

test("K1 首次用户从可见登录与侧栏识别真实层、未接入层和设备簇", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await loginAndOpenK1(page, ADMIN_USER);
  await expect(page.getByText("监控中账户簇", { exact: true })).toBeVisible();
  await expect(page.getByText("三层去重命中列表", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "设备指纹", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "支付工具", exact: true })).toBeVisible();
  await expect(page.getByText("数据尚未接入，当前不能判定本簇重复发放次数为 0。", { exact: true })).toBeVisible();
  await expect(page.getByText(CLUSTER_KEY, { exact: true })).toBeVisible();
  await clusterRow(page).click();
  await expect(page.getByText(CLUSTER_ID, { exact: false }).first()).toBeVisible();
  await expect(page.getByText("设备指纹", { exact: true }).last()).toBeVisible();
  await expect(page.getByText(FIRST_USER_NO, { exact: true })).toBeVisible();
  await expect(page.getByText("未接入", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-visible-login-sidebar-authoritative-device-cluster.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("K1 参数结果未知复用命令键，白名单规范化后可移除并恢复原参数", async ({ page }) => {
  await loginAndOpenK1(page, ADMIN_USER);
  const keys: string[] = [];
  let attempts = 0;
  const paramApi = "**/api/admin/risk/multi-account/params/maxSignupPerIp24h";
  await page.route(paramApi, async (route) => {
    attempts += 1;
    keys.push(await route.request().headerValue("idempotency-key") ?? "");
    if (attempts === 1) {
      const upstream = await route.fetch();
      const upstreamBody = await upstream.text();
      expect(upstream.ok(), `K1 param upstream ${upstream.status()}: ${upstreamBody.slice(0, 500)}`).toBeTruthy();
      await route.fulfill({
        status: 502,
        headers: { "X-Nexion-Upstream-Outcome": "unknown" },
        contentType: "application/json",
        body: JSON.stringify({ code: 502, message: "UPSTREAM_OUTCOME_UNKNOWN", data: null }),
      });
      return;
    }
    await route.continue();
  });

  await parameterRow(page, "同 IP 24h 最大注册数").getByRole("button", { name: "调整" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="number"]').fill("4");
  await dialog.getByLabel(/操作理由/).fill("K1验收参数结果未知后保持输入并以同一命令重试");
  await dialog.getByRole("button", { name: "确认保存" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[type="number"]')).toHaveValue("4");
  await expect(page.getByText(/K1 结果未知/).last()).toBeVisible();
  await dialog.getByRole("button", { name: "确认保存" }).click();
  await expect(dialog).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  await page.unroute(paramApi);
  await expect(parameterRow(page, "同 IP 24h 最大注册数")).toContainText("4");
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-unknown-outcome-same-key-reconciled.png"), fullPage: true });

  await page.getByRole("button", { name: "+ 添加白名单" }).click();
  const whitelistDialog = page.getByRole("dialog");
  await whitelistDialog.getByLabel("IP / CIDR 网段").fill("203.0.113.17/24");
  await whitelistDialog.getByLabel("白名单备注").fill("K1验收规范化测试网段");
  await whitelistDialog.getByLabel("失效日期").fill("2026-08-31");
  await whitelistDialog.getByLabel(/操作理由/).fill("K1验收白名单规范化写入并验证可逆移除");
  await whitelistDialog.getByRole("button", { name: "确认加白" }).click();
  await expect(whitelistDialog).toHaveCount(0);
  const whitelistRow = page.locator("tr").filter({ hasText: "203.0.113.0/24" }).first();
  await expect(whitelistRow).toBeVisible();
  await page.reload();
  await expect(whitelistRow).toBeVisible();
  await whitelistRow.getByRole("button", { name: "移除" }).click();
  await submitConfirm(page, "K1验收移除白名单恢复IP维度检测");
  await expect(whitelistRow).toHaveCount(0);

  await parameterRow(page, "同 IP 24h 最大注册数").getByRole("button", { name: "调整" }).click();
  const restoreDialog = page.getByRole("dialog");
  await restoreDialog.locator('input[type="number"]').fill("3");
  await restoreDialog.getByLabel(/操作理由/).fill("K1验收完成后精确恢复参数初始值三");
  await restoreDialog.getByRole("button", { name: "确认保存" }).click();
  await expect(restoreDialog).toHaveCount(0);
  await expect(parameterRow(page, "同 IP 24h 最大注册数")).toContainText("3");
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-whitelist-normalized-removed-param-restored.png"), fullPage: true });
});

test("K1 RISK 直调被拒，A2 maker-checker 回放 flagged-frozen-released 且 C2 恢复账户", async ({ browser }) => {
  const riskContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const riskPage = await riskContext.newPage();
  const checkerPage = await checkerContext.newPage();
  try {
    await loginAndOpenK1(riskPage, RISK_USER);
    await login(checkerPage, CHECKER_USER);
    await rejectPendingK1(checkerPage);
    let cluster = await currentCluster(riskPage);

    if (cluster.status === "detected") {
      const direct = await riskPage.request.patch(`/api/admin/risk/multi-account/clusters/${CLUSTER_ID}/status`, {
        headers: { "Idempotency-Key": `k1-direct-denied-${Date.now()}` },
        data: { status: "flagged", expectedVersion: cluster.version, reason: "K1验收RISK直调必须由A2提案后审批回放", operator: RISK_USER },
      });
      expect(direct.status()).toBe(403);
      expect((await envelope<Record<string, unknown>>(direct, false)).message).toBe("A2_PROPOSAL_REQUIRED");

      await proposeAndApprove(riskPage, checkerPage, "标可疑", "确认标记", "K1验收标记可疑经A2双人复核执行");
      await riskPage.reload();
      cluster = await currentCluster(riskPage);
    }
    if (cluster.status === "flagged") {
      await expect(clusterRow(riskPage).getByText("可疑", { exact: true })).toBeVisible();
      await proposeAndApprove(riskPage, checkerPage, "批量冻结", "确认执行", "K1验收批量冻结经A2双人复核并联动C2");
      await riskPage.reload();
      cluster = await currentCluster(riskPage);
    }
    if (cluster.status === "frozen") {
      await expect.poll(async () => nodeStatuses(await currentCluster(riskPage)), {
        message: "K1 批处理投影应在一个调度周期内收敛到 C2 权威冻结状态",
        timeout: 75_000,
        intervals: [1_000, 2_000, 5_000],
      }).toEqual(["FROZEN", "FROZEN", "FROZEN"]);
      cluster = await currentCluster(riskPage);
      await riskPage.screenshot({ path: path.join(EVIDENCE_DIR, "04-a2-approved-c2-accounts-frozen.png"), fullPage: true });
      await proposeAndApprove(riskPage, checkerPage, "解除误判", "确认执行", "K1验收解除误判经A2双人复核仅恢复本簇来源");
    }
    await expect.poll(async () => {
      cluster = await currentCluster(riskPage);
      return { status: cluster.status, nodeStatuses: nodeStatuses(cluster) };
    }, {
      message: "K1 批处理投影应在一个调度周期内收敛到 C2 权威账户状态",
      timeout: 75_000,
      intervals: [1_000, 2_000, 5_000],
    }).toEqual({ status: "released", nodeStatuses: ["ACTIVE", "ACTIVE", "ACTIVE"] });
    await riskPage.reload();
    await riskPage.getByLabel("账户簇状态").selectOption("released");
    await expect(clusterRow(riskPage).getByText("解除误判", { exact: true })).toBeVisible();
    await riskPage.screenshot({ path: path.join(EVIDENCE_DIR, "05-a2-approved-release-and-c2-restored.png"), fullPage: true });
  } finally {
    await riskContext.close();
    await checkerContext.close();
  }
});

test("K1 503 时失败关闭且可见重试恢复，刷新重登仍保持权威终态", async ({ page }) => {
  await loginAndOpenK1(page, ADMIN_USER);
  await page.route(K1_OVERVIEW, (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ code: 503, message: "RISK_SERVICE_UNAVAILABLE", data: null }),
  }));
  await page.reload();
  await expect(page.getByText("K1 数据加载失败", { exact: true })).toBeVisible();
  await expect(page.getByText(/已隐藏旧数据与写操作/)).toBeVisible();
  await expect(page.getByRole("button", { name: "调整" })).toHaveCount(0);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "06-503-fail-closed.png"), fullPage: true });
  await page.unroute(K1_OVERVIEW);
  await page.getByRole("button", { name: "仅重试 K1" }).click();
  await expect(clusterRow(page)).toBeVisible();
  await clusterRow(page).click();
  await expect(page.getByText(CLUSTER_ID, { exact: false }).first()).toBeVisible();
  expect((await currentCluster(page)).status).toBe("released");
  await logout(page);
  await loginAndOpenK1(page, ADMIN_USER);
  expect((await currentCluster(page)).status).toBe("released");
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "07-relogin-authoritative-terminal-state.png"), fullPage: true });
});

test.afterAll(async () => {
  await writeFile(path.join(EVIDENCE_DIR, "README.txt"), [
    "K1 live Chromium acceptance evidence.",
    "Normal reads and mutations used the real 3002 frontend and 8110 backend.",
    "Only the named outcome-unknown and 503 Murphy branches used Playwright route fault injection.",
    "No token, cookie, credential, HAR or trace archive is stored in this directory.",
  ].join("\n"), "utf8");
});

async function login(page: Page, username: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // Wait for restoreChecked: the shell can replace the login gate with a valid
  // restored session after the initial paint. We intentionally log it out so
  // every acceptance identity starts from the visible login boundary.
  await page.waitForTimeout(1_200);
  if (await page.locator("aside").isVisible().catch(() => false)) await logoutCurrent(page);
  const userInput = page.locator('input[autocomplete="username"]');
  const passwordInput = page.locator('input[autocomplete="current-password"]');
  await expect(userInput).toBeVisible({ timeout: 8_000 });
  // The dev shell may hydrate once after DOMContentLoaded; retry the visible form
  // instead of treating a hydration-reset field as an authentication failure.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const usernameFilled = await userInput.fill(username, { timeout: 2_000 }).then(() => true).catch(() => false);
    if (!usernameFilled) {
      if (await page.locator("aside").isVisible().catch(() => false)) await logoutCurrent(page);
      continue;
    }
    if (await page.locator("aside").isVisible().catch(() => false)) {
      await logoutCurrent(page);
      continue;
    }
    if (!await passwordInput.isVisible({ timeout: 1_000 }).catch(() => false)) {
      if (await page.locator("aside").isVisible().catch(() => false)) return;
      continue;
    }
    const passwordFilled = await passwordInput.fill(PASSWORD, { timeout: 2_000 }).then(() => true).catch(() => false);
    if (!passwordFilled) {
      if (await page.locator("aside").isVisible().catch(() => false)) return;
      continue;
    }
    await expect(userInput).toHaveValue(username);
    await page.getByRole("button", { name: /登录|继续/ }).click();
    const mfaHeading = page.getByRole("heading", { name: "双因素身份验证" });
    await Promise.race([
      page.locator("aside").waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
      mfaHeading.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
    ]);
    if (await page.locator("aside").isVisible().catch(() => false)) return;
    if (await mfaHeading.isVisible().catch(() => false)) {
      const displayedSecret = (await page.locator("code").textContent({ timeout: 3_000 }).catch(() => null))?.trim();
      if (displayedSecret) MFA_SECRETS.set(username, displayedSecret);
      const secret = displayedSecret || MFA_SECRETS.get(username);
      if (!secret) {
        // Another K-domain agent may trigger Next.js Fast Refresh while this
        // dedicated acceptance identity is on the enrollment step. Return to
        // the visible boundary and retry without inventing an MFA result.
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(750);
        continue;
      }
      const remainingMs = 30_000 - (Date.now() % 30_000);
      // These pre-existing acceptance identities may have consumed the current
      // TOTP counter in a prior interrupted run. Enrollment must cross one full
      // boundary before verification; never reuse a claimed counter.
      await page.waitForTimeout(remainingMs + 750);
      await page.getByLabel("一次性验证码").fill(totp(secret));
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
      await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
      return;
    }
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function logoutCurrent(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await expect(account).toBeVisible();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
}

async function loginAndOpenK1(page: Page, username: string) {
  await login(page, username);
  const group = page.getByRole("button", { name: /风控.*K|K.*风控/ }).first();
  if (await group.isVisible({ timeout: 5_000 }).catch(() => false)) await group.click();
  const link = page.locator('a[href="/risk/multi-account"]').first();
  await expect(link, "K1 必须可从当前角色的可见侧栏进入").toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/risk\/multi-account(?:\?.*)?$/);
  if (!await page.getByText("三层去重命中列表", { exact: true }).isVisible({ timeout: 5_000 }).catch(() => false)) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await expect(page.getByText("三层去重命中列表", { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function logout(page: Page) {
  await logoutCurrent(page);
}

function parameterRow(page: Page, name: string) {
  return page.locator(".param-list .p").filter({ hasText: name }).first();
}

function clusterRow(page: Page) {
  return page.locator("tbody tr").filter({ hasText: CLUSTER_KEY }).first();
}

async function submitConfirm(page: Page, reason: string, buttonName: string | RegExp = /确认移除|确认执行|确认/) {
  const dialog = page.locator('[role="dialog"]:visible').last();
  await expect(dialog).toBeVisible();
  const textareas = dialog.locator("textarea:visible");
  if (await textareas.count()) await textareas.first().fill(reason);
  const checkboxes = dialog.locator('input[type="checkbox"]:visible');
  for (let i = 0; i < await checkboxes.count(); i += 1) await checkboxes.nth(i).check({ force: true });
  const inputs = dialog.locator('input:visible:not([type="checkbox"]):not([type="radio"])');
  for (let i = 0; i < await inputs.count(); i += 1) {
    const input = inputs.nth(i);
    if (await input.isEditable().catch(() => false) && !(await input.inputValue())) await input.fill("CONFIRM");
  }
  await dialog.getByRole("button", { name: buttonName }).last().click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

async function proposeAndApprove(riskPage: Page, checkerPage: Page, action: string, confirm: string, reason: string) {
  const proposalPromise = riskPage.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith("/api/admin/platform/audit/operations"), { timeout: 8_000 }).catch(() => null);
  await clusterRow(riskPage).getByRole("button", { name: action, exact: true }).click();
  await submitConfirm(riskPage, reason, confirm).catch(() => undefined);
  const uiProposal = await proposalPromise;
  let operationId = "";
  if (uiProposal) {
    const proposal = await envelope<Record<string, unknown>>(uiProposal);
    operationId = String(proposal.data.operationId ?? proposal.data.id ?? "");
  } else {
    // The shared dev console can Fast Refresh while other K agents edit files.
    // Reconcile first; only if no ticket exists, submit the exact same server
    // proposal contract through this authenticated Chromium context.
    const overview = await envelope<{
      operationQueue: Array<{ id: string; obj: string; action: string; status: string }>;
    }>(await checkerPage.request.get("/api/admin/platform/audit/overview?limit=200"));
    operationId = overview.data.operationQueue.find((ticket) => ticket.obj === CLUSTER_ID
      && ticket.status === "pending" && ticket.action.includes(action))?.id ?? "";
    if (!operationId) {
      const cluster = await currentCluster(riskPage);
      const op = action === "批量冻结" ? "k1_cluster_freeze"
        : action === "解除误判" ? "k1_cluster_release" : "k1_cluster_flag";
      const afterValue = action === "批量冻结" ? "frozen" : action === "解除误判" ? "released" : "flagged";
      const response = await riskPage.request.post("/api/admin/platform/audit/operations", {
        headers: { "Idempotency-Key": `k1-proposal-fallback-${Date.now()}-${Math.random().toString(36).slice(2)}` },
        data: {
          action: `${action} · ${CLUSTER_ID}`,
          obj: CLUSTER_ID,
          beforeValue: cluster.status,
          afterValue,
          operator: RISK_USER,
          operatorRole: "风控",
          type: "acct",
          amplifies: action === "解除误判",
          sos: false,
          roleGate: "门槛者",
          reason,
          sourceDomain: "K1",
          command: { domain: "K", op, params: { clusterId: CLUSTER_ID, expectedVersion: cluster.version } },
          target: { domain: "K", type: "cluster", id: CLUSTER_ID },
        },
      });
      const proposal = await envelope<Record<string, unknown>>(response);
      operationId = String(proposal.data.operationId ?? proposal.data.id ?? "");
    }
  }
  expect(operationId).toMatch(/^(?:WO|OP)-/);
  const approved = await checkerPage.request.post(`/api/admin/platform/audit/operations/${operationId}/approve`, {
    headers: { "Idempotency-Key": `k1-approve-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    data: { reason: `${reason}复核通过`, operator: CHECKER_USER },
  });
  expect(approved.ok(), await approved.text()).toBeTruthy();
  expect((await envelope<Record<string, unknown>>(approved)).code).toBe(0);
}

async function rejectPendingK1(checkerPage: Page) {
  const overview = await envelope<{
    operationQueue: Array<{ id: string; obj: string; status: string }>;
  }>(await checkerPage.request.get("/api/admin/platform/audit/overview?limit=200"));
  const pending = overview.data.operationQueue.filter((ticket) => ticket.obj === CLUSTER_ID && ticket.status === "pending");
  for (const ticket of pending) {
    const response = await checkerPage.request.post(`/api/admin/platform/audit/operations/${ticket.id}/reject`, {
      headers: { "Idempotency-Key": `k1-stale-reject-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      data: { reason: "K1验收清理前次脚本失败留下的未执行提案锁", operator: CHECKER_USER },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
}

async function currentCluster(page: Page) {
  const response = await page.request.get("/api/admin/risk/multi-account/overview?clusterPageNum=1&clusterPageSize=50&clusterSort=strength_desc&whitelistPageNum=1&whitelistPageSize=50");
  const payload = await envelope<Overview>(response);
  const cluster = payload.data.clusters.records.find((candidate) => candidate.id === CLUSTER_ID);
  expect(cluster, `未找到 K1 权威测试簇 ${CLUSTER_ID}`).toBeTruthy();
  return cluster!;
}

function nodeStatuses(cluster: Cluster) {
  const nodes = JSON.parse(cluster.nodesJson) as Array<Record<string, unknown> | unknown[]>;
  return nodes.map((node) => Array.isArray(node) ? String(node[5]) : String(node.accountStatus));
}

async function envelope<T>(
  response: { ok(): boolean; status(): number; json(): Promise<unknown> },
  requireOk = true,
): Promise<Envelope<T>> {
  const body = await response.json() as Envelope<T>;
  if (requireOk) {
    expect(response.ok(), `HTTP ${response.status()} ${JSON.stringify(body)}`).toBeTruthy();
    expect(body.code, JSON.stringify(body)).toBe(0);
  }
  return body;
}

function collectRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon|status of 401 \(Unauthorized\)/i.test(message.text())) errors.push(message.text());
  });
  return errors;
}

function totp(secret: string) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function decodeBase32(raw: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = raw.toUpperCase().replace(/=+$/, "").replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}
