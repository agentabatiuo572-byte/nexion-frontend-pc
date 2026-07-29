import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const view = read("../app/components/domain-views/h-view.tsx");
const types = read("../app/components/domain-views/h-tabs/types.ts");
const h1 = read("../app/components/domain-views/h-tabs/h1-phase.tsx");
const h2 = read("../app/components/domain-views/h-tabs/h2-trial.tsx");
const h3h4 = read("../app/components/domain-views/h-tabs/h3-quest-events.tsx");
const h5 = read("../app/components/domain-views/h-tabs/h5-daily-milestones.tsx");
const h7 = read("../app/components/domain-views/h-tabs/h7-voucher-config.tsx");

test("H 域上下文从真实登录会话统一提供 authority 判断", () => {
  assert.match(view, /useAdminAuth/);
  assert.match(types, /can:\s*\(authority:\s*string\)\s*=>\s*boolean/);
  assert.match(view, /role\s*===\s*"superadmin"/);
  assert.match(view, /authorities\.includes\(authority\)/);
});

test("H1 精确区分一般写、控制项写和覆盖撤销", () => {
  assert.match(h1, /growth_h1_write/);
  assert.match(h1, /growth_h1_control_pin_write/);
  assert.match(h1, /growth_h1_override_revoke/);
  assert.match(h1, /onClick=\{canWrite\s*\?\s*\(\)\s*=>\s*openDial/);
  assert.match(h1, /disabled=\{!canWrite\}/);
  assert.match(h1, /disabled=\{!canControlWrite\}/);
});

test("H2 精确区分参数、会话取消和会话扣款权限", () => {
  assert.match(h2, /growth_h2_write/);
  assert.match(h2, /growth_h2_session_cancel/);
  assert.match(h2, /growth_h2_session_charge/);
  assert.match(h2, /disabled=\{readOnly\s*\|\|\s*!canWrite\}/);
  assert.match(h2, /disabled=\{!canCancel\}/);
  assert.match(h2, /disabled=\{!canCharge\}/);
});

test("H3、H4 与 H4 转盘奖池使用各自后端 authority", () => {
  assert.match(h3h4, /growth_h3_write/);
  assert.match(h3h4, /growth_h4_write/);
  assert.match(h3h4, /growth_h4_wheel_pool_write/);
  assert.match(h3h4, /disabled=\{!canModuleWrite/);
  assert.match(h3h4, /disabled=\{!canWheelWrite/);
});

test("H5 和 H7 写按钮失败关闭，重试读取不受写权限影响", () => {
  assert.match(h5, /growth_h5_rule_write/);
  assert.match(h5, /growth_h5_write/);
  assert.match(h5, /disabled=\{!canRuleWrite\}/);
  assert.match(h5, /disabled=\{!canWrite\}/);
  assert.match(h7, /growth_h7_write/);
  assert.match(h7, /disabled=\{!canWrite\}/);
  assert.match(h5, /onClick=\{\(\)\s*=>\s*void reload\(\)\}>重试/);
  assert.match(h7, /onClick=\{\(\)\s*=>\s*void reload\(\)\}>重试/);
});
