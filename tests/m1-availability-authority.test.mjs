import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../lib/admin/m-client.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("m-client.ts", source, ts.ScriptTarget.Latest, true);
const names = ["num", "str", "bool", "requireLoadRaw", "loadNumber", "loadBoolean", "loadText", "adaptLoadConfig", "asArray", "asStringArray", "supportServiceType", "adaptSupportAgent"];
const functions = names.map(name => {
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, `Missing real function ${name}`);
  return node.getText(ast);
}).join("\n");
const js = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const adapt = new Function(`${js}; return adaptLoadConfig;`)();
const adaptAgent = new Function(`${js}; return adaptSupportAgent;`)();
const loadConfig = { version: 5, autoBalance: false, defaultCap: 8, burstCap: 12, warnPct: 80,
  quietHourBalance: false, overflowQueue: "standby" };

test("M1 page adapter keeps the account and assignment facts exact, including unavailable asset owners", () => {
  const agent = {id:"7",adminId:7,name:"专属客服",status:"enabled",enabled:true,assignmentEligible:true,busy:true};
  assert.equal(adaptAgent(agent).assignmentEligible, true);
  const disabled = adaptAgent({...agent,status:"disabled",assignmentEligible:false});
  assert.equal(disabled.status, "disabled"); assert.equal(disabled.enabled, true); assert.equal(disabled.assignmentEligible, false);
  for (const changes of [{adminId:undefined},{adminId:0},{id:undefined},{assignmentEligible:undefined},{assignmentEligible:null},{status:undefined},{status:"disabled"},{enabled:false}]) {
    assert.throws(() => adaptAgent({...agent,...changes}), /MALFORMED/);
  }
});

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
