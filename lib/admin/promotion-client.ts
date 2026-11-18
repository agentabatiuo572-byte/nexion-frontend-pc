import { completeH4Uploads } from "./h4-upload-completion";
import { guardedFetch, formatAdminApiError } from './error-messages.ts';
import { isDeterministicRejection, isIdempotencyOutcomeOpen } from "./outcome-classification.ts";
import { isExplicitRejection } from "./explicit-rejection";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { createPendingMutationStore, hasPersistedPendingCommandOwner, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from './pending-mutation-store.ts';
import type { CommandReceipt, PublishAction, VersionPage } from './promotion-types.ts';

export interface PromotionCommandIntent { operation: string; targetId: string; path: string; method: 'POST' | 'PUT'; body: unknown }
export interface PendingPromotion extends PendingMutationRecord, PromotionCommandIntent { owner?: number; recoveryState?: string; receipt?: CommandReceipt }
const pending = createPendingMutationStore<PendingPromotion>({ storageKey: 'admin-promotion-pending-v1', retainExpiredRecords: true, isValidRecord: r => typeof r.operation === 'string' && typeof r.targetId === 'string' && typeof r.path === 'string' && ['POST','PUT'].includes(r.method) && r.body != null });
const notifyPending = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('admin-promotion-pending-changed')); };
function remember(...args: Parameters<typeof pending.remember>) { pending.remember(...args); notifyPending(); }
function forget(...args: Parameters<typeof pending.forget>) { pending.forget(...args); notifyPending(); }
export const pendingPromotionCommands = () => {
  const owner = useAdminAuth.getState().session?.adminId;
  return owner === undefined ? [] : pending.list().filter(r => r.owner === owner || r.owner === undefined && hasPersistedPendingCommandOwner(String(owner)));
};
export const acknowledgePromotionCommand = (receipt: CommandReceipt) => {
  const record=pending.list().find(r=>r.commandKey===receipt.idempotencyKey);
  if(record)forget(record.fingerprint);
};
export class PromotionApiError extends Error {
  unknownOutcome = false;
  bodyUnreadable = false;
  status: number;
  apiCode: number | undefined;
  fieldErrors: Array<{field: string; reason: string}>;
  constructor(message: string, status = 0, apiCode?: number, fieldErrors: Array<{field: string; reason: string}> = [], public readonly reasonCode?: string) {
    super(message); this.name = 'PromotionApiError'; this.status = status; this.apiCode = apiCode; this.fieldErrors = fieldErrors;
  }
}
export function promotionErrorMessage(code: string | undefined, status = 0): string {
  const key = code && /^[A-Z][A-Z0-9_]*$/.test(code) ? code : undefined;
  if (status === 403) return '当前账户没有此操作权限，请返回或联系有权限的审核人员。';
  if (status === 503) return '活动服务暂时不可用，请稍后重试。';
  if (key === 'PROMOTION_STATE_INVALID') return '当前活动状态不支持此操作，请刷新后核对；只有可编辑草稿或已结束活动可以删除。';
  if (key === 'AUTHORITATIVE_PAGE_INVALID') return '当前资料暂无法确认，相关操作已停用；请刷新后重试。';
  if (key === 'PROMOTION_DISCOUNT_EXCEEDS_LINE_AMOUNT') return '订单立减超过对应商品扣除已有优惠后的应付金额，请调低立减金额或调整购买规则。';
  if (key === 'PROMOTION_DISCOUNT_REQUIRES_PAYMENT') return '活动立减后整单仍需保留大于 0 的应付金额，请调整购买数量或活动配置。';
  if (key?.includes('SNAPSHOT')) return '查询结果已失效，请重新查询。筛选条件已保留。';
  if (key?.includes('REVISION') || key?.includes('VERSION_CONFLICT')) return '内容已被其他操作修改，请读取最新版本并核对差异后再确认。';
  if (key === 'PROMOTION_RULE_IDENTITY_IMMUTABLE' || key === 'PROMOTION_REWARD_IDENTITY_IMMUTABLE') return '已有购买规则或奖励身份不能直接更换；请刷新草稿，移除原规则后添加新设备。历史累计仍保留。';
  if (key === 'PROMOTION_RULE_REPLACEMENT_RESETS_HISTORY') return '该设备已有历史规则，不能用新规则重置累计；请沿用原规则修改其他配置。';
  if (key?.includes('MAKER_CHECKER') || key?.includes('SAME_ACTOR')) return '此版本需要由另一名有权限的人员审核。';
  if (key?.includes('FIELD_INVALID')) return '部分配置尚未填写完整或格式不正确，请检查下方字段说明。';
  if (key?.includes('CONCURRENT_CHANGE')) return '内容已被其他操作修改，请读取最新版本并核对差异后再确认。';
  if (key?.includes('TIME_WINDOW')) return '结束时间必须晚于开始时间，请返回时间设置调整。';
  if (key?.includes('TIMEZONE')) return '请先选择活动显示时区，再设置开始和结束时间。';
  if (key === 'PROMOTION_POLICY_EVIDENCE_UNAVAILABLE') return '政策证据不可用：普通操作记录必须属于当前批准人，或引用已批准的增长域审批记录。第二位批准人请先取得本人名下的有效记录，再请发起人重新创建引用该记录的政策草稿。';
  if (key?.includes('POLICY') || key?.includes('CONTRACT')) return '引用政策或原合同当前不可执行，请核对批准状态和适用范围。';
  if (key?.includes('BUDGET') || key?.includes('INVENTORY')) return '当前预算或设备额度不足，请刷新占用情况后调整。';
  return formatAdminApiError(key, `PROMOTION_REQUEST_FAILED_${status}`);
}
export function promotionFieldLabel(path: string): string {
  const labels: Record<string,string> = {name:'活动名称',bannerAssetId:'活动宣传图',title:'公开标题（三种语言）',terms:'公开说明（三种语言）',startsAt:'开始时间',endsAt:'结束时间',displayTimezone:'显示时区',buyerAudience:'购买者条件',inviterAudience:'直接邀请人条件',purchaseHistory:'购机历史',devicePresence:'设备条件',registrationAge:'注册天数范围',lastValidPurchaseAge:'购机间隔范围',rankIds:'参与等级',markets:'适用市场',sponsor:'邀请关系',neverPurchased:'历史购机排除',rules:'购买规则',productNo:'购买设备',minBuyQty:'每组购买数量',buyerReward:'购买者奖励',inviterReward:'直接邀请人奖励',amount:'奖励或订单立减金额',quantity:'赠送数量',assetPolicy:'资产政策',deviceRightsProfile:'设备权益政策',giftProductNo:'赠送设备',maxGroups:'每单计奖组数',maxGroupsPerPerson:'每人累计计奖组数',repeatMode:'计奖方式',priority:'规则优先级',budgets:'预算与赠品额度',policies:'批准政策',firstPurchase:'首购认定政策',settlement:'结算政策',stacking:'叠加政策',refund:'售后政策',quote:'报价政策',authorization:'审核发布政策',perPersonLimit:'受益角色参与上限',activityLimit:'活动参与上限',maxRewardUnitsPerOrder:'每单奖励义务上限',shortagePolicy:'额度不足处理',minimumClientCapabilities:'兼容客户端要求',reason:'操作理由',evidenceRefs:'关联证据',content:'政策内容'};
  const parts=path.split(/[.:[\]]/).filter(Boolean);
  return [...new Set(parts.map(p=>labels[p]).filter(Boolean))].join(' / ') || '当前配置（请逐步核对必填项）';
}
export async function promotionRead<T>(path: string, query?: Record<string,string|number|undefined|null>, init?: RequestInit): Promise<T> {
  const params = new URLSearchParams();
  Object.entries(query || {}).forEach(([key,value]) => { if (value !== undefined && value !== null && value !== '') params.set(key,String(value)); });
  const response = await guardedFetch(`/api/admin/growth${path}${params.size ? `?${params}` : ''}`, { ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await response.json().catch(() => null) as {code?:number;message?:string;data?:T & {fieldErrors?:Array<{field:string;reason:string}>}} | null;
  const unknown = response.headers.get('X-Nexion-Upstream-Outcome')?.toLowerCase() === 'unknown';
  if (!response.ok || body?.code !== 0 || body.data == null || unknown) {
    // Unreadable responses cannot prove whether a write committed.
    const field = /^PROMOTION_FIELD_INVALID:(\$\..+)$/.exec(body?.message ?? '')?.[1];
    const fieldErrors = body?.data?.fieldErrors ?? (field ? [{ field, reason: 'PROMOTION_FIELD_INVALID' }] : undefined);
    const error = new PromotionApiError(promotionErrorMessage(field ? 'PROMOTION_FIELD_INVALID' : body?.message,response.status), body ? response.status : 0, body?.code, fieldErrors, body?.message);
    error.unknownOutcome = unknown; error.bodyUnreadable = body === null;
    throw error;
  }
  // Older admin policy projections can omit the approver identity and refund execution facts.
  if ((!init?.method || init.method === 'GET') && (path === '/promotion-policies' || /^\/promotion-policies\/[^/]+\/versions\/[0-9]+$/.test(path))) {
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === 'object' && !Array.isArray(value);
    const data: unknown = body.data;
    const rows = path === '/promotion-policies' && isRecord(data) && Array.isArray(data.items) ? data.items : [data];
    for (const row of rows) {
      if (!isRecord(row)) throw new PromotionApiError(promotionErrorMessage('AUTHORITATIVE_PAGE_INVALID'));
      const { execution } = row;
      if (execution !== undefined && (!isRecord(execution)
        || typeof execution.basis !== 'string'
        || typeof execution.walletRecovery !== 'string'
        || typeof execution.deviceRecovery !== 'string'
        || typeof execution.insufficientRecovery !== 'string'
        || typeof execution.negativeBalance !== 'boolean'
        || typeof execution.crossAssetDeduction !== 'boolean'
        || typeof execution.terminalState !== 'string'
        || typeof execution.manualReviewAppliesTo !== 'string'
        || typeof execution.unknownEvidence !== 'string')) {
        throw new PromotionApiError(promotionErrorMessage('AUTHORITATIVE_PAGE_INVALID'));
      }
      const identity = row.approvedByAdmin;
      if (identity === undefined || identity === null) continue;
      if (typeof identity !== 'object' || Array.isArray(identity)) throw new PromotionApiError(promotionErrorMessage('AUTHORITATIVE_PAGE_INVALID'));
      const admin = identity as Record<string, unknown>;
      if (!Number.isSafeInteger(admin.id) || Number(admin.id) < 1
        || admin.displayName !== null && typeof admin.displayName !== 'string'
        || admin.username !== null && typeof admin.username !== 'string') throw new PromotionApiError(promotionErrorMessage('AUTHORITATIVE_PAGE_INVALID'));
    }
  }
  return body.data;
}
const fingerprint = (i: PromotionCommandIntent) => `${i.operation}:${i.targetId}`;
export async function promotionVersions(activityId:string):Promise<VersionPage> {
  const items:VersionPage['items']=[],seen=new Set<string>();let cursor:string|null=null;
  for(;;){
    const page:VersionPage=await promotionRead<VersionPage>(`/promotions/${encodeURIComponent(activityId)}/versions`,{limit:100,cursor});
    items.push(...page.items);
    if(!page.hasMore)return {items,nextCursor:null,hasMore:false};
    if(!page.nextCursor||seen.has(page.nextCursor))throw new PromotionApiError('历史版本读取未完成，请重新读取。');
    cursor=page.nextCursor;seen.add(page.nextCursor);
  }
}
function uncertain(): never { throw new PromotionApiError('结果未知，原操作记录和输入已保留，请先核查原结果。'); }
function requireMatchingReceipt(result: CommandReceipt, intent: PromotionCommandIntent, key: string) {
  if (result.operation !== intent.operation || result.targetId !== intent.targetId || result.idempotencyKey !== key) uncertain();
  if (result.status === 'SUCCEEDED' && intent.operation === 'submitPromotion') {
    const { version, expectedRevision } = intent.body as PublishAction;
    if (result.resource?.type !== 'VERSION' || result.resource.id !== `${intent.targetId}:${version}`
      || result.resource.revision !== expectedRevision + 1) uncertain();
  }
}
export async function promotionCommand(intent: PromotionCommandIntent, retry = false): Promise<CommandReceipt> {
  const slot = fingerprint(intent);
  const actor = useAdminAuth.getState().session;
  if (!actor) throw new PromotionApiError('登录已失效，请重新登录后查询原结果。');
  const previous = pendingPromotionCommands().find(r => r.fingerprint === slot);
  if (previous && (!retry || previous.recoveryState !== 'NOT_FOUND' || JSON.stringify(previous.body) !== JSON.stringify(intent.body) || previous.path !== intent.path || previous.method !== intent.method)) {
    throw new PromotionApiError('有结果未知的原操作，请先核查原结果；不能改了参数再提交。');
  }
  if (previous && isRetryExpired(previous)) throw new PromotionApiError(RETRY_EXPIRED_TEXT);
  const key = previous?.commandKey ?? `promotion-${crypto.randomUUID()}`;
  remember(slot,key,{...intent,owner:actor.adminId});
  if (typeof window !== 'undefined') {
    let durable=false;
    try { const stored=JSON.parse(window.sessionStorage.getItem('admin-promotion-pending-v1')||'{}'); durable=stored[key]?.commandKey===key; } catch { /* Refuse the write when refresh recovery cannot be retained. */ }
    if(!durable){if(!previous)forget(slot);throw new PromotionApiError('当前页面无法保留本次操作记录，尚未提交。请检查浏览器设置后重试。',422);}
  }
  try {
    const result = await promotionRead<CommandReceipt>(intent.path,undefined,{method:intent.method,headers:{'Idempotency-Key':key},body:JSON.stringify(intent.body)});
    requireMatchingReceipt(result, intent, key);
    if (result.status === 'SUCCEEDED') { remember(slot,key,{...intent,owner:actor.adminId,recoveryState:'SUCCEEDED',receipt:result}); completeH4Uploads(intent, result); return result; }
    if (result.status === 'FAILED') { forget(slot); throw new PromotionApiError('原操作已明确失败，请核对当前状态后重试。',409,409,[],'PROMOTION_COMMAND_FAILED'); }
    uncertain();
  } catch (error) {
    if (error instanceof PromotionApiError && !error.unknownOutcome && !error.bodyUnreadable && !isIdempotencyOutcomeOpen(error.reasonCode)
      && !(error.reasonCode ?? '').startsWith('IDEMPOTENCY_') && !(error.apiCode !== undefined && error.apiCode >= 500)
      && (previous ? isExplicitRejection(error.status >= 200 && error.status < 300 && error.apiCode ? Object.assign(error, {status:error.apiCode}) : error) : isDeterministicRejection(error.status,error.apiCode))) { forget(slot); throw error; }
    uncertain();
  }
}
export async function recoverPromotionCommand(record: PendingPromotion): Promise<CommandReceipt> {
  if (!pendingPromotionCommands().some(r => r.commandKey === record.commandKey)) throw new PromotionApiError('原操作已处理，请关闭后重新读取。');
  const result = await promotionRead<CommandReceipt>(`/promotion-commands/${encodeURIComponent(record.commandKey)}`,{operation:record.operation,targetId:record.targetId});
  requireMatchingReceipt(result, record, record.commandKey);
  if (result.status === 'SUCCEEDED') completeH4Uploads(record, result);
  if (result.status === 'FAILED') forget(record.fingerprint);
  else remember(record.fingerprint,record.commandKey,{...record,recoveryState:result.status,...(result.status==='SUCCEEDED'?{receipt:result}:{})});
  return result;
}
