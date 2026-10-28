import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const brand = {};
new Function("exports", compile(read("lib/admin/brand-copy.ts")))(brand);
function nodes(path) {
  const ast = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), result = [];
  const visit = node => { result.push(node); ts.forEachChild(node, visit); };
  visit(ast);
  return { ast, result };
}
function execute(source, bindings) {
  const exports = {};
  new Function("exports", "require", ...Object.keys(bindings), compile(source))(
    exports, id => { assert.equal(id, "react/jsx-runtime"); return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }; }, ...Object.values(bindings));
  return exports.render;
}
const content = node => Array.isArray(node) ? node.map(content).join("") : node == null ? "" : typeof node === "object" ? content(node.props?.children) : String(node);

test("the remaining M3 conversion command preserves source names in new ticket titles", async () => {
  for (const file of ["m3-sessions.tsx"]) {
    const { ast, result } = nodes(`app/components/domain-views/m-tabs/${file}`);
    const conversion = result.find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === "convertToTicket");
    assert.ok(conversion);
    const request = execute(`export async function render(row) {
      const selected=row, supportAgents=[{name:"Agent",adminId:7}], adminId=7, session={operator:"Agent"};
      const writable=true, pending=false, firstPending=false, checkActionReady=async()=>true, identityRef={current:"same"};
      let confirmation; const calls=[];
      const setParam=(key,value,meta)=>{ calls.push({key,payload:JSON.parse(value),meta}); return true; };
      const openActionConfirm=value=>{confirmation=value;}, ctx={setParam,openActionConfirm};
      const commitM3Write=run=>run();
      const convertToTicket=${conversion.initializer.getText(ast)};
      await convertToTicket(); await confirmation.run("valid reason"); return calls;
    }`, brand);
    for (const [nickname, phone, expected] of [
      ["Nexion 3778", "187****3778", "Nexion 3778"],
      ["NexGrid 3778", "187****3778", "NexGrid 3778"],
      ["NexGrid-F343FA44", undefined, "NexGrid-F343FA44"],
      ["Nexion 3778", undefined, "Nexion 3778"],
      ["Nexion 3778", "187****1058", "Nexion 3778"],
      ["My NexGrid name", "187****3778", "My NexGrid name"],
    ]) {
      const row = Object.freeze({ id:"CV-original", customer:nickname, agentName:"Agent", owner:"Agent",
        status:"open", version:4, detailReady:true, profile:Object.freeze({nickname,phone}) });
      const calls = await request(row);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].key, "I.session.ticket.__create");
      assert.equal(calls[0].meta.reason, "valid reason");
      assert.equal(calls[0].meta.commandKey, `m3:convert-ticket:CV-original${file === "m3-dedicated-chat.tsx" ? ":4" : ""}`);
      assert.deepEqual(calls[0].payload, { conversationNo:row.id, category:"account", priority:"normal",
        title:`由会话 CV-original 转入 · ${expected}`, assignedAdminId:7, assignedAdminName:"Agent",
        expectedStatus:"open", expectedVersion:4 });
      assert.equal(row.profile.nickname, nickname);
    }
  }
});

test("C2 actual account label and list cell share the formatter without changing source values", () => {
  const { ast, result } = nodes("app/components/domain-views/c-tabs/c2-actions.tsx");
  const declarations = ["text", "displayAccount"].map(name => result.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name).getText(ast));
  const cell = result.find(n => ts.isJsxElement(n) && n.openingElement.tagName.getText(ast) === "td" && n.getText(ast).includes("account.nickname"));
  const render = execute(`${declarations.join("\n")} export function render(account) { return [displayAccount(account), (${cell.getText(ast)})]; }`, brand);
  for (const [nickname, expected] of [["Nexion 3778", "Nexion 3778"], ["NexGrid-F343FA44", "NexGrid-F343FA44"], ["NexGrid Fan", "NexGrid Fan"]]) {
    const account = Object.freeze({ userNo: "60723153007", nickname, phoneMasked: "187****3778" });
    const [label, cell] = render(account);
    assert.equal(label, `60723153007 · ${expected}`);
    assert.equal(content(cell), expected);
    assert.equal(account.nickname, nickname);
  }
});

test("shared M1/M3/bulk actual SKU picker displays official brand and preserves selected product ID", () => {
  const { ast, result } = nodes("app/components/domain-views/m-tabs/support-content-tools.tsx");
  const button = result.find(n => ts.isJsxElement(n) && n.openingElement.tagName.getText(ast) === "button" && n.getText(ast).includes('skuId:s.id'));
  assert.ok(button);
  const render = execute(`export function render(s,onSelect) { const disabled=false, setPicker=()=>{}, Icon="icon"; return (${button.getText(ast)}); }`, brand);
  for (const [id, name, expected] of [["stellarbox-s1", "NexGridBox S1", "NexGridBox S1"], ["stellarbox-pro", "UVELBox Pro", "UVELBox Pro"], ["custom", "NexGridBox S1", "NexGridBox S1"]]) {
    const row = Object.freeze({ id, name }), calls = [], node = render(row, c => calls.push(c));
    assert.ok(content(node).includes(expected));
    node.props.onClick();
    assert.deepEqual(calls, [{ kind: "SKU", skuId: id, name: expected }]);
    assert.equal(row.name, name);
  }
});

