// Runtime proof for SPEC-L2c01 C-domain 2FA disable persistence.
// It proves the C5 operation is not toast-only: the modal is actionable,
// writes both stores, persists after reload, and syncs to the 360 HUB.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = process.env.ADMIN_BASE_URL || "http://localhost:3002";
const session = process.env.AGENT_BROWSER_SESSION || "nexion-c-domain-security-proof";
const PLATFORM_KEY = "nexion-admin-platform-v1";
const USER_OPS_KEY = "nexion-admin-ops-v1";
const TARGET_USER_ID = "U-88421";
const results = [];

function quoteShellArg(arg) {
  const value = String(arg);
  if (process.platform === "win32") return `"${value.replace(/"/g, '\\"')}"`;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function isTransientAgentBrowserFailure(result) {
  const output = `${result.error?.message || ""}\n${result.stdout || ""}\n${result.stderr || ""}`;
  return /Failed to connect|ECONNREFUSED|actively refused|积极拒绝|daemon may be busy|busy or unresponsive/i.test(output);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function run(args, options = {}) {
  const fullArgs = ["--session", session, ...args];
  const attempts = options.retries ?? 3;
  let result;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result =
      process.platform === "win32"
        ? spawnSync(["agent-browser", ...fullArgs.map(quoteShellArg)].join(" "), [], {
            cwd: ROOT,
            encoding: "utf8",
            input: options.input,
            shell: true,
            timeout: options.timeout || 30000,
          })
        : spawnSync("agent-browser", fullArgs, {
            cwd: ROOT,
            encoding: "utf8",
            input: options.input,
            timeout: options.timeout || 30000,
          });
    if (result.status === 0 || !isTransientAgentBrowserFailure(result) || attempt === attempts) break;
    sleepSync(500 * attempt);
  }
  if (result.status !== 0) {
    throw new Error(
      `agent-browser ${args.join(" ")} failed` +
        `\nstatus=${result.status}` +
        `\nerror=${result.error?.message || ""}` +
        `\nstdout=${result.stdout || ""}` +
        `\nstderr=${result.stderr || ""}`,
    );
  }
  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

function evalJson(body) {
  const helpers = `
    const text = (el) => (el?.innerText || el?.textContent || '').trim();
    const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    const controls = (root = document) => Array.from(root.querySelectorAll('input, textarea, select')).filter(visible);
    const labelText = (el) => {
      const id = el.getAttribute('id') || '';
      const explicit = id ? text(document.querySelector('label[for="' + CSS.escape(id) + '"]')) : '';
      const wrap = text(el.closest('label'));
      const field = text(el.closest('.field'));
      const parent = text(el.parentElement);
      return [explicit, wrap, field, parent, el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('name'), el.value].filter(Boolean).join(' ');
    };
    const setNativeValue = (el, value) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const clickExact = (wanted) => {
      const button = Array.from(document.querySelectorAll('button')).find((el) => text(el) === wanted && visible(el));
      if (!button) throw new Error('button not found: ' + wanted);
      button.scrollIntoView({ block: 'center', inline: 'center' });
      button.click();
      return { clicked: wanted };
    };
    const dialog = () => {
      const candidates = Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"],.modal,.drawer,.modal-scrim,.drawer-scrim'))
        .filter(visible)
        .sort((a, b) => text(b).length - text(a).length);
      const modal = candidates.find((el) => /确认执行|操作理由|人工关闭 2FA/.test(text(el))) || candidates[0];
      if (!modal) throw new Error('dialog not found');
      return modal;
    };
    const confirmButton = () => Array.from(document.querySelectorAll('button')).reverse().find((button) => /确认执行/.test(text(button)) && visible(button));
    const fillReason = (value) => {
      const root = dialog();
      const el = controls(root).find((node) => node.tagName === 'TEXTAREA' && /操作理由/i.test(text(node.closest('.field'))))
        || controls(root).find((node) => node.tagName === 'TEXTAREA' && /操作理由|理由|工单|依据|reason|audit/i.test(labelText(node)));
      if (!el) throw new Error('reason textarea not found');
      setNativeValue(el, value);
      return { reason: value };
    };
    const assertConfirmDisabled = () => {
      const button = confirmButton();
      if (!button) throw new Error('confirm button not found');
      if (!button.disabled && button.getAttribute('aria-disabled') !== 'true') throw new Error('confirm button should be disabled: ' + text(button));
      return { confirm: text(button), disabled: true };
    };
    const assertConfirmEnabled = () => {
      const button = confirmButton();
      if (!button) throw new Error('confirm button not found');
      if (button.disabled || button.getAttribute('aria-disabled') === 'true') throw new Error('confirm button disabled: ' + text(button));
      return { confirm: text(button), disabled: false };
    };
    const submitConfirm = () => {
      const button = confirmButton();
      if (!button) throw new Error('confirm button not found');
      if (button.disabled || button.getAttribute('aria-disabled') === 'true') throw new Error('confirm button disabled before submit');
      button.click();
      return { submitted: text(button) };
    };
    const persisted = (key) => JSON.parse(localStorage.getItem(key) || '{"state":{}}').state || {};
  `;
  const encoded = Buffer.from(`JSON.stringify((() => { ${helpers}\n${body} })())`, "utf8").toString("base64");
  const raw = run(["eval", "-b", encoded], { timeout: 30000 });
  try {
    return JSON.parse(JSON.parse(raw));
  } catch {
    return JSON.parse(raw);
  }
}

function wait(ms = 600) {
  run(["wait", String(ms)], { timeout: ms + 5000 });
}

function open(route) {
  const expected = `${BASE_URL}${route}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    run(["open", expected], { timeout: 60000 });
    wait(900 + attempt * 400);
    const meta = evalJson("return { href: location.href, ready: document.readyState, title: document.title };");
    if (meta.href?.startsWith(expected) && meta.ready !== "loading") return meta;
  }
  const meta = evalJson("return { href: location.href, ready: document.readyState, title: document.title };");
  throw new Error(`route did not open: expected ${expected}, got ${meta.href || "unknown"}`);
}

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function step(name, fn) {
  try {
    const evidence = await fn();
    results.push({ name, status: "passed", evidence });
  } catch (error) {
    results.push({ name, status: "failed", error: error.message });
    throw error;
  }
}

function queryTargetUser() {
  return evalJson(`
    const inputs = controls();
    const lookup = inputs.find((el) => el.value === 'usr_2231')
      || inputs.find((el) => text(el.closest('.lookup')).includes('查询'))
      || inputs.find((el) => /usr_|U-/.test(String(el.value || '')));
    if (!lookup) throw new Error('C5 user lookup input not found');
    setNativeValue(lookup, ${JSON.stringify(TARGET_USER_ID)});
    clickExact('查询');
    return { queried: ${JSON.stringify(TARGET_USER_ID)}, inputLabel: labelText(lookup).slice(0, 120) };
  `);
}

try {
  run(["close"], { timeout: 15000 });
} catch {}

open("/");
evalJson(`
  localStorage.removeItem(${JSON.stringify(PLATFORM_KEY)});
  localStorage.removeItem(${JSON.stringify(USER_OPS_KEY)});
  return { cleared: [${JSON.stringify(PLATFORM_KEY)}, ${JSON.stringify(USER_OPS_KEY)}] };
`);

await step("c5-query-target-user", () => {
  open("/users/security");
  const queried = queryTargetUser();
  wait();
  const state = evalJson(`
    const body = document.body.innerText;
    return {
      queried: ${JSON.stringify(TARGET_USER_ID)},
      hasTargetHeader: body.includes('单用户安全处置 · ${TARGET_USER_ID}'),
      hasInitial2faOn: body.includes('2FA 状态') && body.includes('已开启(TOTP)'),
      bodyPreview: body.slice(0, 260),
    };
  `);
  expect(state.hasTargetHeader, "C5 did not switch to target user");
  expect(state.hasInitial2faOn, "initial C5 2FA-on state missing");
  return { ...queried, ...state };
});

await step("disable-2fa-modal-has-business-controls", () => {
  evalJson(`clickExact('关闭 2FA(操作确认 + 实名二验)'); return { opened: true };`);
  wait();
  const modal = evalJson(`
    const root = dialog();
    const dialogText = text(root);
    const visibleControls = controls(root).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      label: labelText(el),
      value: el.value || '',
    }));
    const badCredentialInput = visibleControls.find((control) =>
      /密码|password|验证码|verification|totp|secret|code|备份码/i.test(control.label)
      && !/操作理由|理由|工单|依据|reason|audit|回滚/i.test(control.label)
    );
    assertConfirmDisabled();
    return {
      titleOk: dialogText.includes('人工关闭 2FA'),
      hasRealNameStepText: dialogText.includes('实名二验'),
      hasSecuritySummary: dialogText.includes('用户登录') && dialogText.includes('降低安全门槛'),
      wrongEmergencySummary: dialogText.includes('地区访问') || dialogText.includes('影响国家/业务'),
      hasReasonTextarea: visibleControls.some((control) => control.tag === 'textarea' && /操作理由|理由|工单|依据|reason/i.test(control.label)),
      badCredentialInput,
      controlCount: visibleControls.length,
      controls: visibleControls,
      dialogPreview: dialogText.slice(0, 500),
    };
  `);
  expect(modal.titleOk, "2FA disable modal title missing");
  expect(modal.hasRealNameStepText, "real-name step-up business text missing");
  expect(modal.hasSecuritySummary, "2FA modal did not use account-security summary");
  expect(!modal.wrongEmergencySummary, "2FA modal used unrelated emergency/geo summary");
  expect(modal.hasReasonTextarea, "operation reason textarea missing");
  expect(!modal.badCredentialInput, `credential input should not exist: ${JSON.stringify(modal.badCredentialInput)}`);
  return modal;
});

await step("disable-2fa-persists-and-survives-refresh", () => {
  evalJson(`
    fillReason('L2c01 runtime proof disable ${TARGET_USER_ID} 2FA after real-name step-up ticket C5-2001');
    assertConfirmEnabled();
    submitConfirm();
    return { submitted: true };
  `);
  wait(900);
  open("/users/security");
  queryTargetUser();
  wait();
  const state = evalJson(`
    const platform = persisted(${JSON.stringify(PLATFORM_KEY)});
    const ops = persisted(${JSON.stringify(USER_OPS_KEY)});
    const userOps = ops.users?.[${JSON.stringify(TARGET_USER_ID)}] || {};
    const body = document.body.innerText;
    return {
      c5ShowsOff: body.includes('2FA 状态') && body.includes('已关闭(人工)'),
      platformValue: platform.params?.['C.twofa.${TARGET_USER_ID}'],
      platformAuditHit: (platform.audit || []).some((entry) =>
        String(entry.action || '').includes('人工关闭 2FA ${TARGET_USER_ID}') &&
        String(entry.reason || '').includes('L2c01 runtime proof')
      ),
      twoFactorReset: userOps.twoFactorReset === true,
      userOpsAuditHit: (userOps.audit || []).some((entry) => String(entry.action || '').includes('重置 2FA')),
      userOpsAudit: (userOps.audit || []).slice(0, 3),
    };
  `);
  expect(state.c5ShowsOff, "C5 does not show disabled 2FA after reload");
  expectEqual(state.platformValue, "disabled", "platform C.twofa persisted value");
  expect(state.platformAuditHit, "platform audit entry missing");
  expect(state.twoFactorReset, "user ops twoFactorReset missing");
  expect(state.userOpsAuditHit, "user ops audit entry missing");
  return state;
});

await step("hub-360-reflects-twofactor-reset", () => {
  open(`/users/search/${TARGET_USER_ID}`);
  wait(1200);
  const hub = evalJson(`
    const body = document.body.innerText;
    return {
      hasAccountCard: body.includes('账户·安全·合规卡'),
      hasPendingReset: body.includes('待重设(运营已重置)') || body.includes('待重设'),
      bodyPreview: body.slice(0, 500),
    };
  `);
  expect(hub.hasAccountCard, "360 HUB account/security card missing");
  expect(hub.hasPendingReset, "360 HUB does not reflect pending 2FA reset");
  return hub;
});

try {
  run(["close"], { timeout: 15000 });
} catch {}

const outFile = path.join(ROOT, "docs", "audit", "shards", "c-domain-security-2fa-proof.ndjson");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(
  outFile,
  `${JSON.stringify({
    shardId: "INIT-004",
    source: "SPEC-L2c01-runtime-proof",
    side: "admin",
    routes: ["/users/security", `/users/search/${TARGET_USER_ID}`],
    targetUserId: TARGET_USER_ID,
    status: "captured",
    result: {
      classification: "state-persisted-cross-surface",
      noObservableChange: 0,
      businessIncompleteModal: 0,
      persistedKeys: [`C.twofa.${TARGET_USER_ID}`, `${USER_OPS_KEY}.users.${TARGET_USER_ID}.twoFactorReset`],
    },
    evidence: {
      script: "scripts/admin-c-domain-security-proof.mjs",
      resultCount: results.length,
      modalAssertion: "reason textarea present; credential/password/code inputs absent",
      hubAssertion: `/users/search/${TARGET_USER_ID} shows pending 2FA reset`,
    },
    finishedAt: new Date().toISOString(),
  })}\n`,
  "utf8",
);

console.log(JSON.stringify({
  status: results.every((row) => row.status === "passed") ? "passed" : "failed",
  baseUrl: BASE_URL,
  session,
  targetUserId: TARGET_USER_ID,
  results,
}, null, 2));
