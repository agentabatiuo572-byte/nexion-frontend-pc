import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strictRuntime = process.argv.includes("--runtime");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assertContains(rel, needles, failures) {
  const body = read(rel);
  for (const needle of needles) {
    if (!body.includes(needle)) failures.push(`${rel} missing ${needle}`);
  }
}

const failures = [];

assertContains("app/components/domain-views/design-kit.tsx", [
  "export function useDataListPager",
  "export function DataListPager",
  "data-list-pager=\"true\"",
  "export function PaginationExemption",
  "data-pagination-exempt=\"true\"",
  "data-pagination-reason",
  "data-pagination-max-rows",
], failures);

// 2026-08-03 追平 D 域 server-canonical 迁移:d2/d4 分页升级为服务端分页(page/pageSize 状态 + 上一页/下一页 + 服务端总数),
// 客户端 useDataListPager/DataListPager 形态在这两页退役,改锚服务端分页三件套。
assertContains("app/components/domain-views/d-tabs/d2-withdrawals.tsx", [
  "setPageSize",
  "服务端分页总数",
  "上一页",
  "下一页",
], failures);

assertContains("app/components/domain-views/d-tabs/d4-ledger.tsx", [
  "setPageSize",
  "服务端分页",
  "上一页",
  "下一页",
], failures);

assertContains("app/components/domain-views/g-tabs/g1-staking.tsx", [
  "<PaginationExemption",
  "maxRows={4}",
  "reason=",
], failures);

// 2026-08-03:g4 节点列表升级为服务端分页(fetchG4GenesisOverview(page, pageSize)),豁免声明随之退役,改锚分页真身。
assertContains("app/components/domain-views/g-tabs/g4-genesis.tsx", [
  "fetchG4GenesisOverview(page, pageSize)",
  "setNodePageSize",
], failures);

assertContains("app/components/archetypes/list-archetype.tsx", [
  "useDataListPager(filtered",
  "<DataListPager",
  "<PaginationExemption",
], failures);

assertContains("lib/admin/module-content.ts", [
  "paginationExempt?:",
  "reason: string",
  "maxRows: number",
], failures);

assertContains("scripts/remediation-runtime-admin-shard.mjs", [
  "paginationPagerCount",
  "paginationExemptions",
  "data-list-pager",
  "data-pagination-exempt",
  "data-pagination-reason",
  "data-pagination-max-rows",
], failures);

function parseNdjson(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

const runtimeFindings = [];
if (strictRuntime) {
  const rows = parseNdjson("docs/audit/shards/ad-04-runtime.ndjson");
  const byRoute = new Map(rows.map((row) => [row.route, row]));
  const requirePager = ["/finance/withdrawals", "/finance/ledger"];
  const requirePagerOrExempt = ["/finance-products/staking", "/finance-products/genesis"];

  for (const route of requirePager) {
    const row = byRoute.get(route);
    const baseline = row?.evidence?.runtime?.listBaseline;
    if (row?.status !== "captured" || !baseline?.pagination || Number(baseline?.paginationPagerCount || 0) < 1) {
      runtimeFindings.push({ route, issue: "missing-runtime-pager", baseline: baseline ?? null });
    }
  }

  for (const route of requirePagerOrExempt) {
    const row = byRoute.get(route);
    const baseline = row?.evidence?.runtime?.listBaseline;
    if (row?.status !== "captured" || (!baseline?.pagination && !baseline?.paginationExempt)) {
      runtimeFindings.push({ route, issue: "missing-runtime-pager-or-valid-exemption", baseline: baseline ?? null });
      continue;
    }
    const invalid = (baseline?.paginationExemptions ?? []).filter((item) => !item.valid);
    if (invalid.length > 0) runtimeFindings.push({ route, issue: "invalid-pagination-exemption", invalid });
  }
}

if (runtimeFindings.length > 0) {
  failures.push(`runtime AD-04 unexempted list-capability findings: ${JSON.stringify(runtimeFindings)}`);
}

const result = {
  status: failures.length === 0 ? "passed" : "failed",
  checkedRequired: 8,
  runtimeStrict: strictRuntime,
  unexemptedP1: runtimeFindings.length,
  failures,
};

console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) process.exit(1);
