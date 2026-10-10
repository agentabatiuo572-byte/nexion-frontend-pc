// R109: isolated production React L2 fixture. No server, credentials, business API, or existing browser.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const pc = path.resolve(__dirname,'..');
const runtimeRoot = process.env.NEXION_PC_RUNTIME_ROOT || pc;
const out = process.env.NEXION_L2_FIXTURE_OUTPUT;
const req = createRequire(runtimeRoot + '/package.json');
const ts = req('typescript');
const {chromium} = req('playwright');
// Node-side networking is never used by this fixture. Abort if introduced accidentally.
global.fetch = () => { throw new Error('R109_NETWORK_ABORT'); };
for (const moduleName of ['node:http','node:https','node:net','node:tls']) {
  const module = require(moduleName);
  for (const method of ['request','get','connect','createConnection']) {
    if (typeof module[method] === 'function') module[method] = () => { throw new Error('R109_NETWORK_ABORT'); };
  }
}
const modules = {};
const transpile = (rel) => ts.transpileModule(fs.readFileSync(rel==='app/components/domain-views/l-tabs/l2-funnel.tsx' && process.env.NEXION_L2_FIXTURE_SOURCE ? process.env.NEXION_L2_FIXTURE_SOURCE : pc+'/'+rel,'utf8'), {
  fileName: rel, compilerOptions: {module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.ReactJSX}
}).outputText;
const actual = {
  L2:'app/components/domain-views/l-tabs/l2-funnel.tsx',
  '@kit/tab-group':'app/components/kit/tab-group.tsx',
  './tab-group-keyboard':'app/components/kit/tab-group-keyboard.ts',
  './live-data':'app/components/domain-views/l-tabs/live-data.tsx',
  './l1-l2-live-data':'app/components/domain-views/l-tabs/l1-l2-live-data.ts',
  './l1-l2-live-data.ts':'app/components/domain-views/l-tabs/l1-l2-live-data.ts',
  './l2-stage-events-contract':'app/components/domain-views/l-tabs/l2-stage-events-contract.ts',
  './l-attribution-routes':'app/components/domain-views/l-tabs/l-attribution-routes.ts',
  '@admin/b3-ref-display':'lib/admin/b3-ref-display.ts',
};
for (const [id, rel] of Object.entries(actual)) modules[id] = transpile(rel);
for (const [id, rel] of Object.entries({
  react:'react/cjs/react.production.js',
  'react/jsx-runtime':'react/cjs/react-jsx-runtime.production.js',
  'react-dom':'react-dom/cjs/react-dom.production.js',
  'react-dom/client':'react-dom/cjs/react-dom-client.production.js',
  scheduler:'scheduler/cjs/scheduler.production.js',
})) modules[id] = fs.readFileSync(runtimeRoot+'/node_modules/'+rel,'utf8');
modules['next/link'] = `const React=require('react'); exports.default=({children,href,...rest})=>React.createElement('a',{...rest,href,onClick:e=>e.preventDefault()},children);`;
modules['@/app/components/kit/gloss'] = `exports.AutoGloss=({children})=>children;`;
modules['@/app/components/kit/tab-group'] = `module.exports=require('@kit/tab-group');`;
modules['@/lib/admin/error-messages'] = `exports.displayAdminError=e=>e instanceof Error?e.message:String(e);`;
modules['@/lib/admin/l-client'] = `for(const [name,kind] of Object.entries({fetchL2FunnelDrilldown:'drill',fetchL2RetentionMatrix:'matrix',fetchL2RetentionCurve:'curve',fetchL2Cross:'cross'})) exports[name]=(...args)=>window.__request(kind,args);`;
modules['@/lib/store/ui'] = `exports.confirm=()=>{throw Error('WRITE_ACTION_EXCLUDED')};`;
modules['../design-kit'] = `exports.PaginationExemptionList=()=>null;`;
modules['./l1-l2-live-fallback'] = `exports.L2LiveStages=()=>null;`;
modules['@/lib/admin/b3-ref-display'] = `module.exports=require('@admin/b3-ref-display');`;
const bundle = `(function(){
const source=${JSON.stringify(modules)},cache={};
function require(id){if(cache[id])return cache[id].exports;if(!source[id])throw Error('UNRESOLVED:'+id);const module=cache[id]={exports:{}};new Function('require','module','exports','process',source[id])(require,module,module.exports,{env:{NODE_ENV:'production'}});return module.exports;}
window.__networkAttempts=[];
window.fetch=(...args)=>{window.__networkAttempts.push('fetch');return Promise.reject(Error('R109_NETWORK_ABORT'));};
window.XMLHttpRequest=class{constructor(){window.__networkAttempts.push('xhr');throw Error('R109_NETWORK_ABORT')}};
window.WebSocket=class{constructor(){window.__networkAttempts.push('ws');throw Error('R109_NETWORK_ABORT')}};
window.EventSource=class{constructor(){window.__networkAttempts.push('eventsource');throw Error('R109_NETWORK_ABORT')}};
navigator.sendBeacon=()=>{window.__networkAttempts.push('beacon');return false;};
const React=require('react'),client=require('react-dom/client'),l2=require('L2');
window.__strict=l2.isStrictL2Dashboard;
window.__calls=[];window.__pending={};window.__next=0;window.__toasts=[];
window.__request=(kind,args)=>{const id=++window.__next;window.__calls.push({id,kind,args});return new Promise((resolve,reject)=>window.__pending[id]={resolve,reject});};
window.__resolve=(id,value)=>window.__pending[id].resolve(value);
window.__reject=(id)=>window.__pending[id].reject(Error('SYNTHETIC_READ_FAILURE'));
window.__root=client.createRoot(document.getElementById('root'));
function Fixture({data}){const [query,setQuery]=React.useState(data.filters || {}),[exportable,setExportable]=React.useState(true),[parent,setParent]=React.useState(data);
window.__swapParent=setParent;window.__ctx={query,exportable};
const ctx={biData:parent?{l2:parent}:null,biLoading:!parent,canExport:false,l2Query:query,setL2Query:setQuery,l2SliceExportable:exportable,setL2SliceExportable:setExportable,toast:t=>window.__toasts.push(t)};
return React.createElement(React.Fragment,null,React.createElement(l2.L2HeaderActions,{ctx}),React.createElement(l2.L2Funnel,{ctx}));}
window.__mount=(data,key)=>window.__root.render(React.createElement(Fixture,{data,key}));
})();`;

