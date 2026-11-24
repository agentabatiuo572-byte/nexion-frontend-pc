import type { ReactNode } from "react";

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

/** Keep the confirmation locked until an explicit read can rebuild it from current data. */
export class ConfirmReadConflict extends Error {
  constructor(public readonly review?: {
    readLatest: () => Promise<boolean | void>;
    renderNotice: (readLatest: () => void) => ReactNode;
    preserveReason?: boolean;
  }, message = "H4_REFRESH_REQUIRED", /** 对象状态变了或已不在：框里只留提示和「取消」，不再显示过期的改动和理由框。 */ public readonly final = false) {
    super(message);
  }
}

/** A receipt established that the retained write did not take effect. */
export class PendingConfirmRejected extends Error {
  constructor(message: string, public readonly reasonCode?: string, public readonly status = 409) {
    super(message);
  }
}
