import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { chromium } from "@playwright/test";
import { repositoryDigest } from "../scripts/lib/support-analytics-evidence.mjs";

const require = createRequire(import.meta.url), { webpack } = require("next/dist/compiled/webpack/webpack");
const repo = path.resolve(import.meta.dirname, ".."), runRoot = "D:/CodexData/test-environments/workflow-runs/support-analytics-20261007-r2";
const runId = process.env.WORKFLOW_RUN_ID || `manual-${Date.now()}`, checkId = process.env.WORKFLOW_CHECK_ID || "manual";
const acceptance = !process.env.WORKFLOW_RUN_ID ? "VISUAL-BASELINE"
  : process.env.WORKFLOW_STEP_ID === "I5R-V" && checkId === "runtime" ? "VISUAL-BASELINE"
  : process.env.WORKFLOW_STEP_ID === "integration" && checkId === "step-4-check-1" ? "VISUAL-BASELINE"
  : process.env.WORKFLOW_STEP_ID === "V1" && checkId === "runtime" ? "VISUAL-BASELINE"
  : process.env.WORKFLOW_STEP_ID === "integration" && checkId === "step-0-check-0" ? "VISUAL-BASELINE"
  : process.env.WORKFLOW_STEP_ID === "integration" && checkId === "integration-check-0" ? "VISUAL-INTEGRATION" : null;
if (!acceptance) throw new Error(`Unrecognised formal workflow check: ${process.env.WORKFLOW_STEP_ID}/${checkId}`);
const output = path.join(runRoot, "visual-row", runId, checkId);
const asset = path.join(repo, "app/components/domain-views/m-tabs/support-leaderboard-assets/approved-row.png");
const fontAsset = path.join(repo,"app/components/domain-views/m-tabs/support-leaderboard-assets/manrope-latin.woff2"), fontLicense = path.join(repo,"app/components/domain-views/m-tabs/support-leaderboard-assets/OFL-Manrope.txt");
const reference = "D:/WORKS/PLAN/.wt/cs-analytics-preview-20261006/docs/design/support-analytics-20261006/assets/leaderboard-approved-row-20261007.png";
const avatarRoot = "D:/WORKS/PLAN/.wt/cs-analytics-preview-20261006/docs/design/support-analytics-20261006/assets/avatars";
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.mkdirSync(output, { recursive: true });
const results = [], geometry = {}, deviations = [], diagnostics = {};
const sourceBefore = repositoryDigest(repo);
const record = (id, status, evidence) => results.push({ id, status, innerSkipped: 0, evidence: [typeof evidence === "string" ? evidence : JSON.stringify(evidence)] });
async function check(id, fn) { try { record(id, "pass", await fn()); } catch (error) { record(id, "fail", error.message); } }
await check("typecheck", () => { execFileSync(process.execPath, [path.join(repo, "node_modules/typescript/bin/tsc"), "--noEmit", "--incremental", "false"], { cwd: repo, encoding: "utf8", timeout: 120000, stdio: "pipe" }); return "Actual full repository tsc --noEmit --incremental false exited 0"; });
await check("approved-asset", () => { assert.equal(hash(asset), "410601675722d1ac94cb7ea1d6d8d2077408f4683f5c735f8294c04fae1039bf"); assert.equal(hash(asset), hash(reference)); assert.equal(hash(fontAsset),"e310b55a7fd9677f5e3555e6c6c4d064fa1f1d24393f0ddbe217cea12a8c432f"); return {art:hash(asset),manrope:hash(fontAsset)}; });
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: "development", devtool: false, context: repo, entry: path.join(repo, "tests/fixtures/support-leaderboard/fixture.tsx"), output: { path: output, filename: "fixture.js" }, resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules"), "node_modules"] }, module: { rules: [{ test: /\.(tsx?|css)$/, use: path.join(repo, "tests/fixtures/support-leaderboard/loader.cjs"), exclude: /node_modules/ }] } });
  compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
});
const avatars = {};
for (const [id, file] of Object.entries({ zhou: "women-39.jpg", yang: "men-40.jpg", zhang: "women-87.jpg", mia: "women-21.jpg", wang: "men-84.jpg", li: "women-85.jpg", chen: "men-75.jpg" })) avatars[id] = `data:image/jpeg;base64,${fs.readFileSync(path.join(avatarRoot, file)).toString("base64")}`;
const css = fs.readFileSync(path.join(repo, "app/components/domain-views/m-tabs/support-leaderboard.css"), "utf8").replace('url("./support-leaderboard-assets/approved-row.png")', `url("data:image/png;base64,${fs.readFileSync(asset).toString("base64")}")`);
const license=fs.readFileSync(fontLicense,"utf8");assert(!license.includes("-->"));fs.copyFileSync(fontLicense,path.join(output,"OFL-Manrope.txt"));
const fontCss=css.replace('url("./support-leaderboard-assets/manrope-latin.woff2")',`url("data:font/woff2;base64,${fs.readFileSync(fontAsset).toString("base64")}")`);
fs.writeFileSync(path.join(output, "fixture.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>批准横向排行榜 · 隔离fixture</title><!-- ${license} --><style>html,body{margin:0;background:#080909}body{--font-v5:"Manrope","Manrope Fallback","Manrope",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-family:var(--font-v5);font-size:16px;font-weight:400;line-height:24px;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}${fontCss}</style><div id="root"></div><script>window.fixtureAvatars=${JSON.stringify(avatars)}</script><script src="fixture.js"></script></html>`);
const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1346, height: 1169 }, deviceScaleFactor: 1 });
const page = await context.newPage(), errors = [], avatarErrors = []; let expectedAvatarFault = false;
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") (expectedAvatarFault && message.text().startsWith("Failed to load resource:") ? avatarErrors : errors).push(message.text()); });
await page.goto(pathToFileURL(path.join(output, "fixture.html")).href);
await page.locator(".sl-table tbody tr").first().waitFor();
await page.evaluate(async()=>{await document.fonts.load("600 30px Manrope","9007.2T");await document.fonts.ready;});
async function settle() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await page.locator(".sl-avatar img").evaluateAll(images => Promise.all(images.map(image => image.decode().catch(() => {})))); }
async function mode(name) { expectedAvatarFault = name === "avatar-failed"; await page.evaluate(name => window.renderLeaderboardFixture(name), name); await settle(); }
await settle();
await page.screenshot({ path: path.join(output, "1346x1169.png") });
await check("readable-child-fonts",async()=>{const text=await page.locator(".sl-amount>span,.sl-amount small,.sl-table th small,.sl-count small,.sl-brand small,.sl-footer").evaluateAll(els=>els.map(el=>({text:el.textContent,size:parseFloat(getComputedStyle(el).fontSize)})));assert(text.every(row=>row.size>=12.5),JSON.stringify(text));const links=await page.locator(".sl-customer-link").evaluateAll(els=>els.map(el=>({actual:getComputedStyle(el).fontSize,metric:getComputedStyle(el.closest("strong")).fontSize})));assert(links.every(row=>row.actual===row.metric),JSON.stringify(links));return {text,links};});

