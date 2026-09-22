import { chromium } from '@playwright/test';
const PC = 'https://18.142.169.24';
const out = (o) => console.log(JSON.stringify(o));
const E = 'D:/workspace/audit-artifacts/app-full-check-20260918/evidence';
const shot = (page, p) => page.screenshot({ path: p }).catch(e => out({ shotErr: p }));

// Chrome = superadmin 发起方
const chrome = await chromium.launch({ headless: false, channel: 'chrome', args: ['--ignore-certificate-errors'], slowMo: 200 });
const zc = await chrome.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 800 } });
const zp = await zc.newPage();
await zp.goto(PC, { waitUntil: 'domcontentloaded', timeout: 60000 });
await zp.waitForTimeout(4000);
await shot(zp, `${E}/pc-chrome-01-login.png`);
const inputs = await zp.evaluate(() => [...document.querySelectorAll('input')].map(e => ({ type: e.type, name: e.name, ph: e.placeholder })));
out({ chromeAt: zp.url(), chromeTitle: await zp.title(), inputs });
const acc = zp.locator('input:not([type="password"])').first();
const pwd = zp.locator('input[type="password"]').first();
await acc.fill('superadmin');
await pwd.fill('Admin@123456');
await shot(zp, `${E}/pc-chrome-02-filled.png`);
await zp.locator('button[type="submit"]').first().click();
await zp.waitForTimeout(6000);
await shot(zp, `${E}/pc-chrome-03-after-continue.png`);
out({ chromeAfter: zp.url(), chromeAfterTitle: await zp.title() });
const ctext = await zp.evaluate(() => document.body.innerText.slice(0, 1500));
out({ chromeText: ctext });

// Edge = suadmin 复核方
const edge = await chromium.launch({ headless: false, channel: 'msedge', args: ['--ignore-certificate-errors'], slowMo: 200 });
const ec = await edge.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 800 } });
const ep = await ec.newPage();
await ep.goto(PC, { waitUntil: 'domcontentloaded', timeout: 60000 });
await ep.waitForTimeout(4000);
await shot(ep, `${E}/pc-edge-01-login.png`);
await ep.locator('input:not([type="password"])').first().fill('suadmin');
await ep.locator('input[type="password"]').first().fill('Admin@123456Admin@123456');
await shot(ep, `${E}/pc-edge-02-filled.png`);
await ep.locator('button[type="submit"]').first().click();
await ep.waitForTimeout(6000);
await shot(ep, `${E}/pc-edge-03-after-continue.png`);
out({ edgeAfter: ep.url(), edgeAfterTitle: await ep.title() });
const etext = await ep.evaluate(() => document.body.innerText.slice(0, 1500));
out({ edgeText: etext });

out({ visible: 'pc dual windows open, keeper alive' });
await new Promise(() => {});
