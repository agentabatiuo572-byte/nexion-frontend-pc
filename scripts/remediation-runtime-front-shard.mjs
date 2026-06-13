// Runtime crawl helper for Next reference and UniApp H5 L1 shards.
// It mirrors the admin route crawler but chooses base URL by shard side.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT = path.join(ROOT, "docs", "audit");
const SHARDS = path.join(AUDIT, "shards");
const SCREENSHOTS = path.join(AUDIT, "screenshots");
const NEXT_BASE_URL = process.env.NEXT_BASE_URL || "http://localhost:3001";
const UNI_BASE_URL = process.env.UNI_BASE_URL || "http://localhost:5173";
const shardId = process.argv[2] || "NEXT-FR-01";
const session = process.env.AGENT_BROWSER_SESSION || `nexion-front-${shardId.toLowerCase()}`;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function quoteShellArg(arg) {
  const value = String(arg);
  if (process.platform === "win32") return `"${value.replace(/"/g, '\\"')}"`;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function run(args, options = {}) {
  const fullArgs = ["--session", session, ...args];
  const result =
    process.platform === "win32"
      ? spawnSync(["agent-browser", ...fullArgs.map(quoteShellArg)].join(" "), [], {
          cwd: ROOT,
          encoding: "utf8",
          input: options.input,
          shell: true,
          timeout: options.timeout || 30000,
        })
      : spawnSync("agent-browser", fullArgs, {
          cwd: ROOT,
          encoding: "utf8",
          input: options.input,
          timeout: options.timeout || 30000,
        });
  if (result.status !== 0) {
    throw new Error(
      `agent-browser ${args.join(" ")} failed` +
        `\nstatus=${result.status}` +
        `\nerror=${result.error?.message || ""}` +
        `\nstdout=${result.stdout || ""}` +
        `\nstderr=${result.stderr || ""}`,
    );
  }
  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

function evalJson(script) {
  const encoded = Buffer.from(script, "utf8").toString("base64");
  const raw = run(["eval", "-b", encoded], { timeout: 30000 });
  try {
    return JSON.parse(JSON.parse(raw));
  } catch {
    try {
      return JSON.parse(raw);
    } catch (error) {
      return { parseError: error.message, raw };
    }
  }
}

function safeName(route) {
  return (
    route
      .replace(/^\/+/, "")
      .replace(/^#\/?/, "hash-")
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90) || "root"
  );
}

function lineJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(obj)}\n`, "utf8");
}

function sampleRoute(route, side) {
  if (side === "nextReference") {
    return route
      .replace("[productId]", "stellarbox-s1")
      .replace("[id]", "ORD-AUDIT-0001")
      .replace("[code]", "NX-DEMO")
      .replace("[hash]", "0xdemo");
  }
  if (side === "uniapp") {
    if (route === "/#/pages/store/detail") return "/#/pages/store/detail?id=stellarbox-s1";
    if (route === "/#/pages/store/order-detail") return "/#/pages/store/order-detail?id=ORD-AUDIT-0001";
  }
  return route;
}

function routeUrl(route, side) {
  const sampled = sampleRoute(route, side);
  const base = side === "uniapp" ? UNI_BASE_URL : NEXT_BASE_URL;
  if (sampled.startsWith("/#/")) return `${base}${sampled}`;
  if (sampled.startsWith("#/")) return `${base}/${sampled}`;
  return `${base}${sampled}`;
}

function seedAuditState(side) {
  const base = side === "uniapp" ? `${UNI_BASE_URL}/#/pages/onboarding/intro` : `${NEXT_BASE_URL}/onboarding/intro`;
  run(["open", base], { timeout: 45000 });
  run(["wait", "--load", "networkidle"], { timeout: 45000 });
  return evalJson(`JSON.stringify((() => {
    const email = 'audit@nexion.local';
    const now = Date.now();
    const auditOrder = {
      id: 'ORD-AUDIT-0001',
      productId: 'stellarbox-s1',
      productName: 'NexionBox S1',
      quantity: 1,
      unitPrice: 1299,
      discount: 0,
      total: 1299,
      paymentMethod: 'usdt-trc20',
      status: 'paid',
      placedAt: now - 120000,
      paidAt: now - 90000,
      dataCenter: 'Singapore DC',
      timeline: [
        { status: 'placed', ts: now - 120000, note: 'Order received' },
        { status: 'paid', ts: now - 90000, note: 'Settled via usdt-trc20' },
      ],
    };
    if (${JSON.stringify(side)} === 'nextReference') {
      localStorage.setItem('nexion-auth-v1', JSON.stringify({
        state: { isAuthenticated: true, email, onboardingComplete: true },
        version: 2,
      }));
      localStorage.setItem('nexion-orders-v4', JSON.stringify({
        state: { orders: [auditOrder] },
        version: 0,
      }));
    } else {
      const uniAuth = {
        isAuthenticated: true,
        email,
        onboardingComplete: true,
      };
      const uniOrders = { orders: [auditOrder] };
      if (window.uni && typeof window.uni.setStorageSync === 'function') {
        window.uni.setStorageSync('nexion-auth-v1', uniAuth);
        window.uni.setStorageSync('nexion-orders-v4', uniOrders);
      } else {
        localStorage.setItem('nexion-auth-v1', JSON.stringify(uniAuth));
        localStorage.setItem('nexion-orders-v4', JSON.stringify(uniOrders));
      }
    }
    return { ok: true, side: ${JSON.stringify(side)}, auth: localStorage.getItem('nexion-auth-v1') };
  })())`);
}

