import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// H 域前后端契约测试 —— 系统覆盖 H1-H8 端点/字段/权限点对齐。
// 范式对齐 tests/e1-acceptance-contract.test.mjs 与 tests/b4-rhythm-closure-contract.test.mjs:
//   node --experimental-strip-types --test,读取源码做结构断言,不发起 HTTP。
// H 域前端真写统一走 /api/admin/growth/* 代理 → 后端 OpsGrowthController / OpsReferralRewardController。

const root = process.cwd();
const read = (relative) => readFileSync(join(root, relative), "utf8");

const hClient = read("lib/admin/h-client.ts");
const hView = read("app/components/domain-views/h-view.tsx");
const errorMessages = read("lib/admin/error-messages.ts");
const growthRoute = read("app/api/admin/growth/[...path]/route.ts");
const registry = read("lib/admin/high-ops-registry.ts");
const controller = read("../nexion-backend/src/main/java/ffdd/opsconsole/growth/web/OpsGrowthController.java");
const referralController = read("../nexion-backend/src/main/java/ffdd/opsconsole/growth/web/OpsReferralRewardController.java");
const referralService = read("../nexion-backend/src/main/java/ffdd/opsconsole/growth/application/OpsReferralRewardService.java");

const tab = (name) => read(`app/components/domain-views/h-tabs/${name}`);

/** 断言 controller 中某条端点映射 与 其紧随的 @PreAuthorize 权限在同一片段内出现。 */
function assertEndpointPermission(file, endpointAnchor, permission) {
  assert.ok(file.includes(endpointAnchor), `后端缺少端点锚点:${endpointAnchor}`);
  assert.ok(file.includes(`hasAuthority('${permission}')`), `后端缺少权限点:${permission}`);
  const idx = file.indexOf(endpointAnchor);
  // 端点映射行后 4 行内必须出现对应权限(PreAuthorize 紧贴方法上方)。
  const slice = file.slice(idx, idx + 320);
  assert.ok(
    slice.includes(`hasAuthority('${permission}')`),
    `端点 ${endpointAnchor} 未绑定权限 ${permission}(应在 320 字符内)`,
  );
}

// ============================ H1 节奏 / 当前阶段 ============================

test("H1 前端读模型由后端裁决,逐月旋钮矩阵写后端配置", () => {
  const h1 = tab("h1-phase.tsx");
  assert.match(h1, /fetchH1Phases/);
  assert.match(h1, /updateH1RhythmParam/);
  assert.match(h1, /updateH1MonthDial/);
  // 当前阶段 / 节奏位置由后端读模型派生(只读跟随),非前端臆造。
  assert.match(h1, /currentMonth/);
  assert.match(h1, /currentPhase/);
  assert.match(h1, /phaseProgressPct/);
  // 备付金红线核验字段直接消费后端 coverage 读模型。
  assert.match(h1, /coverageRatio/);
  assert.match(h1, /redlinePct/);
  // 节奏阶段闭集 P1-P6。
  assert.match(h1, /P1:[^}]*拉新/);
  assert.match(h1, /P6:[^}]*软退场/);
  // 沙盒预览只读,不写配置。
  assert.match(h1, /沙盒预览\(只读\)/);
  assert.match(h1, /沙盒预览会重新读取后端 H1 读模型,不写配置/);
  // 阶段效果归因回链 B4 节奏看板(与 b4-rhythm 断言的 href 一致)。
  assert.match(h1, /href="\/overview\/rhythm"[^>]*>去 B4 节奏看板/);
});

