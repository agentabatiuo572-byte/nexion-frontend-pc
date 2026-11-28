export function validPhoneTaskDuration(seconds: unknown): seconds is number {
  return typeof seconds === "number" && Number.isInteger(seconds) && seconds >= 60 && seconds <= 86_400;
}

export function formatPhoneTaskDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
}
