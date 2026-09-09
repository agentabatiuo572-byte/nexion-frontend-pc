import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const view = readFileSync(new URL("../app/components/domain-views/i-view.tsx", import.meta.url), "utf8");
const start = view.indexOf("const reloadIContent = useCallback");
const end = view.indexOf("  }, [scopeKey, tab]);", start) + "  }, [scopeKey, tab]);".length;
if (start < 0 || end <= start) throw new Error("I content reload handler not found");

const handlerSource = view.slice(start, end);
assert.ok(view.indexOf("contentRequestSequence.current += 1;") < view.indexOf("void reloadIContent();"));
const compiled = ts.transpileModule([
  "function makeReload(deps) {",
  "const { tab, scopeKey, fetchIContentOverviews, setContentSnapshot, contentRequestSequence, contentErrorForTab } = deps;",
  "const useCallback = (callback) => callback;",
  handlerSource,
  "return reloadIContent;",
  "}",
  "module.exports = { makeReload };",
].join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const module = { exports: {} };
new Function("module", "exports", compiled)(module, module.exports);
const { makeReload } = module.exports;
const scopeEffectStart = view.indexOf("  useEffect(() => {\n    // A completed request from the prior route or auth/permission generation");
const scopeEffectEnd = view.indexOf("  }, [scopeKey]);", scopeEffectStart) + "  }, [scopeKey]);".length;
if (scopeEffectStart < 0 || scopeEffectEnd <= scopeEffectStart) throw new Error("I content scope invalidation effect not found");
const scopeEffectSource = view.slice(scopeEffectStart, scopeEffectEnd);
const scopeEffectCompiled = ts.transpileModule([
  "function makeScopeInvalidation(deps) {",
  "const { contentRequestSequence, setActionConfirm, setCf, scopeKey } = deps;",
  "let installed;",
  "const useEffect = (callback) => { installed = callback; };",
  scopeEffectSource,
  "return installed;",
  "}",
  "module.exports = { makeScopeInvalidation };",
].join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const scopeEffectModule = { exports: {} };
new Function("module", "exports", scopeEffectCompiled)(scopeEffectModule, scopeEffectModule.exports);
const { makeScopeInvalidation } = scopeEffectModule.exports;

test("I5 background overview reload does not clear the mounted draft before its response", async () => {
  let finish;
  let snapshot = {
    data: { trustDisclosure: { jurisdictions: ["VN"] } },
    dataScope: "I5\\u0000operator-a",
    loading: false,
    error: null,
    errorScope: null,
  };
  const reload = makeReload({
    tab: "I5",
    scopeKey: "I5\\u0000operator-a",
    fetchIContentOverviews: () => new Promise((resolve) => { finish = resolve; }),
    setContentSnapshot: (next) => { snapshot = typeof next === "function" ? next(snapshot) : next; },
    contentRequestSequence: { current: 0 },
    contentErrorForTab: () => null,
  });

  const pending = reload();
  assert.deepEqual(snapshot.data, { trustDisclosure: { jurisdictions: ["VN"] } });
  assert.equal(snapshot.loading, true);
  finish({ trustDisclosure: { jurisdictions: [] } });
  await pending;
});

test("I5 keeps only the newest same-scope overview response", async () => {
  const finish = [];
  let snapshot = { data: {}, dataScope: "I5\\u0000operator-a", loading: false, error: null, errorScope: null };
  const reload = makeReload({
    tab: "I5",
    scopeKey: "I5\\u0000operator-a",
    fetchIContentOverviews: () => new Promise((resolve) => finish.push(resolve)),
    setContentSnapshot: (next) => { snapshot = typeof next === "function" ? next(snapshot) : next; },
    contentRequestSequence: { current: 0 },
    contentErrorForTab: () => null,
  });

  const first = reload();
  const second = reload();
  finish[0]({ trustDisclosure: { marker: "old" } });
  await first;
  assert.deepEqual(snapshot.data, {});
  finish[1]({ trustDisclosure: { marker: "new" } });
  await second;
  assert.deepEqual(snapshot.data, { trustDisclosure: { marker: "new" } });
});

test("I5 retains the same-scope draft snapshot and exposes an error when its background poll fails", async () => {
  let reject;
  let snapshot = {
    data: { trustDisclosure: { draft: { version: "1.0" } } },
    dataScope: "I5\\u0000operator-a",
    loading: false,
    error: null,
    errorScope: null,
  };
  const reload = makeReload({
    tab: "I5",
    scopeKey: "I5\\u0000operator-a",
    fetchIContentOverviews: () => new Promise((_, fail) => { reject = fail; }),
    setContentSnapshot: (next) => { snapshot = typeof next === "function" ? next(snapshot) : next; },
    contentRequestSequence: { current: 0 },
    contentErrorForTab: () => null,
  });

  const pending = reload();
  reject(new Error("offline"));
  await pending;
  assert.deepEqual(snapshot.data, { trustDisclosure: { draft: { version: "1.0" } } });
  assert.equal(snapshot.error, "I5 数据加载失败，请刷新重试");
  assert.equal(snapshot.errorScope, "I5\\u0000operator-a");
});

test("I5 retains the same-scope draft snapshot when its background poll resolves a trust-disclosure error", async () => {
  let snapshot = {
    data: { trustDisclosure: { draft: { version: "1.0" } } },
    dataScope: "I5\\u0000operator-a",
    loading: false,
    error: null,
    errorScope: null,
  };
  const reload = makeReload({
    tab: "I5",
    scopeKey: "I5\\u0000operator-a",
    fetchIContentOverviews: async () => ({
      errors: { trustDisclosure: "I4 数据加载失败，请刷新重试" },
    }),
    setContentSnapshot: (next) => { snapshot = typeof next === "function" ? next(snapshot) : next; },
    contentRequestSequence: { current: 0 },
    contentErrorForTab: (_tab, content) => content.errors?.trustDisclosure
      ? "I5 数据加载失败，请刷新重试"
      : null,
  });

  await reload();

  assert.deepEqual(snapshot.data, { trustDisclosure: { draft: { version: "1.0" } } });
  assert.equal(snapshot.error, "I5 数据加载失败，请刷新重试");
  assert.equal(snapshot.errorScope, "I5\\u0000operator-a");
});
test("an old tab or permission scope cannot overwrite the new I5 scope", async () => {
  const finish = [];
  const contentRequestSequence = { current: 0 };
  let snapshot = { data: {}, dataScope: null, loading: true, error: null, errorScope: null };
  const common = {
    tab: "I5",
    fetchIContentOverviews: () => new Promise((resolve) => finish.push(resolve)),
    setContentSnapshot: (next) => { snapshot = typeof next === "function" ? next(snapshot) : next; },
    contentRequestSequence,
    contentErrorForTab: () => null,
  };
  const oldReload = makeReload({ ...common, scopeKey: "I5\\u0000operator-a" });
  const currentReload = makeReload({ ...common, scopeKey: "I5\\u0000operator-b" });

  const oldRequest = oldReload();
  const currentRequest = currentReload();
  finish[0]({ trustDisclosure: { marker: "old" } });
  await oldRequest;
  assert.equal(snapshot.dataScope, null);
  finish[1]({ trustDisclosure: { marker: "current" } });
  await currentRequest;
  assert.equal(snapshot.dataScope, "I5\\u0000operator-b");
  assert.deepEqual(snapshot.data, { trustDisclosure: { marker: "current" } });
});

test("I5 permission-scope change clears the installed confirmation closures without clearing same-scope drafts", () => {
  let actionConfirm = { run: () => { throw new Error("old action closure ran"); } };
  let confirm = { onConfirm: () => { throw new Error("old confirmation closure ran"); } };
  const contentRequestSequence = { current: 7 };
  const invalidate = makeScopeInvalidation({
    contentRequestSequence,
    setActionConfirm: (next) => { actionConfirm = next; },
    setCf: (next) => { confirm = next; },
  });

  invalidate();

  assert.equal(contentRequestSequence.current, 8);
  assert.equal(actionConfirm, null);
  assert.equal(confirm, null);
  assert.equal(actionConfirm && actionConfirm.run, null);
  assert.equal(confirm && confirm.onConfirm, null);
});