const targets = { ".sl-navigation": { bottom: 75 }, ".sl-self": { x: 32, y: 202, width: 1282, height: 69 }, ".sl-table thead": { bottom: 329 }, ...Object.fromEntries([530,633,735,835,914,994,1076].map((bottom,index) => [`.sl-table tbody tr:nth-child(${index+1})`, { bottom }])) };
for (const [selector, target] of Object.entries(targets)) {
  const actual = await page.locator(selector).evaluate(el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return { x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,font:s.fontFamily,size:s.fontSize,weight:s.fontWeight }; });
  geometry[selector] = actual;
  for (const [dimension, value] of Object.entries(target)) deviations.push({ selector, dimension, target:value, actual:actual[dimension], delta:actual[dimension]-value });
}
await check("critical-geometry", () => { assert(deviations.every(row => Math.abs(row.delta) <= 1), JSON.stringify(deviations.filter(row=>Math.abs(row.delta)>1))); return deviations; });
const original = await sharp(reference).ensureAlpha().raw().toBuffer({ resolveWithObject:true }), actual = await sharp(path.join(output,"1346x1169.png")).ensureAlpha().raw().toBuffer({resolveWithObject:true});
const overlay=Buffer.alloc(actual.data.length), diff=Buffer.alloc(actual.data.length);
for(let i=0;i<diff.length;i+=4){for(let c=0;c<3;c++){diff[i+c]=Math.min(255,Math.abs(actual.data[i+c]-original.data[i+c])*3);overlay[i+c]=Math.round((actual.data[i+c]+original.data[i+c])/2)}diff[i+3]=overlay[i+3]=255}
await sharp(overlay,{raw:actual.info}).png().toFile(path.join(output,"overlay-50.png"));await sharp(diff,{raw:actual.info}).png().toFile(path.join(output,"diff-3x.png"));
function glyphBounds(image,roi){let x1=roi[2],y1=roi[3],x2=0,y2=0,count=0;for(let y=roi[1];y<roi[3];y++)for(let x=roi[0];x<roi[2];x++){const i=(y*image.info.width+x)*4,c=[...image.data.subarray(i,i+3)];if(Math.min(...c)>125&&Math.max(...c)-Math.min(...c)<150){x1=Math.min(x1,x);y1=Math.min(y1,y);x2=Math.max(x2,x+1);y2=Math.max(y2,y+1);count++}}return {bounds:[x1,y1,x2,y2],brightPixelCount:count};}
const textGlyphs=Object.fromEntries(Object.entries({title:[32,99,291,184],brand:[70,15,153,45],champion20:[836,393,928,470],silver18:[837,551,900,608],bronze12:[837,653,900,710]}).map(([name,roi])=>{const target=glyphBounds(original,roi),rendered=glyphBounds(actual,["champion20","silver18","bronze12"].includes(name)?[roi[0]+44,roi[1],roi[2]+44,roi[3]]:roi);return [name,{target,rendered,edgeDeltas:rendered.bounds.map((v,i)=>v-target.bounds[i]),areaChangePercent:100*(rendered.brightPixelCount/target.brightPixelCount-1)}]}));
await check("unchanged-text-geometry",()=>{assert(["title","brand"].every(name=>textGlyphs[name].edgeDeltas.every(delta=>Math.abs(delta)<=1)),JSON.stringify(textGlyphs));return textGlyphs;});
const fontPage=await context.newPage(),fontDiagnosticWarnings=[];fontPage.on("console",message=>{if(message.type()==="error")fontDiagnosticWarnings.push(message.text())});await fontPage.goto(pathToFileURL(path.join(output,"fixture.html")).href);const cdp=await context.newCDPSession(fontPage);await fontPage.evaluate(async()=>{await document.fonts.load("600 30px Manrope","9007.2T");await document.fonts.ready;});await cdp.send("DOM.enable");await cdp.send("CSS.enable");const doc=await cdp.send("DOM.getDocument"),platformFonts={};for(const selector of [".sl-title h1",".sl-self h2",".sl-amount strong",".sl-count strong",".sl-person-name>button",".sl-brand>span"]){const node=await cdp.send("DOM.querySelector",{nodeId:doc.root.nodeId,selector});platformFonts[selector]=(await cdp.send("CSS.getPlatformFontsForNode",{nodeId:node.nodeId})).fonts;}await fontPage.close();

await check("same-project-font-and-numeric-tier",async()=>{const actual=await page.locator(".sl-table td[data-metric] strong,.sl-self-score strong").evaluateAll(els=>els.map(el=>{const s=getComputedStyle(el);return {text:el.textContent,family:s.fontFamily,size:s.fontSize,weight:s.fontWeight,line:s.lineHeight,stroke:s.webkitTextStrokeWidth,transform:s.transform,shadow:s.textShadow};}));assert(actual.every(row=>row.family.includes("Manrope")&&row.size==="30px"&&row.weight==="600"&&row.line==="40px"&&row.stroke==="0px"&&row.transform==="none"&&row.shadow==="none"),JSON.stringify(actual));assert(await page.evaluate(()=>document.fonts.check("600 30px Manrope","9007.2T")));for(const selector of [".sl-amount strong",".sl-count strong"])assert(platformFonts[selector].some(font=>font.isCustomFont&&/Manrope/.test(font.familyName)&&font.glyphCount>0),JSON.stringify(platformFonts));return {actual,platformFonts,fontBytes:hash(fontAsset),licenseBytes:hash(fontLicense),note:"Chinese retains native platform fallback; Manrope Latin has no CJK glyphs"};});
await check("approved-static-artwork-pixels",()=>{const samples={title:[32,93,281,185],brand:[72,13,172,63]},result={};for(const [name,roi] of Object.entries(samples)){let maximum=0,total=0,count=0;for(let y=roi[1];y<roi[3];y++)for(let x=roi[0];x<roi[2];x++)for(let channel=0;channel<3;channel++){const index=(y*actual.info.width+x)*4+channel,difference=Math.abs(actual.data[index]-original.data[index]);maximum=Math.max(maximum,difference);total+=difference;count++;}result[name]={roi,maximumChannelDifference:maximum,meanChannelDifference:total/count};assert(maximum<=1,JSON.stringify(result));}return result;});

