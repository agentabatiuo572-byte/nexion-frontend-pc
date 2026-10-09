import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";

// Runs the real source with installed React/ReactDOM in installed Chromium.
// No server, new dependencies, copied keyboard handler or fake React hooks.
const root = path.resolve(import.meta.dirname, "..");
const fe = process.env.SUPPORT_SELECT_FE_ROOT || root;
const sourceRoot = process.env.SUPPORT_SELECT_SOURCE_ROOT || root;
const require = createRequire(path.join(fe, "package.json"));
const ts = require("typescript");
const { chromium } = require("@playwright/test");
const relative = "app/components/domain-views/m-tabs/hd-ui.tsx";
const hdSourcePath = path.join(fs.existsSync(path.join(sourceRoot, relative)) ? sourceRoot : fe, relative);
const hdSource = fs.readFileSync(hdSourcePath, "utf8");
const analyticsSource = fs.readFileSync(path.join(fe, "app/components/domain-views/m-tabs/m1-analytics-workbench.tsx"), "utf8");
const designSource = fs.readFileSync(path.join(fe, "app/components/domain-views/design-kit.tsx"), "utf8");
const importedCss = ts.createSourceFile("hd-ui.tsx", hdSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).statements
  .filter(node => ts.isImportDeclaration(node) && node.moduleSpecifier.text.endsWith(".css"))
  .map(node => {
    const candidate = path.resolve(path.dirname(path.join(sourceRoot, relative)), node.moduleSpecifier.text);
    return { name: node.moduleSpecifier.text, content: fs.readFileSync(fs.existsSync(candidate) ? candidate : path.resolve(path.dirname(hdSourcePath), node.moduleSpecifier.text), "utf8") };
  });
