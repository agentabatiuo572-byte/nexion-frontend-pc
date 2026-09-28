/** Actual components and HTTP clients, isolated disk-backed fixture; not live A2/DB acceptance. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import ts from "typescript";
import { chromium, expect } from "@playwright/test";

const root = process.cwd().replaceAll("\\","/");
const artifacts = path.join(root,".verify-cache/phone-calibration-runtime");
fs.mkdirSync(artifacts,{recursive:true});
const storage = path.join(artifacts,"fixture.json");
const empty = {policy:{revision:0,current:null,scheduled:null},pendingHardware:[],computeUnit:"platform"};
fs.writeFileSync(storage,JSON.stringify(empty));
const read = () => JSON.parse(fs.readFileSync(storage,"utf8"));
let failRead = false, failPreview = false;
const writes = [], errors = [];
const server = await createServer({configFile:false,root,appType:"custom",logLevel:"error",esbuild:{jsx:"automatic"},
  optimizeDeps:{force:true,include:["react","react-dom/client","react/jsx-runtime","zustand","zustand/middleware"]},
  css:{postcss:{plugins:[]}},server:{host:"127.0.0.1",port:0},
  resolve:{dedupe:["react","react-dom"],alias:[{find:"next/link",replacement:"/__phone-link.jsx"},{find:"next/navigation",replacement:"/__phone-navigation.js"},{find:"@",replacement:root}]},
  plugins:[{name:"phone-policy-runtime",resolveId(id){if(["/__phone-link.jsx","/__phone-navigation.js","/__phone-policy.tsx"].includes(id))return `\0${id}`;},
    transform(code,id){if(id.startsWith("\0/")&&/\.[jt]sx$/.test(id))return ts.transpileModule(code,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;},
    load(id){
      if(id==="\0/__phone-link.jsx")return "export default function Link({prefetch,...props}){return <a {...props}/>;}";
      if(id==="\0/__phone-navigation.js")return "export const useRouter=()=>({push(){}});";
      if(id==="\0/__phone-policy.tsx")return `import React from 'react';import {createRoot} from 'react-dom/client';
        import '${root}/app/globals.css';import '${root}/app/components/domain-views/e-domain.css';
        import {PhoneCalibrationPanel} from '${root}/app/components/domain-views/e-tabs/phone-calibration-panel.tsx';
        import {PhoneCalibrationReview} from '${root}/app/components/domain-views/e-tabs/phone-calibration-review.tsx';
        import {fetchA2Overview} from '${root}/lib/admin/a2-client.ts';
        const params=new URLSearchParams(location.search);
        const rootView=createRoot(document.getElementById('root'));
        if(params.has('a2'))fetchA2Overview().then(data=>rootView.render(<PhoneCalibrationReview proposal={data.operationQueue[0].phoneCalibrationProposal}/>));
        else rootView.render(<main className="dkpage edom" style={{padding:24}}><PhoneCalibrationPanel thresholdsOnly={params.has('e2')} ctx={{canWriteE6:!params.has('readonly'),toast:()=>{}}}/></main>);`;
    },
    configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
      const reply=data=>{res.setHeader("Content-Type","application/json");res.end(JSON.stringify(data));};
      if(req.url==="/api/admin/platform/audit/reason-policy")return reply({code:0,data:{minChars:8,maxChars:200,sourceKey:"admin.a2.reason_min_chars"}});
      if(req.url==="/api/admin/platform/audit/overview")return reply({code:0,data:{operationQueue:writes.map(input=>({...input,id:"fixture-proposal-1",status:"pending",phoneCalibrationProposal:JSON.stringify(input.command.params)}))}});
      if(req.url==="/api/admin/config/phone-calibration")return reply(failRead?{code:1,message:"配置读取失败"}:{code:0,data:read()});
      if(req.url==="/api/admin/config/phone-calibration/preview"){
        let raw="";for await(const chunk of req)raw+=chunk;const {proposal}=JSON.parse(raw);
        if(failPreview){failPreview=false;return reply({code:1,message:"试算服务暂不可用"});}
        return reply({code:0,data:{expectedRevision:proposal.expectedRevision,match:{status:"MATCHED",ruleId:"fixture",computeValue:24.3,tier:2,ruleVersion:1},impact:{matched:1,changed:1,pending:0,appliesTo:"NEXT_CALIBRATION",historicalSettlementChanged:false}}});
      }
      if(req.url==="/api/admin/platform/audit/operations"&&req.method==="POST"){
        let raw="";for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);
        assert.equal(input.command.op,"e6_phone_calibration");assert.equal(input.target.type,"phone_calibration_policy");
        assert.ok(input.reason.length>=8);assert.ok(req.headers["idempotency-key"]);
        writes.push({...input,commandKey:req.headers["idempotency-key"]});
        return reply({code:0,data:{...input,id:"fixture-proposal-1",status:"pending",phoneCalibrationProposal:JSON.stringify(input.command.params)}});
      }
      if(req.url.startsWith("/fixture")||req.url.startsWith("/devices/compute-config")){
        res.setHeader("Content-Type","text/html");return res.end('<!doctype html><html lang="zh-CN"><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/__phone-policy.tsx"></script></body></html>');
      }
      next();
    });},
  }],
});
let browser;
try{
  await server.listen();const base=`http://127.0.0.1:${server.httpServer.address().port}/fixture`;
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/*",route=>new URL(route.request().url()).hostname==="127.0.0.1"?route.continue():route.abort());
  await page.goto(base);await expect(page.getByText("尚未发布",{exact:false})).toBeVisible();
  const publish=page.getByRole("button",{name:"提交 A2 审批",exact:true});
  await expect(publish).toBeDisabled();
  for(const [i,value] of ["19","25","35","47"].entries())await page.getByLabel(`T${i+1} / T${i+2} 分界`,{exact:true}).fill(value);
  await page.getByRole("button",{name:"添加硬件规则"}).click();
  for(const [label,value]of Object.entries({"规则编号":"fixture","精确机型（留空匹配该芯片）":"Test phone","SoC":"Test SoC","GPU":"Test GPU","核验依据":"Test fixture only","内存下限 GB（含）":"6","内存上限 GB（不含）":"9","平台算力值":"24.3"}))await page.getByLabel(label,{exact:true}).fill(value);
  const preview=page.getByRole("button",{name:"试算并预览影响"});
  failPreview=true;await preview.click();await expect(page.getByRole("alert")).toContainText("试算服务暂不可用");
  await expect(page.getByLabel("平台算力值",{exact:true})).toHaveValue("24.3");
  await preview.click();await expect(publish).toBeEnabled();
  await page.getByLabel("T1 / T2 分界",{exact:true}).fill("20");await expect(publish).toBeDisabled();
  await preview.click();await publish.click();await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button",{name:"取消",exact:true}).click();assert.equal(writes.length,0);
  await publish.click();await page.getByRole("textbox",{name:/操作理由/}).fill("手机规则测试审批理由");
  await page.getByRole("button",{name:"确认提交",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.equal(writes.length,1);assert.equal(read().policy.revision,0);
  // The fixture reviewer decision is explicit; only frontend proposal/readback behavior is asserted here.
  const proposal=writes[0].command.params;
  await page.goto(base+"?a2=1");
  await expect(page.getByRole("region",{name:"待发布的手机算力规则"})).toContainText("Test fixture only");
  await expect(page.getByRole("table")).toContainText("24.3");
  await expect(page.getByText(/T1–T5 分界/)).toContainText("20 / 25 / 35 / 47");
  await expect(page.getByText(/基于版本/)).toContainText("审批通过后立即生效");
  await page.goto(base);
  fs.writeFileSync(storage,JSON.stringify({...empty,policy:{revision:1,current:{version:1,effectiveAt:Date.now(),thresholds:proposal.thresholds,rules:proposal.rules},scheduled:null}}));
  await page.reload();await expect(page.getByLabel("T1 / T2 分界",{exact:true})).toHaveValue("20");
  const screenshots=[];
  for(const theme of ["light","dark"]){await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);const file=path.join(artifacts,`rules-${theme}.png`);await page.screenshot({path:file,fullPage:true});screenshots.push(file);}
  await page.goto(base+"?e2=1");await expect(page.getByLabel("T1 / T2 分界",{exact:true})).toHaveValue("20");await expect(page.getByRole("button",{name:"添加硬件规则"})).toHaveCount(0);
  await page.goto(base+"?readonly=1");await expect(page.getByLabel("T1 / T2 分界",{exact:true})).toBeDisabled();await expect(publish).toBeDisabled();
  failRead=true;await page.goto(base);await expect(page.getByRole("alert")).toContainText("配置读取失败");
  failRead=false;await page.getByRole("button",{name:"重新读取配置"}).click();await expect(page.getByLabel("T1 / T2 分界",{exact:true})).toHaveValue("20");
  const stored=read();stored.policy.revision=2;stored.policy.scheduled={...stored.policy.current,version:2,effectiveAt:Date.now()+60000};fs.writeFileSync(storage,JSON.stringify(stored));
  await page.reload();await expect(page.getByLabel("T1 / T2 分界",{exact:true})).toBeDisabled();await expect(page.getByText("已有待生效版本",{exact:false})).toBeVisible();
  assert.deepEqual(errors,[]);const timestamp=new Date().toISOString();
  fs.writeFileSync(path.join(root,".verify-cache/phone-calibration-runtime.json"),JSON.stringify({taskId:process.env.WORKFLOW_TASK_ID??"standalone-debug",stepId:process.env.WORKFLOW_STEP_ID??"admin",checkId:process.env.WORKFLOW_CHECK_ID??"browser",runId:process.env.WORKFLOW_RUN_ID??"standalone-debug",repo:process.env.WORKFLOW_REPO??root,snapshotHash:process.env.WORKFLOW_SNAPSHOT_HASH??"standalone-debug",at:timestamp,timestamp,mode:"full",verdict:"pass",treeMoved:false,capability:"runtime",steps:[{id:"admin-ui",status:"pass",verdict:"pass",innerSkipped:0,evidence:["Actual PhoneCalibrationPanel, OperationConfirmModal, phone HTTP client and A2 proposal client; isolated disk-backed localhost fixture, not live A2/DB acceptance","Empty/invalid configuration, create rule, preview failure/retry, edit invalidates preview, cancellation, A2 proposal without premature activation, simulated reviewer decision then refresh/reload persistence, E2 thresholds, read-only permission, read failure/recovery and scheduled-version lock",...screenshots]}]},null,2));
  console.log("PASS phone calibration component runtime; frontend fixture only, no live A2/DB claim.");
}finally{await browser?.close();await server.close();}
