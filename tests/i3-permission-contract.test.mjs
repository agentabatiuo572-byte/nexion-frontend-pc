import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../app/components/domain-views/i-tabs/i3-campaign.tsx", import.meta.url),
  "utf8",
);

test("I3 写、CAP 和紧急发送按钮使用对应后端 authority", () => {
  assert.match(source, /useAdminAuth/);
  assert.match(source, /content_i3_write/);
  assert.match(source, /content_i3_cap_adjust/);
  assert.match(source, /content_i3_critical_send/);
  assert.match(source, /\{canWriteI3 && <button[\s\S]{0,300}\+ 新建 Campaign<\/button>\}/);
  assert.match(source, /canAdjustI3Cap \? \(/);
  assert.match(source, /canSendCampaign\(c\)/);
});

test("I3 行写动作在无权限时失败关闭为只读提示", () => {
  assert.match(source, /if \(!canWriteI3\) return <span className="tiny">只读<\/span>/);
});
