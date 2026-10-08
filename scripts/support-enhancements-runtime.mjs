import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,existsSync,mkdirSync} from "node:fs";
import {dirname,join,resolve} from "node:path";

// Validate recorded real-browser/API/DB observations; source checks cannot create a runtime pass.
const arg=name=>{const i=process.argv.indexOf(name);assert.ok(i>=0&&process.argv[i+1]&&!process.argv[i+1].startsWith("--"),`${name} is required`);return process.argv[i+1];};
const phase=arg("--phase"),plan=JSON.parse(readFileSync(arg("--plan"),"utf8")),reportPath=resolve(arg("--report"));
assert.ok(["ui","integration"].includes(phase));
const spec=phase==="ui"?plan.steps.find(s=>s.id==="ui"):plan.integration;
const required=spec.checks.find(c=>c.capability==="runtime").requiredChecks;
const proofPath=process.env.SUPPORT_RUNTIME_PROOF??join(dirname(reportPath),`${phase}-observations.json`);
const proof=existsSync(proofPath)?JSON.parse(readFileSync(proofPath,"utf8")):null;
const identity={taskId:process.env.WORKFLOW_TASK_ID,stepId:process.env.WORKFLOW_STEP_ID,checkId:process.env.WORKFLOW_CHECK_ID,runId:process.env.WORKFLOW_RUN_ID,repo:process.env.WORKFLOW_REPO,snapshotHash:process.env.WORKFLOW_SNAPSHOT_HASH};
const bound=proof?.runtimeKind==="real-http-and-browser"&&proof.taskId===plan.id&&proof.repo===plan.repo&&Boolean(identity.snapshotHash)&&proof.snapshotHash===identity.snapshotHash;
const rows=new Map();
for(const row of proof?.steps??[]){assert.ok(!rows.has(row.id),`duplicate observation ${row.id}`);rows.set(row.id,row);}
const steps=required.map(id=>{
  const row=rows.get(id),evidence=[];
  let status=bound&&row?.status==="pass"&&row.role&&row.testData&&Array.isArray(row.evidence)&&row.evidence.length?"pass":row?.status==="fail"?"fail":"unverified";
  if(status==="pass")for(const item of row.evidence){
    try{assert.equal(typeof item.path,"string");const bytes=readFileSync(item.path);assert.equal(createHash("sha256").update(bytes).digest("hex"),item.sha256);evidence.push(`${item.path} (sha256 ${item.sha256})`);}catch{status="unverified";}
  }
  return {id,status,evidence,role:row?.role,testData:row?.testData,reason:status==="pass"?undefined:row?.reason??"Missing current-snapshot real runtime observations"};
});
const passed=steps.every(s=>s.status==="pass");
mkdirSync(dirname(reportPath),{recursive:true});
writeFileSync(reportPath,JSON.stringify({...identity,at:new Date().toISOString(),verdict:passed?"pass":"unverified",mode:"full",capability:"runtime",treeMoved:false,innerSkipped:0,proofPath,steps},null,2));
console.log(`${passed?"PASS":"UNVERIFIED"} ${phase}: ${steps.filter(s=>s.status==="pass").length}/${steps.length} real runtime observations`);
if(!passed)process.exitCode=1;
