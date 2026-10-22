import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function load(path, require) {
  const context = { exports: {}, require };
  vm.runInNewContext(ts.transpileModule(readFileSync(path,"utf8"),{ compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, context);
  return context.exports;
}
const contract=load("lib/admin/cregis-funds-preparation.ts",()=>({}));
const routes=load("lib/admin/cregis-exception-routes.ts",()=>({}));
const config={ platformAddress:"0x"+"a".repeat(40), counterpartyAddress:"0x"+"b".repeat(40), projectId:"1466552794661984",
  network:"BSC",asset:"USDT",executionEnabled:false,mode:"PREPARATION_ONLY",sources:[{address:"0x"+"c".repeat(40),userId:"9"}] };

test("only explicit preparation routes can reach backend; no execute or permissive wildcards",()=>{
  assert.deepEqual(Array.from(routes.cregisExceptionRoute(["cregis","funds-preparation","status"]).methods),["GET","HEAD"]);
  for(const suffix of ["execute","send","payout","collection","plans/123/decision","plans/CF-invalid/decision"])
    assert.equal(routes.cregisExceptionRoute(["cregis","funds-preparation",...suffix.split("/")]),null);
  assert.deepEqual(Array.from(routes.cregisExceptionRoute(["cregis","funds-preparation","preflight"]).methods),["POST"]);
  const no="CF-12345678-1234-1234-1234-123456789abc";
  assert.deepEqual(Array.from(routes.cregisExceptionRoute(["cregis","funds-preparation","plans",no,"decision"]).methods),["POST"]);
});
test("configuration must remain preparation only and monetary text is lossless",()=>{
  assert.equal(contract.preparationConfig(config),config);
  for(const changed of [{executionEnabled:true},{asset:"USDC"},{network:"ETH"},{sources:[{address:"0x"+"c".repeat(40),userId:9007199254740992}]}])
    assert.throws(()=>contract.preparationConfig({...config,...changed}));
  for(const value of ["0","-1","1e2","1.0000001","1000000000000","01","NaN"]) assert.throws(()=>contract.preparationAmount(value));
  for(const value of ["0.000001","999999999999.999999","1.000000"]) assert.equal(contract.preparationAmount(value),value);
});

function harness({write=true,kind="SUPPLIER_PAYMENT",record}={}) {
  const rights=["finance_d1_read",...(write?["finance_d1_channel_manage","finance_d2_withdrawal_approve"]:[])];
  let auth={isAuthenticated:true,authEpoch:1,session:{adminId:7,authorities:rights}}, lifecycle=1;
  const authHook=Object.assign(selector=>selector(auth),{getState:()=>auth});
  let state=[config,{records:record?[record]:[],hasMore:false,nextBeforeId:null},kind,"", "20.000001","invoice-1",null,"",false,false];
  let refs=[], stateIndex=0,refIndex=0;
  const confirmations=[],calls=[];
  const component=load("app/components/domain-views/d-tabs/cregis-funds-preparation.tsx",name=>{
    if(name==="react")return {
      useCallback:fn=>fn,useEffect:()=>{},
      useState:initial=>{const i=stateIndex++;if(state[i]===undefined)state[i]=initial;return[state[i],next=>{state[i]=typeof next==="function"?next(state[i]):next;}];},
      useRef:initial=>{const i=refIndex++;return refs[i]??(refs[i]={current:initial});},
    };
    if(name==="react/jsx-runtime")return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
    if(name.includes("store/admin-auth"))return {useAdminAuth:authHook};
    if(name.includes("auth-lifecycle"))return {adminAuthActivityAllowed:()=>true,adminAuthLifecycleEpoch:()=>lifecycle};
    if(name.includes("cregis-funds-preparation"))return contract;
    if(name.includes("cregis-exceptions"))return {
      exceptionObject:v=>v,exceptionRead:async()=>config,exceptionList:async()=>({records:[],hasMore:false,nextBeforeId:null}),
      exceptionCommand:async(path,body,scope)=>{scope.assertOwner();calls.push({path,body});return {id:"1"};},
    };
    if(name.includes("d-client"))return {financeAdminRequest:async()=>({executionEnabled:false,blockers:[],balance:null})};
    return {};
  });
  const props={canManage:write,openActionConfirm:confirmation=>confirmations.push(confirmation)};
  function render(){stateIndex=0;refIndex=0;const wrapper=component.CregisFundsPreparation(props);return wrapper.type(wrapper.props);}
  function nodes(node,predicate,out=[]){if(!node||typeof node!=="object")return out;if(predicate(node))out.push(node);for(const child of [node.props?.children].flat(Infinity))nodes(child,predicate,out);return out;}
  const text=node=>typeof node==="string"?node:node?.props?[node.props.children].flat(Infinity).map(text).join(""):"";
  const button=(label)=>nodes(render(),node=>node.type==="button"&&text(node)===label)[0];
  return {render,nodes,text,button,confirmations,calls,changeOwner:()=>{auth={...auth,session:{...auth.session,adminId:8},authEpoch:2};lifecycle++;}};
}
test("supplier preparation captures source and amount in confirmation and never a send route",async()=>{
  const h=harness(); h.button("创建准备单").props.onClick();
  assert.equal(h.confirmations.length,1);assert.match(h.confirmations[0].detail,/仅保存准备记录，不发送资金/);
  await h.confirmations[0].run("核对当前业务与金额后准备");
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,"/funds-preparation/plans");
  assert.equal(h.calls[0].body.sourceAddress,config.platformAddress);assert.equal(h.calls[0].body.amountUsdt,"20.000001");
});
test("deferred confirmation cannot mutate after logout or account switch",async()=>{
  const h=harness();h.button("创建准备单").props.onClick();h.changeOwner();
  await assert.rejects(()=>h.confirmations[0].run("核对当前业务与金额后准备"),/身份或权限已变化/);assert.equal(h.calls.length,0);
});
test("readonly role has no preparation or preflight mutation controls",()=>{
  const h=harness({write:false});assert.equal(h.button("创建准备单"),undefined);assert.equal(h.button("只读检查余额与条件"),undefined);
});
test("maker cannot self-review and reviewed record is still visibly unpaid",()=>{
  const record={id:"1",planNo:"CF-12345678-1234-1234-1234-123456789abc",kind:"SUPPLIER_PAYMENT",state:"DRAFT",makerId:"7",amountUsdt:"20",sourceAddress:config.platformAddress,targetAddress:config.counterpartyAddress};
  assert.equal(harness({record}).button("复核准备"),undefined);
  const h=harness({record:{...record,state:"REVIEWED"}});assert.match(h.text(h.render()),/准备已复核 · 未转账/);assert.equal(h.button("发送"),undefined);
});
