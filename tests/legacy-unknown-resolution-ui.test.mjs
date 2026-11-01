import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { parseLegacyUnknownCandidate, sameLegacyUnknownProof } from "../lib/admin/legacy-unknown-resolution.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const source = read("app/components/domain-views/e-tabs/legacy-unknown-resolution-action.tsx");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const candidate = () => parseLegacyUnknownCandidate({ eligible: true, reason: "ELIGIBLE", deviceId: 42, caseId: "synthetic-case", taskNo: "CTA-SYNTHETIC",
  ownerId: 7, instanceNo: "DEVICE-SYNTHETIC", requestGeneration: 1, requestKeyHash: "a".repeat(64), requestBodyHash: "b".repeat(64),
  caseSetSha256: "c".repeat(64), backendInstanceId: "epoch-1", proofSha: "d".repeat(64), status: "ELIGIBLE" }, 42);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" && value.props
  ? [value, ...nodes(value.props.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join("") : value && typeof value === "object" && value.props
  ? text(value.props.children) : value == null ? "" : String(value);

function fixture() {
  const cells = []; let index = 0; const effects = [];
  const auth = { session: { adminId: 10, authorities: ["platform_a2_proposal_create"] }, authEpoch: 1 };
  const useAdminAuth = select => select(auth); useAdminAuth.getState = () => auth;
  const calls = [], toasts = []; let get = async () => candidate(); let post = async () => ({ id: "A2-synthetic" });
  function Modal() {}
  const modules = { "react/jsx-runtime": jsx, react: {
    useState(initial) { const at = index++; cells[at] ??= { value: initial }; return [cells[at].value, value => { cells[at].value = typeof value === "function" ? value(cells[at].value) : value; }]; },
    useRef(initial) { const at = index++; cells[at] ??= { current: initial }; return cells[at]; },
    useEffect(callback, deps) { const at = index++; const old = cells[at]; if (!old || deps.some((value, n) => value !== old.deps[n])) {
      effects.push(() => { old?.cleanup?.(); cells[at] = { deps, cleanup: callback() }; });
    } },
  }, "@/lib/store/admin-auth": { useAdminAuth }, "@/lib/admin/error-messages": { displayAdminError: error => error.message },
  "@/lib/admin/legacy-unknown-resolution": { sameLegacyUnknownProof },
  "@/lib/admin/e5-client": { fetchLegacyUnknownCandidate: (...args) => { calls.push(["get", ...args]); return get(...args); },
    proposeLegacyUnknownCancellation: (...args) => { calls.push(["post", ...args]); return post(...args); } }, "../design-kit": { OperationConfirmModal: Modal } };
  const module = { exports: {} }; new Function("require", "module", "exports", code)(id => {
    assert.ok(id in modules, `Unexpected import ${id}`); return modules[id];
  }, module, module.exports);
  const props = { device: { deviceId: 42, userId: "7", serial: "DEVICE-SYNTHETIC", state: "unknown" }, canWrite: true, toast: value => toasts.push(value) };
  const render = () => { index = 0; const root = module.exports.LegacyUnknownResolutionAction(props); effects.splice(0).forEach(run => run()); return root; };
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); return render(); };
  return { auth, props, calls, toasts, render, settle, Modal, setGet: value => { get = value; }, setPost: value => { post = value; },
    unmount: () => cells.forEach(cell => cell.cleanup?.()),
    button: root => nodes(root).find(node => node.type === "button" && text(node) === "结束未确认任务（不计收益）"),
    modal: root => nodes(root).find(node => node.type === Modal) };
}

test("actual E5 action appears only for a server eligible case and permitted administrator", async () => {
  const denied = fixture(); denied.props.canWrite = false; assert.equal(denied.render(), null); assert.equal(denied.calls.length, 0);
  const noProposal = fixture(); noProposal.auth.session.authorities = []; assert.equal(noProposal.render(), null); assert.equal(noProposal.calls.length, 0);
  const ordinary = fixture(); ordinary.setGet(async () => ({ eligible: false, deviceId: 42, reason: "CASE_NOT_AUTHORIZED" }));
  ordinary.render(); assert.equal(ordinary.button(await ordinary.settle()), undefined);
  const allowed = fixture(); allowed.render(); assert.ok(allowed.button(await allowed.settle()));
});

