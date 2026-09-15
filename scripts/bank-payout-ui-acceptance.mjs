import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { chromium } from "playwright";

// Isolated local built UI only. All API transport is intercepted, no live login, bank or wallet access.
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {windowsHide:true, stdio:"pipe"});
let serverLog = "";
server.stdout.on("data", b => { serverLog = (serverLog+b).slice(-4000); });
server.stderr.on("data", b => { serverLog = (serverLog+b).slice(-4000); });
let browser;
const no = "WD-BANKTEST123";
const row = {
  id:1,userId:71,withdrawalNo:no,asset:"USDT",chain:"BANK-VND",targetAddress:"BANK-VND:BB-FIXTURE",
  amount:100,fee:1,status:"TX_ORPHANED",createdAt:"2026-09-15T10:00:00Z",updatedAt:"2026-09-15T10:00:00Z",
  userNo:"TEST-71",nickname:"Bank fixture",userStatus:"ACTIVE",withdrawalCount24h:1,
  networkConfirmUsd:1,nexBurned:0,nexFeeOffsetRate:1,feeWaived:0,actualFee:1,netReceive:99,
  routingPriority:"NORMAL",riskScore:10, k4BandLowMax:30,k4BandHighMin:70,k4AutoEscalateScore:80,
};
const bank = {withdrawalNo:no,provider:"HDPAY",state:"MANUAL_REVIEW",version:4,providerOrderId:"1234",providerStatus:3,
  quote:{bankName:"Vietcombank",maskedAccount:"******6789",amountVnd:2475000,rateVnd:25000,feeUsdt:1,netUsdt:99}};
const sourceKeys = ["dailyLimitCount","balanceMaxRatio","networkConfirmFeeUsd","networkEnabled","nexFeeOffsetRate","smallAmountThresholdUsd","payoutSlaHours","cooldownDays","complianceHoldEnabled"];
const limits = {version:1,dailyLimitCount:3,balanceMaxRatio:1,networkConfirmFeeUsd:{trc20:1,bep20:1,erc20:5},networkEnabled:{trc20:true,bep20:true,erc20:true},
  nexFeeOffsetRate:1,smallAmountThresholdUsd:50,payoutSlaHours:48,cooldownDays:0,complianceHoldEnabled:false,currentPhase:"P1",currentMonth:1,
  coverageRatio:200,redlinePct:100,coverageReliable:true,sourceByField:Object.fromEntries(sourceKeys.map(k=>[k,"d5"]))};
let bankUnavailable = false;
const mutations = [], unexpected = [];
try {
  let ready = false;
  for (let i=0;i<100;i++) {
    try { if ((await fetch(origin,{signal:AbortSignal.timeout(500)})).ok) {ready=true;break;} } catch {}
    if (server.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve,100));
  }
  assert.ok(ready,serverLog);
  browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await context.newPage();
  const pageErrors=[]; page.on("pageerror",e=>pageErrors.push(e.message));
  await context.route("**/*", async route => {
    const request=route.request(), url=new URL(request.url());
    if (url.origin!==origin) {unexpected.push(url.origin);return route.abort();}
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const send=data=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({code:0,data})});
    if (request.method()!=="GET") {
      mutations.push({path:url.pathname,body:request.postDataJSON(),key:request.headers()["idempotency-key"]});
      if (url.pathname===`/api/admin/finance/withdrawals/${no}/bank/requery`) {
        bank.state="PAID";bank.version++;row.status="CONFIRMED";
        return send({withdrawalNo:no,state:"PAID"});
      }
      unexpected.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({status:503,body:"isolated fixture: unexpected mutation"});
    }
    if (url.pathname==="/api/admin/auth/session") return send({tokenType:"Bearer",session:{adminId:1,username:"fixture",operator:"Fixture",role:"superadmin",
      authorities:["finance_d2_read","finance_d2_withdrawal_approve","finance_d2_withdrawal_refund"],menuCodes:["D","D2"]}});
    if (url.pathname==="/api/admin/withdraw/limits") return send(limits);
    if (url.pathname==="/api/admin/platform/audit/reason-policy") return send({minChars:8,maxChars:200,sourceKey:"admin.a2.reason_min_chars"});
    if (url.pathname==="/api/admin/finance/withdrawals") return send({total:1,pageNum:1,pageSize:20,records:[row]});
    if (url.pathname===`/api/admin/finance/withdrawals/${no}`) return send(row);
    if (url.pathname===`/api/admin/finance/withdrawals/${no}/bank`) return bankUnavailable
      ? route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({code:503,message:"BACKEND_UNAVAILABLE"})}):send(bank);
    // Optional surfaces are explicitly unavailable, never forwarded to a backend.
    return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({code:503,message:"ISOLATED_FIXTURE_UNAVAILABLE"})});
  });
  await page.goto(`${origin}/finance/withdrawals`);
  const open = page.getByRole("button",{name:`打开提现单 ${no} 的详情`});
  await open.click();
  await page.getByText("Vietcombank",{exact:false}).first().waitFor();
  assert.match(await page.locator("body").innerText(),/2,475,000/);
  assert.equal(await page.getByText("0123456789",{exact:false}).count(),0);
  const recover=page.getByRole("button",{name:"查询原代付单并核对",exact:true});
  await recover.click();
  const confirm=page.getByRole("button",{name:"确认提交",exact:true});
  assert.equal(await confirm.isDisabled(),true);
  await page.locator("textarea").fill("供应商原订单结果核对测试，禁止重新发起打款");
  await confirm.click();
  await page.waitForFunction(()=>!document.body.textContent.includes("查询原银行代付单 ·"));
  await recover.waitFor({state:"hidden"});
  assert.equal(mutations.length,1);
  assert.equal(mutations[0].path,`/api/admin/finance/withdrawals/${no}/bank/requery`);
  assert.equal(mutations[0].body.version,4);assert.ok(mutations[0].key);
  assert.equal(unexpected.length,0,JSON.stringify(unexpected));
  // Failed latest bank detail must never leave the old recovery command usable.
  await page.getByRole("button",{name:"关闭",exact:true}).last().click();
  bankUnavailable=true;bank.state="MANUAL_REVIEW";row.status="TX_ORPHANED";
  await open.click();
  await page.getByText(/为避免按旧数据处置/).waitFor();
  assert.ok(await recover.count()===0 || await recover.isDisabled());
  assert.deepEqual(pageErrors,[]);
  console.log("PASS D2 bank built UI: masked snapshot, VND amount, reason-required query-only recovery, version/idempotency, stale detail failure closes writes; no live API");
} finally {
  if (browser) await browser.close();
  if (server.exitCode===null) {
    if (process.platform==="win32") spawnSync("taskkill",["/PID",String(server.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});
    else server.kill("SIGTERM");
  }
}
