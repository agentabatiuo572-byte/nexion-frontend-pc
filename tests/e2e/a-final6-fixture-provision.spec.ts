import { createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const runId = "pc-full-acceptance-20260729-114336";
const token = process.env.A_FIXTURE_REPAIR_TOKEN?.trim() ?? "";
const evidenceDir = "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/final6-owner/fixture";
const manifestPath = `${evidenceDir}/final6-a002-manifest.json`;
const db = "nexion_acceptance_20260729_114336";
const d5 = "d5_V3_i_super";
const password = required("A_FINAL6_FIXTURE_OPERATOR_PASSWORD");
const dbPassword = required("A_FINAL6_FIXTURE_DB_PASSWORD");
const reason = `${runId} Final6 A-only temporary CAS fixture`;
const lastTotpStepByActor = new Map<string, number>();

function required(name: "A_FINAL6_FIXTURE_OPERATOR_PASSWORD" | "A_FINAL6_FIXTURE_DB_PASSWORD") {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`${name}_REQUIRED`);
  return value;
}

test("Final6 fixture carrier accepts only MFA-not-bound as an already-cleared reset terminal state", () => {
  expect(isMfaAlreadyCleared(409, '{"code":409,"message":"ADMIN_MFA_NOT_BOUND","data":null}')).toBe(true);
  expect(isMfaAlreadyCleared(409, '{"code":409,"message":"ADMIN_ACCOUNT_VERSION_CONFLICT","data":null}')).toBe(false);
  expect(isMfaAlreadyCleared(500, '{"code":500,"message":"ADMIN_MFA_NOT_BOUND","data":null}')).toBe(false);
});

function isMfaAlreadyCleared(status: number, raw: string) {
  if (status !== 409) return false;
  try {
    const body = JSON.parse(raw) as { code?: number; message?: string };
    return body.code === 409 && body.message === "ADMIN_MFA_NOT_BOUND";
  } catch {
    return false;
  }
}

