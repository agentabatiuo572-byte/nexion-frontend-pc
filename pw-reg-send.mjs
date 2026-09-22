import { chromium } from '@playwright/test';
const E = 'D:/workspace/audit-artifacts/app-full-check-20260918/evidence';
const out = (o) => console.log(JSON.stringify(o));
const TEST_NUM = '13809182347';

const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--ignore-certificate-errors', '--window-position=100,60'], slowMo: 400 });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 420, height: 860 } });
const page = await ctx.newPage();
await page.goto('https://18.142.169.24/app/#/pages/register/register', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);

// 1. 点区号 +84 打开列表
const areaBtn = await page.evaluate(() => {
  const els = [...document.querySelectorAll('*')];
  const el = els.find(e => (e.innerText || '').trim() === '+84' && e.children.length <= 1) || els.find(e => (e.innerText || '').trim() === '+84');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
out({ areaBtn });
if (areaBtn) { await page.mouse.click(areaBtn.x, areaBtn.y); await page.waitForTimeout(3000); }
// 2. 选 CN 中国 +86
const cnBtn = await page.evaluate(() => {
  const els = [...document.querySelectorAll('*')];
  const el = els.find(e => (e.innerText || '').includes('中国') && (e.innerText || '').includes('+86') && e.children.length === 0)
    || els.find(e => (e.innerText || '').trim() === '中国');
  if (!el) return null;
  const t = (el.innerText || '').slice(0, 30);
  const r = el.getBoundingClientRect();
  return { t, x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
out({ cnBtn });
if (cnBtn) { await page.mouse.click(cnBtn.x, cnBtn.y); await page.waitForTimeout(3000); }
await page.screenshot({ path: `${E}/reg-03-after-area86.png` });
out({ afterArea: await page.evaluate(() => document.body.innerText.slice(0, 500)) });

// 3. 填 +86 测试号
const phoneBox = await page.evaluate(() => {
  const inp = document.querySelector('input[type="tel"], input[placeholder*="手机"], input');
  if (!inp) return null;
  const r = inp.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
out({ phoneBox });
if (phoneBox) {
  await page.mouse.click(phoneBox.x, phoneBox.y);
  await page.waitForTimeout(800);
  await page.keyboard.type(TEST_NUM, { delay: 80 });
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: `${E}/reg-04-number-filled.png` });

// 4. 点 发送验证码（真实发送，不跳过）
const sendBtn = await page.evaluate(() => {
  const els = [...document.querySelectorAll('*')];
  const el = els.find(e => (e.innerText || '').trim() === '发送验证码');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
out({ sendBtn });
if (sendBtn) {
  await page.mouse.click(sendBtn.x, sendBtn.y);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${E}/reg-05-after-send.png`, fullPage: true });
  out({ afterSend: await page.evaluate(() => document.body.innerText.slice(0, 1000)) });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${E}/reg-06-countdown.png` });
  out({ countdown: await page.evaluate(() => document.body.innerText.slice(0, 1000)) });
}
out({ keeper: 'register send window open, TEST_NUM=' + TEST_NUM });
await new Promise(() => {});
