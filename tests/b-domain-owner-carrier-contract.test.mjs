import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./e2e/b-domain-owner-20260728.spec.ts", import.meta.url), "utf8");

test("B Owner 非法 B5 阈值请求按当前会话 RBAC 分流，而非把 403 误判为载荷校验缺陷", () => {
  assert.match(source, /\/api\/admin\/auth\/session/);
  assert.match(source, /overview_b5_threshold_write/);
  assert.match(source, /const canWriteB5Threshold = authorities\.includes\("overview_b5_threshold_write"\)/);
  assert.match(source, /if \(canWriteB5Threshold\) expect\(\[400, 422\]\)\.toContain\(invalidThreshold\.status\(\)\);/);
  assert.match(source, /else expect\(invalidThreshold\.status\(\)\)\.toBe\(403\);/);
});

test("B Owner 载体保留匿名边界与失败关闭走查，且不把认证材料写进源码", () => {
  assert.match(source, /B1-B5 匿名读取拒绝，非法路由和非法参数安全失败/);
  assert.match(source, /B1-B5 对畸形 200、500 与网络超时全部失败关闭/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^)]*(?:password|totp|authorization|token)/i);
  assert.doesNotMatch(source, /JSON\.stringify\([^;]*(?:password|totp|authorization|token)/i);
});
