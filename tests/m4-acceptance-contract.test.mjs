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
  assert.match(view, /deleteFaq\(payload\.faqId, reason, idempotencyKey\)/);
  assert.match(view, /writeFaqRows\([^;]+reason, idempotencyKey\)/);
  assert.match(view, /writeSlaRows\([^;]+reason, idempotencyKey\)/);
  assert.match(client, /createFaq\([^)]*idempotencyKey\?: string\)/);
  assert.match(client, /updateFaq\([^)]*idempotencyKey\?: string\)/);
  assert.match(client, /updateFaqStatus\([^)]*idempotencyKey\?: string\)/);
  assert.match(client, /deleteFaq\([^)]*idempotencyKey\?: string\)/);
  assert.match(client, /updateSla\([^)]*idempotencyKey\?: string\)/);
});