const domainCssPath = "app/components/domain-views/m-domain.css";
const domainCss = fs.readFileSync(path.join(fs.existsSync(path.join(sourceRoot, domainCssPath)) ? sourceRoot : fe, domainCssPath), "utf8");
const globalsCss = fs.readFileSync(path.join(fe, "app/globals.css"), "utf8").replace(/^@import "tailwindcss";\s*/, "");
const preflightCss = fs.readFileSync(path.join(path.dirname(require.resolve("tailwindcss/package.json")), "preflight.css"), "utf8");
const aDomainCss = fs.readFileSync(path.join(fe, "app/components/domain-views/a-domain.css"), "utf8");
const m1Css = fs.readFileSync(path.join(fe, "app/components/domain-views/m-tabs/m1-analytics-workbench.css"), "utf8");
// Repository-owned immutable baseline survives installation beside the new shared CSS.
const baseline = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/support-select-baseline.json"), "utf8"));
const baselineSharedCss = baseline.sharedCss;
const originalMSelectRules = baselineSharedCss.split(/\r?\n/).filter(line => line.startsWith(".mdom "));
const reconstructedBaselineDomainCss = domainCss + "\n" + originalMSelectRules.join("\n") + "\n@media (prefers-reduced-motion: reduce) { .mdom .hd-select-pop { animation: none !important; } }";
function declarations(source, names) {
  const file = ts.createSourceFile("fixture.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return names.map(name => {
    const node = file.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
    assert.ok(node, `Actual declaration ${name} exists`);
    return node.getText(file);
  }).join("\n");
}
function compile(source) {
  const result = ts.transpileModule(source, { fileName: "fixture.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
  assert.equal(result.diagnostics?.length ?? 0, 0);
  return result.outputText;
}
function installedProduction(packageName, filename) {
  return fs.readFileSync(path.join(path.dirname(require.resolve(packageName)), "cjs", filename), "utf8");
}
const modules = {
  react: installedProduction("react", "react.production.js"),
  "react/jsx-runtime": installedProduction("react/jsx-runtime", "react-jsx-runtime.production.js"),
  "react-dom": installedProduction("react-dom", "react-dom.production.js"),
  "react-dom/client": installedProduction("react-dom/client", "react-dom-client.production.js"),
  scheduler: installedProduction("scheduler", "scheduler.production.js"),
  // The real Icon is needed to measure caret geometry; unused avatar export only is stubbed.
  "../design-kit": compile(declarations(designSource, ["Icon"])),
  "./m-avatar": "exports.MAvatar=()=>null;exports.avInitials=()=>'';",
  "./hd-ui": compile(hdSource),
  "./actual-wrapper": compile('import {useRef,useEffect} from "react";import {HDSelect} from "./hd-ui";\n' + declarations(analyticsSource, ["analyticsOptionIndex", "AnalyticsSelect"]) + "\nexport { AnalyticsSelect };"),
  "@/lib/admin/glossary": compile(fs.readFileSync(path.join(fe, "lib/admin/glossary.ts"), "utf8")),
  "@/lib/admin/glossary-match": compile(fs.readFileSync(path.join(fe, "lib/admin/glossary-match.ts"), "utf8")),
  "./actual-gloss": compile(fs.readFileSync(path.join(fe, "app/components/kit/gloss.tsx"), "utf8")),
  "./actual-brief": compile('import {useState,useId,isValidElement} from "react";import {AutoGloss} from "./actual-gloss";\n' + declarations(designSource, ["plainText", "compactText", "buildOperatorBrief", "OperatorBriefBlock"])),
  "./actual-modal": compile('import {useRef,useEffect,useId} from "react";import {Icon} from "../design-kit";\n' + declarations(designSource, ["Modal"])),
  ...Object.fromEntries(importedCss.map(css => [css.name, "module.exports={};"])),
};
const entry = `
const React=require("react"), {createRoot}=require("react-dom/client"), {flushSync}=require("react-dom");
const {HDSelect}=require("./hd-ui"), {AnalyticsSelect}=require("./actual-wrapper"), {Modal}=require("./actual-modal"), {OperatorBriefBlock}=require("./actual-brief");
let root;
document.addEventListener("keydown",event=>{if(event.key==="Tab")queueMicrotask(()=>window.trace.keys.push({key:event.key,prevented:event.defaultPrevented}));},true);
window.mount=(config={})=>{
  if(root)flushSync(()=>root.unmount());
  document.documentElement.dataset.theme=config.theme||"dark";
  document.getElementById("root").className=config.domain==="m"?"dkpage mdom sa-workbench":config.domain==="m2"?"dkpage mdom":config.domain==="fallback"?"":"dkpage adom";
  window.trace={changes:[],escapes:0,keys:[],captures:0};
  function App(){
    const [value,setValue]=React.useState(config.value||"b");
    const [show,setShow]=React.useState(true);
    const Select=config.wrapper?AnalyticsSelect:HDSelect;
    const select=React.createElement(Select,{label:"原统计筛选",value,placeholder:"请选择",width:config.width||200,options:config.empty?[]:config.options||[{value:"a",label:"第一项"},{value:"b",label:"第二项"},{value:"c",label:"第三项"}],onChange:v=>{window.trace.changes.push(v);setValue(v);}});
    const content=React.createElement("div",{style:{minHeight:360},onKeyDownCapture:e=>{if(config.prevent&&e.key===config.prevent){window.trace.captures++;e.preventDefault();}},onKeyDown:e=>window.trace.keys.push({key:e.key,prevented:e.defaultPrevented})},
      React.createElement("button",{id:"before"},"之前"),React.createElement("fieldset",{disabled:!!config.disabled},select),React.createElement("button",{id:"after",style:{marginLeft:240}},"之后"));
    const detail=config.avatarConfirmation==="self"?React.createElement("span",{className:"self-avatar-confirm-detail"},"仅替换当前登录账号的头像；姓名、角色和接待资格保持原值。失败或冲突不会清除原头像。"):"既有其它操作确认内容";
    const confirmation=config.avatarConfirmation?React.createElement(React.Fragment,null,content,
      React.createElement(OperatorBriefBlock,{action:config.avatarConfirmation==="self"?"更换本人头像":"其它操作",detail}),
      React.createElement("div",{className:"field"},React.createElement("label",{htmlFor:"reason"},"操作理由"),React.createElement("textarea",{id:"reason"}),React.createElement("div",{className:"tiny",id:"reason-hint"},"辅助说明")),
      React.createElement("div",{className:"account-avatar-controls"},React.createElement("p",{id:"avatar-body"},"头像说明正文"),React.createElement("small",{id:"avatar-expiry"},"素材有效期"),React.createElement("label",{htmlFor:"avatar-file"},"选择头像"),React.createElement("input",{id:"avatar-file",type:"file"}),React.createElement("button",{className:"l-btn",id:"avatar-prepare"},"准备头像"))):content;
    return config.modal?(show?React.createElement(Modal,{title:"实际 house Modal",busy:!!config.busy,footer:config.avatarConfirmation?React.createElement("button",{className:"btn",id:"confirm-submit"},"确认提交"):undefined,onClose:()=>{window.trace.escapes++;setShow(false);}},confirmation):React.createElement("p",{id:"closed"},"已关闭")):content;
  }
  root=createRoot(document.getElementById("root"));flushSync(()=>root.render(React.createElement(App)));
};
`;
const bundle = `(function(){const process={env:{NODE_ENV:"production"}};const factories={${Object.entries(modules).map(([id, code]) => `${JSON.stringify(id)}:function(require,module,exports){\n${code}\n}`).join(",")}};const cache={};function require(id){if(cache[id])return cache[id].exports;if(!factories[id])throw Error("Unbundled dependency "+id);const module=cache[id]={exports:{}};factories[id](require,module,module.exports);return module.exports;}\n${entry}\n})();`;
let browser, page, domainStyle, sharedStyles;
const errors = [];
before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root" style="min-height:100vh;padding:48px"></div></body></html>');
  await page.addStyleTag({ content: preflightCss });
  await page.addStyleTag({ content: globalsCss });
  await page.addStyleTag({ content: aDomainCss });
  domainStyle = await page.addStyleTag({ content: domainCss });
  sharedStyles = [];
  for (const css of importedCss) sharedStyles.push(await page.addStyleTag({ content: css.content }));
  // The real page imports its workbench rules after HDSelect; load the entire stylesheet.
  await page.addStyleTag({ content: m1Css });
  await page.addScriptTag({ content: bundle });
});
after(async () => {
  await browser?.close();
  assert.deepEqual(errors, [], "No real browser React/console errors");
});
async function mount(config = {}) {
  await page.evaluate(config => window.mount(config), config);
  await page.locator("button[aria-haspopup]").focus();
}
async function focused(text) {
  await page.waitForFunction(text => document.activeElement?.textContent === text, text);
}
async function open(key = "ArrowDown") {
  await page.keyboard.press(key);
  await page.waitForFunction(() => document.querySelector("button[aria-haspopup]")?.getAttribute("aria-expanded") === "true");
}
async function triggerFocused() {
  await page.waitForFunction(() => document.activeElement?.matches("button[aria-haspopup]") && document.activeElement.getAttribute("aria-expanded") === "false");
}

