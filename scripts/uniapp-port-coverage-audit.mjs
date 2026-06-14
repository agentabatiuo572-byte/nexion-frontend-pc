import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_ROOT = path.resolve(ROOT, "..");
const NEXT_ROOT = path.join(PLAN_ROOT, "Nexion-prototype");
const UNI_ROOT = path.join(PLAN_ROOT, "Nexion-uniapp");
const UNI_PAGES_JSON = path.join(UNI_ROOT, "src", "pages.json");
const SHARDS = path.join(ROOT, "docs", "audit", "shards");

const BLOCKING_ACTION_CLASSIFICATIONS = new Set([
  "click-target-missing",
  "hash-only-no-content",
  "no-observable-change",
]);
const EXPECTED_EXTRA_UNI_ROUTES = new Set([
  "/#/pages/onboarding/terms",
  // uniapp-first 即时会话中心(Next 原型无对应,主人 2026-06-14 定 uniapp 主导前端;后台对端见 admin I9)。
  // 非 Next→uni port,故豁免本 audit 的 extra-route 与 runtime-evidence 检查(端口覆盖范围外)。
  "/#/pages/support/messages",
  "/#/pages/support/chat",
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

function walkPageFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkPageFiles(full, out);
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

function toNextRoute(file) {
  const parts = path
    .relative(path.join(NEXT_ROOT, "app"), file)
    .split(path.sep)
    .slice(0, -1)
    .filter((part) => !/^\(.+\)$/.test(part));
  const route = `/${parts.join("/")}`.replace(/\/$/, "");
  return route || "/";
}

function nextRouteCandidates(route) {
  const explicit = {
    "/": ["/#/pages/index/index"],
    "/login": ["/#/pages/login/login"],
    "/register": ["/#/pages/register/register"],
    "/ref/[code]": ["/#/pages/ref/code"],
    "/tx/[hash]": ["/#/pages/tx/hash"],
    "/store/[productId]": ["/#/pages/store/detail"],
    "/store/orders/[id]": ["/#/pages/store/order-detail"],
    "/me/security/kyc-express": ["/#/pages/me/kyc"],
  };
  if (explicit[route]) return explicit[route];

  const parts = route.split("/").filter(Boolean);
  if (parts.length === 1) return [`/#/pages/${parts[0]}/${parts[0]}`];

  const [first, ...rest] = parts;
  const dashed = rest.join("-");
  const shortHow = dashed.replace(/-how-it-works$/, "-how");
  return [
    `/#/pages/${first}/${dashed}`,
    `/#/pages/${first}/${shortHow}`,
    `/#/pages/${first}/${rest.join("/")}`,
  ];
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

if (!fs.existsSync(NEXT_ROOT)) findings.push({ issue: "missing-next-root", path: NEXT_ROOT });
if (!fs.existsSync(UNI_ROOT)) findings.push({ issue: "missing-uni-root", path: UNI_ROOT });
if (!fs.existsSync(UNI_PAGES_JSON)) findings.push({ issue: "missing-pages-json", path: UNI_PAGES_JSON });

const nextRoutes = fs.existsSync(NEXT_ROOT)
  ? walkPageFiles(path.join(NEXT_ROOT, "app")).map(toNextRoute).sort((a, b) => a.localeCompare(b))
  : [];
const uniPages = fs.existsSync(UNI_PAGES_JSON) ? loadUniPages() : [];
const uniRouteSet = new Set(uniPages.map((page) => page.h5Url));

const mapping = [];
for (const route of nextRoutes) {
  const candidates = nextRouteCandidates(route);
  const uniRoute = candidates.find((candidate) => uniRouteSet.has(candidate));
  if (!uniRoute) findings.push({ issue: "missing-uni-route-for-next-route", route, candidates });
  else mapping.push({ nextRoute: route, uniRoute });
}

for (const page of uniPages) {
  if (!page.exists) findings.push({ issue: "missing-uni-vue-file", route: page.h5Url, file: page.file });
}

const mappedUniRoutes = new Set(mapping.map((row) => row.uniRoute));
const extraUniRoutes = uniPages.map((page) => page.h5Url).filter((route) => !mappedUniRoutes.has(route)).sort();
const unexpectedExtraUniRoutes = extraUniRoutes.filter((route) => !EXPECTED_EXTRA_UNI_ROUTES.has(route));
for (const route of unexpectedExtraUniRoutes) findings.push({ issue: "unexpected-extra-uni-route", route });

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

for (const page of uniPages) {
  // uniapp-first 路由(EXPECTED_EXTRA)非 Next→uni port,不在端口覆盖运行时取证范围内 → 豁免。
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
  nextRoutes: nextRoutes.length,
  uniPages: uniPages.length,
  mappedRoutes: mapping.length,
  extraUniRoutes,
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
