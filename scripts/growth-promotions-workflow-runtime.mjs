import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

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
    const file=path.join(external,'pc-visual-candidate.json'),proof=JSON.parse(fs.readFileSync(file));
    assert.equal(proof.status,'captured-awaiting-independent-review');assert.deepEqual(proof.pageErrors,[]);
    const design=JSON.parse(fs.readFileSync('docs/design/growth-promotions/admin-r1-baseline.json'));
    assert.equal(proof.source.designHash,design.designHash);
    for(const [name,expected]of Object.entries(proof.source.files))assert.equal(hash(fs.readFileSync(name)),expected,`Changed product source: ${name}`);
    const boards=new Set(proof.boards.map(b=>`${b.screen}/${b.state}/${b.theme}/${b.viewport.width}`));
    for(const screen of design.coverage.screens)for(const state of design.coverage.states)for(const theme of design.coverage.themes)for(const viewport of design.renderer.viewports)assert(boards.has(`${screen}/${state}/${theme}/${viewport.width}`),'Missing requested product board');
    for(const board of proof.boards){
      assert.equal(hash(fs.readFileSync(board.file)),board.sha256,'Changed capture');
      assert(board.segments?.length,'Missing internal MAIN coverage');
      for(const segment of board.segments)assert.equal(hash(fs.readFileSync(segment.file)),segment.sha256,'Changed internal scroll capture');
      const first=board.segments[0].geometry.main,last=board.segments.at(-1).geometry.main;
      if(first){assert.equal(first.scrollTop,0);assert(last.scrollTop+last.clientHeight>=last.scrollHeight-1);for(let n=1;n<board.segments.length;n++)assert(board.segments[n].geometry.main.scrollTop<=board.segments[n-1].geometry.main.scrollTop+first.clientHeight);}
    }
    const reviewFile=path.join(external,'pc-independent-visual-reviews.json'),review=JSON.parse(fs.readFileSync(reviewFile));
    assert.equal(review.candidateHash,hash(fs.readFileSync(file)),'Reviews must bind this exact capture manifest');
    assert.equal(review.designHash,design.designHash);assert.equal(review.sourceHash,proof.source.dirtySourceHash);
    assert(review.reviews.length>=2&&new Set(review.reviews.map(r=>r.reviewer)).size>=2);
    for(const r of review.reviews){assert.equal(r.implemented,false);assert.equal(r.verdict,'PASS');assert.equal(r.unresolvedFindings,0);assert(fs.existsSync(r.report));assert.deepEqual(new Set(r.reviewedBoards),boards);}
    steps.push({id:'pc-pixels',status:'pass',innerSkipped:0,evidence:[file,reviewFile,...review.reviews.map(r=>r.report)]},{id:'pc-states',status:'pass',innerSkipped:0,evidence:[file,...proof.boards.map(b=>b.file)]});
  }else throw new Error('Unknown suite');
}catch(error){failure=String(error.stack||error);process.exitCode=1;}
fs.writeFileSync(report,JSON.stringify({taskId:env.WORKFLOW_TASK_ID,stepId:env.WORKFLOW_STEP_ID,checkId:env.WORKFLOW_CHECK_ID,runId:env.WORKFLOW_RUN_ID,repo:env.WORKFLOW_REPO,snapshotHash:env.WORKFLOW_SNAPSHOT_HASH,startedAt,at:new Date().toISOString(),verdict:failure?'fail':'pass',mode:'full',treeMoved:false,capability:'runtime',steps,failure},null,2));
console.log(JSON.stringify({suite,verdict:failure?'fail':'pass',report,failure:failure?.split('\n')[0]}));
