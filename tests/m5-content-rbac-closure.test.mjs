import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("M5 CONTENT read/write is a precise seed, menu, A8 and UI contract", () => {
  const permissions = read("../nexion-backend/scripts/rbac-classic-seed/02-role-permission-seed.sql");
  const menus = read("../nexion-backend/scripts/rbac-classic-seed/01-menu-seed.sql");
  const dictionary = read("../nexion-backend/scripts/rbac-classic-seed/KLM.sql");
  const page = read("app/components/domain-views/m-tabs/m5-scripts.tsx");

  assert.match(permissions, /r\.role_code='CONTENT'[\s\S]*service_m5_read[\s\S]*service_m5_write/s);
  assert.match(menus, /m\.menu_code IN \('M','M5'\)[\s\S]*r\.role_code='CONTENT'/s);
  assert.match(dictionary, /service_m5_read[\s\S]*service_m5_write/s);
  assert.match(page, /const isContentOperator = currentRoleKey === "content"/);
  assert.match(page, /const canManageM5Content = hasM5WriteAuthority && \(isSuperAdmin \|\| isContentOperator \|\| isSupportM5Supervisor\)/);
  assert.match(page, /const canManageM5Operations = hasM5WriteAuthority && \(isSuperAdmin \|\| isSupportM5Supervisor\)/);
});

test("M5 keeps support supervisor and unknown-role failure closed", () => {
  const page = read("app/components/domain-views/m-tabs/m5-scripts.tsx");
  const controller = read("../nexion-backend/src/main/java/ffdd/opsconsole/content/web/OpsSessionTemplateController.java");

  assert.match(page, /const isSupportM5Supervisor = currentRoleKey === "support" && isSupportSupervisor\(currentSupportAgent\)/);
  assert.match(page, /canManageM5Operations \? \(/);
  assert.match(page, /canManageM5Content \? \(/);
  assert.match(controller, /executeContentCommand\(/);
  assert.match(controller, /canManageM5Content\(\)/);
  assert.match(controller, /executeSupportOperationCommand\(/);
  assert.match(controller, /canManageSupportSeats\(\)/);
});
