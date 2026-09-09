import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../lib/admin/m-client.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("m-client.ts", source, ts.ScriptTarget.Latest, true);
const names = ["num", "str", "bool", "requireLoadRaw", "loadNumber", "loadBoolean", "loadText", "adaptLoadConfig"];
const functions = names.map(name => {
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, `Missing real function ${name}`);
  return node.getText(ast);
}).join("\n");
const js = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const adapt = new Function(`${js}; return adaptLoadConfig;`)();
const loadConfig = { version: 5, autoBalance: false, defaultCap: 8, burstCap: 12, warnPct: 80,
  quietHourBalance: false, overflowQueue: "standby" };

test("M1 legacy load busy cannot pause a resumed profile or resume a paused profile", () => {
  for (const busy of [true, false]) {
    const result = adapt({ loadConfig, agentState: { "2": { busy: !busy, cap: 4 } } },
      [{ id: "2", busy, version: 9, maxConcurrent: 17 }]);
    assert.equal(result.agentState["2"].busy, busy);
    assert.equal(result.agentState["2"].cap, 4);
  }
});

test("M1 availability changes carry the visible profile version and rebalance does not mutate availability", () => {
  const component = readFileSync(new URL("../app/components/domain-views/m-tabs/m1-overview.tsx", import.meta.url), "utf8");
  assert.match(component, /const busy = Boolean\(a\.busy\)/);
  assert.match(component, /if \(busyMap\[r2\.id\] !== r2\.busy\) \{[\s\S]*?expectedProfileVersion = r2\.agent\.version/);
  assert.match(component, /agentState\[r2\.id\] = \{ cap: Number\(nc\) \}/);
  const rebalance = component.slice(component.indexOf("async function rebalance()"), component.indexOf("async function rebalance()") + 950);
  assert.doesNotMatch(rebalance, /busy: r\.busy/);
  assert.match(source, /params\[`I\.support\.agent\.\$\{agent\.name\}\.busy`\] = agent\.busy/);
});
