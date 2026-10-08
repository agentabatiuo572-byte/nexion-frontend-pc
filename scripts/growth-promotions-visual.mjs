import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import {capturePromotionPage,readBackendSource} from './growth-promotions-capture.mjs';

const external=process.env.PROMOTION_EVIDENCE_DIR||'C:/Users/jason/.codex/workflow-runs/growth-promotions-20261007';
const base='http://127.0.0.1:3039';
const sessions=JSON.parse(fs.readFileSync(path.join(external,'sessions-owned-v2.private.json')));
const activities=JSON.parse(fs.readFileSync(path.join(external,'pc-runtime-activities.json')));
const manifest=JSON.parse(fs.readFileSync('docs/design/growth-promotions/admin-r1-baseline.json'));
const runId=randomUUID(),dir=path.join(external,'pc-visual-evidence',runId);fs.mkdirSync(dir,{recursive:true});
const hash=x=>createHash('sha256').update(x).digest('hex');
const files=['scripts/growth-promotions-capture.mjs','scripts/growth-promotions-visual.mjs','app/api/admin/growth/[...path]/route.ts','app/components/domain-views/design-kit.tsx','app/components/domain-views/h-view.tsx',...fs.readdirSync('app/components/domain-views/h-tabs').filter(n=>/^h4-promotion/.test(n)).map(n=>'app/components/domain-views/h-tabs/'+n),...fs.readdirSync('lib/admin').filter(n=>/^promotion-/.test(n)).map(n=>'lib/admin/'+n)];
const hashes=()=>Object.fromEntries(files.sort().map(f=>[f,hash(fs.readFileSync(f))]));
const sourceFiles=hashes(),sourceHash=hash(JSON.stringify(sourceFiles));
const proof={status:'running',kind:'actual-product-render-candidate',independentPixelAcceptance:false,startedAt:new Date().toISOString(),source:{repo:process.cwd(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirtySourceHash:sourceHash,files:sourceFiles,designVersion:manifest.designVersion,designHash:manifest.designHash,...readBackendSource(external)},boards:[],pageErrors:[],limitations:['Candidate screenshots require two independent non-implementer reviews.','Normal/empty/long/disabled use real authenticated API facts. Error/loading deliberately inject transport failure/delay without fabricated business responses.','The isolated roles expose only H4; shell menu density differs from the multi-module design fixture.','Long copy is created only as an isolated unpublished draft.']};
const browser=await chromium.launch({headless:true});
let current;
async function context(role,theme,viewport){const ctx=await browser.newContext({viewport,deviceScaleFactor:1,locale:'zh-CN',timezoneId:'Asia/Tokyo',reducedMotion:'reduce'});await ctx.addCookies([{name:'nexion_admin_token',value:sessions.admins[role].accessToken,url:base,httpOnly:true,sameSite:'Lax'}]);await ctx.addInitScript(theme=>localStorage.setItem('nexion-admin-theme-v1',JSON.stringify({state:{mode:theme},version:1})),theme);return ctx;}
async function api(ctx,url,method='GET',data){const r=await ctx.request.fetch(base+'/api/admin/growth'+url,{method,headers:method==='GET'?{}:{'Idempotency-Key':'pc-visual-'+randomUUID()},data});const b=await r.json();assert.equal(r.status(),200,`${url}: ${b.message}`);assert.equal(b.code,0);return b.data;}
try{
  const setup=await context('growth_author','dark',manifest.renderer.viewports[0]);
  const detail=await api(setup,`/promotions/${activities.activityId}`);
  const empty=await api(setup,'/promotions','POST',{reason:'PC 空草稿画板：隔离环境真实持久化，仅用于实景验收。',draft:{category:'PROMOTION',template:'SKU_GIFT'}});
  const long=await api(setup,'/promotions','POST',{reason:'PC 长文案画板：隔离环境未发布活动，仅用于实景验收。',draft:{...detail.current.draft,name:'隔离验收长活动名称 · '.repeat(10),title:{zh:'本地实景长标题 '.repeat(18),en:'Isolated long title '.repeat(10),vi:'Tiêu đề kiểm thử '.repeat(10)},terms:{zh:'本活动仅限隔离验收，权益以真实批准引用为准，不代表线上承诺。'.repeat(30),en:'Isolated acceptance only; approved policy references remain authoritative. '.repeat(20),vi:'Chỉ kiểm thử độc lập; quyền lợi theo chính sách đã duyệt. '.repeat(20)}}});
  proof.fixtures={normal:activities.activityId,empty:empty.resource.id,long:long.resource.id,rewards:activities.sourceActivityId};await setup.close();
  const statesArg=process.argv.indexOf('--states'),states=statesArg>=0?process.argv[statesArg+1].split(','):manifest.coverage.states;
  for(const viewport of manifest.renderer.viewports)for(const theme of manifest.coverage.themes)for(const state of states){
    const ctx=await context(state==='disabled'?'growth_reader':'growth_author',theme,viewport);
    for(const screen of manifest.coverage.screens){
      current=await ctx.newPage();current.setDefaultTimeout(12000);current.on('pageerror',e=>proof.pageErrors.push({screen,state,message:e.message}));
      const clicks=[],network=[],delays=[];current.on('response',r=>{if(new URL(r.url()).pathname.startsWith('/api/admin/growth/promotion'))network.push({path:new URL(r.url()).pathname,method:r.request().method(),status:r.status()});});
      if(['loading','error'].includes(state))await current.route('**/api/admin/growth/promotion**',async route=>{if(route.request().method()!=='GET')return route.continue();if(state==='error')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:503,message:'PROMOTION_SOURCE_UNAVAILABLE',data:null})});await new Promise(resolve=>delays.push(resolve));await route.abort().catch(()=>{});});
      const n=Number(screen.slice(-2)),route=n===1?'list':n<=5?'edit':n===6?'review':n===7?'detail':n===8?'rewards':'metrics';
      const id=state==='empty'?empty.resource.id:state==='long'?long.resource.id:n===8?activities.sourceActivityId:activities.activityId;
      const url=`${base}/growth/events?promotion=${route}&activity=${id}${n>=2&&n<=5?`&step=${n-2}`:''}`;
      await current.goto(url);await expect(current.locator('.prm')).toBeVisible();
      if(state==='loading')await expect(current.locator('.loading-label').first()).toBeVisible();
      else {await current.waitForLoadState('networkidle');if(state==='error')await expect(current.getByText('读取未完成',{exact:true}).first()).toBeVisible();
        else{
          if(n===1){const q=state==='empty'?'PC-NO-MATCH-'+runId:state==='long'?'隔离验收长活动名称':'PCGP-';await current.getByLabel('名称 / 活动编号',{exact:true}).fill(q);const queryResponse=current.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname.startsWith('/api/admin/growth/promotions'));await current.getByRole('button',{name:'查询',exact:true}).click();await (await queryResponse).finished();await expect(current.getByRole('button',{name:'查询',exact:true})).toBeEnabled();await expect(current.locator('.prm .loading-label')).toHaveCount(0);await current.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));clicks.push({fill:'名称 / 活动编号',value:q},{click:'查询'});}
          if(n===9){await current.getByLabel('开始时间',{exact:true}).fill(new Date(Date.now()-86400000).toISOString().slice(0,16));await current.getByLabel('结束时间',{exact:true}).fill(new Date(Date.now()+86400000).toISOString().slice(0,16));const queryResponse=current.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname.startsWith('/api/admin/growth/promotions'));await current.getByRole('button',{name:'查询',exact:true}).click();await (await queryResponse).finished();await expect(current.getByRole('button',{name:'查询',exact:true})).toBeEnabled();await expect(current.locator('.prm .loading-label')).toHaveCount(0);await current.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));clicks.push({fill:'统计时窗',source:'当前时间前后各一天'},{click:'查询'});}
        }
      }
      await current.evaluate(()=>document.fonts.ready);await current.evaluate(()=>scrollTo(0,0));
      const filename=`${screen}-${state}-${theme}-${viewport.width}.png`,file=path.join(dir,filename);const segments=await capturePromotionPage(current,file);
      const geometry=await current.evaluate(()=>{const box=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};return{viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,bodyFont:getComputedStyle(document.body).fontFamily,heading:box('.prm h1'),content:box('.prm'),cards:[...document.querySelectorAll('.prm .card')].map(e=>({height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width})),theme:document.documentElement.dataset.theme};});
      proof.boards.push({screen,state,theme,viewport,dpr:1,file,segments,sha256:hash(fs.readFileSync(file)),url,clicks,network,geometry,faultInjection:['loading','error'].includes(state)?state:null,mask:[]});
      for(const release of delays)release();await current.close();current=null;
    }
    await ctx.close();console.log(JSON.stringify({captured:proof.boards.length,theme,state,width:viewport.width}));
  }
  assert.equal(readBackendSource(external).serviceSourceHash,proof.source.serviceSourceHash,'Backend runtime changed while capturing');assert.deepEqual(proof.pageErrors,[]);assert.equal(hash(JSON.stringify(hashes())),sourceHash,'Product files changed while capturing');proof.status='captured-awaiting-independent-review';
}catch(e){proof.status='failed';proof.failure=String(e.stack||e);if(current)await current.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{proof.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(external,'pc-visual-candidate.json'),JSON.stringify(proof,null,2));fs.writeFileSync(path.join(dir,'index.html'),`<!doctype html><meta charset="utf-8"><title>PC candidate</title><h1>实际产品候选，待独立审查</h1><p>${proof.source.dirtySourceHash}</p>`+proof.boards.flatMap(b=>b.segments.map((s,i)=>`<a style="display:block" href="${path.basename(s.file)}">${b.screen} ${b.state} ${b.theme} ${b.viewport.width} · MAIN ${i}</a>`)).join(''));await browser.close();console.log(JSON.stringify({status:proof.status,boards:proof.boards.length,dir,failure:proof.failure?.split('\n').slice(0,2)}));}
