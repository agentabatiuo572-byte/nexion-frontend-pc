export function normalizeD1NullableString(
  value: unknown,
  field: string,
  invalid: (field: string) => never,
): string {
  if (value === null) return "";
  if (typeof value !== "string") return invalid(field);
  return value;
}
