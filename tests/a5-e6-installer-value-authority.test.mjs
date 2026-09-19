import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

/**
 * A5 参数寄存器不得把「已存储但未生效」的值展示成当前生效值(zentao #156)。
 *
 * E6 用 isSafeInstallerUrl 判定客户端下载地址;A5 当时直接渲染库里的原值,于是同一
 * 事实在两页矛盾:一个说「未配置 · 当前无用户下载入口」,另一个说当前服务端值就是
 * 那个无效地址。这里守住两条:判定只有一份实现,且 A5 渲染前必须过它。
 */

const ROOT = new URL("..", import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, ROOT), "utf8");

function loadShared() {
  const src = read("lib/admin/installer-url.ts");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", "require", "URL", "RegExp", js)(module.exports, module, () => ({}), URL, RegExp);
  return module.exports;
}

test("安装包地址判定是单一实现:E6 与 A5 都从共享模块取", () => {
  const e6 = read("lib/admin/e6-client.ts");
  const a5 = read("app/_console/platform/params-registry/params-registry-client.tsx");
  assert.match(e6, /export\s*\{[^}]*isSafeInstallerUrl[^}]*\}\s*from\s*"@\/lib\/admin\/installer-url"/s,
    "e6-client 必须转出共享判定,不得自留一份");
  assert.match(a5, /import\s*\{\s*isSafeInstallerUrl\s*\}\s*from\s*"@\/lib\/admin\/installer-url"/,
    "A5 必须引用共享判定");
  const e6Component = read("app/components/domain-views/e-tabs/e6-compute-config.tsx");
  assert.doesNotMatch(e6Component, /function\s+isSafeInstallerUrl\s*\(/,
    "E6 组件内不得再保留第二份实现");
  assert.match(e6Component, /import\s*\{\s*isSafeInstallerUrl\s*\}\s*from\s*"@\/lib\/admin\/installer-url"/);
});

test("A5 把未生效的值标成未生效,而不是当前服务端值", () => {
  const a5 = read("app/_console/platform/params-registry/params-registry-client.tsx");
  assert.match(a5, /rowValueEffective\(row\)/);
  assert.match(a5, /"当前服务端值 · 未生效"/);
  assert.match(a5, /已存储 · 未生效/);
  assert.match(a5, /不会下发给用户端/);
  // 有效性判定必须真的调用共享规则,不能只看非空。
  assert.match(a5, /isSafeInstallerUrl\(row\.currentValue\.trim\(\)\)/);
});

test("共享判定:被 E6 隔离的值一律判为无效", () => {
  const { isSafeInstallerUrl } = loadShared();
  // #156 的实际值:http 而非 https,且不是安装包扩展名。
  assert.equal(isSafeInstallerUrl("https://www.baidu.com"), false, "被屏蔽主机必须判无效");
  assert.equal(isSafeInstallerUrl("http://cdn.nexgrid.io/app/setup.exe"), false, "非 HTTPS 必须判无效");
  assert.equal(isSafeInstallerUrl("https://cdn.nexgrid.io/app/setup.exe"), true, "受控 HTTPS 安装包地址应通过");
  assert.equal(isSafeInstallerUrl(""), false);
  assert.equal(isSafeInstallerUrl("not a url"), false);
  assert.equal(isSafeInstallerUrl("https://user:pw@cdn.nexgrid.io/setup.exe"), false, "带凭据必须判无效");
  assert.equal(isSafeInstallerUrl("https://cdn.nexgrid.io/setup.exe#frag"), false, "带片段必须判无效");
});
