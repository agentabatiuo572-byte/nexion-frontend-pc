import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

test("Next navigation hooks fail closed when a route or query value is unavailable", () => {
  const userDetail = read("app/_console/users/search/[id]/page.tsx");
  const c2 = read("app/components/domain-views/c-tabs/c2-actions.tsx");
  const c5 = read("app/components/domain-views/c-tabs/c5-security.tsx");
  const d4 = read("app/components/domain-views/d-tabs/d4-ledger.tsx");
  const k1 = read("app/components/domain-views/k-tabs/k1-multiaccount.tsx");
  const breadcrumb = read("app/components/shell/breadcrumb.tsx");

  assert.match(userDetail, /params\?\.id\?\.trim\(\) \?\? ""/);
  assert.match(userDetail, /用户标识缺失，已停止加载/);
  assert.match(userDetail, /searchParams\?\.get\("returnTo"\)/);
  assert.match(c2, /searchParams\?\.get\("userCode"\)/);
  assert.match(c5, /new URLSearchParams\(searchParams\?\.toString\(\) \?\? ""\)/);
  assert.match(c5, /pathname \?\? "\/"/);
  assert.match(d4, /searchParams\?\.get\("bizNo"\)/);
  assert.match(k1, /searchParams\?\.get\("focusClusterId"\)/);
  assert.match(k1, /new URLSearchParams\(searchParams\?\.toString\(\) \?\? ""\)/);
  assert.match(breadcrumb, /usePathname\(\) \?\? ""/);
  assert.doesNotMatch(userDetail, /params!\.id/);
  assert.doesNotMatch(c5, /searchParams!\./);
  assert.doesNotMatch(k1, /searchParams!\./);
});
