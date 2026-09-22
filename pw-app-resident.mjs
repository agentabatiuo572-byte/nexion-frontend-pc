import { chromium } from '@playwright/test';
const E = 'D:/workspace/audit-artifacts/app-full-check-20260918/evidence';
const out = (o) => console.log(JSON.stringify(o));
const TEST_NUM = '13809182347';

// 常驻 App 窗口（带 CDP 端口，后续扫描全部连回此窗口，不再开新窗）
const browser = await chromium.launch({
  headless: false, channel: 'chrome',
  args: ['--ignore-certificate-errors', '--window-position=1270,40', '--remote-debugging-port=9334'],
  slowMo: 100,
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 420, height: 860 } });
const page = await ctx.newPage();
await page.goto('https://18.142.169.24/app/#/pages/register/register', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);

// 选 +86
const areaBtn = await page.evaluate(() => {
  const els = [...document.querySelectorAll('*')];
  const el = els.find(e => (e.innerText || '').trim() === '+84' && e.children.length <= 1) || els.find(e => (e.innerText || '').trim() === '+84');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (areaBtn) { await page.mouse.click(areaBtn.x, areaBtn.y); await page.waitForTimeout(2500); }
const cnBtn = await page.evaluate(() => {
  const els = [...document.querySelectorAll('*')];
  const el = els.find(e => (e.innerText || '').trim() === '中国');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (cnBtn) { await page.mouse.click(cnBtn.x, cnBtn.y); await page.waitForTimeout(2000); }

// 填号
const phoneBox = await page.evaluate(() => {
  const inp = document.querySelector('input');
  if (!inp) return null;
  const r = inp.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (phoneBox) {
  await page.mouse.click(phoneBox.x, phoneBox.y);
  await page.waitForTimeout(600);
  await page.keyboard.type(TEST_NUM, { delay: 60 });
  await page.waitForTimeout(1200);
}
// 点发送验证码
const sendBtn = await page.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find(e => (e.innerText || '').trim() === '发送验证码');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (sendBtn) { await page.mouse.click(sendBtn.x, sendBtn.y); await page.waitForTimeout(4000); }
await page.screenshot({ path: `${E}/slider-01-captcha.png` });

// 拼图 DOM 定位：滑块旋钮、拼图块、虚线槽
const dom = await page.evaluate(() => {
  const all = [...document.querySelectorAll('*')];
  const has = (t) => all.filter(e => (e.innerText || '').trim() === t).slice(0, 2).map(el => {
    const r = el.getBoundingClientRect();
    return { tag: el.tagName, cls: String(el.className || '').slice(0, 50), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  const imgs = [...document.querySelectorAll('img,canvas')].slice(0, 10).map(el => {
    const r = el.getBoundingClientRect();
    return { tag: el.tagName, cls: String(el.className || '').slice(0, 50), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  return { sliderText: has('按住滑块拖动 →'), verifyTitle: has('安全验证'), imgs, url: location.href };
});
out({ dom });
out({ keeper: 'resident app window open, cdp=9334' });
await new Promise(() => {});
