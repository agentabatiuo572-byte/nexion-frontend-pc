"use client";
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { HCtx } from './types';
import type { Catalog, CommandReceipt, Promotion, PromotionPage, Template } from '@/lib/admin/promotion-types';
import { pendingPromotionCommands, promotionRead, type PendingPromotion } from '@/lib/admin/promotion-client';
import { emptyDraft, dateInput, utcInput } from '@/lib/admin/promotion-form';
import PromotionEditor from './h4-promotion-editor';
import PromotionReview from './h4-promotion-review';
import PromotionRewards from './h4-promotion-rewards';
import PromotionMetrics from './h4-promotion-metrics';
import PromotionPolicies from './h4-promotion-policies';
import { Button, Card, ConfirmCommand, Dialog, Empty, Field, Loading, Notice, ReadError, Stats, Table, Tag, TEMPLATE_LABELS, formatTime, labelState, useRead } from './h4-promotion-ui';
import './h4-promotions.css';
type Screen = 'list' | 'edit' | 'review' | 'detail' | 'rewards' | 'metrics';
const SCREENS: Screen[] = ['list', 'edit', 'review', 'detail', 'rewards', 'metrics'];
export default function H4Promotions({ ctx, legacy }: {
    ctx: HCtx;
    legacy: ReactNode;
}) {
    const [,pendingChanged]=useState(0);
    useEffect(()=>{const refreshPending=()=>pendingChanged(v=>v+1);window.addEventListener('admin-promotion-pending-changed',refreshPending);return()=>window.removeEventListener('admin-promotion-pending-changed',refreshPending);},[]);
    const [editStep, setEditStep] = useState(0), [old, setOld] = useState(false), [screen, setScreen] = useState<Screen>('list'), [id, setId] = useState(''), [activity, setActivity] = useState<Promotion | null>(null), [activityError, setActivityError] = useState<unknown>(null), [activityBusy, setActivityBusy] = useState(false), [creating, setCreating] = useState(false), [template, setTemplate] = useState<Template | null>(null), [copy, setCopy] = useState<Promotion | null>(null), [pending, setPending] = useState<PendingPromotion | null>(null), [notice, setNotice] = useState(''), [policiesOpen, setPoliciesOpen] = useState(false);
    const [filters, setFilters] = useState({ query: '', category: '', template: '', state: '', from: '', to: '', timezone: 'Asia/Tokyo', sort: 'UPDATED_DESC' }), [query, setQuery] = useState<Record<string, string | number>>({ limit: 20 }), [previous, setPrevious] = useState<Array<Record<string, string | number>>>([]);
    const catalog = useRead(() => ctx.can('growth_promotion_read') ? promotionRead<Catalog>('/promotion-catalog') : Promise.reject(new Error('当前账户没有查看促销活动的权限。')), [ctx.can]);
    const list = useRead(() => ctx.can('growth_promotion_read') ? promotionRead<PromotionPage>('/promotions', query) : Promise.reject(new Error('当前账户没有查看促销活动的权限。')), [JSON.stringify(query), ctx.can]);
    const navigate = (next: Screen, target = id) => { setScreen(next); setId(target); const url = new URL(location.href); if (next === 'list') {
        url.searchParams.delete('promotion');
        url.searchParams.delete('activity');
    }
    else {
        url.searchParams.set('promotion', next);
        url.searchParams.set('activity', target);
    } history.pushState({}, '', url); };
    useEffect(() => { const restore = () => { const p = new URLSearchParams(location.search), s = p.get('promotion'); setScreen(SCREENS.includes(s as Screen) ? s as Screen : 'list'); setId(p.get('activity') || '');setEditStep(Math.max(0,Math.min(3,Number(p.get('step'))||0)));  }; restore(); window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore); }, []);
    useEffect(() => { if (!id) {
        setActivity(null);
        return;
    } let current = true; setActivityBusy(true); setActivityError(null); promotionRead<Promotion>(`/promotions/${encodeURIComponent(id)}`).then(p => { if (current)
        setActivity(p); }).catch(e => { if (current)
        setActivityError(e); }).finally(() => { if (current)
        setActivityBusy(false); }); return () => { current = false; }; }, [id]);
    const changeStep=useCallback((step:number)=>{setEditStep(step);const url=new URL(location.href);url.searchParams.set('step',String(step));history.replaceState({},'',url);},[]);
    const refresh = async (nextStep?: number) => { if (!id)
        return; const latest = await promotionRead<Promotion>(`/promotions/${encodeURIComponent(id)}`); if(nextStep!==undefined)changeStep(nextStep); setActivity(latest); list.reload(); };
    const afterCreate = async (result: CommandReceipt) => { if (!result.resource)
        throw new Error('创建回执暂不完整，请核查原命令。'); const target = result.resource.type === 'VERSION' ? result.resource.id.slice(0, result.resource.id.lastIndexOf(':')) : result.resource.id; const saved = await promotionRead<Promotion>(`/promotions/${encodeURIComponent(target)}`); setActivity(saved); setTemplate(null); setCreating(false); setCopy(null); list.reload(); navigate('edit', target); };
    const pendingItems = pendingPromotionCommands();
    const heading = screen === 'list' ? ['活动中心', '管理促销与裂变活动，跟进配置、投放及未完成奖励。'] : screen === 'edit' ? [`配置活动 · ${['基本信息', '参与资格', '购机赠奖', '预算与叠加'][editStep]}`, '设置参与条件、逐设备奖励与预算政策。'] : screen === 'review' ? ['试算、审核与发布', '先确认样本和阻断项，再分别审核与发布。'] : screen === 'detail' ? [activity?.name || '活动详情', '已发布规则与改版草稿分开呈现，旧订单继续按原版本履行。'] : screen === 'rewards' ? ['奖励台账', '逐项核对承诺与真实回执；结果未知时先核账。'] : ['活动效果', '查看同一统计快照的成交、退款与奖励成本。'];
    if (old)
        return <><div className="prm"><div className="tabs"><button onClick={() => setOld(false)}>促销与裂变</button><button className="active">既有活动</button></div></div><div className="dkpage">{legacy}</div></>;
    return <div className="prm" data-promotion-screen={screen}><div className="pagehead"><div><h1>{heading[0]}</h1><p>{heading[1]}</p></div>{ctx.can('growth_promotion_policy_read') && catalog.data && <Button onClick={() => setPoliciesOpen(true)}>政策与原合同</Button>}{screen !== 'list' && screen !== 'edit' && <div className="actions"><Button onClick={() => navigate('list')}>返回活动列表</Button></div>}</div>
    {screen === 'list' && <div className="tabs"><button className="active">促销与裂变</button><button onClick={() => setOld(true)}>既有活动</button></div>}
    {pendingItems.length > 0 && <Notice title="有操作结果尚未核实" kind="warn">关闭或刷新不会重新提交。{pendingItems.map(p => <Button key={p.commandKey} kind="link" onClick={() => setPending(p)}>核查原操作</Button>)}</Notice>}{notice && <Notice title="操作反馈">{notice}</Notice>}
    {screen === 'list' && <>{list.data && <Stats items={[['进行中活动', list.data.summary.activeActivities, '全部匹配活动'], ['已预留奖励', list.data.summary.reserved, '待支付订单锁定'], ['已发放奖励', list.data.summary.issued, '真实资金或设备回执'], ['未解决奖励', list.data.summary.unresolved, '失败、未知或待处置']]}/>}<Card title="活动" action={<Button kind="primary" disabled={!ctx.can('growth_promotion_edit') || !catalog.data} onClick={() => setCreating(true)}>新建活动</Button>}><form className="filter" onSubmit={e => { e.preventDefault(); const q: Record<string, string | number> = { limit: 20, query: filters.query, category: filters.category, template: filters.template, state: filters.state, sort: filters.sort }; if (filters.from && filters.to)
        Object.assign(q, { from: filters.from, to: filters.to, timezone: filters.timezone }); setQuery(q); setPrevious([]); }}><Field label="名称 / 活动编号"><input value={filters.query} maxLength={200} onChange={e => setFilters({ ...filters, query: e.target.value })}/></Field><Field label="类别"><select value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value })}><option value="">全部类别</option><option value="PROMOTION">促销</option><option value="REFERRAL">裂变</option></select></Field><Field label="模板"><select value={filters.template} onChange={e => setFilters({ ...filters, template: e.target.value })}><option value="">全部模板</option>{Object.entries(TEMPLATE_LABELS).map(([v, label]) => <option value={v} key={v}>{label}</option>)}</select></Field><Field label="活动状态"><select value={filters.state} onChange={e => setFilters({ ...filters, state: e.target.value })}><option value="">全部状态</option>{['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED'].map(v => <option key={v} value={v}>{labelState(v)}</option>)}</select></Field><Button type="submit" kind="primary" disabled={list.loading}>查询</Button><details className="wide"><summary>时间范围与排序</summary><div className="grid2"><Field label="时区"><select value={filters.timezone} onChange={e => setFilters({ ...filters, timezone: e.target.value })}><option value="Asia/Tokyo">日本时间 · UTC+9</option><option value="UTC">协调世界时 · UTC</option><option value="Asia/Ho_Chi_Minh">越南时间 · UTC+7</option></select></Field><Field label="排序"><select value={filters.sort} onChange={e => setFilters({ ...filters, sort: e.target.value })}><option value="UPDATED_DESC">最近更新</option><option value="NAME_ASC">活动名称</option><option value="STARTS_ASC">开始时间</option></select></Field>{(['from', 'to'] as const).map((key, i) => <Field key={key} label={i ? '窗口结束' : '窗口开始'}><input type="datetime-local" value={dateInput(filters[key], filters.timezone)} onChange={e => { try {
        setFilters({ ...filters, [key]: utcInput(e.target.value, filters.timezone) || '' });
    }
    catch (e) {
        setNotice(e instanceof Error ? e.message : '日期选择无效');
    } }}/></Field>)}</div></details></form>{list.loading ? <Loading /> : list.error ? <ReadError error={list.error} retry={() => { setQuery({ ...query, querySnapshot: '', cursor: '' }); list.reload(); }}/> : !list.data?.items.length ? <Empty title="还没有匹配的活动" action={<Button disabled={!ctx.can('growth_promotion_edit') || !catalog.data} onClick={() => setCreating(true)}>新建活动</Button>}>从五种模板开始，逐步保存配置；未批准政策不能发布。</Empty> : <Table headers={['活动 / 模板', '活动状态', '发布 / 草稿版本', '活动时窗', '未解决奖励', '操作']} rows={list.data.items.map(p => [<><div className="table-title">{p.name || '未命名草稿'}</div><small>{p.category === 'PROMOTION' ? '促销' : '裂变'} · {TEMPLATE_LABELS[p.template]}</small></>, <Tag value={p.state}/>, <>{p.activeVersion ? `v${p.activeVersion} 已发布` : '无发布版本'}<small>{p.draftVersion ? `v${p.draftVersion} ${labelState(p.draftVersionState || 'DRAFT')}` : '无改版草稿'}</small></>, <>{formatTime(p.startsAt, p.displayTimezone || 'UTC')}<small>{formatTime(p.endsAt, p.displayTimezone || 'UTC')} 结束</small></>, <Button kind="link" disabled={!ctx.can('growth_promotion_reward_read')} onClick={() => navigate('rewards', p.activityId)}>{p.unresolved} 项待处理</Button>, <div className="actions"><Button kind="link" onClick={() => navigate('detail', p.activityId)}>详情</Button><Button kind="link" disabled={!ctx.can('growth_promotion_edit') || p.draftVersionState !== 'DRAFT'} onClick={() => navigate('edit', p.activityId)}>编辑草稿</Button><Button kind="link" disabled={!ctx.can('growth_promotion_edit')} onClick={() => setCopy(p)}>复制</Button></div>])}/>}{list.data && !list.loading && <div className="pagination"><span>共 {list.data.total} 条 · 每页 20 条 · 快照 {formatTime(list.data.asOf)}</span><div className="actions"><Button disabled={!previous.length} onClick={() => { setQuery(previous.at(-1)!); setPrevious(previous.slice(0, -1)); }}>上一页</Button><Button disabled={!list.data.hasMore} onClick={() => { setPrevious([...previous, { ...query, querySnapshot: list.data!.querySnapshot }]); setQuery({ ...query, querySnapshot: list.data!.querySnapshot, cursor: list.data!.nextCursor! }); }}>下一页</Button></div></div>}</Card></>}
    {!!catalog.error && <ReadError error={catalog.error} retry={catalog.reload}/>}
    {screen !== 'list' && (activityBusy ? <Loading /> : activityError ? <ReadError error={activityError} retry={() => { setActivityError(null); void refresh().catch(setActivityError); }}/> : !activity || activity.activityId !== id || !catalog.data ? <Empty title="活动资料尚未就绪" action={<Button onClick={() => navigate('list')}>返回列表</Button>}/> : <>{screen === 'edit' && activity.current && <PromotionEditor key={`${activity.activityId}:${activity.current.revision}`} activity={activity} catalog={catalog.data} can={ctx.can} onSaved={refresh} initialStep={editStep} onStep={changeStep} onBack={() => navigate('detail')} onReview={() => navigate('review')}/>}{(screen === 'detail' || screen === 'review') && <PromotionReview key={`${id}:${screen}`} activity={activity} catalog={catalog.data} can={ctx.can} onRefresh={refresh} onEdit={() => navigate('edit')} onRewards={() => navigate('rewards')} onMetrics={() => navigate('metrics')} onBack={() => navigate('detail')} review={screen === 'review'}/>}<div className="actions" style={{ marginTop: 16 }}>{screen === 'detail' && <><Button kind="primary" disabled={!activity.draftVersion} onClick={() => navigate('review')}>试算与审核</Button><Button disabled={!ctx.can('growth_promotion_reward_read')} onClick={() => navigate('rewards')}>奖励台账</Button></>}</div>{screen === 'rewards' && (ctx.can('growth_promotion_reward_read') ? <PromotionRewards activity={activity} catalog={catalog.data} can={ctx.can} onBack={() => navigate('detail')}/> : <Notice title="无奖励查看权限" kind="warn">请返回活动详情。</Notice>)}{screen === 'metrics' && (ctx.can('growth_promotion_metrics_read') ? <PromotionMetrics activity={activity} catalog={catalog.data} can={ctx.can} onBack={() => navigate('detail')}/> : <Notice title="无报表查看权限" kind="warn">请返回活动详情。</Notice>)}</>)}
    {policiesOpen && catalog.data && <PromotionPolicies catalog={catalog.data} can={ctx.can} onClose={() => setPoliciesOpen(false)} onChanged={catalog.reload}/>}
    {creating && !template && <Dialog title="选择活动模板" onClose={() => setCreating(false)}><p>模板只创建配置结构，业务金额、资格、预算与政策均由运营明确填写。</p><div className="actions" style={{ marginTop: 18 }}>{Object.entries(TEMPLATE_LABELS).map(([v, label]) => <Button key={v} onClick={() => setTemplate(v as Template)}>{label}</Button>)}</div></Dialog>}
    {template && <ConfirmCommand title={`新建${TEMPLATE_LABELS[template]}`} intent={{ operation: 'createPromotion', targetId: 'promotions', path: '/promotions', method: 'POST' }} body={{ draft: emptyDraft(template) }} onClose={() => setTemplate(null)} onSuccess={afterCreate}><Notice title="创建部分草稿">先创建可继续配置的活动，尚未提交审核或对外开放。</Notice></ConfirmCommand>}
    {copy && <ConfirmCommand title="复制为新活动" intent={{ operation: 'copyPromotion', targetId: copy.activityId, path: `/promotions/${copy.activityId}/copies`, method: 'POST' }} body={{ expectedRevision: copy.revision, evidenceRefs: [] }} onClose={() => setCopy(null)} onSuccess={afterCreate}><Notice title="仅复制配置">原活动 {copy.name || copy.activityId} 的审批、累计使用量与订单不会转到新活动。</Notice></ConfirmCommand>}
    {pending && <ConfirmCommand title="核查原操作结果" intent={pending} body={pending.body as Record<string, unknown>} onClose={() => setPending(null)} onSuccess={async (result) => { setPending(null); setNotice('原操作已确认成功，正在回读最新事实。'); if (result.resource?.type === 'PROMOTION')
        await afterCreate(result);
    else {
        if (id)
            await refresh();
        list.reload();
    } }}><Notice title="原参数保留">本操作只核查或原样恢复之前的命令，不修改目标与原始参数。</Notice></ConfirmCommand>}
  </div>;
}