const assert=require('node:assert/strict');
const {before,after,test}=require('node:test');
const calculator=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/l2-backend-calculator-r109.json'),'utf8'));
if(out)fs.writeFileSync(path.join(out,'fixture-bundle.js'),bundle,{flag:'wx'});
let browser,context,page;const errors=[],routed=[],snapshots=[];
before(async()=>{browser=await chromium.launch({headless:true});context=await browser.newContext();await context.route('**/*',r=>{routed.push(r.request().resourceType());return r.abort();});page=await context.newPage();page.setDefaultTimeout(3000);page.on('pageerror',e=>errors.push(e.message));await page.setContent('<!doctype html><meta charset="utf-8"><div id="root"></div>');await page.addScriptTag({content:bundle});});
after(async()=>{const attempts=await page?.evaluate(()=>window.__networkAttempts);await browser?.close();if(out)fs.writeFileSync(path.join(out,'observations.json'),JSON.stringify({errors,routed,attempts,snapshots,closed:true},null,2)+'\n',{flag:'wx'});assert.deepEqual(errors,[]);assert.deepEqual(routed,[]);assert.deepEqual(attempts,[]);});
async function settle(){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function mount(key,data=calculator.baseline){await page.evaluate(({key,data})=>window.__mount(data,key),{key,data});await settle();}
async function last(){return page.evaluate(()=>window.__calls.at(-1));}
async function resolve(call,response){await page.evaluate(({id,response})=>window.__resolve(id,response),{id:call.id,response});await settle();}
async function reject(call){await page.evaluate(id=>window.__reject(id),call.id);await settle();}
function scope(call){const query=call.args.find(x=>x&&typeof x==='object'&&!Array.isArray(x));return query?.phase==='P2'?calculator.P2:calculator.baseline;}
async function snap(name){const x=await page.evaluate(()=>({text:document.getElementById('root').innerText,ctx:window.__ctx,phase:document.querySelector('select[aria-label="Phase 条件"]')?.value,svg:document.querySelector('svg')?.outerHTML}));snapshots.push({name,...x});return x;}
async function cell(week){await page.locator(`td[title="${week} · Day1"]`).click();return last();}
function curveResponse(call){return {curve:scope(call).curves[call.args[0]]};}
test('matrix stays in applied P1 while draft P2 remains unapplied',async()=>{await mount('matrix');await page.getByLabel('Phase 条件',{exact:true}).selectOption('P2');await page.getByRole('button',{name:'Day14',exact:true}).click();const call=await last();await resolve(call,{cohorts:scope(call).cohorts});const end=await snap('matrix');assert.equal(call.args[0].phase,'P1');assert.equal(end.ctx.query.phase,'P1');assert.equal(end.phase,'P2');assert(end.text.includes('100\n漏斗顶'));assert(end.text.includes('50 新注册'));assert.equal(end.ctx.exportable,true);});
test('cross stays in applied P1 while draft P2 remains unapplied',async()=>{await mount('cross');await page.getByLabel('Phase 条件',{exact:true}).selectOption('P2');await page.getByRole('tab',{name:'Day7 留存',exact:true}).click();const call=await last();await resolve(call,{crossAnalysis:scope(call).crossAnalysis});const end=await snap('cross');assert.equal(call.args[1].phase,'P1');assert.equal(end.ctx.query.phase,'P1');assert(end.text.includes('自然渠道（无推荐码） · P1'));assert(!end.text.includes('自然渠道（无推荐码） · P2'));});
test('curve reads use applied filters rather than unapplied draft',async()=>{await mount('curve-scope');await page.getByLabel('Phase 条件',{exact:true}).selectOption('P2');const call=await cell('2026-W01');await resolve(call,curveResponse(call));const end=await snap('curve-scope');assert.equal(call.args[1].phase,'P1');assert.equal(end.ctx.query.phase,'P1');assert(end.text.includes('留存衰减曲线 · 2026-W01'));});
test('later curve intent survives late earlier successful response',async()=>{await mount('late-resolve');const first=await cell('2026-W01'),second=await cell('2026-W02');await resolve(second,curveResponse(second));await resolve(first,curveResponse(first));const end=await snap('late-resolve');assert(end.text.includes('留存衰减曲线 · 2026-W02'));assert(!end.text.includes('留存衰减曲线 · 2026-W01'));});
test('late earlier rejection cannot replace newer curve success',async()=>{await mount('late-reject');const first=await cell('2026-W01'),second=await cell('2026-W02');await resolve(second,curveResponse(second));await reject(first);const end=await snap('late-reject');assert(end.text.includes('留存衰减曲线 · 2026-W02'));assert(!end.text.includes('L2 查询未采用'));});
test('granularity switch invalidates an older pending curve intent',async()=>{await mount('gran');const old=await cell('2026-W01');await page.getByRole('tab',{name:'注册月',exact:true}).click();await reject(old);const end=await snap('gran');assert(end.text.includes('留存衰减曲线 · 2026-01'));assert(!end.text.includes('L2 查询未采用'));assert.equal(await page.getByRole('button',{name:'应用切片',exact:true}).isEnabled(),true);});
test('legal mature zero retention coordinates and labels remain inside plot',async()=>{await mount('zero');const points=await page.locator('svg').evaluate(s=>({points:[...s.querySelectorAll('circle')].map(x=>Number(x.getAttribute('cy'))),labels:[...s.querySelectorAll('text')].filter(x=>x.textContent==='0%').map(x=>Number(x.getAttribute('y')))}));await snap('zero');assert(points.points.length>0&&points.labels.length>0);assert(points.points.every(y=>y>=0&&y<=200));assert(points.labels.every(y=>y>=0&&y<=200));});
test('monthly curve validation rejects malformed protocol before rendering',async()=>{for(const curve of [undefined,[[0,100],null],[[0,100],[7,101]],[[0,100],[0,10]],[[0,100],[7,'0']],[]]){const data=structuredClone(calculator.baseline);data.monthlyCurves={'2026-01':curve};assert.equal(await page.evaluate(d=>window.__strict(d),data),false);}const bad=structuredClone(calculator.baseline);bad.monthlyCurves={'2026-01':[[0,100],null]};await mount('monthly-bad',bad);const end=await snap('monthly-bad');assert(end.text.includes('L2 响应协议错误'));assert.equal(await page.getByRole('button',{name:/^导出/}).isEnabled(),false);assert.equal(await page.evaluate(d=>window.__strict(d),calculator.baseline),true);});
test('Apply P2 adopts complete snapshot and clears old partial cross override',async()=>{await mount('apply');await page.getByRole('tab',{name:'Day7 留存',exact:true}).click();let call=await last();await resolve(call,{crossAnalysis:scope(call).crossAnalysis});await page.getByLabel('Phase 条件',{exact:true}).selectOption('P2');await page.getByRole('button',{name:'应用切片',exact:true}).click();call=await last();await resolve(call,scope(call));const end=await snap('apply');assert.equal(end.ctx.query.phase,'P2');assert(end.text.includes('10\n漏斗顶'));assert(end.text.includes('自然渠道（无推荐码） · P2'));assert(!end.text.includes('自然渠道（无推荐码） · P1'));assert.equal(end.ctx.exportable,true);});
test('invalid filters remain no-request fail-closed and readonly export stays disabled',async()=>{await mount('invalid');const n=await page.evaluate(()=>window.__calls.length);await page.getByLabel('cohort 条件',{exact:true}).fill('2026-W00');await page.getByRole('button',{name:'应用切片',exact:true}).click();let end=await snap('invalid');assert(end.text.includes('cohort 格式无效'));assert.equal(await page.evaluate(()=>window.__calls.length),n);assert.equal(end.ctx.exportable,false);await page.getByRole('button',{name:'返回全部数据',exact:true}).click();await page.getByRole('button',{name:'清空',exact:true}).click();await settle();end=await snap('restored');assert.deepEqual(end.ctx.query,{});assert.equal(end.phase,'');assert.equal(await page.getByRole('button',{name:'导出 cohort / 漏斗序列',exact:true}).isEnabled(),false);});
test('cohort labels follow effective displayed month rows, not unapplied cohort draft',async()=>{await mount('labels');await page.getByLabel('cohort 条件',{exact:true}).fill('2026-01');let end=await snap('labels-draft');assert(end.text.includes('本周注册 cohort'));await page.getByRole('tab',{name:'注册月',exact:true}).click();end=await snap('labels-month');assert(end.text.includes('本月注册 cohort'));assert(end.text.includes('按注册月分组'));assert(end.text.includes('注册月分组 × 留存窗'));assert(!end.text.includes('本周注册 cohort'));await page.getByRole('tab',{name:'注册周 YYYY-Www',exact:true}).click();end=await snap('labels-week-restored');assert(end.text.includes('本周注册 cohort'));assert(end.text.includes('按注册周分组'));const weekly=structuredClone(calculator.baseline);delete weekly.monthlyCohorts;delete weekly.monthlyCurves;await mount('labels-week-fallback',weekly);await page.getByRole('tab',{name:'注册月',exact:true}).click();end=await snap('labels-week-fallback');assert(end.text.includes('本周注册 cohort'));assert(!end.text.includes('本月注册 cohort'));});