test("H1 client 端点对齐后端 rhythm/phases 路径并强制幂等键", () => {
  // 基础路径 /api/admin/growth${path} 在 growthRequest 中,rhythm/phases 作为 path 字符串参数传入。
  assert.match(hClient, /\/api\/admin\/growth\$\{path\}/);
  assert.ok(hClient.includes('"/rhythm"'));
  assert.ok(hClient.includes('"/phases"'));
  assert.match(hClient, /`\/rhythm\/\$\{key\}`/);
  assert.match(hClient, /`\/phases\/months\/\$\{month\}\/dials\/\$\{encodeURIComponent\(key\)}`/);
  assert.match(hClient, /`\/phases\/controls\/\$\{encodeURIComponent\(key\)}`/);
  assert.match(hClient, /`\/phases\/overrides\/\$\{encodeURIComponent\(id\)}`/);
  // 写操作必带 Idempotency-Key 前缀。
  assert.match(hClient, /"h1-rhythm"/);
  assert.match(hClient, /"h1-month-dial"/);
});

test("H1 后端端点与权限点对齐(canonical: growth_h1_*)", () => {
  assertEndpointPermission(controller, '@GetMapping("/phases")', "growth_h1_read");
  assertEndpointPermission(controller, '@GetMapping("/rhythm")', "growth_h1_read");
  assertEndpointPermission(controller, '@PatchMapping("/rhythm/{paramKey}")', "growth_h1_write");
  assertEndpointPermission(controller, '@PatchMapping("/phases/months/{month}/dials/{dialKey}")', "growth_h1_write");
  assertEndpointPermission(controller, '@PatchMapping("/phases/controls/{controlKey}")', "growth_h1_control_pin_write");
  assertEndpointPermission(controller, '@PatchMapping("/phases/overrides/{overrideId}")', "growth_h1_override_revoke");
});

test("H1 高敏操作走门槛队列:旋钮放大=超管,控制/override=门槛者", () => {
  assert.match(registry, /op: "h1_phase_dial"[\s\S]*?amplifies: true[\s\S]*?gateLabel: "超管"/);
  assert.match(registry, /op: "h1_phase_control"[\s\S]*?amplifies: false[\s\S]*?gateLabel: "门槛者"/);
  assert.match(registry, /op: "h1_phase_override"[\s\S]*?amplifies: false[\s\S]*?gateLabel: "门槛者"/);
});

// ============================ H2 试用 ============================

test("H2 前端四道前置闸与 7 态状态机全部由服务器裁决", () => {
  const h2 = tab("h2-trial.tsx");
  assert.match(h2, /fetchH2Trials/);
  assert.match(h2, /updateH2TrialParam/);
  assert.match(h2, /killH2AutoPush/);
  // 四道前置闸全部由服务器裁决。
  assert.match(h2, /四道前置闸/);
  assert.match(h2, /全部由服务器裁决/);
  // 7 态会话状态机。
  assert.match(h2, /7 态会话状态机/);
  assert.match(h2, /状态只能服务器推进/);
  // 终态会话不再允许强制介入。
  assert.match(h2, /\["cancelled", "redeemed", "failed"\]\.includes\(session\.state\)/);
  // Model A 抵扣由服务端重算,失败概率等 server-only 不下发。
  assert.match(h2, /Model A/);
  assert.match(h2, /抵扣规则由后端返回/);
  assert.match(h2, /server-only 字段不会以真实值下发/);
  assert.match(h2, /onChanged: \(\) => Promise<void>/);
  assert.match(h2, /await updateH2TrialParam[\s\S]*await onChanged\(\)/);
  assert.match(h2, /await killH2AutoPush\(reason\)[\s\S]*await reload\(\)/);
  assert.match(h2, /onChanged=\{reload\}/);
});

test("H2 ignores stale page responses after a faster pagination request wins", () => {
  const h2 = tab("h2-trial.tsx");
  assert.match(h2, /const reloadEpochRef = useRef\(0\)/);
  assert.match(h2, /const requestEpoch = \+\+reloadEpochRef\.current/);
  assert.match(h2, /if \(requestEpoch !== reloadEpochRef\.current\) return/);
  assert.match(h2, /onPageChange=\{\(next\) => \{ reloadEpochRef\.current \+= 1; setSessionPage\(next\); \}\}/);
  assert.match(h2, /onPageSizeChange=\{\(next\) => \{ reloadEpochRef\.current \+= 1; setSessionPage\(1\); setSessionPageSize\(next\); \}\}/);
});

