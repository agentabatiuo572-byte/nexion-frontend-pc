import { createHmac } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ADMIN_USER = process.env.M4_ADMIN_USERNAME ?? "d5_V3_r_super";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const EVIDENCE_DIR = process.env.M4_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/m-domain-acceptance-20260723/final/M4/evidence";
const PREFIX = process.env.M4_FIXTURE_PREFIX ?? "M4-20260723";
const KNOWLEDGE_OVERVIEW_API = "**/api/admin/content/knowledge/overview";
const FAQ_API = "**/api/admin/content/knowledge/faqs";
const MFA_SECRETS = new Map<string, string>();

type Envelope<T> = { code: number; message?: string; data: T };
type FaqView = { id: string; question: string; status: string };
type SlaView = { category: string; firstResponseMins: number; resolutionHours: number; queue: string; escalation: string };
type KnowledgeView = { faqs: FaqView[]; sla: SlaView[] };

test.describe.configure({ mode: "serial", timeout: 300_000 });

test.beforeAll(async () => {
  if (!PASSWORD) throw new Error("ADMIN_E2E_PASSWORD is required for M4 live acceptance");
  await mkdir(EVIDENCE_DIR, { recursive: true });
});

test("M4 FAQ/SLA 真实闭环、并发唯一性与失败关闭", async ({ page }) => {
  await loginAndOpenM4(page);
  await expect(page.getByText("Help/FAQ 内容管理", { exact: true })).toBeVisible();
  await expect(page.getByText("Ticket 分类与 SLA", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-visible-entry-m4.png"), fullPage: true });

  const initial = await envelope<KnowledgeView>(await page.request.get("/api/admin/content/knowledge/overview"));
  const originalSla = initial.data.sla.find((row) => row.category === "withdrawal");
  expect(originalSla, "M4 withdrawal SLA baseline must exist").toBeTruthy();

  const fixtureIds = new Set<string>();
  const question = `${PREFIX}-FAQ-结果未知`;
  const answer = `${PREFIX}-FAQ 初始回答,用于真实用户闭环验收。`;
  const editedAnswer = `${PREFIX}-FAQ 已编辑回答,刷新后必须保留。`;
  const reason = `${PREFIX}-FAQ 新建与重试留档`;
  const keys: string[] = [];
  let attempts = 0;

  await page.route(FAQ_API, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    attempts += 1;
    keys.push(await route.request().headerValue("idempotency-key") ?? "");
    if (attempts === 1) {
      const upstream = await route.fetch();
      expect(upstream.ok(), `M4 FAQ upstream ${upstream.status()}: ${(await upstream.text()).slice(0, 500)}`).toBeTruthy();
      await route.abort("connectionfailed");
      return;
    }
    await route.continue();
  });

  try {
    await page.getByRole("button", { name: "新增文章", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "新增 Help/FAQ 文章" });
    await dialog.getByLabel("问题").fill(question);
    await dialog.getByLabel("回答").fill(answer);
    await dialog.getByLabel("发布状态").selectOption("draft");
    await dialog.getByLabel(/审计理由/).fill(reason);
    await dialog.getByRole("button", { name: "保存 FAQ", exact: true }).click();

    await expect(dialog, "结果未知时 FAQ 表单必须保留").toBeVisible();
    await expect(dialog.getByLabel("问题")).toHaveValue(question);
    await expect(dialog.getByLabel("回答")).toHaveValue(answer);
    await expect(page.getByText(/写入失败或结果未知/)).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-faq-unknown-outcome-preserved.png"), fullPage: true });

    await dialog.getByRole("button", { name: "保存 FAQ", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    await page.unroute(FAQ_API);

    await page.getByLabel("搜索 FAQ").fill(question);
    const row = page.locator('[data-proof="support-faq-row"]').filter({ hasText: question });
    await expect(row).toHaveCount(1);
    const createdId = await row.getAttribute("data-faq-id");
    expect(createdId).toBeTruthy();
    fixtureIds.add(createdId!);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-faq-created-once.png"), fullPage: true });

    await row.getByTitle("编辑 FAQ").click();
    const editDialog = page.getByRole("dialog", { name: /编辑 Help\/FAQ/ });
    await editDialog.getByLabel("回答").fill(editedAnswer);
    await editDialog.getByLabel(/审计理由/).fill(`${PREFIX}-FAQ 编辑持久化留档`);
    await editDialog.getByRole("button", { name: "保存 FAQ", exact: true }).click();
    await expect(editDialog).toBeHidden();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByLabel("搜索 FAQ").fill(question);
    const editedRow = page.locator('[data-proof="support-faq-row"]').filter({ hasText: question });
    await expect(editedRow).toContainText(editedAnswer);

    await editedRow.getByRole("button", { name: "发布", exact: true }).click();
    await expect(editedRow).toContainText("已发布");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByLabel("搜索 FAQ").fill(question);
    await expect(page.locator('[data-proof="support-faq-row"]').filter({ hasText: question })).toContainText("已发布");

    const concurrentPayload = (suffix: string) => ({
      category: "general",
      surface: "Help Center",
      question: `${PREFIX}-并发唯一性-${suffix}`,
      answer: `${PREFIX}-并发创建回答-${suffix}`,
      status: "DRAFT",
      language: "zh-CN",
      sortOrder: 990,
      reason: `${PREFIX}-并发创建不同命令`,
    });
    const [concurrentA, concurrentB] = await Promise.all([
      page.request.post("/api/admin/content/knowledge/faqs", {
        headers: { "Idempotency-Key": `${PREFIX}-concurrent-a-${Date.now()}` },
        data: concurrentPayload("A"),
      }),
      page.request.post("/api/admin/content/knowledge/faqs", {
        headers: { "Idempotency-Key": `${PREFIX}-concurrent-b-${Date.now()}` },
        data: concurrentPayload("B"),
      }),
    ]);
    const createdA = await envelope<FaqView>(concurrentA);
    const createdB = await envelope<FaqView>(concurrentB);
    expect(createdA.data.id).not.toBe(createdB.data.id);
    fixtureIds.add(createdA.data.id);
    fixtureIds.add(createdB.data.id);

    const slaRow = page.locator('[data-proof="support-sla-row"][data-sla-category="withdrawal"]');
    await slaRow.getByTitle("编辑 SLA").click();
    const slaDialog = page.getByRole("dialog", { name: "编辑分类 SLA" });
    const nextFirstResponse = originalSla!.firstResponseMins >= 120
      ? originalSla!.firstResponseMins - 1
      : originalSla!.firstResponseMins + 1;
    await slaDialog.getByLabel("首响(分钟)").fill(String(nextFirstResponse));
    await slaDialog.getByLabel(/审计理由/).fill(`${PREFIX}-SLA 与 M1 联动验证`);
    await slaDialog.getByRole("button", { name: "保存 SLA", exact: true }).click();
    await expect(slaDialog).toBeHidden();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-proof="support-sla-row"][data-sla-category="withdrawal"]')).toContainText(`${nextFirstResponse}m`);

    await openVisibleLink(page, "/service/overview");
    await expect(page.getByText("SLA 监控", { exact: true })).toBeVisible();
    await expect(page.getByText(`首响 ${nextFirstResponse} 分钟`, { exact: false })).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "04-m1-consumes-m4-sla.png"), fullPage: true });
    await openVisibleLink(page, "/service/tickets");
    await expect(page).toHaveURL(/\/service\/tickets/);
    await openVisibleLink(page, "/service/kb-sla");

    await page.getByLabel("搜索 FAQ").fill(question);
    const publishedRow = page.locator('[data-proof="support-faq-row"]').filter({ hasText: question });
    await publishedRow.getByRole("button", { name: "下架", exact: true }).click();
    await expect(publishedRow).toContainText("草稿");
    await publishedRow.getByTitle("删除 FAQ").click();
    const deleteDialog = page.getByRole("dialog").filter({ hasText: "删除 FAQ" });
    await deleteDialog.getByLabel(/理由/).fill(`${PREFIX}-FAQ 闭环清理删除`);
    await deleteDialog.getByRole("button", { name: /确认/ }).click();
    await expect(deleteDialog).toBeHidden();
    fixtureIds.delete(createdId!);

    await page.route(KNOWLEDGE_OVERVIEW_API, (route) => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: 503, message: "M4_ACCEPTANCE_KNOWLEDGE_UNAVAILABLE" }),
    }));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(/知识库后端当前不可用/)).toBeVisible();
    await expect(page.getByRole("button", { name: "新增文章", exact: true })).toHaveCount(0);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "05-knowledge-500-fails-closed.png"), fullPage: true });
    await page.unroute(KNOWLEDGE_OVERVIEW_API);
  } finally {
    await page.unroute(FAQ_API).catch(() => undefined);
    await page.unroute(KNOWLEDGE_OVERVIEW_API).catch(() => undefined);
    if (originalSla) {
      const restore = await page.request.patch(`/api/admin/content/knowledge/sla/${originalSla.category}`, {
        headers: { "Idempotency-Key": `${PREFIX}-sla-cleanup-${Date.now()}` },
        data: {
          firstResponseMins: originalSla.firstResponseMins,
          resolutionHours: originalSla.resolutionHours,
          queue: originalSla.queue,
          escalation: originalSla.escalation,
          reason: `${PREFIX}-恢复原 SLA 配置`,
        },
      });
      expect(restore.ok(), `M4 SLA cleanup ${restore.status()}: ${await restore.text()}`).toBeTruthy();
    }
    for (const faqId of fixtureIds) {
      const remove = await page.request.delete(`/api/admin/content/knowledge/faqs/${encodeURIComponent(faqId)}`, {
        headers: { "Idempotency-Key": `${PREFIX}-faq-cleanup-${faqId}-${Date.now()}` },
        data: { reason: `${PREFIX}-清理验收 FAQ` },
      });
      expect(remove.ok(), `M4 FAQ cleanup ${faqId} ${remove.status()}: ${await remove.text()}`).toBeTruthy();
    }
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("Help/FAQ 内容管理", { exact: true })).toBeVisible();
  await page.getByLabel("搜索 FAQ").fill(PREFIX);
  await expect(page.locator('[data-proof="support-faq-row"]')).toHaveCount(0);
  await logoutCurrent(page);
  await loginAndOpenM4(page);
  await page.getByLabel("搜索 FAQ").fill(PREFIX);
  await expect(page.locator('[data-proof="support-faq-row"]')).toHaveCount(0);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "06-relogin-clean-readback.png"), fullPage: true });
  await logoutCurrent(page);
});

