/**
 * K6 接管执行可观测性契约(裁决① T1;规格 docs/changes/2026-08-07-k6-takeover-observability.md)。
 *
 * 守的不变量(全部行为级,真 import 模型跑判定):
 *   ① 相位枚举完整 —— 14 相位一个不少,标签一一对应(少一个 = 某段执行态又塌回黑盒)
 *   ② 🔴 目标对账:期望≠实际判失配;任一侧缺失**不判**(未上报 ≠ 被替换,防误报淹没真信号)
 *   ③ 版本对账:设备已应用版本落后即判 stale
 *   ④ 可重试性按**分类**判,不按错误码枚举(错误码是开放集合,枚举必漏)
 *   ⑤ 相位 → 旧 6 值命令态的摘要映射全覆盖且值域合法(既有消费者不回退)
 *   ⑥ 动作相位约束:在途可撤销/可换目标但不重复下发;撤销中只能重发撤销;
 *      不可重试的失败不给「原地重试」;禁用时必须给出**原因**(不是隐藏按钮)
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  TAKEOVER_PHASES,
  TAKEOVER_PHASE_LABEL,
  TAKEOVER_COMMAND_TYPES,
  TAKEOVER_FAILURE_CLASSES,
  TAKEOVER_FAILURE_CLASS_LABEL,
  takeoverRetryable,
  takeoverRecommendedAction,
  takeoverTargetMismatch,
  takeoverVersionStale,
  takeoverPhaseToCommandState,
  allowedTakeoverCommands,
  takeoverCommandDisabledReason,
} from "../lib/admin/janus-c2/takeover.ts";

const LEGACY_STATES = new Set(["PENDING", "PUBLISHED", "ACKED", "FAILED", "EXPIRED", "CANCELLED"]);

test("① 相位枚举完整且标签一一对应", () => {
  assert.equal(TAKEOVER_PHASES.length, 14, "相位少一个 = 某段执行态又塌回黑盒");
  for (const key of ["COMMAND_PENDING_ACK", "RECEIVED", "WAITING_SESSION_EDGE", "LOADING", "HANDOFF_FETCHING", "HANDOFF_MERGING", "HANDOFF_ACKED", "REVOKE_PENDING_ACK", "REVOKED"]) {
    assert.ok(TAKEOVER_PHASES.includes(key), `缺关键相位 ${key}`);
  }
  for (const phase of TAKEOVER_PHASES) {
    assert.ok(TAKEOVER_PHASE_LABEL[phase]?.length > 0, `${phase} 无中文标签`);
  }
  assert.equal(Object.keys(TAKEOVER_PHASE_LABEL).length, TAKEOVER_PHASES.length, "标签表与枚举不同步");
});

test("② 🔴 目标对账:不等即失配;任一侧缺失不判(防误报淹没真信号)", () => {
  assert.equal(takeoverTargetMismatch({ phase: "SUCCEEDED", expectedTargetId: "T-1", actualTargetId: "T-2" }), true);
  assert.equal(takeoverTargetMismatch({ phase: "SUCCEEDED", expectedTargetId: "T-1", actualTargetId: "T-1" }), false);
  assert.equal(takeoverTargetMismatch({ phase: "SUCCEEDED", expectedTargetId: "T-1", actualTargetId: " T-1 " }), false, "两侧空白差异不算被替换");
  assert.equal(takeoverTargetMismatch({ phase: "COMMAND_PENDING_ACK", expectedTargetId: "T-1" }), false, "设备未上报实际目标时不得判失配");
  assert.equal(takeoverTargetMismatch({ phase: "SUCCEEDED", actualTargetId: "T-2" }), false);
  assert.equal(takeoverTargetMismatch(null), false);
});

test("③ 版本对账:设备已应用版本落后即 stale", () => {
  assert.equal(takeoverVersionStale({ phase: "SUCCEEDED", commandVersion: 7, deviceAppliedVersion: 6 }), true);
  assert.equal(takeoverVersionStale({ phase: "SUCCEEDED", commandVersion: 7, deviceAppliedVersion: 7 }), false);
  assert.equal(takeoverVersionStale({ phase: "SUCCEEDED", commandVersion: 7 }), false, "设备未回报版本时不判");
});

test("④ 可重试性按分类判定,七类全覆盖且分组正确", () => {
  assert.equal(TAKEOVER_FAILURE_CLASSES.length, 7);
  for (const cls of TAKEOVER_FAILURE_CLASSES) {
    assert.ok(TAKEOVER_FAILURE_CLASS_LABEL[cls]?.length > 0, `${cls} 无中文标签`);
  }
  // 环境瞬时类可原地重试
  assert.equal(takeoverRetryable("delivery"), true);
  assert.equal(takeoverRetryable("webview"), true);
  // 目标/契约类:重试必然再失败,应换目标
  for (const cls of ["target", "contract"]) {
    assert.equal(takeoverRetryable(cls), false, `${cls} 不该判可重试`);
    assert.equal(takeoverRecommendedAction(cls), "CHANGE_TARGET");
  }
  // 交接/租约/清理类:设备可能半接管,必须先撤
  for (const cls of ["handoff", "lease", "cleanup"]) {
    assert.equal(takeoverRetryable(cls), false, `${cls} 不该判可重试`);
    assert.equal(takeoverRecommendedAction(cls), "REVOKE");
  }
  assert.equal(takeoverRetryable(null), false, "未分类失败一律不许原地重试");
  assert.equal(takeoverRecommendedAction(undefined), "NONE");
});

test("⑤ 相位 → 旧命令态摘要映射全覆盖且值域合法(既有消费者不回退)", () => {
  for (const phase of TAKEOVER_PHASES) {
    const summary = takeoverPhaseToCommandState(phase);
    assert.ok(summary === null || LEGACY_STATES.has(summary), `${phase} 映射出非法旧值 ${summary}`);
  }
  assert.equal(takeoverPhaseToCommandState("NONE"), null);
  assert.equal(takeoverPhaseToCommandState("SUCCEEDED"), "ACKED");
  assert.equal(takeoverPhaseToCommandState("REVOKED"), "ACKED");
  assert.equal(takeoverPhaseToCommandState("FAILED"), "FAILED");
  assert.equal(takeoverPhaseToCommandState("CANCELLED"), "CANCELLED");
  // 在途各相位都摘要成「已下发未终结」,不许把 LOADING 之类误报成已确认
  for (const phase of ["COMMAND_PENDING_ACK", "LOADING", "HANDOFF_MERGING", "REVOKE_PENDING_ACK"]) {
    assert.equal(takeoverPhaseToCommandState(phase), "PUBLISHED", `${phase} 摘要错误`);
  }
});

test("⑥ 动作相位约束 + 禁用必须给原因", () => {
  // 在途:可撤销可换目标,但不重复下发接管
  const inflight = { phase: "LOADING" };
  assert.deepEqual(allowedTakeoverCommands(inflight).sort(), ["CHANGE_TARGET", "REVOKE"]);
  assert.ok(takeoverCommandDisabledReason(inflight, "ACTIVATE"), "在途重复下发必须给禁用原因");
  // 撤销中:只能重发撤销
  assert.deepEqual(allowedTakeoverCommands({ phase: "REVOKE_PENDING_ACK" }), ["REVOKE"]);
  assert.match(takeoverCommandDisabledReason({ phase: "REVOKE_PENDING_ACK" }, "CHANGE_TARGET") ?? "", /撤销/);
  // 可重试失败:三动作齐;不可重试失败:无 ACTIVATE 且原因点明分类
  assert.ok(allowedTakeoverCommands({ phase: "FAILED", failureClass: "delivery" }).includes("ACTIVATE"));
  const hardFail = { phase: "FAILED", failureClass: "handoff" };
  assert.ok(!allowedTakeoverCommands(hardFail).includes("ACTIVATE"));
  assert.match(takeoverCommandDisabledReason(hardFail, "ACTIVATE") ?? "", /交接/);
  // 终态/无接管:无动作,且都要有原因
  for (const phase of ["NONE", "HIT_NOT_REQUESTED", "REVOKED", "CANCELLED"]) {
    assert.deepEqual(allowedTakeoverCommands({ phase }), []);
    for (const cmd of TAKEOVER_COMMAND_TYPES) {
      assert.ok(takeoverCommandDisabledReason({ phase }, cmd), `${phase}/${cmd} 缺禁用原因`);
    }
  }
  // 允许的动作一律不给禁用原因(反向断言,防「全都给原因」的假过)
  assert.equal(takeoverCommandDisabledReason(inflight, "REVOKE"), null);
});
