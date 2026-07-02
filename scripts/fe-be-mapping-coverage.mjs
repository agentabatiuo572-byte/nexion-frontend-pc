import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_ROOT = path.resolve(ROOT, "..");
const dTablePath = path.join(PLAN_ROOT, "PRD", "三端架构改造", "D_后台可控映射.md");
const frontMapPath = path.join(ROOT, "docs", "FRONTEND-LEVER-MAP.md");
const adminPrdPath = path.join(ROOT, "docs", "PRD", "Nexion_运营控制后台_开发落地规格.md");
const rootAdminPrdPath = path.join(PLAN_ROOT, "PRD", "Nexion_运营控制后台_开发落地规格.md");
const uniRoot = path.join(PLAN_ROOT, "Nexion-uniapp");
const janusRoot = path.join(PLAN_ROOT, "Nexion-janus");
const adminLogPath = path.join(ROOT, "docs", "后台产品更新日志.md");
const frontLogPath = path.join(uniRoot, "docs", "前端产品更新日志.md");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function exists(file) {
  return fs.existsSync(file);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function splitMarkdownRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function extractRows(markdown, prefix) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => new RegExp(`^\\|\\s*${prefix}\\d+\\s*\\|`).test(line))
    .map((line) => {
      const cells = splitMarkdownRow(line);
      return { id: cells[0], cells, line };
    });
}

function assertFileContains(file, tokens) {
  expect(exists(file), `missing file: ${path.relative(PLAN_ROOT, file)}`);
  const text = read(file);
  for (const token of tokens) {
    expect(text.includes(token), `${path.relative(PLAN_ROOT, file)} missing token: ${token}`);
  }
}

function assertFileAbsent(file) {
  expect(!exists(file), `deleted prototype file returned: ${path.relative(PLAN_ROOT, file)}`);
}

