// Runtime proof for FT-013/014/015 UniApp persona walkthroughs.
// This is stricter than the generic action sampler: every step must prove the
// promised business result, not just "some DOM changed".
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UNI_BASE_URL = process.env.UNI_BASE_URL || "http://localhost:5173";
const session =
  process.env.AGENT_BROWSER_SESSION || `nexion-uni-persona-walkthrough-proof-${Date.now()}-${process.pid}`;
const OUT_FILE = path.join(ROOT, "docs", "audit", "shards", "uniapp-persona-walkthrough-proof.ndjson");
const WITHDRAW_ADDRESS = "TVALIDWITHDRAWADDRESS1234567890ABCDE";
const results = [];

function quoteShellArg(arg) {
  const value = String(arg);
  if (process.platform === "win32") return `"${value.replace(/"/g, '\\"')}"`;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function run(args, options = {}) {
  const fullArgs = ["--session", session, ...args];
  const agentBrowserBin = process.env.AGENT_BROWSER_BIN || "agent-browser";
  const result =
    process.platform === "win32"
      ? spawnSync([agentBrowserBin, ...fullArgs.map(quoteShellArg)].join(" "), [], {
          cwd: ROOT,
          encoding: "utf8",
          input: options.input,
          shell: true,
          timeout: options.timeout || 30000,
        })
      : spawnSync(agentBrowserBin, fullArgs, {
          cwd: ROOT,
          encoding: "utf8",
          input: options.input,
          timeout: options.timeout || 30000,
        });
  if (result.status !== 0) {
    throw new Error(
      `agent-browser ${args.join(" ")} failed` +
        `\nstatus=${result.status}` +
        `\nstdout=${result.stdout || ""}` +
        `\nstderr=${result.stderr || ""}`,
    );
  }
  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

function evalJson(body, timeout = 30000) {
  const helpers = `
    const text = (el) => (el?.innerText || el?.textContent || '').trim();
    const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    const bodyText = () => document.body.innerText || '';
    const current = () => ({ href: location.href, body: bodyText() });
    const expect = (condition, label) => {
      if (!condition) throw new Error(label);
    };
    const exactNodes = (wanted, selector = 'uni-view,uni-text,button,a') =>
      Array.from(document.querySelectorAll(selector))
        .filter((el) => text(el) === wanted && visible(el))
        .map((el) => ({ el, rect: el.getBoundingClientRect(), tag: el.tagName, cls: String(el.className || '') }));
    const clickBlockText = (wanted) => {
      const candidates = exactNodes(wanted, 'uni-view,button,a')
        .filter((item) => item.rect.width > 40 && item.rect.height >= 16)
        .sort((a, b) => (a.rect.height >= 38 ? -1 : 1) - (b.rect.height >= 38 ? -1 : 1) || a.rect.width * a.rect.height - b.rect.width * b.rect.height);
      const item = candidates[0];
      if (!item) throw new Error('click target not found: ' + wanted);
      item.el.scrollIntoView({ block: 'center', inline: 'center' });
      item.el.click();
      return { clicked: wanted, tag: item.tag, cls: item.cls, height: item.rect.height };
    };
    const clickCss = (selector) => {
      const el = document.querySelector(selector);
      if (!el || !visible(el)) throw new Error('selector not visible: ' + selector);
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.click();
      return { clicked: selector, text: text(el) };
    };
    const setUniInput = (index, value) => {
      const host = Array.from(document.querySelectorAll('uni-input'))[index];
      if (!host) throw new Error('uni-input not found: ' + index);
      const input = host.querySelector('input');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(input, value);
        else input.value = value;
      }
      host.dispatchEvent(new CustomEvent('input', { bubbles: true, detail: { value } }));
      host.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { value } }));
      return { index, value, hostText: text(host) };
    };
    const store = (key) => uni.getStorageSync(key);
    const clearNexionStorage = () => {
      for (const storage of [localStorage, sessionStorage]) {
        for (const key of Object.keys(storage)) {
          if (/^nexion-/i.test(key)) storage.removeItem(key);
        }
      }
      return {
        localKeys: Object.keys(localStorage).filter((key) => /^nexion-/i.test(key)),
        sessionKeys: Object.keys(sessionStorage).filter((key) => /^nexion-/i.test(key)),
      };
    };
  `;
  const encoded = Buffer.from(`JSON.stringify((() => { ${helpers}\n${body} })())`, "utf8").toString("base64");
  const raw = run(["eval", "-b", encoded], { timeout });
  try {
    return JSON.parse(JSON.parse(raw));
  } catch {
    return JSON.parse(raw);
  }
}

function wait(ms = 500) {
  run(["wait", String(ms)], { timeout: ms + 5000 });
}

function waitForEval(label, body, timeout = 10000, interval = 400) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = evalJson(body, Math.min(10000, timeout));
      if (last?.ok) return last;
    } catch (error) {
      last = error.message;
    }
    wait(interval);
  }
  throw new Error(`${label} did not become true within ${timeout}ms; last=${JSON.stringify(last)}`);
}

