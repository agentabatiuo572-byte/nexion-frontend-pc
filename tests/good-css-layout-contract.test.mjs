import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { hasNativeSelectTheme } from "../scripts/lib/native-select-theme-contract.mjs";
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("native select guard accepts grouped controls and rejects missing theme or popup colors", () => {
  const css = read("app/globals.css");
  assert.equal(hasNativeSelectTheme(css), true);
  assert.equal(hasNativeSelectTheme(css
    .replace('select, input[type="date"], input[type="datetime-local"]', 'select')
    .replace(':is(select, input[type="date"], input[type="datetime-local"])', 'select')), true);
  for (const [name, candidate] of [
    ["light select target", css.replace('select, input[type="date"]', 'textarea, input[type="date"]')],
    ["dark select target", css.replace(':is(select, input[type="date"]', ':is(textarea, input[type="date"]')],
    ["dark scheme", css.replace('color-scheme: dark;', 'color-scheme: light;')],
    ["popup background", css.replace('background-color: var(--v5-surface)', 'background-color: transparent')],
    ["popup foreground", css.replace(/(select optgroup\s*\{[^}]*?)color: var\(--v5-ink\);/, '$1color: inherit;')],
    ["comment-only evidence", `/* ${css.replace(/\/\*[\s\S]*?\*\//g, "")} */`],
  ]) assert.equal(hasNativeSelectTheme(candidate), false, name);
});

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
  const css = read("app/components/domain-views/ui-consistency.css");
  assert.match(source, /className="ui-form-grid"/);
  assert.match(css, /\.dkpage \.ui-form-grid\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*220px\),\s*1fr\)\)/);
  assert.match(css, /\.dkpage \.ui-form-grid > label\s*\{[^}]*min-width:\s*0/);
  const nativeControls = /\.dkpage \.ui-form-grid :is\(input:not\(\[type="checkbox"\]\), select, textarea\)/;
  assert.match(css, new RegExp(nativeControls.source + "[^{}]*\\{[^}]*min-width:\\s*0;[^}]*max-width:\\s*100%"));
  assert.match(css, new RegExp(nativeControls.source + "\\s*\\{\\s*width:\\s*100%"));
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
