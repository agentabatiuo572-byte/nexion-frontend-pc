import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isDeletablePromotion, promotionDeleteBody, isDeletableQuestEvent } from '../lib/admin/activity-delete.ts';
import { allowedPromotionRoute } from '../lib/admin/promotion-routes.ts';

const draft = { activityId: 'A1', state: 'DRAFT', revision: 2, activeVersion: null, draftVersionState: 'DRAFT', current: { revision: 9 } };
test('promotion deletion accepts only editable drafts or ended activities and protects draft edits independently', () => {
  assert.deepEqual(promotionDeleteBody(draft), { expectedRevision: 2, expectedDraftRevision: 9, evidenceRefs: [] });
  assert.deepEqual(promotionDeleteBody({ ...draft, state: 'ENDED' }), { expectedRevision: 2, evidenceRefs: [] });
  for (const state of ['ACTIVE', 'SCHEDULED', 'PAUSED', 'ARCHIVED']) assert.equal(isDeletablePromotion({ ...draft, state }), false);
  for (const change of [{deleted:true},{draftVersionState:'APPROVED'},{draftVersionState:'PENDING_APPROVAL'},{activeVersion:1},{current:null}]) assert.throws(() => promotionDeleteBody({...draft,...change}));
  assert.equal(allowedPromotionRoute(['promotions','A1','delete'],'POST'),true);
  for (const method of ['GET','PUT','DELETE']) assert.equal(allowedPromotionRoute(['promotions','A1','delete'],method),false);
});

test('legacy deletion requires a complete authoritative token and eligible state; upcoming is not a draft', () => {
  for (const deleteState of ['draft', 'ended']) assert.equal(isDeletableQuestEvent({ deleteState, deletable: true, deleteVersion: 'v1' }), true);
  for (const change of [{deleteState:'ongoing'},{deleteState:'upcoming'},{deletable:false},{deleteVersion:''},{deleteState:undefined}]) assert.equal(isDeletableQuestEvent({ deleteState:'draft',deletable:true,deleteVersion:'v1',...change }),false);
});

