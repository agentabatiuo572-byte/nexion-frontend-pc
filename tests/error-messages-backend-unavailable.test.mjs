import assert from "node:assert/strict";
import test from "node:test";

import { formatAdminApiError } from "../lib/admin/error-messages.ts";

const UNAVAILABLE = "后台服务暂时不可达，本次提交未生效；请稍后重试，持续失败时请联系值班人员。";
const NETWORK = "网络连接失败或后台服务不可达；请检查网络后重试，提交类操作请先刷新核对是否已生效。";
// 表外机器码的中性兜底(2026-08-06 改:旧文案说「请检查输入内容」,把协议类失败冤枉成运营输错)
const GENERIC_UNMAPPED_FALLBACK = "操作未完成,请刷新页面核对最新状态后重试;若仍未恢复请联系值班人员。";

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

test("ordinary unknown machine codes still get the neutral unmapped fallback", () => {
  assert.equal(formatAdminApiError("SOME_UNKNOWN_VALIDATION_CODE", "X"), GENERIC_UNMAPPED_FALLBACK);
  assert.equal(formatAdminApiError("F5_REQUEST_FAILED_404", "X"), GENERIC_UNMAPPED_FALLBACK);
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
  assert.equal(displayAdminError(new Error("ZZ_NOT_IN_TABLE_RESPONSE_BROKEN")), GENERIC_UNMAPPED_FALLBACK);
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

// 构造性不变量:展示边界的输出必须含中文。
// why:此前咽喉靠「枚举特征」拦截(failed to fetch 正则、全大写机器码正则),枚举必漏——
// 实测漏过三族:① 带 `:小写后缀` 的码(MACHINE_CODE_RE 要求全大写,冒号破坏匹配)、
// ② 响应体读取阶段的英文 SyntaxError、③ 浏览器英文 DOMException。改判「没有中文就不许上屏」,
// 未知形态一律落中性兜底,新的泄漏形态不必先被人想到才拦得住。
test("display boundary never emits a CJK-free string (constructive invariant)", async () => {
  const { displayAdminError } = await import("../lib/admin/error-messages.ts");
  const leaks = [
    "H8_RESPONSE_INVALID:recentSettlements", // 大写码 + 冒号 + 小写字段名
    "B5_RESPONSE_INVALID:stream",
    "Unexpected token < in JSON at position 0", // response.json() 撞网关 HTML 错误页
    "The operation was aborted", // AbortSignal 超时/取消
    "NetworkError when attempting to fetch resource.",
    "ZZ_UNSEEN_FORM 42",
  ];
  for (const raw of leaks) {
    const shown = displayAdminError(new Error(raw));
    assert.match(shown, /[一-龥]/, `无中文即泄漏:${raw} -> ${shown}`);
    assert.notEqual(shown, raw, `原样透传即泄漏:${raw}`);
  }
  // 真中文文案不受影响(守住幂等透传,别把门焊成一律兜底)
  assert.equal(displayAdminError(new Error("操作理由至少填写 8 个字符。")), "操作理由至少填写 8 个字符。");
});

// 表外机器码的兜底文案不得断言「是你输错了」。
// why:实测全仓 81 个抛出的机器码里有 48 个没有表内条目,而它们几乎全是协议/契约/数据形状类失败
// (*_INVALID / *_MISSING / *_PROTOCOL_ERROR / *_SHAPE_INVALID / *_TRUNCATED / *_EMPTY_RESPONSE)。
// 旧兜底一律说「请检查输入内容」——L1 KPI 这种只读报表页运营根本没有输入可检查,是把人往错方向指,
// 与 99f2f2f「环境故障不得归因用户输入」同型。逐个补表是打地鼠,改兜底一次覆盖全部含将来新增的。
test("unmapped machine codes must not blame the operator's input", () => {
  const protocolCodes = [
    "L1_KPI_ID_SEQUENCE_INVALID",
    "L1_DASHBOARD_SHAPE_INVALID",
    "L2_RETENTION_PROTOCOL_ERROR",
    "A8_CATALOG_TRUNCATED",
    "B_ALERT_ACK_EMPTY_RESPONSE",
    "ZZ_NOT_IN_TABLE_RESPONSE_BROKEN",
  ];
  for (const code of protocolCodes) {
    const shown = formatAdminApiError(code, "");
    assert.doesNotMatch(shown, /检查输入|输入内容/, `协议类失败被归因到运营输入:${code} -> ${shown}`);
    assert.match(shown, /[一-龥]/, `兜底必须是中文:${code}`);
    assert.notEqual(shown, code, `裸码原样上屏:${code}`);
  }
  // 真属运营输入侧的码仍要给可操作提示(靠表内专属条目,不靠兜底)
  assert.match(formatAdminApiError("OPERATION_REASON_TOO_SHORT", "X"), /理由/);
});

// 环境故障不得归因到用户输入——此前只认 `_REQUEST_FAILED_5xx` 一种命名,
// 换个命名(BI_API_503 / TREASURY_API_502)就绕过分层。改判据为「机器码以 _5xx 结尾」,与命名前缀无关。
test("any machine code ending in _5xx is attributed to the environment, not user input", () => {
  assert.notEqual(formatAdminApiError("BI_API_503", "X"), GENERIC_UNMAPPED_FALLBACK);
  assert.match(formatAdminApiError("BI_API_503", "X"), /不可达|稍后重试/);
  // 502/504 是网关侧:后端可能已处理完,只说「结果尚未确认」,不得断言未生效
  assert.match(formatAdminApiError("TREASURY_API_502", "X"), /尚未确认/);
  assert.match(formatAdminApiError("TREASURY_API_504", "X"), /尚未确认/);
  assert.match(formatAdminApiError("MEDIA_REQUEST_FAILED_500", "X"), /服务|重试/);
  // 4xx 仍属用户输入侧,不许被新判据误收
  assert.equal(formatAdminApiError("F5_REQUEST_FAILED_404", "X"), GENERIC_UNMAPPED_FALLBACK);
});
