import { chromium } from '@playwright/test';
const ZENTAO = 'https://18.142.169.24:8443/zentao';
const APP = 'https://18.142.169.24/app';
const E = 'D:/workspace/audit-artifacts/app-full-check-20260918/evidence';
const out = (o) => console.log(JSON.stringify(o));

const browser = await chromium.launch({
  headless: false, channel: 'chrome',
  args: ['--ignore-certificate-errors', '--window-position=700,0'],
  slowMo: 200,
});

// 禅道：登录 → Bug 列表（产品 NexGrid，空队列待登记）
const zctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
const zp = await zctx.newPage();
await zp.goto(`${ZENTAO}/index.php?m=user&f=login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await zp.fill('input[name="account"]', 'zentao_admin');
await zp.fill('input[name="password"]', 'Admin@123456');
await zp.click('button:has-text("登录")');
await zp.waitForURL(/m=my/, { timeout: 30000 });
out({ zentaoLogin: 'OK' });
await zp.goto(`${ZENTAO}/index.php?m=bug&f=browse&productID=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await zp.waitForTimeout(3000);
await zp.screenshot({ path: `${E}/visible-zentao-buglist2.png` });
out({ zentaoBugList: zp.url() });

// App H5：公网 test 落地页
const actx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 420, height: 860 } });
const ap = await actx.newPage();
await ap.goto(APP, { waitUntil: 'domcontentloaded', timeout: 60000 });
await ap.waitForTimeout(5000);
await ap.screenshot({ path: `${E}/visible-app-landing2.png` });
out({ appAt: ap.url(), appTitle: await ap.title() });

out({ visible: 'zentao+app windows open, keeper alive' });
await new Promise(() => {});
