// Runtime action sampler for Next reference and UniApp H5 front shards.
// Route-level crawl proves pages render; this script samples business controls
// and records whether clicking them creates a real observable effect.
import { createHash } from "node:crypto";
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
const maxActionsPerRoute = Number(process.env.FRONT_ACTION_SAMPLE_LIMIT || 4);
const session = process.env.AGENT_BROWSER_SESSION || `nexion-front-actions-${shardId.toLowerCase()}`;

const ACTION_RE =
  /领取|获取|连接|访问|设置|邀请|购买|下单|支付|质押|赎回|提现|充值|兑换|买入|卖出|回购|复制|打开|提交|确认|继续|开始|完成|保存|取消|重置|触发|推送|快进|加入|种入|清|查看|联系客服|工单|领取|Claim|Get|Connect|Visit|Browse|Set|Invite|Buy|Sell|Swap|Checkout|Pay|Stake|Redeem|Withdraw|Deposit|Top up|Repurchase|Copy|Open|Submit|Confirm|Continue|Start|Complete|Save|Cancel|Reset|Trigger|Push|Seed|Fast-forward|View|Contact|Sign in|ticket/i;
const SKIP_RE =
  /^(NEXION|Back|返回|通知|Battery|Language|语言|English|简体中文|日本語|한국어|Русский|Español|Português|العربية|Deutsch|Français)$/i;
const NON_ACTION_LABEL_RE =
  /^(Payment|Confirm|Pay|Activate|Live|Entry|viewing|sold|Quantity|Daily|Monthly|Annual|Payback|Hardware|Withdrawal|Withdraw|Withdrawable|WITHDRAWN|Inviter|Confirmations|Deposit|Payment method|Withdrawal Pending|Withdrawal Address|Withdrawal Status|Withdrawal pending\b.*|CONFIRMED ON-CHAIN|Bundle checkout|Visit the store to find a device that fits your goals\.|CLAIMED|Completed|Ready to claim|Settlement lifecycle|Settlement timeline|Pays to top 50|Resets?\s+in\b.*|Start your streak today|Stake plans|Invite more direct friends)$/i;
const DIRECT_ACTION_PREFIX_RE =
  /^(立即|获取|查看|在链上查看|在外部|下载|买入|卖出|进入|连接|访问|设置|邀请|购买|下单|支付|质押|赎回|提现|充值|兑换|回购|复制|打开|提交|确认|继续|开始|完成|保存|取消|重置|触发|推送|快进|加入|种入|清|联系客服|工单|Claim|Get|Connect|Visit|Browse|Set|Invite|Buy|Sell|Swap|Checkout|Pay|Stake|Redeem|Withdraw|Deposit|Top up|Repurchase|Copy|Open|Submit|Confirm|Continue|Start|Complete|Save|Cancel|Reset|Trigger|Push|Seed|Fast-forward|View|Contact|Sign in|Use Max|Read\b|Etherscan|TRONScan)/i;
const STRUCTURAL_UNI_TAGS = new Set(["uni-app", "uni-page", "uni-page-wrapper", "uni-page-body"]);

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

