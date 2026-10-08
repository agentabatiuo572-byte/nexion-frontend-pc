const platform=pick('platform',['native-illustration','h5'],'native-illustration');const safeInsets=platform==='h5'?{top:0,bottom:0}:{top:24,bottom:26};document.documentElement.dataset.platform=platform;document.documentElement.style.setProperty('--safe-top',safeInsets.top+'px');document.documentElement.style.setProperty('--safe-bottom',safeInsets.bottom+'px');
// Independent visual fixture controller. No production imports, API calls or pricing engine.
Object.assign(copy.zh, {
  'order-unknown':'原订单查询','order-confirmed':'原订单查询结果',termsSample:'设计条款样例 · 非生产政策',
  termsMissing:'奖励权益说明尚未齐全，暂不能确认。请重新读取完整条款。',
  stale:'选择已改变，原报价和预计奖励已失效。重新试算前不能确认。',
  awaitingQuote:'待重新试算',resumeSelection:'返回保留的选购',queriedUnpaid:'查询样例已确认：原订单待支付，可继续原单。',
  assetPending:'奖励尚未到账，到账凭证确认后开放对应资产入口。',receipt:'到账凭证',
  deviceTerms:'赠品设备权益',fundTerms:'资金奖励权益',paidTotal:'已付金额'
});
Object.assign(copy.en, {
  'order-unknown':'Original order status','order-confirmed':'Original order query result',termsSample:'Design terms sample · not production policy',
  termsMissing:'Reward terms are incomplete. Confirmation is unavailable until complete terms are loaded.',
  stale:'The selection changed. The previous quote and estimated rewards are no longer valid. A new quote is required.',
  awaitingQuote:'New quote required',resumeSelection:'Return to saved selection',queriedUnpaid:'Confirmed query sample: the original order is unpaid and can be resumed.',
  assetPending:'This reward has no confirmed receipt yet. Its asset entry becomes available after receipt confirmation.',receipt:'Receipt',
  deviceTerms:'Gift device terms',fundTerms:'Reward funds terms',paidTotal:'Amount paid'
});
Object.assign(copy.vi, {
  'order-unknown':'Tra cứu đơn gốc','order-confirmed':'Kết quả tra cứu đơn gốc',termsSample:'Điều khoản mẫu thiết kế · không phải chính sách thật',
  termsMissing:'Điều khoản phần thưởng chưa đầy đủ. Chưa thể xác nhận cho đến khi đọc đủ điều khoản.',
  stale:'Lựa chọn đã thay đổi. Báo giá và phần thưởng dự kiến cũ không còn hiệu lực. Cần báo giá mới.',
  awaitingQuote:'Cần báo giá mới',resumeSelection:'Quay lại lựa chọn đã giữ',queriedUnpaid:'Mẫu tra cứu đã xác nhận: đơn gốc chưa thanh toán và có thể tiếp tục.',
  assetPending:'Chưa có chứng từ nhận phần thưởng. Mục tài sản sẽ mở sau khi xác nhận đã nhận.',receipt:'Chứng từ nhận',
  deviceTerms:'Quyền lợi thiết bị tặng',fundTerms:'Quyền lợi tiền thưởng',paidTotal:'Đã thanh toán'
});
const entitlementSamples = {
  zh: {
    device: [
      ['activation','启用方式','样例：到账后在已有设备页使用，无需再次邀请或充值领取。'],
      ['effective','生效与到期','样例：到账后生效，有效至2027年1月31日23:59（UTC+09:00）。'],
      ['tasks','任务权限','样例：可运行此设备类型获准任务；手机原生任务仍受平台限制。'],
      ['earnings','任务与收益','样例：按有效任务实际记录结算，不保证固定收益。'],
      ['capacity','设备持有与等级','样例：计入设备持有数量，不增加等级资格。'],
      ['transfer','置换与转赠','样例：本赠品不支持置换或转赠。'],
      ['aftercare','售后处理','样例：整单退款确认后按每项核验结果处理；不扣无关正常资产。']
    ],
    funds: [
      ['availability','可用范围','样例：确认到账后仅用于本活动商品支付。'],
      ['withdrawal','提现条件','样例：本活动奖励不开放提现，到账不等于可提现。'],
      ['fees','手续费','样例：奖励到账不扣手续费；商品支付费用另行列明。'],
      ['restrictions','使用限制','样例：不可转赠；使用期限至2027年1月31日23:59（UTC+09:00）。']
    ]
  },
  en: {
    device: [
      ['activation','Activation','Sample: use the existing device page after receipt. No additional referral or deposit is required to claim.'],
      ['effective','Start and expiry','Sample: effective on receipt, until 31 Jan 2027, 23:59 (UTC+09:00).'],
      ['tasks','Task access','Sample: only permitted tasks for this device type; native phone tasks retain platform restrictions.'],
      ['earnings','Tasks and earnings','Sample: settlement follows valid task records. No fixed earnings are guaranteed.'],
      ['capacity','Device count and rank','Sample: included in device count; no additional rank eligibility.'],
      ['transfer','Trade-in and transfer','Sample: this gift cannot be traded in or transferred.'],
      ['aftercare','Aftercare','Sample: confirmed full refunds trigger item-specific review; unrelated assets are not deducted.']
    ],
    funds: [
      ['availability','Availability','Sample: usable for this promotion’s products only after receipt is confirmed.'],
      ['withdrawal','Withdrawal','Sample: this reward cannot be withdrawn. Receipt does not imply withdrawability.'],
      ['fees','Fees','Sample: no fee on reward receipt; purchase fees are disclosed separately.'],
      ['restrictions','Restrictions','Sample: no transfers; use by 31 Jan 2027, 23:59 (UTC+09:00).']
    ]
  },
  vi: {
    device: [
      ['activation','Cách sử dụng','Mẫu: dùng trang thiết bị hiện có sau khi nhận; không cần mời thêm hoặc nạp tiền để nhận.'],
      ['effective','Hiệu lực và hết hạn','Mẫu: có hiệu lực khi nhận, đến 23:59 ngày31/01/2027 (UTC+09:00).'],
      ['tasks','Quyền chạy nhiệm vụ','Mẫu: chỉ chạy nhiệm vụ được phép cho loại thiết bị này; nhiệm vụ điện thoại vẫn theo giới hạn nền tảng.'],
      ['earnings','Nhiệm vụ và thu nhập','Mẫu: quyết toán theo nhiệm vụ hợp lệ thực tế, không đảm bảo thu nhập cố định.'],
      ['capacity','Số thiết bị và hạng','Mẫu: tính vào số thiết bị đang có, không cộng điều kiện cấp hạng.'],
      ['transfer','Đổi và chuyển tặng','Mẫu: quà tặng này không được đổi hoặc chuyển tặng.'],
      ['aftercare','Hậu mãi','Mẫu: sau khi hoàn toàn bộ đơn, xử lý riêng từng phần thưởng; không trừ tài sản không liên quan.']
    ],
    funds: [
      ['availability','Phạm vi sử dụng','Mẫu: chỉ dùng mua sản phẩm của chương trình sau khi xác nhận đã nhận.'],
      ['withdrawal','Điều kiện rút','Mẫu: phần thưởng này không được rút; đã nhận không có nghĩa là có thể rút.'],
      ['fees','Phí','Mẫu: không thu phí khi nhận thưởng; phí mua hàng được nêu riêng.'],
      ['restrictions','Giới hạn','Mẫu: không chuyển tặng; dùng đến23:59 ngày31/01/2027 (UTC+09:00).']
    ]
  }
};
products.forEach((p,i)=>Object.assign(p,{key:['pro','s1','nex'][i],type:['device','usdt','nex'][i]}));
const selection=pick('selection',['bundle','pro','s1','nex'],'bundle');
const selected=selection==='bundle'?products.slice(0,2):products.filter(p=>p.key===selection);
const activeProduct=selection==='bundle'?products[0]:selected[0];
const rewardKey=pick('reward',['device','usdt','nex'],'device');
const rewardProduct=products.find(p=>p.type===rewardKey);
const statusKeys=['reserved','pending','granted','hold','revoking','cancelled'];
const statusText={reserved:t.locked,pending:t.rewardPending,granted:t.rewardGranted,hold:t.rewardHold,revoking:t.rewardRevoking,cancelled:t.rewardCancelled};
const defaultMode=['payment-unknown','order-unknown'].includes(screen)?'unknown':screen==='order-confirmed'?'confirmed':['order-paid','reward-detail'].includes(screen)?'paid':screen==='order-refund'?'refunded':['order','leave-reserved','cancel'].includes(screen)?'reserved':'draft';
const orderMode=pick('orderMode',['draft','reserved','unknown','confirmed','paid','refunded'],defaultMode);
const isUnknown=orderMode==='unknown'||['payment-unknown','order-unknown'].includes(screen);
const isReserved=['reserved','confirmed'].includes(orderMode)||screen==='leave-reserved';
const baseOrder=selection==='nex'?'004':'001';
const settledOrderSuffix=selection==='nex'?'005':'002';
const orderNo=/^DESIGN-ORDER-00[1-6]$/.test(params.get('orderNo')||'')?params.get('orderNo'):'DESIGN-ORDER-'+(orderMode==='paid'?settledOrderSuffix:orderMode==='refunded'?(selection==='nex'?'006':'003'):baseOrder);
const scope=(params.get('scope')||'design-'+selection+'-'+orderMode).replace(/[^a-z0-9_-]/gi,'').slice(0,100);
const termsMissing=params.get('terms')==='missing';
let quoteStale=params.get('quote')==='stale',priorFocus=null;
const leaveKey='app-r1-v2-leave:'+scope;
let leavePromptShown=params.get('prompted')==='1'||sessionStorage.getItem(leaveKey)==='1';
const quantities=new Map(selected.map(p=>[p.key,Math.max(1,Math.min(8,Number(params.get('qty_'+p.key))||p.quantity))]));
if(selected.some(p=>quantities.get(p.key)!==p.quantity))quoteStale=true;
const title=state==='long'?t.promoLong:t.promo;
const normal=()=>!['empty','loading','error','disabled'].includes(state);
const canConfirm=()=>normal()&&!termsMissing&&!quoteStale&&!isUnknown;
const note=()=>'<p class="sample-note" data-fixture-disclosure>'+t.sample+'</p>';
const section=(label,content,extra='')=>'<section class="'+extra+'"><h2 style="margin-bottom:12px">'+label+'</h2>'+content+'</section>';
function urlFor(target,extra={}){
  const u=new URL(location.href);u.searchParams.set('screen',target);
  for(const [k,v] of Object.entries({selection,orderMode,orderNo,scope,terms:termsMissing?'missing':'complete',quote:quoteStale?'stale':'fresh',prompted:leavePromptShown?'1':'0',...extra})){
    if(v===null)u.searchParams.delete(k);else u.searchParams.set(k,String(v));
  }
  for(const [key,value]of quantities)u.searchParams.set('qty_'+key,String(value));
  return u;
}
function link(label,target,cls='action glass',extra={}){
  return '<a class="'+cls+'" href="'+esc(urlFor(target,extra).href)+'" data-target="'+target+'" '+(cls==='product-image-link'?'aria-label="'+t.detail+'" ':'')+'data-extra="'+esc(JSON.stringify(extra))+'">'+label+'</a>';
}
function button(label,action,primary=false,disabled=false,attrs=''){
  return '<button class="action glass'+(primary?' primary':'')+'" data-action="'+action+'"'+(disabled?' disabled':'')+' '+attrs+'>'+label+'</button>';
}
function navigate(target,extra={}){if(isUnknown&&['checkout','detail','bundle'].includes(target)){target='order-unknown';extra={...extra,selection,orderNo,orderMode:'unknown'};}location.href=urlFor(target,extra).href;}
function status(){
  if(state==='loading')return '<div class="status-panel" role="status" aria-busy="true"><p>'+t.loading+'</p><div class="skeleton large"></div><div class="skeleton"></div><div class="skeleton short"></div></div>';
  const empty=state==='empty',disabled=state==='disabled';
  return '<div class="status-panel" role="status">'+icon(empty?'gift':'info')+'<h3>'+(empty?(screen.includes('reward')?t.emptyRewards:t.empty):disabled?t.disabled:t.error)+'</h3><p class="muted">'+(empty?t.emptyNote:disabled?t.disabledNote:t.errorNote)+'</p>'+(empty?link(t.buyMore,'store'):button(t.retry,'retry'))+'</div>';
}
function termsFor(p){
  const kind=p.type==='device'?'device':'funds';
  const rows=entitlementSamples[locale][kind];
  return '<section class="entitlements" data-terms-type="'+p.type+'" data-terms-complete="'+!termsMissing+'"><h3>'+p.name+' · '+(kind==='device'?t.deviceTerms:t.fundTerms)+'</h3><p class="small brand" style="margin:8px 0" data-terms-disclosure>'+t.termsSample+'</p>'+
    (termsMissing?'<p class="notice" data-missing-terms>'+t.termsMissing+'</p>':rows.map(([key,label,value])=>'<div class="term-row" data-entitlement="'+key+'"><strong>'+label+'</strong><p class="muted small">'+value+'</p></div>').join(''))+'</section>';
}
function termsBlock(rows=selected){return section(t.rights,rows.map(termsFor).join(''));}
function quoteNotice(){return quoteStale?'<p class="notice" role="status" data-quote-stale>'+t.stale+'</p>':'';}
function rewardStrip(p){return '<div class="reward-strip" data-new-region="sku-reward">'+icon('gift')+'<div class="grow"><p>'+t.conditional+'</p><strong>'+t[p.reward]+'</strong><br>'+link(t.rulesLink,'rules','link',{selection:p.key})+'</div></div>';}
function card(p){
  return '<article class="product-card" data-product="'+p.key+'">'+link('<img class="product-photo" src="'+asset(p.image)+'" alt="'+p.name+'">','detail','product-image-link',{selection:p.key})+'<div class="product-body"><h2 class="product-name">'+p.name+'</h2>'+(normal()?rewardStrip(p):'')+'<div class="features"><span>UVEL</span><span>·</span><span>'+t.specNote+'</span></div><div><small>'+t.price+'</small><div class="price number">'+p.price.toLocaleString('en-US')+' <span class="small">USDT</span></div></div>'+link(t.buy,'checkout','action glass primary',{selection:p.key,orderMode:'draft',orderNo:'DESIGN-ORDER-'+(p.key==='nex'?'004':'001'),quote:quoteStale?'stale':'fresh',resume:null})+'</div></article>';
}
function productLine(p,editable=false){
  const q=quantities.get(p.key)||p.quantity;
  const step='<div class="stepper" data-product="'+p.key+'" aria-label="'+t.quantity+' · '+p.name+'"><button data-action="minus" aria-label="'+t.quantity+' −"'+(q<=1?' disabled':'')+'>−</button><output>'+q+'</output><button data-action="plus" aria-label="'+t.quantity+' +"'+(q>=8?' disabled':'')+'>+</button></div>';
  return '<div class="product-line" data-purchase-line="'+p.key+'"><img src="'+asset(p.image)+'" alt="'+p.name+'"><div class="grow column"><strong>'+p.name+'</strong>'+(editable?step:'<small>'+t.quantity+' · '+q+'</small>')+'</div><span class="amount number" data-quoted-line>'+(quoteStale?'—':(p.price*p.quantity).toLocaleString('en-US'))+'<br><small>'+(quoteStale?t.awaitingQuote:'USDT')+'</small></span></div>';
}
function rewardRows(rows=selected,rewardStatus='pending',clickable=false,sourceOrder=orderNo,sourceMode=orderMode,sourceSelection=selection){
  return rows.map(p=>{
    const inner='<div class="reward-row" data-reward-line="'+p.id+'" data-reward-type="'+p.type+'" data-reward-status="'+rewardStatus+'" data-source-order="'+sourceOrder+'"><div class="reward-symbol">'+icon('gift')+'</div><div class="grow"><small>'+t.buyLine+' · '+p.name+' × '+p.quantity+'</small><h3>'+t[p.reward]+'</h3><p class="muted">'+(rewardStatus==='cancelled'?t.cancelledRewardNote:rewardStatus==='revoking'?t.revokingRewardNote:t.settle)+'</p><span class="badge" style="margin-top:8px">'+statusText[rewardStatus]+'</span>'+(state==='long'?'<p class="muted">'+t.rightsNote+' '+t.statusRead+'</p>':'')+'</div></div>';
    return clickable?link(inner,'reward-detail','reward-row-link',{reward:p.type,rewardStatus,sourceOrder,sourceMode,sourceSelection,selection:p.key}):inner;
  }).join('');
}
function deadline(reserved=false){return '<div class="row" data-deadline="'+(reserved?'payBy':'endsAt')+'" style="align-items:flex-start;margin-top:16px">'+icon('clock')+'<div><small>'+(reserved?t.payBy:t.deadline)+'</small><p class="number small">'+(reserved?t.payByValue:t.deadlineValue)+'</p></div></div>';}
function amounts(paid=false){
  const total=selected.reduce((sum,p)=>sum+p.price*p.quantity,0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const value=quoteStale?'—':total+' USDT';
  return '<div class="quote-amounts" data-quote-valid="'+!quoteStale+'"><div class="summary-line"><span>'+t.subtotal+'</span><span class="number">'+value+'</span></div><div class="summary-line"><span>'+t.discount+'</span><span class="number">'+(quoteStale?'—':'0.00 USDT')+'</span></div><div class="summary-line total"><span>'+(paid?t.paidTotal:t.total)+'</span><span class="number">'+value+'</span></div></div>';
}
function checkout(){
  if(isUnknown)return unknownOrder();
  return '<div class="stack" data-order-mode="'+orderMode+'" data-order-no="'+orderNo+'"><div class="progress-steps">'+t.steps.map((s,i)=>'<span class="'+(i===0?'active':'')+'">'+(i+1)+' · '+s+'</span>').join('')+'</div>'+section(t.selected,selected.map(p=>productLine(p)).join(''),'flat')+quoteNotice()+section(isReserved?t.locked:t.expected,quoteStale?'<p>'+t.awaitingQuote+'</p>':normal()?'<p class="muted small">'+t.rewardNote+'</p>'+rewardRows(selected,isReserved?'reserved':'pending')+deadline(isReserved)+link(t.rulesLink,'rules','link'):status(),'flat')+termsBlock()+section(t.wallet,'<p class="muted small">'+t.balance+'</p>'+amounts(),'flat')+button(t.pay,'payment',true,!canConfirm())+button(t.back,'leave')+note()+'</div>';
}
function promo(){return normal()?'<section class="promo" data-new-region="home-promotion"><img class="product-thumb" src="'+asset(products[0].image)+'" alt="'+products[0].name+'"><div><span class="eyebrow">'+t.events+'</span><h2>'+title+'</h2><p class="small muted" style="margin-top:7px">'+t.promoSub+'</p>'+link(t.browse,'store','action glass primary')+'</div></section><div class="dots" aria-hidden="true"><i class="dot"></i><i class="dot active"></i><i class="dot"></i></div>':state==='empty'?'':status();}
function home(){return '<div class="stack"><h1>'+t.greeting+'</h1><section class="earnings"><small>'+t.earnings+'</small><div class="amount number">$ —</div><p class="muted small">'+t.unknown+'</p></section><div>'+(state==='empty'?'<section class="flat" style="min-height:184px"><h2>'+t.weekly+'</h2><p class="muted" style="margin-top:12px">'+t.weeklyNote+'</p></section>':promo())+'</div>'+section(t.liveFeed,'<p class="muted small">'+t.preserveFeed+'</p>')+section(t.quick,'<div class="quick-grid">'+[['store','store'],['rewards','gift'],['rules','info'],['invite','team']].map(([s,i])=>link('<span class="glass">'+icon(i)+'</span><span>'+t[s]+'</span>',s,'quick')).join('')+'</div>')+section(t.devices,'<p class="muted small">'+t.unknown+'</p>')+note()+'</div>';}
function store(){return '<div class="stack">'+(params.get('resume')==='1'?link(t.resumeSelection,'checkout','action glass',{resume:null}):'')+'<div class="filters">'+link(t.activityProducts,'store','glass')+link(t.allProducts,'store','glass')+link(t.bundle,'bundle','glass',{selection:'bundle'})+'</div>'+(normal()?'<div><h1>'+title+'</h1><p class="muted small" style="margin-top:8px">'+t.promoSub+'</p></div>':status())+products.map(card).join('')+note()+'</div>';}
function detail(){const p=activeProduct;return '<div class="stack"><img class="product-photo" style="border-radius:24px" src="'+asset(p.image)+'" alt="'+p.name+'"><h1>'+p.name+'</h1><div class="price number">'+p.price.toLocaleString('en-US')+' <span class="small">USDT</span></div>'+section(t.gift,normal()?rewardStrip(p):status())+termsFor(p)+quoteNotice()+section(t.quantity,productLine(p,true))+section(t.specs,'<p class="muted">'+t.specNote+'</p>')+button(t.buy,'detail-buy',true,!canConfirm())+link(t.bundle,'bundle','action glass',{selection:'bundle'})+note()+'</div>';}
function bundle(){return '<div class="stack">'+section(t.selected,selected.map(p=>productLine(p,true)).join(''))+quoteNotice()+section(t.expected,quoteStale?'<p>'+t.awaitingQuote+'</p>':normal()?rewardRows():status(),'flat')+termsBlock()+link(t.rulesLink,'rules','link')+'<section>'+amounts()+'</section>'+button(t.pay,'payment',true,!canConfirm())+link(t.buyMore,'store','action glass')+note()+'</div>';}
function order(){
  if(isUnknown)return unknownOrder();
  return '<div class="stack" data-order-mode="'+orderMode+'" data-order-no="'+orderNo+'"><div><span class="badge">'+t.pending+'</span><h1 style="margin-top:12px">'+t.order+'</h1><p class="small muted">'+t.orderNo+' · '+orderNo+'</p></div>'+(orderMode==='confirmed'?'<p class="notice" data-query-confirmed>'+t.queriedUnpaid+'</p>':'')+section(t.selected,selected.map(p=>productLine(p)).join(''))+section(t.locked,normal()?rewardRows(selected,'reserved',true):status(),'flat')+deadline(true)+termsBlock()+amounts()+button(t.resume,'payment',true,!canConfirm())+button(t.cancelOrder,'cancel',false,!normal())+link(t.rewards,'rewards','link')+note()+'</div>';
}
function settledOrder(refund=false){
  return '<div class="stack" data-order-mode="'+(refund?'refunded':'paid')+'" data-order-no="'+orderNo+'"><div><span class="badge">'+(refund?t.refunded:t.paid)+'</span><h1 style="margin-top:12px">'+t.order+'</h1><p class="small muted">'+t.orderNo+' · '+orderNo+'</p></div>'+section(t.selected,selected.map(p=>productLine(p)).join(''))+section(t.orderRewards,normal()?selected.map(p=>rewardRows([p],refund?(p.type==='device'?'revoking':'cancelled'):(p.type==='device'?'granted':p.type==='nex'?'hold':'pending'),true,orderNo,refund?'refunded':'paid')).join(''):status(),'flat')+termsBlock()+(refund?'<div class="summary-line total"><span>'+t.refundTotal+'</span><span class="number">'+selected.reduce((n,p)=>n+p.quantity*p.price,0).toLocaleString('en-US',{minimumFractionDigits:2})+' USDT</span></div><p class="notice">'+t.refundNote+'</p>':amounts(true))+button(t.refresh,'retry')+(refund?button(t.help,'readonly'):link(t.rewards,'rewards','action glass'))+note()+'</div>';
}
const rewardRecords={device:{status:'granted',order:'DESIGN-ORDER-002',selection:'bundle'},usdt:{status:'pending',order:'DESIGN-ORDER-002',selection:'bundle'},nex:{status:'hold',order:'DESIGN-ORDER-005',selection:'nex'}};
function rewards(){return '<div class="stack"><div><h1>'+t.rewards+'</h1><p class="muted small" style="margin-top:8px">'+t.statusRead+'</p></div><div class="filters">'+link(t.all,'rewards','glass')+link(t.rewardPending,'rewards','glass')+link(t.rewardGranted,'rewards','glass')+'</div>'+(normal()?products.map(p=>rewardRows([p],rewardRecords[p.type].status,true,rewardRecords[p.type].order,'paid',rewardRecords[p.type].selection)).join(''):status())+button(t.refresh,'retry')+note()+'</div>';}
function rewardDetail(){
  const record=rewardRecords[rewardKey],rs=pick('rewardStatus',statusKeys,record.status),source=/^DESIGN-ORDER-00[1-6]$/.test(params.get('sourceOrder')||'')?params.get('sourceOrder'):record.order;
  const sourceMode=pick('sourceMode',['reserved','confirmed','unknown','paid','refunded'],'paid');
  const assetType=rewardKey==='device'?'device':'wallet',hasReceipt=rs==='granted';
  const target=sourceMode==='unknown'?'order-unknown':sourceMode==='confirmed'?'order-confirmed':sourceMode==='paid'?'order-paid':sourceMode==='refunded'?'order-refund':'order';
  return '<div class="stack" data-detail-type="'+rewardKey+'" data-detail-status="'+rs+'" data-source-order="'+source+'">'+(normal()?'<div><span class="badge">'+statusText[rs]+'</span><h1 style="margin-top:12px">'+t[rewardProduct.reward]+'</h1><p class="muted small">'+t.promo+'</p></div>'+section(t.sourceOrder,'<p>'+source+'</p><p class="muted small">'+rewardProduct.name+' × '+rewardProduct.quantity+'</p>'+link(t.viewOrder,target,'link',{orderNo:source,orderMode:sourceMode,selection:pick('sourceSelection',['bundle','pro','s1','nex'],record.selection)}))+termsFor(rewardProduct)+section(t.history,'<div class="timeline"><div><strong>'+statusText[rs]+'</strong><p class="muted small">2026-10-07 14:49 · UTC+09:00</p></div></div>')+(hasReceipt?'<p class="small" data-receipt>'+t.receipt+' · DESIGN-'+(assetType==='device'?'DEVICE':'BILL')+'-'+rewardKey.toUpperCase()+'</p>':'<p class="notice">'+t.assetPending+'</p>')+button(assetType==='device'?t.viewDevice:t.viewBills,'readonly',false,!hasReceipt,'data-asset-target="'+assetType+'" data-asset-currency="'+rewardKey+'"'):status())+note()+'</div>';
}
function events(){return '<div class="stack"><div class="filters">'+link(t.all,'events','glass')+link(t.rewards,'rewards','glass')+'</div>'+(normal()?'<section><span class="eyebrow">'+t.events+'</span><h1 style="margin:10px 0">'+title+'</h1><p class="muted">'+t.promoSub+'</p>'+deadline()+link(t.browse,'store','action glass primary')+link(t.rulesLink,'rules','link')+'</section>':status())+note()+'</div>';}
function rules(){return '<div class="stack">'+(normal()?'<h1>'+title+'</h1>'+section(t.ruleCondition,'<p class="muted">'+t.ruleConditionBody+'</p>')+section(t.rewardLine,rewardRows(selected))+termsBlock()+section(t.returnPolicy,'<p class="muted">'+t.returnBody+'</p>')+deadline(isReserved)+button(t.back,'back')+link(t.browse,'store','action glass primary'):status())+note()+'</div>';}
function invite(){return '<div class="stack">'+(normal()?'<div><span class="eyebrow">'+t.events+'</span><h1 style="margin-top:8px">'+t.inviteTitle+'</h1><p class="muted" style="margin-top:10px">'+t.inviteNote+'</p></div>'+section(t.myReward,rewardRows([products[2]],'hold',true,'DESIGN-ORDER-005','paid','nex'),'flat')+termsFor(products[2])+section(t.friendProgress,'<div class="row">'+icon('check')+'<p>'+t.friendPaid+'</p></div><p class="muted small" style="margin-top:10px">'+t.privacy+'</p>')+button(t.existingInvite,'readonly'):status())+button(t.refresh,'retry')+note()+'</div>';}
function unknownOrder(){
  return '<div class="stack" data-order-mode="unknown" data-order-no="'+orderNo+'"><div class="status-panel">'+icon('clock')+'<h1>'+t.unknownTitle+'</h1><p class="muted">'+t.unknownBody+'</p><p class="small">'+t.orderNo+' · '+orderNo+'</p></div>'+section(t.selected,selected.map(p=>productLine(p)).join(''))+section(t.locked,normal()?rewardRows(selected,'reserved',true,orderNo,'unknown'):status(),'flat')+button(t.query,'query',true,state==='loading')+button(t.help,'readonly')+note()+'</div>';
}
function unknownPayment(){return unknownOrder().replace(note(),link(t.viewOrder,'order-unknown','action glass',{orderMode:'unknown'})+note());}
function modal(kind){
  const cancel=kind==='cancel',reserved=isReserved||cancel;
  return '<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-order-mode="'+orderMode+'" data-order-no="'+orderNo+'"><div class="modal-icon glass">'+icon(cancel?'info':'gift')+'</div><h2 id="modal-title">'+(cancel?t.cancelTitle:t.leaveTitle)+'</h2><p>'+(cancel?t.cancelBody:reserved?t.reservedBody:t.leaveBody)+'</p><div class="divider" style="margin-top:16px">'+selected.map(p=>'<p>'+t[p.reward]+'</p>').join('')+'</div><div class="deadline">'+deadline(reserved)+'</div>'+(cancel?'':'<p class="small muted" style="margin-top:14px">'+t.notCancel+'</p>')+'<div class="modal-actions">'+button(cancel?t.keep:t.continue,'stay',true)+button(cancel?t.cancelOrder:t.exit,cancel?'confirm-cancel':'exit')+'</div></section></div>';
}
const tabScreens=['home','store'],isCheckout=['checkout','leave','leave-reserved'].includes(screen);
const wantsModal=['leave','leave-reserved','cancel'].includes(screen)&&normal()&&!isUnknown&&(screen==='cancel'||(!termsMissing&&!quoteStale));
const isModal=wantsModal&&(screen==='cancel'||!leavePromptShown);
const header=tabScreens.includes(screen)?'<header class="header"><span class="wordmark"><img class="brand-image" src="'+asset('header-logo-'+theme+'.png')+'" alt="UVEL"></span><div class="row"><button class="icon-button glass" aria-label="'+t.search+'" data-action="readonly">'+icon('search')+'</button><button class="icon-button glass" aria-label="'+t.bell+'" data-action="readonly">'+icon('bell')+'</button></div></header>':'<header class="header sub"><button class="icon-button glass" aria-label="'+t.back+'" data-action="'+(isCheckout?'leave':'back')+'">'+icon('back')+'</button><div class="header-title">'+t[screen]+'</div><button class="icon-button glass" aria-label="'+t.bell+'" data-action="readonly">'+icon('bell')+'</button></header>';
const renderers={home,store,detail,bundle,checkout,order,'order-paid':()=>settledOrder(false),'order-refund':()=>settledOrder(true),'order-unknown':unknownOrder,'order-confirmed':order,rewards,'reward-detail':rewardDetail,events,rules,invite,'payment-unknown':unknownPayment,leave:checkout,'leave-reserved':checkout,cancel:order};
const canvas=document.querySelector('#canvas');
canvas.className=(state==='long'?'long ':'')+(state==='reduced-transparency'?'reduced':'');
canvas.dataset.screen=screen;canvas.dataset.state=state;canvas.dataset.locale=locale;
canvas.innerHTML='<div class="safe-top" aria-hidden="true"></div>'+header+'<main class="main">'+renderers[screen]()+'</main>'+(tabScreens.includes(screen)?'<nav class="tabbar glass" aria-label="'+t.quick+'">'+['home','earn','store','team','me'].map((s,i)=>link(icon(s)+'<span>'+t.footerTabs[i]+'</span>',s==='store'?'store':'home','tab '+(screen===s?'active':''))).join('')+'</nav>':'')+'<div class="home-indicator" aria-hidden="true"></div>'+(isModal?modal(screen):'')+'<p class="sr" role="status" id="feedback"></p>';
const isolate=value=>document.querySelectorAll('main,header,.tabbar').forEach(el=>el.inert=value);
function markPrompt(){leavePromptShown=true;sessionStorage.setItem(leaveKey,'1');history.replaceState(null,'',urlFor(screen).href);}
function closeModal(){document.querySelector('.modal-backdrop')?.remove();isolate(false);(priorFocus||document.querySelector('header button'))?.focus({preventScroll:true});}
function exitCheckout(){navigate('store',{resume:1,quote:isReserved?'fresh':'stale'});}
function openLeave(trigger){
  if(!canConfirm()||leavePromptShown){exitCheckout();return;}
  priorFocus=trigger;markPrompt();canvas.insertAdjacentHTML('beforeend',modal(isReserved?'leave-reserved':'leave'));isolate(true);document.querySelector('.modal button').focus();
}
function syncQuoteStale(){
  quoteStale=true;history.replaceState(null,'',urlFor(screen).href);
  document.querySelectorAll('[data-quoted-line]').forEach(el=>el.innerHTML='—<br><small>'+t.awaitingQuote+'</small>');
  document.querySelectorAll('.quote-amounts').forEach(el=>el.outerHTML=amounts());
  document.querySelectorAll('[data-reward-line]').forEach(el=>el.hidden=true);
  if(!document.querySelector('[data-quote-stale]'))document.querySelector('main .stack').insertAdjacentHTML('afterbegin',quoteNotice());
  document.querySelectorAll('[data-action=payment],[data-action=detail-buy]').forEach(el=>el.disabled=true);
  window.designBaseline.quote='stale';
}
document.addEventListener('click',e=>{
  if(e.target.classList.contains('modal-backdrop')){closeModal();return;}
  const a=e.target.closest('a[data-target]');
  if(a){
    e.preventDefault();const extra=JSON.parse(a.dataset.extra||'{}');
    if(a.dataset.target==='rules')Object.assign(extra,{returnScreen:screen,returnScroll:document.querySelector('main').scrollTop,returnState:state});
    navigate(a.dataset.target,extra);return;
  }
  const b=e.target.closest('[data-action]');if(!b||b.disabled)return;
  switch(b.dataset.action){
    case 'plus':case 'minus':{
      const step=b.closest('.stepper'),key=step.dataset.product,o=step.querySelector('output');
      const q=Math.max(1,Math.min(8,Number(o.textContent)+(b.dataset.action==='plus'?1:-1)));
      o.textContent=String(q);quantities.set(key,q);step.querySelector('[data-action=minus]').disabled=q<=1;step.querySelector('[data-action=plus]').disabled=q>=8;syncQuoteStale();return;
    }
    case 'leave':openLeave(b);return;
    case 'stay':closeModal();return;
    case 'exit':exitCheckout();return;
    case 'cancel':navigate('cancel',{orderMode:'reserved'});return;
    case 'confirm-cancel':document.querySelector('#feedback').textContent=t.sample;return;
    case 'back':{
      const from=pick('returnScreen',SCREENS,'store'),scroll=Math.max(0,Math.min(20000,Number(params.get('returnScroll'))||0));
      navigate(from,{scroll,returnScreen:null,returnScroll:null,state:pick('returnState',STATES,'normal'),returnState:null});return;
    }
    case 'detail-buy':if(canConfirm())navigate('checkout',{selection:activeProduct.key});return;
    case 'payment':if(canConfirm())navigate('payment-unknown',{orderMode:'unknown'});return;
    case 'query':
      if(params.get('queryResult')==='unpaid')navigate('order-confirmed',{orderMode:'confirmed',queryResult:null});
      else document.querySelector('#feedback').textContent=t.unknownBody;
      return;
    case 'retry':navigate(screen,{state:'normal'});return;
    default:document.querySelector('#feedback').textContent=t.sample;
  }
});
document.addEventListener('keydown',e=>{
  const dialog=document.querySelector('.modal');if(!dialog)return;
  const focus=[...dialog.querySelectorAll('button:not(:disabled),a[href]')];
  if(e.key==='Escape'){e.preventDefault();closeModal();return;}
  if(e.key==='Tab'){const i=focus.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();focus.at(-1)?.focus();}else if(!e.shiftKey&&(i<0||i===focus.length-1)){e.preventDefault();focus[0]?.focus();}}
});
if(isModal){if(screen!=='cancel')markPrompt();isolate(true);document.querySelector('.modal button')?.focus();}
document.fonts.ready.then(()=>requestAnimationFrame(()=>{const saved=Math.max(0,Math.min(20000,Number(params.get('scroll'))||0));if(saved)document.querySelector('main').scrollTop=saved;}));
window.designBaseline={id:'app-r1-20261007-v2',screen,state,locale,theme,width,platform,safeInsets,selection,orderMode,orderNo,scope,reward:rewardKey,terms:termsMissing?'missing':'complete',quote:quoteStale?'stale':'fresh',fixtureOnly:true,serverTime:'2026-10-07T06:00:00Z',screens:SCREENS,states:STATES};