for (const [key, expected] of [["ArrowDown", "第一项"], ["ArrowUp", "第三项"], ["Home", "第一项"], ["End", "第三项"]]) {
  test(`bare closed ${key} opens and focuses ${expected}`, async () => {
    await mount(); await open(key); await focused(expected);
    assert.equal(await page.locator("[role=listbox]").count(), 1);
    assert.deepEqual(await page.evaluate(() => window.trace.changes), []);
  });
}
test("bare arrows cycle once; Home/End target the boundaries", async () => {
  await mount(); await open(); await focused("第一项");
  await page.keyboard.press("ArrowUp"); await focused("第三项");
  await page.keyboard.press("ArrowDown"); await focused("第一项");
  await page.keyboard.press("ArrowDown"); await focused("第二项");
  await page.keyboard.press("End"); await focused("第三项");
  await page.keyboard.press("Home"); await focused("第一项");
});
for (const key of ["Enter", "Space"]) {
  test(`bare option ${key} uses original click once and restores trigger focus`, async () => {
    await mount(); await open("End"); await focused("第三项");
    await page.keyboard.press(key); await triggerFocused();
    assert.deepEqual(await page.evaluate(() => window.trace.changes), ["c"]);
    assert.equal(await page.locator("button[aria-haspopup] > span").first().textContent(), "第三项");
    assert.equal(await page.locator("[role=listbox]").count(), 0);
  });
  test(`native trigger ${key} still opens and supports keyboard selection`, async () => {
    await mount(); await open(key);
    await page.keyboard.press("ArrowDown"); await focused("第一项");
    await page.keyboard.press("Enter"); await triggerFocused();
    assert.deepEqual(await page.evaluate(() => window.trace.changes), ["a"]);
  });
}
test("mouse selection still selects once and returns focus to trigger", async () => {
  await mount(); await page.locator("button[aria-haspopup]").click();
  await page.getByRole("option", { name: "第一项" }).click(); await triggerFocused();
  assert.deepEqual(await page.evaluate(() => window.trace.changes), ["a"]);
});
test("bare Escape closes dropdown before real Modal; next Escape closes Modal", async () => {
  await mount({ modal: true }); await page.locator("button[aria-haspopup]").click();
  await page.getByRole("option", { name: "第一项" }).focus();
  await page.keyboard.press("Escape"); await triggerFocused();
  assert.equal(await page.getByRole("dialog").count(), 1);
  assert.equal(await page.evaluate(() => window.trace.escapes), 0);
  await page.keyboard.press("Escape"); await page.locator("#closed").waitFor();
  assert.equal(await page.evaluate(() => window.trace.escapes), 1);
});
for (const config of [{}, { wrapper: true }, { modal: true }]) {
  test(`Tab closes without preventDefault or focus hijack ${JSON.stringify(config)}`, async () => {
    await mount(config); await open(); await focused("第一项");
    await page.keyboard.press("Tab");
    await page.waitForFunction(() => document.querySelector("button[aria-haspopup]")?.getAttribute("aria-expanded") === "false");
    assert.equal(await page.evaluate(() => window.trace.keys.findLast(event => event.key === "Tab")?.prevented), false);
    assert.equal(await page.locator("[role=listbox]").count(), 0);
    assert.equal(await page.locator("#after").evaluate(element => element === document.activeElement), true, await page.evaluate(() => ({ focused: document.activeElement?.outerHTML, trace: window.trace })));
  });
}
test("actual AnalyticsSelect capture prevents double moves and retains labels", async () => {
  await mount({ wrapper: true }); await open(); await focused("第一项");
  await page.keyboard.press("ArrowDown"); await focused("第二项");
  await page.keyboard.press("ArrowDown"); await focused("第三项");
  await page.keyboard.press("ArrowUp"); await focused("第二项");
  await page.keyboard.press("Home"); await focused("第一项");
  await page.keyboard.press("End"); await focused("第三项");
  assert.equal(await page.getByRole("listbox").getAttribute("aria-label"), "原统计筛选");
  await page.keyboard.press("Enter"); await triggerFocused();
  assert.deepEqual(await page.evaluate(() => window.trace.changes), ["c"]);
});
test("actual AnalyticsSelect Escape retains real Modal and focuses trigger", async () => {
  await mount({ wrapper: true, modal: true }); await open();
  await page.keyboard.press("Escape"); await triggerFocused();
  assert.equal(await page.getByRole("dialog").count(), 1);
  assert.equal(await page.evaluate(() => window.trace.escapes), 0);
});
test("actual AnalyticsSelect Space selects exactly once through the original option button", async () => {
  await mount({ wrapper: true }); await open("End"); await focused("第三项");
  await page.keyboard.press("Space"); await triggerFocused();
  assert.deepEqual(await page.evaluate(() => window.trace.changes), ["c"]);
});
test("busy actual Modal still lets Escape dismiss the bare dropdown locally", async () => {
  await mount({ modal: true, busy: true }); await open();
  await page.keyboard.press("Escape"); await triggerFocused();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 1);
  assert.equal(await page.evaluate(() => window.trace.escapes), 0);
});
test("outer capture preventDefault keeps bare closed trigger untouched", async () => {
  await mount({ prevent: "ArrowDown" }); await page.keyboard.press("ArrowDown");
  assert.equal(await page.locator("button[aria-haspopup]").getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator("button[aria-haspopup]").evaluate(element => element === document.activeElement), true);
  assert.equal(await page.evaluate(() => window.trace.captures), 1);
});
test("outer capture prevents option selection as before", async () => {
  await mount({ prevent: "Enter" }); await open("End"); await focused("第三项");
  await page.keyboard.press("Enter"); await focused("第三项");
  assert.deepEqual(await page.evaluate(() => window.trace.changes), []);
  assert.equal(await page.locator("button[aria-haspopup]").getAttribute("aria-expanded"), "true");
});
test("empty options are safe for all navigation keys and Escape", async () => {
  await mount({ empty: true, modal: true });
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
    await open(key);
    assert.equal(await page.locator("[role=option]").count(), 0);
    assert.equal(await page.locator("button[aria-haspopup]").evaluate(element => element === document.activeElement), true);
  }
  await page.keyboard.press("Escape"); await triggerFocused();
  assert.equal(await page.getByRole("dialog").count(), 1);
  assert.deepEqual(await page.evaluate(() => window.trace.changes), []);
});
test("disabled fieldset stays disabled under keyboard and dispatched key events", async () => {
  await mount({ disabled: true });
  await page.locator("#before").focus(); await page.keyboard.press("Tab");
  assert.equal(await page.locator("#after").evaluate(element => element === document.activeElement), true);
  await page.locator("button[aria-haspopup]").dispatchEvent("keydown", { key: "ArrowDown", bubbles: true });
  assert.equal(await page.locator("button[aria-haspopup]").getAttribute("aria-expanded"), "false");
  assert.deepEqual(await page.evaluate(() => window.trace.changes), []);
});
test("outside mousedown still dismisses and original DOM/style are preserved", async () => {
  await mount(); await open();
  assert.equal(await page.locator("button[aria-haspopup]").getAttribute("class"), "hd-select");
  assert.equal(await page.locator("[role=listbox]").getAttribute("class"), "hd-select-pop");
  assert.equal(await page.getByRole("option", { name: "第二项" }).getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("button[aria-haspopup]").evaluate(element => element.parentElement.style.width), "200px");
  await page.locator("#after").click();
  await page.waitForFunction(() => document.querySelector("button[aria-haspopup]")?.getAttribute("aria-expanded") === "false");
  assert.equal(await page.locator("#after").evaluate(element => element === document.activeElement), true);
});

