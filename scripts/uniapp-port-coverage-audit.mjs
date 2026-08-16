// UniApp self-consistency audit.
//
// 2026-06-26: H5 工程退役后,原"Next → UniApp port 覆盖"命题失效。
// 本脚本重命题为"uniapp 自一致性 audit":
//   1) pages.json 列出的每个 page 对应 .vue 文件须存在
//   2) runtime evidence shards 覆盖每个 page(EXPECTED_EXTRA 豁免)
//   3) action sample shards 无 blocking classification
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNexionAppRoot } from "./lib/nexion-workspace-paths.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_ROOT = path.resolve(ROOT, "..");
// uniapp 根走共享解析器(候选覆盖新旧布局;NEXION_UNIAPP_ROOT 是本脚本历史 env 契约,桥接后仍最高优先)。
// 解析不到不抛:显式 env 指的路不存在就保留原值让 findings 指名道红(不许静默换树);
// 无 env 时退规范名,同样落到下方 missing-uni-root 结构化红,报告面与既有一致。
const configuredUniRoot = process.env.NEXION_UNIAPP_ROOT || process.env.NEXION_APP_ROOT;
let UNI_ROOT;
try {
  UNI_ROOT = resolveNexionAppRoot({
    adminRoot: ROOT,
    env: { ...process.env, NEXION_APP_ROOT: configuredUniRoot },
  });
} catch {
  UNI_ROOT = path.resolve(configuredUniRoot || path.join(PLAN_ROOT, "Nexion-uniapp"));
}
const UNI_PAGES_JSON = path.join(UNI_ROOT, "src", "pages.json");
const SHARDS = path.join(ROOT, "docs", "audit", "shards");

const BLOCKING_ACTION_CLASSIFICATIONS = new Set([
  "click-target-missing",
  "hash-only-no-content",
  "no-observable-change",
]);
// uniapp-first 页面:运行时取证豁免清单(原"Next 原型无对应"豁免逻辑保留语义)。
// onboarding/terms 已有 runtime shard 证据,豁免于 2026-08-16 消化移除(留着=证据将来丢失也不红的盲区)。
const EXPECTED_EXTRA_UNI_ROUTES = new Set([
  "/#/pages/support/messages",
  "/#/pages/support/chat",
  "/#/pages/me/rewards",
  "/#/pages/session/kicked",
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parseNdjson(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function loadUniPages() {
  const pagesJson = readJson(UNI_PAGES_JSON);
  return pagesJson.pages.map((page) => {
    const vueFile = path.join(UNI_ROOT, "src", `${page.path}.vue`);
    return {
      route: `/${page.path}`,
      h5Url: `/#/${page.path}`,
      file: path.relative(UNI_ROOT, vueFile).replace(/\\/g, "/"),
      exists: fs.existsSync(vueFile),
    };
  });
}

function loadRuntimeRows() {
  if (!fs.existsSync(SHARDS)) return [];
  return fs
    .readdirSync(SHARDS)
    .filter((file) => /^uni-fr-\d+-runtime\.ndjson$/i.test(file))
    .sort()
    .flatMap((file) => parseNdjson(path.join(SHARDS, file)).map((row) => ({ ...row, shardFile: file })));
}

function loadActionRows() {
  if (!fs.existsSync(SHARDS)) return [];
  return fs
    .readdirSync(SHARDS)
    .filter((file) => /^uni-fr-\d+-front-action-sample\.ndjson$/i.test(file))
    .sort()
    .flatMap((file) => parseNdjson(path.join(SHARDS, file)).map((row) => ({ ...row, shardFile: file })));
}

const findings = [];

if (!fs.existsSync(UNI_ROOT)) findings.push({ issue: "missing-uni-root", path: UNI_ROOT });
if (!fs.existsSync(UNI_PAGES_JSON)) findings.push({ issue: "missing-pages-json", path: UNI_PAGES_JSON });

const uniPages = fs.existsSync(UNI_PAGES_JSON) ? loadUniPages() : [];

for (const page of uniPages) {
  if (!page.exists) findings.push({ issue: "missing-uni-vue-file", route: page.h5Url, file: page.file });
}

const runtimeRows = loadRuntimeRows();
const runtimeByRoute = new Map();
for (const row of runtimeRows) {
  runtimeByRoute.set(row.route, row);
  if (row.status !== "captured") {
    findings.push({ issue: "uni-runtime-not-captured", route: row.route, shardFile: row.shardFile, status: row.status, error: row.error ?? null });
  } else if (row.evidence?.routeMatch === false) {
    findings.push({ issue: "uni-runtime-route-mismatch", route: row.route, shardFile: row.shardFile, url: row.evidence?.runtime?.url ?? row.url });
  }
}

const computeShareRuntime = runtimeByRoute.get("/#/pages/compute-share/download");
if (computeShareRuntime) {
  const preview = computeShareRuntime.evidence?.runtime?.bodyPreview ?? "";
  const gated = computeShareRuntime.gatedState ?? {};
  if (gated.ok !== true || !preview.includes("Audit GPU title from config") || !preview.includes("Audit GPU guide from config")) {
    findings.push({
      issue: "compute-share-download-config-copy-not-proven",
      route: "/#/pages/compute-share/download",
      shardFile: computeShareRuntime.shardFile,
      gated,
    });
  }
}

for (const page of uniPages) {
  if (!runtimeByRoute.has(page.h5Url) && !EXPECTED_EXTRA_UNI_ROUTES.has(page.h5Url)) {
    findings.push({ issue: "missing-uni-runtime-evidence", route: page.h5Url });
  }
}

const actionRows = loadActionRows();
for (const row of actionRows) {
  const classification = row.result?.classification ?? row.status;
  if (row.status === "error" || BLOCKING_ACTION_CLASSIFICATIONS.has(classification)) {
    findings.push({
      issue: "blocking-uni-action-sample",
      route: row.route,
      shardFile: row.shardFile,
      action: row.action?.label ?? row.action?.text ?? "",
      status: row.status,
      classification,
      error: row.error ?? null,
    });
  }
}

const result = {
  status: findings.length === 0 ? "passed" : "failed",
  uniPages: uniPages.length,
  expectedExtraUniRoutes: Array.from(EXPECTED_EXTRA_UNI_ROUTES).sort(),
  missingUniVueFiles: uniPages.filter((page) => !page.exists).length,
  runtimeRows: runtimeRows.length,
  runtimeCaptured: runtimeRows.filter((row) => row.status === "captured").length,
  actionRows: actionRows.length,
  blockingActionSamples: actionRows.filter((row) => row.status === "error" || BLOCKING_ACTION_CLASSIFICATIONS.has(row.result?.classification)).length,
  findings,
};

console.log(JSON.stringify(result, null, 2));
if (result.status !== "passed") process.exit(1);
