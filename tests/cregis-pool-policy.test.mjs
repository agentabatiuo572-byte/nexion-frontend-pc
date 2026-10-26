import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
const ts=createRequire(import.meta.url)('typescript');
const source=readFileSync(new URL('../app/components/domain-views/d-tabs/cregis-pool-policy.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const policy={enabled:true,target:1000,lowWatermark:300,batchSize:50,concurrency:2,version:4};
function harness(){
  let index=0,refIndex=0;const state=[],refs=[],requests=[],confirms=[],effects=[],exports={};
  const auth={isAuthenticated:true,authEpoch:1,session:{adminId:7,authorities:['finance_d1_channel_manage']}};
  const useAdminAuth=selector=>selector(auth);useAdminAuth.getState=()=>auth;
  vm.runInNewContext(code,{exports,require(name){
    if(name==='react')return {useState(initial){const i=index++;if(!(i in state))state[i]=initial;return [state[i],v=>state[i]=v];},useRef(initial){const i=refIndex++;return refs[i]??=( {current:initial});},useCallback:fn=>fn,useEffect:fn=>effects.push(fn)};
    if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
    if(name==='@/lib/store/admin-auth')return {useAdminAuth};
    if(name==='@/lib/admin/d-client')return {async financeAdminRequest(path,options){requests.push({path,options});return options?{...JSON.parse(options.body),version:5}:policy;}};
    throw Error(name);
  }});
  return {...exports,requests,confirms,auth,async load(){this.render();effects.shift()();await new Promise(resolve=>setImmediate(resolve));},render(canManage=true){index=0;refIndex=0;return exports.CregisPoolPolicy({canManage,openActionConfirm:spec=>confirms.push(spec)});}};
}
function nodes(root,type){if(!root||typeof root!=='object')return [];if(Array.isArray(root))return root.flatMap(n=>nodes(n,type));return [...(root.type===type?[root]:[]),...nodes(root.props?.children,type)];}
test('policy editor reads server values and saves captured revision through confirmation',async()=>{
  const h=harness();await h.load();let tree=h.render();
  nodes(tree,'input').find(n=>n.props['aria-label']==='备用地址目标').props.onChange({target:{value:'2000'}});
  tree=h.render();nodes(tree,'button').find(n=>n.props.children==='保存地址池配置').props.onClick();
  assert.match(h.confirms[0].detail,/备用目标 2000/);await h.confirms[0].run('提高库存满足并发首次分配');
  const request=h.requests.find(r=>r.options);assert.equal(request.path,'/cregis/addresses/policy');
  assert.deepEqual(JSON.parse(request.options.body),{...policy,target:2000,reason:'提高库存满足并发首次分配'});
});
test('read-only admins cannot edit, invalid ranges cannot be submitted',async()=>{
  const h=harness();await h.load();let tree=h.render(false);
  assert.ok(nodes(tree,'input').every(n=>n.props.disabled));assert.ok(!nodes(tree,'button').some(n=>n.props.children==='保存地址池配置'));
  tree=h.render();nodes(tree,'input').find(n=>n.props['aria-label']==='建址并发上限').props.onChange({target:{value:'100'}});
  nodes(h.render(),'button').find(n=>n.props.children==='保存地址池配置').props.onClick();assert.equal(h.confirms.length,0);
});
test('account or permission changes invalidate an open save confirmation',async()=>{
  for(const mutate of [a=>a.authEpoch++,a=>a.session.authorities=[]]){
    const h=harness();await h.load();nodes(h.render(),'button').find(n=>n.props.children==='保存地址池配置').props.onClick();
    mutate(h.auth);await assert.rejects(()=>h.confirms[0].run('本次应拒绝过期的操作身份'),/登录身份或权限已变化/);
    assert.equal(h.requests.filter(r=>r.options).length,0);
  }
});