const zones = { navigation:[32,0,1314,76], heading:[32,76,1314,202], self:[32,202,1314,271], tableHeader:[32,290,1314,329], goldRank:[80,346,263,471], silverRank:[80,542,218,620], bronzeRank:[80,645,218,720], table:[32,329,1314,1076], footer:[32,1095,1314,1140] };
const zoneMetrics={};
for(const [name,[x1,y1,x2,y2]] of Object.entries(zones)){let absolute=0,count=0;for(let y=y1;y<y2;y++)for(let x=x1;x<x2;x++){let i=(y*1346+x)*4;for(let c=0;c<3;c++){absolute+=Math.abs(actual.data[i+c]-original.data[i+c]);count++}}zoneMetrics[name]={bounds:[x1,y1,x2,y2],meanAbsoluteChannelError:absolute/count,classification:["self","tableHeader","table","footer"].includes(name)?"Contains explicitly approved data/movement/column changes; unmasked full difference":"Unmodified visual target; independent review required"}}
fs.writeFileSync(path.join(output,"deviations.json"),JSON.stringify({geometry,deviations,zoneMetrics,permittedDifferences:["Name-adjacent compact movement","Actual group under name","Amount/reference column and currency selector","Independent count column","Real photo replacement","Source-driven identity/time/disclosure"],fontLimit:"Source generated glyphs have no identified font file; bounds do not prove equivalent glyphs"},null,2));
async function paintedText(screenshot) {
  const rows = await page.locator(".sl-amount strong,.sl-amount>span,.sl-count strong,.sl-count>span,.sl-person-name>button,.sl-group").evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent,bounds:[r.x,r.y,r.right,r.bottom],hits:[.25,.5,.75].map(f=>{const hit=document.elementFromPoint(r.x+r.width*f,r.y+r.height/2);return hit===el||el.contains(hit)})}}));
  const pixels=await sharp(screenshot).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(const row of rows){let bright=0;for(let y=Math.max(0,Math.floor(row.bounds[1]));y<Math.min(pixels.info.height,Math.ceil(row.bounds[3]));y++)for(let x=Math.max(0,Math.floor(row.bounds[0]));x<Math.min(pixels.info.width,Math.ceil(row.bounds[2]));x++){const i=(y*pixels.info.width+x)*4;if(Math.min(pixels.data[i],pixels.data[i+1],pixels.data[i+2])>145)bright++}row.brightPixels=bright;assert(bright>2,`${row.text} lacks actual painted glyph pixels`); if((row.bounds[1]+row.bounds[3])/2<page.viewportSize().height&&row.bounds[1]>=0)assert(row.hits.every(Boolean),JSON.stringify(row))}
  return rows;
}
await check("baseline-paint",()=>paintedText(path.join(output,"1346x1169.png")));
await check("independent-customer-column",async()=>{assert.equal(await page.locator(".sl-table th").count(),6);const data=await page.locator(".sl-table tbody tr").evaluateAll(rows=>rows.map(row=>({name:row.querySelector(".sl-person-name>button").textContent,first:row.querySelector('td[data-metric="firstPayment"] strong').textContent,bound:row.querySelector('td[data-metric="customers"] strong').textContent,canClick:!!row.querySelector(".sl-customer-link")})));assert(data.every(row=>Number(row.bound)>Number(row.first)));assert.equal(data.filter(row=>row.canClick).map(row=>row.name).join(),"Mia");await page.getByRole("button",{name:/^查看Mia的当前绑定客户明细/}).click();assert((await page.evaluate(()=>window.fixtureEvents)).includes("customers:mia"));return data;});
await check("precise-compact-format",async()=>{const cases=[["0","amount","0"],[null,"amount","待核实"],["999","count","999"],["1000","count","1K"],["12500","amount","12.5K"],["1000000","amount","1M"],["999.99","amount","999.99"],["999.995","amount","1K"],["999949","amount","999.9K"],["999950","amount","1M"],["999999999950","amount","1T"],["9007199254740993.01","amount","9007.2T"],["0.009","amount","<0.01"],["0.001","amount","<0.01"],["1.999","amount","2"],["12.50","amount","12.5"]];const actual=await page.evaluate(cases=>cases.map(([raw,kind,expected])=>({raw,kind,expected,actual:window.compactSupportBoardValue(raw,kind)})),cases);assert(actual.every(row=>row.actual===row.expected),JSON.stringify(actual));return actual;});
await check("keyboard-precise-values",async()=>{const summary=page.locator(".sl-number-detail summary");for(let i=0;i<await summary.count();i++){const trigger=summary.nth(i);await trigger.focus();await trigger.press("Enter");const popup=page.locator(".sl-movement-explanation:popover-open");await popup.waitFor({state:"visible"});const text=await popup.innerText();assert(/：[0-9]/.test(text),text);assert(await popup.evaluate(el=>{const r=el.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return h===el||el.contains(h)}));await trigger.press("Escape");await popup.waitFor({state:"hidden"});assert(await trigger.evaluate(el=>document.activeElement===el));}return "Every amount/count/self precise value opens through keyboard and returns focus";});
await check("mouse-actions",async()=>{await page.getByRole("button",{name:"查看张晓雨成绩",exact:true}).click();await page.getByRole("button",{name:"定位我",exact:true}).click();assert((await page.evaluate(()=>window.fixtureEvents)).includes("view:zhang"));assert((await page.evaluate(()=>window.fixtureEvents)).includes("locate:mia"));return "Avatar and locate callbacks operated with real clicks";});
await check("all-movement-popovers",async()=>{const summary=page.locator(".sl-movement summary");for(let index=0;index<await summary.count();index++){const trigger=summary.nth(index);await trigger.click();const popup=page.locator(".sl-movement-explanation:popover-open");await popup.waitFor({state:"visible"});const state=await popup.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {text:el.textContent,visible:hit===el||el.contains(hit),inside:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}});assert(state.visible&&state.inside&&state.text.length>5,JSON.stringify(state));await trigger.press("Escape");await popup.waitFor({state:"hidden"});assert(await trigger.evaluate(el=>document.activeElement===el));}return "All self/table movements click, readable top layer, viewport bounds, Escape and returned focus";});
await check("keyboard-filters",async()=>{const scope=page.getByRole("combobox",{name:"榜单范围"});await scope.focus();await page.keyboard.press("Space");await page.keyboard.press("ArrowDown");await page.keyboard.press("Enter");assert.equal(await scope.inputValue(),"mine");await scope.selectOption("long");const bounds=await page.locator('.sl-select:has(select[aria-label="榜单范围"])').evaluate(el=>{const span=el.querySelector(".sl-selected-value"),r=el.getBoundingClientRect(),s=span.getBoundingClientRect();return {fits:s.top>=r.top&&s.bottom<=r.bottom&&s.right<=r.right-35,ellipsis:getComputedStyle(span).textOverflow}});assert(bounds.fits&&bounds.ellipsis==="ellipsis",JSON.stringify(bounds));await scope.click();await page.screenshot({path:path.join(output,"dropdown-open.png")});await page.keyboard.press("Escape");assert(await scope.evaluate(el=>document.activeElement===el));return "Native keyboard option selection, long closed-label ellipsis, Escape and focus";});
await check("tabs-and-coverage-partition",async()=>{await mode("reference-unknown");assert.equal(await page.locator('tr[data-rank="1"]').count(),1);assert.equal(await page.locator(".sl-amount strong").first().innerText(),"待核实");assert.equal(await page.locator(".sl-table tbody .sl-movement-up").count(),2);const before=await page.locator(".sl-table tbody").evaluate(el=>[...el.rows].map(row=>[row.dataset.rank,row.querySelector(".sl-count").textContent,row.querySelector(".sl-movement").textContent]));await page.getByRole("combobox",{name:"币种"}).selectOption("NEX");const after=await page.locator(".sl-table tbody").evaluate(el=>[...el.rows].map(row=>[row.dataset.rank,row.querySelector(".sl-count").textContent,row.querySelector(".sl-movement").textContent]));assert.deepEqual(after,before);await mode("baseline");await page.getByRole("combobox",{name:"月份"}).selectOption("2026-09");await page.getByRole("tab",{name:"客户规模"}).click();assert.equal(await page.getByRole("combobox",{name:"月份"}).count(),0);assert.equal(await page.locator(".sl-amount").first().getAttribute("data-period"),"2026.10");assert.equal(await page.locator(".sl-table th").nth(4).innerText(),"绑定客户数\n人 · 截至现在");assert.equal(await page.locator(".sl-table th[data-primary]").innerText(),"绑定客户数\n人 · 截至现在");await page.getByRole("tab",{name:"首充人数"}).click();assert.equal(await page.getByRole("combobox",{name:"月份"}).inputValue(),"2026-09");await page.getByRole("tab",{name:"首充人数"}).press("ArrowRight");assert.equal(await page.getByRole("tab",{name:"充值贡献"}).getAttribute("aria-selected"),"true");return "Unknown reference preserves primary ranks/movement; currency change leaves count ranks unchanged; historical→customers uses explicit current reference and restores prior month";});
for(const [width,height] of [[1351,1164],[1415,1220],[1000,900]]){await page.setViewportSize({width,height});await mode("baseline");await page.screenshot({path:path.join(output,`${width}x${height}.png`),fullPage:false});await check(`viewport-${width}`,async()=>{assert.equal(await page.getByRole("tab",{name:"首充人数"}).getAttribute("aria-selected"),"true");assert.equal(await page.getByRole("combobox",{name:"榜单范围"}).inputValue(),"all");assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));return "Fresh keyed baseline, screenshot, no page horizontal overflow";});}
await page.setViewportSize({width:1000,height:900});await mode("baseline");await check("narrow-table-reachability",async()=>{const wrap=page.locator(".sl-table-wrap");await wrap.evaluate(el=>el.scrollLeft=el.scrollWidth);await page.screenshot({path:path.join(output,"1000x900-scroll-right.png")});await page.getByRole("button",{name:/^查看成绩\s*：Mia$/}).click();assert((await page.evaluate(()=>window.fixtureEvents)).includes("view:mia"));const fonts=await page.locator(".sl-table th small,.sl-amount small,.sl-amount>span,.sl-account button,.sl-footer").evaluateAll(els=>els.map(el=>({text:el.textContent,size:parseFloat(getComputedStyle(el).fontSize)})));assert(fonts.every(row=>row.size>=12.5),JSON.stringify(fonts));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));return fonts;});
await page.setViewportSize({width:1346,height:1169});
await page.evaluate(()=>{window.fixtureTransform=rows=>{window.fixtureCapturedRows=rows;return rows;};});
for(const name of ["money-3","money-4","money-6","money-7","money-decimal","long","big-gap","ties","few","zero","unknown","reference-unknown","cross-page-tie","empty","loading","error","avatar-failed","avatar-none","identity-change","compact-ranking","tiny-amount","self-offpage","bindings-unknown","bindings-long","permission-all","permission-none","page"]){await mode(name);const screenshot=path.join(output,`${name}.png`);await page.screenshot({path:screenshot,fullPage:true});await check(`state-${name}`,async()=>{if(["long","ties","zero"].includes(name)){const rows=await page.evaluate(()=>window.fixtureCapturedRows);const raw=rows.map(row=>name==="ties"?row.firstPayment.value:row.amount.value);const decimal=value=>{const [whole,fraction=""]=value.split(".");return BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0"));};const values=raw.map(decimal);assert(values.every((value,i)=>!i||values[i-1]>=value),"Fixture is not sorted by authoritative raw value");for(let i=0;i<rows.length;i++){const expected=values.findIndex(value=>value===values[i])+1;assert.equal(rows[i].rank,expected,"Illegal competition rank in "+name);assert.equal(rows[i].isTied,values.filter(value=>value===values[i]).length>1,"Illegal authoritative tie flag");}diagnostics[name+"-authoritative-rows"]=rows.map((row,i)=>({id:row.id,rank:row.rank,isTied:row.isTied,raw:raw[i]}));}
if(name==="long"||name==="bindings-long"){const tiles=await page.locator(".sl-rank-sprite").evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect(),p=el.closest("tr").getBoundingClientRect(),rank=el.closest("tr").dataset.rank;return {rank,bounds:[r.x+8,r.bottom+1,r.right,p.bottom-1],height:r.height}}));const pixels=await sharp(screenshot).ensureAlpha().raw().toBuffer({resolveWithObject:true});for(const tile of tiles){assert(tile.height<=({1:201,2:103,3:102,5:79,6:80}[tile.rank]));let leaked=0;for(let y=Math.max(0,Math.ceil(tile.bounds[1]));y<Math.floor(tile.bounds[3]);y++)for(let x=Math.max(0,Math.ceil(tile.bounds[0]));x<Math.min(pixels.info.width,Math.floor(tile.bounds[2]));x++){const i=(y*pixels.info.width+x)*4;if(Math.max(pixels.data[i],pixels.data[i+1],pixels.data[i+2])>100)leaked++}assert.equal(leaked,0,"Source sprite leaked a next row below its authorised crop: "+JSON.stringify(tile));}diagnostics[name+"-sprite-crops"]=tiles;}if(name==="compact-ranking"){assert.equal(await page.locator('tr[data-rank="1"] .sl-amount strong').innerText(),"1.2K");assert.equal(await page.locator('tr[data-rank="2"] .sl-amount strong').innerText(),"1.2K");assert.equal(await page.locator('tr[data-rank="1"]').count(),1);assert.equal(await page.locator('tr[data-rank="2"]').count(),1);}if(name==="tiny-amount"){assert.equal(await page.locator(".sl-amount strong").first().innerText(),"<0.01");assert.equal(await page.locator(".sl-amount strong").last().innerText(),"0");}if(name==="long"||name==="big-gap"){const trigger=page.locator(".sl-amount summary").first();await trigger.focus();await trigger.press("Enter");const popup=page.locator(".sl-movement-explanation:popover-open");await popup.waitFor({state:"visible"});assert((await popup.innerText()).includes(name==="long"?"987654321012345.99":"2000000000000000"));await trigger.press("Escape");await popup.waitFor({state:"hidden"});}if(name==="unknown"){assert.equal(await page.locator(".sl-rank-sprite").count(),0);assert.equal(await page.locator(".sl-movement-up,.sl-movement-down,.sl-movement-new").count(),0)}if(name==="ties"||name==="zero"){assert.equal(await page.locator('tr[data-rank="1"]').count(),name==="ties"?9:7);assert.equal(await page.locator(".sl-avatar-large").count(),name==="ties"?9:7)}if(name==="few")assert.equal(await page.locator(".sl-table tbody tr").count(),1);if(name==="self-offpage"){assert.equal(await page.locator("tbody tr[data-self]").count(),0);assert.equal(await page.locator(".sl-self-rank").innerText(),"并列第 3");await page.getByRole("button",{name:"定位我",exact:true}).click();assert((await page.evaluate(()=>window.fixtureEvents)).includes("locate:mia"))}if(name==="permission-none")assert.equal(await page.locator(".sl-customer-link").count(),0);if(name==="permission-all")assert.equal(await page.locator(".sl-customer-link").count(),7);if(name==="bindings-unknown")assert((await page.locator('td[data-metric="customers"] strong').allTextContents()).every(value=>value==="待核实"));if(name==="bindings-long")diagnostics[name]=await paintedText(screenshot);if(name==="cross-page-tie")assert.equal(await page.locator(".sl-self-rank").innerText(),"并列第 6");if(name==="empty"||name==="loading"||name==="error")assert.equal(await page.locator(".sl-table").count(),0);if(name==="error"){await page.getByRole("button",{name:"重试",exact:true}).click();assert((await page.evaluate(()=>window.fixtureEvents)).includes("retry"))}if(name==="avatar-failed"||name==="avatar-none"||name==="identity-change")assert.equal(await page.locator(".sl-avatar img").count(),0);if(name==="page"){await page.getByRole("button",{name:"下一页"}).click();assert((await page.evaluate(()=>window.fixtureEvents)).includes("page:3"))}if(name.startsWith("money-")||name==="long"||name==="big-gap"){diagnostics[name]=await paintedText(screenshot);assert(await page.locator(".sl-person-text").evaluateAll(els=>els.every(el=>el.getBoundingClientRect().width>40)));assert(await page.locator(".sl-self").evaluate(el=>{const r=el.getBoundingClientRect();return [...el.children].every(child=>{const b=child.getBoundingClientRect();return b.x>=r.x&&b.right<=r.right&&b.y>=r.y&&b.bottom<=r.bottom})}));}return `Actual React ${name} state and full screenshot exercised`;});}
await page.evaluate(()=>{window.fixtureTransform=rows=>rows.map((row,i)=>i===0?{...row,amount:{...row.amount,value:"9007199254740993.01"}}:row);});
await page.setViewportSize({width:1000,height:900});await mode("baseline");await page.getByRole("tab",{name:"充值贡献",exact:true}).click();await settle();
await page.screenshot({path:path.join(output,"safe-integer-narrow.png"),fullPage:true});
await check("narrow-authoritative-skeleton-and-money",async()=>{const result=await page.locator("tbody tr").first().evaluate(row=>{const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width};};return {rank:rect(row.cells[0]),person:rect(row.cells[1]),avatar:rect(row.querySelector(".sl-avatar-large")),sprite:rect(row.querySelector(".sl-rank-sprite")),amount:rect(row.querySelector(".sl-amount strong")),cell:rect(row.cells[2]),text:row.querySelector(".sl-amount strong").textContent,size:parseFloat(getComputedStyle(row.querySelector(".sl-amount strong")).fontSize)};});assert.equal(result.rank.width,232);assert.equal(result.person.width,429);assert(result.sprite.right<result.avatar.x,JSON.stringify(result));assert.equal(result.text,"9007.2T");assert.equal(result.size,30);assert(result.amount.x>=result.cell.x+8&&result.amount.right<=result.cell.right-8,JSON.stringify(result));return result;});
await page.evaluate(()=>{window.fixtureTransform=undefined;});await page.setViewportSize({width:1346,height:1169});
for (const scenario of ["counts-unavailable-stale", "counts-partial"]) for (const board of ["首充人数", "充值贡献", "购机贡献", "客户规模"]) for (const currency of ["USDT", "NEX"]) {
  await mode(scenario);
  await page.getByRole("tab", { name: board, exact: true }).click();
  await page.getByRole("combobox", { name: "币种" }).selectOption(currency);
  await settle();
  await check(`${scenario}-${board}-${currency}`, async () => {
    const unavailable = scenario === "counts-unavailable-stale", money = board === "充值贡献" || board === "购机贡献";
    const first = await page.locator('td[data-metric="firstPayment"] strong').allTextContents();
    const customers = await page.locator('td[data-metric="customers"] strong').allTextContents();
    assert.deepEqual(first, unavailable ? Array(7).fill("待核实") : ["20", "18", "12", "12", "9", "7", "7"]);
    assert.deepEqual(customers, unavailable ? Array(7).fill("待核实") : ["40", "36", "24", "24", "18", "14", "14"]);
    assert.equal(await page.locator(".sl-customer-link").count(), unavailable ? 0 : 1);
    assert.equal(await page.locator(".sl-count small").count(), unavailable ? 0 : 14);
    if (unavailable) assert.equal(await page.locator(".sl-count summary").count(), 0);
    assert.equal(await page.locator(".sl-self-score strong").innerText(), money ? "12K" : unavailable ? "待核实" : board === "首充人数" ? "12" : "24");
    const selfNote = page.locator(".sl-self-score .sl-amount-note summary");
    assert.equal(await selfNote.count(), !unavailable && !money ? 1 : 0);
    if (!unavailable && !money) {
      assert.equal(await selfNote.innerText(), "暂定");
      await selfNote.focus(); await selfNote.press("Enter");
      const popup = page.locator(".sl-movement-explanation:popover-open");
      await popup.waitFor({ state: "visible" });
      assert((await popup.innerText()).includes(board === "首充人数" ? "首充来源覆盖待核对" : "绑定来源覆盖待核对"));
      await selfNote.press("Escape"); await popup.waitFor({ state: "hidden" });
      assert(await selfNote.evaluate(el => document.activeElement === el));
      assert(await page.locator(".sl-self-score").evaluate(el => { const parent = el.closest(".sl-self").getBoundingClientRect(), r = el.getBoundingClientRect(); return r.x >= parent.x && r.right <= parent.right && r.y >= parent.y && r.bottom <= parent.bottom; }));
    }
    assert.equal(await page.locator(".sl-rank-sprite").count(), money ? 7 : 0);
    if (currency === "USDT" && !money) await page.screenshot({ path: path.join(output, `${scenario}-${board}.png`), fullPage: true });
    return "Unavailable retained counts are concealed in both columns and self; partial known values remain provisional; money ranks and values remain independent";
  });
}
for(const board of ["充值贡献","购机贡献"]){for(const currency of ["USDT","NEX"]){await mode("money-6");await page.getByRole("tab",{name:board,exact:true}).click();await page.getByRole("combobox",{name:"币种"}).selectOption(currency);await settle();const screenshot=path.join(output,`matrix-${board}-${currency}.png`);await page.screenshot({path:screenshot,fullPage:true});await check(`money-matrix-${board}-${currency}`,async()=>{const fonts=await page.locator(".sl-table tbody tr").evaluateAll(rows=>rows.map(row=>({amount:parseFloat(getComputedStyle(row.querySelector(".sl-amount strong")).fontSize),secondary:[...row.querySelectorAll(".sl-count strong")].map(el=>parseFloat(getComputedStyle(el).fontSize))})));assert(fonts.every(row=>row.amount===30&&row.secondary.every(size=>size===30)),JSON.stringify(fonts));return {fonts,paint:await paintedText(screenshot)};});}}

