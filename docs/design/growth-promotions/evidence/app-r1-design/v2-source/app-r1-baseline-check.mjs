import assert from 'node:assert/strict';
import { runInteractionChecks } from './evidence/app-r1-design/interaction-checks.mjs';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const root=path.dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(await readFile(path.join(root,'app-r1-baseline.json'),'utf8'));
assert.equal(manifest.fixtures.purchaseItems.reduce((total,item)=>total+item.quantity*item.unitPriceUsdt,0),manifest.fixtures.subtotalUsdt);
assert.equal(manifest.fixtures.subtotalUsdt-manifest.fixtures.discountUsdt,manifest.fixtures.amountUsdt);
const output=path.join(root,'evidence/app-r1-design');
const screenshotDir=path.join(output,'screenshots');
const smoke=process.argv.includes('--smoke');
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
const rgb=hex=>{const h=hex.replace('#','');return `rgb(${[0,2,4].map(n=>parseInt(h.slice(n,n+2),16)).join(', ')})`};
const inputs=['app-r1-baseline.html','app-r1-baseline.json','app-r1-baseline-check.mjs',manifest.runtime,'evidence/app-r1-design/interaction-checks.mjs',manifest.basis.concept,...manifest.assets.localCopies.map(p=>manifest.assets.directory+'/'+p)];
async function inputHashes(){return Object.fromEntries(await Promise.all(inputs.map(async p=>[p,hash(await readFile(path.join(root,p)))])))}
const before=await inputHashes(),startedAt=new Date().toISOString();
await mkdir(screenshotDir,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,locale:'en-US',timezoneId:'Asia/Tokyo',reducedMotion:'reduce'});
const page=await context.newPage();
const errors=[],externalRequests=[],cases=[],screenshots=[],interactions=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await context.route('**/*',async route=>{const url=route.request().url();if(!url.startsWith('file:')&&!url.startsWith('data:')){externalRequests.push(url);await route.abort()}else await route.continue()});
let scopeSerial=0;
const urlFor=(screen,state='normal',locale='zh',theme='dark',width=390,extra={})=>{const url=pathToFileURL(path.join(root,manifest.entry));for(const [k,v] of Object.entries({screen,state,locale,theme,width,scope:'check-'+(++scopeSerial),...extra}))url.searchParams.set(k,String(v));return url.href};
async function open(screen,state='normal',locale='zh',theme='dark',width=390,extra={}){await page.setViewportSize({width,height:844});await page.goto(urlFor(screen,state,locale,theme,width,extra),{waitUntil:'load'});await page.evaluate(async()=>{await Promise.all([400,500,600].map(w=>document.fonts.load(`${w} 14px "General Sans"`)));await document.fonts.ready});await page.locator('#canvas').waitFor()}
try{
 const screens=manifest.query.screen,states=smoke?['normal']:manifest.query.state,locales=smoke?['zh']:manifest.query.locale,themes=smoke?['dark']:manifest.query.theme,widths=smoke?[390]:manifest.query.width;
 const plans=[];
 for(const screen of screens)for(const state of states)for(const locale of locales)for(const theme of themes)for(const width of widths)plans.push({screen,state,locale,theme,width,extra:{}});
 for(const variant of manifest.variantScenarios)for(const locale of locales)for(const theme of themes)for(const width of widths)plans.push({screen:variant.screen,state:'normal',locale,theme,width,extra:variant.params,variant:variant.id});
 for(const variant of manifest.platformComparisons)plans.push({...variant,state:'normal',extra:variant.params,variant:variant.id});
 for(const {screen,state,locale,theme,width,extra,variant} of plans){
  const id=[...(variant?[variant]:[]),screen,state,locale,theme,width].join('-'),startError=errors.length;
  await open(screen,state,locale,theme,width,extra);
  const metrics=await page.evaluate(()=>{
   const canvas=document.querySelector('#canvas'),bounds=canvas.getBoundingClientRect();
   const controls=[...document.querySelectorAll('a[href],button')].filter(el=>!el.closest('[inert]')&&el.getClientRects().length);
   const themeColors={};const probe=document.createElement('span');probe.hidden=true;canvas.append(probe);for(const token of ['bg','surface','surface2','ink','ink2','muted','brand']){probe.style.color=`var(--${token})`;themeColors[token]=getComputedStyle(probe).color}probe.remove();
   const dialog=document.querySelector('.modal');let modalReachable=true;if(dialog){const previous=dialog.scrollTop;dialog.scrollTop=dialog.scrollHeight;const actions=[...dialog.querySelectorAll('.modal-actions button')];const end=actions.at(-1)?.getBoundingClientRect(),db=dialog.getBoundingClientRect();modalReachable=!!end&&end.bottom<=Math.min(innerHeight-16,db.bottom)+1&&end.top>=db.top-1;dialog.scrollTop=previous}
   const main=document.querySelector('main'),header=document.querySelector('.header'),brand=document.querySelector('.brand-image');
   return {identity:window.designBaseline,canvasWidth:bounds.width,canvasHeight:bounds.height,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,images:[...document.images].map(i=>({src:i.getAttribute('src'),ok:i.complete&&i.naturalWidth>0})),font:[400,500,600].every(w=>document.fonts.check(`${w} 14px "General Sans"`)),bodyFont:getComputedStyle(document.documentElement).fontFamily,themeColors,brand:brand?{width:brand.getBoundingClientRect().width,height:brand.getBoundingClientRect().height,src:brand.getAttribute('src')}:null,headerHeight:header.getBoundingClientRect().height,mainInset:parseFloat(getComputedStyle(main).paddingLeft),squareProductImages:[...document.querySelectorAll('.product-photo')].every(el=>Math.abs(el.getBoundingClientRect().width-el.getBoundingClientRect().height)<1),renderInsets:{top:document.querySelector(".safe-top").getBoundingClientRect().height,mainTop:parseFloat(getComputedStyle(main).top),bottom:parseFloat(getComputedStyle(main).bottom),indicator:getComputedStyle(document.querySelector(".home-indicator")).display},hasDialog:!!dialog,modalReachable,modalBackgroundIsolated:!dialog||main.inert&&header.inert,missingNames:controls.filter(el=>!(el.getAttribute('aria-label')||el.textContent).trim()).length,smallTargets:controls.map(el=>({text:(el.getAttribute('aria-label')||el.textContent).trim().slice(0,80),w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height})).filter(r=>r.w<43.5||r.h<43.5),disclosure:!!document.querySelector('[data-fixture-disclosure]'),reduced:!document.querySelector('.reduced .glass')||getComputedStyle(document.querySelector('.reduced .glass')).backdropFilter==='none'};
  });
  const failures=[];
  if(metrics.identity.screen!==screen||metrics.identity.state!==state||metrics.identity.locale!==locale||metrics.identity.theme!==theme)failures.push('query identity');
  if(metrics.identity.platform!==(extra.platform||'native-illustration')||metrics.identity.safeInsets.top!==(extra.platform==='h5'?0:24)||metrics.identity.safeInsets.bottom!==(extra.platform==='h5'?0:26))failures.push('platform inset identity');
  if(metrics.renderInsets.top!==metrics.identity.safeInsets.top||metrics.renderInsets.bottom!==metrics.identity.safeInsets.bottom||metrics.renderInsets.mainTop!==metrics.identity.safeInsets.top+metrics.headerHeight||(extra.platform==='h5'&&metrics.renderInsets.indicator!=='none'))failures.push('rendered platform insets');
  if(metrics.canvasWidth!==width||metrics.scrollWidth>width+1)failures.push('horizontal overflow');
  if(metrics.canvasHeight!==manifest.geometry.primaryViewport.height||metrics.mainInset!==manifest.geometry.pageInlinePadding||metrics.headerHeight!==(screen==='home'||screen==='store'?manifest.geometry.tabHeaderHeight:manifest.geometry.subHeaderHeight))failures.push('chassis geometry');
  if(Object.entries(metrics.themeColors).some(([token,value])=>value!==rgb(manifest.colors[theme][token])))failures.push('theme token mismatch');
  if(!metrics.squareProductImages)failures.push('square product artwork');
  if(['home','store'].includes(screen)&&(!metrics.brand||metrics.brand.width!==manifest.geometry.brandLockup.width||metrics.brand.height!==manifest.geometry.brandLockup.height||!metrics.brand.src.endsWith('header-logo-'+theme+'.png')))failures.push('approved brand lockup');
  if(!metrics.modalReachable||!metrics.modalBackgroundIsolated)failures.push('modal action reachability/background isolation');
  if(['leave','leave-reserved'].includes(screen)&&['empty','loading','error','disabled'].includes(state)&&metrics.hasDialog)failures.push('marketing prompt without verified facts');
  if(metrics.images.some(i=>!i.ok))failures.push('image load');
  if(!metrics.font||!metrics.bodyFont.includes('General Sans'))failures.push('font load');
  if(metrics.missingNames)failures.push('accessible names');
  if(metrics.smallTargets.length)failures.push('touch targets');
  if(!metrics.disclosure)failures.push('fixture disclosure');
  if(!metrics.reduced)failures.push('reduced transparency');
  if(errors.length>startError)failures.push('runtime errors');
  cases.push({id,pass:!failures.length,failures,...(failures.length?{metrics}:{canvasWidth:metrics.canvasWidth})});
  if(state==='normal'||(locale==='zh'&&theme==='dark'&&width===390)){
   const capture=async(suffix='',scrollTop=0)=>{const file=id+suffix+'.png',target=path.join(screenshotDir,file);await page.screenshot({path:target,fullPage:false,animations:'disabled'});screenshots.push({id:id+suffix,path:'screenshots/'+file,sha256:hash(await readFile(target)),viewport:{width,height:844},platform:metrics.identity.platform,safeInsets:metrics.identity.safeInsets,scrollTop,fullPage:false})};
   await capture();
   if(locale==='zh'&&theme==='dark'&&width===390&&!['leave','leave-reserved','cancel'].includes(screen)){
    const scroll=await page.locator('main').evaluate(el=>({max:el.scrollHeight-el.clientHeight,step:Math.floor(el.clientHeight*.8)}));
    const positions=[];for(let n=scroll.step;n<scroll.max;n+=scroll.step)positions.push(n);if(scroll.max>1)positions.push(scroll.max);
    for(let i=0;i<positions.length;i++){await page.locator('main').evaluate((el,n)=>{el.scrollTop=n},positions[i]);await capture('-scroll-'+(i+1),positions[i])}
   }
  }
  if(cases.length%90===0)console.log(JSON.stringify({checked:cases.length,failed:cases.filter(c=>!c.pass).length,screenshots:screenshots.length}));
 }
 await runInteractionChecks({page,open,assert,interactions,manifest});
}catch(error){errors.push(error.stack||String(error));}
const after=await inputHashes(),treeMoved=JSON.stringify(before)!==JSON.stringify(after);
const variantMultiplier=smoke?1:manifest.query.locale.length*manifest.query.theme.length*manifest.query.width.length;const expectedCases=(smoke?manifest.query.screen.length:Object.values(manifest.query).reduce((n,values)=>n*values.length,1))+manifest.variantScenarios.length*variantMultiplier+manifest.platformComparisons.length;
const report={baselineId:manifest.baselineId,artifactKind:'independent-design-artboard',startedAt,finishedAt:new Date().toISOString(),mode:smoke?'smoke':'full',verdict:cases.length===expectedCases&&cases.every(c=>c.pass)&&interactions.length===10&&interactions.every(item=>item.pass===true)&&!errors.length&&!externalRequests.length&&!treeMoved?'pass':'fail',treeMoved,productRuntimeVerified:false,independentPixelReviewPassed:false,environment:{os:os.platform(),release:os.release(),arch:os.arch(),node:process.version,playwright:(await import('playwright/package.json',{with:{type:'json'}})).default.version,chromium:browser.version(),userAgent:await page.evaluate(()=>navigator.userAgent),deviceScaleFactor:1,timezone:'Asia/Tokyo',reducedMotion:'reduce',entryProtocol:'file:'},inputHashes:before,counts:{cases:cases.length,failures:cases.filter(c=>!c.pass).length,screenshots:screenshots.length,interactions:interactions.length},errors,externalRequests,interactions,cases,screenshots};
await writeFile(path.join(output,smoke?'smoke-report.json':'report.json'),JSON.stringify(report,null,2)+'\n');await browser.close();
console.log(JSON.stringify({verdict:report.verdict,...report.counts,errors:errors.slice(0,3),report:path.join(output,smoke?'smoke-report.json':'report.json')}));
if(report.verdict!=='pass')process.exitCode=1;
