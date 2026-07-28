const OPERATION_CONFIRM_FALLBACK =
  "提交未完成，当前输入已保留，请根据页面提示处理后重试。";

export function operationConfirmErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const detail = error.message.trim();
    if (detail) return detail;
  }
  return OPERATION_CONFIRM_FALLBACK;
}
