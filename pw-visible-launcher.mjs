import { chromium } from '@playwright/test';

// 可见浏览器启动器：Chrome(zentao/PC发起方/App) + Edge(PC复核方)，窗口保持打开供用户查看
const ZENTAO = 'https://18.142.169.24:8443/zentao';
const PC = 'https://18.142.169.24';
const APP = 'https://18.142.169.24/app';
const out = (o) => console.log(JSON.stringify(o));
const shot = (page, p) => page.screenshot({ path: p }).catch(e => out({ shotErr: p, e: String(e).slice(0, 100) }));

const chrome = await chromium.launch({
  headless: false, channel: 'chrome',
  args: ['--ignore-certificate-errors'],
  slowMo: 300,
});
const edge = await chromium.launch({
  headless: false, channel: 'msedge',
  args: ['--ignore-certificate-errors'],
  slowMo: 300,
});

// 1) 禅道：登录 → 产品 NexGrid → Bug 列表（空队列，待登记昨日6条候选）
const zctx = await chrome.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 800 } });
const zp = await zctx.newPage();
await zp.goto(`${ZENTAO}/index.php?m=user&f=login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await zp.fill('input[name="account"]', 'zentao_admin');
await zp.fill('input[name="password"]', 'Admin@123456');
await zp.click('button:has-text("登录")');
await zp.waitForURL(/m=my/, { timeout: 30000 });
out({ zentaoLogin: 'OK' });
await zp.goto(`${ZENTAO}/index.php?m=bug&f=browse&productID=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await zp.waitForTimeout(3000);
await shot(zp, 'D:/workspace/audit-artifacts/app-full-check-20260918/evidence/visible-zentao-buglist.png');
out({ zentaoBugList: zp.url() });

// 2) PC Chrome：superadmin 发起方登录
const pcctx = await chrome.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 800 } });
const pcp = await pcctx.newPage();
await pcp.goto(PC, { waitUntil: 'domcontentloaded', timeout: 60000 });
await pcp.waitForTimeout(3000);
await shot(pcp, 'D:/workspace/audit-artifacts/app-full-check-20260918/evidence/visible-pc-login.png');
out({ pcChromeAt: pcp.url(), pcChromeTitle: await pcp.title() });

// 3) App H5：公网 test 落地页
const appctx = await chrome.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
const appp = await appctx.newPage();
await appp.goto(APP, { waitUntil: 'domcontentloaded', timeout: 60000 });
await appp.waitForTimeout(5000);
await shot(appp, 'D:/workspace/audit-artifacts/app-full-check-20260918/evidence/visible-app-landing.png');
out({ appAt: appp.url(), appTitle: await appp.title() });

// 4) PC Edge：suadmin 复核方（只打开登录页，等待后续登录保持隔离）
const ectx = await edge.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 800 } });
const ep = await ectx.newPage();
await ep.goto(PC, { waitUntil: 'domcontentloaded', timeout: 60000 });
await ep.waitForTimeout(3000);
await shot(ep, 'D:/workspace/audit-artifacts/app-full-check-20260918/evidence/visible-pc-edge-login.png');
out({ pcEdgeAt: ep.url(), pcEdgeTitle: await ep.title() });

out({ visible: 'all windows open, keeper alive' });
await new Promise(() => {}); // 保持窗口，用户可直接查看
