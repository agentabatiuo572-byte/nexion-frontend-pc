// Runtime proof for remaining Source C feature-mapping walkthrough rows.
// It proves business operations, not just route existence or decorative modals.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UNI_BASE_URL = process.env.UNI_BASE_URL || "http://localhost:5173";
const ADMIN_BASE_URL = process.env.ADMIN_BASE_URL || process.env.ADMIN_BASE || "http://localhost:3002";
const session = process.env.AGENT_BROWSER_SESSION || `nexion-feature-map-walkthrough-${Date.now()}-${process.pid}`;
const OUT_FILE = path.join(ROOT, "docs", "audit", "shards", "feature-mapping-walkthrough-proof.ndjson");
const ADMIN_STORE_KEY = "nexion-admin-platform-v1";
const results = [];

function quoteShellArg(arg) {
  const value = String(arg);
  if (process.platform === "win32") return `"${value.replace(/"/g, '\\"')}"`;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function run(args, options = {}) {
  const fullArgs = ["--session", session, ...args];
  const agentBrowserBin = process.env.AGENT_BROWSER_BIN || "agent-browser";
  const result =
    process.platform === "win32"
      ? spawnSync([agentBrowserBin, ...fullArgs.map(quoteShellArg)].join(" "), [], {
          cwd: ROOT,
          encoding: "utf8",
          input: options.input,
          shell: true,
          timeout: options.timeout || 30000,
        })
      : spawnSync(agentBrowserBin, fullArgs, {
          cwd: ROOT,
          encoding: "utf8",
          input: options.input,
          timeout: options.timeout || 30000,
        });
  if (result.status !== 0) {
    throw new Error(
      `agent-browser ${args.join(" ")} failed` +
        `\nstatus=${result.status}` +
        `\nstdout=${result.stdout || ""}` +
        `\nstderr=${result.stderr || ""}`,
    );
  }
  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

function evalJson(body, timeout = 30000) {
  const helpers = `
    const text = (el) => (el?.innerText || el?.textContent || '').trim();
    const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    const bodyText = () => document.body.innerText || '';
    const current = () => ({ href: location.href, body: bodyText() });
    const expect = (condition, label) => {
      if (!condition) throw new Error(label);
    };
    const setNativeValue = (el, value) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new CustomEvent('input', { bubbles: true, detail: { value } }));
      el.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { value } }));
    };
    const clickCss = (selector) => {
      const el = document.querySelector(selector);
      if (!el || !visible(el)) throw new Error('selector not visible: ' + selector);
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.click();
      return { clicked: selector, text: text(el), className: String(el.className || '') };
    };
    const clickExactButton = (wanted, index = 0) => {
      const matches = Array.from(document.querySelectorAll('button,[role="button"],a,uni-view'))
        .filter((el) => text(el) === wanted && visible(el));
      const el = matches[index];
      if (!el) throw new Error('click target not found: ' + wanted + ' index=' + index + ' count=' + matches.length);
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.click();
      return { clicked: wanted, index, count: matches.length, text: text(el) };
    };
    const dialog = () => {
      const candidates = Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"],.modal,.drawer,.modal-scrim,.drawer-scrim,.nx-sheet-panel'))
        .filter(visible)
        .sort((a, b) => text(b).length - text(a).length);
      return candidates[0] || null;
    };
    const fillDialogInput = (value) => {
      const root = dialog();
      if (!root) throw new Error('dialog not found for target value');
      const el = Array.from(root.querySelectorAll('input')).find(visible);
      if (!el) throw new Error('target value input not found');
      setNativeValue(el, value);
      return { value };
    };
    const fillDialogReason = (value) => {
      const root = dialog();
      if (!root) throw new Error('dialog not found for reason');
      const el = Array.from(root.querySelectorAll('textarea')).find(visible);
      if (!el) throw new Error('reason textarea not found');
      setNativeValue(el, value);
      return { value };
    };
    const confirmDialog = () => {
      const btn = Array.from(document.querySelectorAll('button')).reverse().find((el) => /确认执行/.test(text(el)) && visible(el));
      if (!btn) throw new Error('confirm button not found');
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') throw new Error('confirm button disabled');
      btn.click();
      return { clicked: text(btn) };
    };
    const store = (key) => {
      if (typeof uni !== 'undefined' && uni.getStorageSync) return uni.getStorageSync(key);
      try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return localStorage.getItem(key); }
    };
    const persistedAdmin = () => JSON.parse(localStorage.getItem(${JSON.stringify(ADMIN_STORE_KEY)}) || '{"state":{}}').state || {};
    const clearNexionStorage = () => {
      for (const storage of [localStorage, sessionStorage]) {
        for (const key of Object.keys(storage)) {
          if (/^nexion-/i.test(key)) storage.removeItem(key);
        }
      }
      return {
        localKeys: Object.keys(localStorage).filter((key) => /^nexion-/i.test(key)),
        sessionKeys: Object.keys(sessionStorage).filter((key) => /^nexion-/i.test(key)),
      };
    };
  `;
  const encoded = Buffer.from(`JSON.stringify((() => { ${helpers}\n${body} })())`, "utf8").toString("base64");
  const raw = run(["eval", "-b", encoded], { timeout });
  try {
    return JSON.parse(JSON.parse(raw));
  } catch {
    return JSON.parse(raw);
  }
}

function wait(ms = 500) {
  run(["wait", String(ms)], { timeout: ms + 5000 });
}

function waitForEval(label, body, timeout = 10000, interval = 400) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = evalJson(body, Math.min(15000, timeout));
      if (last?.ok) return last;
    } catch (error) {
      last = error.message;
    }
    wait(interval);
  }
  throw new Error(`${label} did not become true within ${timeout}ms; last=${JSON.stringify(last)}`);
}

