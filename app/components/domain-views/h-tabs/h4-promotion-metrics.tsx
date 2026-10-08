"use client";
import { useRef, useState } from 'react';
import type { Catalog, ExportJob, Metrics, Promotion } from '@/lib/admin/promotion-types';
import { promotionRead, promotionVersions } from '@/lib/admin/promotion-client';
import { dateInput, utcInput } from '@/lib/admin/promotion-form';
import { Button, Card, ConfirmCommand, Dialog, Empty, Field, Loading, Notice, ReadError, Stats, Summary, Table, Tag, TEMPLATE_LABELS, formatTime, labelState, text, useRead } from './h4-promotion-ui';
export default function PromotionMetrics({ activity, catalog, can, onBack }: {
    activity: Promotion;
    catalog: Catalog;
    can: (v: string) => boolean;
    onBack: () => void;
}) {
    const [optionsOpen,setOptionsOpen]=useState(false),[rewardsOpen,setRewardsOpen]=useState(false);
    const lastRequest = useRef<Record<string, string | number> | null>(null);
    const versions=useRead(()=>promotionVersions(activity.activityId),[activity.activityId]);
    const [filter, setFilter] = useState({ from: activity.startsAt || '', to: activity.endsAt || '', timezone: activity.displayTimezone || 'UTC', version: '', groupBy: 'SKU' }), [query, setQuery] = useState<Record<string, string | number> | null>(null), [data, setData] = useState<Metrics | null>(null), [error, setError] = useState<unknown>(null), [loading, setLoading] = useState(false), [exporting, setExporting] = useState(false), [job, setJob] = useState<ExportJob | null>(null), [jobBusy, setJobBusy] = useState(false), [previous, setPrevious] = useState<Array<Record<string, string | number>>>([]);
    const read = async (q: Record<string, string | number>) => { lastRequest.current = q; setLoading(true); setError(null); try {
        const next = await promotionRead<Metrics>(`/promotions/${activity.activityId}/metrics`, q);
        setData(next);
        setQuery({ ...q, querySnapshot: next.querySnapshot });
    }
    catch (e) {
        setError(e);
    }
    finally {
        setLoading(false);
    } };
    const exportRead = async (id: string, download = false) => { setJobBusy(true); setError(null); try {
        const next = await promotionRead<ExportJob>(`/promotion-exports/${encodeURIComponent(id)}${download ? '/download' : ''}`);
        setJob(next);
        if (download && next.downloadUrl) {
            const url = new URL(next.downloadUrl);
            if (!['https:', 'http:'].includes(url.protocol))
                throw new Error('下载地址不可用，请重试查询导出任务。');
            const link = document.createElement('a');
            link.href = url.href;
            link.rel = 'noopener noreferrer';
            link.target = '_blank';
            link.click();
        }
    }
    catch (e) {
        setError(e);
        throw e;
    }
    finally {
        setJobBusy(false);
    } };
    const sales=data?.salesBySku;
    return <><section className="card"><form className="filter metrics-filter" onSubmit={e=>{e.preventDefault();setPrevious([]);setJob(null);void read({...filter,limit:20});}}><Field label="活动"><select value={activity.activityId} onChange={()=>undefined}><option value={activity.activityId}>{activity.name||'未命名活动'}</option></select></Field><Field label="活动版本"><select value={filter.version} onChange={e=>setFilter({...filter,version:e.target.value})}><option value="">合并所有版本</option>{(versions.data?.items||[]).map(v=><option value={v.version} key={v.version}>v{v.version}</option>)}</select></Field><Field label="开始时间"><input type="datetime-local" required value={dateInput(filter.from,filter.timezone)} onChange={e=>{try{setFilter({...filter,from:utcInput(e.target.value,filter.timezone)||''});}catch(f){setError(f);}}}/></Field><Field label="结束时间"><input type="datetime-local" required value={dateInput(filter.to,filter.timezone)} onChange={e=>{try{setFilter({...filter,to:utcInput(e.target.value,filter.timezone)||''});}catch(f){setError(f);}}}/></Field><Button kind="primary" type="submit" disabled={loading||!can('growth_promotion_metrics_read')}>查询</Button></form></section>
    {!!error&&<ReadError error={error} retry={()=>{if(lastRequest.current)void read(lastRequest.current);}}/>}{loading?<Loading/>:!data?<Empty title="选择统计范围后查询">同一报表与导出始终绑定服务端查询快照。</Empty>:<><Stats items={[[ '净实收 · USDT',data.netReceivedUsdt,'实付减已确认退款'],['实付订单',data.paidOrders,'不含测试与重复事件'],['已确认退款 · USDT',data.refundUsdt,'整单钱包退款事实'],['转化率',data.conversionRate??'未提供','缺失分母不推算']]}/><Notice title={'统计截止 '+formatTime(data.asOf,data.timezone)} kind={data.completeness==='COMPLETE'?'':'warn'}>{data.completeness==='COMPLETE'?'订单与奖励事实已汇总':'当前数据延迟或不可用'}；曝光与成本缺失时保持未提供。建单按创建时间，成交按付款时间，退款截至本快照。</Notice>
    <div className="grid2"><Card title="转化分步"><Table headers={['事实','数量','完整性']} rows={[[ '活动曝光',data.impressions??'未提供',<Tag value={data.impressions===null?'DELAYED':'COMPLETE'}/>],['有效报价',data.quotes,<Tag value={data.completeness}/>],['创建订单',data.orders,<Tag value={data.completeness}/>],['实付成交',data.paidOrders,<Tag value={data.completeness}/>]]}/></Card><Card title="奖励与成本"><Table headers={['类型','已发放','待处理']} rows={[[ '设备赠礼',data.giftDevices+' 台','未提供'],...(['USDT','NEX'] as const).map(asset=>{const row=data.assets.find(a=>a.asset===asset);return [asset,row?.issued??'未提供',row?.pending??'未提供'];})]}/><div className="card-body"><small>{data.giftCostUsdt===null?'赠机成本资料未提供':'赠机成本 '+data.giftCostUsdt+' USDT'}；不推算获客成本、毛利或 ROI。双币独立列示，不自动折算。</small></div></Card></div>
    <Card title="设备分项" action={<Button onClick={()=>setOptionsOpen(true)}>统计口径</Button>}><Table headers={['购买设备','实付订单','实付 · USDT','确认退款 · USDT','净实收 · USDT']} rows={(sales||[]).map(r=>[r.productName||r.purchaseProductNo,r.paidOrders,r.grossPaidUsdt,r.refundUsdt,r.netReceivedUsdt])}/>{!sales?<div className="card-body"><Notice title="逐设备成交来源尚未提供" kind="warn">当前服务尚未返回分项实付、确认退款与净实收；不能用奖励数量或当前售价推算。</Notice></div>:!sales.length?<Empty title="该时段暂无成交事实"/>:null}<div className="pagination"><span>共 {sales?.length??'未知'} 条 · 同一快照，按设备去重订单</span><span>跨设备订单数不直接相加</span></div></Card>
    <div className="footerbar"><small>来源：订单、退款与奖励确认事实 · 同一查询快照 · {data.timezone}</small><div className="actions"><Button onClick={()=>setRewardsOpen(true)}>奖励分组明细</Button><Button onClick={onBack}>返回活动</Button><Button kind="primary" disabled={!can('growth_promotion_metrics_export')||loading} onClick={()=>setExporting(true)}>导出当前快照</Button></div></div></>}
    {optionsOpen&&<Dialog title="统计口径与分组" wide onClose={()=>setOptionsOpen(false)} footer={<Button onClick={()=>setOptionsOpen(false)}>返回报表</Button>}><div className="grid2"><Field label="显示时区"><select value={filter.timezone} onChange={e=>setFilter({...filter,timezone:e.target.value})}><option value="Asia/Tokyo">日本时间 · UTC+9</option><option value="UTC">协调世界时 · UTC</option><option value="Asia/Ho_Chi_Minh">越南时间 · UTC+7</option></select></Field><Field label="分组方式"><select value={filter.groupBy} onChange={e=>setFilter({...filter,groupBy:e.target.value})}><option value="SKU">购买设备</option><option value="TEMPLATE">活动模板</option><option value="BENEFICIARY">受益人</option></select></Field></div><p className="help">设置仅改变待查询条件，返回后点击“查询”取得新的固定快照；导出始终使用当前已返回快照。</p>{data&&<Summary rows={[[ '有效首购人数',data.effectiveFirstPurchasePeople.value??'未知'],['直接邀请合格购买人数',data.directInvitedQualifiedPurchasers.value??'未知'],['奖励异常',data.rewardFailureMetrics.value??'未知'],['平均恢复耗时',data.recoveryDuration.value===null?'未知':data.recoveryDuration.value+' 秒'],['外部流入 · USDT',data.externalInflowUsdt??'未知'],['外部流出 · USDT',data.externalOutflowUsdt??'未知']]}/>}<Notice title="成交与奖励采用不同时间口径">成交按付款时间窗口，确认退款统计截至快照；奖励按义务创建窗口。截至当前快照的奖励结果不会被当作成交金额。历史订单使用当时锁定的分项金额。</Notice></Dialog>}
    {rewardsOpen&&data&&<Dialog title="奖励分组明细" wide onClose={()=>setRewardsOpen(false)}><div className="grid2"><Field label="分组方式"><select value={filter.groupBy} onChange={e=>{setFilter({...filter,groupBy:e.target.value});setPrevious([]);void read({...filter,groupBy:e.target.value,limit:20});}}><option value="SKU">购买设备</option><option value="TEMPLATE">活动模板</option><option value="BENEFICIARY">受益人</option></select></Field></div><Table headers={['分组','资产 / 赠品','订单 / 受益人','义务','已发','待发','追回 / 未结']} rows={data.breakdown.rows.map(r=>[data.breakdown.groupBy==='SKU'?text(catalog.skus.find(s=>s.productNo===r.purchaseProductNo)?.name):data.breakdown.groupBy==='TEMPLATE'?r.template?TEMPLATE_LABELS[r.template]:'未提供':r.beneficiaryId+' · '+(r.beneficiaryRole?labelState(r.beneficiaryRole):''),r.asset==='DEVICE'?text(catalog.skus.find(s=>s.productNo===r.giftProductNo)?.name):r.asset,r.orders+' / '+r.beneficiaries,r.obligations,r.issued,r.pending,r.reversed+' / '+r.unrecoverable])}/>{!data.breakdown.rows.length&&<Empty title="当前窗口没有分组记录"/>}<div className="pagination"><span>共 {data.breakdown.total} 组 · 快照 {formatTime(data.asOf)}</span><div className="actions"><Button disabled={!previous.length||loading} onClick={()=>{void read(previous.at(-1)!);setPrevious(previous.slice(0,-1));}}>上一页</Button><Button disabled={!data.breakdown.hasMore||loading||!query} onClick={()=>{setPrevious([...previous,query!]);void read({...query!,querySnapshot:data.querySnapshot,cursor:data.breakdown.nextCursor!,limit:20});}}>下一页</Button></div></div><Table headers={['资产','已冲正','未结追回']} rows={data.assets.map(a=>[a.asset,a.reversed??'未知',a.unrecoverable??'未知'])}/></Dialog>}
    {job && <Card title="导出任务" body><Summary rows={[['状态', job.state === 'READY' ? '文件已生成' : job.state === 'PROCESSING' ? '正在生成' : job.state === 'EXPIRED' ? '已过期' : '生成失败'], ['导出行数', job.rowCount ?? '待确认'], ['有效截止', formatTime(job.expiresAt)]]}/><div className="actions"><Button disabled={jobBusy} onClick={() => { void exportRead(job.exportId).catch(() => undefined); }}>查询原任务</Button><Button kind="primary" disabled={jobBusy || job.state !== 'READY'} onClick={() => { void exportRead(job.exportId, true).catch(() => undefined); }}>下载文件</Button></div></Card>}
    {exporting && data && <ConfirmCommand title="导出当前统计快照" intent={{ operation: 'createExport', targetId: activity.activityId, path: `/promotions/${activity.activityId}/metrics/exports`, method: 'POST' }} body={{ querySnapshot: data.querySnapshot }} onClose={() => setExporting(false)} onSuccess={async (result) => { if (result.resource?.type !== 'EXPORT')
        throw new Error('导出任务回执不完整，请核查原命令。'); await exportRead(result.resource.id); setExporting(false); }}><Summary rows={[['活动', activity.name || activity.activityId], ['统计时刻', formatTime(data.asOf)], ['范围', `${formatTime(data.from, data.timezone)} ～ ${formatTime(data.to, data.timezone)}`], ['分组数', data.breakdown.total]]}/></ConfirmCommand>}
  </>;
}
