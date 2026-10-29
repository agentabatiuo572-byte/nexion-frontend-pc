import ts from "typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { harness, nodes, button } from "./support-bulk-preview-permission.test.mjs";
import { SupportClientError } from "../lib/admin/m-support-client.ts";
import { parseBulkCandidatePage } from "../lib/admin/m-support-enhancements.ts";

const fixtures = Array.from({length:23},(_,i)=>({id:String(i+1),expectedAssignmentId:String(100+i),nickname:`客户${i+1}`,userNo:`U${String(i+1).padStart(8,"0")}`,reason:null}));
const page = (rows,p=1,actorId=1) => ({actorId,pageNum:p,pageSize:10,total:rows.length,selectableCount:rows.filter(c=>!c.reason).length,records:rows.slice((p-1)*10,p*10),evaluatedAt:"2026-10-29T00:00:00Z"});
const preview = ids => ({selectionId:"frozen",actorId:1,count:ids.length,customers:ids.map(id=>fixtures.find(c=>c.id===id)),excluded:[],evaluatedAt:"2026-10-29T00:00:00Z",expiresAt:"2099-01-01T00:00:00Z"});
const rows = tree => nodes(tree).filter(n=>n.type==="input"&&n.props["aria-label"]?.startsWith("选择客户 "));
const text = tree => nodes(tree).flatMap(n=>typeof n.props.children==="string"?[n.props.children]:Array.isArray(n.props.children)?n.props.children.filter(c=>typeof c==="string"||typeof c==="number"):[]).join(" ").replace(/\s+/g," ");
const click = (h,label) => { const b=button(h.render(),label);assert.ok(b,label);assert.equal(Boolean(b.props.disabled),false,label);b.props.onClick();return h.render(); };
const select = (h,id,checked=true) => {const row=rows(h.render()).find(n=>n.props["aria-label"]===`选择客户 ${id}`);assert.ok(row);assert.equal(Boolean(row.props.disabled),false);row.props.onChange({target:{checked}});return h.render();};
const search = async (h,keyword) => {nodes(h.render()).find(n=>n.props["aria-label"]==="搜索昵称、手机号或用户编号").props.onChange({target:{value:keyword}});h.render();click(h,"查询筛选结果");return h.settle();};

// Actual component with isolated transport fixtures: never touches a session, customer or send endpoint.
test("23 candidates load 10/10/3 server pages; checks survive paging/search and freeze complete IDs without keyword",async()=>{
  const queries={"客户12":[fixtures[11]],"1777":[fixtures[0]],"00000001":[fixtures[0]],"missing":[]};
  const h=harness(null,async input=>preview(input.customerIds),null,[],{candidates:async(f,p)=>page(queries[f.keyword]??fixtures,p)});
  try{
    h.render();await h.settle();assert.equal(rows(h.render()).length,10);assert.equal(h.previews.length,0);assert.equal(h.profileCalls.length,10);select(h,"1");
    click(h,"下一页");await h.settle();assert.equal(rows(h.render()).length,10);assert.equal(h.candidates.at(-1).pageNum,2);select(h,"12");click(h,"下一页");await h.settle();assert.equal(rows(h.render()).length,3);assert.equal(button(h.render(),"下一页").props.disabled,true);
    click(h,"上一页");await h.settle();click(h,"上一页");await h.settle();assert.equal(rows(h.render())[0].props.checked,true);select(h,"1",false);select(h,"1");
    for(const keyword of ["客户12","1777","00000001"]){await search(h,keyword);assert.equal(h.candidates.at(-1).pageNum,1);assert.equal(h.candidates.at(-1).filters.keyword,keyword);assert.equal(rows(h.render())[0].props.checked,true);assert.match(text(h.render()),/已选 2 位/);}
    await search(h,"missing");assert.equal(rows(h.render()).length,0);assert.match(text(h.render()),/没有匹配/);assert.match(text(h.render()),/已选 2 位/);assert.ok(nodes(h.render()).find(n=>n.props["aria-label"]==="移除已选客户 1"));
    await search(h,"");assert.equal(rows(h.render()).length,10);await search(h,"客户12");const profilesBefore=h.profileCalls.length;click(h,"下一步：编写内容");await h.settle();assert.match(text(h.render()),/第 2 步/);assert.deepEqual([...h.previews[0].input.customerIds].sort((a,b)=>Number(a)-Number(b)),["1","12"]);assert.equal(h.previews[0].input.filters.keyword,undefined);assert.equal(h.previews[0].input.selectionMode,"CROSS_PAGE");assert.equal(h.profileCalls.length,profilesBefore,"freeze does not load every selected profile");
    click(h,"上一步");assert.equal(rows(h.render())[0].props.checked,true);assert.match(text(h.render()),/已选 2 位/);nodes(h.render()).find(n=>n.props["aria-label"]==="移除已选客户 1").props.onClick();h.render();assert.match(text(h.render()),/已选 1 位/);click(h,"清空选择");assert.match(text(h.render()),/已选 0 位/);
  }finally{h.unmount();}
});

