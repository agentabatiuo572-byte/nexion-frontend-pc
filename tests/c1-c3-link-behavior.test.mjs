import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../app/_console/users/search/[id]/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const page = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "UserDetailPage");
const declarations = page.body.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []);
const binding = name => declarations.find(node => node.name.getText(ast) === name);
const names = ["canReadC3", "canReadC5", "requestedReturnTo", "returnTo", "profile", "summary", "userId", "userNo", "c3UserId"];
const code = names.flatMap(name => binding(name) ? [`const ${binding(name).getText(ast)};`] : []);
let section;
function findSection(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "Section"
    && node.openingElement.attributes.properties.some(attr => ts.isJsxAttribute(attr)
      && attr.name.text === "title" && attr.initializer?.text === "关联处置入口")) section = node;
  ts.forEachChild(node, findSection);
}
findSection(page); assert.ok(section, "actual C1 related-action links");
const asText = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "asText").getText(ast);
const compiled = ts.transpileModule(`${asText}\nexport function Fixture({detail,session,searchParams}) {
  const canReadC2=false, canReadC6=false, canReadD2=false, canReadD4=false, canReadK4=false, canReadA2=false, canWriteC1=false;
  const actionPending=null; ${code.join("\n")} return (${section.getText(ast)}); }`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const element = (type, props) => ({ type, props });
const Link = Symbol("actual Next Link binding"), exports = {};
new Function("require", "exports", "Link", "Section", "ShieldAlert", compiled)(
  id => { assert.equal(id, "react/jsx-runtime"); return {jsx:element,jsxs:element}; }, exports, Link, "section", "icon");
function all(node) {
  return !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(all) : [node,...all(node.props?.children)];
}
function links({id=42, summaryId, role="auditor", authorities=["user_c3_read"], returnTo="/users/search?keyword=fixture&seg=all"}={}) {
  const detail={profile:{id,userNo:"U-FIXTURE"},summary:{userId:summaryId}};
  return all(exports.Fixture({detail,session:{role,authorities},searchParams:{get:key=>key==="returnTo"?returnTo:null}}))
    .filter(node=>node.type===Link).map(node=>node.props.href);
}
const c3 = values => values.find(href=>href.pathname==="/users/assets");
const url = href => new URL(href.pathname+"?"+new URLSearchParams(href.query),"https://fixture.invalid");

test("actual C1 C3 href carries the same canonical positive ID through URL serialization",()=>{
  for(const id of [1,42,"42","9007199254740993"]){
    const href=c3(links({id})); assert.ok(href);
    assert.equal(url(href).searchParams.get("userId"),String(id));
    assert.equal(url(href).searchParams.get("userCode"),"U-FIXTURE");
    assert.equal(url(href).searchParams.get("returnTo"),"/users/search?keyword=fixture&seg=all");
  }
});
test("caller keeps the existing summary authority fallback without guessing from user code",()=>{
  const href=c3(links({id:null,summaryId:"17"})); assert.ok(href);
  assert.equal(url(href).searchParams.get("userId"),"17");
  assert.equal(c3(links({id:null,summaryId:null})),undefined);
});
test("missing, malformed, nonpositive and unsafe numeric IDs produce no bound C3 link",()=>{
  for(const id of [null,"",0,"0","000",-1,"-1",1.5,"1.5","042"," 42 ","+42","42.0","1e3","U42","42&userId=7",NaN,Infinity,9007199254740992,{},true,false]){
    assert.equal(c3(links({id})),undefined,`invalid fixture ID ${String(id)}`);
  }
});
test("JSON profile string arrays cannot become a bound C3 ID",()=>{
  assert.equal(c3(links({id:["42"]})),undefined);
});
test("JSON profile number arrays cannot become a bound C3 ID",()=>{
  assert.equal(c3(links({id:[42]})),undefined);
});
test("JSON summary arrays cannot become a bound C3 fallback ID",()=>{
  assert.equal(c3(links({id:null,summaryId:["17"]})),undefined);
  assert.equal(c3(links({id:null,summaryId:{}})),undefined);
  assert.equal(c3(links({id:null,summaryId:true})),undefined);
});
test("C3 read permission, return guard and existing C5 parameters remain independent",()=>{
  assert.equal(c3(links({authorities:[]})),undefined);
  assert.ok(c3(links({role:"superadmin",authorities:[]})));
  for(const returnTo of ["https://other.invalid/path","//other.invalid/path","/finance/ledger"]){
    assert.equal(url(c3(links({returnTo}))).searchParams.get("returnTo"),"/users/search");
  }
  const security=links({role:"superadmin",authorities:[]}).find(href=>href.pathname==="/users/security");
  assert.ok(security); assert.equal(url(security).searchParams.get("userId"),null);
  assert.equal(url(security).searchParams.get("userCode"),"U-FIXTURE");
});
