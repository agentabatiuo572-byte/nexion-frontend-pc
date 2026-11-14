"use client";
import { H4DateTimeField } from './h4-date-time-field';
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { useRef, useState } from 'react';
import type { Catalog, ExportJob, Metrics, Promotion } from '@/lib/admin/promotion-types';
import { promotionRead, promotionVersions } from '@/lib/admin/promotion-client';
import { dateInput, utcInput } from '@/lib/admin/promotion-form';
import { Button, Card, ConfirmCommand, Dialog, Empty, Field, Loading, Notice, ReadError, Stats, Summary, Table, TEMPLATE_LABELS, formatTime, labelState, text, useRead, zoneLabel } from './h4-promotion-ui';
import { Boxes, Filter, Gift, Receipt, Scale } from 'lucide-react';
import { BarList, BlockState, Panel, SegmentBar, StatusTag } from '@/app/components/rd';
import { Amount, amountText } from './h4-promotion-board';
const num = (v: string | number | null | undefined) => { const n = Number(v); return v === null || v === undefined || !Number.isFinite(n) || n < 0 ? 0 : n; };
export default function PromotionMetrics({ activity, catalog, can, onBack }: {
    activity: Promotion;
    catalog: Catalog;
    can: (v: string) => boolean;
    onBack: () => void;
}) {
    const [optionsOpen,setOptionsOpen]=useState(false),[rewardsOpen,setRewardsOpen]=useState(false);
    const failedRead = useRef<{target: string; retry: () => void} | null>(null);
    const failedQuery = useRef<{error: unknown; retry: () => void} | null>(null);
    const versions=useRead(()=>promotionVersions(activity.activityId),[activity.activityId]);
    const [filter, setFilter] = useState({ from: activity.startsAt || '', to: activity.endsAt || '', timezone: activity.displayTimezone || 'UTC', version: '', groupBy: 'SKU' }), [query, setQuery] = useState<Record<string, string | number> | null>(null), [data, setData] = useState<Metrics | null>(null), [error, setError] = useState<unknown>(null), [loading, setLoading] = useState(false), [exporting, setExporting] = useState(false), [job, setJob] = useState<ExportJob | null>(null), [jobBusy, setJobBusy] = useState(false), [previous, setPrevious] = useState<Array<Record<string, string | number>>>([]);
    const read = async (q: Record<string, string | number>) => { setLoading(true); setError(null); failedQuery.current=null; try {
        const next = await promotionRead<Metrics>(`/promotions/${activity.activityId}/metrics`, q);
        setData(next);
        setQuery({ ...q, querySnapshot: next.querySnapshot });
    }
    catch (e) {
        const retry = () => {
            const next = { ...q }; delete next.querySnapshot; delete next.cursor;
            setPrevious([]); setJob(null); void read(next);
        };
        failedQuery.current = {error: e, retry};
        failedRead.current = {target: '活动效果查询', retry};
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
        failedRead.current = {target: '原导出任务', retry: () => {void exportRead(id).catch(() => undefined);}};
        setError(e);
        throw e;
    }
    finally {
        setJobBusy(false);
    } };
    const readError=error??failedQuery.current?.error;
    const recovery=error?failedRead.current:failedQuery.current?{target:'活动效果查询',retry:failedQuery.current.retry}:null;
    const failure = !!readError&&<ReadError target={recovery?.target || "统计时段"} error={readError} retryLabel={recovery?.target === '原导出任务' ? "重查原任务" : recovery ? "重试" : "继续修改"} retry={()=>{if(recovery)recovery.retry();else setError(null);}}/>;
    const sales=data?.salesBySku;
    return <><section className="card"><form className="filter metrics-filter" onSubmit={e=>{e.preventDefault();setPrevious([]);setJob(null);void read({...filter,limit:20});}}><Field label="活动"><select value={activity.activityId} onChange={()=>undefined}><option value={activity.activityId}>{activity.name||'未命名活动'}</option></select></Field><Field label="活动版本"><select value={filter.version} onChange={e=>setFilter({...filter,version:e.target.value})}><option value="">合并所有版本</option>{(versions.data?.items||[]).map(v=><option value={v.version} key={v.version}>v{v.version}</option>)}</select></Field><H4DateTimeField label="开始时间" required timeZone={filter.timezone} value={dateInput(filter.from,filter.timezone)} onChange={value=>{try{setFilter({...filter,from:utcInput(value,filter.timezone)||''});}catch(f){failedRead.current=null;setError(f);}}}/><H4DateTimeField label="结束时间" required timeZone={filter.timezone} value={dateInput(filter.to,filter.timezone)} onChange={value=>{try{setFilter({...filter,to:utcInput(value,filter.timezone)||''});}catch(f){failedRead.current=null;setError(f);}}}/><Button kind="primary" type="submit" disabled={loading||!can('growth_promotion_metrics_read')}>查询</Button></form></section>
    {!rewardsOpen&&failure}{loading?<Loading/>:!data?<Empty title="选择统计范围后查询">请选择统计范围后查询。</Empty>:<><Stats items={[[ '净实收 · USDT',<Amount value={data.netReceivedUsdt}/>,'实付减已确认退款'],['实付订单',data.paidOrders,'当前统计范围内的实付订单'],['已确认退款 · USDT',<Amount value={data.refundUsdt}/>,'整单钱包退款事实'],['转化率',data.conversionRate??'未提供','当前统计范围；缺来源时后端不给，写未提供']]}/><Notice title={'统计截止 '+formatTime(data.asOf,data.timezone)+'（'+zoneLabel(data.timezone)+'）'} kind={data.completeness==='COMPLETE'?'':'warn'}>{data.completeness==='COMPLETE'?'统计资料已汇总':data.completeness==='DELAYED'?'部分统计资料延迟':'部分统计资料暂不可用'}。建单按创建时间，成交按付款时间，退款截至本快照。</Notice>
    <div className="h4-versions-grid">
      <Panel title="收入和成本（USDT）" icon={Scale} tone="role-1" explain="同一币种放一起比：卖出去净收到多少、送出去的赠品按原订单应付算多少、USDT 奖励发了多少。UVT 奖励不折算、不相加，在下面按资产单独列。">{(() => { const usdt = data.assets.find(x => x.asset === 'USDT'); const rows = [{ key: 'net', label: '净实收', value: num(data.netReceivedUsdt), text: <Amount value={data.netReceivedUsdt} unit="USDT"/> }, { key: 'gift', label: '赠品成本', value: data.giftCostUsdt === null ? null : num(data.giftCostUsdt), text: data.giftCostUsdt === null ? '未提供（原订单缺证据）' : <Amount value={data.giftCostUsdt} unit="USDT"/> }, { key: 'usdt', label: 'USDT 奖励已发', value: usdt?.issued == null ? null : num(usdt.issued), text: <Amount value={usdt?.issued} unit="USDT"/> }]; return rows.every(r => !r.value) ? <BlockState state="empty" title="这个时段没有收入和成本"/> : <BarList label="收入和成本" rows={rows}/>; })()}</Panel>
      <Panel title="支付和退款" icon={Receipt} tone="role-2" explain="实付金额里有多少被整单退款退回；净实收等于实付减已确认退款。">{num(data.grossPaidUsdt) ? <SegmentBar label="实付金额的去向" segments={[{ key: 'net', label: '净实收', value: num(data.netReceivedUsdt) * 100 / num(data.grossPaidUsdt), slot: 2, text: `净实收 ${amountText(data.netReceivedUsdt)} USDT` }, { key: 'refund', label: '已退款', value: num(data.refundUsdt) * 100 / num(data.grossPaidUsdt), slot: 3, text: `已确认退款 ${amountText(data.refundUsdt)} USDT` }]}/> : <BlockState state="empty" title="这个时段没有实付"/>}<Summary rows={[['实付 · USDT', <Amount value={data.grossPaidUsdt}/>], ['有效首购人数', data.effectiveFirstPurchasePeople.value ?? '未提供'], ['直接邀请合格购买人数', data.directInvitedQualifiedPurchasers.value ?? '未提供']]}/></Panel>
    </div>
    <Panel title="转化分步" icon={Filter} tone="role-3" explain="曝光、报价、建单、实付四步；后端没有曝光来源时写未提供，不画成 0。">{(() => { const steps = [{ key: 'imp', label: '活动曝光', value: data.impressions, text: data.impressions === null ? '未提供' : String(data.impressions) }, { key: 'quote', label: '有效报价', value: data.quotes, text: String(data.quotes) }, { key: 'order', label: '创建订单', value: data.orders, text: String(data.orders) }, { key: 'paid', label: '实付成交', value: data.paidOrders, text: String(data.paidOrders) }]; return steps.every(x => !x.value) ? <BlockState state="empty" title="这个时段没有报价和订单"/> : <BarList label="转化分步" slot={3} rows={steps}/>; })()}</Panel>
    <Panel title="奖励发放、冲正和损失" icon={Gift} tone="role-2" explain="按资产分开：已发放是累计发放事实，不代表尚未冲正；未追回损失由平台承担。设备赠礼按台。">{failedQuery.current?<Notice title="本次奖励冲正与损失尚未确认" kind="warn">本次查询失败，请重试后查看当前范围的冲正与损失。</Notice>:<Table label="按资产的发放和冲正" headers={['资产','已发放','待处理','已冲正','未追回损失']} rows={[[ '设备赠礼',data.giftDevices == null ? '未提供' : data.giftDevices+' 台','—','—','—'],...(['USDT','UVT'] as const).map(asset=>{const row=data.assets.find(a=>a.asset===asset);return [nexGridBrandText(asset),<Amount value={row?.issued}/>,<Amount value={row?.pending}/>,<Amount value={row?.reversed}/>,<Amount value={row?.unrecoverable}/>];})]}/>}</Panel>
    <Panel title="分设备销量" icon={Boxes} tone="role-2" sub={sales ? `${sales.length} 种设备` : undefined} explain="同一快照，按设备去重订单；跨设备的订单在每种设备下各算一次，不能直接相加。" actions={<Button onClick={()=>setOptionsOpen(true)}>统计规则</Button>}>{!sales?<Notice title="设备成交明细暂不可用" kind="warn">请重新查询。</Notice>:!sales.length?<Empty title="该时段暂无成交事实"/>:<><BarList label="分设备实付订单" rows={sales.map(r=>({ key: r.purchaseProductNo, label: r.productName||r.purchaseProductNo, value: r.paidOrders, text: `${r.paidOrders} 单` }))}/><Table label="分设备成交" headers={['购买设备','实付订单','实付 · USDT','确认退款 · USDT','净实收 · USDT']} rows={sales.map(r=>[(r.productName||r.purchaseProductNo),r.paidOrders,<Amount value={r.grossPaidUsdt}/>,<Amount value={r.refundUsdt}/>,<Amount value={r.netReceivedUsdt}/>])}/></>}<div className="pagination"><span>共 {sales?.length??'—'} 条 · 同一快照，按设备去重订单</span><span>跨设备订单数不直接相加</span></div></Panel>
    <div className="footerbar"><small>统计截止 {formatTime(data.asOf,data.timezone)} · {data.timezone}</small><div className="actions"><Button onClick={()=>setRewardsOpen(true)}>奖励分组明细</Button><Button onClick={onBack}>返回活动</Button>{can('growth_promotion_metrics_export') && <Button kind="primary" disabled={loading || !!readError} onClick={() => setExporting(true)}>导出当前报表</Button>}</div></div></>}
    {optionsOpen&&<Dialog title="统计规则与分组" wide onClose={()=>setOptionsOpen(false)} footer={<Button onClick={()=>setOptionsOpen(false)}>返回报表</Button>}><div className="grid2"><Field label="显示时区"><select value={filter.timezone} onChange={e=>setFilter({...filter,timezone:e.target.value})}><option value="Asia/Tokyo">日本时间 · UTC+9</option><option value="UTC">协调世界时 · UTC</option><option value="Asia/Ho_Chi_Minh">越南时间 · UTC+7</option></select></Field><Field label="分组方式"><select value={filter.groupBy} onChange={e=>setFilter({...filter,groupBy:e.target.value})}><option value="SKU">购买设备</option><option value="TEMPLATE">活动模板</option><option value="BENEFICIARY">受益人</option></select></Field></div><p className="help">修改条件后点击“查询”；导出包含当前查询结果。</p>{data&&<Summary rows={[[ '有效首购人数',data.effectiveFirstPurchasePeople.value??'-'],['直接邀请合格购买人数',data.directInvitedQualifiedPurchasers.value??'-'],['奖励异常',data.rewardFailureMetrics.value??'-'],['平均恢复耗时',data.recoveryDuration.value==null?'-':data.recoveryDuration.value+' 秒'],['外部流入 · USDT',data.externalInflowUsdt??'-'],['外部流出 · USDT',data.externalOutflowUsdt??'-']]}/>}<Notice title="成交与奖励采用不同时间统计规则">成交按付款时间窗口，确认退款统计截至快照；奖励按义务创建窗口。截至当前快照的奖励结果不会被当作成交金额。历史订单使用当时锁定的分项金额。</Notice></Dialog>}
    {rewardsOpen&&data&&<Dialog title="奖励分组明细" wide onClose={()=>setRewardsOpen(false)}>{failure}<div className="grid2"><Field label="分组方式"><select value={filter.groupBy} disabled={loading} onChange={e=>{setFilter({...filter,groupBy:e.target.value});setPrevious([]);void read({...filter,groupBy:e.target.value,limit:20});}}><option value="SKU">购买设备</option><option value="TEMPLATE">活动模板</option><option value="BENEFICIARY">受益人</option></select></Field></div>
      {loading?<Loading/>:!readError&&<>
        <Table headers={['分组','资产 / 赠品','订单 / 受益人','义务','已发','待发','已冲正 / 未追回损失']} rows={data.breakdown.rows.map(r=>[data.breakdown.groupBy==='SKU'?(text(catalog.skus.find(s => s.productNo === r.purchaseProductNo)?.name)):data.breakdown.groupBy==='TEMPLATE'?r.template?TEMPLATE_LABELS[r.template]:'未提供':r.beneficiaryId+' · '+(r.beneficiaryRole?labelState(r.beneficiaryRole):''),r.asset==='DEVICE'?(text(catalog.skus.find(s => s.productNo === r.giftProductNo)?.name)):nexGridBrandText(r.asset),r.orders+' / '+r.beneficiaries,r.obligations,r.issued,r.pending,r.reversed+' / '+r.unrecoverable])}/>
        {!data.breakdown.rows.length&&<Empty title="这个时段没有记录"/>}
        <div className="pagination"><span>共 {data.breakdown.total} 组 · 统计截止 {formatTime(data.asOf,data.timezone)} · {data.timezone}</span><div className="actions"><Button disabled={!previous.length||loading||!!error} onClick={()=>{void read(previous.at(-1)!);setPrevious(previous.slice(0,-1));}}>上一页</Button><Button disabled={!data.breakdown.hasMore||loading||!!error||!query} onClick={()=>{setPrevious([...previous,query!]);void read({...query!,querySnapshot:data.querySnapshot,cursor:data.breakdown.nextCursor!,limit:20});}}>下一页</Button></div></div>
        <Table headers={['资产','已冲正','未追回损失']} rows={data.assets.map(a=>[nexGridBrandText(a.asset),a.reversed??'-',a.unrecoverable??'-'])}/>
      </>}
    </Dialog>}
    {job && <Card title="导出任务" body><Summary rows={[['状态', job.state === 'READY' ? '文件已生成' : job.state === 'PROCESSING' ? '正在生成' : job.state === 'EXPIRED' ? '已过期' : '生成失败'], ['导出行数', job.rowCount ?? '-'], ['有效截止', formatTime(job.expiresAt,data?.timezone || filter.timezone)+' · '+(data?.timezone || filter.timezone)]]}/><div className="actions"><Button disabled={jobBusy} onClick={() => { void exportRead(job.exportId).catch(() => undefined); }}>查询原任务</Button><Button kind="primary" disabled={jobBusy || job.state !== 'READY'} onClick={() => { void exportRead(job.exportId, true).catch(() => undefined); }}>下载文件</Button></div></Card>}
    {exporting && data && <ConfirmCommand writeAllowed={can('growth_promotion_metrics_export') && !loading && !readError} title="导出当前报表" confirmLabel="导出当前报表" sub={<StatusTag tone="progress" filled>后台生成文件</StatusTag>} intent={{ operation: 'createExport', targetId: activity.activityId, path: `/promotions/${activity.activityId}/metrics/exports`, method: 'POST' }} body={{ querySnapshot: data.querySnapshot }} onClose={() => setExporting(false)} onSuccess={async (result) => { if (result.resource?.type !== 'EXPORT')
        throw new Error('导出结果暂无法确认，请核查原操作。'); await exportRead(result.resource.id); setExporting(false); }}><Summary rows={[['活动', activity.name || activity.activityId], ['统计时刻', formatTime(data.asOf,data.timezone)+' · '+data.timezone], ['范围', `${formatTime(data.from, data.timezone)} ～ ${formatTime(data.to, data.timezone)}`], ['分组数', data.breakdown.total]]}/><Summary rows={[['文件内容', '本次查询快照里的指标、订单、奖励、建单和分组明细，JSON 格式'], ['范围', '只导出上面这次查询的范围和分组；不会在下载时重新查询'], ['生成', '后台排队生成，每 5 秒最多处理 5 个；完成后点「查询原任务」看状态'], ['下载', '生成后点「下载文件」，下载链接 5 分钟有效；查询快照过期后要重新查询再导出']]}/></ConfirmCommand>}
  </>;
}
