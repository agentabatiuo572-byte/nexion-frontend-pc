// 实景走查:K1 收益释放参数弹窗的「放宽告知块」是否真渲染。
// 跑法:先起 dev server(根 .claude/launch.json 的 pkg-restore-admin,:3022),再 node scripts/k1-release-guard-walkthrough.mjs
// 关键点(踩过的坑):
//  · 路由守卫认 "*",但组件里的 hasAuthority 是精确匹配 → authorities 必须同时给 "*" 和 risk_k1_write
//  · overview 解析器 fail-closed,任一字段坏形整页拒;linkWeight 必须是「设备 X · 支付 Y · IP Z」且三者和=1
//  · 读端点带 overview 后缀;route 用 endsWith 精确匹配,通配会把子端点也劫持
//  · dev server 首次编译慢 → 等 DOM 出现而不是死等固定毫秒
//  · 🔴 最坑的一条:effectiveMenuNodes 传空数组 = 「后端明确授了零菜单」→ 整个侧栏与深链全被判无权。
//    要走「按角色全开」的回退路径就必须**整个字段不传**,不能传 []
import { chromium } from "playwright";

const BASE = "http://localhost:3022";
const OUT = "C:/Users/jason/AppData/Local/Temp/claude/D--WORKS-PLAN/d2a463a1-2f6b-4e3d-a8f7-e54ecafc9b7d/scratchpad/";

const SESSION = { code: 0, message: "ok", data: { tokenType: "Bearer", session: {
  adminId: 1, username: "ops-preview", operator: "走查操作员", role: "SUPER_ADMIN", roleCode: "SUPER_ADMIN",
  authorities: ["*", "risk_k1_write"], effectiveMenus: ["K", "K1"], passwordChangeRequired: false } } };

const row = (key, name, value, unit) => ({ key, name, value, version: 1, sub: `${name}的说明`, note: "", ...(unit ? { unit } : {}) });
const OVERVIEW = { code: 0, message: "ok", data: {
  serverCanonical: true, domain: "K1",
  stats: { activeClusters: 12, highClusters: 3, frozenClusters: 1, frozenAccounts: 4, flaggedAccounts: 7 },
  params: [
    row("maxSignupPerIp24h", "同 IP 24h 注册上限", "3", "个"),
    row("maxAccountsPerDevice", "同设备绑定上限", "2", "个"),
    row("maxAccountsPerPaymentInstrument", "同支付工具上限", "2", "个"),
    row("linkWeight", "关联判定权重", "设备 0.5 · 支付 0.4 · IP 0.1"),
    row("clusterFreezeSuggestThreshold", "关联强度建议阈值", "0.7"),
  ],
  releaseParams: [
    row("freePhoneSlotsPerCluster", "正常释放槽位", "3", "个"),
    row("duplicateAccountPendingFrom", "待审起点", "5", "号"),
    row("duplicateAccountFreezeFrom", "重复账号建议线", "8", "号"),
    row("pendingReleaseHours", "观察窗口", "72", "小时"),
    row("appAttestationReleaseHours", "在线证明时长", "24", "小时"),
    row("releaseMode", "释放模式", "manual_only"),
    row("freeSlotRequiresBinding", "首号绑定要求", "true"),
  ],
  clusters: { total: 0, pageNum: 1, pageSize: 5, records: [] },
  whitelist: { total: 0, pageNum: 1, pageSize: 5, records: [] },
  sources: ["nx_user_registration_otp:consumed_client_ip", "nx_risk_decision:device_fingerprint",
    "nx_wallet_bank_card:card_token", "nx_admin_risk_multi_account_cluster", "nx_admin_risk_ip_whitelist"],
} };

const results = [];
const step = (n, ok, d = "") => { results.push({ n, ok, d }); console.log(`${ok ? "✓" : "🔴"} ${n}${d ? " · " + d : ""}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
await page.route("**/api/**", async (r) => {
  const p = new URL(r.request().url()).pathname;
  if (p.endsWith("/api/admin/auth/session")) return r.fulfill({ json: SESSION });
  if (p.endsWith("/multi-account/overview")) return r.fulfill({ json: OVERVIEW });
  return r.fulfill({ json: { code: 0, message: "ok", data: {} } });
});

await page.goto(`${BASE}/risk/multi-account`, { waitUntil: "networkidle" });
// 深链会在登录态建立时被弹回默认页 —— 会话稳定后再进一次,这是 harness 的已知行为不是产品 bug。
await page.waitForTimeout(1500);
if (!page.url().includes("/risk/multi-account")) { await page.goto(`${BASE}/risk/multi-account`, { waitUntil: "networkidle" }); }
const card = page.locator('[data-proof="k1-risk-release-params"]');
await card.waitFor({ state: "visible", timeout: 90_000 });   // 等编译+渲染,不死等固定毫秒
step("收益释放参数卡已渲染", true, `${await page.locator('[data-proof="k1-risk-release-params"] .p').count()} 行参数`);

const adjust = card.locator("button", { hasText: "调整" });
await adjust.first().waitFor({ state: "visible", timeout: 30_000 });
step("写权限下「调整」按钮已渲染", await adjust.count() === 7, `${await adjust.count()} 个(应=7)`);

const warn = page.locator('[data-proof="k1-release-loosen-warning"]');

// ── 数值键·「调小才是放宽」族:观察窗口 ──
await card.locator(".p", { hasText: "观察窗口" }).locator("button", { hasText: "调整" }).click();
const numInput = page.locator('input[type="number"]').last();
await numInput.waitFor({ state: "visible", timeout: 15_000 });
step("调整弹窗已打开", true);
step("未改值时不显示告知", await warn.count() === 0);

await numInput.fill("100");                       // 窗口变长 = 收紧
await page.waitForTimeout(250);
step("观察窗口调大(收紧)不显示告知", await warn.count() === 0);

await numInput.fill("24");                        // 窗口变短 = 放宽
await warn.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
const text = (await warn.count()) ? (await warn.first().innerText()).replace(/\s+/g, " ") : "";
step("观察窗口调小(放宽)显示告知", (await warn.count()) === 1);
step("告知文案点明会核验覆盖率", text.includes("覆盖率"), text.slice(0, 50));
await page.screenshot({ path: OUT + "k1-loosen-warning.png" });

// ── 枚举键:释放模式 仅人工放行 → 允许在线证明 = 放宽 ──
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
await card.locator(".p", { hasText: "释放模式" }).locator("button", { hasText: "调整" }).click();
const sel = page.locator("select").last();
await sel.waitFor({ state: "visible", timeout: 15_000 });
await sel.selectOption("attest_or_manual");
await warn.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
step("释放模式改为允许在线证明放行 → 显示告知", (await warn.count()) === 1);

step("页面无 console error", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n走查 ${results.length - failed.length}/${results.length} 通过`);
if (failed.length) { console.error("🔴 未通过:\n" + failed.map((f) => `${f.n} ${f.d}`).join("\n")); process.exit(1); }
console.log("截图:" + OUT + "k1-loosen-warning.png");