test("explicit all unions previous search selection and retains non-search business filters for freeze",async()=>{
  const h=harness(null,async input=>preview(input.selectionMode==="ALL_FILTERED"?["12","13"]:input.customerIds),null,[],{candidates:async(f,p)=>page(f.keyword?[fixtures[11],fixtures[12]]:fixtures,p)});
  try{h.render();await h.settle();select(h,"1");await search(h,"客户1");const maintenance=nodes(h.render()).find(n=>n.type==="select"&&n.props.children?.some?.(c=>c.props?.value==="STOPPED"));maintenance.props.onChange({target:{value:"ENABLED"}});h.render();click(h,"查询筛选结果");await h.settle();assert.equal(h.previews.length,0);click(h,"选择当前全部筛选结果");await h.settle();assert.equal(h.previews.length,1);assert.equal(h.previews[0].input.selectionMode,"ALL_FILTERED");assert.equal(h.previews[0].input.filters.keyword,"客户1");assert.match(text(h.render()),/已选 3 位/);click(h,"下一步：编写内容");await h.settle();assert.deepEqual([...h.previews.at(-1).input.customerIds],["1","12","13"]);assert.equal(h.previews.at(-1).input.filters.maintenanceState,"ENABLED");assert.equal(h.previews.at(-1).input.filters.keyword,undefined);}finally{h.unmount();}
});

test("failed list retains selected IDs, retries the page, and ignores late prior query or closed component",async()=>{
  let fail=false,resolveOld;const h=harness(null,async input=>preview(input.customerIds),null,[],{candidates:(f,p)=>f.keyword==="old"?new Promise(resolve=>resolveOld=resolve):fail?Promise.reject(new Error("network")):Promise.resolve(page(f.keyword?[fixtures[11]]:fixtures,p))});
  try{h.render();await h.settle();select(h,"1");fail=true;await search(h,"fail");assert.match(text(h.render()),/已选 1 位/);assert.ok(button(h.render(),"重新加载名单"));fail=false;click(h,"重新加载名单");await h.settle();assert.equal(rows(h.render()).length,1);await search(h,"old");const oldRequest=h.candidates.at(-1);await search(h,"new");assert.equal(oldRequest.signal.aborted,true);resolveOld(page([fixtures[4]]));await h.settle();assert.equal(rows(h.render())[0].props["aria-label"],"选择客户 12");await search(h,"old");h.unmount();assert.equal(h.candidates.at(-1).signal.aborted,true);resolveOld(page([fixtures[4]]));await new Promise(r=>setImmediate(r));}finally{h.unmount();}
});

test("identity, permission epoch and scope invalidation clear private selections; late old actor page is ignored",async()=>{
  let resolveOld,actor=1;const h=harness(null,async input=>preview(input.customerIds),null,[],{candidates:(f,p)=>f.keyword==="old"?new Promise(resolve=>resolveOld=resolve):Promise.resolve(page(actor===1?fixtures:[{...fixtures[22],nickname:"新身份客户"}],p,actor))});
  try{h.render();await h.settle();select(h,"1");await search(h,"old");actor=2;h.setAuth({session:{adminId:2,role:"support",authorities:["service_m3_write"]},authEpoch:2});h.render();await h.settle();resolveOld(page([fixtures[0]]));await h.settle();assert.match(text(h.render()),/已选 0 位/);assert.equal(rows(h.render())[0].props["aria-label"],"选择客户 23");assert.ok(!nodes(h.render()).some(n=>n.props["aria-label"]==="移除已选客户 1"));select(h,"23");h.setAuth({session:{adminId:2,role:"support",authorities:[]},authEpoch:3});h.render();await h.settle();assert.match(text(h.render()),/已选 0 位/);select(h,"23");h.invalidate();h.render();assert.match(text(h.render()),/已选 0 位/);}finally{h.unmount();}
});

test("page parser rejects malformed scope/pagination/duplicates, preserves canonical numbers and denied rows",()=>{
  const valid=page(fixtures);assert.equal(parseBulkCandidatePage(valid).records[0].userNo,"U00000001");assert.equal(parseBulkCandidatePage({...page([fixtures[0]]),records:[{...fixtures[0],reason:"STOPPED"}],selectableCount:0}).records[0].reason,"STOPPED");
  for(const change of [{pageNum:0},{pageSize:20},{total:9},{selectableCount:24},{records:[...valid.records.slice(0,9),valid.records[0]]},{actorId:0},{records:[{...fixtures[0],reason:undefined}]},{records:[{...fixtures[0],userNo:""}]}])assert.throws(()=>parseBulkCandidatePage({...valid,...change}));
  assert.equal(parseBulkCandidatePage(page(fixtures,4)).records.length,0);
});


