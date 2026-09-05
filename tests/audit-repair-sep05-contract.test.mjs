import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const pcRoot = path.resolve(import.meta.dirname, "..");
const backendRoot = path.resolve(pcRoot, "..", "nexion-backend");

const readPc = (relative) => readFileSync(path.join(pcRoot, relative), "utf8");
const readBackend = (relative) => readFileSync(path.join(backendRoot, relative), "utf8");

const mfaErrors = readPc("lib/admin/error-messages.ts");
const loginGate = readPc("app/components/shell/login-gate.tsx");
const authClient = readPc("lib/admin/auth-client.ts");
const h3 = readPc("app/components/domain-views/h-tabs/h3-quest-events.tsx");
const courseForm = readPc("app/components/domain-views/design-kit.tsx");
const growthService = readBackend("src/main/java/ffdd/opsconsole/growth/application/OpsGrowthService.java");
const i18nService = readBackend("src/main/java/ffdd/opsconsole/content/application/OpsI18nLearningService.java");
const schema = readBackend("scripts/schema.sql");

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing section start: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section end: ${end}`);
  return source.slice(from, to);
}

test("MFA verification errors are actionable in Chinese and an expired VERIFY challenge returns safely to login", () => {
  for (const code of ["ADMIN_MFA_CHALLENGE_INVALID", "ADMIN_MFA_CODE_INVALID", "ADMIN_MFA_CODE_REPLAYED"]) {
    const entry = new RegExp(`${code}:\\s*[\"']([^\"']+)[\"']`);
    const match = mfaErrors.match(entry);
    assert.ok(match, `${code} must have an explicit PC error message`);
    assert.match(match[1], /[\u4e00-\u9fff]/, `${code} must not fall through to a raw backend code`);
  }

  // Recovery must be in the VERIFY branch, not only the unrelated ENROLL-QR fallback.
  const verifyRecovery = section(loginGate, ") : verifyingMfa ? (", '{mfaChallenge?.mode === "ENROLL"');
  assert.match(verifyRecovery, /重新登录/, "a failed or expired VERIFY challenge needs a visible re-login action");
  assert.match(verifyRecovery, /onClick=\{[^}]+\}/, "the recovery action must be executable, not explanatory text");
  assert.match(loginGate, /setMfaChallenge\(null\)/, "re-login recovery must discard the stale challenge id");
  assert.match(loginGate, /失效|过期|重新获取/, "the stale-challenge branch must be distinguished from an ordinary wrong OTP");

  const verifyRequest = section(authClient, "export async function verifyAdminMfa", "// merge");
  assert.match(
    verifyRequest,
    /(?:\.code\s*=\s*result\?\.message|Object\.assign\(\s*new Error\([\s\S]{0,240}?\{\s*code:\s*result\?\.message)/,
    "verifyAdminMfa must preserve the backend code so LoginGate can reset an invalid or replayed challenge",
  );
});

test("H3 protects day-one three-stage rewards while retaining an explicit total-reward view", () => {
  const dayOneRows = section(h3, "{model.dayOneTasks.map((task, index) =>", "{(model.dayOneStates ?? []).map");
  assert.doesNotMatch(dayOneRows, /openTaskReward\(/, "DAY_ONE rows must not write nx_mission.reward_points");
  assert.match(dayOneRows, /总奖励|三段奖励|统一奖励/, "operators must still see the day-one reward policy rather than losing reward visibility");

  const rewardBranch = section(growthService,
    'Matcher taskReward = Pattern.compile("^mission\\\\.([A-Za-z0-9_-]{2,64})\\\\.reward$")',
    "int updated = mapper.updateMissionRewardByCode");
  assert.match(rewardBranch, /missionTypeByCode\(/, "the backend must read the mission type before reward persistence");
  const dayOneGuard = rewardBranch.slice(rewardBranch.indexOf("missionTypeByCode("));
  assert.match(dayOneGuard, /DAY_ONE/, "the backend must identify a DAY_ONE mission before reward persistence");
  assert.match(dayOneGuard, /return validation\(/, "DAY_ONE reward writes must be rejected before persistence");
  assert.match(growthService, /DayOneTriRewardPolicy/, "the three-stage policy remains the canonical day-one reward authority");
});

test("course authoring and the backend reject over-1024 Chinese, English, and Vietnamese copy without widening storage", () => {
  const authoring = section(courseForm, "const questionCount = Math.max(1, Number(value.quizCount || 1));", "if (spec.kind === \"campaign-edit\")");
  for (const field of ["titleZh", "titleEn", "titleVi"]) {
    assert.match(authoring, new RegExp(`input\\(\\"${field}\\",[\\s\\S]{0,160}?\\"text\\",\\s*1024\\)`), `${field} needs a visible 1024-character limit`);
  }
  for (const field of ["bodyZh", "bodyEn", "bodyVi"]) {
    assert.match(authoring, new RegExp(`textArea\\(\\"${field}\\",[\\s\\S]{0,160}?4,\\s*1024\\)`), `${field} needs a visible 1024-character limit`);
  }
  assert.match(courseForm, /maxLength=\{maxLength\}/, "the reusable field helpers must forward the explicit maxLength to the browser control");

  const payloadGuard = section(i18nService, "private ApiResult<Void> requireCoursePayload", "private ApiResult<Void> requireQuizPayload");
  assert.match(payloadGuard, /1024|COURSE_COPY_MAX_LENGTH/, "the service must enforce the database-bound copy limit independently of the PC form");
  assert.match(payloadGuard, /LEARNING_COURSE_[A-Z_]*(?:TOO_LONG|LENGTH_INVALID|COPY_LENGTH)/, "overlong copy needs a stable, actionable validation code");

  for (const locale of ["zh", "en", "vi"]) {
    assert.match(schema, new RegExp(`${locale}_value VARCHAR\\(1024\\) NOT NULL`), `nx_i18n_message_version.${locale}_value must remain VARCHAR(1024)`);
  }
});
