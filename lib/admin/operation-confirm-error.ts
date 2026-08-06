// 相对 + 显式 .ts:node --experimental-strip-types 直跑测试解析不了 `@/` 别名与无扩展名导入。
import { displayAdminError } from "./error-messages.ts";

const OPERATION_CONFIRM_FALLBACK =
  "提交未完成，当前输入已保留，请根据页面提示处理后重试。";

function a2OutcomeUncertainCommandKey(error: unknown): string | null {
  if (!(error instanceof Error) || error.name !== "A2OutcomeUncertainError") return null;
  const commandKey = (error as Error & { commandKey?: unknown }).commandKey;
  return typeof commandKey === "string" && commandKey.trim() ? commandKey.trim() : null;
}

export function operationConfirmErrorMessage(error: unknown): string {
  const commandKey = a2OutcomeUncertainCommandKey(error);
  if (commandKey) {
    return "A2 提案结果暂不确定，可能已经生效；请保留当前弹窗与输入，"
      + `使用同一命令号重试并核对 A2 审计。同一命令号：${commandKey}`;
  }
  if (error instanceof Error) {
    // 弹窗 alertbar 也是展示边界:非空 message 必须过咽喉,裸机器码不得原样上屏。
    const detail = error.message.trim();
    if (detail) return displayAdminError(error);
  }
  return OPERATION_CONFIRM_FALLBACK;
}
