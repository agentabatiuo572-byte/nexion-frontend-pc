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
    const detail = error.message.trim();
    if (detail) return detail;
  }
  return OPERATION_CONFIRM_FALLBACK;
}
