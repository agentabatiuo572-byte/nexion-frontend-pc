import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("../app/components/domain-views/i-tabs/i6-i18n.tsx", import.meta.url), "utf8");
const kit = readFileSync(new URL("../app/components/domain-views/design-kit.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/i-client.ts", import.meta.url), "utf8");

test("I6 uses a real selectable message catalog and complete CRUD actions", () => {
  assert.match(client, /messages:\s*I18nMessagePairView\[\]/);
  assert.match(client, /archiveI6LocalizedMessage/);
  assert.match(client, /fetchI6MessageVersions/);
  assert.match(client, /rollbackI6LocalizedMessage/);
  assert.match(view, /MESSAGES\.filter/);
  assert.match(view, /actions\.saveI6LocalizedDraft/);
  assert.match(view, /actions\.publishI6LocalizedMessage/);
  assert.match(view, /actions\.archiveI6LocalizedMessage/);
  assert.match(view, /actions\.fetchI6MessageVersions/);
  assert.match(view, /actions\.rollbackI6LocalizedMessage/);
  assert.match(view, /expectedVersion:\s*mode === "edit"/);
  assert.match(view, /selectedMessage\.version,\s*\n\s*reason/);
  assert.match(view, /row\.status === "archived"/);
  assert.match(view, /selectedMessage\.status === "published"/);
  assert.doesNotMatch(view, /\$\{nsDrawer\.ns\}\.title/);
});

test("I6 confirmation commands stay open until the write and canonical reload settle", () => {
  assert.match(view, /const runBackend = \(task: Promise<void>, ok: string\) => \{\s*return task/s);
  assert.match(view, /catch\(\(error\) => \{\s*toast\([\s\S]*throw error;/);
  assert.match(view, /return runBackend\(actions\.saveI6LocalizedDraft/);
  assert.match(view, /return runBackend\(actions\.publishI6LocalizedMessage/);
  assert.match(view, /return runBackend\(actions\.fixI6Integrity/);
});

test("I6 structured editor requires Chinese, English and Vietnamese", () => {
  assert.match(kit, /中文 zh 文案/);
  assert.match(kit, /英文 en copy/);
  assert.match(kit, /越南语 vi 文案/);
  assert.match(kit, /vi:\s*spec\.vi/);
  assert.match(view, /message\.vi\s*\?\s*"越"\s*:\s*"缺越"/);
});

test("I6 surfaces Chinese status labels and selected-key integrity repair", () => {
  assert.match(view, /published:\s*"已发布"/);
  assert.match(view, /draft:\s*"草稿"/);
  assert.match(view, /messageKey:\s*selectedMessage\.messageKey/);
  assert.match(view, /actions\.rescanI6/);
});

test("I6 only offers integrity repair when an issue count is positive", () => {
  assert.match(view, /iss\.cnt > 0 && canWriteI6/);
  assert.match(view, /iss\.cnt === 0 && <span className="tiny">无需修复<\/span>/);
});