function open(hashRoute) {
  const url = `${UNI_BASE_URL}${hashRoute}`;
  run(["open", url], { timeout: 60000 });
  wait(900);
  const state = evalJson("return current();", 15000);
  if (!String(state.href || "").startsWith(url)) {
    throw new Error(`route did not open: expected ${url}, got ${state.href || "unknown"}`);
  }
  return state;
}

function fill(selector, value) {
  run(["fill", selector, value], { timeout: 30000 });
}

function clickText(label) {
  run(["find", "text", label, "click"], { timeout: 30000 });
  wait(250);
}

function clickSelector(selector) {
  run(["scrollintoview", selector], { timeout: 30000 });
  run(["click", selector], { timeout: 30000 });
  wait(250);
}

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

async function step(id, name, fn) {
  const startedAt = new Date().toISOString();
  try {
    const evidence = await fn();
    const row = { id, name, status: "passed", evidence, startedAt, finishedAt: new Date().toISOString() };
    results.push(row);
    return row;
  } catch (error) {
    const row = { id, name, status: "failed", error: error.message, startedAt, finishedAt: new Date().toISOString() };
    results.push(row);
    throw error;
  }
}

try {
  run(["close"], { timeout: 15000 });
} catch {}

open("/#/pages/onboarding/intro");
const seedState = evalJson(`
  clearNexionStorage();
  const now = Date.now();
  uni.setStorageSync('nexion-wallet-pairing-v1', {
    walletPaired: true,
    pairedWalletAddress: 'TTESTWITHDRAWADDRESS1234567890ABCDE',
    pairedNetwork: 'USDT-TRC20',
    complianceCheckId: 'KYC-2026-A99999',
    pairedAt: now,
  });
  uni.setStorageSync('nexion-risk-disclosure-v1', { accepted: true, acceptedAt: now });
  uni.setStorageSync('nexion-points-v1', {
    points: 100,
    history: [{ ts: now, delta: 92, reason: 'Persona proof seed' }],
    lastSignedInAt: 0,
    signInStreak: 0,
    longestStreak: 0,
    streakSavers: 1,
    claimedMilestones: [],
  });
  return {
    seeded: true,
    pairing: store('nexion-wallet-pairing-v1'),
    risk: store('nexion-risk-disclosure-v1'),
    points: store('nexion-points-v1'),
  };
`);
expect(seedState.points?.points === 100, `seed points not written as 100: ${seedState.points?.points}`);
evalJson(`
  location.reload();
  return { reloadedAfterSeed: true };
`);
wait(1200);

