// Runtime crawl helper for one admin L1 shard.
// Uses the agent-browser CLI so the audit can run without adding Playwright to
// the repo. The first pass captures route-level runtime evidence and list
// baseline candidates; focused button/modal clicks are recorded in separate
// shard files as they are run.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT = path.join(ROOT, "docs", "audit");
const SHARDS = path.join(AUDIT, "shards");
const SCREENSHOTS = path.join(AUDIT, "screenshots");
const BASE_URL = process.env.ADMIN_BASE_URL || "http://localhost:3002";
const shardId = process.argv[2] || "AD-09";
const session = process.env.AGENT_BROWSER_SESSION || `nexion-l1-${shardId.toLowerCase()}`;
const WIN_AGENT_BROWSER_EXE =
  process.platform === "win32"
    ? path.join(
        process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming"),
        "npm",
        "node_modules",
        "agent-browser",
        "bin",
        "agent-browser-win32-x64.exe",
      )
    : "";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function run(args, options = {}) {
  const fullArgs = ["--session", session, ...args];
  const command = process.platform === "win32" && fs.existsSync(WIN_AGENT_BROWSER_EXE) ? WIN_AGENT_BROWSER_EXE : "agent-browser";
  const result = spawnSync(command, fullArgs, {
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
  return route.replace(/^\/+/, "").replace(/[^a-zA-Z0-9]+/g, "-") || "root";
}

function lineJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(obj)}\n`, "utf8");
}

fs.mkdirSync(SHARDS, { recursive: true });
fs.mkdirSync(SCREENSHOTS, { recursive: true });

const plan = readJson(path.join(AUDIT, "l1-shards.json"));
const shard = plan.shards.find((item) => item.id === shardId);
if (!shard) throw new Error(`Unknown shard: ${shardId}`);

const outFile = path.join(SHARDS, `${shardId.toLowerCase()}-runtime.ndjson`);
fs.writeFileSync(outFile, "", "utf8");

const routes = shard.routes || [];
for (const route of routes) {
  const url = `${BASE_URL}${route}`;
  const slug = safeName(route);
  const startedAt = new Date().toISOString();
  const entry = {
    shardId,
    source: "A-runtime-crawl",
    side: "admin",
    route,
    url,
    startedAt,
    status: "pending",
    evidence: {},
  };
  try {
    run(["open", url], { timeout: 45000 });
    run(["wait", "--load", "networkidle"], { timeout: 45000 });
    const snapshot = run(["snapshot", "-i"], { timeout: 45000 });
    const snapshotPath = path.join(SHARDS, `${shardId.toLowerCase()}-${slug}-snapshot.txt`);
    fs.writeFileSync(snapshotPath, snapshot, "utf8");
    const screenshotPath = path.join(SCREENSHOTS, `${shardId.toLowerCase()}-${slug}.png`);
    run(["screenshot", screenshotPath], { timeout: 45000 });

    const runtime = evalJson(`JSON.stringify((() => {
      const text = (el) => (el.innerText || el.textContent || '').trim();
      const buttons = Array.from(document.querySelectorAll('button,[role="button"],a[href],input,textarea,select')).map((el, index) => ({
        index,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        text: text(el).slice(0, 80),
        aria: el.getAttribute('aria-label') || '',
        href: el.getAttribute('href') || '',
        disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      }));
      const pagerSelector = '[data-list-pager="true"], .data-list-pager, .pager, [data-pagination-control="true"], [aria-label*="分页"]';
      const exemptionSelector = '[data-pagination-exempt="true"]';
      const sectionSelector = '[data-list-section], section, .l-card, .card';
      const readExemption = (el) => {
        const reason = el.getAttribute('data-pagination-reason') || '';
        const maxRows = Number(el.getAttribute('data-pagination-max-rows') || '0');
        const kind = el.getAttribute('data-pagination-kind') || 'static-small';
        const maxAllowed = kind === 'fixed-matrix' ? 24 : kind === 'reference-catalog' ? 20 : kind === 'sample-ledger' ? 12 : 5;
        return {
          label: el.getAttribute('data-pagination-label') || text(el).slice(0, 80),
          kind,
          reason,
          maxRows,
          maxAllowed,
          valid: reason.trim().length >= 8 && maxRows > 0 && maxRows <= maxAllowed,
        };
      };
      const allPagers = Array.from(document.querySelectorAll(pagerSelector)).filter((el) => text(el) || el.querySelector('button,select'));
      const pagers = allPagers.map((el) => ({
        label: el.getAttribute('data-list-label') || el.getAttribute('aria-label') || text(el).slice(0, 80),
        text: text(el).slice(0, 160),
        standard: el.getAttribute('data-list-pager') === 'true',
        legacy: el.classList.contains('pager') && el.getAttribute('data-list-pager') !== 'true',
      }));
      const paginationExemptions = Array.from(document.querySelectorAll(exemptionSelector)).map(readExemption);
      const tableDataRows = (table) => {
        const bodyRows = Array.from(table.tBodies || []).reduce((sum, tbody) => sum + tbody.rows.length, 0);
        if (bodyRows > 0) return bodyRows;
        const allRows = Array.from(table.rows || []);
        const headRows = table.tHead ? table.tHead.rows.length : 0;
        if (headRows > 0) return Math.max(0, allRows.length - headRows);
        const firstRowIsHeader = !!allRows[0]?.querySelector?.('th');
        return Math.max(0, allRows.length - (firstRowIsHeader ? 1 : 0));
      };
      const sectionTitle = (section) => {
        if (!section) return '';
        const titleEl = section.querySelector('.ttl, h1, h2, h3, [data-list-title]');
        return text(titleEl || section).slice(0, 80);
      };
      const matchesExemptionLabel = (exemption, tableLabel, tableSectionTitle) => {
        const label = (exemption.label || '').trim();
        if (!label) return false;
        return label === tableLabel || label === tableSectionTitle || tableLabel.includes(label) || tableSectionTitle.includes(label);
      };
      const tables = Array.from(document.querySelectorAll('table')).map((table, index) => {
        const section = table.closest(sectionSelector);
        const localPagers = section ? Array.from(section.querySelectorAll(pagerSelector)).filter((el) => text(el) || el.querySelector('button,select')) : [];
        const localExemptions = section ? Array.from(section.querySelectorAll(exemptionSelector)).map(readExemption) : [];
        const dataRows = tableDataRows(table);
        const label = table.getAttribute('aria-label') || table.caption?.innerText?.trim() || sectionTitle(section) || 'table-' + index;
        const localValid = localExemptions.some((item) => item.valid && item.maxRows >= dataRows);
        const routeValid = paginationExemptions.some((item) => item.valid && item.maxRows >= dataRows && matchesExemptionLabel(item, label, sectionTitle(section)));
        return {
          index,
          label,
          sectionTitle: sectionTitle(section),
          headers: Array.from(table.querySelectorAll('th')).map(text),
          rows: table.rows?.length || 0,
          dataRows,
          hasLocalPager: localPagers.length > 0,
          localPagerCount: localPagers.length,
          localExemptions,
          exemptionValidForRows: localValid || routeValid,
          exemptionScope: localValid ? 'section' : routeValid ? 'route-label' : '',
        };
      });
      const tableIssues = tables
        .filter((table) => !table.hasLocalPager && !table.exemptionValidForRows)
        .map((table) => ({
          tableIndex: table.index,
          label: table.label,
          sectionTitle: table.sectionTitle,
          dataRows: table.dataRows,
          headers: table.headers.slice(0, 6),
          issue: table.dataRows > 5 ? 'missing-pager-or-valid-exemption' : 'missing-explicit-small-table-exemption',
          severity: table.dataRows > 5 ? 'P1' : 'P2',
        }));
      const listBaseline = {
        pagination: pagers.length > 0,
        paginationPagerCount: pagers.filter((item) => item.standard).length,
        paginationControlCount: pagers.length,
        legacyPaginationControlCount: pagers.filter((item) => item.legacy).length,
        pagers,
        paginationExempt: paginationExemptions.length > 0 && paginationExemptions.every((item) => item.valid),
        paginationExemptions,
        tableCount: tables.length,
        tableIssues,
        filters: /筛选|过滤|全部|有问题|状态|分类|搜索/.test(document.body.innerText),
        search: Boolean(document.querySelector('input[placeholder*="搜索"], input[aria-label*="搜索"], input[type="search"]')),
        sorting: Boolean(document.querySelector('[aria-sort]')) || /排序|sort/i.test(document.body.innerText),
        emptyState: /暂无|空|No data|empty/i.test(document.body.innerText),
      };
      return {
        title: document.title,
        url: location.href,
        bodyTextLength: document.body.innerText.length,
        buttons,
        tables,
        listBaseline,
        dialogCount: document.querySelectorAll('[role="dialog"],[aria-modal="true"],.modal,.drawer,.scrim').length,
        fixedTexts: Array.from(document.querySelectorAll('div')).filter(d => getComputedStyle(d).position === 'fixed').map(text).filter(Boolean).slice(0, 10),
      };
    })())`);

    entry.status = "captured";
    entry.evidence = {
      snapshot: path.relative(ROOT, snapshotPath).replace(/\\/g, "/"),
      screenshot: path.relative(ROOT, screenshotPath).replace(/\\/g, "/"),
      runtime,
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

const rows = fs.readFileSync(outFile, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const summary = {
  shardId,
  routes: routes.length,
  captured: rows.filter((row) => row.status === "captured").length,
  errors: rows.filter((row) => row.status === "error").length,
  outFile: path.relative(ROOT, outFile).replace(/\\/g, "/"),
};
console.log(JSON.stringify(summary, null, 2));