function legacyClient() {
  const records = new Map(), requests = []; let responses = [], durable = true;
  const store = {list:()=>[...records.values()],remember:(fingerprint,commandKey,extra)=>records.set(fingerprint,{fingerprint,commandKey,...extra}),forget:key=>records.delete(key),isDurablyStored:()=>durable};
  const code = ts.transpileModule(readFileSync(new URL('../lib/admin/h-client.ts',import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function('require','exports','module',code)(name => {
    if(name.endsWith('pending-mutation-store')) return {createPendingMutationStore:()=>store};
    if(name.endsWith('outcome-classification')) return {outcomeStaysUnknown:status=>status>=500};
    if(name.endsWith('error-messages')) return {formatAdminApiError:message=>message||'unknown',guardedFetch:async(path,init)=>{requests.push({path,...init});const next=responses.shift();assert(next,'unexpected request');return {ok:next.status===200,status:next.status,json:async()=>next.body};}};
    return {};
  },module.exports,module);
  return {...module.exports, requests, records, setDurable:value=>{durable=value;}, respond:(...xs)=>{responses=xs;}};
}

const ok = data => ({status:200,body:{code:0,data}});
const failed = status => ({status,body:{code:status,message:'failed'}});
test('legacy deletion keeps the same command and original body across unknown write and readback failures', async () => {
  const client=legacyClient();
  client.respond(failed(503));
  await assert.rejects(client.deleteH4QuestEvent('A/1','v1','原始删除理由'));
  const key=client.requests[0].headers.get('Idempotency-Key');
  assert.equal(client.pendingH4EventDeletes().length,1);
  await assert.rejects(client.deleteH4QuestEvent('A/1','v2','更改理由'),/还没确认/);
  assert.equal(client.requests.length,1);
  client.respond(ok({eventId:'A/1',deleted:true}),failed(503));
  await assert.rejects(client.deleteH4QuestEvent('A/1','v1','原始删除理由'));
  assert.equal(client.requests[1].headers.get('Idempotency-Key'),key);
  assert.equal(client.pendingH4EventDeletes().length,1);
  client.respond(ok({eventId:'A/1',deleted:true}),ok({events:[]}));
  assert.deepEqual(await client.deleteH4QuestEvent('A/1','v1','原始删除理由'),{events:[]});
  assert.equal(client.requests[3].headers.get('Idempotency-Key'),key);
  assert.equal(client.requests[3].path,'/api/admin/growth/quest-events/events/A%2F1');
  assert.deepEqual(JSON.parse(client.requests[3].body),{expectedVersion:'v1',reason:'原始删除理由'});
  assert.equal(client.pendingH4EventDeletes().length,0);
});

test('legacy definitive permission or stale rejection releases its command; a mismatched success stays pending', async () => {
  for (const status of [403,409]) {
    const client=legacyClient();client.respond(failed(status));
    await assert.rejects(client.deleteH4QuestEvent('A1','v1','原始删除理由'));
    assert.equal(client.pendingH4EventDeletes().length,0);
  }
  const client=legacyClient();client.respond(ok({eventId:'other',deleted:true}));
  await assert.rejects(client.deleteH4QuestEvent('A1','v1','原始删除理由'),/尚未确认/);
  assert.equal(client.pendingH4EventDeletes().length,1);
});



test('storage failure prevents dispatch and preserves an existing uncertain command', async () => {
  const client=legacyClient();client.setDurable(false);
  await assert.rejects(client.deleteH4QuestEvent('A1','v1','原始删除理由'),/无法保存/);
  assert.equal(client.requests.length,0);assert.equal(client.records.size,0);
  client.setDurable(true);client.respond(failed(503));
  await assert.rejects(client.deleteH4QuestEvent('A1','v1','原始删除理由'));
  const original=client.pendingH4EventDeletes()[0].commandKey;
  client.setDurable(false);
  await assert.rejects(client.deleteH4QuestEvent('A1','v1','原始删除理由'),/无法保存/);
  assert.equal(client.pendingH4EventDeletes()[0].commandKey,original);
  assert.equal(client.requests.length,1);
});

test('actual legacy activity row uses effective lifecycle when the stored state still says ongoing', async () => {
  const {createRequire}=await import('node:module');
  const {displayCopyModules}=await import('./display-copy-fixture.mjs');
  const require=createRequire(import.meta.url);
  const source=readFileSync(new URL('../app/components/domain-views/h-tabs/h3-quest-events.tsx',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  for (const [deleteState,label,canDelete] of [['ended','已结束',true],['draft','草稿',true],['ongoing','进行中',false],['upcoming','预告',false]]) {
    const event={id:'stale-stored-state',name:'活动',kind:'discount',state:'ongoing',deleteState,deletable:canDelete,deleteVersion:'v1'};
    const states=[0,{events:[event],eventStates:[{state:'ongoing',label:'进行中',tone:'ok'}]},false,null];let index=0;
    const module={exports:{}};
    new Function('require','exports','module',code)(name=>{
      if(displayCopyModules[name])return displayCopyModules[name];
      if(name==='react')return {useState:()=>[states[index++],()=>{}],useMemo:fn=>fn(),useEffect(){}};
      if(name==='react/jsx-runtime')return require(name);
      if(name.endsWith('h-client'))return {pendingH4EventDeletes:()=>[]};
      if(name.endsWith('activity-delete'))return {isDeletableQuestEvent};
      return {__esModule:true,default:()=>null};
    },module.exports,module);
    const tree=module.exports.H3QuestEvents({ctx:{can:()=>true},section:'events'}),nodes=[];
    const walk=node=>{if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;nodes.push(node);walk(node.props?.children);};
    walk(tree);
    const row=nodes.find(node=>node.type==='tr'&&node.key===event.id);assert(row);
    const children=row.props.children;
    assert.equal(children[2].props.children.props.children,label);
    const buttons=[];const buttonsIn=node=>{if(Array.isArray(node))return node.forEach(buttonsIn);if(!node||typeof node!=='object')return;if(node.type==='button')buttons.push(node);buttonsIn(node.props?.children);};buttonsIn(row);
    assert.equal(buttons.find(button=>button.props.children==='删除').props.disabled,!canDelete);
    if(deleteState==='ended') {
      assert.equal(buttons.find(button=>button.props.children==='编辑').props.disabled,true);
      assert(!buttons.some(button=>['下架','设主推','上架'].includes(button.props.children)));
    }
  }
});


test('a definitive rejection of retry cannot erase a previously unknown deletion', async () => {
  for (const status of [403,409]) {
    const client=legacyClient();client.respond(failed(503));
    await assert.rejects(client.deleteH4QuestEvent('A1','v1','原始删除理由'));
    const original=client.pendingH4EventDeletes()[0].commandKey;
    client.respond(failed(status));
    await assert.rejects(client.deleteH4QuestEvent('A1','v1','原始删除理由'));
    assert.equal(client.pendingH4EventDeletes()[0].commandKey,original);
    assert.equal(client.requests[1].headers.get('Idempotency-Key'),original);
    client.respond(ok({eventId:'A1',deleted:true}),ok({events:[]}));
    await client.deleteH4QuestEvent('A1','v1','原始删除理由');
    assert.equal(client.requests[2].headers.get('Idempotency-Key'),original);
    assert.equal(client.pendingH4EventDeletes().length,0);
  }
});
