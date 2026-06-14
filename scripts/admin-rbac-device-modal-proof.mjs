// Runtime proof for SPEC-L2a03 RBAC and device destructive business modals.
// Proves business controls are usable and state persists after reload.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = process.env.ADMIN_BASE_URL || "http://localhost:3002";
const session = process.env.AGENT_BROWSER_SESSION || "nexion-rbac-device-modal-proof";
const STORE_KEY = "nexion-admin-platform-v1";
const results = [];

function quoteShellArg(arg) {
  const value = String(arg);
  if (process.platform === "win32") return `"${value.replace(/"/g, '\\"')}"`;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function run(args, options = {}) {
  const fullArgs = ["--session", session, ...args];
  const result =
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

function evalJson(body) {
  const helpers = `
    const text = (el) => (el?.innerText || el?.textContent || '').trim();
    const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    const controls = () => Array.from(document.querySelectorAll('input, textarea, select')).filter(visible);
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
    const byProof = (name) => {
      const el = document.querySelector('[data-proof="' + name + '"]');
      if (!el || !visible(el)) throw new Error('proof control not found: ' + name);
      return el;
    };
    const setProof = (name, value) => {
      const el = byProof(name);
      if (el.type === 'checkbox') {
        if (String(value) === 'true' && !el.checked) el.click();
        if (String(value) === 'false' && el.checked) el.click();
      } else {
        setNativeValue(el, value);
      }
      return { name, value };
    };
    const fillByLabel = (pattern, value) => {
      const re = new RegExp(pattern, 'i');
      const el = controls().find((node) => ['INPUT', 'TEXTAREA'].includes(node.tagName) && re.test(labelText(node)));
      if (!el) throw new Error('field not found: ' + pattern);
      setNativeValue(el, value);
      return { label: labelText(el).slice(0, 120), value };
    };
    const fillReason = (value) => {
      const el = controls().find((node) => node.tagName === 'TEXTAREA' && /操作理由/i.test(text(node.closest('.field'))))
        || controls().find((node) => node.tagName === 'TEXTAREA' && /操作理由|理由|工单|依据|reason|audit/i.test(labelText(node)));
      if (!el) throw new Error('reason textarea not found');
      setNativeValue(el, value);
      return { reason: value };
    };
    const clickInRow = (rowText, buttonText) => {
      const candidates = Array.from(document.querySelectorAll('tr, .rw, .task, .sku-card'))
        .filter((el) => text(el).includes(rowText) && Array.from(el.querySelectorAll('button')).some((button) => text(button) === buttonText))
        .sort((a, b) => text(a).length - text(b).length);
      const row = candidates[0];
      if (!row) throw new Error('row not found: ' + rowText + ' / ' + buttonText);
      const button = Array.from(row.querySelectorAll('button')).find((el) => text(el) === buttonText);
      button.scrollIntoView({ block: 'center', inline: 'center' });
      button.click();
      return { row: rowText, clicked: buttonText };
    };
    const confirmButton = () => Array.from(document.querySelectorAll('button')).reverse().find((button) => /确认执行|确认删除|确认创建账号/.test(text(button)) && visible(button));
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
    const persisted = () => JSON.parse(localStorage.getItem(${JSON.stringify(STORE_KEY)}) || '{"state":{}}').state || {};
  `;
  const encoded = Buffer.from(`JSON.stringify((() => { ${helpers}\n${body} })())`, "utf8").toString("base64");
  const raw = run(["eval", "-b", encoded], { timeout: 30000 });
  try {
    return JSON.parse(JSON.parse(raw));
  } catch {
    return JSON.parse(raw);
  }
}

function evalPageMeta() {
  const encoded = Buffer.from("JSON.stringify({ href: location.href, ready: document.readyState })", "utf8").toString("base64");
  const raw = run(["eval", "-b", encoded], { timeout: 15000 });
  try {
    return JSON.parse(JSON.parse(raw));
  } catch {
    return JSON.parse(raw);
  }
}

function wait(ms = 500) {
  run(["wait", String(ms)], { timeout: ms + 5000 });
}

function open(route) {
  const expected = `${BASE_URL}${route}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    run(["open", expected], { timeout: 60000 });
    wait(900 + attempt * 400);
    const meta = evalPageMeta();
    if (meta.href?.startsWith(expected)) return;
  }
  const meta = evalPageMeta();
  throw new Error(`route did not open: expected ${expected}, got ${meta.href || "unknown"}`);
}

function reopenAndRead(route) {
  open(route);
  return evalJson("return persisted();");
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

function auditHas(state, text) {
  return (state.audit || []).some((entry) => String(entry.action || "").includes(text));
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

open("/");
evalJson(`localStorage.removeItem(${JSON.stringify(STORE_KEY)}); return { cleared: true };`);

await step("change-role-persists", () => {
  open("/platform/rbac");
  evalJson(`clickInRow('op-041', '改角色'); return { opened: true };`);
  wait();
  const modal = evalJson(`
    const body = document.body.innerText;
    const role = byProof('role-select-target');
    const tier = byProof('role-select-tier');
    return {
      hasBusinessForm: !!document.querySelector('[data-business-form="role-select"]'),
      roleOptions: Array.from(role.options).map((option) => option.value),
      tierOptions: Array.from(tier.options).map((option) => option.value),
      hasGuard: body.includes('有效超管'),
    };
  `);
  expect(modal.hasBusinessForm, "role-select business form missing");
  expect(modal.roleOptions.includes("finance") && modal.roleOptions.includes("support"), "role options incomplete");
  expect(modal.tierOptions.includes("lead") && modal.tierOptions.includes("member"), "tier options incomplete");
  expect(modal.hasGuard, "effective superadmin preview missing");
  evalJson(`
    setProof('role-select-target', 'finance');
    setProof('role-select-tier', 'lead');
    fillReason('L2a03 change role proof ticket 2001');
    assertConfirmEnabled();
    submitConfirm();
    return { submitted: true };
  `);
  wait();
  const state = reopenAndRead("/platform/rbac");
  expectEqual(state.params?.["A.acct.op-041.role"], "finance", "role persisted");
  expectEqual(state.params?.["A.acct.op-041.tier"], "lead", "tier persisted");
  expect(auditHas(state, "变更角色 op-041"), "role audit missing");
  return { role: state.params["A.acct.op-041.role"], tier: state.params["A.acct.op-041.tier"] };
});

await step("permission-matrix-diff-persists", () => {
  open("/platform/rbac");
  evalJson(`clickInRow('文案/课程发布(I)', '改授权'); return { opened: true };`);
  wait();
  const before = evalJson(`
    const preview = byProof('permission-diff-preview').innerText;
    assertConfirmDisabled();
    return {
      hasBusinessForm: !!document.querySelector('[data-business-form="permission-matrix"]'),
      selectCount: document.querySelectorAll('[data-proof^="permission-grant-"]').length,
      preview,
    };
  `);
  expect(before.hasBusinessForm, "permission matrix business form missing");
  expect(before.selectCount >= 7, "permission matrix select count < 7");
  expect(before.preview.includes("尚未修改"), "no-diff disabled explanation missing");
  evalJson(`
    setProof('permission-grant-support', 'R');
    fillReason('L2a03 permission matrix proof ticket 2002');
    const preview = byProof('permission-diff-preview').innerText;
    if (!preview.includes('客服') || !preview.includes('→R')) throw new Error('diff preview missing support change: ' + preview);
    assertConfirmEnabled();
    submitConfirm();
    return { submitted: true, preview };
  `);
  wait();
  const state = reopenAndRead("/platform/rbac");
  expectEqual(state.params?.["A.rbac.support.content_publish"], "R", "permission persisted");
  expect(auditHas(state, "变更授权 文案/课程发布"), "permission audit missing");
  return { grant: state.params["A.rbac.support.content_publish"] };
});

await step("sku-delete-reason-persists", () => {
  open("/devices/pricing");
  evalJson(`clickInRow('NexionBox S1', '删除'); return { opened: true };`);
  wait();
  const modal = evalJson(`
    return {
      hasBusinessForm: !!document.querySelector('[data-business-form="destructive-reason"]'),
      hasRollback: !!document.querySelector('[data-proof="destructive-rollback"]'),
      hasAck: !!document.querySelector('[data-proof="destructive-ack"]'),
      targetVisible: document.body.innerText.includes('NexionBox S1'),
    };
  `);
  expect(modal.hasBusinessForm && modal.hasRollback && modal.hasAck, "SKU destructive business controls missing");
  expect(modal.targetVisible, "SKU target not visible");
  evalJson(`
    setProof('destructive-rollback', 'L2a03 SKU delete rollback: restore from SKU snapshot and reopen storefront entry.');
    setProof('destructive-ack', 'true');
    fillReason('L2a03 SKU delete proof ticket 2003');
    assertConfirmEnabled();
    submitConfirm();
    return { submitted: true };
  `);
  wait();
  const state = reopenAndRead("/devices/pricing");
  expect(!(state.skus || []).some((sku) => sku.name === "NexionBox S1"), "deleted SKU still persisted");
  expect(auditHas(state, "删除 SKU NexionBox S1"), "delete SKU audit missing");
  return { deleted: "NexionBox S1", skuCount: (state.skus || []).length };
});

await step("task-down-reason-persists", () => {
  open("/devices/tasks");
  evalJson(`clickInRow('LLM 推理 70B', '下架'); return { opened: true };`);
  wait();
  const modal = evalJson(`
    return {
      hasBusinessForm: !!document.querySelector('[data-business-form="destructive-reason"]'),
      hasRollback: !!document.querySelector('[data-proof="destructive-rollback"]'),
      hasAck: !!document.querySelector('[data-proof="destructive-ack"]'),
      targetVisible: document.body.innerText.includes('LLM 推理 70B'),
    };
  `);
  expect(modal.hasBusinessForm && modal.hasRollback && modal.hasAck, "task-down destructive business controls missing");
  expect(modal.targetVisible, "task target not visible");
  evalJson(`
    setProof('destructive-rollback', 'L2a03 task down rollback: recreate task from task engine snapshot after audit review.');
    setProof('destructive-ack', 'true');
    fillReason('L2a03 task down proof ticket 2004');
    assertConfirmEnabled();
    submitConfirm();
    return { submitted: true };
  `);
  wait();
  const state = reopenAndRead("/devices/tasks");
  expect(!(state.tasks || []).some((task) => task.n === "LLM 推理 70B"), "down task still persisted");
  expect(auditHas(state, "下架任务 LLM 推理 70B"), "task down audit missing");
  return { down: "LLM 推理 70B", taskCount: (state.tasks || []).length };
});

try {
  run(["close"], { timeout: 15000 });
} catch {}

const outFile = path.join(ROOT, "docs", "audit", "shards", "ad-02-ad-05-rbac-device-action-sample.ndjson");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(
  outFile,
  `${JSON.stringify({
    shardId: "AD-02+AD-05",
    source: "SPEC-L2a03-runtime-proof",
    side: "admin",
    routes: ["/platform/rbac", "/devices/pricing", "/devices/tasks"],
    status: "captured",
    result: {
      classification: "state-persisted",
      tasks: ["change-role", "permission-matrix", "sku-delete", "task-down"],
      noObservableChange: 0,
      businessIncompleteModal: 0,
    },
    evidence: {
      script: "scripts/admin-rbac-device-modal-proof.mjs",
      persistedKeys: [
        "A.acct.op-041.role",
        "A.acct.op-041.tier",
        "A.rbac.support.content_publish",
        "skus",
        "tasks",
      ],
      resultCount: results.length,
    },
    finishedAt: new Date().toISOString(),
  })}\n`,
  "utf8",
);

console.log(JSON.stringify({
  status: results.every((row) => row.status === "passed") ? "passed" : "failed",
  baseUrl: BASE_URL,
  session,
  results,
}, null, 2));
