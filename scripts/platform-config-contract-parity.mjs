#!/usr/bin/env node
// Cross-repository parity for the current server-owned configuration surfaces.
// The retired admin mock compute-config.ts is intentionally not an evidence source.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNexionAppRoot } from "./lib/nexion-workspace-paths.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// NEXION_UNIAPP_ROOT 是对外契约(uniapp verify SPEC-7 用它指定被验树,worktree 场景靠它锁靶),桥接后仍最高优先;
// 无 env 时走共享解析器多候选(旧布局 NX1.0-UniApp / 本布局 Nexion-uniapp),不再锚死旧目录名。env 指路不存在即抛红。
const configuredAppRoot = process.env.NEXION_UNIAPP_ROOT || process.env.NEXION_APP_ROOT;
if (configuredAppRoot?.trim() && !fs.existsSync(path.resolve(configuredAppRoot))) {
  // 双名报错:活调用方(uniapp verify SPEC-7)设的是 NEXION_UNIAPP_ROOT,解析器 envKey 是 NEXION_APP_ROOT,只报后者会误导排障。
  throw new Error(`NEXION_UNIAPP_ROOT/NEXION_APP_ROOT 配置的 App 路径不存在: ${path.resolve(configuredAppRoot)}`);
}
const APP_ROOT = resolveNexionAppRoot({
  adminRoot: ROOT,
  env: { ...process.env, NEXION_APP_ROOT: configuredAppRoot },
});

function read(relative, base = ROOT) {
  const file = path.join(base, ...relative.split("/"));
  if (!fs.existsSync(file)) throw new Error(`missing contract source: ${file}`);
  return { file, text: fs.readFileSync(file, "utf8") };
}

function includes(source, token) {
  if (!source.text.includes(token)) throw new Error(`${source.file} missing ${token}`);
}

const appApi = read("src/api/platform-config-api.ts", APP_ROOT);
const appTypes = read("src/store/config-types.ts", APP_ROOT);
const pcE6 = read("lib/admin/e6-client.ts");
const pcE6Route = read("app/api/admin/devices/[...path]/route.ts");
const pcK = read("lib/admin/k-client.ts");

// App public platform-config contract: server response is parsed strictly, including
// the currently projected H3 flags, online bonus and share/download structures.
for (const token of [
  "PlatformComputeConfigSnapshot",
  "parsePlatformComputeConfig",
  '"/api/config/platform"',
  "homeNewcomerTasksEnabled",
  "homeWeeklyPromoEnabled",
  "h5BaseFactor",
  "continuityFullHours",
  "share",
]) includes(appApi, token);
for (const token of ["interface FeatureFlags", "interface OnlineBonus", "interface ShareConfig", "RiskClusterConfig", "OtpGateConfig"]) {
  includes(appTypes, token);
}

// PC admin contract: real E6 endpoint `/api/admin/devices/compute-config` and strict parser, not the retired mock.
for (const token of [
  "fetchE6ComputeConfig",
  "parseE6ComputeConfig",
  '"/compute-config"',
  'e6FlagKey("computeShareEnabled")',
  'e6CoeffKey("h5BaseFactor")',
  'e6CoeffKey("continuityFullHours")',
]) includes(pcE6, token);
for (const token of ["compute-config", "params"]) includes(pcE6Route, token);

// SPEC-7 risk controls now come from the real K1/K2 server APIs. Keep the
// required key-set and strict value validation anchored in the current parser.
for (const token of [
  "K1_REQUIRED_PARAM_KEYS",
  "K1_RELEASE_PARAM_KEYS",
  "K2_PARAM_KEYS",
  "fetchK1MultiAccountOverview",
  'apiRequest("/arbitrage/overview")',
  'apiRequest(`/multi-account/params/${encodeURIComponent(key)}`',
]) includes(pcK, token);

console.log(JSON.stringify({
  status: "passed",
  appRoot: APP_ROOT,
  pcRoot: ROOT,
  sources: [appApi.file, appTypes.file, pcE6.file, pcE6Route.file, pcK.file],
  contract: "server-platform-config-and-k1-k2-api",
}, null, 2));