async function clearAuthForActorSwitch(page: Page) {
  const logout = await page.request.post("/api/admin/auth/logout");
  expect(logout.status(), "actor switch logout must succeed").toBeLessThan(400);
  await page.context().clearCookies();
  await page.goto("http://127.0.0.1:3002", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  expect((await page.request.get("/api/admin/auth/session")).status(), "old actor session must be cleared").toBe(401);
}

function totp(secret: string) { const a="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; const s=secret.replace(/[^A-Z2-7]/gi,"").toUpperCase(); let b=""; for(const c of s)b+=a.indexOf(c).toString(2).padStart(5,"0"); const n=Buffer.alloc(8); n.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000))); const d=createHmac("sha1",Buffer.from(Array.from({length:Math.floor(b.length/8)},(_,i)=>parseInt(b.slice(i*8,i*8+8),2)))).update(n).digest(); const o=d[d.length-1]&15; return String((d.readUInt32BE(o)&0x7fffffff)%1e6).padStart(6,"0"); }
function d5Secret() { const key=process.env.NEXION_ADMIN_MFA_ENCRYPTION_KEY?.trim(); if(!key) throw new Error("NEXION_ADMIN_MFA_ENCRYPTION_KEY_REQUIRED"); const mysql=process.env.NEXION_MYSQL_BIN??"D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe"; const encoded=execFileSync(mysql,["-N","-B","-uroot",db,"-e",`SELECT s.tfa_secret_encrypted FROM nx_admin_account_state s JOIN nx_admin a ON a.id=s.admin_id WHERE a.username='${d5}' AND s.is_deleted=0 LIMIT 1`],{encoding:"utf8",windowsHide:true,env:{...process.env,MYSQL_PWD:dbPassword}}).trim(); const raw=Buffer.from(encoded,"base64url"); const decipher=createDecipheriv("aes-256-gcm",createHash("sha256").update(key,"utf8").digest(),raw.subarray(0,12)); decipher.setAuthTag(raw.subarray(raw.length-16)); return Buffer.concat([decipher.update(raw.subarray(12,-16)),decipher.final()]).toString("utf8"); }
async function login(page: Page, username: string, secret: string) {
  await clearAuthForActorSwitch(page);
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/admin/auth/login" && r.request().method() === "POST");
  await page.getByRole("button", { name: /继续|登录/ }).click();
  expect((await response).status()).toBe(200);
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const step = Math.floor(Date.now() / 30_000);
    const remaining = 30_000 - Date.now() % 30_000;
    if (step <= (lastTotpStepByActor.get(username) ?? -1) || remaining < 3_000) {
      await page.waitForTimeout(remaining + 500);
    }
    lastTotpStepByActor.set(username, Math.floor(Date.now() / 30_000));
    await otp.fill(totp(secret));
    const verified = page.waitForResponse(r => new URL(r.url()).pathname === "/api/admin/auth/mfa/verify" && r.request().method() === "POST");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const verification = await verified;
    if (verification.status() === 200) {
      await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
      return;
    }
    expect([401, 409], `MFA login ${username} may only retry an expired or replayed one-time code`).toContain(verification.status());
    await page.waitForTimeout(30_500 - Date.now() % 30_000);
  }
  throw new Error(`MFA_LOGIN_FAILED:${username}`);
}
async function nav(page:Page,name:string,url:RegExp){const link=page.locator("aside").getByRole("link",{name,exact:true});if(!await link.isVisible().catch(()=>false))await page.locator("aside").getByRole("button",{name:/平台基础.*A|A.*平台基础/}).click();await link.click();await expect(page).toHaveURL(url);}
async function create(page:Page,username:string,label:string){await nav(page,"运营账号 & RBAC A1",/\/platform\/rbac$/);await expect(page.getByRole("button",{name:"+ 新建账号",exact:true})).toBeVisible();await page.getByRole("button",{name:"+ 新建账号",exact:true}).click();const modal=page.getByRole("dialog").last();await modal.getByRole("textbox",{name:"登录名 *",exact:true}).fill(username);await modal.getByPlaceholder("姓名,如:张三").fill(label);await modal.getByText("超级管理员",{exact:true}).click();await modal.getByLabel(/操作理由/).fill(reason);const response=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname==="/api/admin/platform/accounts");await modal.getByRole("button",{name:"确认创建账号",exact:true}).click();const confirm=page.getByRole("dialog").last();await confirm.getByLabel(/操作理由/).fill(reason);await confirm.getByRole("button",{name:"确认提交",exact:true}).click();const raw=await (await response).text();const body=JSON.parse(raw) as {code?:number;data?:{id?:string|number}};expect(body.code,raw).toBe(0);const drawer=page.getByRole("dialog").last();await expect(drawer.getByText("临时密码",{exact:true})).toBeVisible();const temporary=(await drawer.locator(".mono").last().textContent())?.trim()??"";expect(temporary).not.toBe("");await drawer.getByText("关闭",{exact:true}).click();return {id:String(body.data?.id??""),temporary};}
async function activate(page:Page,username:string,temporary:string){const finalPassword=`Nx!Final6${randomBytes(18).toString("base64url")}Aa`;await clearAuthForActorSwitch(page);await expect(page.locator('input[autocomplete="username"]')).toBeVisible();await page.locator('input[autocomplete="username"]').fill(username);await page.locator('input[autocomplete="current-password"]').fill(temporary);await page.getByRole("button",{name:/继续|登录/}).click();const otp=page.getByLabel("一次性验证码");await expect(otp).toBeVisible();const secret=((await page.locator("code").first().textContent())??"").trim();expect(secret).not.toBe("");await otp.fill(totp(secret));await page.getByRole("button",{name:"验证并进入",exact:true}).click();const change=page.getByRole("heading",{name:"首次登录修改密码"});await expect(change).toBeVisible();await page.getByLabel("新密码",{exact:true}).fill(finalPassword);await page.getByLabel("确认新密码",{exact:true}).fill(finalPassword);await page.getByRole("button",{name:"确认修改并进入",exact:true}).click();await expect(page.locator("aside")).toBeVisible({timeout:30000});return {username,password:finalPassword,totpSecret:secret};}
async function exactPartial(page:Page){const raw=await (await page.request.get("/api/admin/platform/accounts/overview")).text();const items=(JSON.parse(raw) as {data?:{operators?:Array<{id:string|number;username:string;version:string;role:string;status:string}>}}).data?.operators??[];const matches=items.filter(a=>a.username.startsWith("ffix.a.final6.m."));expect(matches).toHaveLength(1);return matches[0]!;}
async function disableUi(page:Page,username:string){await nav(page,"运营账号 & RBAC A1",/\/platform\/rbac$/);await page.locator("select.pager-size").selectOption("50");const row=page.locator("tbody tr").filter({hasText:username});await expect(row).toBeVisible();await row.getByRole("button",{name:"禁用",exact:true}).click();const response=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname==="/api/admin/platform/audit/operations");const dialog=page.getByRole("dialog").last();await dialog.getByLabel(/操作理由/).fill(reason);await dialog.getByRole("button",{name:"确认提交",exact:true}).click();const data=JSON.parse(await (await response).text()) as {data?:{operationId?:string;id?:string}};return String(data.data?.operationId??data.data?.id??"");}
async function approveUi(page:Page,operationId:string){await nav(page,"审计 & 操作确认 A2",/\/platform\/audit$/);await page.reload();const row=page.locator("tbody tr").filter({hasText:operationId});await expect(row).toBeVisible();await row.getByRole("button",{name:"执行",exact:true}).click();const response=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname.endsWith(`/api/admin/platform/audit/operations/${operationId}/approve`));const dialog=page.getByRole("dialog").last();await dialog.getByLabel(/操作理由/).fill(reason);await dialog.getByRole("button",{name:"确认提交",exact:true}).click();expect((await response).status()).toBe(200);}
async function retireAndDelete(page:Page,id:string){let current=await exactPartial(page);async function mutate(method:"PATCH"|"POST",suffix:string,body:Record<string,unknown>){const r=await page.request.fetch(`/api/admin/platform/accounts/${id}/${suffix}`,{method,headers:{"Idempotency-Key":`${runId}:final6:recover:${suffix}:${Date.now()}`},data:body});expect(r.status()).toBe(200);current=await exactPartial(page);}if(current.role!=="unassigned")await mutate("PATCH","role",{role:"unassigned",operator:d5,reason,expectedVersion:current.version});await mutate("POST","sessions/revoke",{operator:d5,reason,expectedVersion:current.version});await mutate("POST","reset-2fa",{operator:d5,reason,expectedVersion:current.version});const mysql=process.env.NEXION_MYSQL_BIN??"D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";execFileSync(mysql,["-uroot",db,"-e",`DELETE FROM nx_admin_role_relation WHERE admin_id=${id}; DELETE FROM nx_admin_account_state WHERE admin_id=${id}; DELETE FROM nx_admin WHERE id=${id} AND username LIKE 'ffix.a.final6.m.%';`],{windowsHide:true,env:{...process.env,MYSQL_PWD:dbPassword}});const remains=execFileSync(mysql,["-N","-B","-uroot",db,"-e",`SELECT COUNT(*) FROM nx_admin WHERE username LIKE 'ffix.a.final6.m.%'`],{encoding:"utf8",windowsHide:true,env:{...process.env,MYSQL_PWD:dbPassword}}).trim();expect(remains).toBe("0");}

