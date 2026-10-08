import type { Catalog, Draft, DraftPurchaseRule, DraftRewardSpec, Limit, Policy, PolicyRef, Template } from './promotion-types.ts';

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
