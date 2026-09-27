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
  domain: "E6", phoneBinding: { allowReplacement: false, minReplacementIntervalDays: 7 },
  flags: [{ key: "computeShareEnabled", label: "电脑共享", desc: "", enabled: false, frontendEffect: "" }],
  coefficients: ["h5BaseFactor", "continuityFullHours"].map(key => ({ key, label: key, value: "24", unit: "", desc: "", frontendEffect: "" })),
  yieldEstimate: ["topsBaseline", "dailyUsdtPerBaseline", "nexPerUsdt"].map(key => ({ key, label: key, value: "1", unit: "" })),
  gpuTiers: Array.from({ length: 6 }, (_, i) => ({ id: `G${i + 1}`, label: `显卡${i + 1}`, desc: "", defaultModel: "", tops: "1", keywords: [] })),
  download: { url: "", zhTitle: "", zhGuide: "", enTitle: "", enGuide: "" }, sources: ["isolated-http-fixture"],
};
fs.writeFileSync(storage, JSON.stringify(config));
let readMode = "valid", failWrite = false, reads = 0;
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
        import {fetchE6ComputeConfig,updateE6Param} from '${root}/lib/admin/e6-client.ts';
        const permissions=new URLSearchParams(location.search);
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
      if (req.url.startsWith("/api/admin/devices/compute-config/params/") && req.method === "PATCH") {
        let raw = ""; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw), key = decodeURIComponent(req.url.split("/").at(-1));
        writes.push({ key, ...body, idempotencyKey: req.headers["idempotency-key"] });
        if (failWrite) { failWrite = false; return reply({ code: 1, message: "保存失败，请重试" }); }
        assert.ok(body.reason.length >= 8); assert.ok(req.headers["idempotency-key"]);
        const data = readStored();
        if (key === "E.compute.phoneBinding.allowReplacement") { assert.ok(["on", "off"].includes(body.value)); data.phoneBinding.allowReplacement = body.value === "on"; }
        else { assert.equal(key, "E.compute.phoneBinding.minReplacementIntervalDays"); assert.ok(Number.isSafeInteger(Number(body.value)) && Number(body.value) >= 0); data.phoneBinding.minReplacementIntervalDays = Number(body.value); }
        fs.writeFileSync(storage, JSON.stringify(data)); return reply({ code: 0, data: { paramKey: key, value: body.value } });
      }
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
  const toggle = phone.getByRole("switch"), interval = phone.getByRole("button", { name: "调整换机间隔" });
  const submit = page.getByRole("button", { name: "确认提交", exact: true });
  const reason = page.getByRole("textbox", { name: /操作理由/ });
  const value = page.getByLabel("目标新值");
  await page.goto(base);
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.locator('[data-proof="e6-coeff-h5BaseFactor"]')).toHaveCount(0);
  assert.ok(!(await page.locator("body").innerText()).includes("托管收益"));
  await expect(page.locator('[data-proof="e6-flag-toggle"]')).toBeDisabled();
  await toggle.click(); await expect(submit).toBeDisabled();
  await reason.fill("理由不足"); await expect(submit).toBeDisabled();
  await page.getByRole("button", { name: "取消", exact: true }).click(); assert.equal(writes.length, 0);
  await toggle.click(); await reason.fill("测试手机换绑配置理由"); await expect(submit).toBeEnabled(); await submit.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true"); assert.equal(readStored().phoneBinding.allowReplacement, true);
  await page.reload(); await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click(); await reason.fill("测试禁止手机更换理由"); await submit.click(); await expect(toggle).toHaveAttribute("aria-checked", "false");
  await interval.click(); await reason.fill("测试换机间隔配置理由");
  for (const invalid of ["-1", "0.5", "9007199254740992"]) { await value.fill(invalid); await expect(submit).toBeDisabled(); }
  assert.equal(writes.length, 2);
  await value.fill("0"); await expect(submit).toBeEnabled(); failWrite = true; await submit.click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("保存失败");
  await expect(value).toHaveValue("0"); await expect(reason).toHaveValue("测试换机间隔配置理由");
  assert.equal(readStored().phoneBinding.minReplacementIntervalDays, 7);
  await submit.click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.equal(readStored().phoneBinding.minReplacementIntervalDays, 0);
  await page.reload(); await expect(phone.locator(".pkv .v")).toHaveText("0天"); await expect(toggle).toHaveAttribute("aria-checked", "false");
  await interval.click(); await value.fill("30"); await reason.fill("测试三十天换机间隔理由"); await submit.click();
  await expect(page.getByRole("dialog")).toHaveCount(0); assert.equal(readStored().phoneBinding.minReplacementIntervalDays, 30);
  await page.reload(); await expect(phone.locator(".pkv .v")).toHaveText("30天");
  const screenshots = [];
  for (const theme of ["light", "dark"]) { await page.evaluate(t => document.documentElement.dataset.theme = t, theme); const file = path.join(artifacts, `e6-phone-${theme}.png`); await phone.screenshot({ path: file }); screenshots.push(file); }
  for (const [query, toggleCount, intervalCount] of [["?write=0&toggle=0", 0, 0], ["?write=1&toggle=0", 0, 1], ["?write=0&toggle=1", 1, 0]]) {
    await page.goto(base + query); await expect(phone).toBeVisible(); await expect(phone.locator(".pkv")).toBeVisible(); await expect(toggle).toHaveCount(toggleCount); await expect(interval).toHaveCount(intervalCount);
  }
  const count = writes.length;
  for (const mode of ["missing", "invalid"]) { readMode = mode; await page.goto(base); await expect(phone).toContainText("手机绑定配置未就绪"); await expect(toggle).toHaveCount(0); await expect(interval).toHaveCount(0); }
  readMode = "error"; await page.goto(base); await expect(page.locator('[data-proof="e6-load-error"]')).toBeVisible(); await expect(toggle).toHaveCount(0);
  readMode = "valid"; await page.getByRole("button", { name: "重新加载" }).click(); await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.goto(base + "?a5=1");
  const retired = page.locator("article").filter({ hasText: "E.compute.h5BaseFactor" });
  await expect(retired).toContainText("历史配置 · 已退役（只读）");
  await expect(retired.locator("a,button,input")).toHaveCount(0);
  await expect(retired).not.toContainText("修改需确认");
  await expect(retired).not.toContainText("当前服务端值");
  for (const key of ["allowReplacement", "minReplacementIntervalDays"]) {
    const current = page.locator("article").filter({ hasText: `E.compute.phoneBinding.${key}` });
    await expect(current).toContainText("修改需确认");
    const link = current.getByRole("link"); await expect(link).toHaveAttribute("href", "/devices/compute-config");
    await link.click(); await expect(phone.locator(".pkv .v")).toHaveText("30天");
    await page.goto(base + "?a5=1");
  }
  assert.equal(writes.length, count); assert.ok(reads >= 10); assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const timestamp = new Date().toISOString();
  fs.writeFileSync(path.join(root, ".verify-cache/phone-binding-runtime.json"), JSON.stringify({ taskId: process.env.WORKFLOW_TASK_ID ?? "standalone-debug", stepId: process.env.WORKFLOW_STEP_ID ?? "config-runtime", checkId: process.env.WORKFLOW_CHECK_ID ?? "phone-binding-runtime", runId: process.env.WORKFLOW_RUN_ID ?? "standalone-debug", repo: process.env.WORKFLOW_REPO ?? root, snapshotHash: process.env.WORKFLOW_SNAPSHOT_HASH ?? "standalone-debug", at: timestamp, timestamp, mode: "full", verdict: "pass", treeMoved: false, capability: "runtime", steps: [{ id: "config-runtime", status: "pass", verdict: "pass", innerSkipped: 0, evidence: ["Actual E6ComputeConfig + OperationConfirmModal + PlatformParamsRegistry + E6/A5 HTTP clients; isolated disk-backed localhost fixture, no production A2/DB claims", "Empty installer URL does not block phone switch; cancellation/short reasons/negative/fractional/unsafe integer reject writes", "Allow/deny and 0/30-day intervals saved through HTTP, authoritative GET and page reload preserve values; failed save retains inputs and retry succeeds", "Read-only and split write/toggle permissions, missing/malformed/read-error fail closed; retired H5 coefficient absent; zero console/page errors or external requests", "Actual A5 registry shows retired H5 row as history with no editing/link controls; both phone key links navigate to actual E6 with persisted 30 days", ...screenshots] }] }, null, 2));
  console.log(`PASS E6/A5 phone component fixture: ${writes.length} HTTP attempts, ${reads} GET reads, 0/30-day persistence, A5 retired read-only and active links, two themes; not production A2/DB acceptance.`);
} finally { await browser?.close(); await server.close(); }
