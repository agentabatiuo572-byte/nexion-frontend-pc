import { createDecipheriv, createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.NEXION_PC_BASE_URL?.trim() || "http://127.0.0.1:3002";
const evidencePath = resolve(required("NEXION_TEAM_PC_EVIDENCE"));
const adminUsername = process.env.NEXION_PC_ADMIN_USERNAME?.trim() || "superadmin";
const adminPassword = required("NEXION_PC_ADMIN_PASSWORD");
const mysqlPassword = required("NEXION_MYSQL_PASSWORD");
const mfaKey = required("NEXION_ADMIN_MFA_ENCRYPTION_KEY");
const mysql = process.env.NEXION_MYSQL_BIN?.trim()
  || "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const database = process.env.NEXION_MYSQL_DATABASE?.trim() || "nexion";

const routes = [
  { id: "F1", path: "/network/v-rank", expected: "V-Rank 13 阶阶梯" },
  { id: "F2", path: "/network/royalty", expected: "L1–L7 网络版税费率" },
  { id: "F3", path: "/network/binary", expected: "平衡匹配公式" },
  { id: "F4", path: "/network/leadership-pool", expected: "领导池" },
  { id: "F5", path: "/network/commissions", expected: "F5 佣金事件审计" },
];

mkdirSync(dirname(evidencePath), { recursive: true });
const encryptedSecret = execFileSync(mysql, [
  "-N", "-B", "-uroot", database, "-e",
  `SELECT s.tfa_secret_encrypted FROM nx_admin_account_state s JOIN nx_admin a ON a.id=s.admin_id WHERE a.username='${sqlLiteral(adminUsername)}' AND s.is_deleted=0 LIMIT 1`,
], {
  encoding: "utf8",
  windowsHide: true,
  env: { ...process.env, MYSQL_PWD: mysqlPassword },
}).trim();
if (!encryptedSecret) throw new Error("superadmin encrypted TOTP binding was not found");
const totpSecret = decryptTotp(encryptedSecret, mfaKey);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const pageErrors = [];
const consoleErrors = [];
const apiErrors = [];
let authenticated = false;

page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => {
  if (authenticated && message.type() === "error") consoleErrors.push(message.text());
});
page.on("response", async (response) => {
  const url = new URL(response.url());
  if (authenticated && url.pathname.startsWith("/api/admin/") && response.status() >= 400) {
    apiErrors.push({ method: response.request().method(), path: url.pathname, status: response.status() });
  }
});

const routeResults = [];
try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(adminUsername);
  await page.locator('input[autocomplete="current-password"]').fill(adminPassword);
  const loginPending = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const loginResponse = await loginPending;
  assert(loginResponse.status() === 200, `password login returned ${loginResponse.status()}`);

  const otp = page.getByLabel("一次性验证码");
  await otp.waitFor({ state: "visible", timeout: 15_000 });
  const mfaPending = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
  await otp.fill(await freshTotp(totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  const mfaResponse = await mfaPending;
  assert(mfaResponse.status() === 200, `MFA verify returned ${mfaResponse.status()}`);
  await page.locator("aside").waitFor({ state: "visible", timeout: 20_000 });
  authenticated = true;

  const fGroup = page.locator("aside").getByRole("button", { name: /分销与团队.*F|F.*分销与团队/ }).first();
  await fGroup.waitFor({ state: "visible", timeout: 10_000 });
  if (await fGroup.getAttribute("aria-expanded") !== "true") await fGroup.click();

  for (const route of routes) {
    const link = page.locator(`aside a[href="${route.path}"]`).first();
    await link.waitFor({ state: "visible", timeout: 10_000 });
    await link.click();
    await page.waitForURL((url) => url.pathname === route.path, { timeout: 15_000 });
    await page.getByText(route.expected, { exact: false }).first().waitFor({ state: "visible", timeout: 20_000 });
    await page.waitForTimeout(600);
    const body = await page.locator("body").innerText();
    assert(!/数据加载失败|This page couldn.t load|Internal Server Error/.test(body), `${route.id} displayed a load failure`);
    if (route.id === "F2") {
      for (const rate of ["10%", "5%", "3%", "2%", "1%", "0.5%"]) {
        assert(body.includes(rate), `F2 missing configured rate ${rate}`);
      }
    }
    if (route.id === "F3") {
      assert(body.includes("13%"), "F3 missing 13% match rate");
      assert(body.includes("双轨日封顶"), "F3 missing the authoritative H1 cap card");
    }
    if (route.id === "F4") {
      assert(/未配置|__UNCONFIGURED__/.test(body), "F4 did not expose the unconfigured pool ratio");
    }
    if (route.id === "F5") {
      await page.screenshot({ path: evidencePath.replace(/\.json$/i, "-f5.png"), fullPage: true });
    }
    routeResults.push({
      id: route.id,
      path: route.path,
      expected: route.expected,
      status: "PASS",
      assertions: route.id === "F3"
        ? ["13% match rate", "authoritative H1 cap card"]
        : route.id === "F4"
          ? ["pool ratio visibly unconfigured"]
          : [],
    });
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("aside").waitFor({ state: "visible", timeout: 20_000 });
  await page.getByText("F5 佣金事件审计", { exact: false }).first().waitFor({ state: "visible", timeout: 20_000 });
  await page.getByText("F5 佣金事件审计加载中", { exact: false }).waitFor({ state: "hidden", timeout: 20_000 });
  const postRefreshF5Body = await page.locator("body").innerText();
  assert(
    /当前筛选无佣金事件|佣金 ID/.test(postRefreshF5Body),
    "F5 did not finish its server data readback after refresh",
  );
  await page.screenshot({ path: evidencePath.replace(/\.json$/i, "-final.png"), fullPage: true });

  assert(pageErrors.length === 0, `page errors: ${pageErrors.join(" | ")}`);
  assert(apiErrors.length === 0, `authenticated admin API errors: ${JSON.stringify(apiErrors)}`);
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join(" | ")}`);

  writeFileSync(evidencePath, JSON.stringify({
    runId: "TEAM-20260829",
    status: "PASS",
    baseUrl,
    authentication: "password+TOTP",
    routes: routeResults,
    refreshSessionRecovery: true,
    postRefreshF5DataReadback: true,
    leadershipPoolRatio: "__UNCONFIGURED__",
    pageErrors,
    consoleErrors,
    apiErrors,
    finishedAt: new Date().toISOString(),
  }, null, 2));
  process.stdout.write(`PC F1-F5 PASS — ${routeResults.length} routes; MFA; refresh\n`);
} catch (error) {
  writeFileSync(evidencePath, JSON.stringify({
    runId: "TEAM-20260829",
    status: "FAIL",
    error: error instanceof Error ? error.message : String(error),
    routes: routeResults,
    pageErrors,
    consoleErrors,
    apiErrors,
    finishedAt: new Date().toISOString(),
  }, null, 2));
  throw error;
} finally {
  totpSecret.fill?.(0);
  await context.close();
  await browser.close();
}

function decryptTotp(encoded, keyText) {
  const raw = Buffer.from(encoded, "base64url");
  const key = createHash("sha256").update(keyText.trim(), "utf8").digest();
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(12, -16)), decipher.final()]).toString("utf8");
}

async function freshTotp(secret) {
  const remainingMs = 30_000 - (Date.now() % 30_000);
  if (remainingMs < 4_000) await new Promise((resolveWait) => setTimeout(resolveWait, remainingMs + 500));
  return currentTotp(secret);
}

function currentTotp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of normalized) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

function sqlLiteral(value) {
  return value.replaceAll("'", "''");
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
