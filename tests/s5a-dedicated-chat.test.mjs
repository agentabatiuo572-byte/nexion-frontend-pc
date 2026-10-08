import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("app/components/domain-views/m-tabs/m3-dedicated-chat.tsx", "utf8");
const file = ts.createSourceFile("m3-dedicated-chat.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = file.statements.flatMap((statement) => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])
  .find((item) => item.name.getText(file) === "validCustomerId");
assert.ok(declaration?.initializer);
const compiled = ts.transpileModule(`export const validCustomerId = ${declaration.initializer.getText(file)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { validCustomerId } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);

test("invalid customer links stop before requesting customer detail", () => {
  for (const value of ["1", "0001", "9223372036854775807"]) assert.equal(validCustomerId(value), true);
  for (const value of [null, "", "0", "000", "abc", "12x", "-1", "1.5", " 1 "]) assert.equal(validCustomerId(value), false);
  assert.match(source, /if \(!validCustomerId\(requestedCustomerId\) \|\| requestedConvo \|\| !conversationsAvailable \|\| qualificationUnknown\)/);
  assert.match(source, /all\.filter\(\(convo\) => validCustomerId\(customerIdOf\(convo\)\)/);
});
