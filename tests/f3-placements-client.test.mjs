import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {outcomeStaysUnknown} from '../lib/admin/outcome-classification.ts';

const intent={ownerUserId:60723153007,memberUserId:60723153019,leg:'A'};
const row={...intent,assignedBy:'superadmin',assignedAt:'2026-10-16T10:00:00',assignmentSource:'MANUAL'};
const page={ownerUserId:intent.ownerUserId,status:'ALL',page:1,pageSize:20,total:1,records:[row]};
function harness(response){
  const calls=[]; let resets=0; const module={exports:{}};
  const fetch=async(...args)=>{calls.push(args);if(response instanceof Error)throw response;return response;};
  const source=readFileSync(new URL('../lib/admin/f3-placements-client.ts',import.meta.url),'utf8');
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,URLSearchParams,Error,require:id=>id.includes('outcome-classification')?{outcomeStaysUnknown}:id.includes('auth-session')?{isAdminAuthFailure:s=>s===401,resetAdminSession:()=>resets++}:{guardedFetch:fetch,formatAdminApiError:()=> '请求未完成'}});
  return {...module.exports,calls,resets:()=>resets};
}
const response=(data,status=200,code=0)=>new Response(JSON.stringify({code,data}),{status});
test('owner/member read is exact, paginated and does not post',async()=>{
  const h=harness(response(page)); const actual=await h.readPlacements(intent.ownerUserId,'ALL',1,intent.memberUserId);
  assert.equal(actual.records[0].leg,'A');const [url,init]=h.calls[0];assert.equal(init.method,'GET');
  const q=new URL(url,'https://local').searchParams;assert.equal(q.get('ownerUserId'),String(intent.ownerUserId));assert.equal(q.get('memberUserId'),String(intent.memberUserId));assert.equal(q.get('pageSize'),'20');
});
test('cross owner/member, malformed totals and wrong status never become empty success',async()=>{
  for(const data of [{...page,ownerUserId:1},{...page,total:null},{...page,records:[{...row,memberUserId:9}]},{...page,records:null},{...page,status:'ASSIGNED'}]){
    const h=harness(response(data));await assert.rejects(()=>h.readPlacements(intent.ownerUserId,'ALL',1,intent.memberUserId));
  }
});
test('POST preserves only owner/member/leg, same-track replay is explicit',async()=>{
  const h=harness(response({...intent,replayed:true}));assert.equal((await h.assignPlacement(intent)).replayed,true);
  assert.deepEqual(JSON.parse(h.calls[0][1].body),intent);assert.equal(h.calls[0][1].headers['Idempotency-Key'],undefined);
});
test('conflict is rejected; transport/5xx/unreadable/wrong success are unknown with no retry',async()=>{
  const conflict=harness(response(null,409,409));await assert.rejects(()=>conflict.assignPlacement(intent),e=>e.status===409&&e.outcome==='rejected');
  for(const r of [new Error('lost'),response(null,503,503),new Response('<html/>'),response({...intent,memberUserId:2,replayed:false})]){
    const h=harness(r);await assert.rejects(()=>h.assignPlacement(intent),e=>e.outcome==='unknown');assert.equal(h.calls.length,1);
  }
});
test('401 resets session even for unreadable response',async()=>{
  const h=harness(new Response('expired',{status:401}));await assert.rejects(()=>h.assignPlacement(intent),e=>e.outcome==='rejected');assert.equal(h.resets(),1);
});
