// Static guard for SPEC-L2a01: semantic business actions must not regress to
// reason-only or free-text-only modal shells.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const required = [
  {
    file: "app/components/domain-views/design-kit.tsx",
    snippets: [
      'kind: "role-select"',
      'kind: "permission-matrix"',
      'kind: "copy-edit"',
      'kind: "course-authoring"',
      'kind: "campaign-edit"',
      'kind: "version-authoring"',
      'kind: "destructive-reason"',
      "businessMissing.length === 0",
      "至少一个授权变更",
      'data-proof="permission-diff-preview"',
    ],
  },
  {
    file: "app/components/domain-views/a-tabs/a1-accounts.tsx",
    snippets: ['kind: "role-select"', 'kind: "permission-matrix"'],
  },
  {
    file: "app/components/domain-views/e-view.tsx",
    snippets: ['op: "sku-delete"', 'op: "task-down"', 'kind: "destructive-reason"'],
  },
  {
    file: "app/components/domain-views/i-tabs/i1-copy-ab.tsx",
    snippets: ['kind: "copy-edit"', "draft.zh", "draft.en", "draft.audience", "draft.trafficSplit", "draft.versionNote"],
  },
  {
    file: "app/components/domain-views/i-tabs/i3-campaign.tsx",
    snippets: ['kind: "campaign-edit"', "draft.title", "draft.schedule", "draft.budget", "liveCampaign"],
  },
  {
    file: "app/components/domain-views/i-tabs/i4-trust.tsx",
    snippets: ['kind: "version-authoring"', "I.disclosure.SFC.draft.zh", "draft.effectiveDate", "draft.requiresReack", "draft.languageScope"],
  },
  {
    file: "app/components/domain-views/i-tabs/i6-i18n.tsx",
    snippets: ['kind: "localized-copy"', 'kind: "course-authoring"', ".title.zh", ".body.en", "I.tutorial.drafts", ".duration", ".publishState"],
  },
];

const forbidden = [
  { file: "app/components/domain-views/a-tabs/a1-accounts.tsx", pattern: /edit:\s*\{\s*kind:\s*"text"[\s\S]{0,120}role\[/, reason: "role change cannot be free-text edit" },
  { file: "app/components/domain-views/a-tabs/a1-accounts.tsx", pattern: /edit:\s*\{\s*kind:\s*"text"[\s\S]{0,160}M\/C\/R\/- × 7/, reason: "permission matrix cannot be free-text edit" },
  { file: "app/components/domain-views/i-tabs/i1-copy-ab.tsx", pattern: /editDraftV8\s*=\s*\(\)\s*=>\s*openConfirm/, reason: "copy draft edit must use businessForm" },
  { file: "app/components/domain-views/i-tabs/i3-campaign.tsx", pattern: /editDraft\s*=\s*\([^)]*\)\s*=>\s*openConfirm/, reason: "campaign draft edit must use businessForm" },
  { file: "app/components/domain-views/i-tabs/i4-trust.tsx", pattern: /draftDisclosure\s*=\s*\(\)\s*=>\s*\n\s*openConfirm/, reason: "disclosure draft must use businessForm" },
  { file: "app/components/domain-views/i-tabs/i6-i18n.tsx", pattern: /editKeyDraft\s*=\s*\(\)\s*=>\s*\n\s*openConfirm/, reason: "i18n draft edit must use businessForm" },
  { file: "app/components/domain-views/i-tabs/i6-i18n.tsx", pattern: /newCrs\s*=\s*\(\)\s*=>\s*\n\s*openConfirm/, reason: "course create must use businessForm" },
  { file: "app/components/domain-views/e-view.tsx", pattern: /const delSku\s*=\s*async[\s\S]{0,260}confirm\(/, reason: "SKU delete must use operation modal with destructive-reason" },
  { file: "app/components/domain-views/e-view.tsx", pattern: /const delTask\s*=\s*async[\s\S]{0,260}confirm\(/, reason: "task down must use operation modal with destructive-reason" },
];

const failures = [];

for (const item of required) {
  const content = read(item.file);
  for (const snippet of item.snippets) {
    if (!content.includes(snippet)) failures.push({ file: item.file, reason: `missing required snippet: ${snippet}` });
  }
}

for (const item of forbidden) {
  const content = read(item.file);
  if (item.pattern.test(content)) failures.push({ file: item.file, reason: item.reason });
}

if (failures.length) {
  console.error(JSON.stringify({ status: "failed", failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ status: "passed", checkedRequired: required.length, checkedForbidden: forbidden.length }, null, 2));