test("E1 combination-discount conflicts have actionable operator messages", () => {
  for (const code of [
    "BUNDLE_DISCOUNT_VERSION_CONFLICT",
    "BUNDLE_DISCOUNT_VALUE_UNCHANGED",
    "BUNDLE_DISCOUNT_POLICY_INVALID",
  ]) assert.match(errorMessages, new RegExp(`${code}:`));
});

test("H2 client 端点对齐后端 trials 路径", () => {
  assert.match(hClient, /\/api\/admin\/growth\$\{path\}/);
  assert.ok(hClient.includes('"/trials"'));
  assert.match(hClient, /`\/trials\/params\/\$\{encodeURIComponent\(key\)}`/);
  assert.match(hClient, /`\/trials\/sessions\/\$\{encodeURIComponent\(sessionId\)}\/cancel`/);
  assert.match(hClient, /`\/trials\/sessions\/\$\{encodeURIComponent\(sessionId\)}\/charge`/);
  assert.match(hClient, /\/trials\/auto-push\/kill/);
  assert.match(hClient, /"h2-cancel"/);
  assert.match(hClient, /"h2-charge"/);
});

test("H2 后端端点与权限点对齐(canonical: growth_h2_*)", () => {
  assertEndpointPermission(controller, '@GetMapping("/trials")', "growth_h2_read");
  assertEndpointPermission(controller, '@PatchMapping("/trials/params/{paramKey}")', "growth_h2_write");
  assertEndpointPermission(controller, '@PostMapping("/trials/sessions/{sessionId}/cancel")', "growth_h2_session_cancel");
  assertEndpointPermission(controller, '@PostMapping("/trials/sessions/{sessionId}/charge")', "growth_h2_session_charge");
  assertEndpointPermission(controller, '@PostMapping("/trials/auto-push/kill")', "growth_h2_write");
});

test("H2 强制取消不动资金,强制扣款直接动 USDT 台账(amplifies 区分)", () => {
  assert.match(registry, /op: "h2_trial_cancel"[\s\S]*?amplifies: false[\s\S]*?gateLabel: "门槛者"/);
  assert.match(registry, /op: "h2_trial_charge"[\s\S]*?amplifies: true[\s\S]*?type: "fund"[\s\S]*?gateLabel: "门槛者"/);
});

// ============================ H3 任务 + canonical 事件链(与 A4 一致) ============================

test("H3 前端任务清单消费 canonical 契约表(task_key 串起服务端事件/下游/BI)", () => {
  const h3 = tab("h3-quest-events.tsx");
  assert.match(h3, /fetchH3QuestEvents/);
  assert.match(h3, /updateH3QuestConfig/);
  assert.match(h3, /createH3Mission/);
  assert.match(h3, /createH3MonthlyMission/);
  // 任务事件契约与归因表:canonical 字段集。
  assert.match(h3, /任务事件契约与归因\(只读\)/);
  assert.match(h3, /task_key \/ 服务端完成事件 \/ 下游业务事件 \/ B3 漏斗 \/ BI 口径/);
  assert.match(h3, /contract\.taskKey/);
  assert.match(h3, /contract\.serverEvent/);
  assert.match(h3, /contract\.downstream/);
  assert.match(h3, /contract\.bi/);
  assert.match(h3, /契约 = 归因共同事实源/);
  // 全局任务加成只读跟随 H1,本页只套用不派发。
  assert.match(h3, /全局任务加成 H1 派发/);
});

test("H3 client 端点对齐后端 quest-events 路径", () => {
  assert.match(hClient, /section === "events" \? "\/quest-events\/events-overview" : "\/quest-events\/tasks"/);
  assert.match(hClient, /`\/quest-events\/config\/\$\{encodeURIComponent\(key\)}`/);
  assert.match(hClient, /\/quest-events\/missions/);
  assert.match(hClient, /\/quest-events\/monthly-missions/);
});