function evalJson(script, timeout = 30000) {
  const encoded = Buffer.from(script, "utf8").toString("base64");
  const raw = run(["eval", "-b", encoded], { timeout });
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

function safeName(value) {
  return (
    String(value)
      .replace(/^\/+/, "")
      .replace(/^#\/?/, "hash-")
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90) || "root"
  );
}

function hashText(text) {
  return createHash("sha256").update(text || "").digest("hex").slice(0, 16);
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
      const uniAuth = { isAuthenticated: true, email, onboardingComplete: true };
      const uniOrders = { orders: [auditOrder] };
      if (window.uni && typeof window.uni.setStorageSync === 'function') {
        window.uni.setStorageSync('nexion-auth-v1', uniAuth);
        window.uni.setStorageSync('nexion-orders-v4', uniOrders);
      }
      localStorage.setItem('nexion-auth-v1', JSON.stringify(uniAuth));
      localStorage.setItem('nexion-orders-v4', JSON.stringify(uniOrders));
    }
    return { ok: true, side: ${JSON.stringify(side)} };
  })())`);
}

function probe() {
  const data = evalJson(`JSON.stringify((() => {
    const text = (el) => (el.innerText || el.textContent || '').trim();
    const bodyText = document.body.innerText || '';
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const controlInfo = (el, index) => ({
      index,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      text: text(el).slice(0, 180),
      aria: el.getAttribute('aria-label') || '',
      href: el.getAttribute('href') || '',
      type: el.getAttribute('type') || '',
      placeholder: el.getAttribute('placeholder') || '',
      disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
    });
    const isClickableCandidate = (el) => {
      const tag = el.tagName.toLowerCase();
      const cls = String(el.className || '').toLowerCase();
      const role = el.getAttribute('role') || '';
      const native = ['button', 'a', 'input', 'textarea', 'select'].includes(tag);
      const uniNative = ['uni-button', 'uni-input', 'uni-textarea', 'uni-picker'].includes(tag);
      const semantic = role === 'button' || role === 'link' || el.hasAttribute('tabindex') || el.hasAttribute('onclick');
      const styled = getComputedStyle(el).cursor === 'pointer' || /(active:|btn|button|cta|chip|tab|nav|card|item|row|go|claim|link|toggle|pill|seg|filter)/.test(cls);
      return (native || uniNative || semantic || styled) && isVisible(el);
    };
    const controls = Array.from(document.querySelectorAll('*'))
      .filter(isClickableCandidate)
      .map(controlInfo)
      .filter((item) => item.text || item.aria || item.placeholder || item.href)
      .slice(0, 240);
    const modalSelector = '[role="dialog"],[aria-modal="true"],.modal,.drawer,.scrim,.sheet,.uni-popup,.u-popup,uni-modal,[class*="popup"],[class*="drawer"],[class*="sheet"]';
    const dialogEls = Array.from(document.querySelectorAll(modalSelector)).filter(isVisible);
    const dialogs = dialogEls.map((el) => text(el).slice(0, 1200));
    const fixedTexts = Array.from(document.querySelectorAll('div,section,aside,uni-view'))
      .filter((el) => {
        const style = getComputedStyle(el);
        return (style.position === 'fixed' || style.position === 'sticky') && isVisible(el);
      })
      .map(text)
      .filter(Boolean)
      .slice(0, 20);
    const storage = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && /nexion|pinia|uni/i.test(key)) storage[key] = localStorage.getItem(key);
    }
    return {
      title: document.title,
      url: location.href,
      bodyText,
      bodyTextLength: bodyText.length,
      bodyPreview: bodyText.slice(0, 500),
      controls,
      dialogCount: dialogs.length,
      dialogs,
      fixedTexts,
      storage,
      activeElement: document.activeElement ? {
        tag: document.activeElement.tagName.toLowerCase(),
        text: text(document.activeElement).slice(0, 80),
        aria: document.activeElement.getAttribute('aria-label') || '',
      } : null,
    };
  })())`);
  return {
    ...data,
    bodyText: undefined,
    bodyHash: hashText(data.bodyText || ""),
    storage: undefined,
    storageHash: hashText(JSON.stringify(data.storage || {})),
  };
}

function actionLabel(control) {
  const value = (control.aria || control.text || control.placeholder || control.href || "").trim();
  return value.replace(/\s+/g, " ").slice(0, 120);
}

function normalizedActionKey(control) {
  return [control.tag, control.role, actionLabel(control), control.href || ""].join("|").toLowerCase();
}

function labelsForControl(control, side) {
  const primary = actionLabel(control);
  if (side !== "uniapp") return primary ? [primary] : [];
  const values = [
    control.aria || "",
    control.placeholder || "",
    ...String(control.text || "")
      .split(/\n+/)
      .map((line) => line.trim()),
  ]
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return values.filter((value) => DIRECT_ACTION_PREFIX_RE.test(value));
}

function uniqueBusinessActions(routeRow) {
  const controls = routeRow.evidence?.runtime?.controls || [];
  const side = routeRow.side || "";
  const seen = new Set();
  const actions = [];
  for (const control of controls) {
    if (control.disabled) continue;
    if (side === "nextReference") {
      const tag = String(control.tag || "");
      const role = String(control.role || "");
      if (["textarea", "select"].includes(tag)) continue;
      if (tag === "input" && !["button", "submit"].includes(String(control.type || "").toLowerCase())) continue;
      const isNativeAction = ["button", "a", "input", "select", "textarea"].includes(tag);
      const isSemanticAction = ["button", "link"].includes(role) || Boolean(control.href);
      if (!isNativeAction && !isSemanticAction) continue;
    }
    for (const label of labelsForControl(control, side)) {
      if (STRUCTURAL_UNI_TAGS.has(String(control.tag || ""))) continue;
      if (side === "uniapp" && label.length > 70) continue;
      if (!label || SKIP_RE.test(label) || NON_ACTION_LABEL_RE.test(label)) continue;
      if (side === "uniapp" && /`/.test(label)) continue;
      if (side === "uniapp" && /^OpenSea floor\b/i.test(label)) continue;
      if (!ACTION_RE.test(label)) continue;
      if (label.length > 180 && !/领取|获取|购买|支付|提现|充值|兑换|买入|卖出|Claim|Buy|Pay|Withdraw|Deposit|Swap/i.test(label)) {
        continue;
      }
      const key =
        side === "uniapp"
          ? `${label.toLowerCase()}|${control.href || ""}`
          : `${normalizedActionKey(control)}|${label.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      actions.push({
        label,
        text: control.text || "",
        aria: control.aria || "",
        href: control.href || "",
        tag: control.tag || "",
        type: control.type || "",
      });
      if (actions.length >= maxActionsPerRoute) break;
    }
    if (actions.length >= maxActionsPerRoute) break;
  }
  return actions;
}

function clickCandidate(candidate) {
  return evalJson(`JSON.stringify((() => {
    const candidate = ${JSON.stringify(candidate)};
    const text = (el) => (el.innerText || el.textContent || '').trim();
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const all = Array.from(document.querySelectorAll('button,a,input,textarea,select,[role="button"],[role="link"],[tabindex],uni-view,uni-text,uni-button,uni-input'));
    const score = (el) => {
      if (!isVisible(el)) return -1;
      const tag = el.tagName.toLowerCase();
      const elText = text(el);
      const aria = el.getAttribute('aria-label') || '';
      const href = el.getAttribute('href') || '';
      let value = 0;
      if (candidate.href && href === candidate.href) value += 8;
      if (candidate.aria && aria === candidate.aria) value += 6;
      if (candidate.text && elText === candidate.text) value += 10;
      if (candidate.label && (elText === candidate.label || aria === candidate.label)) value += 7;
      if (candidate.label && elText.includes(candidate.label)) value += 4;
      if (candidate.text && candidate.text.includes(elText) && elText.length >= 2) value += 2;
      if (candidate.tag && tag === candidate.tag) value += 1;
      if (['button', 'link'].includes(el.getAttribute('role') || '')) value += 3;
      if (elText.length > String(candidate.label || '').length + 80) value -= 4;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') value -= 20;
      return value;
    };
    const matches = all
      .map((el) => ({ el, score: score(el), tag: el.tagName.toLowerCase(), text: text(el).slice(0, 160), aria: el.getAttribute('aria-label') || '', href: el.getAttribute('href') || '' }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    const picked = matches[0];
    if (!picked) return { clicked: false, reason: 'candidate-not-found', candidate, matchCount: 0 };
    picked.el.scrollIntoView({ block: 'center', inline: 'center' });
    picked.el.click();
    return { clicked: true, candidate, matchCount: matches.length, clickedText: picked.text, clickedAria: picked.aria, clickedHref: picked.href, clickedTag: picked.tag, score: picked.score };
  })())`);
}

function classify(before, after, clickResult) {
  const stripHash = (value) => String(value || "").replace(/#.*$/, "");
  const flags = {
    urlChanged: before.url !== after.url,
    hashOnlyUrlChanged: stripHash(before.url) === stripHash(after.url) && before.url !== after.url,
    bodyChanged: before.bodyHash !== after.bodyHash,
    dialogChanged: before.dialogCount !== after.dialogCount,
    fixedChanged: JSON.stringify(before.fixedTexts) !== JSON.stringify(after.fixedTexts),
    storageChanged: before.storageHash !== after.storageHash,
    focusChanged: JSON.stringify(before.activeElement) !== JSON.stringify(after.activeElement),
  };
  if (!clickResult.clicked) return { classification: "click-target-missing", flags };
  if (after.url.endsWith("#") && !flags.dialogChanged && !flags.storageChanged) {
    return { classification: "hash-only-no-content", flags };
  }
  if (flags.hashOnlyUrlChanged && !flags.bodyChanged && !flags.dialogChanged && !flags.fixedChanged && !flags.storageChanged) {
    return { classification: "hash-only-no-content", flags };
  }
  if (flags.urlChanged) return { classification: "route-navigation", flags };
  if (flags.dialogChanged) return { classification: "modal-or-sheet", flags };
  if (flags.storageChanged) return { classification: "state-write", flags };
  if (flags.fixedChanged) return { classification: "observable-change", flags };
  if (flags.bodyChanged) return { classification: "body-only-change", flags };
  return { classification: "no-observable-change", flags };
}

fs.mkdirSync(SHARDS, { recursive: true });
fs.mkdirSync(SCREENSHOTS, { recursive: true });

const plan = readJson(path.join(AUDIT, "l1-shards.json"));
const shard = plan.shards.find((item) => item.id === shardId);
if (!shard) throw new Error(`Unknown shard: ${shardId}`);
if (!["nextReference", "uniapp"].includes(shard.side)) {
  throw new Error(`Shard ${shardId} is ${shard.side}; use this script only for NEXT-FR-* or UNI-FR-* shards`);
}

const routeEvidenceFile = path.join(SHARDS, `${shardId.toLowerCase()}-runtime.ndjson`);
if (!fs.existsSync(routeEvidenceFile)) {
  throw new Error(`Missing route evidence file: ${path.relative(ROOT, routeEvidenceFile)}`);
}

const routeRows = fs
  .readFileSync(routeEvidenceFile, "utf8")
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((row) => row.status === "captured");

const outFile = path.join(SHARDS, `${shardId.toLowerCase()}-front-action-sample.ndjson`);
fs.writeFileSync(outFile, "", "utf8");

const seededState = seedAuditState(shard.side);

for (const routeRow of routeRows) {
  let actions = [];
  try {
    run(["open", routeUrl(routeRow.route, shard.side)], { timeout: 45000 });
    run(["wait", "--load", "networkidle"], { timeout: 45000 });
    const current = probe();
    actions = uniqueBusinessActions({
      ...routeRow,
      side: shard.side,
      evidence: { runtime: { controls: current.controls || [] } },
    });
  } catch {}
  for (const action of actions) {
    const route = routeRow.route;
    const url = routeUrl(route, shard.side);
    const actionSlug = safeName(action.label);
    const routeSlug = safeName(route);
    const entry = {
      shardId,
      source: shard.side === "uniapp" ? "E-runtime-action-sample" : "B-runtime-action-sample",
      side: shard.side,
      route,
      url,
      action,
      seededState: seededState?.ok ? { ok: true, side: seededState.side } : seededState,
      startedAt: new Date().toISOString(),
      status: "pending",
    };
    try {
      run(["open", url], { timeout: 45000 });
      run(["wait", "--load", "networkidle"], { timeout: 45000 });
      const before = probe();
      if (before.url === "about:blank" || before.bodyTextLength === 0) {
        throw new Error(`route did not load before action sampling: ${url}`);
      }
      const clickResult = clickCandidate(action);
      run(["wait", "900"], { timeout: 5000 });
      const after = probe();
      const screenshotPath = path.join(SCREENSHOTS, `${shardId.toLowerCase()}-${routeSlug}-${actionSlug}-front-after.png`);
      run(["screenshot", screenshotPath], { timeout: 45000 });
      entry.status = "sampled";
      entry.clickResult = clickResult;
      entry.result = classify(before, after, clickResult);
      entry.evidence = {
        screenshot: path.relative(ROOT, screenshotPath).replace(/\\/g, "/"),
        before: {
          url: before.url,
          bodyHash: before.bodyHash,
          bodyTextLength: before.bodyTextLength,
          dialogCount: before.dialogCount,
          fixedTexts: before.fixedTexts,
          storageHash: before.storageHash,
        },
        after: {
          url: after.url,
          bodyHash: after.bodyHash,
          bodyTextLength: after.bodyTextLength,
          bodyPreview: after.bodyPreview,
          dialogCount: after.dialogCount,
          dialogs: after.dialogs,
          fixedTexts: after.fixedTexts,
          storageHash: after.storageHash,
        },
      };
    } catch (error) {
      entry.status = "error";
      entry.error = error.message;
    }
    entry.finishedAt = new Date().toISOString();
    lineJson(outFile, entry);
  }
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
  routes: routeRows.length,
  samples: rows.length,
  sampled: rows.filter((row) => row.status === "sampled").length,
  errors: rows.filter((row) => row.status === "error").length,
  noObservableChange: rows.filter((row) => row.result?.classification === "no-observable-change").length,
  clickTargetMissing: rows.filter((row) => row.result?.classification === "click-target-missing").length,
  hashOnlyNoContent: rows.filter((row) => row.result?.classification === "hash-only-no-content").length,
  routeNavigation: rows.filter((row) => row.result?.classification === "route-navigation").length,
  modalOrSheet: rows.filter((row) => row.result?.classification === "modal-or-sheet").length,
  stateWrite: rows.filter((row) => row.result?.classification === "state-write").length,
  observableChange: rows.filter((row) => row.result?.classification === "observable-change").length,
  bodyOnlyChange: rows.filter((row) => row.result?.classification === "body-only-change").length,
  outFile: path.relative(ROOT, outFile).replace(/\\/g, "/"),
};
console.log(JSON.stringify(summary, null, 2));
