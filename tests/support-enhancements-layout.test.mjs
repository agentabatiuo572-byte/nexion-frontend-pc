import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Offline native-layout regression from the actual JSX and styles. No app server,
// session, business API, or live acceptance result is used by this test.
const repo = process.env.SUPPORT_ANALYTICS_FE_ROOT || fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(path.join(repo, "package.json"));
const ts = require("typescript"), React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const { chromium } = require("@playwright/test"), postcss = require("postcss");
const tabs = "app/components/domain-views/m-tabs/";
const sourceRoot = process.env.SUPPORT_LAYOUT_SOURCE_ROOT || repo;
const source = relative => fs.readFileSync(path.join(fs.existsSync(path.join(sourceRoot, relative)) ? sourceRoot : repo, relative), "utf8");
const ruleSource = source(tabs + "m5-service-rules.tsx"), chatSource = source(tabs + "m3-dedicated-chat.tsx"), toolsSource = source(tabs + "support-content-tools.tsx");
const parse = text => ts.createSourceFile("fixture.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(text, predicate) {
  const tree = parse(text), nodes = [];
  function walk(node) { if (predicate(node)) nodes.push(node); ts.forEachChild(node, walk); }
  walk(tree);
  nodes.sort((a, b) => a.getWidth(tree) - b.getWidth(tree));
  assert.ok(nodes.length, "Actual component source target was not found");
  return nodes[0];
}
const jsx = (text, tag, marker) => find(text, n => ts.isJsxElement(n) && n.openingElement.tagName.getText() === tag && n.getText().includes(marker)).getText();
const declaration = (text, name) => "const " + find(text, n => ts.isVariableDeclaration(n) && n.name.getText() === name).getText() + ";";
function evaluate(text, imports = {}, globals = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = vm.createContext({ module, exports: module.exports, require: id => id.endsWith(".css") ? {} : imports[id] ?? require(id), ...globals });
  vm.runInContext(output, context);
  return { exports: module.exports, context };
}
function renderBit(markup, declarations) {
  const { exports } = evaluate(`export function Fixture(){${declarations};return (${markup});}`);
  return renderToStaticMarkup(React.createElement(exports.Fixture));
}
const radioMarkup = renderBit(jsx(ruleSource, "fieldset", "无专属客服客户分配方式"), 'const editable=true,draft={unboundAssignmentMode:"SUPERVISOR"},setField=()=>{}');
const headerMarkup = renderBit(jsx(chatSource, "header", 'className="m3-list-header"'), `
  const Icon=()=>null;
  const conversationsAvailable=true,query="",listTab="all",canWriteM3=true,canReadTimeout=true,canTimeout=true,actionChecking=false,qualificationUnknown=false;
  const archiveIds=new Set(["picked"]),setQuery=()=>{},setListTab=()=>{},setContactOpen=()=>{},setBulkOpen=()=>{},archiveBatch=()=>{},openTimeout=()=>{};
  const visible=Array.from({length:12005},(_,i)=>({status:i%3===0?"open":i%3===1?"closed":"transferred",unread:i%2,archived:i%5===0}));
  ${declaration(chatSource, "tabMatch")}
`);
const footerMarkup = renderBit(jsx(chatSource, "div", 'className="m3-list-footer"'), 'const listPage=2,setListPage=()=>{},conversationsAvailable=true,filtered=Array.from({length:100});');
const templates = [
  { id: "short", group: "客服", text: "已发布的回复内容", status: "published" },
  { id: "long", group: "客服", text: "长文案和编号需要换行".repeat(20) + "SKU_WITHOUT_SPACES_".repeat(20), status: "published" },
  { id: "draft", text: "DRAFT_SHOULD_NOT_APPEAR", status: "draft" },
];
const { exports: tools } = evaluate(toolsSource, {
  "@/lib/admin/m-support-enhancements": { supportEnhancements: { skus: () => { throw new Error("Offline test forbids API calls"); } } },
  "@/lib/admin/error-messages": { displayAdminError: () => "读取失败" },
  "../design-kit": { Icon: () => null, Modal: () => null },
  "./hd-ui": { HDSelect: () => null },
});
const ctx = { pget: key => key === "I.session.templatesAvailable" ? "1" : JSON.stringify(templates) };
const toolsMarkup = renderToStaticMarkup(React.createElement(tools.SupportContentTools, { ctx, disabled: false, onInsert() {}, onSelect() {} }));
function localCss(text) {
  const tree = parse(text), imports = tree.statements.filter(ts.isImportDeclaration).map(n => n.moduleSpecifier.text).filter(n => n?.endsWith(".css"));
  return imports.map(file => source(path.posix.join(tabs, file))).join("\n");
}
const globals = postcss.parse(fs.readFileSync(path.join(repo, "app/globals.css"), "utf8"));
globals.walkAtRules(rule => { if (["import", "font-face"].includes(rule.name)) rule.remove(); });
const css = globals.toString() + fs.readFileSync(path.join(repo, "app/components/domain-views/m-domain.css"), "utf8") + localCss(ruleSource) + localCss(chatSource) + localCss(toolsSource);
let browser, browserTemp;
after(async () => { try { await browser?.close(); } finally { if (browserTemp) fs.rmSync(browserTemp, {recursive:true,force:true}); } });
async function pageFor(markup, width, theme = "dark", inDomain = true, height = 1100, coarse = false) {
  if (!browser) {
    browserTemp = fs.mkdtempSync(path.join(os.tmpdir(), "support-layout-"));
    const log = path.join(browserTemp, "browser.log");
    browser = await chromium.launch({ headless: true, args: ["--log-file=" + log], env: {...process.env,CHROME_LOG_FILE:log} });
  }
  const page = await browser.newPage({ viewport: { width: Math.max(width + 32, 480), height }, hasTouch:coarse });
  let requests = 0;
  await page.route("**/*", route => { requests++; return route.abort(); });
  await page.setContent(`<html data-theme="${theme}"><head><style>${css}\n*{box-sizing:border-box}body{margin:0}.fixture{width:${width}px}</style></head><body><main class="dkpage ${inDomain ? "mdom" : ""} fixture">${markup}</main></body></html>`);
  return { page, async close() { assert.equal(requests, 0, "Offline regression attempted an external resource"); await page.close(); } };
}
async function within(locator, container, minimumHeight = 44) {
  const bounds = await container.boundingBox(), children = await locator.all();
  for (const child of children) {
    const box = await child.boundingBox();
    assert.ok(box && box.width > 0 && box.height >= minimumHeight, `Control is hidden or smaller than a ${minimumHeight}px target`);
    assert.ok(box.x >= bounds.x - 1 && box.x + box.width <= bounds.x + bounds.width + 1, "Control overflows its actual container");
  }
}
async function screenshot(page, name) {
  const output = process.env.SUPPORT_LAYOUT_EVIDENCE_DIR;
  if (!output) return;
  fs.mkdirSync(output, { recursive: true });
  await page.screenshot({ path: path.join(output, name + ".png"), fullPage: true });
}
test("M5 radios retain native size, aligned labels and an entire-row description", async () => {
  for (const [width, theme] of [[760, "dark"], [320, "light"]]) {
    const fixture = await pageFor(`<div class="m-admin-panel">${radioMarkup}</div>`, width, theme);
    try {
      const radios = fixture.page.getByRole("radio");
      assert.equal(await radios.count(), 2);
      for (const radio of await radios.all()) {
        const box = await radio.boundingBox(), label = await radio.locator("..").boundingBox();
        assert.ok(box.width <= 22 && box.height <= 22 && box.width >= 14 && box.height >= 14, "Radio inherits full-width text-field dimensions");
        assert.ok(label.height >= 44, "Radio label is not a usable touch target");
        assert.ok(Math.abs(box.y + box.height / 2 - label.y - label.height / 2) <= 2, "Radio and label do not share a row");
      }
      const group = fixture.page.getByRole("group", { name: "无专属客服客户分配方式" });
      const fieldset = await group.boundingBox(), help = await group.locator("p").boundingBox();
      assert.ok(help.width >= fieldset.width - 4, "Business explanation is trapped in one option's column");
      await fixture.page.getByRole("radio", { name: "客服主管分配" }).focus();
      assert.equal(await fixture.page.getByRole("radio", { name: "客服主管分配" }).evaluate(el => getComputedStyle(el.closest("label")).outlineStyle), "solid");
      await screenshot(fixture.page, `M5-${width}-${theme}`);
    } finally { await fixture.close(); }
  }
});
test("M3 five filters wrap without overlap, preserve large counts and retain 32px desktop / 44px coarse targets", async () => {
  for (const coarse of [false,true]) for (const width of [280, 300, 360]) {
    const fixture = await pageFor(`<section class="m3-stage m3-dedicated-stage" style="display:block"><div class="m3-col-list">${headerMarkup}</div></section>`, width, "dark", true, 1100, coarse);
    try {
      const header = fixture.page.locator("header"), buttons = header.locator("button[aria-pressed]");
      assert.equal(await buttons.count(), 5);
      const boxes = await Promise.all((await buttons.all()).map(button => button.boundingBox()));
      for (let i=0;i<boxes.length;i++) for (let j=i+1;j<boxes.length;j++) {
        const a=boxes[i],b=boxes[j];
        assert.ok(a.x+a.width<=b.x+1||b.x+b.width<=a.x+1||a.y+a.height<=b.y+1||b.y+b.height<=a.y+1,"Wrapped filters overlap");
      }
      assert.equal(await fixture.page.evaluate(() => matchMedia("(pointer: coarse)").matches),coarse);
      await within(header.locator(".m3-list-heading button,.m3-list-statuses button"), header, coarse ? 44 : 32);
      await within(header.locator(".m3-list-secondary-actions button"), header, coarse ? 44 : 28);
      assert.match(await buttons.first().innerText(), /9604/);
      assert.equal(await header.getByRole("button", { name: "主动联系", exact: true }).count(), 1);
      assert.equal(await header.getByRole("button", { name: "圈选群发", exact: true }).count(), 1);
      assert.equal(await header.getByRole("button", { name: "超时策略", exact: true }).count(), 1);
      await screenshot(fixture.page, `M3-list-${width}-${coarse?"coarse":"fine"}`);
    } finally { await fixture.close(); }
  }
});
test("short M3 windows scroll conversations without collapsing the list or clipping the persistent pager", async () => {
  const rows = Array.from({ length: 10 }, (_, n) => `<button type="button" class="l-btn sm">测试会话 ${n + 1}</button>`).join("");
  const markup = `<section class="m3-stage m3-dedicated-stage" style="display:block;height:min(760px,calc(100dvh - 220px));min-height:540px"><div class="m3-col-list" style="height:100%">${headerMarkup}<div class="cv-list">${rows}</div>${footerMarkup}</div></section>`;
  for (const [width, height, coarse] of [[360, 600, false], [360, 600, true], [1180, 900, false]]) {
    const fixture = await pageFor(markup, width, "dark", true, height, coarse);
    try {
      const column = fixture.page.locator(".m3-col-list"), list = column.locator(".cv-list");
      assert.ok((await list.boundingBox()).height >= 160, "Header collapses the conversation list");
      const scroll = await list.evaluate(el => ({ height: el.clientHeight, total: el.scrollHeight, overflow: getComputedStyle(el).overflowY }));
      if (height === 600) {
        assert.equal(scroll.overflow, "auto");
        assert.ok(scroll.total > scroll.height, "Short conversation list has no usable scroll boundary");
      } else assert.ok(scroll.total <= scroll.height + 1, "Desktop gets an unnecessary conversation scrollbar");
      await list.evaluate(el=>{el.scrollTop=el.scrollHeight;});
      const pager = column.getByRole("button", { name: "下一页", exact: true });
      await within(column.locator(".m3-list-footer button"), column, coarse ? 44 : 28);
      const outer = await column.boundingBox(), end = await pager.boundingBox();
      assert.ok(end.y >= outer.y - 1 && end.y + end.height <= outer.y + outer.height + 1, "Inbox pager is clipped outside the scroll viewport");
      await screenshot(fixture.page, `M3-inbox-${width}-${height}`);
    } finally { await fixture.close(); }
  }
});
test("shared private/bulk content tools keep three reachable picker triggers in narrow containers", async () => {
  for (const [width, theme, inDomain] of [[420, "dark", true], [280, "light", false]]) {
    const fixture = await pageFor(toolsMarkup, width, theme, inDomain);
    try {
      const root = fixture.page.locator(".support-content-tools");
      await within(root.locator("button"), root);
      assert.equal(await root.getByRole("button").count(), 3);
      await root.getByRole("button", { name: "回复模板与专属客服话术" }).focus();
      assert.equal(await fixture.page.evaluate(() => document.activeElement?.tagName), "BUTTON");
      assert.equal(await root.locator("details,select").count(), 0);
      assert.doesNotMatch(await root.innerText(), /DRAFT_SHOULD_NOT_APPEAR/);
      await screenshot(fixture.page, `content-${width}-${theme}`);
    } finally { await fixture.close(); }
  }
});
test("shared row and toolbar checkboxes stay native while number/date fields retain their layout", async () => {
  const fixture = await pageFor('<div class="m-admin-panel"><div class="m-admin-row"><label>勾选<input type="checkbox" checked></label><input aria-label="天数" type="number" value="7"></div><div class="m-admin-toolbar"><form><input aria-label="表单勾选" type="checkbox"><input aria-label="日期" type="date" value="2026-10-03"></form></div></div>', 560);
  try {
    for (const checkbox of await fixture.page.getByRole("checkbox").all()) {
      const box = await checkbox.boundingBox();
      assert.equal(box.width, 18); assert.equal(box.height, 18);
    }
    for (const control of [fixture.page.getByRole("spinbutton"), fixture.page.getByLabel("日期")]) {
      const box = await control.boundingBox();
      assert.ok(box.width >= 170 && box.height >= 38, "Text-like field lost its original usable geometry");
    }
  } finally { await fixture.close(); }
});
test("transferred history stays read-only and current-conversation navigation never reopens it", () => {
  const selected = { status: "transferred", ownerAdminId: 17, customerId: "42", detailReady: true };
  let href;
  const { context } = evaluate(`${declaration(chatSource, "canSendTo")} ${declaration(chatSource, "conversationStateLabel")} ${declaration(chatSource, "tabMatch")} ${declaration(chatSource, "continueClosed")}`, {}, {
    selected, adminId: 17, canWriteM3: true, URL, setRequestedCustomerId() {}, setScreen() {}, setActionError() {},
    window: { location: { href: "http://offline.invalid/service/sessions?conversationNo=OLD" }, history: { replaceState(_state, _title, url) { href = url.href; } } },
  });
  assert.equal(vm.runInContext("canSendTo(selected,adminId)", context), false);
  assert.equal(vm.runInContext("tabMatch(selected,'open')", context), false);
  assert.equal(vm.runInContext("tabMatch(selected,'closed')", context), true);
  assert.equal(vm.runInContext("conversationStateLabel(selected.status)", context), "已转出 · 只读");
  vm.runInContext("continueClosed()", context);
  assert.equal(new URL(href).searchParams.get("customerId"), "42");
  assert.equal(new URL(href).searchParams.has("conversationNo"), false);
  assert.equal(selected.status, "transferred");
  assert.equal(vm.runInContext("canSendTo(selected,adminId)", context), false);
});