for(const width of [1346,1000])for(const board of ["首充人数","充值贡献","购机贡献","客户规模"])for(const permission of [false,true])for(const raw of ["12500","9007199254740993"])for(const currency of ["USDT","NEX"]){
  const id=`count-matrix-${width}-${board}-${permission}-${raw}-${currency}`;
  await page.setViewportSize({width,height:width===1346?1169:900});
  await page.evaluate(({raw,permission})=>{window.fixtureTransform=rows=>rows.map(row=>{const value=(BigInt(raw)-BigInt(row.rank-1)*1000n).toString();return {...row,canViewCustomers:permission,firstPayment:{...row.firstPayment,value},customers:{...row.customers,value},amount:{...row.amount,value:value+".01"}};});},{raw,permission});
  await mode("baseline");await page.getByRole("tab",{name:board,exact:true}).click();await page.getByRole("combobox",{name:"币种"}).selectOption(currency);await settle();
  await check(id,async()=>{
    const cells=await page.locator("tbody td[data-metric]").evaluateAll(els=>els.map(td=>{const value=td.querySelector("strong"),b=value.getBoundingClientRect(),r=td.getBoundingClientRect();return {metric:td.dataset.metric,text:value.textContent,x:b.x,right:b.right,bottom:b.bottom,cellX:r.x,cellRight:r.right,units:td.querySelectorAll(".sl-count>span,.sl-amount>span").length,size:parseFloat(getComputedStyle(value).fontSize),weight:getComputedStyle(value).fontWeight,line:getComputedStyle(value).lineHeight,family:getComputedStyle(value).fontFamily};}));
    assert(cells.every(cell=>cell.x>=cell.cellX+8&&cell.right<=cell.cellRight-8),JSON.stringify(cells.filter(cell=>cell.x<cell.cellX+8||cell.right>cell.cellRight-8)));
    assert(cells.every(cell=>cell.units===0&&cell.size===30&&cell.weight==="600"&&cell.line==="40px"&&cell.family.includes("Manrope")),JSON.stringify(cells));
    const wrap=page.locator(".sl-table-wrap");
    for(const side of ["left","right"]){await wrap.evaluate((el,side)=>el.scrollLeft=side==="left"?0:el.scrollWidth,side);await settle();const screenshot=path.join(output,id+"-"+side+".png");await page.screenshot({path:screenshot,fullPage:true});const pixels=await sharp(screenshot).ensureAlpha().raw().toBuffer({resolveWithObject:true});const visible=await page.locator("tbody td[data-metric] strong").evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect(),cx=r.x+r.width/2,cy=r.y+r.height/2,hit=document.elementFromPoint(cx,cy);return {text:el.textContent,bounds:[r.x,r.y,r.right,r.bottom],inX:r.x>=0&&r.right<=innerWidth,inY:cy<innerHeight,hit:hit===el||el.contains(hit)};}));for(const value of visible.filter(value=>value.inX)){let bright=0;for(let y=Math.max(0,Math.floor(value.bounds[1]));y<Math.min(pixels.info.height,Math.ceil(value.bounds[3]));y++)for(let x=Math.max(0,Math.floor(value.bounds[0]));x<Math.min(pixels.info.width,Math.ceil(value.bounds[2]));x++){const index=(y*pixels.info.width+x)*4;if(Math.min(pixels.data[index],pixels.data[index+1],pixels.data[index+2])>145)bright++;}assert(bright>2,JSON.stringify(value));if(value.inY)assert(value.hit,JSON.stringify(value));}}
    if(permission){const buttons=page.locator(".sl-customer-link");assert.equal(await buttons.count(),7);for(let i=0;i<7;i++){const button=buttons.nth(i),exact=(BigInt(raw)-BigInt([1,2,3,3,5,6,6][i]-1)*1000n).toString();assert((await button.getAttribute("aria-label")).includes(exact+" 人"));assert((await button.getAttribute("title")).includes(exact));await button.focus();await button.press("Enter");assert((await page.evaluate(()=>window.fixtureEvents)).includes("customers:"+["zhou","yang","zhang","mia","wang","li","chen"][i]));}}
    else{assert.equal(await page.locator(".sl-customer-link").count(),0);const trigger=page.locator('td[data-metric="customers"] summary').first();await trigger.focus();await trigger.press("Enter");const popup=page.locator(".sl-movement-explanation:popover-open");await popup.waitFor({state:"visible"});assert((await popup.innerText()).includes(raw));await trigger.press("Escape");await popup.waitFor({state:"hidden"});}
    const score=page.getByRole("button",{name:/^查看成绩\s*：周芷宁$/});await score.click();assert((await page.evaluate(()=>window.fixtureEvents)).includes("view:zhou"));
    return {cells,screenshots:id+"-{left,right}.png",exactRaw:raw,permission,callbacks:"Actual Enter drilldown or exact-value popup, and unobstructed performance action"};
  });
}
await page.evaluate(()=>window.fixtureTransform=undefined);await page.setViewportSize({width:1346,height:1169});
await mode("brand-other");await check("static-artwork-accessibility-and-fallback",async()=>{assert.equal(await page.getByRole("heading",{level:1,name:"业绩榜",exact:true}).count(),1);assert((await page.locator(".sl-brand").innerText()).includes("Other Brand"));assert.equal(await page.locator(".sl-brand>span").getAttribute("data-artwork"),null);await mode("baseline");assert.equal(await page.locator(".sl-brand>span").getAttribute("data-artwork"),"true");assert.equal(await page.getByRole("heading",{level:1,name:"业绩榜",exact:true}).count(),1);return "Static lettering keeps real accessible text; variable brand uses live DOM fallback";});


