import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { SupportClientError } from "../lib/admin/m-support-client.ts";
import { displayAdminError } from "../lib/admin/error-messages.ts";

// Offline component behavior only; no browser, session, business API or send.
const repo = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(path.join(process.env.SUPPORT_TEST_MODULE_ROOT || repo, "package.json"));
const ts = require("typescript"), React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const source = readFileSync(path.join(process.env.SUPPORT_BULK_SOURCE_ROOT || repo, "app/components/domain-views/m-tabs/support-bulk-composer.tsx"), "utf8");

function harness(cause, preview, job = null, recipients = []) {
  let cursor = 0, pending = true, tree;
  const slots = [], effects = [], previews = [];
  const context = { exports: {}, AbortController, URL, Date, Number, Set, Promise, File: class {},
    window: { addEventListener() {}, removeEventListener() {} },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    require(name) {
      if (name === "react") return { useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; pending = true; } }];
      }, useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; }, useEffect(callback, dependencies) {
        const index = cursor++, old = slots[index];
        if (!old || dependencies.some((value, i) => !Object.is(value, old.dependencies[i]))) effects.push(() => { old?.cleanup?.(); slots[index] = { dependencies, cleanup: callback() }; });
      } };
      if (name === "react/jsx-runtime") return require(name);
      if (name === "@/lib/store/admin-auth") return { useAdminAuth: selector => selector({ session: { adminId: 1, role: "superadmin", authorities: [] }, authEpoch: 1 }) };
      if (name === "@/lib/admin/m-support-enhancements") return { supportEnhancements: {
        bulkPreview(input, signal) { previews.push({ input, signal }); return preview ? preview(input, previews.length) : Promise.reject(cause); },
        profile: async () => ({ identity: { data: {} }, annotations: { data: {} }, finance: { data: {} }, service: { data: {} } }),
        bulkJobs: async () => ({ records: job ? [job] : [], total: job ? 1 : 0 }),
        bulkJob: async () => job,
        bulkRecipients: async () => ({ records: recipients, total: recipients.length }),
        bulkCreate() { throw new Error("This read-only regression must never send"); },
      } };
      if (name === "@/lib/admin/m-support-client") return { SupportClientError };
      if (name === "@/lib/admin/pending-mutation-store") return { createPendingMutationStore: () => ({ list: () => [] }) };
      if (name === "@/lib/admin/error-messages") return { displayAdminError };
      if (name === "../design-kit") return { Modal: props => React.createElement("section", null, props.children, props.footer) };
      if (name === "./support-content-tools") return {};
      throw new Error(`Unexpected dependency ${name}`);
    },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  const render = () => { let loops = 0; while (pending) { assert.ok(++loops < 20, "effect loop"); pending = false; cursor = 0; tree = context.exports.SupportBulkComposer({ ctx: {}, onClose() {} }); effects.splice(0).forEach(run => run()); } return tree; };
  return { render, previews, async settle() { await new Promise(resolve => setImmediate(resolve)); return render(); }, unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}
function nodes(node, result = []) {
  if (!node || typeof node !== "object") return result;
  if (Array.isArray(node)) { node.forEach(value => nodes(value, result)); return result; }
  if (node.props) { result.push(node); nodes(node.props.children, result); nodes(node.props.footer, result); }
  return result;
}
function button(tree, text) { return nodes(tree).find(node => node.type === "button" && node.props.children === text); }

test("scope403 explains current advisor permissions and offers no preview retry", async () => {
  const h = harness(new SupportClientError(403, 403, "SUPPORT_SCOPE_FORBIDDEN"));
  try {
    h.render(); const tree = await h.settle();
    const html = renderToStaticMarkup(tree);
    assert.match(html, /当前.*顾问.*客户.*范围|当前.*本人.*客户/);
    assert.match(html, /权限|无权/);
    assert.doesNotMatch(html, /请刷新页面|重新读取名单/);
    assert.equal(button(tree, "查询筛选结果").props.disabled, true);
    assert.equal(button(tree, "下一步：编写内容").props.disabled, true);
    assert.equal(h.previews.length, 1);
  } finally { h.unmount(); }
});

test("temporary preview failure retains its read-only retry", async () => {
  for (const cause of [new SupportClientError(503), new TypeError("Failed to fetch")]) {
    const h = harness(cause);
    try {
      h.render(); let tree = await h.settle();
      assert.equal(button(tree, "查询筛选结果").props.disabled, false);
      button(tree, "重新读取名单").props.onClick(); h.render(); tree = await h.settle();
      assert.ok(button(tree, "重新读取名单"));
      assert.equal(h.previews.length, 2);
      assert.equal(h.previews[0].input.selectionMode, "ALL_FILTERED");
    } finally { h.unmount(); }
  }
});

