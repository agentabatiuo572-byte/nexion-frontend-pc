import { chromium } from '@playwright/test';
const APP = 'https://18.142.169.24/app';
const E = 'D:/workspace/audit-artifacts/app-full-check-20260918/evidence';
const out = (o) => console.log(JSON.stringify(o));

const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--ignore-certificate-errors'], slowMo: 400 });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 420, height: 860 } });
const page = await ctx.newPage();
await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: `${E}/app-01-landing.png` });
out({ step: 'landing', url: page.url(), title: await page.title() });

const startBtn = page.getByText('立即开始').first();
if (await startBtn.count()) {
  await startBtn.click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${E}/app-02-after-start.png` });
  out({ step: 'after-start', url: page.url() });
}
await page.goto(`${APP}#/pages/login/login`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(4000);
await page.screenshot({ path: `${E}/app-03-login.png` });
const loginText = await page.evaluate(() => document.body.innerText.slice(0, 800));
out({ step: 'login-page', url: page.url(), loginText });
out({ scan: 'app visible pass done, window kept open' });
await new Promise(() => {});