await page.evaluate(()=>window.fixtureTransform=undefined);await page.setViewportSize({width:1346,height:1169});
for(const board of ["首充人数","充值贡献","购机贡献","客户规模"])for(const currency of ["USDT","NEX"])for(const scenario of ["baseline","period-same-dash","period-different","period-missing","period-invalid","period-partial","period-unavailable","period-null"]){
  const id=`common-period-${board}-${currency}-${scenario}`;
  await mode(scenario);await page.getByRole("tab",{name:board,exact:true}).click();await page.getByRole("combobox",{name:"币种"}).selectOption(currency);await settle();
  await page.screenshot({path:path.join(output,id+".png"),fullPage:true});
  await check(id,async()=>{
    const reference=board==="客户规模",money=board==="充值贡献"||board==="购机贡献",validPeriod=["baseline","period-same-dash","period-partial","period-unavailable","period-null"].includes(scenario),normal=["baseline","period-same-dash"].includes(scenario),known=validPeriod&&!["period-unavailable","period-null"].includes(scenario);
    const headers=await page.locator('.sl-table th:nth-child(3) small,.sl-table th:nth-child(4) small').allTextContents();
    assert.deepEqual(headers,[currency+" · "+(reference?"2026.10 · 参考":"2026.10"),"人 · "+(reference?"2026.10 · 参考":"2026.10")]);
    assert.equal(await page.locator(".sl-table th:nth-child(5) small").innerText(),"人 · 截至现在");
    assert.equal(await page.locator(".sl-amount>small").count(),0);
    assert.equal(await page.locator(".sl-amount .sl-amount-note").count(),normal?0:7);
    assert.equal(await page.locator('tr[data-rank="1"]').count(),money&&!normal?0:1);
    assert.equal(await page.locator(".sl-self-rank").innerText(),money&&!normal?"待核实":"并列第 3");
    assert.equal(await page.locator(".sl-amount strong").first().innerText(),known?"20K":"待核实");
    if(known){const summary=page.locator(".sl-amount .sl-number-detail summary").first();const period=await page.locator(".sl-amount").first().getAttribute("data-period");assert((await summary.getAttribute("aria-label")).includes(period));await summary.focus();await summary.press("Enter");const popup=page.locator(".sl-movement-explanation:popover-open");await popup.waitFor({state:"visible"});assert((await popup.innerText()).includes(period));assert((await popup.innerText()).includes("20000 "+currency));await summary.press("Escape");await popup.waitFor({state:"hidden"});}
    if(!normal){const summary=page.locator(".sl-amount-note summary").first();await summary.focus();await summary.press("Enter");const popup=page.locator(".sl-movement-explanation:popover-open");await popup.waitFor({state:"visible"});const text=await popup.innerText();assert(text.includes("真实统计期")&&text.includes("原始业绩额"));await summary.press("Escape");await popup.waitFor({state:"hidden"});assert(await summary.evaluate(el=>document.activeElement===el));}
    if(money){assert.equal(await page.locator(".sl-self-score strong").innerText(),known?"12K":"待核实");assert.equal(await page.locator(".sl-self-score .sl-amount-note").count(),normal?0:1);assert(await page.locator(".sl-self-score").evaluate(el=>{const parent=el.closest(".sl-self").getBoundingClientRect(),r=el.getBoundingClientRect();return r.x>=parent.x&&r.right<=parent.right&&r.y>=parent.y&&r.bottom<=parent.bottom;}));}
    return {headers,scenario,reference,money,normal,known,screenshot:id+".png"};
  });
}
for(const board of ["首充人数","充值贡献","购机贡献"])for(const currency of ["USDT","NEX"]){await mode("baseline");await page.getByRole("tab",{name:board,exact:true}).click();await page.getByRole("combobox",{name:"币种"}).selectOption(currency);await page.getByRole("combobox",{name:"月份"}).selectOption("2026-09");await settle();await check(`historical-common-period-${board}-${currency}`,async()=>{assert.deepEqual(await page.locator('.sl-table th:nth-child(3) small,.sl-table th:nth-child(4) small').allTextContents(),[currency+" · 2026.09","人 · 2026.09"]);assert((await page.locator(".sl-amount").evaluateAll(els=>els.map(el=>el.dataset.period))).every(value=>value==="2026.09"));assert.equal(await page.locator(".sl-amount-note").count(),0);await page.screenshot({path:path.join(output,`historical-${board}-${currency}.png`),fullPage:true});await page.getByRole("tab",{name:"客户规模",exact:true}).click();await settle();assert.deepEqual(await page.locator('.sl-table th:nth-child(3) small,.sl-table th:nth-child(4) small').allTextContents(),[currency+" · 2026.10 · 参考","人 · 2026.10 · 参考"]);assert((await page.locator(".sl-amount").evaluateAll(els=>els.map(el=>el.dataset.period))).every(value=>value==="2026.10"));await page.getByRole("tab",{name:board,exact:true}).click();await settle();assert.equal(await page.getByRole("combobox",{name:"月份"}).inputValue(),"2026-09");assert.deepEqual(await page.locator('.sl-table th:nth-child(3) small,.sl-table th:nth-child(4) small').allTextContents(),[currency+" · 2026.09","人 · 2026.09"]);return "Historical month→current reference→historical restored with aligned headers and raw exact period";});}
await mode("period-header-missing");await check("common-period-missing-header",async()=>{assert.equal(await page.locator(".sl-table th:nth-child(3) small").innerText(),"USDT · 统计期待核实");assert.equal(await page.locator(".sl-rank-sprite").count(),0);await page.getByRole("tab",{name:"客户规模",exact:true}).click();assert.equal(await page.locator(".sl-table th:nth-child(3) small").innerText(),"USDT · 统计期待核实 · 参考");assert.equal(await page.locator('tr[data-rank="1"]').count(),1);return "Missing primary period prevents confirmed period ranks; missing reference month preserves current customer ranks";});