function openUrl(url) {
  run(["open", url], { timeout: 60000 });
  wait(900);
  const state = evalJson("return current();", 15000);
  if (!String(state.href || "").startsWith(url)) {
    throw new Error(`route did not open: expected ${url}, got ${state.href || "unknown"}`);
  }
  return state;
}

function openUni(hashRoute) {
  return openUrl(`${UNI_BASE_URL}${hashRoute}`);
}

function openAdmin(route) {
  return openUrl(`${ADMIN_BASE_URL}${route}`);
}

function clickSelector(selector) {
  run(["scrollintoview", selector], { timeout: 30000 });
  run(["click", selector], { timeout: 30000 });
  wait(300);
}

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

async function step(id, name, fn) {
  const startedAt = new Date().toISOString();
  try {
    const evidence = await fn();
    const row = { id, name, status: "passed", evidence, startedAt, finishedAt: new Date().toISOString() };
    results.push(row);
    return row;
  } catch (error) {
    const row = { id, name, status: "failed", error: error.message, startedAt, finishedAt: new Date().toISOString() };
    results.push(row);
    throw error;
  }
}

try {
  run(["close"], { timeout: 15000 });
} catch {}

openUni("/#/pages/onboarding/intro");
evalJson("clearNexionStorage(); location.reload(); return { cleared: true };");
wait(900);

await step("FM-004", "top-up-channel-and-kyc-express-status", () => {
  openUni("/#/pages/me/wallet-topup");
  clickSelector(".nx-topup-channel-usdt-trc20");
  const channel = evalJson(`
    const body = bodyText();
    expect(body.includes('Send via USDT-TRC20'), 'regular top-up channel status missing');
    expect(body.includes('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'), 'regular top-up deposit address missing');
    clickCss('.nx-topup-copy-address-cta');
    return { href: location.href, hasAwaiting: body.includes('Awaiting confirmation'), addressVisible: body.includes('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t') };
  `);

  openUni("/#/pages/me/wallet-topup?kyc=1");
  const select = evalJson(`
    const body = bodyText();
    expect(body.includes('KYC-Express'), 'KYC-Express entry missing');
    expect(body.includes('Compliance check'), 'compliance banner missing');
    return current();
  `);
  clickSelector(".nx-kyc-generate-address-cta");
  const awaiting = evalJson(`
    const body = bodyText();
    expect(body.includes('Send $1.00 via USDT-TRC20'), 'KYC awaiting status missing');
    expect(body.includes('1.00 USDT'), 'KYC exact amount missing');
    expect(body.includes('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'), 'KYC deposit address missing');
    clickCss('.nx-kyc-copy-address-cta');
    return { href: location.href, hasExactAmount: body.includes('1.00 USDT') };
  `);
  clickSelector(".nx-kyc-payment-sent-cta");
  const complete = waitForEval("KYC Express complete", `
    const pairing = store('nexion-wallet-pairing-v1') || {};
    const bills = store('nexion-bills-v1') || {};
    const bill = (bills.bills || []).find((row) => row.type === 'kyc' && row.amount === 1 && row.status === 'posted');
    const body = bodyText();
    return {
      href: location.href,
      body,
      pairing,
      bill,
      ok: pairing.walletPaired === true && !!bill && body.includes('Wallet paired') && body.includes('Continue to withdrawal'),
    };
  `, 10000);
  expect(complete.pairing.pairedNetwork === "USDT-TRC20", "KYC paired network mismatch");
  expect(/^KYC-\d{4}-A\d+/.test(complete.pairing.complianceCheckId || ""), "KYC compliance id missing");
  return {
    regularChannel: channel,
    kycSelectHasBanner: select.body.includes("Compliance check"),
    awaiting,
    complianceCheckId: complete.pairing.complianceCheckId,
    kycBillRef: complete.bill.ref,
  };
});

