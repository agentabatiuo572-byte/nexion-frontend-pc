import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const promotionCaseId=file=>path.basename(file).replace(/\.png$/,'').replace(/-bottom$/,'');
export function promotionVisualCases(design,baseline){
  assert.equal(baseline.designHash,design.designHash,'Frozen export and design differ');
  const expected=[...new Set(baseline.captures.map(capture=>promotionCaseId(capture.file)))].sort();
  const base=expected.filter(id=>/^ADM\d{2}-(normal|empty|loading|error|disabled|long)-(dark|light)-(1280|1440)$/.test(id));
  assert.equal(base.length,design.coverage.baseBoards,'Frozen base coverage changed');assert.equal(expected.length,398,'Expected the approved v4 complete case set');return expected;
}
export function promotionVisualSources(repo=process.cwd()){
  return ['scripts/growth-promotions-capture.mjs','scripts/growth-promotions-visual.mjs','scripts/growth-promotions-workflow-runtime.mjs','app/api/admin/growth/[...path]/route.ts','app/components/domain-views/design-kit.tsx','app/components/domain-views/h-view.tsx',...fs.readdirSync(path.join(repo,'app/components/domain-views/h-tabs')).filter(n=>/^h4-promotion/.test(n)).map(n=>'app/components/domain-views/h-tabs/'+n),...fs.readdirSync(path.join(repo,'lib/admin')).filter(n=>/^promotion-/.test(n)).map(n=>'lib/admin/'+n)].sort();
}
function exactSet(actual,expected,label){assert.equal(actual.length,new Set(actual).size,'Duplicate '+label);assert.deepEqual([...actual].sort(),[...expected].sort(),'Incomplete '+label);}
function scrollCoverage(segments,key){
  const rows=segments.map(s=>s.geometry[key]).filter(Boolean);assert(rows.length,'Missing '+key+' geometry');const first=rows[0],last=rows.at(-1);assert.equal(first.scrollTop,0,'Missing '+key+' top');assert(last.scrollTop+last.clientHeight>=last.scrollHeight-1,'Missing '+key+' bottom');
  for(let n=1;n<rows.length;n++){assert.equal(rows[n].scrollHeight,first.scrollHeight,key+' content changed');assert(rows[n].scrollTop>=rows[n-1].scrollTop&&rows[n].scrollTop<=rows[n-1].scrollTop+first.clientHeight,key+' coverage gap');}
}
export function validatePromotionVisualBoards(proof,expected,readFile=fs.readFileSync){
  assert.equal(proof.status,'captured-awaiting-independent-review');assert.deepEqual(proof.pageErrors,[]);exactSet(proof.boards.map(b=>b.caseId),expected,'product cases');const images=[];
  for(const board of proof.boards){
    assert.equal(board.dpr,1,'Capture DPR changed');assert([1280,1440].includes(board.viewport.width));assert.equal(board.viewport.height,1000);
    assert.equal(board.screen,board.caseId.slice(0,5),'Case screen differs');assert.equal(board.viewport.width,Number(board.caseId.split('-').at(-1)),'Case viewport differs');assert.equal(board.theme,board.caseId.includes('-reduced-transparency-')?'dark':board.caseId.split('-').at(-2),'Case theme differs');
    assert.equal(digest(readFile(board.file)),board.sha256,'Changed capture');assert(board.segments?.length,'Missing native frames');assert.equal(board.segments[0].file,board.file);assert.equal(board.segments[0].sha256,board.sha256);
    for(const segment of board.segments){assert.equal(digest(readFile(segment.file)),segment.sha256,'Changed internal scroll capture');assert.deepEqual(segment.geometry.viewport,{width:board.viewport.width,height:board.viewport.height});images.push({caseId:board.caseId,path:segment.file,sha256:segment.sha256});}
    scrollCoverage(board.segments.filter(s=>s.kind==='main'),'main');
    if(/-(modal|row)-/.test(board.caseId)){assert(board.clicks?.some(c=>c.action==='click'||c.click),'Special board was not opened through a rendered control');assert(board.segments[0].geometry.dialog,'Requested dialog is missing');scrollCoverage(board.segments,'dialogBody');}
    if(board.caseId.includes('-reduced-transparency-')){assert.equal(board.reducedTransparency?.matches,true);assert.equal(board.reducedTransparency?.backdropFilter,'none');}
  }
  assert.equal(images.length,new Set(images.map(i=>i.path)).size,'Duplicate image paths');return images;
}
export function validatePromotionVisualFixture(proof,readFile=fs.readFileSync){
  const binding=proof.specialFixture;assert(binding?.path&&binding.sha256,'Special fixture provenance is missing');const raw=readFile(binding.path);assert.equal(digest(raw),binding.sha256,'Special fixture changed');const fixture=JSON.parse(raw);
  assert.equal(binding.kind,'explicit-ui-response-fixtures');assert.equal(fixture.kind,binding.kind);assert.equal(fixture.designHash,proof.source.designHash);assert.equal(fixture.sourceHash,proof.source.dirtySourceHash);assert.equal(fixture.serviceSourceHash,proof.source.serviceSourceHash);assert(fixture.actualDtoInputs?.length,'Missing actual DTO inputs');assert.deepEqual(binding.actualDtoInputs,fixture.actualDtoInputs);
  for(const input of fixture.actualDtoInputs)assert.equal(digest(readFile(input.path)),input.sha256,'Actual DTO input changed');
  for(const board of proof.boards.filter(b=>!/^ADM\d{2}-(normal|empty|loading|error|disabled|long)-/.test(b.caseId))){
    const key=board.caseId.includes('-reduced-transparency-')?board.caseId.replace(/-reduced-transparency-\d+$/,''):board.caseId.replace(/-(dark|light)-\d+$/,'');const scene=fixture.scenes[key];assert(scene,'Missing declared scene');assert.equal(board.fixtureKind,fixture.kind);assert.deepEqual(board.actualDtoInputs,scene.actualDtoInputs);assert.deepEqual(board.mapping,scene.mapping);assert(scene.actualDtoInputs?.length&&scene.actualDtoInputs.every(file=>fixture.actualDtoInputs.some(input=>input.path===file)),'Unbound scene DTO input');
  }
}
export function validatePromotionVisualReviews(review,proof,candidateHash,images,readFile=fs.readFileSync){
  assert.equal(review.candidateHash,candidateHash,'Reviews must bind this exact manifest');assert.equal(review.designHash,proof.source.designHash);assert.equal(review.sourceHash,proof.source.dirtySourceHash);assert(review.reviews.length>=2);assert.equal(new Set(review.reviews.map(r=>r.reviewer)).size,review.reviews.length,'Reviewer identities repeat');
  const cases=proof.boards.map(b=>b.caseId),imageKeys=images.map(i=>i.path+'\0'+i.sha256);
  for(const reviewer of review.reviews){
    assert.equal(reviewer.implemented,false);assert.equal(reviewer.verdict,'PASS');assert.equal(reviewer.unresolvedFindings,0);const raw=readFile(reviewer.report);assert.equal(digest(raw),reviewer.reportSha256,'Changed independent report');const report=JSON.parse(raw);
    assert.equal(report.reviewer,reviewer.reviewer);assert.equal(report.verdict,'PASS');assert.equal(report.wholeVisualAcceptancePass,true);assert.equal(report.allCurrentImagesActuallyViewed,true);assert.equal(report.candidateSha256,candidateHash);assert.equal(report.designSha256,proof.source.designHash);assert.equal(report.product.sourceHash,proof.source.dirtySourceHash);assert((report.findings||[]).every(f=>f.resolved===true||f.status==='closed'),'Independent findings remain open');
    exactSet(reviewer.reviewedBoards,cases,'review summary cases');exactSet(report.reviewedCases,cases,'actual reviewed cases');exactSet(report.viewedImages.map(i=>i.path+'\0'+i.sha256),imageKeys,'actually viewed images');
    for(const image of report.viewedImages){assert.equal(image.actuallyViewed,true);assert(image.viewMethod?.length,'Missing actual view evidence');if(image.contactSheetPath)assert.equal(digest(readFile(image.contactSheetPath)),image.contactSheetSha256,'Changed viewed contact sheet');}
  }
}

