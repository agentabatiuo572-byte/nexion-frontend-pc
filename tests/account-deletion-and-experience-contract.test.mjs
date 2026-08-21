import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8");

test("users BFF exposes account deletion list/detail/CAS commands", () => {
  const route = read("app/api/admin/users/[...path]/route.ts");
  assert.match(route, /account-deletions/);
  assert.match(route, /review|block|complete|cancel/);
  assert.match(route, /GET|POST/);
  const client = read("lib/admin/account-deletion-client.ts");
  for (const value of ["status", "page", "limit", "expectedVersion", "Idempotency-Key", "review", "block", "complete", "cancel"]) {
    assert.match(client, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("account deletion queue is discoverable and fail-closed by authority", () => {
  const component = read("app/components/domain-views/c-tabs/account-deletion-queue.tsx");
  for (const value of ["REQUESTED", "IN_REVIEW", "BLOCKED", "COMPLETED", "CANCELLED", "user_c1_read", "user_c1_write", "expectedVersion", "刷新", "详情"]) {
    assert.match(component, new RegExp(value));
  }
  assert.match(read("app/components/domain-views/c-tabs/c2-actions.tsx"), /AccountDeletionQueue/);
});

test("platform BFF and client expose structured experience config with CAS", () => {
  const route = read("app/api/admin/platform/[...path]/route.ts");
  assert.match(route, /config.*experience/);
  const client = read("lib/admin/platform-experience-client.ts");
  for (const value of ["homeNewcomerTasksEnabled", "homeWeeklyPromoEnabled", "officialUrl", "textTemplate", "urlTemplate", "expectedVersion", "Idempotency-Key", "PLATFORM_EXPERIENCE_VERSION_CONFLICT"]) {
    assert.match(client, new RegExp(value));
  }
  assert.match(client, /ExperienceSource = "official" \| "unavailable"/);
  assert.doesNotMatch(client, /source === "mock"|\["official", "mock", "unavailable"\]/);
  const component = read("app/components/domain-views/a-tabs/a3-config.tsx");
  assert.match(component, /PlatformExperienceConfig/);
  const experience = read("app/components/domain-views/a-tabs/platform-experience-config.tsx");
  assert.match(experience, /首页新手任务（只读投影）/);
  assert.match(experience, /首页周促销（只读投影）/);
  assert.match(experience, /disabled=\{!canWrite \|\| config\.appDownload\.source === "unavailable"\}/);
  assert.match(experience, /H3 周促销管理/);
  assert.match(experience, /保存并回读/);
  assert.doesNotMatch(experience, />mock<|value="mock"/);
});

test("platform experience parser rejects malformed optional channel fields", () => {
  const client = read("lib/admin/platform-experience-client.ts");
  for (const field of ["textTemplate", "urlTemplate", "androidPackage", "iosScheme"]) {
    assert.match(client, new RegExp(`optionalChannelText\\(channel\\.${field}\\)`));
  }
});
