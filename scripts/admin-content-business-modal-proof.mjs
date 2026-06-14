// Runtime proof for SPEC-L2a02 content-domain business modals.
// Proves each modal has task-specific controls, persists business fields, and shows visible state after reopen.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = process.env.ADMIN_BASE_URL || "http://localhost:3002";
const session = process.env.AGENT_BROWSER_SESSION || "nexion-content-business-modal-proof";
const HELPER_SCRIPT = path.join(ROOT, "scripts", "admin-content-business-modal-helpers.js");
const STORE_KEY = "nexion-admin-platform-v1";
const results = [];

function quoteShellArg(arg) {
  const value = String(arg);
  if (process.platform === "win32") return `"${value.replace(/"/g, '\\"')}"`;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function run(args, options = {}) {
  const fullArgs = ["--session", session, "--init-script", HELPER_SCRIPT, ...args];
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
        `\nstdout=${result.stdout || ""}` +
        `\nstderr=${result.stderr || ""}`,
    );
  }
  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

function evalJson(body) {
  const prelude = `
    const h = window.__nexionProof;
    if (!h) throw new Error("proof helper init script missing");
    const {
      text, visible, controls, labelText, setNativeValue, fillByLabel,
      selectByLabel, clickExact, clickInRow, clickRow, fillReason,
      assertConfirmDisabled, assertConfirmEnabled, submitConfirm, bodyText,
      persisted,
    } = h;
  `;
  const encoded = Buffer.from(`JSON.stringify((() => { ${prelude}\n${body} })())`, "utf8").toString("base64");
  const raw = run(["eval", "-b", encoded], { timeout: 30000 });
  try {
    return JSON.parse(JSON.parse(raw));
  } catch {
    return JSON.parse(raw);
  }
}

