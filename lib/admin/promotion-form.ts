import type { Catalog, Draft, DraftPurchaseRule, DraftRewardSpec, Limit, Policy, PolicyRef, Template } from './promotion-types.ts';
import { parseStrictFiniteNumber } from './strict-number.ts';

export type PromotionNumericKind = 'quantity' | 'limit' | 'priority' | 'device-budget' | 'amount';
export const promotionInputText = (value: string | number | null | undefined) => value == null ? '' : String(value);
const AMOUNT = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/;
const SCALE = BigInt(1000000), ZERO = BigInt(0);
function fixedAmount(value: unknown): bigint | null {
  if (typeof value !== 'string' || !AMOUNT.test(value)) return null;
  const [integer, fraction = ''] = value.split('.');
  return BigInt(integer) * SCALE + BigInt(fraction.padEnd(6, '0'));
}
export function parsePromotionNumericInput(raw: string, kind: PromotionNumericKind): {value: string | number | null; error: string | null} {
  if (raw === '') return {value: null, error: null};
  if (kind === 'amount') {
    const value = fixedAmount(raw);
    return value !== null && value > ZERO ? {value: raw, error: null} : {value: null, error: '请输入大于 0 的金额，整数最多 12 位，小数最多 6 位。'};
  }
  const value = parseStrictFiniteNumber(raw), min = kind === 'priority' ? 0 : 1;
  const max = kind === 'quantity' ? 100 : kind === 'limit' ? 2147483647 : Number.MAX_SAFE_INTEGER;
  const valid = /^\d+$/.test(raw) && value !== null && Number.isSafeInteger(value) && value >= min && value <= max;
  const error = kind === 'quantity' ? '请输入 1–100 之间的整数。' : kind === 'limit' ? '请输入 1–2147483647 之间的整数。' : kind === 'priority' ? '请输入可准确保存的非负整数。' : '请输入可准确保存的正整数。';
  return valid ? {value, error: null} : {value: null, error};
}
export function promotionChoiceError(value: string | null | undefined, choices: readonly string[]): string | null {
  return value && !choices.includes(value) ? '该选项当前不可用，请重新选择；也可保留未配置草稿。' : null;
}
/** Same four stock terms used by publication; no missing term is treated as zero. */
export function promotionBudgetComparison(total: string, kind: 'amount' | 'device-budget', occupied: unknown): {status: 'unknown' | 'below' | 'sufficient'; minimum: string | null} {
  const unavailable = {status: 'unknown' as const, minimum: null};
  if (!occupied || typeof occupied !== 'object') return unavailable;
  const row = occupied as Record<string, unknown>, terms = ['reserved', 'committed', 'issued', 'reversed'].map(key => fixedAmount(row[key]));
  if (terms.some(term => term === null) || kind === 'device-budget' && terms.some(term => term! % SCALE !== ZERO)) return unavailable;
  const [reserved, committed, issued, reversed] = terms as bigint[];
  const minimum = reserved + committed + issued - reversed;
  if (minimum < ZERO) return unavailable;
  const text = kind === 'device-budget' ? String(minimum / SCALE) : `${minimum / SCALE}.${String(minimum % SCALE).padStart(6, '0')}`;
  const parsed = parsePromotionNumericInput(total, kind);
  if (parsed.error || parsed.value === null) return {status: 'unknown', minimum: text};
  const proposed = kind === 'amount' ? fixedAmount(total)! : BigInt(parsed.value) * SCALE;
  return {status: proposed < minimum ? 'below' : 'sufficient', minimum: text};
}

