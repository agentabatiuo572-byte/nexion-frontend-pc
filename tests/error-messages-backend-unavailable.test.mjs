import assert from "node:assert/strict";
import test from "node:test";

import { formatAdminApiError } from "../lib/admin/error-messages.ts";

const UNAVAILABLE = "后台服务暂时不可达，本次提交未生效；请稍后重试，持续失败时请联系值班人员。";
const NETWORK = "网络连接失败或后台服务不可达；请检查网络后重试，提交类操作请先刷新核对是否已生效。";
const GENERIC_INPUT_FALLBACK = "操作失败,请检查输入内容或刷新页面后重试。";

test("unmapped *_BACKEND_UNAVAILABLE codes surface as backend outage, not user-input error", () => {
  // tB 实测:F5 冻结 503 携带 AUDIT_BACKEND_UNAVAILABLE,曾被兜成「检查输入」误导运营
  assert.equal(formatAdminApiError("AUDIT_BACKEND_UNAVAILABLE", "X"), UNAVAILABLE);
  assert.equal(formatAdminApiError("WHATEVER_NEW_DOMAIN_BACKEND_UNAVAILABLE", "X"), UNAVAILABLE);
  assert.equal(formatAdminApiError("SERVICE_UNAVAILABLE", "X"), UNAVAILABLE);
  assert.equal(formatAdminApiError("Service Unavailable", "X"), UNAVAILABLE);
});

test("empty-body 5xx falls back to client code and still reads as environment failure", () => {
  assert.equal(formatAdminApiError(null, "F1_REQUEST_FAILED_503"), UNAVAILABLE);
  assert.match(formatAdminApiError(null, "B2_REQUEST_FAILED_500"), /服务暂时异常/);
});

test("502/504 gateway failures must not claim the submission did not take effect", () => {
  // 网关侧失败时后端可能已处理:只许「结果尚未确认」,禁止「未生效」断言
  for (const code of ["G4_REQUEST_FAILED_502", "K1_REQUEST_FAILED_504"]) {
    const copy = formatAdminApiError(null, code);
    assert.match(copy, /结果尚未确认/);
    assert.doesNotMatch(copy, /未生效/);
    assert.doesNotMatch(copy, /检查输入/);
  }
});

test("browser network failures translate to operator-readable Chinese", () => {
  assert.equal(formatAdminApiError("Failed to fetch", "X"), NETWORK);
  assert.equal(formatAdminApiError("NetworkError when attempting to fetch resource.", "X"), NETWORK);
  assert.equal(formatAdminApiError("Load failed", "X"), NETWORK);
});

test("existing domain-specific unavailable entries keep their bespoke copy", () => {
  assert.match(formatAdminApiError("EMERGENCY_BACKEND_UNAVAILABLE", "X"), /应急控制后端/);
  assert.match(formatAdminApiError("RISK_BACKEND_UNAVAILABLE", "X"), /风险服务/);
  assert.match(formatAdminApiError("PLATFORM_BACKEND_UNAVAILABLE", "X"), /平台服务暂时不可用/);
});

test("ordinary unknown machine codes still get the generic input fallback", () => {
  assert.equal(formatAdminApiError("SOME_UNKNOWN_VALIDATION_CODE", "X"), GENERIC_INPUT_FALLBACK);
  assert.equal(formatAdminApiError("F5_REQUEST_FAILED_404", "X"), GENERIC_INPUT_FALLBACK);
});

test("already-formatted Chinese copy passes through unchanged (idempotent throat)", () => {
  // displayAdminError 会把 client 已格式化的 Error.message 再喂回咽喉,必须幂等
  for (const copy of [
    "后台服务暂时不可达，本次提交未生效；请稍后重试，持续失败时请联系值班人员。",
    "操作理由需填写 8-200 个字符。",
    "F 域数据提交失败 · 后台服务暂时不可达，本次提交未生效；请稍后重试，持续失败时请联系值班人员。",
  ]) {
    assert.equal(formatAdminApiError(copy, "X"), copy);
  }
});

test("NETWORK_FAILURE fallback code maps to the network copy, never the input fallback", () => {
  assert.match(formatAdminApiError(null, "NETWORK_FAILURE"), /网络连接失败或后台服务不可达/);
});

test("displayAdminError funnels any unknown into operator-readable copy", async () => {
  const { displayAdminError } = await import("../lib/admin/error-messages.ts");
  // 裸机器码 Error → 通用兜底,不裸奔上屏(样本必须是表里没有的码,否则测的是映射不是兜底)
  assert.equal(displayAdminError(new Error("ZZ_NOT_IN_TABLE_RESPONSE_BROKEN")), GENERIC_INPUT_FALLBACK);
  // 补表码走专属文案,且绝不裸露英文码
  const l6 = displayAdminError(new Error("L6_RESPONSE_INVALID"));
  assert.match(l6, /运营报表服务/);
  assert.doesNotMatch(l6, /L6_/);
  // 已格式化中文 → 透传
  assert.equal(displayAdminError(new Error("操作理由需填写 8-200 个字符。")), "操作理由需填写 8-200 个字符。");
  // 网络英文 → 网络中文
  assert.match(displayAdminError(new TypeError("Failed to fetch")), /网络连接失败/);
  // 非 Error 垃圾输入 → 稳定兜底,不 crash 不显 undefined
  assert.match(displayAdminError(null), /失败|重试/);
  assert.match(displayAdminError(undefined), /失败|重试/);
  assert.match(displayAdminError({ weird: true }), /失败|重试/);
});
