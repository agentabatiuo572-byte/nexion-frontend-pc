#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const auditRoot = path.join(root, "docs", "audit");
const shardRoot = path.join(auditRoot, "shards");
const screenshotRoot = path.join(auditRoot, "screenshots");
const shardId = process.argv[2] || "UNI-FR-09";
const baseUrl = process.env.UNI_BASE_URL || "http://127.0.0.1:5173";
const plan = JSON.parse(fs.readFileSync(path.join(auditRoot, "l1-shards.json"), "utf8"));
const shard = plan.shards.find((item) => item.id === shardId);
if (!shard || shard.side !== "uniapp") throw new Error(`UNIAPP_SHARD_REQUIRED:${shardId}`);

function slug(route) {
  return route.replace(/^\/+/, "").replace(/^#\/?/, "hash-").replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
}

function sampledRoute(route) {
  if (route === "/#/pages/store/detail") return `${route}?id=stellarbox-s1`;
  if (route === "/#/pages/store/order-detail") return `${route}?id=ORD-AUDIT-0001`;
  if (route === "/#/pages/learn/course") return `${route}?id=learning-basics`;
  return route;
}

fs.mkdirSync(shardRoot, { recursive: true });
fs.mkdirSync(screenshotRoot, { recursive: true });
const output = path.join(shardRoot, `${shardId.toLowerCase()}-runtime.ndjson`);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
const page = await context.newPage();

try {
  await page.goto(`${baseUrl}/?nx_device=off#/pages/onboarding/intro`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForFunction(() => document.querySelector("#app")?.childElementCount > 0 && Boolean(window.uni), null, { timeout: 60_000 });
  await page.evaluate(() => {
    const auth = { isAuthenticated: true, email: "audit@nexion.local", onboardingComplete: true };
    if (window.uni && typeof window.uni.setStorageSync === "function") window.uni.setStorageSync("nexgrid-auth-v1", auth);
    else localStorage.setItem("nexgrid-auth-v1", JSON.stringify(auth));
  });

  const rows = [];
  for (const route of shard.routes || []) {
    console.log(`capturing ${shardId} ${route}`);
    const startedAt = new Date().toISOString();
    const sample = sampledRoute(route);
    const url = `${baseUrl}/?nx_device=off${sample.startsWith("/#/") ? sample.slice(1) : sample}`;
    const consoleErrors = [];
    const onConsole = (message) => { if (message.type() === "error") consoleErrors.push(message.text()); };
    const pageErrors = [];
    const onPageError = (error) => pageErrors.push(String(error?.stack || error));
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForFunction(() => document.querySelector("#app")?.childElementCount > 0, null, { timeout: 60_000 });
    // Some legitimate empty/content-index states render the UniApp shell without
    // body text. The mounted app is the readiness boundary; the empty state itself
    // must still be captured as runtime evidence instead of aborting the shard.
    const runtime = await page.evaluate(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const controls = Array.from(document.querySelectorAll("button,a,input,textarea,select,[role='button'],[role='link'],[tabindex]"))
        .filter(visible)
        .slice(0, 80)
        .map((element, index) => ({
          index,
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role") || "",
          text: (element.innerText || element.textContent || "").trim().slice(0, 120),
          aria: element.getAttribute("aria-label") || "",
          href: element.getAttribute("href") || "",
          type: element.getAttribute("type") || "",
          placeholder: element.getAttribute("placeholder") || "",
          disabled: "disabled" in element ? Boolean(element.disabled) : false,
        }));
      const body = document.body?.innerText || "";
      return {
        title: document.title,
        url: location.href,
        bodyTextLength: body.length,
        bodyPreview: body.slice(0, 1200),
        controls,
        controlCount: controls.length,
        links: Array.from(document.querySelectorAll("a[href]")).slice(0, 50).map((a) => a.getAttribute("href")),
        tables: Array.from(document.querySelectorAll("table")).map((table) => ({ rows: table.rows.length })),
        listBaseline: {
          pagination: Boolean(document.querySelector("[class*='pager'],[class*='pagination']")),
          filters: Boolean(document.querySelector("[class*='filter']")),
          search: Boolean(document.querySelector("input[type='search']")),
          sorting: Boolean(document.querySelector("[aria-sort]")),
          emptyState: /empty|暂无|没有数据|no data/i.test(body),
        },
        dialogCount: document.querySelectorAll("[role='dialog']").length,
        errorText: /unavailable|failed|error|不可用|失败/i.test(body),
      };
    });
    const name = `${shardId.toLowerCase()}-${slug(route)}`;
    const screenshot = `docs/audit/screenshots/${name}.png`;
    const snapshot = `docs/audit/shards/${name}-snapshot.txt`;
    await page.screenshot({ path: path.join(root, screenshot), fullPage: true });
    fs.writeFileSync(path.join(root, snapshot), JSON.stringify({ controls: runtime.controls, bodyPreview: runtime.bodyPreview }, null, 2), "utf8");
    const actualHash = new URL(runtime.url).hash.replace(/[?].*$/, "");
    rows.push({
      shardId,
      source: "E-runtime-crawl-playwright",
      side: "uniapp",
      route,
      url,
      sampledRoute: sample,
      startedAt,
      status: "captured",
      evidence: {
        snapshot,
        screenshot,
        snapshotInteractiveCount: runtime.controlCount,
        snapshotInteractive: runtime.controls.slice(0, 20),
        runtime: { ...runtime, consoleErrors, pageErrors },
        routeMatch: actualHash === route.slice(1),
      },
      seededState: { ok: true, side: "uniapp" },
      finishedAt: new Date().toISOString(),
    });
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
  fs.writeFileSync(output, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  console.log(`PLAYWRIGHT UNI RUNTIME: PASS (${shardId}, ${rows.length}/${rows.length})`);
} finally {
  await context.close();
  await browser.close();
}
