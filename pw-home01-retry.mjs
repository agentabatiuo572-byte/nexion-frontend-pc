import { chromium } from '@playwright/test';
const E = 'D:/workspace/audit-artifacts/app-full-check-20260918/evidence';
const out = (o) => console.log(JSON.stringify(o));

// 连回 zentao-app-visible keeper 已打开的可见 Chrome（暴露 CDP 再接管）
const browser = await chromium.launch({
  headless: false, channel: 'chrome',
  args: ['--ignore-certificate-errors', '--remote-debugging-port=9333', '--window-position=50,50'],
  slowMo: 300,
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 420, height: 860 } });
const page = await ctx.newPage();
await page.goto('https://18.142.169.24/app/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
await page.screenshot({ path: `${E}/home01-10-retry.png` });
const box = await page.evaluate(() => {
  const els = [...document.querySelectorAll('*')];
  const cands = els.filter(e => (e.innerText || '').trim() === '立即开始');
  return cands.slice(0, 3).map(el => {
    const r = el.getBoundingClientRect();
    return { tag: el.tagName, cls: String(el.className || '').slice(0, 60), x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  });
});
out({ boxes: box });
if (box.length) {
  await page.mouse.click(box[0].x, box[0].y);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${E}/home01-11-after-click.png`, fullPage: true });
  out({ after: await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(0, 1200) })) });
}
out({ keeper: 'app scan window open' });
await new Promise(() => {});
