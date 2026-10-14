import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import "./support-compact-regression-r20.test.mjs";
const require = createRequire(import.meta.url);
const read = name => fs.readFileSync(new URL(`../app/components/domain-views/m-tabs/${name}.tsx`, import.meta.url), "utf8");
const tree = source => ts.createSourceFile("component.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = (source, names) => tree(source).statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText()).join("\n");
function evaluate(source, bindings = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, require: id => id.endsWith(".css") ? {} : require(id), ...bindings });
  return module.exports;
}
const board = evaluate(read("support-leaderboard"));
export const compactSupportBoardValue = board.compactSupportBoardValue;
test("actual self progress keeps units in the title and exact detail across boards, periods and missing values", () => {
  for (const [key, title] of [["netContribution", "净贡献额"], ["firstPayment", "首充人数"], ["customers", "客户规模"]]) {
    for (const currency of ["USDT", "NEX"]) for (const month of ["2026-09", "2026-10"]) for (const value of ["9007199254740993", "0", null, ...(key === "netContribution" ? ["-9007199254740993"] : [])]) {
      const money = key === "netContribution", unit = money ? currency : "人", amount = value === null ? null : value === "0" ? "0" : value + ".01";
      const row = { id: "self", name: "本人成绩", groupName: "客服组", rank: 1, rankStatus: "confirmed", isTied: false, movement: { kind: "same", explanation: "持平" }, canViewCustomers: false,
        amount: { value: amount, currency, periodLabel: key === "customers" ? "2026-10" : month, sourceVersion: "current", coverage: "complete" }, firstPayment: { value, coverage: "complete" }, customers: { value, coverage: "complete" } };
      const props = { query: { board: key, currency, month, scope: "all" }, currentMonth: "2026-10", periodLabel: month, status: "ready", rows: [], self: { row, gap: null }, monthOptions: [], scopeOptions: [], currencyOptions: [], updatedAt: "2026-10-10", disclosure: "", onRetry() {}, onLocateSelf() {}, onViewPerformance() {}, onQueryChange() {} };
      const html = renderToStaticMarkup(React.createElement(board.SupportLeaderboard, props));
      const self = html.match(/<div class="sl-self-score">([\s\S]*?)<\/aside>/)?.[1];
      assert.ok(self, "Actual self progress rendered");
      const period = key === "customers" ? "截至现在" : month.replace("-", ".");
      assert.ok(self.includes(`<span>${title}（${unit} · ${period}）</span>`));
      assert.doesNotMatch(self, /<small>(?:人|USDT|NEX)<\/small>/, "No unit appears next to the compact self number");
      if (value === null) assert.match(self, /<strong>-<\/strong>/);
      else assert.ok(self.includes(`${money ? amount : value} ${unit}`), "Actual aria label and exact detail retain source precision and unit");
    }
  }
});
test("actual shared compact formatter distinguishes missing/invalid values from real zero and exact decimals", () => {
  for (const value of [undefined, null, "", " ", "abc", "NaN", "Infinity", NaN, Infinity, -Infinity, {}, false]) {
    for (const kind of ["amount", "count"]) assert.equal(compactSupportBoardValue(value, kind), "-", `${String(value)}/${kind}`);
  }
  for (const value of [0, "0", "0.000", "-0", "+0"]) assert.equal(compactSupportBoardValue(value), "0");
  for (const [value, kind, expected] of [["12500","amount","12.5K"],["999.99","amount","999.99"],["0.00000001","amount","<0.01"],["-1","count","-"],["1.5","count","-"],["999999999999999999999.12345678","amount","1000000000T"]]) assert.equal(compactSupportBoardValue(value, kind), expected);
});
test("actual M1 numeric consumer uses ASCII dash without extra card copy and preserves zero/drill/recovery context", () => {
  const actual = evaluate(functions(read("m1-analytics-workbench"), ["Numeric"]) + "\nexport {Numeric};", { compactSupportBoardValue });
  const onClick = () => {}, numeric = actual.Numeric;
  for (const value of [undefined, null, "", "bad"]) {
    const node = numeric({ value, observed: "9", label: "余额 USDT", kind: "amount", onClick });
    assert.equal(node.props.children.props.children, "-");
    assert.equal(node.props.children.props.onClick, onClick);
    assert.match(node.props.children.props.title, /已观测 9/);
    const html = renderToStaticMarkup(node); assert.doesNotMatch(html, /<small>/); assert.match(html, />-<\/button>/);
  }
  assert.equal(numeric({ value: "0", label: "绑定人数" }).props.children.props.children, "0");
});
test("actual board amount/count consumers never show long unknown copy in a numeric slot", () => {
  const source = functions(read("support-leaderboard"), ["NumberValue", "Count", "availableCountValue"]);
  const actual = evaluate(source + "\nexport {NumberValue,Count};", { compactSupportBoardValue, Explanation: props => React.createElement("span", {}, props.summary) });
  for (const value of [null, undefined, "", "bad"]) assert.equal(renderToStaticMarkup(React.createElement(actual.NumberValue,{value,kind:"amount",label:"业绩",unit:"USDT"})), "<strong>-</strong>");
  for (const coverage of ["complete", "partial", "unavailable"]) {
    const html = renderToStaticMarkup(React.createElement(actual.Count,{metric:{value:"0",coverage},onView(){}}));
    assert.match(html, coverage === "unavailable" ? /<strong>-<\/strong>/ : />0<\/button>/);
    assert.equal(html.includes("sl-customer-link"), coverage !== "unavailable");
  }
});
test("actual compact list/header totals use existing read availability instead of empty-array fake zeros", () => {
  const cases = [
    ["m2-tickets", "ticketsAvailable ? filtered.length : \"-\"", { filtered: [] }, "ticketsAvailable"],
    ["m2-tickets", "ticketsAvailable ? resolvedCount : \"-\"", { resolvedCount: 0 }, "ticketsAvailable"],
    ["m2-tickets", "ticketsAvailable ? archivedCount : \"-\"", { archivedCount: 0 }, "ticketsAvailable"],
    ["m3-dedicated-chat", "conversationsAvailable ? visible.filter(c=>tabMatch(c,value)).length : \"-\"", { visible: [], tabMatch:()=>true,value:"all" }, "conversationsAvailable"],
    ["m4-kb-sla", "knowledgeAvailable ? faqs.length : \"-\"", { faqs: [] }, "knowledgeAvailable"],
    ["m5-scripts", "sessionTemplatesAvailable ? scriptTotal : \"-\"", { scriptTotal: 0 }, "sessionTemplatesAvailable"],
    ["m5-scripts", "sessionTemplatesAvailable ? replyTemplateTotal : \"-\"", { replyTemplateTotal: 0 }, "sessionTemplatesAvailable"],
  ];
  for (const [file, expression, bindings, flag] of cases) {
    assert.ok(read(file).includes(expression), `${file}: actual guarded consumer missing`);
    assert.equal(vm.runInNewContext(expression,{...bindings,[flag]:false}),"-");
    assert.equal(vm.runInNewContext(expression,{...bindings,[flag]:true}),0);
  }
  const m5 = read("m5-scripts");
  for (const field of ["delayMs", "cooldownHours", "maxPerSession"]) assert.equal((m5.match(new RegExp(`tileVal\\(\\x60\\$\\{policyDisplay\\("${field}"`,"g")) ?? []).length,2);
  const declarations = [];
  function findPolicy(node) { if (ts.isVariableDeclaration(node) && node.name.getText() === "policyDisplay") declarations.push(node.getText()); ts.forEachChild(node,findPolicy); }
  findPolicy(tree(m5)); assert.equal(declarations.length,1);
  for (const available of [true,false]) for (const value of [undefined,null,"","bad","NaN","0","1500"]) {
    const actual = evaluate(`const ${declarations[0]};export {policyDisplay};`,{sessionTemplatesAvailable:available,compactSupportBoardValue,pget:()=>value,POLICY_KEY:field=>field});
    assert.equal(actual.policyDisplay("delayMs"),available && ["0","1500"].includes(value)?value:"-");
  }
  assert.match(m5,/agentPageAvailable \? agentTotal : "-"/);
  assert.match(m5,/Boolean\(agentPageData\) && !agentPageLoading && !agentPageError && hasM1ReadAuthority && pget\("I\.support\.agentsAvailable"\) === "1"/);
});
test("actual profile numeric fields use dash while exact values, financial status and reread stay intact", () => {
  const source = read("m3-customer-profile");
  const actual = evaluate(functions(source,["Row"]) + "\nexport {Row};", { compactSupportBoardValue, show: value => value == null ? "未知" : String(value) });
  for (const value of [undefined,null,"",NaN,Infinity,"abc"]) assert.match(renderToStaticMarkup(React.createElement(actual.Row,{label:"余额",value,numeric:true})),/<span class="v">-<\/span>/);
  for (const value of [0,"0","9007199254740993.12345678"]) assert.ok(renderToStaticMarkup(React.createElement(actual.Row,{label:"余额",value,numeric:true})).includes(`>${value}</span>`));
  assert.match(source,/!\(state==="READY"\|\|state==="PARTIAL"\)\|\|compactSupportBoardValue\(row\[key\]\)==="-"\?"-"/);
  assert.match(source,/重新读取资金/); assert.match(source,/retryGroup\("finance"\)/);
  for (const label of ["本金","费用","实际到账","实际总算力","实际算力","实际收益"]) assert.ok(source.includes(`<Row numeric label="${label}"`));
  for (const label of ["持有设备","在网设备","维护执行次数","维护周期总数"]) assert.ok(source.includes(`<Row numeric="count" label="${label}"`));
  assert.match(read("m1-personal-workbench"),/overviewLoading \|\| count === null \? "-"/);
  assert.doesNotMatch(read("m1-personal-workbench"),/\?\? "—"\}<\/strong>/);
});
test("actual M1 pool, member pagination and random preview keep missing counts distinct from zero", () => {
  const pool = read("m1-supervisor-pool"), groups = read("m1-group-management"), random = read("support-random-assignment"), profile = read("m3-customer-profile");
  assert.ok(pool.includes('compactSupportBoardValue(item.attempts,"count")'));
  assert.ok(pool.includes('compactSupportBoardValue(item.pendingMessageCount,"count") === "-" ? "-"'));
  assert.ok(pool.includes('compactSupportBoardValue(target.currentActiveSessions,"count")'));
  assert.ok(profile.includes('compactSupportBoardValue(total,"count") === "-" ? "-" : show(total)'));
  for (const [source, expression, bindings] of [
    [groups, '!candidates ? "-" : Math.max(1, Math.ceil(candidates.total / PAGE_SIZE))', { PAGE_SIZE: 10 }],
    [random, 'preview?.count??"-"', {}],
    [random, 'preview?.excluded.length??"-"', {}],
  ]) {
    assert.ok(source.includes(expression));
    assert.equal(vm.runInNewContext(expression, {...bindings,candidates:null,preview:null}), "-");
    const observed = vm.runInNewContext(expression, {...bindings,candidates:{total:0},preview:{count:0,excluded:[]}});
    assert.equal(observed, expression.includes('Math.max') ? 1 : 0);
  }
  assert.ok(groups.includes('selectedId && !currentDetail ? "-" : Math.max'));
  assert.doesNotMatch(random, /preview\?\.count\?\?0|preview\?\.excluded.length\?\?0/);
  assert.ok(read("support-content-tools").includes('available ? filtered.length : "-"'));
  assert.ok(read("m3-dedicated-chat").includes('conversationsAvailable ? filtered.length : "-"'));
  assert.ok(read("m1-personal-workbench").includes('`共 ${rows ? rows.total : "-"} 位`'));
  const m5 = read("m5-scripts");
  assert.equal((m5.match(/<Pager available=/g) ?? []).length,3);
  const actual = evaluate(functions(m5,["Pager"]) + "\nexport {Pager};",{totalPages:()=>1,clampPage:()=>1,Icon:()=>null});
  const missing = renderToStaticMarkup(React.createElement(actual.Pager,{page:1,total:0,pageSize:10,onPage(){},available:false}));
  assert.doesNotMatch(missing,/暂无记录|1 \/ 1/);assert.equal((missing.match(/>-<\/span>/g)??[]).length,2);
  assert.match(renderToStaticMarkup(React.createElement(actual.Pager,{page:1,total:0,pageSize:10,onPage(){},available:true})),/暂无记录/);
});
