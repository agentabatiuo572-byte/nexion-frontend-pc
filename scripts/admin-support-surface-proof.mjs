// Runtime proof for SPEC-L3a01 /content/support.
// Uses agent-browser to prove create FAQ, reply ticket, and close ticket persist after refresh.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = process.env.ADMIN_BASE_URL || "http://localhost:3002";
const session = process.env.AGENT_BROWSER_SESSION || "nexion-support-surface-proof";
const STORE_KEY = "nexion-admin-platform-v1";
const FAQ_KEY = "I.support.faqs";
const TICKET_KEY = "I.support.tickets";
const results = [];

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
          encoding: "utf8",
          input: options.input,
          shell: true,
          timeout: options.timeout || 30000,
        })
      : spawnSync("agent-browser", fullArgs, {
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

function evalJson(body) {
  const helpers = `
    const text = (el) => (el?.innerText || el?.textContent || '').trim();
    const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    const setNativeValue = (el, value) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const byProof = (name) => {
      const el = document.querySelector('[data-proof="' + name + '"]');
      if (!el || !visible(el)) throw new Error('proof control not found: ' + name);
      return el;
    };
    const fillProof = (name, value) => {
      const el = byProof(name);
      setNativeValue(el, value);
      return { name, value };
    };
    const clickProof = (name) => {
      const el = byProof(name);
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.click();
      return { clicked: name, text: text(el) };
    };
    const clickText = (wanted) => {
      const el = Array.from(document.querySelectorAll('button,[role="button"]')).find((node) => text(node) === wanted && visible(node));
      if (!el) throw new Error('button not found: ' + wanted);
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.click();
      return { clicked: wanted };
    };
    const persisted = () => JSON.parse(localStorage.getItem(${JSON.stringify(STORE_KEY)}) || '{"state":{}}').state || {};
    const support = () => {
      const state = persisted();
      const params = state.params || {};
      return {
        faqs: JSON.parse(params[${JSON.stringify(FAQ_KEY)}] || '[]'),
        tickets: JSON.parse(params[${JSON.stringify(TICKET_KEY)}] || '[]'),
        audit: state.audit || [],
        body: document.body.innerText,
      };
    };
  `;
  const encoded = Buffer.from(`JSON.stringify((() => { ${helpers}\n${body} })())`, "utf8").toString("base64");
  const raw = run(["eval", "-b", encoded], { timeout: 30000 });
  try {
    return JSON.parse(JSON.parse(raw));
  } catch {
    return JSON.parse(raw);
  }
}

function wait(ms = 500) {
  run(["wait", String(ms)], { timeout: ms + 5000 });
}

function open(route) {
  run(["open", `${BASE_URL}${route}`], { timeout: 60000 });
  wait(800);
}

function reload() {
  run(["reload"], { timeout: 60000 });
  wait(800);
}

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

async function step(name, fn) {
  try {
    const evidence = await fn();
    results.push({ name, status: "passed", evidence });
  } catch (error) {
    results.push({ name, status: "failed", error: error.message });
    throw error;
  }
}

open("/");
evalJson(`localStorage.removeItem(${JSON.stringify(STORE_KEY)}); return { cleared: true };`);
open("/content/support");

await step("route-business-controls", () => {
  const state = evalJson(`
    return {
      hasFaq: document.body.innerText.includes('Help/FAQ 内容管理'),
      hasSla: document.body.innerText.includes('Ticket 分类与 SLA'),
      hasTicket: document.body.innerText.includes('工单详情与处理'),
      hasReply: document.body.innerText.includes('回复并转待用户'),
      pagerCount: document.querySelectorAll('[data-list-pager="true"]').length,
      inputs: Array.from(document.querySelectorAll('input, textarea, select')).length,
    };
  `);
  expect(state.hasFaq && state.hasSla && state.hasTicket && state.hasReply, "support panels missing");
  expect(state.pagerCount >= 1, "ticket list pager missing");
  expect(state.inputs >= 12, "business controls too few");
  return state;
});

await step("create-faq-persists", () => {
  evalJson(`
    fillProof('support-faq-question', 'Runtime proof FAQ question');
    fillProof('support-faq-answer', 'Runtime proof FAQ answer with support routing and SLA detail.');
    fillProof('support-faq-reason', 'L3a01 runtime proof create FAQ');
    clickProof('support-faq-save');
    return support();
  `);
  wait();
  reload();
  const state = evalJson("return support();");
  const faq = state.faqs.find((row) => row.question === "Runtime proof FAQ question");
  expect(!!faq, "created FAQ not persisted after reload");
  expect(state.body.includes("Runtime proof FAQ question"), "created FAQ not rendered after reload");
  return { faqId: faq.id, count: state.faqs.length };
});

await step("reply-ticket-persists", () => {
  evalJson(`
    fillProof('support-ticket-reply', 'Runtime proof agent reply for TK-1024.');
    fillProof('support-ticket-reply-reason', 'L3a01 runtime proof reply ticket');
    clickProof('support-ticket-reply-save');
    return support();
  `);
  wait();
  reload();
  const state = evalJson("return support();");
  const ticket = state.tickets.find((row) => row.id === "TK-1024");
  expect(!!ticket, "TK-1024 missing after reply");
  expect(ticket.status === "pending_user", `reply did not move status to pending_user: ${ticket.status}`);
  expect(ticket.messages.some((msg) => msg.author === "agent" && msg.body === "Runtime proof agent reply for TK-1024."), "agent reply not persisted");
  return { ticket: ticket.id, status: ticket.status, messages: ticket.messages.length };
});

await step("close-ticket-persists", () => {
  evalJson(`
    fillProof('support-ticket-close-reason', 'L3a01 runtime proof close ticket');
    clickProof('support-ticket-close');
    return support();
  `);
  wait();
  reload();
  const state = evalJson("return support();");
  const ticket = state.tickets.find((row) => row.id === "TK-1024");
  expect(!!ticket, "TK-1024 missing after close");
  expect(ticket.status === "closed", `ticket did not close: ${ticket.status}`);
  expect(state.body.includes("Closed"), "closed status not rendered after reload");
  return { ticket: ticket.id, status: ticket.status };
});

try {
  run(["close"], { timeout: 15000 });
} catch {}

const outFile = path.join(ROOT, "docs", "audit", "shards", "ad-09-support-action-sample.ndjson");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(
  outFile,
  `${JSON.stringify({
    shardId: "AD-09",
    source: "SPEC-L3a01-runtime-proof",
    side: "admin",
    route: "/content/support",
    status: "captured",
    result: {
      classification: "state-persisted",
      tasks: ["create-faq", "reply-ticket", "close-ticket"],
      noObservableChange: 0,
      businessIncompleteModal: 0,
    },
    evidence: {
      script: "scripts/admin-support-surface-proof.mjs",
      persistedKeys: [FAQ_KEY, TICKET_KEY],
      resultCount: results.length,
    },
    finishedAt: new Date().toISOString(),
  })}\n`,
  "utf8",
);

console.log(JSON.stringify({
  status: results.every((row) => row.status === "passed") ? "passed" : "failed",
  baseUrl: BASE_URL,
  session,
  results,
}, null, 2));