for(const width of [1346,1000])for(const board of ["首充人数","充值贡献","购机贡献","客户规模"])for(const currency of ["USDT","NEX"])for(const scenario of ["currency-query-missing","currency-row-missing","currency-wrong","currency-self-wrong"]){
  const id=`common-units-${width}-${board}-${currency}-${scenario}`;
  await page.setViewportSize({width,height:width===1346?1169:900});
  await page.evaluate(({scenario,currency})=>{window.fixtureTransform=scenario==="currency-query-missing"?rows=>rows.map(row=>({...row,amount:{...row.amount,currency}})):undefined;},{scenario,currency});
  await mode(scenario);await page.getByRole("tab",{name:board,exact:true}).click();if(scenario!=="currency-query-missing")await page.getByRole("combobox",{name:"币种"}).selectOption(currency);await settle();
  await page.screenshot({path:path.join(output,id+".png"),fullPage:true});
  await check(id,async()=>{
    const money=board==="充值贡献"||board==="购机贡献",reference=board==="客户规模",onlySelf=scenario==="currency-self-wrong";
    const unit=scenario==="currency-query-missing"?"币种待核实":currency;
    assert.deepEqual(await page.locator(".sl-table th small").allTextContents(),[unit+" · 2026.10"+(reference?" · 参考":""),"人 · 2026.10"+(reference?" · 参考":""),"人 · 截至现在"]);
    assert.equal(await page.locator(".sl-self h2 small").innerText(),money?unit:"人");
    assert.equal(await page.locator(".sl-amount>span,.sl-count>span,.sl-self-score>span").count(),0);
    assert.equal(await page.locator(".sl-amount .sl-amount-note").count(),onlySelf?1:7);
    assert.equal(await page.locator('tr[data-rank="1"]').count(),money&&!onlySelf?0:1);
    assert.equal(await page.locator(".sl-self-rank").innerText(),money?"待核实":"并列第 3");
    assert.equal(await page.locator("tr[data-self] .sl-amount strong").innerText(),"待核实");
    assert.equal(await page.locator(".sl-amount strong").first().innerText(),onlySelf?"20K":"待核实");
    assert.equal(await page.locator(".sl-self-score strong").innerText(),money?"待核实":reference?"24":"12");
    const trigger=page.locator("tr[data-self] .sl-amount-note summary");await trigger.focus();await trigger.press("Enter");const popup=page.locator(".sl-movement-explanation:popover-open");await popup.waitFor({state:"visible"});const text=await popup.innerText();assert(text.includes("真实统计期：2026.10")&&text.includes("原始业绩额：12000"));assert(text.includes(scenario==="currency-row-missing"?"币种缺失":scenario==="currency-query-missing"?currency:currency==="USDT"?"NEX":"USDT"));assert(await popup.evaluate(el=>{const r=el.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight&&(h===el||el.contains(h));}));await trigger.press("Escape");await popup.waitFor({state:"hidden"});assert(await trigger.evaluate(el=>document.activeElement===el));
    const fonts=await page.locator(".sl-table th small,.sl-self h2 small,.sl-amount-note small").evaluateAll(els=>els.map(el=>({text:el.textContent,size:parseFloat(getComputedStyle(el).fontSize)})));assert(fonts.every(item=>item.size>=13),JSON.stringify(fonts));
    if(money){const self=page.locator(".sl-self-score .sl-amount-note summary");await self.focus();await self.press("Enter");await popup.waitFor({state:"visible"});assert((await popup.innerText()).includes("12000"));await self.press("Escape");await popup.waitFor({state:"hidden"});}
    return {money,reference,onlySelf,headers:unit,currency,scenario,fonts,screenshot:id+".png"};
  });
}
await page.evaluate(()=>window.fixtureTransform=undefined);
for (const width of [1346, 1000]) for (const scenario of ["baseline", "reference-unknown", "period-partial", "counts-partial"]) for (const board of ["首充人数", "充值贡献", "购机贡献", "客户规模"]) for (const currency of ["USDT", "NEX"]) {
  await page.setViewportSize({ width, height: width === 1346 ? 1169 : 900 });
  await mode(scenario);
  await page.getByRole("tab", { name: board, exact: true }).click();
  await page.getByRole("combobox", { name: "币种" }).selectOption(currency);
  await settle();
  await check(`numeric-baseline-${width}-${scenario}-${board}-${currency}`, async () => {
    const rows = await page.locator(".sl-table tbody tr").evaluateAll(rows => rows.map(row => ({
      bottom: row.getBoundingClientRect().bottom,
      metrics: [...row.querySelectorAll("td[data-metric]")].map(td => {
        const value = td.querySelector("strong button") || td.querySelector("strong"), rect = value.getBoundingClientRect(), style = getComputedStyle(value);
        return {
          metric: td.dataset.metric, y: rect.y, bottom: rect.bottom,
          style: [style.fontSize, style.fontWeight, style.lineHeight],
          notes: [...td.querySelectorAll(".sl-amount-note summary,.sl-count>small")].map(note => {
            const text = note.querySelector("small") || note, range = document.createRange(), rect = note.getBoundingClientRect(), style = getComputedStyle(text);
            range.selectNodeContents(text);
            return { y: rect.y, bottom: rect.bottom, textBottom: range.getBoundingClientRect().bottom, style: [style.fontSize, style.lineHeight] };
          })
        };
      })
    })));
    assert.equal(rows.length, 7);
    for (const row of rows) {
      assert.deepEqual(row.metrics.map(metric => metric.metric), ["amount", "firstPayment", "customers"]);
      assert.equal(row.metrics.reduce((sum, metric) => sum + metric.notes.length, 0), scenario === "baseline" ? 0 : scenario === "counts-partial" ? 2 : 1);
      const positions = row.metrics.map(metric => metric.y);
      assert(Math.max(...positions) - Math.min(...positions) <= 0.01, JSON.stringify(row));
      for (const metric of row.metrics) {
        assert.deepEqual(metric.style, ["30px", "600", "40px"]);
        for (const note of metric.notes) {
          assert(note.y >= metric.bottom && note.bottom <= row.bottom + 0.01 && note.textBottom <= row.bottom + 0.01, JSON.stringify({ row, metric, note }));
          assert.deepEqual(note.style, ["13px", "18px"]);
        }
      }
    }
    return rows;
  });
}
await page.setViewportSize({width:1346,height:1169});await mode("baseline");
await check("common-units-normal-labels-and-exact-values",async()=>{assert.equal(await page.locator(".sl-amount>span,.sl-count>span,.sl-self-score>span").count(),0);assert.deepEqual(await page.locator(".sl-table th small").allTextContents(),["USDT · 2026.10","人 · 2026.10","人 · 截至现在"]);assert.equal(await page.locator(".sl-self h2 small").innerText(),"人");for(const selector of [".sl-amount .sl-number-detail summary",'td[data-metric="firstPayment"] summary']){const trigger=page.locator(selector).first();await trigger.focus();await trigger.press("Enter");const popup=page.locator(".sl-movement-explanation:popover-open");await popup.waitFor({state:"visible"});const text=await popup.innerText();assert(text.includes("2026.10"));assert(text.includes(selector.includes("amount")?"20000 USDT":"20 人"));await trigger.press("Escape");await popup.waitFor({state:"hidden"});}return "Normal row/self units absent; header/self labels and keyboard exact units/period retained";});

