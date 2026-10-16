import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const business = {};
new Function("exports", compile(read("lib/admin/business-time.ts")))(business);
function formatter(path, name) {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find(node =>
    (ts.isFunctionDeclaration(node) && node.name?.text === name) ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(source) === name)));
  assert.ok(declaration, `actual ${name} formatter exists`);
  const exports = {};
  new Function("exports", "formatBusinessTime", "asText", compile(`${declaration.getText(source)}\nexport {${name}};`))(
    exports, business.formatBusinessTime, (value, fallback) => typeof value === "string" ? value : fallback);
  return exports[name];
}
const drawer = formatter("app/components/domain-views/m-tabs/m3-customer-profile.tsx", "dates");
const full = formatter("app/_console/users/search/[id]/page.tsx", "formatDate");

for (const zone of ["Asia/Tokyo", "Asia/Shanghai", "UTC"]) {
  test(`same customer instant uses labelled business time in ${zone}`, () => {
    const previous = process.env.TZ;
    process.env.TZ = zone;
    try {
      for (const [utc, local, expected] of [
        ["2026-09-11T10:00:00Z", "2026-09-11 18:00:00", "18:00"],
        ["2026-10-16T05:14:00Z", "2026-10-16T13:14:00", "13:14"],
        ["2026-12-31T16:01:00Z", "2027-01-01 00:01:00", "00:01"],
      ]) {
        for (const render of [drawer, full]) {
          assert.equal(render(utc), render(local), "offset and business-local representations must agree");
          assert.ok(render(utc).includes(expected), render(utc));
          assert.ok(render(utc).includes("北京时间"), "display identifies its time zone");
          assert.equal(render(utc), render(utc.replace("Z", "+00:00")));
        }
      }
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
}
test("empty and invalid customer dates remain unknown rather than fabricated times", () => {
  for (const value of [null, undefined, "", "   ", "not-a-date", "2026-99-99 28:61:00", 0]) {
    assert.equal(drawer(value), "未知");
    assert.equal(full(value), "-");
  }
});