export const policyRef=(p:Policy):PolicyRef=>({policyId:p.policyId,version:p.version,contentHash:p.contentHash});
export const policyKey=(p:PolicyRef|null|undefined)=>p?`${p.policyId}:${p.version}`:'';
/** Main labels describe the approved content; opaque identity stays in supplementary detail. */
export function policyLabel(policy:Policy,catalog:Catalog):string {
  const c=policy.content, local=(v:{zh?:string;en?:string;vi?:string})=>v.zh||v.en||v.vi||'未提供说明';
  const native=(resourceId:string)=>{const n=catalog.nativeContracts.find(n=>n.resourceId===resourceId);return n?local(n.title):'已绑定原合同';};
  switch(c.kind){
    case 'ASSET':return `${c.asset} · ${local(c.availabilityDescription)}`;
    case 'DEVICE_RIGHTS':return `${local(catalog.skus.find(s=>s.productNo===c.productNo)?.name||{})} · ${local(c.rightsDescription)}`;
    case 'FIRST_PURCHASE':return `${c.mode==='FIRST_ELIGIBLE_ORDER'?'首笔合格订单':'首台合格设备'} · 退款后${c.restoreAfterRefund?'恢复':'不恢复'}资格`;
    case 'DEVICE_AUDIENCE':return `${c.sources.includes('PROMOTION_GIFT')?'购买及促销赠送设备':'购买设备'} · ${c.states.map(s=>s==='ACTIVE'?'有效':'在线').join(' / ')}`;
    case 'QUOTE':return `报价有效 ${c.ttlSeconds} 秒 · 不晚于订单及活动截止`;
    case 'STACKING':return `同一购买台互斥 · 券${c.voucher==='ALLOW'?'可叠加':'不叠加'} / 组合${c.bundleDiscount==='ALLOW'?'可叠加':'不叠加'} / 邀请${c.existingReferral==='ALLOW'?'可叠加':'不叠加'} / 新人礼${c.existingH8==='ALLOW'?'可叠加':'不叠加'}`;
    case 'REFUND':return `整单钱包退款 · ${local(c.terms)}`;
    case 'SETTLEMENT':return `付款后成熟 · ${native(c.nativeContract.resourceId)}`;
    case 'AUTHORIZATION':return `${c.separateMakerChecker?'双人审核与发布':'原授权审核发布'} · ${native(c.nativeContract.resourceId)}`;
  }
}
export const limitText=(value:Limit|null|undefined)=>!value?'未配置':value.mode==='UNLIMITED'?'无限制':String(value.value);
export const emptyDraft=(template:Template):Draft=>({category:template==='DIRECT_REFERRAL'?'REFERRAL':'PROMOTION',template,placement:null,inviterAudience:null,combinationMatch:template==='MULTI_PRODUCT'?null:'ANY'});
export const newPurchaseRule=():DraftPurchaseRule=>({ruleId:`rule-${crypto.randomUUID()}`});
export function changeTemplate(draft:Draft,template:Template):Draft {
  return {...draft,...emptyDraft(template),rules:null,buyerAudience:null,inviterAudience:null,combinationMatch:template==='MULTI_PRODUCT'?null:'ANY',perPersonLimit:null,maxRewardUnitsPerOrder:null,budgets:null,shortagePolicy:null,policies:null,activityLimit:null};
}
export function changeRewardType(previous:DraftRewardSpec|null|undefined,type:DraftRewardSpec['type'],role:'BUYER'|'DIRECT_INVITER'):DraftRewardSpec {
  const base={rewardRuleId:previous?.rewardRuleId||`reward-${crypto.randomUUID()}`,beneficiaryRole:role};
  return type==='DEVICE'?{...base,type,giftProductNo:null,quantity:null,deviceRightsProfile:null}:{...base,type,calculation:'FIXED',amount:null,assetPolicy:null};
}
export function dateInput(iso:string|null|undefined,zone:string):string {
  if(!iso)return '';
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));
  const get=(key:string)=>parts.find(p=>p.type===key)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
export function utcInput(local:string,zone:string):string|null {
  if(!local)return null;
  const seed=Date.parse(`${local}:00Z`);if(!Number.isFinite(seed))throw new Error('日期格式无效，请重新选择。');
  let instant=seed;
  for(let n=0;n<3;n++){const wall=Date.parse(`${dateInput(new Date(instant).toISOString(),zone)}:00Z`);instant+=seed-wall;}
  const iso=new Date(instant).toISOString();if(dateInput(iso,zone)!==local)throw new Error('该时区不存在所选时间，请重新选择。');return iso;
}