fs.mkdirSync(SHARDS, { recursive: true });
fs.mkdirSync(SCREENSHOTS, { recursive: true });

const plan = readJson(path.join(AUDIT, "l1-shards.json"));
const shard = plan.shards.find((item) => item.id === shardId);
if (!shard) throw new Error(`Unknown shard: ${shardId}`);
if (!["nextReference", "uniapp"].includes(shard.side)) {
  throw new Error(`Shard ${shardId} is ${shard.side}; use this script only for NEXT-FR-* or UNI-FR-* shards`);
}

const outFile = path.join(SHARDS, `${shardId.toLowerCase()}-runtime.ndjson`);
fs.writeFileSync(outFile, "", "utf8");

const seededState = seedAuditState(shard.side);

for (const route of shard.routes || []) {
  const url = routeUrl(route, shard.side);
  const slug = safeName(route);
  const startedAt = new Date().toISOString();
  const entry = {
    shardId,
    source: shard.side === "uniapp" ? "E-runtime-crawl" : "B-runtime-crawl",
    side: shard.side,
    route,
    url,
    sampledRoute: sampleRoute(route, shard.side),
    startedAt,
    status: "pending",
    evidence: {},
  };
  try {
    run(["open", url], { timeout: 45000 });
    run(["wait", "--load", "networkidle"], { timeout: 45000 });
    const snapshot = run(["snapshot", "-i"], { timeout: 45000 });
    const snapshotInteractive = snapshot
      .split(/\r?\n/)
      .filter((line) => /\bclickable\b|\[button\]|\[link\]|\[input|\[textbox|\[combobox/.test(line))
      .slice(0, 80);
    const snapshotPath = path.join(SHARDS, `${shardId.toLowerCase()}-${slug}-snapshot.txt`);
    fs.writeFileSync(snapshotPath, snapshot, "utf8");
    const screenshotPath = path.join(SCREENSHOTS, `${shardId.toLowerCase()}-${slug}.png`);
    run(["screenshot", screenshotPath], { timeout: 45000 });

    const runtime = evalJson(`JSON.stringify((() => {
      const text = (el) => (el.innerText || el.textContent || '').trim();
      const bodyText = document.body.innerText || '';
      const isVisible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const isClickableCandidate = (el) => {
        const tag = el.tagName.toLowerCase();
        const cls = String(el.className || '').toLowerCase();
        const role = el.getAttribute('role') || '';
        const native = ['button', 'a', 'input', 'textarea', 'select'].includes(tag);
        const semantic = role === 'button' || role === 'link' || el.hasAttribute('tabindex') || el.hasAttribute('onclick');
        const styled = getComputedStyle(el).cursor === 'pointer' || /(btn|button|cta|chip|tab|nav|card|item|row|go|claim|link|toggle|pill|seg|filter)/.test(cls);
        return (native || semantic || styled) && isVisible(el);
      };
      const controls = Array.from(document.querySelectorAll('*'))
        .filter(isClickableCandidate)
        .map((el, index) => ({
        index,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        text: text(el).slice(0, 120),
        aria: el.getAttribute('aria-label') || '',
        href: el.getAttribute('href') || '',
        type: el.getAttribute('type') || '',
        placeholder: el.getAttribute('placeholder') || '',
        disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      }))
      .filter((item) => item.text || item.aria || item.placeholder)
      .filter((item) => item.text.length <= 180 || ['input', 'textarea', 'select'].includes(item.tag))
      .slice(0, 200);
      const tables = Array.from(document.querySelectorAll('table')).map((table, index) => ({
        index,
        headers: Array.from(table.querySelectorAll('th')).map(text),
        rows: table.querySelectorAll('tbody tr, tr').length,
      }));
      const links = controls.filter((item) => item.tag === 'a').map((item) => ({
        text: item.text,
        href: item.href,
        disabled: item.disabled,
      }));
      const errorText = /(404|not found|application error|runtime error|unhandled|hydration failed|missing|failed)/i.test(bodyText);
      const listBaseline = {
        pagination: /页|page|per page|每页|上一页|下一页|加载更多|load more|共\\s*\\d+/.test(bodyText),
        filters: /筛选|过滤|全部|状态|分类|搜索|filter|sort/.test(bodyText),
        search: Boolean(document.querySelector('input[placeholder*="搜索"], input[aria-label*="搜索"], input[type="search"], input[placeholder*="Search"]')),
        sorting: Boolean(document.querySelector('[aria-sort]')) || /排序|sort/i.test(bodyText),
        emptyState: /暂无|空|No data|empty/i.test(bodyText),
      };
      return {
        title: document.title,
        url: location.href,
        bodyTextLength: bodyText.length,
        bodyPreview: bodyText.slice(0, 800),
        controls,
        controlCount: controls.length,
        links,
        tables,
        listBaseline,
        dialogCount: document.querySelectorAll('[role="dialog"],[aria-modal="true"],.modal,.drawer,.scrim').length,
        errorText,
      };
    })())`);

    const isNotFound = runtime.errorText && /(404|not found)/i.test(runtime.bodyPreview || "");
    entry.status = isNotFound ? "route-error" : "captured";
    entry.seededState = seededState?.ok ? { ok: true, side: seededState.side } : seededState;
    entry.evidence = {
      snapshot: path.relative(ROOT, snapshotPath).replace(/\\/g, "/"),
      screenshot: path.relative(ROOT, screenshotPath).replace(/\\/g, "/"),
      snapshotInteractiveCount: snapshotInteractive.length,
      snapshotInteractive,
      runtime,
      routeMatch: runtime.url === url || runtime.url.endsWith(entry.sampledRoute),
    };
  } catch (error) {
    entry.status = "error";
    entry.error = error.message;
  }
  entry.finishedAt = new Date().toISOString();
  lineJson(outFile, entry);
}

try {
  run(["close"], { timeout: 15000 });
} catch {}

const rows = fs
  .readFileSync(outFile, "utf8")
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const summary = {
  shardId,
  side: shard.side,
  routes: (shard.routes || []).length,
  captured: rows.filter((row) => row.status === "captured").length,
  routeErrors: rows.filter((row) => row.status === "route-error").length,
  errors: rows.filter((row) => row.status === "error").length,
  outFile: path.relative(ROOT, outFile).replace(/\\/g, "/"),
};
console.log(JSON.stringify(summary, null, 2));
