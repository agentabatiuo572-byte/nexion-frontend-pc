import { chromium } from '@playwright/test';
const ZENTAO = 'https://18.142.169.24:8443/zentao';
const E = 'D:/workspace/audit-artifacts/app-full-check-20260918/evidence';
const out = (o) => console.log(JSON.stringify(o));

// 复用可见 Chrome 进程 → 禅道窗口（keeper 存活，窗口被关则重开一扇）
const browser = await chromium.launch({
  headless: false, channel: 'chrome',
  args: ['--ignore-certificate-errors', '--window-position=700,0'],
  slowMo: 200,
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
await page.goto(`${ZENTAO}/index.php?m=user&f=login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[name="account"]', 'zentao_admin');
await page.fill('input[name="password"]', 'Admin@123456');
await page.click('button:has-text("登录")');
await page.waitForURL(/m=my/, { timeout: 30000 });
out({ zentaoLogin: 'OK' });
await page.goto(`${ZENTAO}/index.php?m=bug&f=browse&productID=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${E}/visible-zentao-reopened.png` });
out({ zentaoBugList: page.url() });
out({ visible: 'zentao window reopened, keeper alive' });
await new Promise(() => {});
