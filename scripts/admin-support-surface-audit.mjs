// Static guard for SPEC-L3a01 support admin surface.
// Checks route wiring, I8 render wiring, UniApp ticket field mirror, and verify needles.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN = path.resolve(ROOT, "..");
const failures = [];

function read(relOrAbs) {
  const file = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(ROOT, relOrAbs);
  return fs.readFileSync(file, "utf8");
}

function assertContains(file, needles) {
  const text = read(file);
  for (const needle of needles) {
    if (!text.includes(needle)) failures.push(`${file} missing ${needle}`);
  }
}

function assertRegex(file, regex, label) {
  const text = read(file);
  if (!regex.test(text)) failures.push(`${file} missing ${label}`);
}

assertContains("docs/remediation/specs/SPEC-L3a01-support-admin-surface.md", [
  "`modal-specs/content-support-ticket-workflow.md`",
]);
assertRegex(
  "docs/remediation/specs/SPEC-L3a01-support-admin-surface.md",
  /\| 状态 \| (approved|verified) \|/,
  "approved or verified spec status",
);
assertContains("docs/remediation/modal-specs/content-support-ticket-workflow.md", [
  "新增 FAQ",
  "运营回复",
  "关闭/重开",
  "owner/lastReplyAt",
]);
assertContains("lib/nav/console-nav.ts", [
  'id: "I8"',
  'path: "/content/support"',
  "客服支持 CMS",
  "66 个 L2",
]);
assertContains("lib/admin/registry/i.ts", [
  'path: "/content/support"',
  "id/category/subject/status/priority/lastReplyAt/messages/owner",
]);
assertContains("app/components/domain-views/i-view.tsx", [
  'I8: "I8"',
  "<I8Support ctx={ctx} />",
]);
assertContains("app/components/domain-views/i-tabs/data.ts", [
  "export type SupportTicket",
  "lastReplyAt: number",
  "owner: string",
  "SUPPORT_TICKETS",
]);
assertContains("app/components/domain-views/i-tabs/i8-support.tsx", [
  "data-proof=\"support-faq-save\"",
  "data-proof=\"support-ticket-reply-save\"",
  "data-proof=\"support-ticket-close\"",
  "I.support.faqs",
  "I.support.sla",
  "I.support.tickets",
  "DataListPager",
]);
assertContains("scripts/verify.sh", [
  "期望 66",
  'check_html "/content/support" "Help/FAQ 内容管理"',
  'check_html "/content/support" "Ticket 分类与 SLA"',
  'check_html "/content/support" "回复并转待用户"',
  "admin-support-surface-audit.mjs",
]);
assertContains(path.join(PLAN, "Nexion-uniapp/src/mock/tickets.ts"), [
  "lastReplyAt: number",
  "owner: string",
  'owner: "Marina K."',
]);
assertContains(path.join(PLAN, "Nexion-uniapp/src/store/tickets.ts"), [
  "lastReplyAt: raw.lastReplyAt ?? ticket.updatedAt",
  'owner: raw.owner ?? "Unassigned"',
  "lastReplyAt: now",
]);

const navRoutes = read("lib/nav/console-nav.ts").match(/path:\s*"[^"]+"/g) || [];
if (navRoutes.length !== 66) failures.push(`console-nav path count ${navRoutes.length}, expected 66`);

const supportRouteCount = (read("lib/nav/console-nav.ts").match(/\/content\/support/g) || []).length;
if (supportRouteCount < 1) failures.push("/content/support route not found in nav source");

assertRegex(
  "app/components/domain-views/i-tabs/i8-support.tsx",
  /replyBody[\s\S]{0,1200}messages:\s*\[[\s\S]{0,1200}author:\s*"agent"/,
  "agent reply appends a message",
);
assertRegex(
  "app/components/domain-views/i-tabs/i8-support.tsx",
  /selected\.status === "closed" \? "open" : "closed"/,
  "close/reopen status transition",
);

if (failures.length) {
  console.error("admin-support-surface-audit failed");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("admin-support-surface-audit passed");