test("actual M3 historical SKU card title uses official ID/name while free text remains untouched", () => {
  const { ast, result } = nodes("app/components/domain-views/m-tabs/m3-dedicated-chat.tsx");
  const title = result.find(n => ts.isJsxElement(n) && n.openingElement.tagName.getText(ast) === "strong" && n.getText(ast).includes("message.skuName"));
  assert.ok(title);
  const render = execute(`export function render(message) { return (${title.getText(ast)}); }`, brand);
  const message = Object.freeze({ skuId: "stellarbox-s1", skuName: "NexGridBox S1", text: "My NexGrid story", clientMessageId: "original-command" });
  assert.equal(content(render(message)), "NexGridBox S1");
  assert.equal(message.skuName, "NexGridBox S1");
  assert.equal(message.text, "My NexGrid story");
  assert.equal(message.clientMessageId, "original-command");
  assert.equal(content(render({ ...message, skuId: "custom" })), "NexGridBox S1");
});

test("legacy M3 session body uses the same exact SKU-caption rule", () => {
  const { ast, result } = nodes("app/components/domain-views/m-tabs/m3-sessions.tsx");
  const body = result.find(n => ts.isPropertyAssignment(n) && n.name.getText(ast) === "body" && n.initializer.getText(ast).includes(".text"));
  assert.ok(body);
  const render = execute(`export function render(m) { return ${body.initializer.getText(ast)}; }`, brand);
  const message = Object.freeze({ kind: "SKU", skuId: "stellarbox-s1", skuName: "NexGridBox S1", text: "NexGridBox S1" });
  assert.equal(render(message), "NexGridBox S1");
  assert.equal(render({ ...message, text: "推荐商品：NexGridBox S1" }), "推荐商品：NexGridBox S1");
  assert.equal(render({ ...message, text: "推荐商品：NexGridBox S1 很好" }), "推荐商品：NexGridBox S1 很好");
  assert.equal(render({ ...message, kind: "TEXT", text: "推荐商品：NexGridBox S1" }), "推荐商品：NexGridBox S1");
  assert.equal(render({ ...message, skuId: "custom", text: "推荐商品：NexGridBox S1" }), "推荐商品：NexGridBox S1");
  assert.equal(render({ ...message, text: "My NexGrid story" }), "My NexGrid story");
  assert.equal(render({ ...message, kind: "TEXT" }), "NexGridBox S1");
  assert.equal(render({ ...message, skuId: "custom" }), "NexGridBox S1");
  assert.equal(message.text, "NexGridBox S1");
});

test("C1 actual device and order columns normalize only proven SKU pairs and preserve quantities", () => {
  const { ast, result } = nodes("app/_console/users/search/[id]/page.tsx");
  const columns = ["name", "skuName"].map(key => result.find(n => ts.isObjectLiteralExpression(n)
    && n.properties.some(p => ts.isPropertyAssignment(p) && p.name.getText(ast) === "key" && p.initializer.getText(ast) === JSON.stringify(key))
    && n.properties.some(p => ts.isPropertyAssignment(p) && p.name.getText(ast) === "render")));
  assert.ok(columns.every(Boolean));
  const declarations = ["asText", "displayValue"].map(name => result.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name).getText(ast));
  const render = execute(`${declarations.join("\n")} export function render(device, order) { return [(${columns[0].getText(ast)}).render(device.name,device), (${columns[1].getText(ast)}).render(order.skuName,order)]; }`, brand);
  const device = Object.freeze({productCode:"stellarbox-pro-v2", name:"NexGridBox Pro v2"});
  const order = Object.freeze({skuId:"stellarbox-s1×1 + stellarbox-pro-v2×2", skuName:"NexGridBox S1×1 + NexGridBox Pro v2×2"});
  assert.deepEqual(render(device, order), [device.name, order.skuName]);
  assert.equal(device.name, "NexGridBox Pro v2");
  assert.equal(order.skuName, "NexGridBox S1×1 + NexGridBox Pro v2×2");
  assert.equal(render({...device,productCode:"custom"},order)[0], device.name);
  assert.equal(render({...device,name:"My NexGridBox Pro v2"},order)[0], "My NexGridBox Pro v2");
  for (const [id,name] of [[undefined,"NexGridBox S1×1"],["stellarbox-s1×2","NexGridBox S1×1"],["stellarbox-s1×1","NexGridBox S1×1 + unknown×1"],["custom×1","NexGridBox S1×1"],["stellarbox-s1×1","My NexGridBox S1×1"]]) {
    assert.equal((name),name);
  }
});

test("C2 actual session device cell shares the exact official platform label rule", () => {
  const {ast,result} = nodes("app/components/domain-views/c-tabs/c2-actions.tsx");
  const cell = result.find(n => ts.isJsxElement(n) && n.openingElement.tagName.getText(ast) === "td" && n.getText(ast).includes("session.deviceName"));
  const text = result.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="text").getText(ast);
  const render = execute(`${text} export function render(session) {return (${cell.getText(ast)});}`,brand);
  for(const [raw,expected] of [["NexGrid Phone App","NexGrid Phone App"],["NexGrid H5","NexGrid H5"],["My NexGrid Phone App","My NexGrid Phone App"]]) {
    const row=Object.freeze({deviceName:raw});
    assert.equal(content(render(row)),expected);
    assert.equal(row.deviceName,raw);
  }
});


test("dedicated chat keeps its retired ticket conversion unavailable", () => {
  const source = read("app/components/domain-views/m-tabs/m3-dedicated-chat.tsx");
  assert.doesNotMatch(source, /const convertToTicket\s*=/);
  assert.doesNotMatch(source, /I\.session\.ticket\.__create/);
});
