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
  beneficiaryVerification:{verificationStatus:"unavailable",payoutCapability:"unknown",ownershipStatus:"unknown",accountType:"unknown",reasonCode:"BANK_VERIFICATION_PROVIDER_UNAVAILABLE",checkedAt:null,expiresAt:null,evidenceRef:null,capabilityVersion:null,canWithdraw:false},
  settlementEvidence:{status:"review_required",evidenceRef:null,providerOrderId:"1234",providerStatus:3,checkedAt:null,amountUsdt:null},
  quote:{bankName:"Vietcombank",maskedAccount:"******6789",amountVnd:2475000,rateVnd:25000,feeUsdt:1,netUsdt:99}};
const d7 = {version:4,baseRateVndPerUsdt:26000,buySpreadPct:1.5,sellSpreadPct:1.5,quoteTtlMinWithdraw:10,requoteTolerancePct:2,feeRatePct:1,feeMinUsd:1,feeMaxUsd:25,minAmountUsd:20,maxAmountUsd:5000,
  channelEnabled:false,providerReady:true,providerStatusAvailable:true,sandboxAvailable:false,
  capabilitySummary:{status:"unavailable",provider:null,country:"VN",currency:"VND",recipientIdentifier:"bank_account",accountVerificationAvailable:false,ownershipVerificationAvailable:false,reasonCode:"BANK_VERIFICATION_PROVIDER_UNAVAILABLE",capabilityVersion:null,checkedAt:null},
  defaults:{sellSpreadPct:1.5,quoteTtlMinWithdraw:10,requoteTolerancePct:2,feeRatePct:1,feeMinUsd:1,feeMaxUsd:25,minAmountUsd:20,maxAmountUsd:5000},
  effectiveAt:"2026-09-16T01:00:00Z",lastUpdatedBy:"fixture",sources:{baseRateVndPerUsdt:"D6",buySpreadPct:"D6",d7:"platform-config"}};
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
        bank.settlementEvidence={status:"paid",evidenceRef:"LEDGER-TEST",providerOrderId:"1234",providerStatus:3,checkedAt:"2026-09-16T01:00:00Z",amountUsdt:100};
        return send({withdrawalNo:no,state:"PAID"});
      }
      if (url.pathname==="/api/admin/finance/payout-vnd/channel" && request.postDataJSON().enabled===false) {d7.channelEnabled=false;d7.version++;return send(d7);}
      unexpected.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({status:503,body:"isolated fixture: unexpected mutation"});
    }
    if (url.pathname==="/api/admin/auth/session") return send({tokenType:"Bearer",session:{adminId:1,username:"fixture",operator:"Fixture",role:"superadmin",
      authorities:["finance_d2_read","finance_d2_withdrawal_approve","finance_d2_withdrawal_refund","finance_d7_read","finance_d7_channel_toggle"],menuCodes:["D","D2","D7"]}});
    if (url.pathname==="/api/admin/finance/payout-vnd/config") return send(d7);
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
  assert.match(await page.locator("body").innerText(),/收款资格尚未通过/);
  assert.match(await page.locator("body").innerText(),/结果待核实/);
  await page.getByRole("button",{name:"关闭",exact:true}).last().click();
  bank.beneficiaryVerification={canWithdraw:true};
  bank.settlementEvidence={status:"refunded"};
  await open.click();
  await page.getByText("Vietcombank",{exact:false}).first().waitFor();
  const recover=page.getByRole("button",{name:"查询原代付单并核对",exact:true});
  await recover.click();
  const confirm=page.getByRole("button",{name:"确认提交",exact:true});
  assert.equal(await confirm.isDisabled(),true);
  await page.locator("textarea").fill("供应商原订单结果核对测试，禁止重新发起打款");
  await confirm.click();
  await page.waitForFunction(()=>!document.body.textContent.includes("查询原银行代付单 ·"));
  await recover.waitFor({state:"hidden"});
  await page.getByText("LEDGER-TEST",{exact:true}).waitFor();
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
  await page.goto(`${origin}/finance/payout-vnd`);
  const capability = page.getByRole("region",{name:"银行收款能力"});
  await capability.waitFor();
  assert.match(await capability.innerText(),/账户核验：未就绪/);
  assert.equal(await page.getByRole("button",{name:"开启通道",exact:true}).isDisabled(),true);
  // The same unavailable verification provider must never hide the stop-loss path.
  d7.channelEnabled=true;
  d7.capabilitySummary={status:"ready"};
  await page.reload();
  await page.getByRole("button",{name:"关闭通道",exact:true}).click();
  await page.locator("textarea").fill("账户核验服务未就绪，关闭新出款并保留原单查询");
  await page.getByRole("button",{name:"确认提交",exact:true}).click();
  await page.getByRole("button",{name:"开启通道",exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:"开启通道",exact:true}).isDisabled(),true);
  assert.equal(mutations.length,2);assert.equal(mutations[1].body.enabled,false);assert.ok(mutations[1].key);
  assert.equal(unexpected.length,0,JSON.stringify(unexpected));
  assert.deepEqual(pageErrors,[]);
  await capability.scrollIntoViewIfNeeded();
  await capability.screenshot({path:"artifacts/bank-d7-capability.png"});
  console.log("PASS D2/D7 built UI: eligibility/ledger evidence, masked snapshot, query-only recovery, stale detail blocks writes; unavailable verification blocks enabling but permits audited close; no live API");
} finally {
  if (browser) await browser.close();
  if (server.exitCode===null) {
    if (process.platform==="win32") spawnSync("taskkill",["/PID",String(server.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});
    else server.kill("SIGTERM");
  }
}
