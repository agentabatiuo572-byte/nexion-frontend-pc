import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  A2_AUDIT_DOMAINS,
  buildA2FilterQuery,
  canAccessA2Export,
  canAccessA2Write,
  matchesA2AuditFilter,
  matchesA2OperationRole,
  parseA2ReasonMin,
  parseA2SchemaVersion,
  resolveA2AuditObject,
  resolveA2AuditDomain,
  validateA2MechanismValue,
  validateA2AuditFilterRange,
} from "../lib/admin/a2-policy.ts";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("A2 exposes every real A-M domain and serializes one shared filter contract", () => {
  assert.deepEqual(A2_AUDIT_DOMAINS, [..."ABCDEFGHIJKLM"]);
  assert.equal(buildA2FilterQuery({
    domain: "K",
    operator: " 风控 ",
    action: " RULE ",
    object: " user-1 ",
    startTime: "2026-07-01T00:00",
    endTime: "2026-07-17T23:59",
  }).toString(), "domain=K&operator=%E9%A3%8E%E6%8E%A7&action=RULE&object=user-1&startTime=2026-07-01T00%3A00&endTime=2026-07-17T23%3A59%3A59.999");
});

test("A2 audit list matching uses the same six filter fields as export", () => {
  const row = {
    domain: "K",
    actor: "risk-admin",
    action: "K3_RULE_UPDATED",
    obj: "rule-18",
    createdAt: "2026-07-17T10:00:00.000Z",
  };
  assert.equal(matchesA2AuditFilter(row, { domain: "K", operator: "risk", action: "rule", object: "18" }), true);
  assert.equal(matchesA2AuditFilter(row, { domain: "D" }), false);
  assert.equal(matchesA2AuditFilter(row, { startTime: "2026-07-17T11:00:00.000Z" }), false);
  assert.equal(validateA2AuditFilterRange({ startTime: "2026-07-17T12:00", endTime: "2026-07-17T11:59" }), "开始时间不能晚于结束时间");
  assert.equal(validateA2AuditFilterRange({ startTime: "2026-07-17T12:00", endTime: "2026-07-17T12:00" }), null);
  assert.equal(matchesA2AuditFilter(
    { ...row, createdAt: "2026-07-17T10:59:45" },
    { endTime: "2026-07-17T10:59" },
  ), true);
  assert.equal(resolveA2AuditDomain("D", "A", "A2_OPERATION_EXECUTED", "ticket-1"), "D");
  assert.equal(resolveA2AuditDomain(null, null, "USER_NICKNAME_RESET", "USER_PROFILE"), "C");
  assert.equal(resolveA2AuditObject(undefined, undefined, "D4_BILLS", "all"), "D4_BILLS · all");
  assert.equal(resolveA2AuditObject("detail-target", undefined, "D4_BILLS", "all"), "detail-target");
});

test("A2 authority helpers fail closed for read-only sessions", () => {
  assert.equal(canAccessA2Export([]), false);
  assert.equal(canAccessA2Write(["platform_a2_read"]), false);
  assert.equal(canAccessA2Export(["platform_a2_export"]), true);
  assert.equal(canAccessA2Export(["platform_a2_write"]), false);
  assert.equal(canAccessA2Write(["platform_a2_write"]), true);
});

test("A2 mechanism boundaries and dynamic reason minimum reject malformed values", () => {
  assert.equal(parseA2ReasonMin("12 字"), 12);
  assert.equal(parseA2ReasonMin("abc"), 8);
  assert.deepEqual(validateA2MechanismValue("ttl", "8"), { ok: true, value: "8" });
  assert.deepEqual(validateA2MechanismValue("ttl", "201"), { ok: false, message: "理由最短长度必须是 8–200 的整数" });
  assert.deepEqual(validateA2MechanismValue("retention", "13"), { ok: true, value: "13" });
  assert.deepEqual(validateA2MechanismValue("retention", "12"), { ok: false, message: "日志保留期必须是 13–36 的整数月" });
  assert.equal(parseA2SchemaVersion("统一 schema · v4"), "v4");
  assert.equal(parseA2SchemaVersion("v5"), "v5");
  assert.deepEqual(validateA2MechanismValue("schema", "v4", "v3"), { ok: true, value: "v4" });
  assert.deepEqual(validateA2MechanismValue("schema", "v2", "v3"), {
    ok: false,
    message: "字段结构版本只能升级，不能降级或重复提交",
  });
  assert.deepEqual(validateA2MechanismValue("schema", "vx", "v3"), {
    ok: false,
    message: "字段结构版本仅支持已注册的 v3、v4",
  });
  assert.deepEqual(validateA2MechanismValue("schema", "v5", "v3"), {
    ok: false,
    message: "字段结构版本仅支持已注册的 v3、v4",
  });
  assert.equal(matchesA2OperationRole("FINANCE", "财务"), true);
  assert.equal(matchesA2OperationRole("总管理员", "超管"), true);
  assert.equal(matchesA2OperationRole("risk-admin", "财务"), false);
  assert.equal(matchesA2OperationRole("risk-admin", "超管"), false);
});

