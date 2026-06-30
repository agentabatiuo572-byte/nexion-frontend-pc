#!/usr/bin/env node
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const scanRoots = ["app", "lib"];
const forbidden = [
  "acting-operator-store",
  "useActingOperator",
  "ACTING_PRESETS",
  "actingRoleLabel",
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", "lib/mock"].some((part) => full.includes(part))) continue;
      walk(full, out);
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const hits = [];
for (const scanRoot of scanRoots) {
  const abs = join(root, scanRoot);
  try {
    statSync(abs);
  } catch {
    continue;
  }
  for (const file of walk(abs)) {
    const text = readFileSync(file, "utf8");
    for (const token of forbidden) {
      if (text.includes(token)) {
        hits.push(`${relative(root, file)} contains ${token}`);
      }
    }
  }
}

if (hits.length) {
  console.error("RBAC auth source guard failed: local acting operator is still referenced.");
  for (const hit of hits) console.error(`- ${hit}`);
  process.exit(1);
}

const authStore = readFileSync(join(root, "lib", "store", "admin-auth.ts"), "utf8");
const authStoreForbidden = ["persist(", "createJSONStorage", "localStorage", "nexion-admin-auth"];
const authStoreHits = authStoreForbidden.filter((token) => authStore.includes(token));
if (authStoreHits.length) {
  console.error("RBAC auth source guard failed: admin auth state must not be persisted client-side.");
  for (const token of authStoreHits) console.error(`- lib/store/admin-auth.ts contains ${token}`);
  process.exit(1);
}

const authRouteForbidden = ["NEXT_PUBLIC_ADMIN_AUTH_BYPASS", "LOCAL_PREVIEW", "local-preview-token", "OK (local preview)"];
const authRouteHits = [];
for (const file of walk(join(root, "app", "api", "admin", "auth"))) {
  const text = readFileSync(file, "utf8");
  for (const token of authRouteForbidden) {
    if (text.includes(token)) authRouteHits.push(`${relative(root, file)} contains ${token}`);
  }
}
if (authRouteHits.length) {
  console.error("RBAC auth source guard failed: auth routes must not create local preview sessions.");
  for (const hit of authRouteHits) console.error(`- ${hit}`);
  process.exit(1);
}

const retiredUserOpsStore = join(root, "lib", "store", "admin", "user-ops-store.ts");
if (existsSync(retiredUserOpsStore)) {
  console.error("RBAC auth source guard failed: retired per-user mock ops store must not exist.");
  console.error("- lib/store/admin/user-ops-store.ts keeps freeze/session/voucher/ledger/audit state client-side");
  process.exit(1);
}

const platformConfigStore = readFileSync(join(root, "lib", "store", "admin", "platform-config-store.ts"), "utf8");
const platformStoreForbidden = ["persist(", "createJSONStorage", "localStorage", "nexion-admin-platform-v1"];
const platformStoreHits = platformStoreForbidden.filter((token) => platformConfigStore.includes(token));
if (platformStoreHits.length) {
  console.error("RBAC auth source guard failed: platform config business state must not be persisted client-side.");
  for (const token of platformStoreHits) console.error(`- lib/store/admin/platform-config-store.ts contains ${token}`);
  process.exit(1);
}

const retiredPlatformKeyHits = [];
for (const scanRoot of scanRoots) {
  const abs = join(root, scanRoot);
  try {
    statSync(abs);
  } catch {
    continue;
  }
  for (const file of walk(abs)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("nexion-admin-platform-v1")) continue;
    const rel = relative(root, file).replace(/\\/g, "/");
    const cleanupOnly =
      rel === "app/components/shell/console-shell.tsx" &&
      text.includes('removeItem("nexion-admin-platform-v1")') &&
      !/getItem\(["']nexion-admin-platform-v1["']\)|setItem\(["']nexion-admin-platform-v1["']\)/.test(text);
    if (!cleanupOnly) retiredPlatformKeyHits.push(`${rel} references nexion-admin-platform-v1`);
  }
}
if (retiredPlatformKeyHits.length) {
  console.error("RBAC auth source guard failed: retired platform business storage key must not be used at runtime.");
  for (const hit of retiredPlatformKeyHits) console.error(`- ${hit}`);
  process.exit(1);
}

console.log("RBAC auth source guard passed.");
