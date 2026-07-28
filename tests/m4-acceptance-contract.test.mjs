import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("M4 fails closed when knowledge data is unavailable and respects write permission", () => {
  const client = read("lib/admin/m-client.ts");
  const page = read("app/components/domain-views/m-tabs/m4-kb-sla.tsx");

  assert.match(client, /knowledgeAvailable: boolean/);
  assert.match(client, /"I\.support\.knowledgeAvailable": data\.knowledgeAvailable \? "1" : "0"/);
  assert.match(page, /service_m4_write/);
  assert.match(page, /知识库后端当前不可用/);
  assert.match(page, /当前账号只有查看权限/);
});

test("M4 waits for backend truth before success or closing forms", () => {
  const page = read("app/components/domain-views/m-tabs/m4-kb-sla.tsx");

  assert.match(page, /const commitM4Write = async/);
  assert.match(page, /const succeeded = await write\(\)/);
  assert.match(page, /if \(succeeded\) toast\(successMessage\)/);
  assert.match(page, /if \(succeeded\) \{/);
  assert.match(page, /disabled=\{writePending\}/);
});

test("M4 exposes FAQ search, category and status filters with real pagination", () => {
  const page = read("app/components/domain-views/m-tabs/m4-kb-sla.tsx");

  assert.match(page, /aria-label="搜索 FAQ"/);
  assert.match(page, /aria-label="FAQ 分类筛选"/);
  assert.match(page, /aria-label="FAQ 状态筛选"/);
  assert.match(page, /filteredFaqs\.slice/);
  assert.match(page, /上一页/);
  assert.match(page, /下一页/);
  assert.match(page, /简体中文/);
  assert.match(page, /排序\(小值靠前\)/);
  assert.match(page, /v\{f\.version\}/);
  assert.doesNotMatch(page, /label: "Help\/FAQ 内容管理"/);
});

test("M4 offers real create, edit, status, delete, and SLA backend commands", () => {
  const client = read("lib/admin/m-client.ts");
  const view = read("app/components/domain-views/m-view.tsx");
  const page = read("app/components/domain-views/m-tabs/m4-kb-sla.tsx");

  assert.match(client, /createFaq\(/);
  assert.match(client, /updateFaq\(/);
  assert.match(client, /updateFaqStatus\(/);
  assert.match(client, /deleteFaq\(/);
  assert.match(client, /updateSla\(/);
  assert.match(view, /I\.support\.faq\.__delete/);
  assert.match(page, /编辑 Help\/FAQ/);
  assert.match(page, /删除 FAQ/);
});

test("M4 consecutive FAQ creates use collision-free temporary IDs", () => {
  const page = read("app/components/domain-views/m-tabs/m4-kb-sla.tsx");

  assert.match(page, /FAQ-TMP-\$\{crypto\.randomUUID\(\)\}/);
  assert.doesNotMatch(page, /Number\(row\.id\.replace/);
  assert.doesNotMatch(page, /max \+ 1/);
});

test("M4 FAQ create keeps one temporary ID across an unknown-result retry", () => {
  const page = read("app/components/domain-views/m-tabs/m4-kb-sla.tsx");

  assert.match(page, /const createFaqTempId = useRef<string \| null>\(null\)/);
  assert.match(page, /id: editFaq\?\.id \?\? createFaqTempId\.current \?\? \(createFaqTempId\.current = nextFaqId\(\)\)/);
  assert.match(page, /createFaqTempId\.current = null/);
});

test("M4 retries every FAQ and SLA command with the same idempotency key", () => {
  const client = read("lib/admin/m-client.ts");
  const view = read("app/components/domain-views/m-view.tsx");

  assert.match(view, /writeFaqRows\([^)]*idempotencyKey/);
  assert.match(view, /writeSlaRows\([^)]*idempotencyKey/);
  assert.match(view, /deleteFaq\(payload\.faqId, payload\.expectedStatus, payload\.expectedVersion!, reason, idempotencyKey\)/);
  assert.match(view, /writeFaqRows\([^;]+reason, idempotencyKey\)/);
  assert.match(view, /writeSlaRows\([^;]+reason, idempotencyKey\)/);
  assert.match(client, /createFaq\([^)]*idempotencyKey\?: string\)/);
  assert.match(client, /updateFaq\([^)]*idempotencyKey\?: string\)/);
  assert.match(client, /updateFaqStatus\([^)]*idempotencyKey\?: string\)/);
  assert.match(client, /deleteFaq\([^)]*idempotencyKey\?: string\)/);
  assert.match(client, /updateSla\([^)]*idempotencyKey\?: string\)/);
});

test("M4 rejects malformed knowledge success envelopes instead of exposing a writable empty view", () => {
  const client = read("lib/admin/m-client.ts");

  assert.match(client, /function assertSupportKnowledgeOverview/);
  assert.match(client, /M4_KNOWLEDGE_OVERVIEW_MALFORMED/);
  assert.match(client, /new Set\(faqs\.map\(\(faq\) => faq\.id\)\)\.size !== faqs\.length/);
  assert.match(client, /M4_KNOWLEDGE_FAQ_ID_COLLISION/);
  assert.match(client, /SLA_CATEGORIES\.every/);
  assert.match(client, /assertSupportKnowledgeOverview\(/);
});

test("M4 carries visible FAQ and SLA versions through every concurrent mutation", () => {
  const data = read("app/components/domain-views/m-tabs/data.ts");
  const page = read("app/components/domain-views/m-tabs/m4-kb-sla.tsx");
  const view = read("app/components/domain-views/m-view.tsx");
  const client = read("lib/admin/m-client.ts");

  assert.match(data, /export type SupportSla = \{[\s\S]*version: number/);
  assert.match(page, /expectedStatus: faq\.status/);
  assert.match(page, /expectedVersion: faq\.version/);
  assert.match(page, /version: editRow\.version \+ 1/);
  assert.match(view, /updateFaq\(row, before, reason, idempotencyKey\)/);
  assert.match(view, /updateFaqStatus\(row\.id, row\.status, before\.status, before\.version, reason, idempotencyKey\)/);
  assert.match(view, /updateSla\(row, before\.version, reason, idempotencyKey\)/);
  assert.match(client, /expectedStatus: before\.status/);
  assert.match(client, /expectedVersion: before\.version/);
  assert.match(client, /status: nextStatus, expectedStatus, expectedVersion/);
  assert.match(client, /expectedVersion/);
});

test("M4 backend enforces CAS, 8-200 reasons, mandatory A2 and canonical A4 FAQ events", () => {
  const root = resolve(process.cwd(), "../nexion-backend");
  const backend = (path) => readFileSync(resolve(root, path), "utf8");
  const service = backend("src/main/java/ffdd/opsconsole/content/application/OpsSupportKnowledgeService.java");
  const faqMapper = backend("src/main/java/ffdd/opsconsole/content/mapper/HelpArticleMapper.java");
  const slaMapper = backend("src/main/java/ffdd/opsconsole/content/mapper/SupportSlaRuleMapper.java");
  const migration = backend("scripts/migrations/20260727_m4_knowledge_sla_cas.sql");

  assert.match(service, /reason\.trim\(\)\.length\(\) >= 8/);
  assert.match(service, /reason\.trim\(\)\.length\(\) <= 200/);
  assert.match(service, /SUPPORT_FAQ_CONCURRENT_MODIFICATION/);
  assert.match(service, /SUPPORT_SLA_CONCURRENT_MODIFICATION/);
  assert.match(service, /auditLogService\.recordRequired/);
  assert.match(service, /eventOutboxService\.publish\([\s\S]*admin\.support_faq_updated/);
  assert.match(faqMapper, /status=#\{expectedStatus\}[\s\S]*version_no=#\{expectedVersion\}/);
  assert.match(slaMapper, /version=#\{expectedVersion\}/);
  assert.match(migration, /ADD COLUMN version BIGINT NOT NULL DEFAULT 1/);
  assert.match(migration, /admin\.support_faq_updated/);
});

test("M4 authoritative SLA is evaluated into M2 ticket deadlines and overdue flags", () => {
  const client = read("lib/admin/m-client.ts");
  const m2 = read("app/components/domain-views/m-tabs/m2-tickets.tsx");
  const backendRoot = resolve(process.cwd(), "../nexion-backend");
  const backend = (path) => readFileSync(resolve(backendRoot, path), "utf8");
  const detail = backend("src/main/java/ffdd/opsconsole/content/domain/SupportTicketDetail.java");
  const target = backend("src/main/java/ffdd/opsconsole/content/domain/SupportTicketSlaTarget.java");
  const service = backend("src/main/java/ffdd/opsconsole/content/application/OpsSupportTicketService.java");

  assert.match(detail, /SupportTicketSlaTarget slaTarget/);
  assert.match(target, /Long ruleVersion/);
  assert.match(target, /LocalDateTime firstResponseDeadlineAt/);
  assert.match(target, /LocalDateTime resolutionDeadlineAt/);
  assert.match(target, /boolean firstResponseOverdue/);
  assert.match(target, /boolean resolutionOverdue/);
  assert.match(service, /knowledgeRepository\.listSla\(\)/);
  assert.match(service, /firstResponseAt\.isAfter\(firstResponseDeadlineAt\)/);
  assert.match(service, /resolvedAt\.isAfter\(resolutionDeadlineAt\)/);
  assert.match(client, /M2_TICKET_DETAIL_MALFORMED/);
  assert.match(client, /!slaTarget/);
  assert.match(m2, /SLA v\{ticket\.slaTarget\.ruleVersion\}/);
  assert.match(m2, /firstResponseDeadlineAt/);
  assert.match(m2, /resolutionDeadlineAt/);
});
