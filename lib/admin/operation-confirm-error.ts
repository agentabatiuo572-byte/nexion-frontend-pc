// 相对 + 显式 .ts:node --experimental-strip-types 直跑测试解析不了 `@/` 别名与无扩展名导入。
import { ADMIN_ERROR_MESSAGES, displayAdminError } from "./error-messages.ts";

const OPERATION_CONFIRM_FALLBACK =
  "提交未完成，当前输入已保留，请根据页面提示处理后重试。";

const PERMISSION_DENIED_MESSAGES = new Set([ADMIN_ERROR_MESSAGES.ADMIN_PERMISSION_DENIED, ADMIN_ERROR_MESSAGES.ACCESS_DENIED]);
export const PERMISSION_DENIED_EVENT = "nexion-admin-permission-denied";
export const PERMISSION_DENIED_TEXT = "这个账号没有这项权限";

/** 账号缺这项权限，被后端的权限层挡下。按文字认：有的 client 不带状态码。业务规则的 403 有自己的说明，不算（OP-132）。 */
export function isPermissionDenied(error: unknown): boolean {
  return error instanceof Error && PERMISSION_DENIED_MESSAGES.has(error.message);
}

/** 提示条写「这个账号没有这项权限」，外壳重读权限，页面上的按钮随之收起。框由调用方关。 */
export function announcePermissionDenied() {
  window.dispatchEvent(new Event(PERMISSION_DENIED_EVENT));
}

/** 各域「结果未知」错误族(A2/K1/K6/F1/H8…)统一鸭型:name 以 OutcomeUncertainError 结尾 + 携带命令号。 */
function outcomeUncertainDetail(error: unknown): { commandKey: string; isA2: boolean } | null {
  if (!(error instanceof Error) || !error.name.endsWith("OutcomeUncertainError")) return null;
  const commandKey = (error as Error & { commandKey?: unknown }).commandKey;
  if (typeof commandKey !== "string" || !commandKey.trim()) return null;
  return { commandKey: commandKey.trim(), isA2: error.name === "A2OutcomeUncertainError" };
}

export function operationConfirmErrorMessage(error: unknown): string {
  const uncertain = outcomeUncertainDetail(error);
  if (uncertain?.isA2) {
    return "提交结果暂未确认，可能已经生效。请不要关闭弹窗或修改内容，直接重试（不会重复执行），"
      + `或到操作记录里核对。命令号：${uncertain.commandKey}`;
  }
  if (uncertain) {
    // 刻意不承诺「系统会复用同一命令号自动去重」:携带命令号的错误族里,只有走持久 store 的面
    // (F1 直写 / H8 / K1 / K6 …)真会复用,A3 等仍是每次现铸 —— 对它们做这个承诺就是骗运营去重试。
    // 「保留输入原样重试」对所有域都成立;是否去重交由运营核对审计后决定。
    return "提交结果暂未确认，可能已经生效。请先到操作记录里核对，再决定是否重试；"
      + `重试时不要修改弹窗内容。命令号：${uncertain.commandKey}`;
  }
  if (error instanceof Error) {
    // 弹窗 alertbar 也是展示边界:非空 message 必须过咽喉,裸机器码不得原样上屏。
    const detail = error.message.trim();
    if (detail) return displayAdminError(error);
  }
  return OPERATION_CONFIRM_FALLBACK;
}
