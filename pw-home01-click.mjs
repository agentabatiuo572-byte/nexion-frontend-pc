import { chromium } from '@playwright/test';
const APP = 'https://18.142.169.24/app';
const E = 'D:/workspace/audit-artifacts/app-full-check-20260918/evidence';
const out = (o) => console.log(JSON.stringify(o));

const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--ignore-certificate-errors', '--window-position=50,50'], slowMo: 500 });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 420, height: 860 } });
const page = await ctx.newPage();
await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
const box = await page.evaluate(() => {
  const els = [...document.querySelectorAll('*')];
  const el = els.find(e => (e.innerText || '').trim() === '立即开始' && e.children.length === 0) || els.find(e => (e.innerText || '').trim() === '立即开始');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const chain = [];
  let n = el;
  while (n && chain.length < 4) { chain.push(n.tagName + '.' + (n.className || '').toString().slice(0, 40)); n = n.parentElement; }
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, chain };
});
out({ startBox: box });
await page.screenshot({ path: `${E}/home01-01-intro.png` });
if (box) {
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${E}/home01-02-after-start.png`, fullPage: true });
  const t = await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(0, 1200) }));
  out({ after: t });
}
out({ keeper: 'window kept open' });
await new Promise(() => {});