test("A2 page is fail-closed, permission-aware and uses one applied filter for list and export", () => {
  const page = read("app/components/domain-views/a-tabs/a2-audit.tsx");
  const client = read("lib/admin/a2-client.ts");
  assert.match(page, /setOverview\(null\)/);
  assert.match(page, /canAccessA2Export/);
  assert.match(page, /canAccessA2Write/);
  assert.match(page, /isCurrentOperator\(w,\s*principal\)/);
  assert.match(page, /需其他具权人员执行/);
  assert.match(page, /matchesA2AuditFilter\(l, appliedFilter\)/);
  assert.match(page, /exportA2Audit\(reason, appliedFilter, commandKey\)/);
  assert.match(page, /filteredLogRows\.length === 0/);
  assert.match(page, /validateA2AuditFilterRange/);
  assert.match(page, /A2_MECHANISM_WRITE_NOT_CONFIRMED/);
  assert.match(page, /A2_OPERATION_WRITE_NOT_CONFIRMED/);
  assert.match(page, /runA2RetentionNow\(reason, commandKey\)/);
  assert.match(page, /最近执行:.*锁/);
  assert.match(client, /\/retention-runs\/latest/);
  assert.match(client, /\/retention-runs/);
  assert.match(page, /reasonMax:\s*200/);
  assert.match(page, /parseA2SchemaVersion/);
  assert.match(page, /matchesA2OperationRole\(w\.operatorRole, qOperator\)/);
  assert.match(client, /ts:\s*formatTime\(ticket\.ts\)/);
  assert.doesNotMatch(page, /当前服务的用户/);
  assert.match(page, /最近 500 条/);
  assert.doesNotMatch(page, /42 \* 60 \+ 10/);
  assert.doesNotMatch(page, /admin\.\*/);
  assert.doesNotMatch(page, /· pending/);
  for (const label of ["已执行", "已取消", "已撤回", "已过期", "今日审计事件"]) {
    assert.match(page, new RegExp(label));
  }
});

test("A2 export errors are actionable Chinese messages instead of raw machine codes", () => {
  const errors = read("lib/admin/error-messages.ts");
  for (const code of [
    "A2_EXPORT_TOO_LARGE_REFINE_FILTER",
    "A2_EXPORT_EMPTY_RESULT",
    "A2_EXPORT_SNAPSHOT_CHANGED_RETRY",
    "A2_FILTER_TIME_INVALID",
  ]) {
    assert.match(errors, new RegExp(`${code}: \\\"[^\\\"]*[\\u4e00-\\u9fff]`));
  }
});

test("shared confirmation awaits the mutation and accepts a server-derived reason minimum", () => {
  const shell = read("app/components/domain-views/a-view.tsx");
  const kit = read("app/components/domain-views/design-kit.tsx");
  const types = read("app/components/domain-views/k-tabs/types.ts");
  assert.match(shell, /await actionConfirmReq\.run/);
  assert.match(shell, /reasonMin=\{actionConfirmReq\.reasonMin\}/);
  assert.match(kit, /requestedReasonMin/);
  assert.doesNotMatch(kit, /const reasonMin = 8;/);
  assert.match(types, /reasonMin\?: number/);
});

test("A6 contains only the current single-person confirmation wording", () => {
  const page = read("app/components/domain-views/a-tabs/a6-roles.tsx");
  assert.doesNotMatch(page, /双人(?:审|复)|双.{0}签/);
  assert.match(page, /A2 单人确认/);
  assert.match(page, /await confirmReq\.run/);
  assert.match(page, /throw error/);
});
