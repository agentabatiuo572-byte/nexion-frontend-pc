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
    // 2026-08-03:a1 细粒度授权矩阵已由 A6 服务端权威流程接管(a1 文案「在 A6 明确授权后再分配」),
    // a1 保留改角色 + 服务端权限差异预览;permission-matrix kind 仍由上方 design-kit 条目守护存量能力。
    file: "app/components/domain-views/a-tabs/a1-accounts.tsx",
    snippets: ['kind: "role-select"', "permissionDiff"],
  },
  {
    // 2026-08-04 对抗验收增补:授权真面在 A6,守结构化授权链路(纯文本授权禁令随 a1 编辑面退役由此接棒)。
    file: "app/components/domain-views/a-tabs/a6-roles.tsx",
    snippets: ["proposeA6RoleGrants"],
  },
  {
    file: "app/components/domain-views/e-view.tsx",
    snippets: ['op: "sku-delete"', 'op: "task-down"', 'kind: "destructive-reason"'],
  },
  {
    // 2026-08-03 追平 I 域重写:草稿字段 camelCase 化并补越南语(draft.zh → draftZh 等)。
    file: "app/components/domain-views/i-tabs/i1-copy-ab.tsx",
    snippets: ['kind: "copy-edit"', "draftZh", "draftEn", "draftVi", "draftAudience", "draftTrafficSplit", "draftNote"],
  },
  {
    // 2026-08-03:campaign-edit 弹窗演化为 Drawer + usePropose(A2 pending 票)+ 后端 /content/campaigns,改锚新链路。
    file: "app/components/domain-views/i-tabs/i3-campaign.tsx",
    snippets: ["usePropose", "/content/campaigns", "scheduledAt", "budget", "liveCampaign"],
  },
  {
    // 2026-08-03 追平披露中心重写:草稿对象改 draftDisclosure/draftEditor,字段名去 draft. 前缀。
    file: "app/components/domain-views/i-tabs/i4-trust.tsx",
    snippets: ['kind: "version-authoring"', "draftDisclosure", "effectiveDate", "requiresReack", "languageScope"],
  },
  {
    // 2026-08-03 追平 I6 重写:多语字段 camelCase 化(.title.zh → titleZh),教程草稿归 tutorial 动作区,发布态字段保名。
    file: "app/components/domain-views/i-tabs/i6-i18n.tsx",
    snippets: ['kind: "localized-copy"', 'kind: "course-authoring"', "titleZh", "bodyEn", "tutorial", ".duration", "publishState"],
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