function main(){
const env=process.env,startedAt=new Date().toISOString();
const argument=name=>{const i=process.argv.indexOf(name);assert(i>=0&&process.argv[i+1],`Missing ${name}`);return process.argv[i+1];};
const suite=argument('--suite'),report=path.resolve(argument('--report')),external=path.dirname(report);
for(const key of ['WORKFLOW_TASK_ID','WORKFLOW_STEP_ID','WORKFLOW_CHECK_ID','WORKFLOW_RUN_ID','WORKFLOW_REPO','WORKFLOW_SNAPSHOT_HASH'])assert(env[key],`Missing ${key}; use the workflow CLI`);
assert.equal(path.resolve(env.WORKFLOW_REPO).toLowerCase(),process.cwd().toLowerCase());
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const steps=[];let failure;
try{
  if(suite==='runtime'){
    const file=path.join(external,`pc-browser-${env.WORKFLOW_RUN_ID}.json`),before=Date.now();
    const child=spawnSync(process.execPath,['scripts/growth-promotions-runtime.mjs','--report',file],{stdio:'inherit',env,windowsHide:true,timeout:540000});
    assert.equal(child.status,0,'Actual browser flow failed');assert(fs.statSync(file).mtimeMs>=before);
    const proof=JSON.parse(fs.readFileSync(file));assert.equal(proof.status,'passed');assert.equal(proof.mode,'full');assert.deepEqual(proof.pageErrors,[]);
    const coverage={
      'pc-flow':['partial-save-reload','four-step-save-reload','simulation-readonly','approval-publish-dual-lifecycle','metrics-real-snapshot','metrics-export','reward-original-receipt','five-templates','reward-retry-reconcile'],
      'pc-edge':['real-reader-readonly','real-permission-denial','unknown-original-key-recovery','resource-shortage','qualification-expired'],
    };
    for(const [id,names]of Object.entries(coverage)){
      const rows=names.map(name=>proof.steps.find(s=>s.id===name));
      assert(rows.every(s=>s?.status==='passed'&&s.evidence?.length),`${id}: missing actual cases: ${names.filter((_,i)=>!rows[i]).join(', ')}`);
      steps.push({id,status:'pass',innerSkipped:0,evidence:[file,...rows.flatMap(s=>s.evidence)]});
    }
  }else if(suite==='visual'){
    // This verifies current product captures and the independent review records, never the old design-only export.
    const file=env.PROMOTION_VISUAL_CANDIDATE||path.join(external,'pc-visual-candidate.json'),proof=JSON.parse(fs.readFileSync(file));
    assert.equal(proof.status,'captured-awaiting-independent-review');assert.deepEqual(proof.pageErrors,[]);
    const design=JSON.parse(fs.readFileSync('docs/design/growth-promotions/admin-r1-baseline.json'));
    const baselineRaw=fs.readFileSync('docs/design/growth-promotions/evidence/admin-r1-design/v4-purchase-interval/export-report.json'),baseline=JSON.parse(baselineRaw);
    assert.equal(hash(fs.readFileSync(path.join('docs/design/growth-promotions',design.designFile))),design.designHash,'Approved design changed');assert.equal(proof.source.baselineManifestHash,hash(baselineRaw));
    assert.equal(proof.source.designHash,design.designHash);
    exactSet(Object.keys(proof.source.files),promotionVisualSources(),'bound product sources');
    for(const [name,expected]of Object.entries(proof.source.files))assert.equal(hash(fs.readFileSync(name)),expected,`Changed product source: ${name}`);
    assert.equal(hash(JSON.stringify(proof.source.files)),proof.source.dirtySourceHash);assert.equal(hash(fs.readFileSync(proof.source.serviceSource)),proof.source.serviceSourceHash,'Backend service changed');
    const images=validatePromotionVisualBoards(proof,promotionVisualCases(design,baseline));
    validatePromotionVisualFixture(proof);
    const reviewFile=env.PROMOTION_VISUAL_REVIEWS||path.join(external,'pc-independent-visual-reviews.json'),review=JSON.parse(fs.readFileSync(reviewFile));
    validatePromotionVisualReviews(review,proof,hash(fs.readFileSync(file)),images);
    steps.push({id:'pc-pixels',status:'pass',innerSkipped:0,evidence:[file,reviewFile,...review.reviews.map(r=>r.report)]},{id:'pc-states',status:'pass',innerSkipped:0,evidence:[file,...images.map(i=>i.path)]});
  }else throw new Error('Unknown suite');
}catch(error){failure=String(error.stack||error);process.exitCode=1;}
fs.writeFileSync(report,JSON.stringify({taskId:env.WORKFLOW_TASK_ID,stepId:env.WORKFLOW_STEP_ID,checkId:env.WORKFLOW_CHECK_ID,runId:env.WORKFLOW_RUN_ID,repo:env.WORKFLOW_REPO,snapshotHash:env.WORKFLOW_SNAPSHOT_HASH,startedAt,at:new Date().toISOString(),verdict:failure?'fail':'pass',mode:'full',treeMoved:false,capability:'runtime',steps,failure},null,2));
console.log(JSON.stringify({suite,verdict:failure?'fail':'pass',report,failure:failure?.split('\n')[0]}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