await step("FM-005-FRONT", "staking-user-opens-position", () => {
  openUni("/#/pages/onboarding/intro");
  evalJson("clearNexionStorage(); location.reload(); return { cleared: true };");
  wait(900);
  openUni("/#/pages/staking/staking");
  const before = evalJson(`
    const staking = store('nexion-v3-staking-v1') || {};
    const bills = store('nexion-bills-v1') || {};
    return {
      href: location.href,
      body: bodyText(),
      positionsBefore: (staking.positions || []).length,
      billCountBefore: (bills.bills || []).length,
    };
  `);
  expect(before.body.includes("Stake plans"), "staking plans section missing");
  clickSelector(".nx-staking-vault-row-30");
  const sheet = evalJson(`
    const body = bodyText();
    const input = document.querySelector('.nx-staking-sheet-amount-input input') || document.querySelector('.nx-staking-sheet-amount-input');
    expect(body.includes('Stake 30-day') || body.includes('30-day'), 'staking sheet title missing 30d business context');
    expect(!!input && visible(input), 'staking sheet amount input missing');
    expect(!!document.querySelector('.nx-staking-sheet-submit-cta'), 'staking sheet submit CTA missing');
    return { body, amountValue: input.value || text(input) };
  `);
  clickSelector(".nx-staking-sheet-submit-cta");
  const proof = waitForEval("staking position persisted", `
    const staking = store('nexion-v3-staking-v1') || {};
    const bills = store('nexion-bills-v1') || {};
    const position = (staking.positions || []).find((row) => row.amountUSDT === 100 && row.termDays === 30 && row.status === 'active');
    const bill = (bills.bills || []).find((row) => row.type === 'stake' && row.amount === -100 && /30d/.test(row.memo || ''));
    const body = bodyText();
    return {
      href: location.href,
      body,
      position,
      bill,
      positionCount: (staking.positions || []).length,
      ok: !!position && !!bill && body.includes('Positions') && /\\$100(\\.00)?/.test(body),
    };
  `, 9000);
  return {
    before,
    sheetHasProjection: sheet.body.includes("Total on unlock"),
    positionId: proof.position.id,
    billRef: proof.bill.ref,
    positionCount: proof.positionCount,
  };
});

await step("FM-008", "unilevel-filter-and-how-route", () => {
  openUni("/#/pages/team/unilevel");
  const all = evalJson(`
    const rows = Array.from(document.querySelectorAll('.nx-unilevel-member-row')).map(text);
    const body = bodyText();
    expect(body.includes('Direct Royalty'), 'direct royalty card missing');
    expect(body.includes('Network Yield Bonus'), 'network yield card missing');
    expect(rows.length > 0, 'unilevel member rows missing');
    return { href: location.href, rowCount: rows.length, body };
  `);
  clickSelector(".nx-unilevel-filter-direct");
  const direct = evalJson(`
    const rows = Array.from(document.querySelectorAll('.nx-unilevel-member-row')).map(text);
    expect(rows.length > 0, 'direct rows missing');
    expect(rows.every((row) => row.toUpperCase().includes('DIRECT')), 'direct filter includes non-direct row: ' + rows.join(' | '));
    return { rowCount: rows.length, rows: rows.slice(0, 3), body: bodyText() };
  `);
  clickSelector(".nx-unilevel-filter-extended");
  const extended = evalJson(`
    const rows = Array.from(document.querySelectorAll('.nx-unilevel-member-row')).map(text);
    expect(rows.length > 0, 'extended rows missing');
    expect(rows.every((row) => row.toUpperCase().includes('EXTENDED')), 'extended filter includes non-extended row: ' + rows.join(' | '));
    return { rowCount: rows.length, rows: rows.slice(0, 3), body: bodyText() };
  `);
  clickSelector(".nx-unilevel-how-link");
  wait(500);
  const how = evalJson(`
    const body = bodyText();
    return {
      href: location.href,
      body,
      ok: location.href.includes('/#/pages/team/unilevel-how') && (body.includes('Influence Network') || body.includes('Network Royalty')),
    };
  `);
  expect(how.ok, `unilevel how route failed: ${how.href}`);
  return { allRows: all.rowCount, directRows: direct.rowCount, extendedRows: extended.rowCount, howHref: how.href };
});