test.describe.configure({mode:"serial",timeout:300000});
test("Final6 R3: d5 removes exactly the two failed fixture identities", async ({ page }) => {
  test.skip(token !== "B_REPAIR_A_FIXTURE_FINAL6_20260730T0320JST", "Final6 B repair capability required");
  mkdirSync(evidenceDir, { recursive: true });
  const evidence: { runId: string; targets: string[]; before: unknown[]; after: unknown[]; resetTerminal: string[]; residual?: number } = {
    runId, targets: ["99765", "99766"], before: [], after: [], resetTerminal: [],
  };
  const mysql = process.env.NEXION_MYSQL_BIN ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
  const read = async (id: string) => {
    const raw = await (await page.request.get("/api/admin/platform/accounts/overview")).text();
    return ((JSON.parse(raw) as { data?: { operators?: Array<any> } }).data?.operators ?? [])
      .find((account: any) => String(account.id) === id);
  };
  try {
    await login(page, d5, d5Secret());
    await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/);
    for (const id of evidence.targets) {
      let row = await read(id);
      if (!row) {
        evidence.after.push({ id, terminal: "ACCOUNT_ALREADY_REMOVED" });
        continue;
      }
      expect(row?.username, `only exact Final6 target ${id} may be cleaned`).toMatch(/^ffix\.a\.final6\.[mx]\./);
      evidence.before.push({ id, username: row.username, role: row.role, status: row.status, version: row.version, sessions: row.sessions, tfa: row.tfa });
      for (const [method, suffix, body] of [
        ["PATCH", "role", () => ({ role: "unassigned", operator: d5, reason, expectedVersion: row.version })],
        ["POST", "sessions/revoke", () => ({ operator: d5, reason, expectedVersion: row.version })],
        ["POST", "reset-2fa", () => ({ operator: d5, reason, expectedVersion: row.version })],
        ["PATCH", "status", () => ({ status: "disabled", operator: d5, reason, expectedVersion: row.version })],
      ] as const) {
        if (suffix === "role" && row.role === "unassigned") continue;
        const response = await page.request.fetch(`/api/admin/platform/accounts/${id}/${suffix}`, {
          method,
          headers: { "Idempotency-Key": `${runId}:b-repair:${id}:${suffix}` },
          data: body(),
        });
        const raw = await response.text();
        if (suffix === "reset-2fa" && isMfaAlreadyCleared(response.status(), raw)) {
          evidence.resetTerminal.push(`${id}:ADMIN_MFA_NOT_BOUND`);
        } else {
          expect(response.status(), raw).toBe(200);
          expect((JSON.parse(raw) as { code?: number }).code, raw).toBe(0);
        }
        row = await read(id);
      }
      evidence.after.push({ id, username: row.username, role: row.role, status: row.status, version: row.version, sessions: row.sessions, tfa: row.tfa });
    }
    execFileSync(mysql, ["-uroot", db, "-e", `DELETE FROM nx_admin_role_relation WHERE admin_id IN (99765,99766); DELETE FROM nx_admin_account_state WHERE admin_id IN (99765,99766); DELETE FROM nx_admin WHERE id IN (99765,99766) AND username LIKE 'ffix.a.final6.%';`], { windowsHide: true, env: { ...process.env, MYSQL_PWD: dbPassword } });
    const remains = execFileSync(mysql, ["-N", "-B", "-uroot", db, "-e", `SELECT COUNT(*) FROM nx_admin WHERE id IN (99765,99766) OR username LIKE 'ffix.a.final6.%';`], { encoding: "utf8", windowsHide: true, env: { ...process.env, MYSQL_PWD: dbPassword } }).trim();
    expect(remains, "exact Final6 stale identities must have no account residue").toBe("0");
    evidence.residual = 0;
  } finally {
    writeFileSync(`${evidenceDir}/fixture-r3-cleanup.json`, JSON.stringify(evidence, null, 2));
  }
});

