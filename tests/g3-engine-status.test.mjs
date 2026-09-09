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
    label: "已钉住 D3",
    detail: "当前帧已钉住，自动推进暂停。",
    tone: "warn",
  });
  assert.deepEqual({ ...derive(true, "未钉住") }, {
    label: "已暂停",
    detail: "现价冻结，自动推进已停止。",
    tone: "bad",
  });
  assert.deepEqual({ ...derive(false, "未钉住") }, {
    label: "按排程配置",
    detail: "是否推进以服务端排程执行为准。",
    tone: "",
  });
});

test("G3 shell removes the unsupported four-second feed assertion", () => {
  const shell = fs.readFileSync("app/components/domain-views/g-view.tsx", "utf8");
  assert.doesNotMatch(shell, /每 4 秒喂一次价/);
  assert.match(shell, /服务端排程与钉住状态决定更新/);
});