test("historical read-only hints refer to current-conversation navigation only when its real button is visible", async () => {
  const action = find(chatSource, n => ts.isJsxElement(n) && n.openingElement.tagName.getText() === "button" && n.getText().includes('title="重新核对当前专属客服归属，前往当前会话；不会恢复历史段"'));
  const warning = find(chatSource, n => ts.isJsxElement(n) && n.openingElement.tagName.getText() === "div" && n.getText().includes("仅当前专属客服可发送消息；主管审阅不能代发。"));
  const enclosingExpression = node => {
    while (node && !ts.isJsxExpression(node)) node = node.parent;
    assert.ok(node, "Actual action/warning lost its JSX visibility condition");
    return node.getText();
  };
  const markup = `<>${enclosingExpression(action)}${enclosingExpression(warning)}</>`;
  const shared = ["canContinueClosed", "historyReadOnlyHint"].filter(name => chatSource.includes(`const ${name} =`)).map(name => declaration(chatSource, name)).join("\n");
  const cases = [
    { id: "super-review-transferred", role: "superadmin", adminId: 1, status: "transferred", detailReady: true, allowed: false },
    { id: "manager-review-transferred", role: "agent", adminId: 18, status: "transferred", detailReady: true, allowed: false },
    { id: "own-transferred", role: "agent", adminId: 17, status: "transferred", detailReady: true, allowed: true },
    { id: "own-closed", role: "agent", adminId: 17, status: "closed", detailReady: true, allowed: true },
    { id: "super-review-closed", role: "superadmin", adminId: 1, status: "closed", detailReady: true, allowed: false },
    { id: "own-transferred-detail-loading", role: "agent", adminId: 17, status: "transferred", detailReady: false, allowed: false },
    { id: "own-closed-detail-loading", role: "agent", adminId: 17, status: "closed", detailReady: false, allowed: false },
    { id: "own-transferred-read-only", role: "agent", adminId: 17, status: "transferred", detailReady: true, readOnly: true, allowed: false },
    { id: "own-open", role: "agent", adminId: 17, status: "open", detailReady: true, allowed: false },
    { id: "no-selection", role: "superadmin", adminId: 1, allowed: false },
  ];
  for (const row of cases) {
    const selected = row.status ? { status: row.status, ownerAdminId: 17, customerId: "42", detailReady: row.detailReady } : null;
    const session = { role: row.role, authorities: row.readOnly ? [] : ["service_m3_write"] };
    const rendered = renderBit(markup, `
      const selected=${JSON.stringify(selected)},session=${JSON.stringify(session)},adminId=${row.adminId};
      ${declaration(chatSource, "canWriteM3")}
      ${shared}
      const writable=false,recoveryBlocksTarget=false,selectedUnbound=false,currentProfileDetail=null,profileError="";
      const continueClosed=()=>{},setScreen=()=>{},setProfileRetry=()=>{},ctx={refreshConversations(){}};
    `);
    const fixture = await pageFor(rendered, 680);
    try {
      assert.equal(await fixture.page.getByRole("button", { name: "前往当前会话", exact: true }).count(), Number(row.allowed), row.id);
      const text = await fixture.page.locator(".itint.warn").allTextContents();
      assert.equal(text.join(" ").includes("前往当前会话"), row.allowed, `${row.id}: hint advertises a hidden action`);
      if (row.status === "transferred" && !row.readOnly) assert.match(text.join(" "), /此会话已转出，仅可查看历史。/, row.id);
      if (["super-review-transferred", "own-transferred"].includes(row.id)) await screenshot(fixture.page, `history-hint-${row.id}`);
    } finally { await fixture.close(); }
  }
});

