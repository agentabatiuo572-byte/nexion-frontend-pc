import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("countdown retains five tabular character slots across ten-minute boundary", () => {
  const source = read("app/components/domain-views/c-tabs/c2-actions.tsx");
  const ast = ts.createSourceFile("actions.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "formatCountdown");
  const js = ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const format = vm.runInNewContext(`${js};formatCountdown`);
  assert.equal(format(600), "10:00"); assert.equal(format(599), "09:59");
  assert.equal(format(0), "00:00"); assert.equal(format(-1), "00:00");
  assert.match(source, /className="inline-block min-w-\[5ch\] tabular-nums" data-testid="impersonation-countdown"/);
});

test("C1 filter tracks adapt to content width with shrinkable native controls", () => {
  const source = read("app/components/domain-views/c-tabs/c1-search.tsx");
  assert.ok(source.includes("grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))]"));
  assert.ok(source.includes("[&>*]:min-w-0 [&>*]:w-full"));
  assert.doesNotMatch(source, /sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6/);
});

test("login and pager keep explicit visible outlines; brief uses native disclosure", () => {
  const login = read("app/components/shell/login-gate.tsx");
  const design = read("app/components/domain-views/design-kit.tsx");
  assert.doesNotMatch(login, /outline-none/);
  assert.equal((login.match(/login-field/g) || []).length, 5);
  const brief = design.slice(design.indexOf("export function OperatorBriefBlock"), design.indexOf("const DEFAULT_GRANTS"));
  assert.match(brief, /<details className="tint brand operator-brief"/);
  assert.match(brief, /<summary/); assert.doesNotMatch(brief, /useState|setOpen|aria-expanded/);
  const css = read("app/globals.css");
  assert.match(css, /\.login-field:focus-visible/);
  assert.match(css, /\.dkpage \.pager-page-size:focus-visible/);
  assert.match(css, /\.dkpage button\.icon-btn \{ min-inline-size: 44px; min-block-size: 44px; \}/);
});