function assertNoOperatorLeaks(label, text) {
  const leakPattern = /ENV_FILTERED|MANUAL_HOLD|keyword\d+|computeShareEnabled|h5BaseFactor|continuityFullHours|H5_BASE_FACTOR|CONTINUITY_FULL_MS|param-fixed|param-multi|op:\s*["']?param|setParam|\b(?:MATURITY|TIME|FINGERPRINT|INVITE|MANUAL)\b/;
  const match = text.match(leakPattern);
  expect(!match, `${label} leaks engineering-facing field or enum: ${match?.[0]}`);
}

function extractHeadingSection(markdown, heading) {
  const start = markdown.indexOf(heading);
  expect(start >= 0, `missing changelog section: ${heading}`);
  const rest = markdown.slice(start);
  const next = rest.slice(heading.length).search(/\n###\s/);
  return next >= 0 ? rest.slice(0, heading.length + next) : rest;
}

const dTable = read(dTablePath);
const frontMap = read(frontMapPath);
const adminPrd = read(adminPrdPath);
const rootAdminPrd = read(rootAdminPrdPath);
const adminLog = read(adminLogPath);
const frontLog = read(frontLogPath);
const dRows = extractRows(dTable, "M");
const mapRows = extractRows(frontMap, "M");
const expectedIds = Array.from({ length: 11 }, (_, i) => `M${i + 1}`);

expect(dRows.length === 11, `D table must contain 11 M rows, got ${dRows.length}`);
expect(mapRows.length === 11, `FRONTEND-LEVER-MAP SPEC-5 section must contain 11 M rows, got ${mapRows.length}`);

const dIds = new Set(dRows.map((row) => row.id));
const mapIds = new Set(mapRows.map((row) => row.id));
for (const id of expectedIds) {
  expect(dIds.has(id), `D table missing ${id}`);
  expect(mapIds.has(id), `FRONTEND-LEVER-MAP missing ${id}`);
}
expect(dRows.every((row) => row.cells[7]?.includes("✅")), "all D table M rows must be closed with ✅ status");
expect(mapRows.every((row) => row.line.includes("✅")), "all FRONTEND-LEVER-MAP M rows must be closed with ✅ status");
expect(frontMap.includes("三端架构改造增量映射（SPEC-5 并表）"), "FRONTEND-LEVER-MAP missing SPEC-5 merged section");
expect(frontMap.includes("fe-be-mapping-coverage"), "FRONTEND-LEVER-MAP missing coverage gate note");
assertNoOperatorLeaks("D backend-control mapping", dTable);
assertNoOperatorLeaks("FRONTEND-LEVER-MAP SPEC-5 section", frontMap);
assertNoOperatorLeaks("admin PRD backend-control mapping", adminPrd);
assertNoOperatorLeaks("root admin PRD backend-control mapping", rootAdminPrd);
for (const [label, section] of [
  ["admin changelog SPEC-6", extractHeadingSection(adminLog, "### ✏️ 三端入口首页新方案同步（SPEC-6）")],
  ["admin changelog SPEC-5", extractHeadingSection(adminLog, "### 🆕 三端改造映射收口与覆盖门（SPEC-5）")],
  ["admin changelog SPEC-2 E6", extractHeadingSection(adminLog, "### 🆕 E6 电脑算力配置补完（显卡映射 + 下载配置）· SPEC-2")],
  ["admin changelog SPEC-1 E6", extractHeadingSection(adminLog, "### 🆕 E6 在线加成系数（载体在线分层数值参数）· SPEC-1")],
  ["front changelog SPEC-6", extractHeadingSection(frontLog, "### 🆕 三端入口首页新方案（SPEC-6）")],
  ["front changelog SPEC-5", extractHeadingSection(frontLog, "### ✏️ 三端改造映射收口（SPEC-5）")],
  ["front changelog SPEC-2", extractHeadingSection(frontLog, "### 🆕 电脑共享算力弱入口 + pc-gpu 槽位接入（SPEC-2 三端架构改造）")],
  ["front changelog SPEC-1", extractHeadingSection(frontLog, "### 🆕✏️ 手机算力「登记 + 服务端结算解耦 + 载体分层」（SPEC-1 三端架构改造）")],
]) {
  assertNoOperatorLeaks(label, section);
}

const evidence = [
  {
    id: "M1",
    files: [
      [path.join(uniRoot, "src", "store", "config-types.ts"), ["computeShareEnabled"]],
      [path.join(uniRoot, "src", "mock", "platform-config.ts"), ["computeShareEnabled: false"]],
      [path.join(ROOT, "app", "components", "domain-views", "e-tabs", "e6-compute-config.tsx"), ["电脑算力入口开关", "data-proof=\"e6-download-config\""]],
    ],
  },
  {
    id: "M2",
    files: [
      [path.join(uniRoot, "src", "store", "app.ts"), ["activateDevice", "lastSettledAt"]],
      [path.join(ROOT, "app", "components", "domain-views", "e-tabs", "e6-compute-config.tsx"), ["在线加成系数"]],
    ],
  },
  {
    id: "M3",
    files: [
      [path.join(uniRoot, "src", "store", "app.ts"), ["function settle", "settleDevice"]],
      [path.join(ROOT, "lib", "nav", "console-nav.ts"), ["/finance/params", "/devices/compute-config"]],
    ],
  },
  {
    id: "M4",
    files: [
      [path.join(uniRoot, "src", "lib", "carrier.ts"), ["getCarrier"]],
      [path.join(uniRoot, "src", "lib", "hashpower.ts"), ["H5_BASE_FACTOR"]],
      [path.join(ROOT, "app", "components", "domain-views", "e-tabs", "e6-compute-config.tsx"), ["在线加成系数", "连续在线"]],
    ],
  },
  {
    id: "M5",
    files: [
      [path.join(uniRoot, "src", "components", "earn", "compute-share-entry.vue"), ["computeShareEnabled"]],
      [path.join(uniRoot, "src", "pages", "compute-share", "download.vue"), ["computeShare"]],
      [path.join(ROOT, "app", "components", "domain-views", "e-tabs", "e6-compute-config.tsx"), ["客户端下载配置", "下载页双语文案"]],
    ],
  },
  {
    id: "M6",
    files: [
      [path.join(uniRoot, "src", "lib", "gpu-tiers.ts"), ["GPU_TIERS"]],
      [path.join(ROOT, "app", "components", "domain-views", "e-tabs", "e6-compute-config.tsx"), ["电脑显卡映射表", "单个显卡型号关键词"]],
    ],
  },
  {
    id: "M7",
    files: [
      [path.join(uniRoot, "src", "store", "device-types.ts"), ["MAX_DEVICES"]],
      [path.join(uniRoot, "src", "store", "app.ts"), ["connectComputeShareDevice", "deactivateDevice"]],
      [path.join(ROOT, "lib", "nav", "console-nav.ts"), ["/devices/ops", "/devices/compute-config"]],
    ],
  },
  {
    id: "M8",
    files: [
      [path.join(uniRoot, "src", "pages", "entry-surfaces", "index.vue"), ["完整可点击链接", "entry-surfaces/signed", "entry-surfaces/h5", "entry-surfaces/white"]],
      [path.join(uniRoot, "src", "pages", "entry-surfaces", "signed.vue"), ["surface=\"signed\""]],
      [path.join(uniRoot, "src", "pages", "entry-surfaces", "h5.vue"), ["surface=\"h5\""]],
      [path.join(uniRoot, "src", "pages", "entry-surfaces", "white.vue"), ["surface=\"white\""]],
      [path.join(uniRoot, "src", "components", "entry-surfaces", "entry-surface-home.vue"), ["签名版 APP", "H5 网页版", "白 APP 接管", "在线增强", "基础托管", "体检融合"]],
    ],
    absent: [
      path.join(uniRoot, "src", "pages", "home-signed", "home-signed.vue"),
      path.join(uniRoot, "src", "pages", "home-h5", "home-h5.vue"),
      path.join(uniRoot, "src", "pages", "home-cloak", "home-cloak.vue"),
      path.join(uniRoot, "src", "components", "prototype-home.vue"),
      path.join(uniRoot, "src", "components", "home", "prototype-home.vue"),
    ],
  },
  {
    id: "M9",
    files: [
      [path.join(ROOT, "lib", "store", "admin", "janus-c2-store.ts"), ["REMOTE_URL_LABEL"]],
      [path.join(ROOT, "app", "components", "domain-views", "k-tabs", "k6-janus-c2.tsx"), ["JanusC2"]],
      [path.join(ROOT, "lib", "nav", "console-nav.ts"), ["/risk/janus-c2"]],
    ],
  },
  {
    id: "M10",
    files: [
      [path.join(uniRoot, "src", "store", "account-cloud.ts"), ["nexion-account-cloud-v1", "mergeAndWriteAccountSnapshot"]],
      [path.join(uniRoot, "src", "store", "app.ts"), ["bindAccount", "persistAccountSnapshot"]],
      [path.join(ROOT, "lib", "nav", "console-nav.ts"), ["/users/security", "/users/assets", "/finance/ledger", "/devices/ops"]],
    ],
  },
  {
    id: "M11",
    files: [
      [path.join(uniRoot, "src", "lib", "entry-surface.ts"), ["signed-app", "white-app"]],
      [path.join(ROOT, "lib", "nav", "console-nav.ts"), ["/risk/janus-c2", "/devices/compute-config"]],
    ],
  },
];

for (const item of evidence) {
  expect(dIds.has(item.id) && mapIds.has(item.id), `${item.id} missing from source tables`);
  for (const [file, tokens] of item.files || []) assertFileContains(file, tokens);
  for (const file of item.absent || []) assertFileAbsent(file);
}

const prdTokens = [
  "FRONTEND-LEVER-MAP.md",
  "fe-be-mapping-coverage",
  "E6",
  "K6",
  "三端 SPEC-5",
  "三端 SPEC-6",
];
for (const token of prdTokens) {
  expect(adminPrd.includes(token), `admin PRD missing token: ${token}`);
  expect(rootAdminPrd.includes(token), `root admin PRD missing token: ${token}`);
}

if (exists(janusRoot)) {
  assertFileContains(path.join(janusRoot, "cloak-server", "server.mjs"), ["remoteUrl"]);
}

console.log(JSON.stringify({
  status: "passed",
  rows: dRows.length,
  mapRows: mapRows.length,
  checkedIds: expectedIds,
}, null, 2));