async function geometry() {
  return page.evaluate(() => {
    const trigger = document.querySelector("button[aria-haspopup]"), pop = document.querySelector("[role=listbox]");
    const style = getComputedStyle(trigger), popStyle = getComputedStyle(pop), icon = trigger.querySelector("svg");
    const triggerRect = trigger.getBoundingClientRect(), iconRect = icon.getBoundingClientRect();
    const options = [...pop.querySelectorAll("[role=option]")];
    return {
      trigger: { display: style.display, border: style.borderTopWidth, borderStyle: style.borderTopStyle, background: style.backgroundColor, paddingRight: style.paddingRight, paddingLeft: style.paddingLeft, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, radius: style.borderRadius, height: style.height, font: style.fontFamily, fontSize: style.fontSize, rightGap: triggerRect.right - iconRect.right, iconWidth: iconRect.width, iconHeight: iconRect.height, shadow: style.boxShadow },
      pop: { background: popStyle.backgroundColor, border: popStyle.borderTopWidth, maxHeight: popStyle.maxHeight, overflow: popStyle.overflowY, width: pop.clientWidth, scrollWidth: pop.scrollWidth, scrollHeight: pop.scrollHeight, height: pop.clientHeight, radius: popStyle.borderRadius, shadow: popStyle.boxShadow },
      options: options.map(option => { const rect = option.getBoundingClientRect(), css = getComputedStyle(option); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, display: css.display, fontSize: css.fontSize }; }),
      hasMAncestor: !!trigger.closest(".mdom"),
    };
  });
}
const screenshots = process.env.SUPPORT_SELECT_ARTIFACTS;
for (const domain of ["m", "a"]) for (const theme of ["dark", "light"]) {
  test(`real CSS ${domain}/${theme}: border, surface, caret, vertical list, focus and Escape`, async () => {
    await mount({ domain, theme, modal: true });
    await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
    const focus = await page.locator("button[aria-haspopup]").evaluate(element => ({ focused: element === document.activeElement, visible: element.matches(":focus-visible"), shadow: getComputedStyle(element).boxShadow }));
    assert.equal(focus.focused, true); assert.equal(focus.visible, true); assert.notEqual(focus.shadow, "none");
    await open(); await focused("第一项");
    const actual = await geometry();
    assert.equal(actual.hasMAncestor, domain === "m");
    assert.equal(actual.trigger.display, "flex"); assert.equal(actual.trigger.border, "1px"); assert.equal(actual.trigger.borderStyle, "solid");
    assert.equal(actual.trigger.background, theme === "dark" ? "rgb(23, 23, 27)" : "rgb(250, 247, 240)");
    assert.equal(actual.trigger.paddingRight, "12px"); assert.equal(actual.trigger.height, domain === "m" ? "36px" : "34px"); assert.equal(actual.trigger.radius, "9px"); assert.equal(actual.trigger.fontSize, "14px");
    assert.match(actual.trigger.font, /Manrope/); assert.equal(actual.trigger.iconWidth, 15); assert.equal(actual.trigger.iconHeight, 15);
    assert.ok(actual.trigger.rightGap >= 12 && actual.trigger.rightGap <= 14, `caret right gap ${actual.trigger.rightGap}`);
    assert.equal(actual.pop.border, "1px"); assert.equal(actual.pop.radius, "9px"); assert.equal(actual.pop.maxHeight, "264px"); assert.equal(actual.pop.overflow, "auto"); assert.notEqual(actual.pop.shadow, "none");
    assert.equal(actual.pop.background, theme === "dark" ? "rgb(18, 18, 20)" : "rgb(255, 255, 255)");
    assert.ok(actual.pop.scrollWidth <= actual.pop.width);
    for (const [index, option] of actual.options.entries()) {
      assert.equal(option.display, "flex"); assert.equal(option.fontSize, "14px");
      assert.equal(option.x, actual.options[0].x); assert.equal(option.width, actual.options[0].width);
      if (index) assert.ok(option.y >= actual.options[index - 1].y + actual.options[index - 1].height - 0.5, "Options stack vertically");
    }
    if (screenshots) { fs.mkdirSync(screenshots, { recursive: true }); await page.screenshot({ path: path.join(screenshots, `${domain}-${theme}-open.png`) }); }
    await page.keyboard.press("Escape"); await triggerFocused();
    assert.equal(await page.getByRole("dialog").count(), 1);
    assert.equal(await page.evaluate(() => window.trace.escapes), 0);
  });
  test(`real CSS ${domain}/${theme}: long names truncate; popup wheel scrolls; final item selects`, async () => {
    const longName = "真实专属客服主管成员长名称".repeat(8);
    const options = Array.from({ length: 32 }, (_, index) => ({ value: `member-${index}`, label: `${longName} ${index}` }));
    await mount({ domain, theme, options, value: "member-0", width: 180, modal: true });
    const title = await page.locator("button[aria-haspopup] > span").first().evaluate(element => ({ overflow: getComputedStyle(element).overflowX, whiteSpace: getComputedStyle(element).whiteSpace, ellipsis: getComputedStyle(element).textOverflow, width: element.clientWidth, content: element.scrollWidth }));
    assert.equal(title.overflow, "hidden"); assert.equal(title.whiteSpace, "nowrap"); assert.equal(title.ellipsis, "ellipsis"); assert.ok(title.content > title.width);
    await page.locator("button[aria-haspopup]").click();
    const option = await page.getByRole("option").first().locator("span").first().evaluate(element => ({ overflow: getComputedStyle(element).overflowX, whiteSpace: getComputedStyle(element).whiteSpace, ellipsis: getComputedStyle(element).textOverflow, width: element.clientWidth, content: element.scrollWidth }));
    assert.equal(option.overflow, "hidden"); assert.equal(option.whiteSpace, "nowrap"); assert.equal(option.ellipsis, "ellipsis"); assert.ok(option.content > option.width);
    const actual = await geometry();
    assert.ok(actual.pop.height <= 264); assert.ok(actual.pop.scrollHeight > actual.pop.height); assert.ok(actual.pop.scrollWidth <= actual.pop.width);
    await page.getByRole("listbox").hover(); await page.mouse.wheel(0, 350);
    await page.waitForFunction(() => document.querySelector("[role=listbox]").scrollTop > 0);
    await page.keyboard.press("End");
    await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "option" && document.activeElement.textContent.endsWith(" 31"));
    await page.keyboard.press("Enter"); await triggerFocused();
    assert.deepEqual(await page.evaluate(() => window.trace.changes), ["member-31"]);
  });
}
test("shared popup respects reduced motion in A1 and M scopes", async () => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const domain of ["a", "m"]) {
    await mount({ domain }); await open();
    assert.equal(await page.getByRole("listbox").evaluate(element => getComputedStyle(element).animationName), "none");
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
});

