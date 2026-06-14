// Runtime proof for SPEC-L2a01 business-form modal contract.
// Uses the same agent-browser harness as remediation-runtime-action-sample.mjs.
import { spawnSync } from "node:child_process";

const BASE_URL = process.env.ADMIN_BASE_URL || "http://localhost:3002";
const session = process.env.AGENT_BROWSER_SESSION || "nexion-modal-contract-proof";
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
          encoding: "utf8",
          input: options.input,
          shell: true,
          timeout: options.timeout || 30000,
        })
      : spawnSync("agent-browser", fullArgs, {
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
    const fillByLabel = (pattern, value) => {
      const re = new RegExp(pattern, 'i');
      const el = controls().find((node) => ['INPUT', 'TEXTAREA'].includes(node.tagName) && re.test(labelText(node)));
      if (!el) throw new Error('field not found: ' + pattern);
      setNativeValue(el, value);
      return { label: labelText(el).slice(0, 120), value };
    };
    const selectByLabel = (pattern, value) => {
      const re = new RegExp(pattern, 'i');
      const el = controls().find((node) => node.tagName === 'SELECT' && re.test(labelText(node)));
      if (!el) throw new Error('select not found: ' + pattern);
      setNativeValue(el, value);
      return { label: labelText(el).slice(0, 120), value };
    };
    const checkByLabel = (pattern) => {
      const re = new RegExp(pattern, 'i');
      const el = controls().find((node) => node.tagName === 'INPUT' && node.type === 'checkbox' && re.test(labelText(node)));
      if (!el) throw new Error('checkbox not found: ' + pattern);
      if (!el.checked) el.click();
      return { label: labelText(el).slice(0, 120), checked: el.checked };
    };
    const clickExact = (wanted) => {
      const el = Array.from(document.querySelectorAll('button')).find((button) => text(button) === wanted && visible(button));
      if (!el) throw new Error('button not found: ' + wanted);
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.click();
      return { clicked: wanted };
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
    const fillReason = (value) => {
      const el = controls().find((node) => node.tagName === 'TEXTAREA' && /操作理由|理由|工单|依据|reason|audit/i.test(labelText(node)));
      if (!el) throw new Error('reason textarea not found');
      setNativeValue(el, value);
      return { reason: value };
    };
    const confirmButton = () => Array.from(document.querySelectorAll('button')).reverse().find((button) => /确认执行|确认创建账号/.test(text(button)) && visible(button));
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

function wait(ms = 400) {
  run(["wait", String(ms)], { timeout: ms + 5000 });
}

function open(route) {
  run(["open", `${BASE_URL}${route}`], { timeout: 60000 });
  wait(600);
}

function reloadAndRead() {
  run(["reload"], { timeout: 60000 });
  wait(600);
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

await step("role-select", () => {
  open("/platform/rbac");
  evalJson(`clickInRow('op-041', '改角色'); return { opened: true };`);
  wait();
  evalJson(`
    selectByLabel('目标角色|role', 'support');
    selectByLabel('层级|tier', 'lead');
    fillReason('L2a01 role-select proof ticket 1001');
    assertConfirmEnabled();
    submitConfirm();
    return { submitted: true };
  `);
  wait();
  const state = reloadAndRead();
  expectEqual(state.params?.["A.acct.op-041.role"], "support", "role persisted");
  expectEqual(state.params?.["A.acct.op-041.tier"], "lead", "tier persisted");
  expect(auditHas(state, "变更角色 op-041"), "role audit missing");
  return { role: state.params["A.acct.op-041.role"], tier: state.params["A.acct.op-041.tier"] };
});

await step("permission-matrix", () => {
  open("/platform/rbac");
  evalJson(`clickInRow('文案/课程发布(I)', '改授权'); return { opened: true };`);
  wait();
  evalJson(`
    selectByLabel('客服.*授权|support.*permission', 'R');
    fillReason('L2a01 permission-matrix proof ticket 1002');
    assertConfirmEnabled();
    submitConfirm();
    return { submitted: true };
  `);
  wait();
  const state = reloadAndRead();
  expectEqual(state.params?.["A.rbac.support.content_publish"], "R", "permission persisted");
  expect(auditHas(state, "变更授权 文案/课程发布"), "permission audit missing");
  return { grant: state.params["A.rbac.support.content_publish"] };
});

await step("copy-edit", () => {
  open("/content/copy-ab");
  evalJson(`clickExact('编辑草稿 v8'); return { opened: true };`);
  wait();
  evalJson(`
    fillByLabel('中文 zh 文案', 'L2a01 复投 {amount} 后获得 {nex} NEX');
    fillByLabel('英文 en copy', 'L2a01 reinvest {amount} and earn {nex} NEX');
    fillReason('L2a01 copy-edit proof ticket 1003');
    assertConfirmEnabled();
    submitConfirm();
    return { submitted: true };
  `);
  wait();
  const state = reloadAndRead();
  expectEqual(state.params?.["I.copy.home.conversionBanner.draft.zh"], "L2a01 复投 {amount} 后获得 {nex} NEX", "copy zh persisted");
  expectEqual(state.params?.["I.copy.home.conversionBanner.status"], "v8 draft saved", "copy status persisted");
  return { status: state.params["I.copy.home.conversionBanner.status"] };
});

await step("campaign-edit", () => {
  open("/content/notifications");
  evalJson(`clickInRow('CMP-2619', '编辑'); return { opened: true };`);
  wait();
  evalJson(`
    fillByLabel('通知标题|title', 'L2a01 7 月费率说明');
    fillByLabel('通知正文|body', 'L2a01 campaign body for scheduled announcement');
    selectByLabel('优先级|priority', 'high');
    selectByLabel('受众|audience', '注册 ≤14 天');
    selectByLabel('排期|schedule', '排期下发');
    fillReason('L2a01 campaign-edit proof ticket 1004');
    assertConfirmEnabled();
    submitConfirm();
    return { submitted: true };
  `);
  wait();
  const state = reloadAndRead();
  expectEqual(state.params?.["I.campaign.CMP-2619.draft.title"], "L2a01 7 月费率说明", "campaign title persisted");
  expectEqual(state.params?.["I.campaign.CMP-2619.draft.schedule"], "排期下发", "campaign schedule persisted");
  return { title: state.params["I.campaign.CMP-2619.draft.title"] };
});

await step("course-authoring", () => {
  open("/content/learn");
  evalJson(`clickExact('+ 新建课程'); return { opened: true };`);
  wait();
  evalJson(`
    fillByLabel('课程 slug', 'l2a01-proof-course');
    selectByLabel('分类|category', 'Security');
    fillByLabel('奖励|reward', '12');
    fillByLabel('中文标题', 'L2a01 安全课程');
    fillByLabel('English title', 'L2a01 Security Course');
    fillByLabel('中文正文', 'L2a01 课程正文与完成条件');
    fillByLabel('English body', 'L2a01 course body and completion criteria');
    fillReason('L2a01 course-authoring proof ticket 1005');
    assertConfirmEnabled();
    submitConfirm();
    return { submitted: true };
  `);
  wait();
  const state = reloadAndRead();
  expectEqual(state.params?.["I.tutorial.l2a01-proof-course.status"], "draft", "course status persisted");
  expectEqual(state.params?.["I.tutorial.l2a01-proof-course.title.zh"], "L2a01 安全课程", "course title persisted");
  return { course: "l2a01-proof-course" };
});

await step("version-authoring", () => {
  open("/content/disclosure");
  evalJson(`clickExact('草拟新版(SFC v13)'); return { opened: true };`);
  wait();
  evalJson(`
    fillByLabel('版本号|version', 'v13-proof');
    fillByLabel('中文版本正文', 'L2a01 披露中文正文');
    fillByLabel('English version body', 'L2a01 disclosure English body');
    fillReason('L2a01 version-authoring proof ticket 1006');
    assertConfirmEnabled();
    submitConfirm();
    return { submitted: true };
  `);
  wait();
  const state = reloadAndRead();
  expectEqual(state.params?.["I.disclosure.SFC.draft"], "v13-proof", "disclosure draft version persisted");
  expectEqual(state.params?.["I.disclosure.SFC.draft.zh"], "L2a01 披露中文正文", "disclosure zh persisted");
  return { version: state.params["I.disclosure.SFC.draft"] };
});

await step("destructive-reason", () => {
  open("/devices/pricing");
  evalJson(`clickInRow('NexionBox S1', '删除'); return { opened: true };`);
  wait();
  evalJson(`
    fillByLabel('回滚方案|替代方案', 'L2a01 如误删从 SKU 快照恢复并回补前台入口');
    checkByLabel('确认影响|影响范围|回滚方案');
    fillReason('L2a01 destructive-reason proof ticket 1007');
    assertConfirmEnabled();
    submitConfirm();
    return { submitted: true };
  `);
  wait();
  const state = reloadAndRead();
  expect(!(state.skus || []).some((sku) => sku.name === "NexionBox S1"), "deleted SKU still persisted");
  expect(auditHas(state, "删除 SKU NexionBox S1"), "delete SKU audit missing");
  return { deleted: "NexionBox S1" };
});

console.log(JSON.stringify({
  status: results.every((r) => r.status === "passed") ? "passed" : "failed",
  baseUrl: BASE_URL,
  session,
  results,
}, null, 2));