// Actual picker loading, cancellation, disabled and retry behavior lives in support-content-tools-picker.test.mjs.

test("bulk preview displays the actual structured actor-qualification error without exposing unknown backend text", async () => {
  const bulkSource = source(tabs + "support-bulk-composer.tsx");
  const clientSource = source("lib/admin/m-support-client.ts");
  const clientError = find(clientSource, n => ts.isClassDeclaration(n) && n.name?.getText() === "SupportClientError").getText();
  const errorsSource = source("lib/admin/error-messages.ts");
  const helper = declaration(bulkSource, "isBulkPreviewDenied") + "\n" + declaration(bulkSource, "bulkPreviewError");
  const preview = find(bulkSource, n => ts.isCallExpression(n) && n.expression.getText() === "useEffect" && n.getText().includes('bulkPreview({filters,customerIds:[],excludedIds:[],selectionMode:"ALL_FILTERED"}')).getText();
  const freeze = find(bulkSource, n => ts.isFunctionDeclaration(n) && n.name?.getText() === "freeze").getText();
  const cases = [
    { status: 403, apiCode: 403, backend: "SUPPORT_AGENT_UNAVAILABLE", known: true },
    { status: 403, backend: "SUPPORT_AGENT_UNAVAILABLE", known: true },
    { status: 422, backend: "SUPPORT_AGENT_UNAVAILABLE", known: false },
    { status: 409, backend: "SUPPORT_AGENT_UNAVAILABLE", known: false },
    { status: 403, backend: "UNKNOWN_PRIVATE_BACKEND_TEXT_未知原因", known: false },
    { status: 403, known: false },
    { plainError: true, backend: "SUPPORT_AGENT_UNAVAILABLE", known: false },
  ];
  for (const row of cases) {
    let effect, context;
    const shown = [], steps = [], busyStates = [];
    ({ context } = evaluate(`${errorsSource}\n${clientError}\n${helper}\n${preview};\n${freeze}`, {}, {
      AbortController, filters: {}, retry: 0, epoch: 0, actorId: 1, selected: new Set(["42"]), busy: false, previewDenied: false, stamp: { current: "original" },
      useEffect(run) { effect = run; }, setQuery() {}, setSelected() {}, setPreviewDenied() {}, setError(text) { shown.push(text); }, setBusy(value) { busyStates.push(value); }, setStep(value) { steps.push(value); },
      supportEnhancements: { bulkPreview() { return Promise.reject(context.cause); } },
    }));
    context.cause = vm.runInContext(row.plainError
      ? `Object.assign(new Error("SUPPORT_API_403"),{status:403,backendMessage:${JSON.stringify(row.backend)}})`
      : `new SupportClientError(${row.status},${row.apiCode ?? "undefined"},${JSON.stringify(row.backend) ?? "undefined"})`, context);
    const fallback = vm.runInContext("displayAdminError(cause)", context);
    const cleanup = effect(); await new Promise(resolve => setImmediate(resolve)); cleanup();
    const previewMessage = shown.at(-1);
    if (row.known) assert.match(previewMessage, /当前账号.*专属客服资格.*群发.*客服主管/, "The real SupportClientError must reach the preview display boundary");
    else assert.equal(previewMessage, fallback, "Other statuses, unknown codes and forged errors keep the original safe fallback");
    assert.doesNotMatch(previewMessage, /SUPPORT_AGENT_UNAVAILABLE|UNKNOWN_PRIVATE_BACKEND_TEXT|未知原因/);
    await vm.runInContext("freeze()", context);
    assert.equal(shown.at(-1), previewMessage, "Freezing the selection uses the same preview-specific display boundary");
    assert.deepEqual(steps, []); assert.deepEqual(busyStates, [true, false]);
  }
});

