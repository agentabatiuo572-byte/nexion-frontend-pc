import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { i6CopyQualityIssues } from "../lib/admin/i6-copy-quality.ts";

const kit = readFileSync(new URL("../app/components/domain-views/design-kit.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("../app/components/domain-views/i-tabs/i6-i18n.tsx", import.meta.url), "utf8");

test("I1 publish blocks filler and retired brand in all three locales", () => {
  assert.deepEqual(i6CopyQualityIssues("ccccc", "Find the NexionBox", "Tìm NexGridBox"), [
    "中文含占位文本", "英文仍使用旧品牌 Nexion",
  ]);
  assert.deepEqual(i6CopyQualityIssues("现在找到适合你的 NexGridBox", "Find the NexGridBox that fits you now", "Tìm NexGridBox phù hợp với bạn ngay"), []);
  assert.deepEqual(i6CopyQualityIssues("正常", "annexion", "AAAA"), []);
  assert.deepEqual(i6CopyQualityIssues("测试", "TODO", "PLACEHOLDER"), [
    "中文含占位文本", "英文含占位文本", "越南语含占位文本",
  ]);
});

test("I1 gates publish paths while retaining editable drafts and I6 reports fresh scan results", () => {
  assert.match(kit, /state\.saveMode === "发布生效"\) missing\.push\(\.\.\.i6CopyQualityIssues/);
  assert.match(kit, /spec\.kind === "copy-create"[\s\S]*?missing\.push\(\.\.\.i6CopyQualityIssues/);
  assert.match(view, /扫描完成 · 请核对刷新后的完整性问题/);
  assert.match(view, /无意义占位文本 \/ 旧品牌/);
});
