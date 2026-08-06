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
  TAKEOVER_RECONCILE_TIMEOUT_MS,
  takeoverRetryable,
  takeoverRecommendedAction,
  takeoverTargetMismatch,
  takeoverReconciliationOverdue,
  takeoverVersionDrift,
  takeoverVersionStale,
  takeoverPhaseToCommandState,
  allowedTakeoverCommands,
  takeoverCommandDisabledReason,
} from "../lib/admin/janus-c2/takeover.ts";
import { normalizeK6Device } from "../lib/admin/k6-contract.ts";

/** 合法设备样本(与 tests/k6-janus-real-api-contract.test.mjs 同源)。 */
const VALID_DEVICE_FIXTURE = {
  sid: "SID-1", deviceId: "D-1", firstSeenAt: 1, lastSeenAt: 2, installAt: 1, installDays: 0,
  inviteCode: null, channel: "official", cohortId: null, status: "OBSERVING", desiredStatus: null,
  commandState: null, statusSource: "system", activated: false, remoteUrlKey: null,
  maturityScore: 10, recommendationScore: 20, environmentRiskScore: 0, priorityScore: 30,
  ua: null, platform: "Android", model: "Pixel", osName: "Android", browser: "WebView",
  maturity: { appOpenCount: 1, sessionCount: 1, repeatStreakDays: 0, foregroundDurationSeconds: 10,
    benchmarkViewed: false, optimizeDone: false, marketViewed: false, walletViewed: false },
  environment: { environmentRiskScore: 0, riskReasons: [], isHeadless: false, automationSignalCount: 0,
    fpBlocklistHit: false, screenAnomaly: false, timezoneMismatch: false, languageMismatch: false },
  hitStrategy: null, hitStrategyVersion: null, latestDecision: {}, latestSession: {}, manualOverride: {},
  lastOperatorId: null, lastOperationReason: null, activationKind: null, tags: [], version: 0,
};

const LEGACY_STATES = new Set(["PENDING", "PUBLISHED", "ACKED", "FAILED", "EXPIRED", "CANCELLED"]);

test("① 相位枚举完整且标签一一对应且互不重复", () => {
  assert.equal(TAKEOVER_PHASES.length, 15, "相位少一个 = 某段执行态又塌回黑盒");
  assert.ok(TAKEOVER_PHASES.includes("REVOKE_FAILED"), "撤销失败必须独立成相位:复用 FAILED 会把「接管仍生效」读成「接管没成功」");
  // 标签唯一性(审计 P2-3:此前只测非空,把 14 个标签改成同一个字也能绿)
  assert.equal(new Set(Object.values(TAKEOVER_PHASE_LABEL)).size, TAKEOVER_PHASES.length, "相位标签必须互不重复,否则界面无法区分");
  for (const key of ["COMMAND_PENDING_ACK", "RECEIVED", "WAITING_SESSION_EDGE", "LOADING", "HANDOFF_FETCHING", "HANDOFF_MERGING", "HANDOFF_ACKED", "REVOKE_PENDING_ACK", "REVOKED"]) {
    assert.ok(TAKEOVER_PHASES.includes(key), `缺关键相位 ${key}`);
  }
  for (const phase of TAKEOVER_PHASES) {
    assert.ok(TAKEOVER_PHASE_LABEL[phase]?.length > 0, `${phase} 无中文标签`);
  }
  assert.equal(Object.keys(TAKEOVER_PHASE_LABEL).length, TAKEOVER_PHASES.length, "标签表与枚举不同步");
});

test("②b 🔴 咽喉:归一器必须保住 takeover(纯函数全绿也可能一次都不亮)", () => {
  // 审计 P0-1:normalizeK6Device 是逐字段重建的白名单归一器,两条数据路径都过它;
  // 字段没在那里显式接住 = 永远到不了页面,而可选字段让 tsc 与纯函数测试都测不到。
  // 夹具与 k6-janus-real-api-contract 同源(那份是契约自己的合法设备样本):
  // 手写一份必随契约演进而假红,复用真样本才只测「takeover 过不过得了归一器」这一件事。
  const raw = {
    ...VALID_DEVICE_FIXTURE,
    takeover: {
      phase: "SUCCEEDED",
      expectedTargetId: "T-APPROVED",
      actualTargetId: "T-EVIL",
      commandVersion: 3,
      deviceAppliedVersion: 3,
    },
  };
  let device;
  try {
    device = normalizeK6Device(raw, "test.device");
  } catch (error) {
    assert.fail(`归一器拒绝了合法设备负载(测试桩需跟随契约更新):${error instanceof Error ? error.message : error}`);
  }
  assert.ok(device.takeover, "归一器把 takeover 整段丢了 —— 失配告警将永不渲染");
  assert.equal(device.takeover.actualTargetId, "T-EVIL");
  assert.equal(takeoverTargetMismatch(device.takeover, "T-APPROVED"), true, "过归一器之后仍须判得出失配");
});

