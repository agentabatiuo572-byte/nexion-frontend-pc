export type HConflictField = {
  path: string; opened: unknown; latest: unknown; mine: unknown;
  changedByOther: boolean; changedByMe: boolean;
};

/** Keep all three exact values; the view decides how the comparison is presented. */
export function hConflictFields(opened: object, latest: object, mine: object,
  equal: (path: string, left: unknown, right: unknown) => boolean = (_path, left, right) => Object.is(left, right)): HConflictField[] {
  const fields: HConflictField[] = [];
  const walk = (path: string, before: unknown, current: unknown, draft: unknown) => {
    const values = [before, current, draft];
    if (values.some(value => value !== null && typeof value === "object")) {
      const keys = new Set(values.flatMap(value => value !== null && typeof value === "object" ? Object.keys(value) : []));
      for (const key of keys) walk(path ? `${path}.${key}` : key,
        (before as Record<string, unknown> | null | undefined)?.[key],
        (current as Record<string, unknown> | null | undefined)?.[key],
        (draft as Record<string, unknown> | null | undefined)?.[key]);
      return;
    }
    fields.push({ path, opened: before, latest: current, mine: draft,
      changedByOther: !equal(path, before, current), changedByMe: !equal(path, before, draft) });
  };
  walk("", opened, latest, mine);
  return fields;
}

/** Only the visual comparison's explicit confirmation may reopen the save confirmation. */
export class HConflictReviewRequired extends Error {
  constructor(message: string, public readonly fields: HConflictField[], public readonly confirm: () => void) {
    super(message);
    this.name = "HConflictReviewRequired";
  }
}