test("shared CSS preserves original M declarations and every DOM/keyboard/callback byte", () => {
  const sourceFile = ts.createSourceFile("hd-ui.tsx", hdSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.deepEqual(Object.keys(baseline.componentDefinitions), ["HDSelect", "Caret", "HDOption"]);
  for (const [name, original] of Object.entries(baseline.componentDefinitions)) {
    const declaration = sourceFile.statements.find(node => (ts.isFunctionDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name?.text === name);
    assert.ok(declaration, `Actual component declaration ${name} exists`);
    assert.equal(declaration.getText(sourceFile).replaceAll("\r\n", "\n"), original.replaceAll("\r\n", "\n"), `Original ${name} DOM, keyboard, focus and callback declaration bytes remain exact`);
  }
  const mRules = originalMSelectRules;
  assert.equal(mRules.length, 9);
  for (const rule of mRules) {
    const expected = rule.startsWith(".mdom .hd-select {") ? rule.replace("padding: 0 10px;", "padding: 0 10px; padding-right: 12px;").replace("font-size: 13.5px;", "font-size: 14px;") : rule.startsWith(".mdom .hd-select-opt {") ? rule.replace("font-size: 13px;", "font-size: 14px;") : rule;
    assert.ok(importedCss.some(css => css.content.includes(expected)), `Original M rule retains every byte except the exact approved 2px right-padding addition and 14px font correction: ${rule}`);
  }
  assert.equal(importedCss.length, 1);
  const currentCss = importedCss[0].content.replaceAll("\r\n", "\n");
  assert.equal(currentCss.split("padding: 0 10px; padding-right: 12px;").length - 1, 2, "Exactly global and scoped triggers carry the spacing correction");
  assert.equal(currentCss.match(/font-size: 14px;/g)?.length, 4, "Exactly global/scoped trigger and option fonts become 14px");
  const originalFontsCss = currentCss.replace(/^(\.hd-select|\.mdom \.hd-select) \{([^\n]+)\}/gm, rule => rule.replace("font-size: 14px;", "font-size: 13.5px;")).replace(/^(\.hd-select-opt|\.mdom \.hd-select-opt) \{([^\n]+)\}/gm, rule => rule.replace("font-size: 14px;", "font-size: 13px;"));
  assert.equal(originalFontsCss.replaceAll("padding: 0 10px; padding-right: 12px;", "padding: 0 10px;").replace("/* Original M declarations and selectors are retained; trigger right padding is explicitly 12px. */", "/* M declarations are copied verbatim from m-domain.css, including their selectors. */"), baselineSharedCss, "Only the two exact right-padding additions, four exact 14px font corrections and original explanatory comment differ from frozen v3 CSS");
  assert.equal(importedCss.map(css => css.content.match(/!important/g)?.length ?? 0).reduce((a, b) => a + b, 0), 1, "Only the existing reduced-motion priority remains");
});

async function selectStyles() {
  return page.evaluate(() => {
    const properties = ["backgroundColor", "borderTopWidth", "borderTopStyle", "borderTopColor", "borderRadius", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontSize", "fontFamily", "fontWeight", "lineHeight", "height", "minHeight", "width", "display", "alignItems", "gap", "color", "position", "top", "left", "right", "zIndex", "maxHeight", "overflowX", "overflowY", "boxShadow", "animationName"];
    const sample = element => Object.fromEntries(properties.map(name => [name, getComputedStyle(element)[name]]));
    return {
      trigger: sample(document.querySelector("button[aria-haspopup]")),
      option: sample([...document.querySelectorAll("[role=option]")].at(-1)),
      selectedOption: sample(document.querySelector('[role=option][aria-selected="true"]')),
      pop: sample(document.querySelector("[role=listbox]")),
      neighbor: sample(document.querySelector("#after")),
    };
  });
}

for (const theme of ["dark", "light"]) for (const wrapper of [false, true]) {
  test(`M1 baseline parity ${theme}/${wrapper ? "AnalyticsSelect" : "HDSelect"} with actual workbench cascade`, async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mount({ domain: "m", theme, wrapper });
    await page.locator("button[aria-haspopup]").click();
    // Move focus and pointer off the control: the last option is neither selected nor hovered.
    await page.locator("#after").focus(); await page.mouse.move(0, 0);
    await page.waitForFunction(() => document.getElementById("root").getAnimations({ subtree: true }).length === 0);
    assert.equal(await page.locator("#root").getAttribute("class"), "dkpage mdom sa-workbench");
    assert.equal(await page.getByRole("option").last().getAttribute("aria-selected"), "false");
    let candidate, baseline;
    try {
      candidate = await selectStyles();
      await domainStyle.evaluate((element, content) => { element.textContent = content; }, reconstructedBaselineDomainCss);
      for (const style of sharedStyles) await style.evaluate(element => { element.textContent = ""; });
      await page.waitForFunction(() => document.getElementById("root").getAnimations({ subtree: true }).length === 0);
      baseline = await selectStyles();
      if (screenshots) await page.screenshot({ path: path.join(screenshots, `m1-${theme}-${wrapper ? "wrapper" : "bare"}-baseline.png`) });
    } finally {
      await domainStyle.evaluate((element, content) => { element.textContent = content; }, domainCss);
      for (const [index, style] of sharedStyles.entries()) await style.evaluate((element, content) => { element.textContent = content; }, importedCss[index].content);
      await page.emulateMedia({ reducedMotion: "no-preference" });
    }
    if (screenshots) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.screenshot({ path: path.join(screenshots, `m1-${theme}-${wrapper ? "wrapper" : "bare"}-candidate.png`) });
      fs.writeFileSync(path.join(screenshots, `m1-${theme}-${wrapper ? "wrapper" : "bare"}-parity.json`), JSON.stringify({ baseline, candidate }, null, 2) + "\n");
      await page.emulateMedia({ reducedMotion: "no-preference" });
    }
    const expected = structuredClone(baseline);
    assert.equal(baseline.trigger.paddingRight, wrapper ? "12px" : "10px");
    if (!wrapper) expected.trigger.paddingRight = "12px";
    for (const name of ["trigger", "option", "selectedOption"]) {
      assert.equal(candidate[name].fontSize, "14px", name + " font has the approved exact size");
      expected[name].fontSize = "14px";
      if (baseline[name].lineHeight === "normal") assert.equal(candidate[name].lineHeight, "normal");
      else {
        const scaled = parseFloat(baseline[name].lineHeight) * 14 / parseFloat(baseline[name].fontSize);
        assert.ok(Math.abs(parseFloat(candidate[name].lineHeight) - scaled) < 0.001, name + " line-height changes only by the original font ratio");
        expected[name].lineHeight = candidate[name].lineHeight;
      }
    }
    if (!wrapper) {
      assert.equal(await page.getByRole("option").count(), 3);
      for (const name of ["option", "selectedOption"]) {
        assert.equal(baseline[name].fontSize, "13px"); assert.equal(baseline[name].lineHeight, "19.5px"); assert.equal(baseline[name].height, "36px");
        assert.equal(candidate[name].lineHeight, "21px");
        const naturalHeight = parseFloat(candidate[name].lineHeight) + parseFloat(baseline[name].paddingTop) + parseFloat(baseline[name].paddingBottom);
        assert.equal(naturalHeight, 37, "Original 8px option padding plus the approved font's line-height derives exactly 37px");
        expected[name].height = naturalHeight + "px";
      }
      assert.equal(baseline.pop.height, "120px");
      expected.pop.height = (parseFloat(baseline.pop.height) + 3 * (37 - 36)) + "px";
      assert.equal(expected.pop.height, "123px", "Only three exact one-pixel option increases derive popup height");
    }
    assert.deepEqual(candidate, expected, "Only approved trigger padding, exact 14px fonts/proportional line-height, and bare M1's derived 36→37/120→123 heights differ; wrapper heights and all remaining 30 properties stay exact");
    assert.equal(candidate.trigger.paddingTop, "0px"); assert.equal(candidate.trigger.paddingLeft, "10px"); assert.equal(candidate.trigger.fontSize, "14px");
    assert.equal(candidate.option.paddingTop, "8px"); assert.equal(candidate.option.paddingLeft, "9px"); assert.equal(candidate.option.borderTopWidth, "0px");
    await page.getByRole("option").last().focus(); await page.keyboard.press("Enter"); await triggerFocused();
    assert.deepEqual(await page.evaluate(() => window.trace.changes), ["c"]);
  });
}

test("shared fallback styles work without M or A domain ancestors and legacy tokens", async () => {
  await mount({ domain: "fallback" });
  await page.locator("#root").evaluate(element => {
    for (const name of ["--surface", "--surface-2", "--ink", "--ink-2", "--ink-3", "--border-strong", "--m-r-ctl", "--m-sh-pop", "--m-hd-border", "--m-hd-softer"]) element.style.setProperty(name, "initial");
  });
  try {
    await open(); await focused("第一项");
    const actual = await geometry();
    assert.equal(actual.hasMAncestor, false); assert.equal(actual.trigger.display, "flex"); assert.equal(actual.trigger.height, "34px");
    assert.equal(actual.trigger.background, "rgb(23, 23, 27)"); assert.equal(actual.trigger.border, "1px"); assert.equal(actual.trigger.paddingRight, "12px");
    assert.equal(actual.pop.background, "rgb(18, 18, 20)"); assert.equal(actual.pop.maxHeight, "264px");
    for (const [index, option] of actual.options.entries()) if (index) assert.ok(option.y >= actual.options[index - 1].y + actual.options[index - 1].height - 0.5);
    await page.keyboard.press("End"); await focused("第三项"); await page.keyboard.press("Enter"); await triggerFocused();
    assert.deepEqual(await page.evaluate(() => window.trace.changes), ["c"]);
  } finally {
    await page.locator("#root").evaluate(element => { element.style.cssText = "min-height:100vh;padding:48px"; });
  }
});

for (const theme of ["dark", "light"]) for (const [scene, config] of [["A1", { domain: "a", modal: true }], ["M2 bare", { domain: "m2" }], ["M1 wrapper", { domain: "m", wrapper: true }]]) {
  test(`spacing12 ${scene}/${theme}: shared caret clearance with actual house CSS and one dispatch`, async () => {
    const options = ["第一项", "第二项", "第三项"].map((label, index) => ({ value: ["a", "b", "c"][index], label: label + "专属客服长名称".repeat(12) }));
    await mount({ ...config, theme, options, width: 180 });
    await open("End"); await focused(options[2].label);
    const actual = await geometry();
    assert.equal(actual.trigger.paddingRight, "12px"); assert.equal(actual.trigger.paddingLeft, "10px");
    assert.equal(actual.trigger.paddingTop, "0px"); assert.equal(actual.trigger.paddingBottom, "0px");
    assert.equal(actual.trigger.fontSize, "14px"); assert.equal(actual.trigger.height, scene === "M1 wrapper" ? "36px" : "34px");
    assert.equal(actual.trigger.border, "1px"); assert.equal(actual.trigger.iconWidth, 15); assert.equal(actual.trigger.iconHeight, 15);
    assert.ok(actual.trigger.rightGap >= 12 && actual.trigger.rightGap <= 14, `Actual caret clearance ${actual.trigger.rightGap} must be at least 12px`);
    assert.equal(actual.pop.maxHeight, "264px"); assert.equal(actual.pop.border, "1px");
    const optionStyle = await page.getByRole("option").last().evaluate(element => { const css = getComputedStyle(element); return { paddingTop: css.paddingTop, paddingLeft: css.paddingLeft, border: css.borderTopWidth }; });
    assert.deepEqual(optionStyle, { paddingTop: "8px", paddingLeft: "9px", border: "0px" });
    if (screenshots) {
      await page.screenshot({ path: path.join(screenshots, `spacing-${scene.replaceAll(" ", "-")}-${theme}.png`) });
      fs.writeFileSync(path.join(screenshots, `spacing-${scene.replaceAll(" ", "-")}-${theme}.json`), JSON.stringify(actual, null, 2) + "\n");
    }
    await page.keyboard.press("Enter"); await triggerFocused();
    assert.deepEqual(await page.evaluate(() => window.trace.changes), ["c"]);
    if (config.modal) {
      assert.equal(await page.getByRole("dialog").count(), 1);
      await page.keyboard.press("Escape"); await page.locator("#closed").waitFor();
      assert.equal(await page.evaluate(() => window.trace.escapes), 1);
    }
  });
}

// Typography fixture only: real house Modal/OperatorBriefBlock/AutoGloss, no login or HTTP.
for (const theme of ["dark", "light"]) {
  test(`avatar typography ${theme}: unique actual brief marker, scoped reason fonts and unrelated-confirm counterexamples`, async () => {
    const relative = "app/components/domain-views/a-tabs/account-avatar-controls.css";
    const css = fs.readFileSync(path.join(fs.existsSync(path.join(sourceRoot, relative)) ? sourceRoot : fe, relative), "utf8");
    const sample = () => page.evaluate(() => Object.fromEntries(["reason", "reason-hint", "confirm-submit"].map(id => [id, getComputedStyle(document.getElementById(id)).fontSize])));
    await mount({ domain: "m", theme, modal: true, avatarConfirmation: "other" });
    const original = await sample();
    const style = await page.addStyleTag({ content: css });
    try {
      assert.deepEqual(await sample(), original, "An unrelated confirmation retains every sampled original font");
      await page.locator("#root").evaluate(root => { const marker = document.createElement("span"); marker.className = "self-avatar-confirm-detail"; root.append(marker); });
      assert.deepEqual(await sample(), original, "A marker outside the actual modal cannot select the unrelated reason fields");
      await mount({ domain: "m", theme, modal: true, avatarConfirmation: "self" });
      assert.equal(await page.locator(".modal .self-avatar-confirm-detail").count(), 1, "Actual OperatorBriefBlock and AutoGloss preserve exactly one producer marker, including its initially hidden detail");
      assert.equal(await page.locator(".modal:has(.self-avatar-confirm-detail)").count(), 1);
      assert.deepEqual(await sample(), { reason: "14px", "reason-hint": "14px", "confirm-submit": "14px" });
      assert.equal(await page.locator('label[for="reason"]').evaluate(element => getComputedStyle(element).fontSize), "14px");
      assert.deepEqual(await page.evaluate(() => Object.fromEntries(["avatar-body", "avatar-expiry", "avatar-file", "avatar-prepare"].map(id => [id, getComputedStyle(document.getElementById(id)).fontSize]))), { "avatar-body": "16px", "avatar-expiry": "14px", "avatar-file": "14px", "avatar-prepare": "14px" });
      await mount({ domain: "a", theme, modal: true, avatarConfirmation: "other" });
      const otherA = await sample();
      await style.evaluate(element => element.textContent = "");
      assert.deepEqual(await sample(), otherA, "A1 unrelated confirmation is unchanged by the local avatar stylesheet");
    } finally { await style.evaluate(element => element.remove()); }
  });
}