test("H3 后端端点与权限点对齐(canonical: growth_h3_*)", () => {
  assertEndpointPermission(controller, '@GetMapping("/quest-events/tasks")', "growth_h3_read");
  assertEndpointPermission(controller, '@PatchMapping("/quest-events/config/{configKey}")', "growth_h3_write");
  assertEndpointPermission(controller, '@PostMapping("/quest-events/missions")', "growth_h3_write");
  assertEndpointPermission(controller, '@PostMapping("/quest-events/monthly-missions")', "growth_h3_write");
});

test("H3 canonical 事件链:outbox 投递→binding→完成事实,与 A4 同一 server-authoritative 口径", () => {
  const consumer = read("../nexion-backend/src/main/java/ffdd/opsconsole/growth/application/QuestCanonicalEventConsumer.java");
  const projector = read("../nexion-backend/src/main/java/ffdd/opsconsole/growth/application/QuestCanonicalEventProjector.java");
  const fact = read("../nexion-backend/src/main/java/ffdd/opsconsole/growth/application/QuestCompletionFactConsumer.java");

  // 持久化 intake,用户 HTTP 请求不直接进入此边界。
  assert.match(consumer, /Durable H3 intake for canonical facts emitted by trusted backend domains/);
  assert.match(consumer, /User HTTP requests never enter this boundary directly/);
  assert.match(consumer, /CONSUMER_GROUP = "h3-quest-completion"/);
  assert.match(consumer, /@EventListener/);
  // projector 强制 server-authoritative(canonical 真值校验)。
  assert.match(projector, /QUEST_CANONICAL_EVENT_NOT_SERVER_AUTHORITATIVE/);
  assert.match(projector, /getServerAuthoritative\(\)/);
  // 完成事实走 outbox 发 quest.completed 事件(下游可消费)。
  assert.match(fact, /quest\.completed/);
  assert.match(fact, /publishUserEvent\(/);

  // 与 A4 一致:canonical 事件链与 A4 schema 注册都强制 isServerAuthoritative 字段。
  const a4Client = read("lib/admin/a4-client.ts");
  assert.match(a4Client, /isServerAuthoritative/);
});

// ============================ H4 活动中心 + 转盘 ============================

test("H4 前端活动列表与转盘奖池治理走后端 quest-events 写接口", () => {
  const h3 = tab("h3-quest-events.tsx");
  assert.match(h3, /createH4QuestEvent/);
  assert.match(h3, /updateH4EventReward/);
  assert.match(h3, /updateH4EventStatus/);
  assert.match(h3, /updateH4EventFeatured/);
  assert.match(h3, /createH4WheelTier/);
  assert.match(h3, /updateH4WheelProbabilities/);
  assert.match(h3, /updateH4WheelTier/);
  assert.match(h3, /deleteH4WheelTier/);
  assert.match(h3, /createH4WheelGuard/);
  // 主推唯一性由后端校验。
  assert.match(h3, /主推活动唯一性由后端校验/);
  // 转盘概率合计必须等于 100(前端预校验,后端复核)。
  assert.match(h3, /转盘档位概率合计必须等于 100%/);
});

test("H4 client 端点对齐后端 events / wheel-tiers 路径", () => {
  assert.match(hClient, /`\/quest-events\/events\/\$\{encodeURIComponent\(eventId\)}\/\$\{field\}`/);
  assert.match(hClient, /\/quest-events\/events/);
  assert.match(hClient, /\/quest-events\/wheel-tiers/);
  assert.match(hClient, /\/quest-events\/wheel-tiers\/probabilities/);
  assert.match(hClient, /`\/quest-events\/wheel-tiers\/\$\{encodeURIComponent\(tierName\)}`/);
  assert.match(hClient, /\/quest-events\/wheel-guards/);
  assert.match(hClient, /"h4-event-create"/);
  assert.match(hClient, /"h4-tier-probabilities"/);
});

test("H4 后端端点与权限点对齐(活动 growth_h4_write / 转盘 growth_h4_wheel_pool_write)", () => {
  assertEndpointPermission(controller, '@GetMapping("/quest-events/events-overview")', "growth_h4_read");
  assertEndpointPermission(controller, '@PostMapping("/quest-events/events")', "growth_h4_write");
  assertEndpointPermission(controller, '@PatchMapping("/quest-events/events/{eventId}/reward")', "growth_h4_write");
  assertEndpointPermission(controller, '@PatchMapping("/quest-events/events/{eventId}/status")', "growth_h4_write");
  assertEndpointPermission(controller, '@PatchMapping("/quest-events/events/{eventId}/featured")', "growth_h4_write");
  assertEndpointPermission(controller, '@PostMapping("/quest-events/wheel-tiers")', "growth_h4_wheel_pool_write");
  assertEndpointPermission(controller, '@PatchMapping("/quest-events/wheel-tiers/probabilities")', "growth_h4_wheel_pool_write");
  assertEndpointPermission(controller, '@PatchMapping("/quest-events/wheel-tiers/{tierName}")', "growth_h4_wheel_pool_write");
  assertEndpointPermission(controller, '@DeleteMapping("/quest-events/wheel-tiers/{tierName}")', "growth_h4_wheel_pool_write");
  assertEndpointPermission(controller, '@PostMapping("/quest-events/wheel-guards")', "growth_h4_wheel_pool_write");
});

// ============================ H5 签到 / 连签 / 收益里程碑 ============================

test("H5 前端签到规则与里程碑奖励由后端配置,幸运概率两档合计 ≤100%", () => {
  const h5 = tab("h5-daily-milestones.tsx");
  assert.match(h5, /fetchH5CheckIn/);
  assert.match(h5, /updateH5StreakMilestone/);
  assert.match(h5, /updateH5PowerUp/);
  assert.match(h5, /updateH5EarnMilestone/);
  assert.match(h5, /updateH5EarnTickInterval/);
  // 幸运概率由后端校验两档合计不超过 100%。
  assert.match(h5, /幸运概率由后端校验两档合计不超过 100%/);
  // 服务端权威,空态不生成示例数据。
  assert.match(h5, /服务端权威/);
  assert.match(h5, /不使用本地示例数据/);
});

test("H5 client 端点对齐后端 check-in / earn-milestones 路径", () => {
  assert.match(hClient, /\/api\/admin\/growth\$\{path\}/);
  assert.ok(hClient.includes('"/check-in"'));
  assert.match(hClient, /`\/check-in\/rules\/\$\{encodeURIComponent\(key\)}`/);
  assert.match(hClient, /`\/check-in\/streak-milestones\/\$\{id\}`/);
  assert.match(hClient, /`\/check-in\/power-ups\/\$\{id\}\/config`/);
  assert.match(hClient, /`\/earn-milestones\/\$\{encodeURIComponent\(key\)}`/);
  assert.match(hClient, /\/earn-milestones\/tick-interval/);
});

test("H5 后端端点与权限点对齐(canonical: growth_h5_*,签到规则单独 rule_write)", () => {
  assertEndpointPermission(controller, '@GetMapping("/check-in")', "growth_h5_read");
  assertEndpointPermission(controller, '@PatchMapping("/check-in/rules/{ruleKey}")', "growth_h5_rule_write");
  assertEndpointPermission(controller, '@PatchMapping("/check-in/streak-milestones/{milestoneId}")', "growth_h5_write");
  assertEndpointPermission(controller, '@PatchMapping("/check-in/power-ups/{powerUpId}")', "growth_h5_write");
  assertEndpointPermission(controller, '@PatchMapping("/earn-milestones/tick-interval")', "growth_h5_write");
  assertEndpointPermission(controller, '@PatchMapping("/earn-milestones/{milestoneKey}")', "growth_h5_write");
});

test("H5 签到规则调整走门槛队列(配置变更不动资金)", () => {
  assert.match(registry, /op: "h5_checkin_rule"[\s\S]*?amplifies: false[\s\S]*?gateLabel: "门槛者"/);
});

// ============================ H7 代金券 ============================

test("H7 前端代金券 CRUD 与上下架走后端 vouchers 写接口,促销折扣不挂 B1 红线", () => {
  const h7 = tab("h7-voucher-config.tsx");
  assert.match(h7, /fetchH7Vouchers/);
  assert.match(h7, /createH7Voucher/);
  assert.match(h7, /updateH7Voucher/);
  assert.match(h7, /updateH7VoucherStatus/);
  assert.match(h7, /deleteH7Voucher/);
  // 代金券是促销折扣、非 NEX 负债,不挂 B1 红线。
  assert.match(h7, /代金券是促销折扣、非 NEX 负债,不挂 B1 红线/);
  // 类型闭集 fixed/percent。
  assert.match(h7, /type: "fixed" \| "percent"/);
});

test("H7 client 端点对齐后端 vouchers 路径", () => {
  assert.match(hClient, /\/api\/admin\/growth\$\{path\}/);
  assert.ok(hClient.includes('"/vouchers"'));
  assert.match(hClient, /`\/vouchers\/\$\{encodeURIComponent\(id\)}`/);
  assert.match(hClient, /`\/vouchers\/\$\{encodeURIComponent\(id\)}\/status`/);
  assert.match(hClient, /"h7-create"/);
  assert.match(hClient, /"h7-delete"/);
});

test("H7 后端端点与权限点对齐(canonical: growth_h7_read / growth_h7_write)", () => {
  assertEndpointPermission(controller, '@GetMapping("/vouchers")', "growth_h7_read");
  assertEndpointPermission(controller, '@PostMapping("/vouchers")', "growth_h7_write");
  assertEndpointPermission(controller, '@PatchMapping("/vouchers/{voucherId}")', "growth_h7_write");
  assertEndpointPermission(controller, '@PatchMapping("/vouchers/{voucherId}/status")', "growth_h7_write");
  assertEndpointPermission(controller, '@DeleteMapping("/vouchers/{voucherId}")', "growth_h7_write");
});

// ============================ H8 邀请奖励 ============================

test("H8 前端真实结算与发奖参数受 growth_h8_write / growth_h8_settle 双权限点门控", () => {
  const h8 = tab("h8-referral-rewards.tsx");
  assert.match(h8, /fetchH8ReferralRewards/);
  assert.match(h8, /updateH8ReferralRewardParam/);
  assert.match(h8, /growth_h8_write/);
  assert.match(h8, /growth_h8_settle/);
  // 写与结算两道权限分离:canWrite 门控调参,canSettle 门控真实结算。
  assert.match(h8, /canWrite = isSuperadmin \|\| !!session\?\.authorities\.includes\("growth_h8_write"\)/);
  assert.match(h8, /canSettle = isSuperadmin \|\| !!session\?\.authorities\.includes\("growth_h8_settle"\)/);
  // 运营人员只看到服务端裁决口径，不暴露 mock / 本地状态等实现术语。
  assert.match(h8, /结算结果以服务端邀请关系、唯一结算记录、钱包与资金台账为准/);
  assert.doesNotMatch(h8, /页面不含 mock、样例账户或本地发奖状态/);
});

test("H8 金额编辑精度与后端六位小数契约一致", () => {
  const h8 = tab("h8-referral-rewards.tsx");
  for (const key of ["newcomer.usdt", "newcomer.nex", "inviter.nex"]) {
    assert.match(
      h8,
      new RegExp(`key: "${key.replace(".", "\\.")}"[^\\n]*step: 0\\.000001`),
      `${key} 必须允许后端支持的六位小数`,
    );
  }
});

test("H8 未知结果保留弹窗并使用打开弹窗时生成的同一幂等键", () => {
  const h8 = tab("h8-referral-rewards.tsx");
  assert.match(h8, /const commandKey = createH8CommandKey\("h8-param"\)/);
  assert.match(h8, /updateH8ReferralRewardParam\(param\.key, storedValue, reason, data\.version, commandKey\)/);
  assert.match(hClient, /headers: \{ "Idempotency-Key": idempotencyKey \}/);
  assert.match(hView, /onConfirm=\{async \(reason, newValue, businessValue\) =>/);
  assert.match(hView, /await mc\.run\(reason, newValue, businessValue\)/);
  assert.doesNotMatch(hView, /finally\s*\{\s*setActionConfirm\(null\)/);
  assert.match(errorMessages, /H8_UPSTREAM_OUTCOME_UNKNOWN:[^\n]*结果未知[^\n]*可能已经生效[^\n]*刷新[^\n]*核对[^\n]*当前表单/);
});

test("H8 参数写入使用服务端版本与 CAS,拒绝路径单独留痕", () => {
  const h8 = tab("h8-referral-rewards.tsx");
  assert.match(hClient, /version: number/);
  assert.match(hClient, /expectedVersion/);
  assert.match(h8, /data\.version/);
  assert.match(referralService, /VERSION_KEY/);
  assert.match(referralService, /H8_CONFIG_VERSION_CONFLICT/);
  assert.match(referralService, /recordRequiredInNewTransaction/);
  assert.match(referralService, /\.result\("REJECTED"\)/);
});

test("H8 client only exposes read/param endpoints; settlement is reachable exclusively through A2 replay", () => {
  assert.match(hClient, /\/api\/admin\/growth\$\{path\}/);
  assert.ok(hClient.includes('"/referral-rewards"'));
  assert.match(hClient, /`\/referral-rewards\/params\/\$\{encodeURIComponent\(key\)}`/);
  assert.doesNotMatch(hClient, /\/referral-rewards\/settlements\/run/);
  assert.match(hClient, /"h8-param"/);
  assert.doesNotMatch(hClient, /"h8-settlement"/);
  assert.match(registry, /op: "h8_referral_settlement"/);
});

test("H8 后端端点与权限点对齐(canonical: growth_h8_read/write/settle)", () => {
  assertEndpointPermission(referralController, '@GetMapping', "growth_h8_read");
  assertEndpointPermission(referralController, '@PatchMapping("/params/{paramKey}")', "growth_h8_write");
  assertEndpointPermission(referralController, '@PostMapping("/settlements/run")', "growth_h8_settle");
});

test("H8 真实结算放大 NEX/USDT 流出,走门槛队列(type fund)", () => {
  assert.match(registry, /op: "h8_referral_settlement"[\s\S]*?amplifies: true[\s\S]*?type: "fund"[\s\S]*?gateLabel: "门槛者"/);
});

// ============================ growth 代理路由白名单 ============================

test("growth 代理路由白名单覆盖 H 域全部 path 头,拒绝未授权端点与 401", () => {
  // 白名单 9 个 head 与 H 域全部 client 路径头对齐。
  for (const head of ["phases", "rhythm", "trials", "quest-events", "check-in", "earn-milestones", "withdraw-gate", "vouchers", "referral-rewards"]) {
    assert.match(growthRoute, new RegExp(`"${head}"`), `growth 路由白名单缺少 head:${head}`);
  }
  // 未带 admin token 返回 401(ADMIN_AUTH_REQUIRED),后端不可达返回 503。
  assert.match(growthRoute, /ADMIN_AUTH_REQUIRED/);
  assert.match(growthRoute, /GROWTH_BACKEND_UNAVAILABLE/);
  assert.match(growthRoute, /GROWTH_ROUTE_NOT_FOUND/);
  // 代理透传 Idempotency-Key 到后端。
  assert.match(growthRoute, /IDEMPOTENCY_KEY_HEADER/);
  assert.match(growthRoute, /headers\.set\(IDEMPOTENCY_KEY_HEADER, idempotencyKey\)/);
});
