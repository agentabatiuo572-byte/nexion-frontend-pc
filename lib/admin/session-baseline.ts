/** Display server facts without restoring retired defaults or editable limits. */
export function readAdminSessionBaseline(value: string | undefined) {
  return {
    idleMinutes: value?.match(/(\d+(?:\.\d+)?)\s*min/i)?.[1] ?? null,
    absoluteHours: value?.match(/\/\s*(\d+(?:\.\d+)?)\s*h/i)?.[1] ?? null,
    unlimited: /\/\s*unlimited\s*$/i.test(value ?? ""),
  };
}
