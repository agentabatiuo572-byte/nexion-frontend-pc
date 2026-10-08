import { guardedFetch, formatAdminApiError } from './error-messages.ts';
import { outcomeStaysUnknown } from "./outcome-classification.ts";
import { createPendingMutationStore, type PendingMutationRecord } from './pending-mutation-store.ts';
import type { CommandReceipt, VersionPage } from './promotion-types.ts';

export interface PromotionCommandIntent { operation: string; targetId: string; path: string; method: 'POST' | 'PUT'; body: unknown }
export interface PendingPromotion extends PendingMutationRecord, PromotionCommandIntent { recoveryState?: string; receipt?: CommandReceipt }
const pending = createPendingMutationStore<PendingPromotion>({ storageKey: 'admin-promotion-pending-v1', isValidRecord: r => typeof r.operation === 'string' && typeof r.targetId === 'string' && typeof r.path === 'string' && ['POST','PUT'].includes(r.method) && r.body != null });
export const pendingPromotionCommands = () => pending.list();
export const acknowledgePromotionCommand = (receipt: CommandReceipt) => {
  const record=pending.list().find(r=>r.commandKey===receipt.idempotencyKey);
  if(record)pending.forget(record.fingerprint);
  if(typeof window!=='undefined'&&typeof window.dispatchEvent==='function')window.dispatchEvent(new Event('admin-promotion-pending-changed'));
};
export class PromotionApiError extends Error {
  status: number;
  apiCode: number | undefined;
  fieldErrors: Array<{field: string; reason: string}>;
  constructor(message: string, status = 0, apiCode?: number, fieldErrors: Array<{field: string; reason: string}> = []) {
    super(message); this.name = 'PromotionApiError'; this.status = status; this.apiCode = apiCode; this.fieldErrors = fieldErrors;
  }
}
export function promotionErrorMessage(code: string | undefined, status = 0): string {
  if (status === 403) return '当前账户没有此操作权限，请返回或联系有权限的审核人员。';
  if (code?.includes('SNAPSHOT')) return '查询快照已过期或条件发生变化，请重新查询；原输入仍保留。';
  if (code?.includes('REVISION') || code?.includes('VERSION_CONFLICT')) return '内容已被其他操作修改，请读取最新版本并核对差异后再确认。';
  if (code?.includes('MAKER_CHECKER') || code?.includes('SAME_ACTOR')) return '此版本需要由另一名有权限的人员审核。';
  if (code?.includes('FIELD_INVALID')) return '部分配置尚未填写完整或格式不正确，请检查下方字段说明。';
  if (code?.includes('CONCURRENT_CHANGE')) return '内容已被其他操作修改，请读取最新版本并核对差异后再确认。';
  if (code?.includes('TIME_WINDOW')) return '结束时间必须晚于开始时间，请返回时间设置调整。';
  if (code?.includes('TIMEZONE')) return '请先选择活动显示时区，再设置开始和结束时间。';
  if (code?.includes('POLICY') || code?.includes('CONTRACT')) return '引用政策或原合同当前不可执行，请核对批准状态和适用范围。';
  if (code?.includes('BUDGET') || code?.includes('INVENTORY')) return '当前预算或设备额度不足，请刷新占用情况后调整。';
  return formatAdminApiError(code, `PROMOTION_REQUEST_FAILED_${status}`);
}
export function promotionFieldLabel(path: string): string {
  const labels: Record<string,string> = {name:'活动名称',title:'公开标题（三种语言）',terms:'公开说明（三种语言）',startsAt:'开始时间',endsAt:'结束时间',displayTimezone:'显示时区',buyerAudience:'购买者条件',inviterAudience:'直接邀请人条件',purchaseHistory:'购机历史',devicePresence:'设备条件',registrationAge:'注册天数范围',lastValidPurchaseAge:'购机间隔范围',rankIds:'参与等级',markets:'适用市场',sponsor:'邀请关系',neverPurchased:'历史购机排除',rules:'购买规则',productNo:'购买设备',minBuyQty:'每组购买数量',buyerReward:'购买者奖励',inviterReward:'直接邀请人奖励',amount:'资产奖励金额',quantity:'赠送数量',assetPolicy:'资产政策',deviceRightsProfile:'设备权益政策',giftProductNo:'赠送设备',maxGroups:'每单计奖组数',maxGroupsPerPerson:'每人累计计奖组数',repeatMode:'计奖方式',priority:'规则优先级',budgets:'预算与赠品额度',policies:'批准政策',firstPurchase:'首购认定政策',settlement:'结算政策',stacking:'叠加政策',refund:'售后政策',quote:'报价政策',authorization:'审核发布政策',perPersonLimit:'受益角色参与上限',activityLimit:'活动参与上限',maxRewardUnitsPerOrder:'每单奖励义务上限',shortagePolicy:'额度不足处理',minimumClientCapabilities:'兼容客户端要求',reason:'操作理由',evidenceRefs:'关联证据',content:'政策内容'};
  const parts=path.split(/[.:[\]]/).filter(Boolean);
  return [...new Set(parts.map(p=>labels[p]).filter(Boolean))].join(' / ') || '当前配置（请逐步核对必填项）';
}
export async function promotionRead<T>(path: string, query?: Record<string,string|number|undefined|null>, init?: RequestInit): Promise<T> {
  const params = new URLSearchParams();
  Object.entries(query || {}).forEach(([key,value]) => { if (value !== undefined && value !== null && value !== '') params.set(key,String(value)); });
  const response = await guardedFetch(`/api/admin/growth${path}${params.size ? `?${params}` : ''}`, { ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await response.json().catch(() => null) as {code?:number;message?:string;data?:T & {fieldErrors?:Array<{field:string;reason:string}>}} | null;
  if (!response.ok || body?.code !== 0 || body.data == null) {
    // Unreadable responses cannot prove whether a write committed.
    throw new PromotionApiError(promotionErrorMessage(body?.message,response.status), body ? response.status : 0, body?.code, body?.data?.fieldErrors);
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
function uncertain(): never { throw new PromotionApiError('结果尚未确认，原命令和输入已保留，请先核查原结果。'); }
export async function promotionCommand(intent: PromotionCommandIntent, retry = false): Promise<CommandReceipt> {
  const slot = fingerprint(intent);
  const previous = pending.list().find(r => r.fingerprint === slot);
  if (previous && (!retry || previous.recoveryState !== 'NOT_FOUND' || JSON.stringify(previous.body) !== JSON.stringify(intent.body) || previous.path !== intent.path)) {
    throw new PromotionApiError('存在尚未确认的原命令，请先核查结果；不能修改参数后再次提交。');
  }
  const key = previous?.commandKey ?? `promotion-${crypto.randomUUID()}`;
  pending.remember(slot,key,{...intent});
  if (typeof window !== 'undefined') {
    let durable=false;
    try { const stored=JSON.parse(window.sessionStorage.getItem('admin-promotion-pending-v1')||'{}'); durable=stored[key]?.commandKey===key; } catch { /* Refuse the write when refresh recovery cannot be retained. */ }
    if(!durable){pending.forget(slot);throw new PromotionApiError('浏览器无法保留原命令，暂不能安全提交。请恢复会话存储后重试。',422);}
  }
  try {
    const result = await promotionRead<CommandReceipt>(intent.path,undefined,{method:intent.method,headers:{'Idempotency-Key':key},body:JSON.stringify(intent.body)});
    if (result.operation !== intent.operation || result.targetId !== intent.targetId || result.idempotencyKey !== key) uncertain();
    if (result.status === 'SUCCEEDED') { pending.remember(slot,key,{...intent,recoveryState:'SUCCEEDED',receipt:result}); return result; }
    if (result.status === 'FAILED') { pending.forget(slot); throw new PromotionApiError('原命令已明确失败，请核对当前事实后重试。',409); }
    uncertain();
  } catch (error) {
    if (error instanceof PromotionApiError && !outcomeStaysUnknown(error.status,error.apiCode)) { pending.forget(slot); throw error; }
    uncertain();
  }
}
export async function recoverPromotionCommand(record: PendingPromotion): Promise<CommandReceipt> {
  const result = await promotionRead<CommandReceipt>(`/promotion-commands/${encodeURIComponent(record.commandKey)}`,{operation:record.operation,targetId:record.targetId});
  if (result.operation !== record.operation || result.targetId !== record.targetId || result.idempotencyKey !== record.commandKey) uncertain();
  if (result.status === 'FAILED') pending.forget(record.fingerprint);
  else pending.remember(record.fingerprint,record.commandKey,{...record,recoveryState:result.status,...(result.status==='SUCCEEDED'?{receipt:result}:{})});
  return result;
}