test("② 🔴 目标对账:不等即失配;任一侧缺失不判(防误报淹没真信号)", () => {
  // 期望侧优先取后台批准绑定(独立锚点),不与实际目标同源(审计 P1-1)
  assert.equal(takeoverTargetMismatch({ phase: "SUCCEEDED", expectedTargetId: "T-EVIL", actualTargetId: "T-EVIL" }, "T-APPROVED"), true,
    "响应内两侧被一起伪造成相等时,必须靠后台批准绑定判出失配");
  assert.equal(takeoverTargetMismatch({ phase: "SUCCEEDED", expectedTargetId: "T-1", actualTargetId: "T-2" }), true);
  assert.equal(takeoverTargetMismatch({ phase: "SUCCEEDED", expectedTargetId: "T-1", actualTargetId: "T-1" }), false);
  assert.equal(takeoverTargetMismatch({ phase: "SUCCEEDED", expectedTargetId: "T-1", actualTargetId: " T-1 " }), false, "两侧空白差异不算被替换");
  assert.equal(takeoverTargetMismatch({ phase: "COMMAND_PENDING_ACK", expectedTargetId: "T-1" }), false, "设备未上报实际目标时不得判失配");
  assert.equal(takeoverTargetMismatch({ phase: "SUCCEEDED", actualTargetId: "T-2" }), false);
  assert.equal(takeoverTargetMismatch(null), false);
});

test("②c 🔴 静默不等于安全:设备不回报实际目标 → 超时后判「对账未完成」", () => {
  // 审计 P1-2:只做「不误报」的减法,等于把静音变成最省事的规避手段。
  const base = { phase: "SUCCEEDED", requestedAt: 1_000_000, acknowledgedAt: 1_000_000 };
  const now = 1_000_000 + TAKEOVER_RECONCILE_TIMEOUT_MS + 1;
  for (const silent of [undefined, null, "", "   "]) {
    assert.equal(takeoverTargetMismatch({ ...base, actualTargetId: silent }, "T-APPROVED"), false, "静音不判失配(不误报)");
    assert.equal(takeoverReconciliationOverdue({ ...base, actualTargetId: silent }, "T-APPROVED", now), true,
      `静音(${JSON.stringify(silent)})必须落到「对账未完成」,不能无声通过`);
  }
  // 已回报 → 交给 mismatch 判,不再报未完成
  assert.equal(takeoverReconciliationOverdue({ ...base, actualTargetId: "T-APPROVED" }, "T-APPROVED", now), false);
  // 未到容忍窗 / 未进入执行阶段 / 无批准目标 → 不判
  assert.equal(takeoverReconciliationOverdue(base, "T-APPROVED", 1_000_000 + 1_000), false, "容忍窗内不判");
  assert.equal(takeoverReconciliationOverdue({ ...base, phase: "COMMAND_PENDING_ACK" }, "T-APPROVED", now), false, "设备还没开始执行不判");
  assert.equal(takeoverReconciliationOverdue(base, null, now), false, "没有批准目标就无从对账");
});

test("③ 版本对账双向:落后 = 跑旧命令,超前 = 疑似注入(旧实现只防落后)", () => {
  assert.equal(takeoverVersionDrift({ phase: "SUCCEEDED", commandVersion: 7, deviceAppliedVersion: 6 }), "stale");
  assert.equal(takeoverVersionDrift({ phase: "SUCCEEDED", commandVersion: 7, deviceAppliedVersion: 7 }), "none");
  assert.equal(takeoverVersionDrift({ phase: "SUCCEEDED", commandVersion: 5, deviceAppliedVersion: 9 }), "ahead",
    "设备执行着后台从未下发的版本 —— 比落后危险得多,不得静默放行");
  assert.equal(takeoverVersionDrift({ phase: "SUCCEEDED", commandVersion: 7 }), "none", "设备未回报版本时不判");
  // 兼容旧窄判定
  assert.equal(takeoverVersionStale({ phase: "SUCCEEDED", commandVersion: 7, deviceAppliedVersion: 6 }), true);
  assert.equal(takeoverVersionStale({ phase: "SUCCEEDED", commandVersion: 5, deviceAppliedVersion: 9 }), false);
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

test("⑦ 🔴 对账异常压倒相位:孤儿接管必须有撤销出路", () => {
  // 审计 P1-4:曾经 phase:"NONE" + 目标失配会同时显示「请立即撤销」与「没有接管命令,撤销不可用」。
  const orphan = { phase: "NONE", expectedTargetId: "T-APPROVED", actualTargetId: "T-EVIL" };
  assert.deepEqual(allowedTakeoverCommands(orphan), [], "无异常标记时维持相位约束");
  assert.ok(allowedTakeoverCommands(orphan, true).includes("REVOKE"),
    "对账异常时撤销必须无条件放行 —— 相位是后台记录,异常恰恰说明记录与设备现实脱节");
  assert.equal(takeoverCommandDisabledReason(orphan, "REVOKE", true), null, "放行的动作不得再给禁用原因");
  // 已有 REVOKE 的相位不重复添加
  const inflight = { phase: "LOADING" };
  assert.equal(allowedTakeoverCommands(inflight, true).filter((c) => c === "REVOKE").length, 1);
});

test("⑧ 🔴 撤销失败相位:仍可重发撤销 / 换目标,且摘要不得报成已确认", () => {
  // 审计 P1-5:接管仍生效、失败的是撤销 —— 若摘要落成 ACKED,审计与队列会读成「已处理完」。
  const revokeFailed = { phase: "REVOKE_FAILED", failureClass: "cleanup" };
  assert.deepEqual(allowedTakeoverCommands(revokeFailed).sort(), ["CHANGE_TARGET", "REVOKE"]);
  assert.equal(takeoverPhaseToCommandState("REVOKE_FAILED"), "FAILED");
  assert.notEqual(takeoverPhaseToCommandState("REVOKE_FAILED"), "ACKED");
  assert.match(TAKEOVER_PHASE_LABEL.REVOKE_FAILED, /撤销/, "标签必须点明是撤销失败,不是接管失败");
});
