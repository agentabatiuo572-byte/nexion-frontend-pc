import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pcRoot = path.resolve(here, "..");
const backendRoot = path.resolve(pcRoot, "..", "nexion-backend");
const readPc = (file) => readFileSync(path.join(pcRoot, file), "utf8");
const readBackend = (file) => readFileSync(path.join(backendRoot, file), "utf8");

test("L5 snapshots are stored as MinIO artifacts and served with a streaming response", () => {
  const store = readBackend(
    "src/main/java/ffdd/opsconsole/bi/infrastructure/BiReportArtifactStore.java",
  );
  const repository = readBackend(
    "src/main/java/ffdd/opsconsole/bi/infrastructure/MybatisBiReportRepository.java",
  );
  const controller = readBackend(
    "src/main/java/ffdd/opsconsole/bi/web/OpsBiController.java",
  );

  assert.match(store, /objectStorage\.put\(/);
  assert.match(store, /registerRollbackCleanup/);
  assert.match(store, /content_sha256|sha256/i);
  assert.match(repository, /artifactStore\.storeCsv/);
  assert.match(repository, /artifactStore\.open/);
  assert.match(controller, /StreamingResponseBody/);
  assert.match(controller, /downloadStreamFile/);
  assert.doesNotMatch(controller, /\.body\(file\.body\(\)\)/);
});

test("L5 download grants remain concurrent, expire independently, and bind to the issuing admin", () => {
  const mapper = readBackend(
    "src/main/java/ffdd/opsconsole/bi/mapper/BiReportArtifactMapper.java",
  );
  const store = readBackend(
    "src/main/java/ffdd/opsconsole/bi/infrastructure/BiReportArtifactStore.java",
  );
  const service = readBackend(
    "src/main/java/ffdd/opsconsole/bi/application/OpsBiService.java",
  );
  const controller = readBackend(
    "src/main/java/ffdd/opsconsole/bi/web/OpsBiController.java",
  );

  assert.match(mapper, /nx_bi_report_download_grant/);
  assert.match(mapper, /issued_to_admin_id\s*=\s*#\{adminId\}/);
  assert.match(mapper, /expires_at\s*>\s*#\{now\}/);
  assert.match(store, /insertGrant/);
  assert.match(service, /saveDownloadToken\([^;]*adminId\)/s);
  assert.match(service, /isDownloadTokenValid\([^;]*adminId\)/s);
  assert.match(controller, /bi_l5_regulatory_generate/);
});

test("every L5 CSV producer neutralizes formulas after leading whitespace", () => {
  for (const file of [
    "src/main/java/ffdd/opsconsole/bi/application/OpsBiService.java",
    "src/main/java/ffdd/opsconsole/bi/application/OpsRegulatoryReportService.java",
    "src/main/java/ffdd/opsconsole/treasury/application/OpsTreasuryService.java",
  ]) {
    const source = readBackend(file);
    assert.match(source, /stripLeading\(\)/, file);
    assert.match(source, /"=\+\-@"/, file);
    assert.match(source, /replace\("\\r", " "\).*replace\("\\n", " "\)/s, file);
  }
});

test("the visible L5 page keeps reason confirmation, I5 linkage, and server downloads", () => {
  const l5 = readPc("app/components/domain-views/l-tabs/l5-export.tsx");
  assert.match(l5, /reasonMin:\s*8/);
  assert.match(l5, /I5 当前法域 × 披露版本/);
  assert.match(l5, /downloadReport/);
  assert.match(l5, /downloadD4BillsCsv/);
  assert.match(l5, /明文敏感数据导出由服务端阻断/);
});

test("L5 and D4 publish the registered A4 admin.report_exported fact", () => {
  const repository = readBackend(
    "src/main/java/ffdd/opsconsole/bi/infrastructure/MybatisBiReportRepository.java",
  );
  const bi = readBackend(
    "src/main/java/ffdd/opsconsole/bi/application/OpsBiService.java",
  );
  const regulatory = readBackend(
    "src/main/java/ffdd/opsconsole/bi/application/OpsRegulatoryReportService.java",
  );
  const d4 = readBackend(
    "src/main/java/ffdd/opsconsole/treasury/application/OpsTreasuryService.java",
  );
  const migration = readBackend(
    "scripts/migrations/20260727_l5_export_artifact_storage.sql",
  );

  assert.match(repository, /eventOutboxService\.publish\("BI_REPORT", reportId, "admin\.report_exported"/);
  assert.match(bi, /publishReportExported/);
  assert.match(regulatory, /publishReportExported/);
  assert.match(d4, /eventOutboxService\.publish\("BI_REPORT", exportId, "admin\.report_exported"/);
  assert.match(migration, /'admin\.report_exported'/);
  assert.match(migration, /'report_id'.*'id'/s);
});
