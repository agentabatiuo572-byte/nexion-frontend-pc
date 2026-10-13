import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";

// Actual React, house Modal/HDSelect and picker source in offline Chromium.
const fe = process.env.SUPPORT_ANALYTICS_FE_ROOT || path.resolve(import.meta.dirname, "..");
const sourceRoot = process.env.SUPPORT_GATE_SOURCE_ROOT || fe;
const require = createRequire(path.join(fe, "package.json"));
const ts = require("typescript"), { chromium } = require("@playwright/test");
const read = relative => fs.readFileSync(path.join(fs.existsSync(path.join(sourceRoot, relative)) ? sourceRoot : fe, relative), "utf8");
const tabs = "app/components/domain-views/m-tabs/";
function declarations(source, names) {
  const file = ts.createSourceFile("real.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return file.statements.filter(node => names.includes(node.name?.text)).map(node => node.getText(file)).join("\n");
}
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const production = (name, file) => fs.readFileSync(path.join(path.dirname(require.resolve(name)), "cjs", file), "utf8");
const design = read("app/components/domain-views/design-kit.tsx");
const chat = ts.createSourceFile("chat.tsx", read(tabs + "m3-dedicated-chat.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let pickerKey;
function findPicker(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(chat) === "SupportContentTools") pickerKey = node.attributes.properties.find(prop => prop.name?.text === "key")?.initializer?.expression?.getText(chat);
  ts.forEachChild(node, findPicker);
}
findPicker(chat); assert.ok(pickerKey, "M3 picker must reset on real scope changes");
const modules = {
  react: production("react", "react.production.js"),
  "react/jsx-runtime": production("react/jsx-runtime", "react-jsx-runtime.production.js"),
  "react-dom": production("react-dom", "react-dom.production.js"),
  "react-dom/client": production("react-dom/client", "react-dom-client.production.js"),
  scheduler: production("scheduler", "scheduler.production.js"),
  "../design-kit": compile('import {useRef,useEffect,useId} from "react";\n' + declarations(design, ["Icon", "Modal"])),
  "./hd-ui": compile(read(tabs + "hd-ui.tsx")),
  "./m-avatar": "exports.MAvatar=()=>null;exports.avInitials=()=>'';",
  "@/lib/admin/error-messages": "exports.displayAdminError=e=>e.message;",
  "@/lib/admin/m-support-enhancements": `const group=data=>({status:"READY",data,evaluatedAt:null});exports.supportEnhancements={profile:async()=>({identity:group({nickname:"测试客户"}),finance:group({byCurrency:[]}),risk:group({}),annotations:group({}),service:group({}),actions:{}}),devices:async()=>group({records:[],total:0}),flows:async()=>group({records:[],total:0}),skus:(page,query,signal)=>{window.trace.requests.push({page,query,signal});return new Promise((resolve,reject)=>window.trace.pending.push({resolve,reject,signal}));}};`,
  "@/lib/store/admin-auth": "exports.useAdminAuth=selector=>selector({authEpoch:1,session:{adminId:12,role:'support',authorities:[]}});",
  "@/lib/admin/m-support-client": "exports.SupportClientError=class extends Error{};exports.supportClient={maintenanceHistory:async()=>({cycles:[],executions:[],totalCycles:0,totalExecutions:0})};",
  "./support-avatar": compile(read(tabs + "support-avatar.tsx")),
  "@/lib/admin/account-avatar-contract": "exports.avatarProxyRoute=()=>null;",
  "./support-leaderboard": "exports.compactSupportBoardValue=value=>value==null?'-':String(value);",
  "./profile": compile(read(tabs + "m3-customer-profile.tsx")),
  "./m3-customer-profile.css": "",
  "./tools": compile(read(tabs + "support-content-tools.tsx")),
  "./support-content-tools.css": "", "./hd-select.css": "",
};
const entry = `const React=require("react"),{createRoot}=require("react-dom/client"),{flushSync}=require("react-dom"),{SupportContentTools}=require("./tools"),{M3CustomerProfile}=require("./profile"),{Modal}=require("../design-kit");let root;
window.mount=(options={})=>{if(root)flushSync(()=>root.unmount());window.trace={inserted:[],selected:[],requests:[],pending:[],refresh:0,outerClosed:0};const templates=[{id:"pub",group:"通用",text:"已发布回复",status:"published"},{id:"draft",text:"草稿不能发送",status:"draft"},{id:"script",group:"维护",type:"advisor",text:"已发布话术",status:"published"}];function App(){const [disabled,setDisabled]=React.useState(!!options.disabled),[scope,setScope]=React.useState({identity:"actor-1",target:"CV-7",owner:12,assignment:"A1",status:"open",canWrite:true});window.disable=()=>setDisabled(true);window.enable=()=>setDisabled(false);window.changeScope=patch=>setScope(old=>({...old,...patch}));const identityRef={current:scope.identity},targetKey=scope.target,selected={ownerAdminId:scope.owner,assignmentId:scope.assignment,status:scope.status},adminId=12,canWriteM3=scope.canWrite;const tools=React.createElement(SupportContentTools,{key:${pickerKey},disabled,popover:options.popover,ctx:{pget:key=>key==="I.session.templatesAvailable"?options.unavailable?"0":"1":options.unavailable?"[]":JSON.stringify(key==="I.session.scripts"?templates.filter(x=>x.type):templates.filter(x=>!x.type)),refreshContent:async()=>{window.trace.refresh++;throw Error("模板读取失败");}},onInsert:text=>window.trace.inserted.push(text),onSelect:content=>window.trace.selected.push(content)});if(options.profile)return React.createElement(M3CustomerProfile,{ctx:{pget:()=>"[]"},customerId:"7",onHistory(){},onRetryMessages(){}});return options.nested?React.createElement(Modal,{title:"圈选客户群发",onClose:()=>window.trace.outerClosed++},tools):tools;}root=createRoot(document.getElementById("root"));flushSync(()=>root.render(React.createElement(App)));};`;
const bundle = `(function(){const process={env:{NODE_ENV:"production"}},cache={},factories={${Object.entries(modules).map(([id, code]) => `${JSON.stringify(id)}:function(require,module,exports){${code}\n}`).join(",")}};function require(id){if(cache[id])return cache[id].exports;if(!factories[id])throw Error("Unbundled "+id);const module=cache[id]={exports:{}};factories[id](require,module,module.exports);return module.exports;}${entry}})();`;
let browser, page, browserTemp;
const errors = [];
before(async () => {
  browserTemp = fs.mkdtempSync(path.join(os.tmpdir(), "support-picker-"));
  browser = await chromium.launch({ headless: true, args: ["--log-file=" + path.join(browserTemp, "browser.log")] }); page = await browser.newPage({ viewport: { width: 1000, height: 800 } }); page.setDefaultTimeout(4000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/*", route => { throw Error("Offline picker made an external request: " + route.request().url()); });
  await page.setContent('<html data-theme="dark"><body><div id="root" class="dkpage mdom" style="width:420px"></div></body></html>');
  await page.addStyleTag({ content: read("app/globals.css").replace(/^@import "tailwindcss";\s*/, "") + read("app/components/domain-views/m-domain.css") + read(tabs + "hd-select.css") + read(tabs + "support-content-tools.css") + read(tabs + "m3-customer-profile.css") });
  await page.addScriptTag({ content: bundle });
});
after(async () => { try { await browser?.close(); assert.deepEqual(errors, [], "No browser or React errors"); } finally { if (browserTemp) fs.rmSync(browserTemp, {recursive:true,force:true}); } });
const mount = options => page.evaluate(options => window.mount(options), options);
async function open(name, dialogName = name) { const trigger = page.getByRole("button", { name, exact: true }); await trigger.focus(); await page.keyboard.press("Enter"); await page.getByRole("dialog", { name: dialogName, exact: true }).waitFor(); }
test("published template selection fills a draft once; cancel and Escape restore trigger focus", async () => {
  await mount(); await open("回复模板与专属客服话术");
  assert.equal(await page.getByText("草稿不能发送").count(), 0);
  const dialog = page.getByRole("dialog"); await dialog.getByLabel("搜索模板").fill("不匹配"); await dialog.getByText("暂无匹配的已发布内容。").waitFor();
  await dialog.getByLabel("搜索模板").fill(""); await dialog.getByRole("button", { name: /已发布回复/ }).click();
  assert.deepEqual(await page.evaluate(() => window.trace.inserted), ["已发布回复"]); assert.equal(await page.getByRole("dialog").count(), 0);
  await open("回复模板与专属客服话术"); await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.textContent.includes("回复模板与专属客服话术"));
  await open("回复模板与专属客服话术"); await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0); assert.deepEqual(await page.evaluate(() => window.trace.inserted), ["已发布回复"]);
});
test("house dropdown keyboard chooses scripts; Tab stays inside picker and nested Escape preserves bulk draft", async () => {
  await mount({ nested: true }); await open("回复模板与专属客服话术");
  const dialog = page.getByRole("dialog", { name: "回复模板与专属客服话术", exact: true });
  await dialog.locator("button[aria-haspopup]").first().focus(); await page.keyboard.press("End"); await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: /已发布话术/ }).waitFor();
  await dialog.getByRole("button", { name: "取消", exact: true }).focus(); await page.keyboard.press("Tab");
  assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
  await page.keyboard.press("Escape"); assert.equal(await page.getByRole("dialog").count(), 1);
  assert.equal(await page.evaluate(() => window.trace.outerClosed), 0);
});
test("SKU loading, failure retry, server search/page and cancel abort preserve real payloads", async () => {
  await mount(); await open("推荐在售商品"); await page.getByText("正在读取在售商品…").waitFor();
  await page.evaluate(() => window.trace.pending[0].reject(Error("商品读取失败"))); await page.getByRole("button", { name: "重试商品" }).click();
  await page.waitForFunction(() => window.trace.pending.length === 2);
  await page.evaluate(() => window.trace.pending[1].resolve({records:[{id:"sku-1",name:"真实商品"}],total:11}));
  await page.getByRole("button", { name: "下一页" }).click(); await page.waitForFunction(() => window.trace.pending.length === 3);
  assert.equal(await page.evaluate(() => window.trace.requests[2].page), 2);
  await page.getByLabel("搜索商品名称或编号").fill("真实"); await page.waitForFunction(() => window.trace.requests.at(-1).query === "真实");
  assert.equal(await page.evaluate(() => window.trace.requests.at(-1).page), 1);
  await page.evaluate(() => window.trace.pending.at(-1).resolve({records:[{id:"sku-1",name:"真实商品"}],total:1}));
  await page.getByRole("button", { name: /真实商品/ }).click();
  assert.deepEqual(await page.evaluate(() => window.trace.selected), [{kind:"SKU",skuId:"sku-1",name:"真实商品"}]);
  await open("推荐在售商品"); await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.evaluate(() => window.trace.requests.at(-1).signal.aborted), true);
});
test("template failures retry; temporary disabled picker stays open while revocation cancels and clears it", async () => {
  await mount({ unavailable: true }); await open("回复模板与专属客服话术");
  await page.getByRole("button", { name: "重试模板与话术" }).click(); await page.getByText("模板读取失败", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.trace.refresh), 1);
  await mount({ disabled: true }); assert.equal(await page.getByRole("button", { disabled: true }).count(), 3); assert.equal(await page.evaluate(() => window.trace.requests.length), 0);
  await mount(); await open("推荐在售商品"); await page.evaluate(() => window.disable());
  await page.getByText("当前暂不能推荐商品：当前状态不可发送，或操作尚未结束。请恢复可用后再试。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 1);
  assert.equal(await page.evaluate(() => window.trace.requests[0].signal.aborted), true); assert.deepEqual(await page.evaluate(() => window.trace.selected), []);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("support-scope-invalidated")));
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await page.evaluate(() => { window.trace.pending[0].resolve({records:[{id:"stale",name:"过期商品"}],total:1}); window.enable(); });
  await open("推荐在售商品"); await page.waitForFunction(() => window.trace.requests.length === 2);
  await page.evaluate(() => window.trace.pending[1].resolve({records:[],total:0}));
  await page.getByText("没有匹配的在售商品。", {exact:true}).waitFor();
  assert.equal(await page.getByText("过期商品").count(), 0);
});
test("template revalidation retains dialog/search, blocks selection and recovers; real scope changes clear them", async () => {
  await mount(); await open("回复模板与专属客服话术");
  const dialog = page.getByRole("dialog"); await dialog.getByLabel("搜索模板").fill("已发布回复");
  await page.evaluate(() => window.disable()); await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].some(button => button.disabled && button.textContent.includes("已发布回复")));
  assert.equal(await dialog.getByRole("button", { name: /已发布回复/ }).isDisabled(), true);
  assert.equal(await dialog.getByLabel("搜索模板").inputValue(), "已发布回复");
  await page.evaluate(() => window.enable()); await dialog.getByRole("button", { name: /已发布回复/ }).click();
  assert.deepEqual(await page.evaluate(() => window.trace.inserted), ["已发布回复"]);
  for (const patch of [{identity:"actor-2"},{target:"CV-8"},{owner:13},{assignment:"A2"},{status:"closed"},{canWrite:false}]) {
    await mount(); await open("回复模板与专属客服话术"); await dialog.getByLabel("搜索模板").fill("旧范围搜索");
    await page.evaluate(patch => window.changeScope(patch), patch); await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    await open("回复模板与专属客服话术"); assert.equal(await dialog.getByLabel("搜索模板").inputValue(), "");
    assert.deepEqual(await page.evaluate(() => window.trace.inserted), []);
  }
  await mount(); await open("回复模板与专属客服话术"); await dialog.getByLabel("搜索模板").fill("撤权前搜索");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("support-scope-invalidated"))); await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await open("回复模板与专属客服话术"); assert.equal(await dialog.getByLabel("搜索模板").inputValue(), "");
});
test("actual profile 360 keeps its trigger mounted and Escape restores focus; revocation closes private detail", async () => {
  await mount({profile:true}); const trigger = page.getByRole("button", {name:"查看完整客户档案 / 360",exact:true});
  await open("查看完整客户档案 / 360", "客户服务 360");
  assert.equal(await trigger.count(), 1); assert.equal(await trigger.evaluate(el => el.isConnected), true);
  await page.keyboard.press("Escape"); await page.waitForFunction(() => document.activeElement?.textContent.includes("查看完整客户档案 / 360"));
  assert.equal(await page.getByRole("dialog").count(), 0);
  await open("查看完整客户档案 / 360", "客户服务 360"); await page.evaluate(() => window.dispatchEvent(new CustomEvent("support-scope-invalidated",{detail:{customerId:"7"}})));
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]')); assert.equal(await page.getByText("测试客户",{exact:true}).count(), 0);
});
test("M3 popover stays above its trigger, survives temporary disable and Escape restores trigger focus", async () => {
  await page.locator("#root").evaluate(element => { element.style.marginTop = "500px"; });
  try {
    await mount({popover:true}); await open("回复模板与专属客服话术");
    await page.locator(".support-composer-popover").waitFor({state:"attached"});
    const dialog = page.getByRole("dialog"), popup = await dialog.boundingBox(), trigger = await page.getByRole("button",{name:"回复模板与专属客服话术",exact:true}).boundingBox();
    assert.ok(popup.y + popup.height <= trigger.y - 8, "popover sits above composer tools");
    await page.evaluate(() => window.disable());
    await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].some(button => button.disabled && button.textContent.includes("已发布回复")));
    assert.equal(await dialog.getByRole("button",{name:/已发布回复/}).isDisabled(), true);
    assert.equal(await dialog.count(), 1);
    await page.evaluate(() => window.enable()); await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "回复模板与专属客服话术");
    assert.equal(await dialog.count(), 0);
  } finally { await page.locator("#root").evaluate(element => { element.style.marginTop = "0"; }); }
});
test("page targets remain HOME/WALLET/SUPPORT and selecting a target only stages its payload", async () => {
  await mount(); await open("发送页面链接");
  for (const label of ["首页", "钱包", "在线客服"]) assert.equal(await page.getByRole("dialog").getByRole("button", { name: label, exact: true }).count(), 1);
  await page.getByRole("dialog").getByRole("button", { name: "钱包", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.trace.selected), [{kind:"LINK",linkTarget:{type:"WALLET",params:{}},name:"钱包"}]);
  assert.deepEqual(await page.evaluate(() => window.trace.inserted), []);
});
