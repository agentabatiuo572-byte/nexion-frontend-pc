import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNexionAppRoot, resolveNexionBackendRoot } from "./lib/nexion-workspace-paths.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_ROOT = resolveNexionAppRoot({ adminRoot: ROOT });
const BACKEND_ROOT = resolveNexionBackendRoot({ adminRoot: ROOT });
const failures = [];
const checks = [];

function read(relativeRoot, relativeFile, label) {
  const file = path.join(relativeRoot, ...relativeFile.split("/"));
  if (!fs.existsSync(file)) {
    failures.push(`${label} 文件缺失: ${file}`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function pin(source, pattern, label) {
  if (pattern.test(source)) checks.push(label);
  else failures.push(`${label} 不匹配`);
}

const app = read(APP_ROOT, "src/store/deposits-core.ts", "App deposits-core");
const backend = read(
  BACKEND_ROOT,
  "src/main/java/ffdd/opsconsole/finance/application/OpsFinanceService.java",
  "Backend OpsFinanceService.java",
);
const client = read(ROOT, "lib/admin/d-client.ts", "PC D1 client");
const page = read(ROOT, "app/components/domain-views/d-tabs/d1-recon.tsx", "PC D1 page");
const proxy = read(ROOT, "app/api/admin/finance/[...path]/route.ts", "PC finance proxy");

for (const [network, fee] of [["usdt-trc20", 1], ["usdt-bep20", 1], ["usdt-erc20", 5]]) {
  pin(app, new RegExp(`"${network}"\\s*:\\s*${fee}\\b`), `App ${network} fee=${fee}`);
}
pin(app, /export const MIN_DEPOSIT_USDT\s*=\s*10\b/, "App chain minimum=10");
pin(app, /export const BANK_MAX_DEPOSIT_USDT\s*=\s*5000\b/, "App VietQR maximum=5000");

for (const [code, feeExpression, min, max] of [
  ["trc20", 'new BigDecimal\\("1"\\)', "10", "null"],
  ["bep20", 'new BigDecimal\\("1"\\)', "10", "null"],
  ["erc20", 'new BigDecimal\\("5"\\)', "10", "null"],
  ["vietqr", "BigDecimal\\.ZERO", "10", "null"],
]) {
  pin(
    backend,
    new RegExp(`new TopupChannelDef\\([^\\n]*"${code}"[^\\n]*${feeExpression}[^\\n]*new BigDecimal\\("${min}"\\)[^\\n]*${max}`),
    `Backend ${code} channel policy`,
  );
}
// The international card channel is retired (DEC-D-03, backend B28): it must stay switched off, its old limits no longer matter.
pin(backend, /new TopupChannelDef\([^\n]*"card"[^\n]*,\s*false\)/, "Backend card channel retired");
pin(client, /updateD1TopupChannelMax[\s\S]*?\/max-amount/, "PC channel maximum command");
pin(page, /maxAmountValue[\s\S]*?单笔上限/, "PC renders backend maximum");
pin(page, /perTxLimitUsd/, "PC renders VietQR maximum");
pin(proxy, /"max-amount"/, "PC proxies maximum command");

if (failures.length) {
  console.error("[channel-parity] FAIL");
  failures.forEach((failure) => console.error(`  ✗ ${failure}`));
  process.exit(1);
}
console.log(`[channel-parity] PASS (${checks.length} checks, App/PC/Backend real sources)`);