function evalPageMeta() {
  const encoded = Buffer.from("JSON.stringify({ href: location.href, ready: document.readyState })", "utf8").toString("base64");
  const raw = run(["eval", "-b", encoded], { timeout: 15000 });
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
  const expected = `${BASE_URL}${route}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    run(["open", expected], { timeout: 60000 });
    wait(900 + attempt * 400);
    const meta = evalPageMeta();
    if (meta.href?.startsWith(expected)) return;
  }
  const meta = evalPageMeta();
  throw new Error(`route did not open: expected ${expected}, got ${meta.href || "unknown"}`);
}

function reopenAndRead(route) {
  open(route);
  return evalJson("return persisted();");
}

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function auditHas(state, text) {
  return (state.audit || []).some((entry) => String(entry.action || "").includes(text));
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

try {
  run(["close", "--all"], { timeout: 15000 });
} catch {}

open("/");
evalJson(`localStorage.removeItem(${JSON.stringify(STORE_KEY)}); return { cleared: true };`);

await step("i18n-edit-guard-and-visible-draft", () => {
  open("/content/i18n");
  evalJson(`clickExact('编辑(中英同步)'); return { opened: true };`);
  wait();
  const modal = evalJson(`
    return {
      form: !!document.querySelector('[data-business-form="localized-copy"]'),
      controls: controls().map((el) => labelText(el)).join('\\n'),
    };
  `);
  expect(modal.form, "localized-copy business form missing");
  expect(/中文 zh 文案/.test(modal.controls) && /英文 en copy/.test(modal.controls), "i18n zh/en controls missing");
  evalJson(`
    fillByLabel('中文 zh 文案', 'L2a02 缺占位符');
    fillByLabel('英文 en copy', 'L2a02 missing placeholder');
    fillReason('L2a02 i18n guard proof ticket 3001');
    assertConfirmDisabled();
    const body = bodyText();
    if (!body.includes('占位符 {amount}') || !body.includes('占位符 {nex}')) throw new Error('placeholder disabled reason missing');
    fillByLabel('中文 zh 文案', 'L2a02 完成 {amount} 并获得 {nex} NEX');
    fillByLabel('英文 en copy', 'L2a02 earn {nex} after {amount}');
    assertConfirmEnabled();
    submitConfirm();
    return { submitted: true };
  `);
  wait();
  const state = reopenAndRead("/content/i18n");
  const page = evalJson(`
    const body = bodyText();
    return {
      hasPreview: !!document.querySelector('[data-proof="i18n-draft-preview"]'),
      visibleZh: body.includes('L2a02 完成 {amount} 并获得 {nex} NEX'),
      visibleEn: body.includes('L2a02 earn {nex} after {amount}'),
    };
  `);
  expect(page.hasPreview && page.visibleZh && page.visibleEn, "i18n saved draft not visible after reopen");
  expectEqual(state.params?.["I.i18n.milestones.earnCross.draft.zh"], "L2a02 完成 {amount} 并获得 {nex} NEX", "i18n zh persisted");
  expect(auditHas(state, "编辑草稿 milestones.earnCross"), "i18n audit missing");
  return { status: state.params["I.i18n.milestones.earnCross.status"], preview: page };
});

await step("i18n-repair-updates-integrity", () => {
  open("/content/i18n");
  evalJson(`clickInRow('缺镜像 (zh)', '修复'); return { opened: true };`);
  wait();
  evalJson(`
    fillByLabel('中文 zh 文案', 'L2a02 缺镜像修复中文镜像 · {amount}');
    fillByLabel('英文 en copy', 'L2a02 missing mirror repaired English · {amount}');
    fillReason('L2a02 i18n repair proof ticket 3002');
    assertConfirmEnabled();
    submitConfirm();
    return { submitted: true };
  `);
  wait();
  const state = reopenAndRead("/content/i18n");
  const page = evalJson(`
    const body = bodyText();
    return { visibleIntegrity: body.includes('完整性问题') && body.includes('7 处') };
  `);
  expectEqual(state.params?.["I.i18n.fix.缺镜像 (zh)"], "fixed", "i18n repair persisted");
  expect(page.visibleIntegrity, "integrity count did not visibly decrease after repair");
  return { integrity: "7 visible" };
});

await step("course-authoring-draft-visible-after-reopen", () => {
  open("/content/learn");
  evalJson(`clickExact('+ 新建课程'); return { opened: true };`);
  wait();
  evalJson(`
    fillByLabel('课程 slug', 'l2a02-proof-course');
    selectByLabel('分类|category', 'Security');
    selectByLabel('形式|format', 'Video');
    selectByLabel('难度|difficulty', 'Advanced');
    selectByLabel('时长|duration', '12 min');
    fillByLabel('奖励|reward', '12');
    selectByLabel('发布状态|publish state', 'draft');
    fillByLabel('中文标题', 'L2a02 安全课程');
    fillByLabel('English title', 'L2a02 Security Course');
    fillByLabel('中文正文', 'L2a02 课程正文与完成条件');
    fillByLabel('English body', 'L2a02 course body and completion criteria');
    fillReason('L2a02 course authoring proof ticket 3003');
    assertConfirmEnabled();
    submitConfirm();
    return { submitted: true };
  `);
  wait();
  const state = reopenAndRead("/content/learn");
  const page = evalJson(`
    const body = bodyText();
    return {
      slug: body.includes('l2a02-proof-course'),
      title: body.includes('L2a02 安全课程'),
      draft: body.includes('draft'),
      duration: body.includes('12 min'),
      reward: body.includes('12 NEX'),
    };
  `);
  expect(Object.values(page).every(Boolean), `course draft not fully visible after reopen: ${JSON.stringify(page)}`);
  expectEqual(state.params?.["I.tutorial.l2a02-proof-course.status"], "draft", "course status persisted");
  expectEqual(state.params?.["I.tutorial.l2a02-proof-course.duration"], "12 min", "course duration persisted");
  expect(state.params?.["I.tutorial.drafts"]?.includes("l2a02-proof-course"), "course registry missing draft");
  return { page, registry: state.params["I.tutorial.drafts"] };
});

await step("copy-ab-draft-visible-after-reopen", () => {
  open("/content/copy-ab");
  evalJson(`clickExact('编辑草稿 v8'); return { opened: true };`);
  wait();
  evalJson(`
    fillByLabel('变体|版本号|variant', 'v8-l2a02');
    fillByLabel('投放位置|surface', 'Home');
    selectByLabel('受众|audience', 'P3 · 全语言');
    fillByLabel('分流比例|traffic split', '25');
    fillByLabel('中文 zh 文案', 'L2a02 复投 {amount} 后获得 {nex} NEX');
    fillByLabel('英文 en copy', 'L2a02 reinvest {amount} and earn {nex} NEX');
    fillByLabel('版本说明|version note', 'L2a02 variant proof note');
    fillReason('L2a02 copy draft proof ticket 3004');
    assertConfirmEnabled();
    submitConfirm();
    return { submitted: true };
  `);
  wait();
  const state = reopenAndRead("/content/copy-ab");
  const page = evalJson(`
    const body = bodyText();
    const preview = document.querySelector('[data-proof="copy-draft-preview"]')?.innerText || '';
    return {
      hasPreview: !!preview,
      zh: body.includes('L2a02 复投 {amount} 后获得 {nex} NEX'),
      audience: preview.includes('P3 · 全语言'),
      split: preview.includes('25%'),
      note: preview.includes('L2a02 variant proof note'),
    };
  `);
  expect(Object.values(page).every(Boolean), `copy draft preview incomplete: ${JSON.stringify(page)}`);
  expectEqual(state.params?.["I.copy.home.conversionBanner.draft.version"], "v8-l2a02", "copy draft variant persisted");
  expectEqual(state.params?.["I.copy.home.conversionBanner.draft.trafficSplit"], "25", "copy draft split persisted");
  return { page };
});

await step("disclosure-draft-visible-after-reopen", () => {
  open("/content/disclosure");
  evalJson(`clickExact('草拟新版(SFC v13)'); return { opened: true };`);
  wait();
  evalJson(`
    fillByLabel('版本号|version', 'v13-l2a02');
    fillByLabel('法域|jurisdiction', 'SFC');
    selectByLabel('语言范围|language scope', 'en+zh');
    fillByLabel('生效日|effective date', '2026-07-01');
    selectByLabel('re-ack', 'true');
    fillByLabel('中文版本正文', 'L2a02 披露中文正文');
    fillByLabel('English version body', 'L2a02 disclosure English body');
    fillReason('L2a02 disclosure draft proof ticket 3005');
    assertConfirmEnabled();
    submitConfirm();
    return { submitted: true };
  `);
  wait();
  const state = reopenAndRead("/content/disclosure");
  const page = evalJson(`
    const body = bodyText();
    const preview = document.querySelector('[data-proof="disclosure-draft-preview"]')?.innerText || '';
    return {
      hasPreview: !!preview,
      version: preview.includes('v13-l2a02'),
      effectiveDate: preview.includes('2026-07-01'),
      reack: preview.includes('true'),
      zh: body.includes('L2a02 披露中文正文'),
      en: body.includes('L2a02 disclosure English body'),
    };
  `);
  expect(Object.values(page).every(Boolean), `disclosure draft preview incomplete: ${JSON.stringify(page)}`);
  expectEqual(state.params?.["I.disclosure.SFC.draft.effectiveDate"], "2026-07-01", "disclosure effective date persisted");
  expectEqual(state.params?.["I.disclosure.SFC.draft.requiresReack"], "true", "disclosure re-ack persisted");
  return { page };
});

await step("campaign-edit-visible-list-and-detail-after-reopen", () => {
  open("/content/notifications");
  evalJson(`clickInRow('CMP-2619', '编辑'); return { opened: true };`);
  wait();
  evalJson(`
    fillByLabel('通知标题|title', 'L2a02 7 月费率说明');
    fillByLabel('通知正文|body', 'L2a02 campaign body for scheduled announcement');
    selectByLabel('优先级|priority', 'high');
    selectByLabel('受众|audience', '注册 ≤14 天');
    selectByLabel('排期|schedule', '排期下发');
    fillByLabel('预算|budget', '1200');
    fillReason('L2a02 campaign edit proof ticket 3006');
    assertConfirmEnabled();
    submitConfirm();
    return { submitted: true };
  `);
  wait();
  const state = reopenAndRead("/content/notifications");
  const list = evalJson(`
    const body = bodyText();
    return {
      title: body.includes('L2a02 7 月费率说明'),
      audience: body.includes('注册 ≤14 天'),
      tier: body.includes('high'),
      schedule: body.includes('排期下发'),
    };
  `);
  expect(Object.values(list).every(Boolean), `campaign list not visibly updated: ${JSON.stringify(list)}`);
  evalJson(`clickRow('L2a02 7 月费率说明'); return { openedDetail: true };`);
  wait();
  const detail = evalJson(`
    const body = bodyText();
    return {
      body: body.includes('L2a02 campaign body for scheduled announcement'),
      budget: body.includes('$1200'),
    };
  `);
  expect(Object.values(detail).every(Boolean), `campaign detail not visibly updated: ${JSON.stringify(detail)}`);
  expectEqual(state.params?.["I.campaign.CMP-2619.draft.title"], "L2a02 7 月费率说明", "campaign title persisted");
  expectEqual(state.params?.["I.campaign.CMP-2619.draft.budget"], "1200", "campaign budget persisted");
  return { list, detail };
});

try {
  run(["close"], { timeout: 15000 });
} catch {}

const outFile = path.join(ROOT, "docs", "audit", "shards", "ad-09-content-business-modal-proof.ndjson");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(
  outFile,
  `${JSON.stringify({
    shardId: "AD-09",
    source: "SPEC-L2a02-runtime-proof",
    side: "admin",
    routes: ["/content/i18n", "/content/learn", "/content/copy-ab", "/content/disclosure", "/content/notifications"],
    status: "captured",
    result: {
      classification: "state-persisted-and-visible",
      tasks: results.map((row) => row.name),
      noObservableChange: 0,
      businessIncompleteModal: 0,
    },
    evidence: {
      script: "scripts/admin-content-business-modal-proof.mjs",
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
