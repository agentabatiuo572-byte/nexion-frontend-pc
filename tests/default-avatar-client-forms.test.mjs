import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("..", import.meta.url));
const base = process.env.NEXION_AVATAR_TEST_READONLY_BASE ?? root;
const ts = createRequire(join(base, "package.json"))("typescript");
const ID = "12345678-1234-1234-1234-123456789012", OLD = "87654321-4321-4321-4321-210987654321";
const KEY = "default-avatar-original-key", SNAP = { assetId: OLD, avatarVersion: 2, accountVersion: "7", avatarGender: "FEMALE" };
const prepared = (scope = "admin", status = "READY") => ({ assetId: ID, status, expiresAt: new Date(Date.now() + 300000).toISOString(), previewRef: `/api/admin/platform/accounts/${scope === "self" ? "self/" : ""}avatar-assets/${ID}` });
const json = (data, status = 200, message = "success", headers) => Response.json({ code: status === 200 ? 0 : status, data, message }, { status, headers });

function fixture() {
  const requests = [], queue = [], modules = new Map(), storage = new Map();
  globalThis.window = { sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
  let hooks;
  const auth = { session: { adminId: 41, role: "support", operator: "本人客服", authorities: [] }, authEpoch: 1, operator: "本人客服" };
  const useAdminAuth = fn => fn(auth); useAdminAuth.getState = () => auth;
  const guardedFetch = async (path, init = {}) => { requests.push({ path, init }); const next = queue.shift(); if (next instanceof Error) throw next; if (!next) throw new Error("Unexpected request " + path); return next; };
  globalThis.fetch = guardedFetch;
  function load(path) {
    if (modules.has(path)) return modules.get(path);
    const file = existsSync(join(root, path)) ? join(root, path) : join(base, path);
    let source = readFileSync(file, "utf8");
    if (path.endsWith("a1-accounts.tsx")) source += "\nexport const testForms = { NewAccountDrawer, EditAccountDrawer };";
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
    assert.equal((compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
    const exports = {}; modules.set(path, exports);
    new Function("require", "exports", compiled.outputText)(name => {
      if (name === "react") return { useState: value => hooks.state(value), useRef: value => hooks.ref(value), useEffect: (fn, deps) => hooks.effect(fn, deps), useCallback: fn => fn, useMemo: fn => fn() };
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "fragment" };
      if (name === "next/headers") return { cookies: async () => ({ get: () => ({ value: "test-token" }) }) };
      if (name.endsWith("admin-auth")) return { useAdminAuth };
      if (name.endsWith("error-messages")) return { guardedFetch, formatAdminApiError: value => value, displayAdminError: error => error.message ?? String(error) };
      if (name.endsWith("require-password-change-cleared")) return { ADMIN_TOKEN_COOKIE: "test", requirePasswordChangeCleared: () => null };
      if (name.endsWith("m-support-client")) return { supportClient: { attachmentPolicy: async () => ({ available: true, allowedMimeTypes: ["image/png", "image/jpeg"], maxBytes: 1048576, maxPixels: 1048576 }) } };
      if (name.endsWith("hd-ui")) return { HDSelect: "HDSelect" };
      if (name.endsWith("design-kit")) return { Drawer: "Drawer" };
      if (name === "./account-avatar-contract.ts") return load("lib/admin/account-avatar-contract.ts");
      if (name.startsWith("@/lib/admin/") && ["a1-client", "account-avatar-contract", "account-avatar-pending", "pending-mutation-store", "outcome-classification", "high-ops-registry", "support-image-proxy"].some(x => name.endsWith("/" + x))) return load(name.slice(2) + ".ts");
      if (name.endsWith("account-avatar-picker")) return load("app/components/domain-views/a-tabs/account-avatar-picker.tsx");
      if (name.endsWith("support-avatar")) return { SupportAvatar: "SupportAvatar" };
      return {};
    }, exports);
    return exports;
  }
  function component(fn, props) {
    const states = [], refs = [], effects = []; let cursor = 0, pendingEffects = [];
    const api = { state(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; }, ref(initial) { const i = cursor++; return refs[i] ??= { current: initial }; }, effect(fn, deps) { const i = cursor++, prior = effects[i]; if (!prior || deps.some((value, index) => !Object.is(value, prior.deps[index]))) pendingEffects.push(() => { prior?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); } };
    return { render() { cursor = 0; hooks = api; const tree = fn(props); const jobs = pendingEffects; pendingEffects = []; jobs.forEach(fn => fn()); return tree; }, dispose() { effects.forEach(effect => effect?.cleanup?.()); }, props };
  }
  return { load, requests, queue, auth, storage, component };
}
function nodes(tree, predicate, found = []) {
  if (Array.isArray(tree)) { tree.forEach(child => nodes(child, predicate, found)); return found; }
  if (!tree || typeof tree !== "object" || !tree.props) return found;
  if (predicate(tree)) found.push(tree);
  nodes(tree.props.children, predicate, found); if (tree.props.footer) nodes(tree.props.footer, predicate, found);
  return found;
}
const button = (tree, label) => nodes(tree, node => node.type === "button" && node.props.children === label)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));

test("create and A2 frozen command preserve old fields and explicit gender/default intent; invalid mixed intent cannot send", async () => {
  const f = fixture(), client = f.load("lib/admin/a1-client.ts"), registry = f.load("lib/admin/high-ops-registry.ts");
  const legacy = { username: "support.jane", displayName: "专属客服", email: "a@example.com", role: "support" };
  f.queue.push(json({ id: "99" })); await client.createA1Account(legacy, "既有理由", "操作者", KEY);
  assert.deepEqual(JSON.parse(f.requests[0].init.body), { ...legacy, reason: "既有理由", operator: "操作者" });
  const input = { ...legacy, avatarGender: "MALE", useDefaultAvatar: true };
  f.queue.push(json({ id: "99", avatarAssetId: ID, avatarGender: "MALE" })); await client.createA1Account(input, "既有理由", "操作者", KEY);
  assert.deepEqual(JSON.parse(f.requests[1].init.body), { ...input, reason: "既有理由", operator: "操作者" });
  const frozen = registry.findHighOp("a1_account_create").buildCommand(input).params;
  assert.equal(frozen.avatarGender, "MALE"); assert.equal(frozen.useDefaultAvatar, true); assert.equal(frozen.username, legacy.username);
  const profile = registry.findHighOp("a1_account_update_profile").buildCommand({ accountId: 99, ...legacy, avatarGender: "FEMALE", avatarAssetId: ID, expectedVersion: "17" });
  assert.equal(profile.params.avatarGender, "FEMALE"); assert.equal(profile.params.expectedVersion, "17"); assert.equal(profile.params.accountId, "99"); assert.ok(!("useDefaultAvatar" in profile.params));
  for (const bad of [{ ...input, avatarAssetId: ID }, { ...input, role: "finance" }, { ...input, avatarGender: "guess-from-name" }, { ...input, useDefaultAvatar: "true" }]) assert.throws(() => client.createA1Account(bad, "reason", "actor", KEY));
  assert.equal(f.requests.length, 2);
});

test("default prepare and upload use exact scope, original client id/key and reject remote or cross-scope previews", async () => {
  const f = fixture(), client = f.load("lib/admin/a1-client.ts");
  f.queue.push(new Error("network unknown"), json(prepared("self")), json(prepared()));
  await assert.rejects(client.prepareDefaultAccountAvatar("self", "FEMALE", "original-upload-id", KEY), client.A1OutcomeUncertainError);
  assert.equal(f.requests.length, 1, "unknown must not automatically retry before recovery");
  await client.prepareDefaultAccountAvatar("self", "FEMALE", "original-upload-id", KEY);
  assert.equal(f.requests[0].path, "/api/admin/platform/accounts/self/avatar-assets/default");
  assert.equal(f.requests[0].init.body, f.requests[1].init.body); assert.equal(new Headers(f.requests[0].init.headers).get("Idempotency-Key"), KEY);
  const file = new File(["jpeg bytes"], "avatar.jpg", { type: "image/jpeg" }); await client.uploadA1Avatar(file, "original-upload-id", KEY);
  assert.deepEqual([...f.requests[2].init.body.keys()], ["file", "clientUploadId"]);
  for (const response of [{ ...prepared("self"), previewRef: "https://randomuser.me/avatar.jpg" }, prepared("admin"), { ...prepared("self"), assetId: "../../escape" }, { ...prepared("self"), status: "ATTACHED" }]) {
    f.queue.push(json(response)); await assert.rejects(client.prepareDefaultAccountAvatar("self", "FEMALE", "original-upload-id", KEY), client.A1OutcomeUncertainError);
  }
});

test("self save whitelists exact fields and account CAS version; unknown/conflict retains command", async () => {
  const f = fixture(), client = f.load("lib/admin/a1-client.ts"), input = { assetId: ID, expectedVersion: "7", reason: "本人明确更换头像测试" };
  for (const extra of ["target", "accountId", "name", "avatarGender", "role"]) await assert.rejects(client.saveSelfAvatar({ ...input, [extra]: 9 }, KEY), /AVATAR_COMMAND_INVALID/);
  assert.equal(f.requests.length, 0);
  f.queue.push(json({ ...SNAP, assetId: ID, accountVersion: "8", avatarVersion: 3 }));
  await client.saveSelfAvatar(input, KEY); assert.deepEqual(JSON.parse(f.requests[0].init.body), input);
  for (const failure of [new Error("connection lost"), json(null, 503), json(null, 409, "IDEMPOTENCY_REQUEST_IN_PROGRESS"), json(null, 409, "IDEMPOTENCY_RESULT_UNKNOWN"), json(null, 409, "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH"), json(null, 409, "AVATAR_STATE_CONFLICT"), json({ ...SNAP, assetId: OLD })]) {
    f.queue.push(failure); await assert.rejects(client.saveSelfAvatar(input, KEY), client.A1OutcomeUncertainError);
  }
  f.queue.push(json(null, 403, "AVATAR_SELF_FORBIDDEN")); await assert.rejects(client.saveSelfAvatar(input, KEY), error => !(error instanceof client.A1OutcomeUncertainError));
});

test("real create/edit form producers select explicit defaults, keep manual mutually exclusive, and do not redraw on gender edit", () => {
  const f = fixture(), forms = f.load("app/components/domain-views/a-tabs/a1-accounts.tsx").testForms, results = [];
  const form = f.component(forms.NewAccountDrawer, { roles: [{ key: "support", name: "客服" }], recoveryMode: false, onClose() {}, onSubmit: value => results.push(value), initialForm: { username: "jane", displayName: "专属客服", email: "a@example.com", role: "support", reason: "测试明确建立账号" } });
  let tree = form.render(); tree = form.render(); nodes(tree, n => n.type === "HDSelect")[0].props.onChange("FEMALE"); tree = form.render(); button(tree, "确认创建账号").props.onClick();
  assert.equal(results[0].useDefaultAvatar, true); assert.equal(results[0].avatarGender, "FEMALE"); assert.ok(!("avatarAssetId" in results[0]));
  assert.equal(nodes(tree, n => n.type === "fieldset" && n.props.className === "account-avatar-controls").length, 1, "Only the new avatar controls receive the typography scope");
  nodes(tree, n => n.type === "input" && n.props.name === "avatar-mode")[1].props.onChange(); tree = form.render();
  const picker = nodes(tree, n => typeof n.type === "function" && n.type.name === "AccountAvatarPicker")[0]; picker.props.onChange(ID); tree = form.render(); button(tree, "确认创建账号").props.onClick();
  assert.equal(results[1].avatarAssetId, ID); assert.equal(results[1].useDefaultAvatar, false);
  const edit = f.component(forms.EditAccountDrawer, { account: { id: "99", username: "jane", name: "专属客服", email: "a@example.com", role: "support", version: "7", avatarAssetId: OLD, avatarVersion: 2, avatarGender: "MALE" }, onClose() {}, onSubmit: value => results.push(value) });
  tree = edit.render(); nodes(tree, n => n.type === "HDSelect")[0].props.onChange("FEMALE"); tree = edit.render();
  assert.equal(nodes(tree, n => n.type === "fieldset" && n.props.className === "account-avatar-controls").length, 1);
  nodes(tree, n => n.type === "textarea")[0].props.onChange({ target: { value: "仅调整资料中的头像分类" } }); tree = edit.render(); button(tree, "保存账号资料").props.onClick();
  assert.equal(results[2].avatarGender, "FEMALE"); assert.equal(results[2].avatarAssetId, undefined); assert.equal(f.requests.length, 0, "changing gender must not prepare any image");
  form.dispose(); edit.dispose();
});

test("real picker persists default intent and retries original gender/key after reload; cancel retries original key", async () => {
  const f = fixture(); f.auth.session.role = "super";
  const picker = f.load("app/components/domain-views/a-tabs/account-avatar-picker.tsx").AccountAvatarPicker;
  const changed = [], blocked = [], props = { name: "客服", gender: "FEMALE", allowDefault: true, onChange: value => changed.push(value), onBlocking: value => blocked.push(value) };
  const first = f.component(picker, props); let tree = first.render(); tree = first.render();
  assert.equal(tree.props.className, "account-avatar-controls", "The real picker root owns the local typography scope");
  f.queue.push(new Error("unknown")); button(tree, "按所选性别准备默认头像").props.onClick(); await flush();
  assert.equal(f.requests.length, 1); const original = f.requests[0]; first.dispose();
  const second = f.component(picker, { ...props, gender: "MALE" }); second.render(); tree = second.render(); f.queue.push(json(prepared())); button(tree, "上传或使用原命令重试").props.onClick(); await flush();
  assert.equal(f.requests[1].init.body, original.init.body); assert.equal(new Headers(f.requests[1].init.headers).get("Idempotency-Key"), new Headers(original.init.headers).get("Idempotency-Key")); assert.equal(changed.at(-1), ID);
  tree = second.render(); f.queue.push(new Error("cancel unknown")); button(tree, "取消新头像").props.onClick(); await flush(); tree = second.render(); f.queue.push(json(prepared("admin", "CANCELLED"))); button(tree, "重试原取消操作").props.onClick(); await flush();
  assert.equal(new Headers(f.requests[2].init.headers).get("Idempotency-Key"), new Headers(f.requests[3].init.headers).get("Idempotency-Key")); assert.equal(changed.at(-1), undefined); assert.equal(blocked.at(-1), false); second.dispose();
});

test("real self editor queries unknown save before retry, detects original asset and preserves key after refresh", async () => {
  const f = fixture(), editor = f.load("app/components/domain-views/m-tabs/self-avatar-editor.tsx").SelfAvatarEditor;
  const notices = [], changed = []; let confirmation;
  const props = { name: "本人客服", onChanged: value => changed.push(value), ctx: { openActionConfirm: request => { confirmation = request; }, toast: text => notices.push(text), refreshContent: async () => {} } };
  const first = f.component(editor, props); let tree = first.render(); tree = first.render(); f.queue.push(json(SNAP)); button(tree, "更换本人头像").props.onClick(); await flush(); tree = first.render();
  nodes(tree, n => typeof n.type === "function" && n.type.name === "AccountAvatarPicker")[0].props.onChange(ID); tree = first.render(); button(tree, "确认保存本人头像").props.onClick();
  assert.equal(confirmation.reasonMin, 8); assert.equal(confirmation.reasonMax, 500);
  assert.equal(confirmation.detail.type, "span"); assert.equal(confirmation.detail.props.className, "self-avatar-confirm-detail");
  assert.equal(nodes(confirmation.detail, n => n.props.className === "self-avatar-confirm-detail").length, 1, "The real self confirmation producer passes one unique marker to the actual brief");
  assert.equal(button(tree, "更换本人头像").props.className, "l-btn avatar-control-button");
  assert.equal(nodes(tree, n => n.type === "div" && n.props.className === "account-avatar-controls").length, 2, "Real self body and Drawer footer are locally scoped");
  f.queue.push(json(SNAP), new Error("save unknown")); assert.equal(await confirmation.run("本人明确更换头像测试"), false); assert.equal(f.requests[2].init.method, "PATCH");
  const originalBody = f.requests[2].init.body, originalKey = new Headers(f.requests[2].init.headers).get("Idempotency-Key"); first.dispose();
  const second = f.component(editor, props); tree = second.render(); tree = second.render(); f.queue.push(json(SNAP)); button(tree, "更换本人头像").props.onClick(); await flush(); tree = second.render();
  f.queue.push(json(SNAP), json({ ...SNAP, assetId: ID, avatarVersion: 3, accountVersion: "8" }), json({ ...SNAP, assetId: ID, avatarVersion: 3, accountVersion: "8" })); button(tree, "使用原资料与命令重试").props.onClick(); await flush();
  assert.equal(f.requests[4].init.method, undefined, "snapshot must precede replay"); assert.equal(f.requests[5].init.body, originalBody); assert.equal(new Headers(f.requests[5].init.headers).get("Idempotency-Key"), originalKey); assert.equal(changed.at(-1).assetId, ID); assert.equal(f.load("lib/admin/account-avatar-pending.ts").selfAvatarCommands.list().length, 0); second.dispose();
});

test("manual upload reload only accepts the original image bytes and reuses the original multipart client id/key", async () => {
  const f = fixture(); f.auth.session.role = "super"; globalThis.createImageBitmap = async () => ({ width: 512, height: 512, close() {} });
  const picker = f.load("app/components/domain-views/a-tabs/account-avatar-picker.tsx").AccountAvatarPicker;
  const props = { name: "客服", onChange() {}, onBlocking() {} }, file = new File(["original image bytes"], "portrait.jpg", { type: "image/jpeg" });
  const first = f.component(picker, props); first.render(); let tree = first.render(); nodes(tree, n => n.type === "input" && n.props.type === "file")[0].props.onChange({ target: { files: [file], value: "file" } });
  for (let i = 0; i < 30 && !button(first.render(), "上传或使用原命令重试"); i++) await flush();
  tree = first.render(); f.queue.push(new Error("upload unknown")); button(tree, "上传或使用原命令重试").props.onClick(); await flush(); const original = f.requests[0]; assert.equal(original.init.body.get("clientUploadId").length, 36); first.dispose();
  const second = f.component(picker, props); second.render(); tree = second.render(); const select = nodes(tree, n => n.type === "input" && n.props.type === "file")[0];
  select.props.onChange({ target: { files: [new File(["different image"], "other.jpg", { type: "image/jpeg" })], value: "file" } });
  for (let i = 0; i < 30; i++) await flush(); tree = second.render(); assert.equal(button(tree, "上传或使用原命令重试").props.disabled, true); assert.equal(f.requests.length, 1);
  select.props.onChange({ target: { files: [new File(["original image bytes"], "renamed.jpg", { type: "image/jpeg" })], value: "file" } });
  for (let i = 0; i < 30 && button(second.render(), "上传或使用原命令重试")?.props.disabled !== false; i++) await flush();
  tree = second.render(); f.queue.push(json(prepared())); button(tree, "上传或使用原命令重试").props.onClick(); await flush();
  assert.equal(f.requests[1].init.body.get("clientUploadId"), original.init.body.get("clientUploadId")); assert.equal(new Headers(f.requests[1].init.headers).get("Idempotency-Key"), new Headers(original.init.headers).get("Idempotency-Key")); assert.equal(await f.requests[1].init.body.get("file").text(), "original image bytes"); assert.equal(f.requests[1].init.body.get("file").name, "portrait.jpg"); assert.equal(f.requests[1].init.body.get("file").type, "image/jpeg"); second.dispose();
});

test("readback failure keeps original self command; later snapshot detects saved asset without a second PATCH", async () => {
  const f = fixture(), editor = f.load("app/components/domain-views/m-tabs/self-avatar-editor.tsx").SelfAvatarEditor;
  const changed = []; let confirmation;
  const props = { name: "本人客服", onChanged: snapshot => changed.push(snapshot), ctx: { openActionConfirm: request => { confirmation = request; }, toast() {}, refreshContent: async () => {} } };
  const view = f.component(editor, props); view.render(); let tree = view.render(); f.queue.push(json(SNAP)); button(tree, "更换本人头像").props.onClick(); await flush(); tree = view.render(); nodes(tree, n => typeof n.type === "function" && n.type.name === "AccountAvatarPicker")[0].props.onChange(ID); tree = view.render(); button(tree, "确认保存本人头像").props.onClick();
  f.queue.push(json(SNAP), json({ ...SNAP, assetId: ID, accountVersion: "8", avatarVersion: 3 }), new Error("readback lost")); assert.equal(await confirmation.run("本人明确更换头像测试"), false);
  assert.equal(f.load("lib/admin/account-avatar-pending.ts").selfAvatarCommands.list().length, 1); tree = view.render(); f.queue.push(json({ ...SNAP, assetId: ID, accountVersion: "8", avatarVersion: 3 })); button(tree, "查询原保存结果").props.onClick(); await flush();
  assert.equal(f.requests.filter(r => r.init.method === "PATCH").length, 1); assert.equal(changed.at(-1).assetId, ID); assert.equal(f.load("lib/admin/account-avatar-pending.ts").selfAvatarCommands.list().length, 0); view.dispose();
});

test("self qualification denial cannot send a save or discard a previously unknown command", async () => {
  const f = fixture(), pendingApi = f.load("lib/admin/account-avatar-pending.ts"), editor = f.load("app/components/domain-views/m-tabs/self-avatar-editor.tsx").SelfAvatarEditor;
  pendingApi.selfAvatarCommands.remember("41:self-avatar-save", KEY, { actorId: 41, input: { assetId: ID, expectedVersion: "7", reason: "原明确更换头像理由" } });
  const view = f.component(editor, { name: "本人客服", onChanged() { assert.fail("denied cannot announce save"); }, ctx: { openActionConfirm() {}, toast() {}, refreshContent: async () => {} } }); view.render(); let tree = view.render(); f.queue.push(json(null, 403, "AVATAR_SELF_FORBIDDEN")); button(tree, "更换本人头像").props.onClick(); await flush(); tree = view.render();
  assert.equal(button(tree, "使用原资料与命令重试").props.disabled, true); assert.equal(pendingApi.selfAvatarCommands.list().length, 1); assert.equal(f.requests.length, 1); assert.equal(f.requests[0].init.method, undefined); view.dispose();
});

test("proxy enforces self method/path/body boundaries and streams only allowed image types with no-store", async () => {
  const f = fixture(), route = f.load("app/api/admin/platform/[...path]/route.ts");
  const call = async (method, path, body, search = "") => route[method](new Request(`http://example.test/api/admin/platform/${path}${search}`, { method, headers: { "Content-Type": "application/json", "Idempotency-Key": KEY }, ...(body ? { body: JSON.stringify(body) } : {}) }), { params: Promise.resolve({ path: path.split("/") }) });
  for (const [method, path, body] of [["POST", "accounts/self/avatar"], ["PATCH", "accounts/self/profile", {}], ["GET", "accounts/self/role"], ["GET", "accounts/self/avatar-assets/default"], ["GET", `accounts/self/avatar-assets/${ID}/extra`], ["DELETE", "accounts/self/avatar/content"], ["GET", "accounts/avatar-assets/../secret"]]) assert.equal((await call(method, path, body)).status, 404);
  const input = { assetId: ID, expectedVersion: "7", reason: "本人明确更换头像测试" };
  assert.equal((await call("PATCH", "accounts/self/avatar", { ...input, accountId: 99 })).status, 422);
  assert.equal((await call("POST", "accounts/self/avatar-assets/default", { avatarGender: "FEMALE", clientUploadId: "original-upload-id", target: 99 })).status, 422);
  assert.equal((await call("GET", "accounts/self/avatar", undefined, "?target=99")).status, 422); assert.equal(f.requests.length, 0);
  f.queue.push(json({ ...SNAP, assetId: ID })); assert.equal((await call("PATCH", "accounts/self/avatar", input)).status, 200); assert.equal(f.requests.at(-1).path, "http://127.0.0.1:8110/api/admin/platform/accounts/self/avatar");
  f.queue.push(new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/jpeg" } })); const image = await call("GET", "accounts/self/avatar/content"); assert.equal(image.status, 200); assert.equal(image.headers.get("Cache-Control"), "no-store"); assert.equal(image.headers.get("X-Content-Type-Options"), "nosniff"); assert.equal((await image.arrayBuffer()).byteLength, 3);
  f.queue.push(new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } })); assert.equal((await call("GET", `accounts/self/avatar-assets/${ID}`)).status, 502);
});