await step("FT-013", "withdraw-form-after-kyc", () => {
  open("/#/pages/me/wallet-withdraw");
  const initial = evalJson(`
    const body = bodyText();
    expect(body.includes('KYC-Express verified'), 'withdraw KYC verified banner missing');
    expect(body.includes('Submit withdrawal request'), 'withdraw submit CTA missing');
    return current();
  `);
  fill("input.uni-input-input", "50");
  fill(".nx-withdraw-address-input input.uni-input-input", WITHDRAW_ADDRESS);
  wait(300);
  const seeded = evalJson(`
    return {
      ...current(),
      inputValues: Array.from(document.querySelectorAll('input.uni-input-input')).map((input) => input.value),
      activeClass: document.activeElement?.closest('uni-input')?.className || '',
      points: store('nexion-points-v1'),
    };
  `);
  expect(initial.body.includes("KYC-Express verified"), "withdraw initial KYC state missing");
  expect(seeded.inputValues[0] === "50", `withdraw amount input value mismatch: ${seeded.inputValues[0]}`);
  expect(seeded.inputValues[1] === WITHDRAW_ADDRESS, "withdraw address input value mismatch");
  expect(/nx-withdraw-address-input/.test(seeded.activeClass), "withdraw address input did not receive focus");
  expect(seeded.body.includes("You receive\n$49.00"), "withdraw receive amount did not recalculate to $49.00");
  expect(seeded.points?.points === 100, `withdraw points storage not seeded as 100: ${seeded.points?.points}`);
  expect(/100\s*\/\s*5/.test(seeded.body), "withdraw points requirement not shown as 100 / 5");
  expect(seeded.body.includes("Sufficient"), "withdraw sufficient points message missing");

  clickSelector(".nx-withdraw-submit-cta");
  const proof = waitForEval("withdraw tracking route", `
    const points = store('nexion-points-v1');
    const bills = store('nexion-bills-v1');
    const bill = (bills.bills || []).find((row) => row.type === 'withdraw' && row.amount === -50 && row.status === 'pending');
    const body = bodyText();
    return {
      href: location.href,
      body,
      points,
      bill,
      hasTrackingId: /WD-\\d{8}-\\d{4}/.test(body),
      hasAddress: body.includes(${JSON.stringify(WITHDRAW_ADDRESS)}),
      hasAmount: body.includes('$50.00'),
      ok: location.href.includes('/#/pages/me/wallet-withdraw-tracking') && /WD-\\d{8}-\\d{4}/.test(body),
    };
  `, 10000);
  expect(proof.href.includes("/#/pages/me/wallet-withdraw-tracking"), "withdraw did not route to tracking");
  expect(proof.hasTrackingId, "withdraw tracking id missing");
  expect(proof.hasAddress, "withdraw address missing on tracking page");
  expect(proof.hasAmount, "withdraw amount missing on tracking page");
  expect(proof.points.points === 95, `withdraw points not deducted to 95: ${proof.points.points}`);
  expect(proof.bill?.ref && proof.bill.memo.includes("USDT-TRC20"), "withdraw bill missing or incomplete");
  return {
    href: proof.href,
    pointsAfter: proof.points.points,
    billRef: proof.bill.ref,
    trackingHasAddress: proof.hasAddress,
  };
});

await step("FT-014A", "exchange-nex-to-usdt-confirm-modal", () => {
  open("/#/pages/me/wallet-exchange");
  evalJson(`
    uni.removeStorageSync('nexion-exchange-v1');
    uni.removeStorageSync('nexion-exchange-v3');
    location.reload();
    return { resetExchange: true };
  `);
  wait(1000);
  fill("input.uni-input-input", "10");
  wait(300);
  const beforeConfirm = evalJson(`
    const body = bodyText();
    expect(body.includes('You receive'), 'exchange receive panel missing');
    expect(!body.includes('You receive\\n0\\nUSDT'), 'exchange receive amount did not recalculate');
    return current();
  `);
  expect(beforeConfirm.body.includes("Confirm Exchange"), "exchange confirm CTA missing before modal");
  clickText("Confirm Exchange");
  wait(300);
  const modal = evalJson(`
    const modal = document.querySelector('.nx-modal');
    expect(!!modal && visible(modal), 'exchange confirm modal missing');
    const modalText = text(modal);
    expect(modalText.includes('NEX 10'), 'exchange modal missing from amount');
    expect(modalText.includes('USDT'), 'exchange modal missing to symbol');
    expect(!!document.querySelector('.nx-modal .nx-btn--primary'), 'exchange modal primary button missing');
    clickCss('.nx-modal .nx-btn--primary');
    return { modalText };
  `);
  wait(1600);
  const proof = evalJson(`
    const exchange = store('nexion-exchange-v1');
    const v3 = store('nexion-exchange-v3');
    const bills = store('nexion-bills-v1');
    const history = exchange.history || [];
    const swap = history[0];
    const swapBills = (bills.bills || []).filter((row) => row.type === 'swap' && row.ref === swap?.id);
    return {
      href: location.href,
      body: bodyText(),
      swap,
      v3,
      swapBills,
    };
  `);
  expect(proof.swap?.fromSym === "NEX" && proof.swap.fromAmount === 10, "exchange swap history missing NEX debit");
  expect(proof.swap?.toSym === "USDT" && proof.swap.toAmount > 0, "exchange swap history missing USDT credit");
  expect(proof.v3.todayUserUsedUSD > 0 && proof.v3.lifetimeExchangedUSD > 0, "exchange v3 caps not recorded");
  expect(proof.swapBills.length === 2, `exchange bills expected 2, got ${proof.swapBills.length}`);
  expect(proof.body.includes("Recent swaps") && proof.body.includes("10 NEX"), "exchange history not rendered after swap");
  return {
    href: proof.href,
    modalText: modal.modalText,
    swapId: proof.swap.id,
    toAmount: proof.swap.toAmount,
    v3TodayUsed: proof.v3.todayUserUsedUSD,
    billCount: proof.swapBills.length,
  };
});

