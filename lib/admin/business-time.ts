/** Backend LocalDateTime has no offset and uses the Asia/Shanghai business clock. */
export function parseBusinessTime(value: string): number {
  const unzoned = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?)$/.exec(value);
  return Date.parse(unzoned ? `${unzoned[1]}T${unzoned[2]}+08:00` : value);
}