test("expired original self avatar command survives reload but is query-only", async () => {
  const first = fixture(), pending = first.load("lib/admin/account-avatar-pending.ts");
  const fingerprint = "41:self-avatar-save", input = { assetId: ID, expectedVersion: "7", reason: "原明确更换本人头像理由" };
  pending.selfAvatarCommands.remember(fingerprint, KEY, { actorId: 41, input });
  assert.equal(pending.selfAvatarCommands.isDurablyStored(fingerprint, KEY), true);
  const persisted = JSON.parse(first.storage.get("nexion-self-avatar-save-v1"));
  const createdAt = Date.now() - 2 * 86400000, expiresAt = createdAt + 86400000;
  persisted[KEY].createdAt = createdAt; persisted[KEY].expiresAt = expiresAt;
  first.storage.set("nexion-self-avatar-save-v1", JSON.stringify(persisted));
  const reloaded = fixture(); for (const [key, value] of first.storage) reloaded.storage.set(key, value);
  const restored = reloaded.load("lib/admin/account-avatar-pending.ts");
  assert.equal(restored.selfAvatarCommands.isDurablyStored(fingerprint, KEY), true);
  const record = restored.selfAvatarCommands.list()[0];
  assert.deepEqual(record, { fingerprint, commandKey: KEY, createdAt, expiresAt, actorId: 41, input });
  let confirmed = 0;
  const editor = reloaded.load("app/components/domain-views/m-tabs/self-avatar-editor.tsx").SelfAvatarEditor;
  const view = reloaded.component(editor, { name: "本人客服", onChanged: snapshot => { assert.equal(snapshot.assetId, ID); confirmed++; }, ctx: { openActionConfirm() { assert.fail("Expired original command must block a new confirmation"); }, toast() {}, refreshContent: async () => {} } });
  view.render(); let tree = view.render(); reloaded.queue.push(json(SNAP)); button(tree, "更换本人头像").props.onClick(); await flush(); tree = view.render();
  assert.equal(button(tree, "使用原资料与命令重试").props.disabled, true);
  assert.equal(button(tree, "确认保存本人头像").props.disabled, true);
  // Even a stale callback invoked around the disabled control must GET only, never replay PATCH.
  reloaded.queue.push(json(SNAP)); await button(tree, "使用原资料与命令重试").props.onClick(); await flush(); tree = view.render();
  assert.ok(reloaded.requests.length >= 2); assert.ok(reloaded.requests.every(request => request.init.method === undefined));
  assert.deepEqual(restored.selfAvatarCommands.list(), [record], "Original key/body/reason/version/timestamps survive query-only recovery unchanged");
  assert.equal(confirmed, 0);
  reloaded.queue.push(json({ ...SNAP, assetId: ID, accountVersion: "8", avatarVersion: 3 })); button(tree, "查询原保存结果").props.onClick(); await flush();
  assert.equal(confirmed, 1); assert.equal(restored.selfAvatarCommands.list().length, 0);
  assert.ok(reloaded.requests.every(request => request.init.method === undefined)); view.dispose();
});
