import type { Draft } from './promotion-types';

/** Compare the top-level fields replaced by PromotionAdminService.mergeDraft.
 * Keep arrays/objects whole so additions, removals, null and empty values remain
 * distinguishable. Amount strings are never parsed or reformatted.
 */
export function promotionDraftChanges(opened: Draft, latest: Draft, mine: Draft = opened) {
  const keys = Object.keys({ ...opened, ...latest, ...mine }) as Array<keyof Draft>;
  return keys.flatMap(field => {
    const before = JSON.stringify(opened[field]), after = JSON.stringify(latest[field]), input = JSON.stringify(mine[field]);
    const changedByOther = before !== after, changedByMe = before !== input;
    return changedByOther || changedByMe ? [{ field, opened: opened[field], latest: latest[field], mine: mine[field],
      changedByOther, changedByMe,
      // An omitted patch field is retained by the backend, not cleared.
      overwritesOther: changedByOther && mine[field] !== undefined && after !== input,
    }] : [];
  });
}
