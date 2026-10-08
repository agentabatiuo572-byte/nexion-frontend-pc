import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import {capturePromotionPage,readBackendSource} from './growth-promotions-capture.mjs';
import {promotionVisualCases,promotionVisualSources,validatePromotionVisualBoards} from './growth-promotions-workflow-runtime.mjs';

const external=process.env.PROMOTION_EVIDENCE_DIR||'D:/CodexData/test-environments/workflow-runs/growth-promotions-20261007';
const base='http://127.0.0.1:3039';
const sessions=JSON.parse(fs.readFileSync(process.env.PROMOTION_VISUAL_SESSION_FILE||path.join(external,'sessions-owned-v2.private.json')));
const activities=JSON.parse(fs.readFileSync(path.join(external,'pc-runtime-activities.json')));
const manifest=JSON.parse(fs.readFileSync('docs/design/growth-promotions/admin-r1-baseline.json'));
const runId=randomUUID(),dir=path.join(external,'pc-visual-evidence',runId);fs.mkdirSync(dir,{recursive:true});
const argument=name=>{const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:undefined;};
const report=path.resolve(argument('--report')||path.join(dir,'candidate.json'));
assert(!fs.existsSync(report),'Capture reports are immutable; select a fresh --report path');
const hash=x=>createHash('sha256').update(x).digest('hex');
const baselineRaw=fs.readFileSync('docs/design/growth-promotions/evidence/admin-r1-design/v4-purchase-interval/export-report.json'),baseline=JSON.parse(baselineRaw),requiredCases=promotionVisualCases(manifest,baseline);
const files=promotionVisualSources();
const hashes=()=>Object.fromEntries(files.sort().map(f=>[f,hash(fs.readFileSync(f))]));
const sourceFiles=hashes(),sourceHash=hash(JSON.stringify(sourceFiles));
const specialPath=argument('--special-fixtures'),baseOnly=process.argv.includes('--base-only');
assert(baseOnly||specialPath,'Full capture requires --special-fixtures with current, explicitly labelled UI response fixtures');
const special=specialPath?JSON.parse(fs.readFileSync(specialPath)):null;
const proof={status:'running',kind:'actual-product-render-candidate',independentPixelAcceptance:false,startedAt:new Date().toISOString(),source:{repo:process.cwd(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirtySourceHash:sourceHash,files:sourceFiles,designVersion:manifest.designVersion,designHash:manifest.designHash,...readBackendSource(external)},boards:[],pageErrors:[],limitations:['Candidate screenshots require two independent non-implementer reviews.','Normal/empty/long/disabled use real authenticated API facts. Error/loading deliberately inject transport failure/delay without fabricated business responses.','The isolated roles expose only H4; shell menu density differs from the multi-module design fixture.','Long copy is created only as an isolated unpublished draft.']};
proof.source.baselineManifestHash=hash(baselineRaw);
proof.requiredCases=requiredCases;
if(special){
  assert.equal(special.kind,'explicit-ui-response-fixtures');assert.equal(special.designHash,manifest.designHash);assert.equal(special.sourceHash,sourceHash);assert.equal(special.serviceSourceHash,proof.source.serviceSourceHash);
  assert(special.actualDtoInputs?.length,'Special fixtures must preserve their current actual DTO inputs');
  for(const input of special.actualDtoInputs)assert.equal(hash(fs.readFileSync(input.path)),input.sha256,'Changed actual DTO input');
  proof.specialFixture={path:path.resolve(specialPath),sha256:hash(fs.readFileSync(specialPath)),kind:special.kind,actualDtoInputs:special.actualDtoInputs};
}
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
      else {await current.waitForLoadState('networkidle');if(state==='error')await expect(current.getByRole('heading',{name:'读取失败，内容已保留',exact:true})).toBeVisible();
        else{
          if(n===1){const q=state==='empty'?'PC-NO-MATCH-'+runId:state==='long'?'隔离验收长活动名称':'PCGP-';await current.getByLabel('名称 / 活动编号',{exact:true}).fill(q);const queryResponse=current.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname.startsWith('/api/admin/growth/promotions'));await current.getByRole('button',{name:'查询',exact:true}).click();await (await queryResponse).finished();await expect(current.getByRole('button',{name:'查询',exact:true})).toBeEnabled();await expect(current.locator('.prm .loading-label')).toHaveCount(0);await current.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));clicks.push({fill:'名称 / 活动编号',value:q},{click:'查询'});}
          if(n===9){await current.getByLabel('开始时间',{exact:true}).fill(new Date(Date.now()-86400000).toISOString().slice(0,16));await current.getByLabel('结束时间',{exact:true}).fill(new Date(Date.now()+86400000).toISOString().slice(0,16));const queryResponse=current.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname.startsWith('/api/admin/growth/promotions'));await current.getByRole('button',{name:'查询',exact:true}).click();await (await queryResponse).finished();await expect(current.getByRole('button',{name:'查询',exact:true})).toBeEnabled();await expect(current.locator('.prm .loading-label')).toHaveCount(0);await current.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));clicks.push({fill:'统计时窗',source:'当前时间前后各一天'},{click:'查询'});}
        }
      }
      await current.evaluate(()=>document.fonts.ready);await current.evaluate(()=>scrollTo(0,0));
      const filename=`${screen}-${state}-${theme}-${viewport.width}.png`,file=path.join(dir,filename);const segments=await capturePromotionPage(current,file);
      const geometry=await current.evaluate(()=>{const box=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};return{viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,bodyFont:getComputedStyle(document.body).fontFamily,heading:box('.prm h1'),content:box('.prm'),cards:[...document.querySelectorAll('.prm .card')].map(e=>({height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width})),theme:document.documentElement.dataset.theme};});
      proof.boards.push({caseId:`${screen}-${state}-${theme}-${viewport.width}`,screen,state,theme,viewport,dpr:1,file,segments,sha256:hash(fs.readFileSync(file)),url,clicks,network,geometry,faultInjection:['loading','error'].includes(state)?state:null,mask:[]});
      for(const release of delays)release();await current.close();current=null;
    }
    await ctx.close();console.log(JSON.stringify({captured:proof.boards.length,theme,state,width:viewport.width}));
  }
  if(!baseOnly)for(const caseId of requiredCases.filter(id=>!/^ADM\d{2}-(normal|empty|loading|error|disabled|long)-/.test(id))){
    const reduced=caseId.includes('-reduced-transparency-'),width=Number(caseId.split('-').at(-1)),theme=reduced?'dark':caseId.split('-').at(-2),viewport={width,height:1000};
    const key=reduced?caseId.replace(/-reduced-transparency-\d+$/,''):caseId.replace(/-(dark|light)-\d+$/,'');
    const scene=special.scenes[key];assert(scene,'Missing declared special scene '+key);assert(scene.route&&scene.actor&&scene.mapping?.length,'Special scene must identify its actual product route, actor and design mapping');
    assert(scene.actualDtoInputs?.length&&scene.actualDtoInputs.every(file=>special.actualDtoInputs.some(input=>input.path===file)),'Special scene has no bound actual DTO input');
    const ctx=await context(scene.actor,theme,viewport);current=await ctx.newPage();current.setDefaultTimeout(12000);
    current.on('pageerror',error=>proof.pageErrors.push({caseId,message:error.message}));const clicks=[],network=[],interceptions=[];
    current.on('response',response=>{const url=new URL(response.url());if(url.pathname.startsWith('/api/admin/'))network.push({path:url.pathname,method:response.request().method(),status:response.status()});});
    await current.route('**/api/admin/**',async route=>{
      const request=route.request(),url=new URL(request.url()),method=request.method();
      const response=scene.responses?.find(item=>item.path===url.pathname&&(!item.query||item.query===url.search)&&item.method===method);
      if(response){assert(response.inputPath&&scene.actualDtoInputs.includes(response.inputPath),'Response fixture lacks an actual DTO input');interceptions.push({path:url.pathname,method,kind:'explicit-ui-response-fixture'});return route.fulfill({status:response.status||200,contentType:'application/json',body:JSON.stringify(response.body)});}
      if(method!=='GET'){interceptions.push({path:url.pathname,method,kind:scene.failure?.kind||'blocked-write'});if(scene.failure?.kind==='transport-unknown')return route.abort();return route.fulfill({status:scene.failure?.status||503,contentType:'application/json',body:JSON.stringify(scene.failure?.body||{code:503,message:'PROMOTION_SOURCE_UNAVAILABLE',data:null})});}
      return route.continue();
    });
    const url=new URL(scene.route,base).href;assert.equal(new URL(url).origin,base,'Special scenes must stay on the isolated PC service');await current.goto(url);await expect(current.locator('.prm')).toBeVisible();await current.waitForLoadState('networkidle');
    if(reduced){const cdp=await ctx.newCDPSession(current);await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'},{name:'prefers-reduced-motion',value:'reduce'}]});}
    for(const action of scene.actions){
      const root=action.scope==='dialog'?current.locator('dialog[open]').last():current;
      if(action.kind==='click'){const control=action.label?root.getByLabel(action.label,{exact:true}):root.getByRole('button',{name:action.name,exact:true});await control.nth(action.index||0).click();clicks.push({action:'click',name:action.name||action.label,index:action.index||0});}
      else if(action.kind==='link'){await root.getByRole('link',{name:action.name,exact:true}).nth(action.index||0).click();clicks.push({action:'click',name:action.name,index:action.index||0});}
      else if(action.kind==='fill'){await root.getByLabel(action.label,{exact:true}).fill(action.value);clicks.push({action:'fill',label:action.label,value:action.value});}
      else if(action.kind==='select'){await root.getByLabel(action.label,{exact:true}).selectOption(String(action.value));clicks.push({action:'select',label:action.label,value:action.value});}
      else if(action.kind==='check'){await root.getByLabel(action.label,{exact:true}).check();clicks.push({action:'check',label:action.label});}
      else if(action.kind==='upload'){await root.getByLabel(action.label,{exact:true}).setInputFiles(action.path);clicks.push({action:'upload',label:action.label,inputFile:action.path});}
      else throw Error('Unsupported rendered-control action '+action.kind);
      if(action.expectText)await expect(current.getByText(action.expectText,{exact:true}).last()).toBeVisible();
    }
    if(/-(modal|row)-/.test(caseId))await expect(current.locator('dialog[open]').last()).toBeVisible();
    const file=path.join(dir,caseId+'.png'),segments=await capturePromotionPage(current,file),reducedTransparency=reduced?await current.evaluate(()=>({matches:matchMedia('(prefers-reduced-transparency: reduce)').matches,backdropFilter:getComputedStyle([...document.querySelectorAll('dialog[open]')].at(-1),'::backdrop').backdropFilter})):null;
    proof.boards.push({caseId,screen:caseId.slice(0,5),state:'normal',theme,viewport,dpr:1,file,segments,sha256:hash(fs.readFileSync(file)),url,clicks,network,interceptions,mapping:scene.mapping,fixtureKind:special.kind,actualDtoInputs:scene.actualDtoInputs,reducedTransparency,mask:[]});await current.close();current=null;await ctx.close();console.log(JSON.stringify({captured:proof.boards.length,caseId}));
  }
  assert.equal(readBackendSource(external).serviceSourceHash,proof.source.serviceSourceHash,'Backend runtime changed while capturing');assert.deepEqual(proof.pageErrors,[]);assert.equal(hash(JSON.stringify(hashes())),sourceHash,'Product files changed while capturing');proof.status=baseOnly?'partial-awaiting-independent-review':'captured-awaiting-independent-review';if(!baseOnly)validatePromotionVisualBoards(proof,requiredCases);
}catch(e){proof.status='failed';proof.failure=String(e.stack||e);if(current)await current.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{proof.finishedAt=new Date().toISOString();fs.mkdirSync(path.dirname(report),{recursive:true});fs.writeFileSync(report,JSON.stringify(proof,null,2));fs.writeFileSync(path.join(dir,'index.html'),`<!doctype html><meta charset="utf-8"><title>PC candidate</title><h1>实际产品候选，待独立审查</h1><p>${proof.source.dirtySourceHash}</p>`+proof.boards.flatMap(b=>b.segments.map((s,i)=>`<a style="display:block" href="${path.basename(s.file)}">${b.caseId} · ${s.kind} ${i}</a>`)).join(''));await browser.close();console.log(JSON.stringify({status:proof.status,boards:proof.boards.length,dir,report,failure:proof.failure?.split('\n').slice(0,2)}));}