await step("FM-013", "language-switch-changes-copy-across-routes", () => {
  openUni("/#/pages/me/language");
  clickSelector(".nx-language-row-zh");
  const locale = evalJson(`
    const locale = store('nexion-locale-v1') || {};
    const body = bodyText();
    return { href: location.href, locale, hasChineseTitle: body.includes('语言') };
  `);
  expect(locale.locale.code === "zh" && locale.locale.userSet === true, "locale zh not persisted");
  openUni("/#/pages/me/wallet-topup");
  const topup = evalJson("return { body: bodyText(), href: location.href };");
  expect(topup.body.includes("充值入金") || topup.body.includes("充值"), "top-up page did not render zh copy after language switch");
  openUni("/#/pages/staking/staking");
  const staking = evalJson("return { body: bodyText(), href: location.href };");
  expect(staking.body.includes("质押方案"), "staking page did not render zh copy after language switch");
  openUni("/#/pages/team/unilevel");
  const unilevel = evalJson("return { body: bodyText(), href: location.href };");
  expect(unilevel.body.includes("直推"), "unilevel page did not render zh filter copy after language switch");
  return {
    locale: locale.locale,
    routesChecked: [topup.href, staking.href, unilevel.href],
    copyNeedles: ["充值入金/充值", "质押方案", "直推"],
  };
});

openAdmin("/");
evalJson(`localStorage.removeItem(${JSON.stringify(ADMIN_STORE_KEY)}); return { clearedAdminStore: true };`);
wait(600);

await step("FM-005-ADMIN", "admin-staking-config-writes-param-and-audit", () => {
  openAdmin("/finance-products/staking");
  const initial = evalJson(`
    const body = bodyText();
    expect(body.includes('USDT 锁仓池'), 'G1 USDT pool missing');
    expect(body.includes('Position 状态机与监控'), 'G1 position monitor missing');
    clickExactButton('调', 0);
    return { href: location.href, body };
  `);
  const modal = evalJson(`
    const root = dialog();
    expect(!!root, 'staking APY modal missing');
    const modalText = text(root);
    expect(modalText.includes('Staking APY 调整'), 'staking modal missing business action title');
    expect(modalText.includes('目标新值'), 'staking modal missing target-value input label');
    expect(modalText.includes('操作理由'), 'staking modal missing reason textarea');
    fillDialogInput('13%');
    fillDialogReason('SPEC L3c03 runtime proof staking APY');
    confirmDialog();
    return { modalText };
  `);
  wait(700);
  const persisted = evalJson(`
    const state = persistedAdmin();
    const params = state.params || {};
    const audit = state.audit || [];
    const entry = audit.find((row) => row.target === 'G.staking.apy.usdt30d' && row.after === '13%');
    return { params, auditEntry: entry, body: bodyText() };
  `);
  expect(persisted.params["G.staking.apy.usdt30d"] === "13%", "staking APY param did not persist");
  expect(!!persisted.auditEntry && /runtime proof/.test(persisted.auditEntry.reason || ""), "staking APY audit entry missing proof reason");
  openAdmin("/finance-products/staking");
  const reopened = evalJson("return { body: bodyText(), href: location.href };");
  expect(reopened.body.includes("13%"), "staking APY persisted value not rendered after reopen");
  return {
    initialHref: initial.href,
    modalHasBusinessControls: modal.modalText.includes("目标新值") && modal.modalText.includes("操作理由"),
    persistedKey: "G.staking.apy.usdt30d",
    auditId: persisted.auditEntry.id,
    reopenedHref: reopened.href,
  };
});