async function envelope<T>(response: APIResponse): Promise<Envelope<T>> {
  const text = await response.text();
  expect(response.ok(), `${response.status()} ${response.url()} ${text.slice(0, 500)}`).toBeTruthy();
  const payload = JSON.parse(text) as Envelope<T>;
  expect(payload.code).toBe(0);
  return payload;
}

async function loginAndOpenM4(page: Page) {
  await login(page, ADMIN_USER);
  await openVisibleLink(page, "/service/kb-sla");
  await expect(page.getByText("Help/FAQ 内容管理", { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function openVisibleLink(page: Page, href: string) {
  const link = page.locator(`a[href="${href}"]`).first();
  const group = page.getByRole("button", { name: /客服中心.*M|M.*客服中心/ }).first();
  if (!await link.isVisible().catch(() => false) && await group.isVisible({ timeout: 5_000 }).catch(() => false)) await group.click();
  await expect(link, `${href} 必须可从当前角色可见侧栏进入`).toBeVisible();
  await link.click();
  await expect(page).toHaveURL((url) => url.pathname === href);
}

async function login(page: Page, username: string) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_200);
  if (await page.locator("aside").isVisible().catch(() => false)) await logoutCurrent(page);
  const userInput = page.locator('input[autocomplete="username"]');
  const passwordInput = page.locator('input[autocomplete="current-password"]');
  await expect(userInput).toBeVisible({ timeout: 8_000 });
  await userInput.fill(username);
  await passwordInput.fill(PASSWORD);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const mfaHeading = page.getByRole("heading", { name: "双因素身份验证" });
  await Promise.race([
    page.locator("aside").waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
    mfaHeading.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
  ]);
  if (await page.locator("aside").isVisible().catch(() => false)) return;
  await expect(mfaHeading).toBeVisible();
  const secretCode = page.locator("code");
  const displayedSecret = await secretCode.count() > 0 ? (await secretCode.first().textContent())?.trim() : undefined;
  if (displayedSecret) MFA_SECRETS.set(username, displayedSecret);
  const secret = displayedSecret || MFA_SECRETS.get(username);
  if (!secret) throw new Error(`MFA secret unavailable for ${username}`);
  const remainingMs = 30_000 - (Date.now() % 30_000);
  await page.waitForTimeout(remainingMs + 750);
  await page.getByLabel("一次性验证码").fill(totp(secret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function logoutCurrent(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await expect(account).toBeVisible();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
}

function totp(secret: string, at = Date.now()) {
  const key = decodeBase32(secret);
  const counter = Math.floor(at / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of normalized) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}
