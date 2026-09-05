/**
 * F2 网络版税费率 独立首次用户初验
 *
 * Run ID: F2ACC-20260721-131216
 * 载体: PC http://127.0.0.1:3002 (cookie-based, nexion_admin_token)
 * 代理: PC /api/admin/teams/[...path] 代理后端 :8110
 *
 * 锁定用例: 15 个 (F2-I-01 ~ F2-I-15)
 * 证据目录: D:/workspace/bug-pic/f-domain-sequential-acceptance-20260721-131216/f2/independent-first-user/initial
 *
 * 纪律:
 *  - 从可见登录入口走全流程, 不读业务代码猜行为
 *  - 主流程不 mock, 写操作必恢复原值
 *  - 所有后端调用走 PC 相对路径(cookie 自动 attach), 不直连 :8110
 *  - 用 page.evaluate(fetch) 双轨验证关键 API
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const EVIDENCE_DIR = "D:/workspace/bug-pic/f-domain-sequential-acceptance-20260721-131216/f2/independent-first-user/initial";
const RUN_ID = "F2ACC-20260721-131216";
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

async function apiGet<T = any>(page: Page, relPath: string): Promise<{ status: number; data: T; raw: string }> {
  return await page.evaluate(async (p) => {
    const resp = await fetch(p, { credentials: "include", headers: { "Cache-Control": "no-store" } });
    const text = await resp.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* ignore */ }
    return { status: resp.status, data: data?.data ?? data, raw: text };
  }, relPath);
}

async function apiSend<T = any>(page: Page, method: "POST" | "PATCH" | "PUT" | "DELETE", relPath: string, body?: any, idemPrefix = "f2acc"): Promise<{ status: number; data: T; raw: string }> {
  return await page.evaluate(async ({ p, m, b, idem }) => {
    const headers: Record<string, string> = { "Content-Type": "application/json", "Idempotency-Key": `${idem}-${Date.now()}-${Math.random().toString(16).slice(2)}` };
    const resp = await fetch(p, { method: m, headers, body: b ? JSON.stringify(b) : undefined, credentials: "include" });
    const text = await resp.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* ignore */ }
    return { status: resp.status, data: data?.data ?? data, raw: text };
  }, { p: relPath, m: method, b: body, idem: idemPrefix });
}

async function loginFromUi(page: Page, username = process.env.NEXION_E2E_ADMIN_USERNAME, password = process.env.NEXION_E2E_ADMIN_PASSWORD) {
  if (!username || !password) {
    throw new Error("Set NEXION_E2E_ADMIN_USERNAME and NEXION_E2E_ADMIN_PASSWORD before running authenticated acceptance tests.");
  }
  await page.goto(`${PC_BASE}/`);
  await page.waitForTimeout(1500);
  const userInput = page.getByLabel(/用户名|账号|Username/).first();
  await expect(userInput).toBeVisible({ timeout: 15_000 });
  await userInput.fill(username);
  await page.getByLabel(/密码|Password/).first().fill(password);
  await page.getByRole("button", { name: /继续|登录|Sign in|Log in/ }).first().click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
}

async function openF2(page: Page) {
  const groupBtn = page.getByRole("button", { name: /分销与团队.*F|F\s+分销与团队/ }).first();
  if (await groupBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await groupBtn.click().catch(() => undefined);
  }
  await page.waitForTimeout(500);
  await page.locator('a[href="/network/royalty"]').first().click();
  await expect(page).toHaveURL(/\/network\/royalty/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /网络版税费率/ })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(800);
}

async function getRatesSnapshot(page: Page) {
  const r = await apiGet<any>(page, "/api/admin/teams/rates");
  return r.data ?? {};
}
async function getCommissionsSnapshot(page: Page) {
  const r = await apiGet<any>(page, "/api/admin/teams/commissions");
  return r.data ?? {};
}

function sameCommissionSnapshot(before: unknown, after: unknown) {
  return JSON.stringify(before) === JSON.stringify(after);
}

