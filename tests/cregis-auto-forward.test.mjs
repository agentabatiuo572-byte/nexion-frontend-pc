import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
function load(path,require){const c={exports:{},require};vm.runInNewContext(ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,c);return c.exports;}
const exceptions=load("lib/admin/cregis-exceptions.ts",()=>({}));
const contract=load("lib/admin/cregis-auto-forward.ts",()=>exceptions);
const routes=load("lib/admin/cregis-exception-routes.ts",()=>({}));
const status={runtimeApproved:false,collectionEnabled:false,paymentEnabled:false,executionEnabled:false,amountPolicy:"GROSS_COLLECTION_NET_PAYMENT_PLATFORM_GAS",platformAddress:"0x"+"a".repeat(40),counterpartyAddress:"0x"+"b".repeat(40),startEventId:null,makerId:null,version:0};
test("auto routes expose read/status and controlled policy/recovery only",()=>{
  assert.deepEqual(Array.from(routes.cregisExceptionRoute(["cregis","auto-forward","tasks"]).methods),["GET","HEAD"]);
  assert.deepEqual(Array.from(routes.cregisExceptionRoute(["cregis","auto-forward","tasks","123","recover"]).methods),["POST"]);
  for(const end of ["execute","send","collection","payout","tasks/1/send","tasks/bad/recover"])
    assert.equal(routes.cregisExceptionRoute(["cregis","auto-forward",...end.split("/")]),null);
});
test("inconsistent active status and unknown money policy are rejected",()=>{
  assert.equal(contract.autoForwardStatus(status).executionEnabled,false);
  const omitted={...status};delete omitted.makerId;delete omitted.startEventId;
  assert.equal(contract.autoForwardStatus(omitted).makerId,null);assert.equal(contract.autoForwardStatus(omitted).startEventId,null);
  for(const change of [{executionEnabled:true},{amountPolicy:"GROSS_PAYMENT"},{version:9007199254740992},{runtimeApproved:"false"}])assert.throws(()=>contract.autoForwardStatus({...status,...change}));
});
function harness({write=true,row,readFailure=false}={}){
  let auth={isAuthenticated:true,authEpoch:1,session:{adminId:7,authorities:["finance_d1_read",...(write?["finance_d1_channel_manage","finance_d2_withdrawal_approve"]:[])]}},lifecycle=1;
  const hook=Object.assign(fn=>fn(auth),{getState:()=>auth});
  let values=[status,{records:row?[row]:[],hasMore:false,nextBeforeId:null},false,false,{},false,false,""],refs=[],s=0,r=0;
  const confirmations=[],calls=[];
  const component=load("app/components/domain-views/d-tabs/cregis-auto-forward.tsx",name=>{
    if(name==="react")return {useCallback:fn=>fn,useEffect:()=>{},useRef:initial=>refs[r++]??(refs[r-1]={current:initial}),useState:initial=>{const i=s++;return[values[i]??initial,value=>{values[i]=typeof value==="function"?value(values[i]):value;}];}};
    if(name==="react/jsx-runtime")return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
    if(name.includes("store/admin-auth"))return {useAdminAuth:hook};
    if(name.includes("auth-lifecycle"))return {adminAuthLifecycleEpoch:()=>lifecycle,adminAuthActivityAllowed:()=>true};
    if(name.includes("cregis-auto-forward"))return contract;
    if(name.includes("cregis-exceptions"))return {...exceptions,exceptionRead:async()=>{if(readFailure)throw new Error("simulated read failure");return status;},exceptionList:async()=>({records:[],hasMore:false,nextBeforeId:null}),exceptionCommand:async(path,body,scope)=>{scope.assertOwner();calls.push({path,body});return {};}};
    return {};
  });
  const props={canManage:write,openActionConfirm:c=>confirmations.push(c)};
  const render=()=>{s=0;r=0;const wrapper=component.CregisAutoForward(props);return wrapper.type(wrapper.props);};
  function nodes(n,p,out=[]){if(!n||typeof n!=="object")return out;if(p(n))out.push(n);for(const child of [n.props?.children].flat(Infinity))nodes(child,p,out);return out;}
  const text=n=>typeof n==="string"?n:n?.props?[n.props.children].flat(Infinity).map(text).join(""):"";
  const button=name=>nodes(render(),n=>n.type==="button"&&text(n)===name)[0];
  return {render,nodes,text,button,confirmations,calls,changeOwner:()=>{auth={...auth,authEpoch:2,session:{...auth.session,adminId:8}};lifecycle++;}};
}
test("closed runtime disables activation and PAUSE only writes the control record",async()=>{
  const h=harness();assert.equal(h.button("提交自动流程开关提案").props.disabled,true);assert.match(h.text(h.render()),/运行总开关：关闭/);
  assert.match(h.text(h.render()),/暂无自动任务/);h.button("暂停自动归集及付款").props.onClick();await h.confirmations[0].run("测试暂停并核对所有发送开关保持关闭");
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,"/auto-forward/policy");assert.equal(h.calls[0].body.action,"PAUSE");
});
test("account changes invalidate a deferred financial control confirmation",async()=>{
  const h=harness();h.button("暂停自动归集及付款").props.onClick();h.changeOwner();
  await assert.rejects(()=>h.confirmations[0].run("当前会话已变化不能提交旧操作"),/身份或权限已变化/);assert.equal(h.calls.length,0);
});
test("accepted command followed by read failure cannot report completion or encourage resubmission",async()=>{
  const h=harness({readFailure:true});h.button("暂停自动归集及付款").props.onClick();
  await assert.rejects(()=>h.confirmations[0].run("测试保存成功后回读故障的提示行为"),/已提交，但页面没刷新出来。请不要重复提交/);
  assert.equal(h.calls.length,1);assert.match(h.text(h.render()),/已提交，但页面没刷新出来/);
});
test("unknown task cannot retry; readonly roles cannot change policy or recover",()=>{
  const row={id:"9007199254740993",eventId:"1",state:"PAYMENT_UNKNOWN",grossAmount:"999999999999.999999",netAmount:"999999999998.999999",feeAmount:"1.000000",paymentKey:"CA-P-42-1",version:0};
  const h=harness({row});assert.equal(h.button("申请重试明确拒绝任务"),undefined);assert.ok(h.button("核对原 CID"));assert.match(h.text(h.render()),/999999999998\.999999/);
  const readonly=harness({write:false,row});assert.equal(readonly.button("暂停自动归集及付款"),undefined);assert.equal(readonly.button("核对原 CID"),undefined);
});
