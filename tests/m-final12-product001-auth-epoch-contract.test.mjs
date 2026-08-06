import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("M-FINAL12-001 reloads the authoritative M snapshot after an auth lifecycle change", () => {
  const view = read("app/components/domain-views/m-view.tsx");

  assert.match(view, /const authEpoch = useAdminAuth\(\(state\) => state\.authEpoch\);/);
  assert.match(view, /const reloadMContent = useCallback\(async \(\) => \{[\s\S]*?\}, \[authEpoch\]\);/);
  assert.match(view, /useEffect\(\(\) => \{\s*void reloadMContent\(\);\s*\}, \[authEpoch, reloadMContent\]\);/);
});

test("M-FINAL12-001 never publishes an old-session progressive response into M3", () => {
  const client = read("lib/admin/m-client.ts");

  assert.match(client, /const mContentSessionKey = currentMContentSessionKey\(\);/);
  assert.match(client, /if \(!isMContentSessionCurrent\(mContentSessionKey\)\) return;/);
  assert.match(client, /if \(!isMContentSessionCurrent\(mContentSessionKey\)\) \{\s*throw new Error\("M_CONTENT_AUTH_EPOCH_CHANGED"\);\s*\}/);
});