await step("FM-016-FRONT", "frontend-staking-module-visible-and-actionable", () => {
  openUni("/#/pages/staking/staking");
  const opened = evalJson(`
    const body = bodyText();
    expect(body.includes('Stake plans') || body.includes('质押方案'), 'staking module copy missing');
    expect(!!document.querySelector('.nx-staking-vault-row-30'), '30d staking module row missing');
    clickCss('.nx-staking-vault-row-30');
    return { href: location.href, body };
  `);
  const sheet = waitForEval("staking module action sheet", `
    const root = dialog();
    const modalText = root ? text(root) : '';
    return {
      ok: !!root && (modalText.includes('Stake 30-day') || modalText.includes('30-day') || modalText.includes('30 天')),
      modalText,
    };
  `, 8000);
  return {
    href: opened.href,
    moduleRow: "nx-staking-vault-row-30",
    actionSheetVisible: true,
    sheetHasBusinessAction: /Stake|质押|Lock|30/.test(sheet.modalText),
  };
});

await step("FM-016", "params-registry-to-owner-module-switch", () => {
  openAdmin("/platform/params-registry");
  const registry = evalJson(`
    const body = bodyText();
    expect(body.includes('平台参数寄存器'), 'params registry title missing');
    expect(body.includes('回源真值'), 'params registry source-of-truth copy missing');
    expect(body.includes('操作确认'), 'params registry operation-confirm flag missing');
    const links = Array.from(document.querySelectorAll('a')).filter((a) => text(a).includes('G1 Staking') && a.getAttribute('href') === '/finance-products/staking');
    expect(links.length > 0, 'G1 Staking owner link missing from params registry');
    links[0].scrollIntoView({ block: 'center', inline: 'center' });
    links[0].click();
    return { href: location.href, linkCount: links.length, registryLength: body.length };
  `);
  const owner = waitForEval("params registry owner navigation", `
    return {
      href: location.href,
      body: bodyText(),
      ok: location.href.includes('/finance-products/staking') && bodyText().includes('Staking 池配置'),
    };
  `, 8000);
  evalJson(`
    return clickExactButton('停售', 0);
  `);
  const opened = waitForEval("staking module switch modal", `
    const root = dialog();
    if (!root) return { ok: false, reason: 'module switch modal missing' };
    const modalText = text(root);
    return {
      ok: modalText.includes('停售档位') && modalText.includes('停售只停新锁'),
      modalText,
    };
  `, 8000);
  evalJson(`
    fillDialogReason('SPEC L3c03 runtime proof staking module switch');
    confirmDialog();
  `);
  wait(700);
  const persisted = evalJson(`
    const state = persistedAdmin();
    const params = state.params || {};
    const audit = state.audit || [];
    const entry = audit.find((row) => row.target === 'G.staking.enabled.usdt30d' && row.after === 'false');
    return { params, auditEntry: entry, body: bodyText() };
  `);
  expect(persisted.params["G.staking.enabled.usdt30d"] === "false", "staking module switch param did not persist");
  expect(!!persisted.auditEntry && /module switch/.test(persisted.auditEntry.reason || ""), "staking module switch audit entry missing proof reason");
  openAdmin("/finance-products/staking");
  const reopened = evalJson("return { body: bodyText(), href: location.href };");
  expect(reopened.body.includes("已停售"), "module switch state not rendered after reopen");
  return {
    registry,
    ownerHref: owner.href,
    modalHasBusinessImpact: opened.modalText.includes("停售只停新锁"),
    persistedKey: "G.staking.enabled.usdt30d",
    auditId: persisted.auditEntry.id,
    reopenedHref: reopened.href,
  };
});

try {
  run(["close"], { timeout: 15000 });
} catch {}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(
  OUT_FILE,
  results
    .map((row) =>
      JSON.stringify({
        shardId: "FEATURE-MAPPING-WALKTHROUGH",
        source: "SPEC-L3c03-runtime-proof",
        side: row.id.endsWith("ADMIN") || row.id === "FM-016" ? "admin" : "uniapp",
        ...row,
      }),
    )
    .join("\n") + "\n",
  "utf8",
);

console.log(JSON.stringify({
  status: results.every((row) => row.status === "passed") ? "passed" : "failed",
  adminBaseUrl: ADMIN_BASE_URL,
  uniBaseUrl: UNI_BASE_URL,
  session,
  outFile: path.relative(ROOT, OUT_FILE).replace(/\\/g, "/"),
  results,
}, null, 2));
