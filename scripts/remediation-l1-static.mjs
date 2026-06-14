// L1 source-D static discovery.
//
// High-confidence static defects are appended to docs/audit/ledger.ndjson.
// Lower-confidence patterns are written to docs/audit/static-findings.json
// for runtime confirmation during source A/B.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_ROOT = path.resolve(ROOT, "..");
const NEXT_ROOT = path.join(PLAN_ROOT, "Nexion-prototype");
const UNI_ROOT = path.join(PLAN_ROOT, "Nexion-uniapp");
const AUDIT_DIR = path.join(ROOT, "docs", "audit");
const LEDGER = path.join(AUDIT_DIR, "ledger.ndjson");
const generatedAt = new Date().toISOString();

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function writeText(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

function walk(dir, predicate, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/node_modules|\.next|dist|\.git|\.tmp-design/.test(fp)) continue;
      walk(fp, predicate, acc);
    } else if (predicate(fp, entry.name)) {
      acc.push(fp);
    }
  }
  return acc;
}

function rel(root, file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function readLedger() {
  const text = readText(LEDGER);
  if (!text.trim()) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeLedger(entries) {
  writeText(LEDGER, entries.map((entry) => JSON.stringify(entry)).join("\n"));
}

function nextStaticId(entries) {
  let max = 0;
  for (const entry of entries) {
    const match = String(entry.id || "").match(/^SD-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return () => `SD-${String(++max).padStart(3, "0")}`;
}

function ledgerEntry({ id, side, route, title, category, severity, actual, evidence, foundBy = "l1-static" }) {
  return {
    id,
    side,
    route,
    title,
    category,
    severity,
    repro: "Static source-D scan. Runtime source-A/source-B must confirm interaction behavior where applicable.",
    expected: "No static pattern that violates the remediation checklist remains.",
    actual,
    evidence,
    dedup_key: `${side}:${category}:${route}:${title}`.toLowerCase(),
    cluster: category,
    status: "open",
    fix_pr: null,
    sentinel: null,
    found_by: foundBy,
  };
}

function parseMessages(file, exportName) {
  const source = readText(file)
    .replace(/^\s*import\s+type\s+[^;]+;\s*$/gm, "")
    .replace(new RegExp(`export\\s+const\\s+${exportName}\\s*(?::\\s*Messages)?\\s*=`), `const ${exportName} =`)
    .replace(/export\s+type\s+Messages\s*=\s*typeof\s+\w+\s*;?/g, "")
    .concat(`\nmodule.exports = ${exportName};\n`);
  const sandbox = { module: { exports: null } };
  vm.runInNewContext(source, sandbox, { filename: file, timeout: 1000 });
  return sandbox.module.exports;
}

function flattenKeys(value, prefix = "", out = []) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of Object.keys(value)) flattenKeys(value[key], prefix ? `${prefix}.${key}` : key, out);
  } else {
    out.push(prefix);
  }
  return out;
}

function diffI18n(projectRoot, side, enPath, zhPath) {
  const en = flattenKeys(parseMessages(path.join(projectRoot, enPath), "en")).sort();
  const zh = flattenKeys(parseMessages(path.join(projectRoot, zhPath), "zh")).sort();
  const enSet = new Set(en);
  const zhSet = new Set(zh);
  const missingInZh = en.filter((key) => !zhSet.has(key));
  const extraInZh = zh.filter((key) => !enSet.has(key));
  return {
    side,
    enPath,
    zhPath,
    enKeys: en.length,
    zhKeys: zh.length,
    missingInZh,
    extraInZh,
  };
}

function scanDeadLinks(projectRoot, side, dirs, re, routePrefix) {
  const rows = [];
  for (const dir of dirs) {
    for (const file of walk(path.join(projectRoot, dir), (fp, name) => /\.(tsx|vue)$/.test(name))) {
      const text = readText(file);
      const matches = [...text.matchAll(re)];
      if (!matches.length) continue;
      rows.push({
        side,
        file: rel(projectRoot, file),
        route: routePrefix || null,
        count: matches.length,
        samples: matches.slice(0, 5).map((m) => m[0]),
      });
    }
  }
  return rows;
}

function scanToastOnlyCandidates() {
  const rows = [];
  const files = walk(path.join(ROOT, "app"), (fp, name) => /\.(tsx|ts)$/.test(name));
  const onClickBlock = /onClick\s*=\s*\{([\s\S]{0,700}?)\}/g;
  for (const file of files) {
    const text = readText(file);
    const candidates = [];
    let match;
    while ((match = onClickBlock.exec(text))) {
      const block = match[1];
      const toast = /setToast\(|toast\.|showToast\(/.test(block);
      const writes = /setParam\(|update[A-Z]\w*\(|add[A-Z]\w*\(|remove[A-Z]\w*\(|setActionConfirm\(|setModal\(|setDrawer\(|router\.|href=|window\.|download/.test(block);
      if (toast && !writes) candidates.push(block.replace(/\s+/g, " ").slice(0, 180));
    }
    if (candidates.length) {
      rows.push({
        side: "admin",
        file: rel(ROOT, file),
        count: candidates.length,
        samples: candidates.slice(0, 5),
        confidence: "candidate-runtime-confirm-required",
      });
    }
  }
  return rows;
}

function scanModalNoInputCandidates() {
  const rows = [];
  const files = [
    ...walk(path.join(ROOT, "app"), (fp, name) => /\.(tsx|ts)$/.test(name)),
    ...walk(path.join(ROOT, "lib"), (fp, name) => /\.(tsx|ts)$/.test(name)),
  ];
  const modalSignal = /\b(OperationConfirmModal|KConfirmModal|ViewParamModal|ConfirmDialog|Modal|Drawer|Dialog|Sheet|setActionConfirm|setModal|setConfirm)\b/;
  const inputSignal = /<input\b|<textarea\b|<select\b|edit\s*=|target value|newValue|v-model|contentEditable|role=["']textbox/i;
  for (const file of files) {
    const text = readText(file);
    if (!modalSignal.test(text) || inputSignal.test(text)) continue;
    rows.push({
      side: "admin",
      file: rel(ROOT, file),
      confidence: "candidate-runtime-five-tuple-required",
      reason: "modal/confirm signal exists but no obvious input/edit signal was found statically",
    });
  }
  return rows;
}

function buildLedgerMarkdown(entries) {
  const byStatus = {};
  const bySeverity = {};
  for (const entry of entries) {
    byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
    bySeverity[entry.severity] = (bySeverity[entry.severity] || 0) + 1;
  }
  return `# Nexion Remediation Ledger

> Generated summary. Source of truth is \`docs/audit/ledger.ndjson\`.

Generated at: ${generatedAt}

## Summary

- Total: ${entries.length}
- By severity: ${JSON.stringify(bySeverity)}
- By status: ${JSON.stringify(byStatus)}

## Entries

| ID | Side | Severity | Category | Status | Route | Title |
|---|---|---|---|---|---|---|
${entries.map((entry) => `| ${entry.id} | ${entry.side} | ${entry.severity} | ${entry.category} | ${entry.status} | ${String(entry.route).replace(/\|/g, "\\|")} | ${entry.title.replace(/\|/g, "\\|")} |`).join("\n")}
`;
}

const ledger = readLedger();
const existingDedup = new Set(ledger.map((entry) => entry.dedup_key));
const makeId = nextStaticId(ledger);
const appended = [];
const report = {
  generatedAt,
  ledgerAppended: [],
  staticCandidates: {},
};

function appendIfNew(raw) {
  const entry = ledgerEntry({ ...raw, id: makeId() });
  if (existingDedup.has(entry.dedup_key)) return;
  existingDedup.add(entry.dedup_key);
  ledger.push(entry);
  appended.push(entry);
}

const nextDeadLinks = scanDeadLinks(
  NEXT_ROOT,
  "frontend",
  ["app", "components"],
  /\bhref\s*=\s*(?:"#"|'#'|\{\s*["']#["']\s*\})/g,
  "next-reference-static",
);
for (const row of nextDeadLinks) {
  appendIfNew({
    side: "frontend",
    route: row.route,
    title: `Dead href anchor in ${row.file}`,
    category: "dead-control",
    severity: "P1",
    actual: `${row.count} href=\"#\" occurrence(s). Samples: ${row.samples.join(" | ")}`,
    evidence: [`Nexion-prototype/${row.file}`],
  });
}

const uniDeadLinks = scanDeadLinks(
  UNI_ROOT,
  "uniapp",
  ["src"],
  /\b(?:href|url)\s*=\s*(?:"#"|'#'|\{\s*["']#["']\s*\})/g,
  "uniapp-static",
);
for (const row of uniDeadLinks) {
  appendIfNew({
    side: "uniapp",
    route: row.route,
    title: `Dead link target in ${row.file}`,
    category: "dead-control",
    severity: "P1",
    actual: `${row.count} href/url=\"#\" occurrence(s). Samples: ${row.samples.join(" | ")}`,
    evidence: [`Nexion-uniapp/${row.file}`],
  });
}

for (const diff of [
  diffI18n(NEXT_ROOT, "frontend", "lib/i18n/messages/en.ts", "lib/i18n/messages/zh.ts"),
  diffI18n(UNI_ROOT, "uniapp", "src/i18n/messages/en.ts", "src/i18n/messages/zh.ts"),
]) {
  if (diff.missingInZh.length || diff.extraInZh.length) {
    appendIfNew({
      side: diff.side,
      route: "i18n",
      title: `${diff.side} i18n key mismatch: en=${diff.enKeys}, zh=${diff.zhKeys}`,
      category: "i18n",
      severity: "P1",
      actual: `missingInZh=${diff.missingInZh.length}; extraInZh=${diff.extraInZh.length}`,
      evidence: [diff.enPath, diff.zhPath, "docs/audit/static-findings.json"],
    });
  }
  report[`${diff.side}I18nDiff`] = {
    ...diff,
    missingInZh: diff.missingInZh.slice(0, 120),
    extraInZh: diff.extraInZh.slice(0, 120),
  };
}

report.staticCandidates.toastOnly = scanToastOnlyCandidates();
report.staticCandidates.modalNoInput = scanModalNoInputCandidates();
report.staticCandidates.nextDeadLinks = nextDeadLinks;
report.staticCandidates.uniDeadLinks = uniDeadLinks;
report.ledgerAppended = appended.map((entry) => entry.id);

writeLedger(ledger);
writeText(path.join(AUDIT_DIR, "LEDGER.md"), buildLedgerMarkdown(ledger));
writeText(path.join(AUDIT_DIR, "static-findings.json"), JSON.stringify(report, null, 2));
writeText(
  path.join(AUDIT_DIR, "static-findings.md"),
  `# L1 Static Findings

Generated at: ${generatedAt}

## Ledger Appended

${appended.length ? appended.map((entry) => `- ${entry.id}: ${entry.title}`).join("\n") : "- None"}

## Candidate Counts

- toast-only candidates: ${report.staticCandidates.toastOnly.length}
- modal-no-input candidates: ${report.staticCandidates.modalNoInput.length}
- Next dead-link files: ${nextDeadLinks.length}
- UniApp dead-link files: ${uniDeadLinks.length}
- Next i18n missingInZh: ${report.frontendI18nDiff?.missingInZh?.length ?? 0}; extraInZh: ${report.frontendI18nDiff?.extraInZh?.length ?? 0}
- UniApp i18n missingInZh: ${report.uniappI18nDiff?.missingInZh?.length ?? 0}; extraInZh: ${report.uniappI18nDiff?.extraInZh?.length ?? 0}
`,
);

console.log("L1 static discovery complete");
console.log(JSON.stringify({
  appended: appended.length,
  ledgerEntries: ledger.length,
  toastOnlyCandidates: report.staticCandidates.toastOnly.length,
  modalNoInputCandidates: report.staticCandidates.modalNoInput.length,
  nextDeadLinkFiles: nextDeadLinks.length,
  uniDeadLinkFiles: uniDeadLinks.length,
}, null, 2));