test("Final6 B repair removes only its aborted maker before reprovisioning", async ({ page }) => {
  test.skip(token !== "B_REPAIR_A_FIXTURE_FINAL6_20260730T0320JST", "Final6 B repair capability required");
  const id = "99771";
  const mysql = process.env.NEXION_MYSQL_BIN ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
  const read = async () => {
    const raw = await (await page.request.get("/api/admin/platform/accounts/overview")).text();
    return ((JSON.parse(raw) as { data?: { operators?: Array<any> } }).data?.operators ?? [])
      .find((account: any) => String(account.id) === id);
  };
  await login(page, d5, d5Secret());
  await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/);
  let row = await read();
  if (!row) {
    const remains = execFileSync(mysql, ["-N", "-B", "-uroot", db, "-e", "SELECT COUNT(*) FROM nx_admin WHERE id=99771 OR username='ffix.a.final6.m.7ac7c8b2';"], { encoding: "utf8", windowsHide: true, env: { ...process.env, MYSQL_PWD: dbPassword } }).trim();
    expect(remains, "already-cleaned aborted maker must remain absent").toBe("0");
    return;
  }
  expect(row?.username, "only this carrier-created abort may be recovered").toMatch(/^ffix\.a\.final6\.m\.7ac7c8b2$/);
  for (const [method, suffix, body] of [
    ["PATCH", "role", () => ({ role: "unassigned", operator: d5, reason, expectedVersion: row.version })],
    ["POST", "sessions/revoke", () => ({ operator: d5, reason, expectedVersion: row.version })],
    ["POST", "reset-2fa", () => ({ operator: d5, reason, expectedVersion: row.version })],
    ["PATCH", "status", () => ({ status: "disabled", operator: d5, reason, expectedVersion: row.version })],
  ] as const) {
    if (suffix === "role" && row.role === "unassigned") continue;
    const response = await page.request.fetch(`/api/admin/platform/accounts/${id}/${suffix}`, {
      method, headers: { "Idempotency-Key": `${runId}:b-repair-abort:${id}:${suffix}` }, data: body(),
    });
    const raw = await response.text();
    if (!(suffix === "reset-2fa" && isMfaAlreadyCleared(response.status(), raw))) {
      expect(response.status(), raw).toBe(200);
      expect((JSON.parse(raw) as { code?: number }).code, raw).toBe(0);
    }
    row = await read();
  }
  execFileSync(mysql, ["-uroot", db, "-e", `DELETE FROM nx_admin_role_relation WHERE admin_id=99771; DELETE FROM nx_admin_account_state WHERE admin_id=99771; DELETE FROM nx_admin WHERE id=99771 AND username='ffix.a.final6.m.7ac7c8b2';`], { windowsHide: true, env: { ...process.env, MYSQL_PWD: dbPassword } });
  const remains = execFileSync(mysql, ["-N", "-B", "-uroot", db, "-e", "SELECT COUNT(*) FROM nx_admin WHERE id=99771 OR username='ffix.a.final6.m.7ac7c8b2';"], { encoding: "utf8", windowsHide: true, env: { ...process.env, MYSQL_PWD: dbPassword } }).trim();
  expect(remains, "aborted maker must have no residue before reprovisioning").toBe("0");
});

