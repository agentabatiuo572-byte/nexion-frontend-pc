import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pcRoot = new URL("../", import.meta.url);
const backendRoot = new URL("../nexion-backend/", pcRoot);
const readPc = (path) => readFileSync(new URL(path, pcRoot), "utf8");
const readBackend = (path) => readFileSync(new URL(path, backendRoot), "utf8");

test("L5 exposes real I5-linked regulatory generation and keeps decrypted PII blocked", () => {
  const ui = readPc("app/components/domain-views/l-tabs/l5-export.tsx");
  const client = readPc("lib/admin/l-client.ts");
  const route = readPc("app/api/admin/regulatory/[[...path]]/route.ts");

  assert.match(ui, /生成监管报告/);
  assert.match(ui, /披露版本/);
  assert.doesNotMatch(ui, /I5 监管报告留到跨模块验收/);
  assert.match(client, /createRegulatoryReport/);
  assert.match(client, /REGULATORY:\s*"监管报告"/);
  assert.match(client, /fetchL5RegulatoryOptions/);
  assert.match(route, /\/api\/admin\/regulatory/);
  assert.match(ui, /明文敏感字段.*阻断/s);
  assert.doesNotMatch(ui, /action: "生成监管报告",[\s\S]{0,500}amplifies:/);
});

test("backend validates current disclosure truth, persists snapshot, audits, and supports canonical export APIs", () => {
  const service = readBackend("src/main/java/ffdd/opsconsole/bi/application/OpsRegulatoryReportService.java");
  const regulatoryController = readBackend("src/main/java/ffdd/opsconsole/bi/web/OpsRegulatoryReportController.java");
  const exportController = readBackend("src/main/java/ffdd/opsconsole/bi/web/OpsBiExportController.java");
  const opsBi = readBackend("src/main/java/ffdd/opsconsole/bi/application/OpsBiService.java");

  assert.match(service, /resolveCurrent/);
  assert.match(service, /chapterCount\(\).*7|chapterCount\(\) != 7/);
  assert.match(service, /saveSnapshotCsv/);
  assert.match(service, /admin\.report_exported/i);
  assert.match(service, /containsPii[\s\S]*false|Boolean\.FALSE/);
  assert.match(service, /dashboard\("L2"\)/);
  assert.match(service, /dashboard\.get\("stages"\)/);
  assert.doesNotMatch(service, /dashboard\("L2"\)\.get\("funnel"\)/);
  for (const source of ["C4", "L3", "L4", "D4", "A2", "J4"]) assert.match(service, new RegExp(`"${source}"`));
  assert.match(service, /admin\.emergency_playbook_executed/);
  assert.match(service, /currentFinanceSnapshot/);
  assert.match(service, /operationsDashboard/);
  assert.match(regulatoryController, /@PostMapping\("\/report"\)/);
  assert.match(regulatoryController, /bi_l5_regulatory_generate/);
  assert.match(exportController, /@PostMapping\("\/request"\)/);
  assert.match(exportController, /@GetMapping\("\/audit"\)/);
  assert.match(opsBi, /"REGULATORY"/);
  assert.match(opsBi, /case "REGULATORY" -> "bi_l5_regulatory_generate"/);
});

test("D4 seven-category detail export requires a bounded reason and writes the unified export audit", () => {
  const controller = readBackend("src/main/java/ffdd/opsconsole/treasury/web/OpsBillsController.java");
  const service = readBackend("src/main/java/ffdd/opsconsole/treasury/application/OpsTreasuryService.java");
  const client = readPc("lib/admin/d-client.ts");
  const d4 = readPc("app/components/domain-views/d-tabs/d4-ledger.tsx");
  const l5 = readPc("app/components/domain-views/l-tabs/l5-export.tsx");

  assert.match(controller, /@RequestParam\s+String reason/);
  assert.match(service, /D4_EXPORT_REASON_LENGTH_INVALID/);
  assert.match(service, /admin\.report_exported/i);
  assert.match(client, /downloadD4BillsCsv\([\s\S]*reason/);
  assert.match(d4, /reasonMin:\s*8/);
  assert.match(l5, /reasonMin:\s*8/);
});