await step("FT-014B", "repurchase-writes-points-staking-bill", () => {
  open("/#/pages/me/wallet-repurchase");
  const before = evalJson(`
    const points = store('nexion-points-v1');
    const staking = store('nexion-v3-staking-v1');
    const bills = store('nexion-bills-v1');
    return {
      body: bodyText(),
      pointsBefore: points.points,
      stakeCountBefore: (staking.positions || []).length,
      billCountBefore: (bills.bills || []).length,
    };
  `);
  expect(before.body.includes("Re-invest $200.00"), "repurchase CTA missing");
  clickSelector(".nx-repurchase-submit-cta");
  wait(900);
  const proof = evalJson(`
    const points = store('nexion-points-v1');
    const staking = store('nexion-v3-staking-v1');
    const bills = store('nexion-bills-v1');
    const position = (staking.positions || []).find((row) => row.amountUSDT === 200 && row.termDays === 90 && row.status === 'active');
    const bill = (bills.bills || []).find((row) => row.type === 'stake' && row.amount === -200 && row.memo.includes('+100 points'));
    return {
      href: location.href,
      body: bodyText(),
      points,
      position,
      bill,
    };
  `);
  expect(proof.points.points === before.pointsBefore + 100, `repurchase points did not increase by 100: ${before.pointsBefore} -> ${proof.points.points}`);
  expect(!!proof.position, "repurchase staking position missing");
  expect(!!proof.bill, "repurchase stake bill missing");
  expect(proof.body.includes(`${proof.points.points} points`), "repurchase updated points not rendered");
  return {
    href: proof.href,
    pointsBefore: before.pointsBefore,
    pointsAfter: proof.points.points,
    positionId: proof.position.id,
    billRef: proof.bill.ref,
  };
});

async function teamNav(target) {
  open("/#/pages/team/team");
  clickSelector(target.selector);
  wait(800);
  const proof = evalJson(`
    const body = bodyText();
    return { href: location.href, body };
  `);
  expect(proof.href.includes(target.route), `${target.id} did not navigate to ${target.route}: ${proof.href}`);
  for (const needle of target.needles) {
    expect(proof.body.includes(needle), `${target.id} missing page needle: ${needle}`);
  }
  return { href: proof.href, needles: target.needles };
}

await step("FT-015A", "team-hub-to-commissions", () =>
  teamNav({
    id: "commissions",
    selector: ".nx-team-commissions-link",
    route: "/#/pages/team/commissions",
    needles: ["Commissions", "Withdrawable", "Network royalty"],
  }),
);

await step("FT-015B", "team-hub-to-rank", () =>
  teamNav({
    id: "rank",
    selector: ".nx-team-rank-link",
    route: "/#/pages/team/rank",
    needles: ["V Rank", "Current rank", "V3 Captain"],
  }),
);

await step("FT-015C", "team-hub-to-binary", () =>
  teamNav({
    id: "binary",
    selector: ".nx-team-binary-link",
    route: "/#/pages/team/binary",
    needles: ["Balance Match", "Track A", "Track B"],
  }),
);

await step("FT-015D", "team-hub-to-leadership-pool", () =>
  teamNav({
    id: "leadership-pool",
    selector: ".nx-team-leadership-pool-link",
    route: "/#/pages/team/leadership-pool",
    needles: ["Global Leadership Pool", "Week pool", "Vote weights"],
  }),
);

try {
  run(["close"], { timeout: 15000 });
} catch {}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(
  OUT_FILE,
  results
    .map((row) =>
      JSON.stringify({
        shardId: "UNI-PERSONA-FT-013-015",
        source: "SPEC-L3c02-runtime-proof",
        side: "uniapp",
        ...row,
      }),
    )
    .join("\n") + "\n",
  "utf8",
);

console.log(JSON.stringify({
  status: results.every((row) => row.status === "passed") ? "passed" : "failed",
  baseUrl: UNI_BASE_URL,
  session,
  outFile: path.relative(ROOT, OUT_FILE).replace(/\\/g, "/"),
  results,
}, null, 2));