test("actual modal reviews exact proof and only creates a pending A2 ticket", async () => {
  const f = fixture(); f.render(); let root = await f.settle(); await f.button(root).props.onClick(); root = await f.settle();
  const modal = f.modal(root); assert.ok(modal); assert.equal(modal.props.amplifies, false);
  assert.match(text(modal.props.detail), /CTA-SYNTHETIC/); assert.match(text(modal.props.detail), /epoch-1/);
  assert.match(text(modal.props.detail), new RegExp("d".repeat(64))); assert.match(text(modal.props.detail), /不产生 USDT\/UVT 收益/);
  await modal.props.onConfirm("依据真实退出证明结束原任务"); root = f.render();
  assert.equal(f.calls.filter(row => row[0] === "post").length, 1);
  assert.match(text(root), /A2-synthetic.*等待另一管理员复核/);
  assert.doesNotMatch(text(root), /已取消/);
});

test("backend epoch change before confirmation refuses the stale evidence", async () => {
  const f = fixture(); f.render(); const root = await f.settle();
  f.setGet(async () => ({ ...candidate(), backendInstanceId: "restarted-epoch" }));
  await f.button(root).props.onClick(); const next = await f.settle();
  assert.equal(f.modal(next), undefined); assert.match(text(next), /证据或设备状态已更新/);
  assert.equal(f.calls.filter(row => row[0] === "post").length, 0);
});

test("late candidate reads cannot restore an action after account or permission changes", async () => {
  const f = fixture(), pending = deferred(); f.setGet(() => pending.promise); f.render();
  f.auth.authEpoch++; f.auth.session.adminId = 11; f.props.canWrite = false; assert.equal(f.render(), null);
  pending.resolve(candidate()); assert.equal(await f.settle(), null); assert.equal(f.calls.filter(row => row[0] === "post").length, 0);
});

test("late proposal response after unmount does not produce success feedback in another page", async () => {
  const f = fixture(); f.render(); let root = await f.settle(); await f.button(root).props.onClick(); root = await f.settle();
  const pending = deferred(); f.setPost(() => pending.promise);
  const submission = f.modal(root).props.onConfirm("依据真实退出证明结束原任务"); f.unmount();
  pending.resolve({ id: "A2-original" }); await submission; assert.deepEqual(f.toasts, []);
});

test("actual devices proxy permits only candidate GET and proposal POST, excluding internal proof registration", async () => {
  const routeCode = ts.transpileModule(read("app/api/admin/devices/[...path]/route.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }, calls = []; const original = globalThis.fetch;
  new Function("require", "module", "exports", routeCode)(id => id === "next/headers"
    ? { cookies: async () => ({ get: () => ({ value: "synthetic-test-token" }) }) }
    : { ADMIN_TOKEN_COOKIE: "synthetic-cookie", requirePasswordChangeCleared: () => null }, module, module.exports);
  try {
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return Response.json({ code: 0, data: {} }); };
    const context = path => ({ params: Promise.resolve({ path }) });
    const base = ["legacy-unknown-resolutions", "42"];
    assert.equal((await module.exports.GET(new Request("http://local.test/candidate"), context(base))).status, 200);
    assert.equal((await module.exports.POST(new Request("http://local.test/proposal", { method: "POST", body: "{}" }), context([...base, "proposals"]))).status, 200);
    assert.equal((await module.exports.DELETE(new Request("http://local.test/candidate", { method: "DELETE" }), context(base))).status, 405);
    assert.equal((await module.exports.GET(new Request("http://local.test/proposal"), context([...base, "proposals"]))).status, 405);
    assert.equal((await module.exports.POST(new Request("http://local.test/register", { method: "POST" }), context(["legacy-unknown-resolutions", "proofs", "register"]))).status, 404);
    assert.equal(calls.length, 2); assert.ok(calls[0].url.endsWith("/legacy-unknown-resolutions/42"));
  } finally { globalThis.fetch = original; }
});
