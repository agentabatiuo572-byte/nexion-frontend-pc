import { chromium } from '@playwright/test';
const E = 'D:/workspace/audit-artifacts/app-full-check-20260918/evidence';
const out = (o) => console.log(JSON.stringify(o));

// 注册页区号切换：默认 +84，检查 +86 是否可选（可见窗口，用户可直视）
const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--ignore-certificate-errors', '--window-position=80,80'], slowMo: 400 });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 420, height: 860 } });
const page = await ctx.newPage();
await page.goto('https://18.142.169.24/app/#/pages/register/register', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: `${E}/reg-01-default.png` });
const def = await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(0, 600) }));
out({ defaultPage: def });
// 点区号选择器
const box = await page.evaluate(() => {
  const els = [...document.querySelectorAll('*')];
  const cands = els.filter(e => (e.innerText || '').trim() === '+84');
  return cands.slice(0, 2).map(el => { const r = el.getBoundingClientRect(); return { tag: el.tagName, x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; });
});
out({ areaBoxes: box });
if (box.length) {
  await page.mouse.click(box[0].x, box[0].y);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${E}/reg-02-area-list.png`, fullPage: true });
  out({ areaList: await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(0, 1500) })) });
}
out({ keeper: 'register scan window open' });
await new Promise(() => {});