test("Final6 A fixture: visible A1/A2/A6 creates normal-MFA isolated maker/checker/cleanup actors", async ({ page }) => {
  test.skip(token !== "B_REPAIR_A_FIXTURE_FINAL6_20260730T0320JST", "Final6 B repair capability required");
  mkdirSync(evidenceDir, { recursive: true });
  const secret = d5Secret();
  const nonce = randomBytes(4).toString("hex");
  const evidence: { runId: string; actorPrefix: string; creator: string; visibleModules: string[]; created: unknown[]; status?: string } = {
    runId, actorPrefix: "ffix.a.final6.", creator: d5, visibleModules: [], created: [],
  };
  try {
    await login(page, d5, secret);
    await nav(page, "角色管理 A6", /\/platform\/roles$/);
    evidence.visibleModules.push("A6");
    await nav(page, "审计 & 操作确认 A2", /\/platform\/audit$/);
    evidence.visibleModules.push("A2");
    const maker = `ffix.a.final6.m.${nonce}`;
    const checker = `ffix.a.final6.c.${nonce}`;
    const cleanup = `ffix.a.final6.x.${nonce}`;
    const a = await create(page, maker, "Final6 A CAS maker");
    evidence.visibleModules.push("A1");
    const ac = await activate(page, maker, a.temporary);
    evidence.created.push({ id: a.id, username: maker, mfa: true, role: "super" });
    await login(page, d5, secret);
    const b = await create(page, checker, "Final6 A CAS checker");
    const bc = await activate(page, checker, b.temporary);
    evidence.created.push({ id: b.id, username: checker, mfa: true, role: "super" });
    await login(page, d5, secret);
    const c = await create(page, cleanup, "Final6 A exact cleanup actor");
    const cc = await activate(page, cleanup, c.temporary);
    evidence.created.push({ id: c.id, username: cleanup, mfa: true, role: "super" });
    writeFileSync(manifestPath, JSON.stringify({
      sensitive: true,
      doNotUpload: true,
      runId,
      baseUrl: "http://127.0.0.1:3002",
      purpose: "A Final6 exact fixture lifecycle; carrier surface is limited to A1/A2/A6",
      actors: {
        maker: { accountId: a.id, ...ac },
        checker: { accountId: b.id, ...bc },
        cleanup: { accountId: c.id, ...cc },
      },
      cleanup: { creator: d5, required: [a.id, b.id, c.id], exactPrefix: "ffix.a.final6." },
    }, null, 2));
    evidence.status = "ready";
  } finally {
    writeFileSync(`${evidenceDir}/fixture-summary.json`, JSON.stringify(evidence, null, 2));
  }
});