test("topbar keeps permitted touch entrances visible within 56px at narrow and desktop widths", async () => {
  const topbarSource = source("app/components/shell/topbar.tsx");
  const { exports: authorities } = evaluate(source("lib/admin/shell-authorities.ts"));
  const bRead = authorities.B_DASHBOARD_READ_AUTHORITIES, mRead = authorities.M_CONTENT_READ_AUTHORITIES;
  let bReads = [];
  const { exports: topbar } = evaluate(topbarSource, {
    "lucide-react": require("lucide-react"),
    "next/link": { default: ({ children, prefetch: _prefetch, ...props }) => React.createElement("a", props, children) },
    "@/lib/store/admin-auth": { useAdminAuth: pick => pick({ logoutError: "" }) },
    "./breadcrumb": { Breadcrumb: () => React.createElement("nav", { className: "admin-topbar-breadcrumb flex min-w-0 items-center gap-2" }, React.createElement("span", { className: "admin-topbar-crumb-label" }, "客服中心 · 长名称服务会话页面")) },
    "./utc-clock": { UtcClock: () => React.createElement("span", null, "UTC 08:01:00") },
    "@/app/components/kit/role-badge": { RoleBadge: () => React.createElement("span", null, "总管理员") },
    "@/lib/format": { fmtPct: value => String(value * 100) + "%" },
    "./notification-bell": { NotificationBell: () => React.createElement("button", { type: "button", className: "relative grid h-9 w-9 place-items-center", "aria-haspopup": "dialog", "aria-label": "告警与待办" }, "铃") },
    "@/app/components/command-palette": { CommandPalette: () => null },
    "@/lib/admin/b-client": { useBDomainDashboard: enabled => { bReads.push(enabled); return { ledger: { coverageRatio: 1, redlinePct: 0.8, healthyPct: 1 }, loading: false, hasData: false, error: true }; } },
    "@/lib/admin/error-messages": {}, "./use-service-badges": {},
    "@/lib/admin/shell-authorities": authorities, "@/lib/admin/logout-request": {}, "@/lib/admin/auth-client": {},
  });
  const candidates = new Set(["flex", "min-w-0", "items-center", "gap-2", "relative", "grid", "h-9", "w-9", "place-items-center"]);
  const walk = node => { if (ts.isJsxAttribute(node) && node.name.getText() === "className" && node.initializer && ts.isStringLiteral(node.initializer)) node.initializer.text.split(/\s+/).forEach(value => candidates.add(value)); ts.forEachChild(node, walk); };
  walk(parse(topbarSource));
  const compiler = await require("@tailwindcss/node").compile('@import "tailwindcss";', { base: repo, onDependency() {} });
  const topbarCss = compiler.build([...candidates]) + globals.toString() + source("app/components/shell/topbar.css");
  const cases = [
    { viewport: 320, width: 320, role: "superadmin", grants: [...bRead, ...mRead] },
    { viewport: 360, width: 360, role: "superadmin", grants: [...bRead, ...mRead] },
    { viewport: 760, width: 516, role: "superadmin", grants: [...bRead, ...mRead] },
    { viewport: 1291, width: 1039, role: "superadmin", grants: [...bRead, ...mRead] },
    { viewport: 1440, width: 1440, role: "superadmin", grants: [...bRead, ...mRead] },
    { viewport: 360, width: 360, role: "support", grants: [...bRead, ...mRead] },
    { viewport: 360, width: 360, role: "superadmin", grants: [...bRead.slice(1), ...mRead] },
    { viewport: 360, width: 360, role: "superadmin", grants: [...bRead, ...mRead.slice(1)] },
    { viewport: 1291, width: 761, role: "superadmin", grants: [...bRead, ...mRead] },
    ...Array.from({ length: 23 }, (_, i) => ({ viewport: 1291, width: 560 + i * 20, role: "superadmin", grants: [...bRead, ...mRead] })),
  ];
  for (const row of cases) {
    bReads = [];
    const operator = "当前登录账号全称".repeat(12);
    const markup = renderToStaticMarkup(React.createElement(topbar.TopBar, { role: row.role, operator, domains: [], authorities: row.grants, servicePending: 120005 }));
    const canB = row.role !== "support" && bRead.every(value => row.grants.includes(value));
    const canM = mRead.every(value => row.grants.includes(value));
    assert.deepEqual(bReads, canB ? [true] : [], "B widget never bypasses the original complete authority gate");
    const fixture = await pageFor(markup, row.width, "dark", false, 900);
    try {
      await fixture.page.setViewportSize({ width: row.viewport, height: 900 });
      await fixture.page.addStyleTag({ content: topbarCss });
      const header = fixture.page.locator(".admin-topbar");
      assert.equal((await header.boundingBox()).height, 56);
      assert.equal(await header.locator(".admin-topbar-search").isVisible(), true, "Touch search must survive its responsive ancestors");
      assert.equal(await header.locator(".admin-topbar-coverage").count(), Number(canB));
      assert.equal(await header.locator(".admin-topbar-support").count(), Number(canM));
      assert.equal(await header.getByRole("button", { name: "告警与待办", exact: true }).count(), Number(row.role !== "support"));
      if (canB) { assert.equal(await header.locator(".admin-topbar-coverage").isVisible(), true); assert.equal(await header.locator(".admin-topbar-coverage").getAttribute("href"), "/overview/dual-ledger"); }
      if (canM) {
        const support = header.locator(".admin-topbar-support");
        assert.equal(await support.getAttribute("href"), "/service/sessions");
        assert.equal(await support.getAttribute("aria-label"), "客服中心，120005 位待办客户");
        assert.equal(await support.getAttribute("title"), "客服中心 · 待办客户");
      }
      assert.ok((await header.locator(".admin-topbar-account").getAttribute("aria-label"))?.includes(operator), "Compact account entry retains the complete accessible identity");
      const controls = header.locator(".admin-topbar-search,.admin-topbar-coverage,.admin-topbar-support,.admin-topbar-actions > button,.admin-topbar-account");
      await within(controls, header);
      const boxes = await Promise.all((await controls.all()).map(control => control.boundingBox()));
      for (let i = 0; i < boxes.length; i++) {
        assert.ok(boxes[i].width >= 44 && boxes[i].y >= 0 && boxes[i].y + boxes[i].height <= 56, "Compact control loses its 44px target or exceeds the bar");
        for (let j = i + 1; j < boxes.length; j++) assert.ok(boxes[i].x + boxes[i].width <= boxes[j].x + 1 || boxes[j].x + boxes[j].width <= boxes[i].x + 1, "Topbar entrances overlap");
      }
      if ([360, 760, 1291].includes(row.viewport) && canB && canM && row.role === "superadmin") await screenshot(fixture.page, `topbar-${row.viewport}-container-${row.width}`);
    } finally { await fixture.close(); }
  }
});
