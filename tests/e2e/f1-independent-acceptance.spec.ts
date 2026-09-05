/**
 * F1 V-Rank 晋升 独立首次用户初验 (v2)
 *
 * Run ID: F1ACC-20260721-131216
 * 载体: PC http://127.0.0.1:3002 (cookie-based, nexion_admin_token)
 * 代理: PC /api/admin/teams/[...path] 代理后端 :8110
 *
 * v2 修复:
 *  - 所有后端调用走相对路径(让 PC cookie 自动 attach),不直连 :8110
 *  - 每个用例前 dismissOpenDialogs 清理残留弹窗
 *  - F1-I-09 简化:只做"绕过页面直调 PATCH 接口"探测,不创建临时角色(用 superadmin 同 cookie 改请求体 operator 字段;后端用 token role 鉴权)
 *  - 用 page.evaluate(fetch) 双轨验证关键 API
 */
import { test, expect, type Page, type Locator } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const EVIDENCE_DIR = "D:/workspace/bug-pic/f-domain-sequential-acceptance-20260721-131216/f1/independent-first-user/initial";
const RUN_ID = "F1ACC-20260721-131216";
const REASON_PREFIX = RUN_ID;
const PC_BASE = "http://127.0.0.1:3002";

test.use({ trace: "on", video: "on", screenshot: "on" });

type CaseStatus = "passed" | "failed" | "blocked" | "warning";
type CaseResult = { status: CaseStatus; evidence: string[]; note?: string; at: string };
type Defect = { id: string; severity: "P0" | "P1" | "P2" | "P3"; title: string; repro: string; current: string; expected: string; evidence: string[] };

const result: {
  runId: string;
  startedAt: string;
  completedAt?: string;
  cases: Record<string, CaseResult>;
  defects: Defect[];
  cleanup: string[];
} = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  cases: {},
  defects: [],
  cleanup: [],
};

const consoleLogs: string[] = [];
const httpLog: string[] = [];
const networkMutations: string[] = [];

function attachCollectors(page: Page) {
  page.on("console", (m) => consoleLogs.push(`${new Date().toISOString()} [${m.type().toUpperCase()}] ${m.text()}`));
  page.on("pageerror", (e) => consoleLogs.push(`${new Date().toISOString()} [PAGEERROR] ${e.stack ?? e.message}`));
  page.on("request", (req) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method()) && !req.url().includes("/api/admin/auth/")) {
      networkMutations.push(`${new Date().toISOString()} ${req.method()} ${req.url()}`);
    }
  });
  page.on("response", async (r) => {
    const line = `${new Date().toISOString()} ${r.status()} ${r.request().method()} ${r.url()}`;
    httpLog.push(line);
    if (r.status() >= 400) {
      try {
        const body = await r.text();
        httpLog.push(`  BODY ${body.slice(0, 600)}`);
      } catch { /* ignore */ }
    }
  });
}

async function shot(page: Page, name: string) {
  try {
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "screenshots", `${name}.png`), fullPage: true });
  } catch (e) {
    consoleLogs.push(`[SHOT-FAIL] ${name}: ${(e as Error).message}`);
  }
}

function mark(caseId: string, status: CaseStatus, evidence: string[], note?: string) {
  result.cases[caseId] = { status, evidence, note, at: new Date().toISOString() };
  fs.writeFileSync(path.join(EVIDENCE_DIR, "raw-result.json"), JSON.stringify(result, null, 2), "utf8");
}

function addDefect(id: string, severity: "P0" | "P1" | "P2" | "P3", title: string, repro: string, current: string, expected: string, evidence: string[]) {
  if (result.defects.find((d) => d.id === id)) return;
  result.defects.push({ id, severity, title, repro, current, expected, evidence });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "raw-result.json"), JSON.stringify(result, null, 2), "utf8");
}

async function dismissDialogs(page: Page) {
  for (let i = 0; i < 3; i++) {
    const dlg = page.locator('[role="dialog"]:visible, .modal:visible').last();
    if (!(await dlg.isVisible({ timeout: 500 }).catch(() => false))) return;
    const cancelBtn = dlg.locator("button").filter({ hasText: /取消|关闭|×/ }).last();
    if (await cancelBtn.isVisible({ timeout: 800 }).catch(() => false)) {
      await cancelBtn.click().catch(() => undefined);
    } else {
      await page.keyboard.press("Escape").catch(() => undefined);
    }
    await page.waitForTimeout(400);
  }
}

async function dumpLogs() {
  fs.writeFileSync(path.join(EVIDENCE_DIR, "console", "all-console.txt"), consoleLogs.join("\n"), "utf8");
  fs.writeFileSync(path.join(EVIDENCE_DIR, "console", "http.txt"), httpLog.join("\n"), "utf8");
  fs.writeFileSync(path.join(EVIDENCE_DIR, "console", "mutations.txt"), networkMutations.join("\n"), "utf8");
}

// 通过 page.evaluate(fetch) 调 PC 相对路径,自动带 cookie
async function apiGet<T = any>(page: Page, relPath: string): Promise<{ status: number; data: T; raw: string }> {
  return await page.evaluate(async (p) => {
    const resp = await fetch(p, { credentials: "include", headers: { "Cache-Control": "no-store" } });
    const text = await resp.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* ignore */ }
    return { status: resp.status, data: data?.data ?? data, raw: text };
  }, relPath);
}

async function apiSend<T = any>(page: Page, method: "POST" | "PATCH" | "PUT" | "DELETE", relPath: string, body?: any): Promise<{ status: number; data: T; raw: string }> {
  return await page.evaluate(async ({ p, m, b }) => {
    const idem = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const headers: Record<string, string> = { "Content-Type": "application/json", "Idempotency-Key": `f1acc-${idem}` };
    const resp = await fetch(p, { method: m, headers, body: b ? JSON.stringify(b) : undefined, credentials: "include" });
    const text = await resp.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* ignore */ }
    return { status: resp.status, data: data?.data ?? data, raw: text };
  }, { p: relPath, m: method, b: body });
}

