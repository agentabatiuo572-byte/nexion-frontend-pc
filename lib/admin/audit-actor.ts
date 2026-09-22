/**
 * 审计主体名的展示脱敏。
 *
 * 为什么放在渲染层而不是只靠写入侧修:zentao #229 的成因是审计主体被写成了
 * **用户手机号**(用户令牌的 username claim 装的是手机号),后端已改为只写 `user:<id>`。
 * 但**库里已有的历史行仍是手机号**,而且审计是 append-only —— 改写入侧修不好过去。
 * 所以展示侧必须自己兜住:凡是看起来像手机号的主体名,一律打码后再上屏。
 *
 * 判据刻意保守:只有「整串就是一个电话号码」才脱敏(可选 + 前缀、可含空格/连字符,
 * 至少 7 位数字)。带别的前缀的稳定标识(如 `user:7`、`admin:42`、`payment-gateway`)
 * 数字位数不够或不匹配,原样展示。
 */

/** 保留前 3 位与后 2 位,中间固定打 4 个星号(与 PRD 脱敏口径一致)。 */
const MASK = "****";

const PHONE_LIKE = /^\+?[\d][\d\s-]{5,}\d$/;

export function maskAuditActor(value: string): string {
  const raw = value.trim();
  if (!PHONE_LIKE.test(raw)) return raw;
  const digits = raw.replace(/[\s-]/g, "");
  // 去掉国家码后仍需像电话号码(7–15 位),避免把短数字串误当手机号。
  const body = digits.startsWith("+") ? digits.slice(1) : digits;
  if (body.length < 7 || body.length > 15) return raw;
  const head = body.slice(0, 3);
  const tail = body.slice(-2);
  return `${digits.startsWith("+") ? "+" : ""}${head}${MASK}${tail}`;
}
