import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("H7 exposes versioned popup cadence fields and bounds", () => {
  const page = read("app/components/domain-views/h-tabs/h7-voucher-config.tsx");
  const form = read("app/components/domain-views/design-kit.tsx");
  assert.match(page, /popupDelayMs/);
  assert.match(page, /popupCooldownHours/);
  assert.match(page, /popupMaxPerSession/);
  assert.match(form, /弹窗延迟/);
  assert.match(form, /单会话上限/);
});