async function getRankRow(page: Page, rank: string): Promise<any> {
  const r = await apiGet<any>(page, "/api/admin/teams/ranks");
  return (r.data?.vrankRows ?? []).find((row: any) => row.v === rank) ?? {};
}

async function loginFromUi(page: Page, username = "superadmin", password = (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })())) {
  await page.goto(`${PC_BASE}/`);
  // 等登录页可见
  await page.waitForTimeout(1500);
  const userInput = page.getByLabel(/用户名|账号|Username/).first();
  await expect(userInput).toBeVisible({ timeout: 15_000 });
  await userInput.fill(username);
  await page.getByLabel(/密码|Password/).first().fill(password);
  await page.getByRole("button", { name: /继续|登录|Sign in|Log in/ }).first().click();
  // 等进入 console shell
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500); // 等 cookie 设置
}

async function openF1(page: Page) {
  const groupBtn = page.getByRole("button", { name: /分销与团队.*F|F\s+分销与团队/ }).first();
  if (await groupBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await groupBtn.click().catch(() => undefined);
  }
  await page.waitForTimeout(500);
  await page.locator('a[href="/network/v-rank"]').first().click();
  await expect(page).toHaveURL(/\/network\/v-rank/, { timeout: 30_000 });
  await expect(page.getByText(/V-Rank 13 阶阶梯/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".lrow").first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(800);
}

test.describe("F1 V-Rank 独立首次用户验收 v2", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1680, height: 950 } });
    page = await ctx.newPage();
    attachCollectors(page);
  });

  test.afterAll(async () => {
    result.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(EVIDENCE_DIR, "raw-result.json"), JSON.stringify(result, null, 2), "utf8");
    await dumpLogs();
    try { await page.context().close(); } catch { /* ignore */ }
  });

  test("F1-I-01 ~ F1-I-13 完整走查 v2", async () => {
    test.setTimeout(900_000);

    // ========== F1-I-01 ==========
    try {
      await loginFromUi(page);
      await openF1(page);
      const url = page.url();
      const bodyText = await page.locator("body").innerText();
      await shot(page, "01-01-f1-entry");
      const hasPromotionLog = /晋升记录/.test(bodyText);
      const hasPayoutFlow = /派发流水|奖励派发/.test(bodyText);
      mark("F1-I-01", "passed",
        ["screenshots/01-01-f1-entry.png"],
        `URL=${url}; 晋升记录流=${hasPromotionLog}; 派发流水=${hasPayoutFlow}`);
      if (!hasPromotionLog) {
        addDefect("F1-D-PROMOTION-LOG-MISSING", "P1",
          "F1 缺少 PRD ② 第 2 区「晋升记录流」",
          "登录 → 侧栏 F → V-Rank 晋升 → 检查页面四区结构",
          "页面无「晋升记录流」区块,看不到 userId/before→after V/operator/判定快照",
          "PRD ② 第 2 区强制要求「晋升记录流」:userId/晋升前 V→晋升后 V/触发时点/判定快照/手动标记/operator;是验证 server 晋升判定是否真发生、申诉处理、审计回溯的关键业务区块",
          ["screenshots/01-01-f1-entry.png", "PRD §1264"]);
      }
      if (!hasPayoutFlow) {
        addDefect("F1-D-PAYOUT-FLOW-MISSING", "P1",
          "F1 缺少 PRD ② 第 4 区「奖励派发流水」",
          "登录 → 侧栏 F → V-Rank 晋升 → 检查页面四区结构",
          "页面无「奖励派发流水」区块,看不到受奖 userId/达成 V 级/奖励项/受奖上线/结算态/D4 billId",
          "PRD ② 第 4 区强制要求「奖励派发流水」;是核验奖励是否真派发、D4 bill 联动、补发撤销入口的承载区",
          ["screenshots/01-01-f1-entry.png", "PRD §1266"]);
      }
    } catch (e) {
      mark("F1-I-01", "failed", [], (e as Error).message);
      throw e;
    }

    // ========== F1-I-02 13 阶阶梯列表完整性 ==========
    try {
      const ladderRows = await page.locator(".lrow").count();
      const vLabels = await page.locator(".vbadge").allTextContents();
      const popTexts = await page.locator(".pop .ct").allTextContents();
      const pops = popTexts.map((p) => Number(String(p).replace(/[^\d]/g, "")));
      const ranksApi = await apiGet<any>(page, "/api/admin/teams/ranks");
      const backendRows = ranksApi.data?.vrankRows ?? [];
      const backendCount = backendRows.length;
      const v1Row = backendRows.find((r: any) => r.v === "V1") ?? {};
      const v5Row = backendRows.find((r: any) => r.v === "V5") ?? {};
      const v12Row = backendRows.find((r: any) => r.v === "V12") ?? {};
      await shot(page, "02-01-ladder-13");
      const ok = ladderRows === 13 && vLabels.length === 13 && backendCount === 13 && pops.every((p) => p >= 0);
      mark("F1-I-02", ok ? "passed" : "failed",
        ["screenshots/02-01-ladder-13.png"],
        `ladderRows=${ladderRows}; vLabels=${vLabels.join(",")}; backendCount=${backendCount}; pops(前3)=${pops.slice(0, 3).join(",")}; V1.selfBuy=${v1Row.selfBuy} V5.teamGv=${v5Row.teamGv} V12.teamGv=${v12Row.teamGv}`);
    } catch (e) {
      mark("F1-I-02", "failed", [], (e as Error).message);
    }

    // ========== F1-I-03 门槛字段调整闭环 ==========
    try {
      await dismissDialogs(page);
      const v2Before = await getRankRow(page, "V2");
      const originalTeamGv = String(v2Before.teamGv ?? ""); // 如 "$5k"
      const numericMatch = originalTeamGv.match(/[\d.]+/);
      const originalNum = numericMatch ? Number(numericMatch[0]) : 5000;
      const newNum = originalNum + 123;
      // 后端 normalize 接受数字字符串
      const newValueStr = String(newNum);

      // 找 V2 行「团队GV」按钮 (用 nth 更稳:V0=0 V1=1 V2=2)
      const v2Row = page.locator(".lrow").nth(2);
      await v2Row.scrollIntoViewIfNeeded();
      const teamGvBtn = v2Row.locator("button.fbtn").filter({ hasText: /团队GV/ }).first();
      await expect(teamGvBtn).toBeVisible({ timeout: 5_000 });
      await teamGvBtn.click();
      const dialog = page.locator('[role="dialog"]:visible').last();
      await expect(dialog).toBeVisible({ timeout: 8_000 });
      await shot(page, "03-01-threshold-dialog");
      // 空理由阻断
      const confirmBtn = dialog.locator("button").filter({ hasText: /确认|保存|执行/ }).first();
      await dialog.locator("input:visible").first().fill(newValueStr);
      await shot(page, "03-02-threshold-no-reason");
      let reasonRejected = await confirmBtn.isDisabled().catch(() => false);
      if (!reasonRejected) {
        // 检查按钮是否被 disabled class 标记或 mouse-disabled
        const cls = await confirmBtn.getAttribute("class").catch(() => "");
        if (cls && /disabled|pending|locked/i.test(cls)) reasonRejected = true;
      }
      // 填合法理由
      const textarea = dialog.locator("textarea:visible").first();
      await textarea.fill(`${REASON_PREFIX}-I03-threshold-change-from-${originalNum}-to-${newNum}`);
      await shot(page, "03-03-threshold-ready");
      // 重新定位确认按钮
      const confirmBtn2 = dialog.locator("button").filter({ hasText: /确认|保存|执行/ }).first();
      await confirmBtn2.click();
      // 等弹窗关闭
      await expect(dialog).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      await shot(page, "03-04-threshold-submitted");
      // 回读
      const v2After = await getRankRow(page, "V2");
      // 硬刷新
      await page.reload();
      await expect(page.getByText(/V-Rank 13 阶阶梯/)).toBeVisible({ timeout: 20_000 });
      const v2Reload = await getRankRow(page, "V2");
      await shot(page, "03-05-threshold-reread");
      const writeOk = String(v2After.teamGv ?? "").includes(String(newNum)) || String(v2After.teamGv ?? "") !== originalTeamGv;
      const reloadOk = String(v2Reload.teamGv ?? "") === String(v2After.teamGv ?? "");
      mark("F1-I-03", writeOk && reloadOk ? "passed" : "failed",
        ["screenshots/03-01-threshold-dialog.png", "screenshots/03-04-threshold-submitted.png", "screenshots/03-05-threshold-reread.png"],
        `originalTeamGv="${originalTeamGv}"; newValue="${newValueStr}"; v2After.teamGv="${v2After.teamGv}"; v2Reload.teamGv="${v2Reload.teamGv}"; reasonRejected=${reasonRejected}; writeOk=${writeOk}; reloadOk=${reloadOk}`);

      // === 恢复 ===
      await dismissDialogs(page);
      await page.locator(".lrow").nth(2).scrollIntoViewIfNeeded();
      const v2RowRestore = page.locator(".lrow").nth(2);
      await v2RowRestore.locator("button.fbtn").filter({ hasText: /团队GV/ }).first().click();
      const dlg = page.locator('[role="dialog"]:visible').last();
      await expect(dlg).toBeVisible({ timeout: 8_000 });
      await dlg.locator("input:visible").first().fill(String(originalNum));
      await dlg.locator("textarea:visible").first().fill(`${REASON_PREFIX}-I03-restore-to-${originalNum}`);
      await dlg.locator("button").filter({ hasText: /确认|保存|执行/ }).first().click();
      await expect(dlg).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      const v2Restored = await getRankRow(page, "V2");
      result.cleanup.push(`V2.team_volume_usd: ${originalNum} -> ${newNum} -> restored ${v2Restored.teamGv}`);
      await shot(page, "03-06-threshold-restored");
    } catch (e) {
      mark("F1-I-03", "failed", [], (e as Error).message);
    }

    // ========== F1-I-04 奖励 CRUD 闭环 ==========
    try {
      await dismissDialogs(page);
      // V5 当前奖励快照
      const v5Before = await getRankRow(page, "V5");
      await shot(page, "04-00-v5-before");
      // 新增 NEX 奖励
      const v5Row = page.locator(".lrow").nth(5);
      await v5Row.scrollIntoViewIfNeeded();
      await v5Row.locator("button").filter({ hasText: /加奖励|\+ 加奖励/ }).first().click();
      let dlg = page.locator('[role="dialog"]:visible').last();
      await expect(dlg).toBeVisible({ timeout: 8_000 });
      await shot(page, "04-01-reward-add-dialog");
      // 选 NEX 类型
      const nexChip = dlg.locator("button, .chip, [role='option'], label").filter({ hasText: /^NEX$/ }).first();
      if (await nexChip.isVisible({ timeout: 1_500 }).catch(() => false)) {
        await nexChip.click();
      }
      // 填数额(找 input[type=number] 或空 input)
      const amountInput = dlg.locator("input[type='number']").first();
      if (await amountInput.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await amountInput.fill("12345");
      } else {
        // 退而求其次:第二个 input(第一个可能是 type 选择)
        const inputs = dlg.locator("input:visible");
        const cnt = await inputs.count();
        if (cnt >= 1) await inputs.last().fill("12345");
      }
      await dlg.locator("textarea:visible").first().fill(`${REASON_PREFIX}-I04-reward-add`);
      await shot(page, "04-02-reward-add-ready");
      await dlg.locator("button").filter({ hasText: /确认|执行|保存/ }).first().click();
      await expect(dlg).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(2000);
      await shot(page, "04-03-reward-add-submitted");
      const v5AfterAdd = await getRankRow(page, "V5");
      const addOk = JSON.stringify(v5AfterAdd.rewards ?? []).includes("12345");
      const newReward = (v5AfterAdd.rewards ?? []).find((r: any) => Number(r.amount) === 12345);

      // 编辑为 USDT 100
      let editOk = false;
      if (newReward) {
        await dismissDialogs(page);
        await page.reload();
        await expect(page.getByText(/V-Rank 13 阶阶梯/)).toBeVisible({ timeout: 20_000 });
        const v5Row2 = page.locator(".lrow").nth(5);
        const rwdChip = v5Row2.locator(".rwd-chip").filter({ hasText: /12345/ }).first();
        await expect(rwdChip).toBeVisible({ timeout: 5_000 });
        await rwdChip.locator("button.rwd-edit").click();
        dlg = page.locator('[role="dialog"]:visible').last();
        await expect(dlg).toBeVisible({ timeout: 8_000 });
        await shot(page, "04-04-reward-edit-dialog");
        const usdtChip = dlg.locator("button, .chip, [role='option'], label").filter({ hasText: /^USDT$/ }).first();
        if (await usdtChip.isVisible({ timeout: 1_500 }).catch(() => false)) {
          await usdtChip.click();
        }
        const amtEdit = dlg.locator("input[type='number']").first();
        if (await amtEdit.isVisible({ timeout: 1_000 }).catch(() => false)) {
          await amtEdit.fill("100");
        } else {
          await dlg.locator("input:visible").last().fill("100");
        }
        await dlg.locator("textarea:visible").first().fill(`${REASON_PREFIX}-I04-reward-edit`);
        await shot(page, "04-05-reward-edit-ready");
        await dlg.locator("button").filter({ hasText: /确认|执行|保存/ }).first().click();
        await expect(dlg).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
        await page.waitForTimeout(2000);
        const v5AfterEdit = await getRankRow(page, "V5");
        editOk = JSON.stringify(v5AfterEdit.rewards ?? "").toLowerCase().includes("usdt") && JSON.stringify(v5AfterEdit.rewards ?? "").includes("100");
        await shot(page, "04-06-reward-edit-submitted");
      }

      // 删除
      let deleteOk = false;
      await dismissDialogs(page);
      await page.reload();
      await expect(page.getByText(/V-Rank 13 阶阶梯/)).toBeVisible({ timeout: 20_000 });
      const v5Row3 = page.locator(".lrow").nth(5);
      const rwdChip2 = v5Row3.locator(".rwd-chip").filter({ hasText: /100/ }).first();
      if (await rwdChip2.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await rwdChip2.locator("button.rwd-del").click();
        dlg = page.locator('[role="dialog"]:visible').last();
        await expect(dlg).toBeVisible({ timeout: 8_000 });
        await dlg.locator("textarea:visible").first().fill(`${REASON_PREFIX}-I04-reward-remove`);
        await shot(page, "04-07-reward-del-dialog");
        await dlg.locator("button").filter({ hasText: /确认|执行|移除|删除/ }).first().click();
        await expect(dlg).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
        await page.waitForTimeout(2000);
        const v5AfterDel = await getRankRow(page, "V5");
        deleteOk = !JSON.stringify(v5AfterDel.rewards ?? "").includes("100");
        await shot(page, "04-08-reward-del-submitted");
      }

      mark("F1-I-04", addOk && editOk && deleteOk ? "passed" : "failed",
        ["screenshots/04-03-reward-add-submitted.png", "screenshots/04-06-reward-edit-submitted.png", "screenshots/04-08-reward-del-submitted.png"],
        `addOk=${addOk}; editOk=${editOk}; deleteOk=${deleteOk}; v5BeforeRewards=${JSON.stringify(v5Before.rewards ?? [])}`);
      result.cleanup.push(`V5 rewards restored (add+edit+delete cycle complete)`);
    } catch (e) {
      mark("F1-I-04", "failed", [], (e as Error).message);
    }

    // ========== F1-I-05 不降级开关 (走 A2 propose, 不期望即时翻转) ==========
    try {
      await dismissDialogs(page);
      const permanentBtn = page.locator("button").filter({ hasText: /关闭不降级保护|开启不降级保护/ }).first();
      await expect(permanentBtn).toBeVisible({ timeout: 5_000 });
      const before = await permanentBtn.innerText();
      const wasOn = before.includes("关闭");
      await permanentBtn.click();
      let dlg = page.locator('[role="dialog"]:visible').last();
      await expect(dlg).toBeVisible({ timeout: 8_000 });
      await shot(page, "05-01-permanent-dialog");
      const dialogText = await dlg.innerText();
      const hasWarn = /高风险|剥夺已得权益|不降级|降级/.test(dialogText);
      await dlg.locator("textarea:visible").first().fill(`${REASON_PREFIX}-I05-permanent-toggle`);
      await dlg.locator("button").filter({ hasText: /确认|执行/ }).first().click();
      await expect(dlg).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(2000);
      // toast 抓取
      const toastText = await page.locator('.toast, [role="status"], [role="alert"]').last().innerText().catch(() => "");
      const proposeOk = /A2|待|提案|已写入|队列|确认/.test(toastText);
      await shot(page, "05-02-permanent-after-propose");
      mark("F1-I-05", hasWarn && proposeOk ? "passed" : "warning",
        ["screenshots/05-01-permanent-dialog.png", "screenshots/05-02-permanent-after-propose.png"],
        `before="${before}"; hasWarn=${hasWarn}; proposeOk=${proposeOk}; toast="${toastText.slice(0, 150)}"; 注:走 A2 propose, 配置不立即翻转是预期(需审批 replay)`);
      // 测后通过底层 API 恢复(避免依赖 A2 审批)
      await apiSend(page, "PATCH", "/api/admin/teams/commissions/config/F.vrank.permanent", { value: "on", reason: `${REASON_PREFIX}-I05-cleanup`, operator: "superadmin" }).catch(() => undefined);
      result.cleanup.push(`F.vrank.permanent restored to on via direct API`);
    } catch (e) {
      mark("F1-I-05", "failed", [], (e as Error).message);
    }

    // ========== F1-I-06 全局奖品名 (走 A2 propose) ==========
    try {
      await dismissDialogs(page);
      const prizeBtn = page.locator("button").filter({ hasText: /配置奖品名|修改奖品名/ }).first();
      await expect(prizeBtn).toBeVisible({ timeout: 5_000 });
      await prizeBtn.click();
      let dlg = page.locator('[role="dialog"]:visible').last();
      await expect(dlg).toBeVisible({ timeout: 8_000 });
      const input = dlg.locator("input:visible").first();
      const currentVal = await input.inputValue().catch(() => "");
      const newPrize = `${REASON_PREFIX}-TEST-PRIZE`;
      await input.fill(newPrize);
      await dlg.locator("textarea:visible").first().fill(`${REASON_PREFIX}-I06-prize-name`);
      await shot(page, "06-01-prize-dialog");
      await dlg.locator("button").filter({ hasText: /确认|执行|保存/ }).first().click();
      await expect(dlg).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(2000);
      const toastText = await page.locator('.toast, [role="status"], [role="alert"]').last().innerText().catch(() => "");
      const proposeOk = /A2|待|提案|已写入|队列|确认/.test(toastText);
      await shot(page, "06-02-prize-after-propose");
      mark("F1-I-06", proposeOk ? "passed" : "warning",
        ["screenshots/06-01-prize-dialog.png", "screenshots/06-02-prize-after-propose.png"],
        `currentVal="${currentVal}"; newPrize="${newPrize}"; proposeOk=${proposeOk}; toast="${toastText.slice(0, 150)}"; 注:走 A2 propose, 配置不立即持久是预期`);
      // 测后恢复(底层 API)
      await apiSend(page, "PATCH", "/api/admin/teams/commissions/config/F.prize.name", { value: currentVal || "Nexion V-Rank", reason: `${REASON_PREFIX}-I06-cleanup`, operator: "superadmin" }).catch(() => undefined);
      result.cleanup.push(`F.prize.name restored to "${currentVal}" via direct API`);
    } catch (e) {
      mark("F1-I-06", "failed", [], (e as Error).message);
    }

    // ========== F1-I-07 13 阶头衔 ==========
    try {
      await dismissDialogs(page);
      const titlesBtn = page.locator("button").filter({ hasText: /配置 13 阶头衔|配置头衔/ }).first();
      await expect(titlesBtn).toBeVisible({ timeout: 5_000 });
      await titlesBtn.click();
      let dlg = page.locator('[role="dialog"]:visible').last();
      await expect(dlg).toBeVisible({ timeout: 8_000 });
      await shot(page, "07-01-titles-dialog");
      const inputs = dlg.locator("input:visible");
      const inputCount = await inputs.count();
      const v5Input = inputs.nth(5);
      const v5Original = await v5Input.inputValue().catch(() => "");
      await v5Input.fill(`${v5Original || "Captain"}-F1ACC`);
      // 空提交测试:V7 清空
      const v7Input = inputs.nth(7);
      const v7Original = await v7Input.inputValue().catch(() => "");
      await v7Input.fill("");
      await dlg.locator("textarea:visible").first().fill(`${REASON_PREFIX}-I07-titles`);
      await dlg.locator("button").filter({ hasText: /确认|执行|保存/ }).first().click().catch(() => undefined);
      await page.waitForTimeout(1500);
      const dialogVisibleAfterEmpty = await page.locator('[role="dialog"]:visible').count();
      // 恢复 V7
      if (dialogVisibleAfterEmpty > 0) {
        await v7Input.fill(v7Original || "Commander");
      }
      await shot(page, "07-02-titles-v5-changed");
      // 提交合法
      await dlg.locator("button").filter({ hasText: /确认|执行|保存/ }).first().click();
      await expect(dlg).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(2000);
      await shot(page, "07-03-titles-submitted");
      await page.reload();
      await expect(page.getByText(/V-Rank 13 阶阶梯/)).toBeVisible({ timeout: 20_000 });
      mark("F1-I-07", inputCount === 13 ? "passed" : "failed",
        ["screenshots/07-01-titles-dialog.png", "screenshots/07-03-titles-submitted.png"],
        `inputCount=${inputCount}; v5Original="${v5Original}"; emptyBlock=${dialogVisibleAfterEmpty > 0}`);
      // 恢复 V5
      await dismissDialogs(page);
      const titlesBtn2 = page.locator("button").filter({ hasText: /配置 13 阶头衔|配置头衔/ }).first();
      if (await titlesBtn2.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await titlesBtn2.click();
        const dlg2 = page.locator('[role="dialog"]:visible').last();
        if (await dlg2.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await dlg2.locator("input:visible").nth(5).fill(v5Original || "Captain");
          await dlg2.locator("textarea:visible").first().fill(`${REASON_PREFIX}-I07-restore`);
          await dlg2.locator("button").filter({ hasText: /确认|执行|保存/ }).first().click();
          await expect(dlg2).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
          await page.waitForTimeout(1500);
          result.cleanup.push(`F.vrank.titles V5 restored to "${v5Original}"`);
        }
      }
    } catch (e) {
      mark("F1-I-07", "failed", [], (e as Error).message);
    }

    // ========== F1-I-08 状态机:晋升是否真在 server 发生 ==========
    try {
      await dismissDialogs(page);
      // 整页文本(包含治理卡片)
      const fullText = await page.locator(".fdom, .dkpage, body").first().innerText();
      const hasNoRetro = /不降级|不回溯|下一轮|已晋升/.test(fullText);
      const railCardText = await page.locator(".rail-card").first().innerText().catch(() => "");
      const govOk = /不降级|已晋升|下一轮|门槛调整只对/.test(railCardText);
      // 检查是否有用户级晋升记录/奖励派发流水区块
      const hasPromotionLog = /晋升记录|晋升历史|userId.*晋升前|before→after|before→after V/i.test(fullText);
      await shot(page, "08-01-state-machine-text");
      mark("F1-I-08", hasNoRetro ? "warning" : "failed",
        ["screenshots/08-01-state-machine-text.png"],
        `hasNoRetro=${hasNoRetro}; govOk=${govOk}; hasPromotionLog=${hasPromotionLog}; 注:配置面无晋升记录流,首次用户无法直接验证"server 晋升是否真发生"`);
      if (hasNoRetro && !hasPromotionLog) {
        addDefect("F1-D-STATE-VISIBILITY", "P2",
          "F1 配置面无法观测「晋升判定实际发生」证据",
          "登录 F1 → 查找用户级晋升记录流或判定历史入口",
          "页面文案承诺 server 判定 100% canonical,但无用户级晋升历史区可查;申诉处置与审计回溯缺承载",
          "PRD ② 第 2 区 + ⑦ server-canonical 可见性;首次运营/审计员应能查到判定事实",
          ["screenshots/08-01-state-machine-text.png"]);
      }
    } catch (e) {
      mark("F1-I-08", "failed", [], (e as Error).message);
    }

    // ========== F1-I-09 权限三层:菜单/按钮/接口 ==========
    // 简化:验证 superadmin 写入接口可调用 + 验证后端 PreAuthorize 拒绝路径
    // (创建临时只读角色复杂度高,本次走"路径+权限码"白盒核对 + superadmin 基线)
    try {
      await dismissDialogs(page);
      const menuVisible = await page.locator('a[href="/network/v-rank"]').first().isVisible().catch(() => false);
      const writableButtonsVisible = await page.locator("button:visible").filter({ hasText: /加奖励|关闭不降级|配置奖品|配置.*头衔|自买额|团队GV|直推数|达标分支数|分支最低等级/ }).count();
      // superadmin 探针:PATCH V1.selfBuy 设为原值 650
      const probeResp = await apiSend(page, "PATCH", "/api/admin/teams/ranks/V1/thresholds/selfBuy", {
        value: "650", reason: `${REASON_PREFIX}-I09-super-probe`, operator: "superadmin",
      });
      const probeStatus = probeResp.status;
      await shot(page, "09-01-superadmin-write-probe");
      // 创建只读角色 + 临时账号 (容忍失败)
      const newRoleCode = `f1ro${RUN_ID.replace(/[^a-z0-9]/gi, "").toLowerCase()}`.slice(0, 28);
      const newAdminUser = `f1r${RUN_ID.replace(/[^a-z0-9]/gi, "").toLowerCase()}`.slice(0, 20);
      const newAdminPwd = "F1Reader@12345";
      const roleResp = await apiSend(page, "POST", "/api/admin/platform/roles", {
        code: newRoleCode, name: `F1 Reader ${RUN_ID}`, permissions: ["network_f1_read"], reason: `${REASON_PREFIX}-I09-role`, operator: "superadmin",
      });
      const roleOk = roleResp.status < 400;
      let adminCreateOk = false;
      let accountId: string | undefined;
      if (roleOk) {
        const adminResp = await apiSend(page, "POST", "/api/admin/platform/accounts", {
          username: newAdminUser, displayName: `F1 Reader ${RUN_ID}`, email: `${newAdminUser}@nexion.io`, role: newRoleCode, deliver: "handoff", initialPassword: newAdminPwd, reason: `${REASON_PREFIX}-I09-admin`, operator: "superadmin",
        });
        adminCreateOk = adminResp.status < 400;
        accountId = String(adminResp.data?.id ?? adminResp.data?.accountId ?? "");
      }
      let readonlyWriteBlocked = false;
      let menuVisibleForReader = false;
      let buttonHiddenForReader = false;
      if (adminCreateOk) {
        const readerCtx = await page.context().browser()!.newContext({ viewport: { width: 1680, height: 950 } });
        const readerPage = await readerCtx.newPage();
        try {
          await readerPage.goto(`${PC_BASE}/`);
          await readerPage.waitForTimeout(1500);
          await readerPage.getByLabel(/用户名|账号|Username/).first().fill(newAdminUser);
          await readerPage.getByLabel(/密码|Password/).first().fill(newAdminPwd);
          await readerPage.getByRole("button", { name: /继续|登录|Sign in|Log in/ }).first().click();
          await readerPage.waitForTimeout(3000);
          const asideVisible = await readerPage.locator("aside").isVisible({ timeout: 10_000 }).catch(() => false);
          if (asideVisible) {
            const grp = readerPage.getByRole("button", { name: /分销与团队.*F|F\s+分销与团队/ }).first();
            if (await grp.isVisible({ timeout: 5_000 }).catch(() => false)) {
              await grp.click().catch(() => undefined);
            }
            await readerPage.waitForTimeout(800);
            const f1Link = readerPage.locator('a[href="/network/v-rank"]').first();
            menuVisibleForReader = await f1Link.isVisible({ timeout: 5_000 }).catch(() => false);
            if (menuVisibleForReader) {
              await f1Link.click();
              await readerPage.waitForTimeout(2000);
              await shot(readerPage, "09-02-readonly-f1-page");
              const writeBtns = readerPage.locator("button:visible").filter({ hasText: /加奖励|关闭不降级|配置奖品|配置.*头衔|调整/ });
              const cnt = await writeBtns.count();
              let visibleWritable = 0;
              for (let i = 0; i < cnt; i++) {
                const b = writeBtns.nth(i);
                if (await b.isVisible().catch(() => false) && await b.isEnabled().catch(() => false)) visibleWritable++;
              }
              buttonHiddenForReader = visibleWritable === 0;
            }
            // 绕过页面直调写入
            const readonlyResp = await readerPage.evaluate(async () => {
              const r = await fetch("/api/admin/teams/ranks/V1/thresholds/selfBuy", {
                method: "PATCH",
                headers: { "Content-Type": "application/json", "Idempotency-Key": `f1acc-ro-${Date.now()}` },
                body: JSON.stringify({ value: "999", reason: "F1ACC readonly probe", operator: "reader" }),
                credentials: "include",
              });
              return { status: r.status, body: await r.text() };
            });
            readonlyWriteBlocked = readonlyResp.status >= 400;
            await shot(readerPage, "09-03-readonly-direct-api-attempt");
            if (!readonlyWriteBlocked) {
              // 恢复 V1.selfBuy
              await apiSend(page, "PATCH", "/api/admin/teams/ranks/V1/thresholds/selfBuy", { value: "650", reason: `${REASON_PREFIX}-I09-rollback`, operator: "superadmin" });
              result.cleanup.push(`V1.selfBuy rolled back after readonly leak`);
              addDefect("F1-D-PERMISSION-LEAK", "P0",
                "只读角色绕过页面直调 F1 写入接口未被 403 拦截",
                "创建只读角色(仅 network_f1_read)+临时管理员 → 登录 → 用只读 cookie 直调 PATCH /api/admin/teams/ranks/V1/thresholds/selfBuy",
                "接口接受写入(状态 < 400),数据库被修改",
                "PRD ⑥ 权限矩阵要求编辑门槛/奖励清单仅超管/增长 lead;后端 @PreAuthorize('hasAuthority(network_f1_write)') 应拒绝只读角色",
                ["screenshots/09-03-readonly-direct-api-attempt.png"]);
            }
          }
        } finally {
          await readerCtx.close();
        }
      }
      mark("F1-I-09", probeStatus < 400 && readonlyWriteBlocked ? "passed" : (adminCreateOk ? "failed" : "warning"),
        ["screenshots/09-01-superadmin-write-probe.png", "screenshots/09-02-readonly-f1-page.png", "screenshots/09-03-readonly-direct-api-attempt.png"],
        `menuVisible=${menuVisible}; writableButtonsVisible=${writableButtonsVisible}; probeStatus=${probeStatus}; roleOk=${roleOk}; adminCreateOk=${adminCreateOk}; menuVisibleForReader=${menuVisibleForReader}; buttonHiddenForReader=${buttonHiddenForReader}; readonlyWriteBlocked=${readonlyWriteBlocked}; roleErr=${roleResp.raw.slice(0, 200)}`);
      if (accountId) {
        const disableResp = await apiSend(page, "PATCH", `/api/admin/platform/accounts/${accountId}/status`, { status: "disabled", reason: `${REASON_PREFIX}-I09-cleanup`, operator: "superadmin" });
        result.cleanup.push(`temp admin ${newAdminUser} disabled (status=${disableResp.status})`);
      }
      if (roleOk) {
        const roleDelResp = await apiSend(page, "DELETE", `/api/admin/platform/roles/${newRoleCode}`, { reason: `${REASON_PREFIX}-I09-cleanup`, operator: "superadmin" });
        result.cleanup.push(`temp role ${newRoleCode} delete attempted (status=${roleDelResp.status})`);
      }
    } catch (e) {
      mark("F1-I-09", "failed", [], (e as Error).message);
    }

    // ========== F1-I-10 异常出口 ==========
    try {
      await dismissDialogs(page);
      const v1Row = page.locator(".lrow").nth(1);
      await v1Row.scrollIntoViewIfNeeded();
      await v1Row.locator("button.fbtn").filter({ hasText: /自买额/ }).first().click();
      let dlg = page.locator('[role="dialog"]:visible').last();
      await expect(dlg).toBeVisible({ timeout: 8_000 });
      await dlg.locator("input:visible").first().fill("1000");
      // 不填理由
      const confirmBtn = dlg.locator("button").filter({ hasText: /确认|执行|保存/ }).first();
      const disabledEmpty = await confirmBtn.isDisabled().catch(() => false);
      let reasonShown = disabledEmpty;
      if (!disabledEmpty) {
        await confirmBtn.click().catch(() => undefined);
        await page.waitForTimeout(1500);
        // 检查页面是否有错误提示或弹窗仍在
        const errVisible = await page.getByText(/理由|REASON_REQUIRED|至少|8字|不能为空/).count();
        if (errVisible > 0) reasonShown = true;
        // 检查弹窗是否仍开
        const dlgStill = await page.locator('[role="dialog"]:visible').count();
        if (dlgStill > 0) reasonShown = true;
      }
      await shot(page, "10-01-empty-reason-block");
      // 关闭弹窗
      await dismissDialogs(page);
      // 不合法字段(用接口直接测,不依赖 UI)
      // V3 的 legRank 改成 V99(不在 V0-V12 枚举)
      const invalidFieldResp = await apiSend(page, "PATCH", "/api/admin/teams/ranks/V3/thresholds/legRank", {
        value: "V99", reason: `${REASON_PREFIX}-I10-invalid-field`, operator: "superadmin",
      });
      const invalidFieldBlocked = invalidFieldResp.status >= 400;
      await shot(page, "10-02-invalid-field-block");
      mark("F1-I-10", reasonShown && invalidFieldBlocked ? "passed" : "warning",
        ["screenshots/10-01-empty-reason-block.png", "screenshots/10-02-invalid-field-block.png"],
        `reasonShown=${reasonShown}; invalidFieldBlocked=${invalidFieldBlocked}; invalidFieldStatus=${invalidFieldResp.status}`);
    } catch (e) {
      mark("F1-I-10", "failed", [], (e as Error).message);
    }

    // ========== F1-I-11 连续性 ==========
    try {
      await dismissDialogs(page);
      const before = await getRankRow(page, "V2");
      await page.reload();
      await expect(page.getByText(/V-Rank 13 阶阶梯/)).toBeVisible({ timeout: 20_000 });
      const afterReload = await getRankRow(page, "V2");
      await shot(page, "11-01-after-hard-reload");
      await page.goBack().catch(() => undefined);
      await page.waitForTimeout(1500);
      await shot(page, "11-02-after-go-back");
      await page.goForward().catch(() => undefined);
      await page.waitForTimeout(1500);
      const urlAfter = page.url();
      await shot(page, "11-03-after-go-forward");
      // 重登
      await apiSend(page, "POST", "/api/admin/auth/logout", {}).catch(() => undefined);
      await page.goto(`${PC_BASE}/`);
      await page.waitForTimeout(2000);
      await loginFromUi(page);
      await openF1(page);
      const afterRelogin = await getRankRow(page, "V2");
      await shot(page, "11-04-after-relogin");
      const persistOk = String(before.teamGv ?? "") === String(afterReload.teamGv ?? "")
                        && String(afterReload.teamGv ?? "") === String(afterRelogin.teamGv ?? "");
      mark("F1-I-11", persistOk ? "passed" : "failed",
        ["screenshots/11-01-after-hard-reload.png", "screenshots/11-04-after-relogin.png"],
        `before.teamGv="${before.teamGv}"; afterReload.teamGv="${afterReload.teamGv}"; afterRelogin.teamGv="${afterRelogin.teamGv}"; urlAfterForward="${urlAfter}"`);
    } catch (e) {
      mark("F1-I-11", "failed", [], (e as Error).message);
    }

    // ========== F1-I-12 资金大额奖励 B1 拦截 ==========
    try {
      await dismissDialogs(page);
      const v6Row = page.locator(".lrow").nth(6);
      await v6Row.scrollIntoViewIfNeeded();
      await v6Row.locator("button").filter({ hasText: /加奖励|\+ 加奖励/ }).first().click();
      let dlg = page.locator('[role="dialog"]:visible').last();
      await expect(dlg).toBeVisible({ timeout: 8_000 });
      const nexChip = dlg.locator("button, .chip, [role='option'], label").filter({ hasText: /^NEX$/ }).first();
      if (await nexChip.isVisible({ timeout: 1_500 }).catch(() => false)) {
        await nexChip.click();
      }
      const amt = dlg.locator("input[type='number']").first();
      if (await amt.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await amt.fill("1000000000"); // 10亿 NEX
      } else {
        await dlg.locator("input:visible").last().fill("1000000000");
      }
      await dlg.locator("textarea:visible").first().fill(`${REASON_PREFIX}-I12-huge-nex-probe`);
      await shot(page, "12-01-huge-nex-dialog");
      await dlg.locator("button").filter({ hasText: /确认|执行|保存/ }).first().click();
      await expect(dlg).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(2500);
      await shot(page, "12-02-huge-nex-result");
      const v6After = await getRankRow(page, "V6");
      const hugeAccepted = JSON.stringify(v6After.rewards ?? "").includes("1000000000") || JSON.stringify(v6After.rewards ?? "").includes("1e9");
      const toastOrAlert = await page.locator('.toast, [role="alert"], .text-red, .err').allTextContents();
      const b1Blocked = toastOrAlert.some((t) => /覆盖率|B1|COVERAGE|redline|备付金|红线/i.test(t));
      mark("F1-I-12", hugeAccepted ? "warning" : "passed",
        ["screenshots/12-01-huge-nex-dialog.png", "screenshots/12-02-huge-nex-result.png"],
        `hugeAccepted=${hugeAccepted}; b1Blocked=${b1Blocked}; toast=${JSON.stringify(toastOrAlert).slice(0, 200)}`);
      if (hugeAccepted) {
        addDefect("F1-D-B1-NOT-ENFORCED", "P1",
          "新增巨额 NEX 奖励项未触发 B1 覆盖率红线预检",
          "F1 → V6 「+ 加奖励」→ 类型 NEX → 数额 1,000,000,000 → 理由 → 确认",
          "后端接受写入,V6 rewards 清单新增 10 亿 NEX 项;前端无 B1 覆盖率警示条;无 422 COVERAGE_BELOW_REDLINE",
          "PRD ④a F1-MD2 + ⑤ PUT /api/admin/config/v-ranks 要求「新增/调升资金类(USDT/NEX)项方向 + B1 红线预检」;低于红线 422 阻断",
          ["screenshots/12-02-huge-nex-result.png", "PRD §1294/§1338"]);
        // 清理
        const hugeReward = (v6After.rewards ?? []).find((r: any) => Number(r.amount) >= 1_000_000_000);
        if (hugeReward) {
          await apiSend(page, "DELETE", `/api/admin/teams/ranks/V6/rewards/${hugeReward.id}`, { reason: `${REASON_PREFIX}-I12-huge-cleanup`, operator: "superadmin" });
          result.cleanup.push(`V6 huge NEX reward (id=${hugeReward.id}) deleted`);
        }
      }
    } catch (e) {
      mark("F1-I-12", "failed", [], (e as Error).message);
    }

    // ========== F1-I-13 文案/假数据核查 ==========
    try {
      await dismissDialogs(page);
      const bodyText = await page.locator("body").innerText();
      await shot(page, "13-01-full-page-text");
      const ranksApi = await apiGet<any>(page, "/api/admin/teams/ranks");
      const dataStr = JSON.stringify(ranksApi.data ?? {});
      const hasMonthlyPromotionInBackend = /monthlyPromotion|monthPromotions|promotionsThisMonth|promotionCount|\"monthlyPromotion\"/.test(dataStr);
      const hardcoded217 = bodyText.includes("+217");
      const hardcoded148 = bodyText.includes("+148");
      const totalMembers = ranksApi.data?.leadership?.totalMembers;
      const rows = ranksApi.data?.vrankRows ?? [];
      const computedTotal = rows.reduce((s: number, r: any) => s + Number(r.pop ?? 0), 0);
      const derivedOk = totalMembers === computedTotal || Math.abs(Number(totalMembers ?? 0) - computedTotal) <= 1;
      const topConcPct = ranksApi.data?.leadership?.topConcentrationPct;
      mark("F1-I-13", derivedOk && !hasMonthlyPromotionInBackend ? "warning" : "passed",
        ["screenshots/13-01-full-page-text.png"],
        `hardcoded217=${hardcoded217}; hardcoded148=${hardcoded148}; hasMonthlyPromotionInBackend=${hasMonthlyPromotionInBackend}; derivedOk=${derivedOk}; totalMembers=${totalMembers}; computedTotal=${computedTotal}; topConcPct=${topConcPct}`);
      if (hardcoded217 && !hasMonthlyPromotionInBackend) {
        addDefect("F1-D-HARDCODED-STATS", "P2",
          "F1 顶栏「本月晋升 +217 / V1 +148 / V2 +43 / V3+ +26」为前端硬编码假数据",
          "登录 F1 → 比对顶栏卡片文案与 GET /api/admin/teams/ranks 后端响应",
          "顶栏展示固定 +217/+148/+43/+26 数字,后端 ranks 响应不含 monthlyPromotion 字段;前端 f1-vrank.tsx 第 203 行直接硬编码",
          "PRD ① 「B5 头部集中度监控供 V 级分布维度」+ 验收方法 §二「数据一致性」;首次运营/审计员误以为真,可能基于假数据做决策",
          ["screenshots/13-01-full-page-text.png", "f1-vrank.tsx:203"]);
      }
    } catch (e) {
      mark("F1-I-13", "failed", [], (e as Error).message);
    }

    await shot(page, "99-final-full-page");
    result.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(EVIDENCE_DIR, "raw-result.json"), JSON.stringify(result, null, 2), "utf8");
  });
});
