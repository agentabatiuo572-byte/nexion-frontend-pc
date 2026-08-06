const OPERATION_CONFIRM_FALLBACK =
  "提交未完成，当前输入已保留，请根据页面提示处理后重试。";

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
    return "A2 提案结果暂不确定，可能已经生效；请保留当前弹窗与输入，"
      + `使用同一命令号重试并核对 A2 审计。同一命令号：${uncertain.commandKey}`;
  }
  if (uncertain) {
    return "提交结果暂不确定，可能已经生效；请保留当前弹窗与输入原样重试，"
      + `系统会复用同一命令号由后端自动去重，不会重复执行。同一命令号：${uncertain.commandKey}`;
  }
  if (error instanceof Error) {
    const detail = error.message.trim();
    if (detail) return detail;
  }
  return OPERATION_CONFIRM_FALLBACK;
}
