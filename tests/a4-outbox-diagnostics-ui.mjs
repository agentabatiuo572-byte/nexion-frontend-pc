/** Isolated browser component test. It does not authenticate to or call any shared/public service. */
import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const root = process.cwd().replaceAll("\\", "/");
const server = await createServer({ configFile: false, root, appType: "custom", logLevel: "error",
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0 },
  resolve: { alias: [{ find: "@/lib/admin/a4-client", replacement: "/__a4-fixture-client.js" }, { find: "@", replacement: root }] },
  plugins: [{ name: "isolated-a4-browser-fixture",
    resolveId(id) {
      if (id === "/__a4-fixture-client.js") return "\0a4-fixture-client";
      if (id === "/a4-fixture.tsx") return "\0a4-fixture.tsx";
    },
    load(id) {
      if (id === "\0a4-fixture-client") return `
        import { normalizeOutboxDiagnostics } from ${JSON.stringify(root+"/lib/admin/a4-outbox-diagnostics.ts")};
        export async function fetchA4OutboxDiagnostics(filters,cursor) {
          window.fixtureCalls.push({filters,cursor});
          if (window.fixtureFailure) throw new Error('PRIVATE_RAW_ERROR_MUST_NOT_RENDER');
          return normalizeOutboxDiagnostics(window.fixtureResponse);
        }`;
      if (id === "\0a4-fixture.tsx") return `import React from 'react'; import {createRoot} from 'react-dom/client';
        import {A4OutboxDiagnostics} from ${JSON.stringify(root+"/app/components/domain-views/a-tabs/a4-outbox-diagnostics.tsx")};
        window.fixtureCalls=[]; createRoot(document.getElementById('root')).render(React.createElement(A4OutboxDiagnostics,{canRead:new URLSearchParams(location.search).get('read')==='1'}));`;
    },
    configureServer(vite) { vite.middlewares.use((req,res,next) => {
      if (req.url.startsWith("/fixture")) { res.setHeader("Content-Type","text/html"); res.end('<div id="root"></div><script type="module" src="/a4-fixture.tsx"></script>'); }
      else next();
    }); }
  }] });
let browser;
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}/fixture`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors=[]; page.on("pageerror", e=>{errors.push(e.message);console.error(e.message);});
  page.on("console", msg=>{if(msg.type()==="error")console.error(msg.text());});
  page.setDefaultTimeout(10000);
  await page.goto(base);
  await page.getByText("需要 A4 读取权限").waitFor();
  assert.equal(await page.evaluate(()=>window.fixtureCalls.length),0);
  await page.goto(base+"?read=1");
  await page.getByRole("button",{name:"查询 / 刷新"}).waitFor();
  const response={ total:188, unresolved:6, oldestSeconds:851807, groupsTruncated:false,
    groups:[{eventType:"ADMIN_USER_PROFILE_VIEWED",status:"PENDING",count:6,oldestAt:"2026-09-08T10:00:00",unresolved:6},
      {eventType:"UNREGISTERED_EVENT_TYPE",status:"FAILED",count:182,oldestAt:"2026-09-08T10:00:00",unresolved:0}],
    rows:[{eventId:"12345678123456781234567812345678",eventType:"ADMIN_USER_PROFILE_VIEWED",status:"PENDING",retryCount:0,
      createdAt:"2026-09-08T10:00:00",nextRetryAt:null,errorCode:null,auditLinkUnresolved:true,receipts:[]}],hasMore:true,nextCursor:"9007199254740993" };
  await page.evaluate(value=>{window.fixtureResponse=value;}, response);
  await page.getByRole("button",{name:"查询 / 刷新"}).click();
  await page.getByText("未发现回执（不代表成功）").waitFor();
  assert.match(await page.locator("body").innerText(),/全部待投递 188 条/);
  await page.evaluate(()=>{window.fixtureFailure=true;});
  await page.getByRole("button",{name:"下一页"}).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByText("12345678123456781234567812345678",{exact:true}).count(),0);
  assert.ok(!(await page.locator("body").innerText()).includes("PRIVATE_RAW_ERROR"));
  assert.equal(await page.evaluate(()=>window.fixtureCalls.at(-1).cursor),"9007199254740993");
  await page.evaluate(()=>{window.fixtureFailure=false;window.fixtureResponse={...window.fixtureResponse,rows:[],hasMore:false,nextCursor:null};});
  await page.getByLabel("积压事件状态").selectOption("OTHER");
  await page.getByRole("button",{name:"查询 / 刷新"}).click();
  await page.getByText("当前条件下本页没有记录").waitFor();
  assert.deepEqual(await page.evaluate(()=>window.fixtureCalls.at(-1)), {filters:{eventType:"",status:"OTHER",unresolvedOnly:false},cursor:"0"});
  assert.match(await page.locator("body").innerText(),/全部待投递 188 条/);
  await page.evaluate(()=>{window.fixtureResponse.groups=[];});
  await page.getByRole("button",{name:"查询 / 刷新"}).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByText("当前没有 A3 口径下的积压",{exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log("PASS: actual A4 component browser interaction: read permission, totals, missing receipt, next-page error clears rows, string cursor, filter reset, malformed aggregate fails closed; isolated fixture only.");
} finally { await browser?.close(); await server.close(); }
