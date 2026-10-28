import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function runtimeStatus() {
  const source = fs.readFileSync("app/components/domain-views/g-tabs/g3-market.tsx", "utf8");
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports: module.exports, module, require: () => ({}), console },
  );
  return module.exports.deriveG3RuntimeStatus;
}

test("G3 derives pinned and paused presentation from actual controls without inventing engine health", () => {
  const derive = runtimeStatus();
  assert.equal(typeof derive, "function");
  assert.deepEqual({ ...derive(false, "D3") }, {
    label: "已固定在 D3",
    detail: "价格固定用这一天的设置，不再自动切换到下一天。",
    tone: "warn",
  });
  assert.deepEqual({ ...derive(true, "未钉住") }, {
    label: "已暂停",
    detail: "价格停在当前值，不再自动变化。",
    tone: "bad",
  });
  assert.deepEqual({ ...derive(false, "未钉住") }, {
    label: "按计划自动运行",
    detail: "每天按设定时间自动切换到下一天的价格。",
    tone: "",
  });
});

test("G3 shell removes the unsupported four-second feed assertion", () => {
  const shell = fs.readFileSync("app/components/domain-views/g-view.tsx", "utf8");
  assert.doesNotMatch(shell, /每 4 秒喂一次价/);
});
