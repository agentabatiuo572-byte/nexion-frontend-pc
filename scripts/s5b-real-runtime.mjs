import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import http from "node:http";
import net from "node:net";
import { chromium } from "playwright";
import sharp from "sharp";

const privatePath = process.env.S5B_PRIVATE_IDENTITIES || "C:/Users/jason/.codex/workflow-runs/customer-service-20260929/s5b/runtime-identities.json";
const identities = JSON.parse(readFileSync(privatePath, "utf8"));
const appFixture = JSON.parse(readFileSync("C:/Users/jason/.codex/workflow-runs/customer-service-20260929/s4/runtime-identities.json", "utf8"));
const dbFixture = JSON.parse(readFileSync("C:/Users/jason/.codex/workflow-runs/customer-service-20260929/local-db-credentials.json", "utf8"));
assert.equal(String(dbFixture.host), "127.0.0.1");
assert.equal(Number(dbFixture.port), 33329);
assert.equal(dbFixture.database, "cs_redesign");
const reportFlag = process.argv.indexOf("--report");
if (reportFlag >= 0 && (!process.argv[reportFlag + 1] || process.argv[reportFlag + 1].startsWith("--"))) throw new Error("--report requires a path");
const reportPath = reportFlag >= 0 ? process.argv[reportFlag + 1] : "C:/Users/jason/.codex/workflow-runs/customer-service-20260929/s5b/runtime-debug.json";
const listener = net.createServer();
await new Promise((resolve) => listener.listen(33029, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const appPort = 33030;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(appPort)], {
  windowsHide: true, stdio: "pipe", env: { ...process.env, NEXION_BACKEND_URL: "http://127.0.0.1:18129" },
});
const proxy = http.createServer((request, response) => {
  const upstream = http.request({ hostname: "127.0.0.1", port: appPort, path: request.url, method: request.method, headers: request.headers }, (result) => {
    response.writeHead(result.statusCode ?? 502, result.headers);
    result.pipe(response);
  });
  upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
  request.pipe(upstream);
});
proxy.on("upgrade", (request, socket, head) => {
  if (!request.url?.startsWith("/ws/conversations")) { socket.destroy(); return; }
  const upstream = net.connect(18129, "127.0.0.1", () => {
    upstream.write(`GET ${request.url} HTTP/1.1\r\n${Object.entries(request.headers).map(([name, value]) => `${name}: ${value}`).join("\r\n")}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});
await new Promise((resolve) => proxy.listen(port, "127.0.0.1", resolve));
let serverLog = "";
for (const output of [server.stdout, server.stderr]) output.on("data", (chunk) => { serverLog = (serverLog + chunk).slice(-6000); });
let browser;
const checks = [];
const proof = {};
async function apiResponse(role, path, init = {}) {
  const response = await fetch("http://127.0.0.1:18129/api/admin/content" + path, {
    ...init, headers: { ...init.headers, Authorization: `Bearer ${identities[role].token}`, Origin: "http://127.0.0.1:33029", ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
  });
  const envelope = await response.json();
  return { response, envelope };
}
async function api(role, path, init = {}) {
  const { response, envelope } = await apiResponse(role, path, init);
  if (!response.ok || envelope.code !== 0) throw new Error(`${path}: HTTP ${response.status} ${envelope.message}`);
  return envelope.data;
}
const mutation = (method, body, key = crypto.randomUUID()) => ({ method, headers: { "Idempotency-Key": key }, body: JSON.stringify(body) });
async function appApi(path, token, init = {}) {
  const response = await fetch("http://127.0.0.1:18129" + path, {
    ...init, headers: { ...init.headers, Origin: "http://127.0.0.1:33029", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  const envelope = await response.json();
  if (!response.ok || envelope.code !== 0) throw new Error(`${path}: HTTP ${response.status} ${envelope.message}`);
  return envelope.data;
}
function legacySeedSql(conversationNo, sql) {
  assert.match(conversationNo, /^[A-Za-z0-9-]+$/);
  const result = spawnSync("D:/WORKS/PLAN/.local-runtime/phone-calibration-tools/mysql-verified/mysql-8.4.6-winx64/bin/mysql.exe", [
    "--protocol=tcp", "--host=127.0.0.1", "--port=33329", `--user=${dbFixture.username}`, "--database=cs_redesign", "--batch", "--skip-column-names", "--execute", sql,
  ], { windowsHide: true, encoding: "utf8", env: { ...process.env, MYSQL_PWD: dbFixture.password } });
  if (result.status !== 0) throw new Error(`isolated legacy seed failed: ${result.stderr.replace(/password[^\n]*/gi, "[REDACTED_SECRET]")}`);
  return result.stdout.trim();
}
async function useRole(context, role) {
  await context.clearCookies();
  await context.addCookies([{ name: "nexion_admin_token", value: identities[role].token, url: origin, httpOnly: true, sameSite: "Lax" }]);
}
async function check(id, page, run) {
  const screenshot = `${dirname(reportPath)}/${id}.png`;
  try { await run(); }
  catch (error) { mkdirSync(dirname(reportPath), { recursive: true }); await page.screenshot({ path: screenshot, fullPage: true }); throw error; }
  await page.screenshot({ path: screenshot, fullPage: true });
  checks.push({ id, status: "pass", evidence: [`Real S4 HTTP and Playwright on ${page.url()}`, JSON.stringify(proof[id] ?? {}), screenshot] });
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 160; attempt++) {
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch {}
    if (server.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.ok(ready, serverLog);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  await useRole(context, "G1");
  await check("s5b-snapshot", page, async () => {
    const snapshot = await api("G1", "/support-workbench/customers?pageNum=1&pageSize=6&filter=TODO");
    assert.ok(snapshot.snapshotId && snapshot.customers.available);
    assert.equal(snapshot.overview.boundTotal, 2);
    assert.equal(snapshot.overview.activeTotal, null);
    const first = await api("G1", "/support-workbench/customers?pageNum=1&pageSize=1&filter=ALL");
    const second = await api("G1", "/support-workbench/customers?pageNum=2&pageSize=1&filter=ALL");
    assert.ok(first.snapshotId && second.snapshotId && first.customers.available && second.customers.available);
    assert.equal(first.overview.boundTotal, second.overview.boundTotal);
    assert.equal(first.customers.total, second.customers.total);
    assert.notEqual(first.customers.records[0]?.customerId, second.customers.records[0]?.customerId);
    assert.ok(first.completeness.observedThroughAt && second.completeness.observedThroughAt);
    assert.ok(snapshot.overview.todoTotal <= snapshot.overview.boundTotal, "TODO must be distinct customers");
    await page.goto(origin + "/service/overview");
    await page.getByRole("heading", { name: "我的工作台" }).waitFor();
    await page.getByRole("button", { name: /绑定客户，2 位/ }).waitFor({ timeout: 8000 }).catch(async () => {
      await page.getByRole("button", { name: "重试", exact: true }).first().click();
      await page.getByRole("button", { name: /绑定客户，2 位/ }).waitFor();
    });
    await page.getByRole("button", { name: /活跃客户，窗口待同步，未配置或数据待核对/ }).waitFor();
    const metricValues = [
      ["绑定客户", snapshot.overview.boundTotal], ["活跃客户", snapshot.overview.activeTotal],
      ["沉睡客户", snapshot.overview.dormantTotal], ["待维护", snapshot.overview.dueTotal],
      ["待顾问回复", snapshot.overview.waitingReplyTotal], ["首次待联系", snapshot.overview.firstContactTotal],
    ];
    for (const [label, value] of metricValues) {
      const card = page.locator(".s5a-metric").filter({ hasText: label });
      assert.equal(await card.locator("strong").innerText(), value === null ? "—" : String(value));
    }
    for (const [label, value] of [["已执行维护", snapshot.performance.executionCount], ["成功周期", snapshot.performance.successfulCycleCount], ["成功客户", snapshot.performance.successfulCustomerCount]]) {
      assert.equal(await page.locator(".s5a-performance > div").filter({ hasText: label }).locator("strong").innerText(), String(value));
    }
    assert.equal(await page.locator(".s5a-table tbody tr").count(), snapshot.customers.records.length);
    await page.getByRole("button", { name: /绑定客户，2 位/ }).click();
    await page.getByLabel("筛选客户").selectOption("ALL");
    await page.waitForFunction((count) => document.querySelectorAll(".s5a-table tbody tr").length === count, first.customers.total);
    for (const id of [first.customers.records[0]?.customerId, second.customers.records[0]?.customerId]) await page.locator(".s5a-table tbody tr").filter({ hasText: `ID ${id}` }).waitFor();
    proof["s5b-snapshot"] = { snapshotId: snapshot.snapshotId, sixMetrics: Object.fromEntries(metricValues), performance: { executions: snapshot.performance.executionCount, successfulCycles: snapshot.performance.successfulCycleCount, successfulCustomers: snapshot.performance.successfulCustomerCount }, todoDistinct: snapshot.overview.todoTotal, pages: [first.customers.records[0]?.customerId, second.customers.records[0]?.customerId] };
  });
  await check("s5b-maintenance", page, async () => {
    const customerId = "623";
    const before = (await api("G1", `/support-workbench/customers/${customerId}`)).customer;
    assert.equal(before.agentAdminId, identities.G1.id);
    await page.goto(origin + "/service/overview");
    await page.getByRole("navigation", { name: "客服工作区" }).getByRole("button", { name: "我的客户" }).click();
    const row = page.locator(".s5a-table tbody tr").filter({ hasText: `ID ${customerId}` });
    await row.getByRole("button").first().click();
    const dialog = page.getByRole("dialog", { name: "客户详情" });
    await dialog.getByRole("button", { name: before.enabled ? "不再维护" : "恢复维护" }).click();
    await dialog.getByRole("textbox", { name: /操作理由/ }).fill("S5b 真实维护状态和刷新持久化核验");
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await dialog.getByRole("button", { name: before.enabled ? "恢复维护" : "不再维护" }).waitFor();
    assert.equal((await api("G1", `/support-workbench/customers/${customerId}`)).customer.enabled, !before.enabled);
    await page.goto(origin + `/service/overview?customerId=${customerId}`);
    await dialog.getByRole("button", { name: before.enabled ? "恢复维护" : "不再维护" }).waitFor();
    await dialog.getByRole("button", { name: before.enabled ? "恢复维护" : "不再维护" }).click();
    await dialog.getByRole("textbox", { name: /操作理由/ }).fill("S5b 恢复真实维护状态避免影响既有客户");
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await dialog.getByRole("button", { name: before.enabled ? "不再维护" : "恢复维护" }).waitFor();
    assert.equal((await api("G1", `/support-workbench/customers/${customerId}`)).customer.enabled, before.enabled);
    const existingHistory = await api("G1", `/support-workbench/customers/${customerId}/maintenance/history?pageNum=1&pageSize=1`);
    if (existingHistory.totalCycles < 2 || existingHistory.totalExecutions < 2) {
      assert.equal(before.enabled, true, "history fixture requires a maintenance-enabled isolated customer");
      const listed = await api("G1", "/conversations?conversationType=ADVISOR&pageNum=1&pageSize=100");
      let maintenanceConversation = listed.records.find((item) => item.userId === Number(customerId) && item.status === "OPEN");
      if (!maintenanceConversation) {
        const created = await api("G1", "/conversations", mutation("POST", {
          conversationType: "ADVISOR", userId: Number(customerId), openingText: "S5b 维护历史分页准备", kind: "TEXT", intent: "SERVICE",
          clientMessageId: crypto.randomUUID(), expectedAssignmentId: before.assignmentId,
        }));
        maintenanceConversation = { conversationNo: created.conversationNo };
      }
      for (let index = 0; index < 2; index++) {
        const current = await api("G1", `/conversations/${encodeURIComponent(maintenanceConversation.conversationNo)}`);
        await api("G1", `/conversations/${encodeURIComponent(maintenanceConversation.conversationNo)}/replies`, mutation("POST", {
          body: `S5b 维护历史分页第 ${index + 1} 次人工联系`, kind: "TEXT", intent: "MAINTENANCE",
          clientMessageId: crypto.randomUUID(), expectedAssignmentId: before.assignmentId,
          expectedStatus: current.conversation.status, expectedVersion: current.conversation.version,
          reason: "S5b 真实维护记录分页验收",
        }));
        if (index === 0) {
          for (const enabled of [false, true]) {
            const preference = (await api("G1", `/support-workbench/customers/${customerId}`)).customer;
            await api("G1", `/support-workbench/customers/${customerId}/maintenance`, mutation("PATCH", {
              enabled, reason: "S5b 准备两页维护周期实测", expectedVersion: preference.preferenceVersion,
              expectedAssignmentId: preference.assignmentId,
            }));
          }
        }
      }
    }
    await page.goto(origin + `/service/overview?customerId=${customerId}`);
    await page.route(/\/maintenance\/history\?/, (route) => route.continue({ url: route.request().url().replace("pageSize=10", "pageSize=1") }));
    await dialog.getByRole("button", { name: /查看维护记录/ }).click();
    await dialog.getByText(/维护周期 [2-9]\d* 条 · 主动联系 [2-9]\d* 条/).waitFor();
    await dialog.getByRole("button", { name: "加载更多维护记录" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".s5a-history li").length >= 4);
    await page.unroute(/\/maintenance\/history\?/);
    const history1 = await api("G1", `/support-workbench/customers/${customerId}/maintenance/history?pageNum=1&pageSize=1`);
    const history2 = await api("G1", `/support-workbench/customers/${customerId}/maintenance/history?pageNum=2&pageSize=1`);
    assert.equal(history1.pageNum, 1); assert.equal(history2.pageNum, 2);
    assert.equal(history1.totalCycles, history2.totalCycles);
    assert.equal(history1.totalExecutions, history2.totalExecutions);
    assert.ok(history1.totalCycles >= 2 && history1.totalExecutions >= 2);
    assert.equal(history1.cycles.length, 1); assert.equal(history2.cycles.length, 1);
    assert.equal(history1.executions.length, 1); assert.equal(history2.executions.length, 1);
    assert.notEqual(history1.cycles[0].id, history2.cycles[0].id);
    assert.notEqual(history1.executions[0].id, history2.executions[0].id);
    proof["s5b-maintenance"] = { customerId, cyclePages: [history1.cycles[0].id, history2.cycles[0].id], executionPages: [history1.executions[0].id, history2.executions[0].id], uiRowsAfterLoadMore: 4 };
  });
  let conversationNo = "";
  let privateText = "";
  await check("s5b-message", page, async () => {
    const list = await api("G1", "/conversations?conversationType=ADVISOR&pageNum=1&pageSize=20");
    let conversation = list.records.find((item) => item.userId === 624 && item.status === "OPEN");
    if (!conversation) {
      const owner = (await api("G1", "/support-workbench/customers/624")).customer;
      const created = await api("G1", "/conversations", mutation("POST", { conversationType: "ADVISOR", userId: 624, openingText: "S5b 真实会话回归", kind: "TEXT", intent: "SERVICE", clientMessageId: crypto.randomUUID(), expectedAssignmentId: owner.assignmentId }));
      const refreshed = await api("G1", "/conversations?conversationType=ADVISOR&pageNum=1&pageSize=20");
      conversation = refreshed.records.find((item) => item.conversationNo === created.conversationNo);
    }
    assert.ok(conversation);
    conversationNo = conversation.conversationNo;
    const before = await api("G1", `/conversations/${encodeURIComponent(conversationNo)}`);
    const pending = [...before.messages].reverse().find((item) => item.senderType?.toUpperCase() === "USER");
    const text = `S5b 真实顾问服务回复 ${Date.now()}`;
    privateText = text;
    let submitted;
    const capture = (request) => {
      if (request.method() === "POST" && request.url().endsWith(`/conversations/${encodeURIComponent(conversationNo)}/replies`)) submitted = { body: request.postDataJSON(), key: request.headers()["idempotency-key"] };
    };
    page.on("request", capture);
    await page.goto(origin + "/service/sessions?customerId=624");
    const input = page.getByRole("textbox", { name: "输入会话消息" });
    await input.waitFor();
    await page.waitForFunction(() => !document.querySelector('textarea[aria-label="输入会话消息"]')?.hasAttribute("disabled"));
    await input.fill(text);
    await page.getByRole("button", { name: "发送文字" }).click();
    const sentMessage = page.locator(".ChatBody").getByText(text, { exact: true });
    try { await sentMessage.waitFor({ timeout: 12000 }); }
    catch {
      const pendingCommand = page.getByRole("button", { name: "查询结果并重试" });
      if (await pendingCommand.count()) await pendingCommand.click();
      await sentMessage.waitFor({ timeout: 12000 });
    }
    page.off("request", capture);
    assert.ok(submitted?.key && submitted.body.clientMessageId);
    assert.equal(submitted.body.body, text);
    assert.equal(submitted.body.expectedAssignmentId, Number((await api("G1", "/support-workbench/customers/624")).customer.assignmentId));
    if (pending) assert.ok(submitted.body.replyTargets?.some((target) => target.conversationNo === conversationNo && target.throughMessageId === pending.id));
    const after = await api("G1", `/conversations/${encodeURIComponent(conversationNo)}`);
    assert.equal(after.messages.filter((item) => item.content === text).length, 1);
    const command = await api("G1", `/support-workbench/commands/${encodeURIComponent(submitted.key)}`);
    assert.equal(command.status, "SUCCEEDED");
    await api("G1", `/conversations/${encodeURIComponent(conversationNo)}/replies`, mutation("POST", submitted.body, submitted.key));
    assert.equal((await api("G1", `/conversations/${encodeURIComponent(conversationNo)}`)).messages.filter((item) => item.content === text).length, 1);
    const recoveredText = `S5b 丢失响应后原命令恢复 ${Date.now()}`;
    let recoveryKey = "";
    let recoveryCommit = Promise.resolve();
    const replyPath = new RegExp(`/api/admin/content/conversations/${encodeURIComponent(conversationNo)}/replies$`);
    await page.route(replyPath, async (route) => {
      recoveryKey = route.request().headers()["idempotency-key"];
      const body = route.request().postDataJSON();
      await route.abort("failed");
      recoveryCommit = api("G1", `/conversations/${encodeURIComponent(conversationNo)}/replies`, mutation("POST", body, recoveryKey));
      await recoveryCommit;
    });
    await input.fill(recoveredText);
    await page.getByRole("button", { name: "发送文字" }).click();
    await page.getByRole("button", { name: "查询结果并重试" }).waitFor();
    await recoveryCommit;
    await page.unroute(replyPath);
    assert.ok(recoveryKey);
    assert.equal((await api("G1", `/support-workbench/commands/${encodeURIComponent(recoveryKey)}`)).status, "SUCCEEDED");
    await page.getByRole("button", { name: "查询结果并重试" }).click();
    await page.locator(".ChatBody").getByText(recoveredText, { exact: true }).waitFor();
    await page.getByRole("button", { name: "查询结果并重试" }).waitFor({ state: "hidden" });
    assert.equal((await api("G1", `/conversations/${encodeURIComponent(conversationNo)}`)).messages.filter((item) => item.content === recoveredText).length, 1);
    await page.goto(origin + "/service/overview");
    await page.locator('[data-proof="session-dock-pill"]').waitFor();
    await page.locator('[data-proof="session-dock-pill"]').click();
    const dockText = `S5b 跨页持续接待 ${Date.now()}`;
    await page.locator('[data-proof="session-dock-reply"]').fill(dockText);
    const latestBeforeDock = (await api("G1", `/conversations/${encodeURIComponent(conversationNo)}`)).conversation.version;
    const dockResponse = page.waitForResponse((response) => response.request().method() === "POST" && replyPath.test(response.url()));
    await page.getByRole("button", { name: "发送会话回复" }).click();
    const dockReply = await dockResponse;
    assert.equal((await dockReply.json()).code, 0);
    assert.equal(dockReply.request().postDataJSON().expectedVersion, latestBeforeDock);
    assert.equal((await api("G1", `/conversations/${encodeURIComponent(conversationNo)}`)).messages.filter((item) => item.content === dockText).length, 1);
  });
  let attachmentId = "";
  await check("s5b-attachment", page, async () => {
    await page.goto(origin + "/service/sessions?customerId=624");
    await page.getByRole("textbox", { name: "输入会话消息" }).waitFor();
    await page.waitForFunction(() => {
      const input = document.querySelector('input[aria-label="选择图片"]');
      return input instanceof HTMLInputElement && !input.disabled;
    });
    const policy = await api("G1", "/conversations/attachments/policy");
    assert.ok(policy.available && policy.allowedMimeTypes.includes("image/png"));
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 20, g: 160, b: 220, alpha: 1 } } }).png().toBuffer();
    const beforeImages = await page.locator('img[alt="会话图片"]').count();
    await page.locator('input[type="file"][accept="image/jpeg,image/png"]').setInputFiles({ name: "s5b-proof.png", mimeType: "image/png", buffer: png });
    await page.getByText("等待上传").waitFor();
    const uploadRequests = [];
    const captureUpload = (request) => { if (request.url().includes("/conversations/attachments")) uploadRequests.push(`${request.method()} ${new URL(request.url()).pathname}`); };
    page.on("request", captureUpload);
    const uploadResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/conversations/attachments"), { timeout: 12000 });
    await page.getByRole("button", { name: "上传图片" }).click();
    const uploaded = await (await uploadResponse.catch(() => { throw new Error(`attachment upload missing; requests=${uploadRequests.join(",")}; preview=${page.url()}`); })).json();
    page.off("request", captureUpload);
    assert.equal(uploaded.code, 0);
    attachmentId = uploaded.data.id;
    await page.getByText("已上传，尚未发送").waitFor();
    const sendResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith(`/conversations/${encodeURIComponent(conversationNo)}/replies`));
    await page.getByRole("button", { name: "发送图片", exact: true }).click();
    const replyResponse = await sendResponse;
    const sendResult = await replyResponse.json();
    const latestVersion = (await api("G1", `/conversations/${encodeURIComponent(conversationNo)}`)).conversation.version;
    assert.equal(sendResult.code, 0, `image reply: ${sendResult.message}; submitted v${replyResponse.request().postDataJSON().expectedVersion}; latest v${latestVersion}`);
    await page.waitForFunction((n) => document.querySelectorAll('img[alt="会话图片"]').length > n, beforeImages);
    const detail = await api("G1", `/conversations/${encodeURIComponent(conversationNo)}`);
    assert.ok(detail.messages.some((message) => message.attachmentId === attachmentId && message.kind === "IMAGE"));
    const path = `http://127.0.0.1:18129/api/admin/content/conversations/attachments/${attachmentId}/content`;
    const headers = (role, range) => ({ Authorization: `Bearer ${identities[role].token}`, Origin: "http://127.0.0.1:33029", ...(range ? { Range: range } : {}) });
    const ownerRead = await fetch(path, { headers: headers("G1") });
    assert.equal(ownerRead.status, 200);
    assert.equal(ownerRead.headers.get("Content-Type")?.split(";")[0], "image/png");
    const returnedImage = Buffer.from(await ownerRead.arrayBuffer());
    assert.deepEqual((await sharp(returnedImage).metadata()).width, 2);
    assert.ok(returnedImage.length > 0);
    const outsiderRead = await fetch(path, { headers: headers("G2", "bytes=0-3") });
    assert.ok([403, 404].includes(outsiderRead.status));
    const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#88aacc" } }).jpeg().toBuffer();
    const form = new FormData();
    form.set("file", new Blob([jpeg], { type: "image/jpeg" }), "s5b-proof.jpg");
    form.set("customerId", "624");
    form.set("clientUploadId", crypto.randomUUID());
    form.set("expectedAssignmentId", String((await api("G1", "/support-workbench/customers/624")).customer.assignmentId));
    const jpegUpload = await api("G1", "/conversations/attachments", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: form });
    assert.equal(jpegUpload.mime, "image/jpeg");
    const beforeJpeg = await api("G1", `/conversations/${encodeURIComponent(conversationNo)}`);
    await api("G1", `/conversations/${encodeURIComponent(conversationNo)}/replies`, mutation("POST", {
      body: "", kind: "IMAGE", attachmentId: jpegUpload.id, intent: "SERVICE", clientMessageId: crypto.randomUUID(),
      expectedAssignmentId: Number(form.get("expectedAssignmentId")), expectedStatus: "OPEN", expectedVersion: beforeJpeg.conversation.version,
      reason: "S5b 真实 JPEG 图片发送回归",
    }));
    assert.ok((await api("G1", `/conversations/${encodeURIComponent(conversationNo)}`)).messages.some((message) => message.attachmentId === jpegUpload.id && message.kind === "IMAGE"));
    const jpegRead = await fetch(`http://127.0.0.1:18129/api/admin/content/conversations/attachments/${jpegUpload.id}/content`, { headers: headers("G1") });
    assert.equal(jpegRead.status, 200);
    assert.equal(jpegRead.headers.get("Content-Type")?.split(";")[0], "image/jpeg");
    const jpegBytes = Buffer.from(await jpegRead.arrayBuffer());
    const jpegMetadata = await sharp(jpegBytes).metadata();
    assert.equal(jpegMetadata.format, "jpeg");
    assert.equal(jpegMetadata.width, 2);
    await page.reload();
    await page.getByAltText("会话图片").last().waitFor();
    proof["s5b-attachment"] = { png: { id: attachmentId, bytes: returnedImage.length, width: 2 }, jpeg: { id: jpegUpload.id, bytes: jpegBytes.length, format: jpegMetadata.format, width: jpegMetadata.width }, uiImageCount: await page.getByAltText("会话图片").count() };
  });
  let ticketNo = "";
  let directTicketNo = "";
  const internalNote = `S5b 内部协作记录 ${Date.now()}`;
  const directBody = `S5b 普通工单协作 ${Date.now()}`;
  await check("s5b-ticket", page, async () => {
    const detail = await api("G1", `/conversations/${encodeURIComponent(conversationNo)}`);
    const converted = await api("G1", `/conversations/${encodeURIComponent(conversationNo)}/ticket`, mutation("POST", {
      category: "withdrawal", priority: "NORMAL", title: privateText, expectedStatus: detail.conversation.status,
      expectedVersion: detail.conversation.version, reason: "S5b 真实私聊转工单权限验收",
    }));
    const ticket = converted.ticket?.ticket ?? converted.ticket;
    ticketNo = ticket?.ticketNo;
    assert.ok(ticketNo && ticket.sourceConversationNo === conversationNo);
    const current = (await api("G1", `/tickets/${encodeURIComponent(ticketNo)}`)).ticket;
    assert.ok(JSON.stringify(current).includes(privateText));
    await api("G1", `/tickets/${encodeURIComponent(ticketNo)}/internal-notes`, mutation("POST", {
      body: internalNote, expectedStatus: current.status, expectedVersion: current.version, reason: "S5b 验证转绑后内部协作仍可用",
    }));
    const direct = await api("G1", "/tickets", mutation("POST", {
      userId: 624, category: "withdrawal", priority: "NORMAL", title: directBody,
      body: directBody, reason: "S5b 验证普通工单不受私聊撤权误遮蔽",
    }));
    directTicketNo = direct.ticket?.ticketNo;
    assert.ok(directTicketNo);
    assert.equal((await api("G1", `/tickets/${encodeURIComponent(directTicketNo)}`)).ticket.sourceConversationNo, "DIRECT");
    await page.goto(origin + `/service/tickets?query=${encodeURIComponent(ticketNo)}`);
    await page.getByRole("dialog", { name: `工单 ${ticketNo} 详情` }).waitFor();
    await page.getByText(privateText, { exact: true }).first().waitFor();
  });
  await check("s5b-reply-targets", page, async () => {
    const login = await appApi("/auth/users/login", null, { method: "POST", body: JSON.stringify({
      countryCode: appFixture.CUSTOMER.countryCode, phone: appFixture.CUSTOMER.phone, password: appFixture.password,
    }) });
    assert.equal(login.user.userId, 624);
    const token = login.accessToken;
    assert.ok(token);
    const old = [];
    for (const index of [1, 2]) {
      const created = await appApi("/api/app/support/conversations", token, mutation("POST", {
        conversationType: "ADVISOR", openingText: `S5b 存量旧段待回复 ${index}`, clientMessageId: crypto.randomUUID(),
      }));
      const no = created.conversation.conversationNo;
      assert.match(no, /^[A-Za-z0-9-]+$/);
      const detail = await api("G1", `/conversations/${encodeURIComponent(no)}`);
      const userMessage = detail.messages.find((message) => message.senderType?.toUpperCase() === "USER");
      assert.ok(userMessage?.id);
      const changed = legacySeedSql(no, `UPDATE nx_conversation SET status='CLOSED' WHERE conversation_no='${no}' AND user_id=624 AND status='OPEN'; SELECT ROW_COUNT();`);
      assert.equal(changed.split(/\s+/).at(-1), "1", "only the freshly created isolated legacy row may be closed");
      old.push({ no, through: userMessage.id });
    }
    await page.goto(origin + "/service/sessions?customerId=624");
    await page.getByRole("checkbox", { name: new RegExp(`处理旧会话 ${old[0].no}`) }).waitFor();
    await page.getByRole("checkbox", { name: new RegExp(`处理旧会话 ${old[1].no}`) }).waitFor();
    await page.getByRole("checkbox", { name: new RegExp(`处理旧会话 ${old[0].no}`) }).check();
    assert.equal(await page.getByRole("checkbox", { name: new RegExp(`处理旧会话 ${old[1].no}`) }).isChecked(), false);
    const newer = legacySeedSql(old[0].no, `INSERT INTO nx_conversation_message(conversation_id,conversation_no,sender_id,sender_type,sender_name,content,created_at,updated_at) SELECT id,conversation_no,624,'user','S5b isolated legacy seed','S5b 较新旧段消息继续待回复',NOW(),NOW() FROM nx_conversation WHERE conversation_no='${old[0].no}' AND user_id=624 AND status='CLOSED'; SELECT LAST_INSERT_ID();`);
    const newerId = Number(newer.split(/\s+/).at(-1));
    assert.ok(newerId > old[0].through);
    const text = `S5b 明确处理一段旧会话 ${Date.now()}`;
    let submitted;
    const capture = (request) => { if (request.method() === "POST" && request.url().endsWith("/api/admin/content/conversations")) submitted = { body: request.postDataJSON(), key: request.headers()["idempotency-key"] }; };
    page.on("request", capture);
    await page.getByRole("textbox", { name: "输入会话消息" }).fill(text);
    await page.getByRole("button", { name: "发送文字" }).click();
    await page.locator(".ChatBody").getByText(text, { exact: true }).waitFor();
    page.off("request", capture);
    assert.deepEqual(submitted.body.replyTargets, [{ conversationNo: old[0].no, throughMessageId: old[0].through }]);
    assert.ok(submitted.key && submitted.body.clientMessageId);
    const cursor = legacySeedSql(old[0].no, `SELECT through_message_id FROM nx_support_reply_cursor WHERE conversation_no='${old[0].no}';`);
    assert.equal(Number(cursor), old[0].through);
    const unselectedCount = legacySeedSql(old[1].no, `SELECT COUNT(*) FROM nx_support_reply_cursor WHERE conversation_no='${old[1].no}';`);
    assert.equal(Number(unselectedCount), 0);
    assert.equal((await api("G1", "/support-workbench/customers/624")).customer.waitingReply, true);
    proof["s5b-reply-targets"] = { isolatedLegacySeed: old.map((item) => item.no), selectedThroughMessageId: old[0].through, newerMessageId: newerId, unselectedCursorCount: 0, customerStillWaitingReply: true };
  });
  await check("s5b-revocation", page, async () => {
    const workbench = await context.newPage();
    await workbench.goto(origin + "/service/overview");
    await workbench.locator(".s5a-recent").getByRole("button", { name: /客户 624/ }).first().waitFor();
    const ticketsPage = await context.newPage();
    const detailRequests = [];
    ticketsPage.on("response", (response) => { if (/\/api\/admin\/content\/tickets\/TK-/.test(response.url())) detailRequests.push(response.status()); });
    await ticketsPage.goto(origin + "/service/tickets");
    await ticketsPage.getByRole("textbox", { name: /搜索工单主题/ }).fill(directTicketNo);
    await ticketsPage.locator("tr").filter({ hasText: directTicketNo }).getByRole("button", { name: "处理" }).click();
    await ticketsPage.getByRole("dialog", { name: `工单 ${directTicketNo} 详情` }).getByText(directBody).first().waitFor();
    assert.equal(await ticketsPage.evaluate(() => document.activeElement?.getAttribute("role")), "dialog");
    await ticketsPage.keyboard.press("Shift+Tab");
    assert.equal(await ticketsPage.evaluate(() => document.activeElement?.closest('[role="dialog"]')?.getAttribute("aria-modal")), "true");
    await page.goto(origin + "/service/sessions?customerId=624");
    await page.locator(".sr-only").filter({ hasText: "实时会话已连接" }).waitFor({ state: "attached", timeout: 15000 });
    await page.getByRole("textbox", { name: "搜索客户或会话编号" }).fill(conversationNo);
    await page.locator(".cv-item").first().click();
    const privateBlob = await page.getByAltText("会话图片").first().getAttribute("src");
    assert.ok(privateBlob?.startsWith("blob:"));
    await page.evaluate(() => { const original = URL.revokeObjectURL.bind(URL); window.__s5bRevokedBlobs = []; URL.revokeObjectURL = (url) => { window.__s5bRevokedBlobs.push(url); original(url); }; });
    await page.evaluate(() => { window.__s5bScopeCount = 0; window.addEventListener("support-scope-invalidated", () => { window.__s5bScopeCount += 1; }); });
    for (const other of [workbench, ticketsPage]) await other.evaluate(() => { window.__s5bScopeCount = 0; window.addEventListener("support-scope-invalidated", () => { window.__s5bScopeCount += 1; }); });
    const original = (await api("G1", "/support-workbench/customers/624")).customer;
    assert.equal(original.agentAdminId, identities.G1.id);
    let releaseOldSnapshot;
    let captureOldSnapshot;
    let confirmOldSnapshotDelivered;
    const oldSnapshotCaptured = new Promise((resolve) => { captureOldSnapshot = resolve; });
    const oldSnapshotReleased = new Promise((resolve) => { releaseOldSnapshot = resolve; });
    const oldSnapshotDelivered = new Promise((resolve) => { confirmOldSnapshotDelivered = resolve; });
    let interceptedSnapshot = false;
    await workbench.route(/\/support-workbench\/customers\?/, async (route) => {
      if (interceptedSnapshot) return route.continue();
      interceptedSnapshot = true;
      const oldResponse = await route.fetch();
      const oldBody = await oldResponse.json();
      assert.equal(oldBody.code, 0);
      assert.ok(oldBody.data.customers.records.some((row) => row.customerId === 624));
      captureOldSnapshot(oldBody.data.snapshotId);
      await oldSnapshotReleased;
      await route.fulfill({ response: oldResponse });
      confirmOldSnapshotDelivered();
    });
    await workbench.getByRole("button", { name: /绑定客户，2 位/ }).click();
    const oldSnapshotId = await Promise.race([oldSnapshotCaptured, new Promise((_, reject) => setTimeout(() => reject(new Error("old snapshot not captured")), 8000))]);
    let moved = false;
    try {
      await api("MANAGER", "/support-agents/assignments/transfer", mutation("POST", {
        targetAgentAdminId: identities.G2.id,
        customers: [{ id: 624, expectedAssignmentId: original.assignmentId, expectedVersion: original.assignmentVersion }],
        reason: "S5b 真实转绑与私聊权限撤销验收",
      }));
      moved = true;
      await page.waitForFunction(() => window.__s5bScopeCount > 0, null, { timeout: 15000 });
      await workbench.waitForFunction(() => window.__s5bScopeCount > 0, null, { timeout: 15000 });
      await workbench.locator(".s5a-table tbody tr").filter({ hasText: "ID 624" }).waitFor({ state: "hidden" });
      await workbench.evaluate(() => {
        window.__s5bSnapshotRevived = false;
        new MutationObserver(() => { if ([...document.querySelectorAll(".s5a-table tbody tr")].some((row) => row.textContent?.includes("ID 624"))) window.__s5bSnapshotRevived = true; })
          .observe(document.body, { childList: true, subtree: true, characterData: true });
      });
      releaseOldSnapshot();
      await Promise.race([oldSnapshotDelivered, new Promise((_, reject) => setTimeout(() => reject(new Error("old snapshot was not delivered")), 8000))]);
      await workbench.waitForTimeout(300);
      assert.equal(await workbench.evaluate(() => window.__s5bSnapshotRevived), false);
      await workbench.unroute(/\/support-workbench\/customers\?/);
      await page.waitForFunction((url) => window.__s5bRevokedBlobs.includes(url), privateBlob, { timeout: 15000 });
      for (const other of [workbench, ticketsPage]) await other.waitForFunction(() => window.__s5bScopeCount > 0, null, { timeout: 15000 });
      await workbench.locator(".s5a-recent").getByRole("button", { name: /客户 624/ }).first().waitFor({ state: "hidden" });
      await workbench.locator(".s5a-table tbody tr").filter({ hasText: "ID 624" }).waitFor({ state: "hidden" });
      proof["s5b-revocation"] = { heldOldSnapshot: oldSnapshotId, staleRowHidden: true, revokedBlob: true };
      const ordinary = await api("G1", `/tickets/${encodeURIComponent(directTicketNo)}`);
      assert.equal(ordinary.ticket.contentRestricted, false);
      assert.ok(JSON.stringify(ordinary).includes(directBody));
      if (await ticketsPage.getByRole("dialog", { name: `工单 ${directTicketNo} 详情` }).count() === 0) {
        await ticketsPage.locator("tr").filter({ hasText: directTicketNo }).getByRole("button", { name: "处理" }).click();
      }
      await ticketsPage.getByRole("dialog", { name: `工单 ${directTicketNo} 详情` }).getByText(directBody).first().waitFor();
      assert.ok(detailRequests.length < 10, `M2 should load the opened ticket only, got ${detailRequests.length} detail requests`);
      assert.equal(await ticketsPage.locator('[data-proof="support-ticket-content-restricted"]').count(), 0);
      assert.equal(await page.locator(".ChatBody").getByText(privateText, { exact: true }).count(), 0);
      const oldConversation = await apiResponse("G1", `/conversations/${encodeURIComponent(conversationNo)}`);
      assert.ok([403, 404].includes(oldConversation.response.status));
      const newConversation = await api("G2", `/conversations/${encodeURIComponent(conversationNo)}`);
      assert.ok(newConversation.messages.some((item) => item.content === privateText));
      const oldAttachment = await apiResponse("G1", `/conversations/attachments/${attachmentId}/content`);
      assert.ok([403, 404].includes(oldAttachment.response.status));
      const oldRange = await fetch(`http://127.0.0.1:18129/api/admin/content/conversations/attachments/${attachmentId}/content`, { headers: { Authorization: `Bearer ${identities.G1.token}`, Origin: "http://127.0.0.1:33029", Range: "bytes=0-3" } });
      assert.ok([403, 404].includes(oldRange.status));
      const oldHistory = await apiResponse("G1", "/support-workbench/customers/624/maintenance/history?pageNum=1&pageSize=1");
      assert.ok([403, 404].includes(oldHistory.response.status));
      const oldMaintenance = await apiResponse("G1", "/support-workbench/customers/624/maintenance", mutation("PATCH", {
        enabled: false, reason: "S5b 转绑后旧顾问不得代签维护", expectedVersion: original.preferenceVersion ?? original.version, expectedAssignmentId: original.assignmentId,
      }));
      assert.ok([403, 404].includes(oldMaintenance.response.status));
      const managerMaintenance = await apiResponse("MANAGER", "/support-workbench/customers/624/maintenance", mutation("PATCH", {
        enabled: false, reason: "S5b 主管审阅不得代签维护", expectedVersion: original.preferenceVersion ?? original.version, expectedAssignmentId: original.assignmentId,
      }));
      assert.ok([403, 404].includes(managerMaintenance.response.status));
      const oldTicket = await api("G1", `/tickets/${encodeURIComponent(ticketNo)}`);
      assert.equal(oldTicket.ticket.contentRestricted, true);
      assert.ok(!JSON.stringify(oldTicket).includes(privateText));
      assert.ok(JSON.stringify(oldTicket).includes(internalNote));
      const followupNote = `S5b 转绑后内部协作 ${Date.now()}`;
      await api("G1", `/tickets/${encodeURIComponent(ticketNo)}/internal-notes`, mutation("POST", {
        body: followupNote, expectedStatus: oldTicket.ticket.status, expectedVersion: oldTicket.ticket.version, reason: "S5b 撤权后内部备注继续协作",
      }));
      const afterNoteDetail = await api("G1", `/tickets/${encodeURIComponent(ticketNo)}`);
      const afterNote = afterNoteDetail.ticket;
      assert.ok(JSON.stringify(afterNoteDetail).includes(followupNote));
      const nextStatus = afterNote.status === "OPEN" ? "IN_PROGRESS" : "OPEN";
      await api("G1", `/tickets/${encodeURIComponent(ticketNo)}/status`, mutation("PATCH", {
        status: nextStatus, expectedStatus: afterNote.status, expectedVersion: afterNote.version, reason: "S5b 撤权后工单状态继续协作",
      }));
      const afterStatus = (await api("G1", `/tickets/${encodeURIComponent(ticketNo)}`)).ticket;
      assert.equal(afterStatus.status, nextStatus);
      assert.equal(afterStatus.contentRestricted, true);
      await api("G1", `/tickets/${encodeURIComponent(ticketNo)}/assignee`, mutation("PATCH", {
        assignedAdminId: identities.G2.id, assignedAdminName: identities.G2.username,
        expectedStatus: afterStatus.status, expectedVersion: afterStatus.version, reason: "S5b 撤权后工单仍可指派协作",
      }));
      const afterAssignment = (await api("G1", `/tickets/${encodeURIComponent(ticketNo)}`)).ticket;
      assert.equal(afterAssignment.assignedAdminId, identities.G2.id);
      assert.equal(afterAssignment.contentRestricted, true);
      const privateSearch = await api("G1", `/tickets?scope=all&keyword=${encodeURIComponent(privateText)}&pageNum=1&pageSize=20`);
      assert.equal(privateSearch.total, 0);
      const newTicket = await api("G2", `/tickets/${encodeURIComponent(ticketNo)}`);
      assert.ok(JSON.stringify(newTicket).includes(privateText));
      const managerTicket = await api("MANAGER", `/tickets/${encodeURIComponent(ticketNo)}`);
      assert.equal(managerTicket.ticket.contentRestricted, false);
      assert.ok(JSON.stringify(managerTicket).includes(privateText));
      await page.goto(origin + `/service/tickets?query=${encodeURIComponent(ticketNo)}`);
      await page.getByRole("dialog", { name: `工单 ${ticketNo} 详情` }).waitFor();
      await page.locator('[data-proof="support-ticket-content-restricted"]').waitFor();
      assert.equal(await page.getByText(privateText, { exact: true }).count(), 0);
    } finally {
      releaseOldSnapshot();
      await workbench.close(); await ticketsPage.close();
      if (moved) {
        const latest = (await api("G2", "/support-workbench/customers/624")).customer;
        await api("MANAGER", "/support-agents/assignments/transfer", mutation("POST", {
          targetAgentAdminId: identities.G1.id,
          customers: [{ id: 624, expectedAssignmentId: latest.assignmentId, expectedVersion: latest.assignmentVersion }],
          reason: "S5b 验收结束恢复客户原顾问归属",
        }));
        assert.equal((await api("G1", "/support-workbench/customers/624")).customer.agentAdminId, identities.G1.id);
      }
    }
  });
  await check("s5b-full-race", page, async () => {
    await page.goto(origin + "/service/sessions?customerId=624");
    const input = page.getByRole("textbox", { name: "输入会话消息" });
    await input.waitFor();
    await page.waitForFunction(() => !document.querySelector('textarea[aria-label="输入会话消息"]')?.hasAttribute("disabled"));
    await page.evaluate(() => { window.__s5bFullRaceScope = 0; window.addEventListener("support-scope-invalidated", () => { window.__s5bFullRaceScope += 1; }); });
    let releaseOldFull;
    let captureOldFull;
    let confirmOldFullDelivered;
    const oldFullCaptured = new Promise((resolve) => { captureOldFull = resolve; });
    const oldFullReleased = new Promise((resolve) => { releaseOldFull = resolve; });
    const oldFullDelivered = new Promise((resolve) => { confirmOldFullDelivered = resolve; });
    let intercepted = false;
    let heldConversationNo = "";
    const fullRoute = /\/conversations\?/;
    await page.route(fullRoute, async (route) => {
      if (intercepted) return route.continue();
      intercepted = true;
      const oldResponse = await route.fetch();
      const body = await oldResponse.json();
      assert.equal(body.code, 0);
      assert.ok(body.data.records.some((row) => row.userId === 624));
      heldConversationNo = body.data.records.find((row) => row.userId === 624 && row.status === "OPEN")?.conversationNo ?? "";
      assert.ok(heldConversationNo);
      captureOldFull(body.data.total);
      await oldFullReleased;
      await route.fulfill({ response: oldResponse });
      confirmOldFullDelivered();
    });
    const text = `S5b 在途旧全量响应 ${Date.now()}`;
    await input.fill(text);
    await page.getByRole("button", { name: "发送文字" }).click();
    const oldFullTotal = await Promise.race([oldFullCaptured, new Promise((_, reject) => setTimeout(() => reject(new Error("old full conversation response not captured")), 10000))]);
    await page.getByRole("textbox", { name: "搜索客户或会话编号" }).fill(heldConversationNo);
    const original = (await api("G1", "/support-workbench/customers/624")).customer;
    let moved = false;
    try {
      await api("MANAGER", "/support-agents/assignments/transfer", mutation("POST", {
        targetAgentAdminId: identities.G2.id,
        customers: [{ id: 624, expectedAssignmentId: original.assignmentId, expectedVersion: original.assignmentVersion }],
        reason: "S5b 在途旧会话全量响应晚于真实撤权帧",
      }));
      moved = true;
      await page.waitForFunction(() => window.__s5bFullRaceScope > 0, null, { timeout: 15000 });
      await page.locator(".cv-item").waitFor({ state: "hidden" });
      await page.evaluate(() => {
        window.__s5bFullRevived = false;
        new MutationObserver(() => { if (document.querySelector(".cv-item")) window.__s5bFullRevived = true; })
          .observe(document.body, { childList: true, subtree: true, characterData: true });
      });
      releaseOldFull();
      await Promise.race([oldFullDelivered, new Promise((_, reject) => setTimeout(() => reject(new Error("old full response was not delivered")), 8000))]);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => window.__s5bFullRevived), false);
      await page.unroute(fullRoute);
      await page.locator(".ChatBody").getByText(text, { exact: true }).waitFor({ state: "hidden" });
      assert.equal(await page.locator(".cv-item").count(), 0);
      proof["s5b-full-race"] = { heldOldFullTotal: oldFullTotal, invalidationFrameReceived: true, stalePrivateTextHidden: true };
    } finally {
      releaseOldFull();
      await page.unroute(fullRoute);
      if (moved) {
        const latest = (await api("G2", "/support-workbench/customers/624")).customer;
        await api("MANAGER", "/support-agents/assignments/transfer", mutation("POST", {
          targetAgentAdminId: identities.G1.id,
          customers: [{ id: 624, expectedAssignmentId: latest.assignmentId, expectedVersion: latest.assignmentVersion }],
          reason: "S5b 在途响应验收结束恢复客户原顾问",
        }));
      }
    }
  });
  await useRole(context, "SUPER");
  await check("s5b-rules", page, async () => {
    const path = "/support-agents/rules";
    const before = await api("SUPER", path);
    const fields = ["dormantDays", "maintenanceDays", "activityWindowDays", "inheritanceMode", "maxInheritanceDepth"];
    let ownVersion = before.version;
    let changed = false;
    const fill = async (values) => {
      await page.getByLabel("沉睡判定天数").fill(values.dormantDays == null ? "" : String(values.dormantDays));
      await page.getByLabel("主动维护间隔天数").fill(values.maintenanceDays == null ? "" : String(values.maintenanceDays));
      await page.getByLabel("活跃统计窗口天数").fill(values.activityWindowDays == null ? "" : String(values.activityWindowDays));
      await page.getByLabel("自动继承方式").selectOption(values.inheritanceMode);
      if (values.inheritanceMode === "LIMITED") await page.getByLabel("最大自动继承层数").fill(String(values.maxInheritanceDepth));
    };
    const confirm = async (reason) => {
      await page.getByRole("button", { name: "预览并保存" }).click();
      await page.getByRole("dialog", { name: "确认保存服务规则" }).getByRole("textbox", { name: /修改理由/ }).fill(reason);
      await page.getByRole("dialog", { name: "确认保存服务规则" }).getByRole("button", { name: "确认保存" }).click();
    };
    try {
      await page.goto(origin + "/service/scripts");
      await page.getByRole("region", { name: "服务规则" }).waitFor();
      const desired = { dormantDays: null, maintenanceDays: null, activityWindowDays: 1, inheritanceMode: "LIMITED", maxInheritanceDepth: 0 };
      await fill(desired);
      const external = await api("SUPER", path, mutation("PUT", {
        ...Object.fromEntries(fields.map((field) => [field, field === "maintenanceDays" ? before.maintenanceDays === 4 ? 5 : 4 : before[field]])),
        expectedVersion: before.version, reason: "S5b 制造真实规则版本冲突以核验人工重审",
      }));
      changed = true; ownVersion = external.version;
      await confirm("S5b 首次提交预期遇到真实版本冲突");
      await page.getByRole("button", { name: "以最新规则重审" }).waitFor();
      assert.equal(await page.getByLabel("活跃统计窗口天数").inputValue(), "1");
      await page.getByRole("button", { name: "以最新规则重审" }).click();
      await confirm("S5b 保留原输入并按最新规则重审保存");
      await page.getByRole("dialog", { name: "确认保存服务规则" }).waitFor({ state: "hidden" });
      const saved = await api("SUPER", path);
      ownVersion = saved.version;
      for (const field of fields) assert.equal(saved[field], desired[field], `saved ${field}`);
      await page.reload();
      await page.getByRole("region", { name: "服务规则" }).waitFor();
      assert.equal(await page.getByLabel("活跃统计窗口天数").inputValue(), "1");
      assert.equal(await page.getByLabel("最大自动继承层数").inputValue(), "0");
      await fill(before);
      await confirm("S5b 验收结束从页面恢复原有服务规则");
      await page.getByRole("dialog", { name: "确认保存服务规则" }).waitFor({ state: "hidden" });
      const restored = await api("SUPER", path);
      ownVersion = restored.version;
      for (const field of fields) assert.equal(restored[field], before[field], `restored ${field}`);
      await page.reload();
      await page.getByRole("region", { name: "服务规则" }).waitFor();
      assert.equal(await page.getByLabel("主动维护间隔天数").inputValue(), before.maintenanceDays == null ? "" : String(before.maintenanceDays));
    } finally {
      if (changed) {
        const latest = await api("SUPER", path);
        if (fields.some((field) => latest[field] !== before[field])) {
          assert.equal(latest.version, ownVersion, "Shared rules changed concurrently; refusing to overwrite them");
          await api("SUPER", path, mutation("PUT", { ...Object.fromEntries(fields.map((field) => [field, before[field]])), expectedVersion: latest.version, reason: "S5b 异常退出恢复原有服务规则" }));
        }
      }
    }
  });
  const required = ["WORKFLOW_TASK_ID", "WORKFLOW_STEP_ID", "WORKFLOW_CHECK_ID", "WORKFLOW_RUN_ID", "WORKFLOW_REPO", "WORKFLOW_SNAPSHOT_HASH"];
  const meta = required.every((key) => process.env[key]) ? {
    taskId: process.env.WORKFLOW_TASK_ID, stepId: process.env.WORKFLOW_STEP_ID, checkId: process.env.WORKFLOW_CHECK_ID,
    runId: process.env.WORKFLOW_RUN_ID, repo: process.env.WORKFLOW_REPO, snapshotHash: process.env.WORKFLOW_SNAPSHOT_HASH,
  } : {};
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ ...meta, at: new Date().toISOString(), verdict: "pass", mode: "full", capability: "runtime", treeMoved: false, innerSkipped: 0, steps: checks }, null, 2));
  console.log("PASS S5b real runtime: " + checks.map((item) => item.id).join(", "));
} finally {
  if (browser) await browser.close();
  proxy.close();
  if (server.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else server.kill("SIGTERM");
  }
}