test.describe("F2 网络版税费率 独立首次用户验收", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1680, height: 950 }, recordHar: { path: path.join(EVIDENCE_DIR, "har", "trace.har"), mode: "full" } });
    page = await ctx.newPage();
    attachCollectors(page);
  });

  test.afterAll(async () => {
    result.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(EVIDENCE_DIR, "raw-result.json"), JSON.stringify(result, null, 2), "utf8");
    await dumpLogs();
    try { await page.context().close(); } catch { /* ignore */ }
  });

  test("F2-I-01 ~ F2-I-15 完整走查", async () => {
    test.setTimeout(900_000);

    // ========== F2-I-01 可发现性与页面定位 ==========
    let snapshotRates: any = {};
    let snapshotCommissions: any = {};
    try {
      await loginFromUi(page);
      await openF2(page);
      const url = page.url();
      const bodyText = await page.locator("body").innerText();
      snapshotRates = await getRatesSnapshot(page);
      snapshotCommissions = await getCommissionsSnapshot(page);
      const hasRateTable = /L1[\s\S]{0,200}L7/.test(bodyText);
      const hasPartner = /Partner\s*Status|Partner\s+4\s+档|合伙人/.test(bodyText);
      const hasInfluence = /InfluenceScore|影响分|influence/i.test(bodyText);
      const hasCooling = /冷却|cooling|F\.cooldown/i.test(bodyText);
      const hasPause = /单层暂停|暂停.*层|layer.*pause/i.test(bodyText);
      const hasPromo = /promo|周倍率|weekMultiplier/i.test(bodyText);
      await shot(page, "01-01-f2-entry");
      const ok = url.includes("/network/royalty") && hasRateTable;
      mark("F2-I-01", ok ? "passed" : "failed",
        ["screenshots/01-01-f2-entry.png"],
        `URL=${url}; rateTable=${hasRateTable}; partner=${hasPartner}; influence=${hasInfluence}; cooling=${hasCooling}; pause=${hasPause}; promo=${hasPromo}`);
    } catch (e) {
      mark("F2-I-01", "failed", [], (e as Error).message);
      throw e;
    }

    // ========== F2-I-02 L1–L7 unilevel 费率完整性 ==========
    try {
      const cascRows = await page.locator(".casc-row").count();
      const lchips = await page.locator(".lchip").count();
      const ratesApi = await apiGet<any>(page, "/api/admin/teams/rates");
      const unilevelRates = ratesApi.data?.unilevelRates ?? [];
      const l1 = unilevelRates.find((r: any) => r.level === "L1") ?? {};
      const l7 = unilevelRates.find((r: any) => r.level === "L7") ?? {};
      const expectedUsdt = [10, 5, 3, 2, 1, 0.5, 0.5];
      const expectedNex = [50, 20, 10, 5, 2.5, 1, 1];
      const usdtMatches = unilevelRates.every((r: any, i: number) => Math.abs(Number(r.usdtPct) - expectedUsdt[i]) < 0.001);
      const nexMatches = unilevelRates.every((r: any, i: number) => Math.abs(Number(r.nexReward) - expectedNex[i]) < 0.001);
      const userFacingDirect = unilevelRates.filter((r: any) => r.label === "直推 DIRECT" || r.direct).length;
      const userFacingExtended = unilevelRates.filter((r: any) => r.label === "扩展 EXTENDED" || !r.direct).length;
      await shot(page, "02-01-l1-l7-rates");
      const ok = cascRows >= 7 && unilevelRates.length === 7 && usdtMatches && nexMatches && userFacingDirect === 1 && userFacingExtended === 6;
      mark("F2-I-02", ok ? "passed" : "failed",
        ["screenshots/02-01-l1-l7-rates.png"],
        `cascRows=${cascRows}; lchips=${lchips}; unilevelRates.length=${unilevelRates.length}; usdtMatches=${usdtMatches}; nexMatches=${nexMatches}; L1=${JSON.stringify(l1)}; L7=${JSON.stringify(l7)}; direct=${userFacingDirect}; extended=${userFacingExtended}`);
      if (!usdtMatches || !nexMatches) {
        addDefect("F2-D-DEFAULT-NOT-MATCH-PRD", "P2",
          "F2 L1–L7 默认费率与 PRD §1407-1408 不一致",
          "GET /api/admin/teams/rates 比对 PRD 默认值 [10%,5%,3%,2%,1%,0.5%,0.5%] / [50,20,10,5,2.5,1,1]",
          "unilevelRates 与 PRD 默认不一致",
          "PRD §1407-1408 默认值应一致",
          ["screenshots/02-01-l1-l7-rates.png", "PRD §1407-1408"]);
      }
    } catch (e) {
      mark("F2-I-02", "failed", [], (e as Error).message);
    }

    // ========== F2-I-03 调费率闭环 ==========
    let l3OriginalUsdt: any;
    let l3RestoredToOrigApi: any;
    try {
      await dismissDialogs(page);
      const ratesBefore = await getRatesSnapshot(page);
      const l3Before = (ratesBefore.unilevelRates ?? []).find((r: any) => r.level === "L3") ?? {};
      l3OriginalUsdt = l3Before.usdtPct;
      const originalNum = Number(l3OriginalUsdt ?? 3);
      const newNum = originalNum + 0.5; // 3 -> 3.5
      // 在 L3 行找"调整"按钮
      const l3Row = page.locator(".casc-row").nth(2); // L1=0 L2=1 L3=2
      await l3Row.scrollIntoViewIfNeeded();
      const adjustBtn = l3Row.locator("button").filter({ hasText: /调整/ }).first();
      await expect(adjustBtn).toBeVisible({ timeout: 5_000 });
      await adjustBtn.click();
      const dialog = page.locator('[role="dialog"]:visible').last();
      await expect(dialog).toBeVisible({ timeout: 8_000 });
      await shot(page, "03-01-rate-dialog");
      const dialogText = await dialog.innerText();
      const hasImpactPreview = /before|after|当前|目标|影响|总和|preview/i.test(dialogText);
      // 空理由测试
      const confirmBtn = dialog.locator("button").filter({ hasText: /确认|执行|保存|调费率/ }).first();
      let reasonBlocked = await confirmBtn.isDisabled().catch(() => false);
      // 填新值
      const numInputs = dialog.locator("input[type='number']");
      const inputCount = await numInputs.count();
      // 找到 USDT% 字段（通常第一个或 placeholder 含 USDT/%/费率）
      let usdtInput;
      for (let i = 0; i < inputCount; i++) {
        const inp = numInputs.nth(i);
        const ph = await inp.getAttribute("placeholder").catch(() => "");
        if (/USDT|费率|百分比|pct|%|rate/i.test(ph ?? "")) { usdtInput = inp; break; }
      }
      if (!usdtInput) usdtInput = numInputs.first();
      await usdtInput.fill(String(newNum));
      await shot(page, "03-02-rate-no-reason");
      // 重新检查
      reasonBlocked = reasonBlocked || await confirmBtn.isDisabled().catch(() => false);
      const textarea = dialog.locator("textarea:visible").first();
      await textarea.fill(`${REASON_PREFIX}-I03-rate-change-L3-${originalNum}-to-${newNum}`);
      await shot(page, "03-03-rate-ready");
      const confirmBtn2 = dialog.locator("button").filter({ hasText: /确认|执行|保存|调费率/ }).first();
      await confirmBtn2.click();
      await expect(dialog).toBeHidden({ timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(2500);
      await shot(page, "03-04-rate-submitted");
      const ratesAfter = await getRatesSnapshot(page);
      const l3After = (ratesAfter.unilevelRates ?? []).find((r: any) => r.level === "L3") ?? {};
      const writeOk = Math.abs(Number(l3After.usdtPct ?? 0) - newNum) < 0.01;
      // 硬刷新
      await page.reload();
      await expect(page.getByRole("heading", { name: /网络版税费率/ })).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(2000);
      const ratesReload = await getRatesSnapshot(page);
      const l3Reload = (ratesReload.unilevelRates ?? []).find((r: any) => r.level === "L3") ?? {};
      const reloadOk = Math.abs(Number(l3Reload.usdtPct ?? 0) - Number(l3After.usdtPct ?? 0)) < 0.01;
      await shot(page, "03-05-rate-reread");
      // 检查 toast 是否误导
      const toastText = await page.locator('.toast, [role="status"], [role="alert"]').last().innerText().catch(() => "");
      // 审计检查
      const auditResp = await apiGet<any>(page, "/api/admin/platform/audit/operations?pageNum=1&pageSize=10");
      const auditList = Array.isArray(auditResp.data?.list) ? auditResp.data.list : (Array.isArray(auditResp.data) ? auditResp.data : []);
      const recentAudit = auditList.slice(0, 8).map((a: any) => JSON.stringify(a)).join(" || ");
      const auditHit = /F2|commission|UNILEVEL|rate_change|费率/i.test(recentAudit);

      mark("F2-I-03", writeOk && reloadOk ? "passed" : "failed",
        ["screenshots/03-01-rate-dialog.png", "screenshots/03-04-rate-submitted.png", "screenshots/03-05-rate-reread.png"],
        `originalUsdt=${l3OriginalUsdt}; newNum=${newNum}; l3After=${l3After.usdtPct}; reloadUsdt=${l3Reload.usdtPct}; reasonBlocked=${reasonBlocked}; hasImpactPreview=${hasImpactPreview}; toast="${toastText.slice(0, 200)}"; auditHit=${auditHit}; recentAudit=${recentAudit.slice(0, 400)}`);
      if (!hasImpactPreview) {
        addDefect("F2-D-RATE-DIALOG-NO-IMPACT-PREVIEW", "P2",
          "F2 调费率弹窗缺少 PRD F2-MD1 要求的 before/after 影响预览区",
          "F2 → L3 行「调整」→ 检查弹窗内容",
          "弹窗无 before→after 并排展示与七层总和重算预览",
          "PRD F2-MD1 §1452 强制要求「影响预览区(必有):before→after 并排展示 + 七层总和重算预览」",
          ["screenshots/03-01-rate-dialog.png", "PRD §1452"]);
      }

      // === 恢复 L3 ===
      await dismissDialogs(page);
      l3RestoredToOrigApi = await apiSend(page, "PATCH", "/api/admin/teams/commissions/config/F.unilevel.usdt", {
        value: String(originalNum), reason: `${REASON_PREFIX}-I03-restore-L3-to-${originalNum}`, operator: "superadmin", scope: { level: "L3" },
      }, "f2acc-restore-l3");
      await page.waitForTimeout(1500);
      const ratesRestored = await getRatesSnapshot(page);
      const l3Restored = (ratesRestored.unilevelRates ?? []).find((r: any) => r.level === "L3") ?? {};
      result.cleanup.push(`L3.usdtPct: ${originalNum} -> ${newNum} -> restored ${l3Restored.usdtPct} (api status=${l3RestoredToOrigApi?.status})`);
    } catch (e) {
      mark("F2-I-03", "failed", [], (e as Error).message);
    }

    // ========== F2-I-04 Partner Status 4 档 ==========
    try {
      await dismissDialogs(page);
      const bodyText = await page.locator("body").innerText();
      const hasStandard = /Standard/i.test(bodyText);
      const hasVerified = /Verified/i.test(bodyText);
      const hasPremium = /Premium/i.test(bodyText);
      const hasDiamond = /Diamond/i.test(bodyText);
      const hasBronze = /bronze/i.test(bodyText);
      const hasSilver = /silver/i.test(bodyText);
      const hasGold = /\bgold\b/i.test(bodyText);
      // 4 档门槛校验：$0/$5000/$50000/$500000
      const partnerBtn = page.locator("button").filter({ hasText: /Partner 4 档|Partner\s*Status|合伙人 4 档/ }).first();
      await shot(page, "04-01-partner-text");
      const commissionsApi = await getCommissionsSnapshot(page);
      const partnerStatus = commissionsApi.partnerStatus ?? commissionsApi.rateTiers ?? [];
      // 尝试点击 Partner 入口
      if (await partnerBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await partnerBtn.first().click().catch(() => undefined);
        const dlg = page.locator('[role="dialog"]:visible').last();
        if (await dlg.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await shot(page, "04-02-partner-dialog");
          await dismissDialogs(page);
        }
      }
      const prdNames = ["Standard", "Verified", "Premium", "Diamond"];
      const uiNamesOk = hasStandard && hasVerified && hasPremium && hasDiamond;
      const altNamesUsed = hasBronze || hasSilver || hasGold;
      mark("F2-I-04", uiNamesOk ? "passed" : (altNamesUsed ? "warning" : "failed"),
        ["screenshots/04-01-partner-text.png"],
        `Standard=${hasStandard}; Verified=${hasVerified}; Premium=${hasPremium}; Diamond=${hasDiamond}; bronze=${hasBronze}; silver=${hasSilver}; gold=${hasGold}; partnerStatusKeys=${JSON.stringify(partnerStatus).slice(0, 400)}`);
      if (altNamesUsed && !uiNamesOk) {
        addDefect("F2-D-PARTNER-NAMES-MISMATCH", "P2",
          "F2 Partner Status 档名与 PRD §1410 不一致",
          "F2 页面检查 Partner Status 4 档名称",
          "页面显示 bronze/silver/gold/diamond 等非 PRD 命名",
          "PRD §1410 规定 Standard / Verified / Premium / Diamond",
          ["screenshots/04-01-partner-text.png", "PRD §1410"]);
      }
    } catch (e) {
      mark("F2-I-04", "failed", [], (e as Error).message);
    }

    // ========== F2-I-05 promotion 周倍率 ==========
    try {
      await dismissDialogs(page);
      const promoBtn = page.locator("button").filter({ hasText: /调整/ }).filter({ has: page.locator(":scope").filter({ hasText: /promo|周倍率|weekMultiplier/i }) });
      // 备选：找紧邻 F.promo.weekMultiplier 文本的"调整"按钮
      const allAdjustBtns = page.locator("button").filter({ hasText: /^调整$/ });
      const cnt = await allAdjustBtns.count();
      let clicked = false;
      for (let i = 0; i < cnt; i++) {
        const btn = allAdjustBtns.nth(i);
        const parentText = await btn.locator("xpath=ancestor::*[position()=1]").innerText().catch(() => "");
        if (/promo|周倍率|weekMultiplier/i.test(parentText)) {
          await btn.scrollIntoViewIfNeeded();
          await btn.click();
          clicked = true;
          break;
        }
      }
      let dialogOpened = false;
      let hasMultiplierField = false;
      let hasStartEnd = false;
      let b1Precheck = false;
      let outOfRangeBlocked = false;
      if (clicked) {
        const dlg = page.locator('[role="dialog"]:visible').last();
        dialogOpened = await dlg.isVisible({ timeout: 6_000 }).catch(() => false);
        if (dialogOpened) {
          await shot(page, "05-01-promo-dialog");
          const dlgText = await dlg.innerText();
          hasMultiplierField = /multiplier|倍率|1\.0.*3\.0|倍数/i.test(dlgText);
          hasStartEnd = /startAt|endAt|起|止|开始|结束|周期|周边界/i.test(dlgText);
          b1Precheck = /B1|覆盖率|COVERAGE|红线/i.test(dlgText);
          // 越界测试: 0.2
          const numInputs = dlg.locator("input[type='number']");
          const firstNum = numInputs.first();
          if (await firstNum.isVisible({ timeout: 1_500 }).catch(() => false)) {
            await firstNum.fill("0.2");
            const ta = dlg.locator("textarea:visible").first();
            await ta.fill(`${REASON_PREFIX}-I05-promo-outofrange-probe`);
            const cbtn = dlg.locator("button").filter({ hasText: /确认|执行|保存|设置倍率/ }).first();
            await cbtn.click().catch(() => undefined);
            await page.waitForTimeout(2000);
            // 若弹窗仍在或出现错误
            const dlgStill = await page.locator('[role="dialog"]:visible').count();
            const errToast = await page.locator('.toast, [role="alert"], .err, .text-red').allTextContents();
            outOfRangeBlocked = dlgStill > 0 || errToast.some((t) => /范围|越界|invalid|range|1\.0.*3\.0|必须/i.test(t));
            await shot(page, "05-02-promo-outofrange");
          }
          await dismissDialogs(page);
        }
      }
      mark("F2-I-05", dialogOpened && hasMultiplierField ? "passed" : "warning",
        ["screenshots/05-01-promo-dialog.png"],
        `clicked=${clicked}; dialogOpened=${dialogOpened}; hasMultiplierField=${hasMultiplierField}; hasStartEnd=${hasStartEnd}; b1Precheck=${b1Precheck}; outOfRangeBlocked=${outOfRangeBlocked}`);
      if (dialogOpened && !hasStartEnd) {
        addDefect("F2-D-PROMO-NO-DATE-RANGE", "P2",
          "F2 promo 周倍率弹窗缺 startAt/endAt 起止周字段",
          "F2 → F.promo.weekMultiplier 「调整」→ 检查弹窗字段",
          "弹窗无起止周输入",
          "PRD F2-MD3 §1489 强制要求 startAt / endAt 日期区间选择(设时必填)",
          ["screenshots/05-01-promo-dialog.png", "PRD §1489"]);
      }
      if (dialogOpened && !b1Precheck) {
        addDefect("F2-D-PROMO-NO-B1-PRECHECK", "P1",
          "F2 promo 周倍率弹窗缺 B1 覆盖率红线预检回显(放大流出向)",
          "F2 → F.promo.weekMultiplier 「调整」→ 检查弹窗是否有 B1 覆盖率/红线展示",
          "弹窗无 B1 覆盖率预检结果回显",
          "PRD F2-MD3 §1483 + ④a §1432 「设方向(>1.0) + B1 红线核验结果回显」强制要求",
          ["screenshots/05-01-promo-dialog.png", "PRD §1483/§1432"]);
      }
    } catch (e) {
      mark("F2-I-05", "failed", [], (e as Error).message);
    }

    // ========== F2-I-06 单层暂停 ==========
    try {
      await dismissDialogs(page);
      const pauseBtn = page.locator("button").filter({ hasText: /单层暂停管理|单层暂停|暂停管理/ }).first();
      await expect(pauseBtn).toBeVisible({ timeout: 5_000 });
      await pauseBtn.click();
      const dlg = page.locator('[role="dialog"]:visible').last();
      await expect(dlg).toBeVisible({ timeout: 8_000 });
      await shot(page, "06-01-pause-dialog");
      const dlgText = await dlg.innerText();
      const hasWarn = /停止计提|不自动补结|停止|补结|应得分润/i.test(dlgText);
      // 找 L5 行的暂停开关
      const l5Row = dlg.locator(".casc-row, .layer-row, tr, li").filter({ hasText: /L5/ }).first();
      let pauseToggle;
      if (await l5Row.isVisible({ timeout: 3_000 }).catch(() => false)) {
        pauseToggle = l5Row.locator("button, [role='switch'], input[type='checkbox']").first();
      }
      let pauseSubmitted = false;
      let l5PausedAfter = false;
      if (pauseToggle && await pauseToggle.isVisible({ timeout: 2_000 }).catch(() => false)) {
        // 理由
        const ta = dlg.locator("textarea:visible").first();
        if (await ta.isVisible({ timeout: 1_500 }).catch(() => false)) {
          await ta.fill(`${REASON_PREFIX}-I06-pause-L5-probe`);
        }
        await pauseToggle.click();
        // 等可能出现的二级确认
        const innerDlg = page.locator('[role="dialog"]:visible').last();
        const confirmBtn = innerDlg.locator("button").filter({ hasText: /确认|执行|暂停|保存/ }).first();
        if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          const innerTa = innerDlg.locator("textarea:visible").first();
          if (await innerTa.isVisible({ timeout: 1_000 }).catch(() => false)) {
            await innerTa.fill(`${REASON_PREFIX}-I06-pause-L5-confirm`).catch(() => undefined);
          }
          await confirmBtn.click().catch(() => undefined);
          await page.waitForTimeout(2000);
        }
        await page.waitForTimeout(2000);
        pauseSubmitted = true;
        // 回读
        const ratesAfter = await getRatesSnapshot(page);
        const l5 = (ratesAfter.unilevelRates ?? []).find((r: any) => r.level === "L5") ?? {};
        l5PausedAfter = !!l5.paused;
        await shot(page, "06-02-pause-submitted");
        // 恢复
        // 重新打开弹窗恢复 L5
        await dismissDialogs(page);
        const pauseBtn2 = page.locator("button").filter({ hasText: /单层暂停管理|单层暂停|暂停管理/ }).first();
        if (await pauseBtn2.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await pauseBtn2.click().catch(() => undefined);
          const dlg2 = page.locator('[role="dialog"]:visible').last();
          if (await dlg2.isVisible({ timeout: 5_000 }).catch(() => false)) {
            const l5Row2 = dlg2.locator(".casc-row, .layer-row, tr, li").filter({ hasText: /L5/ }).first();
            const t2 = l5Row2.locator("button, [role='switch'], input[type='checkbox']").first();
            if (await t2.isVisible({ timeout: 2_000 }).catch(() => false)) {
              await t2.click().catch(() => undefined);
              const c2 = dlg2.locator("button").filter({ hasText: /确认|执行|恢复|保存/ }).first();
              if (await c2.isVisible({ timeout: 2_000 }).catch(() => false)) {
                const ta2 = dlg2.locator("textarea:visible").first();
                if (await ta2.isVisible({ timeout: 1_000 }).catch(() => false)) {
                  await ta2.fill(`${REASON_PREFIX}-I06-resume-L5`);
                }
                await c2.click().catch(() => undefined);
                await page.waitForTimeout(2000);
              }
            }
            await dismissDialogs(page);
          }
        }
        result.cleanup.push(`L5 pause toggled (submitted=${pauseSubmitted}, after paused=${l5PausedAfter}); 恢复尝试完成`);
      }
      mark("F2-I-06", hasWarn ? "passed" : "warning",
        ["screenshots/06-01-pause-dialog.png", "screenshots/06-02-pause-submitted.png"],
        `hasWarn=${hasWarn}; pauseToggleVisible=${!!pauseToggle}; pauseSubmitted=${pauseSubmitted}; l5PausedAfter=${l5PausedAfter}`);
      if (!hasWarn) {
        addDefect("F2-D-PAUSE-NO-WARNING", "P1",
          "F2 单层暂停弹窗缺红色警示「该层用户应得分润将停止计提,恢复后不自动补结」",
          "F2 → 单层暂停管理 → 检查弹窗警示文案",
          "缺 PRD 原文要求的红色警示条",
          "PRD F2-MD4 §1498 强制「暂停方向红色警示条恒显」",
          ["screenshots/06-01-pause-dialog.png", "PRD §1498"]);
      }
    } catch (e) {
      mark("F2-I-06", "failed", [], (e as Error).message);
    }

    // ========== F2-I-07 cooling-days ==========
    try {
      await dismissDialogs(page);
      // 先看页面文案显示的当前 cooling
      const bodyText = await page.locator("body").innerText();
      const coolingMatch = bodyText.match(/F\.cooldown[\s\S]{0,200}?(\d{1,3})/);
      const currentCoolingText = coolingMatch ? coolingMatch[1] : "?";
      // 找 F.cooldown 行的调整按钮
      const allAdjustBtns = page.locator("button").filter({ hasText: /^调整$/ });
      const cnt = await allAdjustBtns.count();
      let clicked = false;
      for (let i = 0; i < cnt; i++) {
        const btn = allAdjustBtns.nth(i);
        const parentText = await btn.locator("xpath=ancestor::*[position()=1]").innerText().catch(() => "");
        if (/F\.cooldown|佣金冷却|冷却期/i.test(parentText)) {
          await btn.scrollIntoViewIfNeeded();
          await btn.click();
          clicked = true;
          break;
        }
      }
      let dialogOpened = false;
      let hasNotWithdrawWarning = false;
      let newCooling = 45;
      let coolingWriteOk = false;
      let coolingReloadOk = false;
      if (clicked) {
        const dlg = page.locator('[role="dialog"]:visible').last();
        dialogOpened = await dlg.isVisible({ timeout: 6_000 }).catch(() => false);
        if (dialogOpened) {
          await shot(page, "07-01-cooling-dialog");
          const dlgText = await dlg.innerText();
          hasNotWithdrawWarning = /withdrawCooldownDays|提现冷却|不同源|不同参数|勿混用|不要混用|不同于提现/i.test(dlgText);
          const numInput = dlg.locator("input[type='number']").first();
          if (await numInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
            await numInput.fill("45");
            const ta = dlg.locator("textarea:visible").first();
            await ta.fill(`${REASON_PREFIX}-I07-cooling-30-to-45`);
            await shot(page, "07-02-cooling-ready");
            const cb = dlg.locator("button").filter({ hasText: /确认|执行|保存|调冷却/ }).first();
            await cb.click();
            await expect(dlg).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
            await page.waitForTimeout(2000);
            await shot(page, "07-03-cooling-submitted");
            // 回读页面
            const bodyAfter = await page.locator("body").innerText();
            const matchAfter = bodyAfter.match(/F\.cooldown[\s\S]{0,200}?(\d{1,3})/);
            const afterVal = matchAfter ? matchAfter[1] : "?";
            coolingWriteOk = afterVal === "45";
            // 硬刷新
            await page.reload();
            await expect(page.getByRole("heading", { name: /网络版税费率/ })).toBeVisible({ timeout: 20_000 });
            await page.waitForTimeout(2000);
            const bodyReload = await page.locator("body").innerText();
            const matchReload = bodyReload.match(/F\.cooldown[\s\S]{0,200}?(\d{1,3})/);
            const reloadVal = matchReload ? matchReload[1] : "?";
            coolingReloadOk = reloadVal === "45";
            await shot(page, "07-04-cooling-reread");
          }
          await dismissDialogs(page);
        }
      }
      mark("F2-I-07", coolingWriteOk && coolingReloadOk ? "passed" : (dialogOpened ? "warning" : "failed"),
        ["screenshots/07-01-cooling-dialog.png", "screenshots/07-03-cooling-submitted.png", "screenshots/07-04-cooling-reread.png"],
        `currentCoolingText=${currentCoolingText}; clicked=${clicked}; dialogOpened=${dialogOpened}; hasNotWithdrawWarning=${hasNotWithdrawWarning}; newCooling=${newCooling}; writeOk=${coolingWriteOk}; reloadOk=${coolingReloadOk}`);
      if (dialogOpened && !hasNotWithdrawWarning) {
        addDefect("F2-D-COOLING-NO-WITHDRAW-DISTINCT-WARN", "P1",
          "F2 调冷却天数弹窗缺「与提现冷却 withdrawCooldownDays 不同源,勿混用」恒显提示条",
          "F2 → F.cooldown 「调整」→ 检查弹窗提示",
          "缺 PRD 原文要求的恒显提示",
          "PRD F2-MD5 §1511 强制「与提现冷却 withdrawCooldownDays 不同参数、不同源,勿混用提示条恒显」",
          ["screenshots/07-01-cooling-dialog.png", "PRD §1511"]);
      }
      // 恢复 cooling 原值（若 text 当前是 45，改回 30 或 31，按 PRD 默认 30d；但若原本是 31d, 改回 31d)
      const restoreVal = currentCoolingText === "?" ? "30" : currentCoolingText;
      if (coolingWriteOk) {
        await apiSend(page, "PATCH", "/api/admin/teams/commissions/config/F.cooldown", {
          value: String(restoreVal), reason: `${REASON_PREFIX}-I07-restore-cooling-to-${restoreVal}`, operator: "superadmin",
        }, "f2acc-restore-cooling");
        result.cleanup.push(`F.cooldown: ${currentCoolingText} -> 45 -> restored ${restoreVal}`);
      }
    } catch (e) {
      mark("F2-I-07", "failed", [], (e as Error).message);
    }

    // ========== F2-I-08 B1 红线拦截 ==========
    try {
      await dismissDialogs(page);
      // 顶栏覆盖率
      const bodyText = await page.locator("body").innerText();
      const coverageMatch = bodyText.match(/兑付覆盖率[\s\S]{0,30}?(\d+(?:\.\d+)?)\s*%/);
      const topCoverage = coverageMatch ? coverageMatch[1] : "?";
      // 后端 B-Domain 真实覆盖率
      const bDomain = await apiGet<any>(page, "/api/admin/treasury/b-domain");
      const bCoverageRaw = JSON.stringify(bDomain.data ?? {}).match(/coverageRatio[":\s]+([\d.]+)/i);
      const bCoverage = bCoverageRaw ? bCoverageRaw[1] : "?";
      // 尝试 L1 USDT% 10 -> 50 (放大流出向)
      const hugeRateResp = await apiSend(page, "PATCH", "/api/admin/teams/commissions/config/F.unilevel.usdt", {
        value: "50", reason: `${REASON_PREFIX}-I08-b1-probe-L1-10-to-50`, operator: "superadmin", scope: { level: "L1" },
      }, "f2acc-b1-probe");
      const b1Blocked = hugeRateResp.status === 422 || /COVERAGE_BELOW_REDLINE|覆盖率|红线/i.test(hugeRateResp.raw);
      await shot(page, "08-01-b1-probe-result");
      // 恢复（即使被拦截也明确归零风险）
      if (!b1Blocked) {
        // 写入成功 = 真改了, 必须恢复
        await apiSend(page, "PATCH", "/api/admin/teams/commissions/config/F.unilevel.usdt", {
          value: "10", reason: `${REASON_PREFIX}-I08-restore-L1-10`, operator: "superadmin", scope: { level: "L1" },
        }, "f2acc-b1-restore");
        result.cleanup.push(`L1.usdtPct: 10 -> 50 (B1 NOT enforced!) -> restored 10`);
      }
      mark("F2-I-08", b1Blocked ? "passed" : "failed",
        ["screenshots/08-01-b1-probe-result.png"],
        `topCoverage=${topCoverage}; bDomainCoverageRatio=${bCoverage}; probeStatus=${hugeRateResp.status}; b1Blocked=${b1Blocked}; raw=${hugeRateResp.raw.slice(0, 300)}`);
      if (!b1Blocked) {
        addDefect("F2-D-B1-NOT-ENFORCED", "P1",
          "F2 上调 L1 费率(10%→50%)未触发 B1 覆盖率红线预检",
          "PATCH /api/admin/teams/commissions/config/F.unilevel.usdt value=50 scope.level=L1",
          "后端接受写入,未返回 422 COVERAGE_BELOW_REDLINE",
          "PRD ④a §1432 + ⑤ §1525 强制「上调 UNILEVEL_USDT 前置 B1 覆盖率红线校验,低于红线返回 422 COVERAGE_BELOW_REDLINE 拒绝执行」",
          ["screenshots/08-01-b1-probe-result.png", "PRD §1432/§1525"]);
      }
      if (topCoverage === "0.0" || topCoverage === "0") {
        addDefect("F2-D-COVERAGE-ZERO", "P2",
          "F2 顶栏「兑付覆盖率 0.0%」疑似未联动后端",
          "F2 页面顶栏与 /api/admin/treasury/b-domain 比对",
          `顶栏显示 ${topCoverage}%,后端 coverageRatio=${bCoverage}`,
          "顶栏覆盖率应由 B1/B 域真实驱动,不应恒为 0",
          ["screenshots/01-01-f2-entry.png"]);
      }
    } catch (e) {
      mark("F2-I-08", "failed", [], (e as Error).message);
    }

    // ========== F2-I-09 权限三层 ==========
    try {
      await dismissDialogs(page);
      const menuVisible = await page.locator('a[href="/network/royalty"]').first().isVisible().catch(() => false);
      // superadmin 探针
      const probeResp = await apiSend(page, "PATCH", "/api/admin/teams/commissions/config/F.cooldown", {
        value: "30", reason: `${REASON_PREFIX}-I09-super-probe-30`, operator: "superadmin",
      }, "f2acc-super-probe");
      const probeStatus = probeResp.status;
      // 创建只读角色 + 临时账号
      const newRoleCode = `f2ro${RUN_ID.replace(/[^a-z0-9]/gi, "").toLowerCase()}`.slice(0, 28);
      const newAdminUser = `f2r${RUN_ID.replace(/[^a-z0-9]/gi, "").toLowerCase()}`.slice(0, 20);
      const newAdminPwd = "F2Reader@12345";
      const roleResp = await apiSend(page, "POST", "/api/admin/platform/roles", {
        code: newRoleCode, name: `F2 Reader ${RUN_ID}`, permissions: ["network_f2_read"], reason: `${REASON_PREFIX}-I09-role`, operator: "superadmin",
      });
      const roleOk = roleResp.status < 400;
      let adminCreateOk = false;
      let accountId: string | undefined;
      if (roleOk) {
        const adminResp = await apiSend(page, "POST", "/api/admin/platform/accounts", {
          username: newAdminUser, displayName: `F2 Reader ${RUN_ID}`, email: `${newAdminUser}@nexion.io`, role: newRoleCode, deliver: "handoff", initialPassword: newAdminPwd, reason: `${REASON_PREFIX}-I09-admin`, operator: "superadmin",
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
            const f2Link = readerPage.locator('a[href="/network/royalty"]').first();
            menuVisibleForReader = await f2Link.isVisible({ timeout: 5_000 }).catch(() => false);
            if (menuVisibleForReader) {
              await f2Link.click();
              await readerPage.waitForTimeout(3000);
              await shot(readerPage, "09-02-readonly-f2-page");
              const writeBtns = readerPage.locator("button:visible").filter({ hasText: /调整|暂停|设置倍率|配置|编辑/ });
              const cntB = await writeBtns.count();
              let visibleWritable = 0;
              for (let i = 0; i < cntB; i++) {
                const b = writeBtns.nth(i);
                if (await b.isVisible().catch(() => false) && await b.isEnabled().catch(() => false)) visibleWritable++;
              }
              buttonHiddenForReader = visibleWritable === 0;
            }
            // 绕过页面直调写入
            const readonlyResp = await readerPage.evaluate(async () => {
              const r = await fetch("/api/admin/teams/commissions/config/F.cooldown", {
                method: "PATCH",
                headers: { "Content-Type": "application/json", "Idempotency-Key": `f2acc-ro-${Date.now()}` },
                body: JSON.stringify({ value: "33", reason: "F2ACC readonly probe", operator: "reader" }),
                credentials: "include",
              });
              return { status: r.status, body: await r.text() };
            });
            readonlyWriteBlocked = readonlyResp.status >= 400;
            await shot(readerPage, "09-03-readonly-direct-api-attempt");
            if (!readonlyWriteBlocked) {
              // 恢复
              await apiSend(page, "PATCH", "/api/admin/teams/commissions/config/F.cooldown", { value: "30", reason: `${REASON_PREFIX}-I09-rollback`, operator: "superadmin" });
              result.cleanup.push(`F.cooldown rolled back after readonly leak`);
              addDefect("F2-D-PERMISSION-LEAK", "P0",
                "只读角色绕过页面直调 F2 写入接口未被 403 拦截",
                "创建只读角色(仅 network_f2_read)+临时管理员 → 登录 → 用只读 cookie 直调 PATCH /api/admin/teams/commissions/config/F.cooldown",
                "接口接受写入(状态 < 400),数据库被修改",
                "PRD §1531-1541 权限矩阵要求编辑费率/冷却仅超管/增长 lead;后端 @PreAuthorize 应拒绝只读角色",
                ["screenshots/09-03-readonly-direct-api-attempt.png"]);
            }
          }
        } finally {
          await readerCtx.close();
        }
      }
      mark("F2-I-09", probeStatus < 400 && readonlyWriteBlocked ? "passed" : (adminCreateOk ? "failed" : "warning"),
        ["screenshots/09-02-readonly-f2-page.png", "screenshots/09-03-readonly-direct-api-attempt.png"],
        `menuVisible=${menuVisible}; probeStatus=${probeStatus}; roleOk=${roleOk}; adminCreateOk=${adminCreateOk}; menuVisibleForReader=${menuVisibleForReader}; buttonHiddenForReader=${buttonHiddenForReader}; readonlyWriteBlocked=${readonlyWriteBlocked}; roleErr=${roleResp.raw.slice(0, 200)}`);
      if (accountId) {
        const disableResp = await apiSend(page, "PATCH", `/api/admin/platform/accounts/${accountId}/status`, { status: "disabled", reason: `${REASON_PREFIX}-I09-cleanup`, operator: "superadmin" });
        result.cleanup.push(`temp admin ${newAdminUser} disabled (status=${disableResp.status})`);
      }
      if (roleOk) {
        const roleDelResp = await apiSend(page, "DELETE", `/api/admin/platform/roles/${newRoleCode}`, { reason: `${REASON_PREFIX}-I09-cleanup`, operator: "superadmin" });
        result.cleanup.push(`temp role ${newRoleCode} delete attempted (status=${roleDelResp.status})`);
      }
    } catch (e) {
      mark("F2-I-09", "failed", [], (e as Error).message);
    }

    // ========== F2-I-10 异常出口 ==========
    try {
      await dismissDialogs(page);
      // 1. 空理由（通过弹窗或接口测试）
      const emptyReasonResp = await page.evaluate(async () => {
        const r = await fetch("/api/admin/teams/commissions/config/F.cooldown", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "Idempotency-Key": `f2acc-empty-${Date.now()}` },
          body: JSON.stringify({ value: "33", reason: "", operator: "superadmin" }),
          credentials: "include",
        });
        return { status: r.status, body: await r.text() };
      });
      const emptyReasonBlocked = emptyReasonResp.status >= 400;
      // 2. 越界 cooling = -1
      const invalidCoolingResp = await page.evaluate(async () => {
        const r = await fetch("/api/admin/teams/commissions/config/F.cooldown", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "Idempotency-Key": `f2acc-inv-cool-${Date.now()}` },
          body: JSON.stringify({ value: "-1", reason: "F2ACC invalid cooling probe - needs at least 8 chars", operator: "superadmin" }),
          credentials: "include",
        });
        return { status: r.status, body: await r.text() };
      });
      const invalidCoolingBlocked = invalidCoolingResp.status >= 400;
      // 3. 越界 USDT% = 200
      const invalidUsdtResp = await page.evaluate(async () => {
        const r = await fetch("/api/admin/teams/commissions/config/F.unilevel.usdt", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "Idempotency-Key": `f2acc-inv-usdt-${Date.now()}` },
          body: JSON.stringify({ value: "200", reason: "F2ACC invalid usdt probe - needs at least 8 chars", operator: "superadmin", scope: { level: "L4" } }),
          credentials: "include",
        });
        return { status: r.status, body: await r.text() };
      });
      const invalidUsdtBlocked = invalidUsdtResp.status >= 400;
      await shot(page, "10-01-exception-probes");
      // 检查错误码是否中文
      const allBodies = `${emptyReasonResp.body} ${invalidCoolingResp.body} ${invalidUsdtResp.body}`;
      const hasChineseError = /理由|范围|越界|不能|无效|必须|不在|失败|错误/i.test(allBodies);
      const hasRawSqlOrStack = /SQLException|SQLSyntax|NullPointerException|stacktrace|at java\./i.test(allBodies);
      mark("F2-I-10", emptyReasonBlocked && invalidCoolingBlocked && invalidUsdtBlocked ? "passed" : "warning",
        ["screenshots/10-01-exception-probes.png"],
        `emptyReasonBlocked=${emptyReasonBlocked} (${emptyReasonResp.status}); invalidCoolingBlocked=${invalidCoolingBlocked} (${invalidCoolingResp.status}); invalidUsdtBlocked=${invalidUsdtBlocked} (${invalidUsdtResp.status}); hasChineseError=${hasChineseError}; hasRawSqlOrStack=${hasRawSqlOrStack}; bodies=${allBodies.slice(0, 600)}`);
      if (hasRawSqlOrStack) {
        addDefect("F2-D-EXCEPTION-RAW-STACK", "P1",
          "F2 异常请求返回 raw SQL/stacktrace 而非中文错误",
          "PATCH /api/admin/teams/commissions/config/F.cooldown value=-1 等越界请求",
          "响应体含 SQLException/NullPointerException 等",
          "PRD §六「错误码必须翻译为业务语言」;验收方法 §六",
          ["screenshots/10-01-exception-probes.png"]);
      }
    } catch (e) {
      mark("F2-I-10", "failed", [], (e as Error).message);
    }

    // ========== F2-I-11 连续性 ==========
    try {
      await dismissDialogs(page);
      const ratesBefore = await getRatesSnapshot(page);
      const l1Before = (ratesBefore.unilevelRates ?? []).find((r: any) => r.level === "L1") ?? {};
      await page.reload();
      await expect(page.getByRole("heading", { name: /网络版税费率/ })).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(2000);
      const ratesAfterReload = await getRatesSnapshot(page);
      const l1AfterReload = (ratesAfterReload.unilevelRates ?? []).find((r: any) => r.level === "L1") ?? {};
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
      await openF2(page);
      const ratesAfterRelogin = await getRatesSnapshot(page);
      const l1AfterRelogin = (ratesAfterRelogin.unilevelRates ?? []).find((r: any) => r.level === "L1") ?? {};
      await shot(page, "11-04-after-relogin");
      const persistOk = String(l1Before.usdtPct ?? "") === String(l1AfterReload.usdtPct ?? "")
                        && String(l1AfterReload.usdtPct ?? "") === String(l1AfterRelogin.usdtPct ?? "");
      mark("F2-I-11", persistOk ? "passed" : "failed",
        ["screenshots/11-01-after-hard-reload.png", "screenshots/11-04-after-relogin.png"],
        `l1Before=${l1Before.usdtPct}; l1AfterReload=${l1AfterReload.usdtPct}; l1AfterRelogin=${l1AfterRelogin.usdtPct}; urlAfterForward=${urlAfter}`);
    } catch (e) {
      mark("F2-I-11", "failed", [], (e as Error).message);
    }

    // ========== F2-I-12 文案核查 ==========
    try {
      await dismissDialogs(page);
      const bodyText = await page.locator("body").innerText();
      // L1/L2 编号在运营后台 F2 允许暴露（PRD 仅要求用户侧 /team/unilevel 不暴露）
      const hasLayerNumbers = /\bL[1-7]\b/.test(bodyText);
      const hasUserFacingDirect = /直推\s*DIRECT|DIRECT.*直推/.test(bodyText);
      const hasUserFacingExtended = /扩展\s*EXTENDED|EXTENDED.*扩展/.test(bodyText);
      // 顶栏覆盖率
      const coverageMatch = bodyText.match(/兑付覆盖率[\s\S]{0,30}?(\d+(?:\.\d+)?)\s*%/);
      const topCoverage = coverageMatch ? coverageMatch[1] : "?";
      const bDomain = await apiGet<any>(page, "/api/admin/treasury/b-domain");
      const bCoverageRaw = JSON.stringify(bDomain.data ?? {}).match(/coverageRatio[":\s]+([\d.]+)/i);
      const bCoverage = bCoverageRaw ? bCoverageRaw[1] : "?";
      // 检查英文错误码暴露
      const hasRawErrorCode = /COVERAGE_BELOW_REDLINE|REASON_REQUIRED|SQLSTATE|ExceptionHandler/.test(bodyText);
      await shot(page, "12-01-text-audit");
      mark("F2-I-12", hasUserFacingDirect && hasUserFacingExtended ? "passed" : "warning",
        ["screenshots/12-01-text-audit.png"],
        `hasLayerNumbers(后台OK)=${hasLayerNumbers}; hasUserFacingDirect=${hasUserFacingDirect}; hasUserFacingExtended=${hasUserFacingExtended}; topCoverage=${topCoverage}; bCoverage=${bCoverage}; hasRawErrorCode=${hasRawErrorCode}`);
      if (topCoverage !== "?" && bCoverage !== "?" && topCoverage !== bCoverage) {
        addDefect("F2-D-COVERAGE-MISMATCH", "P2",
          "F2 顶栏覆盖率与后端 B 域 coverageRatio 不一致",
          "F2 页面顶栏 vs /api/admin/treasury/b-domain",
          `顶栏=${topCoverage}%, 后端 coverageRatio=${bCoverage}%`,
          "PRD §1.8 + B1 兑付覆盖率权威归 B 域,F2 仅作展示投影,数值应一致",
          ["screenshots/12-01-text-audit.png"]);
      }
    } catch (e) {
      mark("F2-I-12", "failed", [], (e as Error).message);
    }

    // ========== F2-I-13 未接入参数拒绝 + 快照不变 ==========
    try {
      await dismissDialogs(page);
      const before = await getCommissionsSnapshot(page);
      const probeResp = await apiSend(page, "PATCH", "/api/admin/teams/commissions/config/F.royalty.minPayout", {
        value: "1", reason: `${REASON_PREFIX}-I13-reject-unconsumed-min-payout`, operator: "superadmin",
      }, "f2acc-audit-probe");
      const after = await getCommissionsSnapshot(page);
      const rejected = probeResp.status === 409 && /F2_PARAMETER_NOT_CONSUMED/.test(probeResp.raw);
      const snapshotUnchanged = sameCommissionSnapshot(before, after);
      await shot(page, "13-01-audit-page");
      mark("F2-I-13", rejected && snapshotUnchanged ? "passed" : "failed",
        ["screenshots/13-01-audit-page.png"],
        `probeStatus=${probeResp.status}; rejected=${rejected}; snapshotUnchanged=${snapshotUnchanged}; body=${probeResp.raw.slice(0, 300)}`);
    } catch (e) {
      mark("F2-I-13", "failed", [], (e as Error).message);
    }

    // ========== F2-I-14 同幂等键重复拒绝 + 快照不变 ==========
    try {
      await dismissDialogs(page);
      const before = await getCommissionsSnapshot(page);
      const idemKey = `f2acc-idem-replay-${Date.now()}`;
      const request = {
        value: "0.5",
        reason: "F2ACC-I14 repeated rejected unconsumed parameter",
        operator: "superadmin",
      };
      // 同一命令以同一 Idempotency-Key 重放，两次都必须被拒绝，且不能留下配置写入。
      const r1 = await page.evaluate(async ({ k, request }) => {
        const r = await fetch("/api/admin/teams/commissions/config/F.peer.rate", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "Idempotency-Key": k },
          body: JSON.stringify(request),
          credentials: "include",
        });
        return { status: r.status, body: await r.text() };
      }, { k: idemKey, request });
      const r2 = await page.evaluate(async ({ k, request }) => {
        const r = await fetch("/api/admin/teams/commissions/config/F.peer.rate", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "Idempotency-Key": k },
          body: JSON.stringify(request),
          credentials: "include",
        });
        return { status: r.status, body: await r.text() };
      }, { k: idemKey, request });
      const after = await getCommissionsSnapshot(page);
      const bothRejected = [r1, r2].every((response) =>
        response.status === 409 && /F2_PARAMETER_NOT_CONSUMED/.test(response.body));
      const snapshotUnchanged = sameCommissionSnapshot(before, after);
      await shot(page, "14-01-idempotency-result");
      mark("F2-I-14", bothRejected && snapshotUnchanged ? "passed" : "failed",
        ["screenshots/14-01-idempotency-result.png"],
        `r1Status=${r1.status}; r2Status=${r2.status}; bothRejected=${bothRejected}; snapshotUnchanged=${snapshotUnchanged}; r1Body=${r1.body.slice(0, 200)}; r2Body=${r2.body.slice(0, 200)}`);
    } catch (e) {
      mark("F2-I-14", "failed", [], (e as Error).message);
    }

    // ========== F2-I-15 写后重读 + toast 误导 ==========
    try {
      await dismissDialogs(page);
      // 监听 GET /api/admin/teams/rates 是否在写后重新触发
      let ratesGetCount = 0;
      page.on("response", (r) => {
        if (/\/api\/admin\/teams\/rates/.test(r.url()) && r.request().method() === "GET") ratesGetCount++;
      });
      // 找 InfluenceScore clampMin 调整按钮（低风险写）
      const allAdjustBtns = page.locator("button").filter({ hasText: /^调整$/ });
      const cnt = await allAdjustBtns.count();
      let clicked = false;
      for (let i = 0; i < cnt; i++) {
        const btn = allAdjustBtns.nth(i);
        const parentText = await btn.locator("xpath=ancestor::*[position()=1]").innerText().catch(() => "");
        if (/F\.influence\.clampMin|影响分下限|clampMin/i.test(parentText)) {
          await btn.scrollIntoViewIfNeeded();
          await btn.click();
          clicked = true;
          break;
        }
      }
      let dialogOpened = false;
      let toastText = "";
      let rerereadTriggered = false;
      if (clicked) {
        const dlg = page.locator('[role="dialog"]:visible').last();
        dialogOpened = await dlg.isVisible({ timeout: 6_000 }).catch(() => false);
        if (dialogOpened) {
          const beforeGetCount = ratesGetCount;
          const numInput = dlg.locator("input[type='number']").first();
          if (await numInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
            const cur = await numInput.inputValue().catch(() => "1");
            const newVal = String(Number(cur || 1) + 0.1);
            await numInput.fill(newVal);
            const ta = dlg.locator("textarea:visible").first();
            await ta.fill(`${REASON_PREFIX}-I15-reread-probe-clampMin-${cur}-to-${newVal}`);
            await shot(page, "15-01-reread-ready");
            const cb = dlg.locator("button").filter({ hasText: /确认|执行|保存/ }).first();
            await cb.click();
            await expect(dlg).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
            await page.waitForTimeout(3000);
            toastText = await page.locator('.toast, [role="status"], [role="alert"]').last().innerText().catch(() => "");
            rerereadTriggered = ratesGetCount > beforeGetCount;
            await shot(page, "15-02-reread-after");
            // 恢复
            const restoreResp = await apiSend(page, "PATCH", "/api/admin/teams/commissions/config/F.influence.clampMin", {
              value: cur, reason: `${REASON_PREFIX}-I15-restore-clampMin`, operator: "superadmin",
            }, "f2acc-clampmin-restore");
            result.cleanup.push(`F.influence.clampMin: ${cur} -> ${newVal} -> restored ${cur} (status=${restoreResp.status})`);
          }
          await dismissDialogs(page);
        }
      }
      const toastMisleading = /已生效|已确认生效|已应用|completed/i.test(toastText) && !rerereadTriggered;
      mark("F2-I-15", clicked && dialogOpened && !toastMisleading ? "passed" : "warning",
        ["screenshots/15-01-reread-ready.png", "screenshots/15-02-reread-after.png"],
        `clicked=${clicked}; dialogOpened=${dialogOpened}; rerereadTriggered=${rerereadTriggered}; toast="${toastText.slice(0, 200)}"; toastMisleading=${toastMisleading}`);
      if (toastMisleading) {
        addDefect("F2-D-TOAST-MISLEADING", "P2",
          "F2 写后 toast 显示「已生效」但页面未重读 GET /api/admin/teams/rates",
          "F2 → clampMin 「调整」→ 提交 → 监听 network",
          "toast 显示成功,但 rates 接口未被重新调用,前端可能仅修改 store",
          "PRD ⑤ §1524 server-canonical;验收方法 §七「请求成功但数据库没有变化 / 数据库变化但列表没有刷新」",
          ["screenshots/15-02-reread-after.png"]);
      }
    } catch (e) {
      mark("F2-I-15", "failed", [], (e as Error).message);
    }

    await shot(page, "99-final-full-page");
    result.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(EVIDENCE_DIR, "raw-result.json"), JSON.stringify(result, null, 2), "utf8");
  });
});
