/** Real E6/modal/client component fixture; local HTTP storage, not production A2/DB acceptance. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import ts from "typescript";
import { chromium, expect } from "@playwright/test";

const root = process.cwd().replaceAll("\\", "/");
const artifacts = path.join(root, ".verify-cache", "phone-binding-runtime");
fs.mkdirSync(artifacts, { recursive: true });
const storage = path.join(artifacts, "fixture-storage.json");
const config = {
  domain: "E6", phoneBinding: { available:true, allowReplacement: false, minReplacementIntervalDays: 7, replacementWindowDays:30, maxReplacementsInWindow:2, policyVersion:1 },
  flags: [{ key: "computeShareEnabled", label: "电脑共享", desc: "", enabled: false, frontendEffect: "" }],
  coefficients: ["h5BaseFactor", "continuityFullHours"].map(key => ({ key, label: key, value: "24", unit: "", desc: "", frontendEffect: "" })),
  yieldEstimate: ["topsBaseline", "dailyUsdtPerBaseline", "nexPerUsdt"].map(key => ({ key, label: key, value: "1", unit: "" })),
  gpuTiers: Array.from({ length: 6 }, (_, i) => ({ id: `G${i + 1}`, label: `显卡${i + 1}`, desc: "", defaultModel: "", tops: "1", keywords: [] })),
  download: { url: "", zhTitle: "", zhGuide: "", enTitle: "", enGuide: "" }, sources: ["isolated-http-fixture"],
};
fs.writeFileSync(storage, JSON.stringify(config));
let readMode = "valid", writeMode = "valid", reads = 0;
const tickets=[];
const writes = [];
const readStored = () => JSON.parse(fs.readFileSync(storage, "utf8"));
const server = await createServer({ configFile: false, root, appType: "custom", logLevel: "error", esbuild: { jsx: "automatic" },
  css: { postcss: { plugins: [] } }, server: { host: "127.0.0.1", port: 0 },
  resolve: { alias: [{ find: "next/link", replacement: "/__fixture-link.jsx" }, { find: "next/navigation", replacement: "/__fixture-navigation.js" }, { find: "@", replacement: root }] },
  plugins: [{ name: "e6-phone-component-fixture", resolveId(id) { if (["/__fixture-link.jsx", "/__fixture-navigation.js", "/__phone-fixture.tsx"].includes(id)) return `\0${id}`; },
    transform(code, id) { if (id.startsWith("\0/") && /\.[jt]sx$/.test(id)) return ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, fileName: id.slice(1) }).outputText; },
    load(id) {
      if (id === "\0/__fixture-link.jsx") return "export default function Link({prefetch,...p}){return <a {...p}/>;}";
      if (id === "\0/__fixture-navigation.js") return "export const useRouter=()=>({push(){}});";
      if (id === "\0/__phone-fixture.tsx") return `
        import React,{useState,useEffect} from 'react'; import {createRoot} from 'react-dom/client';
        import '${root}/app/globals.css'; import '${root}/app/components/domain-views/e-domain.css';
        import {E6ComputeConfig} from '${root}/app/components/domain-views/e-tabs/e6-compute-config.tsx';
        import {PlatformParamsRegistry} from '${root}/app/_console/platform/params-registry/params-registry-client.tsx';
        import {OperationConfirmModal} from '${root}/app/components/domain-views/design-kit.tsx';
        import {useAdminAuth} from '${root}/lib/store/admin-auth.ts';
        import {fetchE6ComputeConfig,updateE6Param} from '${root}/lib/admin/e6-client.ts';
        const permissions=new URLSearchParams(location.search);
        useAdminAuth.getState().signIn({tokenType:"Bearer",session:{adminId:71,username:"fixture",operator:"fixture",role:"super",authorities:["device_e6_read","platform_a2_read","platform_a5_read",...(permissions.get("write")==="0"?[]:["device_e6_write"]),...(permissions.get("toggle")==="0"?[]:["device_e6_flag_toggle"])]}});
        function Fixture(){const [cfg,setCfg]=useState(null),[error,setError]=useState(null),[loading,setLoading]=useState(true),[action,setAction]=useState(null);
          async function refresh(){setLoading(true);try{setCfg(await fetchE6ComputeConfig());setError(null);}catch(e){setError(e.message);}finally{setLoading(false);}}
          useEffect(()=>{void refresh();},[]);
          return <main className="dkpage edom" style={{padding:24}}><E6ComputeConfig ctx={{e6Config:cfg,e6Error:error,e6Loading:loading,refreshE6:refresh,canWriteE6:permissions.get('write')!=='0',canToggleE6:permissions.get('toggle')!=='0',openActionConfirm:setAction}}/>
            {action&&<OperationConfirmModal action={action.name} detail={action.detail} edit={action.edit} reasonMax={200} onClose={()=>setAction(null)} onConfirm={async(reason,value)=>{await updateE6Param(action.paramKey,action.fixedVal??value,reason,'isolated-fixture');await refresh();setAction(null);}}/>}</main>;
        } createRoot(document.getElementById('root')).render(permissions.has('a5')?<PlatformParamsRegistry/>:<Fixture/>);`;
    }, configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      const reply = value => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
      if (req.url === "/api/admin/platform/params-registry") {
        const stored = readStored(), observedAt = new Date().toISOString();
        const rows = [
          ["E.compute.h5BaseFactor", "历史 H5 基础系数", "24"],
          ["E.compute.phoneBinding.allowReplacement", "允许更换绑定手机", stored.phoneBinding.allowReplacement ? "on" : "off"],
          ["E.compute.phoneBinding.minReplacementIntervalDays", "换机最短间隔", String(stored.phoneBinding.minReplacementIntervalDays)],
        ].map(([canonicalKey, displayName, currentValue]) => ({ canonicalKey, displayName, currentValue,
          description: "隔离组件夹具配置", domain: "E", domainLabel: "设备", ownerCode: "E6", ownerLabel: "E6 算力与设备配置",
          ownerRoute: "/devices/compute-config", valueType: "配置", unit: "", source: "fixture", sourceStatus: "READY", updatedAt: observedAt,
          operationConfirm: true, serverCanonical: true,
        }));
        return reply({ code: 0, data: { rows, observedAt, stats: { registeredCount: 3, domainCount: 1, highSensitivityCount: 3, sourceCount: 1 }, sources: [{ key: "fixture", label: "组件夹具", status: "READY", rowCount: 3, detail: "隔离 HTTP 配置" }] } });
      }
      if (req.url === "/api/admin/platform/audit/reason-policy") return reply({ code: 0, data: { minChars: 8, maxChars: 200, sourceKey: "admin.a2.reason_min_chars" } });
      if (req.url === "/api/admin/devices/compute-config") {
        reads++;
        if (readMode === "error") return reply({ code: 1, message: "配置读取暂不可用" });
        const data = readStored();
        if (readMode === "missing") delete data.phoneBinding;
        if (readMode === "invalid") data.phoneBinding.minReplacementIntervalDays = -0.5;
        return reply({ code: 0, data });
      }
      if (req.url === "/api/admin/config/phone-calibration") return reply({code:0,data:{policy:{revision:0,current:null,scheduled:null},pendingHardware:[],computeUnit:"platform"}});
      if (req.url.startsWith("/api/admin/platform/audit/operations/proposals/by-idempotency-key?")) {
        const key=new URL(req.url,"http://fixture").searchParams.get("idempotencyKey");
        const ticket=tickets.find(t=>t.key===key);
        return reply(ticket?{code:0,data:ticket}:{code:404,message:"OPERATION_RESULT_UNKNOWN",data:null});
      }
      if (req.url === "/api/admin/platform/audit/operations" && req.method === "POST") {
        let raw="";for await (const chunk of req) raw+=chunk;const input=JSON.parse(raw);
        const key=req.headers["idempotency-key"];writes.push({key,...input});
        assert.ok(key);assert.equal(Object.keys(input.command.params.values).length,4);assert.equal(input.command.params.expectedPolicyVersion,readStored().phoneBinding.policyVersion);
        assert.ok(input.reason.length>=8);assert.equal(input.command.op,"e6_compute_config_batch");
        if(writeMode==="rejected") {writeMode="valid";return reply({code:409,message:"POLICY_VERSION_CHANGED",data:{conflictType:"POLICY_VERSION_CHANGED",reason:"策略已更新，请刷新并重新确认。"}});}
        const ticket={id:`A2-${tickets.length+1}`,key,...input,status:"pending",ts:new Date().toISOString()};tickets.push(ticket);
        if(writeMode==="unknown") {writeMode="valid";return reply({code:503,message:"UPSTREAM_OUTCOME_UNKNOWN",data:null});}
        return reply({code:0,data:ticket});
      }
      if (req.url.startsWith("/api/admin/platform/audit/overview")) return reply({code:0,data:{operationQueue:tickets.filter(t=>t.status==="pending"),operationHistory:tickets.filter(t=>t.status!=="pending").map(t=>({id:t.id,st:t.status})),recentLogs:tickets.map(t=>({id:t.id,resourceId:t.id,createdAt:t.ts,detailJson:JSON.stringify({idempotencyKey:t.key,sourceDomain:"E"})}))}});
      if (req.url.startsWith("/fixture") || req.url === "/devices/compute-config") { res.setHeader("Content-Type", "text/html"); return res.end('<!doctype html><html lang="zh-CN"><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/__phone-fixture.tsx"></script></body></html>'); }
      next();
    }); },
  }],
});
let browser;
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}/fixture`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], external = [];
  await page.route("**/*", route => { const url = new URL(route.request().url()); if (!["127.0.0.1", "localhost"].includes(url.hostname) && url.protocol !== "data:") { external.push(url.href); return route.abort(); } return route.continue(); });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const phone = page.locator('[data-proof="e6-phone-binding"]');
  const allow=phone.getByLabel("允许更换绑定手机",{exact:true});
  const interval=phone.getByLabel("换机最短间隔（天，0 表示不限）",{exact:true});
  const windowDays=phone.getByLabel("滚动窗口（1–365 天）",{exact:true});
  const limit=phone.getByLabel("窗口内最多更换（1–100 次）",{exact:true});
  const preview=phone.getByRole("button",{name:"预览并确认策略变更"});
  const submit=phone.getByRole("button",{name:"提交审批",exact:true});
  const reason=phone.getByLabel("变更理由（8–200 字）",{exact:true});
  async function confirm() {await preview.click();await reason.fill("已核实四项手机换机策略");await phone.getByLabel("我已核对四项前后值，确认提交给另一位审批人").check();}
  function approveLatest() {
    const ticket=tickets.at(-1), values=ticket.command.params.values,data=readStored();
    for(const field of ["allowReplacement","minReplacementIntervalDays","replacementWindowDays","maxReplacementsInWindow"])data.phoneBinding[field]=field==="allowReplacement"?values[`E.compute.phoneBinding.${field}`]==="on":Number(values[`E.compute.phoneBinding.${field}`]);
    data.phoneBinding.policyVersion++;fs.writeFileSync(storage,JSON.stringify(data));ticket.status="approved";
  }
  await page.goto(base);await expect(allow).not.toBeChecked();await expect(interval).toHaveValue("7");
  await expect(page.locator('[data-proof="e6-coeff-h5BaseFactor"]')).toHaveCount(0);
  await expect(page.locator('[data-proof="e6-flag-toggle"]')).toBeDisabled();
  await interval.fill("0");await preview.click();await expect(submit).toBeDisabled();await phone.getByRole("button",{name:"取消",exact:true}).click();assert.equal(writes.length,0);
  for(const invalid of ["-1","0.5","9007199254740992"]) {await interval.fill(invalid);await expect(preview).toBeDisabled();}
  await interval.fill("0");await windowDays.fill("365");await limit.fill("100");await confirm();writeMode="rejected";await submit.click();
  await expect(phone.getByRole("alert")).toContainText("策略已更新");await expect(interval).toHaveValue("0");assert.equal(readStored().phoneBinding.minReplacementIntervalDays,7);
  await confirm();await expect(reason).toHaveValue("已核实四项手机换机策略");writeMode="unknown";await submit.click();
  await expect(phone).toContainText("原请求已保留");assert.equal(readStored().phoneBinding.policyVersion,1);
  const postCount=writes.length;await page.reload();await expect(phone).toContainText("原审批提案");await expect(preview).toBeDisabled();
  await phone.getByRole("button",{name:"只读查询审批结果"}).click();await expect(phone).toContainText(tickets.at(-1).id);assert.equal(writes.length,postCount);
  approveLatest();await phone.getByRole("button",{name:"只读查询审批结果"}).click();await expect(phone).toContainText("原提案已获批准");
  await phone.getByRole("button",{name:"原提案已结束，准备新变更"}).click();await expect(phone).toContainText("当前策略版本：2");await expect(interval).toHaveValue("0");await expect(windowDays).toHaveValue("365");await expect(limit).toHaveValue("100");
  await page.reload();await expect(interval).toHaveValue("0");await expect(allow).not.toBeChecked();assert.equal(writes.length,postCount);
  const screenshots = [];
  for (const theme of ["light", "dark"]) { await page.evaluate(t => document.documentElement.dataset.theme = t, theme); const file = path.join(artifacts, `e6-phone-${theme}.png`); await phone.screenshot({ path: file }); screenshots.push(file); }
  for(const query of ["?write=0&toggle=0","?write=1&toggle=0","?write=0&toggle=1"]) {
    await page.goto(base+query);await expect(phone).toBeVisible();await expect(preview).toBeDisabled();await expect(interval).toBeDisabled();
  }
  for(const mode of ["missing","invalid","error"]) {readMode=mode;await page.goto(base);await expect(phone).toContainText("策略读取失败");await expect(preview).toHaveCount(0);}
  readMode="valid";await phone.getByRole("button",{name:"重新读取当前策略"}).click();await expect(phone).toContainText("当前策略版本：2");
  await page.goto(base+"?a5=1");const retired=page.locator("article").filter({hasText:"E.compute.h5BaseFactor"});await expect(retired).toContainText("历史配置 · 已退役（只读）");await expect(retired.locator("a,button,input")).toHaveCount(0);
  for(const key of ["allowReplacement","minReplacementIntervalDays"]) {const current=page.locator("article").filter({hasText:`E.compute.phoneBinding.${key}`});await expect(current.getByRole("link")).toHaveAttribute("href","/devices/compute-config");}
  assert.equal(writes.length,postCount);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const timestamp = new Date().toISOString();
  fs.writeFileSync(path.join(root, ".verify-cache/phone-binding-runtime.json"), JSON.stringify({ taskId: process.env.WORKFLOW_TASK_ID ?? "standalone-debug", stepId: process.env.WORKFLOW_STEP_ID ?? "config-runtime", checkId: process.env.WORKFLOW_CHECK_ID ?? "phone-binding-runtime", runId: process.env.WORKFLOW_RUN_ID ?? "standalone-debug", repo: process.env.WORKFLOW_REPO ?? root, snapshotHash: process.env.WORKFLOW_SNAPSHOT_HASH ?? "standalone-debug", at: timestamp, timestamp, mode: "full", verdict: "pass", treeMoved: false, capability: "runtime", steps: [{ id: "config-runtime", status: "pass", verdict: "pass", innerSkipped: 0, evidence: ["Actual E6ComputeConfig + PhoneReplacementPolicyPanel + PlatformParamsRegistry; isolated HTTP A2 fixture, no production A2/DB claims", "Four-field versioned proposal independent of installer; cancellation and invalid numbers produce no POST", "Determinate version rejection preserves inputs; uncertain proposal persists original key across reload; only GET recovery then simulated external checker publication is read back", "Read-only and split permissions, malformed/read-error fail closed; retired H5 coefficient absent; zero console/page errors or external requests", "Actual A5 registry retains retired H5 history and phone owner links", ...screenshots] }] }, null, 2));
  console.log(`PASS E6/A5 phone component fixture: ${writes.length} HTTP attempts, ${reads} GET reads, four-field A2 version and unknown read-only recovery, A5 retired read-only, two themes; not production A2/DB acceptance.`);
} finally { await browser?.close(); await server.close(); }