test("all 23 selected identities are available without browsing or loading every profile",async()=>{
 const h=harness(null,async input=>preview(input.selectionMode==="ALL_FILTERED"?fixtures.map(c=>c.id):input.customerIds),null,[],{candidates:async(f,p)=>page(fixtures,p)});
 try{h.render();await h.settle();click(h,"选择当前全部筛选结果");await h.settle();assert.equal(h.profileCalls.length,10);assert.match(text(h.render()),/U00000023/);assert.match(text(h.render()),/已选 23 位/);click(h,"下一步：编写内容");await h.settle();assert.equal(h.profileCalls.length,10);assert.equal(h.previews.at(-1).input.customerIds.length,23);const area=nodes(h.render()).find(n=>n.props["aria-label"]==="群发文案");area.props.onChange({target:{value:"隔离验证内容"}});h.render();click(h,"下一步：确认名单");assert.match(text(h.render()),/U00000023/);assert.doesNotMatch(text(h.render()),/编码未知/);click(h,"上一步");assert.equal(nodes(h.render()).find(n=>n.props["aria-label"]==="群发文案").props.value,"隔离验证内容");}finally{h.unmount();}
});

test("late all/freeze responses after identity change cannot restore an old selection",async()=>{
 for(const mode of ["ALL_FILTERED","CROSS_PAGE"]){let resolve;let actor=1;const h=harness(null,()=>new Promise(done=>resolve=done),null,[],{candidates:async(f,p)=>page(actor===1?fixtures:[fixtures[22]],p,actor)});try{h.render();await h.settle();select(h,"1");click(h,mode==="ALL_FILTERED"?"选择当前全部筛选结果":"下一步：编写内容");actor=2;h.setAuth({session:{adminId:2,role:"support",authorities:["service_m3_write"]},authEpoch:2});h.render();await h.settle();resolve(preview(["1"]));await h.settle();assert.match(text(h.render()),/已选 0 位/);assert.match(text(h.render()),/第 1 步/);assert.equal(button(h.render(),"下一步：编写内容").props.disabled,true);}finally{h.unmount();}}
});

test("wrong actor candidate response clears selection and blocks private list rather than showing foreign names",async()=>{
 let actor=1;const h=harness(null,null,null,[],{candidates:async(f,p)=>page([{...fixtures[0],nickname:"FOREIGN_PRIVATE"}],p,actor)});try{h.render();await h.settle();select(h,"1");actor=2;click(h,"查询筛选结果");await h.settle();assert.equal(rows(h.render()).length,0);assert.match(text(h.render()),/已选 0 位/);assert.doesNotMatch(text(h.render()),/FOREIGN_PRIVATE/);assert.equal(button(h.render(),"查询筛选结果").props.disabled,true);}finally{h.unmount();}
});

test("successful total shrink clamps page and retries the last real page",async()=>{
 let remaining=fixtures;const h=harness(null,null,null,[],{candidates:async(f,p)=>page(remaining,p)});try{h.render();await h.settle();click(h,"下一页");await h.settle();remaining=fixtures.slice(0,3);click(h,"下一页");await h.settle();await h.settle();assert.equal(h.candidates.at(-1).pageNum,1);assert.equal(rows(h.render()).length,3);assert.equal(button(h.render(),"上一页").props.disabled,true);}finally{h.unmount();}
});

test("strict TS checks actual composer and candidate parser against installed modules without stale Next cache roots",()=>{
 const root=fileURLToPath(new URL("../",import.meta.url)),config=ts.readConfigFile(path.join(root,"tsconfig.json"),ts.sys.readFile),options={...ts.parseJsonConfigFileContent(config.config,ts.sys,root).options,incremental:false,noEmit:true,baseUrl:root,paths:{"@/*":["./*"]}};
 const program=ts.createProgram([path.join(root,"app/components/domain-views/m-tabs/support-bulk-composer.tsx"),path.join(root,"lib/admin/m-support-enhancements.ts"),path.join(root,"node_modules/next/types/global.d.ts")],options),diagnostics=ts.getPreEmitDiagnostics(program);
 assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>root,getCanonicalFileName:x=>x,getNewLine:()=>"\n"}));
});

test("explicit write revocation clears old private names and chosen IDs",async()=>{let deny=false;const h=harness(null,null,null,[],{candidates:async(f,p)=>{if(deny)throw new SupportClientError(403,403,"SUPPORT_WRITE_FORBIDDEN");return page(fixtures,p);}});try{h.render();await h.settle();select(h,"1");deny=true;click(h,"查询筛选结果");await h.settle();assert.match(text(h.render()),/已选 0 位/);assert.match(text(h.render()),/权限已失效/);assert.equal(rows(h.render()).length,0);assert.equal(button(h.render(),"下一步：编写内容").props.disabled,true);assert.equal(Boolean(button(h.render(),"重新加载名单")),false);}finally{h.unmount();}});

test("paging immediately hides the previous page before the new response arrives",async()=>{let resolve;const h=harness(null,null,null,[],{candidates:(f,p)=>p===1?Promise.resolve(page(fixtures,p)):new Promise(done=>resolve=done)});try{h.render();await h.settle();assert.equal(rows(h.render()).length,10);button(h.render(),"下一页").props.onClick();const immediate=h.renderFrame();assert.equal(rows(immediate).length,0);assert.match(text(immediate),/正在加载名单/);resolve(page(fixtures,2));await h.settle();assert.equal(rows(h.render())[0].props["aria-label"],"选择客户 11");}finally{h.unmount();}});