test("freezing a stale selected scope rejects without advancing or retaining a retryable list", async () => {
  const denied = new SupportClientError(403, 403, "SUPPORT_SCOPE_FORBIDDEN");
  const h = harness(denied, (_input, call) => call === 1
    ? Promise.resolve({ actorId: 1, count: 1, customers: [{ id: "42" }], excluded: [] })
    : Promise.reject(denied));
  try {
    h.render(); let tree = await h.settle();
    button(tree, "选择当前全部筛选结果").props.onClick(); tree = h.render();
    assert.equal(button(tree, "下一步：编写内容").props.disabled, false);
    button(tree, "下一步：编写内容").props.onClick(); tree = await h.settle();
    const html = renderToStaticMarkup(tree);
    assert.match(html, /第 1 步：圈选客户/); assert.match(html, /无权读取.*专属客服客户范围/);
    assert.doesNotMatch(html, /重新读取名单|选择当前全部筛选结果|当前本人归属（已核对）/);
    assert.equal(button(tree, "下一步：编写内容").props.disabled, true);
    assert.equal(h.previews[1].input.selectionMode, "CROSS_PAGE");
    assert.deepEqual([...h.previews[1].input.customerIds], ["42"]);
    assert.equal(h.previews.length, 2);
  } finally { h.unmount(); }
});

test("known advisor-unavailable denial keeps qualification guidance and unknown errors stay safely retryable", async () => {
  for (const [cause, blocked] of [[new SupportClientError(403, 403, "SUPPORT_AGENT_UNAVAILABLE"), true], [new SupportClientError(422, 422, "SUPPORT_SCOPE_FORBIDDEN"), false], [new SupportClientError(403, 403, "UNKNOWN_PRIVATE_TEXT"), false]]) {
    const h = harness(cause);
    try {
      h.render(); const tree = await h.settle(), html = renderToStaticMarkup(tree);
      assert.equal(Boolean(button(tree, "重新读取名单")), !blocked);
      assert.equal(button(tree, "查询筛选结果").props.disabled, blocked);
      if (blocked) assert.match(html, /当前账号.*专属客服资格.*群发.*主管/);
      assert.doesNotMatch(html, /SUPPORT_SCOPE_FORBIDDEN|SUPPORT_AGENT_UNAVAILABLE|UNKNOWN_PRIVATE_TEXT/);
    } finally { h.unmount(); }
  }
});


test("closed and transferred customers are excluded with reasons before composing", async () => {
  const h = harness(null, async () => ({ actorId: 1, count: 0, customers: [], excluded: [
    { id: "42", reason: "CONVERSATION_CLOSED" }, { id: "43", reason: "CONVERSATION_TRANSFERRED" },
  ] }));
  try {
    h.render(); const tree = await h.settle(), html = renderToStaticMarkup(tree);
    assert.match(html, /原会话已结束.*本次不发送/);
    assert.match(html, /原会话正在转接.*本次不发送/);
    assert.equal(button(tree, "下一步：编写内容").props.disabled, true);
    assert.ok(nodes(tree).filter(node => node.type === "input" && node.props.type === "checkbox").slice(1).every(node => node.props.disabled));
  } finally { h.unmount(); }
});

test("closed during selection refreshes the excluded list and clears stale selection", async () => {
  const h = harness(null, async (_input, call) => call === 1
    ? { actorId: 1, count: 1, customers: [{ id: "42" }], excluded: [] }
    : { actorId: 1, count: 0, customers: [], excluded: [{ id: "42", reason: "CONVERSATION_CLOSED" }] });
  try {
    h.render(); let tree = await h.settle();
    button(tree, "选择当前全部筛选结果").props.onClick(); tree = h.render();
    button(tree, "下一步：编写内容").props.onClick(); tree = await h.settle();
    const html = renderToStaticMarkup(tree);
    assert.match(html, /第 1 步：圈选客户/);
    assert.match(html, /原会话已结束.*重新圈选/);
    assert.match(html, /可选 0 位.*已选 0 位/);
    assert.equal(button(tree, "下一步：编写内容").props.disabled, true);
  } finally { h.unmount(); }
});

test("post-submit lifecycle exclusions show concrete next steps and no retry", async () => {
  for (const [code, text] of [
    ["CONVERSATION_CLOSED", /原会话已结束.*重新圈选/],
    ["CONVERSATION_TRANSFERRED", /原会话正在转接.*归属确定/],
    ["CONVERSATION_ARCHIVED", /原会话已归档.*核对归档状态/],
    ["CONVERSATION_CONVERTED", /原会话已转工单.*关联工单/],
    ["CONVERSATION_NOT_WRITABLE", /原会话已结束或正在转接/],
    ["SUPPORT_BULK_CONVERSATION_CHANGED", /客户会话已变化.*重新圈选/],
  ]) {
    const job = { batchId: "lifecycle-batch", actorId: 1, state: "COMPLETED", frozenCount: 1, visibleCount: 1,
      counts: { total: 1, pending: 0, sent: 0, failed: 0, skipped: 1, cancelled: 0, unknown: 0 } };
    const h = harness(null, async () => ({ actorId: 1, count: 0, customers: [], excluded: [] }), job,
      [{ customerId: "42", state: "SKIPPED", resultCertainty: "KNOWN", failureCode: code, retryable: false, conversationNo: "CV-OLD" }]);
    try {
      h.render(); let tree = await h.settle();
      nodes(tree).find(node => node.type === "button" && node.key === "lifecycle-batch").props.onClick();
      h.render(); tree = await h.settle();
      const html = renderToStaticMarkup(tree);
      assert.match(html, text);
      assert.doesNotMatch(html, /执行未通过，请核对客户与原消息/);
      assert.equal(button(tree, "核对并重试失败项").props.disabled, true);
      assert.ok(nodes(tree).some(node => node.type === "a" && node.props.href === "/service/sessions?conversationNo=CV-OLD"));
    } finally { h.unmount(); }
  }
});
