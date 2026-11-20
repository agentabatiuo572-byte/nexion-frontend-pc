import type { Promotion } from './promotion-types.ts';

export const isDeletablePromotion = (activity: { state: string; deleted?: boolean; draftVersionState?: string | null; activeVersion?: number | null }) =>
  !activity.deleted && (activity.state === 'ENDED' || (activity.state === 'DRAFT' && activity.draftVersionState === 'DRAFT' && activity.activeVersion == null));

export function promotionDeleteBody(activity: Promotion) {
  if (!isDeletablePromotion(activity) || (activity.state === 'DRAFT' && !activity.current)) {
    throw new Error('只有草稿或已结束的活动可以删除，请刷新活动状态。');
  }
  return {
    expectedRevision: activity.revision,
    ...(activity.state === 'DRAFT' ? { expectedDraftRevision: activity.current!.revision } : {}),
    evidenceRefs: [],
  };
}

export const isDeletableQuestEvent = (event: { deletable?: boolean; deleteState?: string; deleteVersion?: string }) =>
  event.deletable === true && ['draft', 'ended'].includes(event.deleteState || '') && !!event.deleteVersion;