await check("reduced-motion",async()=>{await page.emulateMedia({reducedMotion:"reduce"});await mode("baseline");assert.equal(await page.locator(".sl-locate").evaluate(el=>getComputedStyle(el).animationName),"none");await page.getByRole("button",{name:"定位我",exact:true}).click();return "Reduced motion and locate callback verified";});
await check("console-errors",()=>{assert.equal(errors.length,0,JSON.stringify(errors));return {unexpected:errors,expectedDeliberateAvatarResourceErrors:avatarErrors};});
const sourceFiles=["app/components/domain-views/m-tabs/support-leaderboard.tsx","app/components/domain-views/m-tabs/support-leaderboard.css","app/components/domain-views/m-tabs/support-leaderboard-assets/approved-row.png","app/components/domain-views/m-tabs/support-leaderboard-assets/manrope-latin.woff2","app/components/domain-views/m-tabs/support-leaderboard-assets/OFL-Manrope.txt","tests/support-leaderboard-runtime.mjs","tests/fixtures/support-leaderboard/fixture.tsx","tests/fixtures/support-leaderboard/loader.cjs"];
const treeMoved = sourceBefore !== repositoryDigest(repo);
record("source-frozen", treeMoved ? "fail" : "pass", "Compare actual repository files, index and HEAD before and after this run");
const failures=results.filter(row=>row.status!=="pass");
record(acceptance,failures.length?"fail":"pass",`Actual screenshot/geometry/paint/data/keyboard evidence at ${output}; independent visual review required; bounds alone do not certify font equality`);
const report={at:new Date().toISOString(),taskId:process.env.WORKFLOW_TASK_ID||"support-analytics-visual-common-units-20261007",stepId:process.env.WORKFLOW_STEP_ID||"manual-short-checklist",checkId:process.env.WORKFLOW_CHECK_ID||"manual",runId,repo:process.env.WORKFLOW_REPO||repo,snapshotHash:process.env.WORKFLOW_SNAPSHOT_HASH||"manual-not-workflow-bound",capability:"runtime",mode:"full",treeMoved,verdict:failures.length?"fail":"pass",browser:`Chromium ${browser.version()}`,viewport:{width:1346,height:1169,dpr:1},output,geometry,deviations,textGlyphs,platformFonts,fontDiagnosticWarnings,zoneMetrics,diagnostics,sourceFileHashes:Object.fromEntries(sourceFiles.map(file=>[file,hash(path.join(repo,file))])),steps:results,knownLimitations:["Fixture-only; API/permissions/financial/RANK/integration not signed","Manual units short checklist is new evidence, not a replacement for frozen r5 workflow PASS; full unmasked differences include approved data and column changes; independent audit required","Actual source font unavailable; Static heading/brand use exact approved artwork; other dynamic font equivalence is not certified","New self strip omits old gap UI according to approved source; big-gap input does not add a hidden display"]};
const reportArg = process.argv.indexOf("--report"); if (reportArg >= 0) { const target = path.resolve(process.argv[reportArg + 1]); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(report, null, 2)); }
fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));fs.mkdirSync(path.join(runRoot,"reports"),{recursive:true});fs.writeFileSync(path.join(runRoot,"reports/visual-row-runtime.json"),JSON.stringify(report,null,2));
const deviationTable=[
"# 批准横向排行榜偏差与边界",
"",
"当前 Chromium 实景与原稿以相同1346×1169 / DPR1比较，完整叠图和差异图未加整块遮罩。",
"",
"| 区域/检查 | 原稿目标 | 实景 | 偏差 |",
"| --- | --- | --- | --- |",
...deviations.map(row=>`| ${row.selector} · ${row.dimension} | ${row.target} | ${row.actual} | ${row.delta}px |`),
"",
"| 同形文字 | 原稿亮字边界 | 实景亮字边界 | 亮字面积差 |",
"| --- | --- | --- | --- |",
...Object.entries(textGlyphs).map(([name,row])=>`| ${name} | ${row.target.bounds.join(",")} | ${row.rendered.bounds.join(",")} | ${row.areaChangePercent.toFixed(2)}% |`),
"",
"人数列随已授权的金额/绑定列宽分配右移44px，单列批准数据区域差异；标题和品牌边界仍以≤1px检查。字形面积记录不等于识别了原稿字体或证明字形完全等价。",
"",
"| 区域 | RGB通道平均绝对差 | 判定范围 |",
"| --- | --- | --- |",
...Object.entries(zoneMetrics).map(([name,row])=>`| ${name} | ${row.meanAbsoluteChannelError.toFixed(3)} | ${row.classification} |`),
"",
"授权改动：姓名下组名、紧跟姓名的升降、独立金额/首充/绑定六列、本期与当前说明、K/M/B/T显示、真实头像替换、实际身份/时间/披露、顶部三筛选与tab让位、金额和首充月份统一表头、正常行不重复日期或单位；单位移表头与本人标签旁；三列及本人数字统一30/600/40。原始精确值保留title和键盘可达说明；排序/并列未从简写重算。",
"",
"材质：原图字节仅作为限定取样sprite，冠/环永久透明内圈；长行源矩形和SVG mask均无重复。冠军清空旧字的区域使用x618..694/y377..520无资料纹理，并羽化；不是原图完整背景。",
"",
"字体：标题与UVEL静态副标限域采用原稿像素并保留真实无障碍文字，可变品牌保留DOM。动态数字已实际加载3012同字节Manrope（资源和许可hash见report），三列及本人30/600/40；中文沿工程fallback，当前Playwright与3012浏览器的中文系统回退可以不同，未宣称Manrope含中文或跨平台字形等价。",
"",
"纯fixture证据，真实API、资金、权限、业务排名及正式产品集成不在本证据签收范围。"
].join("\n");
fs.writeFileSync(path.join(output,"deviations.md"),deviationTable);

await context.close();await browser.close();
console.log(JSON.stringify({verdict:report.verdict,output,failures:failures.map(row=>({id:row.id,evidence:row.evidence}))},null,2));process.exitCode=failures.length?1:0;
