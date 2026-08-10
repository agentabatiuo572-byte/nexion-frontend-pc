import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

const closeContentM5Permissions = (permissions) => {
  const next = new Set([...permissions].filter((permission) => !permission.startsWith("service_m")));
  next.add("service_m5_read");
  next.add("service_m5_write");
  return next;
};

const closeContentM5Menus = (menus) => {
  const next = new Set([...menus].filter((menu) => !menu.startsWith("M")));
  next.add("M");
  next.add("M5");
  return next;
};

const closeOnlyContent = (roleBindings, close) => new Map(
  [...roleBindings].map(([role, bindings]) => [role, role === "CONTENT" ? close(bindings) : new Set(bindings)]),
);

const assertContentClosureSql = (sql) => {
  assert.match(sql, /JOIN nx_admin_role r ON r\.id\s*=\s*rp\.role_id\s+AND r\.role_code\s*=\s*'CONTENT'[\s\S]*?WHERE p\.permission_code\s+LIKE\s+'service_m%';/);
  assert.match(sql, /r\.role_code\s*=\s*'CONTENT'[\s\S]*?p\.permission_code\s+IN\s*\('service_m5_read','service_m5_write'\)/);
  assert.match(sql, /JOIN nx_admin_role r ON r\.id\s*=\s*rm\.role_id\s+AND r\.role_code\s*=\s*'CONTENT'[\s\S]*?WHERE m\.menu_code\s+LIKE\s+'M%';/);
  assert.match(sql, /m\.menu_code\s+IN\s*\('M','M5'\)[\s\S]*?r\.role_code\s*=\s*'CONTENT'/);
};

test("CONTENT legacy M1-M4 fixture converges exactly to M5 read/write and M/M5", () => {
  const permissionBindings = closeOnlyContent(new Map([
    ["CONTENT", new Set([
      "content_i1_write",
      "service_m1_read",
      "service_m1_write",
      "service_m2_read",
      "service_m2_write",
      "service_m3_read",
      "service_m3_write",
      "service_m4_read",
      "service_m4_write",
      "service_m5_read",
    ])],
    ["SUPPORT", new Set(["service_m1_read", "service_m2_write", "service_m5_write"])],
    ["RISK", new Set(["service_m1_read", "service_m4_read", "service_m5_read"])],
  ]), closeContentM5Permissions);
  const menuBindings = closeOnlyContent(new Map([
    ["CONTENT", new Set(["I", "M", "M1", "M2", "M3", "M4", "M5"])],
    ["SUPPORT", new Set(["M", "M1", "M2", "M3", "M4", "M5"])],
    ["RISK", new Set(["M", "M1", "M2", "M3", "M4", "M5"])],
  ]), closeContentM5Menus);
  const permissions = permissionBindings.get("CONTENT");
  const menus = menuBindings.get("CONTENT");

  assert.deepEqual([...permissions].sort(), ["content_i1_write", "service_m5_read", "service_m5_write"]);
  assert.deepEqual([...menus].sort(), ["I", "M", "M5"]);
  assert.deepEqual([...permissionBindings.get("SUPPORT")].sort(), ["service_m1_read", "service_m2_write", "service_m5_write"]);
  assert.deepEqual([...permissionBindings.get("RISK")].sort(), ["service_m1_read", "service_m4_read", "service_m5_read"]);
  assert.deepEqual([...menuBindings.get("SUPPORT")].sort(), ["M", "M1", "M2", "M3", "M4", "M5"]);
  assert.deepEqual([...menuBindings.get("RISK")].sort(), ["M", "M1", "M2", "M3", "M4", "M5"]);
  assert.deepEqual([...closeContentM5Permissions(permissions)].sort(), [...permissions].sort());
  assert.deepEqual([...closeContentM5Menus(menus)].sort(), [...menus].sort());
});

test("seed and incremental migration scope cleanup to CONTENT only", () => {
  const permissions = read("../nexion-backend/scripts/rbac-classic-seed/02-role-permission-seed.sql");
  const menus = read("../nexion-backend/scripts/rbac-classic-seed/01-menu-seed.sql");
  const migration = read("../nexion-backend/scripts/migrations/20260809_m5_content_rbac_closure.sql");
  const startupRunner = read("../nexion-backend/scripts/apply_startup_schema_migrations.ps1");

  assertContentClosureSql(`${permissions}\n${menus}`);
  assertContentClosureSql(migration);
  assert.equal(
    [...startupRunner.matchAll(/20260809_m5_content_rbac_closure\.sql/g)].length,
    1,
    "the standard startup migration runner must apply the CONTENT M-domain closure exactly once",
  );
});